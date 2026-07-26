import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'

import initSqlJs from 'sql.js'
import { buildMarkerOverlapGroups } from '../src/utils/markerOverlap.mjs'

function buildNaiveOverlapGroups({ placedMarkers, markerTemplates, zoom, markerSize }) {
  if (placedMarkers.length < 2) return new Map()

  const effectiveSize = Math.min(
    markerSize / Math.max(zoom, 0.05),
    Math.max(200, markerSize * 6),
  )
  const boxes = placedMarkers.map((marker) => {
    const template = markerTemplates.find(candidate => candidate.id === marker.marker_id)
    let half = effectiveSize / 2

    if (template?.base_config) {
      try {
        const config = typeof template.base_config === 'string'
          ? JSON.parse(template.base_config)
          : template.base_config
        if (config && config.baseType !== 'none') {
          const baseSize = effectiveSize * (config.baseScale || 1.05)
          if (baseSize > effectiveSize) half = baseSize / 2
        }
      } catch {
        // Matches MemoryHub's legacy behavior for malformed JSON.
      }
    }

    return {
      marker,
      left: marker.world_x - half,
      right: marker.world_x + half,
      top: marker.world_y - half,
      bottom: marker.world_y + half,
    }
  })

  const overlaps = (a, b) => !(
    a.right < b.left
    || a.left > b.right
    || a.bottom < b.top
    || a.top > b.bottom
  )

  const visited = new Array(boxes.length).fill(false)
  const groups = []
  for (let start = 0; start < boxes.length; start += 1) {
    if (visited[start]) continue

    visited[start] = true
    const indices = [start]
    for (let cursor = 0; cursor < indices.length; cursor += 1) {
      const member = boxes[indices[cursor]]
      for (let candidate = 0; candidate < boxes.length; candidate += 1) {
        if (visited[candidate] || !overlaps(member, boxes[candidate])) continue
        visited[candidate] = true
        indices.push(candidate)
      }
    }
    groups.push(indices.map(index => placedMarkers[index]))
  }

  const markerToGroup = new Map()
  for (const group of groups) {
    if (group.length < 2) continue
    group.sort((a, b) => (b.sort_order ?? 0) - (a.sort_order ?? 0))
    for (const marker of group) markerToGroup.set(marker.id, group)
  }
  return markerToGroup
}

function assertEquivalent(actual, expected, context) {
  assert.equal(actual.size, expected.size, `${context}: Map size`)
  for (const [markerId, expectedGroup] of expected) {
    const actualGroup = actual.get(markerId)
    assert.ok(actualGroup, `${context}: missing ${markerId}`)
    for (let index = 1; index < actualGroup.length; index += 1) {
      assert.ok(
        (actualGroup[index - 1].sort_order ?? 0) >= (actualGroup[index].sort_order ?? 0),
        `${context}: group for ${markerId} is not sorted`,
      )
    }
    assert.deepEqual(
      actualGroup.map(marker => marker.id).sort(),
      expectedGroup.map(marker => marker.id).sort(),
      `${context}: component membership for ${markerId}`,
    )
  }

  const arraysByGroup = new Map()
  for (const [markerId, group] of actual) {
    const groupKey = group.map(marker => marker.id).join(',')
    const previous = arraysByGroup.get(groupKey)
    if (previous) assert.strictEqual(group, previous, `${context}: shared group array for ${markerId}`)
    else arraysByGroup.set(groupKey, group)
  }
}

function createRandom(seed) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x100000000
  }
}

function queryRows(database, sql, params = []) {
  const statement = database.prepare(sql)
  try {
    statement.bind(params)
    const rows = []
    while (statement.step()) rows.push(statement.getAsObject())
    return rows
  } finally {
    statement.free()
  }
}

function medianDuration(operation, iterations) {
  for (let iteration = 0; iteration < 5; iteration += 1) operation()
  const samples = []
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const startedAt = performance.now()
    operation()
    samples.push(performance.now() - startedAt)
  }
  samples.sort((a, b) => a - b)
  return samples[Math.floor(samples.length / 2)]
}

const markers = [
  { id: 'a', marker_id: 'plain', world_x: 0, world_y: 0, sort_order: 1 },
  { id: 'b', marker_id: 'plain', world_x: 9, world_y: 0, sort_order: 3 },
  { id: 'c', marker_id: 'plain', world_x: 18, world_y: 0, sort_order: 2 },
  { id: 'isolated', marker_id: 'plain', world_x: 100, world_y: 100, sort_order: 4 },
]

const groups = buildMarkerOverlapGroups({
  placedMarkers: markers,
  markerTemplates: [{ id: 'plain' }],
  zoom: 1,
  markerSize: 10,
})

assert.deepEqual(groups.get('a')?.map(marker => marker.id), ['b', 'c', 'a'])
assert.strictEqual(groups.get('a'), groups.get('b'))
assert.strictEqual(groups.get('b'), groups.get('c'))
assert.equal(groups.has('isolated'), false)

const baseMarkers = [
  { id: 'base-a', marker_id: 'base', world_x: 0, world_y: 0, sort_order: 0 },
  { id: 'base-b', marker_id: 'plain', world_x: 14, world_y: 0, sort_order: 0 },
]

const objectBaseGroups = buildMarkerOverlapGroups({
  placedMarkers: baseMarkers,
  markerTemplates: [
    { id: 'base', base_config: { baseType: 'circle', baseScale: 2 } },
    { id: 'plain' },
  ],
  zoom: 1,
  markerSize: 10,
})
assert.deepEqual(objectBaseGroups.get('base-a')?.map(marker => marker.id), ['base-a', 'base-b'])

const jsonBaseGroups = buildMarkerOverlapGroups({
  placedMarkers: baseMarkers,
  markerTemplates: [
    { id: 'base', base_config: '{"baseType":"diamond","baseScale":2}' },
    { id: 'plain' },
  ],
  zoom: 1,
  markerSize: 10,
})
assert.deepEqual(jsonBaseGroups.get('base-a')?.map(marker => marker.id), ['base-a', 'base-b'])

const disabledBaseGroups = buildMarkerOverlapGroups({
  placedMarkers: baseMarkers,
  markerTemplates: [
    { id: 'base', base_config: { baseType: 'none', baseScale: 10 } },
    { id: 'plain' },
  ],
  zoom: 1,
  markerSize: 10,
})
assert.equal(disabledBaseGroups.size, 0)

const defaultBaseScaleGroups = buildMarkerOverlapGroups({
  placedMarkers: [
    { ...baseMarkers[0] },
    { ...baseMarkers[1], world_x: 10.2 },
  ],
  markerTemplates: [
    { id: 'base', base_config: { baseType: 'square' } },
    { id: 'plain' },
  ],
  zoom: 1,
  markerSize: 10,
})
assert.equal(defaultBaseScaleGroups.size, 2)

const random = createRandom(0x6d6170)
const baseConfigs = [
  null,
  { baseType: 'none', baseScale: 4 },
  { baseType: 'circle' },
  { baseType: 'square', baseScale: 1.3 },
  { baseType: 'diamond', baseScale: 2 },
  { baseType: 'circle', baseScale: 0.5 },
  '{"baseType":"circle","baseScale":1.8}',
  '{invalid-json',
]
const zooms = [0.01, 0.05, 0.07, 0.1, 0.5, 1, 3.5]

for (let trial = 0; trial < 300; trial += 1) {
  const templateCount = 1 + Math.floor(random() * 10)
  const templates = Array.from({ length: templateCount }, (_, index) => ({
    id: `template-${index}`,
    base_config: baseConfigs[Math.floor(random() * baseConfigs.length)],
  }))
  const markerCount = Math.floor(random() * 75)
  const randomMarkers = Array.from({ length: markerCount }, (_, index) => ({
    id: `trial-${trial}-marker-${index}`,
    marker_id: templates[Math.floor(random() * templates.length)].id,
    world_x: Math.round((random() * 6000 - 3000) * 1000) / 1000,
    world_y: Math.round((random() * 6000 - 3000) * 1000) / 1000,
    sort_order: random() < 0.15 ? null : Math.floor(random() * 8),
  }))
  const options = {
    placedMarkers: randomMarkers,
    markerTemplates: templates,
    zoom: zooms[Math.floor(random() * zooms.length)],
    markerSize: 16 + Math.floor(random() * 185),
  }

  assertEquivalent(
    buildMarkerOverlapGroups(options),
    buildNaiveOverlapGroups(options),
    `random differential trial ${trial}`,
  )
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SQL = await initSqlJs({
  locateFile: file => path.join(projectRoot, 'node_modules', 'sql.js', 'dist', file),
})
const database = new SQL.Database()
try {
  database.exec(fs.readFileSync(path.join(projectRoot, 'electron', 'schema.sql'), 'utf8'))
  database.exec(fs.readFileSync(path.join(projectRoot, 'electron', 'seed.sql'), 'utf8'))

  const currentScaleMarkers = queryRows(
    database,
    `SELECT id, marker_id, world_x, world_y, sort_order
       FROM map_marker_placements
      WHERE map_id = ?
      ORDER BY sort_order, created_at`,
    ['v6_7_mo6b'],
  )
  const currentScaleTemplates = queryRows(
    database,
    'SELECT id, base_config FROM map_markers ORDER BY sort_order, name_zh',
  )
  assert.equal(currentScaleMarkers.length, 767, '提瓦特 v6.7 fixture placement count')

  const currentOptions = {
    placedMarkers: currentScaleMarkers,
    markerTemplates: currentScaleTemplates,
    zoom: 0.1478337915041284,
    markerSize: 32,
  }
  assertEquivalent(
    buildMarkerOverlapGroups(currentOptions),
    buildNaiveOverlapGroups(currentOptions),
    '提瓦特 v6.7 differential',
  )

  const optimizedMedianMs = medianDuration(
    () => buildMarkerOverlapGroups(currentOptions),
    40,
  )
  const naiveMedianMs = medianDuration(
    () => buildNaiveOverlapGroups(currentOptions),
    12,
  )
  assert.ok(
    optimizedMedianMs < 50,
    `提瓦特 v6.7 overlap build took ${optimizedMedianMs.toFixed(2)}ms`,
  )
  assert.ok(
    optimizedMedianMs < naiveMedianMs,
    `spatial hash ${optimizedMedianMs.toFixed(2)}ms was not faster than naive ${naiveMedianMs.toFixed(2)}ms`,
  )

  console.log(
    `marker overlap tests passed: 300 randomized cases; `
    + `提瓦特 v6.7 ${currentScaleMarkers.length} markers `
    + `(spatial ${optimizedMedianMs.toFixed(2)}ms median, `
    + `naive ${naiveMedianMs.toFixed(2)}ms median, `
    + `${(naiveMedianMs / optimizedMedianMs).toFixed(1)}x faster)`,
  )
} finally {
  database.close()
}

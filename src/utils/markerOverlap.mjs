/**
 * Build the connected overlap group for every marker that overlaps at least one
 * other marker.
 *
 * The returned Map is keyed by placement id. Every key in one connected
 * component points at the same array of the original placement objects, sorted
 * by `sort_order` descending.
 *
 * @param {object} options
 * @param {Array<object>} options.placedMarkers Marker placement rows.
 * @param {Array<object>} options.markerTemplates Marker template rows.
 * @param {number} options.zoom Current map zoom.
 * @param {number} options.markerSize Configured marker size in screen pixels.
 * @returns {Map<string, Array<object>>}
 */
export function buildMarkerOverlapGroups({
  placedMarkers,
  markerTemplates,
  zoom,
  markerSize,
}) {
  const count = placedMarkers.length
  if (count < 2) return new Map()

  // MemoryHub historically uses the first matching template (`Array#find`).
  // Preserve that detail while removing the per-placement linear lookup.
  const scaleByTemplateId = new Map()
  for (const template of markerTemplates) {
    if (scaleByTemplateId.has(template.id)) continue

    let scale = 1
    if (template.base_config) {
      try {
        const config = typeof template.base_config === 'string'
          ? JSON.parse(template.base_config)
          : template.base_config

        if (config && config.baseType !== 'none') {
          const configuredScale = config.baseScale || 1.05
          if (configuredScale > 1) scale = configuredScale
        }
      } catch {
        // Invalid legacy base_config values never expanded the old hit box.
      }
    }
    scaleByTemplateId.set(template.id, scale)
  }

  const effectiveSize = Math.min(
    markerSize / Math.max(zoom, 0.05),
    Math.max(200, markerSize * 6),
  )

  const left = new Float64Array(count)
  const right = new Float64Array(count)
  const top = new Float64Array(count)
  const bottom = new Float64Array(count)
  let cellSize = effectiveSize

  for (let index = 0; index < count; index += 1) {
    const marker = placedMarkers[index]
    const scale = scaleByTemplateId.get(marker.marker_id) ?? 1
    const diameter = effectiveSize * scale
    const half = diameter / 2

    left[index] = marker.world_x - half
    right[index] = marker.world_x + half
    top[index] = marker.world_y - half
    bottom[index] = marker.world_y + half
    if (diameter > cellSize) cellSize = diameter
  }

  const parent = new Int32Array(count)
  const componentSize = new Int32Array(count)
  for (let index = 0; index < count; index += 1) {
    parent[index] = index
    componentSize[index] = 1
  }

  const findRoot = (index) => {
    let root = index
    while (parent[root] !== root) root = parent[root]
    while (parent[index] !== index) {
      const next = parent[index]
      parent[index] = root
      index = next
    }
    return root
  }

  const union = (leftIndex, rightIndex) => {
    let leftRoot = findRoot(leftIndex)
    let rightRoot = findRoot(rightIndex)
    if (leftRoot === rightRoot) return

    if (componentSize[leftRoot] < componentSize[rightRoot]) {
      const swap = leftRoot
      leftRoot = rightRoot
      rightRoot = swap
    }
    parent[rightRoot] = leftRoot
    componentSize[leftRoot] += componentSize[rightRoot]
  }

  const intersects = (a, b) => !(
    right[a] < left[b]
    || left[a] > right[b]
    || bottom[a] < top[b]
    || top[a] > bottom[b]
  )

  // Each box is inserted into every cell it touches. Because cellSize is at
  // least the largest box diameter, a normal box occupies at most four cells.
  // A generation stamp avoids checking a candidate twice when two boxes share
  // more than one cell.
  const grid = new Map()
  const candidateSeenAt = new Int32Array(count)
  candidateSeenAt.fill(-1)

  for (let index = 0; index < count; index += 1) {
    const minCellX = Math.floor(left[index] / cellSize)
    const maxCellX = Math.floor(right[index] / cellSize)
    const minCellY = Math.floor(top[index] / cellSize)
    const maxCellY = Math.floor(bottom[index] / cellSize)

    for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
      for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
        const key = `${cellX}:${cellY}`
        const candidates = grid.get(key)
        if (!candidates) continue

        for (const candidate of candidates) {
          if (candidateSeenAt[candidate] === index) continue
          candidateSeenAt[candidate] = index
          if (intersects(index, candidate)) union(index, candidate)
        }
      }
    }

    for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
      for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
        const key = `${cellX}:${cellY}`
        const bucket = grid.get(key)
        if (bucket) bucket.push(index)
        else grid.set(key, [index])
      }
    }
  }

  const componentByRoot = new Map()
  for (let index = 0; index < count; index += 1) {
    const root = findRoot(index)
    let component = componentByRoot.get(root)
    if (!component) {
      component = []
      componentByRoot.set(root, component)
    }
    component.push(placedMarkers[index])
  }

  const markerToGroup = new Map()
  for (const component of componentByRoot.values()) {
    if (component.length < 2) continue
    component.sort((a, b) => (b.sort_order ?? 0) - (a.sort_order ?? 0))
    for (const marker of component) markerToGroup.set(marker.id, component)
  }
  return markerToGroup
}

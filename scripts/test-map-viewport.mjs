import assert from 'node:assert/strict'

import {
  constrainMapViewCenter,
  getAxisPanRange,
  getCenteredMapViewCenter,
  getMapWorldBounds,
  getPanMargin,
} from '../src/utils/mapViewport.mjs'
import {
  createAnnotationWindow,
  needsAnnotationWindowRefresh,
} from '../src/utils/annotationViewport.mjs'
import {
  getPendingTileRequestWidth,
  getTilePreloadRequestWidth,
  getTileRequestWidth,
  getVisibleTileLimit,
  tileCacheSatisfies,
} from '../src/utils/tileResolution.mjs'

const teyvat = {
  anchorA: [17045, 5446],
  scale: 3.9088777513436677,
  mapW: 23040,
  mapH: 14848,
  tileSize: 2816,
  tileRange: { minRow: -8, maxRow: 14, minCol: -24, maxCol: 9 },
}

const bounds = getMapWorldBounds(teyvat)
assert.equal(bounds.source, 'image')
assert.ok(Math.abs(bounds.minX - (-17045 * teyvat.scale)) < 1e-6)
assert.ok(Math.abs(bounds.maxY - ((teyvat.mapH - 5446) * teyvat.scale)) < 1e-6)

const fallback = getMapWorldBounds({
  tileSize: 512,
  tileRange: { minRow: -2, maxRow: 3, minCol: -4, maxCol: 5 },
})
assert.deepEqual(fallback, {
  minX: -2048,
  maxX: 2560,
  minY: -1024,
  maxY: 1536,
  source: 'tiles',
})

assert.equal(getPanMargin(1200), 180)
assert.equal(getPanMargin(800), 120)

const largeRange = getAxisPanRange({
  minWorld: -1000,
  maxWorld: 1000,
  zoom: 1,
  viewportSize: 800,
})
assert.deepEqual(
  { min: largeRange.min, max: largeRange.max },
  { min: -320, max: 1120 },
)

const smallRange = getAxisPanRange({
  minWorld: -100,
  maxWorld: 100,
  zoom: 1,
  viewportSize: 800,
})
assert.ok(smallRange.min < 400)
assert.ok(smallRange.max > 400)

const constrained = constrainMapViewCenter({
  candidate: { x: 1e9, y: -1e9 },
  zoom: 0.1,
  viewport: { w: 958, h: 609 },
  config: teyvat,
})
assert.equal(constrained.hitX, true)
assert.equal(constrained.hitY, true)
assert.ok(Number.isFinite(constrained.viewCenter.x))
assert.ok(Number.isFinite(constrained.viewCenter.y))
assert.deepEqual(
  constrainMapViewCenter({
    candidate: constrained.viewCenter,
    zoom: 0.1,
    viewport: { w: 958, h: 609 },
    config: teyvat,
  }).viewCenter,
  constrained.viewCenter,
)

const centered = getCenteredMapViewCenter({
  config: teyvat,
  zoom: 0.01,
  viewport: { w: 958, h: 609 },
})
const centeredConstrained = constrainMapViewCenter({
  candidate: centered,
  zoom: 0.01,
  viewport: { w: 958, h: 609 },
  config: teyvat,
})
assert.deepEqual(centeredConstrained.viewCenter, centered)

const annotationWindow = createAnnotationWindow({
  viewCenter: { x: 100, y: 50 },
  zoom: 0.1,
  viewport: { w: 1000, h: 700 },
})
assert.equal(needsAnnotationWindowRefresh({
  annotationWindow,
  viewCenter: { x: -200, y: 50 },
  zoom: 0.1,
  viewport: { w: 1000, h: 700 },
}), false)
assert.equal(needsAnnotationWindowRefresh({
  annotationWindow,
  viewCenter: { x: -500, y: 50 },
  zoom: 0.1,
  viewport: { w: 1000, h: 700 },
}), true)

assert.equal(getTileRequestWidth({ tileSize: 2816, zoom: 0.1, devicePixelRatio: 2 }), 1024)
assert.equal(getTileRequestWidth({ tileSize: 2816, zoom: 0.152, devicePixelRatio: 2 }), 1024)
assert.equal(getTileRequestWidth({ tileSize: 2816, zoom: 0.5, devicePixelRatio: 2 }), 0)
assert.equal(getTileRequestWidth({ tileSize: 2816, zoom: 0.09, devicePixelRatio: 2 }), 512)
assert.equal(getTilePreloadRequestWidth({
  tileSize: 2816,
  zoom: 0.07,
  devicePixelRatio: 2,
  useFullImage: true,
  fullImageThreshold: 0.1,
}), 1024)
assert.equal(getVisibleTileLimit({ tileSize: 2816, zoom: 0.1, devicePixelRatio: 2 }), 61)
assert.equal(getVisibleTileLimit({ tileSize: 2816, zoom: 0.5, devicePixelRatio: 2 }), 12)
assert.equal(tileCacheSatisfies({ data: 'x', width: 1024 }, 512, 2816), true)
assert.equal(tileCacheSatisfies({ data: 'x', width: 512 }, 1024, 2816), false)
assert.equal(getPendingTileRequestWidth({
  entry: { data: 'x', width: 512 },
  wantedWidth: 1024,
  tileSize: 2816,
}), 1024)
assert.equal(getPendingTileRequestWidth({
  entry: { data: 'x', width: 1024 },
  wantedWidth: 1024,
  tileSize: 2816,
}), null)

console.log('map viewport tests passed')

const isFiniteNumber = value => (
  value !== null
  && value !== ''
  && Number.isFinite(Number(value))
)

export function getMapWorldBounds(config) {
  if (!config) return null

  const anchor = config.anchorA
  const scale = Number(config.scale)
  const mapWidth = Number(config.mapW)
  const mapHeight = Number(config.mapH)
  if (
    Array.isArray(anchor)
    && anchor.length >= 2
    && isFiniteNumber(anchor[0])
    && isFiniteNumber(anchor[1])
    && scale > 0
    && mapWidth > 0
    && mapHeight > 0
  ) {
    const minX = -Number(anchor[0]) * scale
    const minY = -Number(anchor[1]) * scale
    return {
      minX,
      maxX: minX + mapWidth * scale,
      minY,
      maxY: minY + mapHeight * scale,
      source: 'image',
    }
  }

  const range = config.tileRange
  const tileSize = Number(config.tileSize)
  if (
    range
    && tileSize > 0
    && isFiniteNumber(range.minCol)
    && isFiniteNumber(range.maxCol)
    && isFiniteNumber(range.minRow)
    && isFiniteNumber(range.maxRow)
  ) {
    return {
      minX: Number(range.minCol) * tileSize,
      maxX: Number(range.maxCol) * tileSize,
      minY: Number(range.minRow) * tileSize,
      maxY: Number(range.maxRow) * tileSize,
      source: 'tiles',
    }
  }

  return null
}

export function getPanMargin(viewportSize) {
  const size = Number(viewportSize)
  if (!(size > 0)) return 0
  return Math.min(180, size * 0.25, Math.max(64, size * 0.15))
}

export function getAxisPanRange({
  minWorld,
  maxWorld,
  zoom,
  viewportSize,
  marginPx = getPanMargin(viewportSize),
}) {
  const size = Number(viewportSize)
  const scale = Number(zoom)
  if (
    !(size > 0)
    || !(scale > 0)
    || !isFiniteNumber(minWorld)
    || !isFiniteNumber(maxWorld)
  ) {
    return null
  }

  const scaledMin = Math.min(Number(minWorld), Number(maxWorld)) * scale
  const scaledMax = Math.max(Number(minWorld), Number(maxWorld)) * scale
  const contentLength = scaledMax - scaledMin
  const margin = Math.max(0, Math.min(Number(marginPx) || 0, size / 2))
  const innerLength = Math.max(0, size - margin * 2)

  if (contentLength >= innerLength) {
    return {
      min: size - margin - scaledMax,
      max: margin - scaledMin,
      margin,
      contentLength,
    }
  }

  const center = (size - scaledMin - scaledMax) / 2
  const travel = Math.min(margin, Math.max(0, (innerLength - contentLength) / 2))
  return {
    min: center - travel,
    max: center + travel,
    margin,
    contentLength,
  }
}

export function constrainMapViewCenter({
  candidate,
  zoom,
  viewport,
  config,
  bounds = getMapWorldBounds(config),
}) {
  const original = {
    x: Number(candidate?.x) || 0,
    y: Number(candidate?.y) || 0,
  }
  if (!bounds) {
    return { viewCenter: original, hitX: false, hitY: false, bounds: null }
  }

  const xRange = getAxisPanRange({
    minWorld: bounds.minX,
    maxWorld: bounds.maxX,
    zoom,
    viewportSize: viewport?.w,
  })
  const yRange = getAxisPanRange({
    minWorld: bounds.minY,
    maxWorld: bounds.maxY,
    zoom,
    viewportSize: viewport?.h,
  })
  if (!xRange || !yRange) {
    return { viewCenter: original, hitX: false, hitY: false, bounds }
  }

  const x = Math.min(xRange.max, Math.max(xRange.min, original.x))
  const y = Math.min(yRange.max, Math.max(yRange.min, original.y))
  return {
    viewCenter: { x, y },
    hitX: Math.abs(x - original.x) > 1e-6,
    hitY: Math.abs(y - original.y) > 1e-6,
    bounds,
    xRange,
    yRange,
  }
}

export function getCenteredMapViewCenter({ config, bounds = getMapWorldBounds(config), zoom, viewport }) {
  if (!bounds) return { x: 0, y: 0 }
  const centerX = (bounds.minX + bounds.maxX) / 2
  const centerY = (bounds.minY + bounds.maxY) / 2
  return {
    x: (Number(viewport?.w) || 0) / 2 - centerX * zoom,
    y: (Number(viewport?.h) || 0) / 2 - centerY * zoom,
  }
}

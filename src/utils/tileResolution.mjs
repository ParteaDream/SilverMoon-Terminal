export function getTileRequestWidth({ tileSize, zoom, devicePixelRatio = 1 }) {
  const sourceWidth = Math.max(1, Math.round(Number(tileSize) || 512))
  const screenWidth = sourceWidth
    * Math.max(Number(zoom) || 0, 0.01)
    * Math.max(Number(devicePixelRatio) || 1, 1)
  const tiers = [256, 512, 1024, 1536, 2048, 3072, 4096]
  const tier = tiers.find(width => width >= screenWidth) || sourceWidth
  const requested = Math.min(sourceWidth, tier)
  return requested >= sourceWidth * 0.9 ? 0 : requested
}

export function getTilePreloadRequestWidth({
  tileSize,
  zoom,
  devicePixelRatio = 1,
  useFullImage = false,
  fullImageThreshold = 0,
  switchHysteresis = 1.08,
}) {
  const requestZoom = useFullImage
    ? Math.max(
        Number(zoom) || 0,
        (Number(fullImageThreshold) || 0) * switchHysteresis,
      )
    : zoom
  return getTileRequestWidth({ tileSize, zoom: requestZoom, devicePixelRatio })
}

export function getVisibleTileLimit({
  tileSize,
  zoom,
  devicePixelRatio = 1,
  decodedPixelBudget = 64_000_000,
}) {
  const sourceWidth = Math.max(1, Math.round(Number(tileSize) || 512))
  const requestedWidth = getTileRequestWidth({
    tileSize: sourceWidth,
    zoom,
    devicePixelRatio,
  })
  const decodedWidth = requestedWidth || sourceWidth
  const budget = Math.max(decodedWidth * decodedWidth, Number(decodedPixelBudget) || 0)
  return Math.max(12, Math.min(120, Math.floor(budget / (decodedWidth * decodedWidth))))
}

export function tileCacheSatisfies(entry, requestedWidth, tileSize) {
  if (!entry) return false
  if (typeof entry === 'string') return true
  const required = requestedWidth || tileSize
  return (entry.width || tileSize) >= required
}

export function getPendingTileRequestWidth({ entry, wantedWidth, tileSize }) {
  const wanted = Math.max(0, Number(wantedWidth) || 0)
  if (wanted === 0) return null
  const requestedWidth = wanted >= tileSize ? 0 : wanted
  return tileCacheSatisfies(entry, requestedWidth, tileSize)
    ? null
    : requestedWidth
}

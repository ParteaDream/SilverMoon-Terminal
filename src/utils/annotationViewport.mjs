export const ANNOTATION_OVERSCAN_PX = 600
export const ANNOTATION_GUARD_PX = 260

function getVisibleWorldBounds({ viewCenter, zoom, viewport }) {
  const scale = Math.max(Number(zoom) || 0, 0.0001)
  const x = Number(viewCenter?.x) || 0
  const y = Number(viewCenter?.y) || 0
  const width = Math.max(0, Number(viewport?.w) || 0)
  const height = Math.max(0, Number(viewport?.h) || 0)
  return {
    left: -x / scale,
    right: (width - x) / scale,
    top: -y / scale,
    bottom: (height - y) / scale,
  }
}

export function createAnnotationWindow({
  viewCenter,
  zoom,
  viewport,
  overscanPx = ANNOTATION_OVERSCAN_PX,
}) {
  const scale = Math.max(Number(zoom) || 0, 0.0001)
  const visible = getVisibleWorldBounds({ viewCenter, zoom: scale, viewport })
  const overscanWorld = Math.max(0, Number(overscanPx) || 0) / scale
  return {
    left: visible.left - overscanWorld,
    right: visible.right + overscanWorld,
    top: visible.top - overscanWorld,
    bottom: visible.bottom + overscanWorld,
    zoom: scale,
  }
}

export function needsAnnotationWindowRefresh({
  annotationWindow,
  viewCenter,
  zoom,
  viewport,
  guardPx = ANNOTATION_GUARD_PX,
}) {
  if (!annotationWindow) return true
  const scale = Math.max(Number(zoom) || 0, 0.0001)
  const visible = getVisibleWorldBounds({ viewCenter, zoom: scale, viewport })
  const guardWorld = Math.max(0, Number(guardPx) || 0) / scale
  return (
    visible.left < annotationWindow.left + guardWorld
    || visible.right > annotationWindow.right - guardWorld
    || visible.top < annotationWindow.top + guardWorld
    || visible.bottom > annotationWindow.bottom - guardWorld
  )
}

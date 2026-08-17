import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, memo } from 'react'
import { createPortal } from 'react-dom'
import { useDb } from '../context/DbContext'
import MapCalibration from './MapCalibration'
import MarkerCreatorModal from './MarkerCreatorModal'
import TextboxCreatorModal from './TextboxCreatorModal'
import LayerMapModal from './LayerMapModal'
import PlacementEditor from './PlacementEditor'
import Lightbox from './Lightbox'
import { createIdleQueue } from '../utils/idleLoader'
import { buildMarkerOverlapGroups } from '../utils/markerOverlap.mjs'
import {
  constrainMapViewCenter,
  getCenteredMapViewCenter,
} from '../utils/mapViewport.mjs'
import {
  createAnnotationWindow,
  needsAnnotationWindowRefresh,
} from '../utils/annotationViewport.mjs'
import {
  getPendingTileRequestWidth,
  getTilePreloadRequestWidth,
  getVisibleTileLimit,
  tileCacheSatisfies,
} from '../utils/tileResolution.mjs'
import {
  Compass, Map as MapIcon, Plus, Settings, Layers,
  ZoomIn, ZoomOut, Crosshair, Type, Pin, Image,
  ArrowLeft, ArrowRight, ChevronDown, Grid3x3, X,
  Eye, EyeOff,
} from 'lucide-react'
import { useNav } from '../context/NavContext'

// ═══════════════════════════════════════
// 常量
// ═══════════════════════════════════════
const TILE_SIZE = 512                     // 切片尺寸兜底（旧地图无 config.tileSize 时使用）
const DECODED_TILE_PIXEL_BUDGET = 32_000_000 // 约 128MB RGBA，仅保留最近可视切片
const TILE_CACHE_ENCODED_BUDGET = 192 * 1024 * 1024

// 最大有效缩放：至少保留 4 倍（原行为）。高倍缩放到原图 1:1 时已达源像素上限，
// 再往上只是放大无细节的源像素。旧地图未存 maxNativeZoom 时按 scale 现算兜底。
function getMaxNativeZoom(config) {
  const scale = Number(config?.scale) || 0
  return scale > 0 ? Math.max(4, 1 / scale) : 4
}
function clampZoomToNative(z, config) {
  return Math.max(0.01, Math.min(Number(z) || 1, getMaxNativeZoom(config)))
}

// ── 标点类型中文映射 ──
const MARKER_TYPE_ZH = {
  sign: '记号', teleport: '传送点', statue: '神像',
  landmark: '地标', enemy: '敌人', other: '其他', circle: '圆形', normal: '普通',
}

// ── 标点管理器的固定类型顺序（空类型也显示） ──
const FIXED_CATEGORIES = ['statue', 'teleport', 'landmark', 'sign', 'enemy', 'other']


// ═══════════════════════════════════════
// 切片图片组件（React.memo 避免不必要的重渲染）
//
// 坐标体系：切片层使用「切片像素空间」——每片占据 outPx×outPx 整数像素，
// 相邻切片严格相邻（无重叠、无拉伸），世界↔像素换算由外层统一
// transform: scale(tileSize/outPx) 完成。任何 ±1px 的叠压/拉伸都会在接缝处
// 产生 ±1 源像素的双影/错位；整数严格相邻 + 单次统一变换才是像素级无缝。
// 旧地图（tileSize=512、输出 512px）scale=1，同一公式自动兼容。
// ═══════════════════════════════════════
const TileImage = memo(({ src, worldCol, worldRow, outPx }) => {
  if (!src) return null
  return (
    <img
      src={src}
      alt={`tile ${worldRow}_${worldCol}`}
      decoding="async"
      className="absolute no-fade-in"
      onDragStart={(e) => e.preventDefault()}
      style={{
        left: worldCol * outPx,
        top: worldRow * outPx,
        width: outPx,
        height: outPx,
        maxWidth: 'none',
        opacity: 1,
        zIndex: 1,
      }}
      draggable={false}
    />
  )
})

// 切片发布使用自己的局部 revision。新增/升级切片时只重渲染这一层，
// 不让 560+ 标点与文本框跟着每个切片批次重新走一遍 React render。
// 拖拽/惯性期间从 dragLiveTilesRef 取实时可见切片，仅本层随视口移动重渲染，
// 使进入视口的切片在拖拽过程中即可挂载并显示，无需等松手。
const TileLayer = memo(({
  visibleTiles,
  publishedCacheRef,
  mapConfigRef,
  tileLayerReady,
  refreshRef,
  commitAckRef,
  dragLiveTilesRef,
  isDraggingRef,
  inertiaRunningRef,
}) => {
  const [, setRevision] = useState(0)
  useLayoutEffect(() => {
    const refresh = () => setRevision(value => value + 1)
    refreshRef.current = refresh
    return () => {
      if (refreshRef.current === refresh) refreshRef.current = null
    }
  }, [refreshRef])
  useLayoutEffect(() => {
    commitAckRef.current?.()
  })

  // 切片输出像素（世界单位/片 ÷ 世界单位/像素）。新地图 = srcPxPerTile，
  // 旧地图无该字段时回退到 tileSize（旧切片输出 = 世界尺寸）。
  const outPx = mapConfigRef.current?.srcPxPerTile || mapConfigRef.current?.tileSize || TILE_SIZE
  // 交互移动期间（React state 不更新）用实时 ref 切片集合渲染
  const liveTiles = (isDraggingRef.current || inertiaRunningRef.current)
    ? (dragLiveTilesRef.current || visibleTiles)
    : visibleTiles
  return (
    <div style={{
      position: 'relative',
      // 不再在 10% 节点整层显现。接近阈值时，已解码切片直接逐片覆盖
      // 在常驻全图上；否则 Chromium 可能把所有纹理上传集中到 opacity 0→1。
      opacity: tileLayerReady ? 1 : 0,
      willChange: 'opacity',
      pointerEvents: 'none',
    }}>
      {liveTiles.map(({ worldRow, worldCol }) => {
        const key = `${worldRow}_${worldCol}`
        const cached = publishedCacheRef.current.get(key)
        const src = typeof cached === 'string' ? cached : cached?.data
        return (
          <TileImage
            key={key}
            src={src}
            worldCol={worldCol}
            worldRow={worldRow}
            outPx={outPx}
          />
        )
      })}
    </div>
  )
})

async function preloadDecodedImage(src) {
  if (!src || typeof window === 'undefined' || typeof window.Image !== 'function') return null
  const image = new window.Image()
  image.decoding = 'async'
  image.src = src
  try {
    if (typeof image.decode === 'function') await image.decode()
  } catch (_) {
    // 保留原始 src；极少数格式不支持 decode() 时仍交给 <img> 正常加载。
  }
  return image
}

function retainDecodedTile(preloads, key, image, width) {
  if (!image) return
  preloads.delete(key)
  preloads.set(key, {
    image,
    pixels: Math.max(1, Number(width) || 1) ** 2,
  })

  let retainedPixels = 0
  for (const entry of preloads.values()) retainedPixels += entry.pixels
  while (retainedPixels > DECODED_TILE_PIXEL_BUDGET && preloads.size > 1) {
    const oldestKey = preloads.keys().next().value
    const oldest = preloads.get(oldestKey)
    preloads.delete(oldestKey)
    retainedPixels -= oldest?.pixels || 0
  }
}

function getTileCacheBytes(cache) {
  let bytes = 0
  for (const entry of cache.values()) {
    if (typeof entry === 'string') bytes += entry.length
    else bytes += entry?.byteSize || entry?.data?.length || 0
  }
  return bytes
}

// ═══════════════════════════════════════
// 全图图片组件（React.memo，始终显示在底层，消除切换时的黑色区块）
// ═══════════════════════════════════════
const FullMapImage = memo(({ fullImageSrc, anchorA, scale, mapW, mapH, opacity = 1 }) => {
  const ax = anchorA?.[0] || 0
  const ay = anchorA?.[1] || 0
  const sc = scale || 1
  const fullLeft = -ax * sc
  const fullTop = -ay * sc
  const fullW = (mapW || 0) * sc
  const fullH = (mapH || 0) * sc
  return (
    <img
      src={fullImageSrc}
      alt="full-map"
      decoding="async"
      className="absolute"
      onDragStart={(e) => e.preventDefault()}
      style={{
        left: fullLeft,
        top: fullTop,
        width: fullW,
        height: fullH,
        maxWidth: 'none',
        opacity: 1,              // 始终常驻底层，切片覆盖在其上
        zIndex: 0,
        pointerEvents: 'none',
      }}
      draggable={false}
    />
  )
})


// ═══════════════════════════════════════
// tooltip 详情内容渲染（顺序：图片 → 正文 → 圣遗物 → 材料 → 怪物）
// catalog: { artifacts: Map<id, {name, image}>, materials: Map<id, {name, image}> }
// onJump(kind, id): kind = 'artifact' | 'material'
// ═══════════════════════════════════════
const TooltipSections = memo(({ tooltip, catalog, onJump, onImageClick, compact = false }) => {
  if (!tooltip) return null
  const artifacts = Array.isArray(tooltip.artifacts) ? tooltip.artifacts : []
  const materials = Array.isArray(tooltip.materials) ? tooltip.materials : []
  // 怪物支持多条（monsters 数组）；兼容旧数据单条（monster 对象）
  const monsters = Array.isArray(tooltip.monsters)
    ? tooltip.monsters
    : (tooltip.monster ? [tooltip.monster] : [])
  // 图片支持多张（images 数组）；兼容旧数据单张（image）
  const images = Array.isArray(tooltip.images) && tooltip.images.length > 0
    ? tooltip.images.filter(Boolean)
    : (tooltip.image ? [tooltip.image] : [])
  return (
    <>
      {images.length > 0 && (
        <div className={compact ? 'mb-2 flex flex-wrap items-start gap-1.5' : 'space-y-2 mb-3'}>
          {images.map((img, idx) => (
            <img key={idx} src={`local-media://${(img || '').trim()}`}
              onClick={!compact && onImageClick ? (e) => { e.stopPropagation(); onImageClick(img) } : undefined}
              className={compact
                ? `rounded-lg border border-white/10 bg-surface-900/60 object-contain ${
                    images.length === 1 ? 'max-w-full max-h-44' : 'max-w-[45%] max-h-28'
                  }`
                : 'w-full max-h-72 rounded-xl object-cover cursor-zoom-in hover:ring-2 hover:ring-amber-500/50 transition-shadow'}
              draggable={false} />
          ))}
        </div>
      )}
      {tooltip.body ? (
        <p className={compact ? 'text-[10px] text-surface-400 leading-relaxed whitespace-pre-wrap' : 'text-sm text-surface-300 whitespace-pre-wrap leading-relaxed'}>{tooltip.body}</p>
      ) : null}

      {/* 关联圣遗物（套装图片 + 名称，点击跳转词条） */}
      {artifacts.length > 0 && (
        <div className={compact ? '' : 'mt-3'}>
          <p className="text-[9px] text-surface-500 mb-1.5 flex items-center gap-1">⚙ 关联圣遗物</p>
          <div className="flex flex-wrap gap-1.5">
            {artifacts.map(id => {
              const a = catalog?.artifacts?.get(id)
              if (!a) return null
              return (
                <button key={id} onClick={(e) => { e.stopPropagation(); onJump?.('artifact', id) }}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded-lg bg-surface-800/80 border border-white/10 hover:border-amber-500/50 hover:bg-surface-800 transition-colors ${compact ? '' : 'pointer-events-auto'}`}
                  title={`跳转到「${a.name}」词条`}>
                  {a.image && <img src={`local-media://${(a.image || '').trim()}`} className="w-5 h-5 rounded object-cover shrink-0" draggable={false} />}
                  <span className="text-[10px] text-surface-200">{a.name}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* 关联材料（图片 + 名称，点击跳转词条） */}
      {materials.length > 0 && (
        <div className={compact ? '' : 'mt-3'}>
          <p className="text-[9px] text-surface-500 mb-1.5 flex items-center gap-1">📦 关联材料</p>
          <div className="flex flex-wrap gap-1.5">
            {materials.map(id => {
              const m = catalog?.materials?.get(id)
              if (!m) return null
              return (
                <button key={id} onClick={(e) => { e.stopPropagation(); onJump?.('material', id) }}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded-lg bg-surface-800/80 border border-white/10 hover:border-amber-500/50 hover:bg-surface-800 transition-colors ${compact ? '' : 'pointer-events-auto'}`}
                  title={`跳转到「${m.name}」词条`}>
                  {m.image && <img src={`local-media://${(m.image || '').trim()}`} className="w-5 h-5 rounded object-cover shrink-0" draggable={false} />}
                  <span className="text-[10px] text-surface-200">{m.name}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* 怪物信息（多条；图片支持多张，点击可打开图片观看器） */}
      {monsters.filter(m => m && (m.name || m.images?.length || m.image || m.description)).length > 0 && (
        <div className={compact ? '' : 'mt-3'}>
          <p className="text-[9px] text-surface-500 mb-1.5 flex items-center gap-1">👾 怪物信息</p>
          <div className="space-y-2">
            {monsters.map((monster, mi) => {
              if (!monster || (!monster.name && !monster.images?.length && !monster.image && !monster.description)) return null
              // 图片支持多张（images 数组）；兼容旧数据单张（image）
              const mImages = Array.isArray(monster.images) && monster.images.length > 0
                ? monster.images.filter(Boolean)
                : (monster.image ? [monster.image] : [])
              const imgBaseCls = 'rounded-lg object-contain shrink-0 bg-surface-900/60 border border-white/10'
              // 详情弹窗中可点击打开图片观看器（悬停浮层不可交互，保持原样）
              const imgClick = !compact && onImageClick
                ? (e, img) => { e.stopPropagation(); onImageClick(img) }
                : undefined
              return (
                <div key={mi} className="rounded-lg bg-surface-800/40 border border-white/5 p-2">
                  {/* 多图：缩略图网格排布在文本上方 */}
                  {mImages.length > 1 && (
                    <div className="flex flex-wrap gap-1.5 mb-1.5">
                      {mImages.map((img, ii) => (
                        <img key={ii} src={`local-media://${(img || '').trim()}`}
                          onClick={imgClick ? (e) => imgClick(e, img) : undefined}
                          className={`${imgBaseCls} ${compact ? 'w-11 h-11' : 'w-14 h-14 cursor-zoom-in hover:ring-2 hover:ring-amber-500/50 transition-shadow'}`}
                          draggable={false} />
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2 items-start">
                    {/* 单图：与文本并排 */}
                    {mImages.length === 1 && (
                      <img src={`local-media://${(mImages[0] || '').trim()}`}
                        onClick={imgClick ? (e) => imgClick(e, mImages[0]) : undefined}
                        className={`${imgBaseCls} ${compact ? 'max-w-14 max-h-14' : 'max-w-20 max-h-20 cursor-zoom-in hover:ring-2 hover:ring-amber-500/50 transition-shadow'}`}
                        draggable={false} />
                    )}
                    <div className="min-w-0 flex-1">
                      {monster.name && <p className="text-[11px] font-medium text-surface-200">{monster.name}</p>}
                      {monster.description && (
                        <p className={compact ? 'text-[10px] text-surface-400 leading-relaxed mt-0.5 whitespace-pre-wrap' : 'text-xs text-surface-400 leading-relaxed mt-1 whitespace-pre-wrap'}>{monster.description}</p>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </>
  )
})

// ═══════════════════════════════════════
// 标点网格（React.memo：隐藏/视口外标点已由上层预过滤，
// 仅当数据/缩放/交互状态变化时才重渲染，拖拽平移与切片加载期间零触碰）
// ═══════════════════════════════════════
const MarkerGrid = memo(({
  markers,                // [{ pm, template, isBaseMarker }]
  templateMap,            // Map<markerId, template>
  zoom,
  effectiveMarkerSize,
  effectiveLayerHoverZoom,
  layerMode,
  configLayers,
  hoveredLayerId,
  overlapHighlightedId,
  movingMarkerId,
  overlapGroups,          // Map<placementId, group[]>
  devMode,
  currentMapId,
  mapContainerRef,
  zoomRef,
  loadMarkers,
  clampMenuPos,
  setPlacedMarkers,
  setHoveredMarker,
  setHoveredLayerId,
  setMovingMarkerId,
  setOverlapMenu,
  setDetailModal,
  setSidePanel,
  setPlacedMenu,
  setLayerMode,
}) => {
  const getOverlapGroup = useCallback((pm) => {
    return overlapGroups.get(pm.id) || null
  }, [overlapGroups])

  return markers.map(({ pm, template, isBaseMarker, fading = false, fadeIn = false }) => {
    const isCircle = template.marker_type === 'other' || template.marker_type === 'circle'
    const baseSize = effectiveMarkerSize
    const maxWorldSize = Math.max(200, baseSize * 6)
    const effectiveSize = Math.min(baseSize / Math.max(zoom, 0.05), maxWorldSize)
    // 分层地图悬停时标点偏移：沿半径向外移动 5%
    let markerOffX = 0, markerOffY = 0
    const isMarkerLayerHovered = hoveredLayerId && pm.layer_id === hoveredLayerId && (layerMode !== 'G' && layerMode !== 'B' && layerMode !== 'F') && effectiveLayerHoverZoom
    if (isMarkerLayerHovered) {
      const hl = configLayers.find(l => l.id === hoveredLayerId)
      if (hl) {
        markerOffX = (pm.world_x - hl.worldX) * 0.05
        markerOffY = (pm.world_y - hl.worldY) * 0.05
      }
    }
    return (
      <div
        key={pm.id}
        data-memoryhub-marker={pm.id}
        className={`absolute group z-[25] transition-all duration-150 hover:scale-110 hover:z-[999] ${fadeIn && !fading ? 'animate-fade-in' : ''} ${overlapHighlightedId === pm.id ? 'scale-125 z-[999]' : ''}${movingMarkerId === pm.id ? ' cursor-move ring-2 ring-yellow-400/60' : ' cursor-pointer'}${fading ? ' pointer-events-none' : ''}`}
        style={{
          left: pm.world_x - effectiveSize / 2 + markerOffX,
          top: pm.world_y - effectiveSize / 2 + markerOffY,
          width: effectiveSize, height: effectiveSize,
          scale: 'var(--memoryhub-marker-scale, 1)',
          opacity: fading ? 0 : (isBaseMarker ? 0.3 : 1),
          transition: `${effectiveLayerHoverZoom ? 'left 0.2s ease, top 0.2s ease, ' : ''}opacity 0.3s ease, transform 0.15s ease`,
          zIndex: isBaseMarker ? 12 : undefined,
        }}
        draggable={false}
        onMouseEnter={() => {
          setHoveredMarker(pm)
          if (pm.layer_id && layerMode !== 'G' && layerMode !== 'B' && layerMode !== 'F' && effectiveLayerHoverZoom) {
            setHoveredLayerId(pm.layer_id)
          }
        }}
        onMouseLeave={() => {
          setHoveredMarker(null)
          setHoveredLayerId(null)
        }}
        onMouseDown={movingMarkerId === pm.id ? (e) => {
          e.stopPropagation()
          const mapRect = mapContainerRef.current.getBoundingClientRect()
          const z = zoomRef.current
          const origX = pm.world_x
          const origY = pm.world_y
          const startX = e.clientX, startY = e.clientY
          const dragPos = { x: origX, y: origY }
          const onMove = (ev) => {
            const dx = (ev.clientX - startX) / z
            const dy = (ev.clientY - startY) / z
            dragPos.x = origX + dx
            dragPos.y = origY + dy
            // 视觉上实时更新（通过 React 重渲染）
            setPlacedMarkers(prev => prev.map(p =>
              p.id === pm.id ? { ...p, world_x: origX + dx, world_y: origY + dy } : p
            ))
          }
          const onUp = async () => {
            window.removeEventListener('mousemove', onMove)
            window.removeEventListener('mouseup', onUp)
            // 保存最终位置（使用 dragPos ref 避免闭包陈旧值）
            const pos = dragPos
            await window.electronAPI?.mapExecBaseline(
              "UPDATE map_marker_placements SET world_x = ?, world_y = ? WHERE id = ?",
              [pos.x, pos.y, pm.id]
            ).catch(() => {})
            loadMarkers(currentMapId)
            setMovingMarkerId(null)
          }
          window.addEventListener('mousemove', onMove)
          window.addEventListener('mouseup', onUp)
        } : undefined}
        onClick={(e) => {
          const group = getOverlapGroup(pm)
          if (group && group.length > 1) {
            e.stopPropagation()
            const pos = clampMenuPos(e.clientX, e.clientY, 200, Math.min(group.length * 44 + 60, 320))
            setOverlapMenu({ markers: group, worldX: pm.world_x, worldY: pm.world_y, screenX: pos.x, screenY: pos.y })
            return
          }
          // G/B/F 模式下点击有所属分层的标点 → 切换到对应具体层级
          if ((layerMode === 'G' || layerMode === 'B' || layerMode === 'F') && pm.subscript === '1' && pm.layer_id) {
            e.stopPropagation()
            const layer = configLayers.find(l => l.id === pm.layer_id)
            if (layer) {
              setLayerMode(layer.level)
              return
            }
          }
          const sfRaw = pm.special_function || pm.template_special
          if (sfRaw) {
            try {
              const sf = typeof sfRaw === 'string' ? JSON.parse(sfRaw) : sfRaw
              if (sf.type === 'switch_map') {
                if (sf.image) window.electronAPI?.readImage(sf.image, 256).then(r => { if (r?.success) setSidePanel(prev => ({ ...prev, sfImage: r.data })) })
                setSidePanel({
                  targetMapId: sf.map_id,
                  name: template.name_zh || '',
                  customName: pm.custom_name || '',
                  markerImage: template.image_filename || null,
                  sfImage: null,
                  description: sf.description || '',
                })
              } else if (sf.type === 'tooltip') {
                e.stopPropagation()
                // 如果有所属层级且不在当前层级，优先切换
                if (pm.layer_id) {
                  const layer = configLayers.find(l => l.id === pm.layer_id)
                  if (layer && layer.level !== layerMode) {
                    setLayerMode(layer.level)
                    return
                  }
                }
                // 在对应层级（或无层级）时打开详情弹窗
                setDetailModal({
                  name: pm.custom_name || template.name_zh || '未命名',
                  imageFilename: template.image_filename || null,
                  detailImage: sf.image || sf.tooltip?.image || null,
                  body: sf.tooltip?.body || '',
                  tooltip: {
                    ...(sf.tooltip || {}),
                    image: sf.image || sf.tooltip?.image || null,
                    // 多图兼容：tooltip.images 缺省时由旧字段（sf.image / tooltip.image）回退
                    images: Array.isArray(sf.tooltip?.images) && sf.tooltip.images.length > 0
                      ? sf.tooltip.images
                      : ((sf.image || sf.tooltip?.image) ? [sf.image || sf.tooltip.image] : []),
                  },
                })
              }
            } catch (_) {}
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault(); e.stopPropagation()
          if (!devMode && Number(pm.created_by_dev) === 1) return
          const pos = clampMenuPos(e.clientX, e.clientY, 144, 80)
          setPlacedMenu({ pm, x: pos.x, y: pos.y })
        }}
        title={template.name_zh || ''}
      >
        {/* ── 标点底盘 ── */}
        {template.base_config && (() => {
          try {
            const bc = typeof template.base_config === 'string' ? JSON.parse(template.base_config) : template.base_config
            if (!bc || bc.baseType === 'none') return null
            const baseSz = effectiveSize * (bc.baseScale || 1.30) * Math.SQRT1_2
            const offset = (effectiveSize - baseSz) / 2
            const bwRaw = bc.baseBorderWidth ?? 2
            // 屏幕边框恒定 = bwRaw 像素：世界坐标 bw = bwRaw/zoom 抵消外层缩放
            const bw = bwRaw > 0 ? bwRaw / Math.max(zoom, 0.05) : 0
            // 方框圆角同样用世界坐标抵消外层 scale(zoom)，保证屏幕圆角恒定 6px
            // （否则放大时 6px 被放大成 6×zoom，方框会逐渐变成圆形）
            const cornerRadius = bc.baseType === 'square' ? `${6 / Math.max(zoom, 0.05)}px` : '0'
            const shapeStyle = {
              borderRadius: bc.baseType === 'circle' ? '50%' : cornerRadius,
              transform: bc.baseType === 'diamond' ? 'rotate(45deg)' : 'none',
            }
            return (
              <>
                <div className="absolute" style={{ left: offset, top: offset, width: baseSz, height: baseSz, backgroundColor: bc.baseFillColor || '#E4E4E2', ...shapeStyle, zIndex: 0, pointerEvents: 'none' }} />
                <div className="absolute overflow-hidden" style={{ left: offset, top: offset, width: baseSz, height: baseSz, borderRadius: bc.baseType === 'circle' ? '50%' : cornerRadius, zIndex: 1, pointerEvents: 'none' }}>
                  {template.image_filename ? <img src={`local-media://${(template.image_filename || '').trim()}`} className="w-full h-full object-cover" decoding="async" draggable={false} /> : <div className="w-full h-full" />}
                </div>
                <div className="absolute" style={{ left: offset, top: offset, width: baseSz, height: baseSz, backgroundColor: 'transparent', border: `${bw}px solid black`, boxShadow: `0 0 0 ${bw}px ${bc.baseBorderColor || '#3375DD'} inset`, ...shapeStyle, zIndex: 2, pointerEvents: 'none' }} />
              </>
            )
          } catch { return null }
        })()}
        {(() => {
          const _hasBase = template.base_config && (() => { try { const _bc = typeof template.base_config === 'string' ? JSON.parse(template.base_config) : template.base_config; return _bc.baseType !== 'none' } catch { return false } })()
          if (_hasBase) return null
          return isCircle ? (
            <div className="w-full h-full rounded-full border-2 flex items-center justify-center overflow-hidden" style={{ borderColor: 'var(--primary-500, #f59e0b)', position: 'relative', zIndex: 1 }}>
              {template.image_filename ? <img src={`local-media://${(template.image_filename || '').trim()}`} className="w-full h-full object-cover" style={{ borderRadius: '50%' }} decoding="async" draggable={false} /> : <div className="w-5 h-5 rounded-full bg-primary-500/30" />}
            </div>
          ) : (
            <div className="w-full h-full overflow-hidden" style={{ position: 'relative', zIndex: 1, borderRadius: `${8 / Math.max(zoom, 0.05)}px` }}>
              {template.image_filename ? <img src={`local-media://${(template.image_filename || '').trim()}`} className="w-full h-full object-cover" decoding="async" draggable={false} /> : <div className="w-full h-full bg-primary-500/30 border border-primary-500/50" style={{ borderRadius: `${8 / Math.max(zoom, 0.05)}px` }} />}
            </div>
          )
        })()}
        {/* 下标标记 */}
        {pm.subscript === '1' || pm.subscript === 1 ? (() => {
          const subSize = Math.min(effectiveSize * 0.45, maxWorldSize * 0.45)
          const iconSize = subSize * 0.625
          const isInSpecificLayer = layerMode !== 'G' && layerMode !== 'B' && layerMode !== 'F'
          const isActiveLayer = isInSpecificLayer && pm.layer_id && configLayers.some(l => l.id === pm.layer_id && l.level === layerMode)
          return (
            <div className={`absolute rounded-full flex items-center justify-center z-30 transition-colors duration-200 ${isActiveLayer ? 'border border-white/40' : 'border border-white/30'}`}
              style={{
                width: subSize, height: subSize,
                right: -subSize * 0.25, bottom: -subSize * 0.25,
                boxShadow: '0 1px 3px rgba(0,0,0,0.5)',
                backgroundColor: isActiveLayer ? '#70EFF9' : '#000000',
              }}>
              <Layers className="text-white" style={{ width: iconSize, height: iconSize }} />
            </div>
          )
        })() : null}
      </div>
    )
  })
})

// ═══════════════════════════════════════
// 文本框网格（React.memo，与标点网格同一套预过滤+窗口策略）
// ═══════════════════════════════════════
const TextboxGrid = memo(({
  markers,                // [{ tb, isBaseMarker }]
  zoom,
  effectiveTextboxFontSizes,
  effectiveLayerHoverZoom,
  layerMode,
  configLayers,
  hoveredLayerId,
  devMode,
  movingTextboxId,
  currentMapId,
  viewCenterRef,
  mapContainerRef,
  zoomRef,
  setHoveredLayerId,
  setTextboxMenu,
  loadMarkers,
  clampMenuPos,
}) => {
  return markers.map(({ tb, isBaseMarker, fading = false, fadeIn = false }) => {
    // 分层地图悬停时文本框偏移
    let tbOffX = 0, tbOffY = 0
    const isTbLayerHovered = hoveredLayerId && tb.layer_id === hoveredLayerId && (layerMode !== 'G' && layerMode !== 'B' && layerMode !== 'F') && effectiveLayerHoverZoom
    if (isTbLayerHovered) {
      const hl = configLayers.find(l => l.id === hoveredLayerId)
      if (hl) {
        tbOffX = (tb.world_x - hl.worldX) * 0.05
        tbOffY = (tb.world_y - hl.worldY) * 0.05
      }
    }
    return (
      <div
        key={tb.id}
        data-memoryhub-textbox={tb.id}
        className={`absolute whitespace-nowrap font-bold text-white leading-none ${fadeIn && !fading ? 'animate-fade-in' : ''}${devMode ? ' pointer-events-auto' : ' pointer-events-none'}${movingTextboxId === tb.id ? ' cursor-move ring-2 ring-yellow-400/60' : ''}${fading ? ' pointer-events-none' : ''}`}
        style={{ left: tb.world_x + tbOffX, top: tb.world_y + tbOffY, opacity: fading ? 0 : (isBaseMarker ? 0.3 : 1), zIndex: isBaseMarker ? 12 : (tb.layer_id ? 22 : 15), transform: 'translate(-50%, -50%) scale(var(--memoryhub-text-scale, 1))', fontSize: (() => {
          const baseFs = effectiveTextboxFontSizes?.[tb.level] ?? 12
          return baseFs / Math.max(zoom, 0.05)
        })(), textShadow: '0 -0.06em 0.03em rgba(60,60,60,0.75), 0 0.06em 0.03em rgba(60,60,60,0.75), -0.06em 0 0.03em rgba(60,60,60,0.75), 0.06em 0 0.03em rgba(60,60,60,0.75)', transition: `${effectiveLayerHoverZoom ? 'left 0.2s ease, top 0.2s ease, ' : ''}opacity 0.3s ease` }}
        onMouseEnter={() => {
          if (tb.layer_id && layerMode !== 'G' && layerMode !== 'B' && layerMode !== 'F' && effectiveLayerHoverZoom) {
            setHoveredLayerId(tb.layer_id)
          }
        }}
        onMouseLeave={() => setHoveredLayerId(null)}
        onMouseDown={devMode && movingTextboxId === tb.id ? (e) => {
          e.stopPropagation()
          const el = e.currentTarget
          const startX = e.clientX, startY = e.clientY
          // 用 getBoundingClientRect 反算当前世界坐标（考虑 map transform）
          const mapRect = mapContainerRef.current.getBoundingClientRect()
          const elRect = el.getBoundingClientRect()
          const z = zoomRef.current
          // el 中心的世界坐标 = (el 中心屏幕坐标 - map 偏移 - viewCenter) / zoom
          const origX = (elRect.left + elRect.width / 2 - mapRect.left - viewCenterRef.current.x) / z
          const origY = (elRect.top + elRect.height / 2 - mapRect.top - viewCenterRef.current.y) / z
          const onMove = (ev) => {
            const dx = (ev.clientX - startX) / z
            const dy = (ev.clientY - startY) / z
            el.style.left = (origX + dx) + 'px'
            el.style.top = (origY + dy) + 'px'
          }
          const onUp = async (ev) => {
            window.removeEventListener('mousemove', onMove)
            window.removeEventListener('mouseup', onUp)
            const dx = (ev.clientX - startX) / z
            const dy = (ev.clientY - startY) / z
            try {
              await window.electronAPI?.mapUpdateTextbox(tb.id, { world_x: origX + dx, world_y: origY + dy })
              loadMarkers(currentMapId)
            } catch (_) {}
          }
          window.addEventListener('mousemove', onMove)
          window.addEventListener('mouseup', onUp)
        } : undefined}
        onContextMenu={devMode ? (e) => {
          e.preventDefault(); e.stopPropagation()
          const pos = clampMenuPos(e.clientX, e.clientY, 144, 80)
          setTextboxMenu({ tb, x: pos.x, y: pos.y })
        } : undefined}
      >
        {tb.text}
      </div>
    )
  })
})


// ═══════════════════════════════════════
// 摹忆中枢 — 原神大地图
// ═══════════════════════════════════════
export default function MemoryHub() {
  const { devMode } = useDb()
  const [maps, setMaps] = useState([])            // 所有地图列表
  const [currentMapId, setCurrentMapId] = useState(null) // 当前地图 ID
  const [mapConfig, setMapConfig] = useState(null)       // 当前地图配置
  const [zoom, setZoom] = useState(1)              // 当前缩放（0.25~4）
  const [viewCenter, setViewCenter] = useState({ x: 0, y: 0 }) // 世界坐标到屏幕坐标的平移量
  const [annotationWindow, setAnnotationWindow] = useState(() => createAnnotationWindow({
    viewCenter: { x: 0, y: 0 },
    zoom: 1,
    viewport: { w: 800, h: 600 },
  }))
  const [isDragging, setIsDragging] = useState(false)
  const [tileRemaining, setTileRemaining] = useState(0)
  const tileRemainingRef = useRef(0)
  const [showMapMenu, setShowMapMenu] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [scaleRatio, setScaleRatio] = useState('1.0')
  const [loading, setLoading] = useState(true)
  const [slicing, setSlicing] = useState(false)
  const [sliceProgress, setSliceProgress] = useState('')

  // ── 标定状态 ──
  const [calibration, setCalibration] = useState(null) // { previewData, previewW, previewH, imageW, imageH, srcPath }

  const mapContainerRef = useRef(null)
  const mapTransformRef = useRef(null)
  const applyLiveTransformRef = useRef(null)

  // ── 右键菜单位置边界翻转（菜单通过 Portal 在 body 中，直接用 window 边界） ──
  const clampMenuPos = useCallback((clientX, clientY, menuW, menuH) => {
    const vw = window.innerWidth, vh = window.innerHeight
    let x = clientX, y = clientY
    if (x + menuW > vw) x = clientX - menuW
    if (y + menuH > vh) y = clientY - menuH
    return { x: Math.max(0, x), y: Math.max(0, y) }
  }, [])
  const dragStart = useRef({ x: 0, y: 0 })
  const dragStartMouseRef = useRef({ x: 0, y: 0 })  // 鼠标按下时的屏幕坐标（惯性回退计算用）
  const dragStartTimeRef = useRef(0)                 // 鼠标按下时的时间戳
  const tileCache = useRef(new Map())       // "row_col" → base64
  const publishedTileCacheRef = useRef(new Map()) // 仅这里的条目允许进入 DOM
  const tilePublishQueueRef = useRef(new Map())
  const tilePublishRafRef = useRef(null)
  const tilePublishAwaitingCommitRef = useRef(false)
  const tilePublishedBatchKeysRef = useRef([])
  const tileLayerRefreshRef = useRef(null)
  const tileLayerCommitAckRef = useRef(null)
  const actualVisibleTileKeysRef = useRef(new Set())
  const decodedTilePreloadsRef = useRef(new Map()) // 仅保留到对应 React 提交完成
  const loadingTiles = useRef(new Map())     // "row_col" → 在途请求宽度
  const desiredTileWidthsRef = useRef(new Map()) // "row_col" → 当前视图要求的最高宽度
  const missingTiles = useRef(new Set())     // "row_col" — 确认不存在的切片，不再重试
  const queuedTileKeysRef = useRef(new Set()) // "row_col" — 已推入空闲队列的切片（拖拽期间去重，避免重复入队）
  const dragLiveTilesRef = useRef([])          // 拖拽/惯性期间实时可见切片（供 TileLayer 渲染）
  const dragLiveTilesKeysRef = useRef(new Set()) // 已渲染的实时切片 key 集合（变化时才触发本层重渲染）
  const containerSize = useRef({ w: 800, h: 600 })
  const zoomRef = useRef(zoom)
  const settledZoomRef = useRef(zoom)
  const viewCenterRef = useRef(viewCenter)
  const annotationWindowRef = useRef(annotationWindow)
  const annotationWindowRafRef = useRef(null)
  const isDraggingRef = useRef(false)
  const dragRafRef = useRef(null)
  const wheelRafRef = useRef(null)               // 滚轮缩放 DOM 写入 rAF 节流
  const dragPositionsRef = useRef([])           // 拖拽位置历史（惯性速度计算）
  const dragSpeedRef = useRef({ vx: 0, vy: 0 }) // 拖拽速度 (px/ms)
  const inertiaRafRef = useRef(null)            // 惯性动画 rAF 句柄
  const inertiaRunningRef = useRef(false)       // 惯性动画运行中
  const inertiaEnabledRef = useRef(true)        // 惯性启用（从 config 同步）
  const inertiaFrictionRef = useRef(0.05)       // 摩擦系数（从 config 同步）
  const isZoomingRef = useRef(false)
  const needsReloadRef = useRef(false)
  const initialTileLoadDoneRef = useRef(false)
  const hasLoadedAnyTileRef = useRef(false)
  const zoomTimerRef = useRef(null)
  const delayedTileIdleRef = useRef(null)
  const lastEvictTimeRef = useRef(0)
  const evictPendingRef = useRef(false)
  const evictIdleRef = useRef(null)
  const tileLayerReadyRef = useRef(false)  // 同步 ref，供 loadTile 闭包使用
  const syncDragTileLoadingRef = useRef(null) // 拖拽/惯性期间同步加载视口切片的入口
  const currentMapIdRef = useRef(currentMapId)
  useEffect(() => { currentMapIdRef.current = currentMapId }, [currentMapId])
  const mapGenerationRef = useRef(0)
  const mapConfigRef = useRef(mapConfig)
  useEffect(() => { mapConfigRef.current = mapConfig; if (mapConfig) setTilesTick(t => t + 1) }, [mapConfig])
  const tileQueueRef = useRef(null)

  const constrainViewCenterForMap = useCallback((
    candidate,
    atZoom,
    config = mapConfigRef.current,
    viewport = containerSize.current,
  ) => constrainMapViewCenter({
    candidate,
    zoom: atZoom,
    viewport,
    config,
  }), [])

  const refreshAnnotationWindow = useCallback((
    atZoom,
    atViewCenter,
    {
      force = false,
      immediate = false,
      viewport = containerSize.current,
    } = {},
  ) => {
    const current = annotationWindowRef.current
    if (!force && !needsAnnotationWindowRefresh({
      annotationWindow: current,
      viewCenter: atViewCenter,
      zoom: atZoom,
      viewport,
    })) return false

    const next = createAnnotationWindow({
      viewCenter: atViewCenter,
      zoom: atZoom,
      viewport,
    })
    annotationWindowRef.current = next
    if (immediate) {
      if (annotationWindowRafRef.current !== null) {
        cancelAnimationFrame(annotationWindowRafRef.current)
        annotationWindowRafRef.current = null
      }
      setAnnotationWindow(next)
    } else if (annotationWindowRafRef.current === null) {
      annotationWindowRafRef.current = requestAnimationFrame(() => {
        annotationWindowRafRef.current = null
        setAnnotationWindow(annotationWindowRef.current)
      })
    }
    return true
  }, [])

  const cancelActiveInteraction = useCallback(({ updateState = true } = {}) => {
    const cancelFrame = (ref) => {
      if (ref.current === null) return
      cancelAnimationFrame(ref.current)
      ref.current = null
    }
    cancelFrame(inertiaRafRef)
    cancelFrame(wheelRafRef)
    cancelFrame(dragRafRef)
    cancelFrame(rafViewRef)
    cancelFrame(annotationWindowRafRef)
    cancelFrame(tilePublishRafRef)
    tilePublishAwaitingCommitRef.current = false
    tilePublishedBatchKeysRef.current = []

    if (zoomTimerRef.current !== null) {
      clearTimeout(zoomTimerRef.current)
      zoomTimerRef.current = null
    }
    if (delayedTileIdleRef.current !== null) {
      cancelIdleCallback(delayedTileIdleRef.current)
      delayedTileIdleRef.current = null
    }
    if (evictIdleRef.current !== null) {
      cancelIdleCallback(evictIdleRef.current)
      evictIdleRef.current = null
      evictPendingRef.current = false
    }
    pendingViewRef.current = null
    isDraggingRef.current = false
    isZoomingRef.current = false
    inertiaRunningRef.current = false
    dragPositionsRef.current = []
    dragSpeedRef.current = { vx: 0, vy: 0 }
    desiredTileWidthsRef.current.clear()
    if (updateState) setIsDragging(false)
  }, [])

  const lastTileRemainingUpdate = useRef(0)
  const throttledSetTileRemaining = useCallback((count) => {
    if (initialTileLoadDoneRef.current) return
    if (count === 0) {
      // 0 值强制同步，确保 initialTileLoadDoneRef 能及时触发
      lastTileRemainingUpdate.current = Date.now()
      setTileRemaining(0)
      return
    }
    const now = Date.now()
    if (now - lastTileRemainingUpdate.current < 200) return
    lastTileRemainingUpdate.current = now
    setTileRemaining(count)
  }, [])

  // ── 统一设置 zoom + viewCenter（即时更新 ref，rAF 节流 setState） ──
  const setView = useCallback((newZoom, newVC, config = mapConfigRef.current) => {
    const constrainedVC = constrainViewCenterForMap(newVC, newZoom, config).viewCenter
    zoomRef.current = newZoom
    viewCenterRef.current = constrainedVC
    applyLiveTransformRef.current?.(newZoom, constrainedVC)
    pendingViewRef.current = { zoom: newZoom, vc: constrainedVC }
    if (rafViewRef.current === null) {
      rafViewRef.current = requestAnimationFrame(() => {
        rafViewRef.current = null
        const p = pendingViewRef.current
        if (p) {
          pendingViewRef.current = null
          setZoom(p.zoom)
          setViewCenter(p.vc)
          refreshAnnotationWindow(p.zoom, p.vc, { force: true, immediate: true })
        }
      })
    }
  }, [constrainViewCenterForMap, refreshAnnotationWindow])

  // 将世界坐标（pin 位置）换算为 viewCenter 偏移量
  function worldToViewCenter(wx, wy, z) {
    const rect = mapContainerRef.current?.getBoundingClientRect()
    const cw = rect?.width || containerSize.current.w || 800
    const ch = rect?.height || containerSize.current.h || 600
    return { x: cw / 2 - wx * z, y: ch / 2 - wy * z }
  }
  const [tilesTick, setTilesTick] = useState(0)  // 仅用于触发 visibleTiles 重算（拖拽/缩放结束时递增）
  const [tileLayerReady, setTileLayerReady] = useState(false)  // 首批切片就绪后设为 true，触发切片层显现

  // 已解码切片先进入待发布队列，再按帧少量暴露给 DOM。即使缓存写入在同一时刻
  // 完成，也不会让多张大 PNG 在某次父组件提交中一起触发纹理上传。
  const scheduleTilePublish = useCallback(() => {
    if (
      tilePublishRafRef.current !== null
      || tilePublishAwaitingCommitRef.current
      || isZoomingRef.current
    ) return

    const generation = mapGenerationRef.current
    const flush = () => {
      tilePublishRafRef.current = null
      if (mapGenerationRef.current !== generation) return
      if (isZoomingRef.current) return

      const visibleKeys = actualVisibleTileKeysRef.current
      let publishedCount = 0
      let publishedPixels = 0
      const publishedKeys = []
      for (const [key, queuedEntry] of tilePublishQueueRef.current) {
        const currentEntry = tileCache.current.get(key)
        if (!currentEntry || currentEntry !== queuedEntry || !visibleKeys.has(key)) {
          tilePublishQueueRef.current.delete(key)
          continue
        }

        const entryWidth = Math.max(1, Number(currentEntry.width) || TILE_SIZE)
        const entryPixels = entryWidth * entryWidth
        if (
          publishedCount > 0
          && (publishedCount >= 2 || publishedPixels + entryPixels > 1_250_000)
        ) break

        tilePublishQueueRef.current.delete(key)
        publishedTileCacheRef.current.set(key, currentEntry)
        publishedKeys.push(key)
        publishedCount += 1
        publishedPixels += entryPixels
      }

      if (publishedCount > 0) {
        tilePublishAwaitingCommitRef.current = true
        tilePublishedBatchKeysRef.current = publishedKeys
        if (!tileLayerReadyRef.current) {
          tileLayerReadyRef.current = true
          setTileLayerReady(true)
        }
        const refreshTileLayer = tileLayerRefreshRef.current
        refreshTileLayer?.()
        scheduleEvictDistantTiles()
        // 下一批只能在 TileLayer 的 layout effect 确认本批已提交后继续；
        // 否则 React 18 可能把连续 revision 合并，仍一次挂载多批 PNG。
        return
      }

      if (tilePublishQueueRef.current.size > 0) {
        tilePublishRafRef.current = requestAnimationFrame(flush)
      }
    }

    tilePublishRafRef.current = requestAnimationFrame(flush)
  }, [])
  tileLayerCommitAckRef.current = () => {
    if (!tilePublishAwaitingCommitRef.current) return
    tilePublishAwaitingCommitRef.current = false
    for (const key of tilePublishedBatchKeysRef.current) {
      decodedTilePreloadsRef.current.delete(key)
    }
    tilePublishedBatchKeysRef.current = []
    scheduleTilePublish()
  }

  const [defaultViewActive, setDefaultViewActive] = useState(false)
  const defaultViewRef = useRef(null)
  const defaultViewPinRef = useRef({ x: 0, y: 0, zoom: 1 })
  const defaultViewActiveRef = useRef(false)
  const sidePanelDownPos = useRef({ x: 0, y: 0 })
  const [defaultViewTick, setDefaultViewTick] = useState(0)

  // ── 标点状态 ──
  const [markerTemplates, setMarkerTemplates] = useState([]) // 标点模板列表
  const [placedMarkers, setPlacedMarkers] = useState([])     // 已放置标点
  const [showMarkerCreator, setShowMarkerCreator] = useState(false)
  const [contextMenu, setContextMenu] = useState(null)       // 右键菜单
  const [contextMenuSearch, setContextMenuSearch] = useState('') // 右键菜单搜索词
  const [contextMenuTab, setContextMenuTab] = useState('favorites') // 右键菜单当前选项卡
  const [placementEditor, setPlacementEditor] = useState(null) // 放置编辑面板
  const [placedMenu, setPlacedMenu] = useState(null)          // 已放置标点右键菜单
  const [sidePanel, setSidePanel] = useState(null)            // switch_map 侧栏
  const [detailModal, setDetailModal] = useState(null)       // tooltip 详情弹窗
  const [lightboxFile, setLightboxFile] = useState(null)     // 详情图片观赏（Lightbox）
  const memoryHubRootRef = useRef(null)                      // 根元素：Lightbox portalTo 挂载点
  const { push: navPush } = useNav()

  // ── 关联词条目录（圣遗物/材料 id → 名称+套装图），用于 tooltip 关联展示与跳转 ──
  const [entryCatalog, setEntryCatalog] = useState({ artifacts: new Map(), materials: new Map() })
  useEffect(() => {
    let alive = true
    if (window.electronAPI?.dbQuery) {
      window.electronAPI.dbQuery("SELECT id, name_zh, image, flower_image, circlet_image FROM artifacts").then(r => {
        if (!alive || !r?.data) return
        const m = new Map()
        for (const a of r.data) {
          m.set(a.id, { name: a.name_zh, image: a.flower_image || a.image || a.circlet_image || null })
        }
        setEntryCatalog(prev => ({ ...prev, artifacts: m }))
      }).catch(() => {})
      window.electronAPI.dbQuery("SELECT id, name_zh, image FROM materials").then(r => {
        if (!alive || !r?.data) return
        const m = new Map()
        for (const x of r.data) {
          m.set(x.id, { name: x.name_zh, image: x.image || null })
        }
        setEntryCatalog(prev => ({ ...prev, materials: m }))
      }).catch(() => {})
    }
    return () => { alive = false }
  }, [])

  // ── tooltip 关联词条跳转 ──
  const handleTooltipJump = useCallback((kind, id) => {
    setDetailModal(null)
    navPush(kind === 'artifact' ? `/artifacts/${id}` : `/materials/${id}`)
  }, [navPush])
  const [hoveredMarker, setHoveredMarker] = useState(null)   // 悬停的标点
  const [overlapMenu, setOverlapMenu] = useState(null)        // 重合标点弹出菜单 { markers, worldX, worldY, screenX, screenY }
  const [overlapHighlightedId, setOverlapHighlightedId] = useState(null) // 菜单中高亮的标点 ID
  const [editMarkerCategory, setEditMarkerCategory] = useState('') // 创建标点时预选分类
  const [markerEditData, setMarkerEditData] = useState(null)       // 编辑标点模板数据

  // ── 低缩放整图 ──
  const [fullImageSrc, setFullImageSrc] = useState(null)
  const [useFullImage, setUseFullImage] = useState(false)
  const fullImageRef = useRef(null)
  const useFullImageRef = useRef(useFullImage)
  useEffect(() => { useFullImageRef.current = useFullImage }, [useFullImage])
  const pendingViewRef = useRef(null)        // rAF 节流：待更新的 view 状态
  const rafViewRef = useRef(null)            // rAF 句柄

  // ── 视图模式 ──
  const [viewMode, setViewMode] = useState('default') // 'default' | 'compact' | 'original'

  // ── 默认模式标点显示开关（持久化到 user.json） ──
  const [showTeleportMarkers, setShowTeleportMarkers] = useState(true)
  const [showLocalLegend, setShowLocalLegend] = useState(true)
  const [showTextLabels, setShowTextLabels] = useState(true)
  const [showStatueMarkers, setShowStatueMarkers] = useState(true)

  // ── 文本框状态 ──
  const [textboxes, setTextboxes] = useState([])             // 文本框列表
  const [showTextboxCreator, setShowTextboxCreator] = useState(false)
  const [textboxMenu, setTextboxMenu] = useState(null)         // 文本框右键菜单
  const [textboxEditData, setTextboxEditData] = useState(null) // 编辑文本框数据
  const [movingTextboxId, setMovingTextboxId] = useState(null)  // 当前可拖拽移动的文本框 ID
  const movingTextboxIdRef = useRef(null)
  const [movingMarkerId, setMovingMarkerId] = useState(null)    // 当前可拖拽移动的标点 ID
  const movingMarkerIdRef = useRef(null)

  // ── 分层地图状态 ──
  const [layerMode, setLayerMode] = useState('G')    // 'G' | 'B' | 'F' | 'B1' | 'B2' | 'F1' | 'F2' ...
  const [showLayerManager, setShowLayerManager] = useState(false)
  const [layerEditData, setLayerEditData] = useState(null)   // 编辑分层地图数据
  const [hoveredLayerId, setHoveredLayerId] = useState(null) // 悬停的分层地图 ID
  const [layerMenu, setLayerMenu] = useState(null)            // 分层地图中键菜单
  const layerModeRef = useRef('G')
  useEffect(() => { layerModeRef.current = layerMode }, [layerMode])



  // 从 mapConfig 获取分层地图配置
  const configLayers = useMemo(() => mapConfig?.layers || [], [mapConfig])
  // 所有存在的层级代号（排序：B... < G < F...）
  const availableLevels = useMemo(() => {
    const levels = new Set()
    for (const l of configLayers) {
      if (l.level) levels.add(l.level)
    }
    return [...levels].sort((a, b) => {
      const getRank = (s) => {
        if (s === 'G') return 0
        const match = s.match(/^([BF])(\d+)$/i)
        if (!match) return 1
        const prefix = match[1].toUpperCase()
        const num = parseInt(match[2])
        return prefix === 'B' ? -num : num
      }
      return getRank(a) - getRank(b)
    })
  }, [configLayers])
  // 是否有 B 层 / F 层
  const hasBLayers = useMemo(() => availableLevels.some(l => l.startsWith('B')), [availableLevels])
  const hasFLayers = useMemo(() => availableLevels.some(l => l.startsWith('F')), [availableLevels])


  // ── 层级可见性判断 ──
  const isLevelActive = useCallback((level) => {
    if (layerMode === 'G') return false
    if (layerMode === 'B') return level.startsWith('B')
    if (layerMode === 'F') return level.startsWith('F')
    return level === layerMode
  }, [layerMode])
  // 某分层地图是否为基座且当前作为背景显示
  const isBaseBackground = useCallback((layer) => {
    if (!layer?.isBase || layerMode === 'G' || isLevelActive(layer.level)) return false
    // B 模式下不显示 F 基座，F 模式下不显示 B 基座
    if (layerMode === 'B' || layerMode.startsWith('B')) return layer.level.startsWith('B')
    if (layerMode === 'F' || layerMode.startsWith('F')) return layer.level.startsWith('F')
    return true
  }, [layerMode, isLevelActive])

  // ── 跟踪层级切换（不做自动定位，保持当前视角） ──
  const prevLayerMode = useRef('G')
  useEffect(() => {
    prevLayerMode.current = layerMode
  }, [layerMode])

  // ── 全局默认配置与用户覆盖配置 ──
  const [globalDefaults, setGlobalDefaults] = useState({
    levelThresholds: { 1: 0.5, 2: 1.5, 3: 3.0 },
    textboxFontSizes: { 0: 12, 1: 12, 2: 12, 3: 12 },
    markerSize: 32,
    fullImgThreshold: 0.10,
    layerHoverZoom: false,
  })
  const [userMapConfig, setUserMapConfig] = useState({})

  // 计算有效值：用户覆盖 → mapConfig（per-map 开发者配置）→ 全局默认
  // （useMemo 稳定引用，避免每次渲染重建对象导致下游 memo 失效）
  const effectiveLevelThresholds = useMemo(() => ({
    1: 0.5, 2: 1.5, 3: 3.0,
    ...(globalDefaults.levelThresholds || {}),
    ...(mapConfig?.levelThresholds || {}),
    ...(userMapConfig.levelThresholds || {}),
  }), [globalDefaults.levelThresholds, mapConfig?.levelThresholds, userMapConfig.levelThresholds])
  const effectiveTextboxFontSizes = useMemo(() => ({
    ...(globalDefaults.textboxFontSizes || {}),
    ...(mapConfig?.textboxFontSizes || {}),
    ...(userMapConfig.textboxFontSizes || {}),
  }), [globalDefaults.textboxFontSizes, mapConfig?.textboxFontSizes, userMapConfig.textboxFontSizes])
  const effectiveMarkerSize = userMapConfig.markerSize ?? mapConfig?.markerSize ?? globalDefaults.markerSize ?? 32
  const effectiveFullImgThreshold = userMapConfig.fullImgThreshold ?? mapConfig?.fullImgThreshold ?? globalDefaults.fullImgThreshold ?? 0.10
  const fullImageThresholdRef = useRef(effectiveFullImgThreshold)
  useEffect(() => { fullImageThresholdRef.current = effectiveFullImgThreshold }, [effectiveFullImgThreshold])

  const effectiveInertiaEnabled = userMapConfig.inertiaEnabled ?? mapConfig?.inertiaEnabled ?? globalDefaults.inertiaEnabled ?? true
  const effectiveInertiaFriction = userMapConfig.inertiaFriction ?? mapConfig?.inertiaFriction ?? globalDefaults.inertiaFriction ?? 0.05
  const effectiveLayerHoverZoom = userMapConfig.layerHoverZoom ?? mapConfig?.layerHoverZoom ?? globalDefaults.layerHoverZoom ?? false
  const defaultLevelThresholds = {
    1: 0.5, 2: 1.5, 3: 3.0,
    ...(globalDefaults.levelThresholds || {}),
    ...(mapConfig?.levelThresholds || {}),
  }
  const defaultTextboxFontSizes = {
    ...(globalDefaults.textboxFontSizes || {}),
    ...(mapConfig?.textboxFontSizes || {}),
  }
  const defaultMarkerSize = mapConfig?.markerSize ?? globalDefaults.markerSize ?? 32
  const defaultFullImgThreshold = mapConfig?.fullImgThreshold ?? globalDefaults.fullImgThreshold ?? 0.10

  const defaultInertiaEnabled = mapConfig?.inertiaEnabled ?? globalDefaults.inertiaEnabled ?? true
  const defaultInertiaFriction = mapConfig?.inertiaFriction ?? globalDefaults.inertiaFriction ?? 0.05
  const defaultLayerHoverZoom = mapConfig?.layerHoverZoom ?? globalDefaults.layerHoverZoom ?? false

  // ── 数据库迁移 ──
  useEffect(() => {
    window.electronAPI?.mapExecBaseline(
      "ALTER TABLE map_marker_placements ADD COLUMN layer_id TEXT DEFAULT NULL",
      []
    ).catch(() => {})
    window.electronAPI?.mapExecBaseline(
      "ALTER TABLE map_textboxes ADD COLUMN layer_id TEXT DEFAULT NULL",
      []
    ).catch(() => {})  // 列已存在时忽略错误
  }, [])

  // ── 从 user.json 加载标点显示开关 ──
  useEffect(() => {
    window.electronAPI?.getUserConfig().then(res => {
      if (res?.config) {
        if (res.config.mapShowTeleportMarkers != null) setShowTeleportMarkers(res.config.mapShowTeleportMarkers)
        if (res.config.mapShowLocalLegend != null) setShowLocalLegend(res.config.mapShowLocalLegend)
        if (res.config.mapShowTextLabels != null) setShowTextLabels(res.config.mapShowTextLabels)
        if (res.config.mapShowStatueMarkers != null) setShowStatueMarkers(res.config.mapShowStatueMarkers)
      }
    }).catch(() => {})
  }, [])

  // ── 切换地图时加载全局默认和用户覆盖 ──
  useEffect(() => {
    if (!currentMapId) return
    let cancelled = false
    const mapId = currentMapId
    setUserMapConfig({})
    window.electronAPI?.mapGetGlobalDefaults().then(r => {
      if (!cancelled && r?.success && r.defaults) {
        setGlobalDefaults(prev => ({ ...prev, ...r.defaults }))
      }
    })
    window.electronAPI?.mapGetUserConfig(mapId).then(r => {
      if (!cancelled && currentMapIdRef.current === mapId && r?.success) {
        setUserMapConfig(r.config || {})
      }
    })
    return () => { cancelled = true }
  }, [currentMapId])

  // 从 mapConfig 获取文本级别切换临界点（per-map），默认值兼容旧数据
  // (已废弃，改为 effectiveLevelThresholds)

  // ── Esc：取消定点模式 或 文本框移动模式 ──
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      if (movingTextboxIdRef.current !== null) { setMovingTextboxId(null); return }
      if (movingMarkerIdRef.current !== null) { setMovingMarkerId(null); return }
      if (defaultViewActive) handleCancelDefaultView()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [defaultViewActive])

  // ── 加载地图列表 ──
  useEffect(() => {
    loadMaps()
  }, [])

  async function loadMaps() {
    try {
      const res = await window.electronAPI?.mapQuery("SELECT id, name_zh, config FROM map_maps ORDER BY sort_order")
      if (res?.data) {
        const parsed = res.data.map(m => ({
          ...m,
          config: typeof m.config === 'string' ? JSON.parse(m.config) : m.config,
        }))
        setMaps(parsed)
        if (parsed.length > 0 && !currentMapId) {
          const m = parsed[0]
          currentMapIdRef.current = m.id
          setCurrentMapId(m.id)
          setMapConfig(m.config)
          mapConfigRef.current = m.config
          const dv = m.config?.defaultView
          const z = clampZoomToNative(dv?.zoom ?? 1, m.config)
          const initialVC = dv
            ? worldToViewCenter(dv.x, dv.y, z)
            : getCenteredMapViewCenter({ config: m.config, zoom: z, viewport: containerSize.current })
          setView(z, initialVC, m.config)
          requestAnimationFrame(() => {
            const nextVC = dv
              ? worldToViewCenter(dv.x, dv.y, z)
              : getCenteredMapViewCenter({ config: m.config, zoom: z, viewport: containerSize.current })
            setView(z, nextVC, m.config)
          })
        }
      }
    } catch (e) {
      console.error('[MemoryHub] loadMaps error:', e)
    } finally {
      setLoading(false)
    }
  }

  // ── 加载标点数据 ──
  const loadMarkers = useCallback(async (mapId) => {
    if (!mapId) return
    const gen = mapGenerationRef.current
    try {
      // 加载标点模板（基准库，兼容 is_favorite 列不存在的情况）
      let tmplRes = await window.electronAPI?.mapQuery(
        "SELECT id, map_id, marker_type, image_filename, name_zh, special_function, category, visibility, base_config, is_favorite FROM map_markers ORDER BY sort_order, name_zh"
      )
      if (tmplRes?.error) {
        // is_favorite 列不存在（数据库尚未迁移），回退不含该列的查询
        console.warn('[MemoryHub] is_favorite column missing, retrying query:', tmplRes.error)
        tmplRes = await window.electronAPI?.mapQuery(
          "SELECT id, map_id, marker_type, image_filename, name_zh, special_function, category, visibility, base_config FROM map_markers ORDER BY sort_order, name_zh"
        )
      }
      const templates = (tmplRes?.data || []).map(m => ({ ...m, is_favorite: m.is_favorite ?? 0 }))

      // 加载已放置标点（基准库 dev + user.db user）
      const placedRes = await window.electronAPI?.mapQuery(
        "SELECT mp.id, mp.map_id, mp.marker_id, mp.world_x, mp.world_y, mp.special_function, mp.custom_name, mp.created_by_dev, mp.subscript, mp.layer_id, mp.sort_order, " +
        "m.marker_type, m.image_filename, m.name_zh, m.special_function AS template_special " +
        "FROM map_marker_placements mp LEFT JOIN map_markers m ON mp.marker_id = m.id WHERE mp.map_id = ? ORDER BY mp.sort_order, mp.created_at",
        [mapId]
      )

      // 加载文本框
      const tbRes = await window.electronAPI?.mapQuery(
        "SELECT id, text, level, world_x, world_y, layer_id FROM map_textboxes WHERE map_id = ? ORDER BY level, world_y, world_x",
        [mapId]
      )
      if (mapGenerationRef.current !== gen || currentMapIdRef.current !== mapId) return
      setMarkerTemplates(templates)
      setPlacedMarkers(placedRes?.data || [])
      setTextboxes(tbRes?.data || [])
    } catch (e) {
      console.error('[MemoryHub] loadMarkers error:', e)
    }
  }, [])

  // 地图切换时加载标点和整图
  useEffect(() => {
    if (currentMapId) {
      initialTileLoadDoneRef.current = false
      hasLoadedAnyTileRef.current = false
      loadMarkers(currentMapId)
      const m = maps.find(m => m.id === currentMapId)
      if (m) loadFullImage(currentMapId, m.config)
    }
  }, [currentMapId])

  // 初次切片全部加载完成后标记 done（仅当有切片实际开始加载后才标记）
  useEffect(() => {
    if (!loading && (tileRemaining === 0 || tileRemainingRef.current === 0) && hasLoadedAnyTileRef.current && !initialTileLoadDoneRef.current) {
      initialTileLoadDoneRef.current = true
    }
  }, [loading, tileRemaining])

  // ── 悬停状态 rAF 节流：快速扫过标点区时每帧最多提交一次，避免连续全量渲染 ──
  const hoveredMarkerRafRef = useRef(null)
  const pendingHoverRef = useRef(null)
  const scheduleHoveredMarker = useCallback((pm) => {
    pendingHoverRef.current = pm
    if (hoveredMarkerRafRef.current === null) {
      hoveredMarkerRafRef.current = requestAnimationFrame(() => {
        hoveredMarkerRafRef.current = null
        const target = pendingHoverRef.current
        pendingHoverRef.current = null
        setHoveredMarker(target)
      })
    }
  }, [])

  // ── 加载低缩放整图 ──
  async function loadFullImage(mapId, mapCfg) {
    const gen = mapGenerationRef.current
    const fi = mapCfg?.fullImage
    if (!fi) { setFullImageSrc(null); return }
    try {
      // mapReadTile 不支持读取非切片文件，改用 readImage
      const imgRes = await window.electronAPI?.readImage(fi, 4096)
      if (mapGenerationRef.current !== gen) return  // 地图已切换，丢弃
      if (imgRes?.success && imgRes.data) {
        fullImageRef.current = fi
        setFullImageSrc(imgRes.data)
      } else {
        if (mapGenerationRef.current !== gen) return
        setFullImageSrc(null)
      }
    } catch {
      if (mapGenerationRef.current !== gen) return
      setFullImageSrc(null)
    }
  }

  // ── 地图切换 ──
  const handleSelectMap = useCallback((mapId) => {
    const m = maps.find(m => m.id === mapId)
    if (!m) return
    cancelActiveInteraction()
    missingTiles.current.clear()
    tileCache.current.clear()
    publishedTileCacheRef.current.clear()
    tilePublishQueueRef.current.clear()
    actualVisibleTileKeysRef.current.clear()
    decodedTilePreloadsRef.current.clear()
    loadingTiles.current.clear()
    desiredTileWidthsRef.current.clear()
    tileQueueRef.current?.clear()
    queuedTileKeysRef.current.clear()
    mapGenerationRef.current += 1
    currentMapIdRef.current = mapId
    tileLayerReadyRef.current = false
    setTileLayerReady(false)
    fullImageRef.current = null
    setFullImageSrc(null)
    setUseFullImage(false)
    // 重置切片状态
    setSlicing(false); setSliceProgress('')
    // 切换地图时退出定点模式
    setDefaultViewActive(false); defaultViewActiveRef.current = false
    // 重置分层模式
    setLayerMode('G')
    // 清空渐隐状态（避免旧地图的标点/文本框在新地图上残留渐隐）
    setFadingMarkers(new Map())
    setFadingTextboxes(new Map())
    setFadeInMarkers(new Set())
    setFadeInTextboxes(new Set())
    prevVisibleMarkerKeysRef.current = null
    prevVisibleMarkerItemsRef.current = null
    prevVisibleTextboxKeysRef.current = null
    prevVisibleTextboxItemsRef.current = null
    setCurrentMapId(mapId)
    setMapConfig(m.config)
    mapConfigRef.current = m.config
    loadFullImage(mapId, m.config)
    const dv = m.config?.defaultView
    const z = clampZoomToNative(dv?.zoom ?? 1, m.config)
    const nextVC = dv
      ? worldToViewCenter(dv.x, dv.y, z)
      : getCenteredMapViewCenter({ config: m.config, zoom: z, viewport: containerSize.current })
    setView(z, nextVC, m.config)
    setShowMapMenu(false)
  }, [cancelActiveInteraction, maps, setView])

  // ── 创建地图（打开标定） ──
  const handleCreateMap = useCallback(async () => {
    try {
      const res = await window.electronAPI?.mapInitCalibration()
      if (res?.canceled) return
      if (res?.error) { console.error('[MemoryHub] calibration init error:', res.error); return }
      setCalibration({
        previewData: res.previewData,
        previewW: res.previewW,
        previewH: res.previewH,
        imageW: res.imageW,
        imageH: res.imageH,
        srcPath: res.srcPath,
        srcName: res.srcName || '',
      })
    } catch (e) {
      console.error('[MemoryHub] handleCreateMap error:', e)
    }
  }, [])

  // ── 标定确认 → 保存地图配置 → 切片 ──
  const handleCalibrationConfirm = useCallback(async (calResult) => {
    try {
      // 从旧 config 中保留分层地图和默认视角（新建地图也可能已有 layers）
      const oldMap = maps.find(m => m.id === calResult.mapId)
      const oldCfg = oldMap?.config || {}
      const mergedConfig = {
        ...calResult.config,
        layers: oldCfg.layers ? [...oldCfg.layers] : [],
        ...(oldCfg.defaultView ? { defaultView: { ...oldCfg.defaultView } } : {}),
      }

      // 1. 保存地图配置（含分层地图等字段）
      const saveRes = await window.electronAPI?.mapSaveConfig(calResult.mapId, calResult.nameZh, mergedConfig)
      if (saveRes?.error) throw new Error(saveRes.error)
      setCalibration(null)

      // 2. 触发切片（传入 mergedConfig 确保切片后保留 layers 等字段）
      setSlicing(true)
      setSliceProgress(`正在切片 ${calResult.nameZh}...`)
      const sliceRes = await window.electronAPI?.mapStartSlice(calResult.mapId, calResult.srcPath, mergedConfig)
      if (!sliceRes) throw new Error('切片服务未响应')
      if (sliceRes?.error) throw new Error(`切片失败: ${sliceRes.error}`)
      setSliceProgress(`切片完成: ${sliceRes.processed ?? 0} 片 (${(sliceRes.errors?.length ?? 0) > 0 ? sliceRes.errors.length + ' 个错误' : '无错误'})`)
      setTimeout(() => setSlicing(false), 2000)

      // 3. 读取更新后的配置
      const configRes = await window.electronAPI?.mapGetConfig(calResult.mapId)
      const finalConfig = configRes?.map?.config || calResult.config

      // 4. 重新加载地图列表
      const res = await window.electronAPI?.mapQuery("SELECT id, name_zh, config FROM map_maps ORDER BY sort_order")
      if (res?.data) {
        const parsed = res.data.map(m => ({
          ...m,
          config: typeof m.config === 'string' ? JSON.parse(m.config) : m.config,
        }))
        setMaps(parsed)
        // 清缓存并应用默认视角
        cancelActiveInteraction()
        tileCache.current.clear()
        publishedTileCacheRef.current.clear()
        tilePublishQueueRef.current.clear()
        actualVisibleTileKeysRef.current.clear()
        decodedTilePreloadsRef.current.clear()
        if (missingTiles.current) missingTiles.current.clear()
        loadingTiles.current.clear()
        desiredTileWidthsRef.current.clear()
        tileQueueRef.current?.clear()
        queuedTileKeysRef.current.clear()
        mapGenerationRef.current += 1
        tileLayerReadyRef.current = false
        setTileLayerReady(false)
        const dv = finalConfig?.defaultView
        const z = clampZoomToNative(dv?.zoom ?? 1, finalConfig)
        mapConfigRef.current = finalConfig
        const nextVC = dv
          ? worldToViewCenter(dv.x, dv.y, z)
          : getCenteredMapViewCenter({ config: finalConfig, zoom: z, viewport: containerSize.current })
        setView(z, nextVC, finalConfig)
        currentMapIdRef.current = calResult.mapId
        setCurrentMapId(calResult.mapId)
        setMapConfig(finalConfig)
        console.log('[MemoryHub] calibration done', { mapId: calResult.mapId, finalConfigKeys: Object.keys(finalConfig), hasTileRange: !!finalConfig.tileRange, hasAnchorA: !!finalConfig.anchorA, zoom: finalConfig.scale, tileSize: finalConfig.tileSize })
      }
    } catch (e) {
      console.error('[MemoryHub] handleCalibrationConfirm error:', e)
      setSliceProgress(`错误: ${e.message}`)
      setTimeout(() => setSlicing(false), 3000)
    }
  }, [cancelActiveInteraction, setView, maps])

  // ── 更新地图（打开标定，预填原距离值） ──
  const handleUpdateMap = useCallback(async () => {
    try {
      const res = await window.electronAPI?.mapInitCalibration()
      if (res?.canceled) return
      if (res?.error) { console.error('[MemoryHub] calibration init error:', res.error); return }
      // 从当前 mapConfig 获取旧距离值作为预填
      const oldDistance = mapConfig?.distance || ''
      setCalibration({
        previewData: res.previewData,
        previewW: res.previewW,
        previewH: res.previewH,
        imageW: res.imageW,
        imageH: res.imageH,
        srcPath: res.srcPath,
        srcName: res.srcName || '',
        isUpdate: true,
        initialDistance: String(oldDistance),
      })
    } catch (e) {
      console.error('[MemoryHub] handleUpdateMap error:', e)
    }
  }, [mapConfig])

  // ── 更新地图确认 → 清理旧切片 → 保存配置 → 重新切片 ──
  const handleMapUpdateConfirm = useCallback(async (calResult) => {
    try {
      // 1. 清理旧切片
      const clearRes = await window.electronAPI?.mapClearTiles(currentMapId)
      if (clearRes?.error) console.warn('[MemoryHub] clear tiles warning:', clearRes.error)
      setCalibration(null)

      // 2. 从当前 config 保留分层地图和默认视角
      const oldCfg = mapConfigRef.current || {}
      const mergedConfig = {
        ...calResult.config,
        layers: oldCfg.layers ? [...oldCfg.layers] : [],
        ...(oldCfg.defaultView ? { defaultView: { ...oldCfg.defaultView } } : {}),
      }

      // 3. 保存配置（使用 currentMapId 而非 calResult.mapId）
      const saveRes = await window.electronAPI?.mapSaveConfig(currentMapId, calResult.nameZh, mergedConfig)
      if (saveRes?.error) throw new Error(saveRes.error)

      // 4. 触发重新切片（传入 mergedConfig 确保切片后保留 layers 等字段）
      setSlicing(true)
      setSliceProgress(`正在切片 ${calResult.nameZh}...`)
      const sliceRes = await window.electronAPI?.mapStartSlice(currentMapId, calResult.srcPath, mergedConfig)
      if (!sliceRes) throw new Error('切片服务未响应')
      if (sliceRes?.error) throw new Error(`切片失败: ${sliceRes.error}`)
      setSliceProgress(`切片完成: ${sliceRes.processed ?? 0} 片 (${(sliceRes.errors?.length ?? 0) > 0 ? sliceRes.errors.length + ' 个错误' : '无错误'})`)
      setTimeout(() => setSlicing(false), 2000)

      // 4. 清理缓存并重新加载
      cancelActiveInteraction()
      setFullImageSrc(null)
      tileCache.current.clear()
      publishedTileCacheRef.current.clear()
      tilePublishQueueRef.current.clear()
      actualVisibleTileKeysRef.current.clear()
      decodedTilePreloadsRef.current.clear()
      if (missingTiles.current) missingTiles.current.clear()
      loadingTiles.current.clear()
      desiredTileWidthsRef.current.clear()
      tileQueueRef.current?.clear()
      queuedTileKeysRef.current.clear()
      mapGenerationRef.current += 1
      tileLayerReadyRef.current = false
      setTileLayerReady(false)

      // 读取更新后的配置
      const configRes = await window.electronAPI?.mapGetConfig(currentMapId)
      const finalConfig = configRes?.map?.config || calResult.config

      // 重新加载地图列表和标点
      await loadMaps()
      await loadMarkers(currentMapId)
      loadFullImage(currentMapId, finalConfig)

      const dv = finalConfig?.defaultView
      const z = clampZoomToNative(dv?.zoom ?? 1, finalConfig)
      mapConfigRef.current = finalConfig
      const nextVC = dv
        ? worldToViewCenter(dv.x, dv.y, z)
        : getCenteredMapViewCenter({ config: finalConfig, zoom: z, viewport: containerSize.current })
      setView(z, nextVC, finalConfig)
      setMapConfig(finalConfig)
      console.log('[MemoryHub] map update done', { mapId: currentMapId })
    } catch (e) {
      console.error('[MemoryHub] handleMapUpdateConfirm error:', e)
      setSliceProgress(`错误: ${e.message}`)
      setTimeout(() => setSlicing(false), 3000)
    }
  }, [cancelActiveInteraction, currentMapId, setView])

  // ── 全图生成（从 UI 内联逻辑提取） ──
  const handleGenerateFull = useCallback(async () => {
    if (!currentMapId) return
    try {
      const res = await window.electronAPI?.mapGenerateFull(currentMapId)
      if (res?.canceled) return
      if (res?.success) {
        const m = maps.find(x => x.id === currentMapId)
        if (m) loadFullImage(currentMapId, { ...m.config, fullImage: res.fullImage })
        alert('全图生成成功！')
      } else {
        alert('生成失败: ' + (res?.error || '未知错误'))
      }
    } catch (e) {
      console.error('[MemoryHub] handleGenerateFull error:', e)
      alert('生成失败: ' + e.message)
    }
  }, [currentMapId, maps])

  // ── 比例调整：按比例缩放所有标点、文本框和分层地图坐标 ──
  const handleApplyScale = useCallback(async () => {
    if (!currentMapId) return
    const ratio = parseFloat(scaleRatio)
    if (isNaN(ratio) || !isFinite(ratio) || ratio <= 0) {
      alert('请输入有效的正数比例值')
      return
    }
    if (ratio === 1) {
      alert('比例为 1，无需调整')
      return
    }
    if (!window.confirm(`确定按比例 ${ratio.toFixed(4)} 调整所有标点、文本框和分层地图的坐标？\n此操作不可撤销。`)) return

    try {
      // 1. 更新标点位置
      const markerRes = await window.electronAPI?.mapExecBaseline(
        "UPDATE map_marker_placements SET world_x = ROUND(world_x * ?), world_y = ROUND(world_y * ?) WHERE map_id = ?",
        [ratio, ratio, currentMapId]
      )
      if (markerRes?.error) throw new Error('标点更新失败: ' + markerRes.error)

      // 2. 更新文本框位置
      const tbRes = await window.electronAPI?.mapExecBaseline(
        "UPDATE map_textboxes SET world_x = ROUND(world_x * ?), world_y = ROUND(world_y * ?) WHERE map_id = ?",
        [ratio, ratio, currentMapId]
      )
      if (tbRes?.error) throw new Error('文本框更新失败: ' + tbRes.error)

      // 3. 更新 config 中的分层地图坐标和尺寸
      const configRes = await window.electronAPI?.mapGetConfig(currentMapId)
      if (configRes?.error) throw new Error('读取配置失败: ' + configRes.error)
      const cfg = configRes?.map?.config || {}
      const currentMap = maps.find(m => m.id === currentMapId)
      const nameZh = currentMap?.name_zh || ''
      if (cfg.layers && cfg.layers.length > 0) {
        cfg.layers = cfg.layers.map(layer => ({
          ...layer,
          worldX: Math.round((layer.worldX || 0) * ratio),
          worldY: Math.round((layer.worldY || 0) * ratio),
          width: Math.round((layer.width || 0) * ratio),
          height: Math.round((layer.height || 0) * ratio),
        }))
      }
      // 同时缩放默认视角的世界坐标
      if (cfg.defaultView) {
        cfg.defaultView = {
          ...cfg.defaultView,
          x: Math.round((cfg.defaultView.x || 0) * ratio),
          y: Math.round((cfg.defaultView.y || 0) * ratio),
        }
      }
      const saveRes = await window.electronAPI?.mapSaveConfig(currentMapId, nameZh, cfg)
      if (saveRes?.error) throw new Error('配置保存失败: ' + saveRes.error)

      // 4. 重新加载数据并更新当前 config 状态
      await loadMaps()
      setMapConfig(cfg)
      mapConfigRef.current = cfg
      await loadMarkers(currentMapId)
      setScaleRatio('1.0')
      alert(`比例调整完成！\n已按 ${ratio.toFixed(4)} 倍调整所有坐标。`)
    } catch (e) {
      console.error('[MemoryHub] handleApplyScale error:', e)
      alert('比例调整失败: ' + e.message)
    }
  }, [currentMapId, maps, scaleRatio])

  // ── 实时视图写入：matrix 与标注逆缩放变量必须在同一帧提交 ──
  const applyLiveTransform = useCallback((liveZoom, liveViewCenter) => {
    const element = mapTransformRef.current
    if (!element) return
    const settledZoom = settledZoomRef.current
    const markerSize = effectiveMarkerSize
    const maxMarkerWorldSize = Math.max(200, markerSize * 6)
    const markerWorldSizeAt = z => Math.min(
      markerSize / Math.max(z, 0.05),
      maxMarkerWorldSize,
    )
    const settledMarkerSize = markerWorldSizeAt(settledZoom)
    const liveMarkerSize = markerWorldSizeAt(liveZoom)
    const markerScale = settledMarkerSize > 0 ? liveMarkerSize / settledMarkerSize : 1
    const textScale = Math.max(settledZoom, 0.05) / Math.max(liveZoom, 0.05)

    element.style.transform = `matrix(${liveZoom}, 0, 0, ${liveZoom}, ${liveViewCenter.x}, ${liveViewCenter.y})`
    element.style.setProperty('--memoryhub-marker-scale', String(markerScale))
    element.style.setProperty('--memoryhub-text-scale', String(textScale))
  }, [effectiveMarkerSize])
  applyLiveTransformRef.current = applyLiveTransform

  const syncFullImageMode = useCallback((nextZoom) => {
    setUseFullImage(previous => {
      if (!fullImageSrc || !mapConfig?.fullImage) return false
      const threshold = previous
        ? effectiveFullImgThreshold * 1.08
        : effectiveFullImgThreshold
      return nextZoom < threshold
    })
  }, [effectiveFullImgThreshold, fullImageSrc, mapConfig?.fullImage])

  // ── 缩放控制（核心底层：live refs 是交互期间唯一视图真源）──
  const calculateZoomedViewCenter = useCallback((newZoom, screenCX, screenCY) => {
    const oldZoom = zoomRef.current
    const oldVC = viewCenterRef.current

    if (defaultViewActiveRef.current) {
      const pin = defaultViewPinRef.current
      const candidate = {
        x: oldVC.x + pin.x * (oldZoom - newZoom),
        y: oldVC.y + pin.y * (oldZoom - newZoom),
      }
      return constrainViewCenterForMap(candidate, newZoom).viewCenter
    }
    const candidate = {
      x: screenCX - (screenCX - oldVC.x) * newZoom / oldZoom,
      y: screenCY - (screenCY - oldVC.y) * newZoom / oldZoom,
    }
    return constrainViewCenterForMap(candidate, newZoom).viewCenter
  }, [constrainViewCenterForMap])

  const applyZoom = useCallback((newZoom, screenCX, screenCY) => {
    if (Math.abs(newZoom - zoomRef.current) < 1e-8) return

    const newVC = calculateZoomedViewCenter(newZoom, screenCX, screenCY)
    setView(newZoom, newVC)
  }, [calculateZoomedViewCenter, setView])

  const zoomAround = useCallback((newZoom, cx, cy) => {
    applyZoom(newZoom, cx, cy)
  }, [applyZoom])

  const handleZoomIn = useCallback(() => {
    const rect = mapContainerRef.current?.getBoundingClientRect()
    const cw = rect?.width || containerSize.current.w || 800
    const ch = rect?.height || containerSize.current.h || 600
    const nz = Math.min(getMaxNativeZoom(mapConfigRef.current), +(zoomRef.current * 1.25).toFixed(4))
    applyZoom(nz, cw / 2, ch / 2)
  }, [applyZoom])

  const handleZoomOut = useCallback(() => {
    const rect = mapContainerRef.current?.getBoundingClientRect()
    const cw = rect?.width || containerSize.current.w || 800
    const ch = rect?.height || containerSize.current.h || 600
    const nz = Math.max(0.01, +(zoomRef.current / 1.25).toFixed(4))
    applyZoom(nz, cw / 2, ch / 2)
  }, [applyZoom])

  // ── 取消默认视角定点模式 ──
  const handleCancelDefaultView = useCallback(() => {
    if (defaultViewRef.current) {
      setView(defaultViewRef.current.zoom, { x: defaultViewRef.current.x, y: defaultViewRef.current.y })
    }
    setDefaultViewActive(false); defaultViewActiveRef.current = false
  }, [])

  // ── 默认视角定点模式 ──
  const handleToggleDefaultView = useCallback(() => {
    if (defaultViewActive) {
      // 关闭不保存（等同于取消）
      handleCancelDefaultView()
    } else {
      // 进入：跳转到 pin 位置 + 缩放
      const cw = containerSize.current.w || 800
      const ch = containerSize.current.h || 600
      const dv = mapConfig?.defaultView || {
        x: (cw / 2 - viewCenter.x) / zoom,
        y: (ch / 2 - viewCenter.y) / zoom,
        zoom
      }
      defaultViewPinRef.current = { ...dv }
      defaultViewRef.current = { x: viewCenter.x, y: viewCenter.y, zoom }
      const z = clampZoomToNative(dv.zoom ?? 1, mapConfig)
      setView(z, worldToViewCenter(dv.x, dv.y, z))
      requestAnimationFrame(() => {
        setView(z, worldToViewCenter(dv.x, dv.y, z))
      })
      setDefaultViewActive(true); defaultViewActiveRef.current = true
    }
  }, [defaultViewActive, mapConfig, viewCenter, zoom, currentMapId, maps, handleCancelDefaultView])

  // ── 保存默认视角并退出定点模式 ──
  const handleSaveDefaultView = useCallback(() => {
    const updated = { ...mapConfig, defaultView: { ...defaultViewPinRef.current, zoom } }
    setMapConfig(updated)
    setMaps(prev => prev.map(m => m.id === currentMapId ? { ...m, config: updated } : m))
    const mapName = maps.find(m => m.id === currentMapId)?.name_zh || ''
    window.electronAPI?.mapSaveConfig(currentMapId, mapName, updated)
    setDefaultViewActive(false); defaultViewActiveRef.current = false
  }, [mapConfig, zoom, currentMapId, maps])

  // ── 一键回到默认视角（非开发者模式） ──
  const handleGoToDefaultView = useCallback(() => {
    const dv = mapConfig?.defaultView
    if (!dv) return
    const z = clampZoomToNative(dv.zoom ?? 1, mapConfig)
    setView(z, worldToViewCenter(dv.x, dv.y, z))
    requestAnimationFrame(() => {
      setView(z, worldToViewCenter(dv.x, dv.y, z))
    })
  }, [mapConfig, setView])

  const handleZoomSlider = useCallback((e) => {
    const nz = Math.min(+e.target.value, getMaxNativeZoom(mapConfigRef.current))
    isZoomingRef.current = true
    tileQueueRef.current?.pause()
    // 清除队列中残留的旧缩放级别切片，避免恢复后加载非可见 tile
    tileQueueRef.current?.clear()
    queuedTileKeysRef.current.clear()
    desiredTileWidthsRef.current.clear()
    if (delayedTileIdleRef.current !== null) {
      cancelIdleCallback(delayedTileIdleRef.current)
      delayedTileIdleRef.current = null
    }
    if (zoomTimerRef.current) clearTimeout(zoomTimerRef.current)
    zoomTimerRef.current = setTimeout(() => {
      isZoomingRef.current = false
      // 如果用户已开始拖拽，不恢复队列、不更新 state，避免干扰拖拽
      if (isDraggingRef.current) return
      tileQueueRef.current?.resume()
      // 仅提交仍然有效的最终快照；新一轮输入会让本次 rAF 自动失效。
      requestAnimationFrame(() => {
        if (isZoomingRef.current || isDraggingRef.current) return
        const nz = zoomRef.current
        const vc = viewCenterRef.current
        setZoom(nz)
        setViewCenter(vc)
        syncFullImageMode(nz)
        refreshAnnotationWindow(nz, vc, { immediate: true })
        setTilesTick(t => t + 1)
      })
      // 通过 idle callback 延迟 cache 淘汰
      if (delayedTileIdleRef.current === null) {
        delayedTileIdleRef.current = requestIdleCallback(() => {
          delayedTileIdleRef.current = null
          if (isZoomingRef.current) return
          scheduleEvictDistantTiles()
        }, { timeout: 100 })
      }
    }, 30)
    const rect = mapContainerRef.current?.getBoundingClientRect()
    const cx = (rect?.width || containerSize.current.w || 800) / 2
    const cy = (rect?.height || containerSize.current.h || 600) / 2
    const newVC = calculateZoomedViewCenter(nz, cx, cy)
    zoomRef.current = nz
    viewCenterRef.current = newVC
    applyLiveTransform(nz, newVC)
    refreshAnnotationWindow(nz, newVC)
    // 滑块受控值与 settled viewport 同步；重叠计算已是亚毫秒级。
    setZoom(nz)
    setViewCenter(newVC)
    syncFullImageMode(nz)
  }, [applyLiveTransform, calculateZoomedViewCenter, syncFullImageMode, refreshAnnotationWindow])

  // ── 滚轮缩放（直接 DOM 变换，不阻塞 React；30ms 静止窗口后统一提交） ──
  useEffect(() => {
    const el = mapContainerRef.current
    if (!el || loading) return
    const onWheel = (e) => {
      e.preventDefault()
      // 拖拽期间忽略滚轮缩放，避免误触导致画面跳动
      if (isDraggingRef.current) return
      isZoomingRef.current = true
      tileQueueRef.current?.pause()
      // 清除队列中残留的旧缩放级别切片，避免恢复后加载非可见 tile
      tileQueueRef.current?.clear()
      queuedTileKeysRef.current.clear()
      desiredTileWidthsRef.current.clear()
      // 新一轮缩放，取消待执行的延迟 idle 任务
      if (delayedTileIdleRef.current !== null) {
        cancelIdleCallback(delayedTileIdleRef.current)
        delayedTileIdleRef.current = null
      }
      if (zoomTimerRef.current) clearTimeout(zoomTimerRef.current)
      zoomTimerRef.current = setTimeout(() => {
        isZoomingRef.current = false
        // 取消残留的 wheel rAF，避免覆盖 debounce 后的 transform
        if (wheelRafRef.current !== null) {
          cancelAnimationFrame(wheelRafRef.current)
          wheelRafRef.current = null
        }
        // 如果用户已开始拖拽，不恢复队列、不更新 state，避免干扰拖拽
        if (isDraggingRef.current) return
        // 恢复 idle queue（继续处理已在队列中的 tile）
        tileQueueRef.current?.resume()
        // 仅提交仍然有效的最终快照；新一轮输入会让本次 rAF 自动失效。
        requestAnimationFrame(() => {
          if (isZoomingRef.current || isDraggingRef.current) return
          const nz = zoomRef.current
          const vc = viewCenterRef.current
          setZoom(nz)
          setViewCenter(vc)
          syncFullImageMode(nz)
          refreshAnnotationWindow(nz, vc, { immediate: true })
          setTilesTick(t => t + 1)
        })
        // 通过 idle callback 延迟处理 cache 淘汰，不阻塞用户操作
        if (delayedTileIdleRef.current === null) {
          delayedTileIdleRef.current = requestIdleCallback(() => {
            delayedTileIdleRef.current = null
            if (isDraggingRef.current || isZoomingRef.current) return
            scheduleEvictDistantTiles()
          }, { timeout: 100 })
        }
      }, 30)

      const rect = el.getBoundingClientRect()
      const cx = e.clientX - rect.left
      const cy = e.clientY - rect.top
      const z = zoomRef.current
      const step = Math.min(0.06, Math.abs(e.deltaY) / 600)
      const nz = Math.max(0.01, Math.min(getMaxNativeZoom(mapConfigRef.current), z * Math.exp(e.deltaY > 0 ? -step : step)))
      if (Math.abs(nz - z) < 1e-8) return

      const newVC = calculateZoomedViewCenter(nz, cx, cy)

      // 直接更新 DOM transform（保证地图平移缩放流畅）
      zoomRef.current = nz
      viewCenterRef.current = newVC
      // rAF 节流 matrix + 标注逆缩放写入，避免同帧视觉撕裂。
      if (wheelRafRef.current === null) {
        wheelRafRef.current = requestAnimationFrame(() => {
          wheelRafRef.current = null
          applyLiveTransform(zoomRef.current, viewCenterRef.current)
          refreshAnnotationWindow(zoomRef.current, viewCenterRef.current)
        })
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [applyLiveTransform, calculateZoomedViewCenter, loading, currentMapId, refreshAnnotationWindow, syncFullImageMode])

  // ── 左键拖拽平移（rAF 节流 + ref） ──
  const handleMouseDown = useCallback((e) => {
    e.preventDefault()
    // 点击空白处取消移动模式
    if (movingTextboxIdRef.current !== null) setMovingTextboxId(null)
    if (movingMarkerIdRef.current !== null) setMovingMarkerId(null)
    if (e.button !== 0) return
    // 停止正在运行的惯性动画
    if (inertiaRafRef.current !== null) {
      cancelAnimationFrame(inertiaRafRef.current)
      inertiaRafRef.current = null
    }
    inertiaRunningRef.current = false
    dragPositionsRef.current = []
    dragSpeedRef.current = { vx: 0, vy: 0 }
    // 拖拽期间不暂停 idle queue：进入视口的切片在浏览器空闲间隙继续加载，
    // 长按拖拽不松手时新区域切片也能就绪，松手后即刻呈现，避免空白等待。
    tileQueueRef.current?.clear()
    queuedTileKeysRef.current.clear()
    desiredTileWidthsRef.current.clear()
    // 取消等待中的延迟 idle 任务（拖拽期间不需要）
    if (delayedTileIdleRef.current !== null) {
      cancelIdleCallback(delayedTileIdleRef.current)
      delayedTileIdleRef.current = null
    }
    setIsDragging(true)
    isDraggingRef.current = true
    dragStart.current = { x: e.clientX - viewCenterRef.current.x, y: e.clientY - viewCenterRef.current.y }
    dragStartMouseRef.current = { x: e.clientX, y: e.clientY }
    dragStartTimeRef.current = Date.now()
  }, [])

  // 同步 movingTextboxId state → ref（供 useCallback 使用最新值）
  useEffect(() => { movingTextboxIdRef.current = movingTextboxId }, [movingTextboxId])
  useEffect(() => { movingMarkerIdRef.current = movingMarkerId }, [movingMarkerId])
  // 同步惯性设置到 ref（供 useCallback 使用最新值）
  useEffect(() => { inertiaEnabledRef.current = effectiveInertiaEnabled }, [effectiveInertiaEnabled])
  useEffect(() => { inertiaFrictionRef.current = effectiveInertiaFriction }, [effectiveInertiaFriction])

  const handleMouseMove = useCallback((e) => {
    if (!isDraggingRef.current) return
    dragStartMouseRef.current = { x: e.clientX, y: e.clientY }
    const candidate = {
      x: e.clientX - dragStart.current.x,
      y: e.clientY - dragStart.current.y,
    }
    const constrained = constrainViewCenterForMap(candidate, zoomRef.current)
    viewCenterRef.current = constrained.viewCenter
    // 到边界后同步拖拽原点，鼠标反向 1px 即可离开边界，不产生“粘住”死区。
    if (constrained.hitX) dragStart.current.x = e.clientX - constrained.viewCenter.x
    if (constrained.hitY) dragStart.current.y = e.clientY - constrained.viewCenter.y
    // 记录位置历史（惯性速度计算，保留最近 ~100ms）
    const now = Date.now()
    const positions = dragPositionsRef.current
    positions.push({ x: constrained.viewCenter.x, y: constrained.viewCenter.y, t: now })
    while (positions.length > 0 && now - positions[0].t > 100) positions.shift()
    // rAF 节流 DOM 写入，避免高频 mousemove 反复触发布局
    if (dragRafRef.current === null) {
      dragRafRef.current = requestAnimationFrame(() => {
        dragRafRef.current = null
        applyLiveTransform(zoomRef.current, viewCenterRef.current)
        refreshAnnotationWindow(zoomRef.current, viewCenterRef.current)
        // 拖拽中实时把进入视口的切片推入空闲队列加载
        syncDragTileLoadingRef.current?.()
      })
    }
  }, [applyLiveTransform, constrainViewCenterForMap, refreshAnnotationWindow])

  // ── 惯性动画循环（匀速减速运动） ──
  function inertiaTick() {
    const speed = Math.hypot(dragSpeedRef.current.vx, dragSpeedRef.current.vy)

    if (speed < 0.1 || !inertiaRunningRef.current) {
      // 惯性结束 — 恢复队列并更新 state（触发切片加载）
      inertiaRunningRef.current = false
      inertiaRafRef.current = null
      tileQueueRef.current?.resume()
      setViewCenter({ ...viewCenterRef.current })
      refreshAnnotationWindow(zoomRef.current, viewCenterRef.current, { immediate: true })
      setTilesTick(t => t + 1)
      if (delayedTileIdleRef.current === null) {
        delayedTileIdleRef.current = requestIdleCallback(() => {
          delayedTileIdleRef.current = null
          if (isZoomingRef.current) return
          scheduleEvictDistantTiles()
        }, { timeout: 1000 })
      }
      return
    }

    // 速度位于屏幕像素空间；撞到边界的轴立即归零，避免惯性持续“顶墙”。
    const constrained = constrainViewCenterForMap({
      x: viewCenterRef.current.x + dragSpeedRef.current.vx,
      y: viewCenterRef.current.y + dragSpeedRef.current.vy,
    }, zoomRef.current)
    viewCenterRef.current = constrained.viewCenter
    if (constrained.hitX) dragSpeedRef.current.vx = 0
    if (constrained.hitY) dragSpeedRef.current.vy = 0

    // 再应用摩擦减速（值越大减速越快：0.01=几乎无摩擦长滑，0.20=高摩擦快停）
    dragSpeedRef.current.vx *= (1 - inertiaFrictionRef.current)
    dragSpeedRef.current.vy *= (1 - inertiaFrictionRef.current)

    applyLiveTransform(zoomRef.current, viewCenterRef.current)
    refreshAnnotationWindow(zoomRef.current, viewCenterRef.current)
    // 惯性滑行期间同样继续加载进入视口的切片
    syncDragTileLoadingRef.current?.()

    inertiaRafRef.current = requestAnimationFrame(inertiaTick)
  }

  const handleMouseUp = useCallback(() => {
    if (!isDraggingRef.current) return
    isDraggingRef.current = false
    setIsDragging(false)
    // 取消等待中的延迟 idle 任务
    if (delayedTileIdleRef.current !== null) {
      cancelIdleCallback(delayedTileIdleRef.current)
      delayedTileIdleRef.current = null
    }
    // 清理未执行的拖拽 rAF
    if (dragRafRef.current !== null) {
      cancelAnimationFrame(dragRafRef.current)
      dragRafRef.current = null
    }

    // 计算拖拽速度（最近 ~100ms 内的平均速度）
    const pos = dragPositionsRef.current
    const now = Date.now()
    if (pos.length >= 2) {
      const first = pos[0], last = pos[pos.length - 1]
      // 如果最后一个采样点已超过 50ms（用户已静止），惯性速度应为 0
      if (now - last.t > 50) {
        dragSpeedRef.current = { vx: 0, vy: 0 }
      } else {
        const dt = Math.max(1, last.t - first.t)
        dragSpeedRef.current = {
          vx: (last.x - first.x) / dt,
          vy: (last.y - first.y) / dt,
        }
      }
    } else {
      // 采样点不足（≤1 个），无法计算可靠速度
      dragSpeedRef.current = { vx: 0, vy: 0 }
    }
    dragPositionsRef.current = []

    applyLiveTransform(zoomRef.current, viewCenterRef.current)
    refreshAnnotationWindow(zoomRef.current, viewCenterRef.current, { immediate: true })

    // 判断是否启动惯性动画
    const speed = Math.hypot(dragSpeedRef.current.vx, dragSpeedRef.current.vy)
    if (speed > 0.15 && inertiaEnabledRef.current) {
      // 启动惯性动画 — queue 保持暂停，state 延迟到惯性结束后更新
      inertiaRunningRef.current = true
      inertiaRafRef.current = requestAnimationFrame(inertiaTick)
      return
    }

    // 无惯性：立即恢复队列并更新 state
    tileQueueRef.current?.resume()
    setViewCenter({ ...viewCenterRef.current })
    refreshAnnotationWindow(zoomRef.current, viewCenterRef.current, { immediate: true })
    setTilesTick(t => t + 1)
    if (delayedTileIdleRef.current === null) {
      delayedTileIdleRef.current = requestIdleCallback(() => {
        delayedTileIdleRef.current = null
        if (isZoomingRef.current) return
        scheduleEvictDistantTiles()
      }, { timeout: 1000 })
    }
  }, [applyLiveTransform, refreshAnnotationWindow])

  // ── window 级鼠标事件（确保拖拽出容器后事件不丢失） ──
  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [handleMouseMove, handleMouseUp])

  // ── 地图右键 → 放置标点 ──
  const handleMapContextMenu = useCallback((e) => {
    e.preventDefault()
    if (!mapContainerRef.current || !mapConfig) return
    // 关闭已打开的重叠菜单
    setOverlapMenu(null); setOverlapHighlightedId(null)
    const rect = mapContainerRef.current.getBoundingClientRect()
    // 计算点击位置的世界坐标
    const mouseX = (e.clientX - rect.left - viewCenter.x) / zoom
    const mouseY = (e.clientY - rect.top - viewCenter.y) / zoom

    // 分层模式逻辑
    const isSingleLayerMode = layerMode !== 'G' && layerMode !== 'B' && layerMode !== 'F'
    const isGroupLayerMode = layerMode === 'B' || layerMode === 'F'

    // B 或 F 模式（所有层级显示模式）下无法放置任何标点
    if (isGroupLayerMode) return

    // 检测右键是否在某个分层地图上
    let targetLayer = null
    if (isSingleLayerMode) {
      for (const layer of configLayers) {
        if (layer.level !== layerMode) continue
        const halfW = (layer.width || 500) / 2
        const halfH = (layer.height || 500) / 2
        if (
          mouseX >= (layer.worldX - halfW) && mouseX <= (layer.worldX + halfW) &&
          mouseY >= (layer.worldY - halfH) && mouseY <= (layer.worldY + halfH)
        ) {
          targetLayer = layer
          break
        }
      }
      // 如果右键位置没有分层地图则不触发菜单
      if (!targetLayer) return
    }

    // 只显示有可用标点模板的菜单
    const available = markerTemplates
    if (available.length === 0) return
    // 弹出右键菜单选择标点（菜单通过 Portal 在 body 中，用 window 边界）
    const pos = clampMenuPos(e.clientX, e.clientY, 260, 320)
    setContextMenu({ x: pos.x, y: pos.y, worldX: mouseX, worldY: mouseY, templates: available, targetLayer })
    setContextMenuSearch('')
  }, [viewCenter, zoom, mapConfig, markerTemplates, configLayers, layerMode])

  // ── 放置编辑面板确认 ──
  const handlePlacementConfirm = useCallback(async ({ placementId, markerId, worldX, worldY, customName, specialFunction, subscript, layerId }) => {
    try {
      const sf = specialFunction ? JSON.stringify(specialFunction) : null
      if (placementId) {
        // 编辑模式
        await window.electronAPI?.mapUpdatePlacement(placementId, { custom_name: customName, special_function: sf, subscript, layer_id: layerId || null })
      } else {
        // 新建模式 — 计算 sort_order 排在最上层
        const orderRes = await window.electronAPI?.mapQuery(
          "SELECT COALESCE(MAX(sort_order), -1) + 1 as next_order FROM map_marker_placements WHERE map_id = ?",
          [currentMapId]
        )
        const nextOrder = orderRes?.data?.[0]?.next_order ?? 0
        const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
        const sql = "INSERT INTO map_marker_placements (id, map_id, marker_id, world_x, world_y, custom_name, special_function, subscript, layer_id, sort_order, created_by_dev) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
        const params = [id, currentMapId, markerId, worldX, worldY, customName, sf, subscript || '0', layerId || null, nextOrder, devMode ? 1 : 0]
        if (devMode) {
          await window.electronAPI?.mapExecBaseline(sql, params)
        } else {
          await window.electronAPI?.mapExecUser(sql, params)
        }
      }
      setPlacementEditor(null)
      loadMarkers(currentMapId)
    } catch (e) {
      console.error('[MemoryHub] place marker error:', e)
    }
  }, [currentMapId, devMode])

  // ── 分层地图：添加/编辑/删除 ──
  const handleLayerConfirm = useCallback(async (layerData) => {
    try {
      const layers = [...(mapConfig?.layers || [])]
      const entry = {
        id: layerData.editIndex != null ? layers[layerData.editIndex]?.id : (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
        name: layerData.name,
        level: layerData.level,
        imageFilename: layerData.imageFilename,
        worldX: layerData.worldX,
        worldY: layerData.worldY,
        width: layerData.width,
        height: layerData.height,
        zIndex: layerData.zIndex,
        isBase: layerData.isBase || false,
        important: layerData.important || false,
      }
      if (layerData.editIndex != null && layerData.editIndex >= 0 && layerData.editIndex < layers.length) {
        // 编辑
        layers[layerData.editIndex] = { ...layers[layerData.editIndex], ...entry }
      } else {
        // 新增
        layers.push(entry)
      }
      const updatedConfig = { ...mapConfig, layers }
      setMapConfig(updatedConfig)
      setMaps(prev => prev.map(m => m.id === currentMapId ? { ...m, config: updatedConfig } : m))
      const mn = maps.find(m => m.id === currentMapId)?.name_zh || ''
      await window.electronAPI?.mapSaveConfig(currentMapId, mn, updatedConfig)
      setShowLayerManager(false)
      setLayerEditData(null)
    } catch (e) {
      console.error('[MemoryHub] handleLayerConfirm error:', e)
    }
  }, [currentMapId, mapConfig, maps])

  const handleLayerDelete = useCallback(async (index) => {
    try {
      const layers = [...(mapConfig?.layers || [])]
      if (index < 0 || index >= layers.length) return
      if (!confirm(`确定删除分层地图「${layers[index].name || '未命名'}」？`)) return
      layers.splice(index, 1)
      const updatedConfig = { ...mapConfig, layers }
      setMapConfig(updatedConfig)
      setMaps(prev => prev.map(m => m.id === currentMapId ? { ...m, config: updatedConfig } : m))
      const mn = maps.find(m => m.id === currentMapId)?.name_zh || ''
      await window.electronAPI?.mapSaveConfig(currentMapId, mn, updatedConfig)
    } catch (e) {
      console.error('[MemoryHub] handleLayerDelete error:', e)
    }
  }, [currentMapId, mapConfig, maps])

  // ── 创建标点模板 ──
  const handleCreateMarker = useCallback(async (markerData) => {
    try {
      const { editId, markerType, imageFilename, nameZh, category, visibility, baseConfig, specialFunction } = markerData
      if (editId) {
        // 编辑模式
        const markerUpdates = { marker_type: markerType, image_filename: imageFilename, name_zh: nameZh, category }
        if (visibility !== undefined) markerUpdates.visibility = visibility
        if (baseConfig !== undefined) markerUpdates.base_config = baseConfig || null
        if (specialFunction !== undefined) markerUpdates.special_function = specialFunction
        await window.electronAPI?.mapUpdateMarker(editId, markerUpdates)
      } else {
        // 新建模式
        const defaultVisibility = {
          sign: '3', teleport: '3', statue: '1,2,3', landmark: '3', enemy: '2,3', other: '1,2,3'
        }[markerType] || '1,2,3'
        // 查询当前分类最大 sort_order，新标点排在末尾
        const orderRes = await window.electronAPI?.mapQuery(
          "SELECT COALESCE(MAX(sort_order), -1) + 1 as next_order FROM map_markers WHERE category = ?",
          [category || '']
        )
        const nextOrder = orderRes?.data?.[0]?.next_order ?? 0
        const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
        const sql = "INSERT INTO map_markers (id, map_id, marker_type, image_filename, name_zh, category, sort_order, visibility, base_config, special_function, created_by_dev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)"
        await window.electronAPI?.mapExecBaseline(sql, [id, '__global__', markerType, imageFilename, nameZh, category || '', nextOrder, defaultVisibility, baseConfig || null, specialFunction || null])
      }
      setShowMarkerCreator(false)
      loadMarkers(currentMapId)
    } catch (e) {
      console.error('[MemoryHub] create marker error:', e)
    }
  }, [currentMapId])

  // ── 创建文本框 ──
  const handleCreateTextbox = useCallback(async (textData) => {
    try {
      // 分层模式检查
      const isSingleLayerMode = layerMode !== 'G' && layerMode !== 'B' && layerMode !== 'F'
      const isGroupLayerMode = layerMode === 'B' || layerMode === 'F'
      if (isGroupLayerMode) {
        alert('B/F 模式下无法添加文本框，请先切换到具体层级（如 B1、F1）或 G 层')
        return
      }
      if (textData.editId) {
        // 编辑模式
        await window.electronAPI?.mapUpdateTextbox(textData.editId, { text: textData.text, level: textData.level, layer_id: textData.layerId || null })
        setShowTextboxCreator(false)
        setTextboxEditData(null)
        loadMarkers(currentMapId)
        return
      }
      // 默认放在可视范围中心
      const cw = containerSize.current.w || 800
      const ch = containerSize.current.h || 600
      let worldX = (cw / 2 - viewCenter.x) / zoom
      let worldY = (ch / 2 - viewCenter.y) / zoom
      worldX = textData.worldX ?? worldX
      worldY = textData.worldY ?? worldY
      // 自动设置 layer_id：在特定层模式下创建时，关联到该层第一张地图
      let autoLayerId = textData.layerId || null
      if (!autoLayerId) {
        const isSingleLayerMode = layerMode !== 'G' && layerMode !== 'B' && layerMode !== 'F'
        if (isSingleLayerMode) {
          const targetLayer = configLayers.find(l => l.level === layerMode)
          if (targetLayer) autoLayerId = targetLayer.id
        }
      }
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
      const sql = "INSERT INTO map_textboxes (id, map_id, text, level, world_x, world_y, layer_id) VALUES (?, ?, ?, ?, ?, ?, ?)"
      await window.electronAPI?.mapExecBaseline(sql, [id, currentMapId, textData.text, textData.level, worldX, worldY, autoLayerId])
      setShowTextboxCreator(false)
      loadMarkers(currentMapId)
    } catch (e) {
      console.error('[MemoryHub] create textbox error:', e)
    }
  }, [currentMapId, viewCenter, zoom, configLayers, layerMode])

  // ── 容器尺寸观察（rAF 节流，避免高频触发重算） ──
  useEffect(() => {
    const el = mapContainerRef.current
    if (!el) return
    let resizeRaf = null
    const ro = new ResizeObserver(entries => {
      if (resizeRaf) return
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = null
        for (const entry of entries) {
          const { width, height } = entry.contentRect
          const viewport = { w: width, h: height }
          const previousViewport = containerSize.current
          const candidate = {
            x: viewCenterRef.current.x + (width - previousViewport.w) / 2,
            y: viewCenterRef.current.y + (height - previousViewport.h) / 2,
          }
          containerSize.current = viewport
          const constrained = constrainViewCenterForMap(
            candidate,
            zoomRef.current,
            mapConfigRef.current,
            viewport,
          ).viewCenter
          if (rafViewRef.current !== null) {
            cancelAnimationFrame(rafViewRef.current)
            rafViewRef.current = null
          }
          pendingViewRef.current = null
          viewCenterRef.current = constrained
          applyLiveTransform(zoomRef.current, constrained)
          setZoom(zoomRef.current)
          setViewCenter({ ...constrained })
          if (isDraggingRef.current) {
            dragStart.current = {
              x: dragStartMouseRef.current.x - constrained.x,
              y: dragStartMouseRef.current.y - constrained.y,
            }
          }
          refreshAnnotationWindow(zoomRef.current, constrained, {
            force: true,
            immediate: true,
            viewport,
          })
          setTilesTick(t => t + 1)
        }
      })
    })
    ro.observe(el)
    return () => {
      if (resizeRaf) cancelAnimationFrame(resizeRaf)
      ro.disconnect()
    }
  }, [applyLiveTransform, constrainViewCenterForMap, currentMapId, refreshAnnotationWindow])

  // ── 加载切片（带缓存+去重） ──
  const loadTile = useCallback(async (worldRow, worldCol, requestedWidth = 0) => {
    const key = `${worldRow}_${worldCol}`
    const gen = mapGenerationRef.current
    const tileSize = mapConfigRef.current?.tileSize || 512
    let finished = false
    const finish = (allowUpgrade = false) => {
      if (finished) return
      finished = true
      loadingTiles.current.delete(key)
      tileRemainingRef.current = Math.max(0, tileRemainingRef.current - 1)
      throttledSetTileRemaining(tileRemainingRef.current)
      if (!allowUpgrade || mapGenerationRef.current !== gen) return

      const wantedWidth = desiredTileWidthsRef.current.get(key) || 0
      const nextRequestWidth = getPendingTileRequestWidth({
        entry: tileCache.current.get(key),
        wantedWidth,
        tileSize,
      })
      if (
        nextRequestWidth !== null
        && !missingTiles.current.has(key)
      ) {
        tileRemainingRef.current += 1
        throttledSetTileRemaining(tileRemainingRef.current)
        tileQueueRef.current?.push(() => loadTile(worldRow, worldCol, nextRequestWidth))
      }
    }

    if (
      tileCacheSatisfies(tileCache.current.get(key), requestedWidth, tileSize)
      || missingTiles.current.has(key)
    ) {
      finish()
      return
    }
    if (loadingTiles.current.has(key)) return
    loadingTiles.current.set(key, requestedWidth || tileSize)
    hasLoadedAnyTileRef.current = true

    try {
      const res = await window.electronAPI?.mapReadTile(
        currentMapIdRef.current,
        worldRow,
        worldCol,
        requestedWidth,
      )
      // 如果地图已切换，丢弃此飞行中请求的结果
      if (mapGenerationRef.current !== gen) return

      if (res?.success && res.data) {
        const decodedWidth = requestedWidth || tileSize
        const existing = tileCache.current.get(key)
        if (!tileCacheSatisfies(existing, requestedWidth, tileSize)) {
          // 串行队列中先完成浏览器解码，再把 src 暴露给 React，避免多张大 PNG
          // 在同一绘制帧首次解码造成冷区域卡顿。
          const decodedImage = await preloadDecodedImage(res.data)
          if (mapGenerationRef.current !== gen) return
          tileCache.current.set(key, {
            data: res.data,
            width: decodedWidth,
            byteSize: res.data.length,
          })
          retainDecodedTile(
            decodedTilePreloadsRef.current,
            key,
            decodedImage,
            decodedWidth,
          )
        }
        const cachedEntry = tileCache.current.get(key)
        if (cachedEntry) {
          tilePublishQueueRef.current.set(key, cachedEntry)
          scheduleTilePublish()
          scheduleEvictDistantTiles()
        }
      } else if (res?.error?.includes('不存在')) {
        missingTiles.current.add(key)
        if (missingTiles.current.size > 5000) {
          const first = missingTiles.current.keys().next().value
          if (first) missingTiles.current.delete(first)
        }
      } else if (res?.error) {
        // 暂时保留去重标记，避免失败切片立即被反复重试。
        setTimeout(() => {
          if (mapGenerationRef.current === gen) finish()
        }, 5000)
        return
      }
      finish(true)
    } catch (_) {
      if (mapGenerationRef.current === gen) finish()
    }
  }, [scheduleTilePublish])

  // ── 切片缓存淘汰：按距离清除不可视切片 ──
  // ── 基于 ref 值计算可见切片 key 集合（避免 evictDistantTiles 使用过时的 viewCenter 状态） ──
  function getVisibleKeysRef() {
    return new Set(actualVisibleTileKeysRef.current)
  }

  // ── 缓存回收：优先延迟执行，缓存严重超限时立即执行 ──
  function scheduleEvictDistantTiles() {
    if (evictPendingRef.current) return
    // base64 缓存按实际字节预算，而不是按切片条数；不同分辨率不会把
    // 大地图缓存悄悄推到数 GB。
    if (getTileCacheBytes(tileCache.current) > TILE_CACHE_ENCODED_BUDGET * 1.25) {
      evictPendingRef.current = true
      evictDistantTiles()
      evictPendingRef.current = false
      return
    }
    evictPendingRef.current = true
    evictIdleRef.current = requestIdleCallback(() => {
      evictIdleRef.current = null
      evictPendingRef.current = false
      if (isDraggingRef.current || isZoomingRef.current || inertiaRunningRef.current) return
      evictDistantTiles()
    }, { timeout: 1000 })
  }

  function evictDistantTiles() {
    const now = Date.now()
    if (now - lastEvictTimeRef.current < 500) return
    lastEvictTimeRef.current = now
    let cacheBytes = getTileCacheBytes(tileCache.current)
    if (cacheBytes <= TILE_CACHE_ENCODED_BUDGET) return

    // 当前可见切片 key 集合（使用 ref 实时值，避免闭包中过时的 viewCenter 状态导致误淘汰）
    const visibleKeys = getVisibleKeysRef()
    // 世界坐标中心
    const cw = containerSize.current.w || 800
    const ch = containerSize.current.h || 600
    const worldCX = (cw / 2 - viewCenterRef.current.x) / zoomRef.current
    const worldCY = (ch / 2 - viewCenterRef.current.y) / zoomRef.current
    const tileSize = mapConfigRef.current?.tileSize || 512

    // 收集不可视缓存切片 & 距离
    const candidates = []
    for (const key of tileCache.current.keys()) {
      if (visibleKeys.has(key)) continue
      const [r, c] = key.split('_').map(Number)
      const tx = (c + 0.5) * tileSize
      const ty = (r + 0.5) * tileSize
      candidates.push({ key, dist: Math.hypot(tx - worldCX, ty - worldCY) })
    }

    // 按距离降序，删除最远的
    candidates.sort((a, b) => b.dist - a.dist)
    for (const candidate of candidates) {
      if (cacheBytes <= TILE_CACHE_ENCODED_BUDGET) break
      const entry = tileCache.current.get(candidate.key)
      cacheBytes -= typeof entry === 'string'
        ? entry.length
        : entry?.byteSize || entry?.data?.length || 0
      tileCache.current.delete(candidate.key)
      publishedTileCacheRef.current.delete(candidate.key)
      tilePublishQueueRef.current.delete(candidate.key)
      decodedTilePreloadsRef.current.delete(candidate.key)
      desiredTileWidthsRef.current.delete(candidate.key)
    }
  }

  // ── 计算当前视口可见的切片（使用 ref 值，避免拖拽/缩放期间因 state 变化而无效重算） ──
  const getVisibleTiles = useCallback(() => {
    const mc = mapConfigRef.current
    const mapId = currentMapIdRef.current
    if (!mc || !mapId) return []
    const tileSize = mc.tileSize || 512
    const { w: cw, h: ch } = containerSize.current
    if (cw === 0 || ch === 0) return []

    const vc = viewCenterRef.current
    const z = zoomRef.current

    // 世界坐标范围
    const worldLeft = -vc.x / z
    const worldTop = -vc.y / z
    const worldRight = (cw - vc.x) / z
    const worldBottom = (ch - vc.y) / z

    const minCol = Math.floor(worldLeft / tileSize)
    const maxCol = Math.ceil(worldRight / tileSize)
    const minRow = Math.floor(worldTop / tileSize)
    const maxRow = Math.ceil(worldBottom / tileSize)

    // 限制在地图范围内（tileRange 可含负数）
    const range = mc.tileRange
    const finalMinCol = range ? Math.max(minCol, range.minCol) : minCol
    const finalMaxCol = range ? Math.min(maxCol, range.maxCol) : maxCol
    const finalMinRow = range ? Math.max(minRow, range.minRow) : minRow
    const finalMaxRow = range ? Math.min(maxRow, range.maxRow) : maxRow

    const tiles = []
    const MAX_TILES = getVisibleTileLimit({
      tileSize,
      zoom: z,
      devicePixelRatio: window.devicePixelRatio,
    })
    for (let r = finalMinRow; r < finalMaxRow; r++) {
      for (let c = finalMinCol; c < finalMaxCol; c++) {
        tiles.push({ worldRow: r, worldCol: c })
      }
    }
    if (tiles.length <= MAX_TILES) return tiles
    const worldCX = (cw / 2 - vc.x) / z
    const worldCY = (ch / 2 - vc.y) / z
    tiles.sort((a, b) => {
      const da = Math.hypot(
        (a.worldCol + 0.5) * tileSize - worldCX,
        (a.worldRow + 0.5) * tileSize - worldCY,
      )
      const db = Math.hypot(
        (b.worldCol + 0.5) * tileSize - worldCX,
        (b.worldRow + 0.5) * tileSize - worldCY,
      )
      return da - db
    })
    return tiles.slice(0, MAX_TILES)
  }, [])

  // ── 拖拽/惯性滑行期间：实时把进入视口的切片推入空闲队列加载 ──
  // 长按拖拽不松手时 React state 不更新（visibleTiles 由 tilesTick 驱动），
  // 这里直接用 ref 实时值计算可视切片，并更新可见集合供发布/淘汰逻辑使用，
  // 同时把实时切片集合喂给 TileLayer 渲染（变化时才触发本层重渲染）。
  const syncDragTileLoading = useCallback(() => {
    const q = tileQueueRef.current
    const mc = mapConfigRef.current
    if (!q || !mc || !currentMapIdRef.current) return
    const tileSize = mc.tileSize || TILE_SIZE
    // 全图仍覆盖切片时无需加载（与正式加载通道阈值一致）
    if (useFullImageRef.current && zoomRef.current < fullImageThresholdRef.current * 0.7) {
      if (dragLiveTilesRef.current.length > 0) {
        dragLiveTilesRef.current = []
        dragLiveTilesKeysRef.current.clear()
        tileLayerRefreshRef.current?.()
      }
      return
    }
    const tiles = getVisibleTiles()
    actualVisibleTileKeysRef.current = new Set(
      tiles.map(({ worldRow, worldCol }) => `${worldRow}_${worldCol}`),
    )
    // 可见切片集合变化时才让 TileLayer 重渲染（仅本层，不牵动标注树）
    const liveKeys = dragLiveTilesKeysRef.current
    let liveChanged = tiles.length !== liveKeys.size
    if (!liveChanged) {
      for (const { worldRow, worldCol } of tiles) {
        if (!liveKeys.has(`${worldRow}_${worldCol}`)) { liveChanged = true; break }
      }
    }
    if (liveChanged) {
      dragLiveTilesKeysRef.current = new Set(tiles.map(({ worldRow, worldCol }) => `${worldRow}_${worldCol}`))
      dragLiveTilesRef.current = tiles
      tileLayerRefreshRef.current?.()
    }
    const requestedWidth = getTilePreloadRequestWidth({
      tileSize,
      zoom: zoomRef.current,
      devicePixelRatio: window.devicePixelRatio,
      useFullImage: useFullImageRef.current,
      fullImageThreshold: fullImageThresholdRef.current,
    })
    for (const { worldRow, worldCol } of tiles) {
      const key = `${worldRow}_${worldCol}`
      if (tileCacheSatisfies(tileCache.current.get(key), requestedWidth, tileSize)) continue
      if (
        loadingTiles.current.has(key)
        || missingTiles.current.has(key)
        || queuedTileKeysRef.current.has(key)
      ) continue
      queuedTileKeysRef.current.add(key)
      desiredTileWidthsRef.current.set(
        key,
        Math.max(desiredTileWidthsRef.current.get(key) || 0, requestedWidth || tileSize),
      )
      q.push(() => {
        queuedTileKeysRef.current.delete(key)
        return loadTile(worldRow, worldCol, requestedWidth)
      })
    }
  }, [getVisibleTiles, loadTile])
  syncDragTileLoadingRef.current = syncDragTileLoading

  // ── 初始化空闲加载队列 ──
  useEffect(() => {
    tileQueueRef.current = createIdleQueue({ timeout: 300 })
    return () => { tileQueueRef.current?.clear(); tileQueueRef.current = null }
  }, [])
  useEffect(() => () => {
    mapGenerationRef.current += 1
    cancelActiveInteraction({ updateState: false })
    publishedTileCacheRef.current.clear()
    tilePublishQueueRef.current.clear()
    actualVisibleTileKeysRef.current.clear()
    tileLayerCommitAckRef.current = null
    decodedTilePreloadsRef.current.clear()
    queuedTileKeysRef.current.clear()
    dragLiveTilesRef.current = []
    dragLiveTilesKeysRef.current.clear()
  }, [cancelActiveInteraction])
  // ── 同步 React state → DOM transform（缩放/拖拽停止后确保 transform 对齐） ──
  useLayoutEffect(() => {
    const liveView = viewCenterRef.current
    const stateIsCurrent = (
      Math.abs(zoom - zoomRef.current) < 1e-8 &&
      Math.abs(viewCenter.x - liveView.x) < 1e-4 &&
      Math.abs(viewCenter.y - liveView.y) < 1e-4
    )
    // React 的旧提交不得覆盖更新中的滚轮/拖拽矩阵；layout 阶段主动重写
    // 最新 ref，避免切图或初始化时短暂沿用旧地图 transform。
    if (!stateIsCurrent) {
      applyLiveTransform(zoomRef.current, liveView)
      return
    }
    settledZoomRef.current = zoom
    applyLiveTransform(zoom, viewCenter)
  }, [applyLiveTransform, zoom, viewCenter])

  // ── 可见切片变化时自动加载（通过空闲队列，不阻塞交互） ──
  const fullImgThreshold = effectiveFullImgThreshold
  // 非滚轮入口的兜底同步；滚轮/滑块已与 zoom state 在同一批次提交。
  useEffect(() => {
    syncFullImageMode(zoom)
  }, [syncFullImageMode, zoom])

  const visibleTiles = useMemo(() => {
    if (useFullImage && zoom < fullImgThreshold * 0.7) return []
    return getVisibleTiles()
  }, [currentMapId, fullImgThreshold, getVisibleTiles, tilesTick, useFullImage, zoom])
  useLayoutEffect(() => {
    actualVisibleTileKeysRef.current = new Set(
      visibleTiles.map(({ worldRow, worldCol }) => `${worldRow}_${worldCol}`),
    )
  }, [visibleTiles])

  // 已缓存但尚未发布的可见切片（例如交互期间完成的请求）在交互结束后
  // 进入同一分帧发布通道，不需要等下一次 I/O 回调。
  useEffect(() => {
    for (const { worldRow, worldCol } of visibleTiles) {
      const key = `${worldRow}_${worldCol}`
      const cachedEntry = tileCache.current.get(key)
      if (cachedEntry && publishedTileCacheRef.current.get(key) !== cachedEntry) {
        tilePublishQueueRef.current.set(key, cachedEntry)
      }
    }
    scheduleTilePublish()
  }, [scheduleTilePublish, visibleTiles])

  useEffect(() => {
    if (!currentMapId) return
    // 全图模式下仅在远离阈值时跳过加载；接近阈值时预加载切片以加速切换
    const preloadThreshold = fullImgThreshold * 0.7
    if (useFullImage && zoom < preloadThreshold) return
    const q = tileQueueRef.current
    if (!q) return
    // 仅缩放期间暂停切片加载（缩放改变目标分辨率）；
    // 拖拽/惯性期间队列保持运行，进入视口的切片由 syncDragTileLoading 推入。
    if (isZoomingRef.current) { q.pause(); return }
    q.resume()
    needsReloadRef.current = false
    const vc = viewCenterRef.current
    const z = zoomRef.current
    const tileSize = mapConfigRef.current?.tileSize || 512
    // 全图仍遮盖切片时，直接按预计切换点预热目标分辨率。这样 v6.7
    // 不会在 9.09% 才从 512px 批量升级到 1024px。
    const requestedWidth = getTilePreloadRequestWidth({
      tileSize,
      zoom: z,
      devicePixelRatio: window.devicePixelRatio,
      useFullImage,
      fullImageThreshold: fullImgThreshold,
    })
    const tiles = visibleTiles.filter(t => {
      const key = `${t.worldRow}_${t.worldCol}`
      const requiredWidth = requestedWidth || tileSize
      desiredTileWidthsRef.current.set(
        key,
        Math.max(desiredTileWidthsRef.current.get(key) || 0, requiredWidth),
      )
      return (
        !tileCacheSatisfies(tileCache.current.get(key), requestedWidth, tileSize)
        && !loadingTiles.current.has(key)
        && !missingTiles.current.has(key)
        && !queuedTileKeysRef.current.has(key)
      )
    })
    if (tiles.length === 0) return
    // 按距视口中心距离排序：优先加载中心附近的切片
    tiles.sort((a, b) => {
      const da = Math.abs((a.worldCol + 0.5) * tileSize + vc.x / z) + Math.abs((a.worldRow + 0.5) * tileSize + vc.y / z)
      const db = Math.abs((b.worldCol + 0.5) * tileSize + vc.x / z) + Math.abs((b.worldRow + 0.5) * tileSize + vc.y / z)
      return da - db
    })
    // 设置剩余切片计数（队列中 + 已经在途的）
    tileRemainingRef.current = tiles.length + loadingTiles.current.size
    throttledSetTileRemaining(tileRemainingRef.current)
    // 推入空闲队列串行加载（已按中心优先排序，队列串行执行保证足够的中断间隙）
    for (const tile of tiles) {
      const key = `${tile.worldRow}_${tile.worldCol}`
      queuedTileKeysRef.current.add(key)
      q.push(() => {
        queuedTileKeysRef.current.delete(key)
        return loadTile(tile.worldRow, tile.worldCol, requestedWidth)
      })
    }
  }, [visibleTiles, currentMapId, loadTile, useFullImage, zoom])

  const currentMap = maps.find(m => m.id === currentMapId)

  // ── template ID → template 的 Map，避免每次渲染时 O(n) find ──
  const templateMap = useMemo(() => {
    const map = new Map()
    for (const tpl of markerTemplates) {
      map.set(tpl.id, tpl)
    }
    return map
  }, [markerTemplates])

  // ── 标点可见性预过滤：不可见标点不进 DOM（消除 opacity-0 幽灵节点与无效事件处理器） ──
  const visibleMarkerData = useMemo(() => {
    if (!placedMarkers.length) return []
    const { 1: t1, 2: t2, 3: t3 } = effectiveLevelThresholds
    // 精英怪"地图首领/周本"模板预计算（仅在开关关闭时）
    const legendHidden = showLocalLegend ? null : new Set()
    if (legendHidden) {
      for (const tpl of markerTemplates) {
        if (tpl.marker_type !== 'enemy' || !tpl.special_function) continue
        try {
          const sf = typeof tpl.special_function === 'string' ? JSON.parse(tpl.special_function) : tpl.special_function
          if (sf?.isLocalLegend) legendHidden.add(tpl.id)
        } catch (_) {}
      }
    }
    const out = []
    for (const pm of placedMarkers) {
      const template = templateMap.get(pm.marker_id)
      if (!template) continue
      // 级别可见性（0/1/2/3 级按缩放阈值切换）
      const visLevels = (template.visibility || '3').split(',').map(Number)
      const levelVisible = visLevels.some(lv =>
        lv === 0 ? zoom <= t1 :
        lv === 1 ? zoom > t1 && zoom <= t2 :
        lv === 2 ? zoom > t2 && zoom <= t3 :
        lv === 3 ? zoom > t3 : false
      )
      if (!levelVisible) continue
      // 分层模式过滤：非 G 模式时，只有属于当前层级分层的标点才显示
      let layerMatch = true
      let isBaseMarker = false
      if (layerMode !== 'G') {
        layerMatch = pm.layer_id
          ? configLayers.some(l => l.id === pm.layer_id && (layerMode === 'B' ? l.level.startsWith('B') : layerMode === 'F' ? l.level.startsWith('F') : l.level === layerMode))
          : false
        // 基座分层地图的附属标点（非当前活跃层时保持显示并变暗）
        isBaseMarker = !layerMatch && !!pm.layer_id && configLayers.some(l => l.id === pm.layer_id && l.isBase)
      }
      if (!layerMatch && !isBaseMarker) continue
      // 视图模式 / 类型开关过滤
      if (viewMode === 'original') continue
      if (viewMode === 'compact' && template.marker_type !== 'statue') continue
      // 简洁视图额外隐藏秘境/炼武秘境（statue 类型但属于副本入口类标点）
      if (viewMode === 'compact' && template.marker_type === 'statue' && (
        (template.name_zh || '').includes('秘境') || /domain/i.test(template.image_filename || '')
      )) continue
      if (!showTeleportMarkers && template.marker_type === 'teleport') continue
      if (!showStatueMarkers && template.marker_type === 'statue') continue
      if (legendHidden && legendHidden.has(template.id)) continue
      out.push({ pm, template, isBaseMarker })
    }
    return out
  }, [placedMarkers, markerTemplates, templateMap, zoom, effectiveLevelThresholds, layerMode, configLayers, viewMode, showTeleportMarkers, showLocalLegend, showStatueMarkers])

  // ── 重叠标点检测：只统计当前可见（通过级别/分层/视图模式/开关过滤）的标点，
  // 隐藏级别的标点不再进入重叠组，避免菜单列出未显示的标点 ──
  const overlapGroups = useMemo(() => buildMarkerOverlapGroups({
    placedMarkers: visibleMarkerData.map(d => d.pm),
    markerTemplates,
    zoom,
    markerSize: effectiveMarkerSize,
  }), [visibleMarkerData, zoom, effectiveMarkerSize, markerTemplates])

  // 获取指定标点所在的重叠组（无重叠返回 null）
  const getOverlapGroup = useCallback((pm) => {
    return overlapGroups.get(pm.id) || null
  }, [overlapGroups])

  // ── 级别切换渐隐：离开可见集的标点/文本框保留 350ms 淡出（DOM 预过滤不丢动画） ──
  // 渲染期 state 调整（React 官方模式）：检测“上帧可见、本帧不可见”的项加入渐隐集，
  // 使离开的项在本帧继续挂载（opacity 过渡 1→0），定时器到期后再移除。
  const FADE_OUT_MS = 350
  const [fadingMarkers, setFadingMarkers] = useState(() => new Map())     // pm.id -> { item, until }
  const [fadingTextboxes, setFadingTextboxes] = useState(() => new Map()) // tb.id -> { item, until }
  const [fadeInMarkers, setFadeInMarkers] = useState(() => new Set())     // pm.id —— 内容变化时新进入的标点（一次性淡入）
  const [fadeInTextboxes, setFadeInTextboxes] = useState(() => new Set()) // tb.id
  const prevVisibleMarkerKeysRef = useRef(null)
  const prevVisibleMarkerItemsRef = useRef(null)
  const prevVisibleTextboxKeysRef = useRef(null)
  const prevVisibleTextboxItemsRef = useRef(null)
  const lastVisibleMarkerDataRef = useRef(null)   // 性能守卫：visibleMarkerData 引用未变时跳过
  const lastVisibleTextboxDataRef = useRef(null)

  // 渲染期：调整标点渐隐/渐显集（幂等；仅在集合变化时 setState，React 提交前立即重渲染）
  // 性能关键：缩放/平移期间 visibleMarkerData 引用每帧变化，但内容往往不变；
  // 用 Set.has 成员检查做 O(n) 内容等价判断（零分配），内容相同时不触发任何状态更新。
  if (lastVisibleMarkerDataRef.current !== visibleMarkerData) {
    lastVisibleMarkerDataRef.current = visibleMarkerData
    const prevKeys = prevVisibleMarkerKeysRef.current
    let contentChanged = true
    if (prevKeys && prevKeys.size === visibleMarkerData.length) {
      contentChanged = false
      for (const d of visibleMarkerData) {
        if (!prevKeys.has(d.pm.id)) { contentChanged = true; break }
      }
    }
    if (contentChanged) {
      const currentKeys = new Set(visibleMarkerData.map(d => d.pm.id))
      let changed = false
      const nextFading = new Map(fadingMarkers)
      if (prevKeys) {
        for (const key of prevKeys) {
          if (!currentKeys.has(key) && !nextFading.has(key)) {
            const item = prevVisibleMarkerItemsRef.current?.get(key)
            if (item) { nextFading.set(key, { item, until: Date.now() + FADE_OUT_MS }); changed = true }
          }
        }
      }
      for (const key of [...nextFading.keys()]) {
        if (currentKeys.has(key)) { nextFading.delete(key); changed = true }
      }
      // 新进入的标点 → 一次性淡入（仅内容变化时，避免缩放平移期间动画风暴）
      const nextFadeIn = new Set()
      for (const key of currentKeys) {
        if (!prevKeys?.has(key)) nextFadeIn.add(key)
      }
      if (nextFadeIn.size > 0 || fadeInMarkers.size > 0) changed = true
      if (changed) {
        setFadingMarkers(nextFading)
        setFadeInMarkers(nextFadeIn)
      }
      prevVisibleMarkerItemsRef.current = new Map(visibleMarkerData.map(d => [d.pm.id, d]))
      prevVisibleMarkerKeysRef.current = currentKeys
    }
  }

  // 定时器：渐隐集变化时，按最早到期时间安排移除
  useEffect(() => {
    if (fadingMarkers.size === 0) return
    const now = Date.now()
    let firstExpiry = Infinity
    for (const v of fadingMarkers.values()) firstExpiry = Math.min(firstExpiry, v.until)
    const t = setTimeout(() => {
      setFadingMarkers(prev => {
        const next = new Map(prev)
        const cutoff = Date.now()
        for (const [k, v] of next) if (v.until <= cutoff) next.delete(k)
        return next.size === prev.size ? prev : next
      })
    }, Math.max(0, firstExpiry - now))
    return () => clearTimeout(t)
  }, [fadingMarkers])

  // 定时器：淡入标记 350ms 后清除（动画早已完成，避免残留类名影响后续挂载）
  useEffect(() => {
    if (fadeInMarkers.size === 0) return
    const t = setTimeout(() => setFadeInMarkers(new Set()), FADE_OUT_MS)
    return () => clearTimeout(t)
  }, [fadeInMarkers])

  // ── 带 guard 的标注窗口：接近边缘时提前换窗，避免进入视口后才挂载 ──
  // 性能关键：无渐隐/渐显项时直接返回原数组（零 spread、零 Set 分配），
  // 缩放/平移期间每帧 visibleMarkerData 引用变化但内容不变，走零开销路径。
  const renderMarkerData = useMemo(() => {
    if (fadingMarkers.size === 0 && fadeInMarkers.size === 0) return visibleMarkerData
    const currentKeys = new Set(visibleMarkerData.map(d => d.pm.id))
    const out = visibleMarkerData.map(d => ({ ...d, fading: false, fadeIn: fadeInMarkers.has(d.pm.id) }))
    for (const [id, { item }] of fadingMarkers) {
      if (!currentKeys.has(id)) out.push({ ...item, fading: true })
    }
    return out
  }, [visibleMarkerData, fadingMarkers, fadeInMarkers])

  const viewportMarkers = useMemo(() => {
    if (!renderMarkerData.length || !annotationWindow) return renderMarkerData
    const out = []
    for (const item of renderMarkerData) {
      const { pm } = item
      if (pm.world_x >= annotationWindow.left && pm.world_x <= annotationWindow.right &&
          pm.world_y >= annotationWindow.top && pm.world_y <= annotationWindow.bottom) {
        out.push(item)
      }
    }
    return out
  }, [renderMarkerData, annotationWindow])

  // ── 文本框可见性预过滤（与标点同一套策略） ──
  const visibleTextboxData = useMemo(() => {
    if (!textboxes.length || !showTextLabels || viewMode === 'original') return []
    const { 1: t1, 2: t2, 3: t3 } = effectiveLevelThresholds
    const out = []
    for (const tb of textboxes) {
      // 按缩放级别显隐
      const levelMatch =
        tb.level === 0 ? zoom <= t1 :
        tb.level === 1 ? zoom > t1 && zoom <= t2 :
        tb.level === 2 ? zoom > t2 && zoom <= t3 :
        tb.level === 3 ? zoom > t3 : false
      if (!levelMatch) continue
      // 分层模式过滤
      let layerMatch = true
      let isBaseMarker = false
      if (layerMode === 'G') layerMatch = !tb.layer_id
      else {
        layerMatch = tb.layer_id
          ? configLayers.some(l => l.id === tb.layer_id && (layerMode === 'B' ? l.level.startsWith('B') : layerMode === 'F' ? l.level.startsWith('F') : l.level === layerMode))
          : false
        isBaseMarker = !layerMatch && !!tb.layer_id && configLayers.some(l => l.id === tb.layer_id && l.isBase)
      }
      if (!layerMatch && !isBaseMarker) continue
      out.push({ tb, isBaseMarker })
    }
    return out
  }, [textboxes, zoom, effectiveLevelThresholds, layerMode, configLayers, viewMode, showTextLabels])

  const renderTextboxData = useMemo(() => {
    if (fadingTextboxes.size === 0 && fadeInTextboxes.size === 0) return visibleTextboxData
    const out = visibleTextboxData.map(d => ({ ...d, fading: false, fadeIn: fadeInTextboxes.has(d.tb.id) }))
    const currentKeys = new Set(visibleTextboxData.map(d => d.tb.id))
    for (const [id, { item }] of fadingTextboxes) {
      if (!currentKeys.has(id)) out.push({ ...item, fading: true })
    }
    return out
  }, [visibleTextboxData, fadingTextboxes, fadeInTextboxes])

  const viewportTextboxes = useMemo(() => {
    if (!renderTextboxData.length || !annotationWindow) return renderTextboxData
    const out = []
    for (const item of renderTextboxData) {
      const { tb } = item
      if (tb.world_x >= annotationWindow.left && tb.world_x <= annotationWindow.right &&
          tb.world_y >= annotationWindow.top && tb.world_y <= annotationWindow.bottom) {
        out.push(item)
      }
    }
    return out
  }, [renderTextboxData, annotationWindow])

  // 渲染期：调整文本框渐隐/渐显集（visibleTextboxData 声明之后执行）
  if (lastVisibleTextboxDataRef.current !== visibleTextboxData) {
    lastVisibleTextboxDataRef.current = visibleTextboxData
    const prevKeys = prevVisibleTextboxKeysRef.current
    let contentChanged = true
    if (prevKeys && prevKeys.size === visibleTextboxData.length) {
      contentChanged = false
      for (const d of visibleTextboxData) {
        if (!prevKeys.has(d.tb.id)) { contentChanged = true; break }
      }
    }
    if (contentChanged) {
      const currentKeys = new Set(visibleTextboxData.map(d => d.tb.id))
      let changed = false
      const nextFading = new Map(fadingTextboxes)
      if (prevKeys) {
        for (const key of prevKeys) {
          if (!currentKeys.has(key) && !nextFading.has(key)) {
            const item = prevVisibleTextboxItemsRef.current?.get(key)
            if (item) { nextFading.set(key, { item, until: Date.now() + FADE_OUT_MS }); changed = true }
          }
        }
      }
      for (const key of [...nextFading.keys()]) {
        if (currentKeys.has(key)) { nextFading.delete(key); changed = true }
      }
      const nextFadeIn = new Set()
      for (const key of currentKeys) {
        if (!prevKeys?.has(key)) nextFadeIn.add(key)
      }
      if (nextFadeIn.size > 0 || fadeInTextboxes.size > 0) changed = true
      if (changed) {
        setFadingTextboxes(nextFading)
        setFadeInTextboxes(nextFadeIn)
      }
      prevVisibleTextboxItemsRef.current = new Map(visibleTextboxData.map(d => [d.tb.id, d]))
      prevVisibleTextboxKeysRef.current = currentKeys
    }
  }

  // 定时器：文本框渐隐集变化时，按最早到期时间安排移除
  useEffect(() => {
    if (fadingTextboxes.size === 0) return
    const now = Date.now()
    let firstExpiry = Infinity
    for (const v of fadingTextboxes.values()) firstExpiry = Math.min(firstExpiry, v.until)
    const t = setTimeout(() => {
      setFadingTextboxes(prev => {
        const next = new Map(prev)
        const cutoff = Date.now()
        for (const [k, v] of next) if (v.until <= cutoff) next.delete(k)
        return next.size === prev.size ? prev : next
      })
    }, Math.max(0, firstExpiry - now))
    return () => clearTimeout(t)
  }, [fadingTextboxes])

  // 定时器：文本框淡入标记 350ms 后清除
  useEffect(() => {
    if (fadeInTextboxes.size === 0) return
    const t = setTimeout(() => setFadeInTextboxes(new Set()), FADE_OUT_MS)
    return () => clearTimeout(t)
  }, [fadeInTextboxes])

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-surface-950/80">
        <div className="flex flex-col items-center gap-4 px-6 py-8 rounded-xl bg-surface-900/60 border border-white/5">
          <div className="w-10 h-10 rounded-full border-[3px] border-amber-500/30 border-t-amber-400 animate-spin" />
          <span className="text-sm text-surface-300 font-medium">加载地图数据中…</span>
        </div>
      </div>
    )
  }

  return (
    <div ref={memoryHubRootRef} data-memoryhub-root className="h-full flex flex-col bg-surface-950/90 select-none relative">
      {/* ── 顶部工具栏 ── */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5 bg-surface-900/50 shrink-0">
        {/* 地图选择 */}
        <div className="relative">
          <button
            onClick={() => setShowMapMenu(s => !s)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-sm text-surface-200 transition-colors"
          >
            <MapIcon className="w-4 h-4 text-amber-400" />
            <span className="font-medium">{currentMap?.name_zh || '未选择地图'}</span>
            <ChevronDown className="w-3.5 h-3.5 text-surface-500" />
          </button>
          {showMapMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowMapMenu(false)} />
              <div className="absolute top-full left-0 mt-1 z-20 w-48 py-1 rounded-xl bg-surface-900/95 backdrop-blur-xl border border-white/10 shadow-2xl animate-scale-in">
                {maps.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-surface-500">暂无地图</div>
                ) : (
                  maps.map(m => (
                    <button
                      key={m.id}
                      onClick={() => handleSelectMap(m.id)}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors ${
                        m.id === currentMapId ? 'text-amber-400 bg-amber-500/10' : 'text-surface-300 hover:bg-white/5'
                      }`}
                    >
                      <MapIcon className="w-3.5 h-3.5" />
                      {m.name_zh}
                    </button>
                  ))
                )}
                {devMode && (
                  <div className="border-t border-white/5 mt-1 pt-1">
                    <button onClick={() => { setShowMapMenu(false); handleCreateMap() }} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-emerald-400 hover:bg-emerald-500/10 transition-colors">
                      <Plus className="w-3.5 h-3.5" />
                      创建地图
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="w-px h-5 bg-white/10" />

        {/* 缩放控制 */}
        <div className="flex items-center gap-1">
          <button onClick={handleZoomOut} className="p-1.5 rounded-lg hover:bg-white/10 text-surface-400 hover:text-white transition-colors" title="缩小">
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-[11px] text-surface-400 w-12 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
          <button onClick={handleZoomIn} className="p-1.5 rounded-lg hover:bg-white/10 text-surface-400 hover:text-white transition-colors" title="放大">
            <ZoomIn className="w-4 h-4" />
          </button>
        </div>

        {/* 缩放滑块 */}
        <input
          type="range"
          min="0.01"
          max={getMaxNativeZoom(mapConfig)}
          step="0.01"
          value={zoom}
          onChange={handleZoomSlider}
          className="w-20 h-1 accent-amber-500 cursor-pointer"
        />

        {/* 视图模式切换 */}
        <div className="flex items-center gap-0.5">
          {[
            { mode: 'default', label: '默认' },
            { mode: 'compact', label: '简洁' },
            { mode: 'original', label: '原图' },
          ].map(({ mode, label }) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                viewMode === mode
                  ? mode === 'compact' ? 'bg-amber-500/20 text-amber-400' : mode === 'original' ? 'bg-surface-800/70 text-surface-400' : 'bg-white/10 text-surface-200'
                  : 'text-surface-500 hover:text-surface-300 hover:bg-white/5'
              }`}
              title={`${label}视图${mode === 'default' ? '（全部标点）' : mode === 'compact' ? '（隐藏传送点，显示文本框）' : '（隐藏标点）'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ── 默认模式标点显示开关 ── */}
        <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-lg bg-surface-900/40 border border-white/5">
          {[
            { key: 'teleport', label: '传送点', state: showTeleportMarkers, setter: setShowTeleportMarkers, configKey: 'mapShowTeleportMarkers' },
            { key: 'statue', label: '神像', state: showStatueMarkers, setter: setShowStatueMarkers, configKey: 'mapShowStatueMarkers' },
            { key: 'legend', label: '传奇', state: showLocalLegend, setter: setShowLocalLegend, configKey: 'mapShowLocalLegend' },
            { key: 'text', label: '文字', state: showTextLabels, setter: setShowTextLabels, configKey: 'mapShowTextLabels' },
          ].map(({ key, label, state, setter, configKey }) => (
            <button
              key={key}
              onClick={() => {
                const next = !state
                setter(next)
                window.electronAPI?.setUserConfig(configKey, next).catch(() => {})
              }}
              className={`px-1.5 py-0.5 rounded text-[9px] font-medium transition-colors ${
                state ? 'bg-amber-500/15 text-amber-400' : 'text-surface-500 hover:text-surface-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ── 分层地图层级滑块 ── */}
        {(hasBLayers || hasFLayers) && (() => {
          // 构建滑块选项：B... | G | F...
          const sliderOptions = []
          if (hasBLayers) sliderOptions.push('B')
          sliderOptions.push('G')
          if (hasFLayers) sliderOptions.push('F')
          return (
            <div className="flex items-center gap-0.5 bg-surface-900/60 rounded-lg p-0.5 border border-white/5">
              {sliderOptions.map(opt => (
                <button
                  key={opt}
                  onClick={() => setLayerMode(opt === 'G' ? 'G' : opt)}
                  onMouseEnter={(e) => {
                    if (layerMode !== opt) e.currentTarget.classList.add('bg-white/10')
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.classList.remove('bg-white/10')
                  }}
                  className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                    layerMode === opt || (opt === 'G' && layerMode === 'G')
                      ? 'bg-purple-500/20 text-purple-400'
                      : 'text-surface-500 hover:text-surface-300'
                  }`}
                  title={opt === 'G' ? '地面层' : opt === 'B' ? '地下分层' : '地上分层'}
                >
                  {opt}
                </button>
              ))}
            </div>
          )
        })()}

        <div className="flex-1" />

        {/* 默认视角按钮（始终可见） */}
        {(() => {
          if (devMode) {
            return (
              <button onClick={handleToggleDefaultView}
                className={`p-1.5 rounded-lg transition-colors ${defaultViewActive ? 'bg-amber-500/20 text-amber-400' : 'hover:bg-white/10 text-surface-400 hover:text-amber-400'}`}
                title={defaultViewActive ? '点击关闭（不保存）' : '设置默认视角（定点选取）'}>
                <Crosshair className="w-4 h-4" />
              </button>
            )
          }
          // 非开发模式：一键回到默认视角（需要已设置默认视角）
          if (!mapConfig?.defaultView) return null
          return (
            <button onClick={handleGoToDefaultView}
              className="p-1.5 rounded-lg hover:bg-white/10 text-surface-400 hover:text-amber-400 transition-colors"
              title="回到默认视角">
              <Crosshair className="w-4 h-4" />
            </button>
          )
        })()}

        {/* 开发者工具 */}
        {devMode && (
          <>
            <button onClick={() => setShowMarkerCreator(true)} className="p-1.5 rounded-lg hover:bg-white/10 text-surface-400 hover:text-emerald-400 transition-colors" title="添加标点">
              <Pin className="w-4 h-4" />
            </button>
            <button onClick={() => setShowTextboxCreator(true)} className="p-1.5 rounded-lg hover:bg-white/10 text-surface-400 hover:text-blue-400 transition-colors" title="添加文本框">
              <Type className="w-4 h-4" />
            </button>
            <button onClick={() => {
              const vp = containerSize.current
              const cx = Math.round((vp.w / 2 - viewCenter.x) / zoom)
              const cy = Math.round((vp.h / 2 - viewCenter.y) / zoom)
              setLayerEditData({ _defaultX: cx, _defaultY: cy })
              setShowLayerManager(true)
            }} className="p-1.5 rounded-lg hover:bg-white/10 text-surface-400 hover:text-purple-400 transition-colors" title="管理分层地图">
              <Layers className="w-4 h-4" />
            </button>
            <div className="w-px h-5 bg-white/10" />
          </>
        )}

        {/* 设置 */}
        <button
          onClick={() => setShowSettings(s => !s)}
          className="p-1.5 rounded-lg hover:bg-white/10 text-surface-400 hover:text-white transition-colors"
          title="设置"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>

      {/* ── 切片进度提示 ── */}
      {slicing && (
        <div className="flex items-center gap-2 px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 text-xs text-amber-400">
          <div className="w-4 h-4 rounded-full border-2 border-amber-400 border-t-transparent animate-spin" />
          {sliceProgress}
        </div>
      )}

      {/* ── 地图主区域 ── */}
      <div
        ref={mapContainerRef}
        data-memoryhub-viewport
        className="flex-1 relative overflow-hidden"
        onMouseDown={handleMouseDown}
        onContextMenu={handleMapContextMenu}
        onDragStart={(e) => e.preventDefault()}
        style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
      >
        {!currentMap || !mapConfig ? (
          <div className="h-full flex flex-col items-center justify-center text-surface-500">
            <Compass className="w-16 h-16 mb-4 opacity-20" />
            {maps.length === 0 ? (
              <>
                <p className="text-sm mb-1">暂无地图数据</p>
                <p className="text-xs opacity-60">开发者模式下可创建并切片地图</p>
              </>
            ) : (
              <p className="text-sm">请选择一张地图</p>
            )}
          </div>
        ) : (
          <div
            ref={mapTransformRef}
            data-memoryhub-transform
            className="absolute"
            style={{
              transformOrigin: '0 0',
              backgroundColor: '#0f172a',  // surface-950，防止未加载区域显示黑色
            }}
          >
            {/* ── 低缩放全图（zoom < FULL_IMG_THRESHOLD 时替代切片） ── */}
            {fullImageSrc && mapConfig?.fullImage && (
              <FullMapImage
                fullImageSrc={fullImageSrc}
                anchorA={mapConfig.anchorA}
                scale={mapConfig.scale}
                mapW={mapConfig.mapW}
                mapH={mapConfig.mapH}
                opacity={1}
              />
            )}

            {/* 切片网格（在全图上方，局部刷新，不牵动标注树） */}
            {(() => {
              // 切片层使用「切片像素空间」：片内以整数像素布局（无逐片小数拉伸），
              // 世界↔像素换算由本层统一 scale(tileSize/outPx) 完成。单次变换保证
              // 任意相邻切片接缝像素级对齐（浮点 tileSize 的错位问题在此根治）。
              const outPx = mapConfig?.srcPxPerTile || mapConfig?.tileSize || TILE_SIZE
              const layerScale = outPx > 0 ? (mapConfig?.tileSize || outPx) / outPx : 1
              return (
                <div
                  className="absolute left-0 top-0"
                  style={{
                    transform: `scale(${layerScale})`,
                    transformOrigin: '0 0',
                    willChange: 'transform',
                    pointerEvents: 'none',
                    zIndex: 1,
                  }}
                >
                  <TileLayer
                    visibleTiles={visibleTiles}
                    publishedCacheRef={publishedTileCacheRef}
                    mapConfigRef={mapConfigRef}
                    tileLayerReady={tileLayerReady}
                    refreshRef={tileLayerRefreshRef}
                    commitAckRef={tileLayerCommitAckRef}
                    dragLiveTilesRef={dragLiveTilesRef}
                    isDraggingRef={isDraggingRef}
                    inertiaRunningRef={inertiaRunningRef}
                  />
                </div>
              )
            })()}

            {/* ── 分层地图模式：G 层变暗覆盖（匹配 FullMapImage 坐标：left=-ax*scale, top=-ay*scale, w=mapW*scale, h=mapH*scale） ── */}
            {/* ── G 层变暗覆盖（渐隐渐现） ── */}
            {(() => {
              const ax = mapConfig?.anchorA?.[0] || 0
              const ay = mapConfig?.anchorA?.[1] || 0
              const sc = mapConfig?.scale || 1
              const mw = mapConfig?.mapW || 0
              const mh = mapConfig?.mapH || 0
              return (
                <div className="absolute z-10 pointer-events-none transition-opacity duration-300"
                  style={{
                    left: -ax * sc,
                    top: -ay * sc,
                    width: mw * sc,
                    height: mh * sc,
                    backgroundColor: 'rgba(0,0,0,0.45)',
                    opacity: layerMode !== 'G' ? 1 : 0,
                  }} />
              )
            })()}

            {/* ── 分层地图渲染（渐隐渐现） ── */}
            {configLayers.length > 0 && (() => {
              return configLayers
                .slice()
                .sort((a, b) => {
                  const aPref = a.level.match(/^([BF])(\d+)/i)
                  const bPref = b.level.match(/^([BF])(\d+)/i)
                  if (aPref && bPref) {
                    if (aPref[1] !== bPref[1]) return aPref[1] === 'B' ? -1 : 1
                    const aNum = parseInt(aPref[2])
                    const bNum = parseInt(bPref[2])
                    // 同层级内基座排在前面（渲染靠后/在底部）
                    if (a.isBase !== b.isBase) return a.isBase ? -1 : 1
                    return aPref[1] === 'B' ? bNum - aNum : aNum - bNum
                  }
                  return (a.zIndex || 0) - (b.zIndex || 0)
                })
                .map((layer) => {
                  const halfW = (layer.width || 500) / 2
                  const halfH = (layer.height || 500) / 2
                  const active = isLevelActive(layer.level)
                  const asBase = isBaseBackground(layer)
                  // 汇总模式下，基座层显示在活跃层底部（不变暗）
                  const isBaseInGroup = active && layer.isBase && (layerMode === 'B' || layerMode === 'F')
                  const visible = active || asBase
                  const layerZ = isBaseInGroup ? 12 : (active ? 20 : (asBase ? 12 : 20))
                  const layerOpacity = isBaseInGroup ? 1 : (active ? 1 : (asBase ? 0.4 : 0))
                  const isHoverZoom = hoveredLayerId === layer.id && (layerMode !== 'G' && layerMode !== 'B' && layerMode !== 'F') && effectiveLayerHoverZoom
                  return (
                    <div
                      key={layer.id}
                      data-layer-id={layer.id}
                      className="absolute"
                      style={{
                        left: layer.worldX - halfW,
                        top: layer.worldY - halfH,
                        width: layer.width || 500,
                        height: layer.height || 500,
                        zIndex: layerZ,
                        opacity: layerOpacity,
                        transition: 'opacity 0.3s ease, z-index 0s',
                        pointerEvents: active ? 'auto' : 'none',
                      }}
                      onMouseEnter={() => setHoveredLayerId(layer.id)}
                      onMouseLeave={() => setHoveredLayerId(null)}
                      onMouseDown={(e) => {
                        if (e.button === 1 && devMode && layerMode !== 'G' && layerMode !== 'B' && layerMode !== 'F') {
                          e.preventDefault()
                          e.stopPropagation()
                          const pos = clampMenuPos(e.clientX, e.clientY, 120, 88)
                          setLayerMenu({ layer, editIndex: configLayers.indexOf(layer), x: pos.x, y: pos.y })
                        }
                      }}
                    >
                      <img
                        src={`local-media://${(layer.imageFilename || '').trim()}`}
                        alt={layer.name || '分层地图'}
                        className={`w-full h-full object-contain transition-all duration-200 ${
                          isHoverZoom ? 'scale-105 brightness-110' : ''
                        }`}
                        style={{
                          filter: asBase ? 'brightness(0.5) saturate(0.5)' : (isHoverZoom ? 'brightness(1.1) drop-shadow(0 8px 16px rgba(0,0,0,0.5))' : 'none'),
                        }}
                        draggable={false}
                      />
                    </div>
                  )
                })
            })()}

            {/* 标点渲染（memo 网格：可见性已预过滤，隐藏标点不进入 DOM） */}
            <MarkerGrid
              markers={viewportMarkers}
              templateMap={templateMap}
              zoom={zoom}
              effectiveMarkerSize={effectiveMarkerSize}
              effectiveLayerHoverZoom={effectiveLayerHoverZoom}
              layerMode={layerMode}
              configLayers={configLayers}
              hoveredLayerId={hoveredLayerId}
              overlapHighlightedId={overlapHighlightedId}
              movingMarkerId={movingMarkerId}
              overlapGroups={overlapGroups}
              devMode={devMode}
              currentMapId={currentMapId}
              mapContainerRef={mapContainerRef}
              zoomRef={zoomRef}
              loadMarkers={loadMarkers}
              clampMenuPos={clampMenuPos}
              setPlacedMarkers={setPlacedMarkers}
              setHoveredMarker={scheduleHoveredMarker}
              setHoveredLayerId={setHoveredLayerId}
              setMovingMarkerId={setMovingMarkerId}
              setOverlapMenu={setOverlapMenu}
              setDetailModal={setDetailModal}
              setSidePanel={setSidePanel}
              setPlacedMenu={setPlacedMenu}
              setLayerMode={setLayerMode}
            />

            {/* 文本框渲染（memo 网格：按缩放级别与开关预过滤） */}
            <TextboxGrid
              markers={viewportTextboxes}
              zoom={zoom}
              effectiveTextboxFontSizes={effectiveTextboxFontSizes}
              effectiveLayerHoverZoom={effectiveLayerHoverZoom}
              layerMode={layerMode}
              configLayers={configLayers}
              hoveredLayerId={hoveredLayerId}
              devMode={devMode}
              movingTextboxId={movingTextboxId}
              currentMapId={currentMapId}
              viewCenterRef={viewCenterRef}
              mapContainerRef={mapContainerRef}
              zoomRef={zoomRef}
              setHoveredLayerId={setHoveredLayerId}
              setTextboxMenu={setTextboxMenu}
              loadMarkers={loadMarkers}
              clampMenuPos={clampMenuPos}
            />

            {/* ── 定点十字准星（在 transform 内，世界坐标定位） ── */}
            {defaultViewActive && (() => {
              const pin = defaultViewPinRef.current
              // 动态调节十字准星大小：屏幕目标 32px，范围 16~80px
              const targetScreen = 32
              const cssSize = Math.max(16, Math.min(180, targetScreen / Math.max(zoom, 0.05)))
              const half = cssSize / 2
              return (
                <div className="absolute cursor-grab active:cursor-grabbing z-40"
                  style={{ left: pin.x - half, top: pin.y - half, width: cssSize, height: cssSize }}
                  onMouseDown={(e) => {
                    e.preventDefault(); e.stopPropagation()
                    const startX = e.clientX; const startY = e.clientY
                    const startPX = pin.x; const startPY = pin.y
                    const onMove = (ev) => {
                      const z = zoomRef.current
                      const dx = (ev.clientX - startX) / z
                      const dy = (ev.clientY - startY) / z
                      defaultViewPinRef.current = { x: startPX + dx, y: startPY + dy, zoom: defaultViewPinRef.current.zoom }
                      setDefaultViewTick(t => t + 1)
                    }
                    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
                    window.addEventListener('mousemove', onMove)
                    window.addEventListener('mouseup', onUp)
                  }}>
                  <svg width={cssSize} height={cssSize} viewBox="0 0 32 32"
                    style={{ filter: 'drop-shadow(0 0 6px rgba(245,158,11,0.8))' }}>
                    <circle cx="16" cy="16" r="12" fill="none" stroke="#f59e0b" strokeWidth="2.5" />
                    <line x1="16" y1="2" x2="16" y2="8" stroke="#f59e0b" strokeWidth="2.5" />
                    <line x1="16" y1="24" x2="16" y2="30" stroke="#f59e0b" strokeWidth="2.5" />
                    <line x1="2" y1="16" x2="8" y2="16" stroke="#f59e0b" strokeWidth="2.5" />
                    <line x1="24" y1="16" x2="30" y2="16" stroke="#f59e0b" strokeWidth="2.5" />
                  </svg>
                </div>
              )
            })()}
          </div>
        )}

      {/* ── switch_map 侧栏（在地图容器内） ── */}
      {sidePanel && (
        <>
          <div className="absolute inset-0 z-30"
            onMouseDown={(e) => { sidePanelDownPos.current = { x: e.clientX, y: e.clientY } }}
            onClick={(e) => {
              if (e.target !== e.currentTarget) return
              const dx = e.clientX - sidePanelDownPos.current.x
              const dy = e.clientY - sidePanelDownPos.current.y
              if (Math.abs(dx) < 4 && Math.abs(dy) < 4) setSidePanel(null)
            }} />
          <div className="absolute right-0 top-0 bottom-0 w-72 z-40 bg-surface-900 border-l border-white/10 shadow-2xl flex flex-col animate-slide-in-right">
            <div className="p-4 flex items-center gap-3" style={{ background: 'var(--primary-900, #451a03)' }}>
              {sidePanel.markerImage ? (
                <img src={`local-media://${(sidePanel.markerImage || '').trim()}`} className="w-10 h-10 rounded-lg object-cover shrink-0" />
              ) : sidePanel.sfImage ? (
                <img src={sidePanel.sfImage} className="w-10 h-10 rounded-lg object-cover shrink-0" />
              ) : null}
              <div className="min-w-0 flex-1 flex items-center gap-1.5">
                <p className="text-sm font-medium text-white truncate">{sidePanel.name}</p>
                {sidePanel.customName && (
                  <p className="text-[10px] text-white/50 truncate shrink-0">{sidePanel.customName}</p>
                )}
              </div>
              <button onClick={() => setSidePanel(null)} className="text-white/60 hover:text-white shrink-0">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4" style={{ background: 'var(--primary-950, #230d02)' }}>
              {sidePanel.sfImage && <img src={sidePanel.sfImage} className="w-full rounded-lg mb-3 object-cover" />}
              {sidePanel.description && <p className="text-xs text-white/70 leading-relaxed">{sidePanel.description}</p>}
            </div>
            <div className="p-4 border-t border-white/5">
              <button onClick={() => { handleSelectMap(sidePanel.targetMapId); setSidePanel(null) }}
                className="w-full py-2.5 rounded-xl bg-amber-500/20 text-amber-400 text-sm font-medium hover:bg-amber-500/30 transition-colors">
                查看地图
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── 标定弹窗 ── */}
      {calibration && (
        <MapCalibration
          previewData={calibration.previewData}
          previewW={calibration.previewW}
          previewH={calibration.previewH}
          imageW={calibration.imageW}
          imageH={calibration.imageH}
          srcPath={calibration.srcPath}
          mapName={calibration.isUpdate ? (maps.find(m => m.id === currentMapId)?.name_zh || '') : (calibration.srcName || '')}
          initialDistance={calibration.isUpdate ? calibration.initialDistance : undefined}
          onConfirm={calibration.isUpdate ? handleMapUpdateConfirm : handleCalibrationConfirm}
          onCancel={() => setCalibration(null)}
        />
      )}

      {/* ── 右侧层级切换栏（分层模式） ── */}
      {configLayers.length > 0 && layerMode !== 'G' && (
        <div className="absolute right-2 top-2 bottom-2 z-30 flex flex-col gap-0.5 pointer-events-none">
          <div className="flex-1 flex flex-col justify-center gap-0.5 pointer-events-auto">
            {(() => {
              // 收集所有层级按钮（G 在底部，其他层级在上方）
              const bLevels = [...new Set(configLayers.filter(l => l.level.startsWith('B')).map(l => l.level))].sort((a, b) => {
                const aNum = parseInt(a.match(/\d+/)?.[0] || '0')
                const bNum = parseInt(b.match(/\d+/)?.[0] || '0')
                return aNum - bNum // B1 → B5 从上到下（G 在顶部）
              })
              const fLevels = [...new Set(configLayers.filter(l => l.level.startsWith('F')).map(l => l.level))].sort((a, b) => {
                const aNum = parseInt(a.match(/\d+/)?.[0] || '0')
                const bNum = parseInt(b.match(/\d+/)?.[0] || '0')
                return bNum - aNum // F5 → F1 从下到上（G 在底部）
              })
              const levels = []
              if (layerMode.startsWith('B')) {
                // B 模式：G 在顶部，B1～B5 在下方
                levels.push('G')
                levels.push('B')
                levels.push(...bLevels)
              } else if (layerMode.startsWith('F')) {
                // F 模式：F5～F1 在上方，G 在底部
                levels.push(...fLevels)
                levels.push('F')
                levels.push('G')
              }
              return levels.map(lvl => (
                <button
                  key={lvl}
                  onClick={() => setLayerMode(lvl)}
                  className={`px-2 py-1.5 rounded text-[10px] font-medium transition-all border ${
                    layerMode === lvl || (lvl === 'G' && layerMode === 'G')
                      ? 'bg-purple-500/20 border-purple-500/40 text-purple-400 shadow-lg'
                      : 'bg-surface-900/80 border-white/5 text-surface-400/70 hover:bg-surface-800/60 hover:text-surface-200'
                  }`}
                  title={lvl === 'G' ? '关闭分层模式' : `切换到 ${lvl} 层`}
                >
                  {lvl}
                </button>
              ))
            })()}
          </div>
        </div>
      )}

      {/* ── 分层地图悬停名称提示（地图可视区右上角） ── */}
      {hoveredLayerId && layerMode !== 'G' && layerMode !== 'B' && layerMode !== 'F' && (() => {
        const hl = configLayers.find(l => l.id === hoveredLayerId)
        if (!hl) return null
        return (
          <div className="absolute top-2 right-2 z-40 pointer-events-none">
            <div className="px-3 py-1.5 rounded-lg bg-surface-900/90 border border-white/10 backdrop-blur-sm shadow-xl">
              <span className="text-xs font-medium text-purple-400">{hl.level}</span>
              <span className="text-xs text-surface-300 ml-2">{hl.name || '未命名'}</span>
            </div>
          </div>
        )
      })()}
      </div>

      {/* ── tooltip 详情弹窗（位于地图容器外：覆盖整个摹忆中枢小程序内容区，
            滚轮只作用于弹窗滚动条，不会透传给地图缩放；不覆盖窗口标题栏） ── */}
      {detailModal && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setDetailModal(null)}>
          <div className="bg-surface-900 border border-white/10 rounded-2xl shadow-2xl max-w-xl w-full mx-6 max-h-full flex flex-col overflow-hidden animate-scale-in" onClick={e => e.stopPropagation()}>
            {/* 头部 */}
            <div className="flex items-center gap-3 p-5 border-b border-white/10 shrink-0">
              {detailModal.imageFilename && (
                <img src={`local-media://${(detailModal.imageFilename || '').trim()}`} className="w-10 h-10 rounded-lg object-cover shrink-0" />
              )}
              <p className="text-base font-semibold text-white truncate flex-1">{detailModal.name}</p>
              <button onClick={() => setDetailModal(null)} className="text-white/50 hover:text-white shrink-0">
                <X className="w-5 h-5" />
              </button>
            </div>
            {/* 内容区 */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {detailModal.tooltip ? (
                <TooltipSections tooltip={detailModal.tooltip} catalog={entryCatalog} onJump={handleTooltipJump} onImageClick={setLightboxFile} />
              ) : (
                <>
                  {detailModal.detailImage && (
                    <img src={`local-media://${(detailModal.detailImage || '').trim()}`}
                      onClick={() => setLightboxFile(detailModal.detailImage)}
                      className="w-full max-h-72 rounded-xl object-cover cursor-zoom-in hover:ring-2 hover:ring-amber-500/50 transition-shadow" />
                  )}
                  {detailModal.body ? (
                    <p className="text-sm text-surface-300 whitespace-pre-wrap leading-relaxed">{detailModal.body}</p>
                  ) : (
                    <p className="text-sm text-surface-500 italic">暂无详情描述</p>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── 详情图片观赏（Lightbox，挂载到摹忆中枢根节点内，不遮挡窗口标题栏） ── */}
      {lightboxFile && (
        <Lightbox
          filename={lightboxFile}
          label={detailModal?.name || ''}
          onClose={() => setLightboxFile(null)}
          portalTo={memoryHubRootRef.current}
        />
      )}

      {/* ── 分层地图悬停名称提示（右上角） ── */}
      {/* ── 切片加载提示（固定居中的系统提示，不受地图变换影响） ── */}
      {tileRemaining > 0 && !initialTileLoadDoneRef.current && (
        <div className="fixed inset-0 flex items-center justify-center pointer-events-none z-50">
          <div className="px-5 py-3 rounded-xl bg-surface-900/90 border border-white/10 backdrop-blur-sm shadow-xl">
            <span className="text-sm text-surface-300">加载切片中… {tileRemaining} 张</span>
          </div>
        </div>
      )}

      {/* ── 默认视角定点模式（底部操作栏，十字准星已在 transform 内） ── */}
      {defaultViewActive && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-4 py-2 rounded-xl bg-surface-900/90 backdrop-blur-md border border-amber-500/30 shadow-xl">
          <Crosshair className="w-4 h-4 text-amber-400" />
          <span className="text-xs text-surface-300">拖拽定点 · 滚轮缩放</span>
          <span className="text-[11px] text-surface-500">{Math.round(zoom * 100)}%</span>
          <button onClick={handleSaveDefaultView}
            className="px-3 py-1 rounded-lg bg-amber-500/20 text-amber-400 text-xs font-medium hover:bg-amber-500/30">保存</button>
          <button onClick={handleCancelDefaultView}
            className="px-3 py-1 rounded-lg bg-surface-800 text-surface-400 text-xs hover:bg-surface-700">取消</button>
        </div>
      )}

      {/* ── 右键菜单：选择标点模板 → 打开放置编辑面板 ── */}
      {contextMenu && createPortal((
        <div className="fixed z-[10000]" style={{ left: contextMenu.x, top: contextMenu.y, transformOrigin: 'top left' }} onMouseDown={e => e.stopPropagation()}>
          <div className="w-64 py-1 rounded-xl bg-surface-900/95 backdrop-blur-xl border border-white/10 shadow-2xl animate-scale-in">
            <div className="px-3 py-1.5 text-[10px] text-surface-500 border-b border-white/5">选择标点</div>
            {/* 搜索框 */}
            <div className="px-2 py-1.5 border-b border-white/5">
              <input
                type="text"
                value={contextMenuSearch}
                onChange={e => setContextMenuSearch(e.target.value)}
                placeholder="搜索标点…"
                className="w-full px-2 py-1 text-[11px] rounded-lg bg-surface-800/60 text-surface-200 placeholder-surface-500 border border-white/5 outline-none focus:border-amber-500/40 transition-colors"
                autoFocus
              />
            </div>
            {(() => {
              const q = contextMenuSearch.trim().toLowerCase()
              const placementCountMap = {}
              for (const pm of placedMarkers) {
                placementCountMap[pm.marker_id] = (placementCountMap[pm.marker_id] || 0) + 1
              }
              // ── 搜索模式：平铺列表 ──
              if (q) {
                const filtered = contextMenu.templates.filter(t => (t.name_zh || '').toLowerCase().includes(q))
                const sorted = [...filtered].sort((a, b) => {
                  if (a.is_favorite && !b.is_favorite) return -1
                  if (!a.is_favorite && b.is_favorite) return 1
                  return 0
                })
                return (
                  <div className="max-h-64 overflow-y-auto">
                    {sorted.length === 0
                      ? <div className="px-3 py-4 text-[10px] text-surface-500 text-center">无匹配标点</div>
                      : sorted.map(t => (
                          <button key={t.id}
                            onClick={() => { setContextMenu(null); setPlacementEditor({ template: t, worldX: contextMenu.worldX, worldY: contextMenu.worldY, templates: null, targetLayer: contextMenu.targetLayer }) }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-surface-200 hover:bg-white/10 transition-colors text-left">
                            {t.image_filename ? (
                              <img src={`local-media://${(t.image_filename || '').trim()}`} className="w-5 h-5 object-cover rounded shrink-0" />
                            ) : (
                              <div className={`w-3 h-3 shrink-0 ${t.marker_type === 'circle' ? 'rounded-full border' : 'rounded'}`}
                                style={t.marker_type === 'circle' ? { borderColor: 'var(--primary-500, #f59e0b)' } : { backgroundColor: 'var(--primary-500, #f59e0b)' }} />
                            )}
                            <span className="flex-1 truncate">{t.name_zh || '未命名'}</span>
                            <span className="text-[10px] text-surface-500 shrink-0 font-mono">{placementCountMap[t.id] || 0}</span>
                            {t.is_favorite ? <span className="text-[9px] text-amber-400 shrink-0">★</span> : null}
                          </button>
                        ))
                    }
                  </div>
                )
              }
              // ── 非搜索模式：分类选项卡 ──
              const normalizeCat = (c) => {
                const raw = c || 'other'
                return FIXED_CATEGORIES.includes(raw) ? raw : 'other'
              }
              const favMarkers = contextMenu.templates.filter(t => t.is_favorite)
              const tabs = []
              if (favMarkers.length > 0) tabs.push({ key: 'favorites', label: '常用', markers: favMarkers })
              for (const cat of FIXED_CATEGORIES) {
                const catMarkers = contextMenu.templates.filter(t => normalizeCat(t.category || '') === cat)
                if (catMarkers.length > 0) {
                  tabs.push({ key: cat, label: MARKER_TYPE_ZH[cat] || cat, markers: catMarkers })
                }
              }
              if (tabs.length === 0) {
                return <div className="max-h-64 overflow-y-auto"><div className="px-3 py-4 text-[10px] text-surface-500 text-center">无标点</div></div>
              }
              // 确保当前选项卡有效
              const activeIdx = tabs.findIndex(t => t.key === contextMenuTab)
              const activeTab = activeIdx >= 0 ? tabs[activeIdx] : tabs[0]
              return (
                <>
                  {/* 分类选项卡栏 */}
                  <div className="flex overflow-x-auto border-b border-white/5">
                    {tabs.map(t => (
                      <button key={t.key}
                        onClick={() => setContextMenuTab(t.key)}
                        className={`shrink-0 px-2.5 py-1.5 text-[10px] whitespace-nowrap transition-colors border-b ${
                          contextMenuTab === t.key
                            ? 'text-amber-400 border-amber-400'
                            : 'text-surface-400 border-transparent hover:text-surface-200'
                        }`}>
                        {t.label}
                        <span className="ml-1 text-surface-600">{t.markers.length}</span>
                      </button>
                    ))}
                  </div>
                  {/* 当前选项卡的标点列表 */}
                  <div className="max-h-56 overflow-y-auto">
                    {activeTab.markers.length === 0
                      ? <div className="px-3 py-4 text-[10px] text-surface-500 text-center">无标点</div>
                      : activeTab.markers.map(t => (
                          <button key={t.id}
                            onClick={() => { setContextMenu(null); setPlacementEditor({ template: t, worldX: contextMenu.worldX, worldY: contextMenu.worldY, templates: null, targetLayer: contextMenu.targetLayer }) }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-surface-200 hover:bg-white/10 transition-colors text-left">
                            {t.image_filename ? (
                              <img src={`local-media://${(t.image_filename || '').trim()}`} className="w-5 h-5 object-cover rounded shrink-0" />
                            ) : (
                              <div className={`w-3 h-3 shrink-0 ${t.marker_type === 'circle' ? 'rounded-full border' : 'rounded'}`}
                                style={t.marker_type === 'circle' ? { borderColor: 'var(--primary-500, #f59e0b)' } : { backgroundColor: 'var(--primary-500, #f59e0b)' }} />
                            )}
                            <span className="flex-1 truncate">{t.name_zh || '未命名'}</span>
                            <span className="text-[10px] text-surface-500 shrink-0 font-mono">{placementCountMap[t.id] || 0}</span>
                            {t.is_favorite ? <span className="text-[9px] text-amber-400 shrink-0">★</span> : null}
                          </button>
                        ))
                    }
                  </div>
                </>
              )
            })()}
          </div>
          <div className="fixed inset-0 z-[-1]" onClick={() => { setContextMenu(null); setContextMenuSearch('') }} />
        </div>
      ), document.body)}

      {/* ── 放置编辑面板 ── */}
      {placementEditor && placementEditor.template && (
        <PlacementEditor
          key={placementEditor?.existingPlacement?.id || placementEditor?.template?.id || 'new'}
          template={placementEditor.template}
          worldX={placementEditor.worldX}
          worldY={placementEditor.worldY}
          existingPlacement={placementEditor.existingPlacement || null}
          existingMaps={maps}
          existingLayers={configLayers}
          presetLayerId={placementEditor.targetLayer?.id || null}
          onConfirm={handlePlacementConfirm}
          onCancel={() => setPlacementEditor(null)}
        />
      )}

      {/* ── 悬停详情 — tooltip 统一 portal（flex 列 + 固定间距 gap-2） ── */}
      {hoveredMarker && (() => {
        const hoveredGroup = getOverlapGroup(hoveredMarker)
        const tooltipMarkers = placedMarkers.filter(pm => {
          if (!(pm.special_function || pm.template_special)) return false
          try {
            const sfRaw = pm.special_function || pm.template_special
            const sf = typeof sfRaw === 'string' ? JSON.parse(sfRaw) : sfRaw
            if (sf.type !== 'tooltip') return false
            if (pm.id === hoveredMarker.id) return true
            if (hoveredGroup && hoveredGroup.some(m => m.id === pm.id)) return true
            return false
          } catch { return false }
        })
        if (tooltipMarkers.length === 0) return null
        // 按重叠组索引排序
        const groupIdxMap = {}
        if (hoveredGroup) {
          hoveredGroup.forEach((m, idx) => { groupIdxMap[m.id] = idx })
        }
        tooltipMarkers.sort((a, b) => (groupIdxMap[a.id] ?? 0) - (groupIdxMap[b.id] ?? 0))
        const rect = mapContainerRef.current?.getBoundingClientRect()
        if (!rect) return null
        return createPortal(
          <div className="fixed z-[9999] flex flex-col gap-2 pointer-events-none"
            style={{ left: rect.left + 16, top: rect.top + 16 }}>
            {tooltipMarkers.map(pm => {
              const template = markerTemplates.find(t => t.id === pm.marker_id)
              const sfRaw = pm.special_function || pm.template_special
              const sf = typeof sfRaw === 'string' ? JSON.parse(sfRaw) : sfRaw
              const tipName = pm.custom_name || template?.name_zh || '未命名'
              return (
                <div key={pm.id} className="w-72 p-3 rounded-xl bg-surface-900/95 backdrop-blur-md border border-white/10 shadow-2xl">
                  <div className="flex items-center gap-2 mb-2">
                    {template?.image_filename && (
                      <img src={`local-media://${(template.image_filename || '').trim()}`} className="w-8 h-8 rounded object-cover shrink-0" />
                    )}
                    <p className="text-xs font-medium text-white">{tipName}</p>
                  </div>
                  <TooltipSections
                    tooltip={{
                      ...(sf.tooltip || {}),
                      image: sf.image || sf.tooltip?.image || null,
                      // 多图兼容：tooltip.images 缺省时由旧字段（sf.image / tooltip.image）回退
                      images: Array.isArray(sf.tooltip?.images) && sf.tooltip.images.length > 0
                        ? sf.tooltip.images
                        : ((sf.image || sf.tooltip?.image) ? [sf.image || sf.tooltip.image] : []),
                    }}
                    catalog={entryCatalog}
                    onJump={handleTooltipJump}
                    compact
                  />
                </div>
              )
            })}
          </div>,
          document.body
        )
      })()}

      {/* ── 重叠标点选择菜单 ── */}
      {overlapMenu && createPortal((
        <>
          <div className="fixed inset-0 z-[10001]" onClick={() => { setOverlapMenu(null); setOverlapHighlightedId(null) }} />
          <div className="fixed z-[10002] py-1 rounded-xl bg-surface-900/95 backdrop-blur-xl border border-white/10 shadow-2xl animate-scale-in"
            style={{ left: overlapMenu.screenX, top: overlapMenu.screenY, minWidth: 200 }}>
            <div className="px-3 py-1.5 text-[10px] text-surface-500 border-b border-white/5 flex items-center justify-between">
              <span>重叠标点（{overlapMenu.markers.length}）</span>
              <button onClick={() => { setOverlapMenu(null); setOverlapHighlightedId(null) }}
                className="text-surface-500 hover:text-white">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="max-h-64 overflow-y-auto">
              {overlapMenu.markers.map((m, idx) => {
                const tpl = markerTemplates.find(t => t.id === m.marker_id)
                const name = m.custom_name || tpl?.name_zh || '未命名'
                const isFirst = idx === 0; const isLast = idx === overlapMenu.markers.length - 1
                return (
                  <div key={m.id}
                    className={`flex items-center gap-2 px-3 py-2 text-xs text-surface-200 transition-colors ${
                      overlapHighlightedId === m.id ? 'bg-white/10' : 'hover:bg-white/5'
                    }`}
                    onMouseEnter={() => setOverlapHighlightedId(m.id)}
                    onMouseLeave={() => setOverlapHighlightedId(null)}
                    onClick={() => {
                      setOverlapMenu(null); setOverlapHighlightedId(null)
                      // 如果标点属于某个分层地图，切换到对应层级
                      if (m.layer_id) {
                        const layer = configLayers.find(l => l.id === m.layer_id)
                        if (layer && layer.level !== layerMode) {
                          setLayerMode(layer.level)
                          return
                        }
                      }
                      const sfRaw = m.special_function || m.template_special
                      if (sfRaw) {
                        try {
                          const sf = typeof sfRaw === 'string' ? JSON.parse(sfRaw) : sfRaw
                          if (sf.type === 'switch_map') {
                            if (sf.image) window.electronAPI?.readImage(sf.image, 256).then(r => { if (r?.success) setSidePanel(prev => ({ ...prev, sfImage: r.data })) })
                            setSidePanel({
                              targetMapId: sf.map_id,
                              name: tpl?.name_zh || '',
                              customName: m.custom_name || '',
                              markerImage: tpl?.image_filename || null,
                              sfImage: null,
                              description: sf.description || '',
                            })
                          } else if (sf.type === 'tooltip') {
                            setDetailModal({
                              name: m.custom_name || tpl?.name_zh || '未命名',
                              imageFilename: tpl?.image_filename || null,
                              detailImage: sf.image || sf.tooltip?.image || null,
                              body: sf.tooltip?.body || '',
                              tooltip: {
                                ...(sf.tooltip || {}),
                                image: sf.image || sf.tooltip?.image || null,
                                // 多图兼容：tooltip.images 缺省时由旧字段（sf.image / tooltip.image）回退
                                images: Array.isArray(sf.tooltip?.images) && sf.tooltip.images.length > 0
                                  ? sf.tooltip.images
                                  : ((sf.image || sf.tooltip?.image) ? [sf.image || sf.tooltip.image] : []),
                              },
                            })
                          }
                        } catch (_) {}
                      }
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault(); e.stopPropagation()
                      if (!devMode && Number(m.created_by_dev) === 1) return
                      const pos = clampMenuPos(e.clientX, e.clientY, 144, 80)
                      setPlacedMenu({ pm: m, x: pos.x, y: pos.y })
                    }}>
                    {tpl?.image_filename ? (
                      <div className="relative shrink-0">
                        <img src={`local-media://${(tpl.image_filename || '').trim()}`} className="w-5 h-5 object-cover rounded shrink-0" />
                        {(m.subscript === '1' || m.subscript === 1) && (
                          <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-black border border-white/30 flex items-center justify-center">
                            <Layers className="text-white" style={{ width: 8, height: 8 }} />
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className={`w-3 h-3 shrink-0 ${tpl?.marker_type === 'circle' ? 'rounded-full border' : 'rounded'}`}
                        style={tpl?.marker_type === 'circle' ? { borderColor: 'var(--primary-500, #f59e0b)' } : { backgroundColor: 'var(--primary-500, #f59e0b)' }} />
                    )}
                    <span className="flex-1 truncate">{name}</span>
                    {tpl?.is_favorite ? <span className="text-[9px] text-amber-400 shrink-0">★</span> : null}
                    {/* 开发者模式：图层调序 ▲▼ */}
                    {devMode && (
                      <div className="flex flex-col shrink-0 -my-1">
                        <button disabled={isFirst}
                          onClick={async (e) => {
                            e.stopPropagation()
                            const newMarkers = [...overlapMenu.markers]
                            ;[newMarkers[idx - 1], newMarkers[idx]] = [newMarkers[idx], newMarkers[idx - 1]]
                            const reorderedIds = [...newMarkers].reverse().map((m, i) => ({ id: m.id, sort_order: i }))
                            await window.electronAPI?.mapReorderPlacements(reorderedIds)
                            setOverlapMenu(prev => ({ ...prev, markers: newMarkers }))
                            loadMarkers(currentMapId)
                          }}
                          className={`text-[10px] leading-none px-0.5 ${isFirst ? 'text-surface-700' : 'text-surface-400 hover:text-white'}`}>
                          ▲
                        </button>
                        <button disabled={isLast}
                          onClick={async (e) => {
                            e.stopPropagation()
                            const newMarkers = [...overlapMenu.markers]
                            ;[newMarkers[idx + 1], newMarkers[idx]] = [newMarkers[idx], newMarkers[idx + 1]]
                            const reorderedIds = [...newMarkers].reverse().map((m, i) => ({ id: m.id, sort_order: i }))
                            await window.electronAPI?.mapReorderPlacements(reorderedIds)
                            setOverlapMenu(prev => ({ ...prev, markers: newMarkers }))
                            loadMarkers(currentMapId)
                          }}
                          className={`text-[10px] leading-none px-0.5 ${isLast ? 'text-surface-700' : 'text-surface-400 hover:text-white'}`}>
                          ▼
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </>
      ), document.body)}

      {/* ── 已放置标点右键菜单 ── */}
      {placedMenu && createPortal((
        <div className="fixed z-[10003]" style={{ left: placedMenu.x, top: placedMenu.y, transformOrigin: 'top left' }} onMouseDown={e => e.stopPropagation()}>
          <div className="w-36 py-1 rounded-xl bg-surface-900/95 backdrop-blur-xl border border-white/10 shadow-2xl animate-scale-in">
            <button onClick={async () => {
              const pm = placedMenu.pm
              const template = markerTemplates.find(t => t.id === pm.marker_id)
              setPlacedMenu(null)
              setPlacementEditor({ template, worldX: pm.world_x, worldY: pm.world_y, existingPlacement: pm })
            }} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-surface-200 hover:bg-white/10">编辑</button>
            {devMode && <button onClick={() => {
              const pm = placedMenu.pm
              setPlacedMenu(null)
              setMovingMarkerId(pm.id)
            }} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-yellow-400 hover:bg-yellow-500/10">移动</button>}
            <button onClick={async () => {
              if (!confirm('确定删除此标点？')) return
              console.log('[MemoryHub] deleting placement', placedMenu.pm.id)
              const delRes = await window.electronAPI?.mapDeletePlacement(placedMenu.pm.id)
              console.log('[MemoryHub] delete result', delRes)
              setPlacedMenu(null); loadMarkers(currentMapId)
            }} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-400 hover:bg-red-500/10">删除</button>
          </div>
          <div className="fixed inset-0 z-[-1]" onClick={() => setPlacedMenu(null)} />
        </div>
      ), document.body)}

      {/* ── 文本框右键菜单 ── */}
      {textboxMenu && createPortal((
        <div className="fixed z-[10000]" style={{ left: textboxMenu.x, top: textboxMenu.y, transformOrigin: 'top left' }} onMouseDown={e => e.stopPropagation()}>
          <div className="w-36 py-1 rounded-xl bg-surface-900/95 backdrop-blur-xl border border-white/10 shadow-2xl animate-scale-in">
            <button onClick={() => {
              setTextboxEditData({ id: textboxMenu.tb.id, text: textboxMenu.tb.text, level: textboxMenu.tb.level, layer_id: textboxMenu.tb.layer_id })
              setTextboxMenu(null)
              setShowTextboxCreator(true)
            }} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-surface-200 hover:bg-white/10">编辑</button>
            <button onClick={() => {
              setMovingTextboxId(textboxMenu.tb.id)
              setTextboxMenu(null)
            }} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-yellow-400 hover:bg-yellow-500/10">移动</button>
            <button onClick={async () => {
              if (!confirm('确定删除此文本框？')) return
              await window.electronAPI?.mapExecBaseline("DELETE FROM map_textboxes WHERE id=?", [textboxMenu.tb.id])
              setTextboxMenu(null); loadMarkers(currentMapId)
            }} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-400 hover:bg-red-500/10">删除</button>
          </div>
          <div className="fixed inset-0 z-[-1]" onClick={() => setTextboxMenu(null)} />
        </div>
      ), document.body)}

      {/* ── 分层地图中键菜单 ── */}
      {layerMenu && createPortal((
        <div className="fixed z-[10003]" style={{ left: layerMenu.x, top: layerMenu.y, transformOrigin: 'top left' }} onMouseDown={e => e.stopPropagation()}>
          <div className="w-28 py-1 rounded-xl bg-surface-900/95 backdrop-blur-xl border border-white/10 shadow-2xl animate-scale-in">
            <button onClick={() => {
              setLayerEditData({ ...layerMenu.layer, editIndex: layerMenu.editIndex })
              setLayerMenu(null)
              setShowLayerManager(true)
            }} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-surface-200 hover:bg-white/10">编辑</button>
            <button onClick={async () => {
              const layer = layerMenu.layer
              setLayerMenu(null)
              if (!confirm(`确定删除分层地图「${layer.name || '未命名'}」？`)) return
              handleLayerDelete(layerMenu.editIndex)
            }} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-400 hover:bg-red-500/10">删除</button>
          </div>
          <div className="fixed inset-0 z-[-1]" onClick={() => setLayerMenu(null)} />
        </div>
      ), document.body)}

      {/* ── switch_map 侧栏 ── */}
      {showMarkerCreator && (
        <MarkerCreatorModal
          editData={markerEditData}
          presetCategory={editMarkerCategory || undefined}
          onConfirm={handleCreateMarker}
          onCancel={() => { setShowMarkerCreator(false); setEditMarkerCategory(''); setMarkerEditData(null) }}
        />
      )}

      {/* ── 文本框创建弹窗 ── */}
      {/* ── 文本框创建/编辑弹窗 ── */}
      {showTextboxCreator && (
        <TextboxCreatorModal
          key={textboxEditData?.id || 'new'}
          editData={textboxEditData}
          mapConfig={mapConfig}
          onConfirm={handleCreateTextbox}
          onCancel={() => { setShowTextboxCreator(false); setTextboxEditData(null) }}
        />
      )}

      {/* ── 分层地图管理器弹窗 ── */}
      {showLayerManager && (
        <LayerMapModal
          key={layerEditData ? `edit-${layerEditData.id}` : 'new'}
          editData={layerEditData}
          mapConfig={mapConfig}
          mapId={currentMapId}
          onConfirm={handleLayerConfirm}
          onCancel={() => { setShowLayerManager(false); setLayerEditData(null) }}
        />
      )}

      {/* ── 设置面板 ── */}
      {showSettings && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowSettings(false)}>
          <div className="w-[620px] max-h-[90%] flex flex-col rounded-xl bg-surface-900 border border-white/10 shadow-2xl p-4" onClick={e => e.stopPropagation()}>
            <style>{`
              .default-value-mark {
                position: absolute;
                top: 50%;
                width: 4px;
                height: 20px;
                background: rgba(255, 255, 255, 0.5);
                transform: translate(-50%, -50%);
                pointer-events: none;
                z-index: 0;
                border-radius: 2px;
              }
            `}</style>
            <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-4 shrink-0">
              <Settings className="w-4 h-4" /> 摹忆中枢设置
            </h3>
            <div className="flex-1 overflow-y-auto grid grid-cols-2 gap-x-6 gap-y-3">
              {/* ── 文本级别切换临界点 ── */}
              <div>
                <p className="text-[11px] text-surface-400 mb-2">文本级别切换临界点</p>
                <p className="text-[9px] text-surface-600 mb-2">三级临界点{'>'}二级临界点{'>'}一级临界点</p>
                <div className="space-y-2">
                  {[
                    { key: '1', label: '一级', desc: '零级 ≤此值' },
                    { key: '2', label: '二级', desc: '一级 ≤此值' },
                    { key: '3', label: '三级', desc: '二级 ≤此值' },
                  ].map(({ key, label }) => (
                    <div key={key} className="flex items-center gap-1.5">
                      <span className="text-[10px] text-surface-400 w-7 shrink-0">{label}</span>
                      <div className="relative flex-1">
                        <input
                          type="range"
                          min="0.01"
                          max="4"
                          step="0.01"
                          value={effectiveLevelThresholds[key]}
                          onChange={async (e) => {
                            const val = +e.target.value
                            if (!currentMapId) return
                            const nextUser = { ...userMapConfig, levelThresholds: { ...(userMapConfig.levelThresholds || {}), [key]: val } }
                            setUserMapConfig(nextUser)
                            await window.electronAPI?.mapSaveUserConfig(currentMapId, nextUser)
                          }}
                          className="w-full h-1.5 accent-amber-500 cursor-pointer"
                        />
                        <div className="default-value-mark" style={{ left: `calc(8px + (100% - 16px) * ${((defaultLevelThresholds[key] - 0.01) / (4 - 0.01))})` }} />
                      </div>
                      <span className="text-[10px] text-surface-300 font-mono w-10 text-right shrink-0">{effectiveLevelThresholds[key].toFixed(2)}×</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* ── 文本框字体大小（每级独立） ── */}
              <div>
                <p className="text-[11px] text-surface-400 mb-2">文本框字体大小</p>
                <div className="space-y-2">
                  {[
                    { key: '0', label: '零级' },
                    { key: '1', label: '一级' },
                    { key: '2', label: '二级' },
                    { key: '3', label: '三级' },
                  ].map(({ key, label }) => (
                    <div key={key} className="flex items-center gap-1.5">
                      <span className="text-[10px] text-surface-400 w-7 shrink-0">{label}</span>
                      <div className="relative flex-1">
                        <input
                          type="range"
                          min="8"
                          max="100"
                          step="1"
                          value={effectiveTextboxFontSizes?.[key] ?? 12}
                          onChange={async (e) => {
                            const val = +e.target.value
                            if (!currentMapId) return
                            const nextUser = { ...userMapConfig, textboxFontSizes: { ...(userMapConfig.textboxFontSizes || {}), [key]: val } }
                            setUserMapConfig(nextUser)
                            await window.electronAPI?.mapSaveUserConfig(currentMapId, nextUser)
                          }}
                          className="w-full h-1.5 accent-amber-500 cursor-pointer"
                        />
                        <div className="default-value-mark" style={{ left: `calc(8px + (100% - 16px) * ${((defaultTextboxFontSizes[key] - 8) / (100 - 8))})` }} />
                      </div>
                      <span className="text-[10px] text-surface-300 font-mono w-10 text-right shrink-0">{(effectiveTextboxFontSizes?.[key] ?? 12)}px</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* ── 标点尺寸 ── */}
              <div className="col-span-2">
                <p className="text-[11px] text-surface-400 mb-2">标点尺寸</p>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-surface-400 w-7 shrink-0">大小</span>
                  <span className="text-[9px] text-surface-600 w-16 shrink-0">16px ~ 200px</span>
                  <div className="relative flex-1">
                    <input
                      type="range"
                      min="16"
                      max="200"
                      step="2"
                      value={effectiveMarkerSize}
                      onChange={async (e) => {
                        const val = +e.target.value
                        if (!currentMapId) return
                        const nextUser = { ...userMapConfig, markerSize: val }
                        setUserMapConfig(nextUser)
                        await window.electronAPI?.mapSaveUserConfig(currentMapId, nextUser)
                      }}
                      className="w-full h-1.5 accent-amber-500 cursor-pointer"
                    />
                    <div className="default-value-mark" style={{ left: `calc(8px + (100% - 16px) * ${((defaultMarkerSize - 16) / (200 - 16))})` }} />
                  </div>
                  <span className="text-[10px] text-surface-300 font-mono w-10 text-right shrink-0">{effectiveMarkerSize}px</span>
                </div>
              </div>

              {/* ── 拖拽惯性 ── */}
              <div className="col-span-2">
                <p className="text-[11px] text-surface-400 mb-2">拖拽惯性</p>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[10px] text-surface-400">惯性滑行</span>
                  <button onClick={async () => {
                    if (!currentMapId) return
                    const next = !effectiveInertiaEnabled
                    const nextUser = { ...userMapConfig, inertiaEnabled: next }
                    setUserMapConfig(nextUser)
                    await window.electronAPI?.mapSaveUserConfig(currentMapId, nextUser)
                  }} className={`px-3 py-1 rounded text-[10px] font-medium transition-colors ${
                    effectiveInertiaEnabled ? 'bg-amber-500/20 text-amber-400' : 'bg-surface-800 text-surface-500'
                  }`}>{effectiveInertiaEnabled ? '开启' : '关闭'}</button>
                  {effectiveInertiaEnabled !== defaultInertiaEnabled && (
                    <button onClick={async () => {
                      if (!currentMapId) return
                      const nextUser = { ...userMapConfig, inertiaEnabled: undefined }
                      setUserMapConfig(nextUser)
                      await window.electronAPI?.mapSaveUserConfig(currentMapId, nextUser)
                    }} className="text-[9px] text-surface-500 hover:text-surface-300 underline">恢复默认</button>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-surface-400 w-20 shrink-0">摩擦系数</span>
                  <span className="text-[9px] text-surface-600 w-20 shrink-0">0.01（长滑）~ 0.20（快停）</span>
                  <div className="relative flex-1">
                    <input type="range" min="0.01" max="0.20" step="0.01"
                      value={effectiveInertiaFriction}
                      onChange={async (e) => {
                        const val = +e.target.value
                        if (!currentMapId) return
                        const nextUser = { ...userMapConfig, inertiaFriction: val }
                        setUserMapConfig(nextUser)
                        await window.electronAPI?.mapSaveUserConfig(currentMapId, nextUser)
                      }}
                      className="w-full h-1.5 accent-amber-500 cursor-pointer" />
                    <div className="default-value-mark" style={{ left: `calc(8px + (100% - 16px) * ${((defaultInertiaFriction - 0.01) / (0.20 - 0.01))})` }} />
                  </div>
                  <span className="text-[10px] text-surface-300 font-mono w-10 text-right shrink-0">{effectiveInertiaFriction.toFixed(2)}</span>
                </div>
              </div>

              {/* ── 全图覆盖临界点 ── */}
              <div className="col-span-2">
                <p className="text-[11px] text-surface-400 mb-2">全图覆盖临界点</p>
                <p className="text-[9px] text-surface-600 mb-2">zoom 低于此值时用整图替代切片</p>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-surface-400 w-7 shrink-0">临界</span>
                  <div className="relative flex-1">
                    <input type="range" min="0.01" max="2" step="0.01"
                      value={effectiveFullImgThreshold}
                      onChange={async (e) => {
                        const val = +e.target.value
                        if (!currentMapId) return
                        const nextUser = { ...userMapConfig, fullImgThreshold: val }
                        setUserMapConfig(nextUser)
                        await window.electronAPI?.mapSaveUserConfig(currentMapId, nextUser)
                      }}
                      className="w-full h-1.5 accent-amber-500 cursor-pointer" />
                    <div className="default-value-mark" style={{ left: `calc(8px + (100% - 16px) * ${((defaultFullImgThreshold - 0.01) / (2 - 0.01))})` }} />
                  </div>
                  <span className="text-[10px] text-surface-300 font-mono w-10 text-right shrink-0">{effectiveFullImgThreshold.toFixed(2)}×</span>
                </div>
              </div>

              {/* ── 分层地图悬停缩放 ── */}
              <div className="col-span-2">
                <p className="text-[11px] text-surface-400 mb-2">分层地图悬停缩放</p>
                <div className="flex items-center gap-2">
                  <button onClick={async () => {
                    const next = !effectiveLayerHoverZoom
                    if (!currentMapId) return
                    const nextUser = { ...userMapConfig, layerHoverZoom: next }
                    setUserMapConfig(nextUser)
                    await window.electronAPI?.mapSaveUserConfig(currentMapId, nextUser)
                  }} className={`px-3 py-1 rounded text-[10px] font-medium transition-colors ${
                    effectiveLayerHoverZoom ? 'bg-purple-500/20 text-purple-400' : 'bg-surface-800 text-surface-500'
                  }`}>{effectiveLayerHoverZoom ? '开启' : '关闭'}</button>
                  {effectiveLayerHoverZoom !== defaultLayerHoverZoom && (
                    <button onClick={async () => {
                      if (!currentMapId) return
                      const nextUser = { ...userMapConfig, layerHoverZoom: undefined }
                      setUserMapConfig(nextUser)
                      await window.electronAPI?.mapSaveUserConfig(currentMapId, nextUser)
                    }} className="text-[9px] text-surface-500 hover:text-surface-300 underline">恢复默认</button>
                  )}
                  <span className="text-[9px] text-surface-600">鼠标悬停分层地图时放大预览</span>
                </div>
              </div>

              {/* ── 坐标比例调整 ── */}
              <div className="col-span-2 border-t border-white/5 pt-3 mt-1">
                <p className="text-[11px] text-surface-400 mb-2">坐标比例调整</p>
                <p className="text-[9px] text-surface-600 mb-2">
                  按比例缩放当前地图所有标点、文本框和分层地图的坐标及尺寸
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="0.001"
                    step="0.1"
                    value={scaleRatio}
                    onChange={(e) => setScaleRatio(e.target.value)}
                    placeholder="1.0"
                    className="w-28 px-2.5 py-1.5 rounded-lg bg-surface-800/60 border border-white/10 text-[11px] text-surface-200 placeholder-surface-500 focus:outline-none focus:border-amber-500/40"
                  />
                  <span className="text-[10px] text-surface-500">倍</span>
                  <button onClick={handleApplyScale}
                    className="px-3 py-1.5 rounded-lg bg-amber-500/20 text-amber-400 text-[11px] font-medium hover:bg-amber-500/30 transition-colors">
                    应用
                  </button>
                </div>
              </div>

              {/* ── 开发者模式：保存为默认值 ── */}
              {devMode && (
                <div className="col-span-2 border-t border-white/5 pt-3 mt-1">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={async () => {
                        if (!currentMapId) return
                        if (!window.confirm('确定将当前用户设置保存为默认值？')) return
                        // 将 userMapConfig 中的值合并写入 mapConfig（默认值）
                        const merged = {
                          ...(mapConfig || {}),
                          ...(userMapConfig.levelThresholds ? { levelThresholds: { ...(mapConfig?.levelThresholds || {}), ...userMapConfig.levelThresholds } } : {}),
                          ...(userMapConfig.textboxFontSizes ? { textboxFontSizes: { ...(mapConfig?.textboxFontSizes || {}), ...userMapConfig.textboxFontSizes } } : {}),
                          ...(userMapConfig.markerSize !== undefined ? { markerSize: userMapConfig.markerSize } : {}),
                          ...(userMapConfig.fullImgThreshold !== undefined ? { fullImgThreshold: userMapConfig.fullImgThreshold } : {}),
                          ...(userMapConfig.inertiaFriction !== undefined ? { inertiaFriction: userMapConfig.inertiaFriction } : {}),
                          ...(userMapConfig.inertiaEnabled !== undefined ? { inertiaEnabled: userMapConfig.inertiaEnabled } : {}),
                        }
                        setMapConfig(merged)
                        setMaps(prev => prev.map(m => m.id === currentMapId ? { ...m, config: merged } : m))
                        const mn = maps.find(m => m.id === currentMapId)?.name_zh || ''
                        await window.electronAPI?.mapSaveConfig(currentMapId, mn, merged)

                        // 清空用户覆盖
                        setUserMapConfig({})
                        await window.electronAPI?.mapResetUserConfig(currentMapId)
                      }}
                      className="px-4 py-2 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 text-emerald-300 text-xs font-medium transition-colors"
                    >
                      保存为默认值
                    </button>
                    <button
                      onClick={async () => {
                        setUserMapConfig({})
                        if (currentMapId) {
                          await window.electronAPI?.mapResetUserConfig(currentMapId)
                        }
                      }}
                      className="px-4 py-2 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 text-amber-300 text-xs font-medium transition-colors"
                    >
                      恢复默认设置
                    </button>
                  </div>
                  <p className="text-[9px] text-surface-500 mt-1">保存为默认值：将当前用户设置写入开发者默认值并清空覆盖；恢复默认设置：仅清空覆盖</p>
                </div>
              )}

              {/* ── 恢复默认设置（非开发者模式） ── */}
              {!devMode && (
                <div className="col-span-2 border-t border-white/5 pt-3 mt-1">
                  <button
                    onClick={async () => {
                      setUserMapConfig({})
                      if (currentMapId) {
                        await window.electronAPI?.mapResetUserConfig(currentMapId)
                      }
                    }}
                    className="px-4 py-2 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 text-amber-300 text-xs font-medium transition-colors"
                  >
                    恢复默认设置
                  </button>
                  <p className="text-[9px] text-surface-500 mt-1">清除当前地图的用户覆盖，回到全局默认值</p>
                </div>
              )}

              {/* ── 开发者模式：地图管理 ── */}
              {devMode && (
                <div className="col-span-1 border-t border-white/5 pt-3 mt-1">
                  <h4 className="text-xs font-semibold text-surface-300 mb-2">地图管理</h4>
                  <p className="text-[10px] text-surface-500 mb-2">调整排序 · 删除地图（不可撤销）</p>
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {maps.map((m, i) => (
                      <div key={m.id}
                        draggable
                        onDragStart={(e) => { e.dataTransfer.setData('text/plain', m.id); e.dataTransfer.effectAllowed = 'move' }}
                        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
                        onDrop={async (e) => {
                          e.preventDefault()
                          const fromId = e.dataTransfer.getData('text/plain')
                          if (fromId === m.id) return
                          const fromIdx = maps.findIndex(x => x.id === fromId)
                          const toIdx = maps.findIndex(x => x.id === m.id)
                          const next = [...maps]
                          const [item] = next.splice(fromIdx, 1)
                          next.splice(toIdx, 0, item)
                          setMaps(next)
                          await window.electronAPI?.mapReorder(next.map(x => x.id))
                        }}
                        className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-surface-800/30 cursor-grab active:cursor-grabbing hover:bg-surface-800/50 transition-colors">
                        <span className="text-[10px] text-surface-600 w-4 select-none">⠿</span>
                        <span className="flex-1 text-[11px] text-surface-300 truncate">{m.name_zh}</span>
                        <button
                          onClick={async () => {
                            if (!confirm(`确定删除地图「${m.name_zh}」？\n切片文件也将一并删除，此操作不可撤销。`)) return
                            const res = await window.electronAPI?.mapDelete(m.id)
                            if (res?.error) { alert('删除失败: ' + res.error); return }
                            if (currentMapId === m.id) { setCurrentMapId(null); setMapConfig(null) }
                            loadMaps()
                          }}
                          className="text-[10px] text-red-400 hover:text-red-300">删除</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── 地图更新栏（仅开发者） ── */}
              {devMode && currentMapId && (
                <div className="col-span-1 border-t border-white/5 pt-3 mt-1">
                  <h4 className="text-xs font-semibold text-surface-300 mb-1">地图更新栏</h4>
                  <p className="text-[10px] text-surface-500 mb-2">
                    更换原图重新切片，标点与文本框位置保持不变
                  </p>
                  <div className="flex flex-col gap-2">
                    <button onClick={handleUpdateMap}
                      className="px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 text-[11px] font-medium hover:bg-emerald-500/30 transition-colors">
                      更新地图
                    </button>
                    <button onClick={handleGenerateFull}
                      className="px-3 py-1.5 rounded-lg bg-amber-500/20 text-amber-400 text-[11px] font-medium hover:bg-amber-500/30 transition-colors">
                      选择图片并生成全图
                    </button>
                  </div>
                </div>
              )}

              {/* ── 开发者模式：分层地图管理 ── */}
              {devMode && currentMapId && (
                <div className="col-span-2 border-t border-white/5 pt-3 mt-1">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-xs font-semibold text-surface-300">分层地图管理</h4>
                    <button onClick={() => {
                      const vp = containerSize.current
                      const cx = Math.round((vp.w / 2 - viewCenter.x) / zoom)
                      const cy = Math.round((vp.h / 2 - viewCenter.y) / zoom)
                      setLayerEditData({ _defaultX: cx, _defaultY: cy })
                      setShowLayerManager(true)
                    }}
                      className="text-[10px] px-2 py-1 rounded-lg bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 transition-colors">
                      + 添加分层地图
                    </button>
                  </div>
                  {configLayers.length === 0 ? (
                    <p className="text-[10px] text-surface-500">暂无分层地图</p>
                  ) : (
                    <div className="space-y-1 max-h-40 overflow-y-auto">
                      {configLayers.map((layer, idx) => (
                        <div key={layer.id || idx}
                          className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-surface-800/30 hover:bg-surface-800/50 transition-colors">
                          <span className="text-[10px] font-mono text-purple-400 w-6 shrink-0">{layer.level}</span>
                          <span className="flex-1 text-[11px] text-surface-300 truncate">{layer.name || '未命名'}</span>
                          <span className="text-[9px] text-surface-500 truncate max-w-[80px]">{layer.imageFilename || ''}</span>
                          <button onClick={() => { setLayerEditData({ ...layer, editIndex: idx }); setShowLayerManager(true) }}
                            className="text-[10px] text-amber-400 hover:text-amber-300 shrink-0">✎</button>
                          <button onClick={() => handleLayerDelete(idx)}
                            className="text-[10px] text-red-400 hover:text-red-300 shrink-0">✕</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ── 开发者模式：标点分类管理 ── */}
              {devMode && currentMapId && (
                <div className="col-span-2 border-t border-white/5 pt-4 mt-4">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-xs font-semibold text-surface-300">标点管理器</h4>
                    <button onClick={() => { setEditMarkerCategory(''); setShowMarkerCreator(true) }}
                      className="text-[10px] px-2 py-1 rounded-lg bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 transition-colors">
                      + 新建标点
                    </button>
                  </div>
                  {(() => {
                    // 兼容处理：将旧值统一归入 fixed 类型
                    const normalizeCat = (c) => {
                      const raw = c || 'other'
                      return FIXED_CATEGORIES.includes(raw) ? raw : 'other'
                    }
                    // 按固定类型顺序渲染
                    return FIXED_CATEGORIES.map(cat => {
                      const rawCat = cat === 'other' ? '' : cat
                      const markersInCat = markerTemplates.filter(t => normalizeCat(t.category || '') === cat)
                      const catDisplay = MARKER_TYPE_ZH[cat] || cat
                      return (
                      <div key={cat} className="mb-2">
                        {/* 分类标题栏 — 可拖放至此将标点移入该分类 */}
                        <div className="flex items-center justify-between mb-1"
                          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
                          onDrop={async (e) => {
                            e.preventDefault()
                            const fromId = e.dataTransfer.getData('text/plain')
                            const fromMarker = markerTemplates.find(x => x.id === fromId)
                            if (!fromMarker) return
                            const fromCat = normalizeCat(fromMarker.category || '')
                            if (fromCat === cat) return
                            // 跨分类：更新 category + marker_type，不调序
                            await window.electronAPI?.mapUpdateMarker(fromId, { category: rawCat, marker_type: rawCat || 'normal' })
                            loadMarkers(currentMapId)
                          }}>
                          <p className="text-[10px] text-surface-500">{catDisplay}（{markersInCat.length}）</p>
                          <button onClick={() => { setEditMarkerCategory(rawCat); setShowMarkerCreator(true) }}
                            className="text-[10px] text-amber-400 hover:text-amber-300">+</button>
                        </div>
                        <div className="grid grid-cols-2 gap-1">
                          {markersInCat.map((m, mi) => (
                            <div key={m.id}
                              draggable
                              onDragStart={(e) => { e.dataTransfer.setData('text/plain', m.id); e.dataTransfer.effectAllowed = 'move' }}
                              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
                              onDrop={async (e) => {
                                e.preventDefault()
                                const fromId = e.dataTransfer.getData('text/plain')
                                if (fromId === m.id) return
                                const fromMarker = markerTemplates.find(x => x.id === fromId)
                                const toMarker = markerTemplates.find(x => x.id === m.id)
                                if (!fromMarker || !toMarker) return
                                const fromCat = normalizeCat(fromMarker.category || '')
                                const toCat = normalizeCat(toMarker.category || '')
                                if (fromCat === toCat) {
                                  // 同分类：仅调序
                                  const arr = markerTemplates
                                  const fromIdx = arr.findIndex(x => x.id === fromId)
                                  const toIdx = arr.findIndex(x => x.id === m.id)
                                  if (fromIdx < 0 || toIdx < 0) return
                                  const next = [...arr]
                                  const [item] = next.splice(fromIdx, 1)
                                  // splice 移除后索引自动偏移，直接用 toIdx 即可正确处理前后双向
                                  next.splice(toIdx, 0, item)
                                  await window.electronAPI?.mapReorderMarkers(next.map(x => x.id))
                                } else {
                                  // 跨分类：只更新 category + marker_type，不调序
                                  await window.electronAPI?.mapUpdateMarker(fromId, { category: (toCat === 'other' ? '' : toCat), marker_type: toCat === 'other' ? 'normal' : toCat })
                                }
                                loadMarkers(currentMapId)
                              }}
                              className="flex items-center gap-2 px-2 py-1 rounded bg-surface-800/30 text-[10px] text-surface-300 cursor-grab active:cursor-grabbing">
                              <span className="text-[10px] text-surface-600 w-3 select-none shrink-0">⠿</span>
                              {m.image_filename ? (
                                <img src={`local-media://${(m.image_filename || '').trim()}`} className="w-4 h-4 object-cover rounded shrink-0" />
                              ) : (
                                <div className={`w-3 h-3 shrink-0 ${m.marker_type === 'circle' ? 'rounded-full border' : 'rounded'}`}
                                  style={m.marker_type === 'circle' ? { borderColor: '#f59e0b' } : { backgroundColor: '#f59e0b' }} />
                              )}
                              <span className="flex-1 truncate">{m.name_zh || '未命名'}</span>
                              <span className="text-[9px] text-surface-500 shrink-0 bg-white/5 px-1.5 py-0.5 rounded">{MARKER_TYPE_ZH[m.marker_type] || m.marker_type}</span>
                              <button onClick={async () => {
                                const newFav = !m.is_favorite
                                await window.electronAPI?.mapUpdateMarker(m.id, { is_favorite: newFav })
                                loadMarkers(currentMapId)
                              }} className={`text-[10px] shrink-0 ${m.is_favorite ? 'text-amber-400' : 'text-surface-600 hover:text-amber-400'}`}>
                                {m.is_favorite ? '★' : '☆'}
                              </button>
                              <button onClick={() => { setMarkerEditData(m); setShowMarkerCreator(true) }}
                                className="text-[10px] text-amber-400 hover:text-amber-300 shrink-0">✎</button>
                              <button onClick={async () => {
                                if (!confirm(`确定删除标点「${m.name_zh || '未命名'}」？`)) return
                                await window.electronAPI?.mapDeleteMarker(m.id)
                                loadMarkers(currentMapId)
                              }} className="text-[10px] text-red-400 hover:text-red-300 shrink-0">✕</button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )})
                  })()}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

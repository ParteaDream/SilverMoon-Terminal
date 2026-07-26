import { useState, useEffect, useRef, useCallback } from 'react'
import { Crosshair, Check, X, ZoomIn } from 'lucide-react'

// ═══════════════════════════════════════
// 地图标定组件 — 两点锚定引擎
// 采用 CSS matrix transform 体系（与大世界地图一致）
// ═══════════════════════════════════════
export default function MapCalibration({
  previewData,   // base64 预览图
  previewW,      // 预览图宽
  previewH,      // 预览图高
  imageW,        // 原图宽
  imageH,        // 原图高
  srcPath,       // 原图文件路径
  mapName,       // 地图名称（用户输入）
  initialDistance, // 预填距离（更新地图时使用）
  onConfirm,     // (result) => {} 确认回调
  onCancel,      // () => {} 取消回调
}) {
  // 定点 A（世界原点）和定点 B（方向+距离参考）— 像素坐标在预览图上
  const [pointA, setPointA] = useState({ x: previewW * 0.3, y: previewH * 0.6 })
  const [pointB, setPointB] = useState({ x: previewW * 0.7, y: previewH * 0.4 })
  const [activePoint, setActivePoint] = useState('A') // 'A' | 'B'
  const [distanceInput, setDistanceInput] = useState(initialDistance || '')
  const [mapNameInput, setMapNameInput] = useState(mapName || '')
  const [magZoom, setMagZoom] = useState(5)   // 放大镜倍率
  const [confirmError, setConfirmError] = useState(null) // 标定错误

  // ── 视图变换（与大世界地图的 matrix 体系一致） ──
  // localZoom: CSS transform scale 值
  // viewCenter: CSS matrix 的 e/f（视口偏移，屏幕像素）
  const [localZoom, setLocalZoom] = useState(1)
  const [viewCenter, setViewCenter] = useState({ x: 0, y: 0 })
  const localZoomRef = useRef(localZoom)
  const viewCenterRef = useRef(viewCenter)

  const containerRef = useRef(null)
  const mapDragStart = useRef({ x: 0, y: 0 })
  const pointDragStart = useRef({ x: 0, y: 0, point: { x: 0, y: 0 } })
  const [mapDragging, setMapDragging] = useState(false)
  const mapDraggingRef = useRef(false)
  const [dragging, setDragging] = useState(null) // 'A' | 'B' | null
  const magnifierCanvasRef = useRef(null)
  const magnifierImgRef = useRef(null)        // 原图 Image 对象
  const [magnifierOn, setMagnifierOn] = useState(false)
  const [magnifierReady, setMagnifierReady] = useState(false)

  // ── 初始视角居中 ──
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const frame = requestAnimationFrame(() => {
      const rect = el.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        setViewCenter({
          x: rect.width / 2 - previewW / 2,
          y: rect.height / 2 - previewH / 2,
        })
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [])

  // 同步 ref，供空依赖滚轮事件使用
  useEffect(() => { localZoomRef.current = localZoom; viewCenterRef.current = viewCenter }, [localZoom, viewCenter])

  // ── 原图加载（解码到 Image 对象供放大镜 Canvas 使用） ──
  useEffect(() => {
    if (!srcPath) return
    let cancelled = false
    ;(async () => {
      const res = await window.electronAPI?.readFilePreview(srcPath, Math.max(imageW, imageH))
      if (cancelled || !res?.success || !res.data) return
      const img = new Image()
      img.onload = () => {
        if (!cancelled) {
          magnifierImgRef.current = img
          setMagnifierReady(true)
        }
      }
      img.src = res.data
    })()
    return () => { cancelled = true }
  }, [srcPath, imageW, imageH])

  // 将逻辑坐标（预览图像素）转为屏幕坐标（相对于容器）
  function logicalToScreen(lx, ly) {
    return {
      sx: lx * localZoom + viewCenter.x,
      sy: ly * localZoom + viewCenter.y,
    }
  }

  // 将屏幕坐标（相对于容器）转为逻辑坐标
  function screenToLogical(sx, sy) {
    return {
      lx: (sx - viewCenter.x) / localZoom,
      ly: (sy - viewCenter.y) / localZoom,
    }
  }

  // 以指定屏幕位置为中心缩放
  function zoomAround(newZoom, screenCX, screenCY) {
    const oldZoom = localZoom
    setViewCenter({
      x: screenCX - (screenCX - viewCenter.x) * newZoom / oldZoom,
      y: screenCY - (screenCY - viewCenter.y) * newZoom / oldZoom,
    })
    setLocalZoom(newZoom)
  }

  // ── 键盘微调 + Tab 切换 A/B ──
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Tab') {
        e.preventDefault()
        setActivePoint(prev => {
          const next = prev === 'A' ? 'B' : 'A'
          setMagnifierOn(false)
          // 切换时将定点移到容器中心
          const pt = next === 'A' ? pointA : pointB
          const el = containerRef.current
          if (el) {
            const rect = el.getBoundingClientRect()
            setViewCenter({
              x: rect.width / 2 - pt.x * localZoom,
              y: rect.height / 2 - pt.y * localZoom,
            })
          }
          return next
        })
        return
      }
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return
      e.preventDefault()
      const step = (e.ctrlKey || e.metaKey) ? 20 : e.shiftKey ? 5 : 0.5
      const setter = activePoint === 'A' ? setPointA : setPointB
      setter(prev => {
        let { x, y } = prev
        if (e.key === 'ArrowUp') y = Math.max(0, y - step)
        if (e.key === 'ArrowDown') y = Math.min(previewH, y + step)
        if (e.key === 'ArrowLeft') x = Math.max(0, x - step)
        if (e.key === 'ArrowRight') x = Math.min(previewW, x + step)
        return { x, y }
      })
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [activePoint, pointA, pointB, previewW, previewH, localZoom])

  // 预计算屏幕坐标供渲染使用
  const screenA = logicalToScreen(pointA.x, pointA.y)
  const screenB = logicalToScreen(pointB.x, pointB.y)

  // ── 定点拖拽 ──
  const handlePointerDown = useCallback((e, point) => {
    e.preventDefault()
    e.stopPropagation()
    setActivePoint(point)
    setMagnifierOn(false)
    const pt = point === 'A' ? pointA : pointB
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const cx = e.clientX - rect.left
    const cy = e.clientY - rect.top
    pointDragStart.current = { x: cx, y: cy, point: { x: pt.x, y: pt.y } }
    setDragging(point)
  }, [pointA, pointB])

  const handlePointerMove = useCallback((e) => {
    if (!dragging || !containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const cx = e.clientX - rect.left
    const cy = e.clientY - rect.top

    // 拖拽死区：移动 3px 以内视为点击，不移动定点
    const dx = cx - pointDragStart.current.x
    const dy = cy - pointDragStart.current.y
    if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return

    // 屏幕偏移 → 逻辑坐标偏移（除以 zoom）
    const dLx = dx / localZoom
    const dLy = dy / localZoom
    const newX = Math.max(0, Math.min(previewW, pointDragStart.current.point.x + dLx))
    const newY = Math.max(0, Math.min(previewH, pointDragStart.current.point.y + dLy))
    if (dragging === 'A') setPointA({ x: newX, y: newY })
    else setPointB({ x: newX, y: newY })
  }, [dragging, previewW, previewH, localZoom])

  const handlePointerUp = useCallback(() => {
    setDragging(null)
  }, [])

  // ── 滚轮缩放（ref 持有最新值，只注册一次，不再穿透） ──
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e) => {
      e.preventDefault()
      e.stopPropagation()
      const rect = el.getBoundingClientRect()
      const cx = e.clientX - rect.left
      const cy = e.clientY - rect.top
      const z = localZoomRef.current
      const vc = viewCenterRef.current
      const step = Math.min(0.06, Math.abs(e.deltaY) / 600)
      const nz = Math.max(0.1, Math.min(5, z * Math.exp(e.deltaY > 0 ? -step : step)))
      setViewCenter({
        x: cx - (cx - vc.x) * nz / z,
        y: cy - (cy - vc.y) * nz / z,
      })
      setLocalZoom(nz)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])  // ← 空依赖，只注册一次，消除穿透间隙

  // ── 放大镜 Canvas 绘制（按需裁剪原图局部，不触发全图缩放） ──
  useEffect(() => {
    const canvas = magnifierCanvasRef.current
    const img = magnifierImgRef.current
    if (!magnifierOn || !img || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const pt = activePoint === 'A' ? pointA : pointB
    const magSize = canvas.width
    const cropSize = magSize / magZoom
    const scaleX = img.naturalWidth / previewW
    const scaleY = img.naturalHeight / previewH
    const sx = pt.x * scaleX - cropSize / 2
    const sy = pt.y * scaleY - cropSize / 2
    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, magSize, magSize)
    ctx.drawImage(img,
      Math.max(0, sx), Math.max(0, sy),
      Math.min(cropSize, img.naturalWidth), Math.min(cropSize, img.naturalHeight),
      0, 0, magSize, magSize,
    )
  }, [magnifierOn, activePoint, magnifierReady, magZoom, pointA, pointB, previewW, previewH])

  // ── 计算世界坐标和比例尺 ──
  const calibrationResult = useCallback(() => {
    if (!distanceInput || isNaN(+distanceInput) || +distanceInput <= 0) return null

    // 预览图上的像素距离
    const dPreviewPx = Math.sqrt((pointB.x - pointA.x) ** 2 + (pointB.y - pointA.y) ** 2)
    if (dPreviewPx < 1) return null

    // 原图上的比例尺（预览→原图映射）
    const scaleX = imageW / previewW
    const scaleY = imageH / previewH
    // AB 在原图上的像素距离（取平均比例，因预览图等比缩放保持宽高比）
    const dOrigPx = Math.sqrt(
      ((pointB.x - pointA.x) * scaleX) ** 2 +
      ((pointB.y - pointA.y) * scaleY) ** 2
    )

    // 世界比例尺：每原图像素 = 多少世界单位
    const worldScale = (+distanceInput) / dOrigPx

    // 定点 A 在世界坐标中为 (0, 0)
    // 定点 B 的世界坐标
    const bWorldX = (pointB.x - pointA.x) * scaleX * worldScale
    const bWorldY = (pointB.y - pointA.y) * scaleY * worldScale

    // 任意预览像素 (px, py) → 原图像素 → 世界坐标
    // worldX = (px - pointA.x) * scaleX * worldScale
    // worldY = (py - pointA.y) * scaleY * worldScale

    const config = {
      anchorA: [Math.round(pointA.x * scaleX), Math.round(pointA.y * scaleY)],
      anchorB: [Math.round(pointB.x * scaleX), Math.round(pointB.y * scaleY)],
      distance: +distanceInput,
      scale: worldScale,
      mapW: imageW,
      mapH: imageH,
      tileSize: 512,
    }

    return {
      config,
      anchorA_preview: { x: pointA.x, y: pointA.y },
      anchorB_preview: { x: pointB.x, y: pointB.y },
    }
  }, [pointA, pointB, distanceInput, previewW, previewH, imageW, imageH])

  const result = calibrationResult()
  const canConfirm = !!result && mapNameInput.trim().length > 0

  const handleConfirm = async () => {
    if (!canConfirm) { console.log('[MapCalibration] blocked:', { name: mapNameInput.trim(), distance: distanceInput, result: !!result }); return }
    setConfirmError(null)
    try {
      await onConfirm({
        mapId: (() => {
          const cleaned = mapNameInput.trim()
            .replace(/[\u4e00-\u9fff]+/g, '')
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '')
            .toLowerCase()
          return (cleaned || 'map') + '_' + Date.now().toString(36).slice(-4)
        })(),
        nameZh: mapNameInput.trim(),
        ...result,
        srcPath,
      })
    } catch (e) {
      setConfirmError(e.message || '标定失败')
      console.error('[MapCalibration] confirm error:', e)
    }
  }

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onCancel} onMouseDown={e => e.stopPropagation()}>
      <div
        className="w-full h-full rounded-2xl bg-surface-900 border border-white/10 shadow-2xl flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
          <div className="flex items-center gap-3">
            <Crosshair className="w-5 h-5 text-amber-400" />
            <h2 className="text-sm font-semibold text-white">地图标定</h2>
            <span className="text-[11px] text-surface-500">
              原图 {imageW} × {imageH}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-surface-500">
              活动定点：<span className={activePoint === 'A' ? 'text-red-400 font-medium' : 'text-surface-400'}>A</span>
              {' / '}
              <span className={activePoint === 'B' ? 'text-blue-400 font-medium' : 'text-surface-400'}>B</span>
              {' · '}方向键 0.5px · Shift 5px · Cmd/Ctrl 20px
            </span>
            <button onClick={onCancel} className="p-1.5 rounded-lg hover:bg-white/10 text-surface-400 hover:text-white transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden min-h-0">
          {/* ── 左侧：预览图 + 定点（matrix transform） ── */}
          <div ref={containerRef} className="flex-1 relative overflow-hidden bg-surface-950"
            style={{ cursor: dragging ? 'crosshair' : mapDragging ? 'grabbing' : 'grab' }}
            onMouseDown={(e) => {
              // 只有鼠标在空白区域按下时才触发地图拖拽（非定点）
              if (e.target === containerRef.current || e.target.closest('.map-calibration-bg')) {
                if (e.button !== 0) return
                mapDraggingRef.current = true
                setMapDragging(true)
                mapDragStart.current = { x: e.clientX - viewCenter.x, y: e.clientY - viewCenter.y }
              }
            }}
            onMouseMove={(e) => {
              // 地图拖拽
              if (mapDraggingRef.current && !dragging) {
                const newVC = {
                  x: e.clientX - mapDragStart.current.x,
                  y: e.clientY - mapDragStart.current.y,
                }
                setViewCenter(newVC)
              }
            }}
            onMouseUp={() => {
              mapDraggingRef.current = false
              setMapDragging(false)
            }}
            onMouseLeave={() => {
              mapDraggingRef.current = false
              setMapDragging(false)
            }}
          >
            {/* 缩放变换层 — matrix 与大世界地图一致 */}
            <div style={{
              transform: `matrix(${localZoom}, 0, 0, ${localZoom}, ${viewCenter.x}, ${viewCenter.y})`,
              transformOrigin: '0 0',
              position: 'absolute',
              left: 0, top: 0,
            }}>
              {/* 主预览图 — 用小预览图保证拖动缩放流畅 */}
              {previewData && (
                <img
                  src={previewData}
                  alt="地图预览"
                  draggable={false}
                  className="map-calibration-bg"
                  style={{ width: previewW, height: previewH, maxWidth: 'none', maxHeight: 'none' }}
                />
              )}

              {/* 固定点 A - 红色 */}
              <div
                className="absolute cursor-pointer"
                style={{
                  left: pointA.x - 12, top: pointA.y - 12,
                  width: 24, height: 24,
                  zIndex: activePoint === 'A' ? 20 : 10,
                }}
                onMouseDown={(e) => handlePointerDown(e, 'A')}
              >
                <svg viewBox="0 0 24 24" className="w-full h-full drop-shadow-lg" style={{ filter: 'drop-shadow(0 0 4px rgba(255,0,0,0.6))' }}>
                  <line x1="12" y1="0" x2="12" y2="24" stroke="#ef4444" strokeWidth="2" />
                  <line x1="0" y1="12" x2="24" y2="12" stroke="#ef4444" strokeWidth="2" />
                  <circle cx="12" cy="12" r="4" fill="#ef4444" fillOpacity="0.8" />
                </svg>
                <div className="absolute -top-5 left-5 text-[10px] font-bold text-red-400 bg-surface-900/80 px-1 rounded whitespace-nowrap">
                  A ({pointA.x.toFixed(1)}, {pointA.y.toFixed(1)})
                </div>
              </div>

              {/* 固定点 B - 蓝色 */}
              <div
                className="absolute cursor-pointer"
                style={{
                  left: pointB.x - 12, top: pointB.y - 12,
                  width: 24, height: 24,
                  zIndex: activePoint === 'B' ? 20 : 10,
                }}
                onMouseDown={(e) => handlePointerDown(e, 'B')}
              >
                <svg viewBox="0 0 24 24" className="w-full h-full drop-shadow-lg" style={{ filter: 'drop-shadow(0 0 4px rgba(59,130,246,0.6))' }}>
                  <line x1="12" y1="0" x2="12" y2="24" stroke="#3b82f6" strokeWidth="2" />
                  <line x1="0" y1="12" x2="24" y2="12" stroke="#3b82f6" strokeWidth="2" />
                  <circle cx="12" cy="12" r="4" fill="#3b82f6" fillOpacity="0.8" />
                </svg>
                <div className="absolute -top-5 left-5 text-[10px] font-bold text-blue-400 bg-surface-900/80 px-1 rounded whitespace-nowrap">
                  B ({pointB.x.toFixed(1)}, {pointB.y.toFixed(1)})
                </div>
              </div>

              {/* A→B 连线 */}
              <svg className="absolute pointer-events-none" style={{ zIndex: 5, left: 0, top: 0, width: previewW, height: previewH }}>
                <line
                  x1={pointA.x} y1={pointA.y}
                  x2={pointB.x} y2={pointB.y}
                  stroke="rgba(255,255,255,0.2)"
                  strokeWidth="1"
                  strokeDasharray="4 4"
                />
              </svg>
            </div>

            {/* 放大镜 — 按需开启，magnifierOn 控制显隐 */}
            {magnifierOn && (() => {
              const pt = activePoint === 'A' ? pointA : pointB
              const screen = logicalToScreen(pt.x, pt.y)
              const el = containerRef.current
              if (!screen || !el) return null
              const cw = el.getBoundingClientRect().width
              const magSize = Math.max(150, Math.min(400, cw * 0.25))
              return (
                <div className="absolute border-2 rounded-full overflow-hidden pointer-events-none shadow-2xl"
                  style={{
                    width: magSize, height: magSize,
                    borderColor: activePoint === 'A' ? '#ef4444' : '#3b82f6',
                    left: screen.sx - magSize / 2, top: screen.sy - magSize / 2,
                    zIndex: 30,
                  }}>
                  {/* Canvas 裁剪原图局部 */}
                  <canvas ref={magnifierCanvasRef} width={magSize} height={magSize}
                    className="absolute inset-0" style={{ imageRendering: 'pixelated' }} />
                  {/* 十字准星 SVG overlay */}
                  <svg className="absolute inset-0 w-full h-full" style={{ zIndex: 1 }}>
                    <line x1="0" y1={magSize/2} x2={magSize} y2={magSize/2}
                      stroke={activePoint === 'A' ? '#ef4444' : '#3b82f6'} strokeWidth="1" strokeOpacity="0.7" />
                    <line x1={magSize/2} y1="0" x2={magSize/2} y2={magSize}
                      stroke={activePoint === 'A' ? '#ef4444' : '#3b82f6'} strokeWidth="1" strokeOpacity="0.7" />
                    <circle cx={magSize/2} cy={magSize/2} r="3"
                      fill={activePoint === 'A' ? '#ef4444' : '#3b82f6'} fillOpacity="0.9" />
                  </svg>
                  {/* 原图未就绪时显示 loading */}
                  {!magnifierReady && (
                    <div className="absolute inset-0 flex items-center justify-center bg-surface-950/60 rounded-full">
                      <div className="w-6 h-6 rounded-full border-2 border-amber-500/30 border-t-amber-400 animate-spin" />
                    </div>
                  )}
                </div>
              )
            })()}
          </div>

          {/* ── 右侧控制面板 ── */}
          <div className="w-72 shrink-0 border-l border-white/5 flex flex-col bg-surface-900/50 p-4 overflow-y-auto max-h-full" style={{ scrollbarWidth: 'thin' }}>
            <h3 className="text-xs font-semibold text-surface-300 mb-4 flex items-center gap-2">
              <Crosshair className="w-3.5 h-3.5 text-amber-400" />
              标定设置
            </h3>

            {/* 地图名称 */}
            <div className="mb-4">
              <label className="text-[11px] text-surface-400 block mb-1">地图名称</label>
              <input
                value={mapNameInput}
                onChange={e => setMapNameInput(e.target.value)}
                placeholder="如：提瓦特"
                className="w-full px-3 py-2 rounded-lg bg-surface-800 border border-white/10 text-sm text-surface-200 placeholder-surface-600 outline-none focus:border-amber-500/40 transition-colors"
              />
            </div>

            {/* 定点 A（红色） — 点击切换活动 */}
            <div
              onClick={() => { 
                setActivePoint('A')
                setMagnifierOn(false)
                const el = containerRef.current
                if (el) {
                  const rect = el.getBoundingClientRect()
                  setViewCenter({ x: rect.width / 2 - pointA.x * localZoom, y: rect.height / 2 - pointA.y * localZoom })
                }
              }}
              className={`mb-2 p-2 rounded-lg border cursor-pointer transition-colors ${activePoint === 'A' ? 'bg-red-500/15 border-red-500/40' : 'bg-surface-800/50 border-red-500/20 hover:bg-red-500/5'}`}>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-3 h-3 rounded-full bg-red-500" />
                <span className="text-[11px] font-medium text-red-400">定点 A（世界原点 (0,0)）</span>
              </div>
              <p className="text-[10px] text-surface-500">
                坐标：({pointA.x.toFixed(1)}, {pointA.y.toFixed(1)})
                {activePoint === 'A' && <span className="text-red-400 ml-1">← 活动</span>}
              </p>
            </div>

            {/* 定点 B（蓝色） — 点击切换活动 */}
            <div
              onClick={() => { 
                setActivePoint('B')
                setMagnifierOn(false)
                const el = containerRef.current
                if (el) {
                  const rect = el.getBoundingClientRect()
                  setViewCenter({ x: rect.width / 2 - pointB.x * localZoom, y: rect.height / 2 - pointB.y * localZoom })
                }
              }}
              className={`mb-3 p-2 rounded-lg border cursor-pointer transition-colors ${activePoint === 'B' ? 'bg-blue-500/15 border-blue-500/40' : 'bg-surface-800/50 border-blue-500/20 hover:bg-blue-500/5'}`}>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-3 h-3 rounded-full bg-blue-500" />
                <span className="text-[11px] font-medium text-blue-400">定点 B（方向+距离参考）</span>
              </div>
              <p className="text-[10px] text-surface-500">
                坐标：({pointB.x.toFixed(1)}, {pointB.y.toFixed(1)})
                {activePoint === 'B' && <span className="text-blue-400 ml-1">← 活动</span>}
              </p>
            </div>

            {/* 距离输入 */}
            <div className="mb-4">
              <label className="text-[11px] text-surface-400 block mb-1">
                AB 世界距离 <span className="text-surface-600">（世界单位）</span>
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={distanceInput}
                  onChange={e => setDistanceInput(e.target.value)}
                  placeholder="输入距离"
                  className="flex-1 px-3 py-2 rounded-lg bg-surface-800 border border-white/10 text-sm text-surface-200 placeholder-surface-600 outline-none focus:border-amber-500/40 transition-colors"
                />
              </div>
            </div>

            {/* 计算结果预览 */}
            {result && (
              <div className="mb-4 p-3 rounded-lg bg-surface-800/50 border border-emerald-500/20">
                <p className="text-[11px] font-medium text-emerald-400 mb-2">✅ 标定计算结果</p>
                <div className="space-y-1 text-[10px] text-surface-400">
                  <p>AB 预览距离：{Math.sqrt((pointB.x - pointA.x) ** 2 + (pointB.y - pointA.y) ** 2).toFixed(1)} px</p>
                  <p>AB 原图距离：{Math.sqrt(
                    ((pointB.x - pointA.x) * (imageW / previewW)) ** 2 +
                    ((pointB.y - pointA.y) * (imageH / previewH)) ** 2
                  ).toFixed(1)} px</p>
                  <p>比例尺：{result.config.scale.toExponential(4)} 世界单位/像素</p>
                  <p className="text-surface-500 mt-1">提示：确认后将进入切片流程</p>
                </div>
              </div>
            )}

            {/* 预览缩放控制 */}
            <div className="mb-4">
              <label className="text-[11px] text-surface-400 block mb-1">
                预览缩放 <span className="text-surface-600">（0.1~5x）</span>
              </label>
              <div className="flex items-center gap-2">
                <input type="range" min="0.1" max="5" step="0.1"
                  value={localZoom} onChange={e => {
                    const el = containerRef.current
                    if (!el) return
                    const rect = el.getBoundingClientRect()
                    zoomAround(+e.target.value, rect.width / 2, rect.height / 2)
                  }}
                  className="flex-1 h-1 accent-amber-500 cursor-pointer" />
                <span className="text-xs text-surface-300 w-10 text-right tabular-nums">{localZoom.toFixed(1)}x</span>
              </div>
            </div>

            {/* 放大镜设置 */}
            <div className="mb-4">
              <label className="text-[11px] text-surface-400 block mb-1">
                放大镜倍率 <span className="text-surface-600">（1~20x）</span>
              </label>
              <div className="flex items-center gap-2">
                <input type="range" min="1" max="20" step="0.5"
                  value={magZoom} onChange={e => setMagZoom(+e.target.value)}
                  className="flex-1 h-1 accent-amber-500 cursor-pointer" />
                <span className="text-xs text-surface-300 w-10 text-right tabular-nums">{magZoom}x</span>
              </div>
            </div>

            {/* 开启放大镜按钮 */}
            <div className="mb-4">
              <label className="text-[11px] text-surface-400 block mb-1">放大镜</label>
              <button
                onClick={() => setMagnifierOn(o => !o)}
                disabled={!magnifierReady}
                className={`w-full px-4 py-2 rounded-lg text-xs font-medium transition-colors ${
                  magnifierOn
                    ? 'bg-amber-500/20 border border-amber-500/40 text-amber-400'
                    : 'bg-surface-800 border border-white/10 text-surface-300 hover:bg-white/5'
                } disabled:opacity-40 disabled:cursor-not-allowed`}
              >
                {magnifierOn ? '关闭放大镜' : magnifierReady ? '🔍 开启放大镜' : '原图加载中…'}
              </button>
            </div>

            {/* 操作提示 */}
            <div className="mb-4 p-2 rounded-lg bg-surface-800/30">
              <p className="text-[10px] text-surface-500 leading-relaxed">
                <span className="text-surface-400 font-medium">操作：</span><br />
                ① 拖拽红/蓝十字线或点击选择后使用键盘微调（0.5px）<br />
                ② 活动定点用 Tab / 点击卡片切换<br />
                ③ 输入 AB 在世界中的真实距离<br />
                ④ 点击"确认标定"进入切片
              </p>
            </div>

            {/* ── 确认前置条件检查 ── */}
            {!canConfirm && (
              <div className="mb-3 p-2.5 rounded-lg bg-surface-800/40 border border-white/5">
                <p className="text-[10px] text-surface-500 mb-1.5">还需完成：</p>
                {!mapNameInput.trim() && (
                  <p className="text-[10px] text-amber-400/80">▸ 输入地图名称</p>
                )}
                {!(distanceInput && +distanceInput > 0) && (
                  <p className="text-[10px] text-amber-400/80">▸ 输入 AB 世界距离</p>
                )}
                {mapNameInput.trim() && distanceInput && +distanceInput > 0 && !result && (
                  <p className="text-[10px] text-amber-400/80">▸ A 和 B 距离太近（&lt;1px）</p>
                )}
              </div>
            )}

            {confirmError && (
              <div className="mb-3 p-2 rounded-lg bg-red-500/10 border border-red-500/20">
                <p className="text-[10px] text-red-400">{confirmError}</p>
              </div>
            )}
            <div className="shrink-0 sticky bottom-0 flex gap-2 pt-3 pb-1 bg-surface-900/50 backdrop-blur-sm -mx-4 px-4">
              <button onClick={onCancel} className="flex-1 px-4 py-2 rounded-xl border border-white/10 text-sm text-surface-300 hover:bg-white/5 transition-colors">
                取消
              </button>
              <button
                onClick={handleConfirm}
                disabled={!canConfirm}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                  canConfirm
                    ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30 hover:bg-amber-500/30'
                    : 'bg-surface-800 text-surface-600 border border-white/5 cursor-not-allowed'
                }`}
              >
                <Check className="w-4 h-4" />
                确认标定
              </button>
            </div>
          </div>
        </div>

        {/* 鼠标全局事件 */}
        {dragging && (
          <div
            className="absolute inset-0 z-40"
            onMouseMove={handlePointerMove}
            onMouseUp={handlePointerUp}
            style={{ cursor: 'crosshair' }}
          />
        )}
      </div>
    </div>
  )
}

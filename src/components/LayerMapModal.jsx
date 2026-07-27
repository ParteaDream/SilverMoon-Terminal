import { useState, useCallback, useRef, useEffect } from 'react'
import { X, Check, Image, Layers } from 'lucide-react'

// ═══════════════════════════════════════
// 分层地图创建/编辑弹窗
// ═══════════════════════════════════════
export default function LayerMapModal({
  editData,
  mapConfig,
  onConfirm,
  onCancel,
}) {
  const existingLayers = mapConfig?.layers || []

  // ── 地图参数 ──
  const [name, setName] = useState(editData?.name || '')
  const [level, setLevel] = useState(editData?.level || '')
  const [imageFilename, setImageFilename] = useState(editData?.imageFilename || '')
  const [worldX, setWorldX] = useState(editData?.worldX ?? editData?._defaultX ?? 0)
  const [worldY, setWorldY] = useState(editData?.worldY ?? editData?._defaultY ?? 0)
  const [mapSize, setMapSize] = useState(() => {
    if (editData?.width) return editData.width
    if (editData?.height) return editData.height
    return 500
  })
  const [zIndex, setZIndex] = useState(editData?.zIndex ?? existingLayers.length)
  const [aspectRatio, setAspectRatio] = useState(1)

  // ── 预览状态（纯视觉，不影响数据） ──
  const [previewZoom, setPreviewZoom] = useState(1.0)
  const [panX, setPanX] = useState(0)
  const [panY, setPanY] = useState(0)
  const zoomRef = useRef(1.0)
  zoomRef.current = previewZoom
  const [previewFlip, setPreviewFlip] = useState(false) // false=分层在上, true=G层在上

  // ── 参考图切换 ──
  const [referenceIndex, setReferenceIndex] = useState(-1) // -1=无，0=第一张已有分层地图...
  const [refImageSrc, setRefImageSrc] = useState(null)
  const [refLayerData, setRefLayerData] = useState(null)

  // ── G 层背景 ──
  const [bgImageSrc, setBgImageSrc] = useState(null)

  const previewRef = useRef(null)
  const modalRef = useRef(null)
  const dragState = useRef(null)
  const containerSizeRef = useRef({ w: 500, h: 400 })
  const initialViewSet = useRef(false)

  // ── 监听容器尺寸变化 ──
  useEffect(() => {
    const el = previewRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      for (const e of entries) {
        containerSizeRef.current = { w: e.contentRect.width, h: e.contentRect.height }
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ── 世界容器缩放因子（将世界坐标空间 fit 到预览容器） ──
  const worldMetrics = (() => {
    const mw = mapConfig?.mapW || 1
    const mh = mapConfig?.mapH || 1
    const sc = mapConfig?.scale || 1
    const ax = mapConfig?.anchorA?.[0] || 0
    const ay = mapConfig?.anchorA?.[1] || 0
    const cw = containerSizeRef.current.w
    const ch = containerSizeRef.current.h
    const worldW = mw * sc   // G 层世界宽度
    const worldH = mh * sc   // G 层世界高度
    const fitScale = Math.min(cw / worldW, ch / worldH, 1)  // 缩放到容器内，最大 1x
    return { worldW, worldH, fitScale, ax, ay, sc }
  })()

  // ── 编辑/新建模式：初始视角定位到分层地图位置或可视中心 ──
  useEffect(() => {
    if (initialViewSet.current) return
    const wx = editData?.worldX ?? editData?._defaultX
    const wy = editData?.worldY ?? editData?._defaultY
    if (wx == null || wy == null) return
    const { worldW, worldH, fitScale } = worldMetrics
    if (fitScale > 0) {
      setPanX((worldW / 2 - wx) * fitScale)
      setPanY((worldH / 2 - wy) * fitScale)
      initialViewSet.current = true
    }
  }, [worldMetrics, editData])

  // ── 加载参考图 ──
  useEffect(() => {
    if (referenceIndex < 0 || referenceIndex >= existingLayers.length) {
      setRefImageSrc(null); setRefLayerData(null); return
    }
    const layer = existingLayers[referenceIndex]
    setRefLayerData(layer)
    if (!layer?.imageFilename) { setRefImageSrc(null); return }
    let cancelled = false
    window.electronAPI?.readImage(layer.imageFilename, 2048).then(r => {
      if (!cancelled && r?.success) setRefImageSrc(r.data)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [referenceIndex, existingLayers])

  const isEdit = !!editData
  const width = mapSize
  const height = mapSize / aspectRatio

  // ── 加载 G 层背景 ──
  useEffect(() => {
    let cancelled = false
    const fullImage = mapConfig?.fullImage
    if (!fullImage) { setBgImageSrc(null); return }
    window.electronAPI?.readImage(fullImage, 2048).then(r => {
      if (!cancelled && r?.success) setBgImageSrc(r.data)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [mapConfig?.fullImage])

  // ── 读取图片宽高比 ──
  const loadImageAspectRatio = useCallback((filename) => {
    if (!filename) return
    const img = document.createElement('img')
    img.onload = () => {
      if (img.naturalWidth && img.naturalHeight) {
        setAspectRatio(img.naturalWidth / img.naturalHeight)
      }
    }
    img.src = `local-media://${filename}`
  }, [])

  const handleImportImage = useCallback(async () => {
    const result = await window.electronAPI?.importImage()
    if (result?.success) {
      setImageFilename(result.filename)
      loadImageAspectRatio(result.filename)
      if (!name.trim()) {
        setName(result.filename.replace(/\.[^.]+$/, ''))
      }
    }
  }, [loadImageAspectRatio, name])

  const handleDropImage = useCallback(async (file) => {
    if (!file) return
    const result = await window.electronAPI?.importImageFile(file.path)
    if (result?.success) {
      setImageFilename(result.filename)
      loadImageAspectRatio(result.filename)
      if (!name.trim()) {
        setName(result.filename.replace(/\.[^.]+$/, ''))
      }
    }
  }, [loadImageAspectRatio, name])

  useEffect(() => {
    if (imageFilename) loadImageAspectRatio(imageFilename)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── 层级选项（每个层级可添加多个分层地图） ──
  const levelOptions = useCallback(() => {
    const options = []
    for (let i = 1; i <= 5; i++) {
      options.push(`F${i}`)
      options.push(`B${i}`)
    }
    return options
  }, [])

  // ── 工具：屏幕坐标 → 世界坐标 ──
  const screenToContent = useCallback((clientX, clientY) => {
    const rect = previewRef.current?.getBoundingClientRect()
    if (!rect) return { worldX: 0, worldY: 0 }
    const mx = clientX - rect.left
    const my = clientY - rect.top
    const { worldW, worldH, fitScale } = worldMetrics
    const s = previewZoom * fitScale  // 总缩放：预览缩放 × fit
    // 将屏幕坐标转换到世界坐标空间
    const worldX = (mx - rect.width / 2 - panX) / s + worldW / 2
    const worldY = (my - rect.height / 2 - panY) / s + worldH / 2
    return { worldX, worldY }
  }, [previewZoom, panX, panY, worldMetrics])

  // ── 分层地图上的鼠标事件：移动 / 调整大小 ──
  const handleLayerMouseDown = useCallback((e) => {
    e.stopPropagation()
    if (e.button !== 0) return
    const pt = screenToContent(e.clientX, e.clientY)
    const halfW = width / 2
    const halfH = height / 2
    const { fitScale } = worldMetrics
    const threshold = Math.max(15 / (previewZoom * fitScale), 8)  // 世界单位
    const dx = pt.worldX - worldX   // 距分层地图中心的世界偏移
    const dy = pt.worldY - worldY

    const nearEdge = Math.abs(Math.abs(dx) - halfW) < threshold ||
                     Math.abs(Math.abs(dy) - halfH) < threshold

    if (nearEdge) {
      // 判断是否同时靠近两条边（角拖拽）还是只靠近一条边（边拖拽）
      const nearCorner = Math.abs(Math.abs(dx) - halfW) < threshold * 2 &&
                         Math.abs(Math.abs(dy) - halfH) < threshold * 2
      if (nearCorner) {
        // 角拖拽：以对角为锚点
        const anchorX = worldX + (dx > 0 ? -halfW : halfW)
        const anchorY = worldY + (dy > 0 ? -halfH : halfH)
        dragState.current = {
          mode: 'resize',
          anchorX, anchorY,
          aspectRatio,
        }
      } else {
        // 边拖拽：以中心为锚点（保持旧行为）
        dragState.current = {
          mode: 'resize',
          origSize: mapSize,
          anchorX: worldX,
          anchorY: worldY,
          halfW, halfH,
        }
      }
    } else if (Math.abs(dx) < halfW && Math.abs(dy) < halfH) {
      // 移动
      dragState.current = {
        mode: 'move',
        origX: worldX, origY: worldY,
        startWX: pt.worldX, startWY: pt.worldY,
      }
    }
  }, [worldX, worldY, width, height, mapSize, screenToContent, previewZoom, aspectRatio])

  // ── 预览区空白处鼠标事件：平移视图 ──
  const handlePreviewMouseDown = useCallback((e) => {
    // 如果点击在分层地图上（已用 stopPropagation 拦截），这里就不处理
    // 只有点击空白区域时进入 pan 模式
    const pt = screenToContent(e.clientX, e.clientY)
    dragState.current = {
      mode: 'pan',
      startPX: panX, startPY: panY,
      startScreenX: e.clientX, startScreenY: e.clientY,
    }
  }, [panX, panY, screenToContent])

  // ── 全局鼠标移动/松开 ──
  useEffect(() => {
    const handleMove = (e) => {
      const ds = dragState.current
      if (!ds) return

      if (ds.mode === 'pan') {
        setPanX(ds.startPX + (e.clientX - ds.startScreenX))
        setPanY(ds.startPY + (e.clientY - ds.startScreenY))
        return
      }

      const pt = screenToContent(e.clientX, e.clientY)

      if (ds.mode === 'move') {
        setWorldX(ds.origX + (pt.worldX - ds.startWX))
        setWorldY(ds.origY + (pt.worldY - ds.startWY))
      } else if (ds.mode === 'resize') {
        if (ds.halfW != null) {
          // 边拖拽：以中心为锚点（旧行为）
          const dcx = pt.worldX - ds.anchorX
          const dcy = pt.worldY - ds.anchorY
          const ratio = Math.max(Math.abs(dcx) / ds.halfW, Math.abs(dcy) / ds.halfH)
          if (ratio > 0.1) setMapSize(Math.max(50, Math.round(ds.origSize * ratio)))
        } else {
          // 角拖拽：以对角为锚点
          const dx2 = pt.worldX - ds.anchorX
          const dy2 = pt.worldY - ds.anchorY
          const signX = dx2 >= 0 ? 1 : -1
          const signY = dy2 >= 0 ? 1 : -1
          const newW = Math.max(50, Math.max(Math.abs(dx2), Math.abs(dy2) * ds.aspectRatio))
          const newH = newW / ds.aspectRatio
          setMapSize(Math.round(newW))
          setWorldX(ds.anchorX + signX * newW / 2)
          setWorldY(ds.anchorY + signY * newH / 2)
        }
      }
    }
    const handleUp = () => { dragState.current = null }
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [screenToContent])

  // ── 键盘快捷键 ──
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!modalRef.current) return
      const tag = e.target.tagName
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
      const step = e.shiftKey ? 10 : 1
      switch (e.key) {
        case 'ArrowUp': if (!isInput) { e.preventDefault(); setWorldY(y => y - step) } break
        case 'ArrowDown': if (!isInput) { e.preventDefault(); setWorldY(y => y + step) } break
        case 'ArrowLeft': if (!isInput) { e.preventDefault(); setWorldX(x => x - step) } break
        case 'ArrowRight': if (!isInput) { e.preventDefault(); setWorldX(x => x + step) } break
        case '+': case '=': e.preventDefault(); setMapSize(s => s + 10); break
        case '-': case '_': e.preventDefault(); setMapSize(s => Math.max(50, s - 10)); break
        case 'Tab':
          e.preventDefault()
          setPreviewFlip(v => !v)
          break
        case ' ':
          if (!isInput && existingLayers.length > (editData?.editIndex != null ? 1 : 0)) {
            e.preventDefault()
            setReferenceIndex(i => {
              const skipIndex = editData?.editIndex ?? -1
              let next = i + 1
              // 跳过自身
              if (next === skipIndex) next++
              if (next >= existingLayers.length) return -1
              return next
            })
          }
          break
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [existingLayers.length, editData])

  // ── 鼠标滚轮缩放（以鼠标位置为中心） ──
  const handleWheel = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    const rect = previewRef.current?.getBoundingClientRect()
    if (!rect) return
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const cw = rect.width
    const ch = rect.height
    const oldZoom = previewZoom
    const delta = -Math.sign(e.deltaY)
    const ratio = delta > 0 ? 1.05 : 1 / 1.05
    const newZoom = Math.min(36, Math.max(0.1, oldZoom * ratio))
    if (newZoom === oldZoom) return
    const zoomRatio = newZoom / oldZoom
    setPreviewZoom(newZoom)
    setPanX(prev => (mx - cw / 2) * (1 - zoomRatio) + zoomRatio * prev)
    setPanY(prev => (my - ch / 2) * (1 - zoomRatio) + zoomRatio * prev)
  }, [previewZoom])

  // 原生 addEventListener + { passive: false } 绕开 passive 限制
  const wheelHandlerRef = useRef(handleWheel)
  wheelHandlerRef.current = handleWheel
  useEffect(() => {
    const el = previewRef.current
    if (!el) return
    const onWheel = (e) => wheelHandlerRef.current(e)
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // ── +/− 按钮缩放（以可视范围中心为焦点） ──
  const zoomAtCenter = useCallback((step) => {
    const oldZoom = zoomRef.current
    const newZoom = Math.min(36, Math.max(0.1, oldZoom + step))
    if (newZoom === oldZoom) return
    const zoomRatio = newZoom / oldZoom
    setPreviewZoom(newZoom)
    setPanX(prev => zoomRatio * prev)
    setPanY(prev => zoomRatio * prev)
  }, [])

  // ── 确认 ──
  const handleConfirm = () => {
    if (!name.trim() || !level || !imageFilename) return
    onConfirm({
      editIndex: editData?.editIndex ?? null,
      name: name.trim(),
      level,
      imageFilename,
      worldX: Math.round(worldX * 100) / 100,
      worldY: Math.round(worldY * 100) / 100,
      width: Math.round(width * 100) / 100,
      height: Math.round(height * 100) / 100,
      zIndex: Math.round(zIndex),
    })
  }

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onCancel}>
      <div ref={modalRef} className="w-[960px] max-w-[92vw] max-h-[92vh] flex flex-col rounded-xl bg-surface-900 border border-white/10 shadow-2xl p-5" onClick={e => e.stopPropagation()}>
        {/* ── 标题 ── */}
        <div className="flex items-center justify-between mb-4 shrink-0">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Layers className="w-4 h-4 text-purple-400" /> {isEdit ? '编辑分层地图' : '添加分层地图'}
          </h3>
          <button onClick={onCancel} className="p-1 rounded-lg hover:bg-white/10 text-surface-400 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── 主内容区 ── */}
        <div className="flex-1 flex gap-4 min-h-0 overflow-hidden">
          {/* ═══ 左侧栏 ═══ */}
          <div className="w-56 shrink-0 overflow-y-auto space-y-3 pr-1">
            <div>
              <label className="text-[11px] text-surface-400 block mb-1">地图名称</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="输入分层地图名称"
                className="w-full px-3 py-2 rounded-lg bg-surface-800 border border-white/10 text-sm text-surface-200 placeholder-surface-600 outline-none focus:border-purple-500/40 transition-colors" />
            </div>
            <div>
              <label className="text-[11px] text-surface-400 block mb-1">层级代号</label>
              <select value={level} onChange={e => setLevel(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-surface-800 border border-white/10 text-sm text-surface-200 outline-none focus:border-purple-500/40 transition-colors mb-1">
                <option value="">选择层级…</option>
                {levelOptions().map(opt => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
              <input value={level} onChange={e => setLevel(e.target.value)} placeholder="或输入自定义代号（如 B1）"
                className="w-full px-2 py-1.5 rounded-lg bg-surface-800 border border-white/10 text-xs text-surface-200 placeholder-surface-600 outline-none focus:border-purple-500/40 transition-colors" />
            </div>
            <div>
              <label className="text-[11px] text-surface-400 block mb-1">地图图片</label>
              <div
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation() }}
                onDrop={async (e) => {
                  e.preventDefault(); e.stopPropagation()
                  await handleDropImage(e.dataTransfer.files?.[0])
                }}
                className="flex flex-col gap-1"
              >
                <button onClick={handleImportImage}
                  className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-surface-800 border border-white/10 text-xs text-surface-300 hover:bg-surface-700 transition-colors">
                  <Image className="w-3.5 h-3.5" />
                  {imageFilename ? '更换图片' : '导入图片'}
                </button>
                {imageFilename && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-surface-500 truncate flex-1">{imageFilename}</span>
                    <button onClick={() => setImageFilename('')} className="text-[10px] text-red-400 hover:text-red-300 shrink-0">清除</button>
                  </div>
                )}
                {imageFilename && aspectRatio && (
                  <span className="text-[9px] text-surface-600">比例 {aspectRatio.toFixed(2)}:1</span>
                )}
              </div>
            </div>
            <div>
              <p className="text-[11px] text-surface-400 mb-1.5">位置与尺寸</p>
              <div className="flex items-center gap-1 mb-1.5">
                <span className="text-[10px] text-surface-500 w-8 shrink-0">X</span>
                <input type="number" value={worldX} onChange={e => setWorldX(+e.target.value || 0)}
                  className="flex-1 px-2 py-1.5 rounded-lg bg-surface-800 border border-white/10 text-xs text-surface-200 outline-none focus:border-purple-500/40 transition-colors" step={1} />
              </div>
              <div className="flex items-center gap-1 mb-1.5">
                <span className="text-[10px] text-surface-500 w-8 shrink-0">Y</span>
                <input type="number" value={worldY} onChange={e => setWorldY(+e.target.value || 0)}
                  className="flex-1 px-2 py-1.5 rounded-lg bg-surface-800 border border-white/10 text-xs text-surface-200 outline-none focus:border-purple-500/40 transition-colors" step={1} />
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-surface-500 w-8 shrink-0">大小</span>
                <input type="number" value={mapSize} onChange={e => setMapSize(Math.max(50, +e.target.value || 50))}
                  className="flex-1 px-2 py-1.5 rounded-lg bg-surface-800 border border-white/10 text-xs text-surface-200 outline-none focus:border-purple-500/40 transition-colors" step={10} />
              </div>
            </div>

            {/* ── 参考图选择 ── */}
            {existingLayers.length > (isEdit ? 1 : 0) && (
              <div>
                <p className="text-[11px] text-surface-400 mb-1.5">
                  参考图 <span className="text-[9px] text-surface-600">(Space)</span>
                </p>
                <div className="space-y-0.5 max-h-24 overflow-y-auto">
                  <button
                    onClick={() => setReferenceIndex(-1)}
                    className={`w-full text-left px-2 py-1 rounded text-[10px] transition-colors ${
                      referenceIndex < 0
                        ? 'bg-purple-500/20 text-purple-400'
                        : 'text-surface-500 hover:bg-white/5 hover:text-surface-300'
                    }`}
                  >无参考</button>
                  {existingLayers.map((layer, i) => {
                    if (isEdit && i === editData?.editIndex) return null
                    return (
                      <button
                        key={layer.id || i}
                        onClick={() => setReferenceIndex(i === referenceIndex ? -1 : i)}
                        className={`w-full text-left px-2 py-1 rounded text-[10px] transition-colors truncate ${
                          i === referenceIndex
                            ? 'bg-amber-500/20 text-amber-400'
                            : 'text-surface-500 hover:bg-white/5 hover:text-surface-300'
                        }`}
                      >
                        <span className="font-mono text-[9px] opacity-60 mr-1">{layer.level}</span>
                        {layer.name || layer.level}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            <div className="text-[9px] text-surface-600 bg-surface-800/30 rounded-lg p-2">
              <span className="font-medium text-surface-500">快捷键：</span><br />
              方向键微调 · Shift+方向×10<br />
              +/- 调大小 · Tab 切换叠放预览
            </div>
          </div>

          {/* ═══ 右侧预览 ═══ */}
          <div
            ref={previewRef}
            className="flex-1 relative rounded-lg bg-surface-800/50 border border-white/5 overflow-hidden cursor-grab active:cursor-grabbing min-h-[450px]"
            onMouseDown={handlePreviewMouseDown}
          >
            {/* 世界坐标容器：尺寸 = G 层的世界尺寸，缩放至预览容器内 */}
            {(() => {
              const { worldW, worldH, fitScale, ax, ay, sc } = worldMetrics
              return (
                <div
                  className="absolute pointer-events-none"
                  style={{
                    left: '50%', top: '50%',
                    width: worldW,
                    height: worldH,
                    transform: `translate(-50%, -50%) translate(${panX}px, ${panY}px) scale(${previewZoom * fitScale})`,
                    transformOrigin: 'center center',
                  }}
                >
                  {/* ── G 层背景（世界坐标位置） ── */}
                  <div style={{
                    position: 'absolute',
                    left: -ax * sc,
                    top: -ay * sc,
                    width: worldW,
                    height: worldH,
                    zIndex: previewFlip ? 20 : 1,
                  }}>
                    {bgImageSrc ? (
                      <img src={bgImageSrc} className={`w-full h-full object-fill pointer-events-none ${referenceIndex >= 0 ? 'opacity-0' : 'opacity-40'}`}
                        draggable={false} style={{ imageRendering: 'auto' }} />
                    ) : (
                      referenceIndex < 0 && (
                        <div className="w-full h-full flex items-center justify-center text-surface-600 text-[10px] pointer-events-none">
                          （无 G 层背景图）
                        </div>
                      )
                    )}
                  </div>

                  {/* 网格叠加 */}
                  <div className="absolute inset-0 opacity-10 pointer-events-none"
                    style={{
                      backgroundImage: 'linear-gradient(rgba(255,255,255,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.3) 1px, transparent 1px)',
                      backgroundSize: `${worldW / 20}px ${worldH / 20}px`,
                    }} />

                  {/* 中心十字 */}
                  <div className="absolute top-0 left-0 w-0 h-0 pointer-events-none"
                    style={{ transform: `translate(${worldW / 2}px, ${worldH / 2}px)` }}>
                    <div className="absolute top-[-20px] left-[-0.5px] w-px h-10 bg-red-500/50" />
                    <div className="absolute left-[-20px] top-[-0.5px] h-px w-10 bg-red-500/50" />
                    <span className="absolute top-[-32px] left-[-20px] text-[9px] text-red-500/50 whitespace-nowrap">G 层原点</span>
                  </div>

                  {/* ── 分层地图（世界坐标） ── */}
                  {imageFilename && (
                    <div
                      className="absolute cursor-grab active:cursor-grabbing pointer-events-auto"
                      style={{
                        left: worldX - width / 2,
                        top: worldY - height / 2,
                        width: width,
                        height: height,
                        zIndex: previewFlip ? 1 : 20,
                      }}
                      onMouseDown={handleLayerMouseDown}
                    >
                      <img
                        src={`local-media://${imageFilename}`}
                        className="w-full h-full object-contain rounded-lg shadow-lg border-2 border-purple-500/50 pointer-events-none select-none"
                        draggable={false}
                        style={{ imageRendering: 'auto' }}
                      />
                      <div className="absolute -top-2 -left-2 w-4 h-4 bg-purple-500 rounded-full border-2 border-white shadow pointer-events-auto cursor-nwse-resize" />
                      <div className="absolute -top-2 -right-2 w-4 h-4 bg-purple-500 rounded-full border-2 border-white shadow pointer-events-auto cursor-nesw-resize" />
                      <div className="absolute -bottom-2 -left-2 w-4 h-4 bg-purple-500 rounded-full border-2 border-white shadow pointer-events-auto cursor-nesw-resize" />
                      <div className="absolute -bottom-2 -right-2 w-4 h-4 bg-purple-500 rounded-full border-2 border-white shadow pointer-events-auto cursor-nwse-resize" />
                    </div>
                  )}

                  {!imageFilename && (
                    <div className="absolute inset-0 flex items-center justify-center text-surface-600 text-xs pointer-events-auto">
                      请先导入图片
                    </div>
                  )}

                  {/* ── 参考图叠加（空格切换） ── */}
                  {refLayerData && refImageSrc && (
                    <div className="absolute pointer-events-none" style={{
                      left: refLayerData.worldX - (refLayerData.width || 500) / 2,
                      top: refLayerData.worldY - (refLayerData.height || 500) / 2,
                      width: refLayerData.width || 500,
                      height: refLayerData.height || 500,
                      zIndex: 5,
                      border: '2px dashed rgba(251,191,36,0.5)',
                      borderRadius: '4px',
                    }}>
                      <img src={refImageSrc} className="w-full h-full object-contain opacity-35 pointer-events-none"
                        draggable={false} style={{ imageRendering: 'auto' }} />
                      <div className="absolute top-1 left-1 bg-amber-500/60 text-[9px] text-white px-1.5 py-0.5 rounded">
                        参考: {refLayerData.name || refLayerData.level}
                      </div>
                    </div>
                  )}
                </div>
              )
            })()}

            {/* ── 预览底部控制栏 ── */}
            <div className="absolute bottom-2 left-2 right-2 flex items-center gap-2 pointer-events-none z-30">
              <div className="bg-surface-900/80 rounded-lg px-2 py-1 text-[10px] text-surface-400 flex items-center gap-2 pointer-events-auto">
                <span className={previewFlip ? 'text-amber-400 font-medium' : 'text-surface-500'}>G层</span>
                <span className="text-surface-600">/</span>
                <span className={!previewFlip ? 'text-purple-400 font-medium' : 'text-surface-500'}>分层</span>
                <span className="text-surface-600 ml-1">(Tab)</span>
              </div>
              {refLayerData && (
                <div className="bg-surface-900/80 rounded-lg px-2 py-1 text-[10px] text-surface-400 pointer-events-auto">
                  参考: {refLayerData.name || refLayerData.level} <span className="text-surface-600">(Space)</span>
                </div>
              )}
              {referenceIndex < 0 && existingLayers.length > 0 && (
                <div className="bg-surface-900/80 rounded-lg px-2 py-1 text-[10px] text-surface-500 pointer-events-auto">
                  Space 参考
                </div>
              )}
              <div className="flex-1" />
              <div className="flex items-center gap-1 bg-surface-900/80 rounded-lg px-2 py-1 pointer-events-auto">
                <button onClick={() => zoomAtCenter(-0.1)}
                  className="text-[10px] text-surface-400 hover:text-white px-1">−</button>
                <span className="text-[10px] text-surface-400 tabular-nums w-8 text-center">{Math.round(previewZoom * 100)}%</span>
                <button onClick={() => zoomAtCenter(0.1)}
                  className="text-[10px] text-surface-400 hover:text-white px-1">+</button>
              </div>
              <button onClick={() => { setPanX(0); setPanY(0); setPreviewZoom(1.0) }}
                className="bg-surface-900/80 rounded-lg px-2 py-1 text-[10px] text-surface-400 hover:text-white pointer-events-auto">
                重置
              </button>
            </div>
          </div>
        </div>

        {/* ── 底部按钮 ── */}
        <div className="flex gap-2 mt-4 pt-3 border-t border-white/5 shrink-0">
          <button onClick={onCancel} className="flex-1 px-4 py-2 rounded-xl border border-white/10 text-sm text-surface-300 hover:bg-white/5 transition-colors">取消</button>
          <button onClick={handleConfirm} disabled={!name.trim() || !level || !imageFilename}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
              name.trim() && level && imageFilename
                ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30 hover:bg-purple-500/30'
                : 'bg-surface-800 text-surface-600 border border-white/5 cursor-not-allowed'
            }`}>
            <Check className="w-4 h-4" /> {isEdit ? '保存' : '添加'}
          </button>
        </div>
      </div>
    </div>
  )
}

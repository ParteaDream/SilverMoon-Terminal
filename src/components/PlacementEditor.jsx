import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Check, X, Image as ImageIcon, Layers, Search } from 'lucide-react'

// ═══════════════════════════════════════
// 关联词条下拉多选（圣遗物/材料共用）
// 通过 portal 渲染到 document.body，z-index 用 10000+（高于终端窗口层，
// 终端窗口 z-index 随 bringToFront 递增、上限 998），面板锚定在触发按钮附近。
// ═══════════════════════════════════════
function EntryPickerDropdown({ label, hint, catalog, selectedIds, onToggle, getImage, placeholder, searchPlaceholder, open, onOpenChange, search, onSearchChange }) {
  const btnRef = useRef(null)
  const [panelPos, setPanelPos] = useState(null)

  const handleToggle = () => {
    if (open) { onOpenChange(false); return }
    // 打开时按按钮当前位置计算面板锚点（视口坐标，面板 fixed 定位）
    const r = btnRef.current?.getBoundingClientRect()
    if (r) {
      const PANEL_W = 336
      const PANEL_H = Math.min(window.innerHeight - 24, 420)
      let left = r.left
      let top = r.bottom + 4
      if (left + PANEL_W > window.innerWidth - 8) left = Math.max(8, window.innerWidth - PANEL_W - 8)
      if (top + PANEL_H > window.innerHeight - 8) top = Math.max(8, r.top - PANEL_H - 4)
      setPanelPos({ left, top })
    }
    onOpenChange(true)
  }

  // 面板内容（portal 到 body，保证不受放置界面 overflow 裁剪、且位于所有窗口层之上）
  const panel = open && panelPos && createPortal(
    <>
      {/* 点击外部关闭 */}
      <div className="fixed inset-0 z-[10000]" onMouseDown={(e) => { e.stopPropagation(); onOpenChange(false) }} />
      <div className="fixed z-[10001] w-[336px] max-h-[70vh] flex flex-col rounded-xl bg-surface-800 border border-white/10 shadow-2xl overflow-hidden animate-scale-in"
        style={{ left: panelPos.left, top: panelPos.top }}
        onMouseDown={(e) => e.stopPropagation()}>
        {/* 搜索框 */}
        <div className="flex items-center gap-1.5 px-2.5 py-2 border-b border-white/10 shrink-0">
          <Search className="w-3.5 h-3.5 text-surface-500 shrink-0" />
          <input autoFocus value={search || ''} onChange={e => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full bg-transparent text-xs text-surface-200 placeholder-surface-600 outline-none" />
          <button onClick={() => onOpenChange(false)} className="text-surface-500 hover:text-white shrink-0"><X className="w-3.5 h-3.5" /></button>
        </div>
        {/* 图标网格视图 */}
        <div className="flex-1 overflow-y-auto p-2.5">
          <div className="grid grid-cols-4 gap-1.5">
            {catalog.filter(it => {
              const q = (search || '').trim().toLowerCase()
              return !q || (it.name_zh || '').toLowerCase().includes(q)
            }).map(it => {
              const selected = selectedIds.includes(it.id)
              const img = getImage(it)
              return (
                <button key={it.id} type="button"
                  onClick={() => onToggle(it.id)}
                  title={it.name_zh}
                  className={`flex flex-col items-center gap-1 p-1.5 rounded-lg border-2 transition-colors ${
                    selected ? 'border-amber-500/70 bg-amber-500/10' : 'border-white/5 hover:border-white/20 hover:bg-white/5'
                  }`}>
                  <span className="relative w-full aspect-square rounded-md overflow-hidden bg-surface-900/60 flex items-center justify-center">
                    {img ? (
                      <img src={`local-media://${(img || '').trim()}`} className="w-full h-full object-cover" draggable={false} />
                    ) : (
                      <ImageIcon className="w-4 h-4 text-surface-600" />
                    )}
                    {selected && (
                      <span className="absolute top-0.5 right-0.5 w-3.5 h-3.5 rounded-full bg-amber-500 text-black flex items-center justify-center text-[8px] font-bold">✓</span>
                    )}
                  </span>
                  <span className="w-full text-center text-[9px] text-surface-300 leading-tight truncate">{it.name_zh}</span>
                </button>
              )
            })}
          </div>
          {catalog.filter(it => {
            const q = (search || '').trim().toLowerCase()
            return !q || (it.name_zh || '').toLowerCase().includes(q)
          }).length === 0 && (
            <div className="py-6 text-center text-[10px] text-surface-500">无匹配项</div>
          )}
        </div>
        {/* 已选统计 */}
        <div className="px-2.5 py-1.5 border-t border-white/10 text-[9px] text-surface-500 shrink-0">
          {selectedIds.length > 0 ? `已选 ${selectedIds.length} 项` : '未选择'}
        </div>
      </div>
    </>,
    document.body
  )

  return (
    <div className="p-2.5 rounded-lg bg-surface-800/40 border border-white/5">
      <label className="text-[10px] font-medium text-surface-400 block mb-1">{label}{hint ? <span className="text-surface-600">（{hint}）</span> : null}</label>
      <button ref={btnRef} type="button" onClick={handleToggle}
        className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg bg-surface-800/50 border border-white/10 text-xs text-surface-300 hover:bg-surface-700 transition-colors">
        <span>{selectedIds.length > 0 ? `已选 ${selectedIds.length} 项` : placeholder}</span>
        <span className={`text-surface-500 transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>
      {panel}
    </div>
  )
}

// ═══════════════════════════════════════
// 放置标点编辑面板
// ═══════════════════════════════════════
export default function PlacementEditor({ template, worldX, worldY, existingPlacement, existingMaps, existingLayers = [], presetLayerId = null, onConfirm, onCancel }) {
  const [customName, setName] = useState(existingPlacement?.custom_name || '')
  // 解析现有 special_function
  const existingSf = existingPlacement ? (() => {
    const raw = existingPlacement.special_function || existingPlacement.template_special
    if (!raw) return null
    try { return typeof raw === 'string' ? JSON.parse(raw) : raw } catch { return null }
  })() : null

  const [funcType, setFuncType] = useState(existingSf?.type || 'none')
  const [targetMapId, setTargetMapId] = useState(existingSf?.map_id || '')
  const [description, setDescription] = useState(existingSf?.description || existingSf?.tooltip?.body || '')
  // ── switch_map 单图（旧字段 sf.image） ──
  const [mapImage, setMapImage] = useState(existingSf?.image || '')
  // ── tooltip 图片：支持多张（images 数组），兼容旧数据单张（image） ──
  const [tooltipImages, setTooltipImages] = useState(() => {
    const imgs = existingSf?.tooltip?.images
    if (Array.isArray(imgs) && imgs.length > 0) return imgs.filter(Boolean)
    const legacy = existingSf?.tooltip?.image || existingSf?.image || ''
    return legacy ? [legacy] : []
  })
  // ── tooltip 增强字段：怪物信息（多条）/ 关联圣遗物 / 关联材料 ──
  // 兼容旧数据：tooltip.monster（单条）→ 转成数组；
  // 怪物图片支持多张（images 数组），兼容旧数据单张（image）→ 转成数组
  const initMonsters = useMemo(() => {
    const raw = existingSf?.tooltip?.monsters || (existingSf?.tooltip?.monster ? [existingSf.tooltip.monster] : [])
    return (Array.isArray(raw) ? raw : []).map(m => ({
      name: m?.name || '',
      images: Array.isArray(m?.images) && m.images.length > 0
        ? m.images.filter(Boolean)
        : (m?.image ? [m.image] : []),
      description: m?.description || '',
    }))
  }, [existingSf])
  const [monsters, setMonsters] = useState(initMonsters)
  const [linkedArtifacts, setLinkedArtifacts] = useState(existingSf?.tooltip?.artifacts || [])   // [id]
  const [linkedMaterials, setLinkedMaterials] = useState(existingSf?.tooltip?.materials || [])   // [id]
  const [artifactCatalog, setArtifactCatalog] = useState([])   // 圣遗物可选列表（含图片与名称）
  const [materialCatalog, setMaterialCatalog] = useState([])   // 材料可选列表
  const [artifactOpen, setArtifactOpen] = useState(false)      // 圣遗物下拉开关
  const [materialOpen, setMaterialOpen] = useState(false)      // 材料下拉开关
  const [artifactSearch, setArtifactSearch] = useState('')
  const [materialSearch, setMaterialSearch] = useState('')
  const [subscript, setSubscript] = useState(existingPlacement?.subscript === '1' || existingPlacement?.subscript === 1 || !!presetLayerId)
  const [layerId, setLayerId] = useState(existingPlacement?.layer_id || presetLayerId || '')
  const [layerSearch, setLayerSearch] = useState('')
  const [layerTab, setLayerTab] = useState('important') // important | B | F

  // 按 Tab 分类分层地图
  const tabLayers = useMemo(() => {
    const important = existingLayers.filter(l => l.important)
    const bLayers = existingLayers.filter(l => l.level.startsWith('B') && !l.important)
    const fLayers = existingLayers.filter(l => l.level.startsWith('F') && !l.important)
    return { important, B: bLayers, F: fLayers }
  }, [existingLayers])

  // 按搜索词过滤当前 Tab
  const currentTabLayers = useMemo(() => {
    const layers = tabLayers[layerTab] || []
    if (!layerSearch.trim()) return layers
    const q = layerSearch.toLowerCase()
    return layers.filter(l =>
      l.name?.toLowerCase().includes(q) ||
      l.level?.toLowerCase().includes(q) ||
      l.id?.toLowerCase().includes(q)
    )
  }, [tabLayers, layerTab, layerSearch])

  // ── 导入图片（tooltip 多图：追加到列表） ──
  const handleImportImage = useCallback(async () => {
    const res = await window.electronAPI?.importImage()
    if (res?.success) setTooltipImages(prev => [...prev, res.filename])
  }, [])

  // ── 导入地图跳转配图（switch_map 单图） ──
  const handleImportMapImage = useCallback(async () => {
    const res = await window.electronAPI?.importImage()
    if (res?.success) setMapImage(res.filename)
  }, [])

  // ── 怪物图片：每个怪物支持多张（images 数组），可点选或拖拽导入，均为追加 ──
  const addMonsterImages = useCallback((index, filenames) => {
    if (!filenames || filenames.length === 0) return
    setMonsters(prev => prev.map((m, i) => i === index ? { ...m, images: [...m.images, ...filenames] } : m))
  }, [])

  // 文件对话框：追加一张
  const handleAddMonsterImage = useCallback(async (index) => {
    const res = await window.electronAPI?.importImage()
    if (res?.success) addMonsterImages(index, [res.filename])
  }, [addMonsterImages])

  // 拖拽导入：多张追加
  const handleDropMonsterImages = useCallback(async (index, files) => {
    if (!files?.length) return
    const filenames = []
    for (const file of files) {
      const result = await window.electronAPI?.importImageFile(file.path)
      if (result?.success) filenames.push(result.filename)
    }
    addMonsterImages(index, filenames)
  }, [addMonsterImages])

  // 删除某张图片
  const handleRemoveMonsterImage = useCallback((index, imgIdx) => {
    setMonsters(prev => prev.map((m, i) => i === index ? { ...m, images: m.images.filter((_, ii) => ii !== imgIdx) } : m))
  }, [])

  // ── 选择 tooltip 功能时加载圣遗物/材料目录 ──
  useEffect(() => {
    if (funcType !== 'tooltip') return
    let alive = true
    if (window.electronAPI?.dbQuery) {
      window.electronAPI.dbQuery("SELECT id, name_zh, flower_image, image, circlet_image FROM artifacts ORDER BY id").then(r => {
        if (alive && r?.data) setArtifactCatalog(r.data)
      }).catch(() => {})
      window.electronAPI.dbQuery("SELECT id, name_zh, image FROM materials ORDER BY id").then(r => {
        if (alive && r?.data) setMaterialCatalog(r.data)
      }).catch(() => {})
    }
    return () => { alive = false }
  }, [funcType])

  const handleConfirm = () => {
    let sf = null
    if (funcType === 'switch_map' && targetMapId) {
      sf = { type: 'switch_map', map_id: targetMapId, description: description || undefined, image: mapImage || undefined }
    } else if (funcType === 'tooltip') {
      // 怪物多条：过滤掉全空的条目；图片多张（images 数组）+ 兼容旧字段 image（首图）
      const cleanedMonsters = monsters
        .filter(m => m.name.trim() || m.images.length > 0 || m.description.trim())
        .map(m => ({
          name: m.name.trim(),
          images: m.images.length > 0 ? m.images : undefined,
          image: m.images[0] || undefined,
          description: m.description.trim() || undefined,
        }))
      sf = {
        type: 'tooltip',
        tooltip: {
          title: customName || template.name_zh,
          body: description,
          // 多图：images 数组 + 兼容字段 image（首图）
          images: tooltipImages.length > 0 ? tooltipImages : undefined,
          image: tooltipImages[0] || undefined,
          // 增强字段：怪物信息（多条）/ 关联圣遗物 / 关联材料
          monsters: cleanedMonsters.length > 0 ? cleanedMonsters : undefined,
          artifacts: linkedArtifacts.length > 0 ? linkedArtifacts : undefined,
          materials: linkedMaterials.length > 0 ? linkedMaterials : undefined,
        },
      }
    }
    onConfirm({
      placementId: existingPlacement?.id || null,
      markerId: template.id,
      worldX, worldY,
      customName: customName || '',
      specialFunction: sf,
      subscript: subscript ? '1' : '0',
      layerId: subscript ? layerId : '',  // 只有勾选下标时才能设置 layer_id
    })
  }

  const hasImportant = tabLayers.important.length > 0

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onCancel}>
      <div className="w-[720px] max-w-[94vw] rounded-xl bg-surface-900 border border-white/10 shadow-2xl p-5 max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <ImageIcon className="w-4 h-4 text-amber-400" /> 放置「{template.name_zh || '未命名'}」
          </h3>
          <button onClick={onCancel} className="p-1 rounded-lg hover:bg-white/10 text-surface-400 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 自定义名称 */}
        <div className="mb-3">
          <label className="text-[11px] text-surface-400 block mb-1">自定义名称（留空延用统称）</label>
          <input value={customName} onChange={e => setName(e.target.value)} placeholder={template.name_zh || '未命名'}
            className="w-full px-3 py-2 rounded-lg bg-surface-800 border border-white/10 text-sm text-surface-200 placeholder-surface-600 outline-none focus:border-amber-500/40 transition-colors" />
        </div>

        {/* 下标 */}
        <div className="mb-3">
          <label className="text-[11px] text-surface-400 flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={subscript} onChange={e => setSubscript(e.target.checked)}
              className="accent-amber-500" />
            <Layers className="w-3.5 h-3.5 text-surface-400" />
            显示下标（右下角黑色圆形分层标记）
          </label>

          {/* 分层地图选择（仅当勾选下标且有分层地图时显示） */}
          {subscript && existingLayers.length > 0 && (
            <div className="mt-2">
              <label className="text-[10px] text-surface-500 block mb-1">所属分层地图</label>
              {/* Tab 切换 */}
              <div className="flex gap-1 mb-1.5">
                {hasImportant && (
                  <button onClick={() => setLayerTab('important')}
                    className={`flex-1 px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                      layerTab === 'important' ? 'bg-amber-500/20 text-amber-400' : 'bg-surface-800/50 text-surface-500 hover:text-surface-300'
                    }`}>★ 重要</button>
                )}
                <button onClick={() => setLayerTab('B')}
                  className={`flex-1 px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                    layerTab === 'B' ? 'bg-purple-500/20 text-purple-400' : 'bg-surface-800/50 text-surface-500 hover:text-surface-300'
                  }`}>B 层</button>
                <button onClick={() => setLayerTab('F')}
                  className={`flex-1 px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                    layerTab === 'F' ? 'bg-purple-500/20 text-purple-400' : 'bg-surface-800/50 text-surface-500 hover:text-surface-300'
                  }`}>F 层</button>
              </div>
              <div className="relative">
                <input value={layerSearch} onChange={e => setLayerSearch(e.target.value)}
                  placeholder="搜索层名或代号…"
                  className="w-full px-2 py-1.5 rounded-lg bg-surface-800/50 border border-white/10 text-xs text-surface-200 placeholder-surface-600 outline-none focus:border-amber-500/40 transition-colors mb-1" />
                <div className="max-h-32 overflow-y-auto space-y-0.5">
                  <button
                    onClick={() => { setLayerId(''); setLayerSearch('') }}
                    className={`w-full text-left px-2 py-1 rounded text-[10px] transition-colors ${
                      !layerId
                        ? 'bg-amber-500/20 text-amber-400'
                        : 'text-surface-500 hover:bg-white/5 hover:text-surface-300'
                    }`}
                  >（仅下标，不关联分层地图）</button>
                  {currentTabLayers.length > 0 ? currentTabLayers.map(l => (
                    <button
                      key={l.id}
                      onClick={() => { setLayerId(l.id); setLayerSearch('') }}
                      className={`w-full text-left px-2 py-1 rounded text-[10px] transition-colors truncate ${
                        layerId === l.id
                          ? 'bg-amber-500/20 text-amber-400'
                          : 'text-surface-500 hover:bg-white/5 hover:text-surface-300'
                      }`}
                    >{l.level} - {l.name || '未命名'}</button>
                  )) : (
                    <div className="text-[10px] text-surface-600 text-center py-2">无匹配分层地图</div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 特殊功能 */}
        <div className="mb-4">
          <label className="text-[11px] text-surface-400 block mb-1.5">特殊功能</label>
          <select value={funcType} onChange={e => setFuncType(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-surface-800 border border-white/10 text-sm text-surface-200 outline-none focus:border-amber-500/40 transition-colors">
            <option value="none">无</option>
            <option value="switch_map">点击切换地图</option>
            <option value="tooltip">光标悬停详情</option>
          </select>

          {funcType === 'switch_map' && (
            <div className="mt-2 space-y-2">
              <div>
                <label className="text-[10px] text-surface-500 block mb-1">目标地图</label>
                <select value={targetMapId} onChange={e => setTargetMapId(e.target.value)}
                  className="w-full px-2 py-1.5 rounded-lg bg-surface-800/50 border border-white/10 text-xs text-surface-200 outline-none">
                  <option value="">选择地图…</option>
                  {existingMaps.filter(m => m.id !== template.map_id).map(m => (
                    <option key={m.id} value={m.id}>{m.name_zh}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-surface-500 block mb-1">图片</label>
                <div
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation() }}
                  onDrop={async (e) => {
                    e.preventDefault(); e.stopPropagation()
                    const file = e.dataTransfer.files?.[0]
                    if (!file) return
                    const result = await window.electronAPI?.importImageFile(file.path)
                    if (result?.success) setMapImage(result.filename)
                  }}
                  className="flex items-center gap-2 flex-wrap"
                >
                  <button onClick={handleImportMapImage}
                    className="flex items-center gap-1.5 px-2 py-1 rounded bg-surface-800 border border-white/10 text-[10px] text-surface-300 hover:bg-surface-700">
                    <ImageIcon className="w-3 h-3" />{mapImage ? mapImage : '添加图片（可拖拽）'}
                  </button>
                  {mapImage && (
                    <button onClick={() => setMapImage('')} className="text-[10px] text-red-400 hover:text-red-300">清除</button>
                  )}
                </div>
              </div>
              <div>
                <label className="text-[10px] text-surface-500 block mb-1">简介</label>
                <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} placeholder="地图简介"
                  className="w-full px-2 py-1.5 rounded-lg bg-surface-800/50 border border-white/10 text-xs text-surface-200 placeholder-surface-600 outline-none resize-none" />
              </div>
            </div>
          )}

          {funcType === 'tooltip' && (
            <div className="mt-2 space-y-2.5">
              <div>
                <label className="text-[10px] text-surface-500 block mb-1">图片（可添加多张）</label>
                {/* 多图列表：缩略图 + 删除 */}
                {tooltipImages.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-1.5">
                    {tooltipImages.map((img, idx) => (
                      <span key={idx} className="relative group">
                        <img src={`local-media://${(img || '').trim()}`} className="w-12 h-12 rounded-lg object-cover border border-white/10" />
                        <button type="button" onClick={() => setTooltipImages(prev => prev.filter((_, i) => i !== idx))}
                          className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-500/90 text-white text-[9px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                          title="删除该图片">✕</button>
                      </span>
                    ))}
                  </div>
                )}
                <div
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation() }}
                  onDrop={async (e) => {
                    e.preventDefault(); e.stopPropagation()
                    const files = e.dataTransfer.files
                    if (!files?.length) return
                    for (const file of files) {
                      const result = await window.electronAPI?.importImageFile(file.path)
                      if (result?.success) setTooltipImages(prev => [...prev, result.filename])
                    }
                  }}
                  className="flex items-center gap-2 flex-wrap"
                >
                  <button onClick={handleImportImage}
                    className="flex items-center gap-1.5 px-2 py-1 rounded bg-surface-800 border border-white/10 text-[10px] text-surface-300 hover:bg-surface-700">
                    <ImageIcon className="w-3 h-3" />{tooltipImages.length > 0 ? '继续添加图片' : '添加图片（可拖拽多张）'}
                  </button>
                  {tooltipImages.length > 0 && (
                    <button onClick={() => setTooltipImages([])} className="text-[10px] text-red-400 hover:text-red-300">全部清除</button>
                  )}
                </div>
              </div>
              <div>
                <label className="text-[10px] text-surface-500 block mb-1">详情正文</label>
                <textarea value={description} onChange={e => setDescription(e.target.value)} rows={6} placeholder="详情信息"
                  className="w-full px-2 py-1.5 rounded-lg bg-surface-800/50 border border-white/10 text-xs text-surface-200 placeholder-surface-600 outline-none resize-y min-h-[120px]" />
              </div>

              {/* ── 怪物信息（可多条，可增删） ── */}
              <div className="p-2.5 rounded-lg bg-surface-800/40 border border-white/5 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-medium text-surface-400">怪物信息（可添加多条）</label>
                  <button onClick={() => setMonsters(prev => [...prev, { name: '', images: [], description: '' }])}
                    className="flex items-center gap-1 px-2 py-1 rounded bg-surface-800 border border-white/10 text-[10px] text-emerald-400 hover:bg-surface-700 transition-colors">
                    + 添加怪物
                  </button>
                </div>
                {monsters.length === 0 && (
                  <p className="text-[10px] text-surface-600">未添加怪物，点击「+ 添加怪物」</p>
                )}
                {monsters.map((m, idx) => (
                  <div key={idx} className="p-2 rounded-lg bg-surface-800/50 border border-white/5 space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <input value={m.name} onChange={e => setMonsters(prev => prev.map((x, i) => i === idx ? { ...x, name: e.target.value } : x))}
                        placeholder={`怪物 ${idx + 1} 名称（如 遗迹守卫）`}
                        className="flex-1 px-2 py-1.5 rounded-lg bg-surface-800/50 border border-white/10 text-xs text-surface-200 placeholder-surface-600 outline-none" />
                      <button onClick={() => setMonsters(prev => prev.filter((_, i) => i !== idx))}
                        className="px-1.5 py-1.5 rounded bg-surface-800 border border-white/10 text-[10px] text-red-400 hover:bg-red-500/10 transition-colors" title="删除该怪物">✕</button>
                    </div>
                    {/* 怪物图片（多张）：缩略图网格 + 拖拽导入区 */}
                    <div
                      onDragOver={(e) => { e.preventDefault(); e.stopPropagation() }}
                      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); handleDropMonsterImages(idx, e.dataTransfer.files) }}
                      className="space-y-1.5"
                    >
                      {m.images?.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {m.images.map((img, ii) => (
                            <span key={ii} className="relative group">
                              <img src={`local-media://${(img || '').trim()}`} className="w-12 h-12 rounded-lg object-cover border border-white/10" />
                              <button type="button" onClick={() => handleRemoveMonsterImage(idx, ii)}
                                className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-500/90 text-white text-[9px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                title="删除该图片">✕</button>
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="flex items-center gap-2 flex-wrap">
                        <button onClick={() => handleAddMonsterImage(idx)}
                          className="flex items-center gap-1 px-2 py-1 rounded bg-surface-800 border border-white/10 text-[10px] text-surface-300 hover:bg-surface-700 transition-colors">
                          <ImageIcon className="w-3 h-3" />{m.images?.length > 0 ? '添加图片' : '添加图片（可拖拽多张）'}
                        </button>
                        <span className="text-[9px] text-surface-600">支持拖拽多张图片到此处</span>
                      </div>
                    </div>
                    <textarea value={m.description} onChange={e => setMonsters(prev => prev.map((x, i) => i === idx ? { ...x, description: e.target.value } : x))}
                      rows={4} placeholder={`怪物 ${idx + 1} 简介`}
                      className="w-full px-2 py-1.5 rounded-lg bg-surface-800/50 border border-white/10 text-xs text-surface-200 placeholder-surface-600 outline-none resize-y min-h-[80px]" />
                  </div>
                ))}
              </div>

              {/* ── 关联圣遗物（下拉框多选：图标视图 + 搜索） ── */}
              <EntryPickerDropdown
                label="关联圣遗物"
                hint="显示套装图片与名称，可多选"
                catalog={artifactCatalog}
                selectedIds={linkedArtifacts}
                onToggle={(id) => setLinkedArtifacts(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])}
                getImage={(a) => a.flower_image || a.image || a.circlet_image}
                placeholder="选择圣遗物…"
                searchPlaceholder="搜索圣遗物套装…"
                open={artifactOpen}
                onOpenChange={(v) => { setArtifactOpen(v); if (v) setMaterialOpen(false) }}
                search={artifactSearch}
                onSearchChange={setArtifactSearch}
              />
              {linkedArtifacts.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {linkedArtifacts.map(id => {
                    const a = artifactCatalog.find(x => x.id === id)
                    if (!a) return null
                    return (
                      <span key={id} className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-surface-800 border border-white/10">
                        {a.flower_image || a.image || a.circlet_image ? (
                          <img src={`local-media://${((a.flower_image || a.image || a.circlet_image) || '').trim()}`} className="w-5 h-5 rounded object-cover" />
                        ) : null}
                        <span className="text-[10px] text-surface-200">{a.name_zh}</span>
                        <button onClick={() => setLinkedArtifacts(prev => prev.filter(x => x !== id))} className="text-[10px] text-red-400 hover:text-red-300">✕</button>
                      </span>
                    )
                  })}
                </div>
              )}

              {/* ── 关联材料（下拉框多选：图标视图 + 搜索） ── */}
              <EntryPickerDropdown
                label="关联材料"
                hint="显示图片与名称，可多选"
                catalog={materialCatalog}
                selectedIds={linkedMaterials}
                onToggle={(id) => setLinkedMaterials(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])}
                getImage={(m) => m.image}
                placeholder="选择材料…"
                searchPlaceholder="搜索材料…"
                open={materialOpen}
                onOpenChange={(v) => { setMaterialOpen(v); if (v) setArtifactOpen(false) }}
                search={materialSearch}
                onSearchChange={setMaterialSearch}
              />
              {linkedMaterials.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {linkedMaterials.map(id => {
                    const m = materialCatalog.find(x => x.id === id)
                    if (!m) return null
                    return (
                      <span key={id} className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-surface-800 border border-white/10">
                        {m.image ? <img src={`local-media://${(m.image || '').trim()}`} className="w-5 h-5 rounded object-cover" /> : null}
                        <span className="text-[10px] text-surface-200">{m.name_zh}</span>
                        <button onClick={() => setLinkedMaterials(prev => prev.filter(x => x !== id))} className="text-[10px] text-red-400 hover:text-red-300">✕</button>
                      </span>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <button onClick={onCancel} className="flex-1 px-4 py-2 rounded-xl border border-white/10 text-sm text-surface-300 hover:bg-white/5">取消</button>
          <button onClick={handleConfirm}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30 text-sm font-medium hover:bg-amber-500/30">
            <Check className="w-4 h-4" /> 放置
          </button>
        </div>
      </div>
    </div>
  )
}

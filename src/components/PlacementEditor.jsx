import { useState, useEffect, useCallback, useMemo } from 'react'
import { Check, X, Image as ImageIcon, Layers } from 'lucide-react'

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
  const [imageFilename, setImageFilename] = useState(existingSf?.image || existingSf?.tooltip?.image || '')
  const [subscript, setSubscript] = useState(existingPlacement?.subscript === '1' || existingPlacement?.subscript === 1 || !!presetLayerId)
  const [layerId, setLayerId] = useState(existingPlacement?.layer_id || presetLayerId || '')
  const [layerSearch, setLayerSearch] = useState('')

  // 按层级分组
  const groupedLayers = useCallback(() => {
    const groups = {}
    for (const l of existingLayers) {
      const prefix = l.level.replace(/\d+$/, '')
      if (!groups[prefix]) groups[prefix] = []
      groups[prefix].push(l)
    }
    return groups
  }, [existingLayers])

  // ── 导入图片 ──
  const handleImportImage = useCallback(async () => {
    const res = await window.electronAPI?.importImage()
    if (res?.success) setImageFilename(res.filename)
  }, [])

  const handleConfirm = () => {
    let sf = null
    if (funcType === 'switch_map' && targetMapId) {
      sf = { type: 'switch_map', map_id: targetMapId, description: description || undefined, image: imageFilename || undefined }
    } else if (funcType === 'tooltip') {
      sf = { type: 'tooltip', tooltip: { title: customName || template.name_zh, body: description, image: imageFilename || undefined } }
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

  const groups = groupedLayers()

  // 按搜索词过滤分层地图
  const filteredGroups = useMemo(() => {
    if (!layerSearch.trim()) return groups
    const q = layerSearch.toLowerCase()
    const result = {}
    for (const [prefix, layers] of Object.entries(groups)) {
      const matched = layers.filter(l =>
        l.name?.toLowerCase().includes(q) ||
        l.level?.toLowerCase().includes(q) ||
        l.id?.toLowerCase().includes(q)
      )
      if (matched.length > 0) result[prefix] = matched
    }
    return result
  }, [groups, layerSearch])

  const hasFiltered = Object.keys(filteredGroups).length > 0

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onCancel}>
      <div className="w-96 rounded-xl bg-surface-900 border border-white/10 shadow-2xl p-5" onClick={e => e.stopPropagation()}>
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
                  {hasFiltered ? Object.entries(filteredGroups).map(([prefix, layers]) => (
                    <div key={prefix}>
                      <div className="text-[9px] text-surface-600 px-1 py-0.5 font-medium">
                        {prefix === 'B' ? '地下' : prefix === 'F' ? '地上' : ''}层 ({prefix})
                      </div>
                      {layers.map(l => (
                        <button
                          key={l.id}
                          onClick={() => { setLayerId(l.id); setLayerSearch('') }}
                          className={`w-full text-left px-2 py-1 rounded text-[10px] transition-colors truncate ${
                            layerId === l.id
                              ? 'bg-amber-500/20 text-amber-400'
                              : 'text-surface-500 hover:bg-white/5 hover:text-surface-300'
                          }`}
                        >{l.level} - {l.name || '未命名'}</button>
                      ))}
                    </div>
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
                    if (result?.success) setImageFilename(result.filename)
                  }}
                  className="flex items-center gap-2 flex-wrap"
                >
                  <button onClick={handleImportImage}
                    className="flex items-center gap-1.5 px-2 py-1 rounded bg-surface-800 border border-white/10 text-[10px] text-surface-300 hover:bg-surface-700">
                    <ImageIcon className="w-3 h-3" />{imageFilename ? imageFilename : '添加图片（可拖拽）'}
                  </button>
                  {imageFilename && (
                    <button onClick={() => setImageFilename('')} className="text-[10px] text-red-400 hover:text-red-300">清除</button>
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
            <div className="mt-2 space-y-2">
              <div>
                <label className="text-[10px] text-surface-500 block mb-1">图片</label>
                <div
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation() }}
                  onDrop={async (e) => {
                    e.preventDefault(); e.stopPropagation()
                    const file = e.dataTransfer.files?.[0]
                    if (!file) return
                    const result = await window.electronAPI?.importImageFile(file.path)
                    if (result?.success) setImageFilename(result.filename)
                  }}
                  className="flex items-center gap-2 flex-wrap"
                >
                  <button onClick={handleImportImage}
                    className="flex items-center gap-1.5 px-2 py-1 rounded bg-surface-800 border border-white/10 text-[10px] text-surface-300 hover:bg-surface-700">
                    <ImageIcon className="w-3 h-3" />{imageFilename ? imageFilename : '添加图片（可拖拽）'}
                  </button>
                  {imageFilename && (
                    <button onClick={() => setImageFilename('')} className="text-[10px] text-red-400 hover:text-red-300">清除</button>
                  )}
                </div>
              </div>
              <div>
                <label className="text-[10px] text-surface-500 block mb-1">详情正文</label>
                <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} placeholder="详情信息"
                  className="w-full px-2 py-1.5 rounded-lg bg-surface-800/50 border border-white/10 text-xs text-surface-200 placeholder-surface-600 outline-none resize-none" />
              </div>
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

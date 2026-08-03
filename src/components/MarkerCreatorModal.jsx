import { useState, useCallback, useEffect } from 'react'
import { Pin, X, Check, Image } from 'lucide-react'
import { getColorPresets, loadColorPresets, COLOR_PRESETS_CHANGED } from '../utils/colorMarkup'

// ═══════════════════════════════════════
// 标点创建弹窗（开发者模式）
// ═══════════════════════════════════════
export default function MarkerCreatorModal({ editData, presetCategory, onConfirm, onCancel }) {
  const [markerType, setMarkerType] = useState(editData?.marker_type || presetCategory || 'sign')
  const [nameZh, setNameZh] = useState(editData?.name_zh || '')
  const [imageFilename, setImageFilename] = useState(editData?.image_filename || '')
  const [visibility, setVisibility] = useState(() => {
    if (editData?.visibility) return editData.visibility.split(',').map(Number)
    const defaults = { sign: [3], teleport: [3], statue: [1,2,3], landmark: [3], enemy: [2,3], other: [1,2,3] }
    return defaults[editData?.marker_type] || [3]
  })
  const isEdit = !!editData

  // ── 从 special_function 解析 isLocalLegend ──
  const parseSF = (raw) => {
    if (!raw) return {}
    try { return typeof raw === 'string' ? JSON.parse(raw) : raw }
    catch { return {} }
  }
  const initSF = parseSF(editData?.special_function)
  const [isLocalLegend, setIsLocalLegend] = useState(initSF.isLocalLegend || false)

  // ── 底盘配置 ──
  const parseBase = (raw) => {
    if (!raw) return { baseType: 'none', baseBorderColor: '#3375DD', baseFillColor: '#E4E4E2', baseScale: 1.30, baseBorderWidth: 2 }
    try { return typeof raw === 'string' ? JSON.parse(raw) : raw }
    catch { return { baseType: 'none', baseBorderColor: '#3375DD', baseFillColor: '#E4E4E2', baseScale: 1.30, baseBorderWidth: 2 } }
  }
  const initBase = parseBase(editData?.base_config)
  const [baseType, setBaseType] = useState(initBase.baseType)
  const [baseBorderColor, setBaseBorderColor] = useState(initBase.baseBorderColor)
  const [baseFillColor, setBaseFillColor] = useState(initBase.baseFillColor)
  const [baseScale, setBaseScale] = useState(initBase.baseScale)
  const [baseBorderWidth, setBaseBorderWidth] = useState(initBase.baseBorderWidth ?? 2)

  // ── 颜色预设（通用色板,来自 设置 → 颜色）──
  const [presetColors, setPresetColors] = useState(() => getColorPresets())
  useEffect(() => {
    let alive = true
    if (window.electronAPI?.dbQuery) {
      loadColorPresets(window.electronAPI.dbQuery).then(list => { if (alive) setPresetColors(list) })
    }
    const handler = (e) => setPresetColors(e.detail || getColorPresets())
    window.addEventListener(COLOR_PRESETS_CHANGED, handler)
    return () => { alive = false; window.removeEventListener(COLOR_PRESETS_CHANGED, handler) }
  }, [])

  // ── 导入标点图标 ──
  const handleImportIcon = useCallback(async () => {
    const result = await window.electronAPI?.importImage()
    if (result?.success) setImageFilename(result.filename)
  }, [])

  // ── 切换可见性级别 ──
  const toggleVis = (lv) => {
    setVisibility(prev => prev.includes(lv) ? prev.filter(x => x !== lv) : [...prev, lv].sort())
  }

  // ── 确认创建 ──
  const handleConfirm = () => {
    if (!nameZh.trim()) return
    const extra = { visibility: visibility.join(',') }
    const baseConfig = baseType === 'none' ? null : JSON.stringify({ baseType, baseBorderColor, baseFillColor, baseScale, baseBorderWidth })
    // 构建 special_function（合并现有 + isLocalLegend）
    const existingSF = parseSF(editData?.special_function)
    let sf = null
    if (isLocalLegend || existingSF.type) {
      const merged = { ...existingSF }
      if (isLocalLegend) merged.isLocalLegend = true
      else delete merged.isLocalLegend
      if (Object.keys(merged).length > 0) sf = JSON.stringify(merged)
    }
    onConfirm({ editId: editData?.id || null, markerType, imageFilename, nameZh: nameZh.trim(), category: markerType, baseConfig, specialFunction: sf, ...extra })
  }

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onCancel}>
      <div className="w-96 rounded-xl bg-surface-900 border border-white/10 shadow-2xl p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Pin className="w-4 h-4 text-amber-400" /> {editData ? '编辑标点' : '创建标点'}
          </h3>
          <button onClick={onCancel} className="p-1 rounded-lg hover:bg-white/10 text-surface-400 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 标点类型 */}
        <div className="mb-3">
          <label className="text-[11px] text-surface-400 block mb-1.5">标点类型</label>
          <select value={markerType} onChange={e => setMarkerType(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-surface-800 border border-white/10 text-sm text-surface-200 outline-none focus:border-amber-500/40 transition-colors">
            <option value="sign">记号</option>
            <option value="enemy">敌人</option>
            <option value="teleport">传送点</option>
            <option value="statue">神像</option>
            <option value="landmark">地标</option>
            <option value="other">其他</option>
          </select>
        </div>

        {/* 名称 */}
        <div className="mb-3">
          <label className="text-[11px] text-surface-400 block mb-1">标点名称</label>
          <input value={nameZh} onChange={e => setNameZh(e.target.value)} placeholder="输入标点名称"
            className="w-full px-3 py-2 rounded-lg bg-surface-800 border border-white/10 text-sm text-surface-200 placeholder-surface-600 outline-none focus:border-amber-500/40 transition-colors" />
        </div>

        {/* 图标 — 支持拖拽导入 */}
        <div className="mb-3">
          <label className="text-[11px] text-surface-400 block mb-1">标点图标</label>
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
            <button onClick={handleImportIcon}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-800 border border-white/10 text-xs text-surface-300 hover:bg-surface-700 transition-colors">
              <Image className="w-3.5 h-3.5" />
              {imageFilename ? imageFilename : '导入图片（可拖拽）'}
            </button>
            {imageFilename && (
              <button onClick={() => setImageFilename('')} className="text-[10px] text-red-400 hover:text-red-300">清除</button>
            )}
          </div>
        </div>

        {/* ── 底盘配置 ── */}
        <div className="mb-4">
          <label className="text-[11px] text-surface-400 block mb-1.5">底盘样式</label>
          <div className="flex gap-1.5 mb-2">
            {[
              { key: 'none', label: '无' },
              { key: 'circle', label: '圆盘' },
              { key: 'square', label: '方框' },
              { key: 'diamond', label: '菱形' },
            ].map(({ key, label }) => (
              <button key={key} onClick={() => setBaseType(key)}
                className={`flex-1 px-2 py-1.5 rounded-lg text-[10px] border transition-colors ${
                  baseType === key ? 'bg-amber-500/20 border-amber-500/30 text-amber-400' : 'bg-surface-800 border-white/10 text-surface-400 hover:bg-surface-700'
                }`}>
                {label}
              </button>
            ))}
          </div>

          {baseType !== 'none' && (
            <>
              <div className="flex gap-3 mb-2">
                <div className="flex-1">
                  <label className="text-[10px] text-surface-500 block mb-1">边框颜色</label>
                  <div className="flex gap-1.5 flex-wrap">
                    {presetColors.slice(0, 8).map(p => (
                      <button key={p.label + p.color} onClick={() => setBaseBorderColor(p.color)}
                        className={`w-6 h-6 rounded-full border-2 transition-all ${
                          baseBorderColor === p.color ? 'border-white scale-110' : 'border-transparent'
                        }`}
                        style={{ backgroundColor: p.color }} title={p.label} />
                    ))}
                    <input type="color" value={baseBorderColor} onChange={e => setBaseBorderColor(e.target.value)}
                      className="w-6 h-6 rounded cursor-pointer border-0 p-0 bg-transparent" />
                  </div>
                </div>
                <div className="flex-1">
                  <label className="text-[10px] text-surface-500 block mb-1">填充颜色</label>
                  <div className="flex gap-1.5 flex-wrap">
                    {presetColors.slice(0, 8).map(p => (
                      <button key={p.label + p.color} onClick={() => setBaseFillColor(p.color)}
                        className={`w-6 h-6 rounded-full border-2 transition-all ${
                          baseFillColor === p.color ? 'border-white scale-110' : 'border-transparent'
                        }`}
                        style={{ backgroundColor: p.color }} title={p.label} />
                    ))}
                    <input type="color" value={baseFillColor} onChange={e => setBaseFillColor(e.target.value)}
                      className="w-6 h-6 rounded cursor-pointer border-0 p-0 bg-transparent" />
                  </div>
                </div>
              </div>

              <div className="mb-2">
                <label className="text-[10px] text-surface-500 block mb-1">底盘大小 ({baseScale.toFixed(2)}×)</label>
                <input type="range" min="1.0" max="2.0" step="0.05"
                  value={baseScale} onChange={e => setBaseScale(+e.target.value)}
                  className="w-full h-1.5 accent-amber-500 cursor-pointer" />
              </div>

              <div className="mb-2">
                <label className="text-[10px] text-surface-500 block mb-1">边框粗细 ({baseBorderWidth}px)</label>
                <input type="range" min="1" max="6" step="1"
                  value={baseBorderWidth} onChange={e => setBaseBorderWidth(+e.target.value)}
                  className="w-full h-1.5 accent-amber-500 cursor-pointer" />
              </div>

              {/* 实时预览 */}
              <div className="flex items-center justify-center py-3 rounded-lg bg-surface-800/50 border border-white/5">
                <div className="relative flex items-center justify-center" style={{ width: 64, height: 64 }}>
                  {baseType !== 'none' && (() => {
                    const sz = 32 * baseScale
                    const outerStyle = {
                      width: sz, height: sz,
                      left: (64 - sz) / 2,
                      top: (64 - sz) / 2,
                      backgroundColor: baseFillColor,
                      border: `${baseBorderWidth}px solid black`,
                      boxShadow: `0 0 0 ${baseBorderWidth}px ${baseBorderColor} inset`,
                      borderRadius: baseType === 'circle' ? '50%' : baseType === 'diamond' ? '0' : '6px',
                      transform: baseType === 'diamond' ? 'rotate(45deg)' : 'none',
                      position: 'absolute',
                    }
                    return <div style={outerStyle} />
                  })()}
                  <div className="relative z-10 w-8 h-8 flex items-center justify-center overflow-hidden"
                    style={{ borderRadius: baseType === 'circle' ? '50%' : '4px' }}>
                    {imageFilename ? (
                      <img src={`local-media://${(imageFilename || '').trim()}`} className="w-full h-full object-cover"
                        style={{ borderRadius: baseType === 'circle' ? '50%' : '0' }} />
                    ) : (
                      <div className="w-full h-full rounded bg-amber-500/30 border border-amber-500/50 flex items-center justify-center">
                        <Pin className="w-4 h-4 text-amber-400" />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {isEdit && (
          <div className="mb-4">
            <label className="text-[11px] text-surface-400 block mb-1.5">可见性（在哪些缩放区间显示）</label>
            <div className="flex gap-2">
              {[1, 2, 3].map(lv => (
                <button key={lv} onClick={() => toggleVis(lv)}
                  className={`flex-1 px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                    visibility.includes(lv) ? 'bg-amber-500/20 border-amber-500/30 text-amber-400' : 'bg-surface-800 border-white/10 text-surface-400 hover:bg-surface-700'
                  }`}>
                  级别{lv}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── 地方传奇（仅敌人类型） ── */}
        {markerType === 'enemy' && (
          <div className="mb-3 flex items-center gap-2">
            <input type="checkbox" id="localLegend" checked={isLocalLegend}
              onChange={e => setIsLocalLegend(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-white/10 bg-surface-800 accent-amber-500 cursor-pointer" />
            <label htmlFor="localLegend" className="text-[11px] text-surface-300 cursor-pointer select-none">地方传奇</label>
          </div>
        )}

        <div className="flex gap-2">
          <button onClick={onCancel} className="flex-1 px-4 py-2 rounded-xl border border-white/10 text-sm text-surface-300 hover:bg-white/5 transition-colors">取消</button>
          <button onClick={handleConfirm} disabled={!nameZh.trim()}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
              nameZh.trim() ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30 hover:bg-amber-500/30' : 'bg-surface-800 text-surface-600 border border-white/5 cursor-not-allowed'}`}>
            <Check className="w-4 h-4" /> {isEdit ? '保存' : '创建'}
          </button>
        </div>
      </div>
    </div>
  )
}

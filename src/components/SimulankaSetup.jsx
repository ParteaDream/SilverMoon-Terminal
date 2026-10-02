// ═════════════════════════════════════════════════════════════════
// 希穆兰卡 · 模拟前配置
//   - 卡池安排：是否开放「角色活动祈愿-2」，每个池的 UP 内容
//   - 从「祈愿」板块导入历史卡池
//   - 初始资源（创世结晶 / 原石 / 纠缠之缘 / 相遇之缘）
//   - 从「祈愿捕捉站」导入垫池状态与历史记录
// ═════════════════════════════════════════════════════════════════
import { useState, useMemo, useCallback, useEffect } from 'react'
import {
  Wand2, ChevronRight, Search, X, Check, FolderInput, Gem, Landmark,
  Swords, Users, Sparkles, RefreshCw, AlertCircle, Star,
} from 'lucide-react'
import { useDb } from '../context/DbContext'
import useOverlay from '../hooks/useOverlay'
import useRovingFocus from '../hooks/useRovingFocus'
import {
  POOL_LABEL, POOL_IDS, normalizeResources,
} from '../utils/wishSimulator.js'
import {
  listImportableWishes, loadWishDetail, groupWishesByPeriod, IMPORT_BANNER_TYPES, pityFromGachaArchive,
} from '../utils/wishSimData.js'
import { SimButton, SimItemIcon, rarityStyle, useSimImages } from './SimulankaShared'

const SECTIONS = [
  { id: 'pools', label: '卡池安排', icon: Sparkles },
  { id: 'res', label: '初始资源', icon: Gem },
  { id: 'pity', label: '垫池与历史', icon: RefreshCw },
]

// ═════════════════════════════════════════════════════════════════
// 通用：从候选列表里挑选物品
// ═════════════════════════════════════════════════════════════════
function CandidatePicker({ open, onClose, title, hint, candidates, selected, max, onConfirm, allowEmpty = true }) {
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState([])
  const ov = useOverlay({ open, onClose, label: title, initialFocus: 'auto' })

  useEffect(() => {
    if (open) { setPicked(selected || []); setSearch('') }
  }, [open, selected])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return candidates
    return candidates.filter(c => c.name.toLowerCase().includes(q))
  }, [candidates, search])

  const files = useMemo(() => filtered.slice(0, 240).map(c => c.art).filter(Boolean), [filtered])
  useSimImages(files, 96)

  const toggle = (item) => {
    setPicked(prev => {
      const has = prev.some(p => p.key === item.key)
      if (has) return prev.filter(p => p.key !== item.key)
      if (max && prev.length >= max) return [...prev.slice(1), item]
      return [...prev, item]
    })
  }

  if (!open) return null
  return (
    <div ref={ov.overlayRef} {...ov.overlayProps}
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-[600px] h-[80%] flex flex-col rounded-xl bg-surface-900 border border-white/10 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/10">
          <div>
            <h3 className="text-sm font-medium text-white">{title}</h3>
            <p className="text-[10px] text-white/45 mt-0.5">
              {hint}{max ? ` · 已选 ${picked.length}/${max}` : ` · 已选 ${picked.length}`}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭" className="p-1 rounded hover:bg-white/10 text-white/60">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-3 py-2 border-b border-white/10">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/35" aria-hidden="true" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索名称" aria-label="搜索名称"
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg bg-black/30 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:border-primary-400/60" />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          <PickerGrid items={filtered} picked={picked} onToggle={toggle} />
          {filtered.length === 0 && <p className="text-center text-xs text-white/40 py-8">没有匹配的条目</p>}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-2.5 border-t border-white/10">
          {allowEmpty && (
            <SimButton onClick={() => { onConfirm([]); onClose() }}>清空</SimButton>
          )}
          <SimButton onClick={onClose}>取消</SimButton>
          <SimButton variant="primary" onClick={() => { onConfirm(picked); onClose() }}>
            <Check className="w-3.5 h-3.5" aria-hidden="true" />确定
          </SimButton>
        </div>
      </div>
    </div>
  )
}

function PickerGrid({ items, picked, onToggle }) {
  const { containerProps, itemProps } = useRovingFocus({
    count: items.length,
    columns: 6,
    onActivate: (i) => { if (items[i]) onToggle(items[i]) },
  })
  return (
    <div {...containerProps} className="grid grid-cols-6 gap-2">
      {items.map((it, i) => {
        const on = picked.some(p => p.key === it.key)
        const st = rarityStyle(it.rarity)
        return (
          <button
            key={it.key}
            type="button"
            {...itemProps(i)}
            onClick={() => onToggle(it)}
            title={`${it.name}（${st.label}）`}
            className={`relative flex flex-col items-center gap-1 p-1.5 rounded-lg border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/70 ${
              on ? 'border-primary-400/70 bg-primary-500/15' : 'border-white/10 bg-white/5 hover:bg-white/10'
            }`}
          >
            <SimItemIcon item={it} size={44} />
            <span className="text-[10px] text-white/70 truncate w-full text-center">{it.name}</span>
            {on && (
              <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-primary-500 flex items-center justify-center">
                <Check className="w-2.5 h-2.5 text-white" aria-hidden="true" />
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════
// 历史卡池导入弹窗
// ═════════════════════════════════════════════════════════════════
function HistoryImport({ open, onClose, roster, onApply, mode = 'period', type = null }) {
  const { query } = useDb()
  const isType = mode === 'type'
  const ov = useOverlay({ open, onClose, label: '从祈愿板块导入历史卡池', initialFocus: 'auto' })
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(null)   // 正在导入的 key

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    listImportableWishes(query)
      .then(list => { if (!cancelled) setRows(list) })
      .catch(() => { if (!cancelled) setRows([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, query])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const hit = (w) => !q || String(w.version).includes(q) || (w.name_zh || '').toLowerCase().includes(q)
    if (isType) return rows.filter(w => w.banner_type === type && hit(w))
    return groupWishesByPeriod(rows).filter(g => !q || String(g.version).includes(q) ||
      g.wishes.some(w => (w.name_zh || '').toLowerCase().includes(q)))
  }, [rows, search, isType, type])

  /** 单类型导入：只替换这一个池 */
  const applyOne = async (wish) => {
    setBusy(wish.id)
    try {
      const detail = await loadWishDetail(query, wish.id, roster)
      if (detail?.pools) onApply(detail.pools, detail.wish, { scope: 'type' })
      onClose()
    } finally { setBusy(null) }
  }

  /** 整期导入：把这期开放的全部池一次性安排上，该期没有的类型不安排 */
  const applyPeriod = async (g) => {
    setBusy(g.key)
    try {
      const details = await Promise.all(g.wishes.map(w => loadWishDetail(query, w.id, roster)))
      const merged = {}
      for (const d of details) {
        if (!d?.pools) continue
        for (const [k, v] of Object.entries(d.pools)) merged[k] = v
      }
      onApply(merged, { version: g.version, phase: g.phase, id: g.wishes[0]?.id ?? null },
        { scope: 'period', types: g.types })
      onClose()
    } finally { setBusy(null) }
  }

  if (!open) return null
  const title = isType ? `导入历史「${IMPORT_BANNER_TYPES[type] || ''}」` : '从祈愿板块导入历史卡池'

  return (
    <div ref={ov.overlayRef} {...ov.overlayProps}
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-[820px] h-[84%] flex flex-col rounded-xl bg-surface-900 border border-white/10 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/10">
          <div>
            <h3 className="text-sm font-medium text-white">{title}</h3>
            <p className="text-[10px] text-white/45 mt-0.5">
              {isType ? '只替换该类型卡池，其余池保持不变；导入后仍可手工调整 UP 内容'
                : '选择某一期即可把这期开放的卡池全部导入；该期没有的祈愿类型不会安排'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-white/35" aria-hidden="true" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="版本" aria-label="搜索版本"
                className="w-24 pl-7 pr-2 py-1 text-[11px] rounded-lg bg-black/30 border border-white/10 text-white placeholder-white/30" />
            </div>
            <button type="button" onClick={onClose} aria-label="关闭" className="p-1 rounded hover:bg-white/10 text-white/60">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {loading && <p className="text-center text-xs text-white/40 py-10">加载中…</p>}
          {!loading && filtered.length === 0 && <p className="text-center text-xs text-white/40 py-10">没有可选卡池</p>}

          {isType ? (
            /* ── 单类型：该类型全部期数的画廊 ── */
            <div className="grid grid-cols-3 gap-3">
              {filtered.slice(0, 120).map(w => (
                <GalleryCard
                  key={w.id}
                  coverFiles={w.cover ? [w.cover] : []}
                  version={w.version} phase={w.phase}
                  title={w.name_zh || IMPORT_BANNER_TYPES[w.banner_type]}
                  meta={`${w.banner_count} 池`}
                  busy={busy === w.id}
                  onClick={() => applyOne(w)}
                />
              ))}
            </div>
          ) : (
            /* ── 整期：把该期开放的全部类型合成一张卡 ── */
            <div className="grid grid-cols-3 gap-3">
              {filtered.slice(0, 120).map(g => (
                <GalleryCard
                  key={g.key}
                  coverFiles={g.covers.filter(Boolean).slice(0, 3)}
                  version={g.version} phase={g.phase}
                  title={g.label}
                  meta={`${g.types.length} 类卡池`}
                  busy={busy === g.key}
                  onClick={() => applyPeriod(g)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** 画廊卡片：封面 + 版本/期数 + 标题 */
function GalleryCard({ coverFiles, version, phase, title, meta, busy, onClick }) {
  const files = (coverFiles || []).slice(0, 3)
  const imgs = useSimImages(files, 200)
  return (
    // 注意：<button> 的 UA 样式带 align-items:flex-start，flex 布局下子元素不会自动撑满，
    // 必须显式 items-stretch，否则封面容器宽度会塌成 0（图片加载了却看不见）。
    <button type="button" disabled={busy} onClick={onClick}
      className="group flex flex-col items-stretch rounded-lg overflow-hidden border border-white/10 bg-white/5 hover:bg-white/10 hover:border-primary-400/45 text-left transition-colors disabled:opacity-50">
      <div className="relative w-full h-[92px] bg-black/40 overflow-hidden">
        {files.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-[10px] text-white/25">无封面</div>
        )}
        {files.length > 0 && (
          <div className="absolute inset-0 flex">
            {files.map(f => (
              <div key={f} className="flex-1 h-full overflow-hidden border-r border-black/25 last:border-r-0">
                {imgs[f] && <img src={imgs[f]} alt="" draggable={false}
                  className="w-full h-full object-cover object-top" style={{ maxWidth: 'none' }} />}
              </div>
            ))}
          </div>
        )}
        {busy && <div className="absolute inset-0 bg-black/55 flex items-center justify-center text-[11px] text-white/80">导入中…</div>}
      </div>
      <div className="px-2 py-1.5">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-mono text-primary-300">{version}</span>
          <span className="text-[10px] text-white/40">第{phase}期</span>
        </div>
        <div className="text-[11px] text-white/80 truncate mt-0.5" title={title}>{title}</div>
        <div className="text-[10px] text-white/35">{meta}</div>
      </div>
    </button>
  )
}

// ═════════════════════════════════════════════════════════════════
// 北国银行明细导入弹窗
//   北国银行按期记录「原石 / 纠缠之缘 / 创世结晶 / 星辉」余额快照，
//   选中一期即把该期余额填为本次模拟的初始资源。
//   注意：北国银行不记录「相遇之缘」，该项保持原值不动。
// ═════════════════════════════════════════════════════════════════
function NorthlandImport({ open, onClose, onApply }) {
  const ov = useOverlay({ open, onClose, label: '从北国银行导入初始资源', initialFocus: 'auto' })
  const [periods, setPeriods] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selectedKey, setSelectedKey] = useState(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true); setError('')
    Promise.resolve(window.electronAPI?.northlandbankLoadRecords?.())
      .then(r => {
        if (cancelled) return
        // 返回的是记录数组，原始形态为「一天一条 { id, date, periods:[{seq,primogems,…}] }」，
        // 资源余额挂在 periods 上而非记录顶层 —— 必须展平成「一天一期」再选。
        const raw = Array.isArray(r) ? r : (r?.records || [])
        const flat = []
        for (const rec of raw) {
          if (!rec || !rec.date) continue
          const list = Array.isArray(rec.periods) && rec.periods.length ? rec.periods : [rec]
          for (const p of list) {
            flat.push({
              key: `${rec.id}:${p.id ?? p.seq ?? 0}`,
              date: rec.date,
              seq: p.seq ?? 1,
              primogems: Number(p.primogems) || 0,
              intertwinedFates: Number(p.intertwinedFates) || 0,
              genesisCrystals: Number(p.genesisCrystals) || 0,
              starglitter: Number(p.starglitter) || 0,
              note: p.note || '',
            })
          }
        }
        flat.sort((a, b) => String(b.date).localeCompare(String(a.date)) || (b.seq - a.seq))
        setPeriods(flat)
        setSelectedKey(flat[0]?.key ?? null)
      })
      .catch(e => { if (!cancelled) setError(String(e?.message || e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open])

  if (!open) return null
  const selected = periods.find(p => p.key === selectedKey) || null

  return (
    <div ref={ov.overlayRef} {...ov.overlayProps}
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-[580px] max-h-[84%] flex flex-col rounded-xl bg-surface-900 border border-white/10 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/10">
          <div>
            <h3 className="text-sm font-medium text-white">从北国银行导入初始资源</h3>
            <p className="text-[10px] text-white/45 mt-0.5">选择一期明细，把该期余额作为本次模拟的初始资源</p>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭" className="p-1 rounded hover:bg-white/10 text-white/60">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
          {loading && <p className="text-center text-xs text-white/40 py-6">读取中…</p>}
          {!loading && periods.length === 0 && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-amber-500/10 border border-amber-400/25">
              <AlertCircle className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" aria-hidden="true" />
              <p className="text-[11px] text-amber-100/85 leading-relaxed">
                北国银行还没有任何明细记录。请先到「北国银行」小程序按日期记账，再回到这里导入。
              </p>
            </div>
          )}
          {periods.map(p => {
            const on = p.key === selectedKey
            return (
              <button key={p.key} type="button" onClick={() => setSelectedKey(p.key)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg border text-left transition-colors ${
                  on ? 'bg-primary-500/15 border-primary-400/50' : 'bg-white/5 border-white/10 hover:bg-white/10'}`}>
                <span className="text-xs text-white/90 font-mono shrink-0">{p.date}</span>
                {p.seq > 1 && <span className="text-[10px] text-white/40 shrink-0">第{p.seq}期</span>}
                <span className="text-[10px] text-white/55 tabular-nums truncate">
                  原石 {p.primogems.toLocaleString()}
                  <span className="mx-1.5 text-white/20">·</span>纠缠 {p.intertwinedFates}
                  <span className="mx-1.5 text-white/20">·</span>结晶 {p.genesisCrystals.toLocaleString()}
                  <span className="mx-1.5 text-white/20">·</span>星辉 {p.starglitter}
                </span>
                {on && <Check className="w-3.5 h-3.5 text-primary-300 ml-auto shrink-0" aria-hidden="true" />}
              </button>
            )
          })}
          {error && <p className="text-[11px] text-rose-300">{error}</p>}
        </div>

        <div className="px-4 py-2.5 border-t border-white/10 space-y-2">
          {selected && (
            <p className="text-[10px] text-white/45">
              将填入：创世结晶 {selected.genesisCrystals.toLocaleString()} · 原石 {selected.primogems.toLocaleString()} ·
              纠缠之缘 {selected.intertwinedFates} · 无主的星辉 {selected.starglitter}
              <span className="text-white/30">（北国银行不记录相遇之缘，该项保持原值）</span>
            </p>
          )}
          <div className="flex justify-end gap-2">
            <SimButton onClick={onClose}>取消</SimButton>
            <SimButton variant="primary" disabled={!selected} onClick={() => { onApply(selected); onClose() }}>
              <Check className="w-3.5 h-3.5" aria-hidden="true" />导入
            </SimButton>
          </div>
        </div>
      </div>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════
// 垫池 / 历史导入弹窗
// ═════════════════════════════════════════════════════════════════
function ArchiveImport({ open, onClose, roster, onApply }) {
  const ov = useOverlay({ open, onClose, label: '从祈愿捕捉站导入', initialFocus: 'auto' })
  const [archives, setArchives] = useState([])
  const [uid, setUid] = useState(null)
  const [withRecords, setWithRecords] = useState(true)
  const [loading, setLoading] = useState(false)
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true); setError('')
    Promise.resolve(window.electronAPI?.gachaListArchives?.())
      .then(r => {
        if (cancelled) return
        const list = r?.archives || []
        setArchives(list)
        setUid(list[0]?.uid || null)
      })
      .catch(e => { if (!cancelled) setError(String(e?.message || e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open])

  useEffect(() => {
    if (!open || !uid) { setPreview(null); return }
    let cancelled = false
    setLoading(true)
    const types = [301, 400, 302, 500, 200]
    Promise.all(types.map(t => window.electronAPI?.gachaGetItemsByType?.(uid, t)))
      .then(results => {
        if (cancelled) return
        const byType = {}
        types.forEach((t, i) => { byType[t] = results[i]?.success ? results[i].items : [] })
        setPreview(pityFromGachaArchive(byType, roster))
      })
      .catch(e => { if (!cancelled) setError(String(e?.message || e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, uid, roster])

  if (!open) return null
  return (
    <div ref={ov.overlayRef} {...ov.overlayProps}
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-[520px] max-h-[84%] flex flex-col rounded-xl bg-surface-900 border border-white/10 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/10">
          <div>
            <h3 className="text-sm font-medium text-white">从祈愿捕捉站导入</h3>
            <p className="text-[10px] text-white/45 mt-0.5">读取已抓取的真实抽卡记录，推算各池垫池状态</p>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭" className="p-1 rounded hover:bg-white/10 text-white/60">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {loading && <p className="text-center text-xs text-white/40 py-6">读取中…</p>}
          {!loading && archives.length === 0 && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-amber-500/10 border border-amber-400/25">
              <AlertCircle className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" aria-hidden="true" />
              <p className="text-[11px] text-amber-100/85 leading-relaxed">
                还没有已抓取的祈愿档案。请先到「祈愿捕捉站」扫码登录并拉取抽卡记录，再回到这里导入。
              </p>
            </div>
          )}
          {archives.length > 0 && (
            <div className="space-y-1.5">
              {archives.map(a => (
                <button key={a.uid} type="button" onClick={() => setUid(a.uid)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg border text-left transition-colors ${
                    uid === a.uid ? 'bg-primary-500/15 border-primary-400/50' : 'bg-white/5 border-white/10 hover:bg-white/10'
                  }`}>
                  <span className="text-xs text-white/90 flex-1 truncate">{a.nickname || '旅行者'} · {a.uid}</span>
                  <span className="text-[10px] text-white/40">{a.server}</span>
                  <span className="text-[10px] text-white/40">{a.item_count} 条</span>
                </button>
              ))}
            </div>
          )}

          {preview && (
            <div className="rounded-lg border border-white/10 bg-black/25 p-3 space-y-2">
              <p className="text-[11px] text-white/60">推算出的垫池状态</p>
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <PityLine label="角色池" p={preview.pity.character} hard={90} extra={preview.pity.character.guaranteed ? '大保底' : `小保底 · 连保${preview.pity.character.crStreak}`} />
                <PityLine label="武器池" p={preview.pity.weapon} hard={80} extra={`命定值 ${preview.pity.weapon.fate}`} />
                <PityLine label="集录池" p={preview.pity.chronicled} hard={90} extra={`命定值 ${preview.pity.chronicled.fate}`} />
                <PityLine label="常驻池" p={preview.pity.standard} hard={90} extra="" />
              </div>
              <p className="text-[10px] text-white/40">
                共 {preview.records.length} 条历史记录（角色 {preview.counts.character} · 武器 {preview.counts.weapon} · 集录 {preview.counts.chronicled} · 常驻 {preview.counts.standard}）
              </p>
            </div>
          )}
          {error && <p className="text-[11px] text-rose-300">{error}</p>}
        </div>

        <div className="px-4 py-2.5 border-t border-white/10 space-y-2">
          <label className="flex items-center gap-2 text-[11px] text-white/70 cursor-pointer">
            <input type="checkbox" checked={withRecords} onChange={e => setWithRecords(e.target.checked)}
              className="accent-primary-500" />
            同时把历史抽卡记录导入到「抽卡记录」中
          </label>
          <div className="flex justify-end gap-2">
            <SimButton onClick={onClose}>取消</SimButton>
            <SimButton variant="primary" disabled={!preview} onClick={() => {
              onApply({ pity: preview.pity, records: withRecords ? preview.records : [] })
              onClose()
            }}>
              <Check className="w-3.5 h-3.5" aria-hidden="true" />导入
            </SimButton>
          </div>
        </div>
      </div>
    </div>
  )
}

function PityLine({ label, p, hard, extra }) {
  return (
    <div className="px-2 py-1.5 rounded bg-white/5">
      <div className="flex justify-between">
        <span className="text-white/70">{label}</span>
        <span className="text-white/90 tabular-nums">{p.p5}/{hard}</span>
      </div>
      <div className="text-[10px] text-white/40 mt-0.5">
        四星 {p.p4}/10{extra ? ` · ${extra}` : ''}
      </div>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════
// 主配置面板
// ═════════════════════════════════════════════════════════════════
export default function SimulankaSetup({ roster, config, setConfig, resources, setResources, pity, setPity, onImportRecords, onStart, onBack }) {
  const [section, setSection] = useState('pools')
  const [picker, setPicker] = useState(null)   // { poolId, slot: 'up5'|'up4'|'pool5'|'pool4' }
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyMode, setHistoryMode] = useState('period')
  const [historyType, setHistoryType] = useState(null)
  const openHistory = useCallback((mode, type = null) => {
    setHistoryMode(mode); setHistoryType(type); setHistoryOpen(true)
  }, [])
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [bankOpen, setBankOpen] = useState(false)
  const [toast, setToast] = useState('')

  const pots = config?.pools || {}
  const char2On = pots.character2?.enabled !== false
  const counts = roster?.counts || {}

  const showToast = useCallback((msg) => {
    setToast(msg)
    setTimeout(() => setToast(''), 1800)
  }, [])

  const patchPool = useCallback((poolId, patch) => {
    setConfig(prev => ({
      ...prev,
      pools: { ...prev.pools, [poolId]: { ...prev.pools[poolId], ...patch } },
    }))
  }, [setConfig])

  const pickerCandidates = useMemo(() => {
    if (!picker || !roster) return []
    const want5 = picker.slot === 'up5' || picker.slot === 'pool5'
    const kind = picker.poolId === 'character1' || picker.poolId === 'character2' ? 'character'
      : picker.poolId === 'weapon' ? 'weapon' : null
    const rarity = want5 ? 5 : 4
    if (kind) return (kind === 'character' ? roster.characters : roster.weapons).filter(x => x.rarity === rarity)
    // 集录池：角色 + 武器都可选
    return [...roster.characters, ...roster.weapons].filter(x => x.rarity === rarity)
  }, [picker, roster])

  const pickerSelected = useMemo(() => {
    if (!picker) return []
    return pots[picker.poolId]?.[picker.slot] || []
  }, [picker, pots])

  const poolMeta = useMemo(() => {
    const meta = {}
    for (const id of POOL_IDS) {
      const p = pots[id]
      if (!p) continue
      const files = [...(p.up5 || []), ...(p.up4 || []), ...(p.pool5 || []), ...(p.pool4 || [])].map(x => x.art).filter(Boolean)
      meta[id] = files
    }
    return meta
  }, [pots])
  const allArt = useMemo(() => Object.values(poolMeta).flat(), [poolMeta])
  const imgMap = useSimImages(allArt, 96)

  /**
   * 导入历史卡池。
   *   scope='type'   只替换选中的那一类卡池，其余保持不动
   *   scope='period' 整期导入：把这期开放的池全部安排上，该期没有的类型则不安排（置空）
   */
  const applyHistory = useCallback((imported, wish, opts = {}) => {
    const scope = opts.scope || 'type'
    setConfig(prev => {
      const next = { ...prev, pools: { ...prev.pools } }
      if (scope === 'period') {
        const openTypes = new Set(opts.types || [])
        const CHRON = 'chronicled'
        // 角色池-2：该期没有第二个角色池就关闭（角色池 1&2 同属角色活动祈愿）
        const hasChar1 = !!imported.character1
        const hasChar2 = !!imported.character2
        if (hasChar1) next.pools.character1 = { ...(next.pools.character1 || {}), ...imported.character1 }
        if (hasChar2) next.pools.character2 = { ...(next.pools.character2 || {}), ...imported.character2, enabled: true }
        else next.pools.character2 = { ...(next.pools.character2 || {}), enabled: false }
        if (!hasChar1) next.pools.character1 = null   // 该期没有角色池：不安排
        next.pools.weapon = imported.weapon ? { ...(next.pools.weapon || {}), ...imported.weapon } : null
        next.pools.chronicled = imported[CHRON] ? { ...(next.pools[CHRON] || {}), ...imported[CHRON] } : null
        next.pools.standard = imported.standard ? { ...(next.pools.standard || {}), ...imported.standard } : null
        void openTypes
      } else {
        for (const [k, v] of Object.entries(imported)) {
          next.pools[k] = { ...(next.pools[k] || {}), ...v, enabled: k === 'character2' ? true : next.pools[k]?.enabled }
        }
        if (!imported.character2 && imported.character1) {
          next.pools.character2 = { ...(next.pools.character2 || {}), enabled: false }
        }
      }
      return { ...next, sourceWish: { version: wish.version, phase: wish.phase, id: wish.id } }
    })
    showToast(scope === 'period'
      ? `已导入 ${wish.version} 第${wish.phase}期全部卡池`
      : `已导入 ${wish.version} 第${wish.phase}期卡池`)
  }, [setConfig, showToast])

  const applyBank = useCallback((rec) => {
    setResources(prev => ({
      ...normalizeResources(prev),
      genesis: Math.max(0, Math.floor(rec.genesisCrystals || 0)),
      primogem: Math.max(0, Math.floor(rec.primogems || 0)),
      intertwined: Math.max(0, Math.floor(rec.intertwinedFates || 0)),
      starglitter: Math.max(0, Math.floor(rec.starglitter || 0)),
    }))
    showToast(`已导入北国银行 ${rec.date} 明细`)
  }, [setResources, showToast])

  const applyArchive = useCallback(({ pity: p, records }) => {
    setPity(p)
    if (records?.length) onImportRecords?.(records)
    showToast(records?.length ? `已导入垫池状态与 ${records.length} 条历史记录` : '已导入垫池状态')
  }, [setPity, onImportRecords, showToast])

  // 「不安排」的池（整期导入时该期没开放的类型，config.pools[id] 为 null）不参与校验，
  // 否则导入一个没有集录祈愿的时段后会永远无法开始模拟。
  const valid = useMemo(() => {
    const arranged = POOL_IDS.filter(id => pots[id])
    const ok1 = !pots.character1 || (pots.character1.up5 || []).length > 0
    const ok2 = !char2On || (pots.character2?.up5 || []).length > 0
    const ok3 = !pots.weapon || (pots.weapon.up5 || []).length > 0
    const ok4 = !pots.chronicled || (pots.chronicled.pool5 || []).length > 0
    const missing = []
    if (!ok1) missing.push('「角色活动祈愿」需要指定 1 名五星 UP 角色')
    if (!ok2) missing.push('「角色活动祈愿-2」需要指定 1 名五星 UP 角色（或关闭该池）')
    if (!ok3) missing.push('「武器活动祈愿」需要指定至少 1 把五星 UP 武器')
    if (!ok4) missing.push('「集录祈愿」需要指定至少 1 件池内五星物品')
    if (arranged.length === 0) missing.push('至少要安排一个卡池')
    return { ok1, ok2, ok3, ok4, missing, all: missing.length === 0 }
  }, [pots, char2On])

  return (
    <div className="h-full flex flex-col bg-surface-950">
      {/* 顶栏 */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-white/10 shrink-0">
        <Wand2 className="w-4 h-4 text-primary-300" aria-hidden="true" />
        <h2 className="text-sm font-medium text-white">模拟前配置</h2>
        <nav className="flex items-center gap-1 ml-2">
          {SECTIONS.map(s => {
            const Icon = s.icon
            return (
              <button key={s.id} type="button" onClick={() => setSection(s.id)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] border transition-colors ${
                  section === s.id ? 'bg-primary-500/20 border-primary-400/50 text-primary-200' : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10'
                }`}>
                <Icon className="w-3 h-3" aria-hidden="true" />{s.label}
              </button>
            )
          })}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {onBack && <SimButton onClick={onBack}>返回</SimButton>}
          <SimButton variant="gold" disabled={!valid.all} onClick={onStart}>
            开始模拟<ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
          </SimButton>
        </div>
      </div>

      {/* 内容 */}
      <div className="flex-1 overflow-y-auto p-4">
        {section === 'pools' && (
          <div className="space-y-3 max-w-[980px] mx-auto">
            {/* 整期导入：选一个版本的一期，把这期开放的卡池一次性全部安排上 */}
            <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-primary-400/30 bg-primary-500/10">
              <FolderInput className="w-4 h-4 text-primary-300 shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                <div className="text-xs text-white/85">按版本整期导入</div>
                <div className="text-[10px] text-white/45">
                  选择某一期即可同时安排这期的角色/武器/集录/常驻卡池；该期没有的祈愿类型不会被安排
                </div>
              </div>
              <SimButton variant="primary" className="ml-auto shrink-0"
                onClick={() => openHistory('period')}>
                <FolderInput className="w-3.5 h-3.5" aria-hidden="true" />按版本整期导入
              </SimButton>
            </div>

            {/* 角色活动祈愿 1 & 2 同属一组，共用一个导入按钮 */}
            <div className="rounded-xl border border-white/10 bg-white/5 p-2 space-y-2">
              <div className="flex items-center gap-2 px-1">
                <Users className="w-3.5 h-3.5 text-white/50" aria-hidden="true" />
                <span className="text-[11px] text-white/60">角色活动祈愿</span>
                <SimButton className="ml-auto shrink-0" onClick={() => openHistory('type', 'character-event')}>
                  <FolderInput className="w-3.5 h-3.5" aria-hidden="true" />导入历史卡池
                </SimButton>
              </div>
              <PoolRow id="character1" icon={Users} pools={pots} imgMap={imgMap}
                onPick={setPicker} onPatch={patchPool} roster={roster} />
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 border border-white/10">
                <label className="flex items-center gap-2 text-xs text-white/75 cursor-pointer">
                  <input type="checkbox" checked={char2On} className="accent-primary-500"
                    onChange={e => patchPool('character2', { enabled: e.target.checked })} />
                  安排「角色活动祈愿-2」
                </label>
                <span className="text-[10px] text-white/40">两个角色池共享保底与捕获明光连保（与原版一致）</span>
              </div>
              {char2On && (
                <PoolRow id="character2" icon={Users} pools={pots} imgMap={imgMap}
                  onPick={setPicker} onPatch={patchPool} roster={roster} />
              )}
            </div>

            {[
              { id: 'weapon', icon: Swords, label: '武器活动祈愿', t: 'weapon-event' },
              { id: 'chronicled', icon: Sparkles, label: '集录祈愿', t: 'chronicled' },
              { id: 'standard', icon: Star, label: '常驻祈愿', t: 'standard' },
            ].map(({ id, icon: Icon, label, t }) => (
              <div key={id} className="rounded-xl border border-white/10 bg-white/5 p-2 space-y-2">
                <div className="flex items-center gap-2 px-1">
                  <Icon className="w-3.5 h-3.5 text-white/50" aria-hidden="true" />
                  <span className="text-[11px] text-white/60">{label}</span>
                  <SimButton className="ml-auto shrink-0" onClick={() => openHistory('type', t)}>
                    <FolderInput className="w-3.5 h-3.5" aria-hidden="true" />导入历史卡池
                  </SimButton>
                </div>
                <PoolRow id={id} icon={Icon} pools={pots} imgMap={imgMap}
                  onPick={setPicker} onPatch={patchPool} roster={roster} />
              </div>
            ))}
          </div>
        )}

        {section === 'res' && (
          <div className="max-w-[560px] mx-auto space-y-3">
            <p className="text-[11px] text-white/50 leading-relaxed">
              设置本次模拟的初始资源。抽取时若缘不足，会按原版规则自动以 160 原石换 1 缘、原石不足时再以 1 创世结晶换 1 原石。
            </p>
            <div className="grid grid-cols-2 gap-3">
              {[
                { k: 'genesis', label: '创世结晶' },
                { k: 'primogem', label: '原石' },
                { k: 'intertwined', label: '纠缠之缘' },
                { k: 'acquaint', label: '相遇之缘' },
              ].map(({ k, label }) => (
                <label key={k} className="block">
                  <span className="text-[11px] text-white/55">{label}</span>
                  <input
                    type="number" min="0" step="1"
                    value={resources[k] ?? 0}
                    onChange={e => setResources(r => ({ ...normalizeResources(r), [k]: Math.max(0, Math.floor(Number(e.target.value) || 0)) }))}
                    className="mt-1 w-full px-2.5 py-1.5 text-xs rounded-lg bg-black/30 border border-white/10 text-white tabular-nums focus:outline-none focus:border-primary-400/60"
                  />
                </label>
              ))}
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              <SimButton size="sm" variant="primary" onClick={() => setBankOpen(true)}>
                <Landmark className="w-3.5 h-3.5" aria-hidden="true" />从北国银行导入明细
              </SimButton>
              <SimButton size="sm" onClick={() => setResources({ genesis: 0, primogem: 0, intertwined: 0, acquaint: 0, starglitter: 0, stardust: 0 })}>清零</SimButton>
              <SimButton size="sm" onClick={() => setResources(r => ({ ...normalizeResources(r), genesis: normalizeResources(r).genesis + 8080 }))}>氪一单（+8080 创世结晶）</SimButton>
              <SimButton size="sm" onClick={() => setResources({ genesis: 999999, primogem: 999999, intertwined: 9999, acquaint: 9999, starglitter: 0, stardust: 0 })}>无限资源</SimButton>
            </div>
          </div>
        )}

        {section === 'pity' && (
          <div className="max-w-[680px] mx-auto space-y-3">
            <div className="flex items-center gap-3">
              <p className="text-[11px] text-white/50 leading-relaxed flex-1">
                设置起始垫池状态，或直接从祈愿捕捉站导入真实抽卡记录来推算。定轨命定值因卡池轮替会清零，需要手工确认。
              </p>
              <SimButton className="shrink-0" onClick={() => setArchiveOpen(true)}>
                <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />导入垫池
              </SimButton>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <PityEditor label="角色池（含角色池-2）" hard={90} value={pity.character}
                onChange={v => setPity(p => ({ ...p, character: { ...p.character, ...v } }))}
                showChar />
              <PityEditor label="武器池" hard={80} value={pity.weapon}
                onChange={v => setPity(p => ({ ...p, weapon: { ...p.weapon, ...v } }))}
                showFate />
              <PityEditor label="集录祈愿" hard={90} value={pity.chronicled}
                onChange={v => setPity(p => ({ ...p, chronicled: { ...p.chronicled, ...v } }))}
                showFate />
              <PityEditor label="常驻祈愿" hard={90} value={pity.standard}
                onChange={v => setPity(p => ({ ...p, standard: { ...p.standard, ...v } }))} />
            </div>
          </div>
        )}
      </div>

      {/* 底栏校验 */}
      {!valid.all && (
        <div className="px-4 py-2 border-t border-white/10 bg-amber-500/10 flex items-center gap-2 shrink-0">
          <AlertCircle className="w-3.5 h-3.5 text-amber-300" aria-hidden="true" />
          <span className="text-[11px] text-amber-100/85">
            {valid.missing.join('；')}。
          </span>
        </div>
      )}

      {toast && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full bg-black/75 border border-white/15 text-[11px] text-white/90 animate-fade-in">
          {toast}
        </div>
      )}

      <CandidatePicker
        open={!!picker}
        onClose={() => setPicker(null)}
        title={picker ? `${POOL_LABEL[picker.poolId]} · ${picker.slot.includes('5') ? '五星' : '四星'}内容` : ''}
        hint={pickerHint(picker)}
        candidates={pickerCandidates}
        selected={pickerSelected}
        max={pickerMax(picker)}
        onConfirm={(items) => picker && patchPool(picker.poolId, { [picker.slot]: items })}
      />
      <HistoryImport open={historyOpen} onClose={() => setHistoryOpen(false)} roster={roster}
        onApply={applyHistory} mode={historyMode} type={historyType} />
      <ArchiveImport open={archiveOpen} onClose={() => setArchiveOpen(false)} roster={roster} onApply={applyArchive} />
      <NorthlandImport open={bankOpen} onClose={() => setBankOpen(false)} onApply={applyBank} />
    </div>
  )
}

function pickerHint(p) {
  if (!p) return ''
  if (p.slot === 'up5') return p.poolId === 'character1' || p.poolId === 'character2' ? '指定 1 名五星 UP 角色' : '指定 2 把五星 UP 武器'
  if (p.slot === 'up4') return p.poolId === 'weapon' ? '指定 5 把四星 UP 武器（每类各一）' : '指定 3 名四星 UP 角色'
  if (p.slot === 'pool5') return '集录祈愿池内五星（角色与武器都可以，定轨目标从中选择）'
  return '集录祈愿池内四星'
}
function pickerMax(p) {
  if (!p) return 0
  if (p.slot === 'up5') return (p.poolId === 'weapon' || p.poolId === 'chronicled') ? 2 : 1
  if (p.slot === 'up4') return p.poolId === 'weapon' ? 5 : 3
  return 0
}

// ── 单池配置行 ──
function PoolRow({ id, icon: Icon, pools, imgMap, onPick, onPatch, roster }) {
  const p = pools[id] || {}
  const isChar = id === 'character1' || id === 'character2'
  const isChron = id === 'chronicled'
  const isStd = id === 'standard'
  const disabled = id === 'character2' && p.enabled === false

  const up5 = isChron ? (p.pool5 || []) : (p.up5 || [])
  const up4 = isChron ? (p.pool4 || []) : (p.up4 || [])

  if (isStd) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-3">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-white/50" aria-hidden="true" />
          <span className="text-xs font-medium text-white/85">{POOL_LABEL[id]}</span>
          <span className="text-[10px] text-white/40">消耗相遇之缘 · 内容固定为常驻池</span>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-white/55">
          <div className="px-2 py-1.5 rounded bg-black/25">常驻五星角色 <span className="text-white/85 tabular-nums">{roster?.counts?.chars5 ?? 0}</span> 名</div>
          <div className="px-2 py-1.5 rounded bg-black/25">常驻五星武器 <span className="text-white/85 tabular-nums">{roster?.counts?.weapons5 ?? 0}</span> 把</div>
          <div className="px-2 py-1.5 rounded bg-black/25">常驻四星角色 <span className="text-white/85 tabular-nums">{roster?.counts?.chars4 ?? 0}</span> 名</div>
          <div className="px-2 py-1.5 rounded bg-black/25">常驻四星武器 <span className="text-white/85 tabular-nums">{roster?.counts?.weapons4 ?? 0}</span> 把</div>
        </div>
        <p className="text-[10px] text-white/35 mt-2">三星武器 {roster?.counts?.weapons3 ?? 0} 把，全池共用</p>
      </div>
    )
  }

  return (
    <div className={`rounded-xl border border-white/10 bg-white/5 p-3 ${disabled ? 'opacity-45' : ''}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <Icon className="w-4 h-4 text-white/50" aria-hidden="true" />
        <span className="text-xs font-medium text-white/85">{POOL_LABEL[id]}</span>
        <input
          value={p.bannerName || ''}
          onChange={e => onPatch(id, { bannerName: e.target.value })}
          placeholder="卡池名"
          aria-label={`${POOL_LABEL[id]}卡池名`}
          className="px-2 py-0.5 text-[11px] rounded bg-black/25 border border-white/10 text-white/85 w-40 focus:outline-none focus:border-primary-400/50"
        />
        <span className="text-[10px] text-white/35">
          {isChar ? '消耗纠缠之缘 · 90 抽保底' : id === 'weapon' ? '消耗纠缠之缘 · 80 抽保底 · 神铸定轨' : '消耗纠缠之缘 · 90 抽保底 · 集录定轨'}
        </span>
      </div>

      <div className="mt-2.5 space-y-2">
        <Slot
          label={isChron ? '池内五星' : '五星 UP'}
          items={up5}
          imgMap={imgMap}
          onPick={() => onPick({ poolId: id, slot: isChron ? 'pool5' : 'up5' })}
          hint={isChron ? '角色与武器都可以' : isChar ? '1 名角色' : '2 把武器'}
        />
        <Slot
          label={isChron ? '池内四星' : '四星 UP'}
          items={up4}
          imgMap={imgMap}
          onPick={() => onPick({ poolId: id, slot: isChron ? 'pool4' : 'up4' })}
          hint={isChron ? '角色与武器都可以' : isChar ? '3 名角色' : '5 把武器'}
        />
      </div>
    </div>
  )
}

function Slot({ label, items, onPick, hint, imgMap }) {
  return (
    <div className="flex items-start gap-2">
      <div className="w-[68px] shrink-0 pt-1.5">
        <div className="text-[10px] text-white/55">{label}</div>
        <div className="text-[9px] text-white/30">{hint}</div>
      </div>
      <div className="flex-1 flex flex-wrap items-center gap-1.5">
        {items.map(it => (
          <div key={it.key} className="flex items-center gap-1.5 pl-1 pr-2 py-1 rounded-lg bg-black/25 border border-white/10">
            <SimItemIcon item={it} size={26} imgMap={imgMap} />
            <span className="text-[11px] text-white/80">{it.name}</span>
          </div>
        ))}
        <button type="button" onClick={onPick}
          className="px-2.5 py-1.5 rounded-lg text-[11px] border border-dashed border-white/20 text-white/55 hover:bg-white/5 hover:text-white/80 transition-colors">
          {items.length ? '修改' : '选择内容'}
        </button>
      </div>
    </div>
  )
}

function PityEditor({ label, hard, value, onChange, showChar, showFate }) {
  const v = value || {}
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-3 space-y-2">
      <p className="text-[11px] text-white/75">{label}</p>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-[10px] text-white/45">距上次五星（0–{hard - 1}）</span>
          <input type="number" min="0" max={hard - 1} value={v.p5 ?? 0}
            onChange={e => onChange({ p5: Math.max(0, Math.min(hard - 1, Math.floor(Number(e.target.value) || 0))) })}
            className="mt-0.5 w-full px-2 py-1 text-[11px] rounded bg-black/30 border border-white/10 text-white tabular-nums focus:outline-none" />
        </label>
        <label className="block">
          <span className="text-[10px] text-white/45">距上次四星（0–9）</span>
          <input type="number" min="0" max="9" value={v.p4 ?? 0}
            onChange={e => onChange({ p4: Math.max(0, Math.min(9, Math.floor(Number(e.target.value) || 0))) })}
            className="mt-0.5 w-full px-2 py-1 text-[11px] rounded bg-black/40 border border-white/10 text-white tabular-nums focus:outline-none" />
        </label>
      </div>
      {showChar && (
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-[10px] text-white/45">保底状态</span>
            <select value={v.guaranteed ?? 0} onChange={e => onChange({ guaranteed: Number(e.target.value) })}
              className="mt-0.5 w-full px-2 py-1 text-[11px] rounded bg-black/40 border border-white/10 text-white focus:outline-none">
              <option value={0}>小保底（50%）</option>
              <option value={1}>大保底（必得 UP）</option>
            </select>
          </label>
          <label className="block">
            <span className="text-[10px] text-white/45">捕获明光连保</span>
            <select value={v.crStreak ?? 0} onChange={e => onChange({ crStreak: Number(e.target.value) })}
              className="mt-0.5 w-full px-2 py-1 text-[11px] rounded bg-black/40 border border-white/10 text-white focus:outline-none">
              <option value={0}>0 次</option>
              <option value={1}>1 次</option>
              <option value={2}>2 次（47/47/6）</option>
              <option value={3}>3 次（下次必中）</option>
            </select>
          </label>
        </div>
      )}
      {showFate && (
        <label className="block">
          <span className="text-[10px] text-white/45">命定值</span>
          <select value={v.fate ?? 0} onChange={e => onChange({ fate: Number(e.target.value) })}
            className="mt-0.5 w-full px-2 py-1 text-[11px] rounded bg-black/40 border border-white/10 text-white focus:outline-none">
            <option value={0}>0（未定轨命中过）</option>
            <option value={1}>1（下次必得定轨目标）</option>
          </select>
        </label>
      )}
    </div>
  )
}

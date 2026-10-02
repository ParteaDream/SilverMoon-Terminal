/**
 * FoodCrawler.jsx — 食物爬虫的渲染进程内核（供开发者工具栏使用）
 *
 * 爬虫属于开发者工具栏的能力，因此这里只提供「逻辑 + 查漏弹窗」，
 * 进度面板复用 DevToolbar 里那套通用的 CrawlerPanel：
 *   · useFoodCrawler()    —— 任务队列 + 批量循环 + 落库（分块调用 crawl-foods，
 *                            wiki 请求按块合并，比逐条快得多）
 *   · FoodLeakCheckModal  —— 查漏补缺：分组列出「未收录 / 缺烹饪材料 / 形态不全 /
 *                            缺图片简介」，勾选后批量补爬
 *
 * 爬取结果统一走 utils/foodCrawlSave.mjs 落库。
 */
import { useState, useRef, useCallback, useMemo, useEffect } from 'react'
import {
  X, Loader2, CheckCircle2, Search, PackageX, Images, Layers, RefreshCw, Utensils, Link2,
} from 'lucide-react'
import { useDb } from '../context/DbContext'
import useOverlay from '../hooks/useOverlay'
import { saveFoodData, collectFoodIcons } from '../utils/foodCrawlSave.mjs'

// 每次 IPC 批量的条目数：够快（wiki 一次请求最多 40 个标题）又不至于让进度条长时间不动
const CRAWL_CHUNK = 8

export function useFoodCrawler({ onSaved } = {}) {
  const { query, crawlFoods, downloadFoodImages } = useDb()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('食物爬虫')
  const [tasks, setTasks] = useState([])
  const [running, setRunning] = useState(false)
  const [paused, setPaused] = useState(false)
  const [current, setCurrent] = useState(null)
  const [summary, setSummary] = useState(null)
  const runningRef = useRef(false)
  const pausedRef = useRef(false)
  const onSavedRef = useRef(onSaved)
  onSavedRef.current = onSaved

  const pause = useCallback(() => { pausedRef.current = true; setPaused(true) }, [])
  const resume = useCallback(() => { pausedRef.current = false; setPaused(false) }, [])
  const stop = useCallback(() => {
    runningRef.current = false
    pausedRef.current = false
    setPaused(false)
  }, [])

  const start = useCallback(async (list, opts = {}) => {
    if (runningRef.current) return
    const items = (list || []).filter(Boolean).map(t => ({
      id: t.id != null ? t.id : null,
      name: t.name || '',
      status: 'pending',
      message: '',
    }))
    if (items.length === 0) return

    setTitle(opts.title || '食物爬虫')
    setTasks(items)
    setSummary(null)
    setOpen(true)
    setRunning(true)
    runningRef.current = true
    pausedRef.current = false
    setPaused(false)

    let done = 0
    let failed = 0
    const savedIds = []

    try {
      for (let i = 0; i < items.length; i += CRAWL_CHUNK) {
        if (!runningRef.current) break
        while (pausedRef.current && runningRef.current) await new Promise(r => setTimeout(r, 200))
        if (!runningRef.current) break

        const chunk = items.slice(i, i + CRAWL_CHUNK)
        const last = i + chunk.length
        setCurrent(chunk[0])
        setTasks(prev => prev.map((t, idx) => (idx >= i && idx < last)
          ? { ...t, status: 'running', message: '爬取中…' } : t))

        let res
        try {
          res = await crawlFoods(
            chunk.map(t => ({ id: t.id, name: t.name })),
            { withWiki: opts.withWiki !== false }
          )
        } catch (e) {
          res = { success: false, error: e.message }
        }

        if (!res || !res.success) {
          const msg = (res && res.error) || '爬取失败'
          failed += chunk.length
          setTasks(prev => prev.map((t, idx) => (idx >= i && idx < last)
            ? { ...t, status: 'error', message: msg } : t))
          continue
        }

        const results = res.results || []
        const okResults = results.filter(r => r && r.success)
        // 先落图片：nanoka 的素材是 webp，落盘扩展名按内容嗅探，
        // 拿到「图标名 → 真实文件名」后才能把正确的文件名写进库。
        let imageNames = {}
        if (okResults.length > 0) {
          const icons = [...new Set(okResults.flatMap(r => collectFoodIcons(r.data)))]
          if (icons.length > 0) {
            try {
              const dl = await downloadFoodImages(icons)
              if (dl && dl.success && dl.files) imageNames = dl.files
            } catch (_) {}
          }
        }
        for (let k = 0; k < chunk.length; k++) {
          const idx = i + k
          const r = results[k]
          if (!r || !r.success) {
            failed++
            setTasks(prev => prev.map((t, j) => j === idx
              ? { ...t, status: 'error', message: (r && r.error) || '未找到该食物' } : t))
            continue
          }
          try {
            const out = await saveFoodData(query, r.data, { foodId: chunk[k].id, imageNames })
            done++
            if (out.foodId != null) savedIds.push(out.foodId)
            const detail = []
            if (out.variantCount > 0) detail.push(`${out.variantCount} 形态`)
            if (out.materialCount > 0) detail.push(`${out.materialCount} 材料`)
            setTasks(prev => prev.map((t, j) => j === idx
              ? { ...t, status: 'done', message: detail.length ? `完成 · ${detail.join(' / ')}` : '完成' } : t))
          } catch (e) {
            failed++
            setTasks(prev => prev.map((t, j) => j === idx
              ? { ...t, status: 'error', message: e.message || '写库失败' } : t))
          }
        }
      }
    } finally {
      setRunning(false)
      runningRef.current = false
      setPaused(false)
      pausedRef.current = false
      setCurrent(null)
      setSummary({ done, failed })
      if (onSavedRef.current) {
        try { await onSavedRef.current(savedIds) } catch (_) {}
      }
    }
  }, [query, crawlFoods, downloadFoodImages])

  return { open, setOpen, title, tasks, running, paused, current, summary, start, pause, resume, stop }
}

// 查漏分组的图标：按 key 内部映射，调用方只提供数据（computeFoodGaps 是纯数据模块）
const GAP_ICONS = {
  missing: PackageX,
  materials: Utensils,
  variants: Layers,
  special: Link2,
  assets: Images,
}

// ── 查漏补缺弹窗 ──
// groups: [{ key, label, hint, items: [{ id, name, reason }] }]
export function FoodLeakCheckModal({ isOpen, onClose, groups, loading, warning, onStart }) {
  const ov = useOverlay({ open: isOpen, onClose, label: '食物查漏补缺' })
  const [checked, setChecked] = useState(() => new Set())
  const [collapsed, setCollapsed] = useState(() => new Set())

  // 打开时默认全选。注意分组是异步到达的（弹窗先开、数据后到），
  // 所以签名里带上条目数：分组内容一变就重新全选，否则用户会看到"0 项已选"。
  const groupsSignature = useMemo(
    () => (groups || []).map(g => `${g.key}:${g.items.length}`).join('|'),
    [groups]
  )
  useEffect(() => {
    if (!isOpen) return
    setChecked(new Set((groups || []).flatMap(g => g.items.map(i => i.id))))
    setCollapsed(new Set())
  }, [isOpen, groupsSignature])

  const allItems = useMemo(() => (groups || []).flatMap(g => g.items), [groups])

  if (!isOpen) return null

  const toggle = (id) => setChecked(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  const toggleGroup = (g) => setChecked(prev => {
    const next = new Set(prev)
    const allOn = g.items.every(i => next.has(i.id))
    for (const i of g.items) { if (allOn) next.delete(i.id); else next.add(i.id) }
    return next
  })

  const totalGaps = allItems.length

  return (
    <div ref={ov.overlayRef} {...ov.overlayProps}
      className="fixed inset-0 z-[75] flex items-center justify-center bg-black/60 p-6"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="w-full max-w-2xl bg-surface-900 border border-surface-700 rounded-2xl shadow-2xl flex flex-col max-h-[80vh] animate-scale-in">
        <div className="flex items-center justify-between px-4 py-3 border-b border-surface-800">
          <div className="flex items-center gap-2">
            <Search className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-semibold">食物查漏补缺</h3>
            {!loading && <span className="text-xs text-surface-500">{groups.length} 类 · {totalGaps} 个条目待补</span>}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-surface-400 hover:text-white hover:bg-surface-800 transition-colors"><X className="w-4 h-4" /></button>
        </div>

        {warning && (
          <div className="mx-4 mt-3 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-300">{warning}</div>
        )}

        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
          {loading && (
            <div className="py-12 flex flex-col items-center gap-3 text-surface-400">
              <Loader2 className="w-6 h-6 animate-spin text-primary-400" />
              <span className="text-xs">正在比对 nanoka 线上数据…</span>
            </div>
          )}

          {!loading && totalGaps === 0 && (
            <div className="py-12 text-center text-surface-400 text-sm">
              <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-green-400" />
              食物数据已齐全，没有发现需要补充的条目
            </div>
          )}

          {!loading && groups.map(g => {
            const isCollapsed = collapsed.has(g.key)
            const onCount = g.items.filter(i => checked.has(i.id)).length
            const Icon = GAP_ICONS[g.key] || Search
            return (
              <div key={g.key} className="rounded-xl border border-surface-800 bg-surface-800/30 overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <button onClick={() => toggleGroup(g)}
                    className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors
                      ${onCount === g.items.length ? 'bg-primary-500 border-primary-500 text-white' : onCount > 0 ? 'bg-primary-500/40 border-primary-500/60 text-white' : 'border-surface-600'}`}
                    title="全选/全不选该组">
                    {onCount > 0 && <span className="text-[9px] font-bold">{onCount === g.items.length ? '✓' : '−'}</span>}
                  </button>
                  <Icon className="w-3.5 h-3.5 text-primary-400 flex-shrink-0" />
                  <span className="text-xs font-semibold">{g.label}</span>
                  <span className="text-[10px] text-surface-500">{g.items.length}</span>
                  <span className="text-[10px] text-surface-600 truncate flex-1">{g.hint}</span>
                  <button onClick={() => setCollapsed(prev => {
                    const next = new Set(prev); if (next.has(g.key)) next.delete(g.key); else next.add(g.key); return next
                  })} className="text-[10px] text-surface-500 hover:text-surface-200 transition-colors flex-shrink-0">
                    {isCollapsed ? '展开' : '收起'}
                  </button>
                </div>
                {!isCollapsed && (
                  <div className="max-h-56 overflow-y-auto border-t border-surface-800/60">
                    {g.items.map(item => (
                      <label key={item.id} className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-surface-800/50 cursor-pointer">
                        <input type="checkbox" checked={checked.has(item.id)} onChange={() => toggle(item.id)}
                          className="w-3.5 h-3.5 accent-primary-500 flex-shrink-0" />
                        <span className="text-xs text-surface-200 truncate flex-1">{item.name}</span>
                        <span className="text-[10px] text-surface-600 font-mono flex-shrink-0">{item.id}</span>
                        {item.reason && <span className="text-[10px] text-amber-400/80 flex-shrink-0">{item.reason}</span>}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t border-surface-800">
          <div className="flex items-center gap-3 text-[11px] text-surface-500">
            <button onClick={() => setChecked(new Set(allItems.map(i => i.id)))} className="hover:text-surface-200 transition-colors">全选</button>
            <button onClick={() => setChecked(new Set())} className="hover:text-surface-200 transition-colors">全不选</button>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs text-surface-400 hover:bg-surface-800 transition-colors">取消</button>
            <button
              onClick={() => {
                // 同一条目可能同时命中多个分组，按 id 去重后再交给爬虫
                const picked = []
                const seen = new Set()
                for (const i of allItems) {
                  if (!checked.has(i.id) || seen.has(i.id)) continue
                  seen.add(i.id)
                  picked.push(i)
                }
                onStart(picked)
              }}
              disabled={checked.size === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary-600 hover:bg-primary-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              开始补爬 ({checked.size})
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

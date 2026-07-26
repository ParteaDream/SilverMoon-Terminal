import { useState, useEffect, useCallback, useMemo } from 'react'
import { useDb } from '../context/DbContext'
import { useTerminal } from '../context/TerminalContext'
import {
  Globe, Loader2, Plus, Trash2, ArrowLeft, Star,
  Sparkles, RefreshCw, ChevronRight, List,
} from 'lucide-react'

const GACHA_TYPE_MAP = {
  100: { name: '新手祈愿', icon: '🌟', color: 'text-cyan-400', bg: 'bg-cyan-500/10' },
  200: { name: '常驻祈愿', icon: '⭐', color: 'text-amber-400', bg: 'bg-amber-500/10' },
  301: { name: '角色活动祈愿', icon: '👤', color: 'text-red-400', bg: 'bg-red-500/10' },
  302: { name: '武器活动祈愿', icon: '⚔️', color: 'text-purple-400', bg: 'bg-purple-500/10' },
  400: { name: '角色活动祈愿-2', icon: '👥', color: 'text-pink-400', bg: 'bg-pink-500/10' },
  500: { name: '集录祈愿', icon: '📜', color: 'text-orange-400', bg: 'bg-orange-500/10' },
}

const RANK_NAMES = { 3: '三星', 4: '四星', 5: '五星' }
const RANK_COLORS = { 3: 'text-blue-400', 4: 'text-purple-400', 5: 'text-amber-400' }
const RANK_BGS = { 3: 'bg-blue-500/10', 4: 'bg-purple-500/10', 5: 'bg-amber-500/10' }

/** 各类型统计展示顺序 */
const DISPLAY_ORDER = [301, 400, 302, 500, 200, 100]

export default function GachaStation() {
  const { query, readImage } = useDb()
  const { closeApp } = useTerminal()
  const [view, setView] = useState('home')
  const [archives, setArchives] = useState([])
  const [activeUid, setActiveUid] = useState(null)
  const [activeData, setActiveData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [fetching, setFetching] = useState(false)
  const [fetchProgress, setFetchProgress] = useState({ current: '', total: 0, done: 0, totalNew: 0 })
  const [error, setError] = useState('')
  const [needLogin, setNeedLogin] = useState(false)

  const loadArchives = useCallback(async () => {
    try {
      const r = await window.electronAPI?.gachaListArchives()
      if (r?.success) setArchives(r.archives || [])
    } catch (_) {}
  }, [])

  useEffect(() => { loadArchives() }, [loadArchives])
  useEffect(() => { if (error) { const t = setTimeout(() => setError(''), 8000); return () => clearTimeout(t) } }, [error])

  const handleFetch = useCallback(async (uid, server) => {
    setFetching(true)
    setFetchProgress({ current: '请扫码登录...', total: 6, done: 0, totalNew: 0 })
    setError('')
    setNeedLogin(false)
    // 未登录时自动弹二维码
    try {
      const loginR = await window.electronAPI?.gachaLogin()
      if (!loginR?.success) {
        setError(loginR?.error || '登录失败')
        setFetching(false)
        return
      }
      setNeedLogin(false)
    } catch (e) {
      setError(e.message)
      setFetching(false)
      return
    }
    setFetchProgress({ current: '正在生成 authkey...', total: 6, done: 0, totalNew: 0 })
    let cleanupListener
    try {
      cleanupListener = window.electronAPI?.onGachaFetchProgress?.(progress => {
        setFetchProgress(p => ({ ...p, current: progress.current, done: progress.done, total: progress.total }))
      })
      const r = await window.electronAPI?.gachaFetchAndSave(uid, server)
      if (!r?.success) {
        if (r?.needLogin) { setNeedLogin(true); setError('登录过期，请重新拉取') }
        else if (r?.needRelogin) { setNeedLogin(true); setError(r.error) }
        else setError(r?.error || '拉取失败')
        return
      }
      setFetchProgress(p => ({ ...p, current: `完成！新增 ${r.newItems} 条，共 ${r.totalItems} 条`, done: 6, totalNew: r.newItems }))
      setActiveUid(r.uid)
      await loadArchives()
      handleViewArchive(r.uid)
    } catch (e) {
      setError(e.message)
    } finally {
      setFetching(false)
      if (typeof cleanupListener === 'function') cleanupListener()
    }
  }, [loadArchives])

  const handleViewArchive = useCallback(async (uid) => {
    setLoading(true)
    setActiveUid(uid)
    try {
      const r = await window.electronAPI?.gachaGetArchive(uid)
      if (r?.success) {
        setActiveData({ archive: r.archive, stats: r.stats, items: r.items })
        setView('archive')
      } else setError(r?.error || '加载失败')
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [])

  const handleDelete = useCallback(async (uid) => {
    if (!confirm(`删除 UID ${uid} 的祈愿档案？`)) return
    await window.electronAPI?.gachaDeleteArchive(uid)
    if (activeUid === uid) { setView('home'); setActiveUid(null); setActiveData(null) }
    await loadArchives()
  }, [activeUid, loadArchives])

  return (
    <div className="flex flex-col h-full bg-surface-900/95 text-surface-100 select-none" style={{ fontSize: 'clamp(10px,0.7vw + 6px,16px)' }}>
      {error && (
        <div className="mx-3 mt-1 px-2 py-1 rounded-lg text-[10px] flex items-center gap-1"
          style={{ background: needLogin ? 'rgba(59,130,246,0.1)' : 'rgba(239,68,68,0.1)', border: needLogin ? '1px solid rgba(59,130,246,0.2)' : '1px solid rgba(239,68,68,0.2)', color: needLogin ? '#60a5fa' : '#f87171' }}>
          {needLogin && <span className="flex-1">{error}</span>}
          {!needLogin && error}
          {needLogin && (
              <button onClick={() => handleFetch(null, null)} disabled={fetching}
                className="px-2 py-0.5 rounded text-[9px] bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 disabled:opacity-50">
                {fetching ? <Loader2 className="w-2.5 h-2.5 animate-spin inline" /> : '扫码登录'}
              </button>
          )}
        </div>
      )}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          {fetching && <FetchView progress={fetchProgress} />}
          {!fetching && loading && (
            <div className="flex flex-col items-center justify-center py-16 gap-2">
              <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
              <span className="text-xs text-surface-500">加载中...</span>
            </div>
          )}
          {!fetching && !loading && view === 'home' && (
            <HomePage
              archives={archives}
              onFetch={handleFetch}
              onDelete={handleDelete}
              onSelect={handleViewArchive}
              loading={fetching}
            />
          )}
          {!fetching && !loading && view === 'archive' && activeData && (
            <ArchiveView
              data={activeData}
              query={query}
              readImage={readImage}
              onBack={() => { setView('home'); setActiveUid(null); setActiveData(null) }}
              onRefresh={() => handleFetch(activeUid)}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function FetchView({ progress }) {
  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 px-6">
      <div className="flex items-center gap-2 text-surface-400">
        <Loader2 className="w-5 h-5 animate-spin text-blue-400" />
        <span className="text-[11px]">{progress.current}</span>
      </div>
      <div className="w-full max-w-xs">
        <div className="h-2 rounded-full bg-surface-700 overflow-hidden">
          <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-blue-400 transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>
        <div className="flex justify-between mt-1 text-[8px] text-surface-500">
          <span>{progress.done}/{progress.total} 类型</span>
          <span>{progress.totalNew > 0 ? `新增 ${progress.totalNew} 条` : ''}</span>
        </div>
      </div>
    </div>
  )
}

function HomePage({ archives, onFetch, onDelete, onSelect, loading }) {
  const [showAll, setShowAll] = useState(false)
  const displayArchives = showAll ? archives : archives.slice(0, 5)

  if (!archives.length) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500/20 to-cyan-700/20 border border-blue-500/30 flex items-center justify-center">
          <Star className="w-6 h-6 text-blue-400" />
        </div>
        <p className="text-[10px] text-surface-500">还没有祈愿数据</p>
        <button onClick={() => onFetch(null, null)} disabled={loading}
          className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-[10px] flex items-center gap-1">
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Globe className="w-3 h-3" />}
          拉取祈愿数据
        </button>
      </div>
    )
  }

  return (
    <div className="p-3 space-y-1.5 max-w-md mx-auto">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[9px] text-surface-500">{archives.length} 个祈愿档案</span>
        <button onClick={() => onFetch(null, null)} disabled={loading}
          className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 disabled:opacity-50">
          {loading ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <RefreshCw className="w-2.5 h-2.5" />}
          拉取
        </button>
      </div>
      {displayArchives.map(acc => (
        <div key={acc.uid} onClick={() => onSelect(acc.uid)}
          className="flex items-center gap-2.5 p-2 rounded-lg bg-surface-800/40 border border-surface-700/30 hover:border-blue-500/30 hover:bg-surface-800/60 cursor-pointer group">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500/20 to-cyan-700/20 border border-blue-500/30 flex items-center justify-center shrink-0">
            <Star className="w-4 h-4 text-blue-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1">
              <span className="text-[11px] font-semibold truncate">{acc.nickname || `UID ${acc.uid}`}</span>
              <span className="text-[8px] px-1 py-0 rounded bg-surface-700/50 text-surface-400">{acc.item_count || 0} 条</span>
            </div>
            <div className="text-[9px] text-surface-500">UID {acc.uid} · {acc.updated_at?.slice(0, 10) || '未知'}</div>
          </div>
          <button onClick={e => { e.stopPropagation(); onFetch(acc.uid) }} disabled={loading}
            className="p-0.5 rounded text-surface-500 hover:text-blue-400 hover:bg-blue-500/10 opacity-0 group-hover:opacity-100 transition-opacity" title="更新">
            <RefreshCw className="w-2.5 h-2.5" />
          </button>
          <button onClick={e => { e.stopPropagation(); onDelete(acc.uid) }}
            className="p-0.5 rounded text-surface-500 hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-opacity">
            <Trash2 className="w-2.5 h-2.5" />
          </button>
        </div>
      ))}
      {archives.length > 5 && (
        <button onClick={() => setShowAll(!showAll)}
          className="w-full text-center text-[9px] text-surface-500 hover:text-surface-300 py-1">
          {showAll ? '收起' : `查看全部 ${archives.length} 个档案`}
        </button>
      )}
    </div>
  )
}

function ArchiveView({ data, query, readImage, onBack, onRefresh }) {
  const { archive, stats, items } = data
  const [detailGachaType, setDetailGachaType] = useState(null)
  const [nameImageMap, setNameImageMap] = useState({})

  // 加载 name→image 映射
  useEffect(() => {
    const load = async () => {
      const map = {}
      try {
        const chars = await query("SELECT name_zh, card_art FROM characters WHERE card_art IS NOT NULL")
        for (const c of (chars.data || [])) map[c.name_zh] = { image: c.card_art, type: 'character' }
        const wpns = await query("SELECT name_zh, simple_art FROM weapons WHERE simple_art IS NOT NULL")
        for (const w of (wpns.data || [])) {
          if (!map[w.name_zh]) map[w.name_zh] = { image: w.simple_art, type: 'weapon' }
        }
      } catch (_) {}
      setNameImageMap(map)
    }
    load()
  }, [query])

  // 按类型、星级统计
  const typeStats = {}
  const rankTotals = { 3: 0, 4: 0, 5: 0 }
  for (const s of stats || []) {
    const t = s.gacha_type; const r = s.rank_type
    if (!typeStats[t]) typeStats[t] = { total: 0, ranks: {} }
    typeStats[t].total += s.cnt
    typeStats[t].ranks[r] = s.cnt
    if (r >= 3 && r <= 5) rankTotals[r] = (rankTotals[r] || 0) + s.cnt
  }
  const totalAll = Object.values(typeStats).reduce((s, t) => s + t.total, 0)
  const GACHA_TYPE_KEYS = Object.keys(GACHA_TYPE_MAP).map(Number)

  // 如果有选中的卡池类型，显示详情页
  if (detailGachaType !== null) {
    return (
      <TypeDetailView
        uid={archive.uid}
        gachaType={detailGachaType}
        meta={GACHA_TYPE_MAP[detailGachaType]}
        nameImageMap={nameImageMap}
        readImage={readImage}
        query={query}
        onBack={() => setDetailGachaType(null)}
      />
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* 顶部导航 */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-surface-700/30 shrink-0">
        <button onClick={onBack} className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] text-surface-400 hover:text-surface-200 hover:bg-surface-800/40">
          <ArrowLeft className="w-3 h-3" />档案列表
        </button>
        <div className="flex-1" />
        <span className="text-[9px] text-surface-500">{archive.uid}</span>
        {archive.nickname && <span className="text-[9px] text-surface-400 ml-1">· {archive.nickname}</span>}
        <button onClick={onRefresh} className="ml-2 flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] bg-blue-600/20 text-blue-400 hover:bg-blue-600/30">
          <RefreshCw className="w-2.5 h-2.5" />更新
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {/* 总览卡片 */}
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: '总祈愿', value: totalAll, icon: Star, color: 'text-blue-400' },
            { label: '五星', value: rankTotals[5] || 0, icon: Sparkles, color: 'text-amber-400' },
            { label: '四星', value: rankTotals[4] || 0, icon: Sparkles, color: 'text-purple-400' },
            { label: '三星', value: rankTotals[3] || 0, icon: Sparkles, color: 'text-blue-400' },
          ].map((c, i) => (
            <div key={i} className="rounded-lg bg-surface-800/40 border border-surface-700/30 p-2 text-center">
              <c.icon className={`w-4 h-4 ${c.color} mx-auto mb-0.5`} />
              <div className="text-sm font-bold text-surface-200">{c.value}</div>
              <div className="text-[8px] text-surface-500">{c.label}</div>
            </div>
          ))}
        </div>

        {/* 各类型统计 — 点击进入详情 */}
        <div className="rounded-lg bg-surface-800/40 border border-surface-700/30 p-2.5">
          <h4 className="text-[10px] font-semibold text-surface-400 mb-2">各类型统计</h4>
          <div className="space-y-1.5">
            {DISPLAY_ORDER.map(gt => {
              const meta = GACHA_TYPE_MAP[gt]
              const ts = typeStats[gt]
              if (!ts || !ts.total) return null
              const r5 = ts.ranks[5] || 0; const r4 = ts.ranks[4] || 0
              return (
                <button key={gt} onClick={() => setDetailGachaType(gt)}
                  className="w-full flex items-center gap-2 p-1.5 rounded-lg bg-surface-800/30 hover:bg-surface-800/50 hover:border-blue-500/30 border border-transparent transition-all text-left">
                  <span className="text-base shrink-0">{meta.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-semibold truncate">{meta.name}</span>
                      <span className="text-[9px] text-surface-400">{ts.total} 次</span>
                    </div>
                    <div className="flex gap-2 text-[8px] mt-0.5">
                      {r5 > 0 && <span className="text-amber-400">★{r5}</span>}
                      {r4 > 0 && <span className="text-purple-400">★{r4}</span>}
                    </div>
                  </div>
                  <ChevronRight className="w-3 h-3 text-surface-500 shrink-0" />
                </button>
              )
            })}
          </div>
        </div>

        {/* 更新时间 */}
        <div className="text-[7px] text-surface-600 text-center">
          点击上面的卡池类型查看详细抽卡记录 · 最近更新: {archive.updated_at?.slice(0, 19) || '未知'}
        </div>
      </div>
    </div>
  )
}

// ─── 卡池详情页：五星时间线 + 条形图 ───
function TypeDetailView({ uid, gachaType, meta, nameImageMap, readImage, query, onBack }) {
  const [items, setItems] = useState([])
  const [stats, setStats] = useState([])
  const [loading, setLoading] = useState(true)
  const [showDetail, setShowDetail] = useState(false)
  const [imgMap, setImgMap] = useState({})

  // 加载该类型的所有祈愿记录
  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const r = await window.electronAPI?.gachaGetItemsByType(uid, gachaType)
        if (r?.success) {
          setItems(r.items || [])
          setStats(r.stats || [])
        }
      } catch (_) {}
      setLoading(false)
    }
    load()
  }, [uid, gachaType])

  // 计算五星时间线（含末尾未完成的虚记录）
  const timeline = useMemo(() => {
    const result = []
    let prev5Idx = -1
    for (let i = 0; i < items.length; i++) {
      if (Number(items[i].rank_type) === 5) {
        const pulls = prev5Idx === -1 ? i + 1 : i - prev5Idx
        result.push({ item: items[i], pulls, index: i })
        prev5Idx = i
      }
    }
    // 最后一个五星后还有未出五星的记录 → 虚记录
    if (prev5Idx !== -1 && prev5Idx < items.length - 1) {
      const trailingPulls = items.length - 1 - prev5Idx
      result.push({ item: null, pulls: trailingPulls, index: items.length - 1, isPending: true })
    }
    // 完全没有任何五星 → 全部记录归为一条虚记录
    if (prev5Idx === -1 && items.length > 0) {
      result.push({ item: null, pulls: items.length, index: items.length - 1, isPending: true })
    }
    return result
  }, [items])

  // 图片懒加载（五星时间线 + 详情列表中的非五星）
  useEffect(() => {
    if (!timeline.length && !showDetail) return
    let cancelled = false
    const load = async () => {
      const m = { ...imgMap }
      const toLoad = new Set()
      // 收集需要加载图片的物品名
      for (const entry of timeline) {
        if (entry.item && !m[entry.item.name]) toLoad.add(entry.item.name)
      }
      if (showDetail) {
        for (const item of items) {
          if (!m[item.name]) toLoad.add(item.name)
        }
      }
      for (const name of toLoad) {
        if (cancelled) return
        const info = nameImageMap[name]
        if (info?.image) {
          try {
            const data = await readImage(info.image)
            if (data && !cancelled) m[name] = data
          } catch {}
        }
      }
      if (!cancelled) {
        const hasNew = Object.keys(m).length !== Object.keys(imgMap).length
        if (hasNew) setImgMap(m)
      }
    }
    load()
    return () => { cancelled = true }
  }, [timeline, nameImageMap, readImage, showDetail, items])

  // 统计
  const statMap = {}
  for (const s of stats) statMap[s.rank_type] = s.cnt
  const total = items.length
  const r5 = statMap[5] || 0
  const r4 = statMap[4] || 0
  const r3 = statMap[3] || 0

  // 渲染条形的颜色
  const getBarStyle = (pulls) => {
    if (pulls >= 73) return { background: '#3b82f6', borderRadius: '4px' } // 蓝
    if (pulls >= 31) return { background: '#f59e0b', borderRadius: '4px' } // 金
    // 1-30: 炫彩流光
    return { background: 'linear-gradient(90deg, #ef4444, #f59e0b, #22c55e, #3b82f6, #a855f7, #ef4444)', backgroundSize: '400% 100%', animation: 'shimmerFlow 2s linear infinite', borderRadius: '4px' }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-16">
        <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
      </div>
    )
  }

  // 反向显示（最新在顶）
  const reversedTimeline = [...timeline].reverse()

  return (
    <div className="flex flex-col h-full">
      {/* 顶部导航 */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-surface-700/30 shrink-0">
        <button onClick={onBack} className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] text-surface-400 hover:text-surface-200 hover:bg-surface-800/40">
          <ArrowLeft className="w-3 h-3" />返回概览
        </button>
        <div className="flex-1" />
        <span className="text-[9px] text-surface-400">{meta?.icon}</span>
        <span className="text-[10px] font-semibold">{meta?.name}</span>
        <span className="text-[8px] text-surface-500 ml-1">UID {uid}</span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* 统计行 */}
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: '总祈愿', value: total, color: 'text-blue-400' },
            { label: '五星', value: r5, color: 'text-amber-400' },
            { label: '四星', value: r4, color: 'text-purple-400' },
            { label: '三星', value: r3, color: 'text-surface-400' },
          ].map((c, i) => (
            <div key={i} className="rounded-lg bg-surface-800/40 border border-surface-700/30 p-2 text-center">
              <div className={`text-sm font-bold ${c.color}`}>{c.value}</div>
              <div className="text-[8px] text-surface-500">{c.label}</div>
            </div>
          ))}
        </div>

        {/* 五星时间线 */}
        {items.length > 0 && (
          <div className="flex justify-end">
            <button onClick={() => setShowDetail(!showDetail)}
              className="flex items-center gap-0.5 px-2 py-0.5 rounded text-[9px] bg-surface-700/50 text-surface-400 hover:text-surface-200 hover:bg-surface-600/50">
              <List className="w-2.5 h-2.5" />{showDetail ? '隐藏详情' : '详情'}
            </button>
          </div>
        )}
        {reversedTimeline.length > 0 && (
          <div className="rounded-lg bg-surface-800/40 border border-surface-700/30 p-2.5">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-[10px] font-semibold text-surface-400">五星时间线</h4>
            </div>

            <div className="space-y-1.5">
              {reversedTimeline.map((entry, idx) => {
                const pct = Math.min(entry.pulls / 90 * 100, 100)
                if (entry.isPending) {
                  return (
                    <div key="pending" className="flex items-center gap-2 py-1">
                      <div className="w-7 h-7 shrink-0 rounded-full bg-surface-700/50 flex items-center justify-center border border-dashed border-surface-500 text-surface-500 text-xs">?</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-[9px] font-semibold text-surface-500">???</span>
                          <span className="text-[11px] font-bold text-surface-200 bg-surface-700/50 px-1.5 py-0.5 rounded">{entry.pulls} 抽</span>
                        </div>
                        <div className="h-2 rounded-full bg-surface-700/50 overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: '#3b82f6', borderRadius: '4px' }} />
                        </div>
                      </div>
                    </div>
                  )
                }
                const rankBg = RANK_COLORS[entry.item.rank_type] || 'text-surface-300'
                const imgSrc = imgMap[entry.item.name]
                const isWeapon = nameImageMap[entry.item.name]?.type === 'weapon'

                return (
                  <div key={entry.item.id} className="flex items-center gap-2 py-1">
                    <div className="w-7 h-7 shrink-0 rounded-full bg-surface-700/50 overflow-hidden flex items-center justify-center border border-surface-600">
                      {imgSrc ? (
                        <img src={imgSrc} alt="" className={`w-full h-full object-cover ${isWeapon ? 'p-0.5' : ''}`} />
                      ) : (
                        <span className="text-xs">{meta?.icon || '⭐'}</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className={`text-[9px] font-semibold truncate ${rankBg}`}>{entry.item.name}</span>
                        <span className="text-[11px] font-bold text-surface-200 bg-surface-700/50 px-1.5 py-0.5 rounded">{entry.pulls} 抽</span>
                      </div>
                      <div className="h-2 rounded-full bg-surface-700/50 overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, ...getBarStyle(entry.pulls) }} />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {reversedTimeline.length === 0 && (
          <div className="rounded-lg bg-surface-800/40 border border-surface-700/30 p-6 text-center">
            <p className="text-[10px] text-surface-500">暂无五星记录</p>
          </div>
        )}

        {/* 详情列表（折叠） */}
        {showDetail && (
          <div className="rounded-lg bg-surface-800/40 border border-surface-700/30 p-2.5">
            <h4 className="text-[10px] font-semibold text-surface-400 mb-2">逐条记录</h4>
            <div className="space-y-0.5 max-h-80 overflow-y-auto"
              style={{ scrollbarWidth: 'thin', scrollbarColor: '#6b7280 #1f2937' }}>
              {[...items].reverse().map(item => {
                const rankColor = RANK_COLORS[item.rank_type] || 'text-surface-300'
                const rankBg = RANK_BGS[item.rank_type] || 'bg-surface-800/50'
                const imgSrc = imgMap[item.name]
                const isWeapon = nameImageMap[item.name]?.type === 'weapon'

                return (
                  <div key={item.id}
                    className={`flex items-center gap-2 p-1.5 rounded ${rankBg} border border-transparent hover:border-surface-600/50 transition-colors`}>
                    <div className="w-6 h-6 shrink-0 rounded-full bg-surface-700/50 overflow-hidden flex items-center justify-center border border-surface-600">
                      {imgSrc ? (
                        <img src={imgSrc} alt="" className={`w-full h-full object-cover ${isWeapon ? 'p-0.5' : ''}`} />
                      ) : (
                        <span className="text-[10px]">{GACHA_TYPE_MAP[item.gacha_type]?.icon || '🎯'}</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1">
                        <span className={`text-[10px] font-semibold ${rankColor}`}>{item.name}</span>
                        <span className={`text-[8px] ${rankColor}`}>{'★'.repeat(item.rank_type || 0)}</span>
                        {item.item_type && <span className="text-[7px] text-surface-500">{item.item_type}</span>}
                      </div>
                      <div className="text-[8px] text-surface-500">{item.time?.slice(0, 16) || ''}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* 更新时间 */}
        <div className="text-[7px] text-surface-600 text-center">{total} 条记录</div>
      </div>
    </div>
  )
}

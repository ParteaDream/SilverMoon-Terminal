import { useState, useEffect, useCallback, useRef, useMemo, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  Plus, ArrowLeft, Landmark, Calendar, Trash2, Banknote, TrendingUp,
  ChevronLeft, ChevronRight, ChevronDown, LayoutGrid, List,
  Sparkle, RefreshCw, Check, Loader2, X, Star, Search,
} from 'lucide-react'
import WishAnalysis from './WishAnalysis'
import WishGallery from './WishGallery'
import useOverlay from '../hooks/useOverlay'
import { useLazyImage } from '../hooks/useLazyImage'
import { useDb } from '../context/DbContext'
import { PITY_GROUPS, buildPityIndex, pityAtDate, pityRangeAtDate, sumPity } from '../utils/pityAtDate'

// ═══════════════════════════════════════
// 常量
// ═══════════════════════════════════════

const MATERIALS = [
  { key: 'primogems', label: '原石', imgFile: 'UI_ItemIcon_201.webp', color: 'text-blue-300', bg: 'bg-blue-500/10', border: 'border-blue-500/30' },
  { key: 'intertwinedFates', label: '纠缠之缘', imgFile: 'UI_ItemIcon_223.webp', color: 'text-pink-300', bg: 'bg-pink-500/10', border: 'border-pink-500/30' },
  { key: 'genesisCrystals', label: '创世结晶', imgFile: 'UI_ItemIcon_203.webp', color: 'text-blue-500', bg: 'bg-amber-500/10', border: 'border-amber-500/30' },
  { key: 'starglitter', label: '星辉', imgFile: 'UI_ItemIcon_221.webp', color: 'text-yellow-300', bg: 'bg-yellow-500/10', border: 'border-yellow-500/30' },
]

// ── 已垫抽数联动（北国银行 × 祈愿捕捉站）──
/** 设置持久化在 user.json 的键名 */
const PITY_SETTINGS_KEY = 'northlandbank_pity'
/** 默认关闭；档案为空时首次需选择 */
const DEFAULT_PITY_SETTINGS = {
  enabled: false,
  uid: '',
  selected: { character: true, weapon: true, chronicled: true },
}
/** 本期祈愿记录需要展示全部卡池类型（已垫抽数索引由 PITY_GROUPS 决定，只取其中四类） */
const GACHA_FETCH_TYPES = [100, 200, 301, 302, 400, 500]
/** 卡池展示元数据（与祈愿捕捉站一致） */
const GACHA_TYPE_META = {
  100: { name: '新手祈愿', icon: '🌟', color: 'text-cyan-400' },
  200: { name: '常驻祈愿', icon: '⭐', color: 'text-amber-400' },
  301: { name: '角色活动祈愿', icon: '👤', color: 'text-red-400' },
  302: { name: '武器活动祈愿', icon: '⚔️', color: 'text-purple-400' },
  400: { name: '角色活动祈愿-2', icon: '👥', color: 'text-pink-400' },
  500: { name: '集录祈愿', icon: '📜', color: 'text-orange-400' },
}
const RANK_COLORS = { 3: 'text-blue-400', 4: 'text-purple-400', 5: 'text-amber-400' }
const RANK_BGS = { 3: 'bg-blue-500/10', 4: 'bg-purple-500/10', 5: 'bg-amber-500/10' }

// 祈愿记录时间换算：数据库存 'YYYY-MM-DD HH:MM:SS'（本地时间）
function gachaTimeMs(item) {
  const v = String(item?.time || '').replace(' ', 'T')
  const t = new Date(v).getTime()
  return Number.isNaN(t) ? NaN : t
}
function dateEndMs(dateStr) {
  const t = new Date(`${dateStr}T23:59:59.999`).getTime()
  return Number.isNaN(t) ? Infinity : t
}
function dateStartMs(dateStr) {
  const t = new Date(`${dateStr}T00:00:00`).getTime()
  return Number.isNaN(t) ? -Infinity : t
}
function fmtDateTime(ms) {
  if (ms === -Infinity) return '起始'
  if (ms === Infinity) return '最新'
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
// 合并全部卡池记录并按时间（同刻按 id）升序
function buildFlatGachaItems(byType) {
  const all = []
  for (const type of GACHA_FETCH_TYPES) {
    for (const item of (byType?.[type] || [])) all.push(item)
  }
  all.sort((a, b) => {
    const ta = String(a?.time || '')
    const tb = String(b?.time || '')
    if (ta < tb) return -1
    if (ta > tb) return 1
    const ia = String(a?.id || '')
    const ib = String(b?.id || '')
    if (ia.length !== ib.length) return ia.length < ib.length ? -1 : 1
    if (ia === ib) return 0
    return ia < ib ? -1 : 1
  })
  return all
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function todayStr() {
  const d = new Date()
  return fmtDate(d)
}

function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function loadRecords() {
  try {
    const res = await window.electronAPI?.northlandbankLoadRecords()
    return res || []
  } catch { return [] }
}

async function saveRecords(records) {
  try {
    await window.electronAPI?.northlandbankSaveRecords(records)
  } catch { /* ignore */ }
}

// 首次加载时，检查并迁移 user.json 中的旧数据
let _migrationDone = false
async function migrateIfNeeded() {
  if (_migrationDone) return
  _migrationDone = true
  try {
    const res = await window.electronAPI?.northlandbankMigrateFromJson()
    if (res?.migrated > 0) console.log('[NorthlandBank] 已从 user.json 迁移', res.migrated, '条记录到 user.db')
  } catch { /* ignore */ }
}

// ═══════════════════════════════════════
// 差额换算
// ═══════════════════════════════════════
function calcDiff(prev, curr) {
  // 消耗 = 上一期 - 当前期（正数表示消耗）
  const dPrimo = (prev?.primogems || 0) - (curr?.primogems || 0)
  const dFates = (prev?.intertwinedFates || 0) - (curr?.intertwinedFates || 0)
  const dGenesis = (prev?.genesisCrystals || 0) - (curr?.genesisCrystals || 0)
  const dGlitter = (prev?.starglitter || 0) - (curr?.starglitter || 0)

  // 创世结晶 → 原石 (1:1)
  const totalPrimo = dPrimo + dGenesis

  // 原石 → 纠缠之缘 (160:1)
  const fatesFromPrimo = Math.floor(totalPrimo / 160)
  const leftoverPrimo = totalPrimo % 160

  // 星辉 → 纠缠之缘 (5:1)
  const fatesFromGlitter = Math.floor(dGlitter / 5)
  const leftoverGlitter = dGlitter % 5

  return {
    dPrimo, dFates, dGenesis, dGlitter,
    fatesFromPrimo, leftoverPrimo,
    fatesFromGlitter, leftoverGlitter,
    totalFates: dFates + fatesFromPrimo + fatesFromGlitter,
    isConsumption: totalPrimo > 0 || dFates > 0 || dGlitter > 0,
    isIncrease: totalPrimo < 0 || dFates < 0 || dGlitter < 0,
    isZero: totalPrimo === 0 && dFates === 0 && dGlitter === 0,
  }
}

// ═══════════════════════════════════════
// 汇总一条记录里全部变化原因备注（按发生顺序）
// diffNotes 以「第几期-第几期」为 key，历史数据可能按序号或 seq 写入，两种都兼容
// ═══════════════════════════════════════
function collectDiffNotes(record) {
  const notes = record?.diffNotes || {}
  const periods = [...(record?.periods || [])].sort((a, b) => (a.seq || 0) - (b.seq || 0))
  const list = []
  for (let i = 1; i < periods.length; i++) {
    const raw = notes[`${i}-${i + 1}`] ?? notes[`${periods[i - 1].seq}-${periods[i].seq}`]
    const note = typeof raw === 'string' ? raw.trim() : ''
    if (note) list.push({ prevSeq: i, currSeq: i + 1, note })
  }
  return list
}

// ═══════════════════════════════════════
// 纠缠之缘换算（把四种货币折算为以纠缠之缘为单位的等价数）
// ═══════════════════════════════════════
function periodToFates(period) {
  const primogems = period?.primogems || 0
  const fates = period?.intertwinedFates || 0
  const genesisCrystals = period?.genesisCrystals || 0
  const starglitter = period?.starglitter || 0
  const totalPrimo = primogems + genesisCrystals // 创世结晶 → 原石 (1:1)
  const fatesFromPrimo = Math.floor(totalPrimo / 160) // 原石 → 纠缠之缘 (160:1)
  const leftoverPrimo = totalPrimo % 160
  const fatesFromGlitter = Math.floor(starglitter / 5) // 星辉 → 纠缠之缘 (5:1)
  const leftoverGlitter = starglitter % 5
  return {
    fates: fates + fatesFromPrimo + fatesFromGlitter,
    leftoverPrimo,
    leftoverGlitter,
  }
}

// 构建某月日历格子（周一为一周之始，首尾不足 7 个用 null 补齐）
function buildMonthCells(year, month) {
  const first = new Date(year, month, 1)
  const startOffset = (first.getDay() + 6) % 7
  const days = new Date(year, month + 1, 0).getDate()
  const cells = []
  for (let i = 0; i < startOffset; i++) cells.push(null)
  for (let d = 1; d <= days; d++) cells.push(new Date(year, month, d))
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

// ═══════════════════════════════════════
// 主组件
// ═══════════════════════════════════════
export default function NorthlandBank() {
  const [view, setView] = useState('list')
  const [viewMode, setViewMode] = useState('list') // 列表 / 日历
  const [records, setRecords] = useState([])
  const [selectedRecord, setSelectedRecord] = useState(null)
  const [analysisPeriod, setAnalysisPeriod] = useState(null) // 祈愿分析所选的收支明细
  const [loading, setLoading] = useState(true)
  // 视图位置：日历所在月份 / 列表滚动位置 —— 提升到此处，打开明细返回后不丢失
  const [calendarCursor, setCalendarCursor] = useState(() => {
    const now = new Date()
    return { y: now.getFullYear(), m: now.getMonth() }
  })
  const listScrollRef = useRef(0)

  // ── 已垫抽数联动状态（设置持久化在 user.json）──
  const [pitySettings, setPitySettings] = useState(DEFAULT_PITY_SETTINGS)
  const [archives, setArchives] = useState([])
  const [pityIndex, setPityIndex] = useState(null)
  const [pityLoading, setPityLoading] = useState(false)
  const [pityFetchedAt, setPityFetchedAt] = useState(null)
  const [pityPanelOpen, setPityPanelOpen] = useState(false)
  const [pityRefreshTick, setPityRefreshTick] = useState(0)
  const pityAutoPromptedRef = useRef(false)
  const [gachaItems, setGachaItems] = useState(null)   // 全部卡池原始记录（升序）
  const [wishRecord, setWishRecord] = useState(null)   // 查看当日全部祈愿记录（每条记录一个）
  const gachaLoadedRef = useRef({ uid: null, tick: -1 })

  // 首次加载：记录 + 已垫抽数设置 + 祈愿档案列表
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      await migrateIfNeeded()
      const [recs, cfgRes, archRes] = await Promise.all([
        loadRecords(),
        window.electronAPI?.getUserConfig?.(),
        window.electronAPI?.gachaListArchives?.(),
      ])
      if (cancelled) return
      setRecords(recs)
      const saved = cfgRes?.config?.[PITY_SETTINGS_KEY]
      if (saved && typeof saved === 'object') {
        setPitySettings(prev => ({
          ...prev,
          ...saved,
          selected: { ...prev.selected, ...(saved.selected || {}) },
        }))
      }
      setArchives(archRes?.success ? (archRes.archives || []) : [])
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [])

  // 首次打开且尚未选择档案时，自动弹出设置面板要求选择（每会话一次）
  useEffect(() => {
    if (loading || pityAutoPromptedRef.current) return
    if (pitySettings.uid) { pityAutoPromptedRef.current = true; return }
    if (!archives.length) return
    pityAutoPromptedRef.current = true
    setPityPanelOpen(true)
  }, [loading, archives.length, pitySettings.uid])

  // 拉取祈愿记录：构建「按日推算已垫抽数」索引，并保留原始记录供「当日祈愿记录」查看。
  // 只要已关联档案就加载，以便判断哪些收支记录存在祈愿记录（决定按钮/实心四芒星是否出现）。
  useEffect(() => {
    const uid = pitySettings.uid
    if (!uid) { setPityIndex(null); setPityFetchedAt(null); setGachaItems(null); return }
    const loaded = gachaLoadedRef.current
    if (loaded.uid === uid && loaded.tick === pityRefreshTick) return
    let cancelled = false
    setPityLoading(true)
    ;(async () => {
      const res = await Promise.all(GACHA_FETCH_TYPES.map(t => window.electronAPI?.gachaGetItemsByType(uid, t)))
      if (cancelled) return
      const byType = {}
      GACHA_FETCH_TYPES.forEach((t, i) => { byType[t] = res[i]?.success ? (res[i].items || []) : [] })
      setGachaItems(buildFlatGachaItems(byType))
      setPityIndex(buildPityIndex(byType))
      setPityFetchedAt(Date.now())
      gachaLoadedRef.current = { uid, tick: pityRefreshTick }
      setPityLoading(false)
    })().catch(() => { if (!cancelled) { setPityIndex(null); setGachaItems(null); setPityLoading(false) } })
    return () => { cancelled = true }
  }, [pitySettings.uid, pityRefreshTick])

  const updatePitySettings = useCallback((patch) => {
    setPitySettings(prev => {
      const next = { ...prev, ...patch }
      window.electronAPI?.setUserConfig?.(PITY_SETTINGS_KEY, next)
      return next
    })
  }, [])

  const handleTogglePity = useCallback((on) => {
    if (on && !pitySettings.uid) {
      // 先开启并弹出面板要求选择档案
      updatePitySettings({ enabled: true })
      setPityPanelOpen(true)
      return
    }
    updatePitySettings({ enabled: on })
  }, [pitySettings.uid, updatePitySettings])

  const handleSelectArchive = useCallback((uid) => {
    // 换档案时先清空旧数据，避免短暂显示另一账号的已垫抽数/祈愿日期
    if (uid !== pitySettings.uid) {
      setPityIndex(null)
      setPityFetchedAt(null)
      setGachaItems(null)
    }
    updatePitySettings({ uid })
  }, [pitySettings.uid, updatePitySettings])

  const handleTogglePityGroup = useCallback((key) => {
    setPitySettings(prev => {
      const selected = { ...prev.selected, [key]: !prev.selected?.[key] }
      const next = { ...prev, selected }
      window.electronAPI?.setUserConfig?.(PITY_SETTINGS_KEY, next)
      return next
    })
  }, [])

  const refresh = useCallback(async () => {
    const r = await loadRecords()
    setRecords(r)
    return r
  }, [])

  const handleSave = useCallback(async (newRecord) => {
    const updated = [...records, newRecord]
    setRecords(updated)
    await saveRecords(updated)
    setView('list')
  }, [records])

  const handleUpdate = useCallback(async (updatedRecord) => {
    const updated = records.map(r => r.id === updatedRecord.id ? updatedRecord : r)
    setRecords(updated)
    await saveRecords(updated)
    setSelectedRecord(updatedRecord)
  }, [records])

  const handleDelete = useCallback(async (recordId) => {
    const updated = records.filter(r => r.id !== recordId)
    setRecords(updated)
    await saveRecords(updated)
    setView('list')
    setSelectedRecord(null)
  }, [records])

  const handleBack = useCallback(async () => {
    setView('list')
    setSelectedRecord(null)
    setAnalysisPeriod(null)
    setWishRecord(null)
    await refresh()
  }, [refresh])

  // 打开「当日祈愿记录」子视图（整条记录一个，含当日全部祈愿）
  // 可显式传入 record（列表/日历的四芒星快捷入口），否则用当前明细记录
  const handleViewWishes = useCallback((record) => {
    const rec = record || selectedRecord
    if (rec) setWishRecord(rec)
  }, [selectedRecord])

  // ── 已垫抽数派生值 ──
  const selectedPityKeys = useMemo(
    () => PITY_GROUPS.filter(g => pitySettings.selected?.[g.key]).map(g => g.key),
    [pitySettings.selected]
  )
  // 每条记录存「期初（当日刚开始）/ 期末（当日结束）」两个时点
  const pityByRecordId = useMemo(() => {
    if (!pityIndex) return {}
    const map = {}
    for (const rec of records) map[rec.id] = pityRangeAtDate(pityIndex, rec.date)
    return map
  }, [records, pityIndex])
  const pityReady = pitySettings.enabled && !!pitySettings.uid && !!pityIndex
  // 存在祈愿记录的日期集合（YYYY-MM-DD），用于「记录是否显示祈愿记录入口」
  const wishDates = useMemo(() => {
    const s = new Set()
    if (gachaItems) {
      for (const it of gachaItems) {
        const d = String(it?.time || '').slice(0, 10)
        if (d) s.add(d)
      }
    }
    return s
  }, [gachaItems])

  const pity = useMemo(() => ({
    ready: pityReady,
    settings: pitySettings,
    archives,
    index: pityIndex,
    loading: pityLoading,
    fetchedAt: pityFetchedAt,
    panelOpen: pityPanelOpen,
    byRecordId: pityByRecordId,
    selectedKeys: selectedPityKeys,
    wishDates,
    setPanelOpen: setPityPanelOpen,
    onToggle: handleTogglePity,
    onSelectArchive: handleSelectArchive,
    onToggleGroup: handleTogglePityGroup,
    onRefresh: () => setPityRefreshTick(t => t + 1),
  }), [
    pityReady, pitySettings, archives, pityIndex, pityLoading, pityFetchedAt, pityPanelOpen,
    pityByRecordId, selectedPityKeys, wishDates, handleTogglePity, handleSelectArchive, handleTogglePityGroup,
  ])

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-amber-500/30 border-t-amber-400 animate-spin" />
      </div>
    )
  }

  // 祈愿分析视图
  if (analysisPeriod) {
    const period = analysisPeriod.period
    return (
      <WishAnalysis
        period={period}
        recordLabel={`${selectedRecord?.date} · 第 ${period.seq || analysisPeriod.idx + 1} 期`}
        onBack={() => setAnalysisPeriod(null)}
      />
    )
  }

  // 当日祈愿记录视图（整条记录一个，含当日全部祈愿记录）
  if (wishRecord) {
    return (
      <RecordWishRecords
        record={wishRecord}
        uid={pitySettings.uid}
        archives={archives}
        gachaItems={gachaItems}
        loading={pityLoading}
        onBack={() => setWishRecord(null)}
      />
    )
  }

  switch (view) {
    case 'add':
      return <AddRecordView onSave={handleSave} onUpdate={handleUpdate} onBack={handleBack} records={records} />
    case 'detail':
      return selectedRecord
        ? <DateDetailView record={selectedRecord} pity={pity} onUpdate={handleUpdate} onDelete={handleDelete} onBack={handleBack}
            onAnalyze={(period, idx) => setAnalysisPeriod({ period, idx })}
            onViewWishes={handleViewWishes} />
        : <RecordListView records={records} viewMode={viewMode} setViewMode={setViewMode} pity={pity} calendarCursor={calendarCursor} setCalendarCursor={setCalendarCursor} listScrollRef={listScrollRef} onOpenWishes={handleViewWishes} onSelect={(r) => { setSelectedRecord(r); setView('detail') }} onAdd={() => setView('add')} />
    default:
      return <RecordListView records={records} viewMode={viewMode} setViewMode={setViewMode} pity={pity} calendarCursor={calendarCursor} setCalendarCursor={setCalendarCursor} listScrollRef={listScrollRef} onOpenWishes={handleViewWishes} onSelect={(r) => { setSelectedRecord(r); setView('detail') }} onAdd={() => setView('add')} />
  }
}

// ═══════════════════════════════════════
// 记录列表视图
// ═══════════════════════════════════════
function RecordListView({ records, onSelect, onAdd, viewMode, setViewMode, pity, calendarCursor, setCalendarCursor, listScrollRef, onOpenWishes }) {
  // 按日期倒序排列
  const sorted = [...records].sort((a, b) => b.date.localeCompare(a.date))
  const listElRef = useRef(null)

  // 返回列表时恢复打开明细前的滚动位置
  useLayoutEffect(() => {
    const el = listElRef.current
    if (el) el.scrollTop = listScrollRef?.current || 0
  }, [listScrollRef, viewMode])

  return (
    <div className="h-full flex flex-col">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          <Landmark className="w-4 h-4 text-amber-400" />
          北国银行 · 收支记录
        </h2>
        <div className="flex items-center gap-2">
          {/* 已垫抽数联动：开关 + 设置面板 */}
          <PityControl pity={pity} />
          {/* 视图切换：列表 / 日历 */}
          <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-surface-800/80 border border-white/10">
            <button
              onClick={() => setViewMode('list')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors
                ${viewMode === 'list' ? 'bg-amber-500/20 text-amber-300' : 'text-surface-400 hover:text-surface-200'}`}
            >
              <List className="w-3 h-3" />
              列表
            </button>
            <button
              onClick={() => setViewMode('calendar')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors
                ${viewMode === 'calendar' ? 'bg-amber-500/20 text-amber-300' : 'text-surface-400 hover:text-surface-200'}`}
            >
              <LayoutGrid className="w-3 h-3" />
              日历
            </button>
          </div>
          <button
            onClick={onAdd}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30
                       border border-amber-500/30 text-amber-300 text-xs font-medium transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            新建记录
          </button>
        </div>
      </div>

      {/* 日历 / 列表 */}
      {viewMode === 'calendar' ? (
        <CalendarView records={records} onSelect={onSelect} pity={pity} cursor={calendarCursor} setCursor={setCalendarCursor} onOpenWishes={onOpenWishes} />
      ) : (
        <div
          ref={listElRef}
          onScroll={(e) => { if (listScrollRef) listScrollRef.current = e.target.scrollTop }}
          className="flex-1 overflow-auto p-4">
          {sorted.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-surface-500">
              <Landmark className="w-14 h-14 mb-4 opacity-20" />
              <p className="text-sm">暂无记录</p>
              <p className="text-[11px] mt-1 opacity-60">点击"新建记录"开始记账</p>
            </div>
          ) : (
            <div className="grid gap-3">
              {sorted.map(record => (
                <DateCard key={record.id} record={record} onClick={() => onSelect(record)} pity={pity} onOpenWishes={onOpenWishes} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════
// 日历视图
// ═══════════════════════════════════════
const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日']

function CalendarView({ records, onSelect, pity, cursor, setCursor, onOpenWishes }) {
  const [tip, setTip] = useState(null) // { record, anchor }
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerYear, setPickerYear] = useState(() => new Date().getFullYear())
  const labelRef = useRef(null)
  const gridRef = useRef(null)
  const pickerOpenRef = useRef(false)
  useEffect(() => { pickerOpenRef.current = pickerOpen }, [pickerOpen])

  const recordMap = useMemo(() => {
    const map = {}
    for (const r of records) if (r?.date) map[r.date] = r
    return map
  }, [records])

  // 有收支记录的月份（YYYY-MM），月历中只有这些月份可选
  const monthSet = useMemo(() => {
    const s = new Set()
    for (const r of records) if (r?.date) s.add(String(r.date).slice(0, 7))
    return s
  }, [records])

  const cells = useMemo(() => buildMonthCells(cursor.y, cursor.m), [cursor.y, cursor.m])
  const now = new Date()
  const isCurrentMonth = cursor.y === now.getFullYear() && cursor.m === now.getMonth()
  const today = todayStr()

  const shift = useCallback((delta) => {
    setTip(null)
    setCursor(prev => {
      const m = prev.m + delta
      return { y: prev.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 }
    })
  }, [])

  // 滚轮切换月份：容器自身还能滚动时先滚动，滚到边界后再切月
  useEffect(() => {
    const el = gridRef.current
    if (!el) return
    let acc = 0
    let lockUntil = 0
    const onWheel = (e) => {
      if (pickerOpenRef.current) return
      const dir = e.deltaY > 0 ? 1 : -1
      const canScrollDown = el.scrollHeight - el.scrollTop - el.clientHeight > 2
      const canScrollUp = el.scrollTop > 2
      if ((dir > 0 && canScrollDown) || (dir < 0 && canScrollUp)) return
      e.preventDefault()
      const nowTs = Date.now()
      if (nowTs < lockUntil) { acc = 0; return }
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1
      acc += e.deltaY * unit
      if (Math.abs(acc) >= 40) {
        shift(acc > 0 ? 1 : -1)
        acc = 0
        lockUntil = nowTs + 200
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [shift])

  function goToday() {
    setTip(null)
    const n = new Date()
    setCursor({ y: n.getFullYear(), m: n.getMonth() })
  }

  function openPicker() {
    setPickerYear(cursor.y)
    setPickerOpen(true)
  }

  function selectMonth(y, m) {
    setTip(null)
    setCursor({ y, m })
    setPickerOpen(false)
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* 月份导航 */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/5">
        <div className="flex items-center gap-1">
          <button onClick={() => shift(-1)} className="p-1.5 rounded-md text-surface-400 hover:text-white hover:bg-white/10 transition-colors" title="上个月">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            ref={labelRef}
            type="button"
            onClick={openPicker}
            className="flex items-center gap-1 min-w-[104px] justify-center text-sm font-semibold text-white px-1.5 py-0.5 rounded-md hover:text-amber-300 hover:bg-white/5 transition-colors select-none"
            title="选择月份"
            aria-label="选择月份"
          >
            {cursor.y}年{cursor.m + 1}月
            <ChevronDown className="w-3.5 h-3.5 text-surface-400" aria-hidden="true" />
          </button>
          <button onClick={() => shift(1)} className="p-1.5 rounded-md text-surface-400 hover:text-white hover:bg-white/10 transition-colors" title="下个月">
            <ChevronRight className="w-4 h-4" />
          </button>
          {!isCurrentMonth && (
            <button
              onClick={goToday}
              className="ml-1 px-2 py-1 rounded-md text-[11px] text-amber-300 hover:bg-amber-500/10 transition-colors"
            >
              回到本月
            </button>
          )}
        </div>
        <span className="text-[11px] text-surface-500">期末折算为纠缠之缘{pity?.ready ? ' + 已垫抽数' : ''} · 悬停查看明细</span>
      </div>

      {/* 日历网格 */}
      <div ref={gridRef} data-calendar-scroll className="flex-1 overflow-auto p-4">
        {records.length === 0 && (
          <div className="text-center text-[11px] text-surface-500 mb-3">暂无记录，点击右上角"新建记录"开始记账</div>
        )}
        <div className="grid grid-cols-7 gap-1.5">
          {WEEK_LABELS.map(w => (
            <div key={w} className="text-center text-[10px] text-surface-500 font-medium py-1 select-none">{w}</div>
          ))}
          {cells.map((date, i) => {
            if (!date) return <div key={`blank-${i}`} />
            const dateStr = fmtDate(date)
            const record = recordMap[dateStr]
            const isToday = dateStr === today
            const lastPeriod = record?.periods?.length ? record.periods[record.periods.length - 1] : null
            const fates = record ? periodToFates(lastPeriod) : null
            const pityRange = record && pity?.ready ? (pity.byRecordId?.[record.id] || null) : null
            const pitySum = pityRange ? sumPity(pityRange.end, pity.selectedKeys) : 0
            const displayFates = fates ? fates.fates + pitySum : 0
            const quickWishes = record && pity?.ready && !!pity?.wishDates?.has(record.date)
            return (
              <div
                key={dateStr}
                onClick={(e) => {
                  if (!record) return
                  if (quickWishes && e.target.closest?.('[data-quick-wishes]')) { onOpenWishes?.(record); return }
                  onSelect(record)
                }}
                onMouseEnter={record ? (e) => setTip({ record, anchor: e.currentTarget }) : undefined}
                onMouseLeave={record ? () => setTip(null) : undefined}
                className={`relative h-[76px] rounded-lg border p-1.5 flex flex-col transition-colors
                  ${record ? 'cursor-pointer bg-amber-500/5 border-amber-500/20 hover:bg-amber-500/15 hover:border-amber-500/40' : 'bg-surface-800/30 border-white/5'}
                  ${isToday ? 'ring-1 ring-amber-400/70' : ''}`}
              >
                <span className={`text-[10px] leading-none ${isToday ? 'text-amber-300 font-bold' : record ? 'text-surface-300' : 'text-surface-600'}`}>
                  {date.getDate()}
                </span>
                {fates && (
                  <div className="mt-auto min-w-0">
                    <div className="flex items-center gap-1">
                      <MaterialThumb imgFile={MATERIALS[1].imgFile} className="w-3.5 h-3.5 rounded shrink-0" />
                      <span className="text-[11px] font-semibold text-amber-300 leading-none">{displayFates.toLocaleString()}</span>
                      {(pitySum > 0 || quickWishes) && (
                        <span
                          data-quick-wishes={quickWishes ? '1' : undefined}
                          className={`shrink-0 ${quickWishes ? 'group/star inline-flex p-0.5 -m-0.5 rounded-full hover:bg-violet-500/20 transition-colors' : ''}`}
                          title={quickWishes ? '查看当日祈愿记录' : undefined}
                        >
                          <Sparkle
                            className={`w-2.5 h-2.5 ${quickWishes
                              ? 'text-violet-100 transition-transform duration-200 ease-out group-hover/star:scale-150 group-hover/star:-rotate-12'
                              : 'text-violet-300'}`}
                            fill={quickWishes ? 'currentColor' : 'none'}
                            aria-hidden="true"
                          />
                        </span>
                      )}
                    </div>
                    {(fates.leftoverPrimo > 0 || fates.leftoverGlitter > 0) && (
                      <div className="text-[9px] text-surface-500 leading-tight mt-0.5 truncate">
                        {fates.leftoverPrimo > 0 && `余${fates.leftoverPrimo.toLocaleString()}原石`}
                        {fates.leftoverPrimo > 0 && fates.leftoverGlitter > 0 && ' · '}
                        {fates.leftoverGlitter > 0 && `余${fates.leftoverGlitter}星辉`}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* 悬停小窗：portal 渲染到 body 并给高 z-index，避免被小程序窗口图层遮挡 */}
      {tip && <CalendarTip record={tip.record} anchor={tip.anchor} pity={pity} />}
      <MonthPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        anchor={labelRef}
        year={pickerYear}
        onYearChange={setPickerYear}
        cursor={cursor}
        monthSet={monthSet}
        onSelect={selectMonth}
      />
    </div>
  )
}

// ═══════════════════════════════════════
// 月历选择器（点击年月弹出，仅有记录的月份可点）
// ═══════════════════════════════════════
function MonthPicker({ open, onClose, anchor, year, onYearChange, cursor, monthSet, onSelect }) {
  const ov = useOverlay({ open, onClose, label: '选择月份', dialog: false })
  const panelRef = useRef(null)
  const [pos, setPos] = useState(null)

  useLayoutEffect(() => {
    if (!open) { setPos(null); return }
    const update = () => {
      const el = anchor?.current
      const panel = panelRef.current
      if (!el || !panel) return
      const r = el.getBoundingClientRect()
      const w = panel.offsetWidth || 248
      const h = panel.offsetHeight || 236
      const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left))
      let top = r.bottom + 6
      if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6)
      setPos({ top, left })
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [open, anchor, year])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e) => {
      const t = e.target
      if (panelRef.current?.contains(t) || anchor?.current?.contains(t)) return
      onClose()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [open, onClose, anchor])

  if (!open) return null

  return createPortal(
    <div
      ref={(node) => { panelRef.current = node; ov.overlayRef(node) }}
      {...ov.overlayProps}
      className="fixed z-[10001] w-[248px] rounded-xl bg-surface-900/95 backdrop-blur-xl border border-amber-500/25 shadow-2xl animate-scale-in p-3"
      style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden' }}
    >
      <div className="flex items-center justify-between mb-2">
        <button type="button" onClick={() => onYearChange(year - 1)} aria-label="上一年" title="上一年"
          className="p-1 rounded-md text-surface-400 hover:text-white hover:bg-white/10 transition-colors">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-xs font-semibold text-white select-none">{year} 年</span>
        <button type="button" onClick={() => onYearChange(year + 1)} aria-label="下一年" title="下一年"
          className="p-1 rounded-md text-surface-400 hover:text-white hover:bg-white/10 transition-colors">
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {Array.from({ length: 12 }, (_, i) => i + 1).map(m => {
          const key = `${year}-${String(m).padStart(2, '0')}`
          const has = monthSet.has(key)
          const isCurrent = year === cursor.y && (m - 1) === cursor.m
          return (
            <button
              key={m}
              type="button"
              disabled={!has}
              onClick={() => has && onSelect(year, m - 1)}
              className={`py-1.5 rounded-lg text-[11px] font-medium border transition-colors ${
                isCurrent
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                  : has
                    ? 'bg-surface-800/60 text-surface-200 border-white/5 hover:bg-amber-500/15 hover:text-amber-300'
                    : 'bg-surface-900/40 text-surface-600 border-transparent cursor-not-allowed opacity-40'
              }`}
              aria-label={`${year}年${m}月${has ? '' : '（无记录）'}`}
            >
              {m} 月
            </button>
          )
        })}
      </div>
      <div className="mt-2 text-[9px] text-surface-600 text-center">仅可切换到有收支记录的月份</div>
    </div>,
    document.body
  )
}

// 日历悬停小窗（日期、期初期末四种货币数额、变更原因）
function CalendarTip({ record, anchor, pity }) {
  const tipRef = useRef(null)
  const [pos, setPos] = useState(null)

  // 挂载后按实际尺寸定位；日历滚动 / 窗口缩放时跟随重算
  useEffect(() => {
    const scroller = anchor.closest('[data-calendar-scroll]')
    const update = () => {
      const el = tipRef.current
      if (!el) return
      const rect = anchor.getBoundingClientRect()
      const gap = 8
      const below = rect.bottom + gap + el.offsetHeight <= window.innerHeight
      setPos({
        top: below ? rect.bottom + gap : Math.max(gap, rect.top - gap - el.offsetHeight),
        left: Math.max(gap, Math.min(window.innerWidth - el.offsetWidth - gap, rect.left + rect.width / 2 - el.offsetWidth / 2)),
      })
    }
    update()
    scroller?.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      scroller?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [anchor])

  const periods = [...(record.periods || [])].sort((a, b) => (a.seq || 0) - (b.seq || 0))
  const first = periods[0]
  const last = periods[periods.length - 1]
  const notes = collectDiffNotes(record)

  const pityRange = pity?.ready ? (pity.byRecordId?.[record.id] || null) : null
  const pityStart = pityRange ? sumPity(pityRange.start, pity.selectedKeys) : null
  const pityEnd = pityRange ? sumPity(pityRange.end, pity.selectedKeys) : null

  return createPortal(
    <div
      ref={tipRef}
      className="fixed w-[272px] rounded-xl bg-surface-900/95 backdrop-blur-xl border border-amber-500/25 shadow-2xl p-3 space-y-2.5 animate-scale-in"
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, zIndex: 10001, pointerEvents: 'none' }}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-white">{record.date}</span>
        <span className="text-[10px] text-surface-500">{periods.length} 期记录</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <PeriodMiniBox label="期初" period={first} tone="emerald" pitySum={pityStart} />
        <PeriodMiniBox label="期末" period={last} prev={first} tone="amber" pitySum={pityEnd}
          pityDelta={pityStart != null && pityEnd != null ? pityEnd - pityStart : 0} />
      </div>
      {notes.length > 0 && (
        <div>
          <div className="text-[10px] text-surface-500 mb-1">变更原因{notes.length > 1 ? `（共 ${notes.length} 条）` : ''}</div>
          <div className="space-y-1.5">
            {notes.map(n => (
              <div key={`${n.prevSeq}-${n.currSeq}`} className="flex items-start gap-1.5">
                <span className="shrink-0 text-[10px] text-surface-500 leading-relaxed">第{n.prevSeq}→{n.currSeq}期</span>
                <p className="flex-1 min-w-0 text-[11px] text-surface-300 leading-relaxed break-words">{n.note}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>,
    document.body
  )
}

// 期初/期末数额小框；传 prev（期初）时，期末各货币追加增量显示（正绿负红）
function PeriodMiniBox({ label, period, prev, tone, pitySum, pityDelta = 0 }) {
  const toneCls = tone === 'emerald' ? 'text-emerald-400' : 'text-amber-400'
  return (
    <div className="rounded-lg bg-surface-800/60 border border-white/5 p-2 space-y-1">
      <div className={`text-[10px] font-medium ${toneCls}`}>{label}</div>
      {MATERIALS.map(m => {
        const value = period?.[m.key] || 0
        const delta = prev ? value - (prev[m.key] || 0) : 0
        return (
          <div key={m.key} className="flex items-center gap-1.5">
            <MaterialThumb imgFile={m.imgFile} className="w-3.5 h-3.5 rounded shrink-0" />
            <span className={`text-[10px] leading-none ${m.color}`}>{value.toLocaleString()}</span>
            {delta !== 0 && (
              <span className={`text-[10px] leading-none ${delta > 0 ? 'text-green-400' : 'text-red-400'}`}>
                ({delta > 0 ? '+' : ''}{delta.toLocaleString()})
              </span>
            )}
          </div>
        )
      })}
      {pitySum != null && (
        <div className="flex items-center gap-1.5 pt-1 border-t border-white/5">
          <Sparkle className="w-3.5 h-3.5 text-violet-300 shrink-0" aria-hidden="true" />
          <span className="text-[10px] leading-none text-violet-200">{pitySum}</span>
          {pityDelta !== 0 && (
            <span className={`text-[10px] leading-none ${pityDelta > 0 ? 'text-green-400' : 'text-red-400'}`}>
              ({pityDelta > 0 ? '+' : ''}{pityDelta})
            </span>
          )}
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════
// 日期卡片
// ═══════════════════════════════════════
function DateCard({ record, onClick, pity, onOpenWishes }) {
  const lastPeriod = record.periods[record.periods.length - 1]
  const periodCount = record.periods.length
  const notes = collectDiffNotes(record)

  // 计算每种材料的首末差额
  const deltas = {}
  if (periodCount >= 2) {
    const first = record.periods[0]
    for (const m of MATERIALS) {
      deltas[m.key] = (lastPeriod[m.key] || 0) - (first[m.key] || 0)
    }
  }

  // 已垫抽数：期初 = 当日刚开始，期末 = 当日结束；与纠缠之缘独立展示
  const pityRange = pity?.ready ? (pity.byRecordId?.[record.id] || null) : null
  const pityStart = pityRange ? sumPity(pityRange.start, pity.selectedKeys) : 0
  const pityEnd = pityRange ? sumPity(pityRange.end, pity.selectedKeys) : 0
  const pityDelta = pityEnd - pityStart
  const pityBreakdown = PITY_GROUPS
    .filter(g => (pity?.selectedKeys || []).includes(g.key))
    .map(g => `${g.short} ${pityRange?.end?.[g.key] || 0}`)
    .join(' · ')
  // 开关打开 + 当日有祈愿记录：四芒星实心，点击直达当日祈愿记录
  const quickWishes = pity?.ready && !!pity?.wishDates?.has(record.date)

  return (
    <button
      onClick={(e) => {
        if (quickWishes && e.target.closest?.('[data-quick-wishes]')) { onOpenWishes?.(record); return }
        onClick()
      }}
      className="w-full text-left p-4 rounded-xl bg-surface-800/50 border border-white/5
                 hover:bg-surface-800 hover:border-amber-500/20 transition-all group"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
            <Calendar className="w-4 h-4 text-amber-400" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-surface-200">{record.date}</h3>
            <p className="text-[11px] text-surface-500 mt-0.5">{periodCount} 期记录</p>
          </div>
        </div>
        <div className="flex items-start gap-3 ml-4">
          {MATERIALS.map(m => {
            const value = lastPeriod?.[m.key] || 0
            const delta = deltas[m.key]
            return (
              <div key={m.key} className="flex flex-col items-center gap-1 min-w-[40px]">
                <MaterialThumb imgFile={m.imgFile} className="w-7 h-7 rounded-lg shrink-0" />
                <div className="text-center">
                  <div className={`text-xs font-semibold leading-tight ${m.color}`}>
                    {value.toLocaleString()}
                  </div>
                  {periodCount >= 2 && delta !== 0 && (
                    <div className={`text-[10px] font-medium leading-tight mt-0.5 ${delta > 0 ? 'text-green-400' : 'text-red-400'}`}>
                      ({delta > 0 ? '+' : ''}{delta.toLocaleString()})
                    </div>
                  )}
                </div>
              </div>
            )
          })}
          {/* 已垫抽数：与四种货币同排、独立展示（口径为当日结束前一刻） */}
          {pityRange && (
            <div className="flex flex-col items-center gap-1 min-w-[40px]"
              title={`已垫抽数：期初 ${pityStart} → 期末 ${pityEnd}${pityBreakdown ? `（期末 ${pityBreakdown}）` : ''}`}>
              <div
                data-quick-wishes={quickWishes ? '1' : undefined}
                title={quickWishes ? '查看当日祈愿记录' : undefined}
                className={`w-7 h-7 rounded-lg border flex items-center justify-center shrink-0 transition-colors ${
                  quickWishes
                    ? 'group/star bg-violet-500/25 border-violet-400/60 hover:bg-violet-500/40 hover:border-violet-300/80'
                    : 'bg-violet-500/10 border-violet-500/20'
                }`}
              >
                <Sparkle
                  className={`w-4 h-4 ${quickWishes
                    ? 'text-violet-100 transition-transform duration-200 ease-out group-hover/star:scale-125 group-hover/star:-rotate-12 group-hover/star:drop-shadow-[0_0_6px_rgba(196,181,253,0.95)]'
                    : 'text-violet-300'}`}
                  fill={quickWishes ? 'currentColor' : 'none'}
                  aria-hidden="true"
                />
              </div>
              <div className="text-center">
                <div className="text-xs font-semibold leading-tight text-violet-200">{pityEnd}</div>
                {pityDelta !== 0 ? (
                  <div className={`text-[10px] font-medium leading-tight mt-0.5 ${pityDelta > 0 ? 'text-green-400' : 'text-red-400'}`}>
                    ({pityDelta > 0 ? '+' : ''}{pityDelta})
                  </div>
                ) : (
                  <div className="text-[10px] leading-tight mt-0.5 text-surface-500">已垫抽数</div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      {/* 变更原因：压缩为一行，悬停展开完整内容 */}
      {notes.length > 0 && <DateCardNotes notes={notes} />}
    </button>
  )
}

// 列表卡片变更原因：单行摘要 + 悬停气泡（完整内容）
function DateCardNotes({ notes }) {
  const [anchor, setAnchor] = useState(null)
  return (
    <>
      <div
        onMouseEnter={(e) => setAnchor(e.currentTarget)}
        onMouseLeave={() => setAnchor(null)}
        className="mt-3 pt-2.5 border-t border-white/5 flex items-center gap-2 min-w-0"
      >
        <span className="shrink-0 text-[10px] text-surface-500">📝 变更原因{notes.length > 1 ? `（${notes.length}）` : ''}</span>
        <span className="flex-1 min-w-0 text-[10px] text-surface-500 truncate">
          {notes.map(n => n.note).join('；')}
        </span>
      </div>
      {anchor && <DateCardNotesTip notes={notes} anchor={anchor} />}
    </>
  )
}

function DateCardNotesTip({ notes, anchor }) {
  const ref = useRef(null)
  const [pos, setPos] = useState(null)

  useEffect(() => {
    const update = () => {
      const el = ref.current
      if (!el || !anchor) return
      const r = anchor.getBoundingClientRect()
      const gap = 8
      const below = r.bottom + gap + el.offsetHeight <= window.innerHeight
      setPos({
        top: below ? r.bottom + gap : Math.max(gap, r.top - gap - el.offsetHeight),
        left: Math.max(gap, Math.min(window.innerWidth - el.offsetWidth - gap, r.left)),
      })
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [anchor])

  return createPortal(
    <div
      ref={ref}
      className="fixed w-[280px] rounded-xl bg-surface-900/95 backdrop-blur-xl border border-amber-500/25 shadow-2xl p-3 space-y-1.5 animate-scale-in"
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, zIndex: 10001, pointerEvents: 'none' }}
    >
      <div className="text-[10px] text-surface-500">变更原因{notes.length > 1 ? `（共 ${notes.length} 条）` : ''}</div>
      {notes.map(n => (
        <div key={`${n.prevSeq}-${n.currSeq}`} className="flex items-start gap-1.5">
          <span className="shrink-0 text-[10px] text-surface-500 leading-relaxed">第{n.prevSeq}→{n.currSeq}期</span>
          <p className="flex-1 min-w-0 text-[11px] text-surface-300 leading-relaxed break-words">{n.note}</p>
        </div>
      ))}
    </div>,
    document.body
  )
}

// ═══════════════════════════════════════
// 新增记录视图
// ═══════════════════════════════════════
function AddRecordView({ onSave, onUpdate, onBack, records }) {
  const [date, setDate] = useState(todayStr())
  const [primogems, setPrimogems] = useState('')
  const [intertwinedFates, setIntertwinedFates] = useState('')
  const [genesisCrystals, setGenesisCrystals] = useState('')
  const [starglitter, setStarglitter] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  // 查找同一天的记录用于自动计算期数
  const existingRecord = records.find(r => r.date === date)

  // 日期或已有记录变化时，若存在则继承上一期数据
  useEffect(() => {
    if (existingRecord) {
      const last = existingRecord.periods[existingRecord.periods.length - 1]
      setPrimogems(String(last.primogems || ''))
      setIntertwinedFates(String(last.intertwinedFates || ''))
      setGenesisCrystals(String(last.genesisCrystals || ''))
      setStarglitter(String(last.starglitter || ''))
    } else {
      setPrimogems('')
      setIntertwinedFates('')
      setGenesisCrystals('')
      setStarglitter('')
    }
    setNote('')
  }, [date]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = useCallback(async () => {
    setSaving(true)
    const period = {
      id: uid(),
      seq: (existingRecord?.periods?.length || 0) + 1,
      primogems: parseInt(primogems, 10) || 0,
      intertwinedFates: parseInt(intertwinedFates, 10) || 0,
      genesisCrystals: parseInt(genesisCrystals, 10) || 0,
      starglitter: parseInt(starglitter, 10) || 0,
      createdAt: new Date().toISOString(),
    }

    if (existingRecord) {
      // 追加到已有记录
      const nextSeq = (existingRecord.periods?.length || 0) + 1
      const prevSeq = nextSeq - 1
      const diffKey = `${prevSeq}-${nextSeq}`
      const diffNotes = { ...(existingRecord.diffNotes || {}) }
      if (note.trim()) diffNotes[diffKey] = note.trim()
      const updated = {
        ...existingRecord,
        periods: [...existingRecord.periods, period].sort((a, b) => a.seq - b.seq),
        diffNotes,
        updatedAt: new Date().toISOString(),
      }
      await onUpdate(updated)
      setSaving(false)
      onBack()
      return
    }

    const record = {
      id: uid(),
      date,
      periods: [period],
      diffNotes: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    await onSave(record)
    setSaving(false)
  }, [date, primogems, intertwinedFates, genesisCrystals, starglitter, note, existingRecord, records, onSave, onBack])

  // 预览差额
  let diffPreview = null
  if (existingRecord) {
    const prev = existingRecord.periods[existingRecord.periods.length - 1]
    const curr = {
      primogems: parseInt(primogems, 10) || 0,
      intertwinedFates: parseInt(intertwinedFates, 10) || 0,
      genesisCrystals: parseInt(genesisCrystals, 10) || 0,
      starglitter: parseInt(starglitter, 10) || 0,
    }
    diffPreview = calcDiff(prev, curr)
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5">
        <button onClick={onBack} className="p-1 rounded-md text-surface-400 hover:text-white hover:bg-white/10 transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h2 className="text-sm font-semibold text-white flex-1">
          {existingRecord ? `添加第 ${(existingRecord.periods.length || 0) + 1} 期 · ${date}` : `新建记录 · ${date}`}
        </h2>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4">
        {/* 日期选择 */}
        <div>
          <label className="text-[11px] text-surface-400 font-medium mb-1.5 block">日期</label>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-surface-800/80 border border-white/10 text-sm text-surface-200
                       outline-none focus:border-amber-500/50 transition-colors [color-scheme:dark]"
          />
        </div>

        {/* 材料输入 */}
        <div>
          <label className="text-[11px] text-surface-400 font-medium mb-1.5 block">材料数量</label>
          <div className="grid grid-cols-2 gap-2">
            {MATERIALS.map(m => {
              const valueMap = { primogems, intertwinedFates, genesisCrystals, starglitter }
              const setterMap = { primogems: setPrimogems, intertwinedFates: setIntertwinedFates, genesisCrystals: setGenesisCrystals, starglitter: setStarglitter }
              return (
                <div key={m.key} className={`flex items-center gap-2 px-3 py-2.5 rounded-lg ${m.bg} border ${m.border}`}>
                  <MaterialThumb imgFile={m.imgFile} className="w-7 h-7 rounded-lg shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className={`text-[10px] ${m.color} font-medium leading-tight`}>{m.label}</p>
                    <input
                      type="number"
                      min="0"
                      value={valueMap[m.key]}
                      onChange={e => setterMap[m.key](e.target.value)}
                      placeholder="0"
                      className="w-full bg-transparent text-sm text-surface-200 placeholder-surface-600 outline-none mt-0.5
                                 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* 差额预览 */}
        {diffPreview && (
          <div className="space-y-2">
            <DiffDisplay diff={diffPreview} prevSeq={existingRecord.periods.length} currSeq={existingRecord.periods.length + 1} />
            <div>
              <label className="text-[10px] text-surface-500 font-medium mb-1 block">变化原因备注</label>
              <textarea
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="说明此次变化的原因…"
                rows={2}
                className="w-full px-3 py-2 rounded-lg bg-surface-800/80 border border-white/10 text-sm text-surface-200
                           placeholder-surface-600 outline-none focus:border-amber-500/50 transition-colors resize-none"
              />
            </div>
          </div>
        )}
      </div>

      {/* 底部按钮 */}
      <div className="flex items-center gap-3 px-4 py-3 border-t border-white/5">
        <button onClick={onBack} className="px-4 py-2 rounded-lg text-xs text-surface-400 hover:text-white hover:bg-white/5 transition-colors">
          取消
        </button>
        <button
          onClick={handleSubmit}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-medium transition-colors disabled:opacity-50"
        >
          {saving ? (
            <div className="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
          ) : (
            <Landmark className="w-3.5 h-3.5" />
          )}
          确认保存
        </button>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════
// 日期详情视图（查看各期 + 差额）
// ═══════════════════════════════════════
function DateDetailView({ record, pity, onUpdate, onDelete, onBack, onAnalyze, onViewWishes }) {
  const [showAdd, setShowAdd] = useState(false)
  const [editingPeriod, setEditingPeriod] = useState(null)
  const [editingDate, setEditingDate] = useState(false)
  const [editDateValue, setEditDateValue] = useState(record.date)
  const periods = [...record.periods].sort((a, b) => a.seq - b.seq)
  const lastPeriod = periods[periods.length - 1]
  const pityRange = pity?.ready ? (pity.byRecordId?.[record.id] || null) : null
  const pityStart = pityRange ? sumPity(pityRange.start, pity.selectedKeys) : 0
  const pityEnd = pityRange ? sumPity(pityRange.end, pity.selectedKeys) : 0
  const pityDelta = pityEnd - pityStart
  const pityBreakdown = PITY_GROUPS
    .filter(g => (pity?.selectedKeys || []).includes(g.key))
    .map(g => `${g.short} ${pityRange?.end?.[g.key] || 0}`)
    .join(' · ')

  const handleSaveDate = useCallback(async () => {
    if (!editDateValue || editDateValue === record.date) {
      setEditingDate(false)
      return
    }
    const updated = { ...record, date: editDateValue, updatedAt: new Date().toISOString() }
    await onUpdate(updated)
    setEditingDate(false)
  }, [editDateValue, record, onUpdate])

  const handleSaveNewPeriod = useCallback(async (newPeriod, note) => {
    const nextSeq = record.periods.length + 1
    const prevSeq = nextSeq - 1
    const diffKey = `${prevSeq}-${nextSeq}`
    const diffNotes = { ...(record.diffNotes || {}) }
    if (note) diffNotes[diffKey] = note
    const updated = {
      ...record,
      periods: [...record.periods, { ...newPeriod, id: uid(), seq: nextSeq, createdAt: new Date().toISOString() }],
      diffNotes,
      updatedAt: new Date().toISOString(),
    }
    await onUpdate(updated)
    setShowAdd(false)
  }, [record, onUpdate])

  const handleEditPeriod = useCallback(async (editedPeriod, note) => {
    const updatedPeriods = record.periods.map(p =>
      p.id === editedPeriod.id ? { ...editedPeriod, updatedAt: new Date().toISOString() } : p
    )
    const diffKey = `${editedPeriod.seq - 1}-${editedPeriod.seq}`
    const diffNotes = { ...(record.diffNotes || {}) }
    if (note) diffNotes[diffKey] = note
    else delete diffNotes[diffKey]
    const updated = { ...record, periods: updatedPeriods, diffNotes, updatedAt: new Date().toISOString() }
    await onUpdate(updated)
    setEditingPeriod(null)
  }, [record, onUpdate])

  const handleDeletePeriod = useCallback(async (periodId) => {
    if (!confirm('确定要删除这期记录吗？')) return
    const updatedPeriods = record.periods
      .filter(p => p.id !== periodId)
      .map((p, i) => ({ ...p, seq: i + 1 }))
    if (updatedPeriods.length === 0) {
      onDelete(record.id)
      return
    }
    const updated = { ...record, periods: updatedPeriods, updatedAt: new Date().toISOString() }
    await onUpdate(updated)
  }, [record, onUpdate, onDelete])

  if (showAdd) {
    return <PeriodForm
      record={record}
      initialData={lastPeriod ? {
        primogems: lastPeriod.primogems,
        intertwinedFates: lastPeriod.intertwinedFates,
        genesisCrystals: lastPeriod.genesisCrystals,
        starglitter: lastPeriod.starglitter,
      } : undefined}
      onSave={handleSaveNewPeriod}
      onCancel={() => setShowAdd(false)}
      title={`添加第 ${record.periods.length + 1} 期 · ${record.date}`}
    />
  }

  if (editingPeriod) {
    return <PeriodForm
      record={record}
      period={editingPeriod}
      initialData={{
        primogems: editingPeriod.primogems,
        intertwinedFates: editingPeriod.intertwinedFates,
        genesisCrystals: editingPeriod.genesisCrystals,
        starglitter: editingPeriod.starglitter,
      }}
      onSave={handleEditPeriod}
      onCancel={() => setEditingPeriod(null)}
      title={`编辑第 ${editingPeriod.seq} 期 · ${record.date}`}
    />
  }

  return (
    <div className="h-full flex flex-col">
      {/* 头部 */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5">
        <button onClick={onBack} className="p-1 rounded-md text-surface-400 hover:text-white hover:bg-white/10 transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1">
          {editingDate ? (
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={editDateValue}
                onChange={e => setEditDateValue(e.target.value)}
                className="px-2 py-1 rounded-lg bg-surface-800/80 border border-amber-500/50 text-sm text-surface-200
                           outline-none [color-scheme:dark]"
                autoFocus
                onKeyDown={e => { if (e.key === 'Enter') handleSaveDate(); if (e.key === 'Escape') setEditingDate(false) }}
              />
              <button onClick={handleSaveDate} className="p-1 rounded text-emerald-400 hover:bg-emerald-500/10 transition-colors" title="保存日期">
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              </button>
              <button onClick={() => setEditingDate(false)} className="p-1 rounded text-surface-400 hover:text-white hover:bg-white/10 transition-colors" title="取消">
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-white">{record.date} · 收支明细</h2>
              <button
                onClick={() => { setEditDateValue(record.date); setEditingDate(true) }}
                className="p-0.5 rounded text-surface-600 hover:text-amber-400 hover:bg-amber-500/10 transition-colors"
                title="编辑日期"
              >
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
              </button>
            </div>
          )}
          <p className="text-[11px] text-surface-500">{periods.length} 期记录</p>
        </div>
        {pity?.settings?.uid && pity?.wishDates?.has(record.date) && (
          <button
            onClick={() => onViewWishes?.()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500/10 hover:bg-sky-500/25 border border-sky-500/25 text-sky-300 text-xs font-medium transition-colors"
            title={`查看 ${record.date} 当日的全部祈愿记录`}
          >
            <Star className="w-3.5 h-3.5" />
            祈愿记录
          </button>
        )}
        {pityRange && (
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-violet-500/10 border border-violet-500/20 max-w-[240px]"
            title={`已垫抽数：期初 ${pityStart} → 期末 ${pityEnd}${pityBreakdown ? `（期末 ${pityBreakdown}）` : ''}`}>
            <Sparkle className="w-3.5 h-3.5 text-violet-300 shrink-0" aria-hidden="true" />
            <span className="text-[10px] text-surface-400 shrink-0">已垫</span>
            <span className="text-xs font-bold text-violet-200 shrink-0">{pityEnd}</span>
            {pityDelta !== 0 && (
              <span className={`text-[10px] shrink-0 ${pityDelta > 0 ? 'text-green-400' : 'text-red-400'}`}>
                ({pityDelta > 0 ? '+' : ''}{pityDelta})
              </span>
            )}
            {pityBreakdown && <span className="text-[9px] text-surface-500 truncate">{pityBreakdown}</span>}
          </div>
        )}
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30
                     border border-amber-500/30 text-amber-300 text-xs font-medium transition-colors"
        >
          <Plus className="w-3 h-3" />
          新增一期
        </button>
      </div>

      {/* 期数列表 */}
      <div className="flex-1 overflow-auto p-4">
        <div className="space-y-4">
          {periods.map((period, idx) => {
            const isFirst = idx === 0
            const prevPeriod = idx > 0 ? periods[idx - 1] : null
            const diff = prevPeriod ? calcDiff(prevPeriod, period) : null

            return (
              <div key={period.id}>
                {/* 差额显示（非首期） */}
                {diff && (
                  <div className="space-y-1.5">
                    <DiffDisplay diff={diff} prevSeq={idx} currSeq={idx + 1} compact />
                    {record.diffNotes?.[`${idx}-${idx + 1}`] && (
                      <p className="text-[11px] text-surface-500 bg-surface-800/30 rounded-lg px-3 py-2 leading-relaxed ml-1">
                        📝 {record.diffNotes[`${idx}-${idx + 1}`]}
                      </p>
                    )}
                  </div>
                )}

                {/* 本期数据卡片 */}
                <div className={`rounded-xl border overflow-hidden ${
                  isFirst ? 'bg-surface-800/50 border-amber-500/20' : 'bg-surface-800/30 border-white/5'
                }`}>
                  <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
                    <div className="flex items-center gap-2">
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold ${
                        isFirst ? 'bg-amber-500/20 text-amber-400' : 'bg-surface-700 text-surface-400'
                      }`}>
                        {period.seq || idx + 1}
                      </span>
                      <span className="text-xs text-surface-300 font-medium">
                        {isFirst ? '初始记录' : `第 ${period.seq || idx + 1} 期`}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => onAnalyze(period, idx)}
                        className="flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-500/10 hover:bg-amber-500/25 border border-amber-500/25 text-amber-300 text-[10px] font-medium transition-colors"
                        title="基于本期货币进行祈愿分析"
                      >
                        <TrendingUp className="w-3 h-3" />
                        祈愿分析
                      </button>
                      <button
                        onClick={() => setEditingPeriod(period)}
                        className="p-1 rounded text-surface-600 hover:text-amber-400 hover:bg-amber-500/10 transition-colors"
                        title="编辑此期"
                      >
                        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
                      </button>
                      <button
                        onClick={() => handleDeletePeriod(period.id)}
                        className="p-1 rounded text-surface-600 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        title="删除此期"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                  <div className="px-4 py-3">
                    <div className="grid grid-cols-4 gap-2">
                      {MATERIALS.map(m => (
                        <div key={m.key} className="flex flex-col items-center gap-1 p-2 rounded-lg bg-surface-900/40">
                          <MaterialThumb imgFile={m.imgFile} className="w-8 h-8 rounded-lg" />
                          <span className={`text-xs font-semibold ${m.color}`}>
                            {(period[m.key] || 0).toLocaleString()}
                          </span>
                          <span className="text-[10px] text-surface-500">{m.label}</span>
                        </div>
                      ))}
                    </div>

                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* 汇总 */}
        {periods.length >= 2 && (
          <div className="mt-5 p-4 rounded-xl bg-amber-500/5 border border-amber-500/15">
            <p className="text-[11px] text-surface-400 font-medium mb-3">📊 全期汇总差额</p>
            <DiffDisplay
              diff={calcDiff(periods[0], periods[periods.length - 1])}
              prevSeq={1}
              currSeq={periods.length}
              compact
            />
          </div>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════
// 通用周期表单（新增 / 编辑）
// ═══════════════════════════════════════
function PeriodForm({ record, period, initialData, onSave, onCancel, title }) {
  const [primogems, setPrimogems] = useState(initialData ? String(initialData.primogems || '') : '')
  const [intertwinedFates, setIntertwinedFates] = useState(initialData ? String(initialData.intertwinedFates || '') : '')
  const [genesisCrystals, setGenesisCrystals] = useState(initialData ? String(initialData.genesisCrystals || '') : '')
  const [starglitter, setStarglitter] = useState(initialData ? String(initialData.starglitter || '') : '')
  const [saving, setSaving] = useState(false)
  const isEdit = !!period
  const nextSeq = isEdit ? period.seq : record.periods.length + 1
  const prevSeq = isEdit ? period.seq - 1 : record.periods.length
  const diffKey = `${prevSeq}-${nextSeq}`
  const [note, setNote] = useState(
    record.diffNotes?.[diffKey] || ''
  )

  const handleSubmit = useCallback(async () => {
    setSaving(true)
    const data = {
      primogems: parseInt(primogems, 10) || 0,
      intertwinedFates: parseInt(intertwinedFates, 10) || 0,
      genesisCrystals: parseInt(genesisCrystals, 10) || 0,
      starglitter: parseInt(starglitter, 10) || 0,
    }
    if (isEdit) {
      await onSave({ ...period, ...data }, note.trim())
    } else {
      await onSave(data, note.trim())
    }
    setSaving(false)
  }, [primogems, intertwinedFates, genesisCrystals, starglitter, note, onSave, isEdit, period])

  // 预览与上一期的差额
  const prev = isEdit
    ? record.periods.find(p => p.seq === period.seq - 1) || null
    : record.periods[record.periods.length - 1]
  const curr = {
    primogems: parseInt(primogems, 10) || 0,
    intertwinedFates: parseInt(intertwinedFates, 10) || 0,
    genesisCrystals: parseInt(genesisCrystals, 10) || 0,
    starglitter: parseInt(starglitter, 10) || 0,
  }
  const diffPreview = prev ? calcDiff(prev, curr) : null

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5">
        <button onClick={onCancel} className="p-1 rounded-md text-surface-400 hover:text-white hover:bg-white/10 transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h2 className="text-sm font-semibold text-white flex-1">{title}</h2>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4">
        <div className="grid grid-cols-2 gap-2">
          {MATERIALS.map(m => {
            const valueMap = { primogems, intertwinedFates, genesisCrystals, starglitter }
            const setterMap = { primogems: setPrimogems, intertwinedFates: setIntertwinedFates, genesisCrystals: setGenesisCrystals, starglitter: setStarglitter }
            return (
              <div key={m.key} className={`flex items-center gap-2 px-3 py-2.5 rounded-lg ${m.bg} border ${m.border}`}>
                <MaterialThumb imgFile={m.imgFile} className="w-7 h-7 rounded-lg shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className={`text-[10px] ${m.color} font-medium leading-tight`}>{m.label}</p>
                  <input
                    type="number"
                    min="0"
                    value={valueMap[m.key]}
                    onChange={e => setterMap[m.key](e.target.value)}
                    placeholder="0"
                    className="w-full bg-transparent text-sm text-surface-200 placeholder-surface-600 outline-none mt-0.5
                               [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </div>
              </div>
            )
          })}
        </div>

        {diffPreview && (
          <div className="space-y-2">
            <DiffDisplay diff={diffPreview} prevSeq={prevSeq} currSeq={nextSeq} />
            <div>
              <label className="text-[10px] text-surface-500 font-medium mb-1 block">变化原因备注</label>
              <textarea
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="说明此次变化的原因…"
                rows={2}
                className="w-full px-3 py-2 rounded-lg bg-surface-800/80 border border-white/10 text-sm text-surface-200
                           placeholder-surface-600 outline-none focus:border-amber-500/50 transition-colors resize-none"
              />
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 px-4 py-3 border-t border-white/5">
        <button onClick={onCancel} className="px-4 py-2 rounded-lg text-xs text-surface-400 hover:text-white hover:bg-white/5 transition-colors">
          取消
        </button>
        <button
          onClick={handleSubmit}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-medium transition-colors disabled:opacity-50"
        >
          {saving ? (
            <div className="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
          ) : (
            <Landmark className="w-3.5 h-3.5" />
          )}
          {isEdit ? '保存修改' : '确认保存'}
        </button>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════
// 差额展示组件
// ═══════════════════════════════════════
function DiffDisplay({ diff, prevSeq, currSeq, compact }) {
  if (!diff || diff.isZero) {
    return (
      <div className={`flex items-center gap-2 ${compact ? 'mb-2' : 'mb-0'} px-3 py-2 rounded-lg bg-surface-800/30 border border-white/5`}>
        <span className="text-[11px] text-surface-500">第 {prevSeq} → {currSeq} 期：无变动</span>
      </div>
    )
  }

  const arrow = diff.isConsumption ? '↓ 消耗' : diff.isIncrease ? '↑ 获取' : ''
  const colorClass = diff.isConsumption ? 'text-orange-400 border-orange-500/20 bg-orange-500/5' : 'text-emerald-400 border-emerald-500/20 bg-emerald-500/5'

  const parts = []
  if (diff.totalFates > 0) parts.push(`${diff.totalFates} 纠缠之缘`)
  if (diff.leftoverPrimo > 0) parts.push(`${diff.leftoverPrimo} 原石`)
  if (diff.leftoverGlitter > 0) parts.push(`${diff.leftoverGlitter} 星辉`)

  return (
    <div className={`${compact ? 'mb-2' : 'mb-0'} rounded-lg border ${colorClass} overflow-hidden`}>
      <div className="px-3 py-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium">
            {arrow} 第 {prevSeq} → {currSeq} 期
          </span>
          <span className="text-xs font-bold">
            {diff.isConsumption ? '-' : '+'}{parts.join(' · ')}
          </span>
        </div>
        {/* 明细 */}
        <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px]">
          {diff.dPrimo !== 0 && (
            <span className="text-surface-400">原石 {diff.dPrimo > 0 ? `-${diff.dPrimo.toLocaleString()}` : `+${Math.abs(diff.dPrimo).toLocaleString()}`}</span>
          )}
          {diff.dGenesis !== 0 && (
            <span className="text-surface-400">创世结晶 {diff.dGenesis > 0 ? `-${diff.dGenesis.toLocaleString()}` : `+${Math.abs(diff.dGenesis).toLocaleString()}`}</span>
          )}
          {diff.dGlitter !== 0 && (
            <span className="text-surface-400">星辉 {diff.dGlitter > 0 ? `-${diff.dGlitter.toLocaleString()}` : `+${Math.abs(diff.dGlitter).toLocaleString()}`}</span>
          )}
          {diff.dFates !== 0 && (
            <span className="text-surface-400">纠缠之缘 {diff.dFates > 0 ? `-${diff.dFates}` : `+${Math.abs(diff.dFates)}`}</span>
          )}
          {diff.fatesFromPrimo > 0 && (
            <span className="text-surface-500">↳ 原石→纠缠 {diff.fatesFromPrimo}（余{diff.leftoverPrimo}原石）</span>
          )}
          {diff.fatesFromGlitter > 0 && (
            <span className="text-surface-500">↳ 星辉→纠缠 {diff.fatesFromGlitter}（余{diff.leftoverGlitter}星辉）</span>
          )}
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════
// 当日祈愿记录：整条收支记录一个视图，包含当日（00:00~24:00）全部祈愿记录，样式参考祈愿捕捉站
// ═══════════════════════════════════════
function RecordWishRecords({ record, uid, archives, gachaItems, loading, onBack }) {
  const { query } = useDb()
  const [nameImageMap, setNameImageMap] = useState({})
  const [rankFilter, setRankFilter] = useState({ 5: true, 4: true, 3: true })
  const [search, setSearch] = useState('')
  const [viewMode, setViewMode] = useState('gallery') // list | gallery

  // 物品名 → 图片文件名（与祈愿捕捉站一致）
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const map = {}
      try {
        const chars = await query('SELECT name_zh, card_art FROM characters WHERE card_art IS NOT NULL')
        for (const c of (chars.data || [])) map[c.name_zh] = { image: c.card_art, type: 'character' }
        const wpns = await query('SELECT name_zh, simple_art FROM weapons WHERE simple_art IS NOT NULL')
        for (const w of (wpns.data || [])) {
          if (!map[w.name_zh]) map[w.name_zh] = { image: w.simple_art, type: 'weapon' }
        }
      } catch (_) {}
      if (!cancelled) setNameImageMap(map)
    })()
    return () => { cancelled = true }
  }, [query])

  // 窗口：当日 00:00:00 ~ 23:59:59
  const win = useMemo(() => ({
    start: dateStartMs(record.date),
    end: dateEndMs(record.date),
  }), [record.date])

  const items = useMemo(() => {
    if (!gachaItems) return []
    const out = []
    for (const item of gachaItems) {
      const t = gachaTimeMs(item)
      if (Number.isNaN(t)) continue
      if (t > win.end) continue
      if (t < win.start) continue
      out.push(item)
    }
    out.reverse() // 最新在顶
    return out
  }, [gachaItems, win])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter(item => {
      const rank = Number(item.rank_type)
      if ((rank === 3 || rank === 4 || rank === 5) && !rankFilter[rank]) return false
      if (q && !String(item.name || '').toLowerCase().includes(q)) return false
      return true
    })
  }, [items, rankFilter, search])

  const r5 = items.reduce((n, i) => n + (Number(i.rank_type) === 5 ? 1 : 0), 0)
  const r4 = items.reduce((n, i) => n + (Number(i.rank_type) === 4 ? 1 : 0), 0)
  const r3 = items.reduce((n, i) => n + (Number(i.rank_type) === 3 ? 1 : 0), 0)
  const acc = archives?.find(a => a.uid === uid)

  return (
    <div className="h-full flex flex-col">
      {/* 头部 */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5">
        <button onClick={onBack} aria-label="返回收支明细" className="p-1 rounded-md text-surface-400 hover:text-white hover:bg-white/10 transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <Star className="w-4 h-4 text-sky-400" />
            当日祈愿记录
          </h2>
          <p className="text-[11px] text-surface-500 truncate">
            {record.date} · {fmtDateTime(win.start)} → {fmtDateTime(win.end)}
            {acc?.nickname ? ` · ${acc.nickname}` : uid ? ` · UID ${uid}` : ''}
          </p>
        </div>
      </div>

      {/* 统计 + 筛选 */}
      <div className="px-4 py-2.5 border-b border-white/5 space-y-2">
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: '本期祈愿', value: items.length, color: 'text-sky-300' },
            { label: '五星', value: r5, color: 'text-amber-400' },
            { label: '四星', value: r4, color: 'text-purple-400' },
            { label: '三星', value: r3, color: 'text-surface-300' },
          ].map((c, i) => (
            <div key={i} className="rounded-lg bg-surface-800/40 border border-white/5 p-2 text-center">
              <div className={`text-sm font-bold ${c.color}`}>{c.value}</div>
              <div className="text-[9px] text-surface-500">{c.label}</div>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 shrink-0">
            {[5, 4, 3].map(r => (
              <button key={r} type="button" role="checkbox" aria-checked={rankFilter[r]}
                onClick={() => setRankFilter(f => ({ ...f, [r]: !f[r] }))}
                title={`${r} 星记录`}
                className={`flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] transition-colors ${
                  rankFilter[r] ? `${RANK_COLORS[r]} bg-surface-800/60 border-white/15` : 'text-surface-600 border-white/5'
                }`}>
                <span className={`w-2.5 h-2.5 rounded-[3px] border flex items-center justify-center ${rankFilter[r] ? 'border-current' : 'border-surface-600'}`}>
                  {rankFilter[r] && <Check className="w-2 h-2 text-current" strokeWidth={3} aria-hidden="true" />}
                </span>
                {r}★
              </button>
            ))}
          </div>
          <div className="flex-1 flex items-center gap-1.5 px-2 py-1 rounded-lg bg-surface-800/60 border border-white/10 min-w-0">
            <Search className="w-3.5 h-3.5 text-surface-500 shrink-0" aria-hidden="true" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="搜索物品名称…"
              className="flex-1 min-w-0 bg-transparent text-[11px] text-surface-200 placeholder-surface-600 outline-none"
            />
            {search && (
              <button type="button" onClick={() => setSearch('')} aria-label="清空搜索" className="text-surface-500 hover:text-surface-300 shrink-0">
                <X className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            )}
          </div>
          {/* 列表 / 画廊 切换 */}
          <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-surface-800/80 border border-white/10 shrink-0">
            <button type="button" onClick={() => setViewMode('list')} title="列表" aria-label="列表视图"
              className={`p-1 rounded-md transition-colors ${viewMode === 'list' ? 'bg-sky-500/20 text-sky-300' : 'text-surface-400 hover:text-surface-200'}`}>
              <List className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
            <button type="button" onClick={() => setViewMode('gallery')} title="画廊" aria-label="画廊视图"
              className={`p-1 rounded-md transition-colors ${viewMode === 'gallery' ? 'bg-sky-500/20 text-sky-300' : 'text-surface-400 hover:text-surface-200'}`}>
              <LayoutGrid className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      {/* 记录列表 */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-0.5">
        {loading && !gachaItems ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2">
            <Loader2 className="w-6 h-6 text-sky-400 animate-spin" />
            <span className="text-xs text-surface-500">加载祈愿记录…</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center text-[11px] text-surface-500 py-16">
            {items.length === 0 ? '本期没有祈愿记录' : '没有符合筛选条件的记录'}
          </div>
        ) : viewMode === 'gallery' ? (
          <WishGallery items={filtered} nameImageMap={nameImageMap} />
        ) : (
          filtered.map(item => <WishRecordRow key={item.id} item={item} nameImageMap={nameImageMap} />)
        )}
      </div>
    </div>
  )
}

// 单条祈愿记录（懒加载物品图；样式参考祈愿捕捉站逐条记录）
function WishRecordRow({ item, nameImageMap }) {
  const rank = Number(item.rank_type)
  const info = nameImageMap[item.name]
  const { ref, src } = useLazyImage(info?.image, 64)
  const isWeapon = info?.type === 'weapon'
  const meta = GACHA_TYPE_META[item.gacha_type] || { name: `卡池 ${item.gacha_type}`, icon: '🎯', color: 'text-surface-300' }
  return (
    <div className={`flex items-center gap-2 p-1.5 rounded ${RANK_BGS[rank] || 'bg-surface-800/40'} border border-transparent hover:border-white/10 transition-colors`}>
      <div ref={ref} className="w-6 h-6 shrink-0 rounded-full bg-surface-700/50 overflow-hidden flex items-center justify-center border border-surface-600">
        {src ? (
          <img src={src} alt="" className={`w-full h-full object-cover ${isWeapon ? 'p-0.5' : ''}`} />
        ) : (
          <span className="text-[10px]">{meta.icon}</span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <span className={`text-[11px] font-semibold truncate ${RANK_COLORS[rank] || 'text-surface-300'}`}>{item.name}</span>
          <span className={`text-[9px] shrink-0 ${RANK_COLORS[rank] || ''}`}>{'★'.repeat(rank)}</span>
          {item.item_type && <span className="text-[8px] text-surface-500 shrink-0">{item.item_type}</span>}
        </div>
        <div className="text-[9px] text-surface-500 truncate">
          {item.time?.slice(0, 19)} · <span className={meta.color}>{meta.name}</span>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════
// 已垫抽数联动：页头开关 + 设置弹层
// 主开关常驻页头；祈愿勾选 / 档案选择收纳进弹层，避免堆砌
// ═══════════════════════════════════════
function PityControl({ pity }) {
  const open = !!pity?.panelOpen
  const settings = pity?.settings || DEFAULT_PITY_SETTINGS
  const selected = settings.selected || {}
  const archives = pity?.archives || []
  const index = pity?.index
  const ov = useOverlay({
    open,
    onClose: () => pity?.setPanelOpen?.(false),
    label: '已垫抽数联动设置',
    dialog: false,
  })
  const anchorRef = useRef(null)
  const panelRef = useRef(null)
  const [pos, setPos] = useState(null)

  // 锚定定位：跟随页头按钮，必要时向上翻转
  useLayoutEffect(() => {
    if (!open) { setPos(null); return }
    const update = () => {
      const anchor = anchorRef.current
      const panel = panelRef.current
      if (!anchor || !panel) return
      const rect = anchor.getBoundingClientRect()
      const w = panel.offsetWidth || 300
      const h = panel.offsetHeight || 260
      const left = Math.max(8, Math.min(window.innerWidth - w - 8, rect.right - w))
      let top = rect.bottom + 6
      if (top + h > window.innerHeight - 8) top = Math.max(8, rect.top - h - 6)
      setPos({ top, left })
    }
    update()
    window.addEventListener('resize', update)
    const scroller = anchorRef.current?.closest('.overflow-auto')
    scroller?.addEventListener('scroll', update, { passive: true })
    return () => {
      window.removeEventListener('resize', update)
      scroller?.removeEventListener('scroll', update)
    }
  }, [open, archives.length, pity?.loading, pity?.index])

  const setPanelOpen = (v) => pity?.setPanelOpen?.(v)
  // 点击面板 / 锚点以外区域关闭（useOverlay 只负责 Esc / 焦点，不管外部点击）
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e) => {
      const t = e.target
      if (panelRef.current?.contains(t) || anchorRef.current?.contains(t)) return
      pity?.setPanelOpen?.(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [open, pity?.setPanelOpen])
  // 面板内展示各祈愿「当前」已垫抽数（截至最新一条祈愿记录）
  const nowPity = useMemo(() => (index ? pityAtDate(index, '9999-12-31') : null), [index])

  return (
    <>
      <div ref={anchorRef} className="flex items-center gap-0.5 p-0.5 rounded-lg bg-surface-800/80 border border-white/10">
        <button
          type="button"
          onClick={() => setPanelOpen(!open)}
          className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors ${
            pity?.ready ? 'text-violet-300' : 'text-surface-400 hover:text-surface-200'
          }`}
          aria-label="已垫抽数联动设置"
          title="已垫抽数联动设置"
        >
          <Sparkle className="w-3 h-3" aria-hidden="true" />
          <span>已垫抽数</span>
          {pity?.loading && <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />}
        </button>
        <button
          type="button"
          role="switch"
          aria-checked={!!settings.enabled}
          aria-label="考虑已垫抽数"
          title={settings.enabled ? '关闭已垫抽数' : '开启已垫抽数'}
          onClick={() => pity?.onToggle?.(!settings.enabled)}
          className={`relative w-7 h-4 rounded-full transition-colors shrink-0 ${
            settings.enabled ? 'bg-violet-500/70' : 'bg-surface-600 hover:bg-surface-500'
          }`}
        >
          <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-all ${
            settings.enabled ? 'left-3.5' : 'left-0.5'
          }`} />
        </button>
      </div>

      {open && createPortal(
        <div
            ref={(node) => { panelRef.current = node; ov.overlayRef(node) }}
            {...ov.overlayProps}
            className="fixed z-[10001] w-[300px] max-h-[70vh] overflow-y-auto rounded-xl bg-surface-900/95 backdrop-blur-xl border border-violet-500/20 shadow-2xl animate-scale-in p-3 space-y-3"
            style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden' }}
          >
            <div className="flex items-center gap-2">
              <Sparkle className="w-3.5 h-3.5 text-violet-300 shrink-0" aria-hidden="true" />
              <span className="text-xs font-semibold text-white">已垫抽数联动</span>
              <button
                type="button"
                onClick={() => setPanelOpen(false)}
                aria-label="关闭设置"
                className="ml-auto p-1 rounded-md text-surface-500 hover:text-white hover:bg-white/10 transition-colors"
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>

            {/* 祈愿档案 */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-surface-400 font-medium">祈愿档案</span>
                <button
                  type="button"
                  onClick={() => pity?.onRefresh?.()}
                  disabled={!settings.uid || pity?.loading}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-surface-400 hover:text-violet-300 hover:bg-violet-500/10 disabled:opacity-40 transition-colors"
                  title="重新读取祈愿数据"
                >
                  <RefreshCw className={`w-3 h-3 ${pity?.loading ? 'animate-spin' : ''}`} aria-hidden="true" />
                  刷新
                </button>
              </div>
              {archives.length > 0 ? (
                <select
                  value={settings.uid || ''}
                  onChange={(e) => pity?.onSelectArchive?.(e.target.value)}
                  className="w-full px-2 py-1.5 rounded-lg bg-surface-800 border border-white/10 text-[11px] text-surface-200 outline-none focus:border-violet-500/50 transition-colors"
                >
                  <option value="">选择祈愿捕捉站账号…</option>
                  {archives.map(a => (
                    <option key={a.uid} value={a.uid}>
                      {a.nickname || `UID ${a.uid}`}（{a.item_count || 0} 条）
                    </option>
                  ))}
                </select>
              ) : (
                <div className="px-2 py-1.5 rounded-lg bg-surface-800/60 border border-white/5 text-[10px] text-surface-500 leading-relaxed">
                  祈愿捕捉站还没有档案，请先到「祈愿捕捉站」拉取祈愿记录。
                </div>
              )}
            </div>

            {/* 计入的祈愿 */}
            <div>
              <div className="text-[10px] text-surface-400 font-medium mb-1.5">
                计入的祈愿<span className="text-surface-600 ml-1">（取消勾选即不计入）</span>
              </div>
              <div className="space-y-1">
                {PITY_GROUPS.map(group => {
                  const checked = !!selected[group.key]
                  return (
                    <button
                      key={group.key}
                      type="button"
                      role="checkbox"
                      aria-checked={checked}
                      title={group.types.length > 1 ? `合并 ${group.types.join(' / ')}（共享保底）` : undefined}
                      onClick={() => pity?.onToggleGroup?.(group.key)}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg border text-left transition-colors ${
                        checked ? 'bg-violet-500/10 border-violet-500/25' : 'bg-surface-800/50 border-white/5 hover:border-white/15'
                      }`}
                    >
                      <span className={`w-3.5 h-3.5 rounded flex items-center justify-center border shrink-0 ${
                        checked ? 'bg-violet-500 border-violet-400 text-white' : 'border-surface-500'
                      }`}>
                        {checked && <Check className="w-2.5 h-2.5" strokeWidth={3} aria-hidden="true" />}
                      </span>
                      <span className={`text-[11px] ${checked ? 'text-surface-200' : 'text-surface-500'}`}>{group.label}</span>
                      <span className="ml-auto text-[10px] text-surface-500 tabular-nums">
                        {nowPity ? `${nowPity[group.key] || 0} 抽` : '—'}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* 状态说明 */}
            <div className="text-[9px] text-surface-600 leading-relaxed">
              {settings.enabled
                ? (pity?.ready
                    ? `每条记录以「当日结束前一刻」的已垫抽数为准${pity?.fetchedAt ? ` · 读取于 ${new Date(pity.fetchedAt).toLocaleTimeString('zh-CN', { hour12: false })}` : ''}`
                    : (settings.uid ? '正在读取祈愿数据…' : '请选择祈愿档案后生效'))
                : '开关关闭时不影响任何展示'}
            </div>
        </div>,
        document.body
      )}
    </>
  )
}

// ═══════════════════════════════════════
// 材料缩略图（从数据库图片加载）
// ═══════════════════════════════════════
function MaterialThumb({ imgFile, className }) {
  const [src, setSrc] = useState(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    window.electronAPI?.readImage(imgFile).then(res => {
      if (!cancelled && res?.data) setSrc(res.data)
      else if (!cancelled) setError(true)
    }).catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [imgFile])

  if (error) {
    return (
      <div className={`${className} bg-surface-700 flex items-center justify-center`}>
        <Banknote className="w-4 h-4 text-surface-500" />
      </div>
    )
  }

  if (!src) {
    return <div className={`${className} bg-surface-700/50 animate-pulse`} />
  }

  return <img src={src} alt="" className={`${className} object-cover`} />
}

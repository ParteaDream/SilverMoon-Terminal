import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import {
  Plus, ArrowLeft, Landmark, Calendar, Trash2, Banknote, TrendingUp,
  ChevronLeft, ChevronRight, LayoutGrid, List,
} from 'lucide-react'
import WishAnalysis from './WishAnalysis'

// ═══════════════════════════════════════
// 常量
// ═══════════════════════════════════════

const MATERIALS = [
  { key: 'primogems', label: '原石', imgFile: 'UI_ItemIcon_201.webp', color: 'text-blue-300', bg: 'bg-blue-500/10', border: 'border-blue-500/30' },
  { key: 'intertwinedFates', label: '纠缠之缘', imgFile: 'UI_ItemIcon_223.webp', color: 'text-pink-300', bg: 'bg-pink-500/10', border: 'border-pink-500/30' },
  { key: 'genesisCrystals', label: '创世结晶', imgFile: 'UI_ItemIcon_203.webp', color: 'text-blue-500', bg: 'bg-amber-500/10', border: 'border-amber-500/30' },
  { key: 'starglitter', label: '星辉', imgFile: 'UI_ItemIcon_221.webp', color: 'text-yellow-300', bg: 'bg-yellow-500/10', border: 'border-yellow-500/30' },
]

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

  useEffect(() => { migrateIfNeeded().then(() => loadRecords()).then(r => { setRecords(r); setLoading(false) }) }, [])

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
    await refresh()
  }, [refresh])

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

  switch (view) {
    case 'add':
      return <AddRecordView onSave={handleSave} onUpdate={handleUpdate} onBack={handleBack} records={records} />
    case 'detail':
      return selectedRecord
        ? <DateDetailView record={selectedRecord} onUpdate={handleUpdate} onDelete={handleDelete} onBack={handleBack}
            onAnalyze={(period, idx) => setAnalysisPeriod({ period, idx })} />
        : <RecordListView records={records} viewMode={viewMode} setViewMode={setViewMode} onSelect={(r) => { setSelectedRecord(r); setView('detail') }} onAdd={() => setView('add')} />
    default:
      return <RecordListView records={records} viewMode={viewMode} setViewMode={setViewMode} onSelect={(r) => { setSelectedRecord(r); setView('detail') }} onAdd={() => setView('add')} />
  }
}

// ═══════════════════════════════════════
// 记录列表视图
// ═══════════════════════════════════════
function RecordListView({ records, onSelect, onAdd, viewMode, setViewMode }) {
  // 按日期倒序排列
  const sorted = [...records].sort((a, b) => b.date.localeCompare(a.date))

  return (
    <div className="h-full flex flex-col">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          <Landmark className="w-4 h-4 text-amber-400" />
          北国银行 · 收支记录
        </h2>
        <div className="flex items-center gap-2">
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
        <CalendarView records={records} onSelect={onSelect} />
      ) : (
        <div className="flex-1 overflow-auto p-4">
          {sorted.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-surface-500">
              <Landmark className="w-14 h-14 mb-4 opacity-20" />
              <p className="text-sm">暂无记录</p>
              <p className="text-[11px] mt-1 opacity-60">点击"新建记录"开始记账</p>
            </div>
          ) : (
            <div className="grid gap-3">
              {sorted.map(record => (
                <DateCard key={record.id} record={record} onClick={() => onSelect(record)} />
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

function CalendarView({ records, onSelect }) {
  const [cursor, setCursor] = useState(() => {
    const now = new Date()
    return { y: now.getFullYear(), m: now.getMonth() }
  })
  const [tip, setTip] = useState(null) // { record, anchor }

  const recordMap = useMemo(() => {
    const map = {}
    for (const r of records) if (r?.date) map[r.date] = r
    return map
  }, [records])

  const cells = useMemo(() => buildMonthCells(cursor.y, cursor.m), [cursor.y, cursor.m])
  const now = new Date()
  const isCurrentMonth = cursor.y === now.getFullYear() && cursor.m === now.getMonth()
  const today = todayStr()

  function shift(delta) {
    setTip(null)
    setCursor(prev => {
      const m = prev.m + delta
      return { y: prev.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 }
    })
  }

  function goToday() {
    setTip(null)
    const n = new Date()
    setCursor({ y: n.getFullYear(), m: n.getMonth() })
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* 月份导航 */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/5">
        <div className="flex items-center gap-1">
          <button onClick={() => shift(-1)} className="p-1.5 rounded-md text-surface-400 hover:text-white hover:bg-white/10 transition-colors" title="上个月">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-sm font-semibold text-white min-w-[104px] text-center select-none">{cursor.y}年{cursor.m + 1}月</span>
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
        <span className="text-[11px] text-surface-500">期末折算为纠缠之缘 · 悬停查看明细</span>
      </div>

      {/* 日历网格 */}
      <div data-calendar-scroll className="flex-1 overflow-auto p-4">
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
            const fates = record ? periodToFates(record.periods[record.periods.length - 1]) : null
            return (
              <div
                key={dateStr}
                onClick={() => record && onSelect(record)}
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
                      <span className="text-[11px] font-semibold text-amber-300 leading-none">{fates.fates.toLocaleString()}</span>
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
      {tip && <CalendarTip record={tip.record} anchor={tip.anchor} />}
    </div>
  )
}

// 日历悬停小窗（日期、期初期末四种货币数额、变更原因）
function CalendarTip({ record, anchor }) {
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
  const note = record.diffNotes?.[`${periods.length - 1}-${periods.length}`]

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
        <PeriodMiniBox label="期初" period={first} tone="emerald" />
        <PeriodMiniBox label="期末" period={last} prev={first} tone="amber" />
      </div>
      <div>
        <div className="text-[10px] text-surface-500 mb-1">变更原因</div>
        <p className="text-[11px] text-surface-300 leading-relaxed">{note || '—'}</p>
      </div>
    </div>,
    document.body
  )
}

// 期初/期末数额小框；传 prev（期初）时，期末各货币追加增量显示（正绿负红）
function PeriodMiniBox({ label, period, prev, tone }) {
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
    </div>
  )
}

// ═══════════════════════════════════════
// 日期卡片
// ═══════════════════════════════════════
function DateCard({ record, onClick }) {
  const lastPeriod = record.periods[record.periods.length - 1]
  const periodCount = record.periods.length

  // 计算每种材料的首末差额
  const deltas = {}
  if (periodCount >= 2) {
    const first = record.periods[0]
    for (const m of MATERIALS) {
      deltas[m.key] = (lastPeriod[m.key] || 0) - (first[m.key] || 0)
    }
  }

  return (
    <button
      onClick={onClick}
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
            <p className="text-[11px] text-surface-500 mt-0.5">
              {periodCount} 期记录
              {record.diffNotes && periodCount >= 2 && (() => {
                const lastDiffKey = `${periodCount - 1}-${periodCount}`
                const lastNote = record.diffNotes[lastDiffKey]
                return lastNote ? (
                  <span className="ml-2 text-surface-600 truncate max-w-[200px] inline-block align-bottom">
                    — {lastNote}
                  </span>
                ) : null
              })()}
            </p>
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
        </div>
      </div>
    </button>
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
function DateDetailView({ record, onUpdate, onDelete, onBack, onAnalyze }) {
  const [showAdd, setShowAdd] = useState(false)
  const [editingPeriod, setEditingPeriod] = useState(null)
  const [editingDate, setEditingDate] = useState(false)
  const [editDateValue, setEditDateValue] = useState(record.date)
  const periods = [...record.periods].sort((a, b) => a.seq - b.seq)
  const lastPeriod = periods[periods.length - 1]

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

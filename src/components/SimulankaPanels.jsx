// ═════════════════════════════════════════════════════════════════
// 希穆兰卡 · 抽卡记录 与 抽卡数据
// ═════════════════════════════════════════════════════════════════
import { useState, useMemo, useCallback } from 'react'
import { Search, Download, TrendingUp, Star, Sparkles, Coins, ChevronDown, ChevronRight, History } from 'lucide-react'
import { POOL_IDS, POOL_LABEL, PITY_GROUP, overallStats, poolStats, hardPityOf } from '../utils/wishSimulator.js'
import { SimButton, SimEmpty, SimItemIcon, rarityStyle, useSimImages } from './SimulankaShared'

const RANK_TONE = { 5: 'text-amber-200', 4: 'text-purple-200', 3: 'text-sky-200' }

// ═════════════════════════════════════════════════════════════════
// 抽卡记录
// ═════════════════════════════════════════════════════════════════
export function SimulankaRecords({ runtime, pools }) {
  const [poolFilter, setPoolFilter] = useState('all')
  const [rankFilter, setRankFilter] = useState({ 3: true, 4: true, 5: true })
  const [search, setSearch] = useState('')
  const [importedOpen, setImportedOpen] = useState(false)   // 模拟前记录默认折叠

  const records = runtime.records
  const pass = useCallback((r) => {
    const q = search.trim().toLowerCase()
    if (poolFilter !== 'all' && r.pool !== poolFilter) return false
    if (rankFilter[r.rarity] === false) return false
    if (q && !String(r.name || '').toLowerCase().includes(q)) return false
    return true
  }, [poolFilter, rankFilter, search])

  // 模拟前（从祈愿捕捉站导入）与模拟中分别成组
  const before = useMemo(() => records.filter(r => r.imported && pass(r)).slice().reverse(), [records, pass])
  const during = useMemo(() => records.filter(r => !r.imported && pass(r)).slice().reverse(), [records, pass])
  const shown = useMemo(() => [...during, ...(importedOpen ? before : [])], [during, before, importedOpen])

  const files = useMemo(() => shown.slice(0, 120).map(r => r.art).filter(Boolean), [shown])
  const imgMap = useSimImages(files, 72)

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(records, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `希穆兰卡-抽卡记录-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const poolIds = POOL_IDS.filter(id => pools[id])
  const importedTotal = records.filter(r => r.imported).length

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 flex-wrap px-3 py-2 border-b border-white/10 shrink-0">
        <button type="button" onClick={() => setPoolFilter('all')}
          className={`px-2.5 py-1 rounded-lg text-[11px] border transition-colors ${
            poolFilter === 'all' ? 'bg-primary-500/20 border-primary-400/50 text-primary-200' : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10'}`}>
          全部
        </button>
        {poolIds.map(id => (
          <button key={id} type="button" onClick={() => setPoolFilter(id)}
            className={`px-2.5 py-1 rounded-lg text-[11px] border transition-colors ${
              poolFilter === id ? 'bg-primary-500/20 border-primary-400/50 text-primary-200' : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10'}`}>
            {POOL_LABEL[id]}
          </button>
        ))}

        <div className="flex items-center gap-1 ml-1">
          {[5, 4, 3].map(r => (
            <button key={r} type="button"
              onClick={() => setRankFilter(f => ({ ...f, [r]: !f[r] }))}
              aria-pressed={rankFilter[r]}
              className={`px-2 py-1 rounded-lg text-[11px] border transition-colors ${
                rankFilter[r] ? `${rarityStyle(r).chip}` : 'bg-white/5 border-white/10 text-white/35'}`}>
              {r}★
            </button>
          ))}
        </div>

        <div className="relative ml-auto">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-white/35" aria-hidden="true" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索名称" aria-label="搜索记录"
            className="w-32 pl-7 pr-2 py-1 text-[11px] rounded-lg bg-black/30 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:border-primary-400/60" />
        </div>
        <SimButton size="sm" onClick={exportJson} disabled={records.length === 0}>
          <Download className="w-3 h-3" aria-hidden="true" />导出
        </SimButton>
      </div>

      {shown.length === 0 && before.length === 0 ? (
        <SimEmpty icon={Sparkles} title={records.length === 0 ? '还没有抽卡记录' : '没有符合筛选条件的记录'}
          hint={records.length === 0 ? '切到「祈愿」页开始抽取吧' : '试试放宽筛选条件'} />
      ) : (
        <div className="flex-1 overflow-y-auto">
          <RecordTable rows={during} imgMap={imgMap} title={`模拟中抽取（${during.length}）`} emptyHint="本局还没有抽取记录" />

          {importedTotal > 0 && (
            <div className="border-t border-white/10">
              <button
                type="button"
                onClick={() => setImportedOpen(o => !o)}
                aria-expanded={importedOpen}
                className="w-full flex items-center gap-2 px-3 py-2 bg-black/25 hover:bg-black/35 transition-colors text-left"
              >
                {importedOpen
                  ? <ChevronDown className="w-3.5 h-3.5 text-white/45" aria-hidden="true" />
                  : <ChevronRight className="w-3.5 h-3.5 text-white/45" aria-hidden="true" />}
                <History className="w-3.5 h-3.5 text-white/45" aria-hidden="true" />
                <span className="text-[11px] text-white/70">模拟前记录（{before.length}{before.length !== importedTotal ? ` / ${importedTotal}` : ''}）</span>
                <span className="text-[10px] text-white/35 ml-1">从祈愿捕捉站导入，默认折叠</span>
              </button>
              {importedOpen && (
                <RecordTable rows={before} imgMap={imgMap} hideHeader />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** 记录表（分组复用） */
function RecordTable({ rows, imgMap, title, hideHeader = false, emptyHint }) {
  if (rows.length === 0) {
    return (
      <div>
        {title && !hideHeader && <div className="px-3 pt-2 pb-1 text-[10px] text-white/40">{title}</div>}
        <p className="text-center text-[11px] text-white/30 py-6">{emptyHint || '暂无记录'}</p>
      </div>
    )
  }
  return (
    <table className="w-full text-[11px]">
      <thead className="sticky top-0 bg-surface-900/95 backdrop-blur z-10">
        {!hideHeader && (
          <tr className="text-white/45 text-left">
            <th className="font-normal px-3 py-1.5 w-24" colSpan={7}>{title}</th>
          </tr>
        )}
        <tr className="text-white/45 text-left">
          <th className="font-normal px-3 py-1.5 w-14">序号</th>
          <th className="font-normal px-2 py-1.5 w-24">卡池</th>
          <th className="font-normal px-2 py-1.5">物品</th>
          <th className="font-normal px-2 py-1.5 w-16 text-right">星级</th>
          <th className="font-normal px-2 py-1.5 w-20 text-right">垫抽</th>
          <th className="font-normal px-2 py-1.5 w-16 text-right">星辉</th>
          <th className="font-normal px-3 py-1.5 w-36 text-right">时间</th>
        </tr>
      </thead>
      <tbody>
        {rows.slice(0, 800).map(r => {
          const st = rarityStyle(r.rarity)
          return (
            <tr key={r.seq + '-' + r.pool} className={`border-t border-white/5 ${r.rarity === 5 ? 'bg-amber-400/10' : r.rarity === 4 ? 'bg-purple-400/5' : ''}`}>
              <td className="px-3 py-1 text-white/40 tabular-nums">{r.seq}</td>
              <td className="px-2 py-1 text-white/55 truncate">{POOL_LABEL[r.pool] || r.poolKind}</td>
              <td className="px-2 py-1">
                <div className="flex items-center gap-2">
                  <SimItemIcon item={r} size={22} imgMap={imgMap} />
                  <span className={`${RANK_TONE[r.rarity] || 'text-white/80'} truncate`}>{r.name}</span>
                  {r.isUp && <span className="text-[9px] px-1 rounded bg-amber-400/20 text-amber-200 border border-amber-300/30">UP</span>}
                  {r.guaranteeUsed && <span className="text-[9px] px-1 rounded bg-white/10 text-white/55">大保底</span>}
                  {r.crTriggered && <span className="text-[9px] px-1 rounded bg-cyan-400/20 text-cyan-200 border border-cyan-300/30">捕获明光</span>}
                  {r.imported && <span className="text-[9px] px-1 rounded bg-white/10 text-white/45">导入</span>}
                </div>
              </td>
              <td className={`px-2 py-1 text-right ${st.text}`}>{'★'.repeat(r.rarity)}</td>
              <td className="px-2 py-1 text-right text-white/55 tabular-nums">
                {r.rarity === 5 ? r.pity5 : r.rarity === 4 ? r.pity4 : ''}
              </td>
              <td className="px-2 py-1 text-right text-white/50 tabular-nums">{r.glitter || ''}</td>
              <td className="px-3 py-1 text-right text-white/35 tabular-nums">
                {r.time ? String(r.time).replace('T', ' ').slice(5, 16) : ''}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

// ═════════════════════════════════════════════════════════════════
// 抽卡数据
// ═════════════════════════════════════════════════════════════════
export function SimulankaStats({ runtime, pools }) {
  const stats = useMemo(() => overallStats(runtime.records), [runtime.records])
  const { all, byPool, fiveStars } = stats

  const files = useMemo(() => fiveStars.slice(0, 60).map(t => t.art).filter(Boolean), [fiveStars])
  const imgMap = useSimImages(files, 96)

  if (all.total === 0) {
    return <SimEmpty icon={TrendingUp} title="还没有抽卡数据" hint="开始祈愿后这里会实时统计出金率、平均抽数与五星时间线" />
  }

  return (
    <div className="h-full overflow-y-auto p-3 space-y-3">
      {/* 总览 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <StatCard label="总抽数" value={all.total} tone="white" />
        <StatCard label="五星" value={all.count5} sub={`出率 ${(all.rate5 * 100).toFixed(2)}%`} tone="gold" />
        <StatCard label="四星" value={all.count4} sub={`出率 ${(all.rate4 * 100).toFixed(2)}%`} tone="purple" />
        <StatCard label="平均出金" value={all.avg5 ? all.avg5.toFixed(1) : '—'} sub={all.count5 ? `最快 ${all.min5} · 最慢 ${all.max5}` : ''} tone="gold" />
        <StatCard label="UP 命中率" value={all.count5 ? `${(all.upRate5 * 100).toFixed(0)}%` : '—'} sub={all.count5 ? `${all.up5} 中 / ${all.offBanner5} 歪` : ''} tone="cyan" />
        <StatCard label="副产物" value={`${all.glitter}`} sub={`星辉 · 星尘 ${all.stardust}`} tone="amber" />
      </div>

      {/* 分池统计 */}
      <section>
        <h3 className="text-[11px] text-white/50 mb-1.5">分池统计</h3>
        <div className="overflow-x-auto rounded-lg border border-white/10">
          <table className="w-full text-[11px] min-w-[560px]">
            <thead className="bg-white/5 text-white/45">
              <tr className="text-left">
                <th className="font-normal px-3 py-1.5">卡池</th>
                <th className="font-normal px-2 py-1.5 text-right">抽数</th>
                <th className="font-normal px-2 py-1.5 text-right">五星</th>
                <th className="font-normal px-2 py-1.5 text-right">四星</th>
                <th className="font-normal px-2 py-1.5 text-right">平均出金</th>
                <th className="font-normal px-2 py-1.5 text-right">UP / 歪</th>
                <th className="font-normal px-3 py-1.5 text-right">星辉</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(byPool).map(([id, s]) => (
                <tr key={id} className="border-t border-white/5">
                  <td className="px-3 py-1.5 text-white/80">{POOL_LABEL[id] || id}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-white/70">{s.total}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-amber-200">{s.count5}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-purple-200">{s.count4}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-white/70">{s.avg5 ? s.avg5.toFixed(1) : '—'}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-white/70">{s.up5} / {s.offBanner5}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-white/60">{s.glitter}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 保底占用情况 */}
      <section>
        <h3 className="text-[11px] text-white/50 mb-1.5">当前保底状态</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          {POOL_IDS.filter(id => pools[id]).map(id => {
            // 角色池与角色池-2 共享同一保底组（PITY_GROUP），不能按池 id 直接取
            const g = runtime.pity[PITY_GROUP[id] || id] || {}
            const hard = hardPityOf(pools[id].kind)
            const extra = id === 'character1' || id === 'character2'
              ? (g.guaranteed ? '大保底' : `小保底${g.crStreak ? ` · 连保${g.crStreak}` : ''}`)
              : (g.fate !== undefined ? `命定值 ${g.fate}` : '')
            return (
              <div key={id} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-white/70">{POOL_LABEL[id]}</span>
                  <span className="text-[11px] text-white/85 tabular-nums">{g.p5 ?? 0}/{hard}</span>
                </div>
                <div className="h-1.5 mt-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-amber-300 to-amber-500"
                    style={{ width: `${Math.min(100, ((g.p5 ?? 0) / hard) * 100)}%` }} />
                </div>
                <div className="text-[10px] text-white/40 mt-1">四星 {g.p4 ?? 0}/10{extra ? ` · ${extra}` : ''}</div>
              </div>
            )
          })}
        </div>
      </section>

      {/* 五星时间线 */}
      <section>
        <h3 className="text-[11px] text-white/50 mb-1.5 flex items-center gap-1.5">
          <Star className="w-3 h-3 text-amber-300" aria-hidden="true" />五星时间线
          <span className="text-white/30">（最新在前）</span>
        </h3>
        <div className="space-y-1">
          {fiveStars.map((t, i) => {
            const isChar = t.itemType === 'character'
            const st = rarityStyle(5)
            return (
              <div key={t.seq + '-' + i}
                className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg border ${
                  t.isUp ? 'border-amber-300/40 bg-amber-400/10' : 'border-white/10 bg-white/5'}`}>
                <span className="w-9 text-[10px] text-white/40 tabular-nums shrink-0">#{t.seq}</span>
                <SimItemIcon item={{ ...t, art: t.art, rarity: 5, type: t.itemType }} size={30} imgMap={imgMap} />
                <span className={`text-xs truncate ${st.text}`}>{t.name}</span>
                {t.isUp
                  ? <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-400/20 text-amber-200 border border-amber-300/30 shrink-0">UP</span>
                  : <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/10 text-white/50 shrink-0">歪</span>}
                <span className="text-[10px] text-white/45 shrink-0">{t.poolLabel}</span>
                {isChar && t.element && (
                  <span className="text-[9px] px-1 rounded bg-white/10 text-white/50 shrink-0">{t.element}</span>
                )}
                <span className="ml-auto text-[11px] tabular-nums text-white/70 shrink-0">{t.pity} 抽</span>
              </div>
            )
          })}
        </div>
      </section>

      {/* 消耗 */}
      <section className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
        <h3 className="text-[11px] text-white/50 mb-1.5 flex items-center gap-1.5">
          <Coins className="w-3 h-3" aria-hidden="true" />累计消耗
        </h3>
        <div className="grid grid-cols-3 gap-2 text-[11px]">
          <div className="px-2 py-1.5 rounded bg-black/25">缘 <span className="text-white/85 tabular-nums ml-1">{runtime.spend?.fate ?? 0}</span></div>
          <div className="px-2 py-1.5 rounded bg-black/25">原石 <span className="text-white/85 tabular-nums ml-1">{(runtime.spend?.primogem ?? 0).toLocaleString()}</span></div>
          <div className="px-2 py-1.5 rounded bg-black/25">创世结晶 <span className="text-white/85 tabular-nums ml-1">{(runtime.spend?.genesis ?? 0).toLocaleString()}</span></div>
        </div>
      </section>
    </div>
  )
}

function StatCard({ label, value, sub, tone = 'white' }) {
  const tones = {
    white: 'text-white', gold: 'text-amber-200', purple: 'text-purple-200',
    cyan: 'text-cyan-200', amber: 'text-amber-100',
  }
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
      <div className="text-[10px] text-white/45">{label}</div>
      <div className={`text-lg leading-tight tabular-nums ${tones[tone]}`}>{value}</div>
      {sub && <div className="text-[10px] text-white/40 mt-0.5 truncate">{sub}</div>}
    </div>
  )
}

export { poolStats }

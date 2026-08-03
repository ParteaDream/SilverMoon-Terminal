import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useDb } from '../context/DbContext'
import {
  ArrowLeft, Landmark, Plus, Trash2, Pencil, Database, Save, RefreshCw,
  Search, X, BookOpen, Info, BarChart3, Users,
} from 'lucide-react'
import {
  convertCurrencies, analyzeOrdered, computePityFromArchive,
  simulateOutcomes, simulateRecycling,
} from '../utils/wishAnalysis'

// ═══════════════════════════════════════════
// 常量与工具
// ═══════════════════════════════════════════

const MATERIALS = [
  { key: 'primogems', label: '原石', imgFile: 'UI_ItemIcon_201.webp', color: 'text-blue-300' },
  { key: 'intertwinedFates', label: '纠缠之缘', imgFile: 'UI_ItemIcon_223.webp', color: 'text-pink-300' },
  { key: 'genesisCrystals', label: '创世结晶', imgFile: 'UI_ItemIcon_203.webp', color: 'text-amber-300' },
  { key: 'starglitter', label: '星辉', imgFile: 'UI_ItemIcon_221.webp', color: 'text-yellow-300' },
]

const POOL_META = {
  character: { name: '角色活动祈愿', icon: '👤', color: 'text-red-400', border: 'border-red-500/20', bg: 'bg-red-500/5' },
  weapon: { name: '武器活动祈愿', icon: '⚔️', color: 'text-purple-400', border: 'border-purple-500/20', bg: 'bg-purple-500/5' },
  chronicled: { name: '集录祈愿', icon: '📜', color: 'text-orange-400', border: 'border-orange-500/20', bg: 'bg-orange-500/5' },
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function emptyPlan(name = '') {
  return {
    id: uid(), name,
    pools: {
      character: { enabled: true, source: 'custom', wishLabel: '', up5A: null, up5B: null, up4: [] },
      weapon: { enabled: false, source: 'custom', wishLabel: '', up5: [], up4: [] },
      chronicled: { enabled: false, source: 'custom', wishLabel: '', items5: [], items4: [] },
    },
  }
}

function emptySession() {
  return {
    character: { enabled: true, targets: {}, types: {}, owned: {}, epitomized: null, pity5: 0, pity4: 0, guaranteed: 0, crStreak: 0, fate: 0 },
    weapon: { enabled: true, targets: {}, types: {}, owned: {}, epitomized: null, pity5: 0, pity4: 0, guaranteed: 0, crStreak: 0, fate: 0 },
    chronicled: { enabled: true, targets: {}, types: {}, owned: {}, epitomized: null, pity5: 0, pity4: 0, guaranteed: 0, crStreak: 0, fate: 0 },
    order: [],
  }
}

const fmtPct = (p) => `${(p * 100).toFixed(1)}%`

// ═══════════════════════════════════════════
// 主组件
// ═══════════════════════════════════════════
export default function WishAnalysis({ period, recordLabel, onBack }) {
  const { query, readImage } = useDb()
  const [plans, setPlans] = useState([])
  const [plan, setPlan] = useState(null)
  const [session, setSession] = useState(() => emptySession())
  const [recycle, setRecycle] = useState(true)
  const [nonUp4Glitter, setNonUp4Glitter] = useState(5) // 非UP四星角色星辉转化量 0~5
  // 世界树账号数据（已拥有数量来源）
  const [accounts, setAccounts] = useState([])
  const [accountData, setAccountData] = useState(null) // { uid, nickname, ownedMap, nonUp4Avg }
  const [view, setView] = useState('analysis') // 'analysis' | 'editor'
  const [result, setResult] = useState(null)
  const [computing, setComputing] = useState(false)
  const [note, setNote] = useState('')
  const [imgCache, setImgCache] = useState({})
  const runId = useRef(0)

  const conv = useMemo(() => convertCurrencies(period || {}), [period])

  // 加载方案
  useEffect(() => {
    ;(async () => {
      const r = await window.electronAPI?.wishanalysisLoadPlans()
      const list = r || []
      setPlans(list)
      if (list.length) { setPlan(list[0]) } else { setPlan(emptyPlan('默认方案')) }
    })()
  }, [])

  // 方案持久化
  const persistPlans = useCallback(async (next) => {
    setPlans(next)
    await window.electronAPI?.wishanalysisSavePlans(next)
  }, [])

  // 读取图片（readImage 直接返回 data URL）
  const getImg = useCallback(async (file) => {
    if (!file) return null
    if (imgCache[file]) return imgCache[file]
    try {
      const res = await readImage(file)
      if (res) { setImgCache(c => ({ ...c, [file]: res })); return res }
    } catch { /* ignore */ }
    return null
  }, [imgCache, readImage])

  // 常驻四星池规模（用于常驻四星目标的概率建模：歪常驻分支内 50% 角色/武器再均匀抽取）
  const [std4Counts, setStd4Counts] = useState({ chars: 50, weapons: 25 })
  const [charMap, setCharMap] = useState({})
  const [weaponMap, setWeaponMap] = useState({})
  const [pick4, setPick4] = useState(null) // { poolKey } 指定四星目标选择器
  useEffect(() => {
    ;(async () => {
      try {
        const [cs, ws, cs4, ws4] = await Promise.all([
          query('SELECT COUNT(*) as c FROM characters WHERE rarity = 4'),
          query('SELECT COUNT(*) as c FROM weapons WHERE rarity = 4'),
          query('SELECT id, name_zh, rarity, card_art FROM characters ORDER BY rarity DESC, name_zh'),
          query('SELECT id, name_zh, rarity, simple_art FROM weapons ORDER BY rarity DESC, name_zh'),
        ])
        setStd4Counts({
          chars: Math.max(1, cs.data?.[0]?.c || 50),
          weapons: Math.max(1, ws.data?.[0]?.c || 25),
        })
        const cm = {}, wm = {}
        for (const c of (cs4.data || [])) cm[c.id] = c
        for (const w of (ws4.data || [])) wm[w.id] = w
        setCharMap(cm); setWeaponMap(wm)
      } catch (_) {}
    })()
  }, [query])

  // 加载世界树账号列表
  useEffect(() => {
    ;(async () => {
      const r = await window.electronAPI?.genshinListAccounts()
      if (r?.success) setAccounts(r.accounts || [])
    })()
  }, [])

  // 应用账号：按「命之座层数 + 1」填充已拥有数量；非UP四星分层取账号内四星角色下一份均值
  const applyAccount = useCallback(async (uid) => {
    const res = await window.electronAPI?.genshinGetAccount(uid)
    if (!res?.success) return
    const avatars = res.account?.data?.index?.data?.avatars || []
    const ownedMap = {}
    let sum = 0, cnt = 0
    for (const a of avatars) {
      const owned = (a.actived_constellation_num || 0) + 1
      // 已拥有数量以数据库 name_zh 为键（API 返回的角色名随账号服务器语言变化，可能 ≠ 卡池条目名）
      const dbc = charMap[a.id]
      ownedMap[dbc?.name_zh || a.name] = owned
      if (dbc?.rarity === 4) {
        const next = owned + 1
        sum += next === 1 ? 0 : next < 8 ? 2 : 5
        cnt++
      }
    }
    setAccountData({
      uid,
      nickname: res.account.nickname || 'UID ' + uid,
      ownedMap,
      nonUp4Avg: cnt ? Math.round(sum / cnt) : 5,
    })
  }, [charMap])

  // 集录祈愿不设四星目标：自动清除历史遗留的四星目标、顺序条目与失效定轨
  useEffect(() => {
    const c5 = new Set((plan?.pools?.chronicled?.items5 || []).map(i => i.name))
    setSession(prev => {
      const targets = prev.chronicled?.targets || {}
      const cleaned = {}
      let changed = false
      for (const [name, copies] of Object.entries(targets)) {
        if (name === '__any4__' || !c5.has(name)) { changed = true; continue }
        cleaned[name] = copies
      }
      const order = (prev.order || []).filter(e => !(e.poolKey === 'chronicled' && !c5.has(e.name)))
      let epitomized = prev.chronicled?.epitomized
      if (Array.isArray(epitomized)) {
        const kept = epitomized.filter(n => c5.has(n))
        if (kept.length !== epitomized.length) { epitomized = kept; changed = true }
      } else if (epitomized && !c5.has(epitomized)) { epitomized = null; changed = true }
      if (!changed && order.length === (prev.order || []).length) return prev
      return { ...prev, chronicled: { ...prev.chronicled, targets: cleaned, epitomized }, order }
    })
  }, [plan?.pools?.chronicled?.items5])

  // 目标变化时自动同步抽取顺序（保留用户拖拽过的条目位置，追加新增条目）
  useEffect(() => {
    setSession(prev => {
      const need = []
      for (const key of Object.keys(POOL_META)) {
        const targets = prev[key]?.targets || {}
        for (const [name, copies] of Object.entries(targets)) {
          if (!copies || copies < 1) continue
          for (let c = 1; c <= copies; c++) need.push(`${key}::${name}`)
        }
      }
      const needCount = {}
      for (const k of need) needCount[k] = (needCount[k] || 0) + 1
      const haveCount = {}
      const order = []
      for (const o of (prev.order || [])) {
        const k = `${o.poolKey}::${o.name}`
        if ((haveCount[k] || 0) < (needCount[k] || 0)) {
          haveCount[k] = (haveCount[k] || 0) + 1
          order.push(o)
        }
      }
      for (const k of need) {
        if ((haveCount[k] || 0) < needCount[k]) {
          haveCount[k] = (haveCount[k] || 0) + 1
          const [pk, nm] = k.split('::')
          order.push({ poolKey: pk, name: nm })
        }
      }
      const occ = {}
      const final = order.map(o => {
        const k = `${o.poolKey}::${o.name}`
        occ[k] = (occ[k] || 0) + 1
        return { poolKey: o.poolKey, name: o.name, copy: occ[k] }
      })
      if (JSON.stringify(final) === JSON.stringify(prev.order)) return prev
      return { ...prev, order: final }
    })
  }, [session.character.targets, session.weapon.targets, session.chronicled.targets]) // eslint-disable-line react-hooks/exhaustive-deps

  const reorder = useCallback((from, to) => {
    setSession(prev => {
      if (from === to || from < 0 || to < 0 || from >= prev.order.length || to >= prev.order.length) return prev
      const order = [...prev.order]
      const [moved] = order.splice(from, 1)
      order.splice(to, 0, moved)
      const occ = {}
      return { ...prev, order: order.map(o => {
        const k = `${o.poolKey}::${o.name}`
        occ[k] = (occ[k] || 0) + 1
        return { poolKey: o.poolKey, name: o.name, copy: occ[k] }
      }) }
    })
  }, [])

  // 参数变化标记（手动计算模式：结果保留至点击「开始计算」）
  const [dirty, setDirty] = useState(false)
  useEffect(() => {
    if (!plan || view !== 'analysis') return
    setDirty(true)
  }, [plan, session, recycle, nonUp4Glitter, accountData, conv.fates, std4Counts]) // eslint-disable-line react-hooks/exhaustive-deps

  // 统一计算：按序分析 + 结果分布模拟（手动触发）
  const runAnalysis = useCallback(async () => {
    const myRun = ++runId.current
    setComputing(true)
    await new Promise(r => setTimeout(r, 30))
    if (myRun !== runId.current) return
    try {
      const pools = buildRuntimePools(plan, session, std4Counts, nonUp4Glitter, accountData)
      const order = (session.order || [])
        .filter(e => pools.some(p => p.key === e.poolKey && p.targets.some(t => t.name === e.name)))
        .map(e => ({ poolKey: e.poolKey, name: e.name, copy: e.copy }))
      let res = null
      if (order.length) {
        if (recycle) {
          // 星辉再利用：原生资源先用，星辉最后转化并循环再利用（模拟）
          res = simulateRecycling(pools, order, conv.fates, conv.starglitter, 40000)
        } else {
          // 关闭再利用：所有资源（含星辉）直接换算为固定预算，产出星辉不回馈
          const budget = conv.fates + Math.floor(conv.starglitter / 5)
          res = analyzeOrdered(pools, order, budget, false)
          res.outcomes = simulateOutcomes(pools, order, budget, 40000)
        }
      }
      if (myRun !== runId.current) return
      setResult(res)
      setDirty(false)
      setNote('')
    } catch (e) {
      if (myRun === runId.current) setNote('分析失败：' + e.message)
    } finally {
      if (myRun === runId.current) setComputing(false)
    }
  }, [plan, session, recycle, nonUp4Glitter, accountData, conv.fates, std4Counts])

  if (view === 'editor') {
    return (
      <PlanEditor
        plan={plan}
        plans={plans}
        onBack={() => setView('analysis')}
        onSave={async (next) => {
          const list = plans.some(p => p.id === next.id)
            ? plans.map(p => p.id === next.id ? next : p)
            : [...plans, next]
          await persistPlans(list)
          setPlan(next)
          setView('analysis')
        }}
        onDelete={async (id) => {
          if (!confirm('确定删除该方案？')) return
          const list = plans.filter(p => p.id !== id)
          await persistPlans(list)
          if (plan?.id === id) setPlan(list[0] || emptyPlan('默认方案'))
          setView('analysis')
        }}
        query={query}
        getImg={getImg}
      />
    )
  }

  const activePoolCount = Object.keys(POOL_META).filter(k => plan?.pools?.[k]?.enabled && session?.[k]?.enabled).length

  return (
    <div className="h-full flex flex-col bg-surface-900/95 text-surface-100" style={{ fontSize: 'clamp(10px,0.7vw + 6px,15px)' }}>
      {/* 头部 */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-white/5 shrink-0">
        <button onClick={onBack} className="p-1 rounded-md text-surface-400 hover:text-white hover:bg-white/10 transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-white flex items-center gap-1.5">
            <Landmark className="w-4 h-4 text-amber-400" />
            北国银行 · 祈愿分析
          </h2>
          <p className="text-[10px] text-surface-500 truncate">{recordLabel || ''}</p>
        </div>
        {computing && (
          <div className="flex items-center gap-1.5 text-[10px] text-amber-400/80">
            <div className="w-3 h-3 rounded-full border-2 border-amber-500/30 border-t-amber-400 animate-spin" />
            分析中…
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {note && (
          <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-[11px] text-red-300">{note}</div>
        )}

        {/* ── 资源区 ── */}
        <div className="rounded-xl bg-gradient-to-br from-amber-500/10 to-yellow-600/5 border border-amber-500/20 p-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[11px] font-semibold text-amber-300">可用资源（本期余额）</h3>
            <div className="text-[10px] text-surface-400">兑换：原石/结晶 160:1 · 星辉 5:1</div>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {MATERIALS.map(m => (
              <div key={m.key} className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-surface-900/40 border border-white/5">
                <MaterialThumb imgFile={m.imgFile} getImg={getImg} className="w-6 h-6 rounded-md shrink-0" />
                <div className="min-w-0">
                  <div className={`text-[12px] font-bold ${m.color} leading-tight`}>{(period?.[m.key] || 0).toLocaleString()}</div>
                  <div className="text-[9px] text-surface-500">{m.label}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
            <span className="font-semibold text-amber-300">原生抽数：<b className="text-base">{conv.fates}</b> 抽</span>
            <span className="text-surface-500">（纠缠 {period?.intertwinedFates || 0} · 原石/创世→{conv.fatesFromPrimo} · 星辉→+{conv.fatesFromGlitter}）</span>
            <span className="text-surface-600">星辉 {conv.starglitter} 为返利中间项{recycle ? '（≥50 自动转化，原生用尽全数转化）' : '（不参与回馈）'}</span>
            {conv.primoLeft > 0 && <span className="text-surface-500">剩余零头：{conv.primoLeft} 原石</span>}
          </div>
        </div>

        {/* ── 方案选择 ── */}
        <div className="rounded-xl bg-surface-800/40 border border-white/5 p-2.5">
          <div className="flex items-center gap-2">
            <Database className="w-3.5 h-3.5 text-surface-500 shrink-0" />
            <select
              value={plan?.id || ''}
              onChange={e => { const p = plans.find(x => x.id === e.target.value) || plan; if (p) setPlan(p) }}
              className="flex-1 min-w-0 px-2 py-1.5 rounded-lg bg-surface-800 border border-white/10 text-xs text-surface-200 outline-none focus:border-amber-500/40"
            >
              {plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              {plans.length === 0 && <option value="">（暂无方案）</option>}
            </select>
            <button onClick={() => { const np = emptyPlan(`方案 ${plans.length + 1}`); setPlan(np); setView('editor') }}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-surface-300 text-[10px] transition-colors">
              <Plus className="w-3 h-3" />新建
            </button>
            <button onClick={() => setView('editor')}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/25 text-amber-300 text-[10px] transition-colors">
              <Pencil className="w-3 h-3" />编辑方案
            </button>
          </div>
          {plan && <PlanSummary plan={plan} />}
        </div>

        {/* ── 各池目标与垫池 ── */}
        {plan && Object.keys(POOL_META).map(key => (
          <PoolConfigCard
            key={key}
            poolKey={key}
            pool={plan.pools[key]}
            session={session[key]}
            getImg={getImg}
            onSession={s => setSession(prev => ({ ...prev, [key]: s }))}
            onPick4={() => setPick4(key)}
            hideOwned={!!accountData}
          />
        ))}

        {/* ── 抽取顺序 ── */}
        <div className="rounded-xl bg-surface-800/40 border border-white/5 p-2.5">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[11px] font-semibold text-surface-300">抽取顺序</span>
            <span className="text-[9px] text-surface-600">拖拽调整 · 按序投入全部抽数计算达成概率</span>
          </div>
          {session.order.length === 0 ? (
            <div className="text-[10px] text-surface-600 py-1">设置抽取目标后自动生成顺序</div>
          ) : (
            <OrderBar
              order={session.order}
              probs={result?.entries}
              charMap={charMap}
              weaponMap={weaponMap}
              getImg={getImg}
              onReorder={reorder}
            />
          )}
        </div>

        {/* ── 世界树账号数据（已拥有数量）── */}
        <div className="rounded-xl bg-emerald-500/5 border border-emerald-500/15 p-2.5">
          <div className="flex items-center gap-2">
            <Users className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <select value={accountData?.uid || ''} onChange={e => { const u = e.target.value; if (u) applyAccount(u) }}
              className="flex-1 min-w-0 px-2 py-1.5 rounded-lg bg-surface-800 border border-white/10 text-[10px] text-surface-200 outline-none">
              <option value="">选择世界树账号（自动填充已拥有数量）…</option>
              {accounts.map(a => (
                <option key={a.uid} value={a.uid}>{a.nickname || 'UID ' + a.uid}</option>
              ))}
            </select>
            {accountData && (
              <button onClick={() => setAccountData(null)}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-surface-300 text-[10px] transition-colors">
                清除账号数据
              </button>
            )}
          </div>
          {accountData ? (
            <div className="mt-1.5 text-[9px] text-emerald-300/80">
              已应用 {accountData.nickname}：{Object.keys(accountData.ownedMap).length} 名角色，三个卡池的已拥有数量与星辉分层均基于此账号；手动参数已隐藏
            </div>
          ) : accounts.length === 0 ? (
            <div className="mt-1.5 text-[9px] text-surface-600">未找到世界树账号，可在世界树板块拉取账号数据后使用</div>
          ) : (
            <div className="mt-1.5 text-[9px] text-surface-600">应用后自动按「命之座层数 + 1」填充各池角色已拥有数量，并隐藏手动参数</div>
          )}
        </div>

        {/* ── 祈愿捕捉站导入 ── */}
        <ArchiveImporter onImport={setSession} />

        {/* ── 分析设置 ── */}
        <div className="rounded-xl bg-surface-800/40 border border-white/5 p-2.5 space-y-2">
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input type="checkbox" checked={recycle} onChange={e => setRecycle(e.target.checked)}
                className="w-3.5 h-3.5 accent-amber-500" />
              <span className="text-[11px] text-surface-300">星辉再利用</span>
            </label>
            <span className="text-[10px] text-surface-500 flex-1">
              星辉为返利中间项：原生星辉计入原生抽数；计算中星辉 ≥50 自动转化 10 抽，原生用尽后全数转化循环再利用
            </span>
          {dirty && result && (
            <span className="text-[10px] text-amber-400 animate-pulse shrink-0">参数已变化，点击重新计算</span>
          )}
          <button onClick={runAnalysis} disabled={computing}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg disabled:opacity-50 text-white text-[11px] font-medium transition-colors ${
              dirty && result ? 'bg-amber-600 hover:bg-amber-500' : 'bg-amber-500 hover:bg-amber-600'
            }`}>
            {computing ? (
              <>
                <div className="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                计算中…
              </>
            ) : (
              <>
                <RefreshCw className="w-3.5 h-3.5" />
                {dirty && result ? '重新计算' : '开始计算'}
              </>
            )}
          </button>
          </div>
          {!accountData && (
            <div className="flex items-center gap-2 border-t border-white/5 pt-2">
              <span className="text-[10px] text-surface-400 shrink-0">非UP四星角色星辉转化量</span>
              <WrapStepper value={nonUp4Glitter} min={0} max={5} onChange={setNonUp4Glitter} />
              <span className="text-[9px] text-surface-600">
                每获得一个非当期UP的四星角色计 {nonUp4Glitter} 星辉（游戏标准：第 1~7 次 2、第 8 次起 5；0 表示不计）
              </span>
            </div>
          )}
        </div>

        {/* ── 结果区 ── */}
        {result ? (
          <ResultSection result={result} conv={conv} recycle={recycle} />
        ) : (
          <div className="rounded-xl bg-surface-800/40 border border-dashed border-white/10 p-8 text-center">
            <BarChart3 className="w-8 h-8 text-surface-600 mx-auto mb-2" />
            <p className="text-[11px] text-surface-500">
              {activePoolCount === 0 ? '请先启用至少一个卡池并设置抽取目标' : '设置完成后点击「开始计算」统一计算分析结果与结果分布'}
            </p>
          </div>
        )}

        {/* 免责声明 */}
        <div className="px-3 py-2 rounded-lg bg-surface-900/60 border border-white/5 text-[9px] text-surface-600 leading-relaxed">
          <Info className="w-3 h-3 inline mr-1" />
          模型依据《祈愿机制》《保底机制》《集录祈愿》词条实现：软保底概率表、四星 10 抽保底与 UP 歪后必出、捕获明光连保判定、定轨命定值、副产物星辉分层（随各池「已有物品数量」平移分层阈值）。
          祈愿捕捉站档案推算的连保次数为尽力推断，可手动修正。
        </div>
      </div>

      {/* 指定四星目标选择器 */}
      {pick4 && (
        <ItemPicker
          type="any"
          charMap={charMap}
          weaponMap={weaponMap}
          forceRarity={4}
          onPick={item => {
            setSession(prev => {
              const s = prev[pick4]
              const targets = { ...s.targets }
              if (targets[item.name] === undefined) targets[item.name] = 1
              return { ...prev, [pick4]: { ...s, targets, types: { ...(s.types || {}), [item.name]: item.type } } }
            })
            setPick4(null)
          }}
          onClose={() => setPick4(null)}
        />
      )}
    </div>
  )
}

// ═══════════════════════════════════════════
// 方案摘要
// ═══════════════════════════════════════════
function PlanSummary({ plan }) {
  const parts = []
  const c = plan.pools.character
  const w = plan.pools.weapon
  const ch = plan.pools.chronicled
  if (c?.enabled) parts.push(`角色${c.up5A?.name || ''}${c.up5B?.name ? ' / ' + c.up5B.name : ''}`)
  if (w?.enabled) parts.push(`武器${w.up5.map(x => x?.name).filter(Boolean).join(' / ')}`)
  if (ch?.enabled) parts.push(`集录${ch.items5.length} 个五星`)
  return (
    <div className="mt-1.5 text-[10px] text-surface-500 truncate">
      {parts.length ? parts.join(' · ') : '（未启用任何卡池）'}
    </div>
  )
}

// ═══════════════════════════════════════════
// 单池配置卡（目标 + 垫池）
// ═══════════════════════════════════════════
function PoolConfigCard({ poolKey, pool, session, getImg, onSession, onPick4, hideOwned }) {
  const meta = POOL_META[poolKey]
  if (!pool?.enabled) return null
  const up5 = poolKey === 'character'
    ? [pool.up5A, pool.up5B].filter(Boolean)
    : poolKey === 'weapon' ? (pool.up5 || []) : (pool.items5 || [])
  const up4Raw = poolKey === 'character' || poolKey === 'weapon' ? (pool.up4 || []) : (pool.items4 || [])
  const up4 = up4Raw.map(i => (typeof i === 'string' ? { name: i, type: poolKey === 'character' ? 'char' : 'weapon' } : i))
  const up4Names = new Set(up4.map(i => i.name))

  const set = (patch) => onSession({ ...session, ...patch })

  const targets = session.targets || {}
  const owned = session.owned || {}
  const types = session.types || {}
  const targetCount = Object.values(targets).reduce((s, v) => s + (v > 0 ? 1 : 0), 0)

  const pityMax = poolKey === 'weapon' ? 79 : 89
  const [showOwned, setShowOwned] = useState(false)
  const allItems = [...up5.map(i => ({ name: i.name, type: i.type })), ...up4.map(i => ({ name: i.name, type: i.type }))]
  // 已有物品数量仅角色需要（武器重复无副产物分层）
  const ownedItems = poolKey === 'weapon' ? [] : allItems.filter(it => it.type !== 'weapon')
  const stdTargets = Object.entries(targets).filter(([name, v]) => v > 0 && name !== '__any4__' && !up5.some(i => i.name === name) && !up4Names.has(name))

  const setOwned = (name, v) => set({ owned: { ...owned, [name]: v } })
  // 集录祈愿：角色与武器分别定轨（可多个，按目标顺序切换生效）；武器池保持单一
  const typeOfName = (name) => (pool.items5 || []).find(i => i.name === name)?.type
    || (pool.items4 || []).find(i => i.name === name)?.type || 'char'
  const epitList = poolKey === 'chronicled'
    ? (Array.isArray(session.epitomized) ? session.epitomized : session.epitomized ? [session.epitomized] : [])
    : []
  const isEpit = (name) => poolKey === 'chronicled' ? epitList.includes(name) : session.epitomized === name
  // 五星目标数量变化：第一个目标自动成为定轨目标（集录祈愿按类型各自定轨）；定轨目标清零时取消定轨
  const setCopies5 = (name, v) => {
    let epitomized = session.epitomized
    if (poolKey === 'chronicled') {
      const list = Array.isArray(epitomized) ? [...epitomized] : epitomized ? [epitomized] : []
      if (v > 0 && !list.includes(name) && !list.some(nm => typeOfName(nm) === typeOfName(name))) list.push(name)
      if (v === 0) { const i = list.indexOf(name); if (i >= 0) list.splice(i, 1) }
      epitomized = list
    } else if (poolKey !== 'character') {
      if (v > 0 && !epitomized) epitomized = name
      if (v === 0 && epitomized === name) epitomized = null
    }
    set({ targets: { ...targets, [name]: v }, epitomized })
  }

  return (
    <div className={`rounded-xl ${meta.bg} ${meta.border} border p-2.5`}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm">{meta.icon}</span>
        <h3 className={`text-[11px] font-semibold ${meta.color} flex-1`}>{meta.name}</h3>
        <span className="text-[9px] text-surface-500">{pool.wishLabel || '自定义卡池'}</span>
        <label className="flex items-center gap-1 text-[10px] text-surface-400 cursor-pointer select-none">
          <input type="checkbox" checked={session.enabled} onChange={e => set({ enabled: e.target.checked })}
            className="w-3 h-3 accent-amber-500" />
          参与分析
        </label>
      </div>

      {!session.enabled ? (
        <div className="text-[10px] text-surface-600 py-1">该池未参与本次分析</div>
      ) : (
        <>
          {/* 五星目标 */}
          <div className="mb-2">
            <div className="text-[9px] text-surface-500 mb-1">五星目标（数量 = 本次需获得的副本数）</div>
            <div className="flex flex-wrap gap-1.5">
              {up5.map(item => {
                const name = item?.name
                if (!name) return null
                return (
                  <TargetChip key={name} label={name} isWeapon={poolKey === 'weapon' || (poolKey === 'chronicled' && item.type === 'weapon')}
                    copies={targets[name] || 0}
                    epitomized={isEpit(name)}
                    canEpitomize={poolKey !== 'character'}
                    onCopies={v => setCopies5(name, v)}
                    onEpitomize={() => {
                      if (poolKey === 'chronicled') {
                        set({ epitomized: epitList.includes(name) ? epitList.filter(x => x !== name) : [...epitList, name] })
                      } else {
                        set({ epitomized: session.epitomized === name ? null : name })
                      }
                    }}
                  />
                )
              })}
              {up5.length === 0 && <span className="text-[9px] text-surface-600">该池暂无五星配置</span>}
            </div>
            {poolKey !== 'character' && up5.length > 0 && (
              <div className="text-[9px] text-surface-600 mt-1">
                {poolKey === 'chronicled'
                  ? (epitList.length
                    ? `已定轨：${epitList.join('、')} —— 生效定轨（目标顺序中第一个未达成者）期间 5 星仅出同类型，歪后命定值 +1；达成后自动切换至下一未达成定轨`
                    : '未定轨：五星从池内等概率；建议角色与武器各设定轨（先设的角色先抽，再依次切换）')
                  : (session.epitomized
                    ? `已定轨「${session.epitomized}」—— 歪后命定值 +1，下次五星必得`
                    : '未定轨：五星 75% UP 平分、25% 常驻')}
              </div>
            )}
          </div>

          {/* 四星目标 + 任意四星（集录祈愿主要抽五星，不设四星目标） */}
          {poolKey === 'chronicled' ? null : (
          <div className="mb-2">
            <div className="text-[9px] text-surface-500 mb-1">四星目标</div>
            <div className="flex flex-wrap gap-1.5">
              {up4.map(item => {
                const name = item?.name
                if (!name) return null
                return (
                  <TargetChip key={name} label={name} isWeapon={poolKey === 'weapon' || (poolKey === 'chronicled' && item.type === 'weapon')}
                    copies={targets[name] || 0}
                    onCopies={v => set({ targets: { ...targets, [name]: v } })}
                  />
                )
              })}
              {/* 常驻四星细分目标（非当期 UP） */}
              {stdTargets.map(([name, v]) => (
                <TargetChip key={name} label={name}
                  isWeapon={types[name] === 'weapon'}
                  copies={v}
                  onCopies={x => set({ targets: { ...targets, [name]: x } })}
                />
              ))}
              <TargetChip label="任意四星" isWeapon={false}
                copies={targets['__any4__'] || 0}
                onCopies={v => set({ targets: { ...targets, ['__any4__']: v } })}
              />
              {poolKey !== 'chronicled' && (
                <button onClick={onPick4}
                  className="flex items-center gap-1 px-1.5 py-1 rounded-lg border border-dashed border-white/20 hover:border-amber-500/40 hover:text-amber-300 text-surface-500 text-[10px] transition-colors">
                  <Plus className="w-3 h-3" />指定目标
                </button>
              )}
            </div>
            {poolKey !== 'chronicled' && stdTargets.length > 0 && (
              <div className="text-[8px] text-surface-600 mt-1">常驻目标仅在歪常驻四星时出现（概率较低），当期 UP 目标概率更高</div>
            )}
          </div>
          )}

          {/* 已有物品数量（仅角色；应用世界树账号数据后隐藏，由账号自动填充） */}
          {!hideOwned && poolKey !== 'weapon' && (
            <div className="rounded-lg bg-surface-900/40 border border-white/5 px-2.5 py-2 mb-2">
              <button onClick={() => setShowOwned(!showOwned)}
                className="text-[9px] text-surface-500 mb-1 flex items-center gap-1 hover:text-surface-300">
                <span className={`inline-block transition-transform ${showOwned ? 'rotate-90' : ''}`}>▸</span>
                已有物品数量（影响副产物分层：五星第 8 份起 25 星辉；四星首次 0、第 2~7 次 2、第 8 份起 5；对池内角色生效，无论是否设为目标）
              </button>
              {showOwned && (
                ownedItems.length ? (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5">
                    {ownedItems.map(it => (
                      <div key={it.name} className="flex items-center gap-1 px-1.5 py-1 rounded bg-surface-800/70 border border-white/10">
                        <span className="text-[9px] text-surface-400 truncate max-w-[60px] flex-1">{it.name}</span>
                        <WrapStepper value={owned[it.name] || 0} min={0} max={7} onChange={v => setOwned(it.name, v)} />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-[9px] text-surface-600">该池无角色类物品</div>
                )
              )}
            </div>
          )}

          {/* 垫池 */}
          <div className="rounded-lg bg-surface-900/40 border border-white/5 px-2.5 py-2">
            <div className="text-[9px] text-surface-500 mb-1.5">垫池情况</div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              <NumberField label="距上次五星" value={session.pity5} min={0} max={pityMax}
                onChange={v => set({ pity5: v })} suffix="抽" />
              <NumberField label="距上次四星" value={session.pity4} min={0} max={9}
                onChange={v => set({ pity4: v })} suffix="抽" />
              {poolKey === 'character' && (
                <>
                  <select value={session.guaranteed} onChange={e => set({ guaranteed: +e.target.value })}
                    className="px-2 py-1.5 rounded-lg bg-surface-800 border border-white/10 text-[10px] text-surface-200 outline-none">
                    <option value={0}>小保底（50%）</option>
                    <option value={1}>大保底（必得 UP）</option>
                  </select>
                  <select value={session.crStreak} onChange={e => set({ crStreak: +e.target.value })}
                    className="px-2 py-1.5 rounded-lg bg-surface-800 border border-white/10 text-[10px] text-surface-200 outline-none">
                    <option value={0}>捕获明光连保 0 次</option>
                    <option value={1}>连保 1 次</option>
                    <option value={2}>连保 2 次（47/47/6）</option>
                    <option value={3}>连保 3 次（下次必中）</option>
                  </select>
                </>
              )}
              {poolKey !== 'character' && (
                <select value={session.fate} onChange={e => set({ fate: +e.target.value })}
                  className="px-2 py-1.5 rounded-lg bg-surface-800 border border-white/10 text-[10px] text-surface-200 outline-none">
                  <option value={0}>命定值 0（歪后 +1）</option>
                  <option value={1}>命定值 1（下次必得定轨）</option>
                </select>
              )}
            </div>
            <div className="text-[9px] text-surface-600 mt-1.5">
              {targetCount === 0 ? '未设置目标，该池仅统计产出' : ''}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function NumberField({ label, value, min, max, onChange, suffix }) {
  return (
    <label className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-surface-800/70 border border-white/10">
      <span className="text-[9px] text-surface-500 shrink-0">{label}</span>
      <input type="number" min={min} max={max} value={value}
        onChange={e => {
          let v = parseInt(e.target.value, 10)
          if (isNaN(v)) v = 0
          onChange(Math.max(min, Math.min(max, v)))
        }}
        className="w-12 bg-transparent text-[11px] text-surface-200 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
      <span className="text-[9px] text-surface-500">{suffix}</span>
    </label>
  )
}

// ═══════════════════════════════════════════
// 目标标签（可增减数量 / 定轨）
// ═══════════════════════════════════════════
function TargetChip({ label, isWeapon, copies, onCopies, epitomized, canEpitomize, onEpitomize }) {
  return (
    <div className={`flex items-center gap-1 px-1.5 py-1 rounded-lg border transition-colors ${
      epitomized
        ? 'border-amber-500/50 bg-amber-500/10'
        : copies > 0
          ? 'border-emerald-500/30 bg-emerald-500/10'
          : 'border-white/10 bg-surface-800/50'
    }`}>
      <span className="text-[10px] text-surface-200 max-w-[80px] truncate">{label}</span>
      <div className="flex items-center gap-0.5">
        <button onClick={() => onCopies(Math.max(0, (copies || 0) - 1))}
          className="w-4 h-4 rounded bg-white/5 hover:bg-white/15 text-surface-400 hover:text-white text-[10px] leading-none">−</button>
        <span className={`w-5 text-center text-[10px] font-semibold ${copies > 0 ? 'text-emerald-300' : 'text-surface-500'}`}>{copies || 0}</span>
        <button onClick={() => onCopies(Math.min(12, (copies || 0) + 1))}
          className="w-4 h-4 rounded bg-white/5 hover:bg-white/15 text-surface-400 hover:text-white text-[10px] leading-none">+</button>
      </div>
      {canEpitomize && (
        <button onClick={onEpitomize} title={epitomized ? '取消定轨' : '设为定轨'}
          className={`w-4 h-4 rounded flex items-center justify-center text-[9px] transition-colors ${
            epitomized ? 'bg-amber-500/20 text-amber-300' : 'bg-white/5 text-surface-500 hover:text-amber-300'
          }`}>
          {epitomized ? '定' : '轨'}
        </button>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════
// 祈愿捕捉站导入
// ═══════════════════════════════════════════
function ArchiveImporter({ onImport }) {
  const [archives, setArchives] = useState([])
  const [uid, setUid] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    ;(async () => {
      const r = await window.electronAPI?.gachaListArchives()
      if (r?.success) setArchives(r.archives || [])
    })()
  }, [])

  const doImport = useCallback(async () => {
    if (!uid) return
    setBusy(true); setMsg('')
    try {
      const types = [301, 400, 302, 500]
      const res = await Promise.all(types.map(t => window.electronAPI?.gachaGetItemsByType(uid, t)))
      const byType = {}
      types.forEach((t, i) => { byType[t] = res[i]?.success ? res[i].items : [] })
      const pity = computePityFromArchive(byType)
      onImport(prev => ({
        ...prev,
        character: { ...prev.character, pity5: pity.character.pity5, pity4: pity.character.pity4, guaranteed: pity.character.guaranteed, crStreak: pity.character.crStreak },
        weapon: { ...prev.weapon, pity5: pity.weapon.pity5, pity4: pity.weapon.pity4, fate: 0 },
        chronicled: { ...prev.chronicled, pity5: pity.chronicled.pity5, pity4: pity.chronicled.pity4, fate: 0 },
      }))
      const acc = archives.find(a => a.uid === uid)
      setMsg(`已从 ${acc?.nickname || 'UID ' + uid} 导入：角色池 距五星 ${pity.character.pity5} 抽${pity.character.guaranteed ? '（大保底）' : '（小保底）'} · 武器池 距五星 ${pity.weapon.pity5} 抽 · 集录 距五星 ${pity.chronicled.pity5} 抽`)
    } catch (e) {
      setMsg('导入失败：' + e.message)
    } finally { setBusy(false) }
  }, [uid, archives, onImport])

  if (!archives.length) return null

  return (
    <div className="rounded-xl bg-blue-500/5 border border-blue-500/15 p-2.5">
      <div className="flex items-center gap-2">
        <BookOpen className="w-3.5 h-3.5 text-blue-400 shrink-0" />
        <select value={uid} onChange={e => setUid(e.target.value)}
          className="flex-1 min-w-0 px-2 py-1.5 rounded-lg bg-surface-800 border border-white/10 text-[10px] text-surface-200 outline-none">
          <option value="">选择祈愿捕捉站账号…</option>
          {archives.map(a => (
            <option key={a.uid} value={a.uid}>
              {a.nickname || 'UID ' + a.uid}（{a.item_count || 0} 条记录）
            </option>
          ))}
        </select>
        <button onClick={doImport} disabled={!uid || busy}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 disabled:opacity-40 text-blue-300 text-[10px] transition-colors">
          <Database className="w-3 h-3" />一键填入垫池
        </button>
      </div>
      {msg && <div className="mt-1.5 text-[9px] text-blue-300/80">{msg}</div>}
      <div className="mt-1 text-[9px] text-surface-600">
        自动推算各池距上次五星/四星抽数、大小保底与捕获明光连保；定轨命定值因卡池轮替会清零，需手动确认
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════
// 结果区：各池「达到目标所需抽数」参考 + 按序达成概率 + 结果分布表
// ═══════════════════════════════════════════
function ResultSection({ result, conv, recycle }) {
  const poolProb = {}
  for (const e of result.entries) poolProb[e.poolKey] = e.P
  const sim = !!result.recycle
  // 充足判断基准：期望抽数为纯需求口径，须与「可用抽数 + 星辉再生转化抽数」比较
  const regen = sim ? Math.round(result.convertedE || 0) : 0
  const budget = conv.fates + regen
  // 达成所需期望抽数：纯需求口径（无条件、不含星辉转化、不依赖资源）——垫池敏感，Σ 每池 = 合计
  const needE = result.sumE || result.perPool.reduce((s, p) => s + p.need.E, 0)
  const needP75 = result.sumP75 || result.perPool.reduce((s, p) => s + p.need.p75.n, 0)
  const enough = (need) => need <= budget + 1e-9
  return (
    <div className="space-y-3">
      {/* 总览 */}
      <div className="rounded-xl bg-gradient-to-br from-amber-500/15 to-yellow-600/5 border border-amber-500/25 p-3">
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-lg bg-surface-900/40 border border-white/5 p-2 text-center">
            <div className="text-[9px] text-surface-500 mb-0.5">可用抽数</div>
            <div className="text-lg font-bold text-amber-300 leading-none">{conv.fates}</div>
            <div className="text-[8px] text-surface-500 mt-1">
              {sim ? (regen > 0 ? `原生 + 星辉再生约 ${regen} = ${budget}` : '原生（含星辉换算）') : '全部资源换算'}
            </div>
          </div>
          <div className="rounded-lg bg-surface-900/40 border border-white/5 p-2 text-center">
            <div className="text-[9px] text-surface-500 mb-0.5">达成所需期望抽数</div>
            <div className={`text-lg font-bold leading-none ${enough(needE) ? 'text-emerald-300' : 'text-red-300'}`}>{Math.round(needE)}</div>
            <div className="text-[8px] text-surface-500 mt-1">纯需求口径{enough(needE) ? ' · 资源充足 ✓' : ' · 资源不足'}</div>
          </div>
          <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/25 p-2 text-center">
            <div className="text-[9px] text-emerald-400/80 mb-0.5">全部达成概率</div>
            <div className="text-lg font-bold text-emerald-300 leading-none">{fmtPct(result.PAll)}</div>
            <div className="text-[8px] text-surface-500 mt-1">{sim ? `基于 ${result.trials.toLocaleString()} 次模拟` : '按顺序投入全部抽数'}</div>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]">
          <span className="text-surface-400">保守合计（P75）：<b className={enough(needP75) ? 'text-emerald-300' : 'text-orange-300'}>{Math.round(needP75)}</b> 抽</span>
          <span className="text-surface-500">期望达成 {result.EMet.toFixed(1)}/{result.EMetTotal} 个条目</span>
          {sim && <span className="text-[9px] text-surface-600">充足判断基准 = 可用 {conv.fates} + 星辉再生约 {regen} 抽；实际成功率见模拟结果</span>}
        </div>
      </div>

      {/* 逐池参考与分布 */}
      {result.perPool.map(p => (
        <PoolResultCard key={p.key} p={p} curve={result.curves[p.key]} recycle={recycle} prob={poolProb[p.key]} />
      ))}

      {/* 统一结果分布（模拟）：投入全部资源，按顺序抽取，达到目标即止 */}
      <OutcomeSection result={result} />
    </div>
  )
}

// ═══════════════════════════════════════════
// 统一结果分布（已并入「开始计算」统一运算）
// ═══════════════════════════════════════════
function OutcomeSection({ result }) {
  const dist = result.outcomes
  return (
    <div className="rounded-xl bg-surface-800/40 border border-white/5 p-2.5">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[11px] font-semibold text-surface-300">结果分布</span>
        <span className="text-[9px] text-surface-600">每次模拟投入全部资源 · 按抽取顺序抽取 · 达到目标即止</span>
      </div>
      {dist && dist.rows.length > 0 ? (
        <>
          <div className="flex items-center gap-2 mb-1 text-[8px] text-surface-600">
            <span><span className="text-emerald-300">■</span> 全部达成</span>
            <span><span className="text-yellow-300">■</span> 差 1~2 个</span>
            <span><span className="text-red-300">■</span> 差 3 个及以上</span>
          </div>
          <table className="w-full text-[9px]">
            <thead>
              <tr className="text-surface-600">
                <th className="text-left font-normal py-0.5">结果（已达成物品×数量 · 歪次数）</th>
                <th className="text-right font-normal">概率</th>
              </tr>
            </thead>
            <tbody>
              {dist.rows.map((r, i) => {
                const gap = r.gap || 0
                const cls = gap === 0 ? 'text-emerald-300' : gap <= 2 ? 'text-yellow-300' : 'text-red-300'
                return (
                  <tr key={i} className="border-t border-white/5 hover:bg-white/10 transition-colors">
                    <td className={`py-0.5 ${cls}`}>{r.key}</td>
                    <td className={`text-right font-semibold ${cls}`}>{fmtPct(r.p)}</td>
                  </tr>
                )
              })}
              {dist.other > 0.0005 && (
                <tr className="border-t border-white/5 hover:bg-white/10 transition-colors">
                  <td className="py-0.5 text-surface-500">其他（更罕见结果）</td>
                  <td className="text-right text-surface-500">{fmtPct(dist.other)}</td>
                </tr>
              )}
            </tbody>
          </table>
          <div className="mt-1 text-[8px] text-surface-600">基于 {dist.trials.toLocaleString()} 次模拟（±0.4%），概率为近似值 · 歪 = 抽到非目标/非定轨的五星（集录池小保底歪为非定轨同类型）</div>
        </>
      ) : (
        <div className="text-[10px] text-surface-600 py-1">暂无结果（资源为 0 或未设置目标）</div>
      )}
    </div>
  )
}

function PoolResultCard({ p, curve, recycle, prob }) {
  const meta = POOL_META[p.key]
  const cfg = p.cfg
  // 达成所需期望抽数：纯需求口径（无条件条件均值）——垫池敏感、与曲线一致、Σ 各池 = 合计
  const E = p.need.E
  const ref = p.ref
  const points = [
    { label: '乐观', x: p.need.p25, color: '#34d399' },
    { label: '保守', x: p.need.p75, color: '#f87171' },
  ]

  return (
    <div className={`rounded-xl ${meta.bg} ${meta.border} border p-2.5`}>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-sm">{meta.icon}</span>
        <h4 className={`text-[11px] font-semibold ${meta.color} flex-1`}>{meta.name}</h4>
        <span className="text-[9px] text-surface-500">达成所需</span>
        <span className="text-[13px] font-bold text-amber-300 leading-none">{Math.round(E)}<span className="text-[8px] font-normal text-surface-500 ml-0.5">期望抽</span></span>
        <span className={`text-[10px] font-bold ${prob > 0.9 ? 'text-emerald-300' : prob > 0.6 ? 'text-amber-300' : 'text-red-300'}`}>
          {fmtPct(prob ?? 0)}
        </span>
      </div>
      {/* 本次分析所用的垫池与已拥有参数（可核对输入是否生效） */}
      {cfg && (
        <div className="text-[9px] text-surface-600 mb-1.5">
          垫 {cfg.pity5}/{cfg.pity4} 抽 ·{' '}
          {cfg.kind === 'character'
            ? (cfg.guaranteed ? '大保底' : '小保底') + (cfg.crStreak ? ` · 连保${cfg.crStreak}` : '')
            : `命定值 ${cfg.fate}`}
          {cfg.targets?.some(t => t.epitomized) && (
            <span> · 定轨 {cfg.targets.filter(t => t.epitomized).map(t => t.name).join('、')}</span>
          )}
          {(() => {
            const itemNames = new Set([
              cfg.poolA, cfg.poolB,
              ...(cfg.weapon5 || []),
              ...(cfg.up4 || []),
              ...(cfg.chrono5 || []).map(c => c.name),
              ...(cfg.chrono4 || []).map(c => c.name),
            ].filter(Boolean))
            const ownedShown = Object.entries(cfg.owned || {}).filter(([n]) => itemNames.has(n))
            return ownedShown.length > 0
              ? <span className="text-yellow-300/80"> · 已拥有{ownedShown.map(([n, c]) => ` ${n}×${c}`).join('')}</span>
              : null
          })()}
          {' · 纯需求口径'}
        </div>
      )}

      {/* 参考点：乐观 / 期望 / 保守 */}
      <div className="grid grid-cols-3 gap-1.5 mb-2">
        <div className="rounded-lg bg-surface-900/40 border border-white/5 px-2 py-1.5 flex items-center justify-between gap-1">
          <span className="text-[9px] shrink-0 text-emerald-400">乐观</span>
          <span className="text-[11px] font-semibold text-surface-200">
            {p.need.p25.n}{p.need.p25.truncated ? '+' : ''} 抽
          </span>
          <span className="text-[8px] text-surface-500 shrink-0">{fmtPct(p.need.p25.p)}</span>
        </div>
        <div className="rounded-lg bg-surface-900/40 border border-white/5 px-2 py-1.5 flex items-center justify-between gap-1">
          <span className="text-[9px] shrink-0 text-amber-300">期望</span>
          <span className="text-[11px] font-semibold text-surface-200">{Math.round(E)} 抽</span>
          <span className="text-[8px] text-surface-500 shrink-0">{fmtPct(curve.F[Math.min(ref, curve._n)])}</span>
        </div>
        <div className="rounded-lg bg-surface-900/40 border border-white/5 px-2 py-1.5 flex items-center justify-between gap-1">
          <span className="text-[9px] shrink-0 text-red-400">保守</span>
          <span className="text-[11px] font-semibold text-surface-200">
            {p.need.p75.n}{p.need.p75.truncated ? '+' : ''} 抽
          </span>
          <span className="text-[8px] text-surface-500 shrink-0">{fmtPct(p.need.p75.p)}</span>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-2.5">
        {/* 概率曲线（悬停查看参考点详情） */}
        <div>
          <div className="text-[9px] text-surface-500 mb-1">目标达成概率曲线 · 悬停查看参考点</div>
          <ProbCurve curve={curve} refN={ref} points={points} color={p.key === 'character' ? '#f87171' : p.key === 'weapon' ? '#c084fc' : '#fb923c'} />
        </div>
        {/* 明细 */}
        <div className="space-y-1.5">
          <div className="grid grid-cols-2 gap-1.5">
            <Stat label="期望五星" value={p.E5.toFixed(2)} />
            <Stat label="期望四星" value={p.E4.toFixed(2)} />
          </div>
          {p.truncated && (
            <div className="text-[8px] text-orange-300/70">目标副本数过大或预算不足，曲线已截断至 {curve._n} 抽</div>
          )}
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, accent = 'text-surface-200' }) {
  return (
    <div className="rounded-lg bg-surface-900/40 border border-white/5 px-2 py-1.5 flex items-center justify-between">
      <span className="text-[9px] text-surface-500">{label}</span>
      <span className={`text-[11px] font-semibold ${accent}`}>{value}</span>
    </div>
  )
}

// ═══════════════════════════════════════════
// 概率曲线（SVG）
// ═══════════════════════════════════════════
function ProbCurve({ curve, refN, points, color }) {
  const N = curve._n || 0
  const W = 240, H = 90
  const padL = 26, padR = 6, padT = 8, padB = 14
  const [hover, setHover] = useState(null)
  const x = (n) => padL + (N > 0 ? (n / N) * (W - padL - padR) : padL)
  const y = (v) => padT + (1 - v) * (H - padT - padB)
  const step = Math.max(1, Math.floor(N / 160))
  const pointsArr = []
  for (let n = 0; n <= N; n += step) pointsArr.push(`${x(n).toFixed(1)},${y(curve.F[n]).toFixed(1)}`)
  pointsArr.push(`${x(N).toFixed(1)},${y(curve.F[N]).toFixed(1)}`)
  const area = `${padL},${H - padB} ${pointsArr.join(' ')} ${x(N).toFixed(1)},${H - padB}`
  const markers = [
    { label: '期望', n: Math.min(refN, N), p: curve.F[Math.min(refN, N)], color: '#fcd34d' },
    ...points.map(pt => ({ label: pt.label, n: pt.x.n, p: pt.x.p, color: pt.color })),
  ]
  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    // maxHeight 钳制高度时 SVG 内容会水平 letterbox，需按实际绘制区换算鼠标坐标
    const scale = Math.min(rect.width / W, rect.height / H)
    const offX = (rect.width - W * scale) / 2
    const mx = (e.clientX - rect.left - offX) / scale
    let best = null, bestD = 18
    for (const m of markers) {
      const d = Math.abs(x(m.n) - mx)
      if (d < bestD) { bestD = d; best = m }
    }
    setHover(best ? { ...best, pct: (x(best.n) / W) * 100 } : null)
  }

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-lg bg-surface-900/40 border border-white/5" style={{ maxHeight: 110 }}
        onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {/* 网格 */}
        {[0, 0.25, 0.5, 0.75, 1].map(v => (
          <g key={v}>
            <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
            <text x={padL - 3} y={y(v) + 2.5} textAnchor="end" fontSize="6" fill="rgba(255,255,255,0.35)">{Math.round(v * 100)}%</text>
          </g>
        ))}
        {/* 区域填充 */}
        <polygon points={area} fill={color} opacity="0.12" />
        {/* 曲线 */}
        <polyline points={pointsArr.join(' ')} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
        {/* 参考点（悬停显示详情） */}
        {markers.map(m => (
          <g key={m.label}>
            <line x1={x(m.n)} x2={x(m.n)} y1={padT} y2={H - padB} stroke={m.color} strokeWidth="1" strokeDasharray="3,2" opacity={m.label === '期望' ? 1 : 0.7} />
            <circle cx={x(m.n)} cy={y(m.p)} r="2.5" fill={m.color} />
          </g>
        ))}
        {/* x 轴 */}
        {[0, 0.25, 0.5, 0.75, 1].map(v => (
          <text key={v} x={x(N * v)} y={H - 3} textAnchor="middle" fontSize="6" fill="rgba(255,255,255,0.35)">
            {Math.round(N * v)}
          </text>
        ))}
      </svg>
      {hover && (
        <div className="pointer-events-none absolute -top-1 -translate-x-1/2 z-10 px-2 py-1 rounded-md bg-surface-950/95 border border-white/10 shadow-lg whitespace-nowrap"
          style={{ left: `${hover.pct}%` }}>
          <span className="text-[9px] font-semibold mr-1" style={{ color: hover.color }}>{hover.label}</span>
          <span className="text-[9px] text-surface-300">{hover.n} 抽 · {fmtPct(hover.p)}</span>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════
// 方案编辑器
// ═══════════════════════════════════════════
function PlanEditor({ plan, plans, onBack, onSave, onDelete, query, getImg }) {
  const [draft, setDraft] = useState(() => JSON.parse(JSON.stringify(plan || emptyPlan())))
  const [name, setName] = useState(plan?.name || '')
  const [pickers, setPickers] = useState(null) // { poolKey, slot }
  const [charMap, setCharMap] = useState({})
  const [weaponMap, setWeaponMap] = useState({})
  const [wishList, setWishList] = useState({})
  const [wishBusy, setWishBusy] = useState('')

  // 加载角色/武器全表
  useEffect(() => {
    ;(async () => {
      try {
        const [cs, ws] = await Promise.all([
          query('SELECT id, name_zh, rarity, card_art FROM characters ORDER BY rarity DESC, name_zh'),
          query('SELECT id, name_zh, rarity, simple_art FROM weapons ORDER BY rarity DESC, name_zh'),
        ])
        const cm = {}, wm = {}
        for (const c of (cs.data || [])) cm[c.id] = c
        for (const w of (ws.data || [])) wm[w.id] = w
        setCharMap(cm); setWeaponMap(wm)
      } catch (_) {}
    })()
  }, [query])

  // 从历史卡池载入构成
  const loadFromHistory = useCallback(async (poolKey, wishId) => {
    setWishBusy(poolKey)
    try {
      const w = (wishList[poolKey] || []).find(x => String(x.id) === String(wishId))
      if (!w) return
      const bRes = await query('SELECT * FROM wish_banners WHERE wish_id = ? ORDER BY sort_order, id', [wishId])
      const banners = bRes.data || []
      const iRes = await query(
        `SELECT wbi.* FROM wish_banner_items wbi JOIN wish_banners wb ON wbi.banner_id = wb.id WHERE wb.wish_id = ? ORDER BY wbi.rarity DESC, wbi.sort_order, wbi.id`,
        [wishId]
      )
      const items = iRes.data || []
      const resolve = (item) => {
        if (item.item_type === 'character') return { name: charMap[item.item_id]?.name_zh || '', type: 'char' }
        return { name: weaponMap[item.item_id]?.name_zh || '', type: 'weapon' }
      }
      const named = items.map(it => ({ ...it, ...resolve(it) })).filter(it => it.name)
      if (!named.length && banners.length === 0) {
        alert('该历史卡池在数据库中没有具体卡池物品数据，请改用自定义卡池')
        return
      }
      setDraft(d => {
        const pools = { ...d.pools }
        if (poolKey === 'character') {
          const first = named.filter(it => it.item_type === 'character' && it.rarity === 5)
          const up5A = first[0] || null
          const up5B = first[1] || null
          const up4 = named.filter(it => it.item_type === 'character' && it.rarity === 4).map(it => it.name)
          pools.character = {
            ...pools.character,
            source: 'history',
            wishLabel: `${w.version} · 第${w.phase}期`,
            up5A: up5A ? { name: up5A.name } : null,
            up5B: up5B ? { name: up5B.name } : null,
            up4: [...new Set(up4)].slice(0, 3),
          }
        } else if (poolKey === 'weapon') {
          pools.weapon = {
            ...pools.weapon,
            source: 'history',
            wishLabel: `${w.version} · 第${w.phase}期`,
            up5: named.filter(it => it.item_type === 'weapon' && it.rarity === 5).slice(0, 2).map(it => ({ name: it.name })),
            up4: named.filter(it => it.item_type === 'weapon' && it.rarity === 4).slice(0, 5).map(it => it.name),
          }
        } else {
          pools.chronicled = {
            ...pools.chronicled,
            source: 'history',
            wishLabel: `${w.version} · 第${w.phase}期`,
            items5: named.filter(it => it.rarity === 5).map(it => ({ name: it.name, type: it.type })),
            items4: named.filter(it => it.rarity === 4).map(it => ({ name: it.name, type: it.type })),
          }
        }
        return { ...d, pools }
      })
    } catch (e) {
      alert('加载历史卡池失败：' + e.message)
    } finally { setWishBusy('') }
  }, [query, charMap, weaponMap, wishList])

  // 加载历史卡池下拉
  const ensureWishList = useCallback(async (poolKey, bannerType) => {
    if (wishList[poolKey] || wishBusy) return
    setWishBusy(poolKey)
    try {
      const wRes = await query(
        'SELECT w.id, w.version, w.phase, w.name_zh FROM wishes w WHERE w.banner_type = ? ORDER BY w.version DESC, w.phase DESC LIMIT 60',
        [bannerType]
      )
      const list = (wRes.data || []).map(w => ({
        ...w,
        hasData: true,
        label: `${w.version} 第${w.phase}期${w.name_zh ? ' · ' + w.name_zh : ''}`,
      }))
      setWishList(l => ({ ...l, [poolKey]: list }))
    } catch (_) { setWishList(l => ({ ...l, [poolKey]: [] })) }
    finally { setWishBusy('') }
  }, [query, wishList, wishBusy])

  const patchPool = (poolKey, patch) => setDraft(d => ({ ...d, pools: { ...d.pools, [poolKey]: { ...d.pools[poolKey], ...patch } } }))

  const addItem = (poolKey, item) => {
    setDraft(d => {
      const pools = { ...d.pools }
      const p = { ...pools[poolKey] }
      if (poolKey === 'character') {
        if (item.type === 'char' && item.rarity === 5) {
          if (!p.up5A) p.up5A = { name: item.name }
          else if (!p.up5B) p.up5B = { name: item.name }
          else return d
        } else if (item.type === 'char' && item.rarity === 4) {
          if (p.up4.length < 3 && !p.up4.includes(item.name)) p.up4 = [...p.up4, item.name]
          else return d
        }
      } else if (poolKey === 'weapon') {
        if (item.rarity === 5) {
          if (p.up5.length < 2 && !p.up5.some(x => x.name === item.name)) p.up5 = [...p.up5, { name: item.name }]
          else return d
        } else {
          if (p.up4.length < 5 && !p.up4.includes(item.name)) p.up4 = [...p.up4, item.name]
          else return d
        }
      } else {
        if (item.rarity === 5) {
          if (!p.items5.some(x => x.name === item.name)) p.items5 = [...p.items5, { name: item.name, type: item.type }]
          else return d
        } else {
          if (!p.items4.some(x => x.name === item.name)) p.items4 = [...p.items4, { name: item.name, type: item.type }]
          else return d
        }
      }
      p.source = 'custom'
      return { ...d, pools: { ...pools, [poolKey]: p } }
    })
    setPickers(null)
  }

  const removeItem = (poolKey, name) => {
    setDraft(d => {
      const p = { ...d.pools[poolKey] }
      if (poolKey === 'character') {
        if (p.up5A?.name === name) p.up5A = null
        else if (p.up5B?.name === name) p.up5B = null
        else p.up4 = p.up4.filter(n => n !== name)
      } else if (poolKey === 'weapon') {
        p.up5 = p.up5.filter(x => x.name !== name)
        p.up4 = p.up4.filter(n => n !== name)
      } else {
        p.items5 = p.items5.filter(x => x.name !== name)
        p.items4 = p.items4.filter(x => x.name !== name)
      }
      return { ...d, pools: { ...d.pools, [poolKey]: p } }
    })
  }

  const save = () => {
    if (!name.trim()) { alert('请输入方案名称'); return }
    onSave({ ...draft, id: plan?.id || uid(), name: name.trim() })
  }

  const poolCard = (poolKey) => {
    const p = draft.pools[poolKey]
    const meta = POOL_META[poolKey]
    const isChar = poolKey === 'character'
    const bannerType = isChar ? 'character-event' : poolKey === 'weapon' ? 'weapon-event' : 'chronicled'
    const items = isChar
      ? [p.up5A && { name: p.up5A.name, rarity: 5, type: 'char' }, p.up5B && { name: p.up5B.name, rarity: 5, type: 'char' }]
        .filter(Boolean).concat(p.up4.map(n => ({ name: n, rarity: 4, type: 'char' })))
      : poolKey === 'weapon'
        ? p.up5.map(x => ({ name: x.name, rarity: 5, type: 'weapon' })).concat(p.up4.map(n => ({ name: n, rarity: 4, type: 'weapon' })))
        : p.items5.map(x => ({ ...x, rarity: 5 })).concat(p.items4.map(x => ({ ...x, rarity: 4 })))

    return (
      <div className={`rounded-xl ${meta.bg} ${meta.border} border p-2.5`}>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-sm">{meta.icon}</span>
          <h3 className={`text-[11px] font-semibold ${meta.color} flex-1`}>{meta.name}</h3>
          <label className="flex items-center gap-1 text-[10px] text-surface-400 cursor-pointer select-none">
            <input type="checkbox" checked={p.enabled} onChange={e => patchPool(poolKey, { enabled: e.target.checked })}
              className="w-3 h-3 accent-amber-500" />
            启用
          </label>
        </div>

        {/* 来源 */}
        <div className="flex items-center gap-2 mb-2">
          <select value={p.source} onChange={e => patchPool(poolKey, { source: e.target.value })}
            className="px-2 py-1 rounded-lg bg-surface-800 border border-white/10 text-[10px] text-surface-200 outline-none">
            <option value="custom">自定义卡池</option>
            <option value="history">选择历史卡池</option>
          </select>
          {p.source === 'history' && (
            <>
              <select
                value={p._wishId || ''}
                onClick={() => ensureWishList(poolKey, bannerType)}
                onChange={e => { patchPool(poolKey, { _wishId: e.target.value }); if (e.target.value) loadFromHistory(poolKey, e.target.value) }}
                className="flex-1 min-w-0 px-2 py-1 rounded-lg bg-surface-800 border border-white/10 text-[10px] text-surface-200 outline-none">
                <option value="">选择祈愿板块历史卡池…</option>
                {(wishList[poolKey] || []).map(w => <option key={w.id} value={w.id}>{w.label}</option>)}
              </select>
              {wishBusy === poolKey && <RefreshCw className="w-3 h-3 text-surface-500 animate-spin shrink-0" />}
            </>
          )}
          <span className="text-[9px] text-surface-500 flex-1 text-right">{p.wishLabel || ''}</span>
        </div>

        {/* 物品列表 */}
        <div className="flex flex-wrap gap-1.5">
          {items.map(it => (
            <div key={it.name} className="flex items-center gap-1 px-1.5 py-1 rounded-lg bg-surface-800/70 border border-white/10">
              <span className={`text-[10px] ${it.rarity === 5 ? 'text-amber-300' : 'text-purple-300'}`}>
                {'★'.repeat(it.rarity)}
              </span>
              <span className="text-[10px] text-surface-200 max-w-[72px] truncate">{it.name}</span>
              {it.type === 'weapon' && <span className="text-[8px] text-surface-600">武</span>}
              <button onClick={() => removeItem(poolKey, it.name)}
                className="w-3.5 h-3.5 rounded bg-white/5 hover:bg-red-500/20 text-surface-500 hover:text-red-300 flex items-center justify-center">
                <X className="w-2 h-2" />
              </button>
            </div>
          ))}
          <button onClick={() => setPickers({ poolKey, type: isChar ? 'char' : poolKey === 'weapon' ? 'weapon' : 'any' })}
            className="flex items-center gap-1 px-2 py-1 rounded-lg border border-dashed border-white/20 hover:border-amber-500/40 hover:text-amber-300 text-surface-500 text-[10px] transition-colors">
            <Plus className="w-3 h-3" />添加物品
          </button>
        </div>
        <div className="text-[8px] text-surface-600 mt-1.5">
          {isChar ? '角色池 1~2 个五星 UP + 最多 3 个四星 UP（与另一池共享保底，歪常驻五星自动计入模型）'
            : poolKey === 'weapon' ? '武器池 2 个五星 UP + 5 个四星 UP（歪常驻五星自动计入模型）'
              : '集录祈愿池内五星/四星（定轨后五星只会是池内同类型物品）'}
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-surface-900/95 text-surface-100" style={{ fontSize: 'clamp(10px,0.7vw + 6px,15px)' }}>
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-white/5 shrink-0">
        <button onClick={onBack} className="p-1 rounded-md text-surface-400 hover:text-white hover:bg-white/10 transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h2 className="text-sm font-semibold text-white flex-1">卡池组合方案</h2>
        {plan && (
          <button onClick={() => onDelete(plan.id)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-red-400 hover:bg-red-500/10 text-[10px] transition-colors">
            <Trash2 className="w-3 h-3" />删除
          </button>
        )}
        <button onClick={save}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-[10px] font-medium transition-colors">
          <Save className="w-3 h-3" />保存方案
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        <div className="rounded-xl bg-surface-800/40 border border-white/5 p-2.5">
          <label className="text-[9px] text-surface-500 mb-1 block">方案名称</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="例如：6.6 版本双池计划"
            className="w-full px-3 py-2 rounded-lg bg-surface-800/80 border border-white/10 text-xs text-surface-200 placeholder-surface-600 outline-none focus:border-amber-500/50" />
        </div>
        {poolCard('character')}
        {poolCard('weapon')}
        {poolCard('chronicled')}
        <div className="text-[9px] text-surface-600 leading-relaxed px-1">
          自定义卡池可完全模拟任意一期卡池构成（包括历史卡池数据缺失的版本）；
          常驻五星/四星作为「歪」的对象已自动计入模型，无需手动添加。
        </div>
      </div>

      {/* 物品选择器 */}
      {pickers && (
        <ItemPicker
          type={pickers.type}
          charMap={charMap}
          weaponMap={weaponMap}
          onPick={item => addItem(pickers.poolKey, item)}
          onClose={() => setPickers(null)}
        />
      )}
    </div>
  )
}

// ═══════════════════════════════════════════
// 物品选择器（角色/武器搜索）
// ═══════════════════════════════════════════
function ItemPicker({ type, charMap, weaponMap, onPick, onClose, forceRarity }) {
  const [kw, setKw] = useState('')
  const [rarity, setRarity] = useState(forceRarity || 0) // 0 = 全部
  const chars = Object.values(charMap)
  const weapons = Object.values(weaponMap)
  const list = useMemo(() => {
    const src = type === 'weapon' ? weapons : type === 'char' ? chars : [...chars.map(c => ({ ...c, __type: 'char' })), ...weapons.map(w => ({ ...w, __type: 'weapon' }))]
    const q = kw.trim()
    return src
      .filter(it => it.rarity === 5 || it.rarity === 4)
      .filter(it => !rarity || it.rarity === rarity)
      .filter(it => !q || (it.name_zh || '').includes(q))
      .sort((a, b) => b.rarity - a.rarity || (a.name_zh || '').localeCompare(b.name_zh || '', 'zh'))
  }, [type, chars, weapons, kw, rarity])

  const r5 = list.filter(it => it.rarity === 5)
  const r4 = list.filter(it => it.rarity === 4)

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-sm max-h-[75%] flex flex-col rounded-xl bg-surface-800 border border-white/10 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-white/5">
          <Search className="w-3.5 h-3.5 text-surface-500 shrink-0" />
          <input autoFocus value={kw} onChange={e => setKw(e.target.value)} placeholder="搜索物品名称…"
            className="flex-1 bg-transparent text-xs text-surface-200 placeholder-surface-600 outline-none" />
          <button onClick={onClose} className="p-1 rounded text-surface-500 hover:text-white hover:bg-white/10"><X className="w-3.5 h-3.5" /></button>
        </div>
        {!forceRarity && (
          <div className="flex gap-1 px-3 py-1.5 border-b border-white/5">
            {[[0, '全部'], [5, '五星'], [4, '四星']].map(([v, label]) => (
              <button key={v} onClick={() => setRarity(v)}
                className={`px-2 py-0.5 rounded-full text-[9px] transition-colors ${rarity === v ? 'bg-amber-500/20 text-amber-300' : 'text-surface-500 hover:text-surface-300'}`}>
                {label}
              </button>
            ))}
            <span className="flex-1 text-right text-[8px] text-surface-600">{list.length} 项</span>
          </div>
        )}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {[5, 4].map(r => (
            <div key={r}>
              {!forceRarity && (r === 5 ? r5 : r4).length > 0 && (
                <div className="px-1 py-0.5 text-[8px] text-surface-600 sticky top-0 bg-surface-800/90 backdrop-blur">{r === 5 ? '★ 五星' : '★ 四星'}</div>
              )}
              {(r === 5 ? r5 : r4).map(it => (
                <button key={it.id + (it.__type || type)} onClick={() => onPick({
                  name: it.name_zh, rarity: it.rarity, type: it.__type || (type === 'any' ? 'weapon' : type === 'char' ? 'char' : 'weapon'),
                })}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/10 transition-colors text-left">
                  <span className={`text-[10px] ${it.rarity === 5 ? 'text-amber-300' : 'text-purple-300'}`}>{'★'.repeat(it.rarity)}</span>
                  <span className="text-[11px] text-surface-200 flex-1">{it.name_zh}</span>
                  <span className="text-[8px] text-surface-600">{it.__type === 'char' || type === 'char' ? '角色' : '武器'}</span>
                </button>
              ))}
            </div>
          ))}
          {list.length === 0 && <div className="text-center text-[10px] text-surface-600 py-6">未找到匹配物品</div>}
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════
// 环绕步进调节（min~max 环绕：min 减 1 → max，max 加 1 → min；聚焦全选便于直接输入）
// ═══════════════════════════════════════════
function WrapStepper({ value, min = 0, max = 7, onChange }) {
  return (
    <div className="flex items-center gap-0.5 shrink-0">
      <button onClick={() => onChange(value <= min ? max : value - 1)}
        className="w-4 h-4 rounded bg-white/5 hover:bg-white/15 text-surface-400 hover:text-white text-[10px] leading-none">−</button>
      <input type="number" min={min} max={max} value={value}
        onFocus={e => e.target.select()}
        onChange={e => {
          let v = parseInt(e.target.value, 10)
          if (isNaN(v)) v = min
          onChange(Math.max(min, Math.min(max, v)))
        }}
        className="w-8 bg-transparent text-center text-[10px] text-surface-200 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
      <button onClick={() => onChange(value >= max ? min : value + 1)}
        className="w-4 h-4 rounded bg-white/5 hover:bg-white/15 text-surface-400 hover:text-white text-[10px] leading-none">+</button>
    </div>
  )
}

// ═══════════════════════════════════════════
// 抽取顺序栏（拖拽排序，每副本一条目）
// ═══════════════════════════════════════════
function OrderBar({ order, probs, charMap, weaponMap, getImg, onReorder }) {
  const [dragIdx, setDragIdx] = useState(null)
  const [overIdx, setOverIdx] = useState(null)
  const [imgs, setImgs] = useState({})

  // 条目图片（角色头像 / 武器图）
  useEffect(() => {
    let c = false
    const load = async () => {
      const m = {}
      for (const o of order) {
        const key = `${o.poolKey}::${o.name}`
        if (m[key]) continue
        const file = poolItemImg(o.poolKey, o.name, charMap, weaponMap)
        if (file) {
          const src = await getImg(file)
          if (src) m[key] = src
        }
      }
      if (!c) setImgs(m)
    }
    load()
    return () => { c = true }
  }, [order, charMap, weaponMap, getImg])

  const drop = (to) => {
    if (dragIdx === null || dragIdx === to) { setDragIdx(null); setOverIdx(null); return }
    onReorder(dragIdx, to)
    setDragIdx(null); setOverIdx(null)
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {order.map((o, i) => {
        const key = `${o.poolKey}::${o.name}`
        const meta = POOL_META[o.poolKey]
        const prob = probs && probs.length === order.length ? probs[i] : null
        return (
          <div key={key + '-' + i}
            draggable
            onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; setDragIdx(i) }}
            onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOverIdx(i) }}
            onDragLeave={() => setOverIdx(prev => prev === i ? null : prev)}
            onDrop={e => { e.preventDefault(); drop(i) }}
            onDragEnd={() => { setDragIdx(null); setOverIdx(null) }}
            className={`group flex items-center gap-1.5 px-1.5 py-1 rounded-lg border cursor-grab active:cursor-grabbing transition-colors ${
              overIdx === i && dragIdx !== null && dragIdx !== i
                ? 'border-amber-500/60 bg-amber-500/10'
                : dragIdx === i ? 'border-amber-500/40 bg-amber-500/5 opacity-60'
                  : 'border-white/10 bg-surface-800/70 hover:border-white/25'
            }`}
          >
            <div className="w-5 h-5 rounded-md bg-surface-700 overflow-hidden flex items-center justify-center shrink-0">
              {imgs[key] ? (
                <img src={imgs[key]} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="text-[10px]">{meta.icon}</span>
              )}
            </div>
            <span className="text-[10px] text-surface-200 max-w-[72px] truncate">{o.name}</span>
            <span className={`text-[8px] shrink-0 ${o.copy > 1 ? 'text-amber-300' : 'text-surface-600'}`}>
              #{o.copy}
            </span>
            {prob && (
              <span className={`text-[9px] font-semibold shrink-0 ${prob.P > 0.9 ? 'text-emerald-300' : prob.P > 0.6 ? 'text-amber-300' : 'text-red-300'}`}>
                {fmtPct(prob.P)}
              </span>
            )}
            <span className="text-[8px] text-surface-600 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">⠿</span>
          </div>
        )
      })}
    </div>
  )
}

// 从全库映射查找条目图片文件
function poolItemImg(poolKey, name, charMap, weaponMap) {
  const c = Object.values(charMap).find(x => x.name_zh === name)
  if (c) return c.card_art || null
  const w = Object.values(weaponMap).find(x => x.name_zh === name)
  return w?.simple_art || null
}

// ═══════════════════════════════════════════
// 材料缩略图
// ═══════════════════════════════════════════
function MaterialThumb({ imgFile, getImg, className }) {
  const [src, setSrc] = useState(null)
  const [err, setErr] = useState(false)
  useEffect(() => {
    let c = false
    getImg(imgFile).then(d => { if (!c && d) setSrc(d); else if (!c) setErr(true) })
    return () => { c = true }
  }, [imgFile, getImg])
  if (err) return <div className={`${className} bg-surface-700 flex items-center justify-center`}><Landmark className="w-3 h-3 text-surface-500" /></div>
  if (!src) return <div className={`${className} bg-surface-700/50 animate-pulse`} />
  return <img src={src} alt="" className={`${className} object-cover`} />
}

// ═══════════════════════════════════════════
// 运行时池配置构建
// ═══════════════════════════════════════════
function buildRuntimePools(plan, session, std4Counts, nonUp4Glitter = 5, accountData = null) {
  const pools = []
  const push = (key, poolCfg) => {
    const s = session[key]
    if (!poolCfg.enabled || !s?.enabled) return
    const targets = []
    const types = s.types || {}
    for (const [name, copies] of Object.entries(s.targets || {})) {
      if (!copies || copies < 1) continue
      if (name === '__any4__') {
        targets.push({ id: '__any4__', name: '__any4__', rarity: 4, copies })
        continue
      }
      const is5 = poolCfg.is5(name)
      const type = types[name] || (poolCfg.typeOf ? poolCfg.typeOf(name) : 'char')
      targets.push({ id: key + '-' + name, name, rarity: is5 ? 5 : 4, copies, type })
    }
    // 集录祈愿主要抽五星：过滤四星目标
    const finalTargets = key === 'chronicled' ? targets.filter(t => t.rarity !== 4) : targets
    if (!finalTargets.length) return
    pools.push({
      key, kind: key, name: POOL_META[key].name,
      ...poolCfg.cfg,
      // 应用世界树账号数据后：已拥有数量与非UP四星分层均来自账号，手动参数不再生效
      owned: accountData ? accountData.ownedMap : (s.owned || {}),
      std4Counts,
      nonUp4Glitter: accountData ? accountData.nonUp4Avg : nonUp4Glitter,
      pity5: s.pity5, pity4: s.pity4, guaranteed: s.guaranteed || 0, crStreak: s.crStreak || 0, fate: s.fate || 0,
      targets: finalTargets.map(t => ({
        ...t,
        // 集录祈愿可角色/武器分别定轨（数组）；其余池单一
        epitomized: Array.isArray(s.epitomized) ? s.epitomized.includes(t.name) : s.epitomized === t.name,
      })),
    })
  }

  const c = plan.pools?.character || {}
  push('character', {
    enabled: c.enabled,
    is5: (n) => c.up5A?.name === n || c.up5B?.name === n,
    cfg: { poolA: c.up5A?.name || null, poolB: c.up5B?.name || null, up4: c.up4 || [] },
  })

  const w = plan.pools?.weapon || {}
  push('weapon', {
    enabled: w.enabled,
    is5: (n) => (w.up5 || []).some(x => x.name === n),
    cfg: { weapon5: (w.up5 || []).map(x => x.name), up4: w.up4 || [] },
  })

  const ch = plan.pools?.chronicled || {}
  push('chronicled', {
    enabled: ch.enabled,
    is5: (n) => (ch.items5 || []).some(x => x.name === n),
    typeOf: (n) => (ch.items5 || []).find(x => x.name === n)?.type || (ch.items4 || []).find(x => x.name === n)?.type || 'char',
    cfg: { chrono5: ch.items5 || [], chrono4: ch.items4 || [] },
  })

  return pools
}

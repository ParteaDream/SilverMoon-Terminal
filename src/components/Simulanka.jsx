// ═════════════════════════════════════════════════════════════════
// 希穆兰卡 · 祈愿模拟器（终端小程序）
// ─────────────────────────────────────────────────────────────────
// 视图：存档库 → 模拟前配置 → 抽卡（祈愿 / 记录 / 数据）
// 存档：模拟进度连同祈愿方案、剩余资源、抽取历史整体落库（user.db: wish_sim_archives）。
//       「继续进度」按用户约定走另存为：载入旧存档后以新 id 保存，原存档保持不动。
// 规则：全部依据数据库词条《祈愿 · 祈愿机制》《祈愿 · 保底机制》《祈愿 · 集录祈愿》，
//       概率与状态机实现在 src/utils/wishSimulator.js。
// ═════════════════════════════════════════════════════════════════
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import {
  Sparkles, Plus, FolderOpen, Trash2, Pencil, Play, ChevronLeft,
  ListOrdered, BarChart3, Star, X, Check, AlertCircle, Copy,
} from 'lucide-react'
import { useDb } from '../context/DbContext'
import { useTerminal } from '../context/TerminalContext'
import useOverlay from '../hooks/useOverlay'
import {
  POOL_IDS, POOL_LABEL, SIM_ARCHIVE_VERSION, createRuntime, reviveRuntime,
  drawMany, normalizeResources, emptyResources, emptyPityState, grantResources, planPullFunding,
  exchangeGenesisForPrimogem,
  exchangeByGlitter, exchangeByStardust, GLITTER_PER_FATE, STARDUST_PER_FATE,
  STARDUST_FATE_MONTHLY_LIMIT,
} from '../utils/wishSimulator.js'
import {
  loadSimRoster, buildPoolDefs, emptyPoolConfig, listImportableWishes, loadWishDetail,
  slimArchiveRecords, rehydrateArchiveRecords,
} from '../utils/wishSimData.js'
import { SimButton, SimEmpty, SimCurrencyIcon, CURRENCY_LABEL } from './SimulankaShared'
import SimulankaSetup from './SimulankaSetup'
import SimulankaGacha from './SimulankaGacha'
import SimulankaWishFx from './SimulankaWishFx'
import { SimulankaRecords, SimulankaStats } from './SimulankaPanels'
import SimulankaShop, { GenesisConvertPanel } from './SimulankaShop'

export const SIMULANKA_APP_ID = 'simulanka'

// ── 运行时浅拷贝（只重建需要新身份的字段，records 用 slice 保持 O(n) 指针复制）──
function cloneRuntime(rt) {
  return {
    ...rt,
    resources: { ...rt.resources },
    pity: Object.fromEntries(Object.entries(rt.pity).map(([k, v]) => [k, { ...v }])),
    obtained: { ...rt.obtained },
    epicomized: { ...rt.epicomized },
    spend: { ...rt.spend },
    records: rt.records.slice(),
    recharges: (rt.recharges || []).slice(),
  }
}

function newId() {
  return `sim_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function defaultConfig() {
  return { pools: emptyPoolConfig(), sourceWish: null, animations: true, dialogs: true }
}

// ═════════════════════════════════════════════════════════════════
export default function Simulanka() {
  const { query } = useDb()
  const { runningApps } = useTerminal()
  const location = useLocation()

  const [roster, setRoster] = useState(null)
  const [booting, setBooting] = useState(true)
  const [bootError, setBootError] = useState('')

  const [archives, setArchives] = useState([])
  const [view, setView] = useState('library')      // library | setup | play
  const [tab, setTab] = useState('wish')           // wish | records | stats

  const [config, setConfig] = useState(defaultConfig)
  const [draftResources, setDraftResources] = useState(() => ({ ...emptyResources(), genesis: 6480, primogem: 16000, intertwined: 50, acquaint: 20 }))
  const [draftPity, setDraftPity] = useState(emptyPityState)
  const [draftRecords, setDraftRecords] = useState([])

  const runtimeRef = useRef(null)
  const [runtime, setRuntime] = useState(null)
  const [activePool, setActivePool] = useState('character1')
  const [archiveId, setArchiveId] = useState(null)
  const [archiveName, setArchiveName] = useState('新的模拟')
  const [dirty, setDirty] = useState(false)
  const [savedTick, setSavedTick] = useState(0)   // 自动保存成功一次就自增，用于展示「已自动保存」
  const [toast, setToast] = useState('')
  const [fx, setFx] = useState(null)
  const [shopOpen, setShopOpen] = useState(false)
  const [convertOpen, setConvertOpen] = useState(false)
  const [pullConfirm, setPullConfirm] = useState(null)   // { poolId, count, plan }
  const [shortInfo, setShortInfo] = useState(null)       // { poolId, count, shortfall }
  const [saveAsOpen, setSaveAsOpen] = useState(false)
  const [animations, setAnimationsState] = useState(true)
  // 弹窗开关：关闭后祈愿不再弹「自动转化并祈愿」确认框，直接转化并开抽；
  // 资源真不足时仍然会提示（那是错误信息，不是可跳过的确认）
  const [dialogs, setDialogsState] = useState(true)

  const showToast = useCallback((msg) => {
    setToast(msg)
    setTimeout(() => setToast(''), 2000)
  }, [])

  // ── 当前窗口是否为本应用（顶层可见窗口）——用于给全局键位加闸 ──
  const appActive = useMemo(() => {
    const me = runningApps.find(a => a.id === SIMULANKA_APP_ID)
    if (!me || me.state?.hidden) return false
    const page = me.state?.showOnPage || '/terminal'
    if (page !== '*' && page !== location.pathname) return false
    const visible = runningApps.filter(a => {
      if (a.state?.hidden) return false
      const p = a.state?.showOnPage || '/terminal'
      return p === '*' || p === location.pathname
    })
    const top = visible.reduce((m, a) => Math.max(m, a.state?.zIndex || 0), 0)
    return (me.state?.zIndex || 0) >= top
  }, [runningApps, location.pathname])

  // ── 启动：装配花名册 + 读取存档列表 ──
  useEffect(() => {
    let cancelled = false
    setBooting(true)
    ;(async () => {
      try {
        const r = await loadSimRoster(query)
        if (cancelled) return
        setRoster(r)
        const list = await window.electronAPI?.wishsimListArchives?.()
        if (cancelled) return
        setArchives(list?.archives || [])
        setBootError('')
      } catch (e) {
        if (!cancelled) setBootError(String(e?.message || e))
      } finally {
        if (!cancelled) setBooting(false)
      }
    })()
    return () => { cancelled = true }
  }, [query])

  // ── 默认卡池：取各类型「数据完整」的最新一期历史卡池预填，开箱即用 ──
  // 注意：最新一期可能尚未爬取（wish_banner_items 缺四星、banner_image 为空），
  // 故按「有卡池图 + 有五星 UP + 有四星 UP」筛选，取满足条件的最新一期。
  const buildDefaultConfig = useCallback(async () => {
    const base = defaultConfig()
    const list = await listImportableWishes(query)
    const complete = (type, pools) => {
      if (!pools) return false
      if (type === 'character-event') {
        const p = pools.character1
        return !!(p && (p.bannerImages || []).length && p.up5?.length && p.up4?.length)
      }
      if (type === 'weapon-event') {
        const p = pools.weapon
        return !!(p && (p.bannerImages || []).length && p.up5?.length >= 2 && p.up4?.length)
      }
      if (type === 'standard') {
        const p = pools.standard
        return !!(p && (p.bannerImages || []).length)
      }
      const p = pools.chronicled
      return !!(p && (p.bannerImages || []).length && p.pool5?.length >= 3)
    }
    const pickLatest = async (type) => {
      const candidates = list.filter(w => w.banner_type === type).slice(0, 8)
      for (const w of candidates) {
        const d = await loadWishDetail(query, w.id, roster)
        if (d && complete(type, d.pools)) return d
      }
      // 全部不完整时退回最新一期（至少有卡池结构）
      return candidates[0] ? loadWishDetail(query, candidates[0].id, roster) : null
    }
    try {
      const [c, w, ch, st] = await Promise.all([
        pickLatest('character-event'), pickLatest('weapon-event'),
        pickLatest('chronicled'), pickLatest('standard'),
      ])
      if (c?.pools) {
        if (c.pools.character1) base.pools.character1 = { ...base.pools.character1, ...c.pools.character1 }
        if (c.pools.character2) base.pools.character2 = { ...base.pools.character2, ...c.pools.character2, enabled: true }
        else base.pools.character2 = { ...base.pools.character2, enabled: false }
        base.sourceWish = { version: c.wish.version, phase: c.wish.phase, id: c.wish.id }
      }
      if (w?.pools?.weapon) base.pools.weapon = { ...base.pools.weapon, ...w.pools.weapon }
      if (ch?.pools?.chronicled) base.pools.chronicled = { ...base.pools.chronicled, ...ch.pools.chronicled }
      if (st?.pools?.standard) base.pools.standard = { ...base.pools.standard, ...st.pools.standard }
    } catch (_) { /* 预填失败不阻塞新建 */ }
    return base
  }, [query, roster])

  // ── 卡池定义 ──
  const pools = useMemo(() => (roster ? buildPoolDefs(config.pools, roster) : {}), [config.pools, roster])

  // ═════════════════════════════════════════════════════════════
  // 存档操作
  // ═════════════════════════════════════════════════════════════════
  const refreshArchives = useCallback(async () => {
    const list = await window.electronAPI?.wishsimListArchives?.()
    setArchives(list?.archives || [])
  }, [])

  // 防抖保存发生在 setTimeout 里，闭包会读到旧 state —— 统一镜像到 ref 取最新值
  const archiveIdRef = useRef(null)
  const archiveNameRef = useRef(archiveName)
  const configRef = useRef(config)
  const draftResRef = useRef(draftResources)
  const draftPityRef = useRef(draftPity)
  const draftRecsRef = useRef(draftRecords)
  useEffect(() => { archiveNameRef.current = archiveName }, [archiveName])
  useEffect(() => { configRef.current = config }, [config])
  useEffect(() => { draftResRef.current = draftResources }, [draftResources])
  useEffect(() => { draftPityRef.current = draftPity }, [draftPity])
  useEffect(() => { draftRecsRef.current = draftRecords }, [draftRecords])

  /**
   * 组装存档内容。
   * 阶段（stage）也是存档的一部分：配置阶段的草稿（资源/垫池/历史）同样要存，
   * 这样从存档库打开一个还没开始的存档，能回到配置界面接着编排。
   */
  const buildPayload = useCallback((nameOverride) => {
    const rt = runtimeRef.current
    const stage = rt ? 'play' : 'setup'
    return {
      version: SIM_ARCHIVE_VERSION,
      name: nameOverride || archiveNameRef.current,
      config: configRef.current,
      savedAt: new Date().toISOString(),
      stage,
      draft: stage === 'setup' ? {
        resources: draftResRef.current,
        pity: draftPityRef.current,
        // 导入的历史记录动辄四五千条，落库前压成精简形态，读档时用 roster 还原
        records: slimArchiveRecords(draftRecsRef.current),
      } : null,
      runtime: rt ? { ...rt, records: slimArchiveRecords(rt.records) } : null,
    }
  }, [])

  /** 在存档库里取一个不重名的自动名（新的模拟 / 新的模拟 2 / …） */
  const nextAutoName = useCallback(async (base) => {
    const list = await window.electronAPI?.wishsimListArchives?.()
    const used = new Set((list?.archives || []).map(a => a.name))
    let name = base
    for (let i = 2; used.has(name) && i < 999; i++) name = `${base} ${i}`
    return name
  }, [])

  /**
   * 保存 = **写回本存档**。
   * 新模型下每条会话从建立那一刻起就绑定一个存档 id，这里永远是 UPDATE，
   * 绝不会新建存档（要另建请用「另存为」或存档库的「复制」）。
   */
  const saveToCurrent = useCallback(async () => {
    const id = archiveIdRef.current
    if (!id) return null
    const res = await window.electronAPI?.wishsimSaveArchive?.({
      id, name: archiveNameRef.current, data: buildPayload(),
    })
    if (res?.success) {
      setDirty(false)
      setSavedTick(t => t + 1)
      await refreshArchives()
      return id
    }
    showToast(res?.error || '保存失败')
    return null
  }, [buildPayload, refreshArchives, showToast])

  /** 另存为：另建一条存档并把会话切过去（此后自动保存都写这条新的） */
  const saveAsCopy = useCallback(async (name) => {
    const id = newId()
    const res = await window.electronAPI?.wishsimSaveArchive?.({ id, name, data: buildPayload(name) })
    if (!res?.success) { showToast(res?.error || '另存为失败'); return null }
    archiveIdRef.current = id
    archiveNameRef.current = name
    setArchiveId(id)
    setArchiveName(name)
    setDirty(false)
    setSavedTick(t => t + 1)
    await refreshArchives()
    return id
  }, [buildPayload, refreshArchives, showToast])

  /** 关掉所有临时浮层（祈愿动画 / 商城 / 结晶转换 / 确认框）。
   *  新建模拟、载入存档时都必须调用 —— 否则动画浮层会残留并盖住新界面。 */
  const closeTransientUi = useCallback(() => {
    setFx(null)
    setShopOpen(false)
    setConvertOpen(false)
    setPullConfirm(null)
    setShortInfo(null)
  }, [])

  /**
   * 新建模拟：**立刻**落一条存档（不再等第一次保存才创建），
   * 之后配置阶段与模拟阶段的所有改动都自动写回这条存档。
   */
  const handleNew = useCallback(async (opts = {}) => {
    const cfg = opts.config || await buildDefaultConfig()
    const name = opts.name || await nextAutoName('新的模拟')
    const id = opts.id || newId()
    const resources = { ...emptyResources(), genesis: 6480, primogem: 16000, intertwined: 50, acquaint: 20 }
    const pity = emptyPityState()

    setConfig(cfg); configRef.current = cfg
    setAnimationsState(cfg.animations !== false)
    setDialogsState(cfg.dialogs !== false)
    setDraftResources(resources); draftResRef.current = resources
    setDraftPity(pity); draftPityRef.current = pity
    setDraftRecords([]); draftRecsRef.current = []
    setRuntime(null)
    runtimeRef.current = null
    setActivePool('character1')
    closeTransientUi()

    archiveIdRef.current = id
    archiveNameRef.current = name
    setArchiveId(id)
    setArchiveName(name)
    setDirty(false)

    await window.electronAPI?.wishsimSaveArchive?.({
      id, name,
      data: {
        version: SIM_ARCHIVE_VERSION,
        name,
        config: cfg,
        savedAt: new Date().toISOString(),
        stage: 'setup',
        draft: { resources, pity, records: [] },
        runtime: null,
      },
    })
    await refreshArchives()
    skipSetupSaveRef.current = true
    setView('setup')
    setTab('wish')
  }, [buildDefaultConfig, nextAutoName, closeTransientUi, refreshArchives])

  /**
   * 打开存档 = **进入该存档本身**（就地编辑，不产生副本）。
   * 配置阶段的存档回到配置界面，已开始的存档直接进抽卡界面。
   */
  const handleLoad = useCallback(async (id) => {
    const res = await window.electronAPI?.wishsimLoadArchive?.(id)
    if (!res?.success) { showToast(res?.error || '读取失败'); return }
    const data = res.archive?.data || {}
    const name = res.archive.name || '未命名存档'
    const cfg = data.config || defaultConfig()
    setConfig(cfg); configRef.current = cfg
    setAnimationsState(cfg.animations !== false)
    setDialogsState(cfg.dialogs !== false)
    archiveIdRef.current = id
    archiveNameRef.current = name
    setArchiveId(id)
    setArchiveName(name)
    setDirty(false)
    closeTransientUi()
    setTab('wish')

    if (data.stage === 'setup' || !data.runtime) {
      // 还没开始模拟：回配置界面，并把草稿一起恢复
      const dr = data.draft?.resources || { ...emptyResources(), genesis: 6480, primogem: 16000, intertwined: 50, acquaint: 20 }
      const dp = data.draft?.pity || emptyPityState()
      const drecs = rehydrateArchiveRecords(data.draft?.records || [], roster)
      setDraftResources(dr); draftResRef.current = dr
      setDraftPity(dp); draftPityRef.current = dp
      setDraftRecords(drecs); draftRecsRef.current = drecs
      setRuntime(null)
      runtimeRef.current = null
      setActivePool('character1')
      skipSetupSaveRef.current = true
      setView('setup')
      showToast(`已打开存档「${name}」（配置阶段）`)
      return
    }

    const rt = reviveRuntime(data.runtime, emptyResources())
    rt.records = rehydrateArchiveRecords(rt.records, roster)
    runtimeRef.current = rt
    setRuntime(rt)
    setDraftRecords([]); draftRecsRef.current = []
    setActivePool(POOL_IDS.find(p => cfg.pools?.[p]) || 'character1')
    setView('play')
    showToast(`已打开存档「${name}」`)
  }, [defaultConfig, roster, showToast, closeTransientUi])

  const handleDelete = useCallback(async (id, name) => {
    if (!window.confirm(`确定删除存档「${name}」？此操作不可撤销。`)) return
    const res = await window.electronAPI?.wishsimDeleteArchive?.(id)
    if (res?.success) {
      if (archiveIdRef.current === id) {
        archiveIdRef.current = null
        setArchiveId(null)
        setView('library')
      }
      await refreshArchives()
      showToast('已删除')
    } else showToast(res?.error || '删除失败')
  }, [refreshArchives, showToast])

  const handleRename = useCallback(async (id, name) => {
    const clean = String(name || '').trim()
    if (!clean) return false
    const res = await window.electronAPI?.wishsimRenameArchive?.(id, clean)
    if (res?.success) {
      if (archiveIdRef.current === id) { archiveNameRef.current = clean; setArchiveName(clean) }
      await refreshArchives()
      showToast('已重命名')
      return true
    }
    showToast(res?.error || '重命名失败')
    return false
  }, [refreshArchives, showToast])

  /** 复制存档：读出来另存一份，名字自动加「· 副本」（重名再补序号） */
  const handleDuplicate = useCallback(async (id) => {
    const res = await window.electronAPI?.wishsimLoadArchive?.(id)
    if (!res?.success) { showToast(res?.error || '读取失败'); return }
    const src = res.archive
    const name = await nextAutoName(`${src.name} · 副本`)
    const save = await window.electronAPI?.wishsimSaveArchive?.({
      id: newId(), name, data: { ...(src.data || {}), name, savedAt: new Date().toISOString() },
    })
    if (save?.success) { await refreshArchives(); showToast(`已复制为「${name}」`) }
    else showToast(save?.error || '复制失败')
  }, [nextAutoName, refreshArchives, showToast])

  // ── 自动保存（配置变更 / 抽卡 / 商城操作后，防抖写回本存档）──
  const saveTimerRef = useRef(0)
  const scheduleAutoSave = useCallback(() => {
    setDirty(true)
    clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => { saveToCurrent() }, 700)
  }, [saveToCurrent])
  useEffect(() => () => clearTimeout(saveTimerRef.current), [])

  // 配置阶段的改动同样自动保存（卡池编排、初始资源、垫池与历史导入…）。
  // 刚新建/刚打开时状态是"装填"进来的，不是用户改的，跳过那一次以免无谓回写。
  const skipSetupSaveRef = useRef(false)
  useEffect(() => {
    if (view !== 'setup' || !archiveId) return
    if (skipSetupSaveRef.current) { skipSetupSaveRef.current = false; return }
    scheduleAutoSave()
  }, [view, archiveId, config, draftResources, draftPity, draftRecords, scheduleAutoSave])

  // ═════════════════════════════════════════════════════════════
  // 开始模拟 / 抽卡
  // ═════════════════════════════════════════════════════════════
  const handleStart = useCallback(() => {
    const rt = createRuntime(draftResources)
    rt.pity = { ...emptyPityState(), ...draftPity }
    for (const k of Object.keys(rt.pity)) rt.pity[k] = { ...emptyPityState()[k], ...rt.pity[k], kind: k }
    if (draftRecords?.length) {
      rt.records = draftRecords.slice()
      rt.seq = rt.records.length
      for (const r of rt.records) {
        const key = `${r.itemType}:${r.itemId}`
        rt.obtained[key] = (rt.obtained[key] || 0) + 1
      }
    }
    // 武器池默认定轨第一把 UP
    const wUp = config.pools?.weapon?.up5 || []
    if (wUp[0]) rt.epicomized.weapon = wUp[0].key
    runtimeRef.current = rt
    setRuntime(rt)
    setView('play')
    setTab('wish')
    setActivePool(POOL_IDS.find(p => pools[p]) || 'character1')
    // 立刻写回本存档：stage 由 setup 变 play，中途崩溃也不会丢配置
    setDirty(true)
    setTimeout(() => { saveToCurrent() }, 0)
    showToast('模拟开始')
  }, [draftResources, draftPity, draftRecords, config.pools, pools, showToast, saveToCurrent])

  /** 真正执行抽卡（资源已确认充足） */
  const commitDraw = useCallback((poolId, count) => {
    const pool = pools[poolId]
    const rt = runtimeRef.current
    if (!pool || !rt) return
    const draft = cloneRuntime(rt)
    const { records, stopped } = drawMany(draft, pool, count)
    if (records.length === 0) { showToast('资源不足，请先到商城补充'); return }
    runtimeRef.current = draft
    setRuntime(draft)
    if (stopped && records.length < count) showToast(`资源不足，本次只抽了 ${records.length} 次`)
    setFx({ records, poolName: `${POOL_LABEL[poolId]} · ${pool.bannerName || ''}` })
    scheduleAutoSave()
  }, [pools, showToast, scheduleAutoSave])

  /**
   * 抽卡入口：先判定资金，再决定要不要打扰用户。
   *   direct  缘够 → 直接抽，不弹窗
   *   convert 缘不够但原石/创世结晶够 → 弹确认框，确认后自动转化并抽
   *   short   都不够 → 弹提示框
   */
  const handleDraw = useCallback((poolId, count) => {
    const pool = pools[poolId]
    const rt = runtimeRef.current
    if (!pool || !rt) return
    const funding = planPullFunding(rt.resources, poolId, count)
    // 资源真不足：无论开关如何都要提示（用户需要知道为什么抽不了）
    if (funding.mode === 'short') { setShortInfo({ poolId, count, shortfall: funding.shortfall }); return }
    // 需要转化：开关开启时先确认，关闭时静默转化直接抽
    if (funding.mode === 'convert' && dialogs) { setPullConfirm({ poolId, count, plan: funding.plan }); return }
    commitDraw(poolId, count)
  }, [pools, commitDraw, dialogs])

  const setAnimations = useCallback((on) => {
    setAnimationsState(on)
    setConfig(prev => ({ ...prev, animations: on }))
  }, [])

  const setDialogs = useCallback((on) => {
    setDialogsState(on)
    setConfig(prev => ({ ...prev, dialogs: on }))
  }, [])

  const handleSetEpitome = useCallback((poolId, itemKey) => {
    const rt = runtimeRef.current
    if (!rt) return
    const draft = cloneRuntime(rt)
    draft.epicomized[poolId] = itemKey
    runtimeRef.current = draft
    setRuntime(draft)
    scheduleAutoSave()
  }, [scheduleAutoSave])

  const handleResetFate = useCallback(() => {
    const rt = runtimeRef.current
    if (!rt) return
    const draft = cloneRuntime(rt)
    for (const k of ['weapon', 'chronicled']) if (draft.pity[k]) draft.pity[k].fate = 0
    runtimeRef.current = draft
    setRuntime(draft)
    scheduleAutoSave()
    showToast('命定值已清零')
  }, [scheduleAutoSave, showToast])

  /** 商城的统一提交口：patch 为运行态补丁（resources / firstChargeDouble / recharges…），null 表示只提示 */
  const handleShopApply = useCallback((patch, msg, isError) => {
    if (!patch) { if (msg) showToast(msg); return }
    const rt = runtimeRef.current
    if (!rt) return
    const draft = cloneRuntime(rt)
    Object.assign(draft, patch)
    if (patch.resources) draft.resources = normalizeResources(patch.resources)
    if (patch.recharges) draft.recharges = [...patch.recharges]
    runtimeRef.current = draft
    setRuntime(draft)
    if (msg) showToast(msg)
    scheduleAutoSave()
  }, [showToast, scheduleAutoSave])

  /** 创世结晶 → 原石 */
  const handleConvert = useCallback((n) => {
    const rt = runtimeRef.current
    if (!rt) return
    const r = exchangeGenesisForPrimogem(rt.resources, n)
    if (!r.ok) { showToast(r.reason || '转换失败'); return }
    const draft = cloneRuntime(rt)
    draft.resources = r.resources
    runtimeRef.current = draft
    setRuntime(draft)
    showToast(`已用 ${n.toLocaleString()} 创世结晶转换 ${n.toLocaleString()} 原石`)
    setConvertOpen(false)
    scheduleAutoSave()
  }, [showToast, scheduleAutoSave])


  const handleGrant = useCallback((add) => {
    const rt = runtimeRef.current
    if (!rt) return
    const draft = cloneRuntime(rt)
    grantResources(draft, add)
    runtimeRef.current = draft
    setRuntime(draft)
    scheduleAutoSave()
  }, [scheduleAutoSave])

  const handleExchange = useCallback((kind, poolId, n) => {
    const rt = runtimeRef.current
    if (!rt) return
    const draft = cloneRuntime(rt)
    const res = kind === 'glitter'
      ? exchangeByGlitter(draft.resources, poolId, n)
      : exchangeByStardust(draft.resources, poolId, n, draft.stardustFateUsed)
    if (!res.ok) { showToast(res.reason || '兑换失败'); return }
    draft.resources = res.resources
    if (kind === 'stardust') draft.stardustFateUsed += res.exchanged
    runtimeRef.current = draft
    setRuntime(draft)
    scheduleAutoSave()
    showToast(`已兑换 ${res.exchanged} 个缘`)
  }, [scheduleAutoSave, showToast])

  // ═════════════════════════════════════════════════════════════
  // 渲染
  // ═════════════════════════════════════════════════════════════
  if (booting) {
    return (
      <div className="h-full flex items-center justify-center bg-surface-950">
        <div className="flex items-center gap-2 text-white/50 text-xs">
          <Sparkles className="w-4 h-4 animate-pulse" aria-hidden="true" />正在装配卡池数据…
        </div>
      </div>
    )
  }

  if (bootError || !roster) {
    return (
      <div className="h-full flex items-center justify-center bg-surface-950 p-6">
        <div className="max-w-sm text-center space-y-2">
          <AlertCircle className="w-6 h-6 text-rose-300 mx-auto" aria-hidden="true" />
          <p className="text-sm text-white/80">卡池数据装配失败</p>
          <p className="text-[11px] text-white/45">{bootError || '未读取到角色/武器数据'}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-surface-950 relative overflow-hidden">
      {/* ── 顶栏 ── */}
      <header className="flex items-center gap-2 px-3 py-2 border-b border-white/10 shrink-0 bg-black/25">
        <Sparkles className="w-4 h-4 text-fuchsia-300 shrink-0" aria-hidden="true" />
        <span className="text-sm font-medium text-white shrink-0">希穆兰卡</span>
        {view !== 'library' && (
          <>
            <span className="text-white/20">·</span>
            <input
              value={archiveName}
              onChange={e => setArchiveName(e.target.value)}
              aria-label="存档名"
              className="px-2 py-0.5 text-[11px] rounded bg-transparent hover:bg-white/5 focus:bg-black/30 border border-transparent focus:border-white/15 text-white/85 w-40 focus:outline-none"
            />
            <span className="text-[10px] text-white/35" title="所有改动都会自动写回本存档，无需手动保存">
              {dirty ? '保存中…' : '已自动保存'}
            </span>
            {savedTick > 0 && <span className="sr-only" aria-live="polite">已自动保存</span>}
          </>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          {view === 'play' && (
            <nav className="flex items-center gap-1 mr-2">
              {[
                { id: 'wish', label: '祈愿', icon: Star },
                { id: 'records', label: '抽卡记录', icon: ListOrdered },
                { id: 'stats', label: '抽卡数据', icon: BarChart3 },
              ].map(t => {
                const Icon = t.icon
                return (
                  <button key={t.id} type="button" onClick={() => setTab(t.id)}
                    aria-current={tab === t.id ? 'page' : undefined}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] border transition-colors ${
                      tab === t.id ? 'bg-primary-500/20 border-primary-400/50 text-primary-200' : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10'}`}>
                    <Icon className="w-3 h-3" aria-hidden="true" />{t.label}
                  </button>
                )
              })}
            </nav>
          )}
          {view === 'play' && (
            <>
              <SimButton size="sm" onClick={() => setSaveAsOpen(true)} title="另建一条存档并把当前会话切过去，原存档保持不变">
                <Copy className="w-3 h-3" aria-hidden="true" />另存为
              </SimButton>
            </>
          )}
          <SimButton size="sm" onClick={() => setView('library')}><FolderOpen className="w-3 h-3" aria-hidden="true" />存档库</SimButton>
          <SimButton size="sm" variant="primary" onClick={handleNew}><Plus className="w-3 h-3" aria-hidden="true" />新建模拟</SimButton>
        </div>
      </header>

      {/* ── 主体 ── */}
      <div className="flex-1 min-h-0 relative">
        {view === 'library' && (
          <ArchiveLibrary
            archives={archives}
            onNew={handleNew}
            onLoad={handleLoad}
            onDuplicate={handleDuplicate}
            onDelete={handleDelete}
            onRename={handleRename}
          />
        )}

        {view === 'setup' && (
          <SimulankaSetup
            roster={roster}
            config={config}
            setConfig={(updater) => setConfig(prev => typeof updater === 'function' ? updater(prev) : updater)}
            resources={draftResources}
            setResources={setDraftResources}
            pity={draftPity}
            setPity={setDraftPity}
            onImportRecords={setDraftRecords}
            onStart={handleStart}
            onBack={() => setView('library')}
          />
        )}

        {view === 'play' && runtime && (
          tab === 'wish' ? (
            <SimulankaGacha
              runtime={runtime}
              pools={pools}
              activePool={activePool}
              setActivePool={setActivePool}
              onDraw={handleDraw}
              onSetEpitome={handleSetEpitome}
              onResetFate={handleResetFate}
              onOpenShop={() => setShopOpen(true)}
              onOpenConvert={() => setConvertOpen(true)}
              animations={animations}
              dialogs={dialogs}
              setDialogs={setDialogs}
              setAnimations={setAnimations}
            />
          ) : tab === 'records' ? (
            <SimulankaRecords runtime={runtime} pools={pools} />
          ) : (
            <SimulankaStats runtime={runtime} pools={pools} />
          )
        )}

        {view === 'play' && !runtime && (
          <SimEmpty icon={Sparkles} title="还没有开始模拟" hint="请先在「模拟前配置」里确认卡池安排，然后点「开始模拟」" />
        )}

        {fx && (
          <SimulankaWishFx
            records={fx.records}
            poolName={fx.poolName}
            onDone={() => setFx(null)}
            active={appActive}
            animations={animations}
          />
        )}
      </div>

      {shopOpen && runtime && (
        <SimulankaShop
          runtime={runtime}
          onClose={() => setShopOpen(false)}
          onApply={handleShopApply}
          onOpenConvert={() => setConvertOpen(true)}
        />
      )}

      {convertOpen && runtime && (
        <GenesisConvertPanel
          resources={runtime.resources}
          onClose={() => setConvertOpen(false)}
          onApply={handleConvert}
        />
      )}

      {pullConfirm && (
        <PullConfirmDialog
          info={pullConfirm}
          poolLabel={POOL_LABEL[pullConfirm.poolId]}
          onCancel={() => setPullConfirm(null)}
          onConfirm={() => { const c = pullConfirm; setPullConfirm(null); commitDraw(c.poolId, c.count) }}
        />
      )}

      {shortInfo && (
        <ShortDialog
          info={shortInfo}
          poolLabel={POOL_LABEL[shortInfo.poolId]}
          onClose={() => setShortInfo(null)}
          onOpenShop={() => { setShortInfo(null); setShopOpen(true) }}
        />
      )}

      {saveAsOpen && (
        <SaveAsDialog
          defaultName={archiveName}
          onClose={() => setSaveAsOpen(false)}
          onConfirm={async (name) => {
            const id = await saveAsCopy(name)
            setSaveAsOpen(false)
            if (id) showToast(`已另存为「${name}」`)
          }}
        />
      )}

      {toast && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[60] px-3 py-1.5 rounded-full bg-black/80 border border-white/15 text-[11px] text-white/90 animate-fade-in max-w-[80%] text-center">
          {toast}
        </div>
      )}
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════
// 存档库
// ═════════════════════════════════════════════════════════════════
function ArchiveLibrary({ archives, onNew, onLoad, onDelete, onRename, onDuplicate }) {
  const [renaming, setRenaming] = useState(null)   // { id, name }
  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="max-w-[840px] mx-auto space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-medium text-white">模拟存档</h2>
            <p className="text-[11px] text-white/45 mt-0.5">
              每个存档包含完整的祈愿方案、剩余资源、抽取历史与保底状态。打开即进入该存档，改动会自动写回，不会另建存档。
            </p>
          </div>
          <SimButton variant="primary" onClick={onNew}><Plus className="w-3.5 h-3.5" aria-hidden="true" />新建模拟</SimButton>
        </div>

        {archives.length === 0 ? (
          <SimEmpty icon={Sparkles} title="还没有任何模拟存档" hint="点「新建模拟」开始第一局：先安排卡池与初始资源，再开始抽取" />
        ) : (
          <div className="space-y-2">
            {archives.map(a => (
              <div key={a.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/5 transition-colors">
                <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-fuchsia-500 to-sky-400 flex items-center justify-center shrink-0">
                  <Sparkles className="w-4 h-4 text-white" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-white/90 truncate">{a.name}</div>
                  <div className="text-[10px] text-white/40 tabular-nums">
                    更新于 {String(a.updatedAt || '').slice(5, 16)} · {Math.max(1, Math.round((a.size || 0) / 1024))} KB
                  </div>
                </div>
                <SimButton size="sm" variant="primary" onClick={() => onLoad(a.id)}>
                  <Play className="w-3 h-3" aria-hidden="true" />打开
                </SimButton>
                <SimButton size="sm" onClick={() => onDuplicate(a.id)} aria-label={`复制 ${a.name}`} title="生成这个存档的副本">
                  <Copy className="w-3 h-3" aria-hidden="true" />
                </SimButton>
                <SimButton size="sm" onClick={() => setRenaming({ id: a.id, name: a.name })} aria-label={`重命名 ${a.name}`} title="重命名">
                  <Pencil className="w-3 h-3" aria-hidden="true" />
                </SimButton>
                <SimButton size="sm" variant="danger" onClick={() => onDelete(a.id, a.name)} aria-label={`删除 ${a.name}`}>
                  <Trash2 className="w-3 h-3" aria-hidden="true" />
                </SimButton>
              </div>
            ))}
          </div>
        )}
      </div>

      {renaming && (
        <RenameDialog
          current={renaming.name}
          onClose={() => setRenaming(null)}
          onConfirm={async (name) => {
            const ok = await onRename(renaming.id, name)
            if (ok) setRenaming(null)
          }}
        />
      )}
    </div>
  )
}

// 重命名弹窗
//   ⚠️ 不要用 window.prompt —— Electron 不支持它（静默返回 null），
//   这正是早先「铅笔按钮点了没反应」的原因。
function RenameDialog({ current, onClose, onConfirm }) {
  const ov = useOverlay({ open: true, onClose, label: '重命名存档', initialFocus: 'auto' })
  const [name, setName] = useState(current)
  return (
    <div ref={ov.overlayRef} {...ov.overlayProps}
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-[360px] rounded-xl bg-surface-900 border border-white/10 shadow-2xl">
        <div className="px-4 py-2.5 border-b border-white/10">
          <h3 className="text-sm font-medium text-white">重命名存档</h3>
        </div>
        <div className="p-4 space-y-3">
          <label className="block">
            <span className="text-[11px] text-white/55">存档名</span>
            <input
              value={name} onChange={e => setName(e.target.value)} aria-label="存档名" autoFocus
              className="mt-1 w-full px-2.5 py-1.5 text-xs rounded-lg bg-black/30 border border-white/10 text-white focus:outline-none focus:border-primary-400/60"
            />
          </label>
          <div className="flex justify-end gap-2">
            <SimButton onClick={onClose}>取消</SimButton>
            <SimButton variant="primary" disabled={!name.trim()} onClick={() => onConfirm(name.trim())}>
              <Check className="w-3.5 h-3.5" aria-hidden="true" />确定
            </SimButton>
          </div>
        </div>
      </div>
    </div>
  )
}

// 另存为
// ═════════════════════════════════════════════════════════════════
/**
 * 缘不足但原石/创世结晶够时的确认框。
 * 对应需求：点确认后自动转化并直接祈愿，不再二次打扰。
 */
function PullConfirmDialog({ info, poolLabel, onCancel, onConfirm }) {
  const ov = useOverlay({ open: true, onClose: onCancel, label: '自动转化并祈愿', initialFocus: 'auto' })
  const { plan } = info
  const fateName = plan.fateKey === 'acquaint' ? '相遇之缘' : '纠缠之缘'
  return (
    <div ref={ov.overlayRef} {...ov.overlayProps}
      className="absolute inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-[400px] rounded-xl bg-surface-900 border border-white/10 shadow-2xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-white/10">
          <h3 className="text-sm font-medium text-white">自动转化并祈愿</h3>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-[11px] text-white/60 leading-relaxed">
            本次「{poolLabel}」需要 {info.count} 个{fateName}，持有 {plan.fromStock} 个。
            其余将按原版规则自动转化：
          </p>
          <div className="rounded-lg bg-black/25 border border-white/10 divide-y divide-white/10">
            {plan.fromPrimogem > 0 && (
              <div className="flex items-center justify-between px-3 py-2 text-[11px]">
                <span className="text-white/60">消耗原石</span>
                <span className="text-white/90 tabular-nums">
                  {plan.primogemUsed.toLocaleString()}
                  <span className="text-white/35 ml-1">→ {plan.fromPrimogem} 个{fateName}</span>
                </span>
              </div>
            )}
            {plan.genesisUsed > 0 && (
              <div className="flex items-center justify-between px-3 py-2 text-[11px]">
                <span className="text-white/60">消耗创世结晶</span>
                <span className="text-white/90 tabular-nums">{plan.genesisUsed.toLocaleString()}</span>
              </div>
            )}
            <div className="flex items-center justify-between px-3 py-2 text-[11px]">
              <span className="text-white/60">合计转化</span>
              <span className="text-white/90 tabular-nums">
                {plan.fromPrimogem + Math.floor(plan.genesisUsed / 160)} 个{fateName}
                {plan.genesisUsed % 160 > 0 && <span className="text-white/35">（余 {plan.genesisUsed % 160} 结晶）</span>}
              </span>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <SimButton onClick={onCancel}>取消</SimButton>
            <SimButton variant="primary" onClick={onConfirm}>确认并祈愿</SimButton>
          </div>
        </div>
      </div>
    </div>
  )
}

/** 原石 + 创世结晶 + 缘都不够时的提示框 */
function ShortDialog({ info, poolLabel, onClose, onOpenShop }) {
  const ov = useOverlay({ open: true, onClose, label: '资源不足', initialFocus: 'auto' })
  const fateName = info.poolId === 'standard' ? '相遇之缘' : '纠缠之缘'
  return (
    <div ref={ov.overlayRef} {...ov.overlayProps}
      className="absolute inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-[380px] rounded-xl bg-surface-900 border border-white/10 shadow-2xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-white/10">
          <h3 className="text-sm font-medium text-white">资源不足</h3>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-[11px] text-white/60 leading-relaxed">
            本次「{poolLabel}」需要 {info.count} 个{fateName}。
            当前{fateName}、原石与创世结晶都不足以补足，还差约
            <span className="text-amber-200 tabular-nums"> {info.shortfall.toLocaleString()} </span>
            原石等值。
          </p>
          <p className="text-[11px] text-white/45">可以到「商城」用创世结晶兑换，或直接充值凝取结晶。</p>
          <div className="flex justify-end gap-2">
            <SimButton onClick={onClose}>知道了</SimButton>
            <SimButton variant="primary" onClick={onOpenShop}>前往商城</SimButton>
          </div>
        </div>
      </div>
    </div>
  )
}

function SaveAsDialog({ defaultName, onClose, onConfirm }) {
  const ov = useOverlay({ open: true, onClose, label: '另存为新存档', initialFocus: 'auto' })
  const [name, setName] = useState(`${defaultName} · 副本`)
  return (
    <div ref={ov.overlayRef} {...ov.overlayProps}
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-[360px] rounded-xl bg-surface-900 border border-white/10 shadow-2xl">
        <div className="px-4 py-2.5 border-b border-white/10">
          <h3 className="text-sm font-medium text-white">另存为新存档</h3>
        </div>
        <div className="p-4 space-y-3">
          <label className="block">
            <span className="text-[11px] text-white/55">存档名</span>
            <input value={name} onChange={e => setName(e.target.value)} aria-label="存档名"
              className="mt-1 w-full px-2.5 py-1.5 text-xs rounded-lg bg-black/30 border border-white/10 text-white focus:outline-none focus:border-primary-400/60" />
          </label>
          <div className="flex justify-end gap-2">
            <SimButton onClick={onClose}>取消</SimButton>
            <SimButton variant="primary" disabled={!name.trim()} onClick={() => onConfirm(name.trim())}>
              <Check className="w-3.5 h-3.5" aria-hidden="true" />保存
            </SimButton>
          </div>
        </div>
      </div>
    </div>
  )
}

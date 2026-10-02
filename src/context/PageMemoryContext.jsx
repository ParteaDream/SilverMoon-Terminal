import { createContext, useContext, useRef, useEffect, useLayoutEffect, useState, useMemo, useCallback } from 'react'
import { loadScrollStateSync, loadScrollState, saveScrollStateSync } from '../utils/pageStateStore'
import { applyScrollSnapshot, captureScrollSnapshot, getScroller } from '../utils/scrollMemory.mjs'

const PageMemoryContext = createContext(null)

/** "停在顶部"的空快照：没有任何可信位置时的落盘值 */
const TOP_SNAPSHOT = { scrollTop: 0, atBottom: false, anchor: null }

export function usePageMemory() {
  const ctx = useContext(PageMemoryContext)
  if (!ctx) throw new Error('usePageMemory must be used within PageMemoryProvider')
  return ctx
}

/**
 * PageMemoryProvider — 详情页状态 + 滚动位置持久化
 *
 * 用法：包裹详情页根组件
 * <PageMemoryProvider pageKey={`character_${id}`}>
 *   <CharacterDetailPage />
 * </PageMemoryProvider>
 *
 * 自动行为：
 * - **渲染期**同步读取上次的状态与滚动快照（父组件先于子组件渲染，子组件
 *   才能用 useState 初始化器拿到恢复值；放在 effect 里读就晚了）
 * - 没有可恢复的记录时，挂载期就把共享的 <main> 拉回顶部（列表页在
 *   "非返回进入"时也是这么做的，见 useScrollMemory）
 * - 滚动时逐帧刷新内存快照，卸载时把最后一次快照落盘
 * - 最多保留 12 个页面，旧的自动淘汰
 *
 * ── 恢复 vs 采集：两者必须分开 ──────────────────────────────────────
 * 只有"渲染期读到的那份存档"才算**上次离开时的位置**，也只有它能触发恢复。
 * 运行期采集（滚动跟踪、卸载瞬间读 DOM）反映的是**本页当前**的位置，
 * 用于落盘；拿它当恢复目标会出事：
 *   进入页面时 <main> 还带着上一个页面的 scrollTop，浏览器把它夹到新页面上
 *   （开发者工具栏预留还会让它短暂可滚），随后产生的 scroll 事件／
 *   StrictMode 的"挂载→卸载→再挂载"都会把这个过渡态记成"本页的位置"，
 *   于是刚打开的详情页被"恢复"到中部甚至底部。
 *
 * 恢复滚动位置由 useDetailScroll 触发（数据渲染完成后才恢复才有意义）。
 */
export function PageMemoryProvider({ pageKey, children }) {
  // ── 渲染期同步读取（每个 pageKey 只读一次）──
  const loadedRef = useRef({ key: null, entry: null })
  const stateRef = useRef({})
  const snapshotRef = useRef(null)
  if (loadedRef.current.key !== pageKey) {
    loadedRef.current = { key: pageKey, entry: loadScrollStateSync(pageKey) }
    // 换 pageKey（详情页之间直接跳转）时，状态与快照必须跟着换，
    // 否则会把上一条目的位置/展开状态带到这一条上
    stateRef.current = loadedRef.current.entry?.state || {}
    snapshotRef.current = loadedRef.current.entry?.snapshot || null
  }
  const entry = loadedRef.current.entry
  // 本次挂载唯一可信的恢复目标
  const restoreSnapshot = entry?.snapshot || null
  const willRestore = !!restoreSnapshot && (restoreSnapshot.scrollTop > 0 || restoreSnapshot.atBottom)

  const [ready, setReady] = useState(!!entry)

  // ── 没有可恢复的记录＝全新页面：显式回到顶部 ──
  // 不能指望浏览器把上一个页面的 scrollTop 夹掉（加载态页面够短才会夹成 0），
  // 一旦夹不掉，详情页就直接停在列表的位置上。用 layout effect 是为了赶在
  // 首次布局之前落位，用户看不到跳动。
  useLayoutEffect(() => {
    if (willRestore) return
    const main = getScroller()
    if (main) main.scrollTop = 0
  }, [pageKey, willRestore])

  // 缓存未命中（同步读不到）时再走异步：首屏状态可能仍是默认值。
  // 只补状态与落盘用的快照，不参与"要不要恢复"的判断（见文件头说明）。
  useEffect(() => {
    if (ready) return undefined
    let cancelled = false
    loadScrollState(pageKey).then(saved => {
      if (cancelled) return
      if (saved) {
        stateRef.current = saved.state || {}
        if (!snapshotRef.current) snapshotRef.current = saved.snapshot || null
      }
      setReady(true)
    }).catch(() => { if (!cancelled) setReady(true) })
    return () => { cancelled = true }
  }, [pageKey, ready])

  // 持续跟踪滚动位置（逐帧采集完整快照：含内容锚点）
  useEffect(() => {
    const main = getScroller()
    if (!main) return undefined
    let rafId = 0
    let tickId = 0
    // rAF 优先 + 定时器兜底：窗口被遮挡时 rAF 会被节流，只有 rAF 的话位置不会被记下来
    const flush = () => {
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0 }
      if (tickId) { clearTimeout(tickId); tickId = 0 }
      const snap = captureScrollSnapshot(main)
      if (snap) snapshotRef.current = snap
    }
    const onScroll = () => {
      if (rafId || tickId) return
      rafId = requestAnimationFrame(flush)
      tickId = setTimeout(flush, 80)
    }
    main.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      main.removeEventListener('scroll', onScroll)
      if (rafId) cancelAnimationFrame(rafId)
      if (tickId) clearTimeout(tickId)
    }
  }, [pageKey])

  // 卸载时：把最后一次快照 + 状态落盘
  useLayoutEffect(() => {
    return () => {
      // tracked 只可能是"上次离开时的存档"或"本页滚动时采集到的位置"，两者都属于本页。
      // 没有任何 tracked 说明本页还没有过可信位置（首次打开且没滚动过）——此时
      // **不能**去读 DOM 兜底：挂载过渡期的读数会带上一个页面的 scrollTop
      // （被浏览器夹到本页高度上，常表现为 atBottom），记下来就会让下次打开
      // 直接跳到中部/底部。React StrictMode 的"挂载→卸载→再挂载"必踩这一条。
      const finalSnap = snapshotRef.current || TOP_SNAPSHOT
      saveScrollStateSync(pageKey, finalSnap, stateRef.current)
    }
  }, [pageKey])

  // 注册状态字段（由 useDetailState 调用）
  const registerState = useCallback((key, value) => {
    stateRef.current[key] = value
  }, [])

  // 获取已保存的状态值
  const getSaved = useCallback((key, defaultValue) => {
    if (key in stateRef.current) return stateRef.current[key]
    return typeof defaultValue === 'function' ? defaultValue() : defaultValue
  }, [])

  // 主动保存当前状态（在导航前调用，避免 DOM 移除后采集不到位置）
  const saveNow = useCallback(() => {
    const main = getScroller()
    const snap = main ? captureScrollSnapshot(main) : null
    if (snap) snapshotRef.current = snap
    saveScrollStateSync(pageKey, snapshotRef.current, stateRef.current)
  }, [pageKey])

  // 恢复滚动位置（由 useDetailScroll 调用）
  // 目标固定为"渲染期读到的那份存档"，运行期采集到的东西不参与恢复
  const restoreScroll = useCallback(async (options = {}) => {
    const main = getScroller()
    const target = loadedRef.current.entry?.snapshot
    if (!main || !target) return 'noop'
    return applyScrollSnapshot(main, target, options)
  }, [])

  const ctx = useMemo(() => ({
    pageKey,
    getSaved,
    registerState,
    saveNow,
    restoreScroll,
    savedScroll: restoreSnapshot?.scrollTop || 0,
    ready,
  }), [pageKey, getSaved, registerState, saveNow, restoreScroll, restoreSnapshot, ready])

  return (
    <PageMemoryContext.Provider value={ctx}>
      {children}
    </PageMemoryContext.Provider>
  )
}

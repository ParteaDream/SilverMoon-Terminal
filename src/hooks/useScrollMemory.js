import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  applyScrollSnapshot,
  captureScrollSnapshot,
  getScroller,
  resetScroll,
  revealItem,
  DEFAULT_ANCHOR_ATTR,
  DEFAULT_ITEM_SELECTOR,
  DEFAULT_MAX_MS,
} from '../utils/scrollMemory.mjs'
import { loadScrollStateSync, saveScrollStateSync } from '../utils/pageStateStore'
import { peekScrollRestore, consumeScrollRestore, takeFocusItem, clearFocusItem } from '../utils/navFlags'

/** 滚动停止多久之后落盘（内存里是实时的，只有写文件需要节流） */
const PERSIST_DEBOUNCE_MS = 180

/**
 * 页面内容最多藏多久（毫秒）。
 * 页面在恢复期间会把自己设成 opacity-0，只要有一条分支忘了把 restoring 放回 false，
 * 用户看到的就是整页纯黑。所以这里放一个无条件兜底：无论发生什么，到点必须放出来。
 * （开发模式下 React StrictMode 会"挂载→卸载→再挂载"，正是最容易踩到的场景。）
 */
const HIDE_FAILSAFE_MS = 400

/**
 * useScrollMemory(pageKey, options) — 列表页滚动位置记忆
 *
 * 对页面暴露四件事：
 *   restoring  —— 是否还在校正滚动位置（true 时页面把内容藏起来，避免看到跳动）
 *   readSaved  —— 同步读取上次离开时的快照与页面状态
 *   restore    —— 把快照恢复到 <main> 上（异步；收敛后 resolve）
 *   saveNow    —— 立刻采集并落盘（点开条目、跳转前调用）
 *
 * 采集策略：滚动时逐帧更新内存快照，停手 180ms 后写文件；卸载时再兜一次。
 * 卸载兜底用的是**内存里最后一次快照**而不是重新读 DOM —— 组件卸载时机与新
 * 页面 DOM 替换的先后顺序不受控，重读 DOM 可能读到已经被夹到顶部的 scrollTop。
 *
 * @param {string} pageKey 页面标识（与 pageStateStore 的 key 一致）
 * @param {object} [options]
 * @param {() => object} [options.getState] 返回随滚动一起保存的页面状态
 * @param {string} [options.itemSelector] 锚点选择器
 * @param {string} [options.anchorAttribute] 锚点 id 所在的属性名
 * @param {number} [options.maxMs] 最长校正时间
 */
export function useScrollMemory(pageKey, options = {}) {
  const {
    getState,
    itemSelector = DEFAULT_ITEM_SELECTOR,
    anchorAttribute = DEFAULT_ANCHOR_ATTR,
    maxMs = DEFAULT_MAX_MS,
  } = options

  // 初始值在渲染期同步取：返回列表时第一帧就要把内容藏住，否则会看到置顶闪烁
  const [restoring, setRestoring] = useState(() => peekScrollRestore())

  const snapshotRef = useRef(null)      // 内存中的最新快照
  const stateRef = useRef(getState)
  stateRef.current = getState
  const restoringRef = useRef(restoring)
  const cancelledRef = useRef(false)
  const timerRef = useRef(null)
  const watchdogRef = useRef(null)
  // 恢复收工后用户是否自己动过滚动条（动过就不再补校正，绝不和用户抢）
  const touchedRef = useRef(false)
  // "这次挂载要不要恢复"的判定结果：ref 在 StrictMode 的二次挂载间是同一个，
  // 所以两次 effect 会得到同一个答案（标记只消费一次，但双跑不会跑偏）
  const restoreDecisionRef = useRef(null)
  const pendingCancelRef = useRef(null)

  /**
   * 页面在挂载时问一句"这次是不是返回"。
   * 结果按组件实例缓存：StrictMode 下 effect 会跑两次，若每次都重新读标记，
   * 第二次就会读到"已被消费"从而误判成首次进入（表现为返回后整页空白）。
   */
  const shouldRestore = useCallback(() => {
    if (restoreDecisionRef.current === null) restoreDecisionRef.current = consumeScrollRestore()
    return restoreDecisionRef.current
  }, [])

  // 兜底：只要处在"藏内容"状态，到点无条件放出来
  useEffect(() => {
    if (!restoring) return undefined
    const t = setTimeout(() => { restoringRef.current = false; setRestoring(false) }, HIDE_FAILSAFE_MS)
    return () => clearTimeout(t)
  }, [restoring])

  const readState = useCallback(() => {
    try { return (stateRef.current && stateRef.current()) || {} } catch (_) { return {} }
  }, [])

  /** 采集当前位置；采集不到（页面未挂载等）返回 null */
  const capture = useCallback(() => {
    const scroller = getScroller()
    if (!scroller) return null
    const snap = captureScrollSnapshot(scroller, { itemSelector, anchorAttribute })
    if (snap) snapshotRef.current = snap
    return snap
  }, [itemSelector, anchorAttribute])

  const persist = useCallback((snapshot) => {
    const snap = snapshot || snapshotRef.current
    if (!snap) return
    saveScrollStateSync(pageKey, snap, readState())
  }, [pageKey, readState])

  /**
   * 只更新页面状态、保留已有滚动快照（例如切换分类：位置不该被重新采集，
   * 但"上次看的是哪个分类"必须写回去）。
   */
  const persistState = useCallback(() => {
    const snap = snapshotRef.current || loadScrollStateSync(pageKey)?.snapshot
    if (!snap) return
    saveScrollStateSync(pageKey, snap, readState())
  }, [pageKey, readState])

  /** 立即采集并落盘（导航前调用，保证详情页返回时拿到的是离开瞬间的位置） */
  const saveNow = useCallback(() => {
    const snap = capture()
    if (snap) persist(snap)
    return snap
  }, [capture, persist])

  /** 同步读取上次离开时的快照与页面状态 */
  const readSaved = useCallback(() => loadScrollStateSync(pageKey), [pageKey])

  /**
   * 恢复滚动位置。
   * @param {object} [snapshot] 指定快照；缺省用 store 里的
   * @param {object} [opts]
   * @param {boolean} [opts.useFocusItem] 快照缺失时，把"点进来的那条"滚进视口
   */
  const restore = useCallback(async (snapshot, opts = {}) => {
    const scroller = getScroller()
    const saved = snapshot || loadScrollStateSync(pageKey)?.snapshot || null
    if (!scroller) { setRestoring(false); restoringRef.current = false; return 'noop' }

    if (!saved) {
      // 没有快照：至少保证用户点进来的条目在视野里
      if (opts.useFocusItem !== false) {
        const focusId = takeFocusItem()
        if (focusId != null) await revealItem(scroller, focusId, { itemSelector, anchorAttribute })
      }
      setRestoring(false)
      restoringRef.current = false
      return 'noop'
    }

    // 有快照就不需要"至少让这条可见"的兜底了，顺手清掉避免污染后续导航
    clearFocusItem()
    restoringRef.current = true
    setRestoring(true)
    const result = await applyScrollSnapshot(scroller, saved, {
      itemSelector,
      anchorAttribute,
      maxMs,
      isCancelled: () => cancelledRef.current,
      // 第一次看起来就位就先放页面出来；后续的细校正用户察觉不到
      onAligned: () => { restoringRef.current = false; setRestoring(false) },
    })
    restoringRef.current = false
    setRestoring(false)
    // 恢复过程中的位置就是当前位置，刷新内存快照（用户中途接管时尤其重要）
    capture()

    // ── 收工后再复查一次 ──
    // 图片/内容晚到会把已经对好的位置顶偏。等一小会儿确认没有漂移，
    // 漂了就用同一个快照再对齐一次（用户已经自己滚过就完全不动）。
    if (result === 'converged' || result === 'timeout') {
      touchedRef.current = false
      clearTimeout(watchdogRef.current)
      watchdogRef.current = setTimeout(async () => {
        if (cancelledRef.current || touchedRef.current || restoringRef.current) return
        restoringRef.current = true
        await applyScrollSnapshot(scroller, saved, {
          itemSelector,
          anchorAttribute,
          maxMs: 700,
          isCancelled: () => cancelledRef.current || touchedRef.current,
        })
        restoringRef.current = false
        capture()
      }, 450)
    }
    return result
  }, [pageKey, itemSelector, anchorAttribute, maxMs, capture])

  // 滚动跟踪：逐帧更新内存快照 + 去抖落盘；卸载时用最后一次快照兜底
  useLayoutEffect(() => {
    // 重挂载（StrictMode 的模拟卸载）会撤掉上一次排的"取消"
    if (pendingCancelRef.current) { clearTimeout(pendingCancelRef.current); pendingCancelRef.current = null }
    cancelledRef.current = false
    const scroller = getScroller()
    if (!scroller) return undefined
    let rafId = 0
    let tickId = 0

    // 采集位置：rAF 优先（前台逐帧），并用定时器兜底 —— 窗口被遮挡/最小化时
    // Chromium 会节流 rAF，只挂 rAF 的话滚动位置根本不会被记下来
    const flush = () => {
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0 }
      if (tickId) { clearTimeout(tickId); tickId = 0 }
      capture()
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => { timerRef.current = null; persist() }, PERSIST_DEBOUNCE_MS)
    }

    const onScroll = () => {
      if (restoringRef.current) return
      touchedRef.current = true      // 恢复收工后的滚动＝用户接管
      if (rafId || tickId) return
      rafId = requestAnimationFrame(flush)
      tickId = setTimeout(flush, 80)
    }

    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      // 不能立刻置 cancelled：StrictMode 会紧接着重挂载同一个实例，
      // 立刻置位会把正在进行（且仍然有效）的恢复打断，而第二次 effect 已经
      // 拿不到"返回"标记了 —— 那样页面就会永远停在隐藏状态。
      // 推迟一个任务再判死刑，重挂载会把它撤销。
      if (pendingCancelRef.current) clearTimeout(pendingCancelRef.current)
      pendingCancelRef.current = setTimeout(() => {
        pendingCancelRef.current = null
        cancelledRef.current = true
      }, 0)
      clearTimeout(watchdogRef.current)
      scroller.removeEventListener('scroll', onScroll)
      if (rafId) cancelAnimationFrame(rafId)
      if (tickId) clearTimeout(tickId)
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
      if (restoringRef.current) return
      // 卸载瞬间实时读一次：窗口被遮挡时滚动事件可能压根不派发，只靠跟踪到的
      // 快照会漏记。若此时 scrollTop 已被新页面夹小，则退回跟踪值。
      const main = getScroller()
      const tracked = snapshotRef.current
      const fresh = main ? captureScrollSnapshot(main, { itemSelector, anchorAttribute }) : null
      let finalSnap = fresh || tracked
      if (fresh && tracked && fresh.scrollTop + 40 < tracked.scrollTop) finalSnap = tracked
      if (finalSnap) persist(finalSnap)
    }
  }, [capture, persist])

  return { restoring, shouldRestore, readSaved, restore, saveNow, persistState, capture, persist, resetScroll }
}

/**
 * 从侧栏等"全新进入"入口打开列表页时调用：回到顶部并丢弃旧快照。
 * （不丢弃的话，下一次以侧栏方式进来还会被旧位置拽走）
 */
export function resetListScroll(pageKey) {
  resetScroll(getScroller())
}

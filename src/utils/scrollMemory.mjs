/**
 * scrollMemory.js — 滚动位置记忆内核（锚点式恢复）
 *
 * ── 为什么不能只记 scrollTop ───────────────────────────────────────
 * 列表页的卡片带 `content-visibility: auto` + `contain-intrinsic-size`
 * （画廊/表格行同理，见 DataTable.jsx、Album.jsx）。屏幕外的行在重新挂载时
 * 先按**占位高度**参与布局，滚到附近才渲染成真实高度。于是「第 N 个像素」
 * 在恢复的瞬间和布局稳定之后指向的**不是同一处内容**：
 *
 *   恢复到最底 → 此刻页面还差一整行没渲染 → 浏览器把 scrollTop 夹在当时的
 *   最大可滚位置 → 随后页面长高，滚动位置却留在原地 → 用户看到"离底部差一行"。
 *
 * 因此这里记的是**内容锚点**：视口里第一条还没滚出上边的条目（`data-item-id`）
 * 以及它相对滚动容器顶边的偏移。恢复时反复测量这个元素的真实位置并校正
 * scrollTop，直到「位置不再变、文档高度也不再变」连续成立若干帧。
 * 占位高度、图片加载、筛选重排都被这个反馈环自然吸收。
 *
 * ── 收敛规则（applyScrollSnapshot）────────────────────────────────
 * 每帧：
 *   1. 找锚点元素 → 期望偏移 offsetTarget，实际偏移 offsetNow
 *   2. 把 scrollTop 加上 (offsetNow - offsetTarget)，浏览器自行夹取到合法范围
 *   3. 若这次写入没有真正改变 scrollTop（已经贴到滚动边界）且文档高度也没变，
 *      记一次"稳定帧"；连续 STABLE_FRAMES 次即认为收敛
 *   4. 收敛前若文档长高（懒渲染追上来了），稳定计数清零，继续校正
 *
 * 到滚动边界一侧的"够不着"是收敛条件之一（贴底时锚点偏移本来就无法再变小），
 * 所以判断依据是「本轮有没有实际变化」而不是「锚点是否精确对齐」。
 *
 * 用户一动滚轮/键盘就立刻放弃恢复（abortOnUserInput），避免和用户抢滚动条。
 */

export const DEFAULT_ITEM_SELECTOR = '[data-item-id]'

/** 锚点元素上承载 id 的属性名 */
export const DEFAULT_ANCHOR_ATTR = 'data-item-id'

/** 连续多少帧"没变化"才认定收敛。content-visibility 的补渲染通常 1~2 帧内发生。 */
const STABLE_FRAMES = 3

/** 除了连续帧数，还要求"安静"这么久（毫秒）：补渲染可能停顿几帧再继续 */
const QUIET_MS = 160

/** 默认最长校正时间（毫秒）。超时后停止校正，保留当前位置。 */
export const DEFAULT_MAX_MS = 2200

/** 页面内容最多隐藏多久（毫秒）：数据/布局迟迟不到位时也要把页面放出来 */
const REVEAL_AFTER_MS = 320

/**
 * 列表内容迟迟没出现时，把校正时限往后顺延的步长与硬上限。
 * 数据库查询/大列表首帧渲染都可能比 maxMs 慢，此时**绝不能收工**：
 * 一收工，等卡片渲染出来时页面就停在顶部了（这正是"返回后回到顶端"的成因）。
 */
const CONTENT_WAIT_STEP_MS = 500
const CONTENT_HARD_LIMIT_MS = 8000

const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now())

const raf = (cb) => {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(cb)
  return setTimeout(() => cb(now()), 16)
}
/**
 * 等一个"渲染机会"。窗口被遮挡/切到后台时 Chromium 会节流 requestAnimationFrame，
 * 只挂 rAF 的话校正会直接停摆（页面就停在还没校正的位置上）。这里用定时器兜底：
 * 谁先到用谁，前台仍是逐帧校正，后台最慢也能每 60ms 推进一次。
 */
function nextFrame() {
  return new Promise(resolve => {
    let done = false
    let rafId = null
    const timer = setTimeout(() => {
      if (done) return
      done = true
      if (rafId != null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId)
      resolve()
    }, 60)
    rafId = raf(() => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve()
    })
  })
}

/** 应用的主滚动容器（App.jsx 里那个 <main>） */
export function getScroller(root) {
  const doc = root || (typeof document !== 'undefined' ? document : null)
  return doc ? doc.querySelector('main') : null
}

export function readScrollMetrics(scroller) {
  const rect = scroller.getBoundingClientRect()
  const scrollTop = scroller.scrollTop
  const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
  return {
    top: rect.top,
    scrollTop,
    maxScroll,
    scrollHeight: scroller.scrollHeight,
    clientHeight: scroller.clientHeight,
    atTop: scrollTop <= 0.5,
    atBottom: maxScroll > 0 && scrollTop >= maxScroll - 0.5,
  }
}

/** 在滚动容器内按锚点属性找元素（找不到返回 null） */
export function resolveAnchorElement(scroller, id, itemSelector = DEFAULT_ITEM_SELECTOR, anchorAttribute = DEFAULT_ANCHOR_ATTR) {
  if (!scroller || id == null || id === '') return null
  const wanted = String(id)
  const nodes = scroller.querySelectorAll(itemSelector)
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i]
    if (el.getAttribute(anchorAttribute) === wanted) return el
  }
  return null
}

/**
 * 采集当前位置快照。
 * @returns {{scrollTop:number, atBottom:boolean, anchor:{id:string, offset:number}|null}|null}
 *   anchor.offset = 锚点元素顶边相对滚动容器顶边的距离（负数表示已经滚出上边一点）
 */
export function captureScrollSnapshot(scroller, options = {}) {
  if (!scroller) return null
  const itemSelector = options.itemSelector || DEFAULT_ITEM_SELECTOR
  const anchorAttribute = options.anchorAttribute || DEFAULT_ANCHOR_ATTR
  const m = readScrollMetrics(scroller)
  const snapshot = {
    scrollTop: Math.round(m.scrollTop),
    atBottom: m.atBottom,
    anchor: null,
  }
  const nodes = scroller.querySelectorAll(itemSelector)
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i]
    const id = el.getAttribute(anchorAttribute)
    if (id == null || id === '') continue
    const r = el.getBoundingClientRect()
    // 完全滚出上边的条目不算锚点（0 高度元素同理：display:none 的筛除项）
    if (r.bottom <= m.top + 1) continue
    snapshot.anchor = { id, offset: Math.round(r.top - m.top) }
    break
  }
  return snapshot
}

/**
 * 把某个条目滚进视口（居中）。滚动快照缺失时的兜底：
 * 用户是点着这条进来的，至少要让他看到它。
 */
export async function revealItem(scroller, id, options = {}) {
  if (!scroller || id == null || id === '') return false
  const {
    itemSelector = DEFAULT_ITEM_SELECTOR,
    anchorAttribute = DEFAULT_ANCHOR_ATTR,
    attempts = 15,
    intervalMs = 120,
    isCancelled,
  } = options
  for (let i = 0; i < attempts; i++) {
    if (typeof isCancelled === 'function' && isCancelled()) return false
    const el = resolveAnchorElement(scroller, id, itemSelector, anchorAttribute)
    if (el) {
      const m = readScrollMetrics(scroller)
      const r = el.getBoundingClientRect()
      const topInContent = r.top - m.top + m.scrollTop
      const target = topInContent - (m.clientHeight / 2) + (r.height / 2)
      scroller.scrollTop = Math.max(0, Math.round(target))
      return true
    }
    if (i < attempts - 1) await new Promise(r => setTimeout(r, intervalMs))
  }
  return false
}

function setScrollTop(scroller, value) {
  const before = scroller.scrollTop
  scroller.scrollTop = value
  return Math.abs(scroller.scrollTop - before) > 0.5
}

// ── 用户主动滚动的信号 ──
// 键盘滚动不在这里监听 keydown（项目铁律：禁止裸 keydown 监听，一律走 ShortcutContext
// 注册中心）。键盘滚动由 AppShortcuts 的 scroll.main 和"返回顶部"按钮显式调用
// notifyUserScrollIntent() 通知过来。
let _userScrollIntent = 0

/** 声明"用户要自己控制滚动位置了"；正在进行的恢复会立刻放弃 */
export function notifyUserScrollIntent() {
  _userScrollIntent++
}

/** 恢复期间用户一动手就放弃：滚轮、触摸、拖滚动条 */
function watchUserInput(scroller, onInput) {
  const target = scroller || (typeof window !== 'undefined' ? window : null)
  if (!target || !target.addEventListener) return () => {}
  const handler = () => onInput()
  const opts = { passive: true }
  const events = ['wheel', 'touchstart', 'touchmove', 'mousedown']
  for (const e of events) target.addEventListener(e, handler, opts)
  return () => {
    for (const e of events) target.removeEventListener(e, handler, opts)
  }
}

/**
 * 把快照恢复到滚动容器上。返回 Promise，收敛 / 超时 / 被打断后 resolve。
 *
 * @param {HTMLElement} scroller 滚动容器（<main>）
 * @param {object} snapshot captureScrollSnapshot() 的产物
 * @param {object} [options]
 * @param {string} [options.itemSelector] 锚点选择器
 * @param {number} [options.maxMs] 最长校正时间
 * @param {() => boolean} [options.isCancelled] 外部取消条件（如组件已卸载）
 * @param {() => void} [options.onAligned] 第一次"看起来就位"时回调（页面据此显示内容）
 * @param {boolean} [options.abortOnUserInput=true] 用户一动就放弃
 * @returns {Promise<'converged'|'timeout'|'cancelled'|'aborted'|'noop'>}
 */
export async function applyScrollSnapshot(scroller, snapshot, options = {}) {
  const {
    itemSelector = DEFAULT_ITEM_SELECTOR,
    anchorAttribute = DEFAULT_ANCHOR_ATTR,
    maxMs = DEFAULT_MAX_MS,
    isCancelled,
    onAligned,
    abortOnUserInput = true,
  } = options

  if (!scroller || !snapshot) return 'noop'

  const cancelled = () => (typeof isCancelled === 'function' ? !!isCancelled() : false)
  const start = now()
  let deadline = start + maxMs
  const hardDeadline = start + Math.max(CONTENT_HARD_LIMIT_MS, maxMs)
  // 列表内容是否已经渲染出来（决定"到点收工"还是"再等等"）
  const hasContent = () => {
    try { return scroller.querySelectorAll(itemSelector).length > 0 } catch (_) { return true }
  }
  // 页面内容最多藏这么久：数据迟迟不来时也不能一直白屏
  const revealDeadline = start + REVEAL_AFTER_MS

  // 第一跳：直接按记录的像素位置就位。内容还没渲染出来时会被夹住，但已经能
  // 避免"先停在顶部再滚下去"的闪烁；随后的锚点校正负责修正偏差。
  setScrollTop(scroller, snapshot.scrollTop)
  if (snapshot.atBottom) setScrollTop(scroller, scroller.scrollHeight)

  let abortedByUser = false
  let aligned = false
  // 恢复开始时的"用户接管"计数：中途任何一个用户滚动意图都会让它变化
  const intentAtStart = _userScrollIntent
  const stopWatching = abortOnUserInput
    ? watchUserInput(scroller, () => { abortedByUser = true })
    : () => {}

  const notifyAligned = () => {
    if (aligned) return
    aligned = true
    if (typeof onAligned === 'function') onAligned()
  }

  let stable = 0
  let lastHeight = -1
  let lastChangeAt = now()
  let result = 'timeout'


  /** 快照要求的位置是否已经真正到位（没到位就不能算收敛） */
  const targetReached = () => {
    const max = scroller.scrollHeight - scroller.clientHeight
    if (snapshot.atBottom) return max <= 0 || scroller.scrollTop >= max - 1
    if (snapshot.anchor) {
      const o = anchorOffsetNow()
      return o != null && Math.abs(o - snapshot.anchor.offset) <= 2
    }
    return scroller.scrollTop >= Math.min(snapshot.scrollTop, Math.max(0, max)) - 2
  }

  /** 锚点当前相对容器顶边的偏移（找不到元素返回 null） */
  const anchorOffsetNow = () => {
    if (!snapshot.anchor) return null
    const el = resolveAnchorElement(scroller, snapshot.anchor.id, itemSelector, anchorAttribute)
    if (!el) return null
    return Math.round(el.getBoundingClientRect().top - readScrollMetrics(scroller).top)
  }

  /**
   * 收敛前的复核：安静窗口过后再等两帧，确认"位置 + 文档高度 + 贴底状态"都没变。
   * 页面数据还没到位（列表是空的）时一律不算收敛 —— 否则会在空白页面上"收敛"到顶部，
   * 等卡片渲染出来时已经收工，用户看到的就是"返回后回到顶端"。
   */
  const verifySettled = async () => {
    if (snapshot.anchor && !resolveAnchorElement(scroller, snapshot.anchor.id, itemSelector, anchorAttribute)
        && scroller.querySelectorAll(itemSelector).length === 0) {
      return false   // 内容还没渲染出来
    }
    // 位置必须先真正到位：只"安静"不算收敛 —— 页面还是空的时候同样很安静，
    // 那时候收工，等卡片渲染出来就会停在顶部（"返回后回到顶端"的成因）。
    if (!targetReached()) return false
    const before = { t: scroller.scrollTop, h: scroller.scrollHeight, o: anchorOffsetNow() }
    await nextFrame()
    await nextFrame()
    const after = { t: scroller.scrollTop, h: scroller.scrollHeight, o: anchorOffsetNow() }
    if (before.h !== after.h || Math.abs(before.t - after.t) > 1) return false
    if (before.o != null && (after.o == null || Math.abs(before.o - after.o) > 1)) return false
    return targetReached()
  }

  try {
    for (;;) {
      if (cancelled()) { result = 'cancelled'; break }
      if (abortedByUser || _userScrollIntent !== intentAtStart) { result = 'aborted'; break }
      const tick = now()
      if (tick >= deadline) {
        // 数据还没到、或列表还太矮够不着目标位置：顺延时限继续等。
        // 在"空白/半渲染"的页面上超时收工＝返回后停在顶部，这是必须避免的。
        const waiting = !hasContent() || !targetReached()
        if (waiting && tick < hardDeadline) deadline = tick + CONTENT_WAIT_STEP_MS
        else { result = 'timeout'; break }
      }

      await nextFrame()
      if (cancelled()) { result = 'cancelled'; break }
      if (abortedByUser || _userScrollIntent !== intentAtStart) { result = 'aborted'; break }

      const m = readScrollMetrics(scroller)
      const anchorEl = snapshot.anchor ? resolveAnchorElement(scroller, snapshot.anchor.id, itemSelector, anchorAttribute) : null

      let changed = false
      if (anchorEl) {
        const r = anchorEl.getBoundingClientRect()
        const delta = Math.round((r.top - m.top) - snapshot.anchor.offset)
        if (Math.abs(delta) > 1) changed = setScrollTop(scroller, m.scrollTop + delta) || changed
        else notifyAligned()
      } else if (snapshot.anchor) {
        // 锚点条目已经不在 DOM（还没渲染 / 被筛选掉）→ 退化成像素位置
        if (Math.abs(m.scrollTop - snapshot.scrollTop) > 1) changed = setScrollTop(scroller, snapshot.scrollTop) || changed
        else notifyAligned()
      } else if (Math.abs(m.scrollTop - snapshot.scrollTop) > 1) {
        changed = setScrollTop(scroller, snapshot.scrollTop) || changed
      } else {
        notifyAligned()
      }

      // 贴底快照：每帧把位置顶到底，逼浏览器把底部内容真正渲染出来
      if (snapshot.atBottom) {
        const max = scroller.scrollHeight - scroller.clientHeight
        if (max > 0 && scroller.scrollTop < max - 1) changed = setScrollTop(scroller, max) || changed
      }

      const heightChanged = scroller.scrollHeight !== lastHeight
      lastHeight = scroller.scrollHeight

      const nowMs = now()
      if (!changed && !heightChanged) {
        stable++
        // 位置与文档高度都安静了还不够：content-visibility 的补渲染可能在中间
        // 停顿几帧再继续（实测偶尔停 3~5 帧），所以还要满足"安静了 QUIET_MS"，
        // 并且再做一次跨帧复核。
        if (stable >= STABLE_FRAMES && nowMs - lastChangeAt >= QUIET_MS) {
          if (await verifySettled()) { result = 'converged'; break }
          stable = 0
          lastChangeAt = now()
        }
      } else {
        stable = 0
        lastChangeAt = nowMs
      }
      // 位置稳定、或藏得太久，都先把页面放出来
      if (!changed && !heightChanged) notifyAligned()
      else if (nowMs >= revealDeadline) notifyAligned()
    }
  } finally {
    stopWatching()
  }

  // 超时/取消也要保证页面被放出来，不能把内容一直藏住
  notifyAligned()
  return result
}

/** 立即把滚动位置置顶（从侧栏进入列表页时使用） */
export function resetScroll(scroller) {
  if (!scroller) return
  scroller.scrollTop = 0
}

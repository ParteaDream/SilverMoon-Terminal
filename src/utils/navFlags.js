/**
 * navFlags.js — 导航层的会话标记
 *
 * 列表页挂载时需要在**渲染之前**就知道"这次是不是返回"，否则第一帧会先画在
 * 顶部再跳走（用户看到的置顶闪烁）。React 的 useState 初始化跑在 effect 之前，
 * 所以标记必须能在渲染期同步读到 —— 这里统一收口这几个 sessionStorage 键，
 * 避免各页面自己拼字符串。
 */

// 本次导航是"回到看过的页面"，挂载后应恢复滚动位置
const RESTORE_FLAG = '_nav_restore_scroll'
// 返回列表时希望顺带露出的条目 id（仅在滚动快照缺失时作为兜底）
const FOCUS_ITEM_KEY = '_nav_focus_item'

export function markScrollRestore() {
  try { sessionStorage.setItem(RESTORE_FLAG, '1') } catch (_) {}
}

/** 只读探测（渲染期可用），不消费标记 */
export function peekScrollRestore() {
  try { return sessionStorage.getItem(RESTORE_FLAG) === '1' } catch (_) { return false }
}

/** 消费标记：返回是否处于"返回"导航 */
export function consumeScrollRestore() {
  try {
    const on = sessionStorage.getItem(RESTORE_FLAG) === '1'
    if (on) sessionStorage.removeItem(RESTORE_FLAG)
    return on
  } catch (_) { return false }
}

export function clearScrollRestore() {
  try { sessionStorage.removeItem(RESTORE_FLAG) } catch (_) {}
}

export function setFocusItem(id) {
  try {
    if (id == null || id === '') sessionStorage.removeItem(FOCUS_ITEM_KEY)
    else sessionStorage.setItem(FOCUS_ITEM_KEY, String(id))
  } catch (_) {}
}

/** 取出并清空焦点条目（只有真正用得上时才消费，避免污染后续导航） */
export function takeFocusItem() {
  try {
    const v = sessionStorage.getItem(FOCUS_ITEM_KEY)
    if (v != null) sessionStorage.removeItem(FOCUS_ITEM_KEY)
    return v
  } catch (_) { return null }
}

export function clearFocusItem() {
  try { sessionStorage.removeItem(FOCUS_ITEM_KEY) } catch (_) {}
}

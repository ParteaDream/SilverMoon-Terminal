// ═════════════════════════════════════════════════════════════════
// focusTrap.js — 焦点圈闭纯 DOM 工具（弹层/菜单共用，配合 useOverlay）
// 全键盘适配基建（规划 M0）。
// ═════════════════════════════════════════════════════════════════

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
  '[contenteditable=""]',
].join(', ')

function isNodeVisible(el) {
  if (typeof el.getClientRects !== 'function' || el.getClientRects().length === 0) return false
  let n = el
  while (n && n.nodeType === 1) {
    if (n.getAttribute && n.getAttribute('aria-hidden') === 'true') return false
    n = n.parentElement
  }
  return true
}

// 收集 root 内的可聚焦序列（DOM 顺序）。
// root 为 Element 时以 root 为界；传入 document 则全文档。
// includeRoot：root 自身可聚焦时是否计入（用于窗口容器类圈闭）。
export function queryTabbables(root = document, { includeRoot = false } = {}) {
  const isDoc = root.nodeType === 9 || root === document
  const scope = isDoc ? document : root
  const nodes = Array.from(scope.querySelectorAll(FOCUSABLE_SELECTOR))
  if (!isDoc && includeRoot && root.matches && root.matches(FOCUSABLE_SELECTOR)) nodes.unshift(root)
  return nodes.filter(isNodeVisible)
}

export function focusFirst(root, opts) {
  const list = queryTabbables(root, opts)
  if (list.length > 0) { safeFocus(list[0]); return list[0] }
  return null
}

export function focusLast(root, opts) {
  const list = queryTabbables(root, opts)
  if (list.length > 0) { safeFocus(list[list.length - 1]); return list[list.length - 1] }
  return null
}

// 元素存在且已连接时才聚焦（防卸载后聚焦报错）；preventScroll 默认关
export function safeFocus(el, { preventScroll = false } = {}) {
  if (!el || typeof el.focus !== 'function') return false
  if (el.isConnected === false && el !== document.activeElement) return false
  try { el.focus({ preventScroll }) } catch (_) { el.focus() }
  return document.activeElement === el
}

// Tab/Shift+Tab 圈闭处理：焦点已落在首/尾（或不在 root 内）时循环。
// 返回 true 表示已拦截（调用方应 stopPropagation）。
export function handleTabInTrap(e, root, opts) {
  if (e.key !== 'Tab') return false
  const list = queryTabbables(root, opts)
  if (list.length === 0) { e.preventDefault(); return true }
  const active = document.activeElement
  const inside = root === document || root.nodeType === 9
    ? true
    : (root.contains ? root.contains(active) : root === active)
  const first = list[0]
  const last = list[list.length - 1]
  if (e.shiftKey) {
    if (!inside || active === first) { e.preventDefault(); safeFocus(last); return true }
  } else {
    if (!inside || active === last) { e.preventDefault(); safeFocus(first); return true }
  }
  return false
}

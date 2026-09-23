// ═════════════════════════════════════════════════════════════════
// pageKeyboard.js — 壳层键盘行为工具（规划 M1）
//   scrollMainByKey: Home/End/PageUp/PageDown 滚动主内容区（滚动代理 §2.10）
//   focusPageSearch: '/' 聚焦当前页搜索框
// 浏览器默认按键滚动只作用于"焦点所在的可滚动祖先"；焦点落在按钮等非滚动
// 元素时 main 不会滚动，故提供代理。焦点若在嵌套滚动容器内（如应用窗口、
// 表格），交还浏览器原生行为，避免双重滚动。
// ═════════════════════════════════════════════════════════════════

export function getMainScroller() {
  return document.querySelector('main')
}

// ── 侧栏控制集：Tab/方向键的唯一循环域（板块 + 收起/展开 + 版本信息）──
export function getSidebarControls() {
  const aside = document.querySelector('aside')
  if (!aside) return []
  return Array.from(aside.querySelectorAll('button')).filter(btn => {
    const r = btn.getClientRects()
    return r.length > 0 && r[0].width > 0
  })
}

// 聚焦侧栏控制：dir=1 下一项 / -1 上一项；当前不在侧栏时从侧栏头部进入。
// 返回是否成功聚焦。
export function focusSidebarControl(dir = 1, { from } = {}) {
  const items = getSidebarControls()
  if (items.length === 0) return false
  const active = from || document.activeElement
  const idx = items.indexOf(active)
  let next
  if (idx < 0) {
    next = dir >= 0 ? 0 : items.length - 1
  } else {
    next = (idx + dir + items.length) % items.length
  }
  items[next].focus()
  return true
}

// 聚焦页面主区域（"再次 Enter 进入内容"，2025-09 修订：搜索框仅由 '/' 触发）：
// 优先 [data-page-zone] 内容区内的首个可聚焦项（画廊卡片/桌面图标等）；
// 无内容区时回退首个非搜索可交互控件；搜索框不作为入口。
export function focusPageZone() {
  const main = getMainScroller()
  if (!main) return false
  const zone = main.querySelector('[data-page-zone]')
  const scope = zone || main
  const sel = 'button:not([disabled]), a[href], [role="button"], [tabindex]:not([tabindex="-1"]), input:not([type="hidden"]), select, textarea'
  const nodes = Array.from(scope.querySelectorAll(sel))
  const pick = nodes.find(n => {
    if (n.disabled || n.readOnly) return false
    const rect = n.getClientRects()
    if (rect.length === 0 || rect[0].width === 0) return false
    if (n.tagName === 'INPUT' && (n.type === 'text' || n.type === 'search')) return false
    return true
  }) || nodes.find(n => {
    if (n.disabled || n.readOnly) return false
    return n.getClientRects().length > 0
  })
  if (pick) { pick.focus(); return true }
  if (zone) { zone.focus(); return true }
  return false
}

// 兼容旧名（避免遗留引用）
export const focusMainPrimary = focusPageZone

// activeElement 是否位于 main 之外的嵌套滚动容器中
// （sidebar、应用窗口、表格等自带滚动且不属于 main 的情况）
function insideForeignScroller(el, main) {
  let n = el && el.nodeType === 1 ? el.parentElement : null
  while (n && n !== document.body && n !== main) {
    if (n.scrollHeight > n.clientHeight + 4 || n.scrollWidth > n.clientWidth + 4) return true
    n = n.parentElement
  }
  return false
}

// 返回 true 表示已消费（调用方应 preventDefault）
export function scrollMainByKey(key) {
  const main = getMainScroller()
  if (!main) return false
  const active = document.activeElement
  if (active && active.nodeType === 1 && insideForeignScroller(active, main)) return false
  const k = String(key).toLowerCase()
  const maxTop = main.scrollHeight - main.clientHeight
  let top = main.scrollTop
  if (k === 'home') top = 0
  else if (k === 'end') top = maxTop
  else if (k === 'pageup') top -= main.clientHeight * 0.9
  else if (k === 'pagedown') top += main.clientHeight * 0.9
  else return false
  top = Math.max(0, Math.min(maxTop, top))
  if (top !== main.scrollTop) main.scrollTo({ top, behavior: 'auto' })
  return true
}

// 聚焦当前页第一个"像搜索框"的输入；返回是否找到
export function focusPageSearch() {
  const main = getMainScroller()
  if (!main) return false
  const inputs = Array.from(main.querySelectorAll('input'))
  const candidates = inputs.filter(inp => {
    const t = (inp.type || 'text').toLowerCase()
    if (!['text', 'search'].includes(t)) return false
    if (inp.disabled || inp.readOnly) return false
    const r = inp.getClientRects()
    return r.length > 0 && r[0].width > 0
  })
  if (candidates.length === 0) return false
  const ph = (inp) => (inp.placeholder || '').toLowerCase()
  const searchLike = candidates.filter(inp =>
    inp.type === 'search' || /搜索|查找|search/.test(ph(inp)))
  const target = (searchLike[0] || candidates[0])
  target.focus()
  if (typeof target.select === 'function') target.select()
  return true
}
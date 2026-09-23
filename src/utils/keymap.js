// ═════════════════════════════════════════════════════════════════
// keymap.js — 键位解析 / 匹配 / 格式化 / 冲突检测 + 默认键位目录
// 全键盘适配基建（规划 M0）。纯函数模块，node 可直接单测。
// 键位字符串格式沿用 appRegistry：'ctrl+tab' / 'shift+alt+l'，
// 额外支持 'mod' 平台别名（mac→meta，win→ctrl），仅用于默认键位目录。
// ═════════════════════════════════════════════════════════════════

export function isMacPlatform() {
  return typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || '')
}

// ── 解析：'ctrl+shift+meta+alt+KEY' → { ctrl, alt, shift, meta, mod, key } ──
export function parseShortcut(shortcut) {
  if (!shortcut) return null
  const parts = String(shortcut).toLowerCase().split('+').filter(Boolean)
  if (parts.length === 0) return null
  const key = parts[parts.length - 1]
  return {
    ctrl: parts.includes('ctrl'),
    alt: parts.includes('alt'),
    shift: parts.includes('shift'),
    meta: parts.includes('meta'),
    mod: parts.includes('mod'),
    key,
  }
}

// 解析后的规格序列化（用于冲突比较）；'mod' 已展开为具体平台键
function serializeSpec(spec) {
  const parts = []
  if (spec.ctrl) parts.push('ctrl')
  if (spec.alt) parts.push('alt')
  if (spec.shift) parts.push('shift')
  if (spec.meta) parts.push('meta')
  parts.push(spec.key)
  return parts.join('+')
}

// 展开为全部具体平台形式：'mod+1' → ['meta+1', 'ctrl+1']
export function expandShortcuts(shortcut) {
  const spec = parseShortcut(shortcut)
  if (!spec) return []
  if (!spec.mod) return [serializeSpec(spec)]
  return [
    serializeSpec({ ...spec, meta: true, mod: false }),
    serializeSpec({ ...spec, ctrl: true, mod: false }),
  ]
}

// 两个键位字符串是否可能冲突（任一平台形式相同即冲突）
export function conflicts(a, b) {
  if (!a || !b) return false
  const A = expandShortcuts(a)
  const B = expandShortcuts(b)
  if (A.length === 0 || B.length === 0) {
    return String(a).toLowerCase() === String(b).toLowerCase()
  }
  return A.some(x => B.includes(x))
}

// ── 匹配：事件是否命中键位 ──
// 与旧 appRegistry.matchShortcut 语义完全一致（严格比较全部修饰键），
// 扩展：'mod' 别名按平台解析为 meta(mac)/ctrl(win)，'esc' 兼容 'Escape'。
export function matchesKeyEvent(e, shortcut, { mac } = {}) {
  const spec = parseShortcut(shortcut)
  if (!spec) return false
  const isMac = mac !== undefined ? !!mac : isMacPlatform()
  // mod 别名解析：目标平台所需的 ctrl/meta 期望值
  const wantCtrl = spec.mod ? !isMac : spec.ctrl
  const wantMeta = spec.mod ? isMac : spec.meta
  if (!!e.ctrlKey !== wantCtrl || !!e.metaKey !== wantMeta) return false
  if (!!e.altKey !== !!spec.alt) return false
  const plain = !spec.ctrl && !spec.alt && !spec.shift && !spec.meta && !spec.mod
  // 纯字符键（无修饰声明）：Shift 的差异已体现在 e.key 大小写/符号中（'f'/'F'、'/'/'?'），
  // 不重复要求 shiftKey，与存量页面行为（如祈愿 F 大小写皆触发）一致
  if (!plain && !!e.shiftKey !== !!spec.shift) return false
  const key = String(e.key).toLowerCase()
  if (spec.key === 'tab') return key === 'tab'
  if (spec.key === 'space') return key === ' ' || key === 'spacebar'
  if (spec.key === 'esc' || spec.key === 'escape') return key === 'escape' || key === 'esc'
  if (spec.key.length === 1) return key === spec.key
  return key === spec.key
}

// 兼容旧导出（TerminalDock 等历史调用点）
export function matchShortcut(e, shortcut) {
  return matchesKeyEvent(e, shortcut)
}

// 物理键匹配：按 e.code（如 BracketLeft/Slash）判定，不依赖输入法输出的 e.key。
// 用途：标点符号类键位（[ ] / 等）在中英文输入法下 e.key 可能变成全角字符，
// 物理位置不受影响。规则：无任何修饰键按下时才匹配。
export function matchesCodeEvent(e, codes) {
  if (!codes || codes.length === 0 || !e || !e.code) return false
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return false
  const code = String(e.code).toLowerCase()
  return codes.some(c => String(c).toLowerCase() === code)
}

// 物理键映射：某个键位若绑定在符号键上，应给出其 e.code 候选
// （KEYMAP 与注册项均可引用；'[ '与 '/' 等跨输入法键位必备）
export const PHYSICAL_CODES = {
  '[': ['BracketLeft'],
  ']': ['BracketRight'],
  '/': ['Slash'],
}

// ── 键名展示 ──
const MAC_KEY_SYMBOLS = {
  tab: '⇥', space: 'Space', enter: '↩', escape: '⎋',
  arrowleft: '←', arrowright: '→', arrowup: '↑', arrowdown: '↓',
  home: 'Home', end: 'End', pageup: 'PgUp', pagedown: 'PgDn',
  backspace: '⌫', delete: '⌦', insert: 'Ins',
}
const WIN_KEY_NAMES = {
  space: 'Space', enter: 'Enter', escape: 'Esc',
  arrowleft: '←', arrowright: '→', arrowup: '↑', arrowdown: '↓',
  pageup: 'PgUp', pagedown: 'PgDn',
}
function prettyKey(key, mac) {
  if (!key) return ''
  if (mac && MAC_KEY_SYMBOLS[key]) return MAC_KEY_SYMBOLS[key]
  if (!mac && WIN_KEY_NAMES[key]) return WIN_KEY_NAMES[key]
  const lower = key.toLowerCase()
  if (lower.length === 1) return lower.toUpperCase()
  return key.charAt(0).toUpperCase() + key.slice(1)
}

// 'ctrl+tab' → mac '⌃⇥' / win 'Ctrl+Tab'（沿用 TerminalPage 录制区显示风格）
export function formatShortcut(shortcut, { mac } = {}) {
  const spec = parseShortcut(shortcut)
  if (!spec) return ''
  const isMac = mac !== undefined ? !!mac : isMacPlatform()
  const modIsMeta = spec.mod ? isMac : false
  const key = prettyKey(spec.key, isMac)
  if (isMac) {
    const parts = []
    if (modIsMeta || spec.meta) parts.push('⌘')
    if (spec.shift) parts.push('⇧')
    if (spec.alt) parts.push('⌥')
    if (spec.ctrl) parts.push('⌃')
    return parts.join('') + key
  }
  const parts = []
  if (spec.ctrl || modIsMeta) parts.push('Ctrl')
  if (spec.alt) parts.push('Alt')
  if (spec.shift) parts.push('Shift')
  if (spec.meta) parts.push('Win')
  return [...parts, key].join('+')
}

// ── 输入豁免判定（纯函数部分，DOM 由调用方提供）──
// tagName: 'INPUT'|'TEXTAREA'|'SELECT'|其他；isContentEditable 同 DOM 语义
export function isTypingTargetInfo({ tagName = '', isContentEditable = false, readOnly = false } = {}) {
  const tag = String(tagName).toUpperCase()
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return !readOnly
  return !!isContentEditable && !readOnly
}

// ── 默认键位目录（目录 + 帮助面数据源；绑定状态见注册中心）──
// scope: system(弹层打开也可用) | app | page | overlay
// 2025-09 修订（用户反馈）：不使用修饰组合键；keys: [] 的条目为"操作指引"行，
// 帮助面按说明行展示，不参与绑定。
export const KEYMAP = [
  { id: 'guide.tab', keys: [], scope: 'app', desc: 'Tab/Shift+Tab：仅在侧栏循环（板块+收起/展开+版本信息），不进入页面内容' },
  { id: 'guide.enter', keys: [], scope: 'app', desc: 'Enter：打开所选板块；已在当前板块时再次 Enter 聚焦页面首个条目（内容区游标）；搜索请用 /' },
  { id: 'guide.escape', keys: [], scope: 'app', desc: 'Esc：关闭弹层/菜单；无弹层时返回侧栏（内容区 → 板块选择）' },
  { id: 'guide.move', keys: [], scope: 'app', desc: '页面光标：WASD/方向键 = 自动聚焦首图标并在 按钮↔条目 间移动（焦点框平滑跟随）' },
  { id: 'guide.actions', keys: [], scope: 'app', desc: '通用：Enter 确认/进入 · Space 勾选 · Shift+F10 打开当前项菜单' },
  { id: 'app.back', keys: ['['], scope: 'app', desc: '后退（物理键 [，兼容中文输入法）' },
  { id: 'app.forward', keys: [']'], scope: 'app', desc: '前进（物理键 ]，兼容中文输入法）' },
  { id: 'library.toggle', keys: ['ctrl+tab'], scope: 'system', desc: '资源库（存量功能，设置内可自定义或修改）' },
  { id: 'help.overlay', keys: ['f1'], scope: 'system', desc: '快捷键速查' },
  { id: 'page.search', keys: ['/'], scope: 'app', desc: '聚焦当前页搜索框（物理键 /，与 ? 同键仅此一用）' },
  { id: 'wishes.view-toggle', keys: ['f'], scope: 'page', desc: '祈愿：切换卡池图/详情（后续阶段绑定）' },
  { id: 'scroll.main', keys: ['home', 'end', 'pageup', 'pagedown'], scope: 'app', desc: '滚动：页面顶部/底部/上一页/下一页' },
]

// 目录完整性检查（供测试与启动断言）：id 唯一 + 键位可解析 + 无同 scope 冲突
export function validateKeymap() {
  const errors = []
  const ids = new Set()
  for (const entry of KEYMAP) {
    if (ids.has(entry.id)) errors.push('重复 id: ' + entry.id)
    ids.add(entry.id)
    for (const k of entry.keys) {
      if (!parseShortcut(k)) errors.push('非法键位: ' + entry.id + ' → ' + k)
    }
  }
  for (let i = 0; i < KEYMAP.length; i++) {
    for (let j = i + 1; j < KEYMAP.length; j++) {
      const a = KEYMAP[i]; const b = KEYMAP[j]
      if (a.scope !== b.scope) continue
      const hit = a.keys.some(ka => b.keys.some(kb => conflicts(ka, kb)))
      if (hit) errors.push('同 scope 键位冲突: ' + a.id + ' ↔ ' + b.id)
    }
  }
  return errors
}

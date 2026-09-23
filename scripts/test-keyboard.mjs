// ═════════════════════════════════════════════════════════════════
// test-keyboard.mjs — 键盘适配基建纯函数单测（规划 M0）
// 覆盖：keymap 解析/匹配/冲突/格式化/目录校验、roving 步进。
// 运行：npm run test:keyboard
// ═════════════════════════════════════════════════════════════════
import {
  parseShortcut, matchesKeyEvent, matchesCodeEvent, expandShortcuts, conflicts,
  formatShortcut, isTypingTargetInfo, validateKeymap,
} from '../src/utils/keymap.js'
import { stepRovingIndex } from '../src/utils/roving.js'
import { dirOfKey, pickNearest } from '../src/utils/spatialNav.js'

let failures = 0
const ok = (name, cond, extra) => {
  if (cond) console.log('  ✓ ' + name)
  else { failures++; console.log('  ✗ ' + name, extra ?? '') }
}

console.log('== keymap: 解析 ==')
ok('空/无效输入 → null', parseShortcut(null) === null && parseShortcut('') === null)
const p = parseShortcut('ctrl+shift+alt+meta+f')
ok('修饰键解析', p && p.ctrl && p.shift && p.alt && p.meta && p.key === 'f')
ok("mod+1 解析", parseShortcut('mod+1').mod === true && parseShortcut('mod+1').key === '1')

console.log('== keymap: 事件匹配（与旧 matchShortcut 语义一致）==')
const ev = (k, mods = {}) => ({ key: k, ctrlKey: !!mods.ctrl, altKey: !!mods.alt, shiftKey: !!mods.shift, metaKey: !!mods.meta })
ok('ctrl+tab 命中', matchesKeyEvent(ev('Tab', { ctrl: true }), 'ctrl+tab'))
ok('ctrl+tab 缺 ctrl 不命中', !matchesKeyEvent(ev('Tab'), 'ctrl+tab'))
ok('ctrl+tab 多按 shift 不命中（严格比较）', !matchesKeyEvent(ev('Tab', { ctrl: true, shift: true }), 'ctrl+tab'))
ok('多修饰组合命中', matchesKeyEvent(ev('L', { ctrl: true, alt: true, shift: true }), 'ctrl+alt+shift+l'))
ok('单字符键大小写不敏感', matchesKeyEvent(ev('F'), 'f') && matchesKeyEvent(ev('f'), 'f'))
ok('space 兼容两种键名', matchesKeyEvent(ev(' ', { ctrl: true }), 'ctrl+space') && matchesKeyEvent(ev('Spacebar', { ctrl: true }), 'ctrl+space'))
ok('esc/escape 互通', matchesKeyEvent(ev('Escape'), 'esc') && matchesKeyEvent(ev('Esc'), 'escape'))
ok('纯字符键容忍 Shift（? 需 Shift+/）', matchesKeyEvent(ev('?', { shift: true }), '?'))
ok('纯字符键大写等价（F 键位大小写皆触发）', matchesKeyEvent(ev('F', { shift: true }), 'f'))
ok('纯字符键带 Ctrl 不触发', !matchesKeyEvent(ev('F', { ctrl: true }), 'f') && !matchesKeyEvent(ev('1', { ctrl: true }), '1'))
ok('显式 shift 声明仍严格', matchesKeyEvent(ev('L', { shift: true }), 'shift+l') && !matchesKeyEvent(ev('l'), 'shift+l'))

console.log('== keymap: 物理键（e.code，输入法无关）==')
const ce = (code, mods = {}) => ({ code, ctrlKey: !!mods.ctrl, altKey: !!mods.alt, shiftKey: !!mods.shift, metaKey: !!mods.meta })
ok('BracketLeft 命中', matchesCodeEvent(ce('BracketLeft'), ['BracketLeft']))
ok('Slash 命中', matchesCodeEvent(ce('Slash'), ['Slash']))
ok('大小写不敏感', matchesCodeEvent(ce('bracketleft'), ['BracketLeft']))
ok('带修饰键不命中', !matchesCodeEvent(ce('BracketLeft', { shift: true }), ['BracketLeft']) && !matchesCodeEvent(ce('BracketLeft', { ctrl: true }), ['BracketLeft']))
ok('无 e.code / 空表不命中', !matchesCodeEvent(ce(''), ['BracketLeft']) && !matchesCodeEvent(ce('BracketLeft'), []))
ok('mod 别名 mac：meta 命中、ctrl 不命中', matchesKeyEvent(ev('1', { meta: true }), 'mod+1', { mac: true }) && !matchesKeyEvent(ev('1', { ctrl: true }), 'mod+1', { mac: true }))
ok('mod 别名 win：ctrl 命中、meta 不命中', matchesKeyEvent(ev('1', { ctrl: true }), 'mod+1', { mac: false }) && !matchesKeyEvent(ev('1', { meta: true }), 'mod+1', { mac: false }))

console.log('== keymap: 冲突 ==')
ok('mod+1 ↔ meta+1 冲突（mac 形式）', conflicts('mod+1', 'meta+1'))
ok('mod+1 ↔ ctrl+1 冲突（win 形式）', conflicts('mod+1', 'ctrl+1'))
ok('mod+1 ↔ mod+2 不冲突', !conflicts('mod+1', 'mod+2'))
ok('ctrl+tab ↔ ctrl+tab 冲突', conflicts('ctrl+tab', 'ctrl+tab'))
ok('ctrl+tab ↔ shift+tab 不冲突', !conflicts('ctrl+tab', 'shift+tab'))
const ex = expandShortcuts('mod+shift+z')
const hasMod = (list, m) => list.some(s => { const parts = s.split('+'); return parts.includes(m) && parts.includes('shift') && parts.includes('z') })
ok('mod 展开为双平台', ex.length === 2 && hasMod(ex, 'meta') && hasMod(ex, 'ctrl'))

console.log('== keymap: 格式化 ==')
ok('mac 组合排序', formatShortcut('ctrl+shift+alt+meta+f', { mac: true }) === '⌘⇧⌥⌃F')
ok('mac ctrl+tab', formatShortcut('ctrl+tab', { mac: true }) === '⌃⇥')
ok('win ctrl+tab', formatShortcut('ctrl+tab', { mac: false }) === 'Ctrl+Tab')
ok('mod mac → ⌘+数字', formatShortcut('mod+3', { mac: true }) === '⌘3')
ok('win shift 大写键', formatShortcut('shift+f', { mac: false }) === 'Shift+F')

console.log('== keymap: 输入豁免 ==')
ok('INPUT 豁免', isTypingTargetInfo({ tagName: 'INPUT' }) === true)
ok('TEXTAREA 豁免', isTypingTargetInfo({ tagName: 'TEXTAREA' }) === true)
ok('SELECT 豁免', isTypingTargetInfo({ tagName: 'SELECT' }) === true)
ok('readOnly 输入不豁免', isTypingTargetInfo({ tagName: 'INPUT', readOnly: true }) === false)
ok('contentEditable 豁免', isTypingTargetInfo({ tagName: 'DIV', isContentEditable: true }) === true)
ok('普通 div 不豁免', isTypingTargetInfo({ tagName: 'DIV' }) === false)

console.log('== keymap: 目录完整性 ==')
const errs = validateKeymap()
ok('KEYMAP 无重复 id / 非法键位 / 同 scope 冲突', errs.length === 0, errs.join('; '))

console.log('== roving: 步进 ==')
ok('右移 +1', stepRovingIndex({ index: 2, count: 10, key: 'ArrowRight' }) === 3)
ok('行首左移不动', stepRovingIndex({ index: 0, count: 10, key: 'ArrowLeft' }) === 0)
ok('wrap 环绕', stepRovingIndex({ index: 0, count: 10, key: 'ArrowLeft', wrap: true }) === 9)
ok('下移跨列(grid)', stepRovingIndex({ index: 1, count: 12, key: 'ArrowDown', columns: 4 }) === 5)
ok('下移越界夹紧', stepRovingIndex({ index: 10, count: 12, key: 'ArrowDown', columns: 4 }) === 11)
ok('wrap 网格下移环绕行首', stepRovingIndex({ index: 10, count: 12, key: 'ArrowDown', columns: 4, wrap: true }) === 2)
ok('Home/End', stepRovingIndex({ index: 5, count: 12, key: 'Home' }) === 0 && stepRovingIndex({ index: 5, count: 12, key: 'End' }) === 11)
ok('PageUp/PageDown', stepRovingIndex({ index: 5, count: 40, key: 'PageUp' }) === 0 && stepRovingIndex({ index: 5, count: 40, key: 'PageDown' }) === 15)
ok('PageUp 夹紧到 0', stepRovingIndex({ index: 3, count: 40, key: 'PageUp', pageSize: 10 }) === 0)
ok('空列表 → null', stepRovingIndex({ index: 0, count: 0, key: 'ArrowDown' }) === null)
ok('Enter 非移动键 → null', stepRovingIndex({ index: 2, count: 10, key: 'Enter' }) === null)

console.log('== 空间导航（spatialNav）==')
ok('WASD 方向映射', dirOfKey('w') === 'up' && dirOfKey('s') === 'down' && dirOfKey('a') === 'left' && dirOfKey('d') === 'right' && dirOfKey('ArrowUp') === 'up' && dirOfKey('x') === null)
const R = (l, t, w, h) => ({ left: l, top: t, right: l + w, bottom: t + h, width: w, height: h })
const row = [R(0, 0, 80, 120), R(100, 0, 80, 120), R(200, 0, 80, 120), R(0, 140, 80, 120), R(100, 140, 80, 120)]
const cands = row.map(rect => ({ rect, el: { id: rect.left + ':' + rect.top } }))
ok('右移选同行最近', pickNearest(row[0], cands, 'right').el.id === '100:0')
ok('下移选同列/最近（100,140 比 0,140 交叉更小）', pickNearest(row[0], cands, 'down').el.id === '0:140')
ok('左移在第一列无候选', pickNearest(row[0], cands, 'left') === null)
ok('上移在第一行无候选', pickNearest(row[0], cands, 'up') === null)
ok('空候选/空方向返回 null', pickNearest(row[0], [], 'down') === null && pickNearest(row[0], cands, 'x') === null)
ok('WASD：w=上 s=下 a=左 d=右（grid 列距）',
  stepRovingIndex({ index: 4, count: 12, key: 'w', columns: 4 }) === 0 &&
  stepRovingIndex({ index: 4, count: 12, key: 's', columns: 4 }) === 8 &&
  stepRovingIndex({ index: 2, count: 12, key: 'a' }) === 1 &&
  stepRovingIndex({ index: 2, count: 12, key: 'd' }) === 3)
ok('WASD 大小写皆可（W 与 w 等价）', stepRovingIndex({ index: 4, count: 12, key: 'W', columns: 4 }) === 0)

if (failures > 0) {
  console.log('')
  console.log('失败 ' + failures + ' 项')
  process.exit(1)
}
console.log('')
console.log('全部通过 ✓')

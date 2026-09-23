// ═════════════════════════════════════════════════════════════════
// audit-keyboard.mjs — 全键盘适配静态审计（规划 M0 / §3.7）
// 用法：
//   node scripts/audit-keyboard.mjs [--write-baseline] [--strict]
// --write-baseline 生成 scripts/baseline-keyboard.json（当前即基线）
// --strict 任一类别超过基线时以非 0 退出（回归门禁）
// 规则详见 doc/全键盘操作适配规划.md 附录 B。
// ═════════════════════════════════════════════════════════════════
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const SRC = path.join(ROOT, 'src')
const BASELINE = path.join(ROOT, 'scripts', 'baseline-keyboard.json')
const ARGS = new Set(process.argv.slice(2))
const WRITE = ARGS.has('--write-baseline')
const STRICT = ARGS.has('--strict')

const RULES = ['nonsemanticClickables', 'iconButtonsNoLabel', 'rawKeydown', 'overlayNoDialog', 'tabIndexUses', 'ctxMenuNonInteractive', 'outlineNoneNoFocus']

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === '.DS_Store' || ent.name === 'node_modules') continue
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) walk(p, out)
    else if (/\.(jsx|js|mjs)$/.test(ent.name)) out.push(p)
  }
  return out
}

const TAG_RE = /<(\/?)([A-Za-z][\w-]*)((?:\"[^\"]*\"|\'[^\']*\'|[^>\"\'])*)>/g
const NONSEMANTIC = new Set(['div', 'span', 'li', 'p'])

function scan(src, rel) {
  const hits = Object.fromEntries(RULES.map(r => [r, 0]))
  const rows = []
  let m
  TAG_RE.lastIndex = 0
  while ((m = TAG_RE.exec(src))) {
    const closing = !!m[1]
    const name = m[2].toLowerCase()
    const attrs = m[3]
    const rawEnd = m.index + m[0].length
    const has = (re) => re.test(attrs)
    const line = () => src.slice(0, m.index).split('\n').length
    if (!closing) {
      if (NONSEMANTIC.has(name)) {
        if (has(/onClick\s*=/)) {
          const keyboardAlt = has(/onKeyDown\s*=/) || has(/onKeyPress\s*=/) || has(/tabIndex\s*=|tabindex\s*=/) || has(/role\s*=\s*["']button["']/)
          if (!keyboardAlt) { hits.nonsemanticClickables++; rows.push(['nonsemanticClickables', rel, line()]) }
        }
        if (has(/onContextMenu\s*=/) && !has(/onKeyDown\s*=/)) { hits.ctxMenuNonInteractive++; rows.push(['ctxMenuNonInteractive', rel, line()]) }
      }
      if (name === 'button') {
        const closeIdx = src.indexOf('</button>', rawEnd)
        const content = closeIdx >= 0 ? src.slice(rawEnd, closeIdx) : ''
        const visibleText = content.replace(/<[^>]*>/g, '').replace(/&[a-zA-Z#0-9]+;/g, '').trim()
        if (visibleText.length === 0 && !has(/aria-label\s*=|aria-labelledby\s*=/)) {
          hits.iconButtonsNoLabel++; rows.push(['iconButtonsNoLabel', rel, line()])
        }
      }
      if (name === 'div' && /\bfixed\b/.test(attrs) && /inset-0/.test(attrs) && !has(/role\s*=/) && !has(/data-overlay/) && !has(/aria-hidden\s*=/)) {
        hits.overlayNoDialog++; rows.push(['overlayNoDialog', rel, line()])
      }
      if (/^(button|input|textarea|select|a)$/.test(name) && /focus:outline-none/.test(attrs) && !/focus:ring/.test(attrs) && !/focus:border/.test(attrs)) {
        hits.outlineNoneNoFocus++; rows.push(['outlineNoneNoFocus', rel, line()])
      }
    }
  }
  // 行级规则（不依赖 tag 扫描）
  if (!/ShortcutContext\.jsx$/.test(rel)) {
    const kd = src.match(/addEventListener\s*\(\s*['"]keydown['"]/g)
    if (kd) { hits.rawKeydown += kd.length; rows.push(['rawKeydown', rel, '-']) }
  }
  const ti = src.match(/\btab(?:Index|index)\s*=/g)
  // 排除 CSS 属性选择器写法（如 [tabindex="-1"]），其非实际 tabIndex 属性使用
  const cssSel = src.match(/\[tabindex\s*=/g)
  if (ti) hits.tabIndexUses += Math.max(0, ti.length - (cssSel ? cssSel.length : 0))
  return { hits, rows }
}

const files = walk(SRC)
const totals = Object.fromEntries(RULES.map(r => [r, 0]))
const perFile = {}
const allRows = []
for (const f of files) {
  const rel = path.relative(ROOT, f)
  const src = fs.readFileSync(f, 'utf8')
  const { hits, rows } = scan(src, rel)
  perFile[rel] = hits
  for (const r of RULES) totals[r] += hits[r]
  allRows.push(...rows)
}

if (WRITE) {
  const payload = { generatedAt: new Date().toISOString(), totals, perFile }
  fs.writeFileSync(BASELINE, JSON.stringify(payload, null, 2))
  console.log('基线已写入 scripts/baseline-keyboard.json')
  printSummary(totals, files.length)
  process.exit(0)
}

console.log('== 键盘适配静态审计 ==')
printSummary(totals, files.length)
if (fs.existsSync(BASELINE)) {
  const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'))
  console.log('\n== 与基线对比 ==')
  let regress = false
  for (const r of RULES) {
    const b = base.totals?.[r] ?? 0
    const delta = totals[r] - b
    if (delta > 0) { regress = true; console.log('  ✗ ' + r + ': ' + b + ' → ' + totals[r] + ' (+' + delta + ')') }
    else if (delta < 0) console.log('  ✓ ' + r + ': ' + b + ' → ' + totals[r] + ' (' + delta + ')')
    else console.log('  = ' + r + ': ' + totals[r])
  }
  if (regress) {
    console.log('\n有回归类别（新违规）。查看明细：node scripts/audit-keyboard.mjs（含样例行号请用 --verbose 展开，见脚本）。')
    if (STRICT) process.exit(1)
  } else {
    console.log('\n无回归。')
  }
} else {
  console.log('\n无基线文件——先运行 node scripts/audit-keyboard.mjs --write-baseline')
}

function printSummary(t, n) {
  const label = {
    nonsemanticClickables: '非语义可点击元素(div/span/li/p onClick 无键盘等价)',
    iconButtonsNoLabel: '纯图标按钮缺 aria-label',
    rawKeydown: '裸 addEventListener(keydown) 监听',
    overlayNoDialog: 'fixed inset-0 遮罩缺 dialog 语义',
    tabIndexUses: 'tabIndex 使用处',
    ctxMenuNonInteractive: '非交互元素上的右键菜单',
    outlineNoneNoFocus: 'focus:outline-none 且无替代焦点样式',
  }
  console.log('文件数: ' + n)
  for (const r of RULES) console.log('  ' + r.padEnd(22) + ' ' + String(t[r]).padStart(5) + '  ' + (label[r] || ''))
}

#!/usr/bin/env electron
/**
 * 回归测试 —— 角色「特殊料理」 ↔ 食物板块 的双向跳转。
 *
 * 数据里没有外键，靠 foods.special_char / foods.name_zh 与 characters 对齐
 * （规则见 src/utils/dishLinks.js），这里从用户视角验收：
 *   S1 角色详情页 → 点「食物板块」入口 → 落到对应食物详情页
 *   S2 食物详情页 → 点特殊料理角色 → 回到角色详情页
 *   S3 跳过去之后按「上一步」→ 回到角色页并恢复原来的滚动位置
 *   S4 料理类型不是 special 的角色（早柚）也能靠名字对上
 *   S5 没有 special_char 的食物不出现跳转入口（退化成纯文本）
 *   S6 特殊料理页 → 「料理关系 / 料理原型」→ 落到原型菜；原型页反向列出衍生特殊料理
 *   S7 角色详情页 → 「料理原型」入口 → 落到原型菜（不是落在特殊料理自己）
 *   S8 special_char 缺失的条目（早柚）也能靠 characters.dish_name 双向对回
 *   S9 原型关联缺数据时（凝光）如实不显示入口，不做假跳转
 *   S10 料理板块搜索角色名 → 同时搜出 TA 的特殊料理与料理原型（并标注角标）
 *
 * Run: npm run test:dish-links:e2e
 */
const { app } = require('electron')
const fs = require('fs')
const os = require('os')
const path = require('path')
// 磁盘安全：见 scripts/lib/sandbox.cjs 顶部的事故说明
const { installCleanupHook, sweepLeftovers } = require('./lib/sandbox.cjs')
sweepLeftovers(['silvermoon-dish-'])   // 异常信号（SIGTRAP/SIGKILL）会绕过退出钩子，只能靠下次启动自愈

if (process.env.SILVERMOON_TEST_NO_SANDBOX === '1') {
  app.commandLine.appendSwitch('no-sandbox')
  app.commandLine.appendSwitch('disable-gpu')
  app.disableHardwareAcceleration()
}

const PROJECT_ROOT = path.resolve(__dirname, '..')
const REAL_DATA = '/Users/stargomia/Files/GenshinWikiData'
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'silvermoon-dish-'))
const profileDir = path.join(tmpRoot, 'profile')
const dataDir = path.join(tmpRoot, 'data')
fs.mkdirSync(profileDir, { recursive: true })
fs.mkdirSync(dataDir, { recursive: true })
for (const f of ['silvermoon_terminal.db', 'user.db', 'user.json']) {
  const src = path.join(REAL_DATA, f)
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dataDir, f))
}
fs.writeFileSync(path.join(profileDir, 'config.json'),
  JSON.stringify({ dbDir: dataDir, activeBaseDb: 'silvermoon_terminal.db' }, null, 2))
app.setPath('userData', profileDir)
process.env.SILVERMOON_DISABLE_DEVTOOLS = '1'
Object.defineProperty(app, 'isPackaged', { value: true, configurable: true })

let finished = false
function cleanup() { try { fs.rmSync(tmpRoot, { recursive: true, force: true }) } catch (_) {} }
installCleanupHook(cleanup)   // ⚠️ app.exit() 不触发 'exit'，清理必须靠劫持（见 lib/sandbox.cjs）
function finish(payload, code) {
  if (finished) return
  finished = true
  try { fs.writeSync(1, `\n===DISH-LINKS===\n${JSON.stringify(payload, null, 2)}\n`) } catch (_) {}
  process.exitCode = code
  setTimeout(() => { try { app.exit(code) } catch (_) { process.exit(code) } }, 200)
}

const wait = ms => new Promise(r => setTimeout(r, ms))
const exec = (win, code) => win.webContents.executeJavaScript(code, true)
async function waitFor(win, expr, label, timeoutMs = 40000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try { if (await exec(win, expr)) return true } catch (_) {}
    await wait(80)
  }
  throw new Error(`timeout waiting for ${label}`)
}

const PROBE = `(() => {
  const main = document.querySelector('main')
  if (!main) return null
  return {
    hash: location.hash,
    scrollTop: Math.round(main.scrollTop),
    maxScroll: Math.max(0, main.scrollHeight - main.clientHeight),
    text: (main.innerText || '').replace(/\\s+/g, ' ').slice(0, 200),
  }
})()`

/** 角色页的「食物板块」入口 */
const FIND_DISH_LINK = `(() => {
  const b = [...document.querySelectorAll('main button')].find(el => (el.title || '').startsWith('在食物板块查看'))
  return b ? { title: b.title, text: (b.innerText || '').replace(/\\s+/g, ' ').trim() } : null
})()`
/** 食物页的「特殊料理角色」入口（头部 chip 与详细信息里的徽章共用 title 前缀） */
const FIND_CHAR_LINK = `(() => {
  const b = [...document.querySelectorAll('main button')].find(el => (el.title || '').startsWith('查看角色'))
  return b ? { title: b.title, text: (b.innerText || '').replace(/\\s+/g, ' ').trim() } : null
})()`

/** 「料理原型」入口（食物页头部 chip / 料理关系卡片 / 角色页特殊料理模块共用 title 前缀） */
const FIND_PROTOTYPE_LINK = `(() => {
  const els = [...document.querySelectorAll('main button')].filter(el => (el.title || '').startsWith('料理原型'))
  return els.length === 0 ? null : { title: els[0].title, count: els.length }
})()`

/** 「料理关系」里的衍生特殊料理卡片 */
const FIND_DERIVATIVE_LINK = `(() => {
  const b = [...document.querySelectorAll('main button')].find(el => (el.title || '').startsWith('查看「'))
  return b ? { title: b.title } : null
})()`

/** 往列表页搜索框里打字（React 受控 input：走原生 setter + input 事件） */
const SET_SEARCH = (value) => `(() => {
  const input = [...document.querySelectorAll('main input')].find(el => (el.placeholder || '').startsWith('搜索'))
  if (!input) return null
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(input, ${JSON.stringify(value)})
  input.dispatchEvent(new Event('input', { bubbles: true }))
  return input.value
})()`

/** 画廊视图里的卡片文案（卡片带 data-item-id） */
const GALLERY_ITEMS = `[...document.querySelectorAll('main [data-item-id]')].map(el => (el.innerText || '').replace(/\\s+/g, ' ').trim())`

const clickByTitle = (prefix) => `(() => {
  const b = [...document.querySelectorAll('main button')].find(el => (el.title || '').startsWith(${JSON.stringify(prefix)}))
  if (!b) return null
  b.click()
  return b.title
})()`

/** 页面上是否出现了某段文字（innerText 可能是长页面，不能只截前 200 字） */
const hasText = (win, s) => exec(win, `(document.querySelector('main').innerText || '').includes(${JSON.stringify(s)})`)

async function openRoute(win, hash, label) {
  await exec(win, `location.hash = '#/changelog?x=${Math.random().toString(36).slice(2)}'`)
  await wait(350)
  await exec(win, `location.hash = ${JSON.stringify(hash)}`)
  await waitFor(win, `location.hash.startsWith(${JSON.stringify(hash)})`, label)
  await wait(2600)
}

async function run(win) {
  const results = []
  const add = (name, problems, extra) => results.push({ name, problems, pass: problems.length === 0, ...extra })

  // ── S1 角色 → 食物 ──
  {
    const problems = []
    let clicked = null
    let landed = null
    await openRoute(win, '#/characters/10000003', '角色 琴')
    const link = await exec(win, FIND_DISH_LINK)
    if (!link) problems.push('角色页没有出现「食物板块」入口')
    else {
      if (!link.text.includes('提神醒脑披萨')) problems.push(`入口显示的不是琴的特殊料理：${link.text}`)
      clicked = await exec(win, clickByTitle('在食物板块查看'))
      await waitFor(win, `/#\\/foods\\/\\d+/.test(location.hash)`, '食物详情页')
      await wait(2500)
      const after = await exec(win, PROBE)
      landed = after.hash
      if (!await hasText(win, '提神醒脑披萨')) problems.push(`跳到的食物页内容不对：${after.text.slice(0, 80)}`)
      if (!await hasText(win, '特殊料理')) problems.push('食物页缺少特殊料理信息')
    }
    add('S1 角色详情 → 食物详情', problems, { clicked, landed })
  }

  // ── S2 食物 → 角色（在同一会话里继续，从食物页点回去） ──
  {
    const problems = []
    let landed = null
    const link = await exec(win, FIND_CHAR_LINK)
    if (!link) problems.push('食物页没有出现可点击的「特殊料理角色」')
    else {
      if (!link.title.includes('琴')) problems.push(`入口指向的角色不对：${link.title}`)
      await exec(win, clickByTitle('查看角色'))
      await waitFor(win, `location.hash.startsWith('#/characters/10000003')`, '角色详情页')
      await wait(2500)
      landed = (await exec(win, PROBE)).hash
      if (!await hasText(win, '提神醒脑披萨')) problems.push('回到的角色页没有显示「提神醒脑披萨」')
    }
    add('S2 食物详情 → 角色详情', problems, { landed })
  }

  // ── S3 跳过去后「上一步」回角色页并恢复滚动位置 ──
  {
    const problems = []
    await openRoute(win, '#/characters/10000003', '角色 琴')
    // 滚到特殊料理区块，让位置可验证
    for (let i = 0; i < 6; i++) {
      await exec(win, `(() => { const m = document.querySelector('main'); m.scrollTop = m.scrollHeight })()`)
      await wait(200)
    }
    await wait(600)
    const before = await exec(win, PROBE)
    if (before.scrollTop < 100) problems.push(`角色页没能滚下去（scrollTop=${before.scrollTop}），场景无效`)
    await exec(win, clickByTitle('在食物板块查看'))
    await waitFor(win, `/#\\/foods\\/\\d+/.test(location.hash)`, '食物详情页')
    await wait(2200)
    const foodHash = (await exec(win, PROBE)).hash
    await exec(win, `document.querySelector('[title="上一步"]').click()`)
    await waitFor(win, `location.hash.startsWith('#/characters/10000003')`, '回到角色页')
    await wait(2600)
    const back = await exec(win, PROBE)
    if (Math.abs(back.scrollTop - before.scrollTop) > 12) {
      problems.push(`上一步回角色页没回到原位置：${before.scrollTop} → ${back.scrollTop}（可滚 ${back.maxScroll}）`)
    }
    add('S3 上一步回角色页并恢复位置', problems, { from: before.scrollTop, to: back.scrollTop, foodHash })
  }

  // ── S4 料理类型不是 special 的角色（早柚）也能跳 ──
  {
    const problems = []
    await openRoute(win, '#/characters/10000053', '角色 早柚')
    const link = await exec(win, FIND_DISH_LINK)
    if (!link) problems.push('早柚的角色页没有出现「食物板块」入口（按料理名兜底的规则失效）')
    else {
      if (!link.text.includes('头晕回避术')) problems.push(`入口显示的料理不对（应是她自己的特殊料理，而不是饭团等基础菜）：${link.text}`)
      await exec(win, clickByTitle('在食物板块查看'))
      await waitFor(win, `/#\\/foods\\/\\d+/.test(location.hash)`, '食物详情页')
      await wait(2500)
      if (!await hasText(win, '头晕回避术')) problems.push('跳到的食物页不是「头晕回避术・改」')
      const hash = (await exec(win, PROBE)).hash
      if (hash === '#/foods/108256') problems.push('跳到了基础菜「饭团」（special_char 优先级压过了料理名）')
    }
    add('S4 名字兜底（早柚）', problems)
  }

  // ── S5 没有 special_char 的食物不出现入口 ──
  {
    const problems = []
    await openRoute(win, '#/foods/108020', '食物 萝卜时蔬汤')
    const link = await exec(win, FIND_CHAR_LINK)
    if (link) problems.push(`没有对应角色的食物也出现了跳转入口：${link.title}`)
    const badge = await exec(win, `(() => {
      const el = [...document.querySelectorAll('main div')].find(d => (d.innerText || '').startsWith('特殊料理角色'))
      return el ? (el.innerText || '').replace(/\\s+/g, ' ').trim() : null
    })()`)
    if (badge && !badge.includes('-')) problems.push(`无关联时「特殊料理角色」应显示 -，实际：${badge}`)
    add('S5 无关联时降级为纯文本', problems, { badge })
  }

  // ── S6 特殊料理页 → 料理原型 → 反向的衍生特殊料理 ──
  {
    const problems = []
    let landed = null
    await openRoute(win, '#/foods/108044', '食物 提神醒脑披萨')
    if (!await hasText(win, '料理关系')) problems.push('特殊料理页没有「料理关系」区块')
    if (!await hasText(win, '料理原型')) problems.push('特殊料理页没有「料理原型」')
    if (!await hasText(win, '烤蘑菇披萨')) problems.push('「料理原型」没指向琴的基础菜「烤蘑菇披萨」')
    const link = await exec(win, FIND_PROTOTYPE_LINK)
    if (!link) problems.push('没有可点击的「料理原型」入口')
    else {
      if (!link.title.includes('烤蘑菇披萨')) problems.push(`入口指向的料理不对：${link.title}`)
      await exec(win, clickByTitle('料理原型'))
      await waitFor(win, `location.hash.startsWith('#/foods/108042')`, '原型菜详情页')
      await wait(2500)
      landed = (await exec(win, PROBE)).hash
      if (!await hasText(win, '衍生特殊料理')) problems.push('原型菜页面没有「衍生特殊料理」区块')
      if (!await hasText(win, '提神醒脑披萨')) problems.push('原型菜页面没列出琴的特殊料理')
      const back = await exec(win, FIND_DERIVATIVE_LINK)
      if (!back) problems.push('原型菜页面没有可点击的衍生特殊料理卡片')
      else {
        await exec(win, `[...document.querySelectorAll('main button')].find(el => (el.title || '').startsWith('查看「')).click()`)
        await waitFor(win, `location.hash.startsWith('#/foods/108044')`, '回到特殊料理页')
        await wait(2000)
      }
    }
    add('S6 特殊料理 ↔ 料理原型（食物页）', problems, { landed })
  }

  // ── S7 角色页 → 料理原型入口 ──
  {
    const problems = []
    let landed = null
    await openRoute(win, '#/characters/10000003', '角色 琴')
    const link = await exec(win, FIND_PROTOTYPE_LINK)
    if (!link) problems.push('角色页没有出现「料理原型」入口')
    else {
      if (!link.title.includes('烤蘑菇披萨')) problems.push(`入口指向的料理不对：${link.title}`)
      await exec(win, clickByTitle('料理原型'))
      await waitFor(win, `/#\\/foods\\/\\d+/.test(location.hash)`, '原型菜详情页')
      await wait(2500)
      landed = (await exec(win, PROBE)).hash
      if (landed !== '#/foods/108042') problems.push(`应落到原型菜 108042，实际 ${landed}`)
      if (!await hasText(win, '烤蘑菇披萨')) problems.push('落到的页面不是「烤蘑菇披萨」')
    }
    add('S7 角色页 → 料理原型', problems, { landed })
  }

  // ── S8 special_char 缺失的条目（早柚）双向兜底 ──
  {
    const problems = []
    await openRoute(win, '#/foods/108303', '食物 头晕回避术・改')
    const link = await exec(win, FIND_PROTOTYPE_LINK)
    if (!link) problems.push('special_char 为空的特殊料理页没给出「料理原型」')
    else {
      if (!link.title.includes('饭团')) problems.push(`原型应回退到「饭团」，实际：${link.title}`)
      await exec(win, clickByTitle('料理原型'))
      await waitFor(win, `location.hash.startsWith('#/foods/108256')`, '饭团详情页')
      await wait(2500)
      if (!await hasText(win, '衍生特殊料理')) problems.push('基础菜「饭团」页面没有「衍生特殊料理」区块')
      if (!await hasText(win, '头晕回避术')) problems.push('「饭团」页面没列早柚的特殊料理')
    }
    add('S8 缺失标记时的双向兜底（早柚）', problems)
  }

  // ── S9 原型关联缺数据时如实降级（凝光） ──
  {
    const problems = []
    await openRoute(win, '#/characters/10000027', '角色 凝光')
    if (!await exec(win, FIND_DISH_LINK)) problems.push('凝光角色页应仍有「食物板块」入口')
    if (await exec(win, FIND_PROTOTYPE_LINK)) problems.push('基础菜未标 special_char 时不该出现「料理原型」入口')
    await openRoute(win, '#/foods/108139', '食物 乾坤摩拉肉')
    if (await exec(win, FIND_PROTOTYPE_LINK)) problems.push('缺原型数据的特殊料理页不该出现原型入口')
    if (await hasText(win, '料理关系')) problems.push('没有关联时不该渲染「料理关系」区块')
    add('S9 关联缺数据时降级', problems)
  }

  // ── S10 料理板块搜索角色名 → 特殊料理 + 它的原型 ──
  {
    const problems = []
    let hits = null
    await openRoute(win, '#/foods', '食物列表')
    // 视图可能被页面记忆改过，先确保在画廊视图（卡片带 data-item-id）
    await exec(win, `(() => {
      const b = [...document.querySelectorAll('main button')].find(el => el.title === '画廊视图')
      if (b) b.click()
      return !!b
    })()`)
    await wait(700)

    const typed = await exec(win, SET_SEARCH('琴'))
    if (typed !== '琴') problems.push(`搜索框没接住输入：${JSON.stringify(typed)}`)
    await wait(900)
    const items = await exec(win, GALLERY_ITEMS)
    hits = items.length
    const joined = items.join(' | ')
    if (!joined.includes('提神醒脑披萨')) problems.push('搜「琴」没有搜出她的特殊料理「提神醒脑披萨」')
    if (!joined.includes('烤蘑菇披萨')) problems.push('搜「琴」没有搜出料理原型「烤蘑菇披萨」')
    if (hits !== 2) problems.push(`搜「琴」应只命中 2 条，实际 ${hits}：${joined.slice(0, 120)}`)
    if (!joined.includes('琴·特殊料理')) problems.push('结果里没标出「琴·特殊料理」角标')
    if (!joined.includes('琴·原型')) problems.push('结果里没标出「琴·原型」角标')

    // 搜不到关联数据的角色（凝光：基础菜未标 special_char）如实只给特殊料理
    await exec(win, SET_SEARCH('凝光'))
    await wait(800)
    const ning = await exec(win, GALLERY_ITEMS)
    if (ning.length !== 1 || !ning.join(' ').includes('乾坤摩拉肉')) {
      problems.push(`搜「凝光」应只命中她的特殊料理，实际：${JSON.stringify(ning)}`)
    }

    // 清空搜索后恢复全量列表
    await exec(win, SET_SEARCH(''))
    await wait(900)
    const all = await exec(win, `document.querySelectorAll('main [data-item-id]').length`)
    if (!(all > 100)) problems.push(`清空搜索后没有恢复全量列表（${all} 条）`)
    add('S10 搜索角色名 → 特殊料理 + 原型', problems, { hits })
  }

  if (rendererErrors.length > 0) add('渲染错误', rendererErrors.slice(0, 5))
  return { results, failed: results.filter(r => !r.pass).length }
}

const rendererErrors = []
let started = false
app.on('browser-window-created', (_e, win) => {
  if (started) return
  win.webContents.on('console-message', (_ev, level, message) => {
    if (level >= 3) { rendererErrors.push(message); console.log(`[renderer:${level}] ${message}`) }
  })
  win.webContents.once('did-finish-load', async () => {
    if (started) return
    started = true
    try { finish({ ok: true, ...(await run(win)) }, 0) } catch (e) { finish({ ok: false, error: e.message }, 1) }
  })
})
setTimeout(() => finish({ ok: false, error: 'watchdog 240s' }, 1), 240000)

require(path.join(PROJECT_ROOT, 'electron', 'main.js'))

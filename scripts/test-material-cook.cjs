#!/usr/bin/env electron
/**
 * 回归测试 —— 材料详情页「用于烹饪」区块的显隐。
 *
 * 规则：任意材料条目，如果「用于烹饪」没有任何内容，整个区块**不显示**；
 *       有内容时才出现（内容来自 food_materials 反向关联，可从食物侧添加）。
 *
 * 容易踩的坑（本用例真正守住的东西）：usedByFoods 是异步查出来的，
 * 若在数据到位前就按"空"渲染，有配方的材料也会被藏掉。页面在 loading
 * 结束前只画 loading，所以第一帧拿到的就是最终数据。
 *
 * Run: npm run test:material-cook
 */
const { app } = require('electron')
const fs = require('fs')
const os = require('os')
const path = require('path')
// 磁盘安全：见 scripts/lib/sandbox.cjs 顶部的事故说明
const { installCleanupHook, sweepLeftovers } = require('./lib/sandbox.cjs')
sweepLeftovers(['silvermoon-cook-'])   // 异常信号（SIGTRAP/SIGKILL）会绕过退出钩子，只能靠下次启动自愈

if (process.env.SILVERMOON_TEST_NO_SANDBOX === '1') {
  app.commandLine.appendSwitch('no-sandbox')
  app.commandLine.appendSwitch('disable-gpu')
  app.disableHardwareAcceleration()
}

const PROJECT_ROOT = path.resolve(__dirname, '..')
const REAL_DATA = '/Users/stargomia/Files/GenshinWikiData'
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'silvermoon-cook-'))
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
  try { fs.writeSync(1, `\n===MATERIAL-COOK===\n${JSON.stringify(payload, null, 2)}\n`) } catch (_) {}
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

/** 「用于烹饪」区块是否存在 + 里面的内容概况 */
const COOK_SECTION = `(() => {
  const btn = [...document.querySelectorAll('main button')].find(b => (b.innerText || '').includes('用于烹饪'))
  if (!btn) return { exists: false }
  const card = btn.closest('div[class*="rounded-xl"]')
  const title = [...document.querySelectorAll('main h2')].find(h => (h.innerText || '').trim() === '用于烹饪')
  const text = (card.innerText || '').replace(/\\s+/g, ' ').trim()
  const countMatch = text.match(/(\\d+) 道料理/)
  return {
    exists: true,
    titleVisible: !!title && title.offsetParent !== null,
    count: countMatch ? Number(countMatch[1]) : null,
    cards: card.querySelectorAll('[title]').length,
    hasAddButton: [...card.querySelectorAll('button')].some(b => (b.innerText || '').includes('添加')),
    text: text.slice(0, 80),
  }
})()`

async function openMaterial(win, id) {
  await exec(win, `location.hash = '#/changelog?x=${Math.random().toString(36).slice(2)}'`)
  await wait(350)
  await exec(win, `location.hash = '#/materials/${id}'`)
  await waitFor(win, `location.hash.startsWith('#/materials/${id}')`, `材料 ${id}`)
  await wait(2600)
  // 页面必须已经渲染出材料本体，避免在 loading 阶段取样
  await waitFor(win, `!!document.querySelector('main h1')`, `材料 ${id} 内容`)
  await wait(300)
}

async function run(win) {
  const results = []
  const add = (name, problems, extra) => results.push({ name, problems, pass: problems.length === 0, ...extra })

  // ── 没有烹饪用途的材料：区块整个不显示 ──
  {
    const problems = []
    await openMaterial(win, 201)   // 原石：valuable，无配方
    const state = await exec(win, COOK_SECTION)
    if (state.exists) problems.push(`没有烹饪用途却仍显示了「用于烹饪」区块：${state.text}`)
    // 其它区块不受影响
    const others = await exec(win, `[...document.querySelectorAll('main h2')].map(h => h.innerText.trim())`)
    for (const need of ['说明', '详细信息']) {
      if (!others.includes(need)) problems.push(`顺带把「${need}」也弄没了：${JSON.stringify(others)}`)
    }
    add('S1 无烹饪用途 → 不显示区块', problems, { state, sections: others })
  }

  // ── 有烹饪用途的材料：正常显示，计数与卡片都在 ──
  {
    const problems = []
    await openMaterial(win, 110001)   // 面粉：110 道料理
    const state = await exec(win, COOK_SECTION)
    if (!state.exists) problems.push('有烹饪用途却没有显示「用于烹饪」区块')
    else {
      if (!state.titleVisible) problems.push('区块标题不可见')
      if (!(state.count > 0)) problems.push(`料理计数不对：${state.text}`)
      if (state.cards === 0) problems.push('区块里没有料理卡片')
      if (!state.hasAddButton) problems.push('缺少「添加」按钮')
    }
    add('S2 有烹饪用途 → 正常显示', problems, { state })
  }

  // ── 两个条目来回切：显隐跟着数据走，不会串 ──
  {
    const problems = []
    await openMaterial(win, 202)      // 摩拉：无
    const a = await exec(win, COOK_SECTION)
    await openMaterial(win, 100061)   // 兽肉：有
    const b = await exec(win, COOK_SECTION)
    await openMaterial(win, 203)      // 创世结晶：无
    const c = await exec(win, COOK_SECTION)
    if (a.exists) problems.push('摩拉（无配方）显示了区块')
    if (!b.exists) problems.push('兽肉（有配方）没有显示区块')
    if (c.exists) problems.push('创世结晶（无配方）显示了区块')
    add('S3 来回切换不串状态', problems, { mora: a.exists, meat: b.exists, crystal: c.exists })
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
setTimeout(() => finish({ ok: false, error: 'watchdog 180s' }, 1), 180000)

require(path.join(PROJECT_ROOT, 'electron', 'main.js'))

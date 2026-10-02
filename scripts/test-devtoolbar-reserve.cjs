#!/usr/bin/env electron
/**
 * 回归测试 —— 开发者工具栏不能盖住滚动内容末尾
 *
 * 背景：DevToolbar 是 `fixed bottom-0 h-10`（40px）的浮层，不参与布局。原来只在
 * <main> 上加 `pb-10` 留位，但页面容器是 `h-full`（高度固定），内容溢出时滚动容器
 * 的 padding **不计入滚动区**：滚到底时最后一行照样贴着窗口底边，被工具栏压住 16px。
 * 现在由 useDevToolbarReserve 测量后给内容流末尾补 64px（工具栏 40 + 呼吸 24）。
 *
 * 这里守两件事：
 *   1. 会滚动的板块（角色/武器/圣遗物/材料）滚到底时，内容末尾与最后一行都在工具栏上方
 *   2. 满高页面（终端/数据/网站/设置）本身不滚动，不能因为预留凭空多出滚动条
 * 另外验证关掉开发者模式后预留被完全撤掉（页面重新铺满整个视口）。
 *
 * Run: npm run test:devbar
 *      （无 GUI 沙箱权限的环境：SILVERMOON_ELECTRON_NOSANDBOX=1 npm run test:devbar）
 */
const { app } = require('electron')
const { spawn } = require('child_process')
const fs = require('fs')
const http = require('http')
const net = require('net')
const os = require('os')
const path = require('path')
// 磁盘安全：见 scripts/lib/sandbox.cjs 顶部的事故说明
const { installCleanupHook, sweepLeftovers } = require('./lib/sandbox.cjs')
sweepLeftovers(['silvermoon-devbar-'])   // 异常信号（SIGTRAP/SIGKILL）会绕过退出钩子，只能靠下次启动自愈

if (process.env.SILVERMOON_ELECTRON_NOSANDBOX === '1') {
  app.commandLine.appendSwitch('no-sandbox')
  app.commandLine.appendSwitch('disable-gpu')
  app.disableHardwareAcceleration()
}

const PROJECT_ROOT = path.resolve(__dirname, '..')
const REAL_DATA = process.env.SILVERMOON_DATA_DIR || '/Users/stargomia/Files/GenshinWikiData'
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'silvermoon-devbar-'))
const profileDir = path.join(tmpRoot, 'profile')
const dataDir = path.join(tmpRoot, 'data')
fs.mkdirSync(profileDir, { recursive: true })
fs.mkdirSync(dataDir, { recursive: true })
for (const f of ['silvermoon_terminal.db', 'user.db', 'user.json']) {
  const src = path.join(REAL_DATA, f)
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dataDir, f))
}
const userJsonPath = path.join(dataDir, 'user.json')
function writeUserConfig(patch) {
  let cfg = {}
  try { cfg = JSON.parse(fs.readFileSync(userJsonPath, 'utf-8')) } catch (_) {}
  fs.writeFileSync(userJsonPath, JSON.stringify({ ...cfg, ...patch }, null, 2))
}
writeUserConfig({ devMode: true })   // 测试在开发者模式下进行
fs.writeFileSync(path.join(profileDir, 'config.json'),
  JSON.stringify({ dbDir: dataDir, activeBaseDb: 'silvermoon_terminal.db' }, null, 2))
app.setPath('userData', profileDir)
process.env.SILVERMOON_DISABLE_DEVTOOLS = '1'

let viteProcess = null
let finished = false
function cleanup() {
  if (viteProcess && !viteProcess.killed) { try { viteProcess.kill('SIGTERM') } catch (_) {} }
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }) } catch (_) {}
}
installCleanupHook(cleanup)   // ⚠️ app.exit() 不触发 'exit'，清理必须靠劫持（见 lib/sandbox.cjs）
function report(payload, code) {
  if (finished) return
  finished = true
  const lines = []
  for (const r of payload.results || []) {
    lines.push(`${r.problems.length === 0 ? '  ✓' : '  ✗'} ${r.name}`)
    for (const p of r.problems) lines.push(`      · ${p}`)
  }
  const failed = (payload.results || []).filter(r => r.problems.length > 0).length
  const text = [
    '', '===DEV-BAR-RESERVE===',
    payload.error ? `启动失败: ${payload.error}` : (failed === 0 ? '全部通过' : `${failed} 项未通过`),
    ...lines,
    JSON.stringify(payload.results || [], null, 2),
    '',
  ].join('\n')
  try { fs.writeSync(1, text) } catch (_) {}
  process.exitCode = code
  if (viteProcess && !viteProcess.killed) { try { viteProcess.kill('SIGTERM') } catch (_) {} }
  setTimeout(() => { try { app.exit(code) } catch (_) { process.exit(code) } }, 200)
}

const wait = ms => new Promise(r => setTimeout(r, ms))
const exec = (win, code) => win.webContents.executeJavaScript(code, true)
async function waitFor(win, expr, label, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try { if (await exec(win, expr)) return } catch (_) {}
    await wait(100)
  }
  throw new Error(`timeout waiting for ${label}`)
}
function getFreePort() {
  return new Promise((res, rej) => {
    const s = net.createServer()
    s.once('error', rej)
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(e => e ? rej(e) : res(p)) })
  })
}
function waitForHttp(url, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs
  return new Promise((res, rej) => {
    const attempt = () => {
      const req = http.get(url, r => {
        r.resume()
        if (r.statusCode && r.statusCode < 500) res()
        else if (Date.now() >= deadline) rej(new Error(`vite ${r.statusCode}`))
        else setTimeout(attempt, 200)
      })
      req.once('error', e => Date.now() >= deadline ? rej(e) : setTimeout(attempt, 200))
      req.setTimeout(2000, () => req.destroy(new Error('http timeout')))
    }
    attempt()
  })
}

/** 读取几何关系（bar = 底部开发者工具栏）；scroll=true 时先滚到底 */
const probeCode = (scroll = true) => `(() => {
  const main = document.querySelector('main')
  if (!main) return { error: 'no main' }
  ${scroll ? 'main.scrollTop = main.scrollHeight' : ''}
  const mr = main.getBoundingClientRect()
  const host = main.querySelector('[data-page-host]')
  const page = host ? host.firstElementChild : null
  const bar = [...document.querySelectorAll('div.fixed')].find(el => typeof el.className === 'string' && el.className.includes('z-[60]'))
  const items = [...document.querySelectorAll('[data-item-id]')]
    .map(el => el.getBoundingClientRect())
    .filter(r => r.bottom > mr.top && r.top < mr.bottom)     // 视口内的条目
  return {
    hasBar: !!bar,
    mainBottom: Math.round(mr.bottom),
    barTop: bar ? Math.round(bar.getBoundingClientRect().top) : null,
    pageBottom: page ? Math.round(page.getBoundingClientRect().bottom) : null,
    // 视口内最低的一条内容底边
    lowestItemBottom: items.length ? Math.round(Math.max(...items.map(r => r.bottom))) : null,
    maxScroll: Math.round(main.scrollHeight - main.clientHeight),
    scrollTop: Math.round(main.scrollTop),
    reserveVar: main.style.getPropertyValue('--devbar-reserve-h') || '(unset)',
    spacerH: host ? getComputedStyle(host, '::after').height : null,
    hasReserveClass: main.classList.contains('dev-reserve-bottom'),
    hasDevPad: main.classList.contains('pb-10'),
  }
})()`
const PROBE = probeCode(true)

async function scrollToBottom(win, times = 8) {
  for (let i = 0; i < times; i++) {
    await exec(win, `(() => { const m = document.querySelector('main'); if (m) m.scrollTop = m.scrollHeight })()`)
    await wait(220)
  }
  await wait(600)
}

async function openRoute(win, hash, { needItems = false } = {}) {
  await exec(win, `location.hash = ${JSON.stringify(hash)}`)
  await waitFor(win, `location.hash.startsWith(${JSON.stringify(hash)})`, hash)
  if (needItems) {
    await waitFor(win, `document.querySelectorAll('[data-item-id]').length > 0`, `${hash} 列表`, 60000)
  }
  await wait(2500)
}

// ── 场景一：滚动板块（角色/武器/圣遗物/材料）───────────────────────
const SCROLL_ROUTES = [
  ['#/characters', '角色'],
  ['#/weapons', '武器'],
  ['#/artifacts', '圣遗物'],
  ['#/materials', '材料'],
]

async function scenarioScrollRoutes(win) {
  const name = '滚动板块：滚到底时内容末尾停在工具栏上方'
  const problems = []
  const detail = []
  for (const [hash, label] of SCROLL_ROUTES) {
    await openRoute(win, hash, { needItems: true })
    await scrollToBottom(win)
    const r = await exec(win, PROBE)
    detail.push({ label, ...r })
    if (!r.hasBar) { problems.push(`${label}：开发者工具栏没有渲染`); continue }
    if (r.spacerH !== r.reserveVar) problems.push(`${label}：预留高度未生效（变量=${r.reserveVar}，实际=${r.spacerH}）`)
    if (r.pageBottom == null) problems.push(`${label}：读不到页面容器`)
    else if (r.barTop - r.pageBottom < 8) {
      problems.push(`${label}：页面末尾没有让开工具栏（末尾 ${r.pageBottom}，工具栏顶 ${r.barTop}）`)
    }
    if (r.lowestItemBottom != null && r.lowestItemBottom > r.barTop) {
      problems.push(`${label}：最后一行被工具栏压住 ${r.lowestItemBottom - r.barTop}px`)
    }
  }
  return { name, problems, detail }
}

// ── 场景二：详情页（同样是会滚动的页面）───────────────────────────
const DETAIL_ROUTES = [
  ['#/characters', '#/characters/', '角色详情'],
  ['#/weapons', '#/weapons/', '武器详情'],
  ['#/artifacts', '#/artifacts/', '圣遗物详情'],
  ['#/materials', '#/materials/', '材料详情'],
]

async function scenarioDetailRoutes(win) {
  const name = '详情页：滚到底时内容末尾停在工具栏上方'
  const problems = []
  const detail = []
  for (const [listHash, detailPrefix, label] of DETAIL_ROUTES) {
    await openRoute(win, listHash, { needItems: true })
    const id = await exec(win, `(() => {
      const el = document.querySelector('[data-item-id]')
      return el ? el.getAttribute('data-item-id') : null
    })()`)
    if (!id) { problems.push(`${label}：列表里取不到条目 id`); continue }
    await openRoute(win, `${detailPrefix}${id}`)
    await waitFor(win, `document.body.innerText.length > 50`, label, 30000)
    await scrollToBottom(win)
    const r = await exec(win, PROBE)
    detail.push({ label, id, ...r })
    if (!r.hasBar) { problems.push(`${label}：开发者工具栏没有渲染`); continue }
    if (r.pageBottom == null) problems.push(`${label}：读不到页面容器`)
    else if (r.barTop - r.pageBottom < 8) {
      problems.push(`${label}：页面末尾没有让开工具栏（末尾 ${r.pageBottom}，工具栏顶 ${r.barTop}）`)
    }
    if (r.lowestItemBottom != null && r.lowestItemBottom > r.barTop) {
      problems.push(`${label}：最后一行被工具栏压住 ${r.lowestItemBottom - r.barTop}px`)
    }
  }
  return { name, problems, detail }
}

// ── 场景三：满高页面（终端/数据/网站/设置）不该多出滚动条 ──────────
const FULL_ROUTES = [
  ['#/terminal', '终端'],
  ['#/data', '数据'],
  ['#/websites', '站点'],
  ['#/settings', '设置'],
]

async function scenarioFullHeightRoutes(win) {
  const name = '满高页面：不因预留多出滚动条'
  const problems = []
  const detail = []
  for (const [hash, label] of FULL_ROUTES) {
    await openRoute(win, hash)
    await wait(1200)
    const r = await exec(win, PROBE)
    detail.push({ label, ...r })
    if (r.maxScroll > 1) problems.push(`${label}：凭空多出 ${r.maxScroll}px 滚动空间（预留 ${r.reserveVar}，占位 ${r.spacerH}）`)
    if (r.reserveVar !== '(unset)') problems.push(`${label}：不该设置预留（${r.reserveVar}）`)
  }
  return { name, problems, detail }
}

// ── 场景五：从详情页返回后，预留仍在且仍贴着底部 ──────────────────
// （预留会改变 maxScroll：如果它晚于滚动恢复才补上，用户就会停在离底部 64px 的位置）
async function scenarioBackFromDetail(win) {
  const name = '详情页返回：预留仍在，滚动位置仍贴着底部'
  const problems = []
  const detail = {}
  await openRoute(win, '#/characters', { needItems: true })
  await scrollToBottom(win)
  const CLICK_LAST_VISIBLE = `(() => {
    const main = document.querySelector('main')
    const mr = main.getBoundingClientRect()
    const vis = [...document.querySelectorAll('[data-item-id]')].filter(el => {
      const r = el.getBoundingClientRect()
      return r.bottom > mr.top + 4 && r.top < mr.bottom - 4
    })
    const t = vis[vis.length - 1] || document.querySelector('[data-item-id]')
    if (!t) return null
    t.click()
    return t.getAttribute('data-item-id')
  })()`
  let opened = null
  let nav = { hash: '' }
  // 列表是懒渲染的，卡片偶尔还没挂上点击处理器：重试几次再判定失败
  for (let attempt = 0; attempt < 3; attempt++) {
    opened = await exec(win, CLICK_LAST_VISIBLE)
    if (!opened) break
    await wait(1500)
    nav = await exec(win, `({ hash: location.hash, count: document.querySelectorAll('[data-item-id]').length })`)
    if (/\/characters\/\d+/.test(nav.hash)) break
  }
  if (!opened) { problems.push('没有可点击的条目'); return { name, problems, detail } }
  detail.clicked = { opened, ...nav }
  if (!/\/characters\/\d+/.test(nav.hash)) {
    problems.push(`点击条目后没有进入详情页（hash=${nav.hash}）`)
    return { name, problems, detail }
  }
  await wait(1500)
  await exec(win, `document.querySelector('[title="上一步"]').click()`)
  await waitFor(win, `location.hash.startsWith('#/characters')`, '返回角色列表')
  await wait(2500)
  const r = await exec(win, probeCode(false))     // 不强制滚到底，看恢复后的落点
  detail.afterBack = r
  if (r.reserveVar !== '64px') problems.push(`返回后预留没恢复（${r.reserveVar}，占位 ${r.spacerH}）`)
  if (r.maxScroll > 2 && r.scrollTop < r.maxScroll - 2) {
    problems.push(`返回后没有贴着底部（${r.scrollTop}/${r.maxScroll}）`)
  }
  if (r.barTop - r.pageBottom < 8) {
    problems.push(`返回后页面末尾没有让开工具栏（末尾 ${r.pageBottom}，工具栏顶 ${r.barTop}）`)
  }
  return { name, problems, detail }
}

// ── 场景四：关掉开发者模式后预留必须完全撤掉 ──────────────────────
/** 设置页的「开发者模式」开关在「高级」模块里，先切过去再点 */
const TOGGLE_DEV_MODE = `(() => {
  const nav = [...document.querySelectorAll('button')]
    .find(b => (b.innerText || '').includes('开发者模式、备份导入'))
  if (nav) nav.click()
  return !!nav
})()`

const CLICK_DEV_MODE = `(() => {
  const box = [...document.querySelectorAll('input[type=checkbox]')]
    .find(i => (i.closest('label')?.parentElement?.innerText || '').includes('开发者模式'))
  if (!box) return false
  box.click()
  return true
})()`

async function scenarioToggleOff(win) {
  const name = '关闭开发者模式：预留撤掉，页面重新铺满视口'
  const problems = []
  const detail = {}
  await openRoute(win, '#/settings')
  await wait(1500)
  await exec(win, TOGGLE_DEV_MODE)
  await wait(1200)
  const clicked = await exec(win, CLICK_DEV_MODE)
  if (!clicked) { problems.push('设置页找不到「开发者模式」开关'); return { name, problems, detail } }
  await wait(1200)
  const off = await exec(win, PROBE)
  detail.off = off
  if (off.hasReserveClass) problems.push('main 上仍留着 dev-reserve-bottom')
  if (off.reserveVar !== '(unset)') problems.push(`预留变量没清掉（${off.reserveVar}）`)
  if (off.hasDevPad) problems.push('main 上仍留着 pb-10')
  // 关掉之后列表页应该重新铺满整个视口（不再有预留空白）
  await openRoute(win, '#/characters', { needItems: true })
  await scrollToBottom(win)
  const back = await exec(win, PROBE)
  detail.afterOff = back
  if (back.hasBar) problems.push('关闭开发者模式后工具栏仍在')
  if (back.mainBottom - back.pageBottom > 1) {
    problems.push(`页面末尾仍有 ${back.mainBottom - back.pageBottom}px 空白（预留没撤掉）`)
  }
  // 再打开，预留要回来
  await openRoute(win, '#/settings')
  await wait(1500)
  await exec(win, TOGGLE_DEV_MODE)
  await wait(1200)
  await exec(win, CLICK_DEV_MODE)
  await wait(1200)
  await openRoute(win, '#/characters', { needItems: true })
  await scrollToBottom(win)
  const on = await exec(win, PROBE)
  detail.backOn = on
  if (!on.hasBar) problems.push('重新打开开发者模式后工具栏没出现')
  else if (on.barTop - on.pageBottom < 8) problems.push('重新打开开发者模式后预留没有恢复')
  return { name, problems, detail }
}


const rendererErrors = []

async function run(win) {
  const results = []
  const runOne = async (fn) => {
    try { results.push(await fn(win)) }
    catch (e) { results.push({ name: fn.name, problems: [e.message], detail: null }) }
  }
  await runOne(scenarioScrollRoutes)
  await runOne(scenarioDetailRoutes)
  await runOne(scenarioFullHeightRoutes)
  await runOne(scenarioBackFromDetail)
  await runOne(scenarioToggleOff)
  if (rendererErrors.length > 0) {
    results.push({ name: '无未捕获错误', problems: rendererErrors.slice(0, 5), detail: null })
  }
  return { results }
}

let started = false
app.on('browser-window-created', (_e, win) => {
  if (started) return
  win.webContents.on('console-message', (_ev, level, message) => {
    if (level >= 3) { rendererErrors.push(message); console.log(`[renderer:${level}] ${message}`) }
  })
  win.webContents.once('did-finish-load', async () => {
    if (started) return
    started = true
    try { report({ ok: true, ...(await run(win)) }, 0) } catch (e) { report({ ok: false, error: e.message, results: [] }, 1) }
  })
})
setTimeout(() => report({ ok: false, error: 'watchdog 300s', results: [] }, 1), 300000)

;(async () => {
  try {
    const port = await getFreePort()
    const viteUrl = `http://localhost:${port}`
    viteProcess = spawn('npx', ['vite', '--port', String(port), '--strictPort'], {
      cwd: PROJECT_ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    })
    viteProcess.stdout.on('data', () => {})
    viteProcess.stderr.on('data', d => { const s = String(d); if (/error|fail/i.test(s)) console.log('[vite]', s.trim()) })
    await waitForHttp(viteUrl)
    process.env.SILVERMOON_DEV_SERVER_URL = viteUrl
    require(path.join(PROJECT_ROOT, 'electron', 'main.js'))
  } catch (e) {
    report({ ok: false, error: `启动开发服务器失败: ${e.message}`, results: [] }, 1)
  }
})()

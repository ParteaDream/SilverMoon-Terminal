#!/usr/bin/env electron
/**
 * Animation performance harness.
 *
 * Scenario A — 材料板块 (526 materials, gallery of images) 侧栏展开/收缩
 * Scenario B — 祈愿捕捉站 → 角色活动祈愿详情 (4133 条) 最大化 / 取消最大化
 *
 * Measures per-animation frame pacing with a rAF sampler plus longtask entries,
 * after calibrating the display refresh rate from an idle window.
 *
 * Run: env -u ELECTRON_RUN_AS_NODE electron scripts/bench-anim-perf.cjs [--scenario=a|b]
 */
const { app } = require('electron')
const { spawn } = require('child_process')
const fs = require('fs')
const http = require('http')
const net = require('net')
const os = require('os')
const path = require('path')

const PROJECT_ROOT = path.resolve(__dirname, '..')
const REAL_DATA = '/Users/stargomia/Files/GenshinWikiData'
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'silvermoon-anim-perf-'))
const profileDir = path.join(tmpRoot, 'profile')
const dataDir = path.join(tmpRoot, 'data')
fs.mkdirSync(profileDir, { recursive: true })
fs.mkdirSync(dataDir, { recursive: true })
for (const f of ['silvermoon_terminal.db', 'user.db', 'user.json']) {
  const src = path.join(REAL_DATA, f)
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dataDir, f))
}
// 图包很大（264M / 1.6G），不能复制；但 main.js 的 buildImagePathCache 会
// 显式跳过软链接（entry.isSymbolicLink() -> continue），所以软链接无效。
// 硬链接是真实 inode，isFile()/isSymbolicLink() 检查都能通过。
function linkTree(src, dst) {
  fs.mkdirSync(dst, { recursive: true })
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s2 = path.join(src, e.name), d2 = path.join(dst, e.name)
    if (e.isDirectory()) linkTree(s2, d2)
    else if (e.isFile()) {
      try { fs.linkSync(s2, d2) } catch (_) { try { fs.copyFileSync(s2, d2) } catch (_) {} }
    }
  }
}
for (const entry of fs.readdirSync(REAL_DATA)) {
  if (!entry.startsWith('images-')) continue
  const src = path.join(REAL_DATA, entry)
  if (!fs.statSync(src).isDirectory()) continue
  linkTree(src, path.join(dataDir, entry))
}
fs.writeFileSync(path.join(profileDir, 'config.json'),
  JSON.stringify({ dbDir: dataDir, activeBaseDb: 'silvermoon_terminal.db' }, null, 2))
app.setPath('userData', profileDir)

const only = (process.argv.find(a => a.startsWith('--scenario=')) || '').slice('--scenario='.length)
const cssB64 = (process.argv.find(a => a.startsWith('--css-b64=')) || '').slice('--css-b64='.length)
const injectedCss = cssB64 ? Buffer.from(cssB64, 'base64').toString('utf8') : ''
const profileTarget = (process.argv.find(a => a.startsWith('--profile=')) || '').slice('--profile='.length)
// 默认测生产构建（用户实际运行的就是它）：isDev = !app.isPackaged，
// dev 模式下 React 的开发期校验（jsxWithValidation / validateProperty）会严重虚高 JS 耗时。
const useDev = process.argv.includes('--dev')

let viteProcess = null
let finished = false
let viteOutput = ''
function cleanup() {
  if (viteProcess && !viteProcess.killed) { try { viteProcess.kill('SIGTERM') } catch (_) {} }
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }) } catch (_) {}
}
process.once('exit', cleanup)
function finish(payload, code) {
  if (finished) return
  finished = true
  process.stdout.write(`\n===PERF===\n${JSON.stringify(payload, null, 2)}\n`)
  process.exitCode = code
  if (viteProcess && !viteProcess.killed) { try { viteProcess.kill('SIGTERM') } catch (_) {} }
  setTimeout(() => { try { app.exit(code) } catch (_) { process.exit(code) } }, 50)
}
const wait = ms => new Promise(r => setTimeout(r, ms))
const exec = (win, code) => win.webContents.executeJavaScript(code, true)
function getFreePort() {
  return new Promise((res, rej) => {
    const s = net.createServer()
    s.once('error', rej)
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(e => e ? rej(e) : res(p)) })
  })
}
function waitForHttp(url, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  return new Promise((res, rej) => {
    const attempt = () => {
      const req = http.get(url, r => {
        r.resume()
        if (r.statusCode && r.statusCode < 500) res()
        else if (Date.now() >= deadline) rej(new Error(`vite ${r.statusCode}`))
        else setTimeout(attempt, 100)
      })
      req.once('error', e => Date.now() >= deadline ? rej(e) : setTimeout(attempt, 100))
      req.setTimeout(1000, () => req.destroy(new Error('http timeout')))
    }
    attempt()
  })
}
async function waitFor(win, expr, label, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try { if (await exec(win, expr)) return } catch (_) {}
    await wait(60)
  }
  throw new Error(`timeout waiting for ${label}`)
}

// ── in-page frame sampler ────────────────────────────────────────────────────
const PROBE = `
window.__animPerf = (() => {
  let frames = [], on = false, last = 0, raf = 0
  let longTasks = []
  try {
    if (window.PerformanceObserver && PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
      new PerformanceObserver(list => { for (const e of list.getEntries()) longTasks.push({ start: e.startTime, dur: e.duration }) })
        .observe({ entryTypes: ['longtask'] })
    }
  } catch (_) {}
  const tick = now => { if (!on) return; if (last) frames.push(now - last); last = now; raf = requestAnimationFrame(tick) }
  return {
    start () { frames = []; longTasks = []; last = 0; on = true; raf = requestAnimationFrame(tick) },
    stop () { on = false; cancelAnimationFrame(raf); return { frames, longTasks } },
  }
})()
true`

const MATERIALS_SETUP = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  location.hash = '#/materials'
  for (let i = 0; i < 400 && !document.querySelector('[data-item-id]'); i++) await sleep(50)
  const cards = () => document.querySelectorAll('[data-item-id]').length
  if (!cards()) return { ok: false, why: 'materials grid did not render' }
  await sleep(2500)   // 让视口内图片解码完成
  const toggle = [...document.querySelectorAll('button')].find(b => (b.title || '').includes('侧栏'))
  if (!toggle) return { ok: false, why: 'sidebar toggle not found' }
  const imgs = document.querySelectorAll('img').length
  return { ok: true, cards: cards(), imgs, collapsed: !!localStorage.getItem('sidebar_collapsed') && localStorage.getItem('sidebar_collapsed') === '1',
           toggleTitle: toggle.title }
})()`

const GACHA_SETUP = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const roots = () => [...document.querySelectorAll('[data-window-root="true"]')]
  const winRoot = n => roots().find(r => (r.querySelector('[data-window-titlebar="true"]') || {}).textContent?.includes(n))
  const byText = (root, text) => [...root.querySelectorAll('div')]
    .filter(d => (d.textContent || '').includes(text))
    .sort((a, b) => a.textContent.length - b.textContent.length)[0]

  if (!location.hash.includes('/terminal')) location.hash = '#/terminal'
  for (let i = 0; i < 300 && !document.querySelector('[data-desktop-icon="gachastation"]'); i++) await sleep(50)
  const icon = document.querySelector('[data-desktop-icon="gachastation"]')
  if (!icon) return { ok: false, why: 'gachastation icon missing' }
  icon.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  let root = null
  for (let i = 0; i < 200 && !(root = winRoot('祈愿捕捉站')); i++) await sleep(50)
  if (!root) return { ok: false, why: 'gachastation window missing' }
  const acc = byText(root, 'UID 188296354')
  if (!acc) return { ok: false, why: 'archive 188296354 not listed' }
  acc.click()
  await sleep(1200)
  const typeBtn = [...root.querySelectorAll('button')].find(b => {
    const t = b.textContent || ''
    return t.includes('角色活动祈愿') && !t.includes('角色活动祈愿-2')
  })
  if (!typeBtn) return { ok: false, why: '301 type button missing' }
  typeBtn.click()
  await sleep(3000)   // 4133 条记录 + 图片解码
  // 展开逐条记录详情（每行一张图），这是用户报告里最卡的形态
  const detailBtn = [...root.querySelectorAll('button')].find(b => (b.textContent || '').includes('显示详情'))
  if (!detailBtn) return { ok: false, why: '显示详情 button missing' }
  detailBtn.click()
  await sleep(5000)
  const fsBtn = [...root.querySelectorAll('button')].find(b => b.title === '全屏')
  if (!fsBtn) return { ok: false, why: 'fullscreen button missing' }
  const imgs = root.querySelectorAll('img').length
  const rows = root.querySelectorAll('[data-window-root] div').length
  // 校验逐条记录列表的滚动几何：content-visibility + contain-intrinsic-size
  // 会让离屏行按估算高度参与滚动条计算，必须与实际行高一致才不会跳动
  const list = [...root.querySelectorAll('div')].find(d => (d.className || '').includes('space-y-0.5') && (d.className || '').includes('overflow-y-auto'))
  let scroll = null
  if (list) {
    const kids = [...list.children]
    const h = kids.length ? kids[0].getBoundingClientRect().height : 0
    scroll = { rowCount: kids.length, firstRowHeight: +h.toFixed(1),
               scrollHeight: list.scrollHeight, clientHeight: list.clientHeight,
               totalIfUniform: Math.round(h * kids.length) }
  }
  // 真实滚到底：content-visibility 的高度估算若失真，底部会出现空白
  let bottomGap = null
  if (list && list.children.length) {
    for (let i = 0; i < 3; i++) { list.scrollTop = list.scrollHeight; await sleep(400) }
    const lr = list.lastElementChild.getBoundingClientRect()
    const cr = list.getBoundingClientRect()
    const kids = [...list.children]
    const heights = [kids[0], kids[100], kids[1000], kids[kids.length - 1]]
      .filter(Boolean).map(k => +k.getBoundingClientRect().height.toFixed(1))
    const gaps = []
    for (let i = Math.max(1, kids.length - 6); i < kids.length; i++) {
      gaps.push(+(kids[i].getBoundingClientRect().top - kids[i - 1].getBoundingClientRect().bottom).toFixed(1))
    }
    bottomGap = { gapPx: +(cr.bottom - lr.bottom).toFixed(1), finalScrollTop: Math.round(list.scrollTop),
                  scrollHeight: list.scrollHeight, clientHeight: list.clientHeight,
                  sampledHeights: heights, lastRowOffsetTop: Math.round(lr.top - cr.top + list.scrollTop),
                  interRowGaps: gaps }
  }
  // 行高分布：常驻渲染时（无 content-visibility）统计所有行，找出高度差异来源
  let rowHist = null
  if (list) {
    const kids = [...list.children]
    const hist = {}
    const samples = {}
    kids.forEach((k, i) => {
      const h = Math.round(k.getBoundingClientRect().height)
      hist[h] = (hist[h] || 0) + 1
      if (!samples[h] && i % 7 === 0) samples[h] = (k.innerText || '').replace(/\s+/g, ' ').slice(0, 60)
    })
    rowHist = { hist, samples }
  }
  return { ok: true, imgs, rows, scroll, bottomGap, rowHist }
})()`

function probeScript(action, waitMs) {
  return `(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    ${action}
    window.__animPerf.start()
    await sleep(${waitMs})
    return window.__animPerf.stop()
  })()`
}

const TOGGLE = `
  const toggle = [...document.querySelectorAll('button')].find(b => (b.title || '').includes('侧栏'))
  toggle.click()
`

const MAXIMIZE = `
  const root = [...document.querySelectorAll('[data-window-root="true"]')].find(r => (r.querySelector('[data-window-titlebar="true"]') || {}).textContent?.includes('祈愿捕捉站'))
  const b = [...root.querySelectorAll('button')].find(x => x.title === '全屏' || x.title === '还原')
  b.click()
`

async function runMaterials(win) {
  const setup = await exec(win, MATERIALS_SETUP)
  if (!setup.ok) throw new Error(`materials setup: ${setup.why}`)
  const runs = []
  for (let i = 0; i < 4; i++) {
    const r = await exec(win, probeScript(TOGGLE, 700))
    await wait(400)
    runs.push({ label: i % 2 === 0 ? '收起侧栏' : '展开侧栏', ...r })
  }
  return { setup, runs }
}

function summarizeProfile(profile) {
  const byId = new Map(profile.nodes.map(n => [n.id, n]))
  const self = new Map()
  for (let i = 0; i < profile.samples.length; i++) {
    const id = profile.samples[i]
    const dt = profile.timeDeltas[i] || 0
    self.set(id, (self.get(id) || 0) + dt)
  }
  const merged = new Map()
  for (const [id, us] of self) {
    const n = byId.get(id); if (!n) continue
    const cf = n.callFrame || {}
    const url = String(cf.url || '')
    const short = url ? url.split('/').slice(-1)[0] : '(native)'
    const key = `${cf.functionName || '(anonymous)'} @ ${short}:${cf.lineNumber}`
    merged.set(key, (merged.get(key) || 0) + us)
  }
  return [...merged.entries()].sort((a, b) => b[1] - a[1]).slice(0, 22)
    .map(([where, us]) => ({ where, ms: +(us / 1000).toFixed(1) }))
}

async function cpuProfile(win, action, ms) {
  const dbg = win.webContents.debugger
  if (!dbg.isAttached()) dbg.attach('1.3')
  await dbg.sendCommand('Profiler.enable')
  await dbg.sendCommand('Profiler.setSamplingInterval', { interval: 200 })
  await dbg.sendCommand('Profiler.start')
  await exec(win, `(async () => { ${action} return true })()`)
  await wait(ms)
  const { profile } = await dbg.sendCommand('Profiler.stop')
  try { dbg.detach() } catch (_) {}
  return summarizeProfile(profile)
}

async function runGacha(win) {
  const setup = await exec(win, GACHA_SETUP)
  if (!setup.ok) throw new Error(`gacha setup: ${setup.why}`)
  let profile = null
  if (profileTarget === 'b') profile = await cpuProfile(win, MAXIMIZE, 900)
  const runs = []
  for (let i = 0; i < 4; i++) {
    const r = await exec(win, probeScript(MAXIMIZE, 900))
    await wait(500)
    runs.push({ label: i % 2 === 0 ? '最大化' : '取消最大化', ...r })
  }
  return { setup, runs, profile }
}

function idle(win) {
  return exec(win, probeScript('', 600))
}

async function main() {
  if (useDev) {
    const port = await getFreePort()
    viteProcess = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { cwd: PROJECT_ROOT, stdio: ['ignore', 'pipe', 'pipe'] })
    viteProcess.stdout.on('data', b => { viteOutput += b.toString() })
    viteProcess.stderr.on('data', b => { viteOutput += b.toString() })
    const viteUrl = `http://localhost:${port}`
    await waitForHttp(viteUrl)
    process.env.SILVERMOON_DEV_SERVER_URL = viteUrl
  } else {
    // 必须在 require main.js 之前生效（isDev 在模块加载时求值）
    Object.defineProperty(app, 'isPackaged', { value: true, configurable: true })
  }
  process.env.SILVERMOON_DISABLE_DEVTOOLS = '1'

  let started = false
  app.on('browser-window-created', (_e, win) => {
    if (started) return
    win.webContents.once('did-finish-load', async () => {
      if (started) return
      started = true
      try {
        await waitFor(win, `!!document.querySelector('#root')`, 'react root')
        await exec(win, PROBE)
        if (injectedCss) {
          await exec(win, `(() => { const s = document.createElement('style'); s.id = 'perf-css';
            s.textContent = ${JSON.stringify(injectedCss)}; document.head.appendChild(s); return true })()`)
        }
        const out = { ok: true, injectedCss, idle: await idle(win) }
        if (only !== 'b') out.materials = await runMaterials(win)
        if (only !== 'a') out.gacha = await runGacha(win)
        finish(out, 0)
      } catch (e) {
        finish({ ok: false, error: e.message, viteOutput: viteOutput.slice(-1500) }, 1)
      }
    })
  })
  setTimeout(() => finish({ ok: false, error: 'watchdog 240s' }, 1), 240000)
  require(path.join(PROJECT_ROOT, 'electron', 'main.js'))
}
main().catch(e => finish({ ok: false, error: e.message }, 1))

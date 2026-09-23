#!/usr/bin/env electron
/**
 * Regression test — a maximized (in-app fullscreen) mini-program must move the
 * Electron window smoothly when its titlebar is dragged.
 *
 * Bug: the drag base (window position) came from a cache that went stale, and the
 * only correction was asynchronous. The first mousemove therefore used the stale
 * base and teleported the window; the late correction jumped it back — a violent
 * back-and-forth flicker. Worst on heavy pages (祈愿捕捉站 → 角色活动祈愿, 4000+ rows)
 * because renderer load delays the correction.
 *
 * The drag math is absolute:  requestedX[i] = base + (i+1)*STEP
 * so  base = requestedX[i] - (i+1)*STEP  must stay constant, and the window must
 * advance by exactly N*STEP over N mousemoves.
 *
 * Run: env -u ELECTRON_RUN_AS_NODE electron scripts/test-fullscreen-window-drag.cjs
 * Exits 0 when every drag tracks the cursor, 1 otherwise.
 */
const { app, ipcMain } = require('electron')
const { spawn } = require('child_process')
const fs = require('fs')
const http = require('http')
const net = require('net')
const os = require('os')
const path = require('path')

const PROJECT_ROOT = path.resolve(__dirname, '..')
const REAL_DATA = '/Users/stargomia/Files/GenshinWikiData'
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'silvermoon-drag-test-'))
const profileDir = path.join(tmpRoot, 'profile')
const dataDir = path.join(tmpRoot, 'data')
fs.mkdirSync(profileDir, { recursive: true })
fs.mkdirSync(dataDir, { recursive: true })
// isolated COPY of the database: the user's real data is never touched
for (const f of ['silvermoon_terminal.db', 'user.db', 'user.json']) {
  const src = path.join(REAL_DATA, f)
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dataDir, f))
}
fs.writeFileSync(path.join(profileDir, 'config.json'),
  JSON.stringify({ dbDir: dataDir, activeBaseDb: 'silvermoon_terminal.db' }, null, 2))
app.setPath('userData', profileDir)

const STEP = 12
const N = 20
const DRAGS = 3

const SCENARIOS = [
  { label: '养成计算器 (轻量页面)', id: 'traincalc', name: '养成计算器', extra: '' },
  {
    label: '祈愿捕捉站 → 角色活动祈愿详情 (4133 条, 重页面)',
    optional: true,
    id: 'gachastation',
    name: '祈愿捕捉站',
    extra: `
      // 取最内层含该 UID 的 div（点击会冒泡到档案行的 onClick）
      const acc = [...root.querySelectorAll('div')]
        .filter(d => (d.textContent || '').includes('UID 188296354'))
        .sort((a, b) => a.textContent.length - b.textContent.length)[0]
      if (!acc) return { ok: false, why: 'archive 188296354 not listed' }
      acc.click()
      await sleep(1500)
      const typeBtn = [...root.querySelectorAll('button')].find(b => {
        const t = b.textContent || ''
        return t.includes('角色活动祈愿') && !t.includes('角色活动祈愿-2')
      })
      if (!typeBtn) return { ok: false, why: '301 type button not found | rendered: ' + (root.innerText || '').replace(/\s+/g, ' ').slice(0, 400) }
      typeBtn.click()
      await sleep(2500)
      const backBtn = [...root.querySelectorAll('button')].find(b => b.textContent.includes('返回'))
      if (!backBtn) return { ok: false, why: 'detail view did not open' }
    `,
  },
]

let viteProcess = null
let finished = false
let viteOutput = ''
function cleanup() {
  if (viteProcess && !viteProcess.killed) { try { viteProcess.kill('SIGTERM') } catch (_) {} }
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }) } catch (_) {}
}
process.once('exit', cleanup)
function finish(code) {
  if (finished) return
  finished = true
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
async function waitFor(win, expr, label, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try { if (await exec(win, expr)) return } catch (_) {}
    await wait(60)
  }
  throw new Error(`timeout waiting for ${label}`)
}

function setupScript(sc) {
  return `(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    const roots = () => [...document.querySelectorAll('[data-window-root="true"]')]
    const winRoot = n => roots().find(r => (r.querySelector('[data-window-titlebar="true"]') || {}).textContent?.includes(n))
    if (!location.hash.includes('/terminal')) location.hash = '#/terminal'
    for (let i = 0; i < 300 && !document.querySelector('[data-desktop-icon="${sc.id}"]'); i++) await sleep(50)
    const icon = document.querySelector('[data-desktop-icon="${sc.id}"]')
    if (!icon) return { ok: false, why: 'desktop icon ${sc.id} missing' }
    icon.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    let root = null
    for (let i = 0; i < 200 && !(root = winRoot(${JSON.stringify(sc.name)})); i++) await sleep(50)
    if (!root) return { ok: false, why: 'window ${sc.id} did not open' }
    ${sc.extra}
    const fsBtn = [...root.querySelectorAll('button')].find(b => b.title === '全屏')
    if (!fsBtn) return { ok: false, why: 'fullscreen button missing' }
    fsBtn.click()
    await sleep(1500)
    const cs = getComputedStyle(root)
    return { ok: true, fullscreenApplied: cs.position === 'fixed' && cs.zIndex === '9999' }
  })()`
}

// 一次拖拽：按下后立即移动（与真实用户一致）
function dragScript(name, sx0, sy0, dir) {
  return `(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    const roots = () => [...document.querySelectorAll('[data-window-root="true"]')]
    const root = roots().find(r => (r.querySelector('[data-window-titlebar="true"]') || {}).textContent?.includes(${JSON.stringify(name)}))
    if (!root) return { error: 'window not found' }
    const bar = root.querySelector('[data-window-titlebar="true"]')
    let resizes = 0
    const onResize = () => resizes++
    window.addEventListener('resize', onResize)
    const r0 = bar.getBoundingClientRect()
    const cx = Math.round(r0.left + r0.width / 2), cy = Math.round(r0.top + r0.height / 2)
    const D = ${STEP} * ${dir}
    bar.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, buttons: 1,
      clientX: cx, clientY: cy, screenX: ${sx0}, screenY: ${sy0} }))
    for (let i = 1; i <= ${N}; i++) {
      window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, buttons: 1,
        clientX: cx + i * D, clientY: cy, screenX: ${sx0} + i * D, screenY: ${sy0} }))
      await sleep(16)
    }
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, buttons: 0,
      clientX: cx + ${N} * D, clientY: cy, screenX: ${sx0} + ${N} * D, screenY: ${sy0} }))
    await sleep(200)
    window.removeEventListener('resize', onResize)
    return { resizes }
  })()`
}

async function runScenario(win, sc, failures, sxBase) {
  console.log(`\n── ${sc.label}`)
  const setup = await exec(win, setupScript(sc))
  if (!setup.ok && sc.optional && String(setup.why).startsWith('archive 188296354 not listed')) {
    console.log(`   SKIP  本机没有 188296354 的祈愿档案，跳过该场景（需要内置数据库）`)
    return
  }
  if (!setup.ok) {
    failures.push(`${sc.id}: setup failed — ${setup.why}`)
    console.log(`   FAIL  setup: ${setup.why}`)
    return
  }
  console.log(`   最大化已应用: ${setup.fullscreenApplied}`)
  // 拉回安全位置，避免拖拽把窗口推出屏幕（屏幕边缘会被系统夹住）
  win.setPosition(260, 120)
  await wait(200)

  for (let d = 0; d < DRAGS; d++) {
    // 第 3 次拖拽前，用「其他方式」移动窗口（等同于原生标题栏拖动 / 系统移动）。
    // 旧实现的缓存不会因此更新，于是下一次全屏拖拽会以过期坐标为基准瞬移。
    if (d === 2) {
      const p = win.getPosition()
      win.setPosition(p[0] + 45, p[1] + 53)
      await wait(150)
      console.log(`   （外部移动窗口 -> ${p[0] + 45},${p[1] + 53}，模拟原生标题栏拖动）`)
    }
    trace.length = 0
    const before = win.getPosition()
    const dir = d % 2 === 0 ? 1 : -1
    const renderer = await exec(win, dragScript(sc.name, sxBase + d * 40, 400, dir))
    await wait(200)
    const after = win.getPosition()
    if (renderer.error) { failures.push(`${sc.id} drag ${d + 1}: ${renderer.error}`); continue }

    const req = trace.map(t => t.x)
    // 期望轨迹：以「拖拽开始时的真实窗口位置」为基准，每步恰好走 STEP。
    // 关键不变量 —— 只有基准取到真实位置，这串值才会出现。
    // （窗口在静止的物理光标下方移动时，系统会额外送来真实 mousemove，
    //   因此用「子序列」判定，允许噪声插入但不容忍漏步。）
    const expected = Array.from({ length: N }, (_, k) => before[0] + (k + 1) * STEP * dir)
    let matched = 0
    for (const v of req) if (matched < expected.length && v === expected[matched]) matched++
    console.log(`   拖拽 ${d + 1}: 窗口 ${before[0]} -> ${after[0]}; 命中期望轨迹 ${matched}/${N} 步; setPosition 调用 ${req.length} 次`)

    if (matched !== expected.length) {
      failures.push(`${sc.id} drag ${d + 1}: 未从真实窗口位置跟随光标（仅命中 ${matched}/${N} 步，期望起点 ${before[0]}，首个请求 ${req[0]}）`)
    }
    if (renderer.resizes !== 0) failures.push(`${sc.id} drag ${d + 1}: ${renderer.resizes} renderer resize(s)`)
  }
}

let trace = []
async function run(win) {
  // keep the app's own position IPC working; just observe how often it is used
  let getPosCalls = 0
  ipcMain.removeHandler('window-get-position')
  ipcMain.handle('window-get-position', async () => { getPosCalls++; return win.getPosition() })

  const realSetPosition = win.setPosition.bind(win)
  win.setPosition = (x, y, ...rest) => { trace.push({ x, y }); return realSetPosition(x, y, ...rest) }

  await waitFor(win, `!!document.querySelector('#root')`, 'react root')
  await exec(win, `location.hash = '#/terminal'`)

  const failures = []
  let sx = 1200
  for (const sc of SCENARIOS) {
    await runScenario(win, sc, failures, sx)
    sx += 400
  }
  return { failures, getPosCalls }
}

async function main() {
  const port = await getFreePort()
  viteProcess = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { cwd: PROJECT_ROOT, stdio: ['ignore', 'pipe', 'pipe'] })
  viteProcess.stdout.on('data', b => { viteOutput += b.toString() })
  viteProcess.stderr.on('data', b => { viteOutput += b.toString() })
  const viteUrl = `http://localhost:${port}`
  await waitForHttp(viteUrl)
  process.env.SILVERMOON_DEV_SERVER_URL = viteUrl
  process.env.SILVERMOON_DISABLE_DEVTOOLS = '1'

  let started = false
  app.on('browser-window-created', (_e, win) => {
    if (started) return
    win.webContents.once('did-finish-load', async () => {
      if (started) return
      started = true
      try {
        const r = await run(win)
        console.log('\nfullscreen window drag — 全屏小程序标题栏拖拽')
        if (r.failures.length) {
          console.log('')
          for (const f of r.failures) console.log(`  FAIL  ${f}`)
          console.log(`\n  ${r.failures.length} failure(s)`)
          finish(1)
        } else {
          console.log(`\n  ✓ 所有场景的拖拽都严格跟随光标，基准值全程不变`)
          finish(0)
        }
      } catch (e) {
        console.log(`  FAIL  ${e.message}`)
        if (viteOutput) console.log(viteOutput.slice(-1500))
        finish(1)
      }
    })
  })
  setTimeout(() => { console.log('  FAIL  watchdog: exceeded 150s'); finish(1) }, 150000)
  require(path.join(PROJECT_ROOT, 'electron', 'main.js'))
}
main().catch(e => { console.log(`  FAIL  ${e.message}`); finish(1) })

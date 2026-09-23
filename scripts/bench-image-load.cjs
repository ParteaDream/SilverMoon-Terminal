#!/usr/bin/env electron
/**
 * Image-loading performance harness (baseline measurement).
 *
 * Launches the real production build against the real database + image pack
 * (hard-linked into a temp dir), navigates to each image-heavy page, and
 * measures:
 *   - read-image IPC call count / concurrency / latency
 *   - total base64 payload pushed over IPC
 *   - time to first image and time to all-visible-images-decoded
 *   - DOM node count, mounted <img> count, grid column count
 *   - long tasks (>50ms) during load and during scroll
 *
 * Run: env -u ELECTRON_RUN_AS_NODE electron scripts/bench-image-load.cjs [--page=materials] [--width=2560]
 */
const { app } = require('electron')
const fs = require('fs')
const net = require('net')
const os = require('os')
const path = require('path')

const PROJECT_ROOT = (() => {
  const a = process.argv.find(x => x.startsWith('--root='))
  return a ? path.resolve(a.slice('--root='.length)) : path.resolve(__dirname, '..')
})()
const REAL_DATA = '/Users/stargomia/Files/GenshinWikiData'
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'silvermoon-img-load-'))
const profileDir = path.join(tmpRoot, 'profile')
const dataDir = path.join(tmpRoot, 'data')
fs.mkdirSync(profileDir, { recursive: true })
fs.mkdirSync(dataDir, { recursive: true })
for (const f of ['silvermoon_terminal.db', 'user.db', 'user.json']) {
  const src = path.join(REAL_DATA, f)
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dataDir, f))
}

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

// per-page search query that matches several rows but is not empty
const SEARCH_QUERIES = {
  materials: '种子',
  weapons: '剑',
  characters: 'a',
  changelog: 'Luna',
  artifacts: '花',
}

const argOf = (name, dflt) => {
  const a = process.argv.find(x => x.startsWith(`--${name}=`))
  return a ? a.slice(name.length + 3) : dflt
}
const onlyPage = argOf('page', '')
// optional CSS override injected before measuring, for A/B of card-level styles
const cssB64 = argOf('css-b64', '')
const injectedCss = cssB64 ? Buffer.from(cssB64, 'base64').toString('utf8') : ''
const winWidth = parseInt(argOf('width', ''), 10) || 0

let finished = false
function cleanup() {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }) } catch (_) {}
}
process.once('exit', cleanup)
function finish(payload, code) {
  if (finished) return
  finished = true
  process.stdout.write(`\n===IMGBENCH===\n${JSON.stringify(payload, null, 2)}\n`)
  process.exitCode = code
  setTimeout(() => { try { app.exit(code) } catch (_) { process.exit(code) } }, 50)
}
const wait = ms => new Promise(r => setTimeout(r, ms))
const exec = (win, code) => win.webContents.executeJavaScript(code, true)

async function waitFor(win, expr, label, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try { if (await exec(win, expr)) return } catch (_) {}
    await wait(60)
  }
  throw new Error(`timeout waiting for ${label}`)
}

// ── main-process IPC instrumentation ─────────────────────────────────────────
// contextBridge objects are frozen, so the renderer cannot wrap readImage.
// Wrap the ipcMain handler instead: this sees every request, its latency and
// its exact payload size.
const { ipcMain } = require('electron')
const ipc = { resetAt: 0, log: [], inflight: 0, maxInflight: 0, resets: [] }
function installIpcProbe(invoke) {
  let handler = null
  try { handler = ipcMain._invokeHandlers ? ipcMain._invokeHandlers.get(invoke) : null } catch (_) {}
  if (!handler) {
    // Fall back: monkey-patch by removing and re-adding is not possible without
    // the original, so intercept via the internal map when available.
    try {
      const m = ipcMain._invokeHandlers
      if (m && m.get(invoke)) handler = m.get(invoke)
    } catch (_) {}
  }
  if (!handler) return false
  ipcMain.removeHandler(invoke)
  ipcMain.handle(invoke, async (event, ...args) => {
    const started = process.hrtime.bigint()
    ipc.inflight++
    if (ipc.inflight > ipc.maxInflight) ipc.maxInflight = ipc.inflight
    try {
      const res = await handler(event, ...args)
      const ms = Number(process.hrtime.bigint() - started) / 1e6
      ipc.log.push({ ms: +ms.toFixed(2), bytes: res && res.data ? res.data.length : 0,
                     ok: !!(res && res.success), file: String(args[0] || '').slice(-40) })
      return res
    } finally {
      ipc.inflight--
    }
  })
  return true
}

function ipcSnapshot() {
  const lat = ipc.log.map(l => l.ms).sort((a, b) => a - b)
  const q = p => lat.length ? +lat[Math.min(lat.length - 1, Math.floor(lat.length * p))].toFixed(1) : null
  return {
    calls: ipc.log.length,
    bytesMB: +(ipc.log.reduce((a, l) => a + l.bytes, 0) / 1048576).toFixed(2),
    maxInflight: ipc.maxInflight,
    errors: ipc.log.filter(l => !l.ok).length,
    latencyMs: { p50: q(0.5), p90: q(0.9), p99: q(0.99), max: q(1) },
    topFiles: Object.entries(ipc.log.reduce((acc, l) => {
      acc[l.file] = acc[l.file] || { n: 0, bytes: 0 }
      acc[l.file].n++; acc[l.file].bytes += l.bytes
      return acc
    }, {})).sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 8)
      .map(([file, v]) => ({ file, n: v.n, kb: Math.round(v.bytes / 1024) })),
  }
}
function ipcReset() { ipc.log = []; ipc.maxInflight = 0; ipc.inflight = 0 }

const INSTRUMENT = `(() => {
  if (window.__imgBench) return true
  const st = { longTasks: [] }
  window.__imgBench = st
  window.__imgBenchReset = () => { st.longTasks = []; return true }
  return true
})()`


// page → the page's own <h1> text (used as the readiness marker)
const HEADINGS = { materials: '材料', weapons: '武器', characters: '角色', artifacts: '圣遗物',
                   changelog: '版本新增数据速览', wishes: '祈愿', challenges: '挑战', data: '游戏数据',
                   websites: '网站', terminal: '终端', settings: '设置' }

const NAV = page => `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const want = ${JSON.stringify(HEADINGS)}['${page}'] || null
  const headingText = () => { const h = document.querySelector('main h1'); return h ? h.textContent : null }
  const before = headingText()
  const t0 = performance.now()
  location.hash = '#/${page}'
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    const ht = headingText()
    if (ht && (want ? ht === want : ht !== before)) break
    await sleep(25)
  }
  const shellAt = performance.now() - t0
  window.__imgBenchReset()
  return { shellAt, wanted: want, before, headingAfter: headingText(), hash: location.hash,
           itemCount: document.querySelectorAll('[data-item-id]').length,
           rowCount: document.querySelectorAll('table tbody tr').length,
           settledInTime: Date.now() < deadline }
})()`

const SAMPLE = `(() => {
  const st = window.__imgBench || { longTasks: [] }
  const imgs = [...document.images]
  const decoded = imgs.filter(i => i.complete && i.naturalWidth > 0).length
  const withSrc = imgs.filter(i => i.currentSrc || i.src).length
  const dataUrls = imgs.filter(i => (i.src || '').startsWith('data:')).length
  // dominant grid column count
  const grid = document.querySelector('[data-page-zone], .grid')
  let cols = null, colWidth = null
  if (grid) {
    const cs = getComputedStyle(grid)
    cols = cs.gridTemplateColumns ? cs.gridTemplateColumns.split(' ').filter(Boolean).length : null
    colWidth = cs.gridTemplateColumns ? cs.gridTemplateColumns.split(' ')[0] : null
  }
  const mem = performance.memory ? {
    usedMB: +(performance.memory.usedJSHeapSize / 1048576).toFixed(1),
    totalMB: +(performance.memory.totalJSHeapSize / 1048576).toFixed(1),
  } : null
  const zeroRectImgs = imgs.filter(i => { const r = i.getBoundingClientRect(); return r.width === 0 && r.height === 0 }).length
  return {
    longTasks: { count: st.longTasks.length, totalMs: +st.longTasks.reduce((a, b) => a + b, 0).toFixed(1),
                 maxMs: st.longTasks.length ? Math.max(...st.longTasks) : 0 },
    dom: { nodes: document.getElementsByTagName('*').length, hiddenImgs: zeroRectImgs },
    images: { total: imgs.length, withSrc, decoded, dataUrls },
    grid: { cols, colWidth, width: grid ? Math.round(grid.getBoundingClientRect().width) : null },
    viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
    mem,
  }
})()`

const itemCount = `document.querySelectorAll('[data-item-id]').length
  + document.querySelectorAll('table tbody tr').length`

async function measurePage(win, page) {
  try {
    await exec(win, INSTRUMENT)
    ipcReset()
    const nav = await exec(win, NAV(page))
    const samples = []
    // sample the settling curve at absolute intervals from the reset point
    let prev = 0
    for (const t of [250, 500, 1000, 2000, 3000, 5000, 8000]) {
      await wait(t - prev)
      prev = t
      const s = await exec(win, SAMPLE)
      Object.assign(s, ipcSnapshot())
      s.at = t
      samples.push(s)
    }
    const items = await exec(win, itemCount)
    return { page, shellMs: +(nav && nav.shellAt || 0).toFixed(1), items, nav, samples }
  } catch (e) {
    return { page, error: String(e && e.message || e), stack: String(e && e.stack || '') }
  }
}

async function scrollProbe(win) {
  // scroll the main pane in steps, sampling frame pacing + long tasks
  return exec(win, `(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    const main = document.querySelector('main')
    if (!main) return { ok: false, why: 'no main' }
    const st = window.__imgBench || { longTasks: [] }
    st.longTasks = []
    const before = window.__scrollProbeCalls || 0
    const frames = []
    let on = true, last = 0
    const tick = now => { if (!on) return; if (last) frames.push(now - last); last = now; requestAnimationFrame(tick) }
    requestAnimationFrame(tick)
    const max = Math.max(0, main.scrollHeight - main.clientHeight)
    const steps = 30
    for (let i = 1; i <= steps; i++) { main.scrollTop = Math.round(max * i / steps); await sleep(50) }
    await sleep(250)
    on = false
    frames.sort((a, b) => a - b)
    const q = p => frames.length ? +frames[Math.min(frames.length - 1, Math.floor(frames.length * p))].toFixed(1) : null
    return { ok: true, frames: frames.length, p50: q(0.5), p95: q(0.95), max: q(1),
             scrollableMax: max, before,
             longTasks: st.longTasks.length,
             longTaskMs: +st.longTasks.reduce((a, b) => a + b, 0).toFixed(1) }
  })()`)
}

// Types into the page's search box and measures (a) the per-keystroke re-render
// cost — the thing the memo/key fixes target — and (b) the image work that the
// filter change actually triggers. Uses a per-page query that matches several
// rows but is not empty, so the filtered list still has to render images.
async function searchProbe(win, page) {
  const query = SEARCH_QUERIES[page] || 'UI_A1'
  return exec(win, `(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    const input = [...document.querySelectorAll('input')]
      .find(i => (i.placeholder || '').includes('搜索') && i.type !== 'checkbox')
    if (!input) return { ok: false, why: 'no search input' }
    const st = window.__imgBench || { longTasks: [] }
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    const setVal = v => { setter.call(input, v); input.dispatchEvent(new Event('input', { bubbles: true })) }
    // reset to a clean slate and let the list settle before measuring
    if (input.value) { setVal(''); await sleep(400) }
    st.longTasks = []
    const frames = []
    let on = true, last = 0
    const tick = now => { if (!on) return; if (last) frames.push(now - last); last = now; requestAnimationFrame(tick) }
    requestAnimationFrame(tick)
    const chars = ${JSON.stringify(query)}.split('')
    const perChar = []
    const rowCounts = []
    for (const ch of chars) {
      const t0 = performance.now()
      setVal(input.value + ch)
      await new Promise(r => requestAnimationFrame(() => r()))
      await sleep(150)
      perChar.push(+(performance.now() - t0).toFixed(1))
      rowCounts.push(document.querySelectorAll('[data-item-id]').length
        + document.querySelectorAll('table tbody tr').length)
    }
    const queryValue = input.value
    const rowsShown = rowCounts[rowCounts.length - 1]
    // let images triggered by the filter settle
    await sleep(2500)
    const imgsAfter = [...document.images].filter(i => i.complete && i.naturalWidth > 0).length
    // restore the page to its unfiltered state for subsequent probes/pages
    setVal('')
    await sleep(600)
    on = false
    frames.sort((a, b) => a - b)
    const q = p => frames.length ? +frames[Math.min(frames.length - 1, Math.floor(frames.length * p))].toFixed(1) : null
    return { ok: true, query: queryValue, perChar, perCharMax: Math.max(...perChar),
             rowsShown, imgsAfter,
             p50: q(0.5), p95: q(0.95), max: q(1),
             longTasks: st.longTasks.length,
             longTaskMs: +st.longTasks.reduce((a, b) => a + b, 0).toFixed(1) }
  })()`)
}

async function main() {  Object.defineProperty(app, 'isPackaged', { value: true, configurable: true })
  process.env.SILVERMOON_DISABLE_DEVTOOLS = '1'

  let started = false
  let probeInstalled = false
  let geometry = null
  const results = []
  app.on('browser-window-created', (_e, win) => {    if (started) return
    win.webContents.once('did-finish-load', async () => {
      if (started) return
      started = true
      try {
        probeInstalled = installIpcProbe('read-image')
        await waitFor(win, `!!document.querySelector('#root')`, 'react root')
        // Pin geometry so every page is measured at the identical viewport.
        win.show()
        await wait(300)
        win.setBounds({ x: 60, y: 60, width: winWidth || 1400, height: 900 })
        await wait(900)
        const g = win.getBounds()
        geometry = { requested: { width: winWidth || 1400, height: 900 }, actual: g }
        await waitFor(win, `!!window.electronAPI && document.body.innerText.length > 0`, 'api ready', 30000)
        if (injectedCss) {
          await exec(win, `(() => { const s = document.createElement('style'); s.id = 'bench-css';
            s.textContent = ` + JSON.stringify(injectedCss) + `; document.head.appendChild(s); return true })()`)
        }
        await wait(2500) // let DB seed/initial page settle
        // Park on a near-image-free route so each measured page starts cold.
        await exec(win, `(location.hash = '#/data') && true`)
        await wait(1500)
        const pages = onlyPage ? onlyPage.split(',') : ['materials', 'weapons', 'characters', 'changelog']
        for (const p of pages) {
          const r = await measurePage(win, p)
          // search probe first: it resets the filter to empty when done
          try { r.search = await searchProbe(win, p) } catch (e) { r.search = { ok: false, error: String(e && e.message || e) } }
          try { r.scroll = await scrollProbe(win) } catch (e) { r.scroll = { ok: false, error: String(e && e.message || e) } }
          results.push(r)
        }
        finish({ ok: true, requestedWidth: winWidth || null, ipcProbeInstalled: probeInstalled, geometry, injectedCss, results }, 0)
      } catch (e) {
        finish({ ok: false, ipcProbeInstalled: probeInstalled, geometry, results, error: String(e && e.stack || e) }, 1)
      }
    })
  })

  require(path.join(PROJECT_ROOT, 'electron', 'main.js'))
}

// main.js creates the window asynchronously; guard against a silent hang
setTimeout(() => { if (!finished) finish({ ok: false, error: 'timeout: window never became ready' }, 1) }, 900000)

main()

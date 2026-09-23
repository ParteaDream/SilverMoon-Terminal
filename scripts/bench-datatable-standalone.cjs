#!/usr/bin/env electron
/**
 * Regression probe for pages that use <DataTable> in STANDALONE mode
 * (internal sort/filter state): websites and data.
 *
 * Verifies that clicking a column header still reorders rows after the
 * `derive` optimisation in useSortFilter.
 *
 * Run: env -u ELECTRON_RUN_AS_NODE npx electron --no-sandbox --disable-gpu scripts/bench-datatable-standalone.cjs
 */
const { app } = require('electron')
const fs = require('fs')
const os = require('os')
const path = require('path')

const PROJECT_ROOT = (() => {
  const a = process.argv.find(x => x.startsWith('--root='))
  return a ? path.resolve(a.slice('--root='.length)) : path.resolve(__dirname, '..')
})()
// 临时数据目录由图包 symlink + 退出自动清理构建，详见 scripts/lib/bench-data-dir.cjs
const { createBenchDataDir } = require('./lib/bench-data-dir.cjs')
const { tmpRoot, profileDir, dataDir, strategy: dataStrategy } = createBenchDataDir('silvermoon-dt-')
console.log(`[bench] 临时数据目录: ${tmpRoot} (${dataStrategy})`)

let finished = false
function finish(payload, code) {
  if (finished) return
  finished = true
  process.stdout.write(`\n===DTPROBE===\n${JSON.stringify(payload, null, 2)}\n`)
  setTimeout(() => { try { app.exit(code) } catch (_) { process.exit(code) } }, 50)
}
const wait = ms => new Promise(r => setTimeout(r, ms))
const exec = (w, c) => w.webContents.executeJavaScript(c, true)

const PROBE = heading => `(async () => { try {
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const text = () => (document.querySelector('main h1') || {}).textContent || null
  const t0 = performance.now()
  location.hash = '#/${heading.page}'
  const deadline = Date.now() + 25000
  while (Date.now() < deadline && text() !== ${JSON.stringify(heading.h1)}) await sleep(30)
  await sleep(1500)
  const ths = [...document.querySelectorAll('table thead th')]
  if (!ths.length) return { ok: false, why: 'no thead th' }
  // pick a header whose cell text is a real, varying value (skip '标题' dup cases)
  const idx = ths.findIndex((h, i) => i > 0 && (h.innerText || '').trim())
  const target = ths[idx].querySelector('button') || ths[idx]
  const hname = (ths[idx].textContent || '').trim()
  const colVals = () => [...document.querySelectorAll('table tbody tr')].map(tr => {
    const td = tr.querySelectorAll('td')[idx]
    return td ? (td.textContent || '').trim() : ''
  })
  const before = colVals()
  target.click()
  await sleep(1000)
  const asc = colVals()
  target.click()
  await sleep(1000)
  const desc = colVals()
  const same = a => a.length === before.length && a.every((v, i) => v === before[i])
  const sorted = (a, dir) => {
    const b = a.filter(Boolean)
    for (let i = 1; i < b.length; i++) {
      const c = b[i - 1].localeCompare(b[i], 'zh')
      if (dir === 'asc' ? c > 0 : c < 0) return false
    }
    return true
  }
  return { ok: true, rows: before.length, header: hname, headerIndex: idx,
           before: before.slice(0, 5), asc: asc.slice(0, 5), desc: desc.slice(0, 5),
           ascChanged: !same(asc), descChanged: !same(desc),
           ascSorted: sorted(asc, 'asc'), descSorted: sorted(desc, 'desc'),
           elapsedMs: +(performance.now() - t0).toFixed(0) }
} catch (err) { return { ok: false, why: String(err && err.stack || err) } } })()`

app.whenReady = app.whenReady.bind(app)
Object.defineProperty(app, 'isPackaged', { value: true, configurable: true })
process.env.SILVERMOON_DISABLE_DEVTOOLS = '1'

let started = false
app.on('browser-window-created', (_e, win) => {
  if (started) return
  win.webContents.once('did-finish-load', async () => {
    if (started) return
    started = true
    const out = { ok: true, results: [] }
    try {
      await exec(win, `new Promise(r => { const t = setInterval(() => { if (window.electronAPI && document.querySelector('#root')) { clearInterval(t); r(true) } }, 50) })`)
      await wait(3000)
      for (const heading of [{ page: 'websites', h1: '网站' }, { page: 'data', h1: '游戏数据' }]) {
        out.results.push({ page: heading.page, ...(await exec(win, PROBE(heading))) })
        await exec(win, `(location.hash = '#/terminal') && true`)
        await wait(800)
      }
    } catch (e) {
      out.ok = false; out.error = String(e && e.stack || e)
    }
    finish(out, out.ok ? 0 : 1)
  })
})

setTimeout(() => finish({ ok: false, error: 'timeout' }, 1), 180000)
require(path.join(PROJECT_ROOT, 'electron', 'main.js'))

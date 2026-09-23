#!/usr/bin/env electron
/**
 * Verifies that the useLazyImage hidden-element fix does not break the
 * reveal path: expanding a collapsed Changelog version must still load its
 * banner thumbnails, and the version background must appear.
 *
 * Run: env -u ELECTRON_RUN_AS_NODE npx electron --no-sandbox --disable-gpu scripts/bench-changelog-reveal.cjs
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
const { tmpRoot, profileDir, dataDir, strategy: dataStrategy } = createBenchDataDir('silvermoon-reveal-')
console.log(`[bench] 临时数据目录: ${tmpRoot} (${dataStrategy})`)

// main-process IPC probe
const { ipcMain, BrowserWindow } = require('electron')
const ipc = { log: [] }
function install() {
  let h = null
  try { h = ipcMain._invokeHandlers && ipcMain._invokeHandlers.get('read-image') } catch (_) {}
  if (!h) return false
  ipcMain.removeHandler('read-image')
  ipcMain.handle('read-image', async (e, ...a) => { const r = await h(e, ...a); const rec = { f: String(a[0] || '').slice(-46), w: a[1] === undefined ? 'NONE' : a[1], argc: a.length, argv: JSON.stringify(a).slice(0, 120), kb: Math.round(((r && r.data) || '').length / 1024) }; ipc.log.push(rec); if (String(a[0]||'').includes('Wallpaper')) console.log('WPREQ', JSON.stringify(rec)); return r })
  return true
}

let finished = false
function finish(p, code) {
  if (finished) return
  finished = true
  process.stdout.write(`\n===REVEAL===\n${JSON.stringify(p, null, 2)}\n`)
  setTimeout(() => { try { app.exit(code) } catch (_) { process.exit(code) } }, 50)
}
const wait = ms => new Promise(r => setTimeout(r, ms))
const exec = (w, c) => w.webContents.executeJavaScript(c, true)

Object.defineProperty(app, 'isPackaged', { value: true, configurable: true })
process.env.SILVERMOON_DISABLE_DEVTOOLS = '1'

let started = false
app.on('browser-window-created', (_e, win) => {
  if (started) return
  win.webContents.once('did-finish-load', async () => {
    if (started) return
    started = true
    const out = {}
    try {
      out.probe = install()
      await exec(win, `new Promise(r => { const t = setInterval(() => { if (window.electronAPI && document.querySelector('#root')) { clearInterval(t); r(true) } }, 50) })`)
      await wait(3000)
      await exec(win, `(location.hash = '#/changelog') && true`)
      // wait for changelog to finish loading
      await exec(win, `new Promise(r => { const t = setInterval(() => { const h = document.querySelector('main h1'); if (h && h.textContent.includes('版本新增')) { clearInterval(t); r(true) } }, 50) })`)
      await wait(2500)
      // trap no-hint reads of version wallpapers to find the call site
      await exec(win, `(() => {
        if (window.__traceInstalled) return true
        window.__traceInstalled = true
        const api = window.electronAPI
        const orig = api.readImage.bind(api)
        // electronAPI is frozen; fall back to patching via defineProperty on a wrapper is impossible,
        // so instead wrap window.electronAPI itself if configurable
        try {
          Object.defineProperty(window, 'electronAPI', {
            configurable: true,
            get() { return new Proxy(api, {
              get(t, k) {
                if (k !== 'readImage') return t[k]
                return (fn, w) => {
                  if (String(fn).includes('Wallpaper') && w === undefined) {
                    console.log('NOHINT ' + fn + ' :: ' + new Error().stack)
                  }
                  return orig(fn, w)
                }
              }
            }) }
          })
          window.__traceInstalled = 'proxy'
        } catch (e) { window.__traceInstalled = 'failed:' + e.message }
        return true
      })()`)
      win.webContents.on('console-message', (_e, _lvl, message) => {
        if (String(message).includes('NOHINT')) out.nohint = (out.nohint || []).concat(String(message).slice(0, 1200))
      })
      const before = await exec(win, `(() => {
        const imgs = [...document.images]
        return { total: imgs.length, decoded: imgs.filter(i => i.complete && i.naturalWidth > 0).length,
                 ipcBefore: true }
      })()`)
      ipc.log = []
      // expand a collapsed version: click its header button
      const expand = await exec(win, `(async () => {
        const sleep = ms => new Promise(r => setTimeout(r, ms))
        const roots = [...document.querySelectorAll('[data-version]')]
        const info = roots.map(r => ({ v: r.getAttribute('data-version'), h: r.getBoundingClientRect().height }))
        // choose a visibly collapsed one (short height), skipping the first (expanded by default)
        const target = roots.find((r, i) => i > 0 && r.getBoundingClientRect().height < 300)
        if (!target) return { why: 'no collapsed version found', info: info.slice(0, 5) }
        const v = target.getAttribute('data-version')
        const btn = [...target.querySelectorAll('button')].find(b => (b.textContent || '').length > 0)
        if (!btn) return { why: 'no header button', v }
        btn.click()
        await sleep(1500)
        // if the click opened the full-res lightbox, close it (Esc / click backdrop)
        const lb = document.querySelector('[data-overlay]')
        if (lb) { lb.dispatchEvent(new MouseEvent('click', { bubbles: true })); await sleep(600) }
        const heading = [...document.querySelectorAll('[data-version] h2, [data-version] div')]
        return { v, clicked: true, lightboxWasOpen: !!lb, heightAfter: target.getBoundingClientRect().height }
      })()`)
      await wait(2500)
      const after = await exec(win, `(() => {
        const imgs = [...document.images]
        return { total: imgs.length, decoded: imgs.filter(i => i.complete && i.naturalWidth > 0).length }
      })()`)
      out.before = before
      out.expand = expand
      out.after = after
      out.ipcDuringReveal = { calls: ipc.log.length, kb: ipc.log.reduce((a, l) => a + l.kb, 0), sample: ipc.log.slice(0, 6) }
      out.ok = !!(expand.clicked && after.decoded > before.decoded)
    } catch (e) {
      out.ok = false; out.error = String(e && e.stack || e)
    }
    finish(out, out.ok ? 0 : 1)
  })
})
setTimeout(() => finish({ ok: false, error: 'timeout' }, 1), 180000)
require(path.join(PROJECT_ROOT, 'electron', 'main.js'))

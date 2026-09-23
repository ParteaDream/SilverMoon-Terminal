#!/usr/bin/env electron
/**
 * Verifies the Changelog version background:
 *   1. fills the version content area's height (object-cover), and
 *   2. needs no extra fetch when a card is expanded (one size serves both states).
 *
 * Run: env -u ELECTRON_RUN_AS_NODE npx electron --no-sandbox --disable-gpu scripts/bench-changelog-bg-size.cjs
 */
const { app, ipcMain } = require('electron')
const fs = require('fs')
const os = require('os')
const path = require('path')

const PROJECT_ROOT = (() => {
  const a = process.argv.find(x => x.startsWith('--root='))
  return a ? path.resolve(a.slice('--root='.length)) : path.resolve(__dirname, '..')
})()
// 临时数据目录由图包 symlink + 退出自动清理构建，详见 scripts/lib/bench-data-dir.cjs
const { createBenchDataDir } = require('./lib/bench-data-dir.cjs')
const { tmpRoot, profileDir, dataDir, strategy: dataStrategy } = createBenchDataDir('sm-bgsize-')
console.log(`[bench] 临时数据目录: ${tmpRoot} (${dataStrategy})`)

const ipc = { log: [] }
function install() {
  let h = null
  try { h = ipcMain._invokeHandlers && ipcMain._invokeHandlers.get('read-image') } catch (_) {}
  if (!h) return false
  ipcMain.removeHandler('read-image')
  ipcMain.handle('read-image', async (e, ...a) => {
    const r = await h(e, ...a)
    ipc.log.push({ f: String(a[0] || ''), w: a[1] === undefined || a[1] === null ? null : a[1],
                   kb: Math.round(((r && r.data) || '').length / 1024) })
    return r
  })
  return true
}

let finished = false
function finish(p, code) {
  if (finished) return
  finished = true
  process.stdout.write(`\n===BGSIZE===\n${JSON.stringify(p, null, 2)}\n`)
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
      await exec(win, `new Promise(r=>{const t=setInterval(()=>{if(window.electronAPI&&document.querySelector('#root')){clearInterval(t);r(1)}},50)})`)
      await wait(2500)
      await exec(win, `(location.hash='#/changelog')&&1`)
      await exec(win, `new Promise(r=>{const t=setInterval(()=>{const h=document.querySelector('main h1');if(h&&h.textContent.includes('版本新增')){clearInterval(t);r(1)}},50)})`)
      await wait(3500)

      const bgInfo = `(() => {
        const e = [...document.querySelectorAll('[data-version]')].find(x => x.getAttribute('data-version') === '6.7')
        if (!e) return null
        const img = e.querySelector('img[alt=""]')
        if (!img) return { noImg: true }
        const r = img.getBoundingClientRect()
        return { cardH: Math.round(e.getBoundingClientRect().height),
                 dispW: Math.round(r.width), dispH: Math.round(r.height),
                 natW: img.naturalWidth, natH: img.naturalHeight,
                 srcKB: Math.round((img.src || '').length / 1024),
                 overlap: Math.round(Math.max(0, 1 - (img.naturalWidth / Math.max(1, r.width * 2))) * 100) }
      })()`

      out.collapsed = await exec(win, bgInfo)
      ipc.log = []

      // expand 6.7 by clicking its header text (not the title, which opens the lightbox)
      const clickRes = await exec(win, `(() => {
        const e = [...document.querySelectorAll('[data-version]')].find(x => x.getAttribute('data-version') === '6.7')
        if (!e) return 'no entry'
        const header = e.querySelector(':scope > div[aria-expanded]')
        if (!header) return 'no header'
        const before = header.getAttribute('aria-expanded')
        header.click()
        return 'clicked aria-expanded=' + before
      })()`)
      out.clickResult = clickRes
      await wait(3000)
      out.expanded = await exec(win, bgInfo)
      out.requestsDuringExpand = ipc.log.filter(r => r.f.includes('Wallpaper'))

      // Expected behaviour: a single size serves both states, so expanding must
      // NOT trigger a refetch, and the image must fill the container height.
      const fills = out.expanded && out.collapsed &&
        out.expanded.dispH >= out.expanded.cardH - 2 &&
        out.collapsed.dispH >= out.collapsed.cardH - 2
      out.fillsHeight = !!fills
      out.noRefetchOnExpand = out.requestsDuringExpand.length === 0
      out.ok = !!(fills && out.noRefetchOnExpand)
    } catch (e) {
      out.ok = false; out.error = String(e && e.stack || e)
    }
    finish(out, out.ok ? 0 : 1)
  })
})
setTimeout(() => finish({ ok: false, error: 'timeout' }, 1), 180000)
require(path.join(PROJECT_ROOT, 'electron', 'main.js'))

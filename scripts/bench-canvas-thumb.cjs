#!/usr/bin/env electron
/**
 * Proves the renderer-canvas thumbnail approach for WebP that nativeImage
 * cannot decode: loads the real wallpaper files in a hidden window, scales them
 * with canvas, and reports encoded size + latency for webp/jpeg/png.
 *
 * Run: env -u ELECTRON_RUN_AS_NODE npx electron --no-sandbox --disable-gpu scripts/bench-canvas-thumb.cjs
 */
const { app, BrowserWindow, nativeImage } = require('electron')
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')

const WDIR = '/Users/stargomia/Files/GenshinWikiData/images-Medium/Wallpaper'
const IDIR = '/Users/stargomia/Files/GenshinWikiData/images-Medium/Item'

const WORKER_HTML = path.join(require('os').tmpdir(), 'silvermoon-thumb-worker.html')
fs.writeFileSync(WORKER_HTML, '<html><body style="margin:0"><canvas id="c"></canvas></body></html>')

const kb = n => +(n / 1024).toFixed(1)

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 300, height: 200 })
  await win.loadFile(WORKER_HTML)

  const picked = []
  const wfiles = fs.readdirSync(WDIR).filter(f => /\.webp$/i.test(f))
    .map(f => ({ f, size: fs.statSync(path.join(WDIR, f)).size }))
    .sort((a, b) => b.size - a.size)
  picked.push({ dir: WDIR, f: wfiles[0].f, kind: 'wallpaper-largest' })
  picked.push({ dir: WDIR, f: wfiles[Math.floor(wfiles.length / 2)].f, kind: 'wallpaper-mid' })
  const ifiles = fs.readdirSync(IDIR).filter(f => /\.(png|webp)$/i.test(f)).slice(0, 2)
  for (const f of ifiles) picked.push({ dir: IDIR, f, kind: 'item-icon' })

  const results = []
  for (const { dir, f, kind } of picked) {
    const fp = path.join(dir, f)
    const srcKB = kb(fs.statSync(fp).size)
    const nativeOk = (() => { const i = nativeImage.createFromPath(fp); return !!i && !i.isEmpty() })()
    const url = pathToFileURL(fp).href
    const r = await win.webContents.executeJavaScript(`(async () => {
      const url = ${JSON.stringify(url)}
      const im = new Image()
      const t0 = performance.now()
      const loaded = await new Promise(res => {
        im.onload = () => res({ ok: true, w: im.naturalWidth, h: im.naturalHeight })
        im.onerror = () => res({ ok: false })
        im.src = url
      })
      const decodeMs = +(performance.now() - t0).toFixed(1)
      if (!loaded.ok) return { ok: false, decodeMs }
      const out = { ok: true, srcW: loaded.w, srcH: loaded.h, decodeMs }
      const c = document.getElementById('c')
      for (const target of [512, 256]) {
        if (loaded.w <= target) continue
        const tw = target, th = Math.round(loaded.h * (target / loaded.w))
        c.width = tw; c.height = th
        const ctx = c.getContext('2d')
        const t1 = performance.now()
        ctx.clearRect(0, 0, tw, th)
        ctx.drawImage(im, 0, 0, tw, th)
        const drawMs = +(performance.now() - t1).toFixed(1)
        const t2 = performance.now()
        const webp = c.toDataURL('image/webp', 0.82)
        const webpMs = +(performance.now() - t2).toFixed(1)
        const t3 = performance.now()
        const jpg = c.toDataURL('image/jpeg', 0.82)
        const jpgMs = +(performance.now() - t3).toFixed(1)
        const t4 = performance.now()
        const png = c.toDataURL('image/png')
        const pngMs = +(performance.now() - t4).toFixed(1)
        out['w' + target] = {
          webpKB: +(webp.length / 1024).toFixed(1), webpMs, webpFormat: webp.slice(5, 15),
          jpgKB: +(jpg.length / 1024).toFixed(1), jpgMs,
          pngKB: +(png.length / 1024).toFixed(1), pngMs,
          drawMs,
        }
      }
      return out
    })()`, true)
    results.push({ kind, file: f, srcKB, nativeImageDecoded: nativeOk, ...r })
  }

  // how many wallpaper files can nativeImage decode vs not
  let ok = 0, fail = 0
  for (const f of wfiles) {
    const i = nativeImage.createFromPath(path.join(WDIR, f.f))
    if (i && !i.isEmpty()) ok++; else fail++
  }

  process.stdout.write('\n===CANVASTHUMB===\n' + JSON.stringify({
    wallpaperNativeDecode: { total: wfiles.length, ok, fail }, results,
  }, null, 2) + '\n')
  app.exit(0)
})

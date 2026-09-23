#!/usr/bin/env electron
/**
 * Confirms the WebP variant used by the pack's version wallpapers and compares
 * main-process (nativeImage) decode against renderer (Chromium) decode.
 *
 * Run: env -u ELECTRON_RUN_AS_NODE npx electron --no-sandbox --disable-gpu scripts/bench-webp-probe.cjs
 */
const { app, nativeImage, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

const WDIR = '/Users/stargomia/Files/GenshinWikiData/images-Medium/Wallpaper'

// Minimal RIFF/WEBP chunk walker
function webpChunks(buf) {
  if (buf.length < 12) return null
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return null
  const chunks = []
  let off = 12
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4)
    const size = buf.readUInt32LE(off + 4)
    chunks.push({ id, size })
    off += 8 + size + (size % 2)
    if (chunks.length > 20) break
  }
  return chunks
}

app.whenReady().then(async () => {
  const files = fs.readdirSync(WDIR).filter(f => /\.webp$/i.test(f))
  const inspected = []
  for (const f of files.slice(0, 3)) {
    const buf = fs.readFileSync(path.join(WDIR, f))
    const chunks = webpChunks(buf)
    const img = nativeImage.createFromPath(path.join(WDIR, f))
    inspected.push({
      f, sizeKB: +(buf.length / 1024).toFixed(1),
      chunks: chunks ? chunks.map(c => `${c.id}:${c.size}`) : 'not-webp',
      vp8xAlpha: (() => {
        const x = chunks && chunks.find(c => c.id === 'VP8X')
        if (!x) return null
        // VP8X payload starts after id+size (8 bytes): flags byte first
        const flags = buf.readUInt8(12 + 8)
        return { raw: flags, hasAlpha: !!(flags & 0x10), hasAnimation: !!(flags & 0x02) }
      })(),
      nativeDecoded: !!img && !img.isEmpty(),
    })
  }

  // Renderer decode test: hand each file to an <img> via data URL and report.
  const win = new BrowserWindow({ show: false, width: 400, height: 300, webPreferences: { contextIsolation: true } })
  await win.loadURL('data:text/html,<html><body></body></html>')

  const payload = files.slice(0, 6).map(f => {
    const buf = fs.readFileSync(path.join(WDIR, f))
    const head = buf.subarray(0, 4)
    const mime = head[0] === 0x52 ? 'image/webp' : head[0] === 0x89 ? 'image/png' : 'image/jpeg'
    return { f, dataUrl: `data:${mime};base64,${buf.toString('base64')}` }
  })

  const rendererResults = await win.webContents.executeJavaScript(`(async () => {
    const items = ${JSON.stringify(payload)}
    const out = []
    for (const it of items) {
      const t0 = performance.now()
      const res = await new Promise(resolve => {
        const im = new Image()
        im.onload = () => resolve({ ok: true, w: im.naturalWidth, h: im.naturalHeight })
        im.onerror = () => resolve({ ok: false })
        im.src = it.dataUrl
      })
      out.push({ f: it.f, ...res, decodeMs: +(performance.now() - t0).toFixed(1), b64KB: +(it.dataUrl.length / 1024).toFixed(1) })
    }
    return out
  })()`, true)

  process.stdout.write('\n===WEBPPROBE===\n' + JSON.stringify({ inspected, rendererResults }, null, 2) + '\n')
  app.exit(0)
})

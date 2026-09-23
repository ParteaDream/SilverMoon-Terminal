#!/usr/bin/env electron
/**
 * Diagnostics for the thumbnail pipeline: can nativeImage decode the pack's
 * WebP/PNG assets at all, and what is the encoded size at the requested width?
 *
 * Run: env -u ELECTRON_RUN_AS_NODE npx electron --no-sandbox --disable-gpu scripts/bench-thumb-encode.cjs
 */
const { app, nativeImage } = require('electron')
const fs = require('fs')
const path = require('path')

const DATA = '/Users/stargomia/Files/GenshinWikiData/images-Medium'
const kb = n => +(n / 1024).toFixed(1)

function probe(fp, maxWidth) {
  const src = fs.statSync(fp).size
  const t0 = Date.now()
  const img = nativeImage.createFromPath(fp)
  const decodeMs = Date.now() - t0
  const empty = !img || img.isEmpty()
  const out = { file: path.basename(fp), srcKB: kb(src), srcDims: empty ? null : img.getSize(), decodeMs, decoded: !empty }
  if (empty) return out
  const sz = img.getSize()
  const targetW = Math.min(maxWidth, sz.width)
  const targetH = Math.round(sz.height * (targetW / sz.width))
  const t1 = Date.now()
  const r = img.resize({ width: targetW, height: targetH })
  out.resizeMs = Date.now() - t1
  if (!r || r.isEmpty()) { out.resizeFailed = true; return out }
  const t2 = Date.now(); const png = r.toPNG(); out.pngMs = Date.now() - t2
  const t3 = Date.now(); const jpg = r.toJPEG(82); out.jpgMs = Date.now() - t3
  out.pngKB = kb(png.length); out.pngB64KB = kb(Math.ceil(png.length / 3) * 4)
  out.jpgKB = kb(jpg.length); out.jpgB64KB = kb(Math.ceil(jpg.length / 3) * 4)
  return out
}

app.whenReady().then(() => {
  const results = { note: [], groups: {} }

  // 1. the heavy wallpapers (changelog version backgrounds)
  const wdir = path.join(DATA, 'Wallpaper')
  const wallpapers = fs.readdirSync(wdir)
    .filter(f => /\.(webp|png|jpe?g)$/i.test(f))
    .map(f => ({ f, size: fs.statSync(path.join(wdir, f)).size }))
    .sort((a, b) => b.size - a.size)
  results.groups.wallpaper_top = wallpapers.slice(0, 5).map(({ f }) => probe(path.join(wdir, f), 1024))
  results.groups.wallpaper_mid = wallpapers.slice(Math.floor(wallpapers.length / 2), Math.floor(wallpapers.length / 2) + 3)
    .map(({ f }) => probe(path.join(wdir, f), 1024))

  // 2. item icons (materials / weapons page thumbnails)
  for (const [label, dir] of [['item', 'Item'], ['weapon-icon', 'Weapon-Icon'], ['char-img', 'Char-Img']]) {
    const d = path.join(DATA, dir)
    if (!fs.existsSync(d)) continue
    const files = fs.readdirSync(d).filter(f => /\.(webp|png|jpe?g)$/i.test(f)).slice(0, 4)
    results.groups[label] = files.map(f => probe(path.join(d, f), 256))
  }

  // 3. how many wallpaper files fail to decode at all
  let fail = 0, ok = 0
  const failSamples = []
  for (const { f } of wallpapers) {
    const img = nativeImage.createFromPath(path.join(wdir, f))
    if (!img || img.isEmpty()) { fail++; if (failSamples.length < 8) failSamples.push(f) } else ok++
  }
  results.wallpaperDecode = { total: wallpapers.length, ok, fail, failSamples }

  process.stdout.write('\n===THUMBENCODE===\n' + JSON.stringify(results, null, 2) + '\n')
  app.exit(0)
})

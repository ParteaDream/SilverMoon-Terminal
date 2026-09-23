#!/usr/bin/env electron
/**
 * Changelog 板块视觉/几何核验。
 *
 * 1) 开启开发者工具栏时，返回顶部按钮不得被工具栏遮挡
 * 2) 版本导航条存在、刻度数正确，且滚动时滑块跟随
 *
 * 生产构建 + 隔离数据目录（硬链接图包），输出截图到 /tmp。
 * Run: env -u ELECTRON_RUN_AS_NODE electron scripts/shot-changelog.cjs
 */
const { app } = require('electron')
const fs = require('fs')
const os = require('os')
const path = require('path')

const PROJECT_ROOT = path.resolve(__dirname, '..')
const REAL_DATA = '/Users/stargomia/Files/GenshinWikiData'
const OUT_DIR = path.join(PROJECT_ROOT, '.changelog-preview')
fs.mkdirSync(OUT_DIR, { recursive: true })
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'silvermoon-shot-'))
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
    const s = path.join(src, e.name), d = path.join(dst, e.name)
    if (e.isDirectory()) linkTree(s, d)
    else if (e.isFile()) { try { fs.linkSync(s, d) } catch (_) { try { fs.copyFileSync(s, d) } catch (_) {} } }
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
// 生产构建
Object.defineProperty(app, 'isPackaged', { value: true, configurable: true })
process.env.SILVERMOON_DISABLE_DEVTOOLS = '1'

let finished = false
function cleanup() { try { fs.rmSync(tmpRoot, { recursive: true, force: true }) } catch (_) {} }
process.once('exit', cleanup)
function finish(payload, code) {
  if (finished) return
  finished = true
  // app.exit() 会立即终止进程，管道上的 process.stdout.write 可能来不及 flush，
  // 这里用同步写保证结果一定落盘。
  try { fs.writeSync(1, `\n===SHOT===\n${JSON.stringify(payload, null, 2)}\n`) } catch (_) {}
  process.exitCode = code
  setTimeout(() => { try { app.exit(code) } catch (_) { process.exit(code) } }, 150)
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
async function shot(win, file) {
  const img = await win.webContents.capturePage()
  fs.writeFileSync(file, img.toPNG())
  return file
}

const GEOM = `(() => {
  const main = document.querySelector('main')
  const rail = document.querySelector('[data-version-rail]')
  const ticks = rail ? rail.querySelectorAll('button').length : 0
  const versions = document.querySelectorAll('[data-version]').length
  const btn = document.querySelector('[title="返回顶部"]')
  const bar = document.querySelector('.fixed.bottom-0.right-0.z-\\\\[60\\\\]')
    || [...document.querySelectorAll('div')].find(d => (d.className||'').includes('bottom-0') && (d.className||'').includes('h-10'))
  const r = el => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), bottom: Math.round(b.bottom) } }
  const rb = r(btn), bb = r(bar), rr = r(rail)
  let overlap = null
  if (rb && bb) overlap = !(rb.bottom <= bb.y || rb.y >= bb.bottom || rb.x + rb.w <= bb.x || rb.x >= bb.x + bb.w)
  return {
    scrollTop: Math.round(main.scrollTop), scrollHeight: main.scrollHeight, clientHeight: main.clientHeight,
    versionEntries: versions, railTicks: ticks, rail: rr, backToTop: rb, devBar: bb,
    backToTopOverlapsDevBar: overlap,
    nativeScrollbarHidden: main.classList.contains('page-rail-scroll'),
    railVar: getComputedStyle(document.documentElement).getPropertyValue('--page-rail-reserve-w').trim(),
  }
})()`

async function run(win) {
  await waitFor(win, `!!document.querySelector('#root')`, 'react root')
  await exec(win, `location.hash = '#/changelog'`)
  await waitFor(win, `document.querySelectorAll('[data-version]').length > 0`, 'version entries')
  await wait(3000)   // 等图片/展开状态稳定

  const top = await exec(win, GEOM)
  await shot(win, path.join(OUT_DIR, 'changelog-top.png'))

  // 滚到中部：返回顶部按钮出现 + 导航条滑块应下移
  await exec(win, `document.querySelector('main').scrollTop = Math.round(document.querySelector('main').scrollHeight * 0.45)`)
  await wait(900)
  const mid = await exec(win, GEOM)
  await shot(win, path.join(OUT_DIR, 'changelog-mid.png'))

  // 滚到底部
  await exec(win, `document.querySelector('main').scrollTop = document.querySelector('main').scrollHeight`)
  await wait(900)
  const bottom = await exec(win, GEOM)
  await shot(win, path.join(OUT_DIR, 'changelog-bottom.png'))

  // 滑块几何：应与 scrollTop/scrollHeight 一致
  const thumb = await exec(win, `(() => {
    const main = document.querySelector('main')
    const t = document.querySelector('[data-rail-thumb]')
    return { top: parseFloat(t.style.top), height: parseFloat(t.style.height),
             expTop: main.scrollTop / main.scrollHeight * 100,
             expHeight: main.clientHeight / main.scrollHeight * 100 }
  })()`)

  // 点击第 40% 处的刻度：该版本应落在视口顶部
  const jump = await exec(win, `(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    const main = document.querySelector('main')
    const ticks = [...document.querySelectorAll('[data-version-rail] button')]
    const target = ticks[Math.floor(ticks.length * 0.4)]
    const label = target.getAttribute('aria-label') || ''
    target.click()
    await sleep(1400)
    const m = /版本 (.+)$/.exec(label)
    const el = m ? document.querySelector('[data-version="' + m[1] + '"]') : null
    const mr = main.getBoundingClientRect()
    const er = el ? el.getBoundingClientRect() : null
    return { label, scrollTop: Math.round(main.scrollTop),
             versionTopInViewport: er ? Math.round(er.top - mr.top) : null,
             thumbTopAfter: parseFloat(document.querySelector('[data-rail-thumb]').style.top) }
  })()`)

  // 刻度位置是否都落在轨道内且随文档顺序递增
  const tickSpread = await exec(win, `(() => {
    const rail = document.querySelector('[data-version-rail]')
    const h = rail.getBoundingClientRect().height
    const tops = [...rail.querySelectorAll('button')].map(b => parseFloat(b.style.top))
    return { count: tops.length, min: Math.min(...tops).toFixed(1), max: Math.max(...tops).toFixed(1),
             allInside: tops.every(t => t >= -1 && t <= 101), railHeight: Math.round(h),
             strictlyIncreasing: tops.every((t, i) => i === 0 || t >= tops[i - 1] - 0.01) }
  })()`)

  // ── 刻度/滑块交互核验 ──
  await exec(win, `document.querySelector('main').scrollTop = 0`)
  await wait(500)
  const rail = await exec(win, `(() => {
    const rail = document.querySelector('[data-version-rail]')
    const track = rail.querySelector('[data-rail-track]')
    const thumb = rail.querySelector('[data-rail-thumb]')
    const band = rail.querySelector('[data-rail-band]')
    const tr = track.getBoundingClientRect(), br = band.getBoundingClientRect(), thr = thumb.getBoundingClientRect()
    const ticks = [...band.querySelectorAll('button')]
    // 命中测试：每个刻度所在高度、轨道中心处的最上层元素不能落在刻度带里
    const blocked = []
    for (const t of ticks) {
      const r = t.getBoundingClientRect()
      const el = document.elementFromPoint(tr.left + tr.width / 2, r.top + r.height / 2)
      if (el && band.contains(el)) blocked.push(t.getAttribute('aria-label'))
    }
    return {
      railWidth: Math.round(rail.getBoundingClientRect().width),
      bandRight: Math.round(br.right), trackLeft: Math.round(tr.left),
      bandTrackGapPx: Math.round(tr.left - br.right),
      defaultTickCount: ticks.length,
      blockedTicks: blocked,
      series: ticks.map(t => ({ v: (t.getAttribute('aria-label') || '').replace('跳转到版本 ', ''), cls: ((t.querySelector('span') || {}).className || '') })),
      thumbH: Math.round(thr.height),
    }
  })()`)

  // 指针进入 1.x 范围：应展开该系列全部刻度
  const seriesHover = await exec(win, `(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    const band = document.querySelector('[data-rail-band]')
    const br = band.getBoundingClientRect()
    const before = band.querySelectorAll('button').length
    const t40 = [...band.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === '跳转到版本 4.0')
    const r40 = t40.getBoundingClientRect()
    band.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: br.left + 6, clientY: r40.top + r40.height / 2 }))
    await sleep(350)
    const after = [...band.querySelectorAll('button')].map(b => (b.getAttribute('aria-label') || '').replace('跳转到版本 ', ''))
    return { before, afterCount: after.length, after }
  })()`)

  // 右侧车道：缝隙大小 + 是否压住正文 + 悬浮版本号是否被按钮盖住
  const lane = await exec(win, `(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    const main = document.querySelector('main')
    main.scrollTop = Math.round(main.scrollHeight * 0.55)
    await sleep(700)
    const rail = document.querySelector('[data-version-rail]')
    const band = rail.querySelector('[data-rail-band]')
    const rr = rail.getBoundingClientRect(), br = band.getBoundingClientRect()
    const nav = [...document.querySelectorAll('div')].find(d => (d.className || '').includes('top-1/2') && (d.className || '').includes('flex-col'))
    const navRect = nav ? nav.getBoundingClientRect() : null
    const topBtn = document.querySelector('[title="返回顶部"]')
    const topRect = topBtn ? topBtn.getBoundingClientRect() : null
    // 正文实际右缘 = 内容根节点右缘 - 右内边距
    const root = document.querySelector('[data-changelog-root]')
    const rootRect = root.getBoundingClientRect()
    const contentRight = rootRect.right - (parseFloat(getComputedStyle(root).paddingRight) || 0)
    // React 的 onMouseEnter 由 mouseover 合成，必须派发 mouseover
    const hoverAt = async (clientY) => {
      let best = null
      for (const t of [...band.querySelectorAll('button')]) {
        const r = t.getBoundingClientRect()
        const d = Math.abs(r.top + r.height / 2 - clientY)
        if (!best || d < best.d) best = { t, d, r }
      }
      band.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: br.left + 6, clientY: best.r.top + best.r.height / 2 }))
      best.t.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }))
      await sleep(400)
      const tip = [...rail.querySelectorAll('div')].find(d => (d.className || '').includes('right-full'))
      return { rect: tip ? tip.getBoundingClientRect() : null, version: tip ? tip.textContent : null }
    }
    const mid = await hoverAt((rr.top + rr.bottom) / 2)
    const bot = await hoverAt(topRect ? topRect.top + topRect.height / 2 : rr.bottom - 14)
    const hit = (a, b) => !!(a && b) && !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom)
    const R = r => r ? { l: Math.round(r.left), r: Math.round(r.right) } : null
    const cs = getComputedStyle(document.documentElement)
    return {
      band: R(br), nav: R(navRect), backToTop: R(topRect),
      contentRight: Math.round(contentRight),
      reserveVar: cs.getPropertyValue('--page-rail-reserve-w').trim(),
      gutterVar: cs.getPropertyValue('--page-rail-gutter-w').trim(),
      gapBandToNav: navRect ? Math.round(br.left - navRect.right) : null,
      gapContentToNav: navRect ? Math.round(navRect.left - contentRight) : null,
      midTip: { rect: R(mid.rect), version: mid.version },
      botTip: { rect: R(bot.rect), version: bot.version },
      midTipOverlapsNav: hit(mid.rect, navRect),
      botTipOverlapsBackToTop: hit(bot.rect, topRect),
      railZ: getComputedStyle(rail).zIndex,
      navZ: nav ? getComputedStyle(nav).zIndex : null,
    }
  })()`)

  // 窄窗口下同样不能压正文
  win.setSize(1080, 820)
  await wait(1000)
  const laneNarrow = await exec(win, `(() => {
    const rail = document.querySelector('[data-version-rail]')
    const band = rail.querySelector('[data-rail-band]')
    const br = band.getBoundingClientRect()
    const nav = [...document.querySelectorAll('div')].find(d => (d.className || '').includes('top-1/2') && (d.className || '').includes('flex-col'))
    const nr = nav ? nav.getBoundingClientRect() : null
    const root = document.querySelector('[data-changelog-root]')
    const rr = root.getBoundingClientRect()
    const contentRight = rr.right - (parseFloat(getComputedStyle(root).paddingRight) || 0)
    return {
      width: window.innerWidth,
      gapBandToNav: nr ? Math.round(br.left - nr.right) : null,
      gapContentToNav: nr ? Math.round(nr.left - contentRight) : null,
      contentRight: Math.round(contentRight), navLeft: nr ? Math.round(nr.left) : null,
    }
  })()`)

  return { top, mid, bottom, thumb, jump, tickSpread, rail, seriesHover, lane, laneNarrow, outDir: OUT_DIR }
}

let started = false
app.on('browser-window-created', (_e, win) => {
  if (started) return
  win.webContents.once('did-finish-load', async () => {
    if (started) return
    started = true
    try { finish({ ok: true, ...(await run(win)) }, 0) } catch (e) { finish({ ok: false, error: e.message }, 1) }
  })
})
setTimeout(() => finish({ ok: false, error: 'watchdog 120s' }, 1), 120000)
require(path.join(PROJECT_ROOT, 'electron', 'main.js'))

#!/usr/bin/env electron
/**
 * Changelog 图片加载「视口优先」核验脚本。
 *
 * 复现用户报告：滚动到页面中段后，图片仍然按 DOM 顺序（= 页面从上到下）
 * 依次出现，当前可视范围内的图片并不是最先出来的。
 *
 * 测量方式（渲染进程侧）：
 *   1. 等 Changelog 首屏稳定；
 *   2. __priMark()：给页面上所有「图片槽位」打标记，并记录此刻是否已有图；
 *   3. 同一个同步块内滚动（跳转 / 分步 / 展开），随后 __priArm() 记录每个
 *      槽位滚动后的可视状态并清零事件表；
 *   4. MutationObserver 记录每个槽位「图上屏」的时刻（含当时是否在可视区）；
 *   5. 统计可视区槽位与视口外槽位的加载先后。
 *
 * 关键指标：
 *   viewportLastMs    可视区内最后一张图出现的时刻
 *   offscreenFirstMs  视口外第一张图出现的时刻
 *   violations        出现在 viewportLast 之前的「视口外」事件数
 *   期望：violations === 0 且 offscreenFirstMs > viewportLastMs
 *
 * Run:
 *   env -u ELECTRON_RUN_AS_NODE npx electron --no-sandbox --disable-gpu \
 *     scripts/bench-changelog-priority.cjs [--scenario=jump|steps|expand] [--settle=4000]
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
const { tmpRoot, profileDir, dataDir, strategy: dataStrategy } = createBenchDataDir('silvermoon-prio-')
console.log(`[bench] 临时数据目录: ${tmpRoot} (${dataStrategy})`)

const argOf = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d }
const scenario = argOf('scenario', 'jump')
const settleMs = parseInt(argOf('settle', '4000'), 10)
const observeMs = parseInt(argOf('observe', '6000'), 10)

// ── 主进程 IPC 探针：每个 read-image 请求的文件名/体积/耗时 ──
const ipc = { log: [] }
function installIpcProbe() {
  let h = null
  try { h = ipcMain._invokeHandlers && ipcMain._invokeHandlers.get('read-image') } catch (_) {}
  if (!h) return false
  ipcMain.removeHandler('read-image')
  ipcMain.handle('read-image', async (e, ...a) => {
    const t0 = Date.now()
    const r = await h(e, ...a)
    ipc.log.push({ f: String(a[0] || '').slice(-34), w: a[1] === undefined ? null : a[1],
                   kb: Math.round(((r && r.data) || '').length / 1024), ms: Date.now() - t0 })
    return r
  })
  return true
}

let finished = false
function finish(p, code) {
  if (finished) return
  finished = true
  process.stdout.write(`\n===PRIORITY===\n${JSON.stringify(p, null, 2)}\n`)
  setTimeout(() => { try { app.exit(code) } catch (_) { process.exit(code) } }, 50)
}
const wait = ms => new Promise(r => setTimeout(r, ms))
const exec = (w, c) => w.webContents.executeJavaScript(c, true)

// ── 渲染进程探针 ──
const INSTALL = `(() => {
  if (window.__pri) return 'already'
  const st = { events: [], t0: 0, seq: 0, armed: false }
  window.__pri = st
  const rectOf = el => { try { return el.getBoundingClientRect() } catch (_) { return { top: 0, bottom: 0, width: 0, height: 0 } } }
  const visNow = el => { const r = rectOf(el); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight }
  const keyOf = el => { const t = el.closest && el.closest('[data-pri-key]'); return t ? t.getAttribute('data-pri-key') : 'other' }
  const record = (kind, el) => {
    if (!st.armed) return
    const r = rectOf(el)
    const host = (el.closest && el.closest('[data-pri-key]')) || el
    st.events.push({ seq: st.seq++, t: Math.round(performance.now() - st.t0), kind, key: keyOf(el),
                     inView: visNow(host),
                     v: (el.closest && el.closest('[data-version]')) ? el.closest('[data-version]').getAttribute('data-version') : null,
                     order: st.events.length })
  }
  const mo = new MutationObserver(muts => {
    for (const m of muts) {
      if (m.type === 'childList') {
        for (const n of m.addedNodes) {
          if (n.nodeType !== 1) continue
          if (n.tagName === 'IMG') record('add', n)
          else { const imgs = n.querySelectorAll ? n.querySelectorAll('img') : []; for (const i of imgs) record('add', i) }
        }
      } else if (m.type === 'attributes' && m.target.tagName === 'IMG' && m.attributeName === 'src' && m.target.getAttribute('src')) {
        record('src', m.target)
      }
    }
  })
  window.__priStart = () => {
    const main = document.querySelector('main')
    if (!main) return 'no main'
    mo.observe(main, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] })
    return 'observing'
  }
  // 打标记：所有图片槽位（卡片 button[title] / 版本背景容器）
  window.__priMark = () => {
    let n = 0
    st.items = []
    const mark = (el, kind) => {
      const key = kind + ':' + (n++)
      el.setAttribute('data-pri-key', key)
      const img = el.querySelector('img')
      const hasSrc = !!(img && img.getAttribute('src'))
      const r = rectOf(el)
      st.items.push({ key, kind, loaded: hasSrc,
                      v: el.closest('[data-version]') ? el.closest('[data-version]').getAttribute('data-version') : null,
                      markTop: Math.round(r.top), h: Math.round(r.height),
                      hiddenAtMark: el.getClientRects().length === 0 })
      return key
    }
    for (const root of document.querySelectorAll('[data-version]')) {
      for (const card of root.querySelectorAll('button[title]')) mark(card, 'card')
      const bg = [...root.querySelectorAll('div')].find(d => d.className && String(d.className).includes('pointer-events-none') && d.querySelector('img'))
      if (bg) mark(bg, 'bg')
    }
    st.armed = false
    st.events = []; st.seq = 0
    return { marked: st.items.length, pending: st.items.filter(i => !i.loaded).length }
  }
  // 滚动后立刻（同步）记录每个槽位的可视状态，并开始记事件
  window.__priArm = () => {
    const main = document.querySelector('main')
    for (const it of st.items) {
      const el = document.querySelector('[data-pri-key="' + it.key + '"]')
      it.stillThere = !!el
      it.inViewAfter = el ? visNow(el) : false
      it.topAfter = el ? Math.round(rectOf(el).top) : null
    }
    st.t0 = performance.now(); st.seq = 0; st.events = []; st.armed = true
    return { scrollTop: Math.round(main.scrollTop), pendingInView: st.items.filter(i => !i.loaded && i.inViewAfter).length }
  }
  window.__priReport = () => ({
    events: st.events, items: st.items, now: Math.round(performance.now() - st.t0),
    scrollTop: Math.round(document.querySelector('main').scrollTop),
    viewportH: window.innerHeight, scrollMax: document.querySelector('main').scrollHeight,
  })
  return 'installed'
})()`

const NAV = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  location.hash = '#/changelog'
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    const h = document.querySelector('main h1')
    if (h && h.textContent.includes('版本新增')) break
    await sleep(25)
  }
  return true
})()`

// 标记 + 跳转到页面中段 + arm（同一个同步块，中间不给加载机会）
const JUMP = `(() => {
  const main = document.querySelector('main')
  const mark = window.__priMark()
  const roots = [...document.querySelectorAll('[data-version]')]
  const target = roots[Math.floor(roots.length * 0.55)]
  if (!target) return { ok: false }
  const y = target.getBoundingClientRect().top + main.scrollTop - 80
  main.scrollTop = y
  const arm = window.__priArm()
  return { ok: true, targetVersion: target.getAttribute('data-version'), versions: roots.length, mark, arm }
})()`

// 标记 + 分步向下滚动
const STEPS = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const main = document.querySelector('main')
  const mark = window.__priMark()
  const armStart = window.__priArm()
  const samples = []
  const domImg = () => [...document.querySelectorAll('[data-version] img')].filter(i => i.getAttribute('src')).length
  for (let i = 0; i < 20; i++) {
    main.scrollTop += 220
    await sleep(70)
    samples.push({ i, st: Math.round(main.scrollTop), ev: window.__pri.events.length, domImg: domImg() })
  }
  await sleep(1500)
  return { ok: true, mark, armStart, samples, domImgAfter: domImg(), armed: window.__pri.armed,
           sameMain: main === document.querySelector('main') }
})()`

// 材料页：静置 8s 后统计已加载的卡片图分别落在可视区 / 预加载带 / 带外，
// 同时记录每张图「上屏那一刻」卡片所在的位置（区分「真的提前加载」与「布局变高后被推远」）
const MATERIALS = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const main = document.querySelector('main')
  const ih = window.innerHeight
  const log = []
  const mo = new MutationObserver(muts => {
    for (const m of muts) {
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue
        const imgs = n.tagName === 'IMG' ? [n] : (n.querySelectorAll ? [...n.querySelectorAll('img')] : [])
        for (const img of imgs) {
          const card = img.closest('[data-item-id]')
          if (!card) continue
          const r = card.getBoundingClientRect()
          log.push({ t: Math.round(performance.now()), top: Math.round(r.top),
                     inView: r.bottom > 0 && r.top < ih, inBand: r.bottom > -800 && r.top < ih + 800 })
        }
      }
    }
  })
  mo.observe(main, { childList: true, subtree: true })
  await sleep(8000)
  mo.disconnect()
  const cards = [...document.querySelectorAll('[data-item-id]')]
  const loaded = cards.filter(c => c.querySelector('img[src]'))
  const buckets = { inView: 0, above: 0, below: 0, outside: 0 }
  for (const c of loaded) {
    const r = c.getBoundingClientRect()
    if (r.bottom > 0 && r.top < ih) buckets.inView++
    else if (r.bottom <= 0) buckets.above++
    else if (r.top < ih + 800) buckets.below++
    else buckets.outside++
  }
  const atLoad = { inView: 0, band: 0, outside: 0 }
  for (const e of log) { if (e.inView) atLoad.inView++; else if (e.inBand) atLoad.band++; else atLoad.outside++ }
  const bySecond = {}
  for (const e of log) { const k = Math.floor(e.t / 1000); bySecond[k] = bySecond[k] || { n: 0, out: 0 }; bySecond[k].n++; if (!e.inBand) bySecond[k].out++ }
  return { ok: true, totalCards: cards.length, loaded: loaded.length, buckets,
           atLoad, events: log.length, bySecond, mainTop: Math.round(main.getBoundingClientRect().top),
           mainH: main.clientHeight, firstOutside: log.filter(e => !e.inBand).slice(0, 5),
           scrollTop: Math.round(main.scrollTop), scrollHeight: main.scrollHeight, viewportH: ih }
})()`

// 标记 + 展开视口内最下方一个折叠版本
const EXPAND = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const roots = [...document.querySelectorAll('[data-version]')]
  const vis = roots.filter(r => { const b = r.getBoundingClientRect(); return b.top > 40 && b.top < window.innerHeight * 0.7 })
  const target = vis[vis.length - 1] || roots[2]
  if (!target) return { ok: false }
  const mark = window.__priMark()
  const header = target.querySelector('[role="button"]')
  if (!header) return { ok: false, why: 'no header' }
  header.click()
  const arm = window.__priArm()
  return { ok: true, v: target.getAttribute('data-version'), mark, arm }
})()`

function analyse(rep) {
  const items = new Map(rep.items.map(i => [i.key, i]))
  const firstAt = new Map()
  for (const e of rep.events) if (!firstAt.has(e.key)) firstAt.set(e.key, e.t)
  // 以 arm 时刻的可视状态分类（跳转场景）
  const pending = rep.items.filter(i => !i.loaded && i.stillThere !== false)
  const inViewP = pending.filter(i => i.inViewAfter)
  const offP = pending.filter(i => !i.inViewAfter)
  const tOf = i => (firstAt.has(i.key) ? firstAt.get(i.key) : null)
  const vT = inViewP.map(tOf).filter(t => t !== null)
  const oT = offP.map(tOf).filter(t => t !== null)
  const viewportLast = vT.length ? Math.max(...vT) : null
  // 渲染进程内存缓存命中（另一个元素已经取过同一张图）会瞬间 resolve，
  // 不占用 IPC / 队列，统计「加载顺序」时应当排除
  const INSTANT_MS = 8
  const loadedEvents = rep.events.filter(e => firstAt.get(e.key) === e.t)
  const realEvents = loadedEvents.filter(e => e.t > INSTANT_MS)
  const realOffscreen = realEvents.filter(e => { const it = items.get(e.key); return it && it.inViewAfter === false })
  return {
    pendingInView: inViewP.length,
    pendingOffscreen: offP.length,
    inViewLoaded: vT.length,
    offscreenLoaded: oT.length,
    inViewMissing: inViewP.filter(i => tOf(i) === null).map(i => i.key).slice(0, 20),
    hiddenLoaded: loadedEvents.filter(e => { const it = items.get(e.key); return it && it.hiddenAtMark }).length,
    instantCacheHits: loadedEvents.filter(e => e.t <= INSTANT_MS).length,
    viewportFirstMs: vT.length ? Math.min(...vT) : null,
    viewportLastMs: viewportLast,
    offscreenFirstMs: oT.length ? Math.min(...oT) : null,
    // 排除瞬间缓存命中后：视口外的真实加载里，有多少张抢在最后一张可视区图片之前
    violations: viewportLast === null ? null : realOffscreen.filter(e => e.t < viewportLast).length,
    // 只比同类元素（卡片缩略图 256px）：背景壁纸是 2048px、单张就要 1s+，混在一起
    // 会把「顺序」问题淹没在「耗时」差异里
    cardViolations: (() => {
      const isCard = k => (items.get(k) || {}).kind === 'card'
      const lastViewCard = inViewP.filter(i => isCard(i.key)).map(tOf).filter(t => t !== null)
      const last = lastViewCard.length ? Math.max(...lastViewCard) : null
      if (last === null) return null
      return realEvents.filter(e => isCard(e.key) && items.get(e.key).inViewAfter === false && e.t < last).length
    })(),
    realOffscreenLoaded: realOffscreen.length,
    offscreenEventsWhilePending: rep.events.filter(e => { const it = items.get(e.key); return it && it.inViewAfter === false }).length,
    inViewEvents: rep.events.filter(e => { const it = items.get(e.key); return it && it.inViewAfter === true }).length,
    order: rep.events.slice(0, 30).map(e => { const it = items.get(e.key) || {}; return { t: e.t, key: e.key, v: e.v, inViewAfter: it.inViewAfter, inViewNow: e.inView, kind: e.kind, topAfter: it.topAfter } }),
    // 事件在文档中的位置分布：视口上方 / 视口内 / 视口下方
    bands: (() => {
      const out = { above: 0, inViewport: 0, below: 0 }
      const seen = new Set()
      for (const e of rep.events) {
        if (seen.has(e.key)) continue
        seen.add(e.key)
        const it = items.get(e.key); if (!it) continue
        if (it.inViewAfter) out.inViewport++
        else if ((it.topAfter || 0) < 0) out.above++
        else out.below++
      }
      return out
    })(),
    firstLoadTimesByBand: (() => {
      const seen = new Map()
      for (const e of rep.events) { const it = items.get(e.key); if (!it || seen.has(e.key)) continue
        seen.set(e.key, it.inViewAfter ? 'inViewport' : ((it.topAfter || 0) < 0 ? 'above' : 'below')) }
      const acc = {}
      for (const [k, band] of seen) {
        const e = rep.events.find(x => x.key === k)
        if (!acc[band]) acc[band] = { n: 0, firstMs: e.t, lastMs: e.t }
        acc[band].n++; acc[band].firstMs = Math.min(acc[band].firstMs, e.t); acc[band].lastMs = Math.max(acc[band].lastMs, e.t)
      }
      return acc
    })(),
  }
}

Object.defineProperty(app, 'isPackaged', { value: true, configurable: true })
process.env.SILVERMOON_DISABLE_DEVTOOLS = '1'

// 窗口不可见 / 被遮挡时 Chromium 会暂停渲染帧，rAF 与 IntersectionObserver 都不再
// 触发，测出来就是「一张图都不加载」的假象 —— 关掉所有后台节流并显式 show 窗口。
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.commandLine.appendSwitch('disable-renderer-backgrounding')

let started = false
app.on('browser-window-created', (_e, win) => {
  if (started) return
  win.webContents.once('did-finish-load', async () => {
    if (started) return
    started = true
    const out = { scenario, settleMs }
    try {
      out.ipcProbe = installIpcProbe()
      win.show()
      win.setBounds({ x: 60, y: 60, width: 1400, height: 900 })
      win.focus()
      await exec(win, `new Promise(r => { const t = setInterval(() => { if (window.electronAPI && document.querySelector('#root')) { clearInterval(t); r(true) } }, 50) })`)
      await wait(2500)
      await exec(win, `(location.hash = '#/data') && true`)
      await wait(1200)
      const ipcAtNav = ipc.log.length
      if (scenario === 'materials' && argOf('warm', '') === '1') {
        await exec(win, NAV)
        await wait(2500)
        await exec(win, `(async () => {
          const sleep = ms => new Promise(r => setTimeout(r, ms))
          const main = document.querySelector('main')
          const max = Math.max(0, main.scrollHeight - main.clientHeight)
          for (let i = 1; i <= 30; i++) { main.scrollTop = Math.round(max * i / 30); await sleep(50) }
          await sleep(250)
          return true
        })()`)
      }
      if (scenario === 'materials') {
        await exec(win, `(location.hash = '#/materials') && true`)
        await exec(win, `(async () => { const d = Date.now() + 30000; while (Date.now() < d) { const h = document.querySelector('main h1'); if (h && h.textContent.includes('材料')) break; await new Promise(r => setTimeout(r, 25)) } return true })()`)
      } else {
        await exec(win, NAV)
      }
      await wait(settleMs)
      out.mount = { ipcCalls: ipc.log.length - ipcAtNav }
      out.install = await exec(win, INSTALL)
      out.start = await exec(win, `window.__priStart()`)
      const action = scenario === 'steps' ? STEPS : scenario === 'expand' ? EXPAND
        : scenario === 'materials' ? MATERIALS : JUMP
      const ipcBefore = ipc.log.length
      out.action = await exec(win, action)
      await wait(observeMs)
      const rep = await exec(win, `window.__priReport()`)
      out.analysis = scenario === 'materials' ? null : analyse(rep)
      if (argOf('dump', '') === '1') out.report = rep
      out.ipcAfterAction = ipc.log.slice(ipcBefore).map(l => ({ f: l.f, w: l.w, kb: l.kb, ms: l.ms }))
      out.ok = true
    } catch (e) {
      out.ok = false
      out.error = String(e && e.stack || e)
    }
    finish(out, out.ok ? 0 : 1)
  })
})
setTimeout(() => finish({ ok: false, error: 'timeout' }, 1), 300000)
require(path.join(PROJECT_ROOT, 'electron', 'main.js'))

#!/usr/bin/env electron
/**
 * 回归测试 — 列表页返回时的滚轮位置恢复。
 *
 * 场景（对应真实反馈）：
 *   1) 角色 / 武器：滚到最底 → 打开任意条目 →「返回列表」→ 位置应精确回到最底
 *   2) 材料：滚到中部 → 打开条目 →「返回列表」→ 位置应精确回到原处
 *   3) 材料：滚到最底 → 打开条目 →「上一步」→ 不应回到顶端
 *   4) 武器：用「上一步」返回也应精确恢复
 *
 * 判定标准（与实现无关，只看用户能看到的东西）：
 *   - 恢复后的 scrollTop 与离开前一致（容差 8px）
 *   - 视口内第一张卡片的 id 与偏移一致
 *   - “是否贴底”的状态一致
 *
 * Run: env -u ELECTRON_RUN_AS_NODE electron scripts/test-scroll-restore.cjs
 */
const { app } = require('electron')
const fs = require('fs')
const os = require('os')
const path = require('path')

const PROJECT_ROOT = path.resolve(__dirname, '..')
const REAL_DATA = '/Users/stargomia/Files/GenshinWikiData'
// 磁盘安全：见 scripts/lib/sandbox.cjs 顶部的事故说明
const { cloneTree, sweepLeftovers, makeCleanup, installCleanupHook, guardSandboxSize, volumeFreeBytes } =
  require('./lib/sandbox.cjs')
sweepLeftovers(['silvermoon-scroll-test-'])
const freeBeforeClone = volumeFreeBytes(os.tmpdir())   // tmpRoot 尚未创建，取 TMPDIR 所在卷

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'silvermoon-scroll-test-'))
const profileDir = path.join(tmpRoot, 'profile')
const dataDir = path.join(tmpRoot, 'data')
fs.mkdirSync(profileDir, { recursive: true })
fs.mkdirSync(dataDir, { recursive: true })
// 隔离副本：不触碰用户真实数据
for (const f of ['silvermoon_terminal.db', 'user.db', 'user.json']) {
  const src = path.join(REAL_DATA, f)
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dataDir, f))
}
for (const entry of fs.readdirSync(REAL_DATA)) {
  if (!entry.startsWith('images-')) continue
  const src = path.join(REAL_DATA, entry)
  if (!fs.statSync(src).isDirectory()) continue
  cloneTree(src, path.join(dataDir, entry))
}
fs.writeFileSync(path.join(profileDir, 'config.json'),
  JSON.stringify({ dbDir: dataDir, activeBaseDb: 'silvermoon_terminal.db' }, null, 2))
guardSandboxSize(tmpRoot, { freeBefore: freeBeforeClone, label: 'test-scroll-restore.cjs' })   // 克隆退化会真占盘，这里立刻告警
app.setPath('userData', profileDir)
Object.defineProperty(app, 'isPackaged', { value: true, configurable: true })
process.env.SILVERMOON_DISABLE_DEVTOOLS = '1'

let finished = false
const cleanup = makeCleanup(tmpRoot)
installCleanupHook(cleanup)   // app.exit() 不触发 'exit'，必须劫持
process.once('exit', cleanup)
function finish(payload, code) {
  if (finished) return
  finished = true
  try { fs.writeSync(1, `\n===SCROLL-RESTORE===\n${JSON.stringify(payload, null, 2)}\n`) } catch (_) {}
  process.exitCode = code
  setTimeout(() => { try { app.exit(code) } catch (_) { process.exit(code) } }, 200)
}

let currentPageKey = 'weapons'
const rendererErrors = []
const wait = ms => new Promise(r => setTimeout(r, ms))
const exec = (win, code) => win.webContents.executeJavaScript(code, true)
async function waitFor(win, expr, label, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try { if (await exec(win, expr)) return true } catch (_) {}
    await wait(60)
  }
  throw new Error(`timeout waiting for ${label}`)
}

const makeSnap = (sel) => `(() => {
  const main = document.querySelector('main')
  if (!main) return null
  const mr = main.getBoundingClientRect()
  const mainTop = mr.top, mainBottom = mr.bottom
  const cards = [...document.querySelectorAll(${JSON.stringify(sel)})].map(el => {
    const r = el.getBoundingClientRect()
    return { id: el.getAttribute('data-item-id'), top: r.top, bottom: r.bottom, el }
  })
  const visible = cards.filter(c => c.bottom > mainTop + 1 && c.top < mainBottom - 1)
  const last = cards.length ? cards[cards.length - 1] : null
  const lastRect = last ? last.el.getBoundingClientRect() : null
  return {
    hash: location.hash,
    // 页面是否真的可见（恢复期间页面是 opacity-0，若卡住就是"纯黑无内容"）
    pageOpacity: (() => {
      const root = main.firstElementChild
      if (!root) return null
      const cs = getComputedStyle(root)
      return { opacity: cs.opacity, visibility: cs.visibility, textLen: (root.innerText || '').length }
    })(),
    scrollTop: Math.round(main.scrollTop),
    scrollHeight: main.scrollHeight,
    clientHeight: main.clientHeight,
    maxScroll: main.scrollHeight - main.clientHeight,
    atBottom: main.scrollHeight - main.clientHeight > 0
      && main.scrollTop >= main.scrollHeight - main.clientHeight - 2,
    count: cards.length,
    anchorId: visible.length ? visible[0].id : null,
    anchorOffset: visible.length ? Math.round(visible[0].top - mainTop) : null,
    visibleIds: visible.map(c => c.id),
    // 最后一行是否真的渲染出来了（content-visibility 占位时会明显矮一截）
    lastCardId: last ? last.id : null,
    lastCardHeight: lastRect ? Math.round(lastRect.height) : null,
    lastBottomInViewport: last ? Math.round(last.bottom - mainTop) : null,
  }
})()`
const SNAP = makeSnap('[data-item-id]')

/** 等滚动位置稳定下来（连续多次采样不变），再看最终结果 */
async function waitScrollSettled(win, sel, opts = {}) {
  const { samples = 6, gap = 200, timeoutMs = 9000 } = opts
  const read = `(() => { const m = document.querySelector('main'); return m ? Math.round(m.scrollTop) : -1 })()`
  const deadline = Date.now() + timeoutMs
  let last = -1, same = 0
  while (Date.now() < deadline) {
    const y = await exec(win, read)
    if (y === last) { same++; if (same >= samples) return y } else { same = 0 }
    last = y
    await wait(gap)
  }
  return last
}

/** 等页面高度连续稳定（内容/图片/lazy 渲染都停下来） */
async function settle(win, opts = {}) {
  const { rounds = 12, gap = 260, quiet = 3 } = opts
  let stable = 0, last = -1
  for (let i = 0; i < rounds; i++) {
    const h = await exec(win, `document.querySelector('main') ? document.querySelector('main').scrollHeight : 0`)
    if (h === last && h > 0) { stable++; if (stable >= quiet) return h } else { stable = 0 }
    last = h
    await wait(gap)
  }
  return last
}

async function scrollToBottom(win) {
  for (let i = 0; i < 8; i++) {
    await exec(win, `(() => { const m = document.querySelector('main'); m.scrollTop = m.scrollHeight })()`)
    await wait(280)
    const at = await exec(win, `(() => { const m = document.querySelector('main'); return Math.abs(m.scrollTop - (m.scrollHeight - m.clientHeight)) < 2 })()`)
    if (at) break
  }
  await settle(win)
}

const PAGES = {
  weapons: { label: '武器', hash: '#/weapons', detailPrefix: '#/weapons/', sel: '[data-item-id]', ready: `location.hash.startsWith('#/weapons') && document.querySelectorAll('[data-item-id]').length > 0` },
  characters: { label: '角色', hash: '#/characters', detailPrefix: '#/characters/', sel: '[data-item-id]', ready: `location.hash.startsWith('#/characters') && document.querySelectorAll('[data-item-id]').length > 0` },
  materials: { label: '材料', hash: '#/materials', detailPrefix: '#/materials/', sel: '[data-item-id]', ready: `location.hash.startsWith('#/materials') && document.querySelectorAll('[data-item-id]').length > 0` },
  artifacts: { label: '圣遗物', hash: '#/artifacts', detailPrefix: '#/artifacts/', sel: '[data-item-id]', ready: `location.hash.startsWith('#/artifacts') && document.querySelectorAll('[data-item-id]').length > 0` },
  // 挑战/设置没有条目锚点，走"像素位置 + 收敛循环"退化路径；快照只取整页根节点
  challenges: { label: '挑战', hash: '#/challenges', sel: 'main > div', ready: `location.hash.startsWith('#/challenges') && document.querySelector('main').innerText.length > 400` },
  settings: { label: '设置', hash: '#/settings?module=advanced', sel: 'main > div', ready: `location.hash.startsWith('#/settings') && document.querySelector('main').innerText.length > 300` },
  // 数据页的列表是**内层**滚动容器（不是 <main>），单独处理
  gamedata: { label: '数据', hash: '#/data', sel: '[data-item-id]', inner: true, ready: `location.hash.startsWith('#/data') && document.querySelectorAll('[data-item-id]').length > 0` },
  // 版本块用 data-version 当锚点
  changelog: { label: '更新日志', hash: '#/changelog', sel: '[data-version]', ready: `location.hash.startsWith('#/changelog') && document.querySelectorAll('[data-version]').length > 0` },
}
const ITEM_SELECTORS = PAGES
let viaCounter = 0
/** 离开当前页时用一个没出现过的路径，避免落进导航栈里已有的条目（那会变成"后退"） */
function uniqueVia() { viaCounter++; return `#/websites?t=${viaCounter}` }

async function gotoList(win, key, via = uniqueVia()) {
  const cfg = PAGES[key]
  // 先离开该页再回来，避免"已经在列表页"导致不触发挂载
  await exec(win, `location.hash = ${JSON.stringify(via)}`)
  await wait(500)
  await exec(win, `location.hash = ${JSON.stringify(cfg.hash)}`)
  await waitFor(win, cfg.ready, `${key} entries`)
  await settle(win)
}

/** 打开当前视口内最后一张卡片，返回其 id */
async function openBottomCard(win, key) {
  const id = await exec(win, `(() => {
    const main = document.querySelector('main')
    const mr = main.getBoundingClientRect()
    const cards = [...document.querySelectorAll('[data-item-id]')]
    const vis = cards.filter(el => { const r = el.getBoundingClientRect(); return r.bottom > mr.top + 4 && r.top < mr.bottom - 4 })
    const target = vis[vis.length - 1] || cards[cards.length - 1]
    if (!target) return null
    target.click()
    return target.getAttribute('data-item-id')
  })()`)
  if (!id) throw new Error('no card to click')
  const prefix = PAGES[key].detailPrefix
  await waitFor(win, `location.hash.startsWith(${JSON.stringify(prefix)})`, `${key} detail page`)
  await settle(win)
  return id
}

/** 返回列表：mode = 'backToList'（详情页「返回列表」按钮）| 'stepBack'（上一步）| 'browserBack' */
async function goBackFromDetail(win, mode, pageKey) {
  if (pageKey) currentPageKey = pageKey
  if (mode === 'stepBack') {
    const ok = await exec(win, `(() => { const b = document.querySelector('[title="上一步"]'); if (!b) return false; b.click(); return true })()`)
    if (!ok) throw new Error('上一步 button not found')
  } else if (mode === 'browserBack') {
    await exec(win, `history.back()`)
  } else {
    await waitFor(win, `[...document.querySelectorAll('button')].some(b => /返回.*列表/.test((b.textContent || '').trim()))`, '返回列表 button', 15000)
    const ok = await exec(win, `(() => {
      const btn = [...document.querySelectorAll('button')].find(b => /返回.*列表/.test((b.textContent || '').trim()))
      if (!btn) return false
      btn.click(); return true
    })()`)
    if (!ok) throw new Error('返回列表 button not found')
  }
  await waitFor(win, PAGES[currentPageKey].ready, 'list entries back')
  await wait(900)
  await settle(win, { rounds: 16 })
  try {
    const flag = await exec(win, `sessionStorage.getItem('_nav_restore_scroll')`)
    if (flag === '1') console.log(`[diag] 返回后标记仍未被消费（page=${currentPageKey}）`)
  } catch (_) {}
}

// 判定"用户看到的是不是同一处内容"：
//   - 视口内第一条内容（锚点）必须是同一条，且落在同一像素位置
//   - 最后一行必须被真正渲染（占位高度会把最后一行压扁，等于"没回来"）
//   - 贴底状态必须保持
// 不比较绝对 scrollTop：带 content-visibility 的页面里，视口外内容按占位高度
// 参与布局，同一处内容的绝对像素值在重新挂载后本来就会变，用户看不到那个差异。
function diff(a, b, tolerance = 4) {
  const problems = []
  if (a == null || b == null) { problems.push('missing snapshot'); return problems }
  if (a.anchorId !== b.anchorId) {
    problems.push(`视口首条 ${a.anchorId} → ${b.anchorId}`)
  } else if (a.anchorOffset != null && Math.abs(a.anchorOffset - b.anchorOffset) > tolerance) {
    problems.push(`首条位置 ${a.anchorOffset}px → ${b.anchorOffset}px`)
  }
  if (a.atBottom !== b.atBottom) problems.push(`贴着底部: ${a.atBottom} → ${b.atBottom}`)
  if (a.lastCardId !== b.lastCardId) problems.push(`末条 ${a.lastCardId} → ${b.lastCardId}`)
  else if (a.lastCardHeight != null && Math.abs(a.lastCardHeight - b.lastCardHeight) > tolerance) {
    problems.push(`末条高度 ${a.lastCardHeight} → ${b.lastCardHeight}（末行未真正渲染）`)
  }
  if (a.count !== b.count) problems.push(`条目数 ${a.count} → ${b.count}`)
  // 返回后页面必须可见：卡在 opacity-0 就是用户看到的"纯黑无内容"
  if (b.pageOpacity && (b.pageOpacity.opacity === '0' || b.pageOpacity.visibility === 'hidden')) {
    problems.push(`页面不可见（opacity=${b.pageOpacity.opacity}, visibility=${b.pageOpacity.visibility}, 文本长度=${b.pageOpacity.textLen}）`)
  }
  return problems
}

// 数据页的列表容器：同一时刻可能还有别的 overflow-auto（例如"离开页"尚未卸载），
// 取真正能滚动的那个
const INNER_SCRoller = "[...document.querySelectorAll('main div.overflow-auto')].find(e => e.scrollHeight > e.clientHeight + 50)"

async function scenarioInnerScroller(win, { key, position, leaveTo = uniqueVia() }) {
  const cfg = PAGES[key]
  const name = `${cfg.label} · ${position === 'bottom' ? '滚到底' : '滚到中部'} · 内层列表往返`
  const snapExpr = makeSnap(cfg.sel, INNER_SCRoller)
  await gotoList(win, key)
  // 「离开页」的 DOM 可能还没被替换掉，等内层列表真正属于数据页再操作
  await waitFor(win, `location.hash.startsWith('#/data') && !!(${INNER_SCRoller})`, '数据页内层列表', 15000)
  await wait(1500)
  for (let i = 0; i < 3; i++) {
    await exec(win, `(() => {
      const el = ${INNER_SCRoller}
      if (!el) return 0
      el.scrollTop = ${position === 'bottom' ? 'el.scrollHeight' : 'Math.round((el.scrollHeight - el.clientHeight) * 0.55)'}
      return el.scrollTop
    })()`)
    await wait(700)
    const y = await exec(win, `(() => { const el = ${INNER_SCRoller}; return el ? Math.round(el.scrollTop) : 0 })()`)
    if (y > 50) break
  }
  await settle(win)
  const before = await exec(win, snapExpr)
  if (!before || before.scrollTop < 50) throw new Error(`内层列表不可滚动（scrollTop=${before && before.scrollTop}）`)
  await exec(win, `location.hash = ${JSON.stringify(leaveTo)}`)
  await wait(900)
  await goBackFromDetail(win, 'stepBack', key)
  await wait(600)
  const after = await exec(win, snapExpr)
  const problems = diff(before, after)
  return { name, before, after, problems, pass: problems.length === 0 }
}

async function setPosition(win, position) {
  if (position === 'bottom') { await scrollToBottom(win); return }
  await exec(win, `(() => { const m = document.querySelector('main'); m.scrollTop = Math.round((m.scrollHeight - m.clientHeight) * 0.55) })()`)
  await settle(win)
}

/** 列表 ↔ 详情：打开一条再返回 */
async function scenario(win, { key, position, back }) {
  const cfg = PAGES[key]
  const name = `${cfg.label} · ${position === 'bottom' ? '滚到底' : '滚到中部'} · ${back}`
  const snapExpr = makeSnap(cfg.sel)
  await gotoList(win, key)
  await setPosition(win, position)
  const before = await exec(win, snapExpr)
  const openedId = await openBottomCard(win, key)
  await goBackFromDetail(win, back, key)
  await waitScrollSettled(win)
  const after = await exec(win, snapExpr)
  const problems = diff(before, after)
  const diag = await exec(win, `JSON.stringify({ flag: sessionStorage.getItem('_nav_restore_scroll'), hash: location.hash })`)
  return { name, openedId, before, after, problems, pass: problems.length === 0, diag }
}

/** 经由导航栈离开（侧栏式前进）后用「上一步」回来 */
async function scenarioViaStack(win, { key, position, leaveTo = uniqueVia() }) {
  const cfg = PAGES[key]
  const name = `${cfg.label} · ${position === 'bottom' ? '滚到底' : '滚到中部'} · 导航栈返回`
  const snapExpr = makeSnap(cfg.sel)
  await gotoList(win, key)
  await setPosition(win, position)
  const before = await exec(win, snapExpr)
  await exec(win, `location.hash = ${JSON.stringify(leaveTo)}`)
  await wait(900)
  await goBackFromDetail(win, 'stepBack', key)
  await waitScrollSettled(win)
  const after = await exec(win, snapExpr)
  const problems = diff(before, after)
  const diag = await exec(win, `JSON.stringify({ flag: sessionStorage.getItem('_nav_restore_scroll'), hash: location.hash })`)
  return { name, before, after, problems, pass: problems.length === 0, diag }
}


/** 详情页自身的滚动记忆：打开 → 滚到中部 → 上一步 → 下一步 回来 */
async function scenarioDetailPage(win, { key = 'characters' } = {}) {
  const cfg = PAGES[key]
  const name = `${cfg.label}详情页 · 滚到中部 · 上一步/下一步往返`
  const snapExpr = makeSnap('main > div')
  await gotoList(win, key)
  const opened = await exec(win, `(() => {
    const main = document.querySelector('main')
    const mr = main.getBoundingClientRect()
    const el = [...document.querySelectorAll('[data-item-id]')].find(x => {
      const r = x.getBoundingClientRect(); return r.top > mr.top + 40 && r.bottom < mr.bottom - 4
    })
    if (!el) return null
    el.click(); return el.getAttribute('data-item-id')
  })()`)
  if (!opened) throw new Error('no card to open')
  await waitFor(win, `location.hash.startsWith(${JSON.stringify(cfg.detailPrefix)})`, 'detail page')
  await settle(win)
  await exec(win, `(() => { const m = document.querySelector('main'); m.scrollTop = Math.round((m.scrollHeight - m.clientHeight) * 0.6) })()`)
  await settle(win)
  const before = await exec(win, snapExpr)
  if (before.scrollTop < 100) throw new Error(`详情页不可滚动（scrollTop=${before.scrollTop}），场景无效`)
  await goBackFromDetail(win, 'stepBack', key)
  await exec(win, `document.querySelector('[title="下一步"]').click()`)
  await waitFor(win, `location.hash.startsWith(${JSON.stringify(cfg.detailPrefix)})`, 'detail page again')
  await settle(win, { rounds: 16 })
  const after = await exec(win, snapExpr)
  const problems = []
  if (Math.abs(after.scrollTop - before.scrollTop) > 8) {
    problems.push(`详情页 scrollTop ${before.scrollTop} → ${after.scrollTop}`)
  }
  return { name, openedId: opened, before, after, problems, pass: problems.length === 0 }
}

async function run(win) {
  await waitFor(win, `!!document.querySelector('main')`, 'react root')
  await wait(1500)
  const scenarios = [
    { type: 'detail', key: 'weapons', position: 'bottom', back: 'backToList' },
    { type: 'detail', key: 'weapons', position: 'middle', back: 'backToList' },
    { type: 'detail', key: 'weapons', position: 'bottom', back: 'stepBack' },
    { type: 'detail', key: 'characters', position: 'bottom', back: 'backToList' },
    { type: 'detail', key: 'characters', position: 'middle', back: 'stepBack' },
    { type: 'detail', key: 'materials', position: 'bottom', back: 'backToList' },
    { type: 'detail', key: 'materials', position: 'bottom', back: 'stepBack' },
    { type: 'detail', key: 'materials', position: 'middle', back: 'backToList' },
    { type: 'detail', key: 'artifacts', position: 'bottom', back: 'backToList' },
    // 其它板块：没有详情页，走"离开再上一步返回"
    { type: 'stack', key: 'challenges', position: 'middle' },
    { type: 'stack', key: 'challenges', position: 'bottom' },
    { type: 'stack', key: 'settings', position: 'middle' },
    { type: 'stack', key: 'settings', position: 'bottom' },
    { type: 'stack', key: 'changelog', position: 'middle' },
    { type: 'stack', key: 'changelog', position: 'bottom' },
    { type: 'detailpage', key: 'characters' },
    { type: 'detailpage', key: 'weapons' },
  ]
  const results = []
  for (const sc of scenarios) {
    try {
      const runner = sc.type === 'stack' ? scenarioViaStack
        : sc.type === 'detailpage' ? scenarioDetailPage
        : sc.type === 'inner' ? scenarioInnerScroller
        : scenario
      results.push(await runner(win, sc))
    } catch (e) {
      const cfg = PAGES[sc.key]
      results.push({ name: `${cfg.label} · ${sc.position}`, error: e.message, pass: false, problems: [e.message] })
    }
  }
  // 渲染进程报错（组件抛异常等）一律算失败：这类问题会让整页白屏，比位置偏差严重得多
  if (rendererErrors.length > 0) {
    results.push({
      name: '渲染进程无未捕获错误',
      pass: false,
      problems: rendererErrors.slice(0, 5),
    })
  }
  return { results, failed: results.filter(r => !r.pass).length }
}

let started = false
app.on('browser-window-created', (_e, win) => {
  if (started) return
  win.webContents.on('console-message', (_ev, level, message, line, source) => {
    if (level >= 3) rendererErrors.push(`${message} (${source}:${line})`)
    if (level >= 2) console.log(`[renderer:${level}] ${message} (${source}:${line})`)
  })
  win.webContents.on('render-process-gone', (_ev, details) => {
    console.log('[renderer gone]', JSON.stringify(details))
  })
  win.webContents.once('did-finish-load', async () => {
    if (started) return
    started = true
    try { finish({ ok: true, ...(await run(win)) }, 0) } catch (e) { finish({ ok: false, error: e.message }, 1) }
  })
})
setTimeout(() => finish({ ok: false, error: 'watchdog 300s' }, 1), 300000)
require(path.join(PROJECT_ROOT, 'electron', 'main.js'))

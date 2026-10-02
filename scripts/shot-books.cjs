#!/usr/bin/env electron
/**
 * 书籍板块视觉/几何核验 + 端到端落库演练。
 *
 * 1) 用真实爬取数据把 books / book_volumes 写满隔离库
 *    （直接注入 src/utils/bookCrawlSave.mjs 的浏览器构建，跑的是生产同一份落库逻辑）
 * 2) 截图画廊视图 / 多选 / 快捷阅读 / 插图 / 列表视图 / 筛选 / 详情页 / 阅读器 /
 *    图片观看器 / 查漏补缺弹窗
 * 3) 断言关键几何与文案，避免「能构建但页面空白/报错」
 *
 * 生产构建 + 隔离数据目录，输出截图到 .books-preview/。
 *   npm run shot:books                  首次：全量爬取并落库（约 1~2 分钟）
 *   npm run shot:books -- --skip-seed   复用上次落库，只调 UI
 *   npm run shot:books -- --reseed      强制重新爬取
 */
const fs = require('fs')
const os = require('os')
const path = require('path')

const { app } = require('electron')
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-gpu-compositing')
app.commandLine.appendSwitch('disable-software-rasterizer')
app.commandLine.appendSwitch('in-process-gpu')

const PROJECT_ROOT = path.resolve(__dirname, '..')
const REAL_DATA = '/Users/stargomia/Files/GenshinWikiData'
const OUT_DIR = path.join(PROJECT_ROOT, '.books-preview')
const PERSIST_ROOT = path.join(OUT_DIR, 'run')
fs.mkdirSync(OUT_DIR, { recursive: true })
// 数据目录放在工作区内并跨次保留：首次跑完一次全量落库后，后续只调 UI 时用
// --skip-seed 复用，不必每次重爬。
const RESEED = process.argv.includes('--reseed') || !fs.existsSync(path.join(PERSIST_ROOT, 'data', 'silvermoon_terminal.db'))
const SKIP_SEED = process.argv.includes('--skip-seed')
const tmpRoot = PERSIST_ROOT
const profileDir = path.join(tmpRoot, 'profile')
const dataDir = path.join(tmpRoot, 'data')
fs.mkdirSync(profileDir, { recursive: true })
fs.mkdirSync(dataDir, { recursive: true })
if (RESEED) {
  for (const f of ['silvermoon_terminal.db', 'user.db', 'user.json']) {
    const src = path.join(REAL_DATA, f)
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dataDir, f))
  }
  // 书籍封面与正文插图都是爬虫现下的（一百多张小图），这里只保证图包目录存在，
  // 不去硬链接 2GB 的完整图包
  fs.mkdirSync(path.join(dataDir, 'images-Medium'), { recursive: true })
}
fs.writeFileSync(path.join(profileDir, 'config.json'),
  JSON.stringify({ dbDir: dataDir, activeBaseDb: 'silvermoon_terminal.db' }, null, 2))
app.setPath('userData', profileDir)
Object.defineProperty(app, 'isPackaged', { value: true, configurable: true })
process.env.SILVERMOON_DISABLE_DEVTOOLS = '1'

let finished = false
function finish(payload, code) {
  if (finished) return
  finished = true
  try { fs.writeSync(1, `\n===SHOT-BOOKS===\n${JSON.stringify(payload, null, 2)}\n`) } catch (_) {}
  process.exitCode = code
  setTimeout(() => { try { app.exit(code) } catch (_) { process.exit(code) } }, 200)
}
const wait = ms => new Promise(r => setTimeout(r, ms))
const exec = (win, code) => win.webContents.executeJavaScript(code, true)
async function waitFor(win, expr, label, timeoutMs = 40000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try { if (await exec(win, expr)) return } catch (_) {}
    await wait(80)
  }
  throw new Error(`timeout waiting for ${label}`)
}
async function waitForImages(win, timeoutMs = 15000) {
  try {
    await Promise.race([
      exec(win, `new Promise(resolve => {
        const done = () => {
          const imgs = [...document.querySelectorAll('main img')]
          if (imgs.length === 0) return false
          return imgs.every(i => i.complete && i.naturalWidth > 0)
        }
        if (done()) return resolve('ready')
        const t0 = Date.now()
        const timer = setInterval(() => {
          if (done()) { clearInterval(timer); resolve('ready') }
          else if (Date.now() - t0 > ${timeoutMs - 500}) { clearInterval(timer); resolve('timeout') }
        }, 150)
      })`),
      wait(timeoutMs),
    ])
  } catch (_) {}
}
async function shot(win, file) {
  try { win.webContents.invalidate() } catch (_) {}
  await waitForImages(win)
  try {
    await Promise.race([
      exec(win, 'new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(1))))'),
      wait(1500),
    ])
  } catch (_) {}
  await wait(600)
  const img = await win.webContents.capturePage()
  fs.writeFileSync(file, img.toPNG())
  return file
}

const consoleErrors = []
async function run(win) {
  try { win.webContents.setBackgroundThrottling(false) } catch (_) {}
  win.webContents.on('console-message', (_e, level, message) => {
    // 开发构建下 Electron 一定会抱怨没有 CSP，这条不算应用错误
    if (level >= 2 && !message.includes('Electron Security Warning')) consoleErrors.push(message)
  })

  await waitFor(win, `!!document.querySelector('#root')`, 'react root')
  await exec(win, `location.hash = '#/books'`)
  await waitFor(win, `!!document.querySelector('main')`, 'main')
  await wait(1200)

  // ── 注入生产同款落库逻辑（esbuild 预打包的 IIFE）──
  const bundlePath = path.join(PROJECT_ROOT, 'scripts', '.bookCrawlSave.iife.js')
  if (!fs.existsSync(bundlePath)) throw new Error('缺少 scripts/.bookCrawlSave.iife.js（先跑 npm run build:book-save-bundle）')
  const bundle = fs.readFileSync(bundlePath, 'utf8')
  // 注意：bundle 里含反引号与 ${} 模板字面量，不能用模板字符串拼接注入
  const injected = await exec(win,
    '(() => { try { ' + bundle + '\n; window.__BookCrawlSave = BookCrawlSave; return "ok" } catch (e) { return "ERR:" + e.message } })()')
  if (injected !== 'ok') throw new Error('注入 bookCrawlSave 失败: ' + injected)

  // ── 全量落库（--skip-seed 时复用上次结果）──
  const seed = SKIP_SEED ? { ok: true, skipped: true } : await exec(win, `(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    const q = (sql, params) => window.electronAPI.dbQuery(sql, params)
    const { saveBookData, collectBookImageRequests } = window.__BookCrawlSave
    const miss = await window.electronAPI.checkMissingBooks()
    if (!miss || !miss.success) return { ok: false, error: miss && miss.error }
    const items = miss.items
    let done = 0, failed = 0, volumes = 0, bodies = 0, images = 0
    const errs = []
    for (let i = 0; i < items.length; i += 5) {
      const chunk = items.slice(i, i + 5)
      let res
      try { res = await window.electronAPI.crawlBooks(chunk.map(x => ({ name: x.name }))) } catch (e) { failed += chunk.length; errs.push(e.message); continue }
      if (!res || !res.success) { failed += chunk.length; errs.push(res && res.error); continue }
      // 与 useBookCrawler 同一顺序：先下载封面与插图拿到「图标名 → 真实文件名」，
      // 再用真实文件名写库（wiki 是 png、观测枢旧书是 jpg）
      const okResults = (res.results || []).filter(r => r && r.success)
      const reqs = okResults.flatMap(r => collectBookImageRequests(r.data))
      let imageNames = {}
      if (reqs.length) {
        try {
          const dl = await window.electronAPI.downloadBookImages(reqs)
          if (dl && dl.success && dl.files) imageNames = dl.files
        } catch (_) {}
      }
      for (let k = 0; k < chunk.length; k++) {
        const r = res.results[k]
        if (!r || !r.success) { failed++; errs.push((r && r.error) || 'x'); continue }
        try {
          const out = await saveBookData(q, r.data, { bookId: null, imageNames })
          done++
          volumes += out.volumeCount
          bodies += out.bodyCount
          images += (r.data.images || []).length
        } catch (e) { failed++; errs.push(e.message) }
      }
      await sleep(10)
    }
    return { ok: true, total: items.length, done, failed, volumes, bodies, images, errs: errs.slice(0, 5) }
  })()`)

  const seeded = await exec(win, `window.electronAPI.dbQuery("SELECT COUNT(*) AS c, (SELECT COUNT(*) FROM book_volumes) AS v, (SELECT SUM(CASE WHEN content IS NOT NULL AND content != '' THEN 1 ELSE 0 END) FROM book_volumes) AS b FROM books")`)
  const counts = (seeded.data || [])[0] || {}

  // 回到板块页，让列表重新加载
  await exec(win, `location.hash = '#/characters'`)
  await wait(400)
  await exec(win, `location.hash = '#/books'`)
  await waitFor(win, `document.querySelectorAll('[data-item-id]').length > 0`, 'book cards')
  await wait(1800)
  await waitForImages(win)

  const gallery = await exec(win, `(() => {
    const cards = [...document.querySelectorAll('[data-item-id]')]
    const r = el => { const b = el.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height) } }
    const barBtns = [...document.querySelectorAll('button')].map(b => b.textContent.trim())
    return { cards: cards.length, first: cards[0] ? r(cards[0]) : null,
             imgs: document.querySelectorAll('main img').length,
             header: (document.querySelector('h1') || {}).textContent,
             devbarHasBookCrawler: barBtns.some(t => t.includes('书籍爬虫')),
             devbarHasLeakCheck: barBtns.some(t => t.includes('查漏补缺')),
             firstCardTitle: cards[0] ? cards[0].getAttribute('title') : null }
  })()`)
  const shotGallery = await shot(win, path.join(OUT_DIR, 'books-gallery.png'))

  // ── 多选模式：选中项要广播给开发者工具栏的「书籍爬虫」──
  await exec(win, `(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('多选模式'))
    if (b) b.click()
  })()`)
  await wait(500)
  await exec(win, `(() => {
    const cards = [...document.querySelectorAll('[data-item-id]')].slice(0, 3)
    for (const c of cards) c.click()
    return cards.length
  })()`)
  await wait(700)
  const multi = await exec(win, `(() => {
    const bar = [...document.querySelectorAll('div')].find(d => (d.className || '').includes('bottom-16') && (d.textContent || '').includes('已选'))
    const crawlerBtn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('书籍爬虫'))
    return { barVisible: !!bar, text: bar ? bar.textContent : null,
             devbarBadge: crawlerBtn ? crawlerBtn.textContent.trim() : null }
  })()`)
  const shotMulti = await shot(win, path.join(OUT_DIR, 'books-multiselect.png'))
  await exec(win, `(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('退出多选')); if (b) b.click() })()`)
  await wait(400)

  // ── 右键「开始阅读」：应就地弹出阅读器，**不跳详情页** ──
  const quickRead = await exec(win, `(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    location.hash = '#/books'
    await sleep(1200)
    // 前面的用例可能把视图切成了列表，统一切回画廊再验证卡片右键
    const gal = document.querySelector('button[title="画廊视图"]')
    if (gal) gal.click()
    await sleep(1200)
    const cards = [...document.querySelectorAll('[data-item-id]')]
    if (cards.length === 0) return { ok: false, reason: '列表没有卡片' }
    // 挑一本多卷的（标题里带「N 卷」角标），单卷书看不出阅读器目录
    const card = cards.find(c => /\\d+ 卷/.test(c.title || '')) || cards[0]
    const id = card.getAttribute('data-item-id')
    const r = await window.electronAPI.dbQuery('SELECT name_zh FROM books WHERE id = ?', [Number(id)])
    const name = (r.data && r.data[0] && r.data[0].name_zh) || ''
    card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 320, clientY: 320 }))
    await sleep(400)
    const item = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '开始阅读')
    if (!item) return { ok: false, reason: '右键菜单里没有「开始阅读」' }
    item.click()
    await sleep(1400)
    const overlay = [...document.querySelectorAll('div')].find(d => (d.className || '').toString().includes('z-[250]'))
    const counter = overlay ? (overlay.innerText.match(/(\\d+)\\s*\\/\\s*(\\d+)/) || []) : []
    return { ok: !!overlay, cardId: id, cardName: name, hash: location.hash,
             title: overlay ? overlay.innerText.split('\\n')[0] : null,
             chapters: counter[2] ? Number(counter[2]) : null }
  })()`)
  const shotQuickRead = await shot(win, path.join(OUT_DIR, 'books-quickread.png'))
  await exec(win, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await wait(600)

  // ── 插图：《出发吧！嘟嘟可》三张插图必须在阅读器里真的渲染出来 ──
  const illustrated = await exec(win, `(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    const q = (sql, p) => window.electronAPI.dbQuery(sql, p)
    const r = await q('SELECT id FROM books WHERE name_zh = ?', ['出发吧！嘟嘟可'])
    const id = r.data && r.data[0] && r.data[0].id
    if (!id) return { ok: false, reason: '库里没有《出发吧！嘟嘟可》' }
    location.hash = '#/books/' + id
    await sleep(2000)
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '阅读')
    if (!btn) return { ok: false, reason: '详情页没有阅读按钮' }
    btn.click()
    await sleep(2500)
    const overlay = [...document.querySelectorAll('div')].find(d => (d.className || '').toString().includes('z-[250]'))
    if (!overlay) return { ok: false, reason: '阅读器未打开' }
    // 插图走懒加载：反复把正文滚一遍并轮询，直到三张图都解码完成（或超时）。
    // 注意：左侧目录列表也是 overflow-y-auto，必须挑「装着图片的那个」滚动容器
    const scrollers = [...overlay.querySelectorAll('div')]
      .filter(d => (d.className || '').toString().includes('overflow-y-auto'))
    const scroller = scrollers.find(d => d.querySelector('img')) || scrollers[scrollers.length - 1]
    const deadline = Date.now() + 20000
    let round = 0
    let loaded = []
    while (Date.now() < deadline) {
      if (scroller) {
        const step = Math.max(200, Math.floor(scroller.clientHeight * 0.7))
        scroller.scrollTop = (round % 20) * step
      }
      await sleep(400)
      loaded = [...overlay.querySelectorAll('img')].filter(i => i.complete && i.naturalWidth > 0)
      if (loaded.length >= 3) break
      round++
    }
    if (scroller) scroller.scrollTop = 0
    await sleep(400)
    const imgs = [...overlay.querySelectorAll('img')]
    const text = overlay.innerText
    return { ok: true, imgCount: imgs.length, loaded: loaded.length, rounds: round,
             sizes: loaded.map(i => i.naturalWidth + 'x' + i.naturalHeight),
             markers: (text.match(/\\[img:/g) || []).length,
             placeholders: [...text.matchAll(/插图加载(中|失败)[：:][^\\n]*/g)].map(m => m[0]).slice(0, 3),
             stuck: text.includes('插图加载中') || text.includes('插图加载失败') }
  })()`)
  const shotIllustration = await shot(win, path.join(OUT_DIR, 'books-illustration.png'))

  // ── 点开插图：应交给通用图片观看器（Lightbox），Esc 只关观看器、阅读器留着 ──
  const viewer = await exec(win, `(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    const overlay = [...document.querySelectorAll('div')]
      .find(d => (d.className || '').toString().includes('z-[250]'))
    if (!overlay) return { ok: false, reason: '阅读器没开' }
    const isLightbox = (d) => (d.className || '').toString().includes('bg-black/80')
      && (d.className || '').toString().includes('backdrop-blur')
    const firstImg = [...overlay.querySelectorAll('img')].find(i => i.complete && i.naturalWidth > 0)
    if (!firstImg) return { ok: false, reason: '没有加载完成的插图' }
    firstImg.click()
    await sleep(1200)
    const lightbox = [...document.querySelectorAll('div')].find(d => isLightbox(d) && d.querySelector('img'))
    const stats = {
      ok: true,
      viewerOpened: !!lightbox,
      viewerZ: lightbox ? Number(getComputedStyle(lightbox).zIndex) : null,
      viewerHasZoomControls: lightbox
        ? [...lightbox.querySelectorAll('button')].some(b => (b.getAttribute('aria-label') || '') === '放大')
        : false,
      viewerCaption: lightbox ? (lightbox.innerText || '').trim().split('\\n')[0] : null,
    }
    return stats
  })()`)
  // 先截图（此时观看器开着），再验证 Esc 只关观看器
  const shotViewer = await shot(win, path.join(OUT_DIR, 'books-viewer.png'))
  const viewerEsc = await exec(win, `(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    const isLightbox = (d) => (d.className || '').toString().includes('bg-black/80')
      && (d.className || '').toString().includes('backdrop-blur')
    // 真实按键的事件目标是聚焦元素，窗口捕获监听才有机会先吞掉它——
    // 直接派发到 window 的话监听器按注册顺序触发，测不出「栈顶独吞」
    const target = (document.activeElement && document.activeElement !== document.body)
      ? document.activeElement : document.body
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await sleep(800)
    return {
      viewerClosedByEsc: ![...document.querySelectorAll('div')].some(d => isLightbox(d) && d.querySelector('img')),
      readerAliveAfterEsc: !![...document.querySelectorAll('div')]
        .find(d => (d.className || '').toString().includes('z-[250]')),
    }
  })()`)
  await exec(win, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await wait(700)

  // ── 列表视图 ──
  await exec(win, `location.hash = '#/books'`)
  await wait(1000)
  await exec(win, `(() => { const b = document.querySelector('button[title="列表视图"]'); if (b) b.click() })()`)
  await wait(1200)
  const table = await exec(win, `(() => {
    const rows = document.querySelectorAll('table tbody tr')
    const heads = [...document.querySelectorAll('table thead th')].map(t => t.innerText.trim()).filter(Boolean)
    return { rows: rows.length, heads, firstRow: rows[0] ? rows[0].innerText.replace(/\\n/g, ' | ') : null }
  })()`)
  const shotTable = await shot(win, path.join(OUT_DIR, 'books-table.png'))

  // ── 筛选：体裁 / 国家 / 实装版本下拉是否由数据汇总出来，选中后是否真的过滤 ──
  await exec(win, `(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim().startsWith('筛选')); if (b) b.click() })()`)
  await wait(700)
  const filterProbe = await exec(win, `(() => {
    const bar = [...document.querySelectorAll('div')].find(d => d.querySelector && d.querySelectorAll('select').length >= 2)
    const sels = bar ? [...bar.querySelectorAll('select')] : []
    return { selectCount: sels.length,
             info: sels.map(s => ({ options: s.options.length, sample: [...s.options].slice(1, 4).map(o => o.textContent) })) }
  })()`)
  const filterApplied = await exec(win, `(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    const before = document.querySelectorAll('table tbody tr').length
    const bar = [...document.querySelectorAll('div')].find(d => d.querySelector && d.querySelectorAll('select').length >= 2)
    const sels = bar ? [...bar.querySelectorAll('select')] : []
    // 体裁下拉 = 选项数最多的那个
    const target = sels.sort((a, b) => b.options.length - a.options.length)[0]
    if (!target || target.options.length < 2) return { ok: false, reason: '找不到体裁下拉' }
    const picked = target.options[1].value
    const label = target.options[1].textContent
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
    setter.call(target, picked)
    target.dispatchEvent(new Event('change', { bubbles: true }))
    await sleep(900)
    const after = document.querySelectorAll('table tbody tr').length
    return { ok: true, picked, label, before, after, filtered: after > 0 && after < before }
  })()`)
  const shotFilter = await shot(win, path.join(OUT_DIR, 'books-filter.png'))

  // 清掉筛选，恢复全量
  await exec(win, `(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '清除筛选' || x.textContent.trim() === '清空'); if (b) b.click() })()`)
  await wait(700)

  // ── 详情页：多卷书籍 ──
  const detail = await exec(win, `(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    const q = (sql, p) => window.electronAPI.dbQuery(sql, p)
    const r = await q("SELECT id FROM books WHERE name_zh = ?", ['野猪公主'])
    const id = r.data && r.data[0] && r.data[0].id
    if (!id) return { ok: false, reason: '库里没有《野猪公主》' }
    location.hash = '#/books/' + id
    await sleep(1800)
    const vols = [...document.querySelectorAll('div')].filter(d => (d.className || '').toString().includes('group flex items-start'))
    return {
      ok: true, id,
      header: (document.querySelector('h1') || {}).textContent,
      statsRow: [...document.querySelectorAll('span')].map(s => s.textContent).filter(t => /卷$/i.test(t || '')).slice(0, 4),
      volumeRows: vols.length,
      hasReaderButton: [...document.querySelectorAll('button')].some(b => b.textContent.trim() === '阅读'),
      noContentBadges: [...document.querySelectorAll('span')].filter(s => s.textContent === '无正文').length,
    }
  })()`)
  const shotDetail = await shot(win, path.join(OUT_DIR, 'books-detail.png'))

  // ── 阅读器：滚动模式 ──
  const reader = await exec(win, `(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '阅读')
    if (!b) return { ok: false, reason: '没有阅读按钮' }
    b.click()
    await sleep(1200)
    const overlay = [...document.querySelectorAll('div')].find(d => (d.className || '').toString().includes('z-[250]'))
    const chapters = overlay ? [...overlay.querySelectorAll('button')].filter(x => /\\d/.test(x.textContent || '')).length : 0
    const text = overlay ? overlay.innerText : ''
    return { ok: !!overlay, chapters, len: text.length,
             hasTitle: text.includes('野猪公主'),
             modeButtons: overlay ? [...overlay.querySelectorAll('button')].map(x => x.textContent.trim()).filter(t => t === '滚动' || t === '章节') : [],
             fontButtons: overlay ? [...overlay.querySelectorAll('button')].map(x => x.textContent.trim()).filter(t => ['小', '中', '大', '特大'].includes(t)) : [],
             bodySample: text.slice(0, 60) }
  })()`)
  const shotReaderScroll = await shot(win, path.join(OUT_DIR, 'books-reader-scroll.png'))

  // ── 阅读器：章节模式 + 翻页 ──
  const readerChapter = await exec(win, `(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    const overlay = [...document.querySelectorAll('div')].find(d => (d.className || '').toString().includes('z-[250]'))
    if (!overlay) return { ok: false, reason: '阅读器未打开' }
    const btn = [...overlay.querySelectorAll('button')].find(x => x.textContent.trim() === '章节')
    if (btn) btn.click()
    await sleep(900)
    const before = overlay.innerText.match(/(\\d+)\\s*\\/\\s*(\\d+)/)
    const next = [...overlay.querySelectorAll('button')].find(x => x.textContent.includes('下一章'))
    if (next) next.click()
    await sleep(900)
    const after = overlay.innerText.match(/(\\d+)\\s*\\/\\s*(\\d+)/)
    // 阅读进度记忆：localStorage 里应记下当前卷
    const keys = Object.keys(localStorage).filter(k => k.startsWith('reader_progress:'))
    const savedIdx = keys.length ? localStorage.getItem(keys[keys.length - 1]) : null
    return { ok: true, before: before && before[0], after: after && after[0],
             advanced: !!(before && after && before[1] !== after[1]),
             progressKey: keys[keys.length - 1] || null, savedIdx }
  })()`)
  const shotReaderChapter = await shot(win, path.join(OUT_DIR, 'books-reader-chapter.png'))

  // 关闭阅读器
  await exec(win, `(() => {
    const overlay = [...document.querySelectorAll('div')].find(d => (d.className || '').toString().includes('z-[250]'))
    if (overlay) {
      const x = [...overlay.querySelectorAll('button')].find(b => (b.title || '') === '关闭 (Esc)')
      if (x) x.click()
    }
  })()`)
  await wait(600)

  // ── 查漏补缺弹窗（已全量落库，应报告"数据已齐全"）──
  const leak = await exec(win, `(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('查漏补缺'))
    if (!b) return { ok: false, reason: '工具栏没有查漏补缺按钮' }
    b.click()
    // 这一步会现拉一次线上目录（wiki 2MB + 观测枢列表 + 文件地址），冷启动要几秒
    await sleep(9000)
    const modal = [...document.querySelectorAll('div')].find(d => (d.textContent || '').startsWith('书籍查漏补缺'))
    const text = modal ? modal.innerText : ''
    return { ok: !!modal, text: text.slice(0, 300),
             groups: ['未收录', '缺筛选元数据', '正文需修复', '缺正文', '缺封面或描述'].filter(g => text.includes(g)),
             complete: text.includes('书籍数据已齐全') }
  })()`)
  const shotLeak = await shot(win, path.join(OUT_DIR, 'books-leak.png'))
  await exec(win, `(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '取消'); if (b) b.click() })()`)
  await wait(400)

  // 图片扩展名：库里存的应当是真实格式（wiki 是 png / 观测枢旧书是 jpg）
  const extStat = await exec(win, `(async () => {
    const q = (sql, p) => window.electronAPI.dbQuery(sql, p)
    const r = await q("SELECT image FROM books WHERE image IS NOT NULL AND image != ''")
    const stat = {}
    for (const row of (r.data || [])) {
      const m = /\\.([a-z0-9]+)$/i.exec(row.image || '')
      const ext = m ? m[1].toLowerCase() : '(none)'
      stat[ext] = (stat[ext] || 0) + 1
    }
    const missing = await q("SELECT COUNT(*) AS c FROM books WHERE image IS NULL OR image = ''")
    const illus = await q("SELECT COUNT(*) AS c FROM book_volumes WHERE content LIKE '%[img:%'")
    const uniq = await q("SELECT COUNT(*) AS c FROM book_volumes WHERE content LIKE '%UNIQ--%'")
    return { total: (r.data || []).length, stat, missingImage: (missing.data || [{}])[0].c,
             volumesWithImages: (illus.data || [{}])[0].c, volumesWithArtifacts: (uniq.data || [{}])[0].c }
  })()`)

  finish({
    ok: seed && seed.ok && Number(counts.c) > 100 && gallery.cards > 0 && table.rows > 0
      && detail.ok && detail.volumeRows >= 6 && detail.hasReaderButton
      && reader.ok && reader.chapters >= 6
      && readerChapter.ok && readerChapter.advanced
      && gallery.devbarHasBookCrawler
      && multi.barVisible && /（?3）?/.test(multi.devbarBadge || '')
      && leak.ok && leak.complete
      && quickRead.ok && quickRead.hash === '#/books' && quickRead.title === quickRead.cardName
      // 三张插图必须真的解码出来（不是只剩占位符）
      && illustrated.ok && illustrated.loaded >= 3 && !illustrated.stuck && illustrated.markers === 0
      // 点图 → 通用观看器（层级要盖过阅读器），Esc 只关观看器
      && viewer.ok && viewer.viewerOpened && viewer.viewerZ > 250 && viewer.viewerHasZoomControls
      && viewer.viewerCaption && viewerEsc.viewerClosedByEsc && viewerEsc.readerAliveAfterEsc
      && filterApplied.ok && filterApplied.filtered
      && (extStat.stat.png || 0) > 0 && extStat.missingImage === 0
      && extStat.volumesWithImages > 0 && extStat.volumesWithArtifacts === 0
      && consoleErrors.length === 0,
    seed,
    counts: { books: counts.c, volumes: counts.v, bodies: counts.b },
    gallery, multi, quickRead, illustrated, viewer, viewerEsc, table, filterProbe, filterApplied,
    detail, reader, readerChapter, leak, extStat,
    consoleErrors: consoleErrors.slice(0, 8),
    shots: [shotGallery, shotMulti, shotQuickRead, shotIllustration, shotViewer,
      shotTable, shotFilter, shotDetail, shotReaderScroll, shotReaderChapter, shotLeak].filter(Boolean),
  }, seed && seed.ok && Number(counts.c) > 100 ? 0 : 1)
}

let started = false
app.on('browser-window-created', (_e, win) => {
  if (started) return
  win.webContents.once('did-finish-load', async () => {
    if (started) return
    started = true
    try { await run(win) } catch (e) {
      finish({ ok: false, error: e.message, stack: (e.stack || '').split('\n').slice(0, 4).join('\n'), consoleErrors: consoleErrors.slice(0, 12) }, 1)
    }
  })
})
// 全量落库（107 条 + 约 90 次观测枢详情 + 图片下载）实测 1~2 分钟，看门狗留足余量
setTimeout(() => finish({ ok: false, error: 'watchdog 1800s' }, 1), 1800000)
require(path.join(PROJECT_ROOT, 'electron', 'main.js'))

#!/usr/bin/env electron
/**
 * 食物板块视觉/几何核验 + 端到端落库演练。
 *
 * 1) 用真实爬取数据把 foods / food_variants / food_materials 写满隔离库
 *    （直接注入 src/utils/foodCrawlSave.mjs 的浏览器构建，跑的是生产同一份落库逻辑）
 * 2) 截图画廊视图 / 列表视图 / 多选模式 / 查漏补缺弹窗 / 详情页
 * 3) 断言关键几何与文案，避免「能构建但页面空白/报错」
 *
 * 生产构建 + 隔离数据目录（硬链接图包），输出截图到 .foods-preview/。
 * Run: env -u ELECTRON_RUN_AS_NODE electron scripts/shot-foods.cjs
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
const OUT_DIR = path.join(PROJECT_ROOT, '.foods-preview')
const PERSIST_ROOT = path.join(OUT_DIR, 'run')
// 磁盘安全：见 scripts/lib/sandbox.cjs 顶部的事故说明。
// 本脚本的数据目录**跨次保留**（工作区内的 .foods-preview/run），因此不注册退出清理，
// 但仍必须用 cloneTree 而非 linkTree —— 硬链接跨 APFS 卷必然失败并退化成真复制。
const { cloneTree, fmtBytes, duBytes, installCleanupHook } = require('./lib/sandbox.cjs')
fs.mkdirSync(OUT_DIR, { recursive: true })
// 数据目录放在工作区内并**跨次保留**：首次跑完一次全量落库后，
// 后续只调 UI 时用 --skip-seed 复用，不必每次重爬 469 条。
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
}
// 只镜像食物用得到的 ItemIcon 子树：整个图包有 2GB，而食物板块只会用到
// 物品图标（料理 + 食材）。这里硬链接不成立时脚本会退化成复制，所以更不能整包镜像。
if (RESEED) {
  const packSrc = path.join(REAL_DATA, 'images-Medium', 'ItemIcon')
  // 数据目录跨次保留，故仅在首次落库时克隆图包（APFS 写时复制，不额外占盘）
  const iconDst = path.join(dataDir, 'images-Medium', 'ItemIcon')
  if (RESEED && fs.existsSync(packSrc) && !fs.existsSync(iconDst)) cloneTree(packSrc, iconDst)
}
fs.writeFileSync(path.join(profileDir, 'config.json'),
  JSON.stringify({ dbDir: dataDir, activeBaseDb: 'silvermoon_terminal.db' }, null, 2))
app.setPath('userData', profileDir)
Object.defineProperty(app, 'isPackaged', { value: true, configurable: true })
process.env.SILVERMOON_DISABLE_DEVTOOLS = '1'

let finished = false
function cleanup() { /* 数据目录跨次保留，见 PERSIST_ROOT 注释 */ }
// 本脚本数据目录跨次保留在 .foods-preview/run，cleanup 是刻意的空实现；
// 仍装上钩子，保证将来若改为临时目录时不会漏清。
installCleanupHook(cleanup)
function finish(payload, code) {
  if (finished) return
  finished = true
  try { fs.writeSync(1, `\n===SHOT-FOODS===\n${JSON.stringify(payload, null, 2)}\n`) } catch (_) {}
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
// 等视口内的图片解码完成：base64 图片是异步经 IPC 回来的，
// 元素已经进了 DOM 但像素还没上屏，此时截图会得到"有文字没图"的半成品。
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
  // 无头 + 关 GPU 时合成器不会主动出帧：先 invalidate 触发重绘，
  // 等图片解码完再等一个稳定间隔，最后才截图。
  try { win.webContents.invalidate() } catch (_) {}
  await waitForImages(win)
  try {
    // 窗口不可见时 rAF 永不回调，必须封顶等待，否则 executeJavaScript 会一直挂着
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
  // 隐藏窗口默认会被节流；关掉节流后才能靠 invalidate() 稳定拿到新帧
  try { win.webContents.setBackgroundThrottling(false) } catch (_) {}
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) consoleErrors.push(message)
  })

  await waitFor(win, `!!document.querySelector('#root')`, 'react root')
  await exec(win, `location.hash = '#/foods'`)
  await waitFor(win, `!!document.querySelector('main')`, 'main')
  await wait(1200)

  // ── 注入生产同款落库逻辑（esbuild 预打包的 IIFE）──
  const bundlePath = path.join(PROJECT_ROOT, 'scripts', '.foodCrawlSave.iife.js')
  if (!fs.existsSync(bundlePath)) throw new Error('缺少 scripts/.foodCrawlSave.iife.js（先跑 npm run build:food-save-bundle）')
  const bundle = fs.readFileSync(bundlePath, 'utf8')
  // 注意：bundle 里含反引号与 ${} 模板字面量，不能用模板字符串拼接注入
  const injected = await exec(win,
    '(() => { try { ' + bundle + '\n; window.__FoodCrawlSave = FoodCrawlSave; return "ok" } catch (e) { return "ERR:" + e.message } })()')
  if (injected !== 'ok') throw new Error('注入 foodCrawlSave 失败: ' + injected)

  // ── 全量落库（--skip-seed 时复用上次结果）──
  const seed = SKIP_SEED ? { ok: true, skipped: true } : await exec(win, `(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    const q = (sql, params) => window.electronAPI.dbQuery(sql, params)
    const { saveFoodData, collectFoodIcons } = window.__FoodCrawlSave
    const miss = await window.electronAPI.checkMissingFoods()
    if (!miss || !miss.success) return { ok: false, error: miss && miss.error }
    const ids = miss.ids
    let done = 0, failed = 0, withMaterials = 0, withVariants = 0
    const errs = []
    for (let i = 0; i < ids.length; i += 8) {
      const chunk = ids.slice(i, i + 8)
      const reqs = chunk.map(id => ({ id, name: (miss.names[id] || {}).zh || '' }))
      let res
      try { res = await window.electronAPI.crawlFoods(reqs) } catch (e) { failed += chunk.length; errs.push(e.message); continue }
      if (!res || !res.success) { failed += chunk.length; errs.push(res && res.error); continue }
      // 与 useFoodCrawler 同一顺序：先下载图片拿到「图标名 → 真实文件名」，
      // 再用真实文件名写库（nanoka 素材是 webp，不能沿用载荷里的 .png 提示名）
      const okResults = (res.results || []).filter(r => r && r.success)
      const icons = [...new Set(okResults.flatMap(r => collectFoodIcons(r.data)))]
      let imageNames = {}
      if (icons.length) {
        try {
          const dl = await window.electronAPI.downloadFoodImages(icons)
          if (dl && dl.success && dl.files) imageNames = dl.files
        } catch (_) {}
      }
      for (let k = 0; k < chunk.length; k++) {
        const r = res.results[k]
        if (!r || !r.success) { failed++; errs.push((r && r.error) || 'x'); continue }
        try {
          const out = await saveFoodData(q, r.data, { foodId: null, imageNames })
          done++
          if (out.materialCount > 0) withMaterials++
          if (out.variantCount >= 3) withVariants++
        } catch (e) { failed++; errs.push(e.message) }
      }
      await sleep(10)
    }
    return { ok: true, total: ids.length, done, failed, withMaterials, withVariants, errs: errs.slice(0, 5) }
  })()`)

  const seeded = await exec(win, `window.electronAPI.dbQuery("SELECT COUNT(*) AS c, (SELECT COUNT(*) FROM food_variants) AS v, (SELECT COUNT(*) FROM food_materials) AS m FROM foods")`)
  const counts = (seeded.data || [])[0] || {}

  // 回到板块页，让列表重新加载
  await exec(win, `location.hash = '#/characters'`)
  await wait(400)
  await exec(win, `location.hash = '#/foods'`)
  await waitFor(win, `document.querySelectorAll('[data-item-id]').length > 0`, 'food cards')
  await wait(1500)
  await waitForImages(win)

  const gallery = await exec(win, `(() => {
    const cards = [...document.querySelectorAll('[data-item-id]')]
    const r = el => { const b = el.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height) } }
    const btns = [...document.querySelectorAll('main button')].map(b => b.textContent.trim())
    const barBtns = [...document.querySelectorAll('button')].map(b => b.textContent.trim())
    return { cards: cards.length, first: cards[0] ? r(cards[0]) : null,
             imgs: document.querySelectorAll('main img').length,
             header: (document.querySelector('h1') || {}).textContent,
             pageHasLeakButton: btns.some(t => t.includes('查漏补缺')),
             devbarHasFoodCrawler: barBtns.some(t => t.includes('食物爬虫')),
             devbarHasLeakCheck: barBtns.some(t => t.includes('查漏补缺')) }
  })()`)
  const shotGallery = await shot(win, path.join(OUT_DIR, 'foods-gallery.png'))

  // ── 多选模式 ──
  await exec(win, `(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('多选模式'))
    if (b) b.click()
    return !!b
  })()`)
  await wait(500)
  await exec(win, `(() => {
    const cards = [...document.querySelectorAll('[data-item-id]')].slice(0, 3)
    for (const c of cards) c.click()
    return cards.length
  })()`)
  await wait(700)
  const multi = await exec(win, `(() => {
    const bar = [...document.querySelectorAll('div')].find(d => (d.className||'').includes('bottom-16') && (d.textContent||'').includes('已选'))
    const crawlerBtn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('食物爬虫'))
    return { barVisible: !!bar, text: bar ? bar.textContent : null,
             devbarBadge: crawlerBtn ? crawlerBtn.textContent.trim() : null }
  })()`)
  const shotMulti = await shot(win, path.join(OUT_DIR, 'foods-multiselect.png'))
  await exec(win, `(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('退出多选')); if (b) b.click() })()`)
  await wait(400)

  // ── 列表视图 ──
  await exec(win, `(() => { const b = document.querySelector('button[title="列表视图"]'); if (b) b.click() })()`)
  await wait(1200)
  const table = await exec(win, `(() => {
    const rows = document.querySelectorAll('table tbody tr')
    return { rows: rows.length, firstRow: rows[0] ? rows[0].innerText.replace(/\\n/g, ' | ') : null }
  })()`)
  const shotTable = await shot(win, path.join(OUT_DIR, 'foods-table.png'))

  // ── 筛选：功效/地区下拉是否有预选项，选中后是否真的过滤 ──
  await exec(win, `(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim().startsWith('筛选')); if (b) b.click() })()`)
  await wait(600)
  const filterProbe = await exec(win, `(() => {
    const bar = [...document.querySelectorAll('div')].find(d => d.querySelector && d.querySelectorAll('select').length >= 2)
    const sels = bar ? [...bar.querySelectorAll('select')] : []
    const labels = bar ? [...bar.querySelectorAll('span')].map(s => s.textContent).filter(Boolean) : []
    // 找到「功效」下拉（选项数量最多、且首项为"全部"）
    const info = sels.map(s => ({ options: s.options.length, sample: [...s.options].slice(1, 4).map(o => o.textContent) }))
    return { selectCount: sels.length, labels: labels.slice(0, 12), info }
  })()`)
  const filterApplied = await exec(win, `(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    const before = document.querySelectorAll('table tbody tr').length
    const bar = [...document.querySelectorAll('div')].find(d => d.querySelector && d.querySelectorAll('select').length >= 2)
    const sels = bar ? [...bar.querySelectorAll('select')] : []
    // 功效下拉 = 选项数最多的那个
    const target = sels.sort((a, b) => b.options.length - a.options.length)[0]
    if (!target || target.options.length < 2) return { ok: false, reason: '找不到功效下拉' }
    const picked = target.options[1].value
    const label = target.options[1].textContent
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
    setter.call(target, picked)
    target.dispatchEvent(new Event('change', { bubbles: true }))
    await sleep(900)
    const after = document.querySelectorAll('table tbody tr').length
    return { ok: true, picked, label, before, after, filtered: after > 0 && after < before }
  })()`)
  const shotFilter = await shot(win, path.join(OUT_DIR, 'foods-filter.png'))

  // ── 排序 + 筛选 → 进详情 → 返回：必须保留 ──
  const roundTrip = await exec(win, `(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    // 加一个排序键
    const th = [...document.querySelectorAll('table thead th button')].find(b => b.textContent.includes('稀有度'))
    if (th) th.click()
    await sleep(500)
    const sortBar = document.body.innerText.includes('排序:')
    const before = {
      rows: document.querySelectorAll('table tbody tr').length,
      chips: [...document.querySelectorAll('span')].map(s => s.textContent).filter(t => /^排序:/.test(t)),
      url: location.hash,
    }
    // 点第一行进详情
    const firstRow = document.querySelector('table tbody tr')
    const targetId = firstRow ? firstRow.getAttribute('data-item-id') : null
    firstRow.click()
    await sleep(1600)
    const inDetail = location.hash.startsWith('#/foods/')
    // 走详情页的「返回食物列表」
    const back = [...document.querySelectorAll('button')].find(b => b.textContent.includes('返回食物列表'))
    if (back) back.click()
    await sleep(2200)
    const after = {
      rows: document.querySelectorAll('table tbody tr').length,
      sortChipCount: [...document.querySelectorAll('span')].filter(s => /^(稀有度|名称|ID)/.test(s.textContent) && s.parentElement && s.parentElement.textContent.includes('↑')).length,
      hash: location.hash,
      filterBarVisible: !!document.querySelector('select'),
      selectedValues: [...document.querySelectorAll('select')].map(s => s.value).filter(Boolean),
    }
    return { targetId, inDetail, before, after, sortBar, sameRows: before.rows === after.rows, hasSortChip: after.sortChipCount > 0 }
  })()`)
  const shotBack = await shot(win, path.join(OUT_DIR, 'foods-back-restore.png'))

  // ── 开发者工具栏：查漏补缺弹窗 ──
  await exec(win, `(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('查漏补缺')); if (b) b.click() })()`)
  await wait(6000)
  const leak = await exec(win, `(() => {
    const dlg = document.querySelector('[data-overlay-dialog]')
    if (!dlg) return { open: false }
    return { open: true, text: dlg.innerText.split('\\n').slice(0, 8).join(' / ') }
  })()`)
  const shotLeak = await shot(win, path.join(OUT_DIR, 'foods-leakcheck.png'))
  await exec(win, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`)
  await wait(400)

  // ── 详情页（三形态）──
  const target = await exec(win, `(async () => {
    const q = (sql, p) => window.electronAPI.dbQuery(sql, p)
    const r = await q("SELECT f.id, f.name_zh FROM foods f WHERE (SELECT COUNT(*) FROM food_variants v WHERE v.food_id = f.id) >= 3 AND (SELECT COUNT(*) FROM food_materials fm WHERE fm.food_id = f.id) >= 3 ORDER BY f.id LIMIT 1")
    return (r.data || [])[0] || null
  })()`)
  if (!target) throw new Error('落库后找不到带三形态与材料的食物')
  await exec(win, `location.hash = '#/foods/${target.id}'`)
  try {
    await waitFor(win, `document.body.innerText.includes('烹饪材料')`, 'detail materials', 20000)
  } catch (e) {
    const diag = await exec(win, `({
      hash: location.hash,
      text: document.body.innerText.replace(/\n/g, ' / ').slice(0, 400),
      overlays: document.querySelectorAll('[data-overlay]').length,
      h1: (document.querySelector('h1') || {}).textContent,
    })`)
    await shot(win, path.join(OUT_DIR, 'debug-detail-fail.png'))
    throw new Error(`${e.message} | diag=${JSON.stringify(diag)} | console=${JSON.stringify(consoleErrors.slice(0, 5))}`)
  }
  await wait(2200)
  const detail = await exec(win, `(() => {
    const txt = document.body.innerText
    const btns = [...document.querySelectorAll('main button')].map(b => b.textContent.trim())
    const barBtns = [...document.querySelectorAll('button')].map(b => b.textContent.trim())
    return {
      hasCooking: txt.includes('烹饪材料'),
      hasVariantSection: txt.includes('形态'),
      title: (document.querySelector('h1') || {}).textContent,
      hasCrawlButton: btns.some(t => t.includes('爬取该条目')),
      devbarCrawlerVisible: barBtns.some(t => t.includes('食物爬虫')),
      devbarButtons: barBtns.filter(t => /爬虫|查漏/.test(t)),
    }
  })()`)
  const shotDetail = await shot(win, path.join(OUT_DIR, 'food-detail.png'))

  // ── 开发者工具栏食物爬虫：真跑一次，验证图片按真实格式落盘 ──
  const crawlSmoke = await exec(win, `(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    const q = (sql, p) => window.electronAPI.dbQuery(sql, p)
    const extOf = (name) => { const m = /\\.([a-z0-9]+)$/i.exec(name || ''); return m ? m[1].toLowerCase() : '(none)' }
    const targetId = ${JSON.stringify(target.id)}
    const before = await q('SELECT image FROM foods WHERE id = ?', [targetId])
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('食物爬虫'))
    if (!btn) return { ok: false, reason: '工具栏没有食物爬虫按钮' }
    btn.click()
    // 等爬取结束：面板出现且不再显示"爬取中"
    const t0 = Date.now()
    let running = true
    while (Date.now() - t0 < 90000) {
      await sleep(600)
      const dlg = document.querySelector('[data-overlay-dialog]')
      const txt = dlg ? dlg.textContent : ''
      if (txt && !txt.includes('爬取中') && !txt.includes('准备中') && /\\(\\d+\\/\\d+\\)/.test(txt)) { running = false; break }
    }
    await sleep(1500)
    const after = await q('SELECT image FROM foods WHERE id = ?', [targetId])
    const vars = await q('SELECT image FROM food_variants WHERE food_id = ?', [targetId])
    const mats = await q('SELECT m.image FROM food_materials fm JOIN materials m ON fm.material_id = m.id WHERE fm.food_id = ?', [targetId])
    return {
      ok: true,
      timedOut: running,
      beforeExt: extOf((before.data || [])[0]?.image),
      afterExt: extOf((after.data || [])[0]?.image),
      variantExts: [...new Set((vars.data || []).map(r => extOf(r.image)))],
      materialExts: [...new Set((mats.data || []).map(r => extOf(r.image)))],
    }
  })()`)
  const shotCrawl = await shot(win, path.join(OUT_DIR, 'foods-crawl-panel.png'))
  // 关掉爬虫面板
  await exec(win, `(() => { const d = document.querySelector('[data-overlay-dialog]'); const b = d && [...d.querySelectorAll('button')].find(x => /关闭/.test(x.title || '')); if (b) b.click(); else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })()`)
  await wait(500)

  // 切换到「奇怪的」形态，验证视觉区分
  await exec(win, `(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('奇怪的') && x.textContent.includes('当前') === false)
    if (b) b.click()
    return !!b
  })()`)
  await wait(900)
  const shotDetailWeird = await shot(win, path.join(OUT_DIR, 'food-detail-weird.png'))

  // ── 材料详情页的反向关联（用于烹饪）──
  const matTarget = await exec(win, `(async () => {
    const q = (sql, p) => window.electronAPI.dbQuery(sql, p)
    const r = await q("SELECT material_id FROM food_materials GROUP BY material_id ORDER BY COUNT(*) DESC LIMIT 1")
    return (r.data || [])[0] ? (r.data || [])[0].material_id : null
  })()`)
  let material = { skipped: true }
  let shotMaterial = null
  if (matTarget) {
    await exec(win, `location.hash = '#/materials/${matTarget}'`)
    await waitFor(win, `document.body.innerText.includes('用于烹饪')`, 'material usage section', 20000)
    await wait(3000)
    material = await exec(win, `(() => {
      const txt = document.body.innerText
      // 区块 = 标题为「用于烹饪」的卡片：标题 h2 往上找到最外层卡片容器
      const h2 = [...document.querySelectorAll('h2')].find(el => el.textContent.trim() === '用于烹饪')
      const sec = h2 ? h2.closest('div.rounded-xl') : null
      const btns = sec ? [...sec.querySelectorAll('button')].map(b => b.textContent.trim()) : []
      return {
        hasUsage: !!h2,
        sectionFound: !!sec,
        usageCards: sec ? sec.querySelectorAll('[title]').length : 0,
        hasAddButton: btns.some(t => t.includes('添加')),
        title: (document.querySelector('h1') || {}).textContent,
      }
    })()`)
    // 打开「关联料理」弹窗确认可编辑
    material.editorOpens = await exec(win, `(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms))
      const h2 = [...document.querySelectorAll('h2')].find(el => el.textContent.trim() === '用于烹饪')
      const sec = h2 ? h2.closest('div.rounded-xl') : null
      const add = sec ? [...sec.querySelectorAll('button')].find(b => b.textContent.includes('添加')) : null
      if (!add) return false
      add.click()
      await sleep(700)
      const dlg = document.querySelector('[data-overlay-dialog]')
      const ok = !!dlg && /关联料理/.test(dlg.textContent || '')
      const close = dlg ? [...dlg.querySelectorAll('button')].find(b => /取消|关闭/.test(b.textContent)) : null
      if (close) close.click()
      else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await sleep(400)
      return ok
    })()`)
    shotMaterial = await shot(win, path.join(OUT_DIR, 'material-usage.png'))
  }

  // 图片扩展名：库里存的应当是真实格式（webp），而不是被统一改成 .png
  const extStat = await exec(win, `(async () => {
    const q = (sql, p) => window.electronAPI.dbQuery(sql, p)
    const r = await q("SELECT image FROM foods WHERE image IS NOT NULL AND image != ''")
    const rows = r.data || []
    const stat = {}
    for (const row of rows) {
      const m = /\\.([a-z0-9]+)$/i.exec(row.image || '')
      const ext = m ? m[1].toLowerCase() : '(none)'
      stat[ext] = (stat[ext] || 0) + 1
    }
    return { total: rows.length, stat }
  })()`)

  finish({
    ok: seed && seed.ok && Number(counts.c) > 400 && gallery.cards > 0 && table.rows > 0 && material.hasUsage
      && material.editorOpens && gallery.devbarHasFoodCrawler && gallery.devbarHasLeakCheck && !gallery.pageHasLeakButton
      && !detail.hasCrawlButton && filterApplied.ok && filterApplied.filtered
      && roundTrip.hasSortChip && roundTrip.sameRows
      && (extStat.stat.webp || 0) > 0
      && crawlSmoke.ok && !crawlSmoke.timedOut && crawlSmoke.afterExt === 'webp',
    seed,
    counts: { foods: counts.c, variants: counts.v, materials: counts.m },
    gallery, multi, table, filterProbe, filterApplied, roundTrip, leak, detail, material, extStat, crawlSmoke,
    consoleErrors: consoleErrors.slice(0, 8),
    shots: [shotGallery, shotMulti, shotTable, shotFilter, shotBack, shotLeak, shotDetail, shotCrawl, shotDetailWeird, shotMaterial].filter(Boolean),
  }, seed && seed.ok && Number(counts.c) > 400 ? 0 : 1)
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
// 全量落库（469 条 + 图片下载）实测 9~11 分钟，看门狗留足余量
setTimeout(() => finish({ ok: false, error: 'watchdog 1800s' }, 1), 1800000)
require(path.join(PROJECT_ROOT, 'electron', 'main.js'))

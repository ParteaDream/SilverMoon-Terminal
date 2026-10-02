#!/usr/bin/env electron
/**
 * 书籍爬虫端到端测试 —— crawl-book / crawl-books / check-missing-books /
 * download-book-images + 真实落库（src/utils/bookCrawlSave.mjs）
 *
 * 需要联网（wiki.biligame.com / api-static.mihoyo.com / act-api-takumi-static.mihoyo.com
 * / patchwiki.biligame.com）。跑在隔离的数据库副本上，不触碰用户真实数据。
 *
 * 覆盖的都是只有对着线上真数据才会暴露的坑：
 *   · 观测枢 modules[] 的顺序不等于卷序（清泉之心是一/四/二/三）
 *   · 观测枢拿描述冒充缺失正文（白之公主与六侏儒）
 *   · 两站卷名写法不同（`·蒙德篇` / `——蒙德篇——` / `第一卷` / `第二卷·瑶光滩`）
 *   · wiki 只有卷描述/体裁/国家/实装版本，正文与作者在观测枢
 *   · 封面优先取 wiki（尺寸更稳定），失败回退观测枢
 *
 * Run: npm run test:book:e2e
 *      （等价于 npm run build:book-save-bundle && env -u ELECTRON_RUN_AS_NODE electron scripts/test-book-crawl.cjs）
 */
const { app } = require('electron')
// 无头/沙箱环境（CI、容器）下 GPU 与 renderer 沙箱会直接崩掉，先关掉
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-gpu-compositing')
app.commandLine.appendSwitch('disable-software-rasterizer')
app.commandLine.appendSwitch('in-process-gpu')
const fs = require('fs')
const os = require('os')
const path = require('path')
// 磁盘安全：见 scripts/lib/sandbox.cjs 顶部的事故说明
const { installCleanupHook, sweepLeftovers } = require('./lib/sandbox.cjs')
sweepLeftovers(['silvermoon-book-test-'])   // 异常信号（SIGTRAP/SIGKILL）会绕过退出钩子，只能靠下次启动自愈

const PROJECT_ROOT = path.resolve(__dirname, '..')
const REAL_DATA = '/Users/stargomia/Files/GenshinWikiData'
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'silvermoon-book-test-'))
const profileDir = path.join(tmpRoot, 'profile')
const dataDir = path.join(tmpRoot, 'data')
fs.mkdirSync(profileDir, { recursive: true })
fs.mkdirSync(dataDir, { recursive: true })
// 隔离副本：不触碰用户真实数据
for (const f of ['silvermoon_terminal.db', 'user.db', 'user.json']) {
  const src = path.join(REAL_DATA, f)
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dataDir, f))
}
fs.writeFileSync(path.join(profileDir, 'config.json'),
  JSON.stringify({ dbDir: dataDir, activeBaseDb: 'silvermoon_terminal.db' }, null, 2))
app.setPath('userData', profileDir)
Object.defineProperty(app, 'isPackaged', { value: true, configurable: true })
process.env.SILVERMOON_DISABLE_DEVTOOLS = '1'

let finished = false
function cleanup() { try { fs.rmSync(tmpRoot, { recursive: true, force: true }) } catch (_) {} }
installCleanupHook(cleanup)   // ⚠️ app.exit() 不触发 'exit'，清理必须靠劫持（见 lib/sandbox.cjs）
function finish(payload, code) {
  if (finished) return
  finished = true
  try { fs.writeSync(1, `\n===BOOK-CRAWL===\n${JSON.stringify(payload, null, 2)}\n`) } catch (_) {}
  process.exitCode = code
  setTimeout(() => { try { app.exit(code) } catch (_) { process.exit(code) } }, 200)
}

// 期望值取自 2026-10 线上实测（wiki 105 本 / 观测枢 93 本）
const CASES = [
  {
    name: '野猪公主',
    expectRarity: 4, expectGenre: '寓言童话', expectCountry: '蒙德', expectVersion: '1.0、1.2',
    expectVolumes: 7, expectBodies: 7,
    note: '卷名与观测枢完全一致；观测枢正文自带卷号需剥掉',
    check: d => {
      const p = []
      if (!d.volumes[0].content.startsWith('久远的传说中')) p.push(`卷一正文开头异常: ${JSON.stringify(d.volumes[0].content.slice(0, 20))}`)
      if (/^\d/.test(d.volumes[0].content)) p.push('正文开头的卷号没有被剥掉')
      if (!d.volumes.every(v => v.content_source === 'mihoyo')) p.push('正文应全部来自观测枢')
      return p
    },
  },
  {
    name: '清泉之心',
    expectRarity: 3, expectGenre: '故事传说', expectCountry: '蒙德', expectVersion: '1.0',
    expectVolumes: 4, expectBodies: 4,
    note: '观测枢模块顺序是 一/四/二/三，按位置配对必错',
    check: d => {
      const p = []
      const byNo = Object.fromEntries(d.volumes.map(v => [v.volume_no, v]))
      if (!byNo[1].content.includes('如水的月光下')) p.push('卷一正文错位')
      if (!byNo[2].content.includes('望着涟漪中破碎的月光')) p.push('卷二正文错位')
      if (!byNo[4].content.includes('不再是少年的少年')) p.push('卷四正文错位')
      // 获取地点以 wiki 为准（更细），观测枢的写法只在 wiki 缺该字段时兜底
      if (!byNo[4].source || !byNo[4].source.includes('晨曦酒庄')) p.push(`卷四获取地点 = ${JSON.stringify(byNo[4].source)}`)
      return p
    },
  },
  {
    name: '白之公主与六侏儒',
    expectRarity: 4, expectGenre: '寓言童话', expectCountry: '蒙德', expectVersion: '1.0',
    expectVolumes: 7, expectBodies: 1,
    note: '观测枢拿描述冒充卷二~卷七的正文，wiki 也没有 → 只剩卷一有正文',
    check: d => {
      const p = []
      if (!d.volumes[0].content.includes('夜母统治着一切臣民')) p.push('卷一正文缺失')
      const fake = d.volumes.slice(1).filter(v => v.content.includes('在提瓦特大陆各地流传已久的童话'))
      if (fake.length > 0) p.push(`卷二~卷七仍写入了被当成正文的描述（${fake.length} 卷）`)
      return p
    },
  },
  {
    name: '谁人的日志',
    expectRarity: 3, expectGenre: '游记日志', expectCountry: '璃月、稻妻', expectVersion: '1.0、2.0',
    expectVolumes: 6, expectBodies: 6,
    note: 'wiki「第二卷·瑶光滩」↔ 观测枢「瑶光滩」按末段名对齐；国家是多值',
    check: d => {
      const p = []
      // 卷二正文开头是「又起大雾了」（wiki 版本前面还有一行「——瑶光滩——」栏目标题，
      // 观测枢没有；这正好也能验证确实取的是观测枢那一份）
      const vol2 = d.volumes.find(v => v.volume_no === 2)
      if (!vol2 || !vol2.content.startsWith('又起大雾了')) p.push(`卷二（瑶光滩）未对齐: ${JSON.stringify((vol2 && vol2.content || '').slice(0, 24))}`)
      if (vol2 && vol2.content.includes('——瑶光滩——')) p.push('卷二取到的是 wiki 正文而不是观测枢正文')
      if (!d.volumes[0].title_zh.includes('给东东的信')) p.push(`卷一卷名 = ${JSON.stringify(d.volumes[0].title_zh)}`)
      return p
    },
  },
  {
    name: '提瓦特游览指南',
    expectRarity: 0, expectGenre: '游记日志', expectCountry: '提瓦特', expectVersion: '1.0、2.6',
    expectVolumes: 3, expectBodies: 3,
    note: '观测枢正文模块只有「——蒙德篇——」，按末段名配对；作者也在观测枢',
    check: d => {
      const p = []
      if (!d.volumes[0].content.includes('达达乌帕谷')) p.push('蒙德篇正文未对齐')
      if (!d.author.includes('艾莉丝')) p.push(`作者 = ${JSON.stringify(d.author)}`)
      return p
    },
  },
  {
    name: '出发吧！嘟嘟可',
    expectRarity: 3, expectGenre: '寓言童话', expectCountry: '稻妻', expectVersion: '2.6',
    expectVolumes: 1, expectBodies: 1,
    note: '绘本：三张插图藏在 <tabber> 与 [[file:]] 里（SMW 值只有 UNIQ 占位符，要用页面原文修）',
    // 这本观测枢没有页面（id 落在 900001 起的本地段位）
    expectMihoyoId: false,
    check: d => {
      const p = []
      if ((d.images || []).length !== 3) p.push(`插图数 ${(d.images || []).length} ≠ 3`)
      const markers = (d.volumes[0].content.match(/\[img:[^\]]+\]/g) || [])
      if (markers.length !== 3) p.push(`正文里的插图标记 ${markers.length} ≠ 3`)
      if (d.volumes[0].content.includes('UNIQ--')) p.push('正文里仍有 UNIQ 占位符')
      // 正文带插图时必须用 wiki 正文（观测枢那份没有图）
      if (d.volumes[0].content_source !== 'biligame') p.push(`正文来源 ${d.volumes[0].content_source}，应为 biligame`)
      const noUrl = (d.images || []).filter(i => !i.url)
      if (noUrl.length) p.push(`${noUrl.length} 张插图没有下载地址`)
      return p
    },
  },
  {
    name: '石素人',
    expectRarity: 3, expectGenre: '小说', expectCountry: '纳塔', expectVersion: '5.4',
    expectVolumes: 3, expectBodies: 3,
    note: '观测枢 base 是「卷N」而正文模块是「第N卷」，按卷序号配对',
    check: d => {
      const p = []
      const byNo = Object.fromEntries(d.volumes.map(v => [v.volume_no, v]))
      if (!byNo[2].content.includes('如果不是亲眼所见')) p.push('卷二正文错位')
      return p
    },
  },
]

let started = false
app.on('browser-window-created', (_e, win) => {
  if (started) return
  win.webContents.once('did-finish-load', async () => {
    if (started) return
    started = true
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    const js = code => win.webContents.executeJavaScript(code, true)
    const results = []
    const extra = {}

    try {
      // ── 0. 表结构 ──
      const tbl = await js(`window.electronAPI.dbQuery("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('books','book_volumes')")`)
      const tables = (tbl.data || []).map(r => r.name).sort()
      extra.tables = tables
      if (tables.length !== 2) {
        finish({ ok: false, error: `books/book_volumes 表缺失: ${JSON.stringify(tables)}` }, 1)
        return
      }

      // ── 1. 单条爬取 ──
      for (const c of CASES) {
        let res
        try {
          res = await js(`window.electronAPI.crawlBook(${JSON.stringify(c.name)})`)
        } catch (e) {
          results.push({ name: c.name, pass: false, problems: [`IPC 异常: ${e.message}`] })
          continue
        }
        const problems = []
        if (!res || !res.success) {
          problems.push(`爬取失败: ${(res && res.error) || '未知错误'}`)
        } else {
          const d = res.data
          if (d.name_zh !== c.name) problems.push(`name_zh ${JSON.stringify(d.name_zh)} ≠ ${c.name}`)
          if (Number(d.rarity) !== c.expectRarity) problems.push(`rarity ${d.rarity} ≠ ${c.expectRarity}`)
          if (d.genre !== c.expectGenre) problems.push(`genre ${JSON.stringify(d.genre)} ≠ ${c.expectGenre}`)
          if (d.country !== c.expectCountry) problems.push(`country ${JSON.stringify(d.country)} ≠ ${c.expectCountry}`)
          if (d.version !== c.expectVersion) problems.push(`version ${JSON.stringify(d.version)} ≠ ${c.expectVersion}`)
          if (d.volumes.length !== c.expectVolumes) problems.push(`卷数 ${d.volumes.length} ≠ ${c.expectVolumes}`)
          const bodies = d.volumes.filter(v => v.content).length
          if (bodies !== c.expectBodies) problems.push(`有正文的卷 ${bodies} ≠ ${c.expectBodies}`)
          if (!d.image) problems.push('缺少封面文件名')
          if (!d.image_url) problems.push('缺少封面下载地址')
          if (!d.description_zh) problems.push('缺少描述')
          if (!d.source) problems.push('缺少获取方式')
          if (c.expectMihoyoId !== false && !d.mihoyo_id) problems.push('缺少观测枢 ID')
          if (c.expectMihoyoId === false && d.mihoyo_id) problems.push(`这本不该有观测枢 ID，实际 ${d.mihoyo_id}`)
          // 卷序必须严格递增且从 1 开始
          const nos = d.volumes.map(v => v.volume_no)
          if (nos.join(',') !== nos.map((_, i) => i + 1).join(',')) problems.push(`卷序异常: ${nos.join(',')}`)
          if (c.check) problems.push(...c.check(d))
        }
        results.push({
          name: c.name, note: c.note, pass: problems.length === 0, problems,
          got: res && res.success ? {
            rarity: res.data.rarity, genre: res.data.genre, country: res.data.country,
            version: res.data.version, volumes: res.data.volumes.length,
            bodies: res.data.volumes.filter(v => v.content).length,
            debug: res.data.debug,
          } : null,
        })
        await sleep(250)
      }

      // ── 2. 批量爬取 ──
      try {
        const batch = await js(`window.electronAPI.crawlBooks(${JSON.stringify([
          { name: '鬼武道' }, { name: '丘丘语诗歌试作' },
        ])})`)
        const ok = batch && batch.success ? batch.results.filter(r => r.success).length : 0
        results.push({
          name: 'crawlBooks 批量', pass: ok === 2,
          problems: ok === 2 ? [] : [`成功 ${ok}/2`, (batch && batch.error) || ''],
        })
      } catch (e) {
        results.push({ name: 'crawlBooks 批量', pass: false, problems: [e.message] })
      }

      // ── 3. 查漏目录 ──
      try {
        const miss = await js(`window.electronAPI.checkMissingBooks()`)
        const problems = []
        if (!miss || !miss.success) problems.push((miss && miss.error) || '接口失败')
        else {
          extra.onlineTotal = miss.total
          extra.version = miss.version
          const names = (miss.items || []).map(i => i.name)
          const mihoyoOnly = (miss.items || []).filter(i => i.sources.length === 1 && i.sources[0] === 'mihoyo')
          extra.mihoyoOnly = mihoyoOnly.map(i => i.name)
          // wiki 105 本 + 观测枢独有的 2 本（残破的笔记 / 风、勇气和翅膀）
          if (miss.total !== 107) problems.push(`total = ${miss.total}，预期 107`)
          for (const n of ['野猪公主', '清泉之心', '白之公主与六侏儒', '残破的笔记', '风、勇气和翅膀']) {
            if (!names.includes(n)) problems.push(`目录缺少 ${n}`)
          }
          // 观测枢同一作品的重复建页不应收进来
          if (names.includes('林间风·故事拔萃节选')) problems.push('《林间风·故事拔萃节选》是重复建页，不该出现')
          const yz = (miss.items || []).find(i => i.name === '野猪公主')
          if (!yz || yz.genre !== '寓言童话' || yz.version !== '1.0、1.2') {
            problems.push(`野猪公主的元数据不对: ${JSON.stringify(yz)}`)
          }
        }
        results.push({ name: 'checkMissingBooks', pass: problems.length === 0, problems })
      } catch (e) {
        results.push({ name: 'checkMissingBooks', pass: false, problems: [e.message] })
      }

      // ── 4. 封面下载（wiki 优先，失败回退观测枢）──
      try {
        const crawl = await js(`window.electronAPI.crawlBook('清泉之心')`)
        const d = crawl.data
        const dl = await js(`window.electronAPI.downloadBookImages(${JSON.stringify([
          { name: 'Book_test_primary', url: d.image_url, altUrl: d.image_alt_url },
          { name: 'Book_test_fallback', url: 'https://example.invalid/nope.png', altUrl: d.image_alt_url },
        ])})`)
        const problems = []
        if (!dl || !dl.success) problems.push((dl && dl.error) || '接口失败')
        else {
          extra.downloaded = dl.files
          if (!dl.files || !dl.files.Book_test_primary) problems.push('主地址下载失败（wiki 封面）')
          if (!dl.files || !dl.files.Book_test_fallback) problems.push('主地址失败时未回退观测枢')
          // 落盘文件名必须带真实扩展名（内容嗅探的结果，而非提示的 .png）
          const names = Object.values(dl.files || {})
          if (!names.every(n => /\.(png|jpe?g|webp|gif|bmp|svg|avif)$/i.test(n))) {
            problems.push(`落盘文件名缺少扩展名: ${JSON.stringify(names)}`)
          }
        }
        results.push({ name: 'downloadBookImages（主/备地址）', pass: problems.length === 0, problems })
      } catch (e) {
        results.push({ name: 'downloadBookImages（主/备地址）', pass: false, problems: [e.message] })
      }

      // ── 5. 真实落库（用渲染进程里的 src/utils/bookCrawlSave.mjs）──
      try {
        const bundlePath = path.join(PROJECT_ROOT, 'scripts', '.bookCrawlSave.iife.js')
        if (!fs.existsSync(bundlePath)) throw new Error('缺少 scripts/.bookCrawlSave.iife.js（先跑 npm run build:book-save-bundle）')
        const bundle = fs.readFileSync(bundlePath, 'utf-8')
        const loaded = await js('(() => { try { ' + bundle + '\n; window.__BookCrawlSave = BookCrawlSave; return "ok" } catch (e) { return "ERR:" + e.message } })()')
        if (loaded !== 'ok') throw new Error('注入落库模块失败: ' + loaded)

        const problems = []
        // 取一本多卷书，先爬再写。封面文件名换成"已落盘"的样子（下载器会给出真实扩展名）
        const crawl = await js(`window.electronAPI.crawlBook('野猪公主')`)
        const data = { ...crawl.data, image: 'Book_test_yezhu.png' }

        const runSave = (bookIdExpr) => `(async () => {
          const { saveBookData } = window.__BookCrawlSave
          const q = (sql, params) => window.electronAPI.dbQuery(sql, params || [])
          const out = await saveBookData(q, ${JSON.stringify(data)}, {${bookIdExpr}})
          const book = await q('SELECT * FROM books WHERE id = ?', [out.bookId])
          const vols = await q("SELECT volume_no, title_zh, LENGTH(COALESCE(content, '')) AS len, content_source FROM book_volumes WHERE book_id = ? ORDER BY volume_no", [out.bookId])
          return { out, book: (book.data || [])[0], vols: vols.data || [] }
        })()`

        // 先清干净可能残留的测试行
        await js(`(async () => {
          const q = (sql, params) => window.electronAPI.dbQuery(sql, params || [])
          for (const id of [990001, 990002]) {
            try { await q('DELETE FROM book_volumes WHERE book_id = ?', [id]) } catch (_) {}
            try { await q('DELETE FROM books WHERE id = ?', [id]) } catch (_) {}
          }
          try { await q('DELETE FROM books WHERE name_zh = ?', ['野猪公主']) } catch (_) {}
          return true
        })()`)

        const saved = await js(runSave(''))
        if (!saved || !saved.book) {
          problems.push('写库后读不到书籍行')
        } else {
          extra.savedBookId = saved.out.bookId
          // 主键规则：有观测枢页面就用 content_id（详情页路由 / 用户看到的 ID 与线上一致）
          if (Number(saved.out.bookId) !== 625) problems.push(`主键 ${saved.out.bookId} ≠ 观测枢 content_id 625`)
          if (Number(saved.book.mihoyo_id) !== 625) problems.push(`mihoyo_id = ${saved.book.mihoyo_id}`)
          if (saved.out.volumeCount !== 7) problems.push(`volumeCount = ${saved.out.volumeCount}`)
          if (saved.out.bodyCount !== 7) problems.push(`bodyCount = ${saved.out.bodyCount}`)
          if (saved.book.name_zh !== '野猪公主') problems.push(`name_zh = ${JSON.stringify(saved.book.name_zh)}`)
          if (Number(saved.book.volume_count) !== 7) problems.push(`books.volume_count = ${saved.book.volume_count}`)
          if (Number(saved.book.rarity) !== 4) problems.push(`books.rarity = ${saved.book.rarity}`)
          if (saved.book.genre !== '寓言童话') problems.push(`books.genre = ${JSON.stringify(saved.book.genre)}`)
          if (saved.vols.length !== 7) problems.push(`book_volumes 行数 = ${saved.vols.length}`)
          const nos = saved.vols.map(v => v.volume_no)
          if (nos.join(',') !== '1,2,3,4,5,6,7') problems.push(`卷序 = ${nos.join(',')}`)
          if (!saved.vols.every(v => v.len > 0)) problems.push('存在正文为空的卷')
          if (!saved.vols.every(v => v.content_source === 'mihoyo')) problems.push('content_source 不是 mihoyo')

          // 再爬一次：必须原地更新（ID 不变、不产生第二行）
          const again = await js(runSave(`bookId: ${saved.out.bookId}`))
          if (!again) problems.push('二次写库失败')
          else {
            if (again.out.bookId !== saved.out.bookId) problems.push('二次写库改了主键')
            if (again.out.created) problems.push('二次写库被当成新建')
            if (again.vols.length !== 7) problems.push(`二次写库后卷数 = ${again.vols.length}`)
            const rows = await js(`window.electronAPI.dbQuery("SELECT id FROM books WHERE name_zh = ?", ["野猪公主"])`)
            if ((rows.data || []).length !== 1) problems.push(`同名书籍出现 ${(rows.data || []).length} 行`)
          }
        }

        // 观测枢没有的那 15 本（图鉴=否 的任务/隐藏书籍）→ 主键落到 900001 起的本地段位
        const localId = await js(`(async () => {
          const { saveBookData } = window.__BookCrawlSave
          const q = (sql, params) => window.electronAPI.dbQuery(sql, params || [])
          const data = ${JSON.stringify({ ...data, name_zh: '阅读器测试_无观测枢页', mihoyo_id: null, wiki_title: '阅读器测试_无观测枢页', image: '' })}
          const out = await saveBookData(q, data, {})
          return { bookId: out.bookId, created: out.created }
        })()`)
        if (!localId || Number(localId.bookId) < 900001) {
          problems.push(`观测枢缺失的书籍主键 ${JSON.stringify(localId)}，应在 900001 以上`)
        }

        // 清理测试行，避免污染隔离库（隔离库随进程结束删除，这里只是保持可重复运行）
        await js(`(async () => {
          const q = (sql, params) => window.electronAPI.dbQuery(sql, params || [])
          const rows = await q('SELECT id FROM books WHERE name_zh IN (?, ?)', ['野猪公主', '阅读器测试_无观测枢页'])
          for (const r of (rows.data || [])) {
            try { await q('DELETE FROM book_volumes WHERE book_id = ?', [r.id]) } catch (_) {}
            try { await q('DELETE FROM books WHERE id = ?', [r.id]) } catch (_) {}
          }
          return true
        })()`)
        results.push({ name: 'saveBookData 落库 + 重爬原地更新', pass: problems.length === 0, problems })
      } catch (e) {
        results.push({ name: 'saveBookData 落库 + 重爬原地更新', pass: false, problems: [e.message] })
      }

      const failed = results.filter(r => !r.pass).length
      finish({ ok: failed === 0, failed, extra, results }, failed === 0 ? 0 : 1)
    } catch (e) {
      finish({ ok: false, error: e.message, extra, results }, 1)
    }
  })
})
setTimeout(() => finish({ ok: false, error: 'watchdog 420s' }, 1), 420000)
require(path.join(PROJECT_ROOT, 'electron', 'main.js'))

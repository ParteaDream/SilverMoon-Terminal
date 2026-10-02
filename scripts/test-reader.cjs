#!/usr/bin/env electron
/**
 * 通用阅读器回归测试（角色故事 + 书籍卷章）
 *
 * StoryReader 原本写死在 CharacterDetailPage.jsx 里，现已抽成 components/Reader.jsx
 * 供书籍板块共用。这次重构动到了已经稳定的角色故事阅读器，因此单独立一个回归测试
 * 盯住它的既有行为：
 *   · 角色详情页的「阅读」按钮仍能打开阅读器，章节来自 character_stories
 *   · 滚动 / 章节双模式切换（F 键与按钮）、章节模式 A/D 翻章
 *   · Esc 关闭
 *   · 主题与字号改动会写进 user.json（重新打开仍然生效）
 *   · 阅读进度按 progressKey 记忆（角色故事与每本书各记各的）
 *   · 书籍详情页的「阅读」打开的是同一套阅读器，章节是卷
 *
 * 生产构建 + 隔离数据目录。
 * Run: env -u ELECTRON_RUN_AS_NODE electron scripts/test-reader.cjs
 */
const fs = require('fs')
const os = require('os')
const path = require('path')

const { app } = require('electron')
// 磁盘安全：见 scripts/lib/sandbox.cjs 顶部的事故说明
const { installCleanupHook, sweepLeftovers } = require('./lib/sandbox.cjs')
sweepLeftovers(['silvermoon-reader-test-'])   // 异常信号（SIGTRAP/SIGKILL）会绕过退出钩子，只能靠下次启动自愈
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-gpu-compositing')
app.commandLine.appendSwitch('disable-software-rasterizer')
app.commandLine.appendSwitch('in-process-gpu')

const PROJECT_ROOT = path.resolve(__dirname, '..')
const REAL_DATA = '/Users/stargomia/Files/GenshinWikiData'
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'silvermoon-reader-test-'))
const profileDir = path.join(tmpRoot, 'profile')
const dataDir = path.join(tmpRoot, 'data')
fs.mkdirSync(profileDir, { recursive: true })
fs.mkdirSync(dataDir, { recursive: true })
for (const f of ['silvermoon_terminal.db', 'user.db']) {
  const src = path.join(REAL_DATA, f)
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dataDir, f))
}
fs.mkdirSync(path.join(dataDir, 'images-Medium'), { recursive: true })
// user.json 复制过来（开发者模式等设置要一致），但清掉阅读偏好与页面状态，
// 让断言从默认值出发、不受上一次运行的残留影响
try {
  const srcCfg = path.join(REAL_DATA, 'user.json')
  if (fs.existsSync(srcCfg)) {
    const cfg = JSON.parse(fs.readFileSync(srcCfg, 'utf-8'))
    delete cfg.readerTheme; delete cfg.readerMode; delete cfg.readerFontSize
    cfg.pageStates = []
    fs.writeFileSync(path.join(dataDir, 'user.json'), JSON.stringify(cfg, null, 2))
  }
} catch (_) {}
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
  try { fs.writeSync(1, `\n===READER===\n${JSON.stringify(payload, null, 2)}\n`) } catch (_) {}
  process.exitCode = code
  setTimeout(() => { try { app.exit(code) } catch (_) { process.exit(code) } }, 200)
}
const wait = ms => new Promise(r => setTimeout(r, ms))
const exec = (win, code) => win.webContents.executeJavaScript(code, true)
async function waitFor(win, expr, label, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try { if (await exec(win, expr)) return true } catch (_) {}
    await wait(80)
  }
  throw new Error(`timeout waiting for ${label}`)
}

// 阅读器根节点（fixed inset-0 z-[250]）
const OVERLAY = `[...document.querySelectorAll('div')].find(d => (d.className || '').toString().includes('z-[250]'))`
const OVERLAY_INFO = `(() => {
  const o = ${OVERLAY}
  if (!o) return null
  const btns = [...o.querySelectorAll('button')]
  const counter = (o.innerText.match(/(\\d+)\\s*\\/\\s*(\\d+)/) || [])
  return {
    title: o.innerText.split('\\n')[0],
    chapterCount: btns.filter(b => /^\\d+\\n/.test((b.innerText || '').trim()) || /^\\d+$/.test((b.innerText || '').trim().split('\\n')[0])).length,
    activeIdx: counter[1] ? Number(counter[1]) : null,
    total: counter[2] ? Number(counter[2]) : null,
    modes: btns.map(b => b.textContent.trim()).filter(t => t === '滚动' || t === '章节'),
    fontSizes: btns.map(b => b.textContent.trim()).filter(t => ['小', '中', '大', '特大'].includes(t)),
    activeTheme: [...o.querySelectorAll('div')].filter(d => /rounded-full border-2/.test((d.className || '').toString())).length,
    textLen: o.innerText.length,
  }
})()`

const consoleErrors = []
async function run(win) {
  try { win.webContents.setBackgroundThrottling(false) } catch (_) {}
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2 && !message.includes('Electron Security Warning')) consoleErrors.push(message)
  })
  await waitFor(win, `!!document.querySelector('#root')`, 'react root')
  await waitFor(win, `!!document.querySelector('main')`, 'main')
  await wait(1200)

  const checks = []
  const push = (name, pass, detail) => checks.push({ name, pass, detail })

  // ═══ 1. 角色故事阅读器 ═══
  const charId = await exec(win, `(async () => {
    const q = window.electronAPI.dbQuery
    const r = await q("SELECT s.character_id AS id, COUNT(*) AS n FROM character_stories s GROUP BY s.character_id HAVING n >= 3 ORDER BY n DESC LIMIT 1")
    return (r.data && r.data[0]) || null
  })()`)
  if (!charId) {
    push('角色故事：找到可测角色', false, '库里没有带 3 篇以上故事的角色')
  } else {
    await exec(win, `location.hash = '#/characters/${charId.id}'`)
    await waitFor(win, `!!document.querySelector('main') && location.hash.includes('/characters/')`, 'character detail')
    // 详情页要等若干次查询 + 图片解码，直接等「阅读」按钮出现比固定 sleep 可靠
    await waitFor(win, `[...document.querySelectorAll('button')].some(b => b.textContent.trim() === '阅读')`, '角色故事阅读按钮', 25000)
    await wait(400)

    const opened = await exec(win, `(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms))
      const before = {
        hash: location.hash,
        text: (document.body.innerText || '').replace(/\\n+/g, ' | ').slice(0, 160),
        readButtons: [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === '阅读').length,
      }
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '阅读')
      if (!btn) return { ok: false, reason: '没找到阅读按钮', before }
      btn.click()
      await sleep(1000)
      return { ok: true, before, info: ${OVERLAY_INFO} }
    })()`)
    push('角色故事：阅读按钮打开阅读器', !!(opened.ok && opened.info), JSON.stringify(opened.ok ? opened.info : opened))
    if (opened.ok && opened.info) {
      push('角色故事：章节数 = 库里故事数', opened.info.total === Number(charId.n), `阅读器 ${opened.info.total} / 库里 ${charId.n}`)
      push('角色故事：正文有内容', opened.info.textLen > 100, `innerText 长度 ${opened.info.textLen}`)
      push('角色故事：有滚动/章节与四档字号', opened.info.modes.length === 2 && opened.info.fontSizes.length === 4, JSON.stringify({ modes: opened.info.modes, fontSizes: opened.info.fontSizes }))
    }

    // ── F 键切到章节模式 + D 键翻章 ──
    const keyboard = await exec(win, `(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms))
      const press = (key) => window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
      const before = ${OVERLAY_INFO}
      press('f')
      await sleep(700)
      const afterToggle = ${OVERLAY_INFO}
      press('d')
      await sleep(800)
      const afterNext = ${OVERLAY_INFO}
      return { before: before && before.activeIdx, afterToggle: afterToggle && afterToggle.activeIdx,
               afterNext: afterNext && afterNext.activeIdx,
               reason: before ? (afterToggle ? (afterNext ? null : '翻章后读不到阅读器') : 'F 键后读不到阅读器') : '一开始就没打开' }
    })()`)
    push('阅读器：F 切章节模式后 D 能翻到下一章',
      keyboard.afterNext === keyboard.before + 1,
      JSON.stringify(keyboard))
    push('阅读器：F 切模式后确实是章节模式', !!keyboard.afterToggle, JSON.stringify(keyboard))

    // ── 主题 / 字号写入 user.json ──
    const prefs = await exec(win, `(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms))
      const o = ${OVERLAY}
      if (!o) return { theme: null, mode: null, fontSize: null, reason: '阅读器未打开' }
      const light = [...o.querySelectorAll('div')].filter(d => /rounded-full border-2/.test((d.className || '').toString()))[2]
      if (light) light.click()
      await sleep(400)
      const xl = [...o.querySelectorAll('button')].find(b => b.textContent.trim() === '特大')
      if (xl) xl.click()
      await sleep(600)
      const cfg = await window.electronAPI.getUserConfig()
      return { theme: cfg.config.readerTheme, mode: cfg.config.readerMode, fontSize: cfg.config.readerFontSize }
    })()`)
    push('阅读器：主题/字号写进 user.json', prefs.theme === 'light' && prefs.fontSize === 'xl', JSON.stringify(prefs))

    // ── 进度记忆 + Esc 关闭 ──
    const closed = await exec(win, `(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms))
      const key = Object.keys(localStorage).find(k => k.startsWith('reader_progress:character_'))
      const saved = key ? localStorage.getItem(key) : null
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await sleep(600)
      return { key, saved, stillOpen: !!${OVERLAY} }
    })()`)
    push('阅读器：Esc 关闭', closed.stillOpen === false, JSON.stringify(closed))
    // afterNext 是界面上显示的 1 基序号，localStorage 里存的是 0 基索引
    push('阅读器：按 progressKey 记住阅读进度',
      !!closed.key && Number(closed.saved) === Number(keyboard.afterNext) - 1,
      JSON.stringify({ ...closed, expected: Number(keyboard.afterNext) - 1 }))

    // ── 重新打开：偏好仍生效（light 主题 + 特大字号）──
    const reopened = await exec(win, `(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms))
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '阅读')
      if (!btn) return { ok: false }
      btn.click()
      await sleep(900)
      const o = ${OVERLAY}
      if (!o) return { ok: false, reason: '阅读器未打开' }
      const idx = (o.innerText.match(/(\\d+)\\s*\\/\\s*(\\d+)/) || [])[1]
      const bodyStyle = getComputedStyle(o.querySelector('.whitespace-pre-wrap') || o)
      return { ok: true, idx: idx ? Number(idx) : null, fontSize: bodyStyle.fontSize, reopened: true }
    })()`)
    push('阅读器：重新打开沿用上次的进度与特大字号',
      !!(reopened.ok && reopened.idx === keyboard.afterNext && parseFloat(reopened.fontSize) >= 18),
      JSON.stringify(reopened))
    await exec(win, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await wait(500)
  }

  // ═══ 2. 书籍阅读器（同一套组件）═══
  // 书籍板块的阅读器只跟 books/book_volumes 有关，这里直接造一本 6 卷的合成书，
  // 不依赖是否已经跑过书籍爬虫（那个走 scripts/test-book-crawl.cjs）
  await exec(win, `window.electronAPI.setDevMode(true)`)
  await wait(300)
  const bookId = await exec(win, `(async () => {
    const q = (sql, p) => window.electronAPI.dbQuery(sql, p || [])
    for (const id of [990777]) {
      try { await q('DELETE FROM book_volumes WHERE book_id = ?', [id]) } catch (_) {}
      try { await q('DELETE FROM books WHERE id = ?', [id]) } catch (_) {}
    }
    const ins = await q(\`INSERT INTO books (id, name_zh, rarity, genre, country, version, description_zh, image, volume_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)\`,
      [990777, '阅读器测试书', 3, '故事传说', '蒙德', '1.0', '用于验证阅读器的合成条目', '', 6])
    if (ins && ins.error) return { error: ins.error }
    for (let i = 1; i <= 6; i++) {
      await q(\`INSERT INTO book_volumes (book_id, volume_no, title_zh, description_zh, content, source, content_source)
        VALUES (?, ?, ?, ?, ?, ?, ?)\`,
        [990777, i, '阅读器测试书·卷' + i, '第 ' + i + ' 卷简介', '第 ' + i + ' 卷正文。\\n第二段落。', '测试地点', 'mihoyo'])
    }
    const r = await q("SELECT COUNT(*) AS n FROM book_volumes WHERE book_id = ?", [990777])
    return { id: 990777, n: (r.data || [{}])[0].n }
  })()`)
  if (!bookId || bookId.error || !bookId.id) {
    push('书籍：造一本 6 卷合成书', false, JSON.stringify(bookId))
  } else {
    await exec(win, `location.hash = '#/books/${bookId.id}'`)
    await waitFor(win, `location.hash.includes('/books/')`, 'book detail')
    await waitFor(win, `[...document.querySelectorAll('button')].some(b => b.textContent.trim() === '阅读')`, '书籍阅读按钮', 20000)
    await wait(400)
    const bookReader = await exec(win, `(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms))
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '阅读')
      if (!btn) return { ok: false, reason: '没找到阅读按钮' }
      btn.click()
      await sleep(1000)
      const info = ${OVERLAY_INFO}
      const overlay = ${OVERLAY}
      if (!overlay) return { ok: false, reason: '阅读器未打开' }
      // 挑第 4 卷（当前停在第 1 卷，点它才会真的跳）
      const jump = [...overlay.querySelectorAll('button')].find(b => (b.innerText || '').includes('卷4'))
      const beforeIdx = info && info.activeIdx
      if (jump) jump.click()
      await sleep(900)
      const after = ${OVERLAY_INFO}
      return { ok: true, info, jumped: jump ? jump.innerText.trim().split('\\n').pop() : null,
               beforeIdx, afterIdx: after && after.activeIdx }
    })()`)
    push('书籍：详情页阅读按钮打开同一套阅读器', !!(bookReader.ok && bookReader.info), bookReader.ok ? bookReader.info : bookReader.reason)
    if (bookReader.ok && bookReader.info) {
      push('书籍：章节数 = 卷数', bookReader.info.total === Number(bookId.n), `${bookReader.info.total} / ${bookId.n}`)
      push('书籍：目录点击可跳卷', bookReader.afterIdx !== bookReader.beforeIdx, JSON.stringify({ from: bookReader.beforeIdx, to: bookReader.afterIdx, jumped: bookReader.jumped }))
    }
    await exec(win, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await wait(400)
  }

  // 清理合成书
  await exec(win, `(async () => {
    const q = (sql, p) => window.electronAPI.dbQuery(sql, p || [])
    try { await q('DELETE FROM book_volumes WHERE book_id = ?', [990777]) } catch (_) {}
    try { await q('DELETE FROM books WHERE id = ?', [990777]) } catch (_) {}
    return true
  })()`)

  const failed = checks.filter(c => !c.pass)
  finish({
    ok: failed.length === 0 && consoleErrors.length === 0,
    failed: failed.length,
    checks,
    consoleErrors: consoleErrors.slice(0, 6),
  }, failed.length === 0 && consoleErrors.length === 0 ? 0 : 1)
}

let started = false
app.on('browser-window-created', (_e, win) => {
  if (started) return
  win.webContents.once('did-finish-load', async () => {
    if (started) return
    started = true
    try { await run(win) } catch (e) {
      finish({ ok: false, error: e.message, stack: (e.stack || '').split('\n').slice(0, 4).join('\n') }, 1)
    }
  })
})
setTimeout(() => finish({ ok: false, error: 'watchdog 300s' }, 1), 300000)
require(path.join(PROJECT_ROOT, 'electron', 'main.js'))

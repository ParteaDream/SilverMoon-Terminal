#!/usr/bin/env electron
/**
 * 回归测试 —— 新打开的详情页必须从顶部开始。
 *
 * 用户反馈：
 *   打开任意详情页 → 向下滚动 → 返回列表 → 之后再点开任何条目，
 *   详情页的初始滚动位置不在顶端（在底部或至少向下了）。
 *
 * 判定标准（只看用户能看到的东西）：
 *   进入一个「本次会话没有快照」的详情页时，main.scrollTop 必须是 0。
 *
 * 场景：
 *   S1 列表在顶部   → 打开条目                     → 详情页应在顶部（对照）
 *   S2 列表滚动过后 → 打开条目                     → 详情页应在顶部
 *   S3 列表滚动过   → 详情下滚 → 返回 → 再开另一个 → 详情页应在顶部
 *   S4 列表在顶部   → 详情下滚 → 返回 → 再开另一个 → 详情页应在顶部
 *
 * Run:
 *   npm run test:detail-top        （生产构建 dist/，与用户实际运行一致）
 *   npm run test:detail-top:dev    （Vite 开发模式，StrictMode 双跑 effect）
 */
const { app } = require('electron')
const { spawn } = require('child_process')
const fs = require('fs')
const http = require('http')
const net = require('net')
const os = require('os')
const path = require('path')
// 磁盘安全：见 scripts/lib/sandbox.cjs 顶部的事故说明
const { installCleanupHook, sweepLeftovers } = require('./lib/sandbox.cjs')
sweepLeftovers(['silvermoon-detail-top-'])   // 异常信号（SIGTRAP/SIGKILL）会绕过退出钩子，只能靠下次启动自愈

const USE_DEV = process.argv.includes('--dev')
// 受限环境（无 GUI 沙箱 / CI）里跑：SILVERMOON_TEST_NO_SANDBOX=1
if (process.env.SILVERMOON_TEST_NO_SANDBOX === '1') {
  app.commandLine.appendSwitch('no-sandbox')
  app.commandLine.appendSwitch('disable-gpu')
  app.disableHardwareAcceleration()
}

const PROJECT_ROOT = path.resolve(__dirname, '..')
const REAL_DATA = '/Users/stargomia/Files/GenshinWikiData'
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'silvermoon-detail-top-'))
const profileDir = path.join(tmpRoot, 'profile')
const dataDir = path.join(tmpRoot, 'data')
fs.mkdirSync(profileDir, { recursive: true })
fs.mkdirSync(dataDir, { recursive: true })
for (const f of ['silvermoon_terminal.db', 'user.db', 'user.json']) {
  const src = path.join(REAL_DATA, f)
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dataDir, f))
}
fs.writeFileSync(path.join(profileDir, 'config.json'),
  JSON.stringify({ dbDir: dataDir, activeBaseDb: 'silvermoon_terminal.db' }, null, 2))
app.setPath('userData', profileDir)
process.env.SILVERMOON_DISABLE_DEVTOOLS = '1'
if (!USE_DEV) Object.defineProperty(app, 'isPackaged', { value: true, configurable: true })

let viteProcess = null
let finished = false
function cleanup() {
  if (viteProcess && !viteProcess.killed) { try { viteProcess.kill('SIGTERM') } catch (_) {} }
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }) } catch (_) {}
}
installCleanupHook(cleanup)   // ⚠️ app.exit() 不触发 'exit'，清理必须靠劫持（见 lib/sandbox.cjs）
function finish(payload, code) {
  if (finished) return
  finished = true
  try { fs.writeSync(1, `\n===DETAIL-OPEN-TOP===\n${JSON.stringify(payload, null, 2)}\n`) } catch (_) {}
  process.exitCode = code
  if (viteProcess && !viteProcess.killed) { try { viteProcess.kill('SIGTERM') } catch (_) {} }
  setTimeout(() => { try { app.exit(code) } catch (_) { process.exit(code) } }, 200)
}

const wait = ms => new Promise(r => setTimeout(r, ms))
const exec = (win, code) => win.webContents.executeJavaScript(code, true)
async function waitFor(win, expr, label, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try { if (await exec(win, expr)) return true } catch (_) {}
    await wait(80)
  }
  throw new Error(`timeout waiting for ${label}`)
}
function getFreePort() {
  return new Promise((res, rej) => {
    const s = net.createServer()
    s.once('error', rej)
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(e => e ? rej(e) : res(p)) })
  })
}
function waitForHttp(url, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs
  return new Promise((res, rej) => {
    const attempt = () => {
      const req = http.get(url, r => {
        r.resume()
        if (r.statusCode && r.statusCode < 500) res()
        else if (Date.now() >= deadline) rej(new Error(`vite ${r.statusCode}`))
        else setTimeout(attempt, 200)
      })
      req.once('error', e => Date.now() >= deadline ? rej(e) : setTimeout(attempt, 200))
      req.setTimeout(2000, () => req.destroy(new Error('http timeout')))
    }
    attempt()
  })
}

const PROBE = `(() => {
  const main = document.querySelector('main')
  if (!main) return null
  return {
    hash: location.hash,
    scrollTop: Math.round(main.scrollTop),
    maxScroll: Math.max(0, main.scrollHeight - main.clientHeight),
    cards: document.querySelectorAll('[data-item-id]').length,
    textLen: (main.innerText || '').length,
  }
})()`

/** 点开视口内的一张卡片；skipId 用来避免重复打开同一条 */
const clickCard = (skipId) => `(() => {
  const main = document.querySelector('main')
  const mr = main.getBoundingClientRect()
  const vis = [...document.querySelectorAll('[data-item-id]')].filter(el => {
    const r = el.getBoundingClientRect()
    return r.bottom > mr.top + 4 && r.top < mr.bottom - 4 && r.height > 20
  })
  const cands = vis.filter(el => String(el.getAttribute('data-item-id')) !== ${JSON.stringify(String(skipId ?? ''))})
  const t = cands[0] || vis[0]
  if (!t) return null
  t.click()
  return t.getAttribute('data-item-id')
})()`

/** 精确点开指定 id 的条目（不要求它在视口内） */
const clickCardExact = (id) => `(() => {
  const t = [...document.querySelectorAll('[data-item-id]')]
    .find(el => String(el.getAttribute('data-item-id')) === ${JSON.stringify(String(id))})
  if (!t) return null
  t.click()
  return t.getAttribute('data-item-id')
})()`

const BACK_BTN = `(() => {
  const b = [...document.querySelectorAll('main button')].find(el => /返回/.test(el.textContent || ''))
  if (b) { b.click(); return 'in-page' }
  const up = document.querySelector('[title="上一步"]')
  if (up) { up.click(); return 'toolbar' }
  return null
})()`

const scrollList = (target) => `(() => {
  const m = document.querySelector('main')
  m.scrollTop = Math.min(${target}, m.scrollHeight - m.clientHeight)
})()`

/** 重启页面：pageStateStore 在启动时被清空，保证每个场景从"没有任何快照"开始 */
async function resetApp(win) {
  await exec(win, `location.reload()`)
  await wait(1200)
  await waitFor(win, `!!document.querySelector('main') && (document.querySelector('main').innerText || '').length > 5`, '重启后应用就绪')
  await wait(1200)
}

async function scenario(win, { key, hash, label, listScroll, cycle, idx }) {
  const problems = []
  const steps = []
  const note = (o) => steps.push(o)

  await exec(win, `location.hash = '#/changelog?fresh=${idx}'`)
  await wait(400)
  await exec(win, `location.hash = ${JSON.stringify(hash)}`)
  await waitFor(win, `location.hash.startsWith(${JSON.stringify(hash)}) && document.querySelectorAll('[data-item-id]').length > 0`, `${label} 列表`)
  await wait(2000)

  if (listScroll > 0) {
    for (let i = 0; i < 4; i++) { await exec(win, scrollList(listScroll)); await wait(250) }
    await wait(600)
  }
  const listBefore = await exec(win, PROBE)
  note({ step: '列表离开前', ...listBefore })

  const firstId = await exec(win, clickCard(null))
  if (!firstId) throw new Error('没有可点击的条目')
  await waitFor(win, `/${key}\\/\\d+/.test(location.hash)`, `打开详情 ${firstId}`)
  await wait(300)
  const early = await exec(win, PROBE)
  await wait(2500)
  const detailFirst = await exec(win, PROBE)
  note({ step: `详情页 A(${firstId}) 刚打开`, early, settled: detailFirst })
  if (detailFirst && detailFirst.scrollTop > 2) {
    problems.push(`打开详情页 A(${firstId}) 不在顶部：scrollTop=${detailFirst.scrollTop}（列表离开前=${listBefore.scrollTop}，详情可滚=${detailFirst.maxScroll}）`)
  }

  if (!cycle) return done()

  for (let i = 0; i < 3; i++) {
    await exec(win, `(() => { const m = document.querySelector('main'); m.scrollTop = Math.min(m.scrollTop + 700, m.scrollHeight - m.clientHeight) })()`)
    await wait(250)
  }
  await wait(600)
  note({ step: '详情页 A 向下滚后', ...(await exec(win, PROBE)) })

  const how = await exec(win, BACK_BTN)
  if (!how) throw new Error('找不到返回按钮')
  await waitFor(win, `location.hash.startsWith(${JSON.stringify(hash)})`, `返回 ${label} 列表`)
  await wait(2600)
  note({ step: `返回列表后（${how}）`, ...(await exec(win, PROBE)) })

  const secondId = await exec(win, clickCard(firstId))
  if (!secondId) throw new Error('返回后没有可点击的条目')
  await waitFor(win, `/${key}\\/\\d+/.test(location.hash)`, `打开详情 ${secondId}`)
  await wait(300)
  const secondEarly = await exec(win, PROBE)
  await wait(2500)
  const secondSettled = await exec(win, PROBE)
  note({ step: `详情页 B(${secondId}) 刚打开`, early: secondEarly, settled: secondSettled })

  if (String(secondId) === String(firstId)) problems.push(`没换到另一个条目（还是 ${secondId}），场景无效`)
  if (secondSettled && secondSettled.scrollTop > 2) {
    problems.push(`返回后再打开详情页 B(${secondId}) 不在顶部：scrollTop=${secondSettled.scrollTop}/${secondSettled.maxScroll}`)
  }

  return done()

  function done() {
    const name = `${label}${listScroll ? `（列表先滚到 ${listScroll}）` : ''}${cycle ? ' · 详情下滚→返回→再开' : ''}`
    return { name, problems, pass: problems.length === 0, steps }
  }
}

/** 场景：重复打开同一条目时，应回到上次在详情页里离开的位置（不是顶部、也不是列表的位置） */
async function scenarioRevisit(win, { key, hash, label, listScroll, where, idx }) {
  const problems = []
  const steps = []
  const note = (o) => steps.push(o)

  await exec(win, `location.hash = '#/changelog?fresh=${idx}'`)
  await wait(400)
  await exec(win, `location.hash = ${JSON.stringify(hash)}`)
  await waitFor(win, `location.hash.startsWith(${JSON.stringify(hash)}) && document.querySelectorAll('[data-item-id]').length > 0`, `${label} 列表`)
  await wait(2000)

  if (listScroll > 0) {
    for (let i = 0; i < 4; i++) { await exec(win, scrollList(listScroll)); await wait(250) }
    await wait(600)
  }
  note({ step: '列表离开前', ...(await exec(win, PROBE)) })

  const id = await exec(win, clickCard(null))
  if (!id) throw new Error('没有可点击的条目')
  await waitFor(win, `/${key}\\/\\d+/.test(location.hash)`, `打开详情 ${id}`)
  await wait(2600)

  // 在详情页里滚到指定位置
  for (let i = 0; i < 3; i++) {
    const expr = where === 'bottom'
      ? `(() => { const m = document.querySelector('main'); m.scrollTop = m.scrollHeight })()`
      : `(() => { const m = document.querySelector('main'); m.scrollTop = Math.round((m.scrollHeight - m.clientHeight) * 0.45) })()`
    await exec(win, expr)
    await wait(250)
  }
  await wait(700)
  const left = await exec(win, PROBE)
  note({ step: `详情页 ${id} 离开前的位置`, ...left })
  const expected = Math.round(left.scrollTop)
  const wantBottom = where === 'bottom' || (left.maxScroll > 0 && expected >= left.maxScroll - 2)
  if (expected <= 2) throw new Error('详情页没能滚动，场景无效')

  await exec(win, BACK_BTN)
  await waitFor(win, `location.hash.startsWith(${JSON.stringify(hash)})`, `返回 ${label} 列表`)
  await wait(2600)

  const again = await exec(win, clickCardExact(id))
  if (String(again) !== String(id)) { problems.push(`返回后点不回同一条目（期望 ${id}，实际 ${again}）`) }
  await waitFor(win, `/${key}\\/\\d+/.test(location.hash)`, `再次打开详情 ${id}`)
  await wait(300)
  const early = await exec(win, PROBE)
  await wait(2800)
  const settled = await exec(win, PROBE)
  note({ step: `再开 ${id}`, early, settled, expected, wantBottom })

  if (wantBottom) {
    if (!(settled.maxScroll > 0 && settled.scrollTop >= settled.maxScroll - 8)) {
      problems.push(`上次停在底部，再开没有回到底部：scrollTop=${settled.scrollTop}/${settled.maxScroll}（期望 ≈${expected}）`)
    }
  } else if (Math.abs(settled.scrollTop - expected) > 8) {
    problems.push(`再开没有回到上次离开的位置：scrollTop=${settled.scrollTop}，期望 ≈${expected}`)
  }

  return {
    name: `${label} · 重复打开同一条（${where === 'bottom' ? '停在底部' : '停在中部'}）`,
    problems, pass: problems.length === 0, steps,
  }
}

async function run(win) {
  const list = [
    { key: 'characters', hash: '#/characters', label: '角色', listScroll: 0, cycle: false },
    { key: 'characters', hash: '#/characters', label: '角色', listScroll: 1200, cycle: false },
    { key: 'characters', hash: '#/characters', label: '角色', listScroll: 0, cycle: true },
    { key: 'characters', hash: '#/characters', label: '角色', listScroll: 1200, cycle: true },
    { key: 'weapons', hash: '#/weapons', label: '武器', listScroll: 1200, cycle: true },
    { key: 'materials', hash: '#/materials', label: '材料', listScroll: 1200, cycle: true },
    { key: 'artifacts', hash: '#/artifacts', label: '圣遗物', listScroll: 1200, cycle: true },
    { key: 'foods', hash: '#/foods', label: '食物', listScroll: 1200, cycle: true },
  ]
  const revisits = [
    { key: 'characters', hash: '#/characters', label: '角色', listScroll: 1200, where: 'bottom' },
    { key: 'weapons', hash: '#/weapons', label: '武器', listScroll: 0, where: 'mid' },
  ]
  const results = []
  let n = 0
  // --revisit：只跑"重复打开同一条"的两组场景（调试用，跑得快）
  const onlyRevisit = process.argv.includes('--revisit')
  for (const sc of (onlyRevisit ? [] : list)) {
    n++
    try {
      await resetApp(win)
      const r = await scenario(win, { ...sc, idx: n })
      r.name = `S${n} ${r.name}`
      results.push(r)
    } catch (e) {
      results.push({ name: `S${n} ${sc.label}`, error: e.message, problems: [e.message], pass: false })
    }
  }
  for (const sc of revisits) {
    n++
    try {
      await resetApp(win)
      const r = await scenarioRevisit(win, { ...sc, idx: n })
      r.name = `S${n} ${r.name}`
      results.push(r)
    } catch (e) {
      results.push({ name: `S${n} ${sc.label} 重复打开`, error: e.message, problems: [e.message], pass: false })
    }
  }
  if (rendererErrors.length > 0) results.push({ name: '渲染错误', problems: rendererErrors.slice(0, 5), pass: false })
  return { mode: USE_DEV ? 'dev' : 'prod', results, failed: results.filter(r => !r.pass).length }
}

const rendererErrors = []

let started = false
app.on('browser-window-created', (_e, win) => {
  if (started) return
  win.webContents.on('console-message', (_ev, level, message) => {
    if (level >= 3) { rendererErrors.push(message); console.log(`[renderer:${level}] ${message}`) }
  })
  win.webContents.once('did-finish-load', async () => {
    if (started) return
    started = true
    try { finish({ ok: true, ...(await run(win)) }, 0) } catch (e) { finish({ ok: false, error: e.message }, 1) }
  })
})
setTimeout(() => finish({ ok: false, error: 'watchdog 420s' }, 1), 420000)

;(async () => {
  try {
    if (USE_DEV) {
      const port = await getFreePort()
      const viteUrl = `http://localhost:${port}`
      viteProcess = spawn('npx', ['vite', '--port', String(port), '--strictPort'], {
        cwd: PROJECT_ROOT, stdio: ['ignore', 'pipe', 'pipe'],
      })
      viteProcess.stdout.on('data', () => {})
      viteProcess.stderr.on('data', d => { const s = String(d); if (/error|fail/i.test(s)) console.log('[vite]', s.trim()) })
      await waitForHttp(viteUrl)
      process.env.SILVERMOON_DEV_SERVER_URL = viteUrl
    }
    require(path.join(PROJECT_ROOT, 'electron', 'main.js'))
  } catch (e) {
    finish({ ok: false, error: `启动失败: ${e.message}` }, 1)
  }
})()

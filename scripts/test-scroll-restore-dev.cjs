#!/usr/bin/env electron
/**
 * 回归测试（开发模式 / React StrictMode）—— 返回列表后页面必须可见
 *
 * 为什么单独测：`npm run electron:dev` 跑的是 Vite 开发服务器 + React 开发构建，
 * StrictMode 会把每个组件的挂载 effect **跑两次**（挂载→模拟卸载→再挂载）。
 * 之前"返回后恢复滚轮"的实现按挂载次数消费恢复标记，第二次挂载读到的是
 * "标记已被消费"，于是走"首次进入"分支，而页面在恢复期间被设成了
 * opacity-0 且没有任何分支把它放回 1 —— 用户看到的就是整页纯黑。
 * 生产构建（test-scroll-restore.cjs）不会双跑 effect，因此测不出这个问题。
 *
 * Run: env -u ELECTRON_RUN_AS_NODE electron scripts/test-scroll-restore-dev.cjs
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
sweepLeftovers(['silvermoon-dev-scroll-'])   // 异常信号（SIGTRAP/SIGKILL）会绕过退出钩子，只能靠下次启动自愈

const PROJECT_ROOT = path.resolve(__dirname, '..')
const REAL_DATA = '/Users/stargomia/Files/GenshinWikiData'
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'silvermoon-dev-scroll-'))
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
// 注意：**不要**设置 isPackaged，走的就是开发模式（StrictMode + HMR 客户端）
process.env.SILVERMOON_DISABLE_DEVTOOLS = '1'

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
  try { fs.writeSync(1, `\n===DEV-SCROLL===\n${JSON.stringify(payload, null, 2)}\n`) } catch (_) {}
  process.exitCode = code
  if (viteProcess && !viteProcess.killed) { try { viteProcess.kill('SIGTERM') } catch (_) {} }
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

/** 页面可见性 + 滚动位置 */
const PROBE = `(() => {
  const main = document.querySelector('main')
  if (!main) return null
  const root = main.firstElementChild
  const cs = root ? getComputedStyle(root) : null
  return {
    opacity: cs ? cs.opacity : null,
    textLen: root ? (root.innerText || '').length : 0,
    scrollTop: Math.round(main.scrollTop),
    maxScroll: main.scrollHeight - main.clientHeight,
    cards: document.querySelectorAll('[data-item-id]').length,
    hash: location.hash,
  }
})()`

async function scenario(win, { key, hash, label }) {
  const name = `${label} · 滚到底 → 打开条目 → 上一步`
  const problems = []
  await exec(win, `location.hash = '#/websites?dev=1'`)
  await wait(600)
  await exec(win, `location.hash = ${JSON.stringify(hash)}`)
  try {
    await waitFor(win, `location.hash.startsWith(${JSON.stringify(hash)}) && document.querySelectorAll('[data-item-id]').length > 0`, `${label} 列表`, 90000)
  } catch (e) {
    const dump = await exec(win, `(() => { const m = document.querySelector('main'); return JSON.stringify({ hash: location.hash, body: (document.body.innerText || '').slice(0, 300), main: m ? m.innerText.slice(0, 200) : null, root: !!document.querySelector('#root') }) })()`).catch(() => 'dump failed')
    throw new Error(`${e.message} | ${dump}`)
  }
  await wait(2000)
  // 滚到底（多按几次，逼浏览器把占位行渲染出来）
  for (let i = 0; i < 6; i++) {
    await exec(win, `(() => { const m = document.querySelector('main'); m.scrollTop = m.scrollHeight })()`)
    await wait(250)
  }
  await wait(800)
  const before = await exec(win, PROBE)
  // 打开视口内最后一张卡片
  const opened = await exec(win, `(() => {
    const main = document.querySelector('main')
    const mr = main.getBoundingClientRect()
    const vis = [...document.querySelectorAll('[data-item-id]')].filter(el => {
      const r = el.getBoundingClientRect(); return r.bottom > mr.top + 4 && r.top < mr.bottom - 4
    })
    const t = vis[vis.length - 1] || document.querySelector('[data-item-id]')
    if (!t) return null
    t.click(); return t.getAttribute('data-item-id')
  })()`)
  if (!opened) throw new Error('没有可点击的条目')
  await waitFor(win, `/${key}\\/\\d+/.test(location.hash)`, `${label} 详情页`)
  await wait(1200)
  // 上一步
  await exec(win, `document.querySelector('[title="上一步"]').click()`)
  await waitFor(win, `location.hash.startsWith(${JSON.stringify(hash)})`, `返回 ${label}`)
  await wait(2500)

  const after = await exec(win, PROBE)
  if (!after) problems.push('读取不到页面状态')
  else {
    if (after.opacity === '0') problems.push(`返回后页面被隐藏（opacity=0，文本长度=${after.textLen}）`)
    // 注意：卡片带 content-visibility，innerText 只统计已渲染部分，不能当"有内容"的依据
    if (after.textLen < 5) problems.push(`返回后页面没有内容（文本长度=${after.textLen}）`)
    if (after.cards === 0) problems.push('返回后列表条目数为 0')
    if (before && before.scrollTop > 100 && after.scrollTop < 100) {
      problems.push(`滚动位置被丢回顶部（${before.scrollTop} → ${after.scrollTop}）`)
    }
    if (before && before.maxScroll > 0 && before.scrollTop >= before.maxScroll - 2) {
      const max = after.maxScroll
      if (max > 0 && after.scrollTop < max - 2) problems.push(`离开前贴着底部，返回后没有贴底（${after.scrollTop}/${max}）`)
    }
  }
  return { name, openedId: opened, before, after, problems, pass: problems.length === 0 }
}

async function run(win) {
  const scenarios = [
    { key: 'weapons', hash: '#/weapons', label: '武器' },
    { key: 'characters', hash: '#/characters', label: '角色' },
    { key: 'materials', hash: '#/materials', label: '材料' },
  ]
  const results = []
  for (const sc of scenarios) {
    try { results.push(await scenario(win, sc)) }
    catch (e) { results.push({ name: sc.label, error: e.message, problems: [e.message], pass: false }) }
  }
  try { results.push(await smokeAllRoutes(win)) }
  catch (e) { results.push({ name: '开发模式全板块渲染', problems: [e.message], pass: false }) }
  if (rendererErrors.length > 0) {
    results.push({ name: '无未捕获错误', problems: rendererErrors.slice(0, 5), pass: false })
  }
  return { results, failed: results.filter(r => !r.pass).length }
}

const rendererErrors = []

/** 开发模式下所有板块都要能正常渲染（StrictMode 会放大"只跑一次"的写法） */
async function smokeAllRoutes(win) {
  const routes = ['#/characters', '#/weapons', '#/artifacts', '#/materials', '#/wishes', '#/challenges',
    '#/data', '#/websites', '#/settings', '#/changelog', '#/terminal']
  const problems = []
  for (const r of routes) {
    const before = rendererErrors.length
    await exec(win, `location.hash = ${JSON.stringify(r)}`)
    await wait(2500)
    const info = await exec(win, `(() => {
      const main = document.querySelector('main')
      return { text: main ? (main.innerText || '').length : -1, root: !!document.querySelector('#root') }
    })()`)
    if (!info.root || info.text <= 0) problems.push(`${r} 渲染为空`)
    if (rendererErrors.length > before) problems.push(`${r} 渲染报错: ${rendererErrors[before]}`)
  }
  return { name: '开发模式全板块渲染', problems, pass: problems.length === 0 }
}

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
setTimeout(() => finish({ ok: false, error: 'watchdog 300s' }, 1), 300000)

;(async () => {
  try {
    const port = await getFreePort()
    const viteUrl = `http://localhost:${port}`   // vite 默认只监听 localhost（可能是 IPv6 ::1）
    viteProcess = spawn('npx', ['vite', '--port', String(port), '--strictPort'], {
      cwd: PROJECT_ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    })
    viteProcess.stdout.on('data', () => {})
    viteProcess.stderr.on('data', d => { const s = String(d); if (/error|fail/i.test(s)) console.log('[vite]', s.trim()) })
    await waitForHttp(viteUrl)
    process.env.SILVERMOON_DEV_SERVER_URL = viteUrl
    require(path.join(PROJECT_ROOT, 'electron', 'main.js'))
  } catch (e) {
    finish({ ok: false, error: `启动开发服务器失败: ${e.message}` }, 1)
  }
})()

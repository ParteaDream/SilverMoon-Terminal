#!/usr/bin/env electron
/**
 * 归火圣夜巡礼 · 端到端视觉/行为核验
 *
 * 真实数据目录 + 隔离 profile，走完整流程：
 *   桌面双击图标 → 选球 → 开始巡礼 → 倒计时 → 比赛（×4 加速）→ 结算
 * 每步截图到 .race-preview/，并回收物理侧的关键指标（完赛数、名次、耗时）。
 *
 * Run: env -u ELECTRON_RUN_AS_NODE electron scripts/shot-nightsoul-race.cjs
 */
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const os = require('os')
const path = require('path')

// 无头/沙箱受限环境下 Electron 需要显式关闭 GPU 沙箱
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-gpu-sandbox')
app.disableHardwareAcceleration()

const PROJECT_ROOT = path.resolve(__dirname, '..')
const REAL_DATA = '/Users/stargomia/Files/GenshinWikiData'
const OUT_DIR = path.join(PROJECT_ROOT, '.race-preview')
fs.mkdirSync(OUT_DIR, { recursive: true })

// 磁盘安全：见 scripts/lib/sandbox.cjs 顶部的事故说明
const { cloneTree, sweepLeftovers, makeCleanup, installCleanupHook, guardSandboxSize, volumeFreeBytes } =
  require('./lib/sandbox.cjs')
sweepLeftovers(['silvermoon-race-'])
const freeBeforeClone = volumeFreeBytes(os.tmpdir())   // tmpRoot 尚未创建，取 TMPDIR 所在卷

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'silvermoon-race-'))
const profileDir = path.join(tmpRoot, 'profile')
const dataDir = path.join(tmpRoot, 'data')
fs.mkdirSync(profileDir, { recursive: true })
fs.mkdirSync(dataDir, { recursive: true })

for (const f of ['silvermoon_terminal.db', 'user.db']) {
  const src = path.join(REAL_DATA, f)
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dataDir, f))
}
for (const entry of fs.readdirSync(REAL_DATA)) {
  if (!entry.startsWith('images-')) continue
  const src = path.join(REAL_DATA, entry)
  if (!fs.statSync(src).isDirectory()) continue
  cloneTree(src, path.join(dataDir, entry))
}

// user.json：沿用真实配置，只把游戏摆到桌面第一格，方便脚本双击
let userJson = {}
try { userJson = JSON.parse(fs.readFileSync(path.join(REAL_DATA, 'user.json'), 'utf8')) } catch (_) {}
userJson.terminalDesktopIcons = { ...(userJson.terminalDesktopIcons || {}), nightsoulrace: { col: 0, row: 0 } }
fs.writeFileSync(path.join(dataDir, 'user.json'), JSON.stringify(userJson, null, 2))
fs.writeFileSync(path.join(profileDir, 'config.json'),
  JSON.stringify({ dbDir: dataDir, activeBaseDb: 'silvermoon_terminal.db' }, null, 2))
guardSandboxSize(tmpRoot, { freeBefore: freeBeforeClone, label: 'shot-nightsoul-race.cjs' })   // 克隆退化会真占盘，这里立刻告警
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
  try { fs.writeSync(1, `\n===RACE===\n${JSON.stringify(payload, null, 2)}\n`) } catch (_) {}
  process.exitCode = code
  setTimeout(() => { try { app.exit(code) } catch (_) { process.exit(code) } }, 150)
}
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
async function shot(win, file) {
  const img = await win.webContents.capturePage()
  fs.writeFileSync(file, img.toPNG())
  return file
}

const errors = []

async function run(win) {
  const report = { steps: [], shots: [] }
  await waitFor(win, `!!document.querySelector('#root')`, 'react root')
  await exec(win, `location.hash = '#/terminal'`)
  await waitFor(win, `!!document.querySelector('[data-desktop-icon="nightsoulrace"]')`, 'desktop icon', 15000)
  await wait(600)

  // 单击桌面图标启动（DesktopIcon 用 onClick；坐标必须与 dragStartPos 一致才不算拖拽）
  await exec(win, `(() => {
    const el = document.querySelector('[data-desktop-icon="nightsoulrace"]')
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 0, clientY: 0, button: 0 }))
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 0, clientY: 0, button: 0 }))
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0, button: 0 }))
    return true
  })()`)
  await waitFor(win, `document.body.innerText.includes('开始巡礼')`, 'game window', 15000)
  await wait(2500)   // 等角色头像加载
  report.shots.push(await shot(win, path.join(OUT_DIR, '1-setup.png')))

  const setup = await exec(win, `(() => {
    const txt = document.body.innerText
    return { hasTitle: txt.includes('归火圣夜巡礼'), hasStart: txt.includes('开始巡礼'), poolCards: txt.match(/我的选择/) ? 1 : 0 }
  })()`)
  report.steps.push({ step: 'setup', ...setup })

  // 自选角色弹窗
  await exec(win, `(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.innerText.includes('自选 7 位角色'))
    if (b) b.click()
    return !!b
  })()`)
  await wait(2600)
  report.shots.push(await shot(win, path.join(OUT_DIR, '2-picker.png')))
  report.steps.push({ step: 'picker', grid: await exec(win, `document.querySelectorAll('button[title]').length`) })
  await exec(win, `(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.innerText.trim() === '清空')
    if (b) b.click()
    const x = [...document.querySelectorAll('button')].find(x => x.querySelector('svg') && x.innerText === '')
    return true
  })()`)
  await wait(300)
  // 关闭弹窗（右上角 X）
  await exec(win, `(() => {
    const btns = [...document.querySelectorAll('button')]
    const close = btns.find(b => b.querySelector('svg') && b.className.includes('text-white/50'))
    if (close) close.click()
    return !!close
  })()`)
  await wait(600)

  // 版面稳定性：切换「我的选择」时标题不得位移（历史 bug：球卡缩放导致整页抽搐）
  const titleBox = expr => `(() => {
    const h = document.querySelector('h1')
    const row = h ? h.parentElement.parentElement.nextElementSibling : null
    const r = h ? h.getBoundingClientRect() : null
    const rr = row ? row.getBoundingClientRect() : null
    return { top: r ? +r.top.toFixed(2) : null, rowTop: rr ? +rr.top.toFixed(2) : null, rowH: rr ? +rr.height.toFixed(2) : null }
  })()`
  const boxA = await exec(win, titleBox())
  const clickBall = idx => `(() => {
    const btns = [...document.querySelectorAll('button[title]')].filter(b => b.title.includes('元素'))
    if (btns[${idx}]) btns[${idx}].click()
    return btns.length
  })()`
  await exec(win, clickBall(5))
  await wait(450)
  const boxB = await exec(win, titleBox())
  await exec(win, clickBall(1))
  await wait(450)
  const boxC = await exec(win, titleBox())
  report.layoutStable = {
    before: boxA, afterPick5: boxB, afterPick1: boxC,
    titleShift: Math.max(Math.abs((boxB.top ?? 0) - (boxA.top ?? 0)), Math.abs((boxC.top ?? 0) - (boxA.top ?? 0))),
    rowShift: Math.max(Math.abs((boxB.rowTop ?? 0) - (boxA.rowTop ?? 0)), Math.abs((boxC.rowTop ?? 0) - (boxA.rowTop ?? 0))),
  }
  await exec(win, clickBall(3))

  // 选中第 3 颗球并开始
  await exec(win, `(() => {
    const balls = [...document.querySelectorAll('button[title]')].filter(b => b.title.includes('元素'))
    const btns = balls.length ? balls : [...document.querySelectorAll('button')].filter(b => b.title && b.title.includes('元素'))
    if (btns[3]) btns[3].click()
    return btns.length
  })()`)
  await wait(400)
  report.shots.push(await shot(win, path.join(OUT_DIR, '3-selected.png')))
  await exec(win, `(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.innerText.includes('开始巡礼'))
    if (b) b.click()
    return !!b
  })()`)

  // 倒计时
  await wait(1400)
  report.shots.push(await shot(win, path.join(OUT_DIR, '4-countdown.png')))

  // 等比赛开始
  await waitFor(win, `document.body.innerText.includes('实时排名')`, 'race hud', 15000)
  await wait(4000)
  report.shots.push(await shot(win, path.join(OUT_DIR, '5-race-early.png')))

  // 切到 ×4
  for (let i = 0; i < 2; i++) {
    await exec(win, `(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.innerText.trim().startsWith('×'))
      if (b) b.click()
      return b ? b.innerText : null
    })()`)
    await wait(200)
  }
  report.steps.push({ step: 'speed', label: await exec(win, `(() => { const b = [...document.querySelectorAll('button')].find(x => x.innerText.trim().startsWith('×')); return b ? b.innerText.trim() : null })()`) })

  // 抓拍燃素试炼门（HUD 出现 🔥 试炼层标识时连拍）
  let trialShots = 0
  for (let i = 0; i < 120 && trialShots < 6; i++) {
    const inTrial = await exec(win, `document.body.innerText.includes('🔥')`)
    if (inTrial) {
      report.shots.push(await shot(win, path.join(OUT_DIR, `trial-${trialShots + 1}.png`)))
      trialShots++
      await wait(2600)
    } else {
      await wait(700)
    }
  }
  report.trialShots = trialShots

  await wait(9000)
  report.shots.push(await shot(win, path.join(OUT_DIR, '6-race-mid.png')))
  const mid = await exec(win, `(() => {
    const t = document.querySelector('.font-mono')
    const rows = [...document.querySelectorAll('div')].filter(d => /^\\d+$/.test(d.innerText) && d.className.includes('tabular-nums'))
    return { clock: t ? t.innerText : null, body: document.body.innerText.slice(0, 400) }
  })()`)
  report.steps.push({ step: 'mid', clock: mid.clock })

  await wait(14000)
  report.shots.push(await shot(win, path.join(OUT_DIR, '7-race-late.png')))

  // 等结算
  let got = false
  for (let i = 0; i < 90; i++) {
    const done = await exec(win, `document.body.innerText.includes('巡礼结算')`)
    if (done) { got = true; break }
    await wait(1000)
  }
  report.steps.push({ step: 'result', reached: got })
  await wait(1200)
  report.shots.push(await shot(win, path.join(OUT_DIR, '8-result.png')))
  const resultText = await exec(win, `(() => {
    const el = [...document.querySelectorAll('div')].find(d => d.innerText && d.innerText.startsWith('巡礼结算'))
    return el ? el.innerText.slice(0, 900) : document.body.innerText.slice(0, 500)
  })()`)
  report.resultText = resultText

  // 帧率采样
  const fps = await exec(win, `(async () => {
    const t0 = performance.now(); let n = 0
    await new Promise(res => {
      const tick = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(tick); else res() }
      requestAnimationFrame(tick)
    })
    return Math.round(n / ((performance.now() - t0) / 1000))
  })()`)
  report.fps = fps
  return report
}

let started = false
app.on('browser-window-created', (_e, win) => {
  if (started) return
  win.webContents.once('did-finish-load', async () => {
    if (started) return
    started = true
    try {
      win.setSize(1440, 940)
      win.show()
      await wait(400)
      const report = await run(win)
      report.consoleErrors = errors.slice(0, 20)
      finish(report, 0)
    } catch (e) {
      try { await shot(win, path.join(OUT_DIR, 'error.png')) } catch (_) {}
      finish({ error: String((e && e.stack) || e), consoleErrors: errors.slice(0, 20) }, 1)
    }
  })
})
setTimeout(() => finish({ error: 'watchdog 300s' }, 1), 300000)
require(path.join(PROJECT_ROOT, 'electron', 'main.js'))

#!/usr/bin/env electron
/**
 * 希穆兰卡 · 端到端视觉/行为核验
 *
 * 真实数据目录 + 隔离 profile，走完整流程：
 *   桌面双击图标 → 存档库 → 新建模拟（自动预填最新卡池）→ 开始模拟
 *   → 单抽动画 → 十连动画 → 抽卡记录 → 抽卡数据 → 存档落库核验
 * 每步截图到 .simulanka-preview/，并回收关键指标。
 *
 * Run: env -u ELECTRON_RUN_AS_NODE electron scripts/shot-simulanka.cjs
 */
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const os = require('os')
const path = require('path')

app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-gpu-sandbox')
app.disableHardwareAcceleration()

const PROJECT_ROOT = path.resolve(__dirname, '..')
const REAL_DATA = '/Users/stargomia/Files/GenshinWikiData'
const OUT_DIR = path.join(PROJECT_ROOT, '.simulanka-preview')
fs.mkdirSync(OUT_DIR, { recursive: true })

// 真实 user.db 的指纹：跑完必须一字未改（曾经出现过测试存档写进真实库的事故）
function realDbFingerprint() {
  try {
    const b = fs.readFileSync(path.join(REAL_DATA, 'user.db'))
    return require('crypto').createHash('sha256').update(b).digest('hex')
  } catch (_) { return null }
}
const REAL_DB_BEFORE = realDbFingerprint()

// 磁盘安全：见 scripts/lib/sandbox.cjs 顶部的事故说明
const { cloneTree, sweepLeftovers, makeCleanup, installCleanupHook, guardSandboxSize, volumeFreeBytes } =
  require('./lib/sandbox.cjs')
sweepLeftovers(['silvermoon-sim-'])
const freeBeforeClone = volumeFreeBytes(os.tmpdir())   // tmpRoot 尚未创建，取 TMPDIR 所在卷

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'silvermoon-sim-'))
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

let userJson = {}
try { userJson = JSON.parse(fs.readFileSync(path.join(REAL_DATA, 'user.json'), 'utf8')) } catch (_) {}
userJson.terminalDesktopIcons = { ...(userJson.terminalDesktopIcons || {}), simulanka: { col: 0, row: 0 } }
fs.writeFileSync(path.join(dataDir, 'user.json'), JSON.stringify(userJson, null, 2))
fs.writeFileSync(path.join(profileDir, 'config.json'),
  JSON.stringify({ dbDir: dataDir, activeBaseDb: 'silvermoon_terminal.db' }, null, 2))
guardSandboxSize(tmpRoot, { freeBefore: freeBeforeClone, label: 'shot-simulanka.cjs' })   // 克隆退化会真占盘，这里立刻告警
app.setPath('userData', profileDir)
Object.defineProperty(app, 'isPackaged', { value: true, configurable: true })
process.env.SILVERMOON_DISABLE_DEVTOOLS = '1'

let finished = false
const cleanup = makeCleanup(tmpRoot)
installCleanupHook(cleanup)   // app.exit() 不触发 'exit'，必须劫持
function finish(payload, code) {
  if (finished) return
  finished = true
  // 隔离自检：真实 user.db 必须一字未改（注意用 payload 而非 run() 内的局部 report）
  try {
    const after = realDbFingerprint()
    const same = after === null || REAL_DB_BEFORE === null || after === REAL_DB_BEFORE
    if (Array.isArray(payload?.steps)) payload.steps.push({ step: 'real-db-untouched', same })
    if (!same) { payload.ok = false; payload.error = '真实 user.db 被本次测试写入！' }
  } catch (e) { try { fs.writeSync(2, 'real-db check failed: ' + e.message + '\n') } catch (_) {} }

  // 保留一份本次运行的 user.db，便于事后核查存档体积/编码（约 4 MB）
  try {
    const src = path.join(dataDir, 'user.db')
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(OUT_DIR, 'last-user.db'))
  } catch (_) {}
  // app.exit() 不触发 Node 的 'exit' 钩子，必须在这里同步删除临时目录
  cleanup()
  try { fs.writeSync(1, `\n===SIMULANKA===\n${JSON.stringify(payload, null, 2)}\n`) } catch (_) {}
  process.exitCode = code
  setTimeout(() => { try { app.exit(code) } catch (_) { process.exit(code) } }, 150)
}
const wait = ms => new Promise(r => setTimeout(r, ms))
const exec = (win, code) => win.webContents.executeJavaScript(code, true)
async function waitFor(win, expr, label, timeoutMs = 40000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try { if (await exec(win, expr)) return true } catch (_) {}
    await wait(80)
  }
  throw new Error(`timeout waiting for ${label}`)
}
async function shot(win, file) {
  const img = await win.webContents.capturePage()
  fs.writeFileSync(file, img.toPNG())
  return path.basename(file)
}
// 所有点击/取值都限定在「希穆兰卡」窗口内：主应用的侧栏同样有「祈愿」等字样，
// 不限定范围会误点到侧栏导航上（把主应用切走、终端窗口随之隐藏）。
const IN_WIN = `(() => {
  const roots = [...document.querySelectorAll('[data-window-root]')]
  return roots.find(r => r.innerText.includes('希穆兰卡')) || null
})()`
const clickText = (txt, exact = false) => `(() => {
  const root = ${IN_WIN}
  if (!root) return false
  const bs = [...root.querySelectorAll('button')]
  const b = bs.find(x => ${exact ? `x.innerText.trim() === ${JSON.stringify(txt)}` : `x.innerText.includes(${JSON.stringify(txt)})`})
  if (b) { b.click(); return true }
  return false
})()`
const winText = `(() => { const r = ${IN_WIN}; return r ? r.innerText : '' })()`

// 逐件展示阶段没有按钮，靠整屏的透明 button（aria-label="下一件"）推进
const clickShowcase = (win) => exec(win, `(() => {
  const root = ${IN_WIN}
  if (!root) return false
  const b = [...root.querySelectorAll('button')].find(x => x.getAttribute('aria-label') === '下一件')
  if (!b) return false
  b.click(); return true
})()`)

// 罗列阶段：点击整屏的「继续」按钮
const clickGrid = (win) => exec(win, `(() => {
  const root = ${IN_WIN}
  if (!root) return false
  const b = [...root.querySelectorAll('button')].find(x => x.getAttribute('aria-label') === '继续')
  if (!b) return false
  b.click(); return true
})()`)

const STEPS = []
const SHOTS = []
const clickByAria = (win, label) => exec(win, `(() => {
  const root = ${IN_WIN}
  if (!root) return false
  const b = [...root.querySelectorAll('button')].find(x => x.getAttribute('aria-label') === ${JSON.stringify('@@')}.replace('@@', ${JSON.stringify(label)}))
  if (!b) return false
  b.click(); return true
})()`)

const fxPhase = (win) => exec(win, `(() => {
  const root = ${IN_WIN}
  if (!root) return 'none'
  const has = (a) => [...root.querySelectorAll('button')].some(x => x.getAttribute('aria-label') === a)
  if (has('跳过祈愿动画')) return 'anim'
  if (has('下一件')) return 'showcase'
  if (has('继续')) return 'grid'
  return 'none'
})()`)

/** 一路把关卡动画走完：动画 → 逐件展示（跳过剩余）→ 罗列 → 关闭 */
async function drainFx(win) {
  for (let i = 0; i < 40; i++) {
    const ph = await fxPhase(win)
    if (ph === 'none') return true
    if (ph === 'anim') await clickByAria(win, '跳过祈愿动画')
    else if (ph === 'showcase') await exec(win, clickText('跳过剩余'))
    else await clickGrid(win)
    await wait(200)
  }
  return false
}

/**
 * 整屏按钮「悬停涂灰」回归测试。
 *
 * index.css 有一条全局规则：
 *     button:where(:not([class*="hover:"])):hover:not(:disabled) { background-color: surface-800 }
 * 整屏透明按钮若漏了 hover: 类，鼠标一悬停就被刷成整块深灰，把底下的 Canvas 动画完全盖住
 * （用户观感＝「抽卡动画消失了」）。
 *
 * 为什么不真的移鼠标：sendInputEvent 在这里无法让 Chromium 进入 :hover
 * （实测 hovered 恒为 false，测试会形同虚设）。
 * 改为直接验证那条规则的选择器是否命中该按钮 —— 这才是真正的契约：
 * 用同 className 造一个探针按钮，看 `button:where(:not([class*="hover:"]))` 是否匹配它。
 */
async function checkOverlayHover(win, aria = null) {
  return exec(win, `(() => {
    const root = ${IN_WIN}
    if (!root) return { skipped: 'no-window' }
    const btns = [...root.querySelectorAll('button')].filter(b =>
      (b.className || '').includes('inset-0') && ${aria ? `b.getAttribute('aria-label') === ${JSON.stringify(aria)}` : 'true'})
    if (!btns.length) return { skipped: ${JSON.stringify(aria || 'no-overlay-button')} }
    const b = btns[0]
    // 探针：同 className 的按钮，若全局规则会命中它，说明悬停时会变灰
    const probe = document.createElement('button')
    probe.className = b.className
    probe.setAttribute('aria-hidden', 'true')
    probe.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px'
    document.body.appendChild(probe)
    // 用 :not(:hover) 之外的完整前置条件判断（:hover 此刻不成立，故去掉它）
    const wouldTint = probe.matches('button:where(:not([class*="hover:"]))')
    probe.remove()
    return {
      label: b.getAttribute('aria-label'),
      hasHoverClass: /(^|\\s)[^\\s]*hover:[^\\s]*/.test(b.className),
      wouldTint,
    }
  })()`, true)
}

async function run(win) {
  const report = { steps: STEPS, shots: SHOTS, errors: [] }
  await waitFor(win, `!!document.querySelector('#root')`, 'react root')
  await exec(win, `location.hash = '#/terminal'`)
  await waitFor(win, `!!document.querySelector('[data-desktop-icon="simulanka"]')`, 'desktop icon', 20000)
  await wait(700)

  // 双击/单击桌面图标启动
  await exec(win, `(() => {
    const el = document.querySelector('[data-desktop-icon="simulanka"]')
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 0, clientY: 0, button: 0 }))
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 0, clientY: 0, button: 0 }))
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0, button: 0 }))
    return true
  })()`)

  await waitFor(win, `document.body.innerText.includes('希穆兰卡')`, 'app window', 20000)
  await waitFor(win, `document.body.innerText.includes('模拟存档') || document.body.innerText.includes('正在装配卡池数据')`, 'boot', 30000)
  await wait(1500)
  report.shots.push(await shot(win, path.join(OUT_DIR, '1-library.png')))
  report.steps.push({ step: 'library', text: (await exec(win, winText)).slice(0, 300) })

  // 新建模拟 → 自动预填最新卡池
  await exec(win, clickText('新建模拟'))
  await waitFor(win, `document.body.innerText.includes('模拟前配置')`, 'setup', 30000)
  await wait(2500)
  report.shots.push(await shot(win, path.join(OUT_DIR, '2-setup.png')))
  const setup = await exec(win, `(() => {
    const t = (${IN_WIN}) ? (${IN_WIN}).innerText : ''
    return {
      hasPools: t.includes('角色活动祈愿') && t.includes('武器活动祈愿') && t.includes('集录祈愿') && t.includes('常驻祈愿'),
      needFix: t.includes('需要指定'),
      sample: t.slice(0, 400),
    }
  })()`)
  report.steps.push({ step: 'setup', ...setup })

  // 打开物品选择弹窗看一眼
  await exec(win, `(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.innerText.trim() === '修改' || x.innerText.trim() === '选择内容')
    if (b) b.click(); return !!b
  })()`)
  await wait(1600)
  report.shots.push(await shot(win, path.join(OUT_DIR, '3-picker.png')))
  await exec(win, `(() => {
    const root = ${IN_WIN}
    const b = root && [...root.querySelectorAll('button')].find(x => x.getAttribute('aria-label') === '关闭')
    if (b) b.click(); return !!b
  })()`)
  await wait(500)

  // 从祈愿板块导入历史卡池
  await exec(win, clickText('卡池安排'))   // 导入按钮已移入「卡池安排」栏内
  await wait(500)

  // ── 各池分组的导入按钮：只替换该类型 ──
  const openGroupImport = (label) => exec(win, `/*openGroupImport*/ (() => {
    const root = ${IN_WIN}
    if (!root) return false
    const groups = [...root.querySelectorAll('div')].filter(d =>
      typeof d.className === 'string' && d.className.includes('rounded-xl border'))
    const g = groups.find(d => d.innerText.startsWith(${JSON.stringify(label)}))
    const b = g && [...g.querySelectorAll('button')].find(x => x.innerText.includes('导入历史卡池'))
    if (b) { b.click(); return true }
    return false
  })()`)
  const closeDialog = () => exec(win, `(() => {
    const root = ${IN_WIN}
    const b = root && [...root.querySelectorAll('button')].find(x => x.getAttribute('aria-label') === '关闭')
    if (b) { b.click(); return true }
    return false
  })()`)
  const countGallery = () => exec(win, `/*countGallery*/ (() => {
    const root = ${IN_WIN}
    if (!root) return { cards: 0, covers: 0 }
    const cards = [...root.querySelectorAll('button')].filter(b => /^[0-9]+[.][0-9]+/.test(b.innerText.trim()))
    const imgs = cards.flatMap(c => [...c.querySelectorAll('img')])
    return {
      cards: cards.length,
      covers: cards.filter(c => c.querySelector('img')).length,
      loaded: imgs.filter(i => i.naturalWidth > 0).length,
      withSrc: imgs.filter(i => (i.getAttribute('src') || '').length > 32).length,
      firstSrc: imgs.length ? (imgs[0].getAttribute('src') || '').slice(0, 24) : null,
      firstRect: imgs.length ? (() => { const r = imgs[0].getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) } })() : null,
      boxRect: (() => { const c = cards[1] && cards[1].querySelector('div'); if (!c) return null; const r = c.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) } })(),
      cardRect: (() => { const c = cards[1]; if (!c) return null; const r = c.getBoundingClientRect(); const cs = getComputedStyle(c); return { w: Math.round(r.width), h: Math.round(r.height), display: cs.display, align: cs.alignItems } })(),
      gridRect: (() => { const g = cards[1] && cards[1].parentElement; if (!g) return null; const r = g.getBoundingClientRect(); const cs = getComputedStyle(g); return { w: Math.round(r.width), display: cs.display, cols: cs.gridTemplateColumns } })(),
    }
  })()`)

  const perPool = {}
  for (const [label, key] of [['角色活动祈愿', 'character-event'], ['武器活动祈愿', 'weapon-event'],
    ['集录祈愿', 'chronicled'], ['常驻祈愿', 'standard']]) {
    if (!(await openGroupImport(label))) { perPool[label] = 'button-missing'; continue }
    await wait(1100)
    const g = await countGallery()
    perPool[label] = `${g.cards} 卡 / ${g.covers} 封面`
    if (label === '武器活动祈愿') report.shots.push(await shot(win, path.join(OUT_DIR, '3b-import-history.png')))
    await closeDialog()
    await wait(400)
  }
  report.steps.push({ step: 'import-gallery-per-pool', perPool })

  // ── 整期导入：一次安排该期开放的全部卡池 ──
  await exec(win, clickText('按版本整期导入', true))
  await wait(1600)
  const periodGallery = await countGallery()
  report.steps.push({ step: 'import-gallery-period', ...periodGallery })
  report.shots.push(await shot(win, path.join(OUT_DIR, '3b2-import-period.png')))
  const imported = await exec(win, `(() => {
    const root = ${IN_WIN}
    if (!root) return null
    const cards = [...root.querySelectorAll('button')].filter(b => /^[0-9]+[.][0-9]+/.test(b.innerText.trim()))
    if (!cards.length) return null
    const label = cards[0].innerText.split(String.fromCharCode(10)).join(' ').trim()
    cards[0].click()
    return label
  })()`)
  await wait(2200)
  report.steps.push({ step: 'import-history', picked: imported })
  report.shots.push(await shot(win, path.join(OUT_DIR, '3c-after-import.png')))

  // 资源页 + 无限资源
  await exec(win, clickText('初始资源'))
  await wait(700)
  await exec(win, clickText('无限资源'))
  await wait(400)
  report.shots.push(await shot(win, path.join(OUT_DIR, '4-resources.png')))

  // 从北国银行导入明细（记录为「一天一条、内含多期」，必须能读到非零余额）
  await exec(win, clickText('从北国银行导入明细'))
  await wait(1600)
  report.shots.push(await shot(win, path.join(OUT_DIR, '4b-import-bank.png')))
  const bank = await exec(win, `(() => {
    const root = ${IN_WIN}
    if (!root) return { ok: false }
    const txt = root.innerText
    const m = txt.match(/原石 ([0-9,]+)/)
    return {
      hasRows: txt.includes('将填入'),
      firstPrimogem: m ? m[1] : null,
      nonZero: !!m && m[1].replace(/,/g, '') !== '0',
    }
  })()`)
  report.steps.push({ step: 'import-bank', ...bank })
  await exec(win, `(() => {
    const root = ${IN_WIN}
    const b = root && [...root.querySelectorAll('button')].find(x => x.getAttribute('aria-label') === '关闭')
    if (b) b.click(); return !!b
  })()`)
  await wait(500)

  // 垫池页：把角色池垫到 89 抽，保证首抽必出五星（用于核验金色动画）
  await exec(win, clickText('垫池与历史'))
  await exec(win, clickText('垫池与历史'))
  await wait(700)
  report.shots.push(await shot(win, path.join(OUT_DIR, '5-pity.png')))
  await exec(win, `(() => {
    const inputs = [...document.querySelectorAll('input[type=number]')]
    const el = inputs[0]
    if (!el) return false
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(el, '89')
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  await wait(500)

  // 从祈愿捕捉站导入垫池与历史
  await exec(win, clickText('导入垫池'))
  await wait(3000)
  report.shots.push(await shot(win, path.join(OUT_DIR, '5b-import-pity.png')))
  const pityDlg = await exec(win, `(() => { const r = ${IN_WIN}; return !!r && r.innerText.includes('推算出的垫池状态') })()`)
  report.steps.push({ step: 'import-pity', hasPreview: pityDlg })
  await exec(win, `(() => {
    const root = ${IN_WIN}
    const b = root && [...root.querySelectorAll('button')].find(x => x.getAttribute('aria-label') === '关闭')
    if (b) b.click(); return !!b
  })()`)
  await wait(600)
  // 重新把角色池垫到 89（导入会覆盖）
  await exec(win, `(() => {
    const inputs = [...document.querySelectorAll('input[type=number]')]
    const el = inputs[0]
    if (!el) return false
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(el, '89')
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  await wait(400)

  // 开始模拟
  await exec(win, clickText('开始模拟'))
  await waitFor(win, `document.body.innerText.includes('商城')`, 'gacha view', 20000)
  await wait(2200)
  report.shots.push(await shot(win, path.join(OUT_DIR, '6-gacha.png')))

  // ── 商城：三栏 + 档位 + 抽卡资金流 ──
  await exec(win, clickText('商城', true))
  await wait(1000)
  const shop = await exec(win, `(() => {
    const root = ${IN_WIN}
    if (!root) return {}
    const t = root.innerText
    return {
      open: t.includes('请适度娱乐，理性消费'),
      tabs: ['原石兑换', '星辉兑换', '凝取结晶'].filter(x => t.includes(x)).length,
      hasPlus: !!root.querySelector('button[aria-label="创世结晶转换为原石"]'),
    }
  })()`)
  report.steps.push({ step: 'shop-open', ...shop })
  report.shots.push(await shot(win, path.join(OUT_DIR, '18-shop-primogem.png')))

  // 凝取结晶：六档 + 双倍开关
  await exec(win, `(() => {
    const root = ${IN_WIN}
    const b = root && [...root.querySelectorAll('button')].find(x => x.innerText.trim() === '凝取结晶')
    if (b) { b.click(); return true }
    return false
  })()`)
  await wait(700)
  const readGenesis = `(() => {
    const root = ${IN_WIN}
    if (!root) return {}
    const t = root.innerText
    const cb = [...root.querySelectorAll('input[type=checkbox]')].find(x => x.closest('label') && x.closest('label').innerText.includes('首充双倍'))
    return {
      tiers: ['￥6.00','￥30.00','￥98.00','￥198.00','￥328.00','￥648.00'].filter(x => t.includes(x)).length,
      doubled: t.includes('双倍！'),
      extra: t.includes('额外赠'),
      total6480: t.includes('12,960枚创世结晶'),
      totalNormal: t.includes('8,080枚创世结晶'),
      checked: !!(cb && cb.checked),
      billTab: t.includes('账单'),
    }
  })()`
  // 默认应为「未勾选 + 额外赠 + 8,080」
  report.steps.push({ step: 'shop-genesis-default', ...(await exec(win, readGenesis)) })
  report.shots.push(await shot(win, path.join(OUT_DIR, '19-shop-genesis.png')))

  // 勾选首充双倍 → 应变成「双倍 + 12,960」
  await exec(win, `(() => {
    const root = ${IN_WIN}
    const cb = root && [...root.querySelectorAll('input[type=checkbox]')].find(x => x.closest('label') && x.closest('label').innerText.includes('首充双倍'))
    if (cb) { cb.click(); return true }
    return false
  })()`)
  await wait(600)
  report.steps.push({ step: 'shop-genesis-on', ...(await exec(win, readGenesis)) })
  // 再取消勾选，回到默认态（后续充值流程按非双倍走）
  await exec(win, `(() => {
    const root = ${IN_WIN}
    const cb = root && [...root.querySelectorAll('input[type=checkbox]')].find(x => x.closest('label') && x.closest('label').innerText.includes('首充双倍'))
    if (cb) { cb.click(); return true }
    return false
  })()`)
  await wait(500)

  // 结晶 → 原石 转换面板
  await exec(win, `(() => {
    const root = ${IN_WIN}
    const b = root && root.querySelector('button[aria-label="创世结晶转换为原石"]')
    if (b) { b.click(); return true }
    return false
  })()`)
  await wait(800)
  const convert = await exec(win, `(() => {
    const t = (${IN_WIN}) ? (${IN_WIN}).innerText : ''
    return { open: t.includes('创世结晶 → 原石'), oneToOne: t.includes('1:1') }
  })()`)
  report.steps.push({ step: 'shop-convert', ...convert })
  report.shots.push(await shot(win, path.join(OUT_DIR, '20-shop-convert.png')))
  await exec(win, `(() => {
    const root = ${IN_WIN}
    const b = root && [...root.querySelectorAll('button')].find(x => x.getAttribute('aria-label') === '关闭')
    if (b) { b.click(); return true }
    return false
  })()`)
  await wait(500)
  await exec(win, `(() => {
    const root = ${IN_WIN}
    const b = root && [...root.querySelectorAll('button')].find(x => x.getAttribute('aria-label') === '关闭商城')
    if (b) { b.click(); return true }
    return false
  })()`)
  await wait(600)

  // 调试：卡池背景内每个单元格的图片与可见性
  report.steps.push({ step: 'banner-debug', ...(await exec(win, `(() => {
    const r = ${IN_WIN}
    if (!r) return { err: 'no win' }
    const bannerEl = r.querySelector('canvas') ? null : null
    const ban = [...r.querySelectorAll('div')].find(d => String(d.className || '').includes('absolute inset-0 overflow-hidden'))
    const banRect = ban ? ban.getBoundingClientRect() : null
    const imgs = [...(ban || r).querySelectorAll('img')].map(i => {
      const b = i.getBoundingClientRect()
      return {
        alt: i.alt, ok: i.naturalWidth > 0,
        w: Math.round(b.width), h: Math.round(b.height),
        x: banRect ? Math.round(b.left - banRect.left) : null,
        x2: banRect ? Math.round(b.right - banRect.left) : null,
      }
    })
    void bannerEl
    return { total: imgs.length, imgs }
  })()`)) })

  // 单抽 → 五星金色动画 → 逐件展示 → 罗列
  await exec(win, clickText('祈愿 ×1'))
  await wait(800)
  report.shots.push(await shot(win, path.join(OUT_DIR, '7-fx-charge.png')))
  await wait(1000)
  report.shots.push(await shot(win, path.join(OUT_DIR, '7b-fx-burst.png')))
  await wait(1700)
  report.shots.push(await shot(win, path.join(OUT_DIR, '7c-fx-showcase.png')))
  // 逐件展示的「剪影→点亮」过程
  await wait(400)
  report.shots.push(await shot(win, path.join(OUT_DIR, '7c2-fx-ignite.png')))
  const showcaseVisible = await exec(win, `(() => { const r = ${IN_WIN}; return !!r && r.innerText.includes('点击任意位置') })()`)
  report.steps.push({ step: 'showcase', showcaseVisible })
  // 缘充足时应直接开抽，不弹「自动转化」或「资源不足」框
  const noDialog = await exec(win, `(() => {
    const t = (${IN_WIN}) ? (${IN_WIN}).innerText : ''
    return !t.includes('自动转化并祈愿') && !t.includes('资源不足')
  })()`)
  report.steps.push({ step: 'pull-direct-no-dialog', ok: noDialog })
  report.steps.push({ step: 'hover-fullscreen-btn', ...(await checkOverlayHover(win)) })
  report.steps.push({ step: 'anim-skip-goes-to-showcase', ok: showcaseVisible })
  await clickShowcase(win)
  await wait(1200)
  report.shots.push(await shot(win, path.join(OUT_DIR, '8-fx-reveal.png')))
  const got5 = await exec(win, `(() => { const r = ${IN_WIN}; return !!r && (r.innerText.includes('第 90 抽') || r.innerText.includes('祈 愿 结 果')) })()`)
  report.steps.push({ step: 'single-5star', got5 })
  await clickGrid(win)
  await wait(700)

  // 十连 → 逐件展示（点 10 次）→ 罗列
  await exec(win, clickText('祈愿 ×10'))
  await wait(1200)   // 停在祈愿动画阶段，先验悬停
  report.steps.push({ step: 'hover-anim-btn', ...(await checkOverlayHover(win, '跳过祈愿动画')) })
  await wait(1400)
  report.shots.push(await shot(win, path.join(OUT_DIR, '9-fx10-showcase.png')))
  let clicks = 0
  for (let i = 0; i < 12; i++) {
    if (!(await clickShowcase(win))) break
    clicks++
    await wait(260)
  }
  report.steps.push({ step: 'showcase10-advance', clicks })
  await wait(900)
  report.shots.push(await shot(win, path.join(OUT_DIR, '10-fx10-reveal.png')))
  await clickGrid(win)
  await wait(800)

  // 再抽几轮堆数据
  for (let i = 0; i < 5; i++) {
    await exec(win, clickText('祈愿 ×10'))
    await wait(700)
    await drainFx(win)
    await wait(300)
  }
  await wait(1000)
  report.shots.push(await shot(win, path.join(OUT_DIR, '11-after-draws.png')))

  // 动画开关：关闭后应直接进入罗列（无蓄力/逐件展示）
  await exec(win, clickText('抽卡动画'))
  await wait(400)
  const animOff = await exec(win, `(() => { const r = ${IN_WIN}; const b = r && [...r.querySelectorAll('button')].find(x => x.innerText.includes('抽卡动画')); return b ? b.innerText : '' })()`)
  await exec(win, clickText('祈愿 ×1'))
  await wait(900)
    const directGrid = await exec(win, `(() => { const r = ${IN_WIN}; return !!r && r.innerText.includes('点击任意位置继续') && !r.innerText.includes('跳过') })()`)
  report.steps.push({ step: 'anim-off', animOff, directGrid })
  report.shots.push(await shot(win, path.join(OUT_DIR, '11a-anim-off.png')))
  await clickGrid(win)
  await wait(500)
  await exec(win, clickText('抽卡动画'))   // 恢复
  await wait(400)

  // 切到武器池看定轨 UI
  await exec(win, `(() => {
    const root = ${IN_WIN}
    if (!root) return false
    const b = [...root.querySelectorAll('nav button')].find(x => x.innerText.includes('武器活动祈愿'))
    if (b) { b.click(); return true }
    return false
  })()`)
  await wait(1600)
  report.shots.push(await shot(win, path.join(OUT_DIR, '11b-weapon-pool.png')))
  // 集录祈愿 / 常驻祈愿 的合成卡池背景
  for (const [key, name] of [['集录祈愿', '11d-chronicled-pool.png'], ['常驻祈愿', '11e-standard-pool.png']]) {
    await exec(win, `(() => {
      const root = ${IN_WIN}
      if (!root) return false
      const b = [...root.querySelectorAll('nav button')].find(x => x.innerText.includes(${JSON.stringify(key)}))
      if (b) { b.click(); return true }
      return false
    })()`)
    await wait(1500)
    report.shots.push(await shot(win, path.join(OUT_DIR, name)))

    // 集录祈愿十连：该期四星数据在数据库里缺失，旧实现会在第一只四星处中断整批，
    // 常常只出 1 抽 —— 这里断言必须实实在在记录到 10 条。
    if (key === '集录祈愿') {
      const countRows = `(() => { const r = ${IN_WIN}; return r ? r.querySelectorAll('tbody tr').length : -1 })()`
      await exec(win, clickText('抽卡记录'))
      await wait(1200)
      const before = await exec(win, countRows)
      await exec(win, clickText('祈愿'))    // 回到抽卡页
      await wait(900)
      await exec(win, clickText('祈愿 ×10'))
      await wait(1000)
      await exec(win, clickText('跳过'))
      await wait(900)
      await clickGrid(win)
      await wait(500)
      report.shots.push(await shot(win, path.join(OUT_DIR, '11d2-chronicled-drawn.png')))
      await exec(win, clickText('抽卡记录'))
      await wait(1200)
      const after = await exec(win, countRows)
      report.steps.push({ step: 'chronicled-10', before, after, gained: after - before })
      await exec(win, clickText('祈愿'))
      await wait(800)
    }
  }
  // 回到角色池
  await exec(win, `(() => {
    const root = ${IN_WIN}
    const b = root && [...root.querySelectorAll('nav button')].find(x => x.innerText.includes('角色活动祈愿') && !x.innerText.includes('-2'))
    if (b) b.click(); return !!b
  })()`)
  await wait(800)
  // 在武器池抽一次十连，核验定轨与命定值
  await exec(win, clickText('祈愿 ×10'))
  await wait(400)
  await exec(win, clickText('跳过动画'))
  await wait(3000)
  await exec(win, clickText('点击继续'))
  await wait(900)
  report.shots.push(await shot(win, path.join(OUT_DIR, '11c-weapon-drawn.png')))

  // 抽卡记录
  await exec(win, clickText('抽卡记录'))
  await wait(1800)
  report.shots.push(await shot(win, path.join(OUT_DIR, '12-records.png')))
  report.steps.push({ step: 'records', rows: await exec(win, `(() => { const r = ${IN_WIN}; return r ? r.querySelectorAll('tbody tr').length : 0 })()`) })

  // 抽卡数据
  await exec(win, clickText('抽卡数据'))
  await wait(1800)
  report.shots.push(await shot(win, path.join(OUT_DIR, '13-stats.png')))

  // 补充资源弹窗
  await exec(win, clickText('祈愿'))
  await wait(600)
  await exec(win, clickText('补充资源'))
  await wait(1000)
  report.shots.push(await shot(win, path.join(OUT_DIR, '14-recharge.png')))
  await exec(win, `(() => {
    const root = ${IN_WIN}
    const b = root && [...root.querySelectorAll('button')].find(x => x.getAttribute('aria-label') === '关闭')
    if (b) b.click(); return !!b
  })()`)
  await wait(600)

  // 保存并核验落库
  await exec(win, clickText('保存'))
  await wait(2000)
  // 新模型：没有手动保存按钮，改动自动写回
  report.steps.push({ step: 'save', ...(await exec(win, `(() => {
    const t = (${IN_WIN}) ? (${IN_WIN}).innerText : ''
    return { hasSaveBtn: [...((${IN_WIN}) || document).querySelectorAll('button')].some(b => b.innerText.trim() === '保存'), autoSaved: t.includes('已自动保存') }
  })()`)) })

  // 打开存档库确认存档存在
  await exec(win, clickText('存档库'))
  await wait(1600)
  report.shots.push(await shot(win, path.join(OUT_DIR, '15-archive-saved.png')))
  const rawSizes = await exec(win, `(async () => {
    try {
      const r = await window.electronAPI.wishsimListArchives()
      return (r?.archives || []).map(a => ({ name: a.name, bytes: a.size }))
    } catch (e) { return [{ error: String(e && e.message) }] }
  })()`)
  report.steps.push({ step: 'archive-bytes', archives: rawSizes })
  const lib = await exec(win, `(() => {
    const t = (${IN_WIN}) ? (${IN_WIN}).innerText : ''
    const sizes = (t.match(/[0-9]+(?:\.[0-9]+)? ?(?:KB|MB|B)\b/g) || [])
    return { hasArchive: !t.includes('还没有任何模拟存档'), sizes, text: t.slice(0, 400) }
  })()`)
  report.steps.push({ step: 'archive-list', ...lib })

  // ── 核验新存档模型：打开=就地进入，改动写回同一条，不新建存档 ──
  const beforeCount = await exec(win, `(() => { const r = ${IN_WIN}; return r ? [...r.querySelectorAll('button')].filter(b => b.innerText.trim() === '打开').length : -1 })()`)
  const clickedResume = await exec(win, clickText('打开'))
  report.steps.push({ step: 'resume-click', clickedResume })
  await wait(4000)
  report.shots.push(await shot(win, path.join(OUT_DIR, '16a-after-resume-click.png')))
  const resumeState = await exec(win, `(() => {
    const t = (${IN_WIN}) ? (${IN_WIN}).innerText : ''
    return { hasGacha: t.includes('补充资源'), tail: t.slice(-500) }
  })()`)
  report.steps.push({ step: 'resume-state', ...resumeState })
  await wait(1500)
  // 续档后抽卡记录应完整保留（模拟中 61 + 武器 10 = 71 条；「已抽 N 次」文案已按要求移除，改从记录页核验）
  await exec(win, clickText('抽卡记录'))
  await wait(1600)
  const openedRows = await exec(win, `(() => { const r = ${IN_WIN}; return r ? r.querySelectorAll('tbody tr').length : 0 })()`)
  await exec(win, clickText('祈愿'))
  await wait(600)
  const opened = await exec(win, `(() => {
    const t = (${IN_WIN}) ? (${IN_WIN}).innerText : ''
    const inp = (${IN_WIN}) && (${IN_WIN}).querySelector('input[aria-label="存档名"]')
    return { name: (inp || {}).value || '', autoSaved: t.includes('已自动保存'), rows: ${openedRows} }
  })()`)
  report.steps.push({ step: 'open-in-place', ...opened })

  // 读档后：模拟前（导入）记录必须完整，且 art/splash 能由 roster 还原出缩略图
  await exec(win, clickText('抽卡记录'))
  await wait(1600)
  const importedAfterLoad = await exec(win, `(() => {
    const root = ${IN_WIN}
    if (!root) return { rows: 0, withArt: 0 }
    const trs = [...root.querySelectorAll('tbody tr')]
    const withArt = trs.filter(tr => { const im = tr.querySelector('img'); return im && im.naturalWidth > 0 }).length
    return { rows: trs.length, withArt, hasBefore: root.innerText.includes('模拟前') }
  })()`)
  report.steps.push({ step: 'open-imported-records', ...importedAfterLoad })
  await exec(win, clickText('祈愿'))
  await wait(700)
  report.shots.push(await shot(win, path.join(OUT_DIR, '16-resumed.png')))

  // 打开后继续操作只应更新原存档，不该多出一条
  await exec(win, clickText('祈愿 ×1'))
  await wait(2600)
  await drainFx(win)
  await wait(1400)
  await exec(win, clickText('存档库'))
  await wait(1600)
  const countRowsInLib = `(() => { const r = ${IN_WIN}; return r ? [...r.querySelectorAll('button')].filter(b => b.innerText.trim() === '打开').length : -1 })()`
  const afterOpen = await exec(win, countRowsInLib)

  // 复制存档：应新增一条「· 副本」
  const dupBefore = await exec(win, countRowsInLib)
  await exec(win, `(() => {
    const root = ${IN_WIN}
    const b = root && [...root.querySelectorAll('button')].find(x => (x.getAttribute('aria-label') || '').startsWith('复制 '))
    if (b) { b.click(); return true }
    return false
  })()`)
  await wait(1600)
  const dupAfter = await exec(win, countRowsInLib)
  const dupName = await exec(win, `(() => { const t = (${IN_WIN}) ? (${IN_WIN}).innerText : ''; return t.includes('· 副本') })()`)

  // 重命名：铅笔按钮必须真的能改名（window.prompt 在 Electron 里无效是历史 bug）
  await exec(win, `(() => {
    const root = ${IN_WIN}
    const b = root && [...root.querySelectorAll('button')].find(x => (x.getAttribute('aria-label') || '').startsWith('重命名 '))
    if (b) { b.click(); return true }
    return false
  })()`)
  await wait(900)
  const renameOpen = await exec(win, `(() => { const t = (${IN_WIN}) ? (${IN_WIN}).innerText : ''; return t.includes('重命名存档') })()`)
  await exec(win, `(() => {
    const root = ${IN_WIN}
    const inp = root && root.querySelector('input[aria-label="存档名"]')
    if (!inp) return false
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(inp, '改过名的存档')
    inp.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  await wait(400)
  await exec(win, clickText('确定'))
  await wait(1600)
  const renamed = await exec(win, `(() => { const t = (${IN_WIN}) ? (${IN_WIN}).innerText : ''; return t.includes('改过名的存档') })()`)

  report.steps.push({ step: 'open-updates-in-place', beforeCount, afterOpen, sameCount: beforeCount === afterOpen })
  report.steps.push({ step: 'duplicate-archive', dupBefore, dupAfter, dupName, grew: dupAfter === dupBefore + 1 })
  report.steps.push({ step: 'rename-archive', renameOpen, renamed })
  report.shots.push(await shot(win, path.join(OUT_DIR, '26-library-actions.png')))
  const finalCount = afterOpen
  report.shots.push(await shot(win, path.join(OUT_DIR, '17-two-archives.png')))

  // ── 抽卡资金流：资源不足 → 商城补货 → 自动转化确认 ──
  // 另起一局并「清零」，此时缘/原石/结晶全为 0，十连必然走「资源不足」分支。
  // （不用合成 input 事件：受控 number 输入框上它改不动 React state，会得到假绿。）
  await exec(win, clickText('新建模拟'))
  await wait(2500)
  await exec(win, clickText('初始资源'))
  await wait(900)
  // 直接用精确文本点「清零」：clickText 用的是 includes，可能先命中别的按钮
  const zeroClicked = await exec(win, `(() => {
    const root = ${IN_WIN}
    const b = root && [...root.querySelectorAll('button')].find(x => x.innerText.trim() === '清零')
    if (b) { b.click(); return true }
    return false
  })()`)
  await wait(600)
  const zeroed = await exec(win, `(() => {
    const root = ${IN_WIN}
    return root ? [...root.querySelectorAll('input[type=number]')].map(i => i.value) : []
  })()`)
  report.steps.push({ step: 'reset-zero', zeroClicked, zeroed })
  await exec(win, clickText('开始模拟'))
  await waitFor(win, `document.body.innerText.includes('商城')`, 'gacha view 2', 20000)
  await wait(1200)

  // 先把弹窗开关关掉：资源「真不足」属于错误提示，不该被开关吞掉
  const dlgOff1 = await exec(win, `(() => {
    const root = ${IN_WIN}
    const b = root && [...root.querySelectorAll('button')].find(x => x.innerText.trim().startsWith('弹窗'))
    if (b) { b.click(); return true }
    return false
  })()`)
  await wait(500)
  await exec(win, clickText('祈愿 ×10'))
  await wait(1300)
  report.steps.push({ step: 'short-prompts-even-dialog-off', dlgOff1, ...(await exec(win, `(() => {
    const t = (${IN_WIN}) ? (${IN_WIN}).innerText : ''
    return { stillPrompts: t.includes('资源不足'), hasShop: t.includes('前往商城') }
  })()`)) })
  // 关掉提示、再把弹窗开关打开，继续验证「需要转化时会先确认」
  await exec(win, clickText('知道了'))
  await wait(500)
  await exec(win, `(() => {
    const root = ${IN_WIN}
    const b = root && [...root.querySelectorAll('button')].find(x => x.innerText.trim().startsWith('弹窗'))
    if (b) { b.click(); return true }
    return false
  })()`)
  await wait(500)

  const clicked10 = await exec(win, `(() => {
    const root = ${IN_WIN}
    if (!root) return false
    const b = [...root.querySelectorAll('button')].find(x => x.innerText.includes('祈愿 ×10'))
    if (!b) return false
    b.click(); return true
  })()`)
  await wait(1300)
  report.steps.push({ step: 'pull-short', clicked10, ...(await exec(win, `(() => {
    const root = ${IN_WIN}
    const t = root ? root.innerText : ''
    return { short: t.includes('资源不足'), hasShop: t.includes('前往商城') }
  })()`)) })
  report.shots.push(await shot(win, path.join(OUT_DIR, '21-pull-short.png')))

  // 前往商城 → 凝取结晶 → 买 ￥648（首充双倍 → +12960 结晶）
  await exec(win, clickText('前往商城'))
  await wait(1000)
  await exec(win, `(() => {
    const root = ${IN_WIN}
    const b = root && [...root.querySelectorAll('button')].find(x => x.innerText.trim() === '凝取结晶')
    if (b) { b.click(); return true }
    return false
  })()`)
  await wait(800)
  const bought = await exec(win, `(() => {
    const root = ${IN_WIN}
    if (!root) return false
    const b = [...root.querySelectorAll('button')].find(x => x.innerText.includes('￥648.00'))
    if (!b) return false
    b.click(); return true
  })()`)
  report.steps.push({ step: 'shop-buy-648', bought })
  report.shots.push(await shot(win, path.join(OUT_DIR, '24-shop-bought.png')))
  await wait(700)
  await exec(win, `(() => {
    const root = ${IN_WIN}
    const b = root && [...root.querySelectorAll('button')].find(x => x.getAttribute('aria-label') === '关闭商城')
    if (b) { b.click(); return true }
    return false
  })()`)
  await wait(700)

  // 账单栏：应记下这一笔（￥648.00 / 8,080 结晶）
  await exec(win, clickText('商城', true))
  await wait(1000)
  await exec(win, `(() => {
    const root = ${IN_WIN}
    const b = root && [...root.querySelectorAll('button')].find(x => x.innerText.trim() === '账单')
    if (b) { b.click(); return true }
    return false
  })()`)
  await wait(800)
  const bill = await exec(win, `(() => {
    const root = ${IN_WIN}
    if (!root) return {}
    const t = root.innerText
    const rows = root.querySelectorAll('tbody tr').length
    return {
      rows,
      hasPrice: t.includes('￥648.00'),
      hasGained: t.includes('8,080'),
      hasTotal: t.includes('￥648.00') && /累计充值/.test(t),
    }
  })()`)
  report.steps.push({ step: 'shop-bill', ...bill })
  report.shots.push(await shot(win, path.join(OUT_DIR, '25-shop-bill.png')))
  await exec(win, `(() => {
    const root = ${IN_WIN}
    const b = root && [...root.querySelectorAll('button')].find(x => x.getAttribute('aria-label') === '关闭商城')
    if (b) { b.click(); return true }
    return false
  })()`)
  await wait(700)

  // 货币栏 + → 结晶转原石（拉到最大）
  await exec(win, `(() => {
    const root = ${IN_WIN}
    const b = root && root.querySelector('button[aria-label="创世结晶转换为原石"]')
    if (b) { b.click(); return true }
    return false
  })()`)
  await wait(900)
  const conv = await exec(win, `(() => {
    const root = ${IN_WIN}
    if (!root) return { ok: false }
    const r = root.querySelector('input[type=range]')
    if (!r) return { ok: false, why: 'no-range' }
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(r, r.max)
    r.dispatchEvent(new Event('input', { bubbles: true }))
    r.dispatchEvent(new Event('change', { bubbles: true }))
    return { ok: true, max: r.max, now: r.value }
  })()`)
  report.steps.push({ step: 'convert-slider', ...conv })
  await wait(500)
  await exec(win, clickText('确认转换'))
  await wait(900)

  // 再抽十连：原石够但缘为 0 → 应弹「自动转化并祈愿」
  await exec(win, clickText('祈愿 ×10'))
  await wait(1300)
  report.steps.push({ step: 'pull-convert', ...(await exec(win, `(() => {
    const t = (${IN_WIN}) ? (${IN_WIN}).innerText : ''
    return { convert: t.includes('自动转化并祈愿'), confirm: t.includes('确认并祈愿') }
  })()`)) })
  report.shots.push(await shot(win, path.join(OUT_DIR, '22-pull-convert.png')))
  await exec(win, clickText('确认并祈愿'))
  await wait(2800)
  report.shots.push(await shot(win, path.join(OUT_DIR, '23-pull-after-convert.png')))
  await drainFx(win)
  await wait(600)

  // ── 弹窗开关：默认开；关闭后同样的十连应直接开抽、不弹确认框 ──
  const dlgDefault = await exec(win, `(() => {
    const root = ${IN_WIN}
    const b = root && [...root.querySelectorAll('button')].find(x => x.innerText.trim().startsWith('弹窗'))
    return { exist: !!b, label: b ? b.innerText.trim() : '', pressed: b ? b.getAttribute('aria-pressed') : null }
  })()`)
  report.steps.push({ step: 'dialog-toggle-default', ...dlgDefault })

  // 关掉弹窗开关
  await exec(win, `(() => {
    const root = ${IN_WIN}
    const b = root && [...root.querySelectorAll('button')].find(x => x.innerText.trim().startsWith('弹窗'))
    if (b) { b.click(); return true }
    return false
  })()`)
  await wait(600)
  // 再抽十连：缘为 0、原石够 → 不应弹确认框，直接进动画
  await exec(win, clickText('祈愿 ×10'))
  await wait(1400)
  const dlgOff = await exec(win, `(() => {
    const root = ${IN_WIN}
    const t = root ? root.innerText : ''
    const b = [...root.querySelectorAll('button')].find(x => x.innerText.trim().startsWith('弹窗'))
    return {
      label: b ? b.innerText.trim() : '',
      noConfirm: !t.includes('自动转化并祈愿'),
      // 直接开抽会进入祈愿动画/逐件展示
      fxRunning: t.includes('跳过祈愿动画') || t.includes('跳过剩余') || t.includes('点击任意位置'),
    }
  })()`)
  report.steps.push({ step: 'dialog-off-pulls-directly', ...dlgOff })
  report.shots.push(await shot(win, path.join(OUT_DIR, '27-dialog-off.png')))
  await drainFx(win)
  await wait(600)

  // 关掉弹窗但资源真不足时，仍必须提示
  await exec(win, clickText('商城', true))
  await wait(900)
  await exec(win, `(() => {
    const root = ${IN_WIN}
    const b = root && [...root.querySelectorAll('button')].find(x => x.getAttribute('aria-label') === '关闭商城')
    if (b) { b.click(); return true }
    return false
  })()`)
  await wait(500)

  return report
}

// 复用真实主进程（IPC / 数据库 / 图包），窗口创建后再跑脚本
const errors = []
let started = false
app.on('browser-window-created', (_e, win) => {
  win.webContents.on('console-message', (_ev, level, message) => {
    if (level >= 2) errors.push(String(message).slice(0, 300))
  })
  win.webContents.on('render-process-gone', (_ev, d) => errors.push('render-process-gone ' + JSON.stringify(d)))
  if (started) return
  win.webContents.once('did-finish-load', async () => {
    if (started) return
    started = true
    try {
      win.setSize(1440, 960)
      win.show()
      await wait(600)
      const report = await run(win)
      report.ok = report.steps.some(s => s.step === 'single-5star' && s.got5)
      && report.steps.some(s => s.step === 'showcase' && s.showcaseVisible)
      && report.steps.some(s => s.step === 'showcase10-advance' && s.clicks >= 10)
      && report.steps.some(s => s.step === 'anim-off' && s.directGrid)
      && report.steps.some(s => s.step === 'import-bank' && s.hasRows && s.nonZero)
      && report.steps.some(s => s.step === 'import-gallery-period' && s.cards > 0 && s.covers > 0)
      && report.steps.some(s => s.step === 'import-gallery-per-pool'
           && Object.values(s.perPool || {}).every(v => /^[0-9]+ 卡/.test(v)))
      && report.steps.some(s => s.step === 'chronicled-10' && s.gained === 10)
      && report.steps.some(s => s.step === 'open-imported-records' && s.rows > 0 && s.withArt > 0)
      && report.steps.some(s => s.step === 'archive-bytes' && Array.isArray(s.archives)
           && s.archives.length > 0 && s.archives.every(a => Number(a.bytes) > 0 && Number(a.bytes) < 512 * 1024))
      && report.steps.some(s => s.step === 'import-pity' && s.hasPreview)
      && report.steps.some(s => s.step === 'save' && s.hasSaveBtn === false && s.autoSaved)
      && report.steps.some(s => s.step === 'open-in-place' && s.autoSaved && Number(s.rows) >= 71)
      && report.steps.some(s => s.step === 'open-updates-in-place' && s.sameCount === true)
      && report.steps.some(s => s.step === 'duplicate-archive' && s.grew && s.dupName)
      && report.steps.some(s => s.step === 'rename-archive' && s.renameOpen && s.renamed)
      && report.steps.some(s => s.step === 'open-imported-records' && s.rows > 0 && s.withArt > 0)
      && report.steps.some(s => s.step === 'archive-bytes' && Array.isArray(s.archives)
           && s.archives.length > 0 && s.archives.every(a => Number(a.bytes) > 0 && Number(a.bytes) < 512 * 1024))

      && report.steps.some(s => s.step === 'shop-open' && s.open && s.tabs === 3 && s.hasPlus)
      && report.steps.some(s => s.step === 'shop-genesis-default'
           && s.tiers === 6 && s.checked === false && s.extra && !s.doubled && s.totalNormal && s.billTab)
      && report.steps.some(s => s.step === 'shop-genesis-on' && s.checked && s.doubled && s.total6480)
      && report.steps.some(s => s.step === 'shop-convert' && s.open)
      && report.steps.some(s => s.step === 'shop-bill' && s.rows >= 1 && s.hasPrice && s.hasGained && s.hasTotal)
      && report.steps.some(s => s.step === 'pull-direct-no-dialog' && s.ok === true)
      && report.steps.some(s => s.step === 'reset-zero' && s.zeroClicked && s.zeroed.every(v => v === '0'))
      && report.steps.some(s => s.step === 'pull-short' && s.short === true)
      && report.steps.some(s => s.step === 'short-prompts-even-dialog-off'
           && s.dlgOff1 === true && s.stillPrompts === true && s.hasShop === true)
      && report.steps.some(s => s.step === 'pull-convert' && s.convert === true)
      && report.steps.some(s => s.step === 'short-prompts-even-dialog-off' && s.stillPrompts === true)
      && report.steps.some(s => s.step === 'dialog-toggle-default' && s.exist && s.pressed === 'true')
      && report.steps.some(s => s.step === 'dialog-off-pulls-directly'
           && s.label === '弹窗关' && s.noConfirm === true && s.fxRunning === true)
      // 悬停时整屏按钮必须保持透明，否则会盖住祈愿动画
      && report.steps.some(s => s.step === 'hover-anim-btn' && s.wouldTint === false)
      && report.steps.some(s => s.step === 'hover-fullscreen-btn' && (s.wouldTint === false || s.skipped))
      report.errors = errors.slice(0, 20)
      finish(report, report.ok ? 0 : 1)
    } catch (e) {
      try { await shot(win, path.join(OUT_DIR, 'error.png')) } catch (_) {}
      let dbg = null
      try { dbg = await exec(win, `document.body.innerText.slice(-800)`) } catch (_) {}
      // 出错时也要带上已完成的步骤，否则无从定位卡在哪一步
      finish({ ok: false, error: String((e && e.stack) || e), steps: STEPS, errors: errors.slice(0, 30), dbg }, 1)
    }
  })
})
// 隔离自检：确认主进程真的读的是本次临时数据目录（否则会把测试存档写进真实 user.db）
app.whenReady().then(() => {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'config.json'), 'utf8'))
    const ok = path.resolve(cfg.dbDir) === path.resolve(dataDir)
    fs.writeSync(1, `\n===ISOLATION=== userData=${app.getPath('userData')} dbDir=${cfg.dbDir} ok=${ok}\n`)
    if (!ok) { finish({ ok: false, error: 'profile isolation failed: ' + cfg.dbDir }, 1); return }
  } catch (e) {
    fs.writeSync(1, `\n===ISOLATION=== failed: ${e.message}\n`)
    finish({ ok: false, error: 'profile isolation check failed: ' + e.message }, 1)
  }
})
setTimeout(() => finish({ ok: false, error: 'watchdog 420s' }, 1), 420000)
require(path.join(PROJECT_ROOT, 'electron', 'main.js'))

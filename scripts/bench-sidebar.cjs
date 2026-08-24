// 侧栏展开/收起动画性能基准（无头窗口，测量画廊卡片场景下单帧耗时）
// 用法: npx electron scripts/bench-sidebar.cjs
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-gpu-compositing')
app.commandLine.appendSwitch('disable-software-rasterizer')

const html = fs.readFileSync(path.join(__dirname, 'bench-sidebar.html'), 'utf8')

const log = (...a) => console.log('[bench]', ...a)

app.whenReady().then(async () => {
  try {
    log('ready, creating window')
    const win = new BrowserWindow({
      width: 1400,
      height: 900,
      show: false,
      webPreferences: { offscreen: true, backgroundThrottling: false },
    })
    log('loading page')
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    log('page loaded, waiting for cards')
    const count = await win.webContents.executeJavaScript('document.querySelectorAll(".card").length')
    log('cards:', count)
    await new Promise(r => setTimeout(r, 500))
    log('running benchmark')
    const results = await win.webContents.executeJavaScript('window.__run()')
    log('results:')
    console.log(JSON.stringify(results, null, 2))
  } catch (e) {
    log('ERROR:', e && e.message ? e.message : String(e))
  }
  setTimeout(() => app.exit(0), 500)
})

setTimeout(() => {
  log('hard timeout, exiting')
  app.exit(1)
}, 90000)

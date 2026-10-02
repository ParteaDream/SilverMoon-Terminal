#!/usr/bin/env electron
/**
 * 武器爬虫后端回归测试 —— crawl-weapon 必须返回可写库的名称
 *
 * 覆盖此前的问题：
 *   · name_zh 永远不更新（爬虫压根不返回可用的名称更新路径）
 *   · name_en 只认列表里的值，列表缺失/占位时拿不到英文名
 *   · 数据版本解析失败时回退到 CDN 上早已不存在的版本号，整个爬虫全线 404
 *
 * 需要联网访问 nanoka.cc。Run:
 *   env -u ELECTRON_RUN_AS_NODE electron scripts/test-weapon-crawl.cjs
 */
const { app } = require('electron')
const fs = require('fs')
const os = require('os')
const path = require('path')
// 磁盘安全：见 scripts/lib/sandbox.cjs 顶部的事故说明
const { installCleanupHook, sweepLeftovers } = require('./lib/sandbox.cjs')
sweepLeftovers(['silvermoon-crawl-test-'])   // 异常信号（SIGTRAP/SIGKILL）会绕过退出钩子，只能靠下次启动自愈

const PROJECT_ROOT = path.resolve(__dirname, '..')
const REAL_DATA = '/Users/stargomia/Files/GenshinWikiData'
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'silvermoon-crawl-test-'))
const profileDir = path.join(tmpRoot, 'profile')
const dataDir = path.join(tmpRoot, 'data')
fs.mkdirSync(profileDir, { recursive: true })
fs.mkdirSync(dataDir, { recursive: true })
// 隔离副本：不触碰用户真实数据（爬虫只读库里的 ID，不会写库）
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
  try { fs.writeSync(1, `\n===WEAPON-CRAWL===\n${JSON.stringify(payload, null, 2)}\n`) } catch (_) {}
  process.exitCode = code
  setTimeout(() => { try { app.exit(code) } catch (_) { process.exit(code) } }, 200)
}

// 期望值取自 nanoka 线上数据（见 electron/weapon-names.cjs 的占位名规则）
const CASES = [
  { id: 11438, name: '银釭', expectZh: '银釭', expectEn: 'Silver Light', note: '历史遗留 name_en="Weapon: Sword"' },
  { id: 15437, name: '柔风游弦', expectZh: '柔风游弦', expectEn: 'Breezeborne Refrain', note: '历史遗留 name_en="Weapon: Bow"' },
  { id: 13415, name: '渔获', expectZh: '「渔获」', expectEn: '"The Catch"', note: '中文名带官方书名号' },
  { id: 390002, name: '星锋剑（旅行者专用幻化）', expectZh: '星锋剑', expectEn: 'Exaiphanes Blade', note: '武器装扮：本地名带消歧后缀' },
  { id: 224102, name: '艾维萨缇的山狩', expectZh: '艾维萨缇的山狩', expectEn: "Apsat's Mountain Hunt", note: '译名更新' },
]

let started = false
app.on('browser-window-created', (_e, win) => {
  if (started) return
  win.webContents.once('did-finish-load', async () => {
    if (started) return
    started = true
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    const results = []
    try {
      for (const c of CASES) {
        let res
        try {
          res = await win.webContents.executeJavaScript(
            `window.electronAPI.crawlWeapon(${JSON.stringify(c.name)}, { weaponId: ${c.id}, fastMode: true, crawlMode: 'fast' })`, true)
        } catch (e) {
          results.push({ id: c.id, pass: false, problems: [`IPC 异常: ${e.message}`] })
          continue
        }
        const problems = []
        if (!res || !res.success) {
          problems.push(`爬取失败: ${(res && res.error) || '未知错误'}`)
        } else {
          const d = res.data
          if (d.id !== c.id) problems.push(`id ${d.id} ≠ ${c.id}`)
          if (d.name_zh !== c.expectZh) problems.push(`name_zh ${JSON.stringify(d.name_zh)} ≠ ${JSON.stringify(c.expectZh)}`)
          if (d.name_en !== c.expectEn) problems.push(`name_en ${JSON.stringify(d.name_en)} ≠ ${JSON.stringify(c.expectEn)}`)
          if (!d.name_zh) problems.push('name_zh 为空')
          if (!d.images || !d.images.icon) problems.push('缺少图标文件名')
        }
        results.push({ id: c.id, name: c.name, note: c.note, pass: problems.length === 0, problems })
        await sleep(200)
      }
      const failed = results.filter(r => !r.pass).length
      finish({ ok: failed === 0, failed, results }, failed === 0 ? 0 : 1)
    } catch (e) {
      finish({ ok: false, error: e.message, results }, 1)
    }
  })
})
setTimeout(() => finish({ ok: false, error: 'watchdog 180s' }, 1), 180000)
require(path.join(PROJECT_ROOT, 'electron', 'main.js'))

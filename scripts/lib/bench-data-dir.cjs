/**
 * 基准脚本的临时数据目录工具。
 *
 * 背景（2026-09-20 磁盘事故）：scripts/bench-changelog-*.cjs 等脚本原先用
 * fs.mkdtempSync 建临时目录，再用 fs.linkSync 把 GenshinWikiData 下的图包
 * “硬链接”进去，失败则回退到 fs.copyFileSync。但在 macOS 上，系统临时目录
 * （/private/var/folders/.../T）**禁止跨目录硬链接**（EPERM），于是每次都真实
 * 复制约 1.6GB 图片库；这些脚本又缺少退出清理，最终 4 个脚本累积了 47 个残留
 * 目录、占用 79.75GB，把可用空间从约 110GB 压到约 30GB。
 *
 * 现改为：优先 symlink（实测临时目录允许符号链接，占用 0B、读取正常），
 * 回退到 fs.cpSync（比 copyFileSync 更快）；并且无论以何种方式退出都清理。
 */

const fs = require('fs')
const os = require('os')
const path = require('path')

const REAL_DATA = '/Users/stargomia/Files/GenshinWikiData'
const DB_FILES = ['silvermoon_terminal.db', 'user.db', 'user.json']

/**
 * 建立基准脚本的临时数据目录。
 *
 * 返回值里的 cleanup 会在进程退出时自动执行（已注册 process.once('exit')），
 * 因此正常结束无需手工调用；脚本自行 catch 到致命错误后直接 process.exit()
 * 也能触发清理。若脚本想在退出前立刻清理，可显式调用返回值上的 cleanup。
 *
 * @param {string} prefix 临时目录前缀，例如 'silvermoon-prio-'
 * @returns {{ tmpRoot: string, profileDir: string, dataDir: string, strategy: string, cleanup: () => void }}
 */
function createBenchDataDir(prefix) {
  if (!fs.existsSync(REAL_DATA)) {
    throw new Error(`基准数据源不存在，拒绝启动：${REAL_DATA}`)
  }

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  const profileDir = path.join(tmpRoot, 'profile')
  const dataDir = path.join(tmpRoot, 'data')
  fs.mkdirSync(profileDir, { recursive: true })
  fs.mkdirSync(dataDir, { recursive: true })

  // 只复制数据库等小文件；图包用符号链接，避免每跑一次就多占约 1.6GB
  for (const f of DB_FILES) {
    const src = path.join(REAL_DATA, f)
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dataDir, f))
  }

  let strategy = 'none'
  const imagePacks = fs.readdirSync(REAL_DATA)
    .filter(e => e.startsWith('images-'))
    .filter(e => { try { return fs.statSync(path.join(REAL_DATA, e)).isDirectory() } catch (_) { return false } })

  if (imagePacks.length) {
    let linked = 0
    for (const entry of imagePacks) {
      const src = path.join(REAL_DATA, entry)
      const dst = path.join(dataDir, entry)
      try {
        fs.symlinkSync(src, dst, 'dir')
        linked++
      } catch (_) {
        try { fs.cpSync(src, dst, { recursive: true, force: true }) } catch (_) {}
      }
    }
    strategy = linked === imagePacks.length
      ? `symlink (${linked} 个图包，占用 0B)`
      : `${linked}/${imagePacks.length} 个图包符号链接，其余为真实复制`
  }

  fs.writeFileSync(path.join(profileDir, 'config.json'),
    JSON.stringify({ dbDir: dataDir, activeBaseDb: 'silvermoon_terminal.db' }, null, 2))

  const { app } = require('electron')
  app.setPath('userData', profileDir)

  let cleaned = false
  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }) } catch (_) {}
  }

  // 多重兜底：Electron 的 app.exit() 会跳过 before-quit，个别情况下还会让
  // 自动化进程在 rm 之后重新写回残留（实测会剩约 8KB 空壳）。因此三种退出
  // 路径都挂上，保证脚本无论怎么结束都不留目录。
  process.once('exit', cleanup)
  try { app.once('will-quit', cleanup) } catch (_) {}
  try { app.once('before-quit', cleanup) } catch (_) {}
  for (const sig of ['SIGINT', 'SIGTERM']) {
    try {
      process.once(sig, () => {
        cleanup()
        process.exit(sig === 'SIGINT' ? 130 : 143)
      })
    } catch (_) {}
  }

  return { tmpRoot, profileDir, dataDir, strategy, cleanup }
}

/**
 * 清扫历史遗留的基准临时目录。
 *
 * 只删除「确实是基准脚本建的」目录：必须匹配 silvermoon- 或 sm- 前缀，并且含有
 * 基准脚本必定写入的 markers（profile/config.json 或 data/silvermoon_terminal.db），
 * 因此不会误删临时目录里的其他内容。
 *
 * @param {{ dryRun?: boolean, prefixes?: string[] }} [opts]
 * @returns {{ scanned: number, deleted: number, bytes: number, kept: string[], targets: string[] }}
 */
function sweepStaleBenchDirs(opts = {}) {
  const dryRun = opts.dryRun !== false
  const prefixes = opts.prefixes || ['silvermoon-', 'sm-']
  const base = os.tmpdir()
  const result = { scanned: 0, deleted: 0, bytes: 0, kept: [], targets: [] }

  let entries = []
  try { entries = fs.readdirSync(base, { withFileTypes: true }) } catch (_) { return result }

  for (const e of entries) {
    if (!e.isDirectory()) continue
    if (!prefixes.some(p => e.name.startsWith(p))) continue
    const dir = path.join(base, e.name)
    const isMine = fs.existsSync(path.join(dir, 'profile', 'config.json')) ||
                   fs.existsSync(path.join(dir, 'data', 'silvermoon_terminal.db'))
    // 正常退出后可能只剩空壳：脚本的 run 目录被删掉，仅余 Chromium 在退出瞬间
    // 重新写回的 profile/Cache 与 profile/Network Persistent State（约 8KB）。
    // 这类目录已不含数据，一并清理。
    let isShell = false
    if (!isMine) {
      try {
        const inner = fs.readdirSync(dir)
        isShell = inner.length === 1 && inner[0] === 'profile' &&
                  !fs.existsSync(path.join(dir, 'data'))
      } catch (_) {}
    }
    if (!isMine && !isShell) { result.kept.push(dir); continue }

    result.scanned++
    result.targets.push(dir)
    let size = 0
    try {
      const walk = d => {
        for (const f of fs.readdirSync(d, { withFileTypes: true })) {
          const p = path.join(d, f.name)
          if (f.isDirectory()) walk(p)
          else { try { size += fs.lstatSync(p).size } catch (_) {} }
        }
      }
      walk(dir)
    } catch (_) {}
    result.bytes += size

    if (!dryRun) {
      try { fs.rmSync(dir, { recursive: true, force: true }); result.deleted++ } catch (_) {}
    }
  }
  return result
}

if (require.main === module) {
  const dryRun = !process.argv.includes('--delete')
  const r = sweepStaleBenchDirs({ dryRun })
  const gb = (r.bytes / 1024 ** 3).toFixed(2)
  console.log(dryRun
    ? `[预览] 匹配到 ${r.scanned} 个基准临时目录，合计约 ${gb} GB（未删除）`
    : `[已清理] 删除 ${r.deleted}/${r.scanned} 个目录，回收约 ${gb} GB`)
  if (r.kept.length) console.log(`保留（非基准目录）: ${r.kept.length} 个`)
  if (dryRun && r.scanned) console.log('确认后执行：node scripts/lib/bench-data-dir.cjs --delete')
}

module.exports = { createBenchDataDir, sweepStaleBenchDirs, REAL_DATA }

// ═══════════════════════════════════════════════════════════════════════════
//  ⚠️  磁盘安全：Electron 测试脚本的临时沙箱  ⚠️
// ═══════════════════════════════════════════════════════════════════════════
//
//  这个文件是为了不再重演同一场事故而存在的，动手改测试脚本前请先读完。
//
//  ── 事故经过 ──────────────────────────────────────────────────────────────
//  测试脚本要跑真实主进程，就得给它一份可写的数据库 + 图包。图包（images-*）
//  有 1.7 GB，于是早期写法用「硬链接，失败就复制」把它搬进临时目录：
//
//      try { fs.linkSync(s, d) } catch (_) { fs.copyFileSync(s, d) }
//
//  但 macOS 的 TMPDIR（/var/folders/…）与 /Users 分属不同 APFS 卷，硬链接必然
//  以 EXDEV 失败 —— 兜底分支成了唯一分支：**每跑一次脚本就真复制 1.7 GB**。
//  偏偏退出走的是 Electron 的 app.exit()，它不触发 Node 的 'exit' 钩子，
//  fs.rmSync 清理从未执行。两个缺陷叠加，临时目录一个个堆积，
//  单次事故实测吃掉 12 GB，且「过去经常出现」。
//
//  ── 正确做法（本模块已封装）──────────────────────────────────────────────
//  1. 图包用 APFS 写时复制克隆（cp -Rc / clonefile）：与真目录无差别，
//     但只有被修改的块才额外占盘 —— 正常运行零额外占用。
//     ⚠️ 不能用符号链接：主进程遍历图包时只认 Dirent.isDirectory()/isFile()，
//        符号链接两者都为 false，会被直接跳过，图全丢。
//  2. 清理必须**同步执行**，且在退出之前：本模块劫持 app.exit / process.exit，
//     并额外挂上 will-quit / SIGINT / SIGTERM，杜绝「跳过了清理」。
//  3. 启动时先扫掉历史上漏下的同名临时目录，并打印回收了多少。
//  4. 建好沙箱后实测占用：若远大于数据库体积，说明克隆退化成真复制，
//     立刻大声告警（而不是等到磁盘被吃满才发现）。
//
//  ── 用法 ─────────────────────────────────────────────────────────────────
//      const { cloneTree, sweepLeftovers, makeCleanup, installCleanupHook,
//              guardSandboxSize, fmtBytes } = require('./lib/sandbox.cjs')
//      const freed = sweepLeftovers(['silvermoon-xxx-'])        // 启动先自愈
//      cloneTree(src, dst)                                       // 代替 linkTree
//      const cleanup = makeCleanup(tmpRoot)
//      installCleanupHook(cleanup)                               // 退出必清
//      guardSandboxSize(tmpRoot)                                 // 占用异常就告警
// ═══════════════════════════════════════════════════════════════════════════

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

/** 记录每次 cloneTree 的真实结果（clone / copy / failed），供 guardSandboxSize 判据 */
const _cloneModes = []

/** 启动自愈的战果，留给 guardSandboxSize 复述（那个时点日志一定已经可用） */
let _sweepReport = null

/**
 * 输出诊断信息。
 * ⚠️ 不能用 console.log：本模块在 require 阶段（Electron 主进程最早期）就要打印
 *    自愈结果，此时 stdout 还没接好，console.log 会被直接丢掉 —— 实测「删掉了但没日志」。
 *    直接写 fd 2 是同步且不经过缓冲的。
 */
function emit(line) {
  try { fs.writeSync(2, line + String.fromCharCode(10)) }
  catch (_) { try { console.log(line) } catch (_) {} }
}

/** 沙箱建好后卷可用空间的下降幅度超过它就告警（正常克隆只有个位数 MB） */
const SANDBOX_SIZE_WARN_BYTES = 300 * 1024 * 1024

/**
 * 卷的可用字节数。
 * ⚠️ 为什么不用 du 判断沙箱体积：APFS 克隆（clonefile）是块级共享，
 *    du 没有跨文件去重、会把共享的块在每个文件上各算一遍 —— 克隆 1.7 GB 的图包
 *    du 照样报 1.7 GB，而 df 实测只掉了 9 MB。用 du 做阈值判断必然误报。
 */
function volumeFreeBytes(p) {
  try {
    const out = execFileSync('df', ['-k', p || os.tmpdir()], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] })
    const line = out.trim().split(String.fromCharCode(10)).pop() || ''
    const cols = line.split(/\s+/)
    return (parseInt(cols[3], 10) || 0) * 1024
  } catch (_) { return 0 }
}

function fmtBytes(n) {
  const b = Number(n) || 0
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`
}

/**
 * 目录的「逻辑体积」（du）。
 * ⚠️ 对 APFS 克隆会严重高估（共享块被重复计数）。仅用于展示，
 *    判断是否真的占盘请用 volumeFreeBytes() 的前后差值。
 */
function duBytes(p) {
  try {
    const out = execFileSync('du', ['-sk', p], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] })
    return (parseInt(out.trim().split(/\s+/)[0], 10) || 0) * 1024
  } catch (_) { return 0 }
}

/**
 * 启动自愈：清掉历史上漏下的临时目录。
 * @param {string[]} prefixes 例如 ['silvermoon-sim-', 'silvermoon-race-']
 * @returns {number} 回收的字节数
 */
function sweepLeftovers(prefixes) {
  let freed = 0
  let count = 0
  let tmp
  try { tmp = os.tmpdir() } catch (_) { return 0 }
  let entries = []
  try { entries = fs.readdirSync(tmp) } catch (_) { return 0 }
  for (const e of entries) {
    if (!prefixes.some(p => e.startsWith(p))) continue
    const full = path.join(tmp, e)
    try {
      if (!fs.statSync(full).isDirectory()) continue
      const size = duBytes(full)
      fs.rmSync(full, { recursive: true, force: true })
      freed += size
      count++
    } catch (_) { /* 删不掉就跳过，不影响本次运行 */ }
  }
  _sweepReport = count > 0 ? { count, freed } : null
  if (count > 0) {
    // 回收量用 df 差值更准，但这里已经删完了，只能报 du 的逻辑体积（对克隆会偏高）
    emit(`[sandbox] 启动自愈：清理了 ${count} 个历史遗留临时目录（逻辑体积 ${fmtBytes(freed)}）`)
  }
  return freed
}

/**
 * 把 src 目录复制到 dst —— 优先用 APFS 写时复制克隆（几乎不额外占盘）。
 * 这是 linkTree（硬链接 + 复制兜底）的正确替代品。
 */
function cloneTree(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true })
  try {
    execFileSync('cp', ['-Rc', src, dst], { stdio: 'ignore' })   // -c = clonefile
    _cloneModes.push('clone')
    return 'clone'
  } catch (_) {
    // 克隆不可用（非 APFS 卷等）时退化为真复制，此时会真占盘，由调用方告警
  }
  try { fs.cpSync(src, dst, { recursive: true }); _cloneModes.push('copy'); return 'copy' }
  catch (_) { _cloneModes.push('failed'); return 'failed' }
}

/**
 * 返回一个幂等的清理函数：同步删除临时目录，并打印回收量。
 * 必须**在进程退出之前**调用（见 installCleanupHook）。
 */
function makeCleanup(tmpRoot) {
  let cleaned = false
  return function cleanup() {
    if (cleaned) return 0
    cleaned = true
    const before = volumeFreeBytes(tmpRoot)
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }) } catch (_) {}
    // 用 df 差值报真实回收量；克隆部分本来就没占盘，du 会虚报成 GB 级
    const freed = before > 0 ? Math.max(0, volumeFreeBytes(tmpRoot) - before) : 0
    emit(`[sandbox] 已清理临时目录${freed > 0 ? `，实际回收 ${fmtBytes(freed)}` : '（图包为克隆，未占用额外空间）'}`)
    return freed
  }
}

/**
 * 让清理无法被绕过。
 * 关键：Electron 的 app.exit() 不会触发 Node 的 'exit' 事件 —— 事故的成因之一
 * 就是脚本把清理挂在 process.on('exit') 上、退出却走 app.exit()。
 * 这里直接劫持 app.exit / process.exit，并补上 will-quit 与信号处理。
 */
function installCleanupHook(cleanup) {
  const safe = () => { try { cleanup() } catch (_) {} }

  try {
    const { app } = require('electron')
    if (app && !app.__sandboxHooked) {
      app.__sandboxHooked = true
      const origExit = app.exit.bind(app)
      app.exit = (code) => { safe(); return origExit(code) }
      app.once('will-quit', safe)
      app.once('before-quit', safe)
    }
  } catch (_) { /* 非 Electron 环境（纯 node 测试）走下面的 process 钩子 */ }

  if (!process.__sandboxHooked) {
    process.__sandboxHooked = true
    const origExit = process.exit.bind(process)
    process.exit = (code) => { safe(); return origExit(code) }
    process.once('exit', safe)
    process.once('SIGINT', () => { safe(); origExit(130) })
    process.once('SIGTERM', () => { safe(); origExit(143) })
    process.once('uncaughtException', (e) => { safe(); emit(String(e && e.stack || e)); origExit(1) })
  }
  return safe
}

/**
 * 沙箱建好后自检占盘：正常情况下整个临时目录只有数据库那几十 MB。
 * 一旦接近图包体积，说明克隆退化成真复制 —— 立刻大声告警。
 */
function guardSandboxSize(tmpRoot, { label = '', freeBefore = 0 } = {}) {
  // 权威判据 1：cloneTree 是否真的走了 clonefile
  const copied = _cloneModes.filter(m => m !== 'clone')
  // 权威判据 2：卷可用空间的真实下降（du 对克隆会虚报，不能用）
  const grew = freeBefore > 0 ? Math.max(0, freeBefore - volumeFreeBytes(tmpRoot)) : 0
  const size = grew

  if (copied.length > 0 || size > SANDBOX_SIZE_WARN_BYTES) {
    const msg = [
      '',
      '╔════════════════════════════════════════════════════════════════════╗',
      '║  ⚠️  临时沙箱异常膨胀，图包克隆很可能退化成了真复制！            ║',
      '╚════════════════════════════════════════════════════════════════╝',
      `  临时目录：${tmpRoot}`,
      `  真实占盘：${fmtBytes(size)}（正常应只有个位数 MB）`,
      `  克隆状态：${_cloneModes.join(', ') || '未记录'}${copied.length ? '  ← 有目录退化为真复制' : ''}`,
      '  后果：每次运行都会真占这么多盘，且退出清理一旦漏掉就会堆积。',
      '  排查：1) 确认 TMPDIR 与数据目录在同一 APFS 容器（cp -Rc 才能克隆）；',
      '        2) 确认没有把 cloneTree 换回 fs.linkSync / fs.copyFileSync。',
      '',
    ].join('\n')
    emit(msg)
    return { ok: false, size, modes: [..._cloneModes] }
  }
  emit(`[sandbox]${label ? ' ' + label : ''} 临时沙箱实际占盘 ${fmtBytes(size)}`
    + `（逻辑体积 ${fmtBytes(duBytes(tmpRoot))}，图包走 APFS 克隆不额外占盘）`)
  if (_sweepReport) {
    emit(`[sandbox] 本次启动顺带回收了 ${_sweepReport.count} 个历史遗留临时目录`)
  }
  return { ok: true, size, modes: [..._cloneModes] }
}

module.exports = {
  SANDBOX_SIZE_WARN_BYTES,
  fmtBytes,
  duBytes,
  volumeFreeBytes,
  sweepLeftovers,
  cloneTree,
  makeCleanup,
  installCleanupHook,
  guardSandboxSize,
}

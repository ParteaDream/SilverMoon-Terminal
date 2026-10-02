#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
//  一键清理测试脚本留下的临时沙箱
//      npm run clean:temp            查看 + 清理
//      npm run clean:temp -- --dry   只看不删
// ═══════════════════════════════════════════════════════════════════════════
//
//  为什么需要它：scripts/*.cjs 跑真实主进程时要在 TMPDIR 建临时数据目录。
//  正常退出会由 installCleanupHook 清掉，但**异常终止救不了**——
//  实测 test:crawler:e2e 在本机因 GPU 沙箱失败被 SIGTRAP 打死，
//  任何退出钩子都不会执行，目录就留下了。历史上这类残留累积到过 79.75 GB。
//  所以每个脚本启动时都会先 sweep 自己的前缀，这里则是给人和 CI 用的汇总入口。
//
//  ⚠️ 只删 TMPDIR 下以 silvermoon- 开头的目录，绝不碰别的东西。
// ═══════════════════════════════════════════════════════════════════════════

const fs = require('fs')
const os = require('os')
const path = require('path')
const { fmtBytes, duBytes, volumeFreeBytes } = require('./lib/sandbox.cjs')

const DRY = process.argv.includes('--dry')
const PREFIX = 'silvermoon-'
const tmp = os.tmpdir()

const found = []
for (const e of fs.readdirSync(tmp)) {
  if (!e.startsWith(PREFIX)) continue
  const full = path.join(tmp, e)
  try {
    if (!fs.statSync(full).isDirectory()) continue
    found.push({ name: e, full, size: duBytes(full) })
  } catch (_) { /* 读不到就跳过 */ }
}

if (found.length === 0) {
  console.log(`✓ 没有测试临时目录残留（${tmp}）`)
  process.exit(0)
}

found.sort((a, b) => b.size - a.size)
console.log(`发现 ${found.length} 个测试临时目录，位于 ${tmp}\n`)
console.log('  ' + '逻辑体积'.padEnd(10) + '目录')
for (const f of found) {
  console.log('  ' + fmtBytes(f.size).padEnd(12) + f.name)
}
const logical = found.reduce((a, f) => a + f.size, 0)
console.log(`\n逻辑体积合计 ${fmtBytes(logical)}`)
console.log('提示：图包走 APFS 克隆，逻辑体积会严重高估真实占用，下面按 df 差值给真实回收量。')

if (DRY) {
  console.log('\n（--dry：未删除）')
  process.exit(0)
}

const before = volumeFreeBytes(tmp)
let removed = 0
for (const f of found) {
  try { fs.rmSync(f.full, { recursive: true, force: true }); removed++ } catch (_) {}
}
const freed = Math.max(0, volumeFreeBytes(tmp) - before)
console.log(`\n✓ 删除 ${removed}/${found.length} 个目录，实际回收 ${fmtBytes(freed)}`)
if (freed === 0 && removed > 0) {
  console.log('  （回收为 0 说明它们本就是克隆，只占目录项，没吃盘）')
}

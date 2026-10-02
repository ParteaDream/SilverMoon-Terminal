#!/usr/bin/env node
/**
 * fix-book-ids.mjs — 把已爬取的书籍主键对齐到米游社观测枢的 content_id
 *
 * 背景：书籍爬虫最初用的是「MAX(id)+1」的本地顺序号，于是《至冬国通史》在库里是
 * 41、在观测枢却是 509470（网址 baike.mihoyo.com/ys/obc/content/509470/detail）。
 * 爬虫已改成直接用 content_id 建条目，这个脚本负责把**历史遗留**的条目一次性对齐，
 * 并级联改写 book_volumes.book_id 与所有引用书籍 id 的地方。
 *
 * 用法:
 *   node scripts/fix-book-ids.mjs --db <path>            只检查，打印将要做的修改
 *   node scripts/fix-book-ids.mjs --db <path> --apply    备份后实际写入
 *   node scripts/fix-book-ids.mjs --data-dir <目录>       自动挑目录里版本号最高的基准库
 *
 * ⚠️ 运行前请先退出银月终端：应用把整库读进内存，运行中改写会被它下次保存覆盖。
 *
 * 主键规则:
 *   · 有观测枢页面的书 → id = books.mihoyo_id（爬虫早就把 content_id 存下来了）
 *   · 观测枢没有的 15 本（图鉴=否 的任务/隐藏书籍）→ 900001 起的最小空闲号
 *
 * 写入是**一次性事务**：先把所有待改的主键挪到负值区腾位置，再写最终值，
 * 避免 A→B 时 B 还被别人占着（SQLite 主键是即时的，不这么做会撞 UNIQUE）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const initSqlJs = require('sql.js')

const LOCAL_BOOK_ID_BASE = 900001
// 腾位置用的负值区，越界概率可忽略
const TEMP_OFFSET = -100000000

function parseArgs(argv) {
  const out = { db: null, apply: false, dataDir: null }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--db' && argv[i + 1]) out.db = path.resolve(argv[++i])
    else if (argv[i] === '--data-dir' && argv[i + 1]) out.dataDir = path.resolve(argv[++i])
    else if (argv[i] === '--apply') out.apply = true
  }
  return out
}

/** 没给 --db 时，从数据库目录里挑出版本号最高的基准库（与设置页同一套命名） */
function pickDefaultDb(dataDir) {
  const files = fs.readdirSync(dataDir)
    .filter(f => /^silvermoon_terminal-v[\d.]+\.db$/.test(f))
    .sort((a, b) => {
      const pa = a.match(/v([\d.]+)/)[1].split('.').map(Number)
      const pb = b.match(/v([\d.]+)/)[1].split('.').map(Number)
      for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const d = (pb[i] || 0) - (pa[i] || 0)
        if (d) return d
      }
      return 0
    })
  if (files.length > 0) return path.join(dataDir, files[0])
  const plain = path.join(dataDir, 'silvermoon_terminal.db')
  return fs.existsSync(plain) ? plain : null
}

function beijingStamp() {
  const now = new Date(Date.now() + 8 * 3600 * 1000)
  return now.toISOString().replace(/[:.]/g, '-').slice(0, 19)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  let dbPath = args.db
  if (!dbPath && args.dataDir) dbPath = pickDefaultDb(args.dataDir)
  if (!dbPath || !fs.existsSync(dbPath)) {
    console.error('用法: node scripts/fix-book-ids.mjs --db <数据库路径> [--apply]')
    console.error('      数据库路径也可用 --data-dir <数据库目录> 自动挑选')
    process.exit(1)
  }

  const SQL = await initSqlJs()
  const db = new SQL.Database(fs.readFileSync(dbPath))

  const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='books'")
  if (!tables.length) {
    console.log(`✗ ${dbPath} 里没有 books 表，无需处理`)
    return
  }

  const rows = db.exec('SELECT id, name_zh, mihoyo_id FROM books ORDER BY id')[0]?.values || []
  console.log(`数据库: ${dbPath}`)
  console.log(`书籍条目: ${rows.length}\n`)
  if (rows.length === 0) return

  // ── 目标主键 ──
  // reserved = 「本次分配里不能被新占用的号」：所有观测枢目标号 + 保持不动的本地号。
  // 关键点：一本**已经**在本地段位的书要保留自己的号，不能被别人抢走，也不能被
  // 自己挤走（早期版本把「现有 id 全塞进 used」导致重跑一次就整体后移一格）。
  const reserved = new Set()
  const changes = []
  const unchanged = []
  const skipped = []
  const pending = []   // 需要新分配本地号的书

  for (const [id, name, mihoyoId] of rows) {
    const oldId = Number(id)
    const target = Number(mihoyoId) || null
    if (target != null) {
      reserved.add(target)
      if (target === oldId) unchanged.push({ oldId, name, newId: oldId, kind: '观测枢' })
      else changes.push({ oldId, name, newId: target, kind: '观测枢' })
    } else if (oldId >= LOCAL_BOOK_ID_BASE) {
      reserved.add(oldId)
      unchanged.push({ oldId, name, newId: oldId, kind: '本地段位' })
    } else {
      pending.push({ oldId, name, newId: null, kind: '本地段位' })
    }
  }

  // 给「观测枢没有、也还没落到本地段位」的书分配最小空闲号
  let nextLocal = LOCAL_BOOK_ID_BASE
  const allocLocal = () => {
    while (reserved.has(nextLocal)) nextLocal++
    reserved.add(nextLocal)
    return nextLocal++
  }
  for (const c of pending) {
    c.newId = allocLocal()
    changes.push(c)
  }

  // 目标值撞车（两个条目指向同一个观测枢 ID）时只保留一个，其余退到本地段位
  const seenTarget = new Map()
  for (const c of changes) {
    if (c.kind !== '观测枢') continue
    if (seenTarget.has(c.newId)) {
      skipped.push({ oldId: c.oldId, name: c.name, reason: `与「${seenTarget.get(c.newId)}」争用观测枢 ID ${c.newId}，改用本地号` })
      c.newId = allocLocal()
      c.kind = '本地段位'
    } else {
      seenTarget.set(c.newId, c.name)
    }
  }

  if (changes.length === 0) {
    console.log('✓ 所有书籍主键都已对齐，无需修改')
    if (skipped.length) for (const s of skipped) console.log(`  ! ${s.name}: ${s.reason}`)
    return
  }

  console.log(`待修改 ${changes.length} 条：`)
  for (const c of changes.sort((a, b) => a.oldId - b.oldId)) {
    console.log(`  ${String(c.oldId).padStart(6)} → ${String(c.newId).padStart(7)}  [${c.kind}]  ${c.name}`)
  }
  if (skipped.length) {
    console.log('\n注意：')
    for (const s of skipped) console.log(`  ! ${s.name}: ${s.reason}`)
  }
  const localCount = changes.filter(c => c.kind === '本地段位').length
  console.log(`\n其中观测枢 ID ${changes.length - localCount} 条，本地段位 ${localCount} 条`)

  if (!args.apply) {
    console.log('\n（预览模式，未写入。加 --apply 才会备份并执行）')
    return
  }

  // ── 备份 ──
  const backupPath = `${dbPath}.bak-${beijingStamp()}`
  fs.copyFileSync(dbPath, backupPath)
  console.log(`\n已备份: ${backupPath}`)

  const hasVolumes = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='book_volumes'").length > 0

  // ── 两阶段改写 ──
  // 阶段 1：把所有待改的主键与它们的卷外键一起挪到负值区（腾出目标号）
  db.exec('BEGIN')
  try {
    for (const c of changes) {
      db.run('UPDATE books SET id = ? WHERE id = ?', [c.oldId + TEMP_OFFSET, c.oldId])
      if (hasVolumes) db.run('UPDATE book_volumes SET book_id = ? WHERE book_id = ?', [c.oldId + TEMP_OFFSET, c.oldId])
    }
    // 阶段 2：从负值区写到最终值
    for (const c of changes) {
      db.run('UPDATE books SET id = ? WHERE id = ?', [c.newId, c.oldId + TEMP_OFFSET])
      if (hasVolumes) db.run('UPDATE book_volumes SET book_id = ? WHERE book_id = ?', [c.newId, c.oldId + TEMP_OFFSET])
    }
    db.exec('COMMIT')
  } catch (e) {
    try { db.exec('ROLLBACK') } catch (_) {}
    console.error('\n✗ 写入失败已回滚:', e.message)
    console.error(`  数据库未被修改，备份仍在: ${backupPath}`)
    process.exit(1)
  }

  const buf = Buffer.from(db.export())
  fs.writeFileSync(dbPath, buf)
  db.close()

  // ── 自检 ──
  const check = new SQL.Database(fs.readFileSync(dbPath))
  const after = check.exec('SELECT COUNT(*), MIN(id), MAX(id) FROM books')[0].values[0]
  const badVols = hasVolumes
    ? check.exec('SELECT COUNT(*) FROM book_volumes v LEFT JOIN books b ON b.id = v.book_id WHERE b.id IS NULL')[0].values[0][0]
    : 0
  console.log(`\n✓ 完成：books ${after[0]} 行，id 范围 ${after[1]} ~ ${after[2]}`)
  console.log(`  孤立卷（book_id 找不到对应书）: ${badVols}`)
  console.log('  请重新启动银月终端（运行中的实例会把内存里的旧数据写回去）')
  check.close()
  if (badVols > 0) {
    console.log(`  ! 有孤立卷，可从备份恢复: ${backupPath}`)
    process.exit(1)
  }
}

main().catch(e => { console.error('✗', e.message); process.exit(1) })

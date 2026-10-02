#!/usr/bin/env node
/**
 * fix-weapon-names.mjs — 用线上权威数据校正武器名称（中文名 + 英文名）
 *
 * 背景：武器爬虫此前从不写 name_zh，英文名又只在爬取结果非空时才写，
 * 于是早期爬下来的占位名（"Weapon: Sword"）和过期译名一直留在库里。
 * 爬虫已修好，这个脚本负责把**历史遗留**的条目一次性对齐。
 *
 * 用法:
 *   node scripts/fix-weapon-names.mjs --db <path>            只检查，打印将要做的修改
 *   node scripts/fix-weapon-names.mjs --db <path> --apply    实际写入
 *   node scripts/fix-weapon-names.mjs --db <path> --all      连 7.0 之前的老武器一起扫
 *
 * 范围: 默认只处理 **7.0 及以后新增的武器**（依据 version_additions 表）。
 *   7.0 之前条目的名称是照正式数据爬下来的、从未变过，不需要也不应该被改写。
 *
 * 规则:
 *   - 英文名：线上非占位值且与库中不同 → 覆盖（英文名没有唯一约束）
 *   - 中文名：线上值不同、且没有被其它武器占用 → 覆盖（name_zh 有 UNIQUE 约束，
 *     像"星锋剑（旅行者专用幻化）"这类人工消歧名会保留）
 *   - 库里 ID 在线上找不到时只报告，不改动
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { isPlaceholderName, PLACEHOLDER_NAME_RE } = require('../electron/weapon-names.cjs')

const NANOKA = 'https://static.nanoka.cc'

function parseArgs(argv) {
  const out = { db: null, apply: false, all: false }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--db' && argv[i + 1]) { out.db = path.resolve(argv[++i]) }
    else if (argv[i] === '--apply') out.apply = true
    else if (argv[i] === '--all') out.all = true
  }
  return out
}

async function fetchJson(url, timeoutMs = 60000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'SilverMoon-Terminal/repair' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

/** 英文名兜底：列表值是占位/缺失时，单独取一次英文详情页 */
async function resolveEnglishName(version, id, listName) {
  if (listName && !isPlaceholderName(listName)) return listName
  try {
    const en = await fetchJson(`${NANOKA}/gi/${version}/en/weapon/${id}.json`, 25000)
    const n = ((en && en.name) || '').trim()
    if (n && !isPlaceholderName(n)) return n
  } catch (_) {}
  return listName || ''
}

async function resolveVersion() {
  try {
    const manifest = await fetchJson(`${NANOKA}/manifest.json`)
    const gi = manifest?.gi || {}
    if (gi.latest || gi.live || gi.cn) return gi.latest || gi.live || gi.cn
    if (Array.isArray(gi.available) && gi.available.length) return gi.available[gi.available.length - 1]
  } catch (e) {
    console.warn('[version] manifest 获取失败:', e.message)
  }
  return ''
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.db) {
    console.error('用法: node scripts/fix-weapon-names.mjs --db <database-path> [--apply]')
    process.exit(1)
  }
  if (!fs.existsSync(args.db)) {
    console.error(`数据库不存在: ${args.db}`)
    process.exit(1)
  }

  const initSqlJs = require('sql.js')
  const SQL = await initSqlJs()
  const db = new SQL.Database(fs.readFileSync(args.db))

  const version = await resolveVersion()
  if (!version) {
    console.error('无法解析 nanoka 数据版本，终止（不猜测版本号）')
    process.exit(1)
  }
  console.log(`nanoka 数据版本: ${version}`)
  const list = await fetchJson(`${NANOKA}/gi/${version}/weapon.json`)
  console.log(`线上武器条目: ${Object.keys(list).length}`)

  // 7.0 及以后新增的武器（version_additions 是版本归属的权威来源）
  const recentIds = new Set()
  try {
    const st = db.prepare("SELECT item_id FROM version_additions WHERE item_type = 'weapon' AND version >= '7.0'")
    while (st.step()) recentIds.add(String(st.getAsObject().item_id))
    st.free()
  } catch (e) {
    console.warn('读取 version_additions 失败，将扫描全部武器:', e.message)
  }
  const inScope = (id) => args.all || recentIds.size === 0 || recentIds.has(String(id))

  const rows = []
  const stmt = db.prepare('SELECT id, name_zh, name_en, category FROM weapons ORDER BY id')
  while (stmt.step()) rows.push(stmt.getAsObject())
  stmt.free()
  console.log(`范围: ${args.all ? '全部武器' : `7.0+ 新增武器（${recentIds.size} 条，其它条目按"正式数据未变"跳过）`}`)

  const nameOwner = new Map()
  for (const r of rows) nameOwner.set(String(r.name_zh), r.id)   // 撞名判断要看全库

  const changes = []
  const missing = []
  for (const row of rows) {
    if (!inScope(row.id)) continue
    const info = list[String(row.id)]
    if (!info) { missing.push(row); continue }
    const onlineZh = (info.zh || '').trim()
    // 列表里的英文名可能还是占位值（"Weapon: Catalyst"），此时以英文详情页为准
    const onlineEn = (await resolveEnglishName(version, row.id, (info.en || '').trim())).trim()

    // 英文名
    if (onlineEn && !isPlaceholderName(onlineEn) && onlineEn !== (row.name_en || '')) {
      changes.push({ id: row.id, field: 'name_en', from: row.name_en || '', to: onlineEn, zh: row.name_zh })
    }
    // 中文名（撞名则保留本地消歧名）
    if (onlineZh && onlineZh !== row.name_zh) {
      const owner = nameOwner.get(onlineZh)
      if (owner != null && String(owner) !== String(row.id)) {
        console.log(`  · 跳过 ${row.id} 的中文名（"${onlineZh}" 已属于 ${owner}，保留本地名 "${row.name_zh}"）`)
      } else {
        changes.push({ id: row.id, field: 'name_zh', from: row.name_zh, to: onlineZh })
      }
    }
  }

  if (missing.length) {
    console.log(`\n线上找不到的条目（${missing.length}，未改动）:`)
    for (const m of missing) console.log(`  ${m.id} ${m.name_zh}`)
  }

  console.log(`\n待修正 ${changes.length} 处:`)
  for (const c of changes) {
    console.log(`  ${c.id} ${c.field}: ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}${c.zh ? `  (${c.zh})` : ''}`)
  }

  if (!args.apply) {
    console.log('\n（未写入。加 --apply 实际执行）')
    db.close()
    return
  }

  if (changes.length === 0) {
    console.log('\n没有需要修正的条目。')
    db.close()
    return
  }

  // 先备份，再就地更新（优先用 sqlite3 命令行：带事务/日志，比整库重写安全）
  const backup = `${args.db}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`
  fs.copyFileSync(args.db, backup)
  console.log(`\n已备份原库 → ${backup}`)
  db.close()

  const statements = changes.map(c => `UPDATE weapons SET ${c.field} = ${sqlLiteral(c.to)} WHERE id = ${Number(c.id)};`)
  const applied = applyWithSqliteCli(args.db, statements)
  if (!applied) {
    console.log('未找到 sqlite3 命令行，改用 sql.js 整库重写…')
    const SQL2 = await initSqlJs()
    const db2 = new SQL.Database(fs.readFileSync(args.db))
    for (const stmt of statements) db2.run(stmt)
    fs.writeFileSync(args.db, Buffer.from(db2.export()))
    db2.close()
  }
  console.log(`已写入 ${changes.length} 处修改 → ${args.db}`)
}

function sqlLiteral(v) {
  if (v == null) return 'NULL'
  return "'" + String(v).replace(/'/g, "''") + "'"
}

/** 用 sqlite3 命令行执行（存在则返回 true） */
function applyWithSqliteCli(dbPath, statements) {
  try {
    const probe = spawnSync('sqlite3', ['-version'], { encoding: 'utf-8' })
    if (probe.error || probe.status !== 0) return false
    const script = `PRAGMA foreign_keys = ON;\nBEGIN;\n${statements.join('\n')}\nCOMMIT;\n`
    const res = spawnSync('sqlite3', [dbPath], { input: script, encoding: 'utf-8' })
    if (res.error) return false
    if (res.status !== 0) throw new Error(`sqlite3 执行失败: ${res.stderr || res.status}`)
    return true
  } catch (e) {
    console.warn('sqlite3 写入失败:', e.message)
    return false
  }
}

main().catch(e => { console.error('失败:', e); process.exit(1) })

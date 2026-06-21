#!/usr/bin/env node
/**
 * export-seed.cjs — 从银月终端数据库导出种子 SQL 文件
 *
 * 用法:
 *   node scripts/export-seed.cjs --db <path>
 *
 * 列顺序严格按数据库实际存储顺序（SELECT * 的输出顺序），
 * 确保 VALUES 与列名始终一一对应，不依赖 schema.sql 重映射。
 */
const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
let dbPath = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--db' && args[i + 1]) { dbPath = path.resolve(args[i + 1]); i++; }
}

if (!dbPath) {
  console.error('用法: node scripts/export-seed.cjs --db <database-path>');
  process.exit(1);
}
if (!fs.existsSync(dbPath)) {
  console.error(`错误: 数据库文件不存在: ${dbPath}`);
  process.exit(1);
}

async function main() {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs();
  console.log('sql.js 已加载');

  const buffer = fs.readFileSync(dbPath);
  const db = new SQL.Database(buffer);
  console.log(`已打开数据库: ${dbPath} (${(buffer.length / 1024 / 1024).toFixed(1)} MB)`);

  const tableResult = db.exec(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != 'image_cache' ORDER BY name"
  );
  if (!tableResult.length) { console.error('无数据表'); db.close(); process.exit(1); }
  const tables = tableResult[0].values.map(r => r[0]);
  console.log(`找到 ${tables.length} 个数据表`);

  // ── 表导出顺序 ──
  const tablePriority = {
    elements:1, weapon_types:1, regions:1, enemies:1, settings:1,
    materials:2, characters:2, weapons:2, artifacts:2, wishes:2,
    challenges:2, game_data:2, element_reactions:2,
    character_talents:3, character_constellations:3, character_outfits:3,
    character_stories:3, character_ascension_materials:3, character_talent_materials:3,
    weapon_ascension_materials:3, wish_banners:3,
    spiral_abyss_floors:3, imaginarium_theater_seasons:3, perilous_trail_bosses:3,
    wish_banner_items:4, talent_levels:4,
  };
  const sortedTables = [...tables].sort((a, b) =>
    (tablePriority[a] || 99) - (tablePriority[b] || 99) || a.localeCompare(b)
  );

  function esc(v) {
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
    return `'${String(v).replace(/'/g, "''")}'`;
  }

  function tableToInsert(tableName) {
    let dataResult;
    try {
      dataResult = db.exec(`SELECT * FROM "${tableName}" ORDER BY id`);
    } catch (_) {
      dataResult = db.exec(`SELECT * FROM "${tableName}"`);
    }
    if (!dataResult || !dataResult.length) return null;
    const { columns, values: rows } = dataResult[0];
    if (!rows.length) return null;

    // 过滤孤儿引用（wish_banner_items → wish_banners）
    let filteredRows = rows;
    if (tableName === 'wish_banner_items') {
      // 获取有效的 banner_id 集合
      const bannerResult = db.exec('SELECT id FROM wish_banners');
      const validBannerIds = new Set(bannerResult[0]?.values.map(r => r[0]) || []);
      const bannerIdIdx = columns.indexOf('banner_id');
      if (bannerIdIdx >= 0 && validBannerIds.size > 0) {
        const before = filteredRows.length;
        filteredRows = filteredRows.filter(row => validBannerIds.has(row[bannerIdIdx]));
        if (filteredRows.length < before) {
          console.log(`  ⚠ ${tableName}: 过滤 ${before - filteredRows.length} 条孤儿引用`);
        }
      }
    }

    if (!filteredRows.length) return null;

    const colNames = columns.map(c => `"${c}"`).join(', ');
    const lines = filteredRows.map(row =>
      `  (${row.map(v => esc(v)).join(', ')})`
    );

    return {
      sql: `INSERT INTO "${tableName}" (${colNames}) VALUES\n${lines.join(',\n')};\n\n`,
      count: filteredRows.length,
    };
  }

  // ── 生成 ──
  const dateStr = new Date().toISOString().split('T')[0];
  let out = `-- ============================================================================\n`;
  out += `-- 银月终端数据库 - 种子数据（导出于 ${dateStr}）\n`;
  out += `-- 来源: ${dbPath}\n`;
  out += `-- 不含 image_cache 表数据\n`;
  out += `--\n`;
  out += `-- INSERT INTO → INSERT OR IGNORE INTO 由 main.js 自动转换\n`;
  out += `-- ============================================================================\n\n`;

  let total = 0, count = 0;
  for (const table of sortedTables) {
    const r = tableToInsert(table);
    if (r && r.count > 0) {
      console.log(`  ✓ ${table.padEnd(30)} ${String(r.count).padStart(5)} 行`);
      out += `-- ----------------------------------------------------------------------------\n`;
      out += `-- ${table}\n`;
      out += `-- ----------------------------------------------------------------------------\n`;
      out += r.sql;
      total += r.count;
      count++;
    }
  }

  const outputPath = path.join(__dirname, '..', 'electron', 'seed.sql');
  fs.writeFileSync(outputPath, out, 'utf-8');
  console.log(`\n✅ 导出完成: ${outputPath}`);
  console.log(`   表数: ${count}, 记录: ${total}, 大小: ${(Buffer.byteLength(out)/1024).toFixed(1)} KB`);

  // 清理旧文件
  for (let i = 1; i <= 5; i++) {
    const p = path.join(__dirname, '..', 'electron', `seed_part${i}.sql`);
    if (fs.existsSync(p)) { fs.unlinkSync(p); console.log(`   🗑 已清理: seed_part${i}.sql`); }
  }

  db.close();
}

main().catch(err => { console.error('导出失败:', err); process.exit(1); });

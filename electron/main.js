const { app, BrowserWindow, ipcMain, dialog, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');
const { shell } = require('electron');
const { getDownloadManager, PACK_DOWNLOAD_URLS, GITHUB_ARCHIVE_URLS, loadState, resolveJsDelivrVersion, generateManifestForDir } = require('./download-manager');

// ── 数据库引擎: sql.js (纯 JS, 无原生模块) ──
const initSqlJs = require('sql.js');
let SQL = null; // await initSqlJs() 后赋值

async function ensureSql() {
  if (SQL) return SQL;
  SQL = await initSqlJs();
  console.log('[main] sql.js ready');
  return SQL;
}

let mainWindow;
let db = null;
let userDb = null;          // 用户数据库（非开发者模式下的修改保存于此）
let devMode = false;        // 开发者模式状态（后端同步）
let dualDbMode = true;      // 双数据库模式（默认开启，关闭后只读/写基准库）
let dbDir = null;

const isDev = !app.isPackaged;

// ── 北京时间工具 ──
function beijingISO() {
  const now = new Date();
  // 转换为北京时间 (UTC+8)
  const bj = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return bj.toISOString().replace(/[:.]/g, '-').slice(0, 19);
}
function beijingDateStr() {
  const now = new Date();
  const bj = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return bj.toISOString().split('T')[0];
}

const DATA_VERSION = '6.7.0';

// 从 seed.sql 文件中读取数据版本
function readSeedVersion() {
  const searchDirs = [
    path.join(process.resourcesPath || '', 'app.asar.unpacked', 'electron'),
    path.join(__dirname, '..', 'electron'),
    path.join(__dirname),
  ];
  for (const d of searchDirs) {
    const fp = path.join(d, 'seed.sql');
    if (!fs.existsSync(fp)) continue;
    try {
      // 只读取头部若干行（避免加载整个大文件）
      const head = fs.readFileSync(fp, { encoding: 'utf-8' }).split('\n').slice(0, 10);
      for (const line of head) {
        const m = line.match(/^--\s*数据版本:\s*(.+)/);
        if (m) return m[1].trim();
      }
    } catch (_) {}
  }
  return DATA_VERSION; // 回退
}

// ── 路径工具 ──
function getDbPath(dir) { return path.join(dir, 'silvermoon_terminal.db'); }
// ── 图片包识别 ──
// 优先级: "images-版本号-类型" > "images" > 最大文件夹
// 类型优先级: Extreme > Medium > Lite

const IMAGE_TYPE_PRIORITY = { 'extreme': 3, 'medium': 2, 'lite': 1 };
const OFFICIAL_PACK_TYPES = ['extreme', 'medium', 'lite'];

// 图片包大小缓存（避免重复扫描）
const _packSizeCache = new Map();

function findImagePacks(dir) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries
    .filter(e => {
      if (!e.isDirectory()) return false;
      const name = e.name.toLowerCase();
      if (name === 'user_images' || name === '.thumb') return false;
      return name.includes('images');
    })
    .map(e => ({
      name: e.name,
      path: path.join(dir, e.name),
    }));
}

function getFolderSize(folderPath) {
  // 使用缓存
  if (_packSizeCache.has(folderPath)) return _packSizeCache.get(folderPath);
  try {
    let total = 0;
    const items = fs.readdirSync(folderPath, { withFileTypes: true });
    for (const item of items) {
      const fullPath = path.join(folderPath, item.name);
      if (item.isFile()) {
        try { total += fs.statSync(fullPath).size; } catch (_) {}
      } else if (item.isDirectory()) {
        total += getFolderSize(fullPath);
      }
    }
    _packSizeCache.set(folderPath, total);
    return total;
  } catch (_) { return 0; }
}

function clearSizeCache() { _packSizeCache.clear(); }

// ── 图片路径解析（按文件名匹配，忽略扩展名，递归搜索子目录，同名取最大）──
let _imagePathCache = null; // Map<imagesDir, Map<baseName, { path, size }>>

function clearImagePathCache() {
  _imagePathCache = null;
}

function buildImagePathCache(imagesDir) {
  if (_imagePathCache && _imagePathCache.has(imagesDir)) return _imagePathCache.get(imagesDir);

  const map = new Map(); // baseName → { path, size }
  function walk(dir) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.name.toLowerCase() === 'thumbs.db' || entry.name.toLowerCase() === 'desktop.ini') continue;
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name);
          const base = path.basename(entry.name, ext);
          try {
            const stat = fs.statSync(fullPath);
            const existing = map.get(base);
            if (!existing || stat.size > existing.size) {
              map.set(base, { path: fullPath, size: stat.size });
            }
          } catch (_) {}
        }
      }
    } catch (_) {}
  }
  walk(imagesDir);

  if (!_imagePathCache) _imagePathCache = new Map();
  _imagePathCache.set(imagesDir, map);
  return map;
}

/**
 * 根据存储的图片名（可能带扩展名）在图包中递归定位实际文件
 * - 去除扩展名后按文件名匹配
 * - 递归搜索整个图包目录（含所有子文件夹）
 * - 同名文件取体积最大的
 * @returns {string|null} 完整路径或 null
 */
function resolveImagePath(imagesDir, storedName) {
  if (!storedName) return null;
  const ext = path.extname(storedName);
  const baseName = ext ? path.basename(storedName, ext) : storedName;
  const cache = buildImagePathCache(imagesDir);
  const entry = cache.get(baseName);
  return entry ? entry.path : null;
}
function parseOfficialPackName(name) {
  const m = name.match(/^images-(extreme|medium|lite)$/i);
  return m ? m[1].toLowerCase() : null;
}

// 解析图片包名称格式（官方包 images-{type} 优先级最高）
function parseImagePackName(name) {
  const official = parseOfficialPackName(name);
  if (official) return { version: [9999], type: official };
  const match = name.match(/^images-(.+)-(extreme|medium|lite)$/i);
  if (!match) return null;
  const versionStr = match[1];
  const type = match[2].toLowerCase();
  const versionParts = versionStr.split('.').map(Number);
  if (versionParts.some(v => isNaN(v))) return null;
  return { version: versionParts, type };
}

function selectBestImagePack(packs) {
  if (packs.length === 0) return null;

  // Tier 1: "images-版本号-类型" 格式 — 版本号越新越优先，版本相同看类型
  const tier1 = packs.filter(p => parseImagePackName(p.name) !== null);
  if (tier1.length > 0) {
    tier1.sort((a, b) => {
      const pa = parseImagePackName(a.name);
      const pb = parseImagePackName(b.name);
      const maxLen = Math.max(pa.version.length, pb.version.length);
      for (let i = 0; i < maxLen; i++) {
        const va = pa.version[i] || 0;
        const vb = pb.version[i] || 0;
        if (va !== vb) return vb - va;
      }
      return IMAGE_TYPE_PRIORITY[pb.type] - IMAGE_TYPE_PRIORITY[pa.type];
    });
    return tier1[0];
  }

  // Tier 2: 精确名称 "images"
  const tier2 = packs.find(p => p.name.toLowerCase() === 'images');
  if (tier2) return tier2;

  // Tier 3: 最大的文件夹（按文件数量快速比较，数量相同时按字节大小精细比较）
  const withSizes = packs.map(p => ({ ...p, size: getFolderSize(p.path) }));
  withSizes.sort((a, b) => b.size - a.size);
  return withSizes[0];
}

function getImagesDir(dir) {
  // 检查用户配置中是否手动选择了图包
  let manualSelection = null;
  const userCfgPath = path.join(dir, 'user.json');
  if (fs.existsSync(userCfgPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(userCfgPath, 'utf-8'));
      manualSelection = cfg?.activeImagePack;
    } catch (_) {}
  }

  const packs = findImagePacks(dir);

  if (manualSelection && packs.some(p => p.name === manualSelection)) {
    const selectedPath = path.join(dir, manualSelection);
    if (!fs.existsSync(selectedPath)) fs.mkdirSync(selectedPath, { recursive: true });
    return selectedPath;
  }

  const best = selectBestImagePack(packs);
  if (best) {
    if (!fs.existsSync(best.path)) fs.mkdirSync(best.path, { recursive: true });
    return best.path;
  }

  // 无可用图包，返回 dbDir 本身
  return dir;
}

function getActiveImagePackName(dir) {
  // 返回当前 active 的图包名称（相对于 dbDir 的文件夹名）
  let manualSelection = null;
  const userCfgPath = path.join(dir, 'user.json');
  if (fs.existsSync(userCfgPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(userCfgPath, 'utf-8'));
      manualSelection = cfg?.activeImagePack;
    } catch (_) {}
  }

  const packs = findImagePacks(dir);
  if (manualSelection && packs.some(p => p.name === manualSelection)) {
    return manualSelection;
  }

  const best = selectBestImagePack(packs);
  return best ? best.name : null;
}

function getUserImagesDir(dir) {
  const imgDir = path.join(dir, 'user_images');
  if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });
  return imgDir;
}

function getConfigPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

function loadConfig() {
  const p = getConfigPath();
  if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'));
  return null;
}

function saveConfig(dir) {
  const p = getConfigPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ dbDir: dir }, null, 2));
}

// ── 用户信息文件（存放在数据库文件夹中，独立于数据库文件）──
function getUserConfigPath() {
  if (!dbDir) return null;
  return path.join(dbDir, 'user.json');
}

function loadUserConfig() {
  const p = getUserConfigPath();
  if (p && fs.existsSync(p)) {
    try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch (_) {}
  }
  return {};
}

function saveUserConfig(config) {
  const p = getUserConfigPath();
  if (!p) return;
  fs.writeFileSync(p, JSON.stringify(config, null, 2));
}

// ── 图片缓存已弃用（base64 存入 SQLite 会撑爆 WASM 内存）──

// ── 数据库操作 ──
function openDb(dir) {
  const dbPath = getDbPath(dir);
  if (fs.existsSync(dbPath)) {
    const buf = fs.readFileSync(dbPath);
    db = new SQL.Database(buf);
    console.log('[main] opened existing db, size:', buf.length, 'bytes');
  } else {
    db = new SQL.Database();
    console.log('[main] created new in-memory db');
  }
  db.exec('PRAGMA foreign_keys = OFF');
  migrateSchema();  // 增量迁移：为已有数据库补全新列
  // 尝试打开 user.db（可能不存在）
  openUserDb(dir);
  return dbPath;
}

function closeDatabase() {
  if (!db) return;
  if (dbDir) {
    const data = db.export();
    fs.writeFileSync(getDbPath(dbDir), Buffer.from(data));
  }
  db.close();
  db = null;
  // 同时关闭 user.db
  closeUserDb();
}

function dbSave() {
  if (db && dbDir) {
    fs.writeFileSync(getDbPath(dbDir), Buffer.from(db.export()));
  }
}

// ── User DB (非开发者模式下数据修改保存于此) ──
function getUserDbPath(dir) { return path.join(dir, 'user.db'); }

function openUserDb(dir) {
  const dbPath = getUserDbPath(dir);
  if (fs.existsSync(dbPath)) {
    const buf = fs.readFileSync(dbPath);
    userDb = new SQL.Database(buf);
    console.log('[main] opened existing user.db, size:', buf.length, 'bytes');
    // 确保 schema 完整（如果之前创建时出错，重新应用）
    ensureUserDbSchema();
  } else {
    // 不存在时先不创建——仅在非开发者模式下首次保存数据时创建
    console.log('[main] user.db not found, will create on first non-dev write');
    userDb = null;
  }
  return userDb;
}

function ensureUserDb() {
  if (userDb) return userDb;
  if (!dbDir) return null;
  const dbPath = getUserDbPath(dbDir);
  userDb = new SQL.Database();
  console.log('[main] created new user.db');
  userDb.exec('PRAGMA foreign_keys = OFF');
  // 应用相同的表结构（直接执行 schema.sql，外键约束不会被强制）
  ensureUserDbSchema();
  // 将自增 ID 起始值设为一个较大值，避免与基准库冲突
  try {
    userDb.exec("INSERT OR REPLACE INTO sqlite_sequence (name, seq) SELECT name, 1000000 FROM sqlite_master WHERE type='table'");
  } catch (_) {}
  userDbSave();
  return userDb;
}

function closeUserDb() {
  if (!userDb) return;
  userDbSave();
  userDb.close();
  userDb = null;
}

function userDbSave() {
  if (userDb && dbDir) {
    const data = userDb.export();
    fs.writeFileSync(getUserDbPath(dbDir), Buffer.from(data));
  }
}

function ensureUserDbSchema() {
  if (!userDb) return;
  try {
    // 使用 _user_delta 增量表替代完整表结构
    // 只存储被修改的字段 (table_name, row_id, column_name, new_value)
    userDb.exec(`CREATE TABLE IF NOT EXISTS _user_delta (
      table_name TEXT NOT NULL,
      row_id INTEGER NOT NULL,
      column_name TEXT NOT NULL,
      new_value TEXT,
      op_type TEXT DEFAULT 'update',
      updated_at TEXT DEFAULT (datetime('now', 'localtime')),
      PRIMARY KEY (table_name, row_id, column_name)
    )`);
    console.log('[ensureUserDbSchema] _user_delta table ready');
    // 尝试迁移旧的 user.db 数据（如果有完整表结构的数据）
    try { migrateOldUserDb(); } catch (_) {}
  } catch (e) {
    console.error('[ensureUserDbSchema] error:', e.message);
  }
}

// 从旧版完整表结构的 user.db 迁移数据到 _user_delta（一次性操作）
function migrateOldUserDb() {
  if (!userDb) return;
  const tables = userDb.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_%' AND name != 'sqlite_sequence'");
  if (!tables.length || !tables[0].values) return;
  for (const row of tables[0].values) {
    const tableName = row[0];
    try {
      const data = userDb.exec(`SELECT * FROM "${tableName}"`);
      if (data.length && data[0].values) {
        const cols = data[0].columns;
        for (const valRow of data[0].values) {
          const rowId = valRow[cols.indexOf('id')];
          if (rowId == null) continue;
          for (let i = 0; i < cols.length; i++) {
            if (cols[i] === 'id') continue;
            const val = valRow[i];
            if (val != null) {
              try {
                const safe = String(val).replace(/'/g, "''");
                userDb.exec(`INSERT OR REPLACE INTO _user_delta (table_name, row_id, column_name, new_value, op_type) VALUES ('${tableName}', ${Number(rowId)}, '${cols[i]}', '${safe}', 'update')`);
              } catch (_) {}
            }
          }
        }
      }
      userDb.exec(`DROP TABLE IF EXISTS "${tableName}"`);
      console.log('[migrateOldUserDb] migrated table:', tableName);
    } catch (_) {}
  }
  console.log('[migrateOldUserDb] migration complete');
}

// 从 SQL 中提取主表名（简单解析，仅支持 SELECT FROM table 模式）
function _extractTableName(sql) {
  const trimmed = sql.trim();
  // 匹配 SELECT ... FROM tableName
  const selectMatch = trimmed.match(/^\s*SELECT\s+.+\s+FROM\s+(?:IF NOT EXISTS\s+)?['"`]?(\w+)['"`]?(?:\s|$)/i);
  if (selectMatch) return selectMatch[1];
  // 匹配 INSERT INTO tableName
  const insertMatch = trimmed.match(/^\s*INSERT\s+(?:OR\s+\w+\s+)?INTO\s+['"`]?(\w+)['"`]?\s/i);
  if (insertMatch) return insertMatch[1];
  // 匹配 UPDATE tableName
  const updateMatch = trimmed.match(/^\s*UPDATE\s+(?:OR\s+\w+\s+)?['"`]?(\w+)['"`]?\s/i);
  if (updateMatch) return updateMatch[1];
  // 匹配 DELETE FROM tableName
  const deleteMatch = trimmed.match(/^\s*DELETE\s+FROM\s+['"`]?(\w+)['"`]?\s/i);
  if (deleteMatch) return deleteMatch[1];
  return null;
}

// 从 SQL 中提取所有表名（包括 JOIN 的表）
function _extractAllTableNames(sql) {
  const tables = [];
  const trimmed = sql.trim();
  // 匹配 SELECT ... FROM tableName [alias]
  // alias 是可选的，使用前瞻避免匹配到后续关键词
  const fromRegex = /FROM\s+(?:IF NOT EXISTS\s+)?['"`]?(\w+)['"`]?(?:\s+(?:AS\s+)?['"`]?(\w+)['"`]?)?(?:\s|$)/i;
  const fromMatch = trimmed.match(fromRegex);
  if (fromMatch) {
    tables.push({ name: fromMatch[1], alias: fromMatch[2] || null });
  }
  // 匹配 JOIN tableName [alias]
  const joinRegex = /JOIN\s+(?:IF NOT EXISTS\s+)?['"`]?(\w+)['"`]?\s+(?:(?:AS\s+)?['"`]?(\w+)['"`]?\s+)?/gi;
  let joinMatch;
  while ((joinMatch = joinRegex.exec(trimmed)) !== null) {
    tables.push({ name: joinMatch[1], alias: joinMatch[2] || null });
  }
  return tables;
}

// 解析 SELECT 列中的别名映射
function _extractSelectAliases(sql) {
  // 匹配 SELECT ... FROM 之间的列定义
  const selectEnd = sql.toUpperCase().indexOf('FROM');
  if (selectEnd < 0) return {};
  const selectClause = sql.substring(7, selectEnd).trim(); // 去掉 SELECT
  
  const aliases = {}; // alias_name -> { table_alias, column }
  // 匹配 pattern: alias.column AS alias_name 或 alias.column alias_name
  const colRegex = /['"`]?(\w+)['"`]?\s*\.\s*['"`]?(\w+)['"`]?\s+(?:AS\s+)?['"`]?(\w+)['"`]?/gi;
  let m;
  while ((m = colRegex.exec(selectClause)) !== null) {
    aliases[m[3].toLowerCase()] = { tableAlias: m[1], column: m[2] };
  }
  return aliases;
}

// 从 _user_delta 读取某张表的所有增量修改
function getUserDeltas(tableName) {
  if (!userDb) return [];
  try {
    const result = userDb.exec(`SELECT * FROM _user_delta WHERE table_name = '${tableName.replace(/'/g, "''")}'`);
    if (!result.length || !result[0].values) return [];
    const cols = result[0].columns;
    return result[0].values.map(row => {
      const obj = {};
      for (let i = 0; i < cols.length; i++) obj[cols[i]] = row[i];
      return obj;
    });
  } catch (_) { return []; }
}

// 对 SELECT 结果进行 user.db 增量合并（按字段覆盖，非整行替换）
// 支持处理 JOIN 查询：为所有引用的表应用 delta
function mergeWithUserDbDelta(tableName, baseRows, sql) {
  // 1. 合并主表
  const deltas = getUserDeltas(tableName);
  let merged = applyTableDeltas(baseRows, deltas);

  // 2. 如果有 JOIN，合并关联表
  if (sql) {
    const allTables = _extractAllTableNames(sql);
    const selectAliases = _extractSelectAliases(sql);

    // 建立 alias → tableName 映射
    const aliasToTable = {};
    for (const t of allTables) {
      aliasToTable[t.alias || t.name] = t.name;
    }

    for (const t of allTables) {
      if (t.name === tableName) continue; // 主表已处理
      const joinDeltas = getUserDeltas(t.name);
      if (!joinDeltas.length) continue;

      // 按 row_id 分组
      const joinDeltaMap = new Map();
      for (const d of joinDeltas) {
        if (d.op_type !== 'update') continue;
        const rid = Number(d.row_id);
        if (!joinDeltaMap.has(rid)) joinDeltaMap.set(rid, {});
        joinDeltaMap.get(rid)[d.column_name] = d.new_value;
      }
      if (!joinDeltaMap.size) continue;

      // 查找 FK 列：{table}_id（去掉末尾的 s）
      const tableBase = t.name.replace(/s$/, '');
      const fkCol = `${tableBase}_id`;

      // 为 SELECT 中的列别名建立映射：alias.column → resultColumn
      // 例如 m.name_zh AS material_name → 如果 result 有 material_name 列，则映射
      const aliasColumnMap = {}; // table_alias.column -> result_column
      for (const [aliasName, info] of Object.entries(selectAliases)) {
        if (info.tableAlias === (t.alias || t.name)) {
          aliasColumnMap[info.column] = aliasName;
        }
      }

      // 对每条结果，检查是否需要应用关联表的 delta
      merged = merged.map(row => {
        const fkValue = row[fkCol];
        if (fkValue == null) return row;
        const joinOverrides = joinDeltaMap.get(Number(fkValue));
        if (!joinOverrides) return row;
        // 应用 delta：将关联表列名映射到结果列名
        const rowOverrides = {};
        for (const [col, val] of Object.entries(joinOverrides)) {
          // 如果有别名映射，使用别名；否则直接用列名
          const resultCol = aliasColumnMap[col] || col;
          rowOverrides[resultCol] = val;
        }
        return { ...row, ...rowOverrides };
      });
    }
  }

  return merged;
}

// 对一组基本行应用某张表的 delta（内部工具）
function applyTableDeltas(baseRows, deltas) {
  if (!deltas || !deltas.length) return baseRows || [];

  const deltaMap = new Map();
  const deletedIds = new Set();
  const insertedRows = new Map();

  for (const d of deltas) {
    const rid = Number(d.row_id);
    if (d.op_type === 'delete') { deletedIds.add(rid); continue; }
    if (d.op_type === 'insert') {
      if (!insertedRows.has(rid)) insertedRows.set(rid, {});
      insertedRows.get(rid)[d.column_name] = d.new_value;
      continue;
    }
    if (!deltaMap.has(rid)) deltaMap.set(rid, {});
    deltaMap.get(rid)[d.column_name] = d.new_value;
  }

  const result = [];
  for (const row of (baseRows || [])) {
    const id = Number(row.id);
    if (deletedIds.has(id)) continue;
    const overrides = deltaMap.get(id);
    result.push(overrides ? { ...row, ...overrides } : row);
    deltaMap.delete(id);
  }

  for (const [rid, fields] of insertedRows) {
    result.push({ id: rid, ...fields });
  }
  return result;
}

// 将 UPDATE 语句转换为 _user_delta 增量存储
function storeUpdateAsDelta(targetDb, sql, params = []) {
  const tableMatch = sql.match(/^\s*UPDATE\s+(?:OR\s+\w+\s+)?['"`]?(\w+)['"`]?\s+SET\s+/i);
  if (!tableMatch) return { changes: 0, lastId: null };
  const table = tableMatch[1];

  const setClauseMatch = sql.match(/SET\s+(.+?)\s+WHERE\s+/i);
  if (!setClauseMatch) return { changes: 0, lastId: null };

  const setColumns = [];
  const colRegex = /['"`]?(\w+)['"`]?\s*=\s*\?/g;
  let colMatch;
  while ((colMatch = colRegex.exec(setClauseMatch[1])) !== null) {
    setColumns.push(colMatch[1]);
  }

  if (setColumns.length === 0 || setColumns.length > params.length) return { changes: 0, lastId: null };

  const setId = params[params.length - 1];
  const setValues = params.slice(0, setColumns.length);
  if (setId == null) return { changes: 0, lastId: null };

  let savedCount = 0;
  for (let i = 0; i < setColumns.length; i++) {
    const col = setColumns[i];
    const val = setValues[i];
    try {
      const safeTable = table.replace(/'/g, "''");
      const safeCol = col.replace(/'/g, "''");
      const safeVal = val != null ? String(val).replace(/'/g, "''") : null;
      if (safeVal != null) {
        targetDb.exec(`INSERT OR REPLACE INTO _user_delta (table_name, row_id, column_name, new_value, op_type, updated_at) VALUES ('${safeTable}', ${Number(setId)}, '${safeCol}', '${safeVal}', 'update', datetime('now','localtime'))`);
      }
      savedCount++;
    } catch (e) {
      console.error('[storeUpdateAsDelta] error:', e.message, 'col:', col);
    }
  }

  return { changes: savedCount, lastId: setId };
}

// 清理 user.db 中与基准库一致的多余数据
function optimizeUserDb() {
  if (!userDb || !db) return;
  try {
    const deltas = userDb.exec('SELECT * FROM _user_delta WHERE op_type = \'update\'');
    if (!deltas.length || !deltas[0].values) return;
    const cols = deltas[0].columns;
    const toDelete = []; // { table_name, row_id, column_name }
    const rowsToCheck = {}; // table -> Set of row_ids

    for (const row of deltas[0].values) {
      const rowObj = {};
      for (let i = 0; i < cols.length; i++) rowObj[cols[i]] = row[i];
      const tableName = rowObj.table_name;
      const rowId = Number(rowObj.row_id);
      const colName = rowObj.column_name;
      if (!rowsToCheck[tableName]) rowsToCheck[tableName] = new Set();
      rowsToCheck[tableName].add(rowId);
      toDelete.push({ tableName, rowId, colName, newValue: rowObj.new_value });
    }

    const actuallyDeleted = [];
    for (const item of toDelete) {
      try {
        const baseRows = dbAll(`SELECT "${item.colName}" FROM "${item.tableName.replace(/'/g, "''")}" WHERE id = ?`, [item.rowId]);
        if (baseRows.length > 0) {
          const baseVal = String(baseRows[0][item.colName]);
          if (baseVal === item.newValue) {
            // 与基准库一致 → 删除该 delta
            userDb.exec(`DELETE FROM _user_delta WHERE table_name = '${item.tableName.replace(/'/g, "''")}' AND row_id = ${item.rowId} AND column_name = '${item.colName.replace(/'/g, "''")}'`);
            actuallyDeleted.push(item);
          }
        }
      } catch (_) {}
    }

    // 删除完全为空的整行（没有剩余 delta 的行）
    for (const [tableName, ids] of Object.entries(rowsToCheck)) {
      for (const rowId of ids) {
        try {
          const remaining = userDb.exec(`SELECT COUNT(*) as c FROM _user_delta WHERE table_name = '${tableName.replace(/'/g, "''")}' AND row_id = ${rowId}`);
          if (remaining.length && remaining[0].values && remaining[0].values[0][0] === 0) {
            // 已无任何 delta，该行已自然删除
          }
        } catch (_) {}
      }
    }

    if (actuallyDeleted.length > 0) {
      console.log('[optimizeUserDb] cleaned', actuallyDeleted.length, 'redundant deltas');
    }
  } catch (e) {
    console.error('[optimizeUserDb] error:', e.message);
  }
}

// sql.js: 替换 ? 占位符 (sql.js 的 prepare 不支持参数绑定)
function _replaceParams(sql, params = []) {
  let i = 0;
  return sql.replace(/\?/g, () => {
    const v = params[i++];
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'number') return String(v);
    return `'${String(v).replace(/'/g, "''")}'`;
  });
}

function dbAll(sql, params = []) {
  const replaced = _replaceParams(sql, params);
  const results = [];
  try {
    const stmt = db.prepare(replaced);
    while (stmt.step()) results.push(stmt.getAsObject());
    stmt.free();
  } catch (e) {
    throw new Error(`sql.js query: ${e.message}\nSQL: ${replaced}`);
  }
  return results;
}

function dbRun(sql, params = []) {
  const replaced = _replaceParams(sql, params);
  // 使用 prepare/step/free 替代 run()：更规范地管理 WASM 语句生命周期
  let stmt;
  try {
    stmt = db.prepare(replaced);
    stmt.step();
  } finally {
    if (stmt) stmt.free();
  }
  const changes = db.getRowsModified();
  // 获取最后插入 rowid（仅 INSERT 有效，DDL 语句 last_insert_rowid 不变）
  let lastId = null;
  try {
    const results = db.exec('SELECT last_insert_rowid() as id');
    if (results.length > 0 && results[0].values.length > 0) {
      lastId = results[0].values[0][0];
    }
  } catch (_) { /* non-fatal */ }
  return { changes, lastId };
}

function dbExec(sql) {
  // Use sql.js native exec() which handles statement splitting robustly
  try {
    db.exec(sql);
  } catch (e) {
    console.error('[dbExec] failed:', e.message);
    throw e;
  }
}

// ── 数据库 Schema 迁移（增量更新已有数据库）──
function migrateSchema() {
  if (!db) return;
  try {
    // 确保表已存在（全新内存数据库在 schema.sql 执行前还没有表）
    const tableExists = dbAll("SELECT name FROM sqlite_master WHERE type='table' AND name='game_data'", []).length > 0;
    if (!tableExists) return;

    // 检查 game_data 表是否有 images 列，没有则添加
    const cols = dbAll('PRAGMA table_info(game_data)', []);
    const hasImages = cols.some(c => c.name === 'images');
    if (!hasImages) {
      console.log('[migrate] adding images column to game_data');
      dbRun('ALTER TABLE game_data ADD COLUMN images TEXT');
    }
    const hasTables = cols.some(c => c.name === 'tables');
    if (!hasTables) {
      console.log('[migrate] adding tables column to game_data');
      dbRun('ALTER TABLE game_data ADD COLUMN tables TEXT');
    }

    // Create websites table if not exists (added after initial release)
    dbRun(`CREATE TABLE IF NOT EXISTS websites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title_zh TEXT NOT NULL,
      url TEXT NOT NULL,
      description_zh TEXT,
      icon TEXT,
      image TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    )`);

    // 删除旧的 image_cache 表（base64 图片缓存会撑爆 WASM 内存）
    try { db.exec('DROP TABLE IF EXISTS image_cache'); } catch (_) {}

    // 为 character_outfits 添加 avatar_image 列
    {
      const outfitCols = dbAll('PRAGMA table_info(character_outfits)', []);
      if (!outfitCols.some(c => c.name === 'avatar_image')) {
        console.log('[migrate] adding avatar_image column to character_outfits');
        dbRun('ALTER TABLE character_outfits ADD COLUMN avatar_image TEXT');
      }
    }

    // 为 characters 添加 active_outfit_id 列
    {
      const charCols = dbAll('PRAGMA table_info(characters)', []);
      if (!charCols.some(c => c.name === 'active_outfit_id')) {
        console.log('[migrate] adding active_outfit_id column to characters');
        dbRun('ALTER TABLE characters ADD COLUMN active_outfit_id INTEGER');
      }
    }

    // 创建 version_tags 和 version_additions 表（版本新增数据速览）
    dbRun(`CREATE TABLE IF NOT EXISTS version_tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version TEXT NOT NULL,
      tag TEXT NOT NULL,
      color TEXT DEFAULT '#6366f1',
      sort_order INTEGER DEFAULT 0
    )`);
    dbRun(`CREATE TABLE IF NOT EXISTS version_additions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version TEXT NOT NULL,
      item_type TEXT NOT NULL,
      item_id INTEGER NOT NULL,
      sort_order INTEGER DEFAULT 0,
      UNIQUE(version, item_type, item_id)
    )`);
  } catch (e) {
    console.error('[migrate] error:', e.message);
  }
}

function isDbPopulated() {
  if (!db) return false;
  try {
    const requiredTables = ['characters', 'weapons', 'artifacts', 'materials', 'wishes', 'challenges', 'game_data'];
    for (const table of requiredTables) {
      const stmt = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='${table}'`);
      if (!stmt.step()) { stmt.free(); return false; }
      stmt.free();
    }
    for (const table of requiredTables) {
      const stmt = db.prepare(`SELECT COUNT(*) as cnt FROM ${table}`);
      if (stmt.step()) {
        if (stmt.getAsObject().cnt > 0) { stmt.free(); return true; }
      }
      stmt.free();
    }
    return false;
  } catch (e) {
    return false;
  }
}

// ── 创建窗口 ──
function createWindow() {
  const isMac = process.platform === 'darwin';
  mainWindow = new BrowserWindow({
    width: 1400, height: 900,
    minWidth: 1100, minHeight: 700,
    title: '银月终端',
    titleBarStyle: isMac ? 'hiddenInset' : undefined,
    frame: isMac,  // Mac 保留原生框（红绿灯）, Windows 无边框
    backgroundColor: '#020617',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

// ── 应用启动 ──
app.whenReady().then(async () => {
  // 关闭 Chromium Autofill（Electron 不支持，避免终端报 Autofill.enable 错误）
  app.commandLine.appendSwitch('disable-features', 'Autofill');

  await ensureSql();

  const config = loadConfig();
  if (config && config.dbDir && fs.existsSync(config.dbDir)) {
    dbDir = config.dbDir;
    openDb(dbDir);
  }

  createWindow();

  // macOS 保留标准菜单，Windows 移除菜单栏
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
    ]));
  } else {
    Menu.setApplicationMenu(null);
  }

  if (!dbDir || !db) {
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow.webContents.send('request-db-location');
    });
  }
});

app.on('window-all-closed', () => {
  closeDatabase();
  app.quit();
});

// ═══════════════════════════════════════════
// IPC Handlers
// ═══════════════════════════════════════════

// ── 窗口控制（Windows 无边框自定义标题栏）──
ipcMain.handle('window-minimize', () => { mainWindow?.minimize(); });
ipcMain.handle('window-maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.handle('window-close', () => { mainWindow?.close(); });
ipcMain.handle('window-is-maximized', () => mainWindow?.isMaximized() || false);

ipcMain.handle('select-db-location', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择数据库存储位置',
      message: '请选择一个文件夹来存储银月终端数据库',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, message: '未选择文件夹' };
    }
    const dir = result.filePaths[0];
    dbDir = dir;
    saveConfig(dir);
    const dbPath = openDb(dir);
    const imagesDir = getImagesDir(dir);
    const needsSeed = !isDbPopulated();
    return { success: true, dbPath, imagesDir, needsSeed };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('get-config', () => ({
  dbDir,
  imagesDir: dbDir ? getImagesDir(dbDir) : null,
  dbPopulated: dbDir ? isDbPopulated() : false,
  engineError: null,
}));

ipcMain.handle('get-db-path', () => {
  try {
    const populated = isDbPopulated();
    return {
      success: true,
      dbDir,
      dbPath: dbDir ? getDbPath(dbDir) : null,
      isPopulated: populated,
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ── 应用版本 ──
let _cachedAppVersion = null;
function getAppVersion() {
  if (_cachedAppVersion) return _cachedAppVersion;
  try {
    const pkgPath = path.join(__dirname, '..', 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      _cachedAppVersion = pkg.version || '1.0';
    }
  } catch (_) {}
  if (!_cachedAppVersion) _cachedAppVersion = '1.0';
  return _cachedAppVersion.replace(/\.0$/, '') || _cachedAppVersion;
}

ipcMain.handle('get-app-version', () => {
  return { success: true, version: getAppVersion() };
});

ipcMain.handle('get-data-version', () => {
  return { success: true, version: readSeedVersion() };
});

// ── 图片包管理 ──
ipcMain.handle('list-image-packs', () => {
  try {
    if (!dbDir) return { success: true, packs: [], active: null };
    const packs = findImagePacks(dbDir);
    const active = getActiveImagePackName(dbDir);
    const formatted = packs.map(p => {
      const size = getFolderSize(p.path);
      let sizeStr;
      if (size >= 1073741824) sizeStr = (size / 1073741824).toFixed(2) + ' GB';
      else if (size >= 1048576) sizeStr = (size / 1048576).toFixed(1) + ' MB';
      else if (size >= 1024) sizeStr = (size / 1024).toFixed(0) + ' KB';
      else sizeStr = size + ' B';
      const oType = parseOfficialPackName(p.name);
      return { name: p.name, path: p.path, size, sizeFormatted: sizeStr, officialType: oType };
    });
    // 官方包置顶排序
    formatted.sort((a, b) => {
      if (a.officialType && !b.officialType) return -1;
      if (!a.officialType && b.officialType) return 1;
      if (a.officialType && b.officialType) return IMAGE_TYPE_PRIORITY[b.officialType] - IMAGE_TYPE_PRIORITY[a.officialType];
      return 0;
    });
    return { success: true, packs: formatted, active };
  } catch (e) {
    return { success: false, error: e.message, packs: [], active: null };
  }
});

// ── 删除图包 ──
ipcMain.handle('delete-image-pack', (_event, packPath) => {
  try {
    if (!packPath || !fs.existsSync(packPath)) return { success: false, error: '文件夹不存在' };
    fs.rmSync(packPath, { recursive: true, force: true });
    clearSizeCache();
    clearImagePathCache();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ── 生成 manifest ──
// ── Manifest 生成（从 download-manager 导入）──

ipcMain.handle('generate-manifest', (_event, packPath) => {
  try {
    if (!packPath || !fs.existsSync(packPath)) return { success: false, error: '文件夹不存在' };
    const manifest = generateManifestForDir(packPath);
    fs.writeFileSync(path.join(packPath, 'manifest.json'), JSON.stringify(manifest, null, 2));
    return { success: true, fileCount: Object.keys(manifest.files).length, manifest };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ── 后台下载管理（基于 DownloadManager）──
const dm = getDownloadManager();

ipcMain.handle('start-pack-download', async (event, packPath, packType, fileList) => {
  try {
    if (!PACK_DOWNLOAD_URLS[packType]) return { success: false, error: '未知的包类型' };
    if (!fs.existsSync(packPath)) fs.mkdirSync(packPath, { recursive: true });
    const scope = fileList && fileList.length > 0 ? 'update' : 'full';
    const result = await dm.start({
      packPath,
      packType,
      scope,
      fileList: fileList || undefined,
      webContents: event.sender,
    });
    return { success: true, ...result };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('get-download-progress', () => {
  const downloads = dm.getActiveSummaries();
  // Clean up old done/cancelled entries (keep for 30s for UI finality)
  return { success: true, downloads };
});

ipcMain.handle('cancel-download', (_event, downloadId) => {
  dm.cancel(downloadId);
  return { success: true };
});

ipcMain.handle('resume-download', async (event, packPath) => {
  try {
    const result = await dm.resume(packPath, event.sender);
    return { success: true, ...result };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('get-persisted-download', (_event, packPath) => {
  const state = loadState(packPath);
  return { success: true, download: state || null };
});

// Listen for download completion to clear caches
dm.on('progress', (summary) => {
  if (summary.done || summary.error) {
    clearSizeCache();
    clearImagePathCache();
  }
});





ipcMain.handle('check-pack-update', async (_event, packPath, packType) => {
  try {
    const baseUrl = PACK_DOWNLOAD_URLS[packType];
    if (!baseUrl) return { success: false, error: '未知的包类型' };
    // 先生成本地 manifest
    const localManifest = generateManifestForDir(packPath);
    const localPath = path.join(packPath, 'manifest.json');
    fs.writeFileSync(localPath, JSON.stringify(localManifest, null, 2));
    // 通过 jsDelivr API 获取版本 hash，避免重定向
    const resolved = await resolveJsDelivrVersion(packType);
    const effectiveBase = resolved || baseUrl;
    console.log('[check-pack-update] using base:', effectiveBase);
    // 下载远程 manifest
    const remote = await downloadJsonFile(effectiveBase + '/manifest.json');
    if (!remote) return { success: false, error: '无法获取远程 manifest，请确认仓库中存在 manifest.json' };
    // 比对差异
    const newFiles = [];
    for (const [f, info] of Object.entries(remote.files || {})) {
      if (!localManifest.files[f] || localManifest.files[f].hash !== info.hash) {
        newFiles.push({ path: f, size: info.size || 0, hash: info.hash });
      }
    }
    return { success: true, newFiles, totalRemote: Object.keys(remote.files || {}).length };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// download-pack-files 现在委托给 DownloadManager（向后兼容）
ipcMain.handle('download-pack-files', async (event, packPath, packType, fileList) => {
  try {
    if (!PACK_DOWNLOAD_URLS[packType]) return { success: false, error: '未知的包类型' };
    if (!fs.existsSync(packPath)) fs.mkdirSync(packPath, { recursive: true });
    const result = await dm.start({
      packPath,
      packType,
      fileList,
      webContents: event.sender,
    });
    return { success: true, ...result };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

async function downloadTextFile(url) {
  console.log('[download] GET', url);
  return new Promise((resolve) => {
    const proto = url.startsWith('https') ? require('https') : require('http');
    function fetch(fetchUrl, redirects) {
      if (redirects > 5) { console.log('[download] too many redirects:', url); resolve(null); return; }
      const options = { headers: { 'User-Agent': 'SilverMoon-Terminal/1.0' } };
      const req = proto.get(fetchUrl, options, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          fetch(res.headers.location, redirects + 1);
          return;
        }
        if (res.statusCode !== 200) { resolve(null); return; }
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => resolve(data));
      });
      req.on('error', () => resolve(null));
      req.setTimeout(15000, function() { this.destroy(); resolve(null); });
    }
    fetch(url, 0);
  });
}

async function downloadJsonFile(url) {
  const text = await downloadTextFile(url);
  if (!text) return null;
  try { return JSON.parse(text); } catch (_) { return null; }
}

ipcMain.handle('download-full-pack', async (event, packType) => {
  try {
    if (!dbDir) return { success: false, error: '数据库未初始化' };
    if (!PACK_DOWNLOAD_URLS[packType]) return { success: false, error: '未知的包类型' };
    const label = packType.charAt(0).toUpperCase() + packType.slice(1);
    const packPath = path.join(dbDir, `images-${label}`);
    if (!fs.existsSync(packPath)) fs.mkdirSync(packPath, { recursive: true });

    const dm = getDownloadManager();
    const result = await dm.start({
      packPath,
      packType,
      scope: 'full',          // tries GitHub archive first, falls back to manifest
      fileList: undefined,    // full pack — no file list
      webContents: event.sender,
    });
    return { success: true, ...result };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ── 图包差异导出 ──
ipcMain.handle('diff-pack', async (_event, packPath, packType) => {
  try {
    const baseUrl = PACK_DOWNLOAD_URLS[packType];
    if (!baseUrl) return { success: false, error: '未知的包类型' };
    const resolved = await resolveJsDelivrVersion(packType);
    const effectiveBase = resolved || baseUrl;
    const remote = await downloadJsonFile(effectiveBase + '/manifest.json');
    if (!remote) return { success: false, error: '无法获取远程 manifest，请确认仓库中存在 manifest.json' };
    const localManifestPath = path.join(packPath, 'manifest.json');
    let local = { files: {} };
    if (fs.existsSync(localManifestPath)) {
      local = JSON.parse(fs.readFileSync(localManifestPath, 'utf-8'));
    }
    const localOnly = [];
    const remoteOnly = [];
    for (const f of Object.keys(local.files)) {
      if (!remote.files[f]) localOnly.push(f);
    }
    for (const f of Object.keys(remote.files)) {
      if (!local.files[f]) remoteOnly.push(f);
    }
    return { success: true, localOnly, remoteOnly };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('export-pack-diff', async (_event, packPath, packType) => {
  try {
    const baseUrl = PACK_DOWNLOAD_URLS[packType];
    if (!baseUrl) return { success: false, error: '未知的包类型' };
    // 先重新生成本地 manifest（确保对比的是最新状态）
    const localManifest = generateManifestForDir(packPath);
    fs.writeFileSync(path.join(packPath, 'manifest.json'), JSON.stringify(localManifest, null, 2));
    // 下载远程 manifest
    const resolved = await resolveJsDelivrVersion(packType);
    const remote = await downloadJsonFile((resolved || baseUrl) + '/manifest.json');
    if (!remote) return { success: false, error: '无法获取远程 manifest，请确认仓库中存在 manifest.json' };
    const localOnly = [], remoteOnly = [];
    for (const f of Object.keys(localManifest.files)) { if (!remote.files[f]) localOnly.push(f); }
    for (const f of Object.keys(remote.files)) { if (!localManifest.files[f]) remoteOnly.push(f); }
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择差异导出目录', properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return { success: false, message: '已取消' };
    const baseDir = path.join(result.filePaths[0], 'Img_Diff');
    const newDir = path.join(baseDir, 'New');
    const delDir = path.join(baseDir, 'Del');
    if (!fs.existsSync(newDir)) fs.mkdirSync(newDir, { recursive: true });
    if (!fs.existsSync(delDir)) fs.mkdirSync(delDir, { recursive: true });
    let copied = 0;
    for (const f of localOnly) {
      try {
        const src = path.join(packPath, f), dest = path.join(newDir, f);
        const ddir = path.dirname(dest);
        if (!fs.existsSync(ddir)) fs.mkdirSync(ddir, { recursive: true });
        if (fs.existsSync(src)) { fs.copyFileSync(src, dest); copied++; }
      } catch (_) {}
    }
    if (remoteOnly.length > 0) {
      fs.writeFileSync(path.join(delDir, 'missing_files.txt'), remoteOnly.join('\n'), 'utf-8');
    }
    return { success: true, newCount: copied, delCount: remoteOnly.length, outputDir: baseDir };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ── 删除图包中的多余文件（用户确认后）──
ipcMain.handle('delete-extra-files', (_event, packPath, filePaths) => {
  try {
    if (!packPath || !fs.existsSync(packPath)) return { success: false, error: '文件夹不存在' };
    let deleted = 0;
    for (const fp of (filePaths || [])) {
      const fullPath = path.join(packPath, fp);
      // 安全检查：确保文件在 packPath 内
      const relative = path.relative(packPath, fullPath);
      if (relative.startsWith('..') || path.isAbsolute(relative)) continue;
      try {
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
          deleted++;
        }
      } catch (_) {}
    }
    clearSizeCache();
    clearImagePathCache();
    return { success: true, deleted };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('set-active-image-pack', (_event, packName) => {
  try {
    if (!dbDir) return { success: false, error: '数据库未初始化' };
    const userConfig = loadUserConfig();
    userConfig.activeImagePack = packName;
    saveUserConfig(userConfig);
    clearSizeCache();
    clearImagePathCache();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('clear-active-image-pack', () => {
  try {
    if (!dbDir) return { success: false, error: '数据库未初始化' };
    const userConfig = loadUserConfig();
    delete userConfig.activeImagePack;
    saveUserConfig(userConfig);
    clearSizeCache();
    clearImagePathCache();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ── 获取种子数据各表条目统计（无需数据库即可调用）──
function getSeedStats() {
  const searchDirs = [
    // asarUnpack 解出路径
    path.join(process.resourcesPath || '', 'app.asar.unpacked', 'electron'),
    // 开发模式路径
    path.join(__dirname, '..', 'electron'),
    path.join(__dirname),
  ];
  let sqlDir = null;
  for (const d of searchDirs) {
    if (fs.existsSync(path.join(d, 'schema.sql'))) { sqlDir = d; break; }
  }
  if (!sqlDir) return {};

  const tables = ['characters','weapons','artifacts','materials','wishes','challenges','game_data',
    'enemies','element_reactions','character_talents','character_constellations'];

  const stats = {};
  for (const t of tables) stats[t] = 0;

  function countInFile(filename) {
    for (const d of searchDirs) {
      const p = path.join(d, filename);
      if (!fs.existsSync(p)) continue;
      try {
        let sql;
        const asarMatch = p.match(/\.asar[/\\]/);
        if (asarMatch) {
          // asar 内路径：直接走原始归档提取
          sql = extractFromAsar(p, asarMatch);
          if (!sql) continue;
        } else {
          // 非 asar 路径
          try { sql = fs.readFileSync(p, 'utf-8'); } catch (_) {}
          if (!sql) {
            try {
              const chunks = [];
              const fd = fs.openSync(p, 'r');
              const buf = Buffer.alloc(1024 * 1024);
              let bytesRead;
              while ((bytesRead = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
                chunks.push(buf.subarray(0, bytesRead).toString('utf-8'));
              }
              fs.closeSync(fd);
              sql = chunks.join('');
            } catch (_) {}
          }
        }
        if (!sql) continue;
        for (const t of tables) {
          const regex = new RegExp(`INSERT\\s+(?:OR\\s+IGNORE\\s+)?INTO\\s+"?${t}"?\\s*\\([^)]*\\)\\s*VALUES\\s*([^;]+)`, 'gi');
          let match;
          while ((match = regex.exec(sql)) !== null) {
            const valuesBlock = match[1];
            const rowCount = (valuesBlock.match(/\)\s*,\s*\(/g) || []).length + 1;
            stats[t] += rowCount;
          }
        }
        return;
      } catch (_) {}
    }
  }

  // 从 asar 归档中提取文件内容（接受预计算的 asarMatch 避免重复正则）
  function extractFromAsar(filePath, asarMatch) {
    try {
      if (!asarMatch) asarMatch = filePath.match(/\.asar[/\\]/);
      if (!asarMatch) return null;
      const asarEnd = asarMatch.index + 5;
      const asarPath = filePath.slice(0, asarEnd);
      const internalPath = filePath.slice(asarEnd + 1);
      if (!fs.existsSync(asarPath)) return null;
      const buf = fs.readFileSync(asarPath);
      const headerSize = buf.readUInt32LE(0);
      const headerStr = buf.subarray(4, 4 + headerSize).toString('utf-8');
      const header = JSON.parse(headerStr);
      const contentStart = 4 + headerSize + ((4 - ((headerSize + 4) % 4)) % 4);
      function findInAsar(files, target) {
        for (const [name, info] of Object.entries(files)) {
          if (target.startsWith(name + '/')) return findInAsar(info.files || {}, target.slice(name.length + 1));
          if (name === target && info.size != null) return { offset: contentStart + parseInt(info.offset || '0'), size: info.size };
        }
        return null;
      }
      const fi = findInAsar(header.files, internalPath);
      if (fi) return buf.subarray(fi.offset, fi.offset + fi.size).toString('utf-8');
    } catch (_) {}
    return null;
  }

  countInFile('seed.sql');
  for (let i = 1; i <= 5; i++) {
    countInFile(`seed_part${i}.sql`);
  }

  return stats;
}

ipcMain.handle('get-seed-stats', () => {
  try {
    const stats = getSeedStats();
    return { success: true, stats };
  } catch (e) {
    console.error('[get-seed-stats] error:', e.message);
    return { success: false, error: e.message };
  }
});

// ── 统一种子数据应用：建表 + 迁移 + 种子 INSERT OR IGNORE ──
function seedDatabase() {
  if (!db) throw new Error('数据库未初始化');
  migrateSchema();  // 先执行增量迁移，再导入种子数据

  const searchDirs = [
    // asarUnpack 解出路径
    path.join(process.resourcesPath || '', 'app.asar.unpacked', 'electron'),
    // 开发模式路径
    path.join(__dirname, '..', 'electron'),
    path.join(__dirname),
  ];

  let sqlDir = null;
  for (const d of searchDirs) {
    if (fs.existsSync(path.join(d, 'schema.sql'))) { sqlDir = d; break; }
  }
  if (!sqlDir) {
    throw new Error(`找不到SQL初始化文件。路径: ${searchDirs.join(', ')}`);
  }

  // 读取 SQL 文件的辅助函数（多层容错，处理 asar 内大文件读取限制）
  function readSqlFile(filename) {
    for (const d of searchDirs) {
      const p = path.join(d, filename);
      if (!fs.existsSync(p)) continue;
      // 如果是 asar 内路径（xxx.asar/yyy），直接走原始归档提取
      // 注意：必须精确匹配 .asar/ 或 .asar\，避免误匹配 app.asar.unpacked 目录
      const asarMatch = p.match(/\.asar[/\\]/);
      if (asarMatch) {
        try {
          const asarEnd = asarMatch.index + 5;
          const asarPath = p.slice(0, asarEnd);
          const internalPath = p.slice(asarEnd + 1); // skip the / after .asar
          if (!fs.existsSync(asarPath)) { console.log('[readSqlFile] asar not found:', asarPath); continue; }
          const buf = fs.readFileSync(asarPath);
          const headerSize = buf.readUInt32LE(0);
          const headerStr = buf.subarray(4, 4 + headerSize).toString('utf-8');
          const header = JSON.parse(headerStr);
          const contentStart = 4 + headerSize + ((4 - ((headerSize + 4) % 4)) % 4);
          function findInAsar(files, target) {
            for (const [name, info] of Object.entries(files)) {
              if (target.startsWith(name + '/')) return findInAsar(info.files || {}, target.slice(name.length + 1));
              if (name === target && info.size != null) return { offset: contentStart + parseInt(info.offset || '0'), size: info.size };
            }
            return null;
          }
          const fi = findInAsar(header.files, internalPath);
          if (fi) {
            console.log('[readSqlFile] asar-extract OK:', filename, `offset=${fi.offset} size=${fi.size}`);
            return buf.subarray(fi.offset, fi.offset + fi.size).toString('utf-8');
          }
          console.log('[readSqlFile] not found in asar:', internalPath, 'keys:', Object.keys(header.files || {}).join(', '));
        } catch (e) { console.log('[readSqlFile] asar-extract error:', e.message); }
        continue;
      }
      // 非 asar 路径：标准读取 + 分块读取回退
      try { return fs.readFileSync(p, 'utf-8'); } catch (_) {}
      try {
        const chunks = [];
        const fd = fs.openSync(p, 'r');
        const buf = Buffer.alloc(1024 * 1024);
        let bytesRead;
        while ((bytesRead = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
          chunks.push(buf.subarray(0, bytesRead).toString('utf-8'));
        }
        fs.closeSync(fd);
        return chunks.join('');
      } catch (_) {}
    }
    throw new Error(`无法读取: ${filename}`);
  }

  const countTables = ['characters','weapons','artifacts','materials','wishes','challenges','game_data',
    'character_talents','character_constellations','enemies','element_reactions'];

  db.run('BEGIN TRANSACTION');
  try {
    // 1. 建表
    const schemaSql = readSqlFile('schema.sql');
    dbExec(schemaSql);

    // 2. 统计更新前数据量
    const beforeCount = dbAll(
      'SELECT SUM(cnt) as total FROM (' + countTables.map(t => `SELECT COUNT(*) as cnt FROM ${t}`).join(' UNION ALL ') + ')',
      []
    )[0]?.total || 0;

    // 3. 种子数据导入（FK 关闭，INSERT OR IGNORE）
    db.exec('PRAGMA foreign_keys = OFF');
    try {
      if (fs.existsSync(path.join(sqlDir, 'seed.sql'))) {
        let seedSql = readSqlFile('seed.sql');
        seedSql = seedSql.replace(/INSERT INTO /gi, 'INSERT OR IGNORE INTO ');
        dbExec(seedSql);
      }
      for (let i = 1; i <= 5; i++) {
        const partName = `seed_part${i}.sql`;
        if (!fs.existsSync(path.join(sqlDir, partName))) continue;
        let seedSql = readSqlFile(partName);
        seedSql = seedSql.replace(/INSERT INTO /gi, 'INSERT OR IGNORE INTO ');
        dbExec(seedSql);
      }
    } finally {}

    db.run('COMMIT');
    db.exec('PRAGMA foreign_keys = ON');

    const afterCount = dbAll(
      'SELECT SUM(cnt) as total FROM (' + countTables.map(t => `SELECT COUNT(*) as cnt FROM ${t}`).join(' UNION ALL ') + ')',
      []
    )[0]?.total || 0;
    const delta = afterCount - beforeCount;

    const message = delta > 0
      ? `数据更新完成，共新增 ${delta} 条记录`
      : '种子数据已是最新（所有条目均存在）';

    return { success: true, message, addedCount: delta };
  } catch (innerErr) {
    db.run('ROLLBACK');
    try { db.exec('PRAGMA foreign_keys = ON'); } catch (_) {}
    throw innerErr;
  }
}

ipcMain.handle('init-database', () => {
  try {
    if (!dbDir) throw new Error('数据库路径未设置');
    // 1. 关闭两个数据库
    closeDatabase(); // 这会同时关闭 user.db
    // 2. 删除两个 db 文件
    const basePath = getDbPath(dbDir);
    const userPath = getUserDbPath(dbDir);
    try { if (fs.existsSync(basePath)) fs.unlinkSync(basePath); } catch (_) {}
    try { if (fs.existsSync(userPath)) fs.unlinkSync(userPath); } catch (_) {}
    console.log('[init-database] deleted db files, re-creating from seed');
    // 3. 重新打开基准库（新建空库）并播种
    openDb(dbDir); // 不传入 userDb，后面会通过 openUserDb 打开（即使不存在）
    const result = seedDatabase();
    dbSave();
    // 确保 user.db 没有被错误创建（只在首次非开发者写入时创建）
    if (userDb) {
      closeUserDb();
      try { if (fs.existsSync(userPath)) fs.unlinkSync(userPath); } catch (_) {}
    }
    return result;
  } catch (error) {
    console.error('[init-database] error:', error.message);
    return { error: error.message };
  }
});

// ── 更新种子数据（设置页，补充缺失条目）──
// 仅删除并重新初始化 silvermoon_terminal.db，保留 user.db
ipcMain.handle('update-database', () => {
  try {
    if (!dbDir) throw new Error('数据库路径未设置');
    // 关闭并删除基准库，保留 user.db
    const basePath = getDbPath(dbDir);
    closeDatabase(); // 关闭两个库
    try { if (fs.existsSync(basePath)) fs.unlinkSync(basePath); } catch (_) {}
    console.log('[update-database] deleted base db, re-seeding');
    // 重新打开基准库（不关闭 user.db — closeDatabase 已关闭它，重新打开）
    openDb(dbDir); // openUserDb 会重新打开已存在的 user.db
    const result = seedDatabase();
    dbSave();
    return result;
  } catch (error) {
    console.error('[update-database] error:', error.message);
    return { error: error.message };
  }
});

// ── 数据库完整性检查 ──
ipcMain.handle('db-check-integrity', () => {
  try {
    if (!db) throw new Error('数据库未初始化');
    const result = db.exec('PRAGMA integrity_check');
    const rows = [];
    if (result.length > 0 && result[0].values) {
      for (const row of result[0].values) rows.push(row[0]);
    }
    return { ok: rows.length === 1 && rows[0] === 'ok', rows };
  } catch (error) {
    return { error: error.message };
  }
});

// ── 修复 websites 表（删除重建，尽量保留数据）──
ipcMain.handle('db-repair-websites', () => {
  try {
    if (!db) throw new Error('数据库未初始化');

    // 先尝试抢救数据
    let existing = [];
    try {
      existing = dbAll('SELECT * FROM websites ORDER BY sort_order, id', []);
    } catch (selErr) {
      console.warn('[db-repair-websites] SELECT failed, will drop and recreate:', selErr.message);
      existing = null;
    }

    // 使用 exec() 直接执行 DDL（某些场景比 run() 更稳定）
    try {
      db.exec('DROP TABLE IF EXISTS websites');
    } catch (dropErr) {
      console.warn('[db-repair-websites] DROP via exec failed, trying run:', dropErr.message);
      try {
        db.run('DROP TABLE IF EXISTS websites');
      } catch (dropRunErr) {
        return { error: '无法删除损坏的 websites 表: ' + dropRunErr.message };
      }
    }

    // 重建表
    db.exec(`CREATE TABLE websites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title_zh TEXT NOT NULL,
      url TEXT NOT NULL,
      description_zh TEXT,
      icon TEXT,
      image TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    )`);

    // 还原数据
    let restored = 0;
    if (existing) {
      for (const row of existing) {
        const stmt = db.prepare(`INSERT INTO websites (title_zh, url, description_zh, icon, image, sort_order, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
        stmt.bind([
          row.title_zh, row.url, row.description_zh || null,
          row.icon || null, row.image || null, row.sort_order || 0,
          row.created_at || null, row.updated_at || null,
        ]);
        stmt.step();
        stmt.free();
        restored++;
      }
    }

    // 尝试持久化；如果 export 失败，至少内存中已修复
    try {
      dbSave();
    } catch (saveErr) {
      console.error('[db-repair-websites] dbSave failed (in-memory fix applied):', saveErr.message);
      return { success: true, restored, saveWarning: saveErr.message };
    }

    return { success: true, restored };
  } catch (error) {
    return { error: error.message };
  }
});

ipcMain.handle('db-query', (_event, sql, params = []) => {
  try {
    if (!db) throw new Error('数据库未初始化');
    const trimmed = sql.trim().toUpperCase();

    // ── 双数据库模式关闭：所有操作直接走基准库 ──
    if (!dualDbMode) {
      if (trimmed.startsWith('SELECT') || trimmed.startsWith('PRAGMA')) {
        return { data: dbAll(sql, params) };
      }
      const result = dbRun(sql, params);
      try { dbSave(); } catch (saveErr) {
        return { changes: result.changes, lastId: result.lastId, saveError: saveErr.message };
      }
      return { changes: result.changes, lastId: result.lastId };
    }

    // ── SELECT / PRAGMA：查询基准库，合并 _user_delta（字段级覆盖）──
    if (trimmed.startsWith('SELECT') || trimmed.startsWith('PRAGMA')) {
      const baseResult = dbAll(sql, params);
      if (userDb && trimmed.startsWith('SELECT')) {
        try {
          const tableName = _extractTableName(sql);
          if (tableName) {
            // 调试：检查 characters 表是否有 delta
            if (tableName === 'characters' && userDb) {
              const count = userDb.exec("SELECT COUNT(*) as c FROM _user_delta WHERE table_name = 'characters'");
              const deltaCount = count?.[0]?.values?.[0]?.[0] || 0;
              if (deltaCount > 0) {
                console.log('[db-query] characters has', deltaCount, 'deltas, running merge');
              }
            }
            const merged = mergeWithUserDbDelta(tableName, baseResult, sql);
            if (merged !== baseResult) {
              console.log('[db-query] merged', tableName, 'rows:', baseResult.length, '→', merged.length);
            }
            return { data: merged };
          }
        } catch (e) {
          console.error('[db-query] merge error:', e.message);
        }
      }
      return { data: baseResult };
    }

    // ── 写操作：根据 devMode 路由 ──
    if (devMode) {
      const result = dbRun(sql, params);
      try { dbSave(); } catch (saveErr) {
        return { changes: result.changes, lastId: result.lastId, saveError: saveErr.message };
      }
      return { changes: result.changes, lastId: result.lastId };
    } else {
      // 非开发者模式 → 写入 user.db（_user_delta 增量表）
      const udb = ensureUserDb();
      if (!udb) throw new Error('无法创建用户数据库');

      let result;
      if (trimmed.startsWith('UPDATE')) {
        result = storeUpdateAsDelta(udb, sql, params);
      } else if (trimmed.startsWith('INSERT')) {
        result = dbRunOnDb(udb, sql, params);
      } else if (trimmed.startsWith('DELETE')) {
        const tableName = _extractTableName(sql);
        const idMatch = sql.match(/WHERE\s+id\s*=\s*\?/i);
        if (tableName && idMatch && params.length > 0) {
          const delId = params[params.length - 1];
          try {
            const safeTable = tableName.replace(/'/g, "''");
            udb.exec(`INSERT OR REPLACE INTO _user_delta (table_name, row_id, column_name, new_value, op_type, updated_at) VALUES ('${safeTable}', ${Number(delId)}, '_deleted', '1', 'delete', datetime('now','localtime'))`);
            result = { changes: 1, lastId: null };
          } catch (e) {
            result = { changes: 0, lastId: null, error: e.message };
          }
        } else {
          result = dbRunOnDb(udb, sql, params);
        }
      } else {
        result = dbRunOnDb(udb, sql, params);
      }

      try { userDbSave(); } catch (saveErr) {
        return { changes: result.changes, lastId: result.lastId, saveError: saveErr.message };
      }
      // 清理与基准库一致的冗余 delta
      try { optimizeUserDb(); userDbSave(); } catch (_) {}
      return { changes: result.changes, lastId: result.lastId };
    }
  } catch (error) {
    return { error: error.message };
  }
});

// 在指定数据库上执行 dbAll
function dbAllOnDb(targetDb, sql, params = []) {
  const replaced = _replaceParams(sql, params);
  const results = [];
  try {
    const stmt = targetDb.prepare(replaced);
    while (stmt.step()) results.push(stmt.getAsObject());
    stmt.free();
  } catch (e) {
    throw new Error(`sql.js query: ${e.message}\nSQL: ${replaced}`);
  }
  return results;
}

// 在指定数据库上执行 dbRun
function dbRunOnDb(targetDb, sql, params = []) {
  const replaced = _replaceParams(sql, params);
  let stmt;
  try {
    stmt = targetDb.prepare(replaced);
    stmt.step();
  } finally {
    if (stmt) stmt.free();
  }
  const changes = targetDb.getRowsModified();
  let lastId = null;
  try {
    const results = targetDb.exec('SELECT last_insert_rowid() as id');
    if (results.length > 0 && results[0].values.length > 0) {
      lastId = results[0].values[0][0];
    }
  } catch (_) {}
  return { changes, lastId };
}

// ── 设置开发者模式（后端同步）──
ipcMain.handle('set-dev-mode', (_event, enabled) => {
  devMode = !!enabled;
  return { success: true };
});

ipcMain.handle('get-dev-mode', () => {
  return { devMode };
});

// ── 双数据库模式开关 ──
ipcMain.handle('set-dual-db-mode', (_event, enabled) => {
  dualDbMode = !!enabled;
  return { success: true };
});

ipcMain.handle('get-dual-db-mode', () => {
  return { dualDbMode };
});

ipcMain.handle('save-image', (_event, { filename, buffer }) => {
  try {
    if (!dbDir) throw new Error('数据库未初始化');
    fs.writeFileSync(path.join(getImagesDir(dbDir), filename), Buffer.from(buffer));
    clearImagePathCache();
    return { success: true };
  } catch (e) { return { error: e.message }; }
});

ipcMain.handle('import-image', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择图片',
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return { success: false };

    const src = result.filePaths[0];
    const originalName = path.basename(src);
    const imagesDir = getImagesDir(dbDir);

    // 如果来源已在 images 文件夹内，直接使用，不复制
    if (path.dirname(src) === imagesDir) {
      return { success: true, filename: originalName, existed: true };
    }

    // 检查是否已有同名图片（忽略扩展名）
    const existing = resolveImagePath(imagesDir, originalName);
    if (existing) {
      return { success: true, filename: path.basename(existing), existed: true };
    }

    const dest = path.join(imagesDir, originalName);

    fs.copyFileSync(src, dest);
    clearImagePathCache();
    return { success: true, filename: originalName, path: dest };
  } catch (e) { return { error: e.message }; }
});

ipcMain.handle('import-image-file', (_event, srcPath) => {
  try {
    if (!dbDir) throw new Error('数据库未初始化');
    if (!srcPath || !fs.existsSync(srcPath)) return { error: '文件不存在' };
    const originalName = path.basename(srcPath);
    const imagesDir = getImagesDir(dbDir);

    // 如果来源已在 images 文件夹内，直接使用，不复制
    if (path.dirname(srcPath) === imagesDir) {
      return { success: true, filename: originalName, existed: true };
    }

    // 检查是否已有同名图片（忽略扩展名）
    const existing = resolveImagePath(imagesDir, originalName);
    if (existing) {
      return { success: true, filename: path.basename(existing), existed: true };
    }

    const dest = path.join(imagesDir, originalName);

    fs.copyFileSync(srcPath, dest);
    clearImagePathCache();
    return { success: true, filename: originalName };
  } catch (e) { return { error: e.message }; }
});

ipcMain.handle('delete-image', (_event, filename) => {
  try {
    if (!dbDir) throw new Error('数据库未初始化');
    const imagesDir = getImagesDir(dbDir);
    const fp = resolveImagePath(imagesDir, filename);
    if (fp && fs.existsSync(fp)) {
      fs.unlinkSync(fp);
      clearImagePathCache();
      return { success: true, deleted: true };
    }
    return { success: true, deleted: false };
  } catch (e) { return { error: e.message }; }
});

ipcMain.handle('read-image', (_event, filename) => {
  try {
    if (!db) throw new Error('数据库未初始化');
    if (!dbDir) throw new Error('数据库路径未设置');

    // 按文件名匹配（忽略扩展名，递归搜索图包子目录，同名取最大）
    const imagesDir = getImagesDir(dbDir);
    let fp = resolveImagePath(imagesDir, filename);
    if (!fp) {
      // 回退：public/（开发）或 dist/（打包）— 这些目录仍需精确文件名
      const fallbackDirs = [
        path.join(__dirname, '..', 'public'),
        path.join(__dirname, '..', 'dist'),
        path.join(process.resourcesPath || '', 'dist'),
      ];
      for (const d of fallbackDirs) {
        const candidate = path.join(d, filename);
        if (fs.existsSync(candidate)) { fp = candidate; break; }
      }
      if (!fp) return { error: '文件不存在' };
    }

    return readImageFile(fp);
  } catch (e) { return { error: e.message }; }
});

// 通用图片文件读取（供 read-image 和 read-user-image 复用）
function readImageFile(fp) {
  // 读取文件头检测实际格式（SVG 内容可能以 .webp 等扩展名存储）
  const head = Buffer.alloc(256);
  const fd = fs.openSync(fp, 'r');
  const bytesRead = fs.readSync(fd, head, 0, 256, 0);
  fs.closeSync(fd);

  const headStr = head.toString('utf-8', 0, bytesRead).trimStart();
  if (headStr.startsWith('<svg') || headStr.startsWith('<?xml')) {
    const svgText = fs.readFileSync(fp, 'utf-8');
    return { success: true, data: `data:image/svg+xml;base64,${Buffer.from(svgText).toString('base64')}` };
  }

  // 二进制图片
  const data = fs.readFileSync(fp);
  const headBytes = head.subarray(0, Math.min(bytesRead, 4));
  let mime = 'image/png';
  if (headBytes[0] === 0xFF && headBytes[1] === 0xD8) mime = 'image/jpeg';
  else if (headBytes[0] === 0x89 && headBytes[1] === 0x50) mime = 'image/png';
  else if (headBytes[0] === 0x52 && headBytes[1] === 0x49) mime = 'image/webp';
  else if (headBytes[0] === 0x47 && headBytes[1] === 0x49) mime = 'image/gif';
  return { success: true, data: `data:${mime};base64,${data.toString('base64')}` };
}

// ── 导出图片：用户自选路径保存 ──
ipcMain.handle('export-image-file', async (_event, { data, defaultName }) => {
  try {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出图标',
      defaultPath: defaultName || 'app_icon.png',
      filters: [{ name: 'PNG 图片', extensions: ['png'] }],
    });
    if (result.canceled || !result.filePath) return { success: false, message: '已取消' };
    fs.writeFileSync(result.filePath, Buffer.from(data));
    return { success: true, path: result.filePath };
  } catch (e) { return { error: e.message }; }
});

// ── 图片拖放：提供原生文件拖放，保留原始文件名 ──
ipcMain.handle('start-image-drag', async (_event, filename) => {
  try {
    if (!dbDir) throw new Error('数据库路径未设置');
    const fp = resolveImagePath(getImagesDir(dbDir), filename);
    if (!fp || !fs.existsSync(fp)) return { error: '文件不存在' };
    const icon = await nativeImage.createThumbnailFromPath(fp, { width: 64, height: 64 });
    mainWindow.webContents.startDrag({ file: fp, icon });
    return { success: true };
  } catch (e) { return { error: e.message }; }
});

// ── 用户自定义图片（user_images 目录）──
ipcMain.handle('import-user-image', async () => {
  try {
    if (!dbDir) throw new Error('数据库未初始化');
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择图标图片',
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return { success: false, message: '已取消' };

    const src = result.filePaths[0];
    const originalName = path.basename(src);
    const userImagesDir = getUserImagesDir(dbDir);
    const dest = path.join(userImagesDir, originalName);

    // 去重：如果已有同名文件，加时间戳
    let finalName = originalName;
    if (fs.existsSync(dest)) {
      const ext = path.extname(originalName);
      const base = path.basename(originalName, ext);
      finalName = `${base}_${Date.now()}${ext}`;
    }

    fs.copyFileSync(src, path.join(userImagesDir, finalName));
    return { success: true, filename: finalName };
  } catch (e) { return { error: e.message }; }
});

ipcMain.handle('read-user-image', (_event, filename) => {
  try {
    if (!dbDir) throw new Error('数据库未初始化');
    const fp = path.join(getUserImagesDir(dbDir), filename);
    if (!fs.existsSync(fp)) return { error: '文件不存在' };
    return readImageFile(fp);
  } catch (e) { return { error: e.message }; }
});

ipcMain.handle('delete-user-image', (_event, filename) => {
  try {
    if (!dbDir) throw new Error('数据库未初始化');
    const fp = path.join(getUserImagesDir(dbDir), filename);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
    return { success: true };
  } catch (e) { return { error: e.message }; }
});

// ── 备份数据库：将 db 文件复制到用户选择的文件夹 ──
ipcMain.handle('backup-database', async () => {
  try {
    if (!dbDir) throw new Error('数据库路径未设置');
    // 确保数据已写入磁盘
    if (db) dbSave();
    if (userDb) userDbSave();
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择备份目标文件夹',
      message: '数据库文件将复制到此文件夹',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, message: '已取消' };
    }
    const destDir = result.filePaths[0];
    const timestamp = beijingISO();
    const saved = [];

    // 备份基准库
    const baseSrc = getDbPath(dbDir);
    if (fs.existsSync(baseSrc)) {
      const baseDest = path.join(destDir, `silvermoon_terminal_backup_${timestamp}_base.db`);
      fs.copyFileSync(baseSrc, baseDest);
      saved.push(baseDest);
    }

    // 备份用户库（如果存在）
    const userSrc = getUserDbPath(dbDir);
    if (fs.existsSync(userSrc)) {
      const userDest = path.join(destDir, `silvermoon_terminal_backup_${timestamp}_user.db`);
      fs.copyFileSync(userSrc, userDest);
      saved.push(userDest);
    }

    return { success: true, files: saved };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ── 导入数据库：用户选择导入基准库还是用户库 ──
ipcMain.handle('import-database', async () => {
  try {
    // 先询问导入类型
    const { response: dbType } = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      title: '导入数据库',
      message: '请选择要导入的数据库类型',
      detail: '基准数据库（silvermoon_terminal.db）包含初始数据；\n用户数据库（user.db）包含用户修改的数据。',
      buttons: ['基准数据库 (base)', '用户数据库 (user)', '取消'],
      defaultId: 0,
      cancelId: 2,
    });
    if (dbType === 2) return { success: false, message: '已取消' };
    const isBase = dbType === 0;

    const result = await dialog.showOpenDialog(mainWindow, {
      title: `选择要导入的${isBase ? '基准' : '用户'}数据库文件`,
      message: '选择要导入的 .db 文件（将替换当前对应数据库）',
      filters: [{ name: '数据库文件', extensions: ['db'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, message: '已取消' };
    }
    const srcPath = result.filePaths[0];
    if (!fs.existsSync(srcPath)) {
      return { success: false, error: '文件不存在' };
    }
    // 验证是有效的 SQLite 文件
    const buf = fs.readFileSync(srcPath);
    try {
      const testDb = new SQL.Database(buf);
      testDb.close();
    } catch (_) {
      return { success: false, error: '所选文件不是有效的 SQLite 数据库' };
    }

    if (isBase) {
      // 导入基准库
      closeDatabase();
      const destPath = getDbPath(dbDir);
      fs.copyFileSync(srcPath, destPath);
      openDb(dbDir);
    } else {
      // 导入用户库
      if (userDb) {
        closeUserDb();
      }
      const destPath = getUserDbPath(dbDir);
      fs.copyFileSync(srcPath, destPath);
      // 重新打开 user.db
      openUserDb(dbDir);
    }
    return { success: true, dbType: isBase ? 'base' : 'user' };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ── 获取数据库备份文件夹路径 ──
function getBackupsDir() {
  if (!dbDir) return null;
  const dir = path.join(dbDir, 'backups');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ── 列出所有备份文件 ──
ipcMain.handle('list-backups', () => {
  try {
    if (!dbDir) throw new Error('数据库未初始化');
    const backupsDir = getBackupsDir();
    const files = fs.readdirSync(backupsDir)
      .filter(f => f.endsWith('.db'))
      .map(f => {
        const fullPath = path.join(backupsDir, f);
        const stat = fs.statSync(fullPath);
        const bjTime = new Date(stat.mtime.getTime() + 8 * 60 * 60 * 1000);
        const mtimeStr = bjTime.toISOString().replace('T', ' ').slice(0, 19);
        // 从文件名解析: {note}_{timestamp}_{type}.db  (type = base | user)
        let note = f;
        let dbType = 'base';
        const matchNew = f.match(/^(.+)_(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})_(base|user)\.db$/);
        const matchOld = f.match(/^silvermoon_terminal_backup_(.+)\.db$/);
        if (matchNew) {
          note = matchNew[1];
          dbType = matchNew[3];
        } else if (matchOld) {
          note = matchOld[1];
        }
        return {
          filename: f,
          note: note,
          dbType,
          size: stat.size,
          mtime: mtimeStr,
        };
      })
      .sort((a, b) => b.mtime.localeCompare(a.mtime));
    return { success: true, backups: files };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ── 创建备份（自动备份到 backups 文件夹，带备注）──
ipcMain.handle('create-backup', (_event, note) => {
  try {
    if (!dbDir || !db) throw new Error('数据库未初始化');
    dbSave(); // 确保最新数据写入磁盘
    if (userDb) userDbSave();
    const backupsDir = getBackupsDir();
    const safeNote = (note || 'backup').replace(/[/\\:*?"<>|]/g, '_');
    const timestamp = beijingISO();
    const saved = [];

    // 备份基准库
    const baseSrc = getDbPath(dbDir);
    if (fs.existsSync(baseSrc)) {
      const baseDest = path.join(backupsDir, `${safeNote}_${timestamp}_base.db`);
      fs.copyFileSync(baseSrc, baseDest);
      saved.push(path.basename(baseDest));
    }

    // 备份用户库（如果存在）
    const userSrc = getUserDbPath(dbDir);
    if (fs.existsSync(userSrc)) {
      const userDest = path.join(backupsDir, `${safeNote}_${timestamp}_user.db`);
      fs.copyFileSync(userSrc, userDest);
      saved.push(path.basename(userDest));
    }

    return { success: true, files: saved };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ── 从备份恢复数据库 ──
ipcMain.handle('restore-backup', (_event, filename) => {
  try {
    if (!dbDir) throw new Error('数据库未初始化');
    const backupsDir = getBackupsDir();
    const srcPath = path.join(backupsDir, filename);
    if (!fs.existsSync(srcPath)) {
      return { success: false, error: '备份文件不存在' };
    }
    // 从文件名推断数据库类型（_base.db / _user.db）
    const isUserDb = filename.endsWith('_user.db');
    const buf = fs.readFileSync(srcPath);
    try {
      const testDb = new SQL.Database(buf);
      testDb.close();
    } catch (_) {
      return { success: false, error: '备份文件不是有效的 SQLite 数据库' };
    }

    if (isUserDb) {
      // 恢复用户库
      if (userDb) closeUserDb();
      const destPath = getUserDbPath(dbDir);
      fs.copyFileSync(srcPath, destPath);
      openUserDb(dbDir);
    } else {
      // 恢复基准库
      closeDatabase(); // 同时关闭 user.db
      const destPath = getDbPath(dbDir);
      fs.copyFileSync(srcPath, destPath);
      openDb(dbDir); // 重新打开两个库
    }
    return { success: true, dbType: isUserDb ? 'user' : 'base' };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ── 删除备份文件 ──
ipcMain.handle('delete-backup', (_event, filename) => {
  try {
    if (!dbDir) throw new Error('数据库未初始化');
    const backupsDir = getBackupsDir();
    const filePath = path.join(backupsDir, filename);
    if (!fs.existsSync(filePath)) {
      return { success: false, error: '备份文件不存在' };
    }
    fs.unlinkSync(filePath);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});


// ═══════════════════════════════════════════
// 角色信息爬虫 — 从 static.nanoka.cc 获取数据
// ═══════════════════════════════════════════

// 静态数据缓存
let _cachedCharacterList = null;
let _cachedItemAll = null;
let _cachedItemAllEn = null;
const NANOKA_BASE = 'https://gi.nanoka.cc';
const LOCAL_BASE = 'http://localhost:2601';

// ── 格式转换：nanoka.cc 的 <color=#AARRGGBB> 转为 wiki 的 [color=#RRGGBB] ──
function convertColorMarkup(text) {
  if (!text || typeof text !== 'string') return text || '';
  // 1. 将字面量 \\n 转为实际换行（nanoka.cc 数据中 \\n 是 JSON 转义后的字面量）
  let result = text.replace(/\\n/g, '\n');
  // 2. 转换 <color=#FFD780FF>text</color> → [color=#FFD780]text[/color]
  // nanoka.cc 使用 8 位 hex (带 alpha: RRGGBBAA)，wiki 使用 6 位 hex
  result = result
    .replace(/<color=(#[0-9a-fA-F]{6})[0-9a-fA-F]{2}>/g, '[color=$1]')
    .replace(/<color=(#[0-9a-fA-F]{8})>/g, (_, hex) => `[color=${hex.slice(0, 7)}]`)
    .replace(/<\/color>/g, '[/color]')
    // 同时处理可能的其他 HTML 标签
    .replace(/<i>/g, '[i]').replace(/<\/i>/g, '[/i]')
    .replace(/<b>/g, '[b]').replace(/<\/b>/g, '[/b]');
  // 3. 转换 LINK 附注标记
  // S/P 前缀（技能/被动引用）：去掉 LINK 标签，保留文本
  // N 前缀（附注）：转换为 [note="ID"]text[/note]
  result = result.replace(/\{LINK#([SP]\d+)\}([\s\S]*?)\{\/LINK\}/g, '$2');
  result = result.replace(/\{LINK#(N\d+)\}([\s\S]*?)\{\/LINK\}/g, '[note="$1"]$2[/note]');
  return result;
}

// 通过 https 获取 JSON（Electron 主进程可用 Node.js http/https）
async function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? require('https') : require('http');
    const req = proto.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json,*/*',
      }
    }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        try {
          const buffer = Buffer.concat(chunks);
          resolve(JSON.parse(buffer.toString('utf-8')));
        } catch (e) { reject(new Error(`JSON parse error: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

async function fetchText(url) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? require('https') : require('http');
    const req = proto.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/json,*/*',
      }
    }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        resolve(Buffer.concat(chunks).toString('utf-8'));
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Request timeout')); });
  });
}

async function getCharacterList() {
  if (_cachedCharacterList) return _cachedCharacterList;
  const version = await getDataVersion();
  _cachedCharacterList = await fetchJson(`https://static.nanoka.cc/gi/${version}/character.json`);
  console.log('[getCharacterList] loaded, count:', Object.keys(_cachedCharacterList).length);
  return _cachedCharacterList;
}

async function getItemAll() {
  if (_cachedItemAll) return _cachedItemAll;
  const version = await getDataVersion();
  _cachedItemAll = await fetchJson(`https://static.nanoka.cc/gi/${version}/zh/item_all.json`);
  return _cachedItemAll;
}

async function getItemAllEn() {
  if (_cachedItemAllEn) return _cachedItemAllEn;
  const version = await getDataVersion();
  _cachedItemAllEn = await fetchJson(`https://static.nanoka.cc/gi/${version}/en/item_all.json`);
  return _cachedItemAllEn;
}

// ── 技能附注数据缓存（从 SSR HTML 提取，所有角色共用）──
let _cachedAnnotationData = null;

async function getAnnotationData() {
  if (_cachedAnnotationData) return _cachedAnnotationData;
  try {
    // 从任意角色页面提取附注 JSON（第一个 script type="application/json"）
    const html = await fetchText('https://gi.nanoka.cc/character/10000002');
    const match = html.match(/<script type="application\/json"[^>]*>(\{.*?\})<\/script>/s);
    if (match) {
      const outer = JSON.parse(match[1]);
      const inner = JSON.parse(outer.body);
      _cachedAnnotationData = inner;
      console.log('[getAnnotationData] loaded, entries:', Object.keys(inner).length);
    }
  } catch (e) {
    console.error('[getAnnotationData] failed:', e.message);
    _cachedAnnotationData = {};
  }
  return _cachedAnnotationData;
}

// 查找角色 ID（通过中文名或英文名匹配）
async function findCharacterId(name) {
  const list = await getCharacterList();
  // 精确匹配中文名
  for (const [id, info] of Object.entries(list)) {
    if (info.zh === name || info.en === name || info.en?.toLowerCase() === name?.toLowerCase()) {
      return { id, info };
    }
  }
  // 模糊匹配
  for (const [id, info] of Object.entries(list)) {
    if (info.zh?.includes(name) || info.en?.toLowerCase().includes(name?.toLowerCase())) {
      return { id, info };
    }
  }
  return null;
}

// ── 武器数据源配置 ──

// 辅助：依次尝试多个 URL，返回第一个成功的
async function tryFetchJson(urls) {
  for (const url of urls) {
    try {
      console.log('[tryFetchJson] trying:', url);
      return await fetchJson(url);
    } catch (e) {
      console.log('[tryFetchJson] failed:', url, e.message);
    }
  }
  throw new Error('All URLs failed');
}

// ── 静态数据版本 ──
let _dataVersion = null;

async function getDataVersion() {
  if (_dataVersion) return _dataVersion;
  // 尝试从首页获取最新版本号（5 秒超时，不阻塞）
  try {
    const html = await new Promise((resolve, reject) => {
      const req = require('https').get(`${NANOKA_BASE}/`, (res) => {
        if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      });
      req.on('error', reject);
      req.setTimeout(5000, () => { req.destroy(); reject(new Error('Timeout')); });
    });
    const m = html.match(/static\.nanoka\.cc\/gi\/([^/"]+)\//);
    if (m) _dataVersion = m[1];
  } catch (_) {}
  if (!_dataVersion) _dataVersion = '6.6.54+45738258';
  return _dataVersion;
}

// ── 武器列表（从 nanoka.cc 获取）──
let _cachedWeaponList = null;

async function getWeaponList() {
  if (_cachedWeaponList) return _cachedWeaponList;
  const version = await getDataVersion();
  _cachedWeaponList = await fetchJson(`https://static.nanoka.cc/gi/${version}/weapon.json`);
  console.log('[getWeaponList] loaded, count:', Object.keys(_cachedWeaponList).length);
  return _cachedWeaponList;
}

async function findWeaponId(name) {
  const list = await getWeaponList();
  // 精确匹配
  for (const [id, info] of Object.entries(list)) {
    if (info.zh === name || info.en === name || info.en?.toLowerCase() === name?.toLowerCase()) {
      return { id, info };
    }
  }
  // 模糊匹配
  for (const [id, info] of Object.entries(list)) {
    if (info.zh?.includes(name) || info.en?.toLowerCase().includes(name?.toLowerCase())) {
      return { id, info };
    }
  }
  return null;
}

// ── 武器类型映射 ──
const WEAPON_TYPE_MAP = {
  'WEAPON_SWORD_ONE_HAND': 1,
  'WEAPON_CLAYMORE': 2,
  'WEAPON_POLE': 3,
  'WEAPON_BOW': 4,
  'WEAPON_CATALYST': 5,
};

// ── 副属性名称映射 ──
const SUB_PROP_NAMES = {
  'FIGHT_PROP_ATTACK_PERCENT': '攻击力',
  'FIGHT_PROP_HP_PERCENT': '生命值',
  'FIGHT_PROP_DEFENSE_PERCENT': '防御力',
  'FIGHT_PROP_CRITICAL': '暴击率',
  'FIGHT_PROP_CRITICAL_HURT': '暴击伤害',
  'FIGHT_PROP_ELEMENT_MASTERY': '元素精通',
  'FIGHT_PROP_CHARGE_EFFICIENCY': '元素充能效率',
  'FIGHT_PROP_PHYSICAL_ADD_HURT': '物理伤害加成',
  'FIGHT_PROP_NONE': '',
};

// ── 从 nanoka.cc 角色页面爬取基础属性（使用 BrowserWindow）──
// ── 从 nanoka.cc 角色页面爬取基础属性（使用 BrowserWindow）──
// 复用窗口以提高批量爬取效率
let _scrapeWindow = null;
let _scrapeWindowReady = false; // 窗口已加载过一次页面（后续导航更快）

async function getScrapeWindow() {
  if (_scrapeWindow && !_scrapeWindow.isDestroyed()) return _scrapeWindow;
  _scrapeWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  _scrapeWindowReady = false;
  return _scrapeWindow;
}

function destroyScrapeWindow() {
  if (_scrapeWindow && !_scrapeWindow.isDestroyed()) {
    _scrapeWindow.close();
  }
  _scrapeWindow = null;
  _scrapeWindowReady = false;
}

async function scrapeCharacterStatsFromPage(characterId, existingWin = null) {
  const win = existingWin || await getScrapeWindow();

  try {
    const url = `https://gi.nanoka.cc/character/${characterId}`;
    await win.loadURL(url);

    // 首次加载需要更长的等待时间，后续导航更快
    const maxPolls = _scrapeWindowReady ? 15 : 30;
    _scrapeWindowReady = true;

    const stats = await win.webContents.executeJavaScript(`
      (async () => {
        const MAX_POLLS = ${maxPolls};
        // 等待滑块加载
        let slider = null;
        for (let i = 0; i < MAX_POLLS; i++) {
          slider = document.querySelector('input[type="range"]');
          if (slider) break;
          await new Promise(r => setTimeout(r, 500));
        }
        if (!slider) {
          const allInputs = document.querySelectorAll('input');
          const inputInfo = Array.from(allInputs).map(el => ({
            type: el.type, min: el.min, max: el.max, className: el.className
          }));
          return { error: 'NO_SLIDER', inputs: inputInfo, text: document.body.innerText.substring(0, 1000) };
        }

        const result = {};
        result._sliderInfo = { min: parseInt(slider.min)||1, max: parseInt(slider.max)||100, step: parseInt(slider.step)||1 };

        function setSlider(value) {
          const nativeSetter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, 'value'
          ).set;
          nativeSetter.call(slider, String(value));
          slider.dispatchEvent(new Event('input', { bubbles: true }));
          slider.dispatchEvent(new Event('change', { bubbles: true }));
        }

        function parseStats() {
          const text = document.body.innerText || '';
          const lines = text.split('\\n').map(l => l.trim()).filter(Boolean);
          const stats = {};

          const hpKeys = ['基础生命值', 'Base HP'];
          const atkKeys = ['基础攻击力', 'Base ATK'];
          const defKeys = ['基础防御力', 'Base DEF'];

          // 策略A：标签和值在不同行
          for (let i = 0; i < lines.length - 1; i++) {
            const line = lines[i];
            const next = lines[i + 1];
            if (!/^\\d{1,6}$/.test(next)) continue;
            const num = parseInt(next);
            for (const k of hpKeys) { if (line.includes(k)) stats.hp = num; }
            for (const k of atkKeys) { if (line.includes(k)) stats.atk = num; }
            for (const k of defKeys) { if (line.includes(k)) stats.def = num; }
          }

          // 策略B：标签和值在同一行
          if (!stats.hp || !stats.atk || !stats.def) {
            for (const line of lines) {
              const m = line.match(/(\\d{3,6})/g);
              if (!m) continue;
              for (const k of hpKeys) { if (line.includes(k)) stats.hp = parseInt(m[m.length-1]); }
              for (const k of atkKeys) { if (line.includes(k)) stats.atk = parseInt(m[m.length-1]); }
              for (const k of defKeys) { if (line.includes(k)) stats.def = parseInt(m[m.length-1]); }
            }
          }

          return stats;
        }

        const targetLevels = [80, 90, 95, 100];
        for (const level of targetLevels) {
          setSlider(level);
          await new Promise(r => setTimeout(r, 800));
          const s = parseStats();
          if (s.hp) result['hp_' + level] = s.hp;
          if (s.atk) result['atk_' + level] = s.atk;
          if (s.def) result['def_' + level] = s.def;
        }

        if (!result.hp_90 && !result.hp_80) {
          result._debugText = document.body.innerText.substring(0, 2500);
        }

        return result;
      })()
    `);

    return stats;
  } finally {
    // 如果没有传入已有窗口（即我们是窗口所有者），则负责清理
    if (!existingWin) {
      // 不在此销毁，保留给后续批量使用
    }
  }
}

ipcMain.handle('crawl-character', async (_event, characterName, options = {}) => {
  const { fastMode = false, crawlMode = 'full' } = options;
  try {
    // 1. 查找角色ID
    const found = await findCharacterId(characterName);
    if (!found) {
      return { success: false, error: `未找到角色: ${characterName}` };
    }
    const { id, info } = found;
    
    // 2. 获取角色详细信息（中文）
    const version = await getDataVersion();
    const detail = await fetchJson(`https://static.nanoka.cc/gi/${version}/zh/character/${id}.json`);
    
    // 3. 获取物品列表（用于材料名称映射和英文名）
    // 倍率修复/文本修复模式不需要材料数据，跳过以提速
    let items = {}, itemsEn = {};
    if (crawlMode !== 'scaling' && crawlMode !== 'text' && crawlMode !== 'fix') {
      items = await getItemAll();
      itemsEn = await getItemAllEn();
    }
    
    // 4. 解析基础信息
    const ch = detail.chara_info || {};
    // 材料类型映射
    const matTypeMap = {
      '角色天赋素材': '天赋书',
      '角色与武器培养素材': '通用掉落',
      '武器突破素材': '武器突破',
    };
    function mapMatType(itemInfo, rarity) {
      const rawType = itemInfo.type || '';
      if (rawType === '角色天赋素材') return '天赋书';
      if (rawType === '角色培养素材') return (rarity >= 5) ? '周本掉落' : 'Boss掉落';
      if (rawType === '角色与武器培养素材') return '通用掉落';
      if (rawType === '武器突破素材') return '武器突破';
      return rawType;
    }
    const result = {
      name_zh: info.zh,
      name_en: info.en,
      title_zh: ch.title || '',
      rarity: info.rank === 'QUALITY_ORANGE' ? 5 : (info.rank === 'QUALITY_PURPLE' ? 4 : 4),
      element: info.element,
      weapon_type: info.weapon,
      region: ch.region || '',
      birthday: ch.birth && ch.birth[0] && ch.birth[1] ? `${String(ch.birth[0]).padStart(2,'0')}-${String(ch.birth[1]).padStart(2,'0')}` : '',
      affiliation: ch.native || '',
      release_date: ch.release_date ? ch.release_date.split(' ')[0] : '',
      constellation_zh: ch.constellation || '',
      description_zh: convertColorMarkup(detail.desc || ''),
      // 基础属性（根据 stats_modifier 计算各级数值）
      stats: {},
      // 突破属性
      ascension_stat_name: '',
      ascension_stat_value: '',
      talents: [],
      passives: [],
      constellations: [],
      ascension_materials: [],
      talent_materials: [],
      stories: [],
      // 时装
      outfits: [],
      // 特殊料理
      special_food: null,
      // 名片
      namecard: null,
      // 图片
      images: {
        icon: detail.icon || '',
        splash: info.icon ? info.icon.replace('UI_AvatarIcon_', 'UI_Gacha_AvatarImg_') : '',
        card: info.icon || '',
      },
    };
    
    // 5. 解析技能（active skills）
    const skillTypeMap = { 0: 'normal_attack', 1: 'elemental_skill', 2: 'elemental_burst' };
    (detail.skills || []).forEach((s, idx) => {
      const skillTable = { rows: [] };

      // ── 格式A（旧）：顶层 param_names + params ──
      if (s.param_names && s.param_names.length > 0 && s.params && s.params.length > 0) {
        s.param_names.forEach((pname, pi) => {
          const values = s.params.map(levelArr => {
            const v = levelArr[pi];
            if (v === undefined || v === null) return '';
            if (typeof v === 'number') {
              if (pname.toLowerCase().includes('rate') || pname.toLowerCase().includes('dmg') || 
                  pname.toLowerCase().includes('bonus') || pname.toLowerCase().includes('heal') ||
                  pname.toLowerCase().includes('hp') || pname.toLowerCase().includes('percent')) {
                return (v * 100).toFixed(1) + '%';
              }
              return v.toFixed(1);
            }
            return String(v);
          });
          skillTable.rows.push({ label: pname, values });
        });
      }

      // ── 格式B（新）：promote[level].desc + promote[level].param ──
      if (skillTable.rows.length === 0 && s.promote) {
        const promoteEntries = Object.entries(s.promote).sort(([a], [b]) => Number(a) - Number(b));
        if (promoteEntries.length > 0) {
          const firstDesc = promoteEntries[0][1].desc || [];
          const firstParams = promoteEntries[0][1].param || [];

          // 每个 desc 条目可能引用多个 param（如 "伤害|{0}+{1}"）
          let paramCursor = 0; // 追踪当前已消费的 param 索引
          for (let di = 0; di < firstDesc.length; di++) {
            const d = firstDesc[di];
            if (typeof d !== 'string' || !d.includes('|')) {
              // 无模板，取单个 param
              const label = (typeof d === 'string') ? d : '';
              const pi = paramCursor;
              paramCursor++;
              const values = promoteEntries.map(([, levelData]) => {
                const v = (levelData.param || [])[pi];
                if (v === undefined || v === null) return '';
                if (typeof v === 'number') {
                  if (label.includes('率') || label.includes('伤害') || label.includes('加成') ||
                      label.includes('治疗') || label.includes('生命值') || label.includes('攻击力') ||
                      label.includes('防御力') || label.includes('暴击') || label.includes('充能') ||
                      label.includes('Bonus') || label.includes('DMG') || label.includes('Rate') ||
                      label.includes('Heal') || label.includes('HP') || label.includes('ATK') ||
                      label.includes('DEF') || label.includes('Crit') || label.includes('Recharge')) {
                    return (v * 100).toFixed(1) + '%';
                  }
                  return v.toFixed(1);
                }
                return String(v);
              });
              if (label) skillTable.rows.push({ label, values });
              continue;
            }

            // 解析 "标签|模板" 格式
            const pipeIdx = d.indexOf('|');
            const label = d.slice(0, pipeIdx).trim();
            const template = d.slice(pipeIdx + 1);

            // 检测模板格式：{paramN:F1P} 还是 {0}/{1}
            const isParamFormat = /\{param\d+/.test(template);
            let refCount, paramIndices;
            if (isParamFormat) {
              // {paramN:format} 格式 — N 是 1-based 索引
              const paramMatches = [...template.matchAll(/\{param(\d+)(?::([^}]*))?\}/g)];
              paramIndices = paramMatches.map(m => parseInt(m[1]) - 1); // 转为 0-based
              refCount = paramIndices.length;
            } else {
              // {0}/{1} 格式
              const paramMatches = [...template.matchAll(/\{(\d+)\}/g)];
              paramIndices = paramMatches.map(m => parseInt(m[1]));
              refCount = paramIndices.length > 0
                ? Math.max(...paramIndices) + 1
                : 1;
              // Convert to sequential indices starting from paramCursor
              paramIndices = Array.from({ length: refCount }, (_, i) => paramCursor + i);
            }

            // 为每个等级构建完整的替换字符串
            const values = promoteEntries.map(([, levelData]) => {
              const lvlParams = levelData.param || [];
              let result = template;

              for (let ri = 0; ri < refCount; ri++) {
                const pi = isParamFormat ? paramIndices[ri] : (paramCursor + ri);
                const v = lvlParams[pi];
                let display;

                // 确定格式：从模板中提取，或根据上下文判断
                let format = '';
                if (isParamFormat) {
                  const fmtMatch = template.match(new RegExp('\\{param' + (paramIndices[ri] + 1) + ':([^}]*)\\}'));
                  if (fmtMatch) format = fmtMatch[1] || '';
                }

                if (v === undefined || v === null) {
                  display = '?';
                } else if (typeof v === 'number') {
                  // 格式后缀优先级：I=整数, P=百分比, F1/F2=小数位数
                  if (format.includes('I')) {
                    display = Math.round(v).toString();
                  } else if (format.includes('P') || format.includes('%')) {
                    if (format.includes('F2')) {
                      display = (v * 100).toFixed(2) + '%';
                    } else if (format.includes('F1')) {
                      display = (v * 100).toFixed(1) + '%';
                    } else {
                      display = (v * 100).toFixed(1) + '%';
                    }
                  } else if (format.includes('F2')) {
                    display = v.toFixed(2);
                  } else if (format.includes('F1')) {
                    display = v.toFixed(1);
                  } else if (template.includes('%') || label.includes('率') || label.includes('伤害') ||
                      label.includes('加成') || label.includes('治疗') || label.includes('生命值') ||
                      label.includes('攻击力') || label.includes('防御力') || label.includes('暴击') ||
                      label.includes('充能') || label.includes('Bonus') || label.includes('DMG') ||
                      label.includes('Rate') || label.includes('Heal') || label.includes('HP') ||
                      label.includes('ATK') || label.includes('DEF') || label.includes('Crit') ||
                      label.includes('Recharge')) {
                    display = (v * 100).toFixed(1) + '%';
                  } else {
                    display = v.toFixed(1);
                  }
                } else {
                  display = String(v);
                }

                // 替换模板中的占位符
                if (isParamFormat) {
                  result = result.replace(new RegExp('\\{param' + (paramIndices[ri] + 1) + '(:[^}]*)?\\}', 'g'), display);
                } else {
                  result = result.replace(new RegExp('\\{' + ri + '\\}', 'g'), display);
                }
              }
              return result;
            });

            if (!isParamFormat) {
              paramCursor += refCount;
            }
            if (label) skillTable.rows.push({ label, values });
          }
        }
      }

      result.talents.push({
        type: skillTypeMap[idx] || 'normal_attack',
        name_zh: s.name || '',
        description_zh: convertColorMarkup(s.desc || ''),
        icon: (s.promote && s.promote['0'] && s.promote['0'].icon) ? s.promote['0'].icon : '',
        sort_order: idx + 1,
        skill_table: skillTable.rows.length > 0 ? skillTable : null,
      });
    });
    
    // 6. 解析被动天赋
    (detail.passives || []).forEach((p, idx) => {
      result.passives.push({
        type: 'passive',
        name_zh: p.name || '',
        description_zh: convertColorMarkup(p.desc || ''),
        icon: p.icon || '',
        sort_order: result.talents.length + idx + 1,
        skill_table: null,
      });
    });
    
    // 7. 解析命之座
    (detail.constellations || []).forEach((c, idx) => {
      result.constellations.push({
        level: idx + 1,
        name_zh: c.name || '',
        description_zh: convertColorMarkup(c.desc || ''),
        icon: c.icon || '',
      });
    });

    // ── 修复模式：同时修复技能倍率 + 文本附注，跳过后续解析 ──
    if (crawlMode === 'fix' || crawlMode === 'scaling' || crawlMode === 'text') {
      // 构建 N 前缀 LINK → 描述查找表（中文优先，智能选取最佳技能描述）
      const linkNotes = {};

      // 1. 优先：中文技能描述（选取最相关的技能，跳过泛用普攻描述）
      const seenBases = new Set();
      for (const s of (detail.skills || [])) {
        const chDesc = (s.desc || '').trim();
        if (!chDesc) continue;
        const nBase = Math.floor((s.id || 0) / 10) * 10;
        if (seenBases.has(nBase)) continue; // 已有更优先的技能描述
        // 跳过泛用普攻描述（去除颜色标签后以"普通攻击"开头）
        const plainDesc = chDesc.replace(/<[^>]+>/g, '').trim();
        if (plainDesc.startsWith('普通攻击') || plainDesc.startsWith('进行至多')) continue;
        seenBases.add(nBase);
        for (const variant of ['001', '002', '003', '004', '005']) {
          linkNotes['N' + nBase + variant] = chDesc;
        }
      }

      // 2. 补充：未被跳过的普攻描述（有些角色普攻也包含特殊机制）
      for (const s of (detail.skills || [])) {
        const chDesc = (s.desc || '').trim();
        if (!chDesc) continue;
        const plainDesc = chDesc.replace(/<[^>]+>/g, '').trim();
        if (plainDesc.startsWith('普通攻击') || plainDesc.startsWith('进行至多')) continue;
        const nBase = Math.floor((s.id || 0) / 10) * 10;
        for (const variant of ['001', '002', '003', '004', '005']) {
          const nKey = 'N' + nBase + variant;
          if (!linkNotes[nKey]) {
            linkNotes[nKey] = chDesc;
          }
        }
      }

      // 3. 兜底：英文 SSR 附注数据
      try {
        const annotations = await getAnnotationData();
        for (const [key, value] of Object.entries(annotations)) {
          if (/^\d+$/.test(key) && value && value.desc) {
            const nKey = 'N' + key;
            if (!linkNotes[nKey]) {
              linkNotes[nKey] = value.desc || '';
            }
          }
        }
      } catch (_) {}

      function convertLinks(rawDesc) {
        if (!rawDesc || typeof rawDesc !== 'string') return rawDesc || '';
        let result = rawDesc.replace(/\{LINK#([SP]\d+)\}([\s\S]*?)\{\/LINK\}/g, '$2');
        result = result.replace(/\{LINK#(N\d+)\}\s*([\s\S]*?)\{\/LINK\}/g, (match, linkId, text) => {
          let noteText = linkNotes[linkId] || linkId;
          // 清洗附注文本：只去除破坏格式的字符，保留颜色标记
          const cleanNote = noteText
            .replace(/"/g, "'")
            .replace(/[\n\r]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .substring(0, 400);
          return `[note="${cleanNote}"]${text.trim()}[/note]`;
        });
        return result;
      }

      // Rebuild talents with skill_table preserved + LINK conversion
      result.talents = [];
      (detail.skills || []).forEach((s, idx) => {
        // Re-parse skill_table (same logic as steps 5 above)
        const skillTable = { rows: [] };
        if (s.param_names && s.param_names.length > 0 && s.params && s.params.length > 0) {
          s.param_names.forEach((pname, pi) => {
            const values = s.params.map(levelArr => {
              const v = levelArr[pi];
              if (v === undefined || v === null) return '';
              if (typeof v === 'number') {
                if (pname.toLowerCase().includes('rate') || pname.toLowerCase().includes('dmg') || 
                    pname.toLowerCase().includes('bonus') || pname.toLowerCase().includes('heal') ||
                    pname.toLowerCase().includes('hp') || pname.toLowerCase().includes('percent')) {
                  return (v * 100).toFixed(1) + '%';
                }
                return v.toFixed(1);
              }
              return String(v);
            });
            skillTable.rows.push({ label: pname, values });
          });
        }
        if (skillTable.rows.length === 0 && s.promote) {
          const promoteEntries = Object.entries(s.promote).sort(([a], [b]) => Number(a) - Number(b));
          if (promoteEntries.length > 0) {
            const firstDesc = promoteEntries[0][1].desc || [];
            let paramCursor = 0;
            for (let di = 0; di < firstDesc.length; di++) {
              const d = firstDesc[di];
              if (typeof d !== 'string' || !d.includes('|')) {
                const label = (typeof d === 'string') ? d : '';
                const pi = paramCursor;
                paramCursor++;
                const values = promoteEntries.map(([, levelData]) => {
                  const v = (levelData.param || [])[pi];
                  if (v === undefined || v === null) return '';
                  if (typeof v === 'number') {
                    if (label.includes('率') || label.includes('伤害') || label.includes('加成') ||
                        label.includes('治疗') || label.includes('生命值') || label.includes('攻击力') ||
                        label.includes('防御力') || label.includes('暴击') || label.includes('充能') ||
                        label.includes('Bonus') || label.includes('DMG') || label.includes('Rate') ||
                        label.includes('Heal') || label.includes('HP') || label.includes('ATK') ||
                        label.includes('DEF') || label.includes('Crit') || label.includes('Recharge')) {
                      return (v * 100).toFixed(1) + '%';
                    }
                    return v.toFixed(1);
                  }
                  return String(v);
                });
                if (label) skillTable.rows.push({ label, values });
                continue;
              }
              const pipeIdx = d.indexOf('|');
              const label = d.slice(0, pipeIdx).trim();
              const template = d.slice(pipeIdx + 1);
              const isParamFormat = /\{param\d+/.test(template);
              let refCount, paramIndices;
              if (isParamFormat) {
                const paramMatches = [...template.matchAll(/\{param(\d+)(?::([^}]*))?\}/g)];
                paramIndices = paramMatches.map(m => parseInt(m[1]) - 1);
                refCount = paramIndices.length;
              } else {
                const paramMatches = [...template.matchAll(/\{(\d+)\}/g)];
                paramIndices = paramMatches.map(m => parseInt(m[1]));
                refCount = paramIndices.length > 0 ? Math.max(...paramIndices) + 1 : 1;
                paramIndices = Array.from({ length: refCount }, (_, i) => paramCursor + i);
              }
              const values = promoteEntries.map(([, levelData]) => {
                const lvlParams = levelData.param || [];
                let result = template;
                for (let ri = 0; ri < refCount; ri++) {
                  const pi = isParamFormat ? paramIndices[ri] : (paramCursor + ri);
                  const v = lvlParams[pi];
                  let display;
                  let format = '';
                  if (isParamFormat) {
                    const fmtMatch = template.match(new RegExp('\\{param' + (paramIndices[ri] + 1) + ':([^}]*)\\}'));
                    if (fmtMatch) format = fmtMatch[1] || '';
                  }
                  if (v === undefined || v === null) {
                    display = '?';
                  } else if (typeof v === 'number') {
                    if (format.includes('I')) {
                      display = Math.round(v).toString();
                    } else if (format.includes('P') || format.includes('%')) {
                      if (format.includes('F2')) display = (v * 100).toFixed(2) + '%';
                      else if (format.includes('F1')) display = (v * 100).toFixed(1) + '%';
                      else display = (v * 100).toFixed(1) + '%';
                    } else if (format.includes('F2')) {
                      display = v.toFixed(2);
                    } else if (format.includes('F1')) {
                      display = v.toFixed(1);
                    } else if (template.includes('%') || label.includes('率') || label.includes('伤害') ||
                        label.includes('加成') || label.includes('治疗') || label.includes('生命值') ||
                        label.includes('攻击力') || label.includes('防御力') || label.includes('暴击') ||
                        label.includes('充能') || label.includes('Bonus') || label.includes('DMG') ||
                        label.includes('Rate') || label.includes('Heal') || label.includes('HP') ||
                        label.includes('ATK') || label.includes('DEF') || label.includes('Crit') ||
                        label.includes('Recharge')) {
                      display = (v * 100).toFixed(1) + '%';
                    } else {
                      display = v.toFixed(1);
                    }
                  } else {
                    display = String(v);
                  }
                  if (isParamFormat) {
                    result = result.replace(new RegExp('\\{param' + (paramIndices[ri] + 1) + '(:[^}]*)?\\}', 'g'), display);
                  } else {
                    result = result.replace(new RegExp('\\{' + ri + '\\}', 'g'), display);
                  }
                }
                return result;
              });
              if (!isParamFormat) paramCursor += refCount;
              if (label) skillTable.rows.push({ label, values });
            }
          }
        }

        result.talents.push({
          type: skillTypeMap[idx] || 'normal_attack',
          name_zh: s.name || '',
          description_zh: convertColorMarkup(convertLinks(s.desc || '')),
          icon: (s.promote && s.promote['0'] && s.promote['0'].icon) ? s.promote['0'].icon : '',
          sort_order: idx + 1,
          skill_table: skillTable.rows.length > 0 ? skillTable : null,
        });
      });

      result.passives = [];
      (detail.passives || []).forEach((p, idx) => {
        result.passives.push({
          type: 'passive',
          name_zh: p.name || '',
          description_zh: convertColorMarkup(convertLinks(p.desc || '')),
          icon: p.icon || '',
          sort_order: result.talents.length + idx + 1,
          skill_table: null,
        });
      });

      result.constellations = [];
      (detail.constellations || []).forEach((c, idx) => {
        result.constellations.push({
          level: idx + 1,
          name_zh: c.name || '',
          description_zh: convertColorMarkup(convertLinks(c.desc || '')),
          icon: c.icon || '',
        });
      });

      return { success: true, data: { mode: 'fix', talents: result.talents, passives: result.passives, constellations: result.constellations } };
    }
    
    // 8. 解析突破材料
    const ascMats = detail.materials?.ascensions || [];
    const ascMatMap = new Map();
    ascMats.forEach(level => {
      (level.mats || []).forEach(m => {
        const existing = ascMatMap.get(m.id);
        if (!existing || m.count > existing.maxCount) {
          ascMatMap.set(m.id, { name: m.name, id: m.id, maxCount: m.count, rank: m.rank });
        }
      });
    });
    ascMatMap.forEach((v) => {
      const itemInfo = items[String(v.id)] || {};
      const itemInfoEn = itemsEn[String(v.id)] || {};
      const rarity = itemInfo.rank != null ? itemInfo.rank : v.rank;
      result.ascension_materials.push({
        material_id: v.id,
        material_name: v.name,
        material_name_en: itemInfoEn.name || '',
        quantity: String(v.maxCount),
        rarity: rarity,
        type: mapMatType(itemInfo, rarity),
        description: convertColorMarkup(itemInfo.desc || ''),
        source: (itemInfo.source_list || []).join('；'),
        icon: itemInfo.icon || '',
      });
    });
    
    // 9. 解析天赋材料
    const talentMats = detail.materials?.talents || [];
    const talentMatMap = new Map();
    talentMats.forEach(talentGroup => {
      talentGroup.forEach(level => {
        (level.mats || []).forEach(m => {
          const key = String(m.id);
          const existing = talentMatMap.get(key);
          if (!existing || m.count > existing.maxCount) {
            talentMatMap.set(key, { name: m.name, id: m.id, maxCount: m.count, rank: m.rank });
          }
        });
      });
    });
    talentMatMap.forEach((v) => {
      const itemInfo = items[String(v.id)] || {};
      const itemInfoEn = itemsEn[String(v.id)] || {};
      const rarity = itemInfo.rank != null ? itemInfo.rank : v.rank;
      result.talent_materials.push({
        material_id: v.id,
        material_name: v.name,
        material_name_en: itemInfoEn.name || '',
        quantity: String(v.maxCount),
        rarity: rarity,
        type: mapMatType(itemInfo, rarity),
        description: convertColorMarkup(itemInfo.desc || ''),
        source: (itemInfo.source_list || []).join('；'),
        icon: itemInfo.icon || '',
      });
    });

    // 9.5 获取各级基础属性
    const sm = detail.stats_modifier || {};
    let statsScraped = false;

    if (crawlMode === 'full' || crawlMode === 'fill') {
      // BrowserWindow 抓取仅在完整模式 + 非快速模式
      if (crawlMode === 'full' && !fastMode) {
        try {
          const sharedWin = await getScrapeWindow();
          const scrapedStats = await scrapeCharacterStatsFromPage(id, sharedWin);
          if (scrapedStats && !scrapedStats.error && typeof scrapedStats.hp_90 === 'number') {
            for (const [k, v] of Object.entries(scrapedStats)) {
              if (k.startsWith('hp_') || k.startsWith('atk_') || k.startsWith('def_')) {
                result.stats[k] = v;
              }
            }
            statsScraped = true;
          } else if (scrapedStats && scrapedStats._debugText) {
            console.warn('[crawl-character] scraping returned no stats. Debug text:', scrapedStats._debugText.substring(0, 500));
          }
        } catch (scrapeErr) {
          console.error('[crawl-character] stats scraping failed:', scrapeErr.message);
        }
      }

      // 公式回退（填充模式、快速模式 或 抓取失败时）
      if (!statsScraped) {
        if (crawlMode === 'fill') {
          console.log('[crawl-character] fill mode: using formula for stats');
        } else if (fastMode) {
          console.log('[crawl-character] fast mode: using formula for stats');
        } else {
          console.log('[crawl-character] using fallback formula for stats');
        }
        const baseHp = detail.base_hp || 0;
        const baseAtk = detail.base_atk || 0;
        const baseDef = detail.base_def || 0;
        const curves = { hp: sm.hp || {}, atk: sm.atk || {}, def: sm.def || {} };
        const lastAsc = (sm.ascension && sm.ascension.length > 0) ? sm.ascension[sm.ascension.length - 1] : {};
        const ascBonusHp = lastAsc.fight_prop_base_hp || 0;
        const ascBonusAtk = lastAsc.fight_prop_base_attack || 0;
        const ascBonusDef = lastAsc.fight_prop_base_defense || 0;
        for (const lvl of ['80', '90', '95', '100']) {
          result.stats[`hp_${lvl}`] = Math.round(baseHp * (curves.hp[lvl] || 1) + ascBonusHp);
          result.stats[`atk_${lvl}`] = Math.round(baseAtk * (curves.atk[lvl] || 1) + ascBonusAtk);
          result.stats[`def_${lvl}`] = Math.round(baseDef * (curves.def[lvl] || 1) + ascBonusDef);
        }
      }
    }

    // 9.6 解析突破属性（取最后一个 ascension 的非基础属性）
    const ascData = sm.ascension || [];
    if (ascData.length > 0) {
      const lastAsc = ascData[ascData.length - 1];
      const baseKeys = ['fight_prop_base_hp', 'fight_prop_base_defense', 'fight_prop_base_attack'];
      // 突破属性中英文名映射
      const ascStatNameMap = {
        'fight_prop_critical': '暴击率',
        'fight_prop_critical_hurt': '暴击伤害',
        'fight_prop_attack_percent': '攻击力',
        'fight_prop_hp_percent': '生命值',
        'fight_prop_defense_percent': '防御力',
        'fight_prop_charge_efficiency': '元素充能效率',
        'fight_prop_elemental_mastery': '元素精通',
        'fight_prop_physical_add_hurt': '物理伤害加成',
        'fight_prop_ice_add_hurt': '冰元素伤害加成',
        'fight_prop_fire_add_hurt': '火元素伤害加成',
        'fight_prop_water_add_hurt': '水元素伤害加成',
        'fight_prop_wind_add_hurt': '风元素伤害加成',
        'fight_prop_rock_add_hurt': '岩元素伤害加成',
        'fight_prop_elec_add_hurt': '雷元素伤害加成',
        'fight_prop_grass_add_hurt': '草元素伤害加成',
        'fight_prop_heal_add': '治疗加成',
      };
      for (const [k, v] of Object.entries(lastAsc)) {
        if (!baseKeys.includes(k) && v > 0) {
          result.ascension_stat_name = ascStatNameMap[k] || k.replace('fight_prop_', '');
          result.ascension_stat_value = (v * 100).toFixed(1) + '%';
          break;
        }
      }
    }
    
    // 10. 解析角色故事
    (ch.stories || []).forEach((s, idx) => {
      result.stories.push({
        title_zh: s.title || '',
        content: convertColorMarkup(s.text || ''),
        sort_order: idx + 1,
      });
    });

    // 11. 解析时装
    const costumes = ch.costume || {};
    if (Array.isArray(costumes)) {
      // 新格式：数组，quality===0 或 无icon 的是默认时装（排在首位）
      const sorted = [...costumes].sort((a, b) => {
        const aDef = !a.icon || a.quality === 0 ? 1 : 0;
        const bDef = !b.icon || b.quality === 0 ? 1 : 0;
        return bDef - aDef; // 默认在前
      });
      sorted.forEach(cs => {
        const isDefault = !cs.icon || cs.quality === 0;
        result.outfits.push({
          name_zh: cs.name || (isDefault ? '默认时装' : ''),
          description_zh: convertColorMarkup(cs.desc || ''),
          image: cs.icon || '',
          is_default: isDefault ? 1 : 0,
        });
      });
    } else {
      // 旧格式兼容：{ default_costume, costume_list }
      if (costumes.default_costume) {
        result.outfits.push({
          name_zh: costumes.default_costume.name || '默认时装',
          description_zh: convertColorMarkup(costumes.default_costume.desc || ''),
          image: costumes.default_costume.icon || '',
          is_default: 1,
        });
      }
      (costumes.costume_list || []).forEach((cs, idx) => {
        result.outfits.push({
          name_zh: cs.name || '',
          description_zh: convertColorMarkup(cs.desc || ''),
          image: cs.icon || '',
          is_default: 0,
        });
      });
    }

    // 12. 解析特殊料理
    const food = ch.special_food || {};
    if (food.name) {
      // 从 item_all 中查找料理的描述和效果
      const foodItem = items[String(food.id)] || {};
      result.special_food = {
        name_zh: food.name || '',
        description_zh: convertColorMarkup(foodItem.desc || food.desc || ''),
        effect: convertColorMarkup(foodItem.effect || food.effect || ''),
        image: food.icon || foodItem.icon || '',
      };
    }

    // 13. 解析名片
    const nc = ch.namecard || {};
    if (nc.name) {
      result.namecard = {
        name: nc.name || '',
        description: convertColorMarkup(nc.desc || ''),
        image: nc.icon || '',
      };
    }
    
    return { success: true, data: result };
  } catch (e) {
    console.error('[crawl-character] error:', e.message);
    return { success: false, error: e.message };
  }
});

// 获取角色列表（用于批量爬虫时查找）
ipcMain.handle('get-character-list', async () => {
  try {
    const list = await getCharacterList();
    const simplified = {};
    for (const [id, info] of Object.entries(list)) {
      simplified[id] = { zh: info.zh, en: info.en, element: info.element, rank: info.rank };
    }
    return { success: true, data: simplified };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ── 下载图片（从本地 HomDGCat 服务器）──
const IMAGE_SERVER = 'http://localhost:2601';

function getImageUrl(iconName) {
  if (!iconName) return null;
  // 名片图片
  if (iconName.startsWith('UI_NameCardPic_')) {
    return `https://static.nanoka.cc/assets/gi/${iconName}.webp`;
  }
  // 技能图标（本地服务器）
  if (iconName.startsWith('Skill_') || iconName.startsWith('UI_Talent_')) {
    return `${IMAGE_SERVER}/homdgcat-res/AvatarSkill/${iconName}.png`;
  }
  // UI_ 前缀统一走 nanoka.cc（头像、物品、武器、圣遗物等）
  if (iconName.startsWith('UI_')) {
    return `https://static.nanoka.cc/assets/gi/${iconName}.webp`;
  }
  // 默认尝试 nanoka.cc
  return `https://static.nanoka.cc/assets/gi/${iconName}.webp`;
}

function getImageFilename(iconName) {
  if (!iconName) return '';
  // 所有图片保留原始图标名作为文件名
  // 注意：虽然 nanoka.cc 实际提供 webp，但保持 png 扩展名以兼容已有 DB 记录
  return `${iconName}.png`;
}

ipcMain.handle('download-material-image', async (_event, iconName) => {
  try {
    if (!dbDir) throw new Error('数据库未初始化');
    const url = getImageUrl(iconName);
    if (!url) return { success: false, error: '无效的图标名称' };
    
    const filename = getImageFilename(iconName);
    const imagesDir = getImagesDir(dbDir);
    
    // 如果已有同名图片（忽略扩展名），直接返回
    const existing = resolveImagePath(imagesDir, filename);
    if (existing) {
      return { success: true, filename: path.basename(existing), existed: true };
    }
    
    const destPath = path.join(imagesDir, filename);
    
    // 下载图片
    const imageData = await new Promise((resolve, reject) => {
      const proto = url.startsWith('https') ? require('https') : require('http');
      const req = proto.get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: ${url}`));
          return;
        }
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      });
      req.on('error', reject);
      req.setTimeout(15000, () => {
        req.destroy();
        reject(new Error(`Request timeout: ${url}`));
      });
    });
    
    fs.writeFileSync(destPath, imageData);
    clearImagePathCache();
    return { success: true, filename };
  } catch (e) {
    console.error('[download-material-image] error:', e.message);
    return { success: false, error: e.message };
  }
});

// ── 下载祈愿 banner 图片（从任意 URL）──
ipcMain.handle('download-banner-image', async (_event, url, filename) => {
  try {
    if (!dbDir || !url || !filename) return { success: false, error: '参数不完整' };
    const imagesDir = getImagesDir(dbDir);
    
    // 如果已有同名图片（忽略扩展名），直接返回
    const existing = resolveImagePath(imagesDir, filename);
    if (existing) return { success: true, filename: path.basename(existing), existed: true };
    
    const destPath = path.join(imagesDir, filename);

    const imageData = await new Promise((resolve, reject) => {
      const proto = url.startsWith('https') ? require('https') : require('http');
      const req = proto.get(url, (res) => {
        if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}: ${url}`)); return; }
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      });
      req.on('error', reject);
      req.setTimeout(15000, () => { req.destroy(); reject(new Error(`Timeout: ${url}`)); });
    });

    fs.writeFileSync(destPath, imageData);
    clearImagePathCache();
    console.log('[download-banner-image] saved:', filename);
    return { success: true, filename };
  } catch (e) {
    console.error('[download-banner-image] error:', e.message);
    return { success: false, error: e.message };
  }
});

// ── 从指定 URL 下载图片到本地 ──
async function downloadImage(url, iconName, ext = 'png') {
  if (!dbDir || !url || !iconName) return;
  const filename = `${iconName}.${ext}`;
  const imagesDir = getImagesDir(dbDir);
  
  // 如果已有同名图片（忽略扩展名），跳过下载
  if (resolveImagePath(imagesDir, filename)) return;
  
  const destPath = path.join(imagesDir, filename);
  try {
    const imageData = await new Promise((resolve, reject) => {
      const proto = url.startsWith('https') ? require('https') : require('http');
      const req = proto.get(url, (res) => {
        if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}: ${url}`)); return; }
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      });
      req.on('error', reject);
      req.setTimeout(15000, () => { req.destroy(); reject(new Error(`Timeout: ${url}`)); });
    });
    fs.writeFileSync(destPath, imageData);
    clearImagePathCache();
    console.log('[downloadImage] saved:', filename);
  } catch (e) {
    console.error('[downloadImage] error:', url, e.message);
  }
}

// ── 祈愿爬虫：从 wiki.biligame.com 抓取往期祈愿数据 ──
ipcMain.handle('crawl-wishes', async () => {
  try {
    // ── 1. 获取 raw wiki 标记（~90KB，比 HTML 小很多）──
    const rawUrl = 'https://wiki.biligame.com/ys/index.php?title=%E5%BE%80%E6%9C%9F%E7%A5%88%E6%84%BF&action=raw';
    let raw;
    try {
      raw = await fetchText(rawUrl);
      console.log('[crawl-wishes] Raw markup fetched, size:', raw.length);
    } catch (e) {
      return { success: false, error: '获取 wiki 页面失败: ' + e.message };
    }

    // ── 2. 版本映射 ──
    const moonVersionMap = {};
    for (let i = 1; i <= 8; i++) {
      moonVersionMap[`月之${['', '一', '二', '三', '四', '五', '六', '七', '八'][i]}`] = `6.${i - 1}`;
    }
    const phaseMap = { '一': 1, '二': 2, '三': 3 };

    // ── 3. 按 section 切分并解析模板 ──
    const sectionRegex = /===\s*(月之[一二三四五六七八]·第[一二三]期|\d+\.\d+·第[一二三]期)\s*===/g;
    const sections = [];
    let lastIdx = 0, sm;
    while ((sm = sectionRegex.exec(raw)) !== null) {
      if (lastIdx > 0) sections[sections.length - 1].body = raw.slice(lastIdx, sm.index);
      sections.push({ header: sm[1], body: '' });
      lastIdx = sm.index + sm[0].length;
    }
    if (lastIdx > 0 && sections.length > 0) {
      sections[sections.length - 1].body = raw.slice(lastIdx);
    }

    const wishes = [];
    for (const section of sections) {
      if (!section.body) continue;
      
      let sectionVersion, sectionPhase;
      const hm = section.header.match(/^(月之[一二三四五六七八])·第([一二三])期$|^(\d+\.\d+)·第([一二三])期$/);
      if (!hm) continue;
      if (hm[1]) { sectionVersion = moonVersionMap[hm[1]]; sectionPhase = phaseMap[hm[2]] || 1; }
      else { sectionVersion = hm[3]; sectionPhase = phaseMap[hm[4]] || 1; }

      // 角色祈愿
      const charRegex = /\{\{祈愿\/角色活动祈愿\n([\s\S]*?)\}\}/g;
      let cm;
      while ((cm = charRegex.exec(section.body)) !== null) {
        const p = parseWikiParams(cm[1]);
        if (!p['5星角色']) continue;
        const vl = p['版本'] || '';
        let v = sectionVersion, ph = sectionPhase;
        const vm = vl.match(/(?:月之[一二三四五六七八]|(\d+\.\d+))(上半|下半)/);
        if (vm) { if (vm[1]) v = vm[1]; ph = vm[2] === '上半' ? 1 : 2; }
        let sd = '', ed = '';
        if (p['开始时间']) sd = normalizeDate(p['开始时间']);
        else if ((p['开始时间描述']||'').includes('版本更新后')) sd = '__VERSION_UPDATE__';
        if (p['结束时间']) ed = normalizeDate(p['结束时间']);
        wishes.push({
          version: v, phase: ph, banner_type: 'character-event',
          name_zh: p['名称'] || '',
          start_date: sd, end_date: ed, period: p['期数'] || '',
          five_star: (p['5星角色']||'').split('、').map(s=>s.trim()).filter(Boolean).map(n=>({name:n,element:''})),
          four_star: (p['4星角色']||'').split('、').map(s=>s.trim()).filter(Boolean).map(n=>({name:n,element:''})),
          banner_images: [],
        });
      }

      // 武器祈愿
      const weaponRegex = /\{\{祈愿\/武器活动祈愿\n([\s\S]*?)\}\}/g;
      let wm;
      while ((wm = weaponRegex.exec(section.body)) !== null) {
        const p = parseWikiParams(wm[1]);
        if (!p['5星武器']) continue;
        const vl = p['版本'] || '';
        let v = sectionVersion, ph = sectionPhase;
        const vm = vl.match(/(?:月之[一二三四五六七八]|(\d+\.\d+))(上半|下半)/);
        if (vm) { if (vm[1]) v = vm[1]; ph = vm[2] === '上半' ? 1 : 2; }
        let sd = '', ed = '';
        if (p['开始时间']) sd = normalizeDate(p['开始时间']);
        else if ((p['开始时间描述']||'').includes('版本更新后')) sd = '__VERSION_UPDATE__';
        if (p['结束时间']) ed = normalizeDate(p['结束时间']);
        wishes.push({
          version: v, phase: ph, banner_type: 'weapon-event',
          name_zh: '神铸赋形',
          start_date: sd, end_date: ed, period: p['期数'] || '',
          five_star: (p['5星武器']||'').split('、').map(s=>s.trim()).filter(Boolean).map(n=>({name:n,element:''})),
          four_star: (p['4星武器']||'').split('、').map(s=>s.trim()).filter(Boolean).map(n=>({name:n,element:''})),
          banner_images: [],
        });
      }
    }

    console.log('[crawl-wishes] Parsed', wishes.length, 'wishes from raw markup');

    // ── 4. 通过 MediaWiki API 获取图片 ──
    await new Promise(r => setTimeout(r, 600));
    const imageFileNames = [];
    for (let wi = 0; wi < wishes.length; wi++) {
      const w = wishes[wi];
      if (!w.period) continue;
      const isW = w.banner_type === 'weapon-event';
      imageFileNames.push({ fileName: isW ? `祈愿${w.period}期武器.png` : `祈愿${w.period}期.png`, wishIndex: wi });
    }
    const uniqueFiles = [...new Set(imageFileNames.map(f => f.fileName))];
    const imageUrlMap = {};
    
    const BATCH = 8;
    for (let bi = 0; bi < uniqueFiles.length; bi += BATCH) {
      const batch = uniqueFiles.slice(bi, bi + BATCH);
      const titles = batch.map(f => `File:${f}`).join('|');
      // Encode each title individually, keep | as separator
      const encodedTitles = batch.map(f => encodeURIComponent(`File:${f}`)).join('|');
      const apiUrl = `https://wiki.biligame.com/ys/api.php?action=query&titles=${encodedTitles}&prop=imageinfo&iiprop=url&format=json`;
      try {
        const res = await fetchJson(apiUrl);
        let batchCount = 0;
        for (const page of Object.values(res?.query?.pages || {})) {
          const fn = (page.title||'').replace(/^(File|文件):/, '');
          const url = page.imageinfo?.[0]?.url;
          if (fn && url) { imageUrlMap[fn] = url; batchCount++; }
        }
        console.log('[crawl-wishes] API batch', bi/BATCH+1, '/', Math.ceil(uniqueFiles.length/BATCH), '- got', batchCount, 'images');
      } catch (e) {
        console.error('[crawl-wishes] API batch', bi/BATCH+1, 'failed:', e.message);
      }
      if (bi + BATCH < uniqueFiles.length) await new Promise(r => setTimeout(r, 1000));
    }
    
    for (const { fileName, wishIndex } of imageFileNames) {
      const url = imageUrlMap[fileName];
      if (url) {
        const ext = (url.match(/\.(\w+)(?:\?|$)/)||[,'png'])[1].toLowerCase();
        wishes[wishIndex].banner_images = [{ url, filename: `_temp.${ext}` }];
      }
    }

    // ── 5. 重命名 ──
    const swMap = {};
    for (const w of wishes) {
      const k = `${w.version}|${w.phase}`;
      if (!swMap[k]) swMap[k] = { c: [], w: null };
      if (w.banner_type === 'character-event') swMap[k].c.push(w);
      else swMap[k].w = w;
    }
    let imageCount = 0;
    for (const [k, sw] of Object.entries(swMap)) {
      const v = sw.c[0]?.version || sw.w?.version || '';
      const p = String(sw.c[0]?.phase || sw.w?.phase || 1).padStart(2, '0');
      for (let i = 0; i < sw.c.length; i++) {
        if (sw.c[i].banner_images?.[0]) {
          const ext = sw.c[i].banner_images[0].filename.replace('_temp.', '');
          sw.c[i].banner_images[0].filename = `Gacha_${v}_${p}_${String(i+1).padStart(2,'0')}.${ext}`;
          imageCount++;
        }
      }
      if (sw.w?.banner_images?.[0]) {
        const ext = sw.w.banner_images[0].filename.replace('_temp.', '');
        sw.w.banner_images[0].filename = `Gacha_Weapon_${v}_${p}_01.${ext}`;
        imageCount++;
      }
    }

    console.log('[crawl-wishes] Done:', wishes.length, 'wishes,', imageCount, 'images');
    return { success: true, data: wishes, imageCount };
  } catch (e) {
    console.error('[crawl-wishes] error:', e);
    return { success: false, error: e.message };
  }
});

// ── 祈愿图片修复：仅获取期数对应的图片 URL ──
ipcMain.handle('crawl-wish-images', async (_event, periods) => {
  try {
    const uniqueFiles = [...new Set(periods.map(p => `File:${p}`))];
    const imageUrlMap = {};
    const BATCH = 8;
    for (let bi = 0; bi < uniqueFiles.length; bi += BATCH) {
      const batch = uniqueFiles.slice(bi, bi + BATCH);
      const encodedTitles = batch.map(f => encodeURIComponent(f)).join('|');
      const apiUrl = `https://wiki.biligame.com/ys/api.php?action=query&titles=${encodedTitles}&prop=imageinfo&iiprop=url&format=json`;
      try {
        const res = await fetchJson(apiUrl);
        for (const page of Object.values(res?.query?.pages || {})) {
          const fn = (page.title||'').replace(/^(File|文件):/, '');
          const url = page.imageinfo?.[0]?.url;
          if (fn && url) imageUrlMap[fn] = url;
        }
      } catch (e) {
        console.error('[crawl-wish-images] batch failed:', e.message);
      }
      if (bi + BATCH < uniqueFiles.length) await new Promise(r => setTimeout(r, 800));
    }
    return { success: true, images: imageUrlMap };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ── 解析 HTML 文本中的单个祈愿条目 ──
function parseBannerEntry(lines, startIdx, type, sectionVersion, sectionPhase) {
  try {
    let fiveStarNames = [], fourStarNames = [];
    let timeStr = '', versionLabel = '', nameZh = '';

    const fiveLine = lines[startIdx];
    const nextLine = startIdx + 1 < lines.length ? lines[startIdx + 1] : '';

    if (type === 'character') {
      let fiveText = fiveLine.replace(/^5星角色\s*/, '');
      if (!fiveText && /^「/.test(nextLine)) fiveText = nextLine;
      fiveStarNames = parseItemNames(fiveText, 'character');
    } else {
      let fiveText = fiveLine.replace(/^5星武器\s*/, '');
      if (!fiveText && /^「/.test(nextLine)) fiveText = nextLine;
      fiveStarNames = parseItemNames(fiveText, 'weapon');
    }

    for (let i = startIdx + 1; i < Math.min(lines.length, startIdx + 20); i++) {
      const line = lines[i], nextL = i + 1 < lines.length ? lines[i + 1] : '';
      if (/^4星角色/.test(line)) {
        let t = line.replace(/^4星角色\s*/, '');
        if (!t && /^「/.test(nextL)) { t = nextL; i++; }
        if (type === 'character') fourStarNames = parseItemNames(t, 'character');
      } else if (/^4星武器/.test(line)) {
        let t = line.replace(/^4星武器\s*/, '');
        if (!t && /^「/.test(nextL)) { t = nextL; i++; }
        if (type === 'weapon') fourStarNames = parseItemNames(t, 'weapon');
      } else if (/^时间/.test(line)) {
        let t = line.replace(/^时间\s*/, '');
        if (!t && nextL && /\d/.test(nextL)) { t = nextL; i++; }
        timeStr = t;
      } else if (/^版本/.test(line)) {
        let v = line.replace(/^版本\s*/, '');
        if (!v && nextL) { v = nextL; i++; }
        versionLabel = v;
        break;
      }
    }

    let version = sectionVersion, phase = sectionPhase;
    if (versionLabel) {
      const vpMatch = versionLabel.match(/^(\d+\.\d+)(上半|下半|中)/);
      if (vpMatch) {
        version = vpMatch[1];
        phase = vpMatch[2] === '上半' ? 1 : vpMatch[2] === '下半' ? 2 : 2;
      }
    }

    let startDate = '', endDate = '';
    if (timeStr) {
      const fullMatch = timeStr.match(/(\d{4}\/\d{2}\/\d{2}[^\s~]*)\s*~\s*(\d{4}\/\d{2}\/\d{2}[^\s]*)/);
      if (fullMatch) {
        startDate = normalizeDate(fullMatch[1]); endDate = normalizeDate(fullMatch[2]);
      } else {
        const updateMatch = timeStr.match(/(\d+\.\d+)版本更新后\s*~\s*(\d{4}\/\d{2}\/\d{2}[^\s]*)/);
        if (updateMatch) {
          startDate = `__VERSION_UPDATE__`; endDate = normalizeDate(updateMatch[2]);
        }
      }
    }

    const bannerType = type === 'character' ? 'character-event' : 'weapon-event';
    return {
      version, phase, banner_type,
      name_zh: nameZh || (bannerType === 'weapon-event' ? '神铸赋形' : ''),
      start_date: startDate, end_date: endDate,
      five_star: fiveStarNames, four_star: fourStarNames,
      banner_images: [],
    };
  } catch (e) { return null; }
}

// ── 解析物品名称列表 ──
function parseItemNames(text, type) {
  if (!text) return [];
  const names = [];
  let inner = text.trim();
  if (inner.startsWith('「')) inner = inner.slice(1);
  if (inner.endsWith('」')) inner = inner.slice(0, -1);
  const parts = inner.split('」「');
  for (const fullName of parts) {
    if (!fullName) continue;
    let itemName = '', element = '';
    if (type === 'character') {
      const parenMatch = fullName.match(/\((.+?)\)$/);
      if (parenMatch) element = parenMatch[1];
      const withoutElement = fullName.replace(/\(.+?\)$/, '');
      const dotParts = withoutElement.split('·');
      itemName = dotParts[dotParts.length - 1].trim().replace(/[「」]/g, '');
    } else {
      const dotParts = fullName.split('·');
      itemName = (dotParts.length > 1 ? dotParts[dotParts.length - 1] : fullName).trim().replace(/[「」]/g, '');
    }
    if (itemName) names.push({ name: itemName, element });
  }
  return names;
}

// ── 解析 wiki 模板参数（保留，用于可能的回退）──
function parseWikiParams(text) {
  const params = {};
  const lines = text.split('\n');
  for (const line of lines) {
    const m = line.match(/^\|(.+?)=(.*)/);
    if (m) {
      params[m[1].trim()] = m[2].trim();
    }
  }
  return params;
}

// ── 标准化日期格式 ──
function normalizeDate(str) {
  if (!str) return '';
  str = str.trim();
  const dateMatch = str.match(/^(\d{4}\/\d{2}\/\d{2})/);
  if (dateMatch) {
    return dateMatch[1].replace(/\//g, '-');
  }
  return str;
}

// ── 导出种子数据：从当前 db 更新 seed.sql ──
ipcMain.handle('export-seed', async (_event, newVersion) => {

  try {
    if (!dbDir || !db) throw new Error('数据库未初始化');
    dbSave(); // 确保最新数据写入磁盘

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

      let filteredRows = rows;
      // 过滤孤儿引用
      if (tableName === 'wish_banner_items') {
        const bannerResult = db.exec('SELECT id FROM wish_banners');
        const validBannerIds = new Set(bannerResult[0]?.values.map(r => r[0]) || []);
        const bannerIdIdx = columns.indexOf('banner_id');
        if (bannerIdIdx >= 0 && validBannerIds.size > 0) {
          filteredRows = filteredRows.filter(row => validBannerIds.has(row[bannerIdIdx]));
        }
      }
      if (!filteredRows.length) return null;

      const colNames = columns.map(c => `"${c}"`).join(', ');
      const lines = filteredRows.map(row => `  (${row.map(v => esc(v)).join(', ')})`);
      return {
        sql: `INSERT INTO "${tableName}" (${colNames}) VALUES\n${lines.join(',\n')};\n\n`,
        count: filteredRows.length,
      };
    }

    const tableResult = db.exec(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != 'image_cache' ORDER BY name"
    );
    if (!tableResult.length) return { success: false, error: '无数据表' };
    const tables = tableResult[0].values.map(r => r[0]);

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

    const dateStr = beijingDateStr();
    const version = newVersion || DATA_VERSION;
    let out = `-- ============================================================================\n`;
    out += `-- 银月终端数据库 - 种子数据（导出于 ${dateStr}）\n`;
    out += `-- 数据版本: ${version}\n`;
    out += `-- 来源: ${getDbPath(dbDir)}\n`;
    out += `-- 不含 image_cache 表数据\n`;
    out += `-- ============================================================================\n\n`;

    let total = 0, tableCount = 0;
    for (const table of sortedTables) {
      const r = tableToInsert(table);
      if (r && r.count > 0) {
        out += `-- ----------------------------------------------------------------------------\n`;
        out += `-- ${table}\n`;
        out += `-- ----------------------------------------------------------------------------\n`;
        out += r.sql;
        total += r.count;
        tableCount++;
      }
    }

    // 写入 seed.sql（asarUnpack 解出路径；asar 内只读不可写）
    const searchDirs = [
      path.join(process.resourcesPath || '', 'app.asar.unpacked', 'electron'),
      path.join(__dirname, '..', 'electron'),
      path.join(__dirname),
    ];
    let outputDir = null;
    for (const d of searchDirs) {
      if (fs.existsSync(path.join(d, 'schema.sql'))) { outputDir = d; break; }
    }
    if (!outputDir) {
      outputDir = path.join(__dirname);
    }
    const outputPath = path.join(outputDir, 'seed.sql');
    fs.writeFileSync(outputPath, out, 'utf-8');

    // 清理旧的分片文件
    for (let i = 1; i <= 5; i++) {
      const partPath = path.join(outputDir, `seed_part${i}.sql`);
      if (fs.existsSync(partPath)) fs.unlinkSync(partPath);
    }

    return { success: true, output: `导出完成\n表数: ${tableCount}, 记录: ${total}, 文件: ${outputPath}` };
  } catch (e) {
    console.error('[export-seed] error:', e);
    return { success: false, error: e.message };
  }
});

// ── 清理未被引用的图片 ──
ipcMain.handle('clean-unused-images', () => {
  try {
    if (!dbDir || !db) throw new Error('数据库未初始化');
    const imagesDir = getImagesDir(dbDir);
    if (!fs.existsSync(imagesDir)) {
      return { success: true, deleted: 0, message: '图片文件夹不存在' };
    }
    
    // 辅助：从存储的图片名提取基名（去除扩展名）
    const toBase = (name) => {
      if (!name) return '';
      const ext = path.extname(name);
      return ext ? path.basename(name, ext) : name;
    };
    
    // 获取数据库中被引用的所有图片文件名 → 转为基名集合
    const referenced = new Set();
    const tables = [
      { table: 'characters', cols: ['splash_art', 'card_art', 'namecard_art', 'dish_image'] },
      { table: 'weapons', cols: ['image', 'simple_art'] },
      { table: 'artifacts', cols: ['image', 'flower_image', 'plume_image', 'sands_image', 'goblet_image', 'circlet_image'] },
      { table: 'materials', cols: ['image'] },
      { table: 'character_outfits', cols: ['image', 'avatar_image'] },
      { table: 'character_talents', cols: ['icon'] },
      { table: 'character_constellations', cols: ['icon'] },
      { table: 'elements', cols: ['icon'] },
      { table: 'weapon_types', cols: ['icon'] },
      { table: 'regions', cols: ['icon'] },
      { table: 'enemies', cols: ['image'] },
      { table: 'element_reactions', cols: ['icon'] },
      { table: 'wishes', cols: ['banner_image'] },
      { table: 'wish_banners', cols: ['banner_image'] },
      { table: 'perilous_trail_bosses', cols: ['boss_image'] },
    ];
    
    for (const { table, cols } of tables) {
      for (const col of cols) {
        try {
          const rows = dbAll(`SELECT DISTINCT ${col} FROM ${table} WHERE ${col} IS NOT NULL AND ${col} != ''`, []);
          for (const row of rows) {
            const val = row[col];
            if (val) referenced.add(toBase(val));
          }
        } catch (_) { /* table or column may not exist */ }
      }
    }
    
    // 也检查 gallery_images 和 images JSON 字段
    try {
      const galleryTables = ['characters', 'weapons'];
      for (const table of galleryTables) {
        try {
          const rows = dbAll(`SELECT gallery_images FROM ${table} WHERE gallery_images IS NOT NULL AND gallery_images != ''`, []);
          for (const row of rows) {
            try {
              const arr = JSON.parse(row.gallery_images);
              if (Array.isArray(arr)) {
                for (const item of arr) {
                  if (item.filename) referenced.add(toBase(item.filename));
                }
              }
            } catch (_) {}
          }
        } catch (_) {}
      }
      // game_data.images
      try {
        const rows = dbAll(`SELECT images FROM game_data WHERE images IS NOT NULL AND images != ''`, []);
        for (const row of rows) {
          try {
            const arr = JSON.parse(row.images);
            if (Array.isArray(arr)) {
              for (const item of arr) {
                if (typeof item === 'string') referenced.add(toBase(item));
              }
            }
          } catch (_) {}
        }
      } catch (_) {}
    } catch (_) {}
    
    // 递归列出图片文件夹中所有文件
    let totalFiles = 0;
    let deleted = 0;
    const emptyDirs = [];
    
    function walkAndClean(dir) {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        let hasFiles = false;
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isSymbolicLink()) continue;
          if (entry.isDirectory()) {
            const subHasFiles = walkAndClean(fullPath);
            if (!subHasFiles) emptyDirs.push(fullPath);
            else hasFiles = true;
          } else if (entry.isFile()) {
            totalFiles++;
            hasFiles = true;
            const ext = path.extname(entry.name);
            const base = path.basename(entry.name, ext);
            if (!referenced.has(base)) {
              try {
                fs.unlinkSync(fullPath);
                deleted++;
              } catch (_) {}
            }
          }
        }
        return hasFiles;
      } catch (_) { return false; }
    }
    
    walkAndClean(imagesDir);
    
    // 清理空子目录（倒序删除，从深到浅）
    for (const d of emptyDirs.reverse()) {
      try { if (fs.readdirSync(d).length === 0) fs.rmdirSync(d); } catch (_) {}
    }
    
    clearImagePathCache();
    
    return { success: true, deleted, total: totalFiles, message: `扫描 ${totalFiles} 个文件，删除 ${deleted} 个未被引用的图片` };
  } catch (e) {
    console.error('[clean-unused-images] error:', e.message);
    return { success: false, error: e.message };
  }
});
ipcMain.handle('get-user-config', () => {
  try {
    const config = loadUserConfig();
    return { success: true, config };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('set-user-config', (_event, key, value) => {
  try {
    const config = loadUserConfig();
    config[key] = value;
    saveUserConfig(config);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ── 自动更新 ──
autoUpdater.setMaxListeners(20); // prevent MaxListenersExceededWarning
autoUpdater.setFeedURL({
  provider: 'github',
  owner: 'ParteaDream',
  repo: 'SilverMoon-Terminal',
  vPrefixedTagName: true,
  releaseType: 'release',
});
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;
autoUpdater.allowPrerelease = true;

autoUpdater.on('checking-for-update', () => {
  mainWindow?.webContents?.send('update-status', { event: 'checking' });
});
autoUpdater.on('update-available', (info) => {
  mainWindow?.webContents?.send('update-status', { event: 'available', version: info.version });
});
autoUpdater.on('update-not-available', () => {
  mainWindow?.webContents?.send('update-status', { event: 'not-available' });
});
autoUpdater.on('download-progress', (p) => {
  mainWindow?.webContents?.send('update-status', { event: 'progress', percent: Math.floor(p.percent) });
});
autoUpdater.on('update-downloaded', () => {
  mainWindow?.webContents?.send('update-status', { event: 'downloaded' });
});
autoUpdater.on('error', (err) => {
  const msg = err && err.message ? err.message : '';
  const isMac = process.platform === 'darwin';
  const ymlFile = isMac ? 'latest-mac.yml' : 'latest.yml';
  if (msg.includes(ymlFile) || msg.includes('404')) {
    mainWindow?.webContents?.send('update-status', {
      event: 'error',
      message: `服务器尚未发布更新元数据（${ymlFile}），请等待新版本发布`,
    });
  } else if (msg.toLowerCase().includes('code signature') || msg.includes('SQRLCodeSignatureError')) {
    // 当前运行的应用没有正式签名 → 文件实际已下载到 ShipIt 缓存
    // macOS: 直接显示"已下载"让用户点"打开并退出"手动安装
    // Windows: quitAndInstall 不需要签名验证，不应走到这里
    if (isMac) {
      mainWindow?.webContents?.send('update-status', { event: 'downloaded' });
    } else {
      mainWindow?.webContents?.send('update-status', {
        event: 'error',
        message: '更新安装失败：代码签名验证未通过。请手动下载新版本覆盖安装。',
      });
    }
  } else {
    mainWindow?.webContents?.send('update-status', {
      event: 'error',
      message: `检查更新失败: ${msg || '请确认网络连接'}`,
    });
  }
});

ipcMain.handle('install-update', () => {
  if (process.platform === 'darwin') {
    // macOS 无 Developer ID 证书时，ShipIt 重启会因签名验证失败而卡住
    // 打开 ShipIt 缓存目录，用户可手动将新 .app 拖入 /Applications
    const cachesDir = path.dirname(app.getPath('cache'));
    const shipItDir = path.join(cachesDir, 'com.silvermoon.terminal.ShipIt');
    console.log('[update] shipIt dir:', shipItDir, 'exists:', fs.existsSync(shipItDir));
    // Try to open the ShipIt root, or the latest update subfolder
    let targetDir = shipItDir;
    if (fs.existsSync(shipItDir)) {
      // Find the latest update.* subfolder
      try {
        const entries = fs.readdirSync(shipItDir).filter(e => e.startsWith('update.'));
        if (entries.length > 0) {
          entries.sort();
          targetDir = path.join(shipItDir, entries[entries.length - 1]);
          console.log('[update] found update subfolder:', targetDir);
        }
      } catch (_) {}
      try { shell.openPath(targetDir); } catch (_) {}
    }
    // Delay quit to let Finder open
    setTimeout(() => app.quit(), 500);
  } else {
    // Windows: NSIS 安装器原生支持更新，直接调用 quitAndInstall
    autoUpdater.quitAndInstall();
  }
});

ipcMain.handle('check-for-update', async () => {
  try {
    // Windows: 每次检查前重置 autoUpdater 内部状态，避免后续检查超时
    if (process.platform === 'win32') {
      autoUpdater.setFeedURL({
        provider: 'github',
        owner: 'ParteaDream',
        repo: 'SilverMoon-Terminal',
        vPrefixedTagName: true,
        releaseType: 'release',
      });
      // 清理更新缓存目录，消除 stale 状态
      const updaterCacheDir = path.join(app.getPath('userData'), '..', 'silvermoon-terminal-updater');
      if (fs.existsSync(updaterCacheDir)) {
        try { fs.rmSync(updaterCacheDir, { recursive: true, force: true }); } catch (_) {}
      }
      const squirrelCache = path.join(app.getPath('cache'), '..', 'silvermoon-terminal-updater');
      if (fs.existsSync(squirrelCache)) {
        try { fs.rmSync(squirrelCache, { recursive: true, force: true }); } catch (_) {}
      }
    }
    // 设置 20s 超时，避免 GitHub API 无响应时永久卡住
    const result = await Promise.race([
      autoUpdater.checkForUpdates(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('检查超时，请检查网络连接')), 20000)),
    ]);
    return { success: true, version: result?.updateInfo?.version };
  } catch (e) {
    return { success: false, error: e.message || '未找到可用更新' };
  }
});
ipcMain.handle('download-update', async () => {
  try {
    await autoUpdater.downloadUpdate();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('get-update-auto-check', () => {
  try {
    const config = loadUserConfig();
    // 默认开启（首次使用时 config 中无此 key）
    return { success: true, enabled: config.autoCheckUpdate !== false };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// 清理更新缓存（解决关闭后重开卡住/报错的问题）
ipcMain.handle('clear-update-cache', async () => {
  try {
    const updaterCacheDir = path.join(app.getPath('userData'), '..', 'silvermoon-terminal-updater');
    if (fs.existsSync(updaterCacheDir)) {
      fs.rmSync(updaterCacheDir, { recursive: true, force: true });
    }
    // Windows Squirrel 缓存
    const squirrelCache = path.join(app.getPath('cache'), '..', 'silvermoon-terminal-updater');
    if (fs.existsSync(squirrelCache)) {
      fs.rmSync(squirrelCache, { recursive: true, force: true });
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});
ipcMain.handle('set-update-auto-check', (_event, enabled) => {
  try {
    const config = loadUserConfig();
    config.autoCheckUpdate = !!enabled;
    saveUserConfig(config);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('open-external', (_event, url) => {
  shell.openExternal(url);
});

// ── 应用图标替换 ──
const ICON_BACKUP_DIR = 'icon-backups';

function getAppIconPaths() {
  const paths = { iconPath: null, appBundlePath: null, exePath: null };
  try {
    if (process.platform === 'darwin') {
      // macOS: icon.icns inside .app bundle
      const resourcesPath = process.resourcesPath;
      if (resourcesPath) {
        paths.iconPath = path.join(resourcesPath, 'icon.icns');
        paths.appBundlePath = path.resolve(resourcesPath, '..', '..');
      }
    } else if (process.platform === 'win32') {
      paths.exePath = app.getPath('exe');
    }
  } catch (_) {}
  return paths;
}

ipcMain.handle('set-app-icon', async (_event, { filename, pngData }) => {
  try {
    if (!dbDir) throw new Error('数据库未初始化');

    // 解析源图标路径：优先使用 pngData（base64 编码的合成图标），其次使用 filename
    let srcPath = null;
    if (pngData) {
      // 将 base64 PNG 写入临时文件
      const backupDir = path.join(app.getPath('userData'), ICON_BACKUP_DIR);
      if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
      srcPath = path.join(backupDir, 'app_icon_composited.png');
      const matches = pngData.match(/^data:image\/png;base64,(.+)$/);
      if (!matches) throw new Error('无效的图片数据');
      fs.writeFileSync(srcPath, Buffer.from(matches[1], 'base64'));
    } else if (filename) {
      const userImagesDir = getUserImagesDir(dbDir);
      srcPath = path.join(userImagesDir, filename);
      if (!fs.existsSync(srcPath)) srcPath = null;
    }
    // 没有自定义图标时，使用默认图标（public/ 目录下的默认图片）
    if (!srcPath) {
      const defaultDirs = [
        path.join(__dirname, '..', 'public'),
        path.join(__dirname, '..', 'dist'),
        path.join(process.resourcesPath || '', 'dist'),
      ];
      for (const d of defaultDirs) {
        const candidate = path.join(d, 'UI_Talent_U_Columbina_02.webp');
        if (fs.existsSync(candidate)) { srcPath = candidate; break; }
      }
    }
    if (!srcPath) throw new Error('未找到可用的图标源文件');

    // 备份当前图标
    const backupDir = path.join(app.getPath('userData'), ICON_BACKUP_DIR);
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

    let result;
    if (process.platform === 'darwin') {
      const { iconPath, appBundlePath } = getAppIconPaths();

      // 检查是否在打包模式下运行（开发模式下无 .app bundle）
      if (!iconPath || !fs.existsSync(path.dirname(iconPath))) {
        throw new Error('应用图标替换仅在打包后（生产模式）可用。开发模式下无法替换 .app 图标。');
      }

      // 备份原图标
      if (fs.existsSync(iconPath)) {
        fs.copyFileSync(iconPath, path.join(backupDir, 'icon.icns.backup'));
      }

      // 将 PNG 转换为 ICNS
      const tmpIcns = path.join(backupDir, 'icon_converted.icns');
      const { execSync } = require('child_process');
      execSync(`sips -s format icns "${srcPath}" --out "${tmpIcns}"`, { stdio: 'pipe', timeout: 30000 });

      // 替换 icon.icns
      if (fs.existsSync(tmpIcns)) {
        fs.copyFileSync(tmpIcns, iconPath);
        try { fs.unlinkSync(tmpIcns); } catch (_) {}
      } else {
        throw new Error('ICNS 转换失败');
      }

      // 刷新图标缓存
      if (appBundlePath && fs.existsSync(appBundlePath)) {
        try { execSync(`touch "${appBundlePath}"`, { stdio: 'pipe', timeout: 5000 }); } catch (_) {}
      }
      // 尝试用 Electron API 立即更新 Dock 图标
      try {
        const img = nativeImage.createFromPath(srcPath);
        if (app.dock) app.dock.setIcon(img);
      } catch (_) {}

      result = { success: true, platform: 'darwin' };
    } else if (process.platform === 'win32') {
      const { exePath } = getAppIconPaths();
      if (!exePath) throw new Error('无法定位可执行文件路径');

      // 备份原图标（保存 exe 备份，只备份一次）
      const backupExe = path.join(backupDir, 'app.exe.backup');
      if (!fs.existsSync(backupExe)) {
        try { fs.copyFileSync(exePath, backupExe); } catch (_) {}
      }

      // 下载 rcedit
      const rceditPath = path.join(backupDir, 'rcedit.exe');
      if (!fs.existsSync(rceditPath)) {
        const https = require('https');
        const rceditUrl = 'https://github.com/electron/rcedit/releases/download/v2.0.0/rcedit-x64.exe';
        await new Promise((resolve, reject) => {
          const file = fs.createWriteStream(rceditPath);
          https.get(rceditUrl, (res) => {
            if (res.statusCode === 302 || res.statusCode === 301) {
              https.get(res.headers.location, (r) => r.pipe(file));
            } else {
              res.pipe(file);
            }
            file.on('finish', () => { file.close(); resolve(); });
          }).on('error', (e) => { try { fs.unlinkSync(rceditPath); } catch (_) {} reject(e); });
        });
      }

      if (!fs.existsSync(rceditPath)) {
        result = { success: false, error: '无法下载 rcedit，请检查网络连接' };
      } else {
        // Windows 上正在运行的 exe 无法直接修改，采用延迟批处理方案
        // 创建 bat 脚本：等待应用退出 → 替换图标 → 重启
        const batPath = path.join(backupDir, 'apply_icon.bat');
        const appFolder = path.dirname(exePath);
        const appName = path.basename(exePath);

        // 安全转义路径中的反斜杠（bat 中需要引号保护）
        const safeExe = exePath;
        const safeRcedit = rceditPath;
        const safeIcon = srcPath;

        // 注意：bat 必须使用 CRLF (\r\n) 行尾，否则 cmd 下 if 块解析可能异常
        // 不用 BOM、不用中文、不用 chcp，纯 ASCII 确保任何区域设置下都正常工作
        const CRLF = '\r\n';
        const batContent = [
          '@echo off',
          '',
          ':wait',
          'tasklist /fi "IMAGENAME eq ' + appName + '" 2>nul | find /i "' + appName + '" >nul',
          'if not errorlevel 1 (',
          '  timeout /t 2 /nobreak >nul',
          '  goto wait',
          ')',
          '',
          ':: wait for OS to release file handle',
          'timeout /t 3 /nobreak >nul',
          '',
          '"' + safeRcedit + '" "' + safeExe + '" --set-icon "' + safeIcon + '"',
          'if errorlevel 1 (',
          '  timeout /t 3 /nobreak >nul',
          '  "' + safeRcedit + '" "' + safeExe + '" --set-icon "' + safeIcon + '"',
          '  if errorlevel 1 (',
          '    timeout /t 3 /nobreak >nul',
          '    "' + safeRcedit + '" "' + safeExe + '" --set-icon "' + safeIcon + '"',
          '    if errorlevel 1 (',
          '      echo Icon replace failed, try Run as Admin',
          '      pause',
          '      exit /b 1',
          '    )',
          '  )',
          ')',
          '',
          'start "" "' + safeExe + '"',
          'exit /b 0',
          '',
        ].join(CRLF);
        fs.writeFileSync(batPath, batContent, 'ascii');

        // 以分离进程方式启动批处理（不阻塞当前应用）
        const { spawn } = require('child_process');
        spawn('cmd.exe', ['/c', 'start', '', '/min', batPath], {
          detached: true,
          stdio: 'ignore',
        }).unref();

        result = { success: true, platform: 'win32', deferred: true };
      }
    } else {
      result = { success: false, error: '当前平台不支持图标替换' };
    }

    return result || { success: false, error: '未知错误' };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('undo-app-icon', async () => {
  try {
    const backupDir = path.join(app.getPath('userData'), ICON_BACKUP_DIR);
    if (!fs.existsSync(backupDir)) throw new Error('没有可撤回的备份');

    if (process.platform === 'darwin') {
      const { iconPath } = getAppIconPaths();
      const backupIcns = path.join(backupDir, 'icon.icns.backup');
      if (!fs.existsSync(backupIcns)) throw new Error('备份文件不存在');

      fs.copyFileSync(backupIcns, iconPath);
      try { fs.unlinkSync(backupIcns); } catch (_) {}

      // 刷新图标
      try {
        const { execSync } = require('child_process');
        const { appBundlePath } = getAppIconPaths();
        if (appBundlePath) execSync(`touch "${appBundlePath}"`, { stdio: 'pipe', timeout: 5000 });
      } catch (_) {}
      // 重置 Dock 图标
      try { if (app.dock) app.dock.setIcon(null); } catch (_) {}

      return { success: true, platform: 'darwin' };
    } else if (process.platform === 'win32') {
      const backupExe = path.join(backupDir, 'app.exe.backup');
      if (!fs.existsSync(backupExe)) throw new Error('备份文件不存在');

      const { exePath } = getAppIconPaths();
      // Windows 上无法覆盖正在运行的可执行文件，给出提示
      return { success: false, error: 'Windows 上请在关闭应用后手动替换:\n源: ' + backupExe + '\n目标: ' + exePath };
    }

    return { success: false, error: '当前平台不支持' };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ── 清理缓存 ──
ipcMain.handle('clear-app-cache', async () => {
  try {
    const userDataPath = app.getPath('userData');
    const cacheDir = path.join(userDataPath, 'Cache');
    let deletedSize = 0;

    if (fs.existsSync(cacheDir)) {
      deletedSize = getDirSize(cacheDir);

      // 先清除 Chromium 会话缓存，释放文件锁（解决 Windows EPERM）
      if (mainWindow?.webContents?.session) {
        try {
          await mainWindow.webContents.session.clearCache();
          // 等待文件锁释放（blob 文件可能需要更长时间）
          await new Promise(r => setTimeout(r, 2000));
        } catch (_) {}
      }

      // Windows 特殊处理：尝试解除文件锁定后删除
      if (process.platform === 'win32') {
        try {
          // 先递归移除只读属性，再尝试改名（改名有时能绕过文件锁）
          renameForDeletion(cacheDir);
        } catch (_) {}
      }

      // 带重试的删除（Windows 上某些文件需较长时间释放锁）
      let retries = 6;
      let lastErr = null;
      while (retries > 0) {
        try {
          fs.rmSync(cacheDir, { recursive: true, force: true });
          lastErr = null;
          break;
        } catch (e) {
          lastErr = e;
          retries--;
          if (retries > 0) await new Promise(r => setTimeout(r, 2000));
        }
      }
      if (lastErr) throw lastErr;

      console.log('[clear-app-cache] deleted Cache dir, size:', deletedSize);
    }

    return {
      success: true,
      deletedSize,
      deletedSizeFormatted: formatBytes(deletedSize),
      targets: ['Cache'],
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ── 查询缓存大小 ──
ipcMain.handle('get-cache-size', () => {
  try {
    const userDataPath = app.getPath('userData');
    const cacheDir = path.join(userDataPath, 'Cache');
    const total = fs.existsSync(cacheDir) ? getDirSize(cacheDir) : 0;
    return { success: true, sizes: { Cache: total }, total, totalFormatted: formatBytes(total) };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

function getDirSize(dirPath) {
  try {
    let total = 0;
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const e of entries) {
      const fp = path.join(dirPath, e.name);
      try {
        if (e.isFile()) total += fs.statSync(fp).size;
        else if (e.isDirectory()) total += getDirSize(fp);
      } catch (_) {}
    }
    return total;
  } catch (_) { return 0; }
}

/**
 * Windows 上尝试通过改名来解除文件锁，以便后续删除。
 * 改名可以在某些情况下绕过文件句柄锁定（尤其对 blob 文件有效）。
 */
function renameForDeletion(dirPath) {
  if (!fs.existsSync(dirPath)) return;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fp = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        renameForDeletion(fp);
        // 尝试给目录下 blob/data_ 文件改名为随机名
        try {
          const sub = fs.readdirSync(fp, { withFileTypes: true });
          for (const s of sub) {
            if (s.name.startsWith('blob') || s.name.startsWith('data_')) {
              const sfp = path.join(fp, s.name);
              try {
                const tmp = path.join(fp, '.del_' + Date.now() + '_' + Math.random().toString(36).slice(2));
                fs.renameSync(sfp, tmp);
              } catch (_) {}
            }
          }
        } catch (_) {}
      } else if (entry.name.startsWith('blob') || entry.name.startsWith('data_')) {
        try {
          const tmp = path.join(dirPath, '.del_' + Date.now() + '_' + Math.random().toString(36).slice(2));
          fs.renameSync(fp, tmp);
        } catch (_) {}
      }
    }
  } catch (_) {}
}

function formatBytes(bytes) {
  if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(2) + ' GB';
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return bytes + ' B';
}

function clearCachedData() {
  _cachedCharacterList = null;
  _cachedItemAll = null;
  _cachedItemAllEn = null;
  _cachedAppVersion = null;
}

function checkUpdateOnStartup() {
  const config = loadUserConfig();
  if (config.autoCheckUpdate !== false) {
    console.log('[startup] checking for updates...');
    autoUpdater.checkForUpdates().then(info => {
      console.log('[startup] check result:', info?.updateInfo?.version || 'no update');
    }).catch(err => {
      console.warn('[startup] update check failed (silent):', err?.message || 'unknown');
    });
  } else {
    console.log('[startup] auto-update check disabled by user');
  }
}

// ── 页面状态持久化（最近5页的滚动+滑块信息）──
ipcMain.handle('load-page-states', () => {
  try {
    const config = loadUserConfig();
    return { success: true, states: config.pageStates || [] };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('save-page-states', (_event, states) => {
  try {
    const config = loadUserConfig();
    // 只保留最近5条
    if (states.length > 5) states = states.slice(-5);
    config.pageStates = states;
    saveUserConfig(config);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ── 武器信息爬虫 ──
ipcMain.handle('crawl-weapon', async (_event, weaponName, options = {}) => {
  const { fastMode = false, crawlMode = 'full' } = options;
  try {
    // 1. 以武器名字为 key，从 nanoka.cc 搜索正确的武器 ID
    //    数据库中的 ID 可能已过期/错误；若名字搜不到则尝试用传入的 ID
    let weaponId, info;
    const found = await findWeaponId(weaponName);
    if (found) {
      weaponId = found.id;
      info = found.info;
    } else if (options.weaponId) {
      // 名字搜索失败（如查漏模式名称为 "ID:xxx" 或中文名未匹配），
      // 回退到直接用传入 ID 在武器列表中查找
      const list = await getWeaponList();
      const item = list[String(options.weaponId)];
      if (item) {
        weaponId = String(options.weaponId);
        info = item;
      } else {
        return { success: false, error: `未找到武器: ${weaponName}` };
      }
    } else {
      return { success: false, error: `未找到武器: ${weaponName}` };
    }
    const dbId = options.weaponId;  // 数据库中的旧 ID（仅用于返回给前端更新记录）

    // 2. 获取武器详细信息（从 nanoka.cc），同时预热物品列表缓存
    let detail = null;
    const version = await getDataVersion();
    const detailUrl = `https://static.nanoka.cc/gi/${version}/zh/weapon/${weaponId}.json`;
    // 并行启动 item_all 加载（5MB+，最慢的部分，提前下载）
    const itemsPromise = getItemAll();
    try {
      console.log('[crawl-weapon] trying:', detailUrl);
      detail = await fetchJson(detailUrl);
    } catch (e) {
      console.log('[crawl-weapon] failed:', detailUrl, e.message);
    }
    if (!detail) {
      return { success: false, error: `无法获取武器 ${weaponId}（${weaponName}）的详情数据` };
    }

    // 3. 等待物品列表（此时大概率已下载完成）
    let items = {};
    try { items = await itemsPromise; } catch (_) { items = {}; }

    // 材料类型映射（武器相关）
    function mapWeaponMatType(itemInfo, rarity) {
      const rawType = itemInfo.type || '';
      if (rawType === '武器突破素材') return '武器突破';
      if (rawType === '角色与武器培养素材') return '通用掉落';
      if (rawType === '角色培养素材') return (rarity >= 5) ? '周本掉落' : 'Boss掉落';
      return rawType;
    }

    // 4. 解析基础信息
    const wp = detail.weapon_prop || [];
    const baseAtkProp = wp.find(p => p.prop_type === 'FIGHT_PROP_BASE_ATTACK') || wp[0] || {};
    const subProp = wp.find(p => p.prop_type !== 'FIGHT_PROP_BASE_ATTACK') || wp[1] || {};

    // 计算 Lv1 和 Lv90 基础攻击力（含突破加成）
    const baseAtk = baseAtkProp.init_value || 0;
    const atkModifier = detail.stats_modifier?.atk || {};
    // 累计突破攻击力加成（ascension 各阶段累积值）
    let ascAtkBonus = 0;
    const ascData = detail.ascension || {};
    const ascKeys = Object.keys(ascData).sort((a, b) => Number(a) - Number(b));
    if (ascKeys.length > 0) {
      const lastAsc = ascData[ascKeys[ascKeys.length - 1]];
      ascAtkBonus = lastAsc.fight_prop_base_attack || lastAsc.fight_prop_base_atk || 0;
    }
    const baseAtkLv1 = Math.round(baseAtk * (atkModifier.levels?.['1'] || atkModifier.levels?.[1] || 1));
    const baseAtkLv90 = Math.round(baseAtk * (atkModifier.levels?.['90'] || atkModifier.levels?.[90] || 1) + ascAtkBonus);

    // 副属性
    const subInit = subProp.init_value || 0;
    const subKey = subProp.prop_type || '';
    const subName = SUB_PROP_NAMES[subKey] || subKey;
    // stats_modifier 的 key 是小写（如 fight_prop_critical_hurt），prop_type 是大写
    const subModifier = detail.stats_modifier?.[subKey.toLowerCase()] || {};
    const subValueLv1 = subKey === 'FIGHT_PROP_NONE' ? '0' : `${parseFloat((subInit * (subModifier.levels?.['1'] || subModifier.levels?.[1] || 1) * 100).toFixed(1))}%`;
    const subValueLv90 = subKey === 'FIGHT_PROP_NONE' ? '0' : `${parseFloat((subInit * (subModifier.levels?.['90'] || subModifier.levels?.[90] || 1) * 100).toFixed(1))}%`;

    // 精炼特效：比对 5 级 desc 中同位置 <color> 块，值不同则格式化为 [v1/v2/v3/v4/v5]
    const refData = detail.refinement || {};
    const ref1 = refData['1'] || refData[1] || {};
    let passiveDesc = '';
    let refinementStr = '';
    if (ref1.desc) {
      let desc = ref1.desc;
      // 收集 5 级的 desc
      const allDescs = [];
      for (let lv = 1; lv <= 5; lv++) {
        const r = refData[String(lv)] || refData[lv];
        allDescs.push((r && r.desc) ? r.desc : ref1.desc);
      }
      // 提取 level 1 的 <color> 块
      const colorRegex = /<color=#[0-9a-fA-F]+>([^<]+)<\/color>/g;
      const colorBlocks = [];
      let m;
      while ((m = colorRegex.exec(desc)) !== null) {
        colorBlocks.push({ full: m[0], value: m[1] });
      }
      // 对其他 4 个等级，同样提取 color 块
      const allLevelColors = [colorBlocks.map(c => c.value)];
      for (let lv = 1; lv < 5; lv++) {
        const lvColors = [];
        const lvRegex = /<color=#[0-9a-fA-F]+>([^<]+)<\/color>/g;
        let lm;
        while ((lm = lvRegex.exec(allDescs[lv])) !== null) {
          lvColors.push(lm[1]);
        }
        allLevelColors.push(lvColors);
      }
      // 对每个 color block 位置，逐段比较斜杠分隔的子值
      const replacements = [];
      for (let ci = 0; ci < colorBlocks.length; ci++) {
        const blockValues = allLevelColors.map(lc => (ci < lc.length ? lc[ci] : colorBlocks[ci].value));
        // 将每个等级的 block 值按 '/' 拆分
        const partsPerLevel = blockValues.map(v => v.split('/'));
        const partCount = partsPerLevel[0].length;
        // 检查所有等级的段数是否一致
        const consistent = partsPerLevel.every(p => p.length === partCount);
        if (!consistent) {
          // 段数不一致，退化为整体替换
          const allSame = blockValues.every(v => v === blockValues[0]);
          if (!allSame) {
            const block = colorBlocks[ci];
            const newContent = `[${blockValues.join('/')}]`;
            replacements.push({ full: block.full, value: block.value, replacement: block.full.replace(block.value, newContent) });
          }
          continue;
        }
        // 逐段比较
        const newParts = [];
        let hasChange = false;
        for (let pi = 0; pi < partCount; pi++) {
          const partValues = partsPerLevel.map(p => p[pi]);
          const partAllSame = partValues.every(v => v === partValues[0]);
          if (partAllSame) {
            newParts.push(partValues[0]);
          } else {
            newParts.push(`[${partValues.join('/')}]`);
            hasChange = true;
          }
        }
        if (hasChange) {
          const block = colorBlocks[ci];
          const newContent = newParts.join('/');
          replacements.push({ full: block.full, value: block.value, replacement: block.full.replace(block.value, newContent) });
        }
      }
      // 应用替换（从后往前）
      for (let ri = replacements.length - 1; ri >= 0; ri--) {
        const r = replacements[ri];
        desc = desc.replace(r.full, r.replacement);
      }
      passiveDesc = convertColorMarkup(desc);
    }

    const iconName = detail.icon || info?.icon || '';
    const gachaIconName = iconName.replace('UI_EquipIcon_', 'UI_Gacha_EquipIcon_');

    const result = {
      id: Number(weaponId),         // nanoka.cc 的正确武器 ID
      db_id: dbId,                  // 原数据库 ID（可能不同，供前端更新用）
      name_zh: detail.name || info?.zh || weaponName,
      name_en: info?.en || '',
      rarity: detail.rarity || info?.rank || 4,
      weapon_type: WEAPON_TYPE_MAP[detail.weapon_type] || 0,
      base_atk: baseAtkLv1,
      max_base_atk: baseAtkLv90,
      secondary_stat: subName,
      secondary_stat_value: subValueLv1,
      max_secondary_stat_value: subValueLv90,
      passive_name_zh: ref1.name || '',
      passive_description_zh: passiveDesc,
      refinement: refinementStr,
      story_zh: '',  // 背景故事由第 7 步从 GitLab Readable 抓取填充
      description_zh: convertColorMarkup(detail.desc || ''),  // 武器简介
      images: {
        icon: iconName,              // 装备图标 UI_EquipIcon_*
        simple: gachaIconName,       // 武器大图 UI_Gacha_EquipIcon_*
        icon_url: iconName ? `https://static.nanoka.cc/assets/gi/${iconName}.webp` : '',
        simple_url: iconName ? `https://static.nanoka.cc/assets/gi/${gachaIconName}.webp` : '',
      },
      ascension_materials: [],
    };

    // 5. 解析突破材料
    if (detail.materials) {
      const matMap = new Map();
      for (const [, asc] of Object.entries(detail.materials)) {
        if (asc.mats) {
          for (const mat of asc.mats) {
            if (mat.id) {
              const existing = matMap.get(mat.id);
              const qty = mat.count || 1;
              if (existing) {
                existing.quantity = Math.max(existing.quantity, qty);
              } else {
                const itemInfo = items[mat.id] || {};
                const rarity = mat.rank || itemInfo.rank || 1;
                matMap.set(mat.id, {
                  material_id: mat.id,
                  material_name: mat.name || itemInfo.name || '',
                  material_name_en: itemInfo.name || '',  // 中文名兜底（不再单独加载 en 版以提速）
                  material_type: mapWeaponMatType(itemInfo, rarity),
                  rarity: rarity,
                  description: convertColorMarkup(itemInfo.desc || ''),
                  source: (itemInfo.source_list || []).join('；'),
                  image: itemInfo.icon || '',
                  quantity: qty,
                });
              }
            }
          }
        }
      }
      result.ascension_materials = [...matMap.values()];
    }

    // 6. 下载武器图片（后台异步，不阻塞结果返回）
    const imagesDir = dbDir ? getImagesDir(dbDir) : null;
    if (imagesDir && result.images.icon_url) {
      downloadImage(result.images.icon_url, iconName, 'webp').catch(() => {
        // nanoka 失败，尝试 lunaris 备用
        const lunarisUrl = `https://api.lunaris.moe/data/assets/weapongacha/${gachaIconName}.webp`;
        downloadImage(lunarisUrl, iconName, 'webp').catch(() => {});
      });
    }
    if (imagesDir && result.images.simple_url && result.images.simple_url !== result.images.icon_url) {
      downloadImage(result.images.simple_url, gachaIconName, 'webp').catch(() => {
        const lunarisUrl = `https://api.lunaris.moe/data/assets/weapongacha/${gachaIconName}.webp`;
        downloadImage(lunarisUrl, gachaIconName, 'webp').catch(() => {});
      });
    }

    // 7. 抓取背景故事（完整模式 + 非快速模式）
    if (crawlMode === 'full' && !fastMode && detail.story) {
      try {
        // 从 story 引用中提取故事文件名
        // 格式: { storyId: { zh: "ART/UI/Readable/CHS/Weapon11511", ... } }
        for (const [storyId, refs] of Object.entries(detail.story)) {
          const zhPath = refs.zh || '';
          const m = zhPath.match(/(Weapon\d+)/i);
          if (m) {
            const storyFile = m[1];
            const storyUrl = `https://gitlab.com/Dimbreath/AnimeGameData/-/raw/master/Readable/CHS/${storyFile}.txt`;
            const storyText = await fetchText(storyUrl);
            if (storyText && storyText.trim()) {
              result.story_zh = storyText.trim();
              break; // 只取第一个故事
            }
          }
        }
      } catch (e) {
        console.error('[crawl-weapon] story fetch failed:', e.message);
      }
    }

    return { success: true, data: result };
  } catch (e) {
    console.error('[crawl-weapon] error:', e);
    return { success: false, error: e.message };
  }
});

// ── 武器查漏：检查数据库中缺少的武器 ──
ipcMain.handle('check-missing-weapons', async () => {
  try {
    const list = await getWeaponList();
    const allIds = Object.keys(list).filter(id => {
      const info = list[id];
      // 排除非武器条目
      return info.rank >= 1;
    });

    // 构建 id → { zh, en } 名称映射，供查漏模式使用
    const names = {};
    for (const id of allIds) {
      const info = list[id];
      names[id] = { zh: info.zh || '', en: info.en || '' };
    }

    return { success: true, total: allIds.length, ids: allIds.map(Number), names };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ── 圣遗物列表（从 nanoka.cc 获取）──
let _cachedArtifactList = null;

async function getArtifactList() {
  if (_cachedArtifactList) return _cachedArtifactList;
  const version = await getDataVersion();
  _cachedArtifactList = await fetchJson(`https://static.nanoka.cc/gi/${version}/artifact.json`);
  console.log('[getArtifactList] loaded, count:', Object.keys(_cachedArtifactList).length);
  return _cachedArtifactList;
}

async function findArtifactId(name) {
  const list = await getArtifactList();
  // 精确匹配中文名（取 set 中第一个 affix 的 name.zh）
  for (const [id, info] of Object.entries(list)) {
    const firstAffix = Object.values(info.set || {})[0];
    const zhName = firstAffix?.name?.zh || '';
    if (zhName === name) {
      return { id: Number(id), info };
    }
  }
  // 模糊匹配
  for (const [id, info] of Object.entries(list)) {
    const firstAffix = Object.values(info.set || {})[0];
    const zhName = firstAffix?.name?.zh || '';
    if (zhName.includes(name)) {
      return { id: Number(id), info };
    }
  }
  return null;
}

// ── 圣遗物爬虫 ──
ipcMain.handle('crawl-artifact', async (_event, artifactName, options = {}) => {
  const { fastMode = false, crawlMode = 'full' } = options;
  try {
    // 1. 查找圣遗物ID
    let artifactId, info;
    const found = await findArtifactId(artifactName);
    if (found) {
      artifactId = found.id;
      info = found.info;
    } else if (options.artifactId) {
      const list = await getArtifactList();
      const item = list[String(options.artifactId)];
      if (item) {
        artifactId = Number(options.artifactId);
        info = item;
      } else {
        return { success: false, error: `未找到圣遗物: ${artifactName}` };
      }
    } else {
      return { success: false, error: `未找到圣遗物: ${artifactName}` };
    }

    // 2. 获取圣遗物详细信息
    const version = await getDataVersion();
    const detailUrl = `https://static.nanoka.cc/gi/${version}/zh/artifact/${artifactId}.json`;
    let detail = null;
    try {
      console.log('[crawl-artifact] trying:', detailUrl);
      detail = await fetchJson(detailUrl);
    } catch (e) {
      console.log('[crawl-artifact] failed:', detailUrl, e.message);
    }
    if (!detail) {
      return { success: false, error: `无法获取圣遗物 ${artifactId}（${artifactName}）的详情数据` };
    }

    // 3. 解析基础信息
    const maxRarity = detail.rank ? Math.max(...detail.rank) : 5;

    // 4. 解析套装效果（affix_id 末尾：0=2件套, 1=4件套）
    let twoPieceBonus = '';
    let fourPieceBonus = '';
    if (detail.affix) {
      for (const affix of detail.affix) {
        const lastDigit = String(affix.affix_id).slice(-1);
        if (lastDigit === '0') {
          twoPieceBonus = affix.desc || '';
        } else if (lastDigit === '1') {
          fourPieceBonus = affix.desc || '';
        }
      }
    }

    // 5. 解析部件信息
    // equip 映射：bracer=生之花(_4), necklace=死之羽(_2), shoes=时之沙(_5), ring=空之杯(_1), dress=理之冠(_3)
    const parts = detail.parts || {};
    const pieceMap = {
      flower:  parts.equip_bracer,
      plume:   parts.equip_necklace,
      sands:   parts.equip_shoes,
      goblet:  parts.equip_ring,
      circlet: parts.equip_dress,
    };

    const result = {
      id: artifactId,
      name_zh: '',
      name_en: '',
      max_rarity: maxRarity,
      description_zh: '',
      two_piece_bonus: twoPieceBonus,
      four_piece_bonus: fourPieceBonus,
      flower_name_zh: pieceMap.flower?.name || '',
      plume_name_zh: pieceMap.plume?.name || '',
      sands_name_zh: pieceMap.sands?.name || '',
      goblet_name_zh: pieceMap.goblet?.name || '',
      circlet_name_zh: pieceMap.circlet?.name || '',
      flower_description_zh: '',
      plume_description_zh: '',
      sands_description_zh: '',
      goblet_description_zh: '',
      circlet_description_zh: '',
      story_zh: '',
      flower_story_zh: '',
      plume_story_zh: '',
      sands_story_zh: '',
      goblet_story_zh: '',
      circlet_story_zh: '',
      image: '',
      flower_image: '',
      plume_image: '',
      sands_image: '',
      goblet_image: '',
      circlet_image: '',
    };

    // 从 affix 或 list 中取名称
    if (detail.affix && detail.affix.length > 0) {
      result.name_zh = detail.affix[0].name || '';
    }
    if (!result.name_zh) {
      const firstAffix = Object.values(info?.set || {})[0];
      result.name_zh = firstAffix?.name?.zh || artifactName;
    }
    const firstAffix = Object.values(info?.set || {})[0];
    result.name_en = firstAffix?.name?.en || '';

    // 部件描述（过滤占位文本）
    for (const key of ['flower', 'plume', 'sands', 'goblet', 'circlet']) {
      const part = pieceMap[key];
      if (part?.desc && part.desc !== '烟绯专用') {
        result[`${key}_description_zh`] = part.desc;
      }
    }

    // 6. 处理图片
    const iconMap = {
      flower:  pieceMap.flower?.icon,
      plume:   pieceMap.plume?.icon,
      sands:   pieceMap.sands?.icon,
      goblet:  pieceMap.goblet?.icon,
      circlet: pieceMap.circlet?.icon,
    };
    for (const [key, iconName] of Object.entries(iconMap)) {
      if (iconName) {
        const imgFile = `${iconName}.webp`;
        result[`${key}_image`] = imgFile;
        if (key === 'flower') result.image = imgFile;
      }
    }
    // 如果没有生之花图片，套装图片回退到理之冠
    if (!result.image && result.circlet_image) {
      result.image = result.circlet_image;
    }

    // 后台下载图片
    const imagesDir = dbDir ? getImagesDir(dbDir) : null;
    if (imagesDir) {
      for (const iconName of Object.values(iconMap)) {
        if (iconName) {
          const imgUrl = `https://static.nanoka.cc/assets/gi/${iconName}.webp`;
          downloadImage(imgUrl, iconName, 'webp').catch(() => {});
        }
      }
    }

    // 7. 抓取部件故事（完整模式 + 非快速模式，并行拉取，10 秒超时）
    if (crawlMode === 'full' && !fastMode) {
      const storyFetches = [];
      for (const key of ['flower', 'plume', 'sands', 'goblet', 'circlet']) {
        const part = pieceMap[key];
        if (!part?.story) continue;
        for (const [, refs] of Object.entries(part.story)) {
          const zhPath = refs.zh || '';
          const m = zhPath.match(/(Relic\d+_\d+)/i);
          if (m) {
            const storyFile = m[1];
            const storyUrl = `https://gitlab.com/Dimbreath/AnimeGameData/-/raw/master/Readable/CHS/${storyFile}.txt`;
            storyFetches.push(
              fetchText(storyUrl)
                .then(text => {
                  if (text && text.trim()) {
                    result[`${key}_story_zh`] = text.trim();
                  }
                })
                .catch(e => {
                  console.error(`[crawl-artifact] story fetch failed for ${key} (${storyFile}):`, e.message);
                })
            );
          }
        }
      }
      // 并行等待，但最多 10 秒 — 超时的故事静默跳过
      if (storyFetches.length > 0) {
        const timeout = new Promise(resolve => setTimeout(resolve, 10000));
        await Promise.race([Promise.all(storyFetches), timeout]);
        const done = storyFetches.filter(f => f.isResolved !== false).length;
        console.log(`[crawl-artifact] fetched ${done}/${storyFetches.length} piece stories`);
      }
    }

    return { success: true, data: result };
  } catch (e) {
    console.error('[crawl-artifact] error:', e);
    return { success: false, error: e.message };
  }
});

// ── 圣遗物查漏：检查数据库中缺少的圣遗物 ──
ipcMain.handle('check-missing-artifacts', async () => {
  try {
    const list = await getArtifactList();
    const allIds = Object.keys(list).filter(id => {
      const info = list[id];
      return info.rank && info.rank.length > 0;
    });

    const names = {};
    for (const id of allIds) {
      const info = list[id];
      const firstAffix = Object.values(info.set || {})[0];
      names[id] = { zh: firstAffix?.name?.zh || '', en: firstAffix?.name?.en || '' };
    }

    return { success: true, total: allIds.length, ids: allIds.map(Number), names };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// 清理爬虫窗口（批量爬取结束后调用）
ipcMain.handle('cleanup-scrape-window', async () => {
  destroyScrapeWindow();
  return { success: true };
});

// ═════════════════════════════════════════════════════════════════
// 希穆兰卡 · 卡池数据装配层
// ─────────────────────────────────────────────────────────────────
// 职责：把数据库里的角色/武器/祈愿板块数据，装配成祈愿模拟引擎所需的花名册与卡池定义。
//   - 花名册（roster）：角色表、武器表、常驻五/四/三星池、三星武器池
//   - 卡池定义（poolDef）：由「祈愿」板块的历史卡池导入，或由用户手工编排
// 纯函数部分（toSimItem / deriveStandard4Weapons / wishDetailToPools /
// normalizeImportedPools）不触碰数据库，可直接在 node 下单测。
// ═════════════════════════════════════════════════════════════════

import {
  POOL_LABEL, STANDARD_5STAR_CHARS, STANDARD_5STAR_WEAPONS,
  itemKey, normalizePoolDef, POOL_IDS,
} from './wishSimulator.js'

/** 武器表中排除的分类（装扮皮肤、TPS 类武器均不参与祈愿） */
const EXCLUDED_WEAPON_CATEGORIES = ['武器装扮', 'TPS']

// ── 常驻四星武器兜底名单（实测 18 件：单手剑4 + 双手剑4 + 长柄2 + 法器4 + 弓4）──
// 推导规则见 deriveStandard4Weapons：四星武器若反复出现在「神铸赋形」的四星 UP 位上，
// 说明它属于常驻四星武器池（限定/纪行四星武器只会短期出现）。数据不足时回退到此名单。
export const FALLBACK_STANDARD_4WEAPONS = [
  '笛剑', '匣里龙吟', '祭礼剑', '西风剑',
  '钟剑', '雨裁', '祭礼大剑', '西风大剑',
  '匣里灭辰', '西风长枪',
  '昭心', '流浪乐章', '西风秘典', '祭礼残章',
  '弓藏', '绝弦', '祭礼弓', '西风猎弓',
]

// ═════════════════════════════════════════════════════════════════
// 一、纯函数：行 → 物品对象
// ═════════════════════════════════════════════════════════════════

/**
 * 把角色/武器行装配成模拟器物品对象
 * @param {object} row 数据库行
 * @param {'character'|'weapon'} type
 */
export function toSimItem(row, type) {
  if (!row) return null
  if (type === 'character') {
    return {
      type: 'character',
      id: Number(row.id),
      name: row.name_zh,
      rarity: Number(row.rarity) || 4,
      art: row.card_art || row.splash_art || null,
      splash: row.splash_art || row.card_art || null,
      element: row.element || null,
      weaponType: row.weapon_type || null,
      key: itemKey('character', Number(row.id)),
    }
  }
  return {
    type: 'weapon',
    id: Number(row.id),
    name: row.name_zh,
    rarity: Number(row.rarity) || 4,
    art: row.simple_art || row.image || null,
    splash: row.image || row.simple_art || null,
    weaponType: row.weapon_type || null,
    key: itemKey('weapon', Number(row.id)),
  }
}

/**
 * 推导常驻四星武器池。
 * 规则：按武器类别分组，取「出现次数 ≥ 该类最大值 × 0.75 且 ≥ 10 次」的四星武器。
 * 依据：「神铸赋形」的四星 UP 位共 5 个、每类各一，长期反复出现的那批即常驻池成员；
 * 限定/纪行四星武器只会短期出现若干次（数据实测分界清晰）。
 * @param {{id:number, weapon_type_id:number, c:number}[]} rows
 * @param {{id:number, name_zh:string}[]} weapons 全量四星武器
 * @returns {number[]} 武器 id 列表
 */
export function deriveStandard4Weapons(rows, weapons) {
  const byId = new Map((weapons || []).map(w => [Number(w.id), w]))
  const byType = new Map()
  for (const r of rows || []) {
    const t = Number(r.weapon_type_id) || 0
    if (!byType.has(t)) byType.set(t, [])
    byType.get(t).push({ id: Number(r.id), c: Number(r.c) || 0 })
  }
  const out = []
  for (const list of byType.values()) {
    const max = Math.max(...list.map(x => x.c), 0)
    const threshold = Math.max(10, Math.ceil(max * 0.75))
    for (const x of list) {
      if (x.c >= threshold && byId.has(x.id)) out.push(x.id)
    }
  }
  // 分界不清晰（数据太少）时回退到兜底名单
  if (out.length < 10) {
    return (weapons || []).filter(w => FALLBACK_STANDARD_4WEAPONS.includes(w.name_zh)).map(w => Number(w.id))
  }
  return out.sort((a, b) => a - b)
}

/**
 * 三个角色池/武器池/集录池的「空定义」
 */
export function emptyPoolConfig() {
  return {
    character1: { kind: 'character', bannerName: '', bannerImage: null, up5: [], up4: [] },
    character2: { kind: 'character', bannerName: '', bannerImage: null, up5: [], up4: [] },
    weapon: { kind: 'weapon', bannerName: '神铸赋形', bannerImage: null, up5: [], up4: [] },
    chronicled: { kind: 'chronicled', bannerName: '溯光祈愿', bannerImage: null, pool5: [], pool4: [] },
    standard: { kind: 'standard', bannerName: '奔行世间', bannerImage: null },
  }
}

// ═════════════════════════════════════════════════════════════════
// 二、祈愿板块 → 卡池定义
// ═════════════════════════════════════════════════════════════════

/**
 * 把一次「祈愿」导入结果映射为卡池配置。
 * 依据数据库结构：一条 wishes 记录 = 一期的池组，下挂 1~2 个 wish_banners，
 * 每个 banner 下挂 wish_banner_items（item_type ∈ character/weapon，rarity ∈ 4/5）。
 *
 * @param {{wish:object, banners:object[], items:object[]}} detail
 * @param {{charMap:Map, weaponMap:Map}} roster
 * @returns {{character1?:object, character2?:object, weapon?:object, chronicled?:object, standard?:object}}
 */
export function wishDetailToPools(detail, roster) {
  const { wish, banners = [], items = [] } = detail || {}
  if (!wish) return {}
  const charMap = roster?.charMap || new Map()
  const weaponMap = roster?.weaponMap || new Map()
  const resolve = (it) => {
    const src = it.item_type === 'character' ? charMap.get(Number(it.item_id)) : weaponMap.get(Number(it.item_id))
    return src ? { ...src, rarity: Number(it.rarity) || src.rarity } : null
  }
  const byBanner = new Map()
  for (const it of items) {
    if (!byBanner.has(it.banner_id)) byBanner.set(it.banner_id, [])
    byBanner.get(it.banner_id).push(it)
  }
  for (const list of byBanner.values()) {
    list.sort((a, b) => (Number(b.rarity) - Number(a.rarity)) || (a.sort_order - b.sort_order) || (a.id - b.id))
  }

  const out = {}
  const bannerImageOf = (b) => {
    try {
      const raw = typeof b.banner_image === 'string' ? JSON.parse(b.banner_image) : b.banner_image
      return Array.isArray(raw) ? raw.filter(Boolean) : (raw ? [raw] : [])
    } catch { return [] }
  }

  if (wish.banner_type === 'character-event') {
    const sorted = [...banners].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.id - b.id)
    sorted.slice(0, 2).forEach((b, i) => {
      const list = byBanner.get(b.id) || []
      const up5 = list.filter(x => Number(x.rarity) === 5).map(resolve).filter(Boolean)
      const up4 = list.filter(x => Number(x.rarity) === 4).map(resolve).filter(Boolean)
      out[i === 0 ? 'character1' : 'character2'] = {
        kind: 'character',
        bannerName: b.name_zh || up5[0]?.name || POOL_LABEL.character1,
        bannerImage: bannerImageOf(b)[0] || null,
        bannerImages: bannerImageOf(b),
        up5, up4,
      }
    })
  } else if (wish.banner_type === 'weapon-event') {
    const b = banners[0]
    const list = byBanner.get(b?.id) || []
    out.weapon = {
      kind: 'weapon',
      bannerName: b?.name_zh || '神铸赋形',
      bannerImage: b ? (bannerImageOf(b)[0] || null) : null,
      bannerImages: b ? bannerImageOf(b) : [],
      up5: list.filter(x => Number(x.rarity) === 5).map(resolve).filter(Boolean),
      up4: list.filter(x => Number(x.rarity) === 4).map(resolve).filter(Boolean),
    }
  } else if (wish.banner_type === 'chronicled') {
    const b = banners[0]
    const list = byBanner.get(b?.id) || []
    out.chronicled = {
      kind: 'chronicled',
      bannerName: b?.name_zh || '溯光祈愿',
      bannerImage: b ? (bannerImageOf(b)[0] || null) : null,
      bannerImages: b ? bannerImageOf(b) : [],
      pool5: list.filter(x => Number(x.rarity) === 5).map(resolve).filter(Boolean),
      pool4: list.filter(x => Number(x.rarity) === 4).map(resolve).filter(Boolean),
    }
  } else if (wish.banner_type === 'standard') {
    const b = banners[0]
    out.standard = {
      kind: 'standard',
      bannerName: b?.name_zh || '奔行世间',
      bannerImage: b ? (bannerImageOf(b)[0] || null) : null,
      bannerImages: b ? bannerImageOf(b) : [],
    }
  }
  return out
}

// ═════════════════════════════════════════════════════════════════
// 三、数据库装配（需要 query）
// ═════════════════════════════════════════════════════════════════

const Q_CHARACTERS = `
  SELECT c.id, c.name_zh, c.rarity, c.card_art, c.splash_art, c.release_date,
         e.name_zh AS element, wt.name_zh AS weapon_type
  FROM characters c
  LEFT JOIN elements e ON c.element_id = e.id
  LEFT JOIN weapon_types wt ON c.weapon_type_id = wt.id`

const Q_WEAPONS = `
  SELECT w.id, w.name_zh, w.rarity, w.image, w.simple_art, w.weapon_type_id, w.category,
         wt.name_zh AS weapon_type
  FROM weapons w
  LEFT JOIN weapon_types wt ON w.weapon_type_id = wt.id`

const Q_STANDARD_ITEMS = `
  SELECT wbi.item_type, wbi.item_id, wbi.rarity
  FROM wish_banner_items wbi
  JOIN wish_banners wb ON wbi.banner_id = wb.id
  JOIN wishes wi ON wb.wish_id = wi.id
  WHERE wi.banner_type = 'standard'`

const Q_BANNER_IMAGES = `
  SELECT wi.banner_type, wb.banner_image, wi.version, wi.phase, wb.sort_order
  FROM wish_banners wb
  JOIN wishes wi ON wb.wish_id = wi.id
  WHERE wb.banner_image IS NOT NULL AND wb.banner_image != '' AND wb.banner_image != 'null'`

const Q_WEAPON_EVENT_4STAR_COUNTS = `
  SELECT wbi.item_id AS id, w.weapon_type_id, COUNT(*) AS c
  FROM wish_banner_items wbi
  JOIN wish_banners wb ON wbi.banner_id = wb.id
  JOIN wishes wi ON wb.wish_id = wi.id
  JOIN weapons w ON wbi.item_id = w.id
  WHERE wi.banner_type = 'weapon-event' AND wbi.item_type = 'weapon' AND wbi.rarity = 4
  GROUP BY wbi.item_id, w.weapon_type_id`

/**
 * 读取并装配模拟器花名册。
 * @param {(sql:string, params?:any[]) => Promise<{data:any[]}>} query
 * @returns {Promise<object>} roster
 */
export async function loadSimRoster(query) {
  const [cRes, wRes, sRes, fRes, bRes] = await Promise.all([
    query(Q_CHARACTERS),
    query(Q_WEAPONS),
    query(Q_STANDARD_ITEMS),
    query(Q_WEAPON_EVENT_4STAR_COUNTS),
    query(Q_BANNER_IMAGES),
  ])
  const charRows = cRes?.data || []
  const weaponRows = (wRes?.data || []).filter(w => !EXCLUDED_WEAPON_CATEGORIES.includes(w.category))

  const charMap = new Map()
  for (const r of charRows) {
    const it = toSimItem(r, 'character')
    if (it && it.name) charMap.set(it.id, it)
  }
  const weaponMap = new Map()
  for (const r of weaponRows) {
    const it = toSimItem(r, 'weapon')
    if (it && it.name) weaponMap.set(it.id, it)
  }

  // ── 常驻五星：以「常驻祈愿」卡池表为准，缺失时按名字回退 ──
  const std5Chars = [], std5Weapons = []
  for (const it of (sRes?.data || [])) {
    const src = it.item_type === 'character' ? charMap.get(Number(it.item_id)) : weaponMap.get(Number(it.item_id))
    if (!src || Number(it.rarity) !== 5) continue
    if (it.item_type === 'character') std5Chars.push(src); else std5Weapons.push(src)
  }
  if (std5Chars.length === 0) {
    for (const n of STANDARD_5STAR_CHARS) {
      const it = [...charMap.values()].find(c => c.name === n)
      if (it) std5Chars.push(it)
    }
  }
  if (std5Weapons.length === 0) {
    for (const n of STANDARD_5STAR_WEAPONS) {
      const it = [...weaponMap.values()].find(w => w.name === n)
      if (it) std5Weapons.push(it)
    }
  }

  // ── 常驻四星角色：全部已实装四星角色（发布日有效即视为已进常驻池）──
  const std4Chars = charRows
    .filter(r => Number(r.rarity) === 4 && r.release_date && r.release_date !== '1970-01-01')
    .map(r => charMap.get(Number(r.id)))
    .filter(Boolean)

  // ── 常驻四星武器：由神铸赋形四星 UP 位频次推导 ──
  const weaponRows4 = weaponRows.filter(w => Number(w.rarity) === 4)
  const std4WeaponIds = new Set(deriveStandard4Weapons(fRes?.data || [], weaponRows4))
  const std4Weapons = weaponRows4.filter(w => std4WeaponIds.has(Number(w.id))).map(w => weaponMap.get(Number(w.id))).filter(Boolean)

  // ── 三星武器：全池共用 ──
  const weapons3 = weaponRows.filter(w => Number(w.rarity) === 3).map(w => weaponMap.get(Number(w.id))).filter(Boolean)

  // ── 各类型「最新一期有卡池图」的图片：用于侧栏缩略图兜底 ──
  // 老存档（在默认配置载入常驻卡池之前创建）以及未爬取卡池图的新期数，
  // 都能据此回落到一张可用的官方卡池图。
  const defaultBannerImages = buildDefaultBannerImages(bRes?.data || [])

  return {
    charMap, weaponMap, defaultBannerImages,
    characters: [...charMap.values()],
    weapons: [...weaponMap.values()],
    std5: [...std5Chars, ...std5Weapons],
    std4: [...std4Chars, ...std4Weapons],
    std5Chars, std5Weapons, std4Chars, std4Weapons, weapons3,
    counts: {
      chars5: std5Chars.length, weapons5: std5Weapons.length,
      chars4: std4Chars.length, weapons4: std4Weapons.length,
      weapons3: weapons3.length,
    },
  }
}

/**
 * 按卡池类型汇总「最新一期」的官方卡池图（多图时全部保留，顺序按 sort_order）。
 * @param {{banner_type:string, banner_image:string, version:string, phase:number, sort_order:number}[]} rows
 * @returns {Record<string, string[]>} 形如 { standard: ['Gacha_Standard_01.png', ...], ... }
 */
export function buildDefaultBannerImages(rows) {
  const vnum = (v) => {
    const p = String(v || '').split('.').map(n => parseInt(n, 10))
    return (Number.isFinite(p[0]) ? p[0] : 0) * 1000 + (Number.isFinite(p[1]) ? p[1] : 0)
  }
  const best = new Map()   // banner_type → { score, list }
  for (const r of rows || []) {
    let list = []
    try {
      const raw = typeof r.banner_image === 'string' ? JSON.parse(r.banner_image) : r.banner_image
      list = Array.isArray(raw) ? raw.filter(Boolean) : (raw ? [raw] : [])
    } catch { list = r.banner_image ? [String(r.banner_image)] : [] }
    if (!list.length) continue
    const score = vnum(r.version) * 10 + (Number(r.phase) || 0)
    const cur = best.get(r.banner_type)
    if (!cur || score > cur.score) best.set(r.banner_type, { score, list: [] })
    const slot = best.get(r.banner_type)
    if (score === slot.score) {
      const idx = Number(r.sort_order) || 0
      slot.list[idx] = list[0]
    }
  }
  const out = {}
  for (const [k, v] of best) out[k] = v.list.filter(Boolean)
  return out
}

/** 卡池 id → 兜底卡池图类型 */
const FALLBACK_TYPE = {
  character1: 'character-event',
  character2: 'character-event',
  weapon: 'weapon-event',
  chronicled: 'chronicled',
  standard: 'standard',
}

/**
 * 装配运行时卡池定义（roster + 用户配置 → normalizePoolDef 产物）
 * @param {object} config 存档中的 pools 配置
 * @param {object} roster loadSimRoster 产物
 */
export function buildPoolDefs(config, roster) {
  const cfg = config || {}
  const rosterRefs = { std5: roster?.std5 || [], std4: roster?.std4 || [], weapons3: roster?.weapons3 || [] }
  const out = {}
  for (const id of POOL_IDS) {
    const raw = cfg[id]
    if (!raw) { out[id] = null; continue }
    if (id === 'character2' && raw.enabled === false) { out[id] = null; continue }
    const def = normalizePoolDef(id, raw, rosterRefs)
    // 缩略图兜底：存档未带卡池图（旧存档 / 新期数尚未爬图）时回落到该类型最新一期的官方卡池图
    if (!def.bannerImages || def.bannerImages.length === 0) {
      const fb = roster?.defaultBannerImages?.[FALLBACK_TYPE[id]] || []
      if (fb.length) {
        // 角色活动祈愿-2 优先取同期第二张
        const list = id === 'character2' && fb.length > 1 ? [fb[1], ...fb.slice(0, 1)] : fb
        def.bannerImages = list
        def.bannerImage = list[0]
      }
    }
    out[id] = def
  }
  return out
}

// ═════════════════════════════════════════════════════════════════
// 四、祈愿板块浏览（导入历史卡池用）
// ═════════════════════════════════════════════════════════════════

export const IMPORT_BANNER_TYPES = {
  'character-event': '角色活动祈愿',
  'weapon-event': '武器活动祈愿',
  'chronicled': '集录祈愿',
  'standard': '常驻祈愿',
}

/** 列出可导入的历史卡池（按版本号数值倒序，同版本按期数倒序） */
/** 解析 banner_image 列（可能是 JSON 数组或裸字符串） */
function parseBannerImages(raw) {
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw
    return Array.isArray(v) ? v.filter(Boolean) : (v ? [String(v)] : [])
  } catch { return raw ? [String(raw)] : [] }
}

export async function listImportableWishes(query) {
  const res = await query(
    `SELECT w.id, w.version, w.phase, w.banner_type, w.name_zh, w.start_date, w.end_date,
            (SELECT COUNT(*) FROM wish_banners b WHERE b.wish_id = w.id) AS banner_count,
            (SELECT b2.banner_image FROM wish_banners b2 WHERE b2.wish_id = w.id
              ORDER BY b2.sort_order, b2.id LIMIT 1) AS banner_image
     FROM wishes w`
  )
  const rows = (res?.data || []).map(r => ({
    ...r,
    // 画廊视图用：每期取第一张官方卡池图作封面
    cover: parseBannerImages(r.banner_image)[0] || null,
  }))
  const vnum = (v) => {
    const p = String(v || '').split('.').map(n => parseInt(n, 10))
    return (Number.isFinite(p[0]) ? p[0] : 0) * 1000 + (Number.isFinite(p[1]) ? p[1] : 0)
  }
  return rows.sort((a, b) =>
    (vnum(b.version) - vnum(a.version)) ||
    ((b.phase || 0) - (a.phase || 0)) ||
    (b.id - a.id)
  )
}

/**
 * 把历史卡池按「版本 + 期数」聚合成时段。
 * 一个时段里可能同时有角色活动祈愿（1~2 池）、武器活动祈愿、集录祈愿、常驻祈愿，
 * 一次性导入即可把这期开放的池全部安排上；该期没有的类型就不安排。
 */
export function groupWishesByPeriod(rows) {
  const map = new Map()
  for (const w of rows || []) {
    const key = `${w.version}#${w.phase}`
    if (!map.has(key)) {
      map.set(key, { key, version: w.version, phase: w.phase, wishes: [], types: [], covers: [] })
    }
    const g = map.get(key)
    g.wishes.push(w)
    if (!g.types.includes(w.banner_type)) g.types.push(w.banner_type)
    if (w.cover) g.covers.push(w.cover)
  }
  for (const g of map.values()) {
    // 展示顺序固定为 角色 → 武器 → 集录 → 常驻
    g.types.sort((a, b) => ORDERED_TYPES.indexOf(a) - ORDERED_TYPES.indexOf(b))
    g.label = g.types.map(t => IMPORT_BANNER_TYPES[t]).filter(Boolean).join(' · ')
  }
  return [...map.values()]
}

const ORDERED_TYPES = ['character-event', 'weapon-event', 'chronicled', 'standard']

/** 载入一次祈愿的完整明细（banners + items） */
export async function loadWishDetail(query, wishId, roster) {
  const wRes = await query('SELECT * FROM wishes WHERE id = ?', [wishId])
  const wish = wRes?.data?.[0]
  if (!wish) return null
  const bRes = await query('SELECT * FROM wish_banners WHERE wish_id = ? ORDER BY sort_order, id', [wishId])
  const banners = bRes?.data || []
  let items = []
  if (banners.length) {
    const ph = banners.map(() => '?').join(',')
    const iRes = await query(
      `SELECT * FROM wish_banner_items WHERE banner_id IN (${ph}) ORDER BY rarity DESC, sort_order, id`,
      banners.map(b => b.id)
    )
    items = iRes?.data || []
  }
  return { wish, banners, items, pools: wishDetailToPools({ wish, banners, items }, roster) }
}

// ═════════════════════════════════════════════════════════════════
// 五、垫池导入（祈愿捕捉站）
// ═════════════════════════════════════════════════════════════════

/** 捕捉站祈愿类型 → 模拟器池 id */
export const GACHA_TYPE_TO_POOL = { 301: 'character1', 400: 'character2', 302: 'weapon', 500: 'chronicled' }

/**
 * 把捕捉站的历史记录换算为模拟器起始状态。
 * 返回 { pity, records }：pity 供存档初始化，records 供「把真实历史灌进抽卡记录」。
 *
 * 说明：捕捉站的 gacha_type 语义与模拟器池一一对应；301/400 共享保底，故合并后
 * 统一写入 character 保底组（角色活动祈愿与角色活动祈愿-2 共享计数）。
 *
 * @param {Record<number, object[]>} itemsByType gacha_type → gacha_items 行
 * @param {object} roster
 */
export function pityFromGachaArchive(itemsByType, roster) {
  const charNames5 = new Set((roster?.std5Chars || []).map(i => i.name))
  const weaponNames5 = new Set((roster?.std5Weapons || []).map(i => i.name))
  const byName = new Map()
  for (const it of [...(roster?.characters || []), ...(roster?.weapons || [])]) byName.set(it.name, it)

  const sortAsc = (a, b) => String(a.time).localeCompare(String(b.time)) || String(a.id).localeCompare(String(b.id), undefined, { numeric: true })

  const analyze5 = (list, stdNames, hard) => {
    const n = list.length
    let p5 = n, lastIsStd = false, crStreak = 0
    for (let i = n - 1; i >= 0; i--) {
      if (Number(list[i].rank_type) === 5) { p5 = n - 1 - i; lastIsStd = stdNames.has(list[i].name); break }
    }
    let p4 = n
    for (let i = n - 1; i >= 0; i--) {
      if (Number(list[i].rank_type) >= 4) { p4 = n - 1 - i; break }
    }
    if (!lastIsStd && n > 0) {
      const seq = []
      for (let i = n - 1; i >= 0; i--) if (Number(list[i].rank_type) === 5) seq.push(list[i].name)
      // 与 wishAnalysis.computePityFromArchive 同一口径：大保底必然形成「常驻 → UP」交替，按 2 步进配对
      for (let i = 0; i + 1 < seq.length; i += 2) {
        if (stdNames.has(seq[i])) break
        if (!stdNames.has(seq[i + 1])) break
        crStreak++
        if (crStreak >= 3) break
      }
    }
    return {
      p5: Math.min(p5, hard - 1),
      p4: Math.min(p4, 9),
      guaranteed: lastIsStd ? 1 : 0,
      crStreak: lastIsStd ? 0 : crStreak,
    }
  }

  // 角色池：301 与 400 按时间合并
  const charList = [...(itemsByType[301] || []), ...(itemsByType[400] || [])].sort(sortAsc)
  const weaponList = [...(itemsByType[302] || [])].sort(sortAsc)
  const chronoList = [...(itemsByType[500] || [])].sort(sortAsc)

  const character = analyze5(charList, charNames5, 90)
  const weapon = analyze5(weaponList, weaponNames5, 80)
  const chrono = analyze5(chronoList, new Set(), 90)
  const standardList = [...(itemsByType[200] || [])].sort(sortAsc)
  const standard = analyze5(standardList, new Set(), 90)

  // ── 真实历史 → 模拟器记录（用于「把历史一并灌进记录列表」）──
  const records = []
  let seq = 0
  const mapList = (list, poolId) => {
    let p5 = 0, p4 = 0
    for (const g of list) {
      p5 += 1; p4 += 1
      const rank = Number(g.rank_type) || 3
      const it = byName.get(g.name)
      seq += 1
      records.push({
        seq,
        pool: poolId,
        poolKind: poolId === 'character2' ? 'character' : poolId,
        poolLabel: POOL_LABEL[poolId],
        itemType: it?.type || (g.item_type === '武器' ? 'weapon' : 'character'),
        itemId: it?.id ?? null,
        name: g.name,
        rarity: rank,
        art: it?.art || null,
        splash: it?.splash || null,
        element: it?.element || null,
        weaponType: it?.weaponType || null,
        isUp: false,
        before: { p5: p5 - 1, p4: p4 - 1, guaranteed: null, crStreak: null, fate: null, gu4: null },
        pity5: rank === 5 ? p5 : null,
        pity4: rank === 4 ? p4 : null,
        guaranteeUsed: false,
        crTriggered: false,
        glitter: 0, stardust: 0, constellation: 0, crown: 0, copyIndex: 1,
        imported: true,
        time: String(g.time || '').replace(' ', 'T'),
      })
      if (rank === 5) { p5 = 0; p4 = 0 }
      else if (rank === 4) { p4 = 0 }
    }
  }
  mapList(charList.filter(g => Number(g.gacha_type) === 301), 'character1')
  mapList(charList.filter(g => Number(g.gacha_type) === 400), 'character2')
  mapList(weaponList, 'weapon')
  mapList(chronoList, 'chronicled')
  mapList(standardList, 'standard')
  records.sort((a, b) => String(a.time).localeCompare(String(b.time)) || a.seq - b.seq)
  records.forEach((r, i) => { r.seq = i + 1 })

  return {
    pity: { character: { ...character, kind: 'character' }, weapon: { ...weapon, kind: 'weapon', fate: 0 }, chronicled: { ...chrono, kind: 'chronicled', fate: 0 }, standard: { ...standard, kind: 'standard' } },
    records,
    counts: {
      character: charList.length, weapon: weaponList.length,
      chronicled: chronoList.length, standard: standardList.length,
    },
  }
}

// ═════════════════════════════════════════════════════════════════
// 存档瘦身：模拟前（导入）记录的压缩存储与还原
// ─────────────────────────────────────────────────────────────────
// 起因：从祈愿捕捉站导入的历史动辄四五千条，而 pityFromGachaArchive 产的记录有 25 个
// 字段、单条 ~520 B，整包 2.7 MB —— 却几乎全是常量（isUp/glitter/copyIndex… 恒为
// false/0/1）、恒为 null 的审计块（before），或可由 itemId + roster 现推的冗余
// （art/splash/element/weaponType/poolKind/poolLabel）。模拟本身的进度却只有几十 KB。
//
// 处理：仅在落库时把「导入」记录压成 8 个真正必要的字段，读档时用 roster 还原成
// 与内存中完全一致的结构 —— 渲染层无需改动，旧存档（未瘦身）也照常读。
// ═════════════════════════════════════════════════════════════════

/** 内存中的导入记录 → 落库用的精简形态 */
export function slimArchiveRecords(records) {
  if (!Array.isArray(records)) return []
  return records.map(r => {
    // 模拟中产生的记录含副产物、保底变更等真实数据，保持原样
    if (!r || r.imported !== true) return r
    return {
      seq: r.seq,
      pool: r.pool,
      itemId: r.itemId,
      name: r.name,
      rarity: r.rarity,
      pity5: r.pity5 ?? null,
      pity4: r.pity4 ?? null,
      time: r.time,
    }
  })
}

/**
 * 落库的精简形态 → 内存中完整的记录对象。
 * @param {object[]} records 存档里的记录
 * @param {object} roster loadSimRoster 产物（用于按 itemId 找回图片/元素等）
 */
export function rehydrateArchiveRecords(records, roster) {
  if (!Array.isArray(records)) return []
  const byId = new Map()
  for (const it of [...(roster?.characters || []), ...(roster?.weapons || [])]) {
    if (it && it.id != null) byId.set(it.id, it)
  }
  let seq = 0
  return records.map(r => {
    if (!r) return r
    // 已是完整记录（模拟中产生，或旧版存档里的导入记录）：补齐可能缺的常量字段即可
    const isSlim = r.itemId !== undefined && r.itemType === undefined
    if (!isSlim) return r
    seq += 1
    const it = r.itemId != null ? byId.get(r.itemId) : null
    const pool = r.pool || 'character1'
    const itemType = it?.type || (pool === 'weapon' ? 'weapon' : 'character')
    return {
      seq: r.seq ?? seq,
      pool,
      poolKind: pool === 'character2' ? 'character' : pool,
      poolLabel: POOL_LABEL[pool] || pool,
      itemType,
      itemId: r.itemId ?? null,
      name: r.name,
      rarity: r.rarity || 3,
      art: it?.art || null,
      splash: it?.splash || null,
      element: it?.element || null,
      weaponType: it?.weaponType || null,
      isUp: false,
      before: { p5: null, p4: null, guaranteed: null, crStreak: null, fate: null, gu4: null },
      pity5: r.pity5 ?? null,
      pity4: r.pity4 ?? null,
      guaranteeUsed: false,
      crTriggered: false,
      glitter: 0, stardust: 0, constellation: 0, crown: 0, copyIndex: 1,
      imported: true,
      time: r.time,
    }
  })
}

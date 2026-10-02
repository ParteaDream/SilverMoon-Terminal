/**
 * weaponCrawlSave.js — 武器爬取结果 → 数据库字段的映射规则
 *
 * 从 DevToolbar 里抽出来单独放，是因为这段"哪些字段该写、哪些不能写"的判断
 * 曾经出过问题（name_zh 从来不写、0 值覆盖真实数值、占位英文名写进库里），
 * 抽成纯函数才能被单测覆盖（scripts/test-weapon-crawl-names.mjs）。
 */

// 与 electron/weapon-names.cjs 保持一致：nanoka 未本地化时会先给 "Weapon: Sword" 之类的占位名
const PLACEHOLDER_NAME_RE = /^(weapon|item|artifact|relic|material|monster|character|skill|talent|namecard|food|gadget|quest|tps)\s*:\s*/i

export function isPlaceholderName(name) {
  return !name || PLACEHOLDER_NAME_RE.test(String(name).trim())
}

/**
 * 构造 weapons 表的 UPDATE 字段列表。
 *
 * @param {object} data 爬虫返回的 data
 * @param {object} ctx
 * @param {number|string} ctx.weaponId 数据库中的武器 ID
 * @param {Set<string>|Array<string>} [ctx.takenNames] 已被**其它**武器占用的 name_zh
 * @returns {{fields: string[], values: any[], skipped: string[]}}
 */
export function buildWeaponUpdate(data, ctx = {}) {
  const fields = []
  const values = []
  const skipped = []
  const weaponId = ctx.weaponId
  const taken = ctx.takenNames instanceof Set ? ctx.takenNames : new Set(ctx.takenNames || [])

  // ── 名称 ──
  // 中文名：name_zh 有 UNIQUE 约束，撞名时保留本地名（例如"星锋剑（旅行者专用幻化）"
  // 这类人工消歧名），否则以线上为准
  if (data.name_zh) {
    const targetName = String(data.name_zh)
    if (taken.has(targetName)) skipped.push(`name_zh（"${targetName}" 已被其它武器占用）`)
    else { fields.push('name_zh = ?'); values.push(targetName) }
  }
  // 英文名：空值/占位值一律不写，避免把 "Weapon: Sword" 这种半成品写进库
  if (data.name_en && !isPlaceholderName(data.name_en)) {
    fields.push('name_en = ?'); values.push(data.name_en)
  } else if (data.name_en) {
    skipped.push(`name_en（占位名 "${data.name_en}"）`)
  }

  if (data.rarity) { fields.push('rarity = ?'); values.push(data.rarity) }
  if (data.weapon_type) { fields.push('weapon_type_id = ?'); values.push(data.weapon_type) }
  // 武器装扮 / TPS 武器在 nanoka 没有数值（返回 0/空），不能拿 0 覆盖库里的值
  if (data.base_atk > 0) { fields.push('base_atk = ?'); values.push(data.base_atk) }
  else if (data.base_atk != null) skipped.push('base_atk（爬取值为 0）')
  if (data.max_base_atk > 0) { fields.push('max_base_atk = ?'); values.push(data.max_base_atk) }
  if (data.secondary_stat) { fields.push('secondary_stat = ?'); values.push(data.secondary_stat) }
  if (data.secondary_stat && data.secondary_stat_value != null) {
    fields.push('secondary_stat_value = ?'); values.push(data.secondary_stat_value)
  }
  if (data.secondary_stat && data.max_secondary_stat_value != null) {
    fields.push('max_secondary_stat_value = ?'); values.push(data.max_secondary_stat_value)
  }
  if (data.passive_name_zh) { fields.push('passive_name_zh = ?'); values.push(data.passive_name_zh) }
  if (data.passive_description_zh) { fields.push('passive_description_zh = ?'); values.push(data.passive_description_zh) }
  if (data.refinement) { fields.push('refinement = ?'); values.push(data.refinement) }
  if (data.story_zh) { fields.push('story_zh = ?'); values.push(data.story_zh) }
  if (data.description_zh) { fields.push('description_zh = ?'); values.push(data.description_zh) }

  // nanoka 返回的 ID 与数据库 ID 不同时同步（详情页/关联表都按 ID 引用）
  if (data.id && String(data.id) !== String(weaponId)) {
    fields.push('id = ?'); values.push(data.id)
  }

  // 图片（DB 中 image = 武器大图/gacha，simple_art = 装备小图标）
  if (data.images) {
    if (data.images.simple) { fields.push('image = ?'); values.push(`${data.images.simple}.webp`) }
    if (data.images.icon) { fields.push('simple_art = ?'); values.push(`${data.images.icon}.webp`) }
  }

  return { fields, values, skipped }
}

/** 爬取结果里 nanoka 侧的武器 ID（用于 ID 变更后的关联表迁移） */
export function effectiveWeaponId(data, weaponId) {
  return data.id && String(data.id) !== String(weaponId) ? data.id : weaponId
}

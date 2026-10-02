/**
 * foodCrawlSave.mjs — 食物爬取结果 → 数据库的落库规则
 *
 * 与 weaponCrawlSave.mjs 同样的理由抽成独立模块：这里集中了「哪些字段该写、
 * 哪些不能覆盖」的判断，出过问题的地方（占位英文名、空值覆盖、ID 冲突、
 * wiki 拿不到材料时误清空已有烹饪材料）都在这里挡住。
 *
 * 数据源：
 *  - nanoka 静态数据（名称/图片/稀有度/简介/效果/来源）→ 主进程 crawl-food
 *  - bilibili wiki「所需食材」→ 主进程补充成 data.materials
 *
 * 约定的 data 结构（见 electron/main.js buildFoodPayload）：
 *  {
 *    id, db_id, name_zh, name_en, rarity, type, category, region,
 *    description_zh, effect, source, image, has_variants,
 *    recipe_source, recipe_price, special_char, specialty, wiki_title,
 *    variants: [{ kind: 'normal'|'tasty'|'weird', item_id, name_zh, name_en,
 *                 description_zh, effect, image, rarity }],
 *    materials: [{ material_id, material_name, material_name_en, material_type,
 *                  rarity, description, source, icon, quantity }],
 *    missing_ingredients: string[],
 *  }
 */

/** 三种形态的展示/写入顺序：奇怪 → 普通 → 美味（与页面上的切换器一致） */
export const FOOD_VARIANT_KINDS = ['weird', 'normal', 'tasty']

export const FOOD_VARIANT_LABELS = {
  weird: '奇怪的',
  normal: '普通',
  tasty: '美味的',
}

// nanoka 未本地化时会先给 "Food: xxx" 之类的占位名
const PLACEHOLDER_NAME_RE = /^(weapon|item|artifact|relic|material|monster|character|skill|talent|namecard|food|gadget|quest|tps)\s*:\s*/i

const IMAGE_EXT_RE = /\.(png|webp|jpe?g|gif|bmp|svg|avif)$/i

/** 去掉扩展名，拿到图标名（图包里的文件以图标名为基准名） */
export function imageBaseName(value) {
  return String(value || '').trim().replace(IMAGE_EXT_RE, '')
}

/**
 * 把载荷里的图片名替换成**实际落盘的文件名**。
 *
 * nanoka 的素材是 webp，下载后按内容嗅探存成 `.webp`；爬虫载荷里的
 * `UI_ItemIcon_108102.png` 只是调用方按老约定拼的提示名，直接写库就会
 * 出现「库里记 .png、盘上是 .webp」的错配（能靠 basename 匹配显示出来，
 * 但数据是错的）。imageNames 来自 download-food-images 的返回。
 */
export function applyImageNames(data, imageNames) {
  if (!data || !imageNames) return data
  const map = (v) => {
    if (!v) return v
    const hit = imageNames[imageBaseName(v)]
    return hit || v
  }
  return {
    ...data,
    image: map(data.image),
    variants: Array.isArray(data.variants) ? data.variants.map(v => ({ ...v, image: map(v.image) })) : data.variants,
    materials: Array.isArray(data.materials) ? data.materials.map(m => ({ ...m, image: map(m.image) })) : data.materials,
  }
}

export function isPlaceholderName(name) {
  return !name || PLACEHOLDER_NAME_RE.test(String(name).trim())
}

/**
 * 构造 foods 表的 UPDATE 字段列表。
 *
 * 注意：**不改主键**。foods.id 是详情页路由与 food_variants/food_materials 的
 * 外键锚点，爬虫返回的 nanoka ID 只在「新建条目」时采用；已存在的条目一律原地更新，
 * 避免一次改名就把用户的关联与链接全部打断。
 *
 * @param {object} data 爬虫返回的 data
 * @param {object} ctx
 * @param {Set<string>|string[]} [ctx.takenNames] 已被**其它**食物占用的 name_zh
 * @returns {{fields: string[], values: any[], skipped: string[]}}
 */
export function buildFoodUpdate(data, ctx = {}) {
  const fields = []
  const values = []
  const skipped = []
  const taken = ctx.takenNames instanceof Set ? ctx.takenNames : new Set(ctx.takenNames || [])

  if (data.name_zh && !isPlaceholderName(data.name_zh)) {
    const target = String(data.name_zh).trim()
    if (taken.has(target)) skipped.push(`name_zh（"${target}" 已被其它食物占用）`)
    else { fields.push('name_zh = ?'); values.push(target) }
  } else if (data.name_zh) {
    skipped.push(`name_zh（占位名 "${data.name_zh}"）`)
  }

  if (data.name_en && !isPlaceholderName(data.name_en)) {
    fields.push('name_en = ?'); values.push(data.name_en)
  } else if (data.name_en) {
    skipped.push(`name_en（占位名 "${data.name_en}"）`)
  }

  if (data.rarity) { fields.push('rarity = ?'); values.push(data.rarity) }
  if (data.type) { fields.push('type = ?'); values.push(data.type) }
  if (data.category) { fields.push('category = ?'); values.push(data.category) }
  if (data.region) { fields.push('region = ?'); values.push(data.region) }

  // 空字符串不能覆盖库里已有的文案（wiki/nanoka 偶发缺字段）
  for (const [key, col] of [
    ['description_zh', 'description_zh'],
    ['effect', 'effect'],
    ['source', 'source'],
    ['image', 'image'],
    ['recipe_source', 'recipe_source'],
    ['recipe_price', 'recipe_price'],
    ['special_char', 'special_char'],
    ['specialty', 'specialty'],
    ['wiki_title', 'wiki_title'],
  ]) {
    const v = data[key]
    if (v != null && String(v).trim() !== '') { fields.push(`${col} = ?`); values.push(v) }
  }

  if (data.has_variants != null) { fields.push('has_variants = ?'); values.push(data.has_variants ? 1 : 0) }

  return { fields, values, skipped }
}

/** 匹配「同一个材料」用的归一化键（忽略空白与全半角括号差异） */
function normalizeMaterialName(name) {
  return String(name || '').trim().replace(/\s+/g, '').replace(/[（(]/g, '(').replace(/[）)]/g, ')')
}

/** 引用了 materials.id 的全部关联表（材料改主键时要一起迁移） */
export const MATERIAL_LINK_TABLES = [
  'character_ascension_materials',
  'character_talent_materials',
  'weapon_ascension_materials',
  'food_materials',
]

/**
 * 材料主表 upsert —— 与 DevToolbar.upsertMaterialAndLink 同一套规则：
 * 先按 name_zh 找同名材料。同名但 ID 不同时以 **nanoka 的权威 ID** 为准：
 * 关掉外键 → 迁移全部关联表 → 改写 materials 主键 → 恢复外键（失败则退回旧 ID）。
 * 不存在则按爬取 ID 新建。
 *
 * @returns {Promise<number|null>} 材料表主键
 */
export async function upsertMaterialRow(query, m) {
  const name = String(m.material_name || '').trim()
  if (!name) return null
  const rawImage = String(m.image || '')
  // 载荷里的 image 可能是「完整文件名」也可能是「图标名」，两种都要能落库
  const imgFile = rawImage ? (IMAGE_EXT_RE.test(rawImage) ? rawImage : `${rawImage}.png`) : ''
  const inboundId = Number(m.material_id) || null

  const byName = await query('SELECT id FROM materials WHERE name_zh = ?', [name])
  const existing = byName.data && byName.data[0]

  if (existing) {
    const oldId = existing.id
    if (inboundId && Number(oldId) !== Number(inboundId)) {
      try {
        await query('PRAGMA foreign_keys = OFF')
        for (const table of MATERIAL_LINK_TABLES) {
          await query(`UPDATE ${table} SET material_id = ? WHERE material_id = ?`, [inboundId, oldId])
        }
        await query(
          `UPDATE materials SET id = ?, name_en = COALESCE(NULLIF(?, ''), name_en), type = COALESCE(NULLIF(?, ''), type),
             rarity = ?, description_zh = COALESCE(NULLIF(?, ''), description_zh),
             source = COALESCE(NULLIF(?, ''), source), image = COALESCE(NULLIF(?, ''), image)
           WHERE id = ?`,
          [inboundId, m.material_name_en || '', m.material_type || '', m.rarity || 1, m.description || '', m.source || '', imgFile, oldId]
        )
        await query('PRAGMA foreign_keys = ON')
        return inboundId
      } catch (e) {
        try { await query('PRAGMA foreign_keys = ON') } catch (_) {}
        console.warn('[food-crawler] 材料改 ID 失败，沿用原 ID:', name, e.message)
        return oldId
      }
    }
    await query(
      `UPDATE materials SET name_en = COALESCE(NULLIF(?, ''), name_en), type = COALESCE(NULLIF(?, ''), type),
         rarity = ?, description_zh = COALESCE(NULLIF(?, ''), description_zh),
         source = COALESCE(NULLIF(?, ''), source), image = COALESCE(NULLIF(?, ''), image)
       WHERE id = ?`,
      [m.material_name_en || '', m.material_type || '', m.rarity || 1, m.description || '', m.source || '', imgFile, oldId]
    )
    return oldId
  }

  if (!inboundId) return null
  const byId = await query('SELECT name_zh FROM materials WHERE id = ?', [inboundId])
  if (byId.data && byId.data.length > 0) {
    // 目标 ID 被别的材料占着：不抢主键，按名称新建一条
    await query(
      `INSERT OR IGNORE INTO materials (name_zh, name_en, type, rarity, description_zh, source, image)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [name, m.material_name_en || '', m.material_type || 'cooking', m.rarity || 1, m.description || '', m.source || '', imgFile]
    )
    const again = await query('SELECT id FROM materials WHERE name_zh = ?', [name])
    return again.data && again.data[0] ? again.data[0].id : null
  }

  await query(
    `INSERT OR IGNORE INTO materials (id, name_zh, name_en, type, rarity, description_zh, source, image)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [inboundId, name, m.material_name_en || '', m.material_type || 'cooking', m.rarity || 1, m.description || '', m.source || '', imgFile]
  )
  return inboundId
}

/**
 * 把一次食物爬取结果写进数据库。
 *
 * @param {(sql: string, params?: any[]) => Promise<any>} query useDb().query
 * @param {object} data 主进程 crawl-food / crawl-foods 返回的 data
 * @param {object} [opts]
 * @param {number|string|null} [opts.foodId] 数据库中的食物 ID（更新时传入；为空表示新建）
 * @param {Set<string>|string[]} [opts.takenNames] 其它食物已占用的名称
 * @param {boolean} [opts.replaceMaterials=true] 是否用爬取结果覆盖烹饪材料
 * @param {boolean} [opts.replaceVariants=true] 是否用爬取结果覆盖三形态
 * @param {Record<string,string>} [opts.imageNames] 图标名 → 实际落盘文件名（见 applyImageNames）
 * @returns {Promise<{foodId: number|null, created: boolean, skipped: string[], variantCount: number, materialCount: number}>}
 */
export async function saveFoodData(query, rawData, opts = {}) {
  if (!rawData) throw new Error('爬取结果为空')
  const { replaceMaterials = true, replaceVariants = true } = opts
  // 先按实际落盘文件名改写图片字段，后面所有写入都用改写后的数据
  const data = applyImageNames(rawData, opts.imageNames)
  const { fields, values, skipped } = buildFoodUpdate(data, { takenNames: opts.takenNames })

  const targetId = Number(data.id) || null
  let foodId = opts.foodId != null && opts.foodId !== '' ? Number(opts.foodId) : null
  let created = false

  if (foodId == null) {
    // 新建：按爬取的 nanoka ID 落库（已被占用时退化为自增）
    const dup = await query('SELECT id FROM foods WHERE id = ?', [targetId])
    if (dup.data && dup.data.length > 0) foodId = dup.data[0].id
    else {
      await query(
        `INSERT INTO foods (id, name_zh, name_en, rarity, type, category, region, description_zh, effect,
           source, image, has_variants, recipe_source, recipe_price, special_char, specialty, wiki_title)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          targetId, data.name_zh || '', data.name_en || '', data.rarity || 1, data.type || 'dish',
          data.category || '', data.region || '', data.description_zh || '', data.effect || '',
          data.source || '', data.image || '', data.has_variants ? 1 : 0,
          data.recipe_source || '', data.recipe_price || '', data.special_char || '',
          data.specialty || '', data.wiki_title || '',
        ]
      )
      foodId = targetId
      created = true
    }
  } else {
    // 已存在：原地更新（不动主键），并沿用 INSERT 里没有覆盖到的字段
    const exists = await query('SELECT id FROM foods WHERE id = ?', [foodId])
    if (!exists.data || exists.data.length === 0) {
      // 记录被删掉了，退化为新建
      return saveFoodData(query, data, { ...opts, foodId: null })
    }
  }

  if (fields.length > 0) {
    await query(`UPDATE foods SET ${fields.join(', ')} WHERE id = ?`, [...values, foodId])
  }

  // ── 三形态 ──
  let variantCount = 0
  const variants = Array.isArray(data.variants) ? data.variants.filter(v => v && v.kind) : []
  if (replaceVariants && variants.length > 0) {
    await query('DELETE FROM food_variants WHERE food_id = ?', [foodId])
    for (const v of variants) {
      await query(
        `INSERT OR REPLACE INTO food_variants (food_id, kind, item_id, name_zh, name_en, description_zh, effect, image, rarity)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [foodId, v.kind, v.item_id || null, v.name_zh || '', v.name_en || '', v.description_zh || '', v.effect || '', v.image || '', v.rarity ?? null]
      )
      variantCount++
    }
  }

  // ── 烹饪材料 ──
  // wiki 拿不到材料时（约 8% 的条目）**不清空**已有数据，避免把人工补录的内容抹掉
  let materialCount = 0
  const materials = Array.isArray(data.materials) ? data.materials : []
  if (replaceMaterials && materials.length > 0) {
    const kept = []
    for (const m of materials) {
      const matId = await upsertMaterialRow(query, m)
      if (matId == null) continue
      kept.push(Number(matId))
      await query(
        'INSERT OR REPLACE INTO food_materials (food_id, material_id, quantity) VALUES (?, ?, ?)',
        [foodId, matId, m.quantity != null ? String(m.quantity) : '']
      )
      materialCount++
    }
    if (kept.length > 0) {
      await query(
        `DELETE FROM food_materials WHERE food_id = ? AND material_id NOT IN (${kept.map(() => '?').join(',')})`,
        [foodId, ...kept]
      )
    }
  }

  if (skipped.length > 0) console.log(`[food-crawler] 食物 ${data.name_zh || foodId} 跳过字段: ${skipped.join('；')}`)
  if (data.missing_ingredients && data.missing_ingredients.length > 0) {
    console.warn(`[food-crawler] ${data.name_zh || foodId} 未匹配到材料: ${data.missing_ingredients.join('、')}`)
  }

  return { foodId, created, skipped, variantCount, materialCount }
}

/** 爬取结果里需要落盘的图标名（食物本体 + 每个形态 + 烹饪材料），供批量下载去重 */
export function collectFoodIcons(data) {
  const icons = []
  const push = (v) => { if (v) icons.push(imageBaseName(v)) }
  push(data.image)
  for (const v of data.variants || []) push(v.image)
  for (const m of data.materials || []) push(m.icon || m.image)
  return [...new Set(icons.filter(Boolean))]
}

/** 归一化后的材料名（导出给查漏逻辑做比对） */
export { normalizeMaterialName }

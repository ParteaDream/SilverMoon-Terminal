/**
 * dishLinks.js — 角色「特殊料理」 ↔ 食物板块条目 的双向关联
 *
 * 数据里没有外键，靠字段对齐（种子数据实测：有特殊料理的 121 个角色全部命中）：
 *   1) foods.name_zh = characters.dish_name
 *      —— 最直接的信号：角色身上记的就是这道菜的名字
 *   2) foods.type = 'special' AND foods.special_char = characters.name_zh
 *      —— 料理名被改过时的兜底（special_char 是「特殊料理对应角色」）
 *
 * ⚠️ 顺序不能反过来：special_char 在基础菜上也会填（含义是"某角色的特殊料理
 * 由这道菜变化而来"），比如早柚名下有 饭团(dish) 和 头晕回避术・改(ingredient)，
 * 只按 special_char 优先会跳到饭团去 —— 那不是她的特殊料理。
 *
 * 同一份字段还表达了第二层关系：**每道特殊料理都是某道基础菜（料理原型）的衍生版**。
 * 方向恰好与上面相反 —— 记在基础菜身上的 special_char 才是「这道菜能变成谁的
 * 特殊料理」，于是：
 *   · 特殊料理 → 原型：foods.special_char = 角色名 AND type <> 'special'
 *   · 原型 → 衍生特殊料理：foods.special_char = 角色名 AND type = 'special'
 * 两边都以角色名为锚点，不需要额外字段（实测 121 条关联里 116 条可直接命中，
 * 余下 5 条是基础菜侧 special_char 尚未回填的历史数据，查漏补缺会列出来）。
 *
 * 少数条目类型/字段不规范，统一在这里兜住：
 *   · 早柚「头晕回避术・改」type 是 ingredient、special_char 为空 —— 按
 *     characters.dish_name 反查角色，照样能找回原型「饭团」。
 *   · 薇斯纳「霜冻冰花汤」special_char 为空、基础菜「雪国冷汤」也没有对应的
 *     special 条目 —— 反查角色后按 characters.dish_name 找衍生条目。
 *
 * 规则集中在这里，保证「角色页 → 食物页」与「食物页 → 角色页」用的是同一套判断，
 * 不会两边各写一份 SQL 之后慢慢跑偏；食物板块列表页的搜索（搜角色名要能搜出 TA 的
 * 特殊料理与它的原型）用的是文件末尾那套同样口径的纯函数版。
 *
 * 注意：双库模式下 dbQuery 的 WHERE 只作用于基准库（字段级增量在结果合并时才
 * 覆盖字段值），所以用户手改过的 special_char / dish_name 可能匹配不上 —— 这和
 * 站内其它 JOIN 查询是同一限制；匹配不上就退化成纯文本，不会报错。
 */

/** 关联跳转只需要这几列 */
const FOOD_LINK_COLUMNS = 'id, name_zh, type, rarity, image'
const CHARACTER_COLUMNS = 'id, name_zh, rarity'

/** 角色 → 该角色的特殊料理（食物板块条目）；找不到返回 null */
export async function findCharacterDish(query, { characterName, dishName }) {
  const name = String(characterName || '').trim()
  const dish = String(dishName || '').trim()
  if (!name && !dish) return null
  try {
    const res = await query(
      `SELECT ${FOOD_LINK_COLUMNS} FROM foods
        WHERE (special_char <> '' AND special_char = ?)
           OR (? <> '' AND name_zh = ?)
        ORDER BY (? <> '' AND name_zh = ?) DESC,
                 (special_char = ?) DESC,
                 (type = 'special') DESC,
                 id
        LIMIT 1`,
      [name, dish, dish, dish, dish, name]
    )
    return res?.data?.[0] || null
  } catch (e) {
    console.error('[dishLinks] 查找角色特殊料理失败:', e)
    return null
  }
}

/** 食物 → 该条目的对应角色；找不到（special_char 为空或对不上角色名）返回 null */
export async function findDishCharacter(query, specialChar) {
  const name = String(specialChar || '').trim()
  if (!name) return null
  try {
    const res = await query(`SELECT ${CHARACTER_COLUMNS} FROM characters WHERE name_zh = ? LIMIT 1`, [name])
    return res?.data?.[0] || null
  } catch (e) {
    console.error('[dishLinks] 查找特殊料理角色失败:', e)
    return null
  }
}

/**
 * 角色名反查：special_char 缺失时，看有哪个角色的特殊料理就叫这道菜。
 * （早柚「头晕回避术・改」、薇斯纳「霜冻冰花汤」走的就是这条路）
 */
async function findCharacterByDishName(query, dishName) {
  const dish = String(dishName || '').trim()
  if (!dish) return ''
  try {
    const res = await query('SELECT name_zh FROM characters WHERE dish_name = ? LIMIT 1', [dish])
    return String(res?.data?.[0]?.name_zh || '').trim()
  } catch (e) {
    console.error('[dishLinks] 按料理名反查角色失败:', e)
    return ''
  }
}

/**
 * 基础菜（料理原型）选取：同一角色名下可能有多道菜挂着 special_char，
 * 只有 type <> 'special' 的那道才是「特殊料理的原型」；优先正规料理，
 * 再按 id 稳定取第一条。excludeId 用来看住"别把自己当自己的原型"。
 */
async function selectPrototype(query, characterName, excludeId) {
  const name = String(characterName || '').trim()
  if (!name) return null
  try {
    const res = await query(
      `SELECT ${FOOD_LINK_COLUMNS} FROM foods
        WHERE special_char = ? AND type <> 'special' AND id <> ?
        ORDER BY (type = 'dish') DESC, id
        LIMIT 1`,
      [name, Number(excludeId) || -1]
    )
    return res?.data?.[0] || null
  } catch (e) {
    console.error('[dishLinks] 查找料理原型失败:', e)
    return null
  }
}

/**
 * 角色 → 其特殊料理的**料理原型**（基础菜）；找不到返回 null。
 * 角色页的「料理原型」入口用它 —— 只认 special_char 这一条线索，
 * 不依赖该角色的特殊料理条目长什么样。
 */
export async function findCharacterDishPrototype(query, { characterName, dishFoodId }) {
  return selectPrototype(query, characterName, dishFoodId)
}

/**
 * 特殊料理条目 → 它衍生的**料理原型**；找不到返回 null。
 *
 * 判定"这条是不是某人的特殊料理"：
 *   · type = 'special' → 取它自己的 special_char；为空时按菜名反查角色
 *   · 其它类型（早柚那种）→ 只按菜名反查角色，避免把基础菜自己当成特殊料理
 *
 * @param {{specialChar?:string, dishName?:string, type?:string, id?:number}} food
 */
export async function findDishPrototype(query, food = {}) {
  const id = Number(food.id) || -1
  const specialChar = String(food.specialChar || '').trim()
  const dishName = String(food.dishName || '').trim()
  if (!specialChar && !dishName) return null
  const isSpecialType = String(food.type || '') === 'special'
  const characterName = isSpecialType
    ? (specialChar || await findCharacterByDishName(query, dishName))
    : await findCharacterByDishName(query, dishName)
  if (!characterName) return null
  return selectPrototype(query, characterName, id)
}

/**
 * 基础菜 → 由它衍生的**特殊料理**条目（通常 1 条，返回数组便于兜住多形态角色）。
 * special 类型的条目缺失时，退回 characters.dish_name 找那道菜本身
 * （早柚「头晕回避术・改」、薇斯纳「霜冻冰花汤」都是这种"没标 special"的情况）。
 */
export async function findDishDerivatives(query, { specialChar, foodId } = {}) {
  const name = String(specialChar || '').trim()
  if (!name) return []
  const exclude = Number(foodId) || -1
  try {
    const res = await query(
      `SELECT ${FOOD_LINK_COLUMNS} FROM foods
        WHERE special_char = ? AND type = 'special' AND id <> ?
        ORDER BY id`,
      [name, exclude]
    )
    if (res?.data?.length > 0) return res.data
    // 该角色的特殊料理条目没有带 special_char：按 characters.dish_name 找回
    const ch = await query('SELECT dish_name FROM characters WHERE name_zh = ? LIMIT 1', [name])
    const dish = String(ch?.data?.[0]?.dish_name || '').trim()
    if (!dish) return []
    const fb = await query(
      `SELECT ${FOOD_LINK_COLUMNS} FROM foods WHERE name_zh = ? AND id <> ? LIMIT 1`,
      [dish, exclude]
    )
    return fb?.data || []
  } catch (e) {
    console.error('[dishLinks] 查找衍生特殊料理失败:', e)
    return []
  }
}

/**
 * 食物详情页一次拿全两个方向：{ prototype, derivatives }。
 * prototype 只对"某人的特殊料理"成立；derivatives 只对"有人拿它做特殊料理的
 * 基础菜"成立 —— 两边都为空时页面不渲染「料理关系」区块。
 */
export async function findDishRelations(query, food) {
  if (!food) return { prototype: null, derivatives: [] }
  const [prototype, derivatives] = await Promise.all([
    findDishPrototype(query, {
      specialChar: food.special_char,
      dishName: food.name_zh,
      type: food.type,
      id: food.id,
    }),
    // 特殊料理自己不会再衍生出特殊料理（special_char 在它身上记的是"属于谁"，
    // 不用来反查衍生条目）
    String(food.type || '') === 'special'
      ? Promise.resolve([])
      : findDishDerivatives(query, { specialChar: food.special_char, foodId: food.id }),
  ])
  return { prototype, derivatives }
}

// ═══════════════════════════════════════════════════════════════
// 列表页 / 搜索用的纯函数版：同样两条线索，但不查库，
// 把关联编成内存索引（食物板块的搜索栏靠它把「角色名」搜成
// 「他的特殊料理 + 那道菜的原型」）
// ═══════════════════════════════════════════════════════════════

/** 关联角色在这道菜身上的身份 */
export const DISH_CHAR_ROLE = {
  special: 'special',       // 这道菜是 TA 的特殊料理
  prototype: 'prototype',   // 这道菜是 TA 特殊料理的原型（基础菜）
}

/** 列表里优先展示的身份：先"是谁的特殊料理"，再"是谁的原型" */
export function primaryDishChar(links) {
  if (!Array.isArray(links) || links.length === 0) return null
  return links.find(l => l.role === DISH_CHAR_ROLE.special) || links[0]
}

/**
 * foodId → [{ name, role }]，role 见 DISH_CHAR_ROLE。与上面的 SQL 版一一对应：
 *   · characters.dish_name = 菜名 → 这道菜是「谁的特殊料理」
 *   · foods.special_char = 角色名 → special 类型记归属，其它类型记「谁的原型」
 * 两条线索都命中的条目（正常情况下就是同一道菜）只保留一条。
 */
export function buildFoodCharLinks(foods, characters) {
  const ownerByDish = new Map()
  for (const c of characters || []) {
    const name = String(c?.name_zh || '').trim()
    const dish = String(c?.dish_name || '').trim()
    if (name && dish && !ownerByDish.has(dish)) ownerByDish.set(dish, name)
  }
  const links = new Map()
  for (const f of foods || []) {
    const id = Number(f?.id)
    if (!Number.isFinite(id)) continue
    const list = []
    const push = (name, role) => {
      if (!name || list.some(l => l.name === name)) return
      list.push({ name, role })
    }
    const marked = String(f?.special_char || '').trim()
    if (marked) {
      push(marked, String(f?.type || '') === 'special' ? DISH_CHAR_ROLE.special : DISH_CHAR_ROLE.prototype)
    }
    push(ownerByDish.get(String(f?.name_zh || '').trim()), DISH_CHAR_ROLE.special)
    if (list.length > 0) links.set(id, list)
  }
  return links
}

/** 给列表行挂上 char_links（返回新数组，不改原对象）；列表页据此搜索与标注 */
export function attachFoodCharLinks(foods, characters) {
  const links = buildFoodCharLinks(foods, characters)
  return (foods || []).map(f => {
    const chars = links.get(Number(f?.id))
    return chars ? { ...f, char_links: chars } : f
  })
}

/**
 * 料理列表的搜索命中：名称 / 英文名 / 功效 / 效果，外加**关联角色名**
 * —— 搜「琴」要能同时搜出她的特殊料理「提神醒脑披萨」和它的原型「烤蘑菇披萨」。
 * 传进来的行需要先过 attachFoodCharLinks（没有 char_links 时退化成原来的字段匹配）。
 */
export function matchFoodSearch(food, query) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return true
  const hit = (v) => String(v ?? '').toLowerCase().includes(q)
  if (hit(food?.name_zh) || hit(food?.name_en) || hit(food?.category) || hit(food?.effect)) return true
  return (food?.char_links || []).some(l => hit(l.name))
}

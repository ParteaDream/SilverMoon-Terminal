/**
 * foodGaps.mjs — 食物「查漏补缺」的比对规则
 *
 * 输入：
 *   · online —— check-missing-foods 的返回 { ids: number[], names: { [id]: {zh,en,hasVariants} } }
 *   · dbRows —— 本地 foods 行 + variant_count / material_count（见 FoodsPage 的查询）
 *   · ctx    —— 选填，只有「缺料理原型」用得到：
 *       { characters: [{ name_zh, dish_name }], materials: [{ food_id, material_id, quantity }] }
 * 输出：分组后的缺口列表，直接喂给 FoodLeakCheckModal。
 *
 * 之所以放到 utils 而不是页面里：这几种缺口的口径（尤其"缺烹饪材料"对饮品/食材
 * 天然成立、"缺料理原型"只能靠配方反推候选）需要能在不改 UI 的情况下单独校对。
 */

export const FOOD_GAP_KEYS = {
  missing: 'missing',
  materials: 'materials',
  variants: 'variants',
  assets: 'assets',
  special: 'special',
}

/** 配方键：同一道菜（含特殊料理）的材料与用量，用于给"缺原型"的特殊料理找候选基础菜 */
function makeRecipeKey(materials) {
  const byFood = new Map()
  for (const m of materials || []) {
    const id = Number(m?.food_id)
    if (!Number.isFinite(id)) continue
    const list = byFood.get(id) || []
    list.push(`${m.material_id}:${m.quantity ?? ''}`)
    byFood.set(id, list)
  }
  return (foodId) => {
    const list = byFood.get(Number(foodId))
    return list && list.length > 0 ? [...list].sort().join('|') : ''
  }
}

/**
 * 缺料理原型：特殊料理都是从某道基础菜衍生来的，关联记在**基础菜**的
 * special_char 上；那条记录一旦为空，特殊料理就找不到自己的原型。
 *
 * 库里没有"哪个基础菜"的直接线索，用配方反推候选：同一道特殊料理与它的原型
 * 在游戏里是同一份食谱，所需食材完全一致（实测已知的 114 组关联全部吻合）。
 * 因此候选可能不止一个（蒙德烤鱼 / 烤吃虎鱼 同为"鱼肉+胡椒"），全部列出来
 * 让用户补爬 —— 爬谁由 wiki 上的「特殊料理角色」字段决定，多爬一条不会写错。
 */
function computeSpecialGaps(rows, characters, materials) {
  const recipeKey = makeRecipeKey(materials)

  // characters.dish_name 是"角色自己声称的特殊料理"，用来补 special_char 缺失的条目
  const charByDish = new Map()
  for (const c of characters || []) {
    const name = String(c?.name_zh || '').trim()
    const dish = String(c?.dish_name || '').trim()
    if (name && dish && !charByDish.has(dish)) charByDish.set(dish, name)
  }

  // 已经挂上原型的基础菜：记下它对应的角色
  const linked = new Set()
  for (const r of rows) {
    const ch = String(r.special_char || '').trim()
    if (ch && r.type !== 'special') linked.add(ch)
  }

  const items = []
  const byId = new Map()
  for (const row of rows) {
    if (row.type !== 'special') continue
    const ch = String(row.special_char || '').trim() || charByDish.get(String(row.name_zh || '').trim()) || ''
    if (!ch || linked.has(ch)) continue
    const key = recipeKey(row.id)
    if (!key) continue   // 连配方都没有，给不出候选，交给"缺烹饪材料"分组去暴露
    for (const cand of rows) {
      if (cand.type === 'special' || cand.id === row.id) continue
      if (recipeKey(cand.id) !== key) continue
      let item = byId.get(cand.id)
      if (!item) {
        item = { id: cand.id, name: cand.name_zh || `ID:${cand.id}`, causes: [] }
        byId.set(cand.id, item)
        items.push(item)
      }
      const cause = `「${ch}」的「${row.name_zh}」`
      if (!item.causes.includes(cause)) item.causes.push(cause)
    }
  }
  return items.map(({ id, name, causes }) => ({ id, name, reason: `${causes.join('、')}的原型候选` }))
}

/**
 * @param {{ids?: number[], names?: Record<string, {zh?:string,en?:string,hasVariants?:boolean}>}} online
 * @param {Array<{id:number,name_zh?:string,image?:string,description_zh?:string,variant_count?:number,material_count?:number,type?:string,special_char?:string}>} dbRows
 * @param {{characters?:Array<{name_zh?:string,dish_name?:string}>, materials?:Array<{food_id?:number,material_id?:number,quantity?:string|number}>}} [ctx]
 * @returns {Array<{key:string,label:string,hint:string,items:Array<{id:number,name:string,reason:string}>}>}
 */
export function computeFoodGaps(online, dbRows, ctx = {}) {
  const ids = Array.isArray(online?.ids) ? online.ids : []
  const names = (online && online.names) || {}
  const rows = dbRows || []
  const rowsById = new Map()
  for (const r of rows) rowsById.set(Number(r.id), r)

  const missing = []
  const noMaterials = []
  const shapeGaps = []
  const assetGaps = []

  for (const rawId of ids) {
    const id = Number(rawId)
    const meta = names[id] || names[String(id)] || {}
    const row = rowsById.get(id)

    if (!row) {
      missing.push({ id, name: meta.zh || `ID:${id}`, reason: '' })
      continue
    }

    const name = row.name_zh || meta.zh || `ID:${id}`

    // 「形态不全」只对线上确实有三形态的条目成立
    if (meta.hasVariants && Number(row.variant_count || 0) < 3) {
      shapeGaps.push({ id, name, reason: `${row.variant_count || 0}/3 形态` })
    }

    // 饮品 / 生食材 / 活动料理本来就没有烹饪配方，不算缺口
    const crafting = row.type !== 'ingredient' && row.type !== 'drink'
    if (crafting && Number(row.material_count || 0) === 0) {
      noMaterials.push({ id, name, reason: '无烹饪材料' })
    }

    if (!row.image || !row.description_zh) {
      assetGaps.push({ id, name, reason: !row.image ? '缺图片' : '缺简介' })
    }
  }

  // 「缺料理原型」看的是库内两表之间的关系，与线上目录无关
  const specialGaps = (ctx.characters || ctx.materials)
    ? computeSpecialGaps(rows, ctx.characters, ctx.materials)
    : []

  return [
    {
      key: FOOD_GAP_KEYS.missing,
      label: '未收录',
      hint: 'nanoka 上已有、本地数据库缺失的食物',
      items: missing,
    },
    {
      key: FOOD_GAP_KEYS.materials,
      label: '缺烹饪材料',
      hint: '没有关联到任何材料（wiki 无配方数据的条目可忽略）',
      items: noMaterials,
    },
    {
      key: FOOD_GAP_KEYS.variants,
      label: '形态不全',
      hint: '线上有「奇怪的 / 普通 / 美味的」三形态，本地不足三条',
      items: shapeGaps,
    },
    {
      key: FOOD_GAP_KEYS.special,
      label: '缺料理原型',
      hint: '特殊料理找不到对应的基础菜（基础菜的「特殊料理角色」为空）——补爬候选基础菜即可补上关联',
      items: specialGaps,
    },
    {
      key: FOOD_GAP_KEYS.assets,
      label: '缺图片或简介',
      hint: '图片或简介为空，通常是历史数据',
      items: assetGaps,
    },
  ].filter(g => g.items.length > 0)
}

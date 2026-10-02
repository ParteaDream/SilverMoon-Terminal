#!/usr/bin/env node
/**
 * 食物落库与查漏规则的单元测试（纯 Node，不起 Electron）
 *
 * foodCrawlSave.mjs / foodGaps.mjs 都是无依赖的纯模块，因此可以把 query 换成
 * 记录型假实现，直接断言「发出了哪些 SQL、跳过了哪些字段」。这些正是历史上
 * 出过问题的地方（占位名写库、空值覆盖、主键被改、wiki 无配方时清空材料）。
 *
 * Run: node scripts/test-food-save.mjs
 */
import { strict as assert } from 'node:assert'
import {
  buildFoodUpdate, saveFoodData, upsertMaterialRow, collectFoodIcons,
  applyImageNames, imageBaseName,
} from '../src/utils/foodCrawlSave.mjs'
import { computeFoodGaps } from '../src/utils/foodGaps.mjs'

let passed = 0
const failures = []
function test(name, fn) {
  try { fn(); passed++ } catch (e) { failures.push({ name, error: e.message }) }
}
async function testAsync(name, fn) {
  try { await fn(); passed++ } catch (e) { failures.push({ name, error: e.message }) }
}

// ── 记录型假 query ──
// routes：[[正则, 返回 {data:[...]} | 函数(params)]]，命中第一条
function makeQuery(routes = []) {
  const log = []
  const query = async (sql, params = []) => {
    log.push({ sql: sql.replace(/\s+/g, ' ').trim(), params })
    for (const [re, handler] of routes) {
      if (re.test(sql)) return typeof handler === 'function' ? handler(params) : handler
    }
    return { data: [] }
  }
  query.log = log
  query.sqls = () => log.map(l => l.sql)
  query.find = (re) => log.find(l => re.test(l.sql))
  return query
}

const baseData = {
  id: 108102, name_zh: '黄金蟹', name_en: 'Golden Crab', rarity: 4, type: 'dish',
  category: '提升防御、提升治疗效果', region: '璃月',
  description_zh: '古法烹制的蟹肉料理。', effect: '防御力提高261点。',
  source: '烹饪获得', image: 'UI_ItemIcon_108102.png', has_variants: 1,
  recipe_source: '莫娜传说任务获得', recipe_price: '', special_char: '', specialty: '',
  wiki_title: '黄金蟹',
  variants: [
    { kind: 'normal', item_id: 108102, name_zh: '黄金蟹', description_zh: '普通', effect: 'E1', image: 'UI_ItemIcon_108102.png', rarity: 4 },
    { kind: 'weird', item_id: 108101, name_zh: '奇怪的黄金蟹', description_zh: '奇怪', effect: 'E2', image: 'UI_ItemIcon_108102.png', rarity: 4 },
    { kind: 'tasty', item_id: 108103, name_zh: '美味的黄金蟹', description_zh: '美味', effect: 'E3', image: 'UI_ItemIcon_108102.png', rarity: 4 },
  ],
  // 与 electron/main.js buildFoodPayload 的真实形状一致：icon 是图标名，image 是提示文件名
  materials: [
    { material_id: 100062, material_name: '鸟蛋', material_name_en: 'Bird Egg', material_type: 'cooking', rarity: 1, description: 'd', source: 's', icon: 'UI_ItemIcon_100062', image: 'UI_ItemIcon_100062.png', quantity: '5' },
    { material_id: 100015, material_name: '盐', material_name_en: 'Salt', material_type: 'cooking', rarity: 1, description: 'd', source: 's', icon: 'UI_ItemIcon_100015', image: 'UI_ItemIcon_100015.png', quantity: '2' },
  ],
  missing_ingredients: [],
}

// ═══════════════════════════════════════════════════════════
test('buildFoodUpdate：占位英文名不写库', () => {
  const { fields, values, skipped } = buildFoodUpdate(
    { ...baseData, name_en: 'Food: Golden Crab' }, {})
  assert.ok(!fields.some(f => f.startsWith('name_en')), '占位 name_en 不应进入 UPDATE')
  assert.ok(skipped.some(s => s.includes('name_en')), '应记录跳过原因')
  assert.ok(values.length === fields.length)
})

test('buildFoodUpdate：空字符串不覆盖已有文案', () => {
  const { fields } = buildFoodUpdate(
    { ...baseData, description_zh: '', effect: '   ', source: '', image: '', recipe_source: '' }, {})
  for (const col of ['description_zh', 'effect', 'source', 'image', 'recipe_source']) {
    assert.ok(!fields.includes(`${col} = ?`), `${col} 不应被空值覆盖`)
  }
})

test('buildFoodUpdate：基础菜带回的特殊料理关联要写进库（料理原型的锚点）', () => {
  const { fields, values } = buildFoodUpdate({
    ...baseData, name_zh: '摩拉肉', special_char: '凝光', specialty: '乾坤摩拉肉',
  }, {})
  const at = (col) => values[fields.indexOf(`${col} = ?`)]
  assert.equal(at('special_char'), '凝光', '「特殊料理角色」是查原型的唯一锚点，非空时必须落库')
  assert.equal(at('specialty'), '乾坤摩拉肉')
  // wiki 缺这两个字段时不能反过来把已有值擦掉
  const { fields: empty } = buildFoodUpdate({ ...baseData, special_char: '', specialty: null }, {})
  assert.ok(!empty.includes('special_char = ?'))
  assert.ok(!empty.includes('specialty = ?'))
})

test('buildFoodUpdate：名称撞车时跳过 name_zh', () => {
  const { fields, skipped } = buildFoodUpdate(baseData, { takenNames: new Set(['黄金蟹']) })
  assert.ok(!fields.includes('name_zh = ?'))
  assert.ok(skipped.some(s => s.includes('已被其它食物占用')))
})

test('buildFoodUpdate：永不把主键写进 UPDATE', () => {
  const { fields } = buildFoodUpdate(baseData, {})
  assert.ok(!fields.includes('id = ?'), 'foods.id 是路由与关联的锚点，不能被爬虫改写')
})

// ═══════════════════════════════════════════════════════════
await testAsync('saveFoodData：更新已存在条目时不动主键，并覆盖三形态与材料', async () => {
  const q = makeQuery([
    [/^SELECT id FROM foods WHERE id = \?/, { data: [{ id: 108102 }] }],
    [/^SELECT id FROM materials WHERE name_zh = \?/, (p) => ({ data: p[0] === '鸟蛋' ? [{ id: 100062 }] : [{ id: 100015 }] })],
  ])
  const out = await saveFoodData(q, baseData, { foodId: 108102 })
  assert.equal(out.foodId, 108102)
  assert.equal(out.created, false)
  assert.equal(out.variantCount, 3)
  assert.equal(out.materialCount, 2)

  const update = q.find(/^UPDATE foods SET/)
  assert.ok(update, '应有 UPDATE foods')
  const setClause = update.sql.slice(0, update.sql.indexOf(' WHERE '))
  assert.ok(!/\bid = \?/.test(setClause), `SET 子句里不应出现主键：${setClause}`)
  assert.ok(/ WHERE id = \?$/.test(update.sql), 'WHERE 只按传入的 foodId 定位')
  assert.equal(update.params[update.params.length - 1], 108102, 'WHERE id = 传入的 foodId')

  assert.ok(q.find(/^DELETE FROM food_variants WHERE food_id = \?/), '应先清空形态再重建')
  const variantInserts = q.log.filter(l => /^INSERT OR REPLACE INTO food_variants/.test(l.sql))
  assert.equal(variantInserts.length, 3)
  const linkInserts = q.log.filter(l => /^INSERT OR REPLACE INTO food_materials/.test(l.sql))
  assert.equal(linkInserts.length, 2)
  // 数量要落成字符串，便于后续人工编辑
  assert.deepEqual(linkInserts.map(l => l.params[2]), ['5', '2'])
  // 旧材料关联要被清掉（覆盖语义）
  assert.ok(q.find(/^DELETE FROM food_materials WHERE food_id = \? AND material_id NOT IN/))
})

await testAsync('saveFoodData：新建条目采用爬取的 nanoka ID', async () => {
  const q = makeQuery([])
  const out = await saveFoodData(q, baseData, { foodId: null })
  assert.equal(out.foodId, 108102)
  assert.equal(out.created, true)
  const ins = q.find(/^INSERT INTO foods \(/)
  assert.ok(ins, '应插入 foods')
  assert.equal(ins.params[0], 108102)
  assert.equal(ins.params[1], '黄金蟹')
})

await testAsync('saveFoodData：wiki 无配方时不抹掉已有烹饪材料', async () => {
  const q = makeQuery([
    [/^SELECT id FROM foods WHERE id = \?/, { data: [{ id: 108151 }] }],
  ])
  const out = await saveFoodData(q, { ...baseData, id: 108151, name_zh: '苹果酿', materials: [] }, { foodId: 108151 })
  assert.equal(out.materialCount, 0)
  assert.ok(!q.find(/^DELETE FROM food_materials/), '材料为空时不得清空已有数据')
})

await testAsync('saveFoodData：记录被删后自动退化为新建', async () => {
  // foods 表里既没有 999999 也没有 108102 → 走 INSERT 新建
  const q = makeQuery([])
  const out = await saveFoodData(q, baseData, { foodId: 999999 })
  assert.equal(out.foodId, 108102)
  assert.ok(out.created, '找不到原记录时应新建')
  assert.ok(q.find(/^INSERT INTO foods \(/))
})

// ═══════════════════════════════════════════════════════════
await testAsync('upsertMaterialRow：同名不同 ID 时迁移全部关联表并改写主键', async () => {
  const q = makeQuery([
    [/^SELECT id FROM materials WHERE name_zh = \?/, { data: [{ id: 777 }] }],
  ])
  const id = await upsertMaterialRow(q, {
    material_id: 100062, material_name: '鸟蛋', material_type: 'cooking', rarity: 1, image: 'UI_ItemIcon_100062',
  })
  assert.equal(id, 100062)
  const cascades = q.log.filter(l => /^UPDATE (\w+) SET material_id = \? WHERE material_id = \?/.test(l.sql))
  assert.deepEqual(
    cascades.map(l => l.sql.split(' ')[1]).sort(),
    ['character_ascension_materials', 'character_talent_materials', 'food_materials', 'weapon_ascension_materials']
  )
  assert.ok(q.find(/PRAGMA foreign_keys = OFF/), '改主键前必须关外键')
  assert.ok(q.find(/PRAGMA foreign_keys = ON/), '改完必须恢复外键')
  assert.ok(q.find(/^UPDATE materials SET id = \?/))
})

await testAsync('upsertMaterialRow：目标 ID 被别的材料占用时按名称新建，不抢主键', async () => {
  const q = makeQuery([
    [/^SELECT id FROM materials WHERE name_zh = \?/, { data: [] }],
    [/^SELECT name_zh FROM materials WHERE id = \?/, { data: [{ name_zh: '别的材料' }] }],
  ])
  const id = await upsertMaterialRow(q, { material_id: 100062, material_name: '鸟蛋' })
  const insert = q.find(/^INSERT OR IGNORE INTO materials \(name_zh/)
  assert.ok(insert, '应退回按名称插入')
  assert.equal(insert.params[0], '鸟蛋')
  assert.equal(id, null, '重新查询也拿不到 ID 时返回 null')
})

// ═══════════════════════════════════════════════════════════
test('imageBaseName：剥掉任意图片扩展名', () => {
  assert.equal(imageBaseName('UI_ItemIcon_108102.png'), 'UI_ItemIcon_108102')
  assert.equal(imageBaseName('UI_ItemIcon_108102.webp'), 'UI_ItemIcon_108102')
  assert.equal(imageBaseName('UI_ItemIcon_108102'), 'UI_ItemIcon_108102')
  assert.equal(imageBaseName(''), '')
  assert.equal(imageBaseName(null), '')
})

test('applyImageNames：按实际落盘文件名改写食物/形态/材料的图片字段', () => {
  const out = applyImageNames({
    image: 'UI_ItemIcon_108102.png',
    variants: [{ image: 'UI_ItemIcon_108102.png' }, { image: 'UI_ItemIcon_108101.png' }],
    materials: [{ image: 'UI_ItemIcon_100062.png' }, { image: 'UI_ItemIcon_100015' }],
  }, {
    UI_ItemIcon_108102: 'UI_ItemIcon_108102.webp',
    UI_ItemIcon_100062: 'UI_ItemIcon_100062.webp',
  })
  assert.equal(out.image, 'UI_ItemIcon_108102.webp')
  assert.deepEqual(out.variants.map(v => v.image), ['UI_ItemIcon_108102.webp', 'UI_ItemIcon_108101.png'])
  assert.deepEqual(out.materials.map(m => m.image), ['UI_ItemIcon_100062.webp', 'UI_ItemIcon_100015'])
})

test('applyImageNames：没有映射时原样返回，不改动载荷', () => {
  const input = { image: 'a.png', variants: [{ image: 'b.png' }], materials: [] }
  assert.deepEqual(applyImageNames(input, null), input)
  assert.deepEqual(applyImageNames(input, {}), input)
})

await testAsync('saveFoodData：图片文件名按真实落盘格式写库', async () => {
  const q = makeQuery([
    [/^SELECT id FROM foods WHERE id = \?/, { data: [{ id: 108102 }] }],
    [/^SELECT id FROM materials WHERE name_zh = \?/, (p) => ({
      data: [{ id: p[0] === '鸟蛋' ? 100062 : 100015 }],
    })],
  ])
  await saveFoodData(q, baseData, {
    foodId: 108102,
    imageNames: {
      UI_ItemIcon_108102: 'UI_ItemIcon_108102.webp',
      UI_ItemIcon_100062: 'UI_ItemIcon_100062.webp',
    },
  })
  const foodUpdate = q.find(/^UPDATE foods SET/)
  assert.ok(foodUpdate.params.includes('UI_ItemIcon_108102.webp'), 'foods.image 应为 webp 文件名')
  const variantInserts = q.log.filter(l => /^INSERT OR REPLACE INTO food_variants/.test(l.sql))
  assert.ok(variantInserts.every(l => l.params[7] === 'UI_ItemIcon_108102.webp'), '三形态图片应同步改写')
  const matImage = q.log.find(l => /^UPDATE materials SET name_en/.test(l.sql) && l.params.includes('UI_ItemIcon_100062.webp'))
  assert.ok(matImage, '材料图片也应写成真实文件名')
})

// ═══════════════════════════════════════════════════════════
test('collectFoodIcons：食物 / 三形态 / 材料的图标去重', () => {
  const icons = collectFoodIcons({
    image: 'UI_ItemIcon_108102.png',
    variants: [
      { image: 'UI_ItemIcon_108102.png' },
      { image: 'UI_ItemIcon_108102.webp' },
    ],
    materials: [
      { icon: 'UI_ItemIcon_100062' },
      { image: 'UI_ItemIcon_100015.png' },
    ],
  })
  assert.deepEqual(icons.sort(), ['UI_ItemIcon_100015', 'UI_ItemIcon_100062', 'UI_ItemIcon_108102'])
})

// ═══════════════════════════════════════════════════════════
test('computeFoodGaps：四类缺口口径', () => {
  const online = {
    ids: [1, 2, 3, 4, 5],
    names: {
      1: { zh: '全新料理', hasVariants: true },
      2: { zh: '缺材料料理', hasVariants: true },
      3: { zh: '缺形态料理', hasVariants: true },
      4: { zh: '正常料理', hasVariants: false },
      5: { zh: '苹果酿', hasVariants: false },
    },
  }
  const dbRows = [
    { id: 2, name_zh: '缺材料料理', image: 'a.png', description_zh: 'x', variant_count: 3, material_count: 0, type: 'dish' },
    { id: 3, name_zh: '缺形态料理', image: 'b.png', description_zh: 'x', variant_count: 1, material_count: 3, type: 'dish' },
    { id: 4, name_zh: '正常料理', image: 'c.png', description_zh: 'x', variant_count: 1, material_count: 2, type: 'dish' },
    { id: 5, name_zh: '苹果酿', image: '', description_zh: '', variant_count: 1, material_count: 0, type: 'drink' },
  ]
  const groups = computeFoodGaps(online, dbRows)
  const byKey = Object.fromEntries(groups.map(g => [g.key, g.items]))

  assert.deepEqual(byKey.missing.map(i => i.id), [1], '未收录')
  assert.deepEqual(byKey.materials.map(i => i.id), [2], '饮品不应算作缺材料')
  assert.deepEqual(byKey.variants.map(i => i.id), [3], '线上有三形态而本地不足 3 条')
  assert.deepEqual(byKey.assets.map(i => i.id).sort(), [5], '缺图片或简介')
})

test('computeFoodGaps：数据齐全时返回空数组', () => {
  const online = { ids: [1], names: { 1: { zh: 'A', hasVariants: true } } }
  const dbRows = [{ id: 1, name_zh: 'A', image: 'a.png', description_zh: 'd', variant_count: 3, material_count: 4, type: 'dish' }]
  assert.deepEqual(computeFoodGaps(online, dbRows), [])
})

// ── 缺料理原型（库内关系，与线上目录无关） ──

const SPECIAL_ROWS = [
  { id: 10, name_zh: '摩拉肉', type: 'dish', image: 'a.png', description_zh: 'd', variant_count: 1, material_count: 2, special_char: '' },
  { id: 11, name_zh: '乾坤摩拉肉', type: 'special', image: 'b.png', description_zh: 'd', variant_count: 1, material_count: 2, special_char: '凝光' },
  { id: 20, name_zh: '蒙德烤鱼', type: 'dish', image: 'c.png', description_zh: 'd', variant_count: 1, material_count: 2, special_char: '' },
  { id: 21, name_zh: '烤吃虎鱼', type: 'dish', image: 'e.png', description_zh: 'd', variant_count: 1, material_count: 2, special_char: '' },
  { id: 22, name_zh: '绝对不是下酒菜', type: 'special', image: 'f.png', description_zh: 'd', variant_count: 1, material_count: 2, special_char: '迪奥娜' },
  { id: 23, name_zh: '绝境求生烤鱼', type: 'special', image: 'g.png', description_zh: 'd', variant_count: 1, material_count: 2, special_char: '刻晴' },
]
const SPECIAL_MATERIALS = [
  { food_id: 10, material_id: 100061, quantity: '1' }, { food_id: 10, material_id: 110001, quantity: '1' },
  { food_id: 11, material_id: 100061, quantity: '1' }, { food_id: 11, material_id: 110001, quantity: '1' },
  { food_id: 20, material_id: 100077, quantity: '1' }, { food_id: 20, material_id: 100084, quantity: '1' },
  { food_id: 21, material_id: 100077, quantity: '1' }, { food_id: 21, material_id: 100084, quantity: '1' },
  { food_id: 22, material_id: 100077, quantity: '1' }, { food_id: 22, material_id: 100084, quantity: '1' },
  { food_id: 23, material_id: 100077, quantity: '1' }, { food_id: 23, material_id: 100084, quantity: '1' },
]
const SPECIAL_CHARS = [
  { name_zh: '凝光', dish_name: '乾坤摩拉肉' },
  { name_zh: '迪奥娜', dish_name: '绝对不是下酒菜' },
  { name_zh: '刻晴', dish_name: '绝境求生烤鱼' },
]
const NO_ONLINE = { ids: [], names: {} }

test('computeFoodGaps：缺料理原型——配方一致的基础菜作为补爬候选', () => {
  const groups = computeFoodGaps(NO_ONLINE, SPECIAL_ROWS, { characters: SPECIAL_CHARS, materials: SPECIAL_MATERIALS })
  const special = groups.find(g => g.key === 'special')
  assert.ok(special, '应出现「缺料理原型」分组')
  assert.deepEqual(special.items.map(i => i.id), [10, 20, 21], '只列缺关联的特殊料理的候选基础菜')
  assert.match(special.items[0].reason, /凝光/, '原因里要写清是谁的特殊料理缺原型')
  assert.match(special.items[0].reason, /乾坤摩拉肉/)
  // 蒙德烤鱼 / 烤吃虎鱼 配方完全相同（鱼肉+胡椒）：两个候选都列出来
  assert.match(special.items[1].reason, /迪奥娜/)
  assert.match(special.items[2].reason, /刻晴/)
})

test('computeFoodGaps：基础菜挂上 special_char 后不再算缺口', () => {
  const linked = SPECIAL_ROWS.map(r => (r.id === 10 ? { ...r, special_char: '凝光' } : r))
  const groups = computeFoodGaps(NO_ONLINE, linked, { characters: SPECIAL_CHARS, materials: SPECIAL_MATERIALS })
  const ids = (groups.find(g => g.key === 'special')?.items || []).map(i => i.id)
  assert.ok(!ids.includes(10), '已关联的原型不该再出现在缺口里')
  assert.deepEqual(ids, [20, 21], '其它角色的缺口不受影响')
})

test('computeFoodGaps：缺原型但不传 ctx / 没配方数据时不误报', () => {
  // 兼容旧调用：不传 ctx 就没有这一组
  assert.deepEqual(computeFoodGaps(NO_ONLINE, SPECIAL_ROWS), [])
  // 特殊料理自己没配方（材料表为空）时给不出候选，交由「缺烹饪材料」暴露
  const noRecipe = SPECIAL_ROWS.map(r => (r.id === 11 ? { ...r, material_count: 0 } : r))
    .filter(r => r.id !== 10)
  const groups = computeFoodGaps(NO_ONLINE, noRecipe, {
    characters: SPECIAL_CHARS,
    materials: SPECIAL_MATERIALS.filter(m => m.food_id !== 10 && m.food_id !== 11),
  })
  assert.deepEqual(groups.find(g => g.key === 'special')?.items.map(i => i.id) || [], [20, 21])
})

// ═══════════════════════════════════════════════════════════
if (failures.length > 0) {
  console.error(`\n✗ food save/gap tests: ${failures.length} failed, ${passed} passed\n`)
  for (const f of failures) console.error(`  · ${f.name}\n    ${f.error}`)
  process.exit(1)
}
console.log(`✓ food save/gap tests: ${passed} passed`)

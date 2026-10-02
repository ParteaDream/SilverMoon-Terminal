import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

import {
  findCharacterDish, findDishCharacter,
  findCharacterDishPrototype, findDishPrototype, findDishDerivatives, findDishRelations,
  attachFoodCharLinks, matchFoodSearch, primaryDishChar, DISH_CHAR_ROLE,
} from '../src/utils/dishLinks.js'

const require = createRequire(import.meta.url)
const initSqlJs = require('sql.js')

// ═══════════════════════════════════════════════════════════════
// 特殊料理 ↔ 食物板块 关联规则的单元测试
//
// 不连真实数据库：用内存库喂入能覆盖各条分支的小数据集，跑的是
// src/utils/dishLinks.js 里**真正的 SQL**（优先级 / 兜底 / 空值都由它决定）。
// 真实种子数据的覆盖率由 e2e 用例（test:dish-links:e2e）保证。
// ═══════════════════════════════════════════════════════════════

const SCHEMA = `
  CREATE TABLE characters (id INTEGER PRIMARY KEY, name_zh TEXT, dish_name TEXT, rarity INTEGER);
  CREATE TABLE foods (id INTEGER PRIMARY KEY, name_zh TEXT, type TEXT, rarity INTEGER, image TEXT, special_char TEXT);
`

const CHARACTERS = [
  [100, '七七', '没有未来菜', 5],
  [101, '早柚', '头晕回避术・改', 4],   // 对应料理在 foods 里是 ingredient，只能按名字对
  [102, '钟离', null, 5],             // 没有特殊料理
  [103, '凯亚', '果香串烤', 4],        // 名下既有 dish 又有 ingredient 挂着 special_char
  [104, '薇斯纳', '霜冻冰花汤', 4],    // 特殊料理条目没有特殊料理标记（special_char 为空）
]

const FOODS = [
  [1, '来来菜', 'dish', 3, 'lailai.png', '七七'],          // 基础菜（同名角色，但不是特殊料理）
  [2, '没有未来菜', 'special', 4, 'weilai.png', '七七'],    // 七七的特殊料理
  [3, '头晕回避术・改', 'ingredient', 3, 'yunto.png', ''],  // 早柚：类型不是 special，名字对得上
  [4, '饭团', 'dish', 2, 'fantuan.png', '早柚'],           // 早柚名下还有基础菜 —— 不能跳到它
  [5, '满足沙拉', 'dish', 3, 'salad.png', ''],
  [6, '野菇鸡肉串', 'dish', 2, 'shuan.png', '凯亚'],        // 凯亚：正规料理，原型优先取它
  [7, '凯亚特调', 'ingredient', 2, 'teediao.png', '凯亚'],  // 凯亚：另有食材条目也挂着 special_char
  [8, '果香串烤', 'special', 3, 'guoxiang.png', '凯亚'],
  [9, '雪国冷汤', 'dish', 3, 'xueguo.png', '薇斯纳'],
  [10, '霜冻冰花汤', 'special', 3, 'shuangdong.png', ''],   // 薇斯纳：special_char 为空
]

function makeQuery(db) {
  const calls = []
  const query = async (sql, params = []) => {
    calls.push({ sql, params })
    const stmt = db.prepare(sql)
    try {
      stmt.bind(params)
      const data = []
      while (stmt.step()) data.push(stmt.getAsObject())
      return { data }
    } finally {
      stmt.free()
    }
  }
  query.calls = calls
  return query
}

async function makeDb({ dropSpecial = false } = {}) {
  const SQL = await initSqlJs()
  const db = new SQL.Database()
  db.run(SCHEMA)
  for (const c of CHARACTERS) db.run('INSERT INTO characters VALUES (?,?,?,?)', c)
  for (const f of FOODS) {
    if (dropSpecial && f[0] === 2) continue
    db.run('INSERT INTO foods VALUES (?,?,?,?,?,?)', f)
  }
  return db
}

// ── 角色 → 食物 ──

{
  const q = makeQuery(await makeDb())
  // 同一个角色底下既有基础菜又有特殊料理时，必须选中 type='special' 的那条
  const dish = await findCharacterDish(q, { characterName: '七七', dishName: '没有未来菜' })
  assert.equal(dish.id, 2)
  assert.equal(dish.name_zh, '没有未来菜')
  assert.equal(dish.type, 'special')

  // 只按名字兜底：对应料理不是 special 类型（早柚）
  // 她名下还有一条 special_char='早柚' 的基础菜（饭团），优先级必须让名字赢
  const fallback = await findCharacterDish(q, { characterName: '早柚', dishName: '头晕回避术・改' })
  assert.equal(fallback.id, 3)
  assert.equal(fallback.type, 'ingredient')

  // 只给料理名（角色名缺失）也要能命中
  assert.equal((await findCharacterDish(q, { dishName: '没有未来菜' })).id, 2)

  // 料理名对不上时退到 special_char，并优先挑 type='special' 的那条（七七 → 没有未来菜，而不是来来菜）
  assert.equal((await findCharacterDish(q, { characterName: '七七', dishName: '改过名的菜' })).id, 2)
  assert.equal((await findCharacterDish(q, { characterName: '早柚', dishName: '改过名的菜' })).id, 4)

  // 没有特殊料理 / 库里查不到 → null，而不是抛错
  assert.equal(await findCharacterDish(q, { characterName: '钟离', dishName: null }), null)
  assert.equal(await findCharacterDish(q, { characterName: '不存在的人', dishName: '不存在的菜' }), null)

  // 参数全空时不查库
  const before = q.calls.length
  assert.equal(await findCharacterDish(q, {}), null)
  assert.equal(await findCharacterDish(q, { characterName: '  ', dishName: '' }), null)
  assert.equal(q.calls.length, before)
}

// ── 特殊料理缺失时退到基础菜 ──

{
  const q = makeQuery(await makeDb({ dropSpecial: true }))
  const dish = await findCharacterDish(q, { characterName: '七七', dishName: '没有未来菜' })
  // 没有 special 条目时，按角色名命中的基础菜（来来菜）就是最好的答案
  assert.equal(dish.id, 1)
  assert.equal(dish.name_zh, '来来菜')
}

// ── 食物 → 角色 ──

{
  const q = makeQuery(await makeDb())
  const char = await findDishCharacter(q, '七七')
  assert.equal(char.id, 100)
  assert.equal(char.name_zh, '七七')

  // special_char 为空 / 对不上角色名 → null（页面退化成纯文本）
  assert.equal(await findDishCharacter(q, ''), null)
  assert.equal(await findDishCharacter(q, null), null)
  assert.equal(await findDishCharacter(q, '   '), null)
  assert.equal(await findDishCharacter(q, '??'), null)

  // 能不能跳转只看 foods.special_char 写的是谁，不要求该角色自己有特殊料理
  assert.equal((await findDishCharacter(q, '钟离')).id, 102)

  const before = q.calls.length
  await findDishCharacter(q, '')
  assert.equal(q.calls.length, before, '空 special_char 不该查库')
}

// ── 特殊料理 → 料理原型 ──

{
  const q = makeQuery(await makeDb())

  // 角色页入口：以角色名为锚点取那道被变化的基础菜
  assert.equal((await findCharacterDishPrototype(q, { characterName: '七七' })).id, 1)
  assert.equal((await findCharacterDishPrototype(q, { characterName: '早柚' })).id, 4)
  // 名下有多道菜挂着 special_char 时，正规料理（dish）优先于食材条目
  assert.equal((await findCharacterDishPrototype(q, { characterName: '凯亚' })).id, 6)
  // 食物页那条就是原型自己时不能返回自己（否则会出现"原型 = 本页"）
  assert.equal(await findCharacterDishPrototype(q, { characterName: '七七', dishFoodId: 1 }), null)
  // 没有特殊料理的角色 / 生僻参数 → null，而不是抛错
  assert.equal(await findCharacterDishPrototype(q, { characterName: '钟离' }), null)
  assert.equal(await findCharacterDishPrototype(q, { characterName: '不存在的人' }), null)
  const before = q.calls.length
  assert.equal(await findCharacterDishPrototype(q, { characterName: '  ' }), null)
  assert.equal(q.calls.length, before, '空角色名不该查库')

  // 食物页入口：special 类型按自己的 special_char 找原型
  assert.equal((await findDishPrototype(q, { specialChar: '七七', dishName: '没有未来菜', type: 'special', id: 2 })).id, 1)
  // 非 special 类型（早柚的食材条目）只按菜名反查角色，不能把基础菜自己当特殊料理
  assert.equal((await findDishPrototype(q, { specialChar: '', dishName: '头晕回避术・改', type: 'ingredient', id: 3 })).id, 4)
  assert.equal(await findDishPrototype(q, { specialChar: '早柚', dishName: '饭团', type: 'dish', id: 4 }), null)
  // special 类型但 special_char 为空：按菜名反查角色（薇斯纳）
  assert.equal((await findDishPrototype(q, { specialChar: '', dishName: '霜冻冰花汤', type: 'special', id: 10 })).id, 9)
  // 普通料理（没人拿它做特殊料理）→ null
  assert.equal(await findDishPrototype(q, { specialChar: '', dishName: '满足沙拉', type: 'dish', id: 5 }), null)

  const before2 = q.calls.length
  assert.equal(await findDishPrototype(q, {}), null)
  assert.equal(q.calls.length, before2, '参数全空时不该查库')
}

// ── 基础菜 → 衍生特殊料理 ──

{
  const q = makeQuery(await makeDb())

  assert.deepEqual((await findDishDerivatives(q, { specialChar: '七七', foodId: 1 })).map(f => f.id), [2])
  assert.deepEqual((await findDishDerivatives(q, { specialChar: '凯亚', foodId: 6 })).map(f => f.id), [8])
  // 特殊料理自己没有 special 类型的衍生条目 → 不吃兜底、返回空（不能列成自己的衍生）
  assert.deepEqual(await findDishDerivatives(q, { specialChar: '七七', foodId: 2 }), [])
  // special_char 缺失的特殊料理：退回 characters.dish_name 找回（薇斯纳 / 早柚）
  assert.deepEqual((await findDishDerivatives(q, { specialChar: '薇斯纳', foodId: 9 })).map(f => f.id), [10])
  assert.deepEqual((await findDishDerivatives(q, { specialChar: '早柚', foodId: 4 })).map(f => f.id), [3])

  const before = q.calls.length
  assert.deepEqual(await findDishDerivatives(q, {}), [])
  assert.deepEqual(await findDishDerivatives(q, { specialChar: '   ', foodId: 1 }), [])
  assert.equal(q.calls.length, before, '空 special_char 不该查库')
}

// ── 食物页一次取全两个方向 ──

{
  const q = makeQuery(await makeDb())

  // 特殊料理：只给原型
  const special = await findDishRelations(q, { id: 2, name_zh: '没有未来菜', type: 'special', special_char: '七七' })
  assert.equal(special.prototype.id, 1)
  assert.deepEqual(special.derivatives, [])

  // 基础菜：只给衍生特殊料理
  const base = await findDishRelations(q, { id: 1, name_zh: '来来菜', type: 'dish', special_char: '七七' })
  assert.equal(base.prototype, null)
  assert.deepEqual(base.derivatives.map(f => f.id), [2])

  // 两头都不沾的普通料理：两个方向都为空（页面据此隐藏「料理关系」区块）
  const plain = await findDishRelations(q, { id: 5, name_zh: '满足沙拉', type: 'dish', special_char: '' })
  assert.equal(plain.prototype, null)
  assert.deepEqual(plain.derivatives, [])

  // 兜底条目：早柚那道菜既是"没标 special 的特殊料理"，也是"饭团的衍生"
  const zaoyou = await findDishRelations(q, { id: 3, name_zh: '头晕回避术・改', type: 'ingredient', special_char: '' })
  assert.equal(zaoyou.prototype.id, 4)
  assert.deepEqual(zaoyou.derivatives, [])

  assert.deepEqual(await findDishRelations(q, null), { prototype: null, derivatives: [] })
}

// ── 列表页搜索：搜角色名 → 特殊料理 + 它的原型（纯函数版，不查库） ──

{
  const rows = attachFoodCharLinks(
    FOODS.map(f => ({ id: f[0], name_zh: f[1], type: f[2], special_char: f[5] })),
    CHARACTERS.map(c => ({ name_zh: c[1], dish_name: c[2] }))
  )
  const byId = new Map(rows.map(r => [r.id, r]))

  // 每条菜的关联身份：基础菜记为「原型」，特殊料理记为「特殊料理」
  assert.deepEqual(byId.get(1).char_links, [{ name: '七七', role: DISH_CHAR_ROLE.prototype }])
  assert.deepEqual(byId.get(2).char_links, [{ name: '七七', role: DISH_CHAR_ROLE.special }])
  // special_char 缺失的条目靠 characters.dish_name 兜底（早柚那条是 ingredient）
  assert.deepEqual(byId.get(3).char_links, [{ name: '早柚', role: DISH_CHAR_ROLE.special }])
  assert.deepEqual(byId.get(4).char_links, [{ name: '早柚', role: DISH_CHAR_ROLE.prototype }])
  // 与角色无关的普通料理不挂关联
  assert.equal(byId.get(5).char_links, undefined)

  const search = (q) => rows.filter(r => matchFoodSearch(r, q)).map(r => r.id)

  // 搜角色名：特殊料理与它的原型一起出来
  assert.deepEqual(search('七七'), [1, 2])
  assert.deepEqual(search('早柚'), [3, 4])
  // 没有特殊料理的角色搜不出东西（数据缺口不猜）
  assert.deepEqual(search('钟离'), [])
  // 原有字段照常能搜；空搜索词放行全部
  assert.deepEqual(search('沙拉'), [5])
  assert.equal(search('   ').length, rows.length)
  assert.deepEqual(search('没有未来'), [2])

  // 角标优先显示「是谁的特殊料理」
  assert.equal(primaryDishChar([{ name: 'A', role: 'prototype' }, { name: 'B', role: 'special' }]).name, 'B')
  assert.deepEqual(primaryDishChar(byId.get(2).char_links), { name: '七七', role: 'special' })
  assert.equal(primaryDishChar(undefined), null)
  assert.equal(primaryDishChar([]), null)
}

// ── 纯函数版与 SQL 版必须是同一套口径 ──

{
  const q = makeQuery(await makeDb())
  const rows = attachFoodCharLinks(
    FOODS.map(f => ({ id: f[0], name_zh: f[1], type: f[2], special_char: f[5] })),
    CHARACTERS.map(c => ({ name_zh: c[1], dish_name: c[2] }))
  )
  for (const c of CHARACTERS) {
    const dish = await findCharacterDish(q, { characterName: c[1], dishName: c[2] })
    const proto = await findCharacterDishPrototype(q, { characterName: c[1] })
    const expected = [dish?.id, proto?.id].filter(v => v != null)
    if (expected.length === 0) continue
    const hit = rows.filter(r => matchFoodSearch(r, c[1])).map(r => r.id)
    for (const id of expected) {
      assert.ok(hit.includes(id), `搜「${c[1]}」应收录 ${id}（SQL 版给出的条目），实际 ${JSON.stringify(hit)}`)
    }
  }
  // 反例：SQL 版查不到原型的角色（钟离）不该被纯函数版凭空补出一个
  assert.deepEqual(rows.filter(r => matchFoodSearch(r, '钟离')).map(r => r.id), [])
}

console.log('dish links tests passed')

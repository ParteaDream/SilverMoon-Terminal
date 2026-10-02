// 希穆兰卡 · 卡池数据装配层单测（node 直跑，无打包）
import {
  toSimItem, deriveStandard4Weapons, wishDetailToPools, buildPoolDefs,
  pityFromGachaArchive, emptyPoolConfig, GACHA_TYPE_TO_POOL, FALLBACK_STANDARD_4WEAPONS,
} from '../src/utils/wishSimData.js'
import { itemKey } from '../src/utils/wishSimulator.js'

let failures = 0
const ok = (name, cond, extra) => {
  if (cond) console.log(`  ✓ ${name}`)
  else { failures++; console.log(`  ✗ ${name}`, extra ?? '') }
}

// ── 夹具 ──
const charRow = (id, name, rarity, card, splash) => ({ id, name_zh: name, rarity, card_art: card, splash_art: splash, element: '火', weapon_type: '单手剑' })
const weapRow = (id, name, rarity, typeId, img, simple, cat = '武器') => ({ id, name_zh: name, rarity, weapon_type_id: typeId, image: img, simple_art: simple, category: cat, weapon_type: '单手剑' })

console.log('== toSimItem ==')
{
  const c = toSimItem(charRow(10000002, '琴', 5, 'UI_AvatarIcon_Qin.png', 'UI_Gacha_AvatarImg_Qin.png'), 'character')
  ok('角色取头像为 art、立绘为 splash', c.art === 'UI_AvatarIcon_Qin.png' && c.splash === 'UI_Gacha_AvatarImg_Qin.png')
  ok('角色 type/rarity/key 正确', c.type === 'character' && c.rarity === 5 && c.key === itemKey('character', 10000002))
  ok('角色保留元素与武器类型', c.element === '火' && c.weaponType === '单手剑')
  const w = toSimItem(weapRow(11501, '天空之刃', 5, 1, 'UI_Gacha_EquipIcon_Sword_Dvalin.png', 'UI_EquipIcon_Sword_Dvalin.png'), 'weapon')
  ok('武器取装备图为 art、卡池图为 splash', w.art === 'UI_EquipIcon_Sword_Dvalin.png' && w.splash === 'UI_Gacha_EquipIcon_Sword_Dvalin.png')
  ok('空行返回 null', toSimItem(null, 'character') === null)
  const noCard = toSimItem({ id: 1, name_zh: 'X', rarity: 4, card_art: null, splash_art: 'S.png' }, 'character')
  ok('缺头像时回退立绘', noCard.art === 'S.png')
}

console.log('== deriveStandard4Weapons ==')
{
  // 模拟真实分布：单手剑 22/21/19/19/9，双手剑 21/20/19/19/8，长柄 41/40/6，
  // 法器 24/21/20/19/9，弓 20/18/18/17/9
  const rows = [
    { id: 1, weapon_type_id: 1, c: 22 }, { id: 2, weapon_type_id: 1, c: 21 }, { id: 3, weapon_type_id: 1, c: 19 },
    { id: 4, weapon_type_id: 1, c: 19 }, { id: 5, weapon_type_id: 1, c: 9 },
    { id: 6, weapon_type_id: 2, c: 21 }, { id: 7, weapon_type_id: 2, c: 20 }, { id: 8, weapon_type_id: 2, c: 19 },
    { id: 9, weapon_type_id: 2, c: 19 }, { id: 10, weapon_type_id: 2, c: 8 },
    { id: 11, weapon_type_id: 3, c: 41 }, { id: 12, weapon_type_id: 3, c: 40 }, { id: 13, weapon_type_id: 3, c: 6 },
    { id: 14, weapon_type_id: 4, c: 24 }, { id: 15, weapon_type_id: 4, c: 21 }, { id: 16, weapon_type_id: 4, c: 20 },
    { id: 17, weapon_type_id: 4, c: 19 }, { id: 23, weapon_type_id: 4, c: 9 },
    { id: 18, weapon_type_id: 5, c: 20 }, { id: 19, weapon_type_id: 5, c: 18 }, { id: 20, weapon_type_id: 5, c: 18 },
    { id: 21, weapon_type_id: 5, c: 17 }, { id: 22, weapon_type_id: 5, c: 9 },
  ]
  const weapons = rows.map(r => ({ id: r.id, name_zh: `W${r.id}` }))
  const got = deriveStandard4Weapons(rows, weapons)
  ok('推出 18 件常驻四星武器', got.length === 18, got.join(','))
  ok('排除低频限定武器（id 5/10/13/22/23）', ![5, 10, 13, 22, 23].some(x => got.includes(x)))
  ok('长柄只保留高频两件（11/12）', got.includes(11) && got.includes(12))
  ok('法器保留 4 件（14/15/16/17）', [14, 15, 16, 17].every(x => got.includes(x)))
}
{
  const got = deriveStandard4Weapons([], [{ id: 1, name_zh: '笛剑' }, { id: 2, name_zh: '西风剑' }])
  ok('数据不足时回退兜底名单', got.length === 2 && got.includes(1) && got.includes(2))
  ok('兜底名单为 18 件', FALLBACK_STANDARD_4WEAPONS.length === 18)
}

console.log('== wishDetailToPools：角色活动祈愿（双池）==')
{
  const roster = {
    charMap: new Map([
      [101, { type: 'character', id: 101, name: '玛拉妮', rarity: 5, key: 'character:101' }],
      [102, { type: 'character', id: 102, name: '希格雯', rarity: 5, key: 'character:102' }],
      [201, { type: 'character', id: 201, name: '卡齐娜', rarity: 4, key: 'character:201' }],
    ]),
    weaponMap: new Map(),
  }
  const detail = {
    wish: { banner_type: 'character-event', version: '5.0', phase: 1 },
    banners: [
      { id: 57, name_zh: '鲨鲨逐浪游', banner_image: '["Gacha_5.0_01_01.jpeg"]', sort_order: 0 },
      { id: 58, name_zh: '叶落风随', banner_image: '["Gacha_5.0_01_02.jpeg"]', sort_order: 1 },
    ],
    items: [
      { banner_id: 57, item_type: 'character', item_id: 101, rarity: 5, sort_order: 0 },
      { banner_id: 57, item_type: 'character', item_id: 201, rarity: 4, sort_order: 1 },
      { banner_id: 58, item_type: 'character', item_id: 102, rarity: 5, sort_order: 0 },
      { banner_id: 58, item_type: 'character', item_id: 201, rarity: 4, sort_order: 1 },
    ],
  }
  const pools = wishDetailToPools(detail, roster)
  ok('拆出角色池与角色池-2', !!pools.character1 && !!pools.character2)
  ok('角色池 UP5 正确', pools.character1.up5[0].name === '玛拉妮')
  ok('角色池-2 UP5 正确', pools.character2.up5[0].name === '希格雯')
  ok('池名取自 banner', pools.character1.bannerName === '鲨鲨逐浪游' && pools.character2.bannerName === '叶落风随')
  ok('卡池图来自 JSON 数组', pools.character1.bannerImage === 'Gacha_5.0_01_01.jpeg')
  ok('两池共享同一批 UP4', pools.character1.up4.length === 1 && pools.character2.up4.length === 1)
}
{
  // 单 banner 的角色池不应产生 character2
  const roster = { charMap: new Map([[101, { type: 'character', id: 101, name: 'A', rarity: 5 }]]), weaponMap: new Map() }
  const pools = wishDetailToPools({
    wish: { banner_type: 'character-event' },
    banners: [{ id: 1, name_zh: 'X', banner_image: null, sort_order: 0 }],
    items: [{ banner_id: 1, item_type: 'character', item_id: 101, rarity: 5, sort_order: 0 }],
  }, roster)
  ok('单池角色祈愿不产生角色池-2', !!pools.character1 && !pools.character2)
}

console.log('== wishDetailToPools：武器 / 集录 / 常驻 ==')
{
  const roster = {
    charMap: new Map([[501, { type: 'character', id: 501, name: '可莉', rarity: 5 }]]),
    weaponMap: new Map([
      [301, { type: 'weapon', id: 301, name: '冲浪时光', rarity: 5 }],
      [302, { type: 'weapon', id: 302, name: '苍古自由之誓', rarity: 5 }],
      [401, { type: 'weapon', id: 401, name: '西风剑', rarity: 4 }],
    ]),
  }
  const w = wishDetailToPools({
    wish: { banner_type: 'weapon-event' },
    banners: [{ id: 59, name_zh: '神铸赋形', banner_image: '["Gacha_Weapon_5.0_01_01.jpeg"]', sort_order: 0 }],
    items: [
      { banner_id: 59, item_type: 'weapon', item_id: 301, rarity: 5, sort_order: 0 },
      { banner_id: 59, item_type: 'weapon', item_id: 302, rarity: 5, sort_order: 1 },
      { banner_id: 59, item_type: 'weapon', item_id: 401, rarity: 4, sort_order: 2 },
    ],
  }, roster)
  ok('武器池两把 UP5', w.weapon.up5.length === 2 && w.weapon.up5[0].name === '冲浪时光')
  ok('武器池 1 件 UP4', w.weapon.up4.length === 1)

  const c = wishDetailToPools({
    wish: { banner_type: 'chronicled' },
    banners: [{ id: 719, name_zh: '溯光祈愿', banner_image: '["Gacha_Compilation_6.7_01_01.png"]', sort_order: 0 }],
    items: [
      { banner_id: 719, item_type: 'character', item_id: 501, rarity: 5, sort_order: 0 },
      { banner_id: 719, item_type: 'weapon', item_id: 301, rarity: 5, sort_order: 1 },
      { banner_id: 719, item_type: 'weapon', item_id: 401, rarity: 4, sort_order: 2 },
    ],
  }, roster)
  ok('集录池用 pool5/pool4 承载全部池内容', c.chronicled.pool5.length === 2 && c.chronicled.pool4.length === 1)
  ok('集录池 UP5 不等同于全部（不写 up5）', c.chronicled.up5 === undefined)

  const s = wishDetailToPools({
    wish: { banner_type: 'standard' },
    banners: [{ id: 52, name_zh: '奔行世间', banner_image: '["Gacha_Standard_01.png"]', sort_order: 0 }],
    items: [],
  }, roster)
  ok('常驻池只带横幅信息', s.standard.bannerName === '奔行世间' && s.standard.bannerImage === 'Gacha_Standard_01.png')
  ok('空 detail 返回空对象', Object.keys(wishDetailToPools(null, roster)).length === 0)
}

console.log('== buildPoolDefs ==')
{
  const roster = {
    std5: [{ type: 'character', id: 1, name: '琴', rarity: 5, key: 'character:1' }],
    std4: [{ type: 'character', id: 2, name: '班尼特', rarity: 4, key: 'character:2' }],
    weapons3: [{ type: 'weapon', id: 3, name: '冷刃', rarity: 3, key: 'weapon:3' }],
  }
  const cfg = {
    character1: { kind: 'character', bannerName: 'A', up5: [roster.std5[0]], up4: [roster.std4[0]] },
    character2: { kind: 'character', enabled: false, up5: [], up4: [] },
    weapon: null,
    chronicled: null,
    standard: { kind: 'standard' },
  }
  const defs = buildPoolDefs(cfg, roster)
  ok('角色池装配成功', defs.character1 && defs.character1.up5.length === 1)
  ok('未启用的角色池-2 为 null', defs.character2 === null)
  ok('未配置的池为 null', defs.weapon === null && defs.chronicled === null)
  ok('常驻池携带标准池与三星池', defs.standard.standard5.length === 1 && defs.standard.weapons3.length === 1)
  ok('emptyPoolConfig 覆盖五池', Object.keys(emptyPoolConfig()).length === 5)
}

console.log('== pityFromGachaArchive（垫池与历史导入）==')
{
  const roster = {
    std5Chars: [{ name: '琴' }, { name: '莫娜' }],
    std5Weapons: [{ name: '天空之翼' }],
    characters: [{ type: 'character', id: 1, name: '琴', rarity: 5, key: 'character:1' }, { type: 'character', id: 3, name: '玛拉妮', rarity: 5 }],
    weapons: [{ type: 'weapon', id: 2, name: '天空之翼', rarity: 5, key: 'weapon:2' }],
  }
  const itemsByType = {
    301: [
      { id: '1', gacha_type: 301, name: '琴', rank_type: 5, time: '2026-01-01 10:00:00', item_type: '角色' },
      { id: '2', gacha_type: 301, name: '班尼特', rank_type: 4, time: '2026-01-01 10:01:00', item_type: '角色' },
      { id: '3', gacha_type: 301, name: '冷刃', rank_type: 3, time: '2026-01-01 10:02:00', item_type: '武器' },
    ],
    400: [
      { id: '4', gacha_type: 400, name: '玛拉妮', rank_type: 5, time: '2026-01-02 10:00:00', item_type: '角色' },
      { id: '5', gacha_type: 400, name: '冷刃', rank_type: 3, time: '2026-01-02 10:01:00', item_type: '武器' },
    ],
    302: [
      { id: '6', gacha_type: 302, name: '天空之翼', rank_type: 5, time: '2026-01-03 10:00:00', item_type: '武器' },
    ],
    500: [],
    200: [],
  }
  const r = pityFromGachaArchive(itemsByType, roster)
  // 角色池合并后：[琴(5), 班尼特(4), 冷刃(3), 玛拉妮(5), 冷刃(3)]
  ok('301/400 合并计数：距上次五星 1 抽', r.pity.character.p5 === 1, r.pity.character.p5)
  ok('距上次四星 1 抽', r.pity.character.p4 === 1, r.pity.character.p4)
  ok('最近五星为 UP 角色 → 小保底', r.pity.character.guaranteed === 0)
  ok('武器池 0 抽垫底', r.pity.weapon.p5 === 0)
  ok('武器池首个五星为常驻 → 大保底', r.pity.weapon.guaranteed === 1)
  ok('历史记录按时间升序回填', r.records.length === 6 && r.records[0].name === '琴')
  ok('历史记录标记 imported', r.records.every(x => x.imported === true))
  ok('历史记录 seq 连续', r.records.every((x, i) => x.seq === i + 1))
  ok('五星记录带 pity5', r.records.find(x => x.name === '琴').pity5 === 1)
  ok('捕捉站类型映射齐备', GACHA_TYPE_TO_POOL[301] === 'character1' && GACHA_TYPE_TO_POOL[400] === 'character2' && GACHA_TYPE_TO_POOL[302] === 'weapon' && GACHA_TYPE_TO_POOL[500] === 'chronicled')
}
{
  // 连续两次大保底后的捕获明光连保推算
  const roster = { std5Chars: [{ name: '琴' }], std5Weapons: [], characters: [], weapons: [] }
  const itemsByType = {
    301: [
      { id: '1', gacha_type: 301, name: '琴', rank_type: 5, time: '2026-01-01 10:00:00' },
      { id: '2', gacha_type: 301, name: '玛拉妮', rank_type: 5, time: '2026-01-02 10:00:00' },
      { id: '3', gacha_type: 301, name: '琴', rank_type: 5, time: '2026-01-03 10:00:00' },
      { id: '4', gacha_type: 301, name: '希诺宁', rank_type: 5, time: '2026-01-04 10:00:00' },
    ],
  }
  const r = pityFromGachaArchive(itemsByType, roster)
  ok('连续两次大保底 → 连保 2 次', r.pity.character.crStreak === 2, r.pity.character.crStreak)
  ok('最近为 UP → 小保底', r.pity.character.guaranteed === 0)
}
{
  const r = pityFromGachaArchive({}, { std5Chars: [], std5Weapons: [], characters: [], weapons: [] })
  ok('空档案不炸且计数为 0', r.pity.character.p5 === 0 && r.records.length === 0)
}

console.log('')
if (failures) { console.log(`✗ ${failures} 项未通过`); process.exit(1) }
console.log('✓ 全部通过')

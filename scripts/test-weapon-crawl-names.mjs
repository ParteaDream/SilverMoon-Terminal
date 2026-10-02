#!/usr/bin/env node
/**
 * 武器爬虫"写库规则"单测
 *
 * 覆盖此前真实出过的三类问题：
 *   1. 爬虫从不更新 name_zh（武器中文名永远不会变）
 *   2. name_en 被写入占位值（"Weapon: Sword"）或空值时被静默跳过
 *   3. 武器装扮/TPS 武器爬不到数值时，0 覆盖掉库里的值
 *
 * Run: node scripts/test-weapon-crawl-names.mjs
 */
import { buildWeaponUpdate, effectiveWeaponId, isPlaceholderName } from '../src/utils/weaponCrawlSave.mjs'

let failed = 0
function check(name, ok, detail) {
  if (ok) console.log(`  PASS  ${name}`)
  else { failed++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`) }
}
function fieldValue(res, key) {
  const i = res.fields.indexOf(`${key} = ?`)
  return i >= 0 ? res.values[i] : undefined
}
function hasField(res, key) { return res.fields.includes(`${key} = ?`) }

console.log('武器爬虫写库规则')

// 1) 中文名/英文名都会更新
{
  const res = buildWeaponUpdate({ name_zh: '银釭', name_en: 'Silver Light', rarity: 4 }, { weaponId: 11438 })
  check('name_zh 写入', fieldValue(res, 'name_zh') === '银釭')
  check('name_en 写入', fieldValue(res, 'name_en') === 'Silver Light')
}

// 2) 撞名时保留本地消歧名，但仍更新英文名
{
  const taken = new Set(['星锋剑'])   // 11521 已占用
  const res = buildWeaponUpdate({ name_zh: '星锋剑', name_en: 'Exaiphanes Blade' }, { weaponId: 390002, takenNames: taken })
  check('撞名不覆盖 name_zh', !hasField(res, 'name_zh'), JSON.stringify(res.fields))
  check('撞名仍更新 name_en', fieldValue(res, 'name_en') === 'Exaiphanes Blade')
  check('撞名被记录到 skipped', res.skipped.some(s => s.includes('name_zh')))
}

// 3) 同名条目自身不算撞名（ID 相同不会出现在 takenNames 里）
{
  const res = buildWeaponUpdate({ name_zh: '冷刃' }, { weaponId: 11301, takenNames: new Set(['银剑']) })
  check('非撞名正常更新', fieldValue(res, 'name_zh') === '冷刃')
}

// 4) 占位英文名不写库
{
  const res = buildWeaponUpdate({ name_zh: '秘星典谕', name_en: 'Weapon: Catalyst' }, { weaponId: 14525 })
  check('占位 name_en 不写库', !hasField(res, 'name_en'))
  check('占位 name_en 记录 skipped', res.skipped.some(s => s.includes('name_en')))
  check('isPlaceholderName 判定', isPlaceholderName('Weapon: Sword') && isPlaceholderName('') && !isPlaceholderName('Silver Light'))
}

// 5) 0/空数值不覆盖
{
  const res = buildWeaponUpdate({
    name_zh: '莎塔娜娅的苍银', name_en: "Shatanaya's Frostsilver",
    base_atk: 0, max_base_atk: 0, secondary_stat: '', weapon_type: 0, rarity: 4,
  }, { weaponId: 224001 })
  check('base_atk=0 不写库', !hasField(res, 'base_atk'))
  check('max_base_atk=0 不写库', !hasField(res, 'max_base_atk'))
  check('secondary_stat 空不写库', !hasField(res, 'secondary_stat'))
  check('weapon_type=0 不写库', !hasField(res, 'weapon_type_id'))
  check('rarity 正常写入', fieldValue(res, 'rarity') === 4)
}

// 6) 正常数值照写
{
  const res = buildWeaponUpdate({
    base_atk: 42, max_base_atk: 510, secondary_stat: '暴击率',
    secondary_stat_value: '6%', max_secondary_stat_value: '27.6%', weapon_type: 1,
  }, { weaponId: 15435 })
  check('base_atk 写入', fieldValue(res, 'base_atk') === 42)
  check('max_base_atk 写入', fieldValue(res, 'max_base_atk') === 510)
  check('secondary_stat 写入', fieldValue(res, 'secondary_stat') === '暴击率')
  check('副属性数值写入', fieldValue(res, 'secondary_stat_value') === '6%')
  check('weapon_type 写入', fieldValue(res, 'weapon_type_id') === 1)
}

// 7) ID 变更与图片
{
  const res = buildWeaponUpdate({ id: 11521, name_zh: '星锋剑', images: { simple: 'UI_Gacha_EquipIcon_Sword_X', icon: 'UI_EquipIcon_Sword_X' } }, { weaponId: 390002 })
  check('ID 变更写入', fieldValue(res, 'id') === 11521)
  check('effectiveWeaponId 跟随新 ID', effectiveWeaponId({ id: 11521 }, 390002) === 11521)
  check('effectiveWeaponId 无变更保持原值', effectiveWeaponId({ id: 11521 }, 11521) === 11521)
  check('image 文件名带后缀', fieldValue(res, 'image') === 'UI_Gacha_EquipIcon_Sword_X.webp')
  check('simple_art 文件名带后缀', fieldValue(res, 'simple_art') === 'UI_EquipIcon_Sword_X.webp')
}

console.log(`\n${failed === 0 ? 'ALL PASS' : failed + ' FAILED'}`)
process.exitCode = failed === 0 ? 0 : 1

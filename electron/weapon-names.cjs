/**
 * weapon-names.cjs — 武器名称的判定规则（主进程与维护脚本共用）
 *
 * 放在单独文件里是因为这几条规则两边都必须一致：
 *   - 哪些是"还没本地化的占位名"（绝不能写库）
 *   - 名称比对时要忽略哪些装饰符号
 * 任何一边单独改都会让爬虫和修复脚本得出不同结论。
 */

// nanoka 在官方文本上线前会先给占位名：Weapon: Sword / Weapon: Catalyst / Weapon: Bow ...
// 前缀是数据类别，冒号后面才是（临时的）名字。
const PLACEHOLDER_NAME_RE = /^(weapon|item|artifact|relic|material|monster|character|skill|talent|namecard|food|gadget|quest|tps)\s*:\s*/i

/** 占位名 / 空名 —— 都不能作为武器名写入数据库 */
function isPlaceholderName(name) {
  return !name || PLACEHOLDER_NAME_RE.test(String(name).trim())
}

/** 比对用归一化：忽略书名号、括号、间隔号、空格等装饰差异，统一小写 */
function normalizeName(name) {
  return String(name == null ? '' : name)
    .replace(/[「」『』（）()［］[\]【】·・\s]/g, '')
    .toLowerCase()
}

/**
 * 在 nanoka 武器列表里按名字查条目。
 * 顺序：精确 → 归一化 → 包含（包含匹配最容易误伤，放最后）
 * @param {Record<string, {zh?:string,en?:string}>} list
 * @returns {{id:string, info:object}|null}
 */
function findWeaponEntry(list, name) {
  if (!list || !name) return null
  const entries = Object.entries(list)
  const lower = String(name).toLowerCase()
  for (const [id, info] of entries) {
    if (info.zh === name || info.en === name || (info.en && info.en.toLowerCase() === lower)) return { id, info }
  }
  const target = normalizeName(name)
  if (target) {
    for (const [id, info] of entries) {
      if (normalizeName(info.zh) === target || normalizeName(info.en) === target) return { id, info }
    }
  }
  for (const [id, info] of entries) {
    if ((info.zh && info.zh.includes(name)) || (info.en && info.en.toLowerCase().includes(lower))) return { id, info }
  }
  return null
}

module.exports = { PLACEHOLDER_NAME_RE, isPlaceholderName, normalizeName, findWeaponEntry }

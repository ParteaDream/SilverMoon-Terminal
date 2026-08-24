/**
 * 挑战爬虫：解析 nanoka 三类挑战（深境螺旋 / 幻想真境剧诗 / 幽境危战）的目录与详情，
 * 生成可直接填充到编辑表单的数据结构。
 *
 * 数据源（均来自 https://static.nanoka.cc/gi/{version}/...）：
 *  - 深境螺旋      tower.json + zh/tower/{id}.json
 *  - 幻想真境剧诗  rolecombat.json + zh/rolecombat/{id}.json
 *  - 幽境危战      leyline.json + zh/leyline/{id}.json
 *
 * 填充格式参考数据库现有数据（见 electron/seed.sql）。
 */

// ── nanoka 富文本 → 数据库 wiki 标记（<color=#RRGGBBAA> → [color=#RRGGBB]，\n 转真实换行）──
export function nanokaMarkupToDb(text) {
  if (!text || typeof text !== 'string') return text || ''
  let result = text.replace(/\\n/g, '\n')
  result = result
    .replace(/<color=(#[0-9a-fA-F]{6})[0-9a-fA-F]{2}>/g, '[color=$1]')
    .replace(/<color=(#[0-9a-fA-F]{8})>/g, (_, hex) => `[color=${hex.slice(0, 7)}]`)
    .replace(/<color=(#[0-9a-fA-F]{6})>/g, '[color=$1]')
    .replace(/<\/color>/gi, '[/color]')
  return result
}

// ── 幽境危战推荐列表（SPRITE_PRESET 元素代号 → 数据库元素 ID）──
// nanoka 页面 q 映射确认：11001=冰 11002=水 11003=火 11004=雷 11007=草（UI_Buff_Element02_*），
// 11005=风 11006=岩 由序列与实战推荐（对冰怪推荐雷/风/火）推断。
const SPRITE_ELEM_MAP = {
  11001: 6, // 冰
  11002: 2, // 水
  11003: 1, // 火
  11004: 4, // 雷
  11005: 3, // 风
  11006: 7, // 岩
  11007: 5, // 草
}

/**
 * 幽境危战 BOSS 推荐列表 → 数据库「优势/劣势」字段拆分
 *
 * nanoka 的 recommend_list 为数组：第 1 条是优势（推荐），第 2 条及之后是劣势
 * （如 5269010 先驱秘源统辖阵列之影：['{冰}元素角色 | 远程攻击角色', '{水}元素角色 | 近战攻击角色']
 *  → 优势 '{6}元素角色\n远程攻击角色'，劣势 '{2}元素角色\n近战攻击角色'）。
 * 条目内部的分隔 ' | '（<Color=#FFFFFF40> | </Color>）仍按换行处理，属于同一边。
 *
 * @returns {{ advantages: string, disadvantages: string }}
 */
export function splitLeylineAdvDisadv(recommendList = []) {
  const list = Array.isArray(recommendList) ? recommendList : []
  return {
    advantages: leylineAdvantagesToDb(list.slice(0, 1)),
    disadvantages: leylineAdvantagesToDb(list.slice(1)),
  }
}

/**
 * 幽境危战 BOSS 推荐列表 → 数据库「优势」字段
 * 参考 DB 格式：元素图标用 {元素ID} 表示（如 '{1}元素角色'）。
 * 单项推荐内部 nanoka 用 ' | ' 分隔多项内容，拆分为换行（属于同一边）。
 * 已知元素代号替换为 {id}；未知代号（反应组合等，nanoka 无对应元素信息）丢弃，保留文字。
 */
export function leylineAdvantagesToDb(recommendList = []) {
  const lines = []
  for (const raw of recommendList) {
    if (!raw) continue
    let text = String(raw)
      // 颜色分隔标签 ' | ' → 换行（多项推荐拆分）
      .replace(/<Color=#FFFFFF40>\s*\|\s*<\/Color>/gi, '\n')
      .replace(/<color=[^>]*>\s*\|\s*<\/color>/gi, '\n')
      // 已知元素代号 → {元素ID}
      .replace(/\{SPRITE_PRESET#(\d+)\}/g, (m, id) => {
        const elemId = SPRITE_ELEM_MAP[Number(id)]
        return elemId ? `{${elemId}}` : ''
      })
      .split('\n')
      .map(s => s.replace(/[ \t]{2,}/g, ' ').trim())
      .filter(Boolean)
      .join('\n')
    if (!text) continue
    lines.push(text)
  }
  return lines.join('\n')
}

/**
 * 幽境危战 BOSS 详情 → 数据库「详情」字段
 * 参考 DB 格式：效果名金色加粗标题 + 效果详情，末尾怪物介绍用斜体灰色。
 * 段落之间空一行（不同效果之间、灰色怪物介绍与技能描述之间）。
 */
export function leylineDetailsToDb(boss) {
  const blocks = []
  const buffNames = boss.monster_buff_name_list || []
  const buffDetails = boss.monster_buff_detail_list || []
  const buffDescs = boss.monster_buff_desc_list || []
  for (let i = 0; i < buffNames.length; i++) {
    const name = buffNames[i]
    if (!name) continue
    // 优先使用长版详情，其次短版描述
    const detail = buffDetails[i] || buffDescs[i] || ''
    let block = `[color=#FFD780][b]${name}[/b][/color]`
    if (detail) block += '\n' + nanokaMarkupToDb(detail)
    blocks.push(block)
  }
  if (boss.desc) {
    blocks.push(`[i][color=#9ca3af]${nanokaMarkupToDb(boss.desc)}[/color][/i]`)
  }
  // 段落之间用空行分隔
  return blocks.join('\n\n')
}

// 数字 → 欧洲风格千分位（点号），如 1192502 → '1.192.502'
function fmtHpDot(n) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

// ── 深境螺旋（tower）──
export function parseTowerCatalog(detail, id) {
  return {
    id,
    name_zh: (detail && detail.leyline && detail.leyline.name) || '',
    begin: (detail && detail.open) || '',
    end: (detail && detail.close) || '',
  }
}

/**
 * 解析 tower 详情 → 编辑表单填充数据
 * DB 的三间×上下半对应 nanoka 第 12 层的三间（已与种子数据逐期核对）。
 * nanoka 不含第 12 层 Buff（上半/下半），故 upper_buff/lower_buff 不填充。
 * 版本号/起止日期由用户维护，不填充覆盖。
 */
export function parseTowerDetail(detail) {
  const leyline = detail.leyline || {}
  const floors = detail.floor || {}
  const floor12 = floors['12'] || {}
  const rooms = floor12.room || {}
  const chambers = []
  for (let ci = 1; ci <= 3; ci++) {
    const room = rooms[String(ci)] || {}
    const level = room.level != null ? room.level : ''
    const fmt = (monsters = []) => monsters
      .map(m => `${m.name}${level !== '' ? ` Lv. ${level}` : ''} / HP: ${fmtHpDot(m.hp)}`)
    chambers.push({
      chamber: ci,
      upper: fmt(room.first),
      lower: fmt(room.second),
    })
  }
  const hasMonsters = chambers.some(c => c.upper.length > 0 || c.lower.length > 0)
  return {
    form: {
      name_zh: leyline.name || '',
      moon_blessing: nanokaMarkupToDb(leyline.desc || ''),
    },
    children: { chambers },
    hasMonsters,
  }
}

// ── 幻想真境剧诗（rolecombat）──
export function parseTheaterCatalog(detail, id) {
  return {
    id,
    name_zh: '',
    begin: (detail && detail.begin_time) || '',
    end: (detail && detail.end_time) || '',
  }
}

// nanoka 元素代号 → 数据库元素 ID（经 25~31 期与种子数据核对）
// 2火 3水 4草 5雷 6冰 7风 8岩；0 为「无/任意」，丢弃
const NANOKA_ELEM_MAP = { 2: 1, 3: 2, 4: 5, 5: 4, 6: 6, 7: 3, 8: 7 }

/**
 * 解析 rolecombat 详情 → 编辑表单填充数据
 * - recommended_elements：element_list（去 0，映射本地元素 ID，最多 3 个）
 * - opening_characters：buff_avatar_list（开幕角色，6 个）
 * - special_guests：invite_avatar_list（特邀角色，4 个）
 * - enemy_config：取最大难度（10 间）的 BOSS 房间 → round3/6/8/10；
 *   nanoka 无圣牌数据，card1/card2 保留现有值
 */
export function parseTheaterDetail(detail) {
  const avatar = detail.avatar_config || {}
  const recommended = (avatar.element_list || [])
    .map(id => NANOKA_ELEM_MAP[id])
    .filter(id => id != null)
    .slice(0, 3)
  const opening = (avatar.buff_avatar_list || []).map(b => b.id).filter(Boolean)
  const guests = (avatar.invite_avatar_list || []).filter(Boolean)

  // 取房间数最多的难度（通常为 10 间，含全部 BOSS）
  const dc = detail.difficulty_config || {}
  let best = null
  for (const d of Object.values(dc)) {
    const rooms = (d.room && Object.keys(d.room)) || []
    if (!best || rooms.length > best.rooms.length) best = { rooms, room: d.room }
  }
  const enemyConfig = { round3: [], round6: [], round8: [], round10: [] }
  const roundMap = { 3: 'round3', 6: 'round6', 8: 'round8', 10: 'round10' }
  if (best) {
    for (const [rk, rv] of Object.entries(best.room)) {
      const key = roundMap[Number(rk)]
      if (key && rv && rv.title) enemyConfig[key] = [rv.title]
    }
  }
  return {
    form: {},
    children: { recommended_elements: recommended, opening_characters: opening, special_guests: guests, enemy_config: enemyConfig },
  }
}

// ── 幽境危战（leyline）──
export function parseLeylineCatalog(detail, id) {
  return {
    id,
    name_zh: (detail && detail.name) || '',
    begin: (detail && detail.begin_time) || '',
    end: (detail && detail.end_time) || '',
  }
}

// nanoka 关卡难度 4/5/6（险恶/无畏/绝境）→ 数据库难度
const LEYLINE_DIFF_MAP = { 4: 'treacherous', 5: 'fearless', 6: 'desperate' }
const LEYLINE_DIFF_LABELS = { treacherous: '险恶', fearless: '无畏', desperate: '绝境' }

/**
 * 解析 leyline 详情 → 编辑表单填充数据
 *
 * 注意：
 * 1. nanoka 无抗性信息 —— 不填充 boss_name 的抗性附注、不涉及 boss_hp（保留现有值）。
 * 2. V8 的 JSON.parse 会将纯数字字符串键自动按数值排序，导致 level_config 的
 *    BOSS 顺序（阶段1/2/3）与 JSON 文件原始顺序颠倒 —— nanoka 页面正是因此
 *    显示反了。数据库顺序与文件原始插入顺序一致（已与 5269009~5269012
 *    各期种子数据核对），故用主进程返回的 keyOrder 还原文件顺序。
 * 3. 数据库「绝境」难度 BOSS 名称带红色加粗标记（[color=#ef4444][b]...[/b][/color]）。
 *
 * @param {object} detail nanoka 详情
 * @param {string[]} [keyOrder] 原始 JSON 文本中数字键的出现顺序（还原 V8 排序）
 */
export function parseLeylineDetail(detail, keyOrder = null) {
  const levels = detail.level || {}
  // 关卡键末位数字即难度序号（如 100104 → 险恶）
  const levelByDiff = {}
  for (const [lk, lv] of Object.entries(levels)) {
    const dc = lv.difficulty_config || {}
    const diff = LEYLINE_DIFF_MAP[dc.level]
    if (diff && !levelByDiff[diff]) levelByDiff[diff] = lv
  }
  // 用原始文件键顺序还原 BOSS 阶段顺序（keyOrder 缺失时退化为数值排序）
  const orderIndex = new Map((keyOrder || []).map((k, i) => [k, i]))
  const keysInFileOrder = (lc) => Object.keys(lc).sort((a, b) =>
    (orderIndex.get(a) ?? Number.MAX_SAFE_INTEGER) - (orderIndex.get(b) ?? Number.MAX_SAFE_INTEGER)
  )

  const bosses = { treacherous: [], fearless: [], desperate: [] }
  for (const diff of ['treacherous', 'fearless', 'desperate']) {
    const lv = levelByDiff[diff]
    if (!lv) continue
    const monsterLevel = lv.monster_level != null ? lv.monster_level + 1 : ''
    const lc = lv.level_config || {}
    // 按文件原始插入顺序（游戏阶段顺序），不要用 V8 排序后的键序
    for (const key of keysInFileOrder(lc)) {
      const boss = lc[key]
      const name = (boss.name || '').trim()
      if (!name) continue
      const isDesperate = diff === 'desperate'
      const advDisadv = splitLeylineAdvDisadv(boss.recommend_list)
      bosses[diff].push({
        boss_name: isDesperate ? `[color=#ef4444][b]${name}[/b][/color]` : name,
        boss_level: String(monsterLevel),
        advantages: advDisadv.advantages,
        disadvantages: advDisadv.disadvantages,
        details: leylineDetailsToDb(boss),
        // nanoka 无 HP / 抗性 / 隐藏信息 → 不提供，填充时保留现有值
        // 图片不爬取（用户明确不需要），保留现有值
      })
    }
  }
  return {
    form: {
      name_zh: detail.name || '',
    },
    children: { bosses },
  }
}

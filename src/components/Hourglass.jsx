import { useState, useCallback, useEffect, useRef } from 'react'
import {
  Hourglass, ArrowLeft, Upload, Database, FileSpreadsheet,
  ChevronRight, AlertTriangle, CheckCircle, X, Loader2,
} from 'lucide-react'

// ═══════════════════════════════════════
// 差异对比工具函数
// ═══════════════════════════════════════

/** 字段名 → 中文标签映射 */
const FIELD_LABELS = {
  // 通用
  name: '名称', name_zh: '中文名', name_en: '英文名', rarity: '稀有度',
  description_zh: '描述', story: '背景故事', sort_order: '排序',
  release_date: '上线日期', birthday: '生日', affiliation: '所属',
  title_zh: '称号', constellation_zh: '命之座',
  // 角色属性
  hp_80: '生命值(Lv80)', hp_90: '生命值(Lv90)', hp_100: '生命值(Lv100)',
  atk_80: '攻击力(Lv80)', atk_90: '攻击力(Lv90)', atk_100: '攻击力(Lv100)',
  def_80: '防御力(Lv80)', def_90: '防御力(Lv90)', def_100: '防御力(Lv100)',
  ascension_stat: '突破属性', ascension_stat_value: '突破属性值',
  element_id: '元素', weapon_type_id: '武器类型', region_id: '地区',
  model_type: '模型类型', join_date: '加入日期',
  // 武器
  base_atk: '基础攻击力', max_base_atk: '满级攻击力',
  secondary_stat: '副属性', secondary_stat_value: '副属性值',
  max_secondary_stat_value: '满级副属性值',
  passive_name_zh: '被动技能', passive_description_zh: '被动描述',
  weapon_series_id: '武器系列',
  // 圣遗物
  max_rarity: '最高稀有度',
  two_piece_bonus: '2件套效果', four_piece_bonus: '4件套效果',
  flower_name_zh: '生之花(名)', plume_name_zh: '死之羽(名)',
  sands_name_zh: '时之沙(名)', goblet_name_zh: '空之杯(名)', circlet_name_zh: '理之冠(名)',
  // 天赋技能
  type: '类型', skill_table: '技能倍率表', icon: '图标',
  // 命之座
  level: '等级', effect: '效果',
  // 图片字段
  splash_art: '立绘', card_art: '头像', namecard_art: '名片',
  simple_art: '装备图',
  flower_image: '生之花图', circlet_image: '理之冠图',
  // 额外效果
  content: '效果正文',
  // 额外 data_json 内部常见字段
  talent_type: '天赋类型', description: '描述',
  upgrades: '升级材料', materials: '材料',
  value: '数值', values: '数值列表',
  // 圣遗物来源关联（炼武秘境标点）
  sourceLink: '来源关联（炼武秘境）',
}

/** 递归深度比较两个 JSON 值，返回差异路径列表 */
function deepDiff(a, b, path = '') {
  const diffs = []
  // 如果一个是 null/undefined 而另一个不是
  if (a == null && b != null) { diffs.push({ path, type: 'changed', oldVal: a, newVal: b }); return diffs }
  if (a != null && b == null) { diffs.push({ path, type: 'changed', oldVal: a, newVal: b }); return diffs }
  if (typeof a !== typeof b) { diffs.push({ path, type: 'changed', oldVal: a, newVal: b }); return diffs }

  if (typeof a === 'object' && a !== null && b !== null) {
    if (Array.isArray(a) && Array.isArray(b)) {
      const maxLen = Math.max(a.length, b.length)
      for (let i = 0; i < maxLen; i++) {
        if (i >= a.length) { diffs.push({ path: `${path}[${i}]`, type: 'added', oldVal: undefined, newVal: b[i] }); continue }
        if (i >= b.length) { diffs.push({ path: `${path}[${i}]`, type: 'removed', oldVal: a[i], newVal: undefined }); continue }
        diffs.push(...deepDiff(a[i], b[i], `${path}[${i}]`))
      }
    } else {
      const allKeys = new Set([...Object.keys(a), ...Object.keys(b)])
      for (const k of allKeys) {
        if (!(k in a)) { diffs.push({ path: `${path}.${k}`, type: 'added', oldVal: undefined, newVal: b[k] }); continue }
        if (!(k in b)) { diffs.push({ path: `${path}.${k}`, type: 'removed', oldVal: a[k], newVal: undefined }); continue }
        diffs.push(...deepDiff(a[k], b[k], `${path}.${k}`))
      }
    }
  } else if (a !== b) {
    diffs.push({ path, type: 'changed', oldVal: a, newVal: b })
  }
  return diffs
}

/** 解析 data_json 字段并对比两条记录 */
function compareRecords(extRecord, curRecord) {
  try {
    const extData = typeof extRecord.data_json === 'string' ? JSON.parse(extRecord.data_json) : extRecord.data_json || extRecord
    const curData = typeof curRecord.data_json === 'string' ? JSON.parse(curRecord.data_json) : curRecord.data_json || curRecord
    return deepDiff(extData, curData)
  } catch {
    return deepDiff(extRecord, curRecord)
  }
}

/**
 * 圣遗物 ↔ 炼武秘境标点 关联索引
 * 从 map_marker_placements.special_function.tooltip.artifacts 提取；
 * 展示名称优先取标点自定义名称（custom_name），为空时回退标点模板名。
 * 返回 Map<artifactId, Array<{ key, markerName }>>，key = map_id|marker_id|custom_name
 * （同一标点模板可放置多个不同自定义名称的标点，如多个炼武秘境，因此 key 含自定义名称）
 */
function buildSourceLinkIndex(placements, markers) {
  const markerNameMap = new Map()
  for (const m of markers || []) markerNameMap.set(m.id, m.name_zh || '')
  const index = new Map()
  const push = (map, id, entry) => {
    if (!map.has(id)) map.set(id, [])
    map.get(id).push(entry)
  }
  for (const p of placements || []) {
    let sf = null
    try {
      sf = typeof p.special_function === 'string' ? JSON.parse(p.special_function) : p.special_function
    } catch { continue }
    const arts = sf?.tooltip?.artifacts
    if (!Array.isArray(arts) || arts.length === 0) continue
    const customName = (p.custom_name || '').trim()
    const markerName = customName || markerNameMap.get(p.marker_id) || '未命名标点'
    const key = `${p.map_id}|${p.marker_id}|${customName}`
    for (const id of arts) push(index, Number(id), { key, markerName })
  }
  // 排序保证跨库对比顺序确定
  for (const arr of index.values()) {
    arr.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  }
  return index
}

/** 对比某圣遗物在两个库中的来源关联标点，生成差异条目（以标点自定义名称呈现） */
function buildSourceLinkDiffs(extLinks, curLinks) {
  const diffs = []
  const extKeyed = new Map(extLinks.map(l => [l.key, l]))
  const curKeyed = new Map(curLinks.map(l => [l.key, l]))
  // 当前库新增的关联标点
  for (const [key, l] of curKeyed) {
    const old = extKeyed.get(key)
    if (!old) {
      diffs.push({ path: '.sourceLink', type: 'added', oldVal: undefined, newVal: l.markerName })
    } else if (old.markerName !== l.markerName) {
      diffs.push({ path: '.sourceLink', type: 'changed', oldVal: old.markerName, newVal: l.markerName })
    }
  }
  // 导入库中存在、当前库已移除的关联标点
  for (const [key, l] of extKeyed) {
    if (!curKeyed.has(key)) {
      diffs.push({ path: '.sourceLink', type: 'removed', oldVal: l.markerName, newVal: undefined })
    }
  }
  return diffs
}

/** 格式化路径为可读标签 */
function formatPath(path) {
  // 保留前导点用于匹配嵌套结构
  let p = path
  // 将 .skills[N] 转换为 > 技能N
  p = p.replace(/\.skills\[(\d+)\]/g, (_, idx) => ` > 技能${parseInt(idx) + 1}`)
  p = p.replace(/\.constellations\[(\d+)\]/g, (_, idx) => ` > 命之座${parseInt(idx) + 1}`)
  p = p.replace(/\.talents\[(\d+)\]/g, (_, idx) => ` > 天赋${parseInt(idx) + 1}`)
  p = p.replace(/\.relatedEffects\[(\d+)\]/g, (_, idx) => ` > 额外效果${parseInt(idx) + 1}`)
  p = p.replace(/\.outfits\[(\d+)\]/g, (_, idx) => ` > 衣装${parseInt(idx) + 1}`)
  p = p.replace(/\.(\w+)/g, (_, field) => {
    const label = FIELD_LABELS[field]
    return label ? ` > ${label}` : ` > ${field}`
  })
  // 去掉开头的 >
  p = p.replace(/^ > /, '')
  // 处理数组索引
  p = p.replace(/\[(\d+)\]/g, (_, idx) => `[${idx}]`)
  return p
}

/** 判断值是否为简单类型（可直接展示） */
function isSimple(val) {
  return val === null || val === undefined || typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean'
}

/** 将值转为展示文本 */
function valToText(val, maxLen = 200) {
  if (val === null || val === undefined) return '—'
  if (typeof val === 'string') return val.length > maxLen ? val.slice(0, maxLen) + '…' : val
  if (typeof val === 'object') {
    try { return JSON.stringify(val, null, 1).slice(0, maxLen) } catch { return String(val) }
  }
  return String(val)
}

/** 富文本格式标记白名单（与 colorMarkup 的 tokenize/stripFormatting 保持一致）：
 *  [color=#xxx]/[color=name]/[/color]、[b]/[/b]、[i]/[/i]、[note="..."]/[/note]
 *  其余方括号内容（如武器精炼数值 [52/65/78/91/104]、[effect:名称] 引用等）
 *  属于数据本身，一律原样保留，避免误过滤重要信息 */
const FORMAT_TAG_PATTERNS = [
  /\[color=(?:#[0-9a-fA-F]{3,8}|[a-zA-Z]+)\]/g,
  /\[\/color\]/g,
  /\[b\]/g,
  /\[\/b\]/g,
  /\[i\]/g,
  /\[\/i\]/g,
  /\[note="[^"]*"\]/g,
  /\[\/note\]/g,
]

/** 去除富文本格式标记（白名单制），保留数据型方括号内容 */
function stripFormatTags(str) {
  if (typeof str !== 'string') return str
  let out = str
  for (const re of FORMAT_TAG_PATTERNS) out = out.replace(re, '')
  return out
}

/** 元数据字段名 — 过滤不展示 */
const METADATA_FIELDS = ['id', 'sort_order', 'character_id', 'weapon_id', 'element_id', 'element']

/** 存储 JSON 字符串的字段名 — 跳过 stripFormatTags，直接比较原始值 */
const JSON_STRING_FIELDS = new Set(['skill_table', 'gallery_images'])

/** 基于 LCS 的词级文本差异：返回分段数组 [{ type: 'same'|'added'|'removed', text }] */
function wordDiff(oldText, newText) {
  if (typeof oldText !== 'string' || typeof newText !== 'string') return null
  // 分词：按词边界分割，保留分隔符（含 [ ]，使精炼数值 [52/65/78/91/104] 等可按单元高亮）
  const tokenize = (s) => {
    const tokens = []
    let last = 0
    const re = /(\s+|[,.!?;:，。！？；：、()（）【】·\n\r+\-*/×%\[\]])/g
    let m
    while ((m = re.exec(s)) !== null) {
      if (m.index > last) tokens.push(m.input.slice(last, m.index))
      tokens.push(m[0])
      last = m.index + m[0].length
    }
    if (last < s.length) tokens.push(s.slice(last))
    return tokens
  }

  const oldTokens = tokenize(oldText)
  const newTokens = tokenize(newText)
  const m = oldTokens.length, n = newTokens.length

  // DP 求 LCS
  const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = oldTokens[i - 1] === newTokens[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }

  // 回溯构建分段
  const segments = []
  let i = m, j = n
  const stack = []
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldTokens[i - 1] === newTokens[j - 1]) {
      stack.push({ type: 'same', text: oldTokens[i - 1] })
      i--; j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      stack.push({ type: 'added', text: newTokens[j - 1] })
      j--
    } else {
      stack.push({ type: 'removed', text: oldTokens[i - 1] })
      i--
    }
  }
  // 合并连续的相同类型
  const result = []
  for (const seg of stack.reverse()) {
    const lastIdx = result.length - 1
    if (lastIdx >= 0 && result[lastIdx].type === seg.type) {
      result[lastIdx].text += seg.text
    } else {
      result.push({ ...seg })
    }
  }
  return result
}

/** 内联差异文本渲染：wordDiff 分段数组 → 逐段着色 */
function InlineDiffText({ text, side, inlineDiff }) {
  if (!inlineDiff) {
    return (
      <span className={side === 'old' ? 'text-red-300/80' : 'text-green-300/80'}>
        {valToText(text)}
      </span>
    )
  }
  return (
    <span className="whitespace-pre-wrap break-words font-mono leading-relaxed">
      {inlineDiff.map((seg, i) => {
        if (seg.type === 'same')
          return <span key={i} className="text-surface-400/70">{seg.text}</span>
        if (side === 'old' && seg.type === 'removed')
          return <span key={i} className="text-red-300 bg-red-500/20 rounded px-0.5">{seg.text}</span>
        if (side === 'new' && seg.type === 'added')
          return <span key={i} className="text-green-300 bg-green-500/20 rounded px-0.5">{seg.text}</span>
        return null
      })}
    </span>
  )
}

/** 归并 skill_table 子路径的差异为一条表格差异 */
function mergeSkillTableDiffs(diffs) {
  const merged = []
  const tableGroups = {}

  for (const d of diffs) {
    // 匹配 .skills[N].skill_table.rows[...] 或 .skills[N].skill_table（整表变化）
    const match = d.path.match(/^(.*\.skill_table)(\.|$)/)
    if (match) {
      const prefix = match[1]
      if (!tableGroups[prefix]) {
        tableGroups[prefix] = { idx: merged.length }
        merged.push({ __tableDiff: true, path: prefix, subDiffs: [] })
      }
      merged[tableGroups[prefix].idx].subDiffs.push(d)
    } else {
      merged.push(d)
    }
  }
  return merged
}

/** 对比两个 skill_table rows 数组，返回变化信息 */
function compareSkillRows(extRows, curRows) {
  const changedCells = new Set()   // "ri-ci" 格式，ri 在各自的 rows 数组中的索引
  const rowStatus = new Map()      // ri → 'modified' | 'added' | 'removed'
  const labelChanged = new Set()   // ri — label 不同的行

  // 阶段一：按 label 精确匹配
  const curByLabel = new Map()
  curRows.forEach((r, i) => { if (r.label) curByLabel.set(r.label, i) })
  const matchedExt = new Set()
  const matchedCur = new Set()

  for (let ei = 0; ei < extRows.length; ei++) {
    const extRow = extRows[ei]
    const ci = curByLabel.get(extRow.label)
    if (ci !== undefined && !matchedCur.has(ci)) {
      matchedExt.add(ei)
      matchedCur.add(ci)
      const curRow = curRows[ci]
      // 逐值对比
      const maxVals = Math.max(extRow.values?.length || 0, curRow.values?.length || 0)
      let hasDiff = false
      for (let vi = 0; vi < maxVals; vi++) {
        if (extRow.values?.[vi] !== curRow.values?.[vi]) {
          changedCells.add(`${ei}-${vi}`)
          changedCells.add(`${ci}-${vi}`)
          hasDiff = true
        }
      }
      if (hasDiff) {
        rowStatus.set(ei, 'modified')
        rowStatus.set(ci, 'modified')
      }
    }
  }

  // 阶段二：未匹配的行按位置索引 fallback（处理 label 被修改等场景）
  const maxLen = Math.max(extRows.length, curRows.length)
  for (let i = 0; i < maxLen; i++) {
    const extRow = extRows[i]
    const curRow = curRows[i]
    const extUnmatched = extRow && !matchedExt.has(i)
    const curUnmatched = curRow && !matchedCur.has(i)

    if (extUnmatched && curUnmatched) {
      // 位置匹配：label 不同但在同一位置 → 修改（label 可能变了）
      matchedExt.add(i)
      matchedCur.add(i)
      rowStatus.set(i, 'modified')
      if (extRow.label !== curRow.label) {
        labelChanged.add(i)
      }
      // 逐值对比
      const maxVals = Math.max(extRow.values?.length || 0, curRow.values?.length || 0)
      for (let vi = 0; vi < maxVals; vi++) {
        if (extRow.values?.[vi] !== curRow.values?.[vi]) {
          changedCells.add(`${i}-${vi}`)
        }
      }
    } else if (extUnmatched) {
      // extRows 中独有的行 → old 侧为 removed
      rowStatus.set(i, 'removed')
      for (let vi = 0; vi < (extRow.values?.length || 0); vi++) {
        changedCells.add(`${i}-${vi}`)
      }
    } else if (curUnmatched) {
      // curRows 中独有的行 → new 侧为 added
      rowStatus.set(i, 'added')
      for (let vi = 0; vi < (curRow.values?.length || 0); vi++) {
        changedCells.add(`${i}-${vi}`)
      }
    }
  }

  return { changedCells, rowStatus, labelChanged }
}

/** 技能倍率表格差异（优先从 diff 子项的值中提取数据） */
function SkillTableDiffView({ diff, extData, curData, itemId, side }) {
  // 1) 从 diff.subDiffs 的值中提取完整 skill_table JSON
  let skillTableObj = null
  for (const sd of (diff.subDiffs || [])) {
    const val = side === 'old' ? sd.oldVal : sd.newVal
    // 尝试解析为完整表格
    const parsed = safeParse(val)
    if (parsed && Array.isArray(parsed.rows)) {
      skillTableObj = parsed
      break
    }
    // 若 val 是字符串且不含 rows，可能只是个单元格值，跳过
  }

  // 2) 从关联表获取天赋名称（仅用于显示标题）
  const skillMatch = diff.path.match(/\.skills\[(\d+)\]/)
  const skillIdx = skillMatch ? parseInt(skillMatch[1]) : -1
  const getTalent = (data, idx) => {
    const talents = (data?.character_talents || [])
      .filter(r => r.character_id == itemId)
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
    return talents[idx] || null
  }

  // 3) fallback：如果 diff 值中找不到完整表格，尝试从数据库获取
  if (!skillTableObj) {
    const t = getTalent(side === 'old' ? extData : curData, skillIdx)
    const st = safeParse(t?.skill_table)
    if (st && Array.isArray(st.rows)) skillTableObj = st
  }

  // 获取两个数据库中的天赋记录（需在 displayRows 前声明）
  const extTalent = getTalent(extData, skillIdx)
  const curTalent = getTalent(curData, skillIdx)
  const extSK = safeParse(extTalent?.skill_table)
  const curSK = safeParse(curTalent?.skill_table)
  const extRows = (extSK?.rows || [])
  const curRows = (curSK?.rows || [])

  const talentName = (side === 'old' ? extTalent : curTalent)?.name_zh || ''
  // 使用当前 side 对应的 rows 渲染
  const displayRows = side === 'old' ? extRows : curRows
  if (!displayRows.length) return null

  // 4) 计算变化的单元格、行状态、标签变化
  let changedCells, rowStatus, labelChanged
  // 判断 subDiffs 中是否有细粒度的 rows[N] 路径
  const hasGranularDiffs = diff.subDiffs?.some(sd => /rows\[\d+\]/.test(sd.path))
  if (hasGranularDiffs) {
    // 细粒度差异：从 subDiffs 逐条提取
    changedCells = new Set()
    rowStatus = new Map()
    labelChanged = new Set()
    for (const sd of (diff.subDiffs || [])) {
      const cellMatch = sd.path.match(/rows\[(\d+)\]\.values\[(\d+)\]/)
      if (cellMatch) {
        changedCells.add(`${cellMatch[1]}-${cellMatch[2]}`)
      } else {
        const rowMatch = sd.path.match(/rows\[(\d+)\]/)
        if (rowMatch) {
          for (let ci = 0; ci < Math.max(extRows[rowMatch[1]]?.values?.length || 0, curRows[rowMatch[1]]?.values?.length || 0); ci++) {
            changedCells.add(`${rowMatch[1]}-${ci}`)
          }
          rowStatus.set(parseInt(rowMatch[1]), 'modified')
        }
      }
    }
  } else {
    // 整体变化：全面对比两个 rows 数组
    const result = compareSkillRows(extRows, curRows)
    changedCells = result.changedCells
    rowStatus = result.rowStatus
    labelChanged = result.labelChanged
  }

  const maxLevels = Math.max(
    ...extRows.map(r => (r.values || []).length),
    ...curRows.map(r => (r.values || []).length),
    1
  )
  const cellColor = side === 'old' ? 'text-red-300/80' : 'text-green-300/80'
  const bgColor = side === 'old' ? 'bg-red-950/30' : 'bg-green-950/30'

  return (
    <div className="mt-1">
      {talentName && (
        <p className="text-[10px] text-surface-400 mb-1 font-medium">{talentName}</p>
      )}
      <div className="overflow-x-auto rounded border border-white/5">
        <table className="text-[10px] border-collapse w-full min-w-[200px]">
          <thead>
            <tr className="bg-surface-700/40">
              <th className="sticky left-0 py-1 px-2 text-left font-medium border border-surface-700 whitespace-nowrap bg-surface-800 z-[5]"
                style={{ boxShadow: '2px 0 4px rgba(0,0,0,0.4)' }}></th>
              {Array.from({ length: maxLevels }, (_, i) => (
                <th key={i} className={`py-1 px-1.5 text-center font-medium border border-surface-700 whitespace-nowrap ${side === 'old' ? 'text-red-400/60' : 'text-green-400/60'}`}>
                  Lv.{i + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayRows.map((row, ri) => {
              const status = rowStatus?.get(ri)
              const isRemoved = status === 'removed'
              const isAdded = status === 'added'
              const isModified = status === 'modified'

              // 行级别样式
              let rowTrClass = ''
              if (isRemoved) rowTrClass = 'border-red-500/40 bg-red-950/40'
              else if (isAdded) rowTrClass = 'border-green-500/40 bg-green-950/40'
              else if (isModified) rowTrClass = side === 'old' ? 'border-red-500/30 bg-red-950/20' : 'border-green-500/30 bg-green-950/20'

              // label 单元格样式
              let labelTdClass = 'sticky left-0 py-1 px-2 border border-surface-700 font-medium whitespace-nowrap z-[5]'
              if (isRemoved) labelTdClass += ' text-red-300 bg-red-950/50'
              else if (isAdded) labelTdClass += ' text-green-300 bg-green-950/50'
              else if (isModified) labelTdClass += side === 'old' ? ' text-red-300 bg-red-950/40' : ' text-green-300 bg-green-950/40'
              else labelTdClass += ' text-surface-300 bg-surface-900'

              return (
                <tr key={ri} className={rowTrClass}>
                  <td className={`${labelTdClass}${labelChanged?.has(ri) ? (side === 'old' ? ' ring-2 ring-inset ring-red-400/60' : ' ring-2 ring-inset ring-amber-400/60') : ''}`}
                    style={{ boxShadow: '2px 0 4px rgba(0,0,0,0.4)' }}>
                    {row.label}
                  </td>
                  {Array.from({ length: maxLevels }, (_, ci) => {
                    const v = row.values?.[ci]
                    const changed = changedCells?.has(`${ri}-${ci}`)
                    const displayVal = (v === undefined || v === null) ? '—' : String(v)
                    return (
                      <td key={ci} className={`px-1.5 py-1 text-center border border-surface-700 whitespace-nowrap ${cellColor} ${bgColor} ${
                        changed ? (side === 'old' ? 'ring-2 ring-inset ring-red-400/60 bg-red-500/20' : 'ring-2 ring-inset ring-green-400/60 bg-green-500/20') : ''
                      }`}>
                        {displayVal}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
function safeParse(v) {
  if (typeof v === 'object' && v !== null) return v
  if (typeof v !== 'string') return null
  try { return JSON.parse(v) } catch { return null }
}

/** 检测值是否为 skill_table 对象 { rows: [{ label, values }] } */
function isSkillTable(val) {
  if (!val || typeof val !== 'object' || Array.isArray(val)) return false
  const obj = typeof val === 'string' ? safeParse(val) : val
  if (!obj || !Array.isArray(obj.rows) || obj.rows.length === 0) return false
  return obj.rows.every(r => r && typeof r.label === 'string' && Array.isArray(r.values))
}

/** 只读倍率表格组件 */
function SkillTableReadonly({ data, side }) {
  const st = typeof data === 'string' ? safeParse(data) : data
  const rows = st?.rows || []
  if (!rows.length) return null
  // 取最长行的列数
  const maxLevels = Math.max(...rows.map(r => (r.values || []).length))
  const cellColor = side === 'old' ? 'text-red-300/80' : 'text-green-300/80'
  const bgColor = side === 'old' ? 'bg-red-950/30' : 'bg-green-950/30'

  return (
    <div className="overflow-x-auto mt-1 rounded border border-white/5">
      <table className="text-[10px] border-collapse w-full min-w-[200px]">
        <thead>
          <tr className="bg-surface-700/40">
            <th className="sticky left-0 py-1 px-2 text-left font-medium border border-surface-700 whitespace-nowrap bg-surface-800 z-[5]"
              style={{ boxShadow: '2px 0 4px rgba(0,0,0,0.4)' }}></th>
            {Array.from({ length: maxLevels }, (_, i) => (
              <th key={i} className={`py-1 px-1.5 text-center font-medium border border-surface-700 whitespace-nowrap ${side === 'old' ? 'text-red-400/60' : 'text-green-400/60'}`}>
                Lv.{i + 1}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              <td className="sticky left-0 py-1 px-2 text-surface-300 border border-surface-700 font-medium whitespace-nowrap bg-surface-900 z-[5]"
                style={{ boxShadow: '2px 0 4px rgba(0,0,0,0.4)' }}>
                {row.label}
              </td>
              {row.values.map((v, ci) => (
                <td key={ci} className={`px-1.5 py-1 text-center border border-surface-700 whitespace-nowrap ${cellColor} ${bgColor}`}>
                  {v || '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ═══════════════════════════════════════
// 主组件
// ═══════════════════════════════════════
export default function HourglassApp() {
  const [view, setView] = useState('home')        // home | result | detail
  const [resultTab, setResultTab] = useState('characters') // 对比结果当前分类 Tab（提升到父级，跨详情页保持）
  const [extDbName, setExtDbName] = useState('')   // 导入文件名
  const [extData, setExtData] = useState(null)      // 导入的数据库数据
  const [curData, setCurData] = useState(null)      // 当前数据库数据
  const [loading, setLoading] = useState(false)
  const [diffResult, setDiffResult] = useState(null) // 对比结果
  const [selectedItem, setSelectedItem] = useState(null) // 选中的差异条目
  const [dragOver, setDragOver] = useState(false)
  const dropRef = useRef(null)

  // 执行对比
  const runComparison = useCallback(async () => {
    if (!extData) return
    setLoading(true)
    try {
      // 读取当前基准库数据
      const cur = await window.electronAPI?.hourglassReadCurrentDb()
      if (!cur) { setLoading(false); return }

      setCurData(cur)

      // 对比主表 + 关联表
      const tables = ['characters', 'weapons', 'artifacts']
      const tableLabels = { characters: '角色', weapons: '武器', artifacts: '圣遗物' }
      const subTables = ['character_talents', 'character_constellations', 'character_related_effects', 'character_outfits']
      const subTableLabels = {
        character_talents: '天赋', character_constellations: '命之座',
      }
      const result = {}

      // 圣遗物来源关联（炼武秘境标点 tooltip.artifacts）索引，供圣遗物对比使用
      const extLinkIndex = buildSourceLinkIndex(extData.map_marker_placements, extData.map_markers)
      const curLinkIndex = buildSourceLinkIndex(cur.map_marker_placements, cur.map_markers)

      for (const table of tables) {
        const extRows = extData[table] || []
        const curRows = cur[table] || []
        const extMap = {}
        for (const r of extRows) if (r.id) extMap[r.id] = r
        const curMap = {}
        for (const r of curRows) if (r.id) curMap[r.id] = r

        const commonIds = Object.keys(extMap).filter(id => id in curMap)
        const items = []
        for (const id of commonIds) {
          // 主表对比，过滤 strip 后无差异的项和元数据字段
          const diffs = compareRecords(extMap[id], curMap[id])
            .filter(d => {
              const leafField = d.path.split('.').pop()
              if (METADATA_FIELDS.includes(leafField)) return false
              if (typeof d.oldVal !== 'string' || typeof d.newVal !== 'string') return true
              if (JSON_STRING_FIELDS.has(leafField)) return d.oldVal !== d.newVal
              return stripFormatTags(d.oldVal) !== stripFormatTags(d.newVal)
            })

          // 关联表对比（角色天赋、命之座）
          for (const sub of subTables) {
            const extSubs = (extData[sub] || [])
              .filter(r => r.character_id == id)
              .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
            const curSubs = (cur[sub] || [])
              .filter(r => r.character_id == id)
              .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
            const maxLen = Math.max(extSubs.length, curSubs.length)
            for (let i = 0; i < maxLen; i++) {
              const extSub = extSubs[i] || {}
              const curSub = curSubs[i] || {}
              const prefixMap = {
                character_talents: 'skills',
                character_constellations: 'constellations',
                character_related_effects: 'relatedEffects',
                character_outfits: 'outfits',
              }
              const prefix = `.${prefixMap[sub] || sub}[${i}]`
              const subDiffs = compareRecords(extSub, curSub)
                .filter(d => {
                  const leafField = d.path.split('.').pop()
                  if (METADATA_FIELDS.includes(leafField)) return false
                  if (typeof d.oldVal !== 'string' || typeof d.newVal !== 'string') return true
                  if (JSON_STRING_FIELDS.has(leafField)) return d.oldVal !== d.newVal
                  return stripFormatTags(d.oldVal) !== stripFormatTags(d.newVal)
                })
              for (const d of subDiffs) {
                diffs.push({ ...d, path: prefix + d.path })
              }
            }
          }

          // 圣遗物来源关联标点对比（新增/移除/改名，以关联标点的自定义名称呈现）
          if (table === 'artifacts') {
            diffs.push(...buildSourceLinkDiffs(
              extLinkIndex.get(Number(id)) || [],
              curLinkIndex.get(Number(id)) || [],
            ))
          }

          if (diffs.length > 0) {
            // 提取可读名称
            let name = id
            const row = curMap[id] || extMap[id]
            if (row?.name_zh) name = row.name_zh

            // 提取图片字段
            let imageFile = null
            if (table === 'characters') {
              imageFile = curMap[id]?.card_art || curMap[id]?.splash_art || null
            } else if (table === 'weapons') {
              imageFile = curMap[id]?.simple_art || null
            } else if (table === 'artifacts') {
              imageFile = curMap[id]?.flower_image || curMap[id]?.circlet_image || null
            }

            items.push({ id, name, diffs, count: diffs.length, imageFile, table })
          }
        }
        items.sort((a, b) => b.count - a.count)
        result[table] = { label: tableLabels[table], items, total: items.length }
      }
      setDiffResult(result)
      setResultTab('characters') // 新对比默认从角色分类开始
      setView('result')
    } catch (e) {
      console.error('[Hourglass] comparison error:', e)
    }
    setLoading(false)
  }, [extData])

  // extData 更新后自动执行对比
  useEffect(() => {
    if (extData) {
      runComparison()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extData])

  // 导入数据库：通过对话框
  const handleImport = useCallback(async () => {
    try {
      const data = await window.electronAPI?.hourglassSelectAndReadDb()
      if (!data) return
      setExtData(data)
      setExtDbName('导入数据库')
    } catch (e) {
      console.error('[Hourglass] import error:', e)
    }
  }, [])

  // 导入数据库：通过拖拽
  const handleDrop = useCallback(async (e) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
    const file = e.dataTransfer?.files?.[0]
    let filePath = file?.path || e.dataTransfer?.getData('text/plain') || null
    if (!filePath) return
    // 只接受 .db 文件
    if (!filePath.endsWith('.db') && !filePath.endsWith('.sqlite')) return
    try {
      const data = await window.electronAPI?.hourglassReadExternalDb(filePath)
      if (!data) return
      const name = filePath.split('/').pop() || filePath.split('\\').pop() || '导入数据库'
      setExtData(data)
      setExtDbName(name)
    } catch (e) {
      console.error('[Hourglass] drop error:', e)
    }
  }, [])

  const handleDragOver = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
  }, [])

  // 进入详情
  const handleSelectItem = useCallback((table, item) => {
    setResultTab(table) // 记录从哪个分类进入，返回时回到该分类
    setSelectedItem({ table, ...item })
    setView('detail')
  }, [])

  // 返回
  const handleBack = useCallback(() => {
    if (view === 'detail') { setView('result'); setSelectedItem(null) }
    else if (view === 'result') { setView('home'); setDiffResult(null); setExtData(null); setCurData(null) }
  }, [view])

  if (view === 'detail' && selectedItem) {
    return (
      <DetailView
        item={selectedItem}
        extData={extData}
        curData={curData}
        extDbName={extDbName}
        onBack={handleBack}
      />
    )
  }

  if (view === 'result' && diffResult) {
    return (
      <ResultView
        diffResult={diffResult}
        extDbName={extDbName}
        activeTab={resultTab}
        onTabChange={setResultTab}
        onSelectItem={handleSelectItem}
        onBack={handleBack}
        onReimport={handleImport}
        loading={loading}
      />
    )
  }

  // 首页
  return (
    <div className="h-full flex flex-col bg-gradient-to-br from-indigo-950/60 via-surface-950 to-violet-950/60">
      {/* 标题栏 */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-white/5 shrink-0">
        <div className="w-8 h-8 rounded-lg bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center">
          <Hourglass className="w-4 h-4 text-indigo-400" />
        </div>
        <h2 className="text-sm font-semibold text-white">时之沙 · 基准库对比</h2>
      </div>

      {/* 沙漏主区域 */}
      <div
        ref={dropRef}
        className="flex-1 flex flex-col items-center justify-center gap-6 p-6 overflow-auto"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* ── SVG 沙漏 ── */}
        <div className="relative w-64 h-80 shrink-0">
          <svg viewBox="0 0 256 320" className="w-full h-full drop-shadow-2xl">
            {/* 沙漏外框 */}
            <defs>
              <linearGradient id="topGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.6" />
                <stop offset="100%" stopColor="#7c3aed" stopOpacity="0.3" />
              </linearGradient>
              <linearGradient id="bottomGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.4" />
                <stop offset="100%" stopColor="#d97706" stopOpacity="0.7" />
              </linearGradient>
              <linearGradient id="sandStream" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.8" />
                <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.8" />
              </linearGradient>
              <filter id="glow">
                <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
                <feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge>
              </filter>
            </defs>

            {/* 沙漏边框 */}
            <path
              d="M48 8 L208 8 L176 160 L208 312 L48 312 L80 160 Z"
              fill="none"
              stroke="rgba(255,255,255,0.12)"
              strokeWidth="3"
              strokeLinejoin="round"
            />
            <path
              d="M48 8 L208 8 L176 160 L208 312 L48 312 L80 160 Z"
              fill="none"
              stroke="rgba(255,255,255,0.06)"
              strokeWidth="1"
              strokeLinejoin="round"
            />

            {/* 上半部（导入数据库）— 紫色半透明 */}
            <path
              d={extData
                ? "M56 16 L200 16 L172 148 L84 148 Z"
                : "M56 16 L200 16 L172 148 L84 148 Z"
              }
              fill="url(#topGrad)"
              opacity={extData ? 0.8 : 0.3}
              stroke="rgba(167,139,250,0.3)"
              strokeWidth="1"
            />

            {/* 上半部无数据时的虚线网格 */}
            {!extData && (
              <g opacity="0.15">
                {[0,1,2,3,4,5].map(i => (
                  <line key={`hg-${i}`} x1={80 + i*16} y1={30} x2={60 + i*20} y2={140} stroke="#a78bfa" strokeWidth="0.5" strokeDasharray="2,3" />
                ))}
              </g>
            )}

            {/* 上半部标签 */}
            <text x="128" y="80" textAnchor="middle" fill="rgba(255,255,255,0.5)" fontSize="11" fontFamily="sans-serif">
              {extData ? (extDbName.length > 12 ? extDbName.slice(0,12)+'…' : extDbName) : ''}
            </text>

            {/* 沙漏腰部 — 细颈 */}
            <rect x="116" y="148" width="24" height="24" rx="4" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.1)" strokeWidth="1" />

            {/* 流动沙粒动画 */}
            {loading && (
              <>
                <circle cx="128" cy="160" r="3" fill="#c084fc" filter="url(#glow)">
                  <animate attributeName="cy" values="156;172" dur="1.2s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="1;0.3" dur="1.2s" repeatCount="indefinite" />
                </circle>
                <circle cx="128" cy="160" r="2" fill="#fbbf24">
                  <animate attributeName="cy" values="156;172" dur="1.2s" begin="0.4s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="1;0.3" dur="1.2s" begin="0.4s" repeatCount="indefinite" />
                </circle>
                <circle cx="128" cy="160" r="2.5" fill="#a78bfa">
                  <animate attributeName="cy" values="156;172" dur="1.2s" begin="0.8s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="1;0.3" dur="1.2s" begin="0.8s" repeatCount="indefinite" />
                </circle>
              </>
            )}

            {/* 下半部（当前基准库）— 琥珀色半透明 */}
            <path
              d="M84 172 L172 172 L200 304 L56 304 Z"
              fill="url(#bottomGrad)"
              opacity={0.7}
              stroke="rgba(245,158,11,0.3)"
              strokeWidth="1"
            />

            {/* 下半部标签 */}
            <text x="128" y="248" textAnchor="middle" fill="rgba(255,255,255,0.6)" fontSize="11" fontFamily="sans-serif">
              当前基准库
            </text>

            {/* 装饰点：四角 */}
            {[
              [48, 8], [208, 8], [48, 312], [208, 312]
            ].map(([cx, cy], i) => (
              <circle key={`dot-${i}`} cx={cx} cy={cy} r="4" fill="rgba(255,255,255,0.15)" />
            ))}
          </svg>

          {/* 覆盖在沙漏上半部的导入按钮 */}
          {!extData && !loading && (
            <button
              onClick={handleImport}
              className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2
                         flex items-center gap-2 px-5 py-2.5 rounded-xl
                         bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/30
                         text-indigo-300 text-sm font-medium transition-all
                         hover:scale-105 active:scale-95 shadow-lg"
            >
              <Upload className="w-4 h-4" />
              导入基准库
            </button>
          )}

          {/* 已导入后的重新导入按钮 */}
          {extData && !loading && (
            <button
              onClick={handleImport}
              className="absolute top-[22%] left-1/2 -translate-x-1/2
                         px-3 py-1.5 rounded-lg
                         bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/20
                         text-indigo-400 text-[11px] font-medium transition-all
                         hover:scale-105"
            >
              重新导入
            </button>
          )}
        </div>

        {/* ── 拖拽提示 ── */}
        {!extData && !loading && (
          <div
            className={`w-full max-w-md px-6 py-4 rounded-xl border-2 border-dashed text-center transition-all ${
              dragOver
                ? 'border-indigo-400 bg-indigo-500/10'
                : 'border-surface-600/50 hover:border-surface-500/70 bg-surface-900/30'
            }`}
          >
            <FileSpreadsheet className="w-6 h-6 mx-auto mb-2 opacity-40" />
            <p className="text-xs text-surface-500">
              或将基准库 <span className="text-indigo-400 font-medium">.db</span> 文件拖拽到此处
            </p>
          </div>
        )}

        {/* ── 加载中状态 ── */}
        {loading && (
          <div className="flex items-center gap-3 text-surface-400 text-sm">
            <Loader2 className="w-5 h-5 animate-spin text-indigo-400" />
            正在读取并对比数据…
          </div>
        )}

        {/* ── 底部提示 ── */}
        <p className="text-[10px] text-surface-600 text-center max-w-md leading-relaxed">
          导入一个基准库与当前使用的基准库进行差异对比。
          仅对比两者共有的角色、武器、圣遗物条目信息。
        </p>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════
// 条目缩略图（从数据库图片加载）
// ═══════════════════════════════════════
function ItemThumb({ imageFile, fallback, className }) {
  const [src, setSrc] = useState(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!imageFile) { setError(true); return }
    let cancelled = false
    setError(false)
    setSrc(null)
    window.electronAPI?.readImage(imageFile).then(res => {
      if (!cancelled && res?.data) setSrc(res.data)
      else if (!cancelled) setError(true)
    }).catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [imageFile])

  if (error || !imageFile) {
    return (
      <div className={`${className} bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center`}>
        {fallback || <Database className="w-4 h-4 text-indigo-400" />}
      </div>
    )
  }

  if (!src) {
    return <div className={`${className} bg-surface-700/50 animate-pulse`} />
  }

  return <img src={src} alt="" className={`${className} object-cover`} />
}

// ═══════════════════════════════════════
// 差异列表视图
// ═══════════════════════════════════════
function ResultView({ diffResult, extDbName, activeTab, onTabChange, onSelectItem, onBack, onReimport, loading }) {
  const tabs = [
    { key: 'characters', label: '角色', icon: '🎭' },
    { key: 'weapons', label: '武器', icon: '⚔️' },
    { key: 'artifacts', label: '圣遗物', icon: '💎' },
  ]
  const currentTab = diffResult[activeTab]

  return (
    <div className="h-full flex flex-col bg-gradient-to-br from-indigo-950/40 via-surface-950 to-violet-950/40">
      {/* 头部 */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-white/5 shrink-0">
        <button onClick={onBack} className="p-1 rounded-md text-surface-400 hover:text-white hover:bg-white/10 transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1">
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <Hourglass className="w-4 h-4 text-indigo-400" />
            对比结果
          </h2>
          <p className="text-[10px] text-surface-500 mt-0.5">
            {extDbName} ↔ 当前基准库
          </p>
        </div>
        <button
          onClick={onReimport}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30
                     border border-indigo-500/30 text-indigo-300 text-xs font-medium transition-colors
                     disabled:opacity-50"
        >
          <Upload className="w-3 h-3" />
          重新导入
        </button>
      </div>

      {/* Tab 栏 */}
      <div className="flex gap-1 px-4 py-2 border-b border-white/5 shrink-0">
        {tabs.map(tab => {
          const info = diffResult[tab.key]
          const count = info?.total || 0
          return (
            <button
              key={tab.key}
              onClick={() => onTabChange(tab.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                activeTab === tab.key
                  ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                  : 'text-surface-400 hover:text-surface-200 hover:bg-white/5 border border-transparent'
              }`}
            >
              <span>{tab.icon}</span>
              {tab.label}
              {count > 0 && (
                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                  activeTab === tab.key ? 'bg-indigo-500/30 text-indigo-300' : 'bg-surface-700 text-surface-400'
                }`}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* 列表 */}
      <div className="flex-1 overflow-auto p-4">
        {!currentTab || currentTab.items.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-surface-500">
            <CheckCircle className="w-12 h-12 mb-3 text-green-500/50" />
            <p className="text-sm text-green-400/70">完全一致</p>
            <p className="text-[11px] mt-1 opacity-60">该类别下没有发现差异</p>
          </div>
        ) : (
          <div className="grid gap-2">
            {currentTab.items.map(item => (
              <button
                key={item.id}
                onClick={() => onSelectItem(activeTab, item)}
                className="w-full text-left p-3.5 rounded-xl bg-surface-800/50 border border-white/5
                           hover:bg-surface-800 hover:border-indigo-500/20 transition-all group"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <ItemThumb
                      imageFile={item.imageFile}
                      className="w-8 h-8 rounded-lg shrink-0"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-surface-200 truncate">{item.name || item.id}</p>
                      <p className="text-[11px] text-surface-500 mt-0.5">{item.count} 处差异</p>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-surface-500 group-hover:text-indigo-400 transition-colors shrink-0 ml-2" />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════
// 详情视图（左右对比）
// ═══════════════════════════════════════
function DetailView({ item, extData, curData, extDbName, onBack }) {
  const leftScrollRef = useRef(null)
  const rightScrollRef = useRef(null)
  const alignMouseDown = useRef({ x: 0, y: 0 })
  const [hoveredDiffIndex, setHoveredDiffIndex] = useState(null)

  const handleAlignMouseDown = useCallback((e) => {
    alignMouseDown.current = { x: e.clientX, y: e.clientY }
  }, [])

  const handleAlignClick = useCallback((e, sourceRef, targetRef) => {
    // 鼠标按下到松开移动超过 3px → 拖选文本，不触发对齐
    const dx = Math.abs(e.clientX - alignMouseDown.current.x)
    const dy = Math.abs(e.clientY - alignMouseDown.current.y)
    if (dx > 3 || dy > 3) return

    const idx = e.currentTarget.getAttribute('data-diff-index')
    if (idx == null || !sourceRef.current || !targetRef.current) return

    const sourceCard = sourceRef.current.querySelector(`[data-diff-index="${idx}"]`)
    const targetCard = targetRef.current.querySelector(`[data-diff-index="${idx}"]`)
    if (!sourceCard || !targetCard) return

    // 源卡片在可视区内的偏移 = 卡片 offsetTop - 源容器当前 scrollTop
    const sourceVisualTop = sourceCard.offsetTop - sourceRef.current.scrollTop
    // 目标卡片在目标容器内的绝对位置
    const targetAbsoluteTop = targetCard.offsetTop
    // 目标容器需要滚动到的位置，使得目标卡片的视觉偏移 = 源卡片视觉偏移
    const targetScroll = targetAbsoluteTop - sourceVisualTop

    targetRef.current.scrollTo({ top: Math.max(0, targetScroll), behavior: 'smooth' })
  }, [])

  // 获取两个数据库中该条目的完整数据
  const table = item.table
  const extRows = extData?.[table] || []
  const curRows = curData?.[table] || []
  const extRecord = extRows.find(r => r.id === item.id)
  const curRecord = curRows.find(r => r.id === item.id)

  const diffs = item.diffs || []
  // 归并 skill_table 子差异为表格差异
  const mergedDiffs = mergeSkillTableDiffs(diffs)
  // 预处理：对每对字符串计算词级差异，过滤 strip 后无差异的项
  const processedDiffs = mergedDiffs
    .map(d => {
      if (d.__tableDiff) return d
      // JSON 字符串字段跳过 stripFormatTags，直接使用原始值
      const leafField = d.path.split('.').pop()
      const rawOld = d.oldVal
      const rawNew = d.newVal
      const oldStr = JSON_STRING_FIELDS.has(leafField) ? rawOld : (typeof rawOld === 'string' ? stripFormatTags(rawOld) : rawOld)
      const newStr = JSON_STRING_FIELDS.has(leafField) ? rawNew : (typeof rawNew === 'string' ? stripFormatTags(rawNew) : rawNew)
      const inlineDiff = (typeof oldStr === 'string' && typeof newStr === 'string')
        ? wordDiff(oldStr, newStr)
        : null
      return { ...d, oldStr, newStr, inlineDiff }
    })
    .filter(d => {
      if (d.__tableDiff) return d.subDiffs && d.subDiffs.length > 0
      return d.oldStr !== d.newStr
    })

  return (
    <div className="h-full flex flex-col bg-gradient-to-br from-indigo-950/40 via-surface-950 to-violet-950/40">
      {/* 头部 */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-white/5 shrink-0">
        <button onClick={onBack} className="p-1 rounded-md text-surface-400 hover:text-white hover:bg-white/10 transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-white truncate">{item.name || item.id}</h2>
          <p className="text-[10px] text-surface-500">{item.count} 处差异</p>
        </div>
      </div>

      {/* 左右对比主体 */}
      <div className="flex-1 flex min-h-0">
        {/* 左列：导入数据库 */}
        <div className="flex-1 flex flex-col min-w-0 border-r border-white/5">
          <div className="px-4 py-2 bg-indigo-500/10 border-b border-white/5 shrink-0">
            <p className="text-[11px] font-medium text-indigo-300 truncate flex items-center gap-1.5">
              <Database className="w-3 h-3" />
              {extDbName || '导入库'}
            </p>
          </div>
          <div ref={leftScrollRef} className="flex-1 overflow-auto p-3 space-y-2">
            {processedDiffs.map((diff, i) => (
              <div
                key={i}
                data-diff-index={i}
                onClick={(e) => handleAlignClick(e, leftScrollRef, rightScrollRef)}
                onMouseDown={handleAlignMouseDown}
                onMouseEnter={() => setHoveredDiffIndex(i)}
                onMouseLeave={() => setHoveredDiffIndex(null)}
                className={`rounded-lg bg-surface-800/30 border p-2.5 cursor-default transition-all ${
                  hoveredDiffIndex === i
                    ? 'border-indigo-400/50 ring-1 ring-indigo-400/40'
                    : 'border-white/5'
                }`}
              >
                <p className="text-[10px] text-red-400/70 font-mono mb-1 break-all">{formatPath(diff.path)}</p>
                {diff.__tableDiff ? (
                  <SkillTableDiffView
                    diff={diff}
                    extData={extData}
                    curData={curData}
                    itemId={item.id}
                    side="old"
                  />
                ) : (
                <div className="bg-red-950/30 rounded px-2 py-1.5">
                  {isSimple(diff.oldVal) ? (
                    <InlineDiffText text={stripFormatTags(diff.oldVal)} side="old" inlineDiff={diff.inlineDiff} />
                  ) : isSkillTable(diff.oldVal) ? (
                    <SkillTableReadonly data={diff.oldVal} side="old" />
                  ) : (
                    <pre className="text-[10px] text-red-300/80 overflow-x-auto">{JSON.stringify(diff.oldVal, null, 1)}</pre>
                  )}
                </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* 右列：当前基准库 */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="px-4 py-2 bg-amber-500/10 border-b border-white/5 shrink-0">
            <p className="text-[11px] font-medium text-amber-300 truncate flex items-center gap-1.5">
              <Database className="w-3 h-3" />
              当前基准库
            </p>
          </div>
          <div ref={rightScrollRef} className="flex-1 overflow-auto p-3 space-y-2">
            {processedDiffs.map((diff, i) => (
              <div
                key={i}
                data-diff-index={i}
                onClick={(e) => handleAlignClick(e, rightScrollRef, leftScrollRef)}
                onMouseDown={handleAlignMouseDown}
                onMouseEnter={() => setHoveredDiffIndex(i)}
                onMouseLeave={() => setHoveredDiffIndex(null)}
                className={`rounded-lg bg-surface-800/30 border p-2.5 cursor-default transition-all ${
                  hoveredDiffIndex === i
                    ? 'border-indigo-400/50 ring-1 ring-indigo-400/40'
                    : 'border-white/5'
                }`}
              >
                <p className="text-[10px] text-green-400/70 font-mono mb-1 break-all">{formatPath(diff.path)}</p>
                {diff.__tableDiff ? (
                  <SkillTableDiffView
                    diff={diff}
                    extData={extData}
                    curData={curData}
                    itemId={item.id}
                    side="new"
                  />
                ) : (
                <div className="bg-green-950/30 rounded px-2 py-1.5">
                  {isSimple(diff.newVal) ? (
                    <InlineDiffText text={stripFormatTags(diff.newVal)} side="new" inlineDiff={diff.inlineDiff} />
                  ) : isSkillTable(diff.newVal) ? (
                    <SkillTableReadonly data={diff.newVal} side="new" />
                  ) : (
                    <pre className="text-[10px] text-green-300/80 overflow-x-auto">{JSON.stringify(diff.newVal, null, 1)}</pre>
                  )}
                </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── AI 助手：只读 SQL 校验器 ──
// 数据库 AI 通过 query_database 工具查询本程序数据库时，只允许执行只读语句，
// 防止模型生成 INSERT/UPDATE/DELETE/DROP 等写操作破坏数据。

const MAX_ROWS = 500              // 单次查询最大返回行数
const MAX_CELL_CHARS = 500        // 单单元格默认最大字符数（超出截断）
const MAX_CELL_CHARS_REQUEST = 20000 // 模型可通过 max_cell_chars 申请的单格上限
const MAX_RESULT_CHARS = 150000   // 单次查询结果总字符量上限（防止超大结果塞爆上下文/内存）

/**
 * 校验并规范化 AI 生成的查询语句。
 * 通过校验后返回可执行的 SQL（自动补充 LIMIT 上限）；不通过则抛出错误。
 */
function validateAiQuery(sql) {
  if (!sql || typeof sql !== 'string') throw new Error('SQL 为空')
  const trimmed = sql.trim()
  if (!trimmed) throw new Error('SQL 为空')

  // 禁止多语句拼接（去除结尾分号后检查是否还有分号；字符串字面量内的分号不算）
  const withoutTrailing = trimmed.replace(/;\s*$/, '')
  const noStringsSemi = withoutTrailing.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""')
  if (noStringsSemi.includes(';')) throw new Error('仅允许单条查询语句')

  // 去掉字符串字面量后再做关键字检查，避免 '...update...' 之类误伤
  const noStrings = noStringsSemi
  const upper = noStrings.toUpperCase()

  const allowed = /^(SELECT|WITH|PRAGMA|EXPLAIN)\b/.test(upper.trim())
  if (!allowed) throw new Error('仅允许只读查询（SELECT / WITH / PRAGMA / EXPLAIN）')

  const banned = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|ATTACH|DETACH|VACUUM|REINDEX|GRANT|REVOKE|TRUNCATE|PRAGMA\s+\w+\s*=\s*\w+)\b/.test(upper)
  if (banned) throw new Error('查询包含写操作关键字，已拒绝')

  // 自动补充行数上限（用户数据表查询可控）
  let final = withoutTrailing
  if (/^(SELECT|WITH)\b/.test(upper.trim()) && !/\bLIMIT\b/i.test(withoutTrailing)) {
    final = withoutTrailing + ' LIMIT ' + MAX_ROWS
  }
  return final
}

/**
 * 对查询结果做体积保护：截断行数与超长单元格。
 * @param {Array} rows 查询结果行
 * @param {number} [maxCellChars] 单格字符上限（默认 500，最大 MAX_CELL_CHARS_REQUEST）
 * @returns {{ rows: Array, cellTruncated: boolean }}
 */
function capQueryRows(rows, maxCellChars) {
  const limit = Math.max(1, Math.min(Number(maxCellChars) || MAX_CELL_CHARS, MAX_CELL_CHARS_REQUEST))
  const sliced = (rows || []).slice(0, MAX_ROWS)
  let cellTruncated = false
  const out = sliced.map(row => {
    const o = {}
    for (const key of Object.keys(row || {})) {
      const v = row[key]
      if (typeof v === 'string' && v.length > limit) {
        o[key] = v.slice(0, limit) + '…'
        cellTruncated = true
      } else {
        o[key] = v
      }
    }
    return o
  })
  // 总量保护：结果总字符数超限时丢弃尾部行（至少保留 1 行）
  let totalChars = 0
  let sizeTruncated = false
  for (let i = 0; i < out.length; i++) {
    let rowChars = 0
    for (const key of Object.keys(out[i] || {})) {
      rowChars += typeof out[i][key] === 'string' ? out[i][key].length : 8
    }
    if (i > 0 && totalChars + rowChars > MAX_RESULT_CHARS) {
      out.length = i
      sizeTruncated = true
      break
    }
    totalChars += rowChars
  }
  return { rows: out, cellTruncated, sizeTruncated }
}

module.exports = { validateAiQuery, capQueryRows, MAX_ROWS, MAX_CELL_CHARS, MAX_CELL_CHARS_REQUEST, MAX_RESULT_CHARS }

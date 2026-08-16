// ── AI 助手：API 消息构建与工具定义（独立模块便于测试）──

const MAX_HISTORY = 30

// ── 工具定义：数据库只读查询 ──
export const DB_TOOL = {
  type: 'function',
  function: {
    name: 'query_database',
    description: '对本地数据库执行只读 SQL 查询（仅允许 SELECT / WITH / PRAGMA / EXPLAIN）。数据库包含角色、武器、圣遗物、材料、元素反应、游戏机制、祈愿记录、备忘录、收支记录等表，用户修改过的数据已自动合并。单次查询最多返回 500 行；超长单元格（如 character_talents.skill_table 等 JSON 字段）默认截断为 500 字符，需要完整内容时通过 max_cell_chars 申请更大的单格上限（最大 20000）。',
    parameters: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: '只读 SQL 语句，例如：SELECT name_zh, rarity FROM characters LIMIT 10' },
        explain: { type: 'string', description: '用一句话说明这次查询的目的（显示给用户看）' },
        max_cell_chars: { type: 'integer', description: '可选。单格内容最大字符数，默认 500，最大 20000。读取 skill_table 等长 JSON 字段时建议设为 5000~20000，避免数据被截断。' },
      },
      required: ['sql'],
    },
  },
}

/**
 * 组装发给 LLM 的消息（含系统提示词 + 表结构 + 历史 + 工具调用链）。
 * convMessages 可包含带 toolCalls/toolResults 的 assistant 消息，
 * 它们会被展开为 assistant(tool_calls) + tool 结果消息，保证多轮工具查询的上下文完整。
 */
function isToolCallAssistant(m) {
  if (!m || m.role !== 'assistant') return false
  const tc = m.tool_calls || m.toolCalls
  return Array.isArray(tc) && tc.length > 0
}

/**
 * 组装发给 LLM 的消息（含系统提示词 + 表结构 + 历史 + 工具调用链）。
 * convMessages 可包含带 toolCalls/toolResults 的 assistant 消息，
 * 它们会被展开为 assistant(tool_calls) + tool 结果消息，保证多轮工具查询的上下文完整。
 * 截断时保证 tool 消息与其 assistant(tool_calls) 配对不被拆散，孤儿 tool 会被过滤。
 */
export function buildApiMessages(convMessages, userText, systemPrompt, schema, defaultSystemPrompt) {
  const schemaBlock = schema
    ? '\n\n数据库表结构（只读查询可用，用户修改自动合并）：\n' + schema
    : ''
  const msgs = [{ role: 'system', content: (systemPrompt || defaultSystemPrompt || '') + schemaBlock }]

  // 数量截断：最多保留最近 MAX_HISTORY 条；若起点是 tool 消息，向前扩展包含其配对的 assistant(tool_calls)
  const arr = Array.isArray(convMessages) ? convMessages : []
  let start = Math.max(0, arr.length - MAX_HISTORY)
  if (start < arr.length && arr[start] && arr[start].role === 'tool') {
    let j = start - 1
    while (j >= 0 && !isToolCallAssistant(arr[j])) j--
    if (j >= 0) start = j
  }
  const history = arr.slice(start)

  let lastWasToolCallAssistant = false
  for (const m of history) {
    if (!m || typeof m !== 'object') continue
    if (m.role === 'user') {
      msgs.push({ role: 'user', content: m.content })
      lastWasToolCallAssistant = false
    } else if (m.role === 'assistant') {
      // 配对完整性：toolResults 必须覆盖每个 tool_call_id，否则降级为普通 assistant 消息，
      // 避免发送带 tool_calls 却缺少 tool 响应导致 API 400
      const resultsOk = Array.isArray(m.toolResults) && m.toolCalls.every(tc =>
        m.toolResults.some(tr => tr && tr.tool_call_id === tc.id)
      )
      if (isToolCallAssistant(m) && resultsOk) {
        msgs.push({
          role: 'assistant',
          content: m.content || null,
          tool_calls: m.toolCalls.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.arguments } })),
        })
        lastWasToolCallAssistant = true
        for (const tr of m.toolResults) {
          msgs.push({ role: 'tool', tool_call_id: tr.tool_call_id, content: tr.content })
        }
      } else {
        msgs.push({ role: 'assistant', content: m.content })
        lastWasToolCallAssistant = false
      }
    } else if (m.role === 'tool') {
      // 孤儿 tool（前面没有 assistant(tool_calls)）：丢弃，避免 API 400
      if (!lastWasToolCallAssistant) continue
      msgs.push({ role: 'tool', tool_call_id: m.tool_call_id, content: m.content })
    }
  }
  if (userText) msgs.push({ role: 'user', content: userText })
  return msgs
}

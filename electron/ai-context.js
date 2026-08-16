// ── AI 助手：上下文裁剪（独立模块便于测试）──
// 保证发送给 LLM 的消息：顺序正确（最旧在前）、system 始终保留、
// tool 消息与其配对的 assistant(tool_calls) 不被截断拆散。

/**
 * 判断消息是否为带 tool_calls 的 assistant 消息。
 * 兼容两种格式：
 * - 渲染端展开后的 API 格式：tool_calls（下划线）
 * - 内部会话格式：toolCalls（驼峰）
 */
function isToolCallAssistant(m) {
  if (!m || m.role !== 'assistant') return false
  const tc = m.tool_calls || m.toolCalls
  return Array.isArray(tc) && tc.length > 0
}

/**
 * 数量截断：保留最近 max 条，若起点是 tool 消息则向前扩展包含其配对的 assistant(tool_calls)。
 * arr 不包含 system。
 */
function sliceKeepingPairs(arr, max) {
  let start = Math.max(0, arr.length - max)
  if (start < arr.length && arr[start] && arr[start].role === 'tool') {
    let j = start - 1
    while (j >= 0 && !isToolCallAssistant(arr[j])) j--
    if (j >= 0) start = j
  }
  return arr.slice(start)
}

/**
 * 裁剪上下文。
 * @param {Array} messages 原始消息数组（可含 system）
 * @param {object} [opts]
 * @param {number} [opts.maxMessages] 最大消息数（默认 60）
 * @param {number} [opts.maxChars] 总字符预算（默认 1500000）
 * @returns {Array} 裁剪后的消息（保持原顺序；system 在最前；无孤儿 tool）
 */
function trimContext(messages, opts = {}) {
  const maxMessages = opts.maxMessages || 60
  const maxChars = opts.maxChars || 1500000
  const arr = Array.isArray(messages) ? messages : []
  if (arr.length === 0) return []

  // 1) system 单独取出（角色设定永不裁剪）
  const sysMsg = arr.find(m => m && m.role === 'system') || null
  const others = sysMsg ? arr.filter(m => m !== sysMsg) : arr.slice()

  // 2) 数量截断（含配对保护）
  let sliced = sliceKeepingPairs(others, maxMessages)

  // 3) 字符预算裁剪：从最旧开始丢，配对边界处强制保留 assistant
  const rest = [] // 从后往前收集，最后反转
  let ctxChars = 0
  for (let i = sliced.length - 1; i >= 0; i--) {
    const m = sliced[i]
    const len = typeof m?.content === 'string' ? m.content.length : (JSON.stringify(m) || '').length
    if (rest.length > 0 && ctxChars + len > maxChars) {
      // 配对保护：已保留的最旧是 tool，而这条是其 assistant(tool_calls) → 必须包含
      const oldestKept = rest[rest.length - 1]
      if (oldestKept && oldestKept.role === 'tool' && isToolCallAssistant(m)) {
        ctxChars += len
        rest.push(m)
        continue
      }
      break
    }
    ctxChars += len
    rest.push(m)
  }
  rest.reverse()

  // 4) 组装：system + rest，过滤仍可能存在的孤儿 tool
  const result = []
  if (sysMsg) result.push(sysMsg)
  let lastWasToolCallAssistant = false
  for (const m of rest) {
    if (m && m.role === 'tool') {
      if (!lastWasToolCallAssistant) continue // 孤儿 tool：丢弃
      result.push(m)
    } else {
      result.push(m)
      lastWasToolCallAssistant = isToolCallAssistant(m)
    }
  }
  return result
}

module.exports = { trimContext, isToolCallAssistant, sliceKeepingPairs }

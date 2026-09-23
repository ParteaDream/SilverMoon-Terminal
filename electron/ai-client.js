// ── AI 助手：LLM 流式客户端（纯 Node，无 Electron 依赖，便于测试）──
// 使用 OpenAI 兼容接口（DeepSeek / OpenAI / 自定义），SSE 流式返回。

/**
 * 供应商默认 API 根地址（渲染端 src/utils/aiProviders.js 中的展示配置与此对应）
 */
const PROVIDER_DEFAULTS = {
  deepseek: 'https://api.deepseek.com',
  chatgpt: 'https://api.openai.com/v1',
}

function resolveBaseUrl(provider, baseUrl) {
  const url = (baseUrl || PROVIDER_DEFAULTS[provider] || '').trim()
  if (!url) throw new Error('未配置 API 地址')
  return url.replace(/\/+$/, '')
}

function buildChatUrl(provider, baseUrl) {
  return resolveBaseUrl(provider, baseUrl) + '/chat/completions'
}

// ── 模型能力判定（2026-09 现状，新增模型名时同步这里）──
// · o 系列 / GPT-5 / GPT-6 推理模型：只认 max_completion_tokens，不接受自定义 temperature
// · GPT-6 Astra：推理无法关闭（不支持 reasoning_effort=none），因此也不能自定义 temperature
// · GPT-5.6 起：/chat/completions 上「推理 + tools」互斥，官方给的绕法是 reasoning_effort='none'
const RE_NO_TEMPERATURE = /^o[1-9]|^gpt-[6-9]/
const RE_COMPLETION_TOKENS = /^o[1-9]|^gpt-[5-9]/
const RE_TOOLS_NEED_NO_REASONING = /^gpt-5\.[6-9]/
// OpenAI 拒绝「推理 + 工具」时的报错特征（见错误码文档与 Azure reasoning 文档）
const RE_TOOL_REASONING_ERROR = /function tools with reasoning_effort are not supported/i
// 运行中学会的模型（如 gpt-6-astra 报同类错误时），后续请求直接按绕法发
const _needsNoReasoningForTools = new Set()

// OpenAI 推理模型（o 系列 / GPT-5 / GPT-6）与 deepseek-reasoner 不接受 temperature 参数
function supportsTemperature(model) {
  const m = String(model || '').toLowerCase()
  if (m === 'deepseek-reasoner') return false
  if (RE_NO_TEMPERATURE.test(m)) return false
  return true
}

// OpenAI 新一代模型（o 系列 / GPT-5 / GPT-6 系列）使用 max_completion_tokens 而非 max_tokens
function usesCompletionTokens(model) {
  return RE_COMPLETION_TOKENS.test(String(model || '').toLowerCase())
}

// 带 tools 时是否需要把推理关掉（/chat/completions 不支持「推理 + 函数工具」）
function needsNoReasoningForTools(model) {
  const m = String(model || '').toLowerCase()
  return RE_TOOLS_NEED_NO_REASONING.test(m) || _needsNoReasoningForTools.has(m)
}

/** 组装请求体（去掉不支持的字段） */
function buildBody({ model, messages, temperature, stream, tools }) {
  const body = { model, messages, stream: !!stream }
  if (supportsTemperature(model) && temperature != null) body.temperature = temperature
  if (Array.isArray(tools) && tools.length > 0) {
    body.tools = tools
    // 本程序始终带数据库查询工具，推理模型在 /chat/completions 上会直接 400，
    // 按官方绕法显式关闭推理（gpt-5.6 系列文档明确，gpt-6 系列按报错学习）
    if (needsNoReasoningForTools(model)) body.reasoning_effort = 'none'
  }
  // 限制单轮输出长度，防止模型无限输出拖垮渲染进程与上下文
  if (usesCompletionTokens(model)) {
    body.max_completion_tokens = 8192
  } else {
    body.max_tokens = 8192
  }
  return body
}

/**
 * 发送 /chat/completions。若模型以「Function tools with reasoning_effort are not
 * supported」拒绝请求，则按官方文档关掉推理重试一次，并记住该模型。
 * @returns {{ resp: Response, text?: string }} text 存在时响应体已被读出，调用方不要再读
 */
async function postChat(url, apiKey, body, signal) {
  const send = (b) => fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
    body: JSON.stringify(b),
    signal,
  })
  let resp = await send(body)
  if (resp.ok) return { resp }
  const text = await resp.text().catch(() => '')
  if (body.tools && body.reasoning_effort === undefined && RE_TOOL_REASONING_ERROR.test(text)) {
    _needsNoReasoningForTools.add(String(body.model || '').toLowerCase())
    resp = await send({ ...body, reasoning_effort: 'none' })
    return { resp }
  }
  return { resp, text }
}

/**
 * 非流式单次对话（用于"测试连接"等场景）
 * @returns {{ ok: true, content: string, raw: object } | { ok: false, error: string, status?: number }}
 */
async function chatOnce({ provider, baseUrl, apiKey, model, messages, temperature, signal, tools }) {
  if (!apiKey) return { ok: false, error: '未配置 API Key' }
  const url = buildChatUrl(provider, baseUrl)
  let resp, preText
  try {
    const r = await postChat(url, apiKey, buildBody({ model, messages, temperature, stream: false, tools }), signal)
    resp = r.resp
    preText = r.text
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? '请求已取消' : '网络请求失败: ' + e.message }
  }
  const rawText = preText !== undefined ? preText : await resp.text().catch(() => '')
  if (!resp.ok) return { ok: false, error: describeHttpError(resp.status, rawText), status: resp.status }
  try {
    const json = JSON.parse(rawText)
    const content = json?.choices?.[0]?.message?.content || ''
    return { ok: true, content: String(content), raw: json }
  } catch (e) {
    return { ok: false, error: '响应解析失败: ' + e.message }
  }
}

/**
 * 流式对话。通过 onChunk 回调逐段返回增量文本，最终 resolve 完整结果。
 * @param {object} opts
 * @param {string} opts.provider 'deepseek' | 'chatgpt' | 'custom'
 * @param {string} opts.baseUrl 自定义地址（custom 必填）
 * @param {string} opts.apiKey
 * @param {string} opts.model
 * @param {Array}  opts.messages OpenAI 消息数组
 * @param {number} [opts.temperature]
 * @param {Array}  [opts.tools] 工具定义（function calling）
 * @param {AbortSignal} [opts.signal]
 * @param {(text: string) => void} [opts.onChunk] 增量文本回调
 * @param {(event: {type: string, data?: any}) => void} [opts.onEvent] 扩展事件（reasoning 等）
 * @returns {Promise<{ content: string, toolCalls: Array<{id:string,name:string,arguments:string}>, aborted: boolean, error?: string }>}
 */
async function streamChat({ provider, baseUrl, apiKey, model, messages, temperature, tools, signal, onChunk, onEvent }) {
  const result = { content: '', toolCalls: [], aborted: false }
  if (!apiKey) return { ...result, error: '未配置 API Key' }
  const url = buildChatUrl(provider, baseUrl)

  let resp, preText
  try {
    const r = await postChat(url, apiKey, buildBody({ model, messages, temperature, stream: true, tools }), signal)
    resp = r.resp
    preText = r.text
  } catch (e) {
    if (e.name === 'AbortError') { result.aborted = true; return result }
    return { ...result, error: '网络请求失败: ' + e.message }
  }

  if (!resp.ok) {
    const rawText = preText !== undefined ? preText : await resp.text().catch(() => '')
    return { ...result, error: describeHttpError(resp.status, rawText) }
  }
  if (!resp.body) return { ...result, error: '响应流不可用' }

  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let streamDone = false

  while (!streamDone) {
    let chunk
    try {
      chunk = await reader.read()
    } catch (e) {
      if (e.name === 'AbortError') { result.aborted = true; return result }
      return { ...result, error: '读取响应流失败: ' + e.message }
    }
    if (chunk.done) break
    buffer += decoder.decode(chunk.value, { stream: true })

    const lines = buffer.split('\n')
    buffer = lines.pop()
    for (const line of lines) {
      const t = line.trim()
      if (!t.startsWith('data:')) continue
      const data = t.slice(5).trim()
      if (data === '[DONE]') { streamDone = true; break }
      if (!data) continue
      let json
      try { json = JSON.parse(data) } catch (_) { continue }
      const choice = json?.choices?.[0]
      const delta = choice?.delta
      if (delta?.reasoning_content) {
        onEvent?.({ type: 'reasoning', data: delta.reasoning_content })
      }
      if (delta?.content) {
        result.content += delta.content
        onChunk?.(delta.content)
      }
      if (Array.isArray(delta?.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0
          if (!result.toolCalls[idx]) result.toolCalls[idx] = { id: '', name: '', arguments: '' }
          if (tc.id) result.toolCalls[idx].id = tc.id
          if (tc.function?.name) result.toolCalls[idx].name = tc.function.name
          if (tc.function?.arguments) result.toolCalls[idx].arguments += tc.function.arguments
        }
      }
      if (choice?.finish_reason) {
        result.finishReason = choice.finish_reason
      }
    }
  }

  // 处理流结束时缓冲区中残留的最后一行（无换行结尾）
  if (buffer.trim()) {
    const t = buffer.trim()
    if (t.startsWith('data:')) {
      const data = t.slice(5).trim()
      if (data && data !== '[DONE]') {
        try {
          const json = JSON.parse(data)
          const delta = json?.choices?.[0]?.delta
          if (delta?.reasoning_content) onEvent?.({ type: 'reasoning', data: delta.reasoning_content })
          if (delta?.content) {
            result.content += delta.content
            onChunk?.(delta.content)
          }
          if (Array.isArray(delta?.tool_calls)) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0
              if (!result.toolCalls[idx]) result.toolCalls[idx] = { id: '', name: '', arguments: '' }
              if (tc.id) result.toolCalls[idx].id = tc.id
              if (tc.function?.name) result.toolCalls[idx].name = tc.function.name
              if (tc.function?.arguments) result.toolCalls[idx].arguments += tc.function.arguments
            }
          }
        } catch (_) {}
      }
    }
  }
  return result
}

/** 将 HTTP 错误响应转成可读错误信息 */
function describeHttpError(status, rawText) {
  let detail = ''
  try {
    const json = JSON.parse(rawText)
    detail = json?.error?.message || json?.message || ''
  } catch (_) {
    detail = rawText ? String(rawText).slice(0, 300) : ''
  }
  const statusText = status === 401 ? 'API Key 无效或未授权' :
    status === 402 ? '账户余额不足' :
    status === 403 ? '无访问权限' :
    status === 404 ? '接口地址不存在（请检查 API 地址/模型名）' :
    status === 429 ? '请求过于频繁（限流）' :
    status >= 500 ? '服务端错误' : '请求失败'
  return status + ' ' + statusText + (detail ? '：' + detail : '')
}

module.exports = { streamChat, chatOnce, buildChatUrl, resolveBaseUrl, PROVIDER_DEFAULTS, supportsTemperature, usesCompletionTokens, needsNoReasoningForTools, buildBody, describeHttpError }

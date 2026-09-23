#!/usr/bin/env node
/**
 * AI 供应商连通性 / 模型名存活探针。
 *
 * 每次供应商更新模型名后跑一次，确认「设置界面里列出的模型名」在真实接口上
 * 仍然可用（含流式输出与函数调用）。会消耗极少量 token。
 *
 *   node scripts/probe-ai-models.mjs [--provider=deepseek|chatgpt]
 *
 * API Key 读取顺序：环境变量（DEEPSEEK_API_KEY / OPENAI_API_KEY）
 *   → 本机 user.json 的 aiSettings.providers[provider].apiKey
 * 未配置 Key 的供应商会被跳过；Key 不会被打印。
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ai = require('../electron/ai-client.js')

const argOf = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d }
const only = argOf('provider', '')

// 渲染端配置（纯 ESM，用 data: URL 加载）
const src = fs.readFileSync(new URL('../src/utils/aiProviders.js', import.meta.url), 'utf8')
const { AI_PROVIDERS } = await import(`data:text/javascript;base64,${Buffer.from(src).toString('base64')}`)

const USER_JSON_CANDIDATES = [
  '/Users/stargomia/Files/GenshinWikiData/user.json',
  path.join(process.env.HOME || '', 'Library/Application Support/silvermoon-terminal/user.json'),
]
function storedProviderCfg(providerId) {
  for (const p of USER_JSON_CANDIDATES) {
    try {
      const cfg = JSON.parse(fs.readFileSync(p, 'utf8'))
      const c = cfg?.aiSettings?.providers?.[providerId]
      if (c) return c
    } catch (_) {}
  }
  return null
}

const ENV_KEYS = { deepseek: 'DEEPSEEK_API_KEY', chatgpt: 'OPENAI_API_KEY' }

const TOOL = [{
  type: 'function',
  function: {
    name: 'query_database',
    description: '对本地数据库执行只读 SQL 查询',
    parameters: { type: 'object', properties: { sql: { type: 'string' } }, required: ['sql'] },
  },
}]

async function probeModel({ provider, baseUrl, apiKey, model }) {
  const out = { provider, model, chat: null, stream: null, tools: null }
  const messages = [{ role: 'user', content: '只回答两个字：收到' }]

  // 1) 非流式：确认模型名可用
  const once = await ai.chatOnce({ provider, baseUrl, apiKey, model, messages, temperature: 0.7 })
  out.chat = once.ok
    ? { ok: true, reply: String(once.content).slice(0, 40), servedAs: once.raw?.model }
    : { ok: false, error: once.error }

  // 2) 流式：确认 SSE 增量可用（应用主路径）
  let chunks = 0
  const streamed = await ai.streamChat({
    provider, baseUrl, apiKey, model, messages, temperature: 0.7,
    onChunk: () => { chunks++ },
  })
  out.stream = streamed.error ? { ok: false, error: streamed.error }
    : { ok: true, chunks, content: streamed.content.slice(0, 40) }

  // 3) 函数调用：应用的数据库查询工具依赖它
  const tooled = await ai.streamChat({
    provider, baseUrl, apiKey, model,
    messages: [{ role: 'user', content: '用 query_database 工具查询 characters 表的前 3 行。' }],
    temperature: 0.7, tools: TOOL,
  })
  out.tools = tooled.error ? { ok: false, error: tooled.error }
    : { ok: true, toolCalls: tooled.toolCalls.map(t => t.name) }
  return out
}

let failed = 0
for (const p of AI_PROVIDERS) {
  if (p.id === 'custom') continue
  if (only && p.id !== only) continue
  const cfg = storedProviderCfg(p.id) || {}
  const apiKey = process.env[ENV_KEYS[p.id]] || cfg.apiKey || ''
  const baseUrl = cfg.baseUrl || p.baseUrl
  if (!apiKey) { console.log(`\n## ${p.id}: 未配置 API Key，跳过`); continue }
  console.log(`\n## ${p.id}  (key: ${apiKey.slice(0, 5)}…, baseUrl: ${baseUrl || '(默认)'})`)
  for (const model of p.models) {
    const r = await probeModel({ provider: p.id, baseUrl: cfg.baseUrl || '', apiKey, model })
    const ok = r.chat.ok && r.stream.ok && r.tools.ok
    if (!ok) failed++
    console.log(`  ${ok ? '✓' : '✗'} ${model}  chat=${JSON.stringify(r.chat)} stream=${JSON.stringify(r.stream)} tools=${JSON.stringify(r.tools)}`)
  }
}
console.log(failed === 0 ? '\n全部可用' : `\n${failed} 个模型不可用`)
process.exit(failed === 0 ? 0 : 1)

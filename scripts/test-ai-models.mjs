import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'

// ── 被测模块 ──
// 渲染端：纯 ESM，按仓库惯例用 data: URL 直接加载源码
async function loadEsm(rel) {
  const source = fs.readFileSync(new URL(rel, import.meta.url), 'utf8')
  const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
  return import(url)
}
// 主进程：CommonJS
const require = createRequire(import.meta.url)
const ai = require('../electron/ai-client.js')

const { AI_PROVIDERS, defaultAiSettings, migrateAiSettings, getProvider, retiredModelNames } = await loadEsm('../src/utils/aiProviders.js')

let failures = 0
function test(name, fn) {
  try {
    fn()
    console.log(`  ✓ ${name}`)
  } catch (e) {
    failures++
    console.log(`  ✗ ${name}\n      ${e.message}`)
  }
}
async function testAsync(name, fn) {
  try {
    await fn()
    console.log(`  ✓ ${name}`)
  } catch (e) {
    failures++
    console.log(`  ✗ ${name}\n      ${e.message}`)
  }
}

// 用桩 fetch 跑通「推理 + tools 被拒 → 自动关推理重试」的自愈路径
const TOOL_REASONING_400 = 'Function tools with reasoning_effort are not supported for dz-gpt-6-x in /v1/chat/completions. To use function tools, use /v1/responses or set reasoning_effort to \'none\'.'
function stubFetch(handler) {
  const real = globalThis.fetch
  globalThis.fetch = handler
  return () => { globalThis.fetch = real }
}

const deepseek = getProvider('deepseek')
const openai = getProvider('chatgpt')

console.log('模型清单（2026-09 现状）')
test('DeepSeek 使用当前模型名（deepseek-flash / deepseek-v4-pro）', () => {
  assert.deepEqual(deepseek.models, ['deepseek-flash', 'deepseek-v4-pro'])
  assert.equal(deepseek.defaultModel, 'deepseek-flash')
  assert.ok(deepseek.models.includes(deepseek.defaultModel))
})

test('OpenAI 列出 GPT-6 与 GPT-5.6 三档，默认值在清单内', () => {
  assert.deepEqual(openai.models, ['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'])
  assert.ok(openai.models.includes(openai.defaultModel))
})

test('每个供应商的默认模型都在自己的清单里', () => {
  for (const p of AI_PROVIDERS) {
    if (p.models.length === 0) continue
    assert.ok(p.models.includes(p.defaultModel), `${p.id} 的 defaultModel ${p.defaultModel} 不在 models 中`)
  }
})

test('migrateModelName：旧名/别名迁移到当前名', () => {
  const migrated = migrateAiSettings({
    provider: 'deepseek',
    providers: {
      deepseek: { apiKey: 'k', model: 'deepseek-v4-flash' },
      chatgpt: { apiKey: 'k2', model: 'gpt-5.6' },
      custom: { apiKey: 'k3', baseUrl: 'http://localhost:11434/v1', model: 'deepseek-chat' },
    },
  })
  assert.equal(migrated.providers.deepseek.model, 'deepseek-flash')
  assert.equal(migrated.providers.chatgpt.model, 'gpt-5.6-sol')
  assert.equal(migrated.providers.custom.model, 'deepseek-chat', '自定义供应商的模型名不应被改写')
})

test('migrateModelName：deepseek-chat / deepseek-reasoner 等已下线旧名一并迁移', () => {
  for (const old of ['deepseek-chat', 'deepseek-reasoner', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp', 'DeepSeek-V4-Flash']) {
    const out = migrateAiSettings({ provider: 'deepseek', providers: { deepseek: { apiKey: 'k', model: old } } })
    assert.equal(out.providers.deepseek.model, 'deepseek-flash', `${old} 未迁移`)
  }
})

test('migrateModelName：未登记的模型名保持原样（用户手填的新模型不被吞掉）', () => {
  const out = migrateAiSettings({ provider: 'chatgpt', providers: { chatgpt: { apiKey: 'k', model: 'gpt-7-experimental' } } })
  assert.equal(out.providers.chatgpt.model, 'gpt-7-experimental')
})

test('旧名只做迁移与提示，不混进可选预设', () => {
  // 文档里出现过、但已下线的名字（deepseek-v4-flash / v4-flash-vision-exp）
  const retired = retiredModelNames('deepseek').map(([old]) => old)
  assert.ok(retired.includes('deepseek-v4-flash'))
  assert.ok(retired.includes('deepseek-v4-flash-vision-exp'))
  for (const old of retired) {
    assert.ok(!deepseek.models.includes(old), `${old} 是已下线旧名，不应出现在预设里`)
  }
  assert.ok(retiredModelNames('deepseek').every(([old, now]) => deepseek.models.includes(now)),
    '每个旧名都应指向一个现用模型')
  assert.deepEqual(retiredModelNames('custom'), [])
})

test('defaultAiSettings 使用新模型名', () => {
  const d = defaultAiSettings()
  assert.equal(d.providers.deepseek.model, 'deepseek-flash')
  assert.equal(d.providers.chatgpt.model, 'gpt-5.6-luna')
})

console.log('请求参数能力（electron/ai-client.js）')
test('temperature：GPT-6 / o 系列 / deepseek-reasoner 一律不发', () => {
  for (const m of ['gpt-6-astra', 'gpt-6.1-x', 'o3', 'o4-mini', 'deepseek-reasoner']) {
    assert.equal(ai.supportsTemperature(m), false, `${m} 不应发 temperature`)
  }
  for (const m of ['gpt-5.6-sol', 'gpt-5.6-luna', 'deepseek-flash', 'deepseek-v4-pro', 'gpt-4o-mini']) {
    assert.equal(ai.supportsTemperature(m), true, `${m} 应发 temperature`)
  }
})

test('输出长度参数：GPT-5 / GPT-6 / o 系列用 max_completion_tokens，DeepSeek 仍用 max_tokens', () => {
  for (const m of ['gpt-6-astra', 'gpt-5.6-luna', 'o4-mini']) {
    assert.equal(ai.usesCompletionTokens(m), true, m)
  }
  for (const m of ['deepseek-flash', 'deepseek-v4-pro', 'gpt-4o-mini']) {
    assert.equal(ai.usesCompletionTokens(m), false, m)
  }
})

test('buildBody：gpt-5.6 + tools 自动关闭推理（否则 /chat/completions 直接 400）', () => {
  const body = ai.buildBody({
    model: 'gpt-5.6-luna', messages: [{ role: 'user', content: 'hi' }],
    temperature: 0.7, stream: true, tools: [{ type: 'function', function: { name: 'f' } }],
  })
  assert.equal(body.reasoning_effort, 'none')
  assert.equal(body.temperature, 0.7, '推理关闭后 temperature 可用')
  assert.equal(body.max_completion_tokens, 8192)
  assert.equal(body.max_tokens, undefined)
  assert.ok(Array.isArray(body.tools) && body.tools.length === 1)
})

test('buildBody：gpt-6-astra 不发 temperature，也不带 max_tokens', () => {
  const body = ai.buildBody({
    model: 'gpt-6-astra', messages: [{ role: 'user', content: 'hi' }],
    temperature: 0.7, stream: false, tools: [{ type: 'function', function: { name: 'f' } }],
  })
  assert.equal(body.temperature, undefined, 'GPT-6 不支持自定义 temperature')
  assert.equal(body.max_tokens, undefined)
  assert.equal(body.max_completion_tokens, 8192)
})

test('buildBody：不带 tools 的请求不注入 reasoning_effort', () => {
  const body = ai.buildBody({ model: 'gpt-5.6-sol', messages: [], temperature: 0.3, stream: false })
  assert.equal(body.reasoning_effort, undefined)
  assert.equal(body.temperature, 0.3)
})

test('buildBody：DeepSeek 保持 max_tokens + temperature，不加推理参数', () => {
  const body = ai.buildBody({
    model: 'deepseek-flash', messages: [], temperature: 0.7, stream: true,
    tools: [{ type: 'function', function: { name: 'query_database' } }],
  })
  assert.equal(body.max_tokens, 8192)
  assert.equal(body.max_completion_tokens, undefined)
  assert.equal(body.temperature, 0.7)
  assert.equal(body.reasoning_effort, undefined)
})

test('needsNoReasoningForTools：已知家族直接命中，其它模型留给运行时学习', () => {
  assert.equal(ai.needsNoReasoningForTools('gpt-5.6-sol'), true)
  assert.equal(ai.needsNoReasoningForTools('gpt-5.6-terra'), true)
  assert.equal(ai.needsNoReasoningForTools('gpt-6-astra'), false, 'GPT-6 未证实支持 reasoning_effort=none，先按报错重试')
  assert.equal(ai.needsNoReasoningForTools('deepseek-flash'), false)
})

console.log('自愈重试（桩 fetch）')
await testAsync('带 tools 被拒 → 关推理重试一次，并记住该模型', async () => {
  const calls = []
  const restore = stubFetch(async (_url, init) => {
    calls.push(JSON.parse(init.body))
    if (calls.length === 1) {
      return new Response(JSON.stringify({ error: { message: TOOL_REASONING_400 } }), { status: 400 })
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }], model: 'dz-gpt-6-x' }), { status: 200 })
  })
  try {
    const r = await ai.chatOnce({
      provider: 'chatgpt', baseUrl: '', apiKey: 'k', model: 'dz-gpt-6-x',
      messages: [{ role: 'user', content: 'hi' }], temperature: 0.7,
      tools: [{ type: 'function', function: { name: 'f' } }],
    })
    assert.equal(r.ok, true, `重试后应成功：${r.error}`)
    assert.equal(r.content, 'ok')
    assert.equal(calls.length, 2, '应恰好重试一次')
    assert.equal(calls[0].reasoning_effort, undefined)
    assert.equal(calls[1].reasoning_effort, 'none')
    assert.equal(calls[1].tools.length, 1, '重试请求仍带工具')
    assert.equal(ai.needsNoReasoningForTools('dz-gpt-6-x'), true, '应记住该模型')
  } finally { restore() }
})

await testAsync('记住之后，后续请求直接带 reasoning_effort=none（不再多一次往返）', async () => {
  const calls = []
  const restore = stubFetch(async (_url, init) => {
    calls.push(JSON.parse(init.body))
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 })
  })
  try {
    const r = await ai.chatOnce({
      provider: 'chatgpt', baseUrl: '', apiKey: 'k', model: 'dz-gpt-6-x',
      messages: [], temperature: 0.7, tools: [{ type: 'function', function: { name: 'f' } }],
    })
    assert.equal(r.ok, true)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].reasoning_effort, 'none')
  } finally { restore() }
})

await testAsync('其它错误不重试，原样上报', async () => {
  const calls = []
  const restore = stubFetch(async (_url, init) => {
    calls.push(JSON.parse(init.body))
    return new Response(JSON.stringify({ error: { message: 'Incorrect API key provided' } }), { status: 401 })
  })
  try {
    const r = await ai.chatOnce({
      provider: 'chatgpt', baseUrl: '', apiKey: 'bad', model: 'gpt-5.6-luna',
      messages: [], tools: [{ type: 'function', function: { name: 'f' } }],
    })
    assert.equal(r.ok, false)
    assert.equal(calls.length, 1, '不应重试')
    assert.match(r.error, /API Key 无效或未授权/)
  } finally { restore() }
})

await testAsync('流式路径同样会重试（首包前失败）', async () => {
  const calls = []
  const sse = 'data: {"choices":[{"delta":{"content":"好"}}]}\n\ndata: [DONE]\n\n'
  const restore = stubFetch(async (_url, init) => {
    calls.push(JSON.parse(init.body))
    if (calls.length === 1) return new Response(JSON.stringify({ error: { message: TOOL_REASONING_400 } }), { status: 400 })
    return new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
  })
  try {
    const chunks = []
    const r = await ai.streamChat({
      provider: 'chatgpt', baseUrl: '', apiKey: 'k', model: 'gpt-6-astra',
      messages: [{ role: 'user', content: 'hi' }], temperature: 0.7,
      tools: [{ type: 'function', function: { name: 'f' } }], onChunk: t => chunks.push(t),
    })
    assert.equal(r.error, undefined, `不应报错：${r.error}`)
    assert.equal(r.content, '好')
    assert.equal(chunks.join(''), '好')
    assert.equal(calls.length, 2)
    assert.equal(calls[1].reasoning_effort, 'none')
    assert.equal(calls[0].temperature, undefined, 'GPT-6 不发 temperature')
  } finally { restore() }
})

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)

// ── AI 助手：供应商预设与默认提示词 ──

/** 供应商预设（主进程 electron/ai-client.js 中的 PROVIDER_DEFAULTS 与此对应） */
export const AI_PROVIDERS = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    tagline: '深度求索 · 高性价比推理',
    baseUrl: 'https://api.deepseek.com',
    apiKeyUrl: 'https://platform.deepseek.com/api_keys',
    models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
    defaultModel: 'deepseek-v4-flash',
    gradient: 'from-indigo-500 via-blue-500 to-cyan-400',
    chip: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
    desc: 'DeepSeek 官方 API：deepseek-v4-flash 轻量快速（默认），deepseek-v4-pro 旗舰深度推理，均支持函数调用。',
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    tagline: 'OpenAI 官方接口',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyUrl: 'https://platform.openai.com/api-keys',
    models: ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'],
    defaultModel: 'gpt-5.6-luna',
    gradient: 'from-emerald-500 via-teal-500 to-green-400',
    chip: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    desc: 'OpenAI 官方接口：GPT-5.6 系列（Sol 旗舰 / Terra 均衡 / Luna 轻量），支持函数调用。',
  },
  {
    id: 'custom',
    name: '自定义',
    tagline: '任意 OpenAI 兼容接口',
    baseUrl: '',
    apiKeyUrl: '',
    models: [],
    defaultModel: '',
    gradient: 'from-fuchsia-500 via-purple-500 to-violet-400',
    chip: 'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30',
    desc: '接入任何兼容 OpenAI Chat Completions 协议的接口（如本地 Ollama、其他中转站），需自行填写 API 地址。',
  },
]

export function getProvider(id) {
  return AI_PROVIDERS.find(p => p.id === id) || AI_PROVIDERS[0]
}

/** 默认系统提示词 —— 定位：本地数据库 AI */
export const DEFAULT_SYSTEM_PROMPT = `你是「银月终端」的数据库 AI 助手，一个运行在用户本地终端中的智能体。

你的使命：基于本地数据库回答用户的任何问题。数据库是用户的原神资料库，包含角色、武器、圣遗物、材料、元素反应、游戏机制、祈愿记录、挑战数据、Beta备忘录、北国银行收支、世界树练度分析等各类信息（数据库表结构已随上下文提供，用户修改过的数据会自动合并，你看到的就是用户当前的真实数据）。

核心能力：
- 你可以通过 query_database 工具执行只读 SQL 查询来读取数据库信息（只能查询，不能修改数据）。
- 需要数据时，先规划查询再调用工具，基于真实数据回答；严禁凭空编造数值、倍率或条目。
- 长字段（如 character_talents.skill_table 等 JSON）默认会被截断为 500 字符；需要完整数据时，在查询参数中携带 max_cell_chars（如 5000~20000），不要因为截断就放弃计算。
- 不确定表结构时，可先用查询探测（如 PRAGMA table_info 或 SELECT * ... LIMIT 5）再深入查询。

回答要求：
- 默认使用简体中文，语言简洁、结构清晰，善用 Markdown（标题、列表、表格、代码块）组织内容。
- 严禁使用 LaTeX/数学公式语法（如 $$、\mathbf、\frac、\times 等）；公式请直接用 Unicode 符号书写（× ÷ ≈ ≤ ≥ ± % ² 等），例如：总倍率 = 132.8% + 119.8% + 75.7% × 2 = 761.6%。
- 不要用 * 号代替乘号（会与 Markdown 粗体 ** 混淆，软件会自动隐藏未渲染的 ** 残留）；乘号一律用 ×。
- 正文只输出最终答案，不要把你内部的思考/推理过程写进回答（推理内容如有独立通道会自动折叠展示）。
- 引用数据时注明来源表名，并给出必要的解释。
- 当问题含糊、信息不足、或存在多种可能理解时，主动向用户提问澄清，而不是擅自猜测。
- 查询无结果时如实告知，并建议用户检查数据或换一种问法。
- 只回答与本地数据库内容相关的问题；超出范围时礼貌说明，并引导回数据。
`

/**
 * 默认设置：各供应商配置（API Key / 地址 / 模型）相互独立，存于 providers 分桶；
 * temperature / systemPrompt 为全局行为偏好。
 */
export function defaultAiSettings() {
  return {
    provider: 'deepseek',
    temperature: 0.7,
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    providers: {
      deepseek: { apiKey: '', baseUrl: '', model: 'deepseek-v4-flash' },
      chatgpt: { apiKey: '', baseUrl: '', model: 'gpt-5.6-luna' },
      custom: { apiKey: '', baseUrl: '', model: '' },
    },
  }
}

/**
 * 迁移/归一化 user.json 中读取的 aiSettings：
 * - 新结构：补全缺失的供应商分桶
 * - 旧结构（平铺 apiKey/baseUrl/model）：归入旧 provider 名下，temperature/systemPrompt 保留全局
 */
export function migrateAiSettings(raw) {
  const base = defaultAiSettings()
  if (!raw || typeof raw !== 'object') return base

  const isNew = raw.providers && typeof raw.providers === 'object'
  const validProvider = AI_PROVIDERS.some(p => p.id === raw.provider)
  const providerId = validProvider ? raw.provider : 'deepseek'

  const out = {
    provider: providerId,
    temperature: typeof raw.temperature === 'number' ? raw.temperature : 0.7,
    systemPrompt: typeof raw.systemPrompt === 'string' && raw.systemPrompt ? raw.systemPrompt : DEFAULT_SYSTEM_PROMPT,
    providers: {},
  }
  for (const p of AI_PROVIDERS) {
    const def = base.providers[p.id]
    const stored = isNew && raw.providers[p.id] && typeof raw.providers[p.id] === 'object' ? raw.providers[p.id] : {}
    out.providers[p.id] = {
      apiKey: typeof stored.apiKey === 'string' ? stored.apiKey : '',
      baseUrl: typeof stored.baseUrl === 'string' ? stored.baseUrl : '',
      model: typeof stored.model === 'string' && stored.model ? stored.model : def.model,
    }
  }
  if (!isNew) {
    // 旧结构：平铺字段归入旧 provider
    out.providers[providerId] = {
      apiKey: typeof raw.apiKey === 'string' ? raw.apiKey : '',
      baseUrl: typeof raw.baseUrl === 'string' ? raw.baseUrl : '',
      model: typeof raw.model === 'string' && raw.model ? raw.model : out.providers[providerId].model,
    }
  }
  return out
}

/** 生成新会话 id */
export function newConversationId() {
  return 'ai_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10)
}

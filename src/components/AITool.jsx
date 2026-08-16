import { useState, useEffect, useRef, useCallback, memo } from 'react'
import { createPortal } from 'react-dom'
import {
  Bot, Sparkles, Send, Square, Settings2, Plus, Trash2, MessageSquare, KeyRound,
  Eye, EyeOff, RotateCcw, ChevronLeft, PanelLeft, Database, Check, Loader2, Wand2, Cpu, Link2,
  Copy, Brain, Zap, Server, RefreshCw
} from 'lucide-react'
import AIMarkdown from './AIMarkdown'
import { AI_PROVIDERS, getProvider, DEFAULT_SYSTEM_PROMPT, defaultAiSettings, migrateAiSettings, newConversationId } from '../utils/aiProviders'
import { DB_TOOL, buildApiMessages } from '../utils/aiMessages'

const MAX_TOOL_ROUNDS = 8
const MAX_HISTORY = 30


// ── 工具函数 ──
function fmtTime(ts) {
  if (!ts) return ''
  const d = new Date(ts.replace(' ', 'T'))
  if (isNaN(d.getTime())) return ts
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) {
    return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0')
  }
  const diffDays = Math.floor((now - d) / 86400000)
  if (diffDays === 1) return '昨天'
  if (diffDays < 7) return diffDays + '天前'
  return (d.getMonth() + 1) + '月' + d.getDate() + '日'
}

function genRequestId() {
  return 'ai_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10)
}

function makeMessage(role, content, extra) {
  return { id: 'm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), role, content, createdAt: new Date().toISOString(), ...extra }
}

// ── 主组件 ──
export default function AITool() {
  const [settings, setSettings] = useState(() => defaultAiSettings())
  const [showSettings, setShowSettings] = useState(false)
  const [conversations, setConversations] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [input, setInput] = useState('')
  const [schema, setSchema] = useState('')
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [notice, setNotice] = useState(null)
  const messagesRef = useRef(null)
  const textareaRef = useRef(null)
  const busyRef = useRef(false)
  const abortRef = useRef(null)
  const convRef = useRef(null)
  const streamTextRef = useRef('')
  // 流式渲染节流：chunk 事件只累积到 ref，由 rAF 统一刷新 state，
  // 避免每个 IPC 块触发一次整树重渲染（长回答时会导致卡顿/内存暴涨，且并发渲染中穿插 setState 触发 React 警告）
  const pendingRef = useRef(null)
  const reasoningRef = useRef('')
  const flushRafRef = useRef(null)

  const activeConv = conversations.find(c => c.id === activeId) || null
  const provider = getProvider(settings.provider)
  // 当前供应商的独立配置（API Key / 地址 / 模型）
  const providerCfg = settings.providers?.[settings.provider] || { apiKey: '', baseUrl: '', model: '' }

  // ── 初始化：设置 + 会话 + 表结构 ──
  useEffect(() => {
    (async () => {
      try {
        const res = await window.electronAPI?.getUserConfig()
        if (res?.config?.aiSettings) {
          const migrated = migrateAiSettings(res.config.aiSettings)
          setSettings(migrated)
          // 旧结构（平铺 apiKey）迁移后立即持久化新结构
          window.electronAPI?.setUserConfig('aiSettings', migrated).catch(() => {})
        }
      } catch (_) {}
    })()
    window.electronAPI?.aiLoadConversations().then(list => {
      if (Array.isArray(list)) setConversations(list)
    }).catch(() => {})
    window.electronAPI?.aiGetSchema().then(res => {
      if (res?.success) setSchema(res.schema)
    }).catch(() => {})
  }, [])

  // ── 兜底保存 ──
  const persistRef = useRef(null)
  useEffect(() => {
    persistRef.current = (conv) => {
      if (!conv) return
      window.electronAPI?.aiSaveConversation({ id: conv.id, title: conv.title, messages: conv.messages }).catch(() => {})
    }
  }, [])

  // ── 自动保存（对话内容或标题变化时）──
  useEffect(() => {
    if (!activeConv) return
    const timer = setTimeout(() => persistRef.current?.(activeConv), 400)
    return () => clearTimeout(timer)
  }, [activeConv?.messages?.length, activeConv?.title])

  // ── 卸载兜底：中止请求 + 保存 ──
  useEffect(() => {
    return () => {
      if (flushRafRef.current) cancelAnimationFrame(flushRafRef.current)
      if (busyRef.current && abortRef.current) window.electronAPI?.aiChatAbort(abortRef.current).catch(() => {})
      if (convRef.current) persistRef.current?.(convRef.current)
    }
  }, [])

  // ── 订阅流式事件（节流版）：事件只写 ref，rAF 合帧后统一刷新 ──
  const setPendingState = useCallback((next) => {
    pendingRef.current = next
    setPending(next)
  }, [])

  const scheduleFlush = useCallback(() => {
    if (flushRafRef.current) return
    flushRafRef.current = requestAnimationFrame(() => {
      flushRafRef.current = null
      const p = pendingRef.current
      if (!p) return
      setPendingState({ ...p, text: streamTextRef.current, reasoning: reasoningRef.current })
    })
  }, [setPendingState])

  useEffect(() => {
    const off = window.electronAPI?.onAiChatEvent?.(payload => {
      if (!payload || payload.requestId !== abortRef.current) return
      if (payload.type === 'chunk') streamTextRef.current += payload.text || ''
      else if (payload.type === 'reasoning') reasoningRef.current += payload.text || ''
      scheduleFlush()
    })
    return off
  }, [scheduleFlush])

  // ── 自动滚动到底部 ──
  useEffect(() => {
    const el = messagesRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [pending?.text, pending?.toolRuns?.length, activeId, activeConv?.messages?.length])

  // ── 设置持久化（user.json）：apiKey/baseUrl/model 归属当前供应商分桶，temperature/systemPrompt 为全局 ──
  const BUCKET_KEYS = ['apiKey', 'baseUrl', 'model']
  function updateSettings(patch) {
    setSettings(prev => {
      const next = { ...prev, providers: { ...prev.providers } }
      const pid = next.provider
      for (const [k, v] of Object.entries(patch || {})) {
        if (BUCKET_KEYS.includes(k)) {
          next.providers[pid] = { ...(next.providers[pid] || {}), [k]: v }
        } else {
          next[k] = v
        }
      }
      window.electronAPI?.setUserConfig('aiSettings', next).catch(() => {})
      return next
    })
  }

  // ── 会话操作 ──
  function newChat() {
    if (busy) return
    const conv = { id: newConversationId(), title: '新对话', messages: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    setConversations(prev => [conv, ...prev])
    setActiveId(conv.id)
    convRef.current = conv
    setShowSettings(false)
    setTimeout(() => textareaRef.current?.focus(), 50)
  }

  function selectConversation(id) {
    if (busy) return
    if (convRef.current) persistRef.current?.(convRef.current)
    setActiveId(id)
    setShowSettings(false)
    const conv = conversations.find(c => c.id === id)
    convRef.current = conv || null
  }

  async function deleteConversation(id) {
    if (busy) return
    const conv = conversations.find(c => c.id === id)
    if (conv && conv.messages.length > 0) {
      if (!window.confirm('确定删除该会话？此操作不可撤销。')) return
    }
    await window.electronAPI?.aiDeleteConversation(id).catch(() => {})
    setConversations(prev => prev.filter(c => c.id !== id))
    if (activeId === id) {
      setActiveId(null)
      convRef.current = null
    }
  }
  // ── 发送消息：准备会话后进入对话循环 ──
  async function sendMessage(textOverride) {
    const text = (textOverride ?? input).trim()
    if (!text || busy) return

    let conv = activeConv
    if (!conv) {
      conv = { id: newConversationId(), title: '新对话', messages: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
      setConversations(prev => [conv, ...prev])
      setActiveId(conv.id)
    }
    convRef.current = conv
    const firstMsg = conv.messages.length === 0
    const userMsg = makeMessage('user', text)
    conv.messages = [...conv.messages, userMsg]
    if (firstMsg) conv.title = text.slice(0, 24)
    setConversations(prev => prev.map(c => c.id === conv.id ? conv : c))
    setInput('')
    setNotice(null)
    persistRef.current?.(conv)
    await runChat(conv)
  }

  // ── 对话循环（含数据库工具调用）──
  async function runChat(conv) {
    setBusy(true)
    busyRef.current = true

    let toolRuns = []
    // 当前供应商的请求配置（provider + 分桶 API Key/地址/模型 + 全局温度）
    const requestSettings = { provider: settings.provider, ...providerCfg, temperature: settings.temperature }
    let reasoningAccum = '' // 所有轮次的思考过程累积（提交时保存，供折叠查看）
    // contextMsgs 累积所有轮次（含工具调用链），确保第 N 轮能看到前面所有查询结果
    let contextMsgs = [...conv.messages]
    let apiMessages = buildApiMessages(contextMsgs.slice(0, -1), contextMsgs[contextMsgs.length - 1]?.content || '', settings.systemPrompt, schema, DEFAULT_SYSTEM_PROMPT)
    let finalContent = ''
    let finalToolCalls = null
    let finalToolResults = null
    let wasAborted = false

    try {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const requestId = genRequestId()
        abortRef.current = requestId
        streamTextRef.current = ''
        reasoningRef.current = ''
        setPendingState({ requestId, text: '', toolRuns: [...toolRuns], reasoning: '' })

        const res = await window.electronAPI?.aiChat({ requestId, messages: apiMessages, settings: requestSettings, tools: [DB_TOOL] })
        // 该轮推理内容（reasoningRef 在流式期间累积，invoke 结束后已完整）
        if (reasoningRef.current) reasoningAccum += (reasoningAccum ? '\n\n' : '') + reasoningRef.current
        if (!res || res.error) {
          const err = res?.error || '请求失败'
          setNotice({ type: 'error', text: err })
          finalContent = '❌ ' + err
          break
        }
        if (res.aborted) {
          wasAborted = true
          finalContent = streamTextRef.current
          break
        }

        finalContent = res.content || ''
        const toolCalls = res.toolCalls || []
        finalToolCalls = toolCalls.length ? toolCalls : null
        if (toolCalls.length === 0) break

        // 执行工具调用（数据库只读查询）——单个工具 try/catch，任何异常也产出结果消息，保证与 tool_calls 配对完整
        finalToolResults = []
        for (const tc of toolCalls) {
          let content
          let ok = false
          let rowCount = 0
          let cellCut = false
          try {
            let parsed = {}
            try { parsed = JSON.parse(tc.arguments || '{}') } catch (_) {}
            const sql = String(parsed.sql || '').trim()
            const explain = String(parsed.explain || '查询数据库').slice(0, 120)
            const maxCellChars = Number(parsed.max_cell_chars) > 0 ? Number(parsed.max_cell_chars) : undefined
            toolRuns = [...toolRuns, { id: tc.id, name: tc.name, sql, explain, status: 'running', maxCellChars }]
            setPendingState({ requestId: abortRef.current, text: finalContent, toolRuns: [...toolRuns], reasoning: '' })
            if (!sql) {
              content = JSON.stringify({ error: 'SQL 为空' })
            } else {
              const q = await window.electronAPI?.aiQueryDb(sql, [], maxCellChars ? { maxCellChars } : undefined) || {}
              if (q.error) {
                content = JSON.stringify({ error: q.error })
              } else {
                ok = true
                rowCount = (q.data || []).length
                cellCut = !!q.cellTruncated
                content = JSON.stringify({ rows: q.data, truncated: q.truncated, cellTruncated: q.cellTruncated, sizeTruncated: q.sizeTruncated })
              }
            }
            toolRuns = toolRuns.map(t => t.id === tc.id ? { ...t, status: ok ? 'done' : 'error', rowCount, cellCut } : t)
          } catch (err) {
            // 工具执行异常：仍产出错误结果，保证每个 tool_call 都有响应
            content = JSON.stringify({ error: '工具执行异常: ' + (err?.message || '未知错误') })
            toolRuns = toolRuns.map(t => t.id === tc.id ? { ...t, status: 'error', error: err?.message } : t)
          }
          setPendingState({ requestId: abortRef.current, text: finalContent, toolRuns: [...toolRuns], reasoning: '' })
          finalToolResults.push({ tool_call_id: tc.id, content })
        }

        // 携带工具结果继续下一轮（assistant 消息累积进 contextMsgs，保证后续轮上下文完整）
        const assistantMsg = makeMessage('assistant', finalContent, { toolCalls, toolResults: finalToolResults })
        contextMsgs = [...contextMsgs, assistantMsg]
        apiMessages = buildApiMessages(contextMsgs, '', settings.systemPrompt, schema, DEFAULT_SYSTEM_PROMPT)
      }
    } catch (e) {
      setNotice({ type: 'error', text: '请求出错: ' + (e.message || '未知错误') })
      finalContent = (finalContent || '') + '\n\n> ❌ ' + (e.message || '未知错误')
    }

    // 空回答兜底：模型既没输出文本也没调用工具时给出提示，避免空白气泡
    if (!finalContent.trim() && !finalToolCalls && !wasAborted) {
      finalContent = '⚠️ 模型未生成有效回答，请重试一次或换个问法。'
      setNotice({ type: 'error', text: '模型未生成回答，已提示' })
    }

    // 提交助手消息（回答过长时截断保存，保护数据库与界面）
    const MAX_MSG_CHARS = 200000
    let commitContent = finalContent
    if (commitContent.length > MAX_MSG_CHARS) {
      commitContent = commitContent.slice(0, MAX_MSG_CHARS) + '\n\n> ⚠️ 回答过长，已截断保存'
      setNotice({ type: 'error', text: '回答过长，已截断保存' })
    }
    // 配对完整性兜底：toolResults 必须覆盖每个 tool_call_id，防止残缺历史在下次请求触发 API 400
    const toolCallsFinal = finalToolCalls || []
    const toolResultsFinal = [...(finalToolResults || [])]
    for (const tc of toolCallsFinal) {
      if (!toolResultsFinal.some(tr => tr && tr.tool_call_id === tc.id)) {
        toolResultsFinal.push({ tool_call_id: tc.id, content: JSON.stringify({ error: '工具结果缺失' }) })
      }
    }
    const assistantMsg = makeMessage('assistant', commitContent, {
      toolCalls: toolCallsFinal,
      toolResults: toolResultsFinal,
      reasoning: reasoningAccum ? reasoningAccum.slice(0, 50000) : undefined,
      aborted: wasAborted,
    })
    conv.messages = [...conv.messages, assistantMsg]
    conv.updatedAt = new Date().toISOString()
    setConversations(prev => prev.map(c => c.id === conv.id ? conv : c))
    persistRef.current?.(conv)
    setPendingState(null)
    setBusy(false)
    busyRef.current = false
    abortRef.current = null
    setTimeout(() => textareaRef.current?.focus(), 50)
  }

  // ── 停止生成 ──
  function stopGenerating() {
    if (abortRef.current) {
      window.electronAPI?.aiChatAbort(abortRef.current).catch(() => {})
    }
  }

  // ── 重新生成 ──
  const regenerate = useCallback(async () => {
    if (!activeConv || busy) return
    const last = activeConv.messages[activeConv.messages.length - 1]
    if (!last || last.role !== 'assistant') return
    const userMsg = [...activeConv.messages].reverse().find(m => m.role === 'user')
    if (!userMsg) return
    const conv = { ...activeConv, messages: activeConv.messages.slice(0, -1) }
    setConversations(prev => prev.map(c => c.id === conv.id ? conv : c))
    convRef.current = conv
    await runChat(conv)
  }, [activeConv, busy])

  // ── 复制文本 ──
  const copyText = useCallback(async (text) => {
    try {
      await navigator.clipboard.writeText(text)
      setNotice({ type: 'ok', text: '已复制' })
      setTimeout(() => setNotice(null), 1500)
    } catch (_) {}
  }, [])

  // ── 设置：测试连接 ──
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)
  async function testConnection() {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await window.electronAPI?.aiTestConnection({ provider: settings.provider, ...providerCfg, temperature: settings.temperature })
      if (res?.success) setTestResult({ ok: true, text: '连接成功 · ' + res.model + (res.reply ? ' · ' + res.reply : '') })
      else setTestResult({ ok: false, text: res?.error || '连接失败' })
    } catch (e) {
      setTestResult({ ok: false, text: e.message })
    } finally {
      setTesting(false)
    }
  }

  // ── 输入框自适应高度 ──
  function handleInput(e) {
    setInput(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      sendMessage()
    }
  }
  // ═══════════════ 渲染 ═══════════════
  if (showSettings) {
    return <SettingsView settings={settings} updateSettings={updateSettings} onBack={() => setShowSettings(false)}
      testing={testing} testResult={testResult} testConnection={testConnection}
      onReset={() => { setTestResult(null); updateSettings({ systemPrompt: DEFAULT_SYSTEM_PROMPT }) }} />
  }

  return (
    <div className="h-full flex bg-surface-900/40">
      {/* ── 会话侧栏 ── */}
      {sidebarOpen && (
        <div className="w-52 flex-shrink-0 flex flex-col border-r border-white/5 bg-surface-900/60">
          <div className="p-2.5 border-b border-white/5">
            <button onClick={newChat}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-medium
              bg-gradient-to-r from-primary-600 to-primary-500 text-white shadow-lg shadow-primary-900/30
              hover:brightness-110 active:scale-[0.98] transition-all">
              <Plus className="w-3.5 h-3.5" /> 新对话
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            <div className="px-2 pt-1 pb-1 text-[10px] font-medium text-surface-500 flex items-center gap-1.5">
              <MessageSquare className="w-3 h-3" /> 会话记录 · {conversations.length}
            </div>
            {conversations.length === 0 && (
              <div className="px-3 py-6 text-center text-[11px] text-surface-600">
                暂无会话<br />点击「新对话」开始
              </div>
            )}
            {conversations.map(c => (
              <div key={c.id}
                onClick={() => selectConversation(c.id)}
                className={`group flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer transition-colors ${
                  c.id === activeId ? 'bg-primary-500/15 border border-primary-500/25' : 'hover:bg-white/5 border border-transparent'} ${
                  busy ? 'pointer-events-none opacity-60' : ''}`}>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-surface-200 truncate">{c.title || '新对话'}</p>
                  <p className="text-[10px] text-surface-500 mt-0.5">{c.messages.length} 条 · {fmtTime(c.updatedAt)}</p>
                </div>
                <button onClick={(e) => { e.stopPropagation(); deleteConversation(c.id) }}
                  className="p-1 rounded text-surface-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
          {/* 底部：供应商状态 */}
          <div className="p-2.5 border-t border-white/5">
            <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-white/[0.03]">
              <span className={`w-1.5 h-1.5 rounded-full ${providerCfg.apiKey ? 'bg-emerald-400 shadow-[0_0_6px] shadow-emerald-400/60' : 'bg-amber-400 shadow-[0_0_6px] shadow-amber-400/60'}`} />
              <div className="flex-1 min-w-0">
                <p className="text-[10px] text-surface-300 truncate">{provider.name} · {providerCfg.model || '未选模型'}</p>
                <p className="text-[9px] text-surface-600">{providerCfg.apiKey ? '已配置 API Key' : '未配置 API Key'}</p>
              </div>
              <button onClick={() => setShowSettings(true)} className="p-1 rounded text-surface-500 hover:text-white hover:bg-white/10 transition-colors" title="设置">
                <Settings2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 主聊天区 ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 顶栏 */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5 bg-surface-900/70 backdrop-blur-sm">
          <button onClick={() => setSidebarOpen(v => !v)}
            className={`p-1.5 rounded-lg transition-colors ${sidebarOpen ? 'text-surface-400 hover:text-white hover:bg-white/10' : 'text-surface-300 hover:bg-white/10'}`}
            title={sidebarOpen ? '收起会话列表' : '展开会话列表'}>
            <PanelLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2 min-w-0">
            <div className={`w-6 h-6 rounded-lg bg-gradient-to-br ${provider.gradient} flex items-center justify-center shadow-md flex-shrink-0`}>
              <Bot className="w-3.5 h-3.5 text-white" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-white truncate">{activeConv?.title || '银月 AI · 数据库助手'}</p>
              <p className="text-[10px] text-surface-500 truncate">本地数据库智能体 · 只读查询</p>
            </div>
          </div>
          <div className="flex-1" />
          <span className={`hidden md:flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] border ${provider.chip}`}>
            <Cpu className="w-3 h-3" /> {providerCfg.model || '未选模型'}
          </span>
          {notice && (
            <span className={`px-2 py-1 rounded-lg text-[10px] ${notice.type === 'error' ? 'bg-red-500/15 text-red-300' : 'bg-emerald-500/15 text-emerald-300'}`}>
              {notice.text}
            </span>
          )}
          <button onClick={() => setShowSettings(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-surface-300 hover:text-white hover:bg-white/10 transition-colors">
            <Settings2 className="w-3.5 h-3.5" /> 设置
          </button>
        </div>

        {/* 消息区 */}
        <div ref={messagesRef} className="flex-1 overflow-y-auto px-4 py-4">
          {!activeConv || activeConv.messages.length === 0 ? (
            <EmptyState onAsk={sendMessage} settingsConfigured={!!providerCfg.apiKey && !!providerCfg.model}
              onOpenSettings={() => setShowSettings(true)} onNewChat={newChat} />
          ) : (
            <div className="max-w-3xl mx-auto space-y-5">
              {activeConv.messages.map(m => (
                <MessageBubble key={m.id} msg={m} onCopy={copyText} onRegenerate={regenerate}
                  busy={busy} isLast={m === activeConv.messages[activeConv.messages.length - 1]} />
              ))}
              {pending && <StreamingBubble pending={pending} />}
            </div>
          )}
        </div>

        {/* 输入区 */}
        <div className="px-4 pb-3 pt-1 border-t border-white/5 bg-surface-900/50">
          <div className="max-w-3xl mx-auto">
            {!providerCfg.apiKey && (
              <div className="mb-2 flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/25 text-[11px] text-amber-300">
                <KeyRound className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="flex-1">尚未配置 AI 模型，先去设置里填入 API Key 吧</span>
                <button onClick={() => setShowSettings(true)} className="px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 font-medium transition-colors">去设置</button>
              </div>
            )}
            <div className={`flex items-end gap-2 rounded-2xl border bg-surface-800/80 p-2 transition-colors ${
              busy ? 'border-primary-500/40' : 'border-surface-700 focus-within:border-primary-500/50'}`}>
              <textarea
                ref={textareaRef}
                value={input}
                onChange={handleInput}
                onKeyDown={handleKeyDown}
                rows={1}
                placeholder={busy ? '正在生成回答…' : '问问数据库里的任何信息…'}
                disabled={busy}
                className="flex-1 resize-none bg-transparent text-sm text-surface-100 placeholder-surface-500 outline-none px-2 py-1.5 max-h-40"
              />
              {busy ? (
                <button onClick={stopGenerating}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium bg-red-500/80 hover:bg-red-500 text-white transition-colors flex-shrink-0">
                  <Square className="w-3.5 h-3.5 fill-current" /> 停止
                </button>
              ) : (
                <button onClick={() => sendMessage()} disabled={!input.trim()}
                  className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-primary-500 to-primary-600 text-white shadow-lg shadow-primary-900/40
                  disabled:opacity-40 disabled:shadow-none hover:brightness-110 active:scale-95 transition-all flex-shrink-0"
                  title="发送 (Enter)">
                  <Send className="w-4 h-4" />
                </button>
              )}
            </div>
            <p className="text-[10px] text-surface-600 mt-1.5 text-center">
              Enter 发送 · Shift+Enter 换行 · AI 只能只读查询本地数据库
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ═══════════════ 消息气泡（memo：流式输出期间历史气泡不重渲染）═══
const MessageBubble = memo(function MessageBubble({ msg, onCopy, onRegenerate, busy, isLast }) {
  const isUser = msg.role === 'user'
  const [copied, setCopied] = useState(false)
  const [ctxMenu, setCtxMenu] = useState(null)
  const menuJustOpened = useRef(false)
  const hasTool = msg.toolCalls && msg.toolCalls.length > 0

  async function handleCopy() {
    await onCopy(msg.content || '')
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  // 右键菜单：点击空白处/再次右键关闭
  useEffect(() => {
    if (!ctxMenu) return
    menuJustOpened.current = true
    const timer = setTimeout(() => { menuJustOpened.current = false }, 0)
    const close = () => {
      if (menuJustOpened.current) return
      setCtxMenu(null)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('contextmenu', close)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('mousedown', close)
      window.removeEventListener('contextmenu', close)
    }
  }, [ctxMenu])

  function handleContextMenu(e) {
    e.preventDefault()
    e.stopPropagation()
    setCtxMenu({ x: e.clientX, y: e.clientY })
  }

  return (
    <div className={`flex gap-2.5 ${isUser ? 'flex-row-reverse' : ''}`} onContextMenu={handleContextMenu}>
      {/* 头像 */}
      <div className={`w-7 h-7 rounded-xl flex items-center justify-center flex-shrink-0 shadow-md ${
        isUser
          ? 'bg-gradient-to-br from-surface-600 to-surface-700'
          : 'bg-gradient-to-br from-primary-500 via-indigo-500 to-violet-500'}`}>
        {isUser ? <Sparkles className="w-3.5 h-3.5 text-surface-300" /> : <Bot className="w-3.5 h-3.5 text-white" />}
      </div>
      <div className={`flex-1 min-w-0 ${isUser ? 'items-end' : 'items-start'} flex flex-col`}>
        <div className={`group relative max-w-[82%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed break-words ${
          isUser
            ? 'bg-gradient-to-br from-primary-600/90 to-primary-500/80 text-white rounded-tr-sm shadow-lg shadow-primary-900/20'
            : 'bg-surface-800/90 border border-surface-700/60 text-surface-200 rounded-tl-sm shadow-md'
        }`}>
          {msg.reasoning && <ThinkingBlock text={msg.reasoning} />}
          {isUser ? (
            <p className="whitespace-pre-wrap">{msg.content}</p>
          ) : (
            <AIMarkdown text={msg.content} />
          )}
          {hasTool && <ToolCallPanel toolCalls={msg.toolCalls} toolResults={msg.toolResults} />}
          {msg.error && <p className="mt-1.5 text-[11px] text-red-400">{msg.error}</p>}
        </div>
        {/* 操作行 */}
        <div className={`flex items-center gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity ${isUser ? 'flex-row-reverse' : ''}`}>
          {!isUser && msg.content && (
            <button onClick={handleCopy} className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-surface-500 hover:text-surface-200 hover:bg-white/5 transition-colors">
              {copied ? <Check className="w-2.5 h-2.5 text-emerald-400" /> : <Copy className="w-2.5 h-2.5" />} 复制
            </button>
          )}
          {!isUser && isLast && !busy && msg.content && !msg.aborted && !hasTool && (
            <button onClick={onRegenerate} className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-surface-500 hover:text-surface-200 hover:bg-white/5 transition-colors">
              <RefreshCw className="w-2.5 h-2.5" /> 重新生成
            </button>
          )}
        </div>
      </div>

      {/* 右键菜单：拷贝对话框文本（portal 到 body，避免窗口 backdrop-blur 包含块导致定位偏移） */}
      {ctxMenu && createPortal(
        <div
          className="fixed z-[10000] w-40 py-1 rounded-xl bg-surface-900/95 backdrop-blur-xl border border-white/10 shadow-2xl animate-scale-in"
          style={{ left: Math.min(ctxMenu.x, window.innerWidth - 170), top: Math.min(ctxMenu.y, window.innerHeight - 60) }}
          onMouseDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
        >
          <button
            onClick={async () => { await handleCopy(); setCtxMenu(null) }}
            className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-surface-200 hover:bg-white/10 transition-colors"
          >
            <Copy className="w-3.5 h-3.5 text-surface-400" />
            拷贝文本
          </button>
        </div>,
        document.body
      )}
    </div>
  )
})

// ═══════════════ 数据库工具调用展示 ═══════════════
function ToolCallPanel({ toolCalls, toolResults }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-2.5 pt-2 border-t border-white/10">
      <button onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 text-[11px] text-primary-300 hover:text-primary-200 transition-colors">
        <Database className="w-3 h-3" />
        查询了 {toolCalls.length} 次数据库
        <span className="text-surface-500">{open ? '▲' : '▼'}</span>
      </button>
      {open && toolCalls.map((tc, i) => {
        const tr = toolResults?.[i]
        let summary = ''
        let isErr = false
        try {
          const parsed = JSON.parse(tr?.content || '{}')
          if (parsed.error) { isErr = true; summary = parsed.error }
          else summary = '返回 ' + (parsed.rows?.length || 0) + ' 行' + (parsed.truncated || parsed.cellTruncated || parsed.sizeTruncated ? '（有截断）' : '')
        } catch (_) { summary = '—' }
        let sql = ''
        try { sql = JSON.parse(tc.arguments || '{}').sql || '' } catch (_) {}
        return (
          <div key={i} className="mt-1.5 rounded-lg bg-surface-950/60 border border-surface-700/60 overflow-hidden">
            <div className="flex items-center gap-1.5 px-2.5 py-1.5">
              {isErr ? <span className="text-[10px] text-red-400">⚠ {summary}</span> : <span className="text-[10px] text-emerald-400">✓ {summary}</span>}
            </div>
            <pre className="px-2.5 pb-2 text-[10px] font-mono text-surface-400 overflow-x-auto whitespace-pre-wrap">{sql}</pre>
          </div>
        )
      })}
    </div>
  )
}

// ═══════════════ 思考过程折叠块（思维链默认收起，可展开查看）═══
function ThinkingBlock({ text, live }) {
  const [open, setOpen] = useState(false)
  const bodyRef = useRef(null)

  // live 模式下展开时自动滚动到底部，跟随思考进度
  useEffect(() => {
    if (open && live && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight
    }
  }, [text, open, live])

  return (
    <div className="mb-2">
      <button onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 text-[10px] text-surface-500 hover:text-surface-300 transition-colors group">
        <Brain className={`w-3 h-3 ${live ? 'text-violet-400 animate-pulse' : 'text-violet-400/70'}`} />
        <span className="font-medium">思考过程</span>
        {live && !open && (
          <span className="flex items-center gap-0.5 ml-0.5">
            <span className="w-1 h-1 rounded-full bg-surface-500 animate-pulse" />
            <span className="w-1 h-1 rounded-full bg-surface-500 animate-pulse [animation-delay:150ms]" />
            <span className="w-1 h-1 rounded-full bg-surface-500 animate-pulse [animation-delay:300ms]" />
          </span>
        )}
        <span className="text-surface-600 group-hover:text-surface-400 transition-colors">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div ref={bodyRef}
          className="mt-1.5 max-h-64 overflow-y-auto rounded-lg bg-surface-950/50 border border-surface-700/60 p-2.5 text-[11px] leading-relaxed text-surface-400">
          <AIMarkdown text={text} />
        </div>
      )}
    </div>
  )
}

// ═══════════════ 流式生成气泡 ═══════════════
function StreamingBubble({ pending }) {
  const runningTool = pending.toolRuns?.filter(t => t.status === 'running')[0] || null
  const finishedTools = pending.toolRuns?.filter(t => t.status !== 'running') || []
  return (
    <div className="flex gap-2.5">
      <div className="w-7 h-7 rounded-xl bg-gradient-to-br from-primary-500 via-indigo-500 to-violet-500 flex items-center justify-center flex-shrink-0 shadow-md">
        <Bot className="w-3.5 h-3.5 text-white" />
      </div>
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="max-w-[82%] rounded-2xl rounded-tl-sm px-3.5 py-2.5 bg-surface-800/90 border border-surface-700/60 shadow-md">
          {pending.reasoning && <ThinkingBlock text={pending.reasoning} live />}
          {runningTool && (
            <div className="mb-2 flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-primary-500/10 border border-primary-500/25">
              <Loader2 className="w-3 h-3 text-primary-300 animate-spin flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-[11px] text-primary-300">{runningTool.explain || '查询数据库…'}</p>
                <p className="text-[10px] font-mono text-surface-500 truncate">{runningTool.sql}</p>
              </div>
            </div>
          )}
          {finishedTools.length > 0 && (
            <div className="mb-2 space-y-1">
              {finishedTools.map((t, i) => (
                <div key={i} className="flex items-center gap-1.5 text-[10px] text-surface-500">
                  {t.status === 'done' ? <Check className="w-3 h-3 text-emerald-400" /> : <span className="text-red-400">✕</span>}
                  <span className="truncate font-mono">{t.sql}</span>
                </div>
              ))}
            </div>
          )}
          {pending.text ? (
            <div className="flex items-start">
              <div className="flex-1 min-w-0"><AIMarkdown text={pending.text} /></div>
              <span className="inline-block w-[2px] h-[1em] mt-1 ml-1 bg-primary-400 animate-pulse flex-shrink-0" />
            </div>
          ) : (!runningTool && !pending.reasoning) ? (
            <div className="flex items-center gap-1.5 py-1 text-surface-400">
              <span className="w-1.5 h-1.5 rounded-full bg-surface-500 animate-pulse" />
              <span className="w-1.5 h-1.5 rounded-full bg-surface-500 animate-pulse [animation-delay:150ms]" />
              <span className="w-1.5 h-1.5 rounded-full bg-surface-500 animate-pulse [animation-delay:300ms]" />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

// ═══════════════ 空状态 ═══════════════
function EmptyState({ onAsk, settingsConfigured, onOpenSettings, onNewChat }) {
  const suggestions = [
    { icon: '👥', text: '数据库里有多少位角色？' },
    { icon: '⚔️', text: '有哪些五星武器？' },
    { icon: '⚡', text: '介绍元素反应体系' },
    { icon: '📊', text: '列出数据库的所有表' },
  ]
  return (
    <div className="h-full flex flex-col items-center justify-center px-6">
      {/* 氛围光晕 */}
      <div className="relative mb-6">
        <div className="absolute inset-0 bg-gradient-to-br from-primary-500/30 via-indigo-500/20 to-violet-500/30 blur-3xl scale-150 rounded-full" />
        <div className="relative w-20 h-20 rounded-3xl bg-gradient-to-br from-primary-500 via-indigo-500 to-violet-600 flex items-center justify-center shadow-2xl shadow-indigo-900/50 rotate-3 hover:rotate-0 transition-transform duration-300">
          <Bot className="w-10 h-10 text-white" />
        </div>
        <div className="absolute -right-2 -bottom-1 w-7 h-7 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg">
          <Wand2 className="w-3.5 h-3.5 text-white" />
        </div>
      </div>
      <h2 className="text-xl font-bold text-white tracking-wide">银月 · 数据库 AI</h2>
      <p className="text-xs text-surface-500 mt-2 max-w-md text-center leading-relaxed">
        直接问你的本地数据库——角色、武器、圣遗物、材料、元素反应、游戏机制、祈愿记录……
        <br />AI 会在需要时自动查询数据库，基于真实数据回答你。
      </p>
      {!settingsConfigured && (
        <button onClick={onOpenSettings}
          className="mt-5 flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium bg-amber-500/15 border border-amber-500/30 text-amber-300 hover:bg-amber-500/25 transition-colors animate-pulse">
          <KeyRound className="w-3.5 h-3.5" /> 先配置 AI 模型（DeepSeek / ChatGPT）
        </button>
      )}
      <div className="mt-7 grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-md">
        {suggestions.map((s, i) => (
          <button key={i} onClick={() => onAsk(s.text)}
            className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-surface-800/60 border border-surface-700/60 hover:border-primary-500/40 hover:bg-surface-800 text-left text-xs text-surface-300 hover:text-white transition-all group">
            <span className="text-base">{s.icon}</span>
            <span className="flex-1 group-hover:translate-x-0.5 transition-transform">{s.text}</span>
            <Send className="w-3 h-3 text-surface-600 group-hover:text-primary-400 transition-colors" />
          </button>
        ))}
      </div>
      <button onClick={onNewChat} className="mt-6 text-[11px] text-surface-600 hover:text-surface-400 transition-colors">
        + 开启一个新对话
      </button>
    </div>
  )
}

// ═══════════════ 设置视图 ═══════════════
function SettingsView({ settings, updateSettings, onBack, testing, testResult, testConnection, onReset }) {
  const [showKey, setShowKey] = useState(false)
  const provider = getProvider(settings.provider)
  const isCustom = settings.provider === 'custom'
  const providerCfg = settings.providers?.[settings.provider] || { apiKey: '', baseUrl: '', model: '' }

  function selectProvider(id) {
    const p = getProvider(id)
    const cfg = settings.providers?.[id]
    // 各供应商配置独立：仅切换激活供应商；该供应商尚未配过模型时补默认模型
    if (!cfg || !cfg.model) updateSettings({ provider: id, model: p.defaultModel })
    else updateSettings({ provider: id })
  }

  return (
    <div className="h-full flex flex-col">
      {/* 头部 */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5 bg-surface-900/70">
        <button onClick={onBack} className="p-1.5 rounded-lg text-surface-400 hover:text-white hover:bg-white/10 transition-colors" title="返回对话">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <Settings2 className="w-4 h-4 text-primary-400" />
        <span className="text-xs font-semibold text-white">AI 设置</span>
        <span className="text-[10px] text-surface-600">· 设置保存在 user.json · 会话保存在 user.db</span>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        <div className="max-w-2xl mx-auto space-y-6">

          {/* 供应商选择 */}
          <section>
            <h3 className="text-xs font-semibold text-surface-300 mb-2.5 flex items-center gap-1.5">
              <Server className="w-3.5 h-3.5 text-primary-400" /> AI 供应商
            </h3>
            <div className="grid grid-cols-3 gap-2.5">
              {AI_PROVIDERS.map(p => (
                <button key={p.id} onClick={() => selectProvider(p.id)}
                  className={`relative rounded-2xl border p-3 text-left transition-all ${
                    settings.provider === p.id
                      ? 'border-primary-500/60 bg-primary-500/10 shadow-lg shadow-primary-900/20 ring-1 ring-primary-500/30'
                      : 'border-surface-700 bg-surface-800/50 hover:border-surface-500 hover:bg-surface-800'}`}>
                  <div className={`w-8 h-8 rounded-xl bg-gradient-to-br ${p.gradient} flex items-center justify-center mb-2 shadow-md`}>
                    <Bot className="w-4 h-4 text-white" />
                  </div>
                  <p className="text-xs font-semibold text-white">{p.name}</p>
                  <p className="text-[10px] text-surface-500 mt-0.5 leading-snug">{p.tagline}</p>
                  {settings.provider === p.id && (
                    <span className="absolute top-2 right-2 w-4 h-4 rounded-full bg-primary-500 flex items-center justify-center">
                      <Check className="w-2.5 h-2.5 text-white" />
                    </span>
                  )}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-surface-500 mt-2 leading-relaxed">{provider.desc}</p>
          </section>

          {/* API Key */}
          <section>
            <h3 className="text-xs font-semibold text-surface-300 mb-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5"><KeyRound className="w-3.5 h-3.5 text-primary-400" /> API Key</span>
              {provider.apiKeyUrl && (
                <a href={provider.apiKeyUrl} onClick={(e) => { e.preventDefault(); window.electronAPI?.openExternal(provider.apiKeyUrl) }}
                  className="flex items-center gap-1 text-[10px] text-primary-400 hover:text-primary-300">
                  <Link2 className="w-3 h-3" /> 获取 {provider.name} API Key
                </a>
              )}
            </h3>
            <div className="flex items-center gap-2 rounded-xl bg-surface-800 border border-surface-700 focus-within:border-primary-500/50 px-3 py-2 transition-colors">
              <input type={showKey ? 'text' : 'password'} value={providerCfg.apiKey}
                onChange={e => updateSettings({ apiKey: e.target.value })}
                placeholder="sk-..."
                className="flex-1 bg-transparent text-xs text-surface-100 placeholder-surface-500 outline-none font-mono" />
              <button onClick={() => setShowKey(v => !v)} className="text-surface-500 hover:text-surface-300 transition-colors" title={showKey ? '隐藏' : '显示'}>
                {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
            <p className="text-[10px] text-surface-600 mt-1.5">各供应商的 API Key / 地址 / 模型配置相互独立、互不影响；Key 仅保存在本机 user.json 中，请求直接从本机发出。</p>
          </section>

          {/* 模型 */}
          <section>
            <h3 className="text-xs font-semibold text-surface-300 mb-2 flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-primary-400" /> 模型
            </h3>
            {isCustom && (
              <div className="mb-2.5">
                <label className="block text-[11px] text-surface-400 mb-1.5">API 地址（OpenAI 兼容，如 https://your-api.com/v1）</label>
                <input type="text" value={providerCfg.baseUrl}
                  onChange={e => updateSettings({ baseUrl: e.target.value })}
                  placeholder="https://api.example.com/v1"
                  className="w-full px-3 py-2 rounded-xl bg-surface-800 border border-surface-700 focus:border-primary-500/50 text-xs text-surface-100 placeholder-surface-500 outline-none transition-colors" />
              </div>
            )}
            <div className="flex gap-2">
              <select value={providerCfg.model}
                onChange={e => updateSettings({ model: e.target.value })}
                className="flex-1 px-3 py-2 rounded-xl bg-surface-800 border border-surface-700 focus:border-primary-500/50 text-xs text-surface-100 outline-none transition-colors appearance-none">
                {provider.models.length > 0 ? provider.models.map(m => <option key={m} value={m}>{m}</option>) : null}
                {!provider.models.includes(providerCfg.model) && providerCfg.model ? <option value={providerCfg.model}>{providerCfg.model}（自定义）</option> : null}
              </select>
              <input type="text" value={providerCfg.model}
                onChange={e => updateSettings({ model: e.target.value })}
                placeholder="或直接输入模型名"
                className="w-44 px-3 py-2 rounded-xl bg-surface-800 border border-surface-700 focus:border-primary-500/50 text-xs text-surface-100 placeholder-surface-500 outline-none transition-colors" />
            </div>
            <p className="text-[10px] text-surface-600 mt-1.5">支持函数调用（数据库查询工具）的模型体验最佳。</p>
          </section>

          {/* 温度 */}
          <section>
            <h3 className="text-xs font-semibold text-surface-300 mb-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5"><Zap className="w-3.5 h-3.5 text-primary-400" /> 温度</span>
              <span className="text-[11px] text-surface-500 font-mono">{(settings.temperature ?? 0.7).toFixed(1)}</span>
            </h3>
            <input type="range" min="0" max="1" step="0.1" value={settings.temperature ?? 0.7}
              onChange={e => updateSettings({ temperature: Number(e.target.value) })}
              className="w-full accent-primary-500" />
            <p className="text-[10px] text-surface-600 mt-1">较低 = 更稳定精确（适合数据问答），较高 = 更有创造性。</p>
          </section>

          {/* 系统提示词 */}
          <section>
            <h3 className="text-xs font-semibold text-surface-300 mb-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5"><Brain className="w-3.5 h-3.5 text-primary-400" /> 系统提示词</span>
              <button onClick={onReset}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] text-surface-500 hover:text-primary-300 hover:bg-white/5 transition-colors">
                <RotateCcw className="w-3 h-3" /> 恢复默认
              </button>
            </h3>
            <textarea value={settings.systemPrompt}
              onChange={e => updateSettings({ systemPrompt: e.target.value })}
              rows={10}
              className="w-full px-3 py-2.5 rounded-xl bg-surface-800 border border-surface-700 focus:border-primary-500/50 text-xs text-surface-200 placeholder-surface-500 outline-none transition-colors resize-y leading-relaxed font-mono" />
            <p className="text-[10px] text-surface-600 mt-1.5">
              提示词决定了 AI 的角色与回答风格。默认提示词将 AI 定位为「本地数据库智能体」，
              并约定信息不足时向你提问澄清。
            </p>
          </section>

          {/* 测试连接 */}
          <section className="pb-2">
            <button onClick={testConnection} disabled={testing || !providerCfg.apiKey}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-medium bg-primary-500/15 border border-primary-500/30 text-primary-300
              hover:bg-primary-500/25 disabled:opacity-40 transition-colors">
              {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
              {testing ? '正在测试…' : '测试连接'}
            </button>
            {testResult && (
              <p className={`mt-2.5 text-[11px] px-3 py-2 rounded-xl border ${
                testResult.ok ? 'text-emerald-300 border-emerald-500/25 bg-emerald-500/10' : 'text-red-300 border-red-500/25 bg-red-500/10'} break-words`}>
                {testResult.ok ? '✓ ' : '✕ '}{testResult.text}
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
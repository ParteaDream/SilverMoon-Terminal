import React from 'react'
import NoteSpan from '../components/NoteSpan'

/**
 * 解析富文本标记:
 *   [color=#xxxxxx]文字[/color] → 彩色
 *   [b]文字[/b] → 粗体
 *   [i]文字[/i] → 斜体
 *   [note="附注内容"]文字[/note] → 带附注（下划线 + 悬停提示）
 * 支持嵌套 (如 [b][color=red]粗体红字[/color][/b])
 * 返回 React 元素数组
 */
export function parseColorMarkup(text) {
  if (!text || typeof text !== 'string') return text

  // 使用栈式解析处理嵌套标记
  const tokens = tokenize(text)
  const result = parseTokens(tokens)
  return result.length === 0 ? text : (result.length === 1 && typeof result[0] === 'string' ? result[0] : result)
}

// ── 词法分析：将文本拆分为标记和纯文本 ──
function tokenize(text) {
  const regex = /\[(\/)?(color=(#[0-9a-fA-F]{3,8}|[a-zA-Z]+)|color|b|i|note(?:="([^"]*)")?)\]/g
  const tokens = []
  let lastIndex = 0
  let match

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: 'text', value: text.slice(lastIndex, match.index) })
    }
    const isClose = match[1] === '/'
    const tag = match[2]
    if (tag.startsWith('color=')) {
      tokens.push({ type: isClose ? 'close_color' : 'open_color', value: tag.slice(6) })
    } else if (tag === 'color') {
      // [/color] 闭合标签（不带值）
      if (isClose) {
        tokens.push({ type: 'close_color' })
      } else {
        // [color] 无值开标签视为纯文本
        tokens.push({ type: 'text', value: match[0] })
      }
    } else if (tag === 'b') {
      tokens.push({ type: isClose ? 'close_b' : 'open_b' })
    } else if (tag === 'i') {
      tokens.push({ type: isClose ? 'close_i' : 'open_i' })
    } else if (tag === 'note') {
      // [/note] 闭合标签；[note]（无值）视为普通文本
      if (isClose) {
        tokens.push({ type: 'close_note' })
      } else {
        tokens.push({ type: 'text', value: match[0] })
      }
    } else if (tag && tag.startsWith('note=')) {
      // [note="..."] 开标签 — 解码 &quot; → "
      tokens.push({ type: 'open_note', value: (match[4] || '').replace(/&quot;/g, '"') })
    }
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    tokens.push({ type: 'text', value: text.slice(lastIndex) })
  }

  return tokens
}

// ── 语法分析：将 token 序列转为 React 元素 ──
function parseTokens(tokens) {
  const stack = [{ children: [], style: {} }]
  let keyCounter = 0

  for (const token of tokens) {
    const current = stack[stack.length - 1]

    if (token.type === 'text') {
      current.children.push(token.value)
    } else if (token.type === 'open_color') {
      stack.push({ children: [], style: { ...current.style, color: token.value } })
    } else if (token.type === 'close_color') {
      if (stack.length > 1) {
        const popped = stack.pop()
        const parent = stack[stack.length - 1]
        parent.children.push(buildElement(popped, keyCounter++))
      }
    } else if (token.type === 'open_b') {
      stack.push({ children: [], style: { ...current.style, fontWeight: 'bold' } })
    } else if (token.type === 'close_b') {
      if (stack.length > 1) {
        const popped = stack.pop()
        const parent = stack[stack.length - 1]
        parent.children.push(buildElement(popped, keyCounter++))
      }
    } else if (token.type === 'open_i') {
      stack.push({ children: [], style: { ...current.style, fontStyle: 'italic' } })
    } else if (token.type === 'close_i') {
      if (stack.length > 1) {
        const popped = stack.pop()
        const parent = stack[stack.length - 1]
        parent.children.push(buildElement(popped, keyCounter++))
      }
    } else if (token.type === 'open_note') {
      stack.push({ children: [], style: { ...current.style }, note: token.value })
    } else if (token.type === 'close_note') {
      if (stack.length > 1) {
        const popped = stack.pop()
        const parent = stack[stack.length - 1]
        parent.children.push(buildElement(popped, keyCounter++))
      }
    }
  }

  // 弹出剩余栈（处理未闭合标签）
  while (stack.length > 1) {
    const popped = stack.pop()
    const parent = stack[stack.length - 1]
    parent.children.push(buildElement(popped, keyCounter++))
  }

  // 展平顶层 children：连续的纯文本合并为单个字符串
  return flattenChildren(stack[0].children, keyCounter)
}

function buildElement(node, key) {
  // 附注节点：使用 NoteSpan 组件
  if (node.note) {
    const children = flattenChildren(node.children, key * 1000)
    const hasStyle = Object.keys(node.style).length > 0
    // 如果有附加样式（颜色/粗体/斜体），在外层包裹
    const inner = React.createElement(NoteSpan, { key: `n-${key}`, noteText: node.note }, ...children)
    if (hasStyle) {
      return React.createElement('span', { key: `ns-${key}`, style: node.style }, inner)
    }
    return inner
  }

  const hasStyle = Object.keys(node.style).length > 0
  if (!hasStyle && node.children.length === 1 && typeof node.children[0] === 'string') {
    return node.children[0]
  }
  if (hasStyle) {
    return React.createElement('span', { key: `s-${key}`, style: node.style }, ...flattenChildren(node.children, key * 1000))
  }
  return flattenChildren(node.children, key)
}

function flattenChildren(children, baseKey) {
  const result = []
  let textBuf = ''
  let subKey = 0

  for (const child of children) {
    if (typeof child === 'string') {
      textBuf += child
    } else {
      if (textBuf) { result.push(textBuf); textBuf = '' }
      result.push(child)
    }
  }
  if (textBuf) result.push(textBuf)
  return result
}

// ── 预设颜色 ──
// ── 预设颜色 ──
export const PRESET_COLORS = [
  // 元素颜色（可自定义）
  { label: '火', color: '#F19E9C' },
  { label: '水', color: '#8EBEFA' },
  { label: '雷', color: '#F3B0FA' },
  { label: '冰', color: '#B1FCFE' },
  { label: '草', color: '#BEE855' },
  { label: '风', color: '#B7F3CE' },
  { label: '岩', color: '#ECD87B' },
  // 基础颜色
  { label: '红', color: '#ef4444' },
  { label: '橙', color: '#f97316' },
  { label: '黄', color: '#FFD780' },
  { label: '绿', color: '#22c55e' },
  { label: '蓝', color: '#3b82f6' },
  { label: '靛', color: '#6366f1' },
  { label: '紫', color: '#a855f7' },
  { label: '灰', color: '#9ca3af' },
  { label: '白', color: '#f3f4f6' },
]

/**
 * 元素映射常量 — 系统唯一权威来源
 * PRESET_COLORS 顺序: 火水雷冰草风岩 (索引 0-6)
 * 数据库 elements 表 ID: 1火 2水 3风 4雷 5草 6冰 7岩
 */
export const SETTINGS_ELEM_ORDER = ['火', '水', '雷', '冰', '草', '风', '岩']
export const ELEM_NAME_TO_ID = { '火': 1, '水': 2, '风': 3, '雷': 4, '草': 5, '冰': 6, '岩': 7 }
export const ELEM_ID_TO_NAME = { 1: '火', 2: '水', 3: '风', 4: '雷', 5: '草', 6: '冰', 7: '岩' }
export const ELEM_ID_TO_SETTINGS_INDEX = { 1: 0, 2: 1, 3: 5, 4: 2, 5: 4, 6: 3, 7: 6 }

// ── 工具函数：包裹/解包标记 ──

/** 通用包裹函数 */
function wrapTag(text, start, end, openTag, closeTag) {
  const before = text.slice(0, start)
  const selected = text.slice(start, end)
  const after = text.slice(end)
  if (!selected) return text
  return before + openTag + selected + closeTag + after
}

/** 通用解包函数 */
function unwrapTag(text, start, end, tagRegex, allTagsRegex) {
  const before = text.slice(0, start)
  const selected = text.slice(start, end)
  const after = text.slice(end)
  if (!selected) return text

  const match = selected.match(tagRegex)
  if (match) {
    return before + match[1] + after
  }
  const unwrapped = selected.replace(allTagsRegex, '$1')
  return before + unwrapped + after
}

// ── 颜色 ──
export function wrapWithColor(text, start, end, color) {
  const before = text.slice(0, start)
  const selected = text.slice(start, end)
  const after = text.slice(end)
  if (!selected) return text

  const colorTagRegex = /^\[color=(#[0-9a-fA-F]{3,8}|[a-zA-Z]+)\]([\s\S]*)\[\/color\]$/
  const existingMatch = selected.match(colorTagRegex)
  if (existingMatch) {
    return before + `[color=${color}]${existingMatch[2]}[/color]` + after
  }
  return wrapTag(text, start, end, `[color=${color}]`, '[/color]')
}

export function unwrapColor(text, start, end) {
  return unwrapTag(
    text, start, end,
    /^\[color=(?:#[0-9a-fA-F]{3,8}|[a-zA-Z]+)\]([\s\S]*?)\[\/color\]$/,
    /\[color=(?:#[0-9a-fA-F]{3,8}|[a-zA-Z]+)\]([\s\S]*?)\[\/color\]/g
  )
}

// ── 粗体 ──
export function wrapWithBold(text, start, end) {
  const selected = text.slice(start, end)
  if (!selected) return text
  const bTagRegex = /^\[b\]([\s\S]*)\[\/b\]$/
  if (selected.match(bTagRegex)) {
    // 已有粗体标记，移除
    return text.slice(0, start) + selected.slice(3, -4) + text.slice(end)
  }
  return wrapTag(text, start, end, '[b]', '[/b]')
}

export function unwrapBold(text, start, end) {
  return unwrapTag(text, start, end, /^\[b\]([\s\S]*?)\[\/b\]$/, /\[b\]([\s\S]*?)\[\/b\]/g)
}

// ── 斜体 ──
export function wrapWithItalic(text, start, end) {
  const selected = text.slice(start, end)
  if (!selected) return text
  const iTagRegex = /^\[i\]([\s\S]*)\[\/i\]$/
  if (selected.match(iTagRegex)) {
    return text.slice(0, start) + selected.slice(3, -4) + text.slice(end)
  }
  return wrapTag(text, start, end, '[i]', '[/i]')
}

export function unwrapItalic(text, start, end) {
  return unwrapTag(text, start, end, /^\[i\]([\s\S]*?)\[\/i\]$/, /\[i\]([\s\S]*?)\[\/i\]/g)
}

// ── 附注 ──

/**
 * 给选中文字包裹附注标记
 * @param {string} text - 完整文本
 * @param {number} start - 选区起始位置
 * @param {number} end - 选区结束位置
 * @param {string} noteContent - 附注内容（可包含 BBCode）
 */
export function wrapWithNote(text, start, end, noteContent) {
  const before = text.slice(0, start)
  const selected = text.slice(start, end)
  const after = text.slice(end)
  if (!selected) return text

  // 如果选区已被 [note] 包裹，替换其附注内容
  const noteTagRegex = /^\[note="([^"]*)"\]([\s\S]*)\[\/note\]$/
  const existingMatch = selected.match(noteTagRegex)
  if (existingMatch) {
    return before + `[note="${noteContent.replace(/"/g, '&quot;')}"]${existingMatch[2]}[/note]` + after
  }

  return before + `[note="${noteContent.replace(/"/g, '&quot;')}"]${selected}[/note]` + after
}

/** 解包附注标记 */
export function unwrapNote(text, start, end) {
  return unwrapTag(
    text, start, end,
    /^\[note="[^"]*"\]([\s\S]*?)\[\/note\]$/,
    /\[note="[^"]*"\]([\s\S]*?)\[\/note\]/g
  )
}

/**
 * 获取光标位置所在的附注信息（用于编辑已有附注）
 * @returns {{ noteText: string, noteStart: number, noteEnd: number, innerStart: number, innerEnd: number } | null}
 */
export function getNoteAtPosition(text, cursorPos) {
  const noteRegex = /\[note="([^"]*)"\]([\s\S]*?)\[\/note\]/g
  let match
  while ((match = noteRegex.exec(text)) !== null) {
    const fullStart = match.index
    const fullEnd = match.index + match[0].length
    if (cursorPos >= fullStart && cursorPos <= fullEnd) {
      const openLen = `[note="${match[1]}"]`.length
      return {
        noteText: match[1].replace(/&quot;/g, '"'),
        noteStart: fullStart,
        noteEnd: fullEnd,
        innerStart: fullStart + openLen,
        innerEnd: fullEnd - '[/note]'.length,
      }
    }
  }
  return null
}

// ── HTML 序列化：BBCode ↔ HTML（用于右侧所见即所得编辑）──

/**
 * 剥离所有格式标记，返回纯文本
 * 移除 [color=...][/color]、[b][/b]、[i][/i]、[note="..."][/note]
 */
export function stripFormatting(text) {
  if (!text || typeof text !== 'string') return text || ''
  return text
    .replace(/\[color=(?:#[0-9a-fA-F]{3,8}|[a-zA-Z]+)\]/g, '')
    .replace(/\[\/color\]/g, '')
    .replace(/\[b\]/g, '')
    .replace(/\[\/b\]/g, '')
    .replace(/\[i\]/g, '')
    .replace(/\[\/i\]/g, '')
    .replace(/\[note="[^"]*"\]/g, '')
    .replace(/\[\/note\]/g, '')
}

/**
 * BBCode 转 HTML 字符串
 * [color=#xxx]text[/color] → <span style="color:#xxx">text</span>
 * [b]text[/b] → <b>text</b>  [i]text[/i] → <i>text</i>
 * [note="content"]text[/note] → <span class="note" data-note="content">text</span>
 */
export function markupToHtml(text) {
  if (!text) return ''

  // Step 1: escape HTML entities
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  // Recover &quot; that was double-escaped by the & → &amp; step above
  html = html.replace(/&amp;quot;/g, '&quot;')

  // Step 2: extract [note] tags and replace with placeholders,
  // so note content is completely shielded from subsequent regex passes.
  const notes = []
  html = html.replace(/\[note="([^"]*)"\]([\s\S]*?)\[\/note\]/g, (_, note, inner) => {
    const idx = notes.length
    const escaped = note.replace(/&quot;/g, '"')
    notes.push({
      // Encode special chars for safe use inside HTML attributes
      noteContent: escaped.replace(/"/g, '&quot;').replace(/\n/g, '&#10;'),
      inner,
    })
    return `\x00NOTE${idx}\x00`
  })

  // Step 3: convert newlines (only affects non-note body text)
  html = html.replace(/\n/g, '<br>')

  // Step 4: remaining BBCode → HTML (only affects non-note body text)
  html = html.replace(/\[color=((?:#[0-9a-fA-F]{3,8}|[a-zA-Z]+))\]([\s\S]*?)\[\/color\]/g,
    (_, color, inner) => `<span style="color:${color}">${inner}</span>`)
  html = html.replace(/\[b\]([\s\S]*?)\[\/b\]/g, '<b>$1</b>')
  html = html.replace(/\[i\]([\s\S]*?)\[\/i\]/g, '<i>$1</i>')

  // Step 5: restore note placeholders, processing their inner text independently
  html = html.replace(/\x00NOTE(\d+)\x00/g, (_, idx) => {
    const n = notes[+idx]
    // Process inner text: escape HTML, convert \n → <br>, process BBCode
    let innerHtml = n.inner
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>')
    innerHtml = innerHtml.replace(/&amp;quot;/g, '&quot;')
    innerHtml = innerHtml.replace(/\[color=((?:#[0-9a-fA-F]{3,8}|[a-zA-Z]+))\]([\s\S]*?)\[\/color\]/g,
      (_, c, i) => `<span style="color:${c}">${i}</span>`)
    innerHtml = innerHtml.replace(/\[b\]([\s\S]*?)\[\/b\]/g, '<b>$1</b>')
    innerHtml = innerHtml.replace(/\[i\]([\s\S]*?)\[\/i\]/g, '<i>$1</i>')
    return `<span class="note" data-note="${n.noteContent}" title="${n.noteContent}">${innerHtml}</span>`
  })

  return html
}

/**
 * HTML DOM 序列化回 BBCode
 */
export function htmlToMarkup(root) {
  const blockTags = { p:1, div:1, h1:1, h2:1, h3:1, h4:1, h5:1, h6:1, li:1, blockquote:1, section:1, article:1, header:1, footer:1, pre:1 }

  function walk(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || ''
    if (node.nodeType !== Node.ELEMENT_NODE) return ''
    let inner = ''
    let prevBlock = false
    for (const child of node.childNodes) {
      const chunk = walk(child)
      const childTag = child.nodeType === Node.ELEMENT_NODE ? child.tagName?.toLowerCase() : null
      const curBlock = childTag && blockTags[childTag]
      if (prevBlock && !curBlock && chunk && !chunk.startsWith('\n')) {
        inner += '\n'
      } else if (!prevBlock && curBlock && inner && !inner.endsWith('\n')) {
        inner += '\n'
      }
      inner += chunk
      prevBlock = curBlock
    }

    const tag = node.tagName?.toLowerCase()
    if (tag === 'br') return '\n'
    if (node.classList?.contains('note')) {
      const noteText = (node.dataset?.note || '').replace(/"/g, '&quot;')
      return `[note="${noteText}"]${inner}[/note]`
    }
    const fontColor = node.getAttribute?.('color')
    const styleColor = node.style?.color
    let color = fontColor || styleColor
    if (color) {
      if (color.startsWith('rgb')) {
        // comma-separated: rgb(241, 245, 249)
        let m = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
        // space-separated (tailwind): rgb(241 245 249) or rgb(241 245 249 / 1) or rgb(241 245 249 / var(...))
        if (!m) m = color.match(/rgb\((\d+)\s+(\d+)\s+(\d+)(?:\s*\/\s*[^)]+)?\)/)
        if (m) color = '#' + [m[1], m[2], m[3]].map(n => parseInt(n).toString(16).padStart(2, '0')).join('')
        else color = '' // unrecognized rgb format — drop
      }
      if (color) return `[color=${color}]${inner}[/color]`
    }
    if (tag === 'b' || tag === 'strong') return `[b]${inner}[/b]`
    if (tag === 'i' || tag === 'em') return `[i]${inner}[/i]`
    if (blockTags[tag]) return inner.endsWith('\n') ? inner : inner + '\n'
    return inner
  }
  return walk(root).replace(/\n$/, '')
}

/**
 * 移除粘贴文本中本应用不支持的 BBCode 格式标签，保留纯文本。
 * 支持格式: [color=#xxx] / [color=name] / [b] / [i] / [note="..."] 及其闭合标签。
 * 其他未知 [...] 标签会被移除，仅保留内部文本。
 * 同时清除因移除开标签而残留的孤立闭合标签。
 */
export function stripUnknownFormats(text) {
  if (!text) return text

  const supportedOpen = /^(color=(?:#[0-9a-fA-F]{3,8}|[a-zA-Z]+)|b|i|note="[^"]*")$/
  const supportedClose = /^(color|b|i|note)$/

  // Pass 1: remove unsupported open/close tags
  let result = text.replace(/\[(\/)?([^\]]*)\]/g, (match, slash, content) => {
    if (slash) {
      return supportedClose.test(content) ? match : ''
    }
    return supportedOpen.test(content) ? match : ''
  })

  // Pass 2: remove orphan close tags (leftover from removed unsupported opens).
  // After pass 1, only supported tags remain — match all of them for counting.
  const tagKind = tag => tag.startsWith('note=') ? 'note' : tag.replace(/=.*/, '')
  let counts = { color: 0, b: 0, i: 0, note: 0 }
  result = result.replace(/\[(\/)?([^\]]*)\]/g, (match, slash, content) => {
    const kind = tagKind(content)
    if (!counts.hasOwnProperty(kind)) return match // shouldn't happen after pass 1
    if (slash) {
      if (counts[kind] > 0) { counts[kind]--; return match }
      return '' // orphan close
    }
    counts[kind]++
    return match
  })

  return result
}

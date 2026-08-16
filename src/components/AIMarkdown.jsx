import React, { useState } from 'react'
import { Check, Copy } from 'lucide-react'

/**
 * 聊天消息 Markdown 渲染器（轻量实现）
 * 支持：代码围栏、标题、无序/有序列表、表格、引用、分隔线、段落，
 * 行内：粗体/斜体/删除线/行内代码/链接。
 */

// ── LaTeX 公式清洗：把 AI 回复中的 LaTeX 数学符号转成可读纯文本 ──
export function cleanLatex(text) {
  if (!text || typeof text !== 'string') return text || ''
  return text
    // 带花括号参数的样式/函数命令：\mathbf{X} → X
    .replace(/\\(?:mathbf|mathrm|text|mathit|mathsf|textbf|textit|operatorname|displaystyle|large|small|big|Big)\s*\{([^{}]*)\}/g, '$1')
    // 分式：\frac{a}{b} → (a)/(b)
    .replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '($1)/($2)')
    // 根号：\sqrt{x} → √(x)
    .replace(/\\sqrt\s*\[?([^\]]*)\]?\s*\{([^{}]*)\}/g, '√($2)')
    // 运算符
    .replace(/\\times/g, '×')
    .replace(/\\div/g, '÷')
    .replace(/\\cdot/g, '·')
    .replace(/\\approx/g, '≈')
    .replace(/\\left|\\right/g, '') // 先移除 left/right，避免被 \le 规则误伤成 ≤ft
    .replace(/\\leq|\\le/g, '≤')
    .replace(/\\geq|\\ge/g, '≥')
    .replace(/\\neq/g, '≠')
    .replace(/\\pm/g, '±')
    .replace(/\\times/g, '×')
    .replace(/\\%/g, '%')
    .replace(/\\degree|\\circ/g, '°')
    .replace(/\\infty/g, '∞')
    .replace(/\\sum/g, 'Σ')
    .replace(/\\prod/g, 'Π')
    .replace(/\\int/g, '∫')
    // 定界符
    .replace(/\\(?=[()])/g, '')
    .replace(/\\\[|\\\]/g, '')
    // 其余带参数命令：\command{内容} → 内容
    .replace(/\\([a-zA-Z]+)\s*\{([^{}]*)\}/g, '$2')
    // 其余无参数命令：\command → 移除
    .replace(/\\([a-zA-Z]+)/g, '')
    // 残留花括号与美元符
    .replace(/[{}]/g, '')
    .replace(/\$\$/g, '')
    .replace(/\$/g, '')
    .trim()
}

// ── 兜底清洗：隐藏未被解析器消费的 Markdown 符号残留（如 **、__、~~）──
// 已正确配对的粗体/斜体/删除线会被上面的正则渲染为样式元素，不会进入这里；
// 只有无法匹配的残留（如 **132.8*2** 中间含 *、嵌套、跨行等）会被移除，从软件侧根除乱码。
export function cleanDangling(text) {
  if (!text || typeof text !== 'string') return text || ''
  return text
    .replace(/\*\*/g, '')  // 粗体残留
    .replace(/__/g, '')     // 下划线粗体残留
    .replace(/~~/g, '')     // 删除线残留
}

// ── 行内解析 ──
function renderInline(text, keyBase = 0) {
  const nodes = []
  let key = keyBase
  // 分组: 1=code全 2=code内容 | 3=公式全 4=公式内容 | 5=粗体全 6=粗体内容 | 7=斜体全 8=斜体内容 | 9=删除线全 10=删除线内容 | 11=链接全 12=链接文本 13=url
  const regex = /(`([^`\n]+)`)|(\$([^$\n]+)\$)|(\*\*([^*\n]+)\*\*)|(\*([^*\n]+)\*)|(~~([^~\n]+)~~)|(\[([^\]\n]+)\]\(([^)\n]+)\))/g
  let last = 0
  let m
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) nodes.push(cleanDangling(text.slice(last, m.index)))
    if (m[2] != null) {
      nodes.push(<code key={key++} className="px-1 py-0.5 rounded bg-surface-800 text-cyan-300 font-mono text-[0.85em]">{m[2]}</code>)
    } else if (m[4] != null) {
      nodes.push(<span key={key++} className="font-mono text-primary-200">{cleanLatex(m[4])}</span>)
    } else if (m[6] != null) {
      nodes.push(<strong key={key++} className="font-semibold text-white">{m[6]}</strong>)
    } else if (m[8] != null) {
      nodes.push(<em key={key++} className="italic text-surface-200">{m[8]}</em>)
    } else if (m[10] != null) {
      nodes.push(<s key={key++} className="line-through text-surface-400">{m[10]}</s>)
    } else if (m[12] != null) {
      const href = m[13]
      nodes.push(
        <a key={key++} href={href} onClick={(e) => { e.preventDefault(); window.electronAPI?.openExternal(href) }}
          className="text-primary-300 underline underline-offset-2 hover:text-primary-200">{m[12]}</a>
      )
    }
    last = regex.lastIndex
  }
  if (last < text.length) nodes.push(cleanDangling(text.slice(last)))
  return nodes
}

// ── 代码块（带复制按钮）──
function CodeBlock({ lang, code }) {
  const [copied, setCopied] = useState(false)
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (_) {}
  }
  return (
    <div className="relative group my-2 max-w-full rounded-lg overflow-hidden bg-surface-950/80 border border-surface-700">
      <div className="flex items-center justify-between px-3 py-1.5 bg-surface-900/80 border-b border-surface-700/60">
        <span className="text-[10px] font-mono text-surface-500">{lang || 'code'}</span>
        <button onClick={handleCopy} className="p-1 rounded text-surface-500 hover:text-white hover:bg-surface-700 transition-colors" title="复制代码">
          {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
        </button>
      </div>
      <pre className="p-3 text-xs font-mono text-surface-300 overflow-x-auto leading-relaxed">{code}</pre>
    </div>
  )
}

// ── 表格 ──
function Table({ headers, rows }) {
  return (
    <div className="my-2 max-w-full overflow-x-auto rounded-lg border border-surface-700">
      <table className="w-full text-xs">
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i} className="px-3 py-1.5 bg-surface-800/70 text-[11px] font-medium text-surface-300 text-left border-b border-r border-surface-700 last:border-r-0 whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>
              {r.map((c, ci) => (
                <td key={ci} className="px-3 py-1.5 text-surface-300 border-b border-r border-surface-700/50 last:border-r-0">{cleanDangling(c)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── 块级解析 ──
export default function AIMarkdown({ text, className = '' }) {
  if (!text) return null
  const lines = text.split('\n')
  const blocks = []
  let i = 0
  let guard = 0 // 兜底护栏：防止任何分支漏推进 i 导致死循环

  while (i < lines.length && guard++ < lines.length * 4) {
    const line = lines[i]

    // 代码围栏
    const fence = line.match(/^\s*(`{3,}|~{3,})([^\s`~]*)/)
    if (fence) {
      const marker = fence[1]
      const lang = fence[2] || ''
      const code = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith(marker)) {
        code.push(lines[i]); i++
      }
      i++ // 跳过闭合围栏
      blocks.push({ type: 'code', lang, code: code.join('\n') })
      continue
    }

    // 数学公式块（$$...$$，可跨行）
    const formulaStart = line.match(/^\s*\$\$(.*)$/)
    if (formulaStart) {
      const buf = [formulaStart[1]]
      i++
      if (!formulaStart[1].includes('$$')) {
        // 未同行闭合：收集后续行直到出现 $$ 的行
        while (i < lines.length && !lines[i].includes('$$')) {
          buf.push(lines[i]); i++
        }
        if (i < lines.length) {
          buf.push(lines[i].replace(/\$\$.*$/, ''))
          i++
        }
      } else {
        // 同行闭合：去掉结尾 $$ 及其后内容
        buf[0] = buf[0].replace(/\$\$.*$/, '')
      }
      blocks.push({ type: 'formula', text: buf.join('\n').replace(/\$\$/g, '').trim() })
      continue
    }

    // 表格块
    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const rows = []
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        const cells = lines[i].trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim())
        rows.push(cells); i++
      }
      const headers = rows.shift() || []
      const dataRows = []
      for (const r of rows) {
        // 跳过分隔行（如 |---|---| 拆分后每格都是 - 或 :）
        if (r.every(c => /^:?-+:?$/.test(c))) continue
        dataRows.push(r)
      }
      blocks.push({ type: 'table', headers, rows: dataRows })
      continue
    }

    // 标题
    const heading = line.match(/^(#{1,4})\s+(.*)/)
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2] })
      i++
      continue
    }

    // 分隔线
    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) {
      blocks.push({ type: 'hr' }); i++; continue
    }

    // 引用
    if (/^\s*>\s?/.test(line)) {
      const quote = []
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, '')); i++
      }
      blocks.push({ type: 'quote', text: quote.join('\n') })
      continue
    }

    // 无序列表
    if (/^\s*[-*+]\s+/.test(line)) {
      const items = []
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, '')); i++
      }
      blocks.push({ type: 'ul', items })
      continue
    }

    // 有序列表
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items = []
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, '')); i++
      }
      blocks.push({ type: 'ol', items })
      continue
    }

    // 空行
    if (line.trim() === '') { i++; continue }

    // 段落（连续非空行）
    const para = []
    while (i < lines.length && lines[i].trim() !== '' && !/^(#{1,4}\s|\s*[-*+]\s+|\s*\d+[.)]\s+|\s*>|\s*\|)/.test(lines[i]) && !lines[i].includes('$$')) {
      para.push(lines[i]); i++
    }
    if (para.length === 0) {
      // 兜底：该行不属于任何块类型（如残缺的表格行/孤立的 | 行），
      // 作为普通段落渲染并推进 i，避免死循环（流式渲染中表格表头行先于分隔行到达）
      para.push(lines[i]); i++
    }
    blocks.push({ type: 'para', text: para.join(' ') })
  }

  return (
    <div className={'text-[13px] leading-relaxed text-surface-200 break-words min-w-0 ' + className}>
      {blocks.map((b, idx) => {
        const key = idx
        switch (b.type) {
          case 'code': return <CodeBlock key={key} lang={b.lang} code={b.code} />
          case 'formula': return (
            <div key={key} className="my-1.5 px-3 py-2 rounded-lg bg-primary-500/5 border border-primary-500/15 text-center font-mono text-[12.5px] text-primary-200 whitespace-pre-wrap">
              {cleanLatex(b.text)}
            </div>
          )
          case 'table': return <Table key={key} headers={b.headers} rows={b.rows} />
          case 'heading': return b.level === 1
            ? <h3 key={key} className="text-base font-bold text-white mb-1.5 mt-2">{renderInline(b.text, key * 100)}</h3>
            : <h4 key={key} className="text-sm font-semibold text-surface-100 mb-1 mt-2">{renderInline(b.text, key * 100)}</h4>
          case 'hr': return <div key={key} className="my-2 border-t border-surface-700" />
          case 'quote': return (
            <blockquote key={key} className="my-1.5 pl-3 border-l-2 border-primary-500/50 text-surface-400 italic">
              {renderInline(b.text, key * 100)}
            </blockquote>
          )
          case 'ul': return (
            <ul key={key} className="my-1.5 space-y-1 list-disc pl-5 marker:text-primary-400">
              {b.items.map((it, ii) => <li key={ii}>{renderInline(it, key * 100 + ii * 10)}</li>)}
            </ul>
          )
          case 'ol': return (
            <ol key={key} className="my-1.5 space-y-1 list-decimal pl-5 marker:text-primary-400">
              {b.items.map((it, ii) => <li key={ii}>{renderInline(it, key * 100 + ii * 10)}</li>)}
            </ol>
          )
          case 'para': return <p key={key} className="my-1">{renderInline(b.text, key * 100)}</p>
          default: return null
        }
      })}
    </div>
  )
}
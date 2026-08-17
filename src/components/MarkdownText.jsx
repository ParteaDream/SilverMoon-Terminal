// ── Markdown 链接渲染（轻量）──
// 识别描述等纯文本中的 [文字](URL) 语法并渲染为可点击链接，
// 其余内容原样输出（不解析其他 Markdown 标记）。
// 点击链接时通过 Electron 的系统浏览器打开外部 URL。

const LINK_RE = /\[([^\]\n]+)\]\(([^)\n\s]+)\)/g
// 仅允许安全的 URL 协议，拒绝 javascript:/data:/vbscript: 等注入
const SAFE_URL_RE = /^(?!javascript:|data:|vbscript:|file:)/i

function openExternal(href) {
  if (window.electronAPI?.openExternal) {
    window.electronAPI.openExternal(href)
  } else {
    // 非 Electron 环境（如浏览器调试）兜底
    window.open(href, '_blank', 'noopener,noreferrer')
  }
}

export default function MarkdownText({ text }) {
  const str = typeof text === 'string' ? text : (text == null ? '' : String(text))
  if (!str) return null

  const nodes = []
  let last = 0
  let key = 0
  let m
  while ((m = LINK_RE.exec(str)) !== null) {
    if (m.index > last) nodes.push(str.slice(last, m.index))
    const href = m[2]
    if (SAFE_URL_RE.test(href)) {
      nodes.push(
        <a
          key={key++}
          href={href}
          className='text-primary-400 hover:text-primary-300 underline underline-offset-2 break-all cursor-pointer'
          onClick={e => {
            e.preventDefault()
            e.stopPropagation() // 避免触发表格行点击等父级行为
            openExternal(href)
          }}
        >
          {m[1]}
        </a>
      )
    } else {
      // 不安全的协议：仅显示文字，不生成链接
      nodes.push(<span key={key++}>{m[1]}</span>)
    }
    last = LINK_RE.lastIndex
  }
  if (last < str.length) nodes.push(str.slice(last))

  return <>{nodes}</>
}

// ── Markdown 文本工具 ──

/**
 * 将 Markdown 文本转换为纯文本（仅用于内容预览等场景）。
 * 移除标题、列表、引用、代码围栏、行内代码、粗体/斜体/删除线、链接、图片、分隔线等标记，
 * 保留可读的文字内容。围栏内的代码正文保持原样（渲染时同样不解析 Markdown）。
 */
export function stripMarkdown(text) {
  if (!text || typeof text !== 'string') return text || ''

  const lines = text.split('\n')
  const out = []
  let inFence = false

  for (const raw of lines) {
    const line = raw
    // 代码围栏（\`\`\` 或 ~~~）：围栏行本身不显示
    if (/^\s*(`{3,}|~{3,})\s*$/.test(line)) {
      inFence = !inFence
      continue
    }
    // 围栏内的代码内容保持原样
    if (inFence) {
      out.push(line)
      continue
    }
    let l = line
    // ATX 标题: # ## ### ...
    l = l.replace(/^\s{0,3}#{1,6}\s+/, '')
    // 无序/有序列表
    l = l.replace(/^\s{0,3}(?:[-*+]|\d+[.)])\s+/, '')
    // 引用
    l = l.replace(/^\s{0,3}>\s?/, '')
    // 分隔线（--- / *** / ___）
    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(l)) continue
    out.push(l)
  }

  let result = out.join('\n')
  // 行内标记
  result = result
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1') // 图片 → alt 文本
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // 链接 → 链接文字
    .replace(/`{1,3}([^`\n]*)`{1,3}/g, '$1') // 行内代码
    .replace(/~~([^~\n]+)~~/g, '$1') // 删除线
    .replace(/\*\*([^*\n]+)\*\*/g, '$1') // 粗体
    .replace(/__([^_\n]+)__/g, '$1') // 粗体（下划线写法）
    .replace(/(?<![A-Za-z0-9])\*([^*\n]+)\*(?![A-Za-z0-9])/g, '$1') // 斜体
    .replace(/(?<![A-Za-z0-9])_([^_\n]+)_(?![A-Za-z0-9])/g, '$1') // 斜体（下划线写法）

  // 压缩多余空行并去首尾空白
  return result.replace(/\n{3,}/g, '\n\n').trim()
}

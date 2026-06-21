import { parseColorMarkup } from '../utils/colorMarkup'

/**
 * 渲染带颜色标记的文本
 * 解析 [color=#xxxxxx]文字[/color] 格式并渲染为带颜色的 <span>
 */
export default function ColoredText({ text, className = '', as: Tag = 'span', ...props }) {
  if (!text) return null

  const parsed = parseColorMarkup(text)

  // 如果解析结果仍是纯字符串，直接渲染
  if (typeof parsed === 'string') {
    return <Tag className={`whitespace-pre-wrap text-white ${className}`} {...props}>{parsed}</Tag>
  }

  return (
    <Tag className={`whitespace-pre-wrap text-white ${className}`} {...props}>
      {parsed}
    </Tag>
  )
}

/**
 * 解析后返回 React 元素片段（用于内联使用，不需要额外包裹标签）
 */
export function ColoredSpan({ text }) {
  if (!text) return null
  const parsed = parseColorMarkup(text)
  if (typeof parsed === 'string') return parsed
  return parsed
}

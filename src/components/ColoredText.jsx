import { parseColorMarkup } from '../utils/colorMarkup'
import { useMemo } from 'react'

/**
 * 展开文本中的 [effect:名称] 引用为 effectMap 中对应的内容
 */
export function expandEffectRefs(text, effectMap) {
  if (!effectMap || !text) return text
  const keys = Object.keys(effectMap)
  if (keys.length === 0) return text
  // 按 key 长度降序排列，避免短名称误匹配（如 "伤害" 误匹配 "伤害加成" 的一部分）
  const sorted = keys.sort((a, b) => b.length - a.length)
  let result = text
  for (const name of sorted) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // 允许名称前后有空格: [effect: 名称 ] 或 [effect:名称]
    const regex = new RegExp(`\\[effect:\\s*${escaped}\\s*\\]`, 'g')
    const entry = effectMap[name]
    if (entry && typeof entry === 'object') {
      result = result.replace(regex, (entry.rawName || name) + '\n' + (entry.content || ''))
    } else {
      result = result.replace(regex, name + '\n' + (entry || ''))
    }
  }
  return result
}

/**
 * 渲染带颜色标记的文本
 * 解析 [color=#xxxxxx]文字[/color] 格式并渲染为带颜色的 <span>
 * 支持 effectMap 属性展开 [effect:名称] 引用
 */
export default function ColoredText({ text, className = '', as: Tag = 'span', effectMap, ...props }) {
  if (!text) return null

  const expanded = useMemo(() => expandEffectRefs(text, effectMap), [text, effectMap])
  const parsed = parseColorMarkup(expanded)

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
export function ColoredSpan({ text, effectMap }) {
  if (!text) return null
  const expanded = expandEffectRefs(text, effectMap)
  const parsed = parseColorMarkup(expanded)
  if (typeof parsed === 'string') return parsed
  return parsed
}

import { useState, useRef, useMemo, useEffect } from 'react'
import { parseColorMarkup, ELEM_ID_TO_NAME, ELEM_ID_TO_SETTINGS_INDEX } from '../utils/colorMarkup'

/**
 * 带附注的文字片段
 * 显示为下划线样式，鼠标悬停时弹出附注内容（支持富文本 + 元素图标 {id}）
 */
export default function NoteSpan({ noteText, children }) {
  const [show, setShow] = useState(false)
  const spanRef = useRef(null)
  const [elemIcons, setElemIcons] = useState({})
  const [elemColors, setElemColors] = useState([])

  // 加载元素图标
  useEffect(() => {
    async function load() {
      try {
        const res = await window.electronAPI?.dbQuery("SELECT value FROM settings WHERE key = 'element_colors'")
        if (res?.data?.length > 0) {
          const stored = JSON.parse(res.data[0].value)
          if (Array.isArray(stored)) {
            setElemColors(stored)
            const icons = {}
            for (const item of stored) {
              if (item.icon && !icons[item.icon]) icons[item.icon] = null
            }
            for (const iconName of Object.keys(icons)) {
              try {
                const imgRes = await window.electronAPI?.readImage(iconName)
                if (imgRes?.success && imgRes.data) icons[iconName] = imgRes.data
              } catch (_) {}
            }
            setElemIcons(icons)
          }
        }
      } catch (_) {}
    }
    load()
  }, [noteText])

  const parsedNote = useMemo(() => {
    if (!noteText) return null
    return renderNoteWithElements(noteText, elemColors, elemIcons)
  }, [noteText, elemColors, elemIcons])

  if (!noteText) {
    return (
      <span className="border-b border-dotted border-primary-400">
        {children}
      </span>
    )
  }

  return (
    <>
      <span
        ref={spanRef}
        className="border-b border-dotted border-primary-400 cursor-help"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
      >
        {children}
      </span>
      {show && (
        <span
          className="fixed z-50 px-2.5 py-1.5 bg-surface-800 border border-surface-500 rounded-lg
                     text-xs text-white leading-relaxed shadow-xl pointer-events-none
                     max-w-xs whitespace-pre-wrap break-words"
          style={{
            left: spanRef.current
              ? Math.min(
                  spanRef.current.getBoundingClientRect().left,
                  window.innerWidth - 288
                )
              : 0,
            top: spanRef.current
              ? spanRef.current.getBoundingClientRect().bottom + 4
              : 0,
          }}
        >
          {parsedNote}
        </span>
      )}
    </>
  )
}

/** 渲染带 {id} 元素图标标记的文本 */
function renderNoteWithElements(text, elemColors, elemIcons) {
  if (!text) return null
  const regex = /\{(\d+)\}/g
  const parts = []
  let lastIdx = 0
  let match
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      const seg = parseColorMarkup(text.slice(lastIdx, match.index))
      parts.push(...[].concat(seg))
    }
    const elemId = parseInt(match[1])
    const name = ELEM_ID_TO_NAME[elemId] || ''
    const si = ELEM_ID_TO_SETTINGS_INDEX[elemId]
    const c = si != null ? elemColors[si] : null
    const iconData = c?.icon ? elemIcons[c.icon] : null
    if (iconData) {
      parts.push(<img key={`ne-${lastIdx}`} src={iconData} alt={name} className="w-4 h-4 inline-block align-middle rounded-sm" />)
    } else if (c) {
      parts.push(<span key={`ne-${lastIdx}`} className="inline-block align-middle px-0.5 text-[10px] font-medium rounded-sm" style={{ backgroundColor: c.color + '20', color: c.color }}>{name}</span>)
    } else {
      parts.push(<span key={`ne-${lastIdx}`} className="text-surface-500">{match[0]}</span>)
    }
    lastIdx = match.index + match[0].length
  }
  if (lastIdx < text.length) {
    const seg = parseColorMarkup(text.slice(lastIdx))
    parts.push(...[].concat(seg))
  }
  return parts.length === 1 ? parts[0] : parts
}

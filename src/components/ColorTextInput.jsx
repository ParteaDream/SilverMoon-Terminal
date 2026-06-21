import { useState, useRef, useCallback, useEffect } from 'react'
import { Eraser, Bold, Italic, GripHorizontal, Eye, EyeOff, StickyNote, X } from 'lucide-react'
import {
  PRESET_COLORS, wrapWithColor, unwrapColor,
  wrapWithBold, wrapWithItalic, parseColorMarkup,
  wrapWithNote, unwrapNote, getNoteAtPosition,
  markupToHtml, htmlToMarkup, stripUnknownFormats,
  SETTINGS_ELEM_ORDER, ELEM_NAME_TO_ID, ELEM_ID_TO_NAME, ELEM_ID_TO_SETTINGS_INDEX,
} from '../utils/colorMarkup'

/**
 * 带富文本功能的文本输入组件
 * 支持标记: [color=#xxx]文字[/color], [b]粗体[/b], [i]斜体[/i]
 * 预览模式：类 Typora 所见即所得 — 点击渲染文本切换至源码编辑，Ctrl+Enter 切回预览
 * 底部拖拽条可调节编辑高度
 */
export default function ColorTextInput({
  value = '',
  onChange,
  placeholder = '',
  rows = 8,
  className = '',
  ...props
}) {
  const textareaRef = useRef(null)
  const richRef = useRef(null)
  const activePane = useRef('left')
  const savedRange = useRef(null)
  const savedSel = useRef(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const [selection, setSelection] = useState({ start: 0, end: 0 })
  const [textRows, setTextRows] = useState(rows)
  const [preview, setPreview] = useState(true)
  const dragging = useRef(false)
  const [noteModalOpen, setNoteModalOpen] = useState(false)
  const [noteContent, setNoteContent] = useState('')
  const [editingNote, setEditingNote] = useState(false) // 是否编辑已有附注
  const noteTextareaRef = useRef(null)
  const [noteRows, setNoteRows] = useState(4)
  const noteDragging = useRef(false)
  const [colors, setColors] = useState(PRESET_COLORS)
  const [elementIcons, setElementIcons] = useState({})

  // 加载自定义元素颜色和图标
  useEffect(() => {
    async function load() {
      try {
        const res = await window.electronAPI?.dbQuery("SELECT value FROM settings WHERE key = 'element_colors'")
        if (res?.data?.length > 0) {
          const stored = JSON.parse(res.data[0].value)
          if (Array.isArray(stored)) {
            const els = PRESET_COLORS.slice(0, 7).map((c, i) => ({
              ...c,
              color: stored[i]?.color || c.color,
              icon: stored[i]?.icon || '',
            }))
            setColors([...els, ...PRESET_COLORS.slice(7)])
            // Load icon previews
            const iconNames = {}
            els.forEach(c => { if (c.icon) iconNames[c.icon] = true })
            const names = Object.keys(iconNames)
            if (names.length > 0) {
              setElementIcons(prev => {
                const next = { ...prev }
                names.forEach(k => { if (!next[k]) next[k] = null })
                return next
              })
            }
          }
        }
      } catch (_) {}
    }
    load()
  }, [value])

  // Load icon image data
  useEffect(() => {
    async function loadIcons() {
      const toLoad = Object.keys(elementIcons).filter(k => k && elementIcons[k] === null)
      if (toLoad.length === 0) return
      for (const icon of toLoad) {
        const res = await window.electronAPI?.readImage(icon)
        if (res?.success && res.data) {
          setElementIcons(prev => ({ ...prev, [icon]: res.data }))
        }
      }
    }
    loadIcons()
  }, [elementIcons])

  // 外部 rows 变化时同步
  useEffect(() => { setTextRows(rows) }, [rows])

  // 附注弹窗关闭时清除保存的选区
  useEffect(() => {
    if (!noteModalOpen) savedRange.current = null
  }, [noteModalOpen])

  // 左侧源码变更时同步右侧（右侧未活跃时初始化/更新）
  useEffect(() => {
    if (!preview && richRef.current && activePane.current !== 'right') {
      richRef.current.innerHTML = markupToHtml(value)
    }
  }, [value, preview])

  // 右侧 DOM 变化时自动同步到左侧（MutationObserver）
  useEffect(() => {
    if (!richRef.current || preview) return
    const observer = new MutationObserver(() => {
      if (activePane.current === 'right' && richRef.current) {
        onChangeRef.current(htmlToMarkup(richRef.current))
      }
    })
    observer.observe(richRef.current, { characterData: true, childList: true, subtree: true })
    return () => observer.disconnect()
  }, [preview])

  // ── 粘贴转换：HTML → BBCode ──
  const handlePaste = useCallback((e) => {
    const html = e.clipboardData?.getData('text/html')
    if (!html) return // plain text — let default behavior handle it
    e.preventDefault()
    // Convert pasted HTML to BBCode, then to display HTML for insertion
    const tmp = document.createElement('div')
    tmp.innerHTML = html
    const pasted = htmlToMarkup(tmp)
    if (!pasted) return
    // Strip unsupported formats (e.g. tailwind rgb colors) before rendering
    const cleaned = stripUnknownFormats(pasted)
    if (!cleaned) return
    // Insert as formatted HTML — browser renders it, onInput converts back cleanly
    document.execCommand('insertHTML', false, markupToHtml(cleaned))
  }, [])

  // ── 拖拽调高 ──
  const onDragStart = useCallback((e) => {
    e.preventDefault()
    dragging.current = true
    const startY = e.clientY
    const startRows = textRows

    function onMove(ev) {
      const dy = ev.clientY - startY
      const newRows = Math.max(3, Math.min(30, startRows + Math.round(dy / 18)))
      setTextRows(newRows)
    }
    function onUp() {
      dragging.current = false
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [textRows])

  // ── 切换到编辑模式 ──
  function enterEdit() {
    setPreview(false)
    setTimeout(() => {
      const el = textareaRef.current
      if (el) {
        el.focus()
        // 光标放到末尾
        el.setSelectionRange(el.value.length, el.value.length)
      }
    }, 0)
  }

  // ── 富文本操作（仅编辑模式）──
  const handleSelect = useCallback(() => {
    const el = textareaRef.current
    if (el) {
      setSelection({ start: el.selectionStart, end: el.selectionEnd })
    }
  }, [])

  const hasSelection = selection.start !== selection.end

  function applyWrap(wrapFn, ...args) {
    const el = textareaRef.current
    if (!el) return
    const { start, end } = selection
    if (start === end) return

    const newValue = wrapFn(value, start, end, ...args)
    onChange(newValue)

    setTimeout(() => {
      el.focus()
      // Keep original text selected (adjusted for markup tags)
      const tagLen = newValue.length - value.length
      const selStart = start
      const selEnd = end + tagLen
      el.setSelectionRange(selStart, selEnd)
    }, 0)
  }

  function applyColor(color) {
    const el = textareaRef.current
    if (!el) return
    const { start, end } = selection
    if (start === end) return

    const newValue = wrapWithColor(value, start, end, color)
    onChange(newValue)

    setTimeout(() => {
      el.focus()
      const newPos = start + `[color=${color}]`.length
      el.setSelectionRange(newPos, newPos + (end - start))
    }, 0)
  }

  // 富文本操作 — 支持左右双栏
  function applyRichFormat(type, arg) {
    // 根据最后聚焦的面板决定操作目标
    if (activePane.current === 'right' && richRef.current) {
      const range = savedSel.current?.range
      // 安全检查：range 为空或不在右侧编辑器内 → 回退左侧
      if (!range || !richRef.current.contains(range.commonAncestorContainer)) {
        savedSel.current = null
        if (type === 'bold') applyWrap(wrapWithBold)
        else if (type === 'italic') applyWrap(wrapWithItalic)
        else if (type === 'color') applyColor(arg)
        return
      }
      const sel = window.getSelection()
      sel.removeAllRanges()
      sel.addRange(range)
      richRef.current.focus()

      const fragment = range.extractContents()
      if (!fragment?.textContent) { savedSel.current = null; return }

      let wrapper
      if (type === 'color') {
        wrapper = document.createElement('span')
        wrapper.style.color = arg
      } else if (type === 'bold') {
        wrapper = document.createElement('b')
      } else if (type === 'italic') {
        wrapper = document.createElement('i')
      }
      wrapper.appendChild(fragment)
      range.insertNode(wrapper)
      // 重新选中 wrapper 内的文字
      sel.removeAllRanges()
      const newRange = document.createRange()
      if (wrapper.childNodes.length === 1 && wrapper.firstChild.nodeType === Node.TEXT_NODE) {
        newRange.setStart(wrapper.firstChild, 0)
        newRange.setEnd(wrapper.firstChild, wrapper.textContent.length)
      } else {
        newRange.selectNodeContents(wrapper)
      }
      sel.addRange(newRange)
      savedSel.current = null // 避免下次误用旧 range
      onChangeRef.current(htmlToMarkup(richRef.current))
      return
    }
    // 左侧 textarea
    if (type === 'bold') applyWrap(wrapWithBold)
    else if (type === 'italic') applyWrap(wrapWithItalic)
    else if (type === 'color') applyColor(arg)
  }

  // 递归去除 fragment 中所有格式标签（b/i/span/font/note），保留纯文本
  function stripAllTags(frag) {
    const result = document.createDocumentFragment()
    function extractText(node, target) {
      for (const child of [...node.childNodes]) {
        if (child.nodeType === Node.TEXT_NODE) {
          target.appendChild(document.createTextNode(child.textContent))
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          const tag = child.tagName.toLowerCase()
          if (tag === 'b' || tag === 'i' || tag === 'span' || tag === 'font' || tag === 'strong' || tag === 'em' || child.classList?.contains('note')) {
            extractText(child, target) // 递归进入，跳过标签
          } else {
            target.appendChild(child.cloneNode(true))
          }
        }
      }
    }
    extractText(frag, result)
    return result
  }

  function clearAllFormats() {
    const el = textareaRef.current
    if (!el) return
    const { start, end } = selection
    if (start === end) return

    // Find all BBCode tag positions
    const tagRe = /\[(\/)?(color=(?:#[0-9a-fA-F]{3,8}|[a-zA-Z]+)|color|b|i|note="[^"]*"|note)\]/g
    const allTags = []
    let m
    while ((m = tagRe.exec(value)) !== null) {
      const isClose = m[1] === '/'
      const raw = m[2]
      let kind
      if (raw === 'color' && isClose) kind = '/color'
      else if (raw.startsWith('color=')) kind = 'color'
      else if (raw === 'b') kind = isClose ? '/b' : 'b'
      else if (raw === 'i') kind = isClose ? '/i' : 'i'
      else if (raw.startsWith('note=')) kind = 'note'
      else if (raw === 'note' && isClose) kind = '/note'
      else continue
      allTags.push({ idx: m.index, len: m[0].length, kind })
    }

    // Iteratively expand range to include wrapping tag pairs
    let stripStart = start, stripEnd = end
    let changed = true
    while (changed) {
      changed = false
      const stack = []
      for (const tag of allTags) {
        if (tag.kind.endsWith('/color') || tag.kind === '/b' || tag.kind === '/i' || tag.kind === '/note') {
          // Closing tag — match with last matching open
          const openKind = tag.kind.slice(1) // '/color' → 'color'
          for (let i = stack.length - 1; i >= 0; i--) {
            if (stack[i].kind === openKind) {
              const openTag = stack[i]
              // Check if this pair wraps the current selection range
              if (openTag.idx < stripStart && tag.idx + tag.len > stripEnd) {
                if (openTag.idx < stripStart) { stripStart = openTag.idx; changed = true }
                if (tag.idx + tag.len > stripEnd) { stripEnd = tag.idx + tag.len; changed = true }
              }
              stack.splice(i, 1) // remove matched open
              break
            }
          }
        } else {
          stack.push(tag)
        }
      }
    }

    // Strip all BBCode tags from the expanded region
    const expanded = value.slice(stripStart, stripEnd)
    const cleaned = expanded.replace(tagRe, '')
    const newValue = value.slice(0, stripStart) + cleaned + value.slice(stripEnd)
    onChange(newValue)

    setTimeout(() => {
      el.focus()
      el.setSelectionRange(stripStart, stripStart + cleaned.length)
    }, 0)
  }

  // ── 附注操作 ──
  function openNoteModal() {
    // 右侧 editor — 保存选区，稍后在 applyNote 中使用
    if (activePane.current === 'right' && richRef.current) {
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed) return
      savedRange.current = sel.getRangeAt(0).cloneRange()
      const container = savedRange.current.commonAncestorContainer
      const noteEl = container.nodeType === 1 ? container.closest?.('.note') : container.parentElement?.closest?.('.note')
      if (noteEl) {
        setNoteContent(noteEl.dataset?.note || '')
        setEditingNote(true)
      } else {
        setNoteContent('')
        setEditingNote(false)
      }
      setNoteModalOpen(true)
      return
    }
    // 左侧 textarea
    const { start, end } = selection
    if (start === end) return
    const selected = value.slice(start, end)
    const existingMatch = selected.match(/^\[note="([^"]*)"\]([\s\S]*)\[\/note\]$/)
    if (existingMatch) {
      setNoteContent(existingMatch[1].replace(/&quot;/g, '"'))
      setEditingNote(true)
    } else {
      setNoteContent('')
      setEditingNote(false)
    }
    setNoteModalOpen(true)
  }

  function openEditNoteAtCursor() {
    const el = textareaRef.current
    if (!el) return
    const pos = el.selectionStart
    const info = getNoteAtPosition(value, pos)
    if (info) {
      setNoteContent(info.noteText)
      setEditingNote(true)
      setSelection({ start: info.noteStart, end: info.noteEnd })
      setNoteModalOpen(true)
    }
  }

  // ── 附注编辑区粘贴转换 ──
  function handleNotePaste(e) {
    const html = e.clipboardData?.getData('text/html')
    if (!html) return
    e.preventDefault()
    const tmp = document.createElement('div')
    tmp.innerHTML = html
    const markup = htmlToMarkup(tmp)
    if (!markup) return
    const ta = e.target
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const before = noteContent.slice(0, start)
    const after = noteContent.slice(end)
    setNoteContent(before + markup + after)
    setTimeout(() => {
      ta.selectionStart = ta.selectionEnd = start + markup.length
    }, 0)
  }

  function applyNote() {
    // 右侧 editor
    if (activePane.current === 'right' && richRef.current && savedRange.current) {
      const range = savedRange.current
      savedRange.current = null
      const container = range.commonAncestorContainer
      const existingNote = container.nodeType === 1 ? container.closest?.('.note') : container.parentElement?.closest?.('.note')
      
      if (editingNote && existingNote) {
        // 编辑已有附注：只更新 data-note 和 title
        existingNote.dataset.note = noteContent
        existingNote.title = noteContent
        setNoteModalOpen(false)
        richRef.current.focus()
        setTimeout(() => { if (richRef.current) onChangeRef.current(htmlToMarkup(richRef.current)) }, 0)
        return
      }

      // 新建附注
      const text = range.toString()
      if (!text) { setNoteModalOpen(false); return }
      range.deleteContents()
      const span = document.createElement('span')
      span.className = 'note'
      span.dataset.note = noteContent
      span.title = noteContent
      span.textContent = text
      range.insertNode(span)
      setNoteModalOpen(false)
      richRef.current.focus()
      setTimeout(() => { if (richRef.current) onChangeRef.current(htmlToMarkup(richRef.current)) }, 0)
      return
    }
    // 左侧 textarea
    const el = textareaRef.current
    if (!el) return
    const { start, end } = selection
    if (start === end) return

    if (editingNote) {
      const before = value.slice(0, start)
      const selected = value.slice(start, end)
      const after = value.slice(end)
      const noteTagRegex = /^\[note="([^"]*)"\]([\s\S]*)\[\/note\]$/
      const existingMatch = selected.match(noteTagRegex)
      if (existingMatch) {
        onChange(before + `[note="${noteContent.replace(/"/g, '&quot;')}"]${existingMatch[2]}[/note]` + after)
      }
    } else {
      onChange(wrapWithNote(value, start, end, noteContent))
    }
    setNoteModalOpen(false)
    setTimeout(() => { el.focus() }, 0)
  }

  function removeCurrentNote() {
    if (activePane.current === 'right' && richRef.current) {
      if (savedRange.current) {
        const range = savedRange.current
        savedRange.current = null
        const container = range.commonAncestorContainer
        const noteEl = container.nodeType === 1 ? container.closest?.('.note') : container.parentElement?.closest?.('.note')
        if (noteEl) {
          const text = noteEl.textContent
          noteEl.replaceWith(document.createTextNode(text))
          setNoteModalOpen(false)
          richRef.current.focus()
          setTimeout(() => { if (richRef.current) onChangeRef.current(htmlToMarkup(richRef.current)) }, 0)
          return
        }
      }
      setNoteModalOpen(false)
      return
    }
    // 左侧
    const el = textareaRef.current
    if (!el) return
    const { start, end } = selection
    onChange(unwrapNote(value, start, end))
    setNoteModalOpen(false)
    setTimeout(() => { el.focus(); el.setSelectionRange(Math.min(start, value.length), Math.min(start, value.length)) }, 0)
  }

  // ── 附注弹窗内的迷你编辑器操作 ──
  function getNoteSel() {
    const el = noteTextareaRef.current
    if (!el) return { start: 0, end: 0 }
    return { start: el.selectionStart, end: el.selectionEnd }
  }

  function applyNoteFormat(wrapFn, ...args) {
    const el = noteTextareaRef.current
    if (!el) return
    const { start, end } = getNoteSel()
    if (start === end) return
    const newVal = wrapFn(noteContent, start, end, ...args)
    setNoteContent(newVal)
    setTimeout(() => {
      el.focus()
      el.setSelectionRange(Math.min(start, newVal.length), Math.min(start, newVal.length))
    }, 0)
  }

  function applyNoteColor(color) {
    const el = noteTextareaRef.current
    if (!el) return
    const { start, end } = getNoteSel()
    if (start === end) return
    const newVal = wrapWithColor(noteContent, start, end, color)
    setNoteContent(newVal)
    setTimeout(() => {
      el.focus()
      const newPos = start + `[color=${color}]`.length
      el.setSelectionRange(newPos, newPos + (end - start))
    }, 0)
  }

  // 在附注中插入元素图标 {id}
  function insertNoteElement(elemId) {
    const el = noteTextareaRef.current
    if (!el) return
    const start = el.selectionStart
    const end = el.selectionEnd
    const marker = `{${elemId}}`
    const newVal = noteContent.slice(0, start) + marker + noteContent.slice(end)
    setNoteContent(newVal)
    setTimeout(() => {
      el.focus()
      const newPos = start + marker.length
      el.setSelectionRange(newPos, newPos)
    }, 0)
  }

  function removeNoteColor() {
    const el = noteTextareaRef.current
    if (!el) return
    const { start, end } = getNoteSel()
    if (start === end) return
    setNoteContent(unwrapColor(noteContent, start, end))
    setTimeout(() => el.focus(), 0)
  }

  const onNoteDragStart = useCallback((e) => {
    e.preventDefault()
    noteDragging.current = true
    const startY = e.clientY
    const startRows = noteRows
    function onMove(ev) {
      const dy = ev.clientY - startY
      setNoteRows(Math.max(2, Math.min(15, startRows + Math.round(dy / 18))))
    }
    function onUp() {
      noteDragging.current = false
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [noteRows])

  // Ctrl+Enter 在编辑模式下切回预览
  function handleKeyDown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      setPreview(true)
    }
  }

  // ── 渲染富文本（预览用）──
  function renderPreview() {
    if (!value) return placeholder
      ? <span className="text-surface-500">{placeholder}</span>
      : null
    const parsed = parseColorMarkup(value)
    if (typeof parsed === 'string') return parsed
    if (Array.isArray(parsed)) {
      return parsed.map((el, i) =>
        typeof el === 'string' ? el : { ...el, key: i }
      )
    }
    return parsed
  }

  // 共享的文本样式
  const previewStyle =
    'px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words'
  const sourceStyle =
    'px-3 py-2 text-sm font-mono leading-relaxed whitespace-pre-wrap break-words'

  // 渲染附注内容（支持 {id} 元素图标标记）
  function renderNotePreviewContent(text) {
    if (!text) return null
    const regex = /\{(\d+)\}/g
    const parts = []
    let lastIdx = 0
    let match
    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIdx) {
        parts.push(...[].concat(parseColorMarkup(text.slice(lastIdx, match.index))))
      }
      const elemId = parseInt(match[1])
      const name = ELEM_ID_TO_NAME[elemId] || ''
      const si = ELEM_ID_TO_SETTINGS_INDEX[elemId]
      const c = si != null ? colors[si] : null
      const iconData = c?.icon ? elementIcons[c.icon] : null
      if (iconData) {
        parts.push(<img key={`ni-${lastIdx}`} src={iconData} alt={name} className="w-4 h-4 inline-block align-middle rounded-sm" />)
      } else if (c) {
        parts.push(<span key={`ni-${lastIdx}`} className="inline-block align-middle px-0.5 text-[10px] font-medium rounded-sm" style={{ backgroundColor: c.color + '20', color: c.color }}>{name}</span>)
      } else {
        parts.push(<span key={`ni-${lastIdx}`} className="text-surface-500">{match[0]}</span>)
      }
      lastIdx = match.index + match[0].length
    }
    if (lastIdx < text.length) {
      parts.push(...[].concat(parseColorMarkup(text.slice(lastIdx))))
    }
    return parts.length === 1 ? parts[0] : parts
  }

  return (
    <div>
      {/* 富文本工具栏 */}
      <div className="flex flex-wrap items-center gap-1.5 px-3 py-1.5 bg-surface-850 border border-surface-600 border-b-0 rounded-t-lg"
        onMouseDown={() => {
          // 在按钮抢走焦点前保存右侧编辑区选区
          if (activePane.current === 'right') {
            const sel = window.getSelection()
            if (sel && !sel.isCollapsed && richRef.current?.contains(sel.anchorNode)) {
              savedSel.current = { range: sel.getRangeAt(0).cloneRange(), text: sel.toString() }
            } else {
              savedSel.current = null
            }
          }
        }}
      >
        {/* 预览开关 */}
        <button
          type="button"
          onClick={() => {
            if (preview) {
              enterEdit()
            } else {
              setPreview(true)
            }
          }}
          className={`p-1.5 rounded transition-colors ${
            preview
              ? 'text-primary-400 bg-primary-500/10'
              : 'text-surface-400 hover:text-white hover:bg-surface-700'
          }`}
          title={preview ? '预览中 — 点击文本或此按钮进入编辑' : '编辑中 — 点击切回预览'}
        >
          {preview ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
        </button>

        <div className="w-px h-5 bg-surface-600 mx-0.5" />

        {/* 粗体 */}
        <button
          type="button"
          onClick={() => applyRichFormat('bold')}
          disabled={preview}
          className={`p-1.5 rounded transition-colors ${
            preview
              ? 'text-surface-600 cursor-not-allowed'
              : 'text-surface-300 hover:text-white hover:bg-surface-700'
          }`}
          title="粗体"
        >
          <Bold className="w-3.5 h-3.5" />
        </button>
        {/* 斜体 */}
        <button
          type="button"
          onClick={() => applyRichFormat('italic')}
          disabled={preview}
          className={`p-1.5 rounded transition-colors ${
            preview
              ? 'text-surface-600 cursor-not-allowed'
              : 'text-surface-300 hover:text-white hover:bg-surface-700'
          }`}
          title="斜体"
        >
          <Italic className="w-3.5 h-3.5" />
        </button>

        <div className="w-px h-5 bg-surface-600 mx-1" />

        {/* 附注 — 自动判断添加/编辑 */}
        <button
          type="button"
          onClick={() => {
            if (activePane.current === 'right') {
              openNoteModal()
            } else if (getNoteAtPosition(value, textareaRef.current?.selectionStart || 0)) {
              openEditNoteAtCursor()
            } else {
              openNoteModal()
            }
          }}
          disabled={preview || (
            activePane.current === 'left' && selection.start === selection.end && !getNoteAtPosition(value, textareaRef.current?.selectionStart || 0)
          )}
          className={`p-1.5 rounded transition-colors ${
            preview
              ? 'text-surface-600 cursor-not-allowed'
              : 'text-amber-400 hover:text-amber-300 hover:bg-surface-700'
          }`}
          title={getNoteAtPosition(value, textareaRef.current?.selectionStart || 0) ? '编辑附注' : '添加附注'}
        >
          <StickyNote className="w-3.5 h-3.5" />
        </button>

        <div className="w-px h-5 bg-surface-600 mx-0.5" />

        {/* 清除所有格式 */}
        <button
          type="button"
          onClick={() => {
            if (activePane.current === 'right' && richRef.current) {
              const range = savedSel.current?.range
              if (range && range.commonAncestorContainer && richRef.current.contains(range.commonAncestorContainer)) {
                const frag = range.extractContents() // 提取选区（含所有标签）
                const plain = document.createDocumentFragment()
                // 递归提取纯文本
                function collectText(node, target) {
                  for (const child of [...node.childNodes]) {
                    if (child.nodeType === Node.TEXT_NODE) {
                      target.appendChild(document.createTextNode(child.textContent))
                    } else if (child.nodeType === Node.ELEMENT_NODE) {
                      collectText(child, target)
                    }
                  }
                }
                collectText(frag, plain)
                range.insertNode(plain)
                range.collapse(false)
                const s = window.getSelection()
                s.removeAllRanges()
                s.addRange(range)
              }
              onChangeRef.current(htmlToMarkup(richRef.current))
            } else {
              clearAllFormats()
            }
          }}
          disabled={preview}
          className={`p-1.5 rounded transition-colors ${
            preview ? 'text-surface-600 cursor-not-allowed' : 'text-surface-300 hover:text-red-400 hover:bg-surface-700'
          }`}
          title="清除格式"
        >
          <Eraser className="w-3.5 h-3.5" />
        </button>

        {/* 元素颜色（图标按钮） */}
        <div className="w-px h-5 bg-surface-600 mx-0.5" />
        {colors.slice(0, 7).map(({ label, color, icon }) => {
          const iconData = icon ? elementIcons[icon] : null
          return (
            <button
              key={label}
              type="button"
              onClick={() => !preview && applyRichFormat('color', color)}
              disabled={preview}
              className={`w-6 h-6 rounded transition-all flex items-center justify-center ${
                preview ? 'cursor-not-allowed opacity-40' : 'hover:scale-110 cursor-pointer'
              }`}
              style={iconData ? {} : { backgroundColor: color }}
              title={`${label}色`}
            >
              {iconData ? (
                <img src={iconData} alt={label} className="w-full h-full object-contain rounded" />
              ) : null}
            </button>
          )
        })}

        {/* 基础颜色（圆点） */}
        <div className="w-px h-5 bg-surface-600 mx-0.5" />
        {colors.slice(7).map(({ label, color }) => (
          <button
            key={color}
            type="button"
            onClick={() => !preview && applyRichFormat('color', color)}
            disabled={preview}
            className={`w-5 h-5 rounded-full border-2 transition-all ${
              preview
                ? 'cursor-not-allowed border-transparent opacity-40'
                : 'hover:scale-125 cursor-pointer border-surface-500'
            }`}
            style={{ backgroundColor: color }}
            title={`${label}色`}
          />
        ))}

        {/* 自定义颜色 */}
        <input
          type="color"
          onChange={e => !preview && applyRichFormat('color', e.target.value)}
          disabled={preview}
          className={`w-5 h-5 rounded cursor-pointer border-0 p-0 bg-transparent ${
            preview ? 'opacity-40 pointer-events-none' : ''
          }`}
          title="自定义颜色"
        />

        {/* 快捷键提示 */}
        {!preview && (
          <span className="ml-auto text-[10px] text-surface-500 select-none">Ctrl+Enter 预览</span>
        )}
      </div>

      {/* 编辑区 */}
      <div>
        {/* 预览模式：渲染富文本 */}
        {preview && (
          <div
            className={`${previewStyle} bg-surface-800 border-x border-surface-600 text-white cursor-text
                       hover:ring-1 hover:ring-primary-500/20 transition-shadow`}
            style={{ minHeight: `${textRows * 1.625 + 1}em` }}
            onClick={enterEdit}
            title="点击进入编辑"
          >
            {renderPreview()}
          </div>
        )}

        {/* 编辑模式：左侧源码 + 右侧所见即所得 */}
        {!preview && (
          <div className="flex gap-0">
            <textarea
              ref={textareaRef}
              value={value}
              onChange={e => onChange(e.target.value)}
              onSelect={handleSelect}
              onFocus={() => { activePane.current = 'left'; handleSelect() }}
              onClick={handleSelect}
              onPaste={handlePaste}
              onKeyUp={handleSelect}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              rows={textRows}
              className={`${sourceStyle} bg-surface-800 border border-surface-600 w-1/2
                           text-white placeholder-surface-500
                           focus:outline-none focus:ring-1 focus:ring-primary-500/20
                           transition-colors resize-none rounded-none ${className}`}
              {...props}
            />
            <div
              ref={richRef}
              contentEditable
              suppressContentEditableWarning
              onFocus={() => { activePane.current = 'right' }}
              onPaste={handlePaste}
              onContextMenu={(e) => {
                const noteEl = e.target.closest?.('.note')
                if (noteEl) {
                  e.preventDefault()
                  // 保存选区
                  const sel = window.getSelection()
                  sel.removeAllRanges()
                  const range = document.createRange()
                  range.selectNodeContents(noteEl)
                  sel.addRange(range)
                  savedRange.current = range.cloneRange()
                  setNoteContent(noteEl.dataset?.note || '')
                  setEditingNote(true)
                  setNoteModalOpen(true)
                }
              }}
              onInput={(e) => {
                const markup = htmlToMarkup(e.currentTarget)
                onChange(markup)
              }}
              onBlur={() => {
                if (richRef.current) {
                  const markup = htmlToMarkup(richRef.current)
                  onChange(markup)
                }
              }}
              className={`${previewStyle} bg-surface-850 border border-surface-600 border-l-0 w-1/2
                           text-white overflow-y-auto outline-none focus:ring-1 focus:ring-primary-500/20`}
              style={{ minHeight: `${textRows * 1.625 + 1}em` }}
            />
          </div>
        )}
      </div>

      {/* 拖拽调节条 */}
      <div
        onMouseDown={onDragStart}
        className="flex items-center justify-center h-5 bg-surface-850 border border-surface-600 border-t-0 rounded-b-lg
                   cursor-s-resize hover:bg-surface-700 transition-colors group select-none"
        title="拖拽调节高度"
      >
        <GripHorizontal className="w-8 h-3 text-surface-600 group-hover:text-surface-400 transition-colors" />
      </div>

      {/* 附注编辑弹窗（轻量版） */}
      {noteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setNoteModalOpen(false)} />
          <div className="relative bg-surface-800 border border-surface-600 rounded-xl w-full max-w-xl shadow-2xl">
            {/* 标题栏 */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-surface-700">
              <h3 className="text-sm font-semibold text-white">
                {editingNote ? '编辑附注' : '添加附注'}
              </h3>
              <button
                onClick={() => setNoteModalOpen(false)}
                className="p-1 rounded-lg text-surface-400 hover:text-white hover:bg-surface-700 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 迷你工具栏 */}
            <div className="flex items-center gap-1 px-3 py-1.5 bg-surface-850 border-b border-surface-600">
              <button type="button" onClick={() => applyNoteFormat(wrapWithBold)}
                className="p-1 rounded text-surface-300 hover:text-white hover:bg-surface-700 transition-colors" title="粗体">
                <Bold className="w-3 h-3" />
              </button>
              <button type="button" onClick={() => applyNoteFormat(wrapWithItalic)}
                className="p-1 rounded text-surface-300 hover:text-white hover:bg-surface-700 transition-colors" title="斜体">
                <Italic className="w-3 h-3" />
              </button>
              <div className="w-px h-4 bg-surface-600 mx-0.5" />
              <button type="button" onClick={removeNoteColor}
                className="p-1 rounded text-surface-300 hover:text-red-400 hover:bg-surface-700 transition-colors" title="清除颜色">
                <Eraser className="w-3 h-3" />
              </button>
              <div className="w-px h-4 bg-surface-600 mx-0.5" />
              {/* 元素图标 */}
              {colors.slice(0, 7).map(({ label, color, icon }, i) => {
                const iconData = icon ? elementIcons[icon] : null
                // Use shared ELEM_NAME_TO_ID for correct mapping
                const elemId = ELEM_NAME_TO_ID[label]
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => insertNoteElement(elemId)}
                    className="w-5 h-5 rounded flex items-center justify-center hover:scale-110 transition-transform"
                    style={iconData ? {} : { backgroundColor: color }}
                    title={`插入${label}元素图标`}
                  >
                    {iconData ? (
                      <img src={iconData} alt={label} className="w-full h-full object-contain rounded-sm" />
                    ) : (
                      <span className="text-[8px] font-medium" style={{ color: '#fff' }}>{label}</span>
                    )}
                  </button>
                )
              })}
              <div className="w-px h-4 bg-surface-600 mx-0.5" />
              {colors.slice(0, 8).map(({ label, color, icon }) => (
                <button key={label} type="button" onClick={() => applyNoteColor(color)}
                  className="w-4 h-4 rounded-full border border-surface-500 hover:scale-125 transition-transform"
                  style={{ backgroundColor: color }} title={`${label}色`} />
              ))}
              <input type="color" onChange={e => applyNoteColor(e.target.value)}
                className="w-4 h-4 rounded cursor-pointer border-0 p-0 bg-transparent" title="自定义颜色" />
            </div>

            {/* 正文 */}
            <div className="px-4 py-3 space-y-2">
              <textarea
                ref={noteTextareaRef}
                value={noteContent}
                onChange={e => setNoteContent(e.target.value)}
                onPaste={handleNotePaste}
                placeholder="输入附注内容（支持换行、粗体、斜体、颜色）..."
                rows={noteRows}
                className={`${sourceStyle} w-full bg-surface-900 border border-surface-600 rounded-lg
                             text-white placeholder-surface-500 resize-none
                             focus:outline-none focus:ring-1 focus:ring-primary-500/30`}
                autoFocus
              />
              {/* 附注预览 */}
              {noteContent && (
                <div className={`${previewStyle} bg-surface-900 border border-surface-600 rounded-lg text-surface-300`}>
                  <span className="text-surface-500 mr-1 select-none">预览:</span>
                  {renderNotePreviewContent(noteContent)}
                </div>
              )}
            </div>

            {/* 拖拽调节条 */}
            <div onMouseDown={onNoteDragStart}
              className="flex items-center justify-center h-4 bg-surface-850 border-t border-surface-600
                         cursor-s-resize hover:bg-surface-700 transition-colors group select-none"
              title="拖拽调节高度">
              <GripHorizontal className="w-6 h-2.5 text-surface-600 group-hover:text-surface-400 transition-colors" />
            </div>

            {/* 底部按钮 */}
            <div className="flex items-center justify-between px-4 py-2.5 border-t border-surface-700">
              {editingNote && (
                <button onClick={removeCurrentNote}
                  className="px-3 py-1.5 rounded-lg text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors">
                  删除附注
                </button>
              )}
              <div className="flex items-center gap-2 ml-auto">
                <button onClick={() => setNoteModalOpen(false)}
                  className="px-4 py-1.5 rounded-lg text-sm text-surface-400 hover:text-white hover:bg-surface-700 transition-colors">
                  取消
                </button>
                <button onClick={applyNote}
                  className="px-4 py-1.5 rounded-lg text-sm bg-primary-600 hover:bg-primary-500 text-white transition-colors">
                  确认
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

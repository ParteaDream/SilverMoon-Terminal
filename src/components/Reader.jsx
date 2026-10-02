/**
 * Reader.jsx — 通用全屏阅读器（书籍卷章 / 角色故事共用）
 *
 * 原本是 CharacterDetailPage.jsx 里的 StoryReader，只能读角色故事（固定三主题 +
 * 章节/滚动双模式）。书籍的正文是多卷结构，与角色故事的需求完全一致，因此抽到这里
 * 共用，并顺带补了三件原来没有的事：
 *   · 阅读进度记忆：按 progressKey 记住上次读到第几章，再次打开直接续读
 *   · 字号调节：小 / 中 / 大 / 特大，与主题、模式一起存进 user.json
 *   · 目录带序号，长目录（《白之公主与六侏儒》七卷）一眼能看出读到哪
 *
 * 快捷键：Esc 关闭，F 切换滚动/章节模式，章节模式下 A/D 或 ←/→ 翻章。
 * 章节内容交给 BookContent 渲染：段落文字（[color=…]/[b] 标记由 ColoredSpan 解析，
 * 不用 ColoredText 是因为后者强制 text-white、会盖掉三套主题的正文色）与
 * `[img:文件名]` 插图块混排，插图点击后交给通用图片观看器（Lightbox）。
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { X, BookOpen, FileText, Type, List } from 'lucide-react'
import BookContent, { ContentImageCount } from './BookContent'
import Lightbox from './Lightbox'

// ═══════════════════════════════════════════════
// 主题
// ═══════════════════════════════════════════════
export const READER_THEMES = {
  dark: {
    name: '暗色', bg: 'bg-[#1a1a2e]', card: 'bg-[#1f1f35]',
    text: 'text-[#c8c8d4]', textMuted: 'text-[#8888a0]', heading: 'text-[#e0e0f0]',
    chapterText: 'text-white/70', chapterHover: 'hover:text-white/90 hover:bg-white/8',
    buttonBg: 'bg-white/8', buttonHover: 'hover:bg-white/14', buttonText: 'text-white/70',
    buttonActive: 'bg-white/14 text-white', border: 'border-[#2a2a45]', borderSubtle: 'border-white/8',
    chapterActive: 'bg-primary-500/12 text-primary-400 border-l-2 border-primary-500',
    chapterInactive: 'text-white/70 border-l-2 border-transparent',
    toggleBg: 'bg-white/10', toggleActive: 'bg-white/18 text-white', toggleInactive: 'text-white/35 hover:text-white/60',
    hint: 'rgba(255,255,255,0.3)',
  },
  sepia: {
    name: '仿古', bg: 'bg-[#f5ecd7]', card: 'bg-[#ede0c8]',
    text: 'text-[#5c4b3a]', textMuted: 'text-[#8b7b6a]', heading: 'text-[#3d2b1a]',
    chapterText: 'text-[#3d2b1a]/75', chapterHover: 'hover:text-[#2a1808] hover:bg-[#d4c4a8]/40',
    buttonBg: 'bg-[#d4c4a8]/60', buttonHover: 'hover:bg-[#c8b490]/70', buttonText: 'text-[#5c4b3a]/70',
    buttonActive: 'bg-[#c8b490]/70 text-[#3d2b1a]', border: 'border-[#d4c4a8]', borderSubtle: 'border-[#d4c4a8]/50',
    chapterActive: 'bg-[#c8a060]/20 text-[#8b6020] border-l-2 border-[#c8a060]',
    chapterInactive: 'text-[#3d2b1a]/75 border-l-2 border-transparent',
    toggleBg: 'bg-[#d4c4a8]/50', toggleActive: 'bg-[#c8b490]/70 text-[#3d2b1a]', toggleInactive: 'text-[#5c4b3a]/40 hover:text-[#5c4b3a]/60',
    hint: 'rgba(61,43,26,0.35)',
  },
  light: {
    name: '亮色', bg: 'bg-[#fafaf9]', card: 'bg-[#f2f1ef]',
    text: 'text-[#2d2d2d]', textMuted: 'text-[#7a7a7a]', heading: 'text-[#1a1a1a]',
    chapterText: 'text-[#1a1a1a]/75', chapterHover: 'hover:text-[#0a0a0a] hover:bg-[#e8e8e6]/70',
    buttonBg: 'bg-[#e8e8e6]', buttonHover: 'hover:bg-[#dddcd8]', buttonText: 'text-[#2d2d2d]/70',
    buttonActive: 'bg-[#e0e0de] text-[#1a1a1a]', border: 'border-[#e0e0de]', borderSubtle: 'border-[#e8e8e6]',
    chapterActive: 'bg-primary-500/8 text-primary-600 border-l-2 border-primary-500',
    chapterInactive: 'text-[#1a1a1a]/75 border-l-2 border-transparent',
    toggleBg: 'bg-[#e8e8e6]', toggleActive: 'bg-[#e0e0de] text-[#1a1a1a]', toggleInactive: 'text-[#2d2d2d]/35 hover:text-[#2d2d2d]/55',
    hint: 'rgba(10,10,10,0.3)',
  },
}

export const READER_THEME_SWATCHES = { dark: '#1a1a2e', sepia: '#d4b896', light: '#fafaf9' }

/** 正文字号档位（px），与主题/模式一起记进 user.json */
export const READER_FONT_SIZES = [
  { key: 'sm', label: '小', px: 13 },
  { key: 'md', label: '中', px: 14 },
  { key: 'lg', label: '大', px: 16 },
  { key: 'xl', label: '特大', px: 18 },
]

// ═══════════════════════════════════════════════
// 阅读偏好（主题 / 模式 / 字号）—— 模块级缓存，全局共用一份
// ═══════════════════════════════════════════════
const DEFAULT_PREFS = { theme: 'dark', mode: 'scroll', fontSize: 'md' }
let _prefs = { ...DEFAULT_PREFS }
let _prefsLoaded = false
let _prefsPromise = null
const _prefsListeners = new Set()

function notifyPrefs() {
  for (const fn of _prefsListeners) { try { fn({ ..._prefs }) } catch (_) {} }
}

/** 首次使用时从 user.json 读一次，之后所有 Reader 实例共享 */
export function loadReaderPrefs() {
  if (_prefsPromise) return _prefsPromise
  _prefsPromise = (async () => {
    try {
      const res = await window.electronAPI?.getUserConfig?.()
      const cfg = (res && res.config) || {}
      if (cfg.readerTheme && READER_THEMES[cfg.readerTheme]) _prefs.theme = cfg.readerTheme
      if (cfg.readerMode === 'scroll' || cfg.readerMode === 'chapter') _prefs.mode = cfg.readerMode
      if (cfg.readerFontSize && READER_FONT_SIZES.some(f => f.key === cfg.readerFontSize)) _prefs.fontSize = cfg.readerFontSize
    } catch (_) { /* 用默认值 */ }
    _prefsLoaded = true
    notifyPrefs()
    return { ..._prefs }
  })()
  return _prefsPromise
}

export function setReaderPref(key, value) {
  if (_prefs[key] === value) return
  _prefs = { ..._prefs, [key]: value }
  notifyPrefs()
  const cfgKey = key === 'theme' ? 'readerTheme' : key === 'mode' ? 'readerMode' : 'readerFontSize'
  try { window.electronAPI?.setUserConfig(cfgKey, value) } catch (_) {}
}

/** 订阅偏好变化（Reader 内部用；偏好是模块级单例，跨实例同步） */
function useReaderPrefs() {
  const [prefs, setPrefs] = useState({ ..._prefs })
  useEffect(() => {
    _prefsListeners.add(setPrefs)
    if (!_prefsLoaded) loadReaderPrefs()
    else setPrefs({ ..._prefs })
    return () => { _prefsListeners.delete(setPrefs) }
  }, [])
  return prefs
}

// ═══════════════════════════════════════════════
// 阅读进度（按 progressKey 记在 localStorage）
// ═══════════════════════════════════════════════
const PROGRESS_PREFIX = 'reader_progress:'

export function readReaderProgress(progressKey) {
  if (!progressKey) return 0
  try {
    const v = Number(localStorage.getItem(PROGRESS_PREFIX + progressKey))
    return Number.isFinite(v) && v > 0 ? v : 0
  } catch (_) { return 0 }
}

export function writeReaderProgress(progressKey, index) {
  if (!progressKey) return
  try { localStorage.setItem(PROGRESS_PREFIX + progressKey, String(index || 0)) } catch (_) {}
}

// ═══════════════════════════════════════════════
// 阅读器
// ═══════════════════════════════════════════════

/**
 * @param {object} props
 * @param {Array<{id?:any,title:string,content?:string,subtitle?:string}>} props.chapters 章节列表
 * @param {string} [props.title]     顶部标题（书名 / 角色名）
 * @param {string} [props.subtitle]  顶部副标题（默认「共 N 篇」）
 * @param {string} [props.progressKey] 进度记忆键（如 `book_12`）；不传则不记忆
 * @param {number} [props.initialChapter] 覆盖记忆的起始章
 * @param {string} [props.emptyText] 单章无正文时的占位文案
 */
export default function Reader({
  chapters,
  title,
  subtitle,
  progressKey,
  initialChapter,
  emptyText = '暂无内容',
  onClose,
  icon,
}) {
  const list = useMemo(() => (chapters || []).filter(Boolean), [chapters])
  const prefs = useReaderPrefs()
  const theme = READER_THEMES[prefs.theme] ? prefs.theme : 'dark'
  const mode = prefs.mode
  const t = READER_THEMES[theme]
  const fontPx = (READER_FONT_SIZES.find(f => f.key === prefs.fontSize) || READER_FONT_SIZES[1]).px

  const [activeIdx, setActiveIdx] = useState(() => {
    if (initialChapter != null) return Math.min(initialChapter, Math.max(0, list.length - 1))
    const saved = readReaderProgress(progressKey)
    return Math.min(saved, Math.max(0, list.length - 1))
  })
  const [animating, setAnimating] = useState(false)
  const [animDir, setAnimDir] = useState(1)
  // 插图观看器：**必须挂在阅读器顶层**。正文外面套着带 transform 的容器（章节切换
  // 动画的 translate-x-0），在里面渲染会让 Lightbox 的 `fixed inset-0` 变成相对那个
  // 容器定位、遮罩只盖住正文一栏。挂在顶层同时也让"观看器开着时让出 Esc/F/A/D"
  // 变成一个普通的状态判断。
  const [viewingImage, setViewingImage] = useState(null)
  const viewerOpen = !!viewingImage
  const contentRef = useRef(null)
  const scrollJumping = useRef(false)  // 侧栏点击跳转中，暂停 Observer 更新

  const chapter = list[activeIdx]
  const hasPrev = activeIdx > 0
  const hasNext = activeIdx < list.length - 1

  // 章节变化即记进度
  useEffect(() => {
    if (list.length > 0) writeReaderProgress(progressKey, activeIdx)
  }, [activeIdx, progressKey, list.length])

  const goToChapter = useCallback((idx) => {
    if (idx < 0 || idx >= list.length || animating) return
    setAnimDir(idx > activeIdx ? 1 : -1)
    setAnimating(true)
    setTimeout(() => { setActiveIdx(idx); setAnimating(false) }, 250)
  }, [activeIdx, list.length, animating])

  // ── 滚动模式：IntersectionObserver 自动高亮当前章 ──
  useEffect(() => {
    if (mode !== 'scroll' || !contentRef.current) return
    const visible = new Map()
    const observer = new IntersectionObserver(
      (entries) => {
        if (scrollJumping.current) return
        for (const entry of entries) {
          const idx = parseInt(entry.target.dataset.chapterIdx, 10)
          if (isNaN(idx)) continue
          if (entry.isIntersecting) visible.set(idx, Math.max(visible.get(idx) || 0, entry.intersectionRatio))
          else visible.delete(idx)
        }
        if (visible.size > 0) {
          let best = Infinity
          for (const idx of visible.keys()) if (idx < best) best = idx
          setActiveIdx(best)
        }
      },
      { root: contentRef.current, threshold: [0, 0.1, 0.3, 0.5, 0.7] }
    )
    contentRef.current.querySelectorAll('[data-chapter-idx]').forEach(el => observer.observe(el))
    return () => observer.disconnect()
  }, [mode, list])

  // ── 滚动模式：点击目录 → 滚到该章 ──
  const scrollToChapter = useCallback((idx) => {
    setActiveIdx(idx)
    if (mode === 'scroll' && contentRef.current) {
      scrollJumping.current = true
      const el = contentRef.current.querySelector('[data-chapter-idx="' + idx + '"]')
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      clearTimeout(scrollToChapter._timer)
      scrollToChapter._timer = setTimeout(() => { scrollJumping.current = false }, 800)
    } else {
      goToChapter(idx)
    }
  }, [mode, goToChapter])

  // ── 快捷键 ──
  useEffect(() => {
    const onKey = (e) => {
      if (viewerOpen) return          // 图片观看器在顶层，键位归它（它自己处理 Esc / +/-）
      if (e.key === 'Escape') { onClose?.(); return }
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault()
        setReaderPref('mode', mode === 'scroll' ? 'chapter' : 'scroll')
        return
      }
      if (mode === 'chapter' && ['a', 'A', 'd', 'D', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault()
        if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') goToChapter(activeIdx - 1)
        else goToChapter(activeIdx + 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, activeIdx, onClose, goToChapter, viewerOpen])

  // 章节模式切换时回到顶部（滚动模式不重置，由用户自由滚动）
  useEffect(() => {
    if (mode !== 'scroll' && contentRef.current) contentRef.current.scrollTop = 0
  }, [activeIdx, mode])

  // 切到滚动模式时定位到当前章，继承章节模式的阅读进度
  const prevMode = useRef(mode)
  useEffect(() => {
    if (mode === 'scroll' && prevMode.current !== 'scroll' && contentRef.current) {
      const el = contentRef.current.querySelector(`[data-chapter-idx="${activeIdx}"]`)
      if (el) el.scrollIntoView({ block: 'start' })
    }
    prevMode.current = mode
  }, [mode, activeIdx])

  if (list.length === 0) return null

  const total = list.length

  return (
    <div className="fixed inset-0 z-[250] flex no-drag">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" />
      <div className={`relative z-10 flex flex-1 m-3 sm:m-6 rounded-2xl overflow-hidden shadow-2xl border ${t.border} ${t.bg} animate-fade-in transition-colors duration-500`}>
        {/* ── 左侧目录 ── */}
        <div className={`w-52 lg:w-60 flex-shrink-0 border-r ${t.border} flex flex-col ${t.card} transition-colors duration-500`}>
          <div className={`px-4 py-3 border-b ${t.borderSubtle}`}>
            <h3 className={`text-sm font-semibold ${t.heading} truncate`} title={title}>{title || ''}</h3>
            <p className={`text-[10px] ${t.textMuted} mt-0.5`}>{subtitle || `共 ${total} 篇`}</p>
          </div>
          <div className="flex-1 overflow-y-auto py-2">
            {list.map((c, i) => (
              <button key={c.id != null ? c.id : i} tabIndex={-1} onMouseDown={e => e.preventDefault()} onClick={() => scrollToChapter(i)}
                className={`w-full text-left px-3 py-2.5 text-xs transition-colors duration-200 flex items-center gap-2 ${
                  i === activeIdx ? t.chapterActive : `${t.chapterText} ${t.chapterHover} border-l-2 border-transparent`
                }`}>
                <span className={`w-5 flex-shrink-0 text-[10px] tabular-nums ${i === activeIdx ? '' : t.textMuted}`}>{i + 1}</span>
                <FileText className="w-3 h-3 flex-shrink-0" />
                <span className="truncate flex-1">{c.title}</span>
              </button>
            ))}
          </div>
          <div className={`border-t ${t.borderSubtle} px-4 py-3 space-y-2.5 transition-colors duration-500`}>
            <div className="flex items-center gap-1.5">
              {Object.keys(READER_THEMES).map(th => (
                <div key={th} onClick={() => setReaderPref('theme', th)}
                  className="w-6 h-6 rounded-full border-2 transition-[border-color,box-shadow] duration-300 cursor-pointer"
                  style={{ backgroundColor: READER_THEME_SWATCHES[th], borderColor: theme === th ? 'rgb(129 140 248)' : 'rgba(255,255,255,0.15)' }}
                  onMouseEnter={e => { if (theme !== th) e.currentTarget.style.borderColor = 'rgba(255,255,255,0.6)' }}
                  onMouseLeave={e => { if (theme !== th) e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)' }}
                  title={READER_THEMES[th].name} />
              ))}
            </div>
            <div className={`flex items-center rounded-lg ${t.toggleBg} p-0.5 transition-colors duration-300`}>
              <button onMouseDown={e => e.preventDefault()} onClick={() => setReaderPref('mode', 'scroll')}
                className={`flex-1 py-1 rounded-md text-[10px] transition-colors duration-200 ${mode === 'scroll' ? t.toggleActive : t.toggleInactive}`}>滚动</button>
              <button onMouseDown={e => e.preventDefault()} onClick={() => setReaderPref('mode', 'chapter')}
                className={`flex-1 py-1 rounded-md text-[10px] transition-colors duration-200 ${mode === 'chapter' ? t.toggleActive : t.toggleInactive}`}>章节</button>
            </div>
            <div className={`flex items-center gap-1 rounded-lg ${t.toggleBg} p-0.5 transition-colors duration-300`}>
              <Type className={`w-3 h-3 mx-1 flex-shrink-0 ${t.textMuted}`} />
              {READER_FONT_SIZES.map(f => (
                <button key={f.key} onMouseDown={e => e.preventDefault()} onClick={() => setReaderPref('fontSize', f.key)}
                  className={`flex-1 py-1 rounded-md text-[10px] transition-colors duration-200 ${prefs.fontSize === f.key ? t.toggleActive : t.toggleInactive}`}>{f.label}</button>
              ))}
            </div>
            <div className="text-center text-[8px] pointer-events-none" style={{ color: t.hint }}>
              F 切换模式 · {list.length > 1 ? 'A/D 翻页 · ' : ''}Esc 关闭
            </div>
          </div>
        </div>

        {/* ── 正文 ── */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className={`flex items-center justify-between px-5 py-3 border-b ${t.border} flex-shrink-0 transition-colors duration-500 drag-region`}>
            <div className="flex items-center gap-2 min-w-0 no-drag">
              {icon || <BookOpen className="w-4 h-4 text-primary-400 flex-shrink-0" />}
              <span className={`text-sm font-medium ${t.heading} truncate`}>{chapter?.title || ''}</span>
              {chapter?.subtitle && <span className={`text-[11px] ${t.textMuted} truncate flex-shrink-0`}>{chapter.subtitle}</span>}
              {chapter?.content && <ContentImageCount text={chapter.content} />}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0 ml-2 no-drag">
              {total > 1 && <span className={`text-[11px] ${t.textMuted} tabular-nums`}>{activeIdx + 1} / {total}</span>}
              <button onClick={onClose} className={`p-1.5 rounded-lg ${t.textMuted} ${t.buttonBg} ${t.buttonHover} transition-colors`} title="关闭 (Esc)">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {mode === 'scroll' ? (
            <div ref={contentRef} className={`flex-1 overflow-y-auto px-6 sm:px-12 lg:px-20 py-8 ${t.text} leading-relaxed transition-colors duration-500`}
              style={{ fontSize: `${fontPx}px` }}>
              <div className="max-w-2xl mx-auto space-y-12">
                {list.map((c, i) => (
                  <div key={c.id != null ? c.id : i} data-chapter-idx={i} className="pt-4">
                    <h2 className={`font-bold mb-4 ${t.heading}`} style={{ fontSize: `${fontPx + 4}px`, scrollMarginTop: '1rem' }}>{c.title}</h2>
                    {c.subtitle && <p className={`text-[11px] ${t.textMuted} mb-3 -mt-2`}>{c.subtitle}</p>}
                    <BookContent text={c.content} emptyText={c.content ? '' : emptyText} className={t.textMuted}
                      onImageClick={setViewingImage} />
                    {i < list.length - 1 && <div className={`mt-8 pt-4 border-t ${t.border} text-center text-[10px] ${t.textMuted}`}>— 第 {i + 1} 篇完 —</div>}
                  </div>
                ))}
                <div className="h-[40vh]" />
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              <div ref={contentRef} className={`flex-1 overflow-y-auto px-6 sm:px-12 lg:px-20 py-8 ${t.text} leading-relaxed transition-colors duration-500`}
                style={{ fontSize: `${fontPx}px` }}>
                <div className={`max-w-2xl mx-auto transition-all duration-300 ${animating ? (animDir > 0 ? 'opacity-0 translate-x-8' : 'opacity-0 -translate-x-8') : 'opacity-100 translate-x-0'}`}>
                  <h2 className={`font-bold mb-2 ${t.heading}`} style={{ fontSize: `${fontPx + 4}px` }}>{chapter?.title}</h2>
                  {chapter?.subtitle && <p className={`text-[11px] ${t.textMuted} mb-4`}>{chapter.subtitle}</p>}
                  <div className={chapter?.subtitle ? '' : 'mt-4'}>
                    <BookContent text={chapter?.content} emptyText={emptyText} className={t.textMuted}
                      onImageClick={setViewingImage} />
                  </div>
                </div>
              </div>
              <div className={`flex items-center justify-between px-6 py-4 border-t ${t.border} flex-shrink-0 transition-colors duration-500`}>
                <div className="relative">
                  <button onClick={() => goToChapter(activeIdx - 1)} disabled={!hasPrev}
                    className={`px-4 py-2 rounded-lg text-xs ${t.buttonBg} ${t.buttonHover} ${t.buttonText} disabled:opacity-25 transition-colors`}>
                    ← 上一{total > 1 ? '章' : '页'}
                  </button>
                  <span className="absolute -bottom-0.5 -right-0.5 text-[8px] font-mono pointer-events-none" style={{ color: t.hint }}>A</span>
                </div>
                <span className={`text-xs ${t.textMuted} tabular-nums`}>{activeIdx + 1} / {total}</span>
                <div className="relative">
                  <button onClick={() => goToChapter(activeIdx + 1)} disabled={!hasNext}
                    className={`px-4 py-2 rounded-lg text-xs ${t.buttonBg} ${t.buttonHover} ${t.buttonText} disabled:opacity-25 transition-colors`}>
                    下一章 →
                  </button>
                  <span className="absolute -bottom-0.5 left-0.5 text-[8px] font-mono pointer-events-none" style={{ color: t.hint }}>D</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 图片观看器：挂在这一层才不会被困在正文的 transform 容器里 */}
      {viewingImage && (
        <Lightbox
          filename={viewingImage}
          label={chapter?.title || title}
          zIndex={300}
          onClose={() => setViewingImage(null)}
        />
      )}
    </div>
  )
}

/** 阅读按钮（列表页 / 详情页共用的小图标按钮） */
export function ReaderButton({ onClick, label = '阅读', className = '' }) {
  return (
    <button onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-[rgb(var(--color-1))] text-[rgb(var(--btn-text-1)_/_0.8)] hover:bg-[rgb(var(--scrollbar-thumb))] hover:text-[rgb(var(--btn-text-4th))] hover:scale-105 transition-all ${className}`}>
      <List className="w-3.5 h-3.5" />{label}
    </button>
  )
}

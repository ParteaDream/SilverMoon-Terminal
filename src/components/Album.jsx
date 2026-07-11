import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react'
import { createPortal } from 'react-dom'
import {
  Images, FolderOpen, Image, ChevronLeft, ChevronRight,
  X, LayoutGrid, LayoutList,
  ZoomIn, ZoomOut, Maximize,
  Heart, Settings, RefreshCw, ArrowLeft,
  Tag, Filter,
  Star, Bookmark, Flag, Eye, Sparkles, Crown, Award,
  Flame, Zap, Moon, Sun, Camera, Gem, Gift, Leaf,
  Compass, MapPin, MessageCircle, Palette, PenTool,
  Plane, Rocket, Shield, Smile, ThumbsUp, TreePine, Wand2,
  Plus, Trash2, Check, Edit3,
} from 'lucide-react'

// ── 常量 ──
const IMG_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg', 'bmp', 'avif', 'heic', 'heif'])
const ICON_PREFIX = '[icon]'
const HIDE_PREFIX = '#@'
const PREVIEW_MAP_MAX = 200

const PRESET_ICONS = {
  Star, Bookmark, Tag, Flag, Eye, Sparkles, Crown, Award,
  Flame, Zap, Moon, Sun, Camera, Gem, Gift, Leaf,
  Compass, MapPin, MessageCircle, Palette, PenTool,
  Plane, Rocket, Shield, Smile, ThumbsUp, TreePine, Wand2,
  Heart, Image, FolderOpen,
}

const PRESET_COLORS = [
  '#f43f5e', '#e11d48', '#ec4899', '#a855f7', '#8b5cf6',
  '#6366f1', '#3b82f6', '#0ea5e9', '#06b6d4', '#14b8a6',
  '#10b981', '#22c55e', '#84cc16', '#eab308', '#f97316',
  '#ef4444',
]

const FAVORITE_TAG = { id: 'favorite', name: '喜欢', icon: 'Heart', color: '#f43f5e' }

const SORT_OPTIONS = [
  { value: 'name-asc', label: '名称 ↑' },
  { value: 'name-desc', label: '名称 ↓' },
  { value: 'mtime-desc', label: '最新 ↑' },
  { value: 'mtime-asc', label: '最旧 ↑' },
]

const COL_OPTIONS = [2, 3, 4, 5, 6]
const SIZE_OPTIONS = [
  { value: 'sm', label: '小' },
  { value: 'md', label: '中' },
  { value: 'lg', label: '大' },
]

// ── 工具函数 ──
function joinPath(...parts) {
  const sep = parts[0]?.includes('\\') ? '\\' : '/'
  return parts.join(sep).replace(/[/\\]+/g, sep)
}

function isImageFile(name) {
  const ext = name.split('.').pop()?.toLowerCase()
  return IMG_EXTS.has(ext)
}

function displayName(name) {
  return name.startsWith(HIDE_PREFIX) ? name.slice(2) : name
}

function getIconComponent(iconName) {
  return PRESET_ICONS[iconName] || Tag
}

// ── 从 manifest 中读取目录信息 ──
function getManifestEntry(manifest, relPath) {
  const key = relPath || ''
  const entry = manifest?.entries?.[key]
  if (!entry) return { folders: [], images: [], cover: null, error: '目录不在索引中' }
  return {
    folders: entry.folders || [],
    images: (entry.images || []).map(img => ({ ...img, kind: 'image' })),
    cover: entry.cover || null,
    error: null
  }
}

// ── 共享 IntersectionObserver ──
const lazyObserver = (() => {
  if (typeof IntersectionObserver === 'undefined') return null
  const callbacks = new Map()
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const cb = callbacks.get(entry.target)
      if (entry.isIntersecting) { cb?.(); observer.unobserve(entry.target); callbacks.delete(entry.target) }
    }
  }, { rootMargin: '3000px' })
  return { observer, callbacks }
})()

// ── 从 photo_index 读取缩略图（已预生成，无需实时缩放）──
function fetchThumbnail(rootPath, thumbRelPath) {
  if (!rootPath || !thumbRelPath) return Promise.resolve(null)
  return window.electronAPI?.readIndexThumb(rootPath, thumbRelPath)
    .then(res => res?.data || null)
    .catch(() => null)
}

// ═══════════════════════════════════════════════
// 延迟加载缩略图组件
// ═══════════════════════════════════════════════
function LazyThumbnail({ rootPath, thumbRelPath, alt, className, onLoaded }) {
  const [src, setSrc] = useState(null)
  const [loading, setLoading] = useState(true)
  const ref = useRef(null)
  const loadedRef = useRef(false)

  useEffect(() => {
    const el = ref.current
    if (!el || loadedRef.current) return
    const doLoad = async () => {
      loadedRef.current = true; setLoading(true)
      const data = await fetchThumbnail(rootPath, thumbRelPath)
      if (data) { setSrc(data); onLoaded?.(data) }
      setLoading(false)
    }
    if (lazyObserver) { lazyObserver.callbacks.set(el, doLoad); lazyObserver.observer.observe(el) }
    else doLoad()
    return () => {
      if (lazyObserver) { lazyObserver.observer.unobserve(el); lazyObserver.callbacks.delete(el) }
    }
  }, [rootPath, thumbRelPath, onLoaded])

  return (
    <div ref={ref} className="w-full h-full">
      {src ? <img src={src} alt={alt} className={"no-fade-in " + (className || "")} draggable={false} decoding="async" />
        : loading ? <div className="w-full h-full flex items-center justify-center bg-surface-800/30"><div className="w-5 h-5 rounded-full border border-surface-600 border-t-surface-400 animate-spin" /></div>
        : <div className="w-full h-full flex items-center justify-center bg-surface-800/30"><Image className="w-6 h-6 text-surface-600" /></div>}
    </div>
  )
}
// ═══════════════════════════════════════════════
// 文件夹卡片（纯展示，事件由 Grid 事件委托处理）
// ═══════════════════════════════════════════════
const FolderCard = memo(function FolderCard({ folder, icon, coverImage, tags, tagDefs }) {
  const tagBadges = tags.slice(0, 3)
  const extraCount = tags.length - 3
  return (
    <button onDragStart={(e) => e.preventDefault()}
      className="w-full group cursor-pointer text-left focus:outline-none">
      <div className="aspect-square rounded-xl overflow-hidden border border-white/10 bg-surface-800/50
        group-hover:brightness-110 group-hover:shadow-lg group-hover:shadow-white/5 relative">
        {icon ? <img src={icon} alt="" className="no-fade-in w-full h-full object-cover" draggable={false} decoding="async" />
          : coverImage ? <img src={coverImage} alt="" className="no-fade-in w-full h-full object-cover" draggable={false} decoding="async" />
          : <div className="w-full h-full flex items-center justify-center"><FolderOpen className="w-10 h-10 text-surface-500/50" /></div>}
        <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-md bg-black/40 backdrop-blur-sm
          text-[9px] text-white/70 border border-white/10">
          <FolderOpen className="w-2.5 h-2.5 inline mr-0.5" />相簿</div>
        {tagBadges.length > 0 && (
          <div className="absolute bottom-1.5 right-1.5 flex gap-1">
            {tagBadges.map(tagId => {
              const def = tagId === 'favorite' ? FAVORITE_TAG : tagDefs?.find(d => d.id === tagId)
              if (!def) return null; const IconComp = getIconComponent(def.icon)
              return <div key={tagId} className="w-5 h-5 rounded-full flex items-center justify-center"
                style={{ backgroundColor: def.color + '30', border: `1px solid ${def.color}60` }} title={def.name}>
                <IconComp className="w-2.5 h-2.5" style={{ color: def.color }} /></div>
            })}
            {extraCount > 0 && <div className="px-1 h-5 rounded-full bg-black/40 backdrop-blur-sm border border-white/10 flex items-center text-[9px] text-white/60">+{extraCount}</div>}
          </div>
        )}
      </div>
      <p className="mt-1.5 text-[11px] text-surface-300 truncate text-center group-hover:text-white transition-colors px-1">{displayName(folder.name)}</p>
    </button>
  )
})

// ── 图片卡片（纯展示，事件由 Grid 事件委托处理）──
const ImageCard = memo(function ImageCard({ img, rootPath, preview, onLoaded, tags, tagDefs }) {
  const tagBadges = tags.slice(0, 2)
  return (
    <button onDragStart={(e) => e.preventDefault()}
      className="w-full group cursor-pointer text-left focus:outline-none">
      <div className="aspect-square rounded-xl overflow-hidden border border-white/5 bg-surface-800/30
        group-hover:brightness-110 group-hover:shadow-lg group-hover:shadow-white/5 relative">
        {preview ? <img src={preview} alt={img.name} className="no-fade-in w-full h-full object-cover" draggable={false} decoding="async" />
          : <LazyThumbnail rootPath={rootPath} thumbRelPath={img.thumb} alt={img.name} className="w-full h-full object-cover" onLoaded={onLoaded} />}
        {tagBadges.length > 0 && (
          <div className="absolute bottom-1 right-1 flex gap-0.5">
            {tagBadges.map(tagId => {
              const def = tagId === 'favorite' ? FAVORITE_TAG : tagDefs?.find(d => d.id === tagId)
              if (!def) return null; const IconComp = getIconComponent(def.icon)
              return <div key={tagId} className="w-4 h-4 rounded-full flex items-center justify-center"
                style={{ backgroundColor: def.color + '40' }}><IconComp className="w-2 h-2" style={{ color: def.color }} /></div>
            })}
          </div>
        )}
      </div>
      <p className="mt-1 text-[10px] text-surface-500 truncate text-center group-hover:text-surface-300 transition-colors px-1">{img.name}</p>
    </button>
  )
})

// ═══════════════════════════════════════════════
// 相簿网格视图（事件委托）
// ═══════════════════════════════════════════════
const AlbumGrid = memo(function AlbumGrid({
  rootPath, folders, images, iconMap, coverMap, previewMap,
  onFolderClick, onImageClick, sortBy, gridSize,
  albumTags, tagDefs, onFolderContextMenu, onImageContextMenu,
  activeTagFilter, onThumbnailLoaded,
}) {
  const filtered = useMemo(() => {
    const items = [
      ...folders.map(f => ({ ...f, kind: 'folder' })),
      ...images.map(f => ({ ...f, kind: 'image' })),
    ]
    items.sort((a, b) => {
      if (a.kind !== b.kind) { if (a.kind === 'folder') return -1; if (b.kind === 'folder') return 1 }
      switch (sortBy) {
        case 'name-asc': return a.name.localeCompare(b.name)
        case 'name-desc': return b.name.localeCompare(a.name)
        case 'mtime-desc': return (b.mtime || '').localeCompare(a.mtime || '')
        case 'mtime-asc': return (a.mtime || '').localeCompare(b.mtime || '')
        default: return a.name.localeCompare(b.name)
      }
    })
    return items
  }, [folders, images, sortBy])

  const minItemWidth = useMemo(() => {
    switch (gridSize) {
      case 'sm': return 90
      case 'lg': return 160
      default: return 120
    }
  }, [gridSize])

  // 事件委托：点击
  const handleGridClick = useCallback((e) => {
    const el = e.target.closest('[data-idx]')
    if (!el) return
    const idx = Number(el.dataset.idx)
    const item = filtered[idx]
    if (!item) return
    if (item.kind === 'folder') onFolderClick(item)
    else onImageClick(item)
  }, [filtered, onFolderClick, onImageClick])

  // 事件委托：右键
  const handleGridContextMenu = useCallback((e) => {
    const el = e.target.closest('[data-idx]')
    if (!el) return
    const idx = Number(el.dataset.idx)
    const item = filtered[idx]
    if (!item) return
    e.preventDefault()
    e.stopPropagation()
    if (item.kind === 'folder') onFolderContextMenu?.(e, item)
    else onImageContextMenu?.(e, item)
  }, [filtered, onFolderContextMenu, onImageContextMenu])

  return (
    <div className="grid gap-2.5 p-3" style={{ contain: 'layout style paint', gridTemplateColumns: `repeat(auto-fill, minmax(${minItemWidth}px, 1fr))`, contentVisibility: 'auto', containIntrinsicSize: 'auto ' + minItemWidth + 'px' }}
      onClick={handleGridClick} onContextMenu={handleGridContextMenu}>
      {filtered.map((item, i) => (
        <div key={item.kind + '-' + item.name} data-idx={i} data-kind={item.kind}>
          {item.kind === 'folder' ? (
            <FolderCard
              folder={item}
              icon={iconMap[item.name]}
              coverImage={coverMap[item.name]}
              tags={albumTags?.[item._fullPath || item.name] || []}
              tagDefs={tagDefs}
            />
          ) : (
            <ImageCard
              img={item}
              rootPath={rootPath}
              preview={previewMap[item.name]}
              onLoaded={(data) => onThumbnailLoaded?.(item.name, data, item._fullPath)}
              tags={albumTags?.[item._fullPath || item.name] || []}
              tagDefs={tagDefs}
            />
          )}
        </div>
      ))}
    </div>
  )
})

// ═══════════════════════════════════════════════
// 灯箱（仅图片，无视频）
// ═══════════════════════════════════════════════
function Lightbox({ items, currentIndex, onClose, onPrev, onNext, rootPath, previewMap, fullPreviewCache, albumTags, tagDefs, onToggleTag }) {
  const [scale, setScale] = useState(1)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0, px: 0, py: 0 })
  const [fullPreview, setFullPreview] = useState(null)
  const [loading, setLoading] = useState(true)
  const containerRef = useRef(null)
  const imageAreaRef = useRef(null)
  const imageContainerRef = useRef(null)
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 })
  const [filmPreviews, setFilmPreviews] = useState({})
  const [uiVisible, setUiVisible] = useState(true)
  const [showTagMenu, setShowTagMenu] = useState(false)
  const tagMenuRef = useRef(null)
  const filmLoadedRef = useRef(new Set())
  const filmstripRef = useRef(null)
  const preloadCache = useRef(new Map())  // _fullPath → base64 data
  const justSwitchedRef = useRef(false)

  const currentItem = items[currentIndex]
  const currentTags = albumTags?.[currentItem?._fullPath || currentItem?.name || ''] || []

  // 预加载缓存 + 胶片条缩略图作为即时占位 + 相邻预取
  useEffect(() => {
    if (!currentItem) return
    justSwitchedRef.current = true; requestAnimationFrame(() => { justSwitchedRef.current = false })
    setScale(1); setPosition({ x: 0, y: 0 })
    const imgPath = currentItem._fullPath || ''

    // 1. 先查全分辨率缓存（Phase 3.5），次查预加载缓存
    const cache = fullPreviewCache?.current?.get ? fullPreviewCache.current.get(imgPath) : null
    const cached = cache || (imgPath ? preloadCache.current.get(imgPath) : null)
    if (cached) {
      setFullPreview(cached)
      setLoading(false)
    } else {
      // 2. 立即用胶片条缩略图作为低清占位（如果有的话）
      const filmThumb = filmPreviews[currentIndex]
      if (filmThumb) {
        setFullPreview(filmThumb)
        setLoading(true)  // 仍在加载高清图，标记 loading
      } else if (!fullPreview) {
        // 首次打开且无任何缓存时显示 loading
        setLoading(true)
      }
      // fullPreview 不清空旧图（双缓冲）
    }

    // 2.5 确保当前索引的胶片条缩略图已加载（即时占位用）
    if (!filmPreviews[currentIndex] && !filmLoadedRef.current.has(currentIndex)) {
      filmLoadedRef.current.add(currentIndex)
      if (rootPath && currentItem.thumb) {
        fetchThumbnail(rootPath, currentItem.thumb).then(data => {
          if (data) setFilmPreviews(p => ({ ...p, [currentIndex]: data }))
        })
      }
    }

    // 3. 异步加载 2048px 高清图
    if (!cached && imgPath) {
      window.electronAPI?.readFilePreview(imgPath, 2048).then(res => {
        if (res?.data) {
          preloadCache.current.set(imgPath, res.data)
          if (preloadCache.current.size > 20) {
            const first = preloadCache.current.keys().next().value
            preloadCache.current.delete(first)
          }
          if (fullPreviewCache?.current && !fullPreviewCache.current.has(imgPath) && fullPreviewCache.current.size < 50) {
            fullPreviewCache.current.set(imgPath, res.data)
          }
          setFullPreview(res.data)
          setLoading(false)
        }
      })
    }

  }, [currentIndex])

  // 键盘事件（含 H 键切换 UI 可见性）
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft') onPrev()
      else if (e.key === 'ArrowRight') onNext()
      else if (e.key === 'h' || e.key === 'H') setUiVisible(v => !v)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose, onPrev, onNext])

  // 滚轮缩放 — 用原生 addEventListener({ passive: false }) 避免 React 18 passive 警告
  useEffect(() => {
    const el = imageAreaRef.current
    if (!el) return
    const onWheel = (e) => {
      e.preventDefault()
      setScale(s => Math.max(0.2, Math.min(10, s + (e.deltaY > 0 ? -0.1 : 0.1))))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const handleMouseDown = useCallback((e) => {
    if (e.button !== 0) return
    setDragging(true); setDragStart({ x: e.clientX, y: e.clientY, px: position.x, py: position.y })
  }, [position])

  useEffect(() => {
    if (!dragging) return
    const move = (e) => setPosition({ x: dragStart.px + (e.clientX - dragStart.x), y: dragStart.py + (e.clientY - dragStart.y) })
    const up = () => setDragging(false)
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
  }, [dragging, dragStart])

  const handleBgClick = useCallback((e) => { if (e.target === e.currentTarget) onClose() }, [onClose])

  // 点击图片区域切换 UI 可见性
  const handleImageAreaClick = useCallback((e) => {
    if (e.target === e.currentTarget || e.target.tagName === 'IMG') {
      setUiVisible(v => !v)
    }
  }, [])

  // 监听图片容器尺寸变化，动态调节图片最大显示尺寸
  useEffect(() => {
    const el = imageContainerRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      setContainerSize({ w: entry.contentRect.width, h: entry.contentRect.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 胶片条缩略图：分三阶段 — 当前图 → 可视区域 → 后台补全
  useEffect(() => {
    const WINDOW = 2
    const priorityStart = Math.max(0, currentIndex - WINDOW)
    const priorityEnd = Math.min(items.length, currentIndex + WINDOW + 1)

    // Phase 1: 立即加载优先窗口（当前图 ±2）
    for (let i = priorityStart; i < priorityEnd; i++) {
      if (filmLoadedRef.current.has(i)) continue
      filmLoadedRef.current.add(i)
      const item = items[i]
      if (!item) continue
      if (item._preview) { setFilmPreviews(p => ({ ...p, [i]: item._preview })); continue }
      const fullPath = item._fullPath
      if (rootPath && item.thumb) {
        fetchThumbnail(rootPath, item.thumb).then(data => { if (data) setFilmPreviews(p => ({ ...p, [i]: data })) })
      } else if (fullPath) {
        fetchThumbnail(fullPath).then(data => { if (data) setFilmPreviews(p => ({ ...p, [i]: data })) })
      }
    }

    // Phase 2: 100ms 后加载胶片条可视区域缩略图
    const phase2Timer = setTimeout(() => {
      // 计算可见区域
      const container = filmstripRef.current
      let visibleStart = 0, visibleEnd = items.length
      if (container) {
        const itemWidth = 64  // w-14(56px) + gap-2(8px)
        const scrollLeft = container.scrollLeft
        const visibleWidth = container.clientWidth
        visibleStart = Math.max(0, Math.floor(scrollLeft / itemWidth))
        visibleEnd = Math.min(items.length, Math.ceil((scrollLeft + visibleWidth) / itemWidth) + 1)
      }
      const toLoad = []
      for (let i = visibleStart; i < visibleEnd; i++) {
        if (filmLoadedRef.current.has(i)) continue
        filmLoadedRef.current.add(i)
        toLoad.push(i)
      }
      for (const i of toLoad) {
        const item = items[i]
        if (!item) continue
        if (item._preview) { setFilmPreviews(p => ({ ...p, [i]: item._preview })); continue }
        const fullPath = item._fullPath
        if (rootPath && item.thumb) {
          fetchThumbnail(rootPath, item.thumb).then(data => { if (data) setFilmPreviews(p => ({ ...p, [i]: data })) })
        } else if (fullPath) {
          fetchThumbnail(fullPath).then(data => { if (data) setFilmPreviews(p => ({ ...p, [i]: data })) })
        }
      }

      // Phase 3: 后台预缓存剩余所有缩略图（requestIdleCallback，不影响主线）
      const bgTimer = setTimeout(() => {
        const remain = []
        for (let i = 0; i < items.length; i++) {
          if (filmLoadedRef.current.has(i)) continue
          filmLoadedRef.current.add(i)
          remain.push(i)
        }
        let pos = 0
        function bgNext() {
          if (pos >= remain.length) return
          const i = remain[pos++]
          const item = items[i]
          if (item) {
            if (!item._preview) {
              if (rootPath && item.thumb) {
                fetchThumbnail(rootPath, item.thumb).then(data => { if (data) setFilmPreviews(p => ({ ...p, [i]: data })) })
              } else {
                const fp = item._fullPath
                if (fp) fetchThumbnail(fp).then(data => { if (data) setFilmPreviews(p => ({ ...p, [i]: data })) })
              }
            } else {
              setFilmPreviews(p => ({ ...p, [i]: item._preview }))
            }
          }
          // 使用 requestIdleCallback 或 setTimeout 50 做最小调度
          if (typeof requestIdleCallback === 'function') {
            requestIdleCallback(bgNext, { timeout: 200 })
          } else {
            setTimeout(bgNext, 50)
          }
        }
        if (remain.length > 0) requestIdleCallback ? requestIdleCallback(bgNext, { timeout: 300 }) : setTimeout(bgNext, 100)
      }, 200)

      return () => clearTimeout(bgTimer)
    }, 100)

    return () => clearTimeout(phase2Timer)
  }, [items, currentIndex])

  // 当前图片切换时，自动滚动胶片条使选中项可见
  useEffect(() => {
    const container = filmstripRef.current
    if (!container) return
    const activeBtn = container.children[currentIndex]
    if (activeBtn) {
      activeBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
    }
  }, [currentIndex])

  // 点击标签菜单外部关闭（带 ref 守卫，避免关闭时拦截按钮的 click 事件）
  useEffect(() => {
    if (!showTagMenu) return
    const close = (e) => {
      if (tagMenuRef.current && !tagMenuRef.current.contains(e.target)) {
        setShowTagMenu(false)
      }
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [showTagMenu])

  if (!currentItem) return null

  return (
    <div className="fixed inset-0 z-[10000] bg-black/90 backdrop-blur-2xl flex flex-col animate-fade-in" onClick={handleBgClick} ref={containerRef}>
      {/* 顶栏 */}
      <div className={`flex items-center justify-between px-4 py-3 bg-gradient-to-b from-black/60 to-transparent z-10 transition-opacity duration-300 ${uiVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-white/10 transition-colors"><X className="w-5 h-5 text-white/70" /></button>
          <span className="text-xs text-white/50 font-mono">{currentIndex + 1} / {items.length}</span>
          <span className="text-xs text-white/40 truncate max-w-[200px] hidden sm:block">{currentItem.name}</span>
        </div>
        <div className="flex items-center gap-2 relative">
          <button onClick={(e) => { e.stopPropagation(); setShowTagMenu(v => !v) }}
            className={`p-1.5 rounded-full hover:bg-white/10 transition-colors relative ${currentTags.length > 0 ? 'text-rose-400' : 'text-white/50 hover:text-white'}`}
            title={currentTags.length > 0 ? '标签: ' + currentTags.join(', ') : '添加标签'}>
            <Tag className="w-4 h-4" />
            {currentTags.length > 0 && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-rose-400" />}
          </button>
          {showTagMenu && (
            <div ref={tagMenuRef} className="absolute right-0 top-full mt-1 w-40 py-1 rounded-xl bg-surface-900/95 backdrop-blur-xl border border-white/10 shadow-2xl z-30 animate-scale-in"
              onClick={e => e.stopPropagation()}>
              <button onClick={() => { onToggleTag?.(currentItem, 'favorite'); setShowTagMenu(false) }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors hover:bg-white/5 text-surface-400">
                <Heart className={`w-3.5 h-3.5 ${currentTags.includes('favorite') ? 'text-rose-400 fill-rose-400' : 'text-surface-400'}`} />
                {currentTags.includes('favorite') ? '取消喜欢' : '喜欢'}</button>
              {tagDefs && tagDefs.length > 0 && <div className="border-t border-white/5 my-1" />}
              {tagDefs && tagDefs.map(tag => {
                const IconComp = getIconComponent(tag.icon); const active = currentTags.includes(tag.id)
                return <button key={tag.id} onClick={() => { onToggleTag?.(currentItem, tag.id); setShowTagMenu(false) }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors hover:bg-white/5 text-surface-400">
                  <IconComp className={`w-3.5 h-3.5 ${active ? '' : 'text-surface-400'}`} style={active ? { color: tag.color } : undefined} />
                  <span className={active ? 'text-white' : 'text-surface-400'}>{tag.name}</span>
                  {active && <Check className="w-3 h-3 ml-auto text-surface-400" />}</button>
              })}
            </div>
          )}
          <button onClick={() => setScale(s => Math.max(0.2, s - 0.25))} className="p-1.5 rounded-full hover:bg-white/10 text-white/50 hover:text-white transition-colors"><ZoomOut className="w-4 h-4" /></button>
          <span className="text-[11px] text-white/40 font-mono w-10 text-center">{Math.round(scale * 100)}%</span>
          <button onClick={() => setScale(s => Math.min(10, s + 0.25))} className="p-1.5 rounded-full hover:bg-white/10 text-white/50 hover:text-white transition-colors"><ZoomIn className="w-4 h-4" /></button>
          <button onClick={() => { setScale(1); setPosition({ x: 0, y: 0 }) }} className="p-1.5 rounded-full hover:bg-white/10 text-white/50 hover:text-white transition-colors"><Maximize className="w-3.5 h-3.5" /></button>
        </div>
      </div>
      {/* 图片区域 */}
      <div ref={imageContainerRef} className="flex-1 flex items-center justify-center overflow-hidden relative">
        <button onClick={onPrev} className={`absolute left-2 sm:left-4 p-2 rounded-full bg-black/30 hover:bg-black/60 text-white/60 hover:text-white transition-all z-20 ${uiVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'} duration-300`}><ChevronLeft className="w-6 h-6 sm:w-8 sm:h-8" /></button>
        <div ref={imageAreaRef} className="select-none" style={{ transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`, cursor: dragging ? 'grabbing' : 'grab', transition: dragging || justSwitchedRef.current ? 'none' : 'transform 0.2s ease' }}
          onMouseDown={handleMouseDown} onClick={handleImageAreaClick}>
          {loading && !fullPreview ? (
            filmPreviews[currentIndex]
              ? <img src={filmPreviews[currentIndex]} alt="" className="no-fade-in object-contain blur-xl scale-110" draggable={false} style={{ maxWidth: (containerSize.w || innerWidth) * 0.92, maxHeight: (containerSize.h || innerHeight) * 0.92 }} />
              : <div className="w-16 h-16 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
          ) : fullPreview ? (
            
            <img src={fullPreview} alt={currentItem.name} className="no-fade-in object-contain animate-fade-in" draggable={false} decoding="async" style={{ maxWidth: (containerSize.w || innerWidth) * 0.92, maxHeight: (containerSize.h || innerHeight) * 0.92 }} />
          ) : (
            <div className="text-surface-500 text-sm">无法加载图片</div>
          )}
          {loading && fullPreview && (
            <div className="absolute bottom-3 right-3 w-5 h-5 rounded-full border-2 border-white/30 border-t-white/80 animate-spin z-30" />
          )}
        </div>
        <button onClick={onNext} className={`absolute right-2 sm:right-4 p-2 rounded-full bg-black/30 hover:bg-black/60 text-white/60 hover:text-white transition-all z-20 ${uiVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'} duration-300`}><ChevronRight className="w-6 h-6 sm:w-8 sm:h-8" /></button>
      </div>
      {/* 底栏胶片条 */}
      <div className={`h-20 bg-gradient-to-t from-black/80 to-transparent px-4 py-2 z-10 transition-opacity duration-300 ${uiVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
        <div ref={filmstripRef} className="flex items-center gap-2 overflow-x-auto h-full no-scrollbar justify-start">
          {items.map((item, i) => (
            <button key={i} onClick={() => { const d = i - currentIndex; if (d > 0) for (let j = 0; j < d; j++) onNext(); else for (let j = 0; j < -d; j++) onPrev() }}
              className={`shrink-0 w-14 h-14 rounded-lg overflow-hidden border-2 transition-[transform,opacity] duration-150 relative ${i === currentIndex ? 'border-white/60 scale-110' : 'border-transparent opacity-50 hover:opacity-80'}`}>
              {filmPreviews[i] ? <img src={filmPreviews[i]} alt="" className="no-fade-in w-full h-full object-cover" draggable={false} />
                : <div className="w-full h-full bg-surface-700/50 flex items-center justify-center"><Image className="w-4 h-4 text-surface-500" /></div>}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════
// 设置面板
// ═══════════════════════════════════════════════
function AlbumSettings({ preferences, onUpdate, onClose, tagDefs, onSaveTagDefs }) {
  const [tab, setTab] = useState('display')
  const [editingTag, setEditingTag] = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null)

  return (
    <div className="fixed inset-0 z-[200] bg-black/40 backdrop-blur-sm flex items-center justify-center animate-fade-in"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="w-96 max-h-[80vh] rounded-2xl bg-surface-900/95 backdrop-blur-xl border border-white/10 shadow-2xl p-5 animate-scale-in flex flex-col">
        <div className="flex items-center justify-between mb-4 shrink-0">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2"><Settings className="w-4 h-4" /> 相册设置</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-white/10 text-surface-400 hover:text-white transition-colors"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex gap-1 mb-4 shrink-0">
          <button onClick={() => setTab('display')} className={`flex-1 py-1.5 rounded-lg text-xs transition-all ${tab === 'display' ? 'bg-white/15 text-white' : 'text-surface-400 hover:text-surface-200 hover:bg-white/5'}`}>显示</button>
          <button onClick={() => setTab('tags')} className={`flex-1 py-1.5 rounded-lg text-xs transition-all ${tab === 'tags' ? 'bg-white/15 text-white' : 'text-surface-400 hover:text-surface-200 hover:bg-white/5'}`}><Tag className="w-3 h-3 inline mr-1" />标记</button>
        </div>
        <div className="flex-1 overflow-auto min-h-0">
          {tab === 'display' ? (
            <div className="space-y-4">
              <div><label className="text-[11px] text-surface-400 mb-1.5 block">网格列数</label>
                <div className="flex gap-1.5">{COL_OPTIONS.map(n => (
                  <button key={n} onClick={() => onUpdate({ gridCols: n })}
                    className={`flex-1 py-1.5 rounded-lg text-xs transition-all ${preferences.gridCols === n ? 'bg-white/15 text-white border border-white/20' : 'bg-surface-800/50 text-surface-400 hover:text-surface-200 hover:bg-white/5 border border-white/5'}`}>{n}</button>
                ))}</div>
              </div>
              <div><label className="text-[11px] text-surface-400 mb-1.5 block">缩略图大小</label>
                <div className="flex gap-1.5">{SIZE_OPTIONS.map(s => (
                  <button key={s.value} onClick={() => onUpdate({ gridSize: s.value })}
                    className={`flex-1 py-1.5 rounded-lg text-xs transition-all ${preferences.gridSize === s.value ? 'bg-white/15 text-white border border-white/20' : 'bg-surface-800/50 text-surface-400 hover:text-surface-200 hover:bg-white/5 border border-white/5'}`}>{s.label}</button>
                ))}</div>
              </div>
              <div><label className="text-[11px] text-surface-400 mb-1.5 block">排序方式</label>
                <div className="flex flex-wrap gap-1.5">{SORT_OPTIONS.map(s => (
                  <button key={s.value} onClick={() => onUpdate({ sortBy: s.value })}
                    className={`px-3 py-1.5 rounded-lg text-xs transition-all ${preferences.sortBy === s.value ? 'bg-white/15 text-white border border-white/20' : 'bg-surface-800/50 text-surface-400 hover:text-surface-200 hover:bg-white/5 border border-white/5'}`}>{s.label}</button>
                ))}</div>
              </div>
              <div className="pt-2 border-t border-white/5">
                <button onClick={async () => { const cfg = await window.electronAPI?.getUserConfig(); const p = cfg?.config?.albumFolderPath; if (p) window.electronAPI?.openFolder(p) }}
                  className="w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-surface-300 transition-colors"><FolderOpen className="w-3.5 h-3.5" />在访达中显示</button>
              </div>
            </div>
          ) : (
            <TagManager tagDefs={tagDefs} onSave={onSaveTagDefs} editingTag={editingTag} setEditingTag={setEditingTag} deleteConfirm={deleteConfirm} setDeleteConfirm={setDeleteConfirm} />
          )}
        </div>
      </div>
    </div>
  )
}

function TagManager({ tagDefs, onSave, editingTag, setEditingTag, deleteConfirm, setDeleteConfirm }) {
  const [editName, setEditName] = useState(''); const [editIcon, setEditIcon] = useState('Tag'); const [editColor, setEditColor] = useState('#6366f1')
  useEffect(() => {
    if (editingTag && editingTag !== 'new') { setEditName(editingTag.name); setEditIcon(editingTag.icon || 'Tag'); setEditColor(editingTag.color || '#6366f1') }
    else { setEditName(''); setEditIcon('Tag'); setEditColor('#6366f1') }
  }, [editingTag])
  function handleSave() {
    if (!editName.trim()) return
    if (editingTag === 'new') onSave([...tagDefs, { id: 'custom_' + Date.now(), name: editName.trim(), icon: editIcon, color: editColor }])
    else if (editingTag) onSave(tagDefs.map(t => t.id === editingTag.id ? { ...t, name: editName.trim(), icon: editIcon, color: editColor } : t))
    setEditingTag(null)
  }
  function handleDelete(tagId) { onSave(tagDefs.filter(t => t.id !== tagId)); setDeleteConfirm(null); if (editingTag?.id === tagId) setEditingTag(null) }
  const iconEntries = Object.entries(PRESET_ICONS)
  if (editingTag) return (
    <div className="space-y-4">
      <div className="flex items-center justify-between"><h4 className="text-xs font-medium text-white">{editingTag === 'new' ? '新建标记' : '编辑标记'}</h4><button onClick={() => setEditingTag(null)} className="text-[11px] text-surface-400 hover:text-white transition-colors">取消</button></div>
      <div><label className="text-[10px] text-surface-400 mb-1 block">标签名</label><input type="text" value={editName} onChange={e => setEditName(e.target.value)} placeholder="输入标签名称..." className="w-full px-3 py-1.5 rounded-lg bg-surface-800 border border-white/10 text-xs text-white placeholder-surface-600 outline-none focus:border-white/20 transition-colors" autoFocus /></div>
      <div><label className="text-[10px] text-surface-400 mb-1 block">颜色</label><div className="flex flex-wrap gap-1.5">{PRESET_COLORS.map(c => <button key={c} onClick={() => setEditColor(c)} className="w-6 h-6 rounded-full border-2 transition-all" style={{ backgroundColor: c, borderColor: editColor === c ? 'white' : 'transparent' }} />)}</div></div>
      <div><label className="text-[10px] text-surface-400 mb-1 block">图标</label><div className="grid grid-cols-6 gap-1.5 max-h-32 overflow-y-auto">{iconEntries.map(([name, IconComp]) => <button key={name} onClick={() => setEditIcon(name)} className={`p-1.5 rounded-lg flex items-center justify-center transition-all ${editIcon === name ? 'bg-white/15 text-white border border-white/20' : 'text-surface-400 hover:text-surface-200 hover:bg-white/5 border border-transparent'}`} title={name}><IconComp className="w-4 h-4" /></button>)}</div></div>
      <div className="flex items-center gap-2 p-2 rounded-lg bg-surface-800/50 border border-white/5">
        <span className="text-[10px] text-surface-400">预览：</span>
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px]" style={{ backgroundColor: editColor + '20', color: editColor, border: `1px solid ${editColor}40` }}>
          {React.createElement(getIconComponent(editIcon), { className: 'w-3 h-3' })}{editName || '标签名'}</div>
      </div>
      <button onClick={handleSave} className="w-full py-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/10 text-xs text-white transition-all flex items-center justify-center gap-1.5"><Check className="w-3.5 h-3.5" />保存</button>
    </div>
  )
  return (
    <div className="space-y-3">
      <div><label className="text-[10px] text-surface-400 mb-1.5 block">预设</label>
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-800/50 border border-white/5">
          <div className="w-6 h-6 rounded-full flex items-center justify-center" style={{ backgroundColor: FAVORITE_TAG.color + '30', border: `1px solid ${FAVORITE_TAG.color}60` }}><Heart className="w-3 h-3" style={{ color: FAVORITE_TAG.color }} /></div>
          <span className="text-xs text-surface-300 flex-1">{FAVORITE_TAG.name}</span><span className="text-[10px] text-surface-500">预设（不可编辑）</span></div></div>
      <div><div className="flex items-center justify-between mb-1.5"><label className="text-[10px] text-surface-400">自定义标记</label><button onClick={() => setEditingTag('new')} className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] text-surface-300 hover:text-white hover:bg-white/10 transition-colors"><Plus className="w-3 h-3" />新建</button></div>
        <div className="space-y-1">{tagDefs.length === 0 ? <p className="text-[10px] text-surface-500 text-center py-4">暂无自定义标记</p> : tagDefs.map(tag => (
          <div key={tag.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-800/30 border border-white/5 group">
            <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: tag.color + '30', border: `1px solid ${tag.color}60` }}>{React.createElement(getIconComponent(tag.icon), { className: 'w-3 h-3', style: { color: tag.color } })}</div>
            <span className="text-xs text-surface-300 flex-1 truncate">{tag.name}</span>
            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button onClick={() => setEditingTag(tag)} className="p-1 rounded hover:bg-white/10 text-surface-400 hover:text-white transition-colors"><Edit3 className="w-3 h-3" /></button>
              {deleteConfirm === tag.id ? <div className="flex gap-1"><button onClick={() => setDeleteConfirm(null)} className="px-1.5 py-0.5 rounded text-[9px] bg-surface-700 text-surface-400 hover:text-white">取消</button><button onClick={() => handleDelete(tag.id)} className="px-1.5 py-0.5 rounded text-[9px] bg-red-500/20 text-red-400 hover:bg-red-500/30">删除</button></div>
                : <button onClick={() => setDeleteConfirm(tag.id)} className="p-1 rounded hover:bg-white/10 text-surface-400 hover:text-red-400 transition-colors"><Trash2 className="w-3 h-3" /></button>}
            </div></div>
        ))}</div></div>
    </div>
  )
}

// ═══════════════════════════════════════════════
// 右键菜单
// ═══════════════════════════════════════════════
function ItemContextMenu({ x, y, item, tags, tagDefs, onClose, onToggleTag, onOpenSettings }) {
  return (
    <div className="fixed z-[300] w-48 py-1 rounded-xl bg-surface-900/95 backdrop-blur-xl border border-white/10 shadow-2xl animate-scale-in"
      style={{ left: Math.min(x, window.innerWidth - 200), top: Math.min(y, window.innerHeight - 300) }}
      onClick={e => e.stopPropagation()}>
      <div className="px-3 py-1.5 text-[11px] text-surface-400 truncate border-b border-white/5">{item.kind === 'folder' ? displayName(item.name) : item.name}</div>
      <button onClick={() => { onToggleTag('favorite'); onClose() }}
        className="w-full flex items-center gap-2.5 px-3 py-2 text-xs transition-colors hover:bg-white/5">
        <Heart className={`w-3.5 h-3.5 ${tags.includes('favorite') ? 'text-rose-400 fill-rose-400' : 'text-surface-400'}`} />
        {tags.includes('favorite') ? '取消喜欢' : '❤️ 喜欢'}</button>
      {tagDefs.length > 0 && <div className="border-t border-white/5 my-1" />}
      {tagDefs.map(tag => {
        const IconComp = getIconComponent(tag.icon); const active = tags.includes(tag.id)
        return <button key={tag.id} onClick={() => { onToggleTag(tag.id); onClose() }}
          className="w-full flex items-center gap-2.5 px-3 py-2 text-xs transition-colors hover:bg-white/5">
          <IconComp className={`w-3.5 h-3.5 ${active ? '' : 'text-surface-400'}`} style={active ? { color: tag.color } : undefined} />
          <span className={active ? 'text-white' : 'text-surface-400'}>{tag.name}</span>
          {active && <Check className="w-3 h-3 ml-auto text-surface-400" />}</button>
      })}
      <div className="border-t border-white/5 my-1" />
      <button onClick={() => { onOpenSettings(); onClose() }} className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-surface-400 transition-colors hover:bg-white/5">
        <Settings className="w-3.5 h-3.5" />管理标记...</button>
    </div>
  )
}

// ═══════════════════════════════════════════════
// 欢迎页
// ═══════════════════════════════════════════════
function WelcomeScreen({ onSelectFolder }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-5 p-8 animate-fade-in">
      <div className="relative">
        <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-pink-500/20 to-rose-600/20 border border-pink-500/20 flex items-center justify-center backdrop-blur-xl"><Images className="w-12 h-12 text-pink-400 drop-shadow-lg" /></div>
        <div className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-rose-500/20 border border-rose-500/30 flex items-center justify-center text-[10px] text-rose-300">✧</div>
      </div>
      <div className="text-center">
        <h2 className="text-xl font-bold text-white tracking-wide">切片辖域·鸽</h2>
        <div className="mt-3 space-y-1"><p className="text-sm text-surface-400 italic tracking-wider leading-relaxed">「我明白，我明白的。」</p><p className="text-sm text-surface-400 italic tracking-wider leading-relaxed">「这世界其实就是如此美丽啊。」</p></div>
        <div className="w-12 h-px bg-white/10 mx-auto mt-3" />
      </div>
      <button onClick={onSelectFolder} className="flex items-center gap-2.5 px-6 py-3 rounded-2xl bg-gradient-to-r from-pink-500 to-rose-600 hover:from-pink-400 hover:to-rose-500 text-white text-sm font-medium shadow-lg shadow-pink-500/20 transition-all duration-200 hover:scale-105 active:scale-95"><FolderOpen className="w-4 h-4" />选择相册文件夹</button>
      <p className="text-[10px] text-surface-600 text-center max-w-[200px] leading-relaxed">程序将会识别文件夹内的子目录为相簿，<br />并自动扫描所有图片</p>
    </div>
  )
}

// ═══════════════════════════════════════════════
// 主组件
// ═══════════════════════════════════════════════
export default function Album() {
  const [albumFolder, setAlbumFolder] = useState(null)
  const [currentPath, setCurrentPath] = useState('')
  const [pathHistory, setPathHistory] = useState([])
  const [folders, setFolders] = useState([]); const [images, setImages] = useState([])
  const [iconMap, setIconMap] = useState({}); const [coverMap, setCoverMap] = useState({})
  const [previewMap, setPreviewMap] = useState({})
  const [loading, setLoading] = useState(true); const [error, setError] = useState(null)
  const [lightboxOpen, setLightboxOpen] = useState(false); const [lightboxIndex, setLightboxIndex] = useState(0)
  const [showSettings, setShowSettings] = useState(false)
  const [preferences, setPreferences] = useState({ sortBy: 'name-asc', gridCols: 4, gridSize: 'md' })
  const [viewMode, setViewMode] = useState('grid')
  const [albumTags, setAlbumTags] = useState({}); const [tagDefs, setTagDefs] = useState([])
  const [activeTagFilter, setActiveTagFilter] = useState(null); const [showTagFilter, setShowTagFilter] = useState(false)
  const [contextMenu, setContextMenu] = useState(null)
  const [contextMenuItem, setContextMenuItem] = useState(null)
  const [albumManifest, setAlbumManifest] = useState(null)
  const dirCache = useRef(new Map())
  const thumbLoadedSet = useRef(new Set())
  const fullPreviewCache = useRef(new Map())  // _fullPath → base64, max 50
  const preloadCancelRef = useRef(false)

  // Phase 3: 后台空闲调度 — 全量加载缩略图
  function startPhase3Preload(images, rootPath) {
    const toLoad = []
    for (const img of images) {
      if (img.thumb && !thumbLoadedSet.current.has(img.name)) toLoad.push(img)
    }
    let pos = 0
    function next() {
      if (preloadCancelRef.current || pos >= toLoad.length) return
      const img = toLoad[pos++]
      thumbLoadedSet.current.add(img.name)
      fetchThumbnail(rootPath, img.thumb).then(data => {
        if (data && !preloadCancelRef.current) {
          handleThumbnailLoaded(img.name, data, img._fullPath)
        }
      })
      const fn = typeof requestIdleCallback === 'function' ? requestIdleCallback : (cb) => setTimeout(cb, 50)
      fn(next, { timeout: 300 })
    }
    if (toLoad.length > 0) {
      const fn = typeof requestIdleCallback === 'function' ? requestIdleCallback : (cb) => setTimeout(cb, 50)
      fn(next, { timeout: 300 })
    }
  }

  // Phase 3.5: 后台空闲调度 — 全量预缓存全分辨率图（1024px，间隔 300ms，不阻塞主线程）
  function startPhase35Preload(images, rootPath) {
    const FPC_MAX = 50
    let pos = 0
    function next() {
      if (preloadCancelRef.current || pos >= images.length) return
      const img = images[pos++]
      const path = img._fullPath
      if (!path || fullPreviewCache.current.has(path)) {
        setTimeout(next, 100)
        return
      }
      window.electronAPI?.readFilePreview(path, 1024).then(res => {
        if (res?.data && !preloadCancelRef.current) {
          fullPreviewCache.current.set(path, res.data)
          if (fullPreviewCache.current.size > FPC_MAX) {
            const first = fullPreviewCache.current.keys().next().value
            if (first !== undefined) fullPreviewCache.current.delete(first)
          }
        }
      }).finally(() => {
        if (!preloadCancelRef.current) setTimeout(next, 300)
      })
    }
    if (images.length > 0) setTimeout(next, 300)
  }

  useEffect(() => { init() }, [])

  async function init() {
    try {
      const res = await window.electronAPI?.getUserConfig()
      const config = res?.config || {}
      const path = config?.albumFolderPath
      if (config?.albumPreferences) setPreferences(prev => ({ ...prev, ...config.albumPreferences }))
      if (config?.albumTagDefs) setTagDefs(config.albumTagDefs)
      let tags = {}
      if (path) {
        const tagRes = await window.electronAPI?.readAlbumTags()
        if (tagRes?.success && tagRes.data && Object.keys(tagRes.data).length > 0) { tags = tagRes.data }
        else if (config?.albumTags) { tags = config.albumTags; window.electronAPI?.saveAlbumTags(tags); window.electronAPI?.setUserConfig('albumTags', undefined) }
      }
      setAlbumTags(tags)
      if (path) { setAlbumFolder(path); setCurrentPath(path); setPathHistory([{ name: '根目录', path }]); await ensureIndexThenLoad(path) }
      else { setLoading(false) }
    } catch (_) { setLoading(false) }
  }

  // 确保索引存在（不存在或用户选择重建时触发扫描），然后加载 manifest
  async function ensureIndexThenLoad(dirPath) {
    setLoading(true); setError(null)
    try {
      // 尝试读取已有 manifest
      let manRes = await window.electronAPI?.readAlbumManifest(dirPath)
      if (!manRes?.success) {
        // 索引不存在 → 全量扫描
        await window.electronAPI?.scanAlbumIndex(dirPath)
        manRes = await window.electronAPI?.readAlbumManifest(dirPath)
      }
      if (manRes?.success && manRes.manifest) {
        setAlbumManifest(manRes.manifest)
        loadDirFromManifest(manRes.manifest, '', dirPath)
      } else {
        setError(manRes?.error || '无法读取索引')
        setLoading(false)
      }
    } catch (e) { setError(e.message || '索引加载失败'); setLoading(false) }
  }

  // 从 manifest 加载指定目录
  function loadDirFromManifest(manifest, relPath, rootPath) {
    const entry = getManifestEntry(manifest, relPath)
    const sep = rootPath.includes('\\') ? '\\' : '/'
    const dirAbsPath = relPath ? rootPath + sep + relPath : rootPath

    const foldersWithPath = entry.folders.map(name => ({
      name, _fullPath: dirAbsPath + sep + name, isDirectory: true
    }))
    const imagesWithPath = entry.images.map(img => ({
      ...img,
      _fullPath: dirAbsPath + sep + img.name,
      kind: 'image'
    }))

    setFolders(foldersWithPath)
    setImages(imagesWithPath)
    setIconMap({})
    setCoverMap({})
    setPreviewMap({})
    setLoading(false)

    // 从 manifest 填充封面 map
    const newIconMap = {}
    const newCoverMap = {}
    for (const [key, e] of Object.entries(manifest.entries)) {
      if (!e.cover) continue
      // key 是相对路径，取最后一段作为文件夹名
      const folderName = key.split(/[/\\]/).pop() || key
      // 判断是否为 [icon] 封面
      const iconImg = e.images?.find(img => img.name.startsWith(ICON_PREFIX))
      if (iconImg) {
        // 异步加载 icon 封面缩略图
        fetchThumbnail(rootPath, e.cover).then(data => {
          if (data) setIconMap(prev => ({ ...prev, [folderName]: data }))
        })
      } else {
        // 异步加载普通封面缩略图
        fetchThumbnail(rootPath, e.cover).then(data => {
          if (data) setCoverMap(prev => ({ ...prev, [folderName]: data }))
        })
      }
    }
    // 加载完 manifest 后启动后台预加载
    preloadCancelRef.current = true
    thumbLoadedSet.current.clear()
    setTimeout(() => {
      preloadCancelRef.current = false
      startPhase3Preload(imagesWithPath, rootPath)
      // Phase 3.5 在 Phase 3 链式完成后启动
      let interval
      interval = setInterval(() => {
        if (thumbLoadedSet.current.size >= imagesWithPath.length || !preloadCancelRef.current) {
          clearInterval(interval)
          if (!preloadCancelRef.current) startPhase35Preload(imagesWithPath, rootPath)
        }
      }, 500)
    }, 50)
  }

  // 加载目录：优先从 manifest 读取
  async function loadDirContents(dirPath, skipCache) {
    if (!skipCache && dirCache.current.has(dirPath)) {
      const cached = dirCache.current.get(dirPath)
      setFolders(cached.folders)
      setImages(cached.images)
      setIconMap(cached.iconMap || {})
      setCoverMap(cached.coverMap || {})
      setPreviewMap({})
      return
    }
    if (!albumManifest) { setError('索引未加载'); setLoading(false); return }

    // 计算相对路径
    const relPath = dirPath === albumFolder ? '' : dirPath.slice(albumFolder.length + 1)
    setCurrentPath(dirPath)
    setLoading(true); setError(null)

    try {
      loadDirFromManifest(albumManifest, relPath, albumFolder)
    } catch (e) { setError(e.message || '加载失败'); setLoading(false) }
  }

  // 缓存当前目录结果（用于返回时快速恢复）
  function cacheDirResult(dirPath) {
    dirCache.current.set(dirPath, {
      folders: [...folders],
      images: [...images],
      iconMap: { ...iconMap },
      coverMap: { ...coverMap }
    })
    if (dirCache.current.size > 30) {
      const firstKey = dirCache.current.keys().next().value
      if (firstKey !== undefined) dirCache.current.delete(firstKey)
    }
  }

  const handleThumbnailLoaded = useCallback((name, data, fullPath) => {
    setPreviewMap(prev => {
      const entries = Object.entries(prev)
      if (entries.length >= PREVIEW_MAP_MAX && !prev[name]) {
        const [oldestKey] = entries[0]; const { [oldestKey]: _, ...rest } = prev
        return { ...rest, [name]: data }
      }
      return { ...prev, [name]: data }
    })
  }, [])

    const handleFolderClick = useCallback(async (folder) => {
    const sep = currentPath.includes('\\') ? '\\' : '/'
    const newPath = currentPath + sep + folder.name
    preloadCancelRef.current = true
    preloadCancelRef.current = true
    preloadCancelRef.current = true
    cacheDirResult(currentPath)
    setCurrentPath(newPath); setPathHistory(prev => [...prev, { name: folder.name, path: newPath }])
    setPreviewMap({})
    await loadDirContents(newPath)
  }, [currentPath, folders, images, iconMap, coverMap])

    const handleBreadcrumbClick = useCallback(async (index) => {
    const target = pathHistory[index]; if (!target) return
    cacheDirResult(currentPath)
    setCurrentPath(target.path); setPathHistory(prev => prev.slice(0, index + 1))
    setPreviewMap({})
    await loadDirContents(target.path)
  }, [pathHistory, currentPath, folders, images, iconMap, coverMap])

    const handleGoBack = useCallback(async () => {
    if (pathHistory.length <= 1) return
    const newHistory = pathHistory.slice(0, -1); const parent = newHistory[newHistory.length - 1]
    cacheDirResult(currentPath)
    setCurrentPath(parent.path); setPathHistory(newHistory)
    setPreviewMap({})
    await loadDirContents(parent.path)
  }, [pathHistory, currentPath, folders, images, iconMap, coverMap])

  async function handleSelectFolder() {
    try {
      const result = await window.electronAPI?.selectAlbumFolder()
      if (result?.success && result?.path) {
        await window.electronAPI?.setUserConfig('albumFolderPath', result.path)
        setAlbumFolder(result.path); setCurrentPath(result.path); setPathHistory([{ name: '根目录', path: result.path }])
        setFolders([]); setImages([]); setIconMap({}); setCoverMap({}); setPreviewMap({}); setAlbumManifest(null)
        dirCache.current.clear()
        const tagRes = await window.electronAPI?.readAlbumTags()
        if (tagRes?.success && tagRes.data) setAlbumTags(tagRes.data); else setAlbumTags({})
        await ensureIndexThenLoad(result.path)
      }
    } catch (_) {}
  }

  const handleRebuildIndex = useCallback(async () => {
    if (!albumFolder) return
    setLoading(true); setError(null)
    try {
      const scanRes = await window.electronAPI?.scanAlbumIndex(albumFolder)
      if (scanRes?.error) { setError('索引失败: ' + scanRes.error); setLoading(false); return }
      const manRes = await window.electronAPI?.readAlbumManifest(albumFolder)
      if (manRes?.success && manRes.manifest) {
        setAlbumManifest(manRes.manifest)
        loadDirFromManifest(manRes.manifest, currentPath === albumFolder ? '' : currentPath.slice(albumFolder.length + 1), albumFolder)
      } else {
        setError(manRes?.error || '无法读取索引')
        setLoading(false)
      }
    } catch (e) { setError('索引失败: ' + (e.message || '未知错误')); setLoading(false) }
  }, [albumFolder, currentPath])

  async function handleChangeFolder() {
    try {
      const result = await window.electronAPI?.selectAlbumFolder()
      if (result?.success && result?.path) {
        await window.electronAPI?.setUserConfig('albumFolderPath', result.path)
        setAlbumFolder(result.path); setCurrentPath(result.path); setPathHistory([{ name: '根目录', path: result.path }])
        setFolders([]); setImages([]); setIconMap({}); setCoverMap({}); setPreviewMap({}); setAlbumManifest(null)
        dirCache.current.clear()
        const tagRes = await window.electronAPI?.readAlbumTags()
        if (tagRes?.success && tagRes.data) setAlbumTags(tagRes.data); else setAlbumTags({})
        await ensureIndexThenLoad(result.path)
      }
    } catch (_) {}
  }

  const handleImageClick = useCallback((img) => {
    const idx = images.findIndex(i => i.name === img.name && i._fullPath === img._fullPath)
    setLightboxIndex(idx >= 0 ? idx : 0); setLightboxOpen(true)
  }, [images])

  // 递归收集当前目录及所有子目录中匹配标签的条目
  function collectTaggedItems(manifest, rootPath, baseRelPath, activeTag, tagMap) {
    const sep = rootPath.includes('\\') ? '\\' : '/'
    const results = []
    const key = baseRelPath || ''
    const entry = manifest?.entries?.[key]
    if (!entry) return results
    const dirAbsPath = baseRelPath ? rootPath + sep + baseRelPath : rootPath

    for (const img of (entry.images || [])) {
      const fullPath = dirAbsPath + sep + img.name
      const tags = tagMap[fullPath] || []
      if (tags.includes(activeTag)) {
        results.push({ ...img, _fullPath: fullPath, kind: 'image' })
      }
    }

    for (const folderName of (entry.folders || [])) {
      const childRelPath = baseRelPath ? baseRelPath + sep + folderName : folderName
      const childResults = collectTaggedItems(manifest, rootPath, childRelPath, activeTag, tagMap)
      if (childResults.length > 0) {
        results.push({
          name: folderName,
          _fullPath: dirAbsPath + sep + folderName,
          kind: 'folder',
          isDirectory: true,
          matchCount: childResults.length,
        })
        results.push(...childResults)
      }
    }
    return results
  }

  const filterResults = useMemo(() => {
    if (!activeTagFilter || !albumManifest) return null
    const relPath = currentPath === albumFolder ? '' : currentPath.slice(albumFolder.length + 1)
    return collectTaggedItems(albumManifest, albumFolder, relPath, activeTagFilter, albumTags)
  }, [activeTagFilter, albumManifest, albumFolder, currentPath, albumTags])

  const lightboxItems = useMemo(() => [
    ...images.map(i => ({ ...i, kind: 'image' })),
  ], [images])

  const handlePrevImage = useCallback(() => { setLightboxIndex(i => (i - 1 + lightboxItems.length) % lightboxItems.length) }, [lightboxItems.length])
  const handleNextImage = useCallback(() => { setLightboxIndex(i => (i + 1) % lightboxItems.length) }, [lightboxItems.length])

  async function updatePreferences(partial) {
    const next = { ...preferences, ...partial }; setPreferences(next)
    try { await window.electronAPI?.setUserConfig('albumPreferences', next) } catch (_) {}
  }

  async function saveAlbumTagsToFile(tags) {
    setAlbumTags(tags)
    try { await window.electronAPI?.saveAlbumTags(tags) } catch (_) {}
  }

  async function saveTagDefs(defs) {
    setTagDefs(defs)
    try { await window.electronAPI?.setUserConfig('albumTagDefs', defs) } catch (_) {}
  }

  const handleToggleTag = useCallback((tagId) => {
    const item = contextMenuItem; if (!item) return
    const key = item._fullPath || item.name
    const currentTags = albumTags[key] || []
    const next = { ...albumTags }
    if (currentTags.includes(tagId)) { next[key] = currentTags.filter(t => t !== tagId); if (next[key].length === 0) delete next[key] }
    else { next[key] = [...currentTags, tagId] }
    saveAlbumTagsToFile(next)
  }, [contextMenuItem, albumTags])

  const handleLightboxToggleTag = useCallback((item, tagId) => {
    const key = item._fullPath || item.name
    const currentTags = albumTags[key] || []
    const next = { ...albumTags }
    if (currentTags.includes(tagId)) { next[key] = currentTags.filter(t => t !== tagId); if (next[key].length === 0) delete next[key] }
    else { next[key] = [...currentTags, tagId] }
    saveAlbumTagsToFile(next)
  }, [albumTags])

  const handleFolderContextMenu = useCallback((e, folder) => {
    e.preventDefault(); e.stopPropagation()
    setContextMenuItem(folder); setContextMenu({ x: e.clientX, y: e.clientY })
  }, [])

  const handleImageContextMenu = useCallback((e, img) => {
    e.preventDefault(); e.stopPropagation()
    setContextMenuItem(img); setContextMenu({ x: e.clientX, y: e.clientY })
  }, [])

  useEffect(() => {
    if (!contextMenu) return
    const close = () => { setContextMenu(null); setContextMenuItem(null) }
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [contextMenu])

  function getTagsForItem(item) { return albumTags[item?._fullPath || ''] || [] }

  if (!albumFolder) {
    return <div className="h-full flex flex-col bg-surface-900/90 backdrop-blur-xl"><WelcomeScreen onSelectFolder={handleSelectFolder} /></div>
  }

  return (
    <div className="h-full flex flex-col bg-surface-900/90 backdrop-blur-xl">
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-white/5 bg-surface-800/30 shrink-0">
        {pathHistory.length > 1 && <button onClick={handleGoBack} className="p-1.5 rounded-lg hover:bg-white/10 text-surface-400 hover:text-white transition-colors"><ArrowLeft className="w-4 h-4" /></button>}
        <div className="flex items-center gap-1 flex-1 min-w-0 overflow-x-auto no-scrollbar">
          {pathHistory.map((entry, i) => (
            <div key={i} className="flex items-center gap-1 shrink-0">
              {i > 0 && <span className="text-surface-600 text-[10px]">/</span>}
              <button onClick={() => handleBreadcrumbClick(i)}
                className={`text-[11px] px-1.5 py-0.5 rounded-md transition-colors whitespace-nowrap ${i === pathHistory.length - 1 ? 'text-white/80 font-medium' : 'text-surface-400 hover:text-surface-200 hover:bg-white/5'}`}>
                {i === 0 ? <span className="flex items-center gap-1"><Images className="w-3 h-3" />{displayName(entry.name)}</span> : displayName(entry.name)}
              </button>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <div className="relative">
            <button onClick={() => setShowTagFilter(!showTagFilter)} className={`p-1.5 rounded-lg transition-colors ${activeTagFilter ? 'bg-rose-500/20 text-rose-300' : 'hover:bg-white/10 text-surface-400 hover:text-white'}`} title="标签筛选"><Filter className="w-3.5 h-3.5" /></button>
            {showTagFilter && <TagFilterDropdown activeTag={activeTagFilter} tagDefs={tagDefs} onSelect={(tagId) => { setActiveTagFilter(prev => prev === tagId ? null : tagId); setShowTagFilter(false) }} onClose={() => setShowTagFilter(false)} />}
          </div>
          <div className="flex items-center gap-0.5 bg-surface-700/50 rounded-lg p-0.5 mr-1">
            <button onClick={() => setViewMode('grid')} className={`p-1.5 rounded-md transition-colors ${viewMode === 'grid' ? 'bg-white/10 text-white' : 'text-surface-500 hover:text-surface-300'}`}><LayoutGrid className="w-3.5 h-3.5" /></button>
            <button onClick={() => setViewMode('list')} className={`p-1.5 rounded-md transition-colors ${viewMode === 'list' ? 'bg-white/10 text-white' : 'text-surface-500 hover:text-surface-300'}`}><LayoutList className="w-3.5 h-3.5" /></button>
          </div>
          <button onClick={handleChangeFolder} className="p-1.5 rounded-lg hover:bg-white/10 text-surface-400 hover:text-white transition-colors" title="更换相册文件夹"><FolderOpen className="w-3.5 h-3.5" /></button>
          <button onClick={handleRebuildIndex} className="p-1.5 rounded-lg hover:bg-white/10 text-surface-400 hover:text-white transition-colors" title="重建索引"><RefreshCw className="w-4 h-4" /></button>
          <button onClick={() => setShowSettings(true)} className="p-1.5 rounded-lg hover:bg-white/10 text-surface-400 hover:text-white transition-colors" title="设置"><Settings className="w-3.5 h-3.5" /></button>
        </div>
      </div>
      <div className="flex-1 overflow-auto" style={{ contain: 'layout style' }}>
        {loading ? (
          <div className="h-full flex items-center justify-center"><div className="text-center"><div className="w-10 h-10 mx-auto mb-3 rounded-full border-2 border-surface-600 border-t-pink-400 animate-spin" /><p className="text-xs text-surface-500">正在加载...</p></div></div>
        ) : error ? (
          <div className="h-full flex items-center justify-center text-surface-500 text-sm"><div className="text-center"><FolderOpen className="w-12 h-12 mx-auto mb-3 opacity-30" /><p className="text-xs">{error}</p><button onClick={() => { dirCache.current.delete(currentPath); loadDirContents(currentPath) }} className="mt-3 px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-xs text-surface-300 transition-colors">重试</button></div></div>
        ) : folders.length === 0 && images.length === 0 ? (
          <div className="h-full flex items-center justify-center text-surface-500 text-sm"><div className="text-center"><Image className="w-12 h-12 mx-auto mb-3 opacity-30" /><p className="text-xs">此相簿为空</p></div></div>
        ) : viewMode === 'grid' ? (
          <AlbumGrid rootPath={albumFolder} folders={activeTagFilter && filterResults ? [] : folders}
            images={activeTagFilter && filterResults ? filterResults : images}
            iconMap={iconMap} coverMap={coverMap} previewMap={previewMap}
            onFolderClick={handleFolderClick} onImageClick={handleImageClick}
            sortBy={preferences.sortBy} gridSize={preferences.gridSize}
            albumTags={activeTagFilter ? undefined : albumTags} tagDefs={tagDefs}
            onFolderContextMenu={handleFolderContextMenu} onImageContextMenu={handleImageContextMenu}
            activeTagFilter={activeTagFilter} onThumbnailLoaded={handleThumbnailLoaded} />
        ) : (
          <ListView rootPath={albumFolder} folders={activeTagFilter && filterResults ? [] : folders}
            images={activeTagFilter && filterResults ? filterResults : images}
            iconMap={iconMap} coverMap={coverMap} previewMap={previewMap}
            onFolderClick={handleFolderClick} onImageClick={handleImageClick}
            sortBy={preferences.sortBy} albumTags={activeTagFilter ? undefined : albumTags} tagDefs={tagDefs}
            onFolderContextMenu={handleFolderContextMenu} onImageContextMenu={handleImageContextMenu} />
        )}
      </div>
      <div className="flex items-center justify-between px-3 py-1.5 border-t border-white/5 bg-surface-800/30 shrink-0">
        <span className="text-[10px] text-surface-500">{folders.length} 个相簿 · {images.length} 张图片</span>
        <span className="text-[10px] text-surface-600 truncate max-w-[200px]" title={currentPath}>{currentPath}</span>
      </div>
      {lightboxOpen && <Lightbox items={lightboxItems} currentIndex={lightboxIndex} onClose={() => setLightboxOpen(false)} onPrev={handlePrevImage} onNext={handleNextImage} rootPath={albumFolder} previewMap={previewMap} fullPreviewCache={fullPreviewCache} albumTags={albumTags} tagDefs={tagDefs} onToggleTag={handleLightboxToggleTag} />}
      {showSettings && <AlbumSettings preferences={preferences} onUpdate={updatePreferences} onClose={() => setShowSettings(false)} tagDefs={tagDefs} onSaveTagDefs={saveTagDefs} />}
      {contextMenu && contextMenuItem && createPortal(
        <ItemContextMenu x={contextMenu.x} y={contextMenu.y} item={contextMenuItem} tags={getTagsForItem(contextMenuItem)}
          tagDefs={tagDefs} onClose={() => { setContextMenu(null); setContextMenuItem(null) }} onToggleTag={handleToggleTag} onOpenSettings={() => setShowSettings(true)} />,
        document.body
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════
// 标签筛选下拉菜单
// ═══════════════════════════════════════════════
function TagFilterDropdown({ activeTag, tagDefs, onSelect, onClose }) {
  const ref = useRef(null)
  useEffect(() => { const h = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose() }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h) }, [onClose])
  return (
    <div ref={ref} ref={tagMenuRef} className="absolute right-0 top-full mt-1 w-40 py-1 rounded-xl bg-surface-900/95 backdrop-blur-xl border border-white/10 shadow-2xl z-30 animate-scale-in">
      <button onClick={() => onSelect(null)} className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors hover:bg-white/5 ${!activeTag ? 'text-white' : 'text-surface-400'}`}><Filter className="w-3 h-3" />全部</button>
      <div className="border-t border-white/5 my-1" />
      <button onClick={() => onSelect('favorite')} className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors hover:bg-white/5 ${activeTag === 'favorite' ? 'text-white' : 'text-surface-400'}`}><Heart className="w-3 h-3 text-rose-400" />{FAVORITE_TAG.name}</button>
      {tagDefs.map(tag => { const IconComp = getIconComponent(tag.icon); return (
        <button key={tag.id} onClick={() => onSelect(tag.id)} className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors hover:bg-white/5 ${activeTag === tag.id ? 'text-white' : 'text-surface-400'}`}>
          <IconComp className="w-3 h-3" style={{ color: tag.color }} />{tag.name}</button>
      )})}
    </div>
  )
}

// ═══════════════════════════════════════════════
// 列表视图
// ═══════════════════════════════════════════════
function ListView({
  rootPath, folders, images, iconMap, coverMap, previewMap,
  onFolderClick, onImageClick, sortBy,
  albumTags, tagDefs, onFolderContextMenu, onImageContextMenu,
}) {
  const allItems = [...folders.map(f => ({ ...f, kind: 'folder' })), ...images.map(f => ({ ...f, kind: 'image' }))]
  allItems.sort((a, b) => {
    if (a.kind !== b.kind) { if (a.kind === 'folder') return -1; if (b.kind === 'folder') return 1 }
    switch (sortBy) {
      case 'name-asc': return a.name.localeCompare(b.name); case 'name-desc': return b.name.localeCompare(a.name)
      case 'mtime-desc': return (b.mtime || '').localeCompare(a.mtime || ''); case 'mtime-asc': return (a.mtime || '').localeCompare(b.mtime || '')
      default: return a.name.localeCompare(b.name)
    }
  })
  function formatTime(iso) {
    if (!iso) return '—'
    try { const d = new Date(iso); return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) } catch (_) { return iso }
  }
  return (
    <div className="p-2 space-y-0.5">
      {allItems.map((item) => {
        const itemTags = albumTags?.[item._fullPath || item.name] || []
        return (
        <div key={item.kind + '-' + item.name} onClick={() => { if (item.kind === 'folder') onFolderClick(item); else onImageClick(item) }}
          onContextMenu={(e) => { if (item.kind === 'folder') onFolderContextMenu?.(e, item); else if (item.kind === 'image') onImageContextMenu?.(e, item) }}
          className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-white/5 cursor-pointer transition-colors group">
          <div className="w-10 h-10 rounded-lg overflow-hidden bg-surface-800/50 border border-white/5 shrink-0 relative">
            {item.kind === 'folder' ? (
              iconMap[item.name] ? <img src={iconMap[item.name]} alt="" className="no-fade-in w-full h-full object-cover" draggable={false} />
                : <div className="w-full h-full flex items-center justify-center"><FolderOpen className="w-5 h-5 text-blue-400/60" /></div>
            ) : previewMap[item.name] ? (
              <img src={previewMap[item.name]} alt="" className="no-fade-in w-full h-full object-cover" draggable={false} />
            ) : item.thumb ? (
              <LazyThumbnail rootPath={rootPath} thumbRelPath={item.thumb} alt={item.name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center"><Image className="w-4 h-4 text-surface-600" /></div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-surface-200 truncate group-hover:text-white transition-colors">{item.kind === 'folder' ? displayName(item.name) : item.name}</p>
            <p className="text-[10px] text-surface-500 mt-0.5">{item.kind === 'folder' ? '相簿' : formatSize(item.size)} · {formatTime(item.mtime)}</p>
          </div>
          {itemTags.length > 0 && (
            <div className="flex gap-0.5 shrink-0">{itemTags.slice(0, 2).map(tagId => {
              const def = tagId === 'favorite' ? FAVORITE_TAG : tagDefs?.find(d => d.id === tagId)
              if (!def) return null; const IconComp = getIconComponent(def.icon)
              return <div key={tagId} className="w-4 h-4 rounded-full flex items-center justify-center" style={{ backgroundColor: def.color + '30' }}><IconComp className="w-2 h-2" style={{ color: def.color }} /></div>
            })}</div>
          )}
          <span className={`text-[10px] px-1.5 py-0.5 rounded-md shrink-0 ${item.kind === 'folder' ? 'bg-blue-500/10 text-blue-400/70 border border-blue-500/10' : 'bg-green-500/10 text-green-400/70 border border-green-500/10'}`}>
            {item.kind === 'folder' ? '相簿' : '图片'}
          </span>
        </div>
      )})}
    </div>
  )
}

function formatSize(bytes) {
  if (!bytes) return '—'
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1048576).toFixed(1) + ' MB'
}

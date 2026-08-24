import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { useLocation } from 'react-router-dom'
import { resolveDesktopDrop } from '../utils/desktopPlacement'
import { useDb } from '../context/DbContext'
import { useTerminal } from '../context/TerminalContext'
import { APPS } from '../components/appRegistry'
import TrainCalc from '../components/TrainCalc'
import BetaMemo from '../components/BetaMemo'
import DragonSnake from '../components/DragonSnake'
import WorldTree from '../components/WorldTree'
import Album from '../components/Album'
import RateFetcher from '../components/RateFetcher'
import NorthlandBank from '../components/NorthlandBank'
import GachaStation from '../components/GachaStation'
import MemoryHub from '../components/MemoryHub'
import Hourglass from '../components/Hourglass'
import AITool from '../components/AITool'
import {
  X, Minus, Square, Copy, Monitor, ChevronLeft,
  FolderOpen, LayoutList, LayoutGrid,
  Upload, PaintBucket, Settings,
  File, FileText, Image, Database, Code, Search, Images
} from 'lucide-react'

const GRID_CELL = 110

// ═══════════════════════════════════════════════
// 桌面图标组件（自由拖拽 + 松手对齐网格）
// ═══════════════════════════════════════════════
function DesktopIcon({ app, onClick, position, onDragEnd, gridRef, settled, gridCols, isSelected, onDragStart, onDragMove, groupDragOffset, onRemove }) {
  const [dragging, setDragging] = useState(false)
  const [dragPos, setDragPos] = useState(null)
  const [contextMenu, setContextMenu] = useState(null)
  const menuJustOpened = useRef(false)
  const iconRef = useRef(null)

  // ── 右键菜单：点击空白处关闭 ──
  useEffect(() => {
    if (!contextMenu) return
    menuJustOpened.current = true
    const timer = setTimeout(() => { menuJustOpened.current = false }, 0)
    const close = () => {
      if (menuJustOpened.current) return
      setContextMenu(null)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('contextmenu', close)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('mousedown', close)
      window.removeEventListener('contextmenu', close)
    }
  }, [contextMenu])
  const dragOffset = useRef({ x: 0, y: 0 })
  const dragStartPos = useRef({ x: 0, y: 0 })

  const handleMouseDown = useCallback((e) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    onDragStart?.(app.id, e.clientX, e.clientY)
    dragStartPos.current = { x: e.clientX, y: e.clientY }
    const rect = iconRef.current.getBoundingClientRect()
    dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    setDragging(true)
    setDragPos({ x: e.clientX, y: e.clientY })
  }, [onDragStart])

  const handleClick = useCallback((e) => {
    e.stopPropagation()
    const dx = Math.abs(e.clientX - dragStartPos.current.x)
    const dy = Math.abs(e.clientY - dragStartPos.current.y)
    if (dx > 3 || dy > 3) return
    onClick(app)
  }, [app, onClick])

  useEffect(() => {
    if (!dragging) return

    const handleMove = (e) => {
      setDragPos({ x: e.clientX, y: e.clientY })
      onDragMove?.(app.id, e.clientX, e.clientY)
    }

    const handleUp = () => {
      setDragging(false)
      setDragPos(null)
      // 计算松手时的原始网格落点（不在此做重叠重定向，统一交给父组件 resolveDesktopDrop 处理）
      const grid = gridRef.current
      if (!grid) return
      const gridRect = grid.getBoundingClientRect()
      const centerX = dragPos?.x ?? dragStartPos.current.x
      const centerY = dragPos?.y ?? dragStartPos.current.y
      const x = centerX - gridRect.left - dragOffset.current.x + GRID_CELL / 2
      const y = centerY - gridRect.top - dragOffset.current.y + GRID_CELL / 2
      const col = Math.max(0, Math.min(gridCols - 1, Math.floor(x / GRID_CELL)))
      const row = Math.max(0, Math.floor(y / GRID_CELL))
      onDragEnd?.(app.id, col, row)
    }

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [dragging, app.id, onDragEnd, onDragMove, gridRef, dragPos, gridCols])

  const { col = 0, row = 0 } = position || {}
  const AppIcon = app.icon

  // 拖拽中跟随鼠标，否则使用网格位置
  const hasGroupOffset = !dragging && isSelected && groupDragOffset
  const style = dragging && dragPos && gridRef.current
    ? {
        left: dragPos.x - gridRef.current.getBoundingClientRect().left - dragOffset.current.x,
        top: dragPos.y - gridRef.current.getBoundingClientRect().top - dragOffset.current.y,
        width: 80,
        transition: 'none',
        zIndex: 50,
      }
    : {
        left: col * GRID_CELL + (GRID_CELL - 80) / 2 + (hasGroupOffset ? groupDragOffset.dx : 0),
        top: row * GRID_CELL + 8 + (hasGroupOffset ? groupDragOffset.dy : 0),
        width: 80,
        transition: hasGroupOffset ? 'none' : (!settled ? 'none' : 'left 0.15s ease, top 0.15s ease'),
        zIndex: 1,
      }

  return (
    <>
      <div
      ref={iconRef}
      className="absolute flex flex-col items-center gap-1.5 cursor-pointer group select-none"
      style={style}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY }) }}
    >
      <div className={`w-16 h-16 rounded-2xl border flex items-center justify-center bg-gradient-to-br ${app.color || 'from-white/10 to-white/5'} backdrop-blur-sm
        group-hover:scale-105 group-hover:shadow-lg transition-all duration-150
        ${dragging ? 'scale-110 shadow-xl' : ''}
        ${isSelected ? 'border-blue-400/80 ring-2 ring-blue-400/40 shadow-blue-500/20 shadow-lg' : 'border-white/20 group-hover:border-white/30'}`}
      >
        <AppIcon className={`w-8 h-8 ${app.iconClass || 'text-white drop-shadow-md'}`} />
      </div>
      <span className="text-[11px] text-white/80 text-center leading-tight drop-shadow-md px-1 py-0.5 rounded
        group-hover:bg-white/10 transition-colors">
        {app.name}
      </span>
    </div>

      {/* 右键菜单 */}
      {contextMenu && (
        <div
          className="fixed z-[300] w-32 py-1 rounded-xl bg-surface-900/95 backdrop-blur-xl border border-white/10 shadow-2xl animate-scale-in"
          style={{ left: Math.min(contextMenu.x, window.innerWidth - 150), top: Math.min(contextMenu.y, window.innerHeight - 80) }}
          onMouseDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
        >
          <button
            onClick={() => { onClick(app); setContextMenu(null) }}
            className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-surface-200 hover:bg-white/10 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            打开
          </button>
          <button
            onClick={() => { onRemove?.(app); setContextMenu(null) }}
            className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-surface-400 hover:bg-white/10 hover:text-surface-200 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            收起
          </button>
        </div>
      )}
    </>
  )
}

// ═══════════════════════════════════════════════
// 红绿灯组件
// ═══════════════════════════════════════════════
function TrafficLights({ onClose, onHide, onFullscreen, isFullscreen }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 no-drag" onMouseDown={e => e.stopPropagation()}>
      <button onClick={onClose} className="w-3.5 h-3.5 rounded-full bg-red-500 hover:bg-red-400 transition-colors flex items-center justify-center group" title="关闭">
        <X className="w-2 h-2 text-red-900 opacity-0 group-hover:opacity-100 transition-opacity" />
      </button>
      <button onClick={onHide} className="w-3.5 h-3.5 rounded-full bg-yellow-500 hover:bg-yellow-400 transition-colors flex items-center justify-center group" title="隐藏">
        <Minus className="w-2 h-2 text-yellow-900 opacity-0 group-hover:opacity-100 transition-opacity" />
      </button>
      <button onClick={onFullscreen} className="w-3.5 h-3.5 rounded-full bg-green-500 hover:bg-green-400 transition-colors flex items-center justify-center group" title={isFullscreen ? '还原' : '全屏'}>
        <Copy className={`w-1.5 h-1.5 text-green-900 opacity-0 group-hover:opacity-100 transition-opacity ${isFullscreen ? 'rotate-180' : ''}`} />
      </button>
    </div>
  )
}

// ═══════════════════════════════════════════════
// 应用窗口组件
// ═══════════════════════════════════════════════
export function TerminalWindow({ app, onClose, onHide, state, onUpdateState, onFocus, zIndex, pageVisible, onClearSelection }) {
  const [dragging, setDragging] = useState(false)
  const [resizing, setResizing] = useState(false)
  const windowRef = useRef(null)
  const dragStart = useRef({ x: 0, y: 0, left: 0, top: 0, width: 0, height: 0 })
  const resizeDir = useRef('')

  const { left = 100, top = 80, width = 600, height = 420, hidden = false, fullscreen = false } = state
  const { devMode } = useDb()

  // 侧栏宽度（响应折叠/展开）
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    return localStorage.getItem('sidebar_collapsed') === '1' ? 56 : 224
  })
  useEffect(() => {
    const update = () => setSidebarWidth(localStorage.getItem('sidebar_collapsed') === '1' ? 56 : 224)
    window.addEventListener('sidebar-toggled', update)
    return () => window.removeEventListener('sidebar-toggled', update)
  }, [])

  // 检测 macOS（红绿灯偏移用）
  const isMac = !/Win/i.test(navigator.platform || '')

  // 全屏时避开侧栏和开发者工具栏（使用显式 width/height 以支持投射动画）
  const [winSize, setWinSize] = useState({ w: window.innerWidth, h: window.innerHeight })
  useEffect(() => {
    const onResize = () => setWinSize({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // 最大化/恢复投射动画：fullscreen 变化时短暂开启全属性 transition
  const [maximizing, setMaximizing] = useState(false)
  useLayoutEffect(() => {
    setMaximizing(true)
    const timer = setTimeout(() => setMaximizing(false), 550)
    return () => clearTimeout(timer)
  }, [fullscreen])

  const fullscreenStyle = fullscreen ? {
    position: 'fixed',
    left: sidebarWidth, top: 0,
    width: winSize.w - sidebarWidth,
    height: winSize.h - (devMode ? 40 : 0),
    zIndex: 9999,
  } : null

  const handleTitleMouseDown = useCallback((e) => {
    if (e.button !== 0) return
    onClearSelection?.()
    e.preventDefault()
    setDragging(true)
    dragStart.current = { x: e.clientX, y: e.clientY, left, top, width, height }
    onFocus?.()
  }, [left, top, width, height, onFocus, onClearSelection])

  const onUpdateStateRef = useRef(onUpdateState)
  useEffect(() => { onUpdateStateRef.current = onUpdateState }, [onUpdateState])

  const handleTitleDoubleClick = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    onUpdateStateRef.current({ fullscreen: !fullscreen })
  }, [fullscreen])

  // 全屏时拖拽标题栏 → 移动整个 Electron 窗口（IPC 手动拖拽，避免 drag-region 拦截双击）
  const fullscreenDragRef = useRef(null)
  const windowPosRef = useRef({ x: 0, y: 0 })

  // 全屏时预缓存窗口位置，避免拖拽时异步延迟导致事件穿透
  // 依赖 fullscreen + hidden + pageVisible：确保隐藏/跨页面重新打开时刷新缓存
  useEffect(() => {
    if (!fullscreen || hidden) return
    window.electronAPI?.getWindowPosition().then(([wx, wy]) => {
      windowPosRef.current = { x: wx, y: wy }
    })
  }, [fullscreen, hidden, pageVisible])

  const handleFullscreenTitleMouseDown = useCallback((e) => {
    if (e.button !== 0) return
    onClearSelection?.()
    e.preventDefault()
    e.stopPropagation()
    const startX = e.screenX, startY = e.screenY
    const { x: wx, y: wy } = windowPosRef.current
    fullscreenDragRef.current = { startX, startY, wx, wy }
    // 同时异步更新缓存（以防窗口在其他地方被移动过）
    window.electronAPI?.getWindowPosition().then(([fx, fy]) => {
      if (fullscreenDragRef.current) {
        fullscreenDragRef.current.wx = fx
        fullscreenDragRef.current.wy = fy
      }
    })
    const onMove = (ev) => {
      if (!fullscreenDragRef.current) return
      const d = fullscreenDragRef.current
      window.electronAPI?.setWindowPosition(d.wx + ev.screenX - d.startX, d.wy + ev.screenY - d.startY)
    }
    const onUp = () => {
      // 拖拽结束后更新缓存
      if (fullscreenDragRef.current) {
        const d = fullscreenDragRef.current
        windowPosRef.current = { x: d.wx, y: d.wy }
      }
      fullscreenDragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [onClearSelection])

  const handleWindowClick = useCallback((e) => { onFocus?.() }, [onFocus])

  const handleResizeStart = useCallback((e, dir) => {
    e.preventDefault(); e.stopPropagation()
    setResizing(true); resizeDir.current = dir
    dragStart.current = { x: e.clientX, y: e.clientY, left, top, width, height }
  }, [left, top, width, height])

  // 拖拽/缩放期间直接操作 DOM（不经过 React state），避免每帧 mousemove 触发整棵 Provider 树重渲染导致卡顿；
  // 松手时一次性提交最终位置到状态。
  useEffect(() => {
    if (!dragging && !resizing) return
    const handleMove = (e) => {
      const el = windowRef.current
      if (!el) return
      if (dragging) {
        const dx = e.clientX - dragStart.current.x
        const dy = e.clientY - dragStart.current.y
        el.style.left = (dragStart.current.left + dx) + 'px'
        el.style.top = (dragStart.current.top + dy) + 'px'
      } else if (resizing) {
        const dx = e.clientX - dragStart.current.x
        const dy = e.clientY - dragStart.current.y
        const dir = resizeDir.current
        let { left, top, width, height } = dragStart.current
        if (dir.includes('e')) width = Math.max(320, dragStart.current.width + dx)
        if (dir.includes('s')) height = Math.max(240, dragStart.current.height + dy)
        if (dir.includes('w')) { width = Math.max(320, dragStart.current.width - dx); left = dragStart.current.left + dx }
        if (dir.includes('n')) { height = Math.max(240, dragStart.current.height - dy); top = dragStart.current.top + dy }
        el.style.left = left + 'px'
        el.style.top = top + 'px'
        el.style.width = width + 'px'
        el.style.height = height + 'px'
      }
    }
    const handleUp = () => {
      const el = windowRef.current
      if (el && (dragging || resizing)) {
        if (dragging) {
          const nl = parseFloat(el.style.left)
          const nt = parseFloat(el.style.top)
          if (!isNaN(nl) && !isNaN(nt)) onUpdateStateRef.current({ left: nl, top: nt })
        } else {
          const patch = {}
          const nw = parseFloat(el.style.width), nh = parseFloat(el.style.height)
          const nl = parseFloat(el.style.left), nt = parseFloat(el.style.top)
          if (!isNaN(nw)) patch.width = nw
          if (!isNaN(nh)) patch.height = nh
          if (!isNaN(nl)) patch.left = nl
          if (!isNaN(nt)) patch.top = nt
          onUpdateStateRef.current(patch)
        }
      }
      setDragging(false)
      setResizing(false)
    }
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => { window.removeEventListener('mousemove', handleMove); window.removeEventListener('mouseup', handleUp) }
  }, [dragging, resizing])

  // 隐藏/唤起动画：折叠到 Dock 对应图标位置（模仿 macOS 神奇效果）
  // 统一动画时长；支持动画中途切换方向（隐藏中唤起 / 唤起中隐藏）
  const [hideAnimating, setHideAnimating] = useState(false)
  const [summoning, setSummoning] = useState(false)
  const [actuallyHidden, setActuallyHidden] = useState(hidden)
  const hideTimerRef = useRef(null)
  const animRef = useRef(null)
  const dockTransformRef = useRef(null) // 隐藏时保存的收起 transform 参数（唤起反向播放用）
  const prevHiddenRef = useRef(hidden)  // 上一次 hidden 值，用于检测切换方向
  const HIDE_MS = 500
  const SUMMON_MS = 500

  // 计算窗口到 Dock 图标的 transform（按窗口中心与图标中心对齐）
  const getDockTransform = useCallback(() => {
    const el = windowRef.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    const dockEl = document.querySelector(`.terminal-dock-icon[data-app-id="${app.id}"]`)
    const dockRect = dockEl?.getBoundingClientRect()
    const dx = dockRect ? (dockRect.left + dockRect.width / 2) - (rect.left + rect.width / 2) : 0
    const dy = dockRect ? (dockRect.top + dockRect.height / 2) - (rect.top + rect.height / 2) : rect.height / 2
    const sx = dockRect ? dockRect.width / rect.width : 0.2
    const sy = dockRect ? dockRect.height / rect.height : 0.02
    return { dx, dy, sx, sy }
  }, [app.id])

  // 取消当前动画且不触发其 settle 回调（用于方向切换时接管动画）
  const cancelCurrentAnimation = useCallback(() => {
    const prev = animRef.current
    if (prev) {
      prev.onfinish = null
      prev.oncancel = null
      prev.cancel()
    }
    animRef.current = null
  }, [])

  // 隐藏：折叠到 Dock 图标（保存 transform 参数供唤起反向使用）
  // 起点 inline 为正常显示；fill:'both' 使动画完成保留收起、被 cancel 时回到正常 inline
  const playHideAnimation = useCallback(() => {
    const el = windowRef.current
    cancelCurrentAnimation()
    clearTimeout(hideTimerRef.current)
    const t = getDockTransform()
    if (el && t) {
      dockTransformRef.current = t
      const prevOrigin = el.style.transformOrigin
      const settle = () => {
        // 先 cancel 动画对象，移除 fill 效果，防止残留动画覆盖终态
        const anim = animRef.current
        animRef.current = null
        if (anim) { anim.onfinish = null; anim.oncancel = null; anim.cancel() }
        el.style.transform = `translate(${t.dx}px, ${t.dy}px) scale(${t.sx}, ${t.sy})`
        el.style.opacity = '0'
        el.style.transformOrigin = prevOrigin
        setHideAnimating(false)
        setActuallyHidden(true)
      }
      // 起点：正常显示（动画对象 fill:'both' 会覆盖为第一帧，cancel 时回到此状态）
      el.style.transformOrigin = 'center center'
      el.style.transform = ''
      el.style.opacity = '1'
      void el.offsetWidth
      const anim = el.animate([
        { transform: 'translate(0, 0) scale(1, 1)', opacity: 1 },
        { transform: `translate(${t.dx}px, ${t.dy}px) scale(${t.sx}, ${t.sy})`, opacity: 0 },
      ], { duration: HIDE_MS, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)', fill: 'both' })
      anim.onfinish = settle
      anim.oncancel = settle
      animRef.current = anim
      return
    }
    hideTimerRef.current = setTimeout(() => {
      setHideAnimating(false)
      setActuallyHidden(true)
    }, HIDE_MS)
  }, [getDockTransform, cancelCurrentAnimation])

  // 唤起：从 Dock 图标位置展开（使用隐藏时保存的 transform，避免测量收起后矩形）
  // 起点 inline 为正常显示；fill:'both' 使动画完成保留正常、被 cancel 时也回到正常 inline
  const playSummonAnimation = useCallback(() => {
    const el = windowRef.current
    cancelCurrentAnimation()
    const t = dockTransformRef.current
    if (el && t) {
      const prevOrigin = el.style.transformOrigin
      const settle = () => {
        // 先 cancel 动画对象，移除 fill 效果，防止残留动画覆盖终态
        const anim = animRef.current
        animRef.current = null
        if (anim) { anim.onfinish = null; anim.oncancel = null; anim.cancel() }
        el.style.transformOrigin = prevOrigin
        el.style.transform = ''
        el.style.opacity = '1'
        setActuallyHidden(false) // 双重保险：确保窗口显示
        setSummoning(false)
      }
      // 起点：正常显示（动画对象 fill:'both' 会覆盖为收起第一帧，cancel 时回到此状态）
      el.style.transformOrigin = 'center center'
      el.style.transform = ''
      el.style.opacity = '1'
      void el.offsetWidth
      const anim = el.animate([
        { transform: `translate(${t.dx}px, ${t.dy}px) scale(${t.sx}, ${t.sy})`, opacity: 0 },
        { transform: 'translate(0, 0) scale(1, 1)', opacity: 1 },
      ], { duration: SUMMON_MS, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)', fill: 'both' })
      anim.onfinish = settle
      anim.oncancel = settle
      animRef.current = anim
      return
    }
    // 无收起参数（从未隐藏过等）：直接显示
    if (el) {
      el.style.transform = ''
      el.style.opacity = '1'
    }
    setActuallyHidden(false)
    setSummoning(false)
  }, [cancelCurrentAnimation])

  // 状态驱动：仅在 hidden 变化时切换动画方向，动画中途可反向
  useEffect(() => {
    const wasHidden = prevHiddenRef.current
    prevHiddenRef.current = hidden

    if (hidden && !wasHidden) {
      // 请求隐藏：取消当前动画（若正在唤起），从头播放收起动画
      setHideAnimating(true)
      setSummoning(false)
      playHideAnimation()
    } else if (!hidden && wasHidden) {
      // 请求唤起：恢复显示（若尚未显示），然后从 Dock 位置展开
      clearTimeout(hideTimerRef.current)
      if (actuallyHidden) setActuallyHidden(false)
      setSummoning(true)
    }
  }, [hidden, actuallyHidden, playHideAnimation])

  // 组件卸载时清理
  useEffect(() => {
    return () => { clearTimeout(hideTimerRef.current); animRef.current?.cancel() }
  }, [])

  // 唤起动画：display 恢复后（DOM 已提交）同步播放，避免 rAF 延迟
  useLayoutEffect(() => {
    if (summoning) playSummonAnimation()
  }, [summoning, playSummonAnimation])

  // 关闭淡出
  const [closing, setClosing] = useState(false)
  const handleClose = useCallback(() => {
    if (closing) return
    setClosing(true)
    setTimeout(() => onClose(), 120)
  }, [closing, onClose])

  // 隐藏时保持组件挂载（display:none），重新打开时状态不丢失
  const closeClass = closing ? 'animate-fade-out' : ''
  const AppIcon = app.icon
  const isPageVisible = pageVisible !== false // 默认可见
  const displayNone = actuallyHidden || !isPageVisible

  return (
    <div ref={windowRef}
      data-window-root="true"
      className={`no-drag ${maximizing ? 'terminal-window-maximizing' : ''} ${closeClass}`}
      style={{ ...((fullscreen ? fullscreenStyle : { position: 'fixed', left, top, width, height, zIndex })), display: displayNone ? 'none' : undefined, opacity: displayNone ? 0 : 1, transformOrigin: 'center bottom' }}
      onMouseDown={handleWindowClick}
    >
      <div className={`h-full flex flex-col overflow-hidden border border-white/10 shadow-2xl bg-surface-900/90 backdrop-blur-xl transition-all duration-150 ${fullscreen ? 'rounded-none border-0' : 'rounded-xl'}`}>
        <div data-window-titlebar="true" className="relative z-50 flex items-center bg-surface-800/60 backdrop-blur-sm border-b border-white/5 select-none no-drag" style={{ minHeight: 38 }} onMouseDown={fullscreen ? handleFullscreenTitleMouseDown : handleTitleMouseDown} onDoubleClick={handleTitleDoubleClick}>
          {fullscreen && isMac && <div style={{ width: Math.max(0, 72 - sidebarWidth), flexShrink: 0 }} />}
          <TrafficLights onClose={handleClose} onHide={onHide} onFullscreen={() => onUpdateState({ fullscreen: !fullscreen })} isFullscreen={fullscreen} />
          <div className="flex-1 flex items-center gap-2 justify-center">
            <AppIcon className="w-3.5 h-3.5 text-surface-400" />
            <span className="text-[11px] font-medium text-surface-400">{app.name}</span>
          </div>
          <div className="w-16" />
        </div>
        <div className="flex-1 overflow-auto">
          {app.id === 'traincalc' ? <TrainCalc initialData={app.data} /> : app.id === 'betamemo' ? <BetaMemo /> : app.id === 'dragonsnake' ? <DragonSnake /> : app.id === 'worldtree' ? <WorldTree /> : app.id === 'album' ? <Album /> : app.id === 'ratefetcher' ? <RateFetcher /> : app.id === 'northlandbank' ? <NorthlandBank /> : app.id === 'gachastation' ? <GachaStation /> : app.id === 'memoryhub' ? <MemoryHub initialData={app.data} /> : app.id === 'hourglass' ? <Hourglass /> : app.placeholder ? <PlaceholderApp app={app} /> : app.system ? <SystemToolContent tool={app} /> : null}
        </div>
        {!fullscreen && (
          <>
            {/* 角落（z 高于标题栏 z-50，确保可拖拽调窗） */}
            <div className="absolute top-0 left-0 w-3 h-3 cursor-nw-resize z-[60]" onMouseDown={e => handleResizeStart(e, 'nw')} />
            <div className="absolute top-0 right-0 w-3 h-3 cursor-ne-resize z-[60]" onMouseDown={e => handleResizeStart(e, 'ne')} />
            <div className="absolute bottom-0 left-0 w-3 h-3 cursor-sw-resize z-[60]" onMouseDown={e => handleResizeStart(e, 'sw')} />
            <div className="absolute bottom-0 right-0 w-3 h-3 cursor-se-resize z-[60]" onMouseDown={e => handleResizeStart(e, 'se')} />
            {/* 边缘 */}
            <div className="absolute top-0 left-3 right-3 h-1 cursor-n-resize z-[60]" onMouseDown={e => handleResizeStart(e, 'n')} />
            <div className="absolute bottom-0 left-3 right-3 h-1 cursor-s-resize z-[60]" onMouseDown={e => handleResizeStart(e, 's')} />
            <div className="absolute left-0 top-3 bottom-3 w-1 cursor-w-resize z-[60]" onMouseDown={e => handleResizeStart(e, 'w')} />
            <div className="absolute right-0 top-3 bottom-3 w-1 cursor-e-resize z-[60]" onMouseDown={e => handleResizeStart(e, 'e')} />
          </>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════
// 占位应用
// ═══════════════════════════════════════════════
function PlaceholderApp({ app }) {
  const AppIcon = app.icon
  return (
    <div className="h-full flex flex-col items-center justify-center gap-4 p-8">
      <div className="w-20 h-20 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center">
        <AppIcon className="w-10 h-10 text-surface-500" />
      </div>
      <div>
        <h2 className="text-lg font-semibold text-white text-center">{app.name}</h2>
        <p className="text-xs text-surface-500 mt-1 text-center">此应用尚在开发中，敬请期待</p>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════
// 系统工具
// ═══════════════════════════════════════════════
function SystemToolContent({ tool }) {
  const { getDbPath } = useDb()
  const [viewMode, setViewMode] = useState('icon')
  const [currentDir, setCurrentDir] = useState('')
  const [files, setFiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [previews, setPreviews] = useState({})

  useEffect(() => { loadDir() }, [])

  useEffect(() => {
    const imgExts = ['jpg','jpeg','png','webp','gif','svg','bmp']
    const newPreviews = {}
    let pending = 0
    files.forEach(f => {
      const ext = f.name.split('.').pop()?.toLowerCase()
      if (imgExts.includes(ext) && !previews[f.name]) {
        pending++
        const sep = currentDir.includes('\\') ? '\\' : '/'
        window.electronAPI?.readFilePreview(currentDir + sep + f.name).then(r => {
          if (r?.data) newPreviews[f.name] = r.data
        }).finally(() => {
          pending--
          if (pending === 0 && Object.keys(newPreviews).length > 0)
            setPreviews(prev => ({ ...prev, ...newPreviews }))
        })
      }
    })
  }, [files, currentDir])

  async function loadDir(dirPath) {
    setLoading(true)
    setError('')
    try {
      if (dirPath) {
        setCurrentDir(dirPath)
        const res = await window.electronAPI?.listDirectory(dirPath)
        if (res?.files) setFiles(res.files)
        else if (res?.error) setError(res.error)
        else setError('无法读取目录')
        setLoading(false)
        return
      }
      const pathRes = await getDbPath()
      if (!pathRes?.success && pathRes?.success !== undefined) {
        setError('请使用完整桌面应用查看文件'); setLoading(false); return
      }
      const root = pathRes?.dbDir || ''
      if (!root) { setError('请使用完整桌面应用查看文件'); setLoading(false); return }
      setCurrentDir(root)
      const res = await window.electronAPI?.listDirectory(root)
      if (res?.files) setFiles(res.files)
      else if (res?.error) setError(res.error)
      else setError('无法读取目录')
    } catch (e) {
      setError('无法加载: ' + (e.message || '未知错误'))
    } finally { setLoading(false) }
  }

  function handleFolderClick(file) {
    if (file.isDirectory) {
      const sep = currentDir.includes('\\') ? '\\' : '/'
      loadDir(currentDir + sep + file.name)
    }
  }

  function handleFileDoubleClick(file) {
    if (file.isDirectory) return
    const sep = currentDir.includes('\\') ? '\\' : '/'
    const fp = currentDir + sep + file.name
    window.electronAPI?.openFile(fp)
  }

  function handleFileDragStart(e, file) {
    if (file.isDirectory) { e.preventDefault(); return }
    const sep = currentDir.includes('\\') ? '\\' : '/'
    const fp = currentDir + sep + file.name
    // 阻止默认 HTML5 拖拽，改用 Electron 原生 startDrag
    // 原生 startDrag 提供真实文件：外部拖入访达/Finder 复制原文件，
    // 内部拖入导入区域时也会通过 HTML5 drop 事件提供 File 对象（含 path）
    // 同时设置 text/plain 为完整路径，作为内部导入区域的 fallback
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.setData('text/plain', fp)
    e.dataTransfer.effectAllowed = 'copy'
    window.electronAPI?.startFileDrag(fp)
  }

  function goBack() {
    const sep = currentDir.includes('\\') ? '\\' : '/'
    const idx = currentDir.lastIndexOf(sep)
    if (idx <= 0) return
    loadDir(currentDir.substring(0, idx))
  }

  const filteredFiles = search ? files.filter(f => f.name.toLowerCase().includes(search.toLowerCase())) : files

  function formatSize(bytes) {
    if (!bytes) return '—'
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / 1048576).toFixed(1) + ' MB'
  }

  function getFileIcon(file, small) {
    const sz = small ? 'w-5 h-5' : 'w-8 h-8'
    if (file.isDirectory) return <FolderOpen className={`${sz} text-blue-400`} />
    const ext = file.name.split('.').pop()?.toLowerCase()
    if (['jpg','jpeg','png','webp','gif','svg','bmp'].includes(ext)) {
      const p = previews[file.name]
      if (p && !small) return <img src={p} alt="" className="w-14 h-14 object-cover rounded-lg" draggable={false} />
      return <Image className={`${sz} text-green-400`} />
    }
    if (['db','sqlite'].includes(ext)) return <Database className={`${sz} text-orange-400`} />
    if (['json'].includes(ext)) return <Code className={`${sz} text-yellow-400`} />
    if (['txt','md','csv'].includes(ext)) return <FileText className={`${sz} text-surface-400`} />
    return <File className={`${sz} text-surface-500`} />
  }

  const isWin = !/Mac/i.test(navigator.platform || '')

  if (tool.id === 'resources') {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5 bg-surface-800/30">
          <button onClick={goBack} className="p-1 rounded-md text-surface-400 hover:text-white hover:bg-white/10 transition-colors">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-[11px] text-surface-400 font-mono truncate flex-1">{loading ? '…' : currentDir || ''}</span>
          <div className="flex items-center gap-1 bg-surface-700/50 rounded-lg p-0.5">
            <button onClick={() => setViewMode('icon')} className={`p-1.5 rounded-md transition-colors ${viewMode === 'icon' ? 'bg-white/10 text-white' : 'text-surface-500 hover:text-surface-300'}`}>
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => setViewMode('list')} className={`p-1.5 rounded-md transition-colors ${viewMode === 'list' ? 'bg-white/10 text-white' : 'text-surface-500 hover:text-surface-300'}`}>
              <LayoutList className="w-3.5 h-3.5" />
            </button>
          </div>
          <button onClick={() => { if (currentDir) window.electronAPI?.openFolder(currentDir) }}
            className="px-2 py-1 rounded-lg text-[11px] bg-white/10 hover:bg-white/20 text-surface-300 transition-colors flex items-center gap-1 shrink-0">
            <FolderOpen className="w-3 h-3" />{isWin ? '打开' : '访达'}
          </button>
        </div>
        <div className="px-3 py-1.5 border-b border-white/5">
          <div className="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-surface-800/50">
            <Search className="w-3 h-3 text-surface-500 shrink-0" />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索文件..." className="flex-1 bg-transparent text-xs text-surface-200 placeholder-surface-600 outline-none" />
            {search && <button onClick={() => setSearch('')} className="text-surface-500 hover:text-surface-300"><X className="w-3 h-3" /></button>}
          </div>
        </div>
        <div className="flex-1 overflow-auto p-3">
          {loading ? (
            <div className="h-full flex items-center justify-center"><div className="text-center"><div className="w-8 h-8 mx-auto mb-3 rounded-full border-2 border-surface-600 border-t-surface-400 animate-spin" /><p className="text-xs text-surface-500">正在加载...</p></div></div>
          ) : error ? (
            <div className="h-full flex items-center justify-center text-surface-500 text-sm"><div className="text-center"><FolderOpen className="w-12 h-12 mx-auto mb-3 opacity-30" /><p className="text-xs">{error}</p></div></div>
          ) : filteredFiles.length === 0 ? (
            <div className="h-full flex items-center justify-center text-surface-500 text-sm"><div className="text-center"><FolderOpen className="w-12 h-12 mx-auto mb-3 opacity-30" /><p className="text-xs">{search ? '无匹配文件' : '文件夹为空'}</p></div></div>
          ) : viewMode === 'icon' ? (
            <div className="grid grid-cols-4 gap-3">
              {filteredFiles.map((f, i) => (
                <div key={i} onClick={() => handleFolderClick(f)} onDoubleClick={() => handleFileDoubleClick(f)}
                  draggable={!f.isDirectory} onDragStart={(e) => handleFileDragStart(e, f)}
                  className="flex flex-col items-center gap-1 p-2 rounded-xl hover:bg-white/5 cursor-pointer transition-colors group">
                  {getFileIcon(f)}
                  <span className="text-[10px] text-surface-300 text-center leading-tight break-all line-clamp-2 group-hover:text-white transition-colors">{f.name}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-0.5">
              {filteredFiles.map((f, i) => (
                <div key={i} onClick={() => handleFolderClick(f)} onDoubleClick={() => handleFileDoubleClick(f)}
                  draggable={!f.isDirectory} onDragStart={(e) => handleFileDragStart(e, f)}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 cursor-pointer transition-colors">
                  <div className="shrink-0">{getFileIcon(f, true)}</div>
                  <div className="flex-1 min-w-0"><p className="text-xs text-surface-200 truncate">{f.name}</p><p className="text-[10px] text-surface-500">{f.isDirectory ? '文件夹' : formatSize(f.size)}</p></div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  if (tool.id === 'customize') return <CustomizationTool />
  if (tool.id === 'ai') return <AITool />
  return null
}

// ═══════════════════════════════════════════════
// 自定义工具
// ═══════════════════════════════════════════════
function CustomizationTool() {
  const [tab, setTab] = useState('wallpaper')
  const [wallpaper, setWallpaper] = useState(null)
  const [preview, setPreview] = useState(null)
  const [msg, setMsg] = useState(null)
  const [wallDragOver, setWallDragOver] = useState(false)

  useEffect(() => { loadWallpaper() }, [])

  async function loadWallpaper() {
    try {
      const res = await window.electronAPI?.getUserConfig()
      const w = res?.config?.terminalWallpaper
      if (w) { setWallpaper(w); const result = await window.electronAPI?.readUserImage(w, 0); if (result?.data) setPreview(result.data) }
    } catch (_) {}
  }

  async function handleImport() {
    try {
      const result = await window.electronAPI?.importUserImage()
      if (result?.filename) await applyWallpaper(result.filename)
    } catch (e) { setMsg({ type: 'error', text: '导入失败: ' + e.message }) }
  }

  // 拖拽导入壁纸
  function handleWallDragOver(e) { e.preventDefault(); e.stopPropagation(); setWallDragOver(true) }
  function handleWallDragLeave(e) { e.preventDefault(); e.stopPropagation(); setWallDragOver(false) }
  async function handleWallDrop(e) {
    e.preventDefault(); e.stopPropagation(); setWallDragOver(false)
    let srcPath = null
    const files = e.dataTransfer?.files
    if (files && files.length > 0) {
      const file = files[0]
      if (!file.type.startsWith('image/')) { setMsg({ type: 'error', text: '请拖入图片文件' }); return }
      srcPath = file.path
    } else {
      // fallback: 从 text/plain 获取文件路径（支持资源面板拖来的文件）
      const text = e.dataTransfer?.getData('text/plain')
      if (text) srcPath = text
    }
    if (!srcPath) return
    try {
      // 一次 IPC 完成导入+缩略图，避免二次往返
      const result = await window.electronAPI?.importAndThumbnail(srcPath, 1024)
      if (result?.data) {
        setWallpaper(result.filename); setPreview(result.data)
        await window.electronAPI?.setUserConfig('terminalWallpaper', result.filename)
        setMsg({ type: 'success', text: '壁纸已更新' })
        window.dispatchEvent(new CustomEvent('terminal-wallpaper-changed', { detail: result.data }))
      } else if (result?.error) {
        setMsg({ type: 'error', text: result.error })
      }
    } catch (e) { setMsg({ type: 'error', text: '导入失败: ' + e.message }) }
  }

  async function applyWallpaper(filename) {
    const readResult = await window.electronAPI?.readUserImage(filename, 0)
    if (readResult?.data) {
      setWallpaper(filename); setPreview(readResult.data)
      await window.electronAPI?.setUserConfig('terminalWallpaper', filename)
      setMsg({ type: 'success', text: '壁纸已更新' })
      window.dispatchEvent(new CustomEvent('terminal-wallpaper-changed', { detail: readResult.data }))
    } else if (readResult?.error) {
      setMsg({ type: 'error', text: readResult.error })
    }
  }

  async function handlePreset(name) {
    try {
      setMsg(null)
      await applyWallpaper(name)
    } catch (e) { setMsg({ type: 'error', text: '预设应用失败: ' + e.message }) }
  }

  async function handleRemove() {
    setWallpaper(null); setPreview(null)
    await window.electronAPI?.setUserConfig('terminalWallpaper', null)
    setMsg({ type: 'success', text: '已恢复默认' })
    window.dispatchEvent(new CustomEvent('terminal-wallpaper-changed', { detail: null }))
  }

  const tabs = [
    { id: 'wallpaper', label: '壁纸', icon: Monitor },
    { id: 'general', label: '通用', icon: Settings },
  ]

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center px-4 py-2 gap-1 border-b border-white/5 bg-surface-800/30">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${tab === t.id ? 'bg-white/10 text-white' : 'text-surface-500 hover:text-surface-300 hover:bg-white/5'}`}>
            <t.icon className="w-3.5 h-3.5" />{t.label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-auto p-6">
        {tab === 'wallpaper' && (
          <div className="space-y-5">
            <div><h3 className="text-sm font-semibold text-white">桌面壁纸</h3><p className="text-xs text-surface-500 mt-1">自定义终端桌面的背景图片</p></div>
            {msg && <div className={`p-3 rounded-xl text-xs ${msg.type === 'success' ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>{msg.text}</div>}
            <div
              className={`rounded-xl overflow-hidden border aspect-video flex items-center justify-center transition-all ${wallDragOver ? 'border-sky-400/60 bg-sky-400/10 ring-2 ring-sky-400/30' : 'border-white/10 bg-surface-800/50'}`}
              onDragOver={handleWallDragOver}
              onDragLeave={handleWallDragLeave}
              onDrop={handleWallDrop}
            >
              {preview ? <img src={preview} alt="" className="w-full h-full object-cover" /> : <div className="text-center text-surface-500"><Monitor className="w-12 h-12 mx-auto mb-2 opacity-30" /><p className="text-xs">{wallDragOver ? '松开以设置壁纸' : '拖入图片或点击导入'}</p></div>}
            </div>
            {/* 预设壁纸 */}
            <div>
              <p className="text-xs text-surface-500 mb-2">预设壁纸</p>
              <div className="flex gap-3">
                <button
                  onClick={() => handlePreset('ToTheMoon.jpg')}
                  className="relative w-24 h-16 rounded-lg overflow-hidden border border-white/10 hover:border-white/30 transition-all group"
                >
                  <img src="./ToTheMoon.jpg" alt="ToTheMoon" className="w-full h-full object-cover" />
                  <div className="absolute inset-0 flex items-end justify-center pb-1 opacity-0 group-hover:opacity-100 transition-opacity bg-gradient-to-t from-black/60 to-transparent">
                    <span className="text-[10px] text-white">ToTheMoon</span>
                  </div>
                </button>
                <button
                  onClick={() => handlePreset('OS_Columbina.jpg')}
                  className="relative w-24 h-16 rounded-lg overflow-hidden border border-white/10 hover:border-white/30 transition-all group"
                >
                  <img src="./OS_Columbina.jpg" alt="Columbina" className="w-full h-full object-cover" />
                  <div className="absolute inset-0 flex items-end justify-center pb-1 opacity-0 group-hover:opacity-100 transition-opacity bg-gradient-to-t from-black/60 to-transparent">
                    <span className="text-[10px] text-white">Columbina</span>
                  </div>
                </button>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={handleImport} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/10 text-sm text-surface-300 transition-all"><Upload className="w-4 h-4" />导入壁纸</button>
              {wallpaper && <button onClick={handleRemove} className="px-4 py-2 rounded-xl text-sm text-surface-500 hover:text-red-400 hover:bg-red-500/10 transition-all">恢复默认</button>}
            </div>
          </div>
        )}
        {tab === 'general' && (
          <ShortcutSettings />
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════
// 快捷键设置（自定义-通用）
// ═══════════════════════════════════════════════
function ShortcutSettings() {
  const [shortcut, setShortcut] = useState('ctrl+tab')
  const [capturing, setCapturing] = useState(false)
  const [savedMsg, setSavedMsg] = useState(null)
  const isMac = !/Win/i.test(navigator.platform || '')

  useEffect(() => {
    (async () => {
      try {
        const res = await window.electronAPI?.getUserConfig()
        if (res?.config?.libraryShortcut) setShortcut(res.config.libraryShortcut)
      } catch (_) {}
    })()
  }, [])

  // 格式化显示：ctrl+tab → ⌃Tab / Ctrl+Tab
  function formatShortcut(s) {
    const parts = String(s || '').split('+').filter(Boolean)
    const mods = []
    for (const p of parts.slice(0, -1)) {
      if (p === 'ctrl') mods.push(isMac ? '⌃' : 'Ctrl')
      else if (p === 'alt') mods.push(isMac ? '⌥' : 'Alt')
      else if (p === 'shift') mods.push(isMac ? '⇧' : 'Shift')
      else if (p === 'meta') mods.push(isMac ? '⌘' : 'Win')
    }
    const key = parts[parts.length - 1]
    const keyLabel = key === 'tab' ? 'Tab' : key === 'space' ? 'Space' : key.toUpperCase()
    return [...mods, keyLabel].join(isMac ? '' : '+')
  }

  // 开始捕获快捷键
  function startCapture() {
    setCapturing(true)
    setSavedMsg(null)
  }

  useEffect(() => {
    if (!capturing) return
    const handler = (e) => {
      e.preventDefault()
      e.stopPropagation()
      // 至少一个修饰键或特殊键
      const key = e.key.toLowerCase()
      const isModifier = ['control', 'alt', 'shift', 'meta'].includes(key)
      if (isModifier) return // 忽略纯修饰键
      if (!e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
        if (key === 'escape') { setCapturing(false); return }
        return // 必须有修饰键（防误触）
      }
      const parts = []
      if (e.ctrlKey) parts.push('ctrl')
      if (e.altKey) parts.push('alt')
      if (e.shiftKey) parts.push('shift')
      if (e.metaKey) parts.push('meta')
      parts.push(key === ' ' ? 'space' : key)
      const next = parts.join('+')
      setShortcut(next)
      setCapturing(false)
      ;(async () => {
        try {
          await window.electronAPI?.setUserConfig('libraryShortcut', next)
          window.dispatchEvent(new CustomEvent('library-shortcut-changed', { detail: next }))
          setSavedMsg({ type: 'ok', text: '快捷键已保存' })
        } catch (_) { setSavedMsg({ type: 'err', text: '保存失败' }) }
      })()
    }
    const keyup = (e) => { if (e.key === 'Escape') setCapturing(false) }
    window.addEventListener('keydown', handler, true)
    window.addEventListener('keyup', keyup)
    return () => {
      window.removeEventListener('keydown', handler, true)
      window.removeEventListener('keyup', keyup)
    }
  }, [capturing])

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-white">快捷键</h3>
        <p className="text-xs text-surface-500 mt-1">设置唤起「资源库」的全局快捷键</p>
      </div>

      <div className="flex items-center gap-3">
        <span className="text-xs text-surface-400 shrink-0">资源库快捷键</span>
        <button
          onClick={startCapture}
          disabled={capturing}
          className={`px-4 py-2 rounded-xl border text-sm font-mono transition-all min-w-[120px] text-center ${
            capturing
              ? 'bg-sky-500/15 border-sky-500/40 text-sky-300 animate-pulse'
              : 'bg-surface-800/70 border-surface-600 text-surface-200 hover:border-surface-400'
          }`}
        >
          {capturing ? '按下新组合...' : formatShortcut(shortcut)}
        </button>
        <button onClick={startCapture} disabled={capturing}
          className="px-3 py-2 rounded-xl text-xs bg-white/10 hover:bg-white/20 text-surface-300 transition-all disabled:opacity-50">
          修改
        </button>
      </div>
      <p className="text-[10px] text-surface-600">仅支持带修饰键的组合（Ctrl/⌃、Alt/⌥、Shift/⇧、⌘/Win + 任意键），Esc 取消</p>

      {savedMsg && (
        <div className={`px-3 py-2 rounded-xl text-xs ${savedMsg.type === 'ok' ? 'text-green-400 bg-green-500/10' : 'text-red-400 bg-red-500/10'}`}>
          {savedMsg.text}
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════
// 主 TerminalPage 组件
// ═══════════════════════════════════════════════
export default function TerminalPage() {
  const { launchApp, selectedAppIds, setSelectedAppIds } = useTerminal()
  const location = useLocation()
  const [wallpaper, setWallpaper] = useState(null)
  const [desktopIcons, setDesktopIcons] = useState({})
  const [settled, setSettled] = useState(false)
  const [gridCols, setGridCols] = useState(6)
  const desktopRef = useRef(null)

  // ── 框选状态 ──
  const [selecting, setSelecting] = useState(false)
  const [selBox, setSelBox] = useState(null)
  const selStart = useRef({ x: 0, y: 0 })
  const selBoxRef = useRef(null)
  // 群组拖动实时偏移
  const [groupDragOffset, setGroupDragOffset] = useState(null)
  const groupDragStartMouse = useRef({ x: 0, y: 0 })

  // 切换页面时清除选中
  useEffect(() => { setSelectedAppIds([]) }, [location.pathname, setSelectedAppIds])

  // 动态列数
  useEffect(() => {
    const el = desktopRef.current
    if (!el) return
    const update = () => {
      const cols = Math.max(1, Math.floor(el.clientWidth / GRID_CELL))
      setGridCols(prev => {
        if (prev === cols) return prev
        if (cols < prev) {
          setDesktopIcons(p => {
            const occ = {}
            for (const [id, pos] of Object.entries(p)) {
              if (pos.col < cols) occ[`${pos.col},${pos.row}`] = id
            }
            const next = { ...p }
            // 超出范围的图标：按行分组，同行左→右排序
            const overflow = []
            for (const [id, pos] of Object.entries(next)) {
              if (pos.col >= cols) overflow.push({ id, row: pos.row, col: pos.col })
            }
            overflow.sort((a, b) => a.row - b.row || a.col - b.col)
            for (const item of overflow) {
              const maxCol = cols - 1
              let found = false
              // 1) 同行向左找最近的空格
              for (let c = Math.min(item.col, maxCol); c >= 0 && !found; c--) {
                if (!occ[`${c},${item.row}`]) {
                  next[item.id] = { col: c, row: item.row }
                  occ[`${c},${item.row}`] = item.id
                  found = true
                }
              }
              // 2) 同行向右找
              for (let c = Math.min(item.col, maxCol) + 1; c <= maxCol && !found; c++) {
                if (!occ[`${c},${item.row}`]) {
                  next[item.id] = { col: c, row: item.row }
                  occ[`${c},${item.row}`] = item.id
                  found = true
                }
              }
              // 3) 同行满 → 最近空格
              if (!found) {
                let bc = 0, br = 0, bd = Infinity
                for (let r = 0; r < 30; r++) {
                  for (let c = 0; c < cols; c++) {
                    if (!occ[`${c},${r}`]) {
                      const d = Math.abs(c - item.col) + Math.abs(r - item.row)
                      if (d < bd) { bd = d; bc = c; br = r }
                    }
                  }
                }
                next[item.id] = { col: bc, row: br }
                occ[`${bc},${br}`] = item.id
              }
            }
            return next
          })
        }
        return cols
      })
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => { loadConfig() }, [])

  useEffect(() => {
    const handler = (e) => { setWallpaper(e.detail || null) }
    window.addEventListener('terminal-wallpaper-changed', handler)
    return () => window.removeEventListener('terminal-wallpaper-changed', handler)
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => setSettled(true), 100)
    return () => clearTimeout(timer)
  }, [])

  async function loadConfig() {
    try {
      const res = await window.electronAPI?.getUserConfig()
      const config = res?.config || {}
      if (config.terminalWallpaper) {
        const result = await window.electronAPI?.readUserImage(config.terminalWallpaper, 0)
        if (result?.data) setWallpaper(result.data)
      }
      if (config.terminalDesktopIcons) {
        setDesktopIcons(config.terminalDesktopIcons)
      }
      // 首次初始化：桌面默认为空（小程序只出现在资源库，需手动拖入桌面）
      else {
        setDesktopIcons({})
      }
    } catch (_) {}
  }

  async function saveDesktopIcons(icons) {
    setDesktopIcons(icons)
    await window.electronAPI?.setUserConfig('terminalDesktopIcons', icons)
  }

  function handleIconDragEnd(appId, col, row) {
    setGroupDragOffset(null)
    groupDragStartMouse.current = { x: 0, y: 0 }
    const origins = dragOriginRef.current
    dragOriginRef.current = {}
    // 放置逻辑统一在 desktopPlacement 中处理：
    // 单图标 → 目标格被占用时找最近空格；组合 → 按落点位移整体平移，
    // 校验不越界、不压到未选中 app，必要时就近调整，并修复成员间历史重叠
    const next = resolveDesktopDrop({
      draggedId: appId,
      rawCol: col,
      rawRow: row,
      origins,
      selectedIds: selectedAppIds,
      occupied: getOccupiedCells(),
      gridCols,
    })
    saveDesktopIcons({ ...desktopIcons, ...next })
  }

  const dragOriginRef = useRef({})
  function handleIconDragStart(appId, clientX, clientY) {
    if (selectedAppIds.length > 1 && selectedAppIds.includes(appId)) {
      for (const id of selectedAppIds) {
        dragOriginRef.current[id] = getIconPositionById(id)
      }
      groupDragStartMouse.current = { x: clientX, y: clientY }
      setGroupDragOffset({ dx: 0, dy: 0 })
    } else {
      dragOriginRef.current = { [appId]: getIconPositionById(appId) }
      setGroupDragOffset(null)
    }
  }

  // 收起：从桌面移除图标（程序仍保留在资源库，可再次拖回）
  function handleIconRemove(app) {
    setSelectedAppIds(prev => prev.filter(id => id !== app.id))
    const next = { ...desktopIcons }
    delete next[app.id]
    saveDesktopIcons(next)
  }

  // 从资源库拖入：添加程序到桌面（已存在则不重复添加）
  function handleDesktopDrop(e) {
    // 支持两种数据格式：自定义 MIME 类型 + text/plain 前缀标记（兼容 Chromium 类型规范化）
    let appId = e.dataTransfer?.getData('application/x-app-id')
    if (!appId) {
      const plain = e.dataTransfer?.getData('text/plain') || ''
      if (plain.startsWith('library-app:')) appId = plain.slice('library-app:'.length)
    }
    if (!appId) return
    e.preventDefault()
    if (desktopIcons[appId]) return // 已在桌面，不重复添加
    const rect = desktopRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    let col = Math.max(0, Math.min(gridCols - 1, Math.floor(x / GRID_CELL)))
    let row = Math.max(0, Math.floor(y / GRID_CELL))
    // 避免重叠：如果目标格被占用，找最近空格
    const occ = getOccupiedCells()
    if (occ[`${col},${row}`]) {
      let bestCol = col, bestRow = row, bestDist = Infinity
      for (let r = 0; r < 20; r++) {
        for (let c = 0; c < gridCols; c++) {
          if (!occ[`${c},${r}`]) {
            const dist = Math.abs(c - col) + Math.abs(r - row)
            if (dist < bestDist) { bestDist = dist; bestCol = c; bestRow = r }
          }
        }
      }
      col = bestCol; row = bestRow
    }
    const next = { ...desktopIcons, [appId]: { col, row } }
    saveDesktopIcons(next)
  }

  function handleIconDragMove(appId, clientX, clientY) {
    if (groupDragOffset !== null && selectedAppIds.includes(appId)) {
      const dx = clientX - groupDragStartMouse.current.x
      const dy = clientY - groupDragStartMouse.current.y
      setGroupDragOffset({ dx, dy })
    }
  }

  function getIconPositionById(appId) {
    const app = APPS.find(a => a.id === appId)
    const idx = APPS.indexOf(app)
    return getIconPosition(app, idx >= 0 ? idx : 0)
  }

  // 位置：只在 desktopIcons 中存在时返回（无则返回 null，不显示在桌面）
  function getIconPosition(app, index) {
    if (!desktopIcons[app.id]) return null
    return desktopIcons[app.id] || { col: index % gridCols, row: Math.floor(index / gridCols) }
  }

  // ── 框选处理 ──
  const handleDesktopMouseDown = useCallback((e) => {
    // DesktopIcon 已 stopPropagation，到这里的一定是桌面空白处
    if (e.button !== 0) return
    selStart.current = { x: e.clientX, y: e.clientY }
    const box = { startX: e.clientX, startY: e.clientY, endX: e.clientX, endY: e.clientY }
    selBoxRef.current = box
    setSelBox(box)
    setSelecting(true)
  }, [])

  useEffect(() => {
    if (!selecting) return
    const handleMove = (e) => {
      const box = {
        startX: selStart.current.x,
        startY: selStart.current.y,
        endX: e.clientX,
        endY: e.clientY,
      }
      selBoxRef.current = box
      setSelBox(box)
    }
    const handleUp = () => {
      setSelecting(false)
      setSelBox(null)
      const prev = selBoxRef.current
      selBoxRef.current = null
      if (!prev) return
      const x1 = Math.min(prev.startX, prev.endX)
      const y1 = Math.min(prev.startY, prev.endY)
      const x2 = Math.max(prev.startX, prev.endX)
      const y2 = Math.max(prev.startY, prev.endY)
      const w = x2 - x1
      const h = y2 - y1
      if (w < 10 && h < 10) {
        setSelectedAppIds([])
        return
      }
      const desktopRect = desktopRef.current?.getBoundingClientRect()
      if (!desktopRect) return
      const ids = APPS
        .filter(app => desktopIcons[app.id])
        .filter(app => {
          const pos = getIconPosition(app, 0)
          if (!pos) return false
          const col = pos.col
          const row = pos.row
          const ix = desktopRect.left + col * GRID_CELL + (GRID_CELL - 80) / 2
          const iy = desktopRect.top + row * GRID_CELL + 8
          const ir = ix + 80
          const ib = iy + 80
          return ix < x2 && ir > x1 && iy < y2 && ib > y1
        })
        .map(app => app.id)
      setSelectedAppIds(ids.length > 0 ? ids : [])
    }
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [selecting, setSelectedAppIds])

  // 当前已占用的格子（仅桌面上的程序）
  function getOccupiedCells() {
    const occ = {}
    for (const [id, pos] of Object.entries(desktopIcons)) {
      occ[`${pos.col},${pos.row}`] = id
    }
    return occ
  }

  return (
    <div className="h-full flex flex-col overflow-hidden select-none relative">
      {wallpaper && (
        <>
          <img src={wallpaper} alt="" className="absolute inset-0 w-full h-full object-cover pointer-events-none" />
          <div className="absolute inset-0 bg-black/40 pointer-events-none" />
        </>
      )}
      <div ref={desktopRef} className="flex-1 relative overflow-hidden" onMouseDown={handleDesktopMouseDown}
        onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }}
        onDrop={handleDesktopDrop}>
        <div className="absolute inset-0 p-1 desktop-bg-area">
          {APPS.filter(app => desktopIcons[app.id]).map((app, i) => (
            <DesktopIcon key={app.id} app={app} position={getIconPosition(app, i)}
              onClick={launchApp} onDragEnd={handleIconDragEnd} onDragStart={handleIconDragStart} onDragMove={handleIconDragMove}
              gridRef={desktopRef} settled={settled} gridCols={gridCols}
              isSelected={selectedAppIds.includes(app.id)} groupDragOffset={groupDragOffset}
              onRemove={handleIconRemove} />
          ))}
        </div>
        {/* 选择框 */}
        {selBox && (
          <div
            className="absolute pointer-events-none border border-blue-400/60 bg-blue-500/10"
            style={{
              left: Math.min(selBox.startX, selBox.endX) - (desktopRef.current?.getBoundingClientRect().left || 0),
              top: Math.min(selBox.startY, selBox.endY) - (desktopRef.current?.getBoundingClientRect().top || 0),
              width: Math.abs(selBox.endX - selBox.startX),
              height: Math.abs(selBox.endY - selBox.startY),
            }}
          />
        )}
      </div>
    </div>
  )
}

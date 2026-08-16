import { useState, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useTerminal } from '../context/TerminalContext'
import { useDb } from '../context/DbContext'
import AppLibrary from './AppLibrary'
import { APPS, SYS_TOOLS, matchShortcut } from './appRegistry'
import { Play, X } from 'lucide-react'

/**
 * 底部 Dock 菜单栏
 */
export default function TerminalDock({ visible }) {
  const { runningApps, toggleApp, closeApp, hasRunningNonSystem, summonApp, updateAppState } = useTerminal()
  const { devMode } = useDb()
  const location = useLocation()
  const [hovered, setHovered] = useState(null)
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const stored = localStorage.getItem('sidebar_collapsed')
    return stored === '1' ? 56 : 224
  })
  const [contextMenu, setContextMenu] = useState(null)
  const menuJustOpened = useRef(false)
  const dockRef = useRef(null)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [libraryShortcut, setLibraryShortcut] = useState('ctrl+tab')

  const isOnTerminal = location.pathname === '/terminal'
  const dockItems = [...SYS_TOOLS, ...runningApps.filter(a => !a.system)]

  // ── 所有 hooks 必须在此处、条件返回之前 ──

  // 追踪侧栏宽度
  useEffect(() => {
    const updateWidth = () => {
      const stored = localStorage.getItem('sidebar_collapsed')
      setSidebarWidth(stored === '1' ? 56 : 224)
    }
    window.addEventListener('sidebar-toggled', updateWidth)
    return () => window.removeEventListener('sidebar-toggled', updateWidth)
  }, [])

  // 加载资源库快捷键配置（user.json）
  useEffect(() => {
    (async () => {
      try {
        const res = await window.electronAPI?.getUserConfig()
        if (res?.config?.libraryShortcut) setLibraryShortcut(res.config.libraryShortcut)
      } catch (_) {}
    })()
  }, [])

  // 清理历史遗留的 library 窗口（资源库是系统工具，不应作为窗口存在）
  useEffect(() => {
    const existing = runningApps.find(a => a.id === 'library')
    if (existing) closeApp('library')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 全局快捷键唤起资源库
  useEffect(() => {
    const handler = (e) => {
      if (matchShortcut(e, libraryShortcut)) {
        e.preventDefault()
        setLibraryOpen(prev => !prev)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [libraryShortcut])

  // 快捷键配置变化时同步（自定义面板修改后，事件直接携带新值，避免防抖写入未完成读到旧值）
  useEffect(() => {
    const handler = (e) => {
      if (e.detail) setLibraryShortcut(e.detail)
    }
    window.addEventListener('library-shortcut-changed', handler)
    return () => window.removeEventListener('library-shortcut-changed', handler)
  }, [])

  // 关闭右键菜单（仅监听 click，延迟添加避免打开立即关闭）
  useEffect(() => {
    if (!contextMenu) return
    menuJustOpened.current = true
    const timer = setTimeout(() => { menuJustOpened.current = false }, 0)
    const close = (e) => {
      if (menuJustOpened.current) return
      setContextMenu(null)
    }
    window.addEventListener('click', close)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('click', close)
    }
  }, [contextMenu])

  // 仅当有全屏窗口且未隐藏、在当前页面可见时才隐藏 dock
  const anyFullscreenVisible = runningApps.some(a => {
    if (!a.state?.fullscreen || a.state?.hidden) return false
    const page = a.state?.showOnPage || '/terminal'
    return page === '*' || page === location.pathname
  })
  if (!libraryOpen && !visible && !isOnTerminal && !hasRunningNonSystem && runningApps.length === 0) return null
  if (!libraryOpen && anyFullscreenVisible) return null

  // ── 事件处理 ──

  // 该程序是否正显示在当前板块（可见状态）
  function isVisibleOnCurrentPage(app) {
    const existing = runningApps.find(a => a.id === app.id)
    if (!existing || existing.state?.hidden) return false
    const page = existing.state?.showOnPage || '/terminal'
    return page === '*' || page === location.pathname
  }

  function handleClick(app) {
    setContextMenu(null)
    if (app.id === 'library') {
      // 资源库：切换展开小窗
      setLibraryOpen(prev => !prev)
      return
    }
    // 点击其他程序/工具：先关闭资源库面板（在 click 完成后再卸载 Dock，避免事件丢失）
    setLibraryOpen(false)
    if (app.system) {
      // 系统工具：如果已在当前页面可见则隐藏，否则召唤到当前页面
      if (isVisibleOnCurrentPage(app)) {
        toggleApp(app)  // 隐藏
      } else {
        summonApp(app, location.pathname)  // 召唤到当前页面
      }
      return
    }
    // 普通程序：当前板块可见 → 隐藏（带吸入动画）；不可见 → 召唤到当前板块并显示
    if (isVisibleOnCurrentPage(app)) {
      updateAppState(app.id, { hidden: true })
    } else {
      summonApp(app, location.pathname)
    }
  }

  // 资源库：点击程序 → 打开并收起小窗
  function handleLibraryOpen(app) {
    setLibraryOpen(false)
    summonApp(app, location.pathname)
  }

  function handleContextMenu(e, app) {
    e.preventDefault()
    e.stopPropagation()
    const existing = runningApps.find(a => a.id === app.id)
    setLibraryOpen(false) // 右键时关闭资源库面板
    setContextMenu({ x: e.clientX, y: e.clientY, app, isRunning: !!existing })
  }

  function handleOpenApp(app) {
    setContextMenu(null)
    // 资源库不能作为窗口打开，改为展开资源库面板
    if (app.id === 'library') {
      setLibraryOpen(true)
      return
    }
    summonApp(app, location.pathname)
  }

  function handleCloseApp(app) {
    setContextMenu(null)
    closeApp(app.id)
  }

  return (
    <>
      <div className="fixed bottom-0 z-[999] pointer-events-none"
        style={{
          left: `${sidebarWidth}px`,
          right: '0px',
          marginBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        <div ref={dockRef} className="pointer-events-auto flex items-end gap-1.5 px-4 py-2 rounded-2xl mx-auto w-fit
          bg-surface-800/60 backdrop-blur-xl border border-white/10 shadow-2xl
          animate-fade-in"
          style={{ marginBottom: devMode ? 'calc(40px + 12px)' : '12px' }}
        >
          {dockItems.map(app => {
            const AppIcon = app.icon
            const isHovered = hovered === app.id
            const running = runningApps.find(a => a.id === app.id)
            // 资源库面板打开时图标亮起（视为运行中）
            const isRunning = app.id === 'library' ? libraryOpen : (running && !running.state?.hidden)
            const showDot = app.id === 'library' ? libraryOpen : !!running
            return (
              <div
                key={app.id}
                className="relative flex flex-col items-center"
                onMouseEnter={() => setHovered(app.id)}
                onMouseLeave={() => setHovered(null)}
              >
                {isHovered && (
                  <div className="absolute -top-8 px-2.5 py-1 rounded-lg bg-surface-950/90 border border-white/10 text-[11px] text-white whitespace-nowrap shadow-lg">
                    {app.name}
                  </div>
                )}
                <button
                  onClick={() => handleClick(app)}
                  onContextMenu={(e) => handleContextMenu(e, app)}
                  data-app-id={app.id}
                  className={`terminal-dock-icon w-12 h-12 rounded-2xl flex items-center justify-center transition-all duration-150
                    ${isHovered ? 'scale-125 -translate-y-2' : ''}
                    ${isRunning ? `bg-gradient-to-br ${app.color || 'from-white/15 to-white/10'} border border-white/20` : 'bg-white/5 border border-white/10'}
                    hover:bg-white/20 hover:shadow-lg`}
                  title={app.name}
                >
                  <AppIcon className={`w-6 h-6 ${app.iconClass || (isRunning ? 'text-white/90' : 'text-white/60')}`} />
                </button>
                {showDot && (
                  <div className={`w-1 h-1 rounded-full mt-1 ${running?.state?.hidden ? 'bg-white/20' : 'bg-white/60'}`} />
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* 资源库面板（从 Dock 图标位置展开） */}
      {libraryOpen && (
        <AppLibrary
          onClose={() => setLibraryOpen(false)}
          onOpenApp={handleLibraryOpen}
          dockBottom={devMode ? 40 + 76 : 76}
        />
      )}

      {/* 右键菜单 */}
      {contextMenu && (
        <div
          className="fixed z-[999] w-36 py-1 rounded-xl bg-surface-900/95 backdrop-blur-xl border border-white/10 shadow-2xl animate-scale-in"
          style={{ left: Math.min(contextMenu.x, window.innerWidth - 160), top: Math.min(contextMenu.y, window.innerHeight - 120) }}
          onClick={e => e.stopPropagation()}
        >
          {!contextMenu.isRunning ? (
            <button
              onClick={() => handleOpenApp(contextMenu.app)}
              className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-surface-200 hover:bg-white/10 transition-colors"
            >
              <Play className="w-3.5 h-3.5 text-surface-400" />
              打开
            </button>
          ) : (
            <button
              onClick={() => handleCloseApp(contextMenu.app)}
              className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              关闭
            </button>
          )}
        </div>
      )}
    </>
  )
}

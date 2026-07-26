import { useState, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useTerminal } from '../context/TerminalContext'
import { useDb } from '../context/DbContext'
import {
  Calculator, FileText, FolderOpen, Settings2, Play, X, Swords, Globe, Images, BarChart3, Landmark, Star, Compass, Hourglass
} from 'lucide-react'

/** 应用程序注册表 — 终端板块的权威定义 */
export const APPS = [
  { id: 'traincalc', name: '养成计算器', icon: Calculator, placeholder: false, color: 'from-gray-700 to-orange-400', iconClass: 'text-white drop-shadow-md' },
  { id: 'betamemo', name: 'Beta备忘录', icon: FileText, placeholder: false, color: 'from-white to-gray-100', iconClass: 'text-yellow-500 drop-shadow-sm' },
  { id: 'dragonsnake', name: '非完备证明', icon: Swords, placeholder: false, color: 'from-emerald-700 to-teal-400', iconClass: 'text-white drop-shadow-md' },
  { id: 'worldtree', name: '世界树', icon: Globe, placeholder: false, color: 'from-green-600 to-emerald-400', iconClass: 'text-white drop-shadow-sm' },
  { id: 'album', name: '切片辖域·鸽', icon: Images, placeholder: false, color: 'from-pink-500 to-rose-600', iconClass: 'text-white drop-shadow-md' },
  { id: 'ratefetcher', name: 'RateFetcher', icon: BarChart3, placeholder: false, color: 'from-cyan-700 to-blue-400', iconClass: 'text-white drop-shadow-md' },
  { id: 'northlandbank', name: '北国银行', icon: Landmark, placeholder: false, color: 'from-amber-700 to-yellow-500', iconClass: 'text-white drop-shadow-md' },
  { id: 'gachastation', name: '祈愿捕捉站', icon: Star, placeholder: false, color: 'from-blue-600 to-cyan-400', iconClass: 'text-white drop-shadow-md' },
  { id: 'memoryhub', name: '摹忆中枢', icon: Compass, placeholder: false, color: 'from-amber-500 to-yellow-400', iconClass: 'text-white drop-shadow-md' },
  { id: 'hourglass', name: '时之沙', icon: Hourglass, placeholder: false, color: 'from-indigo-600 to-violet-500', iconClass: 'text-white drop-shadow-md' },
]

export const SYS_TOOLS = [
  { id: 'resources', name: '资源', icon: FolderOpen, system: true, color: 'from-blue-500 to-sky-300', iconClass: 'text-white drop-shadow-md' },
  { id: 'customize', name: '自定义', icon: Settings2, system: true, color: 'from-purple-500 to-pink-400', iconClass: 'text-white drop-shadow-md' },
]

/**
 * 底部 Dock 菜单栏
 */
export default function TerminalDock({ visible }) {
  const { runningApps, toggleApp, closeApp, hasRunningNonSystem, summonApp } = useTerminal()
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
  if (!visible && !isOnTerminal && !hasRunningNonSystem && runningApps.length === 0) return null
  if (anyFullscreenVisible) return null

  // ── 事件处理 ──

  function handleClick(app) {
    setContextMenu(null)
    if (app.system) {
      // 系统工具：如果已在当前页面可见则隐藏，否则召唤到当前页面
      const existing = runningApps.find(a => a.id === app.id)
      if (existing && !existing.state?.hidden && (existing.state?.showOnPage === '*' || existing.state?.showOnPage === location.pathname)) {
        toggleApp(app)  // 隐藏
      } else {
        summonApp(app, location.pathname)  // 召唤到当前页面
      }
      return
    }
    summonApp(app, location.pathname)
  }

  function handleContextMenu(e, app) {
    e.preventDefault()
    e.stopPropagation()
    const existing = runningApps.find(a => a.id === app.id)
    setContextMenu({ x: e.clientX, y: e.clientY, app, isRunning: !!existing })
  }

  function handleOpenApp(app) {
    setContextMenu(null)
    summonApp(app, location.pathname)
  }

  function handleCloseApp(app) {
    setContextMenu(null)
    closeApp(app.id)
  }

  return (
    <>
      <div className="fixed bottom-0 z-[200] pointer-events-none"
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
            const isRunning = running && !running.state?.hidden
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
                  className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all duration-150
                    ${isHovered ? 'scale-125 -translate-y-2' : ''}
                    ${isRunning ? `bg-gradient-to-br ${app.color || 'from-white/15 to-white/10'} border border-white/20` : 'bg-white/5 border border-white/10'}
                    hover:bg-white/20 hover:shadow-lg`}
                  title={app.name}
                >
                  <AppIcon className={`w-6 h-6 ${app.iconClass || (isRunning ? 'text-white/90' : 'text-white/60')}`} />
                </button>
                {running && (
                  <div className={`w-1 h-1 rounded-full mt-1 ${running.state?.hidden ? 'bg-white/20' : 'bg-white/60'}`} />
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* 右键菜单 */}
      {contextMenu && (
        <div
          className="fixed z-[200] w-36 py-1 rounded-xl bg-surface-900/95 backdrop-blur-xl border border-white/10 shadow-2xl animate-scale-in"
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

import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useTerminal } from '../context/TerminalContext'
import { useDb } from '../context/DbContext'
import {
  Calculator, FileText, FolderOpen, Palette
} from 'lucide-react'

/** 应用程序注册表 — 终端板块的权威定义 */
export const APPS = [
  { id: 'traincalc', name: '养成计算器', icon: Calculator, placeholder: true },
  { id: 'betamemo', name: 'Beta备忘录', icon: FileText, placeholder: true },
]

export const SYS_TOOLS = [
  { id: 'resources', name: '资源', icon: FolderOpen, system: true },
  { id: 'customize', name: '自定义', icon: Palette, system: true },
]

/**
 * 底部 Dock 菜单栏 — 可在 App 级别或 TerminalPage 内使用
 */
export default function TerminalDock({ visible }) {
  const { runningApps, toggleApp, hasRunningNonSystem } = useTerminal()
  const { devMode } = useDb()
  const navigate = useNavigate()
  const location = useLocation()
  const [hovered, setHovered] = useState(null)

  const isOnTerminal = location.pathname === '/terminal'
  const dockItems = [...SYS_TOOLS, ...runningApps.filter(a => !a.system)]

  // 可见性：在终端页始终可见；其他页面仅当有非系统应用运行时可见
  if (!visible && !isOnTerminal && !hasRunningNonSystem && runningApps.length === 0) return null

  function handleClick(app) {
    if (!isOnTerminal) {
      // 不在终端页 → 先跳转到终端
      navigate('/terminal')
      // 短暂延迟后在终端页内打开
      setTimeout(() => toggleApp(app), 100)
      return
    }
    toggleApp(app)
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[100] flex justify-center pointer-events-none"
      style={{ marginBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="pointer-events-auto flex items-end gap-1.5 px-4 py-2 rounded-2xl
        bg-surface-800/60 backdrop-blur-xl border border-white/10 shadow-2xl
        animate-fade-in"
        style={{ marginBottom: devMode ? 'calc(40px + 12px)' : '12px' }}
      >
        {dockItems.map(app => {
          const AppIcon = app.icon
          const isHovered = hovered === app.id
          const isRunning = runningApps.find(a => a.id === app.id && !a.state?.hidden)
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
                className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all duration-150
                  ${isHovered ? 'scale-125 -translate-y-2' : ''}
                  ${isRunning ? 'bg-white/15 border border-white/20' : 'bg-white/5 border border-white/10'}
                  hover:bg-white/20 hover:shadow-lg`}
                title={app.name}
              >
                <AppIcon className={`w-6 h-6 ${isRunning ? 'text-white/90' : 'text-white/60'}`} />
              </button>
              {runningApps.find(a => a.id === app.id) && (
                <div className={`w-1 h-1 rounded-full mt-1 ${runningApps.find(a => a.id === app.id)?.state?.hidden ? 'bg-white/20' : 'bg-white/60'}`} />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

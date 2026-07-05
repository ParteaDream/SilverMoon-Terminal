import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { Calculator, FileText, FolderOpen, Settings2, Swords } from 'lucide-react'

const TerminalContext = createContext(null)

// 应用图标注册表（用于恢复序列化后的数据）
const APP_REGISTRY = {
  traincalc: { icon: Calculator, color: 'from-gray-700 to-orange-400', iconClass: 'text-white drop-shadow-md' },
  betamemo: { icon: FileText, color: 'from-white to-gray-100', iconClass: 'text-yellow-500 drop-shadow-sm' },
  dragonsnake: { icon: Swords, color: 'from-emerald-700 to-teal-400', iconClass: 'text-white drop-shadow-md' },
  resources: { icon: FolderOpen, color: 'from-blue-500 to-sky-300', iconClass: 'text-white drop-shadow-md' },
  customize: { icon: Settings2, color: 'from-purple-500 to-pink-400', iconClass: 'text-white drop-shadow-md' },
}

function getDefaultPosition(index, appId) {
  const collapsed = localStorage.getItem('sidebar_collapsed') === '1'
  const sidebarW = collapsed ? 56 : 224
  const isCalc = appId === 'traincalc'
  const isMemo = appId === 'betamemo'
  const isSnake = appId === 'dragonsnake'
  const isCustomize = appId === 'customize'
  return {
    left: sidebarW + 30 + index * 30,
    top: 50 + index * 30,
    width: isCalc ? 460 : isMemo ? 900 : isSnake ? 520 : isCustomize ? 560 : 600,
    height: isCalc ? 640 : isMemo ? 680 : isSnake ? 660 : isCustomize ? 520 : 420,
  }
}

export function TerminalProvider({ children }) {
  const [runningApps, setRunningApps] = useState([])
  const [nextZ, setNextZ] = useState(100)

  // 启动时清除上次遗留的状态
  useEffect(() => {
    localStorage.removeItem('terminal_running_apps')
  }, [])

  const updateAppState = useCallback((appId, partial) => {
    setRunningApps(prev => prev.map(a =>
      a.id === appId ? { ...a, state: { ...a.state, ...partial } } : a
    ))
  }, [])

  const bringToFront = useCallback((appId) => {
    setNextZ(z => {
      const nz = z + 1
      setRunningApps(prev => prev.map(a =>
        a.id === appId ? { ...a, state: { ...a.state, zIndex: nz } } : a
      ))
      return nz
    })
  }, [])

  // 桌面启动 — 绑定到终端板块
  const launchApp = useCallback((app, extraData) => {
    setRunningApps(prev => {
      const existing = prev.find(a => a.id === app.id)
      if (existing) {
        return prev.map(a => a.id === app.id
          ? { ...a, state: { ...a.state, hidden: false, showOnPage: '/terminal' }, data: extraData || a.data }
          : a
        )
      }
      const pos = getDefaultPosition(prev.length, app.id)
      const newApp = {
        ...app,
        data: extraData || null,
        state: {
          ...pos,
          hidden: false, fullscreen: false,
          zIndex: 100 + prev.length + 1,
          showOnPage: '/terminal',
        }
      }
      return [...prev, newApp]
    })
    setNextZ(z => {
      const nz = z + 1
      setRunningApps(prev => prev.map(a =>
        a.id === app.id ? { ...a, state: { ...a.state, zIndex: nz } } : a
      ))
      return nz
    })
  }, [])

  const closeApp = useCallback((appId) => {
    setRunningApps(prev => prev.filter(a => a.id !== appId))
  }, [])

  // Dock 召唤 — 将应用带到当前板块
  const summonApp = useCallback((app, page) => {
    const targetPage = page || '/terminal'
    setRunningApps(prev => {
      const existing = prev.find(a => a.id === app.id)
      if (existing) {
        return prev.map(a => a.id === app.id
          ? { ...a, state: { ...a.state, hidden: false, showOnPage: targetPage } }
          : a
        )
      }
      const pos = getDefaultPosition(prev.length, app.id)
      const newApp = {
        ...app,
        state: {
          ...pos,
          hidden: false, fullscreen: false,
          zIndex: 100 + prev.length + 1,
          showOnPage: targetPage,
        }
      }
      return [...prev, newApp]
    })
    setNextZ(z => {
      const nz = z + 1
      setRunningApps(prev => prev.map(a =>
        a.id === app.id ? { ...a, state: { ...a.state, zIndex: nz } } : a
      ))
      return nz
    })
  }, [])

  // 系统工具切换
  const toggleApp = useCallback((app) => {
    setRunningApps(prev => {
      const existing = prev.find(a => a.id === app.id)
      if (existing) {
        if (existing.state?.hidden) {
          return prev.map(a => a.id === app.id
            ? { ...a, state: { ...a.state, hidden: false, showOnPage: '/terminal' } }
            : a
          )
        } else {
          return prev.map(a => a.id === app.id
            ? { ...a, state: { ...a.state, hidden: true } }
            : a
          )
        }
      }
      const pos = getDefaultPosition(prev.length, app.id)
      const newApp = {
        ...app,
        state: {
          ...pos,
          hidden: false, fullscreen: false,
          zIndex: 100 + prev.length + 1,
          showOnPage: '/terminal',
        }
      }
      return [...prev, newApp]
    })
    setNextZ(z => {
      const nz = z + 1
      setRunningApps(prev => prev.map(a =>
        a.id === app.id ? { ...a, state: { ...a.state, zIndex: nz } } : a
      ))
      return nz
    })
  }, [])

  const hasRunningNonSystem = runningApps.some(a => !a.system)

  // 从外部页面启动养成计算器并预选角色
  const launchTrainCalc = useCallback((charId, pagePath) => {
    const app = { id: 'traincalc', name: '养成计算器', icon: Calculator, placeholder: false, color: 'from-gray-700 to-orange-400', iconClass: 'text-white drop-shadow-md' }
    setRunningApps(prev => {
      const existing = prev.find(a => a.id === 'traincalc')
      if (existing) {
        return prev.map(a => a.id === 'traincalc'
          ? { ...a, data: { characterId: charId }, state: { ...a.state, hidden: false, showOnPage: pagePath } }
          : a
        )
      }
      const pos = getDefaultPosition(prev.length, app.id)
      pos.width = 460; pos.height = 640 // 养成计算器窄高窗口
      return [...prev, { ...app, data: { characterId: charId }, state: { ...pos, hidden: false, fullscreen: false, zIndex: 100 + prev.length + 1, showOnPage: pagePath } }]
    })
    setNextZ(z => { const nz = z + 1; setRunningApps(prev => prev.map(a => a.id === 'traincalc' ? { ...a, state: { ...a.state, zIndex: nz } } : a)); return nz })
  }, [])

  return (
    <TerminalContext.Provider value={{
      runningApps,
      launchApp, closeApp, updateAppState,
      toggleApp, summonApp, bringToFront, launchTrainCalc,
      hasRunningNonSystem,
    }}>
      {children}
    </TerminalContext.Provider>
  )
}

export function useTerminal() {
  const ctx = useContext(TerminalContext)
  if (!ctx) throw new Error('useTerminal must be used within TerminalProvider')
  return ctx
}

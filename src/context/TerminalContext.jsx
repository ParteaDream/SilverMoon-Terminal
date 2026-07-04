import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { Calculator } from 'lucide-react'

const TerminalContext = createContext(null)

function getDefaultPosition(index) {
  const collapsed = localStorage.getItem('sidebar_collapsed') === '1'
  const sidebarW = collapsed ? 56 : 224
  return {
    left: sidebarW + 30 + index * 30,
    top: 50 + index * 30,
    width: 600,
    height: 420,
  }
}

export function TerminalProvider({ children }) {
  const [runningApps, setRunningApps] = useState(() => {
    try {
      const saved = localStorage.getItem('terminal_running_apps')
      if (saved) {
        const parsed = JSON.parse(saved)
        return parsed.map(a => ({ ...a, state: { ...a.state, hidden: true } }))
      }
    } catch (_) {}
    return []
  })
  const [nextZ, setNextZ] = useState(100)

  // 持久化运行状态
  useEffect(() => {
    try { localStorage.setItem('terminal_running_apps', JSON.stringify(runningApps)) } catch (_) {}
  }, [runningApps])

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
      const pos = getDefaultPosition(prev.length)
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

  // Dock 召唤 — 转移到指定板块
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
      const pos = getDefaultPosition(prev.length)
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
            ? { ...a, state: { ...a.state, hidden: false, showOnPage: '*' } }
            : a
          )
        } else {
          return prev.map(a => a.id === app.id
            ? { ...a, state: { ...a.state, hidden: true } }
            : a
          )
        }
      }
      const pos = getDefaultPosition(prev.length)
      const newApp = {
        ...app,
        state: {
          ...pos,
          hidden: false, fullscreen: false,
          zIndex: 100 + prev.length + 1,
          showOnPage: '*',
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
      const pos = getDefaultPosition(prev.length)
      pos.width = 460; pos.height = 560 // 养成计算器窄高窗口
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

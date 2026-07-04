import { createContext, useContext, useState, useCallback } from 'react'

const TerminalContext = createContext(null)

/** 应用程序注册表（与 TerminalPage 共享） */
export const APPS = [
  { id: 'traincalc', name: '养成计算器', icon: null, placeholder: true },
  { id: 'betamemo', name: 'Beta备忘录', icon: null, placeholder: true },
]

export const SYS_TOOLS = [
  { id: 'resources', name: '资源', icon: null, system: true },
  { id: 'customize', name: '自定义', icon: null, system: true },
]

// 图标组件在 TerminalPage 中定义，这里留 null 占位，实际使用时替换
export function injectAppIcons(icons) {
  APPS.forEach((a, i) => { if (icons[i]) a.icon = icons[i] })
  SYS_TOOLS.forEach((t, i) => { if (icons[i + APPS.length]) t.icon = icons[i + APPS.length] })
}

export function TerminalProvider({ children }) {
  const [runningApps, setRunningApps] = useState([])
  const [nextZ, setNextZ] = useState(100)

  const updateAppState = useCallback((appId, partial) => {
    setRunningApps(prev => prev.map(a =>
      a.id === appId ? { ...a, state: { ...a.state, ...partial } } : a
    ))
  }, [])

  const launchApp = useCallback((app) => {
    let launched = false
    setRunningApps(prev => {
      const existing = prev.find(a => a.id === app.id)
      if (existing) {
        launched = true
        // 如果已运行且隐藏，重新显示
        if (existing.state?.hidden) {
          return prev.map(a => a.id === app.id
            ? { ...a, state: { ...a.state, hidden: false } }
            : a
          )
        }
        return prev
      }
      launched = true
      const newApp = {
        ...app,
        state: {
          left: 80 + prev.length * 30,
          top: 60 + prev.length * 30,
          width: 600,
          height: 420,
          hidden: false,
          fullscreen: false,
          zIndex: 100 + prev.length + 1,
        }
      }
      setNextZ(100 + prev.length + 2)
      return [...prev, newApp]
    })
    if (!launched) return
    // 提升 z-index
    setNextZ(z => {
      const nz = z + 1
      updateAppState(app.id, { zIndex: nz })
      return nz
    })
  }, [updateAppState])

  const closeApp = useCallback((appId) => {
    setRunningApps(prev => prev.filter(a => a.id !== appId))
  }, [])

  const toggleApp = useCallback((app) => {
    setRunningApps(prev => {
      const existing = prev.find(a => a.id === app.id)
      if (existing) {
        if (existing.state?.hidden) {
          return prev.map(a => a.id === app.id
            ? { ...a, state: { ...a.state, hidden: false } }
            : a
          )
        } else {
          return prev.map(a => a.id === app.id
            ? { ...a, state: { ...a.state, hidden: true } }
            : a
          )
        }
      }
      // 未在运行 → 启动新应用
      const newApp = {
        ...app,
        state: {
          left: 80 + prev.length * 30,
          top: 60 + prev.length * 30,
          width: 600,
          height: 420,
          hidden: false,
          fullscreen: false,
          zIndex: 100 + prev.length + 1,
        }
      }
      setNextZ(100 + prev.length + 2)
      return [...prev, newApp]
    })
    // 如果是重新显示，提升 z-index
    setNextZ(z => {
      const nz = z + 1
      updateAppState(app.id, { zIndex: nz })
      return nz
    })
  }, [updateAppState])

  const hasRunningNonSystem = runningApps.some(a => !a.system)

  return (
    <TerminalContext.Provider value={{
      runningApps,
      launchApp,
      closeApp,
      updateAppState,
      toggleApp,
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

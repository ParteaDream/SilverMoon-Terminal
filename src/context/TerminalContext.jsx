import { createContext, useContext, useState, useCallback } from 'react'

const TerminalContext = createContext(null)

export function TerminalProvider({ children }) {
  const [runningApps, setRunningApps] = useState([])
  const [nextZ, setNextZ] = useState(100)

  const updateAppState = useCallback((appId, partial) => {
    setRunningApps(prev => prev.map(a =>
      a.id === appId ? { ...a, state: { ...a.state, ...partial } } : a
    ))
  }, [])

  // 提升窗口到最前
  const bringToFront = useCallback((appId) => {
    setNextZ(z => {
      const nz = z + 1
      setRunningApps(prev => prev.map(a =>
        a.id === appId ? { ...a, state: { ...a.state, zIndex: nz } } : a
      ))
      return nz
    })
  }, [])

  // 启动应用（桌面双击/单击用）
  const launchApp = useCallback((app) => {
    let isNew = true
    setRunningApps(prev => {
      const existing = prev.find(a => a.id === app.id)
      if (existing) {
        isNew = false
        if (existing.state?.hidden) {
          return prev.map(a => a.id === app.id
            ? { ...a, state: { ...a.state, hidden: false } }
            : a
          )
        }
        return prev
      }
      const z = 100 + prev.length + 1
      const newApp = {
        ...app,
        state: {
          left: 80 + prev.length * 30,
          top: 60 + prev.length * 30,
          width: 600,
          height: 420,
          hidden: false,
          fullscreen: false,
          zIndex: z,
        }
      }
      return [...prev, newApp]
    })
    // 提升 z-index
    setNextZ(z => {
      const nz = z + 1
      setRunningApps(prev => prev.map(a =>
        a.id === app.id ? { ...a, state: { ...a.state, zIndex: nz } } : a
      ))
      return nz
    })
  }, [])

  // 启动或显示（不隐藏）- 用于跨板块和 dock 点击
  const launchOrShow = useCallback((app) => {
    let isNew = true
    setRunningApps(prev => {
      const existing = prev.find(a => a.id === app.id)
      if (existing) {
        isNew = false
        return prev.map(a => a.id === app.id
          ? { ...a, state: { ...a.state, hidden: false } }
          : a
        )
      }
      const z = 100 + prev.length + 1
      const newApp = {
        ...app,
        state: {
          left: 80 + prev.length * 30,
          top: 60 + prev.length * 30,
          width: 600,
          height: 420,
          hidden: false,
          fullscreen: false,
          zIndex: z,
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

  // toggle：系统工具切换显示/隐藏，用户应用切换显示/隐藏
  const toggleApp = useCallback((app) => {
    let isNew = true
    setRunningApps(prev => {
      const existing = prev.find(a => a.id === app.id)
      if (existing) {
        isNew = false
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
      const z = 100 + prev.length + 1
      const newApp = {
        ...app,
        state: {
          left: 80 + prev.length * 30,
          top: 60 + prev.length * 30,
          width: 600,
          height: 420,
          hidden: false,
          fullscreen: false,
          zIndex: z,
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

  return (
    <TerminalContext.Provider value={{
      runningApps,
      launchApp,
      closeApp,
      updateAppState,
      toggleApp,
      launchOrShow,
      bringToFront,
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

// ═════════════════════════════════════════════════════════════════
// useHideDock.js — 图片查看器挂载期间临时隐藏底部 Dock
//
// 计数式实现（TerminalContext.dockSuppressed），多个查看器叠层时
// 最后一个关闭才恢复；组件卸载自动释放。
// 不依赖 TerminalProvider：脱离终端环境时静默 no-op。
// ═════════════════════════════════════════════════════════════════
import { useEffect } from 'react'
import { useTerminalOptional } from '../context/TerminalContext'

export default function useHideDock() {
  const terminal = useTerminalOptional()
  const suppressDock = terminal?.suppressDock
  const releaseDock = terminal?.releaseDock

  useEffect(() => {
    if (!suppressDock || !releaseDock) return
    suppressDock()
    return () => releaseDock()
  }, [suppressDock, releaseDock])
}

import { useCallback } from 'react'

/**
 * 处理图片拖放 — 用 Electron 原生 startDrag 保留原始文件名
 * 用法: <img onDragStart={handleDrag(filename)} ... />
 */
export function useImageDrag(filename) {
  return useCallback((e) => {
    if (!filename || !window.electronAPI?.startImageDrag) return
    e.preventDefault()
    e.stopPropagation()
    window.electronAPI.startImageDrag(filename)
  }, [filename])
}

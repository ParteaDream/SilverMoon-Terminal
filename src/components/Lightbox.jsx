import { useState, useEffect, useCallback, useRef } from 'react'
import { X } from 'lucide-react'
import { useDb } from '../context/DbContext'
import { useImageDrag } from '../hooks/useImageDrag'
import { stripFormatting } from '../utils/colorMarkup'

/**
 * 图片灯箱：点击放大，滚轮缩放（0.5x ~ 3x），放大后可拖拽平移
 */
export default function Lightbox({ filename, label, onClose }) {
  const cleanLabel = stripFormatting(label)
  const [src, setSrc] = useState(null)
  const [scale, setScale] = useState(1)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const dragging = useRef(false)
  const dragStart = useRef({ x: 0, y: 0 })
  const posStart = useRef({ x: 0, y: 0 })
  const containerRef = useRef(null)
  const { readImage } = useDb()
  const handleDrag = useImageDrag(filename)

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (filename) {
        const data = await readImage(filename)
        if (!cancelled && data) setSrc(data)
      }
    }
    load()
    return () => { cancelled = true }
  }, [filename, readImage])

  // 切换图片时重置缩放和位置
  useEffect(() => {
    setScale(1)
    setPosition({ x: 0, y: 0 })
  }, [filename])

  const handleMouseDown = useCallback((e) => {
    if (scale <= 1) return
    e.preventDefault()
    dragging.current = true
    dragStart.current = { x: e.clientX, y: e.clientY }
    posStart.current = { ...position }
  }, [scale, position])

  const handleMouseMove = useCallback((e) => {
    if (!dragging.current) return
    const dx = e.clientX - dragStart.current.x
    const dy = e.clientY - dragStart.current.y
    setPosition({
      x: posStart.current.x + dx,
      y: posStart.current.y + dy,
    })
  }, [])

  const handleMouseUp = useCallback(() => {
    dragging.current = false
  }, [])

  // 全局 mouseup + Esc 关闭
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      window.removeEventListener('keydown', onKey)
    }
  }, [handleMouseMove, handleMouseUp, onClose])

  useEffect(() => {
    const el = containerRef.current
    if (!el || !src) return
    const onWheel = (e) => {
      e.stopPropagation()
      e.preventDefault()
      setScale(prev => Math.max(0.5, Math.min(3, prev + (e.deltaY > 0 ? -0.2 : 0.2))))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [src])

  if (!src) {
    return (
      <div className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-sm flex items-center justify-center" onClick={onClose}>
        <div className="w-10 h-10 rounded-full border-2 border-primary-500 border-t-transparent animate-spin" />
      </div>
    )
  }

  return (
    <>
      <div className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-sm flex items-center justify-center p-8 overflow-hidden"
        onClick={onClose}
        onContextMenu={(e) => { e.preventDefault(); onClose() }}
      >
        {/* 图片容器 */}
        <div
          ref={containerRef}
          className="max-w-full max-h-full flex items-center justify-center"
          onClick={e => e.stopPropagation()}
          onMouseDown={handleMouseDown}
        >
          <img
            src={src}
            alt={cleanLabel || ''}
            className={`max-w-[90vw] max-h-[85vh] object-contain rounded-lg shadow-2xl select-none ${scale > 1 ? 'cursor-grab' : ''}`}
            style={{
              transform: `scale(${scale}) translate(${position.x / scale}px, ${position.y / scale}px)`,
            }}
            draggable={scale <= 1}
            onDragStart={scale <= 1 ? handleDrag : undefined}
          />
        </div>

        {cleanLabel && <p className="absolute bottom-4 left-1/2 -translate-x-1/2 text-sm text-surface-300 pointer-events-none">{cleanLabel}</p>}
        <div className="absolute bottom-4 right-4 text-xs text-surface-500 bg-black/40 px-2 py-1 rounded">
          {Math.round(scale * 100)}%
        </div>
      </div>

      {/* 关闭按钮 —— 独立于背景层，避免点击区域被遮挡 */}
      <button
        onClick={onClose}
        className="fixed top-4 right-4 p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors z-[220]"
        aria-label="关闭"
      >
        <X className="w-5 h-5" />
      </button>
    </>
  )
}

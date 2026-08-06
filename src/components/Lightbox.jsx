import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X, Plus, Minus, Focus } from 'lucide-react'
import { useDb } from '../context/DbContext'
import { stripFormatting } from '../utils/colorMarkup'

/**
 * 图片灯箱：点击放大，滚轮缩放（0.5x ~ 3x），任意缩放级别下均可拖拽平移
 * read：可选的自定义图片读取函数（返回 data URL 或 null），默认读取数据库图片
 * portalTo：可选，小程序窗口根元素。传入时灯箱挂载到该窗口内并用 absolute 定位
 *          （相对窗口自动跟随移动/缩放，丝滑无轮询，且不遮挡窗口标题栏）；
 *          topOffset 为标题栏高度，遮罩从标题栏下方开始。不传则全屏遮罩
 */
export default function Lightbox({ filename, label, onClose, read, portalTo, topOffset = 0 }) {
  const cleanLabel = stripFormatting(label)
  const [src, setSrc] = useState(null)
  const [scale, setScale] = useState(1)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const dragging = useRef(false)
  const dragStart = useRef({ x: 0, y: 0 })
  const posStart = useRef({ x: 0, y: 0 })
  const containerRef = useRef(null)
  const { readImage: dbReadImage } = useDb()
  const readImage = read || dbReadImage
  const inWindow = !!portalTo

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

  // 任意缩放级别下均可拖拽平移
  const handleMouseDown = useCallback((e) => {
    e.preventDefault()
    dragging.current = true
    dragStart.current = { x: e.clientX, y: e.clientY }
    posStart.current = { ...position }
  }, [position])

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
      setScale(prev => Math.max(0.5, Math.min(3, prev + (e.deltaY > 0 ? -0.1 : 0.1))))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [src])

  // 窗口模式：挂载到窗口根元素内（absolute 相对窗口自动跟随，无需轮询）。
  // 注意不可挂到窗口内层（backdrop-filter 会劫持 fixed 的包含块），挂到窗口根即可。
  // 全屏模式：fixed 相对视口。
  const wrap = (node) => (inWindow ? createPortal(node, portalTo) : node)
  const overlayCls = inWindow ? 'absolute inset-0 z-[200] rounded-b-xl' : 'fixed inset-0 z-[200]'
  const overlayStyle = inWindow ? { top: topOffset } : undefined
  const closeCls = inWindow ? 'absolute z-[220]' : 'fixed z-[220]'
  const closeStyle = inWindow ? { top: topOffset + 16, right: 16 } : undefined

  if (!src) {
    return wrap(
      <div className={`${overlayCls} bg-black/80 backdrop-blur-sm flex items-center justify-center`} style={overlayStyle} onClick={onClose}>
        <div className="w-10 h-10 rounded-full border-2 border-primary-500 border-t-transparent animate-spin" />
      </div>
    )
  }

  return wrap(
    <>
      <div className={`${overlayCls} bg-black/80 backdrop-blur-sm flex items-center justify-center p-8 overflow-hidden no-drag`}
        style={overlayStyle}
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
            className={`object-contain rounded-lg shadow-2xl select-none cursor-grab ${inWindow ? 'max-w-full max-h-full' : 'max-w-[90vw] max-h-[85vh]'}`}
            style={{
              transform: `scale(${scale}) translate(${position.x / scale}px, ${position.y / scale}px)`,
            }}
            draggable={false}
          />
        </div>

        {cleanLabel && <p className="absolute bottom-4 left-1/2 -translate-x-1/2 text-sm text-surface-300 pointer-events-none">{cleanLabel}</p>}
        {/* 缩放控制 */}
        <div className="absolute bottom-4 right-4 flex items-center gap-1 bg-black/50 px-1.5 py-1 rounded-lg">
          <button
            onClick={e => { e.stopPropagation(); setScale(prev => Math.max(0.5, +(prev - 0.2).toFixed(1))) }}
            className="p-0.5 rounded text-surface-400 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="缩小"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={e => { e.stopPropagation(); setScale(1) }}
            className="px-1.5 py-0.5 rounded text-[10px] text-surface-400 hover:text-white hover:bg-white/10 transition-colors font-mono"
            aria-label="恢复 100% 缩放"
            title="恢复 100% 缩放"
          >
            {Math.round(scale * 100)}%
          </button>
          <button
            onClick={e => { e.stopPropagation(); setScale(prev => Math.min(3, +(prev + 0.2).toFixed(1))) }}
            className="p-0.5 rounded text-surface-400 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="放大"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={e => { e.stopPropagation(); setScale(1); setPosition({ x: 0, y: 0 }) }}
            className="p-0.5 rounded text-surface-400 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="回正"
            title="一键回正（恢复 100% 并居中）"
          >
            <Focus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 关闭按钮 —— 独立于背景层，避免点击区域被遮挡 */}
      <button
        onClick={onClose}
        className={`${closeCls} top-4 right-4 p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors no-drag`}
        style={closeStyle}
        aria-label="关闭"
      >
        <X className="w-5 h-5" />
      </button>
    </>
  )
}

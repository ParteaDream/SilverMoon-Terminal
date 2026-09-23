// ═════════════════════════════════════════════════════════════════
// Lightbox.jsx — 图片灯箱（M2：接入 useOverlay 焦点管理）
// 点击放大，滚轮缩放（0.5x~8x），任意缩放级别下均可拖拽平移
// 缩放始终以可视窗口中心为缩放中心；键盘 +/- 与界面 +/- 按钮：单击 5%，长按平滑连续缩放
// read：可选的自定义图片读取函数（默认数据库图片）
// portalTo：可选，小程序窗口根元素。传入时灯箱挂载到该窗口内（absolute 相对窗口）
// topOffset 为标题栏高度；不传则全屏遮罩
// 键盘：Esc 关闭（栈式，仅顶层）；Tab 圈闭在灯箱内；+/- 缩放
// ═════════════════════════════════════════════════════════════════
import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X, Plus, Minus, Focus } from 'lucide-react'
import { useDb } from '../context/DbContext'
import { stripFormatting } from '../utils/colorMarkup'
import useZoomPan from '../hooks/useZoomPan'
import useOverlay from '../hooks/useOverlay'
import useHideDock from '../hooks/useHideDock'

export default function Lightbox({ filename, label, onClose, read, portalTo, topOffset = 0 }) {
  const cleanLabel = stripFormatting(label)
  const [src, setSrc] = useState(null)
  const { readImage: dbReadImage } = useDb()
  const readImage = read || dbReadImage
  const inWindow = !!portalTo
  const { scale, position, startHold, stopHold, onWheel, reset, dragProps } = useZoomPan()
  // 查看期间临时隐藏 Dock
  useHideDock()
  // M2：焦点管理（Esc 关闭 + Tab 圈闭 + 初始焦点 + 还原）
  const ov = useOverlay({ open: true, onClose, label: cleanLabel || '图片查看' })

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
  useEffect(() => { reset() }, [filename, reset])

  const containerRef = useRef(null)

  // 窗口模式：挂载到窗口根元素内（absolute 相对窗口自动跟随）；全屏：fixed 相对视口
  // 滚轮缩放 — 原生 addEventListener({ passive: false }) 避免 React 18 passive 警告
  useEffect(() => {
    const el = containerRef.current
    if (!el || !src) return
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [src, onWheel])
  const wrap = (node) => (inWindow ? createPortal(node, portalTo) : node)
  const overlayCls = inWindow ? 'absolute inset-0 z-[200] rounded-b-xl' : 'fixed inset-0 z-[200]'
  const overlayStyle = inWindow ? { top: topOffset } : undefined
  const closeCls = inWindow ? 'absolute z-[220]' : 'fixed z-[220]'
  const closeStyle = inWindow ? { top: topOffset + 16, right: 16 } : undefined

  // 圈闭根：包一层无样式容器，覆盖遮罩与关闭钮（fixed/absolute 子元素不受影响）
  const rootWrap = (node) => (
    <div ref={ov.overlayRef} data-overlay {...ov.overlayProps}>
      {node}
    </div>
  )

  if (!src) {
    return wrap(rootWrap(
      <div data-overlay className={overlayCls} style={overlayStyle} onClick={onClose}>
        <div className="w-10 h-10 rounded-full border-2 border-primary-500 border-t-transparent animate-spin" />
      </div>
    ))
  }

  return wrap(rootWrap(
    <>
      <div data-overlay className={overlayCls + ' bg-black/80 backdrop-blur-sm flex items-center justify-center p-8 overflow-hidden no-drag'}
        style={overlayStyle}
        onClick={onClose}
        onContextMenu={(e) => { e.preventDefault(); onClose() }}
      >
        {/* 图片容器 */}
        <div
          ref={containerRef}
          className="max-w-full max-h-full flex items-center justify-center"
          onClick={e => e.stopPropagation()}
          onMouseDown={dragProps.onMouseDown}
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
        {/* 缩放控制（长按连续缩放） */}
        <div className="absolute bottom-4 right-4 flex items-center gap-1 bg-black/50 px-1.5 py-1 rounded-lg">
          <button
            onMouseDown={(e) => { e.stopPropagation(); startHold(-1) }}
            onMouseUp={stopHold}
            onMouseLeave={stopHold}
            onClick={e => e.stopPropagation()}
            className="p-0.5 rounded text-surface-400 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="缩小"
            title="缩小（- / 长按连续缩放）"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={e => { e.stopPropagation(); reset() }}
            className="px-1.5 py-0.5 rounded text-[10px] text-surface-400 hover:text-white hover:bg-white/10 transition-colors font-mono"
            aria-label="恢复 100% 缩放"
            title="恢复 100% 缩放"
          >
            {Math.round(scale * 100)}%
          </button>
          <button
            onMouseDown={(e) => { e.stopPropagation(); startHold(1) }}
            onMouseUp={stopHold}
            onMouseLeave={stopHold}
            onClick={e => e.stopPropagation()}
            className="p-0.5 rounded text-surface-400 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="放大"
            title="放大（+ / 长按连续缩放）"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={e => { e.stopPropagation(); reset() }}
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
        className={closeCls + ' top-4 right-4 p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors no-drag'}
        style={closeStyle}
        aria-label="关闭"
      >
        <X className="w-5 h-5" />
      </button>
    </>
  ))
}
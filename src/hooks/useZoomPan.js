import { useCallback, useEffect, useRef, useState } from 'react'

// ═══════════════════════════════════════
// 图片查看器 缩放/平移 Hook（Lightbox / 版本图灯箱 / 相册灯箱共用）
// ═══════════════════════════════════════
// - 缩放始终以「可视窗口中心」为缩放中心（position 随缩放等比变化，锚点不动）
// - 滚轮缩放：乘性、灵敏度可调（默认每 100 deltaY ≈ 5%，约为原来的 1/2）
// - 键盘 +/- 与 UI +/- 按钮：单击一步 5%，长按进入平滑连续缩放（rAF 速率控制）
// - 拖拽平移；interacting 供外部在交互期间禁用过渡动画

export const ZOOM_STEP = 0.05            // 单次缩放幅度 5%
export const HOLD_DELAY_MS = 300         // 长按阈值：按下超过 300ms 进入连续缩放
export const HOLD_STEP_MS = 160          // 长按速度：每 160ms 一档 5%（约每秒 ×1.34）
export const WHEEL_DELTA_FACTOR = 0.0005 // 滚轮灵敏度：每 100 deltaY ≈ 5%

export default function useZoomPan({ minScale = 0.5, maxScale = 3 } = {}) {
  const [scale, setScale] = useState(1)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)     // 拖拽平移中
  const [holding, setHolding] = useState(false)       // 长按缩放中
  const scaleRef = useRef(1)
  const posRef = useRef({ x: 0, y: 0 })
  const draggingRef = useRef(false)
  const dragStartRef = useRef({ x: 0, y: 0 })
  const posStartRef = useRef({ x: 0, y: 0 })
  const holdTimerRef = useRef(null)
  const holdRafRef = useRef(null)
  const holdDirRef = useRef(0)
  const holdLastRef = useRef(0)

  // ── 核心缩放：以可视窗口中心为缩放中心 ──
  // 缩放时位置按比例调整（position *= s'/s），保证视口中心的画面内容不移动
  const applyZoom = useCallback((factor) => {
    const prev = scaleRef.current
    let next = prev * factor
    if (next < minScale) next = minScale
    if (next > maxScale) next = maxScale
    if (next === prev) return
    const ratio = next / prev
    scaleRef.current = next
    posRef.current = { x: posRef.current.x * ratio, y: posRef.current.y * ratio }
    setScale(next)
    setPosition(posRef.current)
  }, [minScale, maxScale])

  // 单步缩放（键盘/按钮单击）：5%
  const zoomStep = useCallback((dir) => {
    applyZoom(dir > 0 ? 1 + ZOOM_STEP : 1 / (1 + ZOOM_STEP))
  }, [applyZoom])

  // ── 长按连续缩放：mousedown/keydown 触发，mouseup/keyup/leave 停止 ──
  const stopHold = useCallback(() => {
    holdDirRef.current = 0
    if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null }
    if (holdRafRef.current) { cancelAnimationFrame(holdRafRef.current); holdRafRef.current = null }
    setHolding(false)
  }, [])

  const startHold = useCallback((dir) => {
    stopHold()
    zoomStep(dir) // 先走一步：单击 = 单步 5%
    holdDirRef.current = dir
    setHolding(true)
    // 超过长按阈值后进入平滑连续缩放；速率由 HOLD_STEP_MS 控制（帧率无关）
    holdTimerRef.current = setTimeout(() => {
      holdTimerRef.current = null
      holdLastRef.current = performance.now()
      const tick = (now) => {
        const dt = now - holdLastRef.current
        holdLastRef.current = now
        const factor = 1 + holdDirRef.current * ZOOM_STEP * (dt / HOLD_STEP_MS)
        applyZoom(factor)
        holdRafRef.current = requestAnimationFrame(tick)
      }
      holdRafRef.current = requestAnimationFrame(tick)
    }, HOLD_DELAY_MS)
  }, [stopHold, zoomStep, applyZoom])

  // 卸载时清理
  useEffect(() => stopHold, [stopHold])

  // ── 拖拽平移 ──
  const onDragStart = useCallback((e) => {
    if (e.button !== 0) return
    e.preventDefault()
    draggingRef.current = true
    dragStartRef.current = { x: e.clientX, y: e.clientY }
    posStartRef.current = { ...posRef.current }
    setDragging(true)
  }, [])

  useEffect(() => {
    const move = (e) => {
      if (!draggingRef.current) return
      const dx = e.clientX - dragStartRef.current.x
      const dy = e.clientY - dragStartRef.current.y
      posRef.current = { x: posStartRef.current.x + dx, y: posStartRef.current.y + dy }
      setPosition(posRef.current)
    }
    const up = () => {
      if (draggingRef.current) setDragging(false)
      draggingRef.current = false
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [])

  // ── 滚轮缩放（乘性；灵敏度为原来的约 1/2）──
  const onWheel = useCallback((e) => {
    e.stopPropagation()
    e.preventDefault()
    applyZoom(Math.exp(-e.deltaY * WHEEL_DELTA_FACTOR))
  }, [applyZoom])

  // ── 键盘 +/-（长按同 mouse 的平滑缩放）──
  const onKeyDown = useCallback((e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const k = e.key
    if (k === '+' || k === '=' || k === 'Add') {
      e.preventDefault()
      if (!e.repeat) startHold(1)
    } else if (k === '-' || k === 'Subtract') {
      e.preventDefault()
      if (!e.repeat) startHold(-1)
    }
  }, [startHold])

  useEffect(() => {
    const onKeyUp = (e) => {
      const k = e.key
      if (k === '+' || k === '=' || k === 'Add' || k === '-' || k === 'Subtract') stopHold()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [onKeyDown, stopHold])

  // 恢复 100% 并回正
  const reset = useCallback(() => {
    stopHold()
    scaleRef.current = 1
    posRef.current = { x: 0, y: 0 }
    setScale(1)
    setPosition({ x: 0, y: 0 })
  }, [stopHold])

  return {
    scale,
    position,
    dragging,
    holding,
    interacting: dragging || holding,
    zoomStep,
    startHold,
    stopHold,
    onWheel,
    reset,
    dragProps: { onMouseDown: onDragStart },
  }
}

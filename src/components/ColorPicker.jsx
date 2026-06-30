import React, { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'

// ── HSV ↔ 颜色转换工具 ──
function hsvToRgb(h, s, v) {
  h = ((h % 360) + 360) % 360
  s = Math.max(0, Math.min(1, s))
  v = Math.max(0, Math.min(1, v))
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  let r, g, b
  if (h < 60) { r = c; g = x; b = 0 }
  else if (h < 120) { r = x; g = c; b = 0 }
  else if (h < 180) { r = 0; g = c; b = x }
  else if (h < 240) { r = 0; g = x; b = c }
  else if (h < 300) { r = x; g = 0; b = c }
  else { r = c; g = 0; b = x }
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  }
}

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60
    else if (max === g) h = ((b - r) / d + 2) * 60
    else h = ((r - g) / d + 4) * 60
  }
  return { h, s: max === 0 ? 0 : d / max, v: max }
}

function hexToHsv(hex) {
  const rgb = hexToRgb(hex)
  return rgbToHsv(rgb.r, rgb.g, rgb.b)
}

function hexToRgb(hex) {
  const clean = hex.replace('#', '')
  const num = parseInt(clean, 16)
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 }
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('')
}

function hsvToHex(h, s, v) {
  const { r, g, b } = hsvToRgb(h, s, v)
  return rgbToHex(r, g, b)
}

function isValidHex(hex) {
  return /^#?[0-9a-fA-F]{6}$/.test(hex) || /^#?[0-9a-fA-F]{3}$/.test(hex)
}

function normalizeHex(hex) {
  const clean = hex.replace('#', '')
  if (clean.length === 3) {
    return '#' + clean[0] + clean[0] + clean[1] + clean[1] + clean[2] + clean[2]
  }
  return '#' + clean
}

// ── Canvas 尺寸 ──
const FIELD_W = 220
const FIELD_H = 180
const HUE_W = 220
const HUE_H = 20

/**
 * 自定义颜色选择器（弹出式 Canvas 绘制）
 *
 * 替代原生 <input type="color">，避免 Windows 上原生拾色器弹窗导致无法拾取屏幕色的问题。
 * 同时支持 hex 输入和预设颜色快捷选中。
 */
export default function ColorPicker({ value, onChange, disabled, className, title, presetColors, buttonClassName, buttonStyle }) {
  const [open, setOpen] = useState(false)
  const [hexInput, setHexInput] = useState('')
  const [popoverPos, setPopoverPos] = useState({ top: 0, left: 0 })
  const containerRef = useRef(null)
  const fieldCanvasRef = useRef(null)
  const hueCanvasRef = useRef(null)
  const popoverRef = useRef(null)

  // 当前颜色的 HSV
  const hsv = hexToHsv(value || '#000000')
  const [hue, setHue] = useState(hsv.h)
  const [sat, setSat] = useState(hsv.s)
  const [val, setVal] = useState(hsv.v)

  // 同步外部 value 变化
  useEffect(() => {
    const cur = hexToHsv(value || '#000000')
    setHue(cur.h)
    setSat(cur.s)
    setVal(cur.v)
  }, [value])

  // ── 绘制色彩场 ──
  const drawField = useCallback((h, s, v) => {
    const canvas = fieldCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const w = FIELD_W, hh = FIELD_H

    // 背景：从白到纯色的渐变色相
    const base = hsvToRgb(h, 1, 1)
    const grad = ctx.createLinearGradient(0, 0, w, 0)
    grad.addColorStop(0, '#ffffff')
    grad.addColorStop(1, `rgb(${base.r},${base.g},${base.b})`)
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, w, hh)

    // 从上到下的黑色渐变
    const grad2 = ctx.createLinearGradient(0, 0, 0, hh)
    grad2.addColorStop(0, 'rgba(0,0,0,0)')
    grad2.addColorStop(1, 'rgba(0,0,0,1)')
    ctx.fillStyle = grad2
    ctx.fillRect(0, 0, w, hh)

    // 十字准星
    const px = s * w
    const py = (1 - v) * hh
    ctx.beginPath()
    ctx.arc(px, py, 5, 0, Math.PI * 2)
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(px, py, 4, 0, Math.PI * 2)
    ctx.strokeStyle = '#000000'
    ctx.lineWidth = 1
    ctx.stroke()
  }, [])

  // ── 绘制色相条 ──
  const drawHueBar = useCallback((h) => {
    const canvas = hueCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const w = HUE_W, hh = HUE_H

    const grad = ctx.createLinearGradient(0, 0, w, 0)
    for (let i = 0; i <= 6; i++) {
      const { r, g, b } = hsvToRgb(i * 60, 1, 1)
      grad.addColorStop(i / 6, `rgb(${r},${g},${b})`)
    }
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, w, hh)

    // 指示器
    const px = (h / 360) * w
    ctx.beginPath()
    ctx.arc(px, hh / 2, 7, 0, Math.PI * 2)
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(px, hh / 2, 6, 0, Math.PI * 2)
    ctx.strokeStyle = '#000000'
    ctx.lineWidth = 1
    ctx.stroke()
  }, [])

  // 打开弹出层时绘制
  useEffect(() => {
    if (open) {
      drawField(hue, sat, val)
      drawHueBar(hue)
    }
  }, [open, hue, sat, val, drawField, drawHueBar])

  // ── 定位 + 关闭 ──
  useEffect(() => {
    if (!open) return

    // 定位
    function reposition() {
      if (!containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const popW = FIELD_W + 24 // padding
      let left = rect.left
      let top = rect.bottom + 4
      // 防止贴边溢出
      if (left + popW > window.innerWidth - 8) {
        left = window.innerWidth - popW - 8
      }
      if (top + 300 > window.innerHeight) {
        top = rect.top - 300
      }
      setPopoverPos({ top, left })
    }
    reposition()

    // 点击外部关闭
    function handleOutsideClick(e) {
      if (
        containerRef.current && !containerRef.current.contains(e.target) &&
        popoverRef.current && !popoverRef.current.contains(e.target)
      ) {
        setOpen(false)
      }
    }

    // Escape 键关闭
    function handleKeyDown(e) {
      if (e.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', handleOutsideClick)
    document.addEventListener('keydown', handleKeyDown)
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick)
      document.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [open])

  // ── 交互处理 ──
  function handleFieldMouse(e) {
    const canvas = fieldCanvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
    const newSat = x
    const newVal = 1 - y
    setSat(newSat)
    setVal(newVal)
    const hex = hsvToHex(hue, newSat, newVal)
    onChange(hex)
  }

  function handleHueMouse(e) {
    const canvas = hueCanvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const newH = x * 360
    setHue(newH)
    const hex = hsvToHex(newH, sat, val)
    onChange(hex)
  }

  // 拖拽：用 ref 存储监听器以便卸载时清理
  const dragListenersRef = useRef(null)
  useEffect(() => {
    return () => {
      if (dragListenersRef.current) {
        document.removeEventListener('mousemove', dragListenersRef.current.move)
        document.removeEventListener('mouseup', dragListenersRef.current.up)
      }
    }
  }, [])

  function startFieldDrag(e) {
    handleFieldMouse(e)
    const onMove = (ev) => handleFieldMouse(ev)
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      dragListenersRef.current = null
    }
    dragListenersRef.current = { move: onMove, up: onUp }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  function startHueDrag(e) {
    handleHueMouse(e)
    const onMove = (ev) => handleHueMouse(ev)
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      dragListenersRef.current = null
    }
    dragListenersRef.current = { move: onMove, up: onUp }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  // ── hex 输入 ──
  function handleHexInputChange(e) {
    const raw = e.target.value
    setHexInput(raw)
    if (isValidHex(raw)) {
      const hex = normalizeHex(raw)
      const { h, s, v } = hexToHsv(hex)
      setHue(h)
      setSat(s)
      setVal(v)
      onChange(hex)
    }
  }

  function handleHexBlur() {
    if (hexInput && !isValidHex(hexInput)) {
      setHexInput(value || '')
    }
  }

  // 打开/关闭
  function openPicker(e) {
    if (disabled) return
    e.stopPropagation()
    setHexInput(value || '')
    setOpen(true)
  }

  function closePicker() {
    setOpen(false)
  }

  // 预设颜色点击
  function handlePresetClick(color, e) {
    e.stopPropagation()
    const { h, s, v } = hexToHsv(color)
    setHue(h)
    setSat(s)
    setVal(v)
    onChange(color)
  }

  // ── 滴管取色 ──
  const [eyeDropperBusy, setEyeDropperBusy] = useState(false)
  const [showBlockOverlay, setShowBlockOverlay] = useState(false)
  const eyeDropperCancelledRef = useRef(false)

  async function handleEyeDropper(e) {
    e.stopPropagation()
    if (eyeDropperBusy) return
    if (typeof EyeDropper === 'undefined') {
      console.warn('[ColorPicker] EyeDropper API not available')
      return
    }
    eyeDropperCancelledRef.current = false
    setEyeDropperBusy(true)
    setShowBlockOverlay(true)
    try {
      const eyeDropper = new EyeDropper()
      const result = await eyeDropper.open()
      if (eyeDropperCancelledRef.current) return // 右键取消后忽略结果
      const hex = result.sRGBHex.toLowerCase()
      setHexInput(hex)
      const { h, s, v } = hexToHsv(hex)
      setHue(h)
      setSat(s)
      setVal(v)
      onChange(hex)
    } catch (err) {
      if (err.name !== 'AbortError' && err.name !== 'DOMException') {
        console.warn('[ColorPicker] EyeDropper error:', err)
      }
    } finally {
      setEyeDropperBusy(false)
      // 延迟移除遮罩，捕获取色点击可能残留的 mouseup 事件
      setTimeout(() => setShowBlockOverlay(false), 120)
    }
  }

  function cancelEyeDropper() {
    eyeDropperCancelledRef.current = true
    setEyeDropperBusy(false)
    setShowBlockOverlay(false)
  }

  // ── 弹出层内容 ──
  const popover = open && (
    <div
      ref={popoverRef}
      className="fixed z-[100] p-3 bg-surface-800 border border-surface-600 rounded-lg shadow-2xl"
      style={{ top: popoverPos.top, left: popoverPos.left, minWidth: FIELD_W + 24 }}
      onMouseDown={e => e.stopPropagation()}
    >
      {/* 当前颜色预览 */}
      <div className="flex items-center gap-2 mb-2">
        <div
          className="w-8 h-8 rounded border border-surface-600 flex-shrink-0"
          style={{ backgroundColor: hsvToHex(hue, sat, val) }}
        />
        <input
          type="text"
          value={hexInput}
          onChange={handleHexInputChange}
          onBlur={handleHexBlur}
          placeholder="#000000"
          className="flex-1 px-2 py-1 text-xs font-mono bg-surface-900 border border-surface-600 rounded
                     text-white placeholder-surface-500 outline-none focus:border-primary-500"
        />
        <button
          type="button"
          onClick={handleEyeDropper}
          disabled={eyeDropperBusy}
          className={`flex-shrink-0 w-7 h-7 flex items-center justify-center rounded
            ${eyeDropperBusy ? 'opacity-50 cursor-wait' : 'hover:bg-surface-700 cursor-pointer'}
            text-surface-400 hover:text-white transition-colors`}
          title="屏幕取色"
        >
          {/* 滴管 SVG 图标 */}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 22l1-1h3l9-9" />
            <path d="M3 21l9-9" />
            <path d="M18.5 5.5a2.5 2.5 0 0 1 0-4 2.5 2.5 0 0 1 4 0 2.5 2.5 0 0 1 0 4" />
            <path d="M17 7l-5 5" />
            <path d="M7 17l5-5" />
          </svg>
        </button>
      </div>

      {/* 色彩场 */}
      <canvas
        ref={fieldCanvasRef}
        width={FIELD_W}
        height={FIELD_H}
        className="rounded cursor-crosshair block mb-2"
        onMouseDown={startFieldDrag}
      />

      {/* 色相条 */}
      <canvas
        ref={hueCanvasRef}
        width={HUE_W}
        height={HUE_H}
        className="rounded cursor-pointer block mb-2"
        onMouseDown={startHueDrag}
      />

      {/* 预设颜色 */}
      {presetColors && presetColors.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-1">
          {presetColors.map(({ label, color }) => (
            <button
              key={label}
              type="button"
              onMouseDown={e => handlePresetClick(color, e)}
              className="w-5 h-5 rounded-full border-2 border-surface-600 hover:scale-125 transition-transform cursor-pointer"
              style={{ backgroundColor: color }}
              title={label}
            />
          ))}
        </div>
      )}
    </div>
  )

  return (
    <div ref={containerRef} className={`relative flex ${className || ''}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={openPicker}
        className={`cursor-pointer p-0
          ${disabled ? 'opacity-40 pointer-events-none' : 'hover:scale-110 transition-transform'}
          ${!open ? '' : 'ring-2 ring-primary-500'}
          ${buttonClassName || 'w-5 h-5 rounded-full border-2 border-surface-500'}`}
        style={{ backgroundColor: value || '#000000', ...(buttonStyle || {}) }}
        title={title || '自定义颜色'}
      />
      {popover && createPortal(popover, document.body)}
      {/* 滴管取色时：全屏透明遮罩，阻止点击穿透到其他元素 */}
      {showBlockOverlay && createPortal(
        <div
          className="fixed inset-0 z-[200]"
          onMouseDown={e => e.preventDefault()}
          onMouseUp={e => e.preventDefault()}
          onClick={e => e.preventDefault()}
          onContextMenu={e => { e.preventDefault(); cancelEyeDropper() }}
        />,
        document.body
      )}
    </div>
  )
}

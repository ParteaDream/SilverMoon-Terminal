import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Flame, RotateCcw, Play, Pause, Gauge, Users, Trophy, X, Search, Sparkles } from 'lucide-react'
import { useDb } from '../context/DbContext'
import { RACE, TRIAL, generateCourse, hazardSpan } from '../utils/raceCourse.mjs'
import { createRace, stepRace, raceStandings, raceResults } from '../utils/racePhysics.mjs'

// ═══════════════════════════════════════════════════════════════════════════
// 归火圣夜巡礼 · 2D 赛马小游戏
//
// 7 颗角色球同时坠入纳塔地心的「归火圣道」，穿越 22 层随机机关（齿轮转盘、
// 跃火蹦床、燃素吹风祭坛、摆锤、传送带、钉阵……），按抵达终点的先后排名。
//
// 物理与关卡生成见 src/utils/raceCourse.mjs / racePhysics.mjs（纯 JS，可无头验证）。
// 本文件只负责：角色装载、交互状态机、纳塔夜魂风格 Canvas 渲染。
// ═══════════════════════════════════════════════════════════════════════════

const TAU = Math.PI * 2
const VIEW_H = 620          // 基准可视高度（世界单位，≈ 一层的高度）
const HUD_MS = 110          // HUD 刷新间隔

// ── 元素配色（1火 2水 3风 4雷 5草 6冰 7岩）──────────────────────────────
const ELEM = {
  1: { name: '火', c: '#FF7A3D', c2: '#FFD07A' },
  2: { name: '水', c: '#49B7FF', c2: '#A9E3FF' },
  3: { name: '风', c: '#4FE3C0', c2: '#B2F7E6' },
  4: { name: '雷', c: '#B98CFF', c2: '#E0CBFF' },
  5: { name: '草', c: '#8FE04A', c2: '#D2F79A' },
  6: { name: '冰', c: '#8FE6F2', c2: '#D9FBFF' },
  7: { name: '岩', c: '#FFC94A', c2: '#FFECB0' },
}
const ELEM_FALLBACK = { name: '?', c: '#9AA7C7', c2: '#D6DEF0' }

// 数据库不可用（浏览器模式 / 图包缺失）时的兜底角色，保证小游戏永远能玩
const FALLBACK_CHARS = [
  { id: '__fb1', name_zh: '燃素之种', element_id: 1 },
  { id: '__fb2', name_zh: '夜魂之滴', element_id: 2 },
  { id: '__fb3', name_zh: '回声之风', element_id: 3 },
  { id: '__fb4', name_zh: '曜石之雷', element_id: 4 },
  { id: '__fb5', name_zh: '古龙之芽', element_id: 5 },
  { id: '__fb6', name_zh: '极寒之晶', element_id: 6 },
  { id: '__fb7', name_zh: '熔岩之核', element_id: 7 },
]

// 每层主题色（让相邻两层一眼看出不是同一台机器）
const THEME = [
  { a: '#FFC94A', b: '#FF7A3D', n: '熔金' },
  { a: '#46F2E0', b: '#2E9BE0', n: '夜魂' },
  { a: '#B98CFF', b: '#7A5CF0', n: '曜紫' },
  { a: '#8FE04A', b: '#3FB58A', n: '古龙' },
  { a: '#FF9E3D', b: '#D6452C', n: '燃素' },
]
function themeOf(i) { return THEME[(i || 0) % THEME.length] }

// 纳塔调色板
const P = {
  obsidian: '#0A0714',
  basalt: '#1B1430',
  basalt2: '#251A3E',
  phlogiston: '#FF5A1F',
  ember: '#FF9E3D',
  gold: '#FFC94A',
  goldDeep: '#C98A22',
  soul: '#46F2E0',
  soulDeep: '#0FB8B0',
  jade: '#7BE8C8',
  violet: '#7A5CF0',
  ink: '#08060F',
}

// ── 小工具 ────────────────────────────────────────────────────────────────
function clamp(v, a, b) { return v < a ? a : v > b ? b : v }
function lerp(a, b, t) { return a + (b - a) * t }

function hex2rgb(h) {
  const s = h.replace('#', '')
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)]
}
const _rgbCache = new Map()
function rgbOf(h) {
  let v = _rgbCache.get(h)
  if (!v) { v = hex2rgb(h); _rgbCache.set(h, v) }
  return v
}
function mixHex(a, b, t) {
  const A = rgbOf(a), B = rgbOf(b)
  return `rgb(${Math.round(lerp(A[0], B[0], t))},${Math.round(lerp(A[1], B[1], t))},${Math.round(lerp(A[2], B[2], t))})`
}
function rgba(hex, a) {
  const c = rgbOf(hex)
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`
}

function fmtTime(t) {
  if (t == null) return '--:--'
  const m = Math.floor(t / 60)
  const s = t - m * 60
  return `${m}:${s.toFixed(2).padStart(5, '0')}`
}
function fmtGap(dt) {
  if (dt == null || dt <= 0.005) return '—'
  return `+${dt.toFixed(2)}s`
}

function loadImageEl(src) {
  return new Promise(resolve => {
    if (!src) { resolve(null); return }
    const im = new Image()
    im.onload = () => resolve(im)
    im.onerror = () => resolve(null)
    im.src = src
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// Canvas 绘制层
// ═══════════════════════════════════════════════════════════════════════════

function s0(d, scale) { return Math.max(0.5, (d.s || 1) * scale) }

function roundRect(g, x, y, w, h, r) {
  g.beginPath()
  g.moveTo(x + r, y)
  g.arcTo(x + w, y, x + w, y + h, r)
  g.arcTo(x + w, y + h, x, y + h, r)
  g.arcTo(x, y + h, x, y, r)
  g.arcTo(x, y, x + w, y, r)
  g.closePath()
}

function drawStar(g, x, y, r, color, alpha) {
  g.fillStyle = color
  g.globalAlpha = alpha
  g.beginPath()
  g.moveTo(x, y - r)
  g.quadraticCurveTo(x, y, x + r, y)
  g.quadraticCurveTo(x, y, x, y + r)
  g.quadraticCurveTo(x, y, x - r, y)
  g.quadraticCurveTo(x, y, x, y - r)
  g.fill()
  g.globalAlpha = 1
}

/** 纳塔式部落纹（锯齿 / 回纹） */
function tribalBand(g, x, y0, y1, w, color, alpha, dir) {
  g.strokeStyle = color
  g.globalAlpha = alpha
  g.lineWidth = Math.max(1, w * 0.16)
  g.beginPath()
  const step = 22
  for (let y = y0; y < y1; y += step) {
    g.moveTo(x, y)
    g.lineTo(x + dir * w, y + step * 0.5)
    g.lineTo(x, y + step)
  }
  g.stroke()
  g.globalAlpha = 1
}

/** 夜魂符印：菱形 + 内十字 */
function soulGlyph(g, x, y, r, color, alpha, rot) {
  g.save()
  g.translate(x, y)
  g.rotate(rot || 0)
  g.globalAlpha = alpha
  g.strokeStyle = color
  g.lineWidth = Math.max(1.2, r * 0.16)
  g.beginPath()
  g.moveTo(0, -r); g.lineTo(r * 0.72, 0); g.lineTo(0, r); g.lineTo(-r * 0.72, 0); g.closePath()
  g.stroke()
  g.beginPath()
  g.moveTo(0, -r * 0.45); g.lineTo(0, r * 0.45)
  g.moveTo(-r * 0.32, 0); g.lineTo(r * 0.32, 0)
  g.stroke()
  g.restore()
  g.globalAlpha = 1
}

/** 齿轮本体 */
function drawGearBody(g, x, y, r, teeth, toothLen, ang, scale) {
  const R = r * scale
  const TL = toothLen * scale
  g.save()
  g.translate(x, y)
  g.rotate(ang)
  // 齿
  g.fillStyle = '#3A2A12'
  g.beginPath()
  for (let i = 0; i < teeth; i++) {
    const a0 = (i / teeth) * TAU
    const half = (Math.PI / teeth) * 0.62
    g.moveTo(Math.cos(a0 - half) * R, Math.sin(a0 - half) * R)
    g.lineTo(Math.cos(a0 - half * 0.7) * (R + TL), Math.sin(a0 - half * 0.7) * (R + TL))
    g.lineTo(Math.cos(a0 + half * 0.7) * (R + TL), Math.sin(a0 + half * 0.7) * (R + TL))
    g.lineTo(Math.cos(a0 + half) * R, Math.sin(a0 + half) * R)
    g.closePath()
  }
  g.fill()
  g.strokeStyle = P.goldDeep
  g.lineWidth = Math.max(1, 1.6 * scale)
  g.stroke()
  // 轮盘
  const grd = g.createRadialGradient(-R * 0.3, -R * 0.35, R * 0.1, 0, 0, R)
  grd.addColorStop(0, '#5A4520')
  grd.addColorStop(1, '#241708')
  g.fillStyle = grd
  g.beginPath(); g.arc(0, 0, R, 0, TAU); g.fill()
  g.strokeStyle = rgba(P.gold, 0.75)
  g.lineWidth = Math.max(1.2, 2 * scale)
  g.stroke()
  // 轮辐
  g.strokeStyle = rgba(P.gold, 0.4)
  g.lineWidth = Math.max(1, 2.4 * scale)
  for (let i = 0; i < Math.min(6, teeth); i++) {
    const a = (i / Math.min(6, teeth)) * TAU
    g.beginPath()
    g.moveTo(Math.cos(a) * R * 0.24, Math.sin(a) * R * 0.24)
    g.lineTo(Math.cos(a) * R * 0.85, Math.sin(a) * R * 0.85)
    g.stroke()
  }
  // 轮心
  g.fillStyle = rgba(P.phlogiston, 0.95)
  g.beginPath(); g.arc(0, 0, R * 0.24, 0, TAU); g.fill()
  g.fillStyle = rgba('#FFE9B0', 0.9)
  g.beginPath(); g.arc(0, 0, R * 0.1, 0, TAU); g.fill()
  g.restore()
}

/** 圆形平台/钉/弹核 */
function drawKnob(g, x, y, r, style, t) {
  const R = r
  g.beginPath(); g.arc(x, y, R, 0, TAU)
  const grd = g.createRadialGradient(x - R * 0.35, y - R * 0.4, R * 0.1, x, y, R)
  if (style === 'bumper') {
    grd.addColorStop(0, '#6A56AC')
    grd.addColorStop(1, '#241C4C')
  } else if (style === 'fanbody') {
    grd.addColorStop(0, '#8A5624')
    grd.addColorStop(1, '#2E1B09')
  } else {
    grd.addColorStop(0, '#6E5628')
    grd.addColorStop(1, '#2A1D0C')
  }
  g.fillStyle = grd
  g.fill()
  g.strokeStyle = style === 'bumper' ? rgba(P.soul, 0.8) : rgba(P.gold, 0.65)
  g.lineWidth = Math.max(1.2, R * 0.12)
  g.stroke()
  if (style === 'bumper') {
    soulGlyph(g, x, y, R * 0.52, rgba(P.soul, 0.85), 0.85, t * 0.8)
  } else {
    g.fillStyle = rgba(P.ember, 0.55)
    g.beginPath(); g.arc(x - R * 0.28, y - R * 0.32, R * 0.2, 0, TAU); g.fill()
  }
}

/** 传送带：滚动条纹 */
function drawBelt(g, x1, y1, x2, y2, rad, svel, t) {
  const dx = x2 - x1, dy = y2 - y1
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len, uy = dy / len
  g.save()
  g.lineCap = 'round'
  g.strokeStyle = '#2A1E3C'
  g.lineWidth = rad * 2
  g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke()
  // 滚动条纹
  g.save()
  g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2)
  g.lineWidth = rad * 2
  g.strokeStyle = 'rgba(0,0,0,0)'
  g.setLineDash([6, 10])
  const sp = Math.hypot(svel?.vx || 0, svel?.vy || 0)
  g.lineDashOffset = -((t * sp * 0.9) % 16)
  g.strokeStyle = rgba(P.soul, 0.55)
  g.stroke()
  g.restore()
  // 上行光边
  g.strokeStyle = rgba(P.gold, 0.5)
  g.lineWidth = Math.max(1, rad * 0.24)
  g.beginPath()
  g.moveTo(x1 - uy * rad * 0.72, y1 + ux * rad * 0.72)
  g.lineTo(x2 - uy * rad * 0.72, y2 + ux * rad * 0.72)
  g.stroke()
  g.restore()
}

/** 蹦床 */
function drawTramp(g, x1, y1, x2, y2, rad, scale, t) {
  const dx = x2 - x1, dy = y2 - y1
  const len = Math.hypot(dx, dy) || 1
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2
  const nx = -dy / len, ny = dx / len
  g.save()
  g.lineCap = 'round'
  g.strokeStyle = '#123A38'
  g.lineWidth = rad * 2.4
  g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke()
  // 弹性网面（呼吸感）
  const breathe = 1 + Math.sin(t * 3.2) * 0.06
  g.strokeStyle = rgba(P.jade, 0.95)
  g.lineWidth = Math.max(1.4, rad * 0.6 * breathe)
  g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke()
  // 两端线圈
  g.strokeStyle = rgba(P.gold, 0.8)
  g.lineWidth = Math.max(1, rad * 0.3)
  for (const [ex, ey] of [[x1, y1], [x2, y2]]) {
    g.beginPath()
    g.arc(ex, ey, rad * 0.9, 0, TAU)
    g.stroke()
  }
  // 中部受力箭头
  g.strokeStyle = rgba(P.soul, 0.5)
  g.lineWidth = Math.max(1, rad * 0.22)
  for (let k = -1; k <= 1; k++) {
    const px = mx + (dx / len) * k * len * 0.28
    const py = my + (dy / len) * k * len * 0.28
    g.beginPath()
    g.moveTo(px, py)
    g.lineTo(px + nx * rad * 2.1, py + ny * rad * 2.1)
    g.stroke()
  }
  g.restore()
}

/** 吹风机风场 */
function drawWindField(g, f, t, scale) {
  const x = f.x, y = f.y, w = f.w, h = f.h
  const dir = f.ax >= 0 ? 1 : -1
  g.save()
  g.globalCompositeOperation = 'lighter'
  // 风道底色
  const wg = g.createLinearGradient(x, y, x + dir * w, y)
  wg.addColorStop(0, rgba(P.soul, 0.16))
  wg.addColorStop(1, rgba(P.soul, 0.03))
  g.fillStyle = wg
  g.fillRect(Math.min(x, x + dir * w) , y, Math.abs(w), h)
  for (let i = 0; i < 11; i++) {
    const p = ((t * 0.62 + i / 11) % 1)
    const px = dir > 0 ? x + w * p : x + w * (1 - p)
    const py = y + h * (0.08 + 0.84 * ((i * 0.37) % 1))
    const a = Math.sin(p * Math.PI) * 0.9
    g.strokeStyle = rgba(i % 3 === 0 ? '#DFFFF8' : P.soul, a * 0.85)
    g.lineWidth = Math.max(1.4, 3 * scale)
    g.lineCap = 'round'
    g.beginPath()
    g.moveTo(px, py)
    g.quadraticCurveTo(px + dir * 18 * scale, py + (f.ay ? 6 * scale : -2 * scale),
      px + dir * 48 * scale, py + (f.ay ? 16 * scale : 0))
    g.stroke()
  }
  g.restore()
  g.globalAlpha = 1
}

/** 吹风机本体：兽首喷嘴 + 旋转扇叶 + 定向风锥 */
function drawFanBody(g, x, y, r, dir, t, scale) {
  g.save()
  // 风锥
  g.globalCompositeOperation = 'lighter'
  const cone = g.createLinearGradient(x, y, x + dir * r * 3.4, y)
  cone.addColorStop(0, rgba(P.soul, 0.35))
  cone.addColorStop(1, rgba(P.soul, 0))
  g.fillStyle = cone
  g.beginPath()
  g.moveTo(x, y - r * 0.85)
  g.lineTo(x + dir * r * 3.4, y - r * 1.5)
  g.lineTo(x + dir * r * 3.4, y + r * 1.5)
  g.lineTo(x, y + r * 0.85)
  g.closePath()
  g.fill()
  g.globalCompositeOperation = 'source-over'
  // 机壳
  const bd = g.createLinearGradient(x - r, y - r, x + r, y + r)
  bd.addColorStop(0, '#7A4A1C')
  bd.addColorStop(1, '#2A1706')
  g.fillStyle = bd
  g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill()
  g.strokeStyle = rgba(P.gold, 0.85)
  g.lineWidth = Math.max(1.2, 2 * scale)
  g.stroke()
  // 扇叶
  g.save()
  g.translate(x, y)
  g.rotate(t * 7)
  g.strokeStyle = rgba('#FFE9B0', 0.9)
  g.lineWidth = Math.max(1.4, r * 0.22)
  for (let i = 0; i < 3; i++) {
    g.beginPath()
    g.arc(0, 0, r * 0.55, (i / 3) * TAU, (i / 3) * TAU + 1.5)
    g.stroke()
  }
  g.restore()
  // 核心
  g.fillStyle = rgba(P.phlogiston, 0.95)
  g.beginPath(); g.arc(x, y, r * 0.22, 0, TAU); g.fill()
  // 出风口的部落齿
  g.strokeStyle = rgba(P.gold, 0.7)
  g.lineWidth = Math.max(1, 1.6 * scale)
  for (let i = -1; i <= 1; i++) {
    g.beginPath()
    g.moveTo(x + dir * r * 0.95, y + i * r * 0.42 - r * 0.16)
    g.lineTo(x + dir * r * 1.5, y + i * r * 0.42)
    g.lineTo(x + dir * r * 0.95, y + i * r * 0.42 + r * 0.16)
    g.stroke()
  }
  g.restore()
}

/** 燃素喷流 */
function drawJet(g, f, t, scale) {
  const cx = f.x + f.w / 2
  const base = f.y + f.h
  const pulse = 0.55 + 0.45 * Math.cos((t / (f.period || 2.6)) * TAU)
  g.save()
  g.globalCompositeOperation = 'lighter'
  for (let i = 0; i < 5; i++) {
    const off = (i - 2) * f.w * 0.16
    const hh = f.h * (0.35 + 0.65 * pulse) * (1 - Math.abs(i - 2) * 0.16)
    const grd = g.createLinearGradient(cx + off, base, cx + off, base - hh)
    grd.addColorStop(0, rgba(P.phlogiston, 0.55 * pulse))
    grd.addColorStop(0.55, rgba(P.ember, 0.32 * pulse))
    grd.addColorStop(1, rgba(P.gold, 0))
    g.fillStyle = grd
    g.beginPath()
    g.moveTo(cx + off - f.w * 0.07, base)
    g.quadraticCurveTo(cx + off - f.w * 0.05, base - hh * 0.6, cx + off, base - hh)
    g.quadraticCurveTo(cx + off + f.w * 0.05, base - hh * 0.6, cx + off + f.w * 0.07, base)
    g.closePath()
    g.fill()
  }
  g.restore()
}

/** 燃素试炼门：两根图腾柱 + 火墙 / 灼风柱 */
function drawTrialGate(g, h, info, span, t, scale, toX, toY) {
  const yb = toY(info.y1)
  const yt = toY(info.y1 - 168)
  const gx0 = toX(info.gapX0), gx1 = toX(info.gapX1)
  const isSwing = h.k === 'swingGate'
  const accent = isSwing ? P.soul : P.phlogiston

  // 图腾柱
  for (const px of [gx0 - 14 * scale, gx1 + 14 * scale]) {
    const pw = Math.max(5, 15 * scale)
    const pg = g.createLinearGradient(px - pw / 2, 0, px + pw / 2, 0)
    pg.addColorStop(0, '#2A1C0C')
    pg.addColorStop(0.5, '#6E4C18')
    pg.addColorStop(1, '#2A1C0C')
    g.fillStyle = pg
    roundRect(g, px - pw / 2, yt, pw, yb - yt, pw * 0.28)
    g.fill()
    g.strokeStyle = rgba(P.gold, 0.7)
    g.lineWidth = Math.max(1, 1.5 * scale)
    g.stroke()
    g.save()
    g.globalCompositeOperation = 'lighter'
    const fg = g.createRadialGradient(px, yt, 0, px, yt, 26 * scale)
    fg.addColorStop(0, rgba(span.active ? '#FFF3D0' : P.soul, 0.85))
    fg.addColorStop(1, rgba(accent, 0))
    g.fillStyle = fg
    g.beginPath(); g.arc(px, yt, 26 * scale, 0, TAU); g.fill()
    g.restore()
    soulGlyph(g, px, (yt + yb) / 2, 8 * scale, rgba(P.gold, 0.85), 0.55 + 0.3 * Math.sin(t * 3 + px), 0)
  }

  const x0 = toX(span.x0), x1 = toX(span.x1)
  const hgt = yb - toY(h.y0)
  const w = x1 - x0

  // 地面灼痕
  g.save()
  g.globalCompositeOperation = 'lighter'
  const base = g.createLinearGradient(0, yb - 8 * scale, 0, yb + 12 * scale)
  base.addColorStop(0, rgba(P.phlogiston, 0.25 + 0.45 * span.intensity))
  base.addColorStop(1, rgba(P.phlogiston, 0))
  g.fillStyle = base
  g.fillRect(gx0 - 16 * scale, yb - 8 * scale, (gx1 - gx0) + 32 * scale, 20 * scale)
  g.restore()

  if (span.active) {
    g.save()
    g.globalCompositeOperation = 'lighter'
    const a = 0.4 + 0.6 * span.intensity
    // 幕帘
    const grad = g.createLinearGradient(0, yb, 0, yb - hgt * 1.15)
    grad.addColorStop(0, rgba('#FFF6DC', 0.9 * a))
    grad.addColorStop(0.38, rgba(P.ember, 0.7 * a))
    grad.addColorStop(1, rgba(accent, 0.1 * a))
    g.fillStyle = grad
    g.beginPath()
    g.moveTo(x0, yb)
    const N = 12
    for (let i = 0; i <= N; i++) {
      const px = x0 + (w * i) / N
      g.lineTo(px, yb - hgt * (1.05 + Math.sin(t * 8 + i * 1.3) * 0.18))
    }
    g.lineTo(x1, yb)
    g.closePath()
    g.fill()
    // 火舌
    for (let i = 0; i < 8; i++) {
      const px = x0 + (w * (i + 0.5)) / 8
      const fh = hgt * (0.55 + 0.45 * Math.abs(Math.sin(t * 6.4 + i * 2.1)))
      const fg2 = g.createLinearGradient(0, yb, 0, yb - fh)
      fg2.addColorStop(0, rgba('#FFFAE8', 0.92 * a))
      fg2.addColorStop(0.55, rgba(P.ember, 0.5 * a))
      fg2.addColorStop(1, rgba(P.phlogiston, 0))
      g.fillStyle = fg2
      g.beginPath()
      g.moveTo(px - w * 0.06, yb)
      g.quadraticCurveTo(px - w * 0.022, yb - fh * 0.7, px, yb - fh)
      g.quadraticCurveTo(px + w * 0.022, yb - fh * 0.7, px + w * 0.06, yb)
      g.closePath()
      g.fill()
    }
    g.restore()
  } else {
    // 熄灭：余烬 + 夜魂安全光带
    g.save()
    g.globalCompositeOperation = 'lighter'
    for (let i = 0; i < 7; i++) {
      const px = x0 + (w * (i + 0.5)) / 7
      const rise = ((t * 46 + i * 27) % (hgt * 0.85))
      g.fillStyle = rgba(P.ember, 0.4 * (1 - rise / hgt))
      g.beginPath(); g.arc(px, yb - rise, 1.7 * scale, 0, TAU); g.fill()
    }
    g.restore()
    g.save()
    g.globalAlpha = 0.4 + 0.25 * Math.sin(t * 4.5)
    g.strokeStyle = rgba(P.soul, 0.9)
    g.lineWidth = Math.max(1.2, 1.8 * scale)
    g.setLineDash([7 * scale, 6 * scale])
    g.beginPath(); g.moveTo(x0, yb - 2 * scale); g.lineTo(x1, yb - 2 * scale); g.stroke()
    g.setLineDash([])
    g.restore()
  }
}

/** 终点门 */
function drawFinishGate(g, cx, y, halfW, scale, t) {
  const pillarW = 26 * scale
  const pillarH = 150 * scale
  const glow = 0.6 + 0.4 * Math.sin(t * 2)
  g.save()
  // 光带
  const grd = g.createLinearGradient(cx - halfW, y, cx + halfW, y)
  grd.addColorStop(0, rgba(P.gold, 0))
  grd.addColorStop(0.5, rgba(P.gold, 0.85 * glow))
  grd.addColorStop(1, rgba(P.gold, 0))
  g.fillStyle = grd
  g.fillRect(cx - halfW, y - 3 * scale, halfW * 2, 6 * scale)
  g.globalCompositeOperation = 'lighter'
  g.fillStyle = rgba(P.gold, 0.16 * glow)
  g.fillRect(cx - halfW, y - 26 * scale, halfW * 2, 52 * scale)
  g.globalCompositeOperation = 'source-over'
  // 立柱
  for (const sx of [cx - halfW, cx + halfW]) {
    const p = g.createLinearGradient(sx - pillarW / 2, 0, sx + pillarW / 2, 0)
    p.addColorStop(0, '#2A1C0C')
    p.addColorStop(0.5, '#6B4A16')
    p.addColorStop(1, '#2A1C0C')
    g.fillStyle = p
    roundRect(g, sx - pillarW / 2, y - pillarH, pillarW, pillarH, pillarW * 0.3)
    g.fill()
    g.strokeStyle = rgba(P.gold, 0.6)
    g.lineWidth = Math.max(1, 1.6 * scale)
    g.stroke()
    // 柱顶火焰
    g.globalCompositeOperation = 'lighter'
    const fg = g.createRadialGradient(sx, y - pillarH, 0, sx, y - pillarH, 26 * scale)
    fg.addColorStop(0, rgba('#FFE9B0', 0.95 * glow))
    fg.addColorStop(0.5, rgba(P.phlogiston, 0.5 * glow))
    fg.addColorStop(1, rgba(P.phlogiston, 0))
    g.fillStyle = fg
    g.beginPath(); g.arc(sx, y - pillarH, 26 * scale, 0, TAU); g.fill()
    g.globalCompositeOperation = 'source-over'
  }
  // 横幅
  const bw = halfW * 2
  const bh = 34 * scale
  g.fillStyle = 'rgba(12,8,20,0.92)'
  roundRect(g, cx - halfW, y - pillarH - bh, bw, bh, bh * 0.25)
  g.fill()
  g.strokeStyle = rgba(P.gold, 0.75)
  g.lineWidth = Math.max(1, 1.5 * scale)
  g.stroke()
  g.fillStyle = rgba(P.gold, 0.95)
  g.font = `700 ${Math.round(19 * scale)}px "PingFang SC", system-ui, sans-serif`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText('归 火 圣 夜 巡 礼', cx, y - pillarH - bh / 2 + 1)
  g.restore()
}

// ═══════════════════════════════════════════════════════════════════════════
// 场景渲染
// ═══════════════════════════════════════════════════════════════════════════
function drawScene(g, f) {
  const { cw, ch, course, state, racers, camY, zoom, t, playerIdx, particles, baseScale, phase } = f
  const scale = baseScale * zoom
  const camX = course.W / 2
  const toX = x => (x - camX) * scale + cw / 2
  const toY = y => (y - camY) * scale + ch / 2
  const yTop = camY - ch / (2 * scale) - 200
  const yBot = camY + ch / (2 * scale) + 200
  const depth = clamp(camY / course.height, 0, 1)

  // ── 背景：夜魂天幕 → 燃素熔谷 ──
  const t0 = clamp(depth * 1.15, 0, 0.78)
  const bg = g.createLinearGradient(0, 0, 0, ch)
  bg.addColorStop(0, mixHex('#1B1236', '#4A1408', t0))
  bg.addColorStop(0.42, mixHex('#241847', '#6B2009', t0))
  bg.addColorStop(0.78, mixHex('#2E1B4E', '#8A3208', t0))
  bg.addColorStop(1, mixHex('#3A2158', '#A8460C', t0))
  g.fillStyle = bg
  g.fillRect(0, 0, cw, ch)

  // 井底熔光（越深越亮）
  g.save()
  const hg = g.createRadialGradient(cw / 2, ch * 1.12, 0, cw / 2, ch * 1.12, ch * 0.95)
  hg.addColorStop(0, rgba(P.phlogiston, 0.30 + t0 * 0.34))
  hg.addColorStop(0.45, rgba(P.ember, 0.10 + t0 * 0.12))
  hg.addColorStop(1, rgba(P.ember, 0))
  g.fillStyle = hg
  g.fillRect(0, 0, cw, ch)
  // 井口天光
  const tg = g.createRadialGradient(cw / 2, -ch * 0.25, 0, cw / 2, -ch * 0.25, ch * 0.85)
  tg.addColorStop(0, rgba(P.soul, 0.20 * (1 - t0)))
  tg.addColorStop(1, rgba(P.soul, 0))
  g.fillStyle = tg
  g.fillRect(0, 0, cw, ch)
  g.restore()

  // 背景岩层（视差层理，比竖井更暗，只作为纵深暗示）
  g.save()
  for (let layer = 0; layer < 4; layer++) {
    g.globalAlpha = 0.30 - layer * 0.05
    g.fillStyle = mixHex('#0A0714', '#1C0602', t0 * (0.4 + layer * 0.25))
    const span = 150 + layer * 40
    const off = ((camY * (0.10 + layer * 0.07)) % span + span) % span
    for (let yy = -off; yy < ch + span; yy += span) {
      const hh = 34 + layer * 16
      g.beginPath()
      g.moveTo(-10, yy)
      for (let x = -10; x <= cw + 10; x += 70) {
        g.lineTo(x, yy + Math.sin(x * 0.012 + layer * 1.7 + camY * 0.0016) * 16)
      }
      g.lineTo(cw + 10, yy + hh)
      for (let x = cw + 10; x >= -10; x -= 70) {
        g.lineTo(x, yy + hh + Math.sin(x * 0.010 + layer) * 14)
      }
      g.closePath()
      g.fill()
    }
  }
  g.globalAlpha = 1
  g.restore()

  // 上升余烬
  g.save()
  g.globalCompositeOperation = 'lighter'
  for (let i = 0; i < 40; i++) {
    const span = ch + 200
    const spd = 20 + (i % 6) * 13
    const raw = (i * 71.3 + t * spd - camY * 0.22) % span
    const py = ch + 100 - (raw < 0 ? raw + span : raw)
    const px = ((i * 137.9 + Math.sin(t * 0.6 + i) * 26) % cw + cw) % cw
    const a = (0.25 + 0.55 * ((i % 7) / 7)) * (py / ch)
    g.fillStyle = rgba(i % 4 === 0 ? P.gold : P.phlogiston, a * 0.8)
    g.beginPath()
    g.arc(px, py, 0.9 + (i % 3) * 0.8, 0, TAU)
    g.fill()
  }
  g.restore()

  // 夜魂星尘（越靠近地面越稀疏）
  const starA = (1 - depth) * 0.9
  if (starA > 0.02) {
    g.save()
    for (let i = 0; i < 46; i++) {
      const sx = ((i * 137.5) % cw)
      const sy = ((i * 91.7 - camY * 0.06) % ch + ch) % ch
      const tw = 0.4 + 0.6 * Math.abs(Math.sin(t * 0.9 + i))
      drawStar(g, sx, sy, 1.1 + (i % 3) * 0.7, i % 5 === 0 ? P.soul : '#CFE6FF', starA * tw * 0.75)
    }
    g.restore()
  }

  // ── 竖井两侧岩壁 ──
  const wallPx = Math.max(12, RACE.wallThickness * scale)
  const x0 = toX(0)
  const x1 = toX(course.W)
  for (const [wx, dir] of [[x0, -1], [x1, 1]]) {
    const grd = g.createLinearGradient(wx, 0, wx + dir * wallPx, 0)
    grd.addColorStop(0, '#4A3568')
    grd.addColorStop(0.35, '#2E2049')
    grd.addColorStop(1, '#150E26')
    g.fillStyle = grd
    g.fillRect(dir < 0 ? wx - wallPx : wx, 0, wallPx, ch)
    // 岩层横纹
    g.save()
    const bandOff = ((camY * 0.9) % 46 + 46) % 46
    g.strokeStyle = 'rgba(255,255,255,0.05)'
    g.lineWidth = 1
    for (let yy = -bandOff; yy < ch + 46; yy += 46) {
      g.beginPath()
      g.moveTo(dir < 0 ? wx - wallPx : wx, yy)
      g.lineTo(wx, yy + 12)
      g.stroke()
    }
    g.restore()
    // 内侧发光缝（燃素）
    const seam = 0.45 + 0.25 * Math.sin(t * 1.4 + (dir > 0 ? 1.6 : 0))
    g.fillStyle = rgba(P.phlogiston, seam)
    g.fillRect(dir < 0 ? wx - 3 : wx, 0, 3, ch)
    g.fillStyle = rgba('#FFE6C0', 0.75)
    g.fillRect(dir < 0 ? wx - 1.5 : wx, 0, 1.5, ch)
    // 部落纹
    tribalBand(g, dir < 0 ? wx - wallPx * 0.78 : wx + wallPx * 0.78, -20, ch + 20, wallPx * 0.46,
      rgba(P.gold, 0.5), 0.6, dir < 0 ? 1 : -1)
    tribalBand(g, dir < 0 ? wx - wallPx * 0.3 : wx + wallPx * 0.3, -20, ch + 20, wallPx * 0.2,
      rgba(P.soul, 0.42), 0.45, dir < 0 ? -1 : 1)
    // 夜魂符印（每层一个）
    for (const ci of course.chambersInfo) {
      const gy = ci.y0 + (ci.y1 - ci.y0) * 0.5
      if (gy < yTop || gy > yBot) continue
      const col = [P.soul, P.gold, P.phlogiston, P.violet][ci.theme % 4]
      soulGlyph(g, dir < 0 ? wx - wallPx * 0.52 : wx + wallPx * 0.52, toY(gy), wallPx * 0.3,
        rgba(col, 0.9), 0.5 + 0.4 * Math.sin(t * 1.6 + ci.index), t * 0.25 * dir)
    }
  }

  // ── 层号刻度 ──
  g.save()
  g.font = `600 ${Math.round(Math.max(9, 11 * scale))}px "PingFang SC", system-ui, sans-serif`
  g.textAlign = 'right'
  g.textBaseline = 'middle'
  for (const ci of course.chambersInfo) {
    const gy = ci.y0 + 26
    if (gy < yTop || gy > yBot) continue
    const sx = toX(course.W) + wallPx * 1.15
    if (sx > cw - 6) continue
    g.fillStyle = rgba(P.gold, 0.4)
    g.fillText(`${ci.index + 1}`, sx, toY(gy))
  }
  g.restore()

  // ── 力场（球之后面）──
  for (const fl of course.fields) {
    if (fl.y + fl.h < yTop || fl.y > yBot) continue
    if (fl.look === 'jet') drawJet(g, { ...fl, x: toX(fl.x), y: toY(fl.y), w: fl.w * scale, h: fl.h * scale }, t, scale)
    else drawWindField(g, { ...fl, x: toX(fl.x), y: toY(fl.y), w: fl.w * scale, h: fl.h * scale }, t, scale)
  }

  // ── 静态碰撞体 ──
  for (const c of course.statics) {
    if (c.k === 'seg') {
      const my = (c.ay + c.by) / 2
      if (my < yTop || my > yBot) continue
      const sx1 = toX(c.ax), sy1 = toY(c.ay), sx2 = toX(c.bx), sy2 = toY(c.by)
      if (c.look === 'wall') {
        continue
      } else if (c.look === 'tramp') {
        drawTramp(g, sx1, sy1, sx2, sy2, c.rad * scale, scale, t)
      } else if (c.look === 'belt') {
        drawBelt(g, sx1, sy1, sx2, sy2, c.rad * scale, c.svel, t)
      } else {
        const look = c.look
        const w = Math.max(3, c.rad * 2 * scale)
        const bodyCol = look === 'basin' ? '#3A2430'
          : look === 'housing' ? '#2A2440'
          : look === 'chute' ? '#2C2A48'
          : look === 'kicker' ? '#3A2A18'
          : look === 'hopper' ? '#2E2440'
          : '#33264A'
        g.lineCap = 'round'
        g.strokeStyle = bodyCol
        g.lineWidth = w
        g.beginPath(); g.moveTo(sx1, sy1); g.lineTo(sx2, sy2); g.stroke()
        const ddx = sx2 - sx1, ddy = sy2 - sy1
        const l = Math.hypot(ddx, ddy) || 1
        let nx = -ddy / l, ny = ddx / l
        if (ny > 0) { nx = -nx; ny = -ny }
        const th = themeOf(c.theme)
        if (look === 'housing') {
          // 机壳：金属板 + 铆钉条纹
          g.strokeStyle = rgba(th.a, 0.28)
          g.lineWidth = Math.max(1, w * 0.16)
          g.beginPath()
          g.moveTo(sx1 + nx * w * 0.42, sy1 + ny * w * 0.42)
          g.lineTo(sx2 + nx * w * 0.42, sy2 + ny * w * 0.42)
          g.stroke()
          g.strokeStyle = rgba(th.b, 0.4)
          g.lineWidth = Math.max(1, w * 0.2)
          g.setLineDash([5 * scale, 7 * scale])
          g.beginPath(); g.moveTo(sx1, sy1); g.lineTo(sx2, sy2); g.stroke()
          g.setLineDash([])
        } else if (look === 'kicker') {
          // 弹射台：弹簧纹 + 燃素核心
          g.strokeStyle = rgba(P.gold, 0.85)
          g.lineWidth = Math.max(1, w * 0.24)
          g.beginPath()
          g.moveTo(sx1 + nx * w * 0.4, sy1 + ny * w * 0.4)
          g.lineTo(sx2 + nx * w * 0.4, sy2 + ny * w * 0.4)
          g.stroke()
          g.save()
          g.globalCompositeOperation = 'lighter'
          const kg = g.createRadialGradient((sx1 + sx2) / 2, (sy1 + sy2) / 2, 0, (sx1 + sx2) / 2, (sy1 + sy2) / 2, 46 * scale)
          kg.addColorStop(0, rgba(P.phlogiston, 0.5 + 0.3 * Math.sin(t * 5)))
          kg.addColorStop(1, rgba(P.phlogiston, 0))
          g.fillStyle = kg
          g.beginPath(); g.arc((sx1 + sx2) / 2, (sy1 + sy2) / 2, 46 * scale, 0, TAU); g.fill()
          g.restore()
        } else {
          g.strokeStyle = look === 'floor' ? rgba(P.gold, 0.95)
            : look === 'chute' ? rgba(th.a, 0.85)
            : look === 'hopper' ? rgba(th.a, 0.8)
            : rgba(P.ember, 0.75)
          g.lineWidth = Math.max(1, w * 0.22)
          g.beginPath()
          g.moveTo(sx1 + nx * w * 0.38, sy1 + ny * w * 0.38)
          g.lineTo(sx2 + nx * w * 0.38, sy2 + ny * w * 0.38)
          g.stroke()
          g.strokeStyle = rgba(th.b, look === 'chute' ? 0.28 : 0.4)
          g.lineWidth = Math.max(1, w * 0.18)
          g.beginPath()
          g.moveTo(sx1 - nx * w * 0.42, sy1 - ny * w * 0.42)
          g.lineTo(sx2 - nx * w * 0.42, sy2 - ny * w * 0.42)
          g.stroke()
        }
      }
    } else if (c.k === 'cir') {
      if (c.y < yTop || c.y > yBot) continue
      if (c.look === 'fanbody') drawFanBody(g, toX(c.x), toY(c.y), c.r * scale, c.x < course.W / 2 ? 1 : -1, t, scale)
      else drawKnob(g, toX(c.x), toY(c.y), c.r * scale, c.look, t)
    }
  }

  // ── 装饰件 ──
  if (course.decor) {
    for (const d of course.decor) {
      if (d.y < yTop || d.y > yBot) continue
      const dx = toX(d.x), dy = toY(d.y)
      if (d.k === 'banner') {
        const bw = 24 * scale, bh = 52 * scale
        g.fillStyle = 'rgba(22,12,32,0.92)'
        g.beginPath()
        g.moveTo(dx - bw / 2, dy); g.lineTo(dx + bw / 2, dy); g.lineTo(dx, dy + bh); g.closePath()
        g.fill()
        g.strokeStyle = rgba(P.gold, 0.75)
        g.lineWidth = Math.max(1, 1.3 * scale)
        g.stroke()
        soulGlyph(g, dx, dy + bh * 0.44, bw * 0.2, rgba(P.soul, 0.85), 0.75, t * 0.4)
      } else if (d.k === 'spark') {
        drawStar(g, dx, dy, 2.6 * scale * s0(d, scale), rgba(P.gold, 0.45 + 0.4 * Math.sin(t * 3 + d.phase)), 1)
      } else if (d.k === 'rune' || d.k === 'rail') {
        soulGlyph(g, dx, dy, 10 * scale * (d.s || 1), rgba(P.soul, 0.3), 0.3 + 0.18 * Math.sin(t * 1.5 + d.phase), t * 0.25)
      }
    }
  }

  // ── 运动学机关 ──
  for (const k of state.kin) {
    const d = k.d
    const parts = k.parts
    let visible = false
    for (const p of parts) {
      const py = p.k === 'seg' ? (p.ay + p.by) / 2 : p.y
      if (py > yTop && py < yBot) { visible = true; break }
    }
    if (!visible) continue
    if (d.k === 'gear') {
      drawGearBody(g, toX(d.x), toY(d.y), d.r, d.teeth, d.toothLen, d.phase + d.omega * t, scale)
    } else if (d.k === 'pendulum') {
      const chain = parts[0]
      const bob = parts[1]
      g.save()
      g.strokeStyle = rgba(P.gold, 0.55)
      g.lineWidth = Math.max(1.4, 3 * scale)
      g.setLineDash([6 * scale, 5 * scale])
      g.beginPath(); g.moveTo(toX(chain.ax), toY(chain.ay)); g.lineTo(toX(chain.bx), toY(chain.by)); g.stroke()
      g.setLineDash([])
      g.restore()
      const bx = toX(bob.x), by = toY(bob.y), br = bob.r * scale
      g.save()
      g.globalCompositeOperation = 'lighter'
      const hg = g.createRadialGradient(bx, by, br * 0.3, bx, by, br * 2.2)
      hg.addColorStop(0, rgba(P.phlogiston, 0.55))
      hg.addColorStop(1, rgba(P.phlogiston, 0))
      g.fillStyle = hg
      g.beginPath(); g.arc(bx, by, br * 2.2, 0, TAU); g.fill()
      g.restore()
      drawKnob(g, bx, by, br, 'bumper', t)
      g.strokeStyle = rgba(P.ember, 0.9)
      g.lineWidth = Math.max(1.4, 2.4 * scale)
      g.beginPath(); g.arc(bx, by, br * 0.66, 0, TAU); g.stroke()
    } else if (d.k === 'rotor') {
      g.save()
      g.lineCap = 'round'
      for (const p of parts) {
        g.strokeStyle = '#2C2144'
        g.lineWidth = Math.max(3, p.rad * 2 * scale)
        g.beginPath(); g.moveTo(toX(p.ax), toY(p.ay)); g.lineTo(toX(p.bx), toY(p.by)); g.stroke()
        g.strokeStyle = rgba(P.soul, 0.85)
        g.lineWidth = Math.max(1, p.rad * 0.5 * scale)
        g.beginPath(); g.moveTo(toX(p.ax), toY(p.ay)); g.lineTo(toX(p.bx), toY(p.by)); g.stroke()
      }
      g.restore()
      const hx = toX(d.x), hy = toY(d.y)
      g.fillStyle = rgba(P.gold, 0.9)
      g.beginPath(); g.arc(hx, hy, Math.max(3, 9 * scale), 0, TAU); g.fill()
      g.fillStyle = rgba(P.phlogiston, 0.9)
      g.beginPath(); g.arc(hx, hy, Math.max(1.5, 4 * scale), 0, TAU); g.fill()
    } else if (d.k === 'flapper') {
      const p0 = parts[0]
      const dx1 = toX(p0.ax), dy1 = toY(p0.ay), dx2 = toX(p0.bx), dy2 = toY(p0.by)
      g.save()
      g.lineCap = 'round'
      g.strokeStyle = '#4A3A20'
      g.lineWidth = Math.max(5, p0.rad * 2.6 * scale)
      g.beginPath(); g.moveTo(dx1, dy1); g.lineTo(dx2, dy2); g.stroke()
      g.strokeStyle = rgba(themeOf(d.theme).a, 0.92)
      g.lineWidth = Math.max(1.5, p0.rad * 0.5 * scale)
      g.beginPath(); g.moveTo(dx1, dy1); g.lineTo(dx2, dy2); g.stroke()
      // 警示斜纹
      g.save()
      g.beginPath(); g.moveTo(dx1, dy1); g.lineTo(dx2, dy2)
      g.lineWidth = Math.max(3, p0.rad * 1.1 * scale)
      g.strokeStyle = 'rgba(0,0,0,0)'
      g.setLineDash([4 * scale, 9 * scale])
      g.lineDashOffset = -((t * 26) % 13)
      g.strokeStyle = rgba(P.phlogiston, 0.75)
      g.stroke()
      g.restore()
      // 枢轴
      g.fillStyle = rgba(P.gold, 0.95)
      g.beginPath(); g.arc(dx1, dy1, Math.max(3, p0.rad * 0.9 * scale), 0, TAU); g.fill()
      g.restore()
    } else if (d.k === 'slider') {
      const p = parts[0]
      const sx1 = toX(p.ax), sy1 = toY(p.ay), sx2 = toX(p.bx), sy2 = toY(p.by)
      // 滑轨
      const oa = toX(d.ax), ob = toY(d.ay)
      g.save()
      g.strokeStyle = rgba(P.soul, 0.22)
      g.lineWidth = Math.max(1, 2 * scale)
      g.setLineDash([5 * scale, 6 * scale])
      const span = d.axis === 'x' ? d.amp * scale : d.amp * scale
      g.beginPath()
      if (d.axis === 'x') { g.moveTo(oa - span, ob); g.lineTo(oa + span, ob) }
      else { g.moveTo(oa, ob - span); g.lineTo(oa, ob + span) }
      g.stroke()
      g.setLineDash([])
      g.restore()
      const w = Math.max(4, p.rad * 2 * scale)
      g.lineCap = 'round'
      g.strokeStyle = '#2A2040'
      g.lineWidth = w
      g.beginPath(); g.moveTo(sx1, sy1); g.lineTo(sx2, sy2); g.stroke()
      g.strokeStyle = rgba(P.soul, 0.9)
      g.lineWidth = Math.max(1, w * 0.24)
      g.beginPath(); g.moveTo(sx1, sy1); g.lineTo(sx2, sy2); g.stroke()
    }
  }

  // ── 燃素试炼门 ──
  if (course.hazards) {
    for (const h of course.hazards) {
      if (h.y1 < yTop || h.y0 > yBot) continue
      const info = course.chambersInfo[h.chamber]
      if (!info) continue
      drawTrialGate(g, h, info, hazardSpan(h, t), t, scale, toX, toY)
    }
  }

  // ── 终点门 ──
  if (course.finishY > yTop && course.finishY < yBot) {
    drawFinishGate(g, toX(course.W / 2), toY(course.finishY), course.W * 0.44 * scale, scale, t)
  }

  // ── 起跑门（顶部）──
  if (course.spawn.y > yTop - 300 && course.spawn.y < yBot) {
    const gy = toY(course.spawn.y - 74)
    g.save()
    g.strokeStyle = rgba(P.soul, 0.5)
    g.lineWidth = Math.max(2, 3 * scale)
    g.beginPath()
    g.moveTo(toX(0), gy); g.lineTo(toX(course.W), gy)
    g.stroke()
    for (let i = 0; i < 7; i++) {
      soulGlyph(g, toX(course.spawn.xs[i]), gy - 22 * scale, 9 * scale, rgba(P.gold, 0.6), 0.5, t * 0.6)
    }
    g.restore()
  }

  // ── 球 ──
  for (let i = 0; i < racers.length; i++) {
    const b = state.balls[i]
    const r = racers[i]
    if (!b || !r) continue
    const bx = toX(b.x)
    const by = toY(b.y)
    const br = Math.max(4, b.r * scale)
    if (by < -160 || by > ch + 160) continue
    const isPlayer = i === playerIdx

    // 拖尾
    const tr = r.trail
    if (tr && tr.length > 1) {
      g.save()
      g.globalCompositeOperation = 'lighter'
      g.lineCap = 'round'
      for (let k = 1; k < tr.length; k++) {
        const a = (k / tr.length) * 0.26
        g.strokeStyle = rgba(r.color, a)
        g.lineWidth = br * 1.05 * (k / tr.length)
        g.beginPath()
        g.moveTo(toX(tr[k - 1].x), toY(tr[k - 1].y))
        g.lineTo(toX(tr[k].x), toY(tr[k].y))
        g.stroke()
      }
      g.restore()
    }

    // 光晕
    g.save()
    g.globalCompositeOperation = 'lighter'
    const pulse = isPlayer ? 0.55 + 0.25 * Math.sin(t * 4) : 0.3
    const gl = g.createRadialGradient(bx, by, br * 0.5, bx, by, br * (isPlayer ? 3.2 : 2.3))
    gl.addColorStop(0, rgba(r.color, pulse))
    gl.addColorStop(0.45, rgba(r.color, pulse * 0.35))
    gl.addColorStop(1, rgba(r.color, 0))
    g.fillStyle = gl
    g.beginPath(); g.arc(bx, by, br * (isPlayer ? 3.2 : 2.3), 0, TAU); g.fill()
    // 夜魂环
    g.strokeStyle = rgba(r.color2, 0.5 + 0.3 * Math.sin(t * 3 + i))
    g.lineWidth = Math.max(1, 1.6 * scale)
    g.beginPath()
    g.ellipse(bx, by, br * 1.9, br * 0.7, 0, 0, TAU)
    g.stroke()
    g.restore()

    // 球体
    g.save()
    g.beginPath(); g.arc(bx, by, br, 0, TAU); g.clip()
    const body = g.createRadialGradient(bx - br * 0.35, by - br * 0.4, br * 0.15, bx, by, br)
    body.addColorStop(0, '#3A3050')
    body.addColorStop(1, '#100A1E')
    g.fillStyle = body
    g.fillRect(bx - br, by - br, br * 2, br * 2)
    // 头像
    if (r.img) {
      g.save()
      g.translate(bx, by)
      g.rotate(b.angle || 0)
      const s = br * 1.92
      try { g.drawImage(r.img, -s / 2, -s / 2, s, s) } catch (_) { /* 图像未就绪 */ }
      g.restore()
    } else {
      g.fillStyle = rgba(r.color, 0.85)
      g.font = `700 ${Math.round(br * 1.05)}px "PingFang SC", system-ui, sans-serif`
      g.textAlign = 'center'; g.textBaseline = 'middle'
      g.fillText((r.short || '?'), bx, by)
    }
    // 球面明暗
    const shade = g.createRadialGradient(bx - br * 0.35, by - br * 0.42, br * 0.1, bx, by, br * 1.05)
    shade.addColorStop(0, 'rgba(255,255,255,0.16)')
    shade.addColorStop(0.45, 'rgba(0,0,0,0)')
    shade.addColorStop(0.82, 'rgba(0,0,0,0.42)')
    shade.addColorStop(1, 'rgba(0,0,0,0.72)')
    g.fillStyle = shade
    g.fillRect(bx - br, by - br, br * 2, br * 2)
    g.restore()

    // 元素外环
    g.strokeStyle = rgba(r.color, 0.95)
    g.lineWidth = Math.max(1.4, br * 0.16)
    g.beginPath(); g.arc(bx, by, br, 0, TAU); g.stroke()
    g.strokeStyle = rgba(r.color2, 0.6)
    g.lineWidth = Math.max(1, br * 0.07)
    g.beginPath(); g.arc(bx, by, br * 1.14, 0, TAU); g.stroke()

    // 玩家标记
    if (isPlayer) {
      g.save()
      g.translate(bx, by)
      g.rotate(t * 1.2)
      g.strokeStyle = rgba(P.gold, 0.95)
      g.lineWidth = Math.max(1.6, 2.2 * scale)
      g.setLineDash([6 * scale, 6 * scale])
      g.beginPath(); g.arc(0, 0, br * 1.62, 0, TAU); g.stroke()
      g.setLineDash([])
      g.restore()
      // 王冠
      const cw2 = br * 0.9
      g.fillStyle = rgba(P.gold, 0.98)
      g.beginPath()
      g.moveTo(bx - cw2, by - br * 1.5)
      g.lineTo(bx - cw2 * 0.5, by - br * 2.1)
      g.lineTo(bx, by - br * 1.5)
      g.lineTo(bx + cw2 * 0.5, by - br * 2.1)
      g.lineTo(bx + cw2, by - br * 1.5)
      g.closePath()
      g.fill()
      // 名牌
      const tag = r.name
      g.font = `700 ${Math.round(Math.max(9, 11 * scale))}px "PingFang SC", system-ui, sans-serif`
      const tw = g.measureText(tag).width + 14 * scale
      const th = 18 * scale
      g.fillStyle = 'rgba(10,7,20,0.85)'
      roundRect(g, bx - tw / 2, by - br * 2.1 - th - 6 * scale, tw, th, th * 0.4)
      g.fill()
      g.strokeStyle = rgba(P.gold, 0.6)
      g.lineWidth = Math.max(1, scale)
      g.stroke()
      g.fillStyle = rgba(P.gold, 1)
      g.textAlign = 'center'; g.textBaseline = 'middle'
      g.fillText(tag, bx, by - br * 2.1 - th / 2 - 6 * scale + 0.5)
    }

    // 撞击火花
    if (b.hitPower > 0.12) {
      drawStar(g, bx, by, br * (0.6 + b.hitPower), rgba('#FFF3D0', 0.55 * b.hitPower), 1)
    }
    // 夜魂佑护闪光
    if (b.assistFlash > 0.05) {
      g.save()
      g.globalCompositeOperation = 'lighter'
      const ag = g.createRadialGradient(bx, by, 0, bx, by, br * 5 * b.assistFlash)
      ag.addColorStop(0, rgba(P.soul, 0.7 * b.assistFlash))
      ag.addColorStop(1, rgba(P.soul, 0))
      g.fillStyle = ag
      g.beginPath(); g.arc(bx, by, br * 5 * b.assistFlash, 0, TAU); g.fill()
      g.restore()
    }
  }

  // ── 前景粒子 ──
  if (particles && particles.length) {
    g.save()
    g.globalCompositeOperation = 'lighter'
    for (const p of particles) {
      const a = clamp(p.life / p.max, 0, 1)
      g.fillStyle = rgba(p.color, a * 0.85)
      g.beginPath()
      g.arc(toX(p.x), toY(p.y), Math.max(0.8, p.r * scale * a), 0, TAU)
      g.fill()
    }
    g.restore()
  }

  // ── 屏幕空间：暗角 ──
  const vg = g.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * 0.35, cw / 2, ch / 2, Math.max(cw, ch) * 0.75)
  vg.addColorStop(0, 'rgba(0,0,0,0)')
  vg.addColorStop(1, 'rgba(0,0,0,0.42)')
  g.fillStyle = vg
  g.fillRect(0, 0, cw, ch)

  // ── 出屏指示 ──
  for (let i = 0; i < racers.length; i++) {
    const b = state.balls[i]
    if (!b) continue
    const sy = toY(b.y)
    if (sy >= -20 && sy <= ch + 20) continue
    const down = sy > ch
    const px = clamp(toX(b.x), 16, cw - 16)
    const py = down ? ch - 16 : 16
    g.save()
    g.globalAlpha = 0.85
    g.fillStyle = rgba(racers[i].color, 0.95)
    g.beginPath()
    if (down) { g.moveTo(px, py + 8); g.lineTo(px - 7, py - 4); g.lineTo(px + 7, py - 4) }
    else { g.moveTo(px, py - 8); g.lineTo(px - 7, py + 4); g.lineTo(px + 7, py + 4) }
    g.closePath()
    g.fill()
    g.restore()
  }

}

// ═══════════════════════════════════════════════════════════════════════════
// 主组件
// ═══════════════════════════════════════════════════════════════════════════
export default function NightsoulRace() {
  const { query, readImage } = useDb()

  const [phase, setPhase] = useState('setup')     // setup | countdown | racing | result
  const [countdown, setCountdown] = useState(3)
  const [allChars, setAllChars] = useState([])
  const [pool, setPool] = useState([])            // 本局 7 位角色
  const [poolImgs, setPoolImgs] = useState({})    // filename → dataURL
  const [selected, setSelected] = useState(0)     // 玩家选中的球
  const [pickerOpen, setPickerOpen] = useState(false)
  const [hud, setHud] = useState(null)
  const [speed, setSpeed] = useState(1)
  const [paused, setPaused] = useState(false)
  const [results, setResults] = useState(null)
  const [courseInfo, setCourseInfo] = useState(null)
  const [toast, setToast] = useState(null)
  const [seed, setSeed] = useState(() => (Math.random() * 1e9) | 0)

  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  const sizeRef = useRef({ w: 900, h: 640, dpr: 1 })
  const stateRef = useRef(null)
  const courseRef = useRef(null)
  const racersRef = useRef([])
  const camRef = useRef({ y: 0, zoom: 1, init: false })
  const timeRef = useRef(0)
  const particlesRef = useRef([])
  const rafRef = useRef(0)
  const phaseRef = useRef(phase)
  const speedRef = useRef(speed)
  const pausedRef = useRef(paused)
  const resultTimerRef = useRef(0)
  const imgCacheRef = useRef(new Map())
  const selectedRef = useRef(selected)
  const prevPenaltyRef = useRef([])
  const prevReworkRef = useRef([])
  const prevCatchUpRef = useRef([])
  const drawErrRef = useRef(null)
  const toastTimerRef = useRef(0)

  useEffect(() => { phaseRef.current = phase }, [phase])
  useEffect(() => { selectedRef.current = selected }, [selected])
  useEffect(() => { speedRef.current = speed }, [speed])
  useEffect(() => { pausedRef.current = paused }, [paused])

  // ── 角色库 ──────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await query(
          "SELECT id, name_zh, element_id, card_art, rarity FROM characters WHERE card_art IS NOT NULL AND card_art <> '' ORDER BY rarity DESC, id"
        )
        const list = r.data || []
        if (!cancelled) setAllChars(list.length >= 7 ? list : FALLBACK_CHARS)
      } catch (_) {
        // 浏览器模式无数据库 → 用兜底角色
        if (!cancelled) setAllChars(FALLBACK_CHARS)
      }
    })()
    return () => { cancelled = true }
  }, [query])

  const getUrl = useCallback(async (filename) => {
    if (!filename) return null
    const cache = imgCacheRef.current
    if (cache.has(filename)) return cache.get(filename)
    const url = await readImage(filename, 160, 'high')
    cache.set(filename, url || null)
    return url || null
  }, [readImage])

  // 本局 7 位角色的头像
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const map = {}
      await Promise.all(pool.map(async c => {
        const u = await getUrl(c.card_art)
        if (u) map[c.card_art] = u
      }))
      if (!cancelled) setPoolImgs(map)
    })()
    return () => { cancelled = true }
  }, [pool, getUrl])

  const rollPool = useCallback((chars) => {
    const src = chars || allChars
    if (!src.length) return
    const arr = [...src]
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
    }
    setPool(arr.slice(0, 7))
    setSelected(0)
  }, [allChars])

  // 首次拿到角色库后自动抽一批
  useEffect(() => {
    if (allChars.length >= 7 && pool.length === 0) rollPool(allChars)
  }, [allChars, pool.length, rollPool])

  const elemOf = useCallback((c) => ELEM[c?.element_id] || ELEM_FALLBACK, [])

  // ── 尺寸自适应 ──────────────────────────────────────────────────────────
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const apply = () => {
      const rect = el.getBoundingClientRect()
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      sizeRef.current = { w: Math.max(320, rect.width), h: Math.max(280, rect.height), dpr }
      const cv = canvasRef.current
      if (cv) {
        cv.width = Math.round(sizeRef.current.w * dpr)
        cv.height = Math.round(sizeRef.current.h * dpr)
        cv.style.width = sizeRef.current.w + 'px'
        cv.style.height = sizeRef.current.h + 'px'
      }
      camRef.current.init = false
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => ro.disconnect()
  }, [phase])

  // ── 开局 ────────────────────────────────────────────────────────────────
  const beginRace = useCallback(async (curSeed) => {
    if (pool.length < 7) return
    const s = curSeed ?? ((Math.random() * 1e9) | 0)
    setSeed(s)
    const course = generateCourse({ seed: s })
    courseRef.current = course
    setCourseInfo({
      chambers: course.chambers,
      height: Math.round(course.height),
      kinds: [...new Set(course.chambersInfo.flatMap(c => c.tags))].length,
    })

    const defs = pool.map((c, i) => ({
      name: c.name_zh || `球${i + 1}`,
      r: RACE.ballRadius + (i % 3) * 0.4,
      dragScale: 1 + (i - 3) * 0.012,
    }))
    const state = createRace(course, defs)
    stateRef.current = state
    timeRef.current = 0
    particlesRef.current = []
    camRef.current.init = false

    const racers = await Promise.all(pool.map(async (c, i) => {
      const el = elemOf(c)
      const url = poolImgs[c.card_art] || await getUrl(c.card_art)
      const img = url ? await loadImageEl(url) : null
      return {
        name: c.name_zh || `球${i + 1}`,
        short: (c.name_zh || '?').slice(0, 1),
        elem: el,
        color: el.c,
        color2: el.c2,
        img,
        trail: [],
        idx: i,
      }
    }))
    racersRef.current = racers
    setResults(null)
    setHud(null)
    setPaused(false)
    setSpeed(1)
    setCountdown(3)
    setPhase('countdown')
  }, [pool, poolImgs, elemOf, getUrl])

  // 倒计时
  useEffect(() => {
    if (phase !== 'countdown') return
    if (countdown <= 0) {
      const id = setTimeout(() => setPhase('racing'), 520)
      return () => clearTimeout(id)
    }
    const id = setTimeout(() => setCountdown(c => c - 1), 760)
    return () => clearTimeout(id)
  }, [phase, countdown])

  // ── 主循环 ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'racing' && phase !== 'countdown') return
    let alive = true
    let last = performance.now()
    let lastHud = 0
    const STEP = 1 / 60

    const frame = (now) => {
      if (!alive) return
      rafRef.current = requestAnimationFrame(frame)
      try {
        frameBody(now)
      } catch (err) {
        // 单帧异常不能让画面永久冻结：记录一次并继续下一帧
        if (!drawErrRef.current) {
          drawErrRef.current = String(err && err.message || err)
          console.error('[nightsoulrace] frame error:', err)
        }
      }
    }
    const frameBody = (now) => {
      const st = stateRef.current
      const course = courseRef.current
      const cv = canvasRef.current
      if (!st || !course || !cv) return
      const dtReal = Math.min(0.06, Math.max(0, (now - last) / 1000))
      last = now
      const { w, h, dpr } = sizeRef.current

      // 物理推进
      if (phaseRef.current === 'racing' && !pausedRef.current && !st.over) {
        const dtSim = dtReal * speedRef.current
        const n = Math.max(1, Math.min(24, Math.ceil(dtSim / STEP)))
        const dt = dtSim / n
        for (let i = 0; i < n; i++) stepRace(st, dt)
        timeRef.current = st.t
      }
      const t = timeRef.current

      // 拖尾采样
      const racers = racersRef.current
      for (let i = 0; i < racers.length; i++) {
        const b = st.balls[i]
        const r = racers[i]
        if (!b || !r) continue
        const tr = r.trail
        const lastP = tr[tr.length - 1]
        if (!lastP || Math.hypot(lastP.x - b.x, lastP.y - b.y) > 14) {
          tr.push({ x: b.x, y: b.y })
          if (tr.length > 16) tr.shift()
        }
      }

      // 粒子
      const parts = particlesRef.current
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i]
        p.life -= dtReal
        p.x += p.vx * dtReal
        p.y += p.vy * dtReal
        p.vy -= 120 * dtReal
        if (p.life <= 0) parts.splice(i, 1)
      }
      // 追赶放行：领先者拉开两关时，落后层的球被夜魂直接送进下一层
      if (prevCatchUpRef.current.length !== st.balls.length) {
        prevCatchUpRef.current = st.balls.map(b => b.catchUpFlash)
      }
      for (let i = 0; i < st.balls.length; i++) {
        const b = st.balls[i]
        if (b.catchUpFlash > 0.9 && prevCatchUpRef.current[i] <= 0.9) {
          prevCatchUpRef.current[i] = b.catchUpFlash
          for (let k = 0; k < 10; k++) {
            parts.push({
              x: b.x, y: b.y,
              vx: (Math.random() - 0.5) * 160, vy: 40 + Math.random() * 160,
              r: 1.4 + Math.random() * 2,
              life: 0.3 + Math.random() * 0.3, max: 0.6,
              color: P.soul,
            })
          }
          if (i === selectedRef.current && phaseRef.current === 'racing') {
            setToast({ id: Date.now(), text: '领先者已拉开两关，夜魂佑护将你的球直接送入下一关' })
            toastTimerRef.current = now + 2600
          }
        }
      }

      // 流水线回送：弹射火花（机器把球抛回本层起点）
      if (prevReworkRef.current.length !== st.balls.length) {
        prevReworkRef.current = st.balls.map(b => b.relaunches)
      }
      for (let i = 0; i < st.balls.length; i++) {
        const b = st.balls[i]
        if (b.relaunches > prevReworkRef.current[i]) {
          prevReworkRef.current[i] = b.relaunches
          for (let k = 0; k < 14; k++) {
            parts.push({
              x: b.x, y: b.y,
              vx: (Math.random() - 0.5) * 320,
              vy: -Math.random() * 260 - 40,
              r: 1.5 + Math.random() * 2.4,
              life: 0.35 + Math.random() * 0.4, max: 0.75,
              color: Math.random() < 0.5 ? P.soul : '#FFE9B0',
            })
          }
          if (i === selectedRef.current && phaseRef.current === 'racing') {
            const ch = courseRef.current.chambersInfo[b.relaunchChamber ?? 0]
            setToast({ id: Date.now(), text: `你的球被判不合格，流水线回送至第 ${(ch?.index ?? 0) + 1} 层入口` })
            toastTimerRef.current = now + 2400
          }
        }
      }

      // 灼烧惩罚：火花 + 提示
      if (prevPenaltyRef.current.length !== st.balls.length) {
        prevPenaltyRef.current = st.balls.map(b => b.penalties)
      }
      for (let i = 0; i < st.balls.length; i++) {
        const b = st.balls[i]
        if (b.penalties > prevPenaltyRef.current[i]) {
          prevPenaltyRef.current[i] = b.penalties
          for (let k = 0; k < 26; k++) {
            parts.push({
              x: b.lastPenaltyX || b.x, y: b.lastPenaltyY || b.y,
              vx: (Math.random() - 0.5) * 520,
              vy: -Math.random() * 420 - 60,
              r: 1.6 + Math.random() * 3,
              life: 0.5 + Math.random() * 0.5, max: 1,
              color: Math.random() < 0.45 ? '#FFF3D0' : (Math.random() < 0.5 ? P.phlogiston : P.ember),
            })
          }
          if (i === selectedRef.current && phaseRef.current === 'racing') {
            const ch = courseRef.current.chambersInfo[b.lastPenaltyChamber]
            setToast({ id: Date.now(), text: `你的球被燃素灼烧，送回第 ${(ch?.index ?? 0) + 1} 层起点！`, warn: true })
            toastTimerRef.current = now + 2600
          }
        }
      }
      if (toastTimerRef.current && now > toastTimerRef.current) {
        toastTimerRef.current = 0
        setToast(null)
      }
      for (const b of st.balls) {
        if (b.hitPower > 0.3 && parts.length < 160) {
          for (let k = 0; k < 2; k++) {
            parts.push({
              x: b.x, y: b.y,
              vx: (Math.random() - 0.5) * 240,
              vy: -Math.random() * 200,
              r: 1.5 + Math.random() * 2,
              life: 0.35 + Math.random() * 0.35, max: 0.7,
              color: Math.random() < 0.5 ? P.gold : P.soul,
            })
          }
          b.hitPower = 0
        }
      }
      if (parts.length > 220) parts.splice(0, parts.length - 220)

      // 相机
      const cam = camRef.current
      // 领先者 = 纵向最深（y 最大）的那颗球
      let frontY = -Infinity, backY = Infinity
      for (const b of st.balls) {
        if (b.y > frontY) frontY = b.y
        if (b.y < backY) backY = b.y
      }
      if (!isFinite(frontY)) { frontY = 0; backY = 0 }
      const spread = frontY - backY
      const baseScale = Math.min((w - 26) / course.W, h / VIEW_H)
      const viewWorld = h / baseScale
      const wantZoom = clamp(viewWorld / Math.max(VIEW_H, spread + 260), 0.7, 1)
      const targetZoom = lerp(cam.zoom, wantZoom, cam.init ? 0.06 : 1)
      // 相机向领先者加权：看到前方赛道比看到落后者更重要
      let mid = frontY * 0.62 + backY * 0.38
      // 试炼层：有球逼近火墙时镜头下压，保证「被灼烧送回起点」这一幕一定在画面里
      if (course.hazards && course.hazards.length) {
        const sc = baseScale * targetZoom
        for (let hi = 0; hi < course.hazards.length; hi++) {
          const info = course.chambersInfo[course.hazards[hi].chamber]
          if (!info) continue
          let near = false
          for (let bi = 0; bi < st.balls.length; bi++) {
            const by = st.balls[bi].y
            if (by > info.y1 - 470 && by < info.y1 + 260) { near = true; break }
          }
          if (!near) continue
          // 火墙抬到屏幕 72% 处（底部 Dock 会遮住画面下沿），同时保住领先的球
          const need = Math.min(info.y1 - (h * 0.22) / sc, frontY + (h * 0.34) / sc)
          if (need > mid) mid = Math.min(need, mid + 460)
        }
      }
      const halfView = h / (2 * baseScale * targetZoom)
      const targetY = clamp(mid, halfView * 0.75, Math.max(halfView * 0.75, course.height + 120 - halfView))
      if (!cam.init) { cam.y = targetY; cam.init = true }
      else cam.y = lerp(cam.y, targetY, 0.09)
      cam.zoom = targetZoom

      // 绘制
      const g = cv.getContext('2d')
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      drawScene(g, {
        cw: w, ch: h, course, state: st, racers,
        camY: cam.y, zoom: cam.zoom, t,
        playerIdx: selectedRef.current,
        particles: parts,
        baseScale,
        phase: phaseRef.current,
      })

      // HUD
      if (now - lastHud > HUD_MS) {
        lastHud = now
        const standings = raceStandings(st)
        const leader = standings[0]
        const player = standings.find(s => s.i === selectedRef.current)
        const pi = selectedRef.current
        let chIdx = st.balls[pi] ? course.chambersInfo.findIndex(ci => st.balls[pi].y < ci.y1) : 0
        if (chIdx < 0) chIdx = course.chambersInfo.length - 1   // 已冲过最后一层 → 终点水池
        setHud({
          t: st.t,
          over: st.over,
          standings: standings.map(s => ({
            i: s.i, rank: s.rank, name: s.name, progress: s.progress,
            finished: s.finished, time: s.finishTime,
            penalties: s.ball.penalties, mercy: s.ball.mercyUntilY > 0 && s.ball.y < s.ball.mercyUntilY,
            rework: s.ball.relaunches,
          })),
          leaderName: leader?.name,
          playerRank: player?.rank,
          playerProgress: player?.progress ?? 0,
          playerFinished: player?.finished,
          chamber: course.chambersInfo[chIdx],
          playerDone: !!st.balls[pi]?.finished,
        })
      }

      // 结束
      if (st.over && phaseRef.current === 'racing') {
        if (!resultTimerRef.current) {
          resultTimerRef.current = now + 1400
        } else if (now > resultTimerRef.current) {
          resultTimerRef.current = 0
          const res = raceResults(st)
          setResults(res.map(r => ({
            ...r,
            color: racers[r.index]?.color,
            color2: racers[r.index]?.color2,
            img: racers[r.index]?.img,
            elemName: racers[r.index]?.elem?.name,
            short: racers[r.index]?.short,
          })))
          setPhase('result')
        }
      }
    }

    rafRef.current = requestAnimationFrame(frame)
    return () => { alive = false; cancelAnimationFrame(rafRef.current) }
  }, [phase, selected])

  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }, [])

  const progressPct = hud ? Math.round((hud.playerProgress || 0) * 100) : 0

  // ═════════════════════════════════════════════════════════════════════════
  // 渲染
  // ═════════════════════════════════════════════════════════════════════════
  return (
    <div className="h-full flex flex-col bg-[#08060F] select-none relative overflow-hidden">
      {/* ══ 准备界面 ══ */}
      {phase === 'setup' && (
        <SetupScreen
          pool={pool}
          poolImgs={poolImgs}
          selected={selected}
          setSelected={setSelected}
          onRoll={() => rollPool()}
          onPick={() => setPickerOpen(true)}
          onStart={() => beginRace()}
          courseInfo={courseInfo}
          charCount={allChars.length}
        />
      )}

      {/* ══ 比赛画面 ══ */}
      {(phase === 'countdown' || phase === 'racing' || phase === 'result') && (
        <div ref={wrapRef} className="absolute inset-0">
          <canvas ref={canvasRef} className="block w-full h-full" />

          {/* 顶部 HUD */}
          <div className="absolute top-0 left-0 right-0 flex items-start justify-between p-3 pointer-events-none">
            <div className="flex items-center gap-2 pointer-events-auto">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-black/55 backdrop-blur-md border border-white/10">
                <Flame className="w-3.5 h-3.5 text-orange-400" />
                <span className="text-white font-mono text-sm tabular-nums">{fmtTime(hud?.t ?? 0)}</span>
              </div>
              {hud?.chamber && (
                <div className="px-3 py-1.5 rounded-lg bg-black/55 backdrop-blur-md border border-white/10 text-[11px] text-white/70">
                  {hud.playerDone ? (
                    <span className="text-amber-200 font-semibold">你的球已抵达归火之门</span>
                  ) : (
                    <>
                      第 <span className="text-amber-300 font-semibold">{hud.chamber.index + 1}</span> / {courseInfo?.chambers ?? RACE.chamberCount} 层
                      <span className="mx-1.5 text-white/20">|</span>
                      <span className={hud.chamber.trial ? 'text-orange-400 font-semibold' : 'text-teal-300'}>
                        {hud.chamber.trial ? '🔥 ' : ''}{hud.chamber.name}
                      </span>
                    </>
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center gap-1.5 pointer-events-auto">
              <button
                onClick={() => setSpeed(s => (s === 1 ? 2 : s === 2 ? 4 : 1))}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-black/55 backdrop-blur-md border border-white/10 text-[11px] text-white/80 hover:bg-black/70 transition-colors"
                title="播放速度"
              >
                <Gauge className="w-3.5 h-3.5 text-teal-300" />
                ×{speed}
              </button>
              <button
                onClick={() => setPaused(p => !p)}
                className="p-1.5 rounded-lg bg-black/55 backdrop-blur-md border border-white/10 text-white/80 hover:bg-black/70 transition-colors"
                title={paused ? '继续' : '暂停'}
              >
                {paused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
              </button>
              <button
                onClick={() => { setPhase('setup'); setResults(null); stateRef.current = null }}
                className="p-1.5 rounded-lg bg-black/55 backdrop-blur-md border border-white/10 text-white/80 hover:bg-black/70 transition-colors"
                title="重新开始"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* 实时排行榜 */}
          {phase !== 'result' && (
            <div className="absolute right-3 top-14 w-[190px] rounded-xl bg-black/55 backdrop-blur-md border border-white/10 p-2.5 pointer-events-none">
              <div className="flex items-center gap-1.5 mb-2 px-0.5">
                <Trophy className="w-3 h-3 text-amber-300" />
                <span className="text-[10px] text-white/60 tracking-wider">实时排名</span>
              </div>
              <div className="space-y-1.5">
                {(hud?.standings || []).map(s => (
                  <StandingRow key={s.i} row={s} racer={racersRef.current[s.i]} isPlayer={s.i === selected} />
                ))}
                {!hud && <div className="text-[10px] text-white/40 px-1 py-2">等待发令…</div>}
              </div>
              {/* 深度轨道 */}
              <div className="mt-2.5 pt-2 border-t border-white/10">
                <div className="relative h-[74px] rounded bg-gradient-to-b from-white/5 to-amber-500/10 overflow-hidden">
                  {(hud?.standings || []).map(s => (
                    <div key={s.i}
                      className="absolute w-2 h-2 rounded-full transition-all duration-200"
                      style={{
                        left: `${5 + s.i * 13.5}%`,
                        top: `calc(${Math.round(s.progress * 100)}% - 4px)`,
                        background: racersRef.current[s.i]?.color || '#fff',
                        boxShadow: s.i === selected ? '0 0 0 2px #FFC94A' : 'none',
                      }}
                    />
                  ))}
                  <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-amber-400/70" />
                </div>
                <div className="flex justify-between mt-1 text-[9px] text-white/35">
                  <span>起点</span><span>终点</span>
                </div>
              </div>
            </div>
          )}

          {/* 灼烧提示 */}
          {toast && (
            <div key={toast.id}
              className="absolute left-1/2 -translate-x-1/2 top-[58px] px-4 py-2 rounded-lg border text-[12px] font-semibold pointer-events-none animate-pulse"
              style={{
                background: 'rgba(40,10,4,0.85)',
                borderColor: 'rgba(255,120,50,0.55)',
                color: '#FFC08A',
                boxShadow: '0 0 24px rgba(255,90,31,0.35)',
              }}>
              🔥 {toast.text}
            </div>
          )}

          {/* 倒计时 */}
          {phase === 'countdown' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <div className="text-7xl font-black text-transparent bg-clip-text bg-gradient-to-b from-amber-200 to-orange-500 drop-shadow-[0_0_28px_rgba(255,120,40,0.55)] animate-pulse">
                {countdown > 0 ? countdown : '巡礼开始'}
              </div>
              <div className="mt-3 text-[12px] text-white/60 tracking-[0.3em]">
                {countdown > 0 ? '夜魂汇聚 · 归火为引' : ''}
              </div>
            </div>
          )}

          {/* ══ 结算 ══ */}
          {phase === 'result' && results && (
            <ResultScreen
              results={results}
              selected={selected}
              seed={seed}
              onAgain={() => beginRace()}
              onNewChars={() => { setPhase('setup'); setResults(null); rollPool() }}
            />
          )}
        </div>
      )}

      {/* ══ 自选角色 ══ */}
      {pickerOpen && (
        <CharacterPicker
          chars={allChars}
          initial={pool}
          getUrl={getUrl}
          onClose={() => setPickerOpen(false)}
          onConfirm={(list) => {
            setPool(list)
            setSelected(0)
            setPickerOpen(false)
          }}
        />
      )}

      {/* 比赛计时进度（底部细条） */}
      {(phase === 'racing') && (
        <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-white/5">
          <div className="h-full bg-gradient-to-r from-teal-400 to-amber-400 transition-[width] duration-200"
            style={{ width: `${clamp(progressPct, 0, 100)}%` }} />
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// 子组件
// ═══════════════════════════════════════════════════════════════════════════

function StandingRow({ row, racer, isPlayer }) {
  const medal = ['🥇', '🥈', '🥉'][row.rank - 1]
  return (
    <div className={`flex items-center gap-2 px-1 py-0.5 rounded ${isPlayer ? 'bg-amber-400/10' : ''}`}>
      <span className="w-4 text-[10px] text-white/50 text-right tabular-nums">{medal || row.rank}</span>
      <div className="w-4 h-4 rounded-full overflow-hidden shrink-0 border"
        style={{ borderColor: racer?.color || '#666' }}>
        {racer?.img
          ? <img src={racer.img.src} alt="" className="w-full h-full object-cover" />
          : <div className="w-full h-full" style={{ background: racer?.color || '#333' }} />}
      </div>
      <span className={`flex-1 text-[10px] truncate ${isPlayer ? 'text-amber-200 font-semibold' : 'text-white/75'}`}>
        {row.name}
      </span>
      {row.rework > 0 && (
        <span className="text-[9px] tabular-nums text-teal-300/90" title="被流水线判定不合格、送回本层入口的次数">
          ⟳{row.rework}
        </span>
      )}
      {row.penalties > 0 && (
        <span className={`text-[9px] tabular-nums ${row.mercy ? 'text-teal-300' : 'text-orange-400'}`}
          title={row.mercy ? '夜魂庇佑：本层免疫火焰' : '被燃素灼烧送回起点次数'}>
          {row.mercy ? '🛡' : '↩'}{row.penalties}
        </span>
      )}
      <span className="text-[9px] text-white/45 tabular-nums">
        {row.finished ? fmtTime(row.time) : `${Math.round(row.progress * 100)}%`}
      </span>
    </div>
  )
}

function SetupScreen({ pool, poolImgs, selected, setSelected, onRoll, onPick, onStart, courseInfo, charCount }) {
  return (
    <div className="flex-1 overflow-auto relative">
      <div className="min-h-full flex flex-col items-center justify-center py-7 px-6 relative">
      {/* 背景装饰 */}
      <div className="pointer-events-none absolute inset-0 opacity-40"
        style={{ background: 'radial-gradient(ellipse 70% 45% at 50% 8%, rgba(255,110,40,0.22), transparent 70%), radial-gradient(ellipse 60% 40% at 20% 90%, rgba(70,242,224,0.12), transparent 70%)' }} />

      <div className="relative flex flex-col items-center">
        <div className="flex items-center gap-2 text-[11px] tracking-[0.42em] text-teal-300/80">
          <span className="w-8 h-px bg-teal-300/40" />
          NATLAN · NIGHT SOUL
          <span className="w-8 h-px bg-teal-300/40" />
        </div>
        <h1 className="mt-2 text-4xl font-black tracking-[0.14em] text-transparent bg-clip-text bg-gradient-to-b from-amber-100 via-amber-300 to-orange-600 drop-shadow-[0_3px_18px_rgba(255,120,40,0.45)]">
          归火圣夜巡礼
        </h1>
        <p className="mt-2.5 text-[11.5px] text-white/50 max-w-[560px] text-center leading-relaxed">
          七位旅人被燃素之火凝为球体，同时坠入地心圣道。
          每一层都是一台随机流水线：料斗收球 → 工位加工（压辊 / 吹风 / 导向钉）→ 活动闸门判定。
          闸门合拢才能过关，敞开则被判不合格，由回送臂抛回本层入口重走；另有燃素试炼门会灼烧穿越者。最先触及归火之门的球，将赢得这场巡礼。
        </p>
      </div>

      {/* 7 球选择 */}
      <div className="relative mt-6 flex flex-wrap items-center justify-center gap-3 max-w-[780px]">
        {pool.length === 0 && (
          <div className="text-white/40 text-sm py-14">{charCount === 0 ? '正在读取角色数据库…' : '正在抽取角色…'}</div>
        )}
        {pool.map((c, i) => {
          const el = ELEM[c.element_id] || ELEM_FALLBACK
          const url = poolImgs[c.card_art]
          const active = i === selected
          // 固定占位 + transform 缩放：选中态不改变布局，避免整页抽搐
          return (
            <button key={c.id ?? i} onClick={() => setSelected(i)}
              className="group relative flex flex-col items-center w-[94px] shrink-0"
              title={`${c.name_zh}（${el.name}元素）`}>
              <div className="h-[100px] flex items-center justify-center">
                <div className="relative rounded-full transition-transform duration-200 ease-out"
                  style={{
                    width: 88, height: 88,
                    transform: active ? 'translateY(-10px) scale(1)' : 'translateY(0) scale(0.8)',
                    background: `radial-gradient(circle at 32% 28%, ${el.c2}, ${el.c} 45%, #14091F 100%)`,
                    boxShadow: active
                      ? `0 0 0 3px rgba(255,201,74,0.95), 0 0 26px ${el.c}aa`
                      : `0 0 0 2px ${el.c}66, 0 0 14px ${el.c}55`,
                  }}>
                  <div className="absolute inset-[5px] rounded-full overflow-hidden bg-black/60 flex items-center justify-center">
                    {url
                      ? <img src={url} alt="" className="w-full h-full object-cover" draggable={false} />
                      : <span className="text-white/70 text-lg font-bold">{(c.name_zh || '?').slice(0, 1)}</span>}
                  </div>
                  <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-black"
                    style={{ background: el.c2 }}>{el.name}</div>
                </div>
              </div>
              <div className="h-[15px] text-[10px] font-bold tracking-wider text-amber-300 whitespace-nowrap transition-opacity duration-200"
                style={{ opacity: active ? 1 : 0 }}>
                ▼ 我的选择
              </div>
              <span className={`text-[11px] w-full text-center truncate ${active ? 'text-amber-200 font-semibold' : 'text-white/70'}`}>
                {c.name_zh}
              </span>
            </button>
          )
        })}
      </div>

      {/* 操作 */}
      <div className="relative mt-8 flex items-center gap-3">
        <button onClick={onRoll}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/15 text-white/80 text-[12px] transition-all active:scale-95">
          <Sparkles className="w-3.5 h-3.5 text-teal-300" />随机换一批
        </button>
        <button onClick={onPick}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/15 text-white/80 text-[12px] transition-all active:scale-95">
          <Users className="w-3.5 h-3.5 text-amber-300" />自选 7 位角色
        </button>
        <button onClick={onStart} disabled={pool.length < 7}
          className="flex items-center gap-2 px-6 py-2 rounded-lg text-[13px] font-bold text-black transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: 'linear-gradient(135deg, #FFD98A, #FF9A3D 55%, #FF5A1F)', boxShadow: '0 6px 22px rgba(255,120,40,0.35)' }}>
          <Flame className="w-4 h-4" />开始巡礼
        </button>
      </div>

      {/* 赛道信息 */}
      <div className="relative mt-7 flex items-center gap-5 text-[10.5px] text-white/40">
        <span>赛道长度 <span className="text-white/70">{courseInfo ? courseInfo.height : Math.round(RACE.preludeHeight + RACE.chamberCount * RACE.chamberHeight + 700)}</span> px</span>
        <span className="text-white/15">|</span>
        <span>机关层数 <span className="text-white/70">{courseInfo?.chambers ?? RACE.chamberCount}</span></span>
        <span className="text-white/15">|</span>
        <span>含 <span className="text-orange-400/80">{TRIAL.count} 层燃素试炼</span>（穿越火墙失败送回该层起点）</span>
      </div>
      </div>
    </div>
  )
}

function ResultScreen({ results, selected, seed, onAgain, onNewChars }) {
  const mine = results.find(r => r.index === selected)
  const winner = results[0]
  const mineTime = mine?.time
  return (
    <div role="dialog" aria-modal="true" aria-label="巡礼结算" className="absolute inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6 overflow-auto">
      <div className="w-full max-w-[560px] rounded-2xl border border-amber-400/25 bg-gradient-to-b from-[#1A1024]/95 to-[#0C0714]/95 shadow-2xl">
        <div className="px-6 pt-5 pb-4 border-b border-white/10 flex items-center justify-between">
          <div>
            <div className="text-[10px] tracking-[0.34em] text-teal-300/70">NIGHT SOUL PILGRIMAGE</div>
            <h2 className="text-xl font-black text-transparent bg-clip-text bg-gradient-to-b from-amber-100 to-orange-500 tracking-wider">
              巡礼结算
            </h2>
          </div>
          <div className="text-right">
            <div className="text-[10px] text-white/45">你的选择</div>
            <div className="text-[13px] font-bold" style={{ color: mine?.color || '#fff' }}>
              {mine?.name} · 第 {mine?.rank ?? '-'} 名
            </div>
          </div>
        </div>

        <div className="px-3 py-3 max-h-[46vh] overflow-auto">
          {results.map(r => {
            const medal = ['🥇', '🥈', '🥉'][r.rank - 1]
            const isMine = r.index === selected
            const gap = r.time != null && winner?.time != null ? r.time - winner.time : null
            return (
              <div key={r.index}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg mb-1 ${isMine ? 'bg-amber-400/10 border border-amber-400/25' : 'border border-transparent'}`}>
                <span className="w-7 text-center text-[13px] text-white/60 tabular-nums font-bold">{medal || r.rank}</span>
                <div className="w-9 h-9 rounded-full overflow-hidden shrink-0 flex items-center justify-center"
                  style={{ background: `radial-gradient(circle at 32% 28%, ${r.color2}, ${r.color} 50%, #14091F 100%)`, boxShadow: `0 0 0 2px ${r.color}77` }}>
                  {r.img
                    ? <img src={r.img.src} alt="" className="w-[30px] h-[30px] rounded-full object-cover" />
                    : <span className="text-white text-xs font-bold">{r.short}</span>}
                </div>
                <div className="flex-1 min-w-0">
                  <div className={`text-[12.5px] truncate ${isMine ? 'text-amber-200 font-bold' : 'text-white/85'}`}>
                    {r.name}
                    {isMine && <span className="ml-1.5 text-[9px] px-1 py-0.5 rounded bg-amber-400/20 text-amber-200 align-middle">我的</span>}
                  </div>
                  <div className="text-[10px] text-white/40">{r.elemName}元素 · 抵达深度 {Math.round(r.depth * 100)}%</div>
                </div>
                <div className="text-right">
                  <div className="text-[13px] font-mono tabular-nums text-white/85">
                    {r.finished ? fmtTime(r.time) : '未完赛'}
                  </div>
                  <div className="text-[9.5px] text-white/35 tabular-nums">{r.rank === 1 ? '冠军' : fmtGap(gap)}</div>
                </div>
              </div>
            )
          })}
        </div>

        <div className="px-6 py-4 border-t border-white/10 flex items-center justify-between">
          <div className="text-[10.5px] text-white/45">
            {mine && mine.rank === 1
              ? '🔥 你的球率先叩响归火之门！'
              : `冠军用时 ${fmtTime(winner?.time)}，你的球落后 ${fmtGap(mineTime != null && winner?.time != null ? mineTime - winner.time : null)}`}
            <div className="text-[9px] text-white/25 mt-0.5">赛道种子 {seed} · 每局随机生成</div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onNewChars}
              className="px-3.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/15 text-white/75 text-[11.5px] transition-all active:scale-95">
              换一批角色
            </button>
            <button onClick={onAgain}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[11.5px] font-bold text-black transition-all active:scale-95"
              style={{ background: 'linear-gradient(135deg, #FFD98A, #FF9A3D 55%, #FF5A1F)' }}>
              <RotateCcw className="w-3.5 h-3.5" />再来一局
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function CharacterPicker({ chars, initial, getUrl, onClose, onConfirm }) {
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState(() => initial.map(c => c.id))
  const [urls, setUrls] = useState({})

  const list = useMemo(() => {
    const kw = q.trim().toLowerCase()
    if (!kw) return chars
    return chars.filter(c => (c.name_zh || '').toLowerCase().includes(kw))
  }, [chars, q])

  // 分批装载头像
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const targets = list.slice(0, 160)
      for (let i = 0; i < targets.length; i += 12) {
        const chunk = targets.slice(i, i + 12)
        const entries = await Promise.all(chunk.map(async c => [c.card_art, await getUrl(c.card_art)]))
        if (cancelled) return
        setUrls(prev => {
          const next = { ...prev }
          for (const [k, v] of entries) if (k && v) next[k] = v
          return next
        })
      }
    })()
    return () => { cancelled = true }
  }, [list, getUrl])

  const toggle = (id) => {
    setPicked(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id)
      if (prev.length >= 7) return prev
      return [...prev, id]
    })
  }

  const pickedChars = picked.map(id => chars.find(c => c.id === id)).filter(Boolean)

  return (
    <div role="dialog" aria-modal="true" aria-label="自选角色" className="absolute inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-5">
      <div className="w-full max-w-[720px] max-h-full flex flex-col rounded-2xl border border-white/12 bg-[#120C1E]/97 shadow-2xl">
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-amber-300" />
            <span className="text-[13px] text-white/85 font-semibold">自选 7 位角色</span>
            <span className="text-[11px] text-white/40">已选 {picked.length} / 7</span>
          </div>
          <button onClick={onClose} aria-label="关闭" className="p-1 rounded hover:bg-white/10 text-white/50">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-2.5 border-b border-white/8">
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10">
            <Search className="w-3.5 h-3.5 text-white/35" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="搜索角色名…"
              className="flex-1 bg-transparent outline-none text-[12px] text-white/85 placeholder:text-white/25" />
          </div>
        </div>

        <div className="flex-1 overflow-auto px-4 py-3 min-h-[240px]">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(72px,1fr))] gap-2">
            {list.map(c => {
              const el = ELEM[c.element_id] || ELEM_FALLBACK
              const on = picked.includes(c.id)
              const full = !on && picked.length >= 7
              return (
                <button key={c.id} onClick={() => toggle(c.id)} disabled={full}
                  className={`relative flex flex-col items-center gap-1 p-1.5 rounded-lg border transition-all ${on ? 'border-amber-400/70 bg-amber-400/10' : 'border-white/8 hover:border-white/25'} ${full ? 'opacity-35 cursor-not-allowed' : ''}`}>
                  <div className="w-11 h-11 rounded-full overflow-hidden flex items-center justify-center"
                    style={{ background: `radial-gradient(circle at 32% 28%, ${el.c2}, ${el.c} 55%, #14091F 100%)` }}>
                    {urls[c.card_art]
                      ? <img src={urls[c.card_art]} alt="" className="w-[38px] h-[38px] rounded-full object-cover" />
                      : <span className="text-white/80 text-[13px] font-bold">{(c.name_zh || '?').slice(0, 1)}</span>}
                  </div>
                  <span className="text-[10px] text-white/70 truncate w-full text-center">{c.name_zh}</span>
                  {on && (
                    <span className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-amber-400 text-black text-[9px] font-bold flex items-center justify-center">
                      {picked.indexOf(c.id) + 1}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex items-center justify-between px-5 py-3 border-t border-white/10">
          <div className="flex items-center gap-1.5 overflow-hidden">
            {pickedChars.map(c => {
              const el = ELEM[c.element_id] || ELEM_FALLBACK
              return (
                <div key={c.id} className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-[10px] font-bold text-black"
                  style={{ background: el.c2 }} title={c.name_zh}>
                  {(c.name_zh || '?').slice(0, 1)}
                </div>
              )
            })}
            {picked.length === 0 && <span className="text-[10.5px] text-white/35">尚未选择</span>}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setPicked([])}
              className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/15 text-white/70 text-[11.5px]">清空</button>
            <button onClick={() => onConfirm(pickedChars)} disabled={picked.length !== 7}
              className="px-4 py-1.5 rounded-lg text-[11.5px] font-bold text-black disabled:opacity-35 transition-all active:scale-95"
              style={{ background: 'linear-gradient(135deg, #FFD98A, #FF9A3D 55%, #FF5A1F)' }}>
              确认出战
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

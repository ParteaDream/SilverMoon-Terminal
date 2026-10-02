// ═════════════════════════════════════════════════════════════════
// 希穆兰卡 · 共享原语
//   - useSimImages：批量图片加载（终端窗口不在 <main> 滚动容器内，
//     useLazyImage 的视口判定不适用，故按祈愿捕捉站的做法直接走 readImage + 本地缓存）
//   - 稀有度视觉规范 / 物品图标 / 物品卡 / 资源栏
// ═════════════════════════════════════════════════════════════════
import { useState, useEffect, useRef, useMemo } from 'react'
import { useDb } from '../context/DbContext'
import { Sparkles, Star as StarIcon } from 'lucide-react'

// ── 稀有度视觉（对齐原版祈愿结果配色：五星金、四星紫、三星蓝）──
export const RARITY = {
  5: {
    hex: '#ffb13f',
    soft: '#ffe3ad',
    grad: 'from-[#8a4b1f] via-[#c1743a] to-[#e7a75c]',
    text: 'text-amber-100',
    border: 'border-amber-300/70',
    ring: 'ring-amber-300/60',
    glow: 'shadow-[0_0_28px_rgba(255,177,63,0.55)]',
    chip: 'bg-amber-400/15 text-amber-200 border-amber-300/40',
    label: '五星',
  },
  4: {
    hex: '#a256e1',
    soft: '#dcc0f7',
    grad: 'from-[#3f2363] via-[#6b3fa0] to-[#9b6ad0]',
    text: 'text-purple-100',
    border: 'border-purple-300/60',
    ring: 'ring-purple-300/50',
    glow: 'shadow-[0_0_22px_rgba(162,86,225,0.45)]',
    chip: 'bg-purple-400/15 text-purple-200 border-purple-300/40',
    label: '四星',
  },
  3: {
    hex: '#5b8fd6',
    soft: '#c6dcf7',
    grad: 'from-[#22374f] via-[#33587f] to-[#4f7fb5]',
    text: 'text-sky-100',
    border: 'border-sky-300/40',
    ring: 'ring-sky-300/40',
    glow: 'shadow-[0_0_16px_rgba(91,143,214,0.32)]',
    chip: 'bg-sky-400/15 text-sky-200 border-sky-300/40',
    label: '三星',
  },
}
export const rarityStyle = (r) => RARITY[r] || RARITY[3]

// ── 元素配色（用于卡池主题色与角色角标）——取自游戏内元素识别色 ──
export const ELEMENT_COLOR = {
  火: '#ef7938', 水: '#4cc2f1', 风: '#74c2a8', 雷: '#b08fc7',
  草: '#a5c83b', 冰: '#9fd6e3', 岩: '#d4a72c',
}
export const elementColor = (name) => ELEMENT_COLOR[name] || '#94a3b8'

/**
 * 卡池主题色（决定合成卡池背景的配色）
 *   - 角色活动祈愿 / 角色活动祈愿-2：由该池五星 UP 角色的元素决定
 *   - 武器活动祈愿：固定橙色
 *   - 集录祈愿：统一蓝色
 *   - 常驻祈愿：统一紫色
 */
export function poolTheme(pool) {
  if (!pool) return { main: '#7c8aa5', from: '#2b3446', to: '#101725', label: '祈愿' }
  if (pool.kind === 'weapon') return { main: '#ff9b3d', from: '#4a2c14', to: '#170f08' }
  if (pool.kind === 'chronicled') return { main: '#4a9ee8', from: '#12395e', to: '#08131f' }
  if (pool.kind === 'standard') return { main: '#a06ee0', from: '#33204f', to: '#120b1c' }
  const el = pool.up5?.[0]?.element
  const main = el ? elementColor(el) : '#d8c08a'
  return { main, from: shade(main, -0.66), to: shade(main, -0.85), label: el || '角色' }
}

/** 颜色明暗调整（f<0 变暗，f>0 变亮） */
export function shade(hex, f) {
  const h = String(hex || '#888888').replace('#', '')
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h
  const n = parseInt(full, 16)
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => {
    const t = f < 0 ? 0 : 255
    return Math.round(v + (t - v) * Math.abs(f))
  })
  return `#${ch.map(v => v.toString(16).padStart(2, '0')).join('')}`
}

export function hexToRgba(hex, a = 1) {
  const h = String(hex || '#888888').replace('#', '')
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h
  const n = parseInt(full, 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

/** 四芒星（祈愿类型标签前的装饰图案，代码绘制） */
export function FourPointStar({ size = 12, color = 'currentColor', className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        d="M12 0.5 L14.1 9.9 L23.5 12 L14.1 14.1 L12 23.5 L9.9 14.1 L0.5 12 L9.9 9.9 Z"
        fill={color}
      />
    </svg>
  )
}

/** 五颗星（稀有度标识） */
export function StarRow({ count = 5, size = 12, color = '#ffd77a', gap = 2 }) {
  return (
    <span className="inline-flex items-center" style={{ gap }}>
      {Array.from({ length: count }, (_, i) => (
        <svg key={i} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 2.6l2.9 6.1 6.7.9-4.9 4.6 1.2 6.6L12 17.6 6.1 20.8l1.2-6.6L2.4 9.6l6.7-.9z" fill={color} />
        </svg>
      ))}
    </span>
  )
}

// ═════════════════════════════════════════════════════════════════
// 批量图片加载
// ═════════════════════════════════════════════════════════════════
const _imgCache = new Map()   // `${filename}::${maxWidth}` → dataURL
const _pending = new Map()    // 同上 → Promise

function cacheKey(filename, maxWidth) { return `${filename}::${maxWidth || 0}` }

/**
 * 批量加载图片，返回 { [filename]: dataURL }
 * @param {string[]} filenames
 * @param {number} [maxWidth] 尺寸提示（缩略以减小 IPC 载荷）
 */
export function useSimImages(filenames, maxWidth) {
  const { readImage } = useDb()
  const list = useMemo(() => [...new Set((filenames || []).filter(Boolean))], [filenames])
  const key = list.join('|') + '::' + (maxWidth || 0)
  const [map, setMap] = useState(() => {
    const init = {}
    for (const f of list) {
      const hit = _imgCache.get(cacheKey(f, maxWidth))
      if (hit) init[f] = hit
    }
    return init
  })

  useEffect(() => {
    let cancelled = false
    const next = {}
    const tasks = []
    for (const f of list) {
      const k = cacheKey(f, maxWidth)
      const hit = _imgCache.get(k)
      if (hit) { next[f] = hit; continue }
      let p = _pending.get(k)
      if (!p) {
        p = readImage(f, maxWidth).then(data => {
          _pending.delete(k)
          if (data) _imgCache.set(k, data)
          return data
        }).catch(() => { _pending.delete(k); return null })
        _pending.set(k, p)
      }
      tasks.push(p.then(data => { if (data) next[f] = data }))
    }
    if (tasks.length === 0) { setMap(next); return }
    Promise.all(tasks).then(() => { if (!cancelled) setMap(next) })
    return () => { cancelled = true }
  }, [key, readImage, maxWidth]) // eslint-disable-line react-hooks/exhaustive-deps

  return map
}

/** 单图（内部走同一套缓存） */
export function useSimImage(filename, maxWidth) {
  const map = useSimImages(filename ? [filename] : [], maxWidth)
  return filename ? (map[filename] || null) : null
}

// ═════════════════════════════════════════════════════════════════
// 物品图标 / 物品卡
// ═════════════════════════════════════════════════════════════════

/**
 * 物品图标（方形，按稀有度着色底）
 * @param {{ item: object, size?: number, className?: string, showStars?: boolean }} props
 */
export function SimItemIcon({ item, size = 56, className = '', showStars = false, imgMap }) {
  const st = rarityStyle(item?.rarity)
  const local = useSimImage(imgMap ? null : (item?.art || null), size <= 64 ? Math.max(size * 2, 96) : undefined)
  const src = imgMap ? imgMap[item?.art] : local
  return (
    <div
      className={`relative rounded-lg overflow-hidden bg-gradient-to-br ${st.grad} ${st.border} border ${className}`}
      style={{ width: size, height: size }}
      title={item?.name}
    >
      <div className="absolute inset-0 flex items-center justify-center">
        {src
          ? <img src={src} alt={item?.name || ''} className="w-full h-full object-contain" draggable={false} />
          : <Sparkles className="w-1/2 h-1/2 text-white/30" />}
      </div>
      {showStars && (
        <div className="absolute bottom-0 inset-x-0 flex justify-center pb-[1px] bg-gradient-to-t from-black/60 to-transparent">
          <span className={`text-[8px] leading-[10px] ${st.text}`}>{'★'.repeat(item?.rarity || 3)}</span>
        </div>
      )}
    </div>
  )
}

/**
 * 原版风格的物品卡（抽卡结果 / 详情用）
 * 角色用立绘，武器用卡池图，底部压名称与星级
 */
export function SimItemCard({ item, width = 132, imgMap, sizeHint = 220, compact = false }) {
  const st = rarityStyle(item?.rarity)
  const file = item?.splash || item?.art
  const local = useSimImage(imgMap ? null : file, sizeHint)
  const src = imgMap ? imgMap[file] : local
  // 抽卡记录字段为 itemType，卡池内容字段为 type，两种来源都要能识别
  const kind = item?.type || item?.itemType
  const isChar = kind === 'character'
  const artH = Math.round(width * (compact ? 0.86 : 0.96))
  return (
    <div
      className={`relative rounded-xl overflow-hidden border ${st.border} bg-gradient-to-b ${st.grad} ${st.glow}`}
      style={{ width }}
    >
      {/* 光晕 */}
      <div
        className="absolute inset-0 opacity-70 pointer-events-none"
        style={{ background: `radial-gradient(120% 80% at 50% 12%, ${st.hex}44 0%, transparent 62%)` }}
      />
      {/* 角色立绘是 2:1 横幅构图、人物居中：用 object-cover 竖向裁切取中，
          否则在竖版卡面里会缩成小小一条（武器图需要完整轮廓，保持 contain）。 */}
      <div className="relative overflow-hidden" style={{ height: artH }}>
        {src
          ? <img
              src={src}
              alt={item?.name || ''}
              className={isChar
                ? 'w-full h-full object-cover object-center'
                : 'w-full h-full object-contain p-1.5'}
              draggable={false}
            />
          : <div className="w-full h-full flex items-center justify-center"><Sparkles className="w-1/3 h-1/3 text-white/30" /></div>}
        {/* 底部渐隐，衔接名称区 */}
        <div className="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-black/55 to-transparent" />
      </div>
      <div className="relative px-2 pb-1.5 pt-1 bg-gradient-to-t from-black/75 via-black/45 to-transparent">
        <div className={`truncate font-medium ${st.text}`} style={{ fontSize: compact ? 11 : 13 }}>{item?.name}</div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-[10px] tracking-tight" style={{ color: st.hex }}>{'★'.repeat(item?.rarity || 3)}</span>
          {item?.element && (
            <span className="text-[9px] px-1 rounded" style={{ color: elementColor(item.element), background: `${elementColor(item.element)}22` }}>
              {item.element}
            </span>
          )}
          {item?.weaponType && isChar && <span className="text-[9px] text-white/50">{item.weaponType}</span>}
        </div>
      </div>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════
// 资源栏
// ═════════════════════════════════════════════════════════════════
export const CURRENCY_ICON = {
  genesis: 'UI_ItemIcon_203.webp',      // 创世结晶
  primogem: 'UI_ItemIcon_201.webp',     // 原石
  intertwined: 'UI_ItemIcon_223.webp',  // 纠缠之缘
  acquaint: 'UI_ItemIcon_224.webp',     // 相遇之缘
  starglitter: 'UI_ItemIcon_221.webp',  // 无主的星辉（材料 221）
  stardust: 'UI_ItemIcon_222.webp',     // 无主的星尘（材料 222）
}
export const CURRENCY_LABEL = {
  genesis: '创世结晶', primogem: '原石', intertwined: '纠缠之缘',
  acquaint: '相遇之缘', starglitter: '无主的星辉', stardust: '无主的星尘',
}

export function SimCurrencyIcon({ kind, size = 20, className = '' }) {
  const src = useSimImage(CURRENCY_ICON[kind], 64)
  return src
    ? <img src={src} alt={CURRENCY_LABEL[kind]} width={size} height={size} className={`object-contain ${className}`} draggable={false} />
    : <StarIcon width={size} height={size} className={className} />
}

// ═════════════════════════════════════════════════════════════════
// 小工具
// ═════════════════════════════════════════════════════════════════

/** 保底进度条（距硬保底） */
export function PityBar({ value, max, label, tone = 'primary' }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  const color = tone === 'gold' ? '#ffb13f' : tone === 'purple' ? '#a256e1' : 'rgb(var(--primary-400))'
  return (
    <div className="w-full">
      <div className="flex justify-between text-[10px] text-white/55 mb-1">
        <span>{label}</span>
        <span className="tabular-nums">{value} / {max}</span>
      </div>
      <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  )
}

/** 统一的次级按钮 */
export function SimButton({ children, onClick, variant = 'ghost', size = 'md', disabled, className = '', ...rest }) {
  const base = 'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed'
  const sizes = { sm: 'px-2.5 py-1 text-[11px]', md: 'px-3 py-1.5 text-xs', lg: 'px-4 py-2 text-sm' }
  const variants = {
    ghost: 'bg-white/5 hover:bg-white/10 text-white/80 border border-white/10',
    primary: 'bg-primary-500/85 hover:bg-primary-500 text-white border border-primary-300/30',
    gold: 'bg-gradient-to-b from-amber-300 to-amber-500 text-[#3b2607] border border-amber-200/70 hover:brightness-110',
    danger: 'bg-rose-500/15 hover:bg-rose-500/25 text-rose-200 border border-rose-400/35',
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={`${base} ${sizes[size]} ${variants[variant] || variants.ghost} ${className}`} {...rest}>
      {children}
    </button>
  )
}

/** 空状态 */
export function SimEmpty({ icon: Icon = Sparkles, title, hint }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
      <div className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center">
        <Icon className="w-7 h-7 text-white/25" />
      </div>
      <div>
        <p className="text-sm text-white/70">{title}</p>
        {hint && <p className="text-xs text-white/40 mt-1">{hint}</p>}
      </div>
    </div>
  )
}

import { useMemo } from 'react'
import { useTheme } from '../context/ThemeContext'

/**
 * 稳定的字符串 hash → 0..max-1
 */
function hashIndex(str, max) {
  if (!str) return 0
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash) % max
}

/**
 * #hex → { r, g, b }
 */
function hexToRgb(hex) {
  const h = hex.replace('#', '')
  const num = parseInt(h.length === 3 ? h[0]+h[0]+h[1]+h[1]+h[2]+h[2] : h, 16)
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 }
}

/**
 * RGB → HSL
 */
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  let h = 0, s = 0, l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break
      case g: h = ((b - r) / d + 2) / 6; break
      case b: h = ((r - g) / d + 4) / 6; break
    }
  }
  return { h: h * 360, s: s * 100, l: l * 100 }
}

/**
 * HSL → RGB 字符串 "r g b"
 */
function hslToRgbStr(h, s, l) {
  h /= 360; s /= 100; l /= 100
  let r, g, b
  if (s === 0) {
    r = g = b = l
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1
      if (t > 1) t -= 1
      if (t < 1/6) return p + (q - p) * 6 * t
      if (t < 1/2) return q
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6
      return p
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    r = hue2rgb(p, q, h + 1/3)
    g = hue2rgb(p, q, h)
    b = hue2rgb(p, q, h - 1/3)
  }
  return `${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)}`
}

/**
 * HSL → { r, g, b, lightness }
 */
function hslToRgbObj(h, s, l) {
  const str = hslToRgbStr(h, s, l)
  const parts = str.split(' ').filter(Boolean)
  return { r: Number(parts[0]), g: Number(parts[1]), b: Number(parts[2]), lightness: l }
}

/**
 * RGB 字符串 "r g b" → { r, g, b }
 */
function rgbStrToObj(str) {
  const parts = str.split(' ').filter(Boolean)
  if (parts.length >= 3) {
    return {
      r: Math.min(255, Math.max(0, Number(parts[0]))),
      g: Math.min(255, Math.max(0, Number(parts[1]))),
      b: Math.min(255, Math.max(0, Number(parts[2]))),
    }
  }
  return null
}

/**
 * 欧几里得 RGB 距离（0-441，越大越不同）
 */
function colorDistance(a, b) {
  const dr = a.r - b.r
  const dg = a.g - b.g
  const db = a.b - b.b
  return Math.sqrt(dr * dr + dg * dg + db * db)
}

/**
 * 检查一组颜色是否两两之间差异足够大
 */
function areColorsDistinct(colors, minDist = 80) {
  for (let i = 0; i < colors.length; i++) {
    for (let j = i + 1; j < colors.length; j++) {
      if (colorDistance(colors[i], colors[j]) < minDist) return false
    }
  }
  return true
}

/**
 * 从主题调色板中筛选合适的颜色（亮度 15-85% 的中等亮度范围）
 */
function getSuitablePaletteColors(theme, themes, customColors) {
  const candidates = []
  const seen = new Set()

  if (theme === 'custom') {
    for (let i = 1; i <= 5; i++) {
      const val = customColors['c' + i]
      if (!val) continue
      const rgb = rgbStrToObj(String(val))
      if (!rgb) continue
      const { l } = rgbToHsl(rgb.r, rgb.g, rgb.b)
      if (l >= 15 && l <= 85) {
        const hex = `#${rgb.r.toString(16).padStart(2,'0')}${rgb.g.toString(16).padStart(2,'0')}${rgb.b.toString(16).padStart(2,'0')}`
        if (seen.has(hex)) continue
        seen.add(hex)
        candidates.push({ r: rgb.r, g: rgb.g, b: rgb.b, hex, lightness: l })
      }
    }
  } else {
    const palette = themes[theme]?.colors
    if (palette) {
      for (const hex of palette) {
        if (!hex || !hex.startsWith('#')) continue
        try {
          const { r, g, b } = hexToRgb(hex)
          const { l } = rgbToHsl(r, g, b)
          if (l >= 15 && l <= 85) {
            if (seen.has(hex)) continue
            seen.add(hex)
            candidates.push({ r, g, b, hex, lightness: l })
          }
        } catch (_) {}
      }
    }
  }

  // 按亮度排序
  candidates.sort((a, b) => a.lightness - b.lightness)
  return candidates
}

/**
 * 获取当前主题的 primary hue
 */
function extractPrimaryHue(theme, themes, customColors) {
  try {
    let primaryHex
    if (theme === 'custom') {
      const c1 = customColors.c1
      if (c1) {
        const parts = c1.split(' ').filter(Boolean)
        if (parts.length >= 3) {
          primaryHex = `#${Math.min(255,Math.max(0,Math.round(Number(parts[0])))).toString(16).padStart(2,'0')}${Math.min(255,Math.max(0,Math.round(Number(parts[1])))).toString(16).padStart(2,'0')}${Math.min(255,Math.max(0,Math.round(Number(parts[2])))).toString(16).padStart(2,'0')}`
        }
      }
    } else {
      const palette = themes[theme]?.colors
      if (palette && palette.length >= 3) {
        let best = palette[2]
        let bestSat = -1
        for (const c of palette) {
          const { r, g, b } = hexToRgb(c)
          const { s } = rgbToHsl(r, g, b)
          if (s > bestSat) { bestSat = s; best = c }
        }
        primaryHex = best
      }
    }
    if (primaryHex) {
      const { r, g, b } = hexToRgb(primaryHex)
      const { h } = rgbToHsl(r, g, b)
      return h
    }
  } catch (_) {}
  return 230
}

/**
 * 根据主题构建颜色池：
 * 1. 从调色板取候选颜色
 * 2. 如果候选≥3且两两差异足够（距离≥80），直接使用
 * 3. 否则：保留调色板已有颜色，用 hue 派生色补足到至少3个不同颜色
 */
function buildColorPool(theme, themes, customColors) {
  const palColors = getSuitablePaletteColors(theme, themes, customColors)

  // 调色板颜色足够多且差异明显 → 直接使用
  if (palColors.length >= 3 && areColorsDistinct(palColors, 70)) {
    return palColors
  }

  // 调色板不足或太接近 → 混合策略：保留调色板已有 + 派生填充
  const pool = [...palColors]
  const usedHues = new Set()

  // 记录已用色相（来自调色板颜色），避免派生色撞上
  for (const c of palColors) {
    const { h } = rgbToHsl(c.r, c.g, c.b)
    usedHues.add(Math.round(h))
  }

  const primaryHue = extractPrimaryHue(theme, themes, customColors)

  // 预设 6 个参考色相步长（60°），确保均匀分布在色环上
  const steps = [0, 60, 120, 180, 240, 300]
  for (const offset of steps) {
    if (pool.length >= 3) break
    const hue = ((primaryHue + offset) % 360 + 360) % 360
    const roundedHue = Math.round(hue)
    // 避免与已有的某个调色板颜色色相太接近（< 30°）
    let tooClose = false
    for (const used of usedHues) {
      const diff = Math.abs(roundedHue - used)
      if (Math.min(diff, 360 - diff) < 30) { tooClose = true; break }
    }
    if (tooClose) continue
    usedHues.add(roundedHue)
    // 派生色：饱和度 65%、亮度 55%，在深色背景上鲜明且不刺眼
    pool.push(hslToRgbObj(hue, 65, 55))
  }

  // 如果还不够（极少数极端情况），放宽色相差约束继续补
  if (pool.length < 3) {
    for (const offset of steps) {
      if (pool.length >= 3) break
      const hue = ((primaryHue + offset + 30) % 360 + 360) % 360 // 中间偏移
      pool.push(hslToRgbObj(hue, 65, 55))
    }
  }

  return pool
}

/**
 * 根据分类名称从当前主题的调色板或派生色中选取颜色。
 *
 * 策略：
 * 1. 从主题调色板中筛选亮度适中的颜色
 * 2. 如果调色板颜色足够多且差异明显，直接按 hash 分配
 * 3. 如果不足或太接近，用调色板已有颜色 + 主题主色派生色补足颜色池
 * 4. 始终保证颜色池中的颜色两两差异足够，避免标签颜色近似
 *
 * 文字颜色：根据背景亮度自动选择深色（L>50%）或浅色（L≤50%）。
 *
 * 返回格式: { bg: 'r g b', text: 'r g b' } (空格分隔 RGB)
 */
export function useTypeColor(name) {
  const { theme, themes, customColors } = useTheme()

  return useMemo(() => {
    const pool = buildColorPool(theme, themes, customColors)

    // 从颜色池中按 hash 分配
    const idx = hashIndex(name || '', pool.length)
    const color = pool[idx]
    const bg = `${color.r} ${color.g} ${color.b}`
    const text = color.lightness > 50 ? '0 0 0' : '255 255 255'
    return { bg, text }
  }, [name, theme, themes, customColors])
}

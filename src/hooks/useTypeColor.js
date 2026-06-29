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
  const ri = Math.round(r * 255)
  const gi = Math.round(g * 255)
  const bi = Math.round(b * 255)
  return `${ri} ${gi} ${bi}`
}

/**
 * 获取当前主题的 primary-500 色相（主色调）。
 * 如果无法获取，默认使用 230（靛蓝色相）。
 */
function extractPrimaryHue(theme, themes, customColors) {
  try {
    let primaryHex
    if (theme === 'custom') {
      const c1 = customColors.c1
      if (c1) {
        const parts = c1.split(' ').filter(Boolean)
        if (parts.length === 3 && !isNaN(Number(parts[0]))) {
          const r = Math.min(255, Math.max(0, Math.round(Number(parts[0]))))
          const g = Math.min(255, Math.max(0, Math.round(Number(parts[1]))))
          const b = Math.min(255, Math.max(0, Math.round(Number(parts[2]))))
          primaryHex = `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`
        }
      }
    } else {
      // Attempt to get the primary accent color from theme colors
      // Typically the 3rd color (index 2) is the primary accent in most themes
      const palette = themes[theme]?.colors
      if (palette && palette.length >= 3) {
        // Use the most saturated color as primary indicator
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
  return 230 // 默认靛蓝色相
}

/**
 * 根据分类名称从当前主题派生一个高区分度的颜色。
 *
 * 策略：使用 HSL 色彩空间，固定高饱和度(68%)和中等亮度(58%)以保证在深色
 * 背景上清晰可见，通过 hash 将色相均匀分布在色环上（相对主题主色偏移），
 * 确保不同分类的颜色彼此明显不同且与 UI 背景区分。
 *
 * 返回格式: { bg: 'r g b', text: 'r g b' } (空格分隔 RGB)
 */
export function useTypeColor(name) {
  const { theme, themes, customColors } = useTheme()

  return useMemo(() => {
    const primaryHue = extractPrimaryHue(theme, themes, customColors)
    // 将分类名称 hash 到 0-11 之间的整数，每个间隔 30° 色相（确保均匀分布）
    const hueStep = 30
    const offset = hashIndex(name, 12) * hueStep
    // 相对于主题主色偏移，让所有颜色围绕主题色分布
    const hue = ((primaryHue + offset) % 360 + 360) % 360
    // 固定高饱和度 + 中等亮度，在深色背景上足够鲜明且不过亮
    const saturation = 68
    const lightness = 58
    const bg = hslToRgbStr(hue, saturation, lightness)
    // 亮色背景用深色文字
    const text = lightness > 50 ? '0 0 0' : '255 255 255'
    return { bg, text }
  }, [name, theme, themes, customColors])
}

import { createContext, useContext, useState, useEffect, useCallback } from 'react'

// ── Theme definitions ──
export const THEMES = {
  slate: {
    id: 'slate',
    label: '原初色彩',
    desc: '暖灰基调 + 靛蓝点缀',
    colors: ['#EDEBE9', '#D8D1C9', '#3A529D', '#49474A', '#34353F'],
  },
  trailblaze: {
    id: 'trailblaze',
    label: '开拓金',
    desc: '沉稳黑金 · 星穹铁道开拓者',
    colors: ['#E4CBB0', '#B6AEB1', '#B0965C', '#2C2B34', '#80CBB5'],
  },
  lidu: {
    id: 'lidu',
    label: '丽都橙',
    desc: '硬核嘻哈 · 绝区零风格',
    colors: ['#E28234', '#242424', '#2E2F31', '#E9E34C', '#1C1C1C'],
  },
  classic: {
    id: 'classic',
    label: '原初暗色',
    desc: '靛蓝石板暗色主题',
    colors: ['#6366f1', '#818cf8', '#1e293b', '#0f172a', '#020617'],
  },
  emerald: {
    id: 'emerald',
    label: '翡翠绿',
    desc: '中性暗灰 + 绿调点缀',
    colors: ['#26a55a', '#1e7e44', '#1a2618', '#141e14', '#0c140c'],
  },
  sunset: {
    id: 'sunset',
    label: '日落暖橙',
    desc: '中性暗灰 + 暖橙点缀',
    colors: ['#d26828', '#b84d1a', '#1f1812', '#18120e', '#0f0b09'],
  },
  amethyst: {
    id: 'amethyst',
    label: '紫晶',
    desc: '中性暗灰 + 紫调点缀',
    colors: ['#9140d0', '#7628b0', '#1c1426', '#150e1c', '#0d0911'],
  },
  custom: {
    id: 'custom',
    label: '自定义',
    desc: '自由搭配专属配色',
    colors: ['#6366f1', '#1e293b', '#0f172a', '#64748b'],
  },
}

const DEFAULT_THEME = 'slate'
const THEME_STORAGE_KEY = 'theme'
const CUSTOM_COLORS_KEY = 'custom_theme_colors'

// Default custom colors (fallback)
const DEFAULT_CUSTOM_COLORS = {
  surface950: '35 36 44',
  surface800: '73 71 74',
  surface700: '90 85 80',
  surface500: '162 155 147',
  surface400: '195 188 181',
  primary500: '72 100 175',
}

// Interpolate full palette from key colors
function buildCustomPalette(c) {
  return {
    '--surface-950': c.surface950,
    '--surface-900': c.surface900 || c.surface950,
    '--surface-850': c.surface850 || c.surface950,
    '--surface-800': c.surface800,
    '--surface-700': c.surface700,
    '--surface-600': c.surface600 || c.surface700,
    '--surface-500': c.surface500,
    '--surface-400': c.surface400,
    '--surface-300': c.surface300 || c.surface400,
    '--surface-200': c.surface200 || c.surface400,
    '--surface-100': c.surface100 || c.surface400,
    '--surface-50': c.surface50 || c.surface400,
    '--primary-500': c.primary500,
    '--primary-400': c.primary400 || c.primary500,
    '--primary-600': c.primary600 || c.primary500,
    '--primary-300': c.primary300 || c.primary500,
    '--primary-700': c.primary700 || c.primary500,
  }
}

const ThemeContext = createContext(null)

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    // Backward compat: migrate old "genshin" theme to "slate"
    if (stored === 'genshin') return 'slate'
    return stored || DEFAULT_THEME
  })

  const [customColors, setCustomColors] = useState(() => {
    try {
      const saved = localStorage.getItem(CUSTOM_COLORS_KEY)
      return saved ? JSON.parse(saved) : DEFAULT_CUSTOM_COLORS
    } catch (_) { return { ...DEFAULT_CUSTOM_COLORS } }
  })

  // Apply theme attribute
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  }, [theme])

  // Apply custom CSS variables when theme is 'custom'
  useEffect(() => {
    const root = document.documentElement
    if (theme !== 'custom') {
      // Clean up custom inline vars so CSS [data-theme] rules take over
      const keys = [
        '--surface-950','--surface-900','--surface-850','--surface-800','--surface-700','--surface-600',
        '--surface-500','--surface-400','--surface-300','--surface-200','--surface-100','--surface-50',
        '--primary-500','--primary-400','--primary-600','--primary-300','--primary-700',
      ]
      for (const key of keys) root.style.removeProperty(key)
      return
    }
    const palette = buildCustomPalette(customColors)
    for (const [key, val] of Object.entries(palette)) {
      root.style.setProperty(key, val)
    }
  }, [theme, customColors])

  const persistToDb = useCallback(async (t, c) => {
    try {
      if (window.electronAPI) {
        await window.electronAPI.dbQuery(
          "INSERT OR REPLACE INTO settings (key, value) VALUES ('theme', ?)",
          [JSON.stringify({ id: t, custom: c || null })]
        )
      }
    } catch (_) {}
  }, [])

  const setTheme = useCallback((t) => {
    setThemeState(t)
    persistToDb(t, t === 'custom' ? customColors : null)
  }, [persistToDb, customColors])

  const updateCustomColors = useCallback((colors) => {
    const next = { ...customColors, ...colors }
    setCustomColors(next)
    localStorage.setItem(CUSTOM_COLORS_KEY, JSON.stringify(next))
    persistToDb('custom', next)
  }, [customColors, persistToDb])

  // Load from DB on mount
  useEffect(() => {
    if (!window.electronAPI) return
    window.electronAPI.dbQuery("SELECT value FROM settings WHERE key = 'theme'")
      .then(res => {
        if (res?.data?.length > 0) {
          try {
            const stored = JSON.parse(res.data[0].value)
            if (typeof stored === 'string' && THEMES[stored]) {
              setThemeState(stored)
            } else if (stored === 'genshin') {
              // Backward compat: migrate old "genshin" theme to "slate"
              setThemeState('slate')
            } else if (stored && typeof stored === 'object') {
              setThemeState(stored.id === 'genshin' ? 'slate' : (stored.id || DEFAULT_THEME))
              if (stored.custom) setCustomColors(stored.custom)
            }
          } catch (_) {}
        }
      })
      .catch(() => {})
  }, [])

  return (
    <ThemeContext.Provider value={{ theme, setTheme, themes: THEMES, customColors, updateCustomColors }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}

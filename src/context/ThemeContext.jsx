import { createContext, useContext, useState, useEffect, useCallback } from 'react'

// ── Theme definitions ──
export const THEMES = {
  slate: {
    id: 'slate',
    label: '原初色彩',
    desc: '鸽子衔枝之年……',
    colors: ['#EDEBE9', '#D8D1C9', '#3A529D', '#49474A', '#34353F'],
  },
  trailblaze: {
    id: 'trailblaze',
    label: '开拓金',
    desc: '稳重黑金，深沉格调',
    colors: ['#E4CBB0', '#B6AEB1', '#B0965C', '#2C2B34', '#80CBB5'],
  },
  lidu: {
    id: 'lidu',
    label: '丽都橙',
    desc: '嗯呐嗯呐，嗯呐哒！',
    colors: ['#E28234', '#242424', '#2E2F31', '#E9E34C', '#1C1C1C'],
  },
  raiden: {
    id: 'raiden',
    label: '奥赫马风尚',
    desc: '爱！上！雷！神！',
    colors: ['#C1C4DE', '#7690AD', '#6D349E', '#D1B347', '#1a1428'],
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
    colors: ['#6366f1', '#e4e0db', '#49474a', '#c4bab0', '#23242c'],
  },
}

const DEFAULT_THEME = 'slate'
const THEME_STORAGE_KEY = 'theme'
const CUSTOM_COLORS_KEY = 'custom_theme_colors'

// Default custom colors (fallback) — 5 general colors + icon
const DEFAULT_CUSTOM_COLORS = {
  c1: '72 100 175',   // 主色 (primary accent)
  c2: '232 228 223',  // 浅色表面 (light surface)
  c3: '73 71 74',     // 卡片底色 (card / input bg)
  c4: '195 188 181',  // 正文色 (body text)
  c5: '35 36 44',     // 最深底色 (deepest bg)
  iconFrom: '72 100 175',
  iconTo: '140 160 228',
}

// Build full palette from custom 5-color scheme
function buildCustomPalette(c) {
  const c1 = c.c1 || '99 102 241'    // primary accent
  const c2 = c.c2 || c.surface200 || '232 228 223'  // light surface
  const c3 = c.c3 || c.surface800 || '73 71 74'     // card bg
  const c4 = c.c4 || c.surface400 || '195 188 181'  // text
  const c5 = c.c5 || c.surface950 || '35 36 44'      // deep bg
  return {
    '--surface-950': c5,
    '--surface-900': c5,
    '--surface-850': c5,
    '--surface-800': c3,
    '--surface-700': c3,
    '--surface-600': c3,
    '--surface-500': c4,
    '--surface-400': c4,
    '--surface-300': c2,
    '--surface-200': c2,
    '--surface-100': c2,
    '--surface-50': c2,
    '--primary-500': c1,
    '--primary-400': c1,
    '--primary-600': c1,
    '--primary-300': c1,
    '--primary-700': c1,
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

  const [savedThemes, setSavedThemes] = useState([])  // [{id, label, colors}]

  // Apply theme attribute
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  }, [theme])

  // Apply app icon gradient colors
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'custom') {
      root.style.setProperty('--app-icon-from', customColors.iconFrom || customColors.c1 || customColors.primary500 || '99 102 241')
      root.style.setProperty('--app-icon-to', customColors.iconTo || customColors.primary300 || '165 180 252')
    } else {
      // Preset themes: CSS [data-theme] blocks define these, clear inline
      root.style.removeProperty('--app-icon-from')
      root.style.removeProperty('--app-icon-to')
    }
  }, [theme, customColors])

  // Apply custom CSS variables when theme is 'custom'
  useEffect(() => {
    const root = document.documentElement
    if (theme !== 'custom') {
      // Clean up custom inline vars so CSS [data-theme] rules take over
      const keys = [
        '--surface-950','--surface-900','--surface-850','--surface-800','--surface-700','--surface-600',
        '--surface-500','--surface-400','--surface-300','--surface-200','--surface-100','--surface-50',
        '--primary-500','--primary-400','--primary-600','--primary-300','--primary-700',
        '--app-icon-from','--app-icon-to','--scrollbar-thumb','--devtool-bg','--border-accent','--btn-text','--btn-text-4th','--color-1','--btn-text-1',
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
        // 写入 SQLite（保持兼容）
        await window.electronAPI.dbQuery(
          "INSERT OR REPLACE INTO settings (key, value) VALUES ('theme', ?)",
          [JSON.stringify({ id: t, custom: c || null })]
        )
        // 写入 user.json（统一配置）
        await window.electronAPI.setUserConfig('theme', { id: t, custom: c || null })
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

  // ── Saved themes CRUD ──
  const persistSavedThemes = useCallback(async (updated) => {
    try {
      if (window.electronAPI) {
        await window.electronAPI.setUserConfig('savedThemes', updated)
      }
    } catch (_) {}
  }, [])

  const saveNewTheme = useCallback(async (label, colors) => {
    const id = 'saved_' + Date.now()
    const entry = { id, label, colors: { ...colors } }
    const updated = [...savedThemes, entry]
    setSavedThemes(updated)
    await persistSavedThemes(updated)
    return entry
  }, [savedThemes, persistSavedThemes])

  const renameSavedTheme = useCallback(async (id, newLabel) => {
    const updated = savedThemes.map(t => t.id === id ? { ...t, label: newLabel } : t)
    setSavedThemes(updated)
    await persistSavedThemes(updated)
  }, [savedThemes, persistSavedThemes])

  const editSavedThemeColors = useCallback(async (id, colors) => {
    const updated = savedThemes.map(t => t.id === id ? { ...t, colors: { ...colors } } : t)
    setSavedThemes(updated)
    await persistSavedThemes(updated)
  }, [savedThemes, persistSavedThemes])

  const deleteSavedTheme = useCallback(async (id) => {
    const updated = savedThemes.filter(t => t.id !== id)
    setSavedThemes(updated)
    await persistSavedThemes(updated)
  }, [savedThemes, persistSavedThemes])

  // Apply saved theme colors (sets custom mode with saved colors)
  const applySavedTheme = useCallback((entry) => {
    setThemeState('custom')
    const colors = { ...entry.colors }
    setCustomColors(colors)
    localStorage.setItem(CUSTOM_COLORS_KEY, JSON.stringify(colors))
    persistToDb('custom', colors)
  }, [persistToDb])

  // Load from DB / user.json on mount
  useEffect(() => {
    if (!window.electronAPI) return
    // 优先从 user.json 读取（统一配置位置）
    window.electronAPI.getUserConfig()
      .then(res => {
        if (res?.success && res.config?.theme) {
          const stored = res.config.theme
          if (stored && typeof stored === 'object') {
            setThemeState(stored.id === 'genshin' ? 'slate' : (stored.id || DEFAULT_THEME))
            if (stored.custom) setCustomColors(stored.custom)
          }
        }
        if (res?.success && res.config?.savedThemes) {
          setSavedThemes(res.config.savedThemes)
        }
        if (res?.success && res.config?.theme) return // 已加载，跳过 SQLite
        // 回退：从 SQLite 读取
        return window.electronAPI.dbQuery("SELECT value FROM settings WHERE key = 'theme'")
      })
      .then(res => {
        if (!res?.data || res.data.length === 0) return
        try {
          const stored = JSON.parse(res.data[0].value)
          if (typeof stored === 'string' && THEMES[stored]) {
            setThemeState(stored)
          } else if (stored === 'genshin') {
            setThemeState('slate')
          } else if (stored && typeof stored === 'object') {
            setThemeState(stored.id === 'genshin' ? 'slate' : (stored.id || DEFAULT_THEME))
            if (stored.custom) setCustomColors(stored.custom)
          }
        } catch (_) {}
      })
      .catch(() => {})
  }, [])

  return (
    <ThemeContext.Provider value={{ theme, setTheme, themes: THEMES, customColors, updateCustomColors, savedThemes, saveNewTheme, renameSavedTheme, editSavedThemeColors, deleteSavedTheme, applySavedTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}

import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useDb } from '../context/DbContext'
import { useTheme, THEMES } from '../context/ThemeContext'
import { savePageStateSync } from '../utils/pageStateStore'
import {
  FolderOpen, RefreshCw, Database, AlertTriangle, CheckCircle2,
  Palette, Image, Upload, Settings, ChevronRight, Sparkles, Paintbrush,
  Wrench, Download, Upload as UploadIcon, FileCode, ShieldAlert,
  LayoutList, LayoutGrid, List, Info, Images, HardDrive
} from 'lucide-react'
import { PRESET_COLORS } from '../utils/colorMarkup'

// ── Module definitions ──────────────────────────────────────────────
const MODULES = [
  { key: 'general', label: '通用', icon: Settings, desc: '数据库位置与初始数据补缺' },
  { key: 'appearance', label: '外观', icon: Sparkles, desc: '颜色主题与默认视图模式' },
  { key: 'color-presets', label: '元素颜色', icon: Palette, desc: '自定义元素颜色与图标' },
  { key: 'version', label: '版本信息', icon: Info, desc: '查看软件版本与管理图包' },
  { key: 'advanced', label: '高级', icon: Wrench, desc: '开发者模式、备份导入与种子数据管理' },
]

// ── General Module ──────────────────────────────────────────────────
function GeneralModule() {
  const { dbPath, selectLocation, getDbPath, updateDatabase } = useDb()
  const [dbInfo, setDbInfo] = useState({ dbDir: null, isPopulated: false })
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState(null)

  useEffect(() => { refreshDbInfo() }, [dbPath])

  async function refreshDbInfo() {
    try {
      const info = await getDbPath()
      if (info.success) setDbInfo(info)
    } catch (_) {}
  }

  async function handleChangeFolder() {
    setLoading(true)
    setMessage(null)
    try {
      const result = await selectLocation()
      if (result.success) {
        await refreshDbInfo()
        if (result.needsSeed) {
          // selectLocation 已将 needsSetup 置为 true，SetupWizard 会自动接管流程
          setMessage({ type: 'success', text: `已选择: ${result.dbPath}，即将进入初始化...` })
        } else {
          // 选择了已有数据库的文件夹，刷新页面以加载数据
          setMessage({ type: 'success', text: `已切换到: ${result.dbPath}` })
          setTimeout(() => window.location.reload(), 500)
        }
      }
    } catch (e) {
      setMessage({ type: 'error', text: e.message })
    } finally {
      setLoading(false)
    }
  }

  async function handleUpdate() {
    if (!confirm('确定要更新数据库吗？\n\n此操作将添加缺失的初始数据，不会覆盖你已有的修改。')) return
    setLoading(true)
    setMessage(null)
    try {
      const result = await updateDatabase()
      if (result.success) {
        setMessage({ type: 'success', text: result.message || '数据更新完成' })
        await refreshDbInfo()
      } else if (result.error) {
        setMessage({ type: 'error', text: result.error })
      }
    } catch (e) {
      setMessage({ type: 'error', text: e.message })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Status / Message */}
      {message && (
        <div className={`p-4 rounded-xl text-sm flex items-center gap-3 animate-fade-in
          ${message.type === 'success'
            ? 'bg-green-500/10 border border-green-500/30 text-green-400'
            : 'bg-red-500/10 border border-red-500/30 text-red-400'
          }`}
        >
          {message.type === 'success'
            ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            : <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          }
          {message.text}
        </div>
      )}

      {/* Current path */}
      <div className="bg-surface-900/60 border border-surface-800 rounded-xl p-5 space-y-3">
        <div className="flex items-center gap-3">
          <Database className="w-5 h-5 text-primary-400 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-surface-400 mb-0.5">当前数据库位置</p>
            <p className="text-sm text-surface-200 font-mono truncate">
              {dbInfo.dbDir || '未设置'}
            </p>
          </div>
          {dbInfo.isPopulated && (
            <span className="text-xs px-2 py-1 rounded-full bg-green-500/10 text-green-400 border border-green-500/20 flex-shrink-0">
              已初始化
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="grid gap-3">
        {/* Change folder */}
        <button
          onClick={handleChangeFolder}
          disabled={loading}
          className="flex items-center gap-3 px-5 py-4 rounded-xl border border-surface-700
            bg-surface-900/60 hover:bg-surface-800/60 hover:border-surface-600
            transition-all duration-200 text-left group disabled:opacity-50"
        >
          <div className="w-10 h-10 rounded-lg bg-primary-500/10 flex items-center justify-center
            group-hover:bg-primary-500/20 transition-colors">
            <FolderOpen className="w-5 h-5 text-primary-400" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium">更换数据库文件夹</p>
            <p className="text-xs text-surface-400 mt-0.5">选择一个新的文件夹来存储或打开已有数据库</p>
          </div>
        </button>

        {/* Update data (add missing) */}
        <button
          onClick={handleUpdate}
          disabled={loading}
          className="flex items-center gap-3 px-5 py-4 rounded-xl border border-surface-700
            bg-surface-900/60 hover:bg-surface-800/60 hover:border-surface-600
            transition-all duration-200 text-left group disabled:opacity-50"
        >
          <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center
            group-hover:bg-amber-500/20 transition-colors">
            <RefreshCw className="w-5 h-5 text-amber-400" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium">初始数据补缺</p>
            <p className="text-xs text-surface-400 mt-0.5">
              添加缺失的角色/武器等初始数据，不会覆盖你已有的修改
            </p>
          </div>
        </button>
      </div>

      {/* Loading overlay */}
      {loading && (
        <div className="fixed inset-0 bg-surface-950/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="text-center">
            <div className="w-10 h-10 mx-auto mb-3 rounded-full border-2 border-primary-500 border-t-transparent animate-spin" />
            <p className="text-sm text-surface-400">处理中...</p>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Helpers ──
function hexToRgbTuple(hex) {
  const v = parseInt(hex.slice(1), 16)
  return `${(v >> 16) & 255} ${(v >> 8) & 255} ${v & 255}`
}
function rgbTupleToHex(tuple) {
  const [r, g, b] = tuple.split(' ').map(Number)
  return '#' + [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('')
}

// ── App Icon Section ──
function AppIconSection() {
  const [iconSrc, setIconSrc] = useState(() => {
    return localStorage.getItem('app_icon_preview') || null
  })
  const [iconFile, setIconFile] = useState(() => {
    return localStorage.getItem('app_icon') || null
  })

  async function handleExport() {
    const src = iconSrc || './UI_Talent_U_Columbina_02.webp'
    // Get theme gradient colors
    const style = getComputedStyle(document.documentElement)
    const fromColor = style.getPropertyValue('--primary-500').trim() || '99 102 241'
    const toColor = style.getPropertyValue('--accent-gold').trim()
    const toHex = toColor || '#d4a853'

    // Load image
    const img = new window.Image()
    img.crossOrigin = 'anonymous'
    await new Promise((resolve, reject) => {
      img.onload = resolve
      img.onerror = reject
      img.src = src
    })

    // Draw to canvas
    const size = 256
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')

    // Rounded rect clip
    const r = size * 0.2
    ctx.beginPath()
    ctx.moveTo(r, 0)
    ctx.lineTo(size - r, 0)
    ctx.quadraticCurveTo(size, 0, size, r)
    ctx.lineTo(size, size - r)
    ctx.quadraticCurveTo(size, size, size - r, size)
    ctx.lineTo(r, size)
    ctx.quadraticCurveTo(0, size, 0, size - r)
    ctx.lineTo(0, r)
    ctx.quadraticCurveTo(0, 0, r, 0)
    ctx.closePath()
    ctx.clip()

    // Gradient background
    const [fr, fg, fb] = fromColor.split(' ').map(Number)
    const grad = ctx.createLinearGradient(0, 0, size, size)
    grad.addColorStop(0, `rgb(${fr},${fg},${fb})`)
    grad.addColorStop(1, toHex)
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, size, size)

    // Icon image
    const pad = size * 0.15
    ctx.drawImage(img, pad, pad, size - pad * 2, size - pad * 2)

    // Export
    if (window.electronAPI?.exportImageFile) {
      canvas.toBlob(async (blob) => {
        if (!blob) return
        const buffer = await blob.arrayBuffer()
        const result = await window.electronAPI.exportImageFile(Array.from(new Uint8Array(buffer)), 'app_icon.png')
        if (result?.success) {
          // Success — no need to alert, user already chose location
        }
      }, 'image/png')
    } else {
      const dataUrl = canvas.toDataURL('image/png')
      const a = document.createElement('a')
      a.href = dataUrl
      a.download = 'app_icon.png'
      a.click()
    }
  }

  async function handleImport() {
    if (!window.electronAPI) return
    const res = await window.electronAPI.importUserImage()
    if (res?.filename) {
      const data = await window.electronAPI.readUserImage(res.filename)
      if (data?.data) {
        setIconSrc(data.data)
        setIconFile(res.filename)
        localStorage.setItem('app_icon', res.filename)
        localStorage.setItem('app_icon_preview', data.data)
        // Persist to DB
        try {
          await window.electronAPI.dbQuery(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('app_icon', ?)",
            [JSON.stringify(res.filename)]
          )
        } catch (_) {}
        // Notify sidebar
        window.dispatchEvent(new CustomEvent('app-icon-changed'))
      }
    }
  }

  async function handleReset() {
    setIconSrc(null)
    setIconFile(null)
    localStorage.removeItem('app_icon')
    localStorage.removeItem('app_icon_preview')
    try {
      await window.electronAPI?.dbQuery("DELETE FROM settings WHERE key = 'app_icon'")
    } catch (_) {}
    window.dispatchEvent(new CustomEvent('app-icon-changed'))
  }

  return (
    <div className="bg-surface-900/60 border border-surface-800 rounded-xl p-5 space-y-4">
      <div className="flex items-center gap-3">
        <Image className="w-5 h-5 text-primary-400 flex-shrink-0" />
        <div className="flex-1">
          <p className="text-sm font-medium">应用图标</p>
          <p className="text-xs text-surface-400 mt-0.5">自定义侧边栏的应用图标（白色部分），推荐透明底方形 PNG</p>
        </div>
      </div>
      <div className="flex items-center gap-4">
        {/* Preview */}
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary-500 to-accent-gold flex items-center justify-center overflow-hidden flex-shrink-0 shadow-lg">
          <img src={iconSrc || './UI_Talent_U_Columbina_02.webp'} alt="" className="w-full h-full object-cover" />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleImport}
            className="px-3 py-1.5 rounded-lg text-xs bg-primary-600 hover:bg-primary-500 text-white transition-colors flex items-center gap-1.5"
          >
            <Upload className="w-3.5 h-3.5" />导入图片
          </button>
          <button
            onClick={handleExport}
            className="px-3 py-1.5 rounded-lg text-xs bg-surface-700 hover:bg-surface-600 text-surface-300 transition-colors flex items-center gap-1.5"
            title="导出为带背景的完整图标"
          >
            <Download className="w-3.5 h-3.5" />导出
          </button>
          {iconFile && (
            <button
              onClick={handleReset}
              className="px-3 py-1.5 rounded-lg text-xs bg-surface-700 hover:bg-surface-600 text-surface-300 transition-colors"
            >
              恢复默认
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Appearance Module ──────────────────────────────────────────────
function AppearanceModule() {
  const { theme, setTheme, themes, customColors, updateCustomColors } = useTheme()
  const [viewDefaults, setViewDefaults] = useState(() => {
    try {
      const saved = localStorage.getItem('default_view_mode')
      return saved ? JSON.parse(saved) : { characters: 'table', weapons: 'table', artifacts: 'table', materials: 'table', wishes: 'detail' }
    } catch (_) { return { characters: 'table', weapons: 'table', artifacts: 'table', materials: 'table', wishes: 'detail' } }
  })
  const [message, setMessage] = useState(null)

  // Load from DB on mount — only fill in keys missing from localStorage
  useEffect(() => {
    if (!window.electronAPI) return
    window.electronAPI.dbQuery("SELECT value FROM settings WHERE key = 'default_view_mode'")
      .then(res => {
        if (res?.data?.length > 0) {
          try {
            const stored = JSON.parse(res.data[0].value)
            if (stored && typeof stored === 'object') {
              setViewDefaults(prev => {
                // Don't override keys already present in localStorage
                const merged = { ...stored, ...prev }
                return merged
              })
            }
          } catch (_) {}
        }
      })
      .catch(() => {})
  }, [])

  function setViewMode(section, mode) {
    const next = { ...viewDefaults, [section]: mode }
    setViewDefaults(next)
    localStorage.setItem('default_view_mode', JSON.stringify(next))
    // Update page state cache so list pages pick up immediately
    savePageStateSync(section, 0, { viewMode: mode })
    // Persist to DB
    try {
      window.electronAPI?.dbQuery(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('default_view_mode', ?)",
        [JSON.stringify(next)]
      )
    } catch (_) {}
  }

  const themeList = Object.values(themes)

  const sections = [
    { key: 'characters', label: '角色' },
    { key: 'weapons', label: '武器' },
    { key: 'artifacts', label: '圣遗物' },
    { key: 'materials', label: '材料' },
  ]

  return (
    <div className="space-y-6">
      {message && (
        <div className={`p-4 rounded-xl text-sm flex items-center gap-3 animate-fade-in
          ${message.type === 'success'
            ? 'bg-green-500/10 border border-green-500/30 text-green-400'
            : 'bg-red-500/10 border border-red-500/30 text-red-400'
          }`}
        >
          {message.type === 'success' ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> : <AlertTriangle className="w-4 h-4 flex-shrink-0" />}
          {message.text}
        </div>
      )}

      {/* ── Color theme ── */}
      <div className="bg-surface-900/60 border border-surface-800 rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-3">
          <Sparkles className="w-5 h-5 text-primary-400 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium">颜色主题</p>
            <p className="text-xs text-surface-400 mt-0.5">选择应用的 UI 配色方案</p>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {themeList.map(t => {
            const isActive = theme === t.id
            return (
              <button
                key={t.id}
                onClick={() => setTheme(t.id)}
                className={`relative p-3 rounded-xl border text-left transition-all duration-200
                  ${isActive
                    ? 'border-primary-500 bg-primary-500/10 ring-1 ring-primary-500/30'
                    : 'border-surface-700 bg-surface-800/40 hover:border-surface-600 hover:bg-surface-800/60'
                  }`}
              >
                {/* Color swatches */}
                <div className="flex gap-1 mb-2">
                  {t.colors.map((c, i) => (
                    <div key={i} className="w-5 h-5 rounded-full border border-white/10 flex-shrink-0" style={{ backgroundColor: c }} />
                  ))}
                </div>
                <p className={`text-sm font-medium ${isActive ? 'text-primary-300' : 'text-surface-200'}`}>{t.label}</p>
                <p className="text-[11px] text-surface-500 mt-0.5">{t.desc}</p>
                {isActive && (
                  <div className="absolute top-2 right-2 w-4 h-4 rounded-full bg-primary-500 flex items-center justify-center">
                    <CheckCircle2 className="w-3 h-3 text-white" />
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Custom theme editor ── */}
      {theme === 'custom' && (
        <div className="bg-surface-900/60 border border-surface-800 rounded-xl p-5 space-y-4 animate-slide-up">
          <div className="flex items-center gap-3">
            <Paintbrush className="w-5 h-5 text-primary-400 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium">自定义配色</p>
              <p className="text-xs text-surface-400 mt-0.5">调整关键颜色，系统自动生成完整调色板</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[
              { key: 'primary500', label: '主色调', desc: '按钮、链接等' },
              { key: 'surface950', label: '页面背景', desc: '最深底色' },
              { key: 'surface800', label: '卡片/输入框', desc: '内容容器背景' },
              { key: 'surface700', label: '激活态', desc: '选中按钮/切换' },
              { key: 'surface500', label: '占位文字', desc: '提示/禁用文字' },
              { key: 'surface400', label: '正文', desc: '默认文字颜色' },
            ].map(field => {
              const hex = rgbTupleToHex(customColors[field.key] || '128 128 128')
              return (
                <div key={field.key} className="flex items-center gap-3 p-2.5 rounded-lg bg-surface-800/40 border border-surface-700">
                  <div className="relative">
                    <input
                      type="color"
                      value={hex}
                      onChange={e => {
                        const rgb = hexToRgbTuple(e.target.value)
                        updateCustomColors({ [field.key]: rgb })
                      }}
                      className="w-10 h-10 rounded-lg cursor-pointer border-0 p-0 bg-transparent"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-surface-200">{field.label}</p>
                    <p className="text-[10px] text-surface-500">{field.desc}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── 应用图标 ── */}
      <AppIconSection />

      {/* ── Default view mode ── */}
      <div className="bg-surface-900/60 border border-surface-800 rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-3">
          <LayoutGrid className="w-5 h-5 text-primary-400 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium">默认视图模式</p>
            <p className="text-xs text-surface-400 mt-0.5">设置各板块进入时默认显示列表还是画廊</p>
          </div>
        </div>
        <div className="space-y-3">
          {sections.map(s => (
            <div key={s.key} className="flex items-center justify-between p-3 rounded-lg bg-surface-800/40 border border-surface-700">
              <span className="text-sm text-surface-200">{s.label}</span>
              <div className="flex items-center rounded-lg bg-surface-700 border border-surface-600 p-0.5">
                <button
                  onClick={() => setViewMode(s.key, 'table')}
                  className={`px-3 py-1.5 rounded-md text-xs transition-colors flex items-center gap-1.5
                    ${viewDefaults[s.key] === 'table' ? 'bg-surface-600 text-white' : 'text-surface-400 hover:text-surface-200'}`}
                >
                  <LayoutList className="w-3.5 h-3.5" />列表
                </button>
                <button
                  onClick={() => setViewMode(s.key, 'gallery')}
                  className={`px-3 py-1.5 rounded-md text-xs transition-colors flex items-center gap-1.5
                    ${viewDefaults[s.key] === 'gallery' ? 'bg-surface-600 text-white' : 'text-surface-400 hover:text-surface-200'}`}
                >
                  <LayoutGrid className="w-3.5 h-3.5" />画廊
                </button>
              </div>
            </div>
          ))}
          {/* 祈愿板块：卡池图 vs 详情（独立于列表/画廊） */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-surface-800/40 border border-surface-700">
            <span className="text-sm text-surface-200">祈愿</span>
            <div className="flex items-center rounded-lg bg-surface-700 border border-surface-600 p-0.5">
              <button
                onClick={() => setViewMode('wishes', 'images')}
                className={`px-3 py-1.5 rounded-md text-xs transition-colors flex items-center gap-1.5
                  ${viewDefaults.wishes === 'images' ? 'bg-surface-600 text-white' : 'text-surface-400 hover:text-surface-200'}`}
              >
                <Image className="w-3.5 h-3.5" />卡池图
              </button>
              <button
                onClick={() => setViewMode('wishes', 'detail')}
                className={`px-3 py-1.5 rounded-md text-xs transition-colors flex items-center gap-1.5
                  ${viewDefaults.wishes !== 'images' ? 'bg-surface-600 text-white' : 'text-surface-400 hover:text-surface-200'}`}
              >
                <List className="w-3.5 h-3.5" />详情
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Color Presets Module ────────────────────────────────────────────
function ColorPresetsModule() {
  const { importImage, readImage } = useDb()
  const [elementColors, setElementColors] = useState(PRESET_COLORS.slice(0, 7).map(c => ({ ...c, icon: '' })))
  const [colorSaving, setColorSaving] = useState(false)
  const [iconPreviews, setIconPreviews] = useState({})
  const [message, setMessage] = useState(null)

  useEffect(() => { loadElementColors() }, [])

  // Load icon previews
  useEffect(() => {
    elementColors.forEach(c => {
      if (c.icon && !iconPreviews[c.icon]) {
        readImage(c.icon).then(data => {
          if (data) setIconPreviews(prev => ({ ...prev, [c.icon]: data }))
        })
      }
    })
  }, [elementColors, readImage])

  async function loadElementColors() {
    try {
      const res = await window.electronAPI?.dbQuery("SELECT value FROM settings WHERE key = 'element_colors'")
      if (res?.data?.length > 0) {
        const stored = JSON.parse(res.data[0].value)
        if (Array.isArray(stored) && stored.length === 7) {
          setElementColors(stored.map((c, i) => ({
            label: PRESET_COLORS[i].label,
            color: c.color || PRESET_COLORS[i].color,
            icon: c.icon || ''
          })))
        }
      }
    } catch (_) {}
  }

  async function saveElementColors() {
    setColorSaving(true)
    try {
      const json = JSON.stringify(elementColors.map(c => ({ color: c.color, icon: c.icon || '' })))
      await window.electronAPI?.dbQuery("INSERT OR REPLACE INTO settings (key, value) VALUES ('element_colors', ?)", [json])
      setMessage({ type: 'success', text: '元素颜色已保存' })
    } catch (e) {
      setMessage({ type: 'error', text: '保存失败: ' + e.message })
    } finally {
      setColorSaving(false)
    }
  }

  function resetElementColors() {
    setElementColors(prev => PRESET_COLORS.slice(0, 7).map((c, i) => ({ ...c, icon: prev[i]?.icon || '' })))
  }

  async function handleImportIcon(idx) {
    const filename = await importImage()
    if (filename) setIcon(idx, filename)
  }

  function setIcon(idx, filename) {
    const next = [...elementColors]
    next[idx] = { ...next[idx], icon: filename }
    setElementColors(next)
  }

  async function handleIconDrop(idx, e) {
    e.preventDefault()
    e.stopPropagation()
    const files = e.dataTransfer?.files
    if (!files?.length) return
    for (const file of files) {
      if (file.type.startsWith('image/')) {
        const result = await window.electronAPI?.importImageFile(file.path)
        if (result?.filename) setIcon(idx, result.filename)
        break
      }
    }
  }

  return (
    <div className="space-y-6">
      {/* Status / Message */}
      {message && (
        <div className={`p-4 rounded-xl text-sm flex items-center gap-3 animate-fade-in
          ${message.type === 'success'
            ? 'bg-green-500/10 border border-green-500/30 text-green-400'
            : 'bg-red-500/10 border border-red-500/30 text-red-400'
          }`}
        >
          {message.type === 'success'
            ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            : <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          }
          {message.text}
        </div>
      )}

      <div className="bg-surface-900/60 border border-surface-800 rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-3">
          <Palette className="w-5 h-5 text-primary-400 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium">元素颜色</p>
            <p className="text-xs text-surface-400 mt-0.5">自定义七种元素对应的颜色预设，编辑器中可直接选用</p>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {elementColors.map((c, i) => (
            <div key={i} className="flex flex-col gap-2 p-3 rounded-lg bg-surface-800/50 border border-surface-700">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleImportIcon(i)}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation() }}
                  onDragLeave={(e) => { e.preventDefault() }}
                  onDrop={(e) => handleIconDrop(i, e)}
                  className="w-10 h-10 rounded-lg border-2 border-dashed border-surface-500 hover:border-primary-500 flex items-center justify-center flex-shrink-0 overflow-hidden bg-surface-700 transition-colors group/icon"
                  title="点击导入或拖拽图片"
                >
                  {iconPreviews[c.icon] ? (
                    <img src={iconPreviews[c.icon]} alt="" className="w-full h-full object-cover" />
                  ) : c.icon ? (
                    <Upload className="w-4 h-4 text-surface-500" />
                  ) : (
                    <Image className="w-4 h-4 text-surface-500 group-hover/icon:text-primary-400" />
                  )}
                </button>
                <div className="flex-1 min-w-0">
                  <input
                    type="color"
                    value={c.color}
                    onChange={e => {
                      const next = [...elementColors]
                      next[i] = { ...next[i], color: e.target.value }
                      setElementColors(next)
                    }}
                    className="w-full h-8 rounded cursor-pointer border-0 p-0 bg-transparent"
                  />
                  <span className="text-xs text-surface-300 block text-center">{c.label}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={saveElementColors}
            disabled={colorSaving}
            className="px-4 py-1.5 rounded-lg bg-primary-600 hover:bg-primary-500 text-xs font-medium text-white transition-colors disabled:opacity-50"
          >
            {colorSaving ? '保存中...' : '保存颜色'}
          </button>
          <button
            onClick={resetElementColors}
            className="px-4 py-1.5 rounded-lg bg-surface-700 hover:bg-surface-600 text-xs text-surface-300 transition-colors"
          >
            恢复默认
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Version Info Module ─────────────────────────────────────────────
function VersionInfoModule() {
  const [appVersion, setAppVersion] = useState('1.0')
  const [packs, setPacks] = useState([])
  const [activePack, setActivePack] = useState('images')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState(null)

  useEffect(() => {
    loadVersionInfo()
    loadImagePacks()
  }, [])

  async function loadVersionInfo() {
    try {
      if (window.electronAPI?.getAppVersion) {
        const r = await window.electronAPI.getAppVersion()
        if (r?.version) setAppVersion(r.version)
      }
    } catch (_) {}
  }

  async function loadImagePacks() {
    try {
      if (window.electronAPI?.listImagePacks) {
        const r = await window.electronAPI.listImagePacks()
        if (r?.success) {
          setPacks(r.packs || [])
          setActivePack(r.active || 'images')
        }
      }
    } catch (_) {}
  }

  async function handleSelectPack(packName) {
    setLoading(true)
    setMessage(null)
    try {
      if (window.electronAPI?.setActiveImagePack) {
        const r = await window.electronAPI.setActiveImagePack(packName)
        if (r?.success) {
          setActivePack(packName)
          setMessage({ type: 'success', text: `已切换图包为: ${packName}` })
        } else {
          setMessage({ type: 'error', text: r.error || '切换失败' })
        }
      }
    } catch (e) {
      setMessage({ type: 'error', text: e.message })
    } finally {
      setLoading(false)
    }
  }

  async function handleAutoSelect() {
    setLoading(true)
    setMessage(null)
    try {
      if (window.electronAPI?.clearActiveImagePack) {
        await window.electronAPI.clearActiveImagePack()
      }
      await loadImagePacks()
      setMessage({ type: 'success', text: '已恢复自动选择（系统默认优先级）' })
    } catch (e) {
      setMessage({ type: 'error', text: e.message })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Status / Message */}
      {message && (
        <div className={`p-4 rounded-xl text-sm flex items-center gap-3 animate-fade-in
          ${message.type === 'success'
            ? 'bg-green-500/10 border border-green-500/30 text-green-400'
            : 'bg-red-500/10 border border-red-500/30 text-red-400'
          }`}
        >
          {message.type === 'success'
            ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            : <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          }
          {message.text}
        </div>
      )}

      {/* App Version */}
      <div className="bg-surface-900/60 border border-surface-800 rounded-xl p-5">
        <div className="flex items-center gap-3">
          <Info className="w-5 h-5 text-primary-400 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium">软件版本</p>
            <p className="text-xs text-surface-400 mt-0.5">当前运行的 SilverMoon Terminal 版本</p>
          </div>
          <span className="ml-auto text-lg font-bold text-primary-400">v{appVersion}</span>
        </div>
      </div>

      {/* Image Packs */}
      <div className="bg-surface-900/60 border border-surface-800 rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-3">
          <Images className="w-5 h-5 text-primary-400 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium">图包管理</p>
            <p className="text-xs text-surface-400 mt-0.5">
              数据库文件夹中检测到 {packs.length} 个图包，可手动选择使用的图包
            </p>
          </div>
          {packs.length > 1 && (
            <button
              onClick={handleAutoSelect}
              disabled={loading}
              className="px-3 py-1.5 rounded-lg text-xs bg-surface-700 hover:bg-surface-600 text-surface-300 transition-colors disabled:opacity-50"
            >
              恢复自动
            </button>
          )}
        </div>

        {packs.length === 0 ? (
          <div className="text-center py-6 text-surface-500 text-sm">
            <HardDrive className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p>数据库文件夹中暂未检测到图包</p>
            <p className="text-xs mt-1">系统将自动创建默认 images 文件夹</p>
          </div>
        ) : (
          <div className="grid gap-2">
            {packs.map(pack => {
              const isActive = pack.name === activePack
              return (
                <button
                  key={pack.name}
                  onClick={() => handleSelectPack(pack.name)}
                  disabled={loading || isActive}
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-all duration-150
                    ${isActive
                      ? 'bg-primary-500/10 border border-primary-500/30 text-primary-300'
                      : 'border border-surface-700 bg-surface-800/40 hover:bg-surface-800/60 hover:border-surface-600 text-surface-300'
                    } disabled:opacity-60`}
                >
                  <Images className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-primary-400' : 'text-surface-500'}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{pack.name}</p>
                    <p className="text-xs text-surface-500">{pack.sizeFormatted}</p>
                  </div>
                  {isActive && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-primary-500/20 text-primary-400 border border-primary-500/30 flex-shrink-0">
                      使用中
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        )}

        <div className="text-xs text-surface-500 bg-surface-800/40 rounded-lg p-3 space-y-1">
          <p className="font-medium text-surface-400 mb-1">图包选择优先级说明：</p>
          <p>1. <code className="text-primary-400 bg-surface-700 px-1 rounded">images-版本号-类型</code> 格式的文件夹优先（版本越新越优先，同版本 Extrême &gt; Medium &gt; Lite）</p>
          <p>2. 名称为 <code className="text-primary-400 bg-surface-700 px-1 rounded">images</code> 的文件夹</p>
          <p>3. 剩余文件夹中大小最大的</p>
        </div>
      </div>

      {/* Loading overlay */}
      {loading && (
        <div className="fixed inset-0 bg-surface-950/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="text-center">
            <div className="w-10 h-10 mx-auto mb-3 rounded-full border-2 border-primary-500 border-t-transparent animate-spin" />
            <p className="text-sm text-surface-400">切换中...</p>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Advanced Module ─────────────────────────────────────────────────
function AdvancedModule() {
  const { devMode, toggleDevMode, backupDatabase, importDatabase, exportSeed, updateDatabase, initSchema } = useDb()
  const [message, setMessage] = useState(null)
  const [loading, setLoading] = useState(false)

  async function handleBackup() {
    setLoading(true)
    setMessage(null)
    try {
      const result = await backupDatabase()
      if (result.success) {
        setMessage({ type: 'success', text: `备份完成: ${result.destPath}` })
      } else if (result.message === '已取消') {
        // 用户取消，不提示
      } else {
        setMessage({ type: 'error', text: result.error || '备份失败' })
      }
    } catch (e) {
      setMessage({ type: 'error', text: e.message })
    } finally {
      setLoading(false)
    }
  }

  async function handleImport() {
    if (!confirm('导入数据库将替换当前所有数据，确定要继续吗？')) return
    if (!confirm('再次确认：此操作不可逆，当前数据库将被替换为导入的文件。确定继续？')) return
    setLoading(true)
    setMessage(null)
    try {
      const result = await importDatabase()
      if (result.success) {
        setMessage({ type: 'success', text: '数据库已导入，即将刷新...' })
        setTimeout(() => window.location.reload(), 800)
      } else if (result.message === '已取消') {
        // 用户取消
      } else {
        setMessage({ type: 'error', text: result.error || '导入失败' })
      }
    } catch (e) {
      setMessage({ type: 'error', text: e.message })
    } finally {
      setLoading(false)
    }
  }

  async function handleExportSeed() {
    if (!confirm('更新种子数据将根据当前数据库内容重新生成 seed.sql 文件，确定要继续吗？')) return
    setLoading(true)
    setMessage(null)
    try {
      const result = await exportSeed()
      if (result.success) {
        setMessage({ type: 'success', text: result.output || '种子数据已更新' })
      } else {
        setMessage({ type: 'error', text: result.error || '更新失败' })
      }
    } catch (e) {
      setMessage({ type: 'error', text: e.message })
    } finally {
      setLoading(false)
    }
  }

  async function handleReinit() {
    if (!confirm('确定要重新初始化数据库吗？\n\n此操作将删除所有现有数据（包括你添加的数据），重新创建数据库。')) return
    setLoading(true)
    setMessage(null)
    try {
      const result = await initSchema()
      if (result.success) {
        setMessage({ type: 'success', text: result.message || '数据库已重新初始化' })
        setTimeout(() => window.location.reload(), 800)
      } else if (result.error) {
        setMessage({ type: 'error', text: result.error })
      }
    } catch (e) {
      setMessage({ type: 'error', text: e.message })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Status / Message */}
      {message && (
        <div className={`p-4 rounded-xl text-sm flex items-center gap-3 animate-fade-in
          ${message.type === 'success'
            ? 'bg-green-500/10 border border-green-500/30 text-green-400'
            : 'bg-red-500/10 border border-red-500/30 text-red-400'
          }`}
        >
          {message.type === 'success'
            ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            : <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          }
          {message.text}
        </div>
      )}

      {/* Developer Mode Toggle */}
      <div className="bg-surface-900/60 border border-surface-800 rounded-xl p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ShieldAlert className="w-5 h-5 text-amber-400 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium">开发者模式</p>
              <p className="text-xs text-surface-400 mt-0.5">开启后将解锁开发者功能（如数据清空等危险操作）</p>
            </div>
          </div>
          <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
            <input
              type="checkbox"
              checked={devMode}
              onChange={toggleDevMode}
              className="sr-only peer"
            />
            <div className="w-10 h-5 bg-surface-600 peer-checked:bg-amber-500 rounded-full transition-colors
              after:content-[''] after:absolute after:top-0.5 after:left-0.5
              after:bg-white after:rounded-full after:h-4 after:w-4
              after:transition-transform peer-checked:after:translate-x-[18px]"
            />
          </label>
        </div>
      </div>

      {/* Database Operations */}
      <div className="bg-surface-900/60 border border-surface-800 rounded-xl p-5 space-y-3">
        <div className="flex items-center gap-3 mb-2">
          <Database className="w-5 h-5 text-primary-400 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium">数据库操作</p>
            <p className="text-xs text-surface-400 mt-0.5">备份、导入与种子数据管理</p>
          </div>
        </div>

        <div className="grid gap-3">
          {/* Backup */}
          <button
            onClick={handleBackup}
            disabled={loading}
            className="flex items-center gap-3 px-5 py-4 rounded-xl border border-surface-700
              bg-surface-900/60 hover:bg-surface-800/60 hover:border-surface-600
              transition-all duration-200 text-left group disabled:opacity-50"
          >
            <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center
              group-hover:bg-green-500/20 transition-colors">
              <Download className="w-5 h-5 text-green-400" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium">备份数据库</p>
              <p className="text-xs text-surface-400 mt-0.5">将数据库文件复制到指定文件夹</p>
            </div>
          </button>

          {/* Import */}
          <button
            onClick={handleImport}
            disabled={loading}
            className="flex items-center gap-3 px-5 py-4 rounded-xl border border-surface-700
              bg-surface-900/60 hover:bg-surface-800/60 hover:border-surface-600
              transition-all duration-200 text-left group disabled:opacity-50"
          >
            <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center
              group-hover:bg-red-500/20 transition-colors">
              <UploadIcon className="w-5 h-5 text-red-400" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium">导入数据库</p>
              <p className="text-xs text-surface-400 mt-0.5">选择 .db 文件替换当前数据库（需要二次确认）</p>
            </div>
          </button>

          {/* Update Seed */}
          <button
            onClick={handleExportSeed}
            disabled={loading}
            className="flex items-center gap-3 px-5 py-4 rounded-xl border border-surface-700
              bg-surface-900/60 hover:bg-surface-800/60 hover:border-surface-600
              transition-all duration-200 text-left group disabled:opacity-50"
          >
            <div className="w-10 h-10 rounded-lg bg-primary-500/10 flex items-center justify-center
              group-hover:bg-primary-500/20 transition-colors">
              <FileCode className="w-5 h-5 text-primary-400" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium">更新种子数据</p>
              <p className="text-xs text-surface-400 mt-0.5">根据当前数据库内容更新 seed.sql 种子文件</p>
            </div>
          </button>

          {/* Reinitialize (full reset) */}
          <button
            onClick={handleReinit}
            disabled={loading}
            className="flex items-center gap-3 px-5 py-4 rounded-xl border border-red-500/20
              bg-red-500/5 hover:bg-red-500/10 hover:border-red-500/30
              transition-all duration-200 text-left group disabled:opacity-50"
          >
            <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center
              group-hover:bg-red-500/20 transition-colors">
              <AlertTriangle className="w-5 h-5 text-red-400" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-red-400">重新初始化数据库</p>
              <p className="text-xs text-surface-400 mt-0.5">
                删除所有数据并重新创建，此操作不可逆
              </p>
            </div>
          </button>
        </div>
      </div>

      {/* Loading overlay */}
      {loading && (
        <div className="fixed inset-0 bg-surface-950/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="text-center">
            <div className="w-10 h-10 mx-auto mb-3 rounded-full border-2 border-primary-500 border-t-transparent animate-spin" />
            <p className="text-sm text-surface-400">处理中...</p>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main Settings Page ──────────────────────────────────────────────
export default function SettingsPage() {
  const [searchParams] = useSearchParams()
  const [activeModule, setActiveModule] = useState(() => {
    // Check URL query param for initial module selection
    const moduleParam = searchParams.get('module')
    if (moduleParam && MODULES.some(m => m.key === moduleParam)) return moduleParam
    return 'general'
  })

  const panelMap = {
    general: GeneralModule,
    appearance: AppearanceModule,
    'color-presets': ColorPresetsModule,
    version: VersionInfoModule,
    advanced: AdvancedModule,
  }
  const ActivePanel = panelMap[activeModule]
  const activeMeta = MODULES.find(m => m.key === activeModule)

  return (
    <div className="flex h-full animate-fade-in">
      {/* ── Left: Module List ── */}
      <aside className="w-56 flex-shrink-0 border-r border-surface-800 bg-surface-950/50 p-4 space-y-1">
        <h2 className="text-xs font-semibold text-surface-500 uppercase tracking-wider mb-3 px-2">
          设置
        </h2>
        {MODULES.map(m => {
          const Icon = m.icon
          const isActive = m.key === activeModule
          return (
            <button
              key={m.key}
              onClick={() => setActiveModule(m.key)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all duration-150 group
                ${isActive
                  ? 'bg-primary-500/10 border border-primary-500/20 text-primary-300'
                  : 'border border-transparent text-surface-400 hover:text-surface-200 hover:bg-surface-800/60'
                }`}
            >
              <Icon className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-primary-400' : ''}`} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{m.label}</p>
                <p className="text-[11px] text-surface-500 truncate">{m.desc}</p>
              </div>
              {isActive && <ChevronRight className="w-4 h-4 text-primary-400 flex-shrink-0" />}
            </button>
          )
        })}
      </aside>

      {/* ── Right: Module Panel ── */}
      <main className="flex-1 min-w-0 overflow-y-auto p-8">
        {/* Module header */}
        <div className="mb-6">
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2.5">
            {activeMeta && <activeMeta.icon className="w-6 h-6 text-primary-400" />}
            {activeMeta?.label}
          </h1>
          <p className="text-surface-400 text-sm mt-1 ml-8.5">{activeMeta?.desc}</p>
        </div>

        <ActivePanel />
      </main>
    </div>
  )
}

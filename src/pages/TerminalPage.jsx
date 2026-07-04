import { useState, useEffect, useRef, useCallback } from 'react'
import { useDb } from '../context/DbContext'
import { useTerminal } from '../context/TerminalContext'
import { APPS } from '../components/TerminalDock'
import {
  X, Minus, Square, Copy, Monitor, ChevronLeft,
  FolderOpen, LayoutList, LayoutGrid,
  Upload, PaintBucket, Settings,
  File, FileText, Image, Database, Code, Search
} from 'lucide-react'

const GRID_COLS = 6
const GRID_CELL = 110 // px per cell

// ═══════════════════════════════════════════════
// 桌面图标组件
// ═══════════════════════════════════════════════
function DesktopIcon({ app, onClick, position, onDragEnd, gridRef, settled }) {
  const [dragging, setDragging] = useState(false)
  const iconRef = useRef(null)
  const dragOffset = useRef({ x: 0, y: 0 })
  const dragStartPos = useRef({ x: 0, y: 0 })

  const handleMouseDown = useCallback((e) => {
    if (e.button !== 0) return
    e.preventDefault()
    dragStartPos.current = { x: e.clientX, y: e.clientY }
    const rect = iconRef.current.getBoundingClientRect()
    dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    setDragging(true)
  }, [])

  const handleClick = useCallback((e) => {
    e.stopPropagation()
    const dx = Math.abs(e.clientX - dragStartPos.current.x)
    const dy = Math.abs(e.clientY - dragStartPos.current.y)
    if (dx > 3 || dy > 3) return
    onClick(app)
  }, [app, onClick])

  useEffect(() => {
    if (!dragging) return

    const handleMove = (e) => {
      const grid = gridRef.current
      if (!grid) return
      const gridRect = grid.getBoundingClientRect()
      const x = e.clientX - gridRect.left - dragOffset.current.x + GRID_CELL / 2
      const y = e.clientY - gridRect.top - dragOffset.current.y + GRID_CELL / 2
      const col = Math.max(0, Math.min(GRID_COLS - 1, Math.floor(x / GRID_CELL)))
      const row = Math.max(0, Math.floor(y / GRID_CELL))
      onDragEnd?.(app.id, col, row)
    }

    const handleUp = () => setDragging(false)

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [dragging, app.id, onDragEnd, gridRef])

  const { col = 0, row = 0 } = position || {}
  const AppIcon = app.icon

  return (
    <div
      ref={iconRef}
      className="absolute flex flex-col items-center gap-1.5 cursor-pointer group select-none"
      style={{
        left: col * GRID_CELL + (GRID_CELL - 80) / 2,
        top: row * GRID_CELL + 8,
        width: 80,
        transition: !settled || dragging ? 'none' : 'left 0.15s ease, top 0.15s ease',
        zIndex: dragging ? 50 : 1,
      }}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
    >
      <div className={`w-16 h-16 rounded-2xl border border-white/20 flex items-center justify-center bg-gradient-to-br ${app.color || 'from-white/10 to-white/5'} backdrop-blur-sm
        group-hover:scale-105 group-hover:shadow-lg group-hover:border-white/30 transition-all duration-150
        ${dragging ? 'scale-110 shadow-xl' : ''}`}
      >
        <AppIcon className={`w-8 h-8 ${app.iconClass || 'text-white drop-shadow-md'}`} />
      </div>
      <span className="text-[11px] text-white/80 text-center leading-tight drop-shadow-md px-1 py-0.5 rounded
        group-hover:bg-white/10 transition-colors">
        {app.name}
      </span>
    </div>
  )
}

// ═══════════════════════════════════════════════
// 红绿灯组件（关闭/隐藏/全屏）
// ═══════════════════════════════════════════════
function TrafficLights({ onClose, onHide, onFullscreen, isFullscreen }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <button
        onClick={onClose}
        className="w-3.5 h-3.5 rounded-full bg-red-500 hover:bg-red-400 transition-colors flex items-center justify-center group"
        title="关闭"
      >
        <X className="w-2 h-2 text-red-900 opacity-0 group-hover:opacity-100 transition-opacity" />
      </button>
      <button
        onClick={onHide}
        className="w-3.5 h-3.5 rounded-full bg-yellow-500 hover:bg-yellow-400 transition-colors flex items-center justify-center group"
        title="隐藏"
      >
        <Minus className="w-2 h-2 text-yellow-900 opacity-0 group-hover:opacity-100 transition-opacity" />
      </button>
      <button
        onClick={onFullscreen}
        className="w-3.5 h-3.5 rounded-full bg-green-500 hover:bg-green-400 transition-colors flex items-center justify-center group"
        title={isFullscreen ? '还原' : '全屏'}
      >
        <Copy className={`w-1.5 h-1.5 text-green-900 opacity-0 group-hover:opacity-100 transition-opacity ${isFullscreen ? 'rotate-180' : ''}`} />
      </button>
    </div>
  )
}

// ═══════════════════════════════════════════════
// 应用窗口组件
// ═══════════════════════════════════════════════
export function TerminalWindow({ app, onClose, onHide, state, onUpdateState, onFocus, zIndex }) {
  const [dragging, setDragging] = useState(false)
  const [resizing, setResizing] = useState(false)
  const windowRef = useRef(null)
  const dragStart = useRef({ x: 0, y: 0, left: 0, top: 0, width: 0, height: 0 })
  const resizeDir = useRef('')

  const { left = 100, top = 80, width = 600, height = 420, hidden = false, fullscreen = false } = state

  const handleTitleMouseDown = useCallback((e) => {
    if (e.button !== 0) return
    e.preventDefault()
    setDragging(true)
    dragStart.current = { x: e.clientX, y: e.clientY, left, top, width, height }
    onFocus?.()
  }, [left, top, width, height, onFocus])

  const handleWindowClick = useCallback((e) => {
    onFocus?.()
  }, [onFocus])

  const handleResizeStart = useCallback((e, dir) => {
    e.preventDefault()
    e.stopPropagation()
    setResizing(true)
    resizeDir.current = dir
    dragStart.current = { x: e.clientX, y: e.clientY, left, top, width, height }
  }, [left, top, width, height])

  useEffect(() => {
    if (!dragging && !resizing) return

    const handleMove = (e) => {
      if (dragging) {
        const dx = e.clientX - dragStart.current.x
        const dy = e.clientY - dragStart.current.y
        onUpdateState({ left: dragStart.current.left + dx, top: dragStart.current.top + dy })
      } else if (resizing) {
        const dx = e.clientX - dragStart.current.x
        const dy = e.clientY - dragStart.current.y
        const newState = { ...dragStart.current }
        const dir = resizeDir.current
        if (dir.includes('e')) newState.width = Math.max(320, dragStart.current.width + dx)
        if (dir.includes('s')) newState.height = Math.max(240, dragStart.current.height + dy)
        if (dir.includes('w')) { newState.width = Math.max(320, dragStart.current.width - dx); newState.left = dragStart.current.left + dx }
        if (dir.includes('n')) { newState.height = Math.max(240, dragStart.current.height - dy); newState.top = dragStart.current.top + dy }
        onUpdateState({ width: newState.width, height: newState.height, left: newState.left, top: newState.top })
      }
    }

    const handleUp = () => { setDragging(false); setResizing(false) }

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [dragging, resizing, onUpdateState])

  if (hidden) return null

  const AppIcon = app.icon

  return (
    <div
      ref={windowRef}
      className={fullscreen ? 'fixed inset-0 z-[999] no-drag' : 'no-drag'}
      style={fullscreen ? {} : { position: 'fixed', left, top, width, height, zIndex }}
      onMouseDown={handleWindowClick}
    >
      <div className={`h-full flex flex-col overflow-hidden border border-white/10 shadow-2xl
        bg-surface-900/90 backdrop-blur-xl transition-all duration-150
        ${fullscreen ? 'rounded-none border-0' : 'rounded-xl'}`}
      >
        {/* 标题栏 */}
        <div
          className="flex items-center bg-surface-800/60 backdrop-blur-sm border-b border-white/5 select-none"
          style={{ minHeight: 38 }}
          onMouseDown={handleTitleMouseDown}
        >
          <TrafficLights
            onClose={onClose}
            onHide={onHide}
            onFullscreen={() => onUpdateState({ fullscreen: !fullscreen })}
            isFullscreen={fullscreen}
          />
          <div className="flex-1 flex items-center gap-2 justify-center">
            <AppIcon className="w-3.5 h-3.5 text-surface-400" />
            <span className="text-[11px] font-medium text-surface-400">{app.name}</span>
          </div>
          <div className="w-16" />
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-auto">
          {app.placeholder ? (
            <PlaceholderApp app={app} />
          ) : app.system ? (
            <SystemToolContent tool={app} />
          ) : null}
        </div>

        {/* 调整大小手柄 */}
        {!fullscreen && (
          <>
            <div className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
              onMouseDown={e => handleResizeStart(e, 'se')} />
            <div className="absolute bottom-0 left-0 right-4 h-1 cursor-s-resize"
              onMouseDown={e => handleResizeStart(e, 's')} />
            <div className="absolute top-0 right-0 bottom-4 w-1 cursor-e-resize"
              onMouseDown={e => handleResizeStart(e, 'e')} />
          </>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════
// 占位应用内容
// ═══════════════════════════════════════════════
function PlaceholderApp({ app }) {
  const AppIcon = app.icon
  return (
    <div className="h-full flex flex-col items-center justify-center gap-4 p-8">
      <div className="w-20 h-20 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center">
        <AppIcon className="w-10 h-10 text-surface-500" />
      </div>
      <div>
        <h2 className="text-lg font-semibold text-white text-center">{app.name}</h2>
        <p className="text-xs text-surface-500 mt-1 text-center">此应用尚在开发中，敬请期待</p>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════
// 系统工具：资源（访达风格文件浏览器）
// ═══════════════════════════════════════════════
function SystemToolContent({ tool }) {
  const { getDbPath } = useDb()
  const [viewMode, setViewMode] = useState('icon')
  const [dbPath, setDbPath] = useState('')
  const [currentDir, setCurrentDir] = useState('')
  const [files, setFiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  // 初始加载
  useEffect(() => {
    loadDir()
  }, [])

  async function loadDir(dirPath) {
    setLoading(true)
    setError('')
    try {
      const pathRes = await getDbPath()
      const root = dirPath || (pathRes?.dir || '')
      if (!root) { setError('请使用完整桌面应用查看文件'); setLoading(false); return }
      if (!dbPath) setDbPath(pathRes?.dir || '')
      const targetDir = dirPath || pathRes?.dir || ''
      setCurrentDir(targetDir)
      const res = await window.electronAPI?.listDirectory(targetDir)
      if (res?.files) setFiles(res.files)
      else if (res?.error) setError(res.error)
    } catch (e) {
      setError('无法加载: ' + (e.message || '未知错误'))
    } finally { setLoading(false) }
  }

  function handleFolderClick(file) {
    if (file.isDirectory) {
      const newPath = currentDir + '/' + file.name
      loadDir(newPath)
    }
  }

  function goBack() {
    const parts = currentDir.split('/')
    if (parts.length <= 1) return
    parts.pop()
    loadDir(parts.join('/') || '/')
  }

  const filteredFiles = search
    ? files.filter(f => f.name.toLowerCase().includes(search.toLowerCase()))
    : files

  function formatSize(bytes) {
    if (!bytes) return '—'
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / 1048576).toFixed(1) + ' MB'
  }

  function getFileIcon(file, small) {
    const sz = small ? 'w-5 h-5' : 'w-8 h-8'
    if (file.isDirectory) return <FolderOpen className={`${sz} text-blue-400`} />
    const ext = file.name.split('.').pop()?.toLowerCase()
    if (['jpg','jpeg','png','webp','gif','svg','bmp'].includes(ext)) return <Image className={`${sz} text-green-400`} />
    if (['db','sqlite'].includes(ext)) return <Database className={`${sz} text-orange-400`} />
    if (['json'].includes(ext)) return <Code className={`${sz} text-yellow-400`} />
    if (['txt','md','csv'].includes(ext)) return <FileText className={`${sz} text-surface-400`} />
    return <File className={`${sz} text-surface-500`} />
  }

  if (tool.id === 'resources') {
    return (
      <div className="h-full flex flex-col">
        {/* 工具栏 */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5 bg-surface-800/30">
          <button onClick={goBack} className="p-1 rounded-md text-surface-400 hover:text-white hover:bg-white/10 transition-colors" title="返回上级">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-[11px] text-surface-400 font-mono truncate flex-1">
            {loading ? '加载中...' : currentDir || '数据库文件夹'}
          </span>
          <div className="flex items-center gap-1 bg-surface-700/50 rounded-lg p-0.5">
            <button onClick={() => setViewMode('icon')}
              className={`p-1.5 rounded-md transition-colors ${viewMode === 'icon' ? 'bg-white/10 text-white' : 'text-surface-500 hover:text-surface-300'}`}>
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => setViewMode('list')}
              className={`p-1.5 rounded-md transition-colors ${viewMode === 'list' ? 'bg-white/10 text-white' : 'text-surface-500 hover:text-surface-300'}`}>
              <LayoutList className="w-3.5 h-3.5" />
            </button>
          </div>
          <button onClick={() => { if (currentDir) window.electronAPI?.openFolder(currentDir) }}
            className="px-2 py-1 rounded-lg text-[11px] bg-white/10 hover:bg-white/20 text-surface-300 transition-colors flex items-center gap-1 shrink-0">
            <FolderOpen className="w-3 h-3" />访达
          </button>
        </div>

        {/* 搜索栏 */}
        <div className="px-3 py-1.5 border-b border-white/5">
          <div className="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-surface-800/50">
            <Search className="w-3 h-3 text-surface-500 shrink-0" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="搜索文件..."
              className="flex-1 bg-transparent text-xs text-surface-200 placeholder-surface-600 outline-none"
            />
            {search && (
              <button onClick={() => setSearch('')} className="text-surface-500 hover:text-surface-300">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* 文件列表 */}
        <div className="flex-1 overflow-auto p-3">
          {loading ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center">
                <div className="w-8 h-8 mx-auto mb-3 rounded-full border-2 border-surface-600 border-t-surface-400 animate-spin" />
                <p className="text-xs text-surface-500">正在加载...</p>
              </div>
            </div>
          ) : error ? (
            <div className="h-full flex items-center justify-center text-surface-500 text-sm">
              <div className="text-center">
                <FolderOpen className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p className="text-xs">{error}</p>
              </div>
            </div>
          ) : filteredFiles.length === 0 ? (
            <div className="h-full flex items-center justify-center text-surface-500 text-sm">
              <div className="text-center">
                <FolderOpen className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p className="text-xs">{search ? '无匹配文件' : '文件夹为空'}</p>
              </div>
            </div>
          ) : viewMode === 'icon' ? (
            <div className="grid grid-cols-4 gap-3">
              {filteredFiles.map((f, i) => (
                <div key={i} onClick={() => handleFolderClick(f)}
                  className="flex flex-col items-center gap-1 p-2 rounded-xl hover:bg-white/5 cursor-pointer transition-colors group">
                  {getFileIcon(f)}
                  <span className="text-[10px] text-surface-300 text-center leading-tight break-all line-clamp-2 group-hover:text-white transition-colors">{f.name}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-0.5">
              {filteredFiles.map((f, i) => (
                <div key={i} onClick={() => handleFolderClick(f)}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 cursor-pointer transition-colors">
                  <div className="shrink-0">{getFileIcon(f, true)}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-surface-200 truncate">{f.name}</p>
                    <p className="text-[10px] text-surface-500">{f.isDirectory ? '文件夹' : formatSize(f.size)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  if (tool.id === 'customize') {
    return <CustomizationTool />
  }

  return null
}

// ═══════════════════════════════════════════════
// 自定义工具：壁纸设置
// ═══════════════════════════════════════════════
function CustomizationTool() {
  const [tab, setTab] = useState('wallpaper')
  const [wallpaper, setWallpaper] = useState(null)
  const [preview, setPreview] = useState(null)
  const [msg, setMsg] = useState(null)

  useEffect(() => { loadWallpaper() }, [])

  async function loadWallpaper() {
    try {
      const res = await window.electronAPI?.getUserConfig()
      const w = res?.config?.terminalWallpaper
      if (w) {
        setWallpaper(w)
        const result = await window.electronAPI?.readUserImage(w)
        if (result?.data) setPreview(result.data)
      }
    } catch (_) {}
  }

  async function handleImport() {
    try {
      const result = await window.electronAPI?.importUserImage()
      if (result?.filename) {
        const readResult = await window.electronAPI?.readUserImage(result.filename)
        if (readResult?.data) {
          setWallpaper(result.filename)
          setPreview(readResult.data)
          await window.electronAPI?.setUserConfig('terminalWallpaper', result.filename)
          setMsg({ type: 'success', text: '壁纸已更新' })
          window.dispatchEvent(new CustomEvent('terminal-wallpaper-changed', { detail: readResult.data }))
        }
      }
    } catch (e) {
      setMsg({ type: 'error', text: '导入失败: ' + e.message })
    }
  }

  async function handleRemove() {
    setWallpaper(null)
    setPreview(null)
    await window.electronAPI?.setUserConfig('terminalWallpaper', null)
    setMsg({ type: 'success', text: '已恢复默认' })
    window.dispatchEvent(new CustomEvent('terminal-wallpaper-changed', { detail: null }))
  }

  const tabs = [
    { id: 'wallpaper', label: '壁纸', icon: Monitor },
    { id: 'general', label: '通用', icon: Settings },
  ]

  return (
    <div className="h-full flex flex-col">
      {/* 二级菜单 Tab 栏 */}
      <div className="flex items-center px-4 py-2 gap-1 border-b border-white/5 bg-surface-800/30">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors
              ${tab === t.id ? 'bg-white/10 text-white' : 'text-surface-500 hover:text-surface-300 hover:bg-white/5'}`}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab 内容 */}
      <div className="flex-1 overflow-auto p-6">
        {tab === 'wallpaper' && (
          <div className="space-y-5">
            <div>
              <h3 className="text-sm font-semibold text-white">桌面壁纸</h3>
              <p className="text-xs text-surface-500 mt-1">自定义终端桌面的背景图片</p>
            </div>

            {msg && (
              <div className={`p-3 rounded-xl text-xs ${msg.type === 'success' ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
                {msg.text}
              </div>
            )}

            <div className="rounded-xl overflow-hidden border border-white/10 bg-surface-800/50 aspect-video flex items-center justify-center">
              {preview ? (
                <img src={preview} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="text-center text-surface-500">
                  <Monitor className="w-12 h-12 mx-auto mb-2 opacity-30" />
                  <p className="text-xs">暂未设置壁纸</p>
                </div>
              )}
            </div>

            <div className="flex items-center gap-3">
              <button onClick={handleImport}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/10 text-sm text-surface-300 transition-all">
                <Upload className="w-4 h-4" />导入壁纸
              </button>
              {wallpaper && (
                <button onClick={handleRemove}
                  className="px-4 py-2 rounded-xl text-sm text-surface-500 hover:text-red-400 hover:bg-red-500/10 transition-all">
                  恢复默认
                </button>
              )}
            </div>
          </div>
        )}

        {tab === 'general' && (
          <div className="flex items-center justify-center h-40 text-surface-500 text-xs">
            <div className="text-center">
              <PaintBucket className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p>更多自定义选项即将推出</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════
// 主 TerminalPage 组件
// ═══════════════════════════════════════════════
export default function TerminalPage() {
  const { launchApp } = useTerminal()
  const [wallpaper, setWallpaper] = useState(null)
  const [desktopIcons, setDesktopIcons] = useState({})
  const [settled, setSettled] = useState(false)
  const desktopRef = useRef(null)

  // 加载配置
  useEffect(() => {
    loadConfig()
  }, [])

  // 壁纸变更事件监听
  useEffect(() => {
    const handler = (e) => {
      if (e.detail) {
        setWallpaper(e.detail)
      } else {
        setWallpaper(null)
      }
    }
    window.addEventListener('terminal-wallpaper-changed', handler)
    return () => window.removeEventListener('terminal-wallpaper-changed', handler)
  }, [])

  // 布局稳定后允许过渡动画
  useEffect(() => {
    const timer = setTimeout(() => setSettled(true), 100)
    return () => clearTimeout(timer)
  }, [])

  async function loadConfig() {
    try {
      const res = await window.electronAPI?.getUserConfig()
      const config = res?.config || {}

      // 壁纸
      if (config.terminalWallpaper) {
        const result = await window.electronAPI?.readUserImage(config.terminalWallpaper)
        if (result?.data) setWallpaper(result.data)
      }

      // 桌面图标位置
      if (config.terminalDesktopIcons) {
        setDesktopIcons(config.terminalDesktopIcons)
      }
    } catch (_) {}
  }

  // 保存桌面图标位置
  async function saveDesktopIcons(icons) {
    setDesktopIcons(icons)
    await window.electronAPI?.setUserConfig('terminalDesktopIcons', icons)
  }

  // 图标拖拽结束
  function handleIconDragEnd(appId, col, row) {
    const next = { ...desktopIcons, [appId]: { col, row } }
    saveDesktopIcons(next)
  }

  // 生成默认图标位置
  function getIconPosition(app, index) {
    return desktopIcons[app.id] || { col: index % GRID_COLS, row: Math.floor(index / GRID_COLS) }
  }

  return (
    <div
      className="h-full flex flex-col overflow-hidden select-none relative"
      style={{ background: wallpaper ? `url(${wallpaper}) center/cover no-repeat` : undefined }}
    >
      {wallpaper && <div className="absolute inset-0 bg-black/40 pointer-events-none" />}
      {/* 桌面区域 */}
      <div
        ref={desktopRef}
        className="flex-1 relative overflow-hidden"
      >
        <div className="absolute inset-0 p-1">
          {APPS.map((app, i) => (
            <DesktopIcon
              key={app.id}
              app={app}
              position={getIconPosition(app, i)}
              onClick={launchApp}
              onDragEnd={handleIconDragEnd}
              gridRef={desktopRef}
              settled={settled}
            />
          ))}
        </div>
      </div>

    </div>
  )
}

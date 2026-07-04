import { useState, useEffect, useRef, useCallback } from 'react'
import { useDb } from '../context/DbContext'
import { useTerminal } from '../context/TerminalContext'
import TerminalDock, { APPS, SYS_TOOLS } from '../components/TerminalDock'
import {
  X, Minus, Square, Copy, Monitor, Palette,
  FolderOpen, LayoutList, LayoutGrid,
  Upload
} from 'lucide-react'

const GRID_COLS = 6
const GRID_CELL = 110 // px per cell

// ═══════════════════════════════════════════════
// 桌面图标组件
// ═══════════════════════════════════════════════
function DesktopIcon({ app, onClick, position, onDragEnd, gridRef }) {
  const [dragging, setDragging] = useState(false)
  const iconRef = useRef(null)
  const dragOffset = useRef({ x: 0, y: 0 })

  const handleMouseDown = useCallback((e) => {
    if (e.button !== 0) return
    e.preventDefault()
    const rect = iconRef.current.getBoundingClientRect()
    dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    setDragging(true)
  }, [])

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
        transition: dragging ? 'none' : 'left 0.15s ease, top 0.15s ease',
        zIndex: dragging ? 50 : 1,
      }}
      onMouseDown={handleMouseDown}
      onDoubleClick={() => onClick(app)}
    >
      <div className={`w-16 h-16 rounded-2xl bg-white/10 backdrop-blur-sm border border-white/10 flex items-center justify-center
        group-hover:bg-white/20 group-hover:scale-105 group-hover:shadow-lg group-hover:border-white/20 transition-all duration-150
        ${dragging ? 'scale-110 shadow-xl' : ''}`}
      >
        <AppIcon className="w-8 h-8 text-white/90" />
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
function TerminalWindow({ app, onClose, onHide, state, onUpdateState, zIndex }) {
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
  }, [left, top, width, height])

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
      className={fullscreen ? 'absolute inset-0 z-[80]' : ''}
      style={fullscreen ? {} : { position: 'absolute', left, top, width, height, zIndex }}
      onClick={e => e.stopPropagation()}
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
  const [viewMode, setViewMode] = useState('icon') // icon | list
  const [dbPath, setDbPath] = useState('')

  useEffect(() => {
    getDbPath().then(r => {
      if (r?.dir) setDbPath(r.dir)
    })
  }, [getDbPath])

  if (tool.id === 'resources') {
    return (
      <div className="h-full flex flex-col">
        {/* 工具栏 */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/5 bg-surface-800/30">
          <span className="text-[11px] text-surface-400 font-mono truncate flex-1">{dbPath || '加载中...'}</span>
          <div className="flex items-center gap-1 bg-surface-700/50 rounded-lg p-0.5">
            <button
              onClick={() => setViewMode('icon')}
              className={`p-1.5 rounded-md transition-colors ${viewMode === 'icon' ? 'bg-white/10 text-white' : 'text-surface-500 hover:text-surface-300'}`}
              title="图标视图"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-1.5 rounded-md transition-colors ${viewMode === 'list' ? 'bg-white/10 text-white' : 'text-surface-500 hover:text-surface-300'}`}
              title="列表视图"
            >
              <LayoutList className="w-3.5 h-3.5" />
            </button>
          </div>
          <button
            onClick={() => {
              if (dbPath) window.electronAPI?.openExternal('file://' + dbPath)
            }}
            className="px-2.5 py-1 rounded-lg text-[11px] bg-white/10 hover:bg-white/20 text-surface-300 transition-colors flex items-center gap-1"
          >
            <FolderOpen className="w-3 h-3" />
            打开文件夹
          </button>
        </div>
        {/* 文件列表（占位） */}
        <div className="flex-1 flex items-center justify-center text-surface-500 text-sm">
          <div className="text-center">
            <FolderOpen className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>数据库文件夹</p>
            <p className="text-xs mt-1 text-surface-600">{dbPath}</p>
            <button
              onClick={() => dbPath && window.electronAPI?.openExternal('file://' + dbPath)}
              className="mt-3 px-4 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-surface-400 transition-colors"
            >
              在文件管理器中打开
            </button>
          </div>
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
  const [wallpaper, setWallpaper] = useState(null)
  const [preview, setPreview] = useState(null)
  const [msg, setMsg] = useState(null)

  // 加载当前壁纸
  useEffect(() => {
    loadWallpaper()
  }, [])

  async function loadWallpaper() {
    try {
      const res = await window.electronAPI?.getUserConfig()
      const w = res?.config?.terminalWallpaper
      if (w) {
        setWallpaper(w)
        const data = await window.electronAPI?.readUserImage(w)
        if (data) setPreview(data)
      }
    } catch (_) {}
  }

  async function handleImport() {
    try {
      const result = await window.electronAPI?.importUserImage()
      if (result?.filename) {
        const data = await window.electronAPI?.readUserImage(result.filename)
        if (data) {
          setWallpaper(result.filename)
          setPreview(data)
          await window.electronAPI?.setUserConfig('terminalWallpaper', result.filename)
          setMsg({ type: 'success', text: '壁纸已更新' })
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
  }

  return (
    <div className="h-full p-6 space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-white">桌面壁纸</h3>
        <p className="text-xs text-surface-500 mt-1">自定义终端桌面的背景图片</p>
      </div>

      {msg && (
        <div className={`p-3 rounded-xl text-xs ${msg.type === 'success' ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
          {msg.text}
        </div>
      )}

      {/* 预览 */}
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
        <button
          onClick={handleImport}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/10 text-sm text-surface-300 transition-all"
        >
          <Upload className="w-4 h-4" />
          导入壁纸
        </button>
        {wallpaper && (
          <button
            onClick={handleRemove}
            className="px-4 py-2 rounded-xl text-sm text-surface-500 hover:text-red-400 hover:bg-red-500/10 transition-all"
          >
            恢复默认
          </button>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════
// 主 TerminalPage 组件
// ═══════════════════════════════════════════════
export default function TerminalPage() {
  const { runningApps, launchApp, closeApp, updateAppState } = useTerminal()
  const [wallpaper, setWallpaper] = useState(null)
  const [desktopIcons, setDesktopIcons] = useState({})
  const desktopRef = useRef(null)

  // 加载配置
  useEffect(() => {
    loadConfig()
  }, [])

  async function loadConfig() {
    try {
      const res = await window.electronAPI?.getUserConfig()
      const config = res?.config || {}

      // 壁纸
      if (config.terminalWallpaper) {
        const data = await window.electronAPI?.readUserImage(config.terminalWallpaper)
        if (data) setWallpaper(data)
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
    <div className="h-full flex flex-col overflow-hidden select-none relative" style={{ background: wallpaper ? `url(${wallpaper}) center/cover no-repeat` : undefined }}>
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
            />
          ))}
        </div>
      </div>

      {/* 应用窗口 — 渲染在桌面区域外以支持全屏覆盖 Dock */}
      {runningApps.map(app => (
        <TerminalWindow
          key={app.id}
          app={app}
          state={app.state}
          zIndex={app.state?.zIndex}
          onClose={() => closeApp(app.id)}
          onHide={() => updateAppState(app.id, { hidden: true })}
          onUpdateState={(partial) => updateAppState(app.id, partial)}
        />
      ))}

      {/* Dock — 使用全局组件（在终端页始终可见） */}
      <TerminalDock visible />
    </div>
  )
}

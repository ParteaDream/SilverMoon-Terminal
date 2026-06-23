import { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useDb } from '../context/DbContext'
import { useTheme, THEMES } from '../context/ThemeContext'
import { useDownloadProgress } from '../hooks/useDownloadProgress'
import { savePageStateSync } from '../utils/pageStateStore'
import {
  FolderOpen, RefreshCw, Database, AlertTriangle, CheckCircle2,
  Palette, Image, Upload, Settings, ChevronRight, Sparkles, Paintbrush,
  Wrench, Download, Upload as UploadIcon, FileCode, ShieldAlert,
  LayoutList, LayoutGrid, List, Info, Images, HardDrive, Save, Pencil, Trash2, Shirt, X
} from 'lucide-react'
import { PRESET_COLORS } from '../utils/colorMarkup'

// ── Module definitions ──────────────────────────────────────────────
const MODULES = [
  { key: 'general', label: '通用', icon: Settings, desc: '数据库位置、初始数据补缺与图包管理' },
  { key: 'appearance', label: '外观', icon: Sparkles, desc: '颜色主题与默认视图模式' },
  { key: 'color-presets', label: '元素颜色', icon: Palette, desc: '自定义元素颜色与图标' },
  { key: 'version', label: '版本信息', icon: Info, desc: '查看软件版本与检查更新' },
  { key: 'advanced', label: '高级', icon: Wrench, desc: '开发者模式、备份导入与种子数据管理' },
]

// ── General Module ──────────────────────────────────────────────────
function formatTotalSize(packs) {
  const total = packs.reduce((s, p) => s + (p.size || 0), 0)
  if (total >= 1073741824) return (total / 1073741824).toFixed(2) + ' GB'
  if (total >= 1048576) return (total / 1048576).toFixed(1) + ' MB'
  if (total >= 1024) return (total / 1024).toFixed(0) + ' KB'
  return total + ' B'
}

function formatSize(bytes) {
  if (!bytes || bytes <= 0) return '0 B'
  if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(2) + ' GB'
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB'
  if (bytes >= 1024) return (bytes / 1024).toFixed(0) + ' KB'
  return bytes + ' B'
}

function GeneralModule() {
  const { dbPath, selectLocation, getDbPath, updateDatabase, devMode } = useDb()
  const [dbInfo, setDbInfo] = useState({ dbDir: null, isPopulated: false })
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState(null)

  // Image pack management
  const [packs, setPacks] = useState([])
  const [activePack, setActivePack] = useState(null)
  const [checkingPack, setCheckingPack] = useState(null) // pack path being checked for update
  const [baiduDialog, setBaiduDialog] = useState(null)   // { packType, label } for Baidu Pan dialog
  const { progress: dlProgress, startDownload, cancelDownload, checkPersisted } = useDownloadProgress()

  useEffect(() => { refreshDbInfo(); loadImagePacks(); checkStaleDownloads() }, [dbPath])

  // Check for persisted (unfinished) downloads on mount and auto-resume detection
  async function checkStaleDownloads() {
    if (!dbInfo.dbDir || !window.electronAPI) return
    // Check each potential pack path for an incomplete download
    for (const packType of ['Medium', 'Lite']) {
      try {
        const packPath = dbInfo.dbDir + '/images-' + packType
        const r = await window.electronAPI.getPersistedDownload(packPath)
        if (r?.success && r.download && !r.download.done && !r.download.cancelled) {
          // Found an incomplete download — prompt user
          console.log('[Settings] Found persisted download:', r.download)
          // The download manager will auto-resume when start is called;
          // for now, just show the progress via polling (push events will update)
        }
      } catch (_) {}
    }
  }

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

  async function loadImagePacks() {
    try {
      if (window.electronAPI?.listImagePacks) {
        const r = await window.electronAPI.listImagePacks()
        if (r?.success) {
          setPacks(r.packs || [])
          setActivePack(r.active || null)
        }
      }
    } catch (_) {}
  }

  async function handleSelectPack(packName) {
    setLoading(true)
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
    try {
      if (window.electronAPI?.clearActiveImagePack) {
        await window.electronAPI.clearActiveImagePack()
      }
      await loadImagePacks()
      setMessage({ type: 'success', text: '已恢复自动选择' })
    } catch (e) {
      setMessage({ type: 'error', text: e.message })
    } finally {
      setLoading(false)
    }
  }

  async function handleDeletePack(packPath, packName) {
    if (!confirm(`确定要删除图包「${packName}」吗？\n\n此操作不可恢复，将永久删除整个文件夹。`)) return
    setLoading(true)
    try {
      const r = await window.electronAPI?.deleteImagePack(packPath)
      if (r?.success) {
        setMessage({ type: 'success', text: `已删除图包「${packName}」` })
        await loadImagePacks()
      } else {
        setMessage({ type: 'error', text: r.error || '删除失败' })
      }
    } catch (e) {
      setMessage({ type: 'error', text: e.message })
    } finally {
      setLoading(false)
    }
  }

  async function handleGenerateManifest(packPath, packName) {
    setLoading(true)
    try {
      const r = await window.electronAPI?.generateManifest(packPath)
      if (r?.success) {
        setMessage({ type: 'success', text: `已为「${packName}」生成 manifest（${r.fileCount} 个文件）` })
      } else {
        setMessage({ type: 'error', text: r.error || '生成失败' })
      }
    } catch (e) {
      setMessage({ type: 'error', text: e.message })
    } finally {
      setLoading(false)
    }
  }
  // Guard against starting a new download while one is active
  function guardDownload() {
    if (dlProgress && !dlProgress.done && !dlProgress.cancelled && !dlProgress.error) {
      alert('已有下载任务正在进行中，请等待完成或取消后再开始新的下载。')
      return false
    }
    return true
  }

  async function handleUpdatePack(packPath, packType, packName) {
    setCheckingPack(packPath)
    try {
      await window.electronAPI?.generateManifest(packPath)
      const check = await window.electronAPI?.checkPackUpdate(packPath, packType)
      if (!check?.success) { setMessage({ type: 'error', text: check?.error || '检查失败' }); return }
      if (check.newFiles.length === 0) {
        setMessage({ type: 'success', text: `「${packName}」已是最新版本` })
        return
      }
      if (!confirm(`发现 ${check.newFiles.length} 个新文件（远程共 ${check.totalRemote} 个），是否下载更新？`)) return
      if (!guardDownload()) return
      const r = await startDownload(packPath, packType, check.newFiles)
      if (!r?.success) {
        setMessage({ type: 'error', text: r?.error || '启动下载失败' })
      }
    } catch (e) {
      setMessage({ type: 'error', text: e.message || '检查失败' })
    } finally {
      setCheckingPack(null)
    }
  }

  async function handleExportDiff(packPath, packType, packName) {
    setLoading(true)
    try {
      const r = await window.electronAPI?.exportPackDiff(packPath, packType)
      if (r?.success) {
        setMessage({ type: 'success', text: `差异已导出到 Img_Diff（New: ${r.newCount} 文件, Del: ${r.delCount} 文件）` })
      } else if (r?.message === '已取消') {
        // 用户取消
      } else {
        setMessage({ type: 'error', text: r?.error || '导出失败' })
      }
    } catch (e) {
      setMessage({ type: 'error', text: e.message })
    } finally {
      setLoading(false)
    }
  }

  async function handleDownloadFullPack(packType) {
    if (!guardDownload()) return
    const labels = { medium: '标准包 (Medium)', lite: '轻量包 (Lite)' }
    const label = labels[packType] || packType
    // Show Baidu Pan recommendation dialog
    setBaiduDialog({ packType, label })
  }

  function handleBaiduDialogChoice(choice) {
    const info = baiduDialog
    setBaiduDialog(null)
    if (!info || choice === 'close') return

    if (choice === 'baidu') {
      window.electronAPI?.openExternal('https://pan.baidu.com/s/1GKzV86djc7iPly2DKvdGwg?pwd=0721')
      return
    }

    // choice === 'continue' — start CDN download
    if (!dbInfo.dbDir) { setMessage({ type: 'error', text: '数据库路径未设置' }); return }
    const packPath = dbInfo.dbDir + '/images-' + (info.packType === 'medium' ? 'Medium' : 'Lite')
    startDownload(packPath, info.packType.toLowerCase()).then(r => {
      if (!r?.success) setMessage({ type: 'error', text: r?.error || '启动下载失败' })
    }).catch(e => {
      setMessage({ type: 'error', text: e.message || '下载异常' })
    })
  }

  // Watch for download completion to refresh packs and show message
  const lastDlStatusRef = useRef(null) // { id, type } — prevent duplicate messages
  useEffect(() => {
    if (!dlProgress) return
    const statusKey = `${dlProgress.id}-${dlProgress.done ? 'done' : dlProgress.cancelled ? 'cancelled' : dlProgress.error ? 'error' : ''}`
    if (!statusKey.endsWith('-')) {
      if (lastDlStatusRef.current === statusKey) return // already shown
      lastDlStatusRef.current = statusKey
    }
    if (dlProgress.done) {
      loadImagePacks()
      setMessage({ type: 'success', text: '图包下载完成' })
      setTimeout(() => setMessage(null), 3000)
    } else if (dlProgress.cancelled) {
      setMessage({ type: 'error', text: '下载已取消' })
      setTimeout(() => setMessage(null), 3000)
    } else if (dlProgress.error) {
      setMessage({ type: 'error', text: `下载失败: ${dlProgress.error}` })
      setTimeout(() => setMessage(null), 5000)
    }
  }, [dlProgress?.done, dlProgress?.cancelled, dlProgress?.error, dlProgress?.id])

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

      {/* Image Packs */}
      <div className="bg-surface-900/60 border border-surface-800 rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-3">
          <Images className="w-5 h-5 text-primary-400 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium">图包管理</p>
            <p className="text-xs text-surface-400 mt-0.5">
              数据库文件夹中检测到 {packs.length} 个图包{packs.length > 0 ? `，共 ${formatTotalSize(packs)}` : ''}
            </p>
          </div>
          {packs.length > 1 && (
            <button onClick={handleAutoSelect} disabled={loading}
              className="px-3 py-1.5 rounded-lg text-xs bg-surface-700 hover:bg-surface-600 text-surface-300 transition-colors disabled:opacity-50">
              恢复自动
            </button>
          )}
        </div>
        {packs.length === 0 ? (
          <div className="text-center py-6 text-surface-500 text-sm">
            <HardDrive className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p>数据库文件夹中暂未检测到图包</p>
          </div>
        ) : (
          <div className="grid gap-2">
            {packs.map(pack => {
              const isActive = pack.name === activePack
              const isOfficial = !!pack.officialType
              return (
                <div key={pack.name}
                  onClick={() => { if (!loading && !isActive) handleSelectPack(pack.name) }}
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-all group cursor-pointer
                  ${isActive ? 'bg-primary-500/10 border border-primary-500/30' : 'bg-surface-800/40 border border-surface-700 hover:border-surface-600'}
                  ${loading ? 'pointer-events-none' : ''}`}>
                  <div className="flex-1 flex items-center gap-3 text-left min-w-0">
                    <span className="text-sm font-medium truncate">{pack.name}</span>
                    {isOfficial && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary-500/10 text-primary-400 border border-primary-500/20 flex-shrink-0">
                        {pack.officialType === 'extreme' ? '极致包' : pack.officialType === 'medium' ? '标准包' : '轻量包'}
                      </span>
                    )}
                    <span className="text-xs text-surface-500 ml-auto mr-2">{pack.sizeFormatted}</span>
                    {isActive && <CheckCircle2 className="w-4 h-4 text-primary-400 flex-shrink-0" />}
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" onClick={e => e.stopPropagation()}>
                    {devMode && (
                      <>
                        <button onClick={() => handleGenerateManifest(pack.path, pack.name)}
                          disabled={loading} title="生成 manifest"
                          className="p-1 rounded text-surface-500 hover:text-primary-400 transition-colors">
                          <FileCode className="w-3.5 h-3.5" />
                        </button>
                        {isOfficial && (
                          <button onClick={() => handleExportDiff(pack.path, pack.officialType, pack.name)}
                            disabled={loading} title="导出差异"
                            className="p-1 rounded text-surface-500 hover:text-amber-400 transition-colors">
                            <FolderOpen className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </>
                    )}
                    {isOfficial && (
                      <button onClick={() => handleUpdatePack(pack.path, pack.officialType, pack.name)}
                        disabled={loading || checkingPack === pack.path} title="检查更新"
                        className="p-1 rounded text-surface-500 hover:text-primary-400 transition-colors disabled:opacity-50">
                        <RefreshCw className={`w-3.5 h-3.5 ${checkingPack === pack.path ? 'animate-spin' : ''}`} />
                      </button>
                    )}
                    <button onClick={() => handleDeletePack(pack.path, pack.name)}
                      disabled={loading} title="删除图包"
                      className="p-1 rounded text-surface-500 hover:text-red-400 transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* 下载完整图包 */}
        <div className="border-t border-surface-700 pt-4 space-y-2">
          <p className="text-xs text-surface-400">下载完整图包</p>
          <div className="flex gap-2">
            <button onClick={() => handleDownloadFullPack('medium')} disabled={loading}
              className="flex-1 px-3 py-2 rounded-lg text-xs font-medium bg-surface-800/60 border border-surface-700 text-surface-300 hover:text-white hover:border-surface-500 disabled:opacity-50 transition-colors">
              下载标准包 (Medium)
            </button>
            <button onClick={() => handleDownloadFullPack('lite')} disabled={loading}
              className="flex-1 px-3 py-2 rounded-lg text-xs font-medium bg-surface-800/60 border border-surface-700 text-surface-300 hover:text-white hover:border-surface-500 disabled:opacity-50 transition-colors">
              下载轻量包 (Lite)
            </button>
          </div>
          {/* 下载进度 */}
          {dlProgress && (
            <div className="p-3 rounded-lg bg-surface-800/60 border border-surface-700 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-surface-300">
                  {dlProgress.mode === 'zip' ? (
                    `下载中 ${formatSize(dlProgress.bytesDownloaded)} / ${formatSize(dlProgress.totalBytes)}`
                  ) : (
                    `下载中 ${dlProgress.completedFiles}/${dlProgress.totalFiles} 文件`
                  )}
                  {dlProgress.totalBytes > 0 && dlProgress.mode !== 'zip' && ` (${formatSize(dlProgress.bytesDownloaded)} / ${formatSize(dlProgress.totalBytes)})`}
                  {dlProgress.currentFile && <span className="text-surface-500 ml-1">— {dlProgress.currentFile}</span>}
                </span>
                <span className="text-surface-500">{formatSize(dlProgress.speed)}/s</span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-surface-700 overflow-hidden">
                <div className="h-full rounded-full bg-primary-500 transition-all" style={{ width: dlProgress.totalBytes > 0 ? `${Math.min(100, (dlProgress.bytesDownloaded / dlProgress.totalBytes * 100).toFixed(0))}%` : '0%' }} />
              </div>
              <button onClick={() => cancelDownload(dlProgress.id)}
                className="text-xs text-red-400 hover:text-red-300 transition-colors flex items-center gap-1">
                <X className="w-3 h-3" />取消下载
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Baidu Pan recommendation dialog */}
      {baiduDialog && (
        <div className="fixed inset-0 bg-surface-950/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => handleBaiduDialogChoice('close')}>
          <div className="bg-surface-800 border border-surface-600 rounded-xl p-6 max-w-sm mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-white mb-3">下载 {baiduDialog.label}</h3>
            <p className="text-xs text-surface-400 mb-4 leading-relaxed">
              推荐直接从网盘下载完整压缩包，速度更快且支持断点续传。
            </p>
            <div className="flex flex-col gap-2">
              <button onClick={() => handleBaiduDialogChoice('baidu')}
                className="w-full px-4 py-2.5 rounded-lg text-sm font-medium bg-primary-600 hover:bg-primary-500 text-white transition-colors">
                好的，打开网盘链接
              </button>
              <button onClick={() => handleBaiduDialogChoice('continue')}
                className="w-full px-4 py-2 rounded-lg text-xs font-medium bg-surface-700/60 border border-surface-600 text-surface-300 hover:text-white hover:border-surface-500 transition-colors">
                继续使用 CDN 下载
              </button>
              <button onClick={() => handleBaiduDialogChoice('close')}
                className="w-full px-4 py-2 rounded-lg text-xs text-surface-500 hover:text-surface-400 transition-colors">
                取消
              </button>
            </div>
          </div>
        </div>
      )}

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
    // Get theme gradient colors from icon CSS variables
    const style = getComputedStyle(document.documentElement)
    const fromColor = style.getPropertyValue('--app-icon-from').trim() || '99 102 241'
    const toColor = style.getPropertyValue('--app-icon-to').trim() || '165 180 252'
    const [fr, fg, fb] = fromColor.split(' ').map(Number)
    const [tr, tg, tb] = toColor.split(' ').map(Number)

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

    // Gradient background using icon colors
    const grad = ctx.createLinearGradient(0, 0, size, size)
    grad.addColorStop(0, `rgb(${fr},${fg},${fb})`)
    grad.addColorStop(1, `rgb(${tr},${tg},${tb})`)
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
        <div className="w-12 h-12 rounded-xl app-icon-bg flex items-center justify-center overflow-hidden flex-shrink-0 shadow-lg">
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
  const { theme, setTheme, themes, customColors, updateCustomColors, savedThemes, saveNewTheme, renameSavedTheme, editSavedThemeColors, deleteSavedTheme, applySavedTheme } = useTheme()
  const { dbPath, query } = useDb()
  const DEFAULT_VIEWS = { characters: 'gallery', weapons: 'gallery', artifacts: 'gallery', materials: 'gallery', wishes: 'images' }
  const [viewDefaults, setViewDefaults] = useState(DEFAULT_VIEWS)
  const [message, setMessage] = useState(null)
  const [saveAsName, setSaveAsName] = useState('')       // 保存方案名称
  const [renameId, setRenameId] = useState(null)          // 正在重命名的方案 ID
  const [renameLabel, setRenameLabel] = useState('')
  const [batchLoading, setBatchLoading] = useState(false)

  // 从 user.json 加载（唯一真相源），dbPath 变化时自动重新加载
  useEffect(() => {
    if (!window.electronAPI) return
    let cancelled = false
    async function load() {
      try {
        // 优先从 user.json 读取
        const uRes = await window.electronAPI.getUserConfig()
        if (uRes?.success && uRes.config?.defaultViewMode) {
          const stored = uRes.config.defaultViewMode
          if (stored && typeof stored === 'object') {
            if (cancelled) return
            const merged = { ...DEFAULT_VIEWS, ...stored }
            setViewDefaults(merged)
            localStorage.setItem('default_view_mode', JSON.stringify(merged))
            return
          }
        }
        // 回退：从 SQLite 读取
        const dbRes = await window.electronAPI.dbQuery("SELECT value FROM settings WHERE key = 'default_view_mode'")
        if (dbRes?.data?.length > 0) {
          try {
            const stored = JSON.parse(dbRes.data[0].value)
            if (stored && typeof stored === 'object') {
              if (cancelled) return
              const merged = { ...DEFAULT_VIEWS, ...stored }
              setViewDefaults(merged)
              localStorage.setItem('default_view_mode', JSON.stringify(merged))
              return
            }
          } catch (_) {}
        }
        // 既无 user.json 也无 SQLite 记录 → 写入默认值，清除旧文件夹残留
        if (cancelled) return
        setViewDefaults(DEFAULT_VIEWS)
        localStorage.setItem('default_view_mode', JSON.stringify(DEFAULT_VIEWS))
        window.electronAPI?.setUserConfig('defaultViewMode', DEFAULT_VIEWS).catch(() => {})
      } catch (_) {}
    }
    load()
    return () => { cancelled = true }
  }, [dbPath])

  function setViewMode(section, mode) {
    const next = { ...viewDefaults, [section]: mode }
    setViewDefaults(next)
    localStorage.setItem('default_view_mode', JSON.stringify(next))
    // Update page state cache so list pages pick up immediately
    savePageStateSync(section, 0, { viewMode: mode })
    // Persist to DB (SQLite + user.json)
    try {
      window.electronAPI?.dbQuery(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('default_view_mode', ?)",
        [JSON.stringify(next)]
      )
      window.electronAPI?.setUserConfig('defaultViewMode', next)
    } catch (_) {}
  }

  async function handleBatchOutfit(mode) {
    const label = mode === 'default' ? '默认时装' : '最右侧时装'
    if (!confirm(`该操作将改变所有角色的头像选择，是否确认？\n\n将统一设置为：${label}`)) return
    setBatchLoading(true)
    try {
      if (mode === 'default') {
        // 只修改 user.json
        await window.electronAPI?.setUserConfig('outfitSelections', {})
      } else {
        const selections = {}
        const chars = await query("SELECT id FROM characters")
        for (const c of (chars.data || [])) {
          const fits = await query("SELECT id FROM character_outfits WHERE character_id = ? ORDER BY id DESC LIMIT 1", [c.id])
          if (fits.data?.length > 0) {
            selections[c.id] = fits.data[0].id
          }
        }
        await window.electronAPI?.setUserConfig('outfitSelections', selections)
      }
      setMessage({ type: 'success', text: `已将所有角色设置为「${label}」头像，即将刷新...` })
      setTimeout(() => window.location.reload(), 1000)
    } catch (e) {
      setMessage({ type: 'error', text: e.message || '操作失败' })
    } finally {
      setBatchLoading(false)
    }
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

      {/* ── Saved themes ── */}
      {savedThemes.length > 0 && (
        <div className="bg-surface-900/60 border border-surface-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-3">
            <FolderOpen className="w-5 h-5 text-primary-400 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium">已保存的方案</p>
              <p className="text-xs text-surface-400 mt-0.5">点击应用已保存的颜色组合</p>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {savedThemes.map(st => {
              const isActive = theme === 'custom' && Object.entries(st.colors).every(([k, v]) => customColors[k] === v)
              const isRenaming = renameId === st.id
              return (
                <div key={st.id}
                  className={`relative p-3 rounded-xl border text-left transition-all duration-200 group
                    ${isActive
                      ? 'border-primary-500 bg-primary-500/10 ring-1 ring-primary-500/30'
                      : 'border-surface-700 bg-surface-800/40 hover:border-surface-600'
                    }`}
                >
                  {isRenaming ? (
                    <div className="space-y-2" onClick={e => e.stopPropagation()}>
                      <input
                        type="text" value={renameLabel} autoFocus
                        onChange={e => setRenameLabel(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') { renameSavedTheme(st.id, renameLabel); setRenameId(null) }
                          if (e.key === 'Escape') setRenameId(null)
                        }}
                        className="w-full px-2 py-1 text-xs rounded bg-surface-700 border border-surface-600 text-surface-200 outline-none focus:border-primary-500"
                      />
                      <div className="flex gap-1">
                        <button onClick={() => { renameSavedTheme(st.id, renameLabel); setRenameId(null) }} className="text-[10px] px-2 py-0.5 rounded bg-primary-500/20 text-primary-300">确定</button>
                        <button onClick={() => setRenameId(null)} className="text-[10px] px-2 py-0.5 rounded bg-surface-700 text-surface-400">取消</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <button onClick={() => applySavedTheme(st)} className="w-full text-left">
                        <div className="flex gap-1 mb-2">
                          {Object.values(st.colors).slice(0, 5).map((c, i) => (
                            <div key={i} className="w-5 h-5 rounded-full border border-white/10 flex-shrink-0" style={{ backgroundColor: rgbTupleToHex(c) }} />
                          ))}
                        </div>
                        <p className="text-sm font-medium text-surface-200">{st.label}</p>
                      </button>
                      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={e => { e.stopPropagation(); setRenameId(st.id); setRenameLabel(st.label) }} className="p-1 rounded bg-black/40 text-white/60 hover:text-white"><Pencil className="w-3 h-3" /></button>
                        <button onClick={e => { e.stopPropagation(); deleteSavedTheme(st.id) }} className="p-1 rounded bg-black/40 text-white/60 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
                      </div>
                      {isActive && (
                        <div className="absolute top-2 left-2 w-4 h-4 rounded-full bg-primary-500 flex items-center justify-center">
                          <CheckCircle2 className="w-3 h-3 text-white" />
                        </div>
                      )}
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

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
              { key: 'iconFrom', label: '图标起始色', desc: 'App 图标渐变起始' },
              { key: 'iconTo', label: '图标结束色', desc: 'App 图标渐变结束' },
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
          {/* 保存方案 */}
          <div className="flex items-center gap-2 pt-2 border-t border-surface-700">
            <input
              type="text" value={saveAsName} onChange={e => setSaveAsName(e.target.value)}
              placeholder="方案名称..."
              className="flex-1 px-3 py-1.5 text-xs rounded-lg bg-surface-800 border border-surface-600 text-surface-200 outline-none focus:border-primary-500"
            />
            <button
              onClick={async () => {
                const name = saveAsName.trim()
                if (!name) return
                await saveNewTheme(name, customColors)
                setSaveAsName('')
                setMessage({ type: 'success', text: `已保存方案「${name}」` })
                setTimeout(() => setMessage(null), 2000)
              }}
              disabled={!saveAsName.trim()}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-primary-500/20 text-primary-300 hover:bg-primary-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
            >
              <Save className="w-3 h-3" />保存方案
            </button>
          </div>
        </div>
      )}

      {/* ── 应用图标 ── */}
      <AppIconSection />

      {/* ── 时装批量设置 ── */}
      <div className="bg-surface-900/60 border border-surface-800 rounded-xl p-5 space-y-3">
        <div className="flex items-center gap-3">
          <Shirt className="w-5 h-5 text-primary-400 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium">时装批量设置</p>
            <p className="text-xs text-surface-400 mt-0.5">一键设置所有角色的头像使用的时装</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => handleBatchOutfit('default')} disabled={batchLoading}
            className="flex-1 px-4 py-2 rounded-lg text-sm font-medium bg-surface-800/60 border border-surface-700 text-surface-300 hover:text-white hover:border-surface-500 transition-colors disabled:opacity-50">
            默认
          </button>
          <button onClick={() => handleBatchOutfit('last')} disabled={batchLoading}
            className="flex-1 px-4 py-2 rounded-lg text-sm font-medium bg-surface-800/60 border border-surface-700 text-surface-300 hover:text-white hover:border-surface-500 transition-colors disabled:opacity-50">
            时装
          </button>
        </div>
        {batchLoading && <p className="text-xs text-surface-400 text-center">处理中...</p>}
      </div>

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
                onClick={() => setViewMode('wishes', 'detail')}
                className={`px-3 py-1.5 rounded-md text-xs transition-colors flex items-center gap-1.5
                  ${viewDefaults.wishes !== 'images' ? 'bg-surface-600 text-white' : 'text-surface-400 hover:text-surface-200'}`}
              >
                <List className="w-3.5 h-3.5" />详情
              </button>
              <button
                onClick={() => setViewMode('wishes', 'images')}
                className={`px-3 py-1.5 rounded-md text-xs transition-colors flex items-center gap-1.5
                  ${viewDefaults.wishes === 'images' ? 'bg-surface-600 text-white' : 'text-surface-400 hover:text-surface-200'}`}
              >
                <Image className="w-3.5 h-3.5" />卡池图
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
  const [dataVersion, setDataVersion] = useState('6.7.0')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState(null)

  // Update states
  const [autoCheck, setAutoCheck] = useState(false)
  const [updateStatus, setUpdateStatus] = useState(null) // { event, version, percent, message }
  const [updateChecking, setUpdateChecking] = useState(false)
  const [updateDownloading, setUpdateDownloading] = useState(false)

  useEffect(() => {
    loadVersionInfo()
    loadUpdateSettings()
    // Listen for update events
    const cleanup = window.electronAPI?.onUpdateStatus?.((status) => {
      console.log('[update-status]', status)
      setUpdateStatus(status)
      if (status.event === 'checking') setUpdateChecking(true)
      else if (status.event === 'not-available' || status.event === 'error') setUpdateChecking(false)
      else if (status.event === 'available') setUpdateChecking(false)
      else if (status.event === 'progress') setUpdateDownloading(true)
      else if (status.event === 'downloaded') setUpdateDownloading(false)
    })
    return () => { if (cleanup) cleanup() }
  }, [])

  async function loadUpdateSettings() {
    try {
      if (window.electronAPI?.getUpdateAutoCheck) {
        const r = await window.electronAPI.getUpdateAutoCheck()
        if (r?.success) setAutoCheck(r.enabled)
      }
    } catch (_) {}
  }

  async function toggleAutoCheck() {
    const next = !autoCheck
    setAutoCheck(next)
    try {
      await window.electronAPI?.setUpdateAutoCheck(next)
    } catch (_) {}
  }

  async function handleCheckUpdate() {
    setUpdateChecking(true)
    setUpdateStatus(null)
    const fallback = setTimeout(() => {
      setUpdateChecking(false)
      setUpdateStatus(prev => prev || { event: 'not-available' })
    }, 15000)
    try {
      await window.electronAPI?.checkForUpdate()
      clearTimeout(fallback)
    } catch (_) {
      clearTimeout(fallback)
      setUpdateChecking(false)
      setUpdateStatus({ event: 'error', message: '检查失败，请确认网络连接' })
    }
  }

  async function handleDownloadUpdate() {
    setUpdateDownloading(true)
    try {
      await window.electronAPI?.downloadUpdate()
    } catch (_) {
      setUpdateDownloading(false)
    }
  }

  async function handleInstallUpdate() {
    try {
      await window.electronAPI?.installUpdate()
    } catch (_) {}
  }

  async function loadVersionInfo() {
    try {
      if (window.electronAPI?.getAppVersion) {
        const r = await window.electronAPI.getAppVersion()
        if (r?.version) setAppVersion(r.version)
      }
      if (window.electronAPI?.getDataVersion) {
        const r = await window.electronAPI.getDataVersion()
        if (r?.version) setDataVersion(r.version)
      }
    } catch (_) {}
  }

  return (
    <div className="space-y-6">
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

      <div className="bg-surface-900/60 border border-surface-800 rounded-xl p-5 space-y-3">
        <div className="flex items-center gap-3">
          <Info className="w-5 h-5 text-primary-400 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium">软件版本</p>
            <p className="text-xs text-surface-400 mt-0.5">当前运行的 SilverMoon Terminal 版本</p>
          </div>
          <span className="ml-auto text-lg font-bold text-primary-400">v{appVersion}</span>
        </div>
        <div className="flex items-center gap-3">
          <Database className="w-5 h-5 text-primary-400 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium">数据版本</p>
            <p className="text-xs text-surface-400 mt-0.5">当前数据库种子数据版本</p>
          </div>
          <span className="ml-auto text-sm font-semibold text-surface-300">{dataVersion}</span>
        </div>
        <button onClick={() => window.electronAPI?.openExternal('https://github.com/ParteaDream/SilverMoon-Terminal')}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs bg-surface-800/60 border border-surface-700 text-surface-300 hover:text-white hover:border-surface-500 transition-colors">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
          GitHub
        </button>
        <div className="border-t border-surface-700" />
        <div className="flex items-center gap-3">
          <RefreshCw className={`w-5 h-5 flex-shrink-0 ${updateChecking || updateDownloading ? 'text-primary-400 animate-spin' : 'text-primary-400'}`} />
          <div className="flex-1">
            <p className="text-sm font-medium">软件更新</p>
            <p className="text-xs text-surface-400 mt-0.5">检查并安装新版本</p>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <span className="text-[10px] text-surface-400">自动检查</span>
            <button onClick={toggleAutoCheck}
              className={`w-8 h-4 rounded-full transition-colors relative ${autoCheck ? 'bg-primary-500' : 'bg-surface-600'}`}>
              <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${autoCheck ? 'left-4' : 'left-0.5'}`} />
            </button>
          </label>
        </div>
        {updateStatus?.event === 'available' && (
          <div className="p-3 rounded-lg bg-primary-500/10 border border-primary-500/20 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-primary-300">发现新版本 v{updateStatus.version}</p>
              <p className="text-[10px] text-surface-400 mt-0.5">可下载并安装更新</p>
            </div>
            <button onClick={handleDownloadUpdate} disabled={updateDownloading}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-primary-500/20 text-primary-300 hover:bg-primary-500/30 disabled:opacity-50 transition-colors">
              {updateDownloading ? '下载中...' : '下载更新'}
            </button>
          </div>
        )}
        {updateStatus?.event === 'progress' && (
          <div className="p-3 rounded-lg bg-surface-800/60 border border-surface-700">
            <p className="text-xs text-surface-300 mb-1">下载中 {updateStatus.percent}%</p>
            <div className="w-full h-1.5 rounded-full bg-surface-700 overflow-hidden">
              <div className="h-full rounded-full bg-primary-500 transition-all" style={{ width: `${updateStatus.percent}%` }} />
            </div>
          </div>
        )}
        {updateStatus?.event === 'downloaded' && (
          <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20 flex items-center justify-between">
            <p className="text-xs font-medium text-green-400">更新已下载，打开文件夹手动替换即可</p>
            <button onClick={handleInstallUpdate}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-green-500/20 text-green-300 hover:bg-green-500/30 transition-colors">
              打开并退出
            </button>
          </div>
        )}
        {updateStatus?.event === 'not-available' && (
          <p className="text-xs text-surface-500 px-1">当前已是最新版本</p>
        )}
        {updateStatus?.event === 'error' && (
          <p className="text-xs text-red-400 px-1">检查失败: {updateStatus.message}</p>
        )}
        {!updateStatus && !updateChecking && (
          <button onClick={handleCheckUpdate}
            className="self-start px-3 py-1.5 rounded-lg text-xs bg-surface-800/60 border border-surface-700 text-surface-300 hover:text-white hover:border-surface-500 transition-colors">
            检查更新
          </button>
        )}
        {updateChecking && (
          <p className="text-xs text-surface-400 px-1">正在检查更新...</p>
        )}
      </div>

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

// ── Advanced Module ─────────────────────────────────────────────────
function AdvancedModule() {
  const { devMode, toggleDevMode, backupDatabase, importDatabase, exportSeed, updateDatabase, initSchema } = useDb()
  const [message, setMessage] = useState(null)
  const [loading, setLoading] = useState(false)
  const [seedVersionModal, setSeedVersionModal] = useState(false)
  const [seedVersionInput, setSeedVersionInput] = useState('')

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
    setSeedVersionModal(true)
  }

  async function doExportSeed() {
    const v = seedVersionInput.trim()
    if (!v) return
    setSeedVersionModal(false)
    setLoading(true)
    setMessage(null)
    try {
      const result = await window.electronAPI?.exportSeed(v)
      if (result?.success) {
        setMessage({ type: 'success', text: result.output || '种子数据已更新' })
      } else {
        setMessage({ type: 'error', text: result?.error || '更新失败' })
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

      {/* 数据版本输入弹窗 */}
      {seedVersionModal && (
        <div className="fixed inset-0 bg-surface-950/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setSeedVersionModal(false)}>
          <div className="bg-surface-900 border border-surface-700 rounded-xl p-6 w-80 shadow-2xl" onClick={e => e.stopPropagation()}>
            <p className="text-sm font-medium mb-3">输入新的数据版本号</p>
            <input
              type="text" value={seedVersionInput} autoFocus
              onChange={e => setSeedVersionInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') doExportSeed() }}
              className="w-full px-3 py-2 bg-surface-800 border border-surface-600 rounded-lg text-sm text-surface-200 outline-none focus:border-primary-500 mb-4"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setSeedVersionModal(false)}
                className="px-4 py-1.5 rounded-lg text-xs bg-surface-700 hover:bg-surface-600 text-surface-300 transition-colors">取消</button>
              <button onClick={doExportSeed}
                className="px-4 py-1.5 rounded-lg text-xs bg-primary-600 hover:bg-primary-500 text-white transition-colors">确定</button>
            </div>
          </div>
        </div>
      )}

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

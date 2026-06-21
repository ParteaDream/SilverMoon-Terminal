import { useState, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useDb } from '../context/DbContext'
import {
  Database, Download, Upload, Trash2, X, Bug, History, Wrench,
  Loader2, Play, Pause, CheckCircle2, AlertCircle, Clock
} from 'lucide-react'

// ─── 备份列表弹窗 ───
function BackupListModal({ isOpen, onClose }) {
  const { listBackups, restoreBackup, deleteBackup } = useDb()
  const [backups, setBackups] = useState([])
  const [loading, setLoading] = useState(false)
  const [restoring, setRestoring] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)  // 二次确认删除
  const [message, setMessage] = useState(null)

  useEffect(() => {
    if (isOpen) loadBackups()
  }, [isOpen])

  async function loadBackups() {
    setLoading(true)
    try {
      const res = await listBackups()
      if (res.success) setBackups(res.backups)
      else setBackups([])
    } catch (e) {
      console.error('Failed to load backups:', e)
      setBackups([])
    } finally {
      setLoading(false)
    }
  }

  async function handleRestore(filename) {
    if (!window.confirm(`确认用备份 "${filename}" 替换当前数据库？当前数据将被覆盖。`)) return
    setRestoring(filename)
    setMessage(null)
    try {
      const res = await restoreBackup(filename)
      if (res.success) {
        setMessage({ type: 'success', text: '数据库已恢复，请手动刷新页面以加载新数据。' })
        loadBackups()
      } else {
        setMessage({ type: 'error', text: res.error || '恢复失败' })
      }
    } catch (e) {
      setMessage({ type: 'error', text: e.message })
    } finally {
      setRestoring(null)
    }
  }

  function handleDeleteClick(filename) {
    if (confirmDelete === filename) {
      // 二次确认后执行删除
      performDelete(filename)
    } else {
      setConfirmDelete(filename)
      // 3秒后自动取消
      setTimeout(() => setConfirmDelete(null), 3000)
    }
  }

  async function performDelete(filename) {
    setDeleting(filename)
    setConfirmDelete(null)
    try {
      const res = await deleteBackup(filename)
      if (res.success) {
        loadBackups()
        setMessage({ type: 'success', text: '备份已删除' })
      } else {
        setMessage({ type: 'error', text: res.error || '删除失败' })
      }
    } catch (e) {
      setMessage({ type: 'error', text: e.message })
    } finally {
      setDeleting(null)
    }
  }

  function formatSize(bytes) {
    if (!bytes) return '0 B'
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  }

  function formatTime(str) {
    return str || ''
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-lg max-h-[70vh] bg-surface-900 border border-surface-700 rounded-t-2xl shadow-2xl flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-surface-700">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-primary-400" />
            <h3 className="text-sm font-semibold">数据库备份列表</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded text-surface-400 hover:text-surface-200 hover:bg-surface-700">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Message */}
        {message && (
          <div className={`mx-5 mt-3 px-3 py-2 rounded-lg text-xs flex items-center gap-2 ${
            message.type === 'success' ? 'bg-green-500/10 text-green-400 border border-green-500/20' :
            'bg-red-500/10 text-red-400 border border-red-500/20'
          }`}>
            {message.type === 'success' ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
            {message.text}
          </div>
        )}

        {/* List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-surface-500">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : backups.length === 0 ? (
            <div className="text-center py-10 text-surface-500 text-sm">暂无备份文件</div>
          ) : (
            backups.map(b => (
              <div key={b.filename} className="flex items-center gap-3 p-3 rounded-lg bg-surface-800/50 border border-surface-700/30 hover:border-surface-600/50 transition-colors group">
                <Database className="w-4 h-4 text-primary-400/60 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-surface-200 truncate">{b.note}</p>
                  <p className="text-xs text-surface-500 flex items-center gap-2">
                    <span>{formatSize(b.size)}</span>
                    <span>·</span>
                    <span>{formatTime(b.mtime)}</span>
                  </p>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => handleRestore(b.filename)}
                    disabled={restoring === b.filename}
                    className="px-2 py-1 rounded text-xs text-green-400 hover:bg-green-500/10 disabled:opacity-50 flex items-center gap-1"
                  >
                    {restoring === b.filename ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                    恢复
                  </button>
                  <button
                    onClick={() => handleDeleteClick(b.filename)}
                    disabled={deleting === b.filename}
                    className={`px-2 py-1 rounded text-xs flex items-center gap-1 disabled:opacity-50 ${
                      confirmDelete === b.filename
                        ? 'text-red-300 bg-red-500/20'
                        : 'text-red-400 hover:bg-red-500/10'
                    }`}
                  >
                    {deleting === b.filename ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                    {confirmDelete === b.filename ? '确认删除' : '删除'}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-surface-700 flex items-center justify-between">
          <span className="text-xs text-surface-500">{backups.length} 个备份</span>
          <button onClick={loadBackups} disabled={loading} className="px-3 py-1.5 rounded-lg text-xs bg-surface-700 hover:bg-surface-600 text-surface-300 transition-colors flex items-center gap-1">
            <Loader2 className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── 备份数据库弹窗 ───
function BackupCreateModal({ isOpen, onClose }) {
  const { createBackup } = useDb()
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)

  useEffect(() => {
    if (isOpen) {
      setNote('')
      setMessage(null)
    }
  }, [isOpen])

  async function handleCreate() {
    const trimmed = note.trim()
    if (!trimmed) {
      setMessage({ type: 'error', text: '请输入备份备注' })
      return
    }
    setSaving(true)
    setMessage(null)
    try {
      const res = await createBackup(trimmed)
      if (res.success) {
        setMessage({ type: 'success', text: `备份成功: ${res.filename}` })
        setNote('')
      } else {
        setMessage({ type: 'error', text: res.error || '备份失败' })
      }
    } catch (e) {
      setMessage({ type: 'error', text: e.message })
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-sm bg-surface-900 border border-surface-700 rounded-2xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-surface-700">
          <div className="flex items-center gap-2">
            <Download className="w-4 h-4 text-primary-400" />
            <h3 className="text-sm font-semibold">备份数据库</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded text-surface-400 hover:text-surface-200 hover:bg-surface-700">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {message && (
            <div className={`px-3 py-2 rounded-lg text-xs flex items-center gap-2 ${
              message.type === 'success' ? 'bg-green-500/10 text-green-400 border border-green-500/20' :
              'bg-red-500/10 text-red-400 border border-red-500/20'
            }`}>
              {message.type === 'success' ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
              {message.text}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-surface-400 mb-1.5">备份备注</label>
            <input
              type="text"
              value={note}
              onChange={e => setNote(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              placeholder="例如：v1.0初始数据"
              className="w-full px-3 py-2 rounded-lg bg-surface-800 border border-surface-600 text-sm text-surface-100 placeholder-surface-500 focus:outline-none focus:border-primary-500"
              autoFocus
            />
            <p className="text-xs text-surface-500 mt-1">备份将自动添加时间戳，列表中仅显示备注名</p>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-surface-700 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs bg-surface-700 hover:bg-surface-600 text-surface-300 transition-colors">
            取消
          </button>
          <button
            onClick={handleCreate}
            disabled={saving || !note.trim()}
            className="px-4 py-1.5 rounded-lg text-xs bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white transition-colors flex items-center gap-1.5"
          >
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
            备份
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── 爬虫进度面板（纯展示 + 控制）───
function CrawlerPanel({ isOpen, onClose, tasks, running, paused, currentTask, onStart, onPause, onResume, onStop, fastMode, onToggleFastMode, crawlMode, onToggleCrawlMode }) {
  const doneCount = tasks.filter(t => t.status === 'done').length
  const errorCount = tasks.filter(t => t.status === 'error').length
  const totalCount = tasks.length
  const hasLiveTasks = tasks.length > 0

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-lg max-h-[70vh] bg-surface-900 border border-surface-700 rounded-t-2xl shadow-2xl flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-surface-700">
          <div className="flex items-center gap-2">
            <Bug className="w-4 h-4 text-primary-400" />
            <h3 className="text-sm font-semibold">信息爬虫</h3>
            {totalCount > 0 && (
              <span className="text-xs text-surface-500">
                ({doneCount}/{totalCount})
              </span>
            )}
            {running && !paused && (
              <span className="text-xs text-primary-400 animate-pulse">运行中</span>
            )}
            {running && paused && (
              <span className="text-xs text-amber-400">已暂停</span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {running && !paused && (
              <button onClick={onPause} className="p-1.5 rounded text-amber-400 hover:bg-amber-500/10" title="暂停">
                <Pause className="w-4 h-4" />
              </button>
            )}
            {running && paused && (
              <button onClick={onResume} className="p-1.5 rounded text-green-400 hover:bg-green-500/10" title="继续">
                <Play className="w-4 h-4" />
              </button>
            )}
            {running && (
              <button onClick={onStop} className="p-1.5 rounded text-red-400 hover:bg-red-500/10" title="停止">
                <X className="w-4 h-4" />
              </button>
            )}
            <button onClick={onClose} className="p-1 rounded text-surface-400 hover:text-surface-200 hover:bg-surface-700">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Current task / progress bar */}
        {currentTask && running && (
          <div className="px-5 py-2 border-b border-surface-700/50 bg-surface-800/50">
            <div className="flex items-center gap-2">
              <span className="text-xs text-surface-400">当前：</span>
              <span className="text-xs text-surface-200 truncate">{currentTask.name}</span>
              {currentTask.message && (
                <span className="text-xs text-surface-500">- {currentTask.message}</span>
              )}
            </div>
            {totalCount > 0 && (
              <div className="mt-1.5 h-1 rounded-full bg-surface-700 overflow-hidden">
                <div
                  className="h-full bg-primary-500 rounded-full transition-all duration-300"
                  style={{ width: `${Math.round((doneCount / totalCount) * 100)}%` }}
                />
              </div>
            )}
          </div>
        )}

        {/* Task list */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          {!hasLiveTasks ? (
            <div className="text-center py-10 text-surface-500 text-sm">
              暂无爬取任务
            </div>
          ) : (
            tasks.map((t, idx) => (
              <div key={idx} className="flex items-center gap-3 p-2.5 rounded-lg bg-surface-800/30">
                {t.status === 'pending' && <Clock className="w-4 h-4 text-surface-500 shrink-0" />}
                {t.status === 'running' && <Loader2 className="w-4 h-4 text-primary-400 animate-spin shrink-0" />}
                {t.status === 'done' && <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />}
                {t.status === 'error' && <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />}
                <span className="text-sm text-surface-300 flex-1 truncate">{t.name}</span>
                {t.message && (
                  <span className={`text-xs ${
                    t.status === 'error' ? 'text-red-400' :
                    t.status === 'done' ? 'text-green-400' :
                    'text-surface-500'
                  }`}>
                    {t.message}
                  </span>
                )}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-surface-700 space-y-2">
          {/* Crawl mode selector */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-surface-400">爬取模式</span>
            <div className="flex items-center rounded-lg bg-surface-800 border border-surface-700 p-0.5">
              <button onClick={() => onToggleCrawlMode('full')} disabled={running}
                className={`px-2 py-1 rounded text-xs transition-colors disabled:opacity-50 ${crawlMode === 'full' ? 'bg-surface-700 text-white' : 'text-surface-400 hover:text-surface-200'}`}>完整</button>
              <button onClick={() => onToggleCrawlMode('fill')} disabled={running}
                className={`px-2 py-1 rounded text-xs transition-colors disabled:opacity-50 ${crawlMode === 'fill' ? 'bg-surface-700 text-white' : 'text-surface-400 hover:text-surface-200'}`}>填充</button>
              <button onClick={() => onToggleCrawlMode('fix')} disabled={running}
                className={`px-2 py-1 rounded text-xs transition-colors disabled:opacity-50 ${crawlMode === 'fix' ? 'bg-surface-700 text-white' : 'text-surface-400 hover:text-surface-200'}`}>修复</button>
            </div>
          </div>
          {/* Fast mode toggle */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs text-surface-400">快速模式</span>
              <button
                onClick={onToggleFastMode}
                disabled={running}
                className={`relative w-9 h-5 rounded-full transition-colors disabled:opacity-50 ${
                  fastMode ? 'bg-primary-500' : 'bg-surface-600'
                }`}
              >
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${
                  fastMode ? 'left-[18px]' : 'left-0.5'
                }`} />
              </button>
            </div>
            <span className="text-xs text-surface-500">
              {fastMode ? '公式计算（快）' : '页面抓取（慢但精确）'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <div className="text-xs text-surface-500">
              {running
                ? (paused ? '已暂停' : '爬取中...')
                : errorCount > 0
                  ? `完成 ${doneCount}，失败 ${errorCount}`
                  : doneCount > 0
                    ? `全部完成 (${doneCount})`
                    : '来源: gi.nanoka.cc'}
            </div>
            <button
              onClick={onStart}
              disabled={running || !hasLiveTasks}
              className="px-4 py-1.5 rounded-lg text-xs bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white transition-colors flex items-center gap-1.5"
            >
              <Play className="w-3 h-3" />
              开始爬取
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── 主开发者工具栏 ───
export default function DevToolbar() {
  const { devMode } = useDb()
  const location = useLocation()
  const { crawlCharacter, crawlWeapon, checkMissingWeapons, crawlArtifact, checkMissingArtifacts, crawlWishes, crawlWishImages, downloadBannerImage, cleanupScrapeWindow, query, downloadMaterialImage } = useDb()
  // DevToolbar 在 <Routes> 外部，useParams() 不可用，手动从路径提取 id
  const detailId = location.pathname.match(/^\/characters\/(\d+)/)?.[1] || null
  const weaponDetailId = location.pathname.match(/^\/weapons\/(\d+)/)?.[1] || null
  const artifactDetailId = location.pathname.match(/^\/artifacts\/(\d+)/)?.[1] || null
  const [backupListOpen, setBackupListOpen] = useState(false)
  const [backupCreateOpen, setBackupCreateOpen] = useState(false)
  const [crawlerOpen, setCrawlerOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false) // always start expanded

  useEffect(() => {
    const handler = () => setSidebarCollapsed(localStorage.getItem('sidebar_collapsed') === '1')
    window.addEventListener('sidebar-toggled', handler)
    return () => window.removeEventListener('sidebar-toggled', handler)
  }, [])
  const [characterName, setCharacterName] = useState('')
  const [characterId, setCharacterId] = useState(null)
  const [selectedChars, setSelectedChars] = useState([])
  const [selectedWeapons, setSelectedWeapons] = useState([])  // 武器页面选中项
  const [selectedMats, setSelectedMats] = useState([])  // 材料页面选中项
  const [selectedArtifacts, setSelectedArtifacts] = useState([])  // 圣遗物页面选中项

  // ── 武器爬虫状态 ──
  const [weaponCrawlerOpen, setWeaponCrawlerOpen] = useState(false)
  const [weaponName, setWeaponName] = useState('')
  const [weaponId, setWeaponId] = useState(null)
  const [weaponTasks, setWeaponTasks] = useState([])
  const [weaponRunning, setWeaponRunning] = useState(false)
  const [weaponPaused, setWeaponPaused] = useState(false)
  const weaponPausedRef = useRef(false)
  const weaponRunningRef = useRef(false)
  const [weaponCurrentTask, setWeaponCurrentTask] = useState(null)
  const [weaponFastMode, setWeaponFastMode] = useState(false)
  const [weaponCrawlMode, setWeaponCrawlMode] = useState('full')

  // ── 圣遗物爬虫状态 ──
  const [artifactCrawlerOpen, setArtifactCrawlerOpen] = useState(false)
  const [artifactName, setArtifactName] = useState('')
  const [artifactId, setArtifactId] = useState(null)
  const [artifactTasks, setArtifactTasks] = useState([])
  const [artifactRunning, setArtifactRunning] = useState(false)
  const [artifactPaused, setArtifactPaused] = useState(false)
  const artifactPausedRef = useRef(false)
  const artifactRunningRef = useRef(false)
  const [artifactCurrentTask, setArtifactCurrentTask] = useState(null)
  const [artifactFastMode, setArtifactFastMode] = useState(false)
  const [artifactCrawlMode, setArtifactCrawlMode] = useState('full')

  // ── 祈愿爬虫状态 ──
  const [wishCrawlerOpen, setWishCrawlerOpen] = useState(false)
  const [wishTasks, setWishTasks] = useState([])
  const [wishRunning, setWishRunning] = useState(false)
  const [wishPaused, setWishPaused] = useState(false)
  const wishPausedRef = useRef(false)
  const wishRunningRef = useRef(false)
  const [wishCurrentTask, setWishCurrentTask] = useState(null)

  // ── 爬虫状态（提升到 DevToolbar 层级，导航不丢失）──
  const [tasks, setTasks] = useState([])
  const [running, setRunning] = useState(false)
  const [paused, setPaused] = useState(false)
  const pausedRef = useRef(false)
  const runningRef = useRef(false)
  const [currentTask, setCurrentTask] = useState(null)
  const [fastMode, setFastMode] = useState(false)  // 默认关闭快速模式（页面抓取，精确）
  const [crawlMode, setCrawlMode] = useState('full')  // 爬取模式：full=完整, skill=技能倍率

  // Determine if we're on a character page
  const isCharacterPage = location.pathname.startsWith('/characters')
  const isDetailPage = location.pathname.startsWith('/characters/') && !!detailId
  const isWeaponPage = location.pathname.startsWith('/weapons')
  const isWeaponDetailPage = location.pathname.startsWith('/weapons/') && !!weaponDetailId
  const isMaterialPage = location.pathname.startsWith('/materials')
  const isArtifactPage = location.pathname.startsWith('/artifacts')
  const isArtifactDetailPage = location.pathname.startsWith('/artifacts/') && !!artifactDetailId
  const isWishPage = location.pathname.startsWith('/wishes')

  // Listen for character selection from CharactersPage (via custom event)
  useEffect(() => {
    function handleSelection(e) {
      setSelectedChars(e.detail || [])
    }
    window.addEventListener('devtoolbar-selection', handleSelection)
    return () => window.removeEventListener('devtoolbar-selection', handleSelection)
  }, [])

  // Listen for material selection from MaterialsPage
  useEffect(() => {
    function handleSelection(e) {
      setSelectedMats(e.detail || [])
    }
    window.addEventListener('devtoolbar-material-selection', handleSelection)
    return () => window.removeEventListener('devtoolbar-material-selection', handleSelection)
  }, [])

  // Listen for artifact selection from ArtifactsPage
  useEffect(() => {
    function handleSelection(e) {
      setSelectedArtifacts(e.detail || [])
    }
    window.addEventListener('devtoolbar-artifact-selection', handleSelection)
    return () => window.removeEventListener('devtoolbar-artifact-selection', handleSelection)
  }, [])

  // Listen for weapon selection from WeaponsPage
  useEffect(() => {
    function handleSelection(e) {
      setSelectedWeapons(e.detail || [])
    }
    window.addEventListener('devtoolbar-weapon-selection', handleSelection)
    return () => window.removeEventListener('devtoolbar-weapon-selection', handleSelection)
  }, [])

  // Load character name for detail page
  useEffect(() => {
    if (isDetailPage && detailId) {
      async function loadName() {
        try {
          const res = await query('SELECT name_zh, id FROM characters WHERE id = ?', [detailId])
          if (res.data && res.data.length > 0) {
            setCharacterName(res.data[0].name_zh || '')
            setCharacterId(res.data[0].id)
          }
        } catch (_) {}
      }
      loadName()
    } else {
      setCharacterName('')
      setCharacterId(null)
    }
  }, [isDetailPage, detailId])

  // Load weapon name for detail page
  useEffect(() => {
    if (isWeaponDetailPage && weaponDetailId) {
      async function loadName() {
        try {
          const res = await query('SELECT name_zh, id FROM weapons WHERE id = ?', [weaponDetailId])
          if (res.data && res.data.length > 0) {
            setWeaponName(res.data[0].name_zh || '')
            setWeaponId(res.data[0].id)
          }
        } catch (_) {}
      }
      loadName()
    } else {
      setWeaponName('')
      setWeaponId(null)
    }
  }, [isWeaponDetailPage, weaponDetailId])

  // Load artifact name for detail page
  useEffect(() => {
    if (isArtifactDetailPage && artifactDetailId) {
      async function loadName() {
        try {
          const res = await query('SELECT name_zh, id FROM artifacts WHERE id = ?', [artifactDetailId])
          if (res.data && res.data.length > 0) {
            setArtifactName(res.data[0].name_zh || '')
            setArtifactId(res.data[0].id)
          }
        } catch (_) {}
      }
      loadName()
    } else {
      setArtifactName('')
      setArtifactId(null)
    }
  }, [isArtifactDetailPage, artifactDetailId])

  // ── 爬虫逻辑 ──

  // 构建任务列表（不启动），供面板打开或点击开始时使用
  function buildTaskList() {
    if (isDetailPage && characterName && characterId) {
      return [{ id: characterId, name: characterName, status: 'pending', message: '' }]
    }
    if (selectedChars.length > 0) {
      return selectedChars.map(c => ({ id: c.id, name: c.name_zh, status: 'pending', message: '' }))
    }
    return []
  }

  function openCrawler() {
    // 始终允许打开面板（后台爬取时也能查看进度）
    // 每次打开面板时，如果当前没有运行中的任务，则用当前上下文刷新任务列表
    if (!runningRef.current) {
      setTasks(buildTaskList())
    }
    setCrawlerOpen(true)
  }

  // 修复模式：同时修复倍率 + 文本附注
  function openFixCrawler() {
    setCrawlMode('fix')
    if (!runningRef.current) {
      setTasks(buildTaskList())
    }
    setCrawlerOpen(true)
  }

  // ── 材料类型修复工具 ──
  async function fixMaterialTypes() {
    if (selectedMats.length === 0) {
      alert('请先在材料列表中选中需要修复的材料')
      return
    }

    if (!window.confirm(
      `将对选中的 ${selectedMats.length} 个材料进行类型规范化修复：\n` +
      '• 「角色突破材料」「角色突破素材」→「角色突破」\n' +
      '• 「枫丹地区特产」「璃月地区特产」等 →「地区特产」\n\n' +
      '确定执行？'
    )) return

    try {
      const selectedIds = selectedMats.map(m => m.id)
      const idPlaceholders = selectedIds.map(() => '?').join(',')

      // 查询选中材料的当前类型
      const typesRes = await query(
        `SELECT DISTINCT type FROM materials WHERE id IN (${idPlaceholders}) AND type IS NOT NULL AND type != ?`,
        [...selectedIds, '']
      )
      const allTypes = (typesRes.data || []).map(r => r.type)
      console.log('[fixMaterialTypes] selected types:', allTypes)

      // 构建修复映射
      const fixMap = {}
      
      // 角色突破材料 / 角色突破素材 → character_ascension
      for (const t of ['角色突破材料', '角色突破素材']) {
        if (allTypes.includes(t)) fixMap[t] = 'character_ascension'
      }

      // 特产类统一为 local_specialty
      const specialtyTypes = allTypes.filter(t => t.includes('特产'))
      for (const t of specialtyTypes) {
        fixMap[t] = 'local_specialty'
      }

      let fixed = 0
      for (const [oldType, newType] of Object.entries(fixMap)) {
        const res = await query(
          `UPDATE materials SET type = ? WHERE type = ? AND id IN (${idPlaceholders})`,
          [newType, oldType, ...selectedIds]
        )
        if (res.changes > 0) {
          console.log(`[fixMaterialTypes] ${oldType} → ${newType}: ${res.changes} rows`)
          fixed += res.changes
        }
      }

      alert(`类型修复完成！共修复 ${fixed} 条记录。`)
    } catch (e) {
      console.error('[fixMaterialTypes] error:', e)
      alert('修复失败：' + e.message)
    }
  }

  // ── 清除角色数据（保留名字和ID）──
  async function clearCharacterData() {
    const targets = isDetailPage && characterId
      ? [{ id: characterId, name: characterName }]
      : selectedChars.length > 0
        ? selectedChars.map(c => ({ id: c.id, name: c.name_zh }))
        : []
    
    if (targets.length === 0) return
    const nameList = targets.map(t => t.name).join('、')
    if (!window.confirm(`确认清除以下角色的数据（保留名字和ID）？\n${nameList}\n\n此操作不可撤销！`)) return
    if (!window.confirm(`再次确认：清除 ${nameList} 的全部数据？`)) return

    for (const t of targets) {
      try {
        await query('DELETE FROM character_talents WHERE character_id = ?', [t.id])
        await query('DELETE FROM character_constellations WHERE character_id = ?', [t.id])
        await query('DELETE FROM character_ascension_materials WHERE character_id = ?', [t.id])
        await query('DELETE FROM character_talent_materials WHERE character_id = ?', [t.id])
        await query('DELETE FROM character_stories WHERE character_id = ?', [t.id])
        await query('DELETE FROM character_outfits WHERE character_id = ?', [t.id])
        await query(`UPDATE characters SET 
          title_zh = NULL, rarity = 5, element_id = NULL, weapon_type_id = NULL, region_id = NULL,
          birthday = NULL, affiliation = NULL, release_date = NULL, constellation_zh = NULL,
          description_zh = NULL, story = NULL, splash_art = NULL, card_art = NULL, namecard_art = NULL,
          dish_name = NULL, dish_description = NULL, dish_effect = NULL, dish_image = NULL,
          hp_80 = NULL, hp_90 = NULL, hp_95 = NULL, hp_100 = NULL,
          atk_80 = NULL, atk_90 = NULL, atk_95 = NULL, atk_100 = NULL,
          def_80 = NULL, def_90 = NULL, def_95 = NULL, def_100 = NULL,
          ascension_stat = NULL, ascension_stat_value = NULL, ascension_stats = NULL,
          gallery_images = NULL, namecard_name = NULL, namecard_description = NULL, namecard_art = NULL
          WHERE id = ?`, [t.id])
      } catch (e) {
        console.error('Failed to clear character data:', t.name, e)
      }
    }
    alert(`已清除 ${targets.length} 个角色的数据`)
  }

  async function startCrawl() {
    if (runningRef.current) return
    const list = tasks.length > 0 ? [...tasks] : buildTaskList()
    if (list.length === 0) return
    setTasks(list)
    runningRef.current = true
    setRunning(true)
    setPaused(false)
    pausedRef.current = false

    for (let i = 0; i < list.length; i++) {
      if (pausedRef.current) {
        await new Promise(resolve => {
          const check = () => {
            if (!pausedRef.current || !runningRef.current) resolve()
            else setTimeout(check, 200)
          }
          check()
        })
        if (!runningRef.current) break
      }

      const task = list[i]
      setCurrentTask(task)
      setTasks(prev => prev.map((t, idx) =>
        idx === i ? { ...t, status: 'running', message: '正在爬取...' } : t
      ))

      try {
        const res = await crawlCharacter(task.name, { fastMode, crawlMode })
        if (res.success) {
          await saveCharacterData(task.id, res.data, crawlMode)
          setTasks(prev => prev.map((t, idx) =>
            idx === i ? { ...t, status: 'done', message: '完成' } : t
          ))
        } else {
          setTasks(prev => prev.map((t, idx) =>
            idx === i ? { ...t, status: 'error', message: res.error || '爬取失败' } : t
          ))
        }
      } catch (e) {
        setTasks(prev => prev.map((t, idx) =>
          idx === i ? { ...t, status: 'error', message: e.message } : t
        ))
      }
    }

    // 批量爬取结束后清理 BrowserWindow
    if (!fastMode) {
      try { await cleanupScrapeWindow() } catch (_) {}
    }

    setRunning(false)
    runningRef.current = false
    setCurrentTask(null)
  }

  function pauseCrawl() {
    setPaused(true)
    pausedRef.current = true
  }

  function resumeCrawl() {
    setPaused(false)
    pausedRef.current = false
  }

  function stopCrawl() {
    runningRef.current = false
    setRunning(false)
    setPaused(false)
    pausedRef.current = false
    setCurrentTask(null)
  }

  // 保存爬取的角色数据到数据库
  async function saveCharacterData(charId, data, mode = 'full') {
    // ── 修复模式：同时更新技能倍率 + 天赋/命座描述 ──
    if (mode === 'fix') {
      const allTalents = [...(data.talents || []), ...(data.passives || [])]
      for (const t of allTalents) {
        if (!t.name_zh) continue
        const skillTable = t.skill_table ? JSON.stringify(t.skill_table) : null
        const desc = t.description_zh || ''
        // 按名称匹配更新 skill_table 和 description_zh
        const hasSkillTable = skillTable !== null
        if (hasSkillTable && desc) {
          await query(
            `UPDATE character_talents SET skill_table = ?, description_zh = ? WHERE character_id = ? AND name_zh = ?`,
            [skillTable, desc, charId, t.name_zh]
          )
        } else if (hasSkillTable) {
          await query(
            `UPDATE character_talents SET skill_table = ? WHERE character_id = ? AND name_zh = ?`,
            [skillTable, charId, t.name_zh]
          )
        } else if (desc) {
          await query(
            `UPDATE character_talents SET description_zh = ? WHERE character_id = ? AND name_zh = ?`,
            [desc, charId, t.name_zh]
          )
        }
        if (t.icon) downloadMaterialImage(t.icon).catch(() => {})
      }
      for (const c of (data.constellations || [])) {
        if (!c.name_zh) continue
        await query(
          `UPDATE character_constellations SET description_zh = ? WHERE character_id = ? AND name_zh = ?`,
          [c.description_zh || '', charId, c.name_zh]
        )
      }
      console.log(`[saveCharacterData] fix mode: updated ${allTalents.length} talents + ${(data.constellations || []).length} constellations`)
      return
    }

    // ── 倍率修复模式：仅更新天赋技能倍率 ──
    if (mode === 'scaling') {
      const allTalents = [...(data.talents || []), ...(data.passives || [])]
      for (const t of allTalents) {
        if (!t.name_zh) continue
        const skillTable = t.skill_table ? JSON.stringify(t.skill_table) : null
        // 按名称匹配更新 skill_table
        await query(
          `UPDATE character_talents SET skill_table = ? WHERE character_id = ? AND name_zh = ?`,
          [skillTable, charId, t.name_zh]
        )
        if (t.icon) downloadMaterialImage(t.icon).catch(() => {})
      }
      console.log(`[saveCharacterData] scaling mode: updated ${allTalents.length} talents`)
      return
    }

    // ── 技能文本修复模式：仅更新天赋/被动/命座描述 ──
    if (mode === 'text') {
      const allTalents = [...(data.talents || []), ...(data.passives || [])]
      for (const t of allTalents) {
        if (!t.name_zh) continue
        await query(
          `UPDATE character_talents SET description_zh = ? WHERE character_id = ? AND name_zh = ?`,
          [t.description_zh || '', charId, t.name_zh]
        )
      }
      for (const c of (data.constellations || [])) {
        if (!c.name_zh) continue
        await query(
          `UPDATE character_constellations SET description_zh = ? WHERE character_id = ? AND name_zh = ?`,
          [c.description_zh || '', charId, c.name_zh]
        )
      }
      console.log(`[saveCharacterData] text mode: updated ${allTalents.length} talents + ${(data.constellations || []).length} constellations`)
      return
    }

    // ── 填充模式：只补充缺失的信息 ──
    if (mode === 'fill') {
      const curr = await query('SELECT * FROM characters WHERE id = ?', [charId])
      const row = curr.data?.[0] || {}
      const fields = []
      const values = []

      // 基础字段：仅当 DB 中为空时更新
      const textFields = ['name_en', 'title_zh', 'constellation_zh', 'description_zh', 'birthday', 'affiliation', 'release_date']
      for (const f of textFields) {
        if (!row[f] && data[f]) { fields.push(`${f} = ?`); values.push(data[f]) }
      }
      if (!row.rarity && data.rarity) { fields.push('rarity = ?'); values.push(data.rarity) }

      // 属性：仅当各级均为空时填充
      if (data.stats) {
        for (const lvl of ['80', '90', '95', '100']) {
          if (!row[`hp_${lvl}`] && data.stats[`hp_${lvl}`] != null) { fields.push(`hp_${lvl} = ?`); values.push(data.stats[`hp_${lvl}`]) }
          if (!row[`atk_${lvl}`] && data.stats[`atk_${lvl}`] != null) { fields.push(`atk_${lvl} = ?`); values.push(data.stats[`atk_${lvl}`]) }
          if (!row[`def_${lvl}`] && data.stats[`def_${lvl}`] != null) { fields.push(`def_${lvl} = ?`); values.push(data.stats[`def_${lvl}`]) }
        }
      }
      if (!row.ascension_stat && data.ascension_stat_name) { fields.push('ascension_stat = ?'); values.push(data.ascension_stat_name) }
      if (!row.ascension_stats && data.ascension_stat_value) { fields.push('ascension_stats = ?'); values.push(data.ascension_stat_value) }

      // 名片
      if (!row.namecard_name && data.namecard) {
        fields.push('namecard_name = ?', 'namecard_description = ?', 'namecard_art = ?')
        values.push(data.namecard.name, data.namecard.description || '', extractImageFile(data.namecard.image))
        if (data.namecard.image) downloadMaterialImage(data.namecard.image).catch(() => {})
      }

      // 料理
      if (!row.dish_name && data.special_food) {
        const sf = data.special_food
        fields.push('dish_name = ?', 'dish_description = ?', 'dish_effect = ?', 'dish_image = ?')
        values.push(sf.name_zh, sf.description_zh || '', sf.effect || '', extractImageFile(sf.image))
        if (sf.image) downloadMaterialImage(sf.image).catch(() => {})
      }

      if (fields.length > 0) {
        await query(`UPDATE characters SET ${fields.join(', ')} WHERE id = ?`, [...values, charId])
      }

      // 天赋：仅当不存在时插入
      const hasTalents = await query('SELECT COUNT(*) as cnt FROM character_talents WHERE character_id = ?', [charId])
      if (hasTalents.data?.[0]?.cnt === 0) {
        const allTalents = [...(data.talents || []), ...(data.passives || [])]
        for (const t of allTalents) {
          const skillTable = t.skill_table ? JSON.stringify(t.skill_table) : null
          await query(
            `INSERT INTO character_talents (character_id, type, name_zh, description_zh, sort_order, skill_table, icon) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [charId, t.type, t.name_zh, t.description_zh, t.sort_order, skillTable, extractImageFile(t.icon)]
          )
          if (t.icon) downloadMaterialImage(t.icon).catch(() => {})
        }
        // 命座
        for (const c of (data.constellations || [])) {
          await query(
            `INSERT INTO character_constellations (character_id, level, name_zh, description_zh, icon) VALUES (?, ?, ?, ?, ?)`,
            [charId, c.level, c.name_zh, c.description_zh, extractImageFile(c.icon)]
          )
          if (c.icon) downloadMaterialImage(c.icon).catch(() => {})
        }
      }

      // 时装：仅当不存在时插入
      const hasOutfits = await query('SELECT COUNT(*) as cnt FROM character_outfits WHERE character_id = ?', [charId])
      if (hasOutfits.data?.[0]?.cnt === 0 && (data.outfits || []).length > 0) {
        const outfits = [...data.outfits].sort((a, b) => (b.is_default || 0) - (a.is_default || 0))
        const splashFile = data.images?.splash ? extractImageFile(data.images.splash) : ''
        for (const o of outfits) {
          await query(
            `INSERT INTO character_outfits (character_id, name_zh, description_zh, image, is_default) VALUES (?, ?, ?, ?, ?)`,
            [charId, o.name_zh, o.description_zh, o.is_default ? splashFile : '', o.is_default]
          )
        }
      }

      // 故事
      const hasStories = await query('SELECT COUNT(*) as cnt FROM character_stories WHERE character_id = ?', [charId])
      if (hasStories.data?.[0]?.cnt === 0) {
        for (const s of (data.stories || [])) {
          await query(
            `INSERT INTO character_stories (character_id, title_zh, content, sort_order) VALUES (?, ?, ?, ?)`,
            [charId, s.title_zh, s.content, s.sort_order]
          )
        }
      }

      console.log(`[saveCharacterData] fill mode: updated ${fields.length} fields`)
      return
    }

    // ── 完整模式（覆盖所有信息）──
    const fields = []
    const values = []
    if (data.name_en) { fields.push('name_en = ?'); values.push(data.name_en) }
    if (data.title_zh) { fields.push('title_zh = ?'); values.push(data.title_zh) }
    if (data.rarity) { fields.push('rarity = ?'); values.push(data.rarity) }
    if (data.constellation_zh) { fields.push('constellation_zh = ?'); values.push(data.constellation_zh) }
    if (data.description_zh) { fields.push('description_zh = ?'); values.push(data.description_zh) }
    if (data.birthday) { fields.push('birthday = ?'); values.push(data.birthday) }
    if (data.affiliation) { fields.push('affiliation = ?'); values.push(data.affiliation) }
    if (data.release_date) { fields.push('release_date = ?'); values.push(data.release_date) }
    // 基础属性
    if (data.stats) {
      for (const lvl of ['80', '90', '95', '100']) {
        if (data.stats[`hp_${lvl}`] != null) { fields.push(`hp_${lvl} = ?`); values.push(data.stats[`hp_${lvl}`]) }
        if (data.stats[`atk_${lvl}`] != null) { fields.push(`atk_${lvl} = ?`); values.push(data.stats[`atk_${lvl}`]) }
        if (data.stats[`def_${lvl}`] != null) { fields.push(`def_${lvl} = ?`); values.push(data.stats[`def_${lvl}`]) }
      }
    }
    // 突破属性
    if (data.ascension_stat_name) { fields.push('ascension_stat = ?'); values.push(data.ascension_stat_name) }
    if (data.ascension_stat_value) { fields.push('ascension_stats = ?'); values.push(data.ascension_stat_value) }

    if (fields.length > 0) {
      await query(`UPDATE characters SET ${fields.join(', ')} WHERE id = ?`, [...values, charId])
    }

    // 检查角色是否已有数据（天赋/命座），有则只更新属性，不覆盖已有内容
    const hasTalents = await query('SELECT COUNT(*) as cnt FROM character_talents WHERE character_id = ?', [charId])
    const hasConstellations = await query('SELECT COUNT(*) as cnt FROM character_constellations WHERE character_id = ?', [charId])
    const alreadyPopulated = (hasTalents.data?.[0]?.cnt > 0) || (hasConstellations.data?.[0]?.cnt > 0)

    if (alreadyPopulated) {
      // 角色已有数据，仅更新属性已结束（上面 UPDATE 已完成）
      return
    }

    // 角色无数据，执行完整爬取
    // Delete existing talents/constellations/materials for this character
    await query('DELETE FROM character_talents WHERE character_id = ?', [charId])
    await query('DELETE FROM character_constellations WHERE character_id = ?', [charId])
    await query('DELETE FROM character_ascension_materials WHERE character_id = ?', [charId])
    await query('DELETE FROM character_talent_materials WHERE character_id = ?', [charId])

    // Insert talents (active + passive)
    const allTalents = [...(data.talents || []), ...(data.passives || [])]
    for (const t of allTalents) {
      const skillTable = t.skill_table ? JSON.stringify(t.skill_table) : null
      const iconFile = extractImageFile(t.icon)
      await query(
        `INSERT INTO character_talents (character_id, type, name_zh, description_zh, sort_order, skill_table, icon) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [charId, t.type, t.name_zh, t.description_zh, t.sort_order, skillTable, iconFile]
      )
      if (t.icon) downloadMaterialImage(t.icon).catch(() => {})
    }

    // Insert constellations
    for (const c of (data.constellations || [])) {
      const iconFile = extractImageFile(c.icon)
      await query(
        `INSERT INTO character_constellations (character_id, level, name_zh, description_zh, icon) VALUES (?, ?, ?, ?, ?)`,
        [charId, c.level, c.name_zh, c.description_zh, iconFile]
      )
      if (c.icon) downloadMaterialImage(c.icon).catch(() => {})
    }

    // Upsert materials and create material links
    for (const m of (data.ascension_materials || [])) {
      let matId = m.material_id
      const imgFile = m.icon ? `${m.icon}.png` : ''
      // 先按 name_zh 查找已有材料
      const byName = await query('SELECT id FROM materials WHERE name_zh = ?', [m.material_name])
      if (byName.data && byName.data.length > 0) {
        const oldId = byName.data[0].id
        // 同名材料：用爬取数据覆盖所有字段，并更新 ID 为爬取 ID
        if (oldId !== m.material_id) {
          // ID 变更需级联更新外键
          try {
            await query('PRAGMA foreign_keys = OFF')
            await query('UPDATE character_ascension_materials SET material_id = ? WHERE material_id = ?', [m.material_id, oldId])
            await query('UPDATE character_talent_materials SET material_id = ? WHERE material_id = ?', [m.material_id, oldId])
            await query('UPDATE weapon_ascension_materials SET material_id = ? WHERE material_id = ?', [m.material_id, oldId])
            await query(`UPDATE materials SET id = ?, name_en = ?, type = ?, rarity = ?, description_zh = ?, source = ?, image = ? WHERE id = ?`,
              [m.material_id, m.material_name_en || '', m.type || '', m.rarity || 1, m.description || '', m.source || '', imgFile, oldId])
            await query('PRAGMA foreign_keys = ON')
            matId = m.material_id
          } catch (e) {
            console.error('Failed to update material ID:', e)
            matId = oldId
          }
        } else {
          await query(
            `UPDATE materials SET name_en = ?, type = ?, rarity = ?, description_zh = ?, source = ?, image = ? WHERE id = ?`,
            [m.material_name_en || '', m.type || '', m.rarity || 1, m.description || '', m.source || '', imgFile, matId]
          )
        }
      } else {
        // 再按 id 查找
        const existing = await query('SELECT id FROM materials WHERE id = ?', [m.material_id])
        if (existing.data && existing.data.length === 0) {
          await query(
            `INSERT OR IGNORE INTO materials (id, name_zh, name_en, type, rarity, description_zh, source, image) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [m.material_id, m.material_name, m.material_name_en || '', m.type || 'character_ascension', m.rarity || 1, m.description || '', m.source || '', imgFile]
          )
        }
      }
      // 下载图片（无论材料是否已存在）
      if (m.icon) downloadMaterialImage(m.icon).catch(() => {})
      await query(
        `INSERT OR IGNORE INTO character_ascension_materials (character_id, material_id, quantity) VALUES (?, ?, ?)`,
        [charId, matId, m.quantity]
      )
    }

    for (const m of (data.talent_materials || [])) {
      let matId = m.material_id
      const imgFile = m.icon ? `${m.icon}.png` : ''
      const byName = await query('SELECT id FROM materials WHERE name_zh = ?', [m.material_name])
      if (byName.data && byName.data.length > 0) {
        const oldId = byName.data[0].id
        // 同名材料：用爬取数据覆盖所有字段，并更新 ID 为爬取 ID
        if (oldId !== m.material_id) {
          // ID 变更需级联更新外键
          try {
            await query('PRAGMA foreign_keys = OFF')
            await query('UPDATE character_ascension_materials SET material_id = ? WHERE material_id = ?', [m.material_id, oldId])
            await query('UPDATE character_talent_materials SET material_id = ? WHERE material_id = ?', [m.material_id, oldId])
            await query('UPDATE weapon_ascension_materials SET material_id = ? WHERE material_id = ?', [m.material_id, oldId])
            await query(`UPDATE materials SET id = ?, name_en = ?, type = ?, rarity = ?, description_zh = ?, source = ?, image = ? WHERE id = ?`,
              [m.material_id, m.material_name_en || '', m.type || '', m.rarity || 1, m.description || '', m.source || '', imgFile, oldId])
            await query('PRAGMA foreign_keys = ON')
            matId = m.material_id
          } catch (e) {
            console.error('Failed to update material ID:', e)
            matId = oldId
          }
        } else {
          await query(
            `UPDATE materials SET name_en = ?, type = ?, rarity = ?, description_zh = ?, source = ?, image = ? WHERE id = ?`,
            [m.material_name_en || '', m.type || '', m.rarity || 1, m.description || '', m.source || '', imgFile, matId]
          )
        }
      } else {
        const existing = await query('SELECT id FROM materials WHERE id = ?', [m.material_id])
        if (existing.data && existing.data.length === 0) {
          await query(
            `INSERT OR IGNORE INTO materials (id, name_zh, name_en, type, rarity, description_zh, source, image) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [m.material_id, m.material_name, m.material_name_en || '', m.type || 'talent', m.rarity || 1, m.description || '', m.source || '', imgFile]
          )
        }
      }
      if (m.icon) downloadMaterialImage(m.icon).catch(() => {})
      await query(
        `INSERT OR IGNORE INTO character_talent_materials (character_id, material_id, quantities) VALUES (?, ?, ?)`,
        [charId, matId, m.quantity]
      )
    }

    // Insert stories (only if not exist)
    for (const s of (data.stories || [])) {
      if (s.title_zh && s.content) {
        const existing = await query(
          'SELECT id FROM character_stories WHERE character_id = ? AND title_zh = ?',
          [charId, s.title_zh]
        )
        if (existing.data && existing.data.length === 0) {
          await query(
            `INSERT INTO character_stories (character_id, title_zh, content, sort_order) VALUES (?, ?, ?, ?)`,
            [charId, s.title_zh, s.content, s.sort_order]
          )
        }
      }
    }

    // Insert outfits (replace existing)
    await query('DELETE FROM character_outfits WHERE character_id = ?', [charId])
    const sortedOutfits = [...(data.outfits || [])].sort((a, b) => (b.is_default || 0) - (a.is_default || 0))
    for (const o of sortedOutfits) {
      const imgFile = extractImageFile(o.image)
      await query(
        `INSERT INTO character_outfits (character_id, name_zh, description_zh, image, is_default) VALUES (?, ?, ?, ?, ?)`,
        [charId, o.name_zh, o.description_zh || '', imgFile, o.is_default || 0]
      )
      if (o.image) downloadMaterialImage(o.image).catch(() => {})
    }

    // Update special food
    if (data.special_food) {
      const sf = data.special_food
      const sfImage = extractImageFile(sf.image)
      await query(`UPDATE characters SET dish_name = ?, dish_description = ?, dish_effect = ?, dish_image = ? WHERE id = ?`,
        [sf.name_zh, sf.description_zh || '', sf.effect || '', sfImage, charId])
      if (sf.image) downloadMaterialImage(sf.image).catch(() => {})
    }

    // Update namecard
    if (data.namecard) {
      const nc = data.namecard
      const ncImage = extractImageFile(nc.image)
      await query(`UPDATE characters SET namecard_name = ?, namecard_description = ?, namecard_art = ? WHERE id = ?`,
        [nc.name, nc.description || '', ncImage, charId])
      if (nc.image) downloadMaterialImage(nc.image).catch(() => {})
    }

    // Update character images (icon/splash/card)
    if (data.images) {
      const imgUpdates = []
      const imgValues = []
      if (data.images.splash) { imgUpdates.push('splash_art = ?'); imgValues.push(extractImageFile(data.images.splash)) }
      if (data.images.card) { imgUpdates.push('card_art = ?'); imgValues.push(extractImageFile(data.images.card)) }
      if (imgUpdates.length > 0) {
        await query(`UPDATE characters SET ${imgUpdates.join(', ')} WHERE id = ?`, [...imgValues, charId])
      }
      // Download images
      if (data.images.splash) downloadMaterialImage(data.images.splash).catch(() => {})
      if (data.images.icon) downloadMaterialImage(data.images.icon).catch(() => {})
    }

    // Helper: extract image filename from icon name (保留原始图标名)
    function extractImageFile(iconName) {
      if (!iconName) return ''
      return `${iconName}.png`
    }
  }

  // ── 武器爬虫逻辑 ──

  function buildWeaponTaskList() {
    if (isWeaponDetailPage && weaponName && weaponId) {
      return [{ id: weaponId, name: weaponName, status: 'pending', message: '' }]
    }
    if (selectedWeapons.length > 0) {
      return selectedWeapons.map(w => ({ id: w.id, name: w.name_zh, status: 'pending', message: '' }))
    }
    return []
  }

  function openWeaponCrawler() {
    if (!weaponRunningRef.current) {
      setWeaponTasks(buildWeaponTaskList())
    }
    setWeaponCrawlerOpen(true)
  }

  async function saveWeaponData(weaponId, data) {
    const fields = []
    const values = []

    if (data.name_en) { fields.push('name_en = ?'); values.push(data.name_en) }
    if (data.rarity) { fields.push('rarity = ?'); values.push(data.rarity) }
    if (data.weapon_type) { fields.push('weapon_type_id = ?'); values.push(data.weapon_type) }
    if (data.base_atk != null) { fields.push('base_atk = ?'); values.push(data.base_atk) }
    if (data.max_base_atk != null) { fields.push('max_base_atk = ?'); values.push(data.max_base_atk) }
    if (data.secondary_stat) { fields.push('secondary_stat = ?'); values.push(data.secondary_stat) }
    if (data.secondary_stat_value != null) { fields.push('secondary_stat_value = ?'); values.push(data.secondary_stat_value) }
    if (data.max_secondary_stat_value != null) { fields.push('max_secondary_stat_value = ?'); values.push(data.max_secondary_stat_value) }
    if (data.passive_name_zh) { fields.push('passive_name_zh = ?'); values.push(data.passive_name_zh) }
    if (data.passive_description_zh) { fields.push('passive_description_zh = ?'); values.push(data.passive_description_zh) }
    if (data.refinement) { fields.push('refinement = ?'); values.push(data.refinement) }
    if (data.story_zh) { fields.push('story_zh = ?'); values.push(data.story_zh) }
    if (data.description_zh) { fields.push('description_zh = ?'); values.push(data.description_zh) }

    // 如果 nanoka.cc 返回的 ID 与数据库 ID 不同，同步更新 ID
    const effectiveId = data.id && data.id !== weaponId ? data.id : weaponId;
    if (data.id && data.id !== weaponId) {
      fields.push('id = ?'); values.push(data.id);
    }

    // 图片（注意：DB 中 image=武器大图/gacha，simple_art=装备小图标）
    if (data.images) {
      if (data.images.simple) {
        // simple = gacha 大图 → DB image（武器图片）
        const imgFile = `${data.images.simple}.webp`
        fields.push('image = ?'); values.push(imgFile)
        try { await downloadMaterialImage(data.images.simple) } catch (_) {}
      }
      if (data.images.icon) {
        // icon = 装备小图标 → DB simple_art（装备图）
        const iconFile = `${data.images.icon}.webp`
        fields.push('simple_art = ?'); values.push(iconFile)
        try { await downloadMaterialImage(data.images.icon) } catch (_) {}
      }
    }

    if (fields.length > 0) {
      await query(`UPDATE weapons SET ${fields.join(', ')} WHERE id = ?`, [...values, weaponId])
    }

    // 突破材料
    if (data.ascension_materials && data.ascension_materials.length > 0) {
      // 清理旧 ID 和新 ID 的突破材料（防止 ID 变更后残留）
      await query('DELETE FROM weapon_ascension_materials WHERE weapon_id = ?', [weaponId])
      if (effectiveId !== weaponId) {
        await query('DELETE FROM weapon_ascension_materials WHERE weapon_id = ?', [effectiveId])
      }
      for (const m of data.ascension_materials) {
        let matId = m.material_id
        const imgFile = m.image ? `${m.image}.png` : ''
        // 先按 name_zh 查找已有材料
        const byName = await query('SELECT id FROM materials WHERE name_zh = ?', [m.material_name])
        if (byName.data && byName.data.length > 0) {
          const oldId = byName.data[0].id
          // 同名材料：用爬取数据覆盖所有字段
          if (oldId !== m.material_id) {
            // ID 变更需级联更新外键
            try {
              await query('PRAGMA foreign_keys = OFF')
              await query('UPDATE weapon_ascension_materials SET material_id = ? WHERE material_id = ?', [m.material_id, oldId])
              await query(`UPDATE materials SET id = ?, name_en = ?, type = ?, rarity = ?, description_zh = ?, source = ?, image = ? WHERE id = ?`,
                [m.material_id, m.material_name_en || '', m.material_type || '', m.rarity || 1, m.description || '', m.source || '', imgFile, oldId])
              await query('PRAGMA foreign_keys = ON')
              matId = m.material_id
            } catch (e) {
              console.error('材料 ID 更新失败:', e)
              matId = oldId
            }
          } else {
            await query(
              `UPDATE materials SET name_en = ?, type = ?, rarity = ?, description_zh = ?, source = ?, image = ? WHERE id = ?`,
              [m.material_name_en || '', m.material_type || '', m.rarity || 1, m.description || '', m.source || '', imgFile, matId]
            )
          }
        } else {
          // 按 id 查找
          const existing = await query('SELECT id FROM materials WHERE id = ?', [m.material_id])
          if (existing.data && existing.data.length === 0) {
            await query(
              `INSERT INTO materials (id, name_zh, name_en, type, rarity, description_zh, source, image) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              [m.material_id, m.material_name, m.material_name_en || '', m.material_type || '', m.rarity || 1, m.description || '', m.source || '', imgFile]
            )
          } else {
            // 已存在但名称不匹配，补充缺失字段
            await query(
              `UPDATE materials SET name_zh = ?, name_en = ?, type = ?, rarity = ?, description_zh = ?, source = ?, image = ? WHERE id = ?`,
              [m.material_name, m.material_name_en || '', m.material_type || '', m.rarity || 1, m.description || '', m.source || '', imgFile, matId]
            )
          }
        }
        // 下载图片（无论材料是否已存在）
        if (m.image) {
          try { await downloadMaterialImage(m.image) } catch (_) {}
        }
        // Link
        await query(
          `INSERT OR IGNORE INTO weapon_ascension_materials (weapon_id, material_id, quantity) VALUES (?, ?, ?)`,
          [effectiveId, matId, m.quantity || 1]
        )
      }
    }
  }

  async function startWeaponCrawl() {
    const list = weaponTasks.length > 0 ? [...weaponTasks] : buildWeaponTaskList()
    if (list.length === 0) return
    setWeaponTasks(list.map(t => ({ ...t, status: 'pending', message: '' })))
    setWeaponRunning(true)
    weaponRunningRef.current = true
    weaponPausedRef.current = false
    setWeaponPaused(false)

    for (let i = 0; i < list.length; i++) {
      if (!weaponRunningRef.current) break
      while (weaponPausedRef.current && weaponRunningRef.current) {
        await new Promise(r => setTimeout(r, 200))
      }
      if (!weaponRunningRef.current) break

      const task = list[i]
      setWeaponCurrentTask(task)
      setWeaponTasks(prev => prev.map((t, idx) => idx === i ? { ...t, status: 'running', message: '爬取中...' } : t))

      try {
        const res = await crawlWeapon(task.name, { weaponId: task.id, fastMode: weaponFastMode, crawlMode: weaponCrawlMode })
        if (res.success) {
          await saveWeaponData(task.id, res.data)
          setWeaponTasks(prev => prev.map((t, idx) => idx === i ? { ...t, status: 'done', message: '完成' } : t))
        } else {
          setWeaponTasks(prev => prev.map((t, idx) => idx === i ? { ...t, status: 'error', message: res.error || '失败' } : t))
        }
      } catch (e) {
        setWeaponTasks(prev => prev.map((t, idx) => idx === i ? { ...t, status: 'error', message: e.message || '异常' } : t))
      }
    }

    setWeaponRunning(false)
    weaponRunningRef.current = false
    setWeaponPaused(false)
    weaponPausedRef.current = false
    setWeaponCurrentTask(null)
    try { await cleanupScrapeWindow() } catch (_) {}
  }

  function pauseWeaponCrawl() { setWeaponPaused(true); weaponPausedRef.current = true }
  function resumeWeaponCrawl() { setWeaponPaused(false); weaponPausedRef.current = false }
  function stopWeaponCrawl() {
    setWeaponRunning(false)
    weaponRunningRef.current = false
    setWeaponPaused(false)
    weaponPausedRef.current = false
    setWeaponCurrentTask(null)
  }

  async function clearWeaponData() {
    const targets = isWeaponDetailPage && weaponId
      ? [{ id: weaponId, name: weaponName }]
      : selectedWeapons
    if (targets.length === 0) return
    if (!window.confirm(`确定清除 ${targets.length} 个武器的天赋/命座/材料/故事/时装数据？\n（基础信息和属性将保留）`)) return
    for (const w of targets) {
      await query('DELETE FROM weapon_ascension_materials WHERE weapon_id = ?', [w.id])
    }
    alert('已清除')
  }

  // ── 圣遗物爬虫逻辑 ──

  function buildArtifactTaskList() {
    if (isArtifactDetailPage && artifactName && artifactId) {
      return [{ id: artifactId, name: artifactName, status: 'pending', message: '' }]
    }
    if (selectedArtifacts.length > 0) {
      return selectedArtifacts.map(a => ({ id: a.id, name: a.name_zh, status: 'pending', message: '' }))
    }
    return []
  }

  function openArtifactCrawler() {
    if (!artifactRunningRef.current) {
      setArtifactTasks(buildArtifactTaskList())
    }
    setArtifactCrawlerOpen(true)
  }

  async function saveArtifactData(artifactId, data) {
    // 1. 先按 name_zh 查找（处理同名不同 ID 的情况）
    const byName = await query('SELECT id FROM artifacts WHERE name_zh = ?', [data.name_zh])
    const nameExists = byName.data && byName.data.length > 0
    // 2. 再按 id 查找
    const byId = await query('SELECT id FROM artifacts WHERE id = ?', [data.id])
    const idExists = byId.data && byId.data.length > 0

    // 确定最终使用的 ID：同名优先，其次同 ID
    let targetId = data.id
    if (nameExists) {
      targetId = byName.data[0].id
    } else if (idExists) {
      targetId = data.id
    }

    const exists = nameExists || idExists

    // Build field updates
    const fields = []
    const values = []
    const textFields = [
      'name_zh', 'name_en', 'max_rarity',
      'two_piece_bonus', 'four_piece_bonus',
      'flower_name_zh', 'plume_name_zh', 'sands_name_zh', 'goblet_name_zh', 'circlet_name_zh',
      'flower_description_zh', 'plume_description_zh', 'sands_description_zh', 'goblet_description_zh', 'circlet_description_zh',
      'flower_story_zh', 'plume_story_zh', 'sands_story_zh', 'goblet_story_zh', 'circlet_story_zh',
      'image', 'flower_image', 'plume_image', 'sands_image', 'goblet_image', 'circlet_image',
    ]
    for (const f of textFields) {
      if (data[f] !== undefined && data[f] !== null) {
        fields.push(`${f} = ?`); values.push(data[f])
      }
    }

    if (exists) {
      if (fields.length > 0) {
        await query(`UPDATE artifacts SET ${fields.join(', ')} WHERE id = ?`, [...values, targetId])
      }
    } else {
      await query(
        `INSERT INTO artifacts (id, name_zh, name_en, max_rarity, two_piece_bonus, four_piece_bonus, flower_name_zh, plume_name_zh, sands_name_zh, goblet_name_zh, circlet_name_zh, flower_description_zh, plume_description_zh, sands_description_zh, goblet_description_zh, circlet_description_zh, flower_story_zh, plume_story_zh, sands_story_zh, goblet_story_zh, circlet_story_zh, image, flower_image, plume_image, sands_image, goblet_image, circlet_image) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [data.id, data.name_zh, data.name_en || '', data.max_rarity, data.two_piece_bonus || '', data.four_piece_bonus || '',
          data.flower_name_zh || '', data.plume_name_zh || '', data.sands_name_zh || '', data.goblet_name_zh || '', data.circlet_name_zh || '',
          data.flower_description_zh || '', data.plume_description_zh || '', data.sands_description_zh || '', data.goblet_description_zh || '', data.circlet_description_zh || '',
          data.flower_story_zh || '', data.plume_story_zh || '', data.sands_story_zh || '', data.goblet_story_zh || '', data.circlet_story_zh || '',
          data.image || data.flower_image || '', data.flower_image || '', data.plume_image || '', data.sands_image || '', data.goblet_image || '', data.circlet_image || '']
      )
    }

    // Download artifact images (parallel background)
    const imgKeys = ['flower_image', 'plume_image', 'sands_image', 'goblet_image', 'circlet_image']
    const imgPromises = []
    for (const key of imgKeys) {
      const imgFile = data[key]
      if (imgFile) {
        const iconName = imgFile.replace(/\.webp$/, '')
        if (iconName) {
          imgPromises.push(downloadMaterialImage(iconName).catch(() => {}))
        }
      }
    }
    if (imgPromises.length > 0) {
      await Promise.all(imgPromises)
    }
  }

  async function startArtifactCrawl() {
    const list = artifactTasks.length > 0 ? [...artifactTasks] : buildArtifactTaskList()
    if (list.length === 0) return
    setArtifactTasks(list.map(t => ({ ...t, status: 'pending', message: '' })))
    setArtifactRunning(true)
    artifactRunningRef.current = true
    artifactPausedRef.current = false
    setArtifactPaused(false)

    for (let i = 0; i < list.length; i++) {
      if (!artifactRunningRef.current) break
      while (artifactPausedRef.current && artifactRunningRef.current) {
        await new Promise(r => setTimeout(r, 200))
      }
      if (!artifactRunningRef.current) break

      const task = list[i]
      setArtifactCurrentTask(task)
      setArtifactTasks(prev => prev.map((t, idx) => idx === i ? { ...t, status: 'running', message: '爬取中...' } : t))

      try {
        const res = await crawlArtifact(task.name, { artifactId: task.id, fastMode: artifactFastMode, crawlMode: artifactCrawlMode })
        if (res.success && res.data) {
          // Update task name from crawled data
          if (res.data.name_zh) {
            setArtifactTasks(prev => prev.map((t, idx) => idx === i ? { ...t, name: res.data.name_zh } : t))
          }
          await saveArtifactData(task.id, res.data)
          setArtifactTasks(prev => prev.map((t, idx) => idx === i ? { ...t, status: 'done', message: '完成' } : t))
        } else {
          setArtifactTasks(prev => prev.map((t, idx) => idx === i ? { ...t, status: 'error', message: res.error || '失败' } : t))
        }
      } catch (e) {
        setArtifactTasks(prev => prev.map((t, idx) => idx === i ? { ...t, status: 'error', message: e.message || '异常' } : t))
      }
    }

    setArtifactRunning(false)
    artifactRunningRef.current = false
    setArtifactPaused(false)
    artifactPausedRef.current = false
    setArtifactCurrentTask(null)
    try { await cleanupScrapeWindow() } catch (_) {}
  }

  function pauseArtifactCrawl() { setArtifactPaused(true); artifactPausedRef.current = true }
  function resumeArtifactCrawl() { setArtifactPaused(false); artifactPausedRef.current = false }
  function stopArtifactCrawl() {
    setArtifactRunning(false)
    artifactRunningRef.current = false
    setArtifactPaused(false)
    artifactPausedRef.current = false
    setArtifactCurrentTask(null)
  }

  async function clearArtifactData() {
    const targets = isArtifactDetailPage && artifactId
      ? [{ id: artifactId, name: artifactName }]
      : selectedArtifacts
    if (targets.length === 0) return
    if (!window.confirm(`确定清除 ${targets.length} 个圣遗物的套装效果/部件/故事数据？\n（名称和ID将保留）`)) return
    for (const a of targets) {
      await query(`UPDATE artifacts SET 
        two_piece_bonus = NULL, four_piece_bonus = NULL,
        flower_name_zh = NULL, plume_name_zh = NULL, sands_name_zh = NULL, goblet_name_zh = NULL, circlet_name_zh = NULL,
        flower_description_zh = NULL, plume_description_zh = NULL, sands_description_zh = NULL, goblet_description_zh = NULL, circlet_description_zh = NULL,
        flower_story_zh = NULL, plume_story_zh = NULL, sands_story_zh = NULL, goblet_story_zh = NULL, circlet_story_zh = NULL,
        image = NULL, flower_image = NULL, plume_image = NULL, sands_image = NULL, goblet_image = NULL, circlet_image = NULL
        WHERE id = ?`, [a.id])
    }
    alert('已清除')
  }

  // ── 圣遗物查漏模式 ──
  async function startArtifactLeakCheckCrawl() {
    try {
      const res = await checkMissingArtifacts()
      if (!res.success) { alert('获取圣遗物列表失败: ' + (res.error || '未知错误')); return }
      const onlineIds = res.ids || []

      const dbRes = await query('SELECT id, name_zh FROM artifacts ORDER BY id')
      const dbIds = new Set((dbRes.data || []).map(a => a.id))

      const missing = onlineIds.filter(id => !dbIds.has(id))

      if (missing.length === 0) {
        alert('数据库中的圣遗物已齐全！')
        return
      }

      const artifactNames = res.names || {}

      if (!window.confirm(`发现 ${missing.length} 个缺失圣遗物，是否开始爬取？`)) return

      const tasks = missing.map(id => ({
        id,
        name: (artifactNames[id] && artifactNames[id].zh) || `ID:${id}`,
        status: 'pending',
        message: ''
      }))
      setArtifactTasks(tasks)

      setArtifactRunning(true)
      artifactRunningRef.current = true
      artifactPausedRef.current = false
      setArtifactPaused(false)

      for (let i = 0; i < tasks.length; i++) {
        if (!artifactRunningRef.current) break
        while (artifactPausedRef.current && artifactRunningRef.current) {
          await new Promise(r => setTimeout(r, 200))
        }
        if (!artifactRunningRef.current) break

        const task = tasks[i]
        setArtifactCurrentTask(task)
        setArtifactTasks(prev => prev.map((t, idx) => idx === i ? { ...t, status: 'running', message: '爬取中...' } : t))

        try {
          const res = await crawlArtifact(task.name, { artifactId: task.id, fastMode: artifactFastMode, crawlMode: 'full' })
          if (res.success && res.data) {
            const crawledName = res.data.name_zh || `圣遗物${task.id}`
            setArtifactTasks(prev => prev.map((t, idx) => idx === i ? { ...t, name: crawledName } : t))
            await saveArtifactData(task.id, res.data)
            setArtifactTasks(prev => prev.map((t, idx) => idx === i ? { ...t, status: 'done', message: '完成' } : t))
          } else {
            setArtifactTasks(prev => prev.map((t, idx) => idx === i ? { ...t, status: 'error', message: res.error || '失败' } : t))
          }
        } catch (e) {
          setArtifactTasks(prev => prev.map((t, idx) => idx === i ? { ...t, status: 'error', message: e.message || '异常' } : t))
        }
      }

      setArtifactRunning(false)
      artifactRunningRef.current = false
      setArtifactPaused(false)
      artifactPausedRef.current = false
      setArtifactCurrentTask(null)
      try { await cleanupScrapeWindow() } catch (_) {}
    } catch (e) {
      alert('查漏失败: ' + (e.message || '未知错误'))
      setArtifactRunning(false)
      artifactRunningRef.current = false
    }
  }

  // ── 查漏模式：检测数据库中缺少的武器并爬取 ──
  async function startLeakCheckCrawl() {
    try {
      // 1. 获取线上全部武器ID
      const res = await checkMissingWeapons()
      if (!res.success) { alert('获取武器列表失败: ' + (res.error || '未知错误')); return }
      const onlineIds = res.ids || []
      
      // 2. 获取数据库中已有的武器ID
      const dbRes = await query('SELECT id, name_zh FROM weapons ORDER BY id')
      const dbIds = new Set((dbRes.data || []).map(w => w.id))
      
      // 3. 找出缺少的武器（线上有但数据库没有）
      const missing = onlineIds.filter(id => !dbIds.has(id))
      
      if (missing.length === 0) {
        alert('数据库中的武器已齐全！')
        return
      }

      // 4. 构建武器名称映射（从 checkMissingWeapons 返回的 names）
      const weaponNames = res.names || {};

      if (!window.confirm(`发现 ${missing.length} 个缺失武器，是否开始爬取？`)) return

      // 5. 创建任务列表（使用真实武器名称）
      const tasks = missing.map(id => ({
        id,
        name: (weaponNames[id] && weaponNames[id].zh) || `ID:${id}`,
        status: 'pending',
        message: ''
      }))
      setWeaponTasks(tasks)
      
      // 6. 开始爬取
      setWeaponRunning(true)
      weaponRunningRef.current = true
      weaponPausedRef.current = false
      setWeaponPaused(false)

      for (let i = 0; i < tasks.length; i++) {
        if (!weaponRunningRef.current) break
        while (weaponPausedRef.current && weaponRunningRef.current) {
          await new Promise(r => setTimeout(r, 200))
        }
        if (!weaponRunningRef.current) break

        const task = tasks[i]
        setWeaponCurrentTask(task)
        setWeaponTasks(prev => prev.map((t, idx) => idx === i ? { ...t, status: 'running', message: '爬取中...' } : t))

        try {
          // 先爬取获取名称
          const res = await crawlWeapon(task.name, { weaponId: task.id, fastMode: weaponFastMode, crawlMode: 'full' })
          if (res.success && res.data) {
            // 更新任务名称
            const crawledName = res.data.name_zh || `武器${task.id}`
            setWeaponTasks(prev => prev.map((t, idx) => idx === i ? { ...t, name: crawledName } : t))
            
            // 使用 nanoka.cc 返回的正确 ID
            const correctId = res.data.id || task.id;

            // 插入新武器记录
            await query(
              `INSERT INTO weapons (id, name_zh, name_en, rarity, weapon_type_id, base_atk, max_base_atk, secondary_stat, secondary_stat_value, max_secondary_stat_value, passive_name_zh, passive_description_zh, story_zh, description_zh, image, simple_art) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [correctId, res.data.name_zh, res.data.name_en || '', res.data.rarity || 4, res.data.weapon_type || 0, res.data.base_atk || 0, res.data.max_base_atk || 0, res.data.secondary_stat || '', res.data.secondary_stat_value || 0, res.data.max_secondary_stat_value || 0, res.data.passive_name_zh || '', res.data.passive_description_zh || '', res.data.story_zh || '', res.data.description_zh || '', res.data.images?.simple ? `${res.data.images.simple}.webp` : '', res.data.images?.icon ? `${res.data.images.icon}.webp` : '']
            )
            
            // 突破材料
            if (res.data.ascension_materials && res.data.ascension_materials.length > 0) {
              for (const m of res.data.ascension_materials) {
                let matId = m.material_id
                const imgFile = m.image ? `${m.image}.png` : ''
                // 先按 name_zh 查找
                const byName = await query('SELECT id FROM materials WHERE name_zh = ?', [m.material_name])
                if (byName.data && byName.data.length > 0) {
                  const oldId = byName.data[0].id
                  if (oldId !== m.material_id) {
                    try {
                      await query('PRAGMA foreign_keys = OFF')
                      await query('UPDATE weapon_ascension_materials SET material_id = ? WHERE material_id = ?', [m.material_id, oldId])
                      await query(`UPDATE materials SET id = ?, name_en = ?, type = ?, rarity = ?, description_zh = ?, source = ?, image = ? WHERE id = ?`,
                        [m.material_id, m.material_name_en || '', m.material_type || '', m.rarity || 1, m.description || '', m.source || '', imgFile, oldId])
                      await query('PRAGMA foreign_keys = ON')
                      matId = m.material_id
                    } catch (e) { matId = oldId }
                  } else {
                    await query(`UPDATE materials SET name_en = ?, type = ?, rarity = ?, description_zh = ?, source = ?, image = ? WHERE id = ?`,
                      [m.material_name_en || '', m.material_type || '', m.rarity || 1, m.description || '', m.source || '', imgFile, matId])
                  }
                } else {
                  const existing = await query('SELECT id FROM materials WHERE id = ?', [m.material_id])
                  if (existing.data && existing.data.length === 0) {
                    await query(`INSERT INTO materials (id, name_zh, name_en, type, rarity, description_zh, source, image) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                      [m.material_id, m.material_name, m.material_name_en || '', m.material_type || '', m.rarity || 1, m.description || '', m.source || '', imgFile])
                  } else {
                    await query(`UPDATE materials SET name_zh = ?, name_en = ?, type = ?, rarity = ?, description_zh = ?, source = ?, image = ? WHERE id = ?`,
                      [m.material_name, m.material_name_en || '', m.material_type || '', m.rarity || 1, m.description || '', m.source || '', imgFile, matId])
                  }
                }
                if (m.image) {
                  try { await downloadMaterialImage(m.image) } catch (_) {}
                }
                await query('INSERT OR IGNORE INTO weapon_ascension_materials (weapon_id, material_id, quantity) VALUES (?, ?, ?)',
                  [correctId, matId, m.quantity || 1])
              }
            }
            
            // 下载图片
            if (res.data.images?.icon) {
              try { await downloadMaterialImage(res.data.images.icon) } catch (_) {}
            }
            
            setWeaponTasks(prev => prev.map((t, idx) => idx === i ? { ...t, status: 'done', message: '完成' } : t))
          } else {
            setWeaponTasks(prev => prev.map((t, idx) => idx === i ? { ...t, status: 'error', message: res.error || '失败' } : t))
          }
        } catch (e) {
          setWeaponTasks(prev => prev.map((t, idx) => idx === i ? { ...t, status: 'error', message: e.message || '异常' } : t))
        }
      }

      setWeaponRunning(false)
      weaponRunningRef.current = false
      setWeaponPaused(false)
      weaponPausedRef.current = false
      setWeaponCurrentTask(null)
      try { await cleanupScrapeWindow() } catch (_) {}
    } catch (e) {
      alert('查漏失败: ' + (e.message || '未知错误'))
      setWeaponRunning(false)
      weaponRunningRef.current = false
    }
  }

  // ── 祈愿爬虫逻辑 ──
  async function startWishCrawl() {
    if (wishRunningRef.current) return
    setWishRunning(true)
    wishRunningRef.current = true
    wishPausedRef.current = false
    setWishPaused(false)
    setWishCrawlerOpen(true)

    setWishTasks([{ name: '往期祈愿', status: 'running', message: '正在抓取 wiki 页面...' }])
    setWishCurrentTask({ name: '往期祈愿' })

    try {
      // 1. 调用主进程爬取 wiki 页面
      const res = await crawlWishes()
      if (!res.success) {
        setWishTasks([{ name: '往期祈愿', status: 'error', message: res.error || '抓取失败' }])
        setWishRunning(false)
        wishRunningRef.current = false
        setWishCurrentTask(null)
        return
      }

      const allWishes = res.data || []
      setWishTasks([{ name: '往期祈愿', status: 'running', message: `解析到 ${allWishes.length} 条祈愿，正在匹配ID...` }])

      // 2. 加载角色和武器映射（name_zh → id）
      const [charRes, wepRes, existingWishesRes] = await Promise.all([
        query('SELECT id, name_zh FROM characters'),
        query('SELECT id, name_zh FROM weapons'),
        query('SELECT version, phase, banner_type FROM wishes'),
      ])
      const charNameMap = {}
      for (const c of (charRes.data || [])) charNameMap[c.name_zh] = c.id
      const wepNameMap = {}
      for (const w of (wepRes.data || [])) wepNameMap[w.name_zh] = w.id
      const existingSet = new Set((existingWishesRes.data || []).map(w => `${w.version}|${w.phase}|${w.banner_type}`))

      // 3. 处理日期：解决"版本更新后"
      // 按时间排序所有已有的祈愿，用于推算
      const allSorted = [...allWishes].sort((a, b) => {
        if (a.version !== b.version) return a.version.localeCompare(b.version, undefined, { numeric: true })
        return a.phase - b.phase
      })

      // 为每个"版本更新后"的 start_date 填充上一期的 end_date
      let prevEndDate = null
      for (const w of allSorted) {
        if (w.start_date && w.start_date.startsWith('__VERSION_UPDATE__')) {
          if (prevEndDate) {
            w.start_date = prevEndDate
          } else {
            w.start_date = ''
          }
        }
        if (w.end_date) {
          prevEndDate = w.end_date
        }
      }

      // 4. 匹配角色/武器名称到 ID，并插入数据库
      let insertedCount = 0
      let skippedCount = 0
      let imageDownloadCount = 0
      const taskList = []
      // 追踪当前批次中已插入的 wish ID（用于合并同一 phase 的双角色池）
      const batchWishMap = {} // key → { wishId, bannerCount }

      for (const wish of allWishes) {
        // 匹配 5星名称
        const fiveStarItems = []
        for (const item of wish.five_star) {
          let itemId = null
          if (wish.banner_type === 'character-event') {
            itemId = charNameMap[item.name]
          } else {
            itemId = wepNameMap[item.name]
          }
          if (itemId) {
            fiveStarItems.push({ type: wish.banner_type === 'character-event' ? 'character' : 'weapon', id: itemId, rarity: 5, name: item.name })
          }
        }

        // 匹配 4星名称
        const fourStarItems = []
        for (const item of wish.four_star) {
          let itemId = null
          if (wish.banner_type === 'character-event') {
            itemId = charNameMap[item.name]
          } else {
            itemId = wepNameMap[item.name]
          }
          if (itemId) {
            fourStarItems.push({ type: wish.banner_type === 'character-event' ? 'character' : 'weapon', id: itemId, rarity: 4, name: item.name })
          }
        }

        if (fiveStarItems.length === 0) {
          taskList.push({ name: `${wish.version}.${wish.phase} ${wish.banner_type}`, status: 'error', message: `无法匹配5星: ${wish.five_star.map(i => i.name).join(', ')}` })
          continue
        }

        const key = `${wish.version}|${wish.phase}|${wish.banner_type}`

        // 检查是否已经在当前批次中创建了 wish（双角色池合并）
        let wishId
        if (batchWishMap[key]) {
          wishId = batchWishMap[key].wishId
        } else if (existingSet.has(key)) {
          // 数据库中已存在，跳过
          skippedCount++
          continue
        } else {
          // 新建 wish
          const startDate = wish.start_date && !wish.start_date.startsWith('__') ? wish.start_date : (wish.start_date || '')
          const endDate = wish.end_date || ''
          await query(
            'INSERT INTO wishes (version, phase, banner_type, name_zh, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?)',
            [wish.version, wish.phase, wish.banner_type, wish.name_zh || null, startDate || null, endDate || null]
          )
          const idRes = await query('SELECT MAX(id) as id FROM wishes')
          wishId = idRes.data?.[0]?.id
          if (!wishId) continue
          batchWishMap[key] = { wishId, bannerCount: 0 }
        }

        const currentBannerCount = batchWishMap[key].bannerCount

        // 插入 banners
        if (wish.banner_type === 'character-event') {
          const charFiveStars = fiveStarItems.filter(i => i.type === 'character')
          for (let bi = 0; bi < charFiveStars.length; bi++) {
            const char = charFiveStars[bi]
            const bannerName = char.name || ''
            const sortOrder = currentBannerCount + bi
            const imgArr = wish.banner_images && wish.banner_images.length > bi
              ? [wish.banner_images[bi].filename] : []
            await query(
              'INSERT INTO wish_banners (wish_id, name_zh, banner_image, sort_order) VALUES (?, ?, ?, ?)',
              [wishId, bannerName, imgArr.length > 0 ? JSON.stringify(imgArr) : null, sortOrder]
            )
            const bIdRes = await query('SELECT MAX(id) as id FROM wish_banners WHERE wish_id = ?', [wishId])
            const bannerId = bIdRes.data?.[0]?.id

            // 插入对应的 5星角色
            await query(
              'INSERT INTO wish_banner_items (banner_id, item_type, item_id, rarity, sort_order) VALUES (?, ?, ?, ?, ?)',
              [bannerId, 'character', char.id, 5, 0]
            )
            // 插入 4星角色（所有 banner 共享）
            for (let ii = 0; ii < fourStarItems.length; ii++) {
              const item = fourStarItems[ii]
              if (item.type === 'character') {
                await query(
                  'INSERT INTO wish_banner_items (banner_id, item_type, item_id, rarity, sort_order) VALUES (?, ?, ?, ?, ?)',
                  [bannerId, 'character', item.id, 4, ii + 1]
                )
              }
            }
          }
          batchWishMap[key].bannerCount += charFiveStars.length
        } else {
          // 武器祈愿：一个 banner
          const bannerName = '神铸赋形'
          const imgArr = wish.banner_images && wish.banner_images.length > 0
            ? [wish.banner_images[0].filename] : []
          await query(
            'INSERT INTO wish_banners (wish_id, name_zh, banner_image, sort_order) VALUES (?, ?, ?, ?)',
            [wishId, bannerName, imgArr.length > 0 ? JSON.stringify(imgArr) : null, currentBannerCount]
          )
          const bIdRes = await query('SELECT MAX(id) as id FROM wish_banners WHERE wish_id = ?', [wishId])
          const bannerId = bIdRes.data?.[0]?.id

          for (let ii = 0; ii < fiveStarItems.length; ii++) {
            const item = fiveStarItems[ii]
            await query(
              'INSERT INTO wish_banner_items (banner_id, item_type, item_id, rarity, sort_order) VALUES (?, ?, ?, ?, ?)',
              [bannerId, 'weapon', item.id, 5, ii]
            )
          }
          for (let ii = 0; ii < fourStarItems.length; ii++) {
            const item = fourStarItems[ii]
            await query(
              'INSERT INTO wish_banner_items (banner_id, item_type, item_id, rarity, sort_order) VALUES (?, ?, ?, ?, ?)',
              [bannerId, 'weapon', item.id, 4, fiveStarItems.length + ii]
            )
          }
          batchWishMap[key].bannerCount += 1
        }

        // 下载 banner 图片
        if (wish.banner_images) {
          for (const img of wish.banner_images) {
            try {
              await downloadBannerImage(img.url, img.filename)
              imageDownloadCount++
            } catch (_) {}
          }
        }

        insertedCount++
        taskList.push({ name: `${wish.version}.${wish.phase} ${wish.banner_type === 'character-event' ? '角色' : '武器'}`, status: 'done', message: `${fiveStarItems.map(i => i.name).join(', ')}` })
      }

      setWishTasks([
        { name: '往期祈愿', status: 'done', message: `完成！新增 ${insertedCount} 条，跳过 ${skippedCount} 条，下载图片 ${imageDownloadCount} 张` },
        ...taskList.filter(t => t.status === 'error'),
      ])
    } catch (e) {
      console.error('[startWishCrawl] error:', e)
      setWishTasks(prev => prev.map(t => t.status === 'running' ? { ...t, status: 'error', message: e.message } : t))
    } finally {
      setWishRunning(false)
      wishRunningRef.current = false
      setWishCurrentTask(null)
    }
  }

  function pauseWishCrawl() { setWishPaused(true); wishPausedRef.current = true }
  function resumeWishCrawl() { setWishPaused(false); wishPausedRef.current = false }
  function stopWishCrawl() { wishRunningRef.current = false; setWishRunning(false); setWishPaused(false); wishPausedRef.current = false; setWishCurrentTask(null) }

  // ── 修复模式：仅下载缺失的卡池图片 ──
  async function startWishFixCrawl() {
    if (wishRunningRef.current) return
    setWishRunning(true)
    wishRunningRef.current = true
    setWishCrawlerOpen(true)
    
    try {
      setWishTasks([{ name: '图片修复', status: 'running', message: '正在查询缺失图片的祈愿...' }])
      
      // 1. 查询数据库中哪些 wish_banners 没有图片
      const dbWishes = await query('SELECT id, version, phase, banner_type FROM wishes')
      const dbBanners = await query('SELECT id, wish_id, banner_image FROM wish_banners')
      const dbBannerItems = await query('SELECT banner_id FROM wish_banner_items')
      
      // 找到有内容的 banner（在 wish_banner_items 中有记录）但缺少图片的
      const bannersWithItems = new Set(dbBannerItems.data?.map(i => i.banner_id) || [])
      const missingBanners = (dbBanners.data || []).filter(b => 
        bannersWithItems.has(b.id) && (!b.banner_image || b.banner_image === 'null' || b.banner_image === '[]')
      )
      
      if (missingBanners.length === 0) {
        setWishTasks([{ name: '图片修复', status: 'done', message: '所有卡池已有图片，无需修复' }])
        setWishRunning(false)
        wishRunningRef.current = false
        return
      }
      
      setWishTasks([{ name: '图片修复', status: 'running', message: `发现 ${missingBanners.length} 个卡池缺图，正在获取...` }])
      
      // 2. 收集需要的期数（从 wishes 中推断）
      // 按 version+phase+banner_type 分组，同一组内的 banner 按顺序编号
      const groupMap = {}
      for (const w of (dbWishes.data || [])) {
        const k = `${w.version}|${w.phase}|${w.banner_type}`
        if (!groupMap[k]) groupMap[k] = []
        groupMap[k].push(w)
      }
      
      // 为每个缺失图片的 banner 构造 File 名
      const neededPeriods = []
      for (const banner of missingBanners) {
        const wish = (dbWishes.data || []).find(w => w.id === banner.wish_id)
        if (!wish) continue
        const k = `${wish.version}|${wish.phase}|${wish.banner_type}`
        const group = groupMap[k] || []
        const seq = group.findIndex(w => w.id === wish.id) + 1
        const isW = wish.banner_type === 'weapon-event'
        const sortBanners = (dbBanners.data || []).filter(b => b.wish_id === wish.id).sort((a, b) => a.id - b.id)
        const bannerSeq = sortBanners.findIndex(b => b.id === banner.id) + 1
        const periodFile = isW 
          ? `祈愿{期数}期武器.png`
          : `祈愿{期数}期.png`
        // 需要实际期数，从 wish 的 version+phase 反推？不，期数在模板中。改用 API 搜索
        neededPeriods.push({ bannerId: banner.id, wish })
      }
      
      // 实际上需要期数。改策略：重爬一次获取所有图片，只为缺图的 banner 下载
      setWishTasks([{ name: '图片修复', status: 'running', message: '正在从 wiki 获取图片列表...' }])
      
      // 用完整爬虫获取数据，然后只取图片
      const res = await crawlWishes()
      if (!res.success) {
        setWishTasks([{ name: '图片修复', status: 'error', message: res.error || '获取失败' }])
        setWishRunning(false)
        wishRunningRef.current = false
        return
      }
      
      const allWishes = res.data || []
      let fixed = 0
      
      // 为每个有图片的 wish，检查数据库对应项是否需要更新
      for (const wish of allWishes) {
        if (!wish.banner_images || wish.banner_images.length === 0) continue
        const key = `${wish.version}|${wish.phase}|${wish.banner_type}`
        const dbGroup = (dbWishes.data || []).filter(w => {
          return `${w.version}|${w.phase}|${w.banner_type}` === key
        })
        if (dbGroup.length === 0) continue
        
        // 匹配角色 banner（按顺序）
        if (wish.banner_type === 'character-event') {
          for (let bi = 0; bi < Math.min(wish.banner_images.length, dbGroup.length); bi++) {
            const dbWish = dbGroup[bi]
            const dbBannersForWish = (dbBanners.data || []).filter(b => b.wish_id === dbWish.id).sort((a, b) => a.id - b.id)
            for (let bj = 0; bj < dbBannersForWish.length; bj++) {
              const dbBanner = dbBannersForWish[bj]
              if (!dbBanner.banner_image || dbBanner.banner_image === 'null' || dbBanner.banner_image === '[]') {
                const imgIdx = Math.min(bi, wish.banner_images.length - 1)
                const img = wish.banner_images[imgIdx]
                if (img) {
                  try { await downloadBannerImage(img.url, img.filename) } catch (_) {}
                  await query('UPDATE wish_banners SET banner_image = ? WHERE id = ?', [JSON.stringify([img.filename]), dbBanner.id])
                  fixed++
                }
              }
            }
          }
        }
        
        // 武器 banner
        if (wish.banner_type === 'weapon-event' && dbGroup.length > 0) {
          const dbWish = dbGroup[0]
          const dbBannersForWish = (dbBanners.data || []).filter(b => b.wish_id === dbWish.id).sort((a, b) => a.id - b.id)
          for (const dbBanner of dbBannersForWish) {
            if (!dbBanner.banner_image || dbBanner.banner_image === 'null' || dbBanner.banner_image === '[]') {
              const img = wish.banner_images[0]
              if (img) {
                try { await downloadBannerImage(img.url, img.filename) } catch (_) {}
                await query('UPDATE wish_banners SET banner_image = ? WHERE id = ?', [JSON.stringify([img.filename]), dbBanner.id])
                fixed++
              }
            }
          }
        }
      }
      
      setWishTasks([{ name: '图片修复', status: 'done', message: `修复完成！补充 ${fixed} 个卡池图片` }])
    } catch (e) {
      console.error('[startWishFixCrawl] error:', e)
      setWishTasks([{ name: '图片修复', status: 'error', message: e.message }])
    } finally {
      setWishRunning(false)
      wishRunningRef.current = false
      setWishCurrentTask(null)
    }
  }

  // 爬虫按钮上显示运行状态
  const crawlerRunning = running && !paused
  const crawlerPaused = running && paused

  if (!devMode) return null

  return (
    <>
      {/* Bottom Toolbar */}
      <div className={`fixed bottom-0 right-0 z-40 h-10 bg-surface-900/95 border-t border-surface-700 backdrop-blur-sm flex items-center px-4 gap-1 ${sidebarCollapsed ? 'left-14' : 'left-56'}`}>
        <span className="text-[10px] text-surface-500 mr-2 font-mono uppercase tracking-wider">Dev</span>

        <button
          onClick={() => setBackupListOpen(true)}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs text-surface-400 hover:text-surface-200 hover:bg-surface-700 transition-colors"
        >
          <History className="w-3 h-3" />
          备份列表
        </button>

        <button
          onClick={() => setBackupCreateOpen(true)}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs text-surface-400 hover:text-surface-200 hover:bg-surface-700 transition-colors"
        >
          <Download className="w-3 h-3" />
          备份数据库
        </button>

        {/* 爬虫按钮 — 角色页面显示，运行时始终显示 */}
        {(isCharacterPage || running) && (
          <>
            <button
              onClick={openCrawler}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition-colors ${
                crawlerRunning ? 'text-primary-300 bg-primary-500/15 hover:bg-primary-500/25' :
                crawlerPaused ? 'text-amber-300 bg-amber-500/10 hover:bg-amber-500/20' :
                'text-primary-400 hover:text-primary-300 hover:bg-primary-500/10'
              }`}
            >
              {crawlerRunning ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Bug className="w-3 h-3" />
              )}
              信息爬虫
              {crawlerRunning && tasks.length > 0 && (
                <span className="text-[10px]">({tasks.filter(t => t.status === 'done').length}/{tasks.length})</span>
              )}
              {!running && selectedChars.length > 0 && !isDetailPage && (
                <span className="text-[10px]">({selectedChars.length})</span>
              )}
            </button>

            {isCharacterPage && (
              <>
                <button
                  onClick={clearCharacterData}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                  清除数据
                  {!isDetailPage && selectedChars.length > 0 && (
                    <span className="text-[10px]">({selectedChars.length})</span>
                  )}
                </button>
                <button
                  onClick={openFixCrawler}
                  disabled={running}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 transition-colors disabled:opacity-50"
                >
                  <Bug className="w-3 h-3" />
                  修复模式
                  {!running && selectedChars.length > 0 && !isDetailPage && (
                    <span className="text-[10px]">({selectedChars.length})</span>
                  )}
                </button>
              </>
            )}
          </>
        )}

        {/* 武器爬虫按钮 — 武器页面显示 */}
        {(isWeaponPage || weaponRunning) && (
          <>
            <button
              onClick={openWeaponCrawler}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition-colors ${
                weaponRunning && !weaponPaused ? 'text-primary-300 bg-primary-500/15 hover:bg-primary-500/25' :
                weaponRunning && weaponPaused ? 'text-amber-300 bg-amber-500/10 hover:bg-amber-500/20' :
                'text-primary-400 hover:text-primary-300 hover:bg-primary-500/10'
              }`}
            >
              {weaponRunning ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Bug className="w-3 h-3" />
              )}
              武器爬虫
              {weaponRunning && weaponTasks.length > 0 && (
                <span className="text-[10px]">({weaponTasks.filter(t => t.status === 'done').length}/{weaponTasks.length})</span>
              )}
              {!weaponRunning && selectedWeapons.length > 0 && !isWeaponDetailPage && (
                <span className="text-[10px]">({selectedWeapons.length})</span>
              )}
            </button>

            {isWeaponPage && (
              <>
                <button
                  onClick={clearWeaponData}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                  清除数据
                  {!isWeaponDetailPage && selectedWeapons.length > 0 && (
                    <span className="text-[10px]">({selectedWeapons.length})</span>
                  )}
                </button>
                <button
                  onClick={startLeakCheckCrawl}
                  disabled={weaponRunning}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 transition-colors disabled:opacity-50"
                >
                  <Bug className="w-3 h-3" />
                  查漏模式
                </button>
              </>
            )}
          </>
        )}

        {/* 材料类型修复 — 材料页面显示 */}
        {isMaterialPage && (
          <button
            onClick={fixMaterialTypes}
            disabled={selectedMats.length === 0}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Wrench className="w-3 h-3" />
            类型修复
            {selectedMats.length > 0 && (
              <span className="text-[10px]">({selectedMats.length})</span>
            )}
          </button>
        )}

        {/* 圣遗物爬虫按钮 — 圣遗物页面显示 */}
        {(isArtifactPage || artifactRunning) && (
          <>
            <button
              onClick={openArtifactCrawler}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition-colors ${
                artifactRunning && !artifactPaused ? 'text-primary-300 bg-primary-500/15 hover:bg-primary-500/25' :
                artifactRunning && artifactPaused ? 'text-amber-300 bg-amber-500/10 hover:bg-amber-500/20' :
                'text-primary-400 hover:text-primary-300 hover:bg-primary-500/10'
              }`}
            >
              {artifactRunning ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Bug className="w-3 h-3" />
              )}
              圣遗物爬虫
              {artifactRunning && artifactTasks.length > 0 && (
                <span className="text-[10px]">({artifactTasks.filter(t => t.status === 'done').length}/{artifactTasks.length})</span>
              )}
              {!artifactRunning && selectedArtifacts.length > 0 && !isArtifactDetailPage && (
                <span className="text-[10px]">({selectedArtifacts.length})</span>
              )}
            </button>

            {isArtifactPage && (
              <>
                <button
                  onClick={clearArtifactData}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                  清除数据
                  {!isArtifactDetailPage && selectedArtifacts.length > 0 && (
                    <span className="text-[10px]">({selectedArtifacts.length})</span>
                  )}
                </button>
                <button
                  onClick={startArtifactLeakCheckCrawl}
                  disabled={artifactRunning}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 transition-colors disabled:opacity-50"
                >
                  <Bug className="w-3 h-3" />
                  查漏模式
                </button>
              </>
            )}
          </>
        )}

        {/* 祈愿爬虫按钮 — 祈愿页面显示 */}
        {(isWishPage || wishRunning) && (
          <>
            <button
              onClick={() => { setWishCrawlerOpen(true); if (!wishRunning) startWishCrawl() }}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition-colors ${
                wishRunning && !wishPaused ? 'text-primary-300 bg-primary-500/15 hover:bg-primary-500/25' :
                wishRunning && wishPaused ? 'text-amber-300 bg-amber-500/10 hover:bg-amber-500/20' :
                'text-primary-400 hover:text-primary-300 hover:bg-primary-500/10'
              }`}
            >
              {wishRunning ? <Loader2 className="w-3 h-3 animate-spin" /> : <Bug className="w-3 h-3" />}
              祈愿爬虫
              {wishRunning && wishTasks.length > 0 && (
                <span className="text-[10px]">({wishTasks.filter(t => t.status === 'done').length}/{wishTasks.length})</span>
              )}
            </button>
            {isWishPage && (
              <button
                onClick={() => { setWishCrawlerOpen(true); if (!wishRunning) startWishFixCrawl() }}
                disabled={wishRunning}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 transition-colors disabled:opacity-50"
              >
                <Bug className="w-3 h-3" />
                修复卡池图
              </button>
            )}
          </>
        )}

      </div>

      {/* Modals */}
      <BackupListModal isOpen={backupListOpen} onClose={() => setBackupListOpen(false)} />
      <BackupCreateModal isOpen={backupCreateOpen} onClose={() => setBackupCreateOpen(false)} />
      <CrawlerPanel
        isOpen={crawlerOpen}
        onClose={() => setCrawlerOpen(false)}
        tasks={tasks}
        running={running}
        paused={paused}
        currentTask={currentTask}
        onStart={startCrawl}
        onPause={pauseCrawl}
        onResume={resumeCrawl}
        onStop={stopCrawl}
        fastMode={fastMode}
        onToggleFastMode={() => setFastMode(prev => !prev)}
        crawlMode={crawlMode}
        onToggleCrawlMode={setCrawlMode}
      />
      <CrawlerPanel
        isOpen={weaponCrawlerOpen}
        onClose={() => setWeaponCrawlerOpen(false)}
        tasks={weaponTasks}
        running={weaponRunning}
        paused={weaponPaused}
        currentTask={weaponCurrentTask}
        onStart={startWeaponCrawl}
        onPause={pauseWeaponCrawl}
        onResume={resumeWeaponCrawl}
        onStop={stopWeaponCrawl}
        fastMode={weaponFastMode}
        onToggleFastMode={() => setWeaponFastMode(prev => !prev)}
        crawlMode={weaponCrawlMode}
        onToggleCrawlMode={setWeaponCrawlMode}
      />
      <CrawlerPanel
        isOpen={artifactCrawlerOpen}
        onClose={() => setArtifactCrawlerOpen(false)}
        tasks={artifactTasks}
        running={artifactRunning}
        paused={artifactPaused}
        currentTask={artifactCurrentTask}
        onStart={startArtifactCrawl}
        onPause={pauseArtifactCrawl}
        onResume={resumeArtifactCrawl}
        onStop={stopArtifactCrawl}
        fastMode={artifactFastMode}
        onToggleFastMode={() => setArtifactFastMode(prev => !prev)}
        crawlMode={artifactCrawlMode}
        onToggleCrawlMode={setArtifactCrawlMode}
      />
      <CrawlerPanel
        isOpen={wishCrawlerOpen}
        onClose={() => setWishCrawlerOpen(false)}
        tasks={wishTasks}
        running={wishRunning}
        paused={wishPaused}
        currentTask={wishCurrentTask}
        onStart={startWishCrawl}
        onPause={pauseWishCrawl}
        onResume={resumeWishCrawl}
        onStop={stopWishCrawl}
        fastMode={false}
        onToggleFastMode={() => {}}
        crawlMode={'full'}
        onToggleCrawlMode={() => {}}
      />
    </>
  )
}

import { useState, useEffect } from 'react'
import { useDb } from '../context/DbContext'
import { Database, FolderOpen, Download, Loader2, AlertTriangle } from 'lucide-react'

function AppWizardIcon() {
  const [src, setSrc] = useState('./UI_Talent_U_Columbina_02.webp')
  // Try loading from DB images dir for higher quality, fall back to bundled asset
  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.readImage('UI_Talent_U_Columbina_02.webp')
        .then(res => { if (res?.data) setSrc(res.data) })
        .catch(() => {})
    }
  }, [])
  return <img src={src} alt="" className="w-full h-full object-cover" />
}

export default function SetupWizard() {
  const { selectLocation, initSchema } = useDb()
  const [step, setStep] = useState('welcome')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [seedStats, setSeedStats] = useState(null)

  // 加载种子数据统计
  useEffect(() => {
    async function load() {
      try {
        const result = await window.electronAPI?.getSeedStats()
        if (result?.success) setSeedStats(result.stats)
      } catch (_) {}
    }
    load()
  }, [])

  // 格式化数量描述
  function fmt(n) { return n ? `${n}+ ` : '' }

  async function handleSelectFolder() {
    setLoading(true)
    setError(null)
    try {
      const result = await selectLocation()
      console.log('[SetupWizard] selectLocation result:', JSON.stringify(result))
      if (result.success) {
        if (result.needsSeed) {
          setStep('init')
        } else {
          setStep('done')
        }
      } else if (result.error) {
        // IPC 返回了错误
        setError(result.error)
        setStep('welcome')
      } else {
        // 用户取消选择
        setStep('welcome')
      }
    } catch (e) {
      console.error('[SetupWizard] selectLocation error:', e)
      setError(String(e.message ?? e))
      setStep('welcome')
    } finally {
      setLoading(false)
    }
  }

  async function handleInitDb() {
    setLoading(true)
    setError(null)
    try {
      console.log('[SetupWizard] calling initSchema...')
      const result = await initSchema()
      console.log('[SetupWizard] initSchema result:', JSON.stringify(result))
      if (result?.success) {
        setStep('done')
      } else {
        setError(result?.error || '初始化返回失败')
      }
    } catch (e) {
      console.error('[SetupWizard] initSchema error:', e)
      setError(`初始化失败: ${e.message ?? e}`)
    } finally {
      setLoading(false)
    }
  }

  // … UI 部分和之前一样，这里只加了日志，不重新贴整个组件
  if (step === 'select') {
    return (
      <div className="h-screen flex items-center justify-center bg-surface-950 p-8">
        <div className="max-w-md w-full animate-scale-in">
          <div className="text-center mb-8">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-primary-500/10 flex items-center justify-center">
              <FolderOpen className="w-8 h-8 text-primary-400" />
            </div>
            <h1 className="text-xl font-semibold mb-2">选择数据存储位置</h1>
            <p className="text-surface-400 text-sm">
              选择一个文件夹来存放维基数据库文件。你可以在 Finder 中直接访问和编辑数据库内容。
            </p>
          </div>
          <button
            onClick={handleSelectFolder}
            disabled={loading}
            className="w-full py-3 px-4 bg-primary-600 hover:bg-primary-500 disabled:opacity-50
                       rounded-lg font-medium text-white transition-colors flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <FolderOpen className="w-5 h-5" />}
            {loading ? '正在打开...' : '选择文件夹'}
          </button>
          {error && <p className="mt-3 text-red-400 text-sm text-center">{error}</p>}
        </div>
      </div>
    )
  }

  if (step === 'init') {
    return (
      <div className="h-screen flex items-center justify-center bg-surface-950 p-8">
        <div className="max-w-md w-full animate-scale-in">
          <div className="text-center mb-8">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-amber-500/10 flex items-center justify-center">
              <Download className="w-8 h-8 text-amber-400" />
            </div>
            <h1 className="text-xl font-semibold mb-2">初始化数据库</h1>
            <p className="text-surface-400 text-sm">
              将导入银月终端基准数据，包括角色、武器、圣遗物、材料、祈愿、挑战和游戏数据。
            </p>
            {seedStats && (
              <p className="text-surface-500 text-xs mt-3">
                数据包含 {fmt(seedStats.characters)}角色、{fmt(seedStats.weapons)}武器、{fmt(seedStats.artifacts)}圣遗物套装、{fmt(seedStats.materials)}材料等。
              </p>
            )}
          </div>
          <button
            onClick={handleInitDb}
            disabled={loading}
            className="w-full py-3 px-4 bg-amber-600 hover:bg-amber-500 disabled:opacity-50
                       rounded-lg font-medium text-white transition-colors flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Database className="w-5 h-5" />}
            {loading ? '正在初始化...' : '初始化数据库'}
          </button>
          <button
            onClick={() => setStep('welcome')}
            className="w-full mt-3 py-2 text-surface-400 hover:text-surface-300 text-sm transition-colors"
          >
            返回
          </button>
          {error && (
            <div className="mt-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
                <p className="text-red-400 text-xs">{error}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  if (step === 'done') {
    return (
      <div className="h-screen flex items-center justify-center bg-surface-950 p-8">
        <div className="max-w-md w-full text-center animate-scale-in">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-green-500/10 flex items-center justify-center">
            <Database className="w-8 h-8 text-green-400" />
          </div>
          <h1 className="text-xl font-semibold mb-2">数据库已就绪</h1>
          <p className="text-surface-400 text-sm mb-6">
            银月终端数据库已初始化完成。现在可以开始浏览和编辑了。
          </p>
          <button
            onClick={() => window.location.reload()}
            className="py-3 px-6 bg-primary-600 hover:bg-primary-500 rounded-lg font-medium text-white transition-colors"
          >
            进入维基
          </button>
        </div>
      </div>
    )
  }

  // Welcome step
  return (
    <div className="h-screen flex items-center justify-center bg-surface-950 p-8">
      <div className="max-w-md w-full text-center animate-scale-in">
        <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-primary-500 to-accent-gold flex items-center justify-center shadow-lg shadow-primary-500/20 overflow-hidden">
          <AppWizardIcon />
        </div>
        <h1 className="text-2xl font-bold mb-2 tracking-tight">银月终端</h1>
        <p className="text-surface-400 text-sm mb-1">Genshin Impact Wiki Database</p>
        <p className="text-surface-500 text-xs mb-8">
          本地化的银月终端数据库，可查询和编辑游戏信息
        </p>
        <div className="grid grid-cols-3 gap-3 mb-8 text-left">
          {[
            { title: '角色', key: 'characters', desc: seedStats ? `${seedStats.characters}+ 角色完整信息` : '角色完整信息' },
            { title: '武器', key: 'weapons', desc: seedStats ? `${seedStats.weapons}+ 武器数据` : '武器数据' },
            { title: '资料', key: 'game_data', desc: '游戏机制与公式' },
          ].map(item => (
            <div key={item.title} className="p-3 rounded-lg bg-surface-800 text-center">
              <p className="text-xs font-medium text-white">{item.title}</p>
              <p className="text-[10px] text-surface-500 mt-1">{item.desc}</p>
            </div>
          ))}
        </div>
        {error && (
          <div className="mb-5 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-left">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
              <p className="text-red-400 text-xs leading-relaxed">{error}</p>
            </div>
          </div>
        )}
        <button
          onClick={() => setStep('select')}
          className="w-full py-3 px-4 bg-primary-600 hover:bg-primary-500 rounded-lg font-medium text-white transition-colors"
        >
          开始设置
        </button>
      </div>
    </div>
  )
}

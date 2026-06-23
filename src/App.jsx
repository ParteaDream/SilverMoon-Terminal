import { useState, useEffect, useCallback } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useDb } from './context/DbContext'
import { useNav } from './context/NavContext'
import { ChevronLeft, ChevronRight, ArrowUp, Minus, Square, X } from 'lucide-react'
import SetupWizard from './components/SetupWizard'
import Sidebar from './components/Sidebar'
import DevToolbar from './components/DevToolbar'
import UpdateToast from './components/UpdateToast'
import CharactersPage from './pages/CharactersPage'
import CharacterDetailPage from './pages/CharacterDetailPage'
import WeaponsPage from './pages/WeaponsPage'
import WeaponDetailPage from './pages/WeaponDetailPage'
import ArtifactsPage from './pages/ArtifactsPage'
import ArtifactDetailPage from './pages/ArtifactDetailPage'
import MaterialsPage from './pages/MaterialsPage'
import MaterialDetailPage from './pages/MaterialDetailPage'
import WishesPage from './pages/WishesPage'
import ChallengesPage from './pages/ChallengesPage'
import GameDataPage from './pages/GameDataPage'
import WebsitesPage from './pages/WebsitesPage'
import SettingsPage from './pages/SettingsPage'

// macOS hiddenInset titlebar: reserve 38px for traffic light buttons
const TITLEBAR_HEIGHT = 38

export default function App() {
  const { dbReady, needsSetup, devMode } = useDb()
  const { canGoBack, canGoForward, goBack, goForward } = useNav()
  const [showBackToTop, setShowBackToTop] = useState(false)

  // 禁用浏览器默认的滚动恢复，使用自定义恢复逻辑
  useEffect(() => {
    if ('scrollRestoration' in history) {
      history.scrollRestoration = 'manual'
    }
  }, [])

  // 监听主滚动容器，控制返回顶部按钮显隐
  const handleScroll = useCallback((e) => {
    setShowBackToTop(e.target.scrollTop > 400)
  }, [])

  function scrollToTop() {
    const main = document.querySelector('main')
    if (main) main.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const isWin = !/Mac/i.test(navigator.platform || '')
  // Mac: 为红绿灯留出顶部空间；Win: 无边框无需额外 padding
  const wrapperStyle = { paddingTop: isWin ? 0 : TITLEBAR_HEIGHT, height: '100vh' }

  const content = needsSetup ? (
    <SetupWizard />
  ) : !dbReady ? (
    <div className="h-full flex items-center justify-center">
      <div className="text-center animate-fade-in">
        <div className="w-12 h-12 mx-auto mb-4 rounded-full border-2 border-primary-500 border-t-transparent animate-spin" />
        <p className="text-surface-400 text-sm">正在初始化数据库...</p>
      </div>
    </div>
  ) : (
    <div className="h-full flex overflow-hidden">
      <Sidebar />
      <main className={`flex-1 overflow-y-auto overflow-x-hidden relative ${devMode ? 'pb-10' : ''}`} onScroll={handleScroll}>
        <Routes>
          <Route path="/" element={<Navigate to="/characters" replace />} />
          <Route path="/characters" element={<CharactersPage />} />
          <Route path="/characters/:id" element={<CharacterDetailPage />} />
          <Route path="/weapons" element={<WeaponsPage />} />
          <Route path="/weapons/:id" element={<WeaponDetailPage />} />
          <Route path="/artifacts" element={<ArtifactsPage />} />
          <Route path="/artifacts/:id" element={<ArtifactDetailPage />} />
          <Route path="/materials" element={<MaterialsPage />} />
          <Route path="/materials/:id" element={<MaterialDetailPage />} />
          <Route path="/wishes" element={<WishesPage />} />
          <Route path="/challenges" element={<ChallengesPage />} />
          <Route path="/data" element={<GameDataPage />} />
          <Route path="/websites" element={<WebsitesPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>

        {/* 返回顶部浮动按钮 */}
        {showBackToTop && (
          <button
            onClick={scrollToTop}
            className="fixed right-2 bottom-6 z-40 p-2 rounded-lg border
                       bg-surface-800/90 border-surface-600 text-surface-300
                       hover:text-white hover:bg-surface-700 hover:border-surface-500
                       shadow-lg transition-all animate-fade-in"
            title="返回顶部"
          >
            <ArrowUp className="w-5 h-5" />
          </button>
        )}

        {/* 右侧上一步/下一步浮动按钮 */}
        <div className="fixed right-2 top-1/2 -translate-y-1/2 z-40 flex flex-col gap-1">
          <button
            onClick={goBack}
            disabled={!canGoBack}
            className={`p-2 rounded-lg border transition-all ${
              canGoBack
                ? 'bg-surface-800/90 border-surface-600 text-surface-300 hover:text-white hover:bg-surface-700 hover:border-surface-500 shadow-lg'
                : 'bg-surface-800/40 border-surface-700/30 text-surface-600 cursor-not-allowed'
            }`}
            title="上一步"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button
            onClick={goForward}
            disabled={!canGoForward}
            className={`p-2 rounded-lg border transition-all ${
              canGoForward
                ? 'bg-surface-800/90 border-surface-600 text-surface-300 hover:text-white hover:bg-surface-700 hover:border-surface-500 shadow-lg'
                : 'bg-surface-800/40 border-surface-700/30 text-surface-600 cursor-not-allowed'
            }`}
            title="下一步"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </main>
      <DevToolbar />
      <UpdateToast />
    </div>
  )


  return (
    <div className="bg-surface-950" style={wrapperStyle}>
      {/* 顶部拖拽条 */}
      <div
        className="drag-region"
        style={{
          position: 'fixed', top: 0, left: isWin ? 0 : 72, right: 0,
          height: isWin ? 32 : TITLEBAR_HEIGHT, zIndex: 100,
          display: 'flex', alignItems: 'center',
          justifyContent: 'flex-end', paddingRight: 4,
        }}
      >
        {isWin && <WinControls />}
      </div>
      {content}
    </div>
  )
}

function WinControls() {
  const [isMax, setIsMax] = useState(false)

  useEffect(() => {
    window.electronAPI?.isMaximized().then(setIsMax).catch(() => {})
    const onResize = () => {
      window.electronAPI?.isMaximized().then(setIsMax).catch(() => {})
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const btn = 'no-drag w-8 h-7 flex items-center justify-center text-surface-400 hover:text-white hover:bg-surface-700/60 rounded transition-colors'

  return (
    <div className="flex items-center gap-0.5">
      <button className={btn} onClick={() => window.electronAPI?.minimizeWindow()} title="最小化">
        <Minus className="w-3 h-3" />
      </button>
      <button className={btn} onClick={() => window.electronAPI?.maximizeWindow()} title={isMax ? '还原' : '最大化'}>
        <Square className="w-2.5 h-2.5" />
      </button>
      <button className={`${btn} hover:bg-red-500/40 hover:text-red-300`} onClick={() => window.electronAPI?.closeWindow()} title="关闭">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}
import { useMemo, useState, useEffect, useRef, useLayoutEffect } from 'react'
import { APPS } from './appRegistry'
import { Search, X, Grid3x3 } from 'lucide-react'

/**
 * 资源库 — 参考 iOS App 资源库
 * 从 Dock 资源库图标位置展开的小窗（面板中心与图标中心纵向对齐），
 * 包含全部小程序，按名称/拼音排序；点击打开并收起；可拖拽图标到桌面
 */
export default function AppLibrary({ onClose, onOpenApp, dockBottom }) {
  const [search, setSearch] = useState('')
  const panelRef = useRef(null)
  const [pos, setPos] = useState({ left: '50%', transform: 'translateX(-50%)' })

  // 面板中心与资源库 Dock 图标中心对齐（图标找不到时回退到窗口居中）
  useLayoutEffect(() => {
    const compute = () => {
      const icon = document.querySelector('.terminal-dock-icon[data-app-id="library"]')
      const panel = panelRef.current
      if (!icon || !panel) return
      const ir = icon.getBoundingClientRect()
      const pr = panel.getBoundingClientRect()
      const centerX = ir.left + ir.width / 2
      let left = centerX - pr.width / 2
      // 边界约束：不超出视口
      left = Math.max(8, Math.min(left, window.innerWidth - pr.width - 8))
      setPos({ left: `${left}px`, transform: 'none' })
    }
    // 等面板渲染完成后再测量
    requestAnimationFrame(compute)
    const t = setTimeout(compute, 100)
    window.addEventListener('resize', compute)
    return () => { clearTimeout(t); window.removeEventListener('resize', compute) }
  }, [])

  // 点击面板外部关闭（捕获阶段，避免被内部 stopPropagation 拦截）
  // 忽略 Dock 图标自身的点击（含资源库图标）：由 Dock 的 click 处理打开/关闭，
  // 避免 mousedown 先关面板导致 Dock 在其他板块卸载、click 事件丢失
  useEffect(() => {
    const handler = (e) => {
      if (e.target.closest?.('.terminal-dock-icon')) return
      if (panelRef.current && !panelRef.current.contains(e.target)) onClose()
    }
    document.addEventListener('mousedown', handler, true)
    return () => document.removeEventListener('mousedown', handler, true)
  }, [onClose])

  // 按名称排序（中文按拼音，字母在前）
  const sortedApps = useMemo(() => {
    const collator = new Intl.Collator('zh-Hans-CN', { sensitivity: 'base', numeric: true })
    return [...APPS].sort((a, b) => collator.compare(a.name, b.name))
  }, [])

  const filtered = search
    ? sortedApps.filter(a => a.name.toLowerCase().includes(search.toLowerCase()))
    : sortedApps

  return (
    // 外层负责定位（translateX 不参与动画），内层播放 scale 动画，避免动画覆盖定位导致左跳
    <div className="fixed z-[210]" style={{ bottom: (dockBottom || 76) + 10, ...pos }}
      ref={panelRef}>
      <div className="w-[min(460px,90vw)] max-h-[55vh] flex flex-col rounded-2xl
        bg-surface-900/85 backdrop-blur-xl border border-white/10 shadow-2xl animate-scale-in">
        {/* 头部 */}
        <div className="flex items-center gap-2 px-4 pt-3 pb-2 shrink-0">
          <Grid3x3 className="w-4 h-4 text-surface-400 shrink-0" />
          <span className="text-xs font-medium text-surface-200">资源库</span>
          <span className="text-[10px] text-surface-500">{APPS.length} 个程序</span>
          <div className="flex-1" />
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-white/10 text-surface-500 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        {/* 搜索 */}
        <div className="px-4 pb-2 shrink-0">
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-surface-800/70 border border-surface-700/50">
            <Search className="w-3.5 h-3.5 text-surface-500 shrink-0" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="搜索程序..." className="flex-1 bg-transparent text-xs text-surface-200 placeholder-surface-600 outline-none" />
            {search && <button onClick={() => setSearch('')} className="text-surface-500 hover:text-surface-300"><X className="w-3 h-3" /></button>}
          </div>
        </div>
        {/* 程序网格 */}
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          <div className="grid grid-cols-4 sm:grid-cols-5 gap-1.5">
            {filtered.map(app => {
              const AppIcon = app.icon
              return (
                <div
                  key={app.id}
                  draggable
                  onDragStart={e => {
                    e.stopPropagation()
                    e.dataTransfer.setData('application/x-app-id', app.id)
                    e.dataTransfer.setData('text/plain', 'library-app:' + app.id)
                    e.dataTransfer.effectAllowed = 'copy'
                  }}
                  onClick={() => onOpenApp(app)}
                  className="flex flex-col items-center gap-1.5 p-2 rounded-xl hover:bg-white/5 cursor-pointer transition-colors group"
                  title={`${app.name}（可拖到桌面）`}
                >
                  <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${app.color || 'from-white/10 to-white/5'} border border-white/10 flex items-center justify-center shadow-md
                    group-hover:scale-105 transition-transform`}>
                    <AppIcon className={`w-6 h-6 ${app.iconClass || 'text-white drop-shadow-md'}`} />
                  </div>
                  <span className="text-[10px] text-surface-300 text-center leading-tight line-clamp-2 group-hover:text-white transition-colors">{app.name}</span>
                </div>
              )
            })}
          </div>
          {filtered.length === 0 && (
            <div className="py-10 text-center text-[11px] text-surface-500">无匹配程序</div>
          )}
        </div>
      </div>
    </div>
  )
}

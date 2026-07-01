import { useLocation } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { notifySidebarToggled } from '../context/SidebarContext'
import { useNav } from '../context/NavContext'
import {
  Users, Swords, Gem, Package, Gift, SwordsIcon, Database, Globe, Settings, Info,
  PanelLeftClose, PanelLeftOpen, ScrollText
} from 'lucide-react'

const navItems = [
  { to: '/characters', icon: Users, label: '角色' },
  { to: '/weapons', icon: Swords, label: '武器' },
  { to: '/artifacts', icon: Gem, label: '圣遗物' },
  { to: '/materials', icon: Package, label: '材料' },
  { to: '/wishes', icon: Gift, label: '祈愿' },
  { to: '/challenges', icon: SwordsIcon, label: '挑战' },
  { to: '/data', icon: Database, label: '数据' },
  { to: '/websites', icon: Globe, label: '站点' },
  { to: '/settings', icon: Settings, label: '设置' },
]

export default function Sidebar() {
  const [appIcon, setAppIcon] = useState('./UI_Talent_U_Columbina_02.webp')
  const [collapsed, setCollapsed] = useState(false) // always start expanded
  const [appVersion, setAppVersion] = useState('1.0')
  const { push } = useNav()
  const location = useLocation()

  useEffect(() => {
    if (window.electronAPI?.getAppVersion) {
      window.electronAPI.getAppVersion().then(r => {
        if (r?.version) setAppVersion(r.version)
      }).catch(() => {})
    }
  }, [])

  function toggleCollapsed() {
    setCollapsed(prev => {
      const next = !prev
      localStorage.setItem('sidebar_collapsed', next ? '1' : '0')
      setTimeout(() => notifySidebarToggled(), 50)
      return next
    })
  }

  useEffect(() => {
    // Check localStorage first, then DB for custom icon
    const stored = localStorage.getItem('app_icon')
    if (stored) {
      loadCustomIcon(stored)
      return
    }
    if (window.electronAPI) {
      window.electronAPI.dbQuery("SELECT value FROM settings WHERE key = 'app_icon'")
        .then(res => {
          if (res?.data?.length > 0) {
            try {
              const filename = JSON.parse(res.data[0].value)
              if (filename) {
                localStorage.setItem('app_icon', filename)
                loadCustomIcon(filename)
              }
            } catch (_) {}
          }
        })
        .catch(() => {})
    }
  }, [])

  async function loadCustomIcon(filename) {
    try {
      const res = await window.electronAPI.readUserImage(filename)
      if (res?.data) setAppIcon(res.data)
    } catch (_) {}
  }

  // Listen for icon changes from settings
  useEffect(() => {
    const handler = () => {
      const stored = localStorage.getItem('app_icon')
      if (stored) loadCustomIcon(stored)
      else setAppIcon('./UI_Talent_U_Columbina_02.webp')
    }
    window.addEventListener('app-icon-changed', handler)
    return () => window.removeEventListener('app-icon-changed', handler)
  }, [])

  return (
    <aside className={`${collapsed ? 'w-14' : 'w-56'} flex-shrink-0 border-r border-surface-800 bg-surface-900/80 backdrop-blur-xl flex flex-col transition-all duration-200 drag-region`}>
      {/* Header / drag region */}
      <div className={`h-12 flex items-center border-b border-surface-800 flex-shrink-0 ${collapsed ? 'justify-center px-2' : 'px-4'}`}>
        {!collapsed && (
          <div className="flex items-center gap-2 no-drag">
            <div className="w-6 h-6 rounded-md flex items-center justify-center overflow-hidden app-icon-bg">
              {appIcon ? (
                <img src={appIcon} alt="" className="w-full h-full object-cover" />
              ) : (
                <Database className="w-3.5 h-3.5 text-white" />
              )}
            </div>
            <span className="text-sm font-semibold tracking-tight">银月终端</span>
          </div>
        )}
        {collapsed && (
          <div className="w-6 h-6 rounded-md flex items-center justify-center overflow-hidden no-drag app-icon-bg">
            {appIcon ? (
              <img src={appIcon} alt="" className="w-full h-full object-cover" />
            ) : (
              <Database className="w-3.5 h-3.5 text-white" />
            )}
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className={`flex-1 py-4 space-y-0.5 overflow-y-auto ${collapsed ? 'px-2' : 'px-3'}`}>
        {navItems.map(item => {
          const isActive = location.pathname === item.to || location.pathname.startsWith(item.to + '/')
          return (
          <button
            key={item.to}
            onClick={() => push(item.to)}
            title={collapsed ? item.label : undefined}
            className={`flex items-center rounded-lg text-sm font-medium w-full
               transition-all duration-200 no-drag
               ${collapsed
                 ? 'justify-center px-0 py-2.5'
                 : 'gap-3 px-3 py-2.5'
               }
               ${isActive
                 ? 'bg-primary-500/10 text-primary-400 shadow-sm'
                 : 'text-surface-400 hover:bg-[rgb(var(--scrollbar-thumb))] hover:text-[rgb(var(--btn-text-4th))] hover:ring-2 hover:ring-[rgb(var(--color-1))] hover:shadow-lg'
               }`
            }
          >
            <item.icon className="w-4 h-4 flex-shrink-0" />
            {!collapsed && <span>{item.label}</span>}
          </button>
        )})}
      </nav>

      {/* Changelog button — fixed at bottom, above collapse */}
      <div className={`flex-shrink-0 ${collapsed ? 'px-2' : 'px-3'} pb-1`}>
        <button
          onClick={() => push('/changelog')}
          title={collapsed ? 'Changelog' : undefined}
          className={`flex items-center rounded-lg w-full no-drag transition-all duration-200
            ${collapsed
              ? 'justify-center px-0 py-3'
              : 'gap-3 px-3 py-3.5'
            }
            ${location.pathname.startsWith('/changelog')
              ? 'bg-primary-500/10 text-primary-400 shadow-sm'
              : 'text-surface-400 hover:bg-[rgb(var(--scrollbar-thumb))] hover:text-[rgb(var(--btn-text-4th))] hover:ring-2 hover:ring-[rgb(var(--color-1))] hover:shadow-lg'
            }`
        }
        >
          <ScrollText className={`flex-shrink-0 ${collapsed ? 'w-5 h-5' : 'w-5 h-5'}`} />
          {!collapsed && <span className="text-lg font-bold italic tracking-wide">Changelog</span>}
        </button>
      </div>

      {/* Toggle button */}
      <div className="p-2 border-t border-surface-800 flex-shrink-0">
        <button
          onClick={toggleCollapsed}
          className={`w-full flex items-center rounded-lg text-xs text-surface-500 hover:text-surface-300 hover:bg-surface-800/50 transition-colors no-drag ${collapsed ? 'justify-center py-2' : 'gap-2 px-2 py-2'}`}
          title={collapsed ? '展开侧栏' : '收起侧栏'}
        >
          {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          {!collapsed && <span>收起侧栏</span>}
        </button>
      </div>

      {/* Footer */}
      <div className={`p-3 border-t border-surface-800 flex-shrink-0 ${collapsed ? 'text-center' : ''}`}>
        <button
          onClick={() => push('/settings?module=version')}
          title="版本信息"
          className={`flex items-center text-xs text-surface-500 hover:text-primary-400 transition-colors no-drag ${collapsed ? 'w-full justify-center' : 'gap-2 px-2'}`}
        >
          <Info className="w-3.5 h-3.5 flex-shrink-0" />
          {!collapsed && <span>SilverMoon Terminal v{appVersion}</span>}
        </button>
      </div>
    </aside>
  )
}

import {
  Calculator, FileText, FolderOpen, Settings2, Swords, Globe, Images, BarChart3, Landmark, Star, Compass, Hourglass, LayoutGrid
} from 'lucide-react'

/** 应用程序注册表 — 终端板块的权威定义 */
export const APPS = [
  { id: 'traincalc', name: '养成计算器', icon: Calculator, placeholder: false, color: 'from-gray-700 to-orange-400', iconClass: 'text-white drop-shadow-md' },
  { id: 'betamemo', name: 'Beta备忘录', icon: FileText, placeholder: false, color: 'from-white to-gray-100', iconClass: 'text-yellow-500 drop-shadow-sm' },
  { id: 'dragonsnake', name: '非完备证明', icon: Swords, placeholder: false, color: 'from-emerald-700 to-teal-400', iconClass: 'text-white drop-shadow-md' },
  { id: 'worldtree', name: '世界树', icon: Globe, placeholder: false, color: 'from-green-600 to-emerald-400', iconClass: 'text-white drop-shadow-sm' },
  { id: 'album', name: '切片辖域·鸽', icon: Images, placeholder: false, color: 'from-pink-500 to-rose-600', iconClass: 'text-white drop-shadow-md' },
  { id: 'ratefetcher', name: 'RateFetcher', icon: BarChart3, placeholder: false, color: 'from-cyan-700 to-blue-400', iconClass: 'text-white drop-shadow-md' },
  { id: 'northlandbank', name: '北国银行', icon: Landmark, placeholder: false, color: 'from-amber-700 to-yellow-500', iconClass: 'text-white drop-shadow-md' },
  { id: 'gachastation', name: '祈愿捕捉站', icon: Star, placeholder: false, color: 'from-blue-600 to-cyan-400', iconClass: 'text-white drop-shadow-md' },
  { id: 'memoryhub', name: '摹忆中枢', icon: Compass, placeholder: false, color: 'from-amber-500 to-yellow-400', iconClass: 'text-white drop-shadow-md' },
  { id: 'hourglass', name: '时之沙', icon: Hourglass, placeholder: false, color: 'from-indigo-600 to-violet-500', iconClass: 'text-white drop-shadow-md' },
]

export const SYS_TOOLS = [
  { id: 'resources', name: '资源', icon: FolderOpen, system: true, color: 'from-blue-500 to-sky-300', iconClass: 'text-white drop-shadow-md' },
  { id: 'customize', name: '自定义', icon: Settings2, system: true, color: 'from-purple-500 to-pink-400', iconClass: 'text-white drop-shadow-md' },
  { id: 'library', name: '资源库', icon: LayoutGrid, system: true, color: 'from-slate-500 to-slate-300', iconClass: 'text-white drop-shadow-md' },
]

// 解析快捷键字符串 'ctrl+tab' / 'shift+alt+l' 等
export function parseShortcut(shortcut) {
  if (!shortcut) return null
  const parts = String(shortcut).toLowerCase().split('+').filter(Boolean)
  if (parts.length === 0) return null
  const key = parts[parts.length - 1]
  return {
    ctrl: parts.includes('ctrl'),
    alt: parts.includes('alt'),
    shift: parts.includes('shift'),
    meta: parts.includes('meta'),
    key,
  }
}

// 判断键盘事件是否匹配快捷键
export function matchShortcut(e, shortcut) {
  const spec = parseShortcut(shortcut)
  if (!spec) return false
  if (e.ctrlKey !== spec.ctrl || e.altKey !== spec.alt || e.shiftKey !== spec.shift || e.metaKey !== spec.meta) return false
  const k = e.key.toLowerCase()
  if (spec.key === 'tab') return k === 'tab'
  if (spec.key === 'space') return k === ' ' || k === 'spacebar'
  if (spec.key.length === 1) return k === spec.key
  return k === spec.key
}

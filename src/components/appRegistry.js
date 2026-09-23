import {
  Calculator, FileText, FolderOpen, Settings2, Swords, Globe, Images, BarChart3, Landmark, Star, Compass, Hourglass, LayoutGrid, Bot
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
  { id: 'ai', name: 'AI', icon: Bot, system: true, color: 'from-indigo-600 to-violet-500', iconClass: 'text-white drop-shadow-md' },
  { id: 'resources', name: '资源', icon: FolderOpen, system: true, color: 'from-blue-500 to-sky-300', iconClass: 'text-white drop-shadow-md' },
  { id: 'customize', name: '自定义', icon: Settings2, system: true, color: 'from-purple-500 to-pink-400', iconClass: 'text-white drop-shadow-md' },
  { id: 'library', name: '资源库', icon: LayoutGrid, system: true, color: 'from-slate-500 to-slate-300', iconClass: 'text-white drop-shadow-md' },
]

// 快捷键解析/匹配已迁移至 src/utils/keymap.mjs（全键盘适配基建 M0）。
// 此处保留重导出以兼容历史导入点；语义与实现完全一致。
export { parseShortcut, matchShortcut } from '../utils/keymap'

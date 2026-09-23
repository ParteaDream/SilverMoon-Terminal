// ═════════════════════════════════════════════════════════════════
// AppShortcuts.jsx — 壳层应用级按键（规划 M1，2025-09 二轮修订）
//
// 键盘模型（用户反馈修订）：
//   · Tab 是侧栏专属循环选择器：只覆盖 板块按钮 + 收起/展开 + 版本信息，
//     绝不落入页面内容；Shift+Tab 反向循环（输入框内保留原生 Tab 行为）
//   · 内容区进入：侧栏 Enter 打开板块；已在当前板块时再按 Enter 聚焦页面
//     主区域（搜索框优先）；Esc 返回侧栏 —— 闭环且全部单键
//   · 同一物理键只保留一个功能：'/' 与 '?' 同键 → 仅 '/' 聚焦搜索，
//     帮助改 F1；标点键绑定一律附 e.code 物理匹配（兼容中英文输入法）
//   · 无修饰单键：[/] 后退前进、/ 搜索、F1 帮助、Home/End/PageUp/PageDown 滚动
// ═════════════════════════════════════════════════════════════════
import { useState } from 'react'
import { useNav } from '../context/NavContext'
import { useShortcut } from '../context/ShortcutContext'
import { scrollMainByKey, focusPageSearch, focusSidebarControl } from '../utils/pageKeyboard'
import HelpOverlay from './HelpOverlay'
import PageCursor from './PageCursor'

const SCROLL_KEYS = ['home', 'end', 'pageup', 'pagedown']

export default function AppShortcuts() {
  const { goBack, goForward, canGoBack, canGoForward } = useNav()
  const [helpOpen, setHelpOpen] = useState(false)

  // 后退 / 前进：物理键 [ ]（中文输入法下 e.key 可能变化，e.code 稳定）
  useShortcut('app.back', {
    keys: ['['],
    codes: ['BracketLeft'],
    scope: 'app',
    handler: (e) => { if (canGoBack) { e.preventDefault(); goBack() } },
  })
  useShortcut('app.forward', {
    keys: [']'],
    codes: ['BracketRight'],
    scope: 'app',
    handler: (e) => { if (canGoForward) { e.preventDefault(); goForward() } },
  })

  // 主内容区滚动代理（输入框/文本域内保留原生编辑行为）
  useShortcut('scroll.main', {
    keys: SCROLL_KEYS,
    scope: 'app',
    handler: (e) => { if (scrollMainByKey(e.key)) e.preventDefault() },
  })

  // '/' 聚焦当前页搜索框（与 '?' 同物理键 → 该键仅此一个功能）
  useShortcut('page.search', {
    keys: ['/'],
    codes: ['Slash'],
    scope: 'app',
    handler: (e) => { if (focusPageSearch()) e.preventDefault() },
  })

  // Esc：无弹层时返回侧栏（内容区 → 板块选择闭环）
  // 输入豁免补充：聚焦在 <input>（含搜索框）时也返回侧栏；textarea/select/
  // contentEditable 保留（未来由各自区域/编辑语义接管）；IME 组词期由注册中心放行
  useShortcut('focus.sidebar', {
    keys: ['Escape'],
    scope: 'app',
    allowInInput: true,
    when: () => {
      const el = document.activeElement
      if (!el || el.nodeType !== 1) return true
      if (el.closest && el.closest('aside')) return false
      const tag = String(el.tagName || '').toUpperCase()
      if (tag === 'TEXTAREA' || tag === 'SELECT') return false
      if (el.isContentEditable) return false
      return true
    },
    handler: (e) => {
      if (focusSidebarControl(1)) e.preventDefault()
    },
  })

  // Tab = 侧栏循环选择器（system 级键由注册中心统一分发；弹层/菜单的圈闭在
  // capture 阶段已拦截本事件，不会到达这里；输入态由注册中心豁免）
  useShortcut('tab.sidebar-cycle', {
    keys: ['tab'],
    scope: 'system',
    when: () => {
      const el = document.activeElement
      if (el && el.nodeType === 1 && el.closest) {
        if (el.closest('[role="dialog"], [role="menu"]')) return false
      }
      return true
    },
    handler: (e) => {
      // Ctrl+Tab（资源库）等带修饰键的 Tab 不会命中（注册中心修饰键严格匹配）
      if (focusSidebarControl(e.shiftKey ? -1 : 1)) e.preventDefault()
    },
  })

  // F1 快捷键速查（与 '/' 解耦；system 级：弹层打开也可用）
  useShortcut('help.overlay', {
    keys: ['f1'],
    scope: 'system',
    handler: (e) => {
      e.preventDefault()
      setHelpOpen(o => !o)
    },
  })

  return (
    <>
      <PageCursor />
      <HelpOverlay open={helpOpen} onClose={() => setHelpOpen(false)} />
    </>
  )
}

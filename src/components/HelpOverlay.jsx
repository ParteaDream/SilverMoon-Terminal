// ═════════════════════════════════════════════════════════════════
// HelpOverlay.jsx — 快捷键速查浮层（全键盘适配基建，规划 M0；M1 起绑定 '?'）
// 数据源：KEYMAP 目录（默认键位）+ 注册中心当前活跃绑定（实时状态，
// 未绑定的目录项以 40% 透明 + "未启用" 标注，绑定后自动点亮）。
// ═════════════════════════════════════════════════════════════════
import { useMemo } from 'react'
import { KEYMAP, formatShortcut } from '../utils/keymap'
import { useShortcutRegistry } from '../context/ShortcutContext'
import useOverlay from '../hooks/useOverlay'

const SCOPE_LABELS = {
  system: '全局（弹层打开时也生效）',
  app: '应用级（弹层打开时不响应）',
  page: '页面级',
  overlay: '弹层内',
}

export default function HelpOverlay({ open, onClose }) {
  const ov = useOverlay({ open, onClose, label: '快捷键速查', initialFocus: 'auto' })
  const reg = useShortcutRegistry()
  const active = useMemo(() => {
    const m = {}
    if (reg) {
      for (const { id, spec } of reg.listActive()) m[id] = spec.keys || []
    }
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reg])
  const groups = useMemo(() => {
    const by = {}
    for (const entry of KEYMAP) {
      ;(by[entry.scope] ||= []).push(entry)
    }
    return by
  }, [])

  if (!open) return null
  return (
    <div ref={ov.overlayRef} {...ov.overlayProps} className="fixed inset-0 z-[3000] bg-black/60 backdrop-blur-sm flex items-center justify-center p-6 animate-fade-in">
      <div className="w-full max-w-lg max-h-[75vh] overflow-y-auto rounded-2xl border border-white/10 bg-surface-900 shadow-2xl p-5 animate-scale-in">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-white">快捷键速查</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭快捷键速查"
            className="p-1.5 rounded-lg text-surface-400 hover:text-white hover:bg-surface-700 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <p className="text-xs text-surface-500 mb-4">
          MOD = ⌘（macOS）或 Ctrl（Windows）。输入框内打字时不触发字母/符号类快捷键；
          弹层打开时不响应应用级键位（按 Esc 关闭弹层）。Esc 通用：关闭当前弹层/菜单。
        </p>
        {Object.entries(groups).map(([scope, entries]) => (
          <div key={scope} className="mb-4">
            <h3 className="text-xs font-semibold text-surface-400 mb-1.5">{SCOPE_LABELS[scope] || scope}</h3>
            <div className="space-y-1">
              {entries.map(e => {
                const boundKeys = active[e.id]
                const isInfo = !(e.keys && e.keys.length)
                const enabled = !!boundKeys || isInfo
                return (
                  <div key={e.id} className={`flex items-center justify-between gap-3 py-1 transition-opacity ${enabled ? '' : 'opacity-40'}`}>
                    <span className="text-sm text-surface-300">
                      {e.desc}
                      {!enabled && <span className="text-[10px] text-surface-500 ml-1.5">未启用（后续阶段）</span>}
                    </span>
                    <span className="flex items-center gap-1">
                      {(boundKeys || e.keys).map(k => <kbd key={k} className="kbd">{formatShortcut(k)}</kbd>)}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

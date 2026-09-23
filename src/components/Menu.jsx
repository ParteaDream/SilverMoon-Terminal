// ═════════════════════════════════════════════════════════════════
// Menu.jsx — 通用键盘菜单（全键盘适配基建，规划 M0）
//
// 统一替代散落的右键/操作菜单（role=menu）。支持三种触发之外的纯键盘操作：
//   打开后自动聚焦首项；↑/↓/Home/End 导航（跳过禁用项）；
//   Enter/Space 选中；Esc 关闭并还原焦点；Tab 视同导航（焦点不逃逸）；
//   鼠标：hover 移动焦点、点击项选中、点击遮罩关闭。
//
// 用法：
//   const [menu, setMenu] = useState(null)   // { x, y } 或 anchor 元素
//   <Menu open={!!menu} anchor={menu} items={items} onSelect={(id)=>{...}}
//         onClose={() => setMenu(null)} />
// items: [{ id, label, icon?, danger?, disabled?, separator? }]
// ═════════════════════════════════════════════════════════════════
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const ITEM_H = 34   // 行高估算（含内边距），用于开合方向与高度计算
const MENU_PAD = 8

function isItemClickable(it) { return !it.separator && !it.disabled }

export default function Menu({ open, onClose, anchor, items = [], onSelect, width = 176 }) {
  const [pos, setPos] = useState(null)
  const menuRef = useRef(null)
  const itemElsRef = useRef(new Map())
  const prevFocusRef = useRef(null)

  const clickable = useMemo(() => items.map((it, i) => ({ it, i })).filter(x => isItemClickable(x.it)), [items])

  // 打开时：记录 opener 焦点 + 测量定位
  useLayoutEffect(() => {
    if (!open) { setPos(null); return }
    if (document.activeElement && document.activeElement !== document.body) {
      prevFocusRef.current = document.activeElement
    }
    let x = 0; let y = 0
    if (anchor && typeof anchor.getBoundingClientRect === 'function') {
      const r = anchor.getBoundingClientRect()
      x = r.left; y = r.bottom + 4
    } else if (anchor && typeof anchor.x === 'number' && typeof anchor.y === 'number') {
      x = anchor.x; y = anchor.y
    }
    const estH = Math.min(items.length * ITEM_H + 12, window.innerHeight - 16)
    const w = width
    // 视口翻转
    if (y + estH > window.innerHeight - 8) {
      if (anchor && typeof anchor.getBoundingClientRect === 'function') {
        y = anchor.getBoundingClientRect().top - estH - 4
      } else {
        y = Math.max(8, window.innerHeight - estH - 8)
      }
    }
    x = Math.min(Math.max(4, x), window.innerWidth - w - 8)
    setPos({ x, y, w })
  }, [open, anchor, items.length, width])

  // 聚焦首项（项元素在 portal 挂载后）
  useEffect(() => {
    if (!open || clickable.length === 0) return
    focusItem(clickable[0].i)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const focusItem = (index) => {
    const el = itemElsRef.current.get(index)
    if (el && typeof el.focus === 'function') {
      el.focus({ preventScroll: true })
      el.scrollIntoView({ block: 'nearest' })
    }
  }

  // 关闭时还原焦点（含 Esc 路径）
  useEffect(() => {
    if (open) return
    if (prevFocusRef.current) {
      const p = prevFocusRef.current
      prevFocusRef.current = null
      if (p.isConnected !== false && typeof p.focus === 'function') {
        try { p.focus({ preventScroll: true }) } catch (_) { p.focus() }
      }
    }
  }, [open])

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation(); onClose(); return
    }
    if (clickable.length === 0) return
    const activeEl = document.activeElement
    // 当前焦点所在项索引（可能不在菜单内——首次聚焦已保证在项上）
    const getIdx = () => {
      for (const { i } of clickable) {
        if (itemElsRef.current.get(i) === activeEl) return i
      }
      return clickable[0].i
    }
    if (e.key === 'ArrowDown' || e.key === 'Tab') {
      e.preventDefault()
      const list = clickable
      const cur = list.findIndex(x => x.i === getIdx())
      focusItem(list[(cur + 1) % list.length].i)
    } else if (e.key === 'ArrowUp' || (e.shiftKey && e.key === 'Tab')) {
      e.preventDefault()
      const list = clickable
      const cur = list.findIndex(x => x.i === getIdx())
      focusItem(list[(cur - 1 + list.length) % list.length].i)
    } else if (e.key === 'Home') {
      e.preventDefault(); focusItem(clickable[0].i)
    } else if (e.key === 'End') {
      e.preventDefault(); focusItem(clickable[clickable.length - 1].i)
    }
    // Enter/Space：由原生 button 行为触发 click → onSelect
  }

  if (!open) return null

  const menuEl = (
    <>
      {/* 遮罩：点击关闭（自身不可聚焦，不参与 Tab） */}
      <div className="fixed inset-0 z-[998]" onClick={onClose} role="presentation" aria-hidden="true" />
      <div
        ref={menuRef}
        role="menu"
        className="fixed z-[999] py-1 rounded-xl bg-surface-900/95 backdrop-blur-xl border border-white/10 shadow-2xl animate-scale-in overflow-y-auto"
        style={pos ? { left: pos.x, top: pos.y, width: pos.w, maxHeight: 'calc(100vh - 16px)' } : { visibility: 'hidden' }}
        onKeyDown={handleKeyDown}
      >
        {items.map((it, idx) => {
          if (it.separator) {
            return <div key={it.id || 'sep-' + idx} role="separator" className="my-1 mx-2 h-px bg-white/10" />
          }
          const Icon = it.icon || null
          return (
            <button
              key={it.id}
              ref={(n) => { if (n) itemElsRef.current.set(idx, n); else itemElsRef.current.delete(idx) }}
              role="menuitem"
              disabled={it.disabled}
              onMouseEnter={(e) => { if (!it.disabled) e.currentTarget.focus({ preventScroll: true }) }}
              onClick={(e) => {
                e.stopPropagation()
                if (it.disabled) return
                onSelect(it.id)
                onClose()
              }}
              className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-left text-sm transition-colors
                ${it.danger ? 'text-red-400 hover:bg-red-500/10' : 'text-surface-200 hover:bg-white/10'}
                disabled:opacity-40 disabled:pointer-events-none`}
              style={{ outlineOffset: -2 }}
            >
              {Icon && <Icon className={`w-4 h-4 shrink-0 ${it.danger ? 'text-red-400' : 'text-surface-400'}`} />}
              <span className="truncate">{it.label}</span>
            </button>
          )
        })}
      </div>
    </>
  )
  return createPortal(menuEl, document.body)
}

// 便捷：从键盘事件位置打开菜单（右键事件用）
export function menuPosFromEvent(e) {
  return { x: e.clientX, y: e.clientY }
}
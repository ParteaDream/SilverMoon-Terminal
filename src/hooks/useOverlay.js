// ═════════════════════════════════════════════════════════════════
// useOverlay.js — 弹层焦点管理原语（全键盘适配基建，规划 M0/M2）
//
// 弹层行为规范（规划 §2.4）：
//   1. 打开瞬间记录 document.activeElement（关闭/卸载后还原，若仍在文档中）
//   2. 初始焦点：'auto'（默认，首个可聚焦控件）/ 'none' / CSS 选择器
//   3. Tab/Shift+Tab 圈闭（trap 默认开启；锚定轻浮层可关）
//   4. Esc 关闭——叠层时仅栈顶响应（配合 ShortcutProvider overlay 栈）；
//      IME 组词期（isComposing/229）不拦截 Esc（先交给输入法取消组词）
//   5. dialog=true 时给 role=dialog + aria-modal + label/labelledBy
//   6. dialog=false 用于锚定 popover/dropdown（不加弹窗语义）
// 用法：open 由调用方控制（含"父级条件挂载"模式：卸载时自动还原焦点）。
// ═════════════════════════════════════════════════════════════════
import { useCallback, useContext, useEffect, useId, useRef } from 'react'
import ShortcutCtx from '../context/ShortcutContext'
import { queryTabbables, handleTabInTrap, safeFocus } from '../utils/focusTrap'

export default function useOverlay({
  open,
  onClose,
  label,
  labelledBy,
  initialFocus = 'auto',   // 'auto' | 'none' | CSS 选择器（容器内）
  restoreFocus = true,
  escCloses = true,
  dialog = true,           // false：锚定浮层（popover/dropdown），不加 dialog 语义
  trap = true,             // false：不做 Tab 圈闭
}) {
  const overlayElRef = useRef(null)
  const prevFocusRef = useRef(null)
  const wasOpenRef = useRef(false)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const token = 'ov:' + useId()
  const ctx = useContext(ShortcutCtx)
  // 依赖稳定的回调引用而非整个 ctx：ctx 每次 overlay 栈变化都会换新对象，
  // 直接把 ctx 写进 effect deps 会形成 push→bump→ctx 变→cleanup pop→bump 的死循环。
  const overlayPush = ctx?.overlayPush
  const overlayPop = ctx?.overlayPop
  const isTopOverlayFn = ctx?.isTopOverlay

  const isTop = isTopOverlayFn ? isTopOverlayFn(token) : true

  const setOverlayRef = useCallback((node) => { overlayElRef.current = node }, [])

  // 打开/关闭生命周期：记录焦点、初始聚焦、关闭与卸载还原
  useEffect(() => {
    function restorePrev() {
      if (!restoreFocus) return
      const prev = prevFocusRef.current
      prevFocusRef.current = null
      if (prev && prev.isConnected !== false) safeFocus(prev, { preventScroll: true })
    }
    if (open) {
      wasOpenRef.current = true
      if (document.activeElement && document.activeElement !== document.body) {
        prevFocusRef.current = document.activeElement
      }
      const root = overlayElRef.current
      if (root && initialFocus !== 'none') {
        let target = null
        if (typeof initialFocus === 'string' && initialFocus) {
          target = root.querySelector(initialFocus)
        } else {
          // auto：输入类弹层优先首个输入框，否则首个可聚焦控件
          const inputs = Array.from(root.querySelectorAll('input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled])'))
          const visibleInput = inputs.find(n => n.getClientRects().length > 0)
          if (visibleInput) target = visibleInput
          else {
            const list = queryTabbables(root)
            target = list[0] || null
          }
        }
        if (target) safeFocus(target, { preventScroll: true })
      }
      return () => { if (wasOpenRef.current) restorePrev() }
    }
    if (wasOpenRef.current) {
      wasOpenRef.current = false
      restorePrev()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, restoreFocus])

  // 弹层栈登记（供注册中心屏蔽底层 app/page 键位 + 栈顶判定）
  useEffect(() => {
    if (!overlayPush || !overlayPop || !open) return
    overlayPush(token)
    return () => overlayPop(token)
  }, [overlayPush, overlayPop, token, open])

  // Esc + Tab 圈闭（window capture：先于页面内其他监听）
  useEffect(() => {
    if (!open || !trap) return
    const onKey = (e) => {
      if (isTopOverlayFn && !isTopOverlayFn(token)) return
      if (e.key === 'Escape') {
        if (e.isComposing || e.keyCode === 229) return
        if (escCloses) {
          e.preventDefault()
          e.stopPropagation()
          if (typeof onCloseRef.current === 'function') onCloseRef.current()
        }
        return
      }
      if (e.key === 'Tab') {
        // 圈闭开启时无条件拦截（Tab 不得逃出弹层进入页面/侧栏）
        e.preventDefault()
        e.stopPropagation()
        const root = overlayElRef.current
        if (root) handleTabInTrap(e, root)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, escCloses, trap, isTopOverlayFn, token])

  const overlayProps = {
    // data-overlay：标记"已接入 useOverlay 管理"（静态审计据此豁免计数）
    'data-overlay': '',
    ...(dialog ? { role: 'dialog', 'aria-modal': true, 'data-overlay-dialog': '' } : {}),
    ...(label ? { 'aria-label': label } : {}),
    ...(labelledBy ? { 'aria-labelledby': labelledBy } : {}),
  }

  return {
    overlayRef: setOverlayRef,
    overlayProps,
    isTop,
    close: useCallback(() => {
      if (typeof onCloseRef.current === 'function') onCloseRef.current()
    }, []),
  }
}

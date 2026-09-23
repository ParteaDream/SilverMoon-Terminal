// ═════════════════════════════════════════════════════════════════
// ShortcutContext.jsx — 全局键位注册中心（全键盘适配基建，规划 M0）
//
// 目标：取代散落的 window/document keydown 监听，提供：
//   - 统一键位匹配（keymap.matchesKeyEvent，语义与原 matchShortcut 一致）
//   - scope 感知：弹层（overlay 栈）打开时默认屏蔽 app/page 级键位，
//     system 级（scope:'system'）可穿透（如资源库 Ctrl+Tab、帮助 '?'）
//   - 输入豁免：焦点在 INPUT/TEXTAREA/SELECT/contentEditable 时默认不响应
//     （allowInInput:true 可放行，如修饰组合键类系统快捷键）
//   - IME 合成期豁免：isComposing / keyCode 229 默认不响应
//   - 注册冲突 dev 警告；帮助面数据（listActive）
//
// 使用：<ShortcutProvider> 包在最外层（main.jsx），组件内
//   const spec = { keys: ['ctrl+tab'], handler, scope, when, allowInInput }
//   useShortcut('dock.toggle-library', spec)   // spec 为 null/undefined 时不参与
// 同一 id 重复注册会先注销旧条目（最后一次注册生效）。
// ═════════════════════════════════════════════════════════════════
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { matchesKeyEvent, matchesCodeEvent, conflicts } from '../utils/keymap'

const Ctx = createContext(null)

export function ShortcutProvider({ children }) {
  const entriesRef = useRef(new Map()) // id -> () => spec（getter，读最新 spec）
  const orderRef = useRef([])          // 注册顺序（后注册者优先分发）
  const overlayStackRef = useRef([])   // 弹层 token 栈，栈顶为当前活动弹层
  const [rev, setRev] = useState(0)    // 仅用于 overlay 栈变更后触发重渲染

  const bump = useCallback(() => setRev(r => r + 1), [])

  const register = useCallback((id, getter) => {
    if (!id || typeof getter !== 'function') return
    const existed = entriesRef.current.has(id)
    entriesRef.current.set(id, getter)
    if (!existed) orderRef.current.push(id)
    // dev 冲突提示：与已注册的其他条目在任一平台形式相同
    const current = getter()
    if (current && current.keys && current.keys.length) {
      for (const otherId of orderRef.current) {
        if (otherId === id) continue
        const otherGetter = entriesRef.current.get(otherId)
        if (!otherGetter) continue
        const other = otherGetter()
        if (!other || !other.keys || !other.keys.length) continue
        const hit = current.keys.some(k1 => other.keys.some(k2 => conflicts(k1, k2)))
        if (hit && typeof console !== 'undefined') {
          console.warn('[Shortcuts] 键位冲突：', id, '↔', otherId, current.keys, other.keys)
        }
      }
    }
  }, [])

  const unregister = useCallback((id) => {
    if (!entriesRef.current.delete(id)) return
    const i = orderRef.current.indexOf(id)
    if (i >= 0) orderRef.current.splice(i, 1)
  }, [])

  const overlayPush = useCallback((token) => {
    overlayStackRef.current.push(token)
    bump()
  }, [bump])

  const overlayPop = useCallback((token) => {
    const arr = overlayStackRef.current
    const i = arr.lastIndexOf(token)
    if (i >= 0) { arr.splice(i, 1); bump() }
  }, [bump])

  const isTopOverlay = useCallback((token) => {
    const arr = overlayStackRef.current
    return arr.length > 0 && arr[arr.length - 1] === token
  }, [])

  // 全局唯一 keydown 监听
  useEffect(() => {
    const onKey = (e) => {
      if (e.defaultPrevented) return
      const composing = !!e.isComposing || e.keyCode === 229
      const target = e.target
      const typing = target && target.nodeType === 1 ? isTypingNode(target) : false
      const overlayActive = overlayStackRef.current.length > 0
      // 逆注册序分发：后注册（通常=上层）优先；handler preventDefault 视为消费
      for (let i = orderRef.current.length - 1; i >= 0; i--) {
        const id = orderRef.current[i]
        const getter = entriesRef.current.get(id)
        if (!getter) continue
        const spec = getter()
        if (!spec || !spec.keys || spec.keys.length === 0) continue
        const scope = spec.scope || 'app'
        if (overlayActive && (scope === 'app' || scope === 'page') && !spec.whenOverlay) continue
        if (composing && !spec.allowDuringComposition) continue
        if (typing && !spec.allowInInput) continue
        if (spec.when && !spec.when()) continue
        const hit = (spec.keys && spec.keys.some(k => matchesKeyEvent(e, k))) ||
          (spec.codes && spec.codes.length > 0 && matchesCodeEvent(e, spec.codes))
        if (!hit) continue
        try { spec.handler(e) } catch (err) {
          if (typeof console !== 'undefined') console.error('[Shortcuts] handler 异常', id, err)
        }
        if (e.defaultPrevented) break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const listActive = useCallback(() => {
    const out = []
    for (const id of orderRef.current) {
      const g = entriesRef.current.get(id)
      if (!g) continue
      const spec = g()
      if (spec && spec.keys && spec.keys.length) out.push({ id, spec })
    }
    return out
  }, [])

  const value = useMemo(() => ({
    register, unregister, overlayPush, overlayPop, isTopOverlay,
    overlayCount: overlayStackRef.current.length, listActive, rev,
  }), [register, unregister, overlayPush, overlayPop, isTopOverlay, listActive, rev])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

const NON_TYPING_INPUT_TYPES = new Set(['checkbox', 'radio', 'range', 'color', 'file', 'button', 'submit', 'reset', 'image'])
function isTypingNode(el) {
  const tag = String(el.tagName || '').toUpperCase()
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    if (el.disabled) return false
    if (tag === 'INPUT') {
      const t = String(el.type || 'text').toLowerCase()
      // 复选框/单选/滑块/取色器等是控件操作而非文字输入，允许快捷键与光标键接管
      if (NON_TYPING_INPUT_TYPES.has(t)) return false
    }
    return !el.readOnly
  }
  if (el.isContentEditable && !el.readOnly) return true
  return false
}

// ── 组件内注册 hook ──
// spec 每次渲染传入最新值（内部经 ref 读取，不重复注册/注销）。
// spec 为 null/undefined 时条目保留但被跳过（适合"暂未启用"场景）。
export function useShortcut(id, spec) {
  const ctx = useContext(Ctx)
  const ref = useRef(spec)
  ref.current = spec
  useEffect(() => {
    if (!ctx || !id) return
    ctx.register(id, () => ref.current)
    return () => ctx.unregister(id)
  }, [ctx, id])
}

export function useShortcutRegistry() {
  return useContext(Ctx)
}

export default Ctx

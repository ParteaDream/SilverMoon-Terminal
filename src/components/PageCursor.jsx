// ═════════════════════════════════════════════════════════════════
// PageCursor.jsx — 页面光标（整页 WASD/方向键空间导航 + 平滑焦点框）
//
// 规则（2025-09 用户反馈修订）：
//   1. 板块内未聚焦状态按 WASD/方向键 → 自动聚焦首图标（首个 [data-page-zone] 内首条目）
//   2. 参与移动元素 = main 内全部可见可交互控件 + 底部 Dock（按钮↔条目空间导航）
//   3. 移动平滑：焦点框 CSS 过渡 + 目标在视口外时 main 平滑滚动
//   4. 局部导航组件（桌面图标等）优先消费方向键；输入态/弹层/侧栏内不生效
//   5. 路由切换/弹层/焦点离开页面 → 立即隐藏焦点框（无幽灵残留）
// ═════════════════════════════════════════════════════════════════
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import { useShortcut, useShortcutRegistry } from '../context/ShortcutContext'
import { dirOfKey, pickNearest, isUsableRect } from '../utils/spatialNav'

const MOVE_KEYS = ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd']
const CURSOR_SEL = 'button:not([disabled]), a[href], [role="button"], [data-cursor-item], [data-item-id]'

function participantRoots() {
  const roots = []
  const main = document.querySelector('main')
  if (main) roots.push(main)
  const dock = document.querySelector('[data-dock-root]')
  if (dock && dock.getClientRects().length > 0) roots.push(dock)
  return roots
}

// 收集全部可交互参与者（可见、非输入、非豁免区）
function collectParticipants() {
  const seen = new Set()
  const out = []
  for (const root of participantRoots()) {
    for (const el of Array.from(root.querySelectorAll(CURSOR_SEL))) {
      if (seen.has(el)) continue
      seen.add(el)
      if (el.closest('[data-cursor-exempt]')) continue
      if (String(el.tagName || '').toUpperCase() === 'INPUT') continue
      const rect = el.getBoundingClientRect()
      if (!isUsableRect(rect)) continue
      out.push({ el, rect });
    }
  }
  return out
}

// 元素不可聚焦时补 tabindex=-1（<tr>/卡片 div 等默认不可 focus）
const NATURAL_FOCUS = /^(BUTTON|A|INPUT|SELECT|TEXTAREA)$/
function makeFocusable(el) {
  if (!el || el.nodeType !== 1) return
  const tag = String(el.tagName || '').toUpperCase()
  if (NATURAL_FOCUS.test(tag)) return
  // 无 tabindex 的容器（<tr>/卡片/行 div）统一补 -1，保证程序化聚焦
  if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1')
}

// 初始目标：页面自定 [data-cursor-default] > 首个 zone 内首条目 > 首个参与者
function initialTarget(participants) {
  for (const p of participants) {
    if (p.el.hasAttribute && p.el.hasAttribute('data-cursor-default')) return p
  }
  const main = document.querySelector('main')
  const zone = main && main.querySelector('[data-page-zone]')
  if (zone) {
    for (const p of participants) {
      if (zone.contains(p.el) && p.el.hasAttribute('data-cursor-item')) return p
    }
  }
  return participants[0] || null
}

// 车道分类：条目型（行/卡）与控件型（按钮/链接），垂直移动先沿同类车道
function kindOf(el) {
  if (!el || el.nodeType !== 1) return 'control'
  const tag = String(el.tagName || '').toUpperCase()
  if (tag === 'TR' || el.hasAttribute('data-item-id') || el.hasAttribute('data-cursor-item')) return 'item'
  return 'control'
}

function isRingable(el) {
  if (!el || el.nodeType !== 1) return false
  if (el.closest && el.closest('[data-cursor-exempt]')) return false
  if (!participantRoots().some(root => root && root.contains(el))) return false
  const tag = String(el.tagName || '').toUpperCase()
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return false
  if (el.isContentEditable) return false
  return isUsableRect(el.getBoundingClientRect())
}

export default function PageCursor() {
  const reg = useShortcutRegistry()
  const location = useLocation()
  const [ringOn, setRingOn] = useState(false)
  const [ringRect, setRingRect] = useState(null)
  const ringOnRef = useRef(false)
  const rafRef = useRef(0)

  useEffect(() => { ringOnRef.current = ringOn }, [ringOn])
  useEffect(() => {
    document.body.classList.toggle('cursor-ring-on', ringOn)
    return () => document.body.classList.remove('cursor-ring-on')
  }, [ringOn])

  const placeRing = (rect) => setRingRect(rect
    ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
    : null)
  const hideRing = () => { ringWasOnRef.current = false; if (ringOnRef.current) { setRingOn(false); placeRing(null) } }
  // 挂起：记住曾有焦点框并隐藏（供浮层关闭后恢复）；点击/普通隐藏清空记忆
  const ringWasOnRef = useRef(false)
  const suspendRing = () => { if (ringOnRef.current) { ringWasOnRef.current = true; setRingOn(false); placeRing(null) } }
  const ringFromActive = () => {
    const el = document.activeElement
    if (!isRingable(el)) return false
    placeRing(el.getBoundingClientRect())
    return true
  }

  // 平滑滚动使元素可见：滚动"最近的可滚动祖先"（main 或页内嵌套滚动区）
  const revealSmooth = (el) => {
    const r = el.getBoundingClientRect()
    const pad = 12
    // 找最近滚动容器（从 el 向上，到 document.body 为止）
    let scroller = null
    let n = el.parentElement
    while (n && n !== document.body && n !== document.documentElement) {
      const st = window.getComputedStyle(n)
      const scrollable = (st.overflowY === 'auto' || st.overflowY === 'scroll') && n.scrollHeight > n.clientHeight + 4
      if (scrollable) { scroller = n; break }
      n = n.parentElement
    }
    if (!scroller) return
    const sRect = scroller.getBoundingClientRect()
    if (r.top >= sRect.top + pad && r.bottom <= sRect.bottom - pad) return
    const delta = r.top < sRect.top + pad ? (r.top - sRect.top) - pad : (r.bottom - sRect.bottom) + pad
    scroller.scrollTo({ top: Math.max(0, scroller.scrollTop + delta), behavior: 'smooth' })
  }

  // 一次方向移动；返回是否消费
  const step = (key) => {
    const dir = dirOfKey(key)
    if (!dir) return false
    const participants = collectParticipants()
    if (participants.length === 0) return false
    const active = document.activeElement
    let source = null
    if (active && active.nodeType === 1 && !active.closest('aside')) {
      source = participants.find(p => p.el === active) || null
      // 焦点在非参与元素（如设置页单选卡/普通 div）上时：以该元素矩形为原点就近移动
      if (!source && isUsableRect(active.getBoundingClientRect()) && !active.closest('[data-cursor-exempt]')) {
        const originRect = active.getBoundingClientRect()
        const next = pickNearest(originRect, participants, dir)
        if (!next) return false
        makeFocusable(next.el)
        next.el.focus({ preventScroll: true })
        ringFromActive()
        revealSmooth(next.el)
        setRingOn(true)
        return true
      }
    }
    let target = null
    if (source) {
      const rest = participants.filter(p => p.el !== active)
      if (dir === 'up' || dir === 'down') {
        // 垂直：列带优先 —— 同列(横向重叠带) > 同类 > 全量，
        // 保证"字段→下一行同列字段、复选框→下一复选框、整行→下一整行"
        const sameKind = rest.filter(p => kindOf(p.el) === kindOf(source.el))
        const srcCx = (source.rect.left + source.rect.right) / 2
        const band = Math.max(90, source.rect.width / 2 + 24)
        const colMatch = (p) => {
          const cx = (p.rect.left + p.rect.right) / 2
          return Math.abs(cx - srcCx) <= band
        }
        const sameKindCol = sameKind.filter(colMatch)
        target = pickNearest(source.rect, sameKindCol, dir)
        if (!target) target = pickNearest(source.rect, sameKind, dir)
        if (!target) target = pickNearest(source.rect, rest.filter(colMatch), dir)
        if (!target) target = pickNearest(source.rect, rest, dir)
        // 纵向无路（如侧栏模块底部）：回绕到相邻列顶部（左→右/右→左）
        if (!target) {
          const rightCol = rest.filter(p => p.rect.left > source.rect.right - 24)
          const leftCol = rest.filter(p => p.rect.right < source.rect.left + 24)
          const col = (rightCol.length > 0 ? rightCol : leftCol)
          if (col.length > 0) {
            col.sort((a, b) => a.rect.top - b.rect.top)
            target = col[0]
          }
        }
      } else {
        target = pickNearest(source.rect, rest, dir)
      }
      if (!target) return false
    } else {
      target = initialTarget(participants)
      if (!target) return false
    }
    const el = target.el
    makeFocusable(el)
    el.focus({ preventScroll: true })
    ringFromActive()
    revealSmooth(el)
    setRingOn(true)
    return true
  }

  useShortcut('cursor.move', {
    keys: MOVE_KEYS,
    scope: 'app',
    when: () => {
      const el = document.activeElement
      if (!el || el.nodeType !== 1) return true
      if (el.closest && el.closest('aside')) return false
      return true
    },
    handler: (e) => { if (step(e.key)) e.preventDefault() },
  })

  // Enter：条目（div 角色按钮）激活（Shift+Enter 视为右键，见 cursor.context）
  useShortcut('cursor.activate', {
    keys: ['enter'],
    scope: 'app',
    when: () => {
      const el = document.activeElement
      if (!el || el.nodeType !== 1 || !el.hasAttribute) return false
      const tag = String(el.tagName || '').toUpperCase()
      if (tag === 'BUTTON' || tag === 'A' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return false
      return el.hasAttribute('data-cursor-item') || el.hasAttribute('data-item-id') || el.getAttribute('role') === 'button'
    },
    handler: (e) => {
      const el = document.activeElement;
      if (!el || typeof el.click !== 'function') return
      if (e.shiftKey) return // Shift+Enter → cursor.context
      e.preventDefault()
      // 激活后"挂起"焦点框（同路由详情隐藏；图片查看器等浮层关闭后恢复）
      suspendRing()
      el.click()
    },
  })

  // Shift+Enter = 当前项右键菜单（派发 contextmenu，坐标为元素中心；按钮/链接也适用）
  // 键位显式写 'shift+enter'：与 cursor.activate 的 'enter' 不构成冲突，
  // 且匹配语义一致（处理函数内仍保留 e.shiftKey 校验）。
  useShortcut('cursor.context', {
    keys: ['shift+enter'],
    scope: 'app',
    when: () => {
      const el = document.activeElement
      if (!el || el.nodeType !== 1) return false
      if (el.closest && el.closest('aside')) return false
      const tag = String(el.tagName || '').toUpperCase()
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return false
      if (el.isContentEditable) return false
      return true
    },
    handler: (e) => {
      if (!e.shiftKey) return
      const el = document.activeElement
      if (!el || el.nodeType !== 1) return
      e.preventDefault()
      const r = el.getBoundingClientRect()
      el.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true,
        clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 2,
      }))
    },
  })

  // 焦点跟踪 + 幽灵框防护（路由/弹层/焦点离开即隐藏）
  useEffect(() => {
    const onFocusIn = () => {
      if (ringOnRef.current) { if (!ringFromActive()) hideRing(); return }
      // 浮层关闭后焦点还原到原条目 → 恢复焦点框（图片查看器等场景）
      if (ringWasOnRef.current && isRingable(document.activeElement)) {
        ringWasOnRef.current = false
        setRingOn(true)
        ringFromActive()
      }
    }
    const onFocusOut = (e) => { if (ringOnRef.current && !e.relatedTarget) hideRing() }
    const onScrollFrame = () => {
      if (!ringOnRef.current) return
      cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(() => { if (ringOnRef.current) ringFromActive() })
    }
    const onPointerDown = () => { ringWasOnRef.current = false; if (ringOnRef.current) hideRing() }
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)
    window.addEventListener('scroll', onScrollFrame, true)
    window.addEventListener('resize', onScrollFrame)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', onFocusOut)
      window.removeEventListener('scroll', onScrollFrame, true)
      window.removeEventListener('resize', onScrollFrame)
      document.removeEventListener('pointerdown', onPointerDown)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 路由变化 → 隐藏（板块切换不残留）；弹层打开 → 挂起（关闭后还原）
  useEffect(() => { hideRing() }, [location])
  useEffect(() => {
    if (reg && reg.overlayCount > 0 && ringOnRef.current) suspendRing()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reg])

  if (!ringOn || !ringRect) return null
  return createPortal(
    <div
      className="page-cursor-ring"
      style={{
        left: 0, top: 0,
        width: ringRect.width,
        height: ringRect.height,
        transform: `translate3d(${ringRect.left}px, ${ringRect.top}px, 0)`,
      }}
      aria-hidden="true"
    />,
    document.body
  );
}
// ═════════════════════════════════════════════════════════════════
// useRovingFocus.js — 网格/列表 Roving tabindex（全键盘适配基建，规划 M0）
//
// 单 tabstop 容器；方向键移动"活动项"（真实焦点跟随移动，WAI-ARIA 推荐做法）。
// 容器 onKeyDown 处理：方向键/Home/End/PageUp/PageDown（移动）、
//   Enter（onActivate）、Space（onSelect）、Shift+F10 或菜单键（onOpenMenu）。
// 依赖 roving.js 纯函数 stepRovingIndex（node 可单测）。
// ═════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { stepRovingIndex } from '../utils/roving'

export default function useRovingFocus({
  count,
  columns = 0,      // >0 显式列数；0 = 自动测量（按首行元素实际布局）
  wrap = false,
  pageSize = 10,
  onActivate,      // (index) => void   Enter
  onSelect,        // (index) => void   Space
  onOpenMenu,      // (index) => void   Shift+F10 / ContextMenu 键
}) {
  const [activeIndex, setActiveIndex] = useState(-1)
  const nodeMapRef = useRef(new Map()) // index -> HTMLElement
  const activeIndexRef = useRef(-1)
  activeIndexRef.current = activeIndex
  const cfgRef = useRef({ count, columns, wrap, pageSize, onActivate, onSelect, onOpenMenu })
  cfgRef.current = { count, columns, wrap, pageSize, onActivate, onSelect, onOpenMenu }
  // measureColumns 需要 cfgRef，必须在 onContainerKeyDown 之前可用（hook 内顺序保证）

  const focusItem = useCallback((index) => {
    const node = nodeMapRef.current.get(index)
    if (node && typeof node.focus === 'function') {
      try { node.focus({ preventScroll: true }) } catch (_) { node.focus() }
    }
    setActiveIndex(index)
  }, [])

  // 活动索引变化后滚动到可视区
  useEffect(() => {
    const node = nodeMapRef.current.get(activeIndex)
    if (node && typeof node.scrollIntoView === 'function') {
      node.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
  }, [activeIndex])

  const moveTo = useCallback((next) => {
    if (next == null) return
    focusItem(next)
  }, [focusItem])

  // 自动测量首行列数：比较第 0 项与后续项的 offsetTop（容差内同行为一列）
  const measureColumns = useCallback(() => {
    const cfg = cfgRef.current
    if (cfg.columns && cfg.columns > 0) return cfg.columns
    if (cfg.count <= 0) return 1
    const first = nodeMapRef.current.get(0)
    if (!first) return 1
    const top = first.offsetTop
    let n = 1
    while (n < cfg.count && n < 80) {
      const el = nodeMapRef.current.get(n)
      if (!el) break
      if (Math.abs(el.offsetTop - top) > 2) break
      n++
    }
    return Math.max(1, n)
  }, [])

  const onContainerKeyDown = useCallback((e) => {
    const cfg = cfgRef.current
    const countN = cfg.count
    if (!countN || countN <= 0) return
    const idx = activeIndexRef.current

    if (e.key === 'Enter') {
      if (idx >= 0 && cfg.onActivate) { e.preventDefault(); cfg.onActivate(idx) }
      return
    }
    if (e.key === ' ' || e.key === 'Spacebar') {
      if (idx >= 0 && cfg.onSelect) { e.preventDefault(); cfg.onSelect(idx) }
      return
    }
    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      if (idx >= 0 && cfg.onOpenMenu) { e.preventDefault(); cfg.onOpenMenu(idx) }
      return
    }

    const isPrev = e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'PageUp' || e.key === 'Home'
    if (idx < 0) {
      // 首次进入：按方向语义落到首/尾，且不参与步进计算
      const target = isPrev ? countN - 1 : 0
      e.preventDefault()
      focusItem(target)
      return
    }
    const next = stepRovingIndex({
      index: idx, count: countN, key: e.key,
      columns: cfg.columns && cfg.columns > 0 ? cfg.columns : measureColumns(),
      wrap: cfg.wrap, pageSize: cfg.pageSize,
    })
    if (next == null) return // 非移动键（Esc 等交由上层）
    e.preventDefault()
    if (next !== idx) moveTo(next)
  }, [focusItem, moveTo])

  // 每项属性：只有活动项 tabIndex=0（Tab 可到达），其余 -1
  const itemProps = useCallback((index) => ({
    ref: (node) => {
      if (node) nodeMapRef.current.set(index, node)
      else nodeMapRef.current.delete(index)
    },
    tabIndex: index === activeIndexRef.current ? 0 : -1,
  }), [])

  // 数据长度变化：越界回退 / 清空
  useEffect(() => {
    const cfg = cfgRef.current
    if (!cfg.count || cfg.count <= 0) { setActiveIndex(-1); return }
    setActiveIndex(prev => (prev >= cfg.count ? cfg.count - 1 : prev))
  }, [count])

  const containerProps = {
    tabIndex: count > 0 && activeIndex < 0 ? 0 : -1,
    onKeyDown: onContainerKeyDown,
    onFocus: (e) => {
      if (e.target === e.currentTarget && activeIndexRef.current < 0 && cfgRef.current.count > 0) {
        focusItem(0)
      }
    },
  }

  return useMemo(() => ({
    activeIndex,
    setActive: moveTo,
    focusFirst: () => focusItem(0),
    focusLast: () => focusItem(Math.max(0, cfgRef.current.count - 1)),
    onContainerKeyDown,
    containerProps: {
      ...containerProps,
      tabIndex: count > 0 && activeIndex < 0 ? 0 : -1,
    },
    itemProps,
  }), [activeIndex, focusItem, moveTo, onContainerKeyDown, itemProps, count])
}
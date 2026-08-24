import { useState, useEffect, useRef } from 'react'
import { useDb } from '../context/DbContext'

// ── 全局懒加载版本号 ──
let _globalRevision = 0
const _revisionListeners = new Set()

export function bumpLazyRevision() {
  _globalRevision++
  for (const fn of _revisionListeners) fn(_globalRevision)
}

// ── MutationObserver（DOM 重排时 bump revision）──
// 窗口缩放期间抑制 revision 更新，避免海量懒加载实例同时重评估
let _observerStarted = false
let _observerTimer = null
let _resizing = false
let _resizeTimer = null

function startMutationObserver() {
  if (_observerStarted) return
  _observerStarted = true
  const main = document.querySelector('main')
  if (!main) { setTimeout(startMutationObserver, 500); return }

  // 窗口缩放检测：缩放期间抑制 MutationObserver 的 revision bump
  window.addEventListener('resize', () => {
    _resizing = true
    clearTimeout(_resizeTimer)
    _resizeTimer = setTimeout(() => {
      _resizing = false
      // 缩放结束后统一 bump 一次
      _globalRevision++
      for (const fn of _revisionListeners) fn(_globalRevision)
    }, 250)
  })

  const observer = new MutationObserver(() => {
    if (_resizing) return  // 缩放期间跳过
    if (_observerTimer) clearTimeout(_observerTimer)
    _observerTimer = setTimeout(() => {
      _globalRevision++
      for (const fn of _revisionListeners) fn(_globalRevision)
      _observerTimer = null
    }, 300)
  })
  observer.observe(main, { childList: true, subtree: true })
}

let _globalStarted = false

function ensureGlobalStarted() {
  if (_globalStarted) return
  _globalStarted = true
  startMutationObserver()
}

// ── 预加载缓冲带：可视区外 800px 内的图片提前加载 ──
// 此前为 3000px，几乎覆盖整页（材料页 526 张在挂载时全量触发），
// 改为 800px 后仅预加载视口附近图片；快速滚动由下方同步回退兜底，不闪白。
const PRELOAD_MARGIN = 800

// ── 共享 IntersectionObserver（异步预加载）──
let _globalObserver = null
const _elementLoaders = new Map()   // Element → () => void

function getSharedObserver() {
  if (!_globalObserver) {
    _globalObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const loader = _elementLoaders.get(entry.target)
        if (loader) {
          _globalObserver.unobserve(entry.target)
          _elementLoaders.delete(entry.target)
          _pendingElements.delete(entry.target)
          loader()
        }
      }
    }, { rootMargin: `${PRELOAD_MARGIN}px` })
  }
  return _globalObserver
}

// ── 同步滚动回退（单 rAF-throttled listener，确保快速滚动不丢帧）──
// 每帧最多处理 SCROLL_BATCH 个元素，避免对数百个 pending 元素逐个
// getBoundingClientRect() 造成每帧强制布局（此前 500+ 次布局/帧导致滚动卡顿）。
const _pendingElements = new Map()  // Element → () => void
const SCROLL_BATCH = 40
let _scrollCheckActive = false
let _scrollTicking = false

function ensureScrollCheck() {
  if (_scrollCheckActive) return
  _scrollCheckActive = true
  const main = document.querySelector('main')
  const target = main || window
  target.addEventListener('scroll', () => {
    if (_scrollTicking) return
    _scrollTicking = true
    requestAnimationFrame(() => {
      _scrollTicking = false
      const margin = PRELOAD_MARGIN
      const ih = window.innerHeight
      let checked = 0
      for (const [el, loader] of _pendingElements) {
        if (checked >= SCROLL_BATCH) break
        checked++
        try {
          const rect = el.getBoundingClientRect()
          if (rect.bottom > -margin && rect.top < ih + margin) {
            _pendingElements.delete(el)
            _elementLoaders.delete(el)
            if (_globalObserver) _globalObserver.unobserve(el)
            loader()
          }
        } catch (_) {
          // 元素可能已从 DOM 移除
          _pendingElements.delete(el)
        }
      }
    })
  }, { passive: true })
}

/**
 * 懒加载图片 — IntersectionObserver + 同步滚动回退混合方案
 * - Observer 在空闲时检测，管理所有实例
 * - 单 rAF-throttled scroll listener 作为同步回退（每帧分批检查），确保快速滚动不丢帧
 * - PRELOAD_MARGIN 800px 提供充足预加载缓冲
 *
 * @param {string} filename 图片文件名
 * @param {number|string} maxWidth 可选的目标显示宽度提示（如 100 / '100px'）。
 *        传给 readImage 生成/直读对应尺寸的图片，减小 IPC 载荷；不传则返回原图
 */
export function useLazyImage(filename, maxWidth) {
  const [src, setSrc] = useState(null)
  const { readImage } = useDb()
  const ref = useRef(null)
  const loaded = useRef(false)
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    _revisionListeners.add(setRevision)
    ensureGlobalStarted()
    ensureScrollCheck()
    return () => { _revisionListeners.delete(setRevision) }
  }, [])

  const prevFilenameRef = useRef(null)

  useEffect(() => {
    if (!filename) return
    const el = ref.current
    if (!el) return

    // 仅 filename 变化时重置
    if (filename !== prevFilenameRef.current) {
      prevFilenameRef.current = filename
      loaded.current = false
      setSrc(null)
    }

    // 归一化尺寸提示：300 → 300；'100px' → 100；undefined → 原图
    const sizeHint = typeof maxWidth === 'number'
      ? (maxWidth > 0 ? Math.round(maxWidth) : undefined)
      : (parseInt(maxWidth || '', 10) > 0 ? parseInt(maxWidth, 10) : undefined)

    function doLoad() {
      if (loaded.current) return
      loaded.current = true
      const current = filename
      readImage(current, sizeHint).then(data => {
        if (data && current === filename) setSrc(data)
      })
    }

    if (loaded.current) return

    // 同步检查：元素已在视口或预加载范围内 → 立即加载
    const margin = PRELOAD_MARGIN
    try {
      const rect = el.getBoundingClientRect()
      if (rect.bottom > -margin && rect.top < window.innerHeight + margin) {
        doLoad()
        return
      }
    } catch (_) {}

    // 注册到 IntersectionObserver + 同步回退集合
    const observer = getSharedObserver()
    _elementLoaders.set(el, doLoad)
    _pendingElements.set(el, doLoad)
    observer.observe(el)

    return () => {
      _elementLoaders.delete(el)
      _pendingElements.delete(el)
      observer.unobserve(el)
    }
  }, [filename, readImage, revision])

  return { ref, src }
}

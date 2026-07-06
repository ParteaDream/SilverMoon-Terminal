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
let _observerStarted = false
let _observerTimer = null

function startMutationObserver() {
  if (_observerStarted) return
  _observerStarted = true
  const main = document.querySelector('main')
  if (!main) { setTimeout(startMutationObserver, 500); return }
  const observer = new MutationObserver(() => {
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
    }, { rootMargin: '3000px' })
  }
  return _globalObserver
}

// ── 同步滚动回退（单 rAF-throttled listener，确保快速滚动不丢帧）──
const _pendingElements = new Map()  // Element → () => void
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
      const margin = 3000
      const ih = window.innerHeight
      for (const [el, loader] of _pendingElements) {
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
 * - 单 rAF-throttled scroll listener 作为同步回退，确保快速滚动不丢帧
 * - rootMargin 800px 提供充足预加载缓冲
 *
 * @param {string} filename 图片文件名
 * @param {number|string} _rootMargin 兼容旧参数，现由全局统一管理
 */
export function useLazyImage(filename, _rootMargin) {
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

    function doLoad() {
      if (loaded.current) return
      loaded.current = true
      const current = filename
      readImage(current).then(data => {
        if (data && current === filename) setSrc(data)
      })
    }

    if (loaded.current) return

    // 同步检查：元素已在视口或预加载范围内 → 立即加载
    const margin = Math.max(3000, typeof _rootMargin === 'number' ? _rootMargin : parseInt(_rootMargin || '3000') || 3000)
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

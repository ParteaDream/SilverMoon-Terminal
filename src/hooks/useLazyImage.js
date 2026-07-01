import { useState, useEffect, useRef } from 'react'
import { useDb } from '../context/DbContext'

// ── 全局懒加载版本号：排序/筛选变化时 bump，触发所有 useLazyImage 重新检查视口 ──
let _globalRevision = 0
const _revisionListeners = new Set()

/** 通知所有活动的 useLazyImage 重新检查视口 */
export function bumpLazyRevision() {
  _globalRevision++
  for (const fn of _revisionListeners) fn(_globalRevision)
}

// ── 共享 MutationObserver：监听 main 内子节点变化（排序/筛选导致 DOM 重排）──
//    防抖 300ms，避免频繁微小变更触发大量重检查
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

/** 启动全局懒加载增强，在第一个 useLazyImage 挂载时自动调用 */
function ensureGlobalStarted() {
  if (_globalStarted) return
  _globalStarted = true
  startMutationObserver()
}

/**
 * 懒加载图片 — 元素有任何部分进入视口即加载
 * 使用 scroll 事件检测（避免 Electron 中 IntersectionObserver 不可靠）
 *
 * @param {string} filename 图片文件名
 * @param {number|string} rootMargin 视口检测外扩像素
 */
export function useLazyImage(filename, rootMargin = 100) {
  const [src, setSrc] = useState(null)
  const { readImage } = useDb()
  const ref = useRef(null)
  const loaded = useRef(false)
  const [revision, setRevision] = useState(0)

  // 订阅全局懒加载版本号，首次挂载时启动 MutationObserver
  useEffect(() => {
    _revisionListeners.add(setRevision)
    ensureGlobalStarted()
    return () => { _revisionListeners.delete(setRevision) }
  }, [])

  // 跟踪上一个 filename，区分「文件名变化」和「仅 revision 变化」
  const prevFilenameRef = useRef(null)

  useEffect(() => {
    if (!filename) return
    const el = ref.current
    if (!el) return

    const margin = typeof rootMargin === 'number' ? rootMargin : parseInt(rootMargin) || 100

    // 仅当 filename 真正变化时才重置加载状态；仅 revision 变化时不重置（避免闪图）
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

    function isInView() {
      const rect = el.getBoundingClientRect()
      return rect.bottom > -margin && rect.top < window.innerHeight + margin
    }

    // Already visible → load immediately
    if (isInView()) {
      doLoad()
      return
    }

    // Listen to scroll on main element
    const main = document.querySelector('main')
    const scrollTarget = main || window

    function onScroll() {
      if (isInView()) {
        if (scrollTarget === window) {
          window.removeEventListener('scroll', onScroll)
        } else {
          main.removeEventListener('scroll', onScroll)
        }
        doLoad()
      }
    }

    scrollTarget.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      if (scrollTarget === window) {
        window.removeEventListener('scroll', onScroll)
      } else if (main) {
        main.removeEventListener('scroll', onScroll)
      }
    }
  }, [filename, readImage, rootMargin, revision])

  return { ref, src }
}

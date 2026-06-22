import { useState, useEffect, useRef } from 'react'
import { useDb } from '../context/DbContext'

/**
 * 懒加载图片 — 元素有任何部分进入视口即加载
 * 使用 scroll 事件检测（避免 Electron 中 IntersectionObserver 不可靠）
 */
export function useLazyImage(filename, rootMargin = 100) {
  const [src, setSrc] = useState(null)
  const { readImage } = useDb()
  const ref = useRef(null)
  const loaded = useRef(false)

  useEffect(() => {
    if (!filename) return
    loaded.current = false
    setSrc(null)

    const el = ref.current
    if (!el) return

    const margin = typeof rootMargin === 'number' ? rootMargin : parseInt(rootMargin) || 100

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
  }, [filename, readImage, rootMargin])

  return { ref, src }
}

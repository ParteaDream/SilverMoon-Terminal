import { useState, useEffect, useRef } from 'react'
import { useDb } from '../context/DbContext'

/**
 * 懒加载图片 — 仅当元素进入视口时才发起 readImage IPC
 * 大幅减少画廊/卡池图模式下的并发图片加载
 */
export function useLazyImage(filename, rootMargin = '200px') {
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

    function doLoad() {
      if (loaded.current) return
      loaded.current = true
      const current = filename
      readImage(current).then(data => {
        if (data && current === filename) setSrc(data)
      })
    }

    // Already in viewport? Load immediately
    const rect = el.getBoundingClientRect()
    const margin = parseInt(rootMargin) || 200
    if (rect.top < window.innerHeight + margin && rect.bottom > -margin) {
      doLoad()
      return
    }

    // Otherwise wait for intersection
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          observer.disconnect()
          doLoad()
        }
      },
      { rootMargin }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [filename, readImage, rootMargin])

  return { ref, src }
}

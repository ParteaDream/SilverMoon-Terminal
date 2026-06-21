import { createContext, useContext, useRef, useEffect, useLayoutEffect, useState, useMemo, useCallback } from 'react'
import { savePageState, loadPageState, loadPageStateSync } from '../utils/pageStateStore'

const PageMemoryContext = createContext(null)

export function usePageMemory() {
  const ctx = useContext(PageMemoryContext)
  if (!ctx) throw new Error('usePageMemory must be used within PageMemoryProvider')
  return ctx
}

/**
 * PageMemoryProvider — 为详情页提供基于 user.json 的状态持久化
 *
 * 用法：包裹详情页根组件
 * <PageMemoryProvider pageKey={`character_${id}`}>
 *   <CharacterDetailPage />
 * </PageMemoryProvider>
 *
 * 自动行为：
 * - 挂载时从 user.json 加载保存的状态和滚动位置
 * - 卸载时（useLayoutEffect cleanup，DOM 替换前）保存当前滚动+状态
 * - 最多保留 5 个页面，旧的自动淘汰
 */
export function PageMemoryProvider({ pageKey, children }) {
  const stateRef = useRef({})       // 当前页面的所有状态字段
  const scrollRef = useRef(0)       // 上次已知的滚动位置
  const [ready, setReady] = useState(false)

  // 挂载时：加载已保存的状态（优先同步读取，避免延迟）
  useEffect(() => {
    let cancelled = false
    
    // 先尝试同步读取（缓存已预加载，几乎瞬间返回）
    let saved = loadPageStateSync(pageKey)
    if (saved) {
      stateRef.current = saved.state || {}
      scrollRef.current = saved.scrollY || 0
      setReady(true)
      return
    }
    
    // 缓存未命中时异步加载
    loadPageState(pageKey).then(saved => {
      if (cancelled) return
      if (saved) {
        stateRef.current = saved.state || {}
        scrollRef.current = saved.scrollY || 0
      }
      setReady(true)
    }).catch(() => {
      if (!cancelled) setReady(true)
    })
    return () => { cancelled = true }
  }, [pageKey])

  // 卸载时：保存当前状态（useLayoutEffect 在 DOM 替换前执行）
  useLayoutEffect(() => {
    return () => {
      const main = document.querySelector('main')
      const scrollY = main ? main.scrollTop : scrollRef.current
      // 如果 scrollY 为 0，使用 ref 中记录的最后已知位置
      const finalScrollY = scrollY > 0 ? scrollY : scrollRef.current
      // 异步保存（fire-and-forget）
      savePageState(pageKey, finalScrollY, stateRef.current)
    }
  }, [pageKey])

  // 注册状态字段（由 useDetailState 调用）
  const registerState = useCallback((key, value) => {
    stateRef.current[key] = value
  }, [])

  // 获取已保存的状态值
  const getSaved = useCallback((key, defaultValue) => {
    if (key in stateRef.current) return stateRef.current[key]
    return typeof defaultValue === 'function' ? defaultValue() : defaultValue
  }, [])

  const ctx = useMemo(() => ({
    pageKey,
    getSaved,
    registerState,
    savedScroll: scrollRef.current,
    ready,
  }), [pageKey, getSaved, registerState, ready])

  return (
    <PageMemoryContext.Provider value={ctx}>
      {children}
    </PageMemoryContext.Provider>
  )
}

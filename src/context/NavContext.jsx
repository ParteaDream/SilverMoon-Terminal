import { createContext, useContext, useState, useCallback, useEffect, useRef, useReducer } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { savePageStateSync, loadPageState, loadPageStateSync, preloadPageStates } from '../utils/pageStateStore'

const NavContext = createContext(null)

export function useNav() {
  const ctx = useContext(NavContext)
  if (!ctx) throw new Error('useNav must be used within NavProvider')
  return ctx
}

// ── Reducer: atomic stack + cursor updates ──
const initialState = { stack: [], cursor: -1 }

function navReducer(state, action) {
  switch (action.type) {
    case 'INIT': {
      // Initialize with the first real page
      if (state.stack.length === 0) {
        return { stack: [{ pathname: action.pathname, search: action.search }], cursor: 0 }
      }
      return state
    }

    case 'PUSH': {
      // Add new entry after cursor, truncate any forward entries
      const newStack = state.stack.slice(0, state.cursor + 1)
      const entry = { pathname: action.pathname, search: action.search }
      // Don't push duplicate of the current entry
      if (newStack.length > 0) {
        const last = newStack[newStack.length - 1]
        if (last.pathname === entry.pathname && last.search === entry.search) {
          return state
        }
      }
      newStack.push(entry)
      // Cap stack size
      if (newStack.length > 50) newStack.shift()
      return { stack: newStack, cursor: newStack.length - 1 }
    }

    case 'POP': {
      // Browser pop / goBack / goForward: find existing entry and move cursor
      const idx = state.stack.findIndex(
        e => e.pathname === action.pathname && e.search === action.search
      )
      if (idx >= 0) {
        return { ...state, cursor: idx }
      }
      // Entry not in stack (shouldn't happen normally) — push it
      const newStack = state.stack.slice(0, state.cursor + 1)
      newStack.push({ pathname: action.pathname, search: action.search })
      if (newStack.length > 50) newStack.shift()
      return { stack: newStack, cursor: newStack.length - 1 }
    }

    case 'SET_CURSOR': {
      if (action.index >= 0 && action.index < state.stack.length) {
        return { ...state, cursor: action.index }
      }
      return state
    }

    case 'BACK_TO_LIST': {
      // Truncate stack to the list page (removing detail page)
      const listIdx = state.stack.findIndex(e => e.pathname === action.listPath)
      if (listIdx >= 0) {
        return { stack: state.stack.slice(0, listIdx + 1), cursor: listIdx }
      }
      // List not in stack: just stay at current position
      return state
    }

    default:
      return state
  }
}

export function NavProvider({ children }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [state, dispatch] = useReducer(navReducer, initialState)
  const { stack, cursor } = state

  // Ref to prevent the location-change effect from double-handling our own navigations
  const navigatingRef = useRef(false)
  // Ref to track the latest cursor for use in callbacks
  const cursorRef = useRef(cursor)
  cursorRef.current = cursor
  const stackRef = useRef(stack)
  stackRef.current = stack

  // Preload page state cache so restorePage is synchronous
  useEffect(() => {
    preloadPageStates()
  }, [])

  // ── Track location changes ──
  useEffect(() => {
    // Skip the root redirect
    if (location.pathname === '/' && location.search === '') {
      dispatch({ type: 'INIT', pathname: '/characters', search: '' })
      return
    }

    // If we initiated this navigation, skip — the reducer already handled it
    if (navigatingRef.current) {
      navigatingRef.current = false
      return
    }

    // This is an external navigation (browser back/forward, sidebar click, etc.)
    // Check if the entry exists in our stack (browser pop)
    const idx = stackRef.current.findIndex(
      e => e.pathname === location.pathname && e.search === location.search
    )
    if (idx >= 0) {
      // It's a pop — just move cursor
      dispatch({ type: 'POP', pathname: location.pathname, search: location.search })
    } else {
      // New external navigation — push to stack
      dispatch({ type: 'PUSH', pathname: location.pathname, search: location.search })
    }
  }, [location.pathname, location.search])

  // ── Derived state ──
  const canGoBack = cursor > 0
  const canGoForward = cursor < stack.length - 1

  // ── Navigation actions ──

  /** Push a new page onto the stack (e.g., list → detail) */
  const push = useCallback((path, search = '') => {
    navigatingRef.current = true
    dispatch({ type: 'PUSH', pathname: path, search })
    navigate(path + search, { replace: true })
  }, [navigate])

  /** Go back one step in the stack (上一步) */
  const goBack = useCallback(() => {
    const cur = cursorRef.current
    if (cur <= 0) return
    const target = stackRef.current[cur - 1]
    if (!target) return
    navigatingRef.current = true
    sessionStorage.setItem('_nav_backToList', '1')
    dispatch({ type: 'SET_CURSOR', index: cur - 1 })
    navigate(target.pathname + target.search, { replace: true })
  }, [navigate])

  /** Go forward one step in the stack (下一步) */
  const goForward = useCallback(() => {
    const cur = cursorRef.current
    if (cur >= stackRef.current.length - 1) return
    const target = stackRef.current[cur + 1]
    if (!target) return
    navigatingRef.current = true
    sessionStorage.setItem('_nav_backToList', '1')
    dispatch({ type: 'SET_CURSOR', index: cur + 1 })
    navigate(target.pathname + target.search, { replace: true })
  }, [navigate])

  /** Check if the previous page in the stack is the given path */
  const canGoBackTo = useCallback((pathname) => {
    return cursor > 0 && stack[cursor - 1]?.pathname === pathname
  }, [cursor, stack])

  // ── 返回列表：保存详情页状态，返回列表（不截断导航栈，保留上一步能力）──
  const backToList = useCallback((listPath, scrollToItemId) => {
    // Mark this navigation as "返回列表" so detail page hooks save their state
    sessionStorage.setItem('_nav_backToList', '1')

    const cur = cursorRef.current
    // 在栈中找到列表页位置，将游标移到那里（类似 goBack 但设置了保存标记）
    const listIdx = stackRef.current.findIndex(e => e.pathname === listPath)
    if (listIdx >= 0 && listIdx < cur) {
      if (scrollToItemId != null) {
        sessionStorage.setItem('_nav_scroll_to_id', String(scrollToItemId))
      }
      navigatingRef.current = true
      dispatch({ type: 'SET_CURSOR', index: listIdx })
      navigate(listPath, { replace: true })
    } else {
      // 列表页不在栈中：直接导航
      if (scrollToItemId != null) {
        sessionStorage.setItem('_nav_scroll_to_id', String(scrollToItemId))
      }
      navigatingRef.current = true
      navigate(listPath, { replace: true })
    }
  }, [navigate])

  // ── 检测并消费"返回列表"标记 ──
  const consumeBackToList = useCallback(() => {
    const flag = sessionStorage.getItem('_nav_backToList')
    if (flag) {
      sessionStorage.removeItem('_nav_backToList')
      return true
    }
    return false
  }, [])

  const isBackToList = useCallback(() => {
    return sessionStorage.getItem('_nav_backToList') === '1'
  }, [])

  // ── Scroll / page state persistence (for list pages, backed by user.json) ──
  const getScrollY = useCallback(() => {
    const main = document.querySelector('main')
    return main ? main.scrollTop : window.scrollY
  }, [])

  /** Save list page state (instant cache update + async file write) */
  const savePage = useCallback((pageKey, state = {}) => {
    const scrollY = getScrollY()
    savePageStateSync(pageKey, scrollY, state)
  }, [getScrollY])

  /** 
   * Restore list page state. Uses sync cache read for instant response.
   */
  const restorePage = useCallback(async (pageKey) => {
    try {
      let saved = loadPageStateSync(pageKey)
      if (!saved) {
        saved = await loadPageState(pageKey)
      }
      if (saved) {
        return { scrollY: saved.scrollY, viewMode: saved.state?.viewMode, ...saved.state }
      }
    } catch (_) {}
    return null
  }, [])

  /** Save scroll position for a list page */
  const saveScroll = useCallback((pageKey) => savePage(pageKey), [savePage])

  /** Restore scroll position for a list page */
  const restoreScroll = useCallback((pageKey) => {
    const state = restorePage(pageKey)
    if (state?.scrollY != null) {
      requestAnimationFrame(() => scrollTo(state.scrollY))
    }
    return state
  }, [restorePage, scrollTo])

  return (
    <NavContext.Provider value={{
      canGoBack, canGoForward, goBack, goForward,
      canGoBackTo,
      saveScroll, restoreScroll, savePage, restorePage,
      backToList, consumeBackToList, isBackToList,
      push,
      // Expose for debugging
      stack, cursor,
    }}>
      {children}
    </NavContext.Provider>
  )
}

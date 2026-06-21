import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { usePageMemory } from '../context/PageMemoryContext'

// ── 为列表页保留的清除函数（向后兼容，现在操作 user.json）──
export function clearDetailState(key, id) {
  // 不再需要 — 新系统自动管理，保留空函数以防导入报错
}

export function clearDetailScroll(prefix, id) {
  // 不再需要 — 新系统自动管理，保留空函数以防导入报错
}

/**
 * useDetailScroll(prefix, id) — 详情页滚动恢复
 * 恢复逻辑：从 PageMemoryContext 获取上次保存的 scrollY 并恢复
 * 保存逻辑：由 PageMemoryProvider 的 useLayoutEffect cleanup 自动处理
 */
export function useDetailScroll(prefix, id) {
  const ctx = usePageMemory()

  // ready 后恢复滚动
  useEffect(() => {
    if (!ctx.ready) return
    const targetY = ctx.savedScroll
    if (targetY > 0) {
      const tryScroll = (attempt) => {
        const main = document.querySelector('main')
        if (!main) return
        main.scrollTo(0, targetY)
        if (attempt > 0 && main.scrollTop === 0) {
          setTimeout(() => tryScroll(attempt - 1), 100)
        }
      }
      setTimeout(() => tryScroll(5), 50)
    }
  }, [ctx.ready, ctx.savedScroll])
}

/**
 * useDetailState(key, defaultValue) — 详情页状态持久化
 * 恢复逻辑：从 PageMemoryContext 获取已保存的值
 * 保存逻辑：每次 value 变化时通过 ctx.registerState 注册，Provider 卸载时统一保存
 */
export default function useDetailState(key, defaultValue) {
  const ctx = usePageMemory()

  const [value, setValue] = useState(() => {
    return ctx.getSaved(key, defaultValue)
  })

  // 每次 value 变化时注册到 Provider（用于卸载时保存）
  useEffect(() => {
    ctx.registerState(key, value)
  }, [key, value, ctx.registerState])

  return [value, setValue]
}

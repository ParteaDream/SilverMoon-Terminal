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
 * 恢复逻辑：把保存的滚动快照（像素位置 + 内容锚点）交给 scrollMemory 校正到收敛
 * 保存逻辑：由 PageMemoryProvider 持续采集并在卸载时落盘
 */
export function useDetailScroll(prefix, id) {
  const ctx = usePageMemory()
  const restoreScroll = ctx.restoreScroll

  useEffect(() => {
    if (!ctx.ready || ctx.savedScroll <= 0) return undefined
    let cancelled = false
    restoreScroll({ isCancelled: () => cancelled })
    return () => { cancelled = true }
  }, [ctx.ready, ctx.savedScroll, restoreScroll])
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

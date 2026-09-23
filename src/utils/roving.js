// ═════════════════════════════════════════════════════════════════
// roving.js — Roving tabindex 纯数学部分（node 可单测）
// useRovingFocus 的索引步进逻辑独立于此，便于测试与复用。
// ═════════════════════════════════════════════════════════════════

// WASD 与方向键双轨：w/a/s/d 分别等同 ↑/←/↓/→（仅用于选区组件内部导航）
export function normalizeDirectionKey(key) {
  const k = String(key).toLowerCase()
  if (k === 'w') return 'ArrowUp'
  if (k === 's') return 'ArrowDown'
  if (k === 'a') return 'ArrowLeft'
  if (k === 'd') return 'ArrowRight'
  return key
}

// 计算方向键移动后的目标索引。返回 null 表示当前键不参与 roving 移动
// （如 Enter 等动作键由 hook 另行处理）。
// 参数：index 当前活动索引；count 项数；key 事件键名；
//      columns 每行列数（列表=1）；wrap 是否首尾环绕；
//      pageSize PageUp/PageDown 步长（默认 10）。
export function stepRovingIndex({ index, count, key, columns = 1, wrap = false, pageSize = 10 }) {
  if (!count || count <= 0 || index == null) return null
  if (index < 0 || index >= count) index = index < 0 ? 0 : count - 1
  key = normalizeDirectionKey(key)
  const cols = Math.max(1, Math.floor(columns) || 1)
  const step = Math.max(1, Math.floor(pageSize) || 1)
  let next = index
  switch (key) {
    case 'ArrowLeft':
      next = wrap ? (index - 1 + count) % count : (index > 0 ? index - 1 : index)
      break
    case 'ArrowRight':
      next = wrap ? (index + 1) % count : (index < count - 1 ? index + 1 : index)
      break
    case 'ArrowUp':
      next = index - cols
      next = wrap ? (next < 0 ? Math.max(count - cols + (index % cols), 0) : next) : Math.max(0, next)
      break
    case 'ArrowDown':
      next = index + cols
      next = wrap ? (next >= count ? (index % cols) : next) : Math.min(count - 1, next)
      break
    case 'Home':
      return 0
    case 'End':
      return count - 1
    case 'PageUp':
      next = Math.max(0, index - step)
      break
    case 'PageDown':
      next = Math.min(count - 1, index + step)
      break
    default:
      return null
  }
  return next
}
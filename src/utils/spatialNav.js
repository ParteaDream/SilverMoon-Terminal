// ═════════════════════════════════════════════════════════════════
// spatialNav.js — 页面光标空间导航（纯几何，node 可单测）
// WASD/方向键在 功能按钮 + 条目 的整页可交互元素间移动；
// 方向判定：候选中心须位于移动半平面，主轴向距离 + 交叉轴距离加权，
// 同轴重叠时给予优势（保证同一行/列内优先）。
// ═════════════════════════════════════════════════════════════════

// 按键 → 方向
export const DIRECTION_KEYS = {
  arrowup: 'up', arrowdown: 'down', arrowleft: 'left', arrowright: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right',
}
export function dirOfKey(key) {
  const k = String(key || '').toLowerCase()
  return DIRECTION_KEYS[k] || null
}

function center(rect) {
  return { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 }
}

// 在候选矩形中选方向上的最近者；cands: [{rect, el}]，按文档序传入
// 返回候选对象或 null。overlapBonus：主轴向投影重叠时交叉轴惩罚打折。
export function pickNearest(fromRect, cands, dir, { eps = 1, crossWeight = 2.4 } = {}) {
  if (!['up', 'down', 'left', 'right'].includes(dir)) return null
  if (!fromRect || !cands || cands.length === 0) return null
  const fc = center(fromRect)
  let best = null
  let bestScore = Infinity
  for (const c of cands) {
    const cc = center(c.rect)
    const primary = dir === 'up' ? fc.y - cc.y
      : dir === 'down' ? cc.y - fc.y
      : dir === 'left' ? fc.x - cc.x
      : cc.x - fc.x
    if (primary <= eps) continue // 不在该方向半平面
    const cross = dir === 'up' || dir === 'down' ? Math.abs(cc.x - fc.x) : Math.abs(cc.y - fc.y)
    // 主轴向投影重叠则交叉轴视为 0（同行/同列优先）
    const overlap = dir === 'up' || dir === 'down'
      ? Math.min(fromRect.right, c.rect.right) - Math.max(fromRect.left, c.rect.left)
      : Math.min(fromRect.bottom, c.rect.bottom) - Math.max(fromRect.top, c.rect.top)
    const effCross = overlap > 0 ? 0 : cross
    const score = primary + effCross * crossWeight
    if (score < bestScore) { bestScore = score; best = c }
  }
  return best
}

// 判定矩形是否可见（宽高 > 0）
export function isUsableRect(rect) {
  return !!rect && rect.width > 0 && rect.height > 0
}
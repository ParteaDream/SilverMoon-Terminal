// 桌面图标放置逻辑（纯函数，供 TerminalPage 使用）
//
// 修复的两个组合拖动问题：
//   1) 组合拖动到与上次位置有重叠处无法放置（松手后回归原位）
//      —— 原因：单图标“最近空格”重定向被错误地应用到组合拖动上，
//         落点格被选中成员占据时被当作“被占用”，重定向回自身原点，位移变成 (0,0)。
//   2) 组合拖动会与未选中的 app 重叠
//      —— 原因：整体平移未检查目标格是否被未选中 app 占用，也不处理越界。
//
// 新逻辑：
//   - 单图标：保持既有行为（目标格被占用时找最近空格）。
//   - 组合：位移 = 松手落点格 - 被拖图标原点（不再做单图标重定向）；
//     校验整组目标格（不越界、不与未选中 app 重叠），不合法时按曼哈顿距离
//     搜索最近的合法位移；找不到则保持原位；最后修复成员间的历史重叠数据。

const MAX_SEARCH_DIST = 60 // 合法位移搜索半径（距理想位移的曼哈顿距离上限）

// 单图标：目标格被占用时，寻找曼哈顿距离最近的空格（占用者为自身时视为空格）
function resolveSingle(appId, col, row, occupied, gridCols) {
  const key = `${col},${row}`
  if (occupied[key] && occupied[key] !== appId) {
    let bestCol = col, bestRow = row, bestDist = Infinity
    for (let r = 0; r < 20; r++) {
      for (let c = 0; c < gridCols; c++) {
        if (!occupied[`${c},${r}`] || occupied[`${c},${r}`] === appId) {
          const dist = Math.abs(c - col) + Math.abs(r - row)
          if (dist < bestDist) { bestDist = dist; bestCol = c; bestRow = r }
        }
      }
    }
    col = bestCol; row = bestRow
  }
  return { col, row }
}

// 组合拖动：返回整组最终位置
function resolveGroup(draggedId, rawCol, rawRow, origins, members, occupied, gridCols) {
  const draggedOrigin = origins[draggedId]
  const dCol = rawCol - draggedOrigin.col
  const dRow = rawRow - draggedOrigin.row

  // 只有“未选中”的 app 才是障碍：成员之间互相占格（正在移走）不算冲突
  const memberSet = new Set(members)
  const occupiedByOthers = {}
  for (const [key, id] of Object.entries(occupied)) {
    if (!memberSet.has(id)) occupiedByOthers[key] = id
  }

  // 校验整组在某个位移 (dc, dr) 下是否合法：不越界、不压到未选中 app
  const isFree = (dc, dr) => {
    for (const id of members) {
      const o = origins[id]
      const nc = o.col + dc
      const nr = o.row + dr
      if (nc < 0 || nc >= gridCols || nr < 0) return false
      if (occupiedByOthers[`${nc},${nr}`] !== undefined) return false
    }
    return true
  }

  // 理想位移（松手点相对原点）；不合法时按曼哈顿距离搜索最近的合法位移
  let dc = dCol
  let dr = dRow
  if (!isFree(dc, dr)) {
    let found = false
    for (let dist = 1; dist <= MAX_SEARCH_DIST && !found; dist++) {
      for (let a = -dist; a <= dist && !found; a++) {
        const b1 = dist - Math.abs(a)
        const b2 = -b1
        for (const b of b1 === b2 ? [b1] : [b1, b2]) {
          if (isFree(dCol + a, dRow + b)) { dc = dCol + a; dr = dRow + b; found = true; break }
        }
      }
    }
    if (!found) { dc = 0; dr = 0 } // 附近无合法位移：保持原位（绝不制造重叠）
  }

  // 应用位移；成员间若落到同一格（历史重叠脏数据），后到的就近拆分到空格
  const next = {}
  const taken = new Set()
  for (const id of members) {
    const o = origins[id]
    let nc = o.col + dc
    let nr = o.row + dr
    const key = `${nc},${nr}`
    if (taken.has(key) || occupiedByOthers[key] !== undefined) {
      const blocked = { ...occupiedByOthers }
      for (const k of taken) blocked[k] = true
      let bc = nc, br = nr, bd = Infinity
      for (let r = 0; r < 30; r++) {
        for (let c = 0; c < gridCols; c++) {
          if (blocked[`${c},${r}`] === undefined) {
            const d = Math.abs(c - nc) + Math.abs(r - nr)
            if (d < bd) { bd = d; bc = c; br = r }
          }
        }
      }
      nc = bc; nr = br
    }
    next[id] = { col: nc, row: nr }
    taken.add(`${nc},${nr}`)
  }
  return next
}

// 入口：返回受影响图标的最终位置 { id: { col, row }, ... }
export function resolveDesktopDrop({
  draggedId,
  rawCol,
  rawRow,
  origins,      // 拖动开始时各图标位置 { id: { col, row } }
  selectedIds,  // 当前选中的图标 id 列表
  occupied,     // 桌面当前占用 { 'col,row': id }
  gridCols,
}) {
  rawCol = Math.max(0, Math.min(gridCols - 1, rawCol))
  rawRow = Math.max(0, rawRow)

  const isGroup = selectedIds.length > 1 && selectedIds.includes(draggedId) && origins[draggedId]
  if (!isGroup) {
    return { [draggedId]: resolveSingle(draggedId, rawCol, rawRow, occupied, gridCols) }
  }

  const members = selectedIds.filter(id => origins[id])
  return resolveGroup(draggedId, rawCol, rawRow, origins, members, occupied, gridCols)
}

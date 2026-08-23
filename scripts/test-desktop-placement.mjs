// 桌面图标拖放放置逻辑回归测试
// 覆盖两个已报告 bug：
//   1) 组合拖动到与上一次位置有重叠处无法放置（松手后回归原位）
//   2) 组合拖动到未选中的 app 上会与其重叠
// 运行：node scripts/test-desktop-placement.mjs
import assert from 'node:assert/strict'
import { resolveDesktopDrop } from '../src/utils/desktopPlacement.mjs'

let passed = 0
function check(name, fn) {
  fn()
  passed++
  console.log(`  ✓ ${name}`)
}

// 构造 occupied 占用表：{ 'col,row': id }
function occupy(icons) {
  const occ = {}
  for (const [id, pos] of Object.entries(icons)) occ[`${pos.col},${pos.row}`] = id
  return occ
}

console.log('desktopPlacement:')

// ── Bug 1：组合拖动到与上次位置有重叠处必须能放置 ──
check('群组下移一格，落点在被选中成员的旧格上（bug 1 复现）', () => {
  // A(1,1)、B(1,2) 选中，拖到 (1,2)(1,3)：松手时被拖图标 A 的落点格 (1,2) 是成员 B 的旧格
  const result = resolveDesktopDrop({
    draggedId: 'A',
    rawCol: 1, rawRow: 2,
    origins: { A: { col: 1, row: 1 }, B: { col: 1, row: 2 } },
    selectedIds: ['A', 'B'],
    occupied: occupy({ A: { col: 1, row: 1 }, B: { col: 1, row: 2 } }),
    gridCols: 6,
  })
  assert.deepEqual(result, { A: { col: 1, row: 2 }, B: { col: 1, row: 3 } })
})

check('群组右移一格（正常位移不回归）', () => {
  const result = resolveDesktopDrop({
    draggedId: 'A',
    rawCol: 2, rawRow: 1,
    origins: { A: { col: 1, row: 1 }, B: { col: 1, row: 2 } },
    selectedIds: ['A', 'B'],
    occupied: occupy({ A: { col: 1, row: 1 }, B: { col: 1, row: 2 } }),
    gridCols: 6,
  })
  assert.deepEqual(result, { A: { col: 2, row: 1 }, B: { col: 2, row: 2 } })
})

// ── Bug 2：组合拖动不能与未选中的 app 重叠 ──
check('群组拖到未选中 app 上，不得与它重叠（bug 2 复现）', () => {
  // A(1,1)、B(1,2) 选中，C(2,2) 未选中；松手时被拖图标 A 的落点格是 (2,2)（C 的格）
  const result = resolveDesktopDrop({
    draggedId: 'A',
    rawCol: 2, rawRow: 2,
    origins: { A: { col: 1, row: 1 }, B: { col: 1, row: 2 } },
    selectedIds: ['A', 'B'],
    occupied: occupy({ A: { col: 1, row: 1 }, B: { col: 1, row: 2 }, C: { col: 2, row: 2 } }),
    gridCols: 6,
  })
  // 任何成员都不得落在 C 的格上
  for (const [id, pos] of Object.entries(result)) {
    assert.notDeepEqual(pos, { col: 2, row: 2 }, `${id} 与 C 重叠`)
  }
  // 且成员之间不得共享格子
  const keys = Object.values(result).map(p => `${p.col},${p.row}`)
  assert.equal(new Set(keys).size, keys.length, '成员之间共享位置')
})

// ── 单图标拖动（既有行为回归）──
check('单图标拖到被占用格，落到最近空格', () => {
  const result = resolveDesktopDrop({
    draggedId: 'A',
    rawCol: 1, rawRow: 2,
    origins: { A: { col: 3, row: 3 } },
    selectedIds: ['A'],
    occupied: occupy({ A: { col: 3, row: 3 }, C: { col: 1, row: 2 } }),
    gridCols: 6,
  })
  assert.deepEqual(result, { A: { col: 1, row: 1 } })
})

// ── 边界：群组位移不得越界 ──
check('群组右移越界时整体回退到合法位移', () => {
  const result = resolveDesktopDrop({
    draggedId: 'A',
    rawCol: 5, rawRow: 1,
    origins: { A: { col: 3, row: 1 }, B: { col: 4, row: 1 } },
    selectedIds: ['A', 'B'],
    occupied: occupy({ A: { col: 3, row: 1 }, B: { col: 4, row: 1 } }),
    gridCols: 6,
  })
  assert.deepEqual(result, { A: { col: 4, row: 1 }, B: { col: 5, row: 1 } })
})

// ── 自愈：成员间历史重叠数据在组合拖动时被修复 ──
check('成员间已有重叠（历史脏数据）在拖动后被拆分到不同格', () => {
  const result = resolveDesktopDrop({
    draggedId: 'A',
    rawCol: 2, rawRow: 1,
    origins: { A: { col: 1, row: 1 }, B: { col: 1, row: 1 } },
    selectedIds: ['A', 'B'],
    occupied: occupy({ A: { col: 1, row: 1 }, B: { col: 1, row: 1 } }),
    gridCols: 6,
  })
  assert.deepEqual(result, { A: { col: 2, row: 1 }, B: { col: 2, row: 0 } })
  const keys = Object.values(result).map(p => `${p.col},${p.row}`)
  assert.equal(new Set(keys).size, keys.length, '成员之间共享位置')
})

console.log(`\n全部通过：${passed} 项`)

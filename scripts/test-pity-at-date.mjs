import { buildPityIndex, pityAtDate, pityRangeAtDate, previousDateStr, sumPity, PITY_GROUPS, PITY_KEYS } from '../src/utils/pityAtDate.js'

let failures = 0
const ok = (name, cond, extra) => {
  if (cond) console.log(`  ✓ ${name}`)
  else { failures++; console.log(`  ✗ ${name}`, extra ?? '') }
}

// 角色池跨 301/400 共享保底；武器 302；集录 500
const byType = {
  301: [
    { id: '1', time: '2024-01-01 10:00:00', rank_type: 3 },
    { id: '2', time: '2024-01-02 10:00:00', rank_type: 5 }, // 角色池出金
    { id: '3', time: '2024-01-03 10:00:00', rank_type: 3 },
  ],
  400: [
    { id: '4', time: '2024-01-04 10:00:00', rank_type: 4 },
    { id: '5', time: '2024-01-05 10:00:00', rank_type: 5 }, // 角色池-2 出金（共享）
    { id: '6', time: '2024-01-06 10:00:00', rank_type: 3 },
    { id: '7', time: '2024-01-07 10:00:00', rank_type: 3 },
  ],
  302: [
    { id: '8', time: '2024-01-01 10:00:00', rank_type: 4 },
    { id: '9', time: '2024-01-03 10:00:00', rank_type: 5 },
    { id: '10', time: '2024-01-05 10:00:00', rank_type: 3 },
  ],
  500: [
    { id: '11', time: '2024-01-02 10:00:00', rank_type: 5 },
    { id: '12', time: '2024-01-06 10:00:00', rank_type: 3 },
  ],
}
const index = buildPityIndex(byType)

console.log('== 分组口径 ==')
ok('三类祈愿', PITY_KEYS.length === 3 && PITY_GROUPS[0].types.join() === '301,400')

console.log('== 角色池：301/400 合并、出金重置 ==')
ok('1/1 未出金 → 1 抽', pityAtDate(index, '2024-01-01').character === 1)
ok('1/2 出金当日 → 0 抽', pityAtDate(index, '2024-01-02').character === 0)
ok('1/3 → 1 抽', pityAtDate(index, '2024-01-03').character === 1)
ok('1/4 → 2 抽（含 400 的抽数）', pityAtDate(index, '2024-01-04').character === 2)
ok('1/5 再次出金 → 0 抽', pityAtDate(index, '2024-01-05').character === 0)
ok('1/7 → 2 抽', pityAtDate(index, '2024-01-07').character === 2)
ok('1/9 之后不再增长', pityAtDate(index, '2024-01-09').character === 2)

console.log('== 武器池独立 ==')
ok('1/1 → 1 抽', pityAtDate(index, '2024-01-01').weapon === 1)
ok('1/3 出金 → 0 抽', pityAtDate(index, '2024-01-03').weapon === 0)
ok('1/5 → 1 抽', pityAtDate(index, '2024-01-05').weapon === 1)
ok('角色出金不影响武器', pityAtDate(index, '2024-01-02').weapon === 1)

console.log('== 集录池独立 ==')
ok('1/1 尚无记录 → 0 抽', pityAtDate(index, '2024-01-01').chronicled === 0)
ok('1/2 出金 → 0 抽', pityAtDate(index, '2024-01-02').chronicled === 0)
ok('1/6 → 1 抽', pityAtDate(index, '2024-01-06').chronicled === 1)

console.log('== 当日结束前一刻口径 ==')
const sameDay = buildPityIndex({ 301: [
  { id: '20', time: '2024-03-10 00:00:01', rank_type: 3 },
  { id: '21', time: '2024-03-10 23:59:59', rank_type: 3 },
  { id: '22', time: '2024-03-11 00:00:00', rank_type: 3 },
] })
ok('3/10 当日两抽均计入 → 2', pityAtDate(sameDay, '2024-03-10').character === 2)
ok('3/11 起计入次日 → 3', pityAtDate(sameDay, '2024-03-11').character === 3)

console.log('== 同一时刻按 id 排序 ==')
const tie = buildPityIndex({ 301: [
  { id: '100', time: '2024-02-01 12:00:00', rank_type: 5 },
  { id: '101', time: '2024-02-01 12:00:00', rank_type: 3 },
] })
ok('出金在前后各一抽 → 1 抽', pityAtDate(tie, '2024-02-01').character === 1)

console.log('== 无五星 / 空数据 ==')
const noGold = buildPityIndex({ 301: [
  { id: '30', time: '2024-01-01', rank_type: 3 },
  { id: '31', time: '2024-01-02', rank_type: 4 },
] })
ok('从未出金 → 全部计入 2', pityAtDate(noGold, '2024-01-02').character === 2)
ok('空索引 → 全 0', PITY_KEYS.every(k => pityAtDate(buildPityIndex({}), '2024-01-02')[k] === 0))
ok('空日期 → 全 0', PITY_KEYS.every(k => pityAtDate(index, '')[k] === 0))

console.log('== 期初 / 期末（当日刚开始 vs 当日结束）==')
ok('前一天 闰年 3/1 → 2/29', previousDateStr('2024-03-01') === '2024-02-29', previousDateStr('2024-03-01'))
ok('前一天 跨年 1/1 → 上年 12/31', previousDateStr('2024-01-01') === '2023-12-31')
ok('非法日期 → 空串', previousDateStr('bad') === '' && previousDateStr('') === '')
const r13 = pityRangeAtDate(index, '2024-01-03')
ok('1/3 角色期初 0 → 期末 1', r13.start.character === 0 && r13.end.character === 1, JSON.stringify(r13))
const r15 = pityRangeAtDate(index, '2024-01-05')
ok('1/5 角色期初 2 → 期末 0（当日出金清零）', r15.start.character === 2 && r15.end.character === 0, JSON.stringify(r15))
const r11 = pityRangeAtDate(index, '2024-01-01')
ok('1/1 无更早数据 → 期初 0', r11.start.character === 0 && r11.start.weapon === 0 && r11.start.chronicled === 0)

console.log('== 求和 ==')
const p = { character: 5, weapon: 3, chronicled: 2 }
ok('全选 → 10', sumPity(p, PITY_KEYS) === 10)
ok('选角色+集录 → 7', sumPity(p, ['character', 'chronicled']) === 7)
ok('未选 → 0', sumPity(p, []) === 0)
ok('null → 0', sumPity(null, PITY_KEYS) === 0)

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)

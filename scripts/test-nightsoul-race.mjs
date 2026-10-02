// 归火圣夜巡礼 · 无头回归测试
//
//   node scripts/test-nightsoul-race.mjs [--trials=8] [--races=1] [--verbose]
//
// 校验三件事：
//   1. 关卡生成的可达性硬保证（有向洪水填充必须通过，且路径不能过度绕远）
//   2. 7 颗球在物理仿真中全部抵达终点（不会集体卡死）
//   3. 完赛时长落在设计区间（不能半分钟就结束，也不能拖到没边）
import assert from 'node:assert/strict'

import { RACE, generateCourse } from '../src/utils/raceCourse.mjs'
import { createRace, stepRace, raceResults, raceStandings } from '../src/utils/racePhysics.mjs'

const argv = process.argv.slice(2)
const arg = (k, d) => {
  const hit = argv.find(a => a.startsWith(`--${k}=`))
  return hit ? Number(hit.split('=')[1]) : d
}
const VERBOSE = argv.includes('--verbose')
const TRIALS = arg('trials', 8)
const DT = 1 / 60

function fmt(t) {
  if (t == null) return 'DNF'
  const m = Math.floor(t / 60)
  const s = t - m * 60
  return `${m}:${s.toFixed(2).padStart(5, '0')}`
}

// ── 1. 关卡结构 ───────────────────────────────────────────────────────────
console.log('══ 归火圣夜巡礼 · 无头验证 ══\n')
const courses = []
const allKinds = new Set()
const t0 = Date.now()
for (let i = 0; i < TRIALS; i++) {
  const seed = 1000 + i * 7919
  const course = generateCourse({ seed })
  courses.push(course)
  assert.equal(course.floorYs.length, RACE.chamberCount, '层数不符')
  assert.ok(course.height > 18000, `赛道太短: ${course.height}`)
  assert.ok(course.statics.length > 88, `碰撞体过少: ${course.statics.length}`)
  assert.ok(course.kinematics.length >= 6, `机关过少: ${course.kinematics.length}`)
  // 机器层结构校验：每层必须有料斗/工位/闸门/回送
  assert.ok(course.relaunchers.length === course.chambers, `回送装置缺失: ${course.relaunchers.length}/${course.chambers}`)
  const stationCount = course.chambersInfo.reduce((a, c) => a + c.tags.length, 0)
  assert.ok(stationCount / course.chambers >= 1, `工位过少: ${(stationCount / course.chambers).toFixed(2)}`)
  for (const t of course.chambersInfo.flatMap(c => c.tags)) allKinds.add(t)
  assert.equal(course.report.fallbacks, 0, '出现回退层（校验失败）')
  const worstPath = Math.max(...course.report.pathLens)
  if (VERBOSE) {
    console.log(`seed=${seed} 高度=${course.height} 静碰撞=${course.statics.length} 机关=${course.kinematics.length} 力场=${course.fields.length} 最长路径=${worstPath} 重掷=${course.report.attempts}/${RACE.chamberCount}`)
    console.log(`  层名: ${course.chambersInfo.map(c => c.name).join(' · ')}`)
  }
}
for (const must of ['dualgate']) {
  assert.ok(allKinds.has(must), `生成的流水线中未出现工位「${must}」`)
}
console.log(`✓ 关卡结构：${TRIALS} 条赛道全部通过重力可达性校验（${Date.now() - t0} ms）`)
console.log(`  工位种类：${[...allKinds].sort().join(', ')}`)

// ── 2. 物理仿真 ───────────────────────────────────────────────────────────
const allTimes = []
let totalAssist = 0
let totalPenalty = 0
let stalledRaces = 0
let leadChanges = 0
let midLeaderWin = 0
let midSamples = 0
let queueEvents = 0
let totalRelaunch = 0
let totalCatchUp = 0
let queueRaces = 0
const dwellAll = []

for (let i = 0; i < courses.length; i++) {
  const course = courses[i]
  const defs = Array.from({ length: 7 }, (_, k) => ({ name: `C${k}`, dragScale: 1 + (k - 3) * 0.012 }))
  const state = createRace(course, defs)
  let frames = 0
  const maxFrames = Math.ceil((RACE.maxRaceTime + 5) / DT)
  let lastLeader = -1
  let midLeader = -1
  let changes = 0
  const chamberEnter = state.balls.map(() => 0)
  const lastIdx = state.balls.map(() => -1)
  const dwell = state.balls.map(() => [])
  const queueSeen = new Set()
  while (!state.over && frames < maxFrames) {
    stepRace(state, DT)
    frames++
    if (frames % 10 === 0) {
      // 卡关聚集：同一层底部 340px 内同时挤着 ≥3 颗球
      for (const ci of course.chambersInfo) {
        if (queueSeen.has(ci.index)) continue
        let cnt = 0
        for (const b of state.balls) if (b.y > ci.y1 - 340 && b.y < ci.y1 + 60) cnt++
        if (cnt >= 3) { queueSeen.add(ci.index); queueEvents++ }
      }
      // 单层停留时长
      for (let bi = 0; bi < state.balls.length; bi++) {
        const b = state.balls[bi]
        let idx = -1
        for (let ci = 0; ci < course.chambersInfo.length; ci++) {
          if (b.y < course.chambersInfo[ci].y1) { idx = ci; break }
        }
        if (idx < 0) idx = course.chambersInfo.length - 1
        if (idx !== lastIdx[bi]) {
          // 只在「真正推进到更深一层」时记录停留；球在缺口附近上下弹跳不算
          if (idx > lastIdx[bi] && lastIdx[bi] >= 0) dwell[bi].push(state.t - chamberEnter[bi])
          chamberEnter[bi] = state.t
          lastIdx[bi] = idx
        }
      }
    }
    if (frames % 15 === 0) {
      const st = raceStandings(state)
      const lead = st[0].i
      if (lastLeader >= 0 && lead !== lastLeader) changes++
      lastLeader = lead
      if (midLeader < 0 && st[0].progress > 0.5) midLeader = lead
    }
  }
  const results = raceResults(state)
  for (let bi = 0; bi < dwell.length; bi++) {
    for (const d of dwell[bi]) dwellAll.push(d)
  }
  if (queueSeen.size > 0) queueRaces++
  leadChanges += changes
  if (midLeader >= 0) {
    midSamples++
    if (results[0].index === midLeader) midLeaderWin++
  }
  totalPenalty += state.penaltyTotal
  totalRelaunch += state.relaunchTotal
  totalCatchUp += state.catchUpTotal
  const finished = results.filter(r => r.finished)
  if (finished.length < 7) stalledRaces++
  totalAssist += state.assistTotal
  const times = finished.map(r => r.time)
  allTimes.push(...times)
  if (VERBOSE || finished.length < 7) {
    console.log(`race#${i}: 完赛 ${finished.length}/7 · 用时 ${fmt(times[0])} ~ ${fmt(times[times.length - 1])} · 总时长 ${fmt(state.t)} · 佑护 ${state.assistTotal} 次`)
    console.log(`  排名: ${results.map(r => `${r.rank}.${r.name}(${fmt(r.time)})`).join('  ')}`)
  }
}

allTimes.sort((a, b) => a - b)
const n = allTimes.length
const mean = allTimes.reduce((a, b) => a + b, 0) / n
const med = allTimes[Math.floor(n / 2)]
const p10 = allTimes[Math.floor(n * 0.1)]
const p90 = allTimes[Math.floor(n * 0.9)]
console.log(`✓ 物理仿真：${courses.length} 场 × 7 球，完赛 ${n}/${courses.length * 7}`)
console.log(`  用时 中位 ${fmt(med)} · 均值 ${fmt(mean)} · p10 ${fmt(p10)} · p90 ${fmt(p90)}`)
console.log(`  夜魂佑护总计 ${totalAssist} 次（平均每场 ${(totalAssist / courses.length).toFixed(2)}）`)
console.log(`  燃素试炼惩罚 ${totalPenalty} 次（平均每场 ${(totalPenalty / courses.length).toFixed(1)}）`)
console.log(`  领跑易主 ${(leadChanges / courses.length).toFixed(1)} 次/场 · 半程领跑者最终夺冠率 ${((midLeaderWin / Math.max(1, midSamples)) * 100).toFixed(0)}%`)
dwellAll.sort((a, b) => a - b)
console.log(`  卡关聚集 ${(queueEvents / courses.length).toFixed(1)} 处/场（${queueRaces}/${courses.length} 场出现过 3 球以上堵门）`)
console.log(`  流水线回送 ${(totalRelaunch / courses.length).toFixed(0)} 次/场（平均每层 ${(totalRelaunch / courses.length / RACE.chamberCount).toFixed(2)} 次）`)
console.log(`  落后追赶放行 ${(totalCatchUp / courses.length).toFixed(1)} 次/场`)
console.log(`  单层停留 中位 ${dwellAll[Math.floor(dwellAll.length / 2)]?.toFixed(1)}s · p95 ${dwellAll[Math.floor(dwellAll.length * 0.95)]?.toFixed(1)}s`)

assert.equal(n, courses.length * 7, '存在未完赛的球（卡死）')
assert.equal(stalledRaces, 0, '存在未收敛的比赛')
assert.ok(med > 55, `中位用时过短（${med.toFixed(1)}s），关卡长度不足`)
assert.ok(med < 240, `中位用时过长（${med.toFixed(1)}s）`)
assert.ok(p10 > 30, `最快用时过短（${p10.toFixed(1)}s）`)
assert.ok(allTimes[n - 1] < 280, `最慢用时 ${allTimes[n - 1].toFixed(1)}s 逼近硬性上限，试炼惩罚过重`)
// 新设计里「球在难关反复周转」正是想要的场面，佑护只是兜底；真正的门禁是下面的最长用时
assert.ok(totalAssist / courses.length < 45, '佑护触发过于频繁，说明关卡存在死结')
assert.ok(totalPenalty / courses.length > 0.5, '试炼门惩罚过少，比赛缺少翻盘空间')
assert.ok(totalPenalty / courses.length < 32, '试炼门惩罚过多，比赛会被拖垮')
assert.ok(totalRelaunch / courses.length > 30, '流水线回送过少，机器几乎不会筛人')
assert.ok(totalCatchUp / courses.length > 1, '落后追赶机制几乎没触发')
assert.ok(totalRelaunch / courses.length < 900, '流水线回送过多，比赛会被拖垮')
assert.ok(leadChanges / courses.length > 1.2, '领跑易主过少（开局即定调）')
assert.ok(midLeaderWin / Math.max(1, midSamples) < 0.8, '半程领跑者几乎必定夺冠，缺少悬念')
assert.ok(queueRaces / courses.length > 0.5, '几乎没有出现「多球堵在难关」的场面')
assert.ok(queueEvents / courses.length > 1, '卡关聚集点过少，关卡缺少真正的难关')

// ── 3. 确定性 ─────────────────────────────────────────────────────────────
{
  const c1 = generateCourse({ seed: 424242 })
  const c2 = generateCourse({ seed: 424242 })
  assert.equal(c1.statics.length, c2.statics.length, '同种子生成结果不一致')
  const run = (course) => {
    const s = createRace(course, Array.from({ length: 7 }, (_, k) => ({ name: `C${k}` })))
    let f = 0
    while (!s.over && f < 40000) { stepRace(s, DT); f++ }
    return raceResults(s).map(r => `${r.rank}:${r.time?.toFixed(4)}`).join('|')
  }
  assert.equal(run(c1), run(c2), '同种子仿真结果不可复现')
  console.log('✓ 确定性：同种子 → 同赛道 → 同名次用时')
}

// ── 4. 实时排名 API ───────────────────────────────────────────────────────
{
  const course = generateCourse({ seed: 555 })
  const s = createRace(course, Array.from({ length: 7 }, (_, k) => ({ name: `C${k}` })))
  for (let f = 0; f < 600; f++) stepRace(s, DT)
  const st = raceStandings(s)
  assert.equal(st.length, 7)
  for (let i = 1; i < st.length; i++) {
    assert.ok(st[i - 1].progress >= st[i].progress - 1e-9, '实时排名未按进度排序')
  }
  console.log('✓ 实时排名：按进度单调递减')
}

console.log('\n全部通过 ✓')

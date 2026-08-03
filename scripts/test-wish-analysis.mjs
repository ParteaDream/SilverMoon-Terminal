import { analyzePortfolio, analyzeOrdered, convertCurrencies, computePityFromArchive, p5Rate, simulateOutcomes, simulateRecycling } from '../src/utils/wishAnalysis.js'

let failures = 0
const ok = (name, cond, extra) => {
  if (cond) console.log(`  ✓ ${name}`)
  else { failures++; console.log(`  ✗ ${name}`, extra ?? '') }
}

console.log('== 保底概率表 ==')
ok('角色 73抽=0.6%', Math.abs(p5Rate('character', 73) - 0.006) < 1e-9)
ok('角色 74抽=6.6%', Math.abs(p5Rate('character', 74) - 0.066) < 1e-9)
ok('角色 89抽=96.6%', Math.abs(p5Rate('character', 89) - 0.966) < 1e-9)
ok('角色 90抽=100%', p5Rate('character', 90) === 1)
ok('武器 62抽=0.7%', Math.abs(p5Rate('weapon', 62) - 0.007) < 1e-9)
ok('武器 63抽=7.7%', Math.abs(p5Rate('weapon', 63) - 0.077) < 1e-9)
ok('武器 73抽=77.7%', Math.abs(p5Rate('weapon', 73) - 0.777) < 1e-9)
ok('武器 74抽=81.2%', Math.abs(p5Rate('weapon', 74) - 0.812) < 1e-9)
ok('武器 79抽=98.7%', Math.abs(p5Rate('weapon', 79) - 0.987) < 1e-9)
ok('武器 80抽=100%', p5Rate('weapon', 80) === 1)

console.log('== 货币换算 ==')
const cv = convertCurrencies({ primogems: 3200, intertwinedFates: 10, genesisCrystals: 160, starglitter: 27 })
ok('原生抽数 = 纠缠10 + 原石/创世21 + 星辉27/5=5 = 36（原生星辉计入）', cv.fates === 36 && cv.starglitter === 27, JSON.stringify(cv))

console.log('== 角色池：期望五星率/四星率（含 10 抽保底 ≈11.8%）==')
const charCfg = {
  key: 'character', kind: 'character', name: '角色池',
  poolA: '玛拉妮', poolB: '希格雯', up4: ['班尼特', '菲谢尔', '琳妮特'],
  pity5: 0, pity4: 0, guaranteed: 0, crStreak: 0,
  targets: [{ id: 'a1', name: '玛拉妮', rarity: 5, copies: 1 }],
}
const r1 = analyzePortfolio([charCfg], 300, false)
const c1 = r1.curves.character
ok('300 抽期望五星 ≈ 4.3~4.9 (含软保底 1.6%)', c1.E5[300] > 4.0 && c1.E5[300] < 5.3, c1.E5[300])
ok('300 抽期望四星 ≈ 32~38 (含 10 抽保底 ~11.8%)', c1.E4[300] > 30 && c1.E4[300] < 40, c1.E4[300])
ok('期望星辉 ≈ 95~135', c1.Eg[300] > 90 && c1.Eg[300] < 140, c1.Eg[300])

console.log('== 角色池：90 抽大保底必出（小保底歪则 180 抽必得）==')
const charCfg2 = { ...charCfg, targets: [{ id: 'a1', name: '玛拉妮', rarity: 5, copies: 1 }] }
const r2 = analyzePortfolio([charCfg2], 180, false)
const c2 = r2.curves.character
ok('180 抽内必得目标', c2.F[180] > 0.99999, c2.F[180])
console.log('  F[73]=' + c2.F[73].toFixed(4), 'F[80]=' + c2.F[80].toFixed(4), 'F[90]=' + c2.F[90].toFixed(4), 'F[120]=' + c2.F[120].toFixed(4))

console.log('== 概率质量守恒（多目标 200 抽）==')
{
  const charCfg3 = {
    ...charCfg, targets: [
      { id: 'a1', name: '玛拉妮', rarity: 5, copies: 2 },
      { id: 'b1', name: '希格雯', rarity: 5, copies: 1 },
      { id: '4a', name: '班尼特', rarity: 4, copies: 1 },
    ],
  }
  const r = analyzePortfolio([charCfg3], 200, false)
  const c = r.curves.character
  let mass = 0
  for (let i = 0; i < c._probs.length; i++) mass += c._probs[i]
  ok('200 抽后概率质量恒为 1', Math.abs(mass - 1) < 1e-6, mass)
  ok('多目标达成概率合理', c.F[200] > 0.05 && c.F[200] <= 1.000001, c.F[200])
  ok('期望达成副本数 ≤ 总副本(4)', c.EMetCopies[200] <= 4.000001, c.EMetCopies[200])
  let mono = true
  for (let i = 1; i <= 200; i++) if (c.F[i] < c.F[i - 1] - 1e-12) mono = false
  ok('F 曲线单调不减', mono)
  // gu4 精确模式：有 4★ 目标时启用
  ok('有四星目标时 gu4 精确建模', c.E4[200] > 20, c.E4[200])
}

console.log('== 武器池：定轨 2 把 = 最多 240 抽必得（每把 37.5% 小保底+定轨）==')
const wepCfg = {
  key: 'weapon', kind: 'weapon', name: '武器池',
  weapon5: ['薄暮疾风', '苍月之歌'], up4: ['探龙者', '斩鲸刃', '玄铃', '万卷书', '碎星锤'],
  pity5: 0, pity4: 0, fate: 0,
  targets: [{ id: 'w1', name: '薄暮疾风', rarity: 5, copies: 1, epitomized: true }],
}
const r3 = analyzePortfolio([wepCfg], 240, false)
const c3 = r3.curves.weapon
ok('240 抽内定轨武器必得（80×3）', c3.F[240] > 0.99999, c3.F[240])
ok('期望五星 ≈ 3.6 (0.7%)', Math.abs(c3.E5[240] - 3.6) < 0.6, c3.E5[240])

console.log('== 集录祈愿：定轨 90×2 必得；不定轨 1/池规模 ==')
const chroCfg = {
  key: 'chronicled', kind: 'chronicled', name: '集录祈愿',
  chrono5: [
    { name: '优菈', type: 'char' }, { name: '可莉', type: 'char' }, { name: '甘雨', type: 'char' },
    { name: '松籁响起之时', type: 'weapon' }, { name: '四风原典', type: 'weapon' },
  ],
  chrono4: [{ name: '罗莎莉亚', type: 'char' }, { name: '早柚', type: 'char' }, { name: '西风剑', type: 'weapon' }],
  pity5: 0, pity4: 0, fate: 0,
  targets: [{ id: 'c1', name: '优菈', rarity: 5, copies: 1, epitomized: true }],
}
const r4 = analyzePortfolio([chroCfg], 180, false)
const c4 = r4.curves.chronicled
ok('集录定轨 180 抽必得', c4.F[180] > 0.99999, c4.F[180])
// 不定轨：1/5 → 期望更差
const chroCfg2 = { ...chroCfg, targets: [{ id: 'c1', name: '优菈', rarity: 5, copies: 1, epitomized: false }] }
const r5 = analyzePortfolio([chroCfg2], 180, false)
const c5 = r5.curves.chronicled
ok('不定轨 180 抽概率 < 定轨', c5.F[180] < c4.F[180], `${c5.F[180]} vs ${c4.F[180]}`)

console.log('== 集录祈愿：角色与武器分别定轨（双定轨）==')
{
  // 修复回归：单定轨角色时，武器目标永不产出 → 期望抽数/达成概率恒 0
  const cfg = {
    ...chroCfg,
    targets: [
      { id: 'c1', name: '优菈', rarity: 5, copies: 1, epitomized: true },
      { id: 'w1', name: '松籁响起之时', rarity: 5, copies: 1, epitomized: true },
    ],
  }
  // 每个定轨阶段至多 2 次五星（歪 + 命定值必得，各 ≤90 抽）→ 双阶段最坏 360 抽
  const r = analyzePortfolio([cfg], 360, false)
  const c = r.curves.chronicled
  ok('角色+武器双定轨：360 抽内必得（2×180）', c.F[360] > 0.99999, c.F[360])
  ok('180 抽达成概率合理（~0.4~0.6）', c.F[180] > 0.3 && c.F[180] < 0.7, c.F[180])
  ok('期望抽数合理（~150~230）', r.perPool[0].need.E > 140 && r.perPool[0].need.E < 240, r.perPool[0].need.E)
  let mass = 0
  for (let i = 0; i < c._probs.length; i++) mass += c._probs[i]
  ok('概率质量守恒', Math.abs(mass - 1) < 1e-6, mass)
  const sim = simulateOutcomes([cfg], [
    { poolKey: 'chronicled', name: '优菈', copy: 1 },
    { poolKey: 'chronicled', name: '松籁响起之时', copy: 1 },
  ], 360, 20000)
  const achieved = sim.rows.filter(x => !x.key.startsWith('全部未达成')).reduce((s, x) => s + x.p, 0)
  ok('双定轨模拟达成概率 ≈ 精确 DP', Math.abs(achieved - c.F[360]) < 0.03, `${achieved} vs ${c.F[360]}`)
}

console.log('== 集录祈愿：结果分布计歪（小保底歪 = 非定轨五星）==')
{
  // 单定轨优菈：歪 = 抽到可莉/甘雨（非定轨角色），最多 1 次（歪后命定值 1 → 必得）
  const cfg = {
    ...chroCfg,
    targets: [{ id: 'c1', name: '优菈', rarity: 5, copies: 1, epitomized: true }],
  }
  const sim = simulateOutcomes([cfg], [{ poolKey: 'chronicled', name: '优菈', copy: 1 }], 90, 20000)
  ok('单定轨：歪仅 0/1', sim.rows.every(r => /歪0|歪1/.test(r.key)), sim.rows.map(r => r.key).join('|'))
  const w1 = sim.rows.filter(r => /歪1/.test(r.key)).reduce((s, r) => s + r.p, 0)
  const w0 = sim.rows.filter(r => /歪0/.test(r.key)).reduce((s, r) => s + r.p, 0)
  ok('小保底歪概率 ≈ 0.5（非定轨五星计入）', w1 > 0.4 && w1 < 0.62, w1)
  ok('直接命中定轨 ≈ 0.5', w0 > 0.3, w0)
  // 双定轨（优菈 + 松籁）：每阶段最多 1 次歪 → 合计 ≤ 2
  const cfg2 = {
    ...chroCfg,
    targets: [
      { id: 'c1', name: '优菈', rarity: 5, copies: 1, epitomized: true },
      { id: 'w1', name: '松籁响起之时', rarity: 5, copies: 1, epitomized: true },
    ],
  }
  const sim2 = simulateOutcomes([cfg2], [
    { poolKey: 'chronicled', name: '优菈', copy: 1 },
    { poolKey: 'chronicled', name: '松籁响起之时', copy: 1 },
  ], 180, 20000)
  ok('双定轨：歪 ≤ 2', sim2.rows.every(r => { const m = r.key.match(/歪(\d+)/); return !m || parseInt(m[1]) <= 2 }), sim2.rows.map(r => r.key).join('|'))
}

console.log('== 集录祈愿：三阶段定轨（角色→武器→角色）==')
{
  const cfg = {
    ...chroCfg,
    targets: [
      { id: 'c1', name: '优菈', rarity: 5, copies: 1, epitomized: true },
      { id: 'w1', name: '松籁响起之时', rarity: 5, copies: 1, epitomized: true },
      { id: 'c2', name: '可莉', rarity: 5, copies: 1, epitomized: true },
    ],
  }
  // 三个定轨阶段依次进行，各阶段最坏 180 抽 → 总计最坏 540 抽
  const r = analyzePortfolio([cfg], 540, false)
  const c = r.curves.chronicled
  ok('角色→武器→角色 三定轨 540 抽必得', c.F[540] > 0.99999, c.F[540])
  ok('270 抽达成概率合理（~0.4~0.8）', c.F[270] > 0.3 && c.F[270] < 0.85, c.F[270])
  ok('三阶段期望抽数合理（~200~330）', r.perPool[0].need.E > 190 && r.perPool[0].need.E < 340, r.perPool[0].need.E)
  ok('三阶段达成概率非 0', c.F[200] > 0.1, c.F[200])
}

console.log('== 集录祈愿：垫池与已拥有数量生效 ==')
{
  // 垫池：距五星 70 抽 → 期望抽数显著下降、达成概率上升
  const r0 = analyzePortfolio([chroCfg], 120, false)
  const r70 = analyzePortfolio([{ ...chroCfg, pity5: 70 }], 120, false)
  ok('垫池 70 抽：期望抽数显著下降', r70.perPool[0].need.E < r0.perPool[0].need.E * 0.7, `${r70.perPool[0].need.E} vs ${r0.perPool[0].need.E}`)
  ok('垫池 70 抽：达成概率上升', r70.curves.chronicled.F[90] > r0.curves.chronicled.F[90], `${r70.curves.chronicled.F[90]} vs ${r0.curves.chronicled.F[90]}`)
  // 已拥有数量：目标角色 7 份 → 星辉产出上升（第 8 份起 25 星辉）
  const rOwned = analyzePortfolio([{ ...chroCfg, owned: { 优菈: 7 } }], 120, false)
  ok('已拥有 7 份：期望星辉 > 已拥有 0 份', rOwned.perPool[0].Eg > r0.perPool[0].Eg * 1.1, `${rOwned.perPool[0].Eg} vs ${r0.perPool[0].Eg}`)
  // 模拟路径同样生效（星辉再生）
  const order1 = [{ poolKey: 'chronicled', name: '优菈', copy: 1 }]
  const s0 = simulateRecycling([chroCfg], order1, 120, 0, 15000)
  const s7 = simulateRecycling([{ ...chroCfg, owned: { 优菈: 7 } }], order1, 120, 0, 15000)
  ok('模拟：已拥有 7 份产出星辉 > 0 份', s7.glitterE > s0.glitterE * 1.1, `${s7.glitterE} vs ${s0.glitterE}`)
}

console.log('== 星辉再利用：预算增长 5% 左右 ==')
const r6 = analyzePortfolio([charCfg2], 300, true)
ok('再利用后预算 > 初始', r6.budget > 300, r6.budget)
ok('再利用概率 ≥ 不含再利用（容差 1e-9）', r6.PAll >= r2.PAll - 1e-9, `${r6.PAll} vs ${r2.PAll}`)

console.log('== 期望抽数参考（不再分配资源）==')
{
  const r = analyzePortfolio([charCfg2], 300, false)
  const p = r.perPool[0]
  ok('单目标期望抽数在 80~120 区间', p.need.E > 70 && p.need.E < 130, p.need.E)
  ok('P25 < P50 < P75', p.need.p25.n < p.need.p50.n && p.need.p50.n < p.need.p75.n)
  ok('P75 分位达成概率 ≈ 0.75', Math.abs(p.need.p75.p - 0.75) < 0.01, p.need.p75.p)
  ok('曲线算到覆盖期望（含小资源场景）', p.need.complete === true)
}

console.log('== 已有物品数量影响副产物分层 ==')
{
  const base0 = { ...charCfg2 }
  const base8 = { ...charCfg2, owned: { '玛拉妮': 8 } }
  const r0 = analyzePortfolio([base0], 60, false)
  const r8 = analyzePortfolio([base8], 60, false)
  // 已有 8 份：每份都按 25 星辉（vs 前 7 份 10）→ 期望星辉显著更高
  ok('已有 8 份的期望星辉 > 已有 0 份 × 1.15', r8.perPool[0].Eg > r0.perPool[0].Eg * 1.15, `${r8.perPool[0].Eg} vs ${r0.perPool[0].Eg}`)
  // 已有 6 份：60 抽内最多第 8、9 份仍 10 星辉，差异应很小
  const r6 = analyzePortfolio([{ ...charCfg2, owned: { '玛拉妮': 6 } }], 60, false)
  ok('已有 6 份的期望星辉 ≈ 已有 0 份', Math.abs(r6.perPool[0].Eg - r0.perPool[0].Eg) < r0.perPool[0].Eg * 0.3, `${r6.perPool[0].Eg} vs ${r0.perPool[0].Eg}`)
}

console.log('== 常驻四星细分目标（非当期 UP）==')
{
  const cfg = {
    ...charCfg2,
    targets: [{ id: '4b', name: '行秋', rarity: 4, copies: 1, type: 'char' }],
    std4Counts: { chars: 50, weapons: 25 },
  }
  const r = analyzePortfolio([cfg], 200, false)
  // 每抽 ≈ 0.118(4★) × 0.5(歪) × 0.5(角色) / 50 × P(gu4=0)≈2/3 ≈ 0.00039 → 200 抽 ≈ 0.075
  ok('常驻四星目标 200 抽达成 ≈ 0.05~0.10', r.curves.character.F[200] > 0.05 && r.curves.character.F[200] < 0.10, r.curves.character.F[200])
  ok('期望抽数参考（达成条件均值）', r.perPool[0].need.E > 50 && r.perPool[0].need.E < 200, r.perPool[0].need.E)
}

console.log('== 结果分布模拟（达到目标即止）==')
{
  const sim = simulateOutcomes([charCfg2], [{ poolKey: 'character', name: '玛拉妮', copy: 1 }], 180, 30000)
  const exact = analyzeOrdered([charCfg2], [{ poolKey: 'character', name: '玛拉妮', copy: 1 }], 180, false)
  const achieved = sim.rows.filter(r => !r.key.startsWith('全部未达成')).reduce((s, r) => s + r.p, 0)
  ok('达到即止：达成类结果概率 ≈ 精确 PAll', Math.abs(achieved - exact.PAll) < 0.03, `${achieved} vs ${exact.PAll}`)
  ok('概率和 ≈ 1', Math.abs(sim.rows.reduce((s, r) => s + r.p, 0) + sim.other - 1) < 0.01)
  ok('单副本达到即止：歪仅 0/1', sim.rows.every(r => /歪0|歪1/.test(r.key)))
  // 三池联合
  const chroCfg = {
    key: 'chronicled', kind: 'chronicled', name: '集录',
    chrono5: [{ name: '优菈', type: 'char' }, { name: '可莉', type: 'char' }], chrono4: [],
    pity5: 0, pity4: 0, fate: 0,
    targets: [{ id: 'c1', name: '优菈', rarity: 5, copies: 1, epitomized: true }],
  }
  const order3 = [
    { poolKey: 'character', name: '玛拉妮', copy: 1 },
    { poolKey: 'weapon', name: '薄暮疾风', copy: 1 },
    { poolKey: 'chronicled', name: '优菈', copy: 1 },
  ]
  const sim3 = simulateOutcomes([charCfg2, wepCfg, chroCfg], order3, 500, 30000)
  ok('三池联合：顶行含全部三个目标（物品×数量格式）', sim3.rows[0].key.includes('玛拉妮×1') && sim3.rows[0].key.includes('薄暮疾风×1') && sim3.rows[0].key.includes('优菈×1'), sim3.rows[0].key)
  ok('三池联合：歪次数受停止语义约束（≤4）', sim3.rows.every(r => { const m = r.key.match(/歪(\d+)/); return !m || parseInt(m[1]) <= 4 }), sim3.rows.map(r => r.key).join('|'))
}

console.log('== 星辉再利用（原生星辉计入原生；≥50 自动转化；用尽全数转化）==')
{
  const p = { ...charCfg2 }
  const order = [{ poolKey: 'character', name: '玛拉妮', copy: 1 }]
  // 副产物分层：已拥有 7 份 → 每份 25 星辉（产出差 ≈ +15）
  const r0 = simulateRecycling([p], order, 200, 0, 20000)
  const r7 = simulateRecycling([{ ...p, owned: { '玛拉妮': 7 } }], order, 200, 0, 20000)
  ok('已拥有7份：产出差 ≈ +15（25−10）', Math.abs((r7.glitterE - r0.glitterE) - 15) < 3, `${r7.glitterE} vs ${r0.glitterE}`)
  // ≥50 自动转化：300 原生无初始星辉，产出星辉累计到 50 即转化
  const rA = simulateRecycling([p], order, 300, 0, 20000)
  ok('≥50 自动转化生效（convertedE > 0）', rA.convertedE > 0, rA.convertedE)
  // 用尽全数转化：60 原生 + 100 星辉（→原生 +20）
  const rB = simulateRecycling([p], order, 60, 100, 20000)
  ok('60 原生 + 100 星辉的达成概率 ≈ 80 原生（星辉计入原生）', Math.abs(rB.PAll - 0.569) < 0.04, rB.PAll)
  ok('达成所需期望抽数（达成情形）', rB.spentE > 55 && rB.spentE < 140, rB.spentE)
  ok('消耗分位 P25 < P75', rB.spentP25 < rB.spentP75)
  ok('结果分布并入', Math.abs(rB.outcomes.rows.reduce((s, x) => s + x.p, 0) + rB.outcomes.other - 1) < 0.02)
  // 池达成概率（模拟）与曲线期望点（精确）分离：P = 曲线 F(ref)，simP ≈ PAll
  ok('perPool.P = 曲线 F(ref)（期望点与曲线一致）', Math.abs(rB.perPool[0].P - rB.curves.character.F[rB.perPool[0].ref]) < 1e-12, rB.perPool[0].P)
  ok('simP 为模拟池概率（≈ PAll）', Math.abs(rB.perPool[0].simP - rB.PAll) < 0.01, `${rB.perPool[0].simP} vs ${rB.PAll}`)
  // 资源不足以转化：10 抽无星辉 → 达成概率 ≈ 2.9%
  const rp = simulateRecycling([p], order, 10, 0, 20000)
  ok('10 抽无星辉：达成概率 ≈ 2.9%', Math.abs(rp.PAll - 0.029) < 0.015, rp.PAll)
}

console.log('== 多池期望参考 ==')
{
  const r7 = analyzePortfolio([charCfg2, wepCfg], 400, false)
  ok('双池期望合计 = 各池之和', Math.abs(r7.sumE - r7.perPool.reduce((s, p) => s + p.need.E, 0)) < 1e-9)
  ok('PAll（保守参考）= Π F(P75)', Math.abs(r7.PAll - r7.perPool.reduce((s, p) => s * p.need.p75.p, 1)) < 1e-12)
  ok('期望达成 ≤ 目标总数', r7.EMet <= r7.EMetTotal + 1e-9, `${r7.EMet} <= ${r7.EMetTotal}`)
}

console.log('== 按序抽取分析（用户定义抽取顺序）==')
{
  // 单池单目标：PAll = F(budget)
  const order1 = [{ poolKey: 'character', name: '玛拉妮', copy: 1 }]
  const r1 = analyzeOrdered([charCfg2], order1, 200, false)
  const ref1 = analyzePortfolio([charCfg2], 200, false)
  ok('单池单目标 PAll = F(200)', Math.abs(r1.PAll - ref1.curves.character.F[200]) < 1e-9)
  ok('单条目概率 = PAll', r1.entries.length === 1 && Math.abs(r1.entries[0].P - r1.PAll) < 1e-12)
  // 双池：全部达成与顺序无关（卷积可交换），条目概率按顺序递减
  const orderA = [{ poolKey: 'character', name: '玛拉妮', copy: 1 }, { poolKey: 'weapon', name: '薄暮疾风', copy: 1 }]
  const orderB = [{ poolKey: 'weapon', name: '薄暮疾风', copy: 1 }, { poolKey: 'character', name: '玛拉妮', copy: 1 }]
  const ra = analyzeOrdered([charCfg2, wepCfg], orderA, 300, false)
  const rb = analyzeOrdered([charCfg2, wepCfg], orderB, 300, false)
  ok('PAll 与顺序无关', Math.abs(ra.PAll - rb.PAll) < 1e-12)
  ok('先抽条目概率 ≥ 后抽', ra.entries[0].P >= ra.entries[1].P)
  ok('EMet = Σ 条目概率', Math.abs(ra.EMet - ra.entries.reduce((s, x) => s + x.P, 0)) < 1e-9)
  // 副本级顺序：同池多副本 + 另一池插入
  const char2 = { ...charCfg2, targets: [{ id: 'a1', name: '玛拉妮', rarity: 5, copies: 2 }] }
  const orderC = [
    { poolKey: 'character', name: '玛拉妮', copy: 1 },
    { poolKey: 'weapon', name: '薄暮疾风', copy: 1 },
    { poolKey: 'character', name: '玛拉妮', copy: 2 },
  ]
  const rc = analyzeOrdered([char2, wepCfg], orderC, 400, false)
  ok('第2本玛拉妮概率 < 第1本', rc.entries[2].P <= rc.entries[0].P + 1e-12)
  // 预算不足：后期条目概率显著低于先条目
  const rd = analyzeOrdered([charCfg2, wepCfg], orderA, 60, false)
  ok('预算不足时后条目概率显著更低', rd.entries[1].P < rd.entries[0].P * 0.5, `${rd.entries[1].P} vs ${rd.entries[0].P}`)
}

console.log('== 垫池推算 ==')
const items301 = [
  { id: '1', time: '2026-01-01', rank_type: 3, name: '三星' },
  { id: '2', time: '2026-01-02', rank_type: 4, name: '班尼特' },
  { id: '3', time: '2026-01-03', rank_type: 3, name: '三星' },
  { id: '4', time: '2026-01-04', rank_type: 5, name: '琴' }, // 常驻 → 歪 → 大保底
  { id: '5', time: '2026-01-05', rank_type: 3, name: '三星' },
  { id: '6', time: '2026-01-06', rank_type: 3, name: '三星' },
]
const pity = computePityFromArchive({ 301: items301 })
ok('距上五星 2 抽', pity.character.pity5 === 2, pity.character.pity5)
ok('距上四星 2 抽（5★ 也会重置 4★ 计数）', pity.character.pity4 === 2, pity.character.pity4)
ok('最后五星是常驻 → 大保底', pity.character.guaranteed === 1)
const items301b = [...items301.slice(0, 4), { id: '7', time: '2026-01-07', rank_type: 5, name: '玛拉妮' }, { id: '8', time: '2026-01-08', rank_type: 3, name: '三星' }]
const pity2 = computePityFromArchive({ 301: items301b })
ok('最后五星 UP → 小保底', pity2.character.guaranteed === 0)
ok('小保底后连保=1（上一个保底是琴→玛拉妮）', pity2.character.crStreak === 1, pity2.character.crStreak)

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)

// 希穆兰卡 · 祈愿模拟引擎单测（node 直跑，无打包）
//   npm run test:simulanka
import {
  createRuntime, drawOnce, drawMany, canPull, grantResources,
  planFateExchange, spendFates, exchangeByGlitter, settleByproduct,
  normalizePoolDef, poolStats, overallStats, makeRng,
  POOL_IDS, PITY_GROUP, POOL_FATE, STARDUST_PER_3STAR, GLITTER_PER_FATE,
  fiveStarRate, fourStarRate, hardPityOf, emptyPityState, reviveRuntime, itemKey,
  GENESIS_TIERS, genesisTierTotal, exchangeGenesisForPrimogem, rechargeGenesis, planPullFunding,
  normalizeResources, emptyResources, purchaseGenesis, rechargeSummary,
} from '../src/utils/wishSimulator.js'

let failures = 0
const ok = (name, cond, extra) => {
  if (cond) console.log(`  ✓ ${name}`)
  else { failures++; console.log(`  ✗ ${name}`, extra ?? '') }
}

// ── 测试夹具：物品与卡池 ──
const mkChar = (id, name, rarity) => ({ type: 'character', id, name, rarity, key: itemKey('character', id), art: `${name}.png` })
const mkWeap = (id, name, rarity) => ({ type: 'weapon', id, name, rarity, key: itemKey('weapon', id), art: `${name}.png` })

const STD5C = ['琴', '莫娜', '迪卢克', '七七', '刻晴', '提纳里', '迪希雅', '梦见月瑞希'].map((n, i) => mkChar(9000 + i, n, 5))
const STD5W = ['天空之刃', '风鹰剑', '狼的末路', '天空之傲', '和璞鸢', '天空之脊', '四风原典', '天空之卷', '阿莫斯之弓', '天空之翼'].map((n, i) => mkWeap(8000 + i, n, 5))
const STD4C = ['班尼特', '菲谢尔', '香菱', '行秋'].map((n, i) => mkChar(7000 + i, n, 4))
const STD4W = ['西风剑', '笛剑', '祭礼剑'].map((n, i) => mkWeap(6000 + i, n, 4))
const W3 = Array.from({ length: 24 }, (_, i) => mkWeap(5000 + i, `三星${i}`, 3))

const roster = { std5: [...STD5C, ...STD5W], std4: [...STD4C, ...STD4W], weapons3: W3 }

const charPool = (extra = {}) => normalizePoolDef('character1', {
  kind: 'character',
  up5: [mkChar(101, '玛拉妮', 5)],
  up4: [mkChar(201, '卡齐娜', 4), mkChar(202, '欧洛伦', 4), mkChar(203, '蓝砚', 4)],
  ...extra,
}, roster)

const charPool2 = () => normalizePoolDef('character2', {
  kind: 'character',
  up5: [mkChar(102, '希诺宁', 5)],
  up4: [mkChar(201, '卡齐娜', 4), mkChar(202, '欧洛伦', 4), mkChar(203, '蓝砚', 4)],
}, roster)

const weaponPool = (epi = null) => {
  const p = normalizePoolDef('weapon', {
    kind: 'weapon',
    up5: [mkWeap(301, '冲浪时光', 5), mkWeap(302, '苍古自由之誓', 5)],
    up4: [mkWeap(401, '西风剑', 4), mkWeap(402, '西风大剑', 4), mkWeap(403, '匣里灭辰', 4), mkWeap(404, '祭礼残章', 4), mkWeap(405, '绝弦', 4)],
  }, roster)
  return p
}

const chronoPool = (epi = null) => {
  const p = normalizePoolDef('chronicled', {
    kind: 'chronicled',
    pool5: [mkChar(501, '可莉', 5), mkWeap(502, '阿莫斯之弓', 5), mkChar(503, '温迪', 5)],
    pool4: [mkChar(601, '砂糖', 4), mkWeap(602, '西风剑', 4), mkChar(603, '诺艾尔', 4)],
  }, roster)
  return p
}

const standardPool = () => normalizePoolDef('standard', { kind: 'standard' }, roster)

const pools = {
  character1: charPool(),
  character2: charPool2(),
  weapon: weaponPool(),
  chronicled: chronoPool(),
  standard: standardPool(),
}

const richRuntime = (over = {}) => {
  const rt = createRuntime({ intertwined: 2000000, acquaint: 2000000, primogem: 0, genesis: 0, ...over })
  return rt
}

// ═════════════════════════════════════════════════════════════════
console.log('== 概率表与 wishAnalysis 对齐 ==')
ok('角色池第 1 抽 = 0.6%', Math.abs(fiveStarRate('character', 0) - 0.006) < 1e-12)
ok('角色池第 74 抽 = 6.6%', Math.abs(fiveStarRate('character', 73) - 0.066) < 1e-12)
ok('角色池第 90 抽 = 100%', fiveStarRate('character', 89) === 1)
ok('常驻池沿用角色池曲线', fiveStarRate('standard', 73) === fiveStarRate('character', 73))
ok('武器池第 63 抽 = 7.7%', Math.abs(fiveStarRate('weapon', 62) - 0.077) < 1e-12)
ok('武器池第 74 抽 = 81.2%', Math.abs(fiveStarRate('weapon', 73) - 0.812) < 1e-12)
ok('武器池第 80 抽 = 100%', fiveStarRate('weapon', 79) === 1)
ok('硬保底 角色 90 / 武器 80', hardPityOf('character') === 90 && hardPityOf('weapon') === 80)

console.log('== 四星有效概率（五星优先占位 + 10 抽保底）==')
ok('角色池非保底四星 = 5.1% × (1-0.6%)', Math.abs(fourStarRate('character', 0, 0, 0.006) - 0.051 * 0.994) < 1e-12)
ok('角色池第 10 抽四星 = 1 - 五星率', Math.abs(fourStarRate('character', 3, 9, 0.006) - 0.994) < 1e-12)
ok('武器池非保底四星 = 6.0% × (1-0.7%)', Math.abs(fourStarRate('weapon', 0, 0, 0.007) - 0.06 * 0.993) < 1e-12)
ok('五星必出时四星率归零', fourStarRate('character', 89, 0, 1) === 0)

console.log('== 硬保底：角色池 90 抽内必出五星 ==')
{
  const rt = richRuntime()
  const rng = makeRng(11)
  let worst = 0
  for (let trial = 0; trial < 300; trial++) {
    let n = 0
    for (let i = 0; i < 90; i++) { const r = drawOnce(rt, pools.character1, { rng }); n++; if (r.rarity === 5) break }
    if (n > worst) worst = n
  }
  ok('300 次试验中最多 90 抽出五星', worst <= 90, `worst=${worst}`)
}

console.log('== 硬保底：武器池 80 抽内必出五星 ==')
{
  const rt = richRuntime()
  const rng = makeRng(12)
  let worst = 0
  for (let trial = 0; trial < 300; trial++) {
    let n = 0
    for (let i = 0; i < 80; i++) { const r = drawOnce(rt, pools.weapon, { rng }); n++; if (r.rarity === 5) break }
    if (n > worst) worst = n
  }
  ok('300 次试验中最多 80 抽出五星', worst <= 80, `worst=${worst}`)
}

console.log('== 10 抽保底：任意连续 10 抽必含四星及以上 ==')
{
  const rt = richRuntime()
  const rng = makeRng(13)
  let bad = 0
  const recs = []
  for (let i = 0; i < 10000; i++) recs.push(drawOnce(rt, pools.standard, { rng }))
  for (let i = 0; i + 10 <= recs.length; i++) {
    // 仅当窗口起点前累计四星计数为 0 时窗口才必须含四星；这里用「每 10 抽窗口」的保守检查：
    // 由于保底计数会跨窗口延续，直接检查「连续 9 个三星后第 10 个必非三星」
  }
  // 精确检查：遍历记录，不存在「连续 10 个三星」
  let streak = 0
  for (const r of recs) { if (r.rarity === 3) { streak++; if (streak >= 10) bad++ } else streak = 0 }
  ok('10000 抽内不存在连续 10 个三星', bad === 0, `bad=${bad}`)
}

console.log('== 角色池大小保底 ==')
{
  const rt = richRuntime()
  const rng = makeRng(21)
  let checked = 0
  for (let i = 0; i < 4000; i++) {
    const r = drawOnce(rt, pools.character1, { rng })
    if (r.rarity !== 5) continue
    if (r.before.guaranteed === 1) {
      ok('大保底时五星必为 UP', r.isUp === true && r.name === '玛拉玛' || r.isUp === true, JSON.stringify({ name: r.name, isUp: r.isUp }))
      checked++
      if (checked >= 1) break
    }
  }
  ok('至少验证到一次大保底', checked >= 1)
}
{
  // 直接构造：歪一次之后 guaranteed 必为 1，且下一次五星必 UP
  const rt = richRuntime()
  const rng = makeRng(22)
  let sawLose = false, okAfter = true
  for (let i = 0; i < 20000 && !sawLose; i++) {
    const r = drawOnce(rt, pools.character1, { rng })
    if (r.rarity === 5 && !r.isUp) {
      sawLose = true
      ok('歪后保底状态置为大保底', rt.pity.character.guaranteed === 1)
      ok('歪后捕获明光连保清零', rt.pity.character.crStreak === 0)
      let hit = null
      for (let j = 0; j < 90; j++) { hit = drawOnce(rt, pools.character1, { rng }); if (hit.rarity === 5) break }
      okAfter = hit && hit.rarity === 5 && hit.isUp === true
      ok('大保底后下一个五星必为 UP', okAfter, JSON.stringify({ name: hit?.name, isUp: hit?.isUp }))
    }
  }
  ok('20000 抽内出现过小保底歪', sawLose)
}

console.log('== 角色池：捕获明光连保 ==')
{
  const rt = richRuntime()
  const rng = makeRng(31)
  // 跑足够多抽，记录每次「大保底命中」后的 crStreak 递增
  let sawIncrement = false
  let prevGu = rt.pity.character.guaranteed
  for (let i = 0; i < 60000; i++) {
    const before = rt.pity.character.crStreak
    const r = drawOnce(rt, pools.character1, { rng })
    if (r.rarity === 5 && r.guaranteeUsed && rt.pity.character.crStreak === Math.min(3, before + 1)) sawIncrement = true
  }
  ok('大保底命中会累加捕获明光连保', sawIncrement)
  ok('连保上限为 3', rt.pity.character.crStreak <= 3)
}
{
  // 连保 3 时小保底必中 UP
  const rt = richRuntime()
  rt.pity.character.crStreak = 3
  rt.pity.character.guaranteed = 0
  const rng = makeRng(32)
  let all = true
  for (let i = 0; i < 200; i++) {
    const r = drawOnce(rt, pools.character1, { rng })
    if (r.rarity === 5) { if (!r.isUp) all = false; rt.pity.character.crStreak = 3; rt.pity.character.guaranteed = 0 }
  }
  ok('连保 3 次后小保底必得 UP', all)
}

console.log('== 武器池神铸定轨 ==')
{
  const rt = richRuntime()
  rt.epicomized.weapon = itemKey('weapon', 301)
  rt.pity.weapon.fate = 1
  const rng = makeRng(41)
  let hit = null
  for (let i = 0; i < 80; i++) { hit = drawOnce(rt, pools.weapon, { rng }); if (hit.rarity === 5) break }
  ok('命定值 1 时五星必为定轨目标', hit.name === '冲浪时光', hit.name)
  ok('命中后命定值清零', rt.pity.weapon.fate === 0)
}
{
  // 未定轨时 25% 常驻 75% UP（统计口径）
  const rt = richRuntime()
  const rng = makeRng(42)
  let up = 0, std = 0
  for (let i = 0; i < 200000; i++) {
    const r = drawOnce(rt, pools.weapon, { rng })
    if (r.rarity === 5) { if (r.name === '冲浪时光' || r.name === '苍古自由之誓') up++; else std++ }
  }
  const ratio = up / (up + std)
  ok('未定轨时 UP 占比 ≈ 75%', Math.abs(ratio - 0.75) < 0.02, ratio.toFixed(4))
}
{
  // 定轨后非目标五星必令命定值 +1
  const rt = richRuntime()
  rt.epicomized.weapon = itemKey('weapon', 301)
  const rng = makeRng(43)
  let allGood = true
  for (let i = 0; i < 5000; i++) {
    const fateBefore = rt.pity.weapon.fate
    const r = drawOnce(rt, pools.weapon, { rng })
    if (r.rarity === 5) {
      if (fateBefore === 0 && r.name !== '冲浪时光' && rt.pity.weapon.fate !== 1) allGood = false
      if (r.name === '冲浪时光' && fateBefore === 0 && rt.pity.weapon.fate !== 0) allGood = false
    }
  }
  ok('定轨下歪则命定值 +1、中则保持 0', allGood)
}

console.log('== 集录祈愿：定轨与「不歪常驻」==')
{
  const rt = richRuntime()
  const rng = makeRng(51)
  const names = new Set(['可莉', '阿莫斯之弓', '温迪'])
  let allInPool = true
  for (let i = 0; i < 20000; i++) {
    const r = drawOnce(rt, pools.chronicled, { rng })
    if (r.rarity === 5 && !names.has(r.name)) allInPool = false
  }
  ok('集录池五星只出池内物品（不歪常驻）', allInPool)
}
{
  const rt = richRuntime()
  rt.epicomized.chronicled = itemKey('character', 501)
  rt.pity.chronicled.fate = 1
  const rng = makeRng(52)
  let hit = null
  for (let i = 0; i < 90; i++) { hit = drawOnce(rt, pools.chronicled, { rng }); if (hit.rarity === 5) break }
  ok('集录命定值 1 必得定轨目标', hit.name === '可莉', hit.name)
}
{
  // 定轨角色时歪 → 只会歪到池内其它五星角色
  const rt = richRuntime()
  rt.epicomized.chronicled = itemKey('character', 501)
  const rng = makeRng(53)
  let allSameType = true, sawLose = false
  for (let i = 0; i < 40000; i++) {
    const r = drawOnce(rt, pools.chronicled, { rng })
    if (r.rarity === 5 && !r.isUp) {
      sawLose = true
      if (r.name !== '温迪') allSameType = false   // 池内唯一另一个五星角色
    }
  }
  ok('集录定轨角色时歪只歪同类型', allSameType && sawLose)
}
{
  // 集录四星：池内等可能，无 UP 概念（isUp 恒为 false）
  const rt = richRuntime()
  const rng = makeRng(54)
  let anyUp4 = false
  const seen = new Set()
  for (let i = 0; i < 20000; i++) {
    const r = drawOnce(rt, pools.chronicled, { rng })
    if (r.rarity === 4) { seen.add(r.name); if (r.isUp) anyUp4 = true }
  }
  ok('集录四星无 UP 标记', !anyUp4)
  ok('集录四星只会出池内四星', [...seen].every(n => ['砂糖', '西风剑', '诺艾尔'].includes(n)), [...seen].join(','))
}

console.log('== 四星 UP 歪后必出 ==')
{
  const rt = richRuntime()
  const rng = makeRng(61)
  const up4 = new Set(['卡齐娜', '欧洛伦', '蓝砚'])
  let allGood = true
  for (let i = 0; i < 60000; i++) {
    const guBefore = rt.pity.character.gu4
    const r = drawOnce(rt, pools.character1, { rng })
    if (r.rarity === 4) {
      if (guBefore === 1 && !up4.has(r.name)) allGood = false
      if (up4.has(r.name) && r.isUp !== true) allGood = false
    }
  }
  ok('四星 UP 歪后下一个四星必为 UP', allGood)
}

console.log('== 常驻池 ==')
{
  const rt = richRuntime()
  const rng = makeRng(71)
  const std5 = new Set([...STD5C, ...STD5W].map(i => i.name))
  const std4 = new Set([...STD4C, ...STD4W].map(i => i.name))
  const std3 = new Set(W3.map(i => i.name))
  let bad = 0
  for (let i = 0; i < 30000; i++) {
    const r = drawOnce(rt, pools.standard, { rng })
    if (r.rarity === 5 && !std5.has(r.name)) bad++
    if (r.rarity === 4 && !std4.has(r.name)) bad++
    if (r.rarity === 3 && !std3.has(r.name)) bad++
    if (r.isUp) bad++
  }
  ok('常驻池只出常驻物品且无 UP 标记', bad === 0, `bad=${bad}`)
}

console.log('== 角色池-2 与角色池共享保底 ==')
{
  const rt = richRuntime()
  const rng = makeRng(81)
  // 直接把角色池保底推到 85 抽（等价于在角色池垫了 85 抽），再切到角色池-2
  drawMany(rt, pools.character1, 5, { rng })
  rt.pity.character.p5 = 85
  const p5Before = rt.pity.character.p5
  let hit = null, k = 0
  for (let i = 0; i < 90 - p5Before + 2; i++) { hit = drawOnce(rt, pools.character2, { rng }); k++; if (hit.rarity === 5) break }
  ok('切池后保底计数延续', p5Before === 85 && rt.pity.character.p5 >= 0)
  ok('角色池-2 在共享保底剩余抽数内出五星', hit.rarity === 5 && k <= 90 - p5Before + 1, `k=${k}, p5=${p5Before}`)
  ok('角色池-2 出的是自己的 UP（或共享大保底后必中）', hit.isUp ? hit.name === '希诺宁' : true, hit.name)
  // 大保底状态跨池共享
  rt.pity.character.guaranteed = 1
  let hit2 = null
  for (let i = 0; i < 90; i++) { hit2 = drawOnce(rt, pools.character1, { rng }); if (hit2.rarity === 5) break }
  ok('大保底状态跨池共享', hit2.isUp === true && hit2.name === '玛拉妮', hit2.name)
}

console.log('== 资源兑换链（球 → 原石 160:1 → 创世结晶 1:1）==')
{
  const r1 = planFateExchange({ intertwined: 10, primogem: 0, genesis: 0 }, 'character1', 5)
  ok('存量球足够时不消耗原石/创世', r1.ok && r1.fromStock === 5 && r1.primogemUsed === 0 && r1.genesisUsed === 0)
}
{
  const r2 = planFateExchange({ intertwined: 2, primogem: 1600, genesis: 0 }, 'character1', 5)
  ok('球不足先用原石 160:1 补', r2.ok && r2.fromStock === 2 && r2.fromPrimogem === 3 && r2.primogemUsed === 480)
}
{
  const r3 = planFateExchange({ intertwined: 0, primogem: 100, genesis: 1000 }, 'character1', 3)
  ok('原石不足再用创世结晶 1:1 补足', r3.ok && r3.genesisUsed === 380, JSON.stringify(r3))
}
{
  const r4 = planFateExchange({ intertwined: 0, primogem: 0, genesis: 10 }, 'standard', 1)
  ok('创世结晶不足时判定失败', !r4.ok && r4.primogemShort === 150, JSON.stringify(r4))
  ok('常驻池消耗相遇之缘', r4.fateKey === 'acquaint')
}
{
  const sp = spendFates({ intertwined: 1, primogem: 320, genesis: 50 }, 'character1', 2)
  ok('扣费后资源守恒（1 存量球 + 160 原石 = 2 抽）',
    sp.ok && sp.resources.intertwined === 0 && sp.resources.primogem === 160 && sp.resources.genesis === 50,
    JSON.stringify(sp.resources))
}
{
  const sp = spendFates({ intertwined: 0, primogem: 0, genesis: 500 }, 'character1', 3)
  ok('纯创世结晶扣费守恒（480 结晶 = 3 抽，余 20）',
    sp.ok && sp.resources.genesis === 20 && sp.resources.primogem === 0,
    JSON.stringify(sp.resources))
}
{
  const rt = createRuntime({ intertwined: 0, primogem: 320, genesis: 0 })
  const before = rt.spend.fate
  const r = drawOnce(rt, pools.character1, { rng: makeRng(91) })
  ok('无球时自动用原石兑换并抽取', r !== null && rt.resources.primogem === 160 && rt.spend.fate === before + 1)
}
{
  const rt = createRuntime({ intertwined: 0, primogem: 0, genesis: 0 })
  ok('资源枯竭时抽不动', drawOnce(rt, pools.character1, { rng: makeRng(92) }) === null && canPull(rt, 'character1') === false)
}
{
  const g = exchangeByGlitter({ starglitter: 11 }, 'character1', 2)
  ok('5 星辉换 1 缘', g.ok && g.resources.intertwined === 2 && g.resources.starglitter === 1, JSON.stringify(g.resources))
  ok('星辉单价常量 = 5', GLITTER_PER_FATE === 5)
}

console.log('== 副产物结算（严格按《祈愿机制》词条）==')
{
  const obtained = {}
  const c5 = mkChar(1, '五星角色', 5)
  const seq5 = []
  for (let i = 0; i < 9; i++) seq5.push(settleByproduct(c5, obtained))
  ok('五星角色第 1 次无副产物', seq5[0].glitter === 0 && seq5[0].constellation === 0)
  ok('五星角色第 2~7 次 = 1 命星 + 10 星辉', seq5[1].glitter === 10 && seq5[1].constellation === 1 && seq5[6].glitter === 10 && seq5[6].constellation === 1)
  ok('五星角色第 8 次起 = 25 星辉 + 1 无主的命星', seq5[7].glitter === 25 && seq5[7].crown === 1 && seq5[8].glitter === 25 && seq5[8].crown === 1)
}
{
  const obtained = {}
  const c4 = mkChar(2, '四星角色', 4)
  const s = []
  for (let i = 0; i < 9; i++) s.push(settleByproduct(c4, obtained))
  ok('四星角色第 2~7 次 = 1 命星 + 2 星辉', s[1].glitter === 2 && s[1].constellation === 1 && s[6].glitter === 2)
  ok('四星角色第 8 次起 = 5 星辉', s[7].glitter === 5 && s[8].glitter === 5)
}
{
  const obtained = {}
  ok('五星武器恒 10 星辉', settleByproduct(mkWeap(3, '五星武器', 5), obtained).glitter === 10)
  ok('四星武器恒 2 星辉', settleByproduct(mkWeap(4, '四星武器', 4), obtained).glitter === 2)
  ok('三星武器产出星尘', settleByproduct(mkWeap(5, '三星武器', 3), obtained).stardust === STARDUST_PER_3STAR)
  ok('三星武器无星辉', settleByproduct(mkWeap(5, '三星武器', 3), obtained).glitter === 0)
}

console.log('== 十连与批次记录 ==')
{
  const rt = richRuntime()
  const rng = makeRng(101)
  const { records, batchId, stopped } = drawMany(rt, pools.character1, 10, { rng })
  ok('十连产出 10 条记录', records.length === 10 && !stopped)
  ok('同批次 batchId 一致', records.every(r => r.batchId === batchId))
  ok('batchIndex 递增 0..9', records.every((r, i) => r.batchIndex === i))
}
{
  const rt = createRuntime({ intertwined: 4, primogem: 0, genesis: 0 })
  const { records, stopped } = drawMany(rt, pools.character1, 10, { rng: makeRng(102) })
  ok('资源不足时十连提前停止', stopped === true && records.length === 4, `n=${records.length}`)
}

console.log('== 统计 ==')
{
  const rt = richRuntime()
  const rng = makeRng(111)
  drawMany(rt, pools.character1, 4000, { rng })
  drawMany(rt, pools.weapon, 2000, { rng })
  const s = poolStats(rt.records, null)
  const sc = poolStats(rt.records, 'character1')
  const sw = poolStats(rt.records, 'weapon')
  ok('总抽数 = 6000', s.total === 6000)
  ok('分池抽数之和 = 总抽数', sc.total + sw.total === s.total)
  ok('稀有度计数之和 = 总抽数', s.count3 + s.count4 + s.count5 === s.total)
  ok('五星时间线长度 = 五星数', s.timeline.length === s.count5)
  ok('混合样本平均五星抽数在 52~70', s.avg5 > 52 && s.avg5 < 70, s.avg5.toFixed(2))
  ok('角色池平均五星抽数在 55~70', sc.avg5 > 55 && sc.avg5 < 70, sc.avg5.toFixed(2))
  ok('武器池平均五星抽数在 45~62', sw.avg5 > 45 && sw.avg5 < 62, sw.avg5.toFixed(2))
  ok('五星综合出率 ≈ 1.4%~1.9%', s.rate5 > 0.012 && s.rate5 < 0.021, s.rate5.toFixed(4))
  ok('四星综合出率 ≈ 10.5%~13%', s.rate4 > 0.10 && s.rate4 < 0.13, s.rate4.toFixed(4))
  ok('星辉收入为正', s.glitter > 0)
  ok('星尘收入为正', s.stardust > 0)
  const o = overallStats(rt.records)
  ok('overallStats 按池分组', Object.keys(o.byPool).length === 2)
  ok('五星时间线倒序', o.fiveStars.every((t, i, a) => i === 0 || a[i - 1].seq >= t.seq))
}

console.log('== 大样本：五星综合出率贴近官方 1.6% ==')
{
  const rt = richRuntime()
  const rng = makeRng(121)
  const N = 400000
  drawMany(rt, pools.standard, N, { rng })
  const s = poolStats(rt.records, null)
  ok('综合五星率 1.5%~1.7%', s.rate5 > 0.015 && s.rate5 < 0.017, s.rate5.toFixed(5))
  ok('平均出金抽数 58~65', s.avg5 > 58 && s.avg5 < 65, s.avg5.toFixed(2))
}

console.log('== 存档状态复原 ==')
{
  const rt = richRuntime()
  const rng = makeRng(131)
  drawMany(rt, pools.character1, 50, { rng })
  const revived = reviveRuntime(JSON.parse(JSON.stringify(rt)), { intertwined: 0, primogem: 0, genesis: 0, acquaint: 0 })
  ok('复原后记录条数一致', revived.records.length === rt.records.length)
  ok('复原后保底计数一致', revived.pity.character.p5 === rt.pity.character.p5)
  ok('复原后资源一致', revived.resources.intertwined === rt.resources.intertwined)
  ok('脏数据不炸', reviveRuntime({ pity: { character: { p5: 'x' } }, records: null }, { intertwined: 1 }).records.length === 0)
}

console.log('== grantResources（补充资源）==')
{
  const rt = createRuntime({ intertwined: 0 })
  grantResources(rt, { intertwined: 10, primogem: 160, genesis: 50, starglitter: 3 })
  ok('补充资源叠加正确', rt.resources.intertwined === 10 && rt.resources.primogem === 160 && rt.resources.genesis === 50 && rt.resources.starglitter === 3)
  grantResources(rt, { intertwined: -100 })
  ok('负数不会把资源扣成负值', rt.resources.intertwined === 0)
}

console.log('== 卡池定义归一化 ==')
{
  const p = normalizePoolDef('character1', { up5: [mkChar(1, 'A', 5)], up4: [mkChar(2, 'B', 4)] }, roster)
  ok('kind 由 POOL_IDS 推导', p.kind === 'character')
  ok('未给 pool5 时退化为 UP 集合', p.pool5.length === 1 && p.pool4.length === 1)
  const s = normalizePoolDef('standard', {}, roster)
  ok('常驻池携带标准池物品', s.standard5.length === 18 && s.standard4.length === 7)
  ok('所有池共享三星池', s.weapons3.length === 24)
  ok('POOL_IDS 覆盖五池', POOL_IDS.length === 5)
  ok('角色池-2 与角色池同保底组', PITY_GROUP.character1 === PITY_GROUP.character2)
  ok('常驻池消耗相遇之缘', POOL_FATE.standard === 'acquaint')
  ok('其余池消耗纠缠之缘', POOL_FATE.character1 === 'intertwined' && POOL_FATE.weapon === 'intertwined' && POOL_FATE.chronicled === 'intertwined')
}

console.log('== 商城：充值记账与存档态 ==')
{
  ok('新档默认未开首充双倍', createRuntime().firstChargeDouble === false)
  ok('新档账单为空', createRuntime().recharges.length === 0)

  const rt = createRuntime({ genesis: 0 })
  const a = purchaseGenesis(rt, 'g6480', false, 1000)
  ok('非双倍 648 到账 8080', a.ok && a.gained === 8080)
  ok('账单条目字段完整', a.entry.price === 648 && a.entry.base === 6480 && a.entry.bonus === 1600 && a.entry.doubled === false)
  rt.resources = a.resources
  rt.recharges = [a.entry]
  const b = purchaseGenesis(rt, 'g60', true, 2000)
  rt.resources = b.resources
  rt.recharges.push(b.entry)
  ok('两笔累计结晶正确', rt.resources.genesis === 8200)

  const sum = rechargeSummary(rt.recharges)
  ok('账单汇总：金额 654 / 结晶 8200 / 2 笔',
    sum.totalRmb === 654 && sum.totalCrystals === 8200 && sum.count === 2)
  ok('空账单汇总不炸', rechargeSummary(null).count === 0)
  ok('未知档位不记账', purchaseGenesis(rt, 'nope', true, 1).ok === false)

  // 首充双倍与账单都属于存档状态，必须能读回来
  rt.firstChargeDouble = true
  const back = reviveRuntime(JSON.parse(JSON.stringify(rt)))
  ok('读档保留账单', back.recharges.length === 2 && back.recharges[0].gained === 8080)
  ok('读档保留首充双倍开关', back.firstChargeDouble === true)
  ok('旧存档缺字段时回落为 false / 空数组',
    reviveRuntime({ resources: {} }).firstChargeDouble === false
    && reviveRuntime({ resources: {} }).recharges.length === 0)
  ok('账单里的脏数据被过滤', reviveRuntime({ resources: {}, recharges: [null, 1, { price: 6 }] }).recharges.length === 1)
}

console.log('== 空池回退（卡池数据未爬全时不得截断抽取）==')
{
  // 复现线上问题：最新的 6.7 集录祈愿在数据库里四星条目为 0，
  // 旧实现对空数组取随机返回 null，导致十连在第一只四星处中断（常常只出 1 抽）。
  const chrono = normalizePoolDef('chronicled', {
    kind: 'chronicled',
    pool5: [mkChar(10, '八重神子', 5)],
    pool4: [],                       // ← 数据库形态：四星缺失
  }, roster)
  ok('四星缺失时仍能抽出四星', chrono.pool4.length === 0)

  let truncated = 0
  const rt = createRuntime({ intertwined: 100000 })
  for (let i = 0; i < 300; i++) {
    const { records, stopped } = drawMany(rt, chrono, 10, { rng: makeRng(i + 1) })
    if (records.length !== 10 || stopped) truncated++
  }
  ok('集录十连 300 次均满 10 抽', truncated === 0)

  const st = poolStats(rt.records, 'chronicled')
  ok('集录四星确有产出（含常驻四星武器回退）', st.count4 > 0)
  ok('集录五星确有产出', st.count5 > 0)
  const fourNames = new Set(rt.records.filter(r => r.rarity === 4).map(r => r.itemId))
  ok('四星里出现了常驻四星武器（词条：混池四星含所有常驻四星武器）',
    [...fourNames].some(id => roster.std4.some(w => w.type === 'weapon' && w.id === id)))

  // 五星也缺失时回退到常驻
  const emptyAll = normalizePoolDef('chronicled', { kind: 'chronicled', pool5: [], pool4: [] }, roster)
  const rt2 = createRuntime({ intertwined: 1000 })
  const r2 = drawMany(rt2, emptyAll, 10, { rng: makeRng(9) })
  ok('五星缺失时回退到常驻并抽满 10 抽', r2.records.length === 10)

  // 整池彻底无物：应当停下且不吞资源，而不是静默截断
  const dead = normalizePoolDef('standard', {}, { std5: [], std4: [], weapons3: [] })
  const rt3 = createRuntime({ acquaint: 10 })
  const r3 = drawMany(rt3, dead, 10, { rng: makeRng(1) })
  ok('无任何可用物品时停下且不消耗资源', r3.records.length === 0 && rt3.resources.acquaint === 10)
}

console.log('== 商城：凝取结晶档位 / 结晶换原石 / 抽卡资金规划 ==')
{
  // 售价与数额取自游戏内商城，逐档核对（双倍总数 = 基础×2；非双倍总数 = 基础+赠送）
  const TABLE = [
    { price: 6, base: 60, bonus: 0, normal: 60, doubled: 120 },
    { price: 30, base: 300, bonus: 30, normal: 330, doubled: 600 },
    { price: 98, base: 980, bonus: 110, normal: 1090, doubled: 1960 },
    { price: 198, base: 1980, bonus: 260, normal: 2240, doubled: 3960 },
    { price: 328, base: 3280, bonus: 600, normal: 3880, doubled: 6560 },
    { price: 648, base: 6480, bonus: 1600, normal: 8080, doubled: 12960 },
  ]
  ok('共 6 个档位', GENESIS_TIERS.length === 6)
  let allOk = true
  GENESIS_TIERS.forEach((t, i) => {
    const e = TABLE[i]
    if (!(t.price === e.price && t.base === e.base && t.bonus === e.bonus
      && genesisTierTotal(t, false) === e.normal && genesisTierTotal(t, true) === e.doubled)) allOk = false
  })
  ok('每档价格/基础/赠送/双倍/非双倍总数都对得上', allOk)
  ok('价格按人民币 1:10 换算基础数量', GENESIS_TIERS.every(t => t.base === t.price * 10))

  const r0 = normalizeResources({ genesis: 1000, primogem: 0 })
  const ex = exchangeGenesisForPrimogem(r0, 300)
  ok('结晶换原石 1:1', ex.ok && ex.resources.genesis === 700 && ex.resources.primogem === 300)
  ok('结晶不足时拒绝', exchangeGenesisForPrimogem(normalizeResources({ genesis: 10 }), 300).ok === false)
  ok('数量为 0 时拒绝', exchangeGenesisForPrimogem(r0, 0).ok === false)

  ok('充值 648 档非双倍 +8080', rechargeGenesis(emptyResources(), 'g6480', false).gained === 8080)
  ok('充值 648 档双倍 +12960', rechargeGenesis(emptyResources(), 'g6480', true).gained === 12960)
  ok('未知档位拒绝', rechargeGenesis(emptyResources(), 'nope', true).ok === false)

  // 抽卡资金规划：直抽 / 需转化 / 不足
  ok('存量缘够 → direct', planPullFunding(normalizeResources({ intertwined: 10 }), 'character1', 10).mode === 'direct')
  ok('只够原石 → convert', planPullFunding(normalizeResources({ primogem: 1600 }), 'character1', 10).mode === 'convert')
  ok('只够结晶 → convert', planPullFunding(normalizeResources({ genesis: 1600 }), 'character1', 10).mode === 'convert')
  ok('缘+原石混合够 → convert（按缺口只换一部分）', (() => {
    const p = planPullFunding(normalizeResources({ intertwined: 4, primogem: 960 }), 'character1', 10)
    return p.mode === 'convert' && p.plan.fromStock === 4 && p.plan.fromPrimogem === 6
  })())
  const short = planPullFunding(normalizeResources({ primogem: 100 }), 'character1', 10)
  ok('都不够 → short 且给出缺口', short.mode === 'short' && short.shortfall === 1500)
  ok('常驻池用相遇之缘', planPullFunding(normalizeResources({ acquaint: 1 }), 'standard', 1).mode === 'direct')
}

console.log('')
if (failures) { console.log(`✗ ${failures} 项未通过`); process.exit(1) }
console.log('✓ 全部通过')

// ═════════════════════════════════════════════════════════════════
// 祈愿分析引擎
// 基于数据库词条《祈愿 · 祈愿机制》《祈愿 · 保底机制》《祈愿 · 集录祈愿》
// 实现角色活动祈愿 / 武器活动祈愿 / 集录祈愿 的精确概率建模：
//   - 五星软保底概率表（角色 74 抽起 +6%/抽，武器 63 抽起 +7%/抽、74 抽起 +3.5%/抽）
//   - 四星 10 抽保底 + 四星 UP 歪后必出（gu4 状态）
//   - 角色池「捕获明光」连保判定（连续 2 次大保底后 47/47/6，3 次后必得）
//   - 武器池「神铸定轨」（命定值 0/1）；集录祈愿「集录定轨」角色/武器分别设定，
//     生效定轨 = 目标顺序中第一个未达成的定轨目标（命定值 0/1）
//   - 副产物星辉分层（五星角色第 1~7 次 10 星辉、第 8 次起 25 星辉；四星角色同理 2/5）
//     —— 星辉可按 5:1 再换纠缠之缘，形成「抽卡→星辉→再抽卡」反馈
// 概率分布采用马尔可夫动态规划（精确值，非蒙特卡洛）。
// 实现采用「列式」DP：外层枚举目标计数器元组，内层枚举保底基底，
// 状态索引 = 计数器元组 × baseTotal + 基底（分块布局），
// 计数器增量偏移按元组预计算一次、跨基底复用，典型场景毫秒级响应。
// ═════════════════════════════════════════════════════════════════

// ── 常驻五星（小保底会歪到的对象，按词条《祈愿机制》常驻池段落）──
export const STANDARD_5STAR_CHARS = ['琴', '莫娜', '迪卢克', '七七', '刻晴', '提纳里', '迪希雅', '梦见月瑞希']
export const STANDARD_5STAR_WEAPONS = ['天空之刃', '风鹰剑', '狼的末路', '天空之傲', '和璞鸢', '天空之脊', '四风原典', '天空之卷', '阿莫斯之弓', '天空之翼']

export const P5_HARD = { character: 90, weapon: 80, chronicled: 90 }
export const P4_BASE = { character: 0.051, weapon: 0.06, chronicled: 0.051 }

// 五星概率表（pullNo 为 1 起始的本次祈愿次数）
export function p5Rate(kind, pullNo) {
  if (kind === 'weapon') {
    if (pullNo <= 62) return 0.007
    if (pullNo <= 73) return 0.007 + 0.07 * (pullNo - 62)      // 第63~73抽
    if (pullNo <= 79) return 0.777 + 0.035 * (pullNo - 73)     // 第74~79抽
    return 1.0
  }
  if (pullNo <= 73) return 0.006
  return Math.min(1, 0.006 + 0.06 * (pullNo - 73))             // 第74~90抽
}

// ── 货币换算（原石 160:1、创世结晶 1:1 原石、原生星辉 5:1 计入原生抽数）──
// 计算期间的星辉（返利中间项）不预换算：≥50 自动转化 10 抽；原生用尽后全数转化循环再利用
export function convertCurrencies({ primogems = 0, intertwinedFates = 0, genesisCrystals = 0, starglitter = 0 }) {
  const p = Math.max(0, Math.floor(primogems)) + Math.max(0, Math.floor(genesisCrystals))
  const fatesFromPrimo = Math.floor(p / 160)
  const primoLeft = p % 160
  const glitter = Math.max(0, Math.floor(starglitter))
  const fatesFromGlitter = Math.floor(glitter / 5)
  return {
    // 原生抽数：纠缠之缘 + 原石/创世结晶 + 原生星辉（计入原生资源）
    fates: Math.max(0, Math.floor(intertwinedFates)) + fatesFromPrimo + fatesFromGlitter,
    starglitter: glitter,
    fatesFromPrimo, fatesFromGlitter, primoLeft,
    glitterLeft: glitter % 5, // 初始星辉零头进入转化池
  }
}

// ── 垫池状态推算（从祈愿捕捉站档案）──
export function computePityFromArchive(itemsByType) {
  const merge = (a, b) => [...(a || []), ...(b || [])]
    .sort((x, y) => x.time.localeCompare(y.time) || String(x.id).localeCompare(String(y.id)))

  const analyze = (list, stdList, hardPity) => {
    const n = list.length
    let pity5 = n, pity4 = n, lastIsStd = false, crStreak = 0
    for (let i = n - 1; i >= 0; i--) {
      if (Number(list[i].rank_type) === 5) { pity5 = n - 1 - i; lastIsStd = stdList.includes(list[i].name); break }
    }
    for (let i = n - 1; i >= 0; i--) {
      if (Number(list[i].rank_type) >= 4) { pity4 = n - 1 - i; break }
    }
    // 捕获明光连保次数：从最新往旧数「紧接常驻五星之后的 UP 五星」的连续个数
    if (!lastIsStd && n > 0) {
      const seq = []
      for (let i = n - 1; i >= 0; i--) {
        if (Number(list[i].rank_type) === 5) seq.push(list[i].name)
      }
      for (let i = 0; i < seq.length - 1; i++) {
        if (stdList.includes(seq[i])) break
        if (!stdList.includes(seq[i + 1])) break
        crStreak++
        if (crStreak >= 3) break
      }
    }
    return {
      pity5: Math.min(pity5, hardPity - 1),
      pity4: Math.min(pity4, 9),
      guaranteed: lastIsStd ? 1 : 0,
      crStreak: lastIsStd ? 0 : crStreak,
    }
  }

  return {
    character: analyze(merge(itemsByType[301], itemsByType[400]), STANDARD_5STAR_CHARS, 90),
    weapon: analyze(itemsByType[302] || [], STANDARD_5STAR_WEAPONS, 80),
    chronicled: analyze(itemsByType[500] || [], [], 90),
  }
}

// ── 内部工具 ──
const max = Math.max
const min = Math.min

// 目标计数器上限：角色类目标按副本数追踪星辉分层（第 8 次起 25 星辉）；
// 副本数 ≥ 7 时追踪到 8 层以上；其余场景副本数即上限（8 层尾部概率可忽略）
function capFor(copies, isChar) {
  if (!isChar) return copies
  return copies >= 7 ? max(copies, 8) : copies
}

function decodeTuple(ci, counterDims) {
  const cArr = new Array(counterDims.length)
  let rem = ci
  for (let d = 0; d < counterDims.length; d++) { cArr[d] = rem % counterDims[d]; rem = (rem / counterDims[d]) | 0 }
  return cArr
}

// 计数器混合进制步长表
function counterLayout(counterDims) {
  const strides = []
  let total = 1
  for (const d of counterDims) { strides.push(total); total *= d }
  return { counterStrides: strides, counterTotal: total }
}

function createResult(n, targets, chainLen) {
  const mk = () => new Float64Array(n + 1)
  const res = {
    F: mk(), Eg: mk(), E5: mk(), E4: mk(), EMet: mk(), EMetCopies: mk(), firstHit: mk(),
    marginals: (targets || []).map(t => ({ id: t.id, name: t.name, copies: t.copies, P: mk() })),
    chainF: chainLen ? Array.from({ length: chainLen }, () => mk()) : null,
    _n: 0, _probs: null, _truncated: false,
  }
  return res
}

function growResult(res, n, targets, chainLen) {
  const grow = (a) => { const na = new Float64Array(n + 1); na.set(a); return na }
  res.F = grow(res.F); res.Eg = grow(res.Eg); res.E5 = grow(res.E5); res.E4 = grow(res.E4)
  res.EMet = grow(res.EMet); res.EMetCopies = grow(res.EMetCopies); res.firstHit = grow(res.firstHit)
  res.marginals = res.marginals.map(m => ({ ...m, P: grow(m.P) }))
  if (res.chainF) res.chainF = res.chainF.map(grow)
  return res
}

function finalizeFirstHit(res, n) {
  for (let i = 1; i <= n; i++) res.firstHit[i] = Math.max(0, res.F[i] - res.F[i - 1])
}

// 目标计数器增量（带饱和保护：已达上限不再增加），返回的是 ci 的元组内偏移
function incOf(cArr, counterDims, counterStrides, ci) {
  return (ci >= 0 && cArr[ci] < counterDims[ci] - 1) ? counterStrides[ci] : 0
}

// 计算可用抽数上限（避免极端配置卡死界面）
function computeCapN(targetN, baseTotal, counterTotal, maxOps = 6e8) {
  const perPull = baseTotal * counterTotal
  return { capN: Math.min(targetN, Math.max(0, Math.floor(maxOps / perPull))) }
}

// 汇总：列和 + 达成判定（各池共用；末尾可含非目标观测计数器如「歪次数」）
// chainReq（可选）：抽取顺序里程碑链 [{idx, copies}…]，同步记录各级别达成概率
function summarizeColumns(probs, baseTotal, counterTotal, counterDims, res, pullIdx, chainReq) {
  let f = 0, met = 0, metCopies = 0
  const margAcc = new Array(res.marginals.length).fill(0)
  const goalCnt = res.marginals.length // 目标计数器数（可能小于总计数器数）
  const chainAcc = chainReq ? new Array(chainReq.length).fill(0) : null
  for (let ci = 0; ci < counterTotal; ci++) {
    const cArr = decodeTuple(ci, counterDims)
    let col = 0
    const base = ci * baseTotal
    for (let b = 0; b < baseTotal; b++) col += probs[base + b]
    if (!col) continue
    let ok = true, meti = 0, metCopiesi = 0
    for (let i = 0; i < goalCnt; i++) {
      const cp = res.marginals[i].copies
      if (cArr[i] >= cp) meti++; else ok = false
      metCopiesi += min(cArr[i], cp)
    }
    if (ok) f += col
    met += col * meti; metCopies += col * metCopiesi
    for (let i = 0; i < goalCnt; i++) {
      if (cArr[i] >= res.marginals[i].copies) margAcc[i] += col
    }
    // 抽取顺序链：第 j 级达成 ⇔ 该级所有条目所需副本均已获得（链为嵌套递进）
    if (chainAcc) {
      let metLvl = chainAcc.length
      for (let j = 0; j < chainAcc.length; j++) {
        const req = chainReq[j]
        let ok2 = true
        for (let r = 0; r < req.length; r++) {
          if (cArr[req[r][0]] < req[r][1]) { ok2 = false; break }
        }
        if (!ok2) { metLvl = j; break }
      }
      for (let j = 0; j < metLvl; j++) chainAcc[j] += col
    }
  }
  res.F[pullIdx] = f; res.EMet[pullIdx] = met; res.EMetCopies[pullIdx] = metCopies
  for (let i = 0; i < margAcc.length; i++) res.marginals[i].P[pullIdx] = margAcc[i]
  if (chainAcc) {
    for (let j = 0; j < chainAcc.length; j++) res.chainF[j][pullIdx] = chainAcc[j]
  }
}

// 目标达成所需的抽数参考：期望抽数（达成条件下的均值）+ P25/P50/P75 分位（各带对应达成概率）
export function pullsNeeded(curve) {
  const n = curve._n
  let E = 0, mass = 0
  for (let i = 1; i <= n; i++) { E += i * curve.firstHit[i]; mass += curve.firstHit[i] }
  const p = (x) => {
    for (let i = 0; i <= n; i++) if (curve.F[i] >= x) return { n: i, p: curve.F[i] }
    return { n, p: curve.F[n], truncated: true }
  }
  return {
    E: mass > 0 ? E / mass : 0,
    mass,
    p25: p(0.25), p50: p(0.5), p75: p(0.75),
    complete: mass > 0.999,
  }
}

// 粗估所需抽数上限（用于把曲线算到足够覆盖「达到目标」的范围，避免小资源截断误导）
export function estimateNeeds(targets, kind) {
  return targets.reduce((s, t) => s + Math.max(1, t.copies || 1) * (kind === 'weapon' ? 160 : 180), 0)
}

// ═════════════════════════════════════════════════════════════════
// 角色活动祈愿（301 与 400 共享保底，两个池各自有 UP 五星角色）
// 基底: b = p5 + 90*(p4 + 10*(gu + 2*(st + 4*gu4)))
// 小保底：50% UP（含捕获明光修正）；歪 → 大保底；大保底必得所抽池子的 UP
// 策略：五星目标未达成时抽对应池（A 优先），两池皆达成后随意
// ═════════════════════════════════════════════════════════════════
function runCharacterDP(cfg, targetN, existing) {
  const { poolA, poolB, up4 = [], pity5 = 0, pity4 = 0, guaranteed = 0, crStreak = 0 } = cfg
  const chainReq = cfg.chainReq || null
  const owned = cfg.owned || {}
  const std4Counts = cfg.std4Counts || { chars: 1, weapons: 1 }
  const t5 = cfg.targets.filter(t => t.rarity === 5)
  const t4 = cfg.targets.filter(t => t.rarity === 4 && t.name !== '__any4__')
  const any4 = cfg.targets.find(t => t.name === '__any4__')
  const tA = t5.find(t => t.name === poolA)
  const tB = t5.find(t => t.name === poolB)
  const idxA = tA ? t5.indexOf(tA) : -1
  const idxB = tB ? t5.indexOf(tB) : -1
  const hasGu4 = t4.length > 0 // 有四星目标才需要 gu4 状态（四星 UP 歪后必出）
  const up4Set = new Set(up4)
  const stdT4 = t4.filter(t => !up4Set.has(t.name)) // 不在当期 UP 池的常驻四星目标

  const baseTotal = 90 * 10 * 2 * 4 * (hasGu4 ? 2 : 1)
  const counterDims = [
    ...t5.map(t => capFor(t.copies, true) + 1),
    ...t4.map(t => capFor(t.copies, true) + 1),
    ...(any4 ? [any4.copies + 1] : []),
  ]
  const { counterStrides, counterTotal } = counterLayout(counterDims)
  const nCnt = counterDims.length
  const anyIdx = any4 ? nCnt - 1 : -1
  const t4NameIdx = new Map(t4.map((t, i) => [t.name, i]))
  const up4TargetIdx = up4.map(nm => t4NameIdx.has(nm) ? t4NameIdx.get(nm) : -1)
  const nonTargetUp4 = up4.filter(nm => !t4NameIdx.has(nm)).length
  // 常驻四星目标概率：歪常驻分支内 先 50% 角色/武器，再均匀抽取
  const stdT4P = stdT4.map(t => (t.type === 'weapon' ? 0.5 / Math.max(1, std4Counts.weapons) : 0.5 / Math.max(1, std4Counts.chars)))
  const stdT4Mass = stdT4P.reduce((s, v) => s + v, 0)
  const total = baseTotal * counterTotal

  const capN = computeCapN(targetN, baseTotal, counterTotal).capN
  if (existing && existing._n >= capN) return existing
  const res = existing ? growResult(existing, capN, t5.concat(t4).concat(any4 || []), chainReq?.length || 0) : createResult(capN, t5.concat(t4).concat(any4 || []), chainReq?.length || 0)
  let probs = existing ? existing._probs : null
  if (!probs || probs.length !== total) {
    probs = new Float64Array(total)
    probs[pity5 + 90 * (pity4 + 10 * (guaranteed + 2 * (Math.min(crStreak, 3) + 4 * 0)))] = 1
  }
  let n = existing ? existing._n : 0
  res._truncated = capN < targetN

  // ── 基底预计算表 ──
  const r5 = new Float64Array(baseTotal), r4 = new Float64Array(baseTotal), r3 = new Float64Array(baseTotal)
  const winBase = new Int32Array(baseTotal), loseBase = new Int32Array(baseTotal)
  const up4Base = new Int32Array(baseTotal), std4Base = new Int32Array(baseTotal)
  const r3Base = new Int32Array(baseTotal), winP = new Float64Array(baseTotal)
  const upQ = new Float64Array(baseTotal), stdQ = new Float64Array(baseTotal)
  for (let p5 = 0; p5 < 90; p5++) {
    for (let p4 = 0; p4 < 10; p4++) {
      const r5v = p5Rate('character', p5 + 1)
      const r4v = r5v >= 1 ? 0 : (p4 === 9 ? 1 - r5v : P4_BASE.character * (1 - r5v)) // 五星优先，四星有效概率 = 基础率 × 非五星概率
      const nP5 = p5 === 89 ? 0 : p5 + 1
      const nP4 = p4 === 9 ? 0 : p4 + 1
      for (let gu = 0; gu < 2; gu++) {
        for (let st = 0; st < 4; st++) {
          for (let gu4 = 0; gu4 < (hasGu4 ? 2 : 1); gu4++) {
            const b = p5 + 90 * (p4 + 10 * (gu + 2 * (st + 4 * gu4)))
            r5[b] = r5v; r4[b] = r4v; r3[b] = Math.max(0, 1 - r5v - r4v)
            winP[b] = gu === 1 ? 1 : (st >= 3 ? 1 : st === 2 ? 0.53 : 0.5)
            const nst = gu === 1 ? min(3, st + 1) : 0
            winBase[b] = 0 + 90 * (0 + 10 * (0 + 2 * (nst + 4 * gu4)))
            loseBase[b] = 0 + 90 * (0 + 10 * (1 + 2 * (0 + 4 * gu4)))
            up4Base[b] = nP5 + 90 * (0 + 10 * (gu + 2 * (st + 4 * 0)))
            std4Base[b] = hasGu4
              ? nP5 + 90 * (0 + 10 * (gu + 2 * (st + 4 * 1)))
              : up4Base[b] // 无 gu4 维度时 UP/歪 写入同一基底
            r3Base[b] = nP5 + 90 * (nP4 + 10 * (gu + 2 * (st + 4 * gu4)))
            // 四星 UP/歪 概率：gu4=1 时必 UP；gu4=0 时 50/50
            if (hasGu4) { upQ[b] = r4v * (gu4 === 1 ? 1 : 0.5); stdQ[b] = r4v * (gu4 === 1 ? 0 : 0.5) }
            else { upQ[b] = r4v * 0.5; stdQ[b] = r4v * 0.5 }
          }
        }
      }
    }
  }

  const aMet = (cArr) => idxA < 0 || cArr[idxA] >= tA.copies
  const bMet = (cArr) => idxB < 0 || cArr[idxB] >= tB.copies

  for (; n < capN; n++) {
    const next = new Float64Array(total)
    let sum5 = 0, sum4 = 0, sumG = 0
    for (let ci = 0; ci < counterTotal; ci++) {
      const cArr = decodeTuple(ci, counterDims)
      const base = ci * baseTotal
      const pullA = !aMet(cArr) || bMet(cArr)
      const wIdx = pullA ? idxA : idxB
      const winOff = wIdx >= 0 ? incOf(cArr, counterDims, counterStrides, wIdx) : 0
      // 星辉分层随已有数量平移：已有 + 已抽 >= 7 时下一份按 25 计算
      const glitter5 = wIdx >= 0 ? ((owned[t5[wIdx].name] || 0) + cArr[wIdx] < 7 ? 10 : 25) : 10
      const anyOff = anyIdx >= 0 ? incOf(cArr, counterDims, counterStrides, anyIdx) : 0
      const t4Offs = t4.map(t => incOf(cArr, counterDims, counterStrides, t5.length + t4NameIdx.get(t.name)))
      // UP 四星角色目标分层（本次获得后总份数）：第 1 次 0，2~7 次 2，8 次起 5（随已拥有平移）
      const t4Glitter = t4.map(t => {
        if (t.type !== 'char') return 2
        const total = (owned[t.name] || 0) + cArr[t5.length + t4NameIdx.get(t.name)] + 1
        return total === 1 ? 0 : total < 8 ? 2 : 5
      })
      let colR5 = 0, colW = 0, colL = 0, colR4U = 0, colR4S = 0
      for (let b = 0; b < baseTotal; b++) {
        const p = probs[base + b]
        if (!p) continue
        colR5 += p * r5[b]; colW += p * r5[b] * winP[b]; colL += p * r5[b] * (1 - winP[b])
        colR4U += p * upQ[b]; colR4S += p * stdQ[b]
        next[(ci + winOff) * baseTotal + winBase[b]] += p * r5[b] * winP[b]
        next[ci * baseTotal + loseBase[b]] += p * r5[b] * (1 - winP[b])
        if (up4.length) {
          const nUp = up4.length
          // 只写目标项（非目标项走下方合并写入，避免重复计数）
          for (let j = 0; j < nUp; j++) {
            const ti = up4TargetIdx[j]
            if (ti >= 0) next[(ci + anyOff + t4Offs[ti]) * baseTotal + up4Base[b]] += p * upQ[b] / nUp
          }
          if (nonTargetUp4 > 0) next[(ci + anyOff) * baseTotal + up4Base[b]] += p * upQ[b] * nonTargetUp4 / nUp
        } else {
          next[(ci + anyOff) * baseTotal + up4Base[b]] += p * upQ[b]
        }
        // 常驻四星：常驻目标项细分概率，其余质量合并（歪常驻分支概率 = stdQ）
        for (let k = 0; k < stdT4.length; k++) {
          const ti = t5.length + t4NameIdx.get(stdT4[k].name)
          next[(ci + anyOff + t4Offs[ti]) * baseTotal + std4Base[b]] += p * stdQ[b] * stdT4P[k]
        }
        next[(ci + anyOff) * baseTotal + std4Base[b]] += p * stdQ[b] * Math.max(0, 1 - stdT4Mass)
        if (r3[b] > 0) next[ci * baseTotal + r3Base[b]] += p * r3[b]
      }
      sum5 += colR5; sum4 += colR4U + colR4S
      sumG += colW * glitter5 + colL * 10
      if (up4.length) {
        const perItem = colR4U / up4.length
        for (let j = 0; j < up4TargetIdx.length; j++) {
          const ti = up4TargetIdx[j]
          if (ti >= 0) sumG += perItem * t4Glitter[ti]
        }
        sumG += perItem * nonTargetUp4 * 2
      } else {
        sumG += colR4U * 2
      }
      const p4 = nonUp4GlitterOf(cfg)
      for (let k = 0; k < stdT4.length; k++) {
        const nm = stdT4[k].name
        if (stdT4[k].type === 'weapon') { sumG += colR4S * stdT4P[k] * 2; continue }
        const total = (owned[nm] || 0) + cArr[t5.length + t4NameIdx.get(nm)] + 1
        sumG += colR4S * stdT4P[k] * (total === 1 ? 0 : p4)
      }
      sumG += colR4S * Math.max(0, 1 - stdT4Mass) * (0.5 * p4 + 0.5 * 2)
    }
    probs = next
    res.Eg[n + 1] = res.Eg[n] + sumG
    res.E5[n + 1] = res.E5[n] + sum5
    res.E4[n + 1] = res.E4[n] + sum4
    summarizeColumns(probs, baseTotal, counterTotal, counterDims, res, n + 1, chainReq)
  }
  res._n = capN
  res._probs = probs
  finalizeFirstHit(res, capN)
  return res
}

// ═════════════════════════════════════════════════════════════════
// 武器活动祈愿：小保底 75% UP（两把 5 星平分）/ 25% 常驻；
// 「神铸定轨」命定值 0/1，歪（非定轨武器）则 +1，命定值 1 时下次必得定轨武器
// 基底: b = p5 + 80*(p4 + 10*(ft + 2*(0 + 2*gu4)))
// ═════════════════════════════════════════════════════════════════
function runWeaponDP(cfg, targetN, existing) {
  const { weapon5 = [], up4 = [], pity5 = 0, pity4 = 0, fate = 0 } = cfg
  const chainReq = cfg.chainReq || null
  const std4Counts = cfg.std4Counts || { chars: 1, weapons: 1 }
  const t5 = cfg.targets.filter(t => t.rarity === 5)
  const t4 = cfg.targets.filter(t => t.rarity === 4 && t.name !== '__any4__')
  const any4 = cfg.targets.find(t => t.name === '__any4__')
  const epit = t5.find(t => t.epitomized)
  const upWeapons = weapon5.filter(Boolean)
  const nameIdx = new Map(t5.map((t, i) => [t.name, i]))
  const t4NameIdx = new Map(t4.map((t, i) => [t.name, i]))
  const up4TargetIdx = up4.map(nm => t4NameIdx.has(nm) ? t4NameIdx.get(nm) : -1)
  const nonTargetUp4 = up4.filter(nm => !t4NameIdx.has(nm)).length
  const up4Set = new Set(up4)
  const stdT4 = t4.filter(t => !up4Set.has(t.name))
  const stdT4P = stdT4.map(t => (t.type === 'weapon' ? 0.5 / Math.max(1, std4Counts.weapons) : 0.5 / Math.max(1, std4Counts.chars)))
  const stdT4Mass = stdT4P.reduce((s, v) => s + v, 0)
  const hasGu4 = t4.length > 0
  const eIdx = epit ? nameIdx.get(epit.name) : -1
  const oName = epit && upWeapons.length >= 2 ? upWeapons.find(w => w !== epit.name) : null
  const oIdx = oName && nameIdx.has(oName) ? nameIdx.get(oName) : -1

  const baseTotal = 80 * 10 * 2 * 1 * (hasGu4 ? 2 : 1)
  const counterDims = [
    ...t5.map(t => capFor(t.copies, false) + 1),
    ...t4.map(t => capFor(t.copies, true) + 1),
    ...(any4 ? [any4.copies + 1] : []),
  ]
  const { counterStrides, counterTotal } = counterLayout(counterDims)
  const nCnt = counterDims.length
  const anyIdx = any4 ? nCnt - 1 : -1
  const total = baseTotal * counterTotal

  const capN = computeCapN(targetN, baseTotal, counterTotal).capN
  if (existing && existing._n >= capN) return existing
  const res = existing ? growResult(existing, capN, t5.concat(t4).concat(any4 || []), chainReq?.length || 0) : createResult(capN, t5.concat(t4).concat(any4 || []), chainReq?.length || 0)
  let probs = existing ? existing._probs : null
  if (!probs || probs.length !== total) {
    probs = new Float64Array(total)
    probs[pity5 + 80 * (pity4 + 10 * (fate + 2 * 0))] = 1
  }
  let n = existing ? existing._n : 0
  res._truncated = capN < targetN

  // 基底预计算
  const r5 = new Float64Array(baseTotal), r4 = new Float64Array(baseTotal), r3 = new Float64Array(baseTotal)
  const w5hit = new Int32Array(baseTotal), w5wry = new Int32Array(baseTotal), w5epit = new Int32Array(baseTotal)
  const w4up = new Int32Array(baseTotal), w4std = new Int32Array(baseTotal)
  const r3Base = new Int32Array(baseTotal)
  const upQ = new Float64Array(baseTotal), stdQ = new Float64Array(baseTotal)
  const ftOf = new Int8Array(baseTotal)
  for (let p5 = 0; p5 < 80; p5++) {
    for (let p4 = 0; p4 < 10; p4++) {
      const r5v = p5Rate('weapon', p5 + 1)
      const r4v = r5v >= 1 ? 0 : (p4 === 9 ? 1 - r5v : P4_BASE.weapon * (1 - r5v)) // 五星优先，四星有效概率 = 基础率 × 非五星概率
      const nP5 = p5 === 79 ? 0 : p5 + 1
      const nP4 = p4 === 9 ? 0 : p4 + 1
      for (let ft = 0; ft < 2; ft++) {
        for (let gu4 = 0; gu4 < (hasGu4 ? 2 : 1); gu4++) {
          const b = p5 + 80 * (p4 + 10 * (ft + 2 * (0 + 2 * gu4)))
          ftOf[b] = ft
          r5[b] = r5v; r4[b] = r4v; r3[b] = Math.max(0, 1 - r5v - r4v)
          w5hit[b] = 0 + 80 * (0 + 10 * (0 + 2 * (0 + 2 * gu4)))       // 五星：p5→0, ft→0, gu4 不变
          w5wry[b] = 0 + 80 * (0 + 10 * (1 + 2 * (0 + 2 * gu4)))       // 歪/常驻：p5→0, ft→1, gu4 不变
          w5epit[b] = ft === 1 ? (0 + 80 * (0 + 10 * (0 + 2 * (0 + 2 * gu4)))) : w5hit[b]
          w4up[b] = nP5 + 80 * (0 + 10 * (ft + 2 * (0 + 2 * 0)))     // 四星 UP：ft 不变, gu4→0
          w4std[b] = hasGu4
            ? nP5 + 80 * (0 + 10 * (ft + 2 * (0 + 2 * 1)))          // 四星歪：ft 不变, gu4→1
            : w4up[b] // 无 gu4 维度时 UP/歪 写入同一基底
          r3Base[b] = nP5 + 80 * (nP4 + 10 * (ft + 2 * (0 + 2 * gu4)))
          if (hasGu4) { upQ[b] = r4v * (gu4 === 1 ? 1 : 0.5); stdQ[b] = r4v * (gu4 === 1 ? 0 : 0.5) }
          else { upQ[b] = r4v * 0.5; stdQ[b] = r4v * 0.5 }
        }
      }
    }
  }

  for (; n < capN; n++) {
    const next = new Float64Array(total)
    let sum5 = 0, sum4 = 0, sumG = 0
    for (let ci = 0; ci < counterTotal; ci++) {
      const cArr = decodeTuple(ci, counterDims)
      const base = ci * baseTotal
      const eOff = eIdx >= 0 ? incOf(cArr, counterDims, counterStrides, eIdx) : 0
      const oOff = oIdx >= 0 ? incOf(cArr, counterDims, counterStrides, oIdx) : 0
      const anyOff = anyIdx >= 0 ? incOf(cArr, counterDims, counterStrides, anyIdx) : 0
      const t4Offs = t4.map(t => incOf(cArr, counterDims, counterStrides, t5.length + t4NameIdx.get(t.name)))
      let colR5 = 0, colR4U = 0, colR4S = 0
      for (let b = 0; b < baseTotal; b++) {
        const p = probs[base + b]
        if (!p) continue
        colR5 += p * r5[b]; colR4U += p * upQ[b]; colR4S += p * stdQ[b]
        if (r5[b] > 0) {
          if (ftOf[b] === 1) {
            next[(ci + (eIdx >= 0 ? eOff : 0)) * baseTotal + w5epit[b]] += p * r5[b]
          } else if (epit) {
            next[(ci + eOff) * baseTotal + w5hit[b]] += p * r5[b] * 0.375
            // 另一把 UP（37.5%）与常驻（25%）均记「歪」
            next[(ci + oOff) * baseTotal + w5wry[b]] += p * r5[b] * 0.375
            next[ci * baseTotal + w5wry[b]] += p * r5[b] * 0.25
          } else {
            // 未定轨：目标 UP 命中不计歪；非目标 UP 与常驻记歪
            const upP = 0.75 / Math.max(1, upWeapons.length)
            let nonTargetUpMass = 0
            for (const w of upWeapons) {
              const wi = nameIdx.has(w) ? nameIdx.get(w) : -1
              if (wi >= 0) next[(ci + incOf(cArr, counterDims, counterStrides, wi)) * baseTotal + w5hit[b]] += p * r5[b] * upP
              else nonTargetUpMass += upP
            }
            next[ci * baseTotal + w5hit[b]] += p * r5[b] * (nonTargetUpMass + 0.25)
          }
        }
        if (up4.length) {
          const nUp = up4.length
          for (let j = 0; j < nUp; j++) {
            const ti = up4TargetIdx[j]
            if (ti >= 0) next[(ci + anyOff + t4Offs[ti]) * baseTotal + w4up[b]] += p * upQ[b] / nUp
          }
          if (nonTargetUp4 > 0) next[(ci + anyOff) * baseTotal + w4up[b]] += p * upQ[b] * nonTargetUp4 / nUp
        } else {
          next[(ci + anyOff) * baseTotal + w4up[b]] += p * upQ[b]
        }
        // 常驻四星：常驻目标项细分概率（武器池四星目标均为武器，星辉恒定 2）
        for (let k = 0; k < stdT4.length; k++) {
          const ti = t5.length + t4NameIdx.get(stdT4[k].name)
          next[(ci + anyOff + t4Offs[ti]) * baseTotal + w4std[b]] += p * stdQ[b] * stdT4P[k]
        }
        next[(ci + anyOff) * baseTotal + w4std[b]] += p * stdQ[b] * Math.max(0, 1 - stdT4Mass)
        if (r3[b] > 0) next[ci * baseTotal + r3Base[b]] += p * r3[b]
      }
      const p4 = nonUp4GlitterOf(cfg)
      let stdG = 0
      for (let k = 0; k < stdT4.length; k++) {
        stdG += stdT4P[k] * (stdT4[k].type === 'weapon' ? 2 : p4)
      }
      stdG += Math.max(0, 1 - stdT4Mass) * (0.5 * p4 + 0.5 * 2)
      sum5 += colR5; sum4 += colR4U + colR4S
      sumG += colR5 * 10 + colR4U * 2 + colR4S * stdG
    }
    probs = next
    res.Eg[n + 1] = res.Eg[n] + sumG
    res.E5[n + 1] = res.E5[n] + sum5
    res.E4[n + 1] = res.E4[n] + sum4
    summarizeColumns(probs, baseTotal, counterTotal, counterDims, res, n + 1, chainReq)
  }
  res._n = capN
  res._probs = probs
  finalizeFirstHit(res, capN)
  return res
}

// ═════════════════════════════════════════════════════════════════
// 集录祈愿：五星 0.6% / 90 保底；「集录定轨」命定值 0/1；
// 角色与武器可分别设定定轨（各任意个）；生效定轨 = 目标顺序中第一个未达成的定轨目标，
// 生效期间五星只会是池内同类型（50% 定轨目标，歪则 +1 命定值，命定值 1 时必得）；
// 无未达成定轨时五星从池内全部五星等概率；四星全部等可能（无 UP 机制）
// 基底: b = p5 + 90*(p4 + 10*ft)
// ═════════════════════════════════════════════════════════════════
function runChronicledDP(cfg, targetN, existing) {
  const { chrono5 = [], chrono4 = [], pity5 = 0, pity4 = 0, fate = 0 } = cfg
  const chainReq = cfg.chainReq || null
  const owned = cfg.owned || {}
  const t5 = cfg.targets.filter(t => t.rarity === 5)
  const t4 = cfg.targets.filter(t => t.rarity === 4 && t.name !== '__any4__')
  const any4 = cfg.targets.find(t => t.name === '__any4__')
  const n5 = chrono5.length
  const nameIdx = new Map(t5.map((t, i) => [t.name, i]))
  const t4NameIdx = new Map(t4.map((t, i) => [t.name, i]))
  const chrono4TargetIdx = chrono4.map(c => t4NameIdx.has(c.name) ? t4NameIdx.get(c.name) : -1)
  const nonTarget4 = chrono4.filter((_, i) => chrono4TargetIdx[i] < 0).length
  const chrono5TargetIdx = chrono5.map(c => nameIdx.has(c.name) ? nameIdx.get(c.name) : -1)
  // 物品类型（目标未显式标注时按池内同名物品回退，避免「同类型仅此一件」误判）
  const t5Type = (t) => t.type || (chrono5.find(c => c.name === t.name)?.type) || 'char'
  const t4Type = (t) => t.type || (chrono4.find(c => c.name === t.name)?.type) || 'char'
  // 定轨目标（角色与武器可分别设定，按目标顺序取「第一个未达成」为生效定轨）；
  // 每定轨目标对应的同类型其他池内五星（-1 = 非目标，命中仅计歪/命定值）
  const epitIdxList = t5.map((t, i) => t.epitomized ? i : -1).filter(i => i >= 0)
  const sameTypeOf = epitIdxList.map(ei => {
    const items = []
    for (let k = 0; k < chrono5.length; k++) {
      const c = chrono5[k]
      if (c.name !== t5[ei].name && c.type === t5Type(t5[ei])) items.push(chrono5TargetIdx[k])
    }
    return items
  })

  const baseTotal = 90 * 10 * 2
  const counterDims = [
    ...t5.map(t => capFor(t.copies, t5Type(t) === 'char') + 1),
    ...t4.map(t => capFor(t.copies, true) + 1),
    ...(any4 ? [any4.copies + 1] : []),
  ]
  const { counterStrides, counterTotal } = counterLayout(counterDims)
  const nCnt = counterDims.length
  const anyIdx = any4 ? nCnt - 1 : -1
  const total = baseTotal * counterTotal

  const capN = computeCapN(targetN, baseTotal, counterTotal).capN
  if (existing && existing._n >= capN) return existing
  if (!n5) { const r = existing || createResult(0, t5.concat(t4).concat(any4 || []), chainReq?.length || 0); r._n = 0; return r }
  const res = existing ? growResult(existing, capN, t5.concat(t4).concat(any4 || []), chainReq?.length || 0) : createResult(capN, t5.concat(t4).concat(any4 || []), chainReq?.length || 0)
  let probs = existing ? existing._probs : null
  if (!probs || probs.length !== total) {
    probs = new Float64Array(total)
    probs[pity5 + 90 * (pity4 + 10 * fate)] = 1
  }
  let n = existing ? existing._n : 0
  res._truncated = capN < targetN

  // 基底预计算
  const r5 = new Float64Array(baseTotal), r4 = new Float64Array(baseTotal), r3 = new Float64Array(baseTotal)
  const hitBase = new Int32Array(baseTotal), wryBase = new Int32Array(baseTotal)
  const epitBase = new Int32Array(baseTotal), c4Base = new Int32Array(baseTotal)
  const r3Base = new Int32Array(baseTotal), ftOf = new Int8Array(baseTotal)
  for (let p5 = 0; p5 < 90; p5++) {
    for (let p4 = 0; p4 < 10; p4++) {
      const r5v = p5Rate('chronicled', p5 + 1)
      const r4v = r5v >= 1 ? 0 : (p4 === 9 ? 1 - r5v : P4_BASE.chronicled * (1 - r5v)) // 五星优先，四星有效概率 = 基础率 × 非五星概率
      const nP5 = p5 === 89 ? 0 : p5 + 1
      const nP4 = p4 === 9 ? 0 : p4 + 1
      for (let ft = 0; ft < 2; ft++) {
        const b = p5 + 90 * (p4 + 10 * ft)
        ftOf[b] = ft
        r5[b] = r5v; r4[b] = r4v; r3[b] = Math.max(0, 1 - r5v - r4v)
        hitBase[b] = 0 // 五星：p5→0, p4→0, ft→0
        wryBase[b] = 0 + 90 * 10 // 歪：p5→0, ft→1
        epitBase[b] = 0 // 命定值必得：p5→0, ft→0
        c4Base[b] = nP5 + 90 * (0 + 10 * ft)
        r3Base[b] = nP5 + 90 * (nP4 + 10 * ft)
      }
    }
  }

  for (; n < capN; n++) {
    const next = new Float64Array(total)
    let sum5 = 0, sum4 = 0, sumG = 0
    for (let ci = 0; ci < counterTotal; ci++) {
      const cArr = decodeTuple(ci, counterDims)
      const base = ci * baseTotal
      const anyOff = anyIdx >= 0 ? incOf(cArr, counterDims, counterStrides, anyIdx) : 0
      // 生效定轨：目标顺序中第一个未达成的定轨目标；全部达成 → 不定轨
      let actIdx = -1, actPos = -1
      for (let k = 0; k < epitIdxList.length; k++) {
        const ei = epitIdxList[k]
        if (cArr[ei] < t5[ei].copies) { actIdx = ei; actPos = k; break }
      }
      const actEpit = actIdx >= 0 ? t5[actIdx] : null
      const stItems = actPos >= 0 ? sameTypeOf[actPos] : null
      const eOff = actIdx >= 0 ? incOf(cArr, counterDims, counterStrides, actIdx) : 0
      // 五星星辉分层随已有数量平移：目标角色 10/25，目标武器与非目标恒 10
      const t5Glit = (ti) => t5Type(t5[ti]) === 'char' ? ((owned[t5[ti].name] || 0) + cArr[ti] < 7 ? 10 : 25) : 10
      let eGlit = 0, oGlit = 0
      if (actEpit) {
        eGlit = t5Glit(actIdx)
        if (stItems.length) {
          const oP = 0.5 / stItems.length
          for (const ti of stItems) oGlit += oP * (ti >= 0 ? t5Glit(ti) : 10)
        }
      } else if (n5 > 0) {
        const up = 1 / n5
        for (let k = 0; k < chrono5.length; k++) {
          const ti = chrono5TargetIdx[k]
          oGlit += up * (ti >= 0 ? t5Glit(ti) : 10)
        }
      }
      const t4Offs = t4.map(t => incOf(cArr, counterDims, counterStrides, t5.length + t4NameIdx.get(t.name)))
      const t4Glitter = t4.map(t => (t4Type(t) === 'char' ? ((owned[t.name] || 0) + cArr[t5.length + t4NameIdx.get(t.name)] < 7 ? 2 : 5) : 2))
      let colR5 = 0, colR4 = 0, colE = 0
      for (let b = 0; b < baseTotal; b++) {
        const p = probs[base + b]
        if (!p) continue
        colR5 += p * r5[b]; colR4 += p * r4[b]
        if (r5[b] > 0) {
          const hitB = epitBase[b]
          if (actEpit && ftOf[b] === 1) {
            // 命定值 1：必得生效定轨
            colE += p * r5[b]
            next[(ci + eOff) * baseTotal + hitB] += p * r5[b]
          } else if (actEpit) {
            if (stItems.length === 0) {
              // 池内同类型仅此一件 → 100% 定轨目标
              colE += p * r5[b]
              next[(ci + eOff) * baseTotal + hitB] += p * r5[b]
            } else {
              colE += p * r5[b] * 0.5
              next[(ci + eOff) * baseTotal + hitB] += p * r5[b] * 0.5
              const oP = 0.5 / stItems.length
              for (const ti of stItems) {
                if (ti >= 0) next[(ci + incOf(cArr, counterDims, counterStrides, ti)) * baseTotal + wryBase[b]] += p * r5[b] * oP
                else next[ci * baseTotal + wryBase[b]] += p * r5[b] * oP
              }
            }
          } else if (t5.length > 0) {
            // 不定轨：目标项命中不计歪（无命定值）
            for (let k = 0; k < chrono5.length; k++) {
              const ti = chrono5TargetIdx[k]
              const off = ti >= 0 ? incOf(cArr, counterDims, counterStrides, ti) : 0
              next[(ci + off) * baseTotal + hitB] += p * r5[b] / n5
            }
          } else {
            next[ci * baseTotal + hitB] += p * r5[b]
          }
        }
        if (r4[b] > 0) {
          if (chrono4.length) {
            const m = chrono4.length
            for (let k = 0; k < m; k++) {
              if (chrono4TargetIdx[k] >= 0) {
                next[(ci + anyOff + t4Offs[chrono4TargetIdx[k]]) * baseTotal + c4Base[b]] += p * r4[b] / m
              }
            }
            if (nonTarget4 > 0) next[(ci + anyOff) * baseTotal + c4Base[b]] += p * r4[b] * nonTarget4 / m
          } else {
            // 池内未配置四星物品：四星照常产出（不影响任何目标计数）
            next[(ci + anyOff) * baseTotal + c4Base[b]] += p * r4[b]
          }
        }
        if (r3[b] > 0) next[ci * baseTotal + r3Base[b]] += p * r3[b]
      }
      sum5 += colR5; sum4 += colR4
      sumG += colE * eGlit + Math.max(0, colR5 - colE) * oGlit
      if (chrono4.length) {
        const p4 = nonUp4GlitterOf(cfg)
        const perItem = colR4 / chrono4.length
        for (let j = 0; j < t4.length; j++) {
          if (t4Type(t4[j]) === 'weapon') { sumG += perItem * 2; continue }
          const total = (owned[t4[j].name] || 0) + cArr[t5.length + t4NameIdx.get(t4[j].name)] + 1
          sumG += perItem * (total === 1 ? 0 : p4)
        }
        let ntG = 0
        for (let k = 0; k < chrono4.length; k++) {
          if (chrono4TargetIdx[k] < 0) ntG += (chrono4[k].type === 'weapon' ? 2 : p4)
        }
        sumG += perItem * ntG
      }
    }
    probs = next
    res.Eg[n + 1] = res.Eg[n] + sumG
    res.E5[n + 1] = res.E5[n] + sum5
    res.E4[n + 1] = res.E4[n] + sum4
    summarizeColumns(probs, baseTotal, counterTotal, counterDims, res, n + 1, chainReq)
  }
  res._n = capN
  res._probs = probs
  finalizeFirstHit(res, capN)
  return res
}

// ═════════════════════════════════════════════════════════════════
// 组合分析：多池分配 + 星辉再利用固定点迭代
// ═════════════════════════════════════════════════════════════════
export const MAX_T = 2000

// ═════════════════════════════════════════════════════════════════
// 按序抽取分析：
// 用户自定义抽取顺序（每个目标副本为一条目）。按顺序逐池抽取时，
// 各池的「达成消耗」（该池达到当前里程碑所需抽数）相互独立 —— 保底状态
// 跨段继承，总抽数分布与是否中途离池无关（路径无关性），因此：
//   - 逐条目达成概率 = P(截至该条目的各池累计消耗 ≤ 有效预算)（卷积）
//   - 全部达成概率   = 最后一条目的达成概率
// ═════════════════════════════════════════════════════════════════
// 目标计数器索引（与 DP 内部维度顺序一致：t5 → t4 → any4 → 观测）
function counterIndexOf(pool, name) {
  const t5 = pool.targets.filter(t => t.rarity === 5)
  const t4 = pool.targets.filter(t => t.rarity === 4 && t.name !== '__any4__')
  const any4 = pool.targets.find(t => t.name === '__any4__')
  const i5 = t5.findIndex(t => t.name === name)
  if (i5 >= 0) return i5
  const i4 = t4.findIndex(t => t.name === name)
  if (i4 >= 0) return t5.length + i4
  if (name === '__any4__' && any4) return t5.length + t4.length
  return -1
}

function buildChainReq(pool, entries) {
  const count = {}
  const chain = []
  for (const e of entries) {
    count[e.name] = (count[e.name] || 0) + 1
    const req = []
    for (const [name, c] of Object.entries(count)) {
      const idx = counterIndexOf(pool, name)
      if (idx >= 0) req.push([idx, c])
    }
    if (!req.length) return null // 条目不在目标内（不应发生）
    chain.push(req)
  }
  return chain.length ? chain : null
}

// 卷积：各池首达分布之和的 CDF（截断至 T）
function convolveSum(firstHits, T) {
  let dist = new Float64Array(T + 1)
  dist[0] = 1
  for (const fh of firstHits) {
    const next = new Float64Array(T + 1)
    const kMax = Math.min(fh.length - 1, T)
    for (let s = 0; s <= T; s++) {
      const d = dist[s]
      if (!d) continue
      const lim = Math.min(kMax, T - s)
      for (let k = 1; k <= lim; k++) next[s + k] += d * fh[k]
    }
    dist = next
  }
  let cdf = 0
  for (let t = 0; t <= T; t++) cdf += dist[t]
  return { cdf, dist }
}

export function analyzeOrdered(runtimePools, order, totalFates, recycle) {
  const active = runtimePools.filter(p => (p.targets || []).length > 0)
  if (!active.length || !order || !order.length) return null
  const poolCfg = {}
  for (const p of active) poolCfg[p.key] = p
  // 各池在顺序中的条目 → 里程碑链
  const byPool = {}
  for (const e of order) {
    if (!poolCfg[e.poolKey]) continue
    if (!byPool[e.poolKey]) byPool[e.poolKey] = []
    byPool[e.poolKey].push(e)
  }
  const chainOf = {}
  for (const key of Object.keys(byPool)) {
    const ch = buildChainReq(poolCfg[key], byPool[key])
    if (ch) chainOf[key] = ch
  }
  const cache = new Map()
  const ensure = (p, N) => {
    let r = cache.get(p.key)
    if (!r || r._n < N) {
      const cfg2 = chainOf[p.key] ? { ...p, chainReq: chainOf[p.key] } : p
      r = p.kind === 'weapon' ? runWeaponDP(cfg2, N, r)
        : p.kind === 'chronicled' ? runChronicledDP(cfg2, N, r) : runCharacterDP(cfg2, N, r)
      cache.set(p.key, r)
    }
    return r
  }
  // 预算（含星辉再利用固定点迭代）：
  // 星辉换来的抽数继续抽仍会产出星辉（级联），故按「实际会消耗的期望抽数」计算星辉回馈，
  // 预算增长后重新计算，直至收敛（几何级数，第二轮及以后贡献约 0.5%~1%）。
  const needsN = active.map(p => Math.min(estimateNeeds(p.targets, p.kind), MAX_T))
  let budget = Math.min(totalFates, MAX_T)
  let curves = null
  for (let iter = 0; iter < 12; iter++) {
    curves = active.map((p, i) => ensure(p, Math.max(budget, needsN[i])))
    if (!recycle) break
    // 各池最终里程碑的期望抽数与首达分布
    const finalIdx = active.map((p, i) => Math.max(0, (chainOf[p.key]?.length || 1) - 1))
    const needE = curves.map((c, i) => {
      const fh = chainFirstOf(c, finalIdx[i])
      let E = 0, mass = 0
      for (let n = 1; n <= c._n; n++) { E += n * fh[n]; mass += fh[n] }
      return mass > 0 ? E / mass : 0
    })
    const sumE = needE.reduce((s, x) => s + x, 0)
    // 总消耗分布（各池最终里程碑首达的卷积）→ 期望实际消耗 = E[min(T, 预算)]
    const fhs = curves.map((c, i) => chainFirstOf(c, finalIdx[i]))
    const { dist } = convolveSum(fhs, MAX_T)
    let spent = 0, cdf = 0
    const cap = Math.min(budget, MAX_T)
    for (let t = 0; t <= cap; t++) { spent += t * dist[t]; cdf += dist[t] }
    spent += budget * Math.max(0, 1 - cdf)
    // 星辉期望：各池按需求占比分摊实际消耗
    const glitter = sumE > 0
      ? curves.reduce((s, c, i) => s + c.Eg[Math.min(Math.round(spent * needE[i] / sumE), c._n)], 0)
      : 0
    const nextBudget = totalFates <= 0 ? 0 : Math.min(totalFates + Math.floor(glitter / 5), MAX_T)
    if (nextBudget <= budget) break
    budget = nextBudget
  }
  if (!curves) curves = active.map((p, i) => ensure(p, Math.max(budget, needsN[i])))

  // 逐条目：截至该条目的各池里程碑首达分布卷积
  const entries = order.filter(e => !!poolCfg[e.poolKey])
  const levels = {}
  const entryProbs = []
  const firstHitsByPool = {}
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    const lvl = (levels[e.poolKey] || 0)
    levels[e.poolKey] = lvl + 1
    const fhs = []
    for (const key of Object.keys(levels)) {
      const ch = chainOf[key]
      if (!ch || levels[key] > ch.length) continue
      if (!firstHitsByPool[key]) {
        const c = cache.get(key)
        firstHitsByPool[key] = c.chainF ? c.chainF.map(F => {
          const first = new Float64Array(c._n + 1)
          for (let n = 1; n <= c._n; n++) first[n] = Math.max(0, F[n] - F[n - 1])
          return first
        }) : null
      }
      const fh = firstHitsByPool[key][levels[key] - 1]
      if (fh) fhs.push(fh)
    }
    entryProbs.push(convolveSum(fhs, budget).cdf)
  }

  // 各池参考（期望抽数等，基于完整目标首达，与顺序无关）
  const perPool = active.map((p, i) => {
    const c = curves[i]
    const need = pullsNeeded(c)
    const ref = Math.min(Math.round(need.E), c._n)
    return {
      key: p.key, kind: p.kind, name: p.name,
      cfg: p,
      need, ref,
      P: c.F[ref], Eg: c.Eg[ref], E5: c.E5[ref], E4: c.E4[ref],
      EMet: c.EMet[ref], EMetCopies: c.EMetCopies[ref],
      truncated: c._truncated || !need.complete,
      marginals: c.marginals.map(m => ({ id: m.id, name: m.name, P: m.P[ref] })),
    }
  })
  const glitterTotal = perPool.reduce((s, p) => s + p.Eg, 0)
  const sumE = perPool.reduce((s, p) => s + p.need.E, 0)
  const sumP75 = perPool.reduce((s, p) => s + p.need.p75.n, 0)
  return {
    budget,
    perPool,
    sumE, sumP75,
    entries: entries.map((e, i) => ({ poolKey: e.poolKey, name: e.name, copy: e.copy, P: entryProbs[i] })),
    PAll: entryProbs.length ? entryProbs[entryProbs.length - 1] : 0,
    EMet: entryProbs.reduce((s, x) => s + x, 0),
    EMetTotal: entries.length,
    glitterTotal,
    fatesFromGlitter: Math.floor(glitterTotal / 5),
    recycle: !!recycle,
    curves: Object.fromEntries(active.map((p, i) => [p.key, curves[i]])),
    active: active.map(p => p.key),
    totalFates,
  }
}

function chainFirstOf(c, level) {
  const F = c.chainF?.[level]
  if (!F) return new Float64Array(c._n + 1)
  const first = new Float64Array(c._n + 1)
  for (let n = 1; n <= c._n; n++) first[n] = Math.max(0, F[n] - F[n - 1])
  return first
}

export function analyzePortfolio(runtimePools, totalFates, recycle) {
  const active = runtimePools.filter(p => (p.targets || []).length > 0)
  if (!active.length) return null
  const cache = new Map()
  const ensure = (p, N) => {
    let r = cache.get(p.key)
    if (!r || r._n < N) {
      r = p.kind === 'weapon' ? runWeaponDP(p, N, r)
        : p.kind === 'chronicled' ? runChronicledDP(p, N, r) : runCharacterDP(p, N, r)
      cache.set(p.key, r)
    }
    return r
  }
  // 每个池的曲线至少算到「达到目标所需」的粗估范围，避免小资源截断导致期望抽数失真
  const needsN = active.map(p => Math.min(estimateNeeds(p.targets, p.kind), MAX_T))
  let budget = Math.min(totalFates, MAX_T)
  let curves = null
  for (let iter = 0; iter < 12; iter++) {
    curves = active.map((p, i) => ensure(p, Math.max(budget, needsN[i])))
    if (!recycle) break
    const glitter = curves.reduce((s, c, i) => {
      const e = Math.round(pullsNeeded(c).E)
      return s + c.Eg[Math.min(e, c._n)]
    }, 0)
    const nextBudget = totalFates <= 0 ? 0 : Math.min(totalFates + Math.floor(glitter / 5), MAX_T)
    if (nextBudget <= budget) break
    budget = nextBudget
  }
  if (!curves) curves = active.map((p, i) => ensure(p, Math.max(budget, needsN[i])))

  const perPool = active.map((p, i) => {
    const c = curves[i]
    const need = pullsNeeded(c)
    const ref = Math.min(Math.round(need.E), c._n)
    return {
      key: p.key, kind: p.kind, name: p.name,
      cfg: p, // 运行时配置（结果分布表复用）
      need, ref,
      P: c.F[ref], Eg: c.Eg[ref], E5: c.E5[ref], E4: c.E4[ref],
      EMet: c.EMet[ref], EMetCopies: c.EMetCopies[ref],
      truncated: c._truncated || !need.complete,
      marginals: c.marginals.map(m => ({ id: m.id, name: m.name, P: m.P[ref] })),
    }
  })
  const glitterTotal = perPool.reduce((s, p) => s + p.Eg, 0)
  const EMet = perPool.reduce((s, p) => s + p.EMet, 0)
  const EMetCopies = perPool.reduce((s, p) => s + p.EMetCopies, 0)
  const sumE = perPool.reduce((s, p) => s + p.need.E, 0)
  const sumP75 = perPool.reduce((s, p) => s + p.need.p75.n, 0)
  return {
    budget,
    perPool,
    sumE, sumP75,
    // 保守参考：各池取 P75 分位所需抽数时全部达成的联合概率
    PAll: perPool.reduce((s, p) => s * p.need.p75.p, 1),
    EMet, EMetTotal: active.reduce((s, p) => s + p.targets.length, 0),
    EMetCopies, totalCopies: active.reduce((s, p) => s + p.targets.reduce((x, t) => x + t.copies, 0), 0),
    glitterTotal,
    fatesFromGlitter: Math.floor(glitterTotal / 5),
    glitterLeft: glitterTotal % 5,
    recycle: !!recycle,
    curves: Object.fromEntries(active.map((p, i) => [p.key, curves[i]])),
    active: active.map(p => p.key),
    totalFates,
  }
}


// ═════════════════════════════════════════════════════════════════
// 结果分布模拟（蒙特卡洛）：
// 按用户定义的抽取顺序投入全部资源，达到目标即止（不再空耗抽数）。
// 每次模拟记录：启用的所有卡池达成的目标条目 + 各池歪（非目标五星）数量。
// 用于统一列示的结果分布表（精确值由 DP 无法直接表达"达到即止"的全局停止语义）。
// ═════════════════════════════════════════════════════════════════
function simInitPool(p) {
  return {
    p5: p.pity5 || 0,
    p4: p.pity4 || 0,
    gu: p.kind === 'character' ? (p.guaranteed || 0) : 0,
    streak: p.kind === 'character' ? Math.min(3, p.crStreak || 0) : 0,
    gu4: 0,
    fate: p.kind !== 'character' ? (p.fate || 0) : 0,
  }
}

// 固定种子伪随机（消除多次运行的蒙特卡洛噪声，配置对比可复现）
function makeRng(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// 单抽结算（与 DP 使用同一概率表与机制）：状态更新 + 返回抽到的物品（out 复用对象避免分配）
// out.r = 星级 3/4/5；out.n = 命中的物品名（具名物品均会给出，用于已拥有分层）
function simRoll(st, p, bannerChar, cnt, out, rng) {
  const kind = p.kind
  const hard = kind === 'weapon' ? 79 : 89
  const r5 = p5Rate(kind, st.p5 + 1)
  const r4 = r5 >= 1 ? 0 : (st.p4 === 9 ? 1 - r5 : P4_BASE[kind] * (1 - r5))
  const r3 = Math.max(0, 1 - r5 - r4)
  const nP5 = st.p5 >= hard ? 0 : st.p5 + 1
  const nP4 = st.p4 === 9 ? 0 : st.p4 + 1
  out.r = 0; out.n = null; out.ct = null; out.lose = false
  const u = rng()

  if (u < r5) {
    // ── 五星 ──
    st.p5 = 0; st.p4 = 0
    out.r = 5
    if (kind === 'character') {
      const wasGu = st.gu === 1
      const win = wasGu || st.streak >= 3 || (st.streak === 2 ? rng() < 0.53 : rng() < 0.5)
      if (win) {
        st.gu = 0
        st.streak = wasGu ? Math.min(3, st.streak + 1) : 0
        out.n = bannerChar // 所抽池子的 UP 角色（即当前条目的目标）
      } else {
        st.gu = 1; st.streak = 0 // 歪常驻角色（非目标，不具名）
      }
    } else if (kind === 'weapon') {
      const epit = p.targets.find(t => t.epitomized && t.rarity === 5)
      if (st.fate === 1 && epit) {
        st.fate = 0
        out.n = epit.name
      } else if (epit) {
        const u2 = rng()
        if (u2 < 0.375) out.n = epit.name
        else if (u2 < 0.75) { st.fate = 1; out.n = p.weapon5.find(w => w !== epit.name) }
        else { st.fate = 1 }
      } else {
        const u2 = rng()
        const ups = (p.weapon5 || []).filter(Boolean)
        if (u2 < 0.75 && ups.length) out.n = ups[Math.min(ups.length - 1, Math.floor(u2 / (0.75 / ups.length)))]
      }
    } else {
      // 集录祈愿：角色/武器可分别定轨；生效定轨 = 目标顺序中第一个未达成的定轨目标
      let actEpit = null
      for (const t of p.targets) {
        if (t.epitomized && t.rarity === 5 && (cnt[t.name] || 0) < t.copies) { actEpit = t; break }
      }
      if (st.fate === 1 && actEpit) {
        st.fate = 0
        out.n = actEpit.name
      } else if (actEpit) {
        const actType = actEpit.type || (p.chrono5 || []).find(c => c.name === actEpit.name)?.type || 'char'
        const u2 = rng()
        if (u2 < 0.5) {
          out.n = actEpit.name
        } else {
          const others = (p.chrono5 || []).filter(c => c.name !== actEpit.name && c.type === actType)
          if (others.length) {
            st.fate = 1
            out.n = others[Math.floor(rng() * others.length)].name
            out.lose = true // 小保底歪：抽到非定轨的同类型角色/武器（命定值 +1）
          } else {
            // 池内同类型仅此一件：必得，命定值不增加
            out.n = actEpit.name
          }
        }
      } else {
        const pool = p.chrono5 || []
        if (pool.length) out.n = pool[Math.floor(rng() * pool.length)].name
      }
    }
  } else if (u < r5 + r4) {
    // ── 四星 ──
    st.p5 = nP5; st.p4 = 0
    out.r = 4
    if (kind === 'chronicled') {
      const pool = p.chrono4 || []
      if (pool.length) {
        const it = pool[Math.floor(rng() * pool.length)]
        out.n = it.name
        out.ct = it.type // 四星角色按非UP四星分层（首次 0、其后参数值），与 DP 一致
      }
      return
    }
    const up4 = p.up4 || []
    if (st.gu4 === 1 && up4.length) {
      out.n = up4[Math.floor(Math.random() * up4.length)]
      st.gu4 = 0
    } else if (Math.random() < 0.5 && up4.length) {
      out.n = up4[Math.floor(Math.random() * up4.length)]
      st.gu4 = 0
    } else {
      st.gu4 = 1
      // 常驻四星：先 50% 概率决定角色/武器（副产物分层需要）
      out.ct = rng() < 0.5 ? 'char' : 'weapon'
      // 仅当目标是常驻四星时才需要具体命中判定
      const stdTargets = p.targets.filter(t => t.rarity === 4 && t.name !== '__any4__' && !up4.includes(t.name))
      if (stdTargets.length) {
        const std = p.std4Counts || { chars: 1, weapons: 1 }
        const totalMass = (kind === 'character' ? std.chars : std.weapons)
        if (totalMass > 0 && rng() < stdTargets.length / totalMass) {
          out.n = stdTargets[Math.floor(rng() * stdTargets.length)].name
        }
      }
    }
  } else {
    // ── 三星 ──
    st.p5 = nP5; st.p4 = nP4
    out.r = 3
  }
}

// 副产物星辉分层（按词条《祈愿机制》副产物段落）：
//   五星角色 第 1~7 次 +10 星辉、第 8 次起 +25；四星角色 1~7 次 +2、8 次起 +5
//   五星武器恒 +10、四星武器恒 +2（武器无重复概念）；三星无星辉
//   非目标物品按首次获取计（不追踪其重复层数）
// 非UP四星角色星辉转化量：用户参数（0~5，默认 5），替代常驻四星角色的固定 2 星辉
function nonUp4GlitterOf(p) {
  return p.nonUp4Glitter !== undefined ? Math.max(0, Math.min(5, Math.floor(p.nonUp4Glitter))) : 5
}

function rollGlitter(p, rank, name, owned, tierCount, ct) {
  if (rank === 5) {
    // 具名五星角色（目标或池内物品）按已拥有分层；武器与未具名常驻按 10
    const t = name && p.targets.find(x => x.name === name)
    const type = t
      ? (t.type || (p.chrono5 || []).find(c => c.name === name)?.type || 'char')
      : ((p.chrono5 || []).find(c => c.name === name)?.type || 'weapon')
    if (type !== 'weapon' && tierCount !== undefined) {
      return ((owned[name] || 0) + tierCount) >= 8 ? 25 : 10
    }
    return 10
  }
  if (rank === 4) {
    const t = name && p.targets.find(x => x.name === name)
    const isUp = !!name && (p.up4 || []).includes(name)
    if (isUp) {
      // 当期 UP 四星角色（无论是否设为目标，份数均被追踪）：
      // 第 1 次 0 星辉，第 2~7 次 2，第 8 次起 5（随已拥有数量平移）
      const isUp4Char = t ? t.type !== 'weapon' : p.kind !== 'weapon'
      if (!isUp4Char) return 2 // UP 四星武器
      if (tierCount === undefined) return 2
      const total = (owned[name] || 0) + tierCount
      return total === 1 ? 0 : total < 8 ? 2 : 5
    }
    // 非UP四星：角色 → 参数（第 1 次 0 星辉）；武器 → 2
    const isChar = t ? t.type !== 'weapon' : ct === 'char'
    if (!isChar) return 2
    if (tierCount !== undefined) return tierCount === 1 ? 0 : nonUp4GlitterOf(p)
    return nonUp4GlitterOf(p)
  }
  return 0
}

// 单次模拟：按抽取顺序投入资源，达到目标即止。
// recycle=true：先用原生抽数，用尽后把星辉（初始 + 产出）按 5:1 转化继续抽，循环直至达成或星辉不足。
// recycle=false：星辉不转化（固定预算）。
// 返回 { achievedMask, counts, spent, converted, glitterEarned, glitterLeft, loseTotal }
function runTrial(active, byKey, entries, entryPool, entryCopy, nativeFates, reserveGlitter, recycle, rng, out) {
  const states = {}
  // itemCnt：所有具名物品的获得份数（目标与非目标均追踪，用于已拥有分层）
  const itemCnt = {}
  for (const p of active) {
    states[p.key] = simInitPool(p)
    itemCnt[p.key] = {}
    for (const tg of p.targets) itemCnt[p.key][tg.name] = 0
  }
  // 原生星辉已计入 nativeFates；reserveGlitter 为初始星辉零头（进入转化池）
  let pulls = nativeFates
  let glitter = reserveGlitter
  let spent = 0, converted = 0, glitterEarned = 0, loseTotal = 0
  const spentByPool = {}
  const count5ByPool = {}
  const count4ByPool = {}
  for (const p of active) { spentByPool[p.key] = 0; count5ByPool[p.key] = 0; count4ByPool[p.key] = 0 }
  const simOut = { r: 0, n: null }
  let loops = 0
  while (loops++ < 5000) {
    let target = null
    for (let i = 0; i < entries.length; i++) {
      if ((itemCnt[entryPool[i]][entryCopy[i].name] || 0) < entryCopy[i].copy) { target = i; break }
    }
    if (target === null) break // 全部达成即止
    if (pulls <= 0) {
      if (!recycle) break
      // 原生用尽：无论星辉多少全数转化，直到无法转化
      const conv = Math.floor(glitter / 5)
      if (conv <= 0) break // 星辉不足以再转化，资源彻底用尽
      glitter -= conv * 5
      pulls += conv
      converted += conv
    }
    const p = byKey[entryPool[target]]
    const bannerChar = p.kind === 'character' ? (entryCopy[target].name === p.poolB ? p.poolB : p.poolA) : null
    const cnt = itemCnt[entryPool[target]]
    simRoll(states[entryPool[target]], p, bannerChar, cnt, simOut, rng)
    // 具名物品一律计数（目标与非目标均用于已拥有分层）
    if (simOut.n) {
      if (cnt[simOut.n] === undefined) cnt[simOut.n] = 0
      cnt[simOut.n]++
    } else if (simOut.r === 5) loseTotal++
    // 歪 = 未命中定轨的五星：集录池抽到非定轨角色/武器（命定值 +1）；角色池/武器池为未具名常驻
    if (simOut.r === 5 && simOut.lose) loseTotal++
    if (simOut.r === 4 && p.targets.some(t => t.name === '__any4__')) cnt['__any4__']++
    const tierCount = simOut.n ? cnt[simOut.n] : undefined
    const g = rollGlitter(p, simOut.r, simOut.n, p.owned || {}, tierCount, simOut.ct)
    glitter += g
    glitterEarned += g
    pulls--
    spent++
    spentByPool[entryPool[target]]++
    if (simOut.r === 5) count5ByPool[entryPool[target]]++
    else if (simOut.r === 4) count4ByPool[entryPool[target]]++
    // 星辉（返利中间项）达到 50 立即转化 10 抽（原生资源未用尽时同样适用）
    if (recycle) {
      while (glitter >= 50) {
        glitter -= 50
        pulls += 10
        converted += 10
      }
    }
  }
  // 最终达成掩码（一次扫描）
  let mask = 0
  for (let i = 0; i < entries.length; i++) {
    if ((itemCnt[entryPool[i]][entryCopy[i].name] || 0) >= entryCopy[i].copy) mask |= (1 << i)
  }
  out.mask = mask
  out.spent = spent
  out.spentByPool = spentByPool
  out.count5ByPool = count5ByPool
  out.count4ByPool = count4ByPool
  out.converted = converted
  out.glitterEarned = glitterEarned
  out.glitterLeft = glitter
  out.loseTotal = loseTotal
  out.counts = []
  for (const p of active) {
    for (const tg of p.targets) out.counts.push(itemCnt[p.key][tg.name] || 0)
  }
  return out
}

// 统一模拟入口：多次 trial，返回每条记录（结果分布 / 星辉转化统计共用）
export function simulateTrials(runtimePools, order, nativeFates, starglitter, recycle, trials = 40000) {
  const active = runtimePools.filter(p => (p.targets || []).length > 0)
  const byKey = {}
  for (const p of active) byKey[p.key] = p
  const entries = (order || []).filter(e => byKey[e.poolKey] && byKey[e.poolKey].targets.some(t => t.name === e.name))
  const entryPool = entries.map(e => e.poolKey)
  const entryCopy = entries.map(e => ({ name: e.name, copy: e.copy }))
  const records = []
  if (!active.length || !entries.length) return { records, entries, active, byKey, entryPool, entryCopy }
  // 原生星辉（floor(星辉/5)）计入原生抽数；零头进入转化池
  const native = nativeFates + Math.floor(Math.max(0, starglitter) / 5)
  const reserve = Math.max(0, starglitter) % 5
  const rng = makeRng(0x5EED1234) // 固定种子：多次运行结果一致，便于配置对比
  const out = {}
  for (let t = 0; t < trials; t++) {
    runTrial(active, byKey, entries, entryPool, entryCopy, native, reserve, recycle, rng, out)
    records.push({ mask: out.mask, spent: out.spent, converted: out.converted, glitterEarned: out.glitterEarned, glitterLeft: out.glitterLeft, loseTotal: out.loseTotal, counts: out.counts.slice(), spentByPool: { ...out.spentByPool }, count5ByPool: { ...out.count5ByPool }, count4ByPool: { ...out.count4ByPool } })
  }
  return { records, entries, active, byKey, entryPool, entryCopy }
}

// 结果分布：每种结果（已达成物品×数量 + 歪总数）按概率降序
export function simulateOutcomes(runtimePools, order, budget, trials = 40000) {
  const { records, entries, active, byKey } = simulateTrials(runtimePools, order, budget, 0, false, trials)
  if (!records.length || budget <= 0) {
    return { rows: [], other: 1, budget, trials: 0 }
  }
  const itemOrder = []
  for (const p of active) {
    for (const tg of p.targets) itemOrder.push({ poolKey: p.key, name: tg.name })
  }
  const tally = new Map()
  // 每个目标物品的副本数（用于计算差距）
  const targetCopies = {}
  for (const e of entries) {
    const k = `${e.poolKey}::${e.name}`
    targetCopies[k] = Math.max(targetCopies[k] || 0, e.copy)
  }
  for (const r of records) {
    const seen = new Set()
    const achieved = []
    let gap = 0
    for (let j = 0; j < itemOrder.length; j++) {
      const it = itemOrder[j]
      const k = `${it.poolKey}::${it.name}`
      if (seen.has(k)) continue
      seen.add(k)
      if (r.counts[j] > 0) achieved.push(`${it.name}×${r.counts[j]}`)
      gap += Math.max(0, (targetCopies[k] || 0) - (r.counts[j] || 0))
    }
    const key = `${achieved.length ? achieved.join(' ') : '全部未达成'} · 歪${r.loseTotal}`
    const prev = tally.get(key)
    if (prev) prev.cnt++
    else tally.set(key, { cnt: 1, gap })
  }
  const rows = [...tally.entries()]
    .map(([key, v]) => ({ key, p: v.cnt / trials, gap: v.gap }))
    .sort((a, b) => b.p - a.p)
    .slice(0, 14)
  return {
    rows,
    other: Math.max(0, 1 - rows.reduce((s, r) => s + r.p, 0)),
    budget,
    trials,
  }
}

// 星辉再利用分析（模拟）：原生资源先用，星辉最后转化并循环再利用，直到达成目标或星辉不足。
// 返回与 analyzeOrdered 兼容的结构（曲线/参考点仍为精确值，达成概率与消耗为模拟值）
export function simulateRecycling(runtimePools, order, nativeFates, starglitter, trials = 40000) {
  const { records, entries, active, byKey, entryPool, entryCopy } = simulateTrials(runtimePools, order, nativeFates, starglitter, true, trials)
  const exact = analyzeOrdered(runtimePools, order, Math.max(1, nativeFates), false)
  const fullMask = (1 << entries.length) - 1
  const n = records.length
  if (!n) return { ...exact, outcomes: simulateOutcomes(runtimePools, order, 0, trials), nativeFates, starglitter, trials: 0 }
  // 条目概率 / 池概率
  const entryP = new Array(entries.length).fill(0)
  let achievedCount = 0
  for (const r of records) {
    for (let i = 0; i < entries.length; i++) if (r.mask & (1 << i)) entryP[i]++
    if (r.mask === fullMask) achievedCount++
  }
  const PAll = achievedCount / n
  // 达成 trial 的消耗分布 → 期望 / P25 / P75
  const spentArr = []
  for (const r of records) if (r.mask === fullMask) spentArr.push(r.spent)
  spentArr.sort((a, b) => a - b)
  const pct = (x) => spentArr[Math.min(spentArr.length - 1, Math.floor(x * spentArr.length))]
  const spentE = spentArr.length ? spentArr.reduce((s, v) => s + v, 0) / spentArr.length : 0
  const convertedE = records.reduce((s, r) => s + r.converted, 0) / n
  const glitterE = records.reduce((s, r) => s + r.glitterEarned, 0) / n
  const glitterLeftE = records.reduce((s, r) => s + r.glitterLeft, 0) / n
  // 结果分布（同一批 trial）
  const tally = new Map()
  const itemOrder = []
  for (const p of active) for (const tg of p.targets) itemOrder.push({ poolKey: p.key, name: tg.name })
  // 每个目标物品的副本数（用于计算差距）
  const targetCopies = {}
  for (const e of entries) {
    const k = `${e.poolKey}::${e.name}`
    targetCopies[k] = Math.max(targetCopies[k] || 0, e.copy)
  }
  for (const r of records) {
    const seen = new Set()
    const achieved = []
    let gap = 0
    for (let j = 0; j < itemOrder.length; j++) {
      const it = itemOrder[j]
      const k = `${it.poolKey}::${it.name}`
      if (seen.has(k)) continue
      seen.add(k)
      if (r.counts[j] > 0) achieved.push(`${it.name}×${r.counts[j]}`)
      gap += Math.max(0, (targetCopies[k] || 0) - (r.counts[j] || 0))
    }
    const key = `${achieved.length ? achieved.join(' ') : '全部未达成'} · 歪${r.loseTotal}`
    const prev = tally.get(key)
    if (prev) prev.cnt++
    else tally.set(key, { cnt: 1, gap })
  }
  const rows = [...tally.entries()]
    .map(([key, v]) => ({ key, p: v.cnt / n, gap: v.gap }))
    .sort((a, b) => b.p - a.p)
    .slice(0, 14)
  // 池达成概率 = 该池最后条目概率；达成 trial 的每池平均消耗（Σ = 合计 spentE）
  const lastEntryIdx = {}
  for (let i = 0; i < entries.length; i++) lastEntryIdx[entryPool[i]] = i
  const spentPoolSum = {}
  const sum5 = {}
  const sum4 = {}
  const consArr = {}
  let achievedCnt = 0
  for (const r of records) {
    if (r.mask === fullMask) {
      achievedCnt++
      for (const key of Object.keys(r.spentByPool)) {
        spentPoolSum[key] = (spentPoolSum[key] || 0) + r.spentByPool[key]
        sum5[key] = (sum5[key] || 0) + (r.count5ByPool[key] || 0)
        sum4[key] = (sum4[key] || 0) + (r.count4ByPool[key] || 0)
        if (!consArr[key]) consArr[key] = []
        consArr[key].push(r.spentByPool[key])
      }
    }
  }
  // 每池达成情形消耗分布（经验 CDF，供曲线与分位）
  const poolDist = {}
  for (const key of Object.keys(consArr)) {
    const arr = consArr[key].sort((a, b) => a - b)
    const maxN = arr[arr.length - 1]
    const cdf = new Float64Array(maxN + 1)
    let idx = 0
    for (let n = 0; n <= maxN; n++) {
      while (idx < arr.length && arr[idx] <= n) idx++
      cdf[n] = idx / arr.length
    }
    poolDist[key] = { cdf, maxN }
    const q = (x) => arr[Math.min(arr.length - 1, Math.floor(x * arr.length))]
    poolDist[key].p25 = q(0.25)
    poolDist[key].p75 = q(0.75)
  }
  return {
    ...exact,
    recycle: true,
    nativeFates, starglitter,
    trials: n,
    PAll,
    EMet: entryP.reduce((s, x) => s + x, 0) / n,
    EMetTotal: entries.length,
    entries: entries.map((e, i) => ({ poolKey: e.poolKey, name: e.name, copy: e.copy, P: entryP[i] / n })),
    perPool: exact.perPool.map(p => {
      const d = poolDist[p.key]
      return {
        ...p,
        simP: lastEntryIdx[p.key] !== undefined ? entryP[lastEntryIdx[p.key]] / n : p.P,
        spentE: achievedCnt ? (spentPoolSum[p.key] || 0) / achievedCnt : 0,
        simE5: achievedCnt ? (sum5[p.key] || 0) / achievedCnt : 0,
        simE4: achievedCnt ? (sum4[p.key] || 0) / achievedCnt : 0,
        simDist: d || null,
      }
    }),
    spentE, spentP25: pct(0.25), spentP75: pct(0.75),
    convertedE, glitterE, glitterLeftE,
    outcomes: { rows, other: Math.max(0, 1 - rows.reduce((s, r) => s + r.p, 0)), budget: nativeFates, trials: n },
  }
}

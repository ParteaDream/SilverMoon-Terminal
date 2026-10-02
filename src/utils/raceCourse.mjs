// ═══════════════════════════════════════════════════════════════════════════
// 归火圣夜巡礼 · 赛道生成器
//
// 纯 JS（零 DOM 依赖）：浏览器渲染层与 Node 无头仿真测试共用同一份实现。
//
// 设计约束（保证「足够通过率」的核心）：
//   1. 每一层（chamber）的底面都是「漏斗」——从两侧墙壁向中央/偏移的缺口倾斜，
//      落在底面上的球一定会滚进缺口，不存在平地停留点。
//   2. 除终点水池外，全赛道禁止水平面：所有平台/蹦床/传送带都带 8°~22° 倾角。
//   3. 机关只允许占用局部空间（≤ 0.66 竖井宽），永远给球留下通路。
//   4. 生成后用「只许横移与下落」的有向洪水填充做可达性校验（模拟重力方向），
//      不通过的层直接重掷；连续失败则回退到必然可通的保底层。
// ═══════════════════════════════════════════════════════════════════════════

export const RACE = {
  // 窄井设计：井宽 ≈ 15 个球径，机关能横向铺满，球无法从旁边直接飘落
  shaftWidth: 460,        // 竖井内净宽（世界单位）
  wallThickness: 30,      // 侧壁视觉厚度
  ballRadius: 15,         // 球半径（球径 30）
  gravity: 1750,          // 重力加速度 px/s²
  dragK: 0.0151,          // 二次空气阻力 a = -k·|v|·v（终端速度 = √(g/k) ≈ 340）
  maxSpeed: 1250,         // 速度上限（弹射回送需要 ~1150，1/240 子步位移 5.2px 仍不穿模）
  substeps: 4,            // 每帧子步数（60fps 下 1/240 s）
  restThreshold: 52,      // 法向速度低于此值不再反弹（消除抖动）
  friction: 0.10,         // 库仑摩擦系数
  restitution: 0.34,      // 默认弹性
  chamberHeight: 620,     // 单层高度（≈ 一屏，镜头能完整跟住一层）
  chamberCount: 28,       // 层数
  preludeHeight: 300,     // 起跑加速段
  gapWidth: 96,           // 底面缺口宽度（球直径的 3.2 倍）
  funnelSlope: 0.26,      // 漏斗坡度（≈14.6°），保证球能顺畅滚入缺口
  finishOffset: 170,      // 终点线相对最后一层底面的偏移
  basinOffset: 360,       // 终点水池底面偏移
  maxRaceTime: 300,       // 硬性上限（秒），超过后强制结算
  assistStallTime: 4.2,   // 停滞判定时长（秒）——比常规放松，让「卡关-挤位-突围」有时间发生
  assistStallRadius: 88,  // 停滞判定半径：在该半径内徘徊超过时长才算卡死
  maxAssistLevel: 3,      // 达到该等级直接「夜魂转移」至本层缺口
  reworkMercy: 5,         // 同一层被流水线回送超过该次数 → 机器放行（收敛兜底）
  catchUpGap: 2,          // 领先者比最后一名多推进 N 层 → 最后一名所在层整体放行
  catchUpHold: 3.5,       // 放行后给领先者的额外缓冲（秒），避免连续触发
}

// ── 随机数 ────────────────────────────────────────────────────────────────
export function createRng(seed) {
  let a = (seed >>> 0) || 0x9e3779b9
  return function rng() {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function rand(rng, lo, hi) { return lo + rng() * (hi - lo) }
function randInt(rng, lo, hi) { return lo + Math.floor(rng() * (hi - lo + 1)) }
function pick(rng, arr) { return arr[Math.floor(rng() * arr.length) % arr.length] }
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v }

function weightedPick(rng, items) {
  let total = 0
  for (const it of items) total += it.weight
  let r = rng() * total
  for (const it of items) {
    r -= it.weight
    if (r <= 0) return it
  }
  return items[items.length - 1]
}

// ── 碰撞体工厂 ────────────────────────────────────────────────────────────
export function seg(ax, ay, bx, by, o = {}) {
  return {
    k: 'seg', ax, ay, bx, by,
    rad: o.rad ?? 8,
    e: o.e ?? RACE.restitution,
    mu: o.mu ?? RACE.friction,
    look: o.look ?? 'stone',
    boost: o.boost ?? 0,
    svel: o.svel ?? null,
    spin: o.spin ?? null,
  }
}

export function cir(x, y, r, o = {}) {
  return {
    k: 'cir', x, y, r,
    e: o.e ?? RACE.restitution,
    mu: o.mu ?? RACE.friction,
    look: o.look ?? 'stone',
    boost: o.boost ?? 0,
    svel: o.svel ?? null,
    spin: o.spin ?? null,
  }
}

// ── 运动学机关：几何 = f(时间) ────────────────────────────────────────────
// 每个描述符都带 period（周期，秒），校验器按周期采样，物理层按仿真时间求值。
// kinematicPartsAt(desc, t, out) 会「原地填充」out 数组，避免每帧产生垃圾。

export function gearDesc(x, y, r, o = {}) {
  return {
    k: 'gear', x, y, r,
    teeth: o.teeth ?? 10,
    toothLen: o.toothLen ?? 24,
    toothRad: o.toothRad ?? 8,
    omega: o.omega ?? 2.2,
    phase: o.phase ?? 0,
    look: o.look ?? 'gear',
    period: (2 * Math.PI) / Math.abs(o.omega ?? 2.2),
  }
}

export function pendulumDesc(px, py, len, o = {}) {
  return {
    k: 'pendulum', px, py, len,
    bobR: o.bobR ?? 34,
    amp: o.amp ?? 0.62,
    freq: o.freq ?? 1.05,
    phase: o.phase ?? 0,
    look: o.look ?? 'pendulum',
    period: 1 / (o.freq ?? 1.05),
  }
}

export function rotorDesc(x, y, len, o = {}) {
  return {
    k: 'rotor', x, y, len,
    arms: o.arms ?? 2,
    armRad: o.armRad ?? 11,
    omega: o.omega ?? 1.9,
    phase: o.phase ?? 0,
    look: o.look ?? 'rotor',
    period: (2 * Math.PI) / Math.abs(o.omega ?? 1.9),
  }
}

/**
 * 往复运动平台
 * @param {'along'|'x'|'y'} axis 运动轴：along = 沿平台自身方向
 */
export function sliderDesc(ax, ay, bx, by, o = {}) {
  const freq = o.freq ?? 0.55
  const span = Math.hypot(bx - ax, by - ay)
  return {
    k: 'slider', ax, ay, bx, by,
    rad: o.rad ?? 10,
    amp: o.amp ?? span,
    axis: o.axis ?? 'along',
    wave: o.wave ?? 'sin',
    k2: o.k2 ?? 3.2,
    bias: o.bias ?? 0,
    validateAt: o.validateAt != null ? o.validateAt : null,
    freq,
    phase: o.phase ?? 0,
    look: o.look ?? 'slider',
    // 表面速度峰值 = amp * 2πf（供渲染层画残影）
    svelAmp: (o.amp ?? span) * freq * 2 * Math.PI,
    period: 1 / freq,
  }
}

/**
 * 摆动闸门：绕枢轴在「合拢 / 敞开」两个状态间翻转（方波化，保证两种状态各自稳定可读）
 * base/amp 使用画布角度（0=+x，顺时针为正）。
 * validateAt 指定「合拢」相位，可达性校验只按该相位采样。
 */
export function flapperDesc(px, py, len, o = {}) {
  const freq = o.freq ?? 0.4
  return {
    k: 'flapper', px, py, len,
    rad: o.rad ?? 9,
    base: o.base ?? Math.PI * 1.09,
    amp: o.amp ?? -Math.PI * 0.49,
    freq,
    phase: o.phase ?? 0,
    look: o.look ?? 'door',
    k2: o.k2 ?? 3.4,
    bias: o.bias ?? 0,
    validateAt: o.validateAt ?? 0.75,
    period: 1 / freq,
  }
}

export function kinematicPartCount(desc) {
  switch (desc.k) {
    case 'gear': return 1 + desc.teeth
    case 'pendulum': return 2      // 锁链（视觉用，不参与碰撞）+ 摆锤
    case 'rotor': return desc.arms
    case 'slider': return 1
    case 'flapper': return 1
    default: return 0
  }
}

function writeSeg(out, ax, ay, bx, by, o) {
  out.k = 'seg'; out.ax = ax; out.ay = ay; out.bx = bx; out.by = by
  out.rad = o.rad ?? 8
  out.e = o.e ?? RACE.restitution
  out.mu = o.mu ?? RACE.friction
  out.look = o.look ?? 'stone'
  out.boost = o.boost ?? 0
  out.svel = o.svel ?? null
  out.spin = o.spin ?? null
  return out
}

function writeCir(out, x, y, r, o) {
  out.k = 'cir'; out.x = x; out.y = y; out.r = r
  out.e = o.e ?? RACE.restitution
  out.mu = o.mu ?? RACE.friction
  out.look = o.look ?? 'stone'
  out.boost = o.boost ?? 0
  out.svel = o.svel ?? null
  out.spin = o.spin ?? null
  return out
}

export function makePart() {
  return writeCir({}, 0, 0, 1, {})
}

/**
 * 求值机关在时刻 t 的几何。
 * @param {object} d 机关描述符
 * @param {number} t 时间（秒）
 * @param {Array} out 长度 ≥ kinematicPartCount(d) 的可复用数组
 */
export function kinematicPartsAt(d, t, out) {
  switch (d.k) {
    case 'gear': {
      const ang = d.phase + d.omega * t
      const spin = { cx: d.x, cy: d.y, omega: d.omega }
      writeCir(out[0], d.x, d.y, d.r, { look: d.look, e: 0.42, mu: 0.14, spin })
      for (let i = 0; i < d.teeth; i++) {
        const a = ang + (i / d.teeth) * Math.PI * 2
        const ca = Math.cos(a), sa = Math.sin(a)
        writeSeg(out[1 + i],
          d.x + ca * (d.r - 2), d.y + sa * (d.r - 2),
          d.x + ca * (d.r + d.toothLen), d.y + sa * (d.r + d.toothLen),
          { rad: d.toothRad, look: 'gear', e: 0.52, mu: 0.16, spin })
      }
      return out
    }
    case 'pendulum': {
      const ang = Math.PI / 2 + Math.sin(d.phase + t * d.freq * Math.PI * 2) * d.amp
      const bx = d.px + Math.cos(ang) * d.len
      const by = d.py + Math.sin(ang) * d.len
      writeSeg(out[0], d.px, d.py, bx, by, { rad: 3, look: 'chain', e: 0.2, mu: 0.1 })
      // 摆锤表面速度：绕枢轴 ω = amp * 2πf * cos(...)
      const omega = d.amp * 2 * Math.PI * d.freq * Math.cos(d.phase + t * d.freq * Math.PI * 2)
      writeCir(out[1], bx, by, d.bobR, { look: d.look, e: 0.62, mu: 0.12, spin: { cx: d.px, cy: d.py, omega } })
      return out
    }
    case 'rotor': {
      const ang = d.phase + d.omega * t
      const spin = { cx: d.x, cy: d.y, omega: d.omega }
      for (let i = 0; i < d.arms; i++) {
        const a = ang + (i / d.arms) * Math.PI * 2
        const ca = Math.cos(a), sa = Math.sin(a)
        writeSeg(out[i], d.x, d.y, d.x + ca * d.len, d.y + sa * d.len,
          { rad: d.armRad, look: d.look, e: 0.5, mu: 0.16, spin })
      }
      return out
    }
    case 'flapper': {
      const w = (d.period ? 1 / d.period : d.freq) * Math.PI * 2
      const th = d.phase + t * w
      const k = d.k2 ?? 3.4
      const s1 = Math.sin(th) - (d.bias || 0)
      const tk = Math.tanh(k)
      const u = 0.5 + 0.5 * (Math.tanh(k * s1) / tk)          // 0=合拢 1=敞开
      const sech2 = 1 - Math.tanh(k * s1) ** 2
      const dud = 0.5 * k * Math.cos(th) * sech2 / tk
      const ang = d.base + d.amp * u
      writeSeg(out[0], d.px, d.py,
        d.px + Math.cos(ang) * d.len, d.py + Math.sin(ang) * d.len,
        { rad: d.rad, look: d.look, e: 0.26, mu: 0.14, spin: { cx: d.px, cy: d.py, omega: d.amp * dud * w } })
      return out
    }
    case 'slider': {
      const w = d.freq * Math.PI * 2
      const th = d.phase + t * w
      let u, du
      if (d.wave === 'square') {
        const k = d.k2 ?? 3.2
        const s1 = Math.sin(th) - (d.bias || 0)
        const tk = Math.tanh(k)
        u = d.bias ? (Math.tanh(k * s1) / tk) : (Math.tanh(k * Math.sin(th)) / tk)
        const sech2 = 1 - Math.tanh(k * s1) ** 2
        du = k * Math.cos(th) * sech2 / tk * w
      } else {
        u = Math.sin(th)
        du = Math.cos(th) * w
      }
      const dx = d.bx - d.ax, dy = d.by - d.ay
      const len = Math.hypot(dx, dy) || 1
      let ux = 0, uy = 0
      if (d.axis === 'x') ux = 1
      else if (d.axis === 'y') uy = 1
      else { ux = dx / len; uy = dy / len }
      const ox = ux * d.amp * u, oy = uy * d.amp * u
      writeSeg(out[0], d.ax + ox, d.ay + oy, d.ax + ox + dx, d.ay + oy + dy, {
        rad: d.rad, look: d.look, e: 0.42, mu: 0.12,
        svel: { vx: ux * d.amp * du, vy: uy * d.amp * du },
      })
      return out
    }
    default:
      return out
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 装饰件（不参与碰撞）
// ═══════════════════════════════════════════════════════════════════════════
function deco(k, x, y, o = {}) {
  return { k, x, y, s: o.s ?? 1, a: o.a ?? 0, phase: o.phase ?? 0, variant: o.variant ?? 0 }
}

// ═══════════════════════════════════════════════════════════════════════════
// 流水线层（Machine Chamber）
//
// 每一层都是一台完整的机器，球必须走完流程才能离开：
//
//      ↓ 上一层缺口落下的球
//   ┌───────────────────────────────┐
//   │   ╲   料斗（漏斗）          ╱  │  ← 汇入入口井
//   │    ╲_______________________╱   │
//   │         ┌─────────┐            │
//   │         │ 工位 1  │  回送竖井  │  ← 滚轮 / 吹风 / 摆锤
//   │         │ 工位 2  │   （弹射   │
//   │         └────┬────┘    回起点）│
//   │         ┌────┴────┐            │
//   │  合格 → │ 活动盖板 │ ← 不合格   │
//   │         └─────────┘   落回回送 │
//   │   出口漏斗 → 底部缺口 → 下一层 │
//   └───────────────────────────────┘
//
// 判定：盖板合上 → 球从盖板滚向右下方的出口（过关）；盖板打开 → 球穿过
// 井底落入回送滑道，滚到弹射器上被弹回本层料斗（重走）。
// ═══════════════════════════════════════════════════════════════════════════

/** 工位：贴壁滚轮（齿轮压辊） */
function stationRoller(rng, ctx, y, side) {
  const r = rand(rng, 16, 22)
  const x = side < 0 ? ctx.L + 12 : ctx.R - 12
  const teeth = randInt(rng, 8, 10)
  const toothLen = 7
  const omega = (side < 0 ? 1 : -1) * rand(rng, 2.2, 4.0)
  return {
    kinematics: [gearDesc(x, y, r, { teeth, toothLen, toothRad: 7, omega, phase: rng() * TAU })],
    statics: [], fields: [],
    tag: 'roller', name: '压辊',
    decor: [deco('glyph', x, y, { s: 0.5, phase: rng() * 6.28 })],
    height: (r + toothLen + 7) * 2 + 26,
  }
}

/** 工位：横吹喷嘴（把球吹向另一侧，拖延通过时间） */
function stationBlower(rng, ctx, y, side) {
  const dir = side
  const bx = dir > 0 ? ctx.L - 12 : ctx.R + 12
  const h = rand(rng, 62, 84)
  const bodyR = 20
  const reach = MACHINE.shaftHalf * 2
  return {
    statics: [cir(bx, y + h * 0.4, bodyR, { e: 0.35, mu: 0.2, look: 'fanbody' })],
    kinematics: [],
    fields: [{
      k: 'wind',
      x: dir > 0 ? ctx.L - 6 : ctx.R - reach + 6,
      y, w: reach, h,
      ax: dir * rand(rng, 900, 1250), ay: 0,
      look: 'wind',
    }],
    tag: 'blower', name: '吹风工位',
    decor: [deco('fan', bx, y + h * 0.4, { s: 0.72, a: dir > 0 ? 0 : Math.PI })],
    height: h + 34,
  }
}

/** 工位：导向钉（把球拨向井心） */
function stationPins(rng, ctx, y) {
  const out = []
  const side = rng() < 0.5 ? -1 : 1
  out.push(cir(side < 0 ? ctx.L + 8 : ctx.R - 8, y, rand(rng, 11, 14), { e: 0.62, mu: 0.05, look: 'peg' }))
  out.push(cir(side < 0 ? ctx.R - 8 : ctx.L + 8, y + 34, rand(rng, 11, 14), { e: 0.62, mu: 0.05, look: 'peg' }))
  return { statics: out, kinematics: [], fields: [], decor: [], tag: 'pins', name: '导向钉', height: 78 }
}

const STATIONS = [
  { id: 'roller', weight: 2.0, build: stationRoller },
  { id: 'blower', weight: 1.7, build: stationBlower },
  { id: 'pins', weight: 1.5, build: stationPins },
]


/**
 * 生成一整台机器。
 * ctx: { y0, y1, W, gapX, entryX0, entryX1, index }
 */
// ═══════════════════════════════════════════════════════════════════════════
// 双通道流水线层（Dual-Lane Machine）
//
// 每层是一台**左右两条独立支线**的机器，两条支线共用料斗与入口井、共用回送区，
// 但各自有独立的加工工位、判定闸门与出口缺口：
//
//        ↓ 上一层落下的球
//   ┌──────────────────────────────────┐
//   │   ╲          料斗            ╱   │  两侧斜板汇入入口井
//   │    ╲________________________╱    │
//   │        ┌──────────────┐          │
//   │        │  入口井+工位 │          │  压辊 / 风选 / 导向钉
//   │        └───────┬──────┘          │
//   │           分料楔（中央）          │  随机把球分进左右支线
//   │   ┌────────┐        ┌────────┐   │
//   │   │ 左工位 │        │ 右工位 │   │
//   │   │ 左闸门 │        │ 右闸门 │   │  各自独立计时
//   │   └───┬────┘        └────┬───┘   │
//   │   合格↓                  ↓合格    │
//   │  ◄左缺口►  回送区  ◄右缺口►      │  不合格落回送区 → 弹射回入口
//   └──────────────────────────────────┘
// ═══════════════════════════════════════════════════════════════════════════

export const MACHINE = {
  hopperTop: 138,      // 料斗两侧斜板上沿
  hopperBottom: 258,   // 料斗汇聚（= 入口井上沿）
  shaftHalf: 78,       // 入口井半宽（井宽 156，分料后每条支线 72）
  splitY: 386,         // 分料楔顶
  laneBottom: 412,     // 分料楔底 = 支线闸门平面
  doorY: 420,          // 闸门高度
  gapL: 108,           // 左支线出口缺口中心
  gapR: 352,           // 右支线出口缺口中心
  sepInset: 44,        // 分隔墙相对缺口中心的偏移
  zoneTop: 432,        // 回送触发区顶
  launchSpeed: 1150,   // 回送弹射初速
}

/** 双缺口层底：两个出口缺口各自的漏斗 + 中间隆起 */
function buildFloor2(gapL, gapR, floorY, W) {
  const half = RACE.gapWidth / 2
  const slope = RACE.funnelSlope
  const out = []
  // 左外侧漏斗：左壁 → 左缺口左沿
  out.push(seg(0, floorY - (gapL - half) * slope, gapL - half, floorY, { rad: FLOOR_RAD, e: 0.24, mu: 0.1, look: 'floor' }))
  // 左缺口右沿 → 中央隆起顶
  const midRise = 26
  out.push(seg(gapL + half, floorY, W / 2, floorY - midRise, { rad: FLOOR_RAD, e: 0.24, mu: 0.1, look: 'floor' }))
  // 中央隆起顶 → 右缺口左沿
  out.push(seg(W / 2, floorY - midRise, gapR - half, floorY, { rad: FLOOR_RAD, e: 0.24, mu: 0.1, look: 'floor' }))
  // 右缺口右沿 → 右壁
  out.push(seg(gapR + half, floorY, W, floorY - (W - gapR - half) * slope, { rad: FLOOR_RAD, e: 0.24, mu: 0.1, look: 'floor' }))
  return out
}

/** 支线工位（贴支线外壁的小型机构，不堵死通道） */
function laneStation(rng, ctx, y, side, laneL, laneR) {
  const W = ctx.W
  const roll = rng()
  if (roll < 0.42) {
    // 贴壁压辊
    const r = rand(rng, 13, 17)
    const x = side < 0 ? laneL + 11 : laneR - 11
    return {
      statics: [],
      kinematics: [gearDesc(x, y, r, {
        teeth: randInt(rng, 7, 9), toothLen: 6, toothRad: 5,
        omega: (side < 0 ? 1 : -1) * rand(rng, 2.4, 4.2), phase: rng() * TAU,
      })],
      fields: [],
      decor: [deco('glyph', x, y, { s: 0.42, phase: rng() * 6.28 })],
      tag: 'roller', name: '支线压辊',
      height: (r + 11) * 2 + 16,
    }
  }
  if (roll < 0.74) {
    // 侧吹喷嘴
    const h = rand(rng, 52, 68)
    const bx = side < 0 ? laneL - 10 : laneR + 10
    const reach = laneR - laneL + 20
    return {
      statics: [cir(bx, y + h * 0.4, 15, { e: 0.35, mu: 0.2, look: 'fanbody' })],
      kinematics: [],
      fields: [{
        k: 'wind', x: side < 0 ? laneL - 6 : laneL - 14, y, w: reach, h,
        ax: side * rand(rng, 720, 980), ay: 0, look: 'wind',
      }],
      decor: [deco('fan', bx, y + h * 0.4, { s: 0.6, a: side > 0 ? 0 : Math.PI })],
      tag: 'blower', name: '支线风选',
      height: h + 22,
    }
  }
  // 导向钉
  const out = [cir(side < 0 ? laneL + 8 : laneR - 8, y, rand(rng, 9, 11), { e: 0.62, mu: 0.05, look: 'peg' })]
  out.push(cir(side < 0 ? laneR - 8 : laneL + 8, y + 26, rand(rng, 9, 11), { e: 0.62, mu: 0.05, look: 'peg' }))
  return { statics: out, kinematics: [], fields: [], decor: [], tag: 'pins', name: '支线导向钉', height: 58 }
}

/** 支线闸门：合拢→球沿门板滚向外侧缺口；敞开→球落进回送区 */
function buildLaneGate(rng, kinematics, decor, y0, hingeX, spanX, len, mirrorDir) {
  const period = rand(rng, 2.5, 3.4)
  const phase = rng() * TAU
  const validateAt = (((-Math.PI / 2 - phase) / TAU) % 1 + 1) % 1
  // 合拢态：自由端略高于枢轴 → 球朝枢轴（外侧缺口）滚
  const base = mirrorDir > 0 ? Math.PI * 1.10 : -Math.PI * 0.10
  kinematics.push(flapperDesc(hingeX, y0 + MACHINE.doorY, len, {
    base,
    amp: mirrorDir > 0 ? -Math.PI * 0.47 : Math.PI * 0.47,
    freq: 1 / period,
    phase,
    rad: 8,
    validateAt,
    bias: 0.12,
    look: 'door',
  }))
  decor.push(deco('doorLamp', hingeX + mirrorDir * spanX * 0.5, y0 + MACHINE.doorY - 24, { s: 0.9, phase: rng() * 6.28 }))
  return period
}

/**
 * 生成一台双通道机器。
 * ctx: { y0, y1, W, entryX0, entryX1, index, gapX(兼容用) }
 */
function buildMachine(rng, ctx) {
  const { y0, y1, W } = ctx
  const M = MACHINE
  const statics = []
  const kinematics = []
  const fields = []
  const decor = []
  const tags = []
  const names = []

  // 两个出口缺口：左右各一，位置小幅随机
  const gapL = clamp(M.gapL + rand(rng, -16, 16), RACE.gapWidth / 2 + 34, W * 0.42)
  const gapR = W - gapL + rand(rng, -20, 20)
  statics.push(...buildFloor2(gapL, gapR, y1, W))

  // ── 料斗 ────────────────────────────────────────────────────────────────
  const inletX = clamp(W * 0.5 + rand(rng, -24, 24), 200, W - 200)
  const L = inletX - M.shaftHalf
  const R = inletX + M.shaftHalf
  statics.push(seg(6, y0 + M.hopperTop, L, y0 + M.hopperBottom, { rad: 11, e: 0.2, mu: 0.13, look: 'hopper' }))
  statics.push(seg(W - 6, y0 + M.hopperTop, R, y0 + M.hopperBottom, { rad: 11, e: 0.2, mu: 0.13, look: 'hopper' }))
  // 入口井导壁（只到分料楔上方）
  // 井壁在闸门上方 86px 收口：否则球无法沿闸门板滚到枢轴（会被壁端死角卡住）
  statics.push(seg(L, y0 + M.hopperBottom - 6, L, y0 + M.doorY - 86, { rad: 7, e: 0.3, mu: 0.09, look: 'housing' }))
  statics.push(seg(R, y0 + M.hopperBottom - 6, R, y0 + M.doorY - 86, { rad: 7, e: 0.3, mu: 0.09, look: 'housing' }))

  // ── 入口井工位（共用段，1~2 个）────────────────────────────────────────
  let y = y0 + M.hopperBottom + 12
  const stBottom = y0 + M.splitY - 24
  const stationCount = rng() < 0.55 ? 2 : 1
  for (let i = 0; i < stationCount && y < stBottom - 60; i++) {
    const st = weightedPick(rng, STATIONS)
    const side = rng() < 0.5 ? -1 : 1
    const built = st.build(rng, { W, inletX, L, R, chamberTop: y0 }, y, side)
    if (!built || y + built.height > stBottom) break
    statics.push(...built.statics)
    kinematics.push(...built.kinematics)
    fields.push(...built.fields)
    decor.push(...built.decor)
    tags.push(built.tag)
    names.push(built.name)
    y += built.height + rand(rng, 8, 18)
  }
  if (!tags.length) {
    const built = stationPins(rng, { W, inletX, L, R }, y0 + M.hopperBottom + 26)
    statics.push(...built.statics)
    tags.push(built.tag); names.push(built.name)
  }

  // ── 分料楔：把入口井一分为二 ────────────────────────────────────────────
  statics.push(seg(inletX, y0 + M.splitY, inletX, y0 + M.laneBottom, { rad: 7, e: 0.3, mu: 0.1, look: 'divider' }))
  decor.push(deco('rune', inletX, y0 + M.splitY - 6, { s: 0.8, phase: rng() * 6.28 }))

  // ── 左右支线：各自工位 + 闸门 ───────────────────────────────────────────
  const laneL0 = L, laneL1 = inletX - 8
  const laneR0 = inletX + 8, laneR1 = R
  // 支线只保留「闸门」这一道判定机构：支线净宽仅 72px，再放压辊/钉阵会把通道
  // 挤到球过不去（实测通过率跌到 15%）。加工工位统一放在较宽的共用入口井里。
  decor.push(deco('rune', (laneL0 + laneL1) / 2, y0 + M.laneBottom - 30, { s: 0.6, phase: rng() * 6.28 }))
  decor.push(deco('rune', (laneR0 + laneR1) / 2, y0 + M.laneBottom - 30, { s: 0.6, phase: rng() * 6.28 }))
  // 支线闸门（左枢轴在左壁、右枢轴在右壁，各自计时）
  // mirrorDir 语义：+1 = 枢轴在右壁（门板向左伸进支线），-1 = 枢轴在左壁（门板向右伸）
  buildLaneGate(rng, kinematics, decor, y0, L, laneL1 - laneL0, inletX - L + 12, -1)
  buildLaneGate(rng, kinematics, decor, y0, R, laneR1 - laneR0, R - inletX + 12, 1)
  tags.push('dualgate'); names.push('双通道闸门')

  // ── 缺口分隔墙（把「合格落点」与「回送区」隔开）──────────────────────────
  statics.push(seg(gapL + M.sepInset, y0 + M.zoneTop, gapL + M.sepInset, y1 - 34, { rad: 5, e: 0.3, mu: 0.1, look: 'housing' }))
  statics.push(seg(gapR - M.sepInset, y0 + M.zoneTop, gapR - M.sepInset, y1 - 34, { rad: 5, e: 0.3, mu: 0.1, look: 'housing' }))

  // ── 回送臂触发区（两条支线中间）──────────────────────────────────────────
  const relaunchers = [{
    chamber: ctx.index,
    x0: gapL + M.sepInset + 8, x1: gapR - M.sepInset - 8,
    y0: y0 + M.zoneTop, y1: y1 - 30,
    targetX: inletX, targetY: y0 + M.hopperBottom + 30,
    speed: M.launchSpeed,
    passX: gapL, passY: y0 + M.zoneTop + 26,
  }]

  return {
    statics, kinematics, fields, decor, tags, names,
    inletX, gapX: gapR, gapXL: gapL, gapXR: gapR,
    machine: true, relaunchers, hopperStyle: 'v', doorKind: 'dualgate',
  }
}

const STATION_NAMES = { roller: '压辊', blower: '风选', pins: '导向', hammer: '锻压' }
function machineName(tags) {
  const pick = tags.find(t => STATION_NAMES[t]) || ''
  const base = STATION_NAMES[pick] || '分拣'
  return `${base}双通道流水线`
}

// ═══════════════════════════════════════════════════════════════════════════
// 单层构建
// ═══════════════════════════════════════════════════════════════════════════

const FLOOR_RAD = 9

/** 层底漏斗：两侧墙向缺口倾斜，任何落在底面的球都会滚进缺口 */
function buildChamber(rng, ctx) {
  const built = buildMachine(rng, ctx)
  return {
    statics: built.statics,
    kinematics: built.kinematics,
    fields: built.fields,
    decor: built.decor,
    tags: built.tags,
    names: built.names,
    relaunchers: built.relaunchers || [],
    gapX: built.gapX,
    gapXL: built.gapXL,
    gapXR: built.gapXR,
    machine: true,
  }
}


// ═══════════════════════════════════════════════════════════════════════════
// 可达性校验：只允许「横向 + 下落」的有向洪水填充
// 这是「通过率」的硬保证 —— 只要校验通过，就存在一条仅靠重力即可走完的路径。
// ═══════════════════════════════════════════════════════════════════════════

const VALIDATE_CELL = 15
// 入口净空走廊高度：球从上一层缺口落下后必须无阻碍地直落这么远，
// 否则蹦床 / 壁架会把它直接弹回缺口，形成永久循环。
const ENTRY_CORRIDOR = 100

function rasterizeCapsule(blocked, cols, rows, gx0, gy0, cell, ax, ay, bx, by, rad) {
  const minX = Math.min(ax, bx) - rad, maxX = Math.max(ax, bx) + rad
  const minY = Math.min(ay, by) - rad, maxY = Math.max(ay, by) + rad
  const c0 = Math.max(0, Math.floor((minX - gx0) / cell))
  const c1 = Math.min(cols - 1, Math.ceil((maxX - gx0) / cell))
  const r0 = Math.max(0, Math.floor((minY - gy0) / cell))
  const r1 = Math.min(rows - 1, Math.ceil((maxY - gy0) / cell))
  const dx = bx - ax, dy = by - ay
  const l2 = dx * dx + dy * dy
  for (let r = r0; r <= r1; r++) {
    const py = gy0 + (r + 0.5) * cell
    for (let c = c0; c <= c1; c++) {
      const px = gx0 + (c + 0.5) * cell
      let t = 0
      if (l2 > 1e-9) t = clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1)
      const qx = ax + dx * t, qy = ay + dy * t
      const ddx = px - qx, ddy = py - qy
      if (ddx * ddx + ddy * ddy < rad * rad) blocked[r * cols + c] = 1
    }
  }
}

function rasterizeCircle(blocked, cols, rows, gx0, gy0, cell, cx, cy, rad) {
  const c0 = Math.max(0, Math.floor((cx - rad - gx0) / cell))
  const c1 = Math.min(cols - 1, Math.ceil((cx + rad - gx0) / cell))
  const r0 = Math.max(0, Math.floor((cy - rad - gy0) / cell))
  const r1 = Math.min(rows - 1, Math.ceil((cy + rad - gy0) / cell))
  const rad2 = rad * rad
  for (let r = r0; r <= r1; r++) {
    const py = gy0 + (r + 0.5) * cell
    for (let c = c0; c <= c1; c++) {
      const px = gx0 + (c + 0.5) * cell
      const ddx = px - cx, ddy = py - cy
      if (ddx * ddx + ddy * ddy < rad2) blocked[r * cols + c] = 1
    }
  }
}

/**
 * 校验单层：入口（上一层缺口）→ 出口（本层缺口）是否存在「只横移/下落」通路。
 * @returns {{ok:boolean, pathLen:number, reason:string}}
 */
export function validateChamber(chamber, opt) {
  const W = opt.W ?? RACE.shaftWidth
  const ballR = opt.ballR ?? RACE.ballRadius
  const { y0, y1, gapX } = opt
  const cell = VALIDATE_CELL
  const cols = Math.ceil(W / cell)
  const rows = Math.ceil((y1 - y0) / cell) + 1
  const blocked = new Uint8Array(cols * rows)

  const half = RACE.gapWidth / 2 - 4

  const paint = (parts, dilate) => {
    for (const p of parts) {
      if (p.k === 'seg') {
        // 链条等纯视觉部件不参与校验
        if (p.look === 'chain') continue
        rasterizeCapsule(blocked, cols, rows, 0, y0, cell, p.ax, p.ay, p.bx, p.by, p.rad + dilate)
      } else if (p.k === 'cir') {
        rasterizeCircle(blocked, cols, rows, 0, y0, cell, p.x, p.y, p.r + dilate)
      }
    }
  }

  paint(chamber.statics, ballR)
  // 侧壁（球心必须在 [ballR, W-ballR] 内）
  const cEdge = Math.ceil(ballR / cell)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cEdge; c++) {
      blocked[r * cols + c] = 1
      blocked[r * cols + (cols - 1 - c)] = 1
    }
  }
  // 机关按运动周期采样：扫掠范围内全部标记为阻挡（保守，确保静止区域一定安全）
  const SAMPLES = 12
  for (const d of chamber.kinematics) {
    const n = kinematicPartCount(d)
    const parts = new Array(n).fill(null).map(() => makePart())
    const period = d.period || 1
    if (d.validateAt != null) {
      // 阀门类机关（活动盖板）：只校验「通行态」相位，否则开关并集必然把路堵死。
      // 失败分支由物理层兜底送回起点，不要求几何连通。
      kinematicPartsAt(d, d.validateAt * period, parts)
      paint(parts, ballR)
      continue
    }
    for (let s = 0; s < SAMPLES; s++) {
      kinematicPartsAt(d, (s / SAMPLES) * period, parts)
      paint(parts, ballR)
    }
  }
  // 力场不阻挡（风只改变轨迹，不会困死）

  // 有向 BFS：允许 左 / 右 / 下
  const startRow = 0
  const entry0 = Math.max(0, Math.floor((opt.entryX0 ?? 0) / cell))
  const entry1 = Math.min(cols - 1, Math.ceil((opt.entryX1 ?? W) / cell))
  const visited = new Int32Array(cols * rows).fill(-1)
  const queue = new Int32Array(cols * rows)
  let qh = 0, qt = 0
  for (let c = entry0; c <= entry1; c++) {
    const idx = startRow * cols + c
    if (!blocked[idx] && visited[idx] < 0) { visited[idx] = 0; queue[qt++] = idx }
  }
  if (qt === 0) return { ok: false, pathLen: -1, reason: 'entry-blocked' }

  const exitC0 = Math.max(0, Math.floor((gapX - half) / cell))
  const exitC1 = Math.min(cols - 1, Math.ceil((gapX + half) / cell))
  let best = -1
  while (qh < qt) {
    const idx = queue[qh++]
    const r = (idx / cols) | 0
    const c = idx - r * cols
    const d = visited[idx]
    if (r >= rows - 2 && c >= exitC0 && c <= exitC1) {
      best = d
      break
    }
    // 左
    if (c > 0) { const n = idx - 1; if (!blocked[n] && visited[n] < 0) { visited[n] = d + 1; queue[qt++] = n } }
    // 右
    if (c < cols - 1) { const n = idx + 1; if (!blocked[n] && visited[n] < 0) { visited[n] = d + 1; queue[qt++] = n } }
    // 下
    if (r < rows - 1) { const n = idx + cols; if (!blocked[n] && visited[n] < 0) { visited[n] = d + 1; queue[qt++] = n } }
  }
  if (best < 0) return { ok: false, pathLen: -1, reason: 'unreachable', pockets: 0 }

  // ── 入口走廊必须净空 ──
  // 球从上一层缺口落下后必须有一段无阻碍的直落区，否则蹦床之类会把球直接
  // 弹回缺口，形成永久循环。
  const CORRIDOR = ENTRY_CORRIDOR
  const cc0 = Math.max(cEdge, Math.floor(((opt.entryX0 ?? 0) - 10) / cell))
  const cc1 = Math.min(cols - 1 - cEdge, Math.ceil(((opt.entryX1 ?? W) + 10) / cell))
  const cr1 = Math.min(rows - 1, Math.floor(CORRIDOR / cell))
  for (let r = 0; r <= cr1 && cc0 <= cc1; r++) {
    for (let c = cc0; c <= cc1; c++) {
      if (blocked[r * cols + c]) return { ok: false, pathLen: best, reason: 'corridor-blocked', pockets: 0 }
    }
  }

  // ── 口袋检测 ──
  // 左右下三个方向全被堵死的可达空格 = 球可能永久停驻的「死点」。
  // 机器层有回送滑道/弹射坑等刻意保留的凹角，容许 ≤2 个；再多说明布局有问题。
  let pockets = 0
  for (let r = 0; r < rows - 2; r++) {
    for (let c = 1; c < cols - 1; c++) {
      const idx = r * cols + c
      if (blocked[idx] || visited[idx] < 0) continue
      if (blocked[idx - 1] && blocked[idx + 1] && blocked[idx + cols]) pockets++
    }
  }
  return { ok: pockets <= 2, pathLen: best, reason: pockets > 2 ? 'pocket' : 'ok', rows, pockets }
}

// ═══════════════════════════════════════════════════════════════════════════
// 整条赛道生成
// ═══════════════════════════════════════════════════════════════════════════

function hashSeed(seed, i, k) {
  let h = (seed ^ 0x9e3779b9) >>> 0
  h = Math.imul(h ^ (i + 0x85ebca6b), 0xc2b2ae35) >>> 0
  h = Math.imul(h ^ (k + 0x27d4eb2f), 0x165667b1) >>> 0
  return h >>> 0
}

export function generateCourse({ seed = 20240828, chambers = RACE.chamberCount } = {}) {
  const W = RACE.shaftWidth
  const CH = RACE.chamberHeight
  const prelude = RACE.preludeHeight
  const rootRng = createRng(seed)
  const statics = []
  const kinematics = []
  const fields = []
  const decor = []
  const chambersInfo = []
  const report = { attempts: 0, fallbacks: 0, pathLens: [], names: [], reasons: {} }

  // 预赛段：纯竖直井道，让 7 颗球同时加速
  for (let i = 0; i < 4; i++) {
    decor.push(deco('banner', W * (0.16 + i * 0.23), 92 + (i % 2) * 46, { s: 1, variant: i % 3 }))
  }
  decor.push(deco('gate', W * 0.5, 66, { s: 1 }))

  const floorYs = []
  const gapXs = []
  const gapLs = []
  const relaunchers = []

  for (let i = 0; i < chambers; i++) {
    const y0 = prelude + i * CH
    const y1 = y0 + CH
    const gapHalf = RACE.gapWidth / 2
    // 机器一律按「回送塔在左、出口在右」构建，再由 mirror 整体翻转；
    // 因此缺口也先在右侧生成，镜像后自动落到左侧。
    const mirror = false   // 整机镜像会破坏回送弹道与料斗的相对关系，暂不启用
    const gapX = clamp(W * (0.58 + rootRng() * 0.24), gapHalf + 64, W - gapHalf - 64)  // 占位：机器会返回自己的实际缺口
    // 上一层有两个缺口：本层入口走廊取两者并集
    const entryX0 = i === 0 ? 0 : Math.max(0, gapLs[i - 1] - gapHalf)
    const entryX1 = i === 0 ? W : Math.min(W, gapXs[i - 1] + gapHalf)
    let chosen = null
    let v = null
    for (let attempt = 0; attempt < 12 && !chosen; attempt++) {
      const rng = createRng(hashSeed(seed, i, attempt))
      const built = buildChamber(rng, { y0, y1, gapX, W, entryX0, entryX1, index: i, mirror })
      // 双通道机器：两条支线必须各自可达（分别以左右缺口作为出口各校验一次）
      const exits = built.gapXL != null ? [built.gapXL, built.gapXR] : [built.gapX != null ? built.gapX : gapX]
      let res = null
      let allOk = true
      for (const gx of exits) {
        const r = validateChamber({ statics: built.statics, kinematics: built.kinematics, fields: built.fields }, {
          W, ballR: RACE.ballRadius, y0: y0 - 4, y1: y1 + 4, gapX: gx,
          entryX0, entryX1,
        })
        report.attempts++
        const rows = r.rows || Math.ceil(CH / VALIDATE_CELL)
        const maxPath = rows * 2.6 + 40
        if (r.ok && r.pathLen <= maxPath) {
          if (!res || r.pathLen > res.pathLen) res = r
        } else {
          allOk = false
          const key = r.ok ? 'too-winding' : r.reason
          report.reasons[key] = (report.reasons[key] || 0) + 1
          break
        }
      }
      if (allOk && res) {
        chosen = built
        v = res
      }
    }
    if (!chosen) {
      // 保底层：最简机器（料斗 + 井 + 盖板 + 回送），构造上必然可通
      report.fallbacks++
      const safe = buildChamber(createRng(hashSeed(seed, i, 991)), { y0, y1, gapX, W, entryX0, entryX1, index: i, mirror })
      const res = validateChamber(safe, {
        W, ballR: RACE.ballRadius, y0: y0 - 4, y1: y1 + 4,
        gapX: safe.gapX != null ? safe.gapX : gapX, entryX0, entryX1,
      })
      chosen = safe
      v = res
    }
    // 逐件打上本层主题色（渲染层据此区分层与层之间的观感）
    const theme = Math.floor(rootRng() * 5)
    for (const o of chosen.statics) o.theme = theme
    for (const o of chosen.kinematics) o.theme = theme
    for (const o of chosen.decor) o.theme = theme
    for (const o of chosen.fields) { o.theme = theme; o.chamber = i }
    if (chosen.relaunchers) for (const z of chosen.relaunchers) z.theme = theme
    statics.push(...chosen.statics)
    kinematics.push(...chosen.kinematics)
    fields.push(...chosen.fields)
    decor.push(...chosen.decor)
    if (chosen.relaunchers) relaunchers.push(...chosen.relaunchers)
    // 机器可能整体镜像过，缺口位置以机器实际返回值为准
    const finalGapX = chosen.gapX != null ? chosen.gapX : gapX
    const finalGapL = chosen.gapXL != null ? chosen.gapXL : finalGapX
    floorYs.push(y1)
    gapXs.push(finalGapX)
    gapLs.push(finalGapL)
    report.pathLens.push(v?.pathLen ?? 0)
    const dominant = machineName(chosen.tags)
    report.names.push(dominant)
    chambersInfo.push({
      index: i, y0, y1, gapX: finalGapX,
      gapX0: finalGapX - gapHalf, gapX1: finalGapX + gapHalf,
      gapXL: finalGapL, gapXL0: finalGapL - gapHalf, gapXL1: finalGapL + gapHalf,
      entryX0, entryX1,
      name: dominant,
      tags: chosen.tags,
      theme,
    })
  }

  const lastFloor = floorYs[floorYs.length - 1]
  const finishY = lastFloor + RACE.finishOffset
  const basinY = lastFloor + RACE.basinOffset
  const height = basinY + 160

  // ── 燃素试炼门（惩罚机制）──
  // 在若干层的底面缺口处架设「火墙」：球在火焰燃起时穿过缺口会被灼烧，
  // 直接送回本层起点重走。这是排名翻盘的主要来源。
  const hazards = []
  const trialIdx = pickTrialChambers(rootRng, chambers)
  for (let k = 0; k < trialIdx.length; k++) {
    const ci = trialIdx[k]
    const info = chambersInfo[ci]
    const rng = createRng(hashSeed(seed, ci, 7717))
    const kind = rng() < 0.45 ? 'swing' : 'flame'
    const h = buildHazard(rng, { kind, info })
    h.chamber = ci
    hazards.push(h)
    info.trial = true
    info.hazardKind = kind
    info.baseName = info.name
    info.name = kind === 'swing' ? `灼风试炼·${info.baseName}` : `燃素试炼·${info.baseName}`
  }
  // 试炼层在入口处立两根图腾柱做视觉预告（不参与碰撞）
  for (const h of hazards) {
    const info = chambersInfo[h.chamber]
    decor.push(deco('trialMark', info.gapX0 - 6, info.y1 - 150, { s: 1, variant: h.kind === 'swing' ? 1 : 0 }))
    decor.push(deco('trialMark', info.gapX1 + 6, info.y1 - 150, { s: 1, variant: h.kind === 'swing' ? 1 : 0, phase: Math.PI }))
  }

  // 侧壁
  statics.push(seg(0, -240, 0, height + 240, { rad: 0, e: 0.3, mu: 0.05, look: 'wall' }))
  statics.push(seg(W, -240, W, height + 240, { rad: 0, e: 0.3, mu: 0.05, look: 'wall' }))

  // 终点水池：浅 V 形（唯一允许的近似平面，比赛已结束）
  const basinSlope = 0.06
  statics.push(seg(0, basinY - (W / 2) * basinSlope, W / 2, basinY, { rad: 12, e: 0.16, mu: 0.3, look: 'basin' }))
  statics.push(seg(W / 2, basinY, W, basinY - (W / 2) * basinSlope, { rad: 12, e: 0.16, mu: 0.3, look: 'basin' }))

  // 终点门装饰 + 每层墙面装饰
  decor.push(deco('finish', W * 0.5, finishY, { s: 1 }))
  for (let i = 0; i < chambers; i++) {
    decor.push(deco('rune', 0, prelude + i * CH + CH * 0.5, { s: 1, variant: chambersInfo[i].theme }))
    decor.push(deco('rune', W, prelude + i * CH + CH * 0.5, { s: 1, variant: chambersInfo[i].theme, phase: Math.PI }))
  }

  const course = {
    seed, chambers, W,
    chamberHeight: CH,
    preludeHeight: prelude,
    floorYs, gapXs, gapLs, chambersInfo,
    height, finishY, basinY, lastFloor,
    statics, kinematics, fields, decor, hazards, relaunchers,
    spawn: {
      y: 84,
      xs: Array.from({ length: 7 }, (_, i) => W * 0.5 + (i - 3) * 44),
    },
    report,
  }
  return course
}

// ═══════════════════════════════════════════════════════════════════════════
// 燃素试炼门
// ═══════════════════════════════════════════════════════════════════════════

export const TRIAL = {
  count: 3,        // 试炼层数量
  minIndex: 2,     // 前几层不设试炼（开局给一点缓冲）
  mercy: 2,        // 同一层被送回 N 次后获得「夜魂庇佑」，该层免疫
  height: 58,      // 灼烧判定带高度
  floorGap: 10,    // 判定带底边距地板的高度
  pad: 24,         // 判定带横向外扩
}

/** 挑出试炼层：把赛道均分成 count 段，每段随机取一层，保证惩罚分布均匀 */
function pickTrialChambers(rng, chambers) {
  const count = Math.max(1, Math.min(TRIAL.count, chambers - TRIAL.minIndex - 1))
  const lo = TRIAL.minIndex
  const hi = chambers - 2
  const span = hi - lo
  const out = []
  for (let i = 0; i < count; i++) {
    const a = lo + Math.floor((span * i) / count)
    const b = lo + Math.floor((span * (i + 1)) / count) - 1
    out.push(a + Math.floor(rng() * Math.max(1, b - a + 1)))
  }
  return out
}

function buildHazard(rng, { kind, info }) {
  const y1 = info.y1 - TRIAL.floorGap
  const y0 = y1 - TRIAL.height
  if (kind === 'swing') {
    // 灼风柱：横向往复扫过缺口，永不熄灭 —— 找准空档才能过
    return {
      k: 'swingGate',
      cx: info.gapX, y0, y1,
      w: 76,
      amp: RACE.gapWidth / 2 + rand(rng, 34, 62),
      period: rand(rng, 2.0, 3.0),
      phase: rng() * TAU,
    }
  }
  // 燃素火墙：周期性燃起，熄灭时才能穿过
  return {
    k: 'flameGate',
    cx: info.gapX, y0, y1,
    w: RACE.gapWidth + TRIAL.pad * 2,
    period: rand(rng, 2.3, 3.1),
    duty: rand(rng, 0.27, 0.34),
    phase: rng(),
  }
}

const TAU = Math.PI * 2

/**
 * 求某一时刻试炼门的横向范围与是否致命（渲染与判定共用同一份实现，
 * 保证「看到的火焰」就是「会灼烧的火焰」）。
 * @returns {{x0:number,x1:number,active:boolean,intensity:number}}
 */
export function hazardSpan(h, t) {
  if (h.k === 'swingGate') {
    const cx = h.cx + Math.sin(h.phase + (t / h.period) * TAU) * h.amp
    return { x0: cx - h.w / 2, x1: cx + h.w / 2, active: true, intensity: 0.75 + 0.25 * Math.sin(t * 7) }
  }
  const ph = (((t / h.period) + h.phase) % 1 + 1) % 1
  const active = ph < h.duty
  // 边缘做出「渐燃」过渡，避免视觉与判定不一致
  const rise = Math.min(1, ph / 0.08)
  const fall = Math.min(1, (h.duty - ph) / 0.08)
  const k = active ? Math.max(0.15, Math.min(rise, fall)) : 0
  return { x0: h.cx - h.w / 2, x1: h.cx + h.w / 2, active, intensity: k }
}

/** 判定带是否命中球心（球心进入即算触碰） */
export function hazardHits(h, t, x, y) {
  if (y < h.y0 || y > h.y1) return false
  const s = hazardSpan(h, t)
  if (!s.active) return false
  return x >= s.x0 && x <= s.x1
}


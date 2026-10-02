// ═══════════════════════════════════════════════════════════════════════════
// 归火圣夜巡礼 · 物理内核
//
// 纯 JS（零 DOM 依赖）：浏览器与 Node 无头仿真共用。
//   · 半隐式欧拉积分 + 子步（1/240 s），保证不穿模
//   · 圆 vs 胶囊（带厚度线段）/ 圆 vs 圆的冲量解算
//   · 运动学刚体（齿轮 / 摆锤 / 风车 / 升降台）带接触点表面速度，能把球甩出去
//   · 力场（吹风机 / 燃素喷流）
//   · 停滞检测 +「夜魂佑护」兜底，保证比赛一定收敛
// ═══════════════════════════════════════════════════════════════════════════

import { RACE, TRIAL, kinematicPartsAt, kinematicPartCount, createRng, hazardSpan } from './raceCourse.mjs'

const ROW_H = 200          // 静态碰撞体纵索引行高
const KIN_RANGE = 320      // 运动学部件参与碰撞的纵向范围
const PAIR_E = 0.45        // 球球弹性
const PAIR_REST = 40       // 球球碰撞静默阈值

// ── 基础向量小工具 ────────────────────────────────────────────────────────
function hypot(x, y) { return Math.sqrt(x * x + y * y) }
function clampNum(v, a, b) { return v < a ? a : v > b ? b : v }

// ═══════════════════════════════════════════════════════════════════════════
// 创建比赛
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @param {object} course generateCourse() 的结果
 * @param {Array<{name?:string, r?:number, dragScale?:number, spinBias?:number}>} ballDefs
 */
export function createRace(course, ballDefs) {
  const balls = ballDefs.map((def, i) => {
    const xs = course.spawn.xs
    return {
      i,
      def,
      name: def.name || `球${i + 1}`,
      x: (xs[i % xs.length] ?? course.W / 2) + (def.spawnJitter || 0),
      y: course.spawn.y,
      vx: def.spawnVx || 0,
      vy: 0,
      r: def.r ?? RACE.ballRadius,
      drag: RACE.dragK * (def.dragScale ?? 1),
      angle: 0,
      spin: 0,
      maxY: course.spawn.y,
      depth: 0,
      finished: false,
      finishTime: 0,
      rank: 0,
      parked: false,
      sleepT: 0,
      assist: 0,
      assistByChamber: {},
      assistFlash: 0,
      stallT: 0,
      boostCd: 0,
      launchCd: 0,
      launchFlash: 0,
      relaunches: 0,
      relaunchByChamber: {},
      anchorX: 0,
      anchorY: 0,
      penalties: 0,
      penaltyByChamber: {},
      penaltyFlash: 0,
      mercyFlash: 0,
      catchUpFlash: 0,
      chamberIdx: 0,
      mercyUntilY: -1,
      hazardCd: 0,
      lastPenaltyT: -99,
      lastPenaltyX: 0,
      lastPenaltyY: 0,
      lastPenaltyChamber: -1,
      chamber: 0,
      lastHit: 0,
      hitPower: 0,
      alive: true,
    }
  })
  for (const b of balls) { b.anchorX = b.x; b.anchorY = b.y }

  // 运动学部件（原地复用，避免每帧分配）
  const kin = course.kinematics.map(d => {
    const parts = new Array(kinematicPartCount(d)).fill(null).map(() => ({}))
    kinematicPartsAt(d, 0, parts)
    return { d, parts }
  })

  // 静态碰撞体纵索引
  const rowCount = Math.ceil(course.height / ROW_H) + 2
  const rows = new Array(rowCount)
  for (let i = 0; i < rowCount; i++) rows[i] = []
  for (const c of course.statics) {
    const y0 = c.k === 'seg' ? Math.min(c.ay, c.by) - c.rad : c.y - c.r
    const y1 = c.k === 'seg' ? Math.max(c.ay, c.by) + c.rad : c.y + c.r
    const r0 = Math.max(0, Math.floor((y0 + 240) / ROW_H))
    const r1 = Math.min(rowCount - 1, Math.floor((y1 + 240) / ROW_H))
    for (let r = r0; r <= r1; r++) rows[r].push(c)
  }

  return {
    course,
    balls,
    kin,
    rows,
    t: 0,
    over: false,
    finishOrder: [],
    forced: false,
    assistTotal: 0,
    penaltyTotal: 0,
    relaunchTotal: 0,
    catchUpTotal: 0,
    catchUpNextT: 0,
    rng: createRng((course.seed ^ 0x5bf03635) >>> 0),
  }
}

// ── 定位球所在层（用于夜魂转移兜底） ─────────────────────────────────────
/** 球当前所在层序号（0 起） */
export function chamberIndexOf(course, y) {
  const list = course.chambersInfo
  for (let i = 0; i < list.length; i++) if (y < list[i].y1) return i
  return list.length - 1
}

export function chamberAt(course, y) {
  const { chambersInfo } = course
  for (let i = 0; i < chambersInfo.length; i++) {
    if (y < chambersInfo[i].y1) return chambersInfo[i]
  }
  return chambersInfo[chambersInfo.length - 1]
}

// ═══════════════════════════════════════════════════════════════════════════
// 运动学更新
// ═══════════════════════════════════════════════════════════════════════════
function updateKinematics(state) {
  const t = state.t
  for (let i = 0; i < state.kin.length; i++) {
    const k = state.kin[i]
    kinematicPartsAt(k.d, t, k.parts)
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 接触解算
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 通用接触：把球沿法线推出并按冲量反弹（含表面速度、摩擦、弹性阈值）
 */
function resolveContact(b, nx, ny, pen, px, py, col) {
  b.x += nx * pen
  b.y += ny * pen

  // 弹射器（流水线回送）：不按冲量解算，直接给定初速把球抛回本层起点
  if (col.launcher) {
    if (b.launchCd > 0) return 0
    const g = RACE.gravity
    const v = col.launcher.speed
    const dx = col.launcher.targetX - b.x
    const dyUp = b.y - col.launcher.targetY        // 目标在正上方时为正
    const ax = Math.abs(dx)
    const disc = v * v * v * v - g * (g * ax * ax + 2 * dyUp * v * v)
    if (disc >= 0 && ax > 2) {
      // 取「高抛解」：弧线从入口井上方掠过，不会撞到井壁
      const tan = (v * v + Math.sqrt(disc)) / (g * ax)
      const ang = Math.atan(tan)
      b.vx = Math.sign(dx) * v * Math.cos(ang)
      b.vy = -v * Math.sin(ang)
    } else {
      b.vx = 0
      b.vy = -v
    }
    b.launchCd = 0.3
    b.launchFlash = 1
    b.hitPower = 1
    return v
  }

  let svx = 0, svy = 0
  const spin = col.spin
  if (spin) {
    const rx = px - spin.cx, ry = py - spin.cy
    svx += -spin.omega * ry
    svy += spin.omega * rx
  }
  if (col.svel) { svx += col.svel.vx; svy += col.svel.vy }

  const rvx = b.vx - svx
  const rvy = b.vy - svy
  const vn = rvx * nx + rvy * ny
  if (vn > 0) return 0

  const e = (-vn < RACE.restThreshold) ? 0 : (col.e ?? RACE.restitution)
  let jn = -(1 + e) * vn
  // 蹦床助推：只对「有实际冲击」的接触生效，且有冷却时间。
  // 否则球会在蹦床上原地来回永动（轻触持续加力 / 每子步加力）。
  if (col.boost && -vn > 62 && b.boostCd <= 0) {
    jn += col.boost
    b.boostCd = 1.1
  }

  let tvx = rvx - vn * nx
  let tvy = rvy - vn * ny
  const tsp = hypot(tvx, tvy)
  let jt = 0
  if (tsp > 1e-6) jt = Math.min(tsp, (col.mu ?? RACE.friction) * jn)

  b.vx = svx + rvx + jn * nx - (tsp > 1e-6 ? (jt * tvx) / tsp : 0)
  b.vy = svy + rvy + jn * ny - (tsp > 1e-6 ? (jt * tvy) / tsp : 0)

  // 视觉反馈：碰撞强度（渲染层据此喷火花）
  const power = Math.min(1, (-vn) / 620)
  if (power > b.hitPower) b.hitPower = power
  return -vn
}

function collideCircle(b, c) {
  const dx = b.x - c.x
  const dy = b.y - c.y
  const rr = b.r + c.r
  let d = hypot(dx, dy)
  if (d >= rr) return
  let nx, ny
  if (d < 1e-6) { nx = 0; ny = -1; d = 1e-6 } else { nx = dx / d; ny = dy / d }
  resolveContact(b, nx, ny, rr - d, c.x + nx * c.r, c.y + ny * c.r, c)
}

function collideSeg(b, s) {
  const dx = s.bx - s.ax
  const dy = s.by - s.ay
  const l2 = dx * dx + dy * dy
  let t = 0
  if (l2 > 1e-9) t = ((b.x - s.ax) * dx + (b.y - s.ay) * dy) / l2
  if (t < 0) t = 0; else if (t > 1) t = 1
  const px = s.ax + dx * t
  const py = s.ay + dy * t
  let nx = b.x - px
  let ny = b.y - py
  const rr = b.r + s.rad
  let d = hypot(nx, ny)
  if (d >= rr) return
  if (d < 1e-6) {
    // 圆心落在线上：沿线段法线推出
    const len = Math.sqrt(l2) || 1
    nx = -dy / len; ny = dx / len
    if (ny > 0) { nx = -nx; ny = -ny }
    d = 1e-6
  } else { nx /= d; ny /= d }
  resolveContact(b, nx, ny, rr - d, px, py, s)
}

// ═══════════════════════════════════════════════════════════════════════════
// 单球推进
// ═══════════════════════════════════════════════════════════════════════════

function integrate(state, b, h) {
  const course = state.course
  let ax = 0
  let ay = RACE.gravity

  // 力场
  const fields = course.fields
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i]
    if (b.x < f.x || b.x > f.x + f.w || b.y < f.y || b.y > f.y + f.h) continue
    let k = 1
    if (f.period) {
      const ph = ((state.t / f.period) % 1 + 1) % 1
      k = 0.5 + 0.5 * Math.cos(ph * Math.PI * 2)
    }
    ax += f.ax * k
    ay += f.ay * k
  }

  // 二次阻力：静止/慢速时几乎无阻力（球能顺畅沿斜面滚落），高速时收敛到终端速度
  const speed0 = hypot(b.vx, b.vy)
  const damp = 1 / (1 + b.drag * speed0 * h)
  b.vx = b.vx * damp + ax * h
  b.vy = b.vy * damp + ay * h

  const sp = hypot(b.vx, b.vy)
  if (sp > RACE.maxSpeed) {
    const s = RACE.maxSpeed / sp
    b.vx *= s
    b.vy *= s
  }

  b.x += b.vx * h
  b.y += b.vy * h

  // 自旋（视觉）：由横向速度驱动，角度用于渲染层旋转头像
  b.spin = clampNum(b.vx / Math.max(6, b.r), -14, 14)
  b.angle += b.spin * h

  if (b.y > b.maxY) b.maxY = b.y
}

function collideStatics(state, b) {
  const rows = state.rows
  const yTop = b.y - b.r
  const yBot = b.y + b.r
  const r0 = Math.max(0, Math.floor((yTop + 240) / ROW_H))
  const r1 = Math.min(rows.length - 1, Math.floor((yBot + 240) / ROW_H))
  for (let r = r0; r <= r1; r++) {
    const list = rows[r]
    for (let i = 0; i < list.length; i++) {
      const c = list[i]
      if (c.k === 'seg') collideSeg(b, c)
      else collideCircle(b, c)
    }
  }
}

function collideKinematics(state, b) {
  const kin = state.kin
  for (let i = 0; i < kin.length; i++) {
    const parts = kin[i].parts
    for (let j = 0; j < parts.length; j++) {
      const p = parts[j]
      const py = p.k === 'seg' ? (p.ay + p.by) * 0.5 : p.y
      if (py < b.y - KIN_RANGE || py > b.y + KIN_RANGE) continue
      if (p.k === 'seg') collideSeg(b, p)
      else collideCircle(b, p)
    }
  }
}

function collideBalls(state) {
  const balls = state.balls
  const n = balls.length
  for (let i = 0; i < n; i++) {
    const a = balls[i]
    for (let j = i + 1; j < n; j++) {
      const b = balls[j]
      const imA = a.parked ? 0 : 1
      const imB = b.parked ? 0 : 1
      const imSum = imA + imB
      if (imSum === 0) continue
      const dx = b.x - a.x
      const dy = b.y - a.y
      const rr = a.r + b.r
      const d2 = dx * dx + dy * dy
      if (d2 >= rr * rr) continue
      let d = Math.sqrt(d2)
      let nx, ny
      if (d < 1e-6) { nx = 1; ny = 0; d = 1e-6 } else { nx = dx / d; ny = dy / d }
      const pen = rr - d
      a.x -= nx * pen * (imA / imSum)
      a.y -= ny * pen * (imA / imSum)
      b.x += nx * pen * (imB / imSum)
      b.y += ny * pen * (imB / imSum)
      const rvx = b.vx - a.vx
      const rvy = b.vy - a.vy
      const vn = rvx * nx + rvy * ny
      if (vn > 0) continue
      const e = (-vn < PAIR_REST) ? 0 : PAIR_E
      const jn = (-(1 + e) * vn) / imSum
      a.vx -= jn * nx * imA
      a.vy -= jn * ny * imA
      b.vx += jn * nx * imB
      b.vy += jn * ny * imB
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 燃素试炼门：撞上火焰 → 送回本层起点重走
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 追赶放行：当领先者比最后一名多推进 catchUpGap 层时，把最后一名所在层的所有球
 * 直接送入下一层入口（夜魂佑护·追赶），避免落后者被越拉越远、比赛失去悬念。
 */
function checkCatchUp(state) {
  const list = state.course.chambersInfo
  if (!list || list.length < 3) return
  if (state.t < state.catchUpNextT) return
  let maxIdx = -1
  let minIdx = 1e9
  for (const b of state.balls) {
    if (b.finished) continue
    const idx = chamberIndexOf(state.course, b.y)
    b.chamberIdx = idx
    if (idx > maxIdx) maxIdx = idx
    if (idx < minIdx) minIdx = idx
  }
  if (maxIdx < 0 || minIdx > maxIdx) return
  if (maxIdx - minIdx < RACE.catchUpGap) return
  // 放行「最后一名所在层」的全部球
  const target = Math.min(minIdx + 1, list.length - 1)
  const dest = list[target]
  let moved = 0
  for (const b of state.balls) {
    if (b.finished || b.parked) continue
    if ((b.chamberIdx ?? 0) !== minIdx) continue
    b.x = clampNum((dest.entryX0 + dest.entryX1) / 2, 40, state.course.W - 40)
    b.y = dest.y0 + 26
    b.vx = 0
    b.vy = 140
    b.anchorX = b.x
    b.anchorY = b.y
    b.stallT = 0
    b.mercyFlash = 1
    b.catchUpFlash = 1
    moved++
  }
  if (moved > 0) {
    state.catchUpTotal += moved
    state.catchUpNextT = state.t + RACE.catchUpHold
  }
}

function checkRelaunchers(state) {
  const list = state.course.relaunchers
  if (!list || list.length === 0) return
  for (const b of state.balls) {
    if (b.finished || b.parked) continue
    if (b.launchCd > 0) continue
    for (let i = 0; i < list.length; i++) {
      const z = list[i]
      if (b.x < z.x0 || b.x > z.x1 || b.y < z.y0 || b.y > z.y1) continue
      applyRelaunch(state, b, z)
      break
    }
  }
}

/** 流水线回送臂：按抛物线解算把球精确投回本层入口井 */
function applyRelaunch(state, b, z) {
  const key = z.chamber
  b.relaunchChamber = key
  const cnt = (b.relaunchByChamber[key] || 0) + 1
  b.relaunchByChamber[key] = cnt
  if (cnt > RACE.reworkMercy) {
    // 夜魂佑护：同一层被回送太多次，机器直接放行（保证比赛一定收敛）
    b.x = z.passX
    b.y = z.passY
    b.vx = 150
    b.vy = 220
    b.launchCd = 1.0
    b.mercyFlash = 1
    return
  }
  const g = RACE.gravity
  const v = z.speed || 1150
  const dx = z.targetX - b.x
  const dyUp = b.y - z.targetY
  const ax = Math.abs(dx)
  const disc = v * v * v * v - g * (g * ax * ax + 2 * dyUp * v * v)
  if (disc >= 0 && ax > 2) {
    // 高抛解：弧线从入口井上方掠过，不会撞到井壁
    const tan = (v * v + Math.sqrt(disc)) / (g * ax)
    const ang = Math.atan(tan)
    b.vx = Math.sign(dx) * v * Math.cos(ang)
    b.vy = -v * Math.sin(ang)
  } else {
    b.vx = 0
    b.vy = -v
  }
  b.launchCd = 0.5
  b.launchFlash = 1
  b.relaunches++
  state.relaunchTotal++
}

function checkHazards(state) {
  const hazards = state.course.hazards
  if (!hazards || hazards.length === 0) return
  for (const b of state.balls) {
    if (b.finished || b.parked) continue
    if (b.hazardCd > 0) continue
    if (b.mercyUntilY > 0 && b.y < b.mercyUntilY) continue   // 夜魂庇佑中
    for (let i = 0; i < hazards.length; i++) {
      const hz = hazards[i]
      if (b.y < hz.y0 || b.y > hz.y1) continue
      const span = hazardSpan(hz, state.t)
      if (!span.active) continue
      if (b.x < span.x0 || b.x > span.x1) continue
      applyPenalty(state, b, hz)
      break
    }
  }
}

/** 被火墙灼烧：送回该层入口走廊，重新走一遍这一层 */
function applyPenalty(state, b, hz) {
  const ch = state.course.chambersInfo[hz.chamber]
  if (!ch) return
  b.penalties++
  b.penaltyFlash = 1
  b.hazardCd = 1.4          // 防止同一帧/连续帧重复触发
  b.lastPenaltyX = b.x      // 渲染层据此喷灼烧特效
  b.lastPenaltyY = b.y
  b.lastPenaltyChamber = hz.chamber
  state.penaltyTotal++
  b.lastPenaltyT = state.t
  const rec = b.penaltyByChamber[hz.chamber] || 0
  b.penaltyByChamber[hz.chamber] = rec + 1
  // 同一层反复受挫 → 夜魂庇佑，本层余下路程免疫（保证比赛一定收敛）
  if (rec + 1 >= TRIAL.mercy) {
    b.mercyUntilY = ch.y1 + 12
    b.mercyFlash = 1
  }
  // 送回本层起点（上一层缺口正下方，已被可达性校验保证净空）
  b.x = (ch.entryX0 + ch.entryX1) / 2
  b.y = ch.y0 + 24
  b.vx = 0
  b.vy = 120
  b.anchorX = b.x
  b.anchorY = b.y
  b.stallT = 0
  b.sleepT = 0
}

// ═══════════════════════════════════════════════════════════════════════════
// 夜魂佑护：防卡死兜底
// ═══════════════════════════════════════════════════════════════════════════

function applyAssist(state, b, h) {
  if (b.finished) return
  // 位移式停滞判定：在半径 R 内徘徊超过 T 秒即视为卡住（只看纵向进度会误判
  // 缓慢沿漏斗横向下滑的球）
  const dx = b.x - b.anchorX
  const dy = b.y - b.anchorY
  if (dx * dx + dy * dy > RACE.assistStallRadius * RACE.assistStallRadius) {
    b.anchorX = b.x
    b.anchorY = b.y
    b.stallT = 0
    return
  }
  b.stallT += h
  if (b.stallT < RACE.assistStallTime) return
  b.stallT = 0
  b.assist++
  state.assistTotal++
  b.assistFlash = 1
  // 按「本层」累计（而非全局累计）：否则一旦总次数到顶，之后每次佑护都变成传送
  const chKey = chamberAt(state.course, b.y).index
  const lv = (b.assistByChamber[chKey] || 0) + 1
  b.assistByChamber[chKey] = lv

  if (lv >= RACE.maxAssistLevel) {
    // 夜魂转移：直接送到本层缺口正上方
    const ch = chamberAt(state.course, b.y)
    b.x = ch.gapX
    b.y = Math.max(b.y, ch.y1 - 52)
    b.vx = 0
    b.vy = 340
  } else {
    const power = b.assist === 1 ? 1 : 1.6
    b.vx = (state.rng() * 2 - 1) * 230 * power
    b.vy = Math.abs(b.vy) * 0.3 + 260 * power
  }
  b.anchorX = b.x
  b.anchorY = b.y
}

// ═══════════════════════════════════════════════════════════════════════════
// 主循环
// ═══════════════════════════════════════════════════════════════════════════

export function stepRace(state, dt) {
  if (state.over) return state
  const subs = RACE.substeps
  const h = dt / subs
  for (let s = 0; s < subs; s++) {
    state.t += h
    updateKinematics(state)

    const balls = state.balls
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i]
      if (b.parked) continue
      b.hitPower *= 0.9
      b.assistFlash *= 0.94
      b.penaltyFlash *= 0.965
      b.mercyFlash *= 0.985
      b.catchUpFlash *= 0.97
      if (b.boostCd > 0) b.boostCd -= h
      if (b.launchCd > 0) b.launchCd -= h
      b.launchFlash *= 0.96
      integrate(state, b, h)
      collideStatics(state, b)
      collideKinematics(state, b)
      applyAssist(state, b, h)
      if (b.hazardCd > 0) b.hazardCd -= h
    }
    collideBalls(state)
    checkHazards(state)
    checkRelaunchers(state)
    checkCatchUp(state)
    checkFinish(state)
    checkPark(state, h)
  }
  if (state.finishOrder.length >= state.balls.length) state.over = true
  if (!state.over && state.t >= RACE.maxRaceTime) {
    state.forced = true
    state.over = true
  }
  return state
}

function checkFinish(state) {
  const course = state.course
  for (const b of state.balls) {
    if (b.finished) continue
    if (b.y >= course.finishY) {
      b.finished = true
      b.finishTime = state.t
      b.depth = 1
      state.finishOrder.push(b.i)
    }
  }
}

function checkPark(state, h) {
  for (const b of state.balls) {
    if (b.parked) continue
    if (!b.finished) continue
    const sp = hypot(b.vx, b.vy)
    if (sp < 30) {
      b.sleepT += h
      if (b.sleepT > 0.5) {
        b.parked = true
        b.vx = 0
        b.vy = 0
      }
    } else {
      b.sleepT = 0
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 查询
// ═══════════════════════════════════════════════════════════════════════════

/** 进度：0（起点）→ 1（终点线）。用当前纵深而非最深纪录，被火墙送回时排名会实时下滑 */
export function ballProgress(course, b) {
  if (b.finished) return 1
  const total = course.finishY - course.spawn.y
  return Math.max(0, Math.min(0.999, (b.y - course.spawn.y) / total))
}

/** 实时排名（完赛者按用时，未完赛者按最深进度） */
export function raceStandings(state) {
  const course = state.course
  const arr = state.balls.map(b => ({
    i: b.i,
    ball: b,
    name: b.name,
    finished: b.finished,
    finishTime: b.finishTime,
    progress: ballProgress(course, b),
    rank: 0,
  }))
  arr.sort((a, b) => {
    if (a.finished && b.finished) return a.finishTime - b.finishTime
    if (a.finished) return -1
    if (b.finished) return 1
    return b.progress - a.progress
  })
  for (let i = 0; i < arr.length; i++) arr[i].rank = i + 1
  return arr
}

/** 最终结算：名次 + 用时 */
export function raceResults(state) {
  const course = state.course
  const standings = raceStandings(state)
  return standings.map(s => ({
    rank: s.rank,
    index: s.i,
    name: s.name,
    finished: s.finished,
    time: s.finished ? s.finishTime : null,
    depth: s.progress,
    assists: s.ball.assist,
    maxY: s.ball.maxY,
    over: !s.finished,
    total: course.finishY - course.spawn.y,
  }))
}

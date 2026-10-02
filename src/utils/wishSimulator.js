// ═════════════════════════════════════════════════════════════════
// 希穆兰卡 · 祈愿模拟引擎（纯逻辑）
// ─────────────────────────────────────────────────────────────────
// 规则依据：数据库词条
//   《祈愿 · 祈愿机制》(game_data 22)
//   《祈愿 · 保底机制》(game_data 23)
//   《祈愿 · 集录祈愿》(game_data 10)
//
// 与 src/utils/wishAnalysis.js（期望值/分布 DP 引擎）的分工：
//   - wishAnalysis 负责「还要多少抽才能达成目标」的精确概率分布；
//   - 本模块负责「逐抽推进的状态机」，即真实模拟：每一次抽取都消耗资源、
//     推进保底计数、结算副产物，并产出可回放的抽卡记录。
//   两者共用同一套概率常数（p5Rate / P4_BASE / P5_HARD）与常驻五星名单，
//   由本模块直接复用 wishAnalysis 的导出，避免概率双份维护。
//
// 状态机关键点（逐条对应词条）：
//   1. 五星概率：角色池/集录池/常驻池 0.6% 起，第 74 抽起每抽 +6%，90 抽必出；
//      武器池 0.7% 起，第 63 抽起每抽 +7% 至第 73 抽，第 74 抽起每抽 +3.5%，80 抽必出。
//   2. 四星概率：角色池/集录池 5.1%、武器池 6.0%，五星优先占位
//      （四星有效概率 = 基础率 × 本次未出五星的概率）；连续 9 抽无四星及以上时
//      第 10 抽五星概率不变、其余概率全部归四星。
//   3. 角色池大小保底：小保底 50% UP；歪则大保底必得。多个角色池共享全部保底。
//      捕获明光：连续 2 次大保底才拿到 UP 后，下一次小保底 53%/47%（等效 47 歪 / 47 不歪 / 6 明光），
//      连续 3 次后下一次必得 UP；小保底直接命中则连保清零。
//   4. 武器池神铸定轨：命定值 0/1。未定轨时 75% 平分给两把 UP、25% 常驻；
//      定轨后小保底 37.5% 定轨目标 / 37.5% 另一把 UP / 25% 常驻，任意非目标五星都令命定值 +1；
//      命定值 1 时下一把五星必为定轨目标，随后清零。
//   5. 集录池集录定轨：命定值 0/1，五星只会是池内同类型（角色/武器）物品，
//      小保底 50% 定轨目标，歪则随机池内同类型其它五星并令命定值 +1；
//      未定轨时池内五星等概率。四星全部等可能，无 UP 机制、不受定轨影响。
//   6. 四星 UP 歪后必出：角色池/武器池获取的四星若非 UP，则下一个四星必定为 UP。
//   7. 副产物：五星角色第 2~7 次 +1 命星 +10 星辉、第 8 次起 +25 星辉 +1 无主的命星；
//      四星角色第 2~7 次 +1 命星 +2 星辉、第 8 次起 +5 星辉；
//      五星武器 +10 星辉、四星武器 +2 星辉、三星武器 +15 无主的星尘。
//   8. 消耗：角色池/武器池/集录池消耗纠缠之缘，常驻池消耗相遇之缘；
//      球不足时按 160 原石 : 1 球补足，原石不足时按 1 创世结晶 : 1 原石补足。
// ═════════════════════════════════════════════════════════════════

// 显式带 .js 后缀：Vite 与 node ESM（scripts/test-wish-simulator.mjs）双端可解析
import { p5Rate, P4_BASE, P5_HARD, STANDARD_5STAR_CHARS, STANDARD_5STAR_WEAPONS } from './wishAnalysis.js'

export { p5Rate, P4_BASE, P5_HARD, STANDARD_5STAR_CHARS, STANDARD_5STAR_WEAPONS }

// ── 存档结构版本（结构不兼容时递增，用于迁移）──
export const SIM_ARCHIVE_VERSION = 2

// ── 卡池 id ──
export const POOL_IDS = ['character1', 'character2', 'weapon', 'chronicled', 'standard']

/** 卡池 → 池种。角色活动祈愿与角色活动祈愿-2 同属 character（共享保底） */
export const POOL_KIND = {
  character1: 'character',
  character2: 'character',
  weapon: 'weapon',
  chronicled: 'chronicled',
  standard: 'standard',
}

/** 保底分组：同组共享五星/四星计数、大小保底、捕获明光连保与四星 UP 歪后必出 */
export const PITY_GROUP = {
  character1: 'character',
  character2: 'character',
  weapon: 'weapon',
  chronicled: 'chronicled',
  standard: 'standard',
}

export const KIND_LABEL = {
  character: '角色活动祈愿',
  weapon: '武器活动祈愿',
  chronicled: '集录祈愿',
  standard: '常驻祈愿',
}

export const POOL_LABEL = {
  character1: '角色活动祈愿',
  character2: '角色活动祈愿-2',
  weapon: '武器活动祈愿',
  chronicled: '集录祈愿',
  standard: '常驻祈愿',
}

/** 各池消耗的缘种 */
export const POOL_FATE = {
  character1: 'intertwined',
  character2: 'intertwined',
  weapon: 'intertwined',
  chronicled: 'intertwined',
  standard: 'acquaint',
}

export const FATE_LABEL = { intertwined: '纠缠之缘', acquaint: '相遇之缘' }

// ── 副产物常数 ──
/** 三星武器产出的无主的星尘（词条未写明，按原版规则；如需调整改此一处） */
export const STARDUST_PER_3STAR = 15
/** 无主的星辉兑换纠缠之缘/相遇之缘的单价（词条：5 星辉换一个） */
export const GLITTER_PER_FATE = 5
/** 无主的星尘兑换纠缠之缘/相遇之缘的单价（词条：75 星尘换一个，每月限 5 个） */
export const STARDUST_PER_FATE = 75
/** 星尘兑换的每月限量（词条口径，模拟器按存档全周期计数） */
export const STARDUST_FATE_MONTHLY_LIMIT = 5
/** 原石兑换缘的汇率 */
export const PRIMOGEM_PER_FATE = 160
/** 创世结晶 → 原石 的汇率（词条：原石不足时再以 1 创世结晶换 1 原石） */
export const PRIMOGEM_PER_GENESIS = 1

/**
 * 凝取结晶档位。
 *   base  —— 标准兑换数量（人民币 1:10）
 *   bonus —— 非双倍时额外赠送的数量
 *   双倍总数   = base × 2        （该档首次充值）
 *   非双倍总数 = base + bonus
 * 售价与赠送数额取自游戏内商城（￥6/30/98/198/328/648 六档）。
 */
export const GENESIS_TIERS = [
  { id: 'g60',   price: 6,   base: 60,   bonus: 0 },
  { id: 'g300',  price: 30,  base: 300,  bonus: 30 },
  { id: 'g980',  price: 98,  base: 980,  bonus: 110 },
  { id: 'g1980', price: 198, base: 1980, bonus: 260 },
  { id: 'g3280', price: 328, base: 3280, bonus: 600 },
  { id: 'g6480', price: 648, base: 6480, bonus: 1600 },
]

/** 某档位在「首充双倍」开/关时实际到账的创世结晶数 */
export function genesisTierTotal(tier, doubleFirst) {
  if (!tier) return 0
  return doubleFirst ? tier.base * 2 : tier.base + tier.bonus
}

/**
 * 创世结晶 → 原石（1:1）。
 * @returns {{ ok, resources, converted, cost }}
 */
export function exchangeGenesisForPrimogem(res, crystals) {
  const out = normalizeResources(res)
  const n = Math.max(0, Math.floor(crystals))
  if (n <= 0) return { ok: false, resources: out, converted: 0, cost: 0, reason: '数量需大于 0' }
  const cost = n * PRIMOGEM_PER_GENESIS
  if (out.genesis < cost) {
    return { ok: false, resources: out, converted: 0, cost, max: Math.floor(out.genesis / PRIMOGEM_PER_GENESIS), reason: '创世结晶不足' }
  }
  out.genesis -= cost
  out.primogem += n
  return { ok: true, resources: out, converted: n, cost }
}

/**
 * 充值某一档凝取结晶。
 * @param {boolean} doubleFirst 首充双倍是否可用（商城里的开关）
 * @returns {{ ok, resources, gained, tier }}
 */
export function rechargeGenesis(res, tierId, doubleFirst) {
  const out = normalizeResources(res)
  const tier = GENESIS_TIERS.find(t => t.id === tierId)
  if (!tier) return { ok: false, resources: out, gained: 0, reason: '档位不存在' }
  const gained = genesisTierTotal(tier, doubleFirst)
  out.genesis += gained
  return { ok: true, resources: out, gained, tier }
}

/**
 * 充值某一档并把这一笔记进账单（账单随存档保存）。
 * @param {object} rt 运行态（会读/写 rt.resources 与 rt.recharges）
 * @param {string} tierId 档位 id
 * @param {boolean} doubled 是否按首充双倍结算
 * @param {number} now 记账时间戳（便于测试注入）
 * @returns {{ ok, resources, gained, entry, reason }}
 */
export function purchaseGenesis(rt, tierId, doubled, now = Date.now()) {
  const tier = GENESIS_TIERS.find(t => t.id === tierId)
  if (!tier) return { ok: false, gained: 0, resources: normalizeResources(rt?.resources), reason: '档位不存在' }
  const gained = genesisTierTotal(tier, doubled)
  const resources = normalizeResources(rt.resources)
  resources.genesis += gained
  const entry = {
    id: `rc_${now}_${tierId}`,
    tierId: tier.id,
    price: tier.price,
    base: tier.base,
    bonus: tier.bonus,
    doubled: !!doubled,
    gained,
    time: new Date(now).toISOString(),
  }
  return { ok: true, resources, gained, entry, tier }
}

/** 账单汇总：总人民币、总创世结晶、笔数 */
export function rechargeSummary(recharges) {
  const list = Array.isArray(recharges) ? recharges : []
  return {
    count: list.length,
    totalRmb: list.reduce((a, r) => a + (Number(r.price) || 0), 0),
    totalCrystals: list.reduce((a, r) => a + (Number(r.gained) || 0), 0),
  }
}

/**
 * 抽卡资金规划 —— 把「够不够抽」拆成三种结果，供 UI 决定是否弹确认框。
 *   direct  存量缘就够，直接抽，不打扰用户
 *   convert 缘不够，但原石 + 创世结晶够，需要用户确认后自动转化
 *   short   三者都不够
 * @returns {{ mode, plan, shortfall }}
 */
export function planPullFunding(res, poolId, count) {
  const plan = planFateExchange(res, poolId, count)
  if (plan.ok) {
    const needsConvert = plan.fromPrimogem > 0 || plan.genesisUsed > 0
    return { mode: needsConvert ? 'convert' : 'direct', plan, shortfall: 0 }
  }
  return { mode: 'short', plan, shortfall: plan.primogemShort }
}

// ═════════════════════════════════════════════════════════════════
// 一、资源
// ═════════════════════════════════════════════════════════════════

export function emptyResources() {
  return {
    genesis: 0,        // 创世结晶
    primogem: 0,       // 原石
    intertwined: 0,    // 纠缠之缘
    acquaint: 0,       // 相遇之缘
    starglitter: 0,    // 无主的星辉（副产物，可兑换缘）
    stardust: 0,       // 无主的星尘（副产物，可兑换缘）
  }
}

export function normalizeResources(r) {
  const out = emptyResources()
  if (r) {
    for (const k of Object.keys(out)) {
      const v = Math.floor(Number(r[k]))
      out[k] = Number.isFinite(v) && v > 0 ? v : 0
    }
  }
  return out
}

/**
 * 计算为获得 need 个指定缘所需的兑换方案（不修改入参）
 * 兑换链完全照原版：先用存量缘 → 再用原石 160:1 → 最后用创世结晶 1:1 换原石
 * @returns {{ ok, need, fromStock, primogemUsed, genesisUsed, primogemShort }}
 */
export function planFateExchange(res, poolId, need) {
  const r = normalizeResources(res)
  const fateKey = POOL_FATE[poolId] || 'intertwined'
  const want = Math.max(0, Math.floor(need))
  const fromStock = Math.min(r[fateKey], want)
  let rest = want - fromStock

  // 原石（含已持有的零头）能换多少个
  let primogem = r.primogem
  const fromPrimogem = Math.min(Math.floor(primogem / PRIMOGEM_PER_FATE), rest)
  const primogemUsed = fromPrimogem * PRIMOGEM_PER_FATE
  primogem -= primogemUsed
  rest -= fromPrimogem

  // 创世结晶 1:1 补原石
  let genesisUsed = 0
  if (rest > 0) {
    const needPrimogem = rest * PRIMOGEM_PER_FATE - primogem
    if (needPrimogem > 0) genesisUsed = Math.min(r.genesis, needPrimogem)
  }
  const primogemShort = rest > 0 ? Math.max(0, rest * PRIMOGEM_PER_FATE - primogem - genesisUsed) : 0

  return {
    ok: primogemShort === 0,
    need: want,
    fateKey,
    fromStock,
    fromPrimogem,
    primogemUsed,
    genesisUsed,
    primogemShort,
  }
}

/**
 * 执行兑换并扣除 n 个缘。返回新资源对象（不修改入参）。
 * @returns {{ ok, resources, spent: {fate, primogem, genesis}, short }}
 */
export function spendFates(res, poolId, n) {
  const plan = planFateExchange(res, poolId, n)
  const out = normalizeResources(res)
  if (!plan.ok) return { ok: false, resources: out, spent: null, short: plan.primogemShort, plan }

  // 兑换出的缘「即换即用」：只扣除存量部分，其余由原石/创世结晶直接抵扣
  out[plan.fateKey] -= plan.fromStock
  out.primogem -= plan.primogemUsed
  out.genesis -= plan.genesisUsed
  return {
    ok: true,
    resources: out,
    spent: { fate: n, primogem: plan.primogemUsed, genesis: plan.genesisUsed, primogemFromGenesis: plan.genesisUsed },
    plan,
  }
}

/**
 * 商城「原石兑换」：160 原石换 1 个指定种类的缘。
 * 与 spendFates 不同，这里是**先换后用**（换出来的缘进背包），供商城界面使用。
 */
export function exchangePrimogemForFate(res, fateKey, count) {
  const out = normalizeResources(res)
  const key = FATE_LABEL[fateKey] ? fateKey : 'intertwined'
  const n = Math.max(0, Math.floor(count))
  const cost = n * PRIMOGEM_PER_FATE
  if (n <= 0) return { ok: false, resources: out, reason: '数量需大于 0', max: Math.floor(out.primogem / PRIMOGEM_PER_FATE) }
  if (out.primogem < cost) {
    return { ok: false, resources: out, reason: '原石不足', cost, max: Math.floor(out.primogem / PRIMOGEM_PER_FATE) }
  }
  out.primogem -= cost
  out[key] += n
  return { ok: true, resources: out, exchanged: n, cost, fateKey: key }
}

/** 商城「星辉兑换」：5 星辉换 1 个指定种类的缘 */
export function exchangeStarglitterForFate(res, fateKey, count) {
  const out = normalizeResources(res)
  const key = FATE_LABEL[fateKey] ? fateKey : 'intertwined'
  const n = Math.max(0, Math.floor(count))
  const cost = n * GLITTER_PER_FATE
  if (n <= 0) return { ok: false, resources: out, reason: '数量需大于 0', max: Math.floor(out.starglitter / GLITTER_PER_FATE) }
  if (out.starglitter < cost) {
    return { ok: false, resources: out, reason: '星辉不足', cost, max: Math.floor(out.starglitter / GLITTER_PER_FATE) }
  }
  out.starglitter -= cost
  out[key] += n
  return { ok: true, resources: out, exchanged: n, cost, fateKey: key }
}

/** 用无主的星辉兑换缘（5 星辉 : 1 缘）—— 按卡池指定缘种，供抽卡记录面板使用 */
export function exchangeByGlitter(res, poolId, count) {
  const out = normalizeResources(res)
  const fateKey = POOL_FATE[poolId] || 'intertwined'
  const n = Math.max(0, Math.floor(count))
  const cost = n * GLITTER_PER_FATE
  if (out.starglitter < cost) return { ok: false, resources: out, reason: '星辉不足', max: Math.floor(out.starglitter / GLITTER_PER_FATE) }
  out.starglitter -= cost
  out[fateKey] += n
  return { ok: true, resources: out, exchanged: n, cost }
}

/** 用无主的星尘兑换缘（75 星尘 : 1 缘，每存档限 5 个） */
export function exchangeByStardust(res, poolId, count, usedSoFar = 0) {
  const out = normalizeResources(res)
  const fateKey = POOL_FATE[poolId] || 'intertwined'
  const remain = Math.max(0, STARDUST_FATE_MONTHLY_LIMIT - Math.floor(usedSoFar))
  const n = Math.min(Math.max(0, Math.floor(count)), remain)
  const cost = n * STARDUST_PER_FATE
  if (out.stardust < cost) return { ok: false, resources: out, reason: '星尘不足', max: Math.floor(out.stardust / STARDUST_PER_FATE) }
  out.stardust -= cost
  out[fateKey] += n
  return { ok: true, resources: out, exchanged: n, cost, remain: remain - n }
}

// ═════════════════════════════════════════════════════════════════
// 二、卡池定义装配
// ═════════════════════════════════════════════════════════════════

/**
 * 物品对象（由调用方从数据库装配）
 * @typedef {{
 *   type: 'character'|'weapon', id: number, name: string, rarity: number,
 *   art?: string, splash?: string, element?: string, weaponType?: string, key: string
 * }} SimItem
 */

export function itemKey(type, id) { return `${type}:${id}` }

/**
 * 归一化卡池定义。调用方只需给出内容，本函数负责补齐默认值与派生字段。
 * @param {string} id 池 id
 * @param {object} raw { kind, bannerName, bannerImage, up5, up4, pool5, pool4, enabled }
 * @param {object} roster { weapons3: SimItem[], std5:[], std4:[] }
 */
export function normalizePoolDef(id, raw, roster = {}) {
  const kind = raw?.kind || POOL_KIND[id] || 'character'
  const up5 = (raw?.up5 || []).filter(Boolean)
  const up4 = (raw?.up4 || []).filter(Boolean)
  // 集录池需要完整池内容；未显式给出时退化为「UP 即为全部」
  const pool5 = (raw?.pool5 && raw.pool5.length ? raw.pool5 : up5).filter(Boolean)
  const pool4 = (raw?.pool4 && raw.pool4.length ? raw.pool4 : up4).filter(Boolean)
  return {
    id,
    kind,
    enabled: raw?.enabled !== false,
    bannerName: raw?.bannerName || (raw?.up5?.[0]?.name ?? '') || POOL_LABEL[id] || '',
    bannerImage: raw?.bannerImage || null,
    bannerImages: raw?.bannerImages || (raw?.bannerImage ? [raw.bannerImage] : []),
    up5, up4, pool5, pool4,
    // 常驻池与集录池的五星/四星可选集合
    standard5: roster.std5 || [],
    standard4: roster.std4 || [],
    weapons3: roster.weapons3 || [],
  }
}

/** 该池是否可定轨（武器池、集录池） */
export function poolEpitomizable(kind) { return kind === 'weapon' || kind === 'chronicled' }

/** 该池的定轨候选（武器池两把 UP；集录池全部池内五星） */
export function epitomeCandidates(pool) {
  if (!poolEpitomizable(pool.kind)) return []
  return pool.kind === 'weapon' ? pool.up5 : pool.pool5
}

// ═════════════════════════════════════════════════════════════════
// 三、运行时状态
// ═════════════════════════════════════════════════════════════════

function emptyPityGroup(kind) {
  const g = { kind, p5: 0, p4: 0 }
  if (kind === 'character') { g.guaranteed = 0; g.crStreak = 0; g.gu4 = 0 }
  else if (kind === 'weapon') { g.fate = 0; g.gu4 = 0 }
  else if (kind === 'chronicled') { g.fate = 0 }
  return g
}

export function emptyPityState() {
  return {
    character: emptyPityGroup('character'),
    weapon: emptyPityGroup('weapon'),
    chronicled: emptyPityGroup('chronicled'),
    standard: emptyPityGroup('standard'),
  }
}

/** 新建一局运行时状态 */
export function createRuntime(initialResources) {
  return {
    resources: normalizeResources(initialResources),
    pity: emptyPityState(),
    records: [],
    seq: 0,
    batchSeq: 0,
    // 已获得物品计数（用于命座/星辉分层）key = `${type}:${id}`
    obtained: {},
    epicomized: { weapon: null, chronicled: null }, // 定轨目标 itemKey
    stardustFateUsed: 0,
    spend: { fate: 0, primogem: 0, genesis: 0 },
    startedAt: null,
    /**
     * 「首充双倍」是否可用（商城凝取结晶页的开关）。
     * 默认关闭 —— 原版只有新号/刚重置过的账号才有首充双倍，多数情况下没有。
     * 这是存档的一部分（不同人的首充使用情况不同），随存档读写。
     */
    firstChargeDouble: false,
    /** 本存档的充值账单：[{ id, tierId, price, base, bonus, doubled, gained, time }] */
    recharges: [],
  }
}

/**
 * 把外部（存档）读入的运行时状态补全为当前结构，容错优先。
 * @param {object} raw
 */
export function reviveRuntime(raw, fallbackResources) {
  const base = createRuntime(fallbackResources)
  if (!raw || typeof raw !== 'object') return base
  const out = {
    ...base,
    ...raw,
    resources: normalizeResources(raw.resources || fallbackResources),
    pity: { ...emptyPityState(), ...(raw.pity || {}) },
    records: Array.isArray(raw.records) ? raw.records : [],
    obtained: raw.obtained && typeof raw.obtained === 'object' ? raw.obtained : {},
    epicomized: { weapon: null, chronicled: null, ...(raw.epicomized || {}) },
    spend: { fate: 0, primogem: 0, genesis: 0, ...(raw.spend || {}) },
    firstChargeDouble: raw.firstChargeDouble === true,
    recharges: Array.isArray(raw.recharges) ? raw.recharges.filter(r => r && typeof r === 'object') : [],
  }
  for (const k of Object.keys(out.pity)) {
    out.pity[k] = { ...emptyPityGroup(k), ...out.pity[k], kind: k }
  }
  out.seq = Number(out.seq) || out.records.length
  out.batchSeq = Number(out.batchSeq) || 0
  out.stardustFateUsed = Number(out.stardustFateUsed) || 0
  return out
}

// ═════════════════════════════════════════════════════════════════
// 四、抽取判定
// ═════════════════════════════════════════════════════════════════

/** 本次抽取的五星概率（p5 为「距上次五星已抽数」，故本次是第 p5+1 抽） */
export function fiveStarRate(kind, pity5) {
  return p5Rate(kind === 'standard' ? 'character' : kind, pity5 + 1)
}

/** 本次抽取的四星有效概率（五星优先占位；第 10 抽保底时承接全部剩余概率） */
export function fourStarRate(kind, pity5, pity4, r5) {
  const base = kind === 'weapon' ? P4_BASE.weapon : P4_BASE.character
  if (r5 >= 1) return 0
  return pity4 >= 9 ? 1 - r5 : base * (1 - r5)
}

/** 该池的硬保底抽数 */
export function hardPityOf(kind) {
  return kind === 'weapon' ? P5_HARD.weapon : P5_HARD.character
}

/** 从数组里等概率取一个 */
function pick(arr, rng) {
  if (!arr || arr.length === 0) return null
  return arr[Math.floor(rng() * arr.length) % arr.length]
}

/**
 * 逐级回退取第一个非空列表后随机取一个。
 * 用途：数据库里最新几期卡池常常尚未爬全（例如 6.7 集录祈愿的四星条目为 0），
 * 若直接对空池取随机会返回 null，进而让整次抽取失败、十连中途截断。
 */
function pickFrom(lists, rng) {
  for (const l of lists) {
    if (l && l.length) return pick(l, rng)
  }
  return null
}

/** 按 item.key 去重合并（集录池的四星 = 池内写明 + 所有常驻四星武器） */
function unionByKey(...lists) {
  const seen = new Set()
  const out = []
  for (const l of lists) {
    for (const it of l || []) {
      if (!it) continue
      const k = it.key || `${it.type}:${it.id}`
      if (seen.has(k)) continue
      seen.add(k)
      out.push(it)
    }
  }
  return out
}

/** 常驻四星武器（词条：混池四星 = 池内写明 + 所有常驻四星武器） */
function std4WeaponsOf(pool) {
  return (pool.standard4 || []).filter(i => i.type === 'weapon')
}

/**
 * 决定五星物品，并就地更新保底状态。
 * @returns {{ item: SimItem, isUp: boolean, guaranteeUsed: boolean, crTriggered: boolean }}
 */
function resolve5Star(pool, group, rng) {
  const kind = pool.kind

  if (kind === 'character') {
    const target = pool.up5[0] || null
    const wasGuaranteed = group.guaranteed === 1
    const stdChars = pool.standard5.filter(i => i.type === 'character')
    if (!target) {
      // 未配置 UP：直接给常驻（空则继续回退，保证一定出物）
      return { item: pickFrom([stdChars, pool.standard5, pool.up5], rng), isUp: false, guaranteeUsed: false, crTriggered: false }
    }
    const winP = wasGuaranteed ? 1 : (group.crStreak >= 3 ? 1 : group.crStreak === 2 ? 0.53 : 0.5)
    const crTriggered = !wasGuaranteed && group.crStreak >= 3
    if (rng() < winP) {
      // 命中 UP
      group.crStreak = wasGuaranteed ? Math.min(3, group.crStreak + 1) : 0
      group.guaranteed = 0
      return { item: target, isUp: true, guaranteeUsed: wasGuaranteed, crTriggered }
    }
    // 歪：常驻五星角色等概率
    group.guaranteed = 1
    group.crStreak = 0
    return { item: pickFrom([stdChars, pool.standard5, pool.up5], rng), isUp: false, guaranteeUsed: false, crTriggered: false }
  }

  if (kind === 'weapon') {
    const epiKey = pool.epitomizedKey
    const epi = epiKey ? pool.up5.find(i => i.key === epiKey) || null : null
    const std = pool.standard5.filter(i => i.type === 'weapon')
    const fallback5 = [std, pool.standard5, pool.up5]
    if (group.fate === 1 && epi) {
      group.fate = 0
      return { item: epi, isUp: true, guaranteeUsed: true, crTriggered: false }
    }
    if (epi) {
      const roll = rng()
      if (roll < 0.375) { return { item: epi, isUp: true, guaranteeUsed: false, crTriggered: false } }
      if (roll < 0.75) {
        const other = pool.up5.find(i => i.key !== epiKey)
        group.fate = 1
        return { item: other || epi, isUp: false, guaranteeUsed: false, crTriggered: false }
      }
      group.fate = 1
      return { item: pickFrom(fallback5, rng), isUp: false, guaranteeUsed: false, crTriggered: false }
    }
    // 未定轨：75% 平分给 UP，25% 常驻
    if (pool.up5.length > 0 && rng() < 0.75) {
      return { item: pick(pool.up5, rng), isUp: true, guaranteeUsed: false, crTriggered: false }
    }
    return { item: pickFrom(fallback5, rng), isUp: false, guaranteeUsed: false, crTriggered: false }
  }

  if (kind === 'chronicled') {
    const epiKey = pool.epitomizedKey
    // 词条：集录五星「仅会为池中的角色/武器」（不歪常驻）。
    // 因此主列表严格取 pool5，standard5 只作为「数据缺失导致池为空」时的兜底。
    const pool5 = pool.pool5
    const epi = epiKey ? pool5.find(i => i.key === epiKey) || null : null
    if (group.fate === 1 && epi) {
      group.fate = 0
      return { item: epi, isUp: true, guaranteeUsed: true, crTriggered: false }
    }
    if (epi) {
      const sameType = pool.pool5.filter(i => i.type === epi.type && i.key !== epi.key)
      if (rng() < 0.5 || sameType.length === 0) {
        return { item: epi, isUp: true, guaranteeUsed: false, crTriggered: false }
      }
      group.fate = 1
      return { item: pick(sameType, rng), isUp: false, guaranteeUsed: false, crTriggered: false }
    }
    return { item: pickFrom([pool5, pool.standard5, pool.up5], rng), isUp: false, guaranteeUsed: false, crTriggered: false }
  }

  // 常驻池
  return { item: pickFrom([pool.standard5, pool.up5, pool.pool5], rng), isUp: false, guaranteeUsed: false, crTriggered: false }
}

/**
 * 决定四星物品，并就地更新四星 UP 与保底状态。
 */
function resolve4Star(pool, group, rng) {
  const kind = pool.kind

  if (kind === 'chronicled') {
    // 词条：混池四星 = 卡池写明的四星角色/四星武器 + 常驻四星武器，全部等可能。
    // 数据库的 wish_banner_items 已按此写好，故主列表严格取 pool4；
    // 仅当该期数据尚未爬全（pool4 为空，如 6.7 期）才用常驻四星武器兜底，避免抽取失败。
    return { item: pickFrom([pool.pool4, std4WeaponsOf(pool), pool.standard4, pool.up4], rng), isUp: false }
  }
  if (kind === 'standard') {
    return { item: pickStandard4(pool, rng), isUp: false }
  }
  // 角色池 / 武器池：50% UP，歪后下一个四星必为 UP
  const up4 = pool.up4.filter(Boolean)
  if (up4.length === 0) return { item: pickStandard4(pool, rng), isUp: false }
  if (group.gu4 === 1) {
    group.gu4 = 0
    return { item: pick(up4, rng), isUp: true }
  }
  if (rng() < 0.5) {
    return { item: pick(up4, rng), isUp: true }
  }
  group.gu4 = 1
  return { item: pickStandard4(pool, rng), isUp: false }
}

/** 常驻四星：先按 50% 决定角色/武器，再在该类中随机一个 */
function pickStandard4(pool, rng) {
  // 常驻四星为空时（卡池数据未爬全）逐级回退，绝不返回 null
  const chars = pool.standard4.filter(i => i.type === 'character')
  const weapons = pool.standard4.filter(i => i.type === 'weapon')
  if (chars.length === 0 || weapons.length === 0) {
    return pickFrom([pool.standard4, pool.up4, pool.pool4], rng)
  }
  return rng() < 0.5 ? pick(chars, rng) : pick(weapons, rng)
}

/** 三星：全池共用同一套常驻三星武器 */
function resolve3Star(pool, rng) {
  return pickFrom([pool.weapons3, pool.standard4, pool.standard5, pool.up4, pool.pool4], rng)
}

/**
 * 结算副产物。会就地更新 obtained 计数。
 * @returns {{ glitter:number, stardust:number, constellation:number, crown:number, copyIndex:number }}
 */
export function settleByproduct(item, obtained) {
  const k = item.key || itemKey(item.type, item.id)
  const copyIndex = (obtained[k] || 0) + 1
  obtained[k] = copyIndex
  const out = { glitter: 0, stardust: 0, constellation: 0, crown: 0, copyIndex }
  if (item.type === 'character') {
    if (item.rarity === 5) {
      if (copyIndex >= 8) { out.glitter = 25; out.crown = 1 } else if (copyIndex >= 2) { out.glitter = 10; out.constellation = 1 }
    } else if (item.rarity === 4) {
      if (copyIndex >= 8) { out.glitter = 5 } else if (copyIndex >= 2) { out.glitter = 2; out.constellation = 1 }
    }
  } else {
    if (item.rarity === 5) out.glitter = 10
    else if (item.rarity === 4) out.glitter = 2
    else out.stardust = STARDUST_PER_3STAR
  }
  return out
}

// ═════════════════════════════════════════════════════════════════
// 五、对外抽卡 API
// ═════════════════════════════════════════════════════════════════

/**
 * 单次抽取（会修改 runtime）
 * @param {object} runtime createRuntime 产物
 * @param {object} pool    normalizePoolDef 产物
 * @param {object} opts    { rng, record=true }
 * @returns {object|null}  抽卡记录项；资源不足或池未启用时返回 null
 */
export function drawOnce(runtime, pool, opts = {}) {
  const rng = opts.rng || Math.random
  if (!pool || pool.enabled === false) return null

  const groupKey = PITY_GROUP[pool.id] || pool.kind
  const group = runtime.pity[groupKey]
  if (!group) return null

  // 资源结算（一抽一个缘）
  const resourcesBefore = runtime.resources
  const pay = spendFates(runtime.resources, pool.id, 1)
  if (!pay.ok) return null
  runtime.resources = pay.resources
  runtime.spend.fate += 1
  runtime.spend.primogem += pay.spent.primogem
  runtime.spend.genesis += pay.spent.genesis

  // 定轨目标存放在 runtime 上（切换/清空定轨由外部动作驱动）
  const effectivePool = { ...pool, epitomizedKey: runtime.epicomized?.[pool.id] || pool.epitomizedKey || null }

  const r5 = fiveStarRate(pool.kind, group.p5)
  const r4 = fourStarRate(pool.kind, group.p5, group.p4, r5)
  const roll = rng()

  const groupBefore = { ...group }
  const before = {
    p5: group.p5, p4: group.p4,
    guaranteed: group.guaranteed ?? null,
    crStreak: group.crStreak ?? null,
    fate: group.fate ?? null,
    gu4: group.gu4 ?? null,
  }

  let item = null, rarity = 3, isUp = false, guaranteeUsed = false, crTriggered = false

  if (roll < r5) {
    const res = resolve5Star(effectivePool, group, rng)
    item = res.item; rarity = 5; isUp = res.isUp
    guaranteeUsed = res.guaranteeUsed; crTriggered = res.crTriggered
    group.p5 = 0
    group.p4 = 0
    // 出五星会同时重置四星保底（词条：获得五星物品后 10 次保障计数与保底计数重置）
  } else if (roll < r5 + r4) {
    const res = resolve4Star(effectivePool, group, rng)
    item = res.item; rarity = 4; isUp = res.isUp
    group.p4 = 0
    group.p5 += 1
  } else {
    item = resolve3Star(effectivePool, rng)
    rarity = 3
    group.p5 += 1
    group.p4 += 1
  }

  if (!item) {
    // 该池没有任何可用物品（数据缺失且无回退目标）：回滚本次消耗与保底变更
    runtime.resources = resourcesBefore
    Object.assign(group, groupBefore)
    return null
  }
  if (item.rarity && item.rarity !== rarity && rarity !== 3) rarity = item.rarity

  const by = settleByproduct(item, runtime.obtained)
  runtime.resources.starglitter += by.glitter
  runtime.resources.stardust += by.stardust

  runtime.seq += 1
  const rec = {
    seq: runtime.seq,
    pool: pool.id,
    poolKind: pool.kind,
    poolLabel: POOL_LABEL[pool.id] || pool.kind,
    itemType: item.type,
    itemId: item.id,
    name: item.name,
    rarity,
    art: item.art || null,
    splash: item.splash || null,
    element: item.element || null,
    weaponType: item.weaponType || null,
    isUp,
    before,
    pity5: rarity === 5 ? before.p5 + 1 : null,   // 该五星是在第几抽出的
    pity4: rarity === 4 ? before.p4 + 1 : null,
    guaranteeUsed,
    crTriggered,
    glitter: by.glitter,
    stardust: by.stardust,
    constellation: by.constellation,
    crown: by.crown,
    copyIndex: by.copyIndex,
    time: new Date().toISOString(),
  }
  runtime.records.push(rec)
  return rec
}

/**
 * 连续抽取（会修改 runtime）
 * @returns {{ records: object[], batchId: number, stopped: boolean }}
 */
export function drawMany(runtime, pool, count, opts = {}) {
  const rng = opts.rng || Math.random
  const records = []
  runtime.batchSeq += 1
  const batchId = runtime.batchSeq
  let stopped = false
  for (let i = 0; i < count; i++) {
    const rec = drawOnce(runtime, pool, { rng })
    if (!rec) { stopped = true; break }
    rec.batchId = batchId
    rec.batchIndex = i
    rec.batchSize = count
    records.push(rec)
  }
  return { records, batchId, stopped }
}

/** 本次模拟是否可以继续抽取（资源是否够再抽一个） */
export function canPull(runtime, poolId) {
  return planFateExchange(runtime.resources, poolId, 1).ok
}

/**
 * 追加资源（模拟中的「申请补充抽卡资源」）
 * @param {object} runtime
 * @param {{genesis?:number,primogem?:number,intertwined?:number,acquaint?:number,starglitter?:number,stardust?:number}} add
 */
export function grantResources(runtime, add) {
  const r = normalizeResources(runtime.resources)
  for (const k of Object.keys(add || {})) {
    const v = Math.floor(Number(add[k]) || 0)
    if (v) r[k] = Math.max(0, r[k] + v)
  }
  runtime.resources = r
  return r
}

// ═════════════════════════════════════════════════════════════════
// 六、统计
// ═════════════════════════════════════════════════════════════════

/** 单池统计 */
export function poolStats(records, poolId) {
  const rs = poolId ? records.filter(r => r.pool === poolId) : records
  const s = {
    total: rs.length,
    count3: 0, count4: 0, count5: 0,
    up5: 0, offBanner5: 0, up4: 0, offBanner4: 0,
    glitter: 0, stardust: 0, constellation: 0, crown: 0,
    fiveStarPities: [],
    fourStarPities: [],
    timeline: [],       // 五星时间线：{ name, rarity, isUp, pity, seq, poolLabel }
    itemCounts: {},
  }
  for (const r of rs) {
    if (r.rarity === 5) s.count5 += 1
    else if (r.rarity === 4) s.count4 += 1
    else s.count3 += 1
    if (r.rarity === 5) { if (r.isUp) s.up5 += 1; else s.offBanner5 += 1 }
    if (r.rarity === 4) { if (r.isUp) s.up4 += 1; else s.offBanner4 += 1 }
    s.glitter += r.glitter || 0
    s.stardust += r.stardust || 0
    s.constellation += r.constellation || 0
    s.crown += r.crown || 0
    if (r.rarity === 5 && r.pity5) { s.fiveStarPities.push(r.pity5); s.timeline.push({ name: r.name, isUp: r.isUp, pity: r.pity5, seq: r.seq, poolLabel: r.poolLabel, art: r.art, itemType: r.itemType, element: r.element, rarity: 5 }) }
    if (r.rarity === 4 && r.pity4) s.fourStarPities.push(r.pity4)
    const k = `${r.itemType}:${r.itemId}`
    s.itemCounts[k] = (s.itemCounts[k] || 0) + 1
  }
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)
  s.avg5 = avg(s.fiveStarPities)
  s.avg4 = avg(s.fourStarPities)
  s.min5 = s.fiveStarPities.length ? Math.min(...s.fiveStarPities) : 0
  s.max5 = s.fiveStarPities.length ? Math.max(...s.fiveStarPities) : 0
  s.rate5 = s.total ? s.count5 / s.total : 0
  s.rate4 = s.total ? s.count4 / s.total : 0
  s.upRate5 = s.count5 ? s.up5 / s.count5 : 0
  s.avgPullsPer5 = s.count5 ? s.total / s.count5 : 0
  return s
}

/** 全局统计 */
export function overallStats(records) {
  const all = poolStats(records, null)
  const byPool = {}
  for (const id of POOL_IDS) {
    const s = poolStats(records, id)
    if (s.total > 0) byPool[id] = s
  }
  const fiveStars = all.timeline.slice().sort((a, b) => b.seq - a.seq)
  return { all, byPool, fiveStars }
}

/** 距离下次五星的剩余抽数（含硬保底） */
export function pitySummary(runtime, pools) {
  const out = {}
  for (const id of POOL_IDS) {
    const pool = pools[id]
    if (!pool || pool.enabled === false) continue
    const g = runtime.pity[PITY_GROUP[id] || pool.kind]
    out[id] = {
      p5: g.p5,
      p4: g.p4,
      hard: hardPityOf(pool.kind),
      guaranteed: g.guaranteed ?? null,
      crStreak: g.crStreak ?? null,
      fate: g.fate ?? null,
      epitomizedKey: runtime.epicomized?.[id] || null,
    }
  }
  return out
}

// ═════════════════════════════════════════════════════════════════
// 七、随机数（可选：可复现实验）
// ═════════════════════════════════════════════════════════════════

/** mulberry32 —— 与 wishAnalysis 的 makeRng 同族，便于测试复现 */
export function makeRng(seed = 0x5EED1234) {
  let a = seed >>> 0
  return function rng() {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

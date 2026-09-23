// ═════════════════════════════════════════════════════════════════
// 已垫抽数推算（北国银行 × 祈愿捕捉站 联动）
//
// 定义（用户口径）：某日期结束前一刻，每种祈愿「距离最近一次出金（五星）
// 之后所有抽数的总和」。角色活动祈愿合并 301/400（共享保底），
// 与武器活动祈愿（302）、集录祈愿（500）构成三类。
//
// 时间口径：以记录日期当日 23:59:59 为准 —— 即「day(time) <= date」的
// 全部记录都计入，跨天即切换。times 为 'YYYY-MM-DD HH:MM:SS' 字符串，
// 截取前 10 位比较即可。
// ═════════════════════════════════════════════════════════════════

/** 三类祈愿（顺序即展示顺序） */
export const PITY_GROUPS = [
  { key: 'character', label: '角色活动祈愿', short: '角色', types: [301, 400] },
  { key: 'weapon', label: '武器活动祈愿', short: '武器', types: [302] },
  { key: 'chronicled', label: '集录祈愿', short: '集录', types: [500] },
]

export const PITY_KEYS = PITY_GROUPS.map(g => g.key)

/** 全 0 的已垫抽数对象 */
export function emptyPity() {
  return { character: 0, weapon: 0, chronicled: 0 }
}

// 记录 id 为十进制字符串，按长度 + 字典序比较等价于数值比较
function cmpId(a, b) {
  const sa = String(a ?? '')
  const sb = String(b ?? '')
  if (sa.length !== sb.length) return sa.length < sb.length ? -1 : 1
  if (sa === sb) return 0
  return sa < sb ? -1 : 1
}

function itemDate(item) {
  return String(item?.time || '').slice(0, 10)
}

/** 'YYYY-MM-DD' 的前一天（本地日历）；非法输入返回 '' */
export function previousDateStr(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr || '')) return ''
  const d = new Date(`${dateStr}T00:00:00`)
  if (Number.isNaN(d.getTime())) return ''
  d.setDate(d.getDate() - 1)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// dates 中 <= dateStr 的元素个数（= 第一个 > dateStr 的下标）
function upperBoundDate(dates, dateStr) {
  let lo = 0
  let hi = dates.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (dates[mid] <= dateStr) lo = mid + 1
    else hi = mid
  }
  return lo
}

// fiveIdx 中 <= idx 的最后一个值；不存在返回 -1
function lastFiveAtOrBefore(fiveIdx, idx) {
  let lo = 0
  let hi = fiveIdx.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (fiveIdx[mid] <= idx) lo = mid + 1
    else hi = mid
  }
  return lo > 0 ? fiveIdx[lo - 1] : -1
}

/**
 * 将祈愿捕捉站的原始记录构建为按日查询的索引。
 * @param {{[gachaType:number]: Array<{time:string,id:string|number,rank_type:number|string}>}} itemsByType
 * @returns {{[groupKey:string]: {dates:string[], fiveIdx:number[], count:number}}}
 */
export function buildPityIndex(itemsByType) {
  const index = {}
  for (const group of PITY_GROUPS) {
    const items = []
    for (const type of group.types) {
      for (const item of (itemsByType?.[type] || [])) {
        if (item && item.time) items.push(item)
      }
    }
    items.sort((a, b) => {
      const ta = String(a.time)
      const tb = String(b.time)
      if (ta < tb) return -1
      if (ta > tb) return 1
      return cmpId(a.id, b.id)
    })
    const dates = items.map(itemDate)
    const fiveIdx = []
    for (let i = 0; i < items.length; i++) {
      if (Number(items[i].rank_type) === 5) fiveIdx.push(i)
    }
    index[group.key] = { dates, fiveIdx, count: items.length }
  }
  return index
}

/**
 * 某日期结束前一刻，三类祈愿各自的已垫抽数。
 * @param {ReturnType<typeof buildPityIndex>} index
 * @param {string} dateStr 'YYYY-MM-DD'
 */
export function pityAtDate(index, dateStr) {
  const out = emptyPity()
  if (!index || !dateStr) return out
  for (const group of PITY_GROUPS) {
    const g = index[group.key]
    if (!g || !g.count) continue
    const counted = upperBoundDate(g.dates, dateStr) // 截至当日已计入的总抽数
    if (counted === 0) continue
    const last5 = lastFiveAtOrBefore(g.fiveIdx, counted - 1)
    out[group.key] = last5 < 0 ? counted : counted - 1 - last5
  }
  return out
}

/**
 * 某记录日的期初 / 期末已垫抽数：
 *   start = 当日刚开始那一刻（= 前一日结束前一刻）
 *   end   = 当日结束前一刻
 */
export function pityRangeAtDate(index, dateStr) {
  return {
    start: pityAtDate(index, previousDateStr(dateStr)),
    end: pityAtDate(index, dateStr),
  }
}

/** 按勾选项求和；未选择任何项时为 0 */
export function sumPity(pity, selectedKeys) {
  if (!pity) return 0
  const keys = Array.isArray(selectedKeys) ? selectedKeys : PITY_KEYS
  let sum = 0
  for (const key of keys) sum += Number(pity[key]) || 0
  return sum
}

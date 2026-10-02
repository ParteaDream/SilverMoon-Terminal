/**
 * bookMeta.js — 书籍板块共用的分类常量与视觉规范
 *
 * 体裁与国家是「多值字段」（一本书可能同时属于「史书、小说、工具书」或
 * 「璃月、稻妻」），列表页的筛选项直接从数据里拆出单项来汇总，这里只定义
 * 取值顺序与配色，列表页与详情页引用同一份，避免两处风格漂移。
 */

/** 体裁（bilibili wiki 的 9 类，实测全集） */
export const BOOK_GENRES = [
  '小说', '故事传说', '诗歌', '寓言童话', '史书', '工具书', '游记日志', '人物传记', '戏剧',
]

export const BOOK_GENRE_STYLE = {
  小说: 'bg-rose-500/12 text-rose-300 border-rose-500/25',
  故事传说: 'bg-amber-500/12 text-amber-300 border-amber-500/25',
  诗歌: 'bg-violet-500/12 text-violet-300 border-violet-500/25',
  寓言童话: 'bg-emerald-500/12 text-emerald-300 border-emerald-500/25',
  史书: 'bg-orange-500/12 text-orange-300 border-orange-500/25',
  工具书: 'bg-sky-500/12 text-sky-300 border-sky-500/25',
  游记日志: 'bg-teal-500/12 text-teal-300 border-teal-500/25',
  人物传记: 'bg-fuchsia-500/12 text-fuchsia-300 border-fuchsia-500/25',
  戏剧: 'bg-indigo-500/12 text-indigo-300 border-indigo-500/25',
}

export const BOOK_GENRE_STYLE_FALLBACK = 'bg-surface-700 text-surface-300 border-surface-600'

/** 国家/地区（wiki 用 0-8 的数字码，这里是展示顺序） */
export const BOOK_COUNTRIES = [
  '提瓦特', '蒙德', '璃月', '稻妻', '须弥', '枫丹', '纳塔', '挪德卡莱', '至冬',
]

export const BOOK_COUNTRY_STYLE = {
  蒙德: 'bg-sky-500/12 text-sky-300 border-sky-500/25',
  璃月: 'bg-amber-500/12 text-amber-300 border-amber-500/25',
  稻妻: 'bg-violet-500/12 text-violet-300 border-violet-500/25',
  须弥: 'bg-lime-500/12 text-lime-300 border-lime-500/25',
  枫丹: 'bg-cyan-500/12 text-cyan-300 border-cyan-500/25',
  纳塔: 'bg-orange-500/12 text-orange-300 border-orange-500/25',
  挪德卡莱: 'bg-indigo-500/12 text-indigo-300 border-indigo-500/25',
  至冬: 'bg-blue-500/12 text-blue-300 border-blue-500/25',
  提瓦特: 'bg-surface-700 text-surface-300 border-surface-600',
}

/** 获取方式分类（观测枢的 3 类，仅有该来源的书才有） */
export const BOOK_SOURCE_TYPES = ['地图探索', 'NPC购买', '任务获取']

/** 多值字段按「、」拆成单项（体裁、国家、版本都用这个分隔） */
export function splitMulti(value) {
  return String(value || '')
    .split(/[、,，/]/)
    .map(s => s.trim())
    .filter(Boolean)
}

/** 从数据里汇总某个「多值字段」的全部候选值，按出现次数从多到少排序 */
export function collectBookOptions(rows, pick) {
  const counter = new Map()
  for (const row of rows || []) {
    for (const v of pick(row)) counter.set(v, (counter.get(v) || 0) + 1)
  }
  return [...counter.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'))
    .map(([value, count]) => ({ value, label: `${value}（${count}）` }))
}

/** 实装版本排序键：没有版本的书排到最后 */
export function versionSortKey(version) {
  const first = splitMulti(version)[0]
  if (!first) return Number.POSITIVE_INFINITY
  const [major, minor] = first.split('.').map(Number)
  return (Number.isFinite(major) ? major : 0) * 1000 + (Number.isFinite(minor) ? minor : 0)
}

export function genreStyle(genre) {
  return BOOK_GENRE_STYLE[genre] || BOOK_GENRE_STYLE_FALLBACK
}

export function countryStyle(country) {
  return BOOK_COUNTRY_STYLE[country] || BOOK_GENRE_STYLE_FALLBACK
}

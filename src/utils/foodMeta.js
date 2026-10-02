/**
 * foodMeta.js — 食物板块共用的分类常量与三形态视觉规范
 *
 * 三形态（奇怪的 / 普通 / 美味的）在 nanoka 里共用同一张图标，只能靠文案与
 * 视觉处理区分。这里把「标签 + 配色 + 图片滤镜」集中定义，列表页与详情页
 * 引用同一份，避免两处风格漂移。
 */

export const FOOD_TYPES = {
  dish: '正常料理',
  special: '特殊料理',
  drink: '饮品',
  event: '活动料理',
  ingredient: '食材',
  other: '其他',
}

export const FOOD_TYPE_ORDER = ['dish', 'special', 'drink', 'event', 'ingredient', 'other']

export const FOOD_TYPE_STYLE = {
  dish: 'bg-emerald-500/12 text-emerald-300 border-emerald-500/25',
  special: 'bg-fuchsia-500/12 text-fuchsia-300 border-fuchsia-500/25',
  drink: 'bg-sky-500/12 text-sky-300 border-sky-500/25',
  event: 'bg-orange-500/12 text-orange-300 border-orange-500/25',
  ingredient: 'bg-lime-500/12 text-lime-300 border-lime-500/25',
  other: 'bg-surface-700 text-surface-300 border-surface-600',
}

/** 三形态的展示顺序：由差到好，和游戏内的一致 */
export const FOOD_VARIANT_ORDER = ['weird', 'normal', 'tasty']

export const FOOD_VARIANT_META = {
  weird: {
    key: 'weird',
    label: '奇怪的',
    short: '奇怪',
    desc: '烹饪失败产物',
    dot: 'bg-surface-400',
    text: 'text-surface-300',
    textStrong: 'text-surface-200',
    ring: 'ring-surface-500/40',
    border: 'border-surface-600',
    chip: 'bg-surface-700/70 text-surface-300 border-surface-600',
    activeChip: 'bg-surface-700 text-white border-surface-500',
    glow: 'rgba(148,163,184,0.28)',
    // 图片滤镜：压饱和 + 略暗，一眼看出是失败品
    filter: 'grayscale(40%) brightness(0.9) contrast(0.98)',
  },
  normal: {
    key: 'normal',
    label: '普通',
    short: '普通',
    desc: '烹饪成功产物',
    dot: 'bg-sky-400',
    text: 'text-sky-300',
    textStrong: 'text-sky-200',
    ring: 'ring-sky-500/40',
    border: 'border-sky-500/30',
    chip: 'bg-sky-500/10 text-sky-300 border-sky-500/25',
    activeChip: 'bg-sky-500/20 text-sky-200 border-sky-400/50',
    glow: 'rgba(56,189,248,0.30)',
    filter: 'none',
  },
  tasty: {
    key: 'tasty',
    label: '美味的',
    short: '美味',
    desc: '完美烹饪产物',
    dot: 'bg-amber-400',
    text: 'text-amber-300',
    textStrong: 'text-amber-200',
    ring: 'ring-amber-400/50',
    border: 'border-amber-500/40',
    chip: 'bg-amber-500/12 text-amber-300 border-amber-500/30',
    activeChip: 'bg-amber-500/22 text-amber-200 border-amber-400/60',
    glow: 'rgba(251,191,36,0.34)',
    filter: 'saturate(1.18) brightness(1.06)',
  },
}

export function variantMeta(kind) {
  return FOOD_VARIANT_META[kind] || FOOD_VARIANT_META.normal
}

/** 展示名：奇怪的X / X / 美味的X */
export function variantDisplayName(baseName, kind) {
  const base = String(baseName || '').replace(/^(美味的|奇怪的)/, '')
  if (kind === 'tasty') return `美味的${base}`
  if (kind === 'weird') return `奇怪的${base}`
  return base
}

// 稀有度视觉规范与书籍板块共用（见 utils/rarity.js），这里按原样再导出，
// 既有的 `from '../utils/foodMeta'` 引用不受影响
export { RARITY_BG_URLS, RARITY_BG_STYLES, RARITY_COLOR, rarityStars } from './rarity'

// 食物稀有度普遍是 0-3，但活动/联动料理会到 5
export const FOOD_RARITY_MAX = 5

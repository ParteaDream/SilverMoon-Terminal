/**
 * rarity.js — 稀有度视觉规范（星级背景 / 文字配色 / 星级串）
 *
 * 原本内联在 foodMeta.js 里，食物与书籍共用同一套星级资源（public/background/Nstar.webp）。
 * 抽出来是为了让 bookMeta.js 不必从「食物」模块里 import 星级背景这种跨板块的怪依赖。
 * foodMeta.js 仍然按原样再导出这些符号，既有引用不受影响。
 */

export const RARITY_BG_URLS = {
  1: './background/1star.webp',
  2: './background/2star.webp',
  3: './background/3star.webp',
  4: './background/4star.webp',
  5: './background/5star.webp',
}

export const RARITY_BG_STYLES = Object.fromEntries(
  Object.entries(RARITY_BG_URLS).map(([r, url]) => [r, { backgroundImage: `url(${url})`, backgroundSize: 'cover', backgroundPosition: 'center' }])
)
// 0 星（书籍里很常见）复用 1 星底图：灰底比没有底图好看
RARITY_BG_STYLES[0] = RARITY_BG_STYLES[1]

export const RARITY_COLOR = {
  0: 'text-surface-400',
  1: 'text-gray-300',
  2: 'text-green-400',
  3: 'text-blue-400',
  4: 'text-purple-400',
  5: 'text-accent-gold',
}

/** 星级串；0 星（无稀有度）显示为「—」 */
export function rarityStars(rarity, max = 5) {
  const n = Math.max(0, Math.min(max, Number(rarity) || 0))
  return n > 0 ? '★'.repeat(n) : '—'
}

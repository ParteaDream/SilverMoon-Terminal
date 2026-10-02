/**
 * bookGaps.mjs — 书籍「查漏补缺」的比对规则
 *
 * 输入：
 *   · online  —— check-missing-books 的返回 { items: [{ name, sources, genre, country,
 *                version, illustrated, volumeCount }] }
 *   · dbRows  —— 本地 books 行 + volume_count / body_count（见 BooksPage 的查询）
 * 输出：分组后的缺口列表，直接喂给 BookLeakCheckModal。
 *
 * 与食物板块的口径差异：正文缺失（观测枢与 wiki 都没有正文的卷）在书籍里是
 * **正常现象**（白之公主与六侏儒 卷二~卷七 两边都没有），所以这一组只作为提示，
 * 默认不作为「必须补」；而「缺元数据」是真正的缺口——体裁/国家/实装版本只有
 * wiki 有，缺了就没法筛选。
 */

/** 书名比对键：与 electron/book-crawl.cjs 的 matchKey 保持同一套规则 */
export function bookMatchKey(value) {
  return String(value == null ? '' : value)
    .replace(/[\s\u00a0\u3000]+/g, '')
    .replace(/[\u2022\u2219\u30fb\u2027\uff65\u22c5\u00b7]/g, '\u00b7')
    .replace(/[（(][^（()）]*[)）]$/, '')
    .toLowerCase()
}

export const BOOK_GAP_KEYS = {
  missing: 'missing',
  metadata: 'metadata',
  content: 'content',
  body: 'body',
  assets: 'assets',
}

/**
 * @param {{items?: Array<{name:string,sources?:string[],genre?:string,country?:string,version?:string,volumeCount?:number,imageCount?:number}>}} online
 * @param {Array<{id:number,name_zh?:string,image?:string,description_zh?:string,genre?:string,country?:string,version?:string,volume_count?:number,body_count?:number,image_count?:number,artifact_count?:number}>} dbRows
 * @returns {Array<{key:string,label:string,hint:string,items:Array<{id:number,name:string,reason:string}>}>}
 */
export function computeBookGaps(online, dbRows) {
  const items = Array.isArray(online?.items) ? online.items : []
  const byKey = new Map()
  for (const row of dbRows || []) byKey.set(bookMatchKey(row.name_zh), row)

  const missing = []
  const metadata = []
  const contentFix = []
  const body = []
  const assets = []

  items.forEach((meta, index) => {
    // 用书名做键：书籍没有稳定的线上数字 ID，书名是两站与本地唯一的共同标识
    const key = bookMatchKey(meta.name)
    const row = byKey.get(key)
    // 列表里的 id 用作勾选键：本地条目用数据库 id，未收录的用负数占位避免与真实 id 冲突
    const entryId = row ? Number(row.id) : -(index + 1)

    if (!row) {
      missing.push({ id: entryId, name: meta.name, reason: (meta.sources || []).includes('mihoyo') && !(meta.sources || []).includes('biligame') ? '观测枢独有' : '' })
      return
    }

    const name = row.name_zh || meta.name
    // 「缺元数据」只看本地缺、而线上**能补**的字段：观测枢独有条目本来就没有
    // 体裁/国家/实装版本，把它们列进缺口只会让列表永远清不干净。
    const lacksMeta = []
    if (!row.genre && meta.genre) lacksMeta.push('体裁')
    if (!row.country && meta.country) lacksMeta.push('国家')
    if (!row.version && meta.version) lacksMeta.push('实装版本')
    if (lacksMeta.length > 0) {
      metadata.push({ id: entryId, name, reason: `缺${lacksMeta.join('/')}` })
    }

    // 正文需要修复的两种情况（重爬同一本即可解决）：
    //   · 线上有插图、库里一张都没有——旧版爬虫把 [[file:插图]] 当普通文件链接丢掉了
    //   · 正文里还残留 SMW 的 UNIQ 占位符——那一段的标签（tabber/nowiki/ref）没被还原
    const onlineImages = Number(meta.imageCount || 0)
    const dbImages = Number(row.image_count || 0)
    const artifacts = Number(row.artifact_count || 0)
    if (artifacts > 0 || (onlineImages > 0 && dbImages === 0)) {
      const reasons = []
      if (artifacts > 0) reasons.push(`正文含未解析标记（${artifacts} 卷）`)
      if (onlineImages > 0 && dbImages === 0) reasons.push(`缺 ${onlineImages} 张插图`)
      contentFix.push({ id: entryId, name, reason: reasons.join('；') })
    }

    if (Number(row.volume_count || 0) === 0) {
      body.push({ id: entryId, name, reason: '无卷' })
    } else if (Number(row.body_count || 0) === 0) {
      body.push({ id: entryId, name, reason: '全部卷无正文' })
    }

    if (!row.image || !row.description_zh) {
      assets.push({ id: entryId, name, reason: !row.image ? '缺封面' : '缺描述' })
    }
  })

  return [
    {
      key: BOOK_GAP_KEYS.missing,
      label: '未收录',
      hint: '线上已有、本地数据库缺失的书籍',
      items: missing,
    },
    {
      key: BOOK_GAP_KEYS.metadata,
      label: '缺筛选元数据',
      hint: '体裁 / 国家 / 实装版本只有 bilibili wiki 提供，缺了就筛不出来',
      items: metadata,
    },
    {
      key: BOOK_GAP_KEYS.content,
      label: '正文需修复',
      hint: '缺插图或残留未解析标记（这些条目的正文由旧版爬虫写入，重爬即可修复）',
      items: contentFix,
    },
    {
      key: BOOK_GAP_KEYS.body,
      label: '缺正文',
      hint: '卷没有正文——两站都缺的卷属正常（如《白之公主与六侏儒》卷二~卷七）',
      items: body,
    },
    {
      key: BOOK_GAP_KEYS.assets,
      label: '缺封面或描述',
      hint: '封面或描述为空，通常是历史数据',
      items: assets,
    },
  ].filter(g => g.items.length > 0)
}

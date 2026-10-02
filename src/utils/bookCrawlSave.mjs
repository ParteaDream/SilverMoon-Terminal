/**
 * bookCrawlSave.mjs — 书籍爬取结果 → 数据库的落库规则
 *
 * 与 foodCrawlSave.mjs / weaponCrawlSave.mjs 同样的理由抽成独立模块：这里集中了
 * 「哪些字段该写、哪些不能覆盖」的判断，出过问题的地方都在这里挡住：
 *   · 空字符串覆盖库里已有文案（观测枢旧书缺作者、wiki 缺描述时很常见）
 *   · 观测枢没有正文的卷被写成空串，把人工补录的正文抹掉
 *   · 卷序号错位（观测枢模块顺序与卷序无关，配对结果必须原样落库）
 *
 * 数据源：
 *   · bilibili wiki（名称/稀有度/体裁/国家/实装版本/图鉴/卷名/卷描述）→ 主进程 crawl-book
 *   · 米游社观测枢（卷正文/作者/获取方式）→ 主进程补充后合并在同一份 data 里
 *
 * 约定的 data 结构（见 electron/book-crawl.cjs buildBookPayload）：
 *  {
 *    name_zh, name_en, rarity, genre, country, version, source, source_type,
 *    description_zh, author, related_chars, illustrated, wiki_title, mihoyo_id,
 *    volume_count, image, image_url, image_alt_url, image_source,
 *    volumes: [{ volume_no, title_zh, description_zh, content, source, author, content_source }],
 *    debug: {...}
 *  }
 */

export { imageBaseName, applyImageNames } from './foodCrawlSave.mjs'

import { imageBaseName } from './foodCrawlSave.mjs'

/** books 表里允许被 UPDATE 覆盖的字段（id / volume_count 单独处理） */
const TEXT_FIELDS = [
  ['name_en', 'name_en'],
  ['genre', 'genre'],
  ['country', 'country'],
  ['version', 'version'],
  ['source', 'source'],
  ['source_type', 'source_type'],
  ['description_zh', 'description_zh'],
  ['author', 'author'],
  ['related_chars', 'related_chars'],
  ['image', 'image'],
  ['wiki_title', 'wiki_title'],
]

/**
 * 构造 books 表的 UPDATE 字段列表。
 *
 * 与食物爬虫一致：**不改主键**。books.id 是详情页路由与 book_volumes 的外键锚点，
 * 已存在的条目一律原地更新（name_zh 由调用方按「是否与其它条目重名」决定）。
 *
 * @param {object} data 爬虫返回的 data
 * @param {object} ctx
 * @param {Set<string>|string[]} [ctx.takenNames] 已被**其它**书籍占用的 name_zh
 * @returns {{fields: string[], values: any[], skipped: string[]}}
 */
export function buildBookUpdate(data, ctx = {}) {
  const fields = []
  const values = []
  const skipped = []
  const taken = ctx.takenNames instanceof Set ? ctx.takenNames : new Set(ctx.takenNames || [])

  if (data.name_zh && String(data.name_zh).trim()) {
    const target = String(data.name_zh).trim()
    if (taken.has(target)) skipped.push(`name_zh（"${target}" 已被其它书籍占用）`)
    else { fields.push('name_zh = ?'); values.push(target) }
  }

  for (const [key, col] of TEXT_FIELDS) {
    const v = data[key]
    if (v != null && String(v).trim() !== '') { fields.push(`${col} = ?`); values.push(v) }
  }

  // 稀有度 0 是合法值（0 星书籍占 19/105），不能用 truthy 判断
  if (data.rarity != null && Number.isFinite(Number(data.rarity))) {
    fields.push('rarity = ?'); values.push(Number(data.rarity))
  }
  if (data.illustrated != null) {
    fields.push('illustrated = ?'); values.push(data.illustrated ? 1 : 0)
  }
  if (data.mihoyo_id != null && Number(data.mihoyo_id)) {
    fields.push('mihoyo_id = ?'); values.push(Number(data.mihoyo_id))
  }

  return { fields, values, skipped }
}

/** 没有观测枢页面的书（wiki 独有）使用的本地 ID 段位起点 */
export const LOCAL_BOOK_ID_BASE = 900001

/**
 * 本地段位里最小的空闲 ID。
 *
 * 不用「MAX(id)+1」：删除过的号会被回收，且已存在的条目不受新增条目的影响
 * （MAX+1 在并发或历史数据有空洞时会给出越来越大的号，没有好处）。
 */
export async function nextLocalBookId(query) {
  const res = await query('SELECT id FROM books WHERE id >= ? ORDER BY id', [LOCAL_BOOK_ID_BASE])
  let candidate = LOCAL_BOOK_ID_BASE
  for (const row of res.data || []) {
    const id = Number(row.id)
    if (id === candidate) candidate++
    else if (id > candidate) break
  }
  return candidate
}

/**
 * 一次书籍爬取结果写进数据库。
 *
 * @param {(sql: string, params?: any[]) => Promise<any>} query useDb().query
 * @param {object} data 主进程 crawl-book / crawl-books 返回的 data
 * @param {object} [opts]
 * @param {number|string|null} [opts.bookId] 数据库中的书籍 ID（更新时传入；为空表示新建）
 * @param {Set<string>|string[]} [opts.takenNames] 其它书籍已占用的名称
 * @param {boolean} [opts.replaceVolumes=true] 是否用爬取结果覆盖卷
 * @param {Record<string,string>} [opts.imageNames] 图标名 → 实际落盘文件名
 * @returns {Promise<{bookId:number|null, created:boolean, skipped:string[], volumeCount:number, bodyCount:number}>}
 */
export async function saveBookData(query, rawData, opts = {}) {
  if (!rawData) throw new Error('爬取结果为空')
  const { replaceVolumes = true } = opts
  const data = applyBookImageNames(rawData, opts.imageNames)
  const { fields, values, skipped } = buildBookUpdate(data, { takenNames: opts.takenNames })

  let bookId = opts.bookId != null && opts.bookId !== '' ? Number(opts.bookId) : null
  let created = false

  if (bookId == null) {
    // 新建：先按书名找同名条目，找不到再插入。
    // 主键规则与食物/武器不同：书籍的 id **直接用米游社观测枢的 content_id**
    // （就是观测枢网址 /ys/obc/content/<id>/detail 里的那个数字），这样详情页路由
    // 与用户看到的 ID 跟线上对得上。
    //
    // 观测枢只收录了 93 本，wiki 独有的 15 本（都是图鉴=否 的任务/隐藏书籍）没有
    // 观测枢页面，落到 900001 起的本地段位——一眼能看出「这本线上没有页面」，
    // 也不会与任何真实 content_id 撞号。取「最小空闲号」而不是「最大号+1」：
    // 已存在的条目永远不会被重新编号，新增的条目也绝不会抢到别人的号。
    const byName = await query('SELECT id FROM books WHERE name_zh = ?', [data.name_zh || ''])
    if (byName.data && byName.data.length > 0) {
      bookId = Number(byName.data[0].id)
    } else {
      let targetId = Number(data.mihoyo_id) || null
      if (targetId != null) {
        // content_id 被别的书占着（理论上不该发生）：不抢号，退到本地段位并说明
        const occupied = await query('SELECT name_zh FROM books WHERE id = ?', [targetId])
        const taken = occupied.data && occupied.data[0]
        if (taken && taken.name_zh !== data.name_zh) {
          skipped.push(`id（观测枢 ID ${targetId} 已被「${taken.name_zh}」占用，改用本地号）`)
          targetId = null
        }
      }
      if (targetId == null) targetId = await nextLocalBookId(query)
      await query(
        `INSERT INTO books (id, name_zh, name_en, rarity, genre, country, version, source, source_type,
           description_zh, author, image, wiki_title, mihoyo_id, related_chars, illustrated, volume_count, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        [
          targetId, data.name_zh || '', data.name_en || '', Number(data.rarity) || 0, data.genre || '',
          data.country || '', data.version || '', data.source || '', data.source_type || '',
          data.description_zh || '', data.author || '', data.image || '', data.wiki_title || '',
          data.mihoyo_id ? Number(data.mihoyo_id) : null, data.related_chars || '',
          data.illustrated ? 1 : 0, Array.isArray(data.volumes) ? data.volumes.length : 0,
        ]
      )
      bookId = targetId
      created = true
    }
    if (bookId == null) throw new Error('书籍写入失败：无法确定主键')
  } else {
    const exists = await query('SELECT id FROM books WHERE id = ?', [bookId])
    if (!exists.data || exists.data.length === 0) {
      // 记录被删掉了，退化为新建
      return saveBookData(query, data, { ...opts, bookId: null })
    }
  }

  if (fields.length > 0) {
    await query(`UPDATE books SET ${fields.join(', ')} WHERE id = ?`, [...values, bookId])
  }

  // ── 卷 ──
  // 覆盖时先删后插：卷序号是排版与阅读顺序的唯一依据，
  // 增量更新很容易留下上一次爬取的残卷（观测枢与 wiki 的卷数偶尔差一卷）
  let volumeCount = 0
  let bodyCount = 0
  const volumes = Array.isArray(data.volumes) ? data.volumes.filter(v => v && v.title_zh) : []
  if (replaceVolumes && volumes.length > 0) {
    // 写库前重新编号，保证 1..N 连续（配对结果可能带空号）
    const normalized = volumes
      .slice()
      .sort((a, b) => (Number(a.volume_no) || 0) - (Number(b.volume_no) || 0))
      .map((v, i) => ({ ...v, volume_no: i + 1 }))

    await query('DELETE FROM book_volumes WHERE book_id = ?', [bookId])
    for (const v of normalized) {
      // 观测枢拿描述冒充正文的情况已在主进程过滤（content_source 为空即无正文），
      // 这里再挡一次：正文与描述完全相同时不写正文
      const sameAsDesc = v.content && v.description_zh
        && String(v.content).replace(/\s+/g, '') === String(v.description_zh).replace(/\s+/g, '')
      const content = sameAsDesc ? '' : (v.content || '')
      await query(
        `INSERT OR REPLACE INTO book_volumes (book_id, volume_no, title_zh, description_zh, content, source, author, content_source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          bookId, v.volume_no, v.title_zh || '', v.description_zh || '', content,
          v.source || '', v.author || '', content ? (v.content_source || '') : '',
        ]
      )
      volumeCount++
      if (content) bodyCount++
    }
    await query('UPDATE books SET volume_count = ? WHERE id = ?', [volumeCount, bookId])
  }

  if (skipped.length > 0) console.log(`[book-crawler] 书籍 ${data.name_zh || bookId} 跳过字段: ${skipped.join('；')}`)

  return { bookId, created, skipped, volumeCount, bodyCount }
}

/** 正文插图的占位标记：[img:BookImg_xxxxxxxxxxxx]；落库后是 [img:实际文件名] */
const CONTENT_IMAGE_RE = /\[img:([^\]\s]+)\]/g

/** 把载荷里的图片名替换成实际落盘文件名（foodCrawlSave.applyImageNames 的书籍版） */
export function applyBookImageNames(data, imageNames) {
  if (!data || !imageNames) return data
  // 下载器按内容嗅探真实扩展名，正文里的 [img:键] 要换成 [img:键.webp] 这样的实际文件名
  const resolve = (key) => imageNames[imageBaseName(key)] || ''
  const rewrite = (text) => (typeof text === 'string' && text.includes('[img:'))
    ? text.replace(CONTENT_IMAGE_RE, (m, key) => {
      const file = resolve(key)
      return file ? `[img:${file}]` : m     // 没下到的保留占位，阅读器会显示提示
    })
    : text

  const cover = resolve(data.image) || data.image
  return {
    ...data,
    image: cover,
    volumes: Array.isArray(data.volumes)
      ? data.volumes.map(v => ({ ...v, content: rewrite(v.content) }))
      : data.volumes,
  }
}

/** 爬取结果里需要落盘的图片（封面 + 正文插图），供批量下载去重 */
export function collectBookIcons(data) {
  const names = []
  const cover = imageBaseName(data && data.image)
  if (cover) names.push(cover)
  for (const img of (data && data.images) || []) {
    if (img && img.key) names.push(img.key)
  }
  return [...new Set(names)]
}

/** 下载参数：基名 → 主/备地址（封面 wiki 优先、观测枢兜底；插图只有 wiki 一个来源） */
export function collectBookImageRequests(data) {
  if (!data) return []
  const reqs = []
  const cover = imageBaseName(data.image)
  const coverUrls = [data.image_url, data.image_alt_url].filter(Boolean)
  if (cover && coverUrls.length > 0) {
    reqs.push({ name: cover, url: coverUrls[0], altUrl: coverUrls[1] || '' })
  }
  for (const img of data.images || []) {
    if (img && img.key && img.url) reqs.push({ name: img.key, url: img.url, altUrl: '' })
  }
  return reqs
}

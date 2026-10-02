#!/usr/bin/env node
/**
 * 书籍落库与查漏规则的单元测试（纯 Node，不起 Electron）
 *
 * bookCrawlSave.mjs / bookGaps.mjs 都是无依赖的纯模块，因此可以把 query 换成
 * 记录型假实现，直接断言「发出了哪些 SQL、跳过了哪些字段」。这些正是历史上
 * 在食物/武器爬虫里出过问题的地方，书籍这边同样要挡住：
 *   · 空字符串覆盖库里已有的文案（观测枢旧书缺作者、wiki 缺描述）
 *   · 稀有度 0 是合法值（0 星书籍占 19/105），不能被 truthy 判断吃掉
 *   · 主键漂移：重新爬取不能改 books.id（详情页路由与卷的外键锚点）
 *   · 卷必须整表覆盖且卷号连续（观测枢与 wiki 的卷数偶尔差一卷）
 *   · 非开发者模式下自增主键会与基准库撞车，新建时必须显式取 MAX(id)+1
 *
 * Run: node scripts/test-book-save.mjs
 */
import { strict as assert } from 'node:assert'
import {
  buildBookUpdate, saveBookData, applyBookImageNames, collectBookIcons,
  collectBookImageRequests, imageBaseName,
} from '../src/utils/bookCrawlSave.mjs'
import { computeBookGaps, bookMatchKey } from '../src/utils/bookGaps.mjs'

let passed = 0
const failures = []
function test(name, fn) {
  try { fn(); passed++ } catch (e) { failures.push({ name, error: e.message }) }
}
async function testAsync(name, fn) {
  try { await fn(); passed++ } catch (e) { failures.push({ name, error: e.message }) }
}

// ── 记录型假 query ──
function makeQuery(routes = []) {
  const log = []
  const query = async (sql, params = []) => {
    log.push({ sql: sql.replace(/\s+/g, ' ').trim(), params })
    for (const [re, handler] of routes) {
      if (re.test(sql)) return typeof handler === 'function' ? handler(params) : handler
    }
    return { data: [] }
  }
  query.log = log
  query.sqls = () => log.map(l => l.sql)
  query.find = (re) => log.find(l => re.test(l.sql))
  return query
}

const baseData = {
  name_zh: '野猪公主', name_en: '', rarity: 4, genre: '寓言童话', country: '蒙德',
  version: '1.0、1.2', source: '蒙德图书馆', source_type: 'NPC购买',
  description_zh: '很久、很久以前的森林王国，发生着怎样的传奇故事？',
  author: '魔女会-代号M-安德斯多特', related_chars: '安德斯多特', illustrated: 1,
  wiki_title: '野猪公主', mihoyo_id: 625, volume_count: 2,
  image: 'Book_ab12cd34ef56.png', image_url: 'https://patchwiki/x.png', image_alt_url: 'https://mihoyo/y.png',
  image_source: 'biligame',
  volumes: [
    { volume_no: 1, title_zh: '野猪公主·卷一', description_zh: '卷一简介', content: '卷一正文', source: '蒙德图书馆', author: '安德斯多特', content_source: 'mihoyo' },
    { volume_no: 2, title_zh: '野猪公主·卷二', description_zh: '卷二简介', content: '', source: '蒙德图书馆', author: '', content_source: '' },
  ],
}

// ═══════════════════════════════════════════════════════════
test('buildBookUpdate：空字符串不覆盖已有文案', () => {
  const { fields } = buildBookUpdate({ ...baseData, description_zh: '', author: '  ', source: '', image: '' }, {})
  for (const col of ['description_zh', 'author', 'source', 'image']) {
    assert.ok(!fields.includes(`${col} = ?`), `${col} 不应被空值覆盖`)
  }
})

test('buildBookUpdate：稀有度 0 是合法值，必须写库', () => {
  const { fields, values } = buildBookUpdate({ ...baseData, rarity: 0 }, {})
  const i = fields.indexOf('rarity = ?')
  assert.ok(i >= 0, '0 星必须写进 rarity')
  assert.equal(values[i], 0)
})

test('buildBookUpdate：书名被其它条目占用时跳过改名', () => {
  const { fields, skipped } = buildBookUpdate(baseData, { takenNames: new Set(['野猪公主']) })
  assert.ok(!fields.includes('name_zh = ?'))
  assert.ok(skipped.some(s => s.includes('name_zh')))
})

test('buildBookUpdate：观测枢独有条目没有 mihoyo_id 时不写该列', () => {
  const { fields } = buildBookUpdate({ ...baseData, mihoyo_id: null }, {})
  assert.ok(!fields.includes('mihoyo_id = ?'))
})

test('applyBookImageNames：把提示名换成实际落盘文件名（真实扩展名由内容嗅探决定）', () => {
  const out = applyBookImageNames(baseData, { Book_ab12cd34ef56: 'Book_ab12cd34ef56.webp' })
  assert.equal(out.image, 'Book_ab12cd34ef56.webp')
  // 没有 [img:] 标记的卷内容原样保留（卷对象会重建，内容必须一致）
  assert.deepEqual(out.volumes, baseData.volumes)
  assert.equal(imageBaseName('Book_x.png'), 'Book_x')
})

test('applyBookImageNames：正文里的 [img:键] 换成实际落盘文件名，没下到的保留占位', () => {
  const data = {
    ...baseData,
    volumes: [
      { volume_no: 1, title_zh: '卷一', content: '前\n[img:BookImg_aaa]\n中\n[img:BookImg_bbb]\n后' },
    ],
  }
  const out = applyBookImageNames(data, { Book_ab12cd34ef56: 'Book_ab12cd34ef56.webp', BookImg_aaa: 'BookImg_aaa.jpg' })
  assert.equal(out.image, 'Book_ab12cd34ef56.webp')
  assert.equal(out.volumes[0].content, '前\n[img:BookImg_aaa.jpg]\n中\n[img:BookImg_bbb]\n后')
})

test('collectBookImageRequests / collectBookIcons：封面 + 正文插图一起去下载', () => {
  const data = {
    ...baseData,
    images: [
      { key: 'BookImg_aaa', file: '插图1.png', url: 'https://patchwiki/i1.png' },
      { key: 'BookImg_bbb', file: '插图2.png', url: '' },   // 线上没有该文件 → 不产生下载请求
    ],
  }
  assert.deepEqual(collectBookImageRequests(data), [
    { name: 'Book_ab12cd34ef56', url: 'https://patchwiki/x.png', altUrl: 'https://mihoyo/y.png' },
    { name: 'BookImg_aaa', url: 'https://patchwiki/i1.png', altUrl: '' },
  ])
  assert.deepEqual(collectBookIcons(data), ['Book_ab12cd34ef56', 'BookImg_aaa', 'BookImg_bbb'])
})

test('collectBookIcons / collectBookImageRequests：封面基名与主备地址', () => {
  assert.deepEqual(collectBookIcons(baseData), ['Book_ab12cd34ef56'])
  assert.deepEqual(collectBookImageRequests(baseData), [
    { name: 'Book_ab12cd34ef56', url: 'https://patchwiki/x.png', altUrl: 'https://mihoyo/y.png' },
  ])
  // 没有地址时（例如手工新增的书）不产生下载请求
  assert.deepEqual(collectBookImageRequests({ image: 'Book_x.png' }), [])
})

// ═══════════════════════════════════════════════════════════
await testAsync('saveBookData：新建时用观测枢 content_id 作主键', async () => {
  const q = makeQuery([
    [/SELECT id FROM books WHERE name_zh/, { data: [] }],
  ])
  const out = await saveBookData(q, { ...baseData, mihoyo_id: 509470 }, {})
  assert.equal(out.created, true)
  assert.equal(out.bookId, 509470, '主键应等于观测枢 content_id')
  const insert = q.find(/^INSERT INTO books/)
  assert.ok(insert, '应发出 INSERT')
  assert.ok(insert.sql.includes('(id,'), 'id 必须显式写入而不是靠 AUTOINCREMENT')
  assert.equal(insert.params[0], 509470)
})

await testAsync('saveBookData：观测枢没有的书落到 900001 起的本地段位（取最小空闲号）', async () => {
  const q = makeQuery([
    [/SELECT id FROM books WHERE name_zh/, { data: [] }],
    // 900001、900002 已被占；900003 空着 → 应取 900003 而不是 900004
    [/SELECT id FROM books WHERE id >= \?/, { data: [{ id: 900001 }, { id: 900002 }, { id: 900004 }] }],
  ])
  const out = await saveBookData(q, { ...baseData, mihoyo_id: null }, {})
  assert.equal(out.bookId, 900003)
})

await testAsync('saveBookData：观测枢 ID 被别的书占着时不抢号，退到本地段位并记录原因', async () => {
  const q = makeQuery([
    [/SELECT id FROM books WHERE name_zh/, { data: [] }],
    [/SELECT name_zh FROM books WHERE id = \?/, { data: [{ name_zh: '别的书' }] }],
    [/SELECT id FROM books WHERE id >= \?/, { data: [] }],
  ])
  const out = await saveBookData(q, { ...baseData, mihoyo_id: 625 }, {})
  assert.equal(out.bookId, 900001)
  assert.ok(out.skipped.some(x => x.includes('625')), '应记录占用原因')
})

await testAsync('saveBookData：已存在时不改主键，原地 UPDATE', async () => {
  const q = makeQuery([
    [/SELECT id FROM books WHERE id = \?/, { data: [{ id: 42 }] }],
  ])
  const out = await saveBookData(q, baseData, { bookId: 42 })
  assert.equal(out.bookId, 42)
  assert.equal(out.created, false)
  assert.ok(!q.sqls().some(s => s.startsWith('INSERT INTO books')), '不应重新 INSERT')
  const upd = q.find(/^UPDATE books SET/)
  assert.ok(upd && upd.params[upd.params.length - 1] === 42)
})

await testAsync('saveBookData：卷整表覆盖、卷号重排为 1..N、无正文的卷不写 content_source', async () => {
  const q = makeQuery([
    [/SELECT id FROM books WHERE id = \?/, { data: [{ id: 7 }] }],
  ])
  const data = {
    ...baseData,
    volumes: [
      { volume_no: 5, title_zh: '卷五', content: '正文五', description_zh: '', source: '', author: '', content_source: 'mihoyo' },
      { volume_no: 2, title_zh: '卷二', content: '', description_zh: '', source: '', author: '', content_source: 'mihoyo' },
    ],
  }
  const out = await saveBookData(q, data, { bookId: 7 })
  assert.equal(out.volumeCount, 2)
  assert.equal(out.bodyCount, 1)
  assert.ok(q.find(/DELETE FROM book_volumes WHERE book_id = \?/), '覆盖前应先清空旧卷')
  const inserts = q.log.filter(l => l.sql.startsWith('INSERT OR REPLACE INTO book_volumes'))
  assert.equal(inserts.length, 2)
  // 入参卷号是 5/2，写库时应重排成 1/2
  assert.deepEqual(inserts.map(i => i.params[1]), [1, 2])
  assert.deepEqual(inserts.map(i => i.params[2]), ['卷二', '卷五'])
  // 第二卷没有正文 → content 与 content_source 都为空
  assert.equal(inserts[0].params[4], '')
  assert.equal(inserts[0].params[7], '')
  assert.equal(inserts[1].params[7], 'mihoyo')
  assert.ok(q.find(/UPDATE books SET volume_count = \?/))
})

await testAsync('saveBookData：正文与描述完全相同时不写正文（挡住观测枢的假正文）', async () => {
  const q = makeQuery([
    [/SELECT id FROM books WHERE id = \?/, { data: [{ id: 9 }] }],
  ])
  const data = {
    ...baseData,
    volumes: [{
      volume_no: 1, title_zh: '卷二', description_zh: '在提瓦特大陆各地流传已久的童话。',
      content: '在提瓦特大陆各地流传已久的童话。', source: '', author: '', content_source: 'mihoyo',
    }],
  }
  const out = await saveBookData(q, data, { bookId: 9 })
  assert.equal(out.bodyCount, 0)
  const ins = q.find(/INSERT OR REPLACE INTO book_volumes/)
  assert.equal(ins.params[4], '')
  assert.equal(ins.params[7], '')
})

await testAsync('saveBookData：记录被删掉后退化为新建（仍沿用观测枢 ID）', async () => {
  const q = makeQuery([
    [/SELECT id FROM books WHERE id = \?/, { data: [] }],
    [/SELECT id FROM books WHERE name_zh/, { data: [] }],
  ])
  const out = await saveBookData(q, { ...baseData, mihoyo_id: 509470 }, { bookId: 999 })
  assert.equal(out.created, true)
  assert.equal(out.bookId, 509470)
  assert.ok(!q.sqls().some(x => /MAX\(id\)/.test(x)), '不应再依赖 MAX(id)+1')
})

await testAsync('saveBookData：爬取结果为空时抛错', async () => {
  await assert.rejects(() => saveBookData(makeQuery(), null), /爬取结果为空/)
})

// ═══════════════════════════════════════════════════════════
test('bookMatchKey：与主进程 matchKey 同一套规则', () => {
  assert.equal(bookMatchKey('大盗雷德 · 米勒传奇'), bookMatchKey('大盗雷德·米勒传奇'))
  assert.equal(bookMatchKey('残破的笔记（时与风任务道具）'), bookMatchKey('残破的笔记'))
})

test('computeBookGaps：未收录 / 缺筛选元数据 / 缺正文 / 缺封面或描述 四类缺口', () => {
  const online = {
    items: [
      { name: '野猪公主', sources: ['biligame', 'mihoyo'], genre: '寓言童话', country: '蒙德', version: '1.0' },
      { name: '石素人', sources: ['biligame', 'mihoyo'], genre: '小说', country: '纳塔', version: '5.4' },
      { name: '残破的笔记', sources: ['mihoyo'] },
      { name: '白之公主与六侏儒', sources: ['biligame', 'mihoyo'], genre: '寓言童话', country: '蒙德', version: '1.0' },
      // 观测枢独有：线上就没有体裁/国家/实装版本，不该被列进「缺筛选元数据」
      { name: '风、勇气和翅膀', sources: ['mihoyo'] },
    ],
  }
  const dbRows = [
    { id: 1, name_zh: '野猪公主', image: 'Book_a.png', description_zh: '简介', genre: '寓言童话', country: '蒙德', version: '1.0', volume_count: 7, body_count: 7 },
    // 缺体裁/国家/实装版本（只有 wiki 提供）
    { id: 2, name_zh: '石素人', image: 'Book_b.png', description_zh: '简介', genre: '', country: '', version: '', volume_count: 3, body_count: 3 },
    // 有卷但全部没有正文
    { id: 3, name_zh: '白之公主与六侏儒', image: 'Book_c.png', description_zh: '简介', genre: '寓言童话', country: '蒙德', version: '1.0', volume_count: 7, body_count: 0 },
    // 缺封面
    { id: 4, name_zh: '风、勇气和翅膀', image: '', description_zh: '简介', genre: '', country: '', version: '', volume_count: 1, body_count: 1 },
  ]
  const groups = Object.fromEntries(computeBookGaps(online, dbRows).map(g => [g.key, g.items]))
  assert.deepEqual(groups.missing.map(i => i.name), ['残破的笔记'])
  assert.equal(groups.missing[0].reason, '观测枢独有')
  assert.deepEqual(groups.metadata.map(i => i.name), ['石素人'])
  assert.ok(groups.metadata[0].reason.includes('体裁') && groups.metadata[0].reason.includes('实装版本'))
  assert.deepEqual(groups.body.map(i => i.name), ['白之公主与六侏儒'])
  assert.deepEqual(groups.assets.map(i => i.name), ['风、勇气和翅膀'])
  // 未收录条目用负数 id 占位，避免与真实数据库 id 冲突
  assert.ok(groups.missing[0].id < 0)
})

test('computeBookGaps：线上有插图而库里没有 → 「正文需修复」；有 UNIQ 残留也归入该组', () => {
  const online = {
    items: [
      { name: '出发吧！嘟嘟可', sources: ['biligame'], genre: '寓言童话', country: '稻妻', version: '2.6', imageCount: 3 },
      { name: '灵濛山夜话', sources: ['biligame'], genre: '故事传说', country: '璃月', version: '5.2', imageCount: 0 },
      { name: '沉秋拾剑录', sources: ['biligame', 'mihoyo'], genre: '小说', country: '稻妻', version: '2.0', imageCount: 0 },
    ],
  }
  const dbRows = [
    // 旧版爬虫把插图洗掉了
    { id: 900004, name_zh: '出发吧！嘟嘟可', image: 'Book_a.png', description_zh: 'd', genre: '寓言童话', country: '稻妻', version: '2.6', volume_count: 1, body_count: 1, image_count: 0, artifact_count: 0 },
    // 正文里还有 SMW 占位符
    { id: 150, name_zh: '灵濛山夜话', image: 'Book_b.png', description_zh: 'd', genre: '故事传说', country: '璃月', version: '5.2', volume_count: 3, body_count: 3, image_count: 0, artifact_count: 2 },
    // 正常条目（线上本来就没有插图，库里也没有）
    { id: 3624, name_zh: '沉秋拾剑录', image: 'Book_c.png', description_zh: 'd', genre: '小说', country: '稻妻', version: '2.0', volume_count: 6, body_count: 6, image_count: 0, artifact_count: 0 },
  ]
  const groups = Object.fromEntries(computeBookGaps(online, dbRows).map(g => [g.key, g.items]))
  assert.deepEqual(groups.content.map(i => i.name).sort(), ['出发吧！嘟嘟可', '灵濛山夜话'])
  assert.ok(groups.content.find(i => i.name === '出发吧！嘟嘟可').reason.includes('3 张插图'))
  assert.ok(groups.content.find(i => i.name === '灵濛山夜话').reason.includes('未解析标记'))
})

test('computeBookGaps：全部齐全时返回空数组', () => {
  const online = { items: [{ name: '野猪公主', sources: ['biligame'], genre: '寓言童话', country: '蒙德', version: '1.0' }] }
  const dbRows = [{ id: 1, name_zh: '野猪公主', image: 'Book_a.png', description_zh: '简介', genre: '寓言童话', country: '蒙德', version: '1.0', volume_count: 7, body_count: 7 }]
  assert.deepEqual(computeBookGaps(online, dbRows), [])
})

// ═══════════════════════════════════════════════════════════
console.log('\n书籍落库 / 查漏规则')
if (failures.length === 0) {
  console.log(`  ✓ 全部 ${passed} 项通过`)
  process.exit(0)
}
for (const f of failures) console.log(`  ✗ ${f.name}\n      ${f.error}`)
console.log(`\n${passed} passed, ${failures.length} failed`)
process.exit(1)

#!/usr/bin/env node
/**
 * 书籍爬虫「解析 / 配对 / 清洗」规则单测（纯 Node，不起 Electron）
 *
 * electron/book-crawl.cjs 是无依赖的纯模块，因此两站的真实响应形状（按实测裁剪）
 * 直接内联在这里断言。覆盖的都是只有对着真数据才会暴露、且一旦错了很难在界面上
 * 看出来的地方：
 *   1. 观测枢 modules[] 的顺序**不等于**卷序（清泉之心是一/四/二/三），位置配对必错
 *   2. 观测枢对没有正文的卷拿「描述」冒充正文（白之公主与六侏儒 卷二~卷七）
 *   3. 观测枢给这类卷只留了一个空壳 material_base_info，卷名写在正文模块上
 *   4. 两站卷名写法不同：`·卷一` / `第一卷` / `——蒙德篇——` / `第二卷·瑶光滩`
 *   5. 两站书名写法不同：`大盗雷德 · 米勒传奇` / `大盗雷德·米勒传奇`
 *
 * Run: node scripts/test-book-merge.mjs
 */
import { createRequire } from 'node:module'
import { strict as assert } from 'node:assert'

const require = createRequire(import.meta.url)
const B = require('../electron/book-crawl.cjs')

let passed = 0
const failures = []
function test(name, fn) {
  try { fn(); passed++ } catch (e) { failures.push({ name, error: e.message }) }
}

// ═══════════════════════════════════════════════════════════
// 夹具：bilibili wiki 的 action=ask 响应（裁剪自实测数据）
// ═══════════════════════════════════════════════════════════
const first = v => v

function wikiBook({ name, rarity = '3星', genres = ['故事传说'], countries = ['1'], versions = ['1.0'], illustrated = '是', volumes = [] }) {
  const p = {
    书籍名: [name], 卷数: [`共${volumes.length}卷`], 稀有度: [rarity],
    体裁: genres.map(first), 国家: countries.map(first), 图鉴: [illustrated], 实装版本: versions.map(first),
  }
  volumes.forEach((v, i) => {
    const n = i + 1
    if (v.name) p[`卷${n}名`] = [v.name]
    if (v.source) p[`卷${n}获取地点`] = [v.source]
    if (v.desc) p[`卷${n}描述`] = [v.desc]
    if (v.body) p[`卷${n}内容`] = [v.body]
  })
  return [name, { printouts: p, fulltext: name }]
}

const ASK_FIXTURE = {
  query: {
    results: Object.fromEntries([
      // 多卷、卷名与观测枢完全一致
      wikiBook({
        name: '野猪公主', rarity: '4星', genres: ['寓言童话'], countries: ['1'], versions: ['1.0', '1.2'],
        volumes: [
          { name: '野猪公主·卷一', source: '蒙德图书馆', desc: '卷一的简介', body: '久远的传说中，大地上的草木走兽都拥有自己的王国。<br>\n在那时，如今蒙德城的所在还只是一片森林。' },
          { name: '野猪公主·卷二', source: '蒙德图书馆', desc: '卷二的简介', body: '而在野猪森林的北方，有一片寒冷的冰原。' },
        ],
      }),
      // 多值国家；卷名带「第二卷·瑶光滩」这种复合写法
      wikiBook({
        name: '谁人的日志', rarity: '3星', genres: ['游记日志'], countries: ['2', '3'], versions: ['1.0', '2.0'],
        volumes: [
          { name: '给东东的信', source: '轻策庄', desc: '家书', body: '东东，见字如面。' },
          { name: '谁人的日志·第二卷·瑶光滩', source: '瑶光滩', desc: '瑶光滩的日志', body: '我在瑶光滩遭遇了不幸。' },
        ],
      }),
      // wiki 侧就没有正文的卷（与观测枢的假正文叠加，必须回退成空）
      wikiBook({
        name: '白之公主与六侏儒', rarity: '4星', genres: ['寓言童话'], countries: ['1'], versions: ['1.0'],
        volumes: [
          { name: '白之公主与六侏儒·第一卷', source: '完成任务获得', desc: '第一册的简介', body: '很久、很久以前，在遥远的夜之国，夜母统治着一切臣民。' },
          { name: '白之公主与六侏儒·第二卷', desc: '在提瓦特大陆各地流传已久的童话，本册讲述了白之公主与光之王子的相遇。' },
        ],
      }),
      // 月相版本别名（SMW 已归一，这里再兜一层）与单个卷的卷名即书名
      wikiBook({
        name: '出发吧！嘟嘟可', rarity: '3星', genres: ['寓言童话'], countries: ['3'], versions: ['月之六'], illustrated: '否',
        volumes: [{ name: '出发吧！嘟嘟可', source: '活动获取', desc: '一本小册子', body: '嘟嘟可出发了。' }],
      }),
      // 观测枢写作「大盗雷德 · 米勒传奇」，靠归一化命中
      wikiBook({ name: '大盗雷德·米勒传奇', rarity: '3星', genres: ['小说'], countries: ['7'], versions: ['6.0'],
        volumes: [{ name: '大盗雷德·米勒传奇·卷一', desc: '传奇', body: '正文。' }] }),
      // 前缀匹配用：观测枢叫「与神性同行·序言」
      wikiBook({ name: '与神性同行', rarity: '0星', genres: ['史书'], countries: ['1'], versions: ['1.0'], illustrated: '否',
        volumes: [{ name: '与神性同行·序言', desc: '序言', body: '序言正文。' }] }),
      // 重复建页用：观测枢同时有《林间风》与《林间风·故事拔萃节选》
      wikiBook({ name: '林间风', rarity: '3星', genres: ['故事传说'], countries: ['1'], versions: ['1.0'],
        volumes: [{ name: '林间风·故事拔萃节选', desc: '节选', body: '节选正文。' }] }),
    ]),
  },
}

const MIHOYO_LIST_FIXTURE = {
  data: {
    list: [{
      id: 68, name: '书籍',
      list: [
        { content_id: 625, title: '野猪公主', icon: 'https://cdn.mihoyo/625.png', ext: JSON.stringify({ c_68: { filter: { text: JSON.stringify(['童话寓言', '获取方式/NPC购买']) } } }) },
        { content_id: 621, title: '谁人的日志', icon: '', ext: JSON.stringify({ c_68: { filter: { text: JSON.stringify(['书信日志', '获取方式/地图探索']) } } }) },
        { content_id: 500, title: '白之公主与六侏儒', icon: '', ext: '' },
        // 书名带空格的点号：归一化后应与 wiki 的「大盗雷德·米勒传奇」完全一致
        { content_id: 506361, title: '大盗雷德 · 米勒传奇', icon: '', ext: '' },
        { content_id: 479, title: '与神性同行·序言', icon: '', ext: '' },
        // 与 501 是同一个作品的重复建页，应被跳过
        { content_id: 503, title: '林间风·故事拔萃节选', icon: '', ext: '' },
        { content_id: 501, title: '林间风', icon: '', ext: '' },
        // wiki 的「书籍一览」不收录、只由观测枢提供的条目
        { content_id: 1158, title: '残破的笔记', icon: 'https://cdn.mihoyo/1158.png', ext: JSON.stringify({ c_68: { filter: { text: JSON.stringify(['书信日志', '获取方式/任务获取']) } } }) },
      ],
    }],
  },
}

const mbi = (name, { star, desc, source, author } = {}) => ({
  component_id: 'material_base_info',
  module_name: '',
  data: {
    name, star,
    materials: source ? { key: '获得方式', value: `<p>${source}</p>` } : undefined,
    attr: [
      desc ? { key: '描述', value: [`<p>${desc}</p>`] } : null,
      author ? { key: '作者', value: [`<p>${author}</p>`] } : null,
    ].filter(Boolean),
  },
})
const mbody = (moduleName, richText) => ({
  component_id: 'collapse_panel', module_name: moduleName, data: { rich_text: richText },
})
const mpage = (name, modules) => ({ name, modules: modules.map(m => ({ name: m.module_name, components: [{ component_id: m.component_id, data: JSON.stringify(m.data) }] })) })

/** 清泉之心：观测枢模块顺序是 一/四/二/三，位置配对必错 */
const MIHOYO_QINGQUAN = mpage('清泉之心', [
  mbi('清泉之心 · 一', { star: 3, desc: '相识', source: '蒙德清泉镇' }), mbody('清泉之心 · 一', '<p>如水的月光下</p>'),
  mbi('清泉之心 · 四', { desc: '结局', source: '晨曦酒庄' }), mbody('清泉之心 · 四', '<p>不再是少年的少年</p>'),
  mbi('清泉之心 · 二', { desc: '诺言', source: '猫尾酒馆' }), mbody('清泉之心 · 二', '<p>望着涟漪中破碎的月光</p>'),
  mbi('清泉之心 · 三', { desc: '缺憾', source: '琴的办公室' }), mbody('清泉之心 · 三', '<p>精灵没有悠远的记忆</p>'),
])

/** 白之公主与六侏儒：6 个空壳 base + 用描述冒充的正文 */
const MIHOYO_BAIZHI = mpage('白之公主与六侏儒', [
  mbi('白之公主与六侏儒·第一卷', { star: 4, desc: '第一册的简介', source: '完成丽莎传说任务后获得' }),
  mbody('书籍内容', '<p>很久、很久以前，在遥远的夜之国，夜母统治着一切臣民。</p>'),
  mbody('白之公主与六侏儒·第二卷', '<p>在提瓦特大陆各地流传已久的童话，本册讲述了白之公主与光之王子的相遇。</p>'),
  mbi(''),
  mbody('白之公主与六侏儒·第三卷', '<p>在提瓦特大陆各地流传已久的童话，这一册讲述了白之公主与光之王子下定决心拯救月光森林的故事。</p>'),
  mbi(''),
])

/** 极星舞剧集/石素人：base 叫「卷N」，正文模块叫「第N卷」 */
const MIHOYO_JIXING = mpage('极星舞剧集', [
  mbi('极星舞剧集·卷二', { star: 4, desc: '海鸟', source: '火炬书行' }), mbody('第二卷', '<p>第二卷正文</p>'),
  mbi('极星舞剧集·卷一', { star: 4, desc: '黑雪鹄', source: '聚所纪事任务' }), mbody('第一卷', '<p>第一卷正文</p>'),
  mbi('极星舞剧集·卷三', { star: 4, desc: '特使', source: '火炬书行' }), mbody('第三卷', '<p>第三卷正文</p>'),
])

/** 提瓦特游览指南：base 带书名前缀，正文模块只有「——蒙德篇——」 */
const MIHOYO_TIWATE = mpage('提瓦特游览指南', [
  mbi('提瓦特游览指南·蒙德篇', { desc: '蒙德行记', source: '完成任务获得', author: '艾莉丝' }), mbody('——蒙德篇——', '<p>达达乌帕谷</p><p> </p><p>这座谷地中三个丘丘人部落人丁兴旺。</p>'),
  mbi('提瓦特大陆游览指南·璃月篇', { desc: '璃月行记', source: '完成任务获得', author: '艾莉丝' }), mbody('——璃月篇——', '<p>荻花洲</p>'),
])

// ═══════════════════════════════════════════════════════════
// 名称归一化
// ═══════════════════════════════════════════════════════════
test('matchKey：观测枢用「 · 」而 wiki 用「·」，归一化后同名', () => {
  assert.equal(B.matchKey('大盗雷德 · 米勒传奇'), B.matchKey('大盗雷德·米勒传奇'))
  assert.equal(B.matchKey('骑士团指导手册 • 第五版'), B.matchKey('骑士团指导手册·第五版'))
  assert.equal(B.matchKey('极星舞剧集•卷一'), B.matchKey('极星舞剧集·卷一'))
})

test('matchKey：只去掉末尾的括号注释，书名里的《》「」要保留', () => {
  assert.equal(B.matchKey('残破的笔记（时与风任务道具）'), B.matchKey('残破的笔记'))
  assert.notEqual(B.matchKey('《交涉的艺术》'), B.matchKey('交涉的艺术'))
  assert.notEqual(B.matchKey('「东王」史辩'), B.matchKey('东王史辩'))
})

test('parseRarity：0 星合法，认不出来时返回 null', () => {
  assert.equal(B.parseRarity('4星'), 4)
  assert.equal(B.parseRarity('0星'), 0)
  assert.equal(B.parseRarity(''), null)
})

test('mapCountries：数字码转名称、多值用「、」、未知码丢弃', () => {
  assert.equal(B.mapCountries(['1']), '蒙德')
  assert.equal(B.mapCountries(['2', '3']), '璃月、稻妻')
  assert.equal(B.mapCountries(['2、3']), '璃月、稻妻')
  assert.equal(B.mapCountries([]), '')
})

test('normalizeVersions：SMW 已是 6.0，原始 wikitext 的月相别名也要能兜住', () => {
  assert.equal(B.normalizeVersions(['1.0, 2.6']), '1.0、2.6')
  assert.equal(B.normalizeVersions(['1.0、1.1、月之六']), '1.0、1.1、6.5')
  assert.equal(B.normalizeVersions(['2.0', '1.0']), '1.0、2.0')
})

// ═══════════════════════════════════════════════════════════
// 正文清洗
// ═══════════════════════════════════════════════════════════
test('cleanWikiText：<br> 转行、{{颜色}} 转彩色标记、链接与粗体展开', () => {
  const out = B.cleanWikiText("第一行<br>\n{{颜色|蓝|【Da/Dada】}}<br>\n[[清泉镇|清泉镇的小屋]]与'''粗体'''<br>\n[[file:某插图.png|center]]")
  // 插图标记前后各留一个空行，阅读器里是独立的一块
  const [body, imgPart] = out.split('\n\n')
  assert.equal(body, '第一行\n[color=#4a9eea]【Da/Dada】[/color]\n清泉镇的小屋与[b]粗体[/b]')
  assert.match(imgPart, /^\[img:BookImg_[0-9a-f]{12}\]$/)
})

test('cleanWikiText：<tabber> 只保留第一支（任务前后/性别立绘都是同段落的两个版本）', () => {
  const out = B.cleanWikiText('<tabber>\n完成须弥魔神任务前=\n她亲眼见证这一切。\n|-|完成须弥魔神任务后=\n她亲眼见证这一切，{{颜色|描述|誓要}}拯救地上的生灵。\n</tabber>')
  assert.equal(out, '她亲眼见证这一切。')
})

test('cleanWikiText：未知模板取最后一个位置参数（{{黑幕|X}} 之类），注释与命名参数丢弃', () => {
  assert.equal(B.cleanWikiText('{{黑幕|隐藏的话}}<!--注释-->'), '隐藏的话')
  assert.equal(B.cleanWikiText('保留{{未知模板|a=1|b=2}}'), '保留')
})

test('cleanWikiText：[[file:插图]] 转成插图标记并收集文件标题（不再当垃圾丢掉）', () => {
  const images = []
  const out = B.cleanWikiText('前一句<br>\n[[file:出发吧！嘟嘟可-插图1.png|center]]<br>\n后一句', { images })
  assert.equal(images.length, 1)
  assert.equal(images[0].file, '出发吧！嘟嘟可-插图1.png')
  assert.ok(B.contentImageKey(images[0].file).startsWith('BookImg_'))
  // 标记单独成块（前后空行），阅读器按块级元素渲染
  assert.equal(out, `前一句\n\n[img:${images[0].key}]\n\n后一句`)
  // 同一张图在正文里出现两次只收集一次
  const again = []
  B.cleanWikiText('[[file:A.png]][[file:A.png]]', { images: again })
  assert.equal(again.length, 1)
})

test('cleanWikiText：<tabber> 里的第一支插图也能被收集（旅行者性别分支取空）', () => {
  const images = []
  const out = B.cleanWikiText('<tabber>\n空=\n[[file:插图2空.png|center]]\n|-|荧=\n[[file:插图2荧.png|center]]\n</tabber>', { images })
  assert.deepEqual(images.map(i => i.file), ['插图2空.png'])
  assert.ok(out.includes('[img:'))
  assert.ok(!out.includes('荧'))
})

test('cleanWikiText：<nowiki> 原样保留、<ref> 就地展开、UNIQ 占位符被兜底清掉', () => {
  assert.equal(B.cleanWikiText('<nowiki>====</nowiki>'), '====')
  assert.equal(B.cleanWikiText('诗句<ref>参考译文</ref>续'), '诗句（参考译文）续')
  // 占位符整行被清掉后留下一个空行（正好保留它原本占的段落间隔）
  assert.equal(B.cleanWikiText('前\n"\'`UNIQ--tabber-00000000-QINU`"\n后'), '前\n\n后')
})

test('parseWikiBookTemplate：花括号配平取 {{书籍}} 字段，不被正文里的嵌套模板截断', () => {
  const wikitext = '{{多义词|当前项={{PAGENAME}}}}\n{{书籍\n|书籍名=测试书\n|卷1名=测试书·卷一\n'
    + '|卷1内容=正文{{颜色|蓝|彩色}}还有{{未知|参数}}<br>\n第二行\n'
    + '<tabber>\n空=\n[[file:A.png]]\n|-|荧=\n[[file:B.png]]\n</tabber>\n\n|卷2名=测试书·卷二\n|卷2内容=卷二\n}}\n== 页面外的注释 =='
  const f = B.parseWikiBookTemplate(wikitext)
  assert.equal(f['书籍名'], '测试书')
  assert.equal(f['卷2内容'], '卷二')
  assert.ok(f['卷1内容'].includes('<tabber>'), 'tabber 必须原样带出来')
  assert.ok(!f['卷1内容'].includes('页面外的注释'), '模板外的内容不能混进来')
})

test('applyRawVolumeContent：用页面原文修复被 SMW 换成占位符的卷正文', () => {
  const books = B.parseWikiAsk(ASK_FIXTURE)
  const target = books.find(b => b.name_zh === '出发吧！嘟嘟可')
  target.volumes[0].content = "前\n'\"`UNIQ--tabber-00000000-QINU`\"\n后"
  target.volumes[0].needs_raw = true
  const raw = new Map([['出发吧！嘟嘟可', {
    '卷1内容': '前\n<tabber>\n空=\n[[file:插图2空.png|center]]\n|-|荧=\n[[file:插图2荧.png|center]]\n</tabber>\n后',
  }]])
  const patched = B.applyRawVolumeContent([target], raw)
  assert.equal(patched, 1)
  assert.ok(!target.volumes[0].content.includes('UNIQ--'))
  assert.deepEqual(target.volumes[0].images.map(i => i.file), ['插图2空.png'])
})

test('buildBookPayload：wiki 正文带插图时不采用观测枢正文（否则插图全丢）', () => {
  const books = B.parseWikiAsk(ASK_FIXTURE)
  const wiki = books.find(b => b.name_zh === '出发吧！嘟嘟可')
  wiki.volumes[0].images = [{ key: 'BookImg_aaaa', file: '插图.png' }]
  wiki.volumes[0].content = `正文\n[img:BookImg_aaaa]\n结束`
  const p = B.buildBookPayload({
    wiki,
    mihoyo: { name: '出发吧！嘟嘟可', contentId: 1, icon: '', volumes: [{ name: '出发吧！嘟嘟可', content: '观测枢的更干净的正文', description: '', source: '', author: '' }] },
    wikiCoverUrl: '',
  })
  assert.equal(p.volumes[0].content_source, 'biligame')
  assert.ok(p.volumes[0].content.includes('[img:BookImg_aaaa]'))
  assert.equal(p.images.length, 1)
  assert.equal(p.images[0].key, 'BookImg_aaaa')
  assert.equal(p.debug.images, 1)
})

test('cleanMihoyoHtml：逐 <p> 成行，空段落保留成空行，跨条目链接只留文字', () => {
  const html = '<p style="white-space: pre-wrap;">第一段</p><p> </p><p>第二段</p>'
    + '<p><span class="custom-entry-wrapper" data-entry-id="589"><a href="/x">沙漏之章 第一幕</a></span>获得</p>'
  assert.equal(B.cleanMihoyoHtml(html), '第一段\n\n第二段\n沙漏之章 第一幕获得')
})

test('isFakeBody：与描述相同的短段落判定为假正文，长正文不受影响', () => {
  const desc = '在提瓦特大陆各地流传已久的童话，本册讲述了白之公主与光之王子的相遇。'
  assert.equal(B.isFakeBody(desc, desc), true)
  assert.equal(B.isFakeBody(`<p>${desc}</p>`.replace(/<\/?p>/g, ''), desc), true)
  assert.equal(B.isFakeBody('很久、很久以前，在遥远的夜之国，夜母统治着一切臣民。夜之国是一片死寂的土地，在这里，大地上没有一丝光亮，夜幕下没有一棵草木。', desc), false)
})

test('cleanAuthor：观测枢的「待补充」「暂无」是缺值占位，不能当作者写库', () => {
  assert.equal(B.cleanAuthor('待补充'), '')
  assert.equal(B.cleanAuthor('暂无'), '')
  assert.equal(B.cleanAuthor('艾莉丝'), '艾莉丝')
})

// ═══════════════════════════════════════════════════════════
// 卷序解析
// ═══════════════════════════════════════════════════════════
test('volumeIndexFromText：卷一 / 第一卷 / 第1卷 / 正文首段数字 都要认出来', () => {
  assert.equal(B.volumeIndexFromText('野猪公主·卷一'), 1)
  assert.equal(B.volumeIndexFromText('第一卷'), 1)
  assert.equal(B.volumeIndexFromText('第3卷'), 3)
  // 「·一」这类后缀是卷名而不是「卷一」，不能当卷号：否则《鹮巷物语·一》会错配到卷一，
  // 而它的第一卷其实是「序」。这类卷靠卷名精确匹配。
  assert.equal(B.volumeIndexFromText('鹮巷物语·一'), null)
  assert.equal(B.volumeIndexFromText('鹮巷物语·序'), null)
  assert.equal(B.volumeIndexFromText('<p>5</p><p>正文</p>'), 5)
  assert.equal(B.volumeIndexFromText('给东东的信'), null)
})

test('tailKey / volumeSuffix：取末段名、去掉书名前缀', () => {
  assert.equal(B.tailKey('谁人的日志·第二卷·瑶光滩'), B.tailKey('谁人的日志·瑶光滩'))
  assert.equal(B.tailKey('提瓦特游览指南·蒙德篇'), B.matchKey('蒙德篇'))
  assert.equal(B.volumeSuffix('野猪公主·卷一', '野猪公主'), '卷一')
})

// ═══════════════════════════════════════════════════════════
// wiki / 观测枢 解析
// ═══════════════════════════════════════════════════════════
test('parseWikiAsk：元数据 + 卷全部就位，空正文的卷保留但不带内容', () => {
  const books = B.parseWikiAsk(ASK_FIXTURE)
  assert.equal(books.length, 7)
  const yz = books.find(b => b.name_zh === '野猪公主')
  assert.equal(yz.rarity, 4)
  assert.deepEqual(yz.genres, ['寓言童话'])
  assert.equal(yz.countries, '蒙德')
  assert.equal(yz.volumes.length, 2)
  assert.ok(yz.volumes[0].content.includes('久远的传说中'))

  const bz = books.find(b => b.name_zh === '白之公主与六侏儒')
  assert.equal(bz.volumes.length, 2)
  assert.equal(bz.volumes[1].content, '', 'wiki 没有正文的卷应为空串而不是缺失')

  const dd = books.find(b => b.name_zh === '出发吧！嘟嘟可')
  assert.equal(dd.illustrated, false)
})

test('parseMihoyoList：ext 里的「书籍类型 / 获取方式」两组标签要分开', () => {
  const list = B.parseMihoyoList(MIHOYO_LIST_FIXTURE)
  assert.equal(list.length, 8)
  const yz = list.find(x => x.contentId === 625)
  assert.deepEqual(yz.categories, ['童话寓言'])
  assert.deepEqual(yz.sourceTypes, ['NPC购买'])
  // 书名里的「 · 」在这里就已经被统一成「·」
  assert.equal(list.find(x => x.contentId === 506361).name, '大盗雷德·米勒传奇')
})

// ═══════════════════════════════════════════════════════════
// 观测枢 base / body 配对
// ═══════════════════════════════════════════════════════════
function pair(page) {
  const parsed = B.parseMihoyoEntry(page)
  return B.pairMihoyoVolumes(parsed.bases, parsed.bodies)
}

test('pairMihoyoVolumes：模块顺序被打乱时按卷名配对，不能按位置', () => {
  const vols = pair(MIHOYO_QINGQUAN)
  const byName = Object.fromEntries(vols.map(v => [v.name, v]))
  // 「清泉之心 · 一」在展示名归一化后写作「清泉之心·一」
  assert.equal(byName['清泉之心·一'].content, '如水的月光下')
  assert.equal(byName['清泉之心·二'].content, '望着涟漪中破碎的月光')
  assert.equal(byName['清泉之心·三'].content, '精灵没有悠远的记忆')
  assert.equal(byName['清泉之心·四'].content, '不再是少年的少年')
  // 每条 base 都要配上各自正文，而不是错位一格
  assert.equal(byName['清泉之心·四'].source, '晨曦酒庄')
})

test('pairMihoyoVolumes：base「卷二」↔ 正文模块「第二卷」按卷序号配对', () => {
  const vols = pair(MIHOYO_JIXING)
  const byName = Object.fromEntries(vols.map(v => [v.name, v]))
  assert.equal(byName['极星舞剧集·卷一'].content, '第一卷正文')
  assert.equal(byName['极星舞剧集·卷二'].content, '第二卷正文')
  assert.equal(byName['极星舞剧集·卷三'].content, '第三卷正文')
})

test('pairMihoyoVolumes：正文模块只有「——蒙德篇——」时按末段名配对', () => {
  const vols = pair(MIHOYO_TIWATE)
  const byName = Object.fromEntries(vols.map(v => [v.name, v]))
  assert.ok(byName['提瓦特游览指南·蒙德篇'].content.includes('达达乌帕谷'))
  assert.equal(byName['提瓦特大陆游览指南·璃月篇'].content, '荻花洲')
  assert.equal(byName['提瓦特游览指南·蒙德篇'].author, '艾莉丝')
})

test('stripLeadingVolumeNumber：观测枢把卷号渲染进正文时剥掉，卷号不符则保留', () => {
  assert.equal(B.stripLeadingVolumeNumber('1\n久远的传说中', '<p>1</p><p>久远的传说中</p>'), '久远的传说中')
  assert.equal(B.stripLeadingVolumeNumber('7\n经过重重风暴', '<p>7</p><p>经过重重风暴</p>'), '经过重重风暴')
  // 首行数字与卷号不一致（正文本来就以数字开头）时不动
  assert.equal(B.stripLeadingVolumeNumber('3\n正文', '<p>1</p><p>正文</p>'), '3\n正文')
  assert.equal(B.stripLeadingVolumeNumber('普通正文', '<p>普通正文</p>'), '普通正文')
})

test('pairMihoyoVolumes：空壳 base 的卷名取自正文模块，假正文被识别出来', () => {
  const vols = pair(MIHOYO_BAIZHI)
  assert.equal(vols.length, 3)
  assert.equal(vols[0].name, '白之公主与六侏儒·第一卷')
  assert.ok(vols[0].content.includes('夜母统治着一切臣民'))
  // 第二个 base 是空壳：卷名要落在正文模块的「第二卷」上
  assert.equal(vols[1].name, '白之公主与六侏儒·第二卷')
  assert.equal(vols[2].name, '白之公主与六侏儒·第三卷')
})

// ═══════════════════════════════════════════════════════════
// 跨源合并
// ═══════════════════════════════════════════════════════════
test('matchBooks：精确匹配 + 前缀匹配，重复建页跳过，观测枢独有保留', () => {
  const wikiBooks = B.parseWikiAsk(ASK_FIXTURE)
  const mlist = B.parseMihoyoList(MIHOYO_LIST_FIXTURE)
  const { merged, onlyMihoyo, redundantMihoyo } = B.matchBooks(wikiBooks, mlist)

  const byName = Object.fromEntries(merged.map(m => [m.wiki.name_zh, m.mihoyo]))
  assert.equal(byName['野猪公主'].contentId, 625)
  // 书名带空格的点号，靠归一化命中
  assert.equal(byName['谁人的日志'].contentId, 621)
  // 前缀匹配：与神性同行 ↔ 与神性同行·序言
  assert.equal(byName['与神性同行'].contentId, 479)
  // 精确匹配优先，不能把《林间风》配上《林间风·故事拔萃节选》
  assert.equal(byName['林间风'].contentId, 501)

  assert.deepEqual(redundantMihoyo.map(r => r.name), ['林间风·故事拔萃节选'])
  assert.deepEqual(onlyMihoyo.map(o => o.mihoyo.name), ['残破的笔记'])
})

test('buildBookPayload：元数据取 wiki、正文取观测枢、国家多值、封面优先 wiki', () => {
  const wikiBooks = B.parseWikiAsk(ASK_FIXTURE)
  const wiki = wikiBooks.find(b => b.name_zh === '谁人的日志')
  const mlist = B.parseMihoyoList(MIHOYO_LIST_FIXTURE)
  const mihoyo = mlist.find(x => x.contentId === 621)
  const p = B.buildBookPayload({
    wiki,
    mihoyo: { ...mihoyo, volumes: pair(MIHOYO_QINGQUAN) },   // 借一份卷数据即可
    wikiCoverUrl: 'https://patchwiki.biligame.com/xyz.png',
  })
  assert.equal(p.name_zh, '谁人的日志')
  assert.equal(p.rarity, 3)
  assert.equal(p.genre, '游记日志')
  assert.equal(p.country, '璃月、稻妻', '国家是数组，不能拼成「2, 3」')
  assert.equal(p.version, '1.0、2.0')
  assert.equal(p.image_source, 'biligame')
  assert.equal(p.image_alt_url, mihoyo.icon === '' ? '' : mihoyo.icon)
  assert.ok(/^Book_[0-9a-f]{12}\.png$/.test(p.image), `封面文件名应是与来源无关的稳定哈希，实际 ${p.image}`)
})

test('buildBookPayload：wiki 有正文时用 wiki；观测枢的假正文不能覆盖成空', () => {
  const wikiBooks = B.parseWikiAsk(ASK_FIXTURE)
  const wiki = wikiBooks.find(b => b.name_zh === '白之公主与六侏儒')
  const p = B.buildBookPayload({
    wiki,
    mihoyo: { name: '白之公主与六侏儒', contentId: 500, icon: '', volumes: pair(MIHOYO_BAIZHI) },
    wikiCoverUrl: '',
  })
  const vol1 = p.volumes.find(v => v.volume_no === 1)
  const vol2 = p.volumes.find(v => v.volume_no === 2)
  // 观测枢给的「书籍内容」是真正文 → 采用，并标注来源
  assert.equal(vol1.content_source, 'mihoyo')
  assert.ok(vol1.content.includes('夜母统治着一切臣民'))
  // 观测枢给的卷二正文其实等于 wiki 的描述 → 判为假正文；wiki 也没有正文 → 留空
  assert.equal(vol2.content, '')
  assert.equal(vol2.content_source, '')
  assert.equal(p.debug.fake_bodies, 1)
  assert.equal(p.debug.body_missing, 1)
})

test('buildBookPayload：观测枢独有条目也能成书（残破的笔记）', () => {
  const mlist = B.parseMihoyoList(MIHOYO_LIST_FIXTURE)
  const mihoyo = mlist.find(x => x.contentId === 1158)
  const p = B.buildBookPayload({
    wiki: null,
    mihoyo: {
      ...mihoyo,
      volumes: pair(mpage('残破的笔记', [mbi('残破的笔记', { desc: '某人写就的笔记', source: '【时与风】任务获取' }), mbody('残破的笔记', '<p>这日晷上的话，应该是接着千风神殿那台日晷上刻的话。</p>')])),
    },
    wikiCoverUrl: '',
  })
  assert.equal(p.name_zh, '残破的笔记')
  assert.equal(p.volume_count, 1)
  assert.equal(p.image_source, 'mihoyo')
  assert.equal(p.source_type, '任务获取')
  assert.equal(p.volumes[0].content_source, 'mihoyo')
})

test('buildBookPayload：配对不到观测枢卷时全部回退 wiki 正文', () => {
  const wikiBooks = B.parseWikiAsk(ASK_FIXTURE)
  const wiki = wikiBooks.find(b => b.name_zh === '野猪公主')
  const p = B.buildBookPayload({ wiki, mihoyo: null, wikiCoverUrl: 'https://x/1.png' })
  assert.equal(p.volumes.length, 2)
  assert.ok(p.volumes.every(v => v.content_source === 'biligame'))
  assert.equal(p.debug.body_from_wiki, 2)
  assert.equal(p.debug.mihoyo, false)
})

test('matchVolumes：wiki「第二卷·瑶光滩」↔ 观测枢「瑶光滩」按末段名对齐', () => {
  const wikiBooks = B.parseWikiAsk(ASK_FIXTURE)
  const wiki = wikiBooks.find(b => b.name_zh === '谁人的日志')
  const vols = B.matchVolumes(wiki.volumes, [
    { name: '谁人的日志·瑶光滩', content: '瑶光滩正文', description: '', source: '', author: '' },
    { name: '给东东的信', content: '家书正文', description: '', source: '', author: '' },
  ], '谁人的日志')
  assert.equal(vols.find(v => v.wiki.volume_no === 1).mihoyo.content, '家书正文')
  assert.equal(vols.find(v => v.wiki.volume_no === 2).mihoyo.content, '瑶光滩正文')
})

test('bookImageKey：同名书永远得到同一个文件名（换源不会换文件名）', () => {
  assert.equal(B.bookImageKey('清泉之心'), B.bookImageKey('清泉之心'))
  assert.notEqual(B.bookImageKey('清泉之心'), B.bookImageKey('野猪公主'))
  assert.ok(/^Book_[0-9a-f]{12}$/.test(B.bookImageKey('清泉之心')))
})

// ═══════════════════════════════════════════════════════════
console.log('\n书籍爬虫解析/配对规则')
if (failures.length === 0) {
  console.log(`  ✓ 全部 ${passed} 项通过`)
  process.exit(0)
}
for (const f of failures) console.log(`  ✗ ${f.name}\n      ${f.error}`)
console.log(`\n${passed} passed, ${failures.length} failed`)
process.exit(1)

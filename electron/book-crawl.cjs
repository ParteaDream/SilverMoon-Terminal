/**
 * book-crawl.cjs — 书籍爬虫的纯逻辑层
 *
 * 两个数据源的原始响应在这里被归一化成「一本书」的结构，主进程只负责发请求。
 * 抽成独立 CommonJS 模块的原因与 weapon-names.cjs 相同：这里集中了最容易出错、
 * 又最难在界面上复现的判断（书名跨站匹配、卷与正文的配对、观测枢的假正文），
 * 需要能用 node 直接跑单测（见 scripts/test-book-merge.mjs）。
 *
 * ── 数据源分工（依据两站实测字段能力）──
 *   bilibili wiki  ：书籍清单与全部筛选维度（稀有度/体裁/国家/实装版本/图鉴）、
 *                    卷名/每卷获取地点/每卷描述。action=ask 一次请求即返回全部书籍。
 *   米游社观测枢   ：卷正文（HTML 段落，排版比 wikitext 干净）、作者、获取方式分类。
 *                    封面两者都有，wiki 的尺寸更稳定（195~220px，观测枢旧书仅 98px），
 *                    因此封面**优先取 wiki**，观测枢作为兜底。
 *
 * ── 两个必须挡住的坑 ──
 *   1. 观测枢的 modules[] 顺序**不等于**卷序（清泉之心是 一/四/二/三，极星舞剧集更乱），
 *      位置配对一定会错，只能靠卷名/卷序号配对（pairMihoyoVolumes）。
 *   2. 观测枢对没有正文的卷会**拿描述冒充正文**（白之公主与六侏儒 卷二~卷七、
 *      丘丘语诗歌试作 卷二~卷三），直接落库会得到一篇「正文就是简介」的假书，
 *      必须识别出来并回退 wiki 正文（isFakeBody）。
 */

const crypto = require('crypto');

// ═══════════════════════════════════════════════════════════
// 通用归一化
// ═══════════════════════════════════════════════════════════

/** 点状分隔符：两站混用 ·(U+00B7) •(U+2022) ∙(U+2219) ・(U+30FB) 等 */
const DOT_SEP_RE = /[\u2022\u2219\u30fb\u2027\uff65\u22c5\u00b7]/g;

/** 书名/卷名匹配键：去掉全部空白、统一分隔符、去掉末尾的括号注释 */
function matchKey(value) {
  return String(value == null ? '' : value)
    .replace(/[\s\u00a0\u3000]+/g, '')
    .replace(DOT_SEP_RE, '\u00b7')
    .replace(/[（(][^（()）]*[)）]$/, '')
    .toLowerCase();
}

/** 展示用归一化：只统一分隔符与空白，不丢括号注释 */
function displayName(value) {
  return String(value == null ? '' : value)
    .replace(/[\u00a0\u3000]/g, ' ')
    // 观测枢写作「大盗雷德 · 米勒传奇」「骑士团指导手册 • 第五版」，
    // 这里连分隔符两侧的空白一起去掉，展示名与 wiki 的写法对齐
    .replace(/\s*[\u2022\u2219\u30fb\u2027\uff65\u22c5\u00b7]\s*/g, '\u00b7')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 「4星」→ 4；「0星」→ 0；认不出来 → null */
function parseRarity(text) {
  const m = /(\d+)/.exec(String(text == null ? '' : text));
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/** wiki 的国家是数字码，观测枢没有该字段 */
const COUNTRY_NAMES = {
  0: '提瓦特', 1: '蒙德', 2: '璃月', 3: '稻妻', 4: '须弥',
  5: '枫丹', 6: '纳塔', 7: '挪德卡莱', 8: '至冬',
};

/** ['1'] / ['2','3'] / ['2、3'] → '蒙德' / '璃月、稻妻' */
function mapCountries(raw) {
  const codes = [];
  for (const item of toArray(raw)) {
    for (const piece of String(item).split(/[、,，/]/)) {
      const code = piece.trim();
      if (code) codes.push(code);
    }
  }
  const names = [];
  for (const code of codes) {
    const name = COUNTRY_NAMES[code] || (Number.isNaN(Number(code)) ? code : '');
    if (name && !names.includes(name)) names.push(name);
  }
  return names.join('、');
}

/**
 * 版本字段归一化。
 * wiki 的语义化属性已经把「月之一」映射成 6.0，但原始 wikitext 与个别历史条目
 * 仍可能出现月相别名，这里再兜一层。
 */
const LUNAR_VERSION_MAP = {
  月之一: '6.0', 月之二: '6.1', 月之三: '6.2', 月之四: '6.3',
  月之五: '6.4', 月之六: '6.5', 月之七: '6.6', 月之八: '6.7',
};

function normalizeVersions(raw) {
  const out = [];
  for (const item of toArray(raw)) {
    for (const piece of String(item).split(/[、,，/]/)) {
      let v = piece.trim();
      if (!v) continue;
      v = LUNAR_VERSION_MAP[v] || v;
      if (!out.includes(v)) out.push(v);
    }
  }
  // 「1.0、1.2、2.0」按版本号排序，避免 wiki 里的录入顺序不一致
  return out.sort(compareVersion).join('、');
}

function compareVersion(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (Number.isFinite(x) && Number.isFinite(y) && x !== y) return x - y;
  }
  return String(a).localeCompare(String(b));
}

function toArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

/** 取值 + 去空白，SMW 的 printouts 是数组 */
function firstText(value) {
  const arr = toArray(value);
  if (arr.length === 0) return '';
  const v = arr[0];
  return v == null ? '' : String(v).trim();
}

// ═══════════════════════════════════════════════════════════
// 文本清洗
// ═══════════════════════════════════════════════════════════

/** wiki 的 {{颜色|蓝|文字}} 配色 → 本应用的 [color=#xxxxxx] 标记 */
const WIKI_COLOR_MAP = {
  蓝: '#4a9eea', 蓝色: '#4a9eea',
  红: '#e06060', 红色: '#e06060',
  绿: '#5cbd6b', 绿色: '#5cbd6b',
  金: '#e0a94a', 金色: '#e0a94a',
  紫: '#a878e0', 紫色: '#a878e0',
  橙: '#e08a4a', 橙色: '#e08a4a',
  描述: '#8a8a9a',
  黑: '#3a3a3a', 灰色: '#8a8a9a',
};

function decodeEntities(text) {
  return String(text || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** 去掉 HTML 标签但保留文字（块级标签转成换行） */
function stripTags(html) {
  return String(html || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '');
}

/** 收尾：逐行去尾空白、压缩连续空行、去首尾空白 */
function tidyText(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n').map(l => l.replace(/[ \t\u00a0]+$/g, ''));
  const out = [];
  for (const line of lines) {
    if (line.trim() === '' && (out.length === 0 || out[out.length - 1].trim() === '')) continue;
    out.push(line);
  }
  while (out.length && out[out.length - 1].trim() === '') out.pop();
  return out.join('\n').trim();
}

/**
 * wiki 正文（卷N内容）→ 纯文本 + 彩色标记。
 *
 * 实测卷正文里出现过的标记：<br>（全部）、{{颜色|蓝|…}}（45/105 本）、
 * [[页面|别名]]、'''粗体'''、<tabber>（2 本）。模板一律「取最后一个位置参数」
 * 展开——{{颜色|蓝|X}} / {{黑幕|X}} / {{ruby|X|y}} 都符合这个规律。
 */
function cleanWikiText(raw, ctx = {}) {
  let text = String(raw == null ? '' : raw);
  if (!text.trim()) return '';

  text = text.replace(/<!--[\s\S]*?-->/g, '');

  // 源码换行是排版用的：`…。<br>\n下一句` 里的换行紧跟在 <br> 后面，本身不产生空行。
  // 先吃掉这种「<br> + 换行」，再把单独的 <br> 折成换行——否则每个句子之间都会多出一个空行
  // （真实空行在 wikitext 里写作 <br><br>，那一次替换后仍然是两个换行，不受影响）。
  text = text.replace(/<br\s*\/?>[ \t]*\r?\n/g, '\n');

  // <tabber> 是「同一段落的两个版本」（任务前后 / 旅行者性别），只保留第一支
  text = text.replace(/<tabber>([\s\S]*?)<\/tabber>/gi, (_m, body) => {
    const branch = String(body).split(/\|-+\|/)[0] || '';
    // 支线首行是「分支名=」，整行去掉
    return branch.replace(/^\s*[^\n=]*=[ \t]*\r?\n/, '');
  });

  // 插图的处理放在模板展开之前：[[file:…]] 里偶尔会嵌模板（如 {{PAGENAME}}），
  // 但实测都是纯文件名，先取出来更简单也更不容易被后面的清洗规则误伤。
  text = text.replace(/\[\[(?:file|文件|image|图像)\s*:\s*([^\]|]+)((?:\|[^\]]*)?)\]\]/gi, (_m, file) => {
    const title = String(file).trim();
    if (!title) return '';
    const key = contentImageKey(title);
    if (ctx.images && !ctx.images.some(i => i.key === key)) ctx.images.push({ key, file: title });
    // 单独成行，阅读器按块级元素渲染
    return `\n[img:${key}]\n`;
  });

  // <nowiki> 里的内容要原样保留（《大盗雷德·米勒传奇》里的分隔线就是靠它）
  text = text.replace(/<nowiki>([\s\S]*?)<\/nowiki>/gi, '$1');
  // <ref>脚注</ref>：没有独立的注释区可放，就地保留文字
  text = text.replace(/<ref[^>]*>([\s\S]*?)<\/ref>/gi, '（$1）');
  text = text.replace(/<ref[^>]*\/>/gi, '');

  // 模板：反复替换最内层（无嵌套花括号）的 {{...}}，直到没有为止
  for (let i = 0; i < 12; i++) {
    const next = text.replace(/\{\{([^{}]*)\}\}/g, (_m, inner) => expandWikiTemplate(inner, ctx));
    if (next === text) break;
    text = next;
  }
  // 仍未闭合的模板（罕见，通常是被截断的正文）直接去掉标记
  text = text.replace(/\{\{|\}\}/g, '');

  // 链接
  text = text.replace(/\[\[([^\]|]+)\|([^\]]*)\]\]/g, '$2');
  text = text.replace(/\[\[([^\]]+)\]\]/g, '$1');
  text = text.replace(/\[(https?:\/\/\S+)\s+([^\]]*)\]/g, '$2');

  // 强调
  text = text.replace(/'''([^']+)'''/g, '[b]$1[/b]');
  text = text.replace(/''([^']+)''/g, '[i]$1[/i]');

  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = stripTags(text);
  // 兜底：SMW 存下来的值里，被剥离的标签会变成 "`UNIQ--tabber-00000000-QINU`" 这类占位符。
  // 正常情况下这些位置已经被原始 wikitext 修好了（applyRawVolumeContent），
  // 这里只负责别让占位符漏进库里。
  text = text.replace(/["'`]*UNIQ--[A-Za-z0-9-]+-QINU["'`]*/g, '');
  return tidyText(decodeEntities(text));
}

/** {{名字|位置参数…|键=值…}} → 展示文本 */
function expandWikiTemplate(inner, ctx) {
  const parts = String(inner).split('|');
  const name = (parts.shift() || '').trim();
  const positional = [];
  const named = {};
  for (const part of parts) {
    const eq = part.indexOf('=');
    // 「|键=值」才算命名参数；正文里出现的等号若无键名则仍是位置参数
    if (eq > 0 && /^[^|={}\n]+$/.test(part.slice(0, eq))) named[part.slice(0, eq).trim()] = part.slice(eq + 1);
    else positional.push(part);
  }
  const lastArg = positional.length ? String(positional[positional.length - 1]) : '';

  if (name === 'PAGENAME' || name === 'FULLPAGENAME') return ctx.bookName || '';
  if (name === '颜色' || name === 'color' || name === 'Color') {
    const text = lastArg;
    const colorKey = String(positional[0] || '').trim();
    const hex = WIKI_COLOR_MAP[colorKey] || (/^#[0-9a-fA-F]{3,8}$/.test(colorKey) ? colorKey : '');
    return hex ? `[color=${hex}]${text}[/color]` : text;
  }
  if (name === '黑幕' || name === 'ruby' || name === 'Ruby' || name === '注音') return lastArg;
  if (name === 'lang' || name === 'code') return lastArg;
  // 未收录的模板：有位置参数时取最后一个（通常就是展示文本），否则整段丢弃
  return lastArg;
}

/**
 * 观测枢正文（collapse_panel.rich_text）→ 纯文本。
 *
 * 每个段落是独立的 <p>，段间空行是「内容为一个空格的 <p>」——按行展开后
 * 结构天然正确；跨条目的 custom-entry-wrapper 只保留其中的文字。
 */
function cleanMihoyoHtml(html) {
  const src = String(html || '');
  if (!src.trim()) return '';
  const withBreaks = src
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/(div|li|tr|h[1-6])>/gi, '\n');
  const plain = stripTags(withBreaks);
  return tidyText(decodeEntities(plain));
}

/** 段落化文本的比较键（忽略空白与分组标记，用于识别「假正文」） */
function textFingerprint(text) {
  return String(text || '')
    .replace(/\[\/?(?:color|b|i|note)[^\]]*\]/g, '')
    .replace(/\s+/g, '');
}

/**
 * 观测枢用「描述」冒充缺失正文的情况（白之公主与六侏儒 卷二~卷七等）。
 * 判据：正文与描述归一化后相同，或正文很短且是描述的一部分。
 */
function isFakeBody(body, description) {
  const b = textFingerprint(body);
  const d = textFingerprint(description);
  if (!b) return true;
  if (!d) return false;
  if (b === d) return true;
  return b.length <= 120 && (d.includes(b) || b.includes(d));
}

// ═══════════════════════════════════════════════════════════
// 卷序解析
// ═══════════════════════════════════════════════════════════

const CN_DIGITS = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

/** 「十一」→ 11；「一」→ 1；认不出来 → null */
function chineseNumber(text) {
  const s = String(text || '').trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return Number(s);
  if (!/^[一二三四五六七八九十]+$/.test(s)) return null;
  if (s === '十') return 10;
  const idx = s.indexOf('十');
  if (idx < 0) return CN_DIGITS[s] || null;
  const tens = idx === 0 ? 1 : (CN_DIGITS[s[0]] || 0);
  const ones = idx === s.length - 1 ? 0 : (CN_DIGITS[s[idx + 1]] || 0);
  const v = tens * 10 + ones;
  return v > 0 ? v : null;
}

/**
 * 从卷名/模块名里抽卷序号。
 * 覆盖实测到的写法：卷一、第一卷、卷 1、第1卷、纯数字正文首段。
 */
function volumeIndexFromText(text) {
  const s = String(text || '');
  if (!s) return null;
  let m = /第\s*([一二三四五六七八九十]+)\s*[卷章]/.exec(s);
  if (m) { const v = chineseNumber(m[1]); if (v) return v; }
  m = /第\s*(\d+)\s*[卷章]/.exec(s);
  if (m) return Number(m[1]);
  m = /[卷章]\s*([一二三四五六七八九十]+)/.exec(s);
  if (m) { const v = chineseNumber(m[1]); if (v) return v; }
  m = /[卷章]\s*(\d+)/.exec(s);
  if (m) return Number(m[1]);
  // 观测枢的正文常常以 <p>3</p> 开头标注卷号
  m = /^\s*<p[^>]*>\s*(\d{1,2})\s*<\/p>/.exec(s);
  if (m) return Number(m[1]);
  return null;
}

/** 取最后一个点状分隔符之后的部分；没有分隔符时返回整串 */
function tailKey(name) {
  const s = displayName(name);
  const idx = Math.max(s.lastIndexOf('\u00b7'), s.lastIndexOf(' '));
  return matchKey(idx >= 0 ? s.slice(idx + 1) : s);
}

/** 去掉书名前缀后的卷名（「野猪公主·卷一」→「卷一」） */
function volumeSuffix(volumeName, bookName) {
  let s = displayName(volumeName);
  const book = displayName(bookName);
  if (book && s.startsWith(book)) s = s.slice(book.length);
  return s.replace(/^[\s\u00b7•∙・:：\-—]+/, '').trim() || displayName(volumeName);
}

// ═══════════════════════════════════════════════════════════
// 源解析
// ═══════════════════════════════════════════════════════════

/**
 * bilibili wiki 的 action=ask 响应 → 书籍数组。
 * 每本含元数据 + 卷（卷名/获取地点/描述/正文原文）。
 */
function parseWikiAsk(data, options = {}) {
  const maxVolumes = options.maxVolumes || 12;
  const results = (data && data.query && data.query.results) || {};
  const books = [];
  for (const [pageTitle, entry] of Object.entries(results)) {
    const p = (entry && entry.printouts) || {};
    const volumes = [];
    for (let i = 1; i <= maxVolumes; i++) {
      const name = firstText(p[`卷${i}名`]);
      if (!name) continue;
      const images = [];
      volumes.push({
        volume_no: i,
        title_zh: name,
        source: cleanWikiText(firstText(p[`卷${i}获取地点`])),
        description_zh: cleanWikiText(firstText(p[`卷${i}描述`])),
        content: cleanWikiText(firstText(p[`卷${i}内容`]), { bookName: pageTitle, images }),
        images,
        // SMW 值里带占位符的卷需要用页面原文重解析（见 applyRawVolumeContent）
        needs_raw: /UNIQ--[A-Za-z0-9-]+-QINU/.test(firstText(p[`卷${i}内容`])),
      });
    }
    books.push({
      title: pageTitle,
      name_zh: displayName(firstText(p['书籍名']) || pageTitle),
      volume_text: firstText(p['卷数']),
      rarity: parseRarity(firstText(p['稀有度'])),
      genres: toArray(p['体裁']).map(s => String(s).trim()).filter(Boolean),
      countries: mapCountries(p['国家']),
      versions: toArray(p['实装版本']),
      illustrated: firstText(p['图鉴']) === '是',
      related_chars: toArray(p['相关角色']).map(s => String(s).trim()).filter(Boolean).join('、'),
      volumes,
    });
  }
  // action=ask 的顺序不稳定（同稀有度内是编辑顺序），按书名稳定排序，
  // 让「查漏补缺」与批量爬取的列表每次一致
  books.sort((a, b) => (b.rarity || 0) - (a.rarity || 0) || a.name_zh.localeCompare(b.name_zh, 'zh'));
  return books;
}

/** 观测枢频道列表响应 → [{ name, contentId, icon, categories, sourceTypes }] */
function parseMihoyoList(data, channelKey = 'c_68') {
  const channel = data && data.data && data.data.list && data.data.list[0];
  const items = (channel && channel.list) || [];
  const out = [];
  for (const item of items) {
    const name = displayName(item.title);
    if (!name) continue;
    let tags = [];
    try {
      const ext = JSON.parse(item.ext || '{}');
      const raw = ext[channelKey] && ext[channelKey].filter && ext[channelKey].filter.text;
      if (raw) tags = JSON.parse(raw);
    } catch (_) { tags = []; }
    const categories = [];
    const sourceTypes = [];
    for (const tag of Array.isArray(tags) ? tags : []) {
      const s = String(tag);
      const slash = s.indexOf('/');
      // 带「分组/值」的按分组归类；不带斜杠的整条都是分类（书籍类型）
      if (slash < 0) {
        if (s && !categories.includes(s)) categories.push(s);
        continue;
      }
      const group = s.slice(0, slash);
      const value = s.slice(slash + 1);
      if (!value) continue;
      if (group === '获取方式') sourceTypes.push(value);
      else if (!categories.includes(value)) categories.push(value);
    }
    out.push({
      name,
      contentId: Number(item.content_id) || null,
      icon: String(item.icon || ''),
      categories,
      sourceTypes,
    });
  }
  return out;
}

/**
 * 观测枢条目详情 → 卷列表（**未配对**，只有 base / body 两组）。
 *
 * 两组各自保持出现顺序，但两组之间没有位置对应关系（见文件头注释的坑 1）。
 */
function parseMihoyoEntry(page) {
  const bases = [];
  const bodies = [];
  const name = displayName(page && page.name);
  for (const mod of (page && page.modules) || []) {
    for (const comp of mod.components || []) {
      let data;
      try { data = typeof comp.data === 'string' ? JSON.parse(comp.data) : comp.data; } catch (_) { continue; }
      if (!data || typeof data !== 'object') continue;
      if (comp.component_id === 'material_base_info') {
        const attr = {};
        for (const a of data.attr || []) {
          if (!a || !a.key) continue;
          attr[String(a.key)] = cleanMihoyoHtml(toArray(a.value).join('\n'));
        }
        bases.push({
          module_name: String(mod.name || ''),
          name: displayName(data.name),
          img: String(data.img || ''),
          star: Number.isFinite(Number(data.star)) ? Number(data.star) : null,
          source: cleanMihoyoHtml(data.materials && data.materials.value),
          description: attr['描述'] || '',
          author: attr['作者'] || '',
        });
      } else if (comp.component_id === 'collapse_panel') {
        bodies.push({
          module_name: String(mod.name || ''),
          html: String(data.rich_text || ''),
        });
      }
    }
  }
  return { name, bases, bodies };
}

/**
 * 观测枢有的卷正文以 `<p>1</p>` 开头把卷号也渲染进了正文（野猪公主全七卷都是），
 * 落到阅读器里就是正文第一行孤零零一个数字。只在首行数字与卷号一致时去掉。
 */
function stripLeadingVolumeNumber(content, html) {
  if (!content) return content;
  const lead = /^(\d{1,2})[ \t]*(?:\n|$)/.exec(content);
  if (!lead) return content;
  const index = volumeIndexFromText(html);
  if (!index || Number(lead[1]) !== index) return content;
  return content.slice(lead[0].length).replace(/^\n+/, '');
}

/**
 * 把观测枢的 base / body 两组配成卷。
 *
 * 依次尝试：卷名完全一致 → 卷序号一致 → 末段名一致 → 剩余项按顺序。
 * 最后一步只在两边剩余数量相同时才做，避免乱点鸳鸯谱。
 */
function pairMihoyoVolumes(bases, bodies) {
  const bodyUsed = new Array(bodies.length).fill(false);
  const pairs = new Array(bases.length).fill(null);

  const bodyKeys = bodies.map(b => matchKey(b.module_name));
  const bodyNums = bodies.map(b => volumeIndexFromText(b.module_name) || volumeIndexFromText(b.html));
  const bodyTails = bodies.map(b => tailKey(b.module_name));
  const baseNums = bases.map(b => volumeIndexFromText(b.name));
  const baseTails = bases.map(b => tailKey(b.name));

  const take = (bi, bi2) => { bodyUsed[bi2] = true; pairs[bi] = bodies[bi2]; };
  const freeBodies = () => bodies.map((_, i) => i).filter(i => !bodyUsed[i]);

  // 1. 卷名完全一致
  bases.forEach((base, i) => {
    const key = matchKey(base.name);
    if (!key) return;
    const j = bodies.findIndex((b, k) => !bodyUsed[k] && bodyKeys[k] === key);
    if (j >= 0) take(i, j);
  });

  // 2. 卷序号一致
  bases.forEach((base, i) => {
    if (pairs[i] || !baseNums[i]) return;
    const j = bodies.findIndex((b, k) => !bodyUsed[k] && bodyNums[k] === baseNums[i]);
    if (j >= 0) take(i, j);
  });

  // 3. 末段名一致（「提瓦特游览指南·蒙德篇」↔「——蒙德篇——」）
  bases.forEach((base, i) => {
    if (pairs[i] || !baseTails[i]) return;
    const j = bodies.findIndex((b, k) => !bodyUsed[k] && bodyTails[k] === baseTails[i]);
    if (j >= 0) take(i, j);
  });

  // 4. 剩余项按顺序对齐（白公主题：唯一的野生 body 就是「书籍内容」）
  const restBases = bases.map((_, i) => i).filter(i => !pairs[i]);
  const restBodies = freeBodies();
  if (restBases.length === restBodies.length && restBases.length > 0) {
    restBases.forEach((bi, k) => take(bi, restBodies[k]));
  }

  return bases.map((base, i) => {
    const body = pairs[i];
    const rawBody = stripLeadingVolumeNumber(body ? cleanMihoyoHtml(body.html) : '', body ? body.html : '');
    // 「白之公主与六侏儒」这类条目里，观测枢给没有内容的卷只留了一个**空壳**
    // material_base_info（name/desc/src 全空），卷名只写在正文模块上。
    // 空壳的卷名要以正文模块为准，否则卷序匹配会整段错位。
    const name = base.name || (body ? displayName(body.module_name) : '');
    return {
      name,
      module_name: base.module_name || (body ? body.module_name : ''),
      star: base.star,
      source: base.source,
      description: base.description,
      author: base.author,
      content: isFakeBody(rawBody, base.description) ? '' : rawBody,
      had_body: !!body,
      fake_body: isFakeBody(rawBody, base.description),
    };
  });
}

// ═══════════════════════════════════════════════════════════
// 跨源合并
// ═══════════════════════════════════════════════════════════

/**
 * 书名跨站匹配（实测匹配率：wiki 的 89/105 能在观测枢命中）。
 * 先精确匹配，再对剩余项做前缀包含匹配，处理
 * 「与神性同行」↔「与神性同行·序言」、「林间风」↔「林间风·故事拔萃节选」。
 */
function matchBooks(wikiBooks, mihoyoBooks) {
  const byKey = new Map();
  for (const m of mihoyoBooks) {
    const key = matchKey(m.name);
    if (key && !byKey.has(key)) byKey.set(key, m);
  }
  const used = new Set();
  const merged = wikiBooks.map(w => {
    const key = matchKey(w.name_zh || w.title);
    let hit = byKey.get(key) || null;
    if (hit) used.add(hit);
    return { wiki: w, mihoyo: hit };
  });

  // 前缀包含：只在剩下的一对一候选里挑最长匹配，避免误配
  const leftovers = mihoyoBooks.filter(m => !used.has(m));
  for (const item of merged) {
    if (item.mihoyo || leftovers.length === 0) continue;
    const key = matchKey(item.wiki.name_zh || item.wiki.title);
    if (key.length < 2) continue;
    let best = null;
    for (const m of leftovers) {
      if (used.has(m)) continue;
      const mk = matchKey(m.name);
      if (!mk || mk.length < 2) continue;
      const hit = mk.startsWith(key) || key.startsWith(mk);
      if (!hit) continue;
      if (!best || mk.length > matchKey(best.name).length) best = m;
    }
    if (best) { item.mihoyo = best; used.add(best); }
  }

  // 观测枢独有：wiki 的「书籍一览」不收录的条目（任务书籍、观枢侧单独建页的节选本）。
  // 其中「书名是已收录书名的延伸、且父书已经配到观测枢条目」的属于重复建页
  // （实测：观测枢 501《林间风》已含两卷，另有一个只装第一卷的 503《林间风·故事拔萃节选》），
  // 收录进来会得到一本内容重复的书，直接跳过。
  const matchedKeys = merged.filter(m => m.mihoyo).map(m => matchKey(m.wiki.name_zh || m.wiki.title));
  const onlyMihoyo = mihoyoBooks
    .filter(m => !used.has(m))
    .filter(m => {
      const key = matchKey(m.name);
      return !matchedKeys.some(k => k.length >= 2 && key !== k && key.startsWith(k));
    })
    .map(m => ({ wiki: null, mihoyo: m }));
  return { merged, onlyMihoyo, redundantMihoyo: mihoyoBooks.filter(m => !used.has(m) && !onlyMihoyo.some(o => o.mihoyo === m)) };
}

/** wiki 卷 ↔ 观测枢卷对齐：全名 → 卷序号 → 末段名 → 顺序 */
function matchVolumes(wikiVolumes, mihoyoVolumes, bookName) {
  const usedM = new Set();
  const result = wikiVolumes.map(v => ({ wiki: v, mihoyo: null }));
  const mKeys = mihoyoVolumes.map(m => matchKey(m.name));
  const mNums = mihoyoVolumes.map(m => volumeIndexFromText(m.name));
  const mTails = mihoyoVolumes.map(m => tailKey(m.name));
  const wSuffixes = wikiVolumes.map(v => matchKey(volumeSuffix(v.title_zh, bookName)));
  const wNums = wikiVolumes.map(v => v.volume_no);
  const wTails = wikiVolumes.map(v => tailKey(volumeSuffix(v.title_zh, bookName)));

  const assign = (wi, mi) => { result[wi].mihoyo = mihoyoVolumes[mi]; usedM.add(mi); };

  result.forEach((row, wi) => {
    const key = matchKey(volumeSuffix(row.wiki.title_zh, bookName));
    const mi = mihoyoVolumes.findIndex((_, k) => !usedM.has(k) && mKeys[k] === key);
    if (mi >= 0) assign(wi, mi);
  });
  result.forEach((row, wi) => {
    if (row.mihoyo || !wNums[wi]) return;
    const mi = mihoyoVolumes.findIndex((_, k) => !usedM.has(k) && mNums[k] === wNums[wi]);
    if (mi >= 0) assign(wi, mi);
  });
  result.forEach((row, wi) => {
    if (row.mihoyo || !wTails[wi]) return;
    const mi = mihoyoVolumes.findIndex((_, k) => !usedM.has(k) && mTails[k] === wTails[wi]);
    if (mi >= 0) assign(wi, mi);
  });
  // 卷序号是权威的，但那一步可能被同名末段抢走；这里再按序号补一次
  result.forEach((row, wi) => {
    if (row.mihoyo || !wNums[wi]) return;
    const mi = mihoyoVolumes.findIndex((_, k) => !usedM.has(k) && mNums[k] === wNums[wi]);
    if (mi >= 0) assign(wi, mi);
  });
  // 两侧剩余数量一致时按顺序补齐
  const restW = result.map((r, i) => (r.mihoyo ? -1 : i)).filter(i => i >= 0);
  const restM = mihoyoVolumes.map((_, i) => i).filter(i => !usedM.has(i));
  if (restW.length === restM.length && restW.length > 0) {
    restW.forEach((wi, k) => assign(wi, restM[k]));
  }
  return result;
}

/** 去重后按出现顺序拼接（描述、获取方式这类多值字段用） */
function joinUnique(values, sep = '\n') {
  const out = [];
  for (const v of values) {
    const s = String(v == null ? '' : v).trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out.join(sep);
}

/** 观测枢的「待补充」「暂无」是缺值占位，不能当成作者写进库 */
const EMPTY_FIELD_RE = /^(待补充|暂无|无|未知|none|null|n\/a|—+|-+|\/|×|x)$/i;

function cleanAuthor(value) {
  const s = String(value == null ? '' : value).trim();
  return EMPTY_FIELD_RE.test(s) ? '' : s;
}

/** 封面文件名基名：与来源无关，只由书名决定，换源不会换文件名 */
function bookImageKey(name) {
  const hash = crypto.createHash('md5').update(matchKey(name) || String(name || '')).digest('hex');
  return `Book_${hash.slice(0, 12)}`;
}

/**
 * 正文插图的文件名基名：由 wiki 的文件标题决定（如「出发吧！嘟嘟可-插图1.png」）。
 * 同样用哈希而不是原文件名——中文文件名、空格、扩展名在下载后会被内容嗅探改写，
 * 正文里存的必须是**落盘后**的名字，中间需要一个与扩展名无关的稳定键。
 */
function contentImageKey(fileTitle) {
  const hash = crypto.createHash('md5').update(String(fileTitle || '').trim()).digest('hex');
  return `BookImg_${hash.slice(0, 12)}`;
}

/** 正文里的插图占位标记：[img:BookImg_xxxxxxxxxxxx]（落库时补上真实扩展名） */
const CONTENT_IMAGE_RE = /\[img:([^\]\s]+)\]/g;

/**
 * 从原始 wikitext 里取 {{书籍}} 模板的字段。
 *
 * 只在必要时用（见 applyRawVolumeContent）：SMW 存下来的 `卷N内容` 会把 <tabber> /
 * <nowiki> / <ref> 这些标签替换成 `UNIQ--…-QINU` 占位符，只有页面原文才有完整内容。
 */
function parseWikiBookTemplate(wikitext) {
  const src = String(wikitext || '');
  const start = src.indexOf('{{书籍');
  if (start < 0) return null;
  // 花括号配平扫描：正文里可能嵌套 {{颜色|…}}，不能简单找第一个 }}
  let depth = 0;
  let end = -1;
  for (let i = start; i < src.length - 1; i++) {
    const two = src.slice(i, i + 2);
    if (two === '{{') { depth++; i++; continue }
    if (two === '}}') { depth--; i++; if (depth === 0) { end = i + 1; break } continue }
  }
  if (end < 0) return null;

  const body = src.slice(start + 2, end - 2);
  const fields = {};
  let key = null;
  for (const rawLine of body.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    const m = /^\s*\|([^=|{}\n]+)=(.*)$/.exec(line);
    if (m) { key = m[1].trim(); fields[key] = m[2]; continue }
    if (key && line.trim()) fields[key] += '\n' + line;
  }
  for (const k of Object.keys(fields)) {
    fields[k] = fields[k].replace(/<!--[\s\S]*?-->/g, '').trim();
  }
  return fields;
}

/**
 * 用页面原文修掉 SMW 值里被替换成占位符的卷正文。
 *
 * @param {Array} wikiBooks parseWikiAsk 的结果（会被就地修改）
 * @param {Map<string, object>} rawFieldsByTitle 书名 → parseWikiBookTemplate 的结果
 * @returns {number} 修好的卷数
 */
function applyRawVolumeContent(wikiBooks, rawFieldsByTitle) {
  let patched = 0;
  for (const book of wikiBooks || []) {
    const fields = rawFieldsByTitle && rawFieldsByTitle.get(book.title);
    if (!fields) continue;
    for (const vol of book.volumes) {
      const raw = fields[`卷${vol.volume_no}内容`];
      if (!raw) continue;
      const images = [];
      vol.content = cleanWikiText(raw, { bookName: book.title, images });
      vol.images = images;
      patched++;
    }
  }
  return patched;
}

/**
 * 合并成可落库的书籍结构。
 *
 * @param {object} args
 * @param {object|null} args.wiki    parseWikiAsk 的一条
 * @param {object|null} args.mihoyo  { name, contentId, icon, categories, sourceTypes, volumes }
 * @param {string} [args.wikiCoverUrl]  wiki 的 File:<书名>.png 地址（优先）
 */
function buildBookPayload({ wiki, mihoyo, wikiCoverUrl }) {
  const name = displayName((wiki && wiki.name_zh) || (mihoyo && mihoyo.name) || '');
  if (!name) return null;

  const mihoyoVolumes = (mihoyo && mihoyo.volumes) || [];
  const wikiVolumes = (wiki && wiki.volumes) || [];

  let volumes;
  let matchedFromMihoyo = 0;
  let fakeBodies = 0;
  let imagesFromWiki = 0;
  if (wikiVolumes.length > 0) {
    volumes = matchVolumes(wikiVolumes, mihoyoVolumes, name).map(({ wiki: w, mihoyo: m }) => {
      // 观测枢拿描述冒充正文时以 wiki 为准：卷描述两边都有，是最可靠的判据
      // （观测枢的空壳卷连自己的描述都没有，只有 wiki 侧能识别出来）
      const mihoyoBody = (m && m.content) || '';
      const fake = !!mihoyoBody && isFakeBody(mihoyoBody, w.description_zh || (m && m.description) || '');
      if (fake) fakeBodies++;
      // 插图只有 wiki 有（观测枢的正文里没有任何 <img>）。wiki 正文带插图时以 wiki 为准，
      // 否则《出发吧！嘟嘟可》这类绘本会被"更干净的"观测枢正文顶掉、三张插图全丢。
      const wikiHasImages = (w.images || []).length > 0;
      if (wikiHasImages) imagesFromWiki++;
      const useMihoyoBody = !!mihoyoBody && !fake && !wikiHasImages;
      if (useMihoyoBody) matchedFromMihoyo++;
      return {
        volume_no: w.volume_no,
        title_zh: w.title_zh || (m && m.name) || `卷${w.volume_no}`,
        description_zh: w.description_zh || (m && m.description) || '',
        content: useMihoyoBody ? mihoyoBody : (w.content || ''),
        source: w.source || (m && m.source) || '',
        author: (m && m.author) || '',
        content_source: useMihoyoBody ? 'mihoyo' : (w.content ? 'biligame' : ''),
        images: w.images || [],
      };
    });
  } else {
    // 仅观测枢收录的书：卷序按观测枢自身的呈现顺序补
    volumes = mihoyoVolumes.map((m, i) => ({
      volume_no: volumeIndexFromText(m.name) || i + 1,
      title_zh: m.name || `卷${i + 1}`,
      description_zh: m.description || '',
      content: m.content || '',
      source: m.source || '',
      author: m.author || '',
      content_source: m.content ? 'mihoyo' : '',
      images: [],
    }));
    volumes.sort((a, b) => a.volume_no - b.volume_no);
    volumes.forEach((v, i) => { v.volume_no = i + 1; });
    matchedFromMihoyo = volumes.filter(v => v.content_source === 'mihoyo').length;
    fakeBodies = volumes.filter(v => v.content_source === '' && v.description_zh && v.content === '').length;
  }

  const sources = [];
  for (const v of volumes) if (v.source) sources.push(v.source);

  // 正文里出现的插图（去重；卷之间可能引用同一张）
  const images = [];
  for (const v of volumes) {
    for (const img of v.images || []) {
      if (!images.some(x => x.key === img.key)) images.push({ ...img });
    }
  }

  const imageUrl = wikiCoverUrl || (mihoyo && mihoyo.icon) || '';
  const altUrl = wikiCoverUrl ? ((mihoyo && mihoyo.icon) || '') : '';

  return {
    name_zh: name,
    name_en: '',
    rarity: (wiki && wiki.rarity != null ? wiki.rarity : (mihoyo && mihoyo.star != null ? mihoyo.star : 0)) || 0,
    genre: (wiki && wiki.genres || []).join('、'),
    country: (wiki && wiki.countries) || '',
    version: normalizeVersions((wiki && wiki.versions) || []),
    source: joinUnique(sources),
    source_type: ((mihoyo && mihoyo.sourceTypes) || []).join('、'),
    description_zh: joinUnique(volumes.map(v => v.description_zh)),
    author: cleanAuthor(joinUnique(volumes.map(v => v.author))),
    related_chars: (wiki && wiki.related_chars) || '',
    illustrated: wiki && wiki.illustrated ? 1 : 0,
    wiki_title: (wiki && wiki.title) || '',
    mihoyo_id: (mihoyo && mihoyo.contentId) || null,
    volume_count: volumes.length,
    image: imageUrl ? `${bookImageKey(name)}.png` : '',
    image_url: imageUrl,
    image_alt_url: altUrl,
    image_source: wikiCoverUrl ? 'biligame' : (mihoyo && mihoyo.icon ? 'mihoyo' : ''),
    volumes,
    images,
    debug: {
      wiki: !!wiki,
      mihoyo: !!mihoyo,
      mihoyo_volume_count: mihoyoVolumes.length,
      body_from_mihoyo: matchedFromMihoyo,
      body_from_wiki: volumes.filter(v => v.content_source === 'biligame').length,
      body_missing: volumes.filter(v => !v.content).length,
      fake_bodies: fakeBodies,
      images: images.length,
      images_from_wiki: imagesFromWiki,
    },
  };
}

/**
 * 频道页「书籍类型」分组（观测枢自有的分类体系），与 wiki 的体裁并存。
 * 目前只在查漏弹窗里作为提示展示，不写入库，避免两套体裁概念混淆。
 */
function summarizeMihoyoCategories(mihoyoBooks) {
  const counter = new Map();
  for (const m of mihoyoBooks) {
    for (const c of m.categories || []) counter.set(c, (counter.get(c) || 0) + 1);
  }
  return [...counter.entries()].sort((a, b) => b[1] - a[1]);
}

module.exports = {
  // 归一化
  matchKey,
  displayName,
  parseRarity,
  mapCountries,
  normalizeVersions,
  compareVersion,
  COUNTRY_NAMES,
  // 文本
  cleanWikiText,
  cleanMihoyoHtml,
  isFakeBody,
  textFingerprint,
  // 卷序
  chineseNumber,
  volumeIndexFromText,
  tailKey,
  volumeSuffix,
  // 解析
  parseWikiAsk,
  parseMihoyoList,
  parseMihoyoEntry,
  pairMihoyoVolumes,
  stripLeadingVolumeNumber,
  // 合并
  matchBooks,
  matchVolumes,
  buildBookPayload,
  bookImageKey,
  contentImageKey,
  CONTENT_IMAGE_RE,
  parseWikiBookTemplate,
  applyRawVolumeContent,
  joinUnique,
  cleanAuthor,
  EMPTY_FIELD_RE,
  summarizeMihoyoCategories,
};

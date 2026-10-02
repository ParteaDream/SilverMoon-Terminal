#!/usr/bin/env electron
/**
 * 食物爬虫后端回归测试 —— crawl-food / crawl-foods / check-missing-foods
 *
 * 覆盖：
 *   · nanoka item_all 按「奇怪的 / 普通 / 美味的」三形态合并为一条（287 组三形态）
 *   · 烹饪材料与数量来自 bilibili wiki 的「所需食材」字段，能落到 materials 的 nanoka ID
 *   · bilibili wiki 没有配方时回退米游社观测枢
 *   · 查漏接口返回完整线上目录（含 hasVariants 标记）
 *   · foods / food_variants / food_materials 三张表在建库时自动补齐，且能接受爬取结果
 *
 * 需要联网（static.nanoka.cc / wiki.biligame.com / api-static.mihoyo.com）。
 * Run:
 *   env -u ELECTRON_RUN_AS_NODE electron scripts/test-food-crawl.cjs
 */
const { app } = require('electron')
// 无头/沙箱环境（CI、容器）下 GPU 与 renderer 沙箱会直接崩掉，先关掉
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-gpu-compositing')
app.commandLine.appendSwitch('disable-software-rasterizer')
app.commandLine.appendSwitch('in-process-gpu')
const fs = require('fs')
const os = require('os')
const path = require('path')
// 磁盘安全：见 scripts/lib/sandbox.cjs 顶部的事故说明
const { installCleanupHook, sweepLeftovers } = require('./lib/sandbox.cjs')
sweepLeftovers(['silvermoon-food-test-'])   // 异常信号（SIGTRAP/SIGKILL）会绕过退出钩子，只能靠下次启动自愈

const PROJECT_ROOT = path.resolve(__dirname, '..')
const REAL_DATA = '/Users/stargomia/Files/GenshinWikiData'
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'silvermoon-food-test-'))
const profileDir = path.join(tmpRoot, 'profile')
const dataDir = path.join(tmpRoot, 'data')
fs.mkdirSync(profileDir, { recursive: true })
fs.mkdirSync(dataDir, { recursive: true })
// 隔离副本：不触碰用户真实数据
for (const f of ['silvermoon_terminal.db', 'user.db', 'user.json']) {
  const src = path.join(REAL_DATA, f)
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dataDir, f))
}
fs.writeFileSync(path.join(profileDir, 'config.json'),
  JSON.stringify({ dbDir: dataDir, activeBaseDb: 'silvermoon_terminal.db' }, null, 2))
app.setPath('userData', profileDir)
Object.defineProperty(app, 'isPackaged', { value: true, configurable: true })
process.env.SILVERMOON_DISABLE_DEVTOOLS = '1'

let finished = false
function cleanup() { try { fs.rmSync(tmpRoot, { recursive: true, force: true }) } catch (_) {} }
installCleanupHook(cleanup)   // ⚠️ app.exit() 不触发 'exit'，清理必须靠劫持（见 lib/sandbox.cjs）
function finish(payload, code) {
  if (finished) return
  finished = true
  try { fs.writeSync(1, `\n===FOOD-CRAWL===\n${JSON.stringify(payload, null, 2)}\n`) } catch (_) {}
  process.exitCode = code
  setTimeout(() => { try { app.exit(code) } catch (_) { process.exit(code) } }, 200)
}

// 期望值取自 nanoka 7.1.51 + bilibili wiki 实测
const CASES = [
  {
    name: '黄金蟹', id: 108102,
    expectVariants: ['normal', 'weird', 'tasty'],
    expectRarity: 4,
    expectMaterials: { 鸟蛋: '5', 面粉: '5', 螃蟹: '4', 盐: '2' },
    note: 'bilibili wiki 有完整配方',
  },
  {
    name: '提瓦特煎蛋', id: 108005,
    expectVariants: ['normal', 'weird', 'tasty'],
    expectRarity: 1,
    expectMaterials: { 鸟蛋: '1' },
    note: '单材料配方',
  },
  {
    name: '满足沙拉', id: 108029,
    expectVariants: ['normal', 'weird', 'tasty'],
    expectRarity: 2,
    expectMaterials: { 卷心菜: '2', 苹果: '2', 鸟蛋: '1', 土豆: '1' },
    note: '多材料配方',
  },
  {
    name: '苹果酿', id: 108151,
    expectVariants: ['normal'],
    expectMaterials: null,          // 不可烹饪的饮品，配方为「无」
    note: '单形态饮品：wiki 无配方时回退观测枢',
  },
  {
    name: '「蒙德往事」', id: 108058,
    expectVariants: ['normal'],
    expectMaterials: null,
    note: '特殊料理（名称带官方书名号）',
  },
  {
    name: '摩拉肉', id: 108093,
    expectVariants: ['normal', 'weird', 'tasty'],
    expectMaterials: { 兽肉: '1', 面粉: '1' },
    // 基础菜身上的「特殊料理角色」是料理原型关联的锚点（见 src/utils/dishLinks.js）：
    // 缺这一项就查不出凝光的「乾坤摩拉肉」是从它变来的，查漏补缺会把这道菜列为「缺料理原型」候选
    expectSpecial: { char: '凝光', dish: '乾坤摩拉肉' },
    note: '基础菜：带回特殊料理关联字段',
  },
]

let started = false
app.on('browser-window-created', (_e, win) => {
  if (started) return
  win.webContents.once('did-finish-load', async () => {
    if (started) return
    started = true
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    const js = code => win.webContents.executeJavaScript(code, true)
    const results = []
    const extra = {}

    try {
      // ── 0. 表结构 ──
      const tbl = await js(`window.electronAPI.dbQuery("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('foods','food_variants','food_materials')")`)
      const tables = (tbl.data || []).map(r => r.name).sort()
      extra.tables = tables
      if (tables.length !== 3) {
        finish({ ok: false, error: `foods/food_variants/food_materials 表缺失: ${JSON.stringify(tables)}` }, 1)
        return
      }

      // ── 1. 单条爬取 ──
      for (const c of CASES) {
        let res
        try {
          res = await js(`window.electronAPI.crawlFood(${JSON.stringify(c.name)}, { foodId: ${c.id} })`)
        } catch (e) {
          results.push({ name: c.name, pass: false, problems: [`IPC 异常: ${e.message}`] })
          continue
        }
        const problems = []
        if (!res || !res.success) {
          problems.push(`爬取失败: ${(res && res.error) || '未知错误'}`)
        } else {
          const d = res.data
          const kinds = (d.variants || []).map(v => v.kind).sort()
          const expectKinds = [...c.expectVariants].sort()
          if (JSON.stringify(kinds) !== JSON.stringify(expectKinds)) {
            problems.push(`形态 ${JSON.stringify(kinds)} ≠ ${JSON.stringify(expectKinds)}`)
          }
          if (Number(d.id) !== c.id) problems.push(`id ${d.id} ≠ ${c.id}`)
          if (!d.name_zh) problems.push('name_zh 为空')
          if (!d.image) problems.push('缺少图片文件名')
          if (!d.description_zh) problems.push('缺少简介')
          if (c.expectRarity != null && Number(d.rarity) !== c.expectRarity) {
            problems.push(`rarity ${d.rarity} ≠ ${c.expectRarity}`)
          }
          // 每个形态都要有名称与简介（UI 靠它们做区分）
          for (const v of d.variants || []) {
            if (!v.name_zh) problems.push(`形态 ${v.kind} 缺名称`)
            if (!v.description_zh) problems.push(`形态 ${v.kind} 缺简介`)
          }
          if (c.expectMaterials) {
            const got = {}
            for (const m of d.materials || []) got[m.material_name] = String(m.quantity)
            for (const [k, v] of Object.entries(c.expectMaterials)) {
              if (got[k] !== v) problems.push(`材料 ${k} 数量 ${JSON.stringify(got[k])} ≠ ${JSON.stringify(v)}`)
            }
            // 材料必须带 nanoka 侧 ID 与图标，否则写不进 materials 表
            for (const m of d.materials || []) {
              if (!m.material_id) problems.push(`材料 ${m.material_name} 缺 material_id`)
              if (!m.icon) problems.push(`材料 ${m.material_name} 缺 icon`)
            }
          }
          if ((d.missing_ingredients || []).length > 0) {
            problems.push(`未匹配材料: ${d.missing_ingredients.join('、')}`)
          }
          if (c.expectSpecial) {
            if (String(d.special_char || '') !== c.expectSpecial.char) {
              problems.push(`special_char ${JSON.stringify(d.special_char)} ≠ ${JSON.stringify(c.expectSpecial.char)}`)
            }
            if (String(d.specialty || '') !== c.expectSpecial.dish) {
              problems.push(`specialty ${JSON.stringify(d.specialty)} ≠ ${JSON.stringify(c.expectSpecial.dish)}`)
            }
          }
        }
        results.push({
          name: c.name, id: c.id, note: c.note, pass: problems.length === 0, problems,
          got: res && res.success ? {
            variants: (res.data.variants || []).map(v => `${v.kind}:${v.name_zh}`),
            materials: (res.data.materials || []).map(m => `${m.material_name}x${m.quantity}`),
            source: res.data.materials_source,
          } : null,
        })
        await sleep(200)
      }

      // ── 2. 批量爬取 ──
      try {
        const batch = await js(`window.electronAPI.crawlFoods(${JSON.stringify([
          { id: 108102, name: '黄金蟹' }, { id: 108005, name: '提瓦特煎蛋' },
        ])})`)
        const okCount = batch && batch.success ? batch.results.filter(r => r.success).length : 0
        results.push({
          name: 'crawlFoods 批量', pass: okCount === 2,
          problems: okCount === 2 ? [] : [`成功 ${okCount}/2`, (batch && batch.error) || ''],
        })
      } catch (e) {
        results.push({ name: 'crawlFoods 批量', pass: false, problems: [e.message] })
      }

      // ── 3. 查漏目录 ──
      try {
        const miss = await js(`window.electronAPI.checkMissingFoods()`)
        const problems = []
        if (!miss || !miss.success) problems.push((miss && miss.error) || '接口失败')
        else {
          if (!(miss.total > 400)) problems.push(`total=${miss.total} 偏少`)
          const threeVar = Object.values(miss.names || {}).filter(n => n.hasVariants).length
          extra.onlineTotal = miss.total
          extra.onlineWithVariants = threeVar
          extra.version = miss.version
          if (!(threeVar > 250)) problems.push(`三形态条目仅 ${threeVar}，预期 280+`)
          const sample = miss.names[108102]
          if (!sample || sample.zh !== '黄金蟹') problems.push(`names[108102] = ${JSON.stringify(sample)}`)
          if (sample && !sample.hasVariants) problems.push('names[108102].hasVariants 应为 true')
        }
        results.push({ name: 'checkMissingFoods', pass: problems.length === 0, problems })
      } catch (e) {
        results.push({ name: 'checkMissingFoods', pass: false, problems: [e.message] })
      }

      // ── 4. 写库：三张表能否接受爬取结果（模拟 saveFoodData 的 SQL）──
      try {
        const crawl = await js(`window.electronAPI.crawlFood('黄金蟹', { foodId: 108102 })`)
        const d = crawl.data
        const q = (sql, params) => js(`window.electronAPI.dbQuery(${JSON.stringify(sql)}, ${JSON.stringify(params || [])})`)
        const TMP_ID = 990001
        await q('DELETE FROM food_variants WHERE food_id = ?', [TMP_ID])
        await q('DELETE FROM food_materials WHERE food_id = ?', [TMP_ID])
        await q('DELETE FROM foods WHERE id = ?', [TMP_ID])
        await q(
          `INSERT INTO foods (id, name_zh, name_en, rarity, type, category, region, description_zh, effect,
             source, image, has_variants, recipe_source, recipe_price, special_char, specialty, wiki_title)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [TMP_ID, d.name_zh, d.name_en, d.rarity, d.type, d.category, d.region, d.description_zh, d.effect,
            d.source, d.image, d.has_variants, d.recipe_source, d.recipe_price, d.special_char, d.specialty, d.wiki_title]
        )
        for (const v of d.variants) {
          await q(
            `INSERT OR REPLACE INTO food_variants (food_id, kind, item_id, name_zh, name_en, description_zh, effect, image, rarity)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [TMP_ID, v.kind, v.item_id, v.name_zh, v.name_en, v.description_zh, v.effect, v.image, v.rarity]
          )
        }
        for (const m of d.materials) {
          await q(
            `INSERT OR IGNORE INTO materials (id, name_zh, name_en, type, rarity, description_zh, source, image)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [m.material_id, m.material_name, m.material_name_en, m.material_type, m.rarity, m.description, m.source, m.image]
          )
          await q('INSERT OR REPLACE INTO food_materials (food_id, material_id, quantity) VALUES (?, ?, ?)',
            [TMP_ID, m.material_id, m.quantity])
        }
        const verify = await js(`window.electronAPI.dbQuery("SELECT (SELECT COUNT(*) FROM food_variants WHERE food_id = ${TMP_ID}) AS v, (SELECT COUNT(*) FROM food_materials WHERE food_id = ${TMP_ID}) AS m")`)
        const row = (verify.data || [])[0] || {}
        const problems = []
        if (Number(row.v) !== d.variants.length) problems.push(`写入形态 ${row.v} ≠ ${d.variants.length}`)
        if (Number(row.m) !== d.materials.length) problems.push(`写入材料 ${row.m} ≠ ${d.materials.length}`)
        // 清理
        await q('DELETE FROM food_variants WHERE food_id = ?', [TMP_ID])
        await q('DELETE FROM food_materials WHERE food_id = ?', [TMP_ID])
        await q('DELETE FROM foods WHERE id = ?', [TMP_ID])
        results.push({ name: '写库 SQL 往返', pass: problems.length === 0, problems })
      } catch (e) {
        results.push({ name: '写库 SQL 往返', pass: false, problems: [e.message] })
      }

      // ── 4.5 观测枢兜底路径 ──
      // bilibili wiki 拿不到时（网络故障或页面缺失）必须能靠观测枢补齐配方；
      // 观测枢的食材是带 data-entry-* 的 span，剥标签会连成一串，所以专门盯一次。
      try {
        const mres = await js(`window.electronAPI.crawlFood('黄金蟹', { foodId: 108102, source: 'mihoyo' })`)
        const problems = []
        if (!mres || !mres.success) {
          problems.push((mres && mres.error) || '观测枢爬取失败')
        } else {
          const d = mres.data
          if (d.materials_source !== 'mihoyo') problems.push(`materials_source = ${d.materials_source}`)
          const got = {}
          for (const m of d.materials) got[m.material_name] = String(m.quantity)
          for (const [k, v] of Object.entries({ 鸟蛋: '5', 面粉: '5', 螃蟹: '4', 盐: '2' })) {
            if (got[k] !== v) problems.push(`材料 ${k} 数量 ${JSON.stringify(got[k])} ≠ ${JSON.stringify(v)}`)
          }
          if ((d.missing_ingredients || []).length) problems.push(`未匹配: ${d.missing_ingredients.join('、')}`)
          // 观测枢也能给出三形态各自的文案
          const tasty = (d.variants || []).find(v => v.kind === 'tasty')
          if (!tasty || !tasty.description_zh) problems.push('观测枢未给出「美味的」形态简介')
        }
        results.push({ name: '观测枢兜底（source=mihoyo）', pass: problems.length === 0, problems })
      } catch (e) {
        results.push({ name: '观测枢兜底（source=mihoyo）', pass: false, problems: [e.message] })
      }

      // ── 4.6 图片落盘：新下载按真实格式命名，已存在的文件绝不被改名/删除 ──
      try {
        const problems = []
        const probe = await js(`(async () => {
          const fs = null
          // 1) 真实下载一个不在图包里的图标 → 应当按内容落成 .webp
          const fresh = await window.electronAPI.downloadFoodImages(['UI_ItemIcon_108102'])
          const freshName = (fresh.files || {})['UI_ItemIcon_108102'] || ''
          // 2) 再来一次：文件已存在，不能改名、不能删除
          const again = await window.electronAPI.downloadFoodImages(['UI_ItemIcon_108102'])
          const againName = (again.files || {})['UI_ItemIcon_108102'] || ''
          return { freshName, againName, freshSkipped: fresh.skipped, againSkipped: again.skipped }
        })()`)
        if (!/\.webp$/i.test(probe.freshName)) problems.push(`新下载未按真实格式命名: ${probe.freshName}`)
        if (probe.againName !== probe.freshName) problems.push(`重复下载改名了: ${probe.againName} ≠ ${probe.freshName}`)
        if (!(probe.againSkipped >= 1)) problems.push('重复下载未命中已存在文件')
        // 3) 图包里同时有 X.png(真实 webp) 与 X.webp 时，必须两份都还在
        const coexist = await js(`(async () => {
          const r = await window.electronAPI.downloadFoodImages(['UI_ItemIcon_100001'])
          return { name: (r.files || {})['UI_ItemIcon_100001'] || '', total: r.total }
        })()`)
        if (!coexist.name) problems.push('已存在图标未返回文件名')
        results.push({ name: '图片落盘（格式 / 幂等 / 不删文件）', pass: problems.length === 0, problems, detail: { ...probe, coexist } })
      } catch (e) {
        results.push({ name: '图片落盘（格式 / 幂等 / 不删文件）', pass: false, problems: [e.message] })
      }

      // ── 5. 双库模式（非开发者模式）写入路径 ──
      // 非 dev 模式下 INSERT 会先落到 user.db 的真实表；若 user.db 里没有 foods
      // 存根表（ensureUserDbSchema），写入会静默失败 —— 这一步专门盯住它。
      try {
        const problems = []
        await js(`window.electronAPI.setDevMode(false)`)
        await sleep(400)
        const q = (sql, params) => js(`window.electronAPI.dbQuery(${JSON.stringify(sql)}, ${JSON.stringify(params || [])})`)
        await q('DELETE FROM food_variants WHERE food_id = ?', [990002])
        await q('DELETE FROM foods WHERE id = ?', [990002])
        const ins = await q(
          `INSERT INTO foods (id, name_zh, name_en, rarity, type, image, has_variants)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [990002, '双库写入测试', 'DualDb Probe', 1, 'ingredient', 'UI_ItemIcon_100001.png', 0]
        )
        if (ins && ins.error) problems.push('INSERT 报错: ' + ins.error)
        const read = await q('SELECT name_zh, has_variants FROM foods WHERE id = ?', [990002])
        const row = (read.data || [])[0]
        if (!row) problems.push('写入后读不到（user.db 缺 foods 存根表或 delta 合并失败）')
        else if (row.name_zh !== '双库写入测试') problems.push(`name_zh = ${JSON.stringify(row.name_zh)}`)
        const varIns = await q(
          `INSERT OR REPLACE INTO food_variants (food_id, kind, item_id, name_zh, description_zh, effect, image, rarity)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [990002, 'normal', 990002, '双库写入测试', 'd', 'e', 'UI_ItemIcon_100001.png', 1]
        )
        if (varIns && varIns.error) problems.push('food_variants INSERT 报错: ' + varIns.error)
        const matIns = await q(
          'INSERT OR REPLACE INTO food_materials (food_id, material_id, quantity) VALUES (?, ?, ?)',
          [990002, 100001, '3']
        )
        if (matIns && matIns.error) problems.push('food_materials INSERT 报错: ' + matIns.error)
        // 注意：不能查 COUNT(*) —— 双库模式只按 row_id 合并字段级 delta，
        // 聚合列不会把 user.db 新插入的行算进去（这也是食物页改用两张关联表
        // 分别统计、不用 SQL 聚合的原因）。这里直接查行本身。
        const childRead = await q('SELECT food_id, kind, name_zh FROM food_variants WHERE food_id = ?', [990002])
        const hit = (childRead.data || []).find(r => Number(r.food_id) === 990002 && r.kind === 'normal')
        if (!hit) problems.push('user.db 的 food_variants 未生效')
        const matRead = await q('SELECT food_id, material_id, quantity FROM food_materials WHERE food_id = ?', [990002])
        const matHit = (matRead.data || []).find(r => Number(r.food_id) === 990002 && Number(r.material_id) === 100001)
        if (!matHit) problems.push('user.db 的 food_materials 未生效')
        else if (String(matHit.quantity) !== '3') problems.push(`quantity = ${JSON.stringify(matHit.quantity)}`)

        // 食物页的列表口径：SELECT * FROM foods + 分别统计两张关联表
        const listRead = await q('SELECT * FROM foods')
        const listRow = (listRead.data || []).find(r => Number(r.id) === 990002)
        if (!listRow) problems.push('SELECT * FROM foods 读不到 user.db 新插入的条目')
        const allVar = await q('SELECT food_id FROM food_variants')
        const cnt = (allVar.data || []).filter(r => Number(r.food_id) === 990002).length
        if (cnt < 1) problems.push('食物页口径下 variant_count 仍为 0')
        // 清理 + 恢复开发者模式
        await q('DELETE FROM food_variants WHERE food_id = ?', [990002])
        await q('DELETE FROM food_materials WHERE food_id = ?', [990002])
        await q('DELETE FROM foods WHERE id = ?', [990002])
        await js(`window.electronAPI.setDevMode(true)`)
        await sleep(300)
        results.push({ name: '双库模式（非 dev）写入', pass: problems.length === 0, problems })
      } catch (e) {
        results.push({ name: '双库模式（非 dev）写入', pass: false, problems: [e.message] })
      }

      const failed = results.filter(r => !r.pass).length
      finish({ ok: failed === 0, failed, extra, results }, failed === 0 ? 0 : 1)
    } catch (e) {
      finish({ ok: false, error: e.message, extra, results }, 1)
    }
  })
})
setTimeout(() => finish({ ok: false, error: 'watchdog 300s' }, 1), 300000)
require(path.join(PROJECT_ROOT, 'electron', 'main.js'))

import assert from 'node:assert/strict'
import fs from 'node:fs'

// 与本仓库其它无依赖模块测试一致：直接从源码加载，不经过打包
async function loadModule(rel) {
  const source = fs.readFileSync(new URL(rel, import.meta.url), 'utf8')
  const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
  return import(url)
}

const { createImageQueue } = await loadModule('../src/utils/imageQueue.js')
const { selectPendingLoads, locate } = await loadModule('../src/utils/lazyViewport.js')

let failures = 0
function test(name, fn) {
  try {
    fn()
    console.log(`  ✓ ${name}`)
  } catch (e) {
    failures++
    console.log(`  ✗ ${name}\n      ${e.message}`)
  }
}
async function testAsync(name, fn) {
  try {
    await fn()
    console.log(`  ✓ ${name}`)
  } catch (e) {
    failures++
    console.log(`  ✗ ${name}\n      ${e.message}`)
  }
}

// ── 可控 fetch：记录派发顺序，手动放行 ──
function makeQueue(opts = {}) {
  const calls = []
  const waiters = []
  const queue = createImageQueue({
    maxConcurrent: opts.maxConcurrent || 1,
    cacheMax: opts.cacheMax || 10,
    fetchImage: (filename, maxWidth) => {
      calls.push({ filename, maxWidth })
      return new Promise(resolve => waiters.push({ filename, resolve }))
    },
  })
  const ctx = { queue, calls, waiters }
  ctx.settle = () => {
    const w = waiters.shift()
    if (!w) return false
    w.resolve(`data:${w.filename}`)
    return true
  }
  return ctx
}
const tick = () => new Promise(r => setTimeout(r, 0))

// 逐拍放行在途请求，直到给定 Promise 全部结束（模拟队列自然排空）
async function settleAll(ctx, promises) {
  let done = 0
  for (const p of promises) Promise.resolve(p).then(() => { done++ })
  for (let i = 0; i < 500 && done < promises.length; i++) {
    await tick()
    if (ctx.waiters.length) ctx.settle()
  }
  assert.equal(done, promises.length, `仍有 ${promises.length - done} 个请求未结束（可能死锁）`)
}

console.log('imageQueue：可视区请求优先于预加载带')
await testAsync('同一同步批次内，high 请求先于 normal 派发（DOM 顺序 vs 视口优先级）', async () => {
  const ctx = makeQueue({ maxConcurrent: 2 })
  // 旧实现按「发现顺序」派发：预加载带里、文档更靠前的图片先发请求
  const all = [
    ctx.queue.read('band-1.webp', 256, 'normal'),
    ctx.queue.read('band-2.webp', 256, 'normal'),
    ctx.queue.read('band-3.webp', 256, 'normal'),
    ctx.queue.read('band-4.webp', 256, 'normal'),
    ctx.queue.read('visible-1.webp', 256, 'high'),
    ctx.queue.read('visible-2.webp', 256, 'high'),
  ]
  await settleAll(ctx, all)
  assert.deepEqual(ctx.calls.map(c => c.filename), [
    'visible-1.webp', 'visible-2.webp',    // 可视区优先
    'band-1.webp', 'band-2.webp',          // 预加载带按发起顺序
    'band-3.webp', 'band-4.webp',
  ], `派发顺序不符：${ctx.calls.map(c => c.filename).join(', ')}`)
})

await testAsync('并发位被占满时，新的可视区请求也优先于排队的预加载请求', async () => {
  const ctx = makeQueue({ maxConcurrent: 1 })
  const order = []
  const all = [
    ctx.queue.read('in-flight.webp', 256, 'normal').then(() => order.push('in-flight')),
    ctx.queue.read('queued-b.webp', 256, 'normal').then(() => order.push('queued-b')),
    ctx.queue.read('queued-c.webp', 256, 'normal').then(() => order.push('queued-c')),
  ]
  await tick()
  assert.deepEqual(ctx.calls.map(c => c.filename), ['in-flight.webp'], '并发位应已被首个请求占用')
  all.push(ctx.queue.read('visible.webp', 256, 'high').then(() => order.push('visible')))
  await settleAll(ctx, all)
  assert.deepEqual(ctx.calls.map(c => c.filename), ['in-flight.webp', 'visible.webp', 'queued-b.webp', 'queued-c.webp'])
})

await testAsync('排队中的请求滚入视口 → 提前，且不重复取图', async () => {
  const ctx = makeQueue({ maxConcurrent: 1 })
  const a = ctx.queue.read('in-flight.webp', 256, 'normal')
  await tick()                       // 让首个请求真正派发（占住唯一并发位）
  assert.deepEqual(ctx.calls.map(c => c.filename), ['in-flight.webp'])
  const b = ctx.queue.read('queued-b.webp', 256, 'normal')
  const c = ctx.queue.read('queued-c.webp', 256, 'normal')
  // 元素滚入可视区：再次 read 同一张图（同一 key）→ 应提升而不是排到队尾
  ctx.queue.read('queued-c.webp', 256, 'high')
  await settleAll(ctx, [a, b, c])
  assert.deepEqual(ctx.calls.map(c2 => c2.filename), ['in-flight.webp', 'queued-c.webp', 'queued-b.webp'])
  assert.equal(ctx.calls.filter(c2 => c2.filename === 'queued-c.webp').length, 1, '提升后不应重复发起 IPC')
})

await testAsync('同一 key 并发请求只取一次图，且都能拿到结果', async () => {
  const ctx = makeQueue({ maxConcurrent: 4 })
  const p1 = ctx.queue.read('dup.webp', 256, 'normal')
  const p2 = ctx.queue.read('dup.webp', 256, 'high')
  await settleAll(ctx, [p1, p2])
  assert.equal(ctx.calls.length, 1)
  assert.equal(await p1, 'data:dup.webp')
  assert.equal(await p2, 'data:dup.webp')
})

await testAsync('已取过的图命中缓存，不再发起请求', async () => {
  const ctx = makeQueue({ maxConcurrent: 4 })
  const p1 = ctx.queue.read('cached.webp', 256, 'normal')
  await settleAll(ctx, [p1])
  assert.equal(await p1, 'data:cached.webp')
  assert.equal(await ctx.queue.read('cached.webp', 256, 'high'), 'data:cached.webp')
  assert.equal(ctx.calls.length, 1)
})

await testAsync('取图失败 resolve null，且允许重试', async () => {
  const calls = []
  const queue = createImageQueue({
    maxConcurrent: 2,
    fetchImage: (filename) => { calls.push(filename); return Promise.resolve(null) },
  })
  assert.equal(await queue.read('missing.webp', 256, 'normal'), null)
  assert.equal(await queue.read('missing.webp', 256, 'normal'), null)
  assert.equal(calls.length, 2, '失败不应写缓存，重试应重新发起')
})

console.log('lazyViewport：视口优先 + 跳过不可渲染元素')
test('locate：0×0 元素判为 unrendered（display:none 子树）', () => {
  const view = { top: 0, height: 900 }
  assert.equal(locate({ top: 0, bottom: 0, w: 0, h: 0 }, view), 'unrendered')
  assert.equal(locate({ top: 5000, bottom: 5100, w: 80, h: 100 }, view), 'none')
  assert.equal(locate({ top: 100, bottom: 200, w: 80, h: 100 }, view), 'viewport')
  assert.equal(locate({ top: -700, bottom: -600, w: 80, h: 100 }, view), 'band')   // 视口上方 800px 内
  assert.equal(locate({ top: 1500, bottom: 1600, w: 80, h: 100 }, view), 'band')   // 视口下方 800px 内
  assert.equal(locate({ top: -900, bottom: -800, w: 80, h: 100 }, view), 'none')   // 带外
})

test('可视区元素排在最前，且不受 DOM 顺序影响（用户报告的场景）', () => {
  // 页面从上到下：隐藏的折叠内容(0×0) → 视口上方的预加载带 → 视口内 → 视口下方预加载带
  const records = [
    { top: 0, bottom: 0, w: 0, h: 0, hidden: true, state: 'idle' },            // A 折叠内容里的隐藏缩略图
    { top: 6300, bottom: 6400, w: 80, h: 100, hidden: false, state: 'idle' },  // B 视口上方 600px（预加载带内）
    { top: 6950, bottom: 7050, w: 80, h: 100, hidden: false, state: 'idle' },  // C 骑在视口上沿
    { top: 7100, bottom: 7200, w: 80, h: 100, hidden: false, state: 'idle' },  // D 视口内
    { top: 7400, bottom: 7500, w: 80, h: 100, hidden: false, state: 'idle' },  // E 视口内（靠下）
    { top: 7900, bottom: 8000, w: 80, h: 100, hidden: false, state: 'idle' },  // F 视口下方预加载带
    { top: 9000, bottom: 9100, w: 80, h: 100, hidden: false, state: 'idle' },  // G 带外（不该触发）
  ]
  const view = { top: 7000, height: 500 }   // 可视区 7000..7500
  const { urgent, normal } = selectPendingLoads(records, view)
  assert.deepEqual(urgent.map(r => r.top), [6950, 7100, 7400], '可视区元素应最先加载（含跨上沿的那张）')
  assert.deepEqual(normal.map(r => r.top), [6300, 7900], '预加载带的元素其次，按文档顺序')
  assert.ok(!urgent.concat(normal).includes(records[0]), '0×0 的隐藏元素不得被选中')
  assert.ok(!urgent.concat(normal).includes(records[6]), '预加载带外的元素不得被选中')
})

test('已在队列中、此刻滚入视口的元素进入 promote（提升优先级而不是重新取图）', () => {
  const records = [
    { top: 7100, bottom: 7200, w: 80, h: 100, hidden: false, state: 'requested', urgent: false },  // 视口内
    { top: 7900, bottom: 8000, w: 80, h: 100, hidden: false, state: 'requested', urgent: false },  // 带内（不该提升）
    { top: 6950, bottom: 7050, w: 80, h: 100, hidden: false, state: 'requested', urgent: true },   // 已是高优先级
  ]
  const { promote, urgent, normal } = selectPendingLoads(records, { top: 7000, height: 500 })
  assert.deepEqual(promote, [records[0]])
  assert.deepEqual(urgent, [], '已请求的元素不应重复进入待加载队列')
  assert.deepEqual(normal, [])
})

test('缓存坐标失真时不误加载（content-visibility 记住真实高度后页面变高）', () => {
  // 缓存坐标偏小：粗筛会命中，实时测量显示它其实还在很下面
  const stale = { top: 7500, bottom: 7600, w: 80, h: 100, hidden: false, state: 'idle' }
  const near = { top: 7100, bottom: 7200, w: 80, h: 100, hidden: false, state: 'idle' }
  const view = { top: 7000, height: 500 }
  const verify = rec => (rec === stale
    ? { top: 12000, bottom: 12100, w: 80, h: 100 }
    : { top: rec.top, bottom: rec.bottom, w: rec.w, h: rec.h })
  const { urgent, normal } = selectPendingLoads([stale, near], view, 800, verify)
  assert.deepEqual(urgent, [near], '实时位置在视口内的才加载')
  assert.deepEqual(normal, [], '实时位置已在带外的不得因为缓存坐标而提前取图')
  assert.equal(stale.top, 12000, '实时坐标应回写缓存，供下一帧粗筛')
})

test('实时测量为 0×0（不可渲染）时不加载，也不污染缓存', () => {
  const rec = { top: 7100, bottom: 7200, w: 80, h: 100, hidden: false, state: 'idle' }
  const { urgent, normal } = selectPendingLoads([rec], { top: 7000, height: 500 }, 800,
    () => ({ top: 0, bottom: 0, w: 0, h: 0 }))
  assert.deepEqual(urgent, [])
  assert.deepEqual(normal, [])
  assert.equal(rec.top, 7100, '缓存坐标保持原值')
})

test('旧算法（按 DOM 顺序线性扫描 + 0×0 视为在视口内）会选中隐藏元素 → 本用例可判红', () => {
  // 复刻修复前的扫描：从表头开始，每帧 40 个，rect 落在 ±800 内即加载
  const records = []
  for (let i = 0; i < 60; i++) records.push({ top: 0, bottom: 0, w: 0, h: 0, state: 'idle' })  // 折叠内容(display:none)
  records.push({ top: 7100, bottom: 7200, w: 80, h: 100, state: 'idle' })                       // 可视区内
  const view = { top: 7000, height: 500 }
  const margin = 800
  const oldScan = () => {
    const picked = []
    let checked = 0
    for (const rec of records) {
      if (checked >= 40) break
      checked++
      // 旧实现读的是实时 rect：display:none 元素恒为 0×0，于是被当成「在视口内」
      const r = rec.w === 0 && rec.h === 0
        ? { top: 0, bottom: 0 }
        : { top: rec.top - view.top, bottom: rec.bottom - view.top }
      if (r.bottom > -margin && r.top < view.height + margin) picked.push(rec)
    }
    return picked
  }
  const oldPicked = oldScan()
  assert.equal(oldPicked.length, 40, '旧算法每帧预算 40 全被隐藏元素吃掉')
  assert.ok(!oldPicked.includes(records[60]), '旧算法根本扫不到可视区里的那张图')

  const { urgent } = selectPendingLoads(records, view)
  assert.deepEqual(urgent, [records[60]], '新算法直接命中可视区元素')
})

await testAsync('队列最终清空（无卡死条目）', async () => {
  const ctx = makeQueue({ maxConcurrent: 3 })
  const all = []
  for (let i = 0; i < 8; i++) all.push(ctx.queue.read(`q${i}.webp`, 256, i % 3 === 0 ? 'high' : 'normal'))
  await settleAll(ctx, all)
  const s = ctx.queue.stats()
  assert.equal(s.active, 0, '不应有在途请求')
  assert.equal(s.queued, 0, '不应有滞留队列')
  assert.equal(s.inflight, 0, '不应有未清理的在途记录')
  assert.equal(s.cacheSize, 8, '8 张图都应进入缓存')
})

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)

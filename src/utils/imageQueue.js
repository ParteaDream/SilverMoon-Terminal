/**
 * 图片请求队列 —— 优先级调度 + 在途去重 + 内存缓存。
 *
 * 为什么需要它：渲染进程此前把请求按「发现顺序」FIFO 排队（_MAX_CONCURRENT = 6）。
 * 发现顺序 = DOM 顺序，于是滚动到页面中段后，视口上方预加载带里的图片会排进
 * 可视区图片前面，表现为「图片按页面从上到下依次出现，而不是可视区先出来」。
 *
 * 两条通道：
 *   high   当前可视区内的元素（含滚入视口后从 normal 提升的请求）
 *   normal 预加载带内的元素 / 其它调用方
 * pump 永远先派发 high。已经在排队的 normal 请求可以被 promote 提前，
 * 不需要重新发起一次 IPC（同一 key 复用同一个 Promise）。
 *
 * 纯逻辑模块（fetchImage 注入），可在 Node 中直接测试：见 scripts/test-image-priority.mjs
 */

/**
 * @param {object} opts
 * @param {(filename: string, maxWidth?: number) => Promise<string|null>} opts.fetchImage
 *        实际取图函数，resolve 出 data URL；失败返回 null / reject。
 * @param {number} [opts.maxConcurrent] 最大并发（过高会阻塞主进程导致窗口拖动卡顿）
 * @param {number} [opts.cacheMax] 内存缓存条数上限
 */
export function createImageQueue({ fetchImage, maxConcurrent = 6, cacheMax = 1200 }) {
  const cache = new Map()      // key → data（命中即返回，不重复取图）
  const inflight = new Map()   // key → Promise（在途去重）
  const queued = new Map()     // key → entry（仅排队中的请求，用于提升优先级）
  const lanes = { high: [], normal: [] }
  let active = 0

  const keyOf = (filename, maxWidth) => (maxWidth ? `${filename}::w${maxWidth}` : filename)

  // 取下一个可派发的请求：high 通道优先；normal 通道里已被提升的条目跳过
  function take() {
    for (const lane of [lanes.high, lanes.normal]) {
      while (lane.length > 0) {
        const entry = lane.shift()
        if (entry.state !== 'queued') continue          // 已派发（提升后留下的墓碑）
        if (lane === lanes.normal && entry.high) continue
        entry.state = 'dispatched'
        queued.delete(entry.key)
        return entry
      }
    }
    return null
  }

  function pump() {
    while (active < maxConcurrent) {
      const entry = take()
      if (!entry) return
      active++
      Promise.resolve()
        .then(() => fetchImage(entry.filename, entry.maxWidth))
        .then(data => {
          active--
          if (data) {
            cache.set(entry.key, data)
            if (cache.size > cacheMax) {
              const oldest = cache.keys().next().value
              if (oldest !== undefined) cache.delete(oldest)
            }
          }
          entry.resolve(data || null)
          pump()
        }, () => {
          active--
          entry.resolve(null)
          pump()
        })
    }
  }

  // 派发放到微任务里，让同一个同步批次（一次 effect 重注册、一帧滚动扫描）
  // 的请求先全部入队，pump 才能按优先级挑 —— 否则先入队的低优先级请求会
  // 立刻占满并发位，可视区的请求只能排在它们后面。
  let pumpScheduled = false
  function schedulePump() {
    if (pumpScheduled) return
    pumpScheduled = true
    queueMicrotask(() => { pumpScheduled = false; pump() })
  }

  /** 把排队中的请求提到 high 通道（元素滚入视口时调用） */
  function promote(key) {
    const entry = queued.get(key)
    if (!entry || entry.high) return false
    entry.high = true
    lanes.high.push(entry)
    return true
  }

  function enqueue(entry, high) {
    entry.high = !!high
    entry.state = 'queued'
    queued.set(entry.key, entry)
    lanes[entry.high ? 'high' : 'normal'].push(entry)
    schedulePump()
  }

  /**
   * 取图（唯一对外入口）
   * @param {string} filename
   * @param {number|string} [maxWidth] 尺寸提示
   * @param {'high'|'normal'} [priority] 视口内传 'high'
   * @returns {Promise<string|null>}
   */
  function read(filename, maxWidth, priority) {
    if (!filename) return Promise.resolve(null)
    const key = keyOf(filename, maxWidth)
    const cached = cache.get(key)
    if (cached) return Promise.resolve(cached)
    const pending = inflight.get(key)
    if (pending) {
      if (priority === 'high') promote(key)
      return pending
    }
    const promise = new Promise(resolve => {
      enqueue({ key, filename, maxWidth, resolve }, priority === 'high')
    })
    inflight.set(key, promise)
    promise.then(() => inflight.delete(key), () => inflight.delete(key))
    return promise
  }

  return {
    read,
    /** 供测试/诊断使用 */
    stats: () => ({
      active,
      queued: queued.size,
      highQueued: lanes.high.length,
      normalQueued: lanes.normal.length,
      cacheSize: cache.size,
      inflight: inflight.size,
    }),
  }
}

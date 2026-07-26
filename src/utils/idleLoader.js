/**
 * createIdleQueue — 基于 requestIdleCallback 的空闲加载队列
 *
 * 确保后台任务仅在浏览器空闲时执行，不阻塞用户交互。
 * 支持暂停/恢复、优先级回退（scheduler.postTask → rIC → setTimeout）。
 */

export function createIdleQueue({ timeout = 2000 } = {}) {
  const queue = []
  let running = false
  let paused = false
  let idleHandle = null
  let pendingCount = 0

  function schedule() {
    if (running || paused || queue.length === 0) return
    running = true

    const runNext = () => {
      idleHandle = null
      if (paused || queue.length === 0) {
        running = false
        return
      }
      const task = queue.shift()
      const result = task()

      // 无论 promise 还是同步值，都等完成后调度下一个
      const done = () => {
        pendingCount--
        // 使用 requestIdleCallback 空闲时继续下一个
        if (!paused && queue.length > 0) {
          idleHandle = requestIdleCallback(runNext, { timeout })
        } else {
          running = false
        }
      }

      pendingCount++
      if (result && typeof result.then === 'function') {
        result.then(done, done)
      } else {
        done()
      }
    }

    // 首次调度
    idleHandle = requestIdleCallback(runNext, { timeout })
  }

  /** 添加一个任务到队列尾部（task 可以是同步函数或返回 Promise 的异步函数） */
  function push(task) {
    queue.push(task)
    if (!running && !paused) schedule()
  }

  /** 批量添加多个任务 */
  function pushBatch(tasks) {
    queue.push(...tasks)
    if (!running && !paused) schedule()
  }

  /** 暂停队列（正在执行的任务不受影响） */
  function pause() {
    paused = true
  }

  /** 恢复队列 */
  function resume() {
    if (!paused) return
    paused = false
    if (queue.length > 0 && !running) schedule()
  }

  /** 清空未开始的任务 */
  function clear() {
    queue.length = 0
    if (idleHandle !== null) {
      if (typeof cancelIdleCallback !== 'undefined' && typeof idleHandle === 'number') {
        cancelIdleCallback(idleHandle)
      } else {
        clearTimeout(idleHandle)
      }
      idleHandle = null
    }
    // clear 只能取消尚未开始的任务；Promise 仍在途时必须保留 running，
    // 否则 resume/push 会并发启动第二个任务，抢占缩放帧。
    if (pendingCount === 0) running = false
  }

  /** 当前待处理任务数 */
  function size() {
    return queue.length
  }

  /** 是否完全空闲（队列空且无执行中的任务） */
  function isIdle() {
    return queue.length === 0 && !running
  }

  return { push, pushBatch, pause, resume, clear, size, isIdle }
}

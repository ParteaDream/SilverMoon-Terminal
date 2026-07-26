import assert from 'node:assert/strict'
import fs from 'node:fs'

let nextIdleHandle = 1
const idleCallbacks = new Map()

globalThis.requestIdleCallback = (callback) => {
  const handle = nextIdleHandle
  nextIdleHandle += 1
  idleCallbacks.set(handle, callback)
  queueMicrotask(() => {
    const scheduled = idleCallbacks.get(handle)
    if (!scheduled) return
    idleCallbacks.delete(handle)
    scheduled({ didTimeout: false, timeRemaining: () => 10 })
  })
  return handle
}

globalThis.cancelIdleCallback = (handle) => {
  idleCallbacks.delete(handle)
}

const idleLoaderSource = fs.readFileSync(
  new URL('../src/utils/idleLoader.js', import.meta.url),
  'utf8',
)
const idleLoaderModuleUrl = `data:text/javascript;base64,${Buffer.from(idleLoaderSource).toString('base64')}`
const { createIdleQueue } = await import(idleLoaderModuleUrl)

function deferred() {
  let resolve
  const promise = new Promise(resolver => {
    resolve = resolver
  })
  return { promise, resolve }
}

const firstTask = deferred()
const firstStarted = deferred()
const secondFinished = deferred()
const queue = createIdleQueue({ timeout: 10 })

let activeTasks = 0
let maxActiveTasks = 0
let secondStarted = false

queue.push(() => {
  activeTasks += 1
  maxActiveTasks = Math.max(maxActiveTasks, activeTasks)
  firstStarted.resolve()
  return firstTask.promise.then(() => {
    activeTasks -= 1
  })
})

await firstStarted.promise
queue.pause()
queue.clear()
queue.push(() => {
  secondStarted = true
  activeTasks += 1
  maxActiveTasks = Math.max(maxActiveTasks, activeTasks)
  activeTasks -= 1
  secondFinished.resolve()
})
queue.resume()

await Promise.resolve()
await Promise.resolve()
assert.equal(secondStarted, false, 'clear() must not start a second task while a Promise is still in flight')

firstTask.resolve()
await secondFinished.promise
await Promise.resolve()

assert.equal(maxActiveTasks, 1, 'idle queue tasks must stay serial after pause → clear → resume')
assert.equal(queue.isIdle(), true)

console.log('idleLoader regression: passed (max concurrent tasks = 1)')

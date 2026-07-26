#!/usr/bin/env electron

const { app } = require('electron')
const { spawn } = require('child_process')
const fs = require('fs')
const http = require('http')
const net = require('net')
const os = require('os')
const path = require('path')

const PROJECT_ROOT = path.resolve(__dirname, '..')
const imagePackSourceArg = process.argv.find(arg => arg.startsWith('--image-pack-source='))
const imagePackSource = imagePackSourceArg
  ? path.resolve(imagePackSourceArg.slice('--image-pack-source='.length))
  : null
const TEST_TIMEOUT_MS = imagePackSource ? 90_000 : 45_000
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'silvermoon-memoryhub-perf-'))
const profileDir = path.join(tmpRoot, 'profile')
const dataDir = path.join(tmpRoot, 'data')
const imagesDir = path.join(dataDir, 'images-fixture')

fs.mkdirSync(profileDir, { recursive: true })
fs.mkdirSync(imagesDir, { recursive: true })

// 必须在 app ready 前隔离 userData；electron/main.js 会读取这里的 config.json。
app.setPath('userData', profileDir)
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')

let viteProcess = null
let finished = false
let watchdog = null
let viteOutput = ''

function cleanup() {
  if (viteProcess && !viteProcess.killed) {
    try { viteProcess.kill('SIGTERM') } catch (_) {}
  }
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }) } catch (_) {}
}

process.once('exit', cleanup)
process.once('SIGINT', () => finish({ error: 'benchmark interrupted' }, 130))
process.once('SIGTERM', () => finish({ error: 'benchmark terminated' }, 143))

function finish(result, exitCode) {
  if (finished) return
  finished = true
  if (watchdog) clearTimeout(watchdog)
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  process.exitCode = exitCode
  if (viteProcess && !viteProcess.killed) {
    try { viteProcess.kill('SIGTERM') } catch (_) {}
  }
  setTimeout(() => {
    try { app.exit(exitCode) } catch (_) { process.exit(exitCode) }
  }, 50)
}

function fail(error) {
  const message = error instanceof Error ? (error.stack || error.message) : String(error)
  finish({ ok: false, error: message, viteOutput: viteOutput.slice(-4000) }, 1)
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : null
      server.close(error => error ? reject(error) : resolve(port))
    })
  })
}

function waitForHttp(url, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(url, response => {
        response.resume()
        if (response.statusCode && response.statusCode < 500) {
          resolve()
        } else if (Date.now() >= deadline) {
          reject(new Error(`Vite did not become ready: HTTP ${response.statusCode}`))
        } else {
          setTimeout(attempt, 100)
        }
      })
      req.once('error', error => {
        if (Date.now() >= deadline) reject(error)
        else setTimeout(attempt, 100)
      })
      req.setTimeout(1000, () => req.destroy(new Error('HTTP readiness timeout')))
    }
    attempt()
  })
}

function scalar(db, sql) {
  const statement = db.prepare(sql)
  try {
    if (!statement.step()) return null
    return statement.get()[0]
  } finally {
    statement.free()
  }
}

async function createFixture() {
  const initSqlJs = require('sql.js')
  const SQL = await initSqlJs({
    locateFile: file => path.join(PROJECT_ROOT, 'node_modules', 'sql.js', 'dist', file),
  })
  const db = new SQL.Database()
  const schema = fs.readFileSync(path.join(PROJECT_ROOT, 'electron', 'schema.sql'), 'utf8')
  const seed = fs.readFileSync(path.join(PROJECT_ROOT, 'electron', 'seed.sql'), 'utf8')
  db.exec(schema)
  db.exec(seed)

  const fullThresholdArg = process.argv.find(arg => arg.startsWith('--full-threshold='))
  const level3ThresholdArg = process.argv.find(arg => arg.startsWith('--level3-threshold='))
  const fullThresholdOverride = Number(
    process.env.SILVERMOON_PERF_FULL_THRESHOLD
      ?? fullThresholdArg?.slice('--full-threshold='.length),
  )
  const level3ThresholdOverride = Number(
    process.env.SILVERMOON_PERF_LEVEL3_THRESHOLD
      ?? level3ThresholdArg?.slice('--level3-threshold='.length),
  )
  if (Number.isFinite(fullThresholdOverride)) {
    db.run(
      "UPDATE map_global_defaults SET value = ? WHERE key = 'fullImgThreshold'",
      [JSON.stringify(fullThresholdOverride)],
    )
  }
  if (Number.isFinite(level3ThresholdOverride)) {
    const thresholds = JSON.parse(
      scalar(db, "SELECT value FROM map_global_defaults WHERE key = 'levelThresholds'"),
    )
    thresholds[3] = level3ThresholdOverride
    db.run(
      "UPDATE map_global_defaults SET value = ? WHERE key = 'levelThresholds'",
      [JSON.stringify(thresholds)],
    )
  }

  const fixture = {
    placements: scalar(db, "SELECT COUNT(*) FROM map_marker_placements WHERE map_id = 'v6_7_mo6b'"),
    textboxes: scalar(db, "SELECT COUNT(*) FROM map_textboxes WHERE map_id = 'v6_7_mo6b'"),
    teleports: scalar(db, "SELECT COUNT(*) FROM map_marker_placements WHERE map_id = 'v6_7_mo6b' AND marker_id = 'mrymob7kb1qb'"),
    thresholdOverrides: {
      fullImage: Number.isFinite(fullThresholdOverride) ? fullThresholdOverride : null,
      level3: Number.isFinite(level3ThresholdOverride) ? level3ThresholdOverride : null,
    },
    imagePackMode: imagePackSource ? 'external-real-images' : 'one-pixel-fixture',
  }
  if (fixture.placements !== 767 || fixture.textboxes !== 277 || fixture.teleports !== 560) {
    db.close()
    throw new Error(`Unexpected MemoryHub fixture: ${JSON.stringify(fixture)}`)
  }

  // 放在默认视口右侧约 1400px：超出旧 600px overscan，横向拖动一屏后会进入视口。
  fixture.annotationSentinel = {
    id: '__memoryhub_perf_annotation_sentinel__',
    worldX: -40382.33458608538 + 9000,
    worldY: 638.0099036079874,
  }
  db.run(
    "INSERT INTO map_marker_placements (id, map_id, marker_id, world_x, world_y, created_by_dev, sort_order) VALUES (?, 'v6_7_mo6b', 'mrymob7kb1qb', ?, ?, 1, 999999)",
    [fixture.annotationSentinel.id, fixture.annotationSentinel.worldX, fixture.annotationSentinel.worldY],
  )
  fixture.activePlacements = scalar(
    db,
    "SELECT COUNT(*) FROM map_marker_placements WHERE map_id = 'v6_7_mo6b'",
  )

  fs.writeFileSync(path.join(dataDir, 'silvermoon_terminal.db'), Buffer.from(db.export()))
  db.close()

  fs.writeFileSync(
    path.join(profileDir, 'config.json'),
    JSON.stringify({ dbDir: dataDir, activeBaseDb: 'silvermoon_terminal.db' }, null, 2),
  )
  fs.writeFileSync(
    path.join(dataDir, 'user.json'),
    JSON.stringify({ activeImagePack: 'images-fixture', devMode: false, dualDbMode: false }, null, 2),
  )

  if (imagePackSource) {
    if (!fs.statSync(imagePackSource).isDirectory()) {
      throw new Error(`Image pack source is not a directory: ${imagePackSource}`)
    }
    // 路径索引会有意跳过符号链接，因此为目标地图及其标点图标创建临时硬链接。
    // 硬链接不复制 741MB 图包内容，基准也不会改写源文件。
    const sourceGroups = [
      {
        dir: path.join(imagePackSource, 'Map', 'Teyvat'),
        accept: name => name.startsWith('map_v6_7_mo6b_'),
      },
      {
        dir: path.join(imagePackSource, 'Map', 'markers'),
        accept: name => /\.(png|jpe?g|webp)$/i.test(name),
      },
    ]
    let linkedMapFiles = 0
    for (const group of sourceGroups) {
      if (!fs.existsSync(group.dir)) continue
      for (const entry of fs.readdirSync(group.dir, { withFileTypes: true })) {
        if (!entry.isFile() || !group.accept(entry.name)) continue
        fs.linkSync(path.join(group.dir, entry.name), path.join(imagesDir, entry.name))
        if (entry.name.startsWith('map_v6_7_mo6b_')) linkedMapFiles += 1
      }
    }
    if (linkedMapFiles !== 727) {
      throw new Error(`Expected 727 real Teyvat images, linked ${linkedMapFiles}`)
    }
    fixture.linkedMapFiles = linkedMapFiles
  } else {
    // 1px 占位图保留真实的 726 个切片挂载/卸载路径，同时让默认基准不依赖本机图包。
    const onePixelPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    )
    const sharedImage = path.join(imagesDir, '__fixture_pixel.png')
    fs.writeFileSync(sharedImage, onePixelPng)
    for (let row = -8; row < 14; row += 1) {
      for (let col = -24; col < 9; col += 1) {
        fs.linkSync(sharedImage, path.join(imagesDir, `map_v6_7_mo6b_${row}_${col}_fixture.png`))
      }
    }
    fs.linkSync(sharedImage, path.join(imagesDir, 'map_v6_7_mo6b_full.jpg'))
  }

  return fixture
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function execute(window, expression) {
  try {
    return await window.webContents.executeJavaScript(expression, true)
  } catch (error) {
    const compactExpression = String(expression).replace(/\s+/g, ' ').slice(0, 180)
    throw new Error(`Renderer execute failed near "${compactExpression}": ${error.message}`)
  }
}

async function waitFor(window, expression, label, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    try {
      if (await execute(window, expression)) return
    } catch (error) {
      lastError = error
    }
    await wait(50)
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`)
}

function installProbeInPage() {
  window.__memoryHubPerf?.stop?.()

  const state = {
    frames: [],
    longTasks: [],
    markerId: null,
    lastFrameTime: null,
  }

  let observer = null
  if (window.PerformanceObserver && PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
    observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        state.longTasks.push({
          name: entry.name,
          startTime: entry.startTime,
          duration: entry.duration,
        })
      }
    })
    observer.observe({ entryTypes: ['longtask'] })
  }

  const parseTransform = value => {
    const numbers = String(value || '').match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)?.map(Number) || []
    return numbers.length >= 6
      ? { scale: numbers[0], x: numbers[4], y: numbers[5] }
      : { scale: 1, x: 0, y: 0 }
  }

  const chooseMarker = () => {
    const viewport = document.querySelector('[data-memoryhub-viewport]')
    if (!viewport) return null
    const viewportRect = viewport.getBoundingClientRect()
    const cx = viewportRect.left + viewportRect.width / 2
    const cy = viewportRect.top + viewportRect.height / 2
    let best = null
    let bestDistance = Infinity
    for (const marker of document.querySelectorAll('[data-memoryhub-marker][title="七天神像"]')) {
      const rect = marker.getBoundingClientRect()
      const distance = Math.hypot(rect.left + rect.width / 2 - cx, rect.top + rect.height / 2 - cy)
      if (distance < bestDistance) {
        best = marker
        bestDistance = distance
      }
    }
    state.markerId = best?.dataset.memoryhubMarker || null
    return best
  }

  let rafId = null
  const sample = now => {
    const transformElement = document.querySelector('[data-memoryhub-transform]')
    const transform = parseTransform(transformElement?.style.transform)
    let marker = null
    if (state.markerId) {
      marker = Array.from(document.querySelectorAll('[data-memoryhub-marker]'))
        .find(element => element.dataset.memoryhubMarker === state.markerId)
    }
    if (!marker) marker = chooseMarker()
    const rect = marker?.getBoundingClientRect()
    state.frames.push({
      time: now,
      gap: state.lastFrameTime === null ? 0 : now - state.lastFrameTime,
      scale: transform.scale,
      x: transform.x,
      y: transform.y,
      markerWidth: rect?.width ?? null,
      markerX: rect ? rect.left + rect.width / 2 : null,
      markerY: rect ? rect.top + rect.height / 2 : null,
    })
    state.lastFrameTime = now
    // 两个阈值往返场景在高刷新率屏幕上可能超过 600 帧；保留完整窗口，
    // 避免较早的卡顿样本被环形缓冲悄悄丢掉。
    if (state.frames.length > 2000) state.frames.shift()
    rafId = requestAnimationFrame(sample)
  }
  rafId = requestAnimationFrame(sample)

  window.__memoryHubPerf = {
    reset() {
      state.frames = []
      state.longTasks = []
      state.lastFrameTime = null
      state.markerId = null
      chooseMarker()
    },
    snapshot(label) {
      const gaps = state.frames.map(frame => frame.gap).filter(gap => gap > 0).sort((a, b) => a - b)
      const markerWidths = state.frames.map(frame => frame.markerWidth).filter(Number.isFinite)
      const scales = state.frames.map(frame => frame.scale).filter(scale => Number.isFinite(scale) && scale > 0)
      let maxMarkerWidthStep = 0
      for (let index = 1; index < markerWidths.length; index += 1) {
        maxMarkerWidthStep = Math.max(
          maxMarkerWidthStep,
          Math.abs(markerWidths[index] / markerWidths[index - 1] - 1),
        )
      }
      let maxLogScaleStep = 0
      for (let index = 1; index < scales.length; index += 1) {
        maxLogScaleStep = Math.max(
          maxLogScaleStep,
          Math.abs(Math.log(scales[index] / scales[index - 1])),
        )
      }
      const percentile = (values, p) => values.length
        ? values[Math.min(values.length - 1, Math.floor(values.length * p))]
        : 0
      return {
        label,
        frameCount: state.frames.length,
        markerSampleCount: markerWidths.length,
        longTaskCount: state.longTasks.length,
        maxLongTaskMs: state.longTasks.reduce((max, task) => Math.max(max, task.duration), 0),
        totalLongTaskMs: state.longTasks.reduce((sum, task) => sum + task.duration, 0),
        maxRafGapMs: gaps.length ? gaps[gaps.length - 1] : 0,
        p95RafGapMs: percentile(gaps, 0.95),
        p99RafGapMs: percentile(gaps, 0.99),
        missedFrameCount12Ms: gaps.filter(gap => gap > 12).length,
        missedFrameRate12Ms: gaps.length
          ? gaps.filter(gap => gap > 12).length / gaps.length
          : 0,
        maxMarkerWidthStep,
        maxLogScaleStep,
        markerId: state.markerId,
        renderedMarkers: document.querySelectorAll('[data-memoryhub-marker]').length,
        renderedTextboxes: document.querySelectorAll('[data-memoryhub-textbox]').length,
        zoom: Number(document.querySelector('[data-memoryhub-root] input[type="range"]')?.value || 0),
        longTasks: state.longTasks,
      }
    },
    stop() {
      observer?.disconnect()
      if (rafId !== null) cancelAnimationFrame(rafId)
    },
  }
}

async function sendWheelBurst(window, point, count, deltaY = 100) {
  for (let index = 0; index < count; index += 1) {
    window.webContents.sendInputEvent({
      type: 'mouseWheel',
      x: Math.round(point.x),
      y: Math.round(point.y),
      deltaX: 0,
      deltaY,
      canScroll: true,
    })
    await wait(17)
  }
}

async function resetDefaultView(window) {
  const reset = await execute(window, `(() => {
    const button = document.querySelector('[data-memoryhub-root] button[title="回到默认视角"]')
    if (!button) return false
    button.click()
    return true
  })()`)
  if (!reset) throw new Error('MemoryHub default-view reset button not found')
  await wait(250)
}

async function getViewportPoint(window) {
  return execute(window, `(() => {
    const rect = document.querySelector('[data-memoryhub-viewport]').getBoundingClientRect()
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    }
  })()`)
}

function setZoomInPage(value) {
  const input = document.querySelector('[data-memoryhub-root] input[type="range"]')
  if (!input) throw new Error('MemoryHub zoom input not found')
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  setter.call(input, String(value))
  input.dispatchEvent(new Event('input', { bubbles: true }))
  return true
}

async function setZoom(window, value) {
  await execute(window, `(${setZoomInPage.toString()})(${JSON.stringify(value)})`)
  await waitFor(
    window,
    `Math.abs(Number(document.querySelector('[data-memoryhub-root] input[type="range"]')?.value) - ${value}) < 0.0001`,
    `zoom ${value}`,
  )
  await wait(250)
}

async function panToDenseThresholdFixture(window) {
  await execute(window, `(() => {
    const viewportElement = document.querySelector('[data-memoryhub-viewport]')
    const rect = viewportElement.getBoundingClientRect()
    const startX = rect.left + rect.width / 2
    const startY = rect.top + rect.height / 2
    const zoom = Number(
      document.querySelector('[data-memoryhub-root] input[type="range"]')?.value || 1
    )
    const deltaX = -(-10165 - (-40382.33458608538)) * zoom
    const deltaY = -(1562 - 638.0099036079874) * zoom
    viewportElement.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 1,
      clientX: startX,
      clientY: startY,
    }))
    window.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true,
      buttons: 1,
      clientX: startX + deltaX,
      clientY: startY + deltaY,
    }))
    window.dispatchEvent(new MouseEvent('mouseup', {
      bubbles: true,
      button: 0,
      buttons: 0,
      clientX: startX + deltaX,
      clientY: startY + deltaY,
    }))
    return true
  })()`)
  await wait(250)
}

async function runWheelScenario(window, label, zoomOutBurst, firstBurst, queuedBurst) {
  await resetDefaultView(window)
  const point = await getViewportPoint(window)
  await sendWheelBurst(window, point, zoomOutBurst, -100)
  await wait(1000)
  await execute(window, 'window.__memoryHubPerf.reset()')
  await wait(100)
  await sendWheelBurst(window, point, firstBurst)
  // 让 30ms 收尾逻辑开始；随后继续输入，能捕获主线程阻塞后的“积压瞬移”。
  await wait(45)
  await sendWheelBurst(window, point, queuedBurst)
  await wait(1400)
  return execute(window, `window.__memoryHubPerf.snapshot(${JSON.stringify(label)})`)
}

async function runThresholdOscillation(window, label, initialZoom, crossesThreshold) {
  await resetDefaultView(window)
  await panToDenseThresholdFixture(window)
  await setZoom(window, initialZoom)
  const point = await getViewportPoint(window)
  await execute(window, 'window.__memoryHubPerf.reset()')
  await wait(100)
  for (let cycle = 0; cycle < 8; cycle += 1) {
    await sendWheelBurst(window, point, 4, -100)
    await wait(70)
    await sendWheelBurst(window, point, 4, 100)
    await wait(70)
  }
  await wait(300)
  const snapshot = await execute(
    window,
    `window.__memoryHubPerf.snapshot(${JSON.stringify(label)})`,
  )
  return { ...snapshot, crossesThreshold }
}

async function readAnnotationSentinel(window, sentinel) {
  return execute(window, `(() => {
    const viewport = document.querySelector('[data-memoryhub-viewport]').getBoundingClientRect()
    const transformValue = document.querySelector('[data-memoryhub-transform]')?.style.transform || ''
    const values = transformValue.match(/-?\\d+(?:\\.\\d+)?(?:e[+-]?\\d+)?/gi)?.map(Number) || []
    const scale = values[0] || 1
    const offsetX = values[4] || 0
    const offsetY = values[5] || 0
    const expectedX = viewport.left + ${sentinel.worldX} * scale + offsetX
    const expectedY = viewport.top + ${sentinel.worldY} * scale + offsetY
    const element = document.querySelector(
      '[data-memoryhub-marker="${sentinel.id}"]'
    )
    const rect = element?.getBoundingClientRect() || null
    const visible = Boolean(rect
      && rect.right >= viewport.left
      && rect.left <= viewport.right
      && rect.bottom >= viewport.top
      && rect.top <= viewport.bottom)
    return {
      mounted: Boolean(element),
      visible,
      theoreticallyVisible: (
        expectedX >= viewport.left
        && expectedX <= viewport.right
        && expectedY >= viewport.top
        && expectedY <= viewport.bottom
      ),
      expectedX,
      expectedY,
      renderedMarkers: document.querySelectorAll('[data-memoryhub-marker]').length,
    }
  })()`)
}

async function runAnnotationLatencyScenario(window, sentinel) {
  await resetDefaultView(window)
  const viewport = await getViewportPoint(window)
  const before = await readAnnotationSentinel(window, sentinel)
  const start = {
    x: Math.round(viewport.right - 30),
    y: Math.round(viewport.y),
  }
  const end = {
    x: Math.round(viewport.left + 30),
    y: Math.round(viewport.y),
  }
  window.webContents.sendInputEvent({
    type: 'mouseDown',
    button: 'left',
    clickCount: 1,
    ...start,
  })
  for (let step = 1; step <= 8; step += 1) {
    window.webContents.sendInputEvent({
      type: 'mouseMove',
      x: Math.round(start.x + (end.x - start.x) * step / 8),
      y: end.y,
    })
    await wait(17)
  }
  // 静止超过惯性采样窗口，但保持按下，精确观察“松手前是否已挂载”。
  await wait(120)
  const duringDrag = await readAnnotationSentinel(window, sentinel)
  window.webContents.sendInputEvent({
    type: 'mouseUp',
    button: 'left',
    clickCount: 1,
    ...end,
  })
  await wait(300)
  const afterRelease = await readAnnotationSentinel(window, sentinel)
  return {
    label: 'annotation-preload-during-drag',
    before,
    duringDrag,
    afterRelease,
    missingDuringDrag: (
      duringDrag.theoreticallyVisible
      && !duringDrag.mounted
      && afterRelease.visible
    ),
  }
}

async function runBoundaryScenario(window) {
  await resetDefaultView(window)
  const result = await execute(window, `(() => {
    const viewportElement = document.querySelector('[data-memoryhub-viewport]')
    const rect = viewportElement.getBoundingClientRect()
    const startX = rect.left + rect.width / 2
    const startY = rect.top + rect.height / 2
    viewportElement.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 1,
      clientX: startX,
      clientY: startY,
    }))
    window.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true,
      buttons: 1,
      clientX: startX + 50000,
      clientY: startY + 50000,
    }))
    window.dispatchEvent(new MouseEvent('mouseup', {
      bubbles: true,
      button: 0,
      buttons: 0,
      clientX: startX + 50000,
      clientY: startY + 50000,
    }))
    return true
  })()`)
  if (!result) throw new Error('Could not dispatch boundary drag')
  await wait(300)
  return execute(window, `(() => {
    const viewport = document.querySelector('[data-memoryhub-viewport]').getBoundingClientRect()
    const imageElement = document.querySelector('img[alt="full-map"]')
    if (!imageElement) throw new Error('Full map image is not mounted')
    const image = imageElement.getBoundingClientRect()
    const intersectionWidth = Math.max(
      0,
      Math.min(viewport.right, image.right) - Math.max(viewport.left, image.left),
    )
    const intersectionHeight = Math.max(
      0,
      Math.min(viewport.bottom, image.bottom) - Math.max(viewport.top, image.top),
    )
    return {
      label: 'bounded-extreme-drag',
      horizontalCoverage: intersectionWidth / viewport.width,
      verticalCoverage: intersectionHeight / viewport.height,
      viewport: { width: viewport.width, height: viewport.height },
      image: {
        left: image.left,
        right: image.right,
        top: image.top,
        bottom: image.bottom,
      },
    }
  })()`)
}

async function runBenchmark(window, fixture) {
  await waitFor(window, 'document.readyState === "complete"', 'initial page load')
  await execute(window, `localStorage.setItem('default_page', '/terminal'); location.hash = '#/terminal'`)
  await waitFor(window, `location.hash === '#/terminal'`, 'terminal route')
  await waitFor(window, `document.body.innerText.includes('摹忆中枢')`, 'MemoryHub desktop icon')
  const launched = await execute(window, `(() => {
    const label = Array.from(document.querySelectorAll('span')).find(
      element => element.textContent.trim() === '摹忆中枢'
    )
    const launcher = label?.closest('.cursor-pointer')
    if (!launcher) return false
    launcher.click()
    return true
  })()`)
  if (!launched) throw new Error('Could not launch MemoryHub from the terminal desktop')

  await waitFor(window, `Boolean(document.querySelector('[data-memoryhub-root]'))`, 'MemoryHub root')
  await waitFor(window, `document.body.innerText.includes('提瓦特v6.7')`, 'Teyvat v6.7 map')
  await waitFor(
    window,
    `document.querySelectorAll('[data-memoryhub-marker]').length > 0`,
    'initial marker render',
  )

  await execute(window, `(${installProbeInPage.toString()})()`)
  const scenarios = [
    await runWheelScenario(window, 'cross-5-percent', 19, 5, 4),
    await runWheelScenario(window, 'cross-10-percent', 8, 4, 2),
    await runWheelScenario(window, 'above-10-percent', 4, 3, 2),
  ]
  const thresholdControl = await runThresholdOscillation(
    window,
    'same-side-above-10-percent',
    0.12,
    false,
  )
  const thresholdCrossing = await runThresholdOscillation(
    window,
    'oscillate-across-10-percent',
    0.09,
    true,
  )
  const annotationLatency = await runAnnotationLatencyScenario(
    window,
    fixture.annotationSentinel,
  )
  const boundary = await runBoundaryScenario(window)
  await execute(window, 'window.__memoryHubPerf.stop()')

  const limits = {
    maxLongTaskMs: 50,
    maxRafGapMs: 50,
    p99RafGapMs: 34,
    maxMarkerWidthStep: 0.15,
    maxLogScaleStep: 0.08,
    maxThresholdMissedFrameRatePenalty: 0.02,
  }
  const failures = []
  for (const scenario of [...scenarios, thresholdControl, thresholdCrossing]) {
    if (scenario.maxLongTaskMs > limits.maxLongTaskMs) {
      failures.push(`${scenario.label}: long task ${scenario.maxLongTaskMs.toFixed(1)}ms`)
    }
    if (scenario.maxRafGapMs > limits.maxRafGapMs) {
      failures.push(`${scenario.label}: rAF gap ${scenario.maxRafGapMs.toFixed(1)}ms`)
    }
    if (scenario.p99RafGapMs > limits.p99RafGapMs) {
      failures.push(`${scenario.label}: p99 rAF gap ${scenario.p99RafGapMs.toFixed(1)}ms`)
    }
    if (scenario.maxMarkerWidthStep > limits.maxMarkerWidthStep) {
      failures.push(`${scenario.label}: marker size jump ${(scenario.maxMarkerWidthStep * 100).toFixed(1)}%`)
    }
    if (scenario.maxLogScaleStep > limits.maxLogScaleStep) {
      failures.push(`${scenario.label}: accumulated zoom jump ${scenario.maxLogScaleStep.toFixed(3)}`)
    }
  }
  if (annotationLatency.missingDuringDrag) {
    failures.push('annotation-preload-during-drag: visible marker mounted only after mouseup')
  }
  if (annotationLatency.before.mounted) {
    failures.push('annotation-preload-during-drag: sentinel unexpectedly mounted before approaching viewport')
  }
  if (
    !annotationLatency.duringDrag.theoreticallyVisible
    || !annotationLatency.duringDrag.mounted
    || !annotationLatency.duringDrag.visible
  ) {
    failures.push('annotation-preload-during-drag: sentinel was not mounted and visible while pointer remained down')
  }
  if (!annotationLatency.afterRelease.visible) {
    failures.push('annotation-preload-during-drag: sentinel disappeared after mouseup')
  }
  const thresholdMissedFramePenalty = (
    thresholdCrossing.missedFrameCount12Ms
    - thresholdControl.missedFrameCount12Ms
  )
  const thresholdMissedFrameRatePenalty = (
    thresholdCrossing.missedFrameRate12Ms
    - thresholdControl.missedFrameRate12Ms
  )
  if (thresholdMissedFrameRatePenalty > limits.maxThresholdMissedFrameRatePenalty) {
    failures.push(
      `oscillate-across-10-percent: ${(thresholdMissedFrameRatePenalty * 100).toFixed(2)}% extra missed-frame rate versus same-side control`,
    )
  }
  if (boundary.horizontalCoverage < 0.7 || boundary.verticalCoverage < 0.7) {
    failures.push(
      `bounded-extreme-drag: map coverage ${(boundary.horizontalCoverage * 100).toFixed(1)}% × ${(boundary.verticalCoverage * 100).toFixed(1)}%`,
    )
  }

  return {
    ok: failures.length === 0,
    fixture,
    limits,
    scenarios,
    thresholdComparison: {
      control: thresholdControl,
      crossing: thresholdCrossing,
      missedFramePenalty: thresholdMissedFramePenalty,
      missedFrameRatePenalty: thresholdMissedFrameRatePenalty,
    },
    annotationLatency,
    boundary,
    failures,
  }
}

async function main() {
  const fixture = await createFixture()
  const vitePort = await getFreePort()
  const viteUrl = `http://127.0.0.1:${vitePort}`
  const nodeBinary = process.env.SILVERMOON_NODE_BINARY || 'node'
  viteProcess = spawn(
    nodeBinary,
    [
      path.join(PROJECT_ROOT, 'node_modules', 'vite', 'bin', 'vite.js'),
      '--host', '127.0.0.1',
      '--port', String(vitePort),
      '--strictPort',
    ],
    {
      cwd: PROJECT_ROOT,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  for (const stream of [viteProcess.stdout, viteProcess.stderr]) {
    stream.on('data', chunk => {
      viteOutput += chunk.toString()
      if (viteOutput.length > 12_000) viteOutput = viteOutput.slice(-12_000)
    })
  }
  viteProcess.once('exit', code => {
    if (!finished && code !== 0) fail(new Error(`Vite exited early with code ${code}`))
  })
  await waitForHttp(viteUrl)

  process.env.SILVERMOON_DEV_SERVER_URL = viteUrl
  process.env.SILVERMOON_DISABLE_DEVTOOLS = '1'

  let benchmarkStarted = false
  app.on('browser-window-created', (_event, window) => {
    if (benchmarkStarted) return
    window.webContents.once('render-process-gone', (_goneEvent, details) => {
      fail(new Error(`MemoryHub renderer exited: ${JSON.stringify(details)}`))
    })
    window.webContents.once('did-finish-load', async () => {
      if (benchmarkStarted) return
      benchmarkStarted = true
      try {
        const result = await runBenchmark(window, fixture)
        finish(result, result.ok ? 0 : 1)
      } catch (error) {
        fail(error)
      }
    })
  })

  watchdog = setTimeout(() => fail(new Error(`Benchmark exceeded ${TEST_TIMEOUT_MS}ms`)), TEST_TIMEOUT_MS)
  require(path.join(PROJECT_ROOT, 'electron', 'main.js'))
}

main().catch(fail)

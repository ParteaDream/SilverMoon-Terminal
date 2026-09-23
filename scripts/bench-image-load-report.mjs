#!/usr/bin/env node
/**
 * Summarize scripts/bench-image-load.cjs output into a compact table.
 * Usage: electron .../bench-image-load.cjs > out.json ; node scripts/bench-image-load-report.mjs out.json
 * Or pipe the raw output through: node scripts/bench-image-load-report.mjs < raw.txt
 */
import fs from 'node:fs'

const input = process.argv[2]
  ? fs.readFileSync(process.argv[2], 'utf8')
  : fs.readFileSync(0, 'utf8')

const marker = '===IMGBENCH==='
const start = input.indexOf(marker)
if (start < 0) { console.log('no ===IMGBENCH=== marker found'); process.exit(1) }
// The app keeps logging after the payload; slice out the first complete JSON value.
const from = input.indexOf('{', start)
let depth = 0, inStr = false, esc = false, end = -1
for (let i = from; i < input.length; i++) {
  const c = input[i]
  if (inStr) {
    if (esc) esc = false
    else if (c === '\\') esc = true
    else if (c === '"') inStr = false
    continue
  }
  if (c === '"') inStr = true
  else if (c === '{') depth++
  else if (c === '}') { depth--; if (depth === 0) { end = i + 1; break } }
}
const json = JSON.parse(input.slice(from, end))
if (!json.ok) {
  console.log('BENCH FAILED:', json.error)
  process.exit(1)
}
const pad = (s, n) => String(s).padEnd(n)
const num = (s, n) => String(s).padStart(n)

console.log(`ipcProbe=${json.ipcProbeInstalled} width=${json.requestedWidth ?? 'default'}`)
for (const r of json.results) {
  if (r.error) { console.log(`\n## ${r.page}: ERROR ${r.error}`); continue }
  const last = r.samples[r.samples.length - 1]
  const s2 = r.samples.find(s => s.at === 2000) || last
  console.log(`\n## ${r.page}  items=${r.items} shell=${r.shellMs}ms`)
  console.log(`   ${pad('t(ms)', 7)}${num('calls', 7)}${num('MB', 8)}${num('maxInF', 8)}${num('imgs', 7)}${num('decoded', 9)}${num('nodes', 8)}${num('longN', 7)}${num('longMs', 8)}${num('heapMB', 8)}`)
  for (const s of r.samples) {
    console.log(`   ${pad(s.at, 7)}${num(s.calls, 7)}${num(s.bytesMB, 8)}${num(s.maxInflight, 8)}${num(s.images.total, 7)}${num(s.images.decoded, 9)}${num(s.dom.nodes, 8)}${num(s.longTasks.count, 7)}${num(s.longTasks.totalMs, 8)}${num(s.mem ? s.mem.usedMB : '-', 8)}`)
  }
  console.log(`   grid: cols=${last.grid.cols} colW=${last.grid.colWidth} gridW=${last.grid.width} viewport=${last.viewport.w}x${last.viewport.h} dpr=${last.viewport.dpr}`)
  console.log(`   ipc@8s: calls=${last.calls} payload=${last.bytesMB}MB maxInflight=${last.maxInflight} err=${last.errors} p50=${last.latencyMs.p50} p90=${last.latencyMs.p90} p99=${last.latencyMs.p99} max=${last.latencyMs.max}ms`)
  console.log(`   @2s:    calls=${s2.calls} payload=${s2.bytesMB}MB images=${s2.images.total} decoded=${s2.images.decoded} nodes=${s2.dom.nodes} hiddenImgs=${s2.dom.hiddenImgs}`)
  if (last.topFiles?.length) {
    console.log(`   heaviest: ${last.topFiles.map(f => `${f.file}(${f.n}x ${f.kb}KB)`).join(', ')}`)
  }
  if (r.scroll) {
    console.log(`   scroll: ${r.scroll.ok ? `frames=${r.scroll.frames} p50=${r.scroll.p50}ms p95=${r.scroll.p95}ms max=${r.scroll.max}ms longTasks=${r.scroll.longTasks} (${r.scroll.longTaskMs}ms) scrollMax=${r.scroll.scrollableMax}` : `FAILED ${r.scroll.error || r.scroll.why}`}`)
  }
  if (r.search) {
    console.log(`   search: ${r.search.ok ? `q="${r.search.query}" rows=${r.search.rowsShown} imgsAfter=${r.search.imgsAfter} perChar=[${r.search.perChar}] max=${r.search.perCharMax}ms frameP95=${r.search.p95}ms longTasks=${r.search.longTasks} (${r.search.longTaskMs}ms)` : `FAILED ${r.search.error || r.search.why}`}`)
  }
}

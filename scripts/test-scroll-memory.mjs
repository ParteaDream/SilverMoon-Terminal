#!/usr/bin/env node
/**
 * scrollMemory 内核单测 —— 用一个"内容按需渲染"的假滚动容器复现
 * content-visibility: auto + contain-intrinsic-size 造成的占位高度问题，
 * 验证锚点式恢复能把位置精确还原（含"滚到最底"这一最难的场景）。
 *
 * Run: node scripts/test-scroll-memory.mjs
 */
import { captureScrollSnapshot, applyScrollSnapshot, notifyUserScrollIntent } from '../src/utils/scrollMemory.mjs'

const VIEWPORT = 800
const REAL_H = 500         // 一行卡片的真实高度
const PLACEHOLDER_H = 250  // contain-intrinsic-size 给的占位高度
const COLS = 4
const ROWS = 40
const ITEMS = COLS * ROWS

class FakeEl {
  constructor(scroller, item) { this.scroller = scroller; this.item = item }
  getAttribute(name) { return name === 'data-item-id' ? this.item.id : null }
  getBoundingClientRect() {
    const top = this.scroller.rowTop(this.item.row) - this.scroller.scrollTop
    return { top, bottom: top + REAL_H / 2, left: 0, right: 100, width: 100, height: REAL_H / 2 }
  }
}

/** 假滚动容器：未"渲染"过的行按占位高度参与布局（模拟 content-visibility） */
class FakeScroller {
  constructor() {
    this.clientHeight = VIEWPORT
    this._scrollTop = 0
    this.rendered = new Set()
    this.listeners = {}
    this.items = []
    for (let i = 0; i < ITEMS; i++) {
      const row = Math.floor(i / COLS)
      this.items.push({ id: String(1000 + i), row, el: null })
    }
    for (const it of this.items) it.el = new FakeEl(this, it)
  }
  get scrollHeight() {
    let h = 0
    for (let r = 0; r < ROWS; r++) h += this.rendered.has(r) ? REAL_H : PLACEHOLDER_H
    return h
  }
  get scrollTop() { return this._scrollTop }
  set scrollTop(v) {
    const max = Math.max(0, this.scrollHeight - this.clientHeight)
    this._scrollTop = Math.min(Math.max(0, v), max)
  }
  get maxScroll() { return Math.max(0, this.scrollHeight - this.clientHeight) }
  get atBottom() { return this.maxScroll > 0 && this._scrollTop >= this.maxScroll - 1 }
  getBoundingClientRect() {
    return { top: 0, bottom: this.clientHeight, left: 0, right: 1200, width: 1200, height: this.clientHeight }
  }
  rowTop(row) {
    let h = 0
    for (let r = 0; r < row; r++) h += this.rendered.has(r) ? REAL_H : PLACEHOLDER_H
    return h
  }
  /** 模拟浏览器的按需渲染：与视口（含一屏缓冲）相交的行被真正渲染 */
  renderPass() {
    const from = this._scrollTop - REAL_H
    const to = this._scrollTop + this.clientHeight + REAL_H
    let n = 0
    for (let r = 0; r < ROWS; r++) {
      if (this.rendered.has(r)) continue
      const top = this.rowTop(r)
      if (top + PLACEHOLDER_H > from && top < to) { this.rendered.add(r); n++ }
    }
    return n
  }
  querySelectorAll() { return this.items.map(i => i.el) }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn) }
  removeEventListener(type, fn) {
    const l = this.listeners[type]
    if (l) this.listeners[type] = l.filter(x => x !== fn)
  }
  dispatch(type) {
    for (const fn of [...(this.listeners[type] || [])]) fn({ type })
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

/** 一边"渲染"一边等布局稳定 */
async function settle(scroller, ms = 240) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { scroller.renderPass(); await sleep(6) }
}

/** 反复把滚动位置压到目标，直到布局不再变化（模拟用户滚到底/滚到中间） */
async function scrollAndSettle(scroller, target) {
  for (let i = 0; i < 40; i++) {
    if (target === 'bottom') scroller.scrollTop = scroller.scrollHeight
    else scroller.scrollTop = target
    await settle(scroller, 30)
  }
  await settle(scroller, 200)
}

let failures = 0
function check(name, ok, detail) {
  if (ok) console.log(`  PASS  ${name}`)
  else { failures++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`) }
}

function measure(scroller, snapshot) {
  const out = { scrollTop: Math.round(scroller.scrollTop), atBottom: scroller.atBottom, anchorId: null, anchorOffset: null }
  if (snapshot.anchor) {
    const item = scroller.items.find(i => i.id === snapshot.anchor.id)
    if (item) {
      out.anchorId = item.id
      out.anchorOffset = Math.round(item.el.getBoundingClientRect().top)
    }
  }
  return out
}

async function scenario(label, position) {
  console.log(`\n[${label}]`)
  // ── 离开前：滚到目标位置并让浏览器渲染到位 ──
  const before = new FakeScroller()
  const maxAll = before.scrollHeight - before.clientHeight
  await scrollAndSettle(before, position === 'bottom' ? 'bottom' : Math.round(maxAll * 0.55))
  const snapshot = captureScrollSnapshot(before)
  const expected = measure(before, snapshot)
  check('采集到快照', !!snapshot && !!snapshot.anchor, JSON.stringify(snapshot))
  if (position === 'bottom') check('离开前确实贴底', expected.atBottom, JSON.stringify(expected))

  // ── 返回列表：全新挂载，真实高度记忆全部丢失 ──
  const after = new FakeScroller()
  after.scrollTop = snapshot.scrollTop
  after.renderPass()
  const pump = setInterval(() => after.renderPass(), 4)
  const result = await applyScrollSnapshot(after, snapshot, { maxMs: 2000, abortOnUserInput: false })
  clearInterval(pump)
  const got = measure(after, snapshot)

  check('收敛结束', result === 'converged', `result=${result}`)
  check('scrollTop 与离开前一致', Math.abs(got.scrollTop - expected.scrollTop) <= 1,
    `expected=${expected.scrollTop} got=${got.scrollTop}`)
  check('锚点条目一致', got.anchorId === expected.anchorId, `expected=${expected.anchorId} got=${got.anchorId}`)
  check('锚点偏移一致', got.anchorOffset != null && Math.abs(got.anchorOffset - expected.anchorOffset) <= 1,
    `expected=${expected.anchorOffset} got=${got.anchorOffset}`)
  check('贴底状态一致', got.atBottom === expected.atBottom, `expected=${expected.atBottom} got=${got.atBottom}`)

  // 收敛之后继续给渲染机会：位置不能再漂移
  const pump2 = setInterval(() => after.renderPass(), 4)
  await sleep(400)
  clearInterval(pump2)
  const later = measure(after, snapshot)
  check('稳定后不漂移', Math.abs(later.scrollTop - expected.scrollTop) <= 1 && later.atBottom === expected.atBottom,
    `expected=${JSON.stringify(expected)} later=${JSON.stringify(later)}`)
}

async function main() {
  console.log('scrollMemory 内核单测（模拟 content-visibility 占位高度）')
  await scenario('滚到最底后返回', 'bottom')
  await scenario('滚到中部后返回', 'middle')

  // 锚点条目消失（被筛选掉）时退化为像素位置
  console.log('\n[锚点丢失的兜底]')
  {
    const s = new FakeScroller()
    await scrollAndSettle(s, 3000)
    const res = await applyScrollSnapshot(s, { scrollTop: 3000, atBottom: false, anchor: { id: '不存在', offset: 0 } },
      { maxMs: 1200, abortOnUserInput: false })
    check('退化为 scrollTop 恢复', Math.abs(s.scrollTop - 3000) <= 1, `scrollTop=${s.scrollTop} result=${res}`)
  }

  // 用户中途介入：立即放弃，不和用户抢滚动条
  console.log('\n[用户中途介入]')
  {
    const s = new FakeScroller()
    await scrollAndSettle(s, 0)

    // a) 滚轮/触摸（容器上的被动监听）
    const p1 = applyScrollSnapshot(s, { scrollTop: 5000, atBottom: false, anchor: null }, { maxMs: 1500 })
    await sleep(40)
    const hadWheelListener = (s.listeners.wheel || []).length > 0
    s.dispatch('wheel')
    const r1 = await p1
    check('滚轮介入后放弃', hadWheelListener && r1 === 'aborted', `result=${r1} wheel=${hadWheelListener}`)
    check('放弃后移除监听', (s.listeners.wheel || []).length === 0, `left=${(s.listeners.wheel || []).length}`)

    // b) 键盘滚动（经 ShortcutContext 显式通知，不开裸 keydown 监听）
    const p2 = applyScrollSnapshot(s, { scrollTop: 5000, atBottom: false, anchor: null }, { maxMs: 1500 })
    await sleep(40)
    notifyUserScrollIntent()
    const r2 = await p2
    check('键盘滚动通知后放弃', r2 === 'aborted', `result=${r2}`)
  }

  console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILED'}`)
  process.exitCode = failures === 0 ? 0 : 1
}

main()

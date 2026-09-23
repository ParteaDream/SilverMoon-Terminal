import { useState, useEffect, useRef } from 'react'
import { useDb } from '../context/DbContext'
import { DEFAULT_MARGIN, locate, selectPendingLoads } from '../utils/lazyViewport'

// ── 全局懒加载版本号 ──
let _globalRevision = 0
const _revisionListeners = new Set()

export function bumpLazyRevision() {
  _globalRevision++
  for (const fn of _revisionListeners) fn(_globalRevision)
}

// ── MutationObserver（DOM 重排时 bump revision）──
// 窗口缩放期间抑制 revision 更新，避免海量懒加载实例同时重评估
let _observerStarted = false
let _observerTimer = null
let _resizing = false
let _resizeTimer = null

function startMutationObserver() {
  if (_observerStarted) return
  _observerStarted = true
  const main = document.querySelector('main')
  if (!main) { setTimeout(startMutationObserver, 500); return }

  // 窗口缩放检测：缩放期间抑制 MutationObserver 的 revision bump
  window.addEventListener('resize', () => {
    _resizing = true
    clearTimeout(_resizeTimer)
    _resizeTimer = setTimeout(() => {
      _resizing = false
      // 缩放结束后统一 bump 一次
      _globalRevision++
      for (const fn of _revisionListeners) fn(_globalRevision)
    }, 250)
  })

  const observer = new MutationObserver(() => {
    if (_resizing) return  // 缩放期间跳过
    if (_observerTimer) clearTimeout(_observerTimer)
    _observerTimer = setTimeout(() => {
      _globalRevision++
      for (const fn of _revisionListeners) fn(_globalRevision)
      _observerTimer = null
    }, 300)
  })
  observer.observe(main, { childList: true, subtree: true })
}

let _globalStarted = false

function ensureGlobalStarted() {
  if (_globalStarted) return
  _globalStarted = true
  startMutationObserver()
}

// ── 预加载缓冲带：可视区外 800px 内的图片提前加载 ──
// 此前为 3000px，几乎覆盖整页（材料页 526 张在挂载时全量触发），
// 改为 800px 后仅预加载视口附近图片。
const PRELOAD_MARGIN = DEFAULT_MARGIN

// ── 滚动容器视图状态 ──
// 记录统一使用「文档坐标」（相对滚动容器内容原点）：滚动不会改变文档坐标，
// 所以每帧扫描先做整数比较粗筛，绝大多数元素不需要读 rect。
let _mainEl = null

function findScroller() {
  if (_mainEl && _mainEl.isConnected) return _mainEl
  _mainEl = document.querySelector('main')
  return _mainEl
}

function viewState() {
  const main = findScroller()
  if (main) {
    return { top: main.scrollTop, height: main.clientHeight, base: main.getBoundingClientRect().top }
  }
  return { top: window.scrollY || 0, height: window.innerHeight, base: 0 }
}

function measure(el, view) {
  const r = el.getBoundingClientRect()
  const top = r.top - view.base + view.top
  return { top, bottom: top + r.height, w: r.width, h: r.height }
}

// 扫描时对粗筛命中的元素做一次实时测量：缓存坐标在布局变化后会失真
// （典型是 content-visibility:auto 的容器记住真实高度后页面变高）。
function liveBox(rec, view) {
  const el = rec.el
  if (!el || !el.isConnected) return null
  const box = measure(el, view)
  // 0×0（display:none 子树、尚未布局）→ 交给 IntersectionObserver，不在这里加载
  if (box.w === 0 && box.h === 0) return { top: 0, bottom: 0, w: 0, h: 0 }
  return box
}

// ── 待加载元素表 ──
// el → rec { el, top, bottom, w, h, hidden, state, urgent, load(urgent), upgrade() }
//   top/bottom 为文档坐标（相对滚动容器内容原点），注册时读一次；只用于粗筛，
//   布局变化导致的失真由扫描时的实时 rect（liveBox）兜正。
//   state: 'idle' 未请求 / 'requested' 已请求（可能仍在队列中）/ 'done'
// 元素挂载或 revision bump 时注册；卸载、加载完成后由 effect cleanup 移除。
const _pending = new Map()

function requestLoad(rec, urgent) {
  if (rec.state === 'done') return
  if (rec.state === 'requested') {
    if (urgent) boost(rec)
    return
  }
  if (rec.state !== 'idle') return
  rec.state = 'requested'
  rec.urgent = !!urgent
  rec.load(rec.urgent)
}

// 已在队列中的请求 → 提到「可视区」优先级（不重新发起 IPC，队列内部提前）
function boost(rec) {
  if (rec.urgent) return
  rec.urgent = true
  rec.upgrade()
}

// ── 视口扫描（唯一决定加载顺序的地方）──
// 挑出可视区内的元素优先加载，其次才是预加载带；不可渲染（display:none 等
// 0×0 元素）一律跳过 —— 旧实现把它们当成「在视口内」，于是折叠内容里的
// 隐藏缩略图会占据每帧 40 个的扫描预算，可视区图片反而排在后面。
function scanViewport() {
  if (_pending.size === 0) return
  const view = viewState()
  const { urgent, normal, promote } =
    selectPendingLoads(_pending.values(), view, PRELOAD_MARGIN, rec => liveBox(rec, view))
  for (let i = 0; i < promote.length; i++) boost(promote[i])
  for (let i = 0; i < urgent.length; i++) requestLoad(urgent[i], true)
  for (let i = 0; i < normal.length; i++) requestLoad(normal[i], false)
}

// 同一个同步批次（一次 effect 重注册、一次 IO 回调）内的注册 / 可见性变化
// 先全部落表，再由这次扫描统一排序 —— 否则先注册的元素会立刻占满并发位。
let _scanScheduled = false
function scheduleScan() {
  if (_scanScheduled) return
  _scanScheduled = true
  queueMicrotask(() => { _scanScheduled = false; scanViewport() })
}

// ── 同步滚动回退（单 rAF-throttled listener，确保快速滚动不丢帧）──
let _scrollCheckActive = false
let _scrollTicking = false

function ensureScrollCheck() {
  if (_scrollCheckActive) return
  _scrollCheckActive = true
  const target = findScroller() || window
  target.addEventListener('scroll', () => {
    if (_scrollTicking) return
    _scrollTicking = true
    requestAnimationFrame(() => {
      _scrollTicking = false
      scanViewport()
    })
  }, { passive: true })
}

// ── 共享 IntersectionObserver（异步兜底）──
// 负责滚动以外的可见性变化：展开折叠内容、动画结束后才拿到尺寸等。
let _globalObserver = null

function getSharedObserver() {
  if (!_globalObserver) {
    _globalObserver = new IntersectionObserver((entries) => {
      const view = viewState()
      let changed = false
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const rec = _pending.get(entry.target)
        if (!rec || rec.state !== 'idle') continue
        _globalObserver.unobserve(entry.target)
        // entry.boundingClientRect 相对视口：换算回文档坐标，刷新扫描用的缓存
        const box = entry.boundingClientRect
        rec.top = box.top - view.base + view.top
        rec.bottom = box.bottom - view.base + view.top
        rec.w = box.width
        rec.h = box.height
        changed = true
      }
      // 交给扫描统一定序：可视区优先，其次预加载带，同类按文档顺序
      if (changed) scheduleScan()
    }, { rootMargin: `${PRELOAD_MARGIN}px` })
  }
  return _globalObserver
}

/**
 * 懒加载图片 — 视口优先 + IntersectionObserver 兜底
 * - 可视区内的元素最先发起请求（readImage priority='high'），预加载带其次
 * - 元素滚入可视区时，若请求仍在队列中会被提前（不会重复取图）
 * - 0×0 元素（display:none 子树等）不参与，等真正可见后再加载
 *
 * @param {string} filename 图片文件名
 * @param {number|string} maxWidth 可选的目标显示宽度提示（如 100 / '100px'）。
 *        传给 readImage 生成/直读对应尺寸的图片，减小 IPC 载荷；不传则返回原图
 */
export function useLazyImage(filename, maxWidth) {
  const [src, setSrc] = useState(null)
  const { readImage } = useDb()
  const ref = useRef(null)
  const loaded = useRef(false)
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    _revisionListeners.add(setRevision)
    ensureGlobalStarted()
    ensureScrollCheck()
    return () => { _revisionListeners.delete(setRevision) }
  }, [])

  const prevFilenameRef = useRef(null)

  useEffect(() => {
    if (!filename) return
    const el = ref.current
    if (!el) return

    // 仅 filename 变化时重置
    if (filename !== prevFilenameRef.current) {
      prevFilenameRef.current = filename
      loaded.current = false
      setSrc(null)
    }

    // 归一化尺寸提示：300 → 300；'100px' → 100；undefined → 原图
    const sizeHint = typeof maxWidth === 'number'
      ? (maxWidth > 0 ? Math.round(maxWidth) : undefined)
      : (parseInt(maxWidth || '', 10) > 0 ? parseInt(maxWidth, 10) : undefined)

    const rec = {
      el,
      top: 0, bottom: 0, w: 0, h: 0,
      hidden: false,
      state: 'idle',
      urgent: false,
      load: null,
      upgrade: null,
    }

    rec.load = (urgent) => {
      // 已经请求过：说明是「滚入可视区」的补充调用，只做优先级提升
      if (loaded.current) {
        if (urgent) readImage(filename, sizeHint, 'high')
        return
      }
      loaded.current = true
      const current = filename
      readImage(current, sizeHint, urgent ? 'high' : 'normal').then(data => {
        if (data && current === filename) {
          rec.state = 'done'
          setSrc(data)
        } else if (current === filename) {
          // 请求失败时允许后续重试，避免一次失败永久占位
          loaded.current = false
          rec.state = 'idle'
        }
      })
    }
    rec.upgrade = () => { readImage(filename, sizeHint, 'high') }

    const observer = getSharedObserver()
    const cleanup = () => {
      if (_pending.get(el) === rec) _pending.delete(el)
      observer.unobserve(el)
    }

    // 已加载过的元素：只要还有图就无需重来
    if (loaded.current && src) return

    const view = viewState()
    const m = measure(el, view)
    rec.top = m.top
    rec.bottom = m.bottom
    rec.w = m.w
    rec.h = m.h
    const where = locate(rec, view, PRELOAD_MARGIN)
    // 0×0 元素（display:none 子树、尚未布局）不参与同步加载，等可见后由
    // 观察器兜底；这里记录 hidden 让滚动扫描也跳过它。
    rec.hidden = where === 'unrendered'
    rec.state = loaded.current ? 'requested' : 'idle'
    _pending.set(el, rec)

    if (where === 'viewport' || where === 'band') {
      // 不当场加载：先让本批次的元素全部注册，再由扫描统一按「可视区优先」排序
      scheduleScan()
      return cleanup
    }

    // 注册到 IntersectionObserver（进入预加载带 / 由隐藏变可见时触发）
    observer.observe(el)

    return cleanup
  }, [filename, maxWidth, readImage, revision, src])

  return { ref, src }
}

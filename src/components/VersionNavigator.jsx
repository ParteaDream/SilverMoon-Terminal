import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

/**
 * 版本导航条 —— 把更新日志的长滚动条升级成可定位版本的导航轨。
 *
 * 布局（从左到右，贴在滚动容器右缘）：
 *
 *   内容 │← 刻度带 →│ 空隙 │ 轨道+滑块 │
 *
 * · 刻度带：版本刻度的**交互区**。它整体位于轨道左侧、向左加宽伸向内容，
 *   因此永远不会盖住右侧的滑块，滑块可以正常拖拽。
 * · 轨道 + 滑块：等价于原生滚动条，按下即定位、按住可拖拽。
 *
 * 刻度显示规则：
 * · 默认只显示每个系列的**首个版本**（x.0），并按系列上色、加长加粗；
 * · 指针进入某个系列的范围时，才展开该系列的全部刻度（避免 50+ 条挤在一起）。
 *
 * 位置全部由滚动容器实时几何算出，侧栏折叠 / 开发者工具栏 / 窗口缩放都会自动跟随。
 */

/** 导航条距窗口右缘 */
const EDGE_W = 2
/** 轨道宽度（与原生滚动条等宽） */
const TRACK_W = 6
/** 刻度带与轨道之间的空隙，保证两者交互区不重叠 */
const GAP_W = 6
/** 刻度带宽度 —— 交互区，向左加宽伸向内容 */
const BAND_W = 30
/** 导航条本体宽度 */
const RAIL_W = TRACK_W + GAP_W + BAND_W
/** 导航条与浮动按钮之间留的缝 */
const GAP_TO_BUTTONS_W = 8
/**
 * 浮动按钮的右侧偏移：紧贴导航条左侧、只留一条小缝。
 * 通过 --page-rail-reserve-w 广播给全局；没有导航条的页面由 CSS 回退到 0.5rem。
 */
const BUTTON_OFFSET_W = EDGE_W + RAIL_W + GAP_TO_BUTTONS_W
/**
 * 正文让出的右边距。
 *
 * 导航条是贴右缘的全高滚动条，浮动按钮又必须在它左边，两者叠加约 90px。
 * 默认窗口(1400)下 main 里正文的右缘距窗口右缘只有约 36px，塞不下这条车道，
 * 所以必须由正文让出空间——否则按钮只能压在卡片上。
 * 用 --page-rail-gutter-w 广播，由 index.css 施加到滚动容器。
 */
const CONTENT_GUTTER_W = 72

/**
 * 系列配色：直接沿用项目既有的元素配色（见 components/WorldTree.jsx 的 EC 表）。
 * 1.x 是风+岩的混合（渐变），2.x 雷、3.x 草、4.x 水、5.x 火、6.x/7.x 冰。
 */
const SERIES_TONE = {
  1: 'bg-gradient-to-r from-cyan-400 to-yellow-400', // 风 + 岩
  2: 'bg-purple-400', // 雷
  3: 'bg-green-400',  // 草
  4: 'bg-blue-400',   // 水
  5: 'bg-red-400',    // 火
  6: 'bg-sky-300',    // 冰
  7: 'bg-sky-300',    // 冰
}
const toneOf = major => SERIES_TONE[major] || 'bg-surface-400'

const majorOf = v => Number(String(v).split('.')[0]) || 0
const minorOf = v => Number(String(v).split('.')[1] ?? 0) || 0
const isSeriesStart = v => minorOf(v) === 0

export default function VersionNavigator({ versions, bottomInset = 0 }) {
  const railRef = useRef(null)
  const [marks, setMarks] = useState([])          // [{ version, offset }]
  const [view, setView] = useState({ scrollTop: 0, scrollHeight: 1, clientHeight: 1 })
  const [box, setBox] = useState(null)            // 滚动容器可视区 { top, bottom }
  const [vp, setVp] = useState(() => window.innerHeight)
  const [hoverMajor, setHoverMajor] = useState(null)   // 指针所在系列
  const [hover, setHover] = useState(null)             // 指针所在刻度

  const getScroller = () => document.querySelector('main')

  const measureView = useCallback(() => {
    const c = getScroller()
    if (!c) return
    const r = c.getBoundingClientRect()
    setView({ scrollTop: c.scrollTop, scrollHeight: c.scrollHeight || 1, clientHeight: c.clientHeight })
    setBox({ top: r.top, bottom: r.bottom })
    setVp(window.innerHeight)
  }, [])

  // 刻度偏移只在布局变化时重算（展开/收起、筛选、图片撑高、窗口缩放）
  const measureMarks = useCallback(() => {
    const c = getScroller()
    if (!c) return
    const cRect = c.getBoundingClientRect()
    const base = c.scrollTop
    const next = []
    c.querySelectorAll('[data-version]').forEach(el => {
      const r = el.getBoundingClientRect()
      next.push({ version: el.dataset.version, offset: Math.max(0, r.top - cRect.top + base) })
    })
    setMarks(next)
  }, [])

  const remeasure = useCallback(() => { measureView(); measureMarks() }, [measureView, measureMarks])

  useLayoutEffect(() => {
    const c = getScroller()
    if (!c) return
    c.classList.add('page-rail-scroll')
    const root = document.documentElement
    root.style.setProperty('--page-rail-reserve-w', `${BUTTON_OFFSET_W}px`)
    root.style.setProperty('--page-rail-gutter-w', `${CONTENT_GUTTER_W}px`)
    remeasure()
    return () => {
      c.classList.remove('page-rail-scroll')
      root.style.removeProperty('--page-rail-reserve-w')
      root.style.removeProperty('--page-rail-gutter-w')
    }
  }, [remeasure])

  useEffect(() => {
    const c = getScroller()
    if (!c) return
    let raf = 0
    const onScroll = () => {
      if (raf) return
      raf = requestAnimationFrame(() => { raf = 0; measureView() })
    }
    const onResize = () => remeasure()
    c.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onResize)

    const content = c.querySelector('[data-changelog-root]') || c.firstElementChild
    let ro = null
    if (content && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => remeasure())
      ro.observe(content)
    }
    return () => {
      if (raf) cancelAnimationFrame(raf)
      c.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onResize)
      ro?.disconnect()
    }
  }, [measureView, remeasure])

  useEffect(() => { measureMarks() }, [versions, measureMarks])

  const railH = box ? Math.max(0, vp - box.top - (vp - box.bottom) - 16 - bottomInset) : 0

  // 系列区间：按文档偏移把版本归到各个 x 系列，区间向下取到下一个系列的开头，
  // 这样指针落在刻度带任意位置都能唯一命中一个系列。
  const seriesRanges = useMemo(() => {
    const sorted = [...marks].sort((a, b) => a.offset - b.offset)
    const groups = []
    for (const m of sorted) {
      const maj = majorOf(m.version)
      const g = groups[groups.length - 1]
      if (!g || g.major !== maj) groups.push({ major: maj, start: m.offset, marks: [m] })
      else g.marks.push(m)
    }
    return groups.map((g, i) => ({ ...g, end: i + 1 < groups.length ? groups[i + 1].start : Infinity }))
  }, [marks])

  const activeVersion = useMemo(() => {
    const t = view.scrollTop + 48
    const sorted = [...marks].sort((a, b) => a.offset - b.offset)
    let cur = sorted[0]?.version ?? null
    for (const m of sorted) { if (m.offset <= t) cur = m.version; else break }
    return cur
  }, [marks, view.scrollTop])
  const activeMajor = activeVersion ? majorOf(activeVersion) : null

  // 默认只显示 x.0；指针所在系列展开全部刻度
  const visibleMarks = useMemo(
    () => marks.filter(m => isSeriesStart(m.version) || majorOf(m.version) === hoverMajor),
    [marks, hoverMajor],
  )

  const jumpTo = useCallback((offset) => {
    const c = getScroller()
    if (!c) return
    c.scrollTo({ top: Math.max(0, offset - 8), behavior: 'smooth' })
  }, [])

  const pctOf = (offset) => (offset / view.scrollHeight) * 100

  // 刻度带：只做"命中系列"判断，不参与滚动，所以不会和滑块抢事件
  const onBandMove = useCallback((e) => {
    const rail = railRef.current
    if (!rail) return
    const r = rail.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
    const offset = ratio * view.scrollHeight
    const hit = seriesRanges.find(s => offset >= s.start && offset < s.end)
    setHoverMajor(hit ? hit.major : null)
  }, [seriesRanges, view.scrollHeight])

  // 轨道：按下即定位并进入拖拽（与原生滚动条一致）
  const onTrackMouseDown = useCallback((e) => {
    const c = getScroller()
    const rail = railRef.current
    if (!c || !rail) return
    e.preventDefault()
    e.stopPropagation()
    const railRect = rail.getBoundingClientRect()
    const maxScroll = Math.max(0, c.scrollHeight - c.clientHeight)
    const apply = (clientY) => {
      const ratio = Math.min(1, Math.max(0, (clientY - railRect.top) / railRect.height))
      const target = ratio * c.scrollHeight - c.clientHeight / 2
      c.scrollTop = Math.max(0, Math.min(maxScroll, target))
    }
    apply(e.clientY)
    const onMove = (ev) => apply(ev.clientY)
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  if (!box || marks.length < 2 || railH < 80 || view.scrollHeight <= view.clientHeight + 40) return null

  const thumbTop = pctOf(view.scrollTop)
  const thumbH = Math.max(1.5, (view.clientHeight / view.scrollHeight) * 100)

  return (
    <div
      ref={railRef}
      data-version-rail=""
      onMouseLeave={() => { setHover(null); setHoverMajor(null) }}
      className="fixed z-[45] select-none"
      style={{ right: EDGE_W, top: box.top + 8, width: RAIL_W, height: railH }}
    >
      {/* ── 刻度带：交互区整体在轨道左侧，不会遮挡滑块 ── */}
      <div
        data-rail-band=""
        className="absolute top-0 bottom-0 cursor-pointer"
        style={{ right: TRACK_W + GAP_W, width: BAND_W }}
        onMouseMove={onBandMove}
      >
        {visibleMarks.map(m => {
          const start = isSeriesStart(m.version)
          const active = m.version === activeVersion
          const inActiveSeries = majorOf(m.version) === activeMajor
          const revealed = !start && majorOf(m.version) === hoverMajor
          return (
            <button
              key={m.version}
              type="button"
              onMouseEnter={() => setHover(m)}
              onClick={e => { e.stopPropagation(); jumpTo(m.offset) }}
              className="absolute right-0 flex items-center justify-end h-4 -mt-2"
              style={{ top: `${pctOf(m.offset)}%` }}
              aria-label={`跳转到版本 ${m.version}`}
              title={m.version}
            >
              {start ? (
                // x.0：系列首个版本 —— 加长加粗，用系列元素色
                <span
                  className={`block h-[4px] rounded-full ${toneOf(majorOf(m.version))} transition-all duration-150
                    ${active
                      ? 'w-[28px] opacity-100 shadow-[0_0_6px] shadow-current'
                      : inActiveSeries
                        ? 'w-[24px] opacity-95'
                        : 'w-[20px] opacity-45 hover:!opacity-100 hover:!w-[28px]'}`}
                />
              ) : (
                // 系列内的其余版本：展开时才出现
                <span
                  className={`block h-[2px] rounded-full transition-all duration-150
                    ${active ? 'w-[15px] bg-primary-300' : 'w-[9px] bg-surface-500 hover:!w-[16px] hover:!bg-primary-300'}
                    ${revealed ? 'opacity-100' : 'opacity-0'}`}
                />
              )}
            </button>
          )
        })}
      </div>

      {/* ── 轨道 + 滑块：等价于原生滚动条 ── */}
      <div
        data-rail-track=""
        onMouseDown={onTrackMouseDown}
        className="absolute right-0 top-0 bottom-0 w-[6px] rounded-full bg-surface-700/40 hover:bg-surface-700/70 transition-colors cursor-pointer"
      />
      <div
        data-rail-thumb=""
        className="absolute right-0 w-[6px] rounded-full bg-primary-500/75 pointer-events-none"
        style={{ top: `${thumbTop}%`, height: `${thumbH}%` }}
      />

      {/* 悬浮版本号 */}
      {hover && (
        <div
          className="absolute right-full mr-1.5 px-1.5 py-0.5 rounded-md whitespace-nowrap text-[11px] font-semibold
                     bg-surface-800 text-white border border-surface-600 shadow-xl pointer-events-none"
          style={{ top: `${pctOf(hover.offset)}%`, transform: 'translateY(-50%)' }}
        >
          {hover.version}
        </div>
      )}
    </div>
  )
}

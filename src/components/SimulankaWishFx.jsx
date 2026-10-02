// ═════════════════════════════════════════════════════════════════
// 希穆兰卡 · 祈愿动画层
// ─────────────────────────────────────────────────────────────────
// 还原原版祈愿动画的节奏（全部由代码绘制，素材取自本地图包）：
//   ① 蓄力  暗场 + 光尘汇聚
//   ② 星轨  一颗光点拖曳长尾划过画面（Canvas 逐帧绘制拖尾）
//           —— 若本批触发了「捕获明光」，流星飞行途中会绽放出彩色光芒
//   ③ 爆发  白闪 + 冲击环 + 星屑（五星金色 / 四星紫色 / 三星蓝色）
//   ④ 逐件展示  一次弹出 1 件：先呈黑色剪影（边缘带稀有度色光辉），再点亮为原图；
//           四/五星另有圆形冲击环与放射光，点亮完成后自动淡出；
//           点击任意位置弹下一件
//   ⑤ 罗列  网格列出本批全部结果，点击任意位置关闭
// 关闭「抽卡动画」时跳过 ①②③④，直接进入无动画的罗列。
//
// 说明：官方抽卡动画的星芒/光效是引擎内粒子特效（非 UI 贴图），公开图源
// 并不提供可用的透明序列帧，故这里以 Canvas + CSS 复刻其视觉语言，
// 而角色立绘 / 武器图全部使用图包原图。
// ═════════════════════════════════════════════════════════════════
import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { SkipForward } from 'lucide-react'
import { useShortcut } from '../context/ShortcutContext'
import useOverlay from '../hooks/useOverlay'
import { beginHeavyAnimation } from '../utils/animPerf'
import { StarRow, rarityStyle, useSimImages } from './SimulankaShared'

// 时间轴（ms）
const T_CHARGE = 520
const T_STREAK = 900
const T_BURST = 620
const T_END = T_CHARGE + T_STREAK + T_BURST
/** 剪影→点亮 的总时长（与 index.css 的 simulankaSilhouette / simulankaRekindle 对齐） */
const T_IGNITE = 1050

/** 捕获明光彩虹配色（流星绽放后使用） */
const RAINBOW = ['#ff6b9d', '#ffd166', '#6ee7b7', '#67c9ff', '#a78bfa', '#f0abfc']

const TONE = {
  5: { core: '#fffaf0', glow: '#ffb13f', trail: '#ffd68a', spark: '#ffe9bd' },
  4: { core: '#f8f0ff', glow: '#a256e1', trail: '#c79bf0', spark: '#e3ccff' },
  3: { core: '#eef6ff', glow: '#5b8fd6', trail: '#9dc0ea', spark: '#d3e5fb' },
}
const toneOf = (r) => TONE[r] || TONE[3]
const rainbowAt = (u) => RAINBOW[((Math.floor(u * 6) % 6) + 6) % 6]

function hexRgb(hex) {
  const h = String(hex).replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16)
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`
}

// ── Canvas 绘制 ──
function drawFrame(ctx, w, h, t, tone, radiance) {
  ctx.clearRect(0, 0, w, h)
  ctx.globalCompositeOperation = 'lighter'

  const cx = w * 0.5
  const cy = h * 0.46
  // 捕获明光：流星飞行到 55% 后开始绽放彩色光芒
  const bloom = radiance ? Math.max(0, Math.min(1, (t - (T_CHARGE + T_STREAK * 0.55)) / (T_STREAK * 0.45))) : 0
  const glow = bloom > 0 ? rainbowAt(t / 420) : tone.glow
  const trail = bloom > 0 ? rainbowAt(t / 420 + 0.3) : tone.trail
  const spark = bloom > 0 ? rainbowAt(t / 420 + 0.6) : tone.spark

  if (t < T_CHARGE) {
    // ① 蓄力：细碎光尘向中心汇聚
    const p = t / T_CHARGE
    const n = 46
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + p * 1.6
      const r0 = Math.max(w, h) * (0.42 + (i % 7) * 0.035)
      const r = r0 * (1 - p * 0.72)
      ctx.beginPath()
      ctx.fillStyle = `rgba(${hexRgb(spark)},${(0.10 + p * 0.42).toFixed(3)})`
      ctx.arc(cx + Math.cos(a) * r * 1.15, cy + Math.sin(a) * r * 0.78, 1.1 + (i % 3) * 0.7, 0, Math.PI * 2)
      ctx.fill()
    }
    return
  }

  if (t < T_CHARGE + T_STREAK) {
    // ② 星轨：光点沿贝塞尔曲线飞入，拖尾按历史点绘制
    const p = (t - T_CHARGE) / T_STREAK
    const ease = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2
    const x0 = -w * 0.18, y0 = h * 0.94
    const x1 = cx, y1 = cy
    const mx = w * 0.42, my = h * 0.12
    const bez = (u) => ({
      x: (1 - u) * (1 - u) * x0 + 2 * (1 - u) * u * mx + u * u * x1,
      y: (1 - u) * (1 - u) * y0 + 2 * (1 - u) * u * my + u * u * y1,
    })
    const head = bez(ease)
    const pts = []
    for (let i = 0; i < 34; i++) pts.push(bez(Math.max(0, ease - i * 0.016)))

    ctx.lineCap = 'round'
    for (let i = pts.length - 1; i > 0; i--) {
      const a = 1 - i / pts.length
      const seg = bloom > 0 ? rainbowAt(i / pts.length + t / 520) : trail
      ctx.beginPath()
      ctx.strokeStyle = `rgba(${hexRgb(seg)},${(a * a * (bloom > 0 ? 1 : 0.85)).toFixed(3)})`
      ctx.lineWidth = Math.max(0.6, 8 * a * (0.4 + p * 0.6) * (bloom > 0 ? 1.3 : 1))
      ctx.moveTo(pts[i].x, pts[i].y)
      ctx.lineTo(pts[i - 1].x, pts[i - 1].y)
      ctx.stroke()
    }
    const coreR = 74 + bloom * 46
    const g = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, coreR)
    g.addColorStop(0, `rgba(255,255,255,${0.85 + 0.15 * p})`)
    g.addColorStop(0.22, `rgba(${hexRgb(bloom > 0 ? rainbowAt(t / 320) : tone.core)},0.75)`)
    g.addColorStop(0.55, `rgba(${hexRgb(glow)},${0.32 + bloom * 0.3})`)
    g.addColorStop(1, `rgba(${hexRgb(glow)},0)`)
    ctx.beginPath(); ctx.fillStyle = g
    ctx.arc(head.x, head.y, coreR, 0, Math.PI * 2); ctx.fill()
    const spike = 46 + 30 * Math.sin(p * Math.PI) + bloom * 44
    ctx.strokeStyle = `rgba(255,255,255,${(0.5 * p).toFixed(3)})`
    ctx.lineWidth = 1.6
    ctx.beginPath()
    ctx.moveTo(head.x - spike, head.y); ctx.lineTo(head.x + spike, head.y)
    ctx.moveTo(head.x, head.y - spike * 0.85); ctx.lineTo(head.x, head.y + spike * 0.85)
    ctx.stroke()
    if (bloom > 0) {
      for (let k = 0; k < 6; k++) {
        const a0 = t / 900 + (k / 6) * Math.PI * 2
        ctx.beginPath()
        ctx.strokeStyle = `rgba(${hexRgb(RAINBOW[k])},${(0.6 * bloom).toFixed(3)})`
        ctx.lineWidth = 2.6
        ctx.arc(head.x, head.y, 40 + bloom * 130, a0, a0 + 1.0)
        ctx.stroke()
      }
    }
    return
  }

  // ③ 爆发：白闪 → 冲击环 → 星屑
  const p = Math.min(1, (t - T_CHARGE - T_STREAK) / T_BURST)

  if (p < 0.28) {
    ctx.fillStyle = `rgba(255,255,255,${((1 - p / 0.28) * 0.5).toFixed(3)})`
    ctx.fillRect(0, 0, w, h)
  }
  for (let k = 0; k < 3; k++) {
    const rp = Math.max(0, p - k * 0.13)
    if (rp <= 0) continue
    ctx.beginPath()
    ctx.strokeStyle = radiance
      ? `rgba(${hexRgb(rainbowAt(k / 3 + t / 320))},${(0.6 * (1 - rp)).toFixed(3)})`
      : `rgba(${hexRgb(tone.glow)},${(0.5 * (1 - rp)).toFixed(3)})`
    ctx.lineWidth = Math.max(1, 9 * (1 - rp))
    ctx.arc(cx, cy, Math.min(w, h) * 0.62 * rp, 0, Math.PI * 2)
    ctx.stroke()
  }
  const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, 200 * (0.35 + p))
  halo.addColorStop(0, `rgba(255,255,255,${(0.75 * (1 - p)).toFixed(3)})`)
  halo.addColorStop(0.3, `rgba(${hexRgb(radiance ? rainbowAt(t / 280) : tone.glow)},${(0.5 * (1 - p)).toFixed(3)})`)
  halo.addColorStop(1, `rgba(${hexRgb(tone.glow)},0)`)
  ctx.beginPath(); ctx.fillStyle = halo
  ctx.arc(cx, cy, 200 * (0.35 + p), 0, Math.PI * 2); ctx.fill()

  const N = 64
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 + (i % 5) * 0.31
    const speed = 0.5 + ((i * 37) % 100) / 100
    const r = Math.min(w, h) * 0.7 * p * speed
    const alpha = Math.max(0, 0.85 * (1 - p * 1.15))
    if (alpha <= 0) continue
    ctx.beginPath()
    ctx.fillStyle = `rgba(${hexRgb(radiance ? RAINBOW[i % RAINBOW.length] : tone.spark)},${alpha.toFixed(3)})`
    ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.82, 1.6 * (1 - p) + 0.4, 0, Math.PI * 2)
    ctx.fill()
  }
}

// ═════════════════════════════════════════════════════════════════
// 动画层
// ═════════════════════════════════════════════════════════════════
/**
 * @param {object[]} records 本次抽卡记录（1 条 = 单抽，10 条 = 十连）
 * @param {() => void} onDone 动画结束（含跳过）
 * @param {string} poolName 卡池名
 * @param {boolean} active 本应用是否为当前顶层窗口（全局键位闸门）
 * @param {boolean} animations 抽卡动画开关；关闭时直接进入无动画罗列
 */
export default function SimulankaWishFx({
  records = [], onDone, poolName = '', active = true, animations = true,
}) {
  const canvasRef = useRef(null)
  const [phase, setPhase] = useState(animations === false ? 'grid' : 'charge')  // charge | showcase | grid
  const [showIdx, setShowIdx] = useState(0)
  const rafRef = useRef(0)
  const startRef = useRef(0)
  const doneRef = useRef(false)

  const isTen = records.length > 1
  const bestRarity = useMemo(() => records.reduce((m, r) => Math.max(m, r.rarity || 3), 3), [records])
  /** 本批是否触发捕获明光（五彩流星） */
  const radiance = useMemo(() => records.some(r => r.crTriggered), [records])
  const tone = toneOf(bestRarity)
  const st = rarityStyle(bestRarity)

  const finish = useCallback(() => {
    if (doneRef.current) return
    doneRef.current = true
    cancelAnimationFrame(rafRef.current)
    onDone?.()
  }, [onDone])

  /** 跳过祈愿动画：只结束「星轨/爆发」，进入逐件展示（不直接跳到罗列） */
  const skipAnimation = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    setPhase('showcase')
  }, [])

  /** 跳过剩余的逐件展示：直接进入罗列 */
  const skipShowcase = useCallback(() => {
    setPhase('grid')
  }, [])

  /** 推进：蓄力 → 逐件展示 → 罗列 */
  const advance = useCallback(() => {
    if (phase === 'charge') {
      cancelAnimationFrame(rafRef.current)
      setPhase(animations === false ? 'grid' : 'showcase')
      return
    }
    if (phase === 'showcase') {
      if (showIdx + 1 < records.length) setShowIdx(i => i + 1)
      else setPhase('grid')
      return
    }
    finish()
  }, [phase, showIdx, records.length, animations, finish])

  const ov = useOverlay({
    open: true,
    onClose: advance,
    label: '祈愿动画',
    initialFocus: 'none',
    trap: false,
  })

  // 空格 = 点击推进
  useShortcut('simulanka.fx-advance', {
    keys: [' '],
    scope: 'app',
    when: () => active,
    handler: (e) => { e.preventDefault(); advance() },
  })

  // Canvas 逐帧（仅蓄力阶段）
  useEffect(() => {
    if (phase !== 'charge') return
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const resize = () => {
      const r = canvas.getBoundingClientRect()
      canvas.width = Math.max(1, Math.round(r.width * dpr))
      canvas.height = Math.max(1, Math.round(r.height * dpr))
    }
    resize()
    const ctx = canvas.getContext('2d')
    const stopHeavy = beginHeavyAnimation(T_END + 400)
    startRef.current = performance.now()
    const loop = (now) => {
      const t = now - startRef.current
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const r = canvas.getBoundingClientRect()
      drawFrame(ctx, r.width, r.height, t, tone, radiance)
      if (t >= T_END) { setPhase(animations === false ? 'grid' : 'showcase'); return }
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    const onResize = () => resize()
    window.addEventListener('resize', onResize)
    return () => {
      cancelAnimationFrame(rafRef.current)
      window.removeEventListener('resize', onResize)
      stopHeavy()
    }
  }, [phase, tone, radiance, animations])

  const artFiles = useMemo(() => records.flatMap(r => [r.splash || r.art]).filter(Boolean), [records])
  const imgMap = useSimImages(artFiles)

  const current = records[showIdx]

  return (
    <div ref={ov.overlayRef} {...ov.overlayProps}
      className="absolute inset-0 z-40 overflow-hidden select-none" style={{ background: 'rgba(3,5,12,0.94)' }}>

      {/* 背景氛围 */}
      <div
        className="absolute inset-0 transition-opacity duration-500"
        style={{
          background: radiance
            ? `radial-gradient(58% 48% at 50% 46%, #ffffff20 0%, transparent 70%),
               conic-gradient(from 0deg at 50% 46%, #ff6b9d26, #ffd16626, #6ee7b726, #67c9ff26, #a78bfa26, #f0abfc26, #ff6b9d26)`
            : `radial-gradient(60% 50% at 50% 46%, ${tone.glow}2e 0%, transparent 70%),
               radial-gradient(100% 80% at 50% 120%, ${tone.glow}18 0%, transparent 60%)`,
          opacity: phase === 'charge' ? 1 : 0.92,
        }}
      />
      <canvas ref={canvasRef} className={`absolute inset-0 w-full h-full ${phase === 'charge' ? '' : 'hidden'}`} />

      {/* ── ① ② ③ 祈愿动画阶段：点按任意位置 = 跳过动画，进入逐件展示 ── */}
      {phase === 'charge' && (
        <>
          {/*
            ⚠️ 整屏按钮必须显式写 hover: 类。
            index.css 有一条全局规则 `button:where(:not([class*="hover:"])):hover`
            会给按钮刷上 surface-800 底色 —— 整屏按钮漏了它就变成一整块深灰，
            把底下的 Canvas 动画全盖住，用户观感就是「抽卡动画消失了」。
            注意：测试脚本用 element.click() 不触发 :hover，端到端测试永远发现不了，
            所以补了 audit 规则 overlayButtonNoHover 做静态兜底。
          */}
          <button
            type="button"
            aria-label="跳过祈愿动画"
            onClick={skipAnimation}
            className="absolute inset-0 z-10 cursor-pointer bg-transparent hover:bg-transparent"
          />
          <p className="absolute bottom-5 inset-x-0 z-10 text-center text-[10px] text-white/40 pointer-events-none">
            点击任意位置跳过
          </p>
        </>
      )}

      {/* ── ④ 逐件展示 ── */}
      {phase === 'showcase' && current && (
        <ShowcaseItem
          key={current.seq ?? showIdx}
          record={current}
          index={showIdx}
          total={records.length}
          imgMap={imgMap}
          onNext={advance}
        />
      )}

      {/* ── ⑤ 罗列 ── */}
      {phase === 'grid' && (
        <ResultGrid records={records} imgMap={imgMap} animations={animations} isTen={isTen} st={st} onDone={finish} />
      )}

      {/* 顶部：卡池名 + 跳过 */}
      <div className="absolute top-0 inset-x-0 flex items-center justify-between px-4 py-3 pointer-events-none">
        <span className="text-[11px] text-white/45 tracking-wider">
          {poolName}
          {radiance && phase !== 'grid' && (
            <span className="ml-2 px-1.5 py-0.5 rounded border border-white/25 text-white/85"
              style={{ background: 'linear-gradient(90deg,#ff6b9d44,#ffd16644,#6ee7b744,#67c9ff44,#a78bfa44)' }}>
              捕获明光
            </span>
          )}
        </span>
        {phase === 'showcase' && (
          <button
            type="button"
            onClick={skipShowcase}
            className="pointer-events-auto flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] bg-white/5 hover:bg-white/10 border border-white/15 text-white/70 transition-colors"
          >
            <SkipForward className="w-3 h-3" aria-hidden="true" />
            跳过剩余
          </button>
        )}
      </div>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════
// 逐件展示：仅图片 + 名称 + 星级
//   四/五星：先出现黑色剪影（边缘带稀有度色光辉），随后点亮为原图；
//            点亮完成后圆形特效与辉光自动淡出（不再常驻）
//   点击任意位置推进（无按钮），底部只给小字提示
// ═════════════════════════════════════════════════════════════════
function ShowcaseItem({ record, index, total, imgMap, onNext }) {
  const r = record.rarity || 3
  const st = rarityStyle(r)
  const file = record.splash || record.art
  const src = imgMap[file]
  const fancy = r === 5 || r === 4

  // 特效播完后隐藏圆形特效与辉光
  const [settled, setSettled] = useState(!fancy)
  useEffect(() => {
    if (!fancy) { setSettled(true); return }
    setSettled(false)
    const t = setTimeout(() => setSettled(true), T_IGNITE)
    return () => clearTimeout(t)
  }, [record.seq, index, fancy])

  return (
    <div className="absolute inset-0 animate-fade-in">
      {/* 整屏点击推进（透明、无 hover 底色，避免整屏发灰） */}
      <button type="button" aria-label="下一件" onClick={onNext}
        className="absolute inset-0 cursor-pointer bg-transparent hover:bg-transparent" />

      {/* 星级专属背景特效：点亮完成后淡出 */}
      <div className="absolute inset-0 pointer-events-none transition-opacity duration-500"
        style={{ opacity: settled ? 0 : 1 }} aria-hidden="true">
        {r === 5 && <FiveStarFx color={st.hex} />}
        {r === 4 && <FourStarFx color={st.hex} />}
      </div>

      {/* 徽标（UP / 大保底 / 捕获明光） */}
      <div className="absolute top-[38px] inset-x-0 flex items-center justify-center gap-2 pointer-events-none" style={{ minHeight: 22 }}>
        {record.isUp && (
          <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-amber-400/25 border border-amber-300/50 text-amber-100">UP</span>
        )}
        {record.guaranteeUsed && (
          <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-white/10 border border-white/25 text-white/80">大保底</span>
        )}
        {record.crTriggered && (
          <span className="text-[11px] px-2.5 py-0.5 rounded-full border border-white/30 text-white/90"
            style={{ background: 'linear-gradient(90deg,#ff6b9d55,#ffd16655,#6ee7b755,#67c9ff55,#a78bfa55)' }}>
            捕获明光
          </span>
        )}
      </div>

      {/*
        图片区：外层 absolute inset-0 + grid-template 100%/100% —— 行列都是确定尺寸，
        图片的 height:100% 才能真正解析（此前用 auto 行 + 百分比高度，浏览器按 auto 处理，
        竖构图的武器图于是按原始尺寸渲染而溢出下边缘）。
        人物/武器一律 object-contain 完整显示：立绘在 2:1 画布里本就占满整个高度，
        任何 >100% 的放大会把头顶与脚底裁掉（此前 190% 就是「大的看不到」的原因）。
      */}
      <div className="absolute inset-x-0 top-[76px] bottom-[92px] grid place-items-center overflow-hidden pointer-events-none"
        style={{ gridTemplate: '100% / 100%' }}>
        {fancy && (
          <img
            src={src} alt="" aria-hidden="true" draggable={false}
            className="object-contain animate-[simulankaSilhouette_1.05s_ease-out_both]"
            style={{
              gridArea: '1 / 1',
              height: '100%', width: 'auto', maxWidth: 'none',
              filter: `brightness(0) drop-shadow(0 0 14px ${st.hex}) drop-shadow(0 0 34px ${st.hex})`,
            }}
          />
        )}
        <img
          src={src} alt={record.name} draggable={false}
          className="object-contain"
          style={{
            gridArea: '1 / 1',
            height: '100%', width: 'auto', maxWidth: 'none',
            animation: fancy
              ? 'simulankaRekindle 1.05s cubic-bezier(0.2,0.8,0.3,1) both'
              : 'scaleIn 0.28s ease-out',
          }}
        />
      </div>

      {/* 名称 + 星级（无稀有度底衬、无「三星·xx」文案） */}
      <div className="absolute bottom-[52px] inset-x-0 flex flex-col items-center pointer-events-none">
        <span className={`font-medium ${r === 5 ? 'text-white' : 'text-white/90'}`}
          style={{ fontSize: r === 5 ? 22 : 18 }}>{record.name}</span>
        <StarRow count={r} size={r === 5 ? 16 : 13} color={r === 5 ? '#ffd77a' : r === 4 ? '#d9b6f5' : '#9dc0ea'} />
      </div>

      {/* 进度点 + 底部提示 */}
      <div className="absolute bottom-[10px] inset-x-0 flex flex-col items-center gap-1 pointer-events-none">
        <div className="flex items-center gap-1.5">
          {Array.from({ length: total }, (_, i) => (
            <span key={i} className="w-1.5 h-1.5 rounded-full"
              style={{ background: i < index ? 'rgba(255,255,255,0.5)' : i === index ? st.hex : 'rgba(255,255,255,0.16)' }} />
          ))}
        </div>
        <p className="text-[10px] text-white/40">点击任意位置{index + 1 < total ? `（${index + 2}/${total}）` : '查看全部'}</p>
      </div>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════
// 罗列：按容器实测尺寸自适应排列；点击任意位置关闭
// ═════════════════════════════════════════════════════════════════
function ResultGrid({ records, imgMap, animations, isTen, st, onDone }) {
  const boxRef = useRef(null)
  const [box, setBox] = useState({ w: 1100, h: 560 })
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const update = () => {
      const r = el.getBoundingClientRect()
      if (r.width > 0 && r.height > 0) setBox({ w: r.width, h: r.height })
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const cols = isTen ? 5 : 1
  const rows = Math.max(1, Math.ceil(records.length / cols))
  const GAP = 12
  const titleH = 30
  const hintH = 46
  const availW = Math.max(120, box.w - 32)
  const availH = Math.max(120, box.h - titleH - hintH)
  // 卡面宽高比 ≈ 1 : 1.24（图区 + 名称区）
  const byW = (availW - GAP * (cols - 1)) / cols
  const byH = ((availH - GAP * (rows - 1)) / rows) / 1.24
  const cardW = Math.max(96, Math.min(isTen ? 320 : 420, Math.floor(Math.min(byW, byH))))
  const artH = Math.round(cardW * 0.96)

  return (
    <div ref={boxRef} className="absolute inset-0 flex flex-col items-center justify-center px-4 py-4">
      <div className={`mb-2 text-xs tracking-[0.4em] ${st.text} opacity-85 shrink-0`}>
        {isTen ? '十 连 祈 愿' : '祈 愿 结 果'}
      </div>

      <div className="flex-1 min-h-0 w-full flex items-center justify-center">
        <div className="grid justify-items-center" style={{ gridTemplateColumns: `repeat(${cols}, ${cardW}px)`, gap: GAP }}>
          {records.map((r, i) => {
            const rs = rarityStyle(r.rarity)
            const s = imgMap[r.splash || r.art]
            const isChar = (r.itemType || r.type) === 'character'
            return (
              <div
                key={r.seq ?? i}
                className={animations === false ? '' : 'animate-[scaleIn_0.32s_ease-out_both]'}
                style={animations === false ? undefined : { animationDelay: `${i * 45}ms` }}
              >
                <div className={`relative rounded-lg overflow-hidden border ${rs.border}`}
                  style={{ width: cardW, background: `linear-gradient(180deg, ${rs.hex}22, rgba(0,0,0,0.35))` }}>
                  <div className="relative overflow-hidden" style={{ height: artH }}>
                    {s
                      ? <img src={s} alt={r.name} draggable={false}
                          className={`w-full h-full ${isChar ? 'object-cover object-center' : 'object-contain p-1'}`} />
                      : <div className="w-full h-full" />}
                    <div className="absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-black/55 to-transparent" />
                  </div>
                  <div className="px-2 py-1">
                    <div className="truncate text-white/90" style={{ fontSize: Math.max(10, Math.round(cardW * 0.062)) }}>{r.name}</div>
                    <div className="flex items-center gap-1.5">
                      <span style={{ color: rs.hex, fontSize: Math.max(8, Math.round(cardW * 0.048)) }}>{'★'.repeat(r.rarity)}</span>
                      {r.element && <span className="text-[9px] text-white/45">{r.element}</span>}
                    </div>
                  </div>
                </div>
                <div className={`mt-0.5 text-center text-[11px] ${rs.text} tabular-nums h-4`}>
                  {r.rarity === 5 ? `第 ${r.pity5} 抽` : r.rarity === 4 ? `第 ${r.pity4} 抽` : ''}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="h-[46px] flex items-center justify-center shrink-0 pointer-events-none">
        <p className="text-[10px] text-white/40">点击任意位置继续</p>
      </div>

      {/* 整屏点击继续 */}
      <button type="button" aria-label="继续" onClick={onDone}
        className="absolute inset-0 cursor-pointer bg-transparent hover:bg-transparent" />
    </div>
  )
}

/**
 * 居中容器：外层负责 translate 定位、内层负责缩放动画。
 * 关键：CSS 关键帧 scaleIn 写的是 `transform: scale(...)`，会整体覆盖 transform，
 * 若与 Tailwind 的 `-translate-x-1/2 -translate-y-1/2` 写在同一元素上，
 * 动画期间位移会被冲掉（圆先出现在右下角、动画结束才瞬移回中心）。
 */
function CenteredFx({ size, animClass = '', style, children }) {
  return (
    <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
      style={{ width: size, height: size }}>
      <div className={`w-full h-full relative ${animClass}`} style={style} aria-hidden="true">
        {children}
      </div>
    </div>
  )
}

/** 四星特效：紫色冲击环 + 四向放射光 */
function FourStarFx({ color }) {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      <CenteredFx size="min(78vh, 600px)" animClass="animate-[scaleIn_0.7s_ease-out]"
        style={{ borderRadius: '9999px', border: `2px solid ${color}88`, boxShadow: `0 0 60px ${color}55, inset 0 0 90px ${color}33` }} />
      <CenteredFx size="min(115vh, 900px)" animClass="animate-[scaleIn_0.85s_ease-out]"
        style={{
          background: `conic-gradient(from 0deg, ${color}00 0deg, ${color}55 8deg, ${color}00 16deg,
            ${color}00 90deg, ${color}44 98deg, ${color}00 106deg,
            ${color}00 180deg, ${color}55 188deg, ${color}00 196deg,
            ${color}00 270deg, ${color}44 278deg, ${color}00 286deg)`,
          maskImage: 'radial-gradient(circle, #000 14%, transparent 62%)',
          WebkitMaskImage: 'radial-gradient(circle, #000 14%, transparent 62%)',
          opacity: 0.8,
        }} />
    </div>
  )
}

/** 五星特效：金色放射光 + 双层冲击环 + 上升星屑 + 大范围金雾（最华丽） */
function FiveStarFx({ color }) {
  // 24 条放射光（每 15° 一条，主瓣更亮）
  const rays = Array.from({ length: 24 }, (_, i) => {
    const a = i * 15
    const w = i % 2 === 0 ? 4 : 2.4
    const alpha = i % 2 === 0 ? 0.5 : 0.3
    return `${color}00 ${a}deg, ${color}${Math.round(alpha * 255).toString(16).padStart(2, '0')} ${a + w / 2}deg, ${color}00 ${a + w}deg`
  }).join(', ')

  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      <div className="absolute inset-0 animate-[fadeIn_0.8s_ease-out]"
        style={{ background: `radial-gradient(48% 42% at 50% 44%, ${color}3d 0%, transparent 72%)` }} />

      <CenteredFx size="min(180vh, 1340px)" animClass="animate-[scaleIn_0.85s_cubic-bezier(0.2,0.9,0.25,1.05)]"
        style={{
          background: `conic-gradient(from 0deg, ${rays})`,
          maskImage: 'radial-gradient(circle, #000 10%, rgba(0,0,0,0.5) 36%, transparent 70%)',
          WebkitMaskImage: 'radial-gradient(circle, #000 10%, rgba(0,0,0,0.5) 36%, transparent 70%)',
        }} />

      <CenteredFx size="min(96vh, 730px)" animClass="animate-[scaleIn_0.9s_ease-out]"
        style={{ borderRadius: '9999px', border: `2px solid ${color}99`, boxShadow: `0 0 90px ${color}66` }} />
      <CenteredFx size="min(132vh, 1010px)" animClass="animate-[scaleIn_1.15s_ease-out]"
        style={{ borderRadius: '9999px', border: `1px solid ${color}55` }} />

      {Array.from({ length: 28 }, (_, i) => (
        <span key={i} className="absolute rounded-full"
          style={{
            left: `${6 + ((i * 37) % 88)}%`,
            bottom: '-4%',
            width: 2 + (i % 3),
            height: 2 + (i % 3),
            background: i % 4 === 0 ? '#fff6dd' : color,
            boxShadow: `0 0 8px ${color}`,
            animation: `simulankaRise ${1.6 + (i % 5) * 0.24}s ease-out ${(i % 7) * 0.07}s both`,
            opacity: 0.85,
          }} />
      ))}
    </div>
  )
}

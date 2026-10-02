// ═════════════════════════════════════════════════════════════════
// 希穆兰卡 · 合成卡池背景
// ─────────────────────────────────────────────────────────────────
// 不使用「祈愿」板块的卡池图作为主视觉（比例不一、分辨率参差），改为
// 「数据库图片 + 代码 + 字体」合成，排版参照官方卡池图：
//
//   左   卡池名（大字，完整显示不省略）+「祈愿开启」+ 主题色祈愿类型标签
//        （四芒星 + 色块）+ 虚线分隔
//   中   核心五星：角色立绘整幅显示（不裁切）/ 武器池两把五星武器紧贴并排
//   右   四星阵容：角色为纵向错位重叠堆叠（下方图层更上、中间向右偏），
//        武器为紧贴聚拢的一组
//   集录 / 常驻：五星较多，分为「角色胶囊 + 武器方砖」两行并排铺满，
//        角色只取图片中心 1/7 宽度区域，两者都不写名称与稀有度
//
// 背景（参照官方卡池图）：
//   角色活动祈愿 —— 近白浅色底 + 主题色区域，两者之间为明显的「曲线」分界
//   武器活动祈愿 —— 近白浅色底 + 主题色区域，两者的分界是一条「垂直直线」，
//                   且两把五星武器背后有一个大圆
//   集录 / 常驻   —— 保持主题色深底（官方集录池即为深蓝星空）
// 主题色：角色池取五星 UP 角色元素色；武器池固定橙色；集录池蓝色；常驻池紫色。
// 图片一律使用图包原图（不缩略），避免放大后发糊。
// ═════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useRef, useState } from 'react'
import { poolTheme, shade, hexToRgba, FourPointStar, StarRow, useSimImages } from './SimulankaShared'

/** 角色卡池立绘 2048×1024（2:1，人物居中、四周透明） */
const CHAR_ASPECT = 2
/** 武器卡池图 512×1024（1:2，竖构图） */
const WEAPON_ASPECT = 0.5
/** 集录/常驻的角色胶囊只取原图中心该比例宽度 */
const CAPSULE_CROP = 1 / 7

/** 武器池共用几何：分界线要与大圆中轴对齐，父组件与 WeaponLineup 必须用同一套解算 */
function weaponGeometry({ w, availW, availH, leftW, padX, n4 }) {
  // 武器图 512×1024，画面主体只占画布中间约一半宽度，两侧是透明外框，
  // 因此可以大胆负重叠：让「画面主体」真正贴在一起。
  const OVERLAP5 = 0.58     // 五星两把的框重叠比例
  const STEP4 = 0.42        // 四星相邻两把的水平步进（按框宽比例）
  const GROUP_GAP = Math.max(10, Math.round(availH * 0.035))
  const avail = Math.max(160, availW - GROUP_GAP)
  const k5 = WEAPON_ASPECT * (2 - OVERLAP5)
  const k4 = WEAPON_ASPECT * 0.56 * (1 + STEP4 * Math.max(0, n4 - 1))
  const h5 = Math.max(80, Math.min(availH * 0.96, avail / Math.max(0.3, k5 + k4)))
  const w5 = h5 * WEAPON_ASPECT
  const h4 = h5 * 0.56
  const w4 = h4 * WEAPON_ASPECT
  const step4 = w4 * STEP4
  const group4W = n4 > 0 ? step4 * (n4 - 1) + w4 : 0
  const group5W = w5 * k5 / WEAPON_ASPECT   // = w5·(2 − OVERLAP5)
  const rightEdge = w - padX
  const group4Left = rightEdge - group4W
  const group5Left = group4Left - GROUP_GAP - group5W
  // 大圆中轴 = 五星组中心（官方卡池图即如此）
  const circleCX = group5Left + group5W / 2
  return { OVERLAP5, STEP4, GROUP_GAP, h5, w5, h4, w4, step4, group4W, group5W, group4Left, group5Left, circleCX }
}

/** 观测容器尺寸，按比例排版 */
function useBoxSize() {
  const ref = useRef(null)
  const [box, setBox] = useState({ w: 900, h: 380 })
  useEffect(() => {
    const el = ref.current
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
  return [ref, box]
}

/** 各池阵容构成 */
function lineup(pool) {
  if (!pool) return { kind: 'empty' }
  if (pool.kind === 'character') return { kind: 'character', main: pool.up5[0] || null, side: (pool.up4 || []).slice(0, 3) }
  if (pool.kind === 'weapon') return { kind: 'weapon', main: (pool.up5 || []).slice(0, 2), side: (pool.up4 || []).slice(0, 5) }
  const list = pool.kind === 'chronicled' ? (pool.pool5 || []) : (pool.standard5 || [])
  return {
    kind: 'multi',
    chars: list.filter(i => i.type === 'character'),
    weapons: list.filter(i => i.type === 'weapon'),
  }
}

export default function SimulankaBanner({ pool }) {
  const [ref, { w, h }] = useBoxSize()
  const theme = useMemo(() => poolTheme(pool), [pool])
  const lu = useMemo(() => lineup(pool), [pool])

  // 原图直出（不传 maxWidth）：放大到整幅高度后仍保持锐利
  const files = useMemo(() => {
    if (!pool) return []
    if (lu.kind === 'character') return [lu.main, ...lu.side].filter(Boolean).map(it => it.splash || it.art).filter(Boolean)
    if (lu.kind === 'weapon') return [...lu.main, ...lu.side].map(it => it.splash || it.art).filter(Boolean)
    if (lu.kind === 'multi') return [...lu.chars, ...lu.weapons].map(it => it.splash || it.art).filter(Boolean)
    return []
  }, [pool, lu])
  const imgMap = useSimImages(files)

  const leftW = Math.max(168, Math.min(340, w * 0.235))
  const padX = 18
  const availW = Math.max(160, w - leftW - padX * 2)
  const availH = Math.max(120, h - 20)

  const S = Math.max(0.6, Math.min(1.4, h / 380))
  const nameSize = Math.round(Math.max(10, Math.min(17, 13 * S)))

  if (!pool) return <div className="absolute inset-0 bg-surface-950" />

  const src = (it) => (it ? imgMap[it.splash || it.art] : null)
  const name = pool.bannerName || '祈愿'
  // 卡池名完整显示：按字数自适应字号，绝不省略
  const titleSize = Math.round(Math.max(17, Math.min(42, ((leftW - 10) * 1.9) / Math.max(3, Math.min(9, name.length)))))

  // 武器池：分界线取「大圆中轴 + 8.5% 画布宽」（与官方卡池图的比例一致）
  const weaponGeo = pool.kind === 'weapon'
    ? weaponGeometry({ w, availW, availH, leftW, padX, n4: (pool.up4 || []).length })
    : null
  const dividerPct = weaponGeo ? ((weaponGeo.circleCX + w * 0.085) / w) * 100 : 72

  // 角色池 / 武器池走官方那种「近白浅底 + 主题色区」的浅色方案，文字用深色
  const light = pool.kind === 'character' || pool.kind === 'weapon'
  const ink = light ? '#2b2833' : '#ffffff'
  const inkSoft = light ? 'rgba(58,54,70,0.72)' : 'rgba(255,255,255,0.6)'
  const LIGHT_BG = '#f3f0ea'
  // 官方武器池右侧是一块明亮的橙色面板（而非深色），角色池右侧保持深色以衬托立绘
  const panelFrom = pool.kind === 'weapon' ? shade(theme.main, 0.30) : theme.from
  const panelTo = pool.kind === 'weapon' ? shade(theme.main, -0.10) : theme.to

  return (
    <div ref={ref} className="absolute inset-0 overflow-hidden"
      style={{ background: light ? LIGHT_BG : `linear-gradient(160deg, ${theme.from} 0%, ${theme.to} 100%)` }}>

      {/* ── 主题色区域与分界线 ── */}
      {light ? (
        <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="sim-theme-grad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={panelFrom} />
              <stop offset="100%" stopColor={panelTo} />
            </linearGradient>
          </defs>
          {/* 角色池：曲线分界；武器池：垂直直线分界 */}
          <path
            d={pool.kind === 'weapon'
              ? `M ${dividerPct.toFixed(2)},0 L 100,0 L 100,100 L ${dividerPct.toFixed(2)},100 Z`
              : 'M 36,0 C 23,26 23,74 38,100 L 100,100 L 100,0 Z'}
            fill="url(#sim-theme-grad)"
          />
        </svg>
      ) : (
        <div className="absolute inset-0" style={{
          background: `radial-gradient(58% 70% at 62% 42%, ${hexToRgba(theme.main, 0.30)} 0%, transparent 66%),
                       radial-gradient(40% 60% at 14% 82%, ${hexToRgba(theme.main, 0.16)} 0%, transparent 70%)`,
        }} />
      )}

      {/* 浅色方案下给主题色区域加一层柔光，避免色块发死 */}
      {light && (
        <div className="absolute inset-0 pointer-events-none" style={{
          background: pool.kind === 'weapon'
            ? `radial-gradient(64% 76% at 84% 42%, ${hexToRgba(shade(theme.main, 0.42), 0.55)} 0%, transparent 70%)`
            : `radial-gradient(60% 70% at 72% 45%, ${hexToRgba(theme.main, 0.28)} 0%, transparent 68%),
               radial-gradient(40% 60% at 100% 100%, ${hexToRgba(theme.main, 0.22)} 0%, transparent 60%)`,
        }} />
      )}

      {/* 织物斜纹（浅底用深色纹，深底用浅色纹） */}
      <div className="absolute inset-0 pointer-events-none" style={{
        opacity: light ? 0.035 : 0.055,
        backgroundImage: `repeating-linear-gradient(115deg, ${light ? '#000' : '#fff'} 0px, ${light ? '#000' : '#fff'} 1px, transparent 1px, transparent 9px)`,
      }} />

      {/* ── 阵容层 ── */}
      <div className="absolute inset-0">
        {lu.kind === 'character' && (
          <CharacterLineup lu={lu} src={src} h={h} availH={availH} availW={availW} rightInset={padX} nameSize={nameSize} />
        )}
        {lu.kind === 'weapon' && (
          <WeaponLineup lu={lu} src={src} h={h} geo={weaponGeo} rightInset={padX} nameSize={nameSize} theme={theme} />
        )}
        {lu.kind === 'multi' && (
          <MultiLineup lu={lu} src={src} w={w} h={h} availH={availH} leftW={leftW} padX={padX} theme={theme} />
        )}
      </div>

      {/* ── 左：卡池名 + 类型标签 ── */}
      <div className="absolute left-0 inset-y-0 flex flex-col justify-center gap-2" style={{ width: leftW, paddingLeft: padX }}>
        <h3 className="font-medium tracking-wide leading-[1.15]"
          style={{ fontSize: titleSize, color: ink, textShadow: light ? '0 1px 0 rgba(255,255,255,0.5)' : '0 2px 10px rgba(0,0,0,0.85)' }}>
          {name}
        </h3>
        <p style={{ fontSize: Math.max(10, Math.round(12 * S)), color: inkSoft }}>祈愿开启</p>
        <span className="inline-flex items-center gap-1.5 rounded-[3px] px-2 py-1 border self-start"
          style={{
            background: `linear-gradient(90deg, ${hexToRgba(theme.main, 0.95)} 0%, ${hexToRgba(shade(theme.main, -0.25), 0.88)} 100%)`,
            borderColor: hexToRgba(shade(theme.main, 0.45), 0.65),
            boxShadow: `0 2px 12px ${hexToRgba(theme.main, 0.35)}`,
          }}>
          <FourPointStar size={Math.round(12 * S)} color="rgba(255,255,255,0.95)" />
          <span className="text-white font-medium tracking-wider whitespace-nowrap" style={{ fontSize: Math.round(Math.max(10.5, Math.min(17, 13 * S))) }}>
            {poolTypeLabel(pool)}
          </span>
        </span>
        <div className="mt-1 border-t border-dashed" style={{ borderColor: hexToRgba(theme.main, light ? 0.55 : 0.35), width: leftW - padX * 2 }} />
      </div>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════
// 角色活动祈愿：五星整幅立绘（不裁切） + 右侧四星错位堆叠
// ═════════════════════════════════════════════════════════════════
function CharacterLineup({ lu, src, h, availH, availW, rightInset, nameSize }) {
  // 四星堆叠：单幅高度受高度与宽度双重约束（原图 2:1 → 宽度 = 2×高度）
  const artH4 = Math.max(70, Math.min(availH * 0.44, availW * 0.34))
  const artW4 = artH4 * CHAR_ASPECT
  // 立绘左右各约 15% 是纯透明外框，统一裁掉 12%（视觉大小不变、整组变窄），
  // 让这组能整体更靠右、与五星角色拉开距离；再允许少量出血出画布。
  const SIDE_CROP = 0.12
  const boxW = artW4 * (1 - SIDE_CROP * 2)
  const stepY = artH4 * 0.60
  const shiftX = artH4 * 0.34
  const stackH = stepY * 2 + artH4
  const stackW = boxW + shiftX
  const top4 = Math.max(4, (h - stackH) / 2)
  const bleed = Math.round(artH4 * 0.10)
  const main = lu.main
  const mainSrc = src(main)

  return (
    <>
      {/* 五星整幅立绘：object-contain 完整显示；文字与四星压在它之上 */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        {mainSrc && (
          <img src={mainSrc} alt={main.name} draggable={false}
            style={{ height: '100%', width: 'auto', maxWidth: 'none', maxHeight: '100%' }}
            className="object-contain drop-shadow-[0_8px_30px_rgba(0,0,0,0.55)]" />
        )}
      </div>

      {/* 五星铭牌 */}
      {main && (
        <div className="absolute flex flex-col items-start pointer-events-none"
          style={{ left: '50%', transform: 'translateX(-58%)', bottom: Math.max(10, h * 0.05) }}>
          <div className="flex items-baseline gap-2 px-3 py-1"
            style={{ background: 'linear-gradient(90deg, rgba(10,9,14,0.86), rgba(10,9,14,0.30))' }}>
            <span className="text-white font-medium" style={{ fontSize: nameSize + 5 }}>{main.name}</span>
            <span className="text-amber-300/90" style={{ fontSize: nameSize }}>UP!</span>
          </div>
          <div className="px-3 py-1 rounded-sm"
            style={{ background: 'linear-gradient(90deg, rgba(10,9,14,0.86), rgba(10,9,14,0.30))' }}>
            <StarRow count={5} size={Math.round(nameSize * 0.8)} />
          </div>
        </div>
      )}

      {/* 四星错位堆叠：下方图层更上；中间一幅向右偏 */}
      <div className="absolute pointer-events-none"
        style={{ right: rightInset - bleed, top: top4, width: stackW, height: stackH }}>
        {lu.side.map((it, i) => {
          const s2 = src(it)
          if (!s2) return null
          return (
            <div key={it.key || i} className="absolute overflow-hidden"
              style={{
                top: Math.round(i * stepY),
                left: Math.round(i === 1 ? shiftX : i === 2 ? shiftX * 0.22 : 0),
                width: Math.round(boxW),
                height: Math.round(artH4),
                zIndex: 10 + i * 10,
              }}>
              <img src={s2} alt={it.name} draggable={false}
                style={{
                  position: 'absolute', top: 0, left: -Math.round(artW4 * SIDE_CROP),
                  height: Math.round(artH4), width: Math.round(artW4), maxWidth: 'none',
                  filter: 'drop-shadow(0 6px 16px rgba(0,0,0,0.55))',
                }} />
            </div>
          )
        })}
      </div>
    </>
  )
}

// ═════════════════════════════════════════════════════════════════
// 武器活动祈愿：两把五星紧贴居中 + 右侧四星紧贴成组（全部显示）
// ═════════════════════════════════════════════════════════════════
function WeaponLineup({ lu, src, h, geo, rightInset, nameSize, theme }) {
  if (!geo) return null
  const { OVERLAP5, STEP4, GROUP_GAP, h5, w5, h4, w4, step4, group4W, group5W, group5Left, group4Left } = geo
  const n4 = lu.side.length

  return (
    <>
      {/* 五星两把：负重叠紧贴；背后一个官方样式的大圆（几何与分界线同源） */}
      <div className="absolute flex items-center pointer-events-none"
        style={{ left: group5Left, top: '50%', transform: 'translateY(-50%)', width: group5W, height: h5 }}>
        <div className="absolute rounded-full pointer-events-none" aria-hidden="true"
          style={{
            width: h5 * 0.94, height: h5 * 0.94,
            left: '50%', top: '50%', marginLeft: -(h5 * 0.94) / 2, marginTop: -(h5 * 0.94) / 2,
            border: `2px solid ${hexToRgba(theme.main, 0.34)}`,
            background: `radial-gradient(circle, ${hexToRgba(theme.main, 0.12)} 0%, ${hexToRgba(theme.main, 0.03)} 58%, transparent 74%)`,
            boxShadow: `inset 0 0 0 10px ${hexToRgba('#ffffff', 0.10)}`,
          }} />
        <div className="absolute rounded-full pointer-events-none" aria-hidden="true"
          style={{
            width: h5 * 0.70, height: h5 * 0.70,
            left: '50%', top: '50%', marginLeft: -(h5 * 0.70) / 2, marginTop: -(h5 * 0.70) / 2,
            border: `1px solid ${hexToRgba(theme.main, 0.22)}`,
          }} />
        {lu.main.map((it, i) => {
          const s2 = src(it)
          return s2 ? (
            <img key={it.key || i} src={s2} alt={it.name} draggable={false}
              style={{
                height: h5, width: w5, maxWidth: 'none',
                marginLeft: i === 0 ? 0 : -Math.round(w5 * OVERLAP5),
                zIndex: 4 - i,
              }}
              className="relative object-contain drop-shadow-[0_8px_26px_rgba(0,0,0,0.6)]" />
          ) : null
        })}
      </div>

      {/* 五星铭牌：贴横幅底部、对齐五星组（相对横幅定位，避免被裁切） */}
      {lu.main.length > 0 && (
        <div className="absolute pointer-events-none" style={{ left: Math.round(group5Left) + 24, bottom: 10 }}>
          <div className="px-2.5 py-1 rounded-sm"
            style={{ background: 'linear-gradient(90deg, rgba(10,9,14,0.86), rgba(10,9,14,0.30))' }}>
            {lu.main.map((it, i) => (
              <div key={it.key || i} className="text-white font-medium leading-tight whitespace-nowrap" style={{ fontSize: nameSize + 3 }}>{it.name}</div>
            ))}
            <div className="mt-0.5"><StarRow count={5} size={Math.round(nameSize * 0.78)} /></div>
          </div>
        </div>
      )}

      {/* 四星五把：紧贴成组，全部显示 */}
      {n4 > 0 && (
        <div className="absolute pointer-events-none"
          style={{ left: group4Left, top: '50%', transform: 'translateY(-50%)', width: group4W, height: h4 }}>
          {lu.side.map((it, i) => {
            const s2 = src(it)
            return s2 ? (
              <img key={it.key || i} src={s2} alt={it.name} draggable={false}
                style={{
                  position: 'absolute', left: Math.round(i * step4), top: 0,
                  height: Math.round(h4), width: Math.round(w4), maxWidth: 'none',
                  zIndex: 10 + i,
                  filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.5))',
                }} />
            ) : null
          })}
        </div>
      )}

      {/* 四星铭牌 */}
      {n4 > 0 && (
        <div className="absolute pointer-events-none" style={{ left: Math.round(group4Left) + Math.round(group4W * 0.30), bottom: 10 }}>
          <div className="px-2 py-1 rounded-sm whitespace-nowrap"
            style={{ background: 'linear-gradient(90deg, rgba(10,9,14,0.86), rgba(10,9,14,0.35))' }}>
            <div className="text-white/90 font-medium leading-tight" style={{ fontSize: nameSize }}>{lu.side[0].name}等</div>
            <StarRow count={4} size={Math.round(nameSize * 0.72)} color="#d9b6f5" />
          </div>
        </div>
      )}
    </>
  )
}

// ═════════════════════════════════════════════════════════════════
// 集录祈愿 / 常驻祈愿：角色胶囊（中心 1/7 裁切）+ 武器方砖，两行铺满
// 不写名称与稀有度；确实塞不下时才截断并显示「+N」
// ═════════════════════════════════════════════════════════════════
function MultiLineup({ lu, src, w, h, availH, leftW, padX, theme }) {
  const n1 = lu.chars.length
  const n2 = lu.weapons.length
  const areaW = Math.max(120, w - leftW - padX * 1.4)
  const ROW_GAP = Math.max(6, Math.round(h * 0.022))
  // 胶囊宽 = 高度 × 2 × (1/7)；方砖为正方形
  const CAP_RATIO = CHAR_ASPECT * CAPSULE_CROP   // ≈ 0.2857
  const GAP_MIN = 4

  // ── 尺寸解算：两行各自受宽度约束，再共同受高度约束（胶囊优先）──
  const wLimit1 = n1 > 1 ? (areaW - GAP_MIN * (n1 - 1)) / (n1 * CAP_RATIO) : (n1 ? areaW / CAP_RATIO : 0)
  const wLimit2 = n2 > 1 ? (areaW - GAP_MIN * (n2 - 1)) / n2 : (n2 ? areaW : 0)
  const maxTotal = Math.max(80, availH - ROW_GAP)

  let capH = n1 ? wLimit1 : 0
  let tile = n2 ? wLimit2 : 0
  if (n1 && n2) {
    const minTile = 34
    capH = Math.min(capH, maxTotal * 0.68)
    tile = Math.min(tile, maxTotal - capH)
    if (tile < Math.min(minTile, wLimit2)) {
      tile = Math.min(wLimit2, minTile)
      capH = Math.min(wLimit1, maxTotal - tile)
    }
  } else if (n1) {
    capH = Math.min(capH, maxTotal)
  } else if (n2) {
    tile = Math.min(tile, maxTotal)
  }
  capH = Math.max(44, capH)
  tile = Math.max(34, tile)

  const cw = Math.max(22, capH * CAP_RATIO)
  const fit1 = Math.max(1, Math.floor((areaW + GAP_MIN) / (cw + GAP_MIN)))
  const fit2 = Math.max(1, Math.floor((areaW + GAP_MIN) / (tile + GAP_MIN)))
  const show1 = lu.chars.slice(0, fit1)
  const show2 = lu.weapons.slice(0, fit2)
  const more1 = n1 - show1.length
  const more2 = n2 - show2.length

  const panelStyle = {
    border: `1px solid ${hexToRgba(theme.main, 0.42)}`,
    background: `linear-gradient(180deg, ${hexToRgba(theme.main, 0.20)}, rgba(0,0,0,0.40))`,
    boxShadow: '0 4px 18px rgba(0,0,0,0.45)',
  }

  // 紧凑间距 + 整行在「文字区右侧」的可用区域内整体居中
  return (
    <div className="absolute flex flex-col justify-center"
      style={{ left: leftW + padX * 0.5, right: padX, top: 0, bottom: 0, gap: ROW_GAP }}>
      {n1 > 0 && (
        <div className="flex items-end justify-center w-full" style={{ gap: Math.max(GAP_MIN, Math.round(capH * 0.045)) }}>
          {show1.map((it, i) => {
            const s = src(it)
            return (
              <div key={it.key || i} className="relative overflow-hidden shrink-0"
                style={{
                  width: Math.round(cw), height: Math.round(capH),
                  borderRadius: Math.round(cw * 0.5),
                  ...panelStyle,
                }}>
                {s && (
                  <img src={s} alt={it.name} draggable={false}
                    style={{
                      position: 'absolute', top: 0, left: '50%',
                      height: Math.round(capH), width: 'auto', maxWidth: 'none',
                      transform: 'translateX(-50%)',
                    }} />
                )}
              </div>
            )
          })}
          {more1 > 0 && <MoreChip w={Math.round(cw)} h={Math.round(capH)} label={`+${more1}`} radius={Math.round(cw * 0.5)} />}
        </div>
      )}

      {n2 > 0 && (
        <div className="flex items-center justify-center w-full" style={{ gap: Math.max(GAP_MIN, Math.round(tile * 0.10)) }}>
          {show2.map((it, i) => {
            const s = src(it)
            return (
              <div key={it.key || i} className="relative overflow-hidden shrink-0 flex items-center justify-center"
                style={{
                  width: Math.round(tile), height: Math.round(tile),
                  borderRadius: Math.round(tile * 0.22),
                  ...panelStyle,
                }}>
                {s && <img src={s} alt={it.name} draggable={false}
                  style={{ height: Math.round(tile * 1.12), width: 'auto', maxWidth: 'none' }}
                  className="object-contain" />}
              </div>
            )
          })}
          {more2 > 0 && <MoreChip w={Math.round(tile)} h={Math.round(tile)} label={`+${more2}`} radius={Math.round(tile * 0.22)} />}
        </div>
      )}
    </div>
  )
}

function MoreChip({ w, h, label, radius }) {
  return (
    <div className="flex items-center justify-center shrink-0 text-white/55 border border-white/20"
      style={{ width: w, height: h, borderRadius: radius, background: 'rgba(0,0,0,0.4)', fontSize: Math.max(10, Math.round(h * 0.16)) }}>
      {label}
    </div>
  )
}

function poolTypeLabel(pool) {
  if (pool.kind === 'weapon') return '武器活动祈愿'
  if (pool.kind === 'chronicled') return '集录祈愿'
  if (pool.kind === 'standard') return '常驻祈愿'
  return pool.id === 'character2' ? '角色活动祈愿-2' : '角色活动祈愿'
}

// ═════════════════════════════════════════════════════════════════
// 希穆兰卡 · 抽卡主界面（仿原版祈愿界面）
//   左侧卡池切换 · 中部卡池横幅 · 底部缘种消耗与单抽/十连
//   顶部资源栏 · 定轨选择 · 垫池进度
// ═════════════════════════════════════════════════════════════════
import { useMemo } from 'react'
import { Star, Lock, Plus, Target, RotateCcw, Sparkles, ShoppingBag, MessageSquare } from 'lucide-react'
import {
  POOL_IDS, POOL_FATE, FATE_LABEL, POOL_LABEL, hardPityOf, pitySummary,
  epitomeCandidates, canPull,
} from '../utils/wishSimulator.js'
import { SimButton, SimCurrencyIcon, SimItemIcon, rarityStyle, useSimImages } from './SimulankaShared'
import { CurrencyChipsWithPlus } from './SimulankaShop'
import SimulankaBanner from './SimulankaBanner'

export default function SimulankaGacha({
  runtime, pools, activePool, setActivePool, onDraw, onSetEpitome, onOpenShop, onOpenConvert, onResetFate,
  animations, setAnimations, dialogs, setDialogs,
}) {
  const available = useMemo(() => POOL_IDS.filter(id => pools[id]), [pools])
  const pool = pools[activePool] || pools[available[0]]
  const poolId = pool?.id || activePool

  const pity = useMemo(() => pitySummary(runtime, pools), [runtime, pools])
  const cur = pity[poolId] || { p5: 0, p4: 0, hard: 90, guaranteed: null, crStreak: null, fate: null }

  // 侧栏缩略图用「祈愿」板块的官方卡池图（多图时取第一张，如常驻祈愿两张）；
  // 图片由 buildPoolDefs 做过兜底，老存档/未爬图的新期数也能拿到图。
  const bannerFiles = useMemo(
    () => available.flatMap(id => pools[id]?.bannerImages || []).filter(Boolean),
    [available, pools]
  )
  const bannerMap = useSimImages(bannerFiles, 300)

  // 官方卡池图缺失时的缩略图兜底（各池首个五星 UP 的立绘）
  const thumbFiles = useMemo(
    () => available.map(id => { const p = pools[id]; const it = p?.up5?.[0] || p?.pool5?.[0] || p?.standard5?.[0]; return it ? (it.splash || it.art) : null }).filter(Boolean),
    [available, pools]
  )
  const thumbMap = useSimImages(thumbFiles, 200)

  const itemFiles = useMemo(() => {
    if (!pool) return []
    return [...(pool.up5 || []), ...(pool.up4 || []), ...(pool.pool5 || []), ...(pool.pool4 || [])].map(x => x.art || x.splash).filter(Boolean)
  }, [pool])
  const itemMap = useSimImages(itemFiles, 120)

  const fateKey = POOL_FATE[poolId]
  const have = runtime.resources[fateKey] || 0
  const can1 = canPull(runtime, poolId)

  const candidates = pool ? epitomeCandidates(pool) : []
  const epiKey = runtime.epicomized?.[poolId] || null
  const epiItem = candidates.find(c => c.key === epiKey) || null

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* ── 顶部：动画开关 + 商城（左） · 六种货币（右，原石旁带 + 打开结晶转换） ── */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10 bg-black/25 shrink-0">
        <button
          type="button"
          onClick={() => setAnimations?.(!animations)}
          aria-pressed={animations !== false}
          title="关闭后跳过抽卡动画与逐件展示，直接列出全部结果"
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] border transition-colors ${
            animations !== false
              ? 'bg-primary-500/20 border-primary-400/45 text-primary-200'
              : 'bg-white/5 border-white/10 text-white/45'}`}
        >
          <Sparkles className="w-3 h-3" aria-hidden="true" />
          抽卡动画{animations !== false ? '开' : '关'}
        </button>
        <button
          type="button"
          onClick={() => setDialogs?.(dialogs === false)}
          aria-pressed={dialogs !== false}
          title="关闭后祈愿不再弹「自动转化并祈愿」确认框，直接自动转化并祈愿；资源不足时仍会提示"
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] border transition-colors ${
            dialogs !== false
              ? 'bg-primary-500/20 border-primary-400/45 text-primary-200'
              : 'bg-white/5 border-white/10 text-white/45'}`}
        >
          <MessageSquare className="w-3 h-3" aria-hidden="true" />
          弹窗{dialogs !== false ? '开' : '关'}
        </button>
        <SimButton size="sm" onClick={onOpenShop}>
          <ShoppingBag className="w-3 h-3" aria-hidden="true" />商城
        </SimButton>
        <div className="ml-auto">
          <CurrencyChipsWithPlus resources={runtime.resources} onPlusPrimogem={onOpenConvert} />
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* ── 左侧卡池列表 ── */}
        <nav className="w-[132px] shrink-0 border-r border-white/10 bg-black/20 overflow-y-auto p-2 space-y-1.5">
          {available.map(id => {
            const p = pools[id]
            const on = id === poolId
            const thumb = p.bannerImages?.[0] ? bannerMap[p.bannerImages[0]] : null
            const upArt = p.up5?.[0] || p.pool5?.[0]
            const thumbFile = thumb ? null : (upArt ? (upArt.splash || upArt.art) : null)
            const thumbSrc = thumb || (thumbFile ? thumbMap[thumbFile] : null)
            return (
              <button
                key={id}
                type="button"
                onClick={() => setActivePool(id)}
                aria-current={on ? 'true' : undefined}
                className={`w-full rounded-lg overflow-hidden border text-left transition-all ${
                  on ? 'border-amber-300/70 ring-1 ring-amber-300/40' : 'border-white/10 hover:border-white/25'
                }`}
              >
                <div className="relative h-[52px] bg-gradient-to-br from-surface-800 to-surface-900">
                  {thumbSrc
                    ? <img src={thumbSrc} alt="" className="w-full h-full object-cover object-top" draggable={false} />
                    : <div className="w-full h-full flex items-center justify-center"><Star className="w-4 h-4 text-white/20" /></div>}
                  {on && <div className="absolute inset-0 ring-1 ring-inset ring-amber-200/50" />}
                </div>
                <div className={`px-1.5 py-1 ${on ? 'bg-amber-400/15' : 'bg-white/5'}`}>
                  <div className={`text-[10px] truncate ${on ? 'text-amber-100' : 'text-white/70'}`}>{POOL_LABEL[id]}</div>
                  <div className="text-[9px] text-white/40 tabular-nums">保底 {pity[id]?.p5 ?? 0}/{hardPityOf(p.kind)}</div>
                </div>
              </button>
            )
          })}
        </nav>

        {/* ── 主区 ── */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* 卡池背景：数据库图片 + 代码 + 字体合成（见 SimulankaBanner） */}
          <div className="relative flex-1 min-h-0 overflow-hidden">
            <SimulankaBanner pool={pool} />

            <div className="absolute inset-x-0 top-0 px-3 py-2 flex items-start justify-between gap-2 pointer-events-none">
              <span className="text-[10px] text-white/45">{/* 占位，保持与右上角徽标对齐 */}</span>
              <div className="flex items-center gap-1.5">
                {cur.guaranteed !== null && (
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border backdrop-blur-sm ${
                    cur.guaranteed ? 'bg-amber-400/25 border-amber-300/50 text-amber-100' : 'bg-black/45 border-white/20 text-white/75'}`}>
                    {cur.guaranteed ? '大保底 · 必得 UP' : `小保底${cur.crStreak >= 2 ? ` · 连保${cur.crStreak}` : ''}`}
                  </span>
                )}
                {cur.fate !== null && (
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border backdrop-blur-sm ${
                    cur.fate ? 'bg-amber-400/25 border-amber-300/50 text-amber-100' : 'bg-black/45 border-white/20 text-white/75'}`}>
                    命定值 {cur.fate}/1
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* 定轨 / 保底 / 按钮 */}
          <div className="shrink-0 border-t border-white/10 bg-surface-950/85 backdrop-blur px-3 py-2.5 space-y-2">
            {candidates.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="flex items-center gap-1 text-[10px] text-white/50">
                  <Target className="w-3 h-3" aria-hidden="true" />定轨
                </span>
                {candidates.map(c => {
                  const on = c.key === epiKey
                  const st = rarityStyle(c.rarity)
                  return (
                    <button
                      key={c.key}
                      type="button"
                      onClick={() => onSetEpitome(poolId, on ? null : c.key)}
                      aria-pressed={on}
                      className={`flex items-center gap-1.5 pl-1 pr-2 py-1 rounded-lg border text-[11px] transition-colors ${
                        on ? 'border-amber-300/70 bg-amber-400/15 text-amber-100' : 'border-white/10 bg-white/5 text-white/70 hover:bg-white/10'
                      }`}
                    >
                      <SimItemIcon item={c} size={20} imgMap={itemMap} />
                      {c.name}
                      <span className={`text-[9px] ${st.text} opacity-70`}>{'★'.repeat(c.rarity)}</span>
                    </button>
                  )
                })}
                {epiItem && (
                  <button type="button" onClick={onResetFate}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] bg-white/5 hover:bg-white/10 border border-white/10 text-white/55">
                    <RotateCcw className="w-3 h-3" aria-hidden="true" />清零命定值
                  </button>
                )}
              </div>
            )}

            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2 text-[11px] text-white/60">
                <span>距五星</span>
                <span className="tabular-nums text-white/90">{cur.p5}</span>
                <span className="text-white/35">/ {cur.hard}</span>
                <div className="w-24 h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-amber-300 to-amber-500 transition-[width] duration-300"
                    style={{ width: `${Math.min(100, (cur.p5 / cur.hard) * 100)}%` }} />
                </div>
                <span className="text-white/35">|</span>
                <span>四星</span>
                <span className="tabular-nums text-white/90">{cur.p4}</span>
                <span className="text-white/35">/ 10</span>
              </div>

              <div className="ml-auto flex items-center gap-2">
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-black/40 border border-white/10">
                  <SimCurrencyIcon kind={fateKey} size={18} />
                  <span className="text-xs text-white/85 tabular-nums">{have.toLocaleString()}</span>
                  <span className="text-[10px] text-white/40">{FATE_LABEL[fateKey]}</span>
                </div>
                {/* 不禁用：资源不足时点下去会弹「资源不足」框并提供前往商城，
                    比一个不能点、也不说原因的灰按钮清楚得多 */}
                <WishButton label="祈愿 ×1" cost={1} disabled={false} onClick={() => onDraw(poolId, 1)} />
                <WishButton label="祈愿 ×10" cost={10} disabled={false} onClick={() => onDraw(poolId, 10)} />
              </div>
            </div>

            {!can1 && (
              <p className="text-[10px] text-amber-200/80 flex items-center gap-1">
                <Lock className="w-3 h-3" aria-hidden="true" />
                缘与结晶都不足了，点「商城」补充，或直接祈愿由系统自动转化
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function WishButton({ label, cost, disabled, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`group relative px-4 py-2 rounded-xl border transition-all ${
        disabled
          ? 'bg-white/5 border-white/10 text-white/30 cursor-not-allowed'
          : 'bg-gradient-to-b from-[#f5e3c0] to-[#d8b071] border-[#f7ead2] text-[#3d2a10] hover:brightness-105 active:scale-[0.98] shadow-[0_2px_14px_rgba(216,176,113,0.35)]'
      }`}
    >
      <span className="text-[13px] font-medium tracking-wide">{label}</span>
      <span className={`ml-1.5 text-[10px] ${disabled ? 'text-white/25' : 'text-[#5c421c]/70'}`}>×{cost}</span>
    </button>
  )
}

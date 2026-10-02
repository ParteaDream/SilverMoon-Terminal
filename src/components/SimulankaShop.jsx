// ═════════════════════════════════════════════════════════════════
// 希穆兰卡 · 商城
// ─────────────────────────────────────────────────────────────────
// 模拟进行中的资源获取入口，对应原版游戏内「商城」：
//   原石兑换   160 原石 → 1 纠缠之缘 / 1 相遇之缘（数量用进度条调）
//   星辉兑换   5 无主的星辉 → 1 纠缠之缘 / 1 相遇之缘
//   凝取结晶   六个档位充值创世结晶；顶部「首充双倍」开关决定该档给
//              双倍总数（base×2）还是非双倍总数（base+赠送）
//
// 档位数额（价格 / 基础 / 非双倍赠送）取自游戏内商城：
//   ￥6→60+0   ￥30→300+30   ￥98→980+110
//   ￥198→1980+260   ￥328→3280+600   ￥648→6480+1600
// ═════════════════════════════════════════════════════════════════
import { useMemo, useState } from 'react'
import { X, Minus, Plus, ShoppingBag, Gem, Sparkles, Check, Lock, Receipt } from 'lucide-react'
import useOverlay from '../hooks/useOverlay'
import {
  GENESIS_TIERS, PRIMOGEM_PER_FATE, GLITTER_PER_FATE, FATE_LABEL,
  genesisTierTotal, exchangePrimogemForFate, exchangeStarglitterForFate,
  purchaseGenesis, rechargeSummary,
} from '../utils/wishSimulator.js'
import { SimButton, SimCurrencyIcon, CURRENCY_LABEL } from './SimulankaShared'

const TABS = [
  { id: 'primogem', label: '原石兑换', icon: Gem },
  { id: 'glitter', label: '星辉兑换', icon: Sparkles },
  { id: 'genesis', label: '凝取结晶', icon: ShoppingBag },
  { id: 'bill', label: '账单', icon: Receipt },
]

// ═════════════════════════════════════════════════════════════════
// 描边语义（全商城统一）
//   未选中 —— 几乎不可见的描边，只用来划分卡片边界
//   选中   —— 主题色描边 + 外发光 + 右上角对勾，是唯一的强调信号
// 之前未选中用的是白色描边，视觉上比主题色还抢眼，会被误读成"强调框"，
// 所以这里刻意把常态压到最弱、把选中抬到最强。
// ═════════════════════════════════════════════════════════════════
const CARD_IDLE = 'border-white/10 bg-black/20 hover:border-white/20 hover:bg-white/5'
const CARD_ON = 'border-primary-400 bg-primary-500/15 ring-2 ring-primary-400/30 shadow-[0_0_20px_-4px_rgb(var(--primary-400)/0.55)]'

/**
 * 数量调节条 —— 对应原版商城购买弹窗里的进度条。
 * 键盘可达：range 原生支持方向键；−/+ 为普通按钮。
 */
export function QuantityBar({ value, max, onChange, label = '购买数量' }) {
  const safeMax = Math.max(0, Math.floor(max))
  const v = Math.min(Math.max(0, Math.floor(value)), safeMax)
  const clamp = (n) => Math.min(safeMax, Math.max(0, Math.floor(n)))
  return (
    <div className="space-y-2">
      <div className="text-center text-[11px] text-white/55">{label}</div>
      <div className="text-center text-2xl font-medium text-white tabular-nums">{v}</div>
      <div className="flex items-center gap-3">
        <button
          type="button" aria-label="减少数量" disabled={v <= 0}
          onClick={() => onChange(clamp(v - 1))}
          className="w-7 h-7 shrink-0 rounded-full border border-white/15 bg-white/5 hover:bg-white/10 disabled:opacity-30 flex items-center justify-center text-white/80"
        >
          <Minus className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
        <input
          type="range" min={0} max={safeMax} value={v} aria-label={label}
          onChange={e => onChange(clamp(Number(e.target.value)))}
          className="flex-1 accent-primary-400 cursor-pointer"
        />
        <span className="w-14 shrink-0 text-right text-xs text-white/60 tabular-nums">{safeMax}</span>
        <button
          type="button" aria-label="增加数量" disabled={v >= safeMax}
          onClick={() => onChange(clamp(v + 1))}
          className="w-7 h-7 shrink-0 rounded-full border border-white/15 bg-white/5 hover:bg-white/10 disabled:opacity-30 flex items-center justify-center text-white/80"
        >
          <Plus className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}

/** 商品卡（原石/星辉兑换里的缘） */
function FateCard({ fateKey, cost, currency, count, selected, disabled, onClick }) {
  return (
    <button
      type="button" disabled={disabled} onClick={onClick}
      className={`relative flex flex-col items-center gap-2 px-4 py-3 rounded-xl border transition-colors disabled:opacity-40 ${
        selected ? CARD_ON : CARD_IDLE}`}
    >
      {selected && (
        <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-primary-500 border border-primary-300 flex items-center justify-center">
          <Check className="w-3 h-3 text-white" aria-hidden="true" />
        </span>
      )}
      <div className="w-14 h-14 rounded-lg flex items-center justify-center"
        style={{ background: 'linear-gradient(180deg, rgba(255,190,90,0.28), rgba(255,190,90,0.06))' }}>
        <SimCurrencyIcon kind={fateKey} size={40} />
      </div>
      <div className="text-xs text-white/90">{FATE_LABEL[fateKey]}</div>
      <div className="flex items-center gap-1 text-[11px] text-white/70">
        <SimCurrencyIcon kind={currency} size={13} />
        <span className="tabular-nums">{cost}</span>
      </div>
      {count > 0 && <div className="text-[10px] text-primary-300">持有 {count}</div>}
    </button>
  )
}

/** 原石兑换 / 星辉兑换 —— 两者只差货币与单价 */
function FateExchangeTab({ runtime, currency, rate, onApply }) {
  const res = runtime.resources
  const [fateKey, setFateKey] = useState('intertwined')
  const [count, setCount] = useState(1)
  const balance = res[currency] || 0
  const max = Math.floor(balance / rate)
  const n = Math.min(count, max)
  const cost = n * rate
  const canBuy = n > 0

  const buy = () => {
    const r = currency === 'primogem'
      ? exchangePrimogemForFate(res, fateKey, n)
      : exchangeStarglitterForFate(res, fateKey, n)
    if (r.ok) { onApply({ resources: r.resources }, `已兑换 ${n} 个${FATE_LABEL[fateKey]}`); setCount(1) }
    else onApply(null, r.reason || '兑换失败', true)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-4">
        <div className="flex gap-3">
          {['intertwined', 'acquaint'].map(k => (
            <FateCard
              key={k} fateKey={k} cost={rate} currency={currency}
              count={res[k]} selected={fateKey === k}
              disabled={max <= 0}
              onClick={() => { setFateKey(k); setCount(Math.min(1, max)) }}
            />
          ))}
        </div>
        <p className="text-[11px] text-white/45 leading-relaxed flex-1">
          {currency === 'primogem'
            ? `每 ${PRIMOGEM_PER_FATE} 原石可兑换 1 个缘。`
            : `每 ${GLITTER_PER_FATE} 个无主的星辉可兑换 1 个缘。`}
          <br />
          当前持有 {balance.toLocaleString()} {CURRENCY_LABEL[currency]}，最多可兑换 <span className="text-white/80 tabular-nums">{max}</span> 个。
        </p>
      </div>

      {max <= 0 ? (
        <div className="flex items-center gap-2 px-3 py-3 rounded-lg bg-amber-500/10 border border-amber-400/25">
          <Lock className="w-3.5 h-3.5 text-amber-300 shrink-0" aria-hidden="true" />
          <span className="text-[11px] text-amber-100/85">
            {CURRENCY_LABEL[currency]}不足，无法兑换。可到「凝取结晶」补充创世结晶后在货币栏转换为原石。
          </span>
        </div>
      ) : (
        <div className="px-3 py-3 rounded-lg bg-black/25 border border-white/10 space-y-3">
          <QuantityBar value={n} max={max} onChange={setCount} />
          <div className="flex items-center justify-center gap-1.5 text-xs text-white/80">
            <span className="text-white/50">消耗</span>
            <SimCurrencyIcon kind={currency} size={16} />
            <span className="tabular-nums font-medium">{cost.toLocaleString()}</span>
            <span className="text-white/30 mx-1">→</span>
            <SimCurrencyIcon kind={fateKey} size={16} />
            <span className="tabular-nums font-medium">{n}</span>
          </div>
          <div className="flex justify-center">
            <SimButton variant="primary" disabled={!canBuy} onClick={buy}>
              <Check className="w-3.5 h-3.5" aria-hidden="true" />兑换
            </SimButton>
          </div>
        </div>
      )}
    </div>
  )
}

/** 凝取结晶 —— 六个档位；顶部开关决定是否按首充双倍结算 */
function GenesisTab({ runtime, onApply }) {
  // 首充双倍是存档状态（每个人首充用了多少不一样），默认关闭
  const doubleFirst = runtime.firstChargeDouble === true
  const res = runtime.resources

  const buy = (tier) => {
    const r = purchaseGenesis(runtime, tier.id, doubleFirst)
    if (r.ok) {
      onApply({
        resources: r.resources,
        recharges: [...(runtime.recharges || []), r.entry],
      }, `充值 ￥${tier.price.toFixed(2)}，获得 ${r.gained.toLocaleString()} 创世结晶`)
    } else onApply(null, r.reason || '充值失败', true)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-white/5 border border-white/10">
        <label className="flex items-center gap-2 text-xs text-white/80 cursor-pointer">
          <input
            type="checkbox" checked={doubleFirst} className="accent-primary-500"
            onChange={e => onApply({ firstChargeDouble: e.target.checked })}
          />
          首充双倍
        </label>
        <span className="text-[10px] text-white/45">
          {doubleFirst
            ? '按首次充值结算，各档到账数量翻倍（原版每周年庆版本重置一次）'
            : '按非首充结算，各档在基础数量上额外赠送固定数额'}
          <span className="text-[10px] text-white/30">· 该状态随存档保存</span>
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {GENESIS_TIERS.map((t, i) => {
          const total = genesisTierTotal(t, doubleFirst)
          const extra = doubleFirst ? t.base : t.bonus
          // 档位越高水晶簇画得越大，呼应原版（60 一小颗 → 6480 一整簇）
          const artSize = 40 + i * 4
          return (
            <button
              key={t.id} type="button" onClick={() => buy(t)}
              className={`group relative flex flex-col items-center gap-1.5 pt-5 pb-3 px-2 rounded-lg border transition-colors ${
                'border-white/10 bg-black/20 hover:border-primary-400/60 hover:bg-white/5'}`}
            >
              {/* 左上角标：双倍 / 额外赠送 */}
              <span
                className={`absolute -top-2 left-1.5 px-1.5 py-0.5 rounded text-[10px] leading-tight border ${
                  doubleFirst
                    ? 'bg-rose-500/85 border-rose-300/60 text-white'
                    : 'bg-sky-500/85 border-sky-300/60 text-white'}`}
              >
                {doubleFirst ? (
                  <><span className="font-medium">双倍！</span><br />+{extra.toLocaleString()}</>
                ) : (
                  <><span className="font-medium">额外赠</span><br />{extra.toLocaleString()}</>
                )}
              </span>

              <div className="w-16 h-16 flex items-center justify-center">
                <SimCurrencyIcon kind="genesis" size={artSize} />
              </div>
              <div className="text-[11px] text-white/85 text-center leading-tight">
                {total.toLocaleString()}枚创世结晶
              </div>
              <div className="mt-0.5 w-full text-center text-xs font-medium text-amber-200 bg-amber-400/10 border-t border-amber-300/25 py-1 rounded-b">
                ￥{t.price.toFixed(2)}
              </div>
            </button>
          )
        })}
      </div>

      <p className="text-[10px] text-white/35 leading-relaxed">
        标准价格为人民币 1:10。首充双倍到账 = 基础数量 × 2；非首充到账 = 基础数量 + 额外赠送。
        原版每次周年庆版本重置首充双倍，用上方开关表示你当前是否还有首充机会。
      </p>
    </div>
  )
}

/** 账单 —— 本存档的全部充值记录 */
function BillTab({ runtime }) {
  const list = Array.isArray(runtime.recharges) ? runtime.recharges : []
  const sum = rechargeSummary(list)

  if (list.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-2 text-center">
        <Receipt className="w-7 h-7 text-white/20" aria-hidden="true" />
        <p className="text-[11px] text-white/40">本存档还没有充值记录</p>
        <p className="text-[10px] text-white/25">到「凝取结晶」充值后会在这里逐笔列出</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4 px-3 py-2.5 rounded-lg border border-white/10 bg-black/20">
        <div>
          <div className="text-[10px] text-white/40">累计充值</div>
          <div className="text-sm text-amber-200 tabular-nums font-medium">￥{sum.totalRmb.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-[10px] text-white/40">共</div>
          <div className="text-sm text-white/90 tabular-nums font-medium">{sum.count} 笔</div>
        </div>
        <div className="ml-auto text-right">
          <div className="text-[10px] text-white/40">累计获得</div>
          <div className="flex items-center gap-1 justify-end">
            <SimCurrencyIcon kind="genesis" size={14} />
            <span className="text-sm text-white/90 tabular-nums font-medium">{sum.totalCrystals.toLocaleString()}</span>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-white/10 overflow-hidden">
        <table className="w-full text-[11px]">
          <thead className="bg-white/5 text-white/45">
            <tr>
              <th className="text-left font-normal px-3 py-1.5">时间</th>
              <th className="text-right font-normal px-3 py-1.5">档位</th>
              <th className="text-right font-normal px-3 py-1.5">人民币</th>
              <th className="text-right font-normal px-3 py-1.5">获得创世结晶</th>
              <th className="text-right font-normal px-3 py-1.5">类型</th>
            </tr>
          </thead>
          <tbody>
            {[...list].reverse().map(e => (
              <tr key={e.id} className="border-t border-white/5">
                <td className="px-3 py-1.5 text-white/50 font-mono">
                  {String(e.time || '').slice(5, 16).replace('T', ' ')}
                </td>
                <td className="px-3 py-1.5 text-right text-white/70 tabular-nums">
                  {Number(e.base).toLocaleString()}
                </td>
                <td className="px-3 py-1.5 text-right text-amber-200 tabular-nums">￥{Number(e.price).toFixed(2)}</td>
                <td className="px-3 py-1.5 text-right text-white/90 tabular-nums">
                  {Number(e.gained).toLocaleString()}
                  {!e.doubled && Number(e.bonus) > 0 && (
                    <span className="text-white/35 ml-1">(含赠 {Number(e.bonus).toLocaleString()})</span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-right">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                    e.doubled ? 'bg-rose-500/25 text-rose-100' : 'bg-white/10 text-white/50'}`}>
                    {e.doubled ? '首充双倍' : '常规'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-white/30">账单随本存档保存，仅记录充值（兑换原石/星辉不产生账单）。</p>
    </div>
  )
}

/**
 * 商城主体
 * @param {object} runtime 运行态（读 resources）
 * @param {(patch, msg, isError) => void} onApply 提交运行态补丁（如 { resources } / { firstChargeDouble } / { recharges }）；null 表示只提示
 */
export default function SimulankaShop({ runtime, onClose, onApply, onOpenConvert }) {
  const ov = useOverlay({ open: true, onClose, label: '商城', initialFocus: 'auto' })
  const [tab, setTab] = useState('primogem')
  const res = runtime.resources

  const head = useMemo(() => ([
    { k: 'genesis', v: res.genesis },
    { k: 'primogem', v: res.primogem },
    { k: 'intertwined', v: res.intertwined },
    { k: 'acquaint', v: res.acquaint },
    { k: 'starglitter', v: res.starglitter },
  ]), [res])

  return (
    <div ref={ov.overlayRef} {...ov.overlayProps}
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-[820px] h-[86%] flex flex-col rounded-xl bg-surface-900 border border-white/10 shadow-2xl overflow-hidden">
        {/* 顶栏：标题 + 货币 + 关闭 */}
        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-white/10 shrink-0">
          <ShoppingBag className="w-4 h-4 text-primary-300" aria-hidden="true" />
          <h3 className="text-sm font-medium text-white">商城</h3>
          <span className="text-[10px] text-white/35">请适度娱乐，理性消费</span>
          <div className="ml-auto flex items-center gap-2.5">
            {head.map(({ k, v }) => (
              <div key={k} className="flex items-center gap-1" title={CURRENCY_LABEL[k]}>
                <SimCurrencyIcon kind={k} size={15} />
                <span className="text-[11px] text-white/90 tabular-nums">{v.toLocaleString()}</span>
                {k === 'primogem' && onOpenConvert && (
                  <button
                    type="button" aria-label="创世结晶转换为原石"
                    onClick={onOpenConvert}
                    title="用创世结晶转换原石"
                    className="w-4 h-4 ml-0.5 rounded-full border border-white/25 bg-white/10 hover:bg-primary-500/35 flex items-center justify-center text-white/85"
                  >
                    <Plus className="w-2.5 h-2.5" aria-hidden="true" />
                  </button>
                )}
              </div>
            ))}
            <button type="button" onClick={onClose} aria-label="关闭商城" className="p-1 rounded hover:bg-white/10 text-white/60">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 flex min-h-0">
          {/* 左侧栏 */}
          <nav className="w-[132px] shrink-0 border-r border-white/10 bg-black/20 p-2 space-y-1">
            {TABS.map(t => {
              const Icon = t.icon
              const on = tab === t.id
              return (
                <button
                  key={t.id} type="button" onClick={() => setTab(t.id)}
                  className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-[11px] border transition-colors ${
                    on ? 'bg-primary-500/20 border-primary-400/45 text-primary-100'
                       : 'bg-transparent border-transparent text-white/55 hover:bg-white/10'}`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">{t.label}</span>
                </button>
              )
            })}
          </nav>

          {/* 右侧内容 */}
          <div className="flex-1 min-w-0 overflow-y-auto p-4">
            {tab === 'primogem' && (
              <FateExchangeTab runtime={runtime} currency="primogem" rate={PRIMOGEM_PER_FATE} onApply={onApply} />
            )}
            {tab === 'glitter' && (
              <FateExchangeTab runtime={runtime} currency="starglitter" rate={GLITTER_PER_FATE} onApply={onApply} />
            )}
            {tab === 'genesis' && <GenesisTab runtime={runtime} onApply={onApply} />}
            {tab === 'bill' && <BillTab runtime={runtime} />}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * 创世结晶 → 原石 转换面板（1:1）。
 * 入口是货币栏「原石」右侧的 + 按钮，商城与抽卡界面共用。
 */
export function GenesisConvertPanel({ resources, onClose, onApply }) {
  const ov = useOverlay({ open: true, onClose, label: '创世结晶转换为原石', initialFocus: 'auto' })
  const max = Math.max(0, Math.floor(resources.genesis))
  const [n, setN] = useState(Math.min(160, max))
  const v = Math.min(n, max)

  return (
    <div ref={ov.overlayRef} {...ov.overlayProps}
      className="absolute inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-[380px] rounded-xl bg-surface-900 border border-white/10 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/10">
          <h3 className="text-sm font-medium text-white">创世结晶 → 原石</h3>
          <button type="button" onClick={onClose} aria-label="关闭" className="p-1 rounded hover:bg-white/10 text-white/60">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <div className="flex items-center justify-center gap-4">
            <div className="flex items-center gap-1.5 text-xs text-white/80">
              <SimCurrencyIcon kind="genesis" size={18} />
              <span className="tabular-nums">{resources.genesis.toLocaleString()}</span>
            </div>
            <span className="text-white/25">→</span>
            <div className="flex items-center gap-1.5 text-xs text-white/80">
              <SimCurrencyIcon kind="primogem" size={18} />
              <span className="tabular-nums">{resources.primogem.toLocaleString()}</span>
            </div>
          </div>

          {max <= 0 ? (
            <p className="text-center text-[11px] text-amber-100/85 py-3">没有可用的创世结晶</p>
          ) : (
            <>
              <QuantityBar value={v} max={max} onChange={setN} label="转换数量" />
              <div className="flex items-center justify-center gap-1.5 text-xs text-white/80">
                <span className="text-white/50">消耗</span>
                <SimCurrencyIcon kind="genesis" size={16} />
                <span className="tabular-nums font-medium">{v.toLocaleString()}</span>
                <span className="text-white/30 mx-1">→</span>
                <SimCurrencyIcon kind="primogem" size={16} />
                <span className="tabular-nums font-medium">{v.toLocaleString()}</span>
              </div>
              <p className="text-[10px] text-white/35 text-center">创世结晶与原石 1:1 兑换</p>
              <div className="flex justify-center">
                <SimButton variant="primary" disabled={v <= 0} onClick={() => onApply(v)}>
                  <Check className="w-3.5 h-3.5" aria-hidden="true" />确认转换
                </SimButton>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/** 货币栏：数字右侧带 + 的版本（原石用于打开结晶转换） */
export function CurrencyChipsWithPlus({ resources, onPlusPrimogem }) {
  const items = [
    { k: 'genesis', v: resources.genesis },
    { k: 'primogem', v: resources.primogem },
    { k: 'intertwined', v: resources.intertwined },
    { k: 'acquaint', v: resources.acquaint },
    { k: 'starglitter', v: resources.starglitter },
    { k: 'stardust', v: resources.stardust },
  ]
  return (
    <div className="flex items-center gap-2.5">
      {items.map(({ k, v }) => (
        <div key={k} className="flex items-center gap-1" title={CURRENCY_LABEL[k]}>
          <SimCurrencyIcon kind={k} size={16} />
          <span className="text-[11px] text-white/90 tabular-nums">{v.toLocaleString()}</span>
          {k === 'primogem' && onPlusPrimogem && (
            <button
              type="button" aria-label="创世结晶转换为原石" onClick={onPlusPrimogem}
              title="用创世结晶转换原石"
              className="w-4 h-4 ml-0.5 rounded-full border border-white/25 bg-white/10 hover:bg-primary-500/35 flex items-center justify-center text-white/85"
            >
              <Plus className="w-2.5 h-2.5" aria-hidden="true" />
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

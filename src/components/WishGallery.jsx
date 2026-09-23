// ═════════════════════════════════════════════════════════════════
// WishGallery.jsx — 祈愿记录的画廊呈现（祈愿捕捉站 / 北国银行共用）
//
// - 每个物品只显示图片 + 名称，颜色代表星级
// - 最新物品在左上角，按时间倒序从左往右、从上到下排列
// - 按「日」分组，不同日之间用日期标题 + 分隔线隔开
// ═════════════════════════════════════════════════════════════════
import { useMemo } from 'react'
import { useLazyImage } from '../hooks/useLazyImage'

const RANK_BORDER = { 5: 'border-amber-400/70', 4: 'border-purple-400/70', 3: 'border-blue-400/40' }
const RANK_BG = { 5: 'bg-amber-500/10', 4: 'bg-purple-500/10', 3: 'bg-blue-500/10' }
const RANK_TEXT = { 5: 'text-amber-300', 4: 'text-purple-300', 3: 'text-blue-300' }

function cmpNewestFirst(a, b) {
  const ta = String(a?.time || '')
  const tb = String(b?.time || '')
  if (ta !== tb) return ta < tb ? 1 : -1
  const ia = String(a?.id || '')
  const ib = String(b?.id || '')
  if (ia.length !== ib.length) return ia.length < ib.length ? 1 : -1
  if (ia === ib) return 0
  return ia < ib ? 1 : -1
}

export default function WishGallery({ items, nameImageMap, minCell = 64 }) {
  // 保证最新在前的顺序；再按日分组（分组顺序即最新日在前）
  const groups = useMemo(() => {
    const sorted = [...(items || [])].sort(cmpNewestFirst)
    const map = new Map()
    for (const it of sorted) {
      const day = String(it?.time || '').slice(0, 10) || '未知日期'
      if (!map.has(day)) map.set(day, [])
      map.get(day).push(it)
    }
    return Array.from(map.entries())
  }, [items])

  if (!items || items.length === 0) return null

  return (
    <div className="space-y-4">
      {groups.map(([day, list]) => (
        <section key={day}>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[11px] font-medium text-surface-300">{day}</span>
            <span className="text-[9px] text-surface-600">{list.length} 件</span>
            <span className="flex-1 h-px bg-white/5" />
          </div>
          <div
            className="grid gap-1.5"
            style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${minCell}px, 1fr))` }}
          >
            {list.map((it, i) => (
              <WishGalleryItem key={it?.id ?? `${day}-${i}`} item={it} nameImageMap={nameImageMap} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function WishGalleryItem({ item, nameImageMap }) {
  const rank = Number(item?.rank_type)
  const info = nameImageMap?.[item?.name]
  const isWeapon = info?.type === 'weapon'
  const { ref, src } = useLazyImage(info?.image, 128)

  return (
    <div
      className="flex flex-col items-center gap-0.5 min-w-0"
      title={item?.name ? `${item.name}${rank ? ` · ${'★'.repeat(rank)}` : ''} · ${item.time || ''}` : undefined}
    >
      <div
        ref={ref}
        className={`w-full aspect-square rounded-lg overflow-hidden border flex items-center justify-center ${RANK_BORDER[rank] || 'border-white/10'} ${RANK_BG[rank] || 'bg-surface-800/40'}`}
      >
        {src ? (
          <img
            src={src}
            alt=""
            draggable={false}
            className={`w-full h-full ${isWeapon ? 'object-contain p-1' : 'object-cover object-top'}`}
          />
        ) : (
          <span className={`text-[10px] ${RANK_TEXT[rank] || 'text-surface-500'}`}>…</span>
        )}
      </div>
      <span className={`w-full text-[9px] leading-tight text-center truncate ${RANK_TEXT[rank] || 'text-surface-400'}`}>
        {item?.name}
      </span>
    </div>
  )
}

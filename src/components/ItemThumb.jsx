import { useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
import { useLazyImage } from '../hooks/useLazyImage'
import { clearDetailScroll } from '../hooks/useDetailState'

export default function ItemThumb({ item, charMap, weaponMap, small, compact }) {
  const navigate = useNavigate()
  const entity = item.item_type === 'character' ? charMap[item.item_id] : weaponMap[item.item_id]
  const imageFile = item.item_type === 'character' ? entity?._displayCardArt : entity?.simple_art || entity?.image
  const { ref, src } = useLazyImage(imageFile, '300px')

  const size = compact ? 'w-10 h-10' : (small ? 'w-12 h-12' : 'w-16 h-16')
  const textSize = compact ? 'text-[9px] max-w-[48px]' : 'text-[10px] leading-tight max-w-[60px]'

  function handleClick(e) {
    e.stopPropagation()
    const route = item.item_type === 'character' ? 'characters' : 'weapons'
    clearDetailScroll(item.item_type, item.item_id)
    navigate(`/${route}/${item.item_id}`)
  }

  return (
    <button onClick={handleClick} className="flex flex-col items-center gap-1 group cursor-pointer" title={entity?.name_zh}>
      <div ref={ref} className={`${size} rounded-lg border-2 ${item.rarity === 5 ? 'border-amber-400/60' : 'border-purple-400/60'} overflow-hidden bg-surface-700 flex-shrink-0 group-hover:border-white/60 transition-all`}>
        {src ? (
          <img src={src} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Search className="w-4 h-4 text-surface-500" />
          </div>
        )}
      </div>
      <span className={`${textSize} text-center truncate group-hover:text-[rgb(var(--btn-text-4th))] transition-colors ${item.rarity === 5 ? 'text-accent-gold' : 'text-purple-400'}`}>
        {entity?.name_zh || `ID:${item.item_id}`}
      </span>
    </button>
  )
}

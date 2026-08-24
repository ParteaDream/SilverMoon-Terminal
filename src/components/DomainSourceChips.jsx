import { MapPin } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { useTerminal } from '../context/TerminalContext'

/**
 * 获取来源单元格（表格列）：文字 + 自动同步的炼武秘境标点。
 * @param {string} source 获取来源文字
 * @param {Array} domains 关联的炼武秘境标点列表
 */
export function SourceCell({ source, domains }) {
  return (
    <div className="min-w-0 py-0.5">
      {source ? <p className="text-xs text-surface-400 truncate">{source}</p> : null}
      {domains && domains.length > 0 && (
        <div className="mt-1"><DomainSourceChips domains={domains} /></div>
      )}
      {!source && (!domains || domains.length === 0) && (
        <span className="text-xs text-surface-600">-</span>
      )}
    </div>
  )
}

/**
 * 炼武秘境关联标点 chips：图标 + 名称，点击召唤摹忆中枢
 * 并切换到对应地图、将地图自动拖拽到以该标点为中心。
 *
 * @param {Array<{placementId:string, mapId:string, mapName:string, markerName:string, icon:string|null, worldX:number, worldY:number}>} domains
 *        该材料/圣遗物关联的炼武秘境标点列表
 */
export default function DomainSourceChips({ domains }) {
  const { launchMemoryHub } = useTerminal()
  // 应用使用 HashRouter：必须用 react-router 的 location（而非 window.location），
  // 否则 showOnPage 与全局窗口显隐判断（location.pathname）不一致，窗口不会在当前页显示
  const location = useLocation()
  if (!domains || domains.length === 0) return null

  const handleClick = (e, d) => {
    // 阻止冒泡：列表视图中点击标点只打开摹忆中枢，不触发表格行点击（跳转详情页）
    e.stopPropagation()
    e.preventDefault()
    launchMemoryHub(
      {
        mapId: d.mapId,
        placementId: d.placementId,
        worldX: d.worldX,
        worldY: d.worldY,
        markerName: d.markerName,
      },
      location.pathname
    )
  }

  return (
    <div className="flex flex-wrap gap-1">
      {domains.map(d => (
        <button
          key={d.placementId}
          type="button"
          onClick={(e) => handleClick(e, d)}
          title={`${d.mapName || '大地图'} · ${d.markerName || '炼武秘境'}（点击打开摹忆中枢并定位）`}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-surface-800/80 border border-white/10 hover:border-amber-500/50 hover:bg-surface-800 transition-colors"
        >
          {d.icon ? (
            <img src={`local-media://${(d.icon || '').trim()}`} className="w-4 h-4 rounded object-cover shrink-0" draggable={false} alt="" />
          ) : (
            <MapPin className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          )}
          <span className="text-[10px] text-surface-300 truncate max-w-[140px]">{d.markerName || '炼武秘境'}</span>
        </button>
      ))}
    </div>
  )
}

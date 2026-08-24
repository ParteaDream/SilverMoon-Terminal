import { useState, useEffect } from 'react'

// ═══════════════════════════════════════════════════════════════
// 材料/圣遗物 ↔ 炼武秘境标点 关联索引
//
// 数据源：map_marker_placements.special_function.tooltip.{materials,artifacts}
//（摹忆中枢放置标点时通过「关联材料/关联圣遗物」维护，含种子数据）。
// 材料/圣遗物板块据此在「获取来源」中自动展示关联的炼武秘境标点
//（图标 + 名称，点击召唤摹忆中枢并定位到对应地图的标点中心）。
//
// 注意：必须走 mapQuery（而非 dbQuery）——用户放置的标点存放在 user.db 的
// map_marker_placements 全量表，mapQuery 会合并基准库与 user.db 两边的数据。
// ═══════════════════════════════════════════════════════════════

export const DOMAIN_SOURCES_CHANGED = 'domain-sources-changed'

/** 通知所有监听页面：摹忆中枢的关联标点发生了变化 */
export function notifyDomainSourcesChanged() {
  window.dispatchEvent(new CustomEvent(DOMAIN_SOURCES_CHANGED))
}

let _cache = null
let _loading = null

/** 强制下一次读取时重新查询数据库 */
export function invalidateDomainSources() {
  _cache = null
}

const EMPTY = { materials: new Map(), artifacts: new Map() }

// 兼容浏览器模式（无 electronAPI）
function mapQuerySafe(sql) {
  return window.electronAPI?.mapQuery
    ? window.electronAPI.mapQuery(sql)
    : Promise.resolve({ data: [] })
}

/**
 * 加载关联索引（模块级缓存，摹忆中枢变更时由 invalidate 失效）。
 * @returns {Promise<{materials: Map<number, DomainInfo[]>, artifacts: Map<number, DomainInfo[]>}>}
 */
export function getDomainSources() {
  if (_cache) return Promise.resolve(_cache)
  if (_loading) return _loading
  _loading = (async () => {
    try {
      // 1) 标点（map-query 自动合并 user.db 的用户放置）
      const [placedRes, markerRes, mapRes] = await Promise.all([
        mapQuerySafe(
          "SELECT id, map_id, marker_id, world_x, world_y, custom_name, special_function, layer_id FROM map_marker_placements WHERE special_function IS NOT NULL AND special_function != ''"
        ),
        mapQuerySafe('SELECT id, image_filename, name_zh FROM map_markers'),
        mapQuerySafe('SELECT id, name_zh FROM map_maps'),
      ])
      const markerMap = new Map()
      for (const m of markerRes?.data || []) markerMap.set(m.id, m)
      const mapNameMap = new Map()
      for (const m of mapRes?.data || []) mapNameMap.set(m.id, m.name_zh || '')

      const index = { materials: new Map(), artifacts: new Map() }
      const push = (map, id, info) => {
        if (!map.has(id)) map.set(id, [])
        map.get(id).push(info)
      }
      for (const row of placedRes?.data || []) {
        let sf = null
        try { sf = JSON.parse(row.special_function) } catch (_) { continue }
        const tooltip = sf?.tooltip
        if (!tooltip) continue
        const hasMats = Array.isArray(tooltip.materials) && tooltip.materials.length > 0
        const hasArts = Array.isArray(tooltip.artifacts) && tooltip.artifacts.length > 0
        if (!hasMats && !hasArts) continue
        const tmpl = markerMap.get(row.marker_id) || {}
        const info = {
          placementId: row.id,
          mapId: row.map_id,
          mapName: mapNameMap.get(row.map_id) || '',
          markerName: (row.custom_name || '').trim() || tmpl.name_zh || '',
          icon: tmpl.image_filename || null,
          worldX: row.world_x,
          worldY: row.world_y,
          layerId: row.layer_id || null,
        }
        if (hasMats) for (const id of tooltip.materials) push(index.materials, id, info)
        if (hasArts) for (const id of tooltip.artifacts) push(index.artifacts, id, info)
      }
      _cache = index
      return index
    } catch (e) {
      console.error('[domainSources] 加载关联索引失败:', e)
      return EMPTY
    } finally {
      _loading = null
    }
  })()
  return _loading
}

/**
 * React hook：加载关联索引，并在摹忆中枢发生关联变更（domain-sources-changed 事件）时自动刷新。
 */
export function useDomainSources() {
  const [index, setIndex] = useState(EMPTY)
  useEffect(() => {
    let alive = true
    const refresh = () => {
      invalidateDomainSources()
      getDomainSources().then(idx => {
        if (alive) setIndex(idx)
      })
    }
    refresh()
    window.addEventListener(DOMAIN_SOURCES_CHANGED, refresh)
    return () => {
      alive = false
      window.removeEventListener(DOMAIN_SOURCES_CHANGED, refresh)
    }
  }, [])
  return index
}

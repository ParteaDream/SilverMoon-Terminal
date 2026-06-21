import { useState, useMemo } from 'react'
import { Edit3, Trash2, Plus, ArrowUpDown, ArrowUp, ArrowDown, Filter, X, Square, CheckSquare } from 'lucide-react'

// ── Shared sort + filter logic, usable outside DataTable ──
export function useSortFilter(data, columns) {
  const [sortKeys, setSortKeys] = useState([])
  const [filters, setFilters] = useState({})
  const [showFilters, setShowFilters] = useState(false)

  function handleSort(key) {
    if (key === 'expand' || !key) return
    const idx = sortKeys.findIndex(s => s.key === key)

    if (idx >= 0) {
      // Already sorting by this key → toggle direction
      setSortKeys(prev =>
        prev.map(s => s.key === key ? { ...s, dir: s.dir === 'asc' ? 'desc' : 'asc' } : s)
      )
    } else {
      // New sort key → append (first-clicked = highest priority)
      setSortKeys(prev => [...prev, { key, dir: 'asc' }])
    }
  }

  function removeSort(key) {
    setSortKeys(prev => prev.filter(s => s.key !== key))
  }

  function clearSorts() {
    setSortKeys([])
  }

  function reorderSorts(fromIndex, toIndex) {
    setSortKeys(prev => {
      const next = [...prev]
      const [moved] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, moved)
      return next
    })
  }

  function setFilter(colKey, value) {
    setFilters(prev => {
      const next = { ...prev }
      if (value === '' || value == null) { delete next[colKey] } else { next[colKey] = value }
      return next
    })
  }

  function clearFilters() { setFilters({}) }

  const processed = useMemo(() => {
    let result = [...data]

    for (const [colKey, val] of Object.entries(filters)) {
      const col = columns.find(c => c.key === colKey)
      if (!col) continue
      if (col.filterType === 'text') {
        const lower = String(val).toLowerCase()
        result = result.filter(row => {
          const v = row[colKey]
          return v != null && String(v).toLowerCase().includes(lower)
        })
      } else if (col.filterType === 'select') {
        result = result.filter(row => {
          const raw = row[col.key]
          // Compare raw values directly (select options already use raw IDs)
          return raw == val
        })
      }
    }

    if (sortKeys.length > 0) {
      result.sort((a, b) => {
        for (const { key, dir } of sortKeys) {
          const va = a[key], vb = b[key]
          if (va == null && vb == null) continue
          if (va == null) return dir === 'asc' ? 1 : -1
          if (vb == null) return dir === 'asc' ? -1 : 1
          let cmp = 0
          if (typeof va === 'number' && typeof vb === 'number') { cmp = va - vb }
          else { const sa = String(va).toLowerCase(), sb = String(vb).toLowerCase(); cmp = sa < sb ? -1 : sa > sb ? 1 : 0 }
          if (cmp !== 0) return dir === 'asc' ? cmp : -cmp
        }
        return 0
      })
    }

    return result
  }, [data, sortKeys, filters, columns])

  // Gather filterable columns
  const filterableCols = useMemo(() =>
    columns.filter(c => c.filterType && c.key !== 'expand'),
  [columns])

  // Auto-derived select options from data
  const filterOptions = useMemo(() => {
    const opts = {}
    for (const col of filterableCols) {
      if (col.filterType === 'select' && !col.filterOptions) {
        const set = new Set()
        data.forEach(row => { const v = row[col.key]; if (v != null && v !== '') set.add(v) })
        opts[col.key] = [...set].sort()
      }
    }
    return opts
  }, [filterableCols, data])

  return {
    sortKeys, handleSort, removeSort, clearSorts, reorderSorts, filters, setFilter, clearFilters, showFilters, setShowFilters,
    filterableCols, filterOptions, processed, activeFilterCount: Object.keys(filters).length,
  }
}

// ── Sort bar component ──
export function SortBar({ sortKeys, columns, onToggleSort, onRemoveSort, onClearSorts, onReorderSorts }) {
  if (sortKeys.length === 0) return null

  function handleDragStart(e, index) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(index))
  }

  function handleDragOver(e) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  function handleDrop(e, toIndex) {
    e.preventDefault()
    const fromIndex = parseInt(e.dataTransfer.getData('text/plain'), 10)
    if (fromIndex === toIndex) return
    onReorderSorts(fromIndex, toIndex)
  }

  return (
    <div className="mb-2 flex items-center gap-1.5 flex-wrap">
      <span className="text-[11px] text-surface-400 flex-shrink-0">排序:</span>
      {sortKeys.map((s, i) => {
        const col = columns.find(c => c.key === s.key)
        const label = col?.label || s.key
        return (
          <span key={s.key}
            draggable
            onDragStart={e => handleDragStart(e, i)}
            onDragOver={handleDragOver}
            onDrop={e => handleDrop(e, i)}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-surface-800 border border-surface-700
                       text-[11px] text-primary-300 cursor-pointer hover:bg-surface-700 hover:border-primary-500/30
                       transition-colors select-none flex-shrink-0"
            onClick={() => onToggleSort(s.key)}
            title={`拖拽调整优先级 · 点击切换「${label}」排序方向`}
          >
            <span className="text-[9px] text-surface-500">{i + 1}</span>
            <span>{label}</span>
            <span className="font-mono">{s.dir === 'asc' ? '↑' : '↓'}</span>
            <button
              onClick={e => { e.stopPropagation(); onRemoveSort(s.key) }}
              className="ml-0.5 text-surface-500 hover:text-red-400 transition-colors leading-none"
              title={`移除「${label}」排序`}
            >
              ×
            </button>
          </span>
        )
      })}
      {sortKeys.length > 1 && (
        <button onClick={onClearSorts}
          className="ml-1 text-[11px] text-surface-500 hover:text-red-400 transition-colors flex-shrink-0"
        >
          清除全部
        </button>
      )}
    </div>
  )
}

// ── Filter bar component ──
export function FilterBar({ filterableCols, filters, setFilter, clearFilters, filterOptions, activeFilterCount }) {
  return (
    <div className="mb-3 p-3 bg-surface-800/50 rounded-lg border border-surface-700 flex items-center gap-3 flex-wrap animate-slide-up">
      {filterableCols.map(col => (
        <div key={col.key} className="flex items-center gap-1.5">
          <span className="text-[11px] text-surface-400">{col.label}</span>
          {col.filterType === 'select' ? (() => {
            const rawOpts = typeof col.filterOptions === 'function' ? col.filterOptions() : (col.filterOptions || filterOptions[col.key] || [])
            const options = rawOpts.map(o => typeof o === 'object' && o !== null ? o : { value: o, label: String(o) })
            return (
              <select
                value={filters[col.key] || ''}
                onChange={e => setFilter(col.key, e.target.value)}
                className="px-2 py-1 bg-surface-800 border border-surface-600 rounded text-xs text-white
                           focus:outline-none focus:border-primary-500"
              >
                <option value="">全部</option>
                {options.map(opt => (<option key={opt.value} value={opt.value}>{opt.label}</option>))}
              </select>
            )
          })() : col.filterType === 'text' ? (
            <input
              type="text" value={filters[col.key] || ''}
              onChange={e => setFilter(col.key, e.target.value)}
              placeholder="筛选..."
              className="px-2 py-1 w-28 bg-surface-800 border border-surface-600 rounded text-xs text-white
                         placeholder-surface-500 focus:outline-none focus:border-primary-500"
            />
          ) : null}
        </div>
      ))}
      {activeFilterCount > 0 && (
        <button onClick={clearFilters} className="flex items-center gap-1 text-[11px] text-red-400 hover:text-red-300 transition-colors">
          <X className="w-3 h-3" />清除筛选
        </button>
      )}
    </div>
  )
}

function SortIcon({ colKey, sortKeys }) {
  const entry = sortKeys.find(s => s.key === colKey)
  if (!entry) return <ArrowUpDown className="w-3 h-3 text-surface-600 group-hover:text-surface-400" />
  const idx = sortKeys.indexOf(entry)
  return (
    <span className="inline-flex items-center gap-0.5">
      {entry.dir === 'asc' ? <ArrowUp className="w-3 h-3 text-primary-400" /> : <ArrowDown className="w-3 h-3 text-primary-400" />}
      {sortKeys.length > 1 && <span className="text-[9px] text-primary-500 font-mono">{idx + 1}</span>}
    </span>
  )
}

export default function DataTable({ columns, data, onEdit, onDelete, onAdd, title, searchBar,
  sortKeys: extSortKeys, handleSort: extHandleSort, removeSort: extRemoveSort, clearSorts: extClearSorts, reorderSorts: extReorderSorts,
  filters: extFilters, setFilter: extSetFilter, clearFilters: extClearFilters,
  showFilters: extShowFilters, setShowFilters: extSetShowFilters,
  filterableCols: extFilterableCols, filterOptions: extFilterOptions,
  processed: extProcessed, activeFilterCount: extActiveFilterCount,
  selectable, selectedIds, onToggleSelect, onToggleSelectAll, onBulkDelete,
  onRowClick,
}) {
  // Use external state if provided (for sync with gallery view), else internal
  const internal = useSortFilter(data, columns)
  const hasExternalSort = extSortKeys !== undefined
  const sortKeys = extSortKeys ?? internal.sortKeys
  const handleSort = extHandleSort ?? internal.handleSort
  const removeSort = extRemoveSort ?? internal.removeSort
  const clearSorts = extClearSorts ?? internal.clearSorts
  const reorderSorts = extReorderSorts ?? internal.reorderSorts
  const filters = extFilters ?? internal.filters
  const setFilter = extSetFilter ?? internal.setFilter
  const clearFilters = extClearFilters ?? internal.clearFilters
  const showFilters = extShowFilters ?? internal.showFilters
  const setShowFilters = extSetShowFilters ?? internal.setShowFilters
  const filterableCols = extFilterableCols ?? internal.filterableCols
  const filterOptions = extFilterOptions ?? internal.filterOptions
  const processed = extProcessed ?? internal.processed
  const activeFilterCount = extActiveFilterCount ?? internal.activeFilterCount

  return (
    <div className="animate-fade-in">
      {/* Header — only show when not using external state (i.e. standalone mode) */}
      {title && (
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
            <p className="text-xs text-surface-500 mt-0.5">{processed.length} 条记录</p>
          </div>
          <div className="flex items-center gap-2">
            {searchBar}
            {filterableCols.length > 0 && (
              <button
                onClick={() => setShowFilters(!showFilters)}
                className={`flex items-center gap-1 px-2.5 py-2 rounded-lg text-xs transition-colors flex-shrink-0
                  ${showFilters || activeFilterCount > 0
                    ? 'bg-primary-500/10 text-primary-400 border border-primary-500/20'
                    : 'text-surface-400 hover:text-surface-200 hover:bg-surface-800'
                  }`}
              >
                <Filter className="w-3.5 h-3.5" />
                {activeFilterCount > 0 && (
                  <span className="w-4 h-4 rounded-full bg-primary-500 text-[10px] font-bold text-white flex items-center justify-center">
                    {activeFilterCount}
                  </span>
                )}
              </button>
            )}
            {onAdd && (
              <button
                onClick={onAdd}
                className="flex items-center gap-1.5 px-3 py-2 bg-primary-600 hover:bg-primary-500
                           rounded-lg text-xs font-medium text-white transition-colors flex-shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                添加
              </button>
            )}
            {selectable && selectedIds && selectedIds.size > 0 && onBulkDelete && (
              <button
                onClick={onBulkDelete}
                className="flex items-center gap-1.5 px-3 py-2 bg-red-600 hover:bg-red-500
                           rounded-lg text-xs font-medium text-white transition-colors flex-shrink-0"
              >
                <Trash2 className="w-3.5 h-3.5" />删除 ({selectedIds.size})
              </button>
            )}
          </div>
        </div>
      )}

      {/* Filter bar — only show when using internal state (external pages render their own) */}
      {!hasExternalSort && showFilters && filterableCols.length > 0 && (
        <FilterBar {...{ filterableCols, filters, setFilter, clearFilters, filterOptions, activeFilterCount }} />
      )}

      {/* Sort indicator — only show when using internal state (external pages render their own) */}
      {!hasExternalSort && (
        <SortBar sortKeys={sortKeys} columns={columns}
          onToggleSort={handleSort} onRemoveSort={removeSort} onClearSorts={clearSorts} onReorderSorts={reorderSorts} />
      )}

      {/* Table */}
      <div className="bg-surface-900 rounded-xl border border-surface-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-surface-800">
                {selectable && (
                  <th className="text-center px-3 py-3 w-10">
                    <button onClick={onToggleSelectAll} className="p-0.5 text-surface-400 hover:text-white transition-colors">
                      {selectedIds && selectedIds.size === processed.length && processed.length > 0
                        ? <CheckSquare className="w-4 h-4 text-primary-400" />
                        : <Square className="w-4 h-4" />
                      }
                    </button>
                  </th>
                )}
                {columns.map(col => (
                  <th key={col.key}
                    className="text-left px-4 py-3 text-xs font-medium text-surface-400 uppercase tracking-wider select-none group"
                    style={{ ...(col.width ? { width: col.width } : {}), ...(col.minWidth ? { minWidth: col.minWidth } : {}) }}
                  >
                    {col.key !== 'expand' && col.label ? (
                      <button
                        className="flex items-center gap-1.5 cursor-pointer hover:text-surface-200 transition-colors w-full text-left"
                        onClick={() => handleSort(col.key)}
                        title={`点击排序${col.label}，再次点击切换升降序`}
                      >
                        <span>{col.label}</span>
                        <SortIcon colKey={col.key} sortKeys={sortKeys} />
                      </button>
                    ) : <span>{col.label}</span>}
                  </th>
                ))}
                {(onEdit || onDelete) && (
                  <th className="text-right px-4 py-3 text-xs font-medium text-surface-400 uppercase tracking-wider w-24">操作</th>
                )}
              </tr>
            </thead>
            <tbody>
              {processed.map((row, i) => (
                <tr key={row.id || i}
                  className={`border-b border-surface-800/50 last:border-b-0 hover:bg-surface-800/30 transition-colors ${onRowClick ? 'cursor-pointer' : ''}`}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {selectable && (
                    <td className="text-center px-3 py-3 w-10" onClick={e => e.stopPropagation()}>
                      <button onClick={() => onToggleSelect(row.id)} className="p-0.5 text-surface-400 hover:text-white transition-colors">
                        {selectedIds && selectedIds.has(row.id)
                          ? <CheckSquare className="w-4 h-4 text-primary-400" />
                          : <Square className="w-4 h-4" />
                        }
                      </button>
                    </td>
                  )}
                  {columns.map(col => (
                    <td key={col.key} className="px-4 py-3 text-sm" style={{ ...(col.width ? { width: col.width } : {}), ...(col.minWidth ? { minWidth: col.minWidth } : {}) }}>
                      {col.render ? col.render(row) : row[col.key]}
                    </td>
                  ))}
                  {(onEdit || onDelete) && (
                    <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        {onEdit && (
                          <button onClick={() => onEdit(row)} className="p-1.5 rounded-md text-surface-400 hover:text-primary-400 hover:bg-surface-700 transition-colors">
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {onDelete && (
                          <button onClick={() => onDelete(row)} className="p-1.5 rounded-md text-surface-400 hover:text-red-400 hover:bg-surface-700 transition-colors">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {processed.length === 0 && (
                <tr>
                  <td colSpan={columns.length + (onEdit || onDelete ? 1 : 0) + (selectable ? 1 : 0)} className="px-4 py-12 text-center text-surface-500 text-sm">
                    {data.length === 0 ? '暂无数据' : '没有匹配筛选条件的结果'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {sortKeys.length > 1 && (
        <p className="mt-2 text-[10px] text-surface-600 text-right">
          提示：点击列头添加为最高优先级排序，点击排序标签切换升降序
        </p>
      )}
    </div>
  )
}

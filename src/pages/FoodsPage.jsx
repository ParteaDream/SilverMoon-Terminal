import { useState, useEffect, useRef, memo, useMemo, useCallback } from 'react'
import { useDb } from '../context/DbContext'
import { useNav } from '../context/NavContext'
import { loadPageStateSync } from '../utils/pageStateStore'
import { useScrollMemory } from '../hooks/useScrollMemory'
import { getScroller } from '../utils/scrollMemory.mjs'
import { useLazyImage, bumpLazyRevision } from '../hooks/useLazyImage'
import DataTable, { useSortFilter, SortBar, FilterBar } from '../components/DataTable'
import SearchBar from '../components/SearchBar'
import EditModal, { FormInput, FormSelect, ImagePicker } from '../components/EditModal'
import ColoredText from '../components/ColoredText'
import {
  FOOD_TYPES, FOOD_TYPE_ORDER, FOOD_TYPE_STYLE, FOOD_VARIANT_ORDER, variantMeta, variantDisplayName,
  RARITY_BG_STYLES, RARITY_COLOR, rarityStars,
} from '../utils/foodMeta'
import { attachFoodCharLinks, matchFoodSearch, primaryDishChar, DISH_CHAR_ROLE } from '../utils/dishLinks'
import {
  LayoutList, LayoutGrid, Plus, UtensilsCrossed, ArrowUpDown, Filter,
  CheckSquare, Square, X, ChefHat, ImageOff, Trash2,
} from 'lucide-react'

// 模块加载时预缓存星级背景图，避免首屏白底闪动
Object.values(RARITY_BG_STYLES).forEach(s => {
  const m = /url\((.*?)\)/.exec(s.backgroundImage || '')
  if (m) { const img = new Image(); img.src = m[1] }
})

// 模块级数据缓存 — 返回列表时命中缓存避免重新查询 SQLite，增删改时失效
let _cachedFoods = null
function _invalidateFoodsCache() { _cachedFoods = null }

// 功效类别是「提升防御、提升治疗效果」这种顿号拼接的多值串：筛选时按单项包含匹配，
// 预选项也由数据里拆出来的单项去重得到（比罗列全部组合短得多、也好用得多）。
function splitCategory(value) {
  return String(value || '').split(/[、,，/]/).map(s => s.trim()).filter(Boolean)
}

/** 从数据里汇总某个「多值字段」的全部候选值，按出现次数从多到少排序 */
function collectMultiOptions(rows, pick) {
  const counter = new Map()
  for (const row of rows || []) {
    for (const v of pick(row)) counter.set(v, (counter.get(v) || 0) + 1)
  }
  return [...counter.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'))
    .map(([value, count]) => ({ value, label: `${value}（${count}）` }))
}

// 列表查询刻意**不用**相关子查询算形态数/材料数：
// 双库模式下非开发者模式的写入落在 user.db，SELECT 侧只按 row_id 合并字段级 delta，
// 聚合列不会被重算（user.db 里新插入的形态/材料算不进去）。改成分别取两张关联表的
// food_id 再在 JS 里统计，两种模式下结果一致。
const FOODS_SQL = 'SELECT * FROM foods ORDER BY id'
const VARIANTS_SQL = 'SELECT food_id FROM food_variants'
const MATERIALS_SQL = 'SELECT food_id FROM food_materials'
// 搜索栏要能把角色名搜成「TA 的特殊料理 + 那道菜的原型」，所以列表行要带上关联角色
const CHARACTERS_SQL = 'SELECT name_zh, dish_name FROM characters'

function countByFoodId(rows) {
  const map = new Map()
  for (const r of rows || []) {
    const id = Number(r.food_id)
    if (!Number.isFinite(id)) continue
    map.set(id, (map.get(id) || 0) + 1)
  }
  return map
}

export default function FoodsPage() {
  const { query } = useDb()
  const { push } = useNav()
  const [foods, setFoods] = useState([])

  // 上一次离开时保存的页面状态（同步可读）：视图模式、搜索词、排序、筛选
  const initialSaved = loadPageStateSync('foods')?.state || null
  const [search, setSearch] = useState(() => initialSaved?.search || '')
  const [viewMode, setViewMode] = useState(() => {
    if (initialSaved?.viewMode) return initialSaved.viewMode
    try {
      const defs = JSON.parse(localStorage.getItem('default_view_mode') || '{}')
      if (defs.foods) return defs.foods
    } catch (_) {}
    return 'gallery'          // 画廊视图为默认视图
  })
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({})
  const [selected, setSelected] = useState(new Set())
  const [selectMode, setSelectMode] = useState(false)
  const [contextMenu, setContextMenu] = useState(null)

  // ── 滚动位置记忆 ──
  // stateRef 里的字段会随滚动快照一起落盘；sortKeys/filters/showFilters 由下面
  // 每次渲染赋值（useSortFilter 之后），保证「点开条目 → 返回」时排序与筛选不丢。
  const stateRef = useRef({ viewMode, search })
  const { restoring, readSaved, restore, saveNow, shouldRestore } = useScrollMemory('foods', {
    getState: () => stateRef.current,
  })
  const pushRef = useRef(push)
  pushRef.current = push

  useEffect(() => {
    if (!shouldRestore()) {
      // 从侧栏重新进入板块：回到干净状态（视图模式跟随全局默认，排序与筛选清空）
      const main = getScroller()
      if (main) main.scrollTop = 0
      try {
        const defs = JSON.parse(localStorage.getItem('default_view_mode') || '{}')
        setViewMode(defs.foods || 'gallery')
      } catch (_) { setViewMode('gallery') }
      setSearch('')
      setSortKeys([])
      clearFilters()
      setShowFilters(false)
      loadData()
      return undefined
    }
    let cancelled = false
    ;(async () => {
      _invalidateFoodsCache()
      const saved = readSaved()
      const st = saved && saved.state
      // 视图模式/搜索/排序/筛选的初始值已经在 useState 里同步取过了，
      // 这里只兜一次异步读到的快照（readSaved 可能带回更新的内容）。
      if (st) {
        if (st.viewMode) setViewMode(st.viewMode)
        if (st.search) setSearch(st.search)
        if (Array.isArray(st.sortKeys)) setSortKeys(st.sortKeys)
        if (st.filters) restoreFilters(st.filters)
        if (st.showFilters != null) setShowFilters(!!st.showFilters)
      }
      await loadData()
      if (cancelled) return
      await restore(saved && saved.snapshot)
    })()
    return () => { cancelled = true }
  }, [])

  async function loadData() {
    if (_cachedFoods !== null) { setFoods(_cachedFoods); return }
    await refreshFromDb()
  }

  // 强制回源：空数组也是有效的缓存值，用 truthy 判断会把「首次加载时库里还没有数据」
  // 永远钉住，所以这里显式失效再查。
  async function refreshFromDb() {
    const [foodRes, variantRes, matRes, charRes] = await Promise.all([
      query(FOODS_SQL), query(VARIANTS_SQL), query(MATERIALS_SQL), query(CHARACTERS_SQL),
    ])
    const variantCounts = countByFoodId(variantRes.data)
    const materialCounts = countByFoodId(matRes.data)
    const data = attachFoodCharLinks((foodRes.data || []).map(f => ({
      ...f,
      variant_count: variantCounts.get(Number(f.id)) || 0,
      material_count: materialCounts.get(Number(f.id)) || 0,
    })), charRes.data || [])
    _cachedFoods = data
    setFoods(data)
    return data
  }

  async function reload() {
    _invalidateFoodsCache()
    await refreshFromDb()
  }

  const navigateToDetail = useCallback((id) => {
    saveNow()
    pushRef.current(`/foods/${id}`)
  }, [saveNow])

  const handleCardContextMenu = useCallback((e, food) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, food })
  }, [])
  const handleRowContextMenu = useCallback((e, row) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, food: row })
  }, [])

  // ── 选中 / 多选 ──
  const toggleSelect = useCallback((id) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }, [])

  function exitSelectMode() {
    setSelectMode(false)
    setSelected(new Set())
  }

  function toggleSelectAll() {
    const ids = processed.map(r => r.id)
    if (ids.length > 0 && ids.every(id => selected.has(id))) setSelected(new Set())
    else setSelected(new Set(ids))
  }

  // 选中项广播给开发者工具栏的「食物爬虫」（与武器/圣遗物/材料同一套约定）
  useEffect(() => {
    const selectedData = foods.filter(f => selected.has(f.id))
    window.dispatchEvent(new CustomEvent('devtoolbar-food-selection', { detail: selectedData }))
  }, [selected, foods])

  // 开发者工具栏爬完写库后通知本页回源（两边不共享 React 状态）
  useEffect(() => {
    const handler = () => { reload() }
    window.addEventListener('food-data-changed', handler)
    return () => window.removeEventListener('food-data-changed', handler)
  }, [])

  // ── 搜索过滤 ──
  // 名称/英文名/功效/效果之外，还能按**角色名**搜：搜「琴」同时给出她的特殊料理
  // 「提神醒脑披萨」与它的原型「烤蘑菇披萨」（关联口径集中在 utils/dishLinks.js）
  const filtered = useMemo(() => foods.filter(f => matchFoodSearch(f, search)), [foods, search])
  // 搜索中才在结果里标出"为什么这条会出现"，平时浏览不加角标
  const searchActive = search.trim().length > 0

  // ── 筛选项候选值 ──
  // 从当前数据里汇总，按出现次数排序（最常见的排前面）。用 ref 让 columns 的
  // useMemo 保持稳定引用，避免每次数据变化都重建列定义导致表格全量重排。
  const filterOptionSourceRef = useRef([])
  filterOptionSourceRef.current = foods
  const multiFilterOptions = useMemo(() => ({
    category: collectMultiOptions(foods, f => splitCategory(f.category)),
    region: collectMultiOptions(foods, f => {
      const v = String(f.region || '').trim()
      return v ? [v] : []
    }),
  }), [foods])

  // ── 表格列 ──
  const columns = useMemo(() => [
    { key: 'image', label: '', width: '60px', render: row => <FoodThumb food={row} /> },
    { key: 'id', label: 'ID', width: '74px',
      render: row => <span className="text-xs text-surface-400 font-mono">{row.id}</span>,
      filterType: 'text' },
    { key: 'rarity', label: '稀有度', width: '76px',
      render: row => <span className={RARITY_COLOR[row.rarity] || 'text-surface-400'}>{rarityStars(row.rarity)}</span>,
      filterType: 'select', filterOptions: [0, 1, 2, 3, 4, 5].map(v => ({ value: v, label: v ? '★'.repeat(v) : '无' })) },
    { key: 'name_zh', label: '名称',
      render: row => (
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-medium text-white hover:text-primary-400 cursor-pointer transition-colors truncate"
            onClick={() => navigateToDetail(row.id)}>{row.name_zh}</span>
          <VariantPill count={row.variant_count} />
          {searchActive && <DishCharTag link={primaryDishChar(row.char_links)} />}
        </div>
      ),
      filterType: 'text' },
    { key: 'type', label: '类型', width: '104px',
      render: row => <TypeBadge type={row.type} />,
      filterType: 'select',
      filterValue: v => FOOD_TYPES[v] || v,
      filterOptions: () => FOOD_TYPE_ORDER.map(k => ({ value: k, label: FOOD_TYPES[k] })) },
    { key: 'variant_count', label: '形态', width: '70px',
      render: row => <span className="text-xs text-surface-400">{row.variant_count || 1}</span> },
    { key: 'material_count', label: '材料', width: '70px',
      render: row => (row.material_count > 0
        ? <span className="text-xs text-emerald-300">{row.material_count}</span>
        : <span className="text-xs text-surface-600">—</span>) },
    { key: 'category', label: '功效', width: '150px',
      render: row => <span className="text-xs text-surface-400 truncate">{row.category || '-'}</span>,
      // 功效是「提升防御、提升治疗效果」这类多值串：下拉列单项，按包含匹配
      filterType: 'select',
      filterOptions: () => multiFilterOptions.category,
      filterMatch: (raw, val) => splitCategory(raw).includes(val) },
    { key: 'region', label: '地区', width: '92px',
      render: row => <span className="text-xs text-surface-400 truncate">{row.region || '-'}</span>,
      filterType: 'select',
      filterOptions: () => multiFilterOptions.region,
      filterMatch: (raw, val) => String(raw || '').trim() === val },
    { key: 'effect', label: '效果',
      render: row => <span className="text-xs text-surface-500 max-w-xs line-clamp-2"><ColoredText text={row.effect || '-'} /></span>,
      filterType: 'text' },
  ], [navigateToDetail, multiFilterOptions, searchActive])

  const {
    sortKeys, setSortKeys, handleSort, removeSort, clearSorts, reorderSorts,
    filters, setFilter, clearFilters,
    showFilters, setShowFilters, filterableCols, filterOptions,
    processed, activeFilterCount,
  } = useSortFilter(
    filtered, columns,
    // 初始值直接取上次离开时保存的状态，避免「闪一下默认排序再跳回去」
    Array.isArray(initialSaved?.sortKeys) ? initialSaved.sortKeys : [],
    initialSaved?.filters || {},
    !!initialSaved?.showFilters,
  )

  /** 一次性恢复整份筛选条件（没有 setFilters，只能逐项 set） */
  const restoreFilters = useCallback((next) => {
    clearFilters()
    for (const [key, value] of Object.entries(next || {})) {
      if (value !== '' && value != null) setFilter(key, value)
    }
  }, [clearFilters, setFilter])

  const lazySyncDone = useRef(false)
  useEffect(() => {
    if (!lazySyncDone.current) { lazySyncDone.current = true; return }
    bumpLazyRevision()
  }, [sortKeys, filters, viewMode])

  stateRef.current = { viewMode, search, sortKeys, filters, showFilters }

  // ── 增删改 ──
  function openAdd() {
    setEditing(null)
    setForm({ id: 0, type: 'dish', rarity: 1, has_variants: 0, sort_order: 0 })
    setModalOpen(true)
  }
  function openEdit(row) {
    setEditing(row)
    setForm({ ...row })
    setModalOpen(true)
  }

  async function handleSave() {
    const keys = ['name_zh', 'name_en', 'type', 'category', 'region', 'rarity', 'description_zh',
      'effect', 'source', 'image', 'has_variants', 'recipe_source', 'recipe_price',
      'special_char', 'specialty', 'sort_order']
    if (editing) {
      await query(`UPDATE foods SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`,
        [...keys.map(k => form[k] ?? null), editing.id])
    } else {
      const newId = Number(form.id)
      if (!newId) { alert('请填写 ID'); return }
      const dup = await query('SELECT COUNT(*) AS cnt FROM foods WHERE id = ?', [newId])
      if (dup.data?.[0]?.cnt > 0) { alert(`ID ${newId} 已存在，请使用其他 ID`); return }
      await query(
        `INSERT INTO foods (${['id', ...keys].join(', ')}) VALUES (${['id', ...keys].map(() => '?').join(', ')})`,
        [newId, ...keys.map(k => form[k] ?? null)]
      )
    }
    setModalOpen(false)
    await reload()
  }

  async function handleDelete(row) {
    if (!confirm(`确定删除食物「${row.name_zh}」？其形态与烹饪材料关联会一并删除。`)) return
    await query('DELETE FROM food_variants WHERE food_id = ?', [row.id])
    await query('DELETE FROM food_materials WHERE food_id = ?', [row.id])
    await query('DELETE FROM foods WHERE id = ?', [row.id])
    await reload()
  }

  async function handleBulkDelete() {
    if (selected.size === 0) return
    if (!confirm(`确定删除选中的 ${selected.size} 个食物？此操作不可撤销。`)) return
    const ids = [...selected]
    const ph = ids.map(() => '?').join(',')
    await query(`DELETE FROM food_variants WHERE food_id IN (${ph})`, ids)
    await query(`DELETE FROM food_materials WHERE food_id IN (${ph})`, ids)
    await query(`DELETE FROM foods WHERE id IN (${ph})`, ids)
    exitSelectMode()
    await reload()
  }

  const selectedCount = selected.size
  const allSelected = processed.length > 0 && processed.every(r => selected.has(r.id))

  return (
    <div className={`p-6 ${restoring ? 'opacity-0' : 'opacity-100'} transition-opacity duration-100`}>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight flex items-center gap-2">
            <UtensilsCrossed className="w-4 h-4 text-primary-400" />食物
          </h1>
          <p className="text-xs text-surface-500 mt-0.5">
            {processed.length} 条记录
            {foods.some(f => f.variant_count >= 3) && ` · ${foods.filter(f => f.variant_count >= 3).length} 道含三形态`}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center rounded-lg bg-surface-800 border border-surface-700 p-0.5">
            <button onClick={() => setViewMode('table')} title="列表视图"
              className={`p-1.5 rounded-md transition-colors ${viewMode === 'table' ? 'bg-surface-700 text-white' : 'text-surface-400 hover:text-surface-200'}`}>
              <LayoutList className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => setViewMode('gallery')} title="画廊视图"
              className={`p-1.5 rounded-md transition-colors ${viewMode === 'gallery' ? 'bg-surface-700 text-white' : 'text-surface-400 hover:text-surface-200'}`}>
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>
          </div>

          <SearchBar value={search} onChange={setSearch} placeholder="搜索食物、角色..." />

          <button
            onClick={() => {
              if (sortKeys.length === 0) setSortKeys([{ key: 'id', dir: 'desc' }])
              else setSortKeys(prev => prev.map(s => ({ ...s, dir: s.dir === 'asc' ? 'desc' : 'asc' })))
            }}
            className="flex items-center gap-1 px-2.5 py-2 rounded-lg text-xs flex-shrink-0 text-surface-400 hover:text-surface-200 transition-colors"
            title="颠倒排序">
            <ArrowUpDown className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-1 px-2.5 py-2 rounded-lg text-xs transition-colors flex-shrink-0 border
              ${showFilters || activeFilterCount > 0
                ? 'bg-primary-500/10 text-primary-400 border-primary-500/20'
                : 'text-surface-400 hover:text-surface-200 hover:bg-surface-800 border-transparent'}`}>
            <Filter className="w-3.5 h-3.5" />
            筛选
            {activeFilterCount > 0 && (
              <span className="w-4 h-4 rounded-full bg-primary-500 text-[10px] font-bold text-white flex items-center justify-center">{activeFilterCount}</span>
            )}
          </button>

          <button
            onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-colors flex-shrink-0
              ${selectMode
                ? 'bg-primary-500/15 text-primary-300 border-primary-500/30'
                : 'text-surface-300 border-surface-700 hover:bg-surface-800'}`}
            title="开启后可勾选多个条目，交给开发者工具栏的食物爬虫批量爬取">
            {selectMode ? <X className="w-3.5 h-3.5" /> : <CheckSquare className="w-3.5 h-3.5" />}
            {selectMode ? '退出多选' : '多选模式'}
          </button>

          <button onClick={openAdd}
            className="flex items-center gap-1.5 px-3 py-2 bg-primary-600 hover:bg-primary-500 rounded-lg text-xs font-medium text-white transition-colors flex-shrink-0">
            <Plus className="w-3.5 h-3.5" />添加
          </button>
        </div>
      </div>

      {showFilters && filterableCols.length > 0 && (
        <FilterBar {...{ filterableCols, filters, setFilter, clearFilters, filterOptions, activeFilterCount }} />
      )}

      <SortBar sortKeys={sortKeys} columns={columns}
        onToggleSort={handleSort} onRemoveSort={removeSort} onClearSorts={clearSorts} onReorderSorts={reorderSorts} />

      {viewMode === 'table' ? (
        <DataTable title="" columns={columns} data={filtered}
          sortKeys={sortKeys} handleSort={handleSort} removeSort={removeSort} clearSorts={clearSorts} reorderSorts={reorderSorts}
          filters={filters} setFilter={setFilter} clearFilters={clearFilters}
          showFilters={false} filterableCols={filterableCols} filterOptions={filterOptions}
          processed={processed} activeFilterCount={activeFilterCount}
          onEdit={null} onDelete={null} onAdd={null} searchBar={null}
          selectable={selectMode}
          selectedIds={selected}
          onToggleSelect={toggleSelect}
          onToggleSelectAll={toggleSelectAll}
          onRowClick={row => (selectMode ? toggleSelect(row.id) : navigateToDetail(row.id))}
          onRowContextMenu={handleRowContextMenu} itemIdKey="id"
        />
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 2xl:grid-cols-12 gap-2">
          {processed.map(f => (
            <FoodGalleryCard
              key={f.id}
              food={f}
              showCharTag={searchActive}
              selectMode={selectMode}
              checked={selected.has(f.id)}
              onToggleSelect={toggleSelect}
              onNavigate={navigateToDetail}
              onContextMenu={handleCardContextMenu}
            />
          ))}
          {processed.length === 0 && (
            <div className="col-span-full py-16 text-center text-surface-500 text-sm">
              {foods.length === 0
                ? '暂无食物数据，点击右上角「查漏补缺」从 nanoka 拉取全部食物'
                : '没有匹配筛选条件的结果'}
            </div>
          )}
        </div>
      )}

      {/* 多选浮动操作条 */}
      {selectMode && (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-16 z-[60] flex items-center gap-2 px-3 py-2 rounded-xl
                        bg-surface-900/95 backdrop-blur-xl border border-surface-700 shadow-2xl animate-slide-up">
          <button onClick={toggleSelectAll}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-surface-300 hover:bg-surface-800 transition-colors">
            {allSelected ? <CheckSquare className="w-3.5 h-3.5 text-primary-400" /> : <Square className="w-3.5 h-3.5" />}
            {allSelected ? '取消全选' : '全选'}（{processed.length}）
          </button>
          <span className="w-px h-4 bg-surface-700" />
          <span className="text-xs text-surface-400 px-1">已选 {selectedCount}</span>
          <span className="text-[11px] text-surface-500 border-l border-surface-700 pl-2">
            爬取请用底部「食物爬虫」
          </span>
          <button onClick={handleBulkDelete} disabled={selectedCount === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-red-400 hover:bg-red-500/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            <Trash2 className="w-3.5 h-3.5" />删除
          </button>
          <button onClick={exitSelectMode} className="p-1.5 rounded-lg text-surface-400 hover:text-white hover:bg-surface-800 transition-colors" title="退出多选">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <EditModal isOpen={modalOpen} onClose={() => setModalOpen(false)} onSave={handleSave}
        title={editing ? `编辑食物 - ${editing.name_zh}` : '添加食物'}>
        <div className="grid grid-cols-2 gap-x-6">
          <FormInput label="ID" value={form.id ?? 0} onChange={v => setForm({ ...form, id: v === '' ? 0 : Number(v) })} />
          <FormInput label="中文名" value={form.name_zh} onChange={v => setForm({ ...form, name_zh: v })} />
          <FormInput label="英文名" value={form.name_en} onChange={v => setForm({ ...form, name_en: v })} />
          <FormSelect label="类型" value={form.type} onChange={v => setForm({ ...form, type: v })}
            options={FOOD_TYPE_ORDER.map(k => ({ value: k, label: FOOD_TYPES[k] }))} />
          <FormInput label="稀有度 (0-5)" value={form.rarity} onChange={v => setForm({ ...form, rarity: Number(v) })} type="number" />
          <FormSelect label="三形态" value={form.has_variants ? '1' : '0'}
            onChange={v => setForm({ ...form, has_variants: Number(v) })}
            options={[{ value: '0', label: '单形态' }, { value: '1', label: '奇怪的 / 普通 / 美味的' }]} />
          <FormInput label="功效类别" value={form.category} onChange={v => setForm({ ...form, category: v })} />
          <FormInput label="地区" value={form.region} onChange={v => setForm({ ...form, region: v })} />
        </div>
        <FormInput label="简介" value={form.description_zh} onChange={v => setForm({ ...form, description_zh: v })} multiline />
        <FormInput label="效果" value={form.effect} onChange={v => setForm({ ...form, effect: v })} multiline />
        <div className="grid grid-cols-2 gap-x-6">
          <FormInput label="获取方式" value={form.source} onChange={v => setForm({ ...form, source: v })} />
          <FormInput label="食谱获取" value={form.recipe_source} onChange={v => setForm({ ...form, recipe_source: v })} />
        </div>
        <ImagePicker label="食物图片" currentImage={form.image} onSelect={v => setForm({ ...form, image: v })} onRemove={() => setForm({ ...form, image: null })} />
      </EditModal>

      {/* 右键菜单 */}
      {contextMenu && (
        <div className="fixed z-[300] w-44 py-1 rounded-xl bg-surface-900/95 backdrop-blur-xl border border-white/10 shadow-2xl animate-scale-in"
          style={{ left: Math.min(contextMenu.x, window.innerWidth - 190), top: Math.min(contextMenu.y, window.innerHeight - 150) }}
          onClick={e => e.stopPropagation()}>
          <MenuItem onClick={() => { navigateToDetail(contextMenu.food.id); setContextMenu(null) }} icon={<UtensilsCrossed className="w-3 h-3" />}>
            查看详情
          </MenuItem>
          <MenuItem onClick={() => { openEdit(contextMenu.food); setContextMenu(null) }} icon={<ChefHat className="w-3 h-3" />}>
            编辑
          </MenuItem>
          <MenuItem danger onClick={() => { handleDelete(contextMenu.food); setContextMenu(null) }} icon={<Trash2 className="w-3 h-3" />}>
            删除
          </MenuItem>
        </div>
      )}
      {contextMenu && <div className="fixed inset-0 z-[299]" onClick={() => setContextMenu(null)} onContextMenu={e => { e.preventDefault(); setContextMenu(null) }} />}

    </div>
  )
}

// ── 辅助组件 ──

function MenuItem({ children, icon, onClick, danger }) {
  return (
    <button onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-xs transition-colors
        ${danger ? 'text-red-400 hover:bg-red-500/10' : 'text-surface-300 hover:bg-white/10'}`}>
      {icon}{children}
    </button>
  )
}

export function TypeBadge({ type }) {
  const label = FOOD_TYPES[type] || type || '—'
  return (
    <span className={`inline-block text-[10px] px-2 py-0.5 rounded-full border ${FOOD_TYPE_STYLE[type] || FOOD_TYPE_STYLE.other}`}>
      {label}
    </span>
  )
}

/** 形态指示：三条（奇怪/普通/美味）；单形态不额外标注（形态列已给出数字） */
export function VariantPill({ count }) {
  if (!count || count < 3) return null
  return (
    <span className="flex items-center gap-0.5 flex-shrink-0" title="含「奇怪的 / 普通 / 美味的」三种形态">
      {FOOD_VARIANT_ORDER.map(k => (
        <span key={k} className={`w-1.5 h-1.5 rounded-full ${variantMeta(k).dot}`} />
      ))}
    </span>
  )
}

/**
 * 角色关联角标：只有搜索时才出现，用来说明"这条为什么会被搜出来"
 * ——「琴·特殊料理」（搜的是 TA 的菜）或「琴·原型」（它是 TA 特殊料理的原型）。
 */
export function DishCharTag({ link }) {
  if (!link) return null
  const isSpecial = link.role === DISH_CHAR_ROLE.special
  return (
    <span
      title={isSpecial ? `${link.name}的特殊料理` : `${link.name}的特殊料理的原型（基础菜）`}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border border-fuchsia-500/30
                 bg-fuchsia-500/10 text-[9px] leading-none text-fuchsia-300 max-w-full"
    >
      <ChefHat className="w-2.5 h-2.5 flex-shrink-0" />
      <span className="truncate">{link.name}·{isSpecial ? '特殊料理' : '原型'}</span>
    </span>
  )
}

function FoodThumb({ food }) {
  const { ref, src } = useLazyImage(food.image, 256)
  const bgStyle = RARITY_BG_STYLES[food.rarity || 1]
  return (
    <div ref={ref} className="w-10 h-10 rounded-lg overflow-hidden shrink-0 flex items-center justify-center" style={bgStyle}>
      {src ? <img src={src} alt="" className="w-7 h-7 object-contain drop-shadow-md" />
        : <UtensilsCrossed className="w-5 h-5 text-surface-500" />}
    </div>
  )
}

function FoodGalleryThumb({ filename, filter }) {
  const { ref, src } = useLazyImage(filename, 256)
  // 必须用绝对定位给出确定的宽高：按百分比撑高的容器在 aspect-square 父级里
  // 会算成 0×0，而 useLazyImage 明确跳过 0×0 元素（图片永远不会加载）。
  return (
    <div ref={ref} className="absolute inset-1.5 flex items-center justify-center">
      {src ? <img src={src} alt="" className="w-full h-full object-contain drop-shadow-md" style={{ filter }} /> : null}
    </div>
  )
}

export const FoodGalleryCard = memo(function FoodGalleryCard({
  food, showCharTag, selectMode, checked, onToggleSelect, onNavigate, onContextMenu,
}) {
  const bgStyle = RARITY_BG_STYLES[food.rarity || 1]
  const hasVariants = (food.variant_count || 1) >= 3
  const missingMaterials = (food.material_count || 0) === 0 && food.type !== 'ingredient' && food.type !== 'drink'
  const meta = variantMeta('normal')
  const charTag = showCharTag ? primaryDishChar(food.char_links) : null

  function handleClick() {
    if (selectMode) onToggleSelect(food.id)
    else onNavigate(food.id)
  }

  return (
    <div
      data-item-id={food.id}
      onClick={handleClick}
      onContextMenu={(e) => onContextMenu(e, food)}
      className={`group relative rounded-xl overflow-hidden border bg-surface-800/50 transition-all duration-200 cursor-pointer
        ${checked ? 'border-primary-500 ring-2 ring-primary-500/40' : 'border-surface-700/50 hover:border-primary-500/50 hover:scale-[1.03]'}`}
      style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 140px' }}
      title={`${food.name_zh}${hasVariants ? '（三形态）' : ''}`}
    >
      <div className="aspect-square relative flex items-center justify-center p-1.5" style={bgStyle}>
        {food.image
          ? <FoodGalleryThumb filename={food.image} filter={meta.filter} />
          : <ImageOff className="w-6 h-6 text-surface-500" />}

        {/* 三形态标识 */}
        {hasVariants && (
          <div className="absolute top-1 right-1 flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-black/55 backdrop-blur-sm border border-white/10">
            {FOOD_VARIANT_ORDER.map(k => (
              <span key={k} className={`w-1.5 h-1.5 rounded-full ${variantMeta(k).dot}`} />
            ))}
          </div>
        )}

        {/* 数据缺口提示 */}
        {missingMaterials && (
          <span className="absolute top-1 left-1 w-2 h-2 rounded-full bg-amber-400/90 shadow" title="暂无烹饪材料数据，可右键爬取补齐" />
        )}

        {/* 多选勾选 */}
        {selectMode && (
          <div className={`absolute bottom-1 right-1 w-5 h-5 rounded-md border flex items-center justify-center transition-colors
            ${checked ? 'bg-primary-500 border-primary-500 text-white' : 'bg-black/40 border-white/30 text-transparent'}`}>
            <span className="text-[10px] font-bold">✓</span>
          </div>
        )}
      </div>

      <div className="px-2 py-1.5">
        <p className="text-[11px] font-semibold text-white truncate leading-tight">{food.name_zh}</p>
        <div className="flex items-center justify-between mt-0.5 gap-1">
          <span className={`text-[9px] ${RARITY_COLOR[food.rarity] || 'text-surface-400'}`}>{rarityStars(food.rarity)}</span>
          {(food.material_count || 0) > 0 && (
            <span className="text-[9px] text-surface-500 flex-shrink-0">{food.material_count} 材料</span>
          )}
        </div>
        {charTag && <div className="mt-1"><DishCharTag link={charTag} /></div>}
      </div>
    </div>
  )
})

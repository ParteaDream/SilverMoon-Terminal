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
import Reader from '../components/Reader'
import {
  BOOK_GENRES, BOOK_COUNTRIES, BOOK_SOURCE_TYPES, splitMulti, collectBookOptions,
  genreStyle, countryStyle, versionSortKey,
} from '../utils/bookMeta'
import { RARITY_BG_STYLES, RARITY_COLOR, rarityStars } from '../utils/rarity'
import {
  LayoutList, LayoutGrid, Plus, BookOpen, BookMarked, ArrowUpDown, Filter,
  CheckSquare, Square, X, ImageOff, Trash2, Library,
} from 'lucide-react'

// 模块加载时预缓存星级背景图，避免首屏白底闪动
Object.values(RARITY_BG_STYLES).forEach(s => {
  const m = /url\((.*?)\)/.exec(s.backgroundImage || '')
  if (m) { const img = new Image(); img.src = m[1] }
})

// 模块级数据缓存 — 返回列表时命中缓存避免重新查询 SQLite，增删改时失效
let _cachedBooks = null
function _invalidateBooksCache() { _cachedBooks = null }

// 与食物板块同样的理由：列表刻意**不用**相关子查询算卷数/正文数。
// 双库模式下非开发者模式的写入落在 user.db，聚合列不会被重算，改成把
// book_volumes 的 book_id 与正文长度取回来在 JS 里统计，两种模式下结果一致。
const BOOKS_SQL = 'SELECT * FROM books ORDER BY id'
const VOLUMES_SQL = "SELECT book_id, LENGTH(COALESCE(content, '')) AS content_len FROM book_volumes"

export default function BooksPage() {
  const { query } = useDb()
  const { push } = useNav()
  const [books, setBooks] = useState([])

  // 上一次离开时保存的页面状态（同步可读）：视图模式、搜索词、排序、筛选
  const initialSaved = loadPageStateSync('books')?.state || null
  const [search, setSearch] = useState(() => initialSaved?.search || '')
  const [viewMode, setViewMode] = useState(() => {
    if (initialSaved?.viewMode) return initialSaved.viewMode
    try {
      const defs = JSON.parse(localStorage.getItem('default_view_mode') || '{}')
      if (defs.books) return defs.books
    } catch (_) {}
    return 'gallery'          // 画廊视图为默认视图：封面是书籍最直观的标识
  })
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({})
  const [selected, setSelected] = useState(new Set())
  const [selectMode, setSelectMode] = useState(false)
  const [contextMenu, setContextMenu] = useState(null)
  // 右键「开始阅读」/ Alt+点击：直接在列表页弹出阅读器，不经过详情页
  const [quickRead, setQuickRead] = useState(null)
  const [quickReadLoading, setQuickReadLoading] = useState(null)

  // ── 滚动位置记忆 ──
  const stateRef = useRef({ viewMode, search })
  const { restoring, readSaved, restore, saveNow, shouldRestore } = useScrollMemory('books', {
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
        setViewMode(defs.books || 'gallery')
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
      _invalidateBooksCache()
      const saved = readSaved()
      const st = saved && saved.state
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
    if (_cachedBooks !== null) { setBooks(_cachedBooks); return }
    await refreshFromDb()
  }

  async function refreshFromDb() {
    const [bookRes, volRes] = await Promise.all([query(BOOKS_SQL), query(VOLUMES_SQL)])
    const volumeCounts = new Map()
    const bodyCounts = new Map()
    for (const r of volRes.data || []) {
      const id = Number(r.book_id)
      if (!Number.isFinite(id)) continue
      volumeCounts.set(id, (volumeCounts.get(id) || 0) + 1)
      if (Number(r.content_len) > 0) bodyCounts.set(id, (bodyCounts.get(id) || 0) + 1)
    }
    const data = (bookRes.data || []).map(b => ({
      ...b,
      volume_count: volumeCounts.get(Number(b.id)) || 0,
      body_count: bodyCounts.get(Number(b.id)) || 0,
    }))
    _cachedBooks = data
    setBooks(data)
    return data
  }

  async function reload() {
    _invalidateBooksCache()
    await refreshFromDb()
  }

  const navigateToDetail = useCallback((id) => {
    saveNow()
    pushRef.current(`/books/${id}`)
  }, [saveNow])

  /**
   * 直接从列表开始阅读：在这里就地取卷并弹出阅读器。
   *
   * 原先的做法是跳到 `/books/<id>?read=1` 让详情页开阅读器，代价是先渲染一遍
   * 详情页（封面、卷列表、几段卡片）再盖上一层全屏遮罩——用户看到的是一次闪烁。
   * 阅读器本来只依赖书名 + 卷，列表页把这两样取齐就够了。
   */
  const openReader = useCallback(async (id) => {
    const book = books.find(b => Number(b.id) === Number(id))
    if (!book) return
    setQuickReadLoading(id)
    try {
      const res = await query('SELECT * FROM book_volumes WHERE book_id = ? ORDER BY volume_no', [id])
      // 双库模式下 user.db 新插入的关联行是"追加"进结果的，这里再按 book_id 兜一次
      const vols = (res.data || []).filter(v => Number(v.book_id) === Number(id))
      vols.sort((a, b) => (Number(a.volume_no) || 0) - (Number(b.volume_no) || 0))
      if (vols.length === 0) {
        alert(`《${book.name_zh}》还没有卷数据，可在详情页手动补录，或用开发者工具栏的书籍爬虫补齐`)
        return
      }
      setQuickRead({
        book,
        chapters: vols.map((v, i) => ({
          id: v.id != null ? v.id : i,
          title: v.title_zh || `卷${v.volume_no || i + 1}`,
          subtitle: v.source ? `获取：${String(v.source).split('\n')[0]}` : '',
          content: v.content || '',
        })),
      })
    } catch (e) {
      alert('打开阅读器失败：' + (e.message || '未知错误'))
    } finally {
      setQuickReadLoading(null)
    }
  }, [books, query])

  const handleCardContextMenu = useCallback((e, book) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, book })
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

  // 选中项广播给开发者工具栏的「书籍爬虫」（与食物/武器/材料同一套约定）
  useEffect(() => {
    const selectedData = books.filter(b => selected.has(b.id))
    window.dispatchEvent(new CustomEvent('devtoolbar-book-selection', { detail: selectedData }))
  }, [selected, books])

  // 开发者工具栏爬完写库后通知本页回源（两边不共享 React 状态）
  useEffect(() => {
    const handler = () => { reload() }
    window.addEventListener('book-data-changed', handler)
    return () => window.removeEventListener('book-data-changed', handler)
  }, [])

  // ── 搜索过滤 ──
  const filtered = useMemo(() => books.filter(b => {
    if (!search) return true
    const q = search.toLowerCase()
    return (b.name_zh || '').toLowerCase().includes(q)
      || (b.name_en || '').toLowerCase().includes(q)
      || (b.genre || '').toLowerCase().includes(q)
      || (b.country || '').toLowerCase().includes(q)
      || (b.author || '').toLowerCase().includes(q)
      || (b.description_zh || '').toLowerCase().includes(q)
  }), [books, search])

  // ── 筛选项候选值（多值字段按单项汇总，按出现次数排序）──
  const multiFilterOptions = useMemo(() => ({
    genre: collectBookOptions(books, b => splitMulti(b.genre)),
    country: collectBookOptions(books, b => splitMulti(b.country)),
    version: collectBookOptions(books, b => splitMulti(b.version)),
  }), [books])

  // ── 表格列 ──
  const columns = useMemo(() => [
    { key: 'image', label: '', width: '60px', render: row => <BookThumb book={row} /> },
    { key: 'id', label: 'ID', width: '66px',
      render: row => <span className="text-xs text-surface-400 font-mono">{row.id}</span>,
      filterType: 'text' },
    { key: 'rarity', label: '稀有度', width: '76px',
      render: row => <span className={RARITY_COLOR[row.rarity] || 'text-surface-400'}>{rarityStars(row.rarity, 5)}</span>,
      filterType: 'select', filterOptions: [0, 2, 3, 4].map(v => ({ value: v, label: v ? '★'.repeat(v) : '无' })) },
    { key: 'name_zh', label: '书名',
      render: row => (
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-medium text-white hover:text-primary-400 cursor-pointer transition-colors truncate"
            onClick={() => navigateToDetail(row.id)}>{row.name_zh}</span>
          {row.illustrated ? <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary-500/12 text-primary-300 border border-primary-500/25 flex-shrink-0">图鉴</span> : null}
        </div>
      ),
      filterType: 'text' },
    { key: 'genre', label: '体裁', width: '120px',
      render: row => <span className="text-xs text-surface-400 truncate">{row.genre || '-'}</span>,
      filterType: 'select',
      filterOptions: () => multiFilterOptions.genre,
      filterMatch: (raw, val) => splitMulti(raw).includes(val) },
    { key: 'country', label: '国家', width: '110px',
      render: row => <span className="text-xs text-surface-400 truncate">{row.country || '-'}</span>,
      filterType: 'select',
      filterOptions: () => multiFilterOptions.country,
      filterMatch: (raw, val) => splitMulti(raw).includes(val) },
    { key: 'version', label: '实装版本', width: '104px',
      render: row => <span className="text-xs text-surface-400 font-mono">{row.version || '-'}</span>,
      filterType: 'select',
      filterOptions: () => [...multiFilterOptions.version].sort((a, b) => versionSortKey(b.value) - versionSortKey(a.value)),
      filterMatch: (raw, val) => splitMulti(raw).includes(val) },
    { key: 'volume_count', label: '卷', width: '58px',
      render: row => <span className="text-xs text-surface-400">{row.volume_count || 1}</span> },
    { key: 'body_count', label: '正文', width: '70px',
      render: row => (row.body_count > 0
        ? <span className={`text-xs ${row.body_count >= row.volume_count ? 'text-emerald-300' : 'text-amber-300'}`}>{row.body_count}/{row.volume_count}</span>
        : <span className="text-xs text-surface-600">—</span>) },
    { key: 'author', label: '作者', width: '130px',
      render: row => <span className="text-xs text-surface-400 truncate">{row.author || '-'}</span>,
      filterType: 'text' },
    { key: 'source', label: '获取方式',
      render: row => <span className="text-xs text-surface-500 max-w-xs line-clamp-2"><ColoredText text={row.source || '-'} /></span>,
      filterType: 'text' },
  ], [navigateToDetail, multiFilterOptions])

  const {
    sortKeys, setSortKeys, handleSort, removeSort, clearSorts, reorderSorts,
    filters, setFilter, clearFilters,
    showFilters, setShowFilters, filterableCols, filterOptions,
    processed, activeFilterCount,
  } = useSortFilter(
    filtered, columns,
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
    setForm({ id: 0, rarity: 3, illustrated: 0, sort_order: 0 })
    setModalOpen(true)
  }
  function openEdit(row) {
    setEditing(row)
    setForm({ ...row })
    setModalOpen(true)
  }

  async function handleSave() {
    const keys = ['name_zh', 'name_en', 'genre', 'country', 'version', 'rarity', 'description_zh',
      'author', 'source', 'source_type', 'image', 'illustrated', 'related_chars', 'sort_order']
    if (editing) {
      await query(`UPDATE books SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`,
        [...keys.map(k => form[k] ?? null), editing.id])
    } else {
      const newId = Number(form.id)
      if (!newId) { alert('请填写 ID'); return }
      const dup = await query('SELECT COUNT(*) AS cnt FROM books WHERE id = ?', [newId])
      if (dup.data?.[0]?.cnt > 0) { alert(`ID ${newId} 已存在，请使用其他 ID`); return }
      await query(
        `INSERT INTO books (${['id', ...keys].join(', ')}) VALUES (${['id', ...keys].map(() => '?').join(', ')})`,
        [newId, ...keys.map(k => form[k] ?? null)]
      )
    }
    setModalOpen(false)
    await reload()
  }

  async function handleDelete(row) {
    if (!confirm(`确定删除书籍「${row.name_zh}」？其全部卷与正文会一并删除。`)) return
    await query('DELETE FROM book_volumes WHERE book_id = ?', [row.id])
    await query('DELETE FROM books WHERE id = ?', [row.id])
    await reload()
  }

  async function handleBulkDelete() {
    if (selected.size === 0) return
    if (!confirm(`确定删除选中的 ${selected.size} 本书籍？此操作不可撤销。`)) return
    const ids = [...selected]
    const ph = ids.map(() => '?').join(',')
    await query(`DELETE FROM book_volumes WHERE book_id IN (${ph})`, ids)
    await query(`DELETE FROM books WHERE id IN (${ph})`, ids)
    exitSelectMode()
    await reload()
  }

  const selectedCount = selected.size
  const allSelected = processed.length > 0 && processed.every(r => selected.has(r.id))
  const totalVolumes = books.reduce((s, b) => s + (b.volume_count || 0), 0)

  return (
    <div className={`p-6 ${restoring ? 'opacity-0' : 'opacity-100'} transition-opacity duration-100`}>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight flex items-center gap-2">
            <BookMarked className="w-4 h-4 text-primary-400" />书籍
          </h1>
          <p className="text-xs text-surface-500 mt-0.5">
            {processed.length} 条记录
            {totalVolumes > 0 && ` · 共 ${totalVolumes} 卷`}
            {books.some(b => b.illustrated) && ` · ${books.filter(b => b.illustrated).length} 本收录图鉴`}
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

          <SearchBar value={search} onChange={setSearch} placeholder="搜索书籍..." />

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
            title="开启后可勾选多个条目，交给开发者工具栏的书籍爬虫批量爬取">
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
          onRowContextMenu={handleCardContextMenu} itemIdKey="id"
        />
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 2xl:grid-cols-12 gap-2">
          {processed.map(b => (
            <BookGalleryCard
              key={b.id}
              book={b}
              selectMode={selectMode}
              checked={selected.has(b.id)}
              onToggleSelect={toggleSelect}
              onNavigate={navigateToDetail}
              onRead={openReader}
              onContextMenu={handleCardContextMenu}
            />
          ))}
          {processed.length === 0 && (
            <div className="col-span-full py-16 text-center text-surface-500 text-sm">
              {books.length === 0
                ? '暂无书籍数据，可在开发者工具栏点「书籍爬虫 → 查漏补缺」从 wiki 拉取全部书籍'
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
            爬取请用底部「书籍爬虫」
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
        title={editing ? `编辑书籍 - ${editing.name_zh}` : '添加书籍'}>
        <div className="grid grid-cols-2 gap-x-6">
          <FormInput label="ID" value={form.id ?? 0} onChange={v => setForm({ ...form, id: v === '' ? 0 : Number(v) })} />
          <FormInput label="书名" value={form.name_zh} onChange={v => setForm({ ...form, name_zh: v })} />
          <FormInput label="英文名" value={form.name_en} onChange={v => setForm({ ...form, name_en: v })} />
          <FormInput label="稀有度 (0-4)" value={form.rarity} onChange={v => setForm({ ...form, rarity: Number(v) })} type="number" />
          <FormSelect label="体裁" value={form.genre} onChange={v => setForm({ ...form, genre: v })}
            options={[{ value: '', label: '未分类' }, ...BOOK_GENRES.map(g => ({ value: g, label: g }))]} />
          <FormSelect label="国家" value={form.country} onChange={v => setForm({ ...form, country: v })}
            options={[{ value: '', label: '未分类' }, ...BOOK_COUNTRIES.map(c => ({ value: c, label: c }))]} />
          <FormInput label="实装版本" value={form.version} onChange={v => setForm({ ...form, version: v })} />
          <FormSelect label="获取方式分类" value={form.source_type} onChange={v => setForm({ ...form, source_type: v })}
            options={[{ value: '', label: '未分类' }, ...BOOK_SOURCE_TYPES.map(t => ({ value: t, label: t }))]} />
          <FormInput label="作者" value={form.author} onChange={v => setForm({ ...form, author: v })} />
          <FormInput label="相关角色" value={form.related_chars} onChange={v => setForm({ ...form, related_chars: v })} />
          <FormSelect label="收录图鉴" value={form.illustrated ? '1' : '0'}
            onChange={v => setForm({ ...form, illustrated: Number(v) })}
            options={[{ value: '0', label: '否' }, { value: '1', label: '是' }]} />
        </div>
        <FormInput label="描述" value={form.description_zh} onChange={v => setForm({ ...form, description_zh: v })} multiline />
        <FormInput label="获取方式" value={form.source} onChange={v => setForm({ ...form, source: v })} multiline />
        <ImagePicker label="封面图片" currentImage={form.image} onSelect={v => setForm({ ...form, image: v })} onRemove={() => setForm({ ...form, image: null })} />
      </EditModal>

      {/* 右键菜单 */}
      {contextMenu && (
        <div className="fixed z-[300] w-44 py-1 rounded-xl bg-surface-900/95 backdrop-blur-xl border border-white/10 shadow-2xl animate-scale-in"
          style={{ left: Math.min(contextMenu.x, window.innerWidth - 190), top: Math.min(contextMenu.y, window.innerHeight - 180) }}
          onClick={e => e.stopPropagation()}>
          <MenuItem onClick={() => { openReader(contextMenu.book.id); setContextMenu(null) }} icon={<BookOpen className="w-3 h-3" />}>
            {quickReadLoading === contextMenu.book.id ? '正在打开…' : '开始阅读'}
          </MenuItem>
          <MenuItem onClick={() => { navigateToDetail(contextMenu.book.id); setContextMenu(null) }} icon={<BookMarked className="w-3 h-3" />}>
            查看详情
          </MenuItem>
          <MenuItem onClick={() => { openEdit(contextMenu.book); setContextMenu(null) }} icon={<Library className="w-3 h-3" />}>
            编辑
          </MenuItem>
          <MenuItem danger onClick={() => { handleDelete(contextMenu.book); setContextMenu(null) }} icon={<Trash2 className="w-3 h-3" />}>
            删除
          </MenuItem>
        </div>
      )}
      {contextMenu && <div className="fixed inset-0 z-[299]" onClick={() => setContextMenu(null)} onContextMenu={e => { e.preventDefault(); setContextMenu(null) }} />}

      {/* 快捷阅读：列表页就地打开，不经过详情页 */}
      {quickRead && (
        <Reader
          chapters={quickRead.chapters}
          title={quickRead.book.name_zh}
          subtitle={`${splitMulti(quickRead.book.genre)[0] || '书籍'} · 共 ${quickRead.chapters.length} 卷`}
          progressKey={`book_${quickRead.book.id}`}
          emptyText="本卷暂无正文（两站均未收录，可在详情页手动补录）"
          icon={<BookOpen className="w-4 h-4 text-primary-400 flex-shrink-0" />}
          onClose={() => setQuickRead(null)}
        />
      )}

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

export function GenreBadge({ genre }) {
  const list = splitMulti(genre)
  if (list.length === 0) return null
  return (
    <span className="flex items-center gap-1 flex-wrap">
      {list.map(g => (
        <span key={g} className={`inline-block text-[10px] px-2 py-0.5 rounded-full border ${genreStyle(g)}`}>{g}</span>
      ))}
    </span>
  )
}

export function CountryBadge({ country }) {
  const list = splitMulti(country)
  if (list.length === 0) return null
  return (
    <span className="flex items-center gap-1 flex-wrap">
      {list.map(c => (
        <span key={c} className={`inline-block text-[10px] px-2 py-0.5 rounded-full border ${countryStyle(c)}`}>{c}</span>
      ))}
    </span>
  )
}

function BookThumb({ book }) {
  const { ref, src } = useLazyImage(book.image, 256)
  const bgStyle = RARITY_BG_STYLES[book.rarity || 0]
  return (
    <div ref={ref} className="w-10 h-10 rounded-lg overflow-hidden shrink-0 flex items-center justify-center" style={bgStyle}>
      {src ? <img src={src} alt="" className="w-8 h-8 object-contain drop-shadow-md" />
        : <BookMarked className="w-5 h-5 text-surface-500" />}
    </div>
  )
}

function BookGalleryImage({ filename }) {
  const { ref, src } = useLazyImage(filename, 256)
  // 必须用绝对定位给出确定的宽高：按百分比撑高的容器在 aspect-square 父级里
  // 会算成 0×0，而 useLazyImage 明确跳过 0×0 元素（图片永远不会加载）。
  return (
    <div ref={ref} className="absolute inset-2 flex items-center justify-center">
      {src ? <img src={src} alt="" className="w-full h-full object-contain drop-shadow-md" /> : null}
    </div>
  )
}

export const BookGalleryCard = memo(function BookGalleryCard({
  book, selectMode, checked, onToggleSelect, onNavigate, onRead, onContextMenu,
}) {
  const bgStyle = RARITY_BG_STYLES[book.rarity || 0]
  const volumes = book.volume_count || 1
  const genres = splitMulti(book.genre)
  const missingBody = (book.body_count || 0) === 0 && volumes > 0

  function handleClick(e) {
    if (selectMode) onToggleSelect(book.id)
    else if (e.altKey) onRead(book.id)     // Alt+点击 = 直接开始阅读（就地弹阅读器）
    else onNavigate(book.id)
  }

  return (
    <div
      data-item-id={book.id}
      onClick={handleClick}
      onContextMenu={(e) => onContextMenu(e, book)}
      className={`group relative rounded-xl overflow-hidden border bg-surface-800/50 transition-all duration-200 cursor-pointer
        ${checked ? 'border-primary-500 ring-2 ring-primary-500/40' : 'border-surface-700/50 hover:border-primary-500/50 hover:scale-[1.03]'}`}
      style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 140px' }}
      title={`${book.name_zh}${genres.length ? `（${genres.join('、')}）` : ''}${volumes > 1 ? ` · ${volumes} 卷` : ''}\nAlt+点击直接阅读`}
    >
      <div className="aspect-square relative flex items-center justify-center p-2" style={bgStyle}>
        {book.image
          ? <BookGalleryImage filename={book.image} />
          : <ImageOff className="w-6 h-6 text-surface-500" />}

        {/* 卷数角标 */}
        {volumes > 1 && (
          <div className="absolute top-1 right-1 px-1.5 py-0.5 rounded-full bg-black/55 backdrop-blur-sm border border-white/10 text-[9px] text-white/80">
            {volumes} 卷
          </div>
        )}

        {/* 图鉴收录标识 */}
        {book.illustrated ? (
          <span className="absolute top-1 left-1 w-2 h-2 rounded-full bg-primary-400/90 shadow" title="收录进游戏内图鉴" />
        ) : null}

        {/* 正文缺口提示 */}
        {missingBody && (
          <span className="absolute bottom-1 left-1 w-2 h-2 rounded-full bg-amber-400/90 shadow" title="尚无正文，可右键爬取补齐" />
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
        <p className="text-[11px] font-semibold text-white truncate leading-tight">{book.name_zh}</p>
        <div className="flex items-center justify-between mt-0.5 gap-1">
          <span className={`text-[9px] ${RARITY_COLOR[book.rarity] || 'text-surface-400'}`}>{rarityStars(book.rarity, 5)}</span>
          <span className="text-[9px] text-surface-500 truncate">{genres[0] || book.country || ''}</span>
        </div>
      </div>
    </div>
  )
})

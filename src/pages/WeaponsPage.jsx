import { useState, useEffect, useRef, memo, useMemo, useCallback } from 'react'
import { useDb } from '../context/DbContext'
import { useNav } from '../context/NavContext'
import { loadPageStateSync } from '../utils/pageStateStore'
import { useScrollMemory } from '../hooks/useScrollMemory'
import { getScroller } from '../utils/scrollMemory.mjs'
import { useLazyImage, bumpLazyRevision } from '../hooks/useLazyImage'
import DataTable, { useSortFilter, FilterBar, SortBar } from '../components/DataTable'
import SearchBar from '../components/SearchBar'
import EditModal, { FormInput, FormSelect, ImagePicker } from '../components/EditModal'
import ColoredText from '../components/ColoredText'
import { LayoutList, LayoutGrid, Plus, Sword, Filter, ArrowUpDown, Shield } from 'lucide-react'

// 星级背景图片 URL（只计算一次）
const RARITY_BG_URLS = {
  1: './background/1star.webp',
  2: './background/2star.webp',
  3: './background/3star.webp',
  4: './background/4star.webp',
  5: './background/5star.webp',
}
const RARITY_BG_STYLES = Object.fromEntries(
  Object.entries(RARITY_BG_URLS).map(([r, url]) => [r, { backgroundImage: `url(${url})`, backgroundSize: 'cover', backgroundPosition: 'center' }])
)

// 模块加载时预缓存星级背景图
Object.values(RARITY_BG_URLS).forEach(url => { const img = new Image(); img.src = url })

const RARITY_STARS = { 1: '★', 2: '★★', 3: '★★★', 4: '★★★★', 5: '★★★★★' }
const RARITY_COLOR = { 1: 'text-gray-300', 2: 'text-green-400', 3: 'text-blue-400', 4: 'text-purple-400', 5: 'text-accent-gold' }
const RARITY_GRADIENT = {
  3: 'from-blue-500/15 via-blue-500/5 to-transparent',
  4: 'from-purple-500/15 via-purple-500/5 to-transparent',
  5: 'from-amber-400/30 via-amber-400/10 to-transparent',
}
const CATEGORY_OPTIONS = [
  { value: '武器', label: '武器' },
  { value: '武器装扮', label: '武器装扮' },
  { value: 'TPS', label: 'TPS' },
]

const RARITY_BORDER = {
  3: 'border-blue-500/20',
  4: 'border-purple-500/20',
  5: 'border-amber-400/30',
}

// 模块级数据缓存 — 返回列表时命中缓存避免重新查询 SQLite，增删改时失效
let _cachedWeapons = null
function _invalidateWeaponsCache() { _cachedWeapons = null }

export default function WeaponsPage() {
  const { query } = useDb()
  const { push } = useNav()
  const [weapons, setWeapons] = useState([])
  const [weaponTypes, setWeaponTypes] = useState([])

  // ── 同步初始化：仅 viewMode 从缓存恢复 ──
  const initViewMode = loadPageStateSync('weapons')?.state?.viewMode
  const [search, setSearch] = useState('')
  const [viewMode, setViewMode] = useState(() => {
    if (initViewMode) return initViewMode
    try {
      const defs = JSON.parse(localStorage.getItem('default_view_mode') || '{}')
      if (defs.weapons) return defs.weapons
    } catch (_) {}
    return 'gallery'
  })
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({})
  const [selected, setSelected] = useState(new Set())
  const [saving, setSaving] = useState(false)
  const [contextMenu, setContextMenu] = useState(null)

  // ── 滚动位置记忆 ──
  // 状态字段随滚动一起落盘；返回列表时按「内容锚点」精确还原（见 utils/scrollMemory.mjs）。
  // stateRef 的实际内容在 useSortFilter 之后填充（排序/筛选状态那时才存在）。
  const stateRef = useRef({})
  const { restoring, readSaved, restore, saveNow, shouldRestore } = useScrollMemory('weapons', {
    getState: () => stateRef.current,
  })
  // ── 挂载：返回则恢复（状态 + 滚动位置），从侧栏进入则置顶 ──
  useEffect(() => {
    if (!shouldRestore()) {
      const main = getScroller()
      if (main) main.scrollTop = 0
      try {
        const defs = JSON.parse(localStorage.getItem('default_view_mode') || '{}')
        if (defs.weapons) setViewMode(defs.weapons)
      } catch (_) {}
      loadData()
      return undefined
    }
    let cancelled = false
    ;(async () => {
      // 从详情页返回，模块缓存可能已过期，强制刷新
      _invalidateWeaponsCache()
      const saved = readSaved()
      const st = saved && saved.state
      if (st) {
        if (st.viewMode) setViewMode(st.viewMode)
        if (st.search) setSearch(st.search)
        if (st.sortKeys?.length) setSortKeys(st.sortKeys)
        if (st.filters) Object.entries(st.filters).forEach(([k, v]) => setFilter(k, v))
      }
      await loadData()
      if (cancelled) return
      // 等筛选/排序落地后再校正滚动位置（锚点会被逐帧校正到收敛为止）
      await restore(saved && saved.snapshot)
    })()
    return () => { cancelled = true }
  }, [])

  async function loadData() {
    if (_cachedWeapons) { const [wps, wtypes] = _cachedWeapons; setWeapons(wps); setWeaponTypes(wtypes); return }
    const [wps, wtypes] = await Promise.all([
      query('SELECT * FROM weapons ORDER BY id'),
      query('SELECT * FROM weapon_types'),
    ])
    _cachedWeapons = [wps.data || [], wtypes.data || []]
    setWeapons(wps.data || [])
    setWeaponTypes(wtypes.data || [])
  }

  // 同步选中武器到 DevToolbar
  useEffect(() => {
    const selectedData = weapons.filter(w => selected.has(w.id))
    window.dispatchEvent(new CustomEvent('devtoolbar-weapon-selection', { detail: selectedData }))
  }, [selected, weapons])

  // push 的引用会随 location 变化，作为 useCallback 依赖会让卡片 memo 失效；
  // 用 ref 保存最新实现，保证 navigateToDetail 引用长期稳定。
  const pushRef = useRef(push)
  pushRef.current = push

  const navigateToDetail = useCallback((id) => {
    saveNow()
    pushRef.current(`/weapons/${id}`)
  }, [saveNow])
  // 稳定引用：卡片带 memo，每次渲染新建箭头函数会让 memo 完全失效
  const handleCardContextMenu = useCallback((e, weapon) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, weapon })
  }, [])
  const handleRowContextMenu = useCallback((e, row) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, weapon: row })
  }, [])

  function openAdd() { setEditing(null); setForm({ id: 0, rarity: 4, base_atk: 42, category: '武器', sort_order: 0 }); setModalOpen(true) }
  function openEdit(row) { setEditing(row); setForm({ ...row }); setModalOpen(true) }

  function toggleSelect(id) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  function toggleSelectAll() {
    const ids = processed.map(r => r.id)
    if (ids.every(id => selected.has(id))) setSelected(new Set())
    else setSelected(new Set(ids))
  }

  async function handleSave() {
    if (saving) return
    setSaving(true)
    try {
      if (editing) {
        const newId = Number(form.id)
        const oldId = editing.id
        if (newId !== oldId) {
          const dup = await query('SELECT COUNT(*) as cnt FROM weapons WHERE id = ?', [newId])
          if (dup.data?.[0]?.cnt > 0) { alert(`ID ${newId} 已存在，请使用其他 ID`); setSaving(false); return }
          await query('PRAGMA foreign_keys = OFF')
          try {
            await query('UPDATE weapon_ascension_materials SET weapon_id = ? WHERE weapon_id = ?', [newId, oldId])
            await query('UPDATE wish_rate_ups SET item_id = ? WHERE item_id = ? AND item_type = ?', [newId, oldId, 'weapon'])
            await query('UPDATE wish_banner_items SET item_id = ? WHERE item_id = ? AND item_type = ?', [newId, oldId, 'weapon'])
          } finally {
            await query('PRAGMA foreign_keys = ON')
          }
        }
        const keys = Object.keys(form)
        const sets = keys.map(k => `${k} = ?`).join(', ')
        await query(`UPDATE weapons SET ${sets} WHERE id = ?`, [...keys.map(k => form[k]), oldId])
      } else {
        const newId = Number(form.id)
        const dup = await query('SELECT COUNT(*) as cnt FROM weapons WHERE id = ?', [newId])
        if (dup.data?.[0]?.cnt > 0) { alert(`ID ${newId} 已存在，请使用其他 ID`); setSaving(false); return }
        const keys = Object.keys(form)
        await query(`INSERT INTO weapons (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`, keys.map(k => form[k]))
      }
      setModalOpen(false); _invalidateWeaponsCache(); loadData()
    } catch (e) {
      console.error('Save failed:', e)
      alert('保存失败: ' + (e.message || '未知错误'))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(row) {
    if (!confirm(`确定删除武器「${row.name_zh}」？`)) return
    await query('DELETE FROM weapons WHERE id = ?', [row.id])
    _invalidateWeaponsCache(); loadData()
  }

  // Search bar filter (applied before column filters)
  // 记忆化：避免每次渲染生成新数组导致 processed 重算 + 全量卡片重渲染
  const searched = useMemo(() => weapons.filter(w =>
    !search || w.name_zh.includes(search) || (w.name_en || '').toLowerCase().includes(search.toLowerCase())
  ), [weapons, search])

  // 表格列定义 — useMemo 固定引用（依赖 weaponTypes），避免每次渲染全量重排
  const columns = useMemo(() => [
    { key: 'image', label: '', width: '60px', minWidth: '60px', render: row => <WeaponThumb filename={row.simple_art || row.image} rarity={row.rarity} /> },
    { key: 'id', label: 'ID', width: '50px',
      render: row => <span className="text-surface-500 font-mono text-xs">{row.id}</span> },
    { key: 'rarity', label: '稀有度', width: '90px',
      render: row => <span className={`${RARITY_COLOR[row.rarity] || 'text-surface-400'} font-medium`}>{RARITY_STARS[row.rarity]}</span>,
      filterType: 'select', filterOptions: [3, 4, 5], filterLabel: v => RARITY_STARS[v] },
    { key: 'name_zh', label: '名称', width: '180px',
      render: row => <span className="font-medium text-white hover:text-primary-400 cursor-pointer transition-colors truncate block" onClick={e => { e.stopPropagation(); navigateToDetail(row.id) }}>{row.name_zh}</span>,
      filterType: 'text' },
    { key: 'category', label: '分类', width: '80px',
      render: row => {
        const catColors = { '武器': 'text-cyan-400', '武器装扮': 'text-pink-400', 'TPS': 'text-amber-400' }
        return <span className={`text-xs ${catColors[row.category] || 'text-surface-400'}`}>{row.category || '武器'}</span>
      },
      filterType: 'select', filterOptions: CATEGORY_OPTIONS,
      filterValue: v => v },
    { key: 'weapon_type_id', label: '类型', width: '90px',
      render: row => <span className="text-surface-300 text-xs">{weaponTypes.find(w => w.id === row.weapon_type_id)?.name_zh || '-'}</span>,
      filterType: 'select', filterValue: v => weaponTypes.find(w => w.id === v)?.name_zh || v,
      filterOptions: () => weaponTypes.map(w => ({ value: w.id, label: w.name_zh })) },
    { key: 'base_atk', label: '基础攻击', width: '90px',
      render: row => <span className="text-surface-300 text-sm">{row.base_atk}{row.max_base_atk ? ` → ${row.max_base_atk}` : ''}</span>,
      filterType: 'text' },
    { key: 'secondary_stat', label: '副属性', width: '160px',
      render: row => row.secondary_stat ? (
        <span className="text-surface-300 text-xs">{row.secondary_stat} {row.secondary_stat_value}{row.max_secondary_stat_value ? `→${row.max_secondary_stat_value}` : ''}</span>
      ) : <span className="text-surface-600">-</span>, filterType: 'text' },
    { key: 'passive_name_zh', label: '特效',
      render: row => row.passive_name_zh ? (
        <div className="min-w-0"><p className="text-xs text-primary-300 font-medium truncate">{row.passive_name_zh}</p>
          {row.passive_description_zh && <p className="text-xs text-surface-500 truncate mt-0.5"><ColoredText text={row.passive_description_zh} /></p>}</div>
      ) : <span className="text-surface-600">-</span> },
  ], [weaponTypes])

  // Shared sort/filter state for both table and gallery
  const {
    sortKeys, setSortKeys, handleSort, removeSort, clearSorts, reorderSorts,
    filters, setFilter, clearFilters,
    showFilters, setShowFilters, filterableCols, filterOptions,
    processed, activeFilterCount,
  } = useSortFilter(searched, columns)

  // 排序/筛选状态在 useSortFilter 之后才存在，这里只放引用，赋值见下方
  stateRef.current = { viewMode, search, sortKeys, filters }

  // 排序/筛选变化时通知懒加载图片重新检查视口
  // 排序/筛选变化时通知懒加载图片重新检查视口（挂载时跳过，见 useLazyImage 注释）
  const lazySyncDone = useRef(false)
  useEffect(() => {
    if (!lazySyncDone.current) { lazySyncDone.current = true; return }
    bumpLazyRevision()
  }, [sortKeys, filters])

  return (
    <div className={`p-6 ${restoring ? 'opacity-0' : 'opacity-100'} transition-opacity duration-100`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">武器</h1>
          <p className="text-xs text-surface-500 mt-0.5">{processed.length} 条记录</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-lg bg-surface-800 border border-surface-700 p-0.5">
            <button onClick={() => setViewMode('table')} className={`p-1.5 rounded-md transition-colors ${viewMode === 'table' ? 'bg-surface-700 text-white' : 'text-surface-400 hover:text-surface-200'}`} title="列表视图"><LayoutList className="w-3.5 h-3.5" /></button>
            <button onClick={() => setViewMode('gallery')} className={`p-1.5 rounded-md transition-colors ${viewMode === 'gallery' ? 'bg-surface-700 text-white' : 'text-surface-400 hover:text-surface-200'}`} title="画廊视图"><LayoutGrid className="w-3.5 h-3.5" /></button>
            <button onClick={() => setViewMode('equipment')} className={`p-1.5 rounded-md transition-colors ${viewMode === 'equipment' ? 'bg-surface-700 text-white' : 'text-surface-400 hover:text-surface-200'}`} title="装备视图"><Shield className="w-3.5 h-3.5" /></button>
          </div>
          <SearchBar value={search} onChange={setSearch} placeholder="搜索武器名称..." />
          {/* 筛选按钮 */}
          <button
            onClick={() => {
              if (sortKeys.length === 0) setSortKeys([{ key: 'id', dir: 'desc' }])
              else setSortKeys(prev => prev.map(s => ({ ...s, dir: s.dir === 'asc' ? 'desc' : 'asc' })))
            }}
            className="flex items-center gap-1 px-2.5 py-2 rounded-lg text-xs flex-shrink-0 text-surface-400"
            title="颠倒排序"
          >
            <ArrowUpDown className="w-3.5 h-3.5" />
          </button>
          {/* Filter toggle button */}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-1 px-2.5 py-2 rounded-lg text-xs transition-colors flex-shrink-0
              ${showFilters || activeFilterCount > 0
                ? 'bg-primary-500/10 text-primary-400 border border-primary-500/20'
                : 'text-surface-400 hover:text-surface-200 hover:bg-surface-800 border border-transparent'
              }`}
          >
            <Filter className="w-3.5 h-3.5" />
            筛选
            {activeFilterCount > 0 && (
              <span className="w-4 h-4 rounded-full bg-primary-500 text-[10px] font-bold text-white flex items-center justify-center">
                {activeFilterCount}
              </span>
            )}
          </button>
          <button onClick={openAdd} className="flex items-center gap-1.5 px-3 py-2 bg-primary-600 hover:bg-primary-500 rounded-lg text-xs font-medium text-white transition-colors"><Plus className="w-3.5 h-3.5" />添加</button>
        </div>
      </div>

      {/* Filter bar */}
      {showFilters && filterableCols.length > 0 && (
        <FilterBar {...{ filterableCols, filters, setFilter, clearFilters, filterOptions, activeFilterCount }} />
      )}

      {/* Sort bar */}
      <SortBar sortKeys={sortKeys} columns={columns}
        onToggleSort={handleSort} onRemoveSort={removeSort} onClearSorts={clearSorts} onReorderSorts={reorderSorts} />

      {/* Content */}
      {viewMode === 'table' ? (
        <DataTable title="" columns={columns} data={searched}
          sortKeys={sortKeys} handleSort={handleSort} removeSort={removeSort} clearSorts={clearSorts} reorderSorts={reorderSorts}
          filters={filters} setFilter={setFilter} clearFilters={clearFilters}
          showFilters={false} filterableCols={filterableCols} filterOptions={filterOptions}
          processed={processed} activeFilterCount={activeFilterCount}
          onEdit={null} onDelete={null} onAdd={null} searchBar={null}
          selectable selectedIds={selected} onToggleSelect={toggleSelect} onToggleSelectAll={toggleSelectAll}
          onRowClick={row => navigateToDetail(row.id)} onRowContextMenu={handleRowContextMenu} itemIdKey="id" />
      ) : viewMode === 'equipment' ? (
        <div className="grid grid-cols-5 sm:grid-cols-7 md:grid-cols-9 lg:grid-cols-11 xl:grid-cols-13 2xl:grid-cols-16 gap-1">
          {processed.map(w => (
            <WeaponEquipCard
              key={w.id}
              weapon={w}
              weaponTypes={weaponTypes}
              rarityStars={RARITY_STARS}
              rarityColor={RARITY_COLOR}
              bgStyle={RARITY_BG_STYLES[w.rarity || 5]}
              onNavigate={navigateToDetail}
              onContextMenu={handleCardContextMenu}
            />
          ))}
          {processed.length === 0 && (
            <div className="col-span-full py-16 text-center text-surface-500 text-sm">
              {weapons.length === 0 ? '暂无武器数据' : '没有匹配筛选条件的结果'}
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-10 gap-2">
          {processed.map(w => (
            <WeaponGalleryCard
              key={w.id}
              weapon={w}
              weaponTypes={weaponTypes}
              gradient={RARITY_GRADIENT[w.rarity] || ''}
              borderCls={RARITY_BORDER[w.rarity] || 'border-surface-700'}
              rarityStars={RARITY_STARS}
              rarityColor={RARITY_COLOR}
              bgStyle={RARITY_BG_STYLES[w.rarity || 5]}
              onNavigate={navigateToDetail}
              onContextMenu={handleCardContextMenu}
            />
          ))}
          {processed.length === 0 && (
            <div className="col-span-full py-16 text-center text-surface-500 text-sm">
              {weapons.length === 0 ? '暂无武器数据' : '没有匹配筛选条件的结果'}
            </div>
          )}
        </div>
      )}

      <EditModal isOpen={modalOpen} onClose={() => setModalOpen(false)} onSave={handleSave} saving={saving} title={editing ? `编辑武器 - ${editing.name_zh}` : '添加武器'}>
        <div className="grid grid-cols-2 gap-x-6">
          <FormInput label="ID" value={form.id ?? 0} onChange={v => setForm({ ...form, id: v === '' ? 0 : Number(v) })} type="number" />
          <FormInput label="中文名" value={form.name_zh} onChange={v => setForm({ ...form, name_zh: v })} />
          <FormInput label="英文名" value={form.name_en} onChange={v => setForm({ ...form, name_en: v })} />
          <FormInput label="稀有度 (1-5)" value={form.rarity} onChange={v => setForm({ ...form, rarity: Number(v) })} type="number" />
          <FormSelect label="武器类型" value={form.weapon_type_id} onChange={v => setForm({ ...form, weapon_type_id: Number(v) })} options={weaponTypes.map(w => ({ value: w.id, label: w.name_zh }))} />
          <FormSelect label="分类" value={form.category || '武器'} onChange={v => setForm({ ...form, category: v })} options={CATEGORY_OPTIONS} />
          <FormInput label="基础攻击力 (Lv1)" value={form.base_atk} onChange={v => setForm({ ...form, base_atk: Number(v) })} type="number" />
          <FormInput label="最大基础攻击力 (Lv90)" value={form.max_base_atk} onChange={v => setForm({ ...form, max_base_atk: v ? Number(v) : null })} type="number" />
          <FormInput label="副属性名称" value={form.secondary_stat} onChange={v => setForm({ ...form, secondary_stat: v })} />
          <FormInput label="副属性值 (Lv1)" value={form.secondary_stat_value} onChange={v => setForm({ ...form, secondary_stat_value: v })} placeholder="例: 14.4%" />
          <FormInput label="满级副属性值" value={form.max_secondary_stat_value} onChange={v => setForm({ ...form, max_secondary_stat_value: v })} placeholder="例: 66.2%" />
        </div>
        <FormInput label="被动/特效名" value={form.passive_name_zh} onChange={v => setForm({ ...form, passive_name_zh: v })} />
        <FormInput label="被动描述" value={form.passive_description_zh} onChange={v => setForm({ ...form, passive_description_zh: v })} multiline />
        <FormInput label="简介" value={form.description_zh} onChange={v => setForm({ ...form, description_zh: v })} multiline />
        <FormInput label="背景故事" value={form.story_zh} onChange={v => setForm({ ...form, story_zh: v })} multiline />
        <div className="grid grid-cols-2 gap-x-6">
          <ImagePicker label="武器图片" currentImage={form.image} onSelect={v => setForm({ ...form, image: v })} onRemove={() => setForm({ ...form, image: null })} />
          <ImagePicker label="装备图" currentImage={form.simple_art} onSelect={v => setForm({ ...form, simple_art: v })} onRemove={() => setForm({ ...form, simple_art: null })} />
        </div>
      </EditModal>

      {/* 右键菜单 */}
      {contextMenu && (
        <div className="fixed z-[300] w-40 py-1 rounded-xl bg-surface-900/95 backdrop-blur-xl border border-white/10 shadow-2xl animate-scale-in"
          style={{ left: Math.min(contextMenu.x, window.innerWidth - 170), top: Math.min(contextMenu.y, window.innerHeight - 100) }}
          onClick={e => e.stopPropagation()}>
          <button onClick={() => { openEdit(contextMenu.weapon); setContextMenu(null) }}
            className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs text-surface-300 hover:bg-white/10 transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
            编辑
          </button>
          <button onClick={() => { if (window.confirm(`确认删除武器「${contextMenu.weapon.name_zh}」？此操作不可撤销。`)) handleDelete(contextMenu.weapon); setContextMenu(null) }}
            className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs text-red-400 hover:bg-red-500/10 transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
            删除
          </button>
        </div>
      )}
      {contextMenu && <div className="fixed inset-0 z-[299]" onClick={() => setContextMenu(null)} />}
    </div>
  )
}

function WeaponThumb({ filename, rarity }) {
  const { ref, src } = useLazyImage(filename, 256)
  const bgStyle = RARITY_BG_STYLES[rarity || 5]
  return (
    <div ref={ref} className="w-10 h-10 rounded-lg overflow-hidden shrink-0 flex items-center justify-center" style={bgStyle}>
      {src ? <img src={src} alt="" className="w-7 h-7 object-contain drop-shadow-md" /> : <Sword className="w-5 h-5 text-surface-500" />}
    </div>
  )
}

function WeaponThumbLarge({ filename, bgStyle }) {
  const { ref, src } = useLazyImage(filename, 300)
  return (
    <div ref={ref} className="w-full h-full flex items-center justify-center">
      {src ? <img src={src} alt="" className="max-w-[85%] max-h-[85%] object-contain drop-shadow-md" /> : null}
    </div>
  )
}

// React.memo 画廊卡片
const WeaponGalleryCard = memo(function WeaponGalleryCard({ weapon, weaponTypes, gradient, borderCls, rarityStars, rarityColor, bgStyle, onNavigate, onContextMenu }) {
  return (
    <div data-item-id={weapon.id} onClick={() => onNavigate(weapon.id)}
      onContextMenu={(e) => onContextMenu(e, weapon)}
      className={`group relative rounded-xl overflow-hidden border ${borderCls} bg-surface-800/50 hover:border-primary-500/50 hover:scale-[1.02] transition-all duration-200 cursor-pointer`}
      style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 250px' }}>
      {gradient && <div className={`absolute inset-0 bg-gradient-to-b ${gradient} pointer-events-none`} />}
      <div className="relative aspect-[3/4] bg-surface-700/50 flex items-center justify-center" style={bgStyle}>
        {weapon.image ? <WeaponThumbLarge filename={weapon.image} bgStyle={bgStyle} /> : <Sword className="w-10 h-10 text-surface-500" />}
      </div>
      <div className="relative p-3">
        <p className="text-xs font-semibold text-white truncate">{weapon.name_zh}</p>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className={`text-[10px] ${rarityColor[weapon.rarity] || 'text-surface-400'}`}>{rarityStars[weapon.rarity]}</span>
          <span className="text-[10px] text-surface-500">{weaponTypes.find(t => t.id === weapon.weapon_type_id)?.name_zh || ''}</span>
          {weapon.category && weapon.category !== '武器' && <span className="text-[10px] text-surface-500">· {weapon.category}</span>}
        </div>
      </div>
    </div>
  )
})

// React.memo 装备视图卡片
const WeaponEquipCard = memo(function WeaponEquipCard({ weapon, weaponTypes, rarityStars, rarityColor, bgStyle, onNavigate, onContextMenu }) {
  return (
    <div data-item-id={weapon.id} onClick={() => onNavigate(weapon.id)}
      onContextMenu={(e) => onContextMenu(e, weapon)}
      className="group relative rounded-lg overflow-hidden border border-surface-700/50 bg-surface-800/50 hover:border-primary-500/50 hover:scale-105 transition-all duration-200 cursor-pointer"
      style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 100px' }}>
      <div className="aspect-square relative flex items-center justify-center p-1.5" style={bgStyle}>
        {(weapon.simple_art || weapon.image)
          ? <WeaponThumbLarge filename={weapon.simple_art || weapon.image} bgStyle={bgStyle} />
          : <Sword className="w-8 h-8 text-surface-500" />}
      </div>
      <div className="px-2 pb-2">
        <p className="text-[10px] font-semibold text-white truncate leading-tight">{weapon.name_zh}</p>
        <div className="flex items-center gap-1 mt-0.5">
          <span className={`text-[9px] ${rarityColor[weapon.rarity] || 'text-surface-400'}`}>{rarityStars[weapon.rarity]}</span>
          <span className="text-[9px] text-surface-500">{weaponTypes.find(t => t.id === weapon.weapon_type_id)?.name_zh || ''}</span>
        </div>
      </div>
    </div>
  )
})

import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { useDb } from '../context/DbContext'
import { useNav } from '../context/NavContext'
import { loadPageStateSync } from '../utils/pageStateStore'
import DataTable, { useSortFilter, FilterBar, SortBar } from '../components/DataTable'
import SearchBar from '../components/SearchBar'
import EditModal, { FormInput, FormSelect, ImagePicker } from '../components/EditModal'
import ColoredText from '../components/ColoredText'
import { LayoutList, LayoutGrid, Plus, Sword, Filter } from 'lucide-react'

const RARITY_STARS = { 1: '★', 2: '★★', 3: '★★★', 4: '★★★★', 5: '★★★★★' }
const RARITY_COLOR = { 1: 'text-gray-300', 2: 'text-green-400', 3: 'text-blue-400', 4: 'text-purple-400', 5: 'text-accent-gold' }
const RARITY_GRADIENT = {
  3: 'from-blue-500/15 via-blue-500/5 to-transparent',
  4: 'from-purple-500/15 via-purple-500/5 to-transparent',
  5: 'from-amber-400/30 via-amber-400/10 to-transparent',
}
const RARITY_BORDER = {
  3: 'border-blue-500/20',
  4: 'border-purple-500/20',
  5: 'border-amber-400/30',
}

export default function WeaponsPage() {
  const { query } = useDb()
  const { restorePage, savePage, push, consumeBackToList } = useNav()
  const [weapons, setWeapons] = useState([])
  const [weaponTypes, setWeaponTypes] = useState([])
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({})
  const [viewMode, setViewMode] = useState(() => {
    const saved = loadPageStateSync('weapons')
    if (saved?.state?.viewMode) return saved.state.viewMode
    try {
      const defs = JSON.parse(localStorage.getItem('default_view_mode') || '{}')
      if (defs.weapons) return defs.weapons
    } catch (_) {}
    return 'table'
  })
  const [selected, setSelected] = useState(new Set())
  const [saving, setSaving] = useState(false)
  const restoringScroll = useRef(false)

  useEffect(() => {
    const isBack = consumeBackToList()
    if (isBack) {
      loadData()
      restorePage('weapons').then(saved => {
        if (saved) {
          if (saved.viewMode) setViewMode(saved.viewMode)
          if (saved.scrollY != null) {
            restoringScroll.current = true
            const targetY = Number(saved.scrollY)
            const tryScroll = (attempt) => {
              const main = document.querySelector('main')
              if (!main) return
              if (main.scrollHeight > targetY) {
                main.scrollTo(0, targetY)
                setTimeout(() => { restoringScroll.current = false }, 300)
                setTimeout(() => {
                  if (main) main.dispatchEvent(new Event('scroll', { bubbles: true }))
                }, 150)
              } else if (attempt > 0) {
                setTimeout(() => tryScroll(attempt - 1), 200)
              }
            }
            setTimeout(() => tryScroll(10), 100)
          }
        }
      })
    } else {
      const main = document.querySelector('main')
      if (main) main.scrollTo(0, 0)
      loadData()
    }
  }, [])

  useLayoutEffect(() => {
    const main = document.querySelector('main')
    if (!main) return
    let timer = null
    const onScroll = () => {
      clearTimeout(timer)
      if (restoringScroll.current) return
      timer = setTimeout(() => savePage('weapons', { viewMode }), 200)
    }
    main.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      main.removeEventListener('scroll', onScroll)
      clearTimeout(timer)
    }
  }, [viewMode, savePage])

  async function loadData() {
    const [wps, wtypes] = await Promise.all([
      query('SELECT * FROM weapons ORDER BY id'),
      query('SELECT * FROM weapon_types'),
    ])
    setWeapons(wps.data || [])
    setWeaponTypes(wtypes.data || [])
  }

  // 同步选中武器到 DevToolbar
  useEffect(() => {
    const selectedData = weapons.filter(w => selected.has(w.id))
    window.dispatchEvent(new CustomEvent('devtoolbar-weapon-selection', { detail: selectedData }))
  }, [selected, weapons])

  function navigateToDetail(id) {
    savePage('weapons', { viewMode })
    push(`/weapons/${id}`)
  }

  function openAdd() { setEditing(null); setForm({ id: 0, rarity: 4, base_atk: 42, sort_order: 0 }); setModalOpen(true) }
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
      setModalOpen(false); loadData()
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
    loadData()
  }

  // Search bar filter (applied before column filters)
  const searched = weapons.filter(w =>
    !search || w.name_zh.includes(search) || (w.name_en || '').toLowerCase().includes(search.toLowerCase())
  )

  const columns = [
    { key: 'image', label: '', width: '60px', minWidth: '60px', render: row => <WeaponThumb filename={row.simple_art || row.image} /> },
    { key: 'id', label: 'ID', width: '50px',
      render: row => <span className="text-surface-500 font-mono text-xs">{row.id}</span> },
    { key: 'rarity', label: '稀有度', width: '90px',
      render: row => <span className={`${RARITY_COLOR[row.rarity] || 'text-surface-400'} font-medium`}>{RARITY_STARS[row.rarity]}</span>,
      filterType: 'select', filterOptions: [3, 4, 5], filterLabel: v => RARITY_STARS[v] },
    { key: 'name_zh', label: '名称', width: '180px',
      render: row => <span className="font-medium text-white hover:text-primary-400 cursor-pointer transition-colors truncate block" onClick={e => { e.stopPropagation(); navigateToDetail(row.id) }}>{row.name_zh}</span>,
      filterType: 'text' },
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
  ]

  // Shared sort/filter state for both table and gallery
  const {
    sortKeys, handleSort, removeSort, clearSorts, reorderSorts,
    filters, setFilter, clearFilters,
    showFilters, setShowFilters, filterableCols, filterOptions,
    processed, activeFilterCount,
  } = useSortFilter(searched, columns)

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">武器</h1>
          <p className="text-xs text-surface-500 mt-0.5">{processed.length} 条记录</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-lg bg-surface-800 border border-surface-700 p-0.5">
            <button onClick={() => setViewMode('table')} className={`p-1.5 rounded-md transition-colors ${viewMode === 'table' ? 'bg-surface-700 text-white' : 'text-surface-400 hover:text-surface-200'}`}><LayoutList className="w-3.5 h-3.5" /></button>
            <button onClick={() => setViewMode('gallery')} className={`p-1.5 rounded-md transition-colors ${viewMode === 'gallery' ? 'bg-surface-700 text-white' : 'text-surface-400 hover:text-surface-200'}`}><LayoutGrid className="w-3.5 h-3.5" /></button>
          </div>
          <SearchBar value={search} onChange={setSearch} placeholder="搜索武器名称..." />
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
          onEdit={openEdit} onDelete={handleDelete} onAdd={null} searchBar={null}
          selectable selectedIds={selected} onToggleSelect={toggleSelect} onToggleSelectAll={toggleSelectAll}
          onRowClick={row => navigateToDetail(row.id)} />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-4">
          {processed.map(w => {
            const gradient = RARITY_GRADIENT[w.rarity] || ''
            const borderCls = RARITY_BORDER[w.rarity] || 'border-surface-700'
            return (
              <div key={w.id} onClick={() => navigateToDetail(w.id)}
                className={`group relative rounded-xl overflow-hidden border ${borderCls} bg-surface-800/50 hover:border-primary-500/50 hover:scale-[1.02] transition-all duration-200 cursor-pointer`}
              >
                {/* Rarity gradient background */}
                {gradient && (
                  <div className={`absolute inset-0 bg-gradient-to-b ${gradient} pointer-events-none`} />
                )}
                <div className="relative aspect-[3/4] bg-surface-700/50 flex items-center justify-center p-4">
                  {w.image ? <WeaponThumb filename={w.image} large /> : <Sword className="w-10 h-10 text-surface-500" />}
                </div>
                <div className="relative p-3">
                  <p className="text-xs font-semibold text-white truncate">{w.name_zh}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className={`text-[10px] ${RARITY_COLOR[w.rarity] || 'text-surface-400'}`}>{RARITY_STARS[w.rarity]}</span>
                    <span className="text-[10px] text-surface-500">{weaponTypes.find(t => t.id === w.weapon_type_id)?.name_zh || ''}</span>
                  </div>
                </div>
              </div>
            )
          })}
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
    </div>
  )
}

function WeaponThumb({ filename, large }) {
  const [src, setSrc] = useState(null)
  const { readImage } = useDb()
  useEffect(() => {
    let cancelled = false
    async function load() {
      if (filename) { const data = await readImage(filename); if (!cancelled && data) setSrc(data) }
    }
    load(); return () => { cancelled = true }
  }, [filename, readImage])
  if (!src) return large ? <Sword className="w-10 h-10 text-surface-500" /> : <div className="w-12 h-12 rounded-lg bg-surface-700 flex items-center justify-center shrink-0"><Sword className="w-6 h-6 text-surface-500" /></div>
  return <img src={src} alt="" className={large ? 'w-full h-full object-contain scale-125' : 'w-12 h-12 rounded-lg object-cover shrink-0'} />
}

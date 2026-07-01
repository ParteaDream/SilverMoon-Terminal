import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { useDb } from '../context/DbContext'
import { useNav } from '../context/NavContext'
import { loadPageStateSync } from '../utils/pageStateStore'
import { useImageDrag } from '../hooks/useImageDrag'
import { useLazyImage, bumpLazyRevision } from '../hooks/useLazyImage'
import DataTable, { useSortFilter, SortBar, FilterBar } from '../components/DataTable'
import SearchBar from '../components/SearchBar'
import EditModal, { FormInput, FormSelect, ImagePicker } from '../components/EditModal'
import { Plus, LayoutList, LayoutGrid, Sword, MapPin, Trash2, ArrowUpDown } from 'lucide-react'

const ELEMENT_COLORS = {
  1: 'text-red-400', 2: 'text-blue-400', 3: 'text-cyan-400',
  4: 'text-purple-400', 5: 'text-green-400', 6: 'text-sky-300', 7: 'text-yellow-400'
}
const ELEMENT_BG = {
  1: 'from-red-500/20 to-red-900/10', 2: 'from-blue-500/20 to-blue-900/10',
  3: 'from-cyan-500/20 to-cyan-900/10', 4: 'from-purple-500/20 to-purple-900/10',
  5: 'from-green-500/20 to-green-900/10', 6: 'from-sky-500/20 to-sky-900/10',
  7: 'from-yellow-500/20 to-yellow-900/10',
}
const ELEMENT_BORDER = {
  1: 'border-red-500/30', 2: 'border-blue-500/30', 3: 'border-cyan-500/30',
  4: 'border-purple-500/30', 5: 'border-green-500/30', 6: 'border-sky-500/30',
  7: 'border-yellow-500/30',
}
const ELEMENT_NAMES = {
  1: '火', 2: '水', 3: '风', 4: '雷', 5: '草', 6: '冰', 7: '岩'
}
const RARITY_STARS = { 4: '★★★★', 5: '★★★★★' }

export default function CharactersPage() {
  const { query } = useDb()
  const { savePage, restorePage, push, consumeBackToList } = useNav()
  const [characters, setCharacters] = useState([])
  const [elements, setElements] = useState([])
  const [weaponTypes, setWeaponTypes] = useState([])
  const [regions, setRegions] = useState([])

  // ── 同步初始化：仅 viewMode 从缓存恢复 ──
  const initViewMode = loadPageStateSync('characters')?.state?.viewMode
  const [search, setSearch] = useState('')
  const [viewMode, setViewMode] = useState(() => {
    if (initViewMode) return initViewMode
    try {
      const defs = JSON.parse(localStorage.getItem('default_view_mode') || '{}')
      if (defs.characters) return defs.characters
    } catch (_) {}
    return 'gallery'
  })
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [selected, setSelected] = useState(new Set())
  const restoringScroll = useRef(false)

  // 挂载时加载数据，恢复视图模式和滚动位置
  useEffect(() => {
    const isBack = consumeBackToList()
    if (isBack) {
      // 同步预设 scrollY 消除置顶闪烁
      const cached = loadPageStateSync('characters')
      if (cached?.scrollY > 0) {
        const m = document.querySelector('main')
        if (m) m.scrollTop = cached.scrollY
      }
      loadData()
      restoringScroll.current = true
      restorePage('characters').then(saved => {
        if (saved) {
          if (saved.viewMode) setViewMode(saved.viewMode)
          if (saved.search) setSearch(saved.search)
          if (saved.sortKeys?.length) setSortKeys(saved.sortKeys)
          if (saved.filters) {
            Object.entries(saved.filters).forEach(([k, v]) => setFilter(k, v))
          }
          // 等待 React 处理筛选/排序状态后再恢复滚动位置
          requestAnimationFrame(() => {
          const main = document.querySelector('main')
          // 先尝试 scrollToItem（精确计算 scrollY）
          const scrollToId = sessionStorage.getItem('_nav_scroll_to_id')
          if (scrollToId) {
            sessionStorage.removeItem('_nav_scroll_to_id')
            const el = document.querySelector(`[data-item-id="${CSS.escape(scrollToId)}"]`)
            const m = document.querySelector('main')
            if (el && m) {
              const elRect = el.getBoundingClientRect()
              const mRect = m.getBoundingClientRect()
              const elTopInMain = elRect.top - mRect.top + m.scrollTop
              const targetY = elTopInMain - (m.clientHeight / 2) + (elRect.height / 2)
              m.scrollTo(0, Math.max(0, Math.round(targetY)))
              setTimeout(() => { restoringScroll.current = false }, 300)
              setTimeout(() => m.dispatchEvent(new Event('scroll', { bubbles: true })), 150)
              return
            }
            // 元素不在 DOM（可能被筛选隐藏）：后台重试，同时走 scrollY 回退
            const retryScrollToItem = (n) => {
              const el2 = document.querySelector(`[data-item-id="${CSS.escape(scrollToId)}"]`)
              const m2 = document.querySelector('main')
              if (el2 && m2) {
                const er = el2.getBoundingClientRect()
                const mr = m2.getBoundingClientRect()
                const et = er.top - mr.top + m2.scrollTop
                const ty = et - (m2.clientHeight / 2) + (er.height / 2)
                m2.scrollTo(0, Math.max(0, Math.round(ty)))
                setTimeout(() => { restoringScroll.current = false }, 300)
                setTimeout(() => m2.dispatchEvent(new Event('scroll', { bubbles: true })), 150)
              } else if (n > 0) {
                setTimeout(() => retryScrollToItem(n - 1), 200)
              }
            }
            setTimeout(() => retryScrollToItem(15), 200)
            // 不 return — 走下方 scrollY 回退作为近似定位
          }
          // 否则恢复保存的 scrollY
          if (saved.scrollY != null && saved.scrollY > 0 && main) {
            const targetY = Number(saved.scrollY)
            const tryScroll = (n) => {
              if (main.scrollHeight > targetY) {
                main.scrollTo(0, targetY)
                setTimeout(() => { restoringScroll.current = false }, 300)
                setTimeout(() => main.dispatchEvent(new Event('scroll', { bubbles: true })), 150)
              } else if (n > 0) { setTimeout(() => tryScroll(n - 1), 200) }
              else { restoringScroll.current = false }
            }
            tryScroll(10)
          }
          }) // end requestAnimationFrame
        }
      })
    } else {
      // 从侧边栏进入：使用全局默认视图模式，重置滚动位置
      const main = document.querySelector('main')
      if (main) main.scrollTo(0, 0)
      try {
        const defs = JSON.parse(localStorage.getItem('default_view_mode') || '{}')
        if (defs.characters) setViewMode(defs.characters)
      } catch (_) {}
      loadData()
    }
  }, [])


  // 滚动时保存
  useLayoutEffect(() => {
    const main = document.querySelector('main')
    if (!main) return
    let timer = null
    const save = () => {
      if (restoringScroll.current) return
      savePage('characters', stateRef.current)
    }
    const onScroll = () => {
      clearTimeout(timer)
      timer = setTimeout(save, 150)
    }
    main.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      main.removeEventListener('scroll', onScroll)
      clearTimeout(timer)
      save() // 离开前最终保存（此时 DOM 尚未替换，scrollTop 正确）
    }
  }, [savePage])

  async function loadData() {
    try {
      const [chars, elems, wtypes, regs, fits] = await Promise.all([
        query('SELECT * FROM characters ORDER BY id'),
        query('SELECT * FROM elements'),
        query('SELECT * FROM weapon_types'),
        query('SELECT * FROM regions ORDER BY sort_order, id'),
        query('SELECT id, character_id, avatar_image FROM character_outfits WHERE avatar_image IS NOT NULL AND avatar_image != \'\''),
      ])
      // 构建 char_id → active outfit avatar 映射
      const outfitAvatarMap = {}
      const charsData = chars.data || []
      const fitsData = fits.data || []

      // 从 user.json 读取 outfit 选择（回退用）
      let outfitSelections = {}
      try {
        const uRes = await window.electronAPI?.getUserConfig()
        if (uRes?.success && uRes.config?.outfitSelections) {
          outfitSelections = uRes.config.outfitSelections
        }
      } catch (_) {}

      for (const c of charsData) {
        const outfitId = outfitSelections[c.id]
        if (outfitId) {
          const fit = fitsData.find(f => f.id === outfitId)
          if (fit?.avatar_image) outfitAvatarMap[c.id] = fit.avatar_image
        }
      }
      // 附加 displayCardArt 计算属性
      for (const c of charsData) {
        c._displayCardArt = outfitAvatarMap[c.id] || c.card_art
      }
      setCharacters(charsData)
      setElements(elems.data || [])
      setWeaponTypes(wtypes.data || [])
      setRegions(regs.data || [])
    } catch (e) {
      console.error('Failed to load characters:', e)
    }
  }

  function navigateToDetail(id) {
    savePage('characters', stateRef.current)
    push(`/characters/${id}`)
  }

  function openAdd() {
    setEditing(null)
    setForm({ id: 0, rarity: 5 })
    setModalOpen(true)
  }

  function openEdit(row) {
    setEditing(row)
    setForm({ ...row })
    setModalOpen(true)
  }

  async function handleSave() {
    if (saving) return
    setSaving(true)
    try {
      if (editing) {
        const newId = Number(form.id)
        const oldId = editing.id
        if (newId !== oldId) {
          const dup = await query('SELECT COUNT(*) as cnt FROM characters WHERE id = ?', [newId])
          if (dup.data?.[0]?.cnt > 0) { alert(`ID ${newId} 已存在，请使用其他 ID`); setSaving(false); return }
          // 关闭外键检查以允许级联修改 ID
          await query('PRAGMA foreign_keys = OFF')
          try {
            await query('UPDATE character_constellations SET character_id = ? WHERE character_id = ?', [newId, oldId])
            await query('UPDATE character_talents SET character_id = ? WHERE character_id = ?', [newId, oldId])
            await query('UPDATE character_outfits SET character_id = ? WHERE character_id = ?', [newId, oldId])
            await query('UPDATE character_stories SET character_id = ? WHERE character_id = ?', [newId, oldId])
            await query('UPDATE character_ascension_materials SET character_id = ? WHERE character_id = ?', [newId, oldId])
            await query('UPDATE character_talent_materials SET character_id = ? WHERE character_id = ?', [newId, oldId])
          } finally {
            await query('PRAGMA foreign_keys = ON')
          }
        }
        const keys = Object.keys(form)
        const sets = keys.map(k => `${k} = ?`).join(', ')
        await query(`UPDATE characters SET ${sets} WHERE id = ?`, [...keys.map(k => form[k]), oldId])
      } else {
        const newId = Number(form.id)
        const dup = await query('SELECT COUNT(*) as cnt FROM characters WHERE id = ?', [newId])
        if (dup.data?.[0]?.cnt > 0) { alert(`ID ${newId} 已存在，请使用其他 ID`); setSaving(false); return }
        const keys = Object.keys(form)
        await query(
          `INSERT INTO characters (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
          keys.map(k => form[k])
        )
      }
      setModalOpen(false)
      loadData()
    } catch (e) {
      console.error('Save failed:', e)
      alert('保存失败: ' + (e.message || '未知错误'))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(row) {
    if (!confirm(`确定删除角色「${row.name_zh}」？`)) return
    await query('DELETE FROM characters WHERE id = ?', [row.id])
    loadData()
  }

  function toggleSelect(id) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    const ids = processed.map(r => r.id)
    if (ids.every(id => selected.has(id))) {
      setSelected(new Set())
    } else {
      setSelected(new Set(ids))
    }
  }

  async function handleBulkDelete() {
    if (selected.size === 0) return
    if (!confirm(`确定删除选中的 ${selected.size} 个角色？此操作不可撤销。`)) return
    const ids = [...selected]
    await query(`DELETE FROM characters WHERE id IN (${ids.map(() => '?').join(',')})`, ids)
    setSelected(new Set())
    loadData()
  }

  // 同步选中角色到 DevToolbar
  useEffect(() => {
    const selectedData = characters.filter(c => selected.has(c.id))
    window.dispatchEvent(new CustomEvent('devtoolbar-selection', { detail: selectedData }))
  }, [selected, characters])

  const filtered = characters.filter(c =>
    !search || c.name_zh.includes(search) || (c.name_en || '').toLowerCase().includes(search.toLowerCase())
  )

  const columns = [
    {
      key: 'image', label: '', width: '64px', minWidth: '64px',
      render: row => <CharThumb filename={row._displayCardArt || row.splash_art} />,
    },
    {
      key: 'id', label: 'ID',
      render: row => <span className="text-surface-500 font-mono text-xs">{row.id}</span>,
      width: '50px',
    },
    {
      key: 'rarity', label: '稀有度',
      render: row => <span className={row.rarity === 5 ? 'text-accent-gold font-medium' : 'text-purple-400'}>{RARITY_STARS[row.rarity] || row.rarity}</span>,
      width: '100px',
      filterType: 'select', filterOptions: [4, 5], filterLabel: v => RARITY_STARS[v] || v,
    },
    {
      key: 'name_zh', label: '名称',
      render: row => (
        <div className="flex items-center gap-2 cursor-pointer" onClick={e => { e.stopPropagation(); navigateToDetail(row.id) }}>
          <span className="font-medium text-white hover:text-primary-400 transition-colors whitespace-nowrap">{row.name_zh}</span>
          {row.title_zh && <span className="text-xs text-surface-500 whitespace-nowrap">{row.title_zh}</span>}
        </div>
      ),
      filterType: 'text',
      minWidth: '220px',
    },
    {
      key: 'element_id', label: '元素',
      render: row => (
        <span className={ELEMENT_COLORS[row.element_id] || ''}>
          {ELEMENT_NAMES[row.element_id] || row.element_id}
        </span>
      ),
      width: '80px',
      filterType: 'select', filterValue: v => ELEMENT_NAMES[v] || v,
      filterOptions: () => elements.map(e => ({ value: e.id, label: e.name_zh })),
    },
    {
      key: 'weapon_type_id', label: '武器',
      render: row => {
        const wt = weaponTypes.find(w => w.id === row.weapon_type_id)
        return <span className="text-surface-300">{wt?.name_zh || '-'}</span>
      },
      width: '100px',
      filterType: 'select', filterValue: v => weaponTypes.find(w => w.id === v)?.name_zh || v,
      filterOptions: () => weaponTypes.map(w => ({ value: w.id, label: w.name_zh })),
    },
    {
      key: 'region_id', label: '地区',
      render: row => {
        const r = regions.find(r => r.id === row.region_id)
        return <span className="text-surface-400 text-xs">{r?.name_zh || '-'}</span>
      },
      width: '80px',
      filterType: 'select', filterValue: v => regions.find(r => r.id === v)?.name_zh || v,
      filterOptions: () => regions.map(r => ({ value: r.id, label: r.name_zh })),
    },
    { key: 'birthday', label: '生日', width: '90px', render: row => <span className="text-surface-400 text-xs">{row.birthday || '-'}</span> },
    {
      key: 'release_date', label: '上线时间',
      render: row => <span className="text-surface-400 text-xs">{row.release_date || '-'}</span>,
      width: '100px',
      filterType: 'text',
    },
    {
      key: 'affiliation', label: '所属',
      render: row => <span className="text-surface-400 text-xs">{row.affiliation || '-'}</span>,
      filterType: 'text',
    },
  ]

  // Shared sort/filter state for both views
  const {
    sortKeys, setSortKeys, handleSort, removeSort, clearSorts, reorderSorts,
    filters, setFilter, clearFilters,
    showFilters, setShowFilters, filterableCols, filterOptions,
    processed, activeFilterCount,
  } = useSortFilter(filtered, columns)

  // 排序/筛选变化时通知懒加载图片重新检查视口
  useEffect(() => { bumpLazyRevision() }, [sortKeys, filters])

  // 用 ref 保持最新状态，避免 useLayoutEffect 频繁重建
  const stateRef = useRef({ viewMode, search, sortKeys, filters })
  stateRef.current = { viewMode, search, sortKeys, filters }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">角色</h1>
          <p className="text-xs text-surface-500 mt-0.5">{processed.length} 条记录</p>
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex items-center rounded-lg bg-surface-800 border border-surface-700 p-0.5">
            <button
              onClick={() => setViewMode('table')}
              className={`p-1.5 rounded-md transition-colors ${viewMode === 'table' ? 'bg-surface-700 text-white' : 'text-surface-400 hover:text-surface-200'}`}
              title="表格视图"
            >
              <LayoutList className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setViewMode('gallery')}
              className={`p-1.5 rounded-md transition-colors ${viewMode === 'gallery' ? 'bg-surface-700 text-white' : 'text-surface-400 hover:text-surface-200'}`}
              title="画廊视图"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>
          </div>
          <SearchBar value={search} onChange={setSearch} placeholder="搜索角色名称..." />
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
          {filterableCols.length > 0 && (
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center gap-1 px-2.5 py-2 rounded-lg text-xs transition-colors flex-shrink-0
                ${showFilters || activeFilterCount > 0
                  ? 'bg-primary-500/10 text-primary-400 border border-primary-500/20'
                  : 'text-surface-400 hover:text-surface-200 hover:bg-surface-800'
                }`}
            >
              <FilterButton />
              {activeFilterCount > 0 && (
                <span className="w-4 h-4 rounded-full bg-primary-500 text-[10px] font-bold text-white flex items-center justify-center">
                  {activeFilterCount}
                </span>
              )}
            </button>
          )}
          <button
            onClick={openAdd}
            className="flex items-center gap-1.5 px-3 py-2 bg-primary-600 hover:bg-primary-500
                       rounded-lg text-xs font-medium text-white transition-colors flex-shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />添加
          </button>
          {selected.size > 0 && (
            <button
              onClick={handleBulkDelete}
              className="flex items-center gap-1.5 px-3 py-2 bg-red-600 hover:bg-red-500
                         rounded-lg text-xs font-medium text-white transition-colors flex-shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5" />删除 ({selected.size})
            </button>
          )}
        </div>
      </div>

      {/* Filter bar (shared) */}
      {showFilters && filterableCols.length > 0 && (
        <FilterBar {...{ filterableCols, filters, setFilter, clearFilters, filterOptions, activeFilterCount }} />
      )}

      {/* Sort bar (shared) */}
      <SortBar sortKeys={sortKeys} columns={columns}
        onToggleSort={handleSort} onRemoveSort={removeSort} onClearSorts={clearSorts} onReorderSorts={reorderSorts} />

      {/* Table view */}
      {viewMode === 'table' && (
        <DataTable
          title=""
          columns={columns}
          data={filtered}
          onEdit={openEdit}
          onDelete={handleDelete}
          onAdd={null}
          searchBar={null}
          sortKeys={sortKeys}
          handleSort={handleSort}
          removeSort={removeSort}
          clearSorts={clearSorts}
          reorderSorts={reorderSorts}
          filters={filters}
          setFilter={setFilter}
          clearFilters={clearFilters}
          showFilters={showFilters}
          setShowFilters={setShowFilters}
          filterableCols={filterableCols}
          filterOptions={filterOptions}
          processed={processed}
          activeFilterCount={activeFilterCount}
          selectable
          selectedIds={selected}
          onToggleSelect={toggleSelect}
          onToggleSelectAll={toggleSelectAll}
          onRowClick={row => navigateToDetail(row.id)}
          itemIdKey="id"
        />
      )}

      {/* Gallery view */}
      {viewMode === 'gallery' && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-3 animate-fade-in">
          {processed.map(char => {
            const el = ELEMENT_NAMES[char.element_id]
            const wt = weaponTypes.find(w => w.id === char.weapon_type_id)
            const reg = regions.find(r => r.id === char.region_id)
            return (
              <div
                key={char.id + '|s' + sortKeys.map(s => s.key + s.dir).join(',') + '|f' + Object.entries(filters).flat().join(',')}
                data-item-id={char.id}
                onClick={() => navigateToDetail(char.id)}
                className={`group relative rounded-xl overflow-hidden border cursor-pointer
                  bg-gradient-to-b ${ELEMENT_BG[char.element_id] || 'from-surface-800 to-surface-900'}
                  ${ELEMENT_BORDER[char.element_id] || 'border-surface-700'}
                  hover:border-primary-500/50 hover:scale-[1.02] transition-all duration-200`}
              >
                {/* Card image */}
                <div className="aspect-[3/4] bg-surface-800 flex items-end justify-center overflow-hidden relative">
                  {char._displayCardArt ? (
                    <CardImage filename={char._displayCardArt} className="w-full h-auto max-h-full object-contain object-bottom" />
                  ) : char.splash_art ? (
                    <CardImage filename={char.splash_art} className="w-full h-auto max-h-full object-contain object-bottom" />
                  ) : (
                    <span className={`text-6xl font-bold pb-4 ${ELEMENT_COLORS[char.element_id] || 'text-surface-500'}`}>
                      {char.name_zh[0]}
                    </span>
                  )}
                  {/* Top gradient overlay */}
                  <div className={`absolute top-0 left-0 right-0 h-12 bg-gradient-to-b ${ELEMENT_BG[char.element_id] || 'from-surface-900/70 to-transparent'}`} />
                  {/* Rarity badge */}
                  <div className="absolute top-2 left-2">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                      char.rarity === 5 ? 'bg-accent-gold/20 text-accent-gold border border-accent-gold/30' : 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                    }`}>
                      {RARITY_STARS[char.rarity]}
                    </span>
                  </div>
                  {/* Element badge */}
                  <div className="absolute top-2 right-2">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full bg-surface-950/60 backdrop-blur-sm ${ELEMENT_COLORS[char.element_id] || ''}`}>
                      {el}
                    </span>
                  </div>
                  {/* Edit/Delete on hover */}
                  <div className="absolute bottom-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={e => { e.stopPropagation(); openEdit(char); }}
                      className="p-1.5 rounded-lg bg-black/60 text-white/80 hover:text-white"
                    >
                      <EditIcon />
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); handleDelete(char); }}
                      className="p-1.5 rounded-lg bg-black/60 text-white/80 hover:text-red-400"
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </div>
                {/* Card info */}
                <div className="p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-xs font-semibold text-white truncate block max-w-full">{char.name_zh}</span>
                    <span className="text-[10px] font-mono text-surface-600">{char.id}</span>
                  </div>
                  {char.title_zh && <p className="text-[10px] text-surface-400 truncate mb-1.5">{char.title_zh}</p>}
                  <div className="flex items-center gap-2 text-[10px] text-surface-500">
                    {wt && <span className="flex items-center gap-0.5"><Sword className="w-2.5 h-2.5" />{wt.name_zh}</span>}
                    {reg && <span className="flex items-center gap-0.5"><MapPin className="w-2.5 h-2.5" />{reg.name_zh}</span>}
                  </div>
                  {char.release_date && <p className="text-[10px] text-surface-500 mt-1">上线: {char.release_date}</p>}
                </div>
              </div>
            )
          })}
          {processed.length === 0 && (
            <div className="col-span-full py-16 text-center text-surface-500 text-sm">
              {characters.length === 0 ? '暂无角色' : '没有匹配筛选条件的结果'}
            </div>
          )}
        </div>
      )}

      {/* Edit Modal */}
      <EditModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSave={handleSave}
        saving={saving}
        title={editing ? `编辑角色 - ${editing.name_zh}` : '添加角色'}
      >
        <div className="grid grid-cols-2 gap-x-6">
          <FormInput label="ID" value={form.id ?? 0} onChange={v => setForm({ ...form, id: v === '' ? 0 : Number(v) })} type="number" />
          <FormInput label="中文名" value={form.name_zh} onChange={v => setForm({ ...form, name_zh: v })} />
          <FormInput label="英文名" value={form.name_en} onChange={v => setForm({ ...form, name_en: v })} />
          <FormInput label="称号" value={form.title_zh} onChange={v => setForm({ ...form, title_zh: v })} />
          <FormInput label="稀有度 (4/5)" value={form.rarity} onChange={v => setForm({ ...form, rarity: v })} type="number" />
          <FormSelect label="角色类型" value={form.character_type || 'normal'} onChange={v => setForm({ ...form, character_type: v })}
            options={[{ value: 'normal', label: '普通' }, { value: 'traveler', label: '旅行者' }]} />
          <FormSelect label="元素" value={form.element_id} onChange={v => setForm({ ...form, element_id: Number(v) })}
            options={elements.map(e => ({ value: e.id, label: e.name_zh }))} />
          <FormSelect label="武器类型" value={form.weapon_type_id} onChange={v => setForm({ ...form, weapon_type_id: Number(v) })}
            options={weaponTypes.map(w => ({ value: w.id, label: w.name_zh }))} />
          <FormSelect label="地区" value={form.region_id} onChange={v => setForm({ ...form, region_id: Number(v) })}
            options={regions.map(r => ({ value: r.id, label: r.name_zh }))} />
          <FormInput label="生日 (MM-DD)" value={form.birthday} onChange={v => setForm({ ...form, birthday: v })} />
          <FormInput label="上线时间" value={form.release_date} onChange={v => setForm({ ...form, release_date: v })} placeholder="YYYY-MM-DD" />
          <FormInput label="所属" value={form.affiliation} onChange={v => setForm({ ...form, affiliation: v })} />
          <FormInput label="命之座名称" value={form.constellation_zh} onChange={v => setForm({ ...form, constellation_zh: v })} />
        </div>
        <FormInput label="角色简介" value={form.description_zh} onChange={v => setForm({ ...form, description_zh: v })} multiline />
        <div className="grid grid-cols-3 gap-x-6">
          <ImagePicker label="立绘" currentImage={form.splash_art} onSelect={v => setForm({ ...form, splash_art: v })} onRemove={() => setForm({ ...form, splash_art: null })} />
          <ImagePicker label="头像" currentImage={form.card_art} onSelect={v => setForm({ ...form, card_art: v })} onRemove={() => setForm({ ...form, card_art: null })} />
          <ImagePicker label="名片" currentImage={form.namecard_art} onSelect={v => setForm({ ...form, namecard_art: v })} onRemove={() => setForm({ ...form, namecard_art: null })} />
        </div>
      </EditModal>
    </div>
  )
}

// Inline icons to avoid import issues
function FilterButton() { return <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg> }
function EditIcon() { return <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg> }
function TrashIcon() { return <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg> }

function CardImage({ filename, className }) {
  const { ref, src } = useLazyImage(filename)
  const handleDrag = useImageDrag(filename)
  return (
    <div ref={ref} className={className || 'w-full h-full'}>
      {src ? (
        <img src={src} alt="" className="w-full h-full object-cover" draggable onDragStart={handleDrag} />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-surface-800/50 text-surface-600 text-[10px]">加载中...</div>
      )}
    </div>
  )
}

function CharThumb({ filename }) {
  const { ref, src } = useLazyImage(filename, '100px')
  const handleDrag = useImageDrag(filename)
  if (!src) return <div ref={ref} className="w-8 h-8 rounded bg-surface-700 flex items-center justify-center shrink-0"><UserIcon /></div>
  return <img ref={ref} src={src} alt="" className="w-8 h-8 rounded object-cover shrink-0" draggable onDragStart={handleDrag} />
}

function UserIcon() { return <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-surface-500"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> }

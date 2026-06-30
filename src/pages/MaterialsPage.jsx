import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { useDb } from '../context/DbContext'
import { useNav } from '../context/NavContext'
import { loadPageStateSync } from '../utils/pageStateStore'
import { useLazyImage } from '../hooks/useLazyImage'
import DataTable from '../components/DataTable'
import SearchBar from '../components/SearchBar'
import EditModal, { FormInput, FormSelect, ImagePicker } from '../components/EditModal'
import ColoredText from '../components/ColoredText'
import { LayoutList, LayoutGrid, Plus, Package } from 'lucide-react'

const RARITY_STARS = { 1: '★', 2: '★★', 3: '★★★', 4: '★★★★', 5: '★★★★★' }
const RARITY_COLOR = { 1: 'text-gray-300', 2: 'text-green-400', 3: 'text-blue-400', 4: 'text-purple-400', 5: 'text-accent-gold' }

const MATERIAL_TYPES = {
  character_ascension: '角色突破', weapon_ascension: '武器突破', talent: '天赋书',
  cooking: '食材', local_specialty: '地区特产', common: '通用掉落',
  boss_drop: 'Boss掉落', weekly_boss_drop: '周本掉落', event: '活动材料',
}

export default function MaterialsPage() {
  const { query } = useDb()
  const { restorePage, savePage, push, consumeBackToList } = useNav()
  const [materials, setMaterials] = useState([])

  // ── 同步初始化：仅 viewMode 从缓存恢复 ──
  const initViewMode = loadPageStateSync('materials')?.state?.viewMode
  const [search, setSearch] = useState('')
  const [viewMode, setViewMode] = useState(() => {
    if (initViewMode) return initViewMode
    try {
      const defs = JSON.parse(localStorage.getItem('default_view_mode') || '{}')
      if (defs.materials) return defs.materials
    } catch (_) {}
    return 'gallery'
  })
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({})
  const [selected, setSelected] = useState(new Set())
  const restoringScroll = useRef(false)
  // 用 ref 保持最新状态
  const stateRef = useRef({ viewMode, search })
  stateRef.current = { viewMode, search }

  // 挂载时加载数据，恢复视图模式
  useEffect(() => {
    const isBack = consumeBackToList()
    if (isBack) {
      // 同步预设 scrollY 消除置顶闪烁
      const cached = loadPageStateSync('materials')
      if (cached?.scrollY > 0) {
        const m = document.querySelector('main')
        if (m) m.scrollTop = cached.scrollY
      }
      loadData()
      restoringScroll.current = true
      restorePage('materials').then(saved => {
        if (saved) {
          if (saved.viewMode) setViewMode(saved.viewMode)
          if (saved.search) setSearch(saved.search)
          // 等待 React 处理搜索后再恢复滚动位置
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
          if (saved.scrollY != null && saved.scrollY > 0) {
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
          }) // end requestAnimationFrame
        }
      })
    } else {
      // 从侧边栏进入：使用全局默认视图模式，重置滚动位置
      const main = document.querySelector('main')
      if (main) main.scrollTo(0, 0)
      try {
        const defs = JSON.parse(localStorage.getItem('default_view_mode') || '{}')
        if (defs.materials) setViewMode(defs.materials)
      } catch (_) {}
      loadData()
    }
  }, [])

  // 滚动时保存
  useLayoutEffect(() => {
    const main = document.querySelector('main')
    if (!main) return
    let timer = null
    const onScroll = () => {
      clearTimeout(timer)
      if (restoringScroll.current) return
      timer = setTimeout(() => savePage('materials', stateRef.current), 200)
    }
    main.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      main.removeEventListener('scroll', onScroll)
      clearTimeout(timer)
    }
  }, [savePage])

  async function loadData() {
    const result = await query('SELECT * FROM materials ORDER BY id')
    setMaterials(result.data || [])
  }

  function navigateToDetail(id) {
    savePage('materials', stateRef.current)
    push(`/materials/${id}`)
  }

  function openAdd() { setEditing(null); setForm({ id: 0, type: 'common', rarity: 1, sort_order: 0 }); setModalOpen(true) }
  function openEdit(row) { setEditing(row); setForm({ ...row }); setModalOpen(true) }

  async function handleSave() {
    if (editing) {
      const newId = Number(form.id)
      const oldId = editing.id
      if (newId !== oldId) {
        // 检查 ID 重复
        const dup = await query('SELECT COUNT(*) as cnt FROM materials WHERE id = ?', [newId])
        if (dup.data?.[0]?.cnt > 0) { alert(`ID ${newId} 已存在，请使用其他 ID`); return }
        // 关闭外键检查以允许级联修改 ID
        await query('PRAGMA foreign_keys = OFF')
        try {
          await query('UPDATE character_ascension_materials SET material_id = ? WHERE material_id = ?', [newId, oldId])
          await query('UPDATE character_talent_materials SET material_id = ? WHERE material_id = ?', [newId, oldId])
          await query('UPDATE weapon_ascension_materials SET material_id = ? WHERE material_id = ?', [newId, oldId])
        } finally {
          await query('PRAGMA foreign_keys = ON')
        }
      }
      const keys = Object.keys(form)
      const sets = keys.map(k => `${k} = ?`).join(', ')
      await query(`UPDATE materials SET ${sets} WHERE id = ?`, [...keys.map(k => form[k]), oldId])
    } else {
      const newId = Number(form.id)
      const dup = await query('SELECT COUNT(*) as cnt FROM materials WHERE id = ?', [newId])
      if (dup.data?.[0]?.cnt > 0) { alert(`ID ${newId} 已存在，请使用其他 ID`); return }
      const keys = Object.keys(form)
      await query(`INSERT INTO materials (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`, keys.map(k => form[k]))
    }
    setModalOpen(false); loadData()
  }

  async function handleDelete(row) {
    if (!confirm(`确定删除材料「${row.name_zh}」？`)) return
    await query('DELETE FROM materials WHERE id = ?', [row.id])
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
    const ids = filtered.map(r => r.id)
    if (ids.every(id => selected.has(id))) {
      setSelected(new Set())
    } else {
      setSelected(new Set(ids))
    }
  }

  async function handleBulkDelete() {
    if (selected.size === 0) return
    if (!confirm(`确定删除选中的 ${selected.size} 个材料？此操作不可撤销。`)) return
    const ids = [...selected]
    await query(`DELETE FROM materials WHERE id IN (${ids.map(() => '?').join(',')})`, ids)
    setSelected(new Set())
    loadData()
  }

  const filtered = materials.filter(m =>
    !search || m.name_zh.includes(search) || (m.name_en || '').toLowerCase().includes(search.toLowerCase())
  )

  // 同步选中材料到 DevToolbar
  useEffect(() => {
    const selectedData = materials.filter(m => selected.has(m.id))
    window.dispatchEvent(new CustomEvent('devtoolbar-material-selection', { detail: selectedData }))
  }, [selected, materials])

  const columns = [
    { key: 'image', label: '', width: '64px', render: row => <MatThumb filename={row.image} /> },
    { key: 'id', label: 'ID', width: '60px',
      render: row => <span className="text-xs text-surface-400 font-mono">{row.id}</span>,
      filterType: 'text' },
    { key: 'rarity', label: '稀有度', width: '70px',
      render: row => <span className={RARITY_COLOR[row.rarity] || 'text-amber-400'}>{RARITY_STARS[row.rarity]}</span>,
      filterType: 'select', filterOptions: [1, 2, 3, 4, 5], filterLabel: v => '★'.repeat(v) },
    { key: 'name_zh', label: '名称',
      render: row => <span className="font-medium text-white hover:text-primary-400 cursor-pointer transition-colors" onClick={() => navigateToDetail(row.id)}>{row.name_zh}</span>,
      filterType: 'text' },
    { key: 'type', label: '类型', width: '100px',
      render: row => <span className="inline-block text-xs px-2 py-0.5 rounded-full bg-surface-700 text-surface-300">{MATERIAL_TYPES[row.type] || row.type}</span>,
      filterType: 'select', filterValue: v => MATERIAL_TYPES[v] || v,
      filterOptions: () => Object.entries(MATERIAL_TYPES).map(([k, v]) => ({ value: k, label: v })) },
    { key: 'source', label: '获取来源', render: row => <span className="text-xs text-surface-400">{row.source || '-'}</span>, filterType: 'text' },
    { key: 'description_zh', label: '说明',
      render: row => <span className="text-xs text-surface-500 max-w-xs line-clamp-2"><ColoredText text={row.description_zh || '-'} /></span>, filterType: 'text' },
  ]

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div><h1 className="text-lg font-semibold tracking-tight">材料</h1><p className="text-xs text-surface-500 mt-0.5">{filtered.length} 条记录</p></div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-lg bg-surface-800 border border-surface-700 p-0.5">
            <button onClick={() => setViewMode('table')} className={`p-1.5 rounded-md transition-colors ${viewMode === 'table' ? 'bg-surface-700 text-white' : 'text-surface-400 hover:text-surface-200'}`}><LayoutList className="w-3.5 h-3.5" /></button>
            <button onClick={() => setViewMode('gallery')} className={`p-1.5 rounded-md transition-colors ${viewMode === 'gallery' ? 'bg-surface-700 text-white' : 'text-surface-400 hover:text-surface-200'}`}><LayoutGrid className="w-3.5 h-3.5" /></button>
          </div>
          <SearchBar value={search} onChange={setSearch} placeholder="搜索材料..." />
          <button onClick={openAdd} className="flex items-center gap-1.5 px-3 py-2 bg-primary-600 hover:bg-primary-500 rounded-lg text-xs font-medium text-white transition-colors"><Plus className="w-3.5 h-3.5" />添加</button>
        </div>
      </div>

      {viewMode === 'table' ? (
        <DataTable title="" columns={columns} data={filtered} onEdit={openEdit} onDelete={handleDelete} onAdd={null} searchBar={null}
          selectable
          selectedIds={selected}
          onToggleSelect={toggleSelect}
          onToggleSelectAll={toggleSelectAll}
          onBulkDelete={handleBulkDelete}
          onRowClick={row => navigateToDetail(row.id)} itemIdKey="id"
        />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-3">
          {filtered.map(m => (
            <div key={m.id} data-item-id={m.id} onClick={() => navigateToDetail(m.id)} className="group relative rounded-xl overflow-hidden border border-surface-700 bg-surface-800/50 hover:border-primary-500/50 hover:scale-[1.02] transition-all duration-200 cursor-pointer">
              <div className="aspect-[3/4] bg-surface-700 flex items-center justify-center">
                {m.image ? <MatThumb filename={m.image} large /> : <Package className="w-10 h-10 text-surface-500" />}
              </div>
              <div className="p-3">
                <p className="text-xs font-semibold text-white truncate">{m.name_zh}</p>
                <p className={`text-[10px] ${RARITY_COLOR[m.rarity] || 'text-surface-400'}`}>{RARITY_STARS[m.rarity]}{' '}{MATERIAL_TYPES[m.type] || m.type}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <EditModal isOpen={modalOpen} onClose={() => setModalOpen(false)} onSave={handleSave} title={editing ? `编辑材料 - ${editing.name_zh}` : '添加材料'}>
        <div className="grid grid-cols-2 gap-x-6">
          <FormInput label="ID" value={form.id ?? 0} onChange={v => setForm({ ...form, id: v === '' ? 0 : Number(v) })} />
          <FormInput label="中文名" value={form.name_zh} onChange={v => setForm({ ...form, name_zh: v })} />
          <FormInput label="英文名" value={form.name_en} onChange={v => setForm({ ...form, name_en: v })} />
          <FormSelect label="类型" value={form.type} onChange={v => setForm({ ...form, type: v })} options={Object.entries(MATERIAL_TYPES).map(([k, v]) => ({ value: k, label: v }))} />
          <FormInput label="稀有度 (1-5)" value={form.rarity} onChange={v => setForm({ ...form, rarity: Number(v) })} type="number" />
        </div>
        <FormInput label="说明" value={form.description_zh} onChange={v => setForm({ ...form, description_zh: v })} multiline />
        <div className="grid grid-cols-2 gap-x-6">
          <FormInput label="获取来源" value={form.source} onChange={v => setForm({ ...form, source: v })} />
          <FormInput label="用途" value={form.usage} onChange={v => setForm({ ...form, usage: v })} multiline />
        </div>
        <ImagePicker label="材料图片" currentImage={form.image} onSelect={v => setForm({ ...form, image: v })} onRemove={() => setForm({ ...form, image: null })} />
      </EditModal>
    </div>
  )
}

function MatThumb({ filename, large }) {
  const { ref, src } = useLazyImage(filename)
  if (large) {
    return (
      <div ref={ref} className="w-full h-full flex items-center justify-center overflow-hidden">
        {src ? <img src={src} alt="" className="w-full h-full object-contain" /> : <Package className="w-10 h-10 text-surface-500" />}
      </div>
    )
  }
  return (
    <div ref={ref} className="w-8 h-8 rounded overflow-hidden shrink-0 bg-surface-700 flex items-center justify-center">
      {src ? <img src={src} alt="" className="w-full h-full object-cover" /> : <Package className="w-4 h-4 text-surface-500" />}
    </div>
  )
}

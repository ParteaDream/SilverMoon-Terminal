import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { useDb } from '../context/DbContext'
import { useNav } from '../context/NavContext'
import { loadPageStateSync } from '../utils/pageStateStore'
import DataTable from '../components/DataTable'
import SearchBar from '../components/SearchBar'
import EditModal, { FormInput, ImagePicker } from '../components/EditModal'
import { LayoutList, LayoutGrid, Plus, Gem } from 'lucide-react'

const RARITY_STARS = { 1: '★', 2: '★★', 3: '★★★', 4: '★★★★', 5: '★★★★★' }
const RARITY_COLOR = { 1: 'text-gray-300', 2: 'text-green-400', 3: 'text-blue-400', 4: 'text-purple-400', 5: 'text-accent-gold' }

export default function ArtifactsPage() {
  const { query } = useDb()
  const { restorePage, savePage, push, consumeBackToList } = useNav()
  const [artifacts, setArtifacts] = useState([])
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({})
  const [viewMode, setViewMode] = useState(() => {
    const saved = loadPageStateSync('artifacts')
    if (saved?.state?.viewMode) return saved.state.viewMode
    try {
      const defs = JSON.parse(localStorage.getItem('default_view_mode') || '{}')
      if (defs.artifacts) return defs.artifacts
    } catch (_) {}
    return 'table'
  })
  const [selected, setSelected] = useState(new Set())
  const restoringScroll = useRef(false)

  useEffect(() => {
    const isBack = consumeBackToList()
    if (isBack) {
      loadData()
      restorePage('artifacts').then(saved => {
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
      timer = setTimeout(() => savePage('artifacts', { viewMode }), 200)
    }
    main.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      main.removeEventListener('scroll', onScroll)
      clearTimeout(timer)
    }
  }, [viewMode, savePage])

  async function loadData() {
    const result = await query('SELECT * FROM artifacts ORDER BY id')
    setArtifacts(result.data || [])
  }

  // 同步选中圣遗物到 DevToolbar
  useEffect(() => {
    const selectedData = artifacts.filter(a => selected.has(a.id))
    window.dispatchEvent(new CustomEvent('devtoolbar-artifact-selection', { detail: selectedData }))
  }, [selected, artifacts])

  function navigateToDetail(id) {
    savePage('artifacts', { viewMode })
    push(`/artifacts/${id}`)
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
    if (ids.every(id => selected.has(id))) setSelected(new Set())
    else setSelected(new Set(ids))
  }

  function openAdd() { setEditing(null); setForm({ id: 0, max_rarity: 5, sort_order: 0 }); setModalOpen(true) }
  function openEdit(row) { setEditing(row); setForm({ ...row }); setModalOpen(true) }

  async function handleSave() {
    const newId = Number(form.id)
    // 检查 ID 重复
    if (editing) {
      if (newId !== editing.id) {
        const dup = await query('SELECT COUNT(*) as cnt FROM artifacts WHERE id = ?', [newId])
        if (dup.data?.[0]?.cnt > 0) { alert(`ID ${newId} 已存在，请使用其他 ID`); return }
      }
      const keys = Object.keys(form)
      const sets = keys.map(k => `${k} = ?`).join(', ')
      await query(`UPDATE artifacts SET ${sets} WHERE id = ?`, [...keys.map(k => form[k]), editing.id])
    } else {
      const dup = await query('SELECT COUNT(*) as cnt FROM artifacts WHERE id = ?', [newId])
      if (dup.data?.[0]?.cnt > 0) { alert(`ID ${newId} 已存在，请使用其他 ID`); return }
      const keys = Object.keys(form)
      await query(`INSERT INTO artifacts (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`, keys.map(k => form[k]))
    }
    setModalOpen(false); loadData()
  }

  async function handleDelete(row) {
    if (!confirm(`确定删除圣遗物「${row.name_zh}」？`)) return
    await query('DELETE FROM artifacts WHERE id = ?', [row.id])
    loadData()
  }

  const filtered = artifacts.filter(a =>
    !search || a.name_zh.includes(search) || (a.name_en || '').toLowerCase().includes(search.toLowerCase())
  )

  const columns = [
    { key: 'image', label: '', width: '56px', render: row => <ArtThumb filename={row.flower_image || row.image || row.circlet_image} /> },
    { key: 'id', label: 'ID', width: '50px',
      render: row => <span className="text-surface-500 font-mono text-xs">{row.id}</span> },
    { key: 'max_rarity', label: '稀有度', width: '70px',
      render: row => <span className={RARITY_COLOR[row.max_rarity] || 'text-amber-400'}>{'★'.repeat(row.max_rarity || 5)}</span>,
      filterType: 'select', filterOptions: [3, 4, 5], filterLabel: v => '★'.repeat(v) },
    { key: 'name_zh', label: '名称', width: '160px',
      render: row => <span className="font-medium text-white hover:text-primary-400 cursor-pointer transition-colors" onClick={e => { e.stopPropagation(); navigateToDetail(row.id) }}>{row.name_zh}</span>,
      filterType: 'text' },
    { key: 'two_piece_bonus', label: '2件套', render: row => <span className="text-xs text-surface-400 whitespace-normal">{row.two_piece_bonus || '-'}</span> },
    { key: 'four_piece_bonus', label: '4件套', render: row => <span className="text-xs text-surface-400 whitespace-normal">{row.four_piece_bonus || '-'}</span> },
    { key: 'pieces', label: '部件', render: row => (
      <span className="text-xs text-surface-500">
        {[row.flower_name_zh, row.plume_name_zh, row.sands_name_zh, row.goblet_name_zh, row.circlet_name_zh].filter(Boolean).join(' / ') || '-'}
      </span>
    )},
  ]

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div><h1 className="text-lg font-semibold tracking-tight">圣遗物</h1><p className="text-xs text-surface-500 mt-0.5">{filtered.length} 条记录</p></div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-lg bg-surface-800 border border-surface-700 p-0.5">
            <button onClick={() => setViewMode('table')} className={`p-1.5 rounded-md transition-colors ${viewMode === 'table' ? 'bg-surface-700 text-white' : 'text-surface-400 hover:text-surface-200'}`}><LayoutList className="w-3.5 h-3.5" /></button>
            <button onClick={() => setViewMode('gallery')} className={`p-1.5 rounded-md transition-colors ${viewMode === 'gallery' ? 'bg-surface-700 text-white' : 'text-surface-400 hover:text-surface-200'}`}><LayoutGrid className="w-3.5 h-3.5" /></button>
          </div>
          <SearchBar value={search} onChange={setSearch} placeholder="搜索圣遗物..." />
          <button onClick={openAdd} className="flex items-center gap-1.5 px-3 py-2 bg-primary-600 hover:bg-primary-500 rounded-lg text-xs font-medium text-white transition-colors"><Plus className="w-3.5 h-3.5" />添加</button>
        </div>
      </div>

      {viewMode === 'table' ? (
        <DataTable title="" columns={columns} data={filtered} onEdit={openEdit} onDelete={handleDelete} onAdd={null} searchBar={null}
          selectable selectedIds={selected} onToggleSelect={toggleSelect} onToggleSelectAll={toggleSelectAll}
          onRowClick={row => navigateToDetail(row.id)} />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-3">
          {filtered.map(a => (
            <div key={a.id} onClick={() => navigateToDetail(a.id)} className="group relative rounded-xl overflow-hidden border border-surface-700 bg-surface-800/50 hover:border-primary-500/50 hover:scale-[1.02] transition-all duration-200 cursor-pointer">
              <div className="aspect-[3/4] bg-surface-700 flex items-center justify-center">
                {(a.flower_image || a.image || a.circlet_image) ? <ArtThumb filename={a.flower_image || a.image || a.circlet_image} large /> : <Gem className="w-10 h-10 text-surface-500" />}
              </div>
              <div className="p-3">
                <p className="text-xs font-semibold text-white truncate">{a.name_zh}</p>
                <p className={`text-[10px] ${RARITY_COLOR[a.max_rarity] || 'text-amber-400'}`}>{'★'.repeat(a.max_rarity || 5)}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <EditModal isOpen={modalOpen} onClose={() => setModalOpen(false)} onSave={handleSave} title={editing ? `编辑圣遗物 - ${editing.name_zh}` : '添加圣遗物'}>
        <div className="grid grid-cols-2 gap-x-6">
          <FormInput label="ID" value={form.id ?? 0} onChange={v => setForm({ ...form, id: v === '' ? 0 : Number(v) })} type="number" />
          <FormInput label="中文名" value={form.name_zh} onChange={v => setForm({ ...form, name_zh: v })} />
          <FormInput label="英文名" value={form.name_en} onChange={v => setForm({ ...form, name_en: v })} />
          <FormInput label="最高稀有度" value={form.max_rarity} onChange={v => setForm({ ...form, max_rarity: Number(v) })} type="number" />
        </div>
        <FormInput label="简介（生之花）" value={form.description_zh} onChange={v => setForm({ ...form, description_zh: v })} multiline />
        <FormInput label="介绍（死之羽）" value={form.plume_description_zh} onChange={v => setForm({ ...form, plume_description_zh: v })} multiline />
        <FormInput label="介绍（时之沙）" value={form.sands_description_zh} onChange={v => setForm({ ...form, sands_description_zh: v })} multiline />
        <FormInput label="介绍（空之杯）" value={form.goblet_description_zh} onChange={v => setForm({ ...form, goblet_description_zh: v })} multiline />
        <FormInput label="介绍（理之冠）" value={form.circlet_description_zh} onChange={v => setForm({ ...form, circlet_description_zh: v })} multiline />
        <div className="grid grid-cols-2 gap-x-6">
          <FormInput label="生之花" value={form.flower_name_zh} onChange={v => setForm({ ...form, flower_name_zh: v })} />
          <FormInput label="死之羽" value={form.plume_name_zh} onChange={v => setForm({ ...form, plume_name_zh: v })} />
          <FormInput label="时之沙" value={form.sands_name_zh} onChange={v => setForm({ ...form, sands_name_zh: v })} />
          <FormInput label="空之杯" value={form.goblet_name_zh} onChange={v => setForm({ ...form, goblet_name_zh: v })} />
          <FormInput label="理之冠" value={form.circlet_name_zh} onChange={v => setForm({ ...form, circlet_name_zh: v })} />
        </div>
        <FormInput label="2件套效果" value={form.two_piece_bonus} onChange={v => setForm({ ...form, two_piece_bonus: v })} multiline />
        <FormInput label="4件套效果" value={form.four_piece_bonus} onChange={v => setForm({ ...form, four_piece_bonus: v })} multiline />
        <FormInput label="故事（生之花）" value={form.story_zh} onChange={v => setForm({ ...form, story_zh: v })} multiline />
        <FormInput label="故事（死之羽）" value={form.plume_story_zh} onChange={v => setForm({ ...form, plume_story_zh: v })} multiline />
        <FormInput label="故事（时之沙）" value={form.sands_story_zh} onChange={v => setForm({ ...form, sands_story_zh: v })} multiline />
        <FormInput label="故事（空之杯）" value={form.goblet_story_zh} onChange={v => setForm({ ...form, goblet_story_zh: v })} multiline />
        <FormInput label="故事（理之冠）" value={form.circlet_story_zh} onChange={v => setForm({ ...form, circlet_story_zh: v })} multiline />
        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6">
          <ImagePicker label="生之花图片" currentImage={form.flower_image} onSelect={v => setForm({ ...form, flower_image: v })} onRemove={() => setForm({ ...form, flower_image: null })} />
          <ImagePicker label="死之羽图片" currentImage={form.plume_image} onSelect={v => setForm({ ...form, plume_image: v })} onRemove={() => setForm({ ...form, plume_image: null })} />
          <ImagePicker label="时之沙图片" currentImage={form.sands_image} onSelect={v => setForm({ ...form, sands_image: v })} onRemove={() => setForm({ ...form, sands_image: null })} />
          <ImagePicker label="空之杯图片" currentImage={form.goblet_image} onSelect={v => setForm({ ...form, goblet_image: v })} onRemove={() => setForm({ ...form, goblet_image: null })} />
          <ImagePicker label="理之冠图片" currentImage={form.circlet_image} onSelect={v => setForm({ ...form, circlet_image: v })} onRemove={() => setForm({ ...form, circlet_image: null })} />
        </div>
      </EditModal>
    </div>
  )
}

function ArtThumb({ filename, large }) {
  const [src, setSrc] = useState(null)
  const { readImage } = useDb()
  useEffect(() => {
    let cancelled = false
    async function load() {
      if (filename) { const data = await readImage(filename); if (!cancelled && data) setSrc(data) }
    }
    load(); return () => { cancelled = true }
  }, [filename, readImage])
  if (!src) return large ? <Gem className="w-10 h-10 text-surface-500" /> : <div className="w-10 h-10 rounded bg-surface-700 flex items-center justify-center shrink-0"><Gem className="w-4 h-4 text-surface-500" /></div>
  return <img src={src} alt="" className={large ? 'w-full h-full object-contain' : 'w-10 h-10 rounded object-cover shrink-0'} />
}

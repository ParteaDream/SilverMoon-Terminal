import { useState, useEffect } from 'react'
import { useDb } from '../context/DbContext'
import DataTable from '../components/DataTable'
import SearchBar from '../components/SearchBar'
import EditModal, { FormInput, ImagePicker } from '../components/EditModal'
import { useImageDrag } from '../hooks/useImageDrag'
import { useLazyImage } from '../hooks/useLazyImage'
import { Plus, LayoutList, LayoutGrid, ExternalLink, X } from 'lucide-react'

export default function WebsitesPage() {
  const { query, readImage } = useDb()
  const [websites, setWebsites] = useState([])
  const [search, setSearch] = useState('')
  const [viewMode, setViewMode] = useState('table')
  const [selected, setSelected] = useState(new Set())
  const [multiSelect, setMultiSelect] = useState(false)
  const [activeDetailId, setActiveDetailId] = useState(null)

  // Modal
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)

  useEffect(() => { ensureTable() }, [])

  async function ensureTable() {
    try {
      // 先检查表是否存在，避免每次挂载都走写路径
      const check = await query("SELECT name FROM sqlite_master WHERE type='table' AND name='websites'")
      if (!check.data || check.data.length === 0) {
        await query(`CREATE TABLE IF NOT EXISTS websites (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title_zh TEXT NOT NULL,
          url TEXT NOT NULL,
          description_zh TEXT,
          icon TEXT,
          image TEXT,
          sort_order INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now', 'localtime')),
          updated_at TEXT DEFAULT (datetime('now', 'localtime'))
        )`)
      }
    } catch (_) {}
    loadData()
  }

  async function loadData() {
    const result = await query('SELECT * FROM websites ORDER BY sort_order, id')
    setWebsites(result.data || [])
  }

  function openAdd() {
    setEditing(null)
    const maxOrder = websites.reduce((max, w) => Math.max(max, w.sort_order || 0), 0)
    setForm({ title_zh: '', url: '', description_zh: '', icon: null, image: null, sort_order: maxOrder + 1 })
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
        const keys = Object.keys(form).filter(k => !['id', 'created_at', 'updated_at'].includes(k))
        const sets = keys.map(k => `${k} = ?`).join(', ')
        await query(
          `UPDATE websites SET ${sets}, updated_at = datetime('now', 'localtime') WHERE id = ?`,
          [...keys.map(k => form[k]), editing.id]
        )
      } else {
        const keys = Object.keys(form).filter(k => !['id', 'created_at', 'updated_at'].includes(k))
        await query(
          `INSERT INTO websites (${keys.join(', ')}, created_at, updated_at) VALUES (${keys.map(() => '?').join(', ')}, datetime('now', 'localtime'), datetime('now', 'localtime'))`,
          keys.map(k => form[k])
        )
      }
      setModalOpen(false)
      loadData()
    } catch (e) {
      const msg = e.message || ''
      if (msg.includes('memory access out of bounds') || msg.includes('out of bounds')) {
        if (confirm('站点数据表可能已损坏，是否尝试自动修复？\n（修复将重建 websites 表，如无法读取旧数据则可能丢失）')) {
          try {
            const res = await window.electronAPI?.repairWebsites()
            if (res?.success) {
              let msg = `修复成功，已恢复 ${res.restored} 条记录。`
              if (res.restored === 0) msg += '（旧数据无法恢复）'
              if (res.saveWarning) msg += `\n⚠ 持久化失败: ${res.saveWarning}，请关闭并重启应用以完成修复。`
              alert(msg + '\n请重试保存。')
              loadData()
            } else {
              alert('修复失败: ' + (res?.error || '未知错误') + '\n请尝试关闭应用后重新打开。')
            }
          } catch (rErr) {
            alert('修复异常: ' + (rErr.message || '未知错误'))
          }
        }
      } else {
        alert('保存失败: ' + msg)
      }
    } finally { setSaving(false) }
  }

  function handleRowClick(row) {
    if (multiSelect) return
    setActiveDetailId(prev => prev === row.id ? null : row.id)
  }

  async function handleDelete(row) {
    if (!confirm(`确定删除站点「${row.title_zh}」？`)) return
    await query('DELETE FROM websites WHERE id = ?', [row.id])
    if (activeDetailId === row.id) setActiveDetailId(null)
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
    if (ids.every(id => selected.has(id))) setSelected(new Set())
    else setSelected(new Set(ids))
  }

  async function handleBulkDelete() {
    if (selected.size === 0) return
    if (!confirm(`确定删除选中的 ${selected.size} 个站点？`)) return
    const ids = [...selected]
    await query(`DELETE FROM websites WHERE id IN (${ids.map(() => '?').join(',')})`, ids)
    setSelected(new Set())
    if (activeDetailId && ids.includes(activeDetailId)) setActiveDetailId(null)
    loadData()
  }

  async function handleReorder(fromId, toId, dataList) {
    const list = dataList || websites
    const fromIdx = list.findIndex(w => w.id === fromId)
    const toIdx = list.findIndex(w => w.id === toId)
    if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return
    const reordered = [...list]
    const [moved] = reordered.splice(fromIdx, 1)
    reordered.splice(toIdx, 0, moved)
    try {
      for (let i = 0; i < reordered.length; i++) {
        await query('UPDATE websites SET sort_order = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?', [i, reordered[i].id])
      }
      loadData()
    } catch (e) {
      console.error('Failed to reorder:', e)
    }
  }

  const filtered = websites.filter(w => {
    if (!search) return true
    const s = search.toLowerCase()
    return w.title_zh?.toLowerCase().includes(s) ||
      w.url?.toLowerCase().includes(s) ||
      w.description_zh?.toLowerCase().includes(s)
  })

  // ── Icon preview component ──
  function IconCell({ filename }) {
    const [src, setSrc] = useState(null)
    useEffect(() => {
      if (!filename) return
      readImage(filename).then(data => { if (data) setSrc(data) })
    }, [filename])
    if (!src) return <div className="w-8 h-8 rounded bg-surface-700 flex-shrink-0" />
    return <img src={src} alt="" className="w-8 h-8 rounded object-cover flex-shrink-0" />
  }

  // ── Gallery card ──
  function GalleryCard({ website }) {
    const { ref, src } = useLazyImage(website.image, '300px')
    const handleDrag = useImageDrag(website.image)
    return (
      <div
        className="rounded-xl bg-surface-800/50 border border-surface-700 hover:border-surface-600 transition-colors overflow-hidden group cursor-pointer"
        onClick={() => handleRowClick(website)}
        onDoubleClick={() => { if (!multiSelect) openEdit(website) }}
      >
        <div ref={ref} className="bg-surface-800 flex items-center justify-center overflow-hidden" style={{ minHeight: '200px' }}>
          {src ? (
            <img src={src} alt="" className="w-full object-contain group-hover:scale-105 transition-transform duration-300" style={{ maxHeight: '400px' }} draggable onDragStart={handleDrag} />
          ) : (
            <ExternalLink className="w-8 h-8 text-surface-500 my-8" />
          )}
        </div>
        <div className="p-3">
          <p className="text-sm font-medium text-surface-200 truncate">{website.title_zh}</p>
          {website.url && (
            <p className="text-[10px] text-surface-500 mt-0.5 truncate">{website.url}</p>
          )}
        </div>
      </div>
    )
  }

  const activeDetail = activeDetailId ? websites.find(w => w.id === activeDetailId) : null

  return (
    <div className="p-6 flex gap-4 h-[calc(100vh-60px)]">
      {/* Left: list / gallery */}
      <div className={`${activeDetail ? 'flex-1 min-w-[340px]' : 'flex-1'} overflow-auto`}>
      {/* List view */}
      {viewMode === 'table' && (() => {
        // 右侧详情栏打开时隐藏地址列
        const tableColumns = activeDetailId
          ? [
              { key: 'icon', label: '图标', width: '56px', render: row => <IconCell filename={row.icon} /> },
              { key: 'title_zh', label: '标题', render: row => <span className="font-medium text-white text-sm">{row.title_zh}</span> },
              { key: 'description_zh', label: '描述', render: row => <span className="text-xs text-surface-400 line-clamp-2 max-w-xl">{row.description_zh || '-'}</span> },
            ]
          : [
              { key: 'icon', label: '图标', width: '56px', render: row => <IconCell filename={row.icon} /> },
              { key: 'title_zh', label: '标题', render: row => <span className="font-medium text-white text-sm">{row.title_zh}</span> },
              {
                key: 'url', label: '地址',
                render: row => row.url ? (
                  <a href="#"
                    className="text-xs text-primary-400 hover:text-primary-300 hover:underline flex items-center gap-1"
                    onClick={e => { e.stopPropagation(); window.electronAPI?.openExternal(row.url); }}
                  >
                    {row.url} <ExternalLink className="w-3 h-3" />
                  </a>
                ) : <span className="text-xs text-surface-500">-</span>,
              },
              { key: 'description_zh', label: '描述', render: row => <span className="text-xs text-surface-400 line-clamp-2 max-w-xl">{row.description_zh || '-'}</span> },
            ]
        return (
        <DataTable
          title="站点"
          columns={tableColumns}
          data={filtered}
          onEdit={openEdit}
          onDelete={handleDelete}
          onAdd={openAdd}
          onRowClick={handleRowClick}
          onRowReorder={handleReorder}
          selectable={multiSelect}
          selectedIds={selected}
          onToggleSelect={toggleSelect}
          onToggleSelectAll={toggleSelectAll}
          onBulkDelete={handleBulkDelete}
          searchBar={
            <div className="flex items-center gap-2">
              {/* View toggle */}
              <div className="flex items-center rounded-lg bg-surface-800 border border-surface-700 p-0.5">
                <button onClick={() => setViewMode('table')} className={`p-1.5 rounded-md transition-colors ${viewMode === 'table' ? 'bg-surface-700 text-white' : 'text-surface-400 hover:text-surface-200'}`} title="列表视图"><LayoutList className="w-3.5 h-3.5" /></button>
                <button onClick={() => setViewMode('gallery')} className={`p-1.5 rounded-md transition-colors ${viewMode === 'gallery' ? 'bg-surface-700 text-white' : 'text-surface-400 hover:text-surface-200'}`} title="画廊视图"><LayoutGrid className="w-3.5 h-3.5" /></button>
              </div>
              {/* Multi-select */}
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <div className={`relative w-8 h-4 rounded-full transition-colors ${multiSelect ? 'bg-primary-500' : 'bg-surface-600'}`}
                  onClick={() => { setMultiSelect(!multiSelect); if (multiSelect) setSelected(new Set()) }}
                >
                  <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${multiSelect ? 'translate-x-[16px]' : 'translate-x-0.5'}`} />
                </div>
                <span className="text-[10px] text-surface-500">多选</span>
              </label>
              <SearchBar value={search} onChange={setSearch} placeholder="搜索标题/地址..." />
            </div>
          }
        />
      )})()}

      {/* Gallery view */}
      {viewMode === 'gallery' && (
        <>
          <div className="flex items-center justify-between mb-3">
            <div>
              <h1 className="text-lg font-semibold tracking-tight">站点</h1>
              <p className="text-xs text-surface-500 mt-0.5">{filtered.length} 条记录</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center rounded-lg bg-surface-800 border border-surface-700 p-0.5">
                <button onClick={() => setViewMode('table')} className={`p-1.5 rounded-md transition-colors ${viewMode === 'table' ? 'bg-surface-700 text-white' : 'text-surface-400 hover:text-surface-200'}`} title="列表视图"><LayoutList className="w-3.5 h-3.5" /></button>
                <button onClick={() => setViewMode('gallery')} className={`p-1.5 rounded-md transition-colors ${viewMode === 'gallery' ? 'bg-surface-700 text-white' : 'text-surface-400 hover:text-surface-200'}`} title="画廊视图"><LayoutGrid className="w-3.5 h-3.5" /></button>
              </div>
              <SearchBar value={search} onChange={setSearch} placeholder="搜索标题/地址..." />
              <button onClick={openAdd} className="flex items-center gap-1.5 px-3 py-2 bg-primary-600 hover:bg-primary-500 rounded-lg text-xs font-medium text-white transition-colors">
                <Plus className="w-3.5 h-3.5" />添加
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 animate-fade-in">
            {filtered.map((w, i) => (
              <div key={w.id}
                draggable
                onDragStart={e => { e.dataTransfer.setData('text/plain', String(w.id)); e.dataTransfer.effectAllowed = 'move'; }}
                onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                onDrop={e => { e.preventDefault(); const fromId = parseInt(e.dataTransfer.getData('text/plain'), 10); handleReorder(fromId, w.id, filtered); }}
              ><GalleryCard website={w} /></div>
            ))}
            {filtered.length === 0 && (
              <div className="col-span-full py-16 text-center text-surface-500 text-sm">暂无站点数据</div>
            )}
          </div>
        </>
      )}
      </div>

      {/* Right: detail panel */}
      {activeDetail && (
        <div className="w-[50vw] max-w-[720px] min-w-[420px] overflow-y-auto bg-surface-900 rounded-xl border border-surface-700 flex-shrink-0 animate-slide-up">
          <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-3 bg-surface-900/95 backdrop-blur-sm border-b border-surface-700 rounded-t-xl">
            <div className="flex items-center gap-2 min-w-0">
              <h3 className="text-base font-semibold text-white truncate">{activeDetail.title_zh}</h3>
              {activeDetail.url && (
                <a href="#"
                  className="text-xs text-primary-400 hover:text-primary-300 flex items-center gap-1 flex-shrink-0"
                  onClick={e => { e.preventDefault(); window.electronAPI?.openExternal(activeDetail.url); }}
                >
                  <ExternalLink className="w-3 h-3" />打开
                </a>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => openEdit(activeDetail)} className="text-xs text-primary-400 hover:text-primary-300 transition-colors px-2 py-1">编辑</button>
              <button onClick={() => setActiveDetailId(null)} className="p-1.5 rounded-lg text-surface-400 hover:text-white hover:bg-surface-700 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="px-5 py-4 space-y-4">
            {activeDetail.image && (
              <WebsiteDetailImage filename={activeDetail.image} />
            )}
            {activeDetail.description_zh && (
              <p className="text-sm text-surface-300 leading-relaxed whitespace-pre-wrap">{activeDetail.description_zh}</p>
            )}
            {!activeDetail.description_zh && !activeDetail.image && (
              <p className="text-surface-500 text-sm">暂无详细信息</p>
            )}
            <div className="pt-3 border-t border-surface-700 text-xs text-surface-500">
              更新时间：{activeDetail.updated_at || '-'}
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      <EditModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSave={handleSave}
        saving={saving}
        title={editing ? `编辑站点 - ${editing.title_zh}` : '添加站点'}
      >
        <FormInput label="标题" value={form.title_zh || ''} onChange={v => setForm({ ...form, title_zh: v })} />
        <FormInput label="地址 (URL)" value={form.url || ''} onChange={v => setForm({ ...form, url: v })} placeholder="https://..." />
        <ImagePicker label="图标" currentImage={form.icon} onSelect={v => setForm({ ...form, icon: v })} onRemove={() => setForm({ ...form, icon: null })} />
        <ImagePicker label="站点图片" currentImage={form.image} onSelect={v => setForm({ ...form, image: v })} onRemove={() => setForm({ ...form, image: null })} />
        <FormInput label="描述" value={form.description_zh || ''} onChange={v => setForm({ ...form, description_zh: v })} multiline />
      </EditModal>
    </div>
  )
}

function WebsiteDetailImage({ filename }) {
  const { readImage } = useDb()
  const [src, setSrc] = useState(null)
  const handleDrag = useImageDrag(filename)
  useEffect(() => {
    if (!filename) return
    readImage(filename).then(data => { if (data) setSrc(data) })
  }, [filename])
  if (!src) return <div className="w-full h-48 rounded-lg bg-surface-800 animate-pulse" />
  return <img src={src} alt="" className="w-full rounded-lg object-contain border border-surface-700" style={{ maxHeight: '400px' }} draggable onDragStart={handleDrag} />
}

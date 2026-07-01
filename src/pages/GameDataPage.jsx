import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useDb } from '../context/DbContext'
import { useNav } from '../context/NavContext'
import DataTable from '../components/DataTable'
import SearchBar from '../components/SearchBar'
import EditModal, { FormInput } from '../components/EditModal'
import { useImageDrag } from '../hooks/useImageDrag'
import TableEditor from '../components/TableEditor'
import ColoredText from '../components/ColoredText'
import { X, ImagePlus } from 'lucide-react'
import { stripFormatting } from '../utils/colorMarkup'
import { useTypeColor } from '../hooks/useTypeColor'

const CATEGORIES = {
  damage_formula: '计算公式',
  reaction: '元素反应',
  stat: '游戏机制',
}

// ── 分类标签组件（自动根据名称从主题色派生颜色）──
function CategoryTag({ category }) {
  const { bg, text } = useTypeColor(category || '')
  return (
    <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: `rgb(${bg})`, color: `rgb(${text})` }}>
      {CATEGORIES[category] || category}
    </span>
  )
}

// ── 多图选择器 ──
function MultiImagePicker({ label, images, onChange }) {
  const { importImage, readImage, imagesDir } = useDb()
  const [previews, setPreviews] = useState({})

  // 加载所有图片预览
  useEffect(() => {
    if (!images || images.length === 0) { setPreviews({}); return }
    let cancelled = false
    async function load() {
      const map = {}
      for (const fn of images) {
        if (!fn) continue
        try {
          const data = await readImage(fn)
          if (!cancelled && data) map[fn] = data
        } catch (_) { /* skip */ }
      }
      if (!cancelled) setPreviews(map)
    }
    load()
    return () => { cancelled = true }
  }, [images, imagesDir])

  async function handleAdd() {
    const filename = await importImage()
    if (filename) {
      onChange([...(images || []), filename])
    }
  }

  function handleRemove(index) {
    const next = [...(images || [])]
    next.splice(index, 1)
    onChange(next)
  }

  return (
    <div className="mb-4">
      <label className="block text-xs font-medium text-surface-400 mb-1.5">{label}</label>
      <div className="flex flex-wrap items-center gap-2">
        {(images || []).map((fn, i) => (
          <div key={i} className="relative w-20 h-20 rounded-lg overflow-hidden bg-surface-800 border border-surface-600 flex-shrink-0 group">
            {previews[fn] ? (
              <img src={previews[fn]} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-surface-500 text-[10px]">{fn}</div>
            )}
            <button
              onClick={() => handleRemove(i)}
              className="absolute top-1 right-1 p-1 rounded bg-black/60 text-white/80 hover:bg-black/80 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}
        <button
          onClick={handleAdd}
          className="w-20 h-20 rounded-lg border border-dashed border-surface-600 bg-surface-800 flex items-center justify-center
                     hover:border-primary-500/50 hover:bg-primary-500/5 transition-colors flex-shrink-0"
          title="添加图片"
        >
          <ImagePlus className="w-5 h-5 text-surface-500" />
        </button>
        {(images || []).length === 0 && (
          <span className="text-xs text-surface-500">点击添加图片</span>
        )}
      </div>
    </div>
  )
}

// ── 分类输入框（始终显示全部词条的下拉 + 自由输入）──
function CategoryInput({ label, value, onChange, existingCategories }) {
  const [open, setOpen] = useState(false)
  const [dropdownStyle, setDropdownStyle] = useState({})
  const inputRef = useRef(null)

  function recalcPosition() {
    if (inputRef.current) {
      const rect = inputRef.current.getBoundingClientRect()
      setDropdownStyle({ top: rect.bottom + 4, left: rect.left, width: rect.width })
    }
  }

  function openDropdown() {
    recalcPosition()
    setOpen(true)
  }

  // 监听滚动：下拉打开时跟随输入框位置
  useEffect(() => {
    if (!open) return
    // 找到最近的滚动祖先
    let el = inputRef.current?.parentElement
    while (el) {
      const style = window.getComputedStyle(el)
      if (style.overflowY === 'auto' || style.overflowY === 'scroll' || style.overflow === 'auto' || style.overflow === 'scroll') {
        el.addEventListener('scroll', recalcPosition, { passive: true })
        break
      }
      el = el.parentElement
    }
    window.addEventListener('scroll', recalcPosition, { passive: true })
    window.addEventListener('resize', recalcPosition)

    return () => {
      window.removeEventListener('scroll', recalcPosition)
      window.removeEventListener('resize', recalcPosition)
      // 清理滚动祖先监听（简化：遍历所有父级移除）
      let node = inputRef.current?.parentElement
      while (node) {
        node.removeEventListener('scroll', recalcPosition)
        node = node.parentElement
      }
    }
  }, [open])

  function select(cat) {
    onChange(cat.value)
    setOpen(false)
  }

  return (
    <div className="mb-4">
      <label className="block text-xs font-medium text-surface-400 mb-1.5">{label}</label>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={value || ''}
          onChange={e => { onChange(e.target.value); if (!open) openDropdown() }}
          onFocus={openDropdown}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="输入或选择分类..."
          className="w-full px-3 py-2 bg-surface-800 border border-surface-600 rounded-lg
                     text-sm text-white placeholder-surface-500
                     focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500/20
                     transition-colors"
        />
      </div>
      {open && (() => {
        const dropdown = (
          <div
            className="fixed z-[100] max-h-56 overflow-y-auto bg-surface-800 border border-surface-600 rounded-lg shadow-2xl"
            style={{ top: dropdownStyle.top, left: dropdownStyle.left, width: dropdownStyle.width }}
          >
            {existingCategories.length > 0 ? existingCategories.map(cat => (
              <div
                key={cat.value}
                onMouseDown={() => select(cat)}
                className={`px-3 py-2 text-sm cursor-pointer hover:bg-primary-500/10 transition-colors
                  ${cat.value === value ? 'text-primary-400 bg-primary-500/5' : 'text-surface-300'}`}
              >
                {cat.label}
              </div>
            )) : (
              <div className="px-3 py-2 text-sm text-surface-500">暂无分类</div>
            )}
          </div>
        )
        return createPortal(dropdown, document.body)
      })()}
    </div>
  )
}

export default function GameDataPage() {
  const { query, devMode } = useDb()
  const { restorePage, savePage, consumeBackToList } = useNav()
  const restoringScroll = useRef(false)
  const [data, setData] = useState([])
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({})
  const [selected, setSelected] = useState(new Set())
  const [saving, setSaving] = useState(false)
  const [multiSelect, setMultiSelect] = useState(false)      // 多选模式开关
  const [activeDetailId, setActiveDetailId] = useState(null)  // 右侧详情面板当前条目 ID


  async function loadData() {
    const result = await query('SELECT * FROM game_data ORDER BY category DESC, title_zh DESC')
    setData(result.data || [])
  }

  // 提取所有已有分类（用于 datalist，合并预定义分类 + 数据库中已有的）
  // 动态分类列表：只包含数据库中实际有数据的分类（用于筛选下拉）
  const activeCategories = [...new Set(data.map(d => d.category).filter(Boolean))]

  // 全部分类词条（用于编辑弹窗下拉，纯数据驱动）
  const existingCategories = [...new Set(data.map(d => d.category).filter(Boolean))]
    .map(c => ({ value: c, label: CATEGORIES[c] ? `${CATEGORIES[c]} (${c})` : c }))

  function openAdd() {
    setEditing(null)
    setForm({ category: '', sort_order: 0, images: [], tables: [] })
    setModalOpen(true)
  }

  function openEdit(row) {
    const { _preview, ...clean } = row  // 移除 _preview 等虚拟字段
    // 解析 images JSON
    let parsedImages = clean.images
    if (typeof clean.images === 'string') {
      try { parsedImages = JSON.parse(clean.images) } catch (_) { parsedImages = [] }
    }
    if (!Array.isArray(parsedImages)) parsedImages = []
    // 解析 tables JSON
    let parsedTables = clean.tables
    if (typeof clean.tables === 'string') {
      try { parsedTables = JSON.parse(clean.tables) } catch (_) { parsedTables = [] }
    }
    if (!Array.isArray(parsedTables)) parsedTables = []
    setEditing(row)
    setForm({ ...clean, images: parsedImages, tables: parsedTables })
    setModalOpen(true)
  }

  async function handleSave() {
    if (saving) return
    setSaving(true)
    try {
      // 将 images / tables 数组序列化为 JSON 字符串
      const dbForm = { ...form }
      if (Array.isArray(dbForm.images)) {
        dbForm.images = JSON.stringify(dbForm.images)
      }
      if (Array.isArray(dbForm.tables)) {
        dbForm.tables = JSON.stringify(dbForm.tables)
      }

      if (editing) {
        const keys = Object.keys(dbForm).filter(k => !['id', '_preview', 'updated_at', 'created_at'].includes(k))
        const sets = keys.map(k => `${k} = ?`).join(', ')
        await query(
          `UPDATE game_data SET ${sets}, updated_at = datetime('now', 'localtime') WHERE id = ?`,
          [...keys.map(k => dbForm[k]), editing.id]
        )
      } else {
        const keys = Object.keys(dbForm).filter(k => !['_preview', 'updated_at', 'created_at'].includes(k))
        await query(
          `INSERT INTO game_data (${keys.join(', ')}, created_at, updated_at) VALUES (${keys.map(() => '?').join(', ')}, datetime('now', 'localtime'), datetime('now', 'localtime'))`,
          keys.map(k => dbForm[k])
        )
      }
      setModalOpen(false)
      loadData()
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(row) {
    if (!confirm(`确定删除数据条目「${row.title_zh}」？`)) return
    await query('DELETE FROM game_data WHERE id = ?', [row.id])
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
    if (ids.every(id => selected.has(id))) {
      setSelected(new Set())
    } else {
      setSelected(new Set(ids))
    }
  }

  async function handleBulkDelete() {
    if (selected.size === 0) return
    if (!confirm(`确定删除选中的 ${selected.size} 条数据？此操作不可撤销。`)) return
    const ids = [...selected]
    await query(`DELETE FROM game_data WHERE id IN (${ids.map(() => '?').join(',')})`, ids)
    setSelected(new Set())
    if (activeDetailId && ids.includes(activeDetailId)) setActiveDetailId(null)
    loadData()
  }

  async function handleClearAll() {
    if (data.length === 0) return
    if (!confirm(`确定清空全部 ${data.length} 条数据？此操作不可撤销。`)) return
    await query('DELETE FROM game_data')
    setActiveDetailId(null)
    loadData()
  }

  const filtered = data.filter(d => {
    if (categoryFilter && d.category !== categoryFilter) return false
    if (search && !d.title_zh.includes(search) && !d.content.includes(search)) return false
    return true
  })

  // 点击某行 → 右侧打开/关闭详情面板
  function handleRowClick(row) {
    if (multiSelect) return  // 多选模式下不触发行点击
    setActiveDetailId(prev => prev === row.id ? null : row.id)
  }

  // Rows with preview
  const rows = filtered.map(item => ({
    ...item,
    _preview: stripFormatting((item.content || '').slice(0, 200)),
  }))

  // ── 状态持久化（参考武器板块）──
  useEffect(() => {
    const isBack = consumeBackToList()
    if (isBack) {
      loadData()
      restoringScroll.current = true
      restorePage('gamedata').then(saved => {
        if (saved?.scrollY != null && saved.scrollY > 0) {
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
      timer = setTimeout(() => savePage('gamedata'), 200)
    }
    main.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      main.removeEventListener('scroll', onScroll)
      clearTimeout(timer)
    }
  }, [savePage])

  return (
    <div className="p-6 flex gap-4 h-full">
      {/* ═══ 左侧：表格区 ═══ */}
      <div className={`${activeDetailId ? 'flex-1 min-w-[340px]' : 'flex-1'} overflow-auto`}>
        {/* 多选开关 */}
        <div className="flex items-center gap-3 mb-3">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <div className={`relative w-9 h-5 rounded-full transition-colors ${multiSelect ? 'bg-primary-500' : 'bg-surface-600'}`}
              onClick={() => { setMultiSelect(!multiSelect); if (multiSelect) setSelected(new Set()) }}
            >
              <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${multiSelect ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
            </div>
            <span className="text-xs text-surface-400">多选模式</span>
          </label>
          {multiSelect && selected.size > 0 && (
            <button
              onClick={handleBulkDelete}
              className="flex items-center gap-1 px-3 py-1.5 bg-red-600 hover:bg-red-500 rounded-lg text-xs font-medium text-white transition-colors"
            >
              删除 ({selected.size})
            </button>
          )}
          {devMode && data.length > 0 && (
            <button
              onClick={handleClearAll}
              className="flex items-center gap-1 px-3 py-1.5 bg-red-600/20 hover:bg-red-600/40 border border-red-500/30 rounded-lg text-xs text-red-400 hover:text-red-300 transition-colors"
            >
              清空全部
            </button>
          )}
        </div>

        <DataTable
          title="游戏数据"
          columns={[
            {
              key: 'category', label: '分类', width: '110px',
              render: row => <CategoryTag category={row.category} />,
            },
            {
              key: 'title_zh', label: '标题',
              render: row => <span className="font-medium text-white text-sm">{row.title_zh}</span>,
            },
            ...(!activeDetailId ? [
              {
                key: 'content', label: '内容预览',
                render: row => (
                  <span className="text-xs text-surface-400 line-clamp-2 max-w-xl">{row._preview || '-'}</span>
                ),
              },
              {
                key: 'updated_at', label: '更新时间', width: '150px',
                render: row => <span className="text-xs text-surface-500">{row.updated_at || '-'}</span>,
              },
            ] : []),
          ]}
          data={rows}
          onEdit={openEdit}
          onDelete={handleDelete}
          onAdd={openAdd}
          onRowClick={handleRowClick}
          selectable={multiSelect}
          selectedIds={selected}
          onToggleSelect={toggleSelect}
          onToggleSelectAll={toggleSelectAll}
          searchBar={
            <div className="flex items-center gap-2">
              <select
                value={categoryFilter}
                onChange={e => setCategoryFilter(e.target.value)}
                className="px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-xs text-surface-300
                           focus:outline-none focus:border-primary-500 transition-colors"
              >
                <option value="">全部分类</option>
                {activeCategories.map(cat => (
                  <option key={cat} value={cat}>{CATEGORIES[cat] || cat}</option>
                ))}
              </select>
              <SearchBar value={search} onChange={setSearch} placeholder="搜索数据..." />
            </div>
          }
        />
      </div>

      {/* ═══ 右侧：详情面板 ═══ */}
      {activeDetailId && (() => {
        const activeDetail = data.find(d => d.id === activeDetailId)
        if (!activeDetail) return null
        return (
        <div className="w-[50vw] max-w-[720px] min-w-[420px] overflow-y-auto bg-surface-900 rounded-xl border border-surface-700 flex-shrink-0 animate-slide-up">
          {/* 关闭按钮 */}
          <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-3 bg-surface-900/95 backdrop-blur-sm border-b border-surface-700 rounded-t-xl">
            <div className="flex items-center gap-2">
              <CategoryTag category={activeDetail.category} />
              <h3 className="text-base font-semibold text-white">{activeDetail.title_zh}</h3>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => openEdit(activeDetail)}
                className="text-xs text-primary-400 hover:text-primary-300 transition-colors px-2 py-1"
              >
                编辑
              </button>
              <button
                onClick={() => setActiveDetailId(null)}
                className="p-1.5 rounded-lg text-surface-400 hover:text-white hover:bg-surface-700 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* 详情内容 */}
          <div className="px-5 py-4">
            {/* 图片展示 */}
            {(() => {
              let imgs = activeDetail.images
              if (typeof imgs === 'string') {
                try { imgs = JSON.parse(imgs) } catch (_) { imgs = [] }
              }
              if (Array.isArray(imgs) && imgs.length > 0) {
                return (
                  <div className="flex flex-wrap gap-2 mb-4">
                    {imgs.map((fn) => (
                      <DetailImage key={fn} filename={fn} />
                    ))}
                  </div>
                )
              }
              return null
            })()}

            {/* 标签 */}
            {(() => {
              let tags = activeDetail.tags
              if (typeof tags === 'string') {
                try { tags = JSON.parse(tags) } catch (_) { tags = [] }
              }
              if (Array.isArray(tags) && tags.length > 0) {
                return (
                  <div className="flex flex-wrap gap-1.5 mb-4">
                    {tags.map((t, i) => (
                      <span key={i} className="text-xs px-2 py-0.5 rounded bg-primary-500/10 text-primary-300 border border-primary-500/20">
                        {t}
                      </span>
                    ))}
                  </div>
                )
              }
              return null
            })()}

            <div className="prose prose-invert prose-sm max-w-none text-surface-300">
              {renderMarkdown(activeDetail.content)}
            </div>

            {/* 数据表格 */}
            {(() => {
              let tbls = activeDetail.tables
              if (typeof tbls === 'string') {
                try { tbls = JSON.parse(tbls) } catch (_) { tbls = [] }
              }
              if (Array.isArray(tbls) && tbls.length > 0) {
                return tbls.map((table, ti) => (
                  <div key={ti} className="mb-4 border border-surface-700 rounded-lg overflow-hidden">
                    {table.title && (
                      <div className="px-3 py-2 bg-surface-800/60 border-b border-surface-700">
                        <span className="text-xs font-medium text-surface-300">{table.title}</span>
                      </div>
                    )}
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        {table.headers && table.headers.length > 0 && (
                          <thead>
                            <tr>
                              {table.headers.map((h, ci) => (
                                <th key={ci} className="px-3 py-2 bg-surface-850 text-[11px] font-medium text-surface-400 text-left border-b border-r border-surface-700 last:border-r-0 whitespace-nowrap">
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                        )}
                        <tbody>
                          {(table.rows || []).map((row, ri) => (
                            <tr key={ri}>
                              {row.map((cell, ci) => (
                                <td key={ci} className="px-3 py-1.5 text-surface-300 border-b border-r border-surface-700/50 last:border-r-0 whitespace-nowrap">
                                  {cell || '-'}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))
              }
              return null
            })()}

            {/* 更新时间 */}
            <div className="mt-6 pt-3 border-t border-surface-700 text-xs text-surface-500">
              更新时间：{activeDetail.updated_at || '-'}
            </div>
          </div>
        </div>
        )
      })()}

      {/* ═══ 编辑弹窗 ═══ */}
      <EditModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSave={handleSave}
        saving={saving}
        title={editing ? `编辑数据 - ${editing.title_zh}` : '添加数据条目'}
        wide
        closeOnBackdrop={false}
      >
        <div className="grid grid-cols-2 gap-x-6">
          <FormInput label="标题" value={form.title_zh} onChange={v => setForm({ ...form, title_zh: v })} />
          <CategoryInput
            label="分类"
            value={form.category}
            onChange={v => setForm({ ...form, category: v })}
            existingCategories={existingCategories}
          />
        </div>
        <FormInput label="内容 (Markdown)" value={form.content} onChange={v => setForm({ ...form, content: v })} multiline />
        <FormInput label={'标签 (JSON 数组，如 ["tag1","tag2"])'} value={form.tags} onChange={v => setForm({ ...form, tags: v })} />
        <MultiImagePicker
          label="图片"
          images={form.images || []}
          onChange={v => setForm({ ...form, images: v })}
        />
        <div className="mb-4">
          <label className="block text-xs font-medium text-surface-400 mb-1.5">数据表格</label>
          <TableEditor
            data={form.tables || []}
            onChange={v => setForm({ ...form, tables: v })}
          />
        </div>
      </EditModal>
    </div>
  )
}

// ── 详情面板中的单张图片加载 ──
function DetailImage({ filename }) {
  const { readImage } = useDb()
  const [src, setSrc] = useState(null)
  const handleDrag = useImageDrag(filename)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const data = await readImage(filename)
      if (!cancelled && data) setSrc(data)
    }
    load()
    return () => { cancelled = true }
  }, [filename])

  if (!src) {
    return <div className="w-32 h-32 rounded-lg bg-surface-800 animate-pulse flex-shrink-0" />
  }

  return (
    <img src={src} alt="" className="w-32 h-32 rounded-lg object-cover border border-surface-600 flex-shrink-0" draggable onDragStart={handleDrag} />
  )
}

// ── Markdown 渲染 ──
function renderMarkdown(content) {
  if (!content) return <p className="text-surface-500">暂无内容</p>

  const lines = content.split('\n')
  const elements = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (line.startsWith('# ')) {
      elements.push(<h1 key={i} className="text-xl font-bold mb-3 mt-5 first:mt-0"><ColoredText text={line.slice(2)} /></h1>)
    } else if (line.startsWith('## ')) {
      elements.push(<h2 key={i} className="text-lg font-semibold mb-2 mt-4"><ColoredText text={line.slice(3)} /></h2>)
    } else if (line.startsWith('### ')) {
      elements.push(<h3 key={i} className="text-base font-semibold mb-2 mt-3"><ColoredText text={line.slice(4)} /></h3>)
    } else if (line.startsWith('- ')) {
      elements.push(<li key={i} className="ml-4 text-sm mb-1 list-disc text-surface-300"><ColoredText text={line.slice(2)} /></li>)
    } else if (line.startsWith('```')) {
      const codeLines = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      elements.push(
        <pre key={i} className="bg-surface-800 p-3 rounded-lg text-xs font-mono text-surface-300 my-2 overflow-x-auto">
          {codeLines.join('\n')}
        </pre>
      )
    } else if (line.trim() === '') {
      elements.push(<div key={i} className="h-2" />)
    } else {
      elements.push(<p key={i} className="text-sm text-surface-300 mb-1"><ColoredText text={line} /></p>)
    }
    i++
  }

  return elements
}

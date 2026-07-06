import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { createPortal } from 'react-dom'
import { useDb } from '../context/DbContext'
import { useNav } from '../context/NavContext'
import { savePageStateSync, loadPageStateSync, flushPageStates } from '../utils/pageStateStore'
import DataTable from '../components/DataTable'
import SearchBar from '../components/SearchBar'
import EditModal, { FormInput } from '../components/EditModal'
import { useImageDrag } from '../hooks/useImageDrag'
import TableEditor from '../components/TableEditor'
import ColoredText from '../components/ColoredText'
import { X, ImagePlus } from 'lucide-react'
import Lightbox from '../components/Lightbox'
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

// ── 关联条目类型映射 ──
const LINK_TYPES = [
  { key: 'game_data', label: '数据', query: (q) => q ? `SELECT id, title_zh AS label, category FROM game_data WHERE title_zh LIKE '%' || ? || '%' ORDER BY category, title_zh LIMIT 100` : `SELECT id, title_zh AS label, category FROM game_data ORDER BY category, title_zh LIMIT 200` },
  { key: 'characters', label: '角色', query: (q) => q ? `SELECT id, name_zh AS label FROM characters WHERE name_zh LIKE '%' || ? || '%' ORDER BY name_zh LIMIT 100` : `SELECT id, name_zh AS label FROM characters ORDER BY name_zh LIMIT 200` },
  { key: 'weapons', label: '武器', query: (q) => q ? `SELECT id, name_zh AS label FROM weapons WHERE name_zh LIKE '%' || ? || '%' ORDER BY name_zh LIMIT 100` : `SELECT id, name_zh AS label FROM weapons ORDER BY name_zh LIMIT 200` },
  { key: 'artifacts', label: '圣遗物', query: (q) => q ? `SELECT id, name_zh AS label FROM artifacts WHERE name_zh LIKE '%' || ? || '%' ORDER BY name_zh LIMIT 100` : `SELECT id, name_zh AS label FROM artifacts ORDER BY name_zh LIMIT 200` },
  { key: 'materials', label: '材料', query: (q) => q ? `SELECT id, name_zh AS label FROM materials WHERE name_zh LIKE '%' || ? || '%' ORDER BY name_zh LIMIT 100` : `SELECT id, name_zh AS label FROM materials ORDER BY name_zh LIMIT 200` },
]

// ── 关联条目搜索/选择模态框 ──
function LinkSearchModal({ onClose, onConfirm, existingLinks }) {
  const { query } = useDb()
  const [tab, setTab] = useState('game_data')
  const [searchText, setSearchText] = useState('')
  const [items, setItems] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [hoveredIndex, setHoveredIndex] = useState(null)

  const existingKeys = new Set((existingLinks || []).map(l => `${l.target_type}:${l.target_id}`))

  useEffect(() => { loadItems() }, [tab])

  async function loadItems() {
    const lt = LINK_TYPES.find(t => t.key === tab)
    if (!lt) return
    const sql = searchText ? lt.query(searchText) : lt.query('')
    const params = searchText ? [searchText] : []
    const res = await query(sql, params)
    setItems(res.data || [])
  }

  function handleSearch(val) {
    setSearchText(val)
    clearTimeout(window._linkSearchTimer)
    window._linkSearchTimer = setTimeout(() => {
      const lt = LINK_TYPES.find(t => t.key === tab)
      if (!lt) return
      const sql = val ? lt.query(val) : lt.query('')
      const params = val ? [val] : []
      query(sql, params).then(res => setItems(res.data || []))
    }, 200)
  }

  function toggleItem(id) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) { next.delete(id) } else { next.add(id) }
      return next
    })
  }

  function handleConfirm() {
    const result = items
      .filter(item => selected.has(item.id) && !existingKeys.has(`${tab}:${item.id}`))
      .map(item => ({ target_type: tab, target_id: item.id, label: item.label }))
    onConfirm(result)
  }

  const filteredItems = items.filter(item => !existingKeys.has(`${tab}:${item.id}`))
  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-surface-900 border border-surface-700 rounded-2xl w-[600px] max-h-[80vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* 标题 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-700">
          <h3 className="text-sm font-semibold text-white">关联条目</h3>
          <button onClick={onClose} className="p-1 rounded-lg text-surface-400 hover:text-white hover:bg-surface-700 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        {/* 类型标签 */}
        <div className="flex gap-1 px-5 pt-3 pb-2 overflow-x-auto">
          {LINK_TYPES.map(t => (
            <button key={t.key} onClick={() => { setTab(t.key); setSearchText(''); setSelected(new Set()) }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${tab === t.key ? 'bg-primary-500/20 text-primary-300 border border-primary-500/30' : 'text-surface-400 hover:text-white hover:bg-surface-700 border border-transparent'}`}>
              {t.label}
            </button>
          ))}
        </div>
        {/* 搜索 */}
        <div className="px-5 py-2">
          <input type="text" value={searchText} onChange={e => handleSearch(e.target.value)}
            placeholder="搜索..." className="w-full px-3 py-2 rounded-lg bg-surface-800 border border-surface-600 text-xs text-surface-200 outline-none focus:border-primary-500/50 transition-colors placeholder-surface-500" />
        </div>
        {/* 条目列表 */}
        <div className="flex-1 overflow-y-auto px-5 py-2 min-h-[200px]">
          {filteredItems.length === 0 ? (
            <div className="py-10 text-center text-surface-500 text-xs">{(searchText ? '未找到匹配结果' : '该类型暂无数据')}</div>
          ) : (
            <div className="grid gap-1">
              {filteredItems.map((item, i) => (
                <div key={item.id}
                  onMouseEnter={() => setHoveredIndex(i)} onMouseLeave={() => setHoveredIndex(null)}
                  onClick={() => toggleItem(item.id)}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors ${selected.has(item.id) ? 'bg-primary-500/15 border border-primary-500/30' : 'hover:bg-surface-800 border border-transparent'}`}>
                  <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${selected.has(item.id) ? 'border-primary-500 bg-primary-500' : 'border-surface-500'}`}>
                    {selected.has(item.id) && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                  </div>
                  <span className="text-xs text-surface-200 flex-1 truncate">{item.label}</span>
                  {item.category && <CategoryTag category={item.category} />}
                </div>
              ))}
            </div>
          )}
        </div>
        {/* 底部按钮 */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-surface-700">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-xs text-surface-400 hover:text-white hover:bg-surface-700 transition-colors">取消</button>
          <button onClick={handleConfirm} className="px-4 py-2 rounded-lg text-xs font-medium bg-primary-500/20 text-primary-300 hover:bg-primary-500/30 border border-primary-500/30 transition-colors">添加 ({selected.size})</button>
        </div>
      </div>
    </div>
  )
}

// ── 关联条目编辑器（编辑弹窗内使用）──
function RelatedLinksEditor({ links, onChange }) {
  const [showSearch, setShowSearch] = useState(false)
  const dragRef = useRef({ dragIndex: -1 })

  function handleRemove(index) {
    const next = [...links]; next.splice(index, 1); onChange(next)
  }

  function handleDragStart(i, e) {
    dragRef.current.dragIndex = i
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(i))
  }

  function handleDragOver(i, e) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  function handleDrop(i, e) {
    e.preventDefault()
    const from = dragRef.current.dragIndex
    if (from === -1 || from === i) return
    const next = [...links]
    const [item] = next.splice(from, 1)
    next.splice(i, 0, item)
    dragRef.current.dragIndex = -1
    onChange(next)
  }

  return (
    <div className="mb-4">
      <label className="block text-xs font-medium text-surface-400 mb-1.5">相关链接（<span className="text-surface-500">拖拽可调整顺序</span>）</label>
      <div className="flex flex-wrap gap-2 mb-2">
        {links.map((link, i) => (
          <div key={`${link.target_type}:${link.target_id}`}
            draggable
            onDragStart={(e) => handleDragStart(i, e)}
            onDragOver={(e) => handleDragOver(i, e)}
            onDrop={(e) => handleDrop(i, e)}
            onDragEnd={() => { dragRef.current.dragIndex = -1 }}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-surface-800 border border-surface-600 group cursor-grab active:cursor-grabbing">
            <span className="text-surface-500 cursor-grab text-[10px] select-none">⠿</span>
            <span className="text-[10px] text-surface-400 uppercase">{LINK_TYPES.find(t => t.key === link.target_type)?.label || link.target_type}</span>
            <span className="text-xs text-surface-200">{link.label}</span>
            <button onClick={() => handleRemove(i)}
              className="p-0.5 rounded text-surface-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>
      <button onClick={() => setShowSearch(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-dashed border-surface-600 text-xs text-surface-400 hover:text-primary-300 hover:border-primary-500/40 hover:bg-primary-500/5 transition-colors">
        + 添加关联
      </button>
      {showSearch && <LinkSearchModal onClose={() => setShowSearch(false)} onConfirm={(newLinks) => { onChange([...links, ...newLinks]); setShowSearch(false) }} existingLinks={links} />}
    </div>
  )
}

// ── 关联条目展示（详情面板底部）──
function RelatedLinksDisplay({ sourceId, sourceType, onBeforeNavigate }) {
  const { query } = useDb()
  const { push } = useNav()
  const [links, setLinks] = useState([])

  useEffect(() => {
    if (!sourceId) return
    query('SELECT * FROM related_links WHERE source_type=? AND source_id=? ORDER BY sort_order', [sourceType || 'game_data', sourceId])
      .then(res => setLinks(res.data || []))
  }, [sourceId, sourceType])

  function handleClick(link) {
    // 跳转前先保存当前页面状态，确保"上一步"能恢复到当前条目
    if (onBeforeNavigate) onBeforeNavigate()
    const targets = {
      game_data: `/data?detail_id=${link.target_id}`,
      characters: `/characters/${link.target_id}`,
      weapons: `/weapons/${link.target_id}`,
      artifacts: `/artifacts/${link.target_id}`,
      materials: `/materials/${link.target_id}`,
    }
    push(targets[link.target_type] || '/')
  }

  if (!links.length) return null
  return (
    <div className="mt-4 pt-3 border-t border-surface-700">
      <div className="text-xs font-medium text-surface-400 mb-2">相关链接</div>
      <div className="flex flex-wrap gap-2">
        {links.map((link, i) => (
          <button key={i} onClick={() => handleClick(link)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-surface-800/60 border border-surface-700 hover:border-primary-500/40 hover:bg-surface-800 transition-colors cursor-pointer">
            <span className="text-[10px] text-primary-400 uppercase">{LINK_TYPES.find(t => t.key === link.target_type)?.label || link.target_type}</span>
            <span className="text-xs text-surface-200">{link.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

export default function GameDataPage() {
  const { query, devMode } = useDb()
  const { restorePage, savePage, consumeBackToList } = useNav()
  const restoringScroll = useRef(false)
  const listScrollRef = useRef(null)  // 左侧数据列表滚动容器
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
  const [lightbox, setLightbox] = useState(null)              // 图片预览
  const [searchParams] = useSearchParams()

  // 从 URL 查询参数打开详情面板（支持从关联链接跳转到指定条目）
  useEffect(() => {
    const detailId = searchParams.get('detail_id')
    if (detailId && data.length > 0) {
      const id = parseInt(detailId, 10)
      if (!isNaN(id) && data.some(d => d.id === id)) {
        setActiveDetailId(id)
      }
    }
  }, [searchParams, data])

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
    setForm({ category: '', sort_order: 0, images: [], tables: [], relatedLinks: [] })
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
    // 异步加载已有关联条目
    query('SELECT * FROM related_links WHERE source_type=? AND source_id=? ORDER BY sort_order', ['game_data', row.id])
      .then(res => setForm(prev => ({ ...prev, relatedLinks: res.data || [] })))
    setEditing(row)
    setForm({ ...clean, images: parsedImages, tables: parsedTables, relatedLinks: [] })
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
        const keys = Object.keys(dbForm).filter(k => !['id', '_preview', 'updated_at', 'created_at', 'relatedLinks'].includes(k))
        const sets = keys.map(k => `${k} = ?`).join(', ')
        await query(
          `UPDATE game_data SET ${sets}, updated_at = datetime('now', 'localtime') WHERE id = ?`,
          [...keys.map(k => dbForm[k]), editing.id]
        )
      } else {
        const keys = Object.keys(dbForm).filter(k => !['_preview', 'updated_at', 'created_at', 'relatedLinks'].includes(k))
        await query(
          `INSERT INTO game_data (${keys.join(', ')}, created_at, updated_at) VALUES (${keys.map(() => '?').join(', ')}, datetime('now', 'localtime'), datetime('now', 'localtime'))`,
          keys.map(k => dbForm[k])
        )
      }
      // 保存关联条目（同时覆盖新增和编辑）
      const linkSourceId = editing ? editing.id : (await query('SELECT MAX(id) as maxId FROM game_data')).data?.[0]?.maxId
      if (linkSourceId) {
        await query('DELETE FROM related_links WHERE source_type=? AND source_id=?', ['game_data', linkSourceId])
        for (let i = 0; i < (form.relatedLinks || []).length; i++) {
          const l = form.relatedLinks[i]
          await query('INSERT INTO related_links (source_type, source_id, target_type, target_id, label, sort_order) VALUES (?,?,?,?,?,?)',
            ['game_data', linkSourceId, l.target_type, l.target_id, l.label, i])
        }
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

  // ── 状态持久化：保存滚轮位置和打开条目状态 ──
  // 上一步/下一步（consumeBackToList）恢复保存状态
  // 侧栏直达打开时不恢复（走 PUSH 导航，consumeBackToList 返回 false）
  useEffect(() => {
    (async () => {
      restoringScroll.current = true
      await loadData()
      const isBack = consumeBackToList()
      if (isBack) {
        // 优先从 sessionStorage 恢复（不会被关联链接跳转后的自动保存覆盖）
        let saved = null
        try {
          const prelinkStr = sessionStorage.getItem('_nav_prelink_gamedata')
          if (prelinkStr) {
            sessionStorage.removeItem('_nav_prelink_gamedata')
            const prelink = JSON.parse(prelinkStr)
            if (prelink && prelink.activeDetailId != null) {
              saved = { scrollY: prelink.scrollY, activeDetailId: prelink.activeDetailId }
            }
          }
        } catch (_) {}
        // 回退到 pageStateStore
        if (!saved) {
          saved = await restorePage('gamedata')
        }
        if (!saved) { restoringScroll.current = false; return }
        if (saved.activeDetailId != null) {
          setActiveDetailId(saved.activeDetailId)
        }
        if (saved.scrollY != null && saved.scrollY > 0) {
          const targetY = Number(saved.scrollY)
          requestAnimationFrame(() => {
            const el = listScrollRef.current
            if (!el) { restoringScroll.current = false; return }
            if (el.scrollHeight > targetY) {
              el.scrollTo(0, targetY)
              setTimeout(() => {
                restoringScroll.current = false
                if (el) el.dispatchEvent(new Event('scroll', { bubbles: true }))
              }, 300)
            } else {
              restoringScroll.current = false
            }
          })
        } else {
          const el = listScrollRef.current
          if (el) el.scrollTo(0, 0)
          restoringScroll.current = false
        }
      } else {
        restoringScroll.current = false
      }
    })()
  }, [])

  // 数据加载完成后，若保存的条目不存在则关闭详情
  useEffect(() => {
    if (activeDetailId != null && data.length > 0) {
      const exists = data.some(d => d.id === activeDetailId)
      if (!exists) setActiveDetailId(null)
    }
  }, [data, activeDetailId])

  // Handle ?detail=ID query param for direct navigation
  useEffect(() => {
    const detailId = searchParams.get('detail')
    if (detailId && data.length > 0) {
      const id = Number(detailId)
      if (!isNaN(id) && data.some(d => d.id === id)) {
        setActiveDetailId(id)
      }
    }
  }, [data, searchParams])

  // 保存滚动位置：直接读取左侧列表的 scrollTop
  useLayoutEffect(() => {
    const el = listScrollRef.current
    if (!el) return
    let timer = null
    const onScroll = () => {
      clearTimeout(timer)
      if (restoringScroll.current) return
      if (!listScrollRef.current) return
      timer = setTimeout(() => {
        savePageStateSync('gamedata', listScrollRef.current.scrollTop, { activeDetailId })
      }, 200)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      clearTimeout(timer)
    }
  }, [savePageStateSync, activeDetailId])

  // activeDetailId 变化时立即触发保存（不限滚动事件）
  useEffect(() => {
    const el = listScrollRef.current
    if (data.length === 0) return
    const scrollY = el ? el.scrollTop : 0
    savePageStateSync('gamedata', scrollY, { activeDetailId })
  }, [activeDetailId, data, savePageStateSync])

  return (
    <div className="pt-6 px-6 pb-0 flex gap-4 h-full min-h-0">
      {/* ═══ 左侧：表格区 ═══ */}
      <div ref={listScrollRef} className={`${activeDetailId ? 'w-[420px] flex-shrink-0' : 'flex-1'} overflow-auto`}>
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
          activeId={activeDetailId}
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
        <div className="flex-1 min-w-[420px] overflow-y-auto bg-surface-900 rounded-xl border border-surface-700 flex-shrink-0 animate-slide-up">
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
                      <DetailImage key={fn} filename={fn} onClick={() => setLightbox({ filename: fn, label: fn })} />
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
            <RelatedLinksDisplay sourceId={activeDetail.id} sourceType="game_data"
              onBeforeNavigate={() => {
                const el = listScrollRef.current
                const scrollY = el ? el.scrollTop : 0
                // 同时保存到 pageStateStore 和 sessionStorage
                // sessionStorage 不会被后续页面的保存覆盖，确保"上一步"能恢复到当前条目
                savePageStateSync('gamedata', scrollY, { activeDetailId })
                try {
                  sessionStorage.setItem('_nav_prelink_gamedata', JSON.stringify({ scrollY, activeDetailId }))
                } catch (_) {}
                flushPageStates()
              }}
            />
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
        <RelatedLinksEditor links={form.relatedLinks || []} onChange={v => setForm({ ...form, relatedLinks: v })} />
      </EditModal>
      {/* 图片预览 */}
      {lightbox && (
        <Lightbox filename={lightbox.filename} label={lightbox.label} onClose={() => setLightbox(null)} />
      )}
    </div>
  )
}

// ── 详情面板中的单张图片加载 ──
function DetailImage({ filename, onClick }) {
  const { readImage } = useDb()
  const [src, setSrc] = useState(null)
  const [natural, setNatural] = useState({ w: 0, h: 0 })
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

  const maxW = 240
  const maxH = 240
  let style = {}
  if (natural.w > 0 && natural.h > 0) {
    const ratio = Math.min(maxW / natural.w, maxH / natural.h, 1)
    style = { width: natural.w * ratio, height: natural.h * ratio }
  } else {
    style = { maxWidth: maxW, maxHeight: maxH }
  }

  return (
    <img
      src={src} alt=""
      style={style}
      className="rounded-lg object-contain border border-surface-600 flex-shrink-0 cursor-pointer hover:border-primary-400/60 hover:scale-105 transition-all"
      draggable onDragStart={handleDrag}
      onClick={onClick}
      onLoad={(e) => {
        const img = e.target
        setNatural({ w: img.naturalWidth, h: img.naturalHeight })
      }}
    />
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

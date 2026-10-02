import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useDb } from '../context/DbContext'
import { useNav } from '../context/NavContext'
import { PageMemoryProvider, usePageMemory } from '../context/PageMemoryContext'
import { useDetailScroll } from '../hooks/useDetailState'
import { useImageDrag } from '../hooks/useImageDrag'
import { ArrowLeft, Edit3, Package, Info, ChevronDown, UtensilsCrossed, Plus, Trash2 } from 'lucide-react'
import EditModal, { FormInput, FormSelect, SearchSelect, ImagePicker } from '../components/EditModal'
import ColoredText from '../components/ColoredText'
import Lightbox from '../components/Lightbox'
import DomainSourceChips from '../components/DomainSourceChips'
import { useDomainSources } from '../utils/domainSources'
import { FOOD_TYPES, RARITY_BG_STYLES } from '../utils/foodMeta'

const MATERIAL_TYPES = {
  character_ascension: '角色突破', weapon_ascension: '武器突破', talent: '天赋书',
  cooking: '食材', local_specialty: '地区特产', common: '通用掉落',
  boss_drop: 'Boss掉落', weekly_boss_drop: '周本掉落', event: '活动材料',
  valuable: '贵重物品',
}

// 数据库中存在中英文混用的 type 值，统一映射为英文 key
const TYPE_CN_TO_EN = {
  '天赋书': 'talent', 'Boss掉落': 'boss_drop', '周本掉落': 'weekly_boss_drop',
  '通用掉落': 'common', '角色突破素材': 'character_ascension',
  '武器突破': 'weapon_ascension', '至冬区域特产': 'local_specialty',
}
function normalizeType(type) {
  return TYPE_CN_TO_EN[type] || type
}

export default function MaterialDetailPage() {
  const { id } = useParams()
  return (
    <PageMemoryProvider pageKey={`material_${id}`}>
      <MaterialDetailContent />
    </PageMemoryProvider>
  )
}

function MaterialDetailContent() {
  const { id } = useParams()
  const { query } = useDb()
  const { backToList, consumeBackToList } = useNav()
  const [material, setMaterial] = useState(null)
  const [loading, setLoading] = useState(true)
  const [editOpen, setEditOpen] = useState(false)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [lightbox, setLightbox] = useState(null)
  // 用到该材料的食物（食物板块的烹饪材料反向关联）
  const [usedByFoods, setUsedByFoods] = useState([])
  const [allFoods, setAllFoods] = useState([])
  const [editUsage, setEditUsage] = useState(null)
  // 炼武秘境关联标点（摹忆中枢变更时自动刷新）
  const domainIndex = useDomainSources()
  useDetailScroll('material', id)

  useEffect(() => { consumeBackToList(); loadAll() }, [id])

  async function loadAll() {
    try {
      const result = await query('SELECT * FROM materials WHERE id = ?', [id])
      if (result.data?.length > 0) {
        const data = { ...result.data[0], type: normalizeType(result.data[0].type) }
        setMaterial(data)
        setForm(data)
      }
      // 反向关联：这道材料被哪些食物用于烹饪（可按「用于烹饪」区块人工增删改）
      try {
        const used = await query(
          `SELECT fm.id, fm.food_id, fm.material_id, fm.quantity, f.name_zh, f.image, f.rarity, f.type
           FROM food_materials fm JOIN foods f ON fm.food_id = f.id
           WHERE fm.material_id = ?
           ORDER BY f.rarity DESC, f.name_zh`, [id]
        )
        // 双库模式下 user.db 新插入的关联行会被"追加"进来（WHERE 只作用于基准库部分），
        // 这里再按 material_id 兜一次
        setUsedByFoods((used.data || []).filter(r => r.material_id == null || Number(r.material_id) === Number(id)))
      } catch (_) { setUsedByFoods([]) }
      try {
        const foods = await query('SELECT id, name_zh, type, rarity, image FROM foods ORDER BY name_zh')
        setAllFoods(foods.data || [])
      } catch (_) { setAllFoods([]) }
    } catch (e) {
      console.error('Failed to load material:', e)
    } finally {
      setLoading(false)
    }
  }

  // ── 用于烹饪：人工增删改 ──
  async function handleSaveUsage() {
    if (!editUsage || !editUsage.food_id) return
    if (editUsage.id) {
      await query('UPDATE food_materials SET food_id = ?, quantity = ? WHERE id = ?',
        [editUsage.food_id, editUsage.quantity || '', editUsage.id])
    } else {
      await query(
        `INSERT INTO food_materials (food_id, material_id, quantity) VALUES (?, ?, ?)
         ON CONFLICT(food_id, material_id) DO UPDATE SET quantity = excluded.quantity`,
        [editUsage.food_id, material.id, editUsage.quantity || '']
      )
    }
    setEditUsage(null)
    await loadAll()
    // 食物板块的列表缓存也要失效，避免回去时还显示旧的材料数
    window.dispatchEvent(new CustomEvent('food-data-changed'))
  }

  async function handleDeleteUsage(row) {
    if (!confirm(`移除「${row.name_zh}」对${material.name_zh}的使用？`)) return
    await query('DELETE FROM food_materials WHERE id = ?', [row.id])
    await loadAll()
    window.dispatchEvent(new CustomEvent('food-data-changed'))
  }

  async function handleSave() {
    if (saving) return
    setSaving(true)
    try {
      const newId = Number(form.id)
      const oldId = material.id
      if (newId !== oldId) {
        const dup = await query('SELECT COUNT(*) as cnt FROM materials WHERE id = ?', [newId])
        if (dup.data?.[0]?.cnt > 0) { alert(`ID ${newId} 已存在，请使用其他 ID`); setSaving(false); return }
        await query('PRAGMA foreign_keys = OFF')
        try {
          await query('UPDATE character_ascension_materials SET material_id = ? WHERE material_id = ?', [newId, oldId])
          await query('UPDATE character_talent_materials SET material_id = ? WHERE material_id = ?', [newId, oldId])
          await query('UPDATE weapon_ascension_materials SET material_id = ? WHERE material_id = ?', [newId, oldId])
          await query('UPDATE food_materials SET material_id = ? WHERE material_id = ?', [newId, oldId])
        } finally {
          await query('PRAGMA foreign_keys = ON')
        }
      }
      const keys = Object.keys(form)
      const sets = keys.map(k => `${k} = ?`).join(', ')
      await query(`UPDATE materials SET ${sets} WHERE id = ?`, [...keys.map(k => form[k]), oldId])
      setEditOpen(false)
      await loadAll()
    } catch (e) {
      console.error('Save material failed:', e)
      alert('保存失败: ' + (e.message || '未知错误'))
    } finally {
      setSaving(false)
    }
  }

  function handleBack() {
    backToList('/materials', material?.id)
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-primary-500 border-t-transparent animate-spin" />
      </div>
    )
  }

  if (!material) {
    return (
      <div className="p-8 text-center text-surface-500">
        材料未找到
        <button onClick={handleBack} className="ml-2 text-primary-400 hover:underline">返回列表</button>
      </div>
    )
  }

  return (
    <div className="animate-fade-in">
      {/* Banner */}
      <div className="relative px-8 py-10 border-b border-surface-800 overflow-hidden">
        <div className="absolute inset-0 bg-surface-900" />
        <button onClick={handleBack} className="relative z-10 self-start inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-[rgb(var(--color-1))] text-[rgb(var(--btn-text-1)_/_0.8)] hover:bg-[rgb(var(--scrollbar-thumb))] hover:text-[rgb(var(--btn-text-4th))] hover:scale-105 transition-all mb-6">
          <ArrowLeft className="w-3.5 h-3.5" />
          返回材料列表
        </button>
        <div className="relative z-10 flex items-start justify-between">
          <div className="flex items-start gap-6">
            <div
              className="w-28 h-28 rounded-2xl border border-surface-600 flex items-center justify-center flex-shrink-0 overflow-hidden shadow-lg cursor-pointer hover:scale-105 transition-transform"
              style={{ backgroundImage: `url(./background/${material.rarity || 1}star.webp)`, backgroundSize: 'cover', backgroundPosition: 'center' }}
              onClick={() => material.image && setLightbox({ filename: material.image, label: material.name_zh })}
            >
              {material.image ? (
                <LocalImage filename={material.image} className="w-20 h-20 object-contain drop-shadow-md" />
              ) : (
                <Package className="w-10 h-10 text-surface-500" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-3 mb-1">
                <h1 className="text-2xl font-bold tracking-tight">{material.name_zh}</h1>
                <span className="text-amber-400 text-sm">{'★'.repeat(material.rarity || 1)}</span>
              </div>
              {material.name_en && <p className="text-sm text-surface-400 mb-1">{material.name_en}</p>}
              <span className="inline-block text-xs px-2 py-0.5 rounded-full bg-surface-700 text-surface-300">
                {MATERIAL_TYPES[material.type] || material.type}
              </span>
              {/* 关联炼武秘境标点（自动同步摹忆中枢的关联，点击打开摹忆中枢定位） */}
              {domainIndex.materials.get(material.id)?.length > 0 && (
                <div className="mt-2.5">
                  <DomainSourceChips domains={domainIndex.materials.get(material.id)} />
                </div>
              )}
            </div>
          </div>
          <button onClick={() => setEditOpen(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-[rgb(var(--color-1))] text-[rgb(var(--btn-text-1)_/_0.8)] hover:bg-[rgb(var(--scrollbar-thumb))] hover:text-[rgb(var(--btn-text-4th))] hover:scale-105 transition-all">
            <Edit3 className="w-3.5 h-3.5" />编辑
          </button>
        </div>
      </div>

      <div className="px-8 py-6 space-y-8 max-w-5xl">
        {/* Description */}
        <SectionCard icon={<Info className="w-4 h-4" />} title="说明">
          {material.description_zh ? (
            <p className="text-sm text-surface-300 leading-relaxed"><ColoredText text={material.description_zh} /></p>
          ) : (
            <p className="text-xs text-surface-500">暂无说明</p>
          )}
        </SectionCard>

        {/* Details */}
        <SectionCard icon={<Package className="w-4 h-4" />} title="详细信息">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <StatBadge label="类型" value={MATERIAL_TYPES[material.type] || material.type} />
            <StatBadge label="稀有度" value={'★'.repeat(material.rarity || 1)} />
            <StatBadge label="获取来源" value={material.source || '-'} />
            <StatBadge label="用途" value={material.usage || '-'} />
          </div>
        </SectionCard>

        {/* 用于烹饪（食物板块反向关联，可人工编辑）
            没有任何料理用到这道材料时整个区块不显示：空区块占的位置比它提供的信息多。
            这种关联仍然可以从食物侧「烹饪材料 → 添加」建立，建好后这里就会出现。 */}
        {usedByFoods.length > 0 && (
          <SectionCard icon={<UtensilsCrossed className="w-4 h-4" />} title="用于烹饪"
            extra={
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-surface-500">{usedByFoods.length} 道料理</span>
                <button onClick={() => setEditUsage({ food_id: '', quantity: '' })}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] text-primary-300 hover:bg-primary-500/10 transition-colors">
                  <Plus className="w-3 h-3" />添加
                </button>
              </div>
            }>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2">
              {usedByFoods.map(f => (
                <FoodUsageCard key={f.id} food={f}
                  onEdit={() => setEditUsage({ ...f })}
                  onDelete={() => handleDeleteUsage(f)} />
              ))}
            </div>
          </SectionCard>
        )}

        {/* Image */}
        {material.image && (
          <SectionCard icon={<Package className="w-4 h-4" />} title="图片">
            <div className="max-w-xs">
              <ImageTile filename={material.image} label={material.name_zh} rarity={material.rarity} onClick={() => setLightbox({ filename: material.image, label: material.name_zh })} />
            </div>
          </SectionCard>
        )}
      </div>

      {/* Edit Modal */}
      <EditModal isOpen={editOpen} onClose={() => setEditOpen(false)} onSave={handleSave} saving={saving} title={`编辑材料 - ${material.name_zh}`}>
        <div className="grid grid-cols-2 gap-x-6">
          <FormInput label="ID" value={form.id} onChange={v => setForm({ ...form, id: v ? Number(v) : 0 })} type="number" />
          <FormInput label="中文名" value={form.name_zh} onChange={v => setForm({ ...form, name_zh: v })} />
          <FormInput label="英文名" value={form.name_en} onChange={v => setForm({ ...form, name_en: v })} />
          <FormSelect label="类型" value={form.type} onChange={v => setForm({ ...form, type: v })}
            options={Object.entries(MATERIAL_TYPES).map(([k, v]) => ({ value: k, label: v }))} />
          <FormInput label="稀有度 (1-5)" value={form.rarity} onChange={v => setForm({ ...form, rarity: Number(v) })} type="number" />
        </div>
        <FormInput label="说明" value={form.description_zh} onChange={v => setForm({ ...form, description_zh: v })} multiline />
        <div className="grid grid-cols-2 gap-x-6">
          <FormInput label="获取来源" value={form.source} onChange={v => setForm({ ...form, source: v })} />
          <FormInput label="用途" value={form.usage} onChange={v => setForm({ ...form, usage: v })} multiline />
        </div>
        <ImagePicker label="材料图片" currentImage={form.image} onSelect={v => setForm({ ...form, image: v })} onRemove={() => setForm({ ...form, image: null })} />
      </EditModal>

      {/* 用于烹饪：新增/编辑关联 */}
      <EditModal isOpen={!!editUsage} onClose={() => setEditUsage(null)} onSave={handleSaveUsage}
        title={editUsage?.id ? '编辑料理用量' : '关联料理'}>
        {editUsage && (
          <>
            <SearchSelect label="料理" value={editUsage.food_id}
              onChange={v => setEditUsage({ ...editUsage, food_id: v ? Number(v) : '' })}
              options={allFoods.map(f => ({
                value: f.id,
                label: `${f.name_zh}${f.type ? `（${FOOD_TYPES[f.type] || f.type}）` : ''}`,
                image: f.image,
              }))} />
            <FormInput label="该料理需要的数量" value={editUsage.quantity}
              onChange={v => setEditUsage({ ...editUsage, quantity: v })} placeholder="例: 3" />
          </>
        )}
      </EditModal>

      {lightbox && (
        <Lightbox filename={lightbox.filename} label={lightbox.label} onClose={() => setLightbox(null)} />
      )}
    </div>
  )
}

// extra：标题右侧的操作区（如「用于烹饪」的添加按钮）。
// 折叠热区只覆盖左侧标题按钮，避免点「添加」时把卡片收起来。
function SectionCard({ icon, title, children, extra }) {
  const [collapsed, setCollapsed] = useState(false)
  return (
    <div className="rounded-xl border border-surface-800 bg-surface-900/50 overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3 border-b border-surface-800 hover:bg-surface-800/30 transition-colors">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-2 flex-1 min-w-0 text-left cursor-pointer select-none"
        >
          <ChevronDown className={`w-3.5 h-3.5 text-surface-500 transition-transform flex-shrink-0 ${collapsed ? '-rotate-90' : ''}`} />
          <span className="text-primary-400">{icon}</span>
          <h2 className="text-sm font-semibold">{title}</h2>
        </button>
        {extra}
      </div>
      {!collapsed && <div className="px-5 py-4">{children}</div>}
    </div>
  )
}

function StatBadge({ label, value }) {
  return (
    <div className="bg-surface-800/50 rounded-lg px-3 py-2">
      <span className="text-surface-500">{label}</span>
      <p className="text-white font-medium mt-0.5 text-sm">{value}</p>
    </div>
  )
}

function ImageTile({ filename, label, rarity, onClick }) {
  const [src, setSrc] = useState(null)
  const { readImage } = useDb()
  const handleDrag = useImageDrag(filename)
  const bgUrl = `./background/${rarity || 1}star.webp`
  useEffect(() => {
    let cancelled = false
    async function load() {
      const data = await readImage(filename)
      if (!cancelled && data) setSrc(data)
    }
    load()
    return () => { cancelled = true }
  }, [filename, readImage])
  if (!src) return <div className="aspect-square bg-surface-700 rounded-lg flex items-center justify-center"><Package className="w-8 h-8 text-surface-500" /></div>
  return (
    <div
      className={`rounded-xl bg-surface-800/50 border border-surface-700 overflow-hidden ${onClick ? 'cursor-pointer hover:border-primary-500/50 transition-colors' : ''}`}
      onClick={onClick}
    >
      <div className="flex items-center justify-center aspect-square"
        style={{ backgroundImage: `url(${bgUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }}>
        <img src={src} alt="" className="max-w-[80%] max-h-[80%] object-contain drop-shadow-md" draggable onDragStart={handleDrag} />
      </div>
      <div className="p-2">
        <p className="text-[10px] text-surface-400 text-center truncate">{label}</p>
      </div>
    </div>
  )
}

function LocalImage({ filename, className = '' }) {
  const [src, setSrc] = useState(null)
  const { readImage } = useDb()
  const handleDrag = useImageDrag(filename)
  useEffect(() => {
    let cancelled = false
    async function load() {
      if (filename) {
        const data = await readImage(filename)
        if (!cancelled && data) setSrc(data)
      }
    }
    load()
    return () => { cancelled = true }
  }, [filename, readImage])
  if (!src) return <span className="text-surface-500 text-xs">-</span>
  return <img src={src} alt="" className={className} draggable onDragStart={handleDrag} />
}

/** 材料 → 食物 的反向关联卡片（点击跳到食物详情，hover 出现编辑/移除） */
function FoodUsageCard({ food, onEdit, onDelete }) {
  const navigate = useNavigate()
  const { saveNow } = usePageMemory()
  const { savePage } = useNav()
  const { readImage } = useDb()
  const [src, setSrc] = useState(null)
  useEffect(() => {
    let cancelled = false
    if (!food.image) { setSrc(null); return undefined }
    ;(async () => {
      const data = await readImage(food.image)
      if (!cancelled && data) setSrc(data)
    })()
    return () => { cancelled = true }
  }, [food.image, readImage])
  return (
    <div
      onClick={() => { saveNow(); savePage('foods'); navigate(`/foods/${food.id}`) }}
      className="group relative flex items-center gap-2 px-2.5 py-2 rounded-lg bg-surface-800/50 border border-surface-700/50 cursor-pointer hover:border-primary-500/40 hover:bg-surface-800 transition-colors"
      title={`${food.name_zh}（${FOOD_TYPES[food.type] || food.type}）`}
    >
      <div className="w-9 h-9 rounded-md flex items-center justify-center flex-shrink-0 overflow-hidden"
        style={RARITY_BG_STYLES[food.rarity || 1]}>
        {src
          ? <img src={src} alt="" className="w-7 h-7 object-contain" />
          : <UtensilsCrossed className="w-4 h-4 text-surface-500" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-white truncate">{food.name_zh}</p>
        <p className="text-[10px] text-surface-500 truncate">
          {food.quantity !== '' && food.quantity != null
            ? `需要 ×${food.quantity}`
            : (FOOD_TYPES[food.type] || food.type)}
        </p>
      </div>
      {(onEdit || onDelete) && (
        <div className="absolute top-1 right-1 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {onEdit && (
            <button onClick={e => { e.stopPropagation(); onEdit() }}
              className="p-1 rounded bg-surface-900/85 text-surface-400 hover:text-primary-400 transition-colors" title="编辑">
              <Edit3 className="w-3 h-3" />
            </button>
          )}
          {onDelete && (
            <button onClick={e => { e.stopPropagation(); onDelete() }}
              className="p-1 rounded bg-surface-900/85 text-surface-400 hover:text-red-400 transition-colors" title="移除">
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

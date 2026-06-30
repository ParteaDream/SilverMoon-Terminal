import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useDb } from '../context/DbContext'
import { useNav } from '../context/NavContext'
import { PageMemoryProvider } from '../context/PageMemoryContext'
import { useDetailScroll } from '../hooks/useDetailState'
import { useImageDrag } from '../hooks/useImageDrag'
import { ArrowLeft, Edit3, Sword, Info, Star, ChevronDown, Plus, Upload, Trash2, Image, FlaskConical, Package } from 'lucide-react'
import EditModal, { FormInput, FormSelect, ImagePicker, SearchSelect } from '../components/EditModal'
import ColoredText from '../components/ColoredText'
import Lightbox from '../components/Lightbox'

const RARITY_STARS = { 1: '★', 2: '★★', 3: '★★★', 4: '★★★★', 5: '★★★★★' }
const MATERIAL_TYPE_ZH = {
  character_ascension: '角色突破', weapon_ascension: '武器突破', talent: '天赋书',
  cooking: '食材', local_specialty: '地区特产', common: '通用掉落',
  boss_drop: 'Boss掉落', weekly_boss_drop: '周本掉落', event: '活动材料',
}

/**
 * 解析精炼文本：将 [v1/v2/v3/v4/v5] 替换为当前精炼等级对应的值
 * 也支持 [v1% / v2% / ...] 格式
 */
function applyRefinement(text, rank) {
  if (!text) return text
  return text.replace(/\[([^\]]+)\]/g, (match, inner) => {
    const parts = inner.split('/').map(s => s.trim())
    if (parts.length === 5) {
      return parts[rank - 1] || parts[0]
    }
    return match
  })
}

export default function WeaponDetailPage() {
  const { id } = useParams()
  return (
    <PageMemoryProvider pageKey={`weapon_${id}`}>
      <WeaponDetailContent />
    </PageMemoryProvider>
  )
}

function WeaponDetailContent() {
  const { id } = useParams()
  const { query } = useDb()
  const { backToList, consumeBackToList } = useNav()
  const [weapon, setWeapon] = useState(null)
  const [weaponTypes, setWeaponTypes] = useState([])
  const [loading, setLoading] = useState(true)
  const [editOpen, setEditOpen] = useState(false)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [refinement, setRefinement] = useState(1)
  const [gallery, setGallery] = useState([])
  const [galleryDragOver, setGalleryDragOver] = useState(false)
  const [lightbox, setLightbox] = useState(null)
  const [ascMats, setAscMats] = useState([])
  const [allMaterials, setAllMaterials] = useState([])
  const [editAscMat, setEditAscMat] = useState(null)
  const fileInputRef = useRef(null)
  useDetailScroll('weapon', id)

  useEffect(() => { consumeBackToList(); loadAll() }, [id])

  async function loadAll() {
    try {
      const [wps, wtypes, amRaw, matsRaw] = await Promise.all([
        query('SELECT * FROM weapons WHERE id = ?', [id]),
        query('SELECT * FROM weapon_types'),
        query(`SELECT wam.*, m.name_zh AS material_name, m.type AS material_type, m.rarity, m.image
               FROM weapon_ascension_materials wam
               JOIN materials m ON wam.material_id = m.id
               WHERE wam.weapon_id = ?`, [id]).catch(() => ({ data: [] })),
        query('SELECT * FROM materials').catch(() => ({ data: [] })),
      ])
      if (wps.data?.length > 0) {
        const w = wps.data[0]
        setWeapon(w)
        setForm(w)
        if (w.gallery_images) {
          try { setGallery(JSON.parse(w.gallery_images)) } catch (_) { setGallery([]) }
        } else {
          setGallery([])
        }
      }
      setWeaponTypes(wtypes.data || [])
      setAscMats(amRaw.data || [])
      setAllMaterials(matsRaw.data || [])
    } catch (e) {
      console.error('Failed to load weapon:', e)
    } finally {
      setLoading(false)
    }
  }

  async function handleSave() {
    if (saving) return
    setSaving(true)
    try {
      const newId = Number(form.id)
      const oldId = weapon.id
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
      setEditOpen(false)
      await loadAll()
    } catch (e) {
      console.error('Save weapon failed:', e)
      alert('保存失败: ' + (e.message || '未知错误'))
    } finally {
      setSaving(false)
    }
  }

  // ── Gallery ──
  async function saveGallery(updated) {
    const json = JSON.stringify(updated)
    await query('UPDATE weapons SET gallery_images = ? WHERE id = ?', [json, weapon.id])
    setGallery(updated)
    await loadAll()
  }

  async function addGalleryImage(filename) {
    const updated = [...gallery, { label: filename, filename }]
    await saveGallery(updated)
  }

  async function removeGalleryImage(index) {
    const updated = gallery.filter((_, i) => i !== index)
    await saveGallery(updated)
  }

  async function handleGalleryDrop(e) {
    e.preventDefault()
    setGalleryDragOver(false)
    const files = e.dataTransfer?.files
    if (!files?.length) return
    for (const file of files) {
      if (file.type.startsWith('image/')) {
        try {
          const result = await window.electronAPI?.importImageFile(file.path)
          if (result?.filename) await addGalleryImage(result.filename)
        } catch (err) {
          console.error('Import failed:', err)
        }
      }
    }
  }

  async function handleFileSelect(e) {
    const files = e.target.files
    if (!files?.length) return
    for (const file of files) {
      try {
        const result = await window.electronAPI?.importImageFile(file.path)
        if (result?.filename) await addGalleryImage(result.filename)
      } catch (err) {
        console.error('Import failed:', err)
      }
    }
    e.target.value = ''
  }

  // ── Ascension Materials ──
  async function handleSaveAscMat() {
    if (!editAscMat) return
    const m = editAscMat
    const mid = Number(m.material_id)
    if (m.id) {
      await query('UPDATE weapon_ascension_materials SET material_id=?, quantity=? WHERE id=?',
        [mid, m.quantity || null, m.id])
    } else {
      // 检查是否已存在相同武器的相同材料
      const existing = await query(
        'SELECT id FROM weapon_ascension_materials WHERE weapon_id=? AND material_id=?',
        [weapon.id, mid]
      )
      if (existing.data?.length > 0) {
        await query('UPDATE weapon_ascension_materials SET quantity=? WHERE id=?',
          [m.quantity || null, existing.data[0].id])
      } else {
        await query('INSERT INTO weapon_ascension_materials (weapon_id, material_id, quantity) VALUES (?,?,?)',
          [weapon.id, mid, m.quantity || null])
      }
    }
    setEditAscMat(null)
    await loadAll()
  }

  async function handleDeleteAscMat(row) {
    if (!confirm('确定删除此培养素材？')) return
    await query('DELETE FROM weapon_ascension_materials WHERE id = ?', [row.id])
    await loadAll()
  }

  function handleBack() {
    backToList('/weapons', weapon?.id)
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-primary-500 border-t-transparent animate-spin" />
      </div>
    )
  }

  if (!weapon) {
    return (
      <div className="p-8 text-center text-surface-500">
        武器未找到
        <button onClick={handleBack} className="ml-2 text-primary-400 hover:underline">返回列表</button>
      </div>
    )
  }

  const wt = weaponTypes.find(w => w.id === weapon.weapon_type_id)
  const descriptionText = applyRefinement(weapon.passive_description_zh, refinement)

  return (
    <div className="animate-fade-in">
      {/* Banner */}
      <div className="relative px-8 py-10 border-b border-surface-800 overflow-hidden">
        <div className="absolute inset-0 bg-surface-900" />
        <button onClick={handleBack} className="relative z-10 self-start inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-[rgb(var(--color-1))] text-[rgb(var(--btn-text-1)_/_0.8)] hover:bg-[rgb(var(--scrollbar-thumb))] hover:text-[rgb(var(--btn-text-4th))] hover:scale-105 transition-all mb-6">
          <ArrowLeft className="w-3.5 h-3.5" />
          返回武器列表
        </button>
        <div className="relative z-10 flex items-start justify-between">
          <div className="flex items-start gap-6">
            <div className="w-28 h-28 rounded-2xl bg-surface-800/50 border border-surface-600 flex items-center justify-center flex-shrink-0 overflow-hidden shadow-lg">
              {(weapon.simple_art || weapon.image) ? (
                <LocalImage filename={weapon.simple_art || weapon.image} className="w-full h-full object-cover" />
              ) : (
                <Sword className="w-10 h-10 text-surface-500" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-3 mb-1">
                <h1 className="text-2xl font-bold tracking-tight">{weapon.name_zh}</h1>
                <span className="text-accent-gold text-sm">{RARITY_STARS[weapon.rarity] || '★★★★'}</span>
                {weapon.name_en && <span className="text-sm text-surface-500 font-mono">{weapon.name_en}</span>}
              </div>
              {wt && <p className="text-sm text-surface-400 mb-3">{wt.name_zh}</p>}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-surface-400">
                <span>基础攻击力: {weapon.max_base_atk || weapon.base_atk}</span>
                {weapon.secondary_stat && <span>副属性: {weapon.secondary_stat} {weapon.max_secondary_stat_value || weapon.secondary_stat_value}</span>}
              </div>
            </div>
          </div>
          <button onClick={() => setEditOpen(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-[rgb(var(--color-1))] text-[rgb(var(--btn-text-1)_/_0.8)] hover:bg-[rgb(var(--scrollbar-thumb))] hover:text-[rgb(var(--btn-text-4th))] hover:scale-105 transition-all">
            <Edit3 className="w-3.5 h-3.5" />编辑
          </button>
        </div>
      </div>

      <div className="px-8 py-6 space-y-8 max-w-5xl">
        {/* Basic Info — 攻击力一行、副属性一行 */}
        <SectionCard icon={<Info className="w-4 h-4" />} title="基本信息">
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2 bg-surface-800/40 rounded-lg px-4 py-2.5">
              <span className="text-surface-500 shrink-0">基础攻击力</span>
              <span className="text-white font-medium">{weapon.base_atk}</span>
              <span className="text-surface-600">→</span>
              <span className="text-white font-medium">{weapon.max_base_atk || '-'}</span>
              <span className="text-surface-500 text-xs ml-2">Lv1 → Lv{weapon.rarity <= 2 ? '70' : '90'}</span>
            </div>
            {weapon.secondary_stat && (
            <div className="flex items-center gap-2 bg-surface-800/40 rounded-lg px-4 py-2.5">
              <span className="text-surface-500 shrink-0">副属性</span>
              <span className="text-white font-medium">{weapon.secondary_stat || '-'}</span>
              {weapon.secondary_stat && (
                <>
                  <span className="text-white font-medium">{weapon.secondary_stat_value ?? '-'}</span>
                  <span className="text-surface-600">→</span>
                  <span className="text-white font-medium">{weapon.max_secondary_stat_value ?? '-'}</span>
                  <span className="text-surface-500 text-xs ml-2">Lv1 → Lv{weapon.rarity <= 2 ? '70' : '90'}</span>
                </>
              )}
            </div>
            )}
            {weapon.description_zh && (
              <div className="bg-surface-800/40 rounded-lg px-4 py-2.5">
                <p className="text-sm text-surface-300 leading-relaxed"><ColoredText text={weapon.description_zh} /></p>
              </div>
            )}
          </div>
        </SectionCard>

        {/* Passive + Refinement slider */}
        {weapon.passive_name_zh && (
          <SectionCard icon={<Star className="w-4 h-4" />} title={`武器特效 · ${weapon.passive_name_zh}`}>
            <div className="space-y-4">
              {/* 精炼滑块 */}
              <div className="flex items-center gap-3">
                <span className="text-xs text-surface-500 shrink-0">精炼等级</span>
                <input
                  type="range" min="1" max="5" value={refinement}
                  onChange={e => setRefinement(Number(e.target.value))}
                  className="flex-1 h-1.5 rounded-full appearance-none bg-surface-700 cursor-pointer
                             [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
                             [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary-500
                             [&::-webkit-slider-thumb]:cursor-pointer"
                />
                <span className="text-sm font-bold text-primary-400 w-4 text-center">{refinement}</span>
              </div>
              {/* 特效文本（根据精炼动态替换） */}
              {weapon.passive_description_zh && (
                <p className="text-sm text-surface-300 leading-relaxed"><ColoredText text={descriptionText} /></p>
              )}
            </div>
          </SectionCard>
        )}

        {/* Story */}
        {weapon.story_zh && (
          <SectionCard icon={<Info className="w-4 h-4" />} title="背景故事">
            <p className="text-sm text-surface-300 leading-relaxed whitespace-pre-wrap"><ColoredText text={weapon.story_zh} /></p>
          </SectionCard>
        )}

        {/* Ascension Materials */}
        <SectionCard icon={<FlaskConical className="w-4 h-4" />} title="培养素材" onAdd={() => setEditAscMat({ material_id: '', quantity: '' })}>
          {ascMats.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {ascMats.map(m => (
                <MaterialBadge key={m.id} material={m} onEdit={() => setEditAscMat({ ...m })} onDelete={() => handleDeleteAscMat(m)} />
              ))}
            </div>
          ) : (
            <Empty text="暂无培养素材" />
          )}
        </SectionCard>

        {/* Gallery */}
        <SectionCard icon={<Image className="w-4 h-4" />} title="图库">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {weapon.image && (
              <GalleryTile filename={weapon.image} label="武器图片" onClick={() => setLightbox(weapon.image)} />
            )}
            {weapon.simple_art && (
              <GalleryTile filename={weapon.simple_art} label="装备图" onClick={() => setLightbox(weapon.simple_art)} />
            )}
            {gallery.map((item, i) => (
              <div key={i} className="group relative">
                <GalleryTile filename={item.filename} label={item.label} onClick={() => setLightbox(item.filename)} />
                <button
                  onClick={() => removeGalleryImage(i)}
                  className="absolute top-1 right-1 p-1 rounded bg-black/50 text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            {/* 拖拽导入区域 */}
            <button
              onDragOver={e => { e.preventDefault(); setGalleryDragOver(true) }}
              onDragLeave={() => setGalleryDragOver(false)}
              onDrop={handleGalleryDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`aspect-square rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-1.5 transition-colors ${
                galleryDragOver
                  ? 'border-primary-500 bg-primary-500/10 text-primary-400'
                  : 'border-surface-600 text-surface-500 hover:border-surface-400 hover:text-surface-300'
              }`}
            >
              {galleryDragOver ? <Upload className="w-6 h-6" /> : <Plus className="w-6 h-6" />}
              <span className="text-[10px]">
                {galleryDragOver ? '松开导入' : '添加图片'}
              </span>
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFileSelect} />
          </div>
          {!weapon.image && !weapon.simple_art && gallery.length === 0 && (
            <p className="text-xs text-surface-500 py-2">暂无图片，点击或拖拽添加</p>
          )}
        </SectionCard>
      </div>

      {/* Edit Modal */}
      <EditModal isOpen={editOpen} onClose={() => setEditOpen(false)} onSave={handleSave} saving={saving} title={`编辑武器 - ${weapon.name_zh}`}>
        <FormInput label="ID" value={form.id ?? 0} onChange={v => setForm({ ...form, id: v === '' ? 0 : Number(v) })} type="number" />
        <div className="grid grid-cols-2 gap-x-6">
          <FormInput label="中文名" value={form.name_zh} onChange={v => setForm({ ...form, name_zh: v })} />
          <FormInput label="英文名" value={form.name_en} onChange={v => setForm({ ...form, name_en: v })} />
          <FormInput label="稀有度 (1-5)" value={form.rarity} onChange={v => setForm({ ...form, rarity: Number(v) })} type="number" />
          <FormSelect label="武器类型" value={form.weapon_type_id} onChange={v => setForm({ ...form, weapon_type_id: Number(v) })}
            options={weaponTypes.map(w => ({ value: w.id, label: w.name_zh }))} />
          <FormInput label="基础攻击力" value={form.base_atk} onChange={v => setForm({ ...form, base_atk: v ? Number(v) : null })} type="number" />
          <FormInput label="满级攻击力" value={form.max_base_atk} onChange={v => setForm({ ...form, max_base_atk: v ? Number(v) : null })} type="number" />
          <FormInput label="副属性名称" value={form.secondary_stat} onChange={v => setForm({ ...form, secondary_stat: v })} />
          <FormInput label="副属性值(Lv1)" value={form.secondary_stat_value} onChange={v => setForm({ ...form, secondary_stat_value: v })} placeholder="例: 14.4%" />
          <FormInput label="满级副属性值" value={form.max_secondary_stat_value} onChange={v => setForm({ ...form, max_secondary_stat_value: v })} placeholder="例: 66.2%" />
        </div>
        <FormInput label="被动名称" value={form.passive_name_zh} onChange={v => setForm({ ...form, passive_name_zh: v })} />
        <FormInput label="被动描述" value={form.passive_description_zh} onChange={v => setForm({ ...form, passive_description_zh: v })} multiline />
        <FormInput label="简介" value={form.description_zh} onChange={v => setForm({ ...form, description_zh: v })} multiline />
        <FormInput label="背景故事" value={form.story_zh} onChange={v => setForm({ ...form, story_zh: v })} multiline />
        <div className="grid grid-cols-2 gap-x-6">
          <ImagePicker label="武器图片" currentImage={form.image} onSelect={v => setForm({ ...form, image: v })} onRemove={() => setForm({ ...form, image: null })} />
          <ImagePicker label="装备图" currentImage={form.simple_art} onSelect={v => setForm({ ...form, simple_art: v })} onRemove={() => setForm({ ...form, simple_art: null })} />
        </div>
      </EditModal>

      {/* Lightbox */}
      {lightbox && (
        <Lightbox filename={lightbox} onClose={() => setLightbox(null)} />
      )}
      {/* Ascension Material edit modal */}
      {editAscMat && (
        <EditModal isOpen={!!editAscMat} onClose={() => setEditAscMat(null)} onSave={handleSaveAscMat} saving={saving}
          title={editAscMat.id ? '编辑培养素材' : '添加培养素材'}>
          <SearchSelect label="材料" value={editAscMat.material_id} onChange={v => setEditAscMat({ ...editAscMat, material_id: v ? Number(v) : '' })}
            options={allMaterials.map(m => ({ value: m.id, label: `${m.name_zh} (${MATERIAL_TYPE_ZH[m.type] || m.type})`, image: m.image }))} />
          <FormInput label="数量" value={editAscMat.quantity} onChange={v => setEditAscMat({ ...editAscMat, quantity: v })} placeholder="例: 168" />
        </EditModal>
      )}
    </div>
  )
}

// ── Sub-components ──

function MaterialBadge({ material, onEdit, onDelete }) {
  const navigate = useNavigate()
  const { savePage } = useNav()
  const RARITY_COLORS = { 1: 'border-gray-500/30', 2: 'border-green-500/30', 3: 'border-blue-500/30', 4: 'border-purple-500/30', 5: 'border-amber-500/30' }

  function handleClick() {
    if (material.material_id) {
      savePage('materials')
      navigate(`/materials/${material.material_id}`)
    }
  }

  return (
    <div onClick={handleClick}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-800/50 border ${RARITY_COLORS[material.rarity] || 'border-surface-700/50'} group relative cursor-pointer hover:border-primary-500/30 transition-colors`}>
      {material.image ? (
        <LocalImage filename={material.image} className="w-8 h-8 rounded object-cover flex-shrink-0" />
      ) : (
        <div className="w-8 h-8 rounded bg-surface-700 flex items-center justify-center flex-shrink-0">
          <FlaskConical className="w-4 h-4 text-surface-500" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-surface-200 truncate">{material.material_name || material.material_id}</p>
        {(material.quantity) && (
          <p className="text-[10px] text-surface-500">数量: {material.quantity}</p>
        )}
      </div>
      {(onEdit || onDelete) && (
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
          {onEdit && <button onClick={e => { e.stopPropagation(); onEdit() }} className="p-0.5 text-surface-400 hover:text-primary-400"><Edit3 className="w-3 h-3" /></button>}
          {onDelete && <button onClick={e => { e.stopPropagation(); onDelete() }} className="p-0.5 text-surface-400 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>}
        </div>
      )}
    </div>
  )
}

function Empty({ text }) {
  return <p className="text-xs text-surface-500 py-2">{text}</p>
}

function SectionCard({ icon, title, children, onAdd }) {
  const [collapsed, setCollapsed] = useState(false)
  return (
    <div className="rounded-xl border border-surface-800 bg-surface-900/50 overflow-hidden">
      <div
        className="flex items-center gap-2 px-5 py-3 border-b border-surface-800 cursor-pointer select-none hover:bg-surface-800/30 transition-colors"
        onClick={() => setCollapsed(!collapsed)}
      >
        <ChevronDown className={`w-3.5 h-3.5 text-surface-500 transition-transform ${collapsed ? '-rotate-90' : ''}`} />
        <span className="text-primary-400">{icon}</span>
        <h2 className="text-sm font-semibold flex-1">{title}</h2>
        {onAdd && (
          <button
            onClick={e => { e.stopPropagation(); onAdd() }}
            className="p-1 rounded hover:bg-surface-600 text-surface-400 hover:text-white transition-colors"
            title="添加"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {!collapsed && <div className="px-5 py-4">{children}</div>}
    </div>
  )
}

function GalleryTile({ filename, label, onClick }) {
  const [src, setSrc] = useState(null)
  const { readImage } = useDb()
  useEffect(() => {
    let cancelled = false
    async function load() {
      const data = await readImage(filename)
      if (!cancelled && data) setSrc(data)
    }
    load()
    return () => { cancelled = true }
  }, [filename, readImage])
  return (
    <div onClick={onClick} className="cursor-pointer rounded-xl bg-surface-800/50 border border-surface-700 overflow-hidden hover:border-primary-500/50 transition-colors">
      <div className="aspect-square bg-surface-700/50 flex items-center justify-center overflow-hidden">
        {src ? (
          <img src={src} alt="" className="w-full h-full object-cover" />
        ) : (
          <Sword className="w-8 h-8 text-surface-500" />
        )}
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


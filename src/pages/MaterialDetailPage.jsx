import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { useDb } from '../context/DbContext'
import { useNav } from '../context/NavContext'
import { PageMemoryProvider } from '../context/PageMemoryContext'
import { useDetailScroll } from '../hooks/useDetailState'
import { useImageDrag } from '../hooks/useImageDrag'
import { ArrowLeft, Edit3, Package, Info, ChevronDown } from 'lucide-react'
import EditModal, { FormInput, FormSelect, ImagePicker } from '../components/EditModal'
import ColoredText from '../components/ColoredText'
import Lightbox from '../components/Lightbox'

const MATERIAL_TYPES = {
  character_ascension: '角色突破', weapon_ascension: '武器突破', talent: '天赋书',
  cooking: '食材', local_specialty: '地区特产', common: '通用掉落',
  boss_drop: 'Boss掉落', weekly_boss_drop: '周本掉落', event: '活动材料',
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
  useDetailScroll('material', id)

  useEffect(() => { consumeBackToList(); loadAll() }, [id])

  async function loadAll() {
    try {
      const result = await query('SELECT * FROM materials WHERE id = ?', [id])
      if (result.data?.length > 0) {
        setMaterial(result.data[0])
        setForm(result.data[0])
      }
    } catch (e) {
      console.error('Failed to load material:', e)
    } finally {
      setLoading(false)
    }
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
    backToList('/materials')
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
        <button onClick={handleBack} className="relative z-10 inline-flex items-center gap-1.5 text-xs text-surface-400 hover:text-white transition-colors mb-6">
          <ArrowLeft className="w-3.5 h-3.5" />
          返回材料列表
        </button>
        <div className="relative z-10 flex items-start justify-between">
          <div className="flex items-start gap-6">
            <div
              className="w-28 h-28 rounded-2xl bg-surface-800/50 border border-surface-600 flex items-center justify-center flex-shrink-0 overflow-hidden shadow-lg cursor-pointer hover:scale-105 transition-transform"
              onClick={() => material.image && setLightbox({ filename: material.image, label: material.name_zh })}
            >
              {material.image ? (
                <LocalImage filename={material.image} className="w-full h-full object-cover" />
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
            </div>
          </div>
          <button onClick={() => setEditOpen(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs text-white/80 transition-colors">
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

        {/* Image */}
        {material.image && (
          <SectionCard icon={<Package className="w-4 h-4" />} title="图片">
            <div className="max-w-xs">
              <ImageTile filename={material.image} label={material.name_zh} onClick={() => setLightbox({ filename: material.image, label: material.name_zh })} />
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

      {lightbox && (
        <Lightbox filename={lightbox.filename} label={lightbox.label} onClose={() => setLightbox(null)} />
      )}
    </div>
  )
}

function SectionCard({ icon, title, children }) {
  const [collapsed, setCollapsed] = useState(false)
  return (
    <div className="rounded-xl border border-surface-800 bg-surface-900/50 overflow-hidden">
      <div
        className="flex items-center gap-2 px-5 py-3 border-b border-surface-800 cursor-pointer select-none hover:bg-surface-800/30 transition-colors"
        onClick={() => setCollapsed(!collapsed)}
      >
        <ChevronDown className={`w-3.5 h-3.5 text-surface-500 transition-transform ${collapsed ? '-rotate-90' : ''}`} />
        <span className="text-primary-400">{icon}</span>
        <h2 className="text-sm font-semibold">{title}</h2>
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

function ImageTile({ filename, label, onClick }) {
  const [src, setSrc] = useState(null)
  const { readImage } = useDb()
  const handleDrag = useImageDrag(filename)
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
      <div className="bg-surface-700 flex items-center justify-center aspect-square overflow-hidden">
        <img src={src} alt="" className="w-full h-full object-cover" draggable onDragStart={handleDrag} />
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

import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { useDb } from '../context/DbContext'
import { useNav } from '../context/NavContext'
import { PageMemoryProvider } from '../context/PageMemoryContext'
import { useDetailScroll } from '../hooks/useDetailState'
import { useImageDrag } from '../hooks/useImageDrag'
import { ArrowLeft, Edit3, Gem, Info, Star, ChevronDown } from 'lucide-react'
import EditModal, { FormInput, ImagePicker } from '../components/EditModal'
import ColoredText from '../components/ColoredText'
import Lightbox from '../components/Lightbox'

export default function ArtifactDetailPage() {
  const { id } = useParams()
  return (
    <PageMemoryProvider pageKey={`artifact_${id}`}>
      <ArtifactDetailContent />
    </PageMemoryProvider>
  )
}

function ArtifactDetailContent() {
  const { id } = useParams()
  const { query } = useDb()
  const { backToList, consumeBackToList } = useNav()
  const [artifact, setArtifact] = useState(null)
  const [loading, setLoading] = useState(true)
  const [editOpen, setEditOpen] = useState(false)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [lightbox, setLightbox] = useState(null)
  const [selectedPiece, setSelectedPiece] = useState('flower')
  useDetailScroll('artifact', id)

  useEffect(() => { consumeBackToList(); loadAll() }, [id])

  async function loadAll() {
    try {
      const result = await query('SELECT * FROM artifacts WHERE id = ?', [id])
      if (result.data?.length > 0) {
        setArtifact(result.data[0])
        setForm(result.data[0])
      }
    } catch (e) {
      console.error('Failed to load artifact:', e)
    } finally {
      setLoading(false)
    }
  }

  async function handleSave() {
    if (saving) return
    setSaving(true)
    try {
      const newId = Number(form.id)
      const oldId = artifact.id
      if (newId !== oldId) {
        const dup = await query('SELECT COUNT(*) as cnt FROM artifacts WHERE id = ?', [newId])
        if (dup.data?.[0]?.cnt > 0) { alert(`ID ${newId} 已存在，请使用其他 ID`); setSaving(false); return }
      }
      const keys = Object.keys(form)
      const sets = keys.map(k => `${k} = ?`).join(', ')
      await query(`UPDATE artifacts SET ${sets} WHERE id = ?`, [...keys.map(k => form[k]), oldId])
      setEditOpen(false)
      await loadAll()
    } catch (e) {
      console.error('Save artifact failed:', e)
      alert('保存失败: ' + (e.message || '未知错误'))
    } finally {
      setSaving(false)
    }
  }

  function handleBack() {
    backToList('/artifacts')
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-primary-500 border-t-transparent animate-spin" />
      </div>
    )
  }

  if (!artifact) {
    return (
      <div className="p-8 text-center text-surface-500">
        圣遗物未找到
        <button onClick={handleBack} className="ml-2 text-primary-400 hover:underline">返回列表</button>
      </div>
    )
  }

  const pieces = [
    { key: 'flower_name_zh', label: '生之花', imgKey: 'flower_image', descKey: 'flower_description_zh', storyKey: 'flower_story_zh' },
    { key: 'plume_name_zh', label: '死之羽', imgKey: 'plume_image', descKey: 'plume_description_zh', storyKey: 'plume_story_zh' },
    { key: 'sands_name_zh', label: '时之沙', imgKey: 'sands_image', descKey: 'sands_description_zh', storyKey: 'sands_story_zh' },
    { key: 'goblet_name_zh', label: '空之杯', imgKey: 'goblet_image', descKey: 'goblet_description_zh', storyKey: 'goblet_story_zh' },
    { key: 'circlet_name_zh', label: '理之冠', imgKey: 'circlet_image', descKey: 'circlet_description_zh', storyKey: 'circlet_story_zh' },
  ]
  const selectedPieceData = pieces.find(p => p.key.startsWith(selectedPiece)) || pieces[0]

  return (
    <div className="animate-fade-in">
      {/* Banner */}
      <div className="relative px-8 py-10 border-b border-surface-800 overflow-hidden">
        <div className="absolute inset-0 bg-surface-900" />
        <button onClick={handleBack} className="relative z-10 inline-flex items-center gap-1.5 text-xs text-surface-400 hover:text-white transition-colors mb-6">
          <ArrowLeft className="w-3.5 h-3.5" />
          返回圣遗物列表
        </button>
        <div className="relative z-10 flex items-start justify-between">
          <div className="flex items-start gap-6">
            <div
              className="w-28 h-28 rounded-2xl bg-surface-800/50 border border-surface-600 flex items-center justify-center flex-shrink-0 overflow-hidden shadow-lg cursor-pointer hover:scale-105 transition-transform"
              onClick={() => (artifact.image || artifact.flower_image || artifact.circlet_image) && setLightbox({ filename: artifact.image || artifact.flower_image || artifact.circlet_image, label: artifact.name_zh })}
            >
              {artifact.image || artifact.flower_image ? (
                <LocalImage filename={artifact.image || artifact.flower_image} className="w-full h-full object-cover" />
              ) : artifact.circlet_image ? (
                <LocalImage filename={artifact.circlet_image} className="w-full h-full object-cover" />
              ) : (
                <Gem className="w-10 h-10 text-surface-500" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-3 mb-1">
                <h1 className="text-2xl font-bold tracking-tight">{artifact.name_zh}</h1>
                <span className="text-amber-400 text-sm">{'★'.repeat(artifact.max_rarity || 5)}</span>
              </div>
              {artifact.name_en && <p className="text-sm text-surface-400">{artifact.name_en}</p>}
            </div>
          </div>
          <button onClick={() => setEditOpen(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs text-white/80 transition-colors">
            <Edit3 className="w-3.5 h-3.5" />编辑
          </button>
        </div>
      </div>

      <div className="px-8 py-6 space-y-8 max-w-5xl">
        {/* Set Bonuses */}
        {(artifact.two_piece_bonus || artifact.four_piece_bonus) && (
          <SectionCard icon={<Star className="w-4 h-4" />} title="套装效果">
            <div className="space-y-3">
              {artifact.two_piece_bonus && (
                <div className="bg-surface-800/50 rounded-lg p-4">
                  <p className="text-xs text-primary-400 font-medium mb-1">2件套</p>
                  <p className="text-sm text-surface-300"><ColoredText text={artifact.two_piece_bonus} /></p>
                </div>
              )}
              {artifact.four_piece_bonus && (
                <div className="bg-surface-800/50 rounded-lg p-4">
                  <p className="text-xs text-primary-400 font-medium mb-1">4件套</p>
                  <p className="text-sm text-surface-300"><ColoredText text={artifact.four_piece_bonus} /></p>
                </div>
              )}
            </div>
          </SectionCard>
        )}

        {/* Set Pieces */}
        <SectionCard icon={<Gem className="w-4 h-4" />} title="套装部件">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
            {pieces.map(p => (
              <div key={p.key} className="text-center">
                <div
                  className={`aspect-square bg-surface-800/50 rounded-xl border flex items-center justify-center mb-2 overflow-hidden cursor-pointer transition-colors ${
                    selectedPiece === p.key.replace('_name_zh', '') ? 'border-primary-500 ring-1 ring-primary-500/30' : 'border-surface-700 hover:border-primary-500/50'
                  }`}
                  onClick={() => {
                    setSelectedPiece(p.key.replace('_name_zh', ''))
                    artifact[p.imgKey] && setLightbox({ filename: artifact[p.imgKey], label: artifact.name_zh + ' · ' + p.label })
                  }}
                >
                  {artifact[p.imgKey] ? (
                    <LocalImage filename={artifact[p.imgKey]} className="w-full h-full object-cover" />
                  ) : (
                    <Gem className="w-8 h-8 text-surface-500" />
                  )}
                </div>
                <p className="text-xs text-surface-400">{p.label}</p>
                <p className="text-[11px] text-surface-300 font-medium mt-0.5">{artifact[p.key] || '-'}</p>
              </div>
            ))}
          </div>
          {/* 部件选择 Tab */}
          <div className="flex gap-1 bg-surface-800/50 rounded-lg p-0.5">
            {pieces.map(p => {
              const pieceKey = p.key.replace('_name_zh', '')
              return (
                <button
                  key={pieceKey}
                  onClick={() => setSelectedPiece(pieceKey)}
                  className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    selectedPiece === pieceKey
                      ? 'bg-primary-600 text-white'
                      : 'text-surface-400 hover:text-surface-200'
                  }`}
                >
                  {p.label}
                </button>
              )
            })}
          </div>
        </SectionCard>

        {/* Piece Description */}
        {artifact[selectedPieceData.descKey] && (
          <SectionCard icon={<Info className="w-4 h-4" />} title={`${selectedPieceData.label} · 介绍`}>
            <p className="text-sm text-surface-300 leading-relaxed"><ColoredText text={artifact[selectedPieceData.descKey]} /></p>
          </SectionCard>
        )}

        {/* Piece Story */}
        {artifact[selectedPieceData.storyKey] && (
          <SectionCard icon={<Info className="w-4 h-4" />} title={`${selectedPieceData.label} · 故事`}>
            <p className="text-sm text-surface-300 leading-relaxed whitespace-pre-wrap"><ColoredText text={artifact[selectedPieceData.storyKey]} /></p>
          </SectionCard>
        )}
      </div>

      {/* Edit Modal */}
      <EditModal isOpen={editOpen} onClose={() => setEditOpen(false)} onSave={handleSave} saving={saving} title={`编辑圣遗物 - ${artifact.name_zh}`}>
        <FormInput label="ID" value={form.id ?? 0} onChange={v => setForm({ ...form, id: v === '' ? 0 : Number(v) })} type="number" />
        <div className="grid grid-cols-2 gap-x-6">
          <FormInput label="中文名" value={form.name_zh} onChange={v => setForm({ ...form, name_zh: v })} />
          <FormInput label="英文名" value={form.name_en} onChange={v => setForm({ ...form, name_en: v })} />
          <FormInput label="最高稀有度" value={form.max_rarity} onChange={v => setForm({ ...form, max_rarity: Number(v) })} type="number" />
        </div>
        <FormInput label="简介（生之花）" value={form.flower_description_zh} onChange={v => setForm({ ...form, flower_description_zh: v })} multiline />
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
        <FormInput label="故事（生之花）" value={form.flower_story_zh} onChange={v => setForm({ ...form, flower_story_zh: v })} multiline />
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

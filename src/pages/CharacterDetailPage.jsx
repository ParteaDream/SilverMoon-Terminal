import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useDb } from '../context/DbContext'
import { useNav } from '../context/NavContext'
import { PageMemoryProvider } from '../context/PageMemoryContext'
import useDetailState from '../hooks/useDetailState'
import { useImageDrag } from '../hooks/useImageDrag'
import { useDetailScroll } from '../hooks/useDetailState'
import {
  ArrowLeft, Star, Edit3, Plus, Trash2, Image, ChevronDown, ChevronRight, X,
  Zap, BookOpen, Crown, Sparkles, User, Info, MapPin, Calendar, Sword, Shirt, UtensilsCrossed, FileText, FlaskConical, Upload, CheckCircle2
} from 'lucide-react'
import EditModal, { FormInput, FormSelect, SearchSelect, ImagePicker } from '../components/EditModal'
import ColoredText from '../components/ColoredText'
import Lightbox from '../components/Lightbox'

const ELEMENT_COLORS = {
  1: { bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/20', glow: 'shadow-red-500/10' },
  2: { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/20', glow: 'shadow-blue-500/10' },
  3: { bg: 'bg-cyan-500/10', text: 'text-cyan-400', border: 'border-cyan-500/20', glow: 'shadow-cyan-500/10' },
  4: { bg: 'bg-purple-500/10', text: 'text-purple-400', border: 'border-purple-500/20', glow: 'shadow-purple-500/10' },
  5: { bg: 'bg-green-500/10', text: 'text-green-400', border: 'border-green-500/20', glow: 'shadow-green-500/10' },
  6: { bg: 'bg-sky-500/10', text: 'text-sky-300', border: 'border-sky-500/20', glow: 'shadow-sky-500/10' },
  7: { bg: 'bg-yellow-500/10', text: 'text-yellow-400', border: 'border-yellow-500/20', glow: 'shadow-yellow-500/10' },
}

const SECTION_LABELS = {
  info: '基本信息',
  talents: '天赋技能',
  constellations: '命之座',
  materials: '培养素材',
  lore: '角色故事',
  outfits: '时装',
  dish: '特殊料理',
  namecard: '名片',
  gallery: '图库',
}

const TALENT_TYPES = {
  normal_attack: { label: '普通攻击', color: 'bg-sky-500/10 text-sky-400 border-sky-500/20' },
  elemental_skill: { label: '元素战技', color: 'bg-primary-500/10 text-primary-400 border-primary-500/20' },
  passive_special: { label: '固有天赋（特殊）', color: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
  elemental_burst: { label: '元素爆发', color: 'bg-purple-500/10 text-purple-400 border-purple-500/20' },
  passive: { label: '固有天赋', color: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
}

const TALENT_TYPE_ORDER = ['normal_attack', 'elemental_skill', 'passive_special', 'elemental_burst', 'passive']

// 旅行者元素顺序：风、岩、雷、草、水、火、冰
const TRAVELER_ELEMENTS = [3, 7, 4, 5, 2, 1, 6]

const MATERIAL_TYPE_ZH = {
  character_ascension: '角色突破', weapon_ascension: '武器突破', talent: '天赋书',
  cooking: '食材', local_specialty: '地区特产', common: '通用掉落',
  boss_drop: 'Boss掉落', weekly_boss_drop: '周本掉落', event: '活动材料',
}

function defaultSkillTable() {
  return { rows: [{ label: '', values: Array(15).fill('') }] }
}

export default function CharacterDetailPage() {
  const { id } = useParams()
  return (
    <PageMemoryProvider pageKey={`character_${id}`}>
      <CharacterDetailContent />
    </PageMemoryProvider>
  )
}

function CharacterDetailContent() {
  const { id } = useParams()
  const { query, importImage } = useDb()
  const { backToList, consumeBackToList } = useNav()
  const [character, setCharacter] = useState(null)
  const [elements, setElements] = useState([])
  const [weaponTypes, setWeaponTypes] = useState([])
  const [regions, setRegions] = useState([])
  const [talents, setTalents] = useState([])
  const [constellations, setConstellations] = useState([])
  const [outfits, setOutfits] = useState([])
  const [stories, setStories] = useState([])
  const [ascMats, setAscMats] = useState([])
  const [talentMats, setTalentMats] = useState([])
  const [allMaterials, setAllMaterials] = useState([])
  const [loading, setLoading] = useState(true)
  const defaultSections = { info: true, talents: true, constellations: true, materials: true, lore: true, outfits: true, dish: true, namecard: true, gallery: true }
  const [visible, setVisible] = useDetailState('sections', defaultSections)
  // 合并默认值：旧存档中缺失的 key 使用默认值（如新增的 namecard 默认为 true）
  const effectiveVisible = { ...defaultSections, ...visible }
  const toggle = (key) => setVisible(prev => ({ ...prev, [key]: !prev[key] }))

  // Edit modals
  const [editCharacter, setEditCharacter] = useState(false)
  const [editTalent, setEditTalent] = useState(null)
  const [editCon, setEditCon] = useState(null)
  const [editOutfit, setEditOutfit] = useState(null)
  const [editDish, setEditDish] = useState(false)
  const [editNamecard, setEditNamecard] = useState(false)
  const [namecardName, setNamecardName] = useState('')
  const [namecardDesc, setNamecardDesc] = useState('')
  const [editStory, setEditStory] = useState(null)
  const [editAscMat, setEditAscMat] = useState(null)
  const [editTalentMat, setEditTalentMat] = useState(null)
  const [form, setForm] = useState({})
  const [dish, setDish] = useState({ name_zh: '', description_zh: '', effect: '', image: null })
  const [gallery, setGallery] = useState([])   // 自定义图库 [{label, filename}]
  const [saving, setSaving] = useState(false)
  const [activeOutfitId, setActiveOutfitId] = useState(null)  // 当前激活的时装 ID
  const [outfitDragOver, setOutfitDragOver] = useState({})   // { [outfitId]: true } — 时装卡片的拖放高亮
  const [statLevel, setStatLevel] = useDetailState('statLevel', 90) // 属性查看等级: 80/90/95/100
  const [travelerElement, setTravelerElement] = useDetailState('travelerElement', null) // 旅行者当前选中的元素
  useDetailScroll('character', id)  // 保存/恢复详情页滚动位置

  // 挂载时加载数据（状态恢复由 useDetailState 的懒初始化自动处理）
  useEffect(() => {
    consumeBackToList()
    loadAll()
  }, [id])

  // 注意：loadAll 的闭包中 travelerElement 可能不是最新值（由于异步 + 恢复覆盖）
  // 因此 loadAll 内通过 restoredRef 判断是否跳过默认值设置

  async function loadAll() {
    try {
      const [chars, elems, wtypes, regs, tals, cons, fits, mats] = await Promise.all([
        query('SELECT * FROM characters WHERE id = ?', [id]),
        query('SELECT * FROM elements'),
        query('SELECT * FROM weapon_types'),
        query('SELECT * FROM regions ORDER BY sort_order, id'),
        query('SELECT * FROM character_talents WHERE character_id = ? ORDER BY sort_order, type', [id]),
        query('SELECT * FROM character_constellations WHERE character_id = ? ORDER BY level', [id]),
        query('SELECT * FROM character_outfits WHERE character_id = ?', [id]),
        query('SELECT * FROM materials ORDER BY type, rarity DESC, name_zh'),
      ])
      let strs = { data: [] }
      try {
        strs = await query('SELECT * FROM character_stories WHERE character_id = ? ORDER BY sort_order', [id])
      } catch (e) {
        console.warn('character_stories table not available yet:', e.message)
      }
      let am = { data: [] }
      let tm = { data: [] }
      try {
        am = await query(
          `SELECT cam.*, m.name_zh AS material_name, m.type AS material_type, m.rarity, m.image
           FROM character_ascension_materials cam
           JOIN materials m ON cam.material_id = m.id
           WHERE cam.character_id = ?`, [id])
      } catch (e) {
        console.warn('character_ascension_materials table not available yet:', e.message)
      }
      try {
        tm = await query(
          `SELECT ctm.*, m.name_zh AS material_name, m.type AS material_type, m.rarity, m.image
           FROM character_talent_materials ctm
           JOIN materials m ON ctm.material_id = m.id
           WHERE ctm.character_id = ?`, [id])
      } catch (e) {
        console.warn('character_talent_materials table not available yet:', e.message)
      }
      if (chars.data && chars.data.length > 0) {
        const c = chars.data[0]
        setCharacter(c)
        setForm(c)
        // 旅行者默认选中第一个元素（useDetailState 已处理恢复，此处只处理首次进入）
        if (c.character_type === 'traveler' && !travelerElement) {
          setTravelerElement(TRAVELER_ELEMENTS[0])
        }
        // 从 user.json 的 outfitSelections 读取（user.json 是唯一来源）
        try {
          const uRes = await window.electronAPI?.getUserConfig()
          if (uRes?.success && uRes.config?.outfitSelections?.[c.id]) {
            setActiveOutfitId(uRes.config.outfitSelections[c.id])
          }
        } catch (_) {}
        if (c.dish_name) {
          setDish({ name_zh: c.dish_name || '', description_zh: c.dish_description || '', effect: c.dish_effect || '', image: c.dish_image || null })
        }
        if (c.namecard_name) {
          setNamecardName(c.namecard_name)
        } else {
          setNamecardName('')
        }
        if (c.namecard_description) {
          setNamecardDesc(c.namecard_description)
        } else {
          setNamecardDesc('')
        }
        if (c.gallery_images) {
          try { setGallery(JSON.parse(c.gallery_images)) } catch (_) { setGallery([]) }
        } else {
          setGallery([])
        }
      }
      setElements(elems.data || [])
      setWeaponTypes(wtypes.data || [])
      setRegions(regs.data || [])
      setTalents(tals.data || [])
      setConstellations(cons.data || [])
      setOutfits(fits.data || [])
      setStories(strs.data || [])
      setAscMats(am.data || [])
      setTalentMats(tm.data || [])
      setAllMaterials(mats.data || [])
    } catch (e) {
      console.error('Failed to load character detail:', e)
    } finally {
      setLoading(false)
    }
  }

  // ── Save character basics ──
  async function handleSaveCharacter() {
    if (saving) return
    setSaving(true)
    try {
      const newId = Number(form.id)
      const oldId = character.id
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
          await query('UPDATE wish_rate_ups SET item_id = ? WHERE item_id = ? AND item_type = ?', [newId, oldId, 'character'])
          await query('UPDATE wish_banner_items SET item_id = ? WHERE item_id = ? AND item_type = ?', [newId, oldId, 'character'])
        } finally {
          await query('PRAGMA foreign_keys = ON')
        }
      }
      const keys = Object.keys(form)
      const sets = keys.map(k => `${k} = ?`).join(', ')
      await query(`UPDATE characters SET ${sets} WHERE id = ?`, [...keys.map(k => form[k]), oldId])
      setEditCharacter(false)
      loadAll()
    } catch (e) {
      console.error('Save character failed:', e)
      alert('保存失败: ' + (e.message || '未知错误'))
    } finally {
      setSaving(false)
    }
  }

  // ── Save dish ──
  async function handleSaveDish() {
    if (saving) return
    setSaving(true)
    try {
      const keys = ['dish_name', 'dish_description', 'dish_effect', 'dish_image']
      const vals = [dish.name_zh || null, dish.description_zh || null, dish.effect || null, dish.image]
      await query(`UPDATE characters SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`, [...vals, character.id])
      setEditDish(false)
      await loadAll()
    } catch (e) {
      console.error('Save dish failed:', e)
      alert('保存失败: ' + (e.message || '未知错误'))
    } finally {
      setSaving(false)
    }
  }

  // ── Save namecard ──
  async function handleSaveNamecard() {
    if (saving) return
    setSaving(true)
    try {
      await query('UPDATE characters SET namecard_name = ?, namecard_description = ? WHERE id = ?', [namecardName || null, namecardDesc || null, character.id])
      setEditNamecard(false)
      await loadAll()
    } catch (e) {
      console.error('Save namecard failed:', e)
      alert('保存失败: ' + (e.message || '未知错误'))
    } finally {
      setSaving(false)
    }
  }

  // ── Gallery image management ──
  async function saveGallery(updated) {
    const json = updated.length > 0 ? JSON.stringify(updated) : null
    await query('UPDATE characters SET gallery_images = ? WHERE id = ?', [json, character.id])
  }

  async function addGalleryImage() {
    const filename = await importImage()
    if (!filename) return
    const updated = [...gallery, { label: filename, filename }]
    setGallery(updated)
    await saveGallery(updated)
  }

  async function removeGalleryImage(index) {
    if (!confirm('确定要删除这张图片吗？\n\n图片文件会保留在本地文件夹中。')) return
    const updated = gallery.filter((_, i) => i !== index)
    setGallery(updated)
    await saveGallery(updated)
  }

  // ── 图库拖拽导入 ──
  const [galleryDragOver, setGalleryDragOver] = useState(false)
  const [lightbox, setLightbox] = useState(null)  // { filename, label }

  function handleGalleryDragOver(e) {
    e.preventDefault()
    e.stopPropagation()
    setGalleryDragOver(true)
  }

  function handleGalleryDragLeave(e) {
    e.preventDefault()
    e.stopPropagation()
    // 仅在真正离开图库区域时取消高亮（避免进入子元素时闪烁）
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setGalleryDragOver(false)
    }
  }

  async function handleGalleryDrop(e) {
    e.preventDefault()
    e.stopPropagation()
    setGalleryDragOver(false)

    const files = e.dataTransfer?.files
    if (!files || files.length === 0) return

    // 处理所有拖入的图片文件
    const newImages = []
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue
      try {
        const result = await window.electronAPI?.importImageFile(file.path)
        if (result?.conflict) {
          alert(result.message)
          continue
        }
        if (result?.filename) {
          newImages.push({ label: result.filename, filename: result.filename })
        }
      } catch (_) { /* skip failed imports */ }
    }
    if (newImages.length > 0) {
      const updated = [...gallery, ...newImages]
      setGallery(updated)
      await saveGallery(updated)
    }
  }

  // ── Talent CRUD ──
  async function handleSaveTalent() {
    if (saving) return
    setSaving(true)
    try {
      const skillTable = editTalent.skill_table ? JSON.stringify(editTalent.skill_table) : null
      const elemId = isTraveler ? ('element_id' in editTalent ? editTalent.element_id : travelerElement) : null
      if (editTalent.id) {
        await query('UPDATE character_talents SET name_zh=?, description_zh=?, type=?, icon=?, sort_order=?, skill_table=?, element_id=? WHERE id=?',
          [editTalent.name_zh, editTalent.description_zh || null, editTalent.type, editTalent.icon || null, editTalent.sort_order || 0, skillTable, elemId, editTalent.id])
      } else {
        await query('INSERT INTO character_talents (character_id, name_zh, description_zh, type, icon, sort_order, skill_table, element_id) VALUES (?,?,?,?,?,?,?,?)',
          [character.id, editTalent.name_zh, editTalent.description_zh || null, editTalent.type, editTalent.icon || null, editTalent.sort_order || 0, skillTable, elemId])
      }
      setEditTalent(null)
      await loadAll()
    } catch (e) {
      console.error('Save talent failed:', e)
      alert('保存失败: ' + (e.message || '未知错误'))
    } finally {
      setSaving(false)
    }
  }

  async function deleteTalent(id) {
    if (!confirm('确定删除此技能？')) return
    try {
      await query('DELETE FROM character_talents WHERE id = ?', [id])
      await loadAll()
    } catch (e) {
      console.error('Delete talent failed:', e)
      alert('删除失败: ' + (e.message || '未知错误'))
    }
  }

  // ── Constellation CRUD ──
  async function handleSaveCon() {
    if (saving) return
    setSaving(true)
    try {
    const elemId = isTraveler ? ('element_id' in editCon ? editCon.element_id : travelerElement) : null
      if (editCon.id) {
        await query('UPDATE character_constellations SET name_zh=?, description_zh=?, icon=?, element_id=?, level=? WHERE id=?',
          [editCon.name_zh, editCon.description_zh || null, editCon.icon || null, elemId, editCon.level, editCon.id])
      } else {
        await query('INSERT INTO character_constellations (character_id, level, name_zh, description_zh, icon, element_id) VALUES (?,?,?,?,?,?)',
          [character.id, editCon.level || filteredCons.length + 1, editCon.name_zh, editCon.description_zh || null, editCon.icon || null, elemId])
      }
      setEditCon(null)
      await loadAll()
    } catch (e) {
      console.error('Save constellation failed:', e)
      alert('保存失败: ' + (e.message || '未知错误'))
    } finally {
      setSaving(false)
    }
  }

  async function deleteCon(id) {
    if (!confirm('确定删除此命座？')) return
    try {
      await query('DELETE FROM character_constellations WHERE id = ?', [id])
      await loadAll()
    } catch (e) {
      console.error('Delete constellation failed:', e)
      alert('删除失败: ' + (e.message || '未知错误'))
    }
  }

  // ── Outfit CRUD ──
  async function handleSaveOutfit() {
    if (saving) return
    setSaving(true)
    try {
      if (editOutfit.id) {
        await query('UPDATE character_outfits SET name_zh=?, description_zh=?, image=?, avatar_image=? WHERE id=?',
          [editOutfit.name_zh, editOutfit.description_zh || null, editOutfit.image || null, editOutfit.avatar_image || null, editOutfit.id])
      } else {
        await query('INSERT INTO character_outfits (character_id, name_zh, description_zh, image, avatar_image, is_default) VALUES (?,?,?,?,?,?)',
          [character.id, editOutfit.name_zh, editOutfit.description_zh || null, editOutfit.image || null, editOutfit.avatar_image || null, outfits.length === 0 ? 1 : 0])
      }
      setEditOutfit(null)
      await loadAll()
    } catch (e) {
      console.error('Save outfit failed:', e)
      alert('保存失败: ' + (e.message || '未知错误'))
    } finally {
      setSaving(false)
    }
  }

  async function deleteOutfit(id) {
    if (!confirm('确定删除此时装？')) return
    try {
      await query('DELETE FROM character_outfits WHERE id = ?', [id])
      await loadAll()
    } catch (e) {
      console.error('Delete outfit failed:', e)
      alert('删除失败: ' + (e.message || '未知错误'))
    }
  }

  // ── Story CRUD ──
  async function handleSaveStory() {
    if (saving) return
    setSaving(true)
    try {
      if (editStory.id) {
        await query('UPDATE character_stories SET title_zh=?, content=?, sort_order=? WHERE id=?',
          [editStory.title_zh, editStory.content || null, editStory.sort_order || 0, editStory.id])
      } else {
        await query('INSERT INTO character_stories (character_id, title_zh, content, sort_order) VALUES (?,?,?,?)',
          [character.id, editStory.title_zh, editStory.content || null, editStory.sort_order || stories.length + 1])
      }
      setEditStory(null)
      await loadAll()
    } catch (e) {
      console.error('Save story failed:', e)
      alert('保存失败: ' + (e.message || '未知错误'))
    } finally {
      setSaving(false)
    }
  }

  async function deleteStory(id) {
    if (!confirm('确定删除此故事？')) return
    try {
      await query('DELETE FROM character_stories WHERE id = ?', [id])
      await loadAll()
    } catch (e) {
      console.error('Delete story failed:', e)
      alert('删除失败: ' + (e.message || '未知错误'))
    }
  }

  // ── Ascension Material CRUD ──
  async function handleSaveAscMat() {
    if (saving) return
    setSaving(true)
    try {
      const elemId = isTraveler ? ('element_id' in editAscMat ? editAscMat.element_id : travelerElement) : null
      if (editAscMat.id) {
        await query('UPDATE character_ascension_materials SET material_id=?, quantity=?, element_id=? WHERE id=?',
          [editAscMat.material_id, editAscMat.quantity || null, elemId, editAscMat.id])
      } else {
        await query('INSERT INTO character_ascension_materials (character_id, material_id, quantity, element_id) VALUES (?,?,?,?) ON CONFLICT(character_id, material_id) DO UPDATE SET quantity=excluded.quantity, element_id=excluded.element_id',
          [character.id, editAscMat.material_id, editAscMat.quantity || null, elemId])
      }
      setEditAscMat(null)
      await loadAll()
    } catch (e) {
      console.error('Save ascension material failed:', e)
      alert('保存失败: ' + (e.message || '未知错误'))
    } finally {
      setSaving(false)
    }
  }

  async function deleteAscMat(id) {
    if (!confirm('确定删除此素材？')) return
    try {
      await query('DELETE FROM character_ascension_materials WHERE id = ?', [id])
      await loadAll()
    } catch (e) {
      console.error('Delete ascension material failed:', e)
      alert('删除失败: ' + (e.message || '未知错误'))
    }
  }

  // ── Talent Material CRUD ──
  async function handleSaveTalentMat() {
    if (saving) return
    setSaving(true)
    try {
      const elemId = isTraveler ? ('element_id' in editTalentMat ? editTalentMat.element_id : travelerElement) : null
      if (editTalentMat.id) {
        await query('UPDATE character_talent_materials SET material_id=?, quantities=?, element_id=? WHERE id=?',
          [editTalentMat.material_id, editTalentMat.quantities || null, elemId, editTalentMat.id])
      } else {
        await query('INSERT INTO character_talent_materials (character_id, material_id, quantities, element_id) VALUES (?,?,?,?)',
          [character.id, editTalentMat.material_id, editTalentMat.quantities || null, elemId])
      }
      setEditTalentMat(null)
      await loadAll()
    } catch (e) {
      console.error('Save talent material failed:', e)
      alert('保存失败: ' + (e.message || '未知错误'))
    } finally {
      setSaving(false)
    }
  }

  async function deleteTalentMat(id) {
    if (!confirm('确定删除此素材？')) return
    try {
      await query('DELETE FROM character_talent_materials WHERE id = ?', [id])
      await loadAll()
    } catch (e) {
      console.error('Delete talent material failed:', e)
      alert('删除失败: ' + (e.message || '未知错误'))
    }
  }
  // ── Loading / not found ──
  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-primary-500 border-t-transparent animate-spin" />
      </div>
    )
  }

  if (!character) {
    return (
      <div className="p-8 text-center text-surface-500">
        角色未找到
        <button onClick={() => backToList('/characters')} className="ml-2 text-primary-400 hover:underline">返回列表</button>
      </div>
    )
  }

  const elemColor = ELEMENT_COLORS[character.element_id] || { bg: 'bg-surface-800', text: 'text-surface-300', border: 'border-surface-600', glow: '' }
  const wt = weaponTypes.find(w => w.id === character.weapon_type_id)
  const reg = regions.find(r => r.id === character.region_id)
  const elementName = elements.find(e => e.id === character.element_id)?.name_zh

  // 旅行者：按当前元素过滤
  const isTraveler = character.character_type === 'traveler'
  const activeElem = (isTraveler && travelerElement) ? travelerElement : null
  const filteredTalents = activeElem ? talents.filter(t => t.element_id == null || t.element_id === activeElem) : talents
  const filteredCons = activeElem ? constellations.filter(c => c.element_id == null || c.element_id === activeElem) : constellations
  const filteredAscMats = activeElem ? ascMats.filter(m => m.element_id == null || m.element_id === activeElem) : ascMats
  const filteredTalentMats = activeElem ? talentMats.filter(m => m.element_id == null || m.element_id === activeElem) : talentMats

  // ── Render ──
  return (
    <div className="animate-fade-in">
      {/* ─── Banner ─── */}
      <div
        className={`relative px-8 py-10 border-b ${elemColor.border} overflow-hidden`}
        style={character.namecard_art ? {} : { background: elemColor.bg === 'bg-surface-800' ? undefined : undefined }}
      >
        {character.namecard_art && <BannerBg filename={character.namecard_art} />}
        <div className={`absolute inset-0 ${character.namecard_art ? 'bg-surface-950/60 backdrop-blur-[2px]' : elemColor.bg}`} />
        <button
          onClick={() => backToList('/characters')}
          className="relative z-10 inline-flex items-center gap-1.5 text-xs text-surface-400 hover:text-white transition-colors mb-6"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          返回角色列表
        </button>

        <div className="relative z-10 flex items-start justify-between">
          <div className="flex items-start gap-6">
            <div
              className={`w-28 h-28 rounded-2xl bg-surface-800/50 border ${elemColor.border} flex items-center justify-center flex-shrink-0 overflow-hidden ${elemColor.glow} shadow-lg cursor-pointer hover:scale-105 transition-transform`}
              onClick={() => {
                const activeOutfit = outfits.find(o => o.id === activeOutfitId)
                const img = (activeOutfit?.avatar_image) || character.card_art || character.splash_art
                if (img) setLightbox({ filename: img, label: character.name_zh })
              }}
            >
              {(outfits.find(o => o.id === activeOutfitId)?.avatar_image) ? (
                <LocalImage filename={outfits.find(o => o.id === activeOutfitId).avatar_image} className="w-full h-full object-cover" />
              ) : character.card_art ? (
                <LocalImage filename={character.card_art} className="w-full h-full object-cover" />
              ) : character.splash_art ? (
                <LocalImage filename={character.splash_art} className="w-full h-full object-cover" />
              ) : (
                <span className={`text-5xl font-bold ${elemColor.text}`}>{character.name_zh[0]}</span>
              )}
            </div>
            <div>
              <div className="flex items-center gap-3 mb-1">
                <h1 className="text-2xl font-bold tracking-tight">{character.name_zh}</h1>
                <span className="text-accent-gold text-sm">{character.rarity === 5 ? '★★★★★' : '★★★★'}</span>
              </div>
              {character.title_zh && (
                <p className={`text-sm ${elemColor.text} mb-3`}>{character.title_zh}</p>
              )}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-surface-400">
                {elementName && <span className="flex items-center gap-1"><Zap className="w-3 h-3" />{elementName}</span>}
                {wt && <span className="flex items-center gap-1"><Sword className="w-3 h-3" />{wt.name_zh}</span>}
                {reg && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{reg.name_zh}</span>}
                {character.birthday && <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{character.birthday}</span>}
                {character.affiliation && <span className="flex items-center gap-1"><User className="w-3 h-3" />{character.affiliation}</span>}
              </div>
            </div>
          </div>
          <button
            onClick={() => setEditCharacter(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs text-white/80 transition-colors"
          >
            <Edit3 className="w-3.5 h-3.5" />
            编辑资料
          </button>
        </div>
      </div>

      {/* ─── Section Manager ─── */}
      <div className="px-8 py-3 border-b border-surface-800 bg-surface-900/50 flex items-center gap-2 flex-wrap">
        <span className="text-[11px] text-surface-500 mr-2">显示模块:</span>
        {Object.entries(SECTION_LABELS).map(([key, label]) => (
          <button
            key={key}
            onClick={() => toggle(key)}
            className={`px-2.5 py-1 rounded-md text-[11px] transition-colors ${
              visible[key]
                ? 'bg-primary-500/15 text-primary-400 border border-primary-500/20'
                : 'bg-surface-800 text-surface-500 border border-transparent hover:text-surface-300'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ─── Content Sections ─── */}
      <div className="px-8 py-6 space-y-8 max-w-5xl">
        {/* Basic Info */}
        {effectiveVisible.info && (
          <SectionCard icon={<Info className="w-4 h-4" />} title="基本信息" onEdit={() => setEditCharacter(true)}>
            <p className="text-sm text-surface-300 leading-relaxed"><ColoredText text={character.description_zh || '暂无简介'} /></p>
            {character.name_en && <p className="text-xs text-surface-500 mt-2">英文名: {character.name_en}</p>}
            {character.constellation_zh && <p className="text-xs text-surface-500 mt-1">命之座: {character.constellation_zh}</p>}

            {/* 角色属性 ── 等级滑块 */}
            <div className="mt-4 pt-4 border-t border-surface-700/50">
              <h4 className="text-xs font-semibold text-surface-400 uppercase tracking-wider mb-3">角色属性</h4>

              {/* 旅行者元素滑块 */}
              {character.character_type === 'traveler' && (
                <div className="flex items-center gap-2 mb-4">
                  <span className="text-xs text-surface-500">元素:</span>
                  <div className="flex items-center rounded-lg bg-surface-800 border border-surface-700 p-0.5">
                    {TRAVELER_ELEMENTS.map(eid => {
                      const el = elements.find(e => e.id === eid)
                      return (
                        <button
                          key={eid}
                          onClick={() => setTravelerElement(eid)}
                          className={`px-3 py-1 rounded-md text-xs transition-colors ${
                            travelerElement === eid
                              ? 'bg-primary-500/20 text-primary-400 font-medium'
                              : 'text-surface-400 hover:text-surface-200'
                          }`}
                        >
                          {el?.name_zh || eid}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* 等级滑块 */}
              <div className="flex items-center gap-2 mb-4">
                <span className="text-xs text-surface-500">等级:</span>
                <div className="flex items-center rounded-lg bg-surface-800 border border-surface-700 p-0.5">
                  {[80, 90, 95, 100].map(lv => (
                    <button
                      key={lv}
                      onClick={() => setStatLevel(lv)}
                      className={`px-3 py-1 rounded-md text-xs transition-colors ${
                        statLevel === lv
                          ? 'bg-primary-500/20 text-primary-400 font-medium'
                          : 'text-surface-400 hover:text-surface-200'
                      }`}
                    >
                      {lv}级
                    </button>
                  ))}
                </div>
              </div>
              {/* 对应等级属性 */}
              <div className="grid grid-cols-3 gap-3 text-xs mb-3">
                <div className="bg-surface-800/50 rounded-lg px-3 py-2">
                  <span className="text-surface-500">{statLevel}级生命值</span>
                  <p className="text-white font-medium mt-0.5">
                    {getLevelStat(character, statLevel, 'hp')?.toLocaleString() || '-'}
                  </p>
                </div>
                <div className="bg-surface-800/50 rounded-lg px-3 py-2">
                  <span className="text-surface-500">{statLevel}级攻击力</span>
                  <p className="text-white font-medium mt-0.5">
                    {getLevelStat(character, statLevel, 'atk') ?? '-'}
                  </p>
                </div>
                <div className="bg-surface-800/50 rounded-lg px-3 py-2">
                  <span className="text-surface-500">{statLevel}级防御力</span>
                  <p className="text-white font-medium mt-0.5">
                    {getLevelStat(character, statLevel, 'def') ?? '-'}
                  </p>
                </div>
              </div>
              {/* 突破属性 */}
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="bg-surface-800/50 rounded-lg px-3 py-2">
                  <span className="text-surface-500">突破属性</span>
                  <p className="text-white font-medium mt-0.5">{character.ascension_stat || '-'}</p>
                </div>
                <div className="bg-surface-800/50 rounded-lg px-3 py-2">
                  <span className="text-surface-500">突破属性值</span>
                  <p className="text-white font-medium mt-0.5">
                    {character.ascension_stats || '-'}
                  </p>
                </div>
              </div>
            </div>
          </SectionCard>
        )}

        {/* Talents */}
        {effectiveVisible.talents && (
          <SectionCard
            icon={<BookOpen className="w-4 h-4" />}
            title="天赋技能"
            onAdd={() => setEditTalent({ name_zh: '', description_zh: '', type: 'normal_attack', icon: null, sort_order: filteredTalents.length + 1, skill_table: defaultSkillTable() })}
            count={filteredTalents.length}
          >
            <div className="space-y-4">
              {TALENT_TYPE_ORDER.map(typeKey => {
                const group = filteredTalents.filter(t => t.type === typeKey)
                if (group.length === 0) return null
                const typeInfo = TALENT_TYPES[typeKey]
                return (
                  <div key={typeKey}>
                    <h4 className={`text-xs font-semibold uppercase tracking-wider mb-2 ${typeInfo.color.split(' ')[1] || 'text-surface-400'}`}>
                      {typeInfo.label}
                    </h4>
                    <div className="space-y-2">
                      {group.map((t, i) => (
                        <TalentCard key={t.id} talent={t} index={typeKey === 'passive' ? i + 1 : null} onEdit={() => setEditTalent({
                          ...t,
                          skill_table: t.skill_table ? safeParseJSON(t.skill_table) : (t.type !== 'passive' ? defaultSkillTable() : null)
                        })} onDelete={() => deleteTalent(t.id)} />
                      ))}
                    </div>
                  </div>
                )
              })}
              {filteredTalents.length === 0 && <Empty text="暂无天赋数据" />}
            </div>
          </SectionCard>
        )}

        {/* Constellations */}
        {effectiveVisible.constellations && (
          <SectionCard
            icon={<Crown className="w-4 h-4" />}
            title={`命之座 · ${character.constellation_zh || '未设定'}`}
            onAdd={() => setEditCon({ name_zh: '', description_zh: '', level: filteredCons.length + 1, icon: null })}
            count={constellations.length}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {filteredCons.map(c => (
                <div key={c.id} className="p-4 rounded-xl bg-surface-800/50 border border-surface-700/50 hover:border-surface-600 transition-colors group">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {c.icon ? (
                        <LocalImage filename={c.icon} className="w-8 h-8 rounded-lg object-cover" />
                      ) : (
                        <div className="w-8 h-8 rounded-lg bg-accent-gold/10 border border-accent-gold/20 flex items-center justify-center">
                          <span className="text-accent-gold text-xs font-mono font-bold">{c.level}</span>
                        </div>
                      )}
                      <span className="text-sm font-medium">{c.level}. {c.name_zh}</span>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => setEditCon({ ...c })} className="p-1 text-surface-400 hover:text-primary-400"><Edit3 className="w-3 h-3" /></button>
                      <button onClick={() => deleteCon(c.id)} className="p-1 text-surface-400 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
                    </div>
                  </div>
                  {c.description_zh && <p className="text-xs text-surface-400 leading-relaxed"><ColoredText text={c.description_zh} /></p>}
                </div>
              ))}
            </div>
            {constellations.length === 0 && <Empty text="暂无命座数据" />}
          </SectionCard>
        )}

        {/* 培养素材 */}
        {effectiveVisible.materials && (
          <SectionCard icon={<FlaskConical className="w-4 h-4" />} title="培养素材">
            <div className="space-y-4">
              {/* 角色培养素材 */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-semibold text-surface-400 uppercase tracking-wider">角色培养素材</h4>
                  <button
                    onClick={() => setEditAscMat({ material_id: '', quantity: '' })}
                    className="p-1 rounded text-surface-400 hover:text-primary-400 hover:bg-surface-700 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
                {ascMats.length > 0 ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                    {filteredAscMats.map(m => (
                      <MaterialBadge key={m.id} material={m} onEdit={() => setEditAscMat({ ...m })} onDelete={() => deleteAscMat(m.id)} />
                    ))}
                  </div>
                ) : (
                  <Empty text="暂无角色培养素材数据" />
                )}
              </div>
              {/* 天赋培养素材 */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-semibold text-surface-400 uppercase tracking-wider">天赋培养素材</h4>
                  <button
                    onClick={() => setEditTalentMat({ material_id: '', material_type: '', quantities: '' })}
                    className="p-1 rounded text-surface-400 hover:text-primary-400 hover:bg-surface-700 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
                {talentMats.length > 0 ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                    {filteredTalentMats.map(m => (
                      <MaterialBadge key={m.id} material={m} onEdit={() => setEditTalentMat({ ...m })} onDelete={() => deleteTalentMat(m.id)} />
                    ))}
                  </div>
                ) : (
                  <Empty text="暂无天赋培养素材数据" />
                )}
              </div>
            </div>
          </SectionCard>
        )}

        {/* 角色故事 */}
        {effectiveVisible.lore && (
          <SectionCard
            icon={<Sparkles className="w-4 h-4" />}
            title="角色故事"
            onAdd={() => setEditStory({ title_zh: '', content: '', sort_order: stories.length + 1 })}
            count={stories.length}
            defaultCollapsed
          >
            <div className="space-y-3">
              {stories.map(s => (
                <div key={s.id} className="p-4 rounded-xl bg-surface-800/50 border border-surface-700/50 hover:border-surface-600 transition-colors group">
                  <div className="flex items-start justify-between mb-2">
                    <h4 className="text-sm font-semibold flex items-center gap-2">
                      <FileText className="w-3.5 h-3.5 text-primary-400" />
                      {s.title_zh}
                    </h4>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => setEditStory({ ...s })} className="p-1 text-surface-400 hover:text-primary-400"><Edit3 className="w-3 h-3" /></button>
                      <button onClick={() => deleteStory(s.id)} className="p-1 text-surface-400 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
                    </div>
                  </div>
                  {s.content && <p className="text-xs text-surface-400 leading-relaxed whitespace-pre-wrap"><ColoredText text={s.content} /></p>}
                </div>
              ))}
            </div>
            {stories.length === 0 && (
              <div>
                <Empty text="暂无角色故事。点击 + 添加角色故事模块。" />
              </div>
            )}
          </SectionCard>
        )}

        {/* Outfits */}
        {effectiveVisible.outfits && (
          <SectionCard
            icon={<Shirt className="w-4 h-4" />}
            title="时装"
            onAdd={() => setEditOutfit({ name_zh: '', description_zh: '', image: null })}
            count={outfits.length}
          >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {outfits.map(o => {
                const isSelected = o.id === activeOutfitId
                const isDragOver = !!outfitDragOver[o.id]
                // 默认时装自动继承角色默认立绘和头像
                const displayImage = o.image || (o.is_default ? character.splash_art : null)
                const displayAvatar = o.avatar_image || (o.is_default ? character.card_art : null)
                return (
                <div key={o.id} className={`rounded-xl bg-surface-800/50 border overflow-hidden group transition-all duration-200 flex flex-col
                  ${isSelected
                    ? 'border-primary-500 ring-1 ring-primary-500/30 shadow-lg shadow-primary-500/10'
                    : isDragOver
                    ? 'border-primary-400 ring-1 ring-primary-400/20 bg-primary-500/5'
                    : 'border-surface-700 hover:border-surface-600'}
                `}>
                  {/* 时装主图（点击放大） */}
                  <div
                    className="aspect-[3/4] bg-surface-700 flex items-center justify-center overflow-hidden relative cursor-pointer"
                    onClick={() => displayImage && setLightbox({ filename: displayImage, label: o.name_zh })}
                  >
                    {displayImage ? (
                      <LocalImage filename={displayImage} className="w-full h-full object-cover" />
                    ) : (
                      <Image className="w-8 h-8 text-surface-500" />
                    )}
                    {/* 头像缩略图（左下角，可点击放大） */}
                    {displayAvatar && (
                      <div
                        className="absolute left-2 bottom-2 w-10 h-10 rounded-lg border-2 border-surface-500/60 overflow-hidden bg-surface-800 shadow-md cursor-pointer hover:scale-110 transition-transform z-10"
                        onClick={e => { e.stopPropagation(); setLightbox({ filename: displayAvatar, label: `${o.name_zh} 头像` }) }}
                      >
                        <LocalImage filename={displayAvatar} className="w-full h-full object-cover" />
                      </div>
                    )}
                    <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={e => { e.stopPropagation(); setEditOutfit({ ...o }) }} className="p-1.5 rounded-lg bg-black/60 text-white/80 hover:text-white"><Edit3 className="w-3 h-3" /></button>
                      <button onClick={e => { e.stopPropagation(); deleteOutfit(o.id) }} className="p-1.5 rounded-lg bg-black/60 text-white/80 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
                    </div>
                    {/* 拖放导入头像覆盖层 */}
                    <div
                      className={`absolute inset-0 flex items-center justify-center transition-colors pointer-events-none
                        ${isDragOver ? 'bg-primary-500/20 z-10' : ''}`}
                    >
                      {isDragOver && (
                        <div className="flex flex-col items-center gap-1 pointer-events-none">
                          <Upload className="w-6 h-6 text-primary-300" />
                          <span className="text-[10px] text-primary-300 font-medium">导入头像</span>
                        </div>
                      )}
                    </div>
                  </div>
                  {/* 信息栏（点击切换激活时装，支持拖放导入头像） */}
                  <div
                    className={`p-3 transition-colors cursor-pointer flex-1
                      ${isSelected
                        ? 'bg-primary-500/5'
                        : isDragOver
                        ? 'bg-primary-500/5'
                        : 'hover:bg-surface-700/40'}
                    `}
                    onClick={async () => {
                      const newId = isSelected ? null : o.id
                      setActiveOutfitId(newId)
                      try {
                        // 只写入 user.json（单一来源）
                        const uRes = await window.electronAPI?.getUserConfig()
                        const prevSelections = uRes?.config?.outfitSelections || {}
                        const nextSelections = { ...prevSelections, [character.id]: newId }
                        if (!newId) delete nextSelections[character.id]
                        await window.electronAPI?.setUserConfig('outfitSelections', nextSelections)
                      } catch (_) {}
                    }}
                    onDragOver={e => {
                      e.preventDefault(); e.stopPropagation()
                      setOutfitDragOver(prev => ({ ...prev, [o.id]: true }))
                    }}
                    onDragLeave={e => {
                      e.preventDefault(); e.stopPropagation()
                      if (!e.currentTarget.contains(e.relatedTarget)) {
                        setOutfitDragOver(prev => ({ ...prev, [o.id]: false }))
                      }
                    }}
                    onDrop={async e => {
                      e.preventDefault(); e.stopPropagation()
                      setOutfitDragOver(prev => ({ ...prev, [o.id]: false }))
                      const files = e.dataTransfer?.files
                      if (!files || files.length === 0) return
                      for (const file of files) {
                        if (!file.type.startsWith('image/')) continue
                        try {
                          const result = await window.electronAPI?.importImageFile(file.path)
                          if (result?.filename) {
                            await query('UPDATE character_outfits SET avatar_image = ? WHERE id = ?', [result.filename, o.id])
                            if (isSelected) setCharacter(prev => ({ ...prev }))
                            await loadAll()
                          }
                        } catch (_) {}
                      }
                    }}
                  >
                    <p className="text-xs font-medium pointer-events-none">{o.name_zh}</p>
                    <p className={`text-[10px] mt-0.5 pointer-events-none ${isSelected ? 'text-primary-300' : 'text-surface-500'}`}>
                      <ColoredText text={o.description_zh || '无描述'} />
                    </p>
                    {/* 导入头像按钮（非默认时装且无头像时显示） */}
                    {!o.is_default && !o.avatar_image && (
                      <button
                        onClick={async e => {
                          e.stopPropagation()
                          const filename = await importImage()
                          if (!filename) return
                          await query('UPDATE character_outfits SET avatar_image = ? WHERE id = ?', [filename, o.id])
                          if (isSelected) setCharacter(prev => ({ ...prev }))
                          await loadAll()
                        }}
                        className="mt-1.5 text-[10px] text-surface-500 hover:text-primary-400 transition-colors flex items-center gap-1"
                      >
                        <Upload className="w-2.5 h-2.5" />导入头像
                      </button>
                    )}
                    {isSelected && (
                      <p className="text-[10px] text-primary-300 mt-1 flex items-center gap-1 pointer-events-none">
                        <CheckCircle2 className="w-3 h-3" />已作为头像
                      </p>
                    )}
                  </div>
                </div>
                )
              })}
            </div>
            {outfits.length === 0 && <Empty text="暂无时装数据" />}
          </SectionCard>
        )}

        {/* Specialty Dish */}
        {effectiveVisible.dish && (
          <SectionCard
            icon={<UtensilsCrossed className="w-4 h-4" />}
            title="特殊料理"
            onEdit={() => setEditDish(true)}
          >
            {dish.name_zh ? (
              <div className="flex items-start gap-4">
                <div
                  className="w-28 h-28 rounded-xl bg-surface-700 overflow-hidden flex-shrink-0 border border-surface-600 cursor-pointer hover:scale-105 transition-transform"
                  onClick={() => dish.image && setLightbox({ filename: dish.image, label: dish.name_zh || '特殊料理' })}
                >
                  {dish.image ? (
                    <DishImage filename={dish.image} />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <UtensilsCrossed className="w-8 h-8 text-surface-500" />
                    </div>
                  )}
                </div>
                <div>
                  <h3 className="text-sm font-semibold mb-1">{dish.name_zh}</h3>
                  {dish.description_zh && <p className="text-xs text-surface-400 leading-relaxed"><ColoredText text={dish.description_zh} /></p>}
                  {dish.effect && (
                    <div className="mt-2 pt-2 border-t border-surface-700">
                      <span className="text-[10px] text-surface-500 font-medium">效果</span>
                      <p className="text-xs text-surface-300 leading-relaxed mt-0.5"><ColoredText text={dish.effect} /></p>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <Empty text="暂未设置特殊料理" />
            )}
          </SectionCard>
        )}

        {/* Namecard */}
        {effectiveVisible.namecard && (
          <SectionCard
            icon={<Image className="w-4 h-4" />}
            title="名片"
            onEdit={() => setEditNamecard(true)}
          >
            {character.namecard_art ? (
              <div className="flex items-start gap-4">
                <div
                  className="w-40 rounded-xl bg-surface-700 overflow-hidden flex-shrink-0 border border-surface-600 cursor-pointer hover:scale-105 transition-transform"
                  onClick={() => character.namecard_art && setLightbox({ filename: character.namecard_art, label: namecardName || '名片' })}
                >
                  <LocalImage filename={character.namecard_art} className="w-full object-cover" />
                </div>
                <div className="flex-1 min-w-0">
                  {namecardName && <h3 className="text-sm font-semibold mb-1">{namecardName}</h3>}
                  {namecardDesc ? (
                    <p className="text-xs text-surface-400 leading-relaxed"><ColoredText text={namecardDesc} /></p>
                  ) : (
                    <Empty text="暂未设置名片简介" />
                  )}
                </div>
              </div>
            ) : (
              <Empty text="暂未设置名片" />
            )}
          </SectionCard>
        )}

        {/* Image Gallery */}
        {effectiveVisible.gallery && (
          <SectionCard icon={<Image className="w-4 h-4" />} title="图库">
            <div
              className={`grid grid-cols-2 md:grid-cols-4 gap-4 rounded-xl transition-colors p-1 -m-1
                ${galleryDragOver ? 'bg-primary-500/5 ring-2 ring-primary-500/30 rounded-xl' : ''}`}
              onDragOver={handleGalleryDragOver}
              onDragLeave={handleGalleryDragLeave}
              onDrop={handleGalleryDrop}
            >
              {character.splash_art && <ImageTile label="立绘" filename={character.splash_art} large onClick={() => setLightbox({ filename: character.splash_art, label: '立绘' })} />}
              {character.namecard_art && <ImageTile label="名片" filename={character.namecard_art} large onClick={() => setLightbox({ filename: character.namecard_art, label: '名片' })} />}
              {character.card_art && <ImageTile label="头像" filename={character.card_art} onClick={() => setLightbox({ filename: character.card_art, label: '头像' })} />}
              {/* 时装头像 */}
              {outfits.filter(o => o.avatar_image).map(o => (
                <ImageTile key={`outfit-avatar-${o.id}`} label={`${o.name_zh} 头像`} filename={o.avatar_image} onClick={() => setLightbox({ filename: o.avatar_image, label: `${o.name_zh} 头像` })} />
              ))}
              {dish.image && <ImageTile label="特殊料理" filename={dish.image} onClick={() => setLightbox({ filename: dish.image, label: dish.name_zh || '特殊料理' })} />}
              {/* 自定义图库图片 */}
              {gallery.map((img, i) => (
                <div key={i} className="relative group">
                  <ImageTile label={img.label} filename={img.filename} onClick={() => setLightbox({ filename: img.filename, label: img.label })} />
                  <button
                    onClick={() => removeGalleryImage(i)}
                    className="absolute top-1 right-1 p-1 rounded-lg bg-red-500/80 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
                    title="删除图片"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
              {/* 添加图片按钮（点击导入，或拖拽到图库任意位置） */}
              <button
                onClick={addGalleryImage}
                className={`aspect-square rounded-xl border-2 border-dashed transition-colors flex flex-col items-center justify-center gap-2
                  ${galleryDragOver
                    ? 'border-primary-500 bg-primary-500/10 text-primary-400'
                    : 'border-surface-600 hover:border-primary-500/50 hover:bg-surface-800/50 text-surface-500 hover:text-primary-400'
                  }`}
              >
                <Plus className="w-6 h-6" />
                <span className="text-[10px]">
                  {galleryDragOver ? '松开导入' : '添加图片'}
                </span>
              </button>
            </div>
            {!character.splash_art && !character.card_art && !character.namecard_art && !dish.image && !outfits.some(o => o.avatar_image) && gallery.length === 0 && (
              <Empty text="暂无图片" />
            )}
          </SectionCard>
        )}
      </div>

      {/* ═══ Modals ═══ */}

      {/* Character edit */}
      <EditModal isOpen={editCharacter} onClose={() => setEditCharacter(false)} onSave={handleSaveCharacter} saving={saving} title={`编辑角色 - ${character.name_zh}`}>
        <FormInput label="ID" value={form.id ?? 0} onChange={v => setForm({ ...form, id: v === '' ? 0 : Number(v) })} type="number" />
        <div className="grid grid-cols-2 gap-x-6">
          <FormInput label="中文名" value={form.name_zh} onChange={v => setForm({ ...form, name_zh: v })} />
          <FormInput label="英文名" value={form.name_en} onChange={v => setForm({ ...form, name_en: v })} />
          <FormInput label="称号" value={form.title_zh} onChange={v => setForm({ ...form, title_zh: v })} />
          <FormInput label="稀有度" value={form.rarity} onChange={v => setForm({ ...form, rarity: Number(v) })} type="number" />
          <FormSelect label="角色类型" value={form.character_type || 'normal'} onChange={v => setForm({ ...form, character_type: v })}
            options={[{ value: 'normal', label: '普通' }, { value: 'traveler', label: '旅行者' }]} />
          <FormSelect label="元素" value={form.element_id} onChange={v => setForm({ ...form, element_id: Number(v) })}
            options={elements.map(e => ({ value: e.id, label: e.name_zh }))} />
          <FormSelect label="武器类型" value={form.weapon_type_id} onChange={v => setForm({ ...form, weapon_type_id: Number(v) })}
            options={weaponTypes.map(w => ({ value: w.id, label: w.name_zh }))} />
          <FormSelect label="地区" value={form.region_id} onChange={v => setForm({ ...form, region_id: Number(v) })}
            options={regions.map(r => ({ value: r.id, label: r.name_zh }))} />
          <FormInput label="命之座名称" value={form.constellation_zh} onChange={v => setForm({ ...form, constellation_zh: v })} />
          <FormInput label="生日" value={form.birthday} onChange={v => setForm({ ...form, birthday: v })} />
          <FormInput label="上线时间" value={form.release_date} onChange={v => setForm({ ...form, release_date: v })} placeholder="YYYY-MM-DD" />
          <FormInput label="所属" value={form.affiliation} onChange={v => setForm({ ...form, affiliation: v })} />
        </div>
        <FormInput label="简介" value={form.description_zh} onChange={v => setForm({ ...form, description_zh: v })} multiline />
        {/* 角色属性 */}
        <div className="mt-2 pt-3 border-t border-surface-700">
          <h4 className="text-xs font-semibold text-surface-400 mb-3">角色属性</h4>
          <div className="grid grid-cols-3 gap-x-4 mb-2">
            <FormInput label="80级生命值" value={form.hp_80} onChange={v => setForm({ ...form, hp_80: v ? Number(v) : null })} type="number" />
            <FormInput label="80级攻击力" value={form.atk_80} onChange={v => setForm({ ...form, atk_80: v ? Number(v) : null })} type="number" />
            <FormInput label="80级防御力" value={form.def_80} onChange={v => setForm({ ...form, def_80: v ? Number(v) : null })} type="number" />
          </div>
          <div className="grid grid-cols-3 gap-x-4 mb-2">
            <FormInput label="90级生命值" value={form.hp_90} onChange={v => setForm({ ...form, hp_90: v ? Number(v) : null })} type="number" />
            <FormInput label="90级攻击力" value={form.atk_90} onChange={v => setForm({ ...form, atk_90: v ? Number(v) : null })} type="number" />
            <FormInput label="90级防御力" value={form.def_90} onChange={v => setForm({ ...form, def_90: v ? Number(v) : null })} type="number" />
          </div>
          <div className="grid grid-cols-3 gap-x-4 mb-2">
            <FormInput label="95级生命值" value={form.hp_95} onChange={v => setForm({ ...form, hp_95: v ? Number(v) : null })} type="number" />
            <FormInput label="95级攻击力" value={form.atk_95} onChange={v => setForm({ ...form, atk_95: v ? Number(v) : null })} type="number" />
            <FormInput label="95级防御力" value={form.def_95} onChange={v => setForm({ ...form, def_95: v ? Number(v) : null })} type="number" />
          </div>
          <div className="grid grid-cols-3 gap-x-4 mb-2">
            <FormInput label="100级生命值" value={form.hp_100} onChange={v => setForm({ ...form, hp_100: v ? Number(v) : null })} type="number" />
            <FormInput label="100级攻击力" value={form.atk_100} onChange={v => setForm({ ...form, atk_100: v ? Number(v) : null })} type="number" />
            <FormInput label="100级防御力" value={form.def_100} onChange={v => setForm({ ...form, def_100: v ? Number(v) : null })} type="number" />
          </div>
          <div className="grid grid-cols-2 gap-x-4">
            <FormInput label="突破属性" value={form.ascension_stat} onChange={v => setForm({ ...form, ascension_stat: v })} placeholder="例: 暴击率" />
            <FormInput label="突破属性值" value={form.ascension_stats} onChange={v => setForm({ ...form, ascension_stats: v })} placeholder="例: 28.8%" />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-x-6 mt-4">
          <ImagePicker label="立绘" currentImage={form.splash_art} onSelect={v => setForm({ ...form, splash_art: v })} onRemove={() => setForm({ ...form, splash_art: null })} />
          <ImagePicker label="头像" currentImage={form.card_art} onSelect={v => setForm({ ...form, card_art: v })} onRemove={() => setForm({ ...form, card_art: null })} />
          <ImagePicker label="名片" currentImage={form.namecard_art} onSelect={v => setForm({ ...form, namecard_art: v })} onRemove={() => setForm({ ...form, namecard_art: null })} />
        </div>
      </EditModal>

      {/* Talent edit */}
      {editTalent && (
        <EditModal isOpen={!!editTalent} onClose={() => setEditTalent(null)} onSave={handleSaveTalent} saving={saving} title={editTalent.id ? '编辑技能' : '添加技能'} wide>
          <div className="grid grid-cols-2 gap-x-6">
            <FormInput label="技能名称" value={editTalent.name_zh} onChange={v => setEditTalent({ ...editTalent, name_zh: v })} />
            <FormSelect label="类型" value={editTalent.type} onChange={v => setEditTalent({ ...editTalent, type: v })}
              options={Object.entries(TALENT_TYPES).map(([k, v]) => ({ value: k, label: v.label }))} />
            <FormInput label="排序 (数字)" value={editTalent.sort_order} onChange={v => setEditTalent({ ...editTalent, sort_order: Number(v) })} type="number" />
            {isTraveler && (
              <FormSelect label="所属元素" value={'element_id' in editTalent ? (editTalent.element_id === null ? '__all__' : editTalent.element_id) : (travelerElement ?? '')} onChange={v => setEditTalent({ ...editTalent, element_id: (v === '__all__' || !v) ? null : Number(v) })}
                options={[
                  { value: '__all__', label: '全部' },
                  ...TRAVELER_ELEMENTS.map(eid => {
                    const el = elements.find(e => e.id === eid)
                    return { value: eid, label: el?.name_zh || String(eid) }
                  })
                ]} />
            )}
          </div>
          <FormInput label="描述" value={editTalent.description_zh} onChange={v => setEditTalent({ ...editTalent, description_zh: v })} multiline />
          <ImagePicker label="技能图标" currentImage={editTalent.icon} onSelect={v => setEditTalent({ ...editTalent, icon: v })} onRemove={() => setEditTalent({ ...editTalent, icon: null })} />

          {/* 技能数值表格 (非固有天赋) */}
          {editTalent.type !== 'passive' && (
            <div className="mt-3 pt-3 border-t border-surface-700">
              <h4 className="text-xs font-semibold text-surface-400 mb-3">技能数值 (1级 ~ 15级)</h4>
              <SkillTable
                data={editTalent.skill_table || defaultSkillTable()}
                onChange={st => setEditTalent({ ...editTalent, skill_table: st })}
              />
            </div>
          )}
        </EditModal>
      )}

      {/* Constellation edit */}
      {editCon && (
        <EditModal isOpen={!!editCon} onClose={() => setEditCon(null)} onSave={handleSaveCon} saving={saving} title={editCon.id ? '编辑命座' : '添加命座'}>
          <div className="grid grid-cols-2 gap-x-6">
            <FormInput label="命座名称" value={editCon.name_zh} onChange={v => setEditCon({ ...editCon, name_zh: v })} />
            <FormInput label="层级 (1-6)" value={editCon.level} onChange={v => setEditCon({ ...editCon, level: Number(v) })} type="number" />
            {isTraveler && (
              <FormSelect label="所属元素" value={'element_id' in editCon ? (editCon.element_id === null ? '__all__' : editCon.element_id) : (travelerElement ?? '')} onChange={v => setEditCon({ ...editCon, element_id: (v === '__all__' || !v) ? null : Number(v) })}
                options={[
                  { value: '__all__', label: '全部' },
                  ...TRAVELER_ELEMENTS.map(eid => {
                    const el = elements.find(e => e.id === eid)
                    return { value: eid, label: el?.name_zh || String(eid) }
                  })
                ]} />
            )}
          </div>
          <FormInput label="描述" value={editCon.description_zh} onChange={v => setEditCon({ ...editCon, description_zh: v })} multiline />
          <ImagePicker label="命座图标" currentImage={editCon.icon} onSelect={v => setEditCon({ ...editCon, icon: v })} onRemove={() => setEditCon({ ...editCon, icon: null })} />
        </EditModal>
      )}

      {/* Outfit edit */}
      {editOutfit && (
        <EditModal isOpen={!!editOutfit} onClose={() => setEditOutfit(null)} onSave={handleSaveOutfit} saving={saving} title={editOutfit.id ? '编辑时装' : '添加时装'}>
          <FormInput label="名称" value={editOutfit.name_zh} onChange={v => setEditOutfit({ ...editOutfit, name_zh: v })} />
          <FormInput label="描述" value={editOutfit.description_zh} onChange={v => setEditOutfit({ ...editOutfit, description_zh: v })} multiline />
          <ImagePicker label="时装图片" currentImage={editOutfit.image} onSelect={v => setEditOutfit({ ...editOutfit, image: v })} onRemove={() => setEditOutfit({ ...editOutfit, image: null })} />
          <ImagePicker label="头像图片" currentImage={editOutfit.avatar_image} onSelect={v => setEditOutfit({ ...editOutfit, avatar_image: v })} onRemove={() => setEditOutfit({ ...editOutfit, avatar_image: null })} />
        </EditModal>
      )}

      {/* Dish edit */}
      {editDish && (
        <EditModal isOpen={editDish} onClose={() => setEditDish(false)} onSave={handleSaveDish} saving={saving} title={`特殊料理 - ${character.name_zh}`}>
          <FormInput label="料理名称" value={dish.name_zh} onChange={v => setDish({ ...dish, name_zh: v })} />
          <FormInput label="料理描述" value={dish.description_zh} onChange={v => setDish({ ...dish, description_zh: v })} multiline />
          <FormInput label="料理效果" value={dish.effect} onChange={v => setDish({ ...dish, effect: v })} multiline />
          <ImagePicker label="料理图片" currentImage={dish.image} onSelect={v => setDish({ ...dish, image: v })} onRemove={() => setDish({ ...dish, image: null })} />
        </EditModal>
      )}

      {/* Namecard edit */}
      {editNamecard && (
        <EditModal isOpen={editNamecard} onClose={() => setEditNamecard(false)} onSave={handleSaveNamecard} saving={saving} title={`名片编辑 - ${character.name_zh}`}>
          <FormInput label="名片名称" value={namecardName} onChange={setNamecardName} />
          <FormInput label="名片简介" value={namecardDesc} onChange={setNamecardDesc} multiline />
        </EditModal>
      )}

      {/* Story edit */}
      {editStory && (
        <EditModal isOpen={!!editStory} onClose={() => setEditStory(null)} onSave={handleSaveStory} saving={saving} title={editStory.id ? '编辑故事' : '添加故事'}>
          <div className="grid grid-cols-2 gap-x-6">
            <FormInput label="故事标题" value={editStory.title_zh} onChange={v => setEditStory({ ...editStory, title_zh: v })} />
            <FormInput label="排序 (数字)" value={editStory.sort_order} onChange={v => setEditStory({ ...editStory, sort_order: Number(v) })} type="number" />
          </div>
          <FormInput label="故事内容" value={editStory.content} onChange={v => setEditStory({ ...editStory, content: v })} multiline />
        </EditModal>
      )}

      {/* Ascension Material edit */}
      {editAscMat && (
        <EditModal isOpen={!!editAscMat} onClose={() => setEditAscMat(null)} onSave={handleSaveAscMat} saving={saving} title={editAscMat.id ? '编辑角色培养素材' : '添加角色培养素材'}>
          <SearchSelect label="材料" value={editAscMat.material_id} onChange={v => setEditAscMat({ ...editAscMat, material_id: v ? Number(v) : '' })}
            options={allMaterials.map(m => ({ value: m.id, label: `${m.name_zh} (${MATERIAL_TYPE_ZH[m.type] || m.type})`, image: m.image }))} />
          <FormInput label="数量" value={editAscMat.quantity} onChange={v => setEditAscMat({ ...editAscMat, quantity: v })} placeholder="例: 168" />
          {isTraveler && (
            <FormSelect label="所属元素" value={'element_id' in editAscMat ? (editAscMat.element_id === null ? '__all__' : editAscMat.element_id) : (travelerElement ?? '')} onChange={v => setEditAscMat({ ...editAscMat, element_id: (v === '__all__' || !v) ? null : Number(v) })}
              options={[
                { value: '__all__', label: '全部' },
                ...TRAVELER_ELEMENTS.map(eid => {
                  const el = elements.find(e => e.id === eid)
                  return { value: eid, label: el?.name_zh || String(eid) }
                })
              ]} />
          )}
        </EditModal>
      )}

      {/* Talent Material edit */}
      {editTalentMat && (
        <EditModal isOpen={!!editTalentMat} onClose={() => setEditTalentMat(null)} onSave={handleSaveTalentMat} saving={saving} title={editTalentMat.id ? '编辑天赋培养素材' : '添加天赋培养素材'}>
          <SearchSelect label="材料" value={editTalentMat.material_id} onChange={v => setEditTalentMat({ ...editTalentMat, material_id: v ? Number(v) : '' })}
            options={allMaterials.map(m => ({ value: m.id, label: `${m.name_zh} (${MATERIAL_TYPE_ZH[m.type] || m.type})`, image: m.image }))} />
          <FormInput label="数量" value={editTalentMat.quantities} onChange={v => setEditTalentMat({ ...editTalentMat, quantities: v })} placeholder="例: 9" />
          {isTraveler && (
            <FormSelect label="所属元素" value={'element_id' in editTalentMat ? (editTalentMat.element_id === null ? '__all__' : editTalentMat.element_id) : (travelerElement ?? '')} onChange={v => setEditTalentMat({ ...editTalentMat, element_id: (v === '__all__' || !v) ? null : Number(v) })}
              options={[
                { value: '__all__', label: '全部' },
                ...TRAVELER_ELEMENTS.map(eid => {
                  const el = elements.find(e => e.id === eid)
                  return { value: eid, label: el?.name_zh || String(eid) }
                })
              ]} />
          )}
        </EditModal>
      )}

      {/* Lightbox */}
      {lightbox && (
        <Lightbox filename={lightbox.filename} label={lightbox.label} onClose={() => setLightbox(null)} />
      )}
    </div>
  )
}

// ── Sub-components ──

function SectionCard({ icon, title, children, onAdd, onEdit, count, defaultCollapsed }) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed || false)

  return (
    <div className="rounded-xl border border-surface-800 bg-surface-900/50 overflow-hidden">
      <div
        className="flex items-center justify-between px-5 py-3 border-b border-surface-800 cursor-pointer select-none hover:bg-surface-800/30 transition-colors"
        onClick={() => setCollapsed(!collapsed)}
      >
        <div className="flex items-center gap-2">
          <ChevronDown className={`w-3.5 h-3.5 text-surface-500 transition-transform ${collapsed ? '-rotate-90' : ''}`} />
          <span className="text-primary-400">{icon}</span>
          <h2 className="text-sm font-semibold">{title}</h2>
          {count != null && <span className="text-[11px] text-surface-500">({count})</span>}
        </div>
        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
          {onEdit && (
            <button onClick={onEdit} className="p-1.5 rounded-md text-surface-400 hover:text-primary-400 hover:bg-surface-700 transition-colors">
              <Edit3 className="w-3.5 h-3.5" />
            </button>
          )}
          {onAdd && (
            <button onClick={onAdd} className="p-1.5 rounded-md text-surface-400 hover:text-primary-400 hover:bg-surface-700 transition-colors">
              <Plus className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
      {!collapsed && <div className="px-5 py-4">{children}</div>}
    </div>
  )
}

function TalentCard({ talent, index, onEdit, onDelete }) {
  const typeInfo = TALENT_TYPES[talent.type] || TALENT_TYPES.passive
  return (
    <div className="p-4 rounded-xl bg-surface-800/50 border border-surface-700/50 hover:border-surface-600 transition-colors group">
      <div className="flex items-start gap-3">
        {talent.icon ? (
          <LocalImage filename={talent.icon} className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />
        ) : (
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${typeInfo.color.split(' ')[0]} border ${typeInfo.color.split(' ')[2] || 'border-surface-500/20'}`}>
            <Zap className={`w-4 h-4 ${typeInfo.color.split(' ')[1] || 'text-surface-400'}`} />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${typeInfo.color}`}>
              {typeInfo.label}
            </span>
            <span className="text-sm font-medium">{index != null ? `${index}. ` : ''}{talent.name_zh}</span>
          </div>
          {talent.description_zh && <p className="text-xs text-surface-400 leading-relaxed"><ColoredText text={talent.description_zh} /></p>}
          {/* 技能数值表格 (非固有天赋) */}
          {talent.type !== 'passive' && talent.skill_table && (
            <SkillTableDisplay data={talent.skill_table} talentType={talent.type} />
          )}
        </div>
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
          <button onClick={onEdit} className="p-1 rounded text-surface-400 hover:text-primary-400"><Edit3 className="w-3 h-3" /></button>
          <button onClick={onDelete} className="p-1 rounded text-surface-400 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
        </div>
      </div>
    </div>
  )
}

// ── 技能数值表格组件 (编辑用，支持Excel粘贴) ──
function SkillTable({ data, onChange }) {
  const rows = data?.rows || [{ label: '', values: Array(15).fill('') }]

  function updateRowLabel(ri, label) {
    const newRows = rows.map((r, i) => i === ri ? { ...r, label } : r)
    onChange({ rows: newRows })
  }

  function updateCell(ri, ci, value) {
    const newRows = rows.map((r, i) => {
      if (i !== ri) return r
      const newValues = [...r.values]
      newValues[ci] = value
      return { ...r, values: newValues }
    })
    onChange({ rows: newRows })
  }

  function addRow() {
    onChange({ rows: [...rows, { label: '', values: Array(15).fill('') }] })
  }

  function removeRow(ri) {
    if (rows.length <= 1) return
    onChange({ rows: rows.filter((_, i) => i !== ri) })
  }

  // 处理Excel粘贴：解析TSV数据填充到表格
  function handlePaste(e, startRi, startCi) {
    const clipboardData = e.clipboardData.getData('text')
    if (!clipboardData) return

    const lines = clipboardData.trim().split(/\r?\n/)
    const pastedRows = lines.map(line => line.split('\t'))

    const newRows = rows.map(r => ({ ...r, values: [...r.values] }))

    for (let pr = 0; pr < pastedRows.length; pr++) {
      const targetRi = startRi + pr
      if (targetRi >= newRows.length) {
        // 自动扩展行
        while (newRows.length <= targetRi) {
          newRows.push({ label: '', values: Array(15).fill('') })
        }
      }
      const cols = pastedRows[pr]
      for (let pc = 0; pc < cols.length; pc++) {
        if (startCi === -1) {
          // 从属性栏粘贴：第 0 列 → label，后续列 → values[0..14]
          if (pc === 0) {
            newRows[targetRi].label = cols[pc]
          } else {
            const targetCi = pc - 1
            if (targetCi < 15) newRows[targetRi].values[targetCi] = cols[pc]
          }
        } else {
          // 从数值单元格粘贴：全部列 → values[startCi..]
          const targetCi = startCi + pc
          if (targetCi >= 15) break
          newRows[targetRi].values[targetCi] = cols[pc]
        }
      }
    }

    onChange({ rows: newRows })
    e.preventDefault()
  }

  return (
    <div className="overflow-x-auto">
      <div className="flex items-center gap-2 mb-2">
        <button
          type="button"
          onClick={addRow}
          className="flex items-center gap-1 px-2 py-1 rounded text-[10px] bg-surface-700 hover:bg-surface-600 text-surface-300 transition-colors"
        >
          <Plus className="w-3 h-3" /> 添加行
        </button>
        <span className="text-[10px] text-surface-500">支持从Excel粘贴 (属性栏或数值栏均可 Ctrl+V)</span>
      </div>
      <table className="w-full text-[10px] border-collapse">
        <thead>
          <tr className="bg-surface-700/50">
            <th className="px-2 py-1 text-left text-surface-400 font-medium border border-surface-700 w-24"></th>
            {Array.from({ length: 15 }, (_, i) => (
              <th key={i} className="px-2 py-1 text-center text-surface-400 font-medium border border-surface-700 min-w-[48px]">Lv.{i + 1}</th>
            ))}
            <th className="px-2 py-1 text-center text-surface-400 font-medium border border-surface-700 w-8"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              <td className="p-0 border border-surface-700">
                <input
                  type="text"
                  value={row.label}
                  onChange={e => updateRowLabel(ri, e.target.value)}
                  onPaste={(e) => handlePaste(e, ri, -1)}
                  className="w-full px-2 py-1 bg-transparent text-surface-300 text-[10px] focus:outline-none focus:bg-surface-800"
                  placeholder="属性名"
                />
              </td>
              {row.values.map((v, ci) => (
                <td key={ci} className="p-0 border border-surface-700">
                  <input
                    type="text"
                    value={v}
                    onChange={e => updateCell(ri, ci, e.target.value)}
                    onPaste={(e) => handlePaste(e, ri, ci)}
                    className="w-full px-2 py-1 bg-transparent text-surface-300 text-[10px] text-center focus:outline-none focus:bg-surface-800"
                    placeholder=""
                  />
                </td>
              ))}
              <td className="p-0 border border-surface-700 text-center">
                <button
                  type="button"
                  onClick={() => removeRow(ri)}
                  disabled={rows.length <= 1}
                  className={`p-0.5 ${rows.length <= 1 ? 'text-surface-700 cursor-not-allowed' : 'text-surface-400 hover:text-red-400'}`}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── 技能表格展示组件 (Excel 风格单元格选择交互) ──
function SkillTableDisplay({ data, talentType }) {
  const st = typeof data === 'string' ? safeParseJSON(data) : data
  const rows = st?.rows || []
  const [sel, setSel] = useState(null)    // { startRi, startCi, endRi, endCi } 或 null
  const dragging = useRef(false)
  const scrollRef = useRef(null)
  const lv10Ref = useRef(null)
  const stickyRef = useRef(null)

  // 固有天赋（特殊）只有1级
  const maxLevels = talentType === 'passive_special' ? 1 : 15

  // 默认滚动到 Lv.10（Lv.10 左侧对齐属性栏右侧，不被遮挡）
  useEffect(() => {
    if (lv10Ref.current && stickyRef.current && scrollRef.current) {
      scrollRef.current.scrollLeft = lv10Ref.current.offsetLeft - stickyRef.current.offsetWidth
    }
  }, [])
  // ── 选区辅助 ──
  function selectionBounds() {
    if (!sel) return null
    const rMin = Math.min(sel.startRi, sel.endRi ?? sel.startRi)
    const rMax = Math.max(sel.startRi, sel.endRi ?? sel.startRi)
    const cMin = Math.min(sel.startCi, sel.endCi ?? sel.startCi)
    const cMax = Math.max(sel.startCi, sel.endCi ?? sel.startCi)
    return { rMin, rMax, cMin, cMax }
  }

  function isSelected(ri, ci) {
    const b = selectionBounds()
    if (!b) return false
    return ri >= b.rMin && ri <= b.rMax && ci >= b.cMin && ci <= b.cMax
  }

  // ── 复制快捷键 (Ctrl/Cmd + C) ──
  useEffect(() => {
    function onKeyDown(e) {
      if (!sel) return
      const mod = navigator.platform.includes('Mac') ? e.metaKey : e.ctrlKey
      if (!mod || e.key !== 'c') return
      e.preventDefault()

      const b = selectionBounds()
      if (!b) return

      // 构建 TSV（含属性名列）
      const lines = []
      for (let ri = b.rMin; ri <= b.rMax; ri++) {
        const row = rows[ri]
        if (!row) continue
        const cells = []
        // 属性名列是否在选区中（cMin === 0 时包含）
        if (b.cMin === 0) cells.push(row.label || '')
        for (let ci = Math.max(b.cMin, 0); ci <= b.cMax; ci++) {
          cells.push((row.values[ci] ?? '').trim())
        }
        lines.push(cells.join('\t'))
      }
      if (lines.length > 0) {
        navigator.clipboard.writeText(lines.join('\n')).catch(() => {})
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [sel, rows])

  function getCellClass(ri, ci) {
    const base = 'px-2 py-1 text-center text-surface-300 border border-surface-700 whitespace-nowrap select-none cursor-cell'
    if (isSelected(ri, ci)) return base + ' bg-primary-500/20 outline outline-1 outline-primary-500 outline-offset-[-1px]'
    return base
  }

  function onCellMouseDown(ri, ci, e) {
    e.preventDefault()
    dragging.current = true
    setSel({ startRi: ri, startCi: ci, endRi: ri, endCi: ci })
  }

  function onCellMouseEnter(ri, ci) {
    if (!dragging.current || !sel) return
    setSel(prev => ({ ...prev, endRi: ri, endCi: ci }))
  }

  // 全局 mouseup 停止拖拽
  const autoScrollRef = useRef(null)
  useEffect(() => {
    function onUp() { dragging.current = false; if (autoScrollRef.current) { cancelAnimationFrame(autoScrollRef.current); autoScrollRef.current = null } }
    window.addEventListener('mouseup', onUp)
    return () => window.removeEventListener('mouseup', onUp)
  }, [])

  // 拖拽时自动滚动（鼠标靠近左右边缘时）
  useEffect(() => {
    function onMouseMove(e) {
      if (!dragging.current || !scrollRef.current) return
      const rect = scrollRef.current.getBoundingClientRect()
      const edge = 60 // 边缘触发区宽度(px)
      const maxSpeed = 15 // 最大滚动速度(px/frame)

      let speed = 0
      if (e.clientX < rect.left + edge && rect.left > 0) {
        // 贴近左边缘 → 向左滚
        const dist = edge - (e.clientX - rect.left)
        speed = -Math.min(maxSpeed, (dist / edge) * maxSpeed)
      } else if (e.clientX > rect.right - edge) {
        // 贴近右边缘 → 向右滚
        const dist = edge - (rect.right - e.clientX)
        speed = Math.min(maxSpeed, (dist / edge) * maxSpeed)
      }

      if (speed !== 0) {
        if (autoScrollRef.current) cancelAnimationFrame(autoScrollRef.current)
        function step() {
          if (!dragging.current || !scrollRef.current) { autoScrollRef.current = null; return }
          scrollRef.current.scrollLeft += speed
          autoScrollRef.current = requestAnimationFrame(step)
        }
        autoScrollRef.current = requestAnimationFrame(step)
      } else {
        if (autoScrollRef.current) { cancelAnimationFrame(autoScrollRef.current); autoScrollRef.current = null }
      }
    }
    window.addEventListener('mousemove', onMouseMove)
    return () => { window.removeEventListener('mousemove', onMouseMove); if (autoScrollRef.current) cancelAnimationFrame(autoScrollRef.current) }
  }, [])

  if (!rows.length || rows.every(r => !r.label && r.values.every(v => !v))) return null

  // 点击空白取消选区
  function onTableClick(e) {
    if (e.target === e.currentTarget) setSel(null)
  }

  const b = selectionBounds()

  return (
    <div className="mt-3 overflow-x-auto" ref={scrollRef} onClick={onTableClick}>
      <table className={`text-[10px] border-collapse ${maxLevels === 1 ? 'w-full' : 'w-full'}`}>
        <thead>
          <tr className="bg-surface-700/50">
            <th ref={stickyRef} className={`sticky left-0 py-1 text-left text-surface-400 font-medium border border-surface-700 whitespace-nowrap bg-surface-700 z-10 border-l-2 border-l-surface-700 ${maxLevels === 1 ? 'px-1.5 w-[30%]' : 'px-2'}`}
              style={{ boxShadow: '2px 0 4px rgba(0,0,0,0.4)' }}></th>
            {Array.from({ length: maxLevels }, (_, i) => (
              <th
                key={i}
                ref={i === 9 ? lv10Ref : undefined}
                className={`py-1 text-center text-surface-400 font-medium border border-surface-700 whitespace-nowrap select-none ${maxLevels === 1 ? 'px-1.5' : 'px-2'}`}
              >
                Lv.{i + 1}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              <td
                className={`sticky left-0 py-1 text-surface-300 border border-surface-700 font-medium whitespace-nowrap bg-surface-900 z-[5] select-none cursor-pointer border-l-2 border-l-surface-900 ${maxLevels === 1 ? 'px-1.5 w-[30%]' : 'px-2'}
                           ${b && ri >= b.rMin && ri <= b.rMax && b.cMin === 0 ? 'bg-primary-500/10' : ''}`}
                style={{ boxShadow: '2px 0 4px rgba(0,0,0,0.4)' }}
                onMouseDown={e => { e.preventDefault(); dragging.current = true; setSel({ startRi: ri, startCi: 0, endRi: ri, endCi: maxLevels - 1 }) }}
              >
                {row.label}
              </td>
              {row.values.map((v, ci) => (
                <td
                  key={ci}
                  className={getCellClass(ri, ci)}
                  onMouseDown={e => onCellMouseDown(ri, ci, e)}
                  onMouseEnter={() => onCellMouseEnter(ri, ci)}
                >
                  {v}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ImageTile({ label, filename, large, onClick }) {
  return (
    <div
      className={`rounded-xl bg-surface-800/50 border border-surface-700 overflow-hidden ${large ? 'col-span-2 md:col-span-4' : ''} ${onClick ? 'cursor-pointer hover:border-primary-500/50 transition-colors' : ''}`}
      onClick={onClick}
    >
      <div className={`bg-surface-700 flex items-center justify-center overflow-hidden ${large ? 'min-h-[300px] max-h-[70vh]' : 'aspect-square'}`}>
        <SplashImage filename={filename} className={`${large ? 'max-w-full max-h-[70vh] object-contain' : 'w-full h-full object-cover'}`} />
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

function BannerBg({ filename }) {
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
  if (!src) return null
  return <img src={src} alt="" className="absolute inset-0 w-full h-full object-cover opacity-40" draggable onDragStart={handleDrag} />
}

function SplashImage({ filename, className = '' }) {
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
  if (!src) return <div className="w-full h-full flex items-center justify-center text-surface-500 text-xs">无图</div>
  return <img src={src} alt="" className={className || 'w-full h-full object-cover'} draggable onDragStart={handleDrag} />
}

function DishImage({ filename }) {
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
  if (!src) return <div className="w-full h-full flex items-center justify-center"><UtensilsCrossed className="w-6 h-6 text-surface-500" /></div>
  return <img src={src} alt="" className="w-full h-full object-cover" draggable onDragStart={handleDrag} />
}

function MaterialBadge({ material, onEdit, onDelete }) {
  const navigate = useNavigate()
  const { saveScroll, savePage } = useNav()
  const RARITY_COLORS = { 1: 'border-gray-500/30', 2: 'border-green-500/30', 3: 'border-blue-500/30', 4: 'border-purple-500/30', 5: 'border-amber-500/30' }

  function handleClick() {
    if (material.material_id) {
      savePage('materials')
      navigate(`/materials/${material.material_id}`)
    }
  }

  return (
    <div
      onClick={handleClick}
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
        {(material.quantity || material.quantities) && (
          <p className="text-[10px] text-surface-500">数量: {material.quantity || material.quantities}</p>
        )}
        {material.material_type && (
          <span className="text-[10px] px-1 py-0.5 rounded bg-surface-700 text-surface-400">{MATERIAL_TYPE_ZH[material.material_type] || material.material_type}</span>
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

function safeParseJSON(str) {
  if (!str) return null
  try { return JSON.parse(str) } catch (_) { return null }
}

function getLevelStat(character, level, stat) {
  const key = `${stat}_${level}`
  return character[key]
}

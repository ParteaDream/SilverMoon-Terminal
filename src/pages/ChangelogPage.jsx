import { useState, useEffect, useMemo, useRef, useLayoutEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDb } from '../context/DbContext'
import { useNav } from '../context/NavContext'
import { useLazyImage, bumpLazyRevision } from '../hooks/useLazyImage'
import { savePageStateSync, loadPageStateSync } from '../utils/pageStateStore'
import { Plus, GripVertical, ArrowUpDown, X, Search, ChevronDown, ChevronRight, ChevronLeft, ImagePlus, Download, User, Crosshair, Sparkles, Shirt, Package, BarChart3, Star } from 'lucide-react'
import SearchBar from '../components/SearchBar'
import EditModal, { FormInput, FormField } from '../components/EditModal'
import ItemThumb from '../components/ItemThumb'

const PRESET_COLORS = [
  '#ef4444', '#f97316', '#FFD780', '#22c55e',
  '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899',
  '#6b7280',
]

const SECTION_CONFIG = {
  character: { label: '角色', icon: User },
  weapon: { label: '武器', icon: Crosshair },
  artifact: { label: '圣遗物', icon: Sparkles },
  outfit: { label: '角色时装', icon: Shirt },
  material: { label: '重要材料', icon: Package },
  game_data: { label: '游戏数据', icon: BarChart3 },
  wish: { label: '祈愿', icon: Star },
}

const BANNER_TYPES = {
  'character-event': '角色活动祈愿',
  'weapon-event': '武器活动祈愿',
  'chronicled': '集录祈愿',
  'standard': '常驻祈愿',
}
const BANNER_TYPE_ORDER = ['character-event', 'weapon-event', 'chronicled', 'standard']

function compareVersion(a, b) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const va = pa[i] || 0
    const vb = pb[i] || 0
    if (va !== vb) return va - vb
  }
  return 0
}

export default function ChangelogPage() {
  const { query, readImage } = useDb()
  const navigate = useNavigate()
  const { restorePage, savePage, consumeBackToList } = useNav()
  const restoringScroll = useRef(false)
  const initialLoadDone = useRef(false)
  const hasRestored = useRef(false)

  // Data
  const [versions, setVersions] = useState({})   // version -> { tags, additions: { character: [], ... } }
  const [charMap, setCharMap] = useState({})
  const [weaponMap, setWeaponMap] = useState({})
  const [artifactMap, setArtifactMap] = useState({})
  const [materialMap, setMaterialMap] = useState({})
  const [wishMap, setWishMap] = useState({})       // wish id -> { ...wish, banners: [...] }
  const [outfitMap, setOutfitMap] = useState({})    // outfit id -> { id, name_zh, avatar_image, character_id }
  const [gameDataMap, setGameDataMap] = useState({}) // game_data id -> { id, title_zh }
  const [versionImages, setVersionImages] = useState({}) // version -> [filenames]
  const [loaded, setLoaded] = useState(false)

  // Random version image display (picked once per load)
  const randomVersionImages = useRef({})

  // UI
  const [search, setSearch] = useState('')
  const [sortAsc, setSortAsc] = useState(false)
  const [expandedVersions, setExpandedVersions] = useState(new Set())

  // Modal
  const [modalOpen, setModalOpen] = useState(false)
  const [editingVersion, setEditingVersion] = useState(null)
  const [formVersion, setFormVersion] = useState('')
  const [formTags, setFormTags] = useState([])       // [{ id, tag, color }]
  const [formAdditions, setFormAdditions] = useState({}) // { character: [id], weapon: [id], ... }
  const [formVersionImages, setFormVersionImages] = useState([]) // array of filenames
  const [saving, setSaving] = useState(false)

  // Options for SearchableSelect
  const [charOptions, setCharOptions] = useState([])
  const [weaponOptions, setWeaponOptions] = useState([])
  const [artifactOptions, setArtifactOptions] = useState([])
  const [materialOptions, setMaterialOptions] = useState([])
  const [wishOptions, setWishOptions] = useState([])
  const [outfitOptions, setOutfitOptions] = useState([])
  const [gameDataOptions, setGameDataOptions] = useState([])

  // ── Load all data ──
  useEffect(() => {
    const isBack = consumeBackToList()
    if (isBack) {
      restorePage('changelog').then(saved => {
        if (saved) {
          hasRestored.current = true
          if (saved.search != null) setSearch(saved.search)
          if (saved.sortAsc != null) setSortAsc(saved.sortAsc)
          if (saved.expandedVersions?.length > 0) {
            setExpandedVersions(new Set(saved.expandedVersions))
          }
          if (saved.scrollY != null && saved.scrollY > 0) {
            sessionStorage.setItem('_changelog_restore_y', String(saved.scrollY))
          }
        }
        initialLoadDone.current = true
        loadAll()
      })
    } else {
      const main = document.querySelector('main')
      if (main) main.scrollTo(0, 0)
      initialLoadDone.current = true
      loadAll()
    }
  }, [])

  useEffect(() => { if (loaded) bumpLazyRevision() }, [search, sortAsc])

  // ── 状态持久化：数据加载完成后恢复滚轮位置 ──
  useEffect(() => {
    if (!loaded) return
    const restoreY = sessionStorage.getItem('_changelog_restore_y')
    if (!restoreY) return
    const targetY = Number(restoreY)
    if (targetY <= 0) { sessionStorage.removeItem('_changelog_restore_y'); return }
    sessionStorage.removeItem('_changelog_restore_y')
    const main = document.querySelector('main')
    if (main) {
      restoringScroll.current = true
      const tryScroll = (n) => {
        if (main.scrollHeight > targetY) {
          main.scrollTo(0, targetY)
          setTimeout(() => { restoringScroll.current = false }, 300)
        } else if (n > 0) {
          setTimeout(() => tryScroll(n - 1), 200)
        } else {
          restoringScroll.current = false
        }
      }
      tryScroll(20)
    }
  }, [loaded])

  // ── 状态持久化：滚动时保存 ──
  useLayoutEffect(() => {
    const main = document.querySelector('main')
    if (!main) return
    let timer = null
    const expandedArr = [...expandedVersions]
    const save = () => {
      if (restoringScroll.current) return
      savePage('changelog', { search, sortAsc, expandedVersions: expandedArr })
    }
    const onScroll = () => {
      clearTimeout(timer)
      if (restoringScroll.current) return
      timer = setTimeout(save, 150)
    }
    main.addEventListener('scroll', onScroll, { passive: true })
    return () => { main.removeEventListener('scroll', onScroll); clearTimeout(timer); save() }
  }, [search, sortAsc, expandedVersions, savePage])

  // ── 状态持久化：筛选/排序/折叠变化时立即保存到 user.json ──
  useEffect(() => {
    if (!initialLoadDone.current) return
    const current = loadPageStateSync('changelog')
    const scrollY = current?.scrollY || 0
    savePageStateSync('changelog', scrollY, { search, sortAsc, expandedVersions: [...expandedVersions] })
  }, [search, sortAsc, expandedVersions])

  async function loadAll() {
    // Load lookup data
    const [chars, weps, arts, mats, wishes, fits, gds, vms] = await Promise.all([
      query('SELECT id, name_zh, card_art, rarity FROM characters'),
      query('SELECT id, name_zh, image, simple_art, rarity FROM weapons'),
      query('SELECT id, name_zh, image, flower_image FROM artifacts'),
      query('SELECT id, name_zh, image, type FROM materials'),
      query('SELECT id, version, phase, banner_type, name_zh, start_date, end_date FROM wishes'),
      query('SELECT id, character_id, name_zh, avatar_image FROM character_outfits'),
      query('SELECT id, title_zh FROM game_data'),
      query('SELECT version, images FROM version_meta'),
    ])

    // Build outfit avatar map (only those with avatars, for character display)
    const fitsData = fits.data || []
    const outfitAvatarMap = {}
    const om = {} // outfit id -> full outfit data
    for (const f of fitsData) {
      if (f.avatar_image) outfitAvatarMap[f.id] = f.avatar_image
      om[f.id] = f
    }
    setOutfitMap(om)

    // Build game_data map
    const gdsData = gds.data || []
    const gdm = {}
    for (const g of gdsData) gdm[g.id] = g
    setGameDataMap(gdm)

    // Build version images map (parse JSON arrays, pick one random for display)
    const vmsData = vms.data || []
    const viMap = {}
    const rvi = {}
    for (const v of vmsData) {
      let images = []
      try { images = JSON.parse(v.images || '[]') } catch (_) { images = v.image ? [v.image] : [] }
      images = images.filter(Boolean)
      if (images.length > 0) {
        viMap[v.version] = images
        rvi[v.version] = images[Math.floor(Math.random() * images.length)]
      }
    }
    setVersionImages(viMap)
    randomVersionImages.current = rvi
    // 预热版本图到 DbContext 缓存，后续 useLazyImage 可同步命中
    const allVersionImages = [...new Set(Object.values(viMap).flat())]
    for (const fn of allVersionImages) readImage(fn)
    // Read outfit selections from user.json
    let outfitSelections = {}
    try {
      const uRes = await window.electronAPI?.getUserConfig()
      if (uRes?.success && uRes.config?.outfitSelections) {
        outfitSelections = uRes.config.outfitSelections
      }
    } catch (_) {}

    const cm = {}; for (const c of (chars.data || [])) {
      const outfitId = outfitSelections[c.id]
      c._displayCardArt = (outfitId && outfitAvatarMap[outfitId]) || c.card_art
      cm[c.id] = c
    }
    const wm = {}; for (const w of (weps.data || [])) wm[w.id] = w
    const am = {}; for (const a of (arts.data || [])) am[a.id] = a
    const mm = {}; for (const m of (mats.data || [])) mm[m.id] = m
    setCharMap(cm); setWeaponMap(wm); setArtifactMap(am); setMaterialMap(mm)

    // Build options for selects
    setCharOptions((chars.data || []).map(c => ({ value: c.id, label: c.name_zh, image: c._displayCardArt, rarity: c.rarity })))
    setWeaponOptions((weps.data || []).map(w => ({ value: w.id, label: w.name_zh, image: w.simple_art || w.image, rarity: w.rarity })))
    setArtifactOptions((arts.data || []).map(a => ({ value: a.id, label: a.name_zh, image: a.flower_image || a.image })))
    setMaterialOptions((mats.data || []).map(m => ({ value: m.id, label: m.name_zh, image: m.image })))

    // Build wish map
    const wishData = wishes.data || []
    const wishMapTemp = {}
    for (const w of wishData) wishMapTemp[w.id] = { ...w, banners: [] }

    // Load wish banners and items
    if (wishData.length > 0) {
      const wishIds = wishData.map(w => w.id)
      const placeholders = wishIds.map(() => '?').join(',')
      const [bRes, biRes] = await Promise.all([
        query(`SELECT * FROM wish_banners WHERE wish_id IN (${placeholders}) ORDER BY sort_order, id`, wishIds),
        query(`SELECT wbi.* FROM wish_banner_items wbi JOIN wish_banners wb ON wbi.banner_id = wb.id WHERE wb.wish_id IN (${placeholders}) ORDER BY wbi.rarity DESC, wbi.sort_order, wbi.id`, wishIds),
      ])
      const bannersData = bRes.data || []
      const itemsData = biRes.data || []
      // Group items by banner
      const itemsByBanner = {}
      for (const bi of itemsData) {
        if (!itemsByBanner[bi.banner_id]) itemsByBanner[bi.banner_id] = []
        itemsByBanner[bi.banner_id].push(bi)
      }
      for (const b of bannersData) {
        if (wishMapTemp[b.wish_id]) {
          wishMapTemp[b.wish_id].banners.push({ ...b, items: itemsByBanner[b.id] || [] })
        }
      }
    }
    setWishMap(wishMapTemp)

    const wishOpts = wishData.map(w => ({
      value: w.id,
      label: `${w.version} ${w.name_zh || ''} (${w.phase === 1 ? '上半' : '下半'})`,
      image: null,
      banner_type: w.banner_type,
    }))
    setWishOptions(wishOpts)

    // Outfit options for edit form
    const outfitOpts = fitsData.map(f => ({
      value: f.id,
      label: `${f.name_zh}（${cm[f.character_id]?.name_zh || '未知角色'}）`,
      image: f.avatar_image || null,
      character_id: f.character_id,
    }))
    setOutfitOptions(outfitOpts)

    // Game data options for edit form
    const gdOpts = gdsData.map(g => ({
      value: g.id,
      label: g.title_zh,
      image: null,
    }))
    setGameDataOptions(gdOpts)

    // Load version data
    await loadVersionData(cm, wm, am, mm, wishMapTemp, om, gdm)
    setLoaded(true)
  }

  async function loadVersionData(cm, wm, am, mm, wishMapTemp, om, gdm) {
    const [tagsRes, addsRes, metaRes] = await Promise.all([
      query('SELECT * FROM version_tags ORDER BY sort_order, id'),
      query('SELECT * FROM version_additions ORDER BY sort_order, id'),
      query('SELECT version, images FROM version_meta'),
    ])
    const tagsData = tagsRes.data || []
    const addsData = addsRes.data || []
    const metaData = metaRes.data || []

    // Build version images from meta (parse JSON arrays)
    const viMap = {}
    const rvi = {}
    for (const m of metaData) {
      let images = []
      try { images = JSON.parse(m.images || '[]') } catch (_) { images = m.image ? [m.image] : [] }
      images = images.filter(Boolean)
      if (images.length > 0) {
        viMap[m.version] = images
        rvi[m.version] = images[Math.floor(Math.random() * images.length)]
      }
    }
    setVersionImages(viMap)
    randomVersionImages.current = rvi
    // 预热版本图（loadAll 已预热过，此处确保 kv 数据加载路径也预热）
    const allVersionImages = [...new Set(Object.values(viMap).flat())]
    for (const fn of allVersionImages) readImage(fn)

    const verMap = {}
    for (const t of tagsData) {
      if (!verMap[t.version]) verMap[t.version] = { tags: [], additions: {} }
      verMap[t.version].tags.push(t)
    }
    for (const a of addsData) {
      if (!verMap[a.version]) verMap[a.version] = { tags: [], additions: {} }
      if (!verMap[a.version].additions[a.item_type]) verMap[a.version].additions[a.item_type] = []
      let entity = null
      switch (a.item_type) {
        case 'character': entity = cm[a.item_id]; break
        case 'weapon': entity = wm[a.item_id]; break
        case 'artifact': entity = am[a.item_id]; break
        case 'outfit': entity = om[a.item_id]; break
        case 'material': entity = mm[a.item_id]; break
        case 'game_data': entity = gdm[a.item_id]; break
        case 'wish': entity = wishMapTemp[a.item_id]; break
      }
      if (entity) verMap[a.version].additions[a.item_type].push({ ...entity, _addId: a.id })
    }

    setVersions(verMap)
  }

  // ── Filtered and sorted versions ──
  const filteredVersions = useMemo(() => {
    const searchLower = search.toLowerCase().trim()
    let entries = Object.entries(versions)

    // Search filter
    if (searchLower) {
      entries = entries.filter(([version, data]) => {
        // Check version string
        if (version.toLowerCase().includes(searchLower)) return true
        // Check tags
        if (data.tags.some(t => t.tag.toLowerCase().includes(searchLower))) return true
        // Check all additions
        for (const [type, items] of Object.entries(data.additions)) {
          for (const item of items) {
            if (item.name_zh?.toLowerCase().includes(searchLower)) return true
            if (type === 'wish') {
              if (item.banners?.some(b => b.name_zh?.toLowerCase().includes(searchLower))) return true
            }
          }
        }
        return false
      })
    }

    // Sort by version
    entries.sort((a, b) => {
      const cmp = compareVersion(a[0], b[0])
      return sortAsc ? cmp : -cmp
    })

    return entries
  }, [versions, search, sortAsc])

  // ── Edit modal handlers ──
  function openAdd() {
    setEditingVersion(null)
    setFormVersion('')
    setFormTags([])
    setFormAdditions({})
    setFormVersionImages([])
    setModalOpen(true)
  }

  function openEdit(version) {
    const data = versions[version]
    setEditingVersion(version)
    setFormVersion(version)
    setFormTags(data.tags.map(t => ({ id: t.id, tag: t.tag, color: t.color })))
    const adds = {}
    for (const [type, items] of Object.entries(data.additions || {})) {
      adds[type] = items.map(i => i.id)
    }
    setFormAdditions(adds)
    setFormVersionImages(versionImages[version] || [])
    setModalOpen(true)
  }

  async function handleSave() {
    if (!formVersion.trim()) return
    const version = formVersion.trim()
    setSaving(true)
    try {
      // Delete existing data for this version
      await query('DELETE FROM version_tags WHERE version = ?', [version])
      await query('DELETE FROM version_additions WHERE version = ?', [version])
      await query('DELETE FROM version_meta WHERE version = ?', [version])

      // Insert tags
      for (let i = 0; i < formTags.length; i++) {
        const t = formTags[i]
        await query(
          'INSERT INTO version_tags (version, tag, color, sort_order) VALUES (?, ?, ?, ?)',
          [version, t.tag, t.color, i]
        )
      }

      // Insert additions
      for (const [type, ids] of Object.entries(formAdditions)) {
        for (let i = 0; i < ids.length; i++) {
          await query(
            'INSERT OR IGNORE INTO version_additions (version, item_type, item_id, sort_order) VALUES (?, ?, ?, ?)',
            [version, type, ids[i], i]
          )
        }
      }

      // Insert version images (JSON array)
      if (formVersionImages.length > 0) {
        await query(
          'INSERT OR REPLACE INTO version_meta (version, images) VALUES (?, ?)',
          [version, JSON.stringify(formVersionImages)]
        )
      }

      // Reload
      await loadVersionData(charMap, weaponMap, artifactMap, materialMap, wishMap, outfitMap, gameDataMap)
      setModalOpen(false)
    } catch (e) {
      console.error('Save failed:', e)
    } finally {
      setSaving(false)
    }
  }

  function addFormTag() {
    setFormTags(prev => [...prev, { id: Date.now(), tag: '', color: '#FFD780' }])
  }

  function updateFormTag(idx, field, value) {
    setFormTags(prev => prev.map((t, i) => i === idx ? { ...t, [field]: value } : t))
  }

  function removeFormTag(idx) {
    setFormTags(prev => prev.filter((_, i) => i !== idx))
  }

  function moveFormTag(fromIdx, toIdx) {
    setFormTags(prev => {
      const list = [...prev]
      const [item] = list.splice(fromIdx, 1)
      list.splice(toIdx, 0, item)
      return list
    })
  }

  function toggleFormItem(type, id) {
    setFormAdditions(prev => {
      const list = prev[type] || []
      if (list.includes(id)) return { ...prev, [type]: list.filter(i => i !== id) }
      return { ...prev, [type]: [...list, id] }
    })
  }

  function moveFormItem(type, fromIdx, toIdx) {
    setFormAdditions(prev => {
      const list = [...(prev[type] || [])]
      const [item] = list.splice(fromIdx, 1)
      list.splice(toIdx, 0, item)
      return { ...prev, [type]: list }
    })
  }

  function removeFormItem(type, id) {
    setFormAdditions(prev => ({
      ...prev,
      [type]: (prev[type] || []).filter(i => i !== id),
    }))
  }

  // ── Item image component ──
  function ItemCard({ imageFile, name, rarity, navTo }) {
    const { ref, src } = useLazyImage(imageFile, '200px')
    const rarityBorder = rarity === 5 ? 'border-amber-400/60' : rarity === 4 ? 'border-purple-400/60' : 'border-surface-600'

    return (
      <button
        onClick={() => navTo && navigate(navTo)}
        className="flex flex-col items-center gap-1.5 group cursor-pointer"
        title={name}
      >
        <div ref={ref} className={`w-14 h-14 rounded-lg border-2 ${rarityBorder} overflow-hidden bg-surface-700 flex-shrink-0 group-hover:border-white/60 transition-all`}>
          {src ? (
            <img src={src} alt="" className="w-full h-full object-cover animate-fade-in" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <div className="w-4 h-4 rounded bg-surface-600" />
            </div>
          )}
        </div>
        <span className="text-[10px] leading-tight text-center truncate max-w-[72px] text-surface-300 group-hover:text-white transition-colors">
          {name}
        </span>
      </button>
    )
  }

  // ── Render ──
  if (!loaded) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 mx-auto mb-3 rounded-full border-2 border-primary-500 border-t-transparent animate-spin" />
          <p className="text-surface-400 text-sm">加载中...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto px-6 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <h1 className="text-xl font-bold">版本新增数据速览</h1>
        <div className="flex-1" />
        <SearchBar value={search} onChange={setSearch} placeholder="搜索版本/角色/武器/圣遗物..." />
        <button
          onClick={() => setSortAsc(prev => !prev)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm transition-colors
            ${sortAsc ? 'bg-primary-500/10 text-primary-400' : 'bg-surface-800 text-surface-400 hover:text-white'}`}
          title={sortAsc ? '当前：从旧到新' : '当前：从新到旧'}
        >
          <ArrowUpDown className="w-4 h-4" />
          {sortAsc ? '旧→新' : '新→旧'}
        </button>
        <button
          onClick={openAdd}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary-600 hover:bg-primary-500 text-white text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          添加版本
        </button>
      </div>

      {/* Version entries */}
      {filteredVersions.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-surface-500 text-sm">
            {search ? '没有匹配的版本数据' : '暂无版本新增数据，点击「添加版本」开始'}
          </p>
        </div>
      ) : (() => {
        // Latest version is first when sorted descending (default)
        const latestVersion = filteredVersions[0]?.[0] || null
        return (
        <div className="space-y-8">
          {filteredVersions.map(([version, data]) => {
            const isExpanded = hasRestored.current ? expandedVersions.has(version) : undefined
            return (
            <VersionEntry
              key={version}
              version={version}
              data={data}
              charMap={charMap}
              weaponMap={weaponMap}
              artifactMap={artifactMap}
              materialMap={materialMap}
              wishMap={wishMap}
              outfitMap={outfitMap}
              gameDataMap={gameDataMap}
              versionImages={versionImages[version] || []}
              randomVersionImage={randomVersionImages.current[version] || null}
              onEdit={() => openEdit(version)}
              ItemCard={ItemCard}
              isExpanded={isExpanded}
              defaultExpanded={version === latestVersion}
              onToggleExpand={(currentlyCollapsed) => {
                hasRestored.current = true
                setExpandedVersions(prev => {
                  const next = new Set(prev)
                  // If currently collapsed → expand (add to set)
                  // If currently expanded → collapse (remove from set)
                  if (currentlyCollapsed) next.add(version)
                  else next.delete(version)
                  return next
                })
              }}
            />
            )
          })}
        </div>
        )
      })()}

      {/* Edit Modal */}
      <EditModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSave={handleSave}
        title={editingVersion ? `编辑版本 ${editingVersion}` : '添加版本'}
        saving={saving}
        wider
        closeOnBackdrop={false}
      >
        <EditForm
          formVersion={formVersion}
          setFormVersion={setFormVersion}
          formTags={formTags}
          addFormTag={addFormTag}
          updateFormTag={updateFormTag}
          removeFormTag={removeFormTag}
          moveFormTag={moveFormTag}
          formAdditions={formAdditions}
          toggleFormItem={toggleFormItem}
          removeFormItem={removeFormItem}
          moveFormItem={moveFormItem}
          charOptions={charOptions}
          weaponOptions={weaponOptions}
          artifactOptions={artifactOptions}
          materialOptions={materialOptions}
          wishOptions={wishOptions}
          outfitOptions={outfitOptions}
          gameDataOptions={gameDataOptions}
          charMap={charMap}
          weaponMap={weaponMap}
          artifactMap={artifactMap}
          materialMap={materialMap}
          wishMap={wishMap}
          outfitMap={outfitMap}
          gameDataMap={gameDataMap}
          readImage={readImage}
          formVersionImages={formVersionImages}
          setFormVersionImages={setFormVersionImages}
        />
      </EditModal>
    </div>
  )
}

// ── Version image background (right-to-left opacity gradient, lazy loaded) ──
// ── Version image background (right-to-left opacity gradient, lazy loaded) ──
//    三阶段避免闪烁：① idle：opacity-0 + 无 src（完全不可见）
//    ② opaque：opacity-40 + 仍无 src（CSS transition 0→0.4 已开始，但无图片）
//    ③ revealed：opacity-40 + src + animate-gradient-reveal（图片加载时元素已处于
//       ~0.4 不透明度，mask 动画从全黑→梯度，从右向左渐变出现）
//    永久 maskImage inline style 保持最终的右端微露/左端全显梯度
function VersionImageBg({ imageFile }) {
  const { ref: containerRef, src } = useLazyImage(imageFile, 300)
  const imgRef = useRef(null)
  const prevSrcRef = useRef(null)

  useEffect(() => {
    const img = imgRef.current
    if (!img) return

    if (!src) {
      img.style.opacity = '0'
      img.removeAttribute('src')
      img.classList.remove('animate-gradient-reveal')
      prevSrcRef.current = null
      return
    }

    if (src === prevSrcRef.current) return
    prevSrcRef.current = src

    // Step 1: 设 opacity=0.4（inline style 优先级高于 className）
    img.style.opacity = '0.4'

    // Step 2: 等 3 帧，确保浏览器已在此透明度下完成绘制
    let cancelled = false
    const raf1 = requestAnimationFrame(() => {
      if (cancelled) return
      const raf2 = requestAnimationFrame(() => {
        if (cancelled) return
        const raf3 = requestAnimationFrame(() => {
          if (cancelled) return
          // Step 3: 此时元素已在 ~0.4 不透明度。先启动 mask 动画
          img.classList.add('animate-gradient-reveal')

          // Step 4: 再等一帧让动画 0% keyframe（全黑 mask）生效
          requestAnimationFrame(() => {
            if (cancelled) return
            // Step 5: 设 src — 动画已开始，image 加载时被全黑 mask 隐藏
            img.src = src
          })
        })
      })
    })

    return () => { cancelled = true }
  }, [src])

  return (
    <div ref={containerRef} className="absolute inset-0 pointer-events-none overflow-hidden rounded-xl" style={{ zIndex: 0 }}>
      <img
        ref={imgRef}
        alt=""
        className="absolute top-0 right-0 h-full w-auto object-cover opacity-0"
        style={{
          maskImage: 'linear-gradient(to left, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0) 100%)',
          WebkitMaskImage: 'linear-gradient(to left, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0) 100%)',
        }}
      />
    </div>
  )
}

// ── Version image lightbox (multi-image with prev/next, zoom + pan) ──
function VersionImageLightbox({ images, index, onClose, onPrev, onNext }) {
  const { readImage } = useDb()
  const [src, setSrc] = useState(null)
  const [scale, setScale] = useState(1)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const dragging = useRef(false)
  const dragStart = useRef({ x: 0, y: 0 })
  const posStart = useRef({ x: 0, y: 0 })
  const containerRef = useRef(null)

  // Reset zoom/pan on image change
  useEffect(() => {
    setScale(1)
    setPosition({ x: 0, y: 0 })
  }, [index])

  useEffect(() => {
    let cancelled = false
    readImage(images[index]).then(data => { if (!cancelled) setSrc(data) })
    return () => { cancelled = true }
  }, [images, index, readImage])

  // Mouse drag handlers
  const handleMouseDown = useCallback((e) => {
    if (scale <= 1) return
    e.preventDefault()
    dragging.current = true
    dragStart.current = { x: e.clientX, y: e.clientY }
    posStart.current = { ...position }
  }, [scale, position])

  const handleMouseMove = useCallback((e) => {
    if (!dragging.current) return
    const dx = e.clientX - dragStart.current.x
    const dy = e.clientY - dragStart.current.y
    setPosition({ x: posStart.current.x + dx, y: posStart.current.y + dy })
  }, [])

  const handleMouseUp = useCallback(() => { dragging.current = false }, [])

  // Global mouse events
  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [handleMouseMove, handleMouseUp])

  // Wheel zoom (0.5x ~ 3x)
  useEffect(() => {
    const el = containerRef.current
    if (!el || !src) return
    const onWheel = (e) => {
      e.stopPropagation()
      e.preventDefault()
      setScale(prev => Math.max(0.5, Math.min(3, prev + (e.deltaY > 0 ? -0.2 : 0.2))))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [src])

  return (
    <div className="fixed inset-0 z-[250] bg-black/90 backdrop-blur-sm flex items-center justify-center no-drag" onClick={onClose} onContextMenu={e => { e.preventDefault(); onClose() }}>
      {/* Left arrow */}
      <button
        onClick={e => { e.stopPropagation(); onPrev() }}
        className="absolute left-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors z-10"
      >
        <ChevronLeft className="w-6 h-6" />
      </button>
      {/* Image with zoom + pan */}
      <div
        ref={containerRef}
        className="max-w-[85vw] max-h-[85vh] flex items-center justify-center"
        onClick={e => e.stopPropagation()}
        onMouseDown={handleMouseDown}
      >
        {src ? (
          <img
            src={src}
            alt=""
            className={`max-w-full max-h-full object-contain rounded-lg shadow-2xl select-none ${scale > 1 ? 'cursor-grab' : ''}`}
            style={{ transform: `scale(${scale}) translate(${position.x / scale}px, ${position.y / scale}px)` }}
            draggable={false}
          />
        ) : (
          <div className="w-10 h-10 rounded-full border-2 border-primary-500 border-t-transparent animate-spin" />
        )}
      </div>
      {/* Right arrow */}
      <button
        onClick={e => { e.stopPropagation(); onNext() }}
        className="absolute right-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors z-10"
      >
        <ChevronRight className="w-6 h-6" />
      </button>
      {/* Scale indicator */}
      {scale !== 1 && (
        <div className="absolute top-4 left-4 text-xs text-white/60 bg-black/40 px-2 py-1 rounded">
          {Math.round(scale * 100)}%
        </div>
      )}
      {/* Counter + export */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-sm text-white/70 bg-black/40 px-3 py-1 rounded-full flex items-center gap-3">
        <span>{index + 1} / {images.length}</span>
        <button
          onClick={e => {
            e.stopPropagation()
            window.electronAPI?.exportImageFileRaw(images[index])
          }}
          className="hover:text-white transition-colors"
          title="导出图片"
        >
          <Download className="w-3.5 h-3.5" />
        </button>
      </div>
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
      >
        <X className="w-5 h-5" />
      </button>
    </div>
  )
}

// ── Version entry display ──
function VersionEntry({ version, data, charMap, weaponMap, artifactMap, materialMap, wishMap, outfitMap, gameDataMap, versionImages, randomVersionImage, onEdit, ItemCard, isExpanded, defaultExpanded, onToggleExpand }) {
  const navigate = useNavigate()
  const [lightboxIndex, setLightboxIndex] = useState(-1) // -1 = closed, >=0 = open at index
  const additions = data.additions || {}
  const hasAnyContent = Object.values(additions).some(arr => arr.length > 0)

  const collapsed = isExpanded !== undefined ? !isExpanded : !defaultExpanded
  const compactTypes = ['character', 'weapon', 'artifact', 'outfit', 'game_data']
  const compactCounts = compactTypes.filter(t => additions[t]?.length > 0).length > 0

  // Lightbox keyboard nav
  useEffect(() => {
    if (lightboxIndex < 0 || versionImages.length === 0) return
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); setLightboxIndex(-1); return }
      if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') {
        e.preventDefault()
        setLightboxIndex(prev => prev > 0 ? prev - 1 : versionImages.length - 1)
      }
      if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') {
        e.preventDefault()
        setLightboxIndex(prev => prev < versionImages.length - 1 ? prev + 1 : 0)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightboxIndex, versionImages])

  return (
    <div className="rounded-xl border border-surface-700 bg-surface-900/60 overflow-hidden relative">
      {/* Version image background (right-to-left opacity gradient) */}
      {randomVersionImage && <VersionImageBg imageFile={randomVersionImage} />}
      {/* Version header */}
      <div
        onClick={() => onToggleExpand(collapsed)}
        className="px-5 py-4 border-b border-surface-700 flex items-center gap-3 flex-wrap cursor-pointer hover:bg-surface-800/30 transition-colors relative"
        style={{ zIndex: 1 }}
      >
        <span className="p-1 text-surface-500">
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </span>
        <span
          className={`text-2xl font-bold text-white ${versionImages.length > 0 ? 'cursor-pointer hover:text-primary-400 transition-colors' : ''}`}
          onClick={e => {
            if (versionImages.length > 0) {
              e.stopPropagation()
              setLightboxIndex(0)
            }
          }}
          title={versionImages.length > 0 ? `查看 ${versionImages.length} 张版本图` : ''}
        >
          {version}
          {versionImages.length > 0 && <span className="text-[11px] text-surface-500 ml-1.5 align-super">({versionImages.length}图)</span>}
        </span>
        {data.tags.map(t => (
          <span
            key={t.id}
            className="px-2.5 py-0.5 rounded-full text-xs font-medium"
            style={{ backgroundColor: t.color + '20', color: t.color, border: `1px solid ${t.color}40` }}
          >
            {t.tag}
          </span>
        ))}
        {/* Collapsed: show item count summary */}
        {collapsed && compactCounts && (
          <span className="text-xs text-surface-500 ml-1 flex flex-wrap gap-x-2.5">
            {compactTypes.map(t => {
              const Icon = SECTION_CONFIG[t].icon
              return additions[t]?.length > 0 && (
                <span key={t} className="inline-flex items-center gap-0.5">
                  <Icon className="w-3 h-3" />
                  {additions[t].length}
                </span>
              )
            })}
          </span>
        )}
        <div className="flex-1" />
        <button
          onClick={e => { e.stopPropagation(); onEdit() }}
          className="px-3 py-1.5 rounded-lg bg-surface-800 hover:bg-surface-700 text-surface-400 hover:text-white text-xs transition-colors"
        >
          编辑
        </button>
      </div>

      {/* Content sections — unified tree, collapsed uses CSS to compact/hide */}
      {!hasAnyContent ? (
        <div className="px-5 py-8 text-center text-surface-500 text-sm">暂无新增内容，点击编辑添加</div>
      ) : (
        <div className={collapsed ? 'p-4' : 'p-4 space-y-4'}>
          {/* Non-wish sections: flex-wrap, each section sized by item count */}
          {(() => {
            const nonWishTypes = ['character', 'weapon', 'artifact', 'outfit', 'material', 'game_data']
            const visibleTypes = collapsed ? nonWishTypes.filter(t => t !== 'material') : nonWishTypes
            const hasAny = visibleTypes.some(t => additions[t]?.length > 0)
            if (!hasAny) return null
            return (
              <div className="flex flex-wrap gap-x-6 gap-y-4">
                {visibleTypes.map(type => {
                  const items = additions[type]
                  if (!items || items.length === 0) return null
                  const config = SECTION_CONFIG[type]
                  // Size section proportionally: ~88px per column (80px card + 8px gap)
                  const cols = collapsed ? items.length : Math.min(items.length, 8)
                  const minW = Math.max(cols * 88, 160)
                  return (
                    <div key={type} style={{ flex: `0 1 ${minW}px`, minWidth: minW, maxWidth: '100%' }}>
                      {!collapsed && (
                        <div className="flex items-center gap-2 mb-3">
                          <config.icon className="w-4 h-4 text-surface-400" />
                          <h3 className="text-xs font-semibold text-surface-400 uppercase tracking-wider">{config.label}</h3>
                          <span className="text-[10px] text-surface-600 ml-1">({items.length})</span>
                          <div className="flex-1 h-px bg-surface-800 ml-2" />
                        </div>
                      )}
                      <div className={collapsed ? 'flex flex-wrap gap-3' : 'grid gap-3'} style={collapsed ? undefined : { gridTemplateColumns: `repeat(auto-fill, minmax(80px, 1fr))` }}>
                        {items.map(item => {
                          let imageFile, name, rarity, navTo
                          switch (type) {
                            case 'character':
                              imageFile = item._displayCardArt || item.card_art; name = item.name_zh; rarity = item.rarity; navTo = `/characters/${item.id}`; break
                            case 'weapon':
                              imageFile = item.simple_art || item.image; name = item.name_zh; rarity = item.rarity; navTo = `/weapons/${item.id}`; break
                            case 'artifact':
                              imageFile = item.flower_image || item.image; name = item.name_zh; rarity = item.max_rarity; navTo = `/artifacts/${item.id}`; break
                            case 'outfit':
                              imageFile = item.avatar_image; name = item.name_zh; rarity = null; navTo = `/characters/${item.character_id}#outfit-${item.id}`; break
                            case 'material':
                              imageFile = item.image; name = item.name_zh; rarity = item.rarity; navTo = `/materials/${item.id}`; break
                            case 'game_data':
                              // Rendered as a tag below, skip here
                              return null
                            default: return null
                          }
                          return <ItemCard key={`${type}-${item.id}`} imageFile={imageFile} name={name} rarity={rarity} navTo={navTo} />
                        })}
                        {/* Game data tags rendered inline */}
                        {type === 'game_data' && items.map(gd => (
                          <button
                            key={`gd-${gd.id}`}
                            onClick={() => navigate(`/data?detail=${gd.id}`)}
                            className="px-3 py-1.5 rounded-full text-xs font-medium bg-primary-500/10 text-primary-300 border border-primary-500/20 hover:bg-primary-500/20 transition-colors h-fit self-center"
                          >
                            {gd.title_zh}
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })()}

          {/* Wish section: always full-width, hidden when collapsed */}
          <div className={collapsed ? 'hidden' : ''}>
            {additions.wish?.length > 0 && (
              <div className="mt-6">
                <div className="flex items-center gap-2 mb-3">
                  <Star className="w-4 h-4 text-surface-400" />
                  <h3 className="text-xs font-semibold text-surface-400 uppercase tracking-wider">{SECTION_CONFIG.wish.label}</h3>
                  <span className="text-[10px] text-surface-600 ml-1">({additions.wish.length})</span>
                  <div className="flex-1 h-px bg-surface-800 ml-2" />
                </div>
                {(() => {
                  const byPhase = {}
                  for (const wish of additions.wish) {
                    const p = wish.phase || 1
                    if (!byPhase[p]) byPhase[p] = []
                    byPhase[p].push(wish)
                  }
                  const phaseKeys = Object.keys(byPhase).map(Number).sort()
                  return phaseKeys.map(phase => {
                    const phaseWishes = byPhase[phase]
                    let phaseStart = null, phaseEnd = null
                    for (const w of phaseWishes) {
                      if (w.start_date && (!phaseStart || w.start_date < phaseStart)) phaseStart = w.start_date
                      if (w.end_date && (!phaseEnd || w.end_date > phaseEnd)) phaseEnd = w.end_date
                    }
                    const phaseDateStr = phaseStart && phaseEnd ? `${phaseStart} ~ ${phaseEnd}` : phaseStart || phaseEnd || null
                    const sorted = [...phaseWishes].sort((a, b) => {
                      const ai = BANNER_TYPE_ORDER.indexOf(a.banner_type || 'standard')
                      const bi = BANNER_TYPE_ORDER.indexOf(b.banner_type || 'standard')
                      return ai - bi
                    })
                    return (
                      <div key={phase} className="space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-medium text-primary-400 bg-primary-500/10 px-1.5 py-0.5 rounded">第{phase}期</span>
                          {phaseDateStr && <span className="text-[10px] text-surface-500">{phaseDateStr}</span>}
                          <div className="flex-1 h-px bg-surface-800 ml-1" />
                        </div>
                        <div className="flex flex-wrap gap-3">
                          {sorted.map(wish => (
                            <WishDisplay key={wish.id} wish={wish} charMap={charMap} weaponMap={weaponMap} />
                          ))}
                        </div>
                      </div>
                    )
                  })
                })()}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Version image lightbox */}
      {lightboxIndex >= 0 && versionImages.length > 0 && (
        <VersionImageLightbox
          images={versionImages}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(-1)}
          onPrev={() => setLightboxIndex(prev => prev > 0 ? prev - 1 : versionImages.length - 1)}
          onNext={() => setLightboxIndex(prev => prev < versionImages.length - 1 ? prev + 1 : 0)}
        />
      )}
    </div>
  )
}

// ── Wish display (like BannerCard detail mode) ──
function WishDisplay({ wish, charMap, weaponMap }) {
  const banners = wish.banners || []
  const typeLabel = BANNER_TYPES[wish.banner_type] || ''

  if (banners.length === 0) {
    return (
      <div className="rounded-lg border border-surface-700 bg-surface-800/30 px-3 py-2">
        <div className="flex items-center gap-2 flex-wrap">
          {typeLabel && (
            <span className="text-[9px] text-surface-500 bg-surface-700/50 px-1.5 py-0.5 rounded flex-shrink-0">{typeLabel}</span>
          )}
          <span className="text-sm text-surface-300">{wish.name_zh || `祈愿 #${wish.id}`}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-surface-700 bg-surface-800/30 overflow-hidden min-w-0">
      {/* Wish header: type badge */}
      <div className="flex items-center gap-1.5 px-2 py-1 border-b border-surface-700/30">
        {typeLabel && (
          <span className="text-[8px] text-surface-500 bg-surface-700/50 px-1.5 py-0.5 rounded flex-shrink-0">{typeLabel}</span>
        )}
      </div>
      <div className="p-1.5 space-y-1.5">
        {banners.map(banner => {
          const charItems = (banner.items || []).filter(i => i.item_type === 'character')
          const weaponItems = (banner.items || []).filter(i => i.item_type === 'weapon')
          const hasContent = charItems.length > 0 || weaponItems.length > 0

          return (
            <div key={banner.id}>
              <div className="space-y-1.5">
                {charItems.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {charItems.map(item => (
                      <ItemThumb key={item.id} item={item} charMap={charMap} weaponMap={weaponMap} compact />
                    ))}
                  </div>
                )}
                {weaponItems.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {weaponItems.map(item => (
                      <ItemThumb key={item.id} item={item} charMap={charMap} weaponMap={weaponMap} compact />
                    ))}
                  </div>
                )}
                {!hasContent && (
                  <p className="text-xs text-surface-600 text-center">暂无内容</p>
                )}
              </div>
              {banner.name_zh && (
                <p className="text-[10px] font-medium text-surface-500 text-center mt-1.5 truncate">{banner.name_zh}</p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Edit form ──
function EditForm({
  formVersion, setFormVersion, formTags, addFormTag, updateFormTag, removeFormTag, moveFormTag,
  formAdditions, toggleFormItem, removeFormItem, moveFormItem,
  charOptions, weaponOptions, artifactOptions, materialOptions, wishOptions, outfitOptions, gameDataOptions,
  charMap, weaponMap, artifactMap, materialMap, wishMap, outfitMap, gameDataMap, readImage,
  formVersionImages, setFormVersionImages,
}) {
  const { importImage } = useDb()
  const [dragOver, setDragOver] = useState(false)
  const [activeTab, setActiveTab] = useState('character')
  const [searchText, setSearchText] = useState('')

  const TABS = [
    { key: 'character', label: '角色' },
    { key: 'weapon', label: '武器' },
    { key: 'artifact', label: '圣遗物' },
    { key: 'outfit', label: '时装' },
    { key: 'material', label: '材料' },
    { key: 'game_data', label: '数据' },
    { key: 'wish', label: '祈愿' },
  ]

  const optionsMap = {
    character: charOptions,
    weapon: weaponOptions,
    artifact: artifactOptions,
    outfit: outfitOptions,
    material: materialOptions,
    game_data: gameDataOptions,
    wish: wishOptions,
  }

  const nameMap = {
    character: charMap,
    weapon: weaponMap,
    artifact: artifactMap,
    outfit: outfitMap,
    material: materialMap,
    game_data: gameDataMap,
    wish: wishMap,
  }

  const selectedIds = formAdditions[activeTab] || []
  const options = optionsMap[activeTab] || []

  // Filter unselected by search
  const searchLower = searchText.toLowerCase().trim()
  const unselectedOptions = options.filter(o => {
    if (selectedIds.includes(o.value)) return false
    if (searchLower && !o.label.toLowerCase().includes(searchLower)) return false
    return true
  })

  // Split into selected (shown at top)
  const selectedItems = selectedIds.map(id => {
    const opt = options.find(o => o.value === id)
    return opt || { value: id, label: (nameMap[activeTab]?.[id]?.name_zh || `ID:${id}`), image: null }
  })

  // For wish tab: sort selected by banner_type order
  const sortedSelectedItems = activeTab === 'wish'
    ? [...selectedItems].sort((a, b) => {
        const ai = BANNER_TYPE_ORDER.indexOf(a.banner_type)
        const bi = BANNER_TYPE_ORDER.indexOf(b.banner_type)
        if (ai !== bi) return ai - bi
        return selectedIds.indexOf(a.value) - selectedIds.indexOf(b.value)
      })
    : selectedItems

  // For wish tab: group unselected by banner_type with labels
  const groupedUnselected = activeTab === 'wish'
    ? BANNER_TYPE_ORDER.map(type => ({
        label: BANNER_TYPES[type],
        items: unselectedOptions.filter(o => o.banner_type === type),
      })).filter(g => g.items.length > 0)
    : null

  function handleSelect(id) {
    toggleFormItem(activeTab, id)
  }

  function handleDragStart(e, idx) {
    e.dataTransfer.setData('text/plain', String(idx))
  }

  function handleDragOver(e) {
    e.preventDefault()
  }

  function handleDrop(e, toIdx) {
    e.preventDefault()
    const fromIdx = parseInt(e.dataTransfer.getData('text/plain'))
    if (!isNaN(fromIdx) && fromIdx !== toIdx) {
      moveFormItem(activeTab, fromIdx, toIdx)
    }
  }

  return (
    <div className="space-y-4">
      {/* Version */}
      <FormInput
        label="版本号"
        value={formVersion}
        onChange={setFormVersion}
        placeholder="例如：5.7"
      />

      {/* Version images */}
      <FormField label="版本图">
        <div className="space-y-3">
          {/* Image list */}
          {formVersionImages.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {formVersionImages.map((file, idx) => (
                <div key={idx} className="relative">
                  <ThumbPreview file={file} readImage={readImage} />
                  <button
                    onClick={() => setFormVersionImages(prev => prev.filter((_, i) => i !== idx))}
                    className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white flex items-center justify-center"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {/* Import: button + drag-drop zone */}
          <div
            className={`flex items-center gap-3 p-3 rounded-lg border-2 border-dashed transition-colors ${
              dragOver ? 'border-primary-500 bg-primary-500/10' : 'border-surface-600 bg-surface-800/30'
            }`}
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={async e => {
              e.preventDefault()
              setDragOver(false)
              const file = e.dataTransfer.files[0]
              if (file) {
                const result = await window.electronAPI?.importImageFile(file.path)
                if (result?.success && result.filename) {
                  setFormVersionImages(prev => [...prev, result.filename])
                }
              }
            }}
          >
            <ImagePlus className="w-5 h-5 text-surface-400 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-xs text-surface-300">{dragOver ? '释放以导入' : '拖放图片到此处，或点击按钮导入'}</p>
              <p className="text-[10px] text-surface-500 mt-0.5">
                已添加 {formVersionImages.length} 张。版本图在条目背景显示（随机一张），点击版本号可浏览全部
              </p>
            </div>
            <button
              onClick={async () => {
                const filename = await importImage()
                if (filename) setFormVersionImages(prev => [...prev, filename])
              }}
              className="px-3 py-1.5 rounded-lg text-xs bg-surface-700 hover:bg-surface-600 text-surface-300 transition-colors flex-shrink-0"
            >
              导入图片
            </button>
          </div>
        </div>
      </FormField>

      {/* Tags */}
      <FormField label="版本标签">
        <div className="space-y-2">
          {formTags.map((t, idx) => (
            <div
              key={t.id}
              draggable
              onDragStart={e => e.dataTransfer.setData('text/plain', String(idx))}
              onDragOver={e => e.preventDefault()}
              onDrop={e => {
                e.preventDefault()
                const fromIdx = parseInt(e.dataTransfer.getData('text/plain'))
                if (!isNaN(fromIdx) && fromIdx !== idx) moveFormTag(fromIdx, idx)
              }}
              className="flex items-center gap-2"
            >
              <GripVertical className="w-3 h-3 text-surface-600 flex-shrink-0 cursor-grab" />
              <input
                type="text"
                value={t.tag}
                onChange={e => updateFormTag(idx, 'tag', e.target.value)}
                placeholder="标签文字"
                className="flex-1 px-3 py-1.5 bg-surface-800 border border-surface-600 rounded-lg text-sm text-white placeholder-surface-500 focus:outline-none focus:border-primary-500 transition-colors"
              />
              {/* Color presets */}
              <div className="flex gap-1">
                {PRESET_COLORS.map(c => (
                  <button
                    key={c}
                    onClick={() => updateFormTag(idx, 'color', c)}
                    className={`w-5 h-5 rounded-full border-2 transition-all ${t.color === c ? 'border-white scale-110' : 'border-transparent hover:scale-105'}`}
                    style={{ backgroundColor: c }}
                    title={c}
                  />
                ))}
              </div>
              <input
                type="text"
                value={t.color}
                onChange={e => updateFormTag(idx, 'color', e.target.value)}
                placeholder="#6366f1"
                className="w-20 px-2 py-1.5 bg-surface-800 border border-surface-600 rounded-lg text-xs text-white placeholder-surface-500 focus:outline-none focus:border-primary-500 font-mono transition-colors"
              />
              <button
                onClick={() => removeFormTag(idx)}
                className="p-1.5 rounded text-surface-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          <button
            onClick={addFormTag}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-surface-800 hover:bg-surface-700 text-surface-400 hover:text-white text-xs transition-colors"
          >
            <Plus className="w-3 h-3" />
            添加标签
          </button>
        </div>
      </FormField>

      {/* Content tabs */}
      <FormField label="新增内容">
        {/* Tab bar */}
        <div className="flex gap-1 mb-3">
          {TABS.map(tab => {
            const count = (formAdditions[tab.key] || []).length
            return (
              <button
                key={tab.key}
                onClick={() => { setActiveTab(tab.key); setSearchText('') }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors
                  ${activeTab === tab.key
                    ? 'bg-primary-500/20 text-primary-400'
                    : 'bg-surface-800 text-surface-400 hover:text-white'
                  }`}
              >
                {tab.label}{count > 0 && ` (${count})`}
              </button>
            )
          })}
        </div>

        {/* Selected items (draggable) */}
        {sortedSelectedItems.length > 0 && (
          <div className="space-y-1 mb-3">
            <div className="text-[10px] text-surface-500 mb-1">已选择（可拖拽排序）：</div>
            {sortedSelectedItems.map((item, idx) => (
              <div
                key={item.value}
                draggable
                onDragStart={e => handleDragStart(e, idx)}
                onDragOver={handleDragOver}
                onDrop={e => handleDrop(e, idx)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-800 border border-surface-700 cursor-grab active:cursor-grabbing"
              >
                <GripVertical className="w-3 h-3 text-surface-600 flex-shrink-0" />
                <ThumbPreview file={item.image} readImage={readImage} />
                <span className="text-sm text-white flex-1 truncate">{item.label}</span>
                <button
                  onClick={() => removeFormItem(activeTab, item.value)}
                  className="p-1 rounded text-surface-500 hover:text-red-400 transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Search */}
        <div className="flex items-center bg-surface-800 border border-surface-600 rounded-lg focus-within:border-primary-500 focus-within:ring-1 focus-within:ring-primary-500/20 transition-colors mb-2">
          <Search className="w-3.5 h-3.5 text-surface-500 ml-2.5 flex-shrink-0" />
          <input
            type="text"
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            placeholder={`搜索${TABS.find(t => t.key === activeTab)?.label || ''}...`}
            className="flex-1 px-2 py-2 bg-transparent text-sm text-white placeholder-surface-500 focus:outline-none"
          />
        </div>

        {/* Options list — matching WishesPage ThumbOption pattern */}
        <div className="max-h-48 overflow-y-auto border border-surface-700 rounded-lg">
          {activeTab === 'wish' ? (
            groupedUnselected.length === 0 ? (
              <p className="px-2 py-3 text-xs text-surface-500 text-center">没有更多可选项目</p>
            ) : (
              groupedUnselected.map(group => (
                <div key={group.label}>
                  <div className="px-2 py-1 text-[10px] text-surface-500 bg-surface-850/50 border-b border-surface-700">
                    {group.label}
                  </div>
                  {group.items.map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => handleSelect(opt.value)}
                      className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-surface-600 transition-colors text-left"
                    >
                      <ThumbPreview file={opt.image} readImage={readImage} />
                      <span className="text-xs text-white truncate">{opt.label}</span>
                      <Plus className="w-3 h-3 text-surface-600 ml-auto flex-shrink-0" />
                    </button>
                  ))}
                </div>
              ))
            )
          ) : (
            unselectedOptions.length === 0 ? (
              <p className="px-2 py-3 text-xs text-surface-500 text-center">没有更多可选项目</p>
            ) : (
              unselectedOptions.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handleSelect(opt.value)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-surface-600 transition-colors text-left"
                >
                  <ThumbPreview file={opt.image} readImage={readImage} />
                  <span className="text-xs text-white truncate">{opt.label}</span>
                  <Plus className="w-3 h-3 text-surface-600 ml-auto flex-shrink-0" />
                </button>
              ))
            )
          )}
        </div>
      </FormField>
    </div>
  )
}

// ── Thumb Preview (matching WishesPage pattern, with stable readImage ref) ──
function ThumbPreview({ file, readImage }) {
  const [src, setSrc] = useState(null)
  const readImageRef = useRef(readImage)
  readImageRef.current = readImage

  useEffect(() => {
    if (!file) { setSrc(null); return }
    let cancelled = false
    readImageRef.current(file).then(data => { if (!cancelled) setSrc(data) })
    return () => { cancelled = true }
  }, [file])

  if (!src) return <div className="w-6 h-6 rounded bg-surface-600 flex-shrink-0 pointer-events-none" />
  return <img src={src} alt="" draggable={false} className="w-6 h-6 rounded object-cover flex-shrink-0 pointer-events-none" />
}

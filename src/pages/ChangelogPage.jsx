import { useState, useEffect, useMemo, useRef, useLayoutEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDb } from '../context/DbContext'
import { useNav } from '../context/NavContext'
import { useLazyImage, bumpLazyRevision } from '../hooks/useLazyImage'
import { savePageStateSync, loadPageStateSync } from '../utils/pageStateStore'
import { Plus, GripVertical, ArrowUpDown, X, Search, ChevronDown, ChevronRight } from 'lucide-react'
import SearchBar from '../components/SearchBar'
import EditModal, { FormInput, FormField } from '../components/EditModal'
import ItemThumb from '../components/ItemThumb'

const PRESET_COLORS = [
  '#ef4444', '#f97316', '#FFD780', '#22c55e',
  '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899',
  '#6b7280',
]

const SECTION_CONFIG = {
  character: { label: '角色', icon: '👤' },
  weapon: { label: '武器', icon: '⚔️' },
  artifact: { label: '圣遗物', icon: '💠' },
  material: { label: '重要材料', icon: '📦' },
  wish: { label: '祈愿', icon: '✨' },
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
  const [loaded, setLoaded] = useState(false)

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
  const [saving, setSaving] = useState(false)

  // Options for SearchableSelect
  const [charOptions, setCharOptions] = useState([])
  const [weaponOptions, setWeaponOptions] = useState([])
  const [artifactOptions, setArtifactOptions] = useState([])
  const [materialOptions, setMaterialOptions] = useState([])
  const [wishOptions, setWishOptions] = useState([])

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
    const [chars, weps, arts, mats, wishes, fits] = await Promise.all([
      query('SELECT id, name_zh, card_art, rarity FROM characters'),
      query('SELECT id, name_zh, image, simple_art, rarity FROM weapons'),
      query('SELECT id, name_zh, image, flower_image FROM artifacts'),
      query('SELECT id, name_zh, image, type FROM materials'),
      query('SELECT id, version, phase, banner_type, name_zh, start_date, end_date FROM wishes'),
      query('SELECT id, character_id, avatar_image FROM character_outfits WHERE avatar_image IS NOT NULL AND avatar_image != \'\''),
    ])

    // Build outfit avatar map
    const fitsData = fits.data || []
    const outfitAvatarMap = {}
    for (const f of fitsData) {
      outfitAvatarMap[f.id] = f.avatar_image
    }
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

    // Load version data
    await loadVersionData(cm, wm, am, mm, wishMapTemp)
    setLoaded(true)
  }

  async function loadVersionData(cm, wm, am, mm, wishMapTemp) {
    const [tagsRes, addsRes] = await Promise.all([
      query('SELECT * FROM version_tags ORDER BY sort_order, id'),
      query('SELECT * FROM version_additions ORDER BY sort_order, id'),
    ])
    const tagsData = tagsRes.data || []
    const addsData = addsRes.data || []

    const verMap = {}
    for (const t of tagsData) {
      if (!verMap[t.version]) verMap[t.version] = { tags: [], additions: {} }
      verMap[t.version].tags.push(t)
    }
    for (const a of addsData) {
      if (!verMap[a.version]) verMap[a.version] = { tags: [], additions: {} }
      if (!verMap[a.version].additions[a.item_type]) verMap[a.version].additions[a.item_type] = []
      // Look up the entity
      let entity = null
      switch (a.item_type) {
        case 'character': entity = cm[a.item_id]; break
        case 'weapon': entity = wm[a.item_id]; break
        case 'artifact': entity = am[a.item_id]; break
        case 'material': entity = mm[a.item_id]; break
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

      // Reload
      await loadVersionData(charMap, weaponMap, artifactMap, materialMap, wishMap)
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
            <img src={src} alt="" className="w-full h-full object-cover" />
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
          charMap={charMap}
          weaponMap={weaponMap}
          artifactMap={artifactMap}
          materialMap={materialMap}
          wishMap={wishMap}
          readImage={readImage}
        />
      </EditModal>
    </div>
  )
}

// ── Version entry display ──
function VersionEntry({ version, data, charMap, weaponMap, artifactMap, materialMap, wishMap, onEdit, ItemCard, isExpanded, defaultExpanded, onToggleExpand }) {
  const additions = data.additions || {}
  const hasAnyContent = Object.values(additions).some(arr => arr.length > 0)

  // Use controlled expand state: explicit isExpanded > local default
  const collapsed = isExpanded !== undefined ? !isExpanded : !defaultExpanded

  // Count items per type for collapsed summary
  const compactTypes = ['character', 'weapon', 'artifact']
  const compactCounts = compactTypes.filter(t => additions[t]?.length > 0).length > 0

  return (
    <div className="rounded-xl border border-surface-700 bg-surface-900/60 overflow-hidden">
      {/* Version header */}
      <div
        onClick={() => onToggleExpand(collapsed)}
        className="px-5 py-4 border-b border-surface-700 flex items-center gap-3 flex-wrap cursor-pointer hover:bg-surface-800/30 transition-colors"
      >
        <span className="p-1 text-surface-500">
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </span>
        <span className="text-2xl font-bold text-white">{version}</span>
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
          <span className="text-xs text-surface-500 ml-1">
            {compactTypes.map(t => additions[t]?.length > 0 && `${additions[t].length}${SECTION_CONFIG[t].icon}`).filter(Boolean).join(' ')}
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
        <div className={collapsed ? 'p-4' : 'p-5 space-y-6'}>
          {/* Non-wish sections: flex-wrap, each section sized by item count */}
          {(() => {
            const nonWishTypes = Object.keys(SECTION_CONFIG).filter(t => t !== 'wish')
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
                          <span className="text-sm">{config.icon}</span>
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
                            case 'material':
                              imageFile = item.image; name = item.name_zh; rarity = item.rarity; navTo = `/materials/${item.id}`; break
                            default: return null
                          }
                          return <ItemCard key={`${type}-${item.id}`} imageFile={imageFile} name={name} rarity={rarity} navTo={navTo} />
                        })}
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
                  <span className="text-sm">{SECTION_CONFIG.wish.icon}</span>
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
      {/* Wish header: type badge + name */}
      <div className="flex items-center gap-1.5 px-2 py-1 border-b border-surface-700/30">
        {typeLabel && (
          <span className="text-[8px] text-surface-500 bg-surface-700/50 px-1.5 py-0.5 rounded flex-shrink-0">{typeLabel}</span>
        )}
        {wish.name_zh && (
          <span className="text-[10px] text-surface-400 font-medium truncate">{wish.name_zh}</span>
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
  charOptions, weaponOptions, artifactOptions, materialOptions, wishOptions,
  charMap, weaponMap, artifactMap, materialMap, wishMap, readImage,
}) {
  const [activeTab, setActiveTab] = useState('character')
  const [searchText, setSearchText] = useState('')

  const TABS = [
    { key: 'character', label: '角色' },
    { key: 'weapon', label: '武器' },
    { key: 'artifact', label: '圣遗物' },
    { key: 'material', label: '材料' },
    { key: 'wish', label: '祈愿' },
  ]

  const optionsMap = {
    character: charOptions,
    weapon: weaponOptions,
    artifact: artifactOptions,
    material: materialOptions,
    wish: wishOptions,
  }

  const nameMap = {
    character: charMap,
    weapon: weaponMap,
    artifact: artifactMap,
    material: materialMap,
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

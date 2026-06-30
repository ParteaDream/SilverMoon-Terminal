import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDb } from '../context/DbContext'
import { useNav } from '../context/NavContext'
import { clearDetailScroll } from '../hooks/useDetailState'
import { useLazyImage } from '../hooks/useLazyImage'
import { savePageStateSync, loadPageStateSync } from '../utils/pageStateStore'
import { Plus, Trash2, Image, List, Search, CheckSquare, Square, ArrowUpDown, GripVertical, User, Sword, ChevronLeft, ChevronRight, Columns } from 'lucide-react'
import SearchBar from '../components/SearchBar'
import EditModal, { FormInput, ImagePicker } from '../components/EditModal'
import Lightbox from '../components/Lightbox'

const BANNER_TYPES = {
  'character-event': '角色活动祈愿',
  'weapon-event': '武器活动祈愿',
  'chronicled': '集录祈愿',
  'standard': '常驻祈愿',
}

function parseBannerImages(raw) {
  if (!raw) return []
  if (raw === 'null') return [] // tolerate legacy JSON.stringify(null) bug
  if (typeof raw === 'string' && raw.startsWith('[')) {
    try { return JSON.parse(raw) } catch (_) { return [] }
  }
  return [raw] // legacy single string
}

export default function WishesPage() {
  const { query, readImage } = useDb()
  const { restorePage, savePage, consumeBackToList } = useNav()
  const restoringScroll = useRef(false)

  // Data
  const [wishes, setWishes] = useState([])
  const [banners, setBanners] = useState([])       // all wish_banners
  const [bannerItems, setBannerItems] = useState([]) // all wish_banner_items
  const [charMap, setCharMap] = useState({})        // character id -> {name_zh, image, ...}
  const [weaponMap, setWeaponMap] = useState({})    // weapon id -> {name_zh, image, ...}

  // UI state
  const [bannerType, setBannerType] = useState('character-event')
  const [search, setSearch] = useState('')
  const [showImages, setShowImages] = useState(() => {
    try {
      const defs = JSON.parse(localStorage.getItem('default_view_mode') || '{}')
      return defs.wishes === 'images'
    } catch (_) { return false }
  })
  const [compactMode, setCompactMode] = useState(false) // compact layout mode
  const [sortAsc, setSortAsc] = useState(false) // sort ascending (oldest first)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState(new Set())
  // Modal
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)       // the wish being edited
  const [form, setForm] = useState({})                // wish form
  const [formBanners, setFormBanners] = useState([])  // sub-banners for the wish
  const [saving, setSaving] = useState(false)
  const [lightbox, setLightbox] = useState(null)

  const initialLoadDone = useRef(false)

  // Load all data
  useEffect(() => { loadAll() }, [])
  // bannerType/sortAsc 变化时重新加载（跳过首次，由 mount effect 控制）
  useEffect(() => {
    if (!initialLoadDone.current) return
    loadWishes()
  }, [bannerType, sortAsc])

  // ── 状态持久化 ──
  useEffect(() => {
    const isBack = consumeBackToList()
    if (isBack) {
      restorePage('wishes').then(saved => {
        const restoreType = saved?.bannerType || bannerType
        if (saved) {
          if (saved.bannerType) setBannerType(restoreType)
          if (saved.showImages != null) setShowImages(saved.showImages)
          if (saved.scrollY != null && saved.scrollY > 0) {
            sessionStorage.setItem('_wishes_restore_y', String(saved.scrollY))
          }
        }
        initialLoadDone.current = true
        loadWishes(restoreType)  // 显式传入类型，不依赖闭包中的 bannerType
      })
    } else {
      const main = document.querySelector('main')
      if (main) main.scrollTo(0, 0)
      initialLoadDone.current = true
      loadWishes()
    }
  }, [])
  // 数据加载完成后恢复滚轮位置
  useEffect(() => {
    if (wishes.length === 0 && banners.length === 0) return
    const restoreY = sessionStorage.getItem('_wishes_restore_y')
    if (!restoreY) return
    const targetY = Number(restoreY)
    if (targetY <= 0) { sessionStorage.removeItem('_wishes_restore_y'); return }
    sessionStorage.removeItem('_wishes_restore_y')
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
  }, [wishes, banners])

  // 滚动时保存
  useLayoutEffect(() => {
    const main = document.querySelector('main')
    if (!main) return
    let timer = null
    const save = () => {
      if (restoringScroll.current) return
      savePage('wishes', { bannerType, showImages })
    }
    const onScroll = () => {
      clearTimeout(timer)
      if (restoringScroll.current) return
      timer = setTimeout(save, 150)
    }
    main.addEventListener('scroll', onScroll, { passive: true })
    return () => { main.removeEventListener('scroll', onScroll); clearTimeout(timer); save() }
  }, [bannerType, showImages, savePage])
  // bannerType/showImages 变化时立即保存状态到 user.json（保留已有的滚轮数据）
  useEffect(() => {
    if (!initialLoadDone.current) return
    const current = loadPageStateSync('wishes')
    const scrollY = current?.scrollY || 0
    savePageStateSync('wishes', scrollY, { bannerType, showImages })
  }, [bannerType, showImages])

  // 快捷键 F：切换卡池图 / 详情模式
  useEffect(() => {
    function onKeyDown(e) {
      // 编辑模式打开时不响应，避免误触
      if (modalOpen) return
      // 输入框中不响应
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault()
        setShowImages(prev => !prev)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [modalOpen])

  async function loadAll() {
    const [chars, weps, fits] = await Promise.all([
      query('SELECT id, name_zh, card_art, splash_art, rarity FROM characters'),
      query('SELECT id, name_zh, image, simple_art, rarity FROM weapons'),
      query('SELECT id, character_id, avatar_image FROM character_outfits WHERE avatar_image IS NOT NULL AND avatar_image != \'\''),
    ])
    // 构建 outfit avatar 映射
    const fitsData = fits.data || []
    const outfitAvatarMap = {}
    for (const f of fitsData) {
      outfitAvatarMap[f.id] = f.avatar_image
    }
    // 从 user.json 读取 outfit 选择（回退用）
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
    setCharMap(cm)
    setWeaponMap(wm)
  }

  async function loadWishes(type) {
    const bt = type || bannerType
    const wRes = await query(
      `SELECT * FROM wishes WHERE banner_type = ? ORDER BY version ${sortAsc ? 'ASC' : 'DESC'}, phase ${sortAsc ? 'ASC' : 'DESC'}`,
      [bt]
    )
    const wList = wRes.data || []
    setWishes(wList)

    if (wList.length > 0) {
      const ids = wList.map(w => w.id)
      const placeholders = ids.map(() => '?').join(',')
      const [bRes, biRes] = await Promise.all([
        query(`SELECT * FROM wish_banners WHERE wish_id IN (${placeholders}) ORDER BY sort_order, id`, ids),
        query(`SELECT wbi.* FROM wish_banner_items wbi JOIN wish_banners wb ON wbi.banner_id = wb.id WHERE wb.wish_id IN (${placeholders}) ORDER BY wbi.rarity DESC, wbi.sort_order, wbi.id`, ids),
      ])
      setBanners(bRes.data || [])
      setBannerItems(biRes.data || [])
    } else {
      setBanners([])
      setBannerItems([])
    }
  }

  // Open add modal
  function openAdd() {
    setEditing(null)
    setForm({ version: '', phase: 1, banner_type: bannerType, start_date: '', end_date: '' })
    setFormBanners([])
    setModalOpen(true)
  }

  // Open edit modal
  async function openEdit(wish) {
    setEditing(wish)
    setForm({ version: wish.version, phase: wish.phase, banner_type: wish.banner_type, start_date: wish.start_date || '', end_date: wish.end_date || '' })

    // Load banners and items for this wish
    const bRes = await query('SELECT * FROM wish_banners WHERE wish_id = ? ORDER BY sort_order, id', [wish.id])
    const fb = []
    for (const b of (bRes.data || [])) {
      const biRes = await query('SELECT * FROM wish_banner_items WHERE banner_id = ? ORDER BY rarity DESC, sort_order, id', [b.id])
      fb.push({
        id: b.id,
        name_zh: b.name_zh || '',
        banner_image: parseBannerImages(b.banner_image),
        sort_order: b.sort_order || 0,
        items: (biRes.data || []).map(i => ({
          id: i.id,
          item_type: i.item_type,
          item_id: i.item_id,
          rarity: i.rarity,
          sort_order: i.sort_order || 0,
        })),
      })
    }
    setFormBanners(fb)
    setModalOpen(true)
  }

  // Add a banner in the form
  function addFormBanner() {
    const defaultName = bannerType === 'weapon-event' ? '神铸赋形' : bannerType === 'standard' ? '奔行世间' : ''
    setFormBanners([...formBanners, { id: -Date.now(), name_zh: defaultName, banner_image: [], sort_order: formBanners.length, items: [] }])
  }

  function moveFormBanner(fromId, toId) {
    setFormBanners(prev => {
      const fromIdx = prev.findIndex(b => b.id === fromId)
      const toIdx = prev.findIndex(b => b.id === toId)
      if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return prev
      const next = [...prev]
      const [moved] = next.splice(fromIdx, 1)
      next.splice(toIdx, 0, moved)
      return next
    })
  }

  function removeFormBanner(bannerId) {
    setFormBanners(formBanners.filter(b => b.id !== bannerId))
  }

  function updateFormBanner(bannerId, field, value) {
    setFormBanners(formBanners.map(b => b.id === bannerId ? { ...b, [field]: value } : b))
  }

  function addBannerItem(bannerId, itemType = 'character', rarity = 5) {
    setFormBanners(formBanners.map(b => b.id === bannerId ? {
      ...b,
      items: [...b.items, { id: -Date.now(), item_type: itemType, item_id: 0, rarity, sort_order: 0 }],
    } : b))
  }

  function moveBannerItem(bannerId, fromItemId, toItemId) {
    setFormBanners(formBanners.map(b => {
      if (b.id !== bannerId) return b
      const fromIdx = b.items.findIndex(it => it.id === fromItemId)
      const toIdx = b.items.findIndex(it => it.id === toItemId)
      if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return b
      const items = [...b.items]
      const [moved] = items.splice(fromIdx, 1)
      items.splice(toIdx, 0, moved)
      return { ...b, items }
    }))
  }

  function removeBannerItem(bannerId, itemId) {
    setFormBanners(formBanners.map(b =>
      b.id === bannerId ? { ...b, items: b.items.filter(it => it.id !== itemId) } : b
    ))
  }

  function updateBannerItem(bannerId, itemId, field, value) {
    setFormBanners(formBanners.map(b =>
      b.id === bannerId ? {
        ...b,
        items: b.items.map(it => it.id === itemId ? { ...it, [field]: value } : it),
      } : b
    ))
  }

  async function handleSave() {
    if (saving) return
    if (!form.version || !form.version.trim()) {
      alert('请输入版本号')
      return
    }
    setSaving(true)
    try {
      let wishId = editing ? editing.id : null

      if (editing) {
        // Update wish
        await query(
          'UPDATE wishes SET version = ?, phase = ?, banner_type = ?, start_date = ?, end_date = ? WHERE id = ?',
          [form.version, form.phase, form.banner_type, form.start_date || null, form.end_date || null, editing.id]
        )
        wishId = editing.id
        // Delete old banners (cascade deletes items)
        await query('DELETE FROM wish_banners WHERE wish_id = ?', [wishId])
      } else {
        // Insert new wish
        await query(
          'INSERT INTO wishes (version, phase, banner_type, start_date, end_date) VALUES (?, ?, ?, ?, ?)',
          [form.version, form.phase, form.banner_type, form.start_date || null, form.end_date || null]
        )
        const idRes = await query('SELECT MAX(id) as id FROM wishes')
        wishId = idRes.data?.[0]?.id
      }

      // Insert banners and items
      for (let bi = 0; bi < formBanners.length; bi++) {
        const b = formBanners[bi]
        await query(
          'INSERT INTO wish_banners (wish_id, name_zh, banner_image, sort_order) VALUES (?, ?, ?, ?)',
          [wishId, b.name_zh || null, b.banner_image?.filter(Boolean)?.length ? JSON.stringify(b.banner_image.filter(Boolean)) : null, bi]
        )
        const bIdRes = await query('SELECT MAX(id) as id FROM wish_banners WHERE wish_id = ?', [wishId])
        const bannerId = bIdRes.data?.[0]?.id

        for (let ii = 0; ii < b.items.length; ii++) {
          const item = b.items[ii]
          // Skip items without a valid selection
          if (!item.item_id || item.item_id === 0) continue
          await query(
            'INSERT INTO wish_banner_items (banner_id, item_type, item_id, rarity, sort_order) VALUES (?, ?, ?, ?, ?)',
            [bannerId, item.item_type, item.item_id, item.rarity, ii]
          )
        }
      }

      setModalOpen(false)
      await loadWishes()
    } catch (e) {
      console.error('Save failed:', e)
      alert('保存失败: ' + (e.message || '未知错误'))
    } finally {
      setSaving(false)
    }
  }

  function toggleSelect(wishId) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(wishId)) next.delete(wishId); else next.add(wishId)
      return next
    })
  }

  function toggleSelectAll() {
    const ids = filtered.map(w => w.id)
    if (ids.every(id => selected.has(id))) setSelected(new Set())
    else setSelected(new Set(ids))
  }

  async function handleBulkDelete() {
    if (selected.size === 0) return
    if (!confirm(`确定删除选中的 ${selected.size} 条祈愿记录？此操作不可撤销。`)) return
    const ids = [...selected]
    await query(`DELETE FROM wishes WHERE id IN (${ids.map(() => '?').join(',')})`, ids)
    setSelected(new Set())
    await loadWishes()
  }

  // Filter — search by version, banner name, character name, or weapon name
  const searchLower = search.toLowerCase()
  const filtered = wishes.filter(w => {
    if (!search) return true
    if (w.version.toLowerCase().includes(searchLower)) return true
    // search banner names
    const wishBanners = getBannersForWish(w.id)
    for (const b of wishBanners) {
      if (b.name_zh && b.name_zh.toLowerCase().includes(searchLower)) return true
      // search char/weapon names within banner items
      const items = getItemsForBanner(b.id)
      for (const item of items) {
        if (item.item_type === 'character') {
          const c = charMap[item.item_id]
          if (c && c.name_zh && c.name_zh.toLowerCase().includes(searchLower)) return true
        } else {
          const wp = weaponMap[item.item_id]
          if (wp && wp.name_zh && wp.name_zh.toLowerCase().includes(searchLower)) return true
        }
      }
    }
    return false
  })

  // Get banners for a wish
  function getBannersForWish(wishId) {
    return banners.filter(b => b.wish_id === wishId)
  }

  function getItemsForBanner(bannerId) {
    return bannerItems.filter(i => i.banner_id === bannerId)
  }

  return (
    <div className="p-6">
      {/* Header row */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">祈愿</h1>
          <p className="text-xs text-surface-500 mt-0.5">{filtered.length} 条记录</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Display mode toggle: 卡池图 / 详情 */}
          <div className="flex items-center rounded-lg bg-surface-800 border border-surface-700 p-0.5 relative group">
            <button
              onClick={() => setShowImages(true)}
              className={`px-2.5 py-1.5 rounded-md text-xs transition-colors flex items-center gap-1
                ${showImages ? '!bg-[rgb(var(--color-1))] !text-[rgb(var(--btn-text-1))] shadow-sm' : 'text-surface-400 hover:text-surface-200'}`}
              title="显示卡池图"
            >
              <Image className="w-3.5 h-3.5" />卡池图
            </button>
            <button
              onClick={() => setShowImages(false)}
              className={`px-2.5 py-1.5 rounded-md text-xs transition-colors flex items-center gap-1
                ${!showImages ? '!bg-[rgb(var(--color-1))] !text-[rgb(var(--btn-text-1))] shadow-sm' : 'text-surface-400 hover:text-surface-200'}`}
              title="显示角色/武器详情"
            >
              <List className="w-3.5 h-3.5" />详情
            </button>
            <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 px-2 py-1 rounded bg-surface-950 text-[10px] text-surface-300 whitespace-nowrap pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity z-20 border border-surface-700 shadow-lg">
             快捷键 F 切换视图
            </div>
          </div>
          {/* Layout toggle: 默认 / 紧凑 */}
          <div className="flex items-center rounded-lg bg-surface-800 border border-surface-700 p-0.5">
            <button
              onClick={() => setCompactMode(false)}
              className={`px-2.5 py-1.5 rounded-md text-xs transition-colors flex items-center gap-1
                ${!compactMode ? '!bg-[rgb(var(--color-1))] !text-[rgb(var(--btn-text-1))] shadow-sm' : 'text-surface-400 hover:text-surface-200'}`}
              title="默认排列"
            >
              <List className="w-3.5 h-3.5" />默认
            </button>
            <button
              onClick={() => setCompactMode(true)}
              className={`px-2.5 py-1.5 rounded-md text-xs transition-colors flex items-center gap-1
                ${compactMode ? '!bg-[rgb(var(--color-1))] !text-[rgb(var(--btn-text-1))] shadow-sm' : 'text-surface-400 hover:text-surface-200'}`}
              title="紧凑排列"
            >
              <Columns className="w-3.5 h-3.5" />紧凑
            </button>
          </div>
          <button
            onClick={() => setSortAsc(!sortAsc)}
            className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs transition-colors
              ${sortAsc ? 'bg-primary-500/10 text-primary-400 border border-primary-500/20' : 'text-surface-400 hover:text-surface-200 hover:bg-surface-800'}`}
            title={sortAsc ? '版本从旧到新' : '版本从新到旧'}
          >
            <ArrowUpDown className={`w-3.5 h-3.5 ${sortAsc ? '' : 'rotate-180'}`} />
          </button>
          {selectMode && selected.size > 0 && (
            <button onClick={handleBulkDelete} className="flex items-center gap-1.5 px-3 py-2 bg-red-600 hover:bg-red-500 rounded-lg text-xs font-medium text-white transition-colors">
              <Trash2 className="w-3.5 h-3.5" />删除 ({selected.size})
            </button>
          )}
          <button
            onClick={() => { setSelectMode(!selectMode); setSelected(new Set()) }}
            className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs transition-colors
              ${selectMode ? 'bg-primary-500/10 text-primary-400 border border-primary-500/20' : 'text-surface-400 hover:text-surface-200 hover:bg-surface-800'}`}
          >
            <CheckSquare className="w-3.5 h-3.5" />
          </button>
          <SearchBar value={search} onChange={setSearch} placeholder="搜索版本/角色/武器/卡池..." />
          <button onClick={openAdd} className="flex items-center gap-1.5 px-3 py-2 bg-primary-600 hover:bg-primary-500 rounded-lg text-xs font-medium text-white transition-colors">
            <Plus className="w-3.5 h-3.5" />添加
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 mb-4 p-1 rounded-lg bg-surface-800 border border-surface-700">
        {Object.entries(BANNER_TYPES).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setBannerType(key)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors
              ${bannerType === key ? '!bg-[rgb(var(--color-1))] !text-[rgb(var(--btn-text-1))] shadow-sm' : 'text-surface-400 hover:text-surface-200'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Gallery */}
      <div key={bannerType} className={compactMode ? 'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 animate-fade-in' : 'space-y-4 animate-fade-in'}>
        {filtered.map(wish => {
          const wishBanners = getBannersForWish(wish.id)
          const today = new Date().toISOString().slice(0, 10)
          const started = !wish.start_date || wish.start_date <= today
          const notEnded = !wish.end_date || wish.end_date >= today
          const isActive = started && notEnded
          return (
            <div key={wish.id}
              className={`rounded-xl overflow-hidden
                ${isActive
                  ? 'border-2 animate-rainbow-border'
                  : 'border border-surface-800'
                } bg-surface-900/50`}
              onDoubleClick={() => { if (!selectMode) openEdit(wish) }}
            >              {/* Wish header row */}
              <div className="flex items-center gap-4 px-4 py-3">
                {selectMode && (
                  <button onClick={() => toggleSelect(wish.id)} className="p-0.5 text-surface-400 hover:text-white flex-shrink-0">
                    {selected.has(wish.id) ? <CheckSquare className="w-4 h-4 text-primary-400" /> : <Square className="w-4 h-4" />}
                  </button>
                )}
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className="text-primary-300 font-mono text-sm font-semibold">{wish.version}</span>
                  <span className="text-xs text-white bg-surface-700 px-2 py-0.5 rounded">第{wish.phase}期</span>
                </div>
                <div className="flex-1 text-xs text-surface-400">
                  {wish.start_date || '?'} 至 {wish.end_date || '?'}
                </div>
                <span className="text-xs text-surface-600">{wishBanners.length} 个卡池</span>
              </div>

              {/* Card pools */}
              <div className="px-4 pb-4">
                <div className={`flex gap-4 ${compactMode ? 'flex-wrap' : 'overflow-x-auto'}`}>
                  {wishBanners.map(banner => (
                    <BannerCard
                      key={banner.id}
                      banner={banner}
                      items={getItemsForBanner(banner.id)}
                      charMap={charMap}
                      weaponMap={weaponMap}
                      showImages={showImages}
                      compactMode={compactMode}
                      onImageClick={setLightbox}
                    />
                  ))}
                  {wishBanners.length === 0 && (
                    <p className="text-xs text-surface-600 py-4">暂无卡池数据</p>
                  )}
                </div>
              </div>

            </div>
          )
        })}
        {filtered.length === 0 && (
          <div className="py-16 text-center text-surface-500 text-sm">暂无祈愿数据</div>
        )}
      </div>

      {/* Edit Modal */}
      <EditModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSave={handleSave}
        saving={saving}
        title={editing ? `编辑祈愿 - ${editing.version} 第${editing.phase}期` : '添加祈愿'}
        wide
      >
        {/* Wish basic info */}
        <div className="grid grid-cols-3 gap-x-4 mb-4">
          <FormInput label="版本号" value={form.version || ''} onChange={v => setForm({ ...form, version: v })} placeholder="如 5.0" />
          <FormInput label="阶段" value={form.phase ?? 1} onChange={v => setForm({ ...form, phase: Number(v) })} type="number" />
          <FormInput label="开始日期" value={form.start_date || ''} onChange={v => setForm({ ...form, start_date: v })} placeholder="YYYY-MM-DD" />
          <FormInput label="结束日期" value={form.end_date || ''} onChange={v => setForm({ ...form, end_date: v })} placeholder="YYYY-MM-DD" />
        </div>

        {/* Banners */}
        <div className="border-t border-surface-700 pt-4 mt-2">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-surface-300">卡池列表</h3>
            <button onClick={() => addFormBanner()} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-surface-700 hover:bg-surface-600 text-xs text-surface-300 transition-colors">
              <Plus className="w-3 h-3" />添加卡池
            </button>
          </div>

          {formBanners.map((banner, bIdx) => (
            <div key={banner.id} className="mb-4 p-4 rounded-lg border border-surface-700 bg-surface-800/30"
              draggable
              onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(banner.id)); e.currentTarget.classList.add('opacity-50') }}
              onDragEnd={(e) => e.currentTarget.classList.remove('opacity-50')}
              onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('border-primary-500') }}
              onDragLeave={(e) => e.currentTarget.classList.remove('border-primary-500')}
              onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove('border-primary-500'); const fromId = Number(e.dataTransfer.getData('text/plain')); if (fromId !== banner.id) moveFormBanner(fromId, banner.id) }}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <GripVertical className="w-4 h-4 text-surface-500 cursor-grab" />
                  <span className="text-xs font-medium text-surface-400">卡池 #{bIdx + 1}</span>
                </div>
                <button onClick={() => removeFormBanner(banner.id)} className="p-1 text-surface-500 hover:text-red-400 transition-colors">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="mb-3">
                <FormInput
                  label="卡池名称"
                  value={banner.name_zh}
                  onChange={v => updateFormBanner(banner.id, 'name_zh', v)}
                  placeholder={bannerType === 'weapon-event' ? '神铸赋形' : bannerType === 'standard' ? '奔行世间' : ''}
                />
              </div>
              <div className="mb-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-surface-500">卡池图片</span>
                  <button
                    onClick={() => updateFormBanner(banner.id, 'banner_image', [...banner.banner_image, ''])}
                    className="flex items-center gap-1 px-2 py-1 rounded text-xs text-surface-400 hover:text-surface-200 hover:bg-surface-700 transition-colors"
                  >
                    <Plus className="w-3 h-3" />添加图片
                  </button>
                </div>
                {banner.banner_image.map((img, imgIdx) => (
                  <div key={imgIdx} className="flex items-start gap-2 mb-2">
                    <div className="flex-1">
                      <ImagePicker
                        label={banner.banner_image.length > 1 ? `图片 #${imgIdx + 1}` : '卡池图片'}
                        currentImage={img || null}
                        onSelect={v => {
                          const next = [...banner.banner_image]
                          next[imgIdx] = v
                          updateFormBanner(banner.id, 'banner_image', next)
                        }}
                        onRemove={() => {
                          const next = banner.banner_image.filter((_, i) => i !== imgIdx)
                          updateFormBanner(banner.id, 'banner_image', next.length ? next : [])
                        }}
                      />
                    </div>
                    {banner.banner_image.length > 1 && (
                      <button
                        onClick={() => {
                          const next = banner.banner_image.filter((_, i) => i !== imgIdx)
                          updateFormBanner(banner.id, 'banner_image', next.length ? next : [])
                        }}
                        className="p-1.5 text-surface-500 hover:text-red-400 flex-shrink-0 mt-7"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {/* Items */}
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-surface-500">卡池内容</span>
                <div className="flex items-center gap-1">
                  <button onClick={() => addBannerItem(banner.id, 'character', 5)} className="flex items-center gap-1 px-2 py-1 rounded text-xs text-amber-400 hover:text-amber-300 hover:bg-surface-700 transition-colors" title="添加5星角色">
                    <User className="w-3 h-3" />5★角色
                  </button>
                  <button onClick={() => addBannerItem(banner.id, 'character', 4)} className="flex items-center gap-1 px-2 py-1 rounded text-xs text-purple-400 hover:text-purple-300 hover:bg-surface-700 transition-colors" title="添加4星角色">
                    <User className="w-3 h-3" />4★角色
                  </button>
                  <button onClick={() => addBannerItem(banner.id, 'weapon', 5)} className="flex items-center gap-1 px-2 py-1 rounded text-xs text-amber-400 hover:text-amber-300 hover:bg-surface-700 transition-colors" title="添加5星武器">
                    <Sword className="w-3 h-3" />5★武器
                  </button>
                  <button onClick={() => addBannerItem(banner.id, 'weapon', 4)} className="flex items-center gap-1 px-2 py-1 rounded text-xs text-purple-400 hover:text-purple-300 hover:bg-surface-700 transition-colors" title="添加4星武器">
                    <Sword className="w-3 h-3" />4★武器
                  </button>
                </div>
              </div>

              {banner.items.map((item) => (
                <div key={item.id} className="flex items-center gap-2 mb-2 p-2 rounded bg-surface-800/50 select-none"
                  draggable
                  onDragStart={(e) => { e.dataTransfer.setData('application/banneritem', JSON.stringify({ bannerId: banner.id, itemId: item.id })); e.currentTarget.classList.add('opacity-50') }}
                  onDragEnd={(e) => e.currentTarget.classList.remove('opacity-50')}
                  onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('border-l-2', 'border-primary-500') }}
                  onDragLeave={(e) => e.currentTarget.classList.remove('border-l-2', 'border-primary-500')}
                  onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove('border-l-2', 'border-primary-500'); try { const data = JSON.parse(e.dataTransfer.getData('application/banneritem')); if (data.bannerId === banner.id && data.itemId !== item.id) moveBannerItem(banner.id, data.itemId, item.id) } catch(_) {} }}
                >
                  <GripVertical className="w-3.5 h-3.5 text-surface-500 cursor-grab flex-shrink-0" />
                  <select
                    value={item.item_type}
                    onChange={e => updateBannerItem(banner.id, item.id, 'item_type', e.target.value)}
                    onMouseDown={e => e.stopPropagation()}
                    className="px-2 py-1.5 bg-surface-700 border border-surface-600 rounded text-xs text-white flex-shrink-0"
                  >
                    <option value="character">角色</option>
                    <option value="weapon">武器</option>
                  </select>
                  <SearchableSelect
                    value={item.item_id}
                    onChange={v => updateBannerItem(banner.id, item.id, 'item_id', Number(v))}
                    items={item.item_type === 'character' ? Object.values(charMap) : Object.values(weaponMap)}
                    itemType={item.item_type}
                    readImage={readImage}
                  />
                  <select
                    value={item.rarity}
                    onChange={e => updateBannerItem(banner.id, item.id, 'rarity', Number(e.target.value))}
                    onMouseDown={e => e.stopPropagation()}
                    className="px-2 py-1.5 bg-surface-700 border border-surface-600 rounded text-xs text-white flex-shrink-0"
                  >
                    <option value={5}>★★★★★</option>
                    <option value={4}>★★★★</option>
                  </select>
                  <button onClick={() => removeBannerItem(banner.id, item.id)} className="p-1 text-surface-500 hover:text-red-400 flex-shrink-0">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}

              {banner.items.length === 0 && (
                <p className="text-xs text-surface-600 py-2">暂无内容，点击"添加"</p>
              )}
            </div>
          ))}

          {formBanners.length === 0 && (
            <p className="text-xs text-surface-600 py-4 text-center">暂无卡池，点击上方"添加卡池"</p>
          )}
        </div>
      </EditModal>

      {lightbox && (
        <Lightbox filename={lightbox.filename} label={lightbox.label} onClose={() => setLightbox(null)} />
      )}
    </div>
  )
}

// ── Searchable select with thumbnails ──
function SearchableSelect({ value, onChange, items, itemType, readImage }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef(null)

  const selected = items.find(it => it.id === value)
  const filtered = items.filter(it =>
    !query || it.name_zh.toLowerCase().includes(query.toLowerCase())
  )

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  function select(it) {
    onChange(it.id)
    setOpen(false)
    setQuery('')
  }

  const previewFile = itemType === 'character' ? selected?._displayCardArt : selected?.simple_art || selected?.image

  return (
    <div ref={containerRef} className="relative flex-1 min-w-0">
      {open ? (
        <div className="absolute left-0 right-0 top-0 z-20 rounded border border-primary-500 bg-surface-700 overflow-hidden shadow-lg">
          <input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="输入搜索..."
            className="w-full px-2 py-1.5 bg-transparent text-xs text-white placeholder-surface-500 outline-none"
          />
          <div className="max-h-48 overflow-y-auto border-t border-surface-600">
            {filtered.map(it => (
              <ThumbOption
                key={it.id}
                item={it}
                itemType={itemType}
                readImage={readImage}
                onClick={() => select(it)}
              />
            ))}
            {filtered.length === 0 && (
              <p className="px-2 py-3 text-xs text-surface-500 text-center">无匹配结果</p>
            )}
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full flex items-center gap-2 px-2 py-1.5 bg-surface-700 border border-surface-600 rounded text-xs text-white hover:border-surface-500 transition-colors min-w-0"
        >
          {selected ? (
            <>
              <ThumbPreview file={previewFile} readImage={readImage} />
              <span className="truncate">{selected.name_zh}</span>
            </>
          ) : (
            <span className="text-surface-500">请选择...</span>
          )}
        </button>
      )}
    </div>
  )
}

function ThumbOption({ item, itemType, readImage, onClick }) {
  const imageFile = itemType === 'character' ? item._displayCardArt : item.simple_art || item.image
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-surface-600 transition-colors text-left"
    >
      <ThumbPreview file={imageFile} readImage={readImage} />
      <span className="text-xs text-white truncate">{item.name_zh}</span>
    </button>
  )
}

function ThumbPreview({ file, readImage }) {
  const [src, setSrc] = useState(null)
  useEffect(() => {
    if (!file) { setSrc(null); return }
    let cancelled = false
    readImage(file).then(data => { if (!cancelled) setSrc(data) })
    return () => { cancelled = true }
  }, [file, readImage])

  if (!src) return <div className="w-6 h-6 rounded bg-surface-600 flex-shrink-0" />
  return <img src={src} alt="" draggable={false} className="w-6 h-6 rounded object-cover flex-shrink-0" />
}

// ── BannerCard component ──
function BannerCard({ banner, items, charMap, weaponMap, showImages, compactMode, onImageClick }) {
  const images = parseBannerImages(banner.banner_image)
  const [imgIdx, setImgIdx] = useState(0)
  const [imgDims, setImgDims] = useState(null)

  const currentImage = images[imgIdx] || null
  const { ref: bannerRef, src: imgSrc } = useLazyImage(showImages ? currentImage : null, '400px')

  // Measure dimensions once loaded
  useEffect(() => {
    if (!imgSrc) { setImgDims(null); return }
    const img = new window.Image()
    img.onload = () => setImgDims({ w: img.naturalWidth, h: img.naturalHeight })
    img.src = imgSrc
  }, [imgSrc])

  // If showing images, render the banner image(s) with navigation
  if (showImages && images.length > 0) {
    const maxW = compactMode ? 200 : 320
    const maxH = compactMode ? 150 : 240
    let dispW = imgDims ? imgDims.w : maxW
    let dispH = imgDims ? imgDims.h : maxH
    if (imgDims) {
      if (dispW > maxW || dispH > maxH) {
        const scale = Math.min(maxW / dispW, maxH / dispH)
        dispW = Math.round(dispW * scale)
        dispH = Math.round(dispH * scale)
      }
    }
    return (
      <div className={`flex-shrink-0 rounded-lg border border-surface-700 bg-surface-800/50 overflow-hidden ${compactMode ? '' : ''}`}>
        <div className="relative" ref={bannerRef}>
          {imgSrc ? (
            <button
              onClick={(e) => { e.stopPropagation(); onImageClick?.({ filename: currentImage, label: banner.name_zh || '卡池图' }) }}
              className="cursor-pointer hover:opacity-90 transition-opacity"
            >
              <img src={imgSrc} alt="" style={{ width: dispW, height: dispH }} className="object-contain bg-surface-900/50" />
            </button>
          ) : (
            <div className="w-64 h-48 flex items-center justify-center text-surface-600 text-xs">加载中...</div>
          )}
          {/* Prev/Next navigation */}
          {images.length > 1 && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); setImgIdx(prev => (prev - 1 + images.length) % images.length) }}
                className="absolute left-1 top-1/2 -translate-y-1/2 p-1 rounded-full bg-black/40 text-white/70 hover:bg-black/60 hover:text-white transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setImgIdx(prev => (prev + 1) % images.length) }}
                className="absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded-full bg-black/40 text-white/70 hover:bg-black/60 hover:text-white transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              <div className="absolute bottom-1 left-1/2 -translate-x-1/2 flex gap-1">
                {images.map((_, i) => (
                  <span key={i} className={`w-1.5 h-1.5 rounded-full ${i === imgIdx ? 'bg-white' : 'bg-white/40'}`} />
                ))}
              </div>
            </>
          )}
        </div>
        {banner.name_zh && (
          <div className="px-3 py-2 border-t border-surface-700">
            <p className="text-xs font-medium text-surface-300 text-center">{banner.name_zh}</p>
          </div>
        )}
      </div>
    )
  }

  // Content view: separated by type, adaptive sizing
  const charItems = items.filter(i => i.item_type === 'character')
  const weaponItems = items.filter(i => i.item_type === 'weapon')

  const hasContent = charItems.length > 0 || weaponItems.length > 0

  if (compactMode) {
    // Compact: all items together, smaller, tight layout
    return (
      <div className="flex-shrink-0 rounded-lg border border-surface-700 bg-surface-800/30 overflow-hidden">
        <div className="p-2">
          <div className="flex flex-wrap gap-2">
            {charItems.map(item => (
              <ItemThumb key={item.id} item={item} charMap={charMap} weaponMap={weaponMap} small compact />
            ))}
            {weaponItems.map(item => (
              <ItemThumb key={item.id} item={item} charMap={charMap} weaponMap={weaponMap} small compact />
            ))}
          </div>
          {!hasContent && (
            <p className="text-xs text-surface-600 py-4 text-center">暂无内容</p>
          )}
        </div>
        {banner.name_zh && (
          <div className="px-2 py-1 border-t border-surface-700/50 bg-surface-800/40">
            <p className="text-[10px] font-medium text-surface-400 text-center truncate">{banner.name_zh}</p>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex-shrink-0 rounded-lg border border-surface-700 bg-surface-800/30 overflow-hidden">
      <div className="p-4 space-y-4">
        {/* Characters row (5★ + 4★) */}
        {charItems.length > 0 && (
          <div className="flex flex-wrap gap-3">
            {charItems.map(item => (
              <ItemThumb key={item.id} item={item} charMap={charMap} weaponMap={weaponMap} />
            ))}
          </div>
        )}

        {/* Weapons row (5★ + 4★) */}
        {weaponItems.length > 0 && (
          <div className="flex flex-wrap gap-3 items-end">
            {weaponItems.map(item => (
              <ItemThumb key={item.id} item={item} charMap={charMap} weaponMap={weaponMap} small={item.rarity === 4} />
            ))}
          </div>
        )}

        {!hasContent && (
          <p className="text-xs text-surface-600 py-4 text-center">暂无内容</p>
        )}
      </div>

      {/* Banner name at bottom */}
      {banner.name_zh && (
        <div className="px-3 py-2 border-t border-surface-700/50 bg-surface-800/40">
          <p className="text-xs font-medium text-surface-300 text-center">{banner.name_zh}</p>
        </div>
      )}
    </div>
  )
}

// ── Item thumbnail ──
function ItemThumb({ item, charMap, weaponMap, small, compact }) {
  const navigate = useNavigate()
  const entity = item.item_type === 'character' ? charMap[item.item_id] : weaponMap[item.item_id]
  const imageFile = item.item_type === 'character' ? entity?._displayCardArt : entity?.simple_art || entity?.image
  const { ref, src } = useLazyImage(imageFile, '300px')

  const size = compact ? 'w-10 h-10' : (small ? 'w-12 h-12' : 'w-16 h-16')
  const textSize = compact ? 'text-[9px] max-w-[48px]' : 'text-[10px] leading-tight max-w-[60px]'

  function handleClick(e) {
    e.stopPropagation()
    const route = item.item_type === 'character' ? 'characters' : 'weapons'
    clearDetailScroll(item.item_type, item.item_id)
    navigate(`/${route}/${item.item_id}`)
  }

  return (
    <button onClick={handleClick} className="flex flex-col items-center gap-1 group cursor-pointer" title={entity?.name_zh}>
      <div ref={ref} className={`${size} rounded-lg border-2 ${item.rarity === 5 ? 'border-amber-400/60' : 'border-purple-400/60'} overflow-hidden bg-surface-700 flex-shrink-0 group-hover:border-white/60 transition-all`}>
        {src ? (
          <img src={src} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Search className="w-4 h-4 text-surface-500" />
          </div>
        )}
      </div>
      <span className={`${textSize} text-center truncate group-hover:text-[rgb(var(--btn-text-4th))] transition-colors ${item.rarity === 5 ? 'text-accent-gold' : 'text-purple-400'}`}>
        {entity?.name_zh || `ID:${item.item_id}`}
      </span>
    </button>
  )
}

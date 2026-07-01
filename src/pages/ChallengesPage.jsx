import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDb } from '../context/DbContext'
import { useNav } from '../context/NavContext'
import { clearDetailScroll } from '../hooks/useDetailState'
import { Plus, Trash2, Search, CheckSquare, Square, ArrowUpDown, GripVertical, ChevronLeft, ChevronRight, X } from 'lucide-react'
import SearchBar from '../components/SearchBar'
import EditModal, { FormInput, ImagePicker } from '../components/EditModal'
import ColorTextInput from '../components/ColorTextInput'
import ColoredText from '../components/ColoredText'
import Lightbox from '../components/Lightbox'
import { useLazyImage, bumpLazyRevision } from '../hooks/useLazyImage'
import { savePageStateSync, loadPageStateSync } from '../utils/pageStateStore'
import { SETTINGS_ELEM_ORDER, ELEM_NAME_TO_ID } from '../utils/colorMarkup'

// ── 挑战类型 ──
const CHALLENGE_TYPES = {
  spiral_abyss: '深境螺旋',
  imaginarium_theater: '幻想真境剧诗',
  perilous_trail: '幽境危战',
}

// ── 元素常量 ──
const ALL_ELEMENTS = [
  { id: 1, name: '火', color: '#ef4444' },
  { id: 2, name: '水', color: '#3b82f6' },
  { id: 3, name: '风', color: '#22d3ee' },
  { id: 4, name: '雷', color: '#a855f7' },
  { id: 5, name: '草', color: '#22c55e' },
  { id: 6, name: '冰', color: '#67e8f9' },
  { id: 7, name: '岩', color: '#eab308' },
]

// ── 解析敌人列表（JSON 或逗号分隔文本）──
function parseEnemiesData(raw) {
  if (!raw) return []
  if (typeof raw === 'string' && raw.startsWith('[')) {
    try { return JSON.parse(raw) } catch (_) { return [] }
  }
  return []
}

function parseJsonArray(raw) {
  if (!raw) return []
  if (typeof raw === 'string' && raw.startsWith('[')) {
    try { return JSON.parse(raw) } catch (_) { return [] }
  }
  return []
}

function parseEnemyConfig(raw) {
  const defaults = { round3: [], round6: [], round8: [], round10: [], card1: [], card2: [] }
  if (!raw) return defaults
  try { return { ...defaults, ...JSON.parse(raw) } } catch (_) { return defaults }
}

// ── 解析优势/劣势文本 → 渲染数组 ──
function parseAdvDisadv(text, elementsMap) {
  if (!text) return []
  // Format: {elemId} for element icons, | separator, plain text
  const parts = []
  const regex = /\{(\d+)\}/g
  let lastIdx = 0
  let match
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push({ type: 'text', content: text.slice(lastIdx, match.index) })
    }
    const elemId = parseInt(match[1])
    const elem = elementsMap[elemId]
    parts.push({ type: 'element', id: elemId, name: elem?.name_zh || '', color: elem?.color || '#888', icon: elem?.icon })
    lastIdx = match.index + match[0].length
  }
  if (lastIdx < text.length) {
    parts.push({ type: 'text', content: text.slice(lastIdx) })
  }
  return parts
}

// ── 确保 challenges 表有所需列（幂等，弥补迁移未触发的场景）──
async function ensureSchemaColumns() {
  const columns = ['upper_buff', 'lower_buff', 'moon_blessing']
  for (const col of columns) {
    try {
      const res = await window.electronAPI?.dbQuery(`ALTER TABLE challenges ADD COLUMN ${col} TEXT`)
      if (res?.error) { /* column exists, ignore */ }
    } catch (_) { /* already exists */ }
  }
  // perilous_trail_bosses
  try {
    const res = await window.electronAPI?.dbQuery('ALTER TABLE perilous_trail_bosses ADD COLUMN hidden_info TEXT')
    if (res?.error) { /* already exists */ }
  } catch (_) {}
}

export default function ChallengesPage() {
  const { query, readImage } = useDb()
  const { restorePage, savePage, consumeBackToList } = useNav()
  const restoringScroll = useRef(false)

  // ── 基础数据 ──
  const [challenges, setChallenges] = useState([])
  const [childData, setChildData] = useState({}) // challenge_id -> child rows
  const [charMap, setCharMap] = useState({})
  const [elemMap, setElemMap] = useState({})
  const [elemIcons, setElemIcons] = useState({}) // element icon filename -> base64

  // ── UI 状态 ──
  const [activeType, setActiveType] = useState('perilous_trail')
  const [search, setSearch] = useState('')
  const [sortAsc, setSortAsc] = useState(false)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState(new Set())
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({})
  const [formChildren, setFormChildren] = useState(null) // type-specific child form data
  const [saving, setSaving] = useState(false)
  const [lightbox, setLightbox] = useState(null)

  // ── 加载 ──
  useEffect(() => { loadMaps() }, [])
  // activeType/sortAsc 变化时重新加载
  // activeType/sortAsc 变化时重新加载（跳过首次，由 mount effect 控制）
  const initialLoadDone = useRef(false)

  // activeType/sortAsc 变化时重新加载（跳过首次，由 mount effect 控制）
  useEffect(() => {
    if (!initialLoadDone.current) return
    loadChallenges()
  }, [activeType, sortAsc])

  // 搜索/排序变化时通知懒加载图片重新检查视口
  useEffect(() => { bumpLazyRevision() }, [search, sortAsc])

  // ── 状态持久化 ──
  // 先恢复 activeType（触发数据加载），数据加载完成后恢复滚轮位置
  useEffect(() => {
    const isBack = consumeBackToList()
    if (isBack) {
      restorePage('challenges').then(saved => {
        const restoreType = saved?.activeType || activeType
        if (saved?.activeType) setActiveType(restoreType)
        if (saved?.scrollY != null && saved.scrollY > 0) {
          sessionStorage.setItem('_challenges_restore_y', String(saved.scrollY))
        }
        initialLoadDone.current = true
        loadChallenges(restoreType)  // 显式传入类型，不依赖闭包中的 activeType
      })
    } else {
      const main = document.querySelector('main')
      if (main) main.scrollTo(0, 0)
      initialLoadDone.current = true
      loadChallenges()
    }
  }, [])

  // 滚动时保存 + activeType 变化时保存
  useLayoutEffect(() => {
    const main = document.querySelector('main')
    if (!main) return
    let timer = null
    const save = () => {
      if (restoringScroll.current) return
      savePage('challenges', { activeType })
    }
    const onScroll = () => {
      clearTimeout(timer)
      if (restoringScroll.current) return
      timer = setTimeout(save, 150)
    }
    main.addEventListener('scroll', onScroll, { passive: true })
    return () => { main.removeEventListener('scroll', onScroll); clearTimeout(timer); save() }
  }, [activeType, savePage])
  // activeType 变化时立即保存状态到 user.json（保留已有的滚轮数据）
  useEffect(() => {
    if (!initialLoadDone.current) return
    const current = loadPageStateSync('challenges')
    const scrollY = current?.scrollY || 0
    savePageStateSync('challenges', scrollY, { activeType })
  }, [activeType])
  // 数据加载完成后恢复滚轮位置（等 activeType 加载完数据后才执行）
  useEffect(() => {
    if (challenges.length === 0) return
    const restoreY = sessionStorage.getItem('_challenges_restore_y')
    if (!restoreY) return
    const targetY = Number(restoreY)
    if (targetY <= 0) { sessionStorage.removeItem('_challenges_restore_y'); return }
    sessionStorage.removeItem('_challenges_restore_y')
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
      tryScroll(10)
    }
  }, [challenges])

  async function loadMaps() {
    const [chars, elems, settingsRes] = await Promise.all([
      query('SELECT id, name_zh, card_art, splash_art, rarity, element_id FROM characters'),
      query('SELECT id, name_zh, name_en, color, icon FROM elements'),
      query("SELECT value FROM settings WHERE key = 'element_colors'"),
    ])
    const cm = {}; for (const c of (chars.data || [])) cm[c.id] = c
    const em = {}; for (const e of (elems.data || [])) em[e.id] = e
    setCharMap(cm)

    // Merge element icons from settings (element_colors: [{color, icon}, ...])
    // Settings array follows PRESET_COLORS order (see SETTINGS_ELEM_ORDER in colorMarkup)
    const nameToId = {}
    for (const e of Object.values(em)) nameToId[e.name_zh] = e.id
    try {
      const raw = settingsRes.data?.[0]?.value
      if (raw) {
        const arr = JSON.parse(raw)
        arr.forEach((item, i) => {
          const label = SETTINGS_ELEM_ORDER[i]
          const elemId = label ? nameToId[label] : null
          if (item.icon && elemId && em[elemId]) {
            em[elemId] = { ...em[elemId], icon: item.icon }
          }
        })
      }
    } catch (_) {}
    setElemMap(em)

    // Load element icon image data (parallel)
    const icons = {}
    const iconNames = new Set()
    for (const e of Object.values(em)) {
      if (e.icon) iconNames.add(e.icon)
    }
    const iconResults = await Promise.all(
      [...iconNames].map(async (iconName) => {
        try {
          const res = await readImage(iconName)
          return { iconName, data: res || null }
        } catch (_) { return { iconName, data: null } }
      })
    )
    for (const { iconName, data } of iconResults) {
      icons[iconName] = data
    }
    setElemIcons(icons)
  }

  async function loadChallenges(type) {
    const at = type || activeType
    const res = await query(
      `SELECT * FROM challenges WHERE type = ? ORDER BY version ${sortAsc ? 'ASC' : 'DESC'}, start_date ${sortAsc ? 'ASC' : 'DESC'}`,
      [at]
    )
    const list = res.data || []

    // Load child data BEFORE setting challenges — ensures scrollHeight is complete
    // when the scroll-restore effect fires on [challenges].
    if (list.length > 0) {
      const ids = list.map(c => c.id)
      const placeholders = ids.map(() => '?').join(',')
      const childMap = {}
      for (const c of list) childMap[c.id] = null

      if (at === 'spiral_abyss') {
        const cr = await query(
          `SELECT * FROM spiral_abyss_floors WHERE challenge_id IN (${placeholders}) ORDER BY chamber_number, half`,
          ids
        )
        for (const row of (cr.data || [])) {
          if (!childMap[row.challenge_id]) childMap[row.challenge_id] = []
          childMap[row.challenge_id].push(row)
        }
      } else if (at === 'imaginarium_theater') {
        const cr = await query(
          `SELECT * FROM imaginarium_theater_seasons WHERE challenge_id IN (${placeholders}) ORDER BY id`,
          ids
        )
        for (const row of (cr.data || [])) {
          childMap[row.challenge_id] = row
        }
      } else if (at === 'perilous_trail') {
        const cr = await query(
          `SELECT * FROM perilous_trail_bosses WHERE challenge_id IN (${placeholders}) ORDER BY difficulty, boss_index`,
          ids
        )
        for (const row of (cr.data || [])) {
          if (!childMap[row.challenge_id]) childMap[row.challenge_id] = []
          childMap[row.challenge_id].push(row)
        }
      }
      setChildData(childMap)
    } else {
      setChildData({})
    }
    setChallenges(list)
  }

  // ── 增删改 ──
  function openAdd() {
    setEditing(null)
    setForm({ version: '', type: activeType, name_zh: '', start_date: '', end_date: '', upper_buff: '', lower_buff: '', moon_blessing: '' })
    initFormChildren(null, activeType)
    setModalOpen(true)
  }

  async function openEdit(challenge) {
    setEditing(challenge)
    setForm({
      version: challenge.version,
      type: challenge.type,
      name_zh: challenge.name_zh || '',
      start_date: challenge.start_date || '',
      end_date: challenge.end_date || '',
      upper_buff: challenge.upper_buff || '',
      lower_buff: challenge.lower_buff || '',
      moon_blessing: challenge.moon_blessing || '',
    })

    // Load child data into form
    const ct = challenge.type
    if (ct === 'spiral_abyss') {
      const res = await query(
        'SELECT * FROM spiral_abyss_floors WHERE challenge_id = ? ORDER BY chamber_number, half',
        [challenge.id]
      )
      initFormChildren(res.data || [], 'spiral_abyss')
    } else if (ct === 'imaginarium_theater') {
      const res = await query(
        'SELECT * FROM imaginarium_theater_seasons WHERE challenge_id = ? ORDER BY id LIMIT 1',
        [challenge.id]
      )
      initFormChildren(res.data?.[0] || null, 'imaginarium_theater')
    } else if (ct === 'perilous_trail') {
      const res = await query(
        'SELECT * FROM perilous_trail_bosses WHERE challenge_id = ? ORDER BY difficulty, boss_index',
        [challenge.id]
      )
      initFormChildren(res.data || [], 'perilous_trail')
    }
    setModalOpen(true)
  }

  function initFormChildren(existing, forType) {
    const t = forType || activeType
    if (t === 'spiral_abyss') {
      // Build 3 chambers × 2 halves structure
      const chambers = []
      for (let ci = 1; ci <= 3; ci++) {
        const upper = (existing || []).find(r => r.chamber_number === ci && r.half === 1)
        const lower = (existing || []).find(r => r.chamber_number === ci && r.half === 2)
        chambers.push({
          chamber: ci,
          upper: { id: upper?.id || -Date.now() - ci * 2, enemies: parseEnemiesData(upper?.enemies_data) },
          lower: { id: lower?.id || -Date.now() - ci * 2 - 1, enemies: parseEnemiesData(lower?.enemies_data) },
        })
      }
      setFormChildren({ chambers })
    } else if (t === 'imaginarium_theater') {
      const data = existing || {}
      setFormChildren({
        recommended_elements: parseJsonArray(data.recommended_elements),
        opening_characters: parseJsonArray(data.opening_characters),
        special_guests: parseJsonArray(data.special_guests),
        enemy_config: parseEnemyConfig(data.enemy_config),
      })
    } else if (t === 'perilous_trail') {
      const difficulties = ['treacherous', 'fearless', 'desperate']
      const bosses = {}
      for (const diff of difficulties) {
        bosses[diff] = []
        for (let bi = 1; bi <= 3; bi++) {
          const existingBoss = (existing || []).find(r => r.difficulty === diff && r.boss_index === bi)
          bosses[diff].push({
            id: existingBoss?.id || -Date.now() - bi,
            boss_name: existingBoss?.boss_name || '',
            boss_image: existingBoss?.boss_image || '',
            boss_level: existingBoss?.boss_level || '',
            boss_hp: existingBoss?.boss_hp || '',
            advantages: existingBoss?.advantages || '',
            disadvantages: existingBoss?.disadvantages || '',
            details: existingBoss?.details || '',
            hidden_info: existingBoss?.hidden_info || '',
          })
        }
      }
      setFormChildren({ bosses })
    }
  }

  function updateFormChild(...args) {
    const t = form.type || activeType
    if (t === 'spiral_abyss') {
      updateSpiralChild(...args)
    } else if (t === 'imaginarium_theater') {
      updateTheaterChild(...args)
    } else if (t === 'perilous_trail') {
      updatePerilousChild(...args)
    }
  }

  function updateSpiralChild(chamberIdx, half, enemies) {
    setFormChildren(prev => {
      const chambers = [...prev.chambers]
      chambers[chamberIdx] = { ...chambers[chamberIdx], [half]: { ...chambers[chamberIdx][half], enemies } }
      return { chambers }
    })
  }

  function updateTheaterChild(field, value) {
    setFormChildren(prev => ({ ...prev, [field]: value }))
  }

  function updateTheaterEnemyConfig(nodeKey, enemies) {
    setFormChildren(prev => ({
      ...prev,
      enemy_config: { ...prev.enemy_config, [nodeKey]: enemies },
    }))
  }

  function updatePerilousChild(difficulty, bossIdx, field, value) {
    setFormChildren(prev => {
      const bosses = { ...prev.bosses }
      const list = [...bosses[difficulty]]
      list[bossIdx] = { ...list[bossIdx], [field]: value }
      bosses[difficulty] = list
      return { bosses }
    })
  }

  async function handleSave() {
    if (saving) return
    if (!form.version || !form.version.trim()) {
      alert('请输入版本号')
      return
    }
    setSaving(true)
    try {
      // Ensure schema columns exist (idempotent; catches migration misses)
      await ensureSchemaColumns()

      let challengeId = editing ? editing.id : null

      if (editing) {
        await query(
          'UPDATE challenges SET version = ?, type = ?, name_zh = ?, start_date = ?, end_date = ?, upper_buff = ?, lower_buff = ?, moon_blessing = ? WHERE id = ?',
          [form.version, form.type, form.name_zh || null, form.start_date || null, form.end_date || null, form.upper_buff || null, form.lower_buff || null, form.moon_blessing || null, editing.id]
        )
        challengeId = editing.id
        // Delete old child data
        if (form.type === 'spiral_abyss') {
          await query('DELETE FROM spiral_abyss_floors WHERE challenge_id = ?', [challengeId])
        } else if (form.type === 'imaginarium_theater') {
          await query('DELETE FROM imaginarium_theater_seasons WHERE challenge_id = ?', [challengeId])
        } else if (form.type === 'perilous_trail') {
          await query('DELETE FROM perilous_trail_bosses WHERE challenge_id = ?', [challengeId])
        }
      } else {
        await query(
          'INSERT INTO challenges (version, type, name_zh, start_date, end_date, upper_buff, lower_buff, moon_blessing) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [form.version, form.type, form.name_zh || null, form.start_date || null, form.end_date || null, form.upper_buff || null, form.lower_buff || null, form.moon_blessing || null]
        )
        const idRes = await query('SELECT MAX(id) as id FROM challenges')
        challengeId = idRes.data?.[0]?.id
      }

      // Save child data
      if (form.type === 'spiral_abyss' && formChildren?.chambers) {
        for (const ch of formChildren.chambers) {
          for (const half of ['upper', 'lower']) {
            const h = ch[half]
            if (h.enemies.length > 0) {
              await query(
                'INSERT INTO spiral_abyss_floors (challenge_id, chamber_number, half, enemies_data) VALUES (?, ?, ?, ?)',
                [challengeId, ch.chamber, half === 'upper' ? 1 : 2, JSON.stringify(h.enemies)]
              )
            }
          }
        }
      } else if (form.type === 'imaginarium_theater' && formChildren) {
        await query(
          'INSERT INTO imaginarium_theater_seasons (challenge_id, recommended_elements, opening_characters, special_guests, enemy_config) VALUES (?, ?, ?, ?, ?)',
          [
            challengeId,
            JSON.stringify(formChildren.recommended_elements || []),
            JSON.stringify(formChildren.opening_characters || []),
            JSON.stringify(formChildren.special_guests || []),
            JSON.stringify(formChildren.enemy_config || {}),
          ]
        )
      } else if (form.type === 'perilous_trail' && formChildren?.bosses) {
        const diffs = ['treacherous', 'fearless', 'desperate']
        for (const diff of diffs) {
          const list = formChildren.bosses[diff] || []
          for (let bi = 0; bi < list.length; bi++) {
            const b = list[bi]
            if (b.boss_name || b.boss_image) {
              await query(
                `INSERT INTO perilous_trail_bosses (challenge_id, difficulty, boss_index, boss_name, boss_image, boss_level, boss_hp, advantages, disadvantages, details, hidden_info)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [challengeId, diff, bi + 1, b.boss_name || null, b.boss_image || null, b.boss_level || null, b.boss_hp || null, b.advantages || null, b.disadvantages || null, b.details || null, b.hidden_info || null]
              )
            }
          }
        }
      }

      setModalOpen(false)
      await loadChallenges()
    } catch (e) {
      console.error('Save failed:', e)
      const msg = e.message || '未知错误'
      if (msg.includes('UNIQUE constraint') && msg.includes('challenges')) {
        alert('保存失败：已存在相同版本+类型+名称的记录，请修改版本号或名称。')
      } else {
        alert('保存失败: ' + msg)
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(challenge) {
    if (!confirm(`确定删除${challenge.version}版本挑战记录？`)) return
    await query('DELETE FROM challenges WHERE id = ?', [challenge.id])
    loadChallenges()
  }

  function toggleSelect(id) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    const ids = filtered.map(c => c.id)
    if (ids.every(id => selected.has(id))) setSelected(new Set())
    else setSelected(new Set(ids))
  }

  async function handleBulkDelete() {
    if (selected.size === 0) return
    if (!confirm(`确定删除选中的 ${selected.size} 条挑战记录？`)) return
    const ids = [...selected]
    await query(`DELETE FROM challenges WHERE id IN (${ids.map(() => '?').join(',')})`, ids)
    setSelected(new Set())
    loadChallenges()
  }

  const searchLower = search.toLowerCase()
  const filtered = challenges.filter(c => {
    if (!search) return true
    if (c.version.toLowerCase().includes(searchLower)) return true
    if (c.name_zh && c.name_zh.toLowerCase().includes(searchLower)) return true
    // Search child data (boss names, advantages, details, etc.)
    const children = childData[c.id]
    if (children) {
      if (Array.isArray(children)) {
        for (const child of children) {
          // Search all string fields
          for (const val of Object.values(child)) {
            if (typeof val === 'string' && val.toLowerCase().includes(searchLower)) return true
          }
        }
      } else {
        // Single child object
        for (const val of Object.values(children)) {
          if (typeof val === 'string' && val.toLowerCase().includes(searchLower)) return true
        }
      }
    }
    return false
  })

  // ── 渲染 ──
  return (
    <div className="p-6">
      {/* 头部 */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">挑战</h1>
          <p className="text-xs text-surface-500 mt-0.5">{filtered.length} 条记录</p>
        </div>
        <div className="flex items-center gap-2">
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
          <SearchBar value={search} onChange={setSearch} placeholder="搜索版本/名称/BOSS/详情..." />
          <button onClick={openAdd} className="flex items-center gap-1.5 px-3 py-2 bg-primary-600 hover:bg-primary-500 rounded-lg text-xs font-medium text-white transition-colors">
            <Plus className="w-3.5 h-3.5" />添加
          </button>
        </div>
      </div>

      {/* Tab 栏 */}
      <div className="flex items-center gap-1 mb-4 p-1 rounded-lg bg-surface-800 border border-surface-700">
        {Object.entries(CHALLENGE_TYPES).map(([key, label]) => (
          <button
            key={key}
            onClick={() => { setActiveType(key); setSelectMode(false); setSelected(new Set()) }}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors
              ${activeType === key ? '!bg-[rgb(var(--color-1))] !text-[rgb(var(--btn-text-1))] shadow-sm' : 'text-surface-400 hover:text-surface-200'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 卡片列表 */}
      <div key={activeType} className="space-y-4 animate-fade-in">
        {filtered.map(challenge => {
          const today = new Date().toISOString().slice(0, 10)
          const started = !challenge.start_date || challenge.start_date <= today
          const notEnded = !challenge.end_date || challenge.end_date >= today
          const isActive = started && notEnded
          return (
          <ChallengeCard
            key={challenge.id + '|s' + search + sortAsc}
            challenge={challenge}
            childData={childData[challenge.id]}
            charMap={charMap}
            elemMap={elemMap}
            elemIcons={elemIcons}
            selectMode={selectMode}
            selected={selected.has(challenge.id)}
            onToggleSelect={() => toggleSelect(challenge.id)}
            onEdit={() => openEdit(challenge)}
            onDelete={() => handleDelete(challenge)}
            onLightbox={setLightbox}
            isActive={isActive}
          />
        )})}
        {filtered.length === 0 && (
          <div className="text-center py-12 text-surface-500 text-sm">暂无{CHALLENGE_TYPES[activeType]}记录，点击"添加"创建</div>
        )}
      </div>

      {/* 编辑弹窗 */}
      <EditModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSave={handleSave}
        saving={saving}
        title={editing ? `编辑挑战 - ${editing.version}` : `添加${CHALLENGE_TYPES[activeType]}`}
        wide
        wider
        closeOnBackdrop={false}
      >
        <ChallengeEditForm
          form={form}
          setForm={setForm}
          formChildren={formChildren}
          updateFormChild={updateFormChild}
          updateTheaterChild={updateTheaterChild}
          updateTheaterEnemyConfig={updateTheaterEnemyConfig}
          updatePerilousChild={updatePerilousChild}
          charMap={charMap}
          elemMap={elemMap}
          elemIcons={elemIcons}
          readImage={readImage}
          type={activeType}
        />
      </EditModal>

      {lightbox && (
        <Lightbox filename={lightbox.filename} label={lightbox.label} onClose={() => setLightbox(null)} />
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// ── 挑战卡片 ──
// ══════════════════════════════════════════════════════════════════════════════

function ChallengeCard({ challenge, childData, charMap, elemMap, elemIcons, selectMode, selected, onToggleSelect, onEdit, onDelete, onLightbox, isActive }) {
  return (
    <div
      className={`rounded-xl overflow-hidden group
        ${isActive
          ? 'border-2 animate-rainbow-border'
          : 'border border-surface-800'
        } bg-surface-900/50`}
      onDoubleClick={() => { if (!selectMode) onEdit() }}
    >
      {/* 版本头部 */}
      <div className="flex items-center gap-4 px-4 py-3 border-b border-surface-800">
        {selectMode && (
          <button onClick={onToggleSelect} className="p-0.5 text-surface-500 hover:text-white">
            {selected ? <CheckSquare className="w-4 h-4 text-primary-400" /> : <Square className="w-4 h-4" />}
          </button>
        )}
        <span className="text-primary-300 font-mono text-sm font-medium">{challenge.version}</span>
        {challenge.name_zh && <span className="text-sm font-medium text-white">{challenge.name_zh}</span>}
        <span className="text-xs text-surface-400">{challenge.start_date || '?'} 至 {challenge.end_date || '?'}</span>
        <div className="flex-1" />
        <button onClick={onEdit} className="px-2.5 py-1 rounded text-xs text-surface-400 hover:text-white hover:bg-surface-700 transition-colors">
          编辑
        </button>
        <button onClick={onDelete} className="p-1 rounded text-surface-500 hover:text-red-400 hover:bg-red-500/10 transition-colors">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 内容 */}
      <div className="px-4 py-3">
        {challenge.type === 'spiral_abyss' && <SpiralAbyssContent childData={childData} challenge={challenge} />}
        {challenge.type === 'imaginarium_theater' && (
          <ImaginariumTheaterContent childData={childData} charMap={charMap} elemMap={elemMap} elemIcons={elemIcons} onLightbox={onLightbox} />
        )}
        {challenge.type === 'perilous_trail' && (
          <PerilousTrailContent childData={childData} elemMap={elemMap} elemIcons={elemIcons} onLightbox={onLightbox} />
        )}
      </div>
    </div>
  )
}

// ── 深境螺旋内容 ──
function SpiralAbyssContent({ childData, challenge }) {
  const floors = childData || []
  const chambers = [1, 2, 3].map(ci => {
    const upper = floors.find(f => f.chamber_number === ci && f.half === 1)
    const lower = floors.find(f => f.chamber_number === ci && f.half === 2)
    return { chamber: ci, upper, lower }
  })

  return (
    <div className="space-y-3">
      {/* Buff 信息 */}
      {(challenge?.moon_blessing || challenge?.upper_buff || challenge?.lower_buff) && (
        <div className="space-y-2">
          {challenge?.moon_blessing && (
            <div className="rounded bg-surface-800/50 border border-surface-700 p-2">
              <div className="text-[10px] text-surface-500 mb-0.5">渊月祝福</div>
              <div className="text-xs text-surface-300">{challenge.moon_blessing}</div>
            </div>
          )}
          {(challenge?.upper_buff || challenge?.lower_buff) && (
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded bg-surface-800/50 border border-surface-700 p-2">
                <div className="text-[10px] text-surface-500 mb-0.5">上半 Buff</div>
                <div className="text-xs text-surface-300">{challenge.upper_buff || '-'}</div>
              </div>
              <div className="rounded bg-surface-800/50 border border-surface-700 p-2">
                <div className="text-[10px] text-surface-500 mb-0.5">下半 Buff</div>
                <div className="text-xs text-surface-300">{challenge.lower_buff || '-'}</div>
              </div>
            </div>
          )}
        </div>
      )}
      <div className="grid grid-cols-3 gap-3">
        {chambers.map(ch => (
        <div key={ch.chamber} className="rounded-lg bg-surface-800/50 border border-surface-700 p-3">
          <div className="text-xs font-medium text-surface-300 mb-2">第{ch.chamber}间</div>
          <div className="space-y-2">
            <HalfDisplay label="上半" data={ch.upper} />
            <HalfDisplay label="下半" data={ch.lower} />
          </div>
        </div>
      ))}
      </div>
    </div>
  )
}

function HalfDisplay({ label, data }) {
  const enemies = parseEnemiesData(data?.enemies_data)
  return (
    <div>
      <span className="text-[10px] text-surface-500">{label}</span>
      <div className="flex flex-wrap gap-1 mt-0.5">
        {enemies.length > 0 ? enemies.map((name, i) => (
          <span key={i} className="text-xs px-1.5 py-0.5 rounded bg-surface-700 text-surface-300">{name}</span>
        )) : (
          <span className="text-xs text-surface-600">-</span>
        )}
      </div>
    </div>
  )
}

// ── 幻想真境剧诗内容 ──
function ImaginariumTheaterContent({ childData, charMap, elemMap, elemIcons, onLightbox }) {
  if (!childData) return <span className="text-xs text-surface-600">暂无详细数据</span>

  const recElements = parseJsonArray(childData.recommended_elements)
  const openingChars = parseJsonArray(childData.opening_characters)
  const specialGuests = parseJsonArray(childData.special_guests)
  const enemyConfig = parseEnemyConfig(childData.enemy_config)

  return (
    <div className="space-y-3">
      {/* 推荐元素 */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-surface-500 flex-shrink-0">推荐元素:</span>
        <div className="flex gap-1">
          {recElements.length > 0 ? recElements.map((eid, i) => {
            const elem = elemMap[eid]
            return (
              <ElementIcon key={i} elem={elem} elemIcons={elemIcons} size="sm" />
            )
          }) : <span className="text-xs text-surface-600">-</span>}
        </div>
      </div>

      {/* 开幕角色 */}
      <div className="flex items-start gap-2">
        <span className="text-xs text-surface-500 flex-shrink-0 mt-1">开幕角色:</span>
        <div className="flex flex-wrap gap-2">
          {openingChars.length > 0 ? openingChars.map((cid, i) => {
            const char = charMap[cid]
            return char ? <CharThumb key={i} char={char} size="xs" /> : null
          }) : <span className="text-xs text-surface-600">-</span>}
        </div>
      </div>

      {/* 特邀角色 */}
      <div className="flex items-start gap-2">
        <span className="text-xs text-surface-500 flex-shrink-0 mt-1">特邀角色:</span>
        <div className="flex flex-wrap gap-2">
          {specialGuests.length > 0 ? specialGuests.map((cid, i) => {
            const char = charMap[cid]
            return char ? <CharThumb key={i} char={char} size="xs" /> : null
          }) : <span className="text-xs text-surface-600">-</span>}
        </div>
      </div>

      {/* 敌人配置 */}
      <div className="grid grid-cols-6 gap-2">
        {[
          { key: 'round3', label: '回合3' },
          { key: 'round6', label: '回合6' },
          { key: 'round8', label: '回合8' },
          { key: 'round10', label: '回合10' },
          { key: 'card1', label: '圣牌1' },
          { key: 'card2', label: '圣牌2' },
        ].map(node => (
          <div key={node.key} className="rounded bg-surface-800/50 border border-surface-700 p-2">
            <div className="text-[10px] text-surface-500 mb-1">{node.label}</div>
            <div className="flex flex-wrap gap-1">
              {(enemyConfig[node.key] || []).length > 0 ? enemyConfig[node.key].map((name, i) => (
                <span key={i} className="text-[10px] px-1 py-0.5 rounded bg-surface-700 text-surface-300">{name}</span>
              )) : (
                <span className="text-[10px] text-surface-600">-</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── 幽境危战内容 ──
function PerilousTrailContent({ childData, elemMap, elemIcons, onLightbox }) {
  const bosses = childData || []
  const DIFFICULTY_LABELS = { treacherous: '险恶', fearless: '无畏', desperate: '绝境' }
  const difficulties = ['treacherous', 'fearless', 'desperate']
  const [collapsed, setCollapsed] = useState({ treacherous: true, fearless: true, desperate: false })

  function toggle(diff) {
    setCollapsed(prev => ({ ...prev, [diff]: !prev[diff] }))
  }

  return (
    <div className="space-y-3">
      {difficulties.map(diff => {
        const diffBosses = bosses.filter(b => b.difficulty === diff)
        if (diffBosses.length === 0) return null
        const isCollapsed = collapsed[diff]
        return (
          <div key={diff}>
            {isCollapsed ? (
              <button
                onClick={() => toggle(diff)}
                className="flex items-center gap-2 text-xs font-medium text-surface-300 hover:text-white transition-colors w-full text-left group py-2.5"
              >
                <span className="transition-transform">▶</span>
                <span className="flex-shrink-0">{DIFFICULTY_LABELS[diff]}</span>
                <div className="flex gap-3 flex-1 min-w-0">
                  {diffBosses.map(boss => (
                    <PerilousBossCompact key={boss.id} boss={boss} />
                  ))}
                </div>
              </button>
            ) : (
              <>
                <button
                  onClick={() => toggle(diff)}
                  className="flex items-center gap-2 text-xs font-medium text-surface-300 mb-2 hover:text-white transition-colors w-full text-left"
                >
                  <span className="rotate-90 transition-transform">▶</span>
                  {DIFFICULTY_LABELS[diff]}
                </button>
                <div className="grid grid-cols-3 gap-3">
                  {diffBosses.map(boss => (
                    <PerilousBossCard key={boss.id} boss={boss} elemMap={elemMap} elemIcons={elemIcons} onLightbox={onLightbox} expanded={diff === 'desperate'} />
                  ))}
                </div>
              </>
            )}
          </div>
        )
      })}
      {bosses.length === 0 && <span className="text-xs text-surface-600">暂无详细数据</span>}
    </div>
  )
}

// 折叠态：紧凑一行（小头像、名称、等级、血量）
function PerilousBossCompact({ boss }) {
  const { ref, src } = useLazyImage(boss.boss_image)

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-surface-800/50 border border-surface-700 flex-1 min-w-0">
      <div ref={ref} className="w-6 h-6 rounded overflow-hidden flex-shrink-0 bg-surface-700">
        {src ? (
          <img src={src} alt="" className="w-full h-full object-cover" />
        ) : null}
      </div>
      <span className="text-xs text-white truncate"><ColoredText text={boss.boss_name || '未命名'} /></span>
      {boss.boss_level && <span className="text-[10px] text-surface-500 flex-shrink-0">Lv.{boss.boss_level}</span>}
      {boss.boss_hp && <span className="text-[10px] text-surface-500 flex-shrink-0 truncate">HP:{boss.boss_hp}</span>}
    </div>
  )
}

function PerilousBossCard({ boss, elemMap, elemIcons, onLightbox, expanded }) {
  const { ref, src } = useLazyImage(boss.boss_image, '200px')

  const advParts = parseAdvDisadv(boss.advantages, elemMap)
  const disadvParts = parseAdvDisadv(boss.disadvantages, elemMap)
  const imgClass = expanded ? 'w-full aspect-square' : 'w-full h-28'

  return (
    <div className="rounded-lg bg-surface-800/50 border border-surface-700 overflow-hidden">
      {/* 图片 — 顶部独占 */}
      <div ref={ref} className={imgClass}>
      {src ? (
        <button
          onClick={() => onLightbox?.({ filename: boss.boss_image, label: boss.boss_name })}
          className={`w-full h-full bg-[#030616] hover:ring-1 ring-primary-500/50 block`}
        >
          <img src={src} alt="" className={`w-full h-full ${expanded ? 'object-cover' : 'object-contain'} hover:scale-110 transition-transform`} />
        </button>
      ) : (
        <div className="w-full h-full bg-[#030616] flex items-center justify-center text-surface-500 text-xs">暂无图片</div>
      )}
      </div>
      {/* 信息区 */}
      <div className="p-3 space-y-2">
        <div>
          <div className="text-sm font-medium"><ColoredText text={boss.boss_name || '未命名'} /></div>
          {boss.boss_level && <div className="text-[10px] text-surface-500">Lv.{boss.boss_level}</div>}
        </div>
        {boss.boss_hp && <div className="text-xs text-surface-400">HP: {boss.boss_hp}</div>}
        {(advParts.length > 0 || disadvParts.length > 0) && (
          <div className="rounded bg-surface-700/50 p-2 text-xs space-y-1">
            {advParts.length > 0 && (
              <div className="flex items-center gap-1.5">
                <svg className="w-4 h-4 text-green-400 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d="M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z"/></svg>
                <AdvDisadvDisplay parts={advParts} elemIcons={elemIcons} />
              </div>
            )}
            {disadvParts.length > 0 && (
              <div className="flex items-center gap-1.5">
                <svg className="w-4 h-4 text-red-400 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d="M15 3H6c-.83 0-1.54.5-1.84 1.22l-3.02 7.05c-.09.23-.14.47-.14.73v2c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L9.83 23l6.59-6.59c.36-.36.58-.86.58-1.41V5c0-1.1-.9-2-2-2zm4 0v12h4V3h-4z"/></svg>
                <AdvDisadvDisplay parts={disadvParts} elemIcons={elemIcons} />
              </div>
            )}
          </div>
        )}
        {boss.details && (
          <div className="text-xs text-surface-400">
            <ColoredText text={boss.details} />
          </div>
        )}
        {expanded && boss.hidden_info && (
          <div className="rounded bg-purple-900/20 border border-purple-700/30 p-2">
            <div className="text-[10px] text-purple-400 mb-0.5">信息补充</div>
            <div className="text-xs text-surface-300">
              <ColoredText text={boss.hidden_info} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function AdvDisadvDisplay({ parts, elemIcons }) {
  return (
    <>
      {parts.map((part, i) => {
        if (part.type === 'element') {
          const iconSrc = part.icon ? elemIcons[part.icon] : null
          return iconSrc ? (
            <img key={i} src={iconSrc} alt={part.name} className="w-4 h-4 inline-block align-middle mx-px rounded-sm" title={part.name} />
          ) : (
            <span key={i} className="inline-block align-middle mx-0.5 px-1 rounded text-[10px]" style={{ backgroundColor: part.color + '20', color: part.color }}>{part.name}</span>
          )
        }
        return <span key={i}>{part.content}</span>
      })}
    </>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// ── 公共小组件 ──
// ══════════════════════════════════════════════════════════════════════════════

function ElementIcon({ elem, elemIcons, size = 'sm' }) {
  if (!elem) return <span className="text-xs text-surface-600">?</span>
  const iconSrc = elem.icon ? elemIcons[elem.icon] : null
  const sizeClass = size === 'sm' ? 'w-6 h-6' : 'w-5 h-5'
  if (iconSrc) {
    return <img src={iconSrc} alt={elem.name_zh} className={`${sizeClass} rounded-sm`} title={elem.name_zh} />
  }
  return (
    <span className={`${sizeClass} rounded-sm flex items-center justify-center text-[10px] font-medium`}
      style={{ backgroundColor: elem.color + '30', color: elem.color }}>
      {elem.name_zh}
    </span>
  )
}

function CharThumb({ char, size = 'xs' }) {
  const navigate = useNavigate()
  const imageFile = char.card_art
  const { ref, src } = useLazyImage(imageFile)
  const sizeClass = size === 'xs' ? 'w-8 h-8' : 'w-10 h-10'

  function handleClick(e) {
    e.stopPropagation()
    clearDetailScroll('character', char.id)
    navigate(`/characters/${char.id}`)
  }

  return (
    <button onClick={handleClick} className="flex flex-col items-center gap-1 group cursor-pointer" title={char.name_zh}>
      <div ref={ref} className={`${sizeClass} rounded overflow-hidden bg-surface-700 flex-shrink-0 border border-surface-600 group-hover:border-primary-500/50 transition-colors`}>
        {src ? <img src={src} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center"><Search className="w-3 h-3 text-surface-500" /></div>}
      </div>
      <span className="text-[10px] text-surface-300 group-hover:text-[rgb(var(--btn-text-4th))] transition-colors text-center max-w-[60px] truncate">{char.name_zh}</span>
    </button>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// ── 编辑表单 ──
// ══════════════════════════════════════════════════════════════════════════════

function ChallengeEditForm({ form, setForm, formChildren, updateFormChild, updateTheaterChild, updateTheaterEnemyConfig, updatePerilousChild, charMap, elemMap, elemIcons, readImage, type }) {
  return (
    <div className="space-y-6">
      {/* 通用字段 */}
      <div className="grid grid-cols-2 gap-x-6">
        <FormInput label="版本号" value={form.version} onChange={v => setForm({ ...form, version: v })} placeholder="如 5.7" />
        <FormInput
          label={type === 'spiral_abyss' ? '渊月' : '名称'}
          value={form.name_zh}
          onChange={v => setForm({ ...form, name_zh: v })}
          placeholder={type === 'spiral_abyss' ? '如 裁断之月' : type === 'imaginarium_theater' ? '如 幻想真境剧诗·第26期' : '例 啸卷之役'}
        />
        {type === 'spiral_abyss' && (
          <FormInput label="渊月祝福" value={form.moon_blessing} onChange={v => setForm({ ...form, moon_blessing: v })} placeholder="如 角色下落攻击造成的伤害提升75%" />
        )}
        <FormInput label="开始日期" value={form.start_date} onChange={v => setForm({ ...form, start_date: v })} placeholder="YYYY-MM-DD" />
        <FormInput label="结束日期" value={form.end_date} onChange={v => setForm({ ...form, end_date: v })} placeholder="YYYY-MM-DD" />
      </div>

      {/* 深境螺旋 半场 Buff */}
      {type === 'spiral_abyss' && (
        <div className="grid grid-cols-2 gap-x-6">
          <FormInput label="上半 Buff" value={form.upper_buff} onChange={v => setForm({ ...form, upper_buff: v })} placeholder="如 地脉异常·XX" />
          <FormInput label="下半 Buff" value={form.lower_buff} onChange={v => setForm({ ...form, lower_buff: v })} placeholder="如 地脉异常·XX" />
        </div>
      )}

      {/* 类型特有表单 */}
      {type === 'spiral_abyss' && formChildren && (
        <SpiralAbyssEditForm chambers={formChildren.chambers} updateFormChild={updateFormChild} />
      )}
      {type === 'imaginarium_theater' && formChildren && (
        <ImaginariumTheaterEditForm
          fc={formChildren}
          updateTheaterChild={updateTheaterChild}
          updateTheaterEnemyConfig={updateTheaterEnemyConfig}
          charMap={charMap}
          elemMap={elemMap}
          elemIcons={elemIcons}
          readImage={readImage}
        />
      )}
      {type === 'perilous_trail' && formChildren && (
        <PerilousTrailEditForm
          bosses={formChildren.bosses}
          updatePerilousChild={updatePerilousChild}
          elemMap={elemMap}
          elemIcons={elemIcons}
          readImage={readImage}
        />
      )}
    </div>
  )
}

// ── 深境螺旋编辑表单 ──
function SpiralAbyssEditForm({ chambers, updateFormChild }) {
  return (
    <div>
      <h3 className="text-sm font-medium text-surface-300 mb-3">深渊内容（三间，每间上下半场）</h3>
      <div className="grid grid-cols-3 gap-4">
        {chambers.map((ch, ci) => (
          <div key={ch.chamber} className="rounded-lg bg-surface-800/50 border border-surface-700 p-3">
            <div className="text-xs font-medium text-surface-300 mb-2">第{ch.chamber}间</div>
            <div className="space-y-3">
              <HalfEditField label="上半场" enemies={ch.upper.enemies} onChange={enemies => updateFormChild(ci, 'upper', enemies)} />
              <HalfEditField label="下半场" enemies={ch.lower.enemies} onChange={enemies => updateFormChild(ci, 'lower', enemies)} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function HalfEditField({ label, enemies, onChange }) {
  const [text, setText] = useState(enemies.join('\n'))
  useEffect(() => { setText(enemies.join('\n')) }, [enemies])

  function handleBlur() {
    const list = text.split('\n').map(s => s.trim()).filter(Boolean)
    onChange(list)
  }

  return (
    <div>
      <label className="block text-[10px] font-medium text-surface-500 mb-1">{label}</label>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        onBlur={handleBlur}
        placeholder="每行一个敌人名称"
        rows={3}
        className="w-full px-2 py-1.5 bg-surface-700 border border-surface-600 rounded text-xs text-white placeholder-surface-500
                   focus:outline-none focus:border-primary-500 resize-none"
      />
    </div>
  )
}

// ── 幻想真境剧诗编辑表单 ──
function ImaginariumTheaterEditForm({ fc, updateTheaterChild, updateTheaterEnemyConfig, charMap, elemMap, elemIcons, readImage }) {
  return (
    <div className="space-y-5">
      {/* 推荐元素 */}
      <div>
        <label className="block text-xs font-medium text-surface-400 mb-2">推荐元素（最多3个）</label>
        <div className="flex gap-2 flex-wrap">
          {ALL_ELEMENTS.map(elem => {
            const selected = (fc.recommended_elements || []).includes(elem.id)
            return (
              <button
                key={elem.id}
                type="button"
                onClick={() => {
                  const cur = [...(fc.recommended_elements || [])]
                  if (selected) {
                    updateTheaterChild('recommended_elements', cur.filter(id => id !== elem.id))
                  } else if (cur.length < 3) {
                    updateTheaterChild('recommended_elements', [...cur, elem.id])
                  }
                }}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors border
                  ${selected ? 'border-' : 'border-surface-600 hover:border-surface-500 text-surface-400'}`}
                style={selected ? { borderColor: elem.color, backgroundColor: elem.color + '20', color: elem.color } : {}}
              >
                {elem.name}
              </button>
            )
          })}
        </div>
        <div className="flex gap-1 mt-1.5">
          {(fc.recommended_elements || []).map((eid, i) => (
            <ElementIcon key={i} elem={elemMap[eid]} elemIcons={elemIcons} size="sm" />
          ))}
        </div>
      </div>

      {/* 开幕角色 */}
      <div>
        <label className="block text-xs font-medium text-surface-400 mb-2">开幕角色（最多6个）</label>
        <CharacterSelector
          selectedIds={fc.opening_characters || []}
          max={6}
          onChange={v => updateTheaterChild('opening_characters', v)}
          charMap={charMap}
          readImage={readImage}
        />
      </div>

      {/* 特邀角色 */}
      <div>
        <label className="block text-xs font-medium text-surface-400 mb-2">特邀角色（最多4个）</label>
        <CharacterSelector
          selectedIds={fc.special_guests || []}
          max={4}
          onChange={v => updateTheaterChild('special_guests', v)}
          charMap={charMap}
          readImage={readImage}
        />
      </div>

      {/* 敌人配置 */}
      <div>
        <label className="block text-xs font-medium text-surface-400 mb-2">敌人配置</label>
        <div className="grid grid-cols-3 gap-3">
          {[
            { key: 'round3', label: '回合3' },
            { key: 'round6', label: '回合6' },
            { key: 'round8', label: '回合8' },
            { key: 'round10', label: '回合10' },
            { key: 'card1', label: '圣牌1' },
            { key: 'card2', label: '圣牌2' },
          ].map(node => (
            <EnemyConfigField
              key={node.key}
              label={node.label}
              enemies={fc.enemy_config?.[node.key] || []}
              onChange={enemies => updateTheaterEnemyConfig(node.key, enemies)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function CharacterSelector({ selectedIds, max, onChange, charMap, readImage }) {
  const chars = Object.values(charMap)
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef(null)

  const filtered = chars.filter(c =>
    !search || c.name_zh.toLowerCase().includes(search.toLowerCase())
  )

  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  function toggleChar(charId) {
    if (selectedIds.includes(charId)) {
      onChange(selectedIds.filter(id => id !== charId))
    } else if (selectedIds.length < max) {
      onChange([...selectedIds, charId])
    }
  }

  return (
    <div ref={containerRef} className="relative">
      {/* 已选角色 */}
      <div className="flex flex-wrap gap-2 mb-2">
        {selectedIds.map(cid => {
          const char = charMap[cid]
          return char ? (
            <div key={cid} className="flex items-center gap-1 px-2 py-1 rounded bg-surface-700 border border-surface-600">
              <span className="text-xs text-white">{char.name_zh}</span>
              <button onClick={() => toggleChar(cid)} className="text-surface-500 hover:text-red-400"><X className="w-3 h-3" /></button>
            </div>
          ) : null
        })}
      </div>

      {/* 搜索/选择 */}
      {open ? (
        <div className="rounded border border-primary-500 bg-surface-700 overflow-hidden">
          <input
            autoFocus
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜索角色..."
            className="w-full px-3 py-2 bg-transparent text-xs text-white placeholder-surface-500 outline-none"
          />
          <div className="max-h-48 overflow-y-auto border-t border-surface-600">
            {filtered.map(char => {
              const isSelected = selectedIds.includes(char.id)
              return (
                <button
                  key={char.id}
                  type="button"
                  onClick={() => toggleChar(char.id)}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-surface-600 transition-colors ${isSelected ? 'bg-primary-500/10' : ''}`}
                >
                  <span className={`text-xs ${isSelected ? 'text-primary-300' : 'text-surface-300'}`}>{char.name_zh}</span>
                  {isSelected && <span className="text-[10px] text-primary-400 ml-auto">已选</span>}
                </button>
              )
            })}
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={selectedIds.length >= max}
          className={`px-3 py-2 rounded-lg text-xs transition-colors
            ${selectedIds.length >= max ? 'bg-surface-800 text-surface-500 cursor-not-allowed' : 'bg-surface-700 border border-surface-600 text-surface-400 hover:text-white hover:border-surface-500'}`}
        >
          {selectedIds.length >= max ? `已满 (${max}/${max})` : `选择角色 (${selectedIds.length}/${max})`}
        </button>
      )}
    </div>
  )
}

function EnemyConfigField({ label, enemies, onChange }) {
  const [text, setText] = useState(enemies.join('\n'))
  useEffect(() => { setText(enemies.join('\n')) }, [enemies])

  function handleBlur() {
    const list = text.split('\n').map(s => s.trim()).filter(Boolean)
    onChange(list)
  }

  return (
    <div>
      <label className="block text-[10px] font-medium text-surface-500 mb-1">{label}</label>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        onBlur={handleBlur}
        placeholder="每行一个敌人"
        rows={2}
        className="w-full px-2 py-1.5 bg-surface-700 border border-surface-600 rounded text-xs text-white placeholder-surface-500
                   focus:outline-none focus:border-primary-500 resize-none"
      />
    </div>
  )
}

// ── 幽境危战编辑表单 ──
function PerilousTrailEditForm({ bosses, updatePerilousChild, elemMap, elemIcons, readImage }) {
  const DIFFICULTY_LABELS = { treacherous: '险恶', fearless: '无畏', desperate: '绝境' }
  const difficulties = ['treacherous', 'fearless', 'desperate']

  return (
    <div>
      <h3 className="text-sm font-medium text-surface-300 mb-3">BOSS 配置</h3>
      <div className="space-y-4">
        {difficulties.map(diff => (
          <div key={diff}>
            <div className="text-xs font-medium text-surface-400 mb-2">{DIFFICULTY_LABELS[diff]}</div>
            <div className="grid grid-cols-3 gap-4">
              {(bosses[diff] || []).map((boss, bi) => (
                <PerilousBossEditForm
                  key={bi}
                  boss={boss}
                  bossIdx={bi}
                  difficulty={diff}
                  updatePerilousChild={updatePerilousChild}
                  elemMap={elemMap}
                  elemIcons={elemIcons}
                  readImage={readImage}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function PerilousBossEditForm({ boss, bossIdx, difficulty, updatePerilousChild, elemMap, elemIcons, readImage }) {
  function update(field, value) {
    updatePerilousChild(difficulty, bossIdx, field, value)
  }

  return (
    <div className="rounded-lg bg-surface-800/50 border border-surface-700 p-3 space-y-3">
      <div className="text-[10px] text-surface-500 font-medium">BOSS {bossIdx + 1}</div>

      {/* 图片 */}
      <ImagePicker
        label="BOSS 图片"
        currentImage={boss.boss_image || null}
        onSelect={filename => update('boss_image', filename)}
        onRemove={() => update('boss_image', '')}
      />

      {/* 名称 */}
      <div className="mb-4">
        <label className="block text-xs font-medium text-surface-400 mb-1.5">名称</label>
        <ColorTextInput
          value={boss.boss_name || ''}
          onChange={v => update('boss_name', v)}
          placeholder="BOSS 名称"
          rows={2}
        />
      </div>

      {/* 等级 + 血量 */}
      <div className="grid grid-cols-2 gap-3">
        <FormInput label="等级" type="number" value={boss.boss_level} onChange={v => update('boss_level', v)} />
        <FormInput label="血量" value={boss.boss_hp} onChange={v => update('boss_hp', v)} placeholder="如 1,200,000" />
      </div>

      {/* 优势/劣势 */}
      <div className="mb-4">
        <label className="block text-xs font-medium text-surface-400 mb-1.5">优势 ｜ 劣势（使用 | 分隔，可插入元素图标）</label>
        <AdvDisadvEditor
          advantages={boss.advantages || ''}
          disadvantages={boss.disadvantages || ''}
          onChangeAdv={v => update('advantages', v)}
          onChangeDisadv={v => update('disadvantages', v)}
          elemMap={elemMap}
          elemIcons={elemIcons}
        />
      </div>

      {/* 详情 */}
      <div className="mb-4">
        <label className="block text-xs font-medium text-surface-400 mb-1.5">详情（关卡机制、敌人介绍）</label>
        <ColorTextInput
          value={boss.details || ''}
          onChange={v => update('details', v)}
          placeholder="关卡机制、敌人介绍..."
          rows={6}
        />
      </div>

      {/* 信息补充（仅绝境） */}
      {difficulty === 'desperate' && (
        <div className="mb-4">
          <label className="block text-xs font-medium text-surface-400 mb-1.5">信息补充</label>
          <ColorTextInput
            value={boss.hidden_info || ''}
            onChange={v => update('hidden_info', v)}
            placeholder="隐藏机制、特殊说明..."
            rows={4}
          />
        </div>
      )}
    </div>
  )
}

// ── 优势/劣势编辑器 ──
function AdvDisadvEditor({ advantages, disadvantages, onChangeAdv, onChangeDisadv, elemMap, elemIcons }) {
  const [activeSide, setActiveSide] = useState('adv') // 'adv' | 'disadv'
  const advRef = useRef(null)
  const disadvRef = useRef(null)

  function insertElement(elemId) {
    const ref = activeSide === 'adv' ? advRef : disadvRef
    const onChange = activeSide === 'adv' ? onChangeAdv : onChangeDisadv
    const current = activeSide === 'adv' ? advantages : disadvantages
    const el = ref.current
    if (!el) {
      onChange(current + `{${elemId}}`)
      return
    }
    const start = el.selectionStart
    const end = el.selectionEnd
    const newVal = current.slice(0, start) + `{${elemId}}` + current.slice(end)
    onChange(newVal)
    setTimeout(() => {
      el.focus()
      const newPos = start + `{${elemId}}`.length
      el.setSelectionRange(newPos, newPos)
    }, 0)
  }

  return (
    <div className="space-y-2">
      {/* 元素按钮 */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] text-surface-500 mr-1">插入元素:</span>
        {ALL_ELEMENTS.map(elem => (
          <button
            key={elem.id}
            type="button"
            onClick={() => insertElement(elem.id)}
            className="w-6 h-6 rounded flex items-center justify-center text-[10px] font-medium hover:scale-110 transition-transform"
            style={{ backgroundColor: elem.color + '30', color: elem.color, border: '1px solid ' + elem.color + '40' }}
            title={elem.name}
          >
            {elemIcons[elemMap[elem.id]?.icon] ? (
              <img src={elemIcons[elemMap[elem.id]?.icon]} alt={elem.name} className="w-4 h-4" />
            ) : elem.name}
          </button>
        ))}
      </div>

      {/* 编辑区 */}
      <div className="flex flex-col gap-3">
        <div className="flex-1" onClick={() => setActiveSide('adv')}>
          <label className="block text-[10px] text-surface-500 mb-1">
            <span className={activeSide === 'adv' ? 'text-green-400' : ''}>优势</span>
          </label>
          <textarea
            ref={advRef}
            value={advantages}
            onChange={e => onChangeAdv(e.target.value)}
            onFocus={() => setActiveSide('adv')}
            placeholder="优势（可插入元素图标）"
            rows={2}
            className={`w-full px-2 py-1.5 bg-surface-700 border rounded text-xs text-white placeholder-surface-500
                       focus:outline-none resize-none ${activeSide === 'adv' ? 'border-green-500/50' : 'border-surface-600'}`}
          />
          <div className="mt-1 text-xs text-surface-400">
            <AdvDisadvPreview text={advantages} elemMap={elemMap} elemIcons={elemIcons} />
          </div>
        </div>
        <div className="flex-1" onClick={() => setActiveSide('disadv')}>
          <label className="block text-[10px] text-surface-500 mb-1">
            <span className={activeSide === 'disadv' ? 'text-red-400' : ''}>劣势</span>
          </label>
          <textarea
            ref={disadvRef}
            value={disadvantages}
            onChange={e => onChangeDisadv(e.target.value)}
            onFocus={() => setActiveSide('disadv')}
            placeholder="劣势（可插入元素图标）"
            rows={2}
            className={`w-full px-2 py-1.5 bg-surface-700 border rounded text-xs text-white placeholder-surface-500
                       focus:outline-none resize-none ${activeSide === 'disadv' ? 'border-red-500/50' : 'border-surface-600'}`}
          />
          <div className="mt-1 text-xs text-surface-400">
            <AdvDisadvPreview text={disadvantages} elemMap={elemMap} elemIcons={elemIcons} />
          </div>
        </div>
      </div>
    </div>
  )
}

function AdvDisadvPreview({ text, elemMap, elemIcons }) {
  if (!text) return <span className="text-surface-600">-</span>
  const parts = parseAdvDisadv(text, elemMap)
  return (
    <span>
      {parts.map((part, i) => {
        if (part.type === 'element') {
          const iconSrc = part.icon ? elemIcons[part.icon] : null
          return iconSrc ? (
            <img key={i} src={iconSrc} alt={part.name} className="w-4 h-4 inline-block align-middle mx-0.5 rounded-sm" />
          ) : (
            <span key={i} className="inline-block align-middle mx-0.5 px-1 rounded text-[10px]" style={{ backgroundColor: part.color + '20', color: part.color }}>{part.name}</span>
          )
        }
        return <span key={i}>{part.content}</span>
      })}
    </span>
  )
}

import { useState, useEffect, useCallback, useRef } from 'react'
import { useDb } from '../context/DbContext'
import { Search, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react'

// ═══════════════════════════════════════
// 等级区间 / 材料数据
// ═══════════════════════════════════════

const MORA = 202
const WANDERER = 104001
const ADVENTURER = 104002
const HERO = 104003

// 角色等级 各区间材料（不含角色专属材料）
const LEVEL_COSTS = [
  { from: 1, to: 20, mora: 24035, wanderer: 1, hero: 6, gems: null, boss: null, commons: null, specialty: null },
  { from: 20, to: 30, mora: 62585, wanderer: 3, adventurer: 2, hero: 10, gems: [1, 0, 0, 0], boss: null, commons: [3, 0, 0], specialty: 3 },
  { from: 30, to: 40, mora: 73080, wanderer: 1, adventurer: 1, hero: 18, gems: null, boss: null, commons: null, specialty: null },
  { from: 40, to: 50, mora: 155820, wanderer: 5, adventurer: 3, hero: 28, gems: [0, 3, 0, 0], boss: 2, commons: [15, 0, 0], specialty: 10 },
  { from: 50, to: 60, mora: 251000, wanderer: 5, adventurer: 2, hero: 42, gems: [0, 6, 0, 0], boss: 4, commons: [0, 12, 0], specialty: 20 },
  { from: 60, to: 70, mora: 319185, wanderer: 1, adventurer: 3, hero: 59, gems: [0, 0, 3, 0], boss: 8, commons: [0, 18, 0], specialty: 30 },
  { from: 70, to: 80, mora: 422375, wanderer: 2, adventurer: 2, hero: 80, gems: [0, 0, 6, 0], boss: 12, commons: [0, 0, 12], specialty: 45 },
  { from: 80, to: 90, mora: 804625, wanderer: 4, hero: 171, gems: [0, 0, 0, 6], boss: 20, commons: [0, 0, 24], specialty: 60 },
]

// 技能等级 各区间材料（不含角色专属材料）
const TALENT_COSTS = [
  { from: 1, to: 2, mora: 12500, books: [3, 0, 0], commons: [6, 0, 0] },
  { from: 2, to: 3, mora: 17500, books: [0, 2, 0], commons: [0, 3, 0] },
  { from: 3, to: 4, mora: 25000, books: [0, 4, 0], commons: [0, 4, 0] },
  { from: 4, to: 5, mora: 30000, books: [0, 6, 0], commons: [0, 6, 0] },
  { from: 5, to: 6, mora: 37500, books: [0, 9, 0], commons: [0, 9, 0] },
  { from: 6, to: 7, mora: 120000, books: [0, 0, 4], commons: [0, 0, 4], weekly: 1 },
  { from: 7, to: 8, mora: 260000, books: [0, 0, 6], commons: [0, 0, 6], weekly: 1 },
  { from: 8, to: 9, mora: 450000, books: [0, 0, 12], commons: [0, 0, 9], weekly: 2 },
  { from: 9, to: 10, mora: 700000, books: [0, 0, 16], commons: [0, 0, 12], weekly: 2, crown: 1 },
]

// 旅行者专属：角色等级材料（无 Boss 掉落）
const TRAVELER_LEVEL_COSTS = [
  { from: 1, to: 20, mora: 24035, wanderer: 1, hero: 6, gems: null, commons: null, specialty: null },
  { from: 20, to: 30, mora: 62585, wanderer: 3, adventurer: 2, hero: 10, gems: [1, 0, 0, 0], commons: [3, 0, 0], specialty: 3 },
  { from: 30, to: 40, mora: 73080, wanderer: 1, adventurer: 1, hero: 18, gems: null, commons: null, specialty: null },
  { from: 40, to: 50, mora: 155820, wanderer: 5, adventurer: 3, hero: 28, gems: [0, 3, 0, 0], commons: [15, 0, 0], specialty: 10 },
  { from: 50, to: 60, mora: 230825, wanderer: 5, adventurer: 2, hero: 42, gems: [0, 6, 0, 0], commons: [0, 12, 0], specialty: 20 },
  { from: 60, to: 70, mora: 319185, wanderer: 1, adventurer: 3, hero: 59, gems: [0, 0, 3, 0], commons: [0, 18, 0], specialty: 30 },
  { from: 70, to: 80, mora: 422375, wanderer: 2, adventurer: 2, hero: 80, gems: [0, 0, 6, 0], commons: [0, 0, 12], specialty: 45 },
  { from: 80, to: 90, mora: 804625, wanderer: 4, hero: 171, gems: [0, 0, 0, 6], commons: [0, 0, 24], specialty: 60 },
]

// 旅行者专属：技能等级材料（a/b/c 三种天赋书轮换，[a2,a3,a4] 表示下标 0=2★,1=3★,2=4★）
// bookSlot: [typeIndex(0=a,1=b,2=c), rarityIndex(0=2★,1=3★,2=4★), qty]
const TRAVELER_TALENT_COSTS = [
  { from: 1, to: 2, mora: 12500, book: [0, 2, 3], commons: [6, 0, 0] },
  { from: 2, to: 3, mora: 17500, book: [1, 3, 2], commons: [0, 3, 0] },
  { from: 3, to: 4, mora: 25000, book: [2, 3, 4], commons: [0, 4, 0] },
  { from: 4, to: 5, mora: 30000, book: [0, 3, 6], commons: [0, 6, 0] },
  { from: 5, to: 6, mora: 37500, book: [1, 3, 9], commons: [0, 9, 0] },
  { from: 6, to: 7, mora: 120000, book: [2, 4, 4], commons: [0, 0, 4], weekly: 1 },
  { from: 7, to: 8, mora: 260000, book: [0, 4, 6], commons: [0, 0, 6], weekly: 1 },
  { from: 8, to: 9, mora: 450000, book: [1, 4, 12], commons: [0, 0, 9], weekly: 2 },
  { from: 9, to: 10, mora: 700000, book: [2, 4, 16], commons: [0, 0, 12], weekly: 2, crown: 1 },
]

const LEVEL_NODES = [1, 20, 30, 40, 50, 60, 70, 80, 90]
const TALENT_NODES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

// 旅行者硬编码材料（DB 中暂无数据，按元素ID映射）
// 格式: { specialty, boss, gems:[2★,3★,4★,5★], commons:[1★,2★,3★],
//         talentBooks:[[2★,3★,4★], ...], weekly, talentCommons:[1★,2★,3★] }
// 格式: shared: { gems, specialty, commons } — 所有元素共用
//        talents: { talentBooks, weekly, talentCommons } — 每个元素不同
const TRAVELER_SHARED = {
  specialty: 100024, boss: null, // 无BOSS掉落
  gems: [104101,104102,104103,104104], // 璀璨原钻
  commons: [112005,112006,112007], // 面具
}
// 数据来源：seed.sql 中 character_talent_materials 按 element_id 分组汇总
const TRAVELER_ELEMENTS = [
  { id: 3, name: '风', talentBooks: [[104301,104302,104303],[104304,104305,104306],[104307,104308,104309]], weekly: 113005, talentCommons: [112008,112009,112010] },
  // 岩元素旅行者：普通攻击使用风元素材料（在代码中通过 normalXxx 字段处理）
  { id: 7, name: '岩', talentBooks: [[104310,104311,104312],[104313,104314,104315],[104316,104317,104318]], weekly: 113006, talentCommons: [112011,112012,112013],
    normalTalentBooks: [[104301,104302,104303],[104304,104305,104306],[104307,104308,104309]], normalWeekly: 113005, normalCommons: [112008,112009,112010] },
  { id: 4, name: '雷', talentBooks: [[104320,104321,104322],[104323,104324,104325],[104326,104327,104328]], weekly: 113017, talentCommons: [112044,112045,112046] },
  { id: 5, name: '草', talentBooks: [[104329,104330,104331],[104332,104333,104334],[104335,104336,104337]], weekly: 113032, talentCommons: [112059,112060,112061] },
  { id: 2, name: '水', talentBooks: [[104338,104339,104340],[104341,104342,104343],[104344,104345,104346]], weekly: 113046, talentCommons: [112080,112081,112082] },
  { id: 1, name: '火', talentBooks: [[104347,104348,104349],[104350,104351,104352],[104353,104354,104355]], weekly: 113063, talentCommons: [112104,112105,112106] },
  { id: 6, name: '冰', talentBooks: [[104365,104366,104367],[104368,104369,104370],[104371,104372,104373]], weekly: 113075, talentCommons: [112146,112147,112148] },
]
const TRAVELER_MATS_BY_ELEM = {}
for (const e of TRAVELER_ELEMENTS) TRAVELER_MATS_BY_ELEM[e.id] = e

// ═══════════════════════════════════════
// 双端范围滑块
// ═══════════════════════════════════════
function DualRangeSlider({ nodes, values, onChange }) {
  const [min, max] = values
  const nodeCount = nodes.length
  const trackRef = useRef(null)
  const dragging = useRef(null) // 'min' | 'max' | null

  function getValueFromClientX(clientX) {
    if (!trackRef.current) return 0
    const rect = trackRef.current.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    return Math.round(ratio * (nodeCount - 1))
  }

  const handleKnobStart = useCallback((which, e) => {
    e.preventDefault()
    e.stopPropagation()
    dragging.current = which
    const handleMove = (ev) => {
      const v = getValueFromClientX(ev.clientX)
      if (which === 'min') { if (v <= max) onChange([v, max]) }
      else { if (v >= min) onChange([min, v]) }
    }
    const handleUp = () => { dragging.current = null; window.removeEventListener('mousemove', handleMove); window.removeEventListener('mouseup', handleUp) }
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
  }, [min, max, onChange])

  const minPct = (min / (nodeCount - 1)) * 100
  const maxPct = (max / (nodeCount - 1)) * 100

  return (
    <div className="relative pt-2 pb-3">
      <div className="flex justify-between text-[10px] text-surface-500 mb-1 px-1">
        {nodes.map((n, i) => (
          <span key={i} className={i === min || i === max ? 'text-white font-medium' : ''}>{n}</span>
        ))}
      </div>
      <div ref={trackRef} className="relative h-2 bg-surface-700 rounded-full cursor-pointer"
        onMouseDown={(e) => {
          if (e.button !== 0) return
          const v = getValueFromClientX(e.clientX)
          // 点击在左端点左侧 → 移动左端点；在右端点右侧 → 移动右端点；中间 → 移动左端点
          if (v < min) onChange([v, max])
          else if (v > max) onChange([min, v])
          else onChange([v, max])
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          const v = getValueFromClientX(e.clientX)
          // 点击在左端点左侧 → 移动左端点；在右端点右侧 → 移动右端点；中间 → 移动右端点
          if (v < min) onChange([v, max])
          else if (v > max) onChange([min, v])
          else onChange([min, v])
        }}>
        {/* 选中范围 */}
        <div className="absolute h-full rounded-full bg-primary-500/50"
          style={{ left: `${minPct}%`, width: `${maxPct - minPct}%` }} />
        {/* 左端点滑块 */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-lg bg-primary-400 border-2 border-white/30 shadow-md cursor-grab active:cursor-grabbing hover:scale-110 transition-transform"
          style={{ left: `calc(${minPct}% - 8px)`, zIndex: 10 }}
          onMouseDown={(e) => handleKnobStart('min', e)}
        />
        {/* 右端点滑块 */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-lg bg-primary-400 border-2 border-white/30 shadow-md cursor-grab active:cursor-grabbing hover:scale-110 transition-transform"
          style={{ left: `calc(${maxPct}% - 8px)`, zIndex: 10 }}
          onMouseDown={(e) => handleKnobStart('max', e)}
        />
      </div>
    </div>
  )
}

// ═══════════════════════════════════════
// 养成计算器主组件
// ═══════════════════════════════════════
export default function TrainCalc({ initialData }) {
  const { query, readImage } = useDb()
  const [characters, setCharacters] = useState([])
  const [search, setSearch] = useState('')
  const [selectedChar, setSelectedChar] = useState(null)
  const [mats, setMats] = useState(null)
  const [materialImages, setMaterialImages] = useState({})
  const [travelerElement, setTravelerElement] = useState(null)
  const [travelerElements, setTravelerElements] = useState([])

  // 四个进度条 [min, max] 索引
  const [levelRange, setLevelRange] = useState([0, LEVEL_NODES.length - 1])
  const [normalRange, setNormalRange] = useState([0, TALENT_NODES.length - 1])
  const [skillRange, setSkillRange] = useState([0, TALENT_NODES.length - 1])
  const [burstRange, setBurstRange] = useState([0, TALENT_NODES.length - 1])

  const [showList, setShowList] = useState(true)

  // 加载角色列表
  useEffect(() => {
    query(`SELECT id, name_zh, element_id, card_art AS image, rarity, character_type FROM characters ORDER BY id`)
      .then(r => {
        if (r?.data) {
          setCharacters(r.data)
          // 如果传入了初始角色ID，自动选中
          if (initialData?.characterId) {
            const found = r.data.find(c => c.id === initialData.characterId)
            if (found) setSelectedChar(found)
          }
        }
      })
      .catch(() => {})
  }, [query])

  // 选择角色后加载材料
  useEffect(() => {
    if (!selectedChar) { setMats(null); setTravelerElement(null); setTravelerElements([]); return }
    const isTraveler = selectedChar.character_type === 'traveler'
    // 奇偶角色（无培养材料）
    if (selectedChar.id === 10000117 || selectedChar.id === 10000118) {
      setMats({ isEmpty: true }); return
    }
    if (isTraveler) {
      // 旅行者从硬编码表获取元素列表
      const elems = TRAVELER_ELEMENTS.map(e => ({ element_id: e.id, name_zh: e.name }))
      setTravelerElements(elems)
      if (elems.length > 0) setTravelerElement(elems[0].element_id)
      return
    }
    loadCharacterMats(selectedChar.id, null)
  }, [selectedChar])

  // 旅行者元素切换时重新加载
  useEffect(() => {
    if (!selectedChar || selectedChar.character_type !== 'traveler' || !travelerElement) return
    loadCharacterMats(selectedChar.id, travelerElement)
  }, [travelerElement, selectedChar])

  async function loadCharacterMats(charId, elemId) {
    try {
      const elemFilter = elemId ? ` AND cam.element_id = ${elemId}` : ''
      const talElemFilter = elemId ? ` AND ctm.element_id = ${elemId}` : ''
      const [ascRes, talRes, fixedRes] = await Promise.all([
        query(`SELECT cam.*, m.name_zh, m.type, m.rarity, m.image
               FROM character_ascension_materials cam JOIN materials m ON cam.material_id = m.id
               WHERE cam.character_id = ?${elemFilter}`, [charId]),
        query(`SELECT ctm.*, m.name_zh, m.type, m.rarity, m.image
               FROM character_talent_materials ctm JOIN materials m ON ctm.material_id = m.id
               WHERE ctm.character_id = ?${talElemFilter}`, [charId]),
        query(`SELECT id AS material_id, name_zh, rarity, image FROM materials WHERE id IN (202,104001,104002,104003,104319)`),
      ])
      let ascMats = ascRes?.data || []
      let talMats = talRes?.data || []
      const isTraveler = selectedChar?.character_type === 'traveler'

      // 旅行者DB无数据 → 硬编码表
      if (isTraveler && ascMats.length === 0 && elemId && TRAVELER_MATS_BY_ELEM[elemId]) {
        const te = TRAVELER_MATS_BY_ELEM[elemId]
        const tm = { ...TRAVELER_SHARED, ...te }
        // 如果存在普通攻击例外材料，一并加载
        const normalIds = te.normalTalentBooks ? [...te.normalTalentBooks.flat(), ...(te.normalCommons || []), te.normalWeekly].filter(Boolean) : []
        const allIds = [...new Set([tm.specialty, tm.boss, ...tm.gems, ...tm.commons, tm.weekly, ...tm.talentCommons, ...tm.talentBooks.flat(), ...normalIds].filter(Boolean))]
        const matRes = await query(`SELECT id AS material_id, name_zh, type, rarity, image FROM materials WHERE id IN (${allIds.join(',')})`)
        const matMap = {}; for (const m of (matRes?.data || [])) matMap[m.material_id] = m
        ascMats = []
        if (matMap[tm.specialty]) ascMats.push({ ...matMap[tm.specialty] })
        if (matMap[tm.boss]) ascMats.push({ ...matMap[tm.boss] })
        tm.gems.forEach((id, i) => { if (matMap[id]) ascMats.push({ ...matMap[id], rarity: 2 + i }) })
        tm.commons.forEach((id, i) => { if (matMap[id]) ascMats.push({ ...matMap[id], rarity: 1 + i }) })
        talMats = []
        if (matMap[tm.weekly]) talMats.push({ ...matMap[tm.weekly] })
        tm.talentCommons.forEach((id, i) => { if (matMap[id]) talMats.push({ ...matMap[id], rarity: 1 + i }) })
        tm.talentBooks.forEach(ids => ids.forEach((id, ri) => { if (matMap[id]) talMats.push({ ...matMap[id], rarity: 2 + ri }) }))
        // 如果存在普通攻击例外材料，也加入 talMats 用于显示和后续映射
        if (te.normalTalentBooks) {
          te.normalTalentBooks.forEach(ids => ids.forEach((id, ri) => { if (matMap[id]) talMats.push({ ...matMap[id], rarity: 2 + ri }) }))
          if (matMap[te.normalWeekly]) talMats.push({ ...matMap[te.normalWeekly] })
          te.normalCommons?.forEach((id, i) => { if (matMap[id]) talMats.push({ ...matMap[id], rarity: 1 + i }) })
        }
      }

      // 分类材料
      const result = {
        specialty: ascMats.find(m => m.type === 'local_specialty'),
        boss: ascMats.find(m => m.type === 'Boss掉落' || m.type === 'boss_drop'),
        gems: ascMats.filter(m => m.type === 'character_ascension').sort((a, b) => a.rarity - b.rarity),
        commons: ascMats.filter(m => m.type === '通用掉落').sort((a, b) => a.rarity - b.rarity),
        talentBooks: [], weeklyBoss: null, talentCommons: [],
      }
      // 天赋材料分类（排除智识之冕 104319，防止其混入天赋书数组导致 index 偏移）
      // 注意：材料表中 type 字段存在中英文混用的情况（'天赋书'/'talent'、'周本掉落'/'weekly_boss_drop'）
      // 同时火旅行者的周本材料星与火的基石（113063）type='event'，统一视为周本掉落
      const isTalentBook = (type) => type === '天赋书' || type === 'talent'
      const isWeeklyBoss = (type) => type === '周本掉落' || type === 'weekly_boss_drop' || type === 'event'
      // 对于有 normalXxx 例外的旅行者，normal 材料不加入主数组，由单独映射处理
      const te_normal_classifier = selectedChar?.character_type === 'traveler' && elemId ? TRAVELER_MATS_BY_ELEM[elemId] : null
      const normalMatIds = te_normal_classifier?.normalTalentBooks ? new Set([...te_normal_classifier.normalTalentBooks.flat(), ...(te_normal_classifier.normalCommons || []), te_normal_classifier.normalWeekly].filter(Boolean)) : null
      for (const m of talMats) {
        if (m.material_id === 104319) continue // 智识之冕单独处理
        // 跳过普通攻击例外材料，它们由单独的映射处理
        if (normalMatIds && normalMatIds.has(m.material_id)) continue
        if (isTalentBook(m.type)) result.talentBooks.push(m)
        else if (isWeeklyBoss(m.type)) result.weeklyBoss = m
        else result.talentCommons.push(m)
      }
      result.talentBooks.sort((a, b) => a.material_id - b.material_id)
      result.talentCommons.sort((a, b) => a.rarity - b.rarity)
      // 旅行者：直接从配置构建天赋书映射（支持普通攻击使用不同元素材料的例外）
      if (selectedChar?.character_type === 'traveler' && elemId && TRAVELER_MATS_BY_ELEM[elemId]) {
        const te = TRAVELER_MATS_BY_ELEM[elemId]
        const bookMap = {}
        te.talentBooks.forEach((ids, typeIdx) => {
          bookMap[typeIdx] = {}
          ids.forEach((id, ri) => {
            const rarity = 2 + ri
            const found = ascMats.find(m => m.material_id === id) || talMats.find(m => m.material_id === id)
            if (found) bookMap[typeIdx][rarity] = found
          })
        })
        result.travelerBookMap = bookMap
        // 如果存在普通攻击专用材料方案（如岩元素旅行者），额外构建
        if (te.normalTalentBooks) {
          const normalBookMap = {}
          te.normalTalentBooks.forEach((ids, typeIdx) => {
            normalBookMap[typeIdx] = {}
            ids.forEach((id, ri) => {
              const rarity = 2 + ri
              const found = ascMats.find(m => m.material_id === id) || talMats.find(m => m.material_id === id)
              if (found) normalBookMap[typeIdx][rarity] = found
            })
          })
          result.travelerNormalBookMap = normalBookMap
          // 普通攻击例外通用掉落
          if (te.normalCommons) {
            result.travelerNormalCommons = te.normalCommons.map(id => {
              const found = ascMats.find(m => m.material_id === id) || talMats.find(m => m.material_id === id)
              return found
            }).filter(Boolean)
          }
          // 普通攻击例外周本掉落
          if (te.normalWeekly) {
            const found = ascMats.find(m => m.material_id === te.normalWeekly) || talMats.find(m => m.material_id === te.normalWeekly)
            if (found) result.travelerNormalWeekly = found
          }
        }
      }
      result.isTraveler = selectedChar?.character_type === 'traveler'
      result.travelerElement = elemId
      setMats(result)

      // 加载材料图片
      const fixedMats = fixedRes?.data || []
      const allMats = [...ascMats, ...talMats, ...fixedMats]
      const imgs = {}
      await Promise.all(allMats.map(async m => {
        if (m.image) {
          const data = await readImage(m.image)
          if (data) imgs[m.material_id] = data
        }
      }))
      setMaterialImages(imgs)
    } catch (_) {}
  }

  // 计算材料
  const totals = computeTotals(mats, levelRange, normalRange, skillRange, burstRange, selectedChar)

  const filteredChars = search
    ? characters.filter(c => c.name_zh.includes(search) || String(c.id).includes(search))
    : characters

  // 跳转材料详情
  function openMaterial(id) {
    window.open(`#/materials/${id}`, '_self')
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {!selectedChar ? (
        <>
          <div className="px-4 py-3 border-b border-white/5 bg-surface-800/30">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-700/50">
              <Search className="w-3.5 h-3.5 text-surface-500" />
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="搜索角色..." className="flex-1 bg-transparent text-sm text-surface-200 placeholder-surface-600 outline-none" />
            </div>
          </div>
          <div className="flex-1 overflow-auto p-3">
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(58px, 1fr))' }}>
              {filteredChars.map(c => (
                <button key={c.id} onClick={() => setSelectedChar(c)}
                  className="flex flex-col items-center gap-1 p-2 rounded-xl hover:bg-white/5 transition-colors">
                  <div className="w-14 h-14 rounded-xl bg-surface-800/50 flex items-center justify-center overflow-hidden">
                    {c.image ? (
                      <CharImg name={c.image} className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-xs text-surface-500">{c.name_zh[0]}</span>
                    )}
                  </div>
                  <span className="text-[11px] text-surface-300 text-center leading-tight">{c.name_zh}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* 角色头部 */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5 bg-surface-800/30">
            <div className="w-10 h-10 rounded-xl bg-surface-700 overflow-hidden shrink-0">
              {selectedChar.image && <CharImg name={selectedChar.image} className="w-full h-full object-cover" />}
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-white">{selectedChar.name_zh}</p>
            </div>
            <button onClick={() => setSelectedChar(null)}
              className="px-2.5 py-1 rounded-lg text-xs bg-white/10 hover:bg-white/20 text-surface-300 transition-colors flex items-center gap-1">
              <RefreshCw className="w-3 h-3" />重新选择
            </button>
          </div>

          {/* 旅行者元素选择 */}
          {selectedChar.character_type === 'traveler' && selectedChar.id !== 10000117 && selectedChar.id !== 10000118 && travelerElements.length > 0 && (
            <div className="flex items-center gap-2 px-4 py-2 border-b border-white/5 bg-surface-800/20">
              <span className="text-[11px] text-surface-500 shrink-0">元素：</span>
              <div className="flex gap-1 flex-wrap">
                {travelerElements.map(el => (
                  <button key={el.element_id} onClick={() => setTravelerElement(el.element_id)}
                    className={`px-2.5 py-1 rounded-lg text-xs transition-colors ${travelerElement === el.element_id ? 'bg-primary-500/20 text-primary-400 border border-primary-500/30' : 'text-surface-400 hover:text-surface-200 hover:bg-white/5 border border-transparent'}`}>
                    {el.name_zh || `元素${el.element_id}`}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 进度条区 */}
          <div className="flex-1 overflow-auto p-4 space-y-4">
            <SliderBlock label="角色等级" nodes={LEVEL_NODES} values={levelRange} onChange={setLevelRange} />
            <SliderBlock label="普通攻击" nodes={TALENT_NODES} values={normalRange} onChange={setNormalRange} />
            <SliderBlock label="元素战技" nodes={TALENT_NODES} values={skillRange} onChange={setSkillRange} />
            <SliderBlock label="元素爆发" nodes={TALENT_NODES} values={burstRange} onChange={setBurstRange} />

            {/* 材料总计 */}
            {totals && totals.length > 0 ? (
              <div className="pt-3 border-t border-white/10">
                <p className="text-xs text-surface-500 mb-2">所需材料总计</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  {totals.map((m, i) => (
                    <div key={i} onClick={() => openMaterial(m.id)}
                      className="flex items-center gap-1.5 px-1.5 py-0.5 rounded hover:bg-white/5 cursor-pointer transition-colors">
                      <div className="w-5 h-5 rounded bg-surface-800/50 flex items-center justify-center overflow-hidden shrink-0">
                        {materialImages[m.id] ? <img src={materialImages[m.id]} alt="" className="w-full h-full object-cover" /> : null}
                      </div>
                      <span className="text-[11px] text-surface-200 flex-1 truncate">{m.name}</span>
                      <span className="text-[11px] text-primary-400 font-mono font-medium shrink-0">{m.count.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : totals ? (
              <div className="pt-3 border-t border-white/10">
                <p className="text-xs text-surface-500">此角色无需培养材料</p>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════
// 滑块行
// ═══════════════════════════════════════
function SliderBlock({ label, nodes, values, onChange }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-[11px] text-surface-400">{label}</span>
        <span className="text-[11px] text-surface-300 font-mono">
          Lv.{nodes[values[0]]} → Lv.{nodes[values[1]]}
        </span>
      </div>
      <DualRangeSlider nodes={nodes} values={values} onChange={onChange} />
    </div>
  )
}

// ═══════════════════════════════════════
// 角色头像（懒加载）
// ═══════════════════════════════════════
function CharImg({ name, className }) {
  const { readImage } = useDb()
  const [src, setSrc] = useState(null)
  useEffect(() => {
    readImage(name).then(d => { if (d) setSrc(d) }).catch(() => {})
  }, [name, readImage])
  if (!src) return <div className={`${className} bg-surface-700`} />
  return <img src={src} alt="" className={className} />
}

// ═══════════════════════════════════════
// 材料计算
// ═══════════════════════════════════════
function computeTotals(mats, levelRange, normalRange, skillRange, burstRange, selectedChar) {
  if (!mats) return null
  if (mats.isEmpty) return []

  const [lMin, lMax] = levelRange
  const map = {}
  const isTraveler = mats.isTraveler

  function add(id, name, count) {
    if (!id || !count) return
    if (!map[id]) map[id] = { id, name, count: 0 }
    map[id].count += count
  }

  const levelTable = isTraveler ? TRAVELER_LEVEL_COSTS : LEVEL_COSTS
  const talentTable = isTraveler ? TRAVELER_TALENT_COSTS : TALENT_COSTS

  // 角色等级
  for (let i = lMin; i < lMax; i++) {
    const cost = levelTable[i]
    if (!cost) continue
    add(MORA, '摩拉', cost.mora)
    if (cost.wanderer) add(WANDERER, '流浪者的经验', cost.wanderer)
    if (cost.adventurer) add(ADVENTURER, '冒险家的经验', cost.adventurer)
    if (cost.hero) add(HERO, '大英雄的经验', cost.hero)
    if (cost.specialty && mats.specialty) add(mats.specialty.material_id, mats.specialty.name_zh, cost.specialty)
    if (cost.boss && mats.boss) add(mats.boss.material_id, mats.boss.name_zh, cost.boss)
    if (cost.gems) {
      cost.gems.forEach((qty, idx) => {
        if (qty && mats.gems[idx]) add(mats.gems[idx].material_id, mats.gems[idx].name_zh, qty)
      })
    }
    if (cost.commons) {
      cost.commons.forEach((qty, idx) => {
        if (qty && mats.commons[idx]) add(mats.commons[idx].material_id, mats.commons[idx].name_zh, qty)
      })
    }
  }

  // 技能（skillType: 'normal' | 'skill' | 'burst'，用于区分普通攻击的例外材料）
  function addTalent(range, skillType) {
    for (let i = range[0]; i < range[1]; i++) {
      const cost = talentTable[i]
      if (!cost) continue
      add(MORA, '摩拉', cost.mora)
      if (cost.book && isTraveler) {
        const [typeIdx, rarity, qty] = cost.book
        // 普通攻击使用例外材料方案（如岩元素旅行者）
        const bookMap = (skillType === 'normal' && mats.travelerNormalBookMap) ? mats.travelerNormalBookMap : mats.travelerBookMap
        const book = bookMap?.[typeIdx]?.[rarity]
        if (book && qty) add(book.material_id, book.name_zh, qty)
      } else if (cost.books) {
        cost.books.forEach((qty, idx) => {
          if (qty && mats.talentBooks[idx]) add(mats.talentBooks[idx].material_id, mats.talentBooks[idx].name_zh, qty)
        })
      }
      if (cost.commons) {
        cost.commons.forEach((qty, idx) => {
          if (qty) {
            // 普通攻击使用例外通用掉落材料
            const commonsArr = (skillType === 'normal' && mats.travelerNormalCommons) ? mats.travelerNormalCommons : mats.talentCommons
            if (commonsArr[idx]) add(commonsArr[idx].material_id, commonsArr[idx].name_zh, qty)
          }
        })
      }
      if (cost.weekly && mats.weeklyBoss) {
        let w = cost.weekly
        // 火元素旅行者：6~10级每级只用1个周本材料
        if (isTraveler && mats.travelerElement === 1) {
          if (i >= 6) w = 1
        }
        // 普通攻击使用例外周本材料（如岩元素旅行者）
        const weeklyMat = (skillType === 'normal' && mats.travelerNormalWeekly) ? mats.travelerNormalWeekly : mats.weeklyBoss
        add(weeklyMat.material_id, weeklyMat.name_zh, w)
      }
      if (cost.crown) add(104319, '智识之冕', cost.crown)
    }
  }
  addTalent(normalRange, 'normal')
  addTalent(skillRange, 'skill')
  addTalent(burstRange, 'burst')

  return Object.values(map).sort((a, b) => a.id - b.id)
}

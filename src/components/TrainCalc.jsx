import { useState, useEffect, useCallback } from 'react'
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
  { from: 20, to: 30, mora: 62585, wanderer: 3, adventurer: 2, hero: 10, gems: [0, 3, 0, 0], boss: null, commons: [3, 0, 0], specialty: 3 },
  { from: 30, to: 40, mora: 73080, wanderer: 1, adventurer: 1, hero: 18, gems: null, boss: null, commons: null, specialty: null },
  { from: 40, to: 50, mora: 155820, wanderer: 5, adventurer: 3, hero: 28, gems: null, boss: 2, commons: [15, 0, 0], specialty: 10 },
  { from: 50, to: 60, mora: 251000, wanderer: 5, adventurer: 2, hero: 42, gems: [0, 0, 6, 0], boss: 4, commons: [0, 12, 0], specialty: 20 },
  { from: 60, to: 70, mora: 319185, wanderer: 1, adventurer: 3, hero: 59, gems: [0, 0, 0, 3], boss: 8, commons: [0, 18, 0], specialty: 30 },
  { from: 70, to: 80, mora: 422375, wanderer: 2, adventurer: 2, hero: 80, gems: [0, 0, 0, 6], boss: 12, commons: [0, 0, 12], specialty: 45 },
  { from: 80, to: 90, mora: 804625, wanderer: 4, hero: 171, gems: [0, 0, 0, 0, 6], boss: 20, commons: [0, 0, 24], specialty: 60 },
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
  { from: 9, to: 10, mora: 700000, books: [0, 0, 16], commons: [0, 0, 12], weekly: 2 },
]

const LEVEL_NODES = [1, 20, 30, 40, 50, 60, 70, 80, 90]
const TALENT_NODES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

// ═══════════════════════════════════════
// 双端范围滑块
// ═══════════════════════════════════════
function DualRangeSlider({ nodes, values, onChange, labels }) {
  const [min, max] = values
  const nodeCount = nodes.length

  function handleMinChange(e) {
    const v = parseInt(e.target.value)
    if (v <= max) onChange([v, max])
  }
  function handleMaxChange(e) {
    const v = parseInt(e.target.value)
    if (v >= min) onChange([min, v])
  }

  return (
    <div className="relative pt-2 pb-1">
      <div className="flex justify-between text-[10px] text-surface-500 mb-1 px-1">
        {nodes.map((n, i) => (
          <span key={i} className={i === min || i === max ? 'text-white font-medium' : ''}>{n}</span>
        ))}
      </div>
      <div className="relative h-2 bg-surface-700 rounded-full">
        <div className="absolute h-full rounded-full bg-primary-500/50"
          style={{ left: `${(min / (nodeCount - 1)) * 100}%`, right: `${(1 - max / (nodeCount - 1)) * 100}%` }} />
        <input type="range" min={0} max={nodeCount - 1} value={min} onChange={handleMinChange}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
        <input type="range" min={0} max={nodeCount - 1} value={max} onChange={handleMaxChange}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
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

  // 四个进度条 [min, max] 索引
  const [levelRange, setLevelRange] = useState([0, LEVEL_NODES.length - 1])
  const [normalRange, setNormalRange] = useState([0, TALENT_NODES.length - 1])
  const [skillRange, setSkillRange] = useState([0, TALENT_NODES.length - 1])
  const [burstRange, setBurstRange] = useState([0, TALENT_NODES.length - 1])

  const [showList, setShowList] = useState(true)

  // 加载角色列表
  useEffect(() => {
    query(`SELECT id, name_zh, element_id, card_art AS image, rarity FROM characters WHERE character_type != 'traveler' ORDER BY id`)
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
    if (!selectedChar) { setMats(null); return }
    loadCharacterMats(selectedChar.id)
  }, [selectedChar])

  async function loadCharacterMats(charId) {
    try {
      const [ascRes, talRes, fixedRes] = await Promise.all([
        query(`SELECT cam.*, m.name_zh, m.type, m.rarity, m.image
               FROM character_ascension_materials cam JOIN materials m ON cam.material_id = m.id
               WHERE cam.character_id = ?`, [charId]),
        query(`SELECT ctm.*, m.name_zh, m.type, m.rarity, m.image
               FROM character_talent_materials ctm JOIN materials m ON ctm.material_id = m.id
               WHERE ctm.character_id = ?`, [charId]),
        query(`SELECT id AS material_id, name_zh, rarity, image FROM materials WHERE id IN (202,104001,104002,104003)`),
      ])
      const ascMats = ascRes?.data || []
      const talMats = talRes?.data || []

      // 分类材料
      const result = {
        specialty: ascMats.find(m => m.type === 'local_specialty'),
        boss: ascMats.find(m => m.type === 'Boss掉落'),
        gems: ascMats.filter(m => m.type === 'character_ascension').sort((a, b) => a.rarity - b.rarity),
        commons: ascMats.filter(m => m.type === '通用掉落').sort((a, b) => a.rarity - b.rarity),
        talentBooks: [], weeklyBoss: null, talentCommons: [],
      }
      // 天赋材料按 material_type 分类
      for (const m of talMats) {
        if (m.material_type === 'book') result.talentBooks.push(m)
        else if (m.material_type === 'weekly_boss') result.weeklyBoss = m
        else if (m.material_type === 'common') result.talentCommons.push(m)
      }
      result.talentBooks.sort((a, b) => a.rarity - b.rarity)
      result.talentCommons.sort((a, b) => a.rarity - b.rarity)
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
  const totals = computeTotals(mats, levelRange, normalRange, skillRange, burstRange)

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
            <div className="grid grid-cols-4 gap-2">
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

          {/* 进度条区 */}
          <div className="flex-1 overflow-auto p-4 space-y-4">
            <SliderBlock label="角色等级" nodes={LEVEL_NODES} values={levelRange} onChange={setLevelRange} />
            <SliderBlock label="普通攻击" nodes={TALENT_NODES} values={normalRange} onChange={setNormalRange} />
            <SliderBlock label="元素战技" nodes={TALENT_NODES} values={skillRange} onChange={setSkillRange} />
            <SliderBlock label="元素爆发" nodes={TALENT_NODES} values={burstRange} onChange={setBurstRange} />

            {/* 材料总计 */}
            {totals && totals.length > 0 && (
              <div className="pt-3 border-t border-white/10">
                <p className="text-xs text-surface-500 mb-2">所需材料总计</p>
                <div className="space-y-1.5">
                  {totals.map((m, i) => (
                    <div key={i} onClick={() => openMaterial(m.id)}
                      className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg hover:bg-white/5 cursor-pointer transition-colors">
                      <div className="w-7 h-7 rounded-lg bg-surface-800/50 flex items-center justify-center overflow-hidden shrink-0">
                        {materialImages[m.id] ? <img src={materialImages[m.id]} alt="" className="w-full h-full object-cover" /> : null}
                      </div>
                      <span className="text-xs text-surface-200 flex-1 truncate">{m.name}</span>
                      <span className="text-xs text-primary-400 font-mono font-medium">{m.count.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
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
function computeTotals(mats, levelRange, normalRange, skillRange, burstRange) {
  if (!mats) return null

  const [lMin, lMax] = levelRange
  const map = {}

  function add(id, name, count) {
    if (!id || !count) return
    if (!map[id]) map[id] = { id, name, count: 0 }
    map[id].count += count
  }

  // 角色等级
  for (let i = lMin; i < lMax; i++) {
    const cost = LEVEL_COSTS[i]
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

  // 技能
  function addTalent(range) {
    for (let i = range[0]; i < range[1]; i++) {
      const cost = TALENT_COSTS[i]
      if (!cost) continue
      add(MORA, '摩拉', cost.mora)
      if (cost.books) {
        cost.books.forEach((qty, idx) => {
          if (qty && mats.talentBooks[idx]) add(mats.talentBooks[idx].material_id, mats.talentBooks[idx].name_zh, qty)
        })
      }
      if (cost.commons) {
        cost.commons.forEach((qty, idx) => {
          if (qty && mats.talentCommons[idx]) add(mats.talentCommons[idx].material_id, mats.talentCommons[idx].name_zh, qty)
        })
      }
      if (cost.weekly && mats.weeklyBoss) add(mats.weeklyBoss.material_id, mats.weeklyBoss.name_zh, cost.weekly)
    }
  }
  addTalent(normalRange)
  addTalent(skillRange)
  addTalent(burstRange)

  return Object.values(map).sort((a, b) => a.id - b.id)
}

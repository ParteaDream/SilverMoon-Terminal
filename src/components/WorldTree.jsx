import { useNavigate } from 'react-router-dom'
import { createPortal } from 'react-dom'
import { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react'
import { useDb } from '../context/DbContext'
import { useTerminal } from '../context/TerminalContext'
import {
  Globe, Loader2, Plus, Trash2, ArrowLeft, ChevronDown, ChevronUp,
  Users, Swords, Clock, Zap, MapPin, TrendingUp, Award, Activity, Eye,
  Shield, ChevronRight, ArrowUpDown,
} from 'lucide-react'

const EN = { Pyro:'火', Hydro:'水', Anemo:'风', Electro:'雷', Dendro:'草', Cryo:'冰', Geo:'岩' }
const EB = { Pyro:'bg-red-500/10', Hydro:'bg-blue-500/10', Anemo:'bg-cyan-500/10', Electro:'bg-purple-500/10', Dendro:'bg-green-500/10', Cryo:'bg-sky-500/10', Geo:'bg-yellow-500/10' }
const EC = { Pyro:'text-red-400', Hydro:'text-blue-400', Anemo:'text-cyan-400', Electro:'text-purple-400', Dendro:'text-green-400', Cryo:'text-sky-300', Geo:'text-yellow-400' }
const WT = { 1:'单手剑',2:'弓',3:'长柄',4:'法器',5:'大剑',10:'单手剑',11:'弓',12:'长柄',13:'法器',14:'大剑' }
const PN = { 1:'生之花',2:'死之羽',3:'时之沙',4:'空之杯',5:'理之冠' }
const PT = {
  2000:'生命值',2001:'攻击力',2002:'防御力',
  20:'暴击率',22:'暴击伤害',23:'元素充能效率',
  26:'治疗加成',27:'受治疗加成',28:'元素精通',
  30:'物理伤害加成',
  40:'火元素伤害加成',41:'雷元素伤害加成',42:'水元素伤害加成',
  43:'草元素伤害加成',44:'风元素伤害加成',45:'岩元素伤害加成',46:'冰元素伤害加成',
  29:'物理抗性',
  50:'火元素抗性',51:'雷元素抗性',52:'水元素抗性',
  53:'草元素抗性',54:'风元素抗性',55:'岩元素抗性',56:'冰元素抗性',
  80:'冷却缩减',81:'护盾强效',
  999999:'体力上限',
  5:'攻击力',2:'生命值',3:'防御力',6:'元素充能',
  8:'攻击力%',9:'生命值%',10:'防御力%',
}
// 不需要显示的属性类型（目前已全部映射）
const SKIP_PROP_TYPES = new Set([])
// 元素→伤害加成 type 映射
const ELEM_DMG_MAP = { Pyro:40, Hydro:42, Anemo:44, Electro:41, Dendro:43, Cryo:46, Geo:45 }
// 知名地区名称映射（API 返回的 name 有些是英文或拼音，显示为中文常用名）
const KNOWN_REGIONS = {
  Mondstadt: '蒙德', Liyue: '璃月', Inazuma: '稻妻', Sumeru: '须弥', Fontaine: '枫丹',
  Natlan: '纳塔', Snezhnaya: '至冬', ChenyuVale: '沉玉谷', TheChasm: '层岩巨渊',
  Enkanomiya: '渊下宫', 'Ancient Sacred Mountain': '远古圣山',
}

export default function WorldTree() {
  const { query } = useDb()
  const { closeApp } = useTerminal()
  const [view, setView] = useState('home')
  const [accounts, setAccounts] = useState([])
  const [activeUid, setActiveUid] = useState(null)
  const [activeData, setActiveData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [loadingHint, setLoadingHint] = useState('')
  const [error, setError] = useState('')
  const [charDBMap, setCharDBMap] = useState({})
  const [dailyData, setDailyData] = useState(null)

  useEffect(() => { query('SELECT id, name_zh, rarity, element_id, weapon_type_id, card_art FROM characters').then(r=>{const m={};for(const c of(r.data||[]))m[c.id]=c;setCharDBMap(m)}).catch(()=>{}) }, [query])
  const loadAccounts = useCallback(async () => { try{const r=await window.electronAPI?.genshinListAccounts();if(r?.success)setAccounts(r.accounts||[])}catch(_){} }, [])
  useEffect(() => { loadAccounts() }, [loadAccounts])

  const loadAccountDetail = useCallback(async (uid) => {
    setLoading(true);setLoadingHint('加载中...');setError('')
    try{const r=await window.electronAPI?.genshinGetAccount(String(uid));if(r?.success){setActiveData(r.account);setActiveUid(String(uid));setView('account');setDailyData(r.account.data?.dailyNote?.data||null)}else setError('加载失败')}catch(e){setError(e.message)}
    finally{setLoading(false)}
  }, [])

  const handleLogin = useCallback(async () => {
    setLoading(true);setLoadingHint('扫码登录中...');setError('')
    try{const r=await window.electronAPI?.genshinLoginAndCrawl();if(!r?.success){setError(r?.error||'失败');return}await loadAccounts();loadAccountDetail(String(r.uid))}catch(e){setError(e.message)}
    finally{setLoading(false)}
  }, [loadAccounts, loadAccountDetail])

  const handlePasswordLogin = useCallback(async () => {
    setLoading(true);setLoadingHint('账号登录中...');setError('')
    try{const r=await window.electronAPI?.genshinPasswordLoginAndCrawl();if(!r?.success){setError(r?.error||'失败');return}await loadAccounts();loadAccountDetail(String(r.uid))}catch(e){setError(e.message)}
    finally{setLoading(false)}
  }, [loadAccounts, loadAccountDetail])

  const handleDelete = useCallback(async (uid) => { if(!confirm(`删除账号 ${uid}`))return;await window.electronAPI?.genshinDeleteAccount(String(uid));if(activeUid===String(uid)){setView('home');setActiveUid(null);setActiveData(null)}await loadAccounts() }, [activeUid, loadAccounts])
  useEffect(() => { if(!activeUid)return;const t=setInterval(async()=>{try{const r=await window.electronAPI?.genshinRefetchDaily(String(activeUid));if(r?.success&&r.daily)setDailyData(r.daily)}catch(_){}},60000);return()=>clearInterval(t) }, [activeUid])
  useEffect(() => { if(error){const t=setTimeout(()=>setError(''),6000);return()=>clearTimeout(t)} }, [error])

  return (
    <div className="flex flex-col h-full bg-surface-900/95 text-surface-100 select-none" style={{fontSize:'clamp(10px,0.7vw + 6px,16px)'}}>
      {error && <div className="mx-3 mt-1 px-2 py-1 rounded-lg bg-red-500/10 border border-red-500/20 text-[10px] text-red-400">{error}</div>}
      <div className="flex flex-1 overflow-hidden">
        {view === 'account' && activeData && (
          <Sidebar account={activeData} data={activeData.data||{}} onBack={()=>{setView('home');setActiveUid(null);setActiveData(null);setDailyData(null)}} onDelete={()=>handleDelete(activeUid)} onRefresh={handleLogin} loading={loading} />
        )}
        <div className="flex-1 overflow-y-auto">
          {loading && <div className="flex flex-col items-center justify-center py-16 gap-2"><Loader2 className="w-6 h-6 text-green-400 animate-spin" /><span className="text-xs text-surface-500">{loadingHint}</span></div>}
          {!loading && view === 'home' && <HomePage accounts={accounts} onLogin={handleLogin} onPasswordLogin={handlePasswordLogin} onDelete={handleDelete} onSelect={loadAccountDetail} loading={loading} />}
          {!loading && view === 'account' && activeData && <MainContent data={activeData.data||{}} charDBMap={charDBMap} dailyData={dailyData} />}
        </div>
      </div>
    </div>
  )
}

function Sidebar({ account, data, onBack, onDelete }) {
  const r = data.index?.data?.role || data.roleBasicInfo?.data || {}
  const s = data.index?.data?.stats || {}
  const n = r.nickname || account.nickname || '旅行者'
  return (
    <div className="w-28 shrink-0 border-r border-surface-700/30 bg-surface-850/30 flex flex-col overflow-y-auto">
      <button onClick={onBack} className="flex items-center gap-1 px-3 py-1.5 text-[10px] text-surface-400 hover:text-surface-200 hover:bg-surface-800/40 border-b border-surface-700/20"><ArrowLeft className="w-3 h-3" />账号列表</button>
      <div className="p-3 text-center border-b border-surface-700/20">
        <div className="w-10 h-10 mx-auto rounded-full bg-gradient-to-br from-green-500/30 to-emerald-700/30 border border-green-500/30 flex items-center justify-center">
          <span className="text-base font-bold text-green-400">{n[0]}</span>
        </div>
        <h4 className="mt-1 text-[11px] font-bold truncate">{n}</h4>
        <div className="mt-1 text-[10px] font-semibold text-surface-200">Lv.{r.level|| account.level}</div>
        <div className="text-[9px] text-surface-500">UID {account.uid}</div>
      </div>
      <div className="px-3 py-2 space-y-1 text-[9px]">
        {[{l:'角色',v:s.avatar_number},{l:'成就',v:s.achievement_number},{l:'深境',v:data.spiralAbyss?.data?.max_floor}].map((t,i)=><div key={i} className="flex justify-between"><span className="text-surface-500">{t.l}</span><span>{t.v||'?'}</span></div>)}
      </div>
    </div>
  )
}

function HomePage({ accounts, onLogin, onPasswordLogin, onDelete, onSelect, loading }) {
  if(!accounts.length) return <div className="flex flex-col items-center justify-center h-full gap-3"><Globe className="w-10 h-10 text-surface-600"/><p className="text-[10px] text-surface-500">登录并爬取数据</p><div className="flex gap-2"><button onClick={onLogin} disabled={loading} className="px-4 py-1.5 rounded-lg bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-[10px] flex items-center gap-1">{loading?<Loader2 className="w-3 h-3 animate-spin"/>:<Plus className="w-3 h-3"/>}扫码登录</button><button onClick={onPasswordLogin} disabled={loading} className="px-4 py-1.5 rounded-lg bg-surface-700 hover:bg-surface-600 disabled:opacity-50 text-surface-200 text-[10px] flex items-center gap-1">账号登录</button></div></div>
  return (
    <div className="p-3 space-y-1.5 max-w-md mx-auto">
      <div className="flex justify-between mb-1"><span className="text-[9px] text-surface-500">{accounts.length} 个账号</span>
        <div className="flex gap-1">
          <button onClick={onLogin} disabled={loading} className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] bg-green-600/20 text-green-400 hover:bg-green-600/30 disabled:opacity-50">{loading?<Loader2 className="w-2.5 h-2.5 animate-spin"/>:<Plus className="w-2.5 h-2.5"/>}扫码</button>
          <button onClick={onPasswordLogin} disabled={loading} className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] bg-surface-700 text-surface-400 hover:bg-surface-600 disabled:opacity-50">账号</button>
        </div>
      </div>
      {accounts.map(acc => (
        <div key={acc.uid} onClick={()=>onSelect(acc.uid)} className="flex items-center gap-2.5 p-2 rounded-lg bg-surface-800/40 border border-surface-700/30 hover:border-green-500/30 hover:bg-surface-800/60 cursor-pointer group">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-green-500/20 to-emerald-700/20 border border-green-500/30 flex items-center justify-center shrink-0"><span className="text-sm font-bold text-green-400">{(acc.nickname||'?')[0]}</span></div>
          <div className="flex-1 min-w-0"><div className="flex items-center gap-1"><span className="text-[11px] font-semibold truncate">{acc.nickname||'旅行者'}</span><span className="text-[8px] px-1 py-0 rounded bg-amber-500/10 text-amber-400">Lv.{acc.level}</span></div><div className="text-[9px] text-surface-500">UID {acc.uid}</div></div>
          <button onClick={e=>{e.stopPropagation();onLogin()}} disabled={loading} className="p-0.5 rounded text-surface-500 hover:text-green-400 hover:bg-green-500/10 opacity-0 group-hover:opacity-100 transition-opacity" title="更新数据">{loading?<Loader2 className="w-2.5 h-2.5 animate-spin"/>:<svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 11-9-9"/><path d="M21 3v6h-6"/></svg>}</button>
          <button onClick={e=>{e.stopPropagation();onDelete(acc.uid)}} className="p-0.5 rounded text-surface-500 hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 className="w-2.5 h-2.5"/></button>
        </div>
      ))}
    </div>
  )
}

// ─── 主内容 ───
function MainContent({ data, charDBMap, dailyData }) {
  const [tab, setTab] = useState('overview')
  const [selectedChar, setSelectedChar] = useState(null)
  const index = data.index?.data||{}
  const stats = index.stats||{}
  const avatars = index.avatars||[]
  const worlds = index.world_explorations||[]
  const worldDisplay = index.world_exploration_display||[]
  const charsList = data.characters?.data?.list||[]
  const cd = data.characterDetail?.data||{}
  const abyss = data.spiralAbyss?.data
  const abyssPrev = data.spiralAbyssPrev?.data
  const daily = dailyData||data.dailyNote?.data
  const rcDetail = data.roleCombat?.data?.data||[]
  const hardChallengeDetail = data.hardChallenge?.data?.data||[]
  const cdMap = {};if(cd.list)for(const c of cd.list)cdMap[c.base?.id]=c

  const tabs = [
    {key:'overview',label:'概览',icon:TrendingUp},
    {key:'explore',label:'探索',icon:MapPin},
    {key:'characters',label:`角色(${avatars.length})`,icon:Users},
    {key:'challenge',label:'挑战',icon:Swords},
    {key:'daily',label:'便笺',icon:Clock},
  ]

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 px-3 py-1 border-b border-surface-700/30 shrink-0 overflow-x-auto">
        {tabs.map(t=>(
          <button key={t.key} onClick={()=>{setTab(t.key);setSelectedChar(null)}}
            className={`px-2 py-0.5 rounded text-[10px] whitespace-nowrap transition-colors flex items-center gap-0.5 ${tab===t.key?'bg-surface-700 text-white':'text-surface-400 hover:text-surface-300'}`}>
            <t.icon className="w-3 h-3"/>{t.label}</button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3" style={tab==='characters'&&selectedChar?{paddingBottom:0}:{}}>
        {tab==='overview'&&<OverviewPanel stats={stats} daily={daily} worlds={worlds} rcDetail={rcDetail} hardChallengeDetail={hardChallengeDetail} />}
        {tab==='explore'&&<ExplorePanel stats={stats} worlds={worlds} worldDisplay={worldDisplay}/>}
        {tab==='daily'&&<DailyPanel daily={daily}/>}
        {tab==='challenge'&&<ChallengePanel
          abyss={abyss} abyssPrev={abyssPrev}
          rcDetail={rcDetail}
          hardChallengeDetail={hardChallengeDetail}
          stats={stats}
          charDBMap={charDBMap}
        />}
        {tab==='characters'&&!selectedChar&&<CharacterGrid avatars={avatars} charsList={charsList} charDBMap={charDBMap} onSelect={setSelectedChar}/>}
        {tab==='characters'&&selectedChar&&<div className="flex gap-2">
          <div className="flex-[3] min-w-0 overflow-visible">
            <CharacterGrid avatars={avatars} charsList={charsList} charDBMap={charDBMap} onSelect={setSelectedChar} selectedId={selectedChar.id} />
          </div>
          <div className="flex-[2] min-w-[240px] shrink-0 overflow-visible border-l border-surface-700/30 pl-2">
            <CharacterDetail char={selectedChar} charDetail={cdMap[selectedChar.id]} charDBMap={charDBMap} onBack={()=>setSelectedChar(null)} sidePanel />
          </div>
        </div>}
      </div>
    </div>
  )
}

// ─── 概览 ───
function OverviewPanel({ stats, daily, worlds, rcDetail, hardChallengeDetail }) {
  const maxRound = rcDetail?.[0]?.stat?.max_round_id
  const hcDif = hardChallengeDetail?.[0]?.single?.best?.difficulty || stats.hard_challenge?.difficulty
  return <div className="grid grid-cols-6 gap-2">
    <Box icon={Users} label="角色" value={stats.avatar_number} color="text-blue-400"/>
    <Box icon={Award} label="成就" value={stats.achievement_number} color="text-amber-400"/>
    <Box icon={Swords} label="深境" value={stats.spiral_abyss} color="text-purple-400"/>
    <Box icon={Shield} label="剧诗" value={maxRound?`${maxRound}幕`:'?'} color="text-cyan-400"/>
    <Box icon={Shield} label="危战" value={hcDif?`难度${hcDif}`:'?'} color="text-red-400"/>
    <Box icon={Activity} label="活跃" value={`${stats.active_day_number||'?'}天`} color="text-pink-400"/>
  </div>
}
function Box({icon:I,label:l,value:v,color:c}){return<div className="rounded-lg bg-surface-800/40 border border-surface-700/30 p-2 text-center"><I className={`w-4 h-4 ${c} mx-auto mb-0.5`}/><div className="text-sm font-bold text-surface-200">{v||'?'}</div><div className="text-[8px] text-surface-500">{l}</div></div>}

// ─── 探索（按国家-子区域层级，基于 API world_exploration_display）───
function ExplorePanel({ stats, worlds, worldDisplay }) {
  const oculus = [{k:'anemoculus_number',n:'风',e:'🍃'},{k:'geoculus_number',n:'岩',e:'🪨'},{k:'electroculus_number',n:'雷',e:'⚡'},{k:'dendroculus_number',n:'草',e:'🌿'},{k:'hydroculus_number',n:'水',e:'💧'},{k:'pyroculus_number',n:'火',e:'🔥'},{k:'moonoculus_number',n:'月',e:'🌙'}]
  const chests = [{k:'common_chest_number',n:'普通',c:'text-surface-400'},{k:'exquisite_chest_number',n:'精致',c:'text-blue-400'},{k:'precious_chest_number',n:'珍贵',c:'text-purple-400'},{k:'luxurious_chest_number',n:'华丽',c:'text-amber-400'},{k:'magic_chest_number',n:'奇馈',c:'text-green-400'}]
  const worldMap = {}; for (const w of worlds) worldMap[w.id] = w

  // 用 world_exploration_display 构建层级
  const regions = (worldDisplay||[]).map(g => {
    const parent = worldMap[g.exploration_id]
    if (!parent) return null
    // 构建子地区分组（含预解析条目）
    const groups = (g.group?.items||[]).map(item => {
      const entries = (item.area_ids||[]).map(aid => worldMap[aid]).filter(Boolean)
      return {
        areaIds: item.area_ids||[],
        pct: item.exploration_percentage,
        entries,
        groupName: entries[0]?.name||'区域',
        subDetail: entries.flatMap(e => e.area_exploration_list||[]),
      }
    })
    // 自己 area_exploration_list 中的详细区域
    const detailAreas = parent.area_exploration_list || []
    return { parent, groups, detailAreas }
  }).filter(Boolean)

  // 对父区域计算综合探索度
  const calcPct = (parent, groups, detailAreas) => {
    if (parent.exploration_percentage > 0 && groups.length === 0) return parent.exploration_percentage
    const allPcts = [...detailAreas.map(a => a.exploration_percentage), ...groups.map(g => g.pct)]
    if (allPcts.length === 0) return parent.exploration_percentage
    return Math.round(allPcts.reduce((s,p) => s+p, 0) / allPcts.length)
  }

  return <div className="space-y-3">
    {/* 地区探索 */}
    {regions.length>0&&<div className="rounded-lg bg-surface-800/40 border border-surface-700/30 p-3">
      <h4 className="text-[10px] font-semibold text-surface-400 mb-2">地区探索</h4>
      <div className="space-y-2">
        {regions.map(r => {
          const pct = calcPct(r.parent, r.groups, r.detailAreas)
          return <RegionCard key={r.parent.id} p={r.parent} groups={r.groups} detailAreas={r.detailAreas} pct={pct} worldMap={worldMap} />
        })}
      </div>
    </div>}
    {regions.length===0&&<div className="rounded-lg bg-surface-800/40 border border-surface-700/30 p-3 text-center text-[10px] text-surface-500">地区探索信息将在下次登录爬取后显示</div>}
    {/* 宝箱 */}
    <div className="rounded-lg bg-surface-800/40 border border-surface-700/30 p-3"><h4 className="text-[10px] font-semibold text-surface-400 mb-2">宝箱</h4><div className="grid grid-cols-5 gap-1 text-center">{chests.map((c,i)=><div key={i} className="p-1 rounded bg-surface-800/50"><div className={`text-xs font-bold ${c.c}`}>{stats[c.k]||0}</div><div className="text-[8px] text-surface-500">{c.n}</div></div>)}</div></div>
    {/* 神瞳 */}
    <div className="rounded-lg bg-surface-800/40 border border-surface-700/30 p-3"><h4 className="text-[10px] font-semibold text-surface-400 mb-2">神瞳</h4><div className="grid grid-cols-4 gap-1 text-center">{oculus.map((o,i)=>{const v=stats[o.k];if(v===undefined)return null;return<div key={i} className="p-1 rounded bg-surface-800/50"><div className="text-xs">{o.e}</div><div className="text-[9px] font-bold text-surface-300">{v}</div><div className="text-[7px] text-surface-500">{o.n}</div></div>})}</div></div>
  </div>
}

function RegionCard({ p: parent, groups, detailAreas, pct, worldMap }) {
  const [expanded, setExpanded] = useState(false)
  const hasDetail = groups.length > 0 || detailAreas.length > 0
  const displayPct = Math.round(pct/10)
  const isNordkalei = parent.name === '挪德卡莱'
  const isNatlan = parent.name === '纳塔'

  // 收集所有供奉：父区域 + 所有分组条目，但挪德卡莱的供奉移入展开区
  const allOfferings = []
  const collOfferings = []
  // 父区域的供奉
  for (const o of (parent.offerings||[])) {
    allOfferings.push(o)
    if (!isNordkalei) collOfferings.push(o)
  }
  for (const g of groups) {
    for (const e of g.entries) {
      for (const o of (e.offerings||[])) {
        if (!allOfferings.find(x => x.name === o.name)) {
          allOfferings.push(o)
          if (!isNordkalei) collOfferings.push(o)
        }
      }
    }
  }
  // 纳塔部族声望
  const tribes = parent.natan_reputation?.tribal_list || []
  // 挪德卡莱的聚所（就是它自己的供奉）
  const nordkaleiOfferings = isNordkalei ? (parent.offerings||[]) : []

  const toggle = () => setExpanded(!expanded)

  return <div className="rounded-lg bg-surface-800/30 border border-surface-700/20 p-2">
    {/* 标题行：点击切换展开 */}
    <div className="cursor-pointer" onClick={hasDetail ? toggle : undefined}>
      <div className="flex items-center justify-between text-[10px] mb-1">
        <div className="flex items-center gap-1.5">
          {hasDetail && <span className="text-surface-500">{expanded ? <ChevronDown className="w-2.5 h-2.5" /> : <ChevronRight className="w-2.5 h-2.5" />}</span>}
          <span className="font-semibold text-surface-200">{parent.name}</span>
          {parent.seven_statue_level > 0 && <span className="text-[8px] text-cyan-400">七天神像 Lv.{parent.seven_statue_level}</span>}
          {parent.type==='Reputation' && parent.level > 0 && <span className="text-[8px] text-amber-400">声望 Lv.{parent.level}</span>}
          {collOfferings.map((o,oi) => <span key={oi} className="text-[8px] text-purple-400">{o.name} Lv.{o.level}</span>)}
        </div>
        <span className="text-surface-400 font-mono">{displayPct}%</span>
      </div>
      <div className="h-1 rounded-full bg-surface-700 overflow-hidden mb-1"><div className="h-full rounded-full bg-gradient-to-r from-green-500/40 to-green-400/70" style={{width:`${Math.min(displayPct,100)}%`}}/></div>
    </div>

    {/* 折叠：一行显示各分组探索度 */}
    {!expanded && hasDetail && <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[9px] text-surface-400">
      {detailAreas.length > 0 && <span>主要区域 <span className="text-surface-500">{Math.round(detailAreas.reduce((s,a)=>s+a.exploration_percentage,0)/detailAreas.length/10)}%</span></span>}
      {groups.map((g, gi) => <span key={gi}>{g.groupName} <span className="text-surface-500">{Math.round(g.pct/10)}%</span></span>)}
    </div>}

    {/* 展开：各分组详细区域 + 聚所/部族 */}
    {expanded && <div className="mt-1.5 space-y-2">
      {detailAreas.length > 0 && <div>
        <div className="text-[8px] text-surface-500 mb-0.5">主要区域</div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
          {detailAreas.map((a, ai) => <SubArea key={ai} name={a.name} pct={a.exploration_percentage} compact />)}
        </div>
      </div>}
      {groups.map((g, gi) => {
        if (g.entries.length === 0) return null
        const hasOwnDetail = g.subDetail.length > 0 || g.entries.some(e => (e.area_exploration_list||[]).length > 0)
        return <div key={gi}>
          <div className="text-[8px] text-surface-500 mb-0.5">{g.groupName}
            {g.entries[0].seven_statue_level > 0 && <span className="ml-2 text-cyan-400">七天神像 Lv.{g.entries[0].seven_statue_level}</span>}
          </div>
          {hasOwnDetail ? (
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
              {g.subDetail.length > 0 ? g.subDetail.map((a, ai) => <SubArea key={ai} name={a.name} pct={a.exploration_percentage} compact />)
                : g.entries.map((e, ei) => (e.area_exploration_list||[]).map((a, ai) =>
                    <SubArea key={`${ei}-${ai}`} name={a.name} pct={a.exploration_percentage} compact />
                ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
              {g.entries.map((e, ei) => <SubArea key={ei} name={e.name} pct={e.exploration_percentage||g.pct} compact />)}
            </div>
          )}
        </div>
      })}
      {/* 挪德卡莱聚所：纯文字显示等级 */}
      {nordkaleiOfferings.length > 0 && <div>
        <div className="text-[8px] text-surface-500 mb-0.5">聚所</div>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[9px] text-surface-400">
          {nordkaleiOfferings.map((o, oi) => <span key={oi}>{o.name} <span className="text-surface-500">Lv.{o.level}</span></span>)}
        </div>
      </div>}
      {/* 纳塔部族声望：纯文字显示等级 */}
      {tribes.length > 0 && <div>
        <div className="text-[8px] text-surface-500 mb-0.5">部族声望</div>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[9px] text-surface-400">
          {tribes.map((t, ti) => <span key={ti}>{t.name} <span className="text-surface-500">Lv.{t.level}</span></span>)}
        </div>
      </div>}
    </div>}
  </div>
}

// 紧凑子区域进度条
function SubArea({ name, pct, compact }) {
  const display = Math.round((pct||0)/10)
  return <div className="flex items-center gap-1">
    {compact ? (
      <>
        <span className="text-[9px] text-surface-400 truncate flex-1">{name}</span>
        <div className="w-16 h-1 bg-surface-700 rounded-full overflow-hidden shrink-0">
          <div className="h-full rounded-full bg-green-500/50" style={{width:`${Math.min(display,100)}%`}}/>
        </div>
        <span className="text-[8px] text-surface-500 w-6 text-right shrink-0">{display}%</span>
      </>
    ) : (
      <div className="flex-1">
        <div className="flex justify-between text-[9px]"><span className="text-surface-400">{name}</span><span className="text-surface-500">{display}%</span></div>
        <div className="h-1 rounded-full bg-surface-700 overflow-hidden"><div className="h-full rounded-full bg-green-500/40" style={{width:`${Math.min(display,100)}%`}}/></div>
      </div>
    )}
  </div>
}

// ─── 角色网格 ───
function CharacterGrid({ avatars, charsList, charDBMap, onSelect, selectedId }) {
  const [search,setSearch]=useState('');const[elemFilter,setElemFilter]=useState('');const[sortBy,setSortBy]=useState('default');const[imgs,setImgs]=useState({})
  useEffect(()=>{const load=async()=>{const m={};for(const c of avatars){const dbc=charDBMap[c.id];const art=dbc?.card_art;if(art){const r=await window.electronAPI?.readImage?.(art.replace('.png',''));if(r?.data){m[c.id]=r.data;continue}}m[c.id]=null}setImgs(m)};load()},[avatars,charDBMap])
  let fil=[...avatars];if(search)fil=fil.filter(c=>c.name.includes(search));if(elemFilter)fil=fil.filter(c=>c.element===elemFilter)
  if(sortBy==='id')fil.sort((a,b)=>a.id-b.id)
  return <div className="space-y-2">
    <div className="flex gap-1.5 sticky top-0 z-10"><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="搜索..." className="flex-1 px-2 py-1 rounded bg-surface-800 border border-surface-600 text-[10px] text-surface-100 placeholder-surface-500 focus:outline-none focus:border-green-500"/>
    <select value={elemFilter} onChange={e=>setElemFilter(e.target.value)} className="px-1.5 py-1 rounded bg-surface-800 border border-surface-600 text-[10px] text-surface-300"><option value="">元素</option>{[...new Set(avatars.map(c=>c.element).filter(Boolean))].map(e=><option key={e} value={e}>{EN[e]}</option>)}</select>
    <button onClick={()=>setSortBy(s=>s==='default'?'id':'default')} className={`px-1.5 py-1 rounded border text-[10px] flex items-center gap-0.5 transition-colors ${sortBy==='id'?'bg-green-500/20 border-green-500/50 text-green-400':'bg-surface-800 border-surface-600 text-surface-300 hover:text-surface-200'}`}><ArrowUpDown className="w-2.5 h-2.5" />{sortBy==='default'?'默认':'ID'}</button></div>
    <div className="grid grid-cols-5 sm:grid-cols-7 md:grid-cols-9 lg:grid-cols-11 gap-1">{fil.map(c=>{const img=imgs[c.id]
      return <div key={c.id} onClick={()=>{const f=charsList.find(ch=>ch.id===c.id)||c;onSelect({...f,element:c.element,avatar_level:c.level,constellation:c.actived_constellation_num})}}
        className={`rounded-lg border overflow-hidden cursor-pointer group ${selectedId===c.id?'border-green-500/60 bg-surface-700/50':'border-surface-700/30 bg-surface-800/40 hover:border-green-500/40 hover:bg-surface-700/40'}`}>
        <div className="aspect-square bg-surface-900/50 flex items-center justify-center overflow-hidden">{img?<img src={img} className="w-full h-full object-cover" loading="lazy"/>:<span className="text-xl font-bold text-surface-600">{c.name[0]}</span>}</div>
        <div className="px-1 py-1 text-center bg-surface-800/60"><div className="text-[9px] font-medium truncate">{c.name}</div><div className="flex items-center justify-center gap-0.5 text-[7px] text-surface-400"><span>Lv.{c.level}</span>{c.actived_constellation_num>0&&<span className="text-purple-400">C{c.actived_constellation_num}</span>}</div></div>
      </div>})}
    </div>
    {fil.length===0&&<div className="text-center py-8 text-[10px] text-surface-500">无匹配</div>}
  </div>
}

// ─── 角色详情（横向排版优化）───
// ─── 角色详情（修复头像、武器紧凑、圣遗物排版、命座行内）───
function CharacterDetail({ char, charDetail, charDBMap, onBack, sidePanel }) {
  const navigate = useNavigate()
  const dbc = charDBMap[char.id]
  const w = charDetail?.weapon||char.weapon
  const relics = charDetail?.relics||char.relics||[]
  const consts = charDetail?.constellations||char.constellations||[]
  const skills = charDetail?.skills||[]
  const props = charDetail?.selected_properties||[]
  const [avatarImg, setAvatarImg] = useState(null)
  const [showAllProps, setShowAllProps] = useState(false)
  const [hoverSkill, setHoverSkill] = useState(null)
  const [hoverCon, setHoverCon] = useState(null)
  const [tipPos, setTipPos] = useState(null) // {top, left} for fixed-position tooltip
  const iconRefs = useRef({})

  useLayoutEffect(() => {
    const active = hoverSkill !== null ? { idx: hoverSkill, isCon: false } : hoverCon !== null ? { idx: hoverCon, isCon: true } : null
    if (!active) { setTipPos(null); return }
    const key = `${active.isCon ? 'c' : 's'}${active.idx}`
    const iconEl = iconRefs.current[key]
    if (!iconEl) { setTipPos(null); return }
    const ir = iconEl.getBoundingClientRect()
    // 临时渲染测量提示窗大小
    const tipW = active.isCon ? Math.min(220, window.innerWidth - 16) : Math.min(200, window.innerWidth - 16)
    const tipH = Math.min(window.innerHeight * 0.6, 300)
    let left = ir.left + ir.width / 2 - tipW / 2
    let top = ir.bottom + 4
    if (left + tipW > window.innerWidth - 8) left = window.innerWidth - tipW - 8
    if (left < 8) left = 8
    if (top + tipH > window.innerHeight - 8) top = ir.top - tipH - 4
    if (top < 8) top = 8
    setTipPos({ top, left, w: tipW, isCon: active.isCon })
  }, [hoverSkill, hoverCon])

  useEffect(() => {
    (async () => {
      const art = dbc?.card_art
      if (art) {
        try {
          const r = await window.electronAPI?.readImage?.(art.replace('.png',''))
          if (r?.data) { setAvatarImg(r.data); return }
        } catch (_) {}
      }
      try {
        const icon = charDetail?.base?.icon || charDetail?.base?.image || char.image
        if (icon) setAvatarImg(icon)
      } catch (_) {}
    })()
  }, [char.id, dbc, charDetail, char.image])

  const elemColor = EC[char.element] || 'text-surface-400'
  const elemBg = EB[char.element] || 'bg-surface-800/60'

  // 格式化颜色描述文字（识别 <color=#XXX>...</color> 格式符）
  const formatDesc = (desc) => {
    if (!desc) return ''
    let html = desc.replace(/\\n/g,'<br/>')
    html = html.replace(/\{LINK#[^}]+\}([^\{<]*)((?:<color[^>]*>[^<]*<\/color>)*)\{\/LINK\}/g,'<b>$1$2</b>')
    html = html.replace(/\{LINK#[^}]+\}/g,'').replace(/\{\/LINK\}/g,'')
    html = html.replace(/<color=#([A-Fa-f0-9]+)>/g,'<span style="color:#$1">')
    html = html.replace(/<\/color>/g,'</span>')
    return html
  }

  // 元素伤害加成类型
  const elemDmgType = ELEM_DMG_MAP[char.element] || 50

  // 合并属性：selected_properties + extra_properties（均保留非零，用于精简模式）
  const extraProps = charDetail?.extra_properties||[]
  const mergedMap = {}
  for (const p of [...props, ...extraProps]) {
    const t = p.property_type
    if (SKIP_PROP_TYPES.has(t)) continue
    if (!PT[t]) continue
    if (mergedMap[t]) continue  // 去重，保留先出现的（selected优先）
    mergedMap[t] = p
  }
  // 全量属性列表（详情模式时全部显示，缺失项造fallback）
  const ALL_BASE_TYPES = [2000,2001,2002,28,999999]
  const ALL_ADV_TYPES = [20,22,26,27,23,80,81]
  const ALL_ELEM_TYPES = [30,40,41,42,43,44,45,46,29,50,51,52,53,54,55,56]
  const PCT_TYPES = new Set([20,22,23,26,27,29,30,40,41,42,43,44,45,46,50,51,52,53,54,55,56,80,81])
  const propMap = mergedMap
  // 精简模式常驻属性（按指定顺序：生命→攻击→防御→精通→元素增伤→暴击→爆伤→治疗→受治疗→充能）
  const alwaysOrder = [2000,2001,2002,28,elemDmgType,20,22,26,27,23]
  const alwaysProps = alwaysOrder.map(t => propMap[t]).filter(Boolean)
  // 详情模式：遍历全量列表，构建显示数组
  const buildDetailRow = (types) => types.map(t => propMap[t] || { property_type: t, final: PCT_TYPES.has(t) ? '0.0%' : '0', base: '', add: '' })

  // 仅有效的战斗技能（skill_type=1 的前3个：普攻、E、Q）
  const combatSkills = skills.filter(s => s.skill_type === 1).slice(0,3)

  return <div className="space-y-2 text-[9px] lg:text-[11px]">
    {!sidePanel && <button onClick={onBack} className="flex items-center gap-0.5 text-[10px] text-surface-400 hover:text-surface-200 mb-1"><ArrowLeft className="w-3 h-3"/>返回</button>}

    {/* 第一行：头像 + 基本信息 + 武器 */}
    <div className="flex items-center gap-2">
      <div className="w-10 h-10 rounded-lg overflow-hidden border border-surface-600/50 shrink-0 bg-surface-800/80 flex items-center justify-center cursor-pointer hover:border-green-500/50"
        onClick={() => { if(char.id) navigate('/characters/' + char.id) }} title="打开角色详情">
        {avatarImg ? <img src={avatarImg} className="w-full h-full object-cover" alt=""/> : <span className="text-lg font-bold text-surface-600">{char.name[0]}</span>}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] font-bold text-surface-200">{char.name}</span>
          {dbc?.name_zh && dbc.name_zh !== char.name && <span className="text-[8px] text-surface-400">{dbc.name_zh}</span>}
          {char.element&&<span className={`px-1 py-0 rounded ${elemBg} ${elemColor} text-[8px]`}>{EN[char.element]}</span>}
        </div>
        <div className="flex items-center gap-1.5 text-[8px] text-surface-400">
          <span>Lv.{char.avatar_level||char.level}</span>
          <span className="text-amber-400">{'★'.repeat(char.rarity)}</span>
        </div>
        <div className="text-[8px] text-surface-400 mt-0.5">
          <span>好感{char.fetter}</span>
          {(charDetail?.base?.actived_constellation_num||char.actived_constellation_num||0) > 0 && <span className="ml-2 text-purple-400">C{charDetail?.base?.actived_constellation_num||char.actived_constellation_num}</span>}
        </div>
      </div>
      {w&&<div className="flex items-center gap-1.5 shrink-0 cursor-pointer hover:bg-surface-700/30 rounded px-1.5 py-0.5"
        onClick={() => { if(w?.id) navigate('/weapons/' + w.id) }} title="打开武器详情">
        <img src={w.icon} className="w-6 h-6 lg:w-8 lg:h-8 rounded" alt=""/>
        <div className="text-[8px] lg:text-[10px] leading-tight">
          <div className="font-medium text-surface-300">{w.name}</div>
          <div className="text-surface-500">Lv.{w.level}</div>
          <div className="flex items-center gap-1"><span className="text-amber-400">{'★'.repeat(w.rarity)}</span><span className="text-purple-400">精{w.affix_level}</span></div>
        </div>
      </div>}
    </div>

    {/* 第二行：技能天赋图标 + 命之座图标 */}
    <div className="flex items-center gap-1.5">
      {/* 技能天赋图标 */}
      {combatSkills.length>0&&combatSkills.map((s,si) => {
        const levels = [s.level, ...(s.is_enhanced ? [s.level] : [])]
        return <div key={si} className="relative">
          <div ref={el=>iconRefs.current['s'+si]=el} className="w-6 h-6 lg:w-7 lg:h-7 rounded-full bg-surface-800/60 flex items-center justify-center cursor-pointer hover:bg-surface-700/60 border border-surface-700/40 overflow-hidden"
            onMouseEnter={() => setHoverSkill(si)}
            onMouseLeave={() => setHoverSkill(null)}>
            {s.icon ? <img src={s.icon} className="w-5 h-5" alt=""/> : <span className="text-[6px]">{si+1}</span>}
          </div>
          <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-surface-900 flex items-center justify-center text-[5px] text-surface-400 border border-surface-600">{s.level}</span>
          {hoverSkill === si && tipPos && !tipPos.isCon && createPortal(<div style={{position:'fixed',top:tipPos.top,left:tipPos.left,width:tipPos.w,zIndex:9999,pointerEvents:'none'}}>
            <div className="bg-surface-800 border border-surface-600 rounded-lg p-2.5 shadow-xl" style={{maxHeight:'60vh',overflow:'auto'}}>
              <div className="text-[10px] font-semibold text-surface-200 mb-1"
                dangerouslySetInnerHTML={{__html: formatDesc(s.name)}}/>
              <div className="text-[8px] text-surface-400 leading-relaxed"
                dangerouslySetInnerHTML={{__html: formatDesc(s.desc)}}/>
            </div>
          </div>, document.body)}
        </div>
      })}
      {/* 分隔线 */}
      {combatSkills.length>0 && consts.length>0 && <span className="text-surface-600 mx-0.5">|</span>}
      {/* 命之座图标 */}
      {consts.length>0&&<div className="flex items-center gap-0.5">
        {consts.map((con,i) => {
          const active = i < (char.actived_constellation_num||0)
          return <div key={i} className="relative">
            <div ref={el=>iconRefs.current['c'+i]=el} className={`w-5 h-5 lg:w-6 lg:h-6 rounded flex items-center justify-center cursor-pointer transition-colors ${active ? elemBg : 'bg-surface-800/40 opacity-40'}`}
              onMouseEnter={() => setHoverCon(i)}
              onMouseLeave={() => setHoverCon(null)}>
              {con.icon ? <img src={con.icon} className={`w-3.5 h-3.5 ${active ? '' : 'grayscale'}`} alt=""/>
                : <span className={`text-[7px] ${active ? elemColor : 'text-surface-500'}`}>{i+1}</span>}
            </div>
            {hoverCon === i && tipPos && tipPos.isCon && createPortal(<div style={{position:'fixed',top:tipPos.top,left:tipPos.left,width:tipPos.w,zIndex:9999,pointerEvents:'none'}}>
              <div className="bg-surface-800 border border-surface-600 rounded-lg p-2.5 shadow-xl" style={{maxHeight:'60vh',overflow:'auto'}}>
                <div className="text-[10px] font-semibold text-surface-200 mb-1"
                  dangerouslySetInnerHTML={{__html: formatDesc(con.name)}}/>
                {con.effect && <div className="text-[8px] text-surface-400 leading-relaxed"
                  dangerouslySetInnerHTML={{__html: formatDesc(con.effect)}}/>}
              </div>
            </div>, document.body)}
          </div>
        })}
      </div>}
    </div>

    {/* 面板属性：常驻显示 + 详请按钮 */}
    {props.length>0&&<div className="rounded-lg bg-surface-800/40 border border-surface-700/30 p-2">
      <div className="flex items-center justify-between mb-1">
        <h4 className="text-[7px] lg:text-[9px] text-surface-500 uppercase">面板属性</h4>
        <button onClick={() => setShowAllProps(!showAllProps)} className="text-[7px] px-1.5 py-0.5 rounded bg-surface-700/50 text-surface-400 hover:text-surface-200 hover:bg-surface-600/50">
          {showAllProps ? '精简' : '详情'}
        </button>
      </div>
      {/* 精简模式：只显示常驻属性 */}
      {!showAllProps && <div className="grid grid-cols-4 gap-1">{alwaysProps.map((p,i)=>{
        const name=PT[p.property_type]||`类型${p.property_type}`;const val=p.final||''
        const isBase = p.property_type===2000||p.property_type===2001||p.property_type===2002
        return <div key={i} className="p-1 rounded bg-surface-800/60 text-center relative group">
          <div className="text-[8px] font-medium text-surface-200">{val}</div>
          <div className="text-[6px] text-surface-500">{name}</div>
          {isBase && p.base!=null && p.add!=null &&
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-0.5 z-10 hidden group-hover:block pointer-events-none">
            <span className="text-[7px] text-surface-400 bg-surface-800 px-1 py-0.5 rounded whitespace-nowrap">={p.base}+{p.add}</span>
          </div>}
        </div>
      })}</div>}
      {/* 详情模式：只显示分类详情（不显示汇总） */}
      {showAllProps && <div className="space-y-1.5">
        <div><div className="text-[7px] lg:text-[9px] text-surface-500 mb-0.5">基础属性</div><div className="grid grid-cols-4 gap-1 lg:gap-1.5">{buildDetailRow(ALL_BASE_TYPES).map((p,i) => <PropCell key={i} p={p} isBase={p.property_type===2000||p.property_type===2001||p.property_type===2002} />)}</div></div>
        <div><div className="text-[7px] lg:text-[9px] text-surface-500 mb-0.5">进阶属性</div><div className="grid grid-cols-4 gap-1 lg:gap-1.5">{buildDetailRow(ALL_ADV_TYPES).map((p,i) => <PropCell key={i} p={p} isBase={false} />)}</div></div>
        <div><div className="text-[7px] lg:text-[9px] text-surface-500 mb-0.5">元素属性</div><div className="grid grid-cols-4 gap-1 lg:gap-1.5">{buildDetailRow(ALL_ELEM_TYPES).map((p,i) => <PropCell key={i} p={p} isBase={false} />)}</div></div>
      </div>}
    </div>}

    {/* 圣遗物：5件并排 */}
    {relics.length>0&&<div className="rounded-lg bg-surface-800/40 border border-surface-700/30 p-2">
      <h4 className="text-[7px] lg:text-[9px] text-surface-500 uppercase mb-1">圣遗物</h4>
      <div className="flex flex-wrap gap-1.5 lg:gap-2">{relics.map((r,i)=>{
        const mainName = r.main_property ? (PT[r.main_property.property_type]||'') : (r.main?.name||'')
        const mainVal = r.main_property ? r.main_property.value : (r.main?.val||'')
        const subs = (r.sub_property_list||r.subs||r.sub||[]).slice(0,5)
        return <div key={i} className="rounded bg-surface-800/60 p-1.5 cursor-pointer hover:bg-surface-700/60 flex-1" style={{flexBasis:'calc(20% - 6px)',minWidth:'95px'}}
          onClick={() => {}} title="打开圣遗物详情">
          <div className="flex items-center gap-0.5 mb-0.5">
            <img src={r.icon} className="w-5 h-5 rounded shrink-0" alt=""/>
            <span className="text-[7px] text-amber-400">{'★'.repeat(r.rarity)}</span>
            <span className="text-[7px] text-surface-500">+{r.level}</span>
          </div>
          <div className="text-[7px] text-surface-400 truncate mb-0.5">{PN[r.pos]||r.name||''}</div>
          <div className="text-[8px] font-medium text-surface-300 truncate">{mainName} {mainVal}</div>
          {subs.map((s,si) => {
            const sName = PT[s.property_type]||s.name||s.stat_name||''
            const sVal = s.value||s.val||s.stat_value||''
            const times = s.times||0
            return <div key={si} className="text-[7px] text-surface-500 leading-snug flex items-center gap-1 whitespace-nowrap">
              <span>{sName} {sVal}</span>
              {times > 0 && <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-amber-500/20 text-[7px] font-medium text-amber-400">{times}</span>}
            </div>
          })}
        </div>
      })}</div>
    </div>}
  </div>
}

// 面板属性单元格（详情模式使用）
function PropCell({ p, isBase }) {
  const name = PT[p.property_type]||''
  const val = p.final||''
  return <div className="p-1 rounded bg-surface-800/60 text-center relative group">
    <div className="text-[8px] lg:text-[10px] font-medium text-surface-200">{val}</div>
    <div className="text-[6px] lg:text-[7px] text-surface-500">{name}</div>
    {isBase && p.base!=null&&p.add!=null&&
    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-0.5 z-10 hidden group-hover:block pointer-events-none">
      <span className="text-[7px] text-surface-400 bg-surface-800 px-1 py-0.5 rounded whitespace-nowrap">={p.base}+{p.add}</span>
    </div>}
  </div>
}

// ─── 挑战整合（深境 + 剧诗 + 危战） ───
function ChallengePanel({ abyss, abyssPrev, rcDetail, hardChallengeDetail, stats, charDBMap }) {
  const [period, setPeriod] = useState('current') // current / previous
  const hc = stats.hard_challenge||{}
  const prevIdx = rcDetail.length > 1 ? 1 : 0
  const curRc = rcDetail[0]
  const prevRc = rcDetail[prevIdx]

  // 深渊上期数据
  const hasPrevAbyss = abyssPrev && abyssPrev.floors?.length > 0

  return <div className="space-y-3">
    {/* 期次切换 */}
    <div className="flex items-center gap-2">
      <span className="text-[9px] text-surface-500">期次</span>
      <div className="flex bg-surface-800/60 rounded-lg p-0.5 gap-0.5">
        <button onClick={()=>setPeriod('current')} className={`px-2 py-0.5 rounded text-[9px] ${period==='current'?'bg-surface-700 text-white':'text-surface-400 hover:text-surface-300'}`}>本期</button>
        <button onClick={()=>setPeriod('previous')} className={`px-2 py-0.5 rounded text-[9px] ${period==='previous'?'bg-surface-700 text-white':'text-surface-400 hover:text-surface-300'}`}>上期</button>
      </div>
    </div>

    {/* 深境螺旋 */}
    {period === 'current' && <SpiralPanel abyss={abyss} charDBMap={charDBMap} />}
    {period === 'previous' && hasPrevAbyss && <SpiralPanel abyss={abyssPrev} charDBMap={charDBMap} />}
    {period === 'previous' && !hasPrevAbyss && <div className="rounded-lg bg-surface-800/40 border border-surface-700/30 p-3 text-center text-[10px] text-surface-500">暂无上期深渊数据（需重新登录爬取）</div>}

    {/* 幻想真境剧诗 */}
    {period === 'current' && curRc && <RoleCombatCard rc={curRc} />}
    {period === 'previous' && prevRc && prevIdx !== 0 && <RoleCombatCard rc={prevRc} />}

    {/* 幽境危战 */}
    {period === 'current' && <HardChallengeCard hc={hc} hcDetail={hardChallengeDetail} hcRaw={stats.hard_challenge} charDBMap={charDBMap} seasonIndex={0} />}
    {period === 'previous' && hardChallengeDetail.length > 1 && <HardChallengeCard hc={hc} hcDetail={hardChallengeDetail} hcRaw={stats.hard_challenge} charDBMap={charDBMap} seasonIndex={1} />}
  </div>
}

function RoleCombatCard({ rc }) {
  const s = rc?.stat || {}
  const schedule = rc?.schedule || {}
  const rl = s.get_medal_round_list || []
  if (!s.max_round_id) return null
  const sd = schedule.start_date_time ? new Date(schedule.start_date_time.year, schedule.start_date_time.month-1, schedule.start_date_time.day) : null
  const ed = schedule.end_date_time ? new Date(schedule.end_date_time.year, schedule.end_date_time.month-1, schedule.end_date_time.day) : null
  const dateStr = sd&&ed ? `${sd.getMonth()+1}/${sd.getDate()} ~ ${ed.getMonth()+1}/${ed.getDate()}` : ''
  return <div className="rounded-lg bg-surface-800/40 border border-surface-700/30 p-2.5">
    <div className="flex items-center justify-between mb-1"><h4 className="text-[10px] font-semibold text-surface-400">幻想真境剧诗</h4>{dateStr&&<span className="text-[8px] text-surface-500">{dateStr}</span>}</div>
    <div className="grid grid-cols-3 gap-1.5 text-[9px]">
      <div className="rounded bg-surface-800/50 p-1 text-center"><div className="font-bold text-purple-400">{s.max_round_id||'?'}</div><div className="text-[7px] text-surface-500">演出</div></div>
      <div className="rounded bg-surface-800/50 p-1 text-center"><div className="font-bold text-amber-400">{s.tarot_finished_cnt||'?'}</div><div className="text-[7px] text-surface-500">圣牌</div></div>
      <div className="rounded bg-surface-800/50 p-1 text-center"><div className="font-bold text-green-400">{rl.length>0?`${rl.reduce((a,b)=>a+b,0)}/${rl.length}`:'?'}</div><div className="text-[7px] text-surface-500">星章</div></div>
      <div className="rounded bg-surface-800/50 p-1 text-center"><div className="font-bold text-surface-200">{s.coin_num||'?'}</div><div className="text-[7px] text-surface-500">幻剧之花</div></div>
      <div className="rounded bg-surface-800/50 p-1 text-center"><div className="font-bold text-surface-200">{s.avatar_bonus_num||'?'}</div><div className="text-[7px] text-surface-500">声援</div></div>
      <div className="rounded bg-surface-800/50 p-1 text-center"><div className="font-bold text-surface-200">{s.rent_cnt||'?'}</div><div className="text-[7px] text-surface-500">助演</div></div>
    </div>
  </div>
}

function HardChallengeCard({ hc, hcDetail, hcRaw, charDBMap, seasonIndex = 0 }) {
  const curSeason = hcDetail?.[seasonIndex]
  const seasonName = curSeason?.schedule?.name || hcRaw?.name || hc?.name || ''
  const difficulty = curSeason?.single?.best?.difficulty || hcRaw?.difficulty || hc?.difficulty || '?'
  const seconds = curSeason?.single?.best?.second
  const challenges = curSeason?.single?.challenge || []
  const [showBlings, setShowBlings] = useState(false)
  const blings = curSeason?.blings || []
  const sd = curSeason?.schedule?.start_date_time ? new Date(curSeason.schedule.start_date_time.year, curSeason.schedule.start_date_time.month-1, curSeason.schedule.start_date_time.day) : null
  const ed = curSeason?.schedule?.end_date_time ? new Date(curSeason.schedule.end_date_time.year, curSeason.schedule.end_date_time.month-1, curSeason.schedule.end_date_time.day) : null
  const dateStr = sd&&ed ? `${sd.getMonth()+1}/${sd.getDate()}~${ed.getMonth()+1}/${ed.getDate()}` : ''

  const bestAvatarInfo=(ch,type)=>{
    const ba = (ch.best_avatar||[]).find(b=>b.type===type)
    if(!ba) return null
    const bling = blings.find(b=>b.avatar_id===ba.avatar_id)
    const name = bling?.name || charDBMap[ba.avatar_id]?.name_zh || ''
    return { name, dps: ba.dps, side_icon: ba.side_icon, avatar_id: ba.avatar_id }
  }

  return <div className="rounded-lg bg-surface-800/40 border border-surface-700/30 p-2.5">
    <div className="flex items-center justify-between mb-1"><h4 className="text-[10px] font-semibold text-surface-400">幽境危战</h4>{dateStr&&<span className="text-[8px] text-surface-500">{dateStr}</span>}</div>
    {curSeason ? <div className="text-[9px]">
      <div className="flex items-center gap-2 mb-2"><span className="font-bold text-red-400">难度{difficulty}</span><span className="text-surface-400">|</span><span className="text-surface-300">{seasonName}</span>{seconds!=null&&<span className="text-surface-500 ml-auto">最佳 {seconds}s</span>}</div>
      {challenges.length > 0 && <div className="space-y-1.5">{challenges.map((ch, ci) => {
        const topDmg = bestAvatarInfo(ch, 1)
        const totalDmg = bestAvatarInfo(ch, 2)
        return <div key={ci} className="rounded bg-surface-800/50 p-1.5">
          <div className="flex items-center gap-1.5 mb-0.5">{ch.monster?.icon&&<img src={ch.monster.icon} className="w-5 h-5 rounded" alt=""/>}<span className="text-surface-300 truncate text-[9px]">{ch.name}</span><span className="text-surface-500 ml-auto text-[8px]">{ch.second}s</span></div>
          <div className="grid grid-cols-2 gap-x-3 text-[8px] text-surface-400 ml-1">
            {topDmg&&<div className="flex items-center gap-1"><span>最强</span>{topDmg.side_icon?<img src={topDmg.side_icon} className="w-3.5 h-3.5 rounded-full" alt=""/>:null}<span className="text-surface-300">{topDmg.name}</span><span className="text-surface-500 ml-1">{Number(topDmg.dps).toLocaleString()}</span></div>}
            {totalDmg&&<div className="flex items-center gap-1"><span>总伤</span>{totalDmg.side_icon?<img src={totalDmg.side_icon} className="w-3.5 h-3.5 rounded-full" alt=""/>:null}<span className="text-surface-300">{totalDmg.name}</span><span className="text-surface-500 ml-1">{Number(totalDmg.dps).toLocaleString()}</span></div>}
          </div>
        </div>
      })}</div>}
      {/* 赋光之人 */}
      <button onClick={()=>setShowBlings(!showBlings)} className="mt-2 flex items-center gap-1 text-[8px] px-2 py-1 rounded bg-surface-700/50 text-surface-400 hover:text-surface-200 hover:bg-surface-600/50 w-full justify-center"><Eye className="w-3 h-3" />为以下角色赋予了「辉光」（{blings.length}位）{showBlings?'▲':'▼'}</button>
      {showBlings && blings.length>0 && <div className="grid grid-cols-4 gap-1.5 mt-1.5">{blings.map((b,bi)=><div key={bi} className="rounded bg-surface-800/50 p-1 text-center">
        {b.side_icon && <img src={b.side_icon} className="w-6 h-6 rounded-full mx-auto border border-surface-600" alt=""/>}
        <div className={`text-[7px] truncate ${EC[b.element]||'text-surface-400'}`}>{b.name}</div>
        <div className="text-[6px] text-amber-400">{'★'.repeat(b.rarity)}</div>
      </div>)}</div>}
    </div> : <div className="text-[9px] text-surface-500">{seasonName ? `难度${difficulty} · ${seasonName}` : '暂无数据'}</div>}
  </div>
}

// ─── 深境螺旋（默认展开） ───
function SpiralPanel({ abyss, charDBMap }) {
  if(!abyss)return<div className="rounded-lg bg-surface-800/40 border border-surface-700/30 p-3 text-center text-[10px] text-surface-500">暂无深渊数据</div>
  const s=abyss.start_time?new Date(Number(abyss.start_time)*1000):null;const e=abyss.end_time?new Date(Number(abyss.end_time)*1000):null
  const totalStar = abyss.total_star || 0
  const rankRow=(label,rank)=>{if(!rank||!rank.length)return null;const r=rank[0];const name=charDBMap[r.avatar_id]?.name_zh||r.avatar_id||'';return<div className="flex items-center gap-1.5 text-[9px]"><img src={r.avatar_icon} className="w-4 h-4 rounded-full border border-surface-600" alt=""/><span className="text-surface-400 min-w-[3em]">{label}</span><span className="text-surface-300">{name}</span><span className="text-surface-500 ml-auto">{r.value!=null?Number(r.value).toLocaleString():'-'}</span></div>}
  return<div className="space-y-2">
    <div className="rounded-lg bg-surface-800/40 border border-surface-700/30 p-2.5">
      <div className="flex justify-between mb-1"><h4 className="text-xs font-semibold">深境螺旋</h4>{s&&<span className="text-[8px] text-surface-500">{s.toLocaleDateString()}~{e?.toLocaleDateString()}</span>}</div>
      <div className="flex flex-col xl:flex-row gap-2">
        <div className="min-w-0">
          <div className="space-y-0.5 text-[9px]"><div className="rounded bg-surface-800/50 px-2 py-1"><span className="text-surface-400">最深 </span><span className="font-bold text-purple-400">{abyss.max_floor}</span></div><div className="rounded bg-surface-800/50 px-2 py-1"><span className="text-surface-400">星数 </span><span className="font-bold text-amber-400">{totalStar}</span></div><div className="rounded bg-surface-800/50 px-2 py-1"><span className="text-surface-400">战斗 </span><span className="font-bold text-surface-200">{abyss.total_battle_times}</span></div></div>
        </div>
        <div className="min-w-0 flex-[2]">
          {rankRow('最多击破',abyss.defeat_rank)}
          {rankRow('最强一击',abyss.damage_rank)}
          {rankRow('最多承伤',abyss.take_damage_rank)}
          {rankRow('E技能',abyss.normal_skill_rank)}
          {rankRow('Q爆发',abyss.energy_skill_rank)}
        </div>
      </div>
      <div className="mt-2">{(abyss.floors||[]).map(f=><FloorCard key={f.index} floor={f} defaultOpen={true}/>)}</div>
    </div>
  </div>
}
function FloorCard({ floor, defaultOpen }) {
  const [o,setO]=useState(defaultOpen!==false);const st=floor.levels?.reduce((s,l)=>s+(l.stars||0),0)||0;const ms=floor.levels?.reduce((s,l)=>s+(l.max_stars||0),0)||0
  return<div className="rounded-lg bg-surface-800/40 border border-surface-700/30 overflow-hidden">
    <button onClick={()=>setO(!o)} className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-surface-800/60"><div className="flex items-center gap-1.5"><Swords className="w-3 h-3 text-surface-400"/><span className="text-[11px] font-semibold">第{floor.index}层</span><span className="text-[9px] text-amber-400">{'★'.repeat(st)}{'☆'.repeat(Math.max(0,ms-st))}</span></div>{o?<ChevronUp className="w-3 h-3 text-surface-400"/>:<ChevronDown className="w-3 h-3 text-surface-400"/>}</button>
    {o&&<div className="px-3 pb-2 space-y-1">
      {floor.levels?.length > 1 ? (
        <div className="grid grid-cols-3 gap-1.5">
          {floor.levels.map((lv, li) => <LevelCard key={li} lv={lv} li={li} />)}
        </div>
      ) : (
        floor.levels?.map((lv, li) => <LevelCard key={li} lv={lv} li={li} />)
      )}
    </div>}
  </div>
}

function LevelCard({ lv, li }) {
  return <div className="rounded bg-surface-800/60 p-1.5">
    <div className="flex justify-between text-[9px]"><span className="text-surface-400">第{lv.index}间</span><span className="text-amber-400">{'★'.repeat(lv.stars)}{'☆'.repeat(Math.max(0,lv.max_stars-lv.stars))}</span></div>
    {lv.battles?.map((b, bi) => <div key={bi} className="text-[8px] mt-0.5"><span className="text-surface-500">{bi===0?'上半':'下半'}</span><div className="flex gap-0.5 mt-0.5">{b.avatars?.map((av, ai) => <div key={ai} className="relative"><img src={av.icon} className="w-5 h-5 rounded-full border border-surface-600" alt=""/><span className="absolute -bottom-1 -right-0 text-[6px] text-surface-400">{av.level}</span></div>)}</div></div>)}
  </div>
}

// ─── 便笺（不变） ───
function DailyPanel({ daily }) {
  if(!daily)return<div className="text-center py-8 text-[10px] text-surface-500">暂无数据</div>
  const expDone=(daily.expeditions||[]).filter(e=>e.status==='Finished').length
  return<div className="space-y-2">
    <Bar label="原粹树脂" c="text-blue-400" bg="bg-blue-500" v={daily.current_resin} m={daily.max_resin} t={daily.resin_recovery_time?'回满 '+Math.floor(Number(daily.resin_recovery_time)/60)+'m':'已满'}/>
    <div className="grid grid-cols-2 gap-2"><Mini label="委托" v={`${daily.finished_task_num}/${daily.total_task_num}`} s={daily.is_extra_task_reward_received?'已领':''}/><Mini label="周本减半" v={`${daily.remain_resin_discount_num}/${daily.resin_discount_num_limit}`} c="text-amber-400"/></div>
    <Bar label="洞天宝钱" c="text-amber-400" bg="bg-amber-500" v={daily.current_home_coin} m={daily.max_home_coin} t={daily.home_coin_recovery_time?Math.floor(Number(daily.home_coin_recovery_time)/3600)+'h 回满':'已满'}/>
    <div className="rounded-lg bg-surface-800/40 border border-surface-700/30 p-2.5"><div className="flex justify-between text-[9px] mb-1"><span className="text-surface-400">探索派遣</span><span className="text-surface-300">{expDone}/{daily.expeditions?.length||0}</span></div><div className="flex gap-1">{(daily.expeditions||[]).map((e,i)=><div key={i} className="relative"><img src={e.avatar_side_icon} className="w-5 h-5 rounded opacity-70" alt=""/>{e.status==='Finished'&&<div className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-green-400"/>}</div>)}</div></div>
    {daily.transformer?.obtained&&<div className="rounded-lg bg-surface-800/40 border border-surface-700/30 p-2.5 flex justify-between text-[9px]"><span className="text-surface-400">参量质变仪</span><span className={daily.transformer.recovery_time?.reached?'text-green-400':'text-surface-500'}>{daily.transformer.recovery_time?.reached?'可用':`${daily.transformer.recovery_time?.Day||'?'}天后`}</span></div>}
    <div className="text-[7px] text-surface-600 text-center">每 60s 自动刷新</div>
  </div>
}
function Bar({label,c,bg,v,m,t}){const p=Math.min((v/m)*100,100);return<div className="rounded-lg bg-surface-800/40 border border-surface-700/30 p-3"><div className="flex justify-between text-[9px] mb-0.5"><span className="text-surface-400">{label}</span><span className="text-surface-500">{t}</span></div><div className="flex items-baseline gap-1 mb-0.5"><span className={`text-lg font-bold ${c}`}>{v}</span><span className="text-[9px] text-surface-500">/{m}</span></div><div className="h-1 rounded-full bg-surface-700 overflow-hidden"><div className={`h-full rounded-full ${bg}`} style={{width:p+'%'}}/></div></div>}
function Mini({label,v,s,c}){return<div className="rounded-lg bg-surface-800/40 border border-surface-700/30 p-2.5"><div className="text-[8px] text-surface-500">{label}</div><div className={`text-sm font-bold ${c||'text-surface-200'}`}>{v}</div>{s&&<div className="text-[8px] text-green-400">{s}</div>}</div>}

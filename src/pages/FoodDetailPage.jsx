import { useState, useEffect, useMemo, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useDb } from '../context/DbContext'
import { useNav } from '../context/NavContext'
import { PageMemoryProvider, usePageMemory } from '../context/PageMemoryContext'
import useDetailState, { useDetailScroll } from '../hooks/useDetailState'
import { useImageDrag } from '../hooks/useImageDrag'
import {
  ArrowLeft, Edit3, UtensilsCrossed, Info, ChevronDown, ChevronRight, Sparkles, Plus, Trash2,
  Package, Lightbulb, MapPin, ChefHat, Layers, Link2, CornerDownRight,
} from 'lucide-react'
import EditModal, { FormInput, FormSelect, SearchSelect, ImagePicker } from '../components/EditModal'
import ColoredText from '../components/ColoredText'
import Lightbox from '../components/Lightbox'
import { findDishCharacter, findDishRelations } from '../utils/dishLinks'
import {
  FOOD_TYPES, FOOD_TYPE_ORDER, FOOD_TYPE_STYLE, FOOD_VARIANT_ORDER, variantMeta,
  variantDisplayName, RARITY_BG_STYLES, RARITY_COLOR, rarityStars,
} from '../utils/foodMeta'

const MATERIAL_TYPE_ZH = {
  character_ascension: '角色突破', weapon_ascension: '武器突破', talent: '天赋书',
  cooking: '食材', local_specialty: '地区特产', common: '通用掉落',
  boss_drop: 'Boss掉落', weekly_boss_drop: '周本掉落', event: '活动材料',
  valuable: '贵重物品',
}

export default function FoodDetailPage() {
  const { id } = useParams()
  return (
    <PageMemoryProvider pageKey={`food_${id}`}>
      <FoodDetailContent />
    </PageMemoryProvider>
  )
}

function FoodDetailContent() {
  const { id } = useParams()
  const { query } = useDb()
  const { backToList, consumeBackToList, push } = useNav()
  const { saveNow } = usePageMemory()
  const [food, setFood] = useState(null)
  const [variants, setVariants] = useState([])
  const [materials, setMaterials] = useState([])
  const [allMaterials, setAllMaterials] = useState([])
  const [loading, setLoading] = useState(true)
  const [editOpen, setEditOpen] = useState(false)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [lightbox, setLightbox] = useState(null)
  const [editMat, setEditMat] = useState(null)
  const [specialCharInfo, setSpecialCharInfo] = useState(null)  // 特殊料理对应的角色（双向跳转用）
  const [dishRelations, setDishRelations] = useState({ prototype: null, derivatives: [] })  // 料理原型 / 衍生特殊料理
  const [activeKind, setActiveKind] = useDetailState('variantKind', 'normal')

  useDetailScroll('food', id)

  useEffect(() => { consumeBackToList(); loadAll() }, [id])

  // 开发者工具栏的食物爬虫写库后通知本页刷新（两边不共享 React 状态）
  useEffect(() => {
    const handler = () => { loadAll() }
    window.addEventListener('food-data-changed', handler)
    return () => window.removeEventListener('food-data-changed', handler)
  }, [id])

  async function loadAll() {
    try {
      const [foodRes, variantRes, matRes, allMatRes] = await Promise.all([
        query('SELECT * FROM foods WHERE id = ?', [id]),
        query('SELECT * FROM food_variants WHERE food_id = ?', [id]),
        query(
          `SELECT fm.*, m.name_zh AS material_name, m.type AS material_type, m.rarity, m.image, m.source AS material_source
           FROM food_materials fm JOIN materials m ON fm.material_id = m.id
           WHERE fm.food_id = ?
           ORDER BY m.rarity DESC, m.name_zh`, [id]
        ),
        query('SELECT id, name_zh, type, rarity, image FROM materials ORDER BY type, rarity DESC, name_zh'),
      ])
      if (foodRes.data?.length > 0) {
        setFood(foodRes.data[0])
        setForm(foodRes.data[0])
        // 特殊料理 ↔ 角色 / 料理原型：命中就给出跳转入口（匹配规则见 utils/dishLinks.js）
        const row = foodRes.data[0]
        const [charInfo, relations] = await Promise.all([
          findDishCharacter(query, row.special_char),
          findDishRelations(query, row),
        ])
        setSpecialCharInfo(charInfo)
        setDishRelations(relations)
      } else {
        setFood(null)
        setSpecialCharInfo(null)
        setDishRelations({ prototype: null, derivatives: [] })
      }
      // 双库模式下 user.db 新插入的关联行是"追加"进结果的（WHERE 只作用于基准库部分），
      // 这里再按 food_id 兜一次，避免串到别的食物上。
      setVariants((variantRes.data || []).filter(v => Number(v.food_id) === Number(id)))
      setMaterials((matRes.data || []).filter(m => Number(m.food_id) === Number(id)))
      setAllMaterials(allMatRes.data || [])
    } catch (e) {
      console.error('Failed to load food:', e)
    } finally {
      setLoading(false)
    }
  }

  // 形态查找表：缺失的形态用普通形态兜底（老数据可能只存了一条）
  const variantByKind = useMemo(() => {
    const map = {}
    for (const v of variants) map[v.kind] = v
    if (!map.normal) map.normal = variants[0] || null
    return map
  }, [variants])

  const availableKinds = useMemo(
    () => FOOD_VARIANT_ORDER.filter(k => variantByKind[k]),
    [variantByKind]
  )

  // 记住的形态在当前条目上不存在时回落到普通形态
  const effectiveKind = availableKinds.includes(activeKind) ? activeKind : (availableKinds.includes('normal') ? 'normal' : availableKinds[0])
  const activeVariant = variantByKind[effectiveKind] || null
  const activeMeta = variantMeta(effectiveKind)

  function handleBack() {
    backToList('/foods', food?.id)
  }

  // ── 特殊料理角色 → 角色板块详情页 ──
  // saveNow 先把本页的位置/状态落盘，从角色页返回时还能回到原处；
  // 走 push 而不是裸 navigate，导航栈里才有这一步（浮动「上一步」可用）。
  function openSpecialChar() {
    if (!specialCharInfo) return
    saveNow()
    push(`/characters/${specialCharInfo.id}`)
  }

  // ── 料理原型 / 衍生特殊料理 → 另一条食物详情页 ──
  // 与上面同理：先落盘本页状态，再 push，返回时回到原处。
  function openFoodLink(target) {
    if (!target?.id) return
    saveNow()
    push(`/foods/${target.id}`)
  }

  // ── 保存食物本体 ──
  async function handleSave() {
    if (saving) return
    setSaving(true)
    try {
      const keys = ['name_zh', 'name_en', 'type', 'category', 'region', 'rarity', 'description_zh',
        'effect', 'source', 'image', 'has_variants', 'recipe_source', 'recipe_price',
        'special_char', 'specialty', 'wiki_title']
      await query(`UPDATE foods SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`,
        [...keys.map(k => form[k] ?? null), food.id])
      setEditOpen(false)
      await loadAll()
    } catch (e) {
      alert('保存失败: ' + (e.message || '未知错误'))
    } finally {
      setSaving(false)
    }
  }

  // ── 烹饪材料增删改 ──
  async function handleSaveMaterial() {
    if (!editMat || !editMat.material_id) return
    if (editMat.id) {
      await query('UPDATE food_materials SET material_id = ?, quantity = ? WHERE id = ?',
        [editMat.material_id, editMat.quantity || '', editMat.id])
    } else {
      await query(
        `INSERT INTO food_materials (food_id, material_id, quantity) VALUES (?, ?, ?)
         ON CONFLICT(food_id, material_id) DO UPDATE SET quantity = excluded.quantity`,
        [food.id, editMat.material_id, editMat.quantity || '']
      )
    }
    setEditMat(null)
    await loadAll()
  }

  async function handleDeleteMaterial(row) {
    if (!confirm(`移除烹饪材料「${row.material_name}」？`)) return
    await query('DELETE FROM food_materials WHERE id = ?', [row.id])
    await loadAll()
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-primary-500 border-t-transparent animate-spin" />
      </div>
    )
  }

  if (!food) {
    return (
      <div className="p-8 text-center text-surface-500">
        食物未找到
        <button onClick={handleBack} className="ml-2 text-primary-400 hover:underline">返回列表</button>
      </div>
    )
  }

  const hasVariants = availableKinds.length >= 2

  return (
    <div className="animate-fade-in">
      {/* ── Banner ── */}
      <div className="relative px-8 py-8 border-b border-surface-800 overflow-hidden">
        <div className="absolute inset-0 bg-surface-900" />
        <div className="relative z-10 flex items-center gap-2 mb-5">
          <button onClick={handleBack}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-[rgb(var(--color-1))] text-[rgb(var(--btn-text-1)_/_0.8)] hover:bg-[rgb(var(--scrollbar-thumb))] hover:text-[rgb(var(--btn-text-4th))] hover:scale-105 transition-all">
            <ArrowLeft className="w-3.5 h-3.5" />返回食物列表
          </button>
        </div>

        <div className="relative z-10 flex items-start justify-between gap-6 flex-wrap">
          <div className="flex items-start gap-6 min-w-0">
            {/* 主图随当前形态切换配色与滤镜 */}
            <div
              className={`w-28 h-28 rounded-2xl border-2 flex items-center justify-center flex-shrink-0 overflow-hidden shadow-lg cursor-pointer hover:scale-105 transition-transform ring-1 ${activeMeta.border} ${activeMeta.ring}`}
              style={{
                backgroundImage: `url(./background/${food.rarity || 1}star.webp)`,
                backgroundSize: 'cover', backgroundPosition: 'center',
                boxShadow: `0 8px 28px -8px ${activeMeta.glow}`,
              }}
              onClick={() => activeVariant?.image && setLightbox({ filename: activeVariant.image, label: activeVariant.name_zh })}
            >
              {activeVariant?.image
                ? <LocalImage filename={activeVariant.image} className="w-20 h-20 object-contain drop-shadow-md" style={{ filter: activeMeta.filter }} />
                : <UtensilsCrossed className="w-10 h-10 text-surface-500" />}
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-3 mb-1 flex-wrap">
                <h1 className="text-2xl font-bold tracking-tight">{food.name_zh}</h1>
                <span className={`text-sm ${RARITY_COLOR[food.rarity] || 'text-surface-400'}`}>{rarityStars(food.rarity)}</span>
                <span className={`inline-block text-[11px] px-2 py-0.5 rounded-full border ${FOOD_TYPE_STYLE[food.type] || FOOD_TYPE_STYLE.other}`}>
                  {FOOD_TYPES[food.type] || food.type}
                </span>
                {hasVariants && (
                  <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-surface-700/70 text-surface-300 border border-surface-600">
                    <Layers className="w-3 h-3" />三形态
                  </span>
                )}
              </div>
              {food.name_en && <p className="text-sm text-surface-400 mb-1">{food.name_en}</p>}
              <div className="flex items-center gap-3 text-[11px] text-surface-500 flex-wrap">
                {food.category && <span className="flex items-center gap-1"><Sparkles className="w-3 h-3" />{food.category}</span>}
                {food.region && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{food.region}</span>}
                {food.special_char && (specialCharInfo ? (
                  <button onClick={openSpecialChar} title={`查看角色「${specialCharInfo.name_zh}」`}
                    className="-mx-1.5 px-1.5 rounded flex items-center gap-1 text-fuchsia-300 hover:text-fuchsia-200 hover:bg-fuchsia-500/10 transition-colors">
                    <ChefHat className="w-3 h-3" />{food.special_char}<ChevronRight className="w-3 h-3 opacity-70" />
                  </button>
                ) : (
                  <span className="flex items-center gap-1"><ChefHat className="w-3 h-3" />{food.special_char}</span>
                ))}
                {dishRelations.prototype && (
                  <button onClick={() => openFoodLink(dishRelations.prototype)}
                    title={`料理原型：「${dishRelations.prototype.name_zh}」`}
                    className="-mx-1.5 px-1.5 rounded flex items-center gap-1 text-amber-300 hover:text-amber-200 hover:bg-amber-500/10 transition-colors">
                    <CornerDownRight className="w-3 h-3" />原型 {dishRelations.prototype.name_zh}<ChevronRight className="w-3 h-3 opacity-70" />
                  </button>
                )}
                <span>{materials.length} 种烹饪材料</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <button onClick={() => { setForm({ ...food }); setEditOpen(true) }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-[rgb(var(--color-1))] text-[rgb(var(--btn-text-1)_/_0.8)] hover:bg-[rgb(var(--scrollbar-thumb))] hover:text-[rgb(var(--btn-text-4th))] hover:scale-105 transition-all">
              <Edit3 className="w-3.5 h-3.5" />编辑
            </button>
          </div>
        </div>
      </div>

      <div className="px-8 py-6 space-y-8 max-w-6xl">
        {/* ── 三形态 ── */}
        {hasVariants ? (
          <SectionCard icon={<Layers className="w-4 h-4" />} title="形态"
            extra={<span className="text-[11px] text-surface-500">同一道菜的三种烹饪结果，点击卡片查看详情</span>}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
              {FOOD_VARIANT_ORDER.filter(k => variantByKind[k]).map(k => {
                const v = variantByKind[k]
                const m = variantMeta(k)
                const active = k === effectiveKind
                return (
                  <button key={k} onClick={() => setActiveKind(k)}
                    className={`text-left rounded-xl border-2 overflow-hidden transition-all duration-200
                      ${active ? `${m.border} ring-2 ${m.ring} scale-[1.015]` : 'border-surface-700/60 hover:border-surface-500'}`}
                    style={active ? { boxShadow: `0 10px 30px -12px ${m.glow}` } : undefined}>
                    <div className="flex items-center gap-3 p-3">
                      <div className="w-16 h-16 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden"
                        style={RARITY_BG_STYLES[v.rarity || food.rarity || 1]}>
                        {v.image
                          ? <LocalImage filename={v.image} className="w-12 h-12 object-contain drop-shadow" style={{ filter: m.filter }} />
                          : <UtensilsCrossed className="w-6 h-6 text-surface-500" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className={`w-2 h-2 rounded-full ${m.dot}`} />
                          <span className={`text-[10px] ${m.text}`}>{m.label}</span>
                          {active && <span className={`text-[9px] px-1 rounded ${m.chip} border`}>当前</span>}
                        </div>
                        <p className={`text-xs font-semibold truncate ${active ? m.textStrong : 'text-surface-200'}`}>
                          {v.name_zh || variantDisplayName(food.name_zh, k)}
                        </p>
                        <p className="text-[10px] text-surface-500 truncate mt-0.5">{m.desc}</p>
                      </div>
                    </div>
                    <div className="px-3 pb-3 -mt-1">
                      <p className="text-[11px] text-surface-400 line-clamp-2 leading-relaxed">
                        <ColoredText text={v.effect || '暂无效果说明'} />
                      </p>
                    </div>
                  </button>
                )
              })}
            </div>

            {/* 选中形态的完整信息 */}
            {activeVariant && (
              <div className={`rounded-xl border ${activeMeta.border} bg-surface-800/30 overflow-hidden`}>
                <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-4 p-4">
                  <div>
                    {/* 绝对定位的内层给出确定宽高：百分比高度在 aspect-square 父级里会塌成 0 */}
                    <div className="aspect-square rounded-xl overflow-hidden relative border border-surface-700/60"
                      style={{ ...RARITY_BG_STYLES[activeVariant.rarity || food.rarity || 1], boxShadow: `inset 0 0 40px -10px ${activeMeta.glow}` }}>
                      <div className="absolute inset-[11%] flex items-center justify-center">
                        {activeVariant.image
                          ? <LocalImage filename={activeVariant.image} className="w-full h-full object-contain drop-shadow-lg" style={{ filter: activeMeta.filter }} />
                          : <UtensilsCrossed className="w-10 h-10 text-surface-500" />}
                      </div>
                    </div>
                    <p className={`text-center text-xs font-semibold mt-2 ${activeMeta.textStrong}`}>
                      {activeVariant.name_zh || variantDisplayName(food.name_zh, effectiveKind)}
                    </p>
                    <p className="text-center text-[10px] text-surface-500">{activeMeta.label} · {activeMeta.desc}</p>
                  </div>
                  <div className="space-y-3 min-w-0">
                    <div>
                      <h4 className={`text-[11px] font-semibold mb-1 ${activeMeta.text}`}>简介</h4>
                      <p className="text-sm text-surface-300 leading-relaxed whitespace-pre-line">
                        <ColoredText text={activeVariant.description_zh || '暂无简介'} />
                      </p>
                    </div>
                    {activeVariant.effect && (
                      <div>
                        <h4 className={`text-[11px] font-semibold mb-1 ${activeMeta.text}`}>效果</h4>
                        <p className="text-sm text-surface-300 leading-relaxed whitespace-pre-line">
                          <ColoredText text={activeVariant.effect} />
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </SectionCard>
        ) : (
          <SectionCard icon={<Info className="w-4 h-4" />} title="简介">
            <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-4">
              <div className="aspect-square rounded-xl overflow-hidden relative border border-surface-700/60 w-full max-w-[200px]"
                style={RARITY_BG_STYLES[food.rarity || 1]}>
                <div className="absolute inset-[11%] flex items-center justify-center">
                  {food.image
                    ? <LocalImage filename={food.image} className="w-full h-full object-contain drop-shadow-lg" />
                    : <UtensilsCrossed className="w-10 h-10 text-surface-500" />}
                </div>
              </div>
              <div className="space-y-3 min-w-0">
                <p className="text-sm text-surface-300 leading-relaxed whitespace-pre-line">
                  <ColoredText text={food.description_zh || '暂无简介'} />
                </p>
                {food.effect && (
                  <div>
                    <h4 className="text-[11px] font-semibold mb-1 text-emerald-300">效果</h4>
                    <p className="text-sm text-surface-300 leading-relaxed whitespace-pre-line"><ColoredText text={food.effect} /></p>
                  </div>
                )}
                {food.specialty && (
                  <div>
                    <h4 className="text-[11px] font-semibold mb-1 text-fuchsia-300">特殊料理效果</h4>
                    <p className="text-sm text-surface-300 leading-relaxed"><ColoredText text={food.specialty} /></p>
                  </div>
                )}
              </div>
            </div>
          </SectionCard>
        )}

        {/* ── 料理关系（特殊料理 ↔ 料理原型，双向） ──
            两个方向都为空时不渲染：普通料理、以及找不到关联的历史条目不必占位。 */}
        {(dishRelations.prototype || dishRelations.derivatives.length > 0) && (
          <SectionCard icon={<Link2 className="w-4 h-4" />} title="料理关系"
            extra={<span className="text-[11px] text-surface-500">点击卡片可跳转到对应料理</span>}>
            {dishRelations.prototype && (
              <div className={dishRelations.derivatives.length > 0 ? 'mb-4' : ''}>
                <h4 className="text-[11px] font-semibold text-surface-400 mb-2 flex items-center gap-1.5">
                  <CornerDownRight className="w-3 h-3 text-amber-300" />料理原型
                  <span className="text-surface-600 font-normal">这道特殊料理由它变化而来</span>
                </h4>
                <FoodLinkCard food={dishRelations.prototype} onClick={() => openFoodLink(dishRelations.prototype)} />
              </div>
            )}
            {dishRelations.derivatives.length > 0 && (
              <div>
                <h4 className="text-[11px] font-semibold text-surface-400 mb-2 flex items-center gap-1.5">
                  <Sparkles className="w-3 h-3 text-fuchsia-300" />衍生特殊料理
                  <span className="text-surface-600 font-normal">
                    {food.special_char ? `${food.special_char}用这道菜做出的特殊料理` : '用这道菜做出的特殊料理'}
                  </span>
                </h4>
                <div className="flex flex-wrap gap-2">
                  {dishRelations.derivatives.map(d => (
                    <FoodLinkCard key={d.id} food={d} label="特殊料理" onClick={() => openFoodLink(d)} />
                  ))}
                </div>
              </div>
            )}
          </SectionCard>
        )}

        {/* ── 烹饪材料 ── */}
        <SectionCard icon={<ChefHat className="w-4 h-4" />} title="烹饪材料"
          extra={
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-surface-500">{materials.length} 种</span>
              <button onClick={() => setEditMat({ material_id: '', quantity: '' })}
                className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] text-primary-300 hover:bg-primary-500/10 transition-colors">
                <Plus className="w-3 h-3" />添加
              </button>
            </div>
          }>
          {materials.length > 0 ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
                {materials.map(m => (
                  <MaterialChip key={m.id} material={m}
                    onEdit={() => setEditMat({ ...m })} onDelete={() => handleDeleteMaterial(m)} />
                ))}
              </div>
              {/* 合计（同一道菜的配方里同名材料不会重复，直接求和即可） */}
              <p className="mt-3 text-[11px] text-surface-500">
                共 {materials.reduce((sum, m) => sum + (Number(m.quantity) || 0), 0)} 份材料 ·
                点击材料可跳转到材料板块
              </p>
            </>
          ) : (
            <div className="py-6 text-center">
              <Package className="w-7 h-7 mx-auto mb-2 text-surface-600" />
              <p className="text-xs text-surface-500">
                暂无烹饪材料数据（该条目可能无法烹饪，或 wiki 尚未收录配方）
              </p>
              <p className="mt-1.5 text-[11px] text-surface-600">
                可在开发者工具栏用「食物爬虫」补齐
              </p>
            </div>
          )}
        </SectionCard>

        {/* ── 详细信息 ── */}
        <SectionCard icon={<Info className="w-4 h-4" />} title="详细信息">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <StatBadge label="类型" value={FOOD_TYPES[food.type] || food.type || '-'} />
            <StatBadge label="稀有度" value={rarityStars(food.rarity)} />
            <StatBadge label="功效类别" value={food.category || '-'} />
            <StatBadge label="地区" value={food.region || '-'} />
            <StatBadge label="获取方式" value={food.source || '-'} />
            <StatBadge label="食谱获取" value={food.recipe_source || '-'} />
            <StatBadge label="食谱价格" value={food.recipe_price || '-'} />
            <StatBadge label="特殊料理角色" value={food.special_char || '-'}
              onClick={specialCharInfo ? openSpecialChar : undefined}
              title={specialCharInfo ? `查看角色「${specialCharInfo.name_zh}」` : undefined} />
          </div>
          {food.specialty && (
            <div className="mt-3">
              <h4 className="text-[11px] font-semibold mb-1 text-surface-400">特殊料理</h4>
              <p className="text-xs text-surface-300 leading-relaxed"><ColoredText text={food.specialty} /></p>
            </div>
          )}
          <div className="mt-4 pt-3 border-t border-surface-800 flex items-center gap-2 text-[10px] text-surface-600">
            <Lightbulb className="w-3 h-3" />
            三形态（奇怪的 / 普通 / 美味的）在游戏内共用同一张图标，本站以配色与滤镜区分；简介与效果分别取自 wiki。
          </div>
        </SectionCard>
      </div>

      {/* ── 编辑食物 ── */}
      <EditModal isOpen={editOpen} onClose={() => setEditOpen(false)} onSave={handleSave} saving={saving}
        title={`编辑食物 - ${food.name_zh}`}>
        <div className="grid grid-cols-2 gap-x-6">
          <FormInput label="中文名" value={form.name_zh} onChange={v => setForm({ ...form, name_zh: v })} />
          <FormInput label="英文名" value={form.name_en} onChange={v => setForm({ ...form, name_en: v })} />
          <FormSelect label="类型" value={form.type} onChange={v => setForm({ ...form, type: v })}
            options={FOOD_TYPE_ORDER.map(k => ({ value: k, label: FOOD_TYPES[k] }))} />
          <FormInput label="稀有度 (0-5)" value={form.rarity} onChange={v => setForm({ ...form, rarity: Number(v) })} type="number" />
          <FormSelect label="三形态" value={form.has_variants ? '1' : '0'}
            onChange={v => setForm({ ...form, has_variants: Number(v) })}
            options={[{ value: '0', label: '单形态' }, { value: '1', label: '奇怪的 / 普通 / 美味的' }]} />
          <FormInput label="功效类别" value={form.category} onChange={v => setForm({ ...form, category: v })} />
          <FormInput label="地区" value={form.region} onChange={v => setForm({ ...form, region: v })} />
          <FormInput label="特殊料理角色" value={form.special_char} onChange={v => setForm({ ...form, special_char: v })} />
        </div>
        <FormInput label="简介（普通形态）" value={form.description_zh} onChange={v => setForm({ ...form, description_zh: v })} multiline />
        <FormInput label="效果（普通形态）" value={form.effect} onChange={v => setForm({ ...form, effect: v })} multiline />
        <div className="grid grid-cols-2 gap-x-6">
          <FormInput label="获取方式" value={form.source} onChange={v => setForm({ ...form, source: v })} />
          <FormInput label="食谱获取" value={form.recipe_source} onChange={v => setForm({ ...form, recipe_source: v })} />
        </div>
        <ImagePicker label="食物图片" currentImage={form.image} onSelect={v => setForm({ ...form, image: v })} onRemove={() => setForm({ ...form, image: null })} />
      </EditModal>

      {/* ── 编辑烹饪材料 ── */}
      <EditModal isOpen={!!editMat} onClose={() => setEditMat(null)} onSave={handleSaveMaterial}
        title={editMat?.id ? '编辑烹饪材料' : '添加烹饪材料'}>
        {editMat && (
          <>
            <SearchSelect label="材料" value={editMat.material_id}
              onChange={v => setEditMat({ ...editMat, material_id: v ? Number(v) : '' })}
              options={allMaterials.map(m => ({
                value: m.id,
                label: `${m.name_zh}${m.type ? `（${MATERIAL_TYPE_ZH[m.type] || m.type}）` : ''}`,
                image: m.image,
              }))} />
            <FormInput label="数量" value={editMat.quantity} onChange={v => setEditMat({ ...editMat, quantity: v })} placeholder="例: 3" />
          </>
        )}
      </EditModal>

      {lightbox && <Lightbox filename={lightbox.filename} label={lightbox.label} onClose={() => setLightbox(null)} />}
    </div>
  )
}

// ── 子组件 ──

function SectionCard({ icon, title, children, extra }) {
  const [collapsed, setCollapsed] = useState(false)
  return (
    <div className="rounded-xl border border-surface-800 bg-surface-900/50 overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3 border-b border-surface-800 hover:bg-surface-800/30 transition-colors">
        <button onClick={() => setCollapsed(!collapsed)} className="flex items-center gap-2 flex-1 min-w-0 text-left select-none">
          <ChevronDown className={`w-3.5 h-3.5 text-surface-500 transition-transform flex-shrink-0 ${collapsed ? '-rotate-90' : ''}`} />
          <span className="text-primary-400">{icon}</span>
          <h2 className="text-sm font-semibold">{title}</h2>
        </button>
        {extra}
      </div>
      {!collapsed && <div className="px-5 py-4">{children}</div>}
    </div>
  )
}

function StatBadge({ label, value, onClick, title }) {
  const inner = (
    <>
      <span className="text-surface-500">{label}</span>
      <p className="text-white font-medium mt-0.5 text-sm break-words">
        {value}
        {onClick && <ChevronRight className="w-3 h-3 inline-block ml-0.5 -mt-0.5 opacity-60" />}
      </p>
    </>
  )
  // 可跳转的用真 <button>（键盘可达），不可跳转的保持 <div>
  if (onClick) {
    return (
      <button type="button" onClick={onClick} title={title}
        className="bg-surface-800/50 rounded-lg px-3 py-2 min-w-0 w-full text-left hover:bg-surface-800 transition-colors">
        {inner}
      </button>
    )
  }
  return <div className="bg-surface-800/50 rounded-lg px-3 py-2 min-w-0">{inner}</div>
}

const RARITY_BORDER = {
  0: 'border-surface-600/50', 1: 'border-gray-500/30', 2: 'border-green-500/30',
  3: 'border-blue-500/30', 4: 'border-purple-500/30', 5: 'border-amber-500/40',
}

/** 料理关系（原型 / 衍生特殊料理）里的可跳转卡片 */
function FoodLinkCard({ food, label, onClick }) {
  if (!food) return null
  return (
    <button type="button" onClick={onClick} title={`查看「${food.name_zh}」`}
      className="flex items-center gap-3 px-3 py-2 rounded-lg bg-surface-800/50 border border-surface-700/60
                 hover:border-primary-500/50 hover:bg-surface-800 transition-colors text-left
                 w-full sm:w-auto sm:min-w-[230px] sm:max-w-[320px]">
      <div className="w-11 h-11 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden"
        style={RARITY_BG_STYLES[food.rarity || 1]}>
        {food.image
          ? <LocalImage filename={food.image} className="w-9 h-9 object-contain drop-shadow" />
          : <UtensilsCrossed className="w-5 h-5 text-surface-500" />}
      </div>
      <div className="min-w-0 flex-1">
        {label && <p className="text-[10px] text-surface-500 mb-0.5">{label}</p>}
        <p className="text-xs font-medium text-surface-200 truncate">{food.name_zh}</p>
        <p className="text-[10px] text-surface-500 flex items-center gap-1.5 mt-0.5">
          <span className={`px-1.5 py-0.5 rounded-full border ${FOOD_TYPE_STYLE[food.type] || FOOD_TYPE_STYLE.other}`}>
            {FOOD_TYPES[food.type] || food.type}
          </span>
          <span className={RARITY_COLOR[food.rarity] || 'text-surface-400'}>{rarityStars(food.rarity)}</span>
        </p>
      </div>
      <ChevronRight className="w-4 h-4 text-surface-500 flex-shrink-0" />
    </button>
  )
}

function MaterialChip({ material, onEdit, onDelete }) {
  const [src, setSrc] = useState(null)
  const { readImage } = useDb()
  const { savePage } = useNav()
  const { saveNow } = usePageMemory()
  const navigate = useNavigate()
  const handleDrag = useImageDrag(material.image)

  useEffect(() => {
    let cancelled = false
    if (!material.image) { setSrc(null); return undefined }
    ;(async () => {
      const data = await readImage(material.image)
      if (!cancelled && data) setSrc(data)
    })()
    return () => { cancelled = true }
  }, [material.image, readImage])

  function openMaterial() {
    if (!material.material_id) return
    saveNow()
    savePage('materials')
    navigate(`/materials/${material.material_id}`)
  }

  return (
    <div
      onClick={openMaterial}
      className={`flex items-center gap-2.5 px-3 py-2 rounded-lg bg-surface-800/50 border ${RARITY_BORDER[material.rarity] || 'border-surface-700/50'} group relative cursor-pointer hover:bg-surface-800 hover:border-primary-500/40 transition-colors`}
    >
      {src
        ? <img src={src} alt="" className="w-9 h-9 rounded object-contain flex-shrink-0" draggable onDragStart={handleDrag} />
        : <div className="w-9 h-9 rounded bg-surface-700 flex items-center justify-center flex-shrink-0"><Package className="w-4 h-4 text-surface-500" /></div>}
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-white truncate">{material.material_name || material.material_id}</p>
        <p className="text-[10px] text-surface-500 truncate">{MATERIAL_TYPE_ZH[material.material_type] || material.material_type || '-'}</p>
      </div>
      {material.quantity !== '' && material.quantity != null && (
        <span className="text-sm font-semibold text-primary-300 flex-shrink-0">×{material.quantity}</span>
      )}
      <div className="absolute top-1 right-1 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        {onEdit && (
          <button onClick={e => { e.stopPropagation(); onEdit() }}
            className="p-1 rounded bg-surface-900/80 text-surface-400 hover:text-primary-400 transition-colors" title="编辑">
            <Edit3 className="w-3 h-3" />
          </button>
        )}
        {onDelete && (
          <button onClick={e => { e.stopPropagation(); onDelete() }}
            className="p-1 rounded bg-surface-900/80 text-surface-400 hover:text-red-400 transition-colors" title="移除">
            <Trash2 className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  )
}

function LocalImage({ filename, className = '', style }) {
  const [src, setSrc] = useState(null)
  const { readImage } = useDb()
  const handleDrag = useImageDrag(filename)
  useEffect(() => {
    let cancelled = false
    if (!filename) { setSrc(null); return undefined }
    ;(async () => {
      const data = await readImage(filename)
      if (!cancelled && data) setSrc(data)
    })()
    return () => { cancelled = true }
  }, [filename, readImage])
  if (!src) return <div className={`${className} bg-surface-700/40 rounded`} />
  return <img src={src} alt="" className={className} style={style} draggable onDragStart={handleDrag} />
}

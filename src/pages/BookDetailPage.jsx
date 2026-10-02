import { useState, useEffect, useMemo, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { useDb } from '../context/DbContext'
import { useNav } from '../context/NavContext'
import { PageMemoryProvider, usePageMemory } from '../context/PageMemoryContext'
import useDetailState, { useDetailScroll } from '../hooks/useDetailState'
import { useImageDrag } from '../hooks/useImageDrag'
import {
  ArrowLeft, Edit3, BookMarked, BookOpen, Info, ChevronDown, ChevronRight,
  MapPin, Layers, Calendar, User, MapPinned, ScrollText, Plus, Trash2,
} from 'lucide-react'
import EditModal, { FormInput, FormSelect, ImagePicker } from '../components/EditModal'
import ColoredText from '../components/ColoredText'
import Lightbox from '../components/Lightbox'
import Reader from '../components/Reader'
import { GenreBadge, CountryBadge } from './BooksPage'
import { BOOK_GENRES, BOOK_COUNTRIES, BOOK_SOURCE_TYPES, splitMulti } from '../utils/bookMeta'
import { RARITY_BG_STYLES, RARITY_COLOR, rarityStars } from '../utils/rarity'

export default function BookDetailPage() {
  const { id } = useParams()
  return (
    <PageMemoryProvider pageKey={`book_${id}`}>
      <BookDetailContent />
    </PageMemoryProvider>
  )
}

function BookDetailContent() {
  const { id } = useParams()
  const { query } = useDb()
  const { backToList, consumeBackToList } = useNav()
  const { saveNow } = usePageMemory()
  const [book, setBook] = useState(null)
  const [volumes, setVolumes] = useState([])
  const [loading, setLoading] = useState(true)
  const [editOpen, setEditOpen] = useState(false)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [lightbox, setLightbox] = useState(null)
  const [readerOpen, setReaderOpen] = useState(false)
  const [readerStart, setReaderStart] = useState(0)
  const [editVol, setEditVol] = useState(null)
  const [visible, setVisible] = useDetailState('sections', { volumes: true, intro: true, detail: true })

  useDetailScroll('book', id)

  useEffect(() => { consumeBackToList(); loadAll() }, [id])

  // 开发者工具栏的书籍爬虫写库后通知本页刷新（两边不共享 React 状态）
  useEffect(() => {
    const handler = () => { loadAll() }
    window.addEventListener('book-data-changed', handler)
    return () => window.removeEventListener('book-data-changed', handler)
  }, [id])

  async function loadAll() {
    try {
      const [bookRes, volRes] = await Promise.all([
        query('SELECT * FROM books WHERE id = ?', [id]),
        query('SELECT * FROM book_volumes WHERE book_id = ? ORDER BY volume_no', [id]),
      ])
      const row = bookRes.data && bookRes.data.length > 0 ? bookRes.data[0] : null
      setBook(row)
      setForm(row || {})
      // 双库模式下 user.db 新插入的关联行是"追加"进结果的（WHERE 只作用于基准库部分），
      // 这里再按 book_id 兜一次，避免串到别的书上。
      const vols = (volRes.data || []).filter(v => Number(v.book_id) === Number(id))
      vols.sort((a, b) => (Number(a.volume_no) || 0) - (Number(b.volume_no) || 0))
      setVolumes(vols)
    } catch (e) {
      console.error('Failed to load book:', e)
    } finally {
      setLoading(false)
    }
  }

  function handleBack() {
    backToList('/books', book?.id)
  }

  // 阅读器章节：卷名 + 该卷获取地点作为副标题
  const chapters = useMemo(() => volumes.map((v, i) => ({
    id: v.id != null ? v.id : i,
    title: v.title_zh || `卷${v.volume_no || i + 1}`,
    subtitle: v.source ? `获取：${String(v.source).split('\n')[0]}` : '',
    content: v.content || '',
  })), [volumes])

  const bodyCount = volumes.filter(v => v.content && String(v.content).trim()).length

  function openReader(index = 0) {
    setReaderStart(index)
    setReaderOpen(true)
  }

  // ── 保存书籍本体 ──
  async function handleSave() {
    if (saving) return
    setSaving(true)
    try {
      const keys = ['name_zh', 'name_en', 'genre', 'country', 'version', 'rarity', 'description_zh',
        'author', 'source', 'source_type', 'image', 'illustrated', 'related_chars', 'volume_count']
      await query(`UPDATE books SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`,
        [...keys.map(k => form[k] ?? null), book.id])
      setEditOpen(false)
      await loadAll()
    } catch (e) {
      alert('保存失败: ' + (e.message || '未知错误'))
    } finally {
      setSaving(false)
    }
  }

  // ── 卷增删改 ──
  function openAddVolume() {
    const nextNo = volumes.length > 0 ? Math.max(...volumes.map(v => Number(v.volume_no) || 0)) + 1 : 1
    setEditVol({ book_id: Number(id), volume_no: nextNo, title_zh: `${book?.name_zh || ''}·卷${nextNo}`, description_zh: '', content: '', source: '', author: '' })
  }

  async function handleSaveVolume() {
    if (!editVol) return
    const keys = ['volume_no', 'title_zh', 'description_zh', 'content', 'source', 'author']
    if (editVol.id) {
      await query(`UPDATE book_volumes SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`,
        [...keys.map(k => editVol[k] ?? null), editVol.id])
    } else {
      await query(
        `INSERT INTO book_volumes (book_id, ${keys.join(', ')}, content_source)
         VALUES (?, ${keys.map(() => '?').join(', ')}, 'manual')`,
        [Number(id), ...keys.map(k => editVol[k] ?? null)]
      )
    }
    setEditVol(null)
    await loadAll()
  }

  async function handleDeleteVolume(row) {
    if (!confirm(`删除「${row.title_zh || `卷${row.volume_no}`}」？`)) return
    await query('DELETE FROM book_volumes WHERE id = ?', [row.id])
    await loadAll()
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-primary-500 border-t-transparent animate-spin" />
      </div>
    )
  }

  if (!book) {
    return (
      <div className="p-8 text-center text-surface-500">
        书籍未找到
        <button onClick={handleBack} className="ml-2 text-primary-400 hover:underline">返回列表</button>
      </div>
    )
  }

  const genres = splitMulti(book.genre)
  const countries = splitMulti(book.country)
  const versions = splitMulti(book.version)

  return (
    <div className="animate-fade-in">
      {/* ── Banner ── */}
      <div className="relative px-8 py-8 border-b border-surface-800 overflow-hidden">
        <div className="absolute inset-0 bg-surface-900" />
        <div className="relative z-10 flex items-center gap-2 mb-5">
          <button onClick={handleBack}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-[rgb(var(--color-1))] text-[rgb(var(--btn-text-1)_/_0.8)] hover:bg-[rgb(var(--scrollbar-thumb))] hover:text-[rgb(var(--btn-text-4th))] hover:scale-105 transition-all">
            <ArrowLeft className="w-3.5 h-3.5" />返回书籍列表
          </button>
        </div>

        <div className="relative z-10 flex items-start justify-between gap-6 flex-wrap">
          <div className="flex items-start gap-6 min-w-0">
            <div
              className="w-28 h-28 rounded-2xl border-2 border-surface-600/60 flex items-center justify-center flex-shrink-0 overflow-hidden shadow-lg cursor-pointer hover:scale-105 transition-transform"
              style={{ ...(RARITY_BG_STYLES[book.rarity || 0]), boxShadow: '0 8px 28px -10px rgba(0,0,0,0.6)' }}
              onClick={() => book.image && setLightbox({ filename: book.image, label: book.name_zh })}
            >
              <LocalImage filename={book.image} className="w-20 h-20 object-contain drop-shadow-md" />
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-3 mb-1 flex-wrap">
                <h1 className="text-2xl font-bold tracking-tight">{book.name_zh}</h1>
                <span className={`text-sm ${RARITY_COLOR[book.rarity] || 'text-surface-400'}`}>{rarityStars(book.rarity, 5)}</span>
                <GenreBadge genre={book.genre} />
                {book.illustrated ? (
                  <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-primary-500/12 text-primary-300 border border-primary-500/25">
                    <BookMarked className="w-3 h-3" />图鉴
                  </span>
                ) : null}
              </div>
              {book.name_en && <p className="text-sm text-surface-400 mb-1">{book.name_en}</p>}
              <div className="flex items-center gap-3 text-[11px] text-surface-500 flex-wrap">
                {countries.length > 0 && <CountryBadge country={book.country} />}
                {versions.length > 0 && (
                  <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{versions.join(' / ')}</span>
                )}
                {book.author && <span className="flex items-center gap-1"><User className="w-3 h-3" />{book.author}</span>}
                <span className="flex items-center gap-1"><Layers className="w-3 h-3" />{volumes.length} 卷</span>
                <span>{bodyCount}/{volumes.length} 卷有正文</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <button onClick={() => openReader(0)} disabled={volumes.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-[rgb(var(--color-1))] text-[rgb(var(--btn-text-1)_/_0.8)] hover:bg-[rgb(var(--scrollbar-thumb))] hover:text-[rgb(var(--btn-text-4th))] hover:scale-105 disabled:opacity-40 disabled:hover:scale-100 transition-all">
              <BookOpen className="w-3.5 h-3.5" />阅读
            </button>
            <button onClick={() => { setForm({ ...book }); setEditOpen(true) }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-[rgb(var(--color-1))] text-[rgb(var(--btn-text-1)_/_0.8)] hover:bg-[rgb(var(--scrollbar-thumb))] hover:text-[rgb(var(--btn-text-4th))] hover:scale-105 transition-all">
              <Edit3 className="w-3.5 h-3.5" />编辑
            </button>
          </div>
        </div>
      </div>

      <div className="px-8 py-6 space-y-6 max-w-5xl">
        {/* ── 卷 ── */}
        <SectionCard icon={<Layers className="w-4 h-4" />} title="卷"
          collapsed={!visible.volumes} onToggle={() => setVisible(v => ({ ...v, volumes: !v.volumes }))}
          extra={
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-surface-500">点击任意卷直接进入阅读器</span>
              <button onClick={openAddVolume}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] text-surface-300 hover:bg-surface-800 border border-surface-700 transition-colors">
                <Plus className="w-3 h-3" />添加卷
              </button>
            </div>
          }>
          {volumes.length === 0 ? (
            <p className="text-xs text-surface-500 py-4">暂无卷数据，可在开发者工具栏用「书籍爬虫」补齐</p>
          ) : (
            <div className="space-y-2">
              {volumes.map((v, i) => (
                <div key={v.id != null ? v.id : i}
                  className="group flex items-start gap-3 px-3 py-2.5 rounded-xl border border-surface-700/60 bg-surface-800/40 hover:border-primary-500/40 hover:bg-surface-800/70 transition-colors cursor-pointer"
                  onClick={() => openReader(i)}>
                  <span className="w-6 h-6 rounded-lg flex items-center justify-center text-[11px] tabular-nums flex-shrink-0 bg-surface-700/70 text-surface-300">
                    {v.volume_no || i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white truncate">{v.title_zh || `卷${v.volume_no || i + 1}`}</span>
                      {!v.content && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/12 text-amber-300 border border-amber-500/25 flex-shrink-0">无正文</span>}
                      {v.content_source === 'mihoyo' && <span className="text-[10px] text-surface-600 flex-shrink-0">观测枢</span>}
                      {v.content_source === 'biligame' && <span className="text-[10px] text-surface-600 flex-shrink-0">wiki</span>}
                    </div>
                    {v.description_zh && (
                      <p className="text-xs text-surface-500 mt-0.5 line-clamp-2">{v.description_zh}</p>
                    )}
                    {v.source && (
                      <p className="text-[11px] text-surface-600 mt-0.5 flex items-start gap-1">
                        <MapPin className="w-3 h-3 flex-shrink-0 mt-0.5" />
                        <span className="line-clamp-1 whitespace-pre-wrap">{v.source}</span>
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={e => { e.stopPropagation(); setEditVol({ ...v }) }}
                      className="p-1.5 rounded-lg text-surface-400 hover:text-white hover:bg-surface-700 transition-colors" title="编辑本卷">
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={e => { e.stopPropagation(); handleDeleteVolume(v) }}
                      className="p-1.5 rounded-lg text-surface-400 hover:text-red-400 hover:bg-red-500/10 transition-colors" title="删除本卷">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                    <ChevronRight className="w-4 h-4 text-surface-600" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        {/* ── 描述 ── */}
        <SectionCard icon={<Info className="w-4 h-4" />} title="描述"
          collapsed={!visible.intro} onToggle={() => setVisible(v => ({ ...v, intro: !v.intro }))}>
          {book.description_zh
            ? <div className="text-sm text-surface-300 leading-relaxed whitespace-pre-wrap"><ColoredText text={book.description_zh} /></div>
            : <p className="text-xs text-surface-500">暂无描述</p>}
        </SectionCard>

        {/* ── 获取方式 ── */}
        {(book.source || book.source_type) && (
          <SectionCard icon={<MapPinned className="w-4 h-4" />} title="获取方式"
            collapsed={!visible.detail} onToggle={() => setVisible(v => ({ ...v, detail: !v.detail }))}>
            {book.source_type && (
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                {splitMulti(book.source_type).map(s => (
                  <span key={s} className="text-[10px] px-2 py-0.5 rounded-full bg-surface-700/70 text-surface-300 border border-surface-600">{s}</span>
                ))}
              </div>
            )}
            {book.source
              ? <div className="text-sm text-surface-300 leading-relaxed whitespace-pre-wrap"><ColoredText text={book.source} /></div>
              : <p className="text-xs text-surface-500">暂无获取方式</p>}
          </SectionCard>
        )}

        {/* ── 详细信息 ── */}
        <SectionCard icon={<ScrollText className="w-4 h-4" />} title="详细信息">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <StatBadge label="ID" value={book.id} />
            <StatBadge label="稀有度" value={rarityStars(book.rarity, 5)} />
            <StatBadge label="体裁" value={genres.join('、') || '—'} />
            <StatBadge label="国家" value={countries.join('、') || '—'} />
            <StatBadge label="实装版本" value={versions.join('、') || '—'} />
            <StatBadge label="卷数" value={volumes.length} />
            <StatBadge label="收录图鉴" value={book.illustrated ? '是' : '否'} />
            <StatBadge label="作者" value={book.author || '—'} />
            <StatBadge label="相关角色" value={book.related_chars || '—'} />
            <StatBadge label="观测枢 ID" value={book.mihoyo_id || '—'} />
            <StatBadge label="wiki 页面" value={book.wiki_title || '—'} />
            <StatBadge label="有正文卷数" value={`${bodyCount} / ${volumes.length}`} />
          </div>
        </SectionCard>
      </div>

      {/* ═══ 阅读器 ═══ */}
      {readerOpen && volumes.length > 0 && (
        <Reader
          chapters={chapters}
          title={book.name_zh}
          subtitle={`${genres[0] || '书籍'} · 共 ${volumes.length} 卷`}
          progressKey={`book_${book.id}`}
          initialChapter={readerStart}
          emptyText="本卷暂无正文（两站均未收录，可在详情页手动补录）"
          icon={<BookOpen className="w-4 h-4 text-primary-400 flex-shrink-0" />}
          onClose={() => setReaderOpen(false)}
        />
      )}

      {/* ═══ 编辑书籍 ═══ */}
      <EditModal isOpen={editOpen} onClose={() => setEditOpen(false)} onSave={handleSave} saving={saving} title={`编辑书籍 - ${book.name_zh}`}>
        <div className="grid grid-cols-2 gap-x-6">
          <FormInput label="书名" value={form.name_zh} onChange={v => setForm({ ...form, name_zh: v })} />
          <FormInput label="英文名" value={form.name_en} onChange={v => setForm({ ...form, name_en: v })} />
          <FormInput label="稀有度 (0-4)" value={form.rarity} onChange={v => setForm({ ...form, rarity: Number(v) })} type="number" />
          <FormSelect label="体裁" value={form.genre} onChange={v => setForm({ ...form, genre: v })}
            options={[{ value: '', label: '未分类' }, ...BOOK_GENRES.map(g => ({ value: g, label: g }))]} />
          <FormSelect label="国家" value={form.country} onChange={v => setForm({ ...form, country: v })}
            options={[{ value: '', label: '未分类' }, ...BOOK_COUNTRIES.map(c => ({ value: c, label: c }))]} />
          <FormInput label="实装版本" value={form.version} onChange={v => setForm({ ...form, version: v })} />
          <FormInput label="作者" value={form.author} onChange={v => setForm({ ...form, author: v })} />
          <FormSelect label="获取方式分类" value={form.source_type} onChange={v => setForm({ ...form, source_type: v })}
            options={[{ value: '', label: '未分类' }, ...BOOK_SOURCE_TYPES.map(t => ({ value: t, label: t }))]} />
          <FormInput label="相关角色" value={form.related_chars} onChange={v => setForm({ ...form, related_chars: v })} />
          <FormSelect label="收录图鉴" value={form.illustrated ? '1' : '0'}
            onChange={v => setForm({ ...form, illustrated: Number(v) })}
            options={[{ value: '0', label: '否' }, { value: '1', label: '是' }]} />
        </div>
        <FormInput label="描述" value={form.description_zh} onChange={v => setForm({ ...form, description_zh: v })} multiline />
        <FormInput label="获取方式" value={form.source} onChange={v => setForm({ ...form, source: v })} multiline />
        <ImagePicker label="封面图片" currentImage={form.image} onSelect={v => setForm({ ...form, image: v })} onRemove={() => setForm({ ...form, image: null })} />
      </EditModal>

      {/* ═══ 编辑卷 ═══ */}
      <EditModal isOpen={!!editVol} onClose={() => setEditVol(null)} onSave={handleSaveVolume}
        title={editVol?.id ? `编辑卷 - ${editVol.title_zh || editVol.volume_no}` : '添加卷'}>
        <div className="grid grid-cols-2 gap-x-6">
          <FormInput label="卷序" value={editVol?.volume_no ?? 1} type="number"
            onChange={v => setEditVol({ ...editVol, volume_no: v === '' ? 1 : Number(v) })} />
          <FormInput label="卷名" value={editVol?.title_zh || ''} onChange={v => setEditVol({ ...editVol, title_zh: v })} />
          <FormInput label="作者" value={editVol?.author || ''} onChange={v => setEditVol({ ...editVol, author: v })} />
        </div>
        <FormInput label="本卷描述" value={editVol?.description_zh || ''} onChange={v => setEditVol({ ...editVol, description_zh: v })} multiline />
        <FormInput label="本卷获取地点" value={editVol?.source || ''} onChange={v => setEditVol({ ...editVol, source: v })} multiline />
        <FormInput label="本卷正文" value={editVol?.content || ''} onChange={v => setEditVol({ ...editVol, content: v })} multiline rows={12} />
      </EditModal>

      {lightbox && (
        <Lightbox filename={lightbox.filename} label={lightbox.label} onClose={() => setLightbox(null)} />
      )}
    </div>
  )
}

// ── 辅助组件 ──

function SectionCard({ icon, title, children, extra, collapsed, onToggle }) {
  return (
    <div className="rounded-2xl border border-surface-800 bg-surface-900/40 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 cursor-pointer select-none hover:bg-surface-800/40 transition-colors"
        onClick={onToggle}>
        <div className="flex items-center gap-2 text-sm font-medium text-white">
          <span className="text-primary-400">{icon}</span>{title}
        </div>
        <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
          {extra}
          {onToggle && (
            <button onClick={onToggle} className="p-1 rounded-lg text-surface-500 hover:text-surface-200 transition-colors">
              <ChevronDown className={`w-4 h-4 transition-transform ${collapsed ? '-rotate-90' : ''}`} />
            </button>
          )}
        </div>
      </div>
      {!collapsed && <div className="px-4 pb-4">{children}</div>}
    </div>
  )
}

function StatBadge({ label, value }) {
  return (
    <div className="px-3 py-2 rounded-xl bg-surface-800/50 border border-surface-700/50">
      <div className="text-[10px] text-surface-500 mb-0.5">{label}</div>
      <div className="text-xs text-surface-200 truncate" title={String(value ?? '')}>{value ?? '—'}</div>
    </div>
  )
}

/** 详情页所有图片都走图包目录（与其它板块一致） */
function LocalImage({ filename, className = '', style }) {
  const { readImage } = useDb()
  const [src, setSrc] = useState(null)
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
  if (!src) return <BookMarked className="w-10 h-10 text-surface-500" />
  return <img src={src} alt="" className={className} style={style} draggable onDragStart={handleDrag} />
}

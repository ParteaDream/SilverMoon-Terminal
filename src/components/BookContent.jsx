/**
 * BookContent.jsx — 书籍正文渲染（段落文字 + 插图）
 *
 * 正文是纯文本，段落靠换行，插图用 `[img:文件名]` 占位标记（爬虫从 wiki 的
 * `[[file:插图.png]]` 转换而来，写库时已经把标记里的键换成实际落盘文件名）。
 *
 * 之所以单独抽一个组件、而不是塞进 Reader.jsx：
 *   · 图片要经图包目录异步读取（useLazyImage / readImage），与纯文本的渲染节奏不同
 *   · 正文里的 [color=…] 彩色标记仍由 ColoredSpan 解析，两套标记在同一段文本里混排
 *
 * 插图点击后交给通用的图片观看器（Lightbox：滚轮缩放 0.5x~8x、拖拽平移、长按 ±），
 * 不自己造一套。观看器的挂载点**不在这里**：阅读器正文外面套着带 transform 的容器
 * （章节切换动画的 translate-x-0），会让 Lightbox 的 `fixed inset-0` 变成相对那个
 * 容器定位、遮罩只盖住正文一栏。所以这里只负责把点击抛给调用方，由阅读器在顶层渲染。
 */
import { useState, useMemo } from 'react'
import { ImageOff, ZoomIn } from 'lucide-react'
import { useLazyImage } from '../hooks/useLazyImage'
import { ColoredSpan } from './ColoredText'

/** 把正文切成「文本片段 / 插图片段」 */
export function parseBookContent(text) {
  const src = String(text || '')
  if (!src) return []
  const out = []
  const re = /\[img:([^\]\s]+)\]/g
  let last = 0
  let m
  while ((m = re.exec(src))) {
    if (m.index > last) out.push({ type: 'text', text: src.slice(last, m.index) })
    out.push({ type: 'image', name: m[1] })
    last = m.index + m[0].length
  }
  if (last < src.length) out.push({ type: 'text', text: src.slice(last) })
  return out
}

/** 正文里引用的全部插图文件名（供详情页统计 / 排查） */
export function collectContentImages(text) {
  return [...String(text || '').matchAll(/\[img:([^\]\s]+)\]/g)].map(m => m[1])
}

/**
 * 单张插图。图包里没有对应文件时给一个明确的占位，而不是静默空白——
 * 爬取时图片可能因为 wiki 上没有该文件而下载失败，用户需要看得出来。
 */
function BookImage({ filename, onZoom }) {
  const { ref, src } = useLazyImage(filename, 1200)
  const [failed, setFailed] = useState(false)

  return (
    <div ref={ref} className="my-4 flex justify-center">
      {src && !failed ? (
        <img
          src={src}
          alt=""
          onClick={onZoom ? () => onZoom(filename) : undefined}
          onError={() => setFailed(true)}
          className={`max-w-full max-h-[70vh] object-contain rounded-lg border border-black/10 shadow-md transition-transform ${onZoom ? 'cursor-zoom-in hover:scale-[1.01]' : ''}`}
          title={onZoom ? '点击放大' : undefined}
        />
      ) : (
        <div className="flex items-center gap-2 px-3 py-6 rounded-lg border border-dashed border-current/25 opacity-60 text-[11px]">
          <ImageOff className="w-4 h-4" />
          {failed ? `插图加载失败：${filename}` : '插图加载中…'}
        </div>
      )}
    </div>
  )
}

/**
 * @param {object} props
 * @param {string} props.text 卷正文（含 [img:…] 标记与 [color=…] 彩色标记）
 * @param {string} [props.className] 文字样式（字号、行高、颜色由调用方给）
 * @param {string} [props.emptyText] 无正文时的占位文案
 * @param {(filename: string) => void} [props.onImageClick] 点击插图（由调用方打开图片观看器）
 */
export default function BookContent({ text, className = '', emptyText = '', onImageClick }) {
  const segments = useMemo(() => parseBookContent(text), [text])

  if (segments.length === 0) {
    return emptyText ? <span>{emptyText}</span> : null
  }

  return (
    <div className={`whitespace-pre-wrap ${className}`}>
      {segments.map((seg, i) => seg.type === 'image'
        ? <BookImage key={`img-${i}-${seg.name}`} filename={seg.name} onZoom={onImageClick} />
        : <span key={`txt-${i}`}>{ColoredSpan({ text: seg.text })}</span>)}
    </div>
  )
}

/** 阅读器右上角用的插图计数提示（没有插图的卷不显示） */
export function ContentImageCount({ text }) {
  const n = useMemo(() => collectContentImages(text).length, [text])
  if (!n) return null
  return (
    <span className="inline-flex items-center gap-1 text-[10px] opacity-60">
      <ZoomIn className="w-3 h-3" />{n} 张插图
    </span>
  )
}

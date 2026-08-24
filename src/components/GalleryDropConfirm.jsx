import { Check, X, Image as ImageIcon, Loader2 } from 'lucide-react'

/**
 * 图库拖拽导入确认浮条
 *
 * 拖拽图片到图库后不会立即导入，而是先展示待确认列表（缩略图 + 文件名），
 * 点击「确定导入」才真正复制文件并加入图库。避免误拖（如图库内图片轻微
 * 拖动后松手）造成的重复添加。
 *
 * @param {Array<{id:number, name:string, previewUrl?:string}>} items 待导入图片
 * @param {boolean} importing 导入进行中（禁用按钮）
 * @param {() => void} onConfirm 点击确定
 * @param {() => void} onCancel 点击取消
 */
export default function GalleryDropConfirm({ items, importing, onConfirm, onCancel }) {
  if (!items || items.length === 0) return null
  return (
    <div className="fixed left-1/2 bottom-6 -translate-x-1/2 z-40 w-[min(560px,92vw)] rounded-xl bg-surface-900/95 backdrop-blur-xl border border-white/10 shadow-2xl animate-scale-in">
      <div className="px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-medium text-surface-200">将导入 {items.length} 张图片到图库</p>
          {!importing && (
            <button onClick={onCancel} className="p-1 rounded-lg text-surface-500 hover:text-white hover:bg-surface-800 transition-colors" title="取消">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2 max-h-28 overflow-y-auto">
          {items.map(it => (
            <div key={it.id} className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-surface-800/80 border border-white/5">
              {it.previewUrl ? (
                <img src={it.previewUrl} alt="" className="w-8 h-8 rounded object-cover shrink-0" />
              ) : (
                <ImageIcon className="w-4 h-4 text-surface-500 shrink-0" />
              )}
              <span className="text-[11px] text-surface-300 max-w-[180px] truncate">{it.name}</span>
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2 mt-3">
          <button
            onClick={onCancel}
            disabled={importing}
            className="px-3 py-1.5 rounded-lg text-xs text-surface-300 hover:bg-surface-800 border border-white/10 transition-colors disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            disabled={importing}
            className="px-4 py-1.5 rounded-lg text-xs font-medium bg-primary-600 hover:bg-primary-500 text-white transition-colors disabled:opacity-60 flex items-center gap-1.5"
          >
            {importing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            {importing ? '导入中...' : '确定导入'}
          </button>
        </div>
      </div>
    </div>
  )
}

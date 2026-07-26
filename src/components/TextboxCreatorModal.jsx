import { useState } from 'react'
import { Type, X, Check } from 'lucide-react'

export default function TextboxCreatorModal({ onConfirm, onCancel, editData }) {
  const [text, setText] = useState(editData?.text || '')
  const [level, setLevel] = useState(editData?.level || 1)
  const isEdit = !!editData

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onCancel}>
      <div className="w-80 rounded-xl bg-surface-900 border border-white/10 shadow-2xl p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Type className="w-4 h-4 text-blue-400" /> {isEdit ? '编辑文本框' : '添加文本框'}
          </h3>
          <button onClick={onCancel} className="p-1 rounded-lg hover:bg-white/10 text-surface-400 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="mb-3">
          <label className="text-[11px] text-surface-400 block mb-1">文本内容</label>
          <textarea value={text} onChange={e => setText(e.target.value)} rows={3} placeholder="输入文本…"
            className="w-full px-3 py-2 rounded-lg bg-surface-800 border border-white/10 text-sm text-surface-200 placeholder-surface-600 outline-none focus:border-blue-500/40 transition-colors resize-none" />
        </div>

        <div className="mb-4">
          <label className="text-[11px] text-surface-400 block mb-1.5">显示级别</label>
          <div className="flex gap-2">
            {[0, 1, 2, 3].map(l => (
              <button key={l} onClick={() => setLevel(l)}
                className={`flex-1 px-3 py-2 rounded-lg text-xs border transition-colors ${
                  level === l ? 'bg-blue-500/20 border-blue-500/30 text-blue-400' : 'bg-surface-800 border-white/10 text-surface-300 hover:bg-surface-700'
                }`}>
                {l === 0 ? '零级' : `级别${l}`}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-surface-500 mt-1.5">零级字体最大，三级最小</p>
        </div>

        <div className="flex gap-2">
          <button onClick={onCancel} className="flex-1 px-4 py-2 rounded-xl border border-white/10 text-sm text-surface-300 hover:bg-white/5 transition-colors">取消</button>
          <button onClick={() => onConfirm({ text, level, editId: editData?.id || null })} disabled={!text.trim()}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
              text.trim() ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-blue-500/30' : 'bg-surface-800 text-surface-600 border border-white/5 cursor-not-allowed'
            }`}>
            <Check className="w-4 h-4" /> {isEdit ? '保存' : '添加'}
          </button>
        </div>
      </div>
    </div>
  )
}

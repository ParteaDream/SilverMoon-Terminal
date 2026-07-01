import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X, Save, Loader2, ImagePlus } from 'lucide-react'
import { useDb } from '../context/DbContext'
import ColorTextInput from './ColorTextInput'

export default function EditModal({ isOpen, onClose, onSave, title, children, saving, wide, wider, closeOnBackdrop = true }) {
  if (!isOpen) return null

  const maxW = wider ? 'max-w-7xl' : wide ? 'max-w-6xl' : 'max-w-2xl'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 no-drag">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={closeOnBackdrop ? onClose : undefined} />
      <div className={`relative z-10 bg-surface-900 border border-surface-700 rounded-xl w-full ${maxW} max-h-[85vh] overflow-hidden shadow-2xl`}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-700">
          <h2 className="text-base font-semibold">{title}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-surface-400 hover:text-white hover:bg-surface-700 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 overflow-y-auto max-h-[calc(85vh-8rem)]">
          {children}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-surface-700 bg-surface-900/50">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm text-surface-400 hover:text-white hover:bg-surface-700 transition-colors"
          >
            取消
          </button>
          <button
            onClick={onSave}
            disabled={saving}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors
              ${saving ? 'bg-primary-600/50 cursor-not-allowed' : 'bg-primary-600 hover:bg-primary-500'}`}
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function FormField({ label, children, className = '' }) {
  return (
    <div className={`mb-4 ${className}`}>
      <label className="block text-xs font-medium text-surface-400 mb-1.5">{label}</label>
      {children}
    </div>
  )
}

export function FormInput({ label, value, onChange, type = 'text', placeholder = '', multiline = false, ...props }) {
  const inputClass = `w-full px-3 py-2 bg-surface-800 border border-surface-600 rounded-lg
                       text-sm text-white placeholder-surface-500
                       focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500/20
                       transition-colors`

  return (
    <FormField label={label}>
      {multiline ? (
        <ColorTextInput
          value={value || ''}
          onChange={onChange}
          placeholder={placeholder}
          rows={8}
          {...props}
        />
      ) : (
        <input
          type={type}
          value={value || ''}
          onChange={e => onChange(type === 'number' ? Number(e.target.value) : e.target.value)}
          placeholder={placeholder}
          className={inputClass}
          {...props}
        />
      )}
    </FormField>
  )
}

export function FormSelect({ label, value, onChange, options, placeholder = '请选择...' }) {
  return (
    <FormField label={label}>
      <select
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        className="w-full px-3 py-2 bg-surface-800 border border-surface-600 rounded-lg
                   text-sm text-white focus:outline-none focus:border-primary-500 transition-colors"
      >
        <option value="">{placeholder}</option>
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </FormField>
  )
}

export function SearchSelect({ label, value, onChange, options, placeholder = '搜索并选择...' }) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const inputRef = useRef(null)
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 })
  const [thumbCache, setThumbCache] = useState({})
  const selected = options.find(o => o.value === value)

  // 异步加载缩略图
  useEffect(() => {
    if (!open) return
    options.forEach(async opt => {
      if (opt.image && !thumbCache[opt.image]) {
        try {
          const result = await window.electronAPI?.readImage(opt.image)
          if (result?.success) {
            setThumbCache(prev => ({ ...prev, [opt.image]: result.data }))
          }
        } catch (_) {}
      }
    })
  }, [open, options])

  const filtered = search.trim()
    ? options.filter(o => o.label.toLowerCase().includes(search.toLowerCase()))
    : options

  function openDropdown() {
    if (inputRef.current) {
      const rect = inputRef.current.getBoundingClientRect()
      setPos({ top: rect.bottom + 4, left: rect.left, width: rect.width })
    }
    setSearch('')
    setOpen(true)
  }

  function select(opt) {
    onChange(opt.value)
    setSearch(opt.label)
    setOpen(false)
  }

  const dropdown = open && (
    <div
      className="fixed z-[100] max-h-56 overflow-y-auto bg-surface-800 border border-surface-600 rounded-lg shadow-2xl"
      style={{ top: pos.top, left: pos.left, width: pos.width }}
    >
      {filtered.length > 0 ? filtered.map(opt => (
        <div
          key={opt.value}
          onMouseDown={() => select(opt)}
          className={`flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-primary-500/10 transition-colors
            ${opt.value === value ? 'text-primary-400 bg-primary-500/5' : 'text-surface-300'}`}
        >
          {opt.image && (
            thumbCache[opt.image]
              ? <img src={thumbCache[opt.image]} alt="" className="w-6 h-6 rounded object-cover flex-shrink-0" />
              : <div className="w-6 h-6 rounded bg-surface-700 flex-shrink-0" />
          )}
          <span className="truncate">{opt.label}</span>
        </div>
      )) : (
        <div className="px-3 py-2 text-sm text-surface-500">无匹配结果</div>
      )}
    </div>
  )

  return (
    <FormField label={label}>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={open ? search : (selected?.label || '')}
          onChange={e => { setSearch(e.target.value); if (!open) openDropdown() }}
          onFocus={openDropdown}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={placeholder}
          className="w-full px-3 py-2 bg-surface-800 border border-surface-600 rounded-lg
                     text-sm text-white placeholder-surface-500
                     focus:outline-none focus:border-primary-500 transition-colors"
        />
      </div>
      {dropdown && createPortal(dropdown, document.body)}
    </FormField>
  )
}

export function ImagePicker({ label, currentImage, onSelect, onRemove }) {
  const { importImage, readImage, imagesDir } = useDb()
  const [preview, setPreview] = useState(null)
  const [dragOver, setDragOver] = useState(false)

  // Load preview using readImage (base64) to avoid file:// issues
  useEffect(() => {
    let cancelled = false
    async function load() {
      if (currentImage && imagesDir) {
        const data = await readImage(currentImage)
        if (!cancelled) setPreview(data)
      } else {
        setPreview(null)
      }
    }
    load()
    return () => { cancelled = true }
  }, [currentImage, imagesDir, readImage])

  async function handleImport() {
    const filename = await importImage()
    if (filename) {
      onSelect(filename)
    }
  }

  async function handleRemove() {
    setPreview(null)
    onRemove()
  }

  function handleDragOver(e) {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(true)
  }

  function handleDragLeave(e) {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
  }

  async function handleDrop(e) {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)

    const files = e.dataTransfer?.files
    if (!files || files.length === 0) return

    const file = files[0]
    if (!file.type.startsWith('image/')) return

    // Send the file path to main process via IPC
    const result = await window.electronAPI.importImageFile(file.path)
    if (result && result.conflict) {
      alert(result.message)
      return
    }
    if (result && result.filename) {
      onSelect(result.filename)
    }
  }

  return (
    <FormField label={label}>
      <div className="flex items-start gap-3">
        {preview ? (
          <div className="relative w-20 h-20 rounded-lg overflow-hidden bg-surface-800 border border-surface-600 flex-shrink-0">
            <img src={preview} alt="" className="w-full h-full object-cover" />
            <button
              onClick={handleRemove}
              className="absolute top-1 right-1 p-1 rounded bg-black/60 text-white/80 hover:bg-black/80"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ) : (
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`w-20 h-20 rounded-lg border flex items-center justify-center flex-shrink-0 transition-colors cursor-pointer
              ${dragOver
                ? 'bg-primary-500/10 border-primary-500 border-solid'
                : 'bg-surface-800 border-surface-600 border-dashed'
              }`}
            onClick={handleImport}
            title="点击导入或拖拽图片到此处"
          >
            <ImagePlus className={`w-5 h-5 ${dragOver ? 'text-primary-400' : 'text-surface-500'}`} />
          </div>
        )}
        <button
          onClick={handleImport}
          className="px-3 py-1.5 rounded-lg bg-surface-700 hover:bg-surface-600 text-xs text-surface-300 transition-colors"
        >
          导入图片
        </button>
        {currentImage && (
          <button
            onClick={handleRemove}
            className="px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-xs text-red-400 transition-colors"
          >
            移除
          </button>
        )}
      </div>
    </FormField>
  )
}

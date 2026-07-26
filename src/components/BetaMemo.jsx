import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Plus, Image, Trash2, Eye, EyeOff, ArrowLeft,
  Upload, Check, X, FolderOpen, Pencil, Eraser,
  Undo2, Redo2,
} from 'lucide-react'

// ═══════════════════════════════════════
// 常量
// ═══════════════════════════════════════
const IMAGE_TYPES = [
  { key: 'summary', label: '任务汇总', short: '汇总' },
  { key: 'constellation', label: '命座测试', short: '命座' },
  { key: 'questionnaire', label: '问卷汇总', short: '问卷' },
]

function getImageKey(task, typeKey) {
  // 固定类型直接取 task.keyImage，自定义类型从 task.images 中取
  const fixed = IMAGE_TYPES.find(t => t.key === typeKey)
  if (fixed) return task[typeKey + 'Image']
  return task.images?.[typeKey]
}

function getAllImageKeys(task) {
  const keys = {}
  for (const t of IMAGE_TYPES) {
    const val = task[t.key + 'Image']
    if (val) keys[t.key] = val
  }
  if (task.images) {
    for (const [k, v] of Object.entries(task.images)) {
      if (v) keys[k] = v
    }
  }
  return keys
}

const STORAGE_KEY = 'betamemo_tasks' // 仅用于迁移检测

// ═══════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

async function loadTasks() {
  try {
    const res = await window.electronAPI?.betamemoLoadTasks()
    return res || []
  } catch { return [] }
}

async function saveTasks(tasks) {
  try {
    await window.electronAPI?.betamemoSaveTasks(tasks)
  } catch { /* ignore */ }
}

// 首次加载时，检查并迁移 user.json 中的旧数据
let _migrationDone = false
async function migrateIfNeeded() {
  if (_migrationDone) return
  _migrationDone = true
  try {
    const res = await window.electronAPI?.betamemoMigrateFromJson()
    if (res?.migrated > 0) console.log('[BetaMemo] 已从 user.json 迁移', res.migrated, '条记录到 user.db')
  } catch { /* ignore */ }
}

// ═══════════════════════════════════════
// 主组件
// ═══════════════════════════════════════
export default function BetaMemo() {
  const [view, setView] = useState('list')
  const [tasks, setTasks] = useState([])
  const [selectedTask, setSelectedTask] = useState(null)
  const [loading, setLoading] = useState(true)
  const saveTimerRef = useRef(null)
  const flushSaveRef = useRef(() => {})
  const tasksRef = useRef(tasks)

  useEffect(() => { migrateIfNeeded().then(() => loadTasks()).then(t => { setTasks(t); setLoading(false) }) }, [])

  // 保持 tasksRef 最新，供 handleBack 强制保存使用
  useEffect(() => { tasksRef.current = tasks }, [tasks])

  // 组件卸载时 flush 防抖保存
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
    }
  }, [])

  const refreshTasks = useCallback(async () => {
    const t = await loadTasks()
    setTasks(t)
    return t
  }, [])

  const handleCreate = useCallback(() => setView('create'), [])

  const handleManage = useCallback((task) => {
    setSelectedTask(task)
    setView('manage')
  }, [])

  const handleEdit = useCallback((task) => {
    setSelectedTask(task)
    setView('edit')
  }, [])

  const handleReorder = useCallback(async (reordered) => {
    flushSaveRef.current()
    setTasks(reordered)
    tasksRef.current = reordered
    await saveTasks(reordered)
  }, [])

  const handleSaveTask = useCallback(async (newTask) => {
    flushSaveRef.current?.()
    const updated = [newTask, ...tasks]
    setTasks(updated)
    tasksRef.current = updated
    await saveTasks(updated)
    setView('list')
  }, [tasks])

  const handleUpdateTask = useCallback((updatedTask) => {
    const updated = tasks.map(t => t.id === updatedTask.id ? updatedTask : t)
    setTasks(updated)
    setSelectedTask(updatedTask)
    tasksRef.current = updated
    // 防抖保存：笔画连续操作期间不写盘，停止 400ms 后再写
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => saveTasks(updated), 400)
  }, [tasks])

  // 确保防抖保存的刷新函数始终是最新的
  flushSaveRef.current = () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
  }

  const handleBack = useCallback(async () => {
    // 强制保存最新数据再返回
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
      await saveTasks(tasksRef.current)
    }
    setView('list')
    setSelectedTask(null)
    await refreshTasks()
  }, [refreshTasks])

  const handleDeleteTask = useCallback(async (taskId) => {
    flushSaveRef.current?.()
    const updated = tasks.filter(t => t.id !== taskId)
    setTasks(updated)
    tasksRef.current = updated
    await saveTasks(updated)
    setView('list')
    setSelectedTask(null)
  }, [tasks])

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-surface-500 border-t-transparent animate-spin" />
      </div>
    )
  }

  switch (view) {
    case 'create':
      return <CreateView onSave={handleSaveTask} onCancel={handleBack} tasks={tasks} />
    case 'edit':
      return selectedTask
        ? <EditView key={selectedTask.id} task={selectedTask} tasks={tasks} onUpdate={handleUpdateTask} onDelete={handleDeleteTask} onManage={handleManage} onBack={handleBack} />
        : <TaskListView tasks={tasks} onCreate={handleCreate} onManage={handleManage} onReorder={handleReorder} onEdit={handleEdit} />
    case 'manage':
      return selectedTask
        ? <ManageView task={selectedTask} onUpdate={handleUpdateTask} onDelete={handleDeleteTask} onBack={handleBack} />
        : <TaskListView tasks={tasks} onCreate={handleCreate} onManage={handleManage} onReorder={handleReorder} onEdit={handleEdit} />
    default:
      return <TaskListView tasks={tasks} onCreate={handleCreate} onManage={handleManage} onReorder={handleReorder} onEdit={handleEdit} />
  }
}

// ═══════════════════════════════════════
// 任务列表视图
// ═══════════════════════════════════════
function TaskListView({ tasks, onCreate, onManage, onReorder, onEdit }) {
  const [dragIndex, setDragIndex] = useState(null)
  const [overIndex, setOverIndex] = useState(null)
  const dragNode = useRef(null)

  function handleDragStart(e, index) {
    dragNode.current = index
    setDragIndex(index)
    e.dataTransfer.effectAllowed = 'move'
    // 让被拖拽卡片半透明
    if (e.target) e.target.style.opacity = '0.5'
  }

  function handleDragOver(e, index) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragNode.current !== index) setOverIndex(index)
  }

  function handleDragEnd(e) {
    if (e.target) e.target.style.opacity = ''
    setDragIndex(null)
    setOverIndex(null)
    dragNode.current = null
  }

  function handleDrop(e, index) {
    e.preventDefault()
    const fromIdx = dragNode.current
    if (fromIdx == null || fromIdx === index) {
      setDragIndex(null)
      setOverIndex(null)
      dragNode.current = null
      return
    }
    const next = [...tasks]
    const [moved] = next.splice(fromIdx, 1)
    next.splice(index, 0, moved)
    onReorder(next)
    setDragIndex(null)
    setOverIndex(null)
    dragNode.current = null
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <h2 className="text-sm font-semibold text-white">测试任务列表</h2>
        <button
          onClick={onCreate}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary-500/20 hover:bg-primary-500/30
                     border border-primary-500/30 text-primary-300 text-xs font-medium transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          新建
        </button>
      </div>
      <div className="flex-1 overflow-auto p-4">
        {tasks.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-surface-500">
            <FolderOpen className="w-12 h-12 mb-3 opacity-30" />
            <p className="text-xs">暂无测试任务</p>
            <p className="text-[11px] mt-1 opacity-60">点击"新建"创建第一个任务</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {tasks.map((task, i) => (
              <div
                key={task.id}
                draggable
                onDragStart={(e) => handleDragStart(e, i)}
                onDragOver={(e) => handleDragOver(e, i)}
                onDragEnd={handleDragEnd}
                onDrop={(e) => handleDrop(e, i)}
                className={`transition-all duration-200 ${
                  overIndex === i && dragIndex !== i
                    ? 'translate-y-1 opacity-80'
                    : ''
                } ${dragIndex === i ? 'cursor-grabbing' : 'cursor-grab'}`}
              >
                <TaskCard task={task} onClick={() => onManage(task)} onEdit={() => onEdit?.(task)} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function TaskCard({ task, onClick, onEdit }) {
  const allKeys = getAllImageKeys(task)
  const imgCount = Object.keys(allKeys).length
  const customTypes = task.customImageTypes || []
  const totalTypes = IMAGE_TYPES.length + customTypes.length
  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(e) } }}
      className="w-full text-left p-4 rounded-xl bg-surface-800/50 border border-white/5
                 hover:bg-surface-800 hover:border-white/10 transition-all group cursor-pointer"
    >
      <div className="flex items-center justify-between">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium text-surface-200 truncate">{task.name || '未命名任务'}</h3>
          <p className="text-[11px] text-surface-500 mt-1">
            {imgCount}/{totalTypes} 张图片 · {task.createdAt ? new Date(task.createdAt).toLocaleDateString('zh-CN') : ''}
          </p>
          {task.extraInfo && (
            <p className="text-[11px] text-surface-400 mt-1.5 line-clamp-2 whitespace-pre-wrap break-words">
              {task.extraInfo}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-3">
          <div className="flex gap-1">
            {[...IMAGE_TYPES, ...customTypes].map(t => {
              const hasImg = !!getImageKey(task, t.key)
              const completed = task.completedTypes?.[t.key]
              let dotColor = 'bg-surface-600'
              if (hasImg && completed) dotColor = 'bg-green-500'
              else if (hasImg) dotColor = 'bg-yellow-500'
              return (
                <div key={t.key} className={`w-2 h-2 rounded-full ${dotColor}`} />
              )
            })}
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onEdit?.(task) }}
            className="p-1.5 rounded-lg text-surface-500 hover:text-amber-400 hover:bg-amber-500/10 transition-colors"
            title="编辑任务"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════
// 创建视图
// ═══════════════════════════════════════
function CreateView({ onSave, onCancel, tasks }) {
  const [error, setError] = useState('')
  const existingNames = (tasks || []).map(t => t.name)
  const [name, setName] = useState('')
  const extraInfoRef = useRef(null)
  const [images, setImages] = useState({ summary: null, constellation: null, questionnaire: null })
  const [customImageTypes, setCustomImageTypes] = useState([])
  const [showAddCustom, setShowAddCustom] = useState(false)
  const [newCustomLabel, setNewCustomLabel] = useState('')
  const [saving, setSaving] = useState(false)

  const handleImport = useCallback(async (typeKey) => {
    const result = await window.electronAPI?.importUserImage()
    if (result?.filename) {
      setImages(prev => ({ ...prev, [typeKey]: result.filename }))
    }
  }, [])

  const handleDrop = useCallback(async (e, typeKey) => {
    e.preventDefault()
    e.stopPropagation()
    let srcPath = null
    const file = e.dataTransfer?.files?.[0]
    if (file) {
      srcPath = file.path
    } else {
      srcPath = e.dataTransfer?.getData('text/plain') || null
    }
    if (srcPath) {
      const result = await window.electronAPI?.importUserImageFile(srcPath)
      if (result?.filename) {
        setImages(prev => ({ ...prev, [typeKey]: result.filename }))
      }
    }
  }, [])

  const handleAddCustomType = useCallback(() => {
    const label = newCustomLabel.trim()
    if (!label) return
    const key = 'custom_' + Date.now().toString(36)
    setCustomImageTypes(prev => [...prev, { key, label, short: label }])
    setImages(prev => ({ ...prev, [key]: null }))
    setNewCustomLabel('')
    setShowAddCustom(false)
  }, [newCustomLabel])

  const handleRemoveCustomType = useCallback((key) => {
    setCustomImageTypes(prev => prev.filter(t => t.key !== key))
    setImages(prev => { const next = { ...prev }; delete next[key]; return next })
  }, [])

  const handleSave = useCallback(async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    if (existingNames.includes(trimmed)) {
      setError('任务名称已存在，请使用不同的名称')
      return
    }
    setError('')
    setSaving(true)

    // 重命名固定类型图片
    const renamedImages = { summary: null, constellation: null, questionnaire: null }
    for (const t of IMAGE_TYPES) {
      const oldName = images[t.key]
      if (!oldName) continue
      const ext = oldName.includes('.') ? oldName.slice(oldName.lastIndexOf('.')) : ''
      const newName = `${trimmed}-${t.label}${ext}`
      if (oldName !== newName) {
        const result = await window.electronAPI?.renameUserImage(oldName, newName)
        if (result?.filename) renamedImages[t.key] = result.filename
        else renamedImages[t.key] = oldName
      } else {
        renamedImages[t.key] = oldName
      }
    }

    // 重命名自定义类型图片
    const renamedCustomImages = {}
    for (const ct of customImageTypes) {
      const oldName = images[ct.key]
      if (!oldName) { renamedCustomImages[ct.key] = null; continue }
      const ext = oldName.includes('.') ? oldName.slice(oldName.lastIndexOf('.')) : ''
      const newName = `${trimmed}-${ct.label}${ext}`
      if (oldName !== newName) {
        const result = await window.electronAPI?.renameUserImage(oldName, newName)
        if (result?.filename) renamedCustomImages[ct.key] = result.filename
        else renamedCustomImages[ct.key] = oldName
      } else {
        renamedCustomImages[ct.key] = oldName
      }
    }

    // 构建初始 strokes 和 completedTypes
    const initStrokes = { summary: [], constellation: [], questionnaire: [] }
    const initCompleted = { summary: false, constellation: false, questionnaire: false }
    for (const ct of customImageTypes) {
      initStrokes[ct.key] = []
      initCompleted[ct.key] = false
    }

    const task = {
      id: uid(),
      name: trimmed,
      extraInfo: extraInfoRef.current?.value?.trim() || '',
      summaryImage: renamedImages.summary,
      constellationImage: renamedImages.constellation,
      questionnaireImage: renamedImages.questionnaire,
      images: renamedCustomImages,
      customImageTypes,
      strokes: initStrokes,
      completedTypes: initCompleted,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    await onSave(task)
    setSaving(false)
  }, [name, images, customImageTypes, onSave, existingNames])

  const allTypeKeys = [...IMAGE_TYPES, ...customImageTypes]
  const hasAnyImage = allTypeKeys.some(t => images[t.key])

  const nameDuplicate = name.trim() && existingNames.includes(name.trim())

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5">
        <button onClick={onCancel} className="p-1 rounded-md text-surface-400 hover:text-white hover:bg-white/10 transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h2 className="text-sm font-semibold text-white flex-1">新建测试任务</h2>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4">
        <div>
          <label className="text-[11px] text-surface-400 font-medium mb-1.5 block">任务名称</label>
          <input
            type="text"
            value={name}
            onChange={e => { setName(e.target.value); setError('') }}
            placeholder="输入任务名称（如：V3.2 测试服第1周）"
            className={`w-full px-3 py-2 rounded-lg bg-surface-800/80 border text-sm text-surface-200
                       placeholder-surface-600 outline-none transition-colors ${
                         nameDuplicate ? 'border-red-500/50 focus:border-red-500' : 'border-white/10 focus:border-primary-500/50'
                       }`}
          />
          {nameDuplicate && (
            <p className="text-[11px] text-red-400 mt-1">此名称已被使用，请更换</p>
          )}
          {error && !nameDuplicate && (
            <p className="text-[11px] text-red-400 mt-1">{error}</p>
          )}
        </div>

        <div>
          <label className="text-[11px] text-surface-400 font-medium mb-1.5 block">额外信息</label>
          <textarea
            ref={extraInfoRef}
            defaultValue=""
            placeholder="输入额外备注信息（可选，将在任务列表中显示）"
            rows={3}
            className="w-full px-3 py-2 rounded-lg bg-surface-800/80 border border-white/10 text-sm text-surface-200
                       placeholder-surface-600 outline-none focus:border-primary-500/50 transition-colors resize-none"
          />
        </div>

        {IMAGE_TYPES.map(t => (
          <ImageDropZone
            key={t.key}
            label={t.label}
            filename={images[t.key]}
            onImport={() => handleImport(t.key)}
            onDrop={(e) => handleDrop(e, t.key)}
            onRemove={() => setImages(prev => ({ ...prev, [t.key]: null }))}
          />
        ))}

        {/* 自定义图片类型 */}
        {customImageTypes.map(ct => (
          <div key={ct.key} className="relative">
            <button
              onClick={() => handleRemoveCustomType(ct.key)}
              className="absolute top-0 right-0 z-10 p-1 rounded text-surface-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
              title="移除自定义类型"
            >
              <X className="w-3.5 h-3.5" />
            </button>
            <ImageDropZone
              label={ct.label}
              filename={images[ct.key]}
              onImport={() => handleImport(ct.key)}
              onDrop={(e) => handleDrop(e, ct.key)}
              onRemove={() => setImages(prev => ({ ...prev, [ct.key]: null }))}
            />
          </div>
        ))}

        {/* 添加更多 */}
        {showAddCustom ? (
          <div className="flex items-center gap-2 bg-surface-800/40 rounded-lg p-3 border border-white/10">
            <input
              type="text"
              value={newCustomLabel}
              onChange={e => setNewCustomLabel(e.target.value)}
              placeholder="输入自定义类型名称（如：技能演示）"
              className="flex-1 px-3 py-1.5 rounded-lg bg-surface-800/80 border border-white/10 text-sm text-surface-200
                         placeholder-surface-600 outline-none focus:border-primary-500/50 transition-colors"
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter') handleAddCustomType(); if (e.key === 'Escape') setShowAddCustom(false) }}
            />
            <button
              onClick={handleAddCustomType}
              disabled={!newCustomLabel.trim()}
              className="px-3 py-1.5 rounded-lg bg-primary-500/20 border border-primary-500/30 text-primary-300 text-xs font-medium
                         hover:bg-primary-500/30 transition-colors disabled:opacity-50"
            >
              确认
            </button>
            <button
              onClick={() => { setShowAddCustom(false); setNewCustomLabel('') }}
              className="px-3 py-1.5 rounded-lg text-xs text-surface-400 hover:text-white hover:bg-white/5 transition-colors"
            >
              取消
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowAddCustom(true)}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 border-dashed border-surface-600
                       text-surface-400 text-xs hover:border-surface-500 hover:text-surface-300 transition-colors"
          >
            <Plus className="w-4 h-4" />
            添加更多
          </button>
        )}
      </div>

      <div className="flex items-center gap-3 px-4 py-3 border-t border-white/5">
        <button
          onClick={onCancel}
          className="px-4 py-2 rounded-lg text-xs text-surface-400 hover:text-white hover:bg-white/5 transition-colors"
        >
          取消
        </button>
        <button
          onClick={handleSave}
          disabled={!name.trim() || !hasAnyImage || saving}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium transition-colors ${
            name.trim() && hasAnyImage && !saving
              ? 'bg-primary-500 hover:bg-primary-600 text-white'
              : 'bg-surface-700 text-surface-500 cursor-not-allowed'
          }`}
        >
          {saving ? (
            <div className="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
          ) : (
            <Check className="w-3.5 h-3.5" />
          )}
          确认创建
        </button>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════
// 编辑视图（编辑任务名称、额外信息、图片、自定义类型）
// ═══════════════════════════════════════
function EditView({ task, tasks, onUpdate, onDelete, onManage, onBack }) {
  const [name, setName] = useState(task.name || '')
  const extraInfoRef = useRef(null)
  const [images, setImages] = useState(() => {
    const init = {}
    for (const t of IMAGE_TYPES) init[t.key] = task[t.key + 'Image'] || null
    if (task.images) {
      for (const [k, v] of Object.entries(task.images)) init[k] = v
    }
    return init
  })
  const [customImageTypes, setCustomImageTypes] = useState(task.customImageTypes || [])
  const [showAddCustom, setShowAddCustom] = useState(false)
  const [newCustomLabel, setNewCustomLabel] = useState('')
  const [saving, setSaving] = useState(false)
  const existingNames = (tasks || []).map(t => t.name).filter(n => n !== task.name)
  const nameDuplicate = name.trim() && existingNames.includes(name.trim())

  const handleImport = useCallback(async (typeKey) => {
    const result = await window.electronAPI?.importUserImage()
    if (result?.filename) {
      setImages(prev => ({ ...prev, [typeKey]: result.filename }))
    }
  }, [])

  const handleDrop = useCallback(async (e, typeKey) => {
    e.preventDefault()
    e.stopPropagation()
    let srcPath = null
    const file = e.dataTransfer?.files?.[0]
    if (file) {
      srcPath = file.path
    } else {
      srcPath = e.dataTransfer?.getData('text/plain') || null
    }
    if (srcPath) {
      const result = await window.electronAPI?.importUserImageFile(srcPath)
      if (result?.filename) {
        setImages(prev => ({ ...prev, [typeKey]: result.filename }))
      }
    }
  }, [])

  const handleAddCustomType = useCallback(() => {
    const label = newCustomLabel.trim()
    if (!label) return
    const key = 'custom_' + Date.now().toString(36)
    setCustomImageTypes(prev => [...prev, { key, label, short: label }])
    setImages(prev => ({ ...prev, [key]: null }))
    setNewCustomLabel('')
    setShowAddCustom(false)
  }, [newCustomLabel])

  const handleRemoveCustomType = useCallback((key) => {
    setCustomImageTypes(prev => prev.filter(t => t.key !== key))
    setImages(prev => { const next = { ...prev }; delete next[key]; return next })
  }, [])

  async function renameImageForTask(oldName, taskName, typeLabel) {
    if (!oldName) return null
    const ext = oldName.includes('.') ? oldName.slice(oldName.lastIndexOf('.')) : ''
    const newName = `${taskName}-${typeLabel}${ext}`
    if (oldName === newName) return oldName
    const result = await window.electronAPI?.renameUserImage(oldName, newName)
    return result?.filename || oldName
  }

  const handleSave = useCallback(async () => {
    const trimmed = name.trim()
    if (!trimmed || nameDuplicate) return
    setSaving(true)
    const oldName = task.name

    // 重命名所有图片（如果任务名称变了）
    const renamedImages = {}
    for (const t of IMAGE_TYPES) {
      const oldFilename = images[t.key]
      if (!oldFilename) { renamedImages[t.key] = null; continue }
      // 先恢复到标准旧名称格式再重命名
      const result = await renameImageForTask(oldFilename, trimmed, t.label)
      renamedImages[t.key] = result
    }

    const renamedCustomImages = {}
    for (const ct of customImageTypes) {
      const oldFilename = images[ct.key]
      if (!oldFilename) { renamedCustomImages[ct.key] = null; continue }
      const result = await renameImageForTask(oldFilename, trimmed, ct.label)
      renamedCustomImages[ct.key] = result
    }

    // 构建 strokes 保留旧数据，确保自定义类型有初始值
    const strokes = { ...(task.strokes || {}) }
    for (const ct of customImageTypes) {
      if (!strokes[ct.key]) strokes[ct.key] = []
    }
    const completedTypes = { ...(task.completedTypes || {}) }
    for (const ct of customImageTypes) {
      if (completedTypes[ct.key] === undefined) completedTypes[ct.key] = false
    }

    // 移除已删除的自定义类型的 stroke 数据
    const activeCustomKeys = new Set(customImageTypes.map(ct => ct.key))
    for (const key of Object.keys(strokes)) {
      if (!IMAGE_TYPES.find(t => t.key === key) && !activeCustomKeys.has(key)) {
        delete strokes[key]
        delete completedTypes[key]
      }
    }

    const updated = {
      ...task,
      name: trimmed,
      extraInfo: extraInfoRef.current?.value?.trim() || '',
      summaryImage: renamedImages.summary,
      constellationImage: renamedImages.constellation,
      questionnaireImage: renamedImages.questionnaire,
      images: renamedCustomImages,
      customImageTypes,
      strokes,
      completedTypes,
      updatedAt: new Date().toISOString(),
    }
    await onUpdate(updated)
    setSaving(false)
    onBack()
  }, [name, images, customImageTypes, task, onUpdate, onBack, nameDuplicate])

  const allTypeKeys = [...IMAGE_TYPES, ...customImageTypes]
  const hasAnyImage = allTypeKeys.some(t => images[t.key])

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5">
        <button onClick={onBack} className="p-1 rounded-md text-surface-400 hover:text-white hover:bg-white/10 transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h2 className="text-sm font-semibold text-white flex-1">编辑测试任务</h2>
        <button
          onClick={() => {
            const trimmed = name.trim() || task.name
            onUpdate({ ...task, name: trimmed, extraInfo: extraInfoRef.current?.value?.trim() || '' })
            onManage({ ...task, name: trimmed, extraInfo: extraInfoRef.current?.value?.trim() || '' })
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30
                     border border-amber-500/30 text-amber-300 text-xs font-medium transition-colors"
          title="进入画笔编辑模式"
        >
          <Pencil className="w-3 h-3" />
          画笔编辑
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4">
        <div>
          <label className="text-[11px] text-surface-400 font-medium mb-1.5 block">任务名称</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="输入任务名称"
            className={`w-full px-3 py-2 rounded-lg bg-surface-800/80 border text-sm text-surface-200
                       placeholder-surface-600 outline-none transition-colors ${
                         nameDuplicate ? 'border-red-500/50 focus:border-red-500' : 'border-white/10 focus:border-primary-500/50'
                       }`}
          />
          {nameDuplicate && (
            <p className="text-[11px] text-red-400 mt-1">此名称已被使用，请更换</p>
          )}
        </div>

        <div>
          <label className="text-[11px] text-surface-400 font-medium mb-1.5 block">额外信息</label>
          <textarea
            ref={extraInfoRef}
            defaultValue={task.extraInfo || ''}
            placeholder="输入额外备注信息"
            rows={3}
            className="w-full px-3 py-2 rounded-lg bg-surface-800/80 border border-white/10 text-sm text-surface-200
                       placeholder-surface-600 outline-none focus:border-primary-500/50 transition-colors resize-none"
          />
        </div>

        {IMAGE_TYPES.map(t => (
          <ImageDropZone
            key={t.key}
            label={t.label}
            filename={images[t.key]}
            onImport={() => handleImport(t.key)}
            onDrop={(e) => handleDrop(e, t.key)}
            onRemove={() => setImages(prev => ({ ...prev, [t.key]: null }))}
          />
        ))}

        {customImageTypes.map(ct => (
          <div key={ct.key} className="relative">
            <button
              onClick={() => handleRemoveCustomType(ct.key)}
              className="absolute top-0 right-0 z-10 p-1 rounded text-surface-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
              title="移除自定义类型"
            >
              <X className="w-3.5 h-3.5" />
            </button>
            <ImageDropZone
              label={ct.label}
              filename={images[ct.key]}
              onImport={() => handleImport(ct.key)}
              onDrop={(e) => handleDrop(e, ct.key)}
              onRemove={() => setImages(prev => ({ ...prev, [ct.key]: null }))}
            />
          </div>
        ))}

        {showAddCustom ? (
          <div className="flex items-center gap-2 bg-surface-800/40 rounded-lg p-3 border border-white/10">
            <input
              type="text"
              value={newCustomLabel}
              onChange={e => setNewCustomLabel(e.target.value)}
              placeholder="输入自定义类型名称（如：技能演示）"
              className="flex-1 px-3 py-1.5 rounded-lg bg-surface-800/80 border border-white/10 text-sm text-surface-200
                         placeholder-surface-600 outline-none focus:border-primary-500/50 transition-colors"
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter') handleAddCustomType(); if (e.key === 'Escape') setShowAddCustom(false) }}
            />
            <button
              onClick={handleAddCustomType}
              disabled={!newCustomLabel.trim()}
              className="px-3 py-1.5 rounded-lg bg-primary-500/20 border border-primary-500/30 text-primary-300 text-xs font-medium
                         hover:bg-primary-500/30 transition-colors disabled:opacity-50"
            >
              确认
            </button>
            <button
              onClick={() => { setShowAddCustom(false); setNewCustomLabel('') }}
              className="px-3 py-1.5 rounded-lg text-xs text-surface-400 hover:text-white hover:bg-white/5 transition-colors"
            >
              取消
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowAddCustom(true)}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 border-dashed border-surface-600
                       text-surface-400 text-xs hover:border-surface-500 hover:text-surface-300 transition-colors"
          >
            <Plus className="w-4 h-4" />
            添加更多
          </button>
        )}
      </div>

      <div className="flex items-center gap-3 px-4 py-3 border-t border-white/5">
        <button
          onClick={onBack}
          className="px-4 py-2 rounded-lg text-xs text-surface-400 hover:text-white hover:bg-white/5 transition-colors"
        >
          取消
        </button>
        <button
          onClick={() => { if (confirm('确定要删除此任务吗？')) onDelete(task.id) }}
          className="px-4 py-2 rounded-lg text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors"
        >
          删除任务
        </button>
        <div className="flex-1" />
        <button
          onClick={handleSave}
          disabled={!name.trim() || !hasAnyImage || saving}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium transition-colors ${
            name.trim() && hasAnyImage && !saving
              ? 'bg-primary-500 hover:bg-primary-600 text-white'
              : 'bg-surface-700 text-surface-500 cursor-not-allowed'
          }`}
        >
          {saving ? (
            <div className="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
          ) : (
            <Check className="w-3.5 h-3.5" />
          )}
          保存修改
        </button>
      </div>
    </div>
  )
}

function ImageDropZone({ label, filename, onImport, onDrop, onRemove }) {
  const [dragOver, setDragOver] = useState(false)
  const [preview, setPreview] = useState(null)
  const [imgLoading, setImgLoading] = useState(false)

  useEffect(() => {
    if (!filename) { setPreview(null); return }
    setImgLoading(true)
    window.electronAPI?.readUserImage(filename).then(res => {
      if (res?.data) setPreview(res.data)
      setImgLoading(false)
    }).catch(() => setImgLoading(false))
  }, [filename])

  return (
    <div>
      <label className="text-[11px] text-surface-400 font-medium mb-1.5 block">{label}</label>
      <div
        className={`relative rounded-xl border-2 border-dashed transition-all overflow-hidden ${
          dragOver
            ? 'border-primary-400 bg-primary-500/5'
            : filename
              ? 'border-green-500/30 bg-surface-800/50'
              : 'border-surface-600 hover:border-surface-500 bg-surface-800/30'
        }`}
        style={{ minHeight: 100 }}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { setDragOver(false); onDrop(e) }}
      >
        {filename ? (
          <div className="relative">
            {imgLoading ? (
              <div className="h-32 flex items-center justify-center">
                <div className="w-6 h-6 rounded-full border-2 border-surface-500 border-t-surface-300 animate-spin" />
              </div>
            ) : preview ? (
              <img src={preview} alt={label} className="w-full h-48 object-contain bg-surface-950/50" />
            ) : (
              <div className="h-32 flex items-center justify-center text-surface-500 text-xs">
                <Image className="w-6 h-6 mr-2 opacity-50" />{filename}
              </div>
            )}
            <button
              onClick={onRemove}
              className="absolute top-2 right-2 p-1.5 rounded-lg bg-red-500/80 hover:bg-red-500 text-white transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <button
            onClick={onImport}
            className="w-full h-32 flex flex-col items-center justify-center gap-2 text-surface-500 hover:text-surface-300 transition-colors"
          >
            <Upload className="w-6 h-6" />
            <span className="text-xs">点击导入或拖拽图片到此处</span>
          </button>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════
// 管理视图（查看图片 + 画笔）
// ═══════════════════════════════════════

// ── 绘制所有笔迹（纯函数，被多处复用）──
function drawAllStrokes(ctx, w, h, strokes, imgNaturalSize, showStrokes, previewY, okDragRect, pausePreview) {
  ctx.clearRect(0, 0, w, h)
  if (!showStrokes) return

  const scaleX = w / (imgNaturalSize.w || 1)
  const scaleY = h / (imgNaturalSize.h || 1)

  for (const s of strokes) {
    ctx.save()
    if (s.type === 'ok') {
      // 兼容新旧格式：新格式用 points 数组，旧格式用 y/height
      const hh = (s.height || 13) / 2
      ctx.globalAlpha = s.globalAlpha ?? 1
      ctx.fillStyle = 'rgba(34, 197, 94, 0.75)'
      ctx.strokeStyle = 'rgba(34, 197, 94, 0.9)'
      ctx.lineWidth = 1
      if (s.points) {
        // 统一取 min/max，一笔实心矩形，透明度均匀无叠加
        const ptsY = s.points.map(p => p.y * scaleY)
        const minY = Math.min(...ptsY)
        const maxY = Math.max(...ptsY)
        const totalH = (maxY - minY) + (s.height || 13)
        ctx.fillRect(0, minY - hh, w, totalH)
        ctx.strokeRect(0, minY - hh, w, totalH)
      } else {
        const y = s.y * scaleY
        ctx.fillRect(0, y - hh, w, s.height || 13)
        ctx.strokeRect(0, y - hh, w, s.height || 13)
      }
    } else if (s.type === 'pause') {
      const color = s.color || '#f97316'
      const r = s.radius || 10
      ctx.globalAlpha = s.globalAlpha ?? 0.55
      if (s.points.length === 1) {
        const px = s.points[0].x * scaleX
        const py = s.points[0].y * scaleY
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.arc(px, py, r, 0, Math.PI * 2)
        ctx.fill()
      } else {
        ctx.strokeStyle = color
        ctx.lineWidth = r * 2
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.beginPath()
        for (let i = 0; i < s.points.length; i++) {
          const px = s.points[i].x * scaleX
          const py = s.points[i].y * scaleY
          if (i === 0) ctx.moveTo(px, py)
          else ctx.lineTo(px, py)
        }
        ctx.stroke()
      }
    }
    ctx.restore()
  }

  // OK 拖动实时预览：展示从起点到当前位置的完整笔迹覆盖范围
  if (okDragRect) {
    const top = Math.min(okDragRect.y1, okDragRect.y2) * scaleY
    const bottom = Math.max(okDragRect.y1, okDragRect.y2) * scaleY
    const rh = Math.max(bottom - top, 13)
    ctx.save()
    ctx.globalAlpha = 0.5
    ctx.fillStyle = 'rgba(34, 197, 94, 0.6)'
    ctx.fillRect(0, top, w, rh)
    ctx.strokeStyle = 'rgba(34, 197, 94, 0.8)'
    ctx.lineWidth = 1
    ctx.setLineDash([4, 4])
    ctx.strokeRect(0, top, w, rh)
    ctx.setLineDash([])
    ctx.restore()
  }

  // 自由画笔悬停预览：显示圆圈光标
  if (pausePreview) {
    const px = pausePreview.x * scaleX
    const py = pausePreview.y * scaleY
    const color = pausePreview.color || '#f97316'
    const r = pausePreview.radius || 10
    ctx.save()
    ctx.globalAlpha = 0.5
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(px, py, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.restore()
  }

  // 悬停/拖动时居中光标条带（表示鼠标当前中心位置）
  if (previewY != null) {
    const py = previewY * scaleY
    ctx.save()
    ctx.globalAlpha = 0.8
    ctx.fillStyle = 'rgba(34, 197, 94, 0.9)'
    ctx.fillRect(0, py - 6.5, w, 13)
    ctx.strokeStyle = 'rgba(34, 197, 94, 1)'
    ctx.lineWidth = 1
    ctx.setLineDash([3, 3])
    ctx.strokeRect(0, py - 6.5, w, 13)
    ctx.setLineDash([])
    ctx.restore()
  }
}

function ManageView({ task, onUpdate, onDelete, onBack }) {
  const [activeTab, setActiveTab] = useState('summary')
  const [showStrokes, setShowStrokes] = useState(true)
  const [brush, setBrush] = useState('ok')
  const [pauseColor, setPauseColor] = useState('#f97316')
  const [showColorPicker, setShowColorPicker] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const canvasRef = useRef(null)
  const imageRef = useRef(null)
  const containerRef = useRef(null)
  const extraInfoRef = useRef(null)
  const [imageLoaded, setImageLoaded] = useState(false)
  const [imgDataUrl, setImgDataUrl] = useState(null)
  const [imgNaturalSize, setImgNaturalSize] = useState({ w: 0, h: 0 })
  const [cursorY, setCursorY] = useState(null)
  const [cursorPos, setCursorPos] = useState(null) // pause 画笔悬停时的光标位置 {x,y}

  // ── 笔迹管理 ──
  const strokesRef = useRef(task.strokes || { summary: [], constellation: [], questionnaire: [] })
  const getStrokes = useCallback(() => strokesRef.current[activeTab] || [], [activeTab])
  const showStrokesRef = useRef(showStrokes)
  const imgNaturalSizeRef = useRef(imgNaturalSize)
  const [undoStack, setUndoStack] = useState([])
  const [redoStack, setRedoStack] = useState([])

  useEffect(() => {
    strokesRef.current = task.strokes || { summary: [], constellation: [], questionnaire: [] }
  }, [task])
  useEffect(() => { showStrokesRef.current = showStrokes }, [showStrokes])
  useEffect(() => { imgNaturalSizeRef.current = imgNaturalSize }, [imgNaturalSize])

  // 仅在切换任务时重置撤销历史
  const prevTaskId = useRef(task.id)
  useEffect(() => {
    if (prevTaskId.current !== task.id) {
      prevTaskId.current = task.id
      setUndoStack([])
      setRedoStack([])
    }
  }, [task.id])

  const strokes = getStrokes()

  const saveStrokes = useCallback((newStrokes, pushUndo = true) => {
    const prev = getStrokes()
    if (pushUndo) {
      setUndoStack(s => [...s, prev])
      setRedoStack([])
    }
    strokesRef.current = { ...strokesRef.current, [activeTab]: newStrokes }
    onUpdate({ ...task, strokes: strokesRef.current, updatedAt: new Date().toISOString() })
  }, [activeTab, task, onUpdate, getStrokes])

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return
    const prev = undoStack[undoStack.length - 1]
    const currentStrokes = getStrokes() // 必须在 saveStrokes 之前捕获，否则 ref 已被覆盖
    setUndoStack(s => s.slice(0, -1))
    setRedoStack(s => [...s, currentStrokes])
    saveStrokes(prev, false)
  }, [saveStrokes, getStrokes, undoStack])

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) return
    const next = redoStack[redoStack.length - 1]
    const currentStrokes = getStrokes() // 必须在 saveStrokes 之前捕获
    setRedoStack(s => s.slice(0, -1))
    setUndoStack(s => [...s, currentStrokes])
    saveStrokes(next, false)
  }, [saveStrokes, getStrokes, redoStack])

  // ── 加载图片 ──
  useEffect(() => {
    const imageKey = activeTab + 'Image'
    const filename = getImageKey(task, activeTab)
    // 切换 tab 时立即清除加载状态，防止旧 canvas 残留造成撕裂
    setImageLoaded(false)
    setImgDataUrl(null)
    if (!filename) return

    let cancelled = false
    window.electronAPI?.readUserImage(filename).then(res => {
      if (cancelled || !res?.data) return
      setImgDataUrl(res.data)
      const img = new window.Image()
      img.onload = () => {
        if (cancelled) return
        setImgNaturalSize({ w: img.naturalWidth, h: img.naturalHeight })
        setImageLoaded(true)
      }
      img.src = res.data
    }).catch(() => {})
    return () => { cancelled = true }
  }, [activeTab, task.id])

  // ── Canvas 尺寸同步 & 主绘制（ResizeObserver 监听图片元素）──
  useEffect(() => {
    const imgEl = imageRef.current
    if (!imgEl || !imageLoaded) return

    const syncCanvas = () => {
      const canvas = canvasRef.current
      if (!canvas) return
      const w = imgEl.clientWidth
      const h = imgEl.clientHeight
      if (w === 0 || h === 0) return
      canvas.width = w
      canvas.height = h
      canvas.style.width = w + 'px'
      canvas.style.height = h + 'px'
      const ctx = canvas.getContext('2d')
      const curStrokes = strokesRef.current[activeTab] || []
      drawAllStrokes(ctx, w, h, curStrokes, imgNaturalSizeRef.current, showStrokesRef.current, null, null)
    }

    // 初始同步（可能在下一帧布局完成后才准确，用 rAF）
    requestAnimationFrame(syncCanvas)

    const observer = new ResizeObserver(() => {
      syncCanvas()
    })
    observer.observe(imgEl)
    return () => {
      observer.disconnect()
      // 清理 canvas 防止切换到无图片 tab 时残留
      const canvas = canvasRef.current
      if (canvas) {
        const ctx = canvas.getContext('2d')
        ctx.clearRect(0, 0, canvas.width, canvas.height)
      }
    }
  }, [imageLoaded, activeTab])

  // ── 数据变化重绘（不改 canvas 尺寸）──
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !imageLoaded) return
    const ctx = canvas.getContext('2d')
    const curStrokes = strokesRef.current[activeTab] || []
    drawAllStrokes(ctx, canvas.width, canvas.height, curStrokes, imgNaturalSizeRef.current, showStrokes, null, null)
  }, [strokes, showStrokes, imageLoaded])

  // ── Canvas 坐标转换 ──
  const getCanvasPos = useCallback((e) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    const scaleX = (imgNaturalSize.w || 1) / rect.width
    const scaleY = (imgNaturalSize.h || 1) / rect.height
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
      displayW: rect.width,
      displayH: rect.height,
    }
  }, [imgNaturalSize])

  // ── 鼠标事件 ──
  const isDrawing = useRef(false)
  const currentStroke = useRef(null)
  const erasedThisDrag = useRef(new Set())

  // ── 鼠标按下：仅 canvas 区域触发的绘制事件 ──
  const handleMouseDown = useCallback((e) => {
    if (e.button !== 0) return // 只响应左键，右键留给快捷切换笔迹可见
    if (!showStrokes || !imageLoaded) return
    if (e.target !== canvasRef.current) return
    const pos = getCanvasPos(e)

    if (brush === 'ok') {
      isDrawing.current = true
      currentStroke.current = {
        id: uid(),
        type: 'ok',
        height: 13,
        globalAlpha: 1,
        points: [{ y: pos.y }],
      }
    } else if (brush === 'pause') {
      isDrawing.current = true
      currentStroke.current = {
        id: uid(),
        type: 'pause',
        color: pauseColor,
        radius: 10,
        globalAlpha: 0.55,
        points: [{ x: pos.x, y: pos.y }],
      }
    } else if (brush === 'eraser') {
      isDrawing.current = true
      erasedThisDrag.current = new Set()
      const cur = getStrokes()
      const toRemove = findStrokesAt(cur, pos)
      if (toRemove.length > 0) {
        const removeIds = new Set(toRemove.map(s => s.id))
        toRemove.forEach(s => erasedThisDrag.current.add(s.id))
        saveStrokes(cur.filter(s => !removeIds.has(s.id)))
      }
    }
  }, [brush, saveStrokes, getCanvasPos, imageLoaded, showStrokes, pauseColor, getStrokes])

  const handleMouseMove = useCallback((e) => {
    const pos = getCanvasPos(e)
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const scaleX = canvas.width / (imgNaturalSize.w || 1)
    const scaleY = canvas.height / (imgNaturalSize.h || 1)

    // 光标预览
    if (!showStrokes) {
      setCursorY(null)
      setCursorPos(null)
    } else if (brush === 'ok' && !isDrawing.current) {
      setCursorY(pos.y)
      setCursorPos(null)
    } else if (brush === 'pause' && !isDrawing.current) {
      setCursorPos({ x: pos.x, y: pos.y })
      setCursorY(null)
    } else {
      setCursorY(null)
      setCursorPos(null)
    }

    // OK 画笔：沿路径实时绘制条带，松手保存为一笔
    if (isDrawing.current && brush === 'ok' && currentStroke.current) {
      currentStroke.current.points.push({ y: pos.y })
      const allStrokes = strokes.concat([currentStroke.current])
      drawAllStrokes(ctx, canvas.width, canvas.height, allStrokes, imgNaturalSize, showStrokes, pos.y, null)
    }

    // 自由画笔拖动：重绘全部笔迹+当前笔画，确保透明度均匀
    if (isDrawing.current && brush === 'pause' && currentStroke.current) {
      currentStroke.current.points.push({ x: pos.x, y: pos.y })
      const allStrokes = strokes.concat([currentStroke.current])
      drawAllStrokes(ctx, canvas.width, canvas.height, allStrokes, imgNaturalSize, showStrokes, null, null)
    }

    // 橡皮擦拖动：持续擦除接触到的笔迹
    if (isDrawing.current && brush === 'eraser') {
      const cur = strokesRef.current[activeTab] || []
      const toRemove = findStrokesAt(cur, pos)
      const newRemoveIds = []
      for (const s of toRemove) {
        if (!erasedThisDrag.current.has(s.id)) {
          erasedThisDrag.current.add(s.id)
          newRemoveIds.push(s.id)
        }
      }
      if (newRemoveIds.length > 0) {
        const removeSet = new Set(newRemoveIds)
        // 直接从 ref 更新避免闭包过期
        const fresh = strokesRef.current[activeTab] || []
        const newStrokes = fresh.filter(s => !removeSet.has(s.id))
        saveStrokes(newStrokes)
      }
    }
  }, [brush, getCanvasPos, pauseColor, imgNaturalSize, strokes, showStrokes, activeTab, saveStrokes])

  const handleMouseUp = useCallback(() => {
    if (!isDrawing.current) return

    if (brush === 'ok' && currentStroke.current) {
      const cur = getStrokes()
      saveStrokes([...cur, currentStroke.current])
      currentStroke.current = null
    }

    if (brush === 'pause' && currentStroke.current) {
      const cur = getStrokes()
      saveStrokes([...cur, currentStroke.current])
      currentStroke.current = null
    }

    if (brush === 'eraser') {
      erasedThisDrag.current = new Set()
    }

    isDrawing.current = false
  }, [brush, saveStrokes, getStrokes])

  const handleMouseLeave = useCallback(() => {
    setCursorY(null)
    setCursorPos(null)
    // 取消进行中的绘制
    if (isDrawing.current && (brush === 'ok' || brush === 'pause')) {
      currentStroke.current = null
      isDrawing.current = false
    } else if (isDrawing.current) {
      handleMouseUp()
    }
    // 无条件重绘 canvas，清除所有预览线
    const canvas = canvasRef.current
    if (canvas && imageLoaded) {
      const ctx = canvas.getContext('2d')
      drawAllStrokes(ctx, canvas.width, canvas.height, strokes, imgNaturalSize, showStrokes, null, null)
    }
  }, [handleMouseUp, strokes, imageLoaded, showStrokes, imgNaturalSize])

  // ── 画笔悬停预览 Effect（非拖动时） ──
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !imageLoaded || isDrawing.current) return
    const ctx = canvas.getContext('2d')
    if (brush === 'ok' && cursorY != null) {
      drawAllStrokes(ctx, canvas.width, canvas.height, strokes, imgNaturalSize, showStrokes, cursorY, null, null)
    } else if (brush === 'pause' && cursorPos) {
      drawAllStrokes(ctx, canvas.width, canvas.height, strokes, imgNaturalSize, showStrokes, null, null, { ...cursorPos, color: pauseColor, radius: 10 })
    }
  }, [cursorY, cursorPos, brush, strokes, showStrokes, imageLoaded, imgNaturalSize, pauseColor])

  // ── 快捷键 ──
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z' && e.shiftKey) { e.preventDefault(); handleRedo() }
        else if (e.key === 'z') { e.preventDefault(); handleUndo() }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleUndo, handleRedo])

  const hasImage = !!getImageKey(task, activeTab)

  const presetColors = [
    '#f97316', '#ef4444', '#3b82f6', '#22c55e', '#eab308',
    '#a855f7', '#ec4899', '#14b8a6', '#ffffff', '#fbbf24',
  ]

  const canUndo = undoStack.length > 0
  const canRedo = redoStack.length > 0

  return (
    <div className="h-full flex select-none">
      {/* ── 左侧控制栏 ── */}
      <div className="w-[148px] shrink-0 flex flex-col border-r border-white/5 bg-surface-800/30" onMouseDown={e => e.stopPropagation()}>
        {/* 返回 */}
        <div className="px-3 py-2 border-b border-white/5">
          <button onClick={onBack} className="flex items-center gap-1.5 text-xs text-surface-400 hover:text-white transition-colors">
            <ArrowLeft className="w-3.5 h-3.5" />
            <span className="truncate">{task.name}</span>
          </button>
        </div>

        {/* 图片切换 tabs */}
        <div className="px-2 py-2 border-b border-white/5 space-y-0.5">
          {[...IMAGE_TYPES, ...(task.customImageTypes || [])].map(t => {
            const hasImg = !!getImageKey(task, t.key)
            const completed = task.completedTypes?.[t.key]
            let dotColor = 'bg-surface-600'
            if (hasImg && completed) dotColor = 'bg-green-500'
            else if (hasImg) dotColor = 'bg-yellow-500'
            return (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  if (!hasImg) return
                  const newCompleted = !completed
                  const newCompletedTypes = { ...(task.completedTypes || {}), [t.key]: newCompleted }
                  onUpdate({ ...task, completedTypes: newCompletedTypes, updatedAt: new Date().toISOString() })
                }}
                className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] font-medium transition-colors text-left ${
                  activeTab === t.key
                    ? 'bg-white/10 text-white'
                    : 'text-surface-500 hover:text-surface-300 hover:bg-white/5'
                }`}
                title={hasImg ? (completed ? '已完成 — 右键切换为未完成' : '未完成 — 右键标记为已完成') : '暂无图片'}
              >
                <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`} />
                {t.label}
              </button>
            )
          })}
        </div>

        {/* 额外信息编辑 */}
        <div className="px-2 py-2 border-b border-white/5" onMouseDown={e => e.stopPropagation()}>
          <p className="text-[10px] text-surface-500 px-1 mb-1">额外信息</p>
          <textarea
            ref={extraInfoRef}
            defaultValue={task.extraInfo || ''}
            key={task.id}
            onChange={() => {
              onUpdate({ ...task, extraInfo: extraInfoRef.current?.value || '', updatedAt: new Date().toISOString() })
            }}
            placeholder="输入备注…"
            rows={2}
            className="w-full px-2 py-1.5 rounded-md bg-surface-900/60 border border-white/10 text-[11px] text-surface-300
                       placeholder-surface-600 outline-none focus:border-primary-500/40 transition-colors resize-none"
          />
        </div>

        {/* 画笔工具 */}
        <div className="px-2 py-2 border-b border-white/5 space-y-1" onMouseDown={e => e.stopPropagation()}>
          <p className="text-[10px] text-surface-500 px-1 mb-1">画笔</p>
          <button
            onClick={() => setBrush('ok')}
            disabled={!showStrokes}
            className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] font-medium transition-colors ${
              !showStrokes
                ? 'text-surface-600 cursor-not-allowed border border-transparent'
                : brush === 'ok' ? 'bg-green-500/20 text-green-400 border border-green-500/40' : 'text-surface-400 hover:text-white hover:bg-white/5 border border-transparent'
            }`}
            title={showStrokes ? 'OK - 水平绿色直线（长按拖动平滑覆盖）' : '笔迹已隐藏，请先显示笔迹'}
          >
            <Check className="w-3 h-3" />
            OK 画笔
          </button>

          <button
            onClick={() => setBrush('pause')}
            disabled={!showStrokes}
            className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] font-medium transition-colors ${
              !showStrokes
                ? 'text-surface-600 cursor-not-allowed border border-transparent'
                : brush === 'pause' ? 'bg-orange-500/20 text-orange-400 border border-orange-500/40' : 'text-surface-400 hover:text-white hover:bg-white/5 border border-transparent'
            }`}
            title={showStrokes ? '自由画笔（点按画圆，拖动涂鸦）' : '笔迹已隐藏，请先显示笔迹'}
          >
            <Pencil className="w-3 h-3" />
            自由画笔
          </button>

          {brush === 'pause' && (
            <div className="flex items-center gap-1.5 px-2 py-1">
              <span className="text-[10px] text-surface-500">颜色</span>
              <div className="relative">
                <button
                  onClick={() => setShowColorPicker(!showColorPicker)}
                  className="w-5 h-5 rounded-full border border-white/20 hover:border-white/40 transition-colors"
                  style={{ backgroundColor: pauseColor }}
                />
                {showColorPicker && (
                  <div
                    className="absolute top-7 left-0 z-50 p-1.5 rounded-xl bg-surface-800 border border-white/10 shadow-xl animate-fade-in"
                    onClick={() => setShowColorPicker(false)}
                  >
                    <div className="flex gap-1 flex-wrap w-28">
                      {presetColors.map(c => (
                        <button
                          key={c}
                          onClick={() => { setPauseColor(c); setShowColorPicker(false) }}
                          className={`w-5 h-5 rounded-full border-2 transition-all hover:scale-110 ${
                            pauseColor === c ? 'border-white' : 'border-transparent'
                          }`}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          <button
            onClick={() => setBrush('eraser')}
            disabled={!showStrokes}
            className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] font-medium transition-colors ${
              !showStrokes
                ? 'text-surface-600 cursor-not-allowed border border-transparent'
                : brush === 'eraser' ? 'bg-red-500/20 text-red-400 border border-red-500/40' : 'text-surface-400 hover:text-white hover:bg-white/5 border border-transparent'
            }`}
            title={showStrokes ? '橡皮擦 - 长按拖动持续擦除' : '笔迹已隐藏，请先显示笔迹'}
          >
            <Eraser className="w-3 h-3" />
            橡皮擦
          </button>
        </div>

        {/* 撤销 / 重做 */}
        <div className="px-2 py-2 border-b border-white/5 space-y-1">
          <p className="text-[10px] text-surface-500 px-1 mb-1">编辑</p>
          <div className="flex items-center gap-1">
            <button
              onClick={handleUndo}
              disabled={!canUndo}
              className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-md text-[11px] font-medium transition-colors ${
                canUndo ? 'text-surface-300 hover:text-white hover:bg-white/10 bg-white/5' : 'text-surface-600 cursor-not-allowed'
              }`}
              title="撤销 (Ctrl+Z)"
            >
              <Undo2 className="w-3 h-3" />
              撤销
            </button>
            <button
              onClick={handleRedo}
              disabled={!canRedo}
              className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-md text-[11px] font-medium transition-colors ${
                canRedo ? 'text-surface-300 hover:text-white hover:bg-white/10 bg-white/5' : 'text-surface-600 cursor-not-allowed'
              }`}
              title="重做 (Ctrl+Shift+Z)"
            >
              <Redo2 className="w-3 h-3" />
              重做
            </button>
          </div>
        </div>

        {/* 显示 / 删除 */}
        <div className="px-2 py-2 space-y-1">
          <button
            onClick={() => setShowStrokes(!showStrokes)}
            className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] font-medium transition-colors ${
              showStrokes ? 'text-surface-300 bg-white/5 border border-white/10' : 'text-surface-500 hover:text-surface-300 hover:bg-white/5 border border-transparent'
            }`}
          >
            {showStrokes ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
            笔迹{showStrokes ? '可见' : '隐藏'}
          </button>

          <div className="flex items-center justify-between px-2">
            <span className="text-[10px] text-surface-500">{strokes.length} 条笔迹</span>
          </div>

          <button
            onClick={() => { if (confirm('确定要删除此任务吗？')) onDelete(task.id) }}
            className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] text-surface-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <Trash2 className="w-3 h-3" />
            删除任务
          </button>
        </div>

        {/* ── 操作提示 ── */}
        <div className="border-t border-white/5">
          <button
            onClick={() => setShowHelp(!showHelp)}
            className="w-full flex items-center gap-1.5 px-3 py-2 text-[11px] text-surface-400 hover:text-surface-200 transition-colors"
          >
            <span className="w-4 h-4 rounded-full bg-surface-600 text-surface-300 text-[10px] font-bold flex items-center justify-center">i</span>
            操作提示
            <span className="ml-auto text-surface-600">{showHelp ? '▲' : '▼'}</span>
          </button>
          {showHelp && (
            <div className="px-3 pb-3 text-[10px] text-surface-500 space-y-1.5 leading-relaxed">
              <p><span className="text-green-400 font-medium">● OK 画笔</span>：点按放置绿色条带，长按拖动使条带跟随鼠标移动，松手放置。</p>
              <p><span className="text-orange-400 font-medium">● 自由画笔</span>：点按画圆标记，拖动涂鸦路径。可切换颜色。</p>
              <p><span className="text-red-400 font-medium">● 橡皮擦</span>：长按拖动擦除接触到的笔迹。</p>
              <p><span className="text-surface-400 font-medium">● 撤销/重做</span>：Ctrl+Z / Ctrl+Shift+Z 或点击按钮。</p>
              <p><span className="text-surface-400 font-medium">● 图片类型</span>：右键标签可在「已完成/未完成」间切换。</p>
            </div>
          )}
        </div>
      </div>

      {/* ── 右侧图片查看器 ── */}
      <div ref={containerRef} className="flex-1 overflow-auto relative bg-surface-950/50 betamemo-scroll">
        {!hasImage ? (
          <div className="h-full flex flex-col items-center justify-center text-surface-500">
            <Image className="w-12 h-12 mb-3 opacity-30" />
            <p className="text-xs">未导入图片</p>
            <p className="text-[11px] mt-1 opacity-60">返回任务列表后可重新编辑导入</p>
          </div>
        ) : !imgDataUrl ? (
          <div className="h-full flex items-center justify-center">
            <div className="w-8 h-8 rounded-full border-2 border-surface-500 border-t-surface-300 animate-spin" />
          </div>
        ) : (
          <div className="relative inline-block min-w-full">
            <img
              ref={imageRef}
              src={imgDataUrl}
              alt={[...IMAGE_TYPES, ...(task.customImageTypes || [])].find(t => t.key === activeTab)?.label || ''}
              className="max-w-full block"
              onLoad={() => setImageLoaded(true)}
              draggable={false}
            />
            <canvas
              ref={canvasRef}
              className="absolute top-0 left-0"
              style={{
                cursor: brush === 'eraser' ? 'crosshair' : brush === 'ok' ? 'crosshair' : 'crosshair',
                pointerEvents: 'auto',
              }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseLeave}
              onContextMenu={e => { e.preventDefault(); setShowStrokes(s => !s) }}
            />
          </div>
        )}
      </div>
    </div>
  )
}


// ── 辅助：查找某个自然坐标位置附近的笔迹 ──
function findStrokesAt(strokes, pos) {
  const result = []
  for (const s of strokes) {
    if (s.type === 'ok') {
      const halfH = (s.height || 13) / 2
      if (s.points) {
        for (const p of s.points) {
          if (Math.abs(pos.y - p.y) <= halfH + 4) {
            result.push(s)
            break
          }
        }
      } else {
        const y = s.y
        if (Math.abs(pos.y - y) <= halfH + 4) {
          result.push(s)
        }
      }
    } else if (s.type === 'pause') {
      for (const p of s.points) {
        const dx = pos.x - p.x
        const dy = pos.y - p.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist < (s.radius || 10) * 1.5) {
          result.push(s)
          break
        }
      }
    }
  }
  return result
}

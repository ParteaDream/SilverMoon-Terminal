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

const STORAGE_KEY = 'betamemo_tasks'

// ═══════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

async function loadTasks() {
  try {
    const res = await window.electronAPI?.getUserConfig()
    return res?.config?.[STORAGE_KEY] || []
  } catch { return [] }
}

async function saveTasks(tasks) {
  try {
    await window.electronAPI?.setUserConfig(STORAGE_KEY, tasks)
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

  useEffect(() => { loadTasks().then(t => { setTasks(t); setLoading(false) }) }, [])

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

  const handleBack = useCallback(async () => {
    setView('list')
    setSelectedTask(null)
    await refreshTasks()
  }, [refreshTasks])

  const handleSaveTask = useCallback(async (newTask) => {
    const updated = [...tasks, newTask]
    setTasks(updated)
    await saveTasks(updated)
    setView('list')
  }, [tasks])

  const handleUpdateTask = useCallback(async (updatedTask) => {
    const updated = tasks.map(t => t.id === updatedTask.id ? updatedTask : t)
    setTasks(updated)
    await saveTasks(updated)
    setSelectedTask(updatedTask)
  }, [tasks])

  const handleDeleteTask = useCallback(async (taskId) => {
    const updated = tasks.filter(t => t.id !== taskId)
    setTasks(updated)
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
      return <CreateView onSave={handleSaveTask} onCancel={handleBack} />
    case 'manage':
      return selectedTask
        ? <ManageView task={selectedTask} onUpdate={handleUpdateTask} onDelete={handleDeleteTask} onBack={handleBack} />
        : <TaskListView tasks={tasks} onCreate={handleCreate} onManage={handleManage} />
    default:
      return <TaskListView tasks={tasks} onCreate={handleCreate} onManage={handleManage} />
  }
}

// ═══════════════════════════════════════
// 任务列表视图
// ═══════════════════════════════════════
function TaskListView({ tasks, onCreate, onManage }) {
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
            {tasks.map(task => (
              <TaskCard key={task.id} task={task} onClick={() => onManage(task)} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function TaskCard({ task, onClick }) {
  const imgCount = [task.summaryImage, task.constellationImage, task.questionnaireImage].filter(Boolean).length
  return (
    <button
      onClick={onClick}
      className="w-full text-left p-4 rounded-xl bg-surface-800/50 border border-white/5
                 hover:bg-surface-800 hover:border-white/10 transition-all group"
    >
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-surface-200 truncate">{task.name || '未命名任务'}</h3>
          <p className="text-[11px] text-surface-500 mt-1">
            {imgCount}/3 张图片 · {task.createdAt ? new Date(task.createdAt).toLocaleDateString('zh-CN') : ''}
          </p>
        </div>
        <div className="flex gap-1 shrink-0 ml-3">
          {IMAGE_TYPES.map(t => (
            <div key={t.key} className={`w-2 h-2 rounded-full ${task[t.key + 'Image'] ? 'bg-green-500' : 'bg-surface-600'}`} />
          ))}
        </div>
      </div>
    </button>
  )
}

// ═══════════════════════════════════════
// 创建视图
// ═══════════════════════════════════════
function CreateView({ onSave, onCancel }) {
  const [name, setName] = useState('')
  const [images, setImages] = useState({ summary: null, constellation: null, questionnaire: null })
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
    const file = e.dataTransfer?.files?.[0]
    if (!file) return
    const filePath = file.path
    if (filePath) {
      const result = await window.electronAPI?.importUserImageFile(filePath)
      if (result?.filename) {
        setImages(prev => ({ ...prev, [typeKey]: result.filename }))
      }
    }
  }, [])

  const handleSave = useCallback(async () => {
    if (!name.trim()) return
    setSaving(true)
    const task = {
      id: uid(),
      name: name.trim(),
      summaryImage: images.summary,
      constellationImage: images.constellation,
      questionnaireImage: images.questionnaire,
      strokes: { summary: [], constellation: [], questionnaire: [] },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    await onSave(task)
    setSaving(false)
  }, [name, images, onSave])

  const hasAnyImage = Object.values(images).some(Boolean)

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
            onChange={e => setName(e.target.value)}
            placeholder="输入任务名称（如：V3.2 测试服第1周）"
            className="w-full px-3 py-2 rounded-lg bg-surface-800/80 border border-white/10 text-sm text-surface-200
                       placeholder-surface-600 outline-none focus:border-primary-500/50 transition-colors"
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
function drawAllStrokes(ctx, w, h, strokes, imgNaturalSize, showStrokes, previewY, okDragRect) {
  ctx.clearRect(0, 0, w, h)
  if (!showStrokes && previewY == null && !okDragRect) return

  const scaleX = w / (imgNaturalSize.w || 1)
  const scaleY = h / (imgNaturalSize.h || 1)

  for (const s of strokes) {
    ctx.save()
    if (s.type === 'ok') {
      const y = s.y * scaleY
      const hh = (s.height || 13) / 2
      ctx.globalAlpha = s.globalAlpha ?? 1
      ctx.fillStyle = 'rgba(34, 197, 94, 0.75)'
      ctx.fillRect(0, y - hh, w, s.height || 13)
      ctx.strokeStyle = 'rgba(34, 197, 94, 0.9)'
      ctx.lineWidth = 1
      ctx.strokeRect(0, y - hh, w, s.height || 13)
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

  // OK 拖动实时预览（平滑矩形区域）
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

  // 悬停预览线（非拖动时的 OK 预览）
  if (previewY != null && !okDragRect) {
    const py = previewY * scaleY
    ctx.save()
    ctx.globalAlpha = 0.4
    ctx.fillStyle = 'rgba(34, 197, 94, 0.6)'
    ctx.fillRect(0, py - 6.5, w, 13)
    ctx.strokeStyle = 'rgba(34, 197, 94, 0.8)'
    ctx.lineWidth = 1
    ctx.setLineDash([4, 4])
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
  const canvasRef = useRef(null)
  const imageRef = useRef(null)
  const containerRef = useRef(null)
  const [imageLoaded, setImageLoaded] = useState(false)
  const [imgDataUrl, setImgDataUrl] = useState(null)
  const [imgNaturalSize, setImgNaturalSize] = useState({ w: 0, h: 0 })
  const [cursorY, setCursorY] = useState(null)

  // ── 笔迹管理 ──
  const strokesRef = useRef(task.strokes || { summary: [], constellation: [], questionnaire: [] })
  const getStrokes = useCallback(() => strokesRef.current[activeTab] || [], [activeTab])
  const undoStackRef = useRef([])
  const redoStackRef = useRef([])

  useEffect(() => {
    strokesRef.current = task.strokes || { summary: [], constellation: [], questionnaire: [] }
    undoStackRef.current = []
    redoStackRef.current = []
  }, [task])

  const strokes = getStrokes()

  const saveStrokes = useCallback((newStrokes, pushUndo = true) => {
    const prev = getStrokes()
    if (pushUndo && prev.length > 0) {
      undoStackRef.current.push(prev)
      redoStackRef.current = []
    }
    strokesRef.current = { ...strokesRef.current, [activeTab]: newStrokes }
    onUpdate({ ...task, strokes: strokesRef.current, updatedAt: new Date().toISOString() })
  }, [activeTab, task, onUpdate, getStrokes])

  const handleUndo = useCallback(() => {
    const stack = undoStackRef.current
    if (stack.length === 0) return
    const prev = stack.pop()
    redoStackRef.current.push(getStrokes())
    saveStrokes(prev, false)
  }, [saveStrokes, getStrokes])

  const handleRedo = useCallback(() => {
    const stack = redoStackRef.current
    if (stack.length === 0) return
    const next = stack.pop()
    undoStackRef.current.push(getStrokes())
    saveStrokes(next, false)
  }, [saveStrokes, getStrokes])

  // ── 加载图片 ──
  useEffect(() => {
    const imageKey = activeTab + 'Image'
    const filename = task[imageKey]
    if (!filename) {
      setImgDataUrl(null)
      setImageLoaded(false)
      return
    }
    window.electronAPI?.readUserImage(filename).then(res => {
      if (res?.data) {
        setImgDataUrl(res.data)
        const img = new window.Image()
        img.onload = () => {
          setImgNaturalSize({ w: img.naturalWidth, h: img.naturalHeight })
          setImageLoaded(true)
        }
        img.src = res.data
      }
    }).catch(() => setImgDataUrl(null))
  }, [activeTab, task])

  // ── 主绘制 Effect ──
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !imageLoaded) return
    const container = containerRef.current
    if (!container) return
    const imgEl = imageRef.current
    const w = imgEl?.clientWidth || container.clientWidth
    const h = imgEl?.clientHeight || container.clientHeight
    canvas.width = w
    canvas.height = h
    canvas.style.width = w + 'px'
    canvas.style.height = h + 'px'
    const ctx = canvas.getContext('2d')
    drawAllStrokes(ctx, w, h, strokes, imgNaturalSize, showStrokes, null, null)
  }, [strokes, showStrokes, imageLoaded, imgNaturalSize])

  // ── 窗口 resize 重绘 ──
  useEffect(() => {
    const handleResize = () => {
      const canvas = canvasRef.current
      if (!canvas || !imageLoaded) return
      const container = containerRef.current
      const imgEl = imageRef.current
      if (!container || !imgEl) return
      const w = imgEl.clientWidth || container.clientWidth
      const h = imgEl.clientHeight || container.clientHeight
      canvas.width = w
      canvas.height = h
      canvas.style.width = w + 'px'
      canvas.style.height = h + 'px'
      const ctx = canvas.getContext('2d')
      drawAllStrokes(ctx, w, h, strokes, imgNaturalSize, showStrokes, null, null)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [strokes, showStrokes, imageLoaded, imgNaturalSize])

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
  const okStartY = useRef(null)
  const okCurrentY = useRef(null)
  const erasedThisDrag = useRef(new Set()) // 一次拖动中已擦除的 stroke ID 集合

  const handleMouseDown = useCallback((e) => {
    if (!imageLoaded) return
    const pos = getCanvasPos(e)

    if (brush === 'ok') {
      isDrawing.current = true
      okStartY.current = pos.y
      okCurrentY.current = pos.y
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
      // 立即擦除当前位置的笔迹
      const cur = getStrokes()
      const toRemove = findStrokesAt(cur, pos)
      if (toRemove.length > 0) {
        const removeIds = new Set(toRemove.map(s => s.id))
        toRemove.forEach(s => erasedThisDrag.current.add(s.id))
        saveStrokes(cur.filter(s => !removeIds.has(s.id)))
      }
    }
  }, [brush, saveStrokes, getCanvasPos, imageLoaded, pauseColor, getStrokes])

  const handleMouseMove = useCallback((e) => {
    const pos = getCanvasPos(e)
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const scaleX = canvas.width / (imgNaturalSize.w || 1)
    const scaleY = canvas.height / (imgNaturalSize.h || 1)

    // 光标预览
    setCursorY(brush === 'ok' && !isDrawing.current ? pos.y : null)

    // OK 画笔拖动：平滑覆盖从起始 Y 到当前 Y 的连续区域
    if (isDrawing.current && brush === 'ok') {
      okCurrentY.current = pos.y
      // 重绘全部笔迹 + OK 拖动预览
      drawAllStrokes(ctx, canvas.width, canvas.height, strokes, imgNaturalSize, showStrokes, null, {
        y1: okStartY.current,
        y2: okCurrentY.current,
      })
    }

    // Pause 画笔拖动：实时绘制
    if (isDrawing.current && brush === 'pause' && currentStroke.current) {
      currentStroke.current.points.push({ x: pos.x, y: pos.y })
      const pts = currentStroke.current.points
      const lastTwo = pts.slice(-2)
      if (lastTwo.length === 2) {
        ctx.save()
        ctx.globalAlpha = 0.55
        ctx.strokeStyle = pauseColor
        ctx.lineWidth = 20
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.beginPath()
        ctx.moveTo(lastTwo[0].x * scaleX, lastTwo[0].y * scaleY)
        ctx.lineTo(lastTwo[1].x * scaleX, lastTwo[1].y * scaleY)
        ctx.stroke()
        ctx.restore()
      }
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

    if (brush === 'ok' && okStartY.current != null) {
      const y1 = okStartY.current
      const y2 = okCurrentY.current
      const minY = Math.min(y1, y2)
      const maxY = Math.max(y1, y2)
      const height = Math.max(maxY - minY, 13)
      const newStroke = {
        id: uid(),
        type: 'ok',
        y: (minY + maxY) / 2,
        height,
        globalAlpha: 1,
      }
      const cur = getStrokes()
      saveStrokes([...cur, newStroke])
      okStartY.current = null
      okCurrentY.current = null
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
    handleMouseUp()
  }, [handleMouseUp])

  // ── OK 画笔悬停预览 Effect（非拖动时） ──
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || brush !== 'ok' || cursorY == null || !imageLoaded || isDrawing.current) return
    const ctx = canvas.getContext('2d')
    drawAllStrokes(ctx, canvas.width, canvas.height, strokes, imgNaturalSize, showStrokes, cursorY, null)
  }, [cursorY, brush, strokes, showStrokes, imageLoaded, imgNaturalSize])

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

  const currentImageKey = activeTab + 'Image'
  const hasImage = !!task[currentImageKey]

  const presetColors = [
    '#f97316', '#ef4444', '#3b82f6', '#22c55e', '#eab308',
    '#a855f7', '#ec4899', '#14b8a6', '#ffffff', '#fbbf24',
  ]

  const canUndo = undoStackRef.current.length > 0
  const canRedo = redoStackRef.current.length > 0

  return (
    <div className="h-full flex flex-col">
      {/* Header: 返回 + 任务名 + 图片切换tabs + 删除 */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/5">
        <button onClick={onBack} className="p-1 rounded-md text-surface-400 hover:text-white hover:bg-white/10 transition-colors shrink-0">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h2 className="text-xs font-semibold text-white truncate">{task.name}</h2>

        {/* 图片类型 tabs */}
        <div className="flex items-center gap-0.5 ml-2">
          {IMAGE_TYPES.map(t => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-colors ${
                activeTab === t.key
                  ? 'bg-white/10 text-white'
                  : 'text-surface-500 hover:text-surface-300 hover:bg-white/5'
              }`}
            >
              <div className={`w-1.5 h-1.5 rounded-full ${task[t.key + 'Image'] ? 'bg-green-500' : 'bg-surface-600'}`} />
              {t.short}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        <button
          onClick={() => { if (confirm('确定要删除此任务吗？')) onDelete(task.id) }}
          className="p-1 rounded-md text-surface-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
          title="删除任务"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Toolbar: 画笔 + 撤销/重做 */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-white/5 bg-surface-800/20">
        <button
          onClick={() => setBrush('ok')}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
            brush === 'ok' ? 'bg-green-500/20 text-green-400 border border-green-500/40' : 'text-surface-400 hover:text-white hover:bg-white/5 border border-transparent'
          }`}
          title="OK - 水平绿色直线，覆盖已完成任务（支持长按拖动平滑覆盖区域）"
        >
          <Check className="w-3 h-3" />
          OK
        </button>

        <button
          onClick={() => setBrush('pause')}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
            brush === 'pause' ? 'bg-orange-500/20 text-orange-400 border border-orange-500/40' : 'text-surface-400 hover:text-white hover:bg-white/5 border border-transparent'
          }`}
          title="暂停 - 自由画笔（点按画圆，拖动涂鸦）"
        >
          <Pencil className="w-3 h-3" />
          暂停
        </button>

        {brush === 'pause' && (
          <div className="relative">
            <button
              onClick={() => setShowColorPicker(!showColorPicker)}
              className="w-5 h-5 rounded-full border border-white/20 hover:border-white/40 transition-colors"
              style={{ backgroundColor: pauseColor }}
              title="选择颜色"
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
        )}

        <button
          onClick={() => setBrush('eraser')}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
            brush === 'eraser' ? 'bg-red-500/20 text-red-400 border border-red-500/40' : 'text-surface-400 hover:text-white hover:bg-white/5 border border-transparent'
          }`}
          title="橡皮擦 - 长按拖动持续擦除"
        >
          <Eraser className="w-3 h-3" />
          橡皮擦
        </button>

        <div className="flex-1" />

        {/* 撤销 / 重做（放在工具栏行） */}
        <button
          onClick={handleUndo}
          disabled={!canUndo}
          className={`p-1 rounded-md transition-colors ${canUndo ? 'text-surface-400 hover:text-white hover:bg-white/10' : 'text-surface-600 cursor-not-allowed'}`}
          title="撤销 (Ctrl+Z)"
        >
          <Undo2 className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={handleRedo}
          disabled={!canRedo}
          className={`p-1 rounded-md transition-colors ${canRedo ? 'text-surface-400 hover:text-white hover:bg-white/10' : 'text-surface-600 cursor-not-allowed'}`}
          title="重做 (Ctrl+Shift+Z)"
        >
          <Redo2 className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={() => setShowStrokes(!showStrokes)}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
            showStrokes ? 'text-surface-300 bg-white/5 border border-white/10' : 'text-surface-500 border border-transparent'
          }`}
          title={showStrokes ? '隐藏笔迹' : '显示笔迹'}
        >
          {showStrokes ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
          {showStrokes ? '可见' : '隐藏'}
        </button>

        <span className="text-[10px] text-surface-500 w-8 text-right">{strokes.length}</span>
      </div>

      {/* Image viewer */}
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
              alt={IMAGE_TYPES.find(t => t.key === activeTab)?.label || ''}
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
      const y = s.y
      const halfH = (s.height || 13) / 2
      if (Math.abs(pos.y - y) <= halfH + 10) {
        result.push(s)
      }
    } else if (s.type === 'pause') {
      for (const p of s.points) {
        const dx = pos.x - p.x
        const dy = pos.y - p.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist < (s.radius || 10) * 2 + 5) {
          result.push(s)
          break
        }
      }
    }
  }
  return result
}

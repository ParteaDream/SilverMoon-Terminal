import { useState, useEffect, useRef, useCallback } from 'react'
import { RotateCcw } from 'lucide-react'

// ═══════════════════════════════════════
// 常量
// ═══════════════════════════════════════
const GRID_SIZE = 15
const CELL_SIZE = 30
const BORDER = 3
const CANVAS_PX = GRID_SIZE * CELL_SIZE + BORDER * 2 // 456

const STORAGE_KEY = 'dragonsnake_highscore'

const DIR = {
  up:    { x: 0, y: -1 },
  down:  { x: 0, y: 1 },
  left:  { x: -1, y: 0 },
  right: { x: 1, y: 0 },
}

// 头部角度：head.png 原图朝左 ←
const HEAD_ANGLE = {
  up:    Math.PI / 2,   // 顺时针 90°：左 → 上
  down:  -Math.PI / 2,  // 逆时针 90°：左 → 下
  left:  0,              // 原图朝左
  right: Math.PI,        // 180°：左 → 右
}

// 尾部角度：tail.png 原图朝右 →
const TAIL_ANGLE = {
  up:    -Math.PI / 2,  // 逆时针 90°：右 → 上
  down:  Math.PI / 2,   // 顺时针 90°：右 → 下
  left:  Math.PI,        // 180°：右 → 左
  right: 0,              // 原图朝右
}

const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' }

// WASD → 方向映射
const KEY_TO_DIR = { w: 'up', a: 'left', s: 'down', d: 'right' }

function createInitialSnake() {
  return [
    { x: 9, y: 7 },
    { x: 8, y: 7 },
    { x: 7, y: 7 },
  ]
}

function randomFood(snake) {
  const occupied = new Set(snake.map(s => `${s.x},${s.y}`))
  const free = []
  for (let x = 0; x < GRID_SIZE; x++) {
    for (let y = 0; y < GRID_SIZE; y++) {
      if (!occupied.has(`${x},${y}`)) free.push({ x, y })
    }
  }
  if (free.length === 0) return null
  return free[Math.floor(Math.random() * free.length)]
}

// ═══════════════════════════════════════
// 主组件
// ═══════════════════════════════════════
export default function DragonSnake() {
  const [gameState, setGameState] = useState('idle')
  const [score, setScore] = useState(0)
  const [highScore, setHighScore] = useState(0)
  const [isNewRecord, setIsNewRecord] = useState(false)
  const [activeKeys, setActiveKeys] = useState({})

  const canvasRef = useRef(null)
  const snakeRef = useRef(createInitialSnake())
  const directionRef = useRef('right')
  const nextDirRef = useRef('right')
  const foodRef = useRef(null)
  const tickIdRef = useRef(null)
  const tailDirRef = useRef('right')
  const imagesRef = useRef({})
  const imagesReadyRef = useRef(false)
  const gameStateRef = useRef('idle')
  const scoreRef = useRef(0)
  const highScoreRef = useRef(0)

  useEffect(() => { gameStateRef.current = gameState }, [gameState])
  useEffect(() => { scoreRef.current = score }, [score])
  useEffect(() => { highScoreRef.current = highScore }, [highScore])

  // ── 绘制帧 ──
  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const size = CANVAS_PX
    const dpr = window.devicePixelRatio || 1

    canvas.width = size * dpr
    canvas.height = size * dpr
    canvas.style.width = size + 'px'
    canvas.style.height = size + 'px'
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const imgs = imagesRef.current
    const ready = imagesReadyRef.current

    // ── 网格外侧区域 #030D20 ──
    ctx.fillStyle = '#030D20'
    ctx.fillRect(0, 0, size, size)

    // ── 网格底色 #212334 ──
    ctx.fillStyle = '#212334'
    ctx.fillRect(BORDER, BORDER, GRID_SIZE * CELL_SIZE, GRID_SIZE * CELL_SIZE)

    // 网格线
    ctx.strokeStyle = '#212438'
    ctx.lineWidth = 1
    for (let i = 0; i <= GRID_SIZE; i++) {
      const px = BORDER + i * CELL_SIZE
      ctx.beginPath()
      ctx.moveTo(px, BORDER)
      ctx.lineTo(px, BORDER + GRID_SIZE * CELL_SIZE)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(BORDER, px)
      ctx.lineTo(BORDER + GRID_SIZE * CELL_SIZE, px)
      ctx.stroke()
    }

    // 3px 外边框
    ctx.strokeStyle = '#272E4C'
    ctx.lineWidth = 1
    ctx.strokeRect(0.5, 0.5, size - 1, size - 1)
    ctx.strokeStyle = '#39405E'
    ctx.strokeRect(1.5, 1.5, size - 3, size - 3)
    ctx.strokeStyle = '#272E4C'
    ctx.strokeRect(2.5, 2.5, size - 5, size - 5)

    // 裁剪到网格区域
    ctx.save()
    ctx.beginPath()
    ctx.rect(BORDER, BORDER, GRID_SIZE * CELL_SIZE, GRID_SIZE * CELL_SIZE)
    ctx.clip()

    // 食物
    const food = foodRef.current
    if (food) {
      const fx = BORDER + food.x * CELL_SIZE
      const fy = BORDER + food.y * CELL_SIZE
      if (ready && imgs.food) {
        ctx.drawImage(imgs.food, fx, fy, CELL_SIZE, CELL_SIZE)
      } else {
        const fcx = fx + CELL_SIZE / 2
        const fcy = fy + CELL_SIZE / 2
        ctx.fillStyle = '#ffdd57'
        ctx.beginPath()
        ctx.arc(fcx, fcy, CELL_SIZE * 0.35, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    // 蛇（从尾到头绘制，尾巴在底层）
    const snake = snakeRef.current
    for (let i = snake.length - 1; i >= 0; i--) {
      const seg = snake[i]
      const sx = BORDER + seg.x * CELL_SIZE
      const sy = BORDER + seg.y * CELL_SIZE
      const cx = sx + CELL_SIZE / 2
      const cy = sy + CELL_SIZE / 2

      if (i === 0) {
        // 头 — head.png 原图朝左
        const headAngle = HEAD_ANGLE[directionRef.current] ?? 0
        if (ready && imgs.head) {
          ctx.save()
          ctx.translate(cx, cy)
          ctx.rotate(headAngle)
          ctx.drawImage(imgs.head, -CELL_SIZE / 2, -CELL_SIZE / 2, CELL_SIZE, CELL_SIZE)
          ctx.restore()
        } else {
          ctx.fillStyle = '#4ade80'
          ctx.fillRect(sx + 2, sy + 2, CELL_SIZE - 4, CELL_SIZE - 4)
        }
      } else if (i === snake.length - 1) {
        // 尾 — tail.png 原图朝右
        const tailAngle = TAIL_ANGLE[tailDirRef.current] ?? 0
        if (ready && imgs.tail) {
          ctx.save()
          ctx.translate(cx, cy)
          ctx.rotate(tailAngle)
          ctx.drawImage(imgs.tail, -CELL_SIZE / 2, -CELL_SIZE / 2, CELL_SIZE, CELL_SIZE)
          ctx.restore()
        } else {
          ctx.fillStyle = '#34d399'
          ctx.fillRect(sx + 2, sy + 2, CELL_SIZE - 4, CELL_SIZE - 4)
        }
      } else {
        // 身体
        if (ready && imgs.body) {
          ctx.drawImage(imgs.body, sx, sy, CELL_SIZE, CELL_SIZE)
        } else {
          ctx.fillStyle = '#22c55e'
          ctx.fillRect(sx + 2, sy + 2, CELL_SIZE - 4, CELL_SIZE - 4)
        }
      }
    }

    ctx.restore()

    // 暂停覆盖层
    if (gameStateRef.current === 'paused') {
      ctx.fillStyle = 'rgba(0,0,0,0.45)'
      ctx.fillRect(0, 0, size, size)
      ctx.fillStyle = '#ffffff'
      ctx.font = '600 18px "PingFang SC", "Microsoft YaHei", sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('⏸ 暂停中', size / 2, size / 2)
      ctx.font = '400 13px "PingFang SC", "Microsoft YaHei", sans-serif'
      ctx.fillStyle = 'rgba(255,255,255,0.6)'
      ctx.fillText('按 SPACE 或点击按钮继续', size / 2, size / 2 + 28)
      ctx.textAlign = 'start'
    }

    // 空闲覆盖层
    if (gameStateRef.current === 'idle') {
      ctx.fillStyle = 'rgba(0,0,0,0.45)'
      ctx.fillRect(0, 0, size, size)
      ctx.fillStyle = '#ffffff'
      ctx.font = '600 16px "PingFang SC", "Microsoft YaHei", sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('按任意键开始', size / 2, size / 2 + CELL_SIZE * 3)
      ctx.textAlign = 'start'
    }

    // 死亡覆盖层
    if (gameStateRef.current === 'dead') {
      ctx.fillStyle = 'rgba(0,0,0,0.55)'
      ctx.fillRect(0, 0, size, size)
    }
  }, [])

  // ── 加载图片 ──
  useEffect(() => {
    const sources = { head: './head.png', body: './body.png', tail: './tail.png', food: './EP.png' }
    let loaded = 0
    const total = Object.keys(sources).length
    const imgs = {}

    Object.entries(sources).forEach(([key, src]) => {
      const img = new Image()
      img.src = src
      img.onload = img.onerror = () => {
        loaded++
        if (loaded >= total) {
          imagesRef.current = imgs
          imagesReadyRef.current = true
          drawFrame()
        }
      }
      imgs[key] = img
    })
  }, [drawFrame])

  // ── 加载/保存最高记录 ──
  useEffect(() => {
    (async () => {
      try {
        const res = await window.electronAPI?.getUserConfig()
        const hs = res?.config?.[STORAGE_KEY] || 0
        setHighScore(hs)
        highScoreRef.current = hs
      } catch { setHighScore(0) }
    })()
  }, [])

  const saveHighScore = useCallback(async (hs) => {
    try { await window.electronAPI?.setUserConfig(STORAGE_KEY, hs) } catch { /* */ }
  }, [])

  // ── 游戏 tick ──
  const gameTickRef = useRef(null)

  const stopTick = useCallback(() => {
    if (tickIdRef.current) {
      clearInterval(tickIdRef.current)
      tickIdRef.current = null
    }
  }, [])

  const startTick = useCallback((speed) => {
    stopTick()
    tickIdRef.current = setInterval(() => {
      gameTickRef.current?.()
    }, speed)
  }, [stopTick])

  const gameTick = useCallback(() => {
    const snake = snakeRef.current
    const dir = nextDirRef.current
    directionRef.current = dir

    const head = snake[0]
    const newHead = { x: head.x + DIR[dir].x, y: head.y + DIR[dir].y }

    // 碰墙
    if (newHead.x < 0 || newHead.x >= GRID_SIZE || newHead.y < 0 || newHead.y >= GRID_SIZE) {
      return die()
    }

    // 碰自己
    const willGrow = foodRef.current && newHead.x === foodRef.current.x && newHead.y === foodRef.current.y
    const checkLen = willGrow ? snake.length : snake.length - 1
    for (let i = 0; i < checkLen; i++) {
      if (snake[i].x === newHead.x && snake[i].y === newHead.y) {
        return die()
      }
    }

    const oldTail = snake[snake.length - 1]

    // 移动
    const newSnake = [newHead, ...snake]
    if (!willGrow) {
      newSnake.pop()
    }
    snakeRef.current = newSnake

    // 更新尾巴朝向：朝向上一刻所在位置
    if (!willGrow) {
      const newTail = newSnake[newSnake.length - 1]
      const dx = oldTail.x - newTail.x   // 旧尾相对于新尾的偏移
      const dy = oldTail.y - newTail.y
      // 旧尾在新尾右侧 → 尾朝右
      if (dx === 1) tailDirRef.current = 'right'
      else if (dx === -1) tailDirRef.current = 'left'
      else if (dy === 1) tailDirRef.current = 'down'
      else if (dy === -1) tailDirRef.current = 'up'
    }

    // 吃食物
    if (willGrow) {
      const newScore = scoreRef.current + 1
      setScore(newScore)
      scoreRef.current = newScore
      foodRef.current = randomFood(newSnake)
      const speed = Math.max(60, 150 - newScore * 2)
      startTick(speed)
    }

    drawFrame()
  }, [drawFrame, startTick])

  useEffect(() => {
    gameTickRef.current = gameTick
  }, [gameTick])

  const die = useCallback(() => {
    stopTick()
    setGameState('dead')
    gameStateRef.current = 'dead'

    const finalScore = scoreRef.current
    const hs = highScoreRef.current
    if (finalScore > hs) {
      setIsNewRecord(true)
      setHighScore(finalScore)
      highScoreRef.current = finalScore
      saveHighScore(finalScore)
    }

    drawFrame()
  }, [stopTick, saveHighScore, drawFrame])

  // ── 开始游戏 ──
  // wasdKey: 'w'|'a'|'s'|'d' 或任意其他键
  const startGame = useCallback((wasdKey) => {
    const snake = createInitialSnake()
    snakeRef.current = snake
    directionRef.current = 'right'
    nextDirRef.current = 'right'
    // 保持已有食物位置，不重置（初始绘制已放置）
    tailDirRef.current = 'right'
    setScore(0)
    scoreRef.current = 0
    setIsNewRecord(false)
    setGameState('playing')
    gameStateRef.current = 'playing'

    // 将 WASD 键转为方向，仅当非反向时应用
    const dir = KEY_TO_DIR[wasdKey]
    if (dir && OPPOSITE[dir] !== 'right') {
      directionRef.current = dir
      nextDirRef.current = dir
    }

    drawFrame()
    startTick(150)
  }, [drawFrame, startTick])

  // ── 重试 ──
  const handleRetry = useCallback(() => {
    stopTick()
    snakeRef.current = createInitialSnake()
    directionRef.current = 'right'
    nextDirRef.current = 'right'
    foodRef.current = randomFood(snakeRef.current)
    tailDirRef.current = 'right'
    setScore(0)
    scoreRef.current = 0
    setIsNewRecord(false)
    setGameState('idle')
    gameStateRef.current = 'idle'
    drawFrame()
  }, [stopTick, drawFrame])

  // ── 暂停/继续 ──
  const handleSpace = useCallback(() => {
    const gs = gameStateRef.current
    if (gs === 'playing') {
      stopTick()
      setGameState('paused')
      gameStateRef.current = 'paused'
      drawFrame()
    } else if (gs === 'paused') {
      setGameState('playing')
      gameStateRef.current = 'playing'
      startTick(Math.max(60, 150 - scoreRef.current * 2))
      drawFrame()
    }
  }, [stopTick, startTick, drawFrame])

  // ── 键盘事件 ──
  useEffect(() => {
    const handleDown = (e) => {
      const key = e.key.toLowerCase()

      // WASD & SPACE 高亮
      const arrowMap = { arrowup: 'w', arrowdown: 's', arrowleft: 'a', arrowright: 'd' }
      const mapped = arrowMap[key] || key
      if (['w', 'a', 's', 'd'].includes(mapped)) {
        setActiveKeys(prev => ({ ...prev, [mapped]: true }))
      }
      if (key === ' ') {
        setActiveKeys(prev => ({ ...prev, space: true }))
      }

      const gs = gameStateRef.current
      if (gs === 'idle') {
        e.preventDefault()
        startGame(mapped)
        return
      }
      if (gs === 'dead') return

      // 空格暂停/继续
      if (key === ' ') {
        e.preventDefault()
        handleSpace()
        return
      }

      // 方向输入（游戏中）
      const dirMap = {
        w: 'up', arrowup: 'up',
        s: 'down', arrowdown: 'down',
        a: 'left', arrowleft: 'left',
        d: 'right', arrowright: 'right',
      }
      const newDir = dirMap[key]
      if (newDir && OPPOSITE[newDir] !== directionRef.current) {
        nextDirRef.current = newDir
        e.preventDefault()
      }
    }

    const handleUp = (e) => {
      const key = e.key.toLowerCase()
      const arrowMap = { arrowup: 'w', arrowdown: 's', arrowleft: 'a', arrowright: 'd' }
      const mapped = arrowMap[key] || key
      if (['w', 'a', 's', 'd'].includes(mapped)) {
        setActiveKeys(prev => {
          const next = { ...prev }
          delete next[mapped]
          return next
        })
      }
      if (key === ' ') {
        setActiveKeys(prev => {
          const next = { ...prev }
          delete next.space
          return next
        })
      }
    }

    window.addEventListener('keydown', handleDown)
    window.addEventListener('keyup', handleUp)
    return () => {
      window.removeEventListener('keydown', handleDown)
      window.removeEventListener('keyup', handleUp)
    }
  }, [startGame, handleSpace])

  // ── WASD 按钮点击 ──
  const handleWASDClick = useCallback((key) => {
    setActiveKeys(prev => ({ ...prev, [key]: true }))
    setTimeout(() => setActiveKeys(prev => {
      const next = { ...prev }
      delete next[key]
      return next
    }), 150)

    const gs = gameStateRef.current
    if (gs === 'idle') {
      startGame(key)
      return
    }
    if (gs === 'dead') return

    const newDir = KEY_TO_DIR[key]
    if (newDir && OPPOSITE[newDir] !== directionRef.current) {
      nextDirRef.current = newDir
    }
  }, [startGame])

  // ── 初始绘制 ──
  useEffect(() => {
    foodRef.current = randomFood(snakeRef.current)
    tailDirRef.current = 'right'
    drawFrame()
  }, [drawFrame])

  // ── 清理 ──
  useEffect(() => {
    return () => stopTick()
  }, [stopTick])

  // ═══════════════════════════════════════
  // 渲染
  // ═══════════════════════════════════════
  const showOverlay = gameState === 'dead'

  return (
    <div className="h-full flex flex-col items-center bg-[#030D20] select-none">
      {/* 顶部信息栏 */}
      <div className="w-full flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-4">
          <span className="text-white/80 text-sm">
            当前进度 <span className="text-white font-bold ml-1">{score}</span>
          </span>
          <span className="text-white/50 text-sm">
            最高纪录 <span className="text-white/70 font-medium ml-1">{highScore}</span>
          </span>
        </div>
      </div>

      {/* 游戏画布 */}
      <div className="relative flex-1 flex items-center justify-center">
        <div className="relative" style={{ width: CANVAS_PX, height: CANVAS_PX }}>
          <canvas
            ref={canvasRef}
            className="block"
            style={{ width: CANVAS_PX, height: CANVAS_PX }}
          />

          {/* 死亡覆盖层 */}
          {showOverlay && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/55 rounded-sm">
              <div className="text-white/80 text-sm">最终进度</div>
              <div className={`text-5xl font-bold ${isNewRecord ? 'rainbow-text' : 'text-white'}`}>
                {score}
              </div>
              {isNewRecord && (
                <div className="mt-1">
                  <span className="gold-text text-xl font-bold tracking-wider">
                    ✦ 新纪录 ✦
                  </span>
                </div>
              )}
              <button
                onClick={handleRetry}
                className="mt-3 flex items-center gap-2 px-5 py-2 rounded-lg bg-white/10 hover:bg-white/20 border border-white/20 text-white text-sm transition-all active:scale-95"
              >
                <RotateCcw className="w-4 h-4" />
                重试
              </button>
            </div>
          )}
        </div>
      </div>

      {/* WASD + SPACE 按钮区 */}
      <div className="w-full flex items-start gap-6 px-4 pb-4 pt-2">
        <div className="grid grid-cols-3 grid-rows-2 gap-1.5" style={{ width: 120 }}>
          <button
            onPointerDown={() => handleWASDClick('w')}
            className={`col-start-2 row-start-1 w-9 h-9 rounded-md flex items-center justify-center text-xs font-bold border transition-all duration-100 select-none
              ${activeKeys['w']
                ? 'bg-sky-400/30 border-sky-400/60 text-sky-300 shadow-[0_0_12px_rgba(56,189,248,0.4)]'
                : 'bg-white/5 border-white/15 text-white/60 hover:bg-white/10'}`}
          >W</button>
          <button
            onPointerDown={() => handleWASDClick('a')}
            className={`col-start-1 row-start-2 w-9 h-9 rounded-md flex items-center justify-center text-xs font-bold border transition-all duration-100 select-none
              ${activeKeys['a']
                ? 'bg-sky-400/30 border-sky-400/60 text-sky-300 shadow-[0_0_12px_rgba(56,189,248,0.4)]'
                : 'bg-white/5 border-white/15 text-white/60 hover:bg-white/10'}`}
          >A</button>
          <button
            onPointerDown={() => handleWASDClick('s')}
            className={`col-start-2 row-start-2 w-9 h-9 rounded-md flex items-center justify-center text-xs font-bold border transition-all duration-100 select-none
              ${activeKeys['s']
                ? 'bg-sky-400/30 border-sky-400/60 text-sky-300 shadow-[0_0_12px_rgba(56,189,248,0.4)]'
                : 'bg-white/5 border-white/15 text-white/60 hover:bg-white/10'}`}
          >S</button>
          <button
            onPointerDown={() => handleWASDClick('d')}
            className={`col-start-3 row-start-2 w-9 h-9 rounded-md flex items-center justify-center text-xs font-bold border transition-all duration-100 select-none
              ${activeKeys['d']
                ? 'bg-sky-400/30 border-sky-400/60 text-sky-300 shadow-[0_0_12px_rgba(56,189,248,0.4)]'
                : 'bg-white/5 border-white/15 text-white/60 hover:bg-white/10'}`}
          >D</button>
        </div>
        {/* SPACE 按钮 */}
        <button
          onPointerDown={() => handleSpace()}
          className={`px-4 py-2 rounded-md flex items-center justify-center text-[11px] font-bold border transition-all duration-100 select-none tracking-widest
            ${activeKeys['space']
              ? 'bg-sky-400/30 border-sky-400/60 text-sky-300 shadow-[0_0_12px_rgba(56,189,248,0.4)]'
              : 'bg-white/5 border-white/15 text-white/60 hover:bg-white/10'}`}
          style={{ minWidth: 72, height: 39 }}
          title="暂停/继续"
        >SPACE</button>
      </div>

      {/* 内联样式 */}
      <style>{`
        .rainbow-text {
          background: linear-gradient(90deg, #ff0000, #ff8800, #ffff00, #00ff00, #0088ff, #8800ff, #ff0000);
          background-size: 200% auto;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          animation: rainbow-shift 1.5s linear infinite;
        }
        @keyframes rainbow-shift {
          0% { background-position: 0% center; }
          100% { background-position: 200% center; }
        }
        .gold-text {
          background: linear-gradient(135deg, #ffd700 0%, #ffb800 25%, #ffe44d 50%, #ffb800 75%, #ffd700 100%);
          background-size: 200% auto;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          animation: gold-shimmer 2s linear infinite;
        }
        @keyframes gold-shimmer {
          0% { background-position: 0% center; }
          100% { background-position: 200% center; }
        }
      `}</style>
    </div>
  )
}

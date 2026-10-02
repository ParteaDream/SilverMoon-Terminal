/**
 * pageStateStore.js — 页面状态持久化（基于 user.json，FIFO 队列）
 *
 * 每个条目: { key, scrollTop, atBottom, anchor, state, ts }
 * - key: 页面唯一标识，如 "characters" / "character_10000002"
 * - scrollTop: 滚动位置（像素，仅作第一跳的近似值）
 * - atBottom: 离开时是否贴着底部（比像素值更语义化，内容变高变矮都成立）
 * - anchor: { id, offset } 视口内第一条内容的 id 与它相对容器顶边的偏移
 *           —— 真正的定位依据，见 utils/scrollMemory.mjs 的说明
 * - state: 页面自定义状态（viewMode、sliders 等）
 * - ts: 保存时间戳
 *
 * 旧条目（只有 scrollY）读入时自动归一化，不会因为升级丢状态。
 */

const MAX_ENTRIES = 20

// 内存缓存，避免频繁 IPC
let _cache = null
let _loaded = false
let _loadPromise = null
let _saveVersion = 0   // 版本号，防止旧 save 覆盖新数据
let _saveTimer = null   // debounce timer，减少文件写入频率
let _pendingStates = null // 待写入的最新状态
const SAVE_DEBOUNCE_MS = 1000  // 文件写入 debounce 间隔（毫秒）

/** 把任意历史形状的条目归一化成当前形状 */
function normalizeEntry(entry) {
  if (!entry || typeof entry !== 'object') return null
  const anchor = entry.anchor && entry.anchor.id != null
    ? { id: String(entry.anchor.id), offset: Number(entry.anchor.offset) || 0 }
    : null
  const scrollTop = Number.isFinite(entry.scrollTop)
    ? entry.scrollTop
    : (Number.isFinite(entry.scrollY) ? entry.scrollY : 0)
  return {
    key: entry.key,
    scrollTop,
    atBottom: !!entry.atBottom,
    anchor,
    state: entry.state || {},
    ts: entry.ts || 0,
  }
}

async function _load() {
  if (_loaded) return _cache
  if (_loadPromise) return _loadPromise

  _loadPromise = (async () => {
    try {
      if (!window.electronAPI) {
        _cache = []
      } else {
        const res = await window.electronAPI.loadPageStates()
        const raw = (res && res.success) ? res.states : []
        _cache = (raw || []).map(normalizeEntry).filter(Boolean)
      }
    } catch (e) {
      console.warn('[pageStateStore] load failed:', e)
      _cache = []
    }
    _loaded = true
    _loadPromise = null
    return _cache
  })()

  return _loadPromise
}

function _scheduleSave(states) {
  _cache = states
  _pendingStates = states
  if (_saveTimer) return  // 已有定时器在等待，只更新待写入数据
  _saveTimer = setTimeout(() => {
    _saveTimer = null
    const toSave = _pendingStates
    _pendingStates = null
    if (toSave) _doSave(toSave)
  }, SAVE_DEBOUNCE_MS)
}

async function _doSave(states) {
  const version = ++_saveVersion
  try {
    if (window.electronAPI) {
      await window.electronAPI.savePageStates(states)
      // 如果在此之间又有新的 save，不覆盖
      if (version !== _saveVersion) return
    }
  } catch (e) {
    console.warn('[pageStateStore] save failed:', e)
  }
}

/** 立即刷新待写入的状态到文件（用于导航前确保状态已持久化） */
export function flushPageStates() {
  if (_saveTimer) {
    clearTimeout(_saveTimer)
    _saveTimer = null
  }
  const toSave = _pendingStates
  _pendingStates = null
  if (toSave) _doSave(toSave)
}

function sameSnapshot(a, b) {
  if (!a || !b) return false
  if (a.scrollTop !== b.scrollTop || !!a.atBottom !== !!b.atBottom) return false
  const ai = a.anchor && a.anchor.id
  const bi = b.anchor && b.anchor.id
  if (String(ai || '') !== String(bi || '')) return false
  if (ai != null && Number(a.anchor.offset) !== Number(b.anchor.offset)) return false
  return true
}

function sameState(a, b) {
  const ka = Object.keys(a || {})
  const kb = Object.keys(b || {})
  if (ka.length !== kb.length) return false
  return ka.every(k => (a || {})[k] === (b || {})[k])
}

function _write(key, snapshot, state) {
  const existing = _cache.find(s => s.key === key)
  if (existing && sameSnapshot(existing, snapshot) && sameState(existing.state, state)) return false
  const filtered = _cache.filter(s => s.key !== key)
  filtered.push({
    key,
    scrollTop: snapshot?.scrollTop || 0,
    atBottom: !!snapshot?.atBottom,
    anchor: snapshot?.anchor || null,
    state: state || {},
    ts: Date.now(),
  })
  _cache = filtered.length > MAX_ENTRIES ? filtered.slice(-MAX_ENTRIES) : filtered
  _scheduleSave(_cache)
  return true
}

/** 同步保存滚动快照 + 页面状态（即时更新缓存，异步写文件） */
export function saveScrollStateSync(key, snapshot, state = {}) {
  if (!_loaded || !_cache) {
    // 缓存未加载时，异步保存
    saveScrollState(key, snapshot, state)
    return
  }
  _write(key, snapshot, state)
}

/** 异步保存滚动快照 + 页面状态 */
export async function saveScrollState(key, snapshot, state = {}) {
  await _load()
  _write(key, snapshot, state)
}

/** 读取滚动快照（同步，缓存未加载时返回 null） */
export function loadScrollStateSync(key) {
  if (!_loaded || !_cache) return null
  const entry = _cache.find(s => s.key === key)
  if (!entry) return null
  return { snapshot: { scrollTop: entry.scrollTop, atBottom: entry.atBottom, anchor: entry.anchor }, state: entry.state || {} }
}

/** 读取滚动快照（异步） */
export async function loadScrollState(key) {
  const states = await _load()
  const entry = states.find(s => s.key === key)
  if (!entry) return null
  return { snapshot: { scrollTop: entry.scrollTop, atBottom: entry.atBottom, anchor: entry.anchor }, state: entry.state || {} }
}

// ── 兼容旧调用：只关心 scrollY 的页面（挑战/更新日志/设置等）──
/** @deprecated 新代码请用 saveScrollStateSync(key, snapshot, state) */
export function savePageStateSync(key, scrollY, extra = {}) {
  saveScrollStateSync(key, { scrollTop: scrollY || 0, atBottom: false, anchor: null }, extra)
}

/** @deprecated 新代码请用 saveScrollState(key, snapshot, state) */
export async function savePageState(key, scrollY, extra = {}) {
  await saveScrollState(key, { scrollTop: scrollY || 0, atBottom: false, anchor: null }, extra)
}

/** @deprecated 新代码请用 loadScrollStateSync(key) */
export function loadPageStateSync(key) {
  const entry = loadScrollStateSync(key)
  if (!entry) return null
  return { scrollY: entry.snapshot.scrollTop, state: entry.state }
}

/** @deprecated 新代码请用 loadScrollState(key) */
export async function loadPageState(key) {
  const entry = await loadScrollState(key)
  if (!entry) return null
  return { scrollY: entry.snapshot.scrollTop, state: entry.state }
}

/** 清除所有页面状态 */
export function clearAllPageStates() {
  _cache = []
  _loaded = true
  _loadPromise = null
  // 立即持久化到文件（清空操作需要即时生效）
  _cache = []
  _pendingStates = []
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null }
  _doSave([])
}

/** 预加载缓存（应用启动时调用，确保后续同步读取可用） */
export async function preloadPageStates() {
  // 每次启动清空旧页面信息
  clearAllPageStates()
  return _cache
}

/** 清除指定页面的状态 */
export async function clearPageState(key) {
  const states = await _load()
  const filtered = states.filter(s => s.key !== key)
  if (filtered.length !== states.length) {
    _scheduleSave(filtered)
  }
}

/** 强制刷新缓存（用于调试或外部修改后同步） */
export async function refreshCache() {
  _loaded = false
  _loadPromise = null
  return _load()
}

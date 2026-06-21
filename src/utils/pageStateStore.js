/**
 * pageStateStore.js — 页面状态持久化（基于 user.json，FIFO 队列最多 5 页）
 *
 * 每个条目: { key: string, scrollY: number, state: object, ts: number }
 * - key: 页面唯一标识，如 "characters" / "character_10000002"
 * - scrollY: 滚动位置
 * - state: 页面自定义状态（viewMode、sliders 等）
 * - ts: 保存时间戳
 */

const MAX_ENTRIES = 5

// 内存缓存，避免频繁 IPC
let _cache = null
let _loaded = false
let _loadPromise = null
let _saveVersion = 0   // 版本号，防止旧 save 覆盖新数据

async function _load() {
  if (_loaded) return _cache
  if (_loadPromise) return _loadPromise

  _loadPromise = (async () => {
    try {
      if (!window.electronAPI) {
        _cache = []
      } else {
        const res = await window.electronAPI.loadPageStates()
        _cache = (res && res.success) ? res.states : []
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

async function _save(states) {
  _cache = states
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

/** 同步保存页面状态（即时更新缓存，异步写文件） */
export function savePageStateSync(key, scrollY, extra = {}) {
  if (!_loaded || !_cache) {
    // 缓存未加载时，异步保存
    savePageState(key, scrollY, extra)
    return
  }
  const filtered = _cache.filter(s => s.key !== key)
  filtered.push({ key, scrollY, state: extra, ts: Date.now() })
  _cache = filtered.length > MAX_ENTRIES ? filtered.slice(-MAX_ENTRIES) : filtered
  // 异步持久化到文件
  _save(_cache)
}

/** 保存页面状态（自动去重，超出上限自动淘汰最旧） */
export async function savePageState(key, scrollY, extra = {}) {
  const states = await _load()
  // 移除同 key 的旧条目
  const filtered = states.filter(s => s.key !== key)
  // 添加新条目
  filtered.push({ key, scrollY, state: extra, ts: Date.now() })
  // 超出上限：保留最后 MAX_ENTRIES 条
  const trimmed = filtered.length > MAX_ENTRIES ? filtered.slice(-MAX_ENTRIES) : filtered
  await _save(trimmed)
}

/** 加载页面状态，不存在则返回 null */
export async function loadPageState(key) {
  const states = await _load()
  const entry = states.find(s => s.key === key)
  if (!entry) return null
  return { scrollY: entry.scrollY, state: entry.state || {} }
}

/** 同步读取缓存中的页面状态（缓存未加载时返回 null） */
export function loadPageStateSync(key) {
  if (!_loaded || !_cache) return null
  const entry = _cache.find(s => s.key === key)
  if (!entry) return null
  return { scrollY: entry.scrollY, state: entry.state || {} }
}

/** 清除所有页面状态 */
export function clearAllPageStates() {
  _cache = []
  _loaded = true
  _loadPromise = null
  // 异步持久化到文件
  _save([])
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
    await _save(filtered)
  }
}

/** 强制刷新缓存（用于调试或外部修改后同步） */
export async function refreshCache() {
  _loaded = false
  _loadPromise = null
  return _load()
}

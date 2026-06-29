import { createContext, useContext, useState, useEffect, useCallback } from 'react'

const DbContext = createContext(null)

export function useDb() {
  const ctx = useContext(DbContext)
  if (!ctx) throw new Error('useDb must be used within DbProvider')
  return ctx
}

export function DbProvider({ children }) {
  const [dbReady, setDbReady] = useState(false)
  const [dbPath, setDbPath] = useState(null)
  const [imagesDir, setImagesDir] = useState(null)
  const [needsSetup, setNeedsSetup] = useState(false)
  const [devMode, setDevMode] = useState(false)
  const [dualDbMode, setDualDbMode] = useState(true)
  const [defaultViewMode, setDefaultViewMode] = useState(null) // 全局默认视图模式

  const query = useCallback(async (sql, params = []) => {
    if (!window.electronAPI) {
      console.warn('[DbContext] electronAPI not available (browser mode), query skipped:', sql.slice(0, 80))
      return { data: [] }
    }
    const result = await window.electronAPI.dbQuery(sql, params)
    if (result.error) {
      console.error('[DbContext] query error:', result.error, '\nSQL:', sql.slice(0, 120))
      throw new Error(result.error)
    }
    return result
  }, [])

  const selectLocation = useCallback(async () => {
    if (!window.electronAPI) return { success: false, error: 'electronAPI not available' }
    const result = await window.electronAPI.selectDbLocation()
    console.log('[DbContext] selectLocation raw result:', JSON.stringify(result))
    if (result.error) {
      console.error('[DbContext] selectLocation error:', result.error)
      return { success: false, error: result.error }
    }
    if (result.success) {
      setDbPath(result.dbPath)
      setImagesDir(result.imagesDir)
      if (result.needsSeed) {
        setNeedsSetup(true)
      } else {
        setDbReady(true)
      }
    }
    return result
  }, [])

  const initSchema = useCallback(async () => {
    if (!window.electronAPI) return { success: false }
    const result = await window.electronAPI.initDatabase()
    if (result.error) throw new Error(result.error)
    return result
  }, [])

  const readImage = useCallback(async (filename) => {
    if (!filename || !window.electronAPI) return null
    const result = await window.electronAPI.readImage(filename)
    if (result.success) return result.data
    return null
  }, [])

  const importImage = useCallback(async () => {
    if (!window.electronAPI) return null
    const result = await window.electronAPI.importImage()
    if (result.conflict) {
      alert(result.message)
      return null
    }
    if (result.success) return result.filename
    return null
  }, [])

  const deleteImage = useCallback(async (filename) => {
    if (!window.electronAPI) return
    await window.electronAPI.deleteImage(filename)
  }, [])

  const getDbPath = useCallback(async () => {
    if (!window.electronAPI) return { success: false }
    return await window.electronAPI.getDbPath()
  }, [])

  const updateDatabase = useCallback(async () => {
    if (!window.electronAPI) return { success: false }
    const result = await window.electronAPI.updateDatabase()
    if (result.error) throw new Error(result.error)
    return result
  }, [])

  const exportSeed = useCallback(async () => {
    if (!window.electronAPI) return { success: false }
    return await window.electronAPI.exportSeed()
  }, [])

  const backupDatabase = useCallback(async () => {
    if (!window.electronAPI) return { success: false }
    return await window.electronAPI.backupDatabase()
  }, [])

  const importDatabase = useCallback(async () => {
    if (!window.electronAPI) return { success: false }
    return await window.electronAPI.importDatabase()
  }, [])

  const listBackups = useCallback(async () => {
    if (!window.electronAPI) return { success: false, backups: [] }
    return await window.electronAPI.listBackups()
  }, [])

  const createBackup = useCallback(async (note) => {
    if (!window.electronAPI) return { success: false }
    return await window.electronAPI.createBackup(note)
  }, [])

  const restoreBackup = useCallback(async (filename) => {
    if (!window.electronAPI) return { success: false }
    return await window.electronAPI.restoreBackup(filename)
  }, [])

  const deleteBackup = useCallback(async (filename) => {
    if (!window.electronAPI) return { success: false }
    return await window.electronAPI.deleteBackup(filename)
  }, [])

  const crawlCharacter = useCallback(async (characterName, options = {}) => {
    if (!window.electronAPI) return { success: false, error: 'electronAPI not available' }
    return await window.electronAPI.crawlCharacter(characterName, options)
  }, [])

  const crawlWeapon = useCallback(async (weaponName, options = {}) => {
    if (!window.electronAPI) return { success: false, error: 'electronAPI not available' }
    return await window.electronAPI.crawlWeapon(weaponName, options)
  }, [])

  const checkMissingWeapons = useCallback(async () => {
    if (!window.electronAPI) return { success: false, error: 'electronAPI not available' }
    return await window.electronAPI.checkMissingWeapons()
  }, [])

  const crawlArtifact = useCallback(async (artifactName, options = {}) => {
    if (!window.electronAPI) return { success: false, error: 'electronAPI not available' }
    return await window.electronAPI.crawlArtifact(artifactName, options)
  }, [])

  const crawlWishes = useCallback(async () => {
    if (!window.electronAPI) return { success: false, error: 'electronAPI not available' }
    return await window.electronAPI.crawlWishes()
  }, [])

  const crawlWishImages = useCallback(async (periods) => {
    if (!window.electronAPI) return { success: false, error: 'electronAPI not available' }
    return await window.electronAPI.crawlWishImages(periods)
  }, [])

  const downloadBannerImage = useCallback(async (url, filename) => {
    if (!window.electronAPI) return { success: false, error: 'electronAPI not available' }
    return await window.electronAPI.downloadBannerImage(url, filename)
  }, [])

  const checkMissingArtifacts = useCallback(async () => {
    if (!window.electronAPI) return { success: false, error: 'electronAPI not available' }
    return await window.electronAPI.checkMissingArtifacts()
  }, [])

  const cleanupScrapeWindow = useCallback(async () => {
    if (!window.electronAPI) return
    return await window.electronAPI.cleanupScrapeWindow()
  }, [])

  const downloadMaterialImage = useCallback(async (iconName) => {
    if (!window.electronAPI) return { success: false }
    return await window.electronAPI.downloadMaterialImage(iconName)
  }, [])

  const cleanUnusedImages = useCallback(async () => {
    if (!window.electronAPI) return { success: false }
    return await window.electronAPI.cleanUnusedImages()
  }, [])

  const checkDbIntegrity = useCallback(async () => {
    if (!window.electronAPI) return { ok: true, rows: [] }
    return await window.electronAPI.checkDbIntegrity()
  }, [])

  const repairWebsites = useCallback(async () => {
    if (!window.electronAPI) return { success: false }
    return await window.electronAPI.repairWebsites()
  }, [])

  const toggleDevMode = useCallback(async () => {
    const newVal = !devMode
    setDevMode(newVal)
    try {
      if (window.electronAPI) {
        await window.electronAPI.setUserConfig('devMode', newVal)
        await window.electronAPI.setDevMode(newVal) // 同步到后端
      }
    } catch (_) { /* non-fatal */ }
  }, [devMode])

  const toggleDualDbMode = useCallback(async () => {
    const newVal = !dualDbMode
    setDualDbMode(newVal)
    try {
      if (window.electronAPI) {
        await window.electronAPI.setUserConfig('dualDbMode', newVal)
        await window.electronAPI.setDualDbMode(newVal)
      }
    } catch (_) { /* non-fatal */ }
  }, [dualDbMode])

  useEffect(() => {
    async function init() {
      if (!window.electronAPI) {
        setDbReady(true) // Running in browser fallback
        return
      }
      try {
        const config = await window.electronAPI.getConfig()
        console.log('[DbContext] getConfig:', JSON.stringify(config))

        if (config.engineError) {
          // 数据库引擎加载失败，强制进设置页面
          setNeedsSetup(true)
          return
        }

        if (config.dbDir && config.dbPopulated) {
          // 已有配置且数据库存在并已初始化
          setDbPath(config.dbDir)
          setImagesDir(config.imagesDir)
          setDbReady(true)
        } else if (config.dbDir && !config.dbPopulated) {
          // 已有配置但数据库文件不存在或未初始化 → 需要重新初始化
          setDbPath(config.dbDir)
          setImagesDir(config.imagesDir)
          setNeedsSetup(true)
        } else {
          // 没有配置 → 需要设置
          setNeedsSetup(true)
          const cleanup = window.electronAPI.onRequestDbLocation(() => {
            setNeedsSetup(true)
          })
          return cleanup
        }
      } catch (e) {
        console.error('[DbContext] init error:', e)
        setNeedsSetup(true)
      }
    }
    init()
  }, [])

  // 加载用户配置（开发者模式等）
  useEffect(() => {
    if (!dbReady) return
    async function loadUserConfig() {
      try {
        if (window.electronAPI) {
          const res = await window.electronAPI.getUserConfig()
          if (res?.success && res.config) {
            setDevMode(!!res.config.devMode)
            if (window.electronAPI.setDevMode) {
              await window.electronAPI.setDevMode(!!res.config.devMode)
            }
            // 同步双数据库模式
            const ddMode = res.config.dualDbMode !== false // 默认 true
            setDualDbMode(ddMode)
            if (window.electronAPI.setDualDbMode) {
              await window.electronAPI.setDualDbMode(ddMode)
            }
            const DEFAULT_VIEWS = { characters: 'gallery', weapons: 'gallery', artifacts: 'gallery', materials: 'gallery', wishes: 'images' }
            if (res.config.defaultViewMode) {
              const merged = { ...DEFAULT_VIEWS, ...res.config.defaultViewMode }
              setDefaultViewMode(merged)
              localStorage.setItem('default_view_mode', JSON.stringify(merged))
            } else {
              // 新文件夹没有默认视图设置 → 写入默认值，清除旧文件夹残留
              setDefaultViewMode(DEFAULT_VIEWS)
              localStorage.setItem('default_view_mode', JSON.stringify(DEFAULT_VIEWS))
              await window.electronAPI.setUserConfig('defaultViewMode', DEFAULT_VIEWS)
            }
          }
        }
      } catch (_) { /* non-fatal */ }
    }
    loadUserConfig()
  }, [dbReady])

  return (
    <DbContext.Provider value={{
      dbReady, dbPath, imagesDir, needsSetup, devMode, dualDbMode, defaultViewMode,
      query, selectLocation, initSchema,
      readImage, importImage, deleteImage,
      getDbPath, updateDatabase, backupDatabase, importDatabase, exportSeed,
      listBackups, createBackup, restoreBackup, deleteBackup,
      crawlCharacter, crawlWeapon, checkMissingWeapons, crawlArtifact, checkMissingArtifacts, crawlWishes, crawlWishImages, downloadBannerImage, cleanupScrapeWindow, downloadMaterialImage, cleanUnusedImages,
      checkDbIntegrity, repairWebsites,
      toggleDevMode, toggleDualDbMode,
    }}>
      {children}
    </DbContext.Provider>
  )
}

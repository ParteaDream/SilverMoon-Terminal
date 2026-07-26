const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectDbLocation: () => ipcRenderer.invoke('select-db-location'),
  selectAlbumFolder: () => ipcRenderer.invoke('select-album-folder'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  getDbPath: () => ipcRenderer.invoke('get-db-path'),
  dbQuery: (sql, params) => ipcRenderer.invoke('db-query', sql, params),
  dbExecFile: (sql) => ipcRenderer.invoke('db-exec-file', sql),
  initDatabase: () => ipcRenderer.invoke('init-database'),
  updateDatabase: () => ipcRenderer.invoke('update-database'),
  getSeedStats: () => ipcRenderer.invoke('get-seed-stats'),
  saveImage: (filename, buffer) => ipcRenderer.invoke('save-image', { filename, buffer }),
  importImage: () => ipcRenderer.invoke('import-image'),
  importImageFile: (srcPath) => ipcRenderer.invoke('import-image-file', srcPath),
  deleteImage: (filename) => ipcRenderer.invoke('delete-image', filename),
  readImage: (filename, maxWidth) => ipcRenderer.invoke('read-image', filename, maxWidth),
  startImageDrag: (filename) => ipcRenderer.invoke('start-image-drag', filename),
  startFileDrag: (filePath) => ipcRenderer.invoke('start-file-drag', filePath),
  importUserImage: () => ipcRenderer.invoke('import-user-image'),
  importPresetImage: (presetName) => ipcRenderer.invoke('import-preset-image', presetName),
  importUserImageFile: (srcPath) => ipcRenderer.invoke('import-user-image-file', srcPath),
  importAndThumbnail: (srcPath, maxWidth) => ipcRenderer.invoke('import-and-thumbnail', srcPath, maxWidth),
  readUserImage: (filename, maxWidth) => ipcRenderer.invoke('read-user-image', filename, maxWidth),
  renameUserImage: (oldName, newName) => ipcRenderer.invoke('rename-user-image', oldName, newName),
  deleteUserImage: (filename) => ipcRenderer.invoke('delete-user-image', filename),
  listDbFiles: () => ipcRenderer.invoke('list-db-files'),
  listDirectory: (dirPath) => ipcRenderer.invoke('list-directory', dirPath),
  openFolder: (folderPath) => ipcRenderer.invoke('open-folder', folderPath),
  openFile: (filePath) => ipcRenderer.invoke('open-file', filePath),
  readFilePreview: (filePath, maxWidth) => ipcRenderer.invoke('read-file-preview', filePath, maxWidth),
  saveCoverThumbnail: (sourcePath, maxWidth, savePath) => ipcRenderer.invoke('save-cover-thumbnail', sourcePath, maxWidth, savePath),
  scanAlbumIndex: (rootPath) => ipcRenderer.invoke('scan-album-index', rootPath),
  readAlbumManifest: (rootPath) => ipcRenderer.invoke('read-album-manifest', rootPath),
  readIndexThumb: (rootPath, thumbRelPath) => ipcRenderer.invoke('read-index-thumb', rootPath, thumbRelPath),
  exportImageFile: (data, defaultName) => ipcRenderer.invoke('export-image-file', { data, defaultName }),
  exportImageFileRaw: (filename) => ipcRenderer.invoke('export-image-file-raw', filename),
  backupDatabase: () => ipcRenderer.invoke('backup-database'),
  importDatabase: () => ipcRenderer.invoke('import-database'),
  listBackups: () => ipcRenderer.invoke('list-backups'),
  createBackup: (note) => ipcRenderer.invoke('create-backup', note),
  restoreBackup: (filename) => ipcRenderer.invoke('restore-backup', filename),
  deleteBackup: (filename) => ipcRenderer.invoke('delete-backup', filename),
  listBaselineDbs: () => ipcRenderer.invoke('list-baseline-dbs'),
  switchBaselineDb: (filename) => ipcRenderer.invoke('switch-baseline-db', filename),
  exportSeed: (version) => ipcRenderer.invoke('export-seed', version),
  crawlCharacter: (characterName, options) => ipcRenderer.invoke('crawl-character', characterName, options),
  crawlWeapon: (weaponName, options) => ipcRenderer.invoke('crawl-weapon', weaponName, options),
  checkMissingWeapons: () => ipcRenderer.invoke('check-missing-weapons'),
  crawlArtifact: (artifactName, options) => ipcRenderer.invoke('crawl-artifact', artifactName, options),
  checkMissingArtifacts: () => ipcRenderer.invoke('check-missing-artifacts'),
  crawlWishes: () => ipcRenderer.invoke('crawl-wishes'),
  crawlWishImages: (periods) => ipcRenderer.invoke('crawl-wish-images', periods),
  downloadBannerImage: (url, filename) => ipcRenderer.invoke('download-banner-image', url, filename),
  getCharacterList: () => ipcRenderer.invoke('get-character-list'),
  cleanupScrapeWindow: () => ipcRenderer.invoke('cleanup-scrape-window'),
  downloadMaterialImage: (iconName) => ipcRenderer.invoke('download-material-image', iconName),
  cleanUnusedImages: () => ipcRenderer.invoke('clean-unused-images'),
  checkDbIntegrity: () => ipcRenderer.invoke('db-check-integrity'),
  repairWebsites: () => ipcRenderer.invoke('db-repair-websites'),
  getUserConfig: () => ipcRenderer.invoke('get-user-config'),
  setUserConfig: (key, value) => ipcRenderer.invoke('set-user-config', key, value),
  // Beta备忘录：user.db 读写
  betamemoLoadTasks: () => ipcRenderer.invoke('betamemo-load-tasks'),
  betamemoSaveTasks: (tasks) => ipcRenderer.invoke('betamemo-save-tasks', tasks),
  betamemoMigrateFromJson: () => ipcRenderer.invoke('betamemo-migrate-from-json'),
  // 北国银行：user.db 读写
  northlandbankLoadRecords: () => ipcRenderer.invoke('northlandbank-load-records'),
  northlandbankSaveRecords: (records) => ipcRenderer.invoke('northlandbank-save-records', records),
  northlandbankMigrateFromJson: () => ipcRenderer.invoke('northlandbank-migrate-from-json'),
  readAlbumTags: () => ipcRenderer.invoke('read-album-tags'),
  saveAlbumTags: (data) => ipcRenderer.invoke('save-album-tags', data),
  setDevMode: (enabled) => ipcRenderer.invoke('set-dev-mode', enabled),
  getDevMode: () => ipcRenderer.invoke('get-dev-mode'),
  setDualDbMode: (enabled) => ipcRenderer.invoke('set-dual-db-mode', enabled),
  getDualDbMode: () => ipcRenderer.invoke('get-dual-db-mode'),
  loadPageStates: () => ipcRenderer.invoke('load-page-states'),
  savePageStates: (states) => ipcRenderer.invoke('save-page-states', states),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getAppVersionTag: () => ipcRenderer.invoke('get-app-version-tag'),
  setAppVersionTag: (tag) => ipcRenderer.invoke('set-app-version-tag', tag),
  getDataVersion: () => ipcRenderer.invoke('get-data-version'),
  listImagePacks: () => ipcRenderer.invoke('list-image-packs'),
  setActiveImagePack: (packName) => ipcRenderer.invoke('set-active-image-pack', packName),
  clearActiveImagePack: () => ipcRenderer.invoke('clear-active-image-pack'),
  deleteImagePack: (packPath) => ipcRenderer.invoke('delete-image-pack', packPath),
  generateManifest: (packPath) => ipcRenderer.invoke('generate-manifest', packPath),
  checkPackUpdate: (packPath, packType) => ipcRenderer.invoke('check-pack-update', packPath, packType),
  downloadPackFiles: (packPath, packType, fileList) => ipcRenderer.invoke('download-pack-files', packPath, packType, fileList),
  downloadFullPack: (packType) => ipcRenderer.invoke('download-full-pack', packType),
  exportPackDiff: (packPath, packType) => ipcRenderer.invoke('export-pack-diff', packPath, packType),
  startPackDownload: (packPath, packType, fileList) => ipcRenderer.invoke('start-pack-download', packPath, packType, fileList),
  getDownloadProgress: () => ipcRenderer.invoke('get-download-progress'),
  cancelDownload: (downloadId) => ipcRenderer.invoke('cancel-download', downloadId),
  resumeDownload: (packPath) => ipcRenderer.invoke('resume-download', packPath),
  getPersistedDownload: (packPath) => ipcRenderer.invoke('get-persisted-download', packPath),
  deleteExtraFiles: (packPath, filePaths) => ipcRenderer.invoke('delete-extra-files', packPath, filePaths),

  // Download progress push from main process (survives page navigation)
  onDownloadProgress: (callback) => {
    const handler = (_event, progress) => callback(progress);
    ipcRenderer.on('download-progress', handler);
    return () => ipcRenderer.removeListener('download-progress', handler);
  },

  // 窗口控制
  minimizeWindow: () => ipcRenderer.invoke('window-minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window-maximize'),
  closeWindow: () => ipcRenderer.invoke('window-close'),
  isMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  getWindowPosition: () => ipcRenderer.invoke('window-get-position'),
  setWindowPosition: (x, y) => ipcRenderer.invoke('window-set-position', x, y),

  onRequestDbLocation: (callback) => {
    ipcRenderer.on('request-db-location', callback);
    return () => ipcRenderer.removeAllListeners('request-db-location');
  },

  // 自动更新
  checkForUpdate: () => ipcRenderer.invoke('check-for-update'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  getUpdateAutoCheck: () => ipcRenderer.invoke('get-update-auto-check'),
  setUpdateAutoCheck: (enabled) => ipcRenderer.invoke('set-update-auto-check', enabled),
  clearUpdateCache: () => ipcRenderer.invoke('clear-update-cache'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  setAppIcon: (filename, pngData) => ipcRenderer.invoke('set-app-icon', { filename, pngData }),
  undoAppIcon: () => ipcRenderer.invoke('undo-app-icon'),
  clearAppCache: () => ipcRenderer.invoke('clear-app-cache'),
  getCacheSize: () => ipcRenderer.invoke('get-cache-size'),

  // 世界树 — 原神数据爬取（一键登录+爬取）
  genshinLoginAndCrawl: () => ipcRenderer.invoke('genshin-login-and-crawl'),
  genshinLogout: () => ipcRenderer.invoke('genshin-logout'),
  genshinListAccounts: () => ipcRenderer.invoke('genshin-list-accounts'),
  genshinGetAccount: (uid) => ipcRenderer.invoke('genshin-get-account', uid),
  genshinDeleteAccount: (uid) => ipcRenderer.invoke('genshin-delete-account', uid),
  genshinRefetchDaily: (uid) => ipcRenderer.invoke('genshin-refetch-daily', uid),

  // 祈愿捕捉站 — 祈愿数据
  gachaListArchives: () => ipcRenderer.invoke('gacha-list-archives'),
  gachaGetArchive: (uid) => ipcRenderer.invoke('gacha-get-archive', uid),
  gachaDeleteArchive: (uid) => ipcRenderer.invoke('gacha-delete-archive', uid),
  gachaFetchAndSave: (uid, server) => ipcRenderer.invoke('gacha-fetch-and-save', uid, server),
  gachaGetItemsByType: (uid, gachaType) => ipcRenderer.invoke('gacha-get-items-by-type', uid, gachaType),
  gachaLogin: () => ipcRenderer.invoke('gacha-login'),
  gachaLogout: () => ipcRenderer.invoke('gacha-logout'),
  gachaPasswordLogin: () => ipcRenderer.invoke('gacha-password-login'),
  genshinPasswordLoginAndCrawl: () => ipcRenderer.invoke('genshin-password-login-and-crawl'),
  onGachaFetchProgress: (callback) => {
    ipcRenderer.on('gacha-fetch-progress', (_e, progress) => callback(progress));
    return () => ipcRenderer.removeAllListeners('gacha-fetch-progress');
  },

  // RateFetcher：角色技能倍率导出
  fetchRateCharData: (charId) => ipcRenderer.invoke('fetch-rate-char-data', charId),
  saveRateCsv: (options) => ipcRenderer.invoke('save-rate-csv', options),
  getRateDefaultOutput: () => ipcRenderer.invoke('get-rate-default-output'),
  selectOutputFolder: () => ipcRenderer.invoke('select-output-folder'),

  onUpdateStatus: (callback) => {
    ipcRenderer.on('update-status', (_e, status) => callback(status));
    return () => ipcRenderer.removeAllListeners('update-status');
  },

  // ═══════════════════════════════════════════════════
  // 摹忆中枢 — 大地图模块
  // ═══════════════════════════════════════════════════
  mapQuery: (sql, params) => ipcRenderer.invoke('map-query', sql, params),
  mapExecBaseline: (sql, params) => ipcRenderer.invoke('map-exec-baseline', sql, params),
  mapExecUser: (sql, params) => ipcRenderer.invoke('map-exec-user', sql, params),
  mapGetConfig: (mapId) => ipcRenderer.invoke('map-get-config', mapId),
  mapSaveConfig: (mapId, nameZh, config) => ipcRenderer.invoke('map-save-config', mapId, nameZh, config),
  mapInitCalibration: (existingMapId) => ipcRenderer.invoke('map-init-calibration', existingMapId),
  mapStartSlice: (mapId, srcPath, config) => ipcRenderer.invoke('map-start-slice', mapId, srcPath, config),
  mapReadTile: (mapId, worldRow, worldCol, maxWidth) => ipcRenderer.invoke('map-read-tile', mapId, worldRow, worldCol, maxWidth),
  mapListTiles: (mapId) => ipcRenderer.invoke('map-list-tiles', mapId),
  mapDelete: (mapId) => ipcRenderer.invoke('map-delete', mapId),
  mapReorder: (orderedIds) => ipcRenderer.invoke('map-reorder', orderedIds),
  mapUpdateMarkerCategory: (markerId, category) => ipcRenderer.invoke('map-update-marker-category', markerId, category),
  mapUpdateMarker: (markerId, updates) => ipcRenderer.invoke('map-update-marker', markerId, updates),
  mapDeleteMarker: (markerId) => ipcRenderer.invoke('map-delete-marker', markerId),
  mapReorderMarkers: (orderedIds) => ipcRenderer.invoke('map-reorder-markers', orderedIds),
  mapReorderPlacements: (items) => ipcRenderer.invoke('map-reorder-placements', items),
  mapDeletePlacement: (placementId) => ipcRenderer.invoke('map-delete-placement', placementId),
  mapUpdatePlacement: (placementId, updates) => ipcRenderer.invoke('map-update-placement', placementId, updates),
  mapUpdateTextbox: (id, updates) => ipcRenderer.invoke('map-update-textbox', id, updates),
  mapClearTiles: (mapId) => ipcRenderer.invoke('map-clear-tiles', mapId),
  mapGenerateFull: (mapId) => ipcRenderer.invoke('map-generate-full', mapId),
  // 地图全局默认配置
  mapGetGlobalDefaults: () => ipcRenderer.invoke('map-get-global-defaults'),
  mapSaveGlobalDefault: (key, value) => ipcRenderer.invoke('map-save-global-default', key, value),
  // 用户 per-map 覆盖配置
  mapGetUserConfig: (mapId) => ipcRenderer.invoke('map-get-user-config', mapId),
  mapSaveUserConfig: (mapId, config) => ipcRenderer.invoke('map-save-user-config', mapId, config),
  mapResetUserConfig: (mapId) => ipcRenderer.invoke('map-reset-user-config', mapId),
  // 时之沙
  hourglassSelectAndReadDb: () => ipcRenderer.invoke('hourglass-select-and-read-db'),
  hourglassReadExternalDb: (filePath) => ipcRenderer.invoke('hourglass-read-external-db', filePath),
  hourglassReadCurrentDb: () => ipcRenderer.invoke('hourglass-read-current-db'),
});

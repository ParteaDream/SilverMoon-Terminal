const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectDbLocation: () => ipcRenderer.invoke('select-db-location'),
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
  readImage: (filename) => ipcRenderer.invoke('read-image', filename),
  startImageDrag: (filename) => ipcRenderer.invoke('start-image-drag', filename),
  importUserImage: () => ipcRenderer.invoke('import-user-image'),
  readUserImage: (filename) => ipcRenderer.invoke('read-user-image', filename),
  deleteUserImage: (filename) => ipcRenderer.invoke('delete-user-image', filename),
  exportImageFile: (data, defaultName) => ipcRenderer.invoke('export-image-file', { data, defaultName }),
  backupDatabase: () => ipcRenderer.invoke('backup-database'),
  importDatabase: () => ipcRenderer.invoke('import-database'),
  listBackups: () => ipcRenderer.invoke('list-backups'),
  createBackup: (note) => ipcRenderer.invoke('create-backup', note),
  restoreBackup: (filename) => ipcRenderer.invoke('restore-backup', filename),
  deleteBackup: (filename) => ipcRenderer.invoke('delete-backup', filename),
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
  loadPageStates: () => ipcRenderer.invoke('load-page-states'),
  savePageStates: (states) => ipcRenderer.invoke('save-page-states', states),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
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
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  onUpdateStatus: (callback) => {
    ipcRenderer.on('update-status', (_e, status) => callback(status));
    return () => ipcRenderer.removeAllListeners('update-status');
  },
});

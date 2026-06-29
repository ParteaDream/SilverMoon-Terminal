/**
 * SilverMoon Terminal — Download Manager v2
 *
 * 三层下载策略：
 *  ① 归档模式 (archive)  — GitHub repo archive zip，单文件 chunked 下载，用于完整包
 *  ② Manifest 模式        — jsDelivr CDN 逐个文件，自适应并发 + keep-alive，用于增量更新
 *  ③ 本地缓存复用          — 已存在且大小匹配的文件自动跳过
 *
 * 关键修复：
 *  - 允许 raw.githubusercontent.com 重定向（jsDelivr 未缓存时的正常 fallback）
 *  - HTTP keep-alive Agent 连接池，减少 TLS 握手开销
 *  - 自适应并发 8~32，根据网络状况动态调整
 *  - 精细粒度进度：文件级百分比、ETA、失败计数
 *  - 真正的断点续传（manifest 模式记录已完成文件集合）
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { EventEmitter } = require('events');
const { execSync } = require('child_process');

// ═══════════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════════

const CHUNK_SIZE = 4 * 1024 * 1024;          // 4 MB per chunk for archive download
const MAX_PARALLEL_CHUNKS = 6;               // parallel chunks in archive mode
const MAX_RETRIES = 5;                       // max retries per chunk / file
const RETRY_BASE_MS = 800;                   // exponential backoff base
const REQUEST_TIMEOUT_MS = 60_000;           // per-request timeout (60s for slow networks)
const SPEED_WINDOW_MS = 10_000;              // rolling window for speed / ETA
const PROGRESS_PUSH_INTERVAL_MS = 250;       // throttle _push during file download
const PROGRESS_PUSH_BYTES = 64 * 1024;       // also push every 64 KB during download
const STATE_FILE = '.download-state.json';

// Adaptive concurrency for manifest mode
const CONCURRENCY_INITIAL = 8;
const CONCURRENCY_MIN = 4;
const CONCURRENCY_MAX = 32;
const CONCURRENCY_ADJUST_INTERVAL_MS = 3000; // re-evaluate every 3s
const FAILURE_THRESHOLD_UP = 0.05;           // ≤5% failure → increase
const FAILURE_THRESHOLD_DOWN = 0.15;         // ≥15% failure → decrease

const PACK_DOWNLOAD_URLS = {
  lite:   'https://cdn.jsdelivr.net/gh/ParteaDream/images-Lite@latest',
  medium: 'https://cdn.jsdelivr.net/gh/ParteaDream/images-Medium@latest',
};

// GitHub archive URLs for full pack download (codeload directly, skips redirect)
const GITHUB_ARCHIVE_URLS = {
  lite:   'https://codeload.github.com/ParteaDream/images-Lite/zip/refs/heads/main',
  medium: 'https://codeload.github.com/ParteaDream/images-Medium/zip/refs/heads/main',
};

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function atomicWrite(filePath, data) {
  const tmp = filePath + '.tmp';
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, filePath);
}

function safeUnlink(p) { try { fs.unlinkSync(p); } catch (_) {} }

/** Format bytes to human-readable string. */
function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

/** Format seconds to mm:ss or hh:mm:ss. */
function formatDuration(sec) {
  if (!isFinite(sec) || sec <= 0) return '--:--';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SpeedTracker — rolling-window speed + ETA calculation
// ═══════════════════════════════════════════════════════════════════════════════

class SpeedTracker {
  constructor(windowMs = SPEED_WINDOW_MS) {
    this.windowMs = windowMs;
    this.samples = [];
    this._totalBytes = 0;
    this._startTime = Date.now();
  }

  add(bytes) {
    const now = Date.now();
    this.samples.push({ time: now, bytes });
    this._totalBytes += bytes;
    const cutoff = now - this.windowMs;
    while (this.samples.length > 1 && this.samples[0].time < cutoff)
      this.samples.shift();
  }

  /** bytes per second over the window */
  getSpeed() {
    if (this.samples.length < 2) return 0;
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    const dt = (last.time - first.time) / 1000;
    if (dt <= 0) return 0;
    let total = 0;
    for (let i = 1; i < this.samples.length; i++)
      total += this.samples[i].bytes;
    return Math.round(total / dt);
  }

  /** Estimated seconds remaining, given totalBytes and bytesDownloaded. */
  getETA(bytesDownloaded, totalBytes) {
    const speed = this.getSpeed();
    if (speed <= 0) return Infinity;
    const remaining = totalBytes - bytesDownloaded;
    return remaining / speed;
  }

  reset() {
    this.samples = [{ time: Date.now(), bytes: 0 }];
    this._totalBytes = 0;
    this._startTime = Date.now();
  }

  get totalBytes() { return this._totalBytes; }
  get elapsedMs() { return Date.now() - this._startTime; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// HTTP Agent Pool — keep-alive connection reuse
// ═══════════════════════════════════════════════════════════════════════════════

const agents = {};

function getAgent(hostname) {
  if (!agents[hostname]) {
    const isHttps = true; // we always use https for CDN
    agents[hostname] = new https.Agent({
      keepAlive: true,
      keepAliveMsecs: 30000,
      maxSockets: CONCURRENCY_MAX,
      maxFreeSockets: 16,
      timeout: 60000,
    });
  }
  return agents[hostname];
}

function destroyAgents() {
  for (const key of Object.keys(agents)) {
    try { agents[key].destroy(); } catch (_) {}
    delete agents[key];
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// HTTP Helpers
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Core HTTP request with redirect following, timeout, cancel support.
 * NOW ALLOWS raw.githubusercontent.com redirects — they are jsDelivr's
 * normal fallback when a file isn't cached yet.
 */
function httpRequest(url, opts = {}, dl) {
  return new Promise((resolve, reject) => {
    const { method = 'GET', headers = {}, timeout = REQUEST_TIMEOUT_MS, maxRedirects = 8 } = opts;

    function doReq(reqUrl, redirectsLeft) {
      if (dl && dl.cancelled) { reject(new Error('cancelled')); return; }

      const urlObj = new URL(reqUrl);
      const proto = urlObj.protocol === 'https:' ? https : http;
      const agent = opts.agent || getAgent(urlObj.hostname);

      const reqOpts = {
        method,
        hostname: urlObj.hostname,
        port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        headers: {
          'User-Agent': 'SilverMoon-Terminal/2.0',
          'Accept': '*/*',
          ...headers,
        },
        agent,
      };

      const req = proto.request(reqOpts, (res) => {
        // Follow redirects (now includes raw.githubusercontent.com)
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
          res.resume();
          const next = new URL(res.headers.location, reqUrl).toString();
          if (redirectsLeft === maxRedirects) {
            console.log(`[dm] redirect: ${urlObj.hostname} → ${new URL(next).hostname}`);
          }
          doReq(next, redirectsLeft - 1);
          return;
        }
        // Handle compressed responses transparently
        const ce = res.headers['content-encoding'];
        let stream = res;
        if (ce === 'gzip' || ce === 'x-gzip') {
          stream = res.pipe(zlib.createGunzip());
        } else if (ce === 'deflate') {
          stream = res.pipe(zlib.createInflate());
        } else if (ce === 'br' || ce === 'brotli') {
          stream = res.pipe(zlib.createBrotliDecompress());
        }
        resolve({ statusCode: res.statusCode, headers: res.headers, stream });
      });

      req.on('error', (err) => {
        // ECONNRESET on keep-alive sockets is benign — retry
        reject(err);
      });
      req.setTimeout(timeout, () => { req.destroy(); reject(new Error('timeout')); });
      req.end();

      // Track for cancellation
      if (dl) {
        const reqSet = dl._activeRequests || dl._activeChunkRequests;
        if (reqSet) {
          reqSet.add(req);
          req.on('close', () => reqSet.delete(req));
        }
      }
    }

    doReq(url, maxRedirects);
  });
}

/** Download entire response body as buffer. */
async function fetchBuffer(url, opts = {}, dl) {
  const { statusCode, stream } = await httpRequest(url, opts, dl);
  if (statusCode !== 200) throw new Error(`HTTP ${statusCode}`);
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    const maxSize = opts.maxSize || 512 * 1024 * 1024; // 512 MB default max
    stream.on('data', c => {
      total += c.length;
      if (total > maxSize) { stream.destroy(); reject(new Error('response too large')); return; }
      chunks.push(c);
    });
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

/** Fetch JSON from URL. */
async function fetchJson(url, opts = {}, dl) {
  const buf = await fetchBuffer(url, { ...opts, maxSize: 10 * 1024 * 1024 }, dl);
  return JSON.parse(buf.toString('utf-8'));
}

/** Download a byte range. Returns Buffer. */
async function fetchRange(url, start, end, dl) {
  const headers = { Range: `bytes=${start}-${end}` };
  const { statusCode, stream } = await httpRequest(url, { headers }, dl);
  if (statusCode !== 206 && statusCode !== 200) throw new Error(`HTTP ${statusCode}`);
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', c => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

/** HEAD request to get Content-Length and Accept-Ranges. */
async function headRequest(url, opts = {}, dl) {
  const { statusCode, headers } = await httpRequest(url, { ...opts, method: 'HEAD' }, dl);
  if (statusCode !== 200) throw new Error(`HTTP ${statusCode}`);
  return {
    contentLength: parseInt(headers['content-length'] || '0', 10),
    acceptRanges: headers['accept-ranges'] === 'bytes',
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Retry wrapper
// ═══════════════════════════════════════════════════════════════════════════════

async function withRetry(fn, label, maxRetries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= maxRetries) throw e;
      const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1) + Math.random() * 500;
      console.log(`[dm] retry ${attempt}/${maxRetries} for "${label}" in ${Math.round(delay)}ms: ${e.message}`);
      await sleep(delay);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Download State Persistence
// ═══════════════════════════════════════════════════════════════════════════════

function loadState(packPath) {
  const p = path.join(packPath, STATE_FILE);
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch (_) {}
  return null;
}

function saveState(packPath, state) {
  const p = path.join(packPath, STATE_FILE);
  // Don't persist the full completedFileSet array if it's huge — cap at paths
  const toSave = { ...state };
  if (toSave.completedFileSet && toSave.completedFileSet.length > 5000) {
    toSave.completedFileSetCount = toSave.completedFileSet.length;
    delete toSave.completedFileSet;
  }
  atomicWrite(p, JSON.stringify(toSave, null, 2));
}

function clearState(packPath) {
  safeUnlink(path.join(packPath, STATE_FILE));
}

// ═══════════════════════════════════════════════════════════════════════════════
// Version Resolution — resolve @latest to commit hash
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Resolve jsDelivr @latest → specific commit hash.
 * Uses jsDelivr's redirect behavior: HEAD request → 302 → extract @hash from Location.
 * Returns null if unresolved (keep using @latest).
 */
async function resolveJsDelivrVersion(packType, probePath) {
  const base = PACK_DOWNLOAD_URLS[packType];
  if (!base) return null;
  const probeUrl = probePath
    ? new URL(probePath, base + '/').toString()
    : base + '/manifest.json';

  return new Promise((resolve) => {
    const urlObj = new URL(probeUrl);
    const proto = probeUrl.startsWith('https') ? https : http;
    const opts = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'HEAD',
      headers: { 'User-Agent': 'SilverMoon-Terminal/2.0' },
    };
    const req = proto.request(opts, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const loc = res.headers.location;
        // Extract commit hash from URL: .../repo@HASH/... → .../repo@HASH
        const atIdx = loc.lastIndexOf('@');
        if (atIdx > 0) {
          const afterAt = loc.substring(atIdx);
          const slashIdx = afterAt.indexOf('/');
          const hashPart = slashIdx > 0 ? afterAt.substring(0, slashIdx) : afterAt;
          if (hashPart.length > 1) {
            const resolved = loc.substring(0, atIdx) + hashPart;
            console.log(`[dm] jsDelivr resolved @latest → ${resolved}`);
            resolve(resolved);
            return;
          }
        }
        console.log(`[dm] jsDelivr redirect to ${new URL(loc).hostname}, keeping @latest`);
        resolve(null);
        return;
      }
      res.resume();
      resolve(null); // 200 — already resolved or cached
    });
    req.on('error', (e) => {
      console.log(`[dm] jsDelivr version probe failed: ${e.message}`);
      resolve(null);
    });
    req.setTimeout(8000, () => { req.destroy(); resolve(null); });
    req.end();
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Manifest helpers
// ═══════════════════════════════════════════════════════════════════════════════

/** Generate a local manifest for a directory. */
function generateManifestForDir(dirPath) {
  const files = {};
  function walk(dir, base) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;
      if (e.name.startsWith('.')) continue;
      if (e.name.toLowerCase() === 'thumbs.db' || e.name.toLowerCase() === 'desktop.ini') continue;
      const fp = path.join(dir, e.name);
      const rel = base ? base + '/' + e.name : e.name;
      if (e.isDirectory()) { walk(fp, rel); }
      else if (e.isFile() && !e.name.endsWith('.json')) {
        const buf = fs.readFileSync(fp);
        files[rel] = { hash: crypto.createHash('sha256').update(buf).digest('hex'), size: buf.length };
      }
    }
  }
  walk(dirPath, '');
  return { generated: new Date().toISOString(), files };
}

// ═══════════════════════════════════════════════════════════════════════════════
// DownloadManager
// ═══════════════════════════════════════════════════════════════════════════════

class DownloadManager extends EventEmitter {
  constructor() {
    super();
    this.active = new Map();
    this._idCounter = 0;
  }

  // ── Public API ──────────────────────────────────────────────────────────

  getActiveSummaries() {
    const now = Date.now();
    const list = [];
    const toDelete = [];
    for (const [id, d] of this.active) {
      if (d._cleanupAt && now > d._cleanupAt) {
        toDelete.push(id);
        continue;
      }
      list.push(this._summary(d));
    }
    for (const id of toDelete) this.active.delete(id);
    return list;
  }

  /**
   * Start a pack download.
   * @param {object} opts
   * @param {string} opts.packPath
   * @param {'lite'|'medium'} opts.packType
   * @param {'full'|'update'} opts.scope — 'full' tries archive first; 'update' uses manifest
   * @param {Array<{path:string,size:number,hash?:string}>} [opts.fileList] — for incremental update
   * @param {Electron.WebContents} [opts.webContents]
   */
  async start({ packPath, packType, scope = 'full', fileList, webContents }) {
    const baseUrl = PACK_DOWNLOAD_URLS[packType];
    if (!baseUrl) throw new Error('未知的包类型: ' + packType);

    ensureDir(packPath);

    const dlId = ++this._idCounter;
    const dl = {
      id: dlId,
      packPath,
      packType,
      baseUrl,
      scope,
      mode: 'manifest',          // 'archive' | 'manifest'
      totalFiles: 0,
      completedFiles: 0,
      totalBytes: 0,
      bytesDownloaded: 0,
      currentFile: '',
      currentFileBytes: 0,       // bytes downloaded for current file
      currentFileTotal: 0,       // total bytes for current file
      cancelled: false,
      done: false,
      error: null,
      failures: 0,               // total failed files (after all retries exhausted)
      speedTracker: new SpeedTracker(),
      startTime: Date.now(),
      webContents,
      // archive-mode fields
      archiveUrl: null,
      archiveSize: 0,
      archiveSha256: null,
      chunks: [],
      // manifest-mode fields
      remainingFiles: [],
      completedFileSet: new Set(),  // Set of completed file paths
      // adaptive concurrency
      concurrency: CONCURRENCY_INITIAL,
      recentFailures: 0,
      recentSuccesses: 0,
      _activeRequests: null,
      _activeChunkRequests: null,
      _resolvedBase: null,
    };

    this.active.set(dlId, dl);
    this._push(dl);

    // Determine mode and file list
    if (fileList && fileList.length > 0) {
      // Incremental update — use manifest mode
      dl.mode = 'manifest';
      dl.scope = 'update';
      dl.totalFiles = fileList.length;
      dl.totalBytes = fileList.reduce((s, f) => s + (f.size || 0), 0);
      dl.remainingFiles = [...fileList];
    } else if (scope === 'full') {
      // Full download — try archive first, fall back to manifest
      dl.currentFile = '正在检测下载方式...';
      this._push(dl);
      await this._resolveFullPackMode(dl);
    } else {
      // scope='update' without fileList — fetch manifest and diff
      dl.currentFile = '正在获取文件清单...';
      this._push(dl);
      await this._resolveManifestMode(dl);
    }

    // Resolve version for cache-friendly URLs
    if (dl.mode === 'manifest' && !dl._resolvedBase && dl.remainingFiles.length > 0) {
      dl.remainingFiles.sort((a, b) => (a.size || 0) - (b.size || 0));
      const resolved = await resolveJsDelivrVersion(dl.packType, dl.remainingFiles[0].path);
      if (resolved) {
        dl._resolvedBase = resolved;
        console.log(`[dm] Resolved ${dl.packType} @latest → ${resolved}`);
      }
    }

    this._persist(dl);

    // Launch async
    this._runDownload(dl).then(() => {
      this._cleanup(dl);
    }).catch(err => {
      console.error('[dm] download fatal:', err.message);
      dl.error = err.message;
      this._persist(dl);
      this._push(dl);
      this._cleanup(dl);
    });

    return { downloadId: dlId, totalFiles: dl.totalFiles, totalBytes: dl.totalBytes, mode: dl.mode };
  }

  cancel(downloadId) {
    const dl = this.active.get(downloadId);
    if (!dl) return;
    dl.cancelled = true;
    // Abort all in-flight requests
    for (const set of [dl._activeRequests, dl._activeChunkRequests]) {
      if (!set) continue;
      for (const req of set) {
        try { req.destroy(); } catch (_) {}
      }
      set.clear();
    }
    this._persist(dl);
    this._push(dl);
  }

  /** Check for a persisted incomplete download. */
  static getPersistedDownload(packPath) {
    const state = loadState(packPath);
    if (!state || state.done || state.cancelled) return null;
    return state;
  }

  /** Resume a persisted download. */
  async resume(packPath, webContents) {
    const state = loadState(packPath);
    if (!state || state.done || state.cancelled) {
      throw new Error('没有可恢复的下载');
    }

    const dlId = ++this._idCounter;
    const dl = {
      id: dlId,
      packPath,
      packType: state.packType,
      baseUrl: PACK_DOWNLOAD_URLS[state.packType] || state.baseUrl,
      scope: state.scope || 'full',
      mode: state.mode || 'manifest',
      totalFiles: state.totalFiles,
      completedFiles: state.completedFiles || 0,
      totalBytes: state.totalBytes,
      bytesDownloaded: state.bytesDownloaded || 0,
      currentFile: '',
      currentFileBytes: 0,
      currentFileTotal: 0,
      cancelled: false,
      done: false,
      error: null,
      failures: state.failures || 0,
      speedTracker: new SpeedTracker(),
      startTime: Date.now(),
      webContents,
      archiveUrl: state.archiveUrl || null,
      archiveSize: state.archiveSize || 0,
      archiveSha256: state.archiveSha256 || null,
      chunks: state.chunks || [],
      remainingFiles: state.remainingFiles || [],
      completedFileSet: new Set(state.completedFileSet || []),
      concurrency: state.concurrency || CONCURRENCY_INITIAL,
      recentFailures: 0,
      recentSuccesses: 0,
      _activeRequests: null,
      _activeChunkRequests: null,
      _resolvedBase: state._resolvedBase || null,
    };

    // Re-verify completed files by scanning disk
    if (dl.mode === 'manifest') {
      dl.remainingFiles = dl.remainingFiles.filter(f => {
        const destPath = path.join(dl.packPath, f.path);
        if (fs.existsSync(destPath)) {
          try {
            const stat = fs.statSync(destPath);
            if (f.size && stat.size === f.size) {
              dl.completedFiles++;
              dl.bytesDownloaded += stat.size;
              dl.completedFileSet.add(f.path);
              return false;
            }
          } catch (_) {}
        }
        return true;
      });
    }

    this.active.set(dlId, dl);
    this._push(dl);

    try {
      if (dl.mode === 'archive' && dl.chunks.length > 0) {
        await this._runArchiveDownload(dl, true);
      } else if (dl.mode === 'manifest') {
        await this._runManifestDownload(dl);
      } else {
        await this._resolveFullPackMode(dl);
        await this._runDownload(dl);
      }
    } catch (e) {
      dl.error = e.message;
      this._push(dl);
    }

    this._cleanup(dl);
    return { downloadId: dlId, totalFiles: dl.totalFiles, totalBytes: dl.totalBytes, mode: dl.mode };
  }

  // ── Internal: Summary ────────────────────────────────────────────────────

  _summary(dl) {
    const speed = dl.speedTracker.getSpeed();
    const eta = dl.speedTracker.getETA(dl.bytesDownloaded, dl.totalBytes);
    return {
      id: dl.id,
      packType: dl.packType,
      packPath: dl.packPath,
      mode: dl.mode,
      scope: dl.scope,
      totalBytes: dl.totalBytes,
      bytesDownloaded: dl.bytesDownloaded,
      totalFiles: dl.totalFiles,
      completedFiles: dl.completedFiles,
      currentFile: dl.currentFile,
      currentFileBytes: dl.currentFileBytes,
      currentFileTotal: dl.currentFileTotal,
      cancelled: dl.cancelled,
      done: dl.done,
      error: dl.error,
      failures: dl.failures,
      concurrency: dl.concurrency,
      speed,
      speedFormatted: formatBytes(speed) + '/s',
      eta: formatDuration(eta),
      elapsed: formatDuration(dl.speedTracker.elapsedMs / 1000),
    };
  }

  _push(dl) {
    const summary = this._summary(dl);
    this.emit('progress', summary);
    try {
      if (dl.webContents && !dl.webContents.isDestroyed()) {
        dl.webContents.send('download-progress', summary);
      }
    } catch (_) {}
  }

  _persist(dl) {
    try {
      saveState(dl.packPath, {
        packType: dl.packType,
        baseUrl: dl.baseUrl,
        scope: dl.scope,
        mode: dl.mode,
        totalFiles: dl.totalFiles,
        completedFiles: dl.completedFiles,
        totalBytes: dl.totalBytes,
        bytesDownloaded: dl.bytesDownloaded,
        remainingFiles: dl.remainingFiles,
        completedFileSet: dl.completedFileSet ? [...dl.completedFileSet] : [],
        archiveUrl: dl.archiveUrl,
        archiveSize: dl.archiveSize,
        archiveSha256: dl.archiveSha256,
        chunks: dl.chunks,
        concurrency: dl.concurrency,
        failures: dl.failures,
        _resolvedBase: dl._resolvedBase,
        cancelled: dl.cancelled,
        done: dl.done,
        error: dl.error,
        updatedAt: new Date().toISOString(),
      });
    } catch (_) {}
  }

  _cleanup(dl) {
    if (dl.done || dl.cancelled || dl.error) {
      clearState(dl.packPath);
      dl._cleanupAt = Date.now() + 30_000;
    }
  }

  // ── Internal: Mode resolution ────────────────────────────────────────────

  async _resolveFullPackMode(dl) {
    // Try GitHub archive first
    const archiveUrl = GITHUB_ARCHIVE_URLS[dl.packType];
    if (archiveUrl) {
      try {
        console.log(`[dm] Probing archive: ${archiveUrl}`);
        // HEAD the archive URL — GitHub will redirect to codeload.github.com
        const head = await headRequest(archiveUrl, {}, dl);
        if (head.contentLength > 0) {
          dl.mode = 'archive';
          dl.archiveUrl = archiveUrl;
          dl.archiveSize = head.contentLength;
          dl.totalBytes = head.contentLength;
          dl.totalFiles = 1;
          console.log(`[dm] Archive mode: ${archiveUrl} (${formatBytes(head.contentLength)}, ranges: ${head.acceptRanges})`);
          return;
        }
      } catch (e) {
        console.log(`[dm] Archive not available (${e.message}), falling back to manifest`);
      }
    }

    // Fall back to manifest
    await this._resolveManifestMode(dl);
  }

  async _resolveManifestMode(dl) {
    dl.mode = 'manifest';
    try {
      const manifestUrl = dl.baseUrl + '/manifest.json';
      console.log(`[dm] Fetching manifest: ${manifestUrl}`);
      dl.currentFile = '正在获取 manifest 清单...';
      this._push(dl);
      const remote = await withRetry(
        () => fetchJson(manifestUrl, {}, dl),
        'manifest.json',
        3
      );
      const fileList = Object.entries(remote.files || {}).map(([f, info]) => ({
        path: f,
        size: info.size || 0,
        hash: info.hash || null,
      }));
      dl.totalFiles = fileList.length;
      dl.totalBytes = fileList.reduce((s, f) => s + f.size, 0);
      dl.remainingFiles = fileList;
      console.log(`[dm] Manifest mode: ${fileList.length} files, ${formatBytes(dl.totalBytes)} total`);
    } catch (e) {
      console.error(`[dm] Manifest fetch FAILED for ${dl.baseUrl}: ${e.message}`);
      throw new Error(`无法获取远程文件列表：${e.message}\nURL: ${dl.baseUrl}/manifest.json`);
    }
  }

  // ── Internal: Download dispatch ──────────────────────────────────────────

  async _runDownload(dl) {
    if (dl.mode === 'archive') {
      await this._runArchiveDownload(dl, false);
    } else {
      await this._runManifestDownload(dl);
    }
  }

  // ── Archive Download (GitHub archive zip) ────────────────────────────────

  async _runArchiveDownload(dl, isResume) {
    const destZip = path.join(dl.packPath, `_download_${dl.packType}.zip`);

    // Initialize chunks
    if (dl.chunks.length === 0) {
      const numChunks = Math.min(
        MAX_PARALLEL_CHUNKS,
        Math.max(1, Math.ceil(dl.archiveSize / CHUNK_SIZE))
      );
      const chunkSize = Math.ceil(dl.archiveSize / numChunks);
      dl.chunks = [];
      for (let i = 0; i < numChunks; i++) {
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize - 1, dl.archiveSize - 1);
        dl.chunks.push({ index: i, start, end, downloaded: 0, done: isResume ? false : false });
      }
    }

    // Open file handle
    const fd = isResume
      ? fs.openSync(destZip, 'r+')
      : (() => {
          ensureDir(path.dirname(destZip));
          const f = fs.openSync(destZip, 'w');
          fs.ftruncateSync(f, dl.archiveSize);
          return f;
        })();

    dl._activeChunkRequests = new Set();
    let chunkIdx = 0;

    const downloadChunk = async (chunk) => {
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        if (dl.cancelled) return;
        try {
          const actualStart = chunk.start + chunk.downloaded;
          if (actualStart > chunk.end) { chunk.done = true; return; }

    dl.currentFile = `归档分块 ${chunk.index + 1}/${dl.chunks.length}`;
          dl.currentFileBytes = chunk.downloaded;
          dl.currentFileTotal = chunk.end - chunk.start + 1;
          this._push(dl);

          // Stream the range response so we can push progress during download
          const { statusCode, stream } = await httpRequest(dl.archiveUrl, {
            headers: { Range: `bytes=${actualStart}-${chunk.end}` }
          }, dl);
          if (dl.cancelled) return;
          if (statusCode !== 206 && statusCode !== 200) throw new Error(`HTTP ${statusCode}`);

          const bufChunks = [];
          let bufTotal = 0;
          let lastPush = Date.now();
          await new Promise((res, rej) => {
            stream.on('data', c => {
              bufChunks.push(c);
              bufTotal += c.length;
              dl.currentFileBytes = chunk.downloaded + bufTotal;
              dl.speedTracker.add(c.length);
              dl.bytesDownloaded += c.length;
              // Throttled push
              const now = Date.now();
              if (now - lastPush >= PROGRESS_PUSH_INTERVAL_MS || bufTotal % PROGRESS_PUSH_BYTES < c.length) {
                lastPush = now;
                this._push(dl);
              }
            });
            stream.on('end', res);
            stream.on('error', rej);
          });
          if (dl.cancelled) return;

          const buf = Buffer.concat(bufChunks);
          fs.writeSync(fd, buf, 0, buf.length, actualStart);
          const delta = buf.length;
          chunk.downloaded += delta;
          if (chunk.downloaded >= (chunk.end - chunk.start + 1)) chunk.done = true;
          // bytesDownloaded already added during streaming above
          this._persist(dl);
          this._push(dl);
          return;
        } catch (e) {
          if (dl.cancelled) return;
          if (attempt < MAX_RETRIES) {
            const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1) + Math.random() * 500;
            console.log(`[dm] chunk ${chunk.index} retry ${attempt}/${MAX_RETRIES} in ${Math.round(delay)}ms: ${e.message}`);
            await sleep(delay);
          } else {
            throw new Error(`分块 ${chunk.index} 下载失败 (${MAX_RETRIES} 次重试): ${e.message}`);
          }
        }
      }
    };

    // Worker pool
    const workers = [];
    for (let w = 0; w < MAX_PARALLEL_CHUNKS; w++) {
      workers.push((async () => {
        while (chunkIdx < dl.chunks.length && !dl.cancelled) {
          const i = chunkIdx++;
          await downloadChunk(dl.chunks[i]);
        }
      })());
    }

    await Promise.all(workers);
    dl._activeChunkRequests = null;
    fs.closeSync(fd);

    if (dl.cancelled) {
      safeUnlink(destZip);
      return;
    }

    // Verify SHA-256 if available
    if (dl.archiveSha256) {
      dl.currentFile = '正在校验...';
      this._push(dl);
      const zipBuf = fs.readFileSync(destZip);
      const actual = sha256(zipBuf);
      if (actual !== dl.archiveSha256) {
        safeUnlink(destZip);
        throw new Error(`归档校验失败: 期望 ${dl.archiveSha256}, 实际 ${actual}`);
      }
    }

    // Extract
    dl.currentFile = '正在解压...';
    dl.completedFiles = 1;
    this._push(dl);
    await this._extractArchive(destZip, dl);

    safeUnlink(destZip);
    await this._saveRemoteManifest(dl);

    // Scan extracted files to update counts
    const localManifest = generateManifestForDir(dl.packPath);
    dl.totalFiles = Object.keys(localManifest.files).length;
    dl.completedFiles = dl.totalFiles;
    dl.bytesDownloaded = dl.totalBytes;

    dl.done = true;
    this._push(dl);
  }

  /** Extract GitHub archive zip, stripping the top-level directory. */
  async _extractArchive(zipPath, dl) {
    // GitHub archives contain a top-level folder like "images-Medium-main/"
    // We extract to a temp dir, then move contents into packPath.
    const tmpDir = path.join(dl.packPath, '_extract_tmp');
    ensureDir(tmpDir);

    try {
      execSync(`unzip -o -q "${zipPath}" -d "${tmpDir}"`, { stdio: 'pipe', timeout: 120_000 });
    } catch (e) {
      throw new Error('解压失败: ' + e.message);
    }

    // Find the top-level directory inside tmpDir
    const entries = fs.readdirSync(tmpDir, { withFileTypes: true });
    const topDir = entries.find(e => e.isDirectory());
    const sourceDir = topDir ? path.join(tmpDir, topDir.name) : tmpDir;

    // Move files from sourceDir to packPath
    this._moveDirContents(sourceDir, dl.packPath);

    // Cleanup temp
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    console.log('[dm] archive extracted OK');
  }

  _moveDirContents(src, dest) {
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        ensureDir(destPath);
        this._moveDirContents(srcPath, destPath);
        try { fs.rmdirSync(srcPath); } catch (_) {}
      } else {
        // Don't overwrite if destination already has correct file
        if (fs.existsSync(destPath)) {
          try {
            const srcStat = fs.statSync(srcPath);
            const dstStat = fs.statSync(destPath);
            if (srcStat.size === dstStat.size) {
              fs.unlinkSync(srcPath);
              continue;
            }
          } catch (_) {}
        }
        ensureDir(path.dirname(destPath));
        fs.renameSync(srcPath, destPath);
      }
    }
  }

  // ── Manifest Download (adaptive concurrency + keep-alive) ────────────────

  async _runManifestDownload(dl) {
    // Sort by size ascending — small files first for quick wins
    dl.remainingFiles.sort((a, b) => (a.size || 0) - (b.size || 0));

    // Filter out already-existing files (size match)
    dl.remainingFiles = dl.remainingFiles.filter(f => {
      const destPath = path.join(dl.packPath, f.path);
      if (!fs.existsSync(destPath)) return true;
      try {
        const stat = fs.statSync(destPath);
        if (f.size && stat.size === f.size) {
          dl.completedFiles++;
          dl.bytesDownloaded += stat.size;
          dl.completedFileSet.add(f.path);
          return false;
        }
      } catch (_) {}
      return true;
    });

    if (dl.remainingFiles.length === 0) {
      dl.done = true;
      await this._saveRemoteManifest(dl);
      this._push(dl);
      return;
    }

    dl._activeRequests = new Set();
    dl.speedTracker.reset();
    dl.concurrency = CONCURRENCY_INITIAL;
    dl.recentFailures = 0;
    dl.recentSuccesses = 0;

    const base = dl._resolvedBase || dl.baseUrl;
    let nextIdx = 0;
    let activeCount = 0;
    let lastAdjustTime = Date.now();

    console.log(`[dm] Manifest download: ${dl.remainingFiles.length} files, starting concurrency=${dl.concurrency}`);

    const downloadOneFile = async (f) => {
      const destPath = path.join(dl.packPath, f.path);
      ensureDir(path.dirname(destPath));

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        if (dl.cancelled) return { success: false, cancelled: true };
        try {
          dl.currentFile = f.path;
          dl.currentFileBytes = 0;
          dl.currentFileTotal = f.size || 0;
          this._push(dl);

          const url = new URL(f.path, base + '/').toString();
          // Progressive timeout: 60s → 120s → 240s on retry
          const reqTimeout = REQUEST_TIMEOUT_MS * Math.pow(2, attempt - 1);
          const buf = await this._fetchFileStream(url, f.size, dl, reqTimeout);
          if (!buf || dl.cancelled) return { success: false, cancelled: true };

          atomicWrite(destPath, buf);
          dl.completedFiles++;
          dl.bytesDownloaded += buf.length;
          dl.currentFileBytes = buf.length;
          dl.speedTracker.add(buf.length);
          dl.completedFileSet.add(f.path);
          dl.recentSuccesses++;
          this._persist(dl);
          this._push(dl);
          return { success: true };
        } catch (e) {
          if (dl.cancelled) return { success: false, cancelled: true };
          if (attempt >= MAX_RETRIES) {
            console.error(`[dm] FAILED after ${MAX_RETRIES} retries: ${f.path} — ${e.message}`);
            dl.failures++;
            dl.recentFailures++;
            // Remove from remaining so we don't try again
            dl.remainingFiles = dl.remainingFiles.filter(x => x.path !== f.path);
            return { success: false, failed: true };
          }
          const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1) + Math.random() * 500;
          console.log(`[dm] retry ${attempt}/${MAX_RETRIES} for ${f.path} in ${Math.round(delay)}ms: ${e.message}`);
          await sleep(delay);
        }
      }
      return { success: false, failed: true };
    };

    // Adaptive concurrency controller
    const adjustConcurrency = () => {
      const now = Date.now();
      if (now - lastAdjustTime < CONCURRENCY_ADJUST_INTERVAL_MS) return;
      lastAdjustTime = now;

      const totalRecent = dl.recentFailures + dl.recentSuccesses;
      if (totalRecent < 10) return; // not enough data

      const failureRate = dl.recentFailures / totalRecent;

      if (failureRate <= FAILURE_THRESHOLD_UP && dl.concurrency < CONCURRENCY_MAX) {
        dl.concurrency = Math.min(CONCURRENCY_MAX, dl.concurrency + 4);
        console.log(`[dm] concurrency ↑ ${dl.concurrency} (failure rate: ${(failureRate * 100).toFixed(1)}%)`);
      } else if (failureRate >= FAILURE_THRESHOLD_DOWN && dl.concurrency > CONCURRENCY_MIN) {
        dl.concurrency = Math.max(CONCURRENCY_MIN, dl.concurrency - 4);
        console.log(`[dm] concurrency ↓ ${dl.concurrency} (failure rate: ${(failureRate * 100).toFixed(1)}%)`);
      }

      // Reset window
      dl.recentFailures = 0;
      dl.recentSuccesses = 0;
    };

    // Dynamic worker pool
    const workerLoop = async () => {
      while (nextIdx < dl.remainingFiles.length && !dl.cancelled) {
        adjustConcurrency();
        if (activeCount >= dl.concurrency) {
          await sleep(200);
          continue;
        }
        const i = nextIdx++;
        if (i >= dl.remainingFiles.length) break;
        activeCount++;
        const result = await downloadOneFile(dl.remainingFiles[i]);
        activeCount--;
        if (result.cancelled) break;
      }
    };

    // Start initial workers
    const initialWorkers = Math.min(dl.concurrency, dl.remainingFiles.length);
    const workers = [];
    for (let w = 0; w < initialWorkers; w++) {
      workers.push(workerLoop());
    }

    // Periodically spawn additional workers as concurrency increases
    const adjustTimer = setInterval(() => {
      adjustConcurrency();
      // Spawn more workers if needed
      while (
        activeCount + workers.filter(w => !w.done).length < dl.concurrency &&
        nextIdx < dl.remainingFiles.length &&
        !dl.cancelled
      ) {
        workers.push(workerLoop());
      }
    }, CONCURRENCY_ADJUST_INTERVAL_MS);

    await Promise.all(workers);
    clearInterval(adjustTimer);
    dl._activeRequests = null;

    if (!dl.cancelled) {
      await this._saveRemoteManifest(dl);
      dl.done = true;
      this._push(dl);
    }
  }

  /**
   * Download a single file with redirect support.
   * NO LONGER blocks raw.githubusercontent.com redirects — those are
   * jsDelivr's normal fallback for uncached files.
   */
  _fetchFileStream(url, expectedSize, dl, timeout = REQUEST_TIMEOUT_MS, _redirectCount = 0) {
    if (_redirectCount > 8) return Promise.reject(new Error('too many redirects'));
    if (dl && dl.cancelled) return Promise.reject(new Error('cancelled'));

    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const proto = urlObj.protocol === 'https:' ? https : http;
      const agent = getAgent(urlObj.hostname);

      const opts = {
        hostname: urlObj.hostname,
        port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: 'GET',
        headers: {
          'User-Agent': 'SilverMoon-Terminal/2.0',
          'Accept': '*/*',
        },
        agent,
      };

      const req = proto.request(opts, (res) => {
        // Follow all redirects — including raw.githubusercontent.com
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          const nextUrl = new URL(res.headers.location, url).toString();
          if (_redirectCount === 0) {
            console.log(`[dm] redirect: ${urlObj.hostname} → ${new URL(nextUrl).hostname}`);
          }
          this._fetchFileStream(nextUrl, expectedSize, dl, timeout, _redirectCount + 1)
            .then(resolve, reject);
          return;
        }

        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }

        if (dl && dl.cancelled) { res.destroy(); reject(new Error('cancelled')); return; }

        const cl = parseInt(res.headers['content-length'] || '0', 10);
        const limit = Math.max(expectedSize || cl, cl) + 4096; // 4KB safety margin

        const chunks = [];
        let total = 0;
        let lastPush = Date.now();
        res.on('data', c => {
          if (dl && dl.cancelled) { res.destroy(); reject(new Error('cancelled')); return; }
          total += c.length;
          if (total > limit) { res.destroy(); reject(new Error('size exceeded')); return; }
          chunks.push(c);
          // Per-chunk progress for current file
          dl.currentFileBytes = total;
          if (dl.speedTracker) dl.speedTracker.add(c.length);
          // Throttled push — update UI at most every 250ms or every 64KB
          const now = Date.now();
          if (now - lastPush >= PROGRESS_PUSH_INTERVAL_MS || total % PROGRESS_PUSH_BYTES < c.length) {
            lastPush = now;
            this._push(dl);
          }
        });
        res.on('end', () => {
          if (dl && dl.cancelled) { reject(new Error('cancelled')); return; }
          resolve(Buffer.concat(chunks));
        });
        res.on('error', (err) => {
          console.log(`[dm] stream error: ${err.message}`);
          reject(err);
        });
      });

      req.on('error', (err) => {
        console.log(`[dm] request error: ${err.message}`);
        reject(err);
      });
      req.setTimeout(timeout, () => { req.destroy(); reject(new Error('timeout')); });
      req.end();

      if (dl && dl._activeRequests) {
        dl._activeRequests.add(req);
        req.on('close', () => dl._activeRequests && dl._activeRequests.delete(req));
      }
    });
  }

  // ── Manifest helpers ─────────────────────────────────────────────────────

  async _saveRemoteManifest(dl) {
    try {
      const text = await withRetry(
        () => fetchBuffer(dl.baseUrl + '/manifest.json', { maxSize: 10 * 1024 * 1024 }, dl),
        'remote manifest',
        3
      );
      fs.writeFileSync(path.join(dl.packPath, 'manifest.json'), text);
    } catch (_) {
      // Non-fatal
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Singleton
// ═══════════════════════════════════════════════════════════════════════════════

let _instance = null;
function getDownloadManager() {
  if (!_instance) _instance = new DownloadManager();
  return _instance;
}

module.exports = {
  DownloadManager,
  getDownloadManager,
  PACK_DOWNLOAD_URLS,
  GITHUB_ARCHIVE_URLS,
  resolveJsDelivrVersion,
  generateManifestForDir,
  loadState,
  clearState,
};

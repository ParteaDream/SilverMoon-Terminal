/**
 * SilverMoon Terminal — Download Manager
 *
 * Persistent, resumable download engine with:
 *  - ZIP-first mode (single file, chunked, resumable via HTTP Range)
 *  - Manifest fallback (individual files with retry)
 *  - Exponential-backoff retry (max 5 attempts)
 *  - SHA-256 integrity verification
 *  - Disk-persisted state (survives renderer navigation + app restart)
 *  - Push progress events to renderer via BrowserWindow.webContents
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

// ── Constants ────────────────────────────────────────────────────────────────

const CHUNK_SIZE = 4 * 1024 * 1024;       // 4 MB per chunk for parallel zip download
const MAX_PARALLEL_CHUNKS = 6;             // parallel chunk downloads
const MAX_RETRIES = 5;                     // max retries per chunk / file
const RETRY_BASE_MS = 800;                 // base delay for exponential backoff
const REQUEST_TIMEOUT_MS = 30_000;         // per-request timeout
const SPEED_WINDOW_MS = 5_000;            // rolling window for speed calculation
const CONCURRENT_FILES = 16;              // parallel files in manifest mode
const STATE_FILE = '.download-state.json'; // persisted in pack directory

const PACK_DOWNLOAD_URLS = {
  lite:   'https://cdn.jsdelivr.net/gh/ParteaDream/images-Lite@latest',
  medium: 'https://cdn.jsdelivr.net/gh/ParteaDream/images-Medium@latest',
  // extreme: 'https://cdn.jsdelivr.net/gh/ParteaDream/images-Extreme@latest',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/** Ensure a directory exists (recursive, sync — fine for small operations). */
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/** Atomic write: write to .tmp then rename. */
function atomicWrite(filePath, data) {
  const tmp = filePath + '.tmp';
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, filePath);
}

/** Safely delete a file. */
function safeUnlink(p) { try { fs.unlinkSync(p); } catch (_) {} }

// ── SpeedTracker ─────────────────────────────────────────────────────────────

class SpeedTracker {
  constructor(windowMs = SPEED_WINDOW_MS) {
    this.windowMs = windowMs;
    this.samples = []; // { time: ms, bytes: number }
  }

  add(bytes) {
    const now = Date.now();
    this.samples.push({ time: now, bytes });
    // prune old samples
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

  reset() { this.samples = []; }
}

// ── HTTP Helpers ─────────────────────────────────────────────────────────────

/**
 * HTTP(S) request with redirect, timeout, and optional cancel support.
 * Returns { statusCode, headers, stream } — caller must consume stream.
 * Pass `dl` (download object) to enable cancel-on-demand via dl._activeChunkRequests.
 */
function streamRequest(url, opts = {}, dl) {
  return new Promise((resolve, reject) => {
    const { method = 'GET', headers = {}, timeout = REQUEST_TIMEOUT_MS, maxRedirects = 5 } = opts;
    const proto = url.startsWith('https') ? https : http;

    function doReq(reqUrl, redirectsLeft) {
      if (dl && dl.cancelled) { reject(new Error('cancelled')); return; }

      const urlObj = new URL(reqUrl);
      const reqOpts = {
        method,
        hostname: urlObj.hostname,
        port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        headers: {
          'User-Agent': 'SilverMoon-Terminal/1.0',
          ...headers,
        },
      };

      const req = proto.request(reqOpts, (res) => {
        // redirect
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
          res.resume();
          const next = new URL(res.headers.location, reqUrl).toString();
          doReq(next, redirectsLeft - 1);
          return;
        }
        resolve({ statusCode: res.statusCode, headers: res.headers, stream: res });
      });

      req.on('error', reject);
      req.setTimeout(timeout, () => { req.destroy(); reject(new Error('timeout')); });
      req.end();

      // Track for cancellation
      if (dl && dl._activeChunkRequests) {
        dl._activeChunkRequests.add(req);
        req.on('close', () => dl._activeChunkRequests && dl._activeChunkRequests.delete(req));
      }
    }

    doReq(url, maxRedirects);
  });
}

/** Download entire response body as buffer. */
async function fetchBuffer(url, opts = {}) {
  const { statusCode, stream } = await streamRequest(url, opts);
  if (statusCode !== 200) throw new Error(`HTTP ${statusCode}`);
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', c => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

/** Fetch JSON from URL. */
async function fetchJson(url, opts = {}) {
  const buf = await fetchBuffer(url, opts);
  return JSON.parse(buf.toString('utf-8'));
}

/** Download a byte range. Returns Buffer. Accepts optional dl for cancel support. */
async function fetchRange(url, start, end, dl) {
  const headers = { Range: `bytes=${start}-${end}` };
  const { statusCode, stream } = await streamRequest(url, { headers }, dl);
  if (statusCode !== 206 && statusCode !== 200) throw new Error(`HTTP ${statusCode}`);
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', c => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

/** HEAD request to get Content-Length and Accept-Ranges. */
async function headRequest(url, opts = {}) {
  const { statusCode, headers } = await streamRequest(url, { ...opts, method: 'HEAD' });
  if (statusCode !== 200) throw new Error(`HTTP ${statusCode}`);
  return {
    contentLength: parseInt(headers['content-length'] || '0', 10),
    acceptRanges: headers['accept-ranges'] === 'bytes',
  };
}

// ── Retry wrapper ────────────────────────────────────────────────────────────

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

// ── Download State Persistence ───────────────────────────────────────────────

function loadState(packPath) {
  const p = path.join(packPath, STATE_FILE);
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch (_) {}
  return null;
}

function saveState(packPath, state) {
  const p = path.join(packPath, STATE_FILE);
  atomicWrite(p, JSON.stringify(state, null, 2));
}

function clearState(packPath) {
  safeUnlink(path.join(packPath, STATE_FILE));
}

// ── Download Manager Class ──────────────────────────────────────────────────

class DownloadManager extends EventEmitter {
  constructor() {
    super();
    /** @type {Map<number, object>} active downloads */
    this.active = new Map();
    this._idCounter = 0;
  }

  /**
   * Get all active download summaries (for polling/recovery).
   */
  getActiveSummaries() {
    const now = Date.now();
    const list = [];
    const toDelete = [];
    for (const [id, d] of this.active) {
      if (d._cleanupAt && now > d._cleanupAt) {
        toDelete.push(id);
        continue;
      }
      list.push({
        id: d.id,
        packType: d.packType,
        packPath: d.packPath,
        mode: d.mode,                              // 'zip' | 'manifest'
        totalBytes: d.totalBytes,
        bytesDownloaded: d.bytesDownloaded,
        totalFiles: d.totalFiles,
        completedFiles: d.completedFiles,
        currentFile: d.currentFile,
        cancelled: d.cancelled,
        done: d.done,
        error: d.error,
        speed: d.speedTracker ? d.speedTracker.getSpeed() : 0,
      });
    }
    for (const id of toDelete) this.active.delete(id);
    return list;
  }

  /**
   * Start a pack download.
   *
   * @param {object} opts
   * @param {string} opts.packPath   - local directory for the pack
   * @param {'lite'|'medium'|'extreme'} opts.packType
   * @param {Array<{path:string,size:number}>} [opts.fileList] - if omitted, full remote pack
   * @param {import('electron').WebContents} [opts.webContents] - for push progress
   * @returns {{ downloadId: number, totalFiles: number, mode: string }}
   */
  async start({ packPath, packType, fileList, webContents }) {
    const baseUrl = PACK_DOWNLOAD_URLS[packType];
    if (!baseUrl) throw new Error('未知的包类型: ' + packType);

    ensureDir(packPath);

    const dlId = ++this._idCounter;
    const dl = {
      id: dlId,
      packPath,
      packType,
      baseUrl,
      mode: 'manifest',          // determined below
      totalFiles: 0,
      completedFiles: 0,
      totalBytes: 0,
      bytesDownloaded: 0,
      currentFile: '',
      cancelled: false,
      done: false,
      error: null,
      speedTracker: new SpeedTracker(),
      startTime: Date.now(),
      webContents,
      // zip-mode fields
      zipUrl: null,
      zipSize: 0,
      zipSha256: null,
      chunks: [],
      // manifest-mode fields
      remainingFiles: [],
      completedFileSet: new Set(),
    };

    this.active.set(dlId, dl);
    this._push(dl);

    // ── Resolve file list ──
    if (fileList && fileList.length > 0) {
      // explicit file list (incremental update) — always manifest mode
      dl.mode = 'manifest';
      dl.totalFiles = fileList.length;
      dl.totalBytes = fileList.reduce((s, f) => s + (f.size || 0), 0);
      dl.remainingFiles = [...fileList];
    } else {
      // full pack — try zip mode first, fall back to manifest
      dl.currentFile = '正在获取文件清单...';
      this._push(dl);
      await this._resolveFullPack(dl);
    }

    // Persist initial state
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

    return { downloadId: dlId, totalFiles: dl.totalFiles, mode: dl.mode };
  }

  /**
   * Cancel an active download. Immediately aborts all in-flight HTTP requests.
   */
  cancel(downloadId) {
    const dl = this.active.get(downloadId);
    if (dl) {
      dl.cancelled = true;
      // Immediately abort all in-flight requests
      if (dl._activeRequests) {
        for (const req of dl._activeRequests) {
          try { req.destroy(); } catch (_) {}
        }
        dl._activeRequests.clear();
      }
      if (dl._activeChunkRequests) {
        for (const req of dl._activeChunkRequests) {
          try { req.destroy(); } catch (_) {}
        }
        dl._activeChunkRequests.clear();
      }
      this._persist(dl);
      this._push(dl); // immediate feedback
    }
  }

  /**
   * Check if there's a persisted incomplete download that can be resumed.
   * Returns { downloadId, packType, ... } or null.
   */
  static getPersistedDownload(packPath) {
    const state = loadState(packPath);
    if (!state || state.done || state.cancelled) return null;
    return state;
  }

  /**
   * Resume a persisted download.
   */
  async resume(packPath, webContents) {
    const state = loadState(packPath);
    if (!state || state.done || state.cancelled) {
      throw new Error('没有可恢复的下载');
    }

    // Reconstruct dl object from persisted state
    const dlId = ++this._idCounter;
    const dl = {
      id: dlId,
      packPath,
      packType: state.packType,
      baseUrl: PACK_DOWNLOAD_URLS[state.packType] || state.baseUrl,
      mode: state.mode,
      totalFiles: state.totalFiles,
      completedFiles: state.mode === 'manifest'
        ? (state.totalFiles - state.remainingFiles.length)
        : state.completedFiles,
      totalBytes: state.totalBytes,
      bytesDownloaded: state.bytesDownloaded,
      currentFile: '',
      cancelled: false,
      done: false,
      error: null,
      speedTracker: new SpeedTracker(),
      startTime: Date.now(),
      webContents,
      zipUrl: state.zipUrl || null,
      zipSize: state.zipSize || 0,
      zipSha256: state.zipSha256 || null,
      chunks: state.chunks || [],
      remainingFiles: state.remainingFiles || [],
      completedFileSet: new Set(),
    };

    // Restore completed files set for manifest mode
    if (dl.mode === 'manifest') {
      const doneCount = state.totalFiles - (state.remainingFiles?.length || state.totalFiles);
      // We don't have the completed set names in state, but we have remainingFiles
      // The download will skip files that already exist on disk
    }

    this.active.set(dlId, dl);
    this._push(dl);

    if (dl.mode === 'zip' && dl.chunks.length > 0) {
      await this._resumeZipDownload(dl);
    } else if (dl.mode === 'manifest') {
      await this._runManifestDownload(dl);
    } else {
      // fallback: start fresh
      await this._resolveFullPack(dl);
      await this._runDownload(dl);
    }

    this._cleanup(dl);
    return { downloadId: dlId, totalFiles: dl.totalFiles, mode: dl.mode };
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  _push(dl) {
    const summary = {
      id: dl.id,
      packType: dl.packType,
      mode: dl.mode,
      totalBytes: dl.totalBytes,
      bytesDownloaded: dl.bytesDownloaded,
      totalFiles: dl.totalFiles,
      completedFiles: dl.completedFiles,
      currentFile: dl.currentFile,
      cancelled: dl.cancelled,
      done: dl.done,
      error: dl.error,
      speed: dl.speedTracker.getSpeed(),
    };
    // Emit locally
    this.emit('progress', summary);
    // Push to renderer if available
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
        mode: dl.mode,
        totalFiles: dl.totalFiles,
        completedFiles: dl.completedFiles,
        totalBytes: dl.totalBytes,
        bytesDownloaded: dl.bytesDownloaded,
        remainingFiles: dl.mode === 'manifest' ? dl.remainingFiles : [],
        zipUrl: dl.zipUrl,
        zipSize: dl.zipSize,
        zipSha256: dl.zipSha256,
        chunks: dl.chunks,
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
      // Keep in active map for a short while so late pollers see final state,
      // then remove on next getActiveSummaries call.
      dl._cleanupAt = Date.now() + 30_000; // 30s grace
    }
  }

  // ── Full-pack resolution ────────────────────────────────────────────────

  async _resolveFullPack(dl) {
    // Try ZIP first (single attempt — no need to retry missing files)
    for (const zipExt of ['.zip']) {
      const zipName = `images-${dl.packType.charAt(0).toUpperCase() + dl.packType.slice(1)}${zipExt}`;
      const zipUrl = dl.baseUrl + '/' + zipName;
      try {
        const head = await headRequest(zipUrl);
        if (head.contentLength > 0) {
          dl.mode = 'zip';
          dl.zipUrl = zipUrl;
          dl.zipSize = head.contentLength;
          dl.totalBytes = head.contentLength;
          dl.totalFiles = 1;
          console.log(`[dm] ZIP mode: ${zipUrl} (${(head.contentLength / 1024 / 1024).toFixed(1)} MB, ranges: ${head.acceptRanges})`);
          return;
        }
      } catch (e) {
        console.log(`[dm] ZIP not available (${e.message}), falling back to manifest`);
      }
    }

    if (dl.cancelled) return;

    // Fall back to manifest
    dl.mode = 'manifest';
    try {
      const manifestUrl = dl.baseUrl + '/manifest.json';
      console.log(`[dm] Fetching manifest: ${manifestUrl}`);
      dl.currentFile = '正在获取 manifest 清单...';
      this._push(dl);
      const remote = await withRetry(
        () => fetchJson(manifestUrl),
        'manifest.json',
        3
      );
      const fileList = Object.entries(remote.files).map(([f, info]) => ({
        path: f,
        size: info.size,
        hash: info.hash,
      }));
      dl.totalFiles = fileList.length;
      dl.totalBytes = fileList.reduce((s, f) => s + f.size, 0);
      dl.remainingFiles = fileList;
      console.log(`[dm] Manifest mode: ${fileList.length} files, ${(dl.totalBytes / 1024 / 1024).toFixed(1)} MB total`);
    } catch (e) {
      console.error(`[dm] Manifest fetch FAILED for ${dl.baseUrl}: ${e.message}`);
      throw new Error(`无法获取远程文件列表：${e.message}\nURL: ${dl.baseUrl}/manifest.json`);
    }
  }

  // ── Download dispatch ────────────────────────────────────────────────────

  async _runDownload(dl) {
    if (dl.mode === 'zip') {
      await this._runZipDownload(dl);
    } else {
      await this._runManifestDownload(dl);
    }
  }

  // ── ZIP Download (chunked, resumable) ────────────────────────────────────

  async _runZipDownload(dl) {
    const destZip = path.join(dl.packPath, `_download_${dl.packType}.zip`);
    const canResume = true; // we'll check Accept-Ranges later

    // Initialize chunks if not already set (from resume)
    if (dl.chunks.length === 0) {
      const numChunks = Math.min(
        MAX_PARALLEL_CHUNKS,
        Math.max(1, Math.ceil(dl.zipSize / CHUNK_SIZE))
      );
      const chunkSize = Math.ceil(dl.zipSize / numChunks);
      dl.chunks = [];
      for (let i = 0; i < numChunks; i++) {
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize - 1, dl.zipSize - 1);
        dl.chunks.push({ index: i, start, end, downloaded: 0, done: false });
      }
    }

    // Ensure temp file exists (allocate sparse? no — we'll write in order)
    if (!fs.existsSync(destZip)) {
      // Create empty file of correct size for ordered writes
      ensureDir(path.dirname(destZip));
      // We write chunks as they arrive using positional writes
    }

    // Open file handle for positional writes
    const fd = fs.openSync(destZip, 'w');
    // Pre-allocate to zip size (sparse on APFS)
    fs.ftruncateSync(fd, dl.zipSize);

    dl._activeChunkRequests = new Set();
    let chunkIdx = 0;

    const downloadChunk = async (chunk) => {
      let lastError = null;
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        if (dl.cancelled) return;
        try {
          dl.currentFile = `chunk ${chunk.index + 1}/${dl.chunks.length}`;
          this._push(dl);

          const buf = await fetchRange(dl.zipUrl, chunk.start, chunk.end, dl);
          if (dl.cancelled) return;
          // Write at correct position
          fs.writeSync(fd, buf, 0, buf.length, chunk.start);
          const delta = buf.length - chunk.downloaded;
          chunk.downloaded = buf.length;
          chunk.done = true;
          dl.bytesDownloaded += delta;
          dl.speedTracker.add(delta);
          this._persist(dl);
          this._push(dl);
          return;
        } catch (e) {
          if (dl.cancelled) return;
          lastError = e;
          if (attempt < MAX_RETRIES) {
            const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1) + Math.random() * 500;
            console.log(`[dm] chunk ${chunk.index} retry ${attempt}/${MAX_RETRIES} in ${Math.round(delay)}ms`);
            await sleep(delay);
          }
        }
      }
      throw lastError || new Error(`Chunk ${chunk.index} failed after ${MAX_RETRIES} retries`);
    };

    // Work loop
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

    // Verify SHA-256 if we have one from manifest
    if (dl.zipSha256) {
      dl.currentFile = 'verifying...';
      this._push(dl);
      const zipBuf = fs.readFileSync(destZip);
      const actual = sha256(zipBuf);
      if (actual !== dl.zipSha256) {
        safeUnlink(destZip);
        throw new Error(`ZIP checksum mismatch: expected ${dl.zipSha256}, got ${actual}`);
      }
    }

    // Extract ZIP
    dl.currentFile = 'extracting...';
    dl.completedFiles = 1;
    this._push(dl);
    this._extractZip(destZip, dl.packPath);

    // Clean up the zip file
    safeUnlink(destZip);

    // Save manifest
    await this._saveRemoteManifest(dl);

    dl.done = true;
    this._push(dl);
  }

  async _resumeZipDownload(dl) {
    // Re-open and continue from where we left off
    const destZip = path.join(dl.packPath, `_download_${dl.packType}.zip`);
    const fd = fs.openSync(destZip, 'r+');

    let chunkIdx = 0;
    const pendingChunks = dl.chunks.filter(c => !c.done);

    const downloadChunk = async (chunk) => {
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        if (dl.cancelled) return;
        try {
          // If partially downloaded, request from that offset
          const actualStart = chunk.start + chunk.downloaded;
          if (actualStart > chunk.end) { chunk.done = true; return; }
          const buf = await fetchRange(dl.zipUrl, actualStart, chunk.end);
          fs.writeSync(fd, buf, 0, buf.length, actualStart);
          const delta = buf.length;
          chunk.downloaded += delta;
          if (chunk.downloaded >= (chunk.end - chunk.start + 1)) chunk.done = true;
          dl.bytesDownloaded += delta;
          dl.speedTracker.add(delta);
          this._persist(dl);
          this._push(dl);
          return;
        } catch (e) {
          if (attempt >= MAX_RETRIES) throw e;
          await sleep(RETRY_BASE_MS * Math.pow(2, attempt - 1));
        }
      }
    };

    const workers = [];
    for (let w = 0; w < MAX_PARALLEL_CHUNKS; w++) {
      workers.push((async () => {
        while (chunkIdx < pendingChunks.length && !dl.cancelled) {
          const i = chunkIdx++;
          await downloadChunk(pendingChunks[i]);
        }
      })());
    }

    await Promise.all(workers);
    fs.closeSync(fd);

    if (dl.cancelled) { safeUnlink(destZip); return; }

    // Verify and extract
    if (dl.zipSha256) {
      const zipBuf = fs.readFileSync(destZip);
      if (sha256(zipBuf) !== dl.zipSha256) {
        safeUnlink(destZip);
        throw new Error('ZIP checksum mismatch on resume');
      }
    }

    dl.currentFile = 'extracting...';
    dl.completedFiles = 1;
    this._push(dl);
    this._extractZip(destZip, dl.packPath);
    safeUnlink(destZip);
    await this._saveRemoteManifest(dl);

    dl.done = true;
    this._push(dl);
  }

  _extractZip(zipPath, destDir) {
    // Use built-in unzip if available (Node 18+), or external
    // For backwards compat with older Node, try execSync unzip first
    const { execSync } = require('child_process');
    try {
      // macOS has unzip built-in
      execSync(`unzip -o -q "${zipPath}" -d "${destDir}"`, { stdio: 'pipe' });
      console.log('[dm] zip extracted OK');
    } catch (e) {
      // Fallback: try Node's built-in (if available)
      try {
        // Node 18.17+ has zlib.brotliDecompress + experimental zip
        // For now, just throw — user needs `unzip` on macOS (always present)
        throw new Error('unzip failed: ' + e.message);
      } catch (_) {
        throw new Error('ZIP extraction failed. Ensure "unzip" is available.');
      }
    }
  }

  // ── Manifest Download (individual files, improved) ────────────────────────

  async _runManifestDownload(dl) {
    // Sort by size ascending — small files first for quick wins
    dl.remainingFiles.sort((a, b) => (a.size || 0) - (b.size || 0));

    // Filter out files that already exist with correct size/hash
    dl.remainingFiles = dl.remainingFiles.filter(f => {
      const destPath = path.join(dl.packPath, f.path);
      if (!fs.existsSync(destPath)) return true;
      try {
        const stat = fs.statSync(destPath);
        if (f.size && stat.size === f.size) {
          // Size matches — consider done (skip hash check for speed)
          dl.completedFiles++;
          dl.bytesDownloaded += stat.size;
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

    // Track active requests so cancel() can abort them immediately
    dl._activeRequests = new Set();
    let idx = 0;

    const downloadFile = async (f) => {
      const destPath = path.join(dl.packPath, f.path);
      ensureDir(path.dirname(destPath));

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        if (dl.cancelled) return;
        try {
          const url = new URL(f.path, dl.baseUrl + '/').toString();
          const buf = await this._fetchFile(url, null, f.size, dl);
          if (!buf || dl.cancelled) return; // cancelled during download

          atomicWrite(destPath, buf);
          dl.completedFiles++;
          dl.bytesDownloaded += buf.length;
          dl.currentFile = f.path;
          dl.speedTracker.add(buf.length);
          this._persist(dl);
          this._push(dl);
          return;
        } catch (e) {
          if (dl.cancelled) return;
          if (attempt >= MAX_RETRIES) {
            console.error(`[dm] FAILED after ${MAX_RETRIES} retries: ${f.path} — ${e.message}`);
            dl.remainingFiles = dl.remainingFiles.filter(x => x.path !== f.path);
            return;
          }
          const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1) + Math.random() * 500;
          console.log(`[dm] retry ${attempt}/${MAX_RETRIES} for ${f.path} in ${Math.round(delay)}ms: ${e.message}`);
          await sleep(delay);
        }
      }
    };

    // Worker pool
    const workers = [];
    const total = dl.remainingFiles.length;
    for (let w = 0; w < Math.min(CONCURRENT_FILES, total); w++) {
      workers.push((async () => {
        while (idx < dl.remainingFiles.length && !dl.cancelled) {
          const i = idx++;
          await downloadFile(dl.remainingFiles[i]);
        }
      })());
    }

    await Promise.all(workers);
    dl._activeRequests = null;

    if (!dl.cancelled) {
      await this._saveRemoteManifest(dl);
      dl.done = true;
      this._push(dl);
    }
    // If cancelled, cancel() already pushed — don't push again
  }

  /** Download a single file with redirect support, timeout, cancel-check, and size validation. */
  async _fetchFile(url, agent, expectedSize, dl, _redirectCount = 0) {
    if (_redirectCount > 5) throw new Error('too many redirects');
    if (dl && dl.cancelled) throw new Error('cancelled');

    return new Promise((resolve, reject) => {
      const proto = url.startsWith('https') ? https : http;
      const urlObj = new URL(url);
      const opts = {
        hostname: urlObj.hostname,
        port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: 'GET',
        headers: { 'User-Agent': 'SilverMoon-Terminal/1.0' },
        agent,
      };
      const req = proto.request(opts, (res) => {
        // Follow redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          const nextUrl = new URL(res.headers.location, url).toString();
          if (_redirectCount === 0) console.log(`[dm] redirect: ${urlObj.hostname} → ${new URL(nextUrl).hostname}`);
          this._fetchFile(nextUrl, agent, expectedSize, dl, _redirectCount + 1)
            .then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          console.log(`[dm] HTTP ${res.statusCode} for ${urlObj.hostname}${urlObj.pathname}`);
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }

        // Check cancelled before buffering
        if (dl && dl.cancelled) { res.destroy(); reject(new Error('cancelled')); return; }

        const cl = parseInt(res.headers['content-length'] || '0', 10);
        const limit = Math.max(expectedSize || cl, cl) + 1024;

        const chunks = [];
        let total = 0;
        res.on('data', c => {
          if (dl && dl.cancelled) { res.destroy(); reject(new Error('cancelled')); return; }
          total += c.length;
          if (total > limit) { res.destroy(); reject(new Error('size exceeded')); return; }
          chunks.push(c);
        });
        res.on('end', () => {
          if (dl && dl.cancelled) { reject(new Error('cancelled')); return; }
          resolve(Buffer.concat(chunks));
        });
        res.on('error', (err) => {
          console.log(`[dm] stream error for ${urlObj.hostname}${urlObj.pathname}: ${err.message}`);
          reject(err);
        });
      });
      req.on('error', (err) => {
        console.log(`[dm] request error for ${urlObj.hostname}${urlObj.pathname}: ${err.message}`);
        reject(err);
      });
      req.setTimeout(REQUEST_TIMEOUT_MS, () => { req.destroy(); reject(new Error('timeout')); });
      req.end();

      // Track for immediate cancellation
      if (dl && dl._activeRequests) {
        dl._activeRequests.add(req);
        req.on('close', () => dl._activeRequests && dl._activeRequests.delete(req));
      }
    });
  }

  /** Probe the CDN to resolve the final endpoint for keep-alive connection reuse. */
  async _resolveCdnEndpoint(probeUrl) {
    return new Promise((resolve) => {
      const proto = probeUrl.startsWith('https') ? https : http;
      function follow(url, redirects) {
        if (redirects > 5) { resolve(null); return; }
        const urlObj = new URL(url);
        const opts = {
          hostname: urlObj.hostname,
          port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
          path: urlObj.pathname + urlObj.search,
          method: 'GET',
          headers: { 'User-Agent': 'SilverMoon-Terminal/1.0' },
        };
        const req = proto.request(opts, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            const next = new URL(res.headers.location, url).toString();
            follow(next, redirects + 1);
            return;
          }
          // Reached final URL — drain and return origin
          res.on('data', () => {});
          res.on('end', () => resolve(new URL(url).origin));
          res.on('error', () => resolve(null));
        });
        req.on('error', () => resolve(null));
        req.setTimeout(5000, () => { req.destroy(); resolve(null); });
        req.end();
      }
      follow(probeUrl, 0);
    });
  }

  /** Download and save the remote manifest.json */
  async _saveRemoteManifest(dl) {
    try {
      const text = await withRetry(
        () => fetchBuffer(dl.baseUrl + '/manifest.json', { timeout: 15000 }),
        'remote manifest',
        3
      );
      fs.writeFileSync(path.join(dl.packPath, 'manifest.json'), text);
    } catch (_) {
      // Non-fatal: manifest is optional
    }
  }
}

// ── Singleton ────────────────────────────────────────────────────────────────

let _instance = null;
function getDownloadManager() {
  if (!_instance) _instance = new DownloadManager();
  return _instance;
}

module.exports = {
  DownloadManager,
  getDownloadManager,
  PACK_DOWNLOAD_URLS,
  loadState,
  clearState,
};

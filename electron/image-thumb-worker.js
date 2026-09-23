/**
 * 渲染进程缩略图兜底。
 *
 * 背景：部分图包资源（例如 images-Medium/Wallpaper 下的 *.webp，VP8/VP8L，
 * 4096×2304）主进程的 nativeImage 无法解码，导致 generateThumbnailBuffer 返回
 * null，readImageFile 回落到「直读原文件」，把整张 4K 原图 base64 后送进渲染进程
 * —— maxWidth 参数被静默忽略（实测单张 3494 KB）。
 *
 * 渲染进程（Chromium）可以正常解码这些文件，因此这里用一个隐藏窗口做兜底：
 * 解码 → canvas 缩放 → 编码为 WebP，比主进程重编码 PNG 小一个数量级
 * （实测 4096×2304 → 512px：PNG 417.8 KB / WebP 45.6 KB / 原图 9439 KB）。
 *
 * 设计约束：
 * - 窗口懒创建，只在主进程缩略失败后才会出现，用户不可见。
 * - 所有请求串行执行，避免同时解码多张 4K 图拖垮进程。
 * - 任何失败都返回 null，调用方回落原有行为，不抛错、不阻塞。
 * - 必须在主窗口关闭 / 应用退出时销毁，否则 window-all-closed 不会触发。
 */
const { BrowserWindow, app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

// 逃生开关：出问题时设为 1 即可完全回到旧行为
const DISABLED = process.env.SILVERMOON_DISABLE_THUMB_WORKER === '1';
const REQUEST_TIMEOUT_MS = 15000;
// 大图才值得绕这一圈；小图直读的绝对耗时更低（虽然载荷大一些）。
// 这是防止「图库里有几千张中等图」时每张都白等一次 worker 往返。
const MIN_BYTES_FOR_WORKER = 256 * 1024;
// 上限兜底：即使调用方传入更大的 maxWidth，也不会生成超大缩略图，避免载荷失控
// （当前最大的调用方是 Changelog 版本背景，请求 2048）。
const MAX_TARGET_WIDTH = 2048;

let win = null;
let ready = null;
let queue = Promise.resolve();
let destroyed = false;

function ensureWorker() {
  if (DISABLED || destroyed) return Promise.resolve(null);
  if (ready) return ready;
  ready = (async () => {
    try {
      const w = new BrowserWindow({
        show: false,
        width: 320,
        height: 240,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          backgroundThrottling: false,
        },
      });
      // 页面随应用代码一起打包，避免依赖外部路径
      w.webContents.setAudioMuted(true);
      w.on('closed', () => { win = null; ready = null; });
      await w.loadFile(path.join(__dirname, 'thumb-worker.html'));
      win = w;
      return w;
    } catch (e) {
      ready = null;
      return null;
    }
  })();
  return ready;
}

const RUN = `(async () => {
  const url = __URL__, target = __TARGET__, quality = __QUALITY__;
  const load = await new Promise(res => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => res(null);
    im.src = url;
  });
  if (!load) return null;
  const w = load.naturalWidth, h = load.naturalHeight;
  // 解码成功但拿不到自然尺寸：宁可返回 null 让调用方回落，也不要发原图
  if (!w || !h) return null;
  // 只在明显超采样时才缩放（留 1.1 倍余量，避免为几像素差异重编码）。
  // 注意：这里必须真的生成缩略图，不能因为源图比目标大就直接返回 null ——
  // 那会让调用方回落到「直读原文件」，正是本模块要修掉的问题。
  const tw = Math.round(target);
  if (w <= tw * 1.1) return null;
  const th = Math.max(1, Math.round(h * (target / w)));
  const c = document.createElement('canvas');
  c.width = tw; c.height = th;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(load, 0, 0, tw, th);
  let out = null;
  try { out = c.toDataURL('image/webp', quality); } catch (_) {}
  if (!out || out.indexOf('data:image/webp') !== 0) {
    try { out = c.toDataURL('image/jpeg', quality); } catch (_) {}
  }
  return out || null;
})()`;

function makeRunScript(fp, maxWidth, quality) {
  const url = pathToFileURL(fp).href;
  return RUN
    .replace('__URL__', JSON.stringify(url))
    .replace('__TARGET__', String(maxWidth))
    .replace('__QUALITY__', String(quality));
}

/**
 * 用隐藏渲染窗口生成缩略图。
 * @param {string} fp 源文件绝对路径
 * @param {number} maxWidth 目标宽度（只降采样）
 * @param {number} [quality] WebP 质量，默认 0.82
 * @returns {Promise<string|null>} data URL，失败返回 null
 */
async function rendererThumbnail(fp, maxWidth, quality = 0.82) {
  if (DISABLED) return null;
  if (!fp || !maxWidth || maxWidth <= 0) return null;
  try {
    const st = fs.statSync(fp);
    if (!st.isFile() || st.size < MIN_BYTES_FOR_WORKER) return null;
  } catch (_) { return null; }

  const run = async () => {
    const w = await ensureWorker();
    if (!w || w.isDestroyed()) return null;
    const script = makeRunScript(fp, Math.min(MAX_TARGET_WIDTH, Math.round(maxWidth)), quality);
    let timer = null;
    try {
      return await Promise.race([
        w.webContents.executeJavaScript(script, true),
        new Promise(res => { timer = setTimeout(() => res(null), REQUEST_TIMEOUT_MS); }),
      ]);
    } catch (_) {
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  // 串行化：同一时刻只解码/编码一张图
  const result = queue.then(run, run);
  queue = result.then(() => undefined, () => undefined);
  return result;
}

/** 程序退出前必须调用，否则隐藏窗口会阻止 window-all-closed。 */
function destroyRendererThumbnailWorker() {
  destroyed = true;
  ready = null;
  try { if (win && !win.isDestroyed()) win.destroy(); } catch (_) {}
  win = null;
}

// 双保险：正常退出路径上也清理一次
try { app.on('will-quit', destroyRendererThumbnailWorker); } catch (_) {}

module.exports = { rendererThumbnail, destroyRendererThumbnailWorker };

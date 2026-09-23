#!/usr/bin/env electron
/**
 * Answers two questions the useLazyImage fix depends on:
 *
 *  1. Does an element inside a `display:none` subtree have a zero rect AND
 *     `offsetParent === null`? (the proposed skip-fast-path signal)
 *  2. Does an element inside a `content-visibility: auto` container that is
 *     scrolled off-screen report a zero / non-zero rect? If it reports zero,
 *     the lazy fast path is broken there too and the eagerness is even broader.
 *
 * Run: env -u ELECTRON_RUN_AS_NODE npx electron --no-sandbox --disable-gpu scripts/bench-rect-probe.cjs
 */
const { app, BrowserWindow } = require('electron')

const HTML = `data:text/html;charset=utf-8,${encodeURIComponent(`
<html><body style="margin:0">
  <div id="scroll" style="height:600px;overflow-y:auto">
    <div id="hidden" style="display:none">
      <div id="insideHidden" style="width:100px;height:100px">hidden</div>
    </div>
    <div id="cards">
      <!-- 40 cards, each content-visibility:auto, like the grid cards -->
      ${Array.from({ length: 40 }, (_, i) =>
        `<div class="card" data-i="${i}" style="content-visibility:auto;contain-intrinsic-size:auto 250px;height:250px;border:1px solid #333">
           <div class="inner" data-i="${i}" style="width:100px;height:100px">card ${i}</div>
         </div>`).join('')}
    </div>
  </div>
  <div id="cvbox" style="content-visibility:auto;contain-intrinsic-size:auto 300px;height:300px;margin-top:2000px">
    <div id="insideCv" style="width:100px;height:100px">cv</div>
  </div>
</body></html>
`)}`

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 800, height: 600 })
  await win.loadURL(HTML)
  await new Promise(r => setTimeout(r, 300))

  const out = await win.webContents.executeJavaScript(`(() => {
    const r = el => { const b = el.getBoundingClientRect(); return { w: +b.width.toFixed(1), h: +b.height.toFixed(1), top: +b.top.toFixed(1), bottom: +b.bottom.toFixed(1), offsetParentNull: el.offsetParent === null, clientRects: el.getClientRects().length } }
    const vis = i => { const c = document.querySelector('.card[data-i="' + i + '"]'); const n = c.querySelector('.inner'); return { card: r(c), inner: r(n) } }
    return {
      insideHidden: r(document.getElementById('insideHidden')),
      hiddenSelf: r(document.getElementById('hidden')),
      insideCv: r(document.getElementById('insideCv')),
      firstCard: vis(0),
      card5: vis(5),
      card20: vis(20),
      card39: vis(39),
      scrollHeight: document.getElementById('scroll').scrollHeight,
      innerHeight: window.innerHeight,
    }
  })()`, true)

  process.stdout.write('\n===RECTPROBE===\n' + JSON.stringify(out, null, 2) + '\n')
  app.exit(0)
})

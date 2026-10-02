// ═════════════════════════════════════════════════════════════════
// useDevToolbarReserve.js — 开发者模式下给页面末尾补出工具栏的预留空间
//
// DevToolbar 是 fixed bottom-0 的浮层（h-10 = 40px），不参与布局：滚到内容末尾时
// 最后一行会压在工具栏下面。把预留写成 <main> 的 padding 不管用 —— 页面容器是
// h-full（高度固定），内容溢出时滚动容器的 padding 不计入滚动区，滚到底时内容
// 依然贴着窗口底边（详见 index.css 中 main.dev-reserve-bottom 的说明）。
//
// 所以预留落在内容流末尾（页面容器末尾的伪元素），这里只负责回答"当前页面滚不滚"：
//   · 会滚动的页面（角色/武器/圣遗物/材料/详情页…）→ 补 64px
//   · 满高页面（终端/数据/网站/设置，根节点 h-full）本身不滚动，
//     无条件补预留只会凭空多出一条滚动条，测量后保持 0
//
// 判据是"减掉已加的预留之后，内容是否还超出可视区"，所以补上预留不会让判定翻转，
// 反复测量也不会来回抖动。
// ═════════════════════════════════════════════════════════════════
import { useEffect } from 'react'

/** 预留高度：工具栏 40px（h-10）+ 24px 呼吸空间 */
export const DEV_TOOLBAR_RESERVE_PX = 64
/** 亚像素取整误差内不算"内容超出可视区" */
const OVERFLOW_EPSILON = 1

/**
 * @param {HTMLElement|null} mainEl 滚动容器 <main>（用 state 承载，挂载后才会测量）
 * @param {boolean} active 是否开启开发者模式
 */
export default function useDevToolbarReserve(mainEl, active) {
  useEffect(() => {
    if (!mainEl) return
    const clear = () => mainEl.style.removeProperty('--devbar-reserve-h')
    if (!active) { clear(); return }

    let reserve = 0
    let observedPage = null

    const apply = (next) => {
      if (next === reserve) return
      reserve = next
      if (next > 0) mainEl.style.setProperty('--devbar-reserve-h', `${next}px`)
      else clear()
    }

    const pageHost = () => mainEl.querySelector('[data-page-host]')

    const measure = () => {
      // 页面根节点可能被换掉（加载态 → 内容），把观察对象重新挂到当前节点上
      const page = pageHost()?.firstElementChild || null
      if (page !== observedPage) {
        if (observedPage) resizeObserver.unobserve(observedPage)
        observedPage = page
        if (page) resizeObserver.observe(page)
      }
      // 减掉已加的预留，再问"内容自身是否超出可视区"
      const overflow = mainEl.scrollHeight - mainEl.clientHeight - reserve
      apply(overflow > OVERFLOW_EPSILON ? DEV_TOOLBAR_RESERVE_PX : 0)
    }

    const resizeObserver = new ResizeObserver(measure)
    resizeObserver.observe(mainEl)        // 窗口尺寸变化
    // 页面容器被替换（切板块/进详情页，key={location.key} 会重建）时重新测量
    const mutationObserver = new MutationObserver(measure)
    mutationObserver.observe(mainEl, { childList: true })
    measure()

    return () => {
      resizeObserver.disconnect()
      mutationObserver.disconnect()
      clear()
    }
  }, [mainEl, active])
}

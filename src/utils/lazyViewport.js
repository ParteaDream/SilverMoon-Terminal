/**
 * 懒加载「视口优先」判定 —— 纯函数，供 useLazyImage 与测试共用。
 *
 * 两条规则，都来自实测踩过的坑：
 *
 * 1. 不可渲染（rect 恒为 0×0）的元素必须跳过。`display:none` 子树内的元素
 *    rect 是 0×0，旧实现把它当成「在视口内」，于是折叠版本里 1600+ 张隐藏
 *    缩略图会在滚动时被反复挑中并抢在可视区图片前面取图。
 * 2. 可视区（viewport）优先于预加载带（band），同类内部按文档顺序（从上到下）。
 *    旧实现按 DOM 顺序 FIFO 排队，滚动到页面中段后视口上方的图片会先加载。
 */

export const DEFAULT_MARGIN = 800

/**
 * @typedef {{ top:number, bottom:number, w:number, h:number }} Box 文档坐标（相对滚动容器内容原点）
 * @typedef {{ top:number, height:number }} View 可视区（同上坐标系）
 */

/**
 * 元素相对当前可视区的位置
 * @returns {'unrendered'|'viewport'|'band'|'none'}
 */
export function locate(box, view, margin = DEFAULT_MARGIN) {
  if (!box || box.top == null || box.bottom == null) return 'unrendered'
  if (box.w === 0 && box.h === 0) return 'unrendered'
  if (box.bottom > view.top && box.top < view.top + view.height) return 'viewport'
  if (box.bottom > view.top - margin && box.top < view.top + view.height + margin) return 'band'
  return 'none'
}

/**
 * 从待加载记录中挑出本轮要发起的请求。
 *
 * @param {Iterable<{top:number,bottom:number,w:number,h:number,hidden?:boolean,state:string,urgent?:boolean}>} records
 *        state: 'idle'（未请求）/ 'requested'（已请求，可能还在排队）/ 'done'
 * @param {View} view
 * @param {number} [margin]
 * @param {(rec:any)=>({top:number,bottom:number,w:number,h:number}|null)} [verify]
 *        可选，返回该元素的**实时**位置（文档坐标）。给出时缓存坐标只用于粗筛，
 *        最终判定一律用它 —— `content-visibility: auto` 的容器记住真实高度后页面会
 *        变高，缓存坐标偏小，只靠它会把远处元素误判成「在预加载带里」而提前取图。
 * @returns {{urgent:any[], normal:any[], promote:any[]}}
 *        promote = 已请求但此刻在可视区内的记录（应把队列里的请求提前）
 */
export function selectPendingLoads(records, view, margin = DEFAULT_MARGIN, verify = null) {
  const urgent = []
  const normal = []
  const promote = []
  const bandTop = view.top - margin
  const bandBottom = view.top + view.height + margin
  for (const rec of records) {
    if (rec.hidden || rec.state === 'done') continue
    // 粗筛：缓存坐标的整数比较，无布局开销，先把上千个元素里的大多数排除掉
    if (rec.bottom <= bandTop || rec.top >= bandBottom) continue
    let box = rec
    if (verify) {
      const live = verify(rec)
      if (!live) continue
      box = live
      // 实时坐标回写缓存供下一帧粗筛；0×0（不可渲染）不回写，免得污染粗筛
      if (live.w > 0 || live.h > 0) {
        rec.top = live.top
        rec.bottom = live.bottom
        rec.w = live.w
        rec.h = live.h
      }
    }
    const where = locate(box, view, margin)
    if (where === 'none' || where === 'unrendered') continue
    if (rec.state === 'requested') {
      if (where === 'viewport' && !rec.urgent) promote.push(rec)
      continue
    }
    if (rec.state !== 'idle') continue
    if (where === 'viewport') urgent.push(rec)
    else normal.push(rec)
  }
  const byTop = (a, b) => a.top - b.top
  urgent.sort(byTop)
  normal.sort(byTop)
  return { urgent, normal, promote }
}

/**
 * 尺寸动画期间的降级开关。
 *
 * `filter: drop-shadow()` 之类的滤镜会让每个 <img> 拥有独立的滤镜渲染表面。
 * 当容器在动画中连续改变宽高时（侧栏展开/收缩、小程序最大化/还原），这些表面
 * 每帧都要重新求值并重新栅格化。材料/武器等画廊有数百张图片时，200ms 的侧栏
 * 过渡实测每帧 80ms+，掉帧非常明显。
 *
 * 动画开始时调用 beginHeavyAnimation(ms)，会在 <html> 上挂 data-animating="1"，
 * 由 index.css 在动画期间把图片滤镜降级为 none；动画结束后自动摘除并恢复。
 * 多个动画重叠时按引用计数处理，先结束的不会提前解除降级。
 */
const active = new Set()
let seq = 0

export function beginHeavyAnimation(ms) {
  const root = document.documentElement
  const token = ++seq
  active.add(token)
  root.setAttribute('data-animating', '1')

  const finish = () => {
    if (!active.delete(token)) return
    if (active.size === 0) root.removeAttribute('data-animating')
  }
  const timer = setTimeout(finish, ms)

  // 返回提前结束句柄（组件卸载 / 动画被中断时调用）
  return () => { clearTimeout(timer); finish() }
}

// 큰 화면의 확대·이동 — 스텝 그림(StepViewer)과 스냅샷(SnapshotViewer)이 함께 쓴다(P3 설계 §4.3).
// box = 그림을 담는 상자 요소 ref, natural = 그림의 원래 크기 { w, h } ref(모르면 null). setup 안에서 부른다.
// - fit(): 상자에 맞춘다. 상자가 0×0(숨김)이면 미뤘다가 크기가 생기면 맞춘다.
// - 사용자가 직접 확대·이동한 뒤에는 상자 크기가 바뀌어도 다시 맞추지 않는다. fit() 이 그 표시를 지운다.
// - actual(): 상자 가운데를 고정하고 배율 1(1:1).
import { reactive, onMounted, onBeforeUnmount } from 'vue'

const MIN_SCALE = 0.05
const MAX_SCALE = 8
const WHEEL_STEP = 1.15
const FIT_MARGIN = 0.98

export function usePanZoom(box, natural) {
  const view = reactive({ scale: 1, tx: 0, ty: 0 })
  let userMoved = false
  let pendingFit = false // 상자가 0×0 일 때 미뤄 둔 맞추기
  let lastW = 0
  let lastH = 0
  let observer = null
  let stopDrag = null

  function fit() {
    const el = box.value
    if (!el || !natural.value) return
    userMoved = false
    const w = el.clientWidth
    const h = el.clientHeight
    if (!(w > 0 && h > 0)) { pendingFit = true; return }
    pendingFit = false
    const s = Math.min(w / natural.value.w, h / natural.value.h) * FIT_MARGIN
    view.scale = s > 0 ? s : 1
    view.tx = (w - natural.value.w * view.scale) / 2
    view.ty = (h - natural.value.h * view.scale) / 2
  }
  function onResize() {
    const el = box.value
    if (!el) return
    const w = el.clientWidth
    const h = el.clientHeight
    const wasZero = !(lastW > 0 && lastH > 0)
    lastW = w
    lastH = h
    if (!(w > 0 && h > 0)) return
    if (pendingFit || wasZero || !userMoved) fit()
  }
  function zoomAt(factor, cx, cy) {
    userMoved = true
    const ns = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale * factor))
    view.tx = cx - ((cx - view.tx) * ns) / view.scale
    view.ty = cy - ((cy - view.ty) * ns) / view.scale
    view.scale = ns
  }
  const center = () => [(box.value?.clientWidth || 0) / 2, (box.value?.clientHeight || 0) / 2]
  const zoomButton = (factor) => zoomAt(factor, ...center())
  function actual() {
    if (!natural.value) return
    zoomAt(1 / view.scale, ...center())
  }
  function setView({ scale, tx, ty }) {
    userMoved = true
    view.scale = scale
    view.tx = tx
    view.ty = ty
  }
  function onWheel(e) {
    const rect = box.value.getBoundingClientRect()
    zoomAt(e.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP, e.clientX - rect.left, e.clientY - rect.top)
  }
  function onDown(e) {
    if (e.button !== 0) return
    if (stopDrag) stopDrag()
    const sx = e.clientX
    const sy = e.clientY
    const tx = view.tx
    const ty = view.ty
    const move = (m) => { userMoved = true; view.tx = tx + m.clientX - sx; view.ty = ty + m.clientY - sy }
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); stopDrag = null }
    stopDrag = up
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  onMounted(() => {
    const el = box.value
    if (!el) return
    lastW = el.clientWidth
    lastH = el.clientHeight
    if (typeof ResizeObserver !== 'undefined') { observer = new ResizeObserver(onResize); observer.observe(el) }
  })
  onBeforeUnmount(() => {
    if (observer) { observer.disconnect(); observer = null }
    if (stopDrag) stopDrag()
  })

  return { view, fit, actual, zoomAt, zoomButton, onWheel, onDown, setView }
}

// 숨겨졌던 요소(display: none — 접힌 스텝 목록)가 다시 보일 때 onShown 을 부른다.
// 숨은 동안에는 크기가 0 이라 표의 "고른 줄로 스크롤"·순서도의 "고른 카드를 가운데로" 가 듣지 않는다 — 보이게 된 뒤 다시 맞춘다.
import { onMounted, onBeforeUnmount } from 'vue'

export function useShown(elRef, onShown) {
  let observer = null
  let visible = null // 아직 모름
  onMounted(() => {
    if (typeof ResizeObserver === 'undefined' || !elRef.value) return
    observer = new ResizeObserver((entries) => {
      const r = entries[entries.length - 1]?.contentRect
      const now = !!r && r.width > 0 && r.height > 0
      if (visible === false && now) onShown()
      visible = now
    })
    observer.observe(elRef.value)
  })
  onBeforeUnmount(() => { if (observer) { observer.disconnect(); observer = null } })
}

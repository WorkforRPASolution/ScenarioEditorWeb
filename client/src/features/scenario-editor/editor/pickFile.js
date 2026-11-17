// 파일 고르기 창(브라우저 전용 얇은 감싸개 — E2E 에서 확인). 숨긴 파일 입력 칸 하나를 body 에 달아 누르고, 고른 첫 파일(취소면 null)을 준다.
// 메뉴 안에 입력 칸을 두지 않는다 — 메뉴는 누르자마자 닫혀 사라지므로 고른 파일을 받을 곳이 없어진다.
import { LOCAL_BASE_ACCEPT } from './localBase'

let pending = null

export function pickImageFile(accept = LOCAL_BASE_ACCEPT) {
  return new Promise((resolve) => {
    // 앞의 칸이 남아 있으면 치운다(창을 닫아도 취소를 알리지 않는 브라우저 — 그 약속은 끝나지 않은 채 버려진다)
    pending?.remove()
    const el = document.createElement('input')
    el.type = 'file'
    el.accept = accept
    el.hidden = true
    el.setAttribute('data-testid', 'se-file-pick')
    pending = el
    const done = (file) => {
      el.remove()
      if (pending === el) pending = null
      resolve(file)
    }
    el.addEventListener('change', () => done(el.files?.[0] ?? null), { once: true })
    el.addEventListener('cancel', () => done(null), { once: true })
    document.body.appendChild(el)
    el.click()
  })
}

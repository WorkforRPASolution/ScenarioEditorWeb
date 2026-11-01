// 사적 창·차단된 사이트 데이터에서도 화면이 깨지지 않게 저장소 예외를 삼킨다.
export const safeStorage = {
  get(key) {
    try { return localStorage.getItem(key) } catch { return null }
  },
  set(key, value) {
    try { localStorage.setItem(key, value) } catch { /* 기억만 못 할 뿐 */ }
  }
}

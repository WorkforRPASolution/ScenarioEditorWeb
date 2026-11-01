// STANDALONE STUB — 편입 시 WebManager 원본으로 교체
// 원본: WebManager@2f1eb0a client/src/shared/api/index.js (198줄). axios 인스턴스 부분(:1-18)만 남기고,
// 요청 인터셉터(Bearer 토큰, :20-32)·401 → /login 리다이렉트(:34-49)와 도메인 API 묶음 10개(:53-198)를 뺐다. default export 모양은 같다.
import axios from 'axios'

const API_URL = import.meta.env.VITE_API_URL
if (!API_URL) {
  console.warn(
    '[API] VITE_API_URL 환경변수가 설정되지 않았습니다.\n' +
    '      client/.env 파일에 VITE_API_URL=http://localhost:3100/api 를 추가하세요.'
  )
}

const api = axios.create({
  baseURL: API_URL || '/api',
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json'
  }
})

// 개발 전용: localStorage se-dev-user 가 있으면 사용자를 바꿔 부른다(서버 SE_DEV_USER_OVERRIDE=1 일 때만 효력). 편입 때 대역과 함께 사라진다.
api.interceptors.request.use((config) => {
  try {
    const dev = localStorage.getItem('se-dev-user')
    if (dev) config.headers['X-SE-User'] = dev
  } catch {
    // 저장소를 못 쓰면 설정 사용자 그대로
  }
  return config
})

export default api

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

export default api

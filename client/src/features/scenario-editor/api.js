import api from '@/shared/api'

const enc = encodeURIComponent
export const OPEN_TIMEOUT_MS = 120000

export const scenarioEditorApi = {
  me: () => api.get('/scenario-editor/me'),
  scopes: () => api.get('/scenario-editor/scopes'),
  refreshCache: () => api.post('/scenario-editor/cache/refresh'),
  dataCheck: () => api.get('/scenario-editor/data-check'),
  list: (process, model) => api.get('/scenario-editor/scenarios', { params: { process, model } }),
  versions: (p, m, n) => api.get(`/scenario-editor/scenarios/${enc(p)}/${enc(m)}/${enc(n)}/versions`),
  open: (p, m, n, crtime = 'current') => api.get(`/scenario-editor/scenarios/${enc(p)}/${enc(m)}/${enc(n)}/versions/${crtime}`, { timeout: OPEN_TIMEOUT_MS }),
  // 저장 전 검사(meta = editor/request buildMeta). 서버가 기준 판·다른 판을 열 수 있어(차가운 큰 시나리오) 열기와 같은 시간을 준다.
  check: (meta) => api.post('/scenario-editor/check', meta, { timeout: OPEN_TIMEOUT_MS })
}

export function readDevUser() {
  try {
    return localStorage.getItem('se-dev-user') || ''
  } catch {
    return ''
  }
}

// 서버 뼈대의 이미지 경로(API 기준)를 브라우저 URL 로. <img> 는 헤더를 못 보내 개발 사용자는 쿼리로.
export function imageUrl(apiPath) {
  const base = api.defaults?.baseURL || '/api'
  const dev = readDevUser()
  return `${base}${apiPath}${dev ? `?seUser=${enc(dev)}` : ''}`
}

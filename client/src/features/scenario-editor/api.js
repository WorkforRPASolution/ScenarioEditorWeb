import api from '@/shared/api'

const enc = encodeURIComponent
export const OPEN_TIMEOUT_MS = 120000
// 배포 한 번 = 기준 판 열기(차가운 큰 시나리오) + 조립 + setscenario(15초 + 1MB 마다 0.5초, 최대 120초, 설계 §6.3) + 마무리.
// 브라우저가 먼저 끊으면 결과를 모르게 되므로(확인으로 넘어간다) 넉넉히 기다린다.
export const DEPLOY_TIMEOUT_MS = 300000
// 공용 axios 의 기본 머리글은 JSON 이고, axios 는 그때 FormData 를 JSON 으로 바꾼다 — 멀티파트를 적으면 브라우저가 경계값과 함께 다시 쓴다.
const MULTIPART = { 'Content-Type': 'multipart/form-data' }

export const scenarioEditorApi = {
  me: () => api.get('/scenario-editor/me'),
  scopes: () => api.get('/scenario-editor/scopes'),
  refreshCache: () => api.post('/scenario-editor/cache/refresh'),
  dataCheck: () => api.get('/scenario-editor/data-check'),
  list: (process, model) => api.get('/scenario-editor/scenarios', { params: { process, model } }),
  versions: (p, m, n) => api.get(`/scenario-editor/scenarios/${enc(p)}/${enc(m)}/${enc(n)}/versions`),
  open: (p, m, n, crtime = 'current') => api.get(`/scenario-editor/scenarios/${enc(p)}/${enc(m)}/${enc(n)}/versions/${crtime}`, { timeout: OPEN_TIMEOUT_MS }),
  // 저장 전 검사(meta = editor/request buildMeta). 서버가 기준 판·다른 판을 열 수 있어(차가운 큰 시나리오) 열기와 같은 시간을 준다.
  check: (meta) => api.post('/scenario-editor/check', meta, { timeout: OPEN_TIMEOUT_MS }),
  // 초안·배포: 멀티파트(meta + 쓰는 그림 img:<tempId>, editor/request buildFormData)
  saveDraft: (formData) => api.post('/scenario-editor/drafts', formData, { headers: MULTIPART, timeout: OPEN_TIMEOUT_MS }),
  deploy: (formData) => api.post('/scenario-editor/deploy', formData, { headers: MULTIPART, timeout: DEPLOY_TIMEOUT_MS }),
  // 결과 모름 확인은 큰 판의 저장 값을 읽어 지문을 비교한다 — 열기와 같은 시간을 준다
  verifyDeploy: (requestId) => api.post(`/scenario-editor/deploy/${enc(requestId)}/verify`, null, { timeout: OPEN_TIMEOUT_MS }),
  finishDeploy: (requestId) => api.post(`/scenario-editor/deploy/${enc(requestId)}/finish`, null, { timeout: OPEN_TIMEOUT_MS }),
  nameRule: () => api.get('/scenario-editor/name-rule'),
  // 심의 저장(운영 속성 창, 관리 등급 1·2): 본문 { grade, comment } → { performance }(서버가 다시 읽은 값)
  saveReview: (p, m, n, body) => api.put(`/scenario-editor/scenarios/${enc(p)}/${enc(m)}/${enc(n)}/review`, body)
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

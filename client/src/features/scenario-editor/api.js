import api from '@/shared/api'

const enc = encodeURIComponent
export const OPEN_TIMEOUT_MS = 120000
// 배포 한 번 = 기준 판 열기(차가운 큰 시나리오) + 조립 + setscenario(15초 + 1MB 마다 0.5초, 최대 120초, 설계 §6.3) + 마무리.
// 브라우저가 먼저 끊으면 결과를 모르게 되므로(확인으로 넘어간다) 넉넉히 기다린다.
export const DEPLOY_TIMEOUT_MS = 300000
// 지우기(delscenario)는 판이 많으면 오래 걸린다 — 서버의 InterfaceServer 시간 제한(기본 15초)보다 먼저 끊지 않게 넉넉히 기다린다
export const ADMIN_TIMEOUT_MS = 60000
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
  // 결과 모름 확인은 큰 판의 저장 값을 읽어 지문을 비교한다 — 열기와 같은 시간을 준다.
  // 본문은 빈 JSON 객체: null 이면 공용 axios(JSON 머리글)가 "null" 을 보내고 서버 express.json(strict)이 400 으로 막는다.
  verifyDeploy: (requestId) => api.post(`/scenario-editor/deploy/${enc(requestId)}/verify`, {}, { timeout: OPEN_TIMEOUT_MS }),
  finishDeploy: (requestId) => api.post(`/scenario-editor/deploy/${enc(requestId)}/finish`, {}, { timeout: OPEN_TIMEOUT_MS }),
  nameRule: () => api.get('/scenario-editor/name-rule'),
  // 내 초안 목록(공정·모델) → [{ draftId, name, target, base, headCrtime, savedAt, revision }] — 불러오기 창의 내 초안, 새 시나리오 창이 같은 새 ID 의 초안을 찾는다
  listDrafts: (process, model) => api.get('/scenario-editor/drafts', { params: { process, model } }),
  // 초안 하나 → { draftId, savedAt, revision, base, headCrtime, propertyRev, target, scenario, imageUrls }. 큰 시나리오일 수 있어 열기와 같은 시간.
  getDraft: (id) => api.get(`/scenario-editor/drafts/${enc(id)}`, { timeout: OPEN_TIMEOUT_MS }),
  deleteDraft: (id) => api.delete(`/scenario-editor/drafts/${enc(id)}`),
  // 판 관리(불러오기 창): 켜기·끄기 → { isEnabled, propertyRev }, 지우기(본문 확인 이름) → { deleted: true }
  setEnabled: (p, m, n, enabled) => api.put(`/scenario-editor/scenarios/${enc(p)}/${enc(m)}/${enc(n)}/enabled`, { enabled }),
  // withDraft: 시나리오를 지운 뒤 내 초안도 지운다 → { deleted, draftDeleted }
  removeScenario: (p, m, n, confirmName, withDraft = false) => api.delete(`/scenario-editor/scenarios/${enc(p)}/${enc(m)}/${enc(n)}`, { data: withDraft ? { confirmName, withDraft: true } : { confirmName }, timeout: ADMIN_TIMEOUT_MS }),
  // 심의 저장(운영 속성 창, 관리 등급 1·2): 본문 { grade, comment } → { performance }(서버가 다시 읽은 값)
  saveReview: (p, m, n, body) => api.put(`/scenario-editor/scenarios/${enc(p)}/${enc(m)}/${enc(n)}/review`, body),
  // 성과 저장(성과 입력 창, 관리 등급 1·2): 본문 { fields, citizenDevelopers?, alsoModels } → { performance, applied }
  savePerformance: (p, m, n, body) => api.put(`/scenario-editor/scenarios/${enc(p)}/${enc(m)}/${enc(n)}/performance`, body),
  // 같은 공정·같은 이름의 모델 이름(공정 권한 안, 자기 모델 포함)
  sameName: (p, n) => api.get(`/scenario-editor/scenarios/${enc(p)}/same-name/${enc(n)}`),
  // 원개발자 찾기(2자 이상) → [{ singleid, name, process }], 등록 여부(아이디 목록) → 등록된 사람만 같은 모양
  searchUsers: (q) => api.get('/scenario-editor/users', { params: { q } }),
  registeredUsers: (ids) => api.get('/scenario-editor/users', { params: { ids: ids.join(',') } })
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

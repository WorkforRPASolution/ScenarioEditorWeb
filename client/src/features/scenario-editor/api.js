import api from '@/shared/api'

const enc = encodeURIComponent
export const OPEN_TIMEOUT_MS = 120000
// 배포 한 번 = 기준 판 열기(차가운 큰 시나리오) + 조립 + setscenario(15초 + 1MB 마다 0.5초, 최대 120초, 설계 §6.3) + 마무리.
// 브라우저가 먼저 끊으면 결과를 모르게 되므로(확인으로 넘어간다) 넉넉히 기다린다.
export const DEPLOY_TIMEOUT_MS = 300000
// 지우기(delscenario)는 판이 많으면 오래 걸린다 — 서버의 InterfaceServer 시간 제한(기본 15초)보다 먼저 끊지 않게 넉넉히 기다린다
export const ADMIN_TIMEOUT_MS = 60000
// 스냅샷(P3): 서버가 Cassandra 를 10초까지 기다린다 — 그보다 먼저 끊지 않게
export const SNAPSHOT_TIMEOUT_MS = 20000
// 이력(P3-D): 서버가 이력 서버(HttpWebServer)를 15초까지 기다린다 — 그보다 먼저 끊지 않게
export const HISTORY_TIMEOUT_MS = 30000
// Vision·OCR 시험(P4): 서버가 판정 서버를 12초까지 기다린다 — 그보다 먼저 끊지 않게
export const VISION_TEST_TIMEOUT_MS = 20000
// 공용 axios 의 기본 머리글은 JSON 이고, axios 는 그때 FormData 를 JSON 으로 바꾼다 — 멀티파트를 적으면 브라우저가 경계값과 함께 다시 쓴다.
// 시험 실행(P5): 실행 요청 한 건은 서버 안의 읽기(5초씩)와 보내기(12초)보다 길게 기다린다. 먼저 끊으면 그 설비는 "접수 여부 모름" 이 된다.
export const TEST_RUN_REQUEST_TIMEOUT_MS = 30000
export const TEST_RUN_TIMEOUT_MS = 10000
const MULTIPART = { 'Content-Type': 'multipart/form-data' }

export const scenarioEditorApi = {
  me: () => api.get('/scenario-editor/me'),
  scopes: () => api.get('/scenario-editor/scopes'),
  // 안내 문서 링크(P2-F) → { preprocessingSop: 주소 | null }
  links: () => api.get('/scenario-editor/links'),
  refreshCache: () => api.post('/scenario-editor/cache/refresh'),
  dataCheck: () => api.get('/scenario-editor/data-check'),
  list: (process, model) => api.get('/scenario-editor/scenarios', { params: { process, model } }),
  // 불러오기 창의 공정·모델 옆 수 → { draftsCounted, pairs: [{ process, model, scenarios, drafts }] }(공정 권한 안, 둘 다 0 인 쌍은 없다)
  counts: () => api.get('/scenario-editor/scenario-counts'),
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
  // 확인이 필요한 내 배포(SEW-021) — 결과 모름·마무리 실패·거절, 목록에서 빼기
  deployAttention: () => api.get('/scenario-editor/deploys/attention'),
  dismissDeploy: (requestId) => api.post(`/scenario-editor/deploy/${enc(requestId)}/dismiss`, {}),
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
  registeredUsers: (ids) => api.get('/scenario-editor/users', { params: { ids: ids.join(',') } }),
  // ── 스냅샷(P3) ──
  // 내 범위 설비 → { items: [{ eqpId, process, model, line }] }
  equipment: () => api.get('/scenario-editor/equipment', { timeout: SNAPSHOT_TIMEOUT_MS }),
  // 설비마다 가장 늦은 스냅샷 날짜(설비 고르기의 유무 표시) → { enabled, items: [[eqpId, 날짜]], checked, total, next } — after = 앞 응답의 next
  snapshotPresence: (after = '') => api.get('/scenario-editor/snapshots/presence', { params: after ? { after } : {}, timeout: SNAPSHOT_TIMEOUT_MS }),
  // 있는 날 → { eqpId, latest, today, oldest, days, truncated } — days 는 counts 일 때만 { 날짜: 개수 }
  snapshotDays: (eqpId, counts = false) => api.get('/scenario-editor/snapshots/days', { params: counts ? { eqpId, counts: 1 } : { eqpId }, timeout: SNAPSHOT_TIMEOUT_MS }),
  // 하루 목록 → { eqpId, date, timeDiff, items, skipped, truncated }
  // to 를 주면 date ~ to(끝 날 포함) — 줄마다 표시 날짜(date)가 온다. 응답에는 받은 끝 날 to 가 든다
  snapshots: (eqpId, date, to = null) => api.get('/scenario-editor/snapshots', { params: to && to !== date ? { eqpId, date, to } : { eqpId, date }, timeout: SNAPSHOT_TIMEOUT_MS }),
  // 메모(P3-C) — expect = 화면이 본 메모 글(새 메모면 null). 그 사이 바뀌었으면 409 MEMO_CONFLICT(details.current = 지금 값)
  saveMemo: (eqpId, fileName, memo, expect = null) => api.put(`/scenario-editor/snapshots/${enc(eqpId)}/${enc(fileName)}/memo`, { memo, expect }, { timeout: SNAPSHOT_TIMEOUT_MS }),
  removeMemo: (eqpId, fileName, expect) => api.delete(`/scenario-editor/snapshots/${enc(eqpId)}/${enc(fileName)}/memo`, { data: { expect }, timeout: SNAPSHOT_TIMEOUT_MS }),
  // 메모 목록 → { items: [{ eqpId, process, model, fileName, date, time, daysLeft, memo }], truncated }
  memos: () => api.get('/scenario-editor/memos', { timeout: SNAPSHOT_TIMEOUT_MS }),
  // 자동 복구 이력(P3-D) → { eqpId, txn, steps: [{ no, text, images: [{ kind: 'ref'|'screen', src }] }] } — txn 은 태그 스냅샷의 것(99999 이상)
  history: (eqpId, txn) => api.get(`/scenario-editor/history/${enc(eqpId)}/${enc(txn)}`, { timeout: HISTORY_TIMEOUT_MS }),
  // Vision·OCR 시험(P4) — 멀티파트(meta + PNG). 브라우저가 준비한 그림을 올린다: source = 시험할 화면에서 자른 영역 조각, train = 찾을 그림.
  // → { results: [{ score, x, y }], ms, bytes }(x·y 는 조각 기준·소수 — 화면이 보정한다) / { accepted, found, confidence, ms, bytes }
  visionTest: (formData, signal) => api.post('/scenario-editor/vision-test', formData, { headers: MULTIPART, timeout: VISION_TEST_TIMEOUT_MS, signal }),
  ocrTest: (formData, signal) => api.post('/scenario-editor/ocr-test', formData, { headers: MULTIPART, timeout: VISION_TEST_TIMEOUT_MS, signal }),
  // ── 시험 실행(P5) — 설비에 시나리오 실행을 요청한다. 시나리오 목록·공정 모델 항목은 list·scopes 를 그대로 쓴다 ──
  // 고른 공정·모델의 설비 → { equipment: [{ eqpId, line, ipAddr, ipAddrL, onoff: 'on'|'off'|'unreadable' }], limits: { maxEquipment, recentMin } }
  testRunEquipment: (process, model) => api.get('/scenario-editor/test-run/equipment', { params: { process, model }, timeout: TEST_RUN_TIMEOUT_MS }),
  // 시나리오 하나의 실행 정보 → { current: { crtime, stepCount } | null, isEnabled, startDelay, retryCnt, retryInterval, priority, next, emailSkip, blocks: [code], recent: [{ eqpId, by, at }] }
  testRunScenario: (process, model, name) => api.get('/scenario-editor/test-run/scenario', { params: { process, model, name }, timeout: TEST_RUN_TIMEOUT_MS }),
  // 설비 한 대에 실행 요청 — body { runId, process, model, name, eqpId, startStep, reason: { kind, text? }, again? } → { outcome, detail? }. 저절로 다시 보내지 않는다
  testRunRequest: (body) => api.post('/scenario-editor/test-run/requests', body, { timeout: TEST_RUN_REQUEST_TIMEOUT_MS }),
  // 내 실행의 요청 결과와 실행 상태 — body { runId, pinned?: { 설비: txnSeq } } → { now, items: [{ eqpId, outcome, detail, sentAt, found, status, retry, txnSeq, createDate }] }
  testRunStatus: (body) => api.post('/scenario-editor/test-run/status', body, { timeout: TEST_RUN_TIMEOUT_MS }),
  // 고른 설비들의 결과 메일 수신 묶음 — body { process, model, name, eqpIds } → { groups: [{ category, source: 'rule'|'equipment', eqpIds, accounts, problem }] }
  testRunRecipients: (body) => api.post('/scenario-editor/test-run/recipients', body, { timeout: TEST_RUN_TIMEOUT_MS }),
  // 그림 한 장(Blob). 실패 본문도 Blob 으로 온다 — blobError 로 code 를 읽는다
  snapshotImage: (eqpId, fileName, signal) => api.get(`/scenario-editor/snapshots/${enc(eqpId)}/${enc(fileName)}/image`, { responseType: 'blob', signal, timeout: SNAPSHOT_TIMEOUT_MS })
}

// responseType 'blob' 요청의 오류 본문(JSON)을 읽어 err.response.data 에 되돌려 놓는다 — errorCode·errorMessage 가 code 를 읽을 수 있게.
// 읽지 못하면(JSON 아님) 그대로 둔다.
export async function blobError(err) {
  const data = err?.response?.data
  if (typeof Blob === 'undefined' || !(data instanceof Blob)) return err
  try {
    const parsed = JSON.parse(await data.text())
    if (parsed && typeof parsed === 'object') err.response.data = parsed
  } catch { /* JSON 이 아닌 본문 */ }
  return err
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

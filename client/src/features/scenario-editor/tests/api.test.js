import { describe, it, expect, vi, beforeEach } from 'vitest'

const get = vi.fn().mockResolvedValue({ data: {} })
const post = vi.fn().mockResolvedValue({ data: {} })
vi.mock('@/shared/api', () => ({ default: { get: (...a) => get(...a), post: (...a) => post(...a), defaults: { baseURL: 'http://x:3100/api' } } }))
import { scenarioEditorApi as api, OPEN_TIMEOUT_MS, DEPLOY_TIMEOUT_MS, imageUrl } from '../api'

describe('scenarioEditorApi', () => {
  beforeEach(() => { get.mockClear(); post.mockClear(); localStorage.clear() })
  it('열기는 120초, 경로 값은 인코딩', async () => {
    await api.open('P 1', 'M/2', 'N', 'current')
    expect(get).toHaveBeenCalledWith('/scenario-editor/scenarios/P%201/M%2F2/N/versions/current', { timeout: OPEN_TIMEOUT_MS })
    expect(OPEN_TIMEOUT_MS).toBe(120000)
  })
  it('목록은 쿼리', async () => {
    await api.list('P', 'M')
    expect(get).toHaveBeenCalledWith('/scenario-editor/scenarios', { params: { process: 'P', model: 'M' } })
  })
  it('검사는 meta 를 JSON 본문으로 POST — 기준 판을 열 수 있어 열기와 같은 120초', async () => {
    const meta = { target: { process: 'P', model: 'M', name: 'N' }, propertyRev: 'r', scenario: { steps: [] } }
    await api.check(meta)
    expect(post).toHaveBeenCalledWith('/scenario-editor/check', meta, { timeout: OPEN_TIMEOUT_MS })
  })
  it('초안·배포는 멀티파트 — 공용 axios 의 JSON 머리글을 덮어써야 FormData 가 JSON 으로 바뀌지 않는다. 배포는 setscenario 최대 120초보다 길게 기다린다', async () => {
    const fd = new FormData()
    await api.saveDraft(fd)
    expect(post).toHaveBeenLastCalledWith('/scenario-editor/drafts', fd, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: OPEN_TIMEOUT_MS })
    await api.deploy(fd)
    expect(post).toHaveBeenLastCalledWith('/scenario-editor/deploy', fd, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: DEPLOY_TIMEOUT_MS })
    expect(DEPLOY_TIMEOUT_MS).toBeGreaterThan(120000 + OPEN_TIMEOUT_MS)
  })
  it('결과 모름 확인·마무리 다시 쓰기는 requestId 경로, 이름 규칙은 GET', async () => {
    await api.verifyDeploy('a b')
    expect(post).toHaveBeenLastCalledWith('/scenario-editor/deploy/a%20b/verify', null, { timeout: OPEN_TIMEOUT_MS })
    await api.finishDeploy('r1')
    expect(post).toHaveBeenLastCalledWith('/scenario-editor/deploy/r1/finish', null, { timeout: OPEN_TIMEOUT_MS })
    await api.nameRule()
    expect(get).toHaveBeenLastCalledWith('/scenario-editor/name-rule')
  })
  it('이미지 URL 은 API 주소를 붙이고, 개발 사용자가 있으면 ?seUser=', () => {
    expect(imageUrl('/scenario-editor/a/images/s0-bi')).toBe('http://x:3100/api/scenario-editor/a/images/s0-bi')
    localStorage.setItem('se-dev-user', 'sew_cvd')
    expect(imageUrl('/scenario-editor/a/images/s0-bi')).toBe('http://x:3100/api/scenario-editor/a/images/s0-bi?seUser=sew_cvd')
  })
})

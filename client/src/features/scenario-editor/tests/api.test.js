import { describe, it, expect, vi, beforeEach } from 'vitest'

const get = vi.fn().mockResolvedValue({ data: {} })
const post = vi.fn().mockResolvedValue({ data: {} })
vi.mock('@/shared/api', () => ({ default: { get: (...a) => get(...a), post: (...a) => post(...a), defaults: { baseURL: 'http://x:3100/api' } } }))
import { scenarioEditorApi as api, OPEN_TIMEOUT_MS, imageUrl } from '../api'

describe('scenarioEditorApi', () => {
  beforeEach(() => { get.mockClear(); localStorage.clear() })
  it('열기는 120초, 경로 값은 인코딩', async () => {
    await api.open('P 1', 'M/2', 'N', 'current')
    expect(get).toHaveBeenCalledWith('/scenario-editor/scenarios/P%201/M%2F2/N/versions/current', { timeout: OPEN_TIMEOUT_MS })
    expect(OPEN_TIMEOUT_MS).toBe(120000)
  })
  it('목록은 쿼리', async () => {
    await api.list('P', 'M')
    expect(get).toHaveBeenCalledWith('/scenario-editor/scenarios', { params: { process: 'P', model: 'M' } })
  })
  it('이미지 URL 은 API 주소를 붙이고, 개발 사용자가 있으면 ?seUser=', () => {
    expect(imageUrl('/scenario-editor/a/images/s0-bi')).toBe('http://x:3100/api/scenario-editor/a/images/s0-bi')
    localStorage.setItem('se-dev-user', 'sew_cvd')
    expect(imageUrl('/scenario-editor/a/images/s0-bi')).toBe('http://x:3100/api/scenario-editor/a/images/s0-bi?seUser=sew_cvd')
  })
})

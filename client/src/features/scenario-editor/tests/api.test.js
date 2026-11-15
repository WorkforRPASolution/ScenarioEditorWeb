import { describe, it, expect, vi, beforeEach } from 'vitest'

const get = vi.fn().mockResolvedValue({ data: {} })
const post = vi.fn().mockResolvedValue({ data: {} })
const put = vi.fn().mockResolvedValue({ data: {} })
const del = vi.fn().mockResolvedValue({ data: {} })
vi.mock('@/shared/api', () => ({ default: { get: (...a) => get(...a), post: (...a) => post(...a), put: (...a) => put(...a), delete: (...a) => del(...a), defaults: { baseURL: 'http://x:3100/api' } } }))
import { scenarioEditorApi as api, OPEN_TIMEOUT_MS, DEPLOY_TIMEOUT_MS, ADMIN_TIMEOUT_MS, SNAPSHOT_TIMEOUT_MS, imageUrl, blobError, HISTORY_TIMEOUT_MS } from '../api'

describe('scenarioEditorApi', () => {
  beforeEach(() => { get.mockClear(); post.mockClear(); put.mockClear(); del.mockClear(); localStorage.clear() })
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
  // 본문은 빈 JSON 객체 — null 을 주면 공용 axios(JSON 머리글)가 "null" 을 보내고 서버 express.json(strict)이 400 으로 막는다(P2-D E2E ⑤ 에서 찾음)
  it('결과 모름 확인·마무리 다시 쓰기는 requestId 경로에 빈 JSON 객체 본문, 이름 규칙은 GET', async () => {
    await api.verifyDeploy('a b')
    expect(post).toHaveBeenLastCalledWith('/scenario-editor/deploy/a%20b/verify', {}, { timeout: OPEN_TIMEOUT_MS })
    await api.finishDeploy('r1')
    expect(post).toHaveBeenLastCalledWith('/scenario-editor/deploy/r1/finish', {}, { timeout: OPEN_TIMEOUT_MS })
    await api.nameRule()
    expect(get).toHaveBeenLastCalledWith('/scenario-editor/name-rule')
  })
  it('공정·모델 옆 수(시나리오 수·내 초안 수)는 쿼리 없이 GET', async () => {
    await api.counts()
    expect(get).toHaveBeenLastCalledWith('/scenario-editor/scenario-counts')
  })
  it('내 초안 목록은 공정·모델 쿼리', async () => {
    await api.listDrafts('P', 'M')
    expect(get).toHaveBeenLastCalledWith('/scenario-editor/drafts', { params: { process: 'P', model: 'M' } })
  })
  it('켜기·끄기는 PUT …/enabled { enabled }, 지우기는 DELETE 본문 { confirmName } — 판이 많으면 오래 걸려 서버 시간 제한(15초)보다 길게 기다린다', async () => {
    await api.setEnabled('P 1', 'M', 'N/2', false)
    expect(put).toHaveBeenLastCalledWith('/scenario-editor/scenarios/P%201/M/N%2F2/enabled', { enabled: false })
    await api.removeScenario('P', 'M', 'N', 'N')
    expect(del).toHaveBeenLastCalledWith('/scenario-editor/scenarios/P/M/N', { data: { confirmName: 'N' }, timeout: ADMIN_TIMEOUT_MS })
    await api.removeScenario('P', 'M', 'N', 'N', true) // 내 초안도 함께 지우기
    expect(del).toHaveBeenLastCalledWith('/scenario-editor/scenarios/P/M/N', { data: { confirmName: 'N', withDraft: true }, timeout: ADMIN_TIMEOUT_MS })
    expect(ADMIN_TIMEOUT_MS).toBeGreaterThan(15000)
  })
  it('초안 하나 읽기(큰 시나리오일 수 있어 열기와 같은 시간)·지우기', async () => {
    await api.getDraft('d 1')
    expect(get).toHaveBeenLastCalledWith('/scenario-editor/drafts/d%201', { timeout: OPEN_TIMEOUT_MS })
    await api.deleteDraft('d1')
    expect(del).toHaveBeenLastCalledWith('/scenario-editor/drafts/d1')
  })
  it('심의 저장은 PUT …/review 본문 { grade, comment }, 경로 값은 인코딩', async () => {
    await api.saveReview('P 1', 'M', 'N/2', { grade: 1, comment: '의견입니다' })
    expect(put).toHaveBeenCalledWith('/scenario-editor/scenarios/P%201/M/N%2F2/review', { grade: 1, comment: '의견입니다' })
  })
  it('성과 저장은 PUT …/performance 본문 그대로, 같은 이름 모델·원개발자 찾기·등록 여부는 GET', async () => {
    const body = { fields: { Grade: 1 }, citizenDevelopers: [{ KnoxId: 'a', Contribution: 10 }], alsoModels: ['M2'] }
    await api.savePerformance('P 1', 'M', 'N/2', body)
    expect(put).toHaveBeenCalledWith('/scenario-editor/scenarios/P%201/M/N%2F2/performance', body)
    await api.sameName('P 1', 'N/2')
    expect(get).toHaveBeenLastCalledWith('/scenario-editor/scenarios/P%201/same-name/N%2F2')
    await api.searchUsers('박민')
    expect(get).toHaveBeenLastCalledWith('/scenario-editor/users', { params: { q: '박민' } })
    await api.registeredUsers(['a', 'b'])
    expect(get).toHaveBeenLastCalledWith('/scenario-editor/users', { params: { ids: 'a,b' } })
  })
  it('이미지 URL 은 API 주소를 붙이고, 개발 사용자가 있으면 ?seUser=', () => {
    expect(imageUrl('/scenario-editor/a/images/s0-bi')).toBe('http://x:3100/api/scenario-editor/a/images/s0-bi')
    localStorage.setItem('se-dev-user', 'sew_cvd')
    expect(imageUrl('/scenario-editor/a/images/s0-bi')).toBe('http://x:3100/api/scenario-editor/a/images/s0-bi?seUser=sew_cvd')
  })

  describe('스냅샷 메모 (P3-C)', () => {
    it('쓰기·고치기는 PUT …/memo 본문 { memo, expect }, 지우기는 DELETE 본문 { expect }, 메모 목록은 GET /memos — 경로 값은 인코딩', async () => {
      const name = '1762820000123_[412][388].png'
      const path = '/scenario-editor/snapshots/E%201/1762820000123_%5B412%5D%5B388%5D.png/memo'
      await api.saveMemo('E 1', name, '글')
      expect(put).toHaveBeenLastCalledWith(path, { memo: '글', expect: null }, { timeout: SNAPSHOT_TIMEOUT_MS })
      await api.saveMemo('E 1', name, '새 글', '옛 글')
      expect(put).toHaveBeenLastCalledWith(path, { memo: '새 글', expect: '옛 글' }, { timeout: SNAPSHOT_TIMEOUT_MS })
      await api.removeMemo('E 1', name, '옛 글')
      expect(del).toHaveBeenLastCalledWith(path, { data: { expect: '옛 글' }, timeout: SNAPSHOT_TIMEOUT_MS })
      await api.memos()
      expect(get).toHaveBeenLastCalledWith('/scenario-editor/memos', { timeout: SNAPSHOT_TIMEOUT_MS })
    })
  })

  describe('이력 (P3-D)', () => {
    it('GET /history/{설비}/{txn} — 경로 값은 인코딩, 서버의 이력 서버 제한(15초)보다 길게 30초를 기다린다', async () => {
      await api.history('E 1', '1763254800000')
      expect(get).toHaveBeenLastCalledWith('/scenario-editor/history/E%201/1763254800000', { timeout: HISTORY_TIMEOUT_MS })
      expect(HISTORY_TIMEOUT_MS).toBe(30000)
    })
  })

  describe('스냅샷 (P3-B)', () => {
    it('설비·있는 날·하루 목록 — 서버의 Cassandra 제한(10초)보다 길게 20초를 기다린다', async () => {
      await api.equipment()
      expect(get).toHaveBeenLastCalledWith('/scenario-editor/equipment', { timeout: SNAPSHOT_TIMEOUT_MS })
      await api.snapshotPresence()
      expect(get).toHaveBeenLastCalledWith('/scenario-editor/snapshots/presence', { params: {}, timeout: SNAPSHOT_TIMEOUT_MS })
      await api.snapshotPresence('E 1')
      expect(get).toHaveBeenLastCalledWith('/scenario-editor/snapshots/presence', { params: { after: 'E 1' }, timeout: SNAPSHOT_TIMEOUT_MS })
      await api.snapshotDays('E1')
      expect(get).toHaveBeenLastCalledWith('/scenario-editor/snapshots/days', { params: { eqpId: 'E1' }, timeout: SNAPSHOT_TIMEOUT_MS })
      await api.snapshotDays('E1', true)
      expect(get).toHaveBeenLastCalledWith('/scenario-editor/snapshots/days', { params: { eqpId: 'E1', counts: 1 }, timeout: SNAPSHOT_TIMEOUT_MS })
      await api.snapshots('E1', '2026-11-11')
      expect(get).toHaveBeenLastCalledWith('/scenario-editor/snapshots', { params: { eqpId: 'E1', date: '2026-11-11' }, timeout: SNAPSHOT_TIMEOUT_MS })
      expect(SNAPSHOT_TIMEOUT_MS).toBe(20000)
    })
    it('그림은 Blob 으로 — 설비·파일 이름은 인코딩, 끊을 수 있게 signal', async () => {
      const signal = new AbortController().signal
      await api.snapshotImage('E 1', '1_[2][3].png', signal)
      expect(get).toHaveBeenLastCalledWith('/scenario-editor/snapshots/E%201/1_%5B2%5D%5B3%5D.png/image', { responseType: 'blob', signal, timeout: SNAPSHOT_TIMEOUT_MS })
    })
    it('blobError: Blob 으로 온 오류 본문을 JSON 으로 읽어 code 를 꺼낼 수 있게 한다', async () => {
      const err = { response: { status: 404, data: new Blob(['{"success":false,"code":"SNAPSHOT_NOT_FOUND","message":"x"}'], { type: 'application/json' }) } }
      const out = await blobError(err)
      expect(out).toBe(err)
      expect(out.response.data).toMatchObject({ code: 'SNAPSHOT_NOT_FOUND' })
    })
    it('blobError: JSON 이 아닌 Blob·Blob 이 아닌 본문·응답 없는 오류는 그대로', async () => {
      const html = new Blob(['<html>'])
      const a = { response: { status: 502, data: html } }
      expect((await blobError(a)).response.data).toBe(html)
      const b = { response: { status: 403, data: { code: 'EQP_FORBIDDEN' } } }
      expect((await blobError(b)).response.data).toEqual({ code: 'EQP_FORBIDDEN' })
      const c = { request: {} }
      expect(await blobError(c)).toBe(c)
      expect(await blobError(undefined)).toBeUndefined()
    })
  })
})

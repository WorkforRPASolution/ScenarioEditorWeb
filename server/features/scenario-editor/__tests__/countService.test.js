import { describe, it, expect, vi } from 'vitest'
import { createCountService } from '../service/countService'

// 불러오기 창의 공정·모델 옆 수(2026-11-11 사용자 요청): 등록된 시나리오 수, 쓰기 사용자는 내 초안 수도.
const pairs = [
  { process: 'SEWCVD', models: [{ model: 'A', eqpCount: 2 }, { model: 'B', eqpCount: 1 }] },
  { process: 'SEWETCH', models: [{ model: 'A', eqpCount: 1 }] }
]
const scopes = { scopeFor: async () => ({ pairs }) }
const writer = { singleid: 'me', canWrite: true }

describe('countService', () => {
  it('공정 권한 안의 공정·모델만, 시나리오 수와 내 초안 수를 한 줄로 — 둘 다 0 인 쌍은 싣지 않는다', async () => {
    const repo = { countScenarios: vi.fn(async () => [
      { process: 'SEWETCH', model: 'A', count: 4 }, { process: 'SEWCVD', model: 'A', count: 10 },
      { process: 'SEWCVD', model: 'GONE', count: 7 } // 설비가 없는 모델 — 선택 목록에 없다
    ]) }
    const web = { countDrafts: vi.fn(async () => [
      { process: 'SEWCVD', model: 'A', count: 1 }, { process: 'SEWCVD', model: 'B', count: 2 }, // B 는 배포된 시나리오 없이 초안만
      { process: 'SEWLITHO', model: 'A', count: 5 } // 권한이 사라진 공정의 초안
    ]) }
    const out = await createCountService({ repo, web, scopes }).counts(writer)
    expect(out).toEqual({
      draftsCounted: true,
      pairs: [
        { process: 'SEWCVD', model: 'A', scenarios: 10, drafts: 1 },
        { process: 'SEWCVD', model: 'B', scenarios: 0, drafts: 2 },
        { process: 'SEWETCH', model: 'A', scenarios: 4, drafts: 0 }
      ]
    })
    expect(repo.countScenarios).toHaveBeenCalledWith(['SEWCVD', 'SEWETCH'])
    expect(web.countDrafts).toHaveBeenCalledWith('me')
  })
  it('읽기만 하는 사용자는 초안을 세지 않는다(초안이 없다)', async () => {
    const repo = { countScenarios: async () => [{ process: 'SEWCVD', model: 'A', count: 3 }] }
    const web = { countDrafts: vi.fn() }
    const out = await createCountService({ repo, web, scopes }).counts({ singleid: 'r', canWrite: false })
    expect(out).toEqual({ draftsCounted: false, pairs: [{ process: 'SEWCVD', model: 'A', scenarios: 3, drafts: 0 }] })
    expect(web.countDrafts).not.toHaveBeenCalled()
  })
  it('웹 전용 DB 를 못 읽어도 시나리오 수는 낸다 — 초안은 세지 못했다고 알린다', async () => {
    const repo = { countScenarios: async () => [{ process: 'SEWCVD', model: 'A', count: 3 }] }
    const web = { countDrafts: async () => { throw Object.assign(new Error('down'), { code: 'UPSTREAM_DOWN' }) } }
    const log = { warn: vi.fn() }
    const out = await createCountService({ repo, web, scopes, log }).counts(writer)
    expect(out).toEqual({ draftsCounted: false, pairs: [{ process: 'SEWCVD', model: 'A', scenarios: 3, drafts: 0 }] })
    expect(log.warn.mock.calls[0][0]).toContain('UPSTREAM_DOWN')
  })
  it('허용된 공정·모델이 없으면 아무것도 묻지 않는다', async () => {
    const repo = { countScenarios: vi.fn() }
    const web = { countDrafts: vi.fn() }
    const out = await createCountService({ repo, web, scopes: { scopeFor: async () => ({ pairs: [] }) } }).counts(writer)
    expect(out).toEqual({ draftsCounted: false, pairs: [] })
    expect(repo.countScenarios).not.toHaveBeenCalled()
    expect(web.countDrafts).not.toHaveBeenCalled()
  })
})

import { describe, it, expect } from 'vitest'
import { createListService } from '../service/listService'
import { createVersionService } from '../service/versionService'

const user = { singleid: 'u' }
const scopes = { assertAllowed: async () => {} }
const prop = (over = {}) => ({ ID: 'x', Owners: ['a@2026-10-01 10:00:00', 'b@2026-11-01 09:00:00'], IsEnabled: true, Type: 1, Priority: 10, ...over })

describe('listService', () => {
  const repo = {
    findScenarioDocs: async () => [
      { scname: 'B', property: prop({ IsEnabled: false }), performance: { ScenarioDescription: '설명 B', Trigger: 1, Grade: 2 } },
      { scname: 'A', property: prop(), performance: { ScenarioDescription: '설명 A' } },
      { scname: 'DUP', property: prop() }, { scname: 'DUP', property: prop() },
      { scname: 'NOPROP' },
      { scname: 'BAD', property: { Priority: null } },
      { scname: 'NOREDIS', property: prop() }
    ]
  }
  const hash = { hkeys: async () => ['A.1730000000100', 'A.1730000000200', 'B.1730000000050', 'DUP.1', 'BAD.1', 'A_2.1730000000999'] }
  it('property 있는 문서만, 이름순, 상태 표시', async () => {
    const rows = await createListService({ repo, hash, scopes }).list(user, 'P', 'M')
    expect(rows.map((r) => r.name)).toEqual(['A', 'B', 'BAD', 'DUP', 'NOREDIS'])
    const by = Object.fromEntries(rows.map((r) => [r.name, r]))
    expect(by.A).toMatchObject({ id: 'P-M-A', isEnabled: true, typeName: 'ALARM_RECOVERY', description: '설명 A', currentCrtime: 1730000000200, status: [],
      lastOwner: { singleid: 'b', at: '2026-11-01 09:00:00', note: null } })
    expect(by.B).toMatchObject({ isEnabled: false, triggerName: 'Log', gradeName: 'A' })
    expect(by.DUP.status).toEqual(['DUPLICATE_PROPERTY'])
    expect(by.NOREDIS.status).toEqual(['NO_CURRENT_VERSION'])
    expect(by.BAD.status).toEqual(['PARSE_FAILED'])
    expect(by.BAD.isEnabled).toBe(null)
  })
  // 데스크톱 불러오기 목록의 EMAIL_SKIP·DELAY·RETRY·TRIGGERINFO(2026-11-10 사용자 결정 — 웹 목록에 없었다). 글은 화면이 만든다.
  it('메일 생략(성공·실패·중지 순)·시작 지연·재시도 횟수와 간격·트리거 정보를 행에 싣는다, 운영 속성을 못 풀면 null', async () => {
    const repo2 = {
      findScenarioDocs: async () => [
        { scname: 'FULL', property: prop({ StartDelay: 30, RetryCnt: 3, RetryInterval: 60, DoNotSendEmailWhenStop: true, DoNotSendEmailWhenSuccess: true }), performance: { Trigger: 1, TriggerInfo: 'ALARM E1234' } },
        { scname: 'PLAIN', property: prop() },
        { scname: 'BAD', property: { Priority: null } }
      ]
    }
    const rows = await createListService({ repo: repo2, hash: { hkeys: async () => ['FULL.1', 'PLAIN.1', 'BAD.1'] }, scopes }).list(user, 'P', 'M')
    const by = Object.fromEntries(rows.map((r) => [r.name, r]))
    expect(by.FULL).toMatchObject({ emailSkip: ['success', 'stop'], startDelay: 30, retryCnt: 3, retryInterval: 60, triggerInfo: 'ALARM E1234' })
    expect(by.PLAIN).toMatchObject({ emailSkip: [], startDelay: 0, retryCnt: 0, triggerInfo: null })
    expect(by.BAD).toMatchObject({ emailSkip: null, startDelay: null, retryCnt: null, retryInterval: null, triggerInfo: null })
  })
})

// 불러오기 목록의 스텝 수·용량(2026-11-10 사용자 요청). 현재 판 파일에서만 읽는다.
describe('listService — 스텝 수·용량', () => {
  const repo = { findScenarioDocs: async () => [{ scname: 'A', property: prop() }, { scname: 'B', property: prop() }, { scname: 'NOREDIS', property: prop() }, { scname: 'NOPROP' }] }
  const hash = { hkeys: async () => ['A.100', 'A.200', 'B.50', 'NOPROP.1', 'GONE.1'] }
  it('목록에 나오는 시나리오의 현재 판만 묻고, 스텝 수와 용량을 행에 싣는다 — 현재 판이 없거나 파일을 못 찾으면 null', async () => {
    const asked = []
    const gridfs = { findVersionStats: async (...a) => { asked.push(a); return new Map([['A', { stepCount: 18, sizeBytes: 123456 }]]) } }
    const rows = await createListService({ repo, hash, scopes, gridfs }).list(user, 'P', 'M')
    expect(asked).toEqual([['P', 'M', [{ name: 'A', crtime: 200 }, { name: 'B', crtime: 50 }]]])
    const by = Object.fromEntries(rows.map((r) => [r.name, r]))
    expect(by.A).toMatchObject({ stepCount: 18, sizeBytes: 123456 })
    expect(by.B).toMatchObject({ stepCount: null, sizeBytes: null })
    expect(by.NOREDIS).toMatchObject({ stepCount: null, sizeBytes: null })
  })
  it('스텝 수·용량을 읽지 못해도 목록은 나온다(값만 null) — 경고를 남긴다', async () => {
    const warned = []
    const gridfs = { findVersionStats: async () => { throw new Error('boom') } }
    const rows = await createListService({ repo, hash, scopes, gridfs, log: { warn: (m) => warned.push(m) } }).list(user, 'P', 'M')
    expect(rows.map((r) => [r.name, r.stepCount, r.sizeBytes])).toEqual([['A', null, null], ['B', null, null], ['NOREDIS', null, null]])
    expect(warned).toHaveLength(1)
    expect(warned[0]).toContain('P-M')
  })
})

describe('listService — 문서가 아닌 운영 속성', () => {
  it('property 가 null·문자열이면 기본값("켜짐")으로 꾸미지 않고 PARSE_FAILED 행', async () => {
    const repo = { findScenarioDocs: async () => [{ scname: 'NUL', property: null }, { scname: 'STR', property: 'x' }] }
    const hash = { hkeys: async () => ['NUL.1', 'STR.1'] }
    const rows = await createListService({ repo, hash, scopes }).list(user, 'P', 'M')
    for (const r of rows) expect(r).toMatchObject({ status: ['PARSE_FAILED'], isEnabled: null, typeName: null })
  })
})

describe('versionService', () => {
  it('최신 먼저, 중복 한 번, 현재 표시', async () => {
    const gridfs = { findCrtimes: async () => [1730000000100, 1730000000300, 1730000000300] }
    const hash = { hkeys: async () => ['N.1730000000300'] }
    expect(await createVersionService({ gridfs, hash, scopes }).versions(user, 'P', 'M', 'N'))
      .toEqual([{ crtime: 1730000000300, isCurrent: true }, { crtime: 1730000000100, isCurrent: false }])
  })
  it('버전이 없으면 404', async () => {
    const svc = createVersionService({ gridfs: { findCrtimes: async () => [] }, hash: { hkeys: async () => [] }, scopes })
    await expect(svc.versions(user, 'P', 'M', 'N')).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' })
  })
})

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

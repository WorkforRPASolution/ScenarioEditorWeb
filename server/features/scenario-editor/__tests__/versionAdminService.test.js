import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { createVersionAdminService } = require('../service/versionAdminService')
const { propertyRev } = require('../domain/deployIdentity')
const { seError } = require('../errors')

const NOW = new Date('2026-11-07T01:02:03Z') // KST 10:02:03
const user = { singleid: 'sew_x', authorityManager: 3 }
const key = { process: 'P', model: 'M', name: 'N' }
const prop = { IsEnabled: false, Owners: ['kim@2026-11-01 10:00:00'] }
const fail = async (p) => { try { await p } catch (e) { return e } throw new Error('통과하면 안 됨') }

function setup(o = {}) {
  const calls = { setEnabled: [], del: [], allowed: [] }
  let doc = o.docs === undefined ? { scname: 'N', property: prop } : null
  let docs = o.docs === undefined ? [doc] : o.docs
  const repo = {
    findScenarioKeyDocs: async () => docs,
    setEnabled: async (k, v) => {
      calls.setEnabled.push([k, v])
      docs = [{ ...docs[0], property: { ...docs[0].property, IsEnabled: v.enabled, Owners: v.owners } }]
      return { matched: o.matched === undefined ? 1 : o.matched }
    }
  }
  const scopes = { assertAllowed: async (u, p, m) => { calls.allowed.push([p, m]); if (o.deny) throw seError(403, 'PROCESS_FORBIDDEN', 'x') } }
  const interfaceClient = { delScenario: async (k) => { calls.del.push(k); if (o.delFails) throw seError(504, 'UPSTREAM_TIMEOUT', 't'); return {} } }
  calls.draft = []
  calls.images = []
  // 웹 전용 DB(내 초안): deleteDraftFor(owner, process, model, name) → { deleted, gridIds }
  const web = {
    deleteDraftFor: async (...a) => { calls.draft.push(a); if (o.draftFails) throw seError(503, 'UPSTREAM_DOWN', 'web'); return o.draft === undefined ? { deleted: true, gridIds: ['g1', 'g2'] } : o.draft },
    deleteDraftImages: async (ids) => { calls.images.push(ids); if (o.imagesFail) throw new Error('grid') }
  }
  const svc = createVersionAdminService({ repo, scopes, interfaceClient, web, now: () => NOW.getTime() })
  return { svc, calls, getDocs: () => docs }
}

describe('setEnabled', () => {
  it('켜기: true 와 Activated 줄을 쓰고 바뀐 property 의 지문을 돌려준다', async () => {
    const { svc, calls, getDocs } = setup()
    const out = await svc.setEnabled(user, key, true)
    expect(calls.setEnabled).toEqual([[key, { enabled: true, owners: ['kim@2026-11-01 10:00:00', 'sew_x@2026-11-07 10:02:03@Scenario Activated'] }]])
    expect(out.isEnabled).toBe(true)
    expect(out.propertyRev).toBe(propertyRev(getDocs()[0].property))
  })
  it('끄기: Deactivated 줄. 이미 같은 값이어도 줄을 남긴다', async () => {
    const { svc, calls } = setup()
    const out = await svc.setEnabled(user, key, false)
    expect(calls.setEnabled[0][1]).toEqual({ enabled: false, owners: ['kim@2026-11-01 10:00:00', 'sew_x@2026-11-07 10:02:03@Scenario Deactivated'] })
    expect(out.isEnabled).toBe(false)
  })
  it('권한 밖이면 403 이고 아무것도 쓰지 않는다', async () => {
    const { svc, calls } = setup({ deny: true })
    expect((await fail(svc.setEnabled(user, key, true))).code).toBe('PROCESS_FORBIDDEN')
    expect(calls.setEnabled).toEqual([])
  })
  it('문서 0건 404, 2건 이상 422 DATA_INVALID', async () => {
    const a = setup({ docs: [] })
    expect((await fail(a.svc.setEnabled(user, key, true))).code).toBe('NOT_FOUND')
    const b = setup({ docs: [{ property: prop }, { property: prop }] })
    expect((await fail(b.svc.setEnabled(user, key, true))).code).toBe('DATA_INVALID')
    expect(a.calls.setEnabled.concat(b.calls.setEnabled)).toEqual([])
  })
  it('쓰기가 0건에 맞으면 404', async () => {
    const { svc } = setup({ matched: 0 })
    expect((await fail(svc.setEnabled(user, key, true))).code).toBe('NOT_FOUND')
  })
})

describe('remove', () => {
  it('이름이 다르면 400 이고 delScenario 를 부르지 않는다', async () => {
    const { svc, calls } = setup()
    const e = await fail(svc.remove(user, key, 'X'))
    expect(e.code).toBe('BAD_REQUEST')
    expect(calls.del).toEqual([])
  })
  it('문서 0건이면 404 이고 delScenario 를 부르지 않는다', async () => {
    const { svc, calls } = setup({ docs: [] })
    expect((await fail(svc.remove(user, key, 'N'))).code).toBe('NOT_FOUND')
    expect(calls.del).toEqual([])
  })
  it('권한 밖이면 403', async () => {
    const { svc, calls } = setup({ deny: true })
    expect((await fail(svc.remove(user, key, 'N'))).code).toBe('PROCESS_FORBIDDEN')
    expect(calls.del).toEqual([])
  })
  it('성공하면 delScenario 를 한 번 부른다', async () => {
    const { svc, calls } = setup()
    expect(await svc.remove(user, key, 'N')).toEqual({ deleted: true })
    expect(calls.del).toEqual([key])
  })
  it('InterfaceServer 오류는 그대로 올린다', async () => {
    const s = createVersionAdminService({ repo: { findScenarioKeyDocs: async () => [{ property: prop }] }, scopes: { assertAllowed: async () => {} }, interfaceClient: { delScenario: async () => { throw seError(504, 'UPSTREAM_TIMEOUT', 't') } } })
    expect((await fail(s.remove(user, key, 'N'))).code).toBe('UPSTREAM_TIMEOUT')
  })

  // 내 초안도 함께 지우기(2026-11-10 사용자 결정): 시나리오를 지운 뒤에만, 요청한 사용자의 초안만 지운다
  it('withDraft 가 없으면 초안을 건드리지 않는다', async () => {
    const { svc, calls } = setup()
    expect(await svc.remove(user, key, 'N')).toEqual({ deleted: true })
    expect(calls.draft).toEqual([])
  })
  it('withDraft: 시나리오를 지운 뒤 내 초안(사용자·공정·모델·이름)과 그 그림을 지운다', async () => {
    const { svc, calls } = setup()
    expect(await svc.remove(user, key, 'N', { withDraft: true })).toEqual({ deleted: true, draftDeleted: true })
    expect(calls.del).toEqual([key])
    expect(calls.draft).toEqual([['sew_x', 'P', 'M', 'N']])
    expect(calls.images).toEqual([['g1', 'g2']])
  })
  it('withDraft: 내 초안이 없으면 draftDeleted false, 그림 정리가 실패해도 초안은 지운 것이다', async () => {
    const none = setup({ draft: { deleted: false, gridIds: [] } })
    expect(await none.svc.remove(user, key, 'N', { withDraft: true })).toEqual({ deleted: true, draftDeleted: false })
    expect(none.calls.images).toEqual([])
    const grid = setup({ imagesFail: true })
    expect(await grid.svc.remove(user, key, 'N', { withDraft: true })).toEqual({ deleted: true, draftDeleted: true })
  })
  it('withDraft: 초안 지우기가 실패해도 시나리오 지우기는 성공이다(draftDeleted false) — 초안은 목록에서 다시 지울 수 있다', async () => {
    const { svc, calls } = setup({ draftFails: true })
    expect(await svc.remove(user, key, 'N', { withDraft: true })).toEqual({ deleted: true, draftDeleted: false })
    expect(calls.del).toEqual([key])
  })
  it('withDraft: 시나리오 지우기가 실패하거나 결과를 모르면 초안을 지우지 않는다', async () => {
    const { svc, calls } = setup({ delFails: true })
    expect((await fail(svc.remove(user, key, 'N', { withDraft: true }))).code).toBe('UPSTREAM_TIMEOUT')
    expect(calls.draft).toEqual([])
    const bad = setup()
    expect((await fail(bad.svc.remove(user, key, 'X', { withDraft: true }))).code).toBe('BAD_REQUEST')
    expect(bad.calls.draft).toEqual([])
  })
})

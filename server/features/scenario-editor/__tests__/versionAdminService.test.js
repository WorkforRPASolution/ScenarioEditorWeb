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
  const interfaceClient = { delScenario: async (k) => { calls.del.push(k); return {} } }
  const svc = createVersionAdminService({ repo, scopes, interfaceClient, now: () => NOW.getTime() })
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
})

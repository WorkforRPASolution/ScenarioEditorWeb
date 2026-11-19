import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { createDraftService } = require('../service/draftService')
const { seError } = require('../errors')

const user = { singleid: 'u' }
const SRC = { process: 'P', model: 'M', name: 'N', crtime: 1730000000000, fileId: 'f1' }
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])

function setup({ prev = null, blocked = false, edited, upsertFail = false } = {}) {
  const calls = { upsert: [], put: [], del: [], deleteDraft: [] }
  const ed = edited || { source: SRC, headCrtime: 5, steps: [{ uid: 's1', images: { train: { 0: { from: 'upload', tempId: 'a' } }, base: null } }] }
  const store = new Map()
  if (prev) store.set(String(prev._id), prev)
  const web = {
    findDraftFor: async () => prev,
    putDraftImage: async (buf, { tempId }) => { const id = `g-${tempId}-${calls.put.length}`; calls.put.push(tempId); return id },
    upsertDraft: async (doc) => { if (upsertFail) throw new Error('db'); calls.upsert.push(doc); return { draftId: 'd1', savedAt: new Date(0), revision: 2 } },
    deleteDraftImages: async (ids) => { calls.del.push(ids) },
    getDraft: async (owner, id) => (prev && String(prev._id) === id && prev.owner === owner ? prev : null),
    listDrafts: async (...a) => ['list', ...a],
    deleteDraft: async (owner, id) => { calls.deleteDraft.push(id); return prev && String(prev._id) === id && prev.owner === owner ? { deleted: true, gridIds: ['g-old'] } : { deleted: false, gridIds: [] } },
    openDraftImage: (g) => `stream:${g}`
  }
  const scopes = { assertAllowed: async (u, p, m) => { if (m === 'FORBID') throw seError(403, 'PROCESS_FORBIDDEN', 'x') } }
  const check = { prepare: async () => ({ edited: ed, extraBlocks: blocked ? [{ code: 'SOURCE_GONE' }] : [] }) }
  const svc = createDraftService({ web, check, scopes })
  const meta = (o = {}) => ({ target: { process: 'P', model: 'M', name: 'N' }, propertyRev: 'rev', scenario: { x: 1 }, ...o })
  return { svc, calls, meta }
}
const fail = async (p) => { try { await p } catch (e) { return e } throw new Error('통과하면 안 됨') }

describe('draftService.save', () => {
  it('막힘이 있어도 저장한다', async () => {
    const { svc, calls, meta } = setup({ blocked: true })
    const r = await svc.save(user, meta(), new Map([['a', png]]))
    expect(r).toEqual({ draftId: 'd1', savedAt: new Date(0), revision: 2 })
    expect(calls.upsert).toHaveLength(1)
    expect(calls.upsert[0]).toMatchObject({ owner: 'u', process: 'P', model: 'M', name: 'N', base: { crtime: SRC.crtime, fileId: 'f1' }, headCrtime: 5, propertyRev: 'rev', target: { model: 'M', name: 'N' } })
    expect(calls.upsert[0].images).toEqual([{ tempId: 'a', gridId: 'g-a-0' }])
  })
  it('되돌린 판에서 시작한 초안: meta.restoredFrom(옛 판 crtime)을 초안에 남긴다 — 없으면 null(SEW-022 (2): 다시 열어 배포해도 배포 기록에 되돌림이 남게)', async () => {
    const a = setup()
    await a.svc.save(user, a.meta({ restoredFrom: 1720000000000 }), new Map([['a', png]]))
    expect(a.calls.upsert[0].restoredFrom).toBe(1720000000000)
    const b = setup()
    await b.svc.save(user, b.meta(), new Map([['a', png]]))
    expect(b.calls.upsert[0].restoredFrom).toBe(null) // 다시 저장하면 지운다(되돌린 세션이 아니다)
  })
  it('restoredFrom 이 정수가 아니면 400 이고 아무것도 넣지 않는다', async () => {
    const { svc, calls, meta } = setup()
    const e = await fail(svc.save(user, meta({ restoredFrom: '1720000000000' }), new Map([['a', png]])))
    expect(e).toMatchObject({ statusCode: 400, details: { path: 'restoredFrom' } })
    expect(calls.put).toEqual([])
    expect(calls.upsert).toEqual([])
  })
  it('새 시나리오(source null)면 키는 target 의 모델·이름이고 base 는 null', async () => {
    const edited = { source: null, headCrtime: null, steps: [] }
    const { svc, calls, meta } = setup({ edited })
    await svc.save(user, meta({ target: { process: 'P', model: 'M2', name: 'NEW' } }), new Map())
    expect(calls.upsert[0]).toMatchObject({ model: 'M2', name: 'NEW', base: null, target: { model: 'M2', name: 'NEW' } })
  })
  it('기준 판이 있으면 키는 기준 판의 모델·이름(target 이 달라도)', async () => {
    const { svc, calls, meta } = setup()
    await svc.save(user, meta({ target: { process: 'P', model: 'M', name: 'COPY' } }), new Map([['a', png]]))
    expect(calls.upsert[0]).toMatchObject({ model: 'M', name: 'N', target: { model: 'M', name: 'COPY' } })
  })
  it('가리키는 곳 없는 파일이 있으면 400 이고 아무것도 넣지 않는다', async () => {
    const { svc, calls, meta } = setup()
    const e = await fail(svc.save(user, meta(), new Map([['a', png], ['zzz', png]])))
    expect(e.statusCode).toBe(400)
    expect(e.code).toBe('BAD_REQUEST')
    expect(calls.upsert).toHaveLength(0)
    expect(calls.put).toHaveLength(0)
  })
  it('참조한 파일이 없고 이전 초안에도 없으면 400', async () => {
    const { svc, calls, meta } = setup()
    const e = await fail(svc.save(user, meta(), new Map()))
    expect(e.statusCode).toBe(400)
    expect(calls.upsert).toHaveLength(0)
  })
  it('이전 초안의 같은 tempId 는 파일 없이 이어받고, 쓰지 않는 옛 그림은 저장 뒤 지운다', async () => {
    const prev = { _id: 'p1', owner: 'u', images: [{ tempId: 'a', gridId: 'g-old-a' }, { tempId: 'gone', gridId: 'g-old-gone' }] }
    const { svc, calls, meta } = setup({ prev })
    await svc.save(user, meta(), new Map())
    expect(calls.put).toEqual([])
    expect(calls.upsert[0].images).toEqual([{ tempId: 'a', gridId: 'g-old-a' }])
    expect(calls.del).toEqual([['g-old-gone']])
  })
  it('같은 tempId 의 새 파일이 오면 옛 파일은 지운다', async () => {
    const prev = { _id: 'p1', owner: 'u', images: [{ tempId: 'a', gridId: 'g-old-a' }] }
    const { svc, calls, meta } = setup({ prev })
    await svc.save(user, meta(), new Map([['a', png]]))
    expect(calls.upsert[0].images).toEqual([{ tempId: 'a', gridId: 'g-a-0' }])
    expect(calls.del).toEqual([['g-old-a']])
  })
  it('넣기가 실패하면 이전 초안의 그림은 지우지 않고 새로 넣은 그림만 치운다', async () => {
    const prev = { _id: 'p1', owner: 'u', images: [{ tempId: 'a', gridId: 'g-old-a' }] }
    const { svc, calls, meta } = setup({ prev, upsertFail: true })
    await fail(svc.save(user, meta(), new Map([['a', png]])))
    expect(calls.del).toEqual([['g-a-0']])
  })
  it('권한 밖이면 prepare 의 오류가 그대로 나온다', async () => {
    const s2 = createDraftService({ web: {}, check: { prepare: async () => { throw seError(403, 'PROCESS_FORBIDDEN', 'x') } }, scopes: {} })
    expect((await fail(s2.save(user, {}, new Map()))).code).toBe('PROCESS_FORBIDDEN')
  })
})

describe('draftService get·list·image·remove', () => {
  const prev = { _id: 'p1', owner: 'u', process: 'P', model: 'M', name: 'N', base: null, headCrtime: 1, propertyRev: 'r', target: { model: 'M', name: 'N' }, scenario: { s: 1 }, images: [{ tempId: 'a', gridId: 'g1' }], savedAt: new Date(0), revision: 3 }
  it('get 은 imageUrls 를 붙인다', async () => {
    const { svc } = setup({ prev })
    expect(await svc.get(user, 'p1')).toEqual({ draftId: 'p1', savedAt: new Date(0), revision: 3, base: null, headCrtime: 1, propertyRev: 'r', target: { model: 'M', name: 'N' }, scenario: { s: 1 }, restoredFrom: null, imageUrls: { a: '/scenario-editor/drafts/p1/images/a' } })
    expect((await setup({ prev: { ...prev, restoredFrom: 1720000000000 } }).svc.get(user, 'p1')).restoredFrom).toBe(1720000000000)
  })
  it('다른 사람 초안 get·image·remove 는 404', async () => {
    const { svc } = setup({ prev })
    const other = { singleid: 'x' }
    expect((await fail(svc.get(other, 'p1'))).statusCode).toBe(404)
    expect((await fail(svc.image(other, 'p1', 'a'))).statusCode).toBe(404)
    expect((await fail(svc.remove(other, 'p1'))).statusCode).toBe(404)
  })
  it('image 는 tempId 의 스트림, 없는 tempId 는 404', async () => {
    const { svc } = setup({ prev })
    expect(await svc.image(user, 'p1', 'a')).toBe('stream:g1')
    expect((await fail(svc.image(user, 'p1', 'nope'))).statusCode).toBe(404)
  })
  it('remove 는 그림도 지운다', async () => {
    const { svc, calls } = setup({ prev })
    expect(await svc.remove(user, 'p1')).toEqual({ deleted: true })
    expect(calls.del).toEqual([['g-old']])
  })
  it('list 는 권한을 확인하고 저장소에 넘긴다', async () => {
    const { svc } = setup()
    expect(await svc.list(user, 'P', 'M')).toEqual(['list', 'u', 'P', 'M'])
    expect((await fail(svc.list(user, 'P', 'FORBID'))).code).toBe('PROCESS_FORBIDDEN')
  })
})

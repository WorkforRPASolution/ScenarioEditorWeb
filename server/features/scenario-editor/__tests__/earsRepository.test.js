import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const mongoose = require('mongoose')
const { createEarsRepository } = require('../repo/earsRepository')

// 받은 필터·갱신·옵션을 기록하는 가짜 DB
function fakeDb({ rows = [], collections = [], matched = 1 } = {}) {
  const calls = []
  const cursor = (op) => ({
    maxTimeMS: (ms) => { op.maxTimeMS = ms; return cursor(op) },
    sort: (s) => { op.sort = s; return cursor(op) },
    limit: (n) => { op.limit = n; return cursor(op) },
    toArray: async () => rows
  })
  const db = {
    collection: (name) => ({
      updateOne: async (filter, update, options) => { calls.push({ name, op: 'updateOne', filter, update, options }); return { matchedCount: matched } },
      countDocuments: async (filter, options) => { calls.push({ name, op: 'countDocuments', filter, options }); return 3 },
      find: (filter, options) => { const op = { name, op: 'find', filter, options }; calls.push(op); return cursor(op) },
      distinct: async (field, filter, options) => { calls.push({ name, op: 'distinct', field, filter, options }); return rows },
      aggregate: (pipeline, options) => { calls.push({ name, op: 'aggregate', pipeline, options }); return { toArray: async () => rows } }
    }),
    listCollections: (filter, options) => ({ toArray: async () => { calls.push({ op: 'listCollections', filter, options }); return collections } })
  }
  return { db, calls }
}
const repoOf = (f) => createEarsRepository(() => f.db, mongoose.mongo)
const key = { process: 'SEWCVD', model: 'M1', name: 'SEW_W_A' }
const KEY_FILTER = { process: 'SEWCVD', eqpModel: 'M1', scname: 'SEW_W_A', property: { $exists: true } }

describe('earsRepository 쓰기', () => {
  it('finishDeploy: scCategory·trCategory 는 Long, 필터에 property $exists, Owners·performance 를 한 번에 $set', async () => {
    const f = fakeDb()
    const perf = { Grade: 1 }
    const r = await repoOf(f).finishDeploy(key, { scCategory: 2, owners: ['a@t'], performance: perf })
    expect(r).toEqual({ matched: 1 })
    const c = f.calls[0]
    expect(c.name).toBe('SC_PROPERTY')
    expect(c.filter).toEqual(KEY_FILTER)
    expect(c.update.$set.scCategory._bsontype).toBe('Long')
    expect(c.update.$set.scCategory.toNumber()).toBe(2)
    expect(c.update.$set.trCategory._bsontype).toBe('Long')
    expect(c.update.$set.trCategory.toNumber()).toBe(0)
    expect(c.update.$set['property.Owners']).toEqual(['a@t'])
    expect(c.update.$set.performance).toEqual(perf)
  })
  it('finishDeploy: performance 가 null 이면 performance 를 건드리지 않는다', async () => {
    const f = fakeDb({ matched: 0 })
    const r = await repoOf(f).finishDeploy(key, { scCategory: 1, owners: [], performance: null })
    expect(r).toEqual({ matched: 0 })
    expect('performance' in f.calls[0].update.$set).toBe(false)
  })
  it('setEnabled: IsEnabled·Owners 만 $set', async () => {
    const f = fakeDb()
    await repoOf(f).setEnabled(key, { enabled: false, owners: ['x'] })
    expect(f.calls[0].filter).toEqual(KEY_FILTER)
    expect(f.calls[0].update).toEqual({ $set: { 'property.IsEnabled': false, 'property.Owners': ['x'] } })
  })
  it('setReview: 받은 필드를 그대로 $set', async () => {
    const f = fakeDb()
    await repoOf(f).setReview(key, { 'performance.Grade': 2, 'performance.Supervisor': 'boss' })
    expect(f.calls[0].update).toEqual({ $set: { 'performance.Grade': 2, 'performance.Supervisor': 'boss' } })
  })
  it('setReview: performance. 로 시작하지 않는 키가 하나라도 있으면 쓰지 않고 던진다(프로그램 오류)', async () => {
    const f = fakeDb()
    await expect(repoOf(f).setReview(key, { 'performance.Grade': 2, 'property.IsEnabled': false })).rejects.toThrow(/performance\./)
    await expect(repoOf(f).setReview(key, { scCategory: 1 })).rejects.toThrow()
    expect(f.calls).toHaveLength(0)
  })
  it('setPerformanceFields: performance. 로 시작하지 않는 키는 던진다', async () => {
    const f = fakeDb()
    await expect(repoOf(f).setPerformanceFields(key, { Grade: 1 })).rejects.toThrow()
    expect(f.calls).toHaveLength(0)
    await repoOf(f).setPerformanceFields(key, { 'performance.Grade': 1 })
    expect(f.calls[0].update).toEqual({ $set: { 'performance.Grade': 1 } })
  })
  it('쓰기에도 maxTimeMS 를 건다', async () => {
    const f = fakeDb()
    await repoOf(f).setEnabled(key, { enabled: true, owners: [] })
    expect(f.calls[0].options.maxTimeMS).toBe(20000)
  })
  it('countPropertyDocs', async () => {
    const f = fakeDb()
    expect(await repoOf(f).countPropertyDocs(key)).toBe(3)
    expect(f.calls[0].filter).toEqual(KEY_FILTER)
  })
})

describe('earsRepository 읽기', () => {
  it('findPerformanceRaw: Long 을 숫자로 올리지 않는 읽기(promoteLongs:false)이고 performance 만 돌려준다', async () => {
    const f = fakeDb({ rows: [{ performance: { CitizenDeveloper: [{ Contribution: 5 }] } }] })
    expect(await repoOf(f).findPerformanceRaw(key)).toEqual({ CitizenDeveloper: [{ Contribution: 5 }] })
    expect(f.calls[0]).toMatchObject({ name: 'SC_PROPERTY', op: 'find', filter: KEY_FILTER, options: { promoteLongs: false, projection: { _id: 0, performance: 1 } } })
  })
  it('findPerformanceRaw: 문서가 없거나 performance 가 없으면 null', async () => {
    expect(await repoOf(fakeDb({ rows: [] })).findPerformanceRaw(key)).toBeNull()
    expect(await repoOf(fakeDb({ rows: [{}] })).findPerformanceRaw(key)).toBeNull()
  })

  it('searchUsers: 정규식 특수 문자를 이스케이프하고 password 제외·20건', async () => {
    const f = fakeDb({ rows: [{ singleid: 'a', name: 'b', process: 'P' }] })
    const out = await repoOf(f).searchUsers('a.b')
    expect(out).toHaveLength(1)
    const c = f.calls[0]
    expect(c.name).toBe('ARS_USER_INFO')
    const [x, y] = c.filter.$or
    expect(x.singleid.$regex).toBe('a\\.b')
    expect(x.singleid.$options).toBe('i')
    expect(y.name.$regex).toBe('a\\.b')
    // 포함 projection 에 제외(password: 0)를 섞으면 MongoDB 가 거절한다
    expect(c.options.projection).toEqual({ _id: 0, singleid: 1, name: 1, process: 1 })
    expect('password' in c.options.projection).toBe(false)
    expect(c.limit).toBe(20)
  })
  it('findSameNameModels: 같은 공정·이름의 eqpModel 정렬', async () => {
    const f = fakeDb({ rows: ['B', 'A'] })
    expect(await repoOf(f).findSameNameModels('SEWCVD', 'N')).toEqual(['A', 'B'])
    expect(f.calls[0].filter).toEqual({ process: 'SEWCVD', scname: 'N', property: { $exists: true } })
  })
  it('hasNameRule: 컬렉션 유무', async () => {
    expect(await repoOf(fakeDb({ collections: [{ name: 'SC_NAME_RULE' }] })).hasNameRule()).toBe(true)
    const f = fakeDb()
    expect(await repoOf(f).hasNameRule()).toBe(false)
    expect(f.calls[0].filter).toEqual({ name: 'SC_NAME_RULE' })
  })
  it('findNameRule: 전체 문서', async () => {
    const f = fakeDb({ rows: [{ a: 1 }, { a: 2 }] })
    expect(await repoOf(f).findNameRule()).toEqual([{ a: 1 }, { a: 2 }])
    expect(f.calls[0].name).toBe('SC_NAME_RULE')
  })
})

// 불러오기 창의 공정·모델 옆 시나리오 수(2026-11-11 사용자 요청). 세는 기준은 목록과 같다 — 운영 속성(property)이 있는 문서, 같은 이름은 한 번.
describe('earsRepository countScenarios', () => {
  it('공정들의 SC_PROPERTY 를 공정·모델·이름으로 한 번 묶고 공정·모델별로 센다 — 문서는 가져오지 않는다', async () => {
    const f = fakeDb({ rows: [{ _id: { process: 'SEWCVD', model: 'M1' }, count: 3 }, { _id: { process: 'SEWETCH', model: 'M2' }, count: 1 }] })
    const out = await repoOf(f).countScenarios(['SEWCVD', 'SEWETCH'])
    expect(out).toEqual([{ process: 'SEWCVD', model: 'M1', count: 3 }, { process: 'SEWETCH', model: 'M2', count: 1 }])
    const c = f.calls[0]
    expect(c).toMatchObject({ name: 'SC_PROPERTY', op: 'aggregate' })
    expect(c.pipeline).toEqual([
      { $match: { process: { $in: ['SEWCVD', 'SEWETCH'] }, property: { $exists: true }, scname: { $type: 'string' } } },
      { $group: { _id: { process: '$process', model: '$eqpModel', name: '$scname' } } },
      { $group: { _id: { process: '$_id.process', model: '$_id.model' }, count: { $sum: 1 } } }
    ])
    expect(c.options.maxTimeMS).toBeGreaterThan(0)
  })
  it('공정이 없으면 묻지 않는다', async () => {
    const f = fakeDb()
    expect(await repoOf(f).countScenarios([])).toEqual([])
    expect(f.calls).toEqual([])
  })
})

describe('earsRepository 메모 (ARS_USER_MEMO)', () => {
  const NAME = '1762820000123_[412][388].png'
  // 받은 호출을 기록하고 정해 둔 결과를 주는 가짜 컬렉션
  function memoDb({ rows = [], update = { matchedCount: 1, upsertedCount: 0 }, deleted = 1 } = {}) {
    const calls = []
    const cursor = (op) => ({
      maxTimeMS: (ms) => { op.maxTimeMS = ms; return cursor(op) },
      limit: (n) => { op.limit = n; return cursor(op) },
      toArray: async () => rows
    })
    const db = {
      collection: (name) => ({
        find: (filter, options) => { const op = { name, op: 'find', filter, options }; calls.push(op); return cursor(op) },
        updateOne: async (filter, upd, options) => { calls.push({ name, op: 'updateOne', filter, update: upd, options }); return update },
        deleteOne: async (filter, options) => { calls.push({ name, op: 'deleteOne', filter, options }); return { deletedCount: deleted } }
      })
    }
    return { db, calls }
  }

  it('findMemos: 설비와 파일 이름 범위로 — 위 끝은 줄 때만, 한도까지', async () => {
    const f = memoDb({ rows: [{ _id: 1 }] })
    expect(await repoOf(f).findMemos({ eqpId: 'E1', fromName: '1762700000000', toName: '1762800000000' }, 10)).toEqual([{ _id: 1 }])
    expect(f.calls[0]).toMatchObject({ name: 'ARS_USER_MEMO', op: 'find', filter: { eqpid: 'E1', filename: { $gte: '1762700000000', $lt: '1762800000000' } }, limit: 10, maxTimeMS: 20000 })
    await repoOf(f).findMemos({ fromName: '1762700000000' }, 5001)
    expect(f.calls[1].filter).toEqual({ filename: { $gte: '1762700000000' } })
    expect(f.calls[1].limit).toBe(5001)
  })

  it('findMemosByKey: (설비, 파일 이름)의 문서 모두', async () => {
    const f = memoDb({ rows: [{ _id: 1 }, { _id: 2 }] })
    expect(await repoOf(f).findMemosByKey('E1', NAME)).toHaveLength(2)
    expect(f.calls[0]).toMatchObject({ name: 'ARS_USER_MEMO', filter: { eqpid: 'E1', filename: NAME }, maxTimeMS: 20000 })
  })

  it('insertMemoIfAbsent: 같은 키가 없을 때만 받은 문서 그대로 넣는다', async () => {
    const doc = { singleid: 'kim', eqpid: 'E1', snapshotTimestamp: new Date(5), process: 'CVD', memo: '글', filename: NAME, hiddensnapshot: '0' }
    const f = memoDb({ update: { matchedCount: 0, upsertedCount: 1 } })
    expect(await repoOf(f).insertMemoIfAbsent(doc)).toEqual({ inserted: true })
    const c = f.calls[0]
    expect([c.name, c.op]).toEqual(['ARS_USER_MEMO', 'updateOne'])
    expect(c.filter).toEqual({ eqpid: 'E1', filename: NAME })
    expect(c.update).toEqual({ $setOnInsert: doc })
    expect(c.options).toMatchObject({ upsert: true, maxTimeMS: 20000 })
    const had = memoDb({ update: { matchedCount: 1, upsertedCount: 0 } })
    expect(await repoOf(had).insertMemoIfAbsent(doc)).toEqual({ inserted: false })
  })

  it('updateMemoText: 본 글이 그대로일 때만 memo·webEditedBy·webEditedAt 셋만 바꾼다', async () => {
    const f = memoDb()
    const at = new Date(9)
    expect(await repoOf(f).updateMemoText('id1', '옛 글', { memo: '새 글', webEditedBy: 'lee', webEditedAt: at, singleid: 'x', process: 'y' })).toEqual({ matched: 1 })
    const c = f.calls[0]
    expect(c.filter).toEqual({ _id: 'id1', memo: '옛 글' })
    expect(c.update).toEqual({ $set: { memo: '새 글', webEditedBy: 'lee', webEditedAt: at } })
    expect(c.options).toMatchObject({ maxTimeMS: 20000 })
    expect(c.options.upsert).toBeUndefined()
    expect(await repoOf(memoDb({ update: { matchedCount: 0 } })).updateMemoText('id1', 'a', { memo: 'b', webEditedBy: 'l', webEditedAt: at })).toEqual({ matched: 0 })
  })

  it('deleteMemo: 본 글이 그대로인 그 문서 하나만 — process 를 조건에 넣지 않는다', async () => {
    const f = memoDb()
    expect(await repoOf(f).deleteMemo('id1', '글')).toEqual({ deleted: 1 })
    expect(f.calls[0]).toMatchObject({ name: 'ARS_USER_MEMO', op: 'deleteOne', filter: { _id: 'id1', memo: '글' } })
    expect(Object.keys(f.calls[0].filter)).toEqual(['_id', 'memo'])
    expect(await repoOf(memoDb({ deleted: 0 })).deleteMemo('id1', '글')).toEqual({ deleted: 0 })
  })

  it('findUserNames: 아이디 목록의 이름만 — 빈 목록이면 DB 를 부르지 않는다', async () => {
    const f = memoDb({ rows: [{ singleid: 'kim', name: '김' }] })
    expect(await repoOf(f).findUserNames(['kim', 'lee'])).toEqual([{ singleid: 'kim', name: '김' }])
    expect(f.calls[0]).toMatchObject({ name: 'ARS_USER_INFO', filter: { singleid: { $in: ['kim', 'lee'] } }, options: { projection: { _id: 0, singleid: 1, name: 1 } } })
    expect(await repoOf(f).findUserNames([])).toEqual([])
    expect(f.calls).toHaveLength(1)
  })
})

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
      distinct: async (field, filter, options) => { calls.push({ name, op: 'distinct', field, filter, options }); return rows }
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

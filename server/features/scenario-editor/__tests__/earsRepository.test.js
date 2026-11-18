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
      sort: (v) => { op.sort = v; return cursor(op) },
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
    expect(f.calls[0].sort).toEqual({ filename: -1 }) // 한도에서 잘릴 때 늦은 스냅샷의 메모가 남게
    await repoOf(f).findMemos({ fromName: '1762700000000' }, 5001)
    expect(f.calls[1].filter).toEqual({ filename: { $gte: '1762700000000' } })
    expect(f.calls[1].limit).toBe(5001)
    // 기다릴 시간을 주면 그만큼만(하루 목록이 메모 조회에 매이지 않게)
    await repoOf(f).findMemos({ eqpId: 'E1', fromName: 'a', toName: 'b', maxTimeMs: 4000 }, 10)
    expect(f.calls[2].maxTimeMS).toBe(4000)
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

describe('earsRepository 시험 실행 읽기 (P5)', () => {
  const RUN_MS = 5000
  it('findEquipmentFresh: 그 설비 ID 의 EQP_INFO·AGENT_INFO 문서를 목록과 같은 조건으로', async () => {
    const f = fakeDb({ rows: [{ eqpId: 'SEWT_CVD_A01' }] })
    const r = await repoOf(f).findEquipmentFresh('SEWT_CVD_A01')
    expect(r).toEqual({ eqps: [{ eqpId: 'SEWT_CVD_A01' }], agents: [{ eqpId: 'SEWT_CVD_A01' }] })
    const eqp = f.calls.find((c) => c.name === 'EQP_INFO')
    const agent = f.calls.find((c) => c.name === 'AGENT_INFO')
    expect(eqp.filter).toEqual({ eqpId: 'SEWT_CVD_A01', webmanagerUse: 1 })
    expect(eqp.options).toEqual({ projection: { _id: 0 } })
    expect(agent.filter).toEqual({ eqpId: 'SEWT_CVD_A01', arsagentJava: 1 })
    expect(eqp.maxTimeMS).toBe(RUN_MS)
    expect(agent.maxTimeMS).toBe(RUN_MS)
  })
  it('findOnoff: 설비들의 onoff 를 조회 한 번으로 — 빈 목록이면 DB 를 부르지 않는다', async () => {
    const f = fakeDb({ rows: [{ eqpId: 'A', onoff: 0 }] })
    expect(await repoOf(f).findOnoff(['A', 'B'])).toEqual([{ eqpId: 'A', onoff: 0 }])
    expect(f.calls).toHaveLength(1)
    expect(f.calls[0]).toMatchObject({ name: 'EQP_INFO', filter: { eqpId: { $in: ['A', 'B'] }, webmanagerUse: 1 }, options: { projection: { _id: 0, eqpId: 1, onoff: 1 } }, maxTimeMS: RUN_MS })
    const empty = fakeDb()
    expect(await repoOf(empty).findOnoff([])).toEqual([])
    expect(empty.calls).toHaveLength(0)
  })
  it('findRunPropertyDocs: 키 세 칸으로(property 가 없는 문서도 센다), 값의 형을 올리지 않고, 세 건까지', async () => {
    const f = fakeDb({ rows: [{}] })
    await repoOf(f).findRunPropertyDocs(key)
    expect(f.calls[0]).toMatchObject({
      name: 'SC_PROPERTY', filter: { process: 'SEWCVD', eqpModel: 'M1', scname: 'SEW_W_A' },
      options: { promoteValues: false, projection: { _id: 0, property: 1, scCategory: 1 } }, limit: 3, maxTimeMS: RUN_MS
    })
  })
  it('findRecoveries: 설비들과 txn_seq 범위 + 그 시나리오의 SE 실행만 — 조회 한 번, 1,000건까지, hint 를 걸지 않는다', async () => {
    const f = fakeDb({ rows: [] })
    await repoOf(f).findRecoveries({ eqpIds: ['A', 'B'], from: 100, to: 200, name: 'RUN_A' })
    const c = f.calls[0]
    // 알람 조치가 많은 설비에서 1,000건 한도에 내 문서가 밀려나지 않게 시나리오·SE 로 좁힌다(인덱스는 앞 두 칸을 탄다)
    expect(c).toMatchObject({ name: 'EQP_AUTO_RECOVERY', filter: { eqpid: { $in: ['A', 'B'] }, txn_seq: { $gte: 100, $lte: 200 }, ears_code: 'RUN_A', trigger_by: 'SE' }, limit: 1000, maxTimeMS: RUN_MS })
    expect(c.options.hint).toBeUndefined()
    expect(c.options.projection).toEqual({ _id: 0, eqpid: 1, txn_seq: 1, ears_code: 1, trigger_by: 1, status: 1, retry: 1, create_date: 1, params: 1 })
    const empty = fakeDb()
    expect(await repoOf(empty).findRecoveries({ eqpIds: [], from: 1, to: 2 })).toEqual([])
    expect(empty.calls).toHaveLength(0)
  })
  it('findRecoveriesAt: 찾아 둔 문서를 (설비, txn_seq, 이름)으로 정확히 집는다 — 조회 한 번', async () => {
    const f = fakeDb({ rows: [] })
    await repoOf(f).findRecoveriesAt([{ eqpId: 'A', txnSeq: 11, name: 'S' }, { eqpId: 'B', txnSeq: 22, name: 'S' }])
    expect(f.calls).toHaveLength(1)
    expect(f.calls[0]).toMatchObject({ name: 'EQP_AUTO_RECOVERY', filter: { $or: [{ eqpid: 'A', txn_seq: 11, ears_code: 'S' }, { eqpid: 'B', txn_seq: 22, ears_code: 'S' }] }, maxTimeMS: RUN_MS })
    const empty = fakeDb()
    expect(await repoOf(empty).findRecoveriesAt([])).toEqual([])
    expect(empty.calls).toHaveLength(0)
  })
  it('시험 실행이 부르는 저장소 함수는 모두 읽기다 — 운영 DB 에 쓰지 않는다', async () => {
    const f = fakeDb({ rows: [] })
    const r = repoOf(f)
    await r.findEquipmentFresh('A')
    await r.findOnoff(['A'])
    await r.findRunPropertyDocs(key)
    await r.findRecoveries({ eqpIds: ['A'], from: 1, to: 2, name: 'S' })
    await r.findRecoveriesAt([{ eqpId: 'A', txnSeq: 1, name: 'S' }])
    await r.findEmailRules('S')
    await r.findEmailInfos(['C'])
    await r.findUsers('u')
    expect(f.calls.length).toBeGreaterThanOrEqual(9)
    expect([...new Set(f.calls.map((c) => c.op))]).toEqual(['find'])
  })
})

describe('earsRepository 결과 메일 수신인 읽기 (P5 설계 §5.5)', () => {
  it('findEmailRules: EMAIL_RECIPIENTS 의 app ARS · code = 시나리오 이름 — 발송 서버가 보는 네 칸만', async () => {
    const f = fakeDb({ rows: [{ process: 'P' }] })
    expect(await repoOf(f).findEmailRules('RUN_A')).toEqual([{ process: 'P' }])
    expect(f.calls[0]).toMatchObject({ name: 'EMAIL_RECIPIENTS', filter: { app: 'ARS', code: 'RUN_A' }, options: { projection: { _id: 0, emailCategory: 1, process: 1, model: 1, line: 1 } }, maxTimeMS: 5000 })
  })
  it('findEmailInfos: EMAILINFO 의 project ARS · 묶음 이름들 — 조회 한 번, 빈 목록이면 부르지 않는다', async () => {
    const f = fakeDb({ rows: [] })
    await repoOf(f).findEmailInfos(['A', 'B'])
    expect(f.calls[0]).toMatchObject({ name: 'EMAILINFO', filter: { project: 'ARS', category: { $in: ['A', 'B'] } }, options: { projection: { _id: 0, category: 1, accounts: 1 } }, maxTimeMS: 5000 })
    const empty = fakeDb()
    expect(await repoOf(empty).findEmailInfos([])).toEqual([])
    expect(empty.calls).toHaveLength(0)
  })
})

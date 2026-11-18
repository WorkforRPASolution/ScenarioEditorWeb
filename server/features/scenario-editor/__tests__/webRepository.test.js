import { describe, it, expect, vi } from 'vitest'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { createWebRepository } = require('../repo/webRepository')
const { ObjectId } = require('mongodb')

function fake() {
  const cols = {}
  const col = (name) => cols[name] || (cols[name] = {
    createIndex: vi.fn(async () => 'ok'),
    findOneAndUpdate: vi.fn(async () => ({ _id: new ObjectId(), revision: 2, savedAt: new Date(1) })),
    findOne: vi.fn(async () => null),
    find: vi.fn(() => ({ project: vi.fn().mockReturnThis(), sort: vi.fn().mockReturnThis(), maxTimeMS: vi.fn().mockReturnThis(), toArray: vi.fn(async () => []) })),
    findOneAndDelete: vi.fn(async () => null),
    insertOne: vi.fn(async () => ({})),
    updateOne: vi.fn(async () => ({})),
    aggregate: vi.fn(() => ({ toArray: vi.fn(async () => []) }))
  })
  const db = { collection: vi.fn(col) }
  const repo = createWebRepository(() => db, { GridFSBucket: vi.fn(), ObjectId })
  return { cols, col, repo }
}

describe('webRepository', () => {
  it('upsertDraft 는 키 네 칸으로 찾고 revision 을 올린다', async () => {
    const { col, repo } = fake()
    const d = col('SCENARIO_EDITOR_DRAFTS')
    const out = await repo.upsertDraft({ owner: 'o', process: 'P', model: 'M', name: 'N', scenario: { a: 1 }, images: [] })
    const [filter, update, opts] = d.findOneAndUpdate.mock.calls[0]
    expect(filter).toEqual({ owner: 'o', process: 'P', model: 'M', name: 'N' })
    expect(update.$inc).toEqual({ revision: 1 })
    expect(update.$set.scenario).toEqual({ a: 1 })
    expect(update.$set.savedAt).toBeInstanceOf(Date)
    expect(update.$set.owner).toBeUndefined()
    expect(opts).toMatchObject({ upsert: true, returnDocument: 'after' })
    expect(out.revision).toBe(2)
    expect(typeof out.draftId).toBe('string')
  })

  it('getDraft 는 owner 조건을 걸고, ObjectId 가 아닌 id 는 null', async () => {
    const { col, repo } = fake()
    const d = col('SCENARIO_EDITOR_DRAFTS')
    const id = new ObjectId()
    await repo.getDraft('me', String(id))
    expect(d.findOne.mock.calls[0][0]).toEqual({ _id: id, owner: 'me' })
    d.findOne.mockClear()
    expect(await repo.getDraft('me', 'not-an-id')).toBeNull()
    expect(d.findOne).not.toHaveBeenCalled()
  })

  it('ensureIndexes 는 여러 번 불러도 한 번만 만든다', async () => {
    const { col, repo } = fake()
    await Promise.all([repo.ensureIndexes(), repo.ensureIndexes()])
    await repo.ensureIndexes()
    expect(col('SCENARIO_EDITOR_DRAFTS').createIndex).toHaveBeenCalledTimes(1)
    expect(col('SCENARIO_EDITOR_DEPLOYS').createIndex).toHaveBeenCalledTimes(2)
    expect(col('SCENARIO_EDITOR_DRAFTS').createIndex.mock.calls[0]).toEqual([{ owner: 1, process: 1, model: 1, name: 1 }, { unique: true }])
  })

  it('쓰기 함수는 색인을 먼저 만든다', async () => {
    const { col, repo } = fake()
    await repo.insertDeploy({ requestId: 'r' })
    expect(col('SCENARIO_EDITOR_DEPLOYS').createIndex).toHaveBeenCalled()
    expect(col('SCENARIO_EDITOR_DEPLOYS').insertOne).toHaveBeenCalledWith({ requestId: 'r' })
  })

  it('deleteDraft 는 owner 조건으로 지우고 그림 id 를 돌려준다', async () => {
    const { col, repo } = fake()
    const g = new ObjectId()
    col('SCENARIO_EDITOR_DRAFTS').findOneAndDelete.mockResolvedValue({ images: [{ tempId: 't', gridId: g }] })
    const id = new ObjectId()
    const r = await repo.deleteDraft('me', String(id))
    expect(col('SCENARIO_EDITOR_DRAFTS').findOneAndDelete.mock.calls[0][0]).toEqual({ _id: id, owner: 'me' })
    expect(r).toEqual({ deleted: true, gridIds: [g] })
    expect(await repo.deleteDraft('me', 'x')).toEqual({ deleted: false, gridIds: [] })
  })

  it('listDrafts 는 본문 없이 목록 칸만 — 연 때의 현재 버전(headCrtime)도 준다(불러오기 창이 "초안 시작 뒤 새 버전" 을 가른다)', async () => {
    const { col, repo } = fake()
    const d = col('SCENARIO_EDITOR_DRAFTS')
    const _id = new ObjectId()
    const cursor = { project: vi.fn().mockReturnThis(), sort: vi.fn().mockReturnThis(), maxTimeMS: vi.fn().mockReturnThis(),
      toArray: vi.fn(async () => [{ _id, name: 'N', target: { model: 'M', name: 'N' }, base: { crtime: 5, fileId: 'f' }, headCrtime: 7, savedAt: new Date(1), revision: 3 }]) }
    d.find.mockReturnValue(cursor)
    const list = await repo.listDrafts('me', 'P', 'M')
    expect(d.find.mock.calls[0][0]).toEqual({ owner: 'me', process: 'P', model: 'M' })
    expect(cursor.project.mock.calls[0][0]).toEqual({ name: 1, target: 1, base: 1, headCrtime: 1, savedAt: 1, revision: 1 })
    expect(list).toEqual([{ draftId: String(_id), name: 'N', target: { model: 'M', name: 'N' }, base: { crtime: 5, fileId: 'f' }, headCrtime: 7, savedAt: new Date(1), revision: 3 }])
  })

  // 불러오기 창의 공정·모델 옆 내 초안 수(2026-11-11 사용자 요청: "같은 시나리오 명에 초안이 여러개 이더라도 하나로 산정")
  it('countDrafts 는 내 초안만 공정·모델·이름으로 한 번 묶고 공정·모델별로 센다 — 본문은 가져오지 않는다', async () => {
    const { col, repo } = fake()
    const d = col('SCENARIO_EDITOR_DRAFTS')
    d.aggregate.mockReturnValue({ toArray: async () => [{ _id: { process: 'P', model: 'M' }, count: 2 }] })
    expect(await repo.countDrafts('me')).toEqual([{ process: 'P', model: 'M', count: 2 }])
    const [pipeline, options] = d.aggregate.mock.calls[0]
    expect(pipeline).toEqual([
      { $match: { owner: 'me' } },
      { $group: { _id: { process: '$process', model: '$model', name: '$name' } } },
      { $group: { _id: { process: '$_id.process', model: '$_id.model' }, count: { $sum: 1 } } }
    ])
    expect(options.maxTimeMS).toBeGreaterThan(0)
  })

  it('getDeploy 는 requestId 로 찾고 없으면 null', async () => {
    const { col, repo } = fake()
    expect(await repo.getDeploy('r1')).toBeNull()
    expect(col('SCENARIO_EDITOR_DEPLOYS').findOne.mock.calls[0][0]).toEqual({ requestId: 'r1' })
  })

  it('getDeploy 는 Long 을 올리지 않고 읽는다 — 기록의 finish.performance(Int64 Contribution 등)를 그대로 다시 쓰기 때문', async () => {
    const { col, repo } = fake()
    await repo.getDeploy('r1')
    expect(col('SCENARIO_EDITOR_DEPLOYS').findOne.mock.calls[0][1]).toMatchObject({ promoteLongs: false })
  })

  it('웹 전용 DB 의 시간 초과·연결 끊김은 "웹 전용 DB" 문구(EARS DB 가 아님)', async () => {
    const { col, repo } = fake()
    col('SCENARIO_EDITOR_DEPLOYS').findOne.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'MongoServerError', code: 50 }))
    expect(await repo.getDeploy('r1').catch((e) => e)).toMatchObject({ statusCode: 504, code: 'UPSTREAM_TIMEOUT', message: '웹 전용 DB 응답이 늦습니다' })
    col('SCENARIO_EDITOR_DEPLOYS').updateOne.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'MongoNetworkError' }))
    expect(await repo.updateDeploy('r1', {}).catch((e) => e)).toMatchObject({ statusCode: 503, code: 'UPSTREAM_DOWN', message: '웹 전용 DB 에 닿지 못했습니다' })
  })
})

describe('webRepository 시험 실행 요청 기록 (P5)', () => {
  const RUNS = 'SCENARIO_EDITOR_TEST_RUNS'
  const cursor = (rows = []) => {
    const c = { sort: vi.fn(() => c), limit: vi.fn(() => c), maxTimeMS: vi.fn(() => c), toArray: vi.fn(async () => rows) }
    return c
  }
  it('인덱스: (runId, eqpId) 유일 · (eqpId, name, sentAt) · createdAt 90일 뒤 지움', async () => {
    const { col, repo } = fake()
    await repo.ensureIndexes()
    expect(col(RUNS).createIndex.mock.calls).toEqual([
      [{ runId: 1, eqpId: 1 }, { unique: true }],
      [{ eqpId: 1, name: 1, sentAt: -1 }],
      [{ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 3600 }]
    ])
  })
  it('insertTestRun: 색인을 먼저 만들고 넣는다 — 같은 실행·설비가 이미 있으면 넣지 않았다고 알린다', async () => {
    const { col, repo } = fake()
    const doc = { runId: 'run-12345678', eqpId: 'SEWT_CVD_A01', state: 'sending' }
    expect(await repo.insertTestRun(doc)).toEqual({ inserted: true })
    expect(col(RUNS).createIndex).toHaveBeenCalled()
    expect(col(RUNS).insertOne.mock.calls[0][0]).toBe(doc)
    col(RUNS).insertOne.mockRejectedValueOnce(Object.assign(new Error('E11000 duplicate key'), { code: 11000 }))
    expect(await repo.insertTestRun(doc)).toEqual({ inserted: false })
    col(RUNS).insertOne.mockRejectedValueOnce(new Error('boom'))
    await expect(repo.insertTestRun(doc)).rejects.toThrow('boom')
  })
  it('updateTestRun: 그 실행·설비의 기록만 고친다', async () => {
    const { col, repo } = fake()
    await repo.updateTestRun('run-12345678', 'SEWT_CVD_A01', { state: 'accepted', doneAt: 5 })
    const [filter, update] = col(RUNS).updateOne.mock.calls[0]
    expect(filter).toEqual({ runId: 'run-12345678', eqpId: 'SEWT_CVD_A01' })
    expect(update).toEqual({ $set: { state: 'accepted', doneAt: 5 } })
  })
  it('findTestRuns: 내 실행의 기록만(남의 runId 는 빈 목록), 설비 ID 순', async () => {
    const { col, repo } = fake()
    const c = cursor([{ eqpId: 'A' }])
    col(RUNS).find.mockReturnValueOnce(c)
    expect(await repo.findTestRuns('run-12345678', 'sew_multi')).toEqual([{ eqpId: 'A' }])
    expect(col(RUNS).find.mock.calls[0][0]).toEqual({ runId: 'run-12345678', user: 'sew_multi' })
    expect(c.sort).toHaveBeenCalledWith({ eqpId: 1 })
  })
  it('countTestRuns: 그 실행의 기록 수', async () => {
    const { col, repo } = fake()
    col(RUNS).countDocuments = vi.fn(async () => 7)
    expect(await repo.countTestRuns('run-12345678')).toBe(7)
    expect(col(RUNS).countDocuments.mock.calls[0][0]).toEqual({ runId: 'run-12345678' })
  })
  it('findRecentTestRuns: 그 시나리오로 since 뒤에 보낸(보내는 중·접수·모름) 기록을 늦은 것부터 — 누가 보냈든', async () => {
    const { col, repo } = fake()
    const c = cursor([])
    col(RUNS).find.mockReturnValue(c)
    await repo.findRecentTestRuns({ process: 'P', model: 'M', name: 'N', since: 1000 })
    expect(col(RUNS).find.mock.calls[0][0]).toEqual({ process: 'P', model: 'M', name: 'N', sentAt: { $gte: 1000 }, state: { $in: ['sending', 'accepted', 'unknown'] } })
    expect(c.sort).toHaveBeenCalledWith({ sentAt: -1 })
    await repo.findRecentTestRuns({ process: 'P', model: 'M', name: 'N', since: 1000, eqpIds: ['A'] })
    expect(col(RUNS).find.mock.calls[1][0]).toMatchObject({ eqpId: { $in: ['A'] } })
  })
})

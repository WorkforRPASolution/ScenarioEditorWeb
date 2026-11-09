import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { cleanupSewW, TEST_USERS, WEB_DB } = require('../sew-w-cleanup')

// 가짜 Mongo Db·GridFSBucket·Redis — 무엇을 지우라고 했는지만 적는다. 거르기 조건(정규식·사용자 목록)은 값으로 비교한다.
function fakeDb(name, files = {}) {
  const calls = []
  return {
    databaseName: name,
    calls,
    collection(c) {
      return {
        deleteMany: async (filter) => { calls.push({ c, op: 'deleteMany', filter }); return { deletedCount: 1 } },
        find: (filter) => ({ toArray: async () => { calls.push({ c, op: 'find', filter }); return (files[c] ?? []).map((_id) => ({ _id })) } })
      }
    }
  }
}
function fakeBucketClass(deleted) {
  return class {
    constructor(db, opts = {}) { this.db = db; this.bucketName = opts.bucketName ?? 'fs' }
    async delete(id) { deleted.push(`${this.db.databaseName}/${this.bucketName}/${id}`) }
  }
}
function fakeRedis(hashes) {
  const removed = []
  return {
    removed,
    keys: async (pattern) => { expect(pattern).toBe('SEW*-*'); return Object.keys(hashes) },
    type: async (k) => (Array.isArray(hashes[k]) ? 'hash' : 'string'),
    hkeys: async (k) => hashes[k],
    hdel: async (k, ...fields) => { removed.push([k, fields]); return fields.length }
  }
}
const src = (re) => (re instanceof RegExp ? re.source : re)

describe('cleanupSewW — 시험이 만든 SEW_W_ 시나리오와 시험 사용자의 웹 기록만 지운다', () => {
  it('EARS: SEW 공정의 SEW_W_ 운영 속성 문서·GridFS 판, Redis 해시는 SEW_W_ 필드만(시드 필드·문자열 키는 남김)', async () => {
    const db = fakeDb('EARS', { 'fs.files': ['f1', 'f2'] })
    const deleted = []
    const redis = fakeRedis({ 'SEWCVD-SEWMODELA': ['ALL_CONDITIONS.1', 'SEW_W_ABC_COPY.2', 'SEW_W_ABC_AS.3'], 'SEWETCH-SEWMODELA': ['OCR_ALL.1'], 'SEW-STRING': 'x' })
    const r = await cleanupSewW({ db, webDb: null, redis, GridFSBucket: fakeBucketClass(deleted) })

    const scp = db.calls.find((x) => x.c === 'SC_PROPERTY')
    expect(scp.op).toBe('deleteMany')
    expect(src(scp.filter.process)).toBe('^SEW')
    expect(src(scp.filter.scname)).toBe('^SEW_W_')
    const files = db.calls.find((x) => x.c === 'fs.files')
    expect(src(files.filter['metadata.process'])).toBe('^SEW')
    expect(src(files.filter['metadata.name'])).toBe('^SEW_W_')
    expect(deleted).toEqual(['EARS/fs/f1', 'EARS/fs/f2'])
    expect(redis.removed).toEqual([['SEWCVD-SEWMODELA', ['SEW_W_ABC_COPY.2', 'SEW_W_ABC_AS.3']]])
    expect(r).toMatchObject({ scProperty: 1, gridfsFiles: 2, redisFields: 2 })
  })

  it(`웹 DB(${WEB_DB}): 시험 사용자 7명의 초안·배포 기록·초안 그림`, async () => {
    const webDb = fakeDb(WEB_DB, { 'seDraftImages.files': ['i1'] })
    const deleted = []
    const r = await cleanupSewW({ db: null, webDb, redis: null, GridFSBucket: fakeBucketClass(deleted) })
    expect(TEST_USERS).toEqual(['sew_master', 'sew_cvd', 'sew_multi', 'sew_mastercvd', 'sew_spaces', 'sew_longgrade', 'sew_none'])
    expect(webDb.calls.filter((x) => x.op === 'deleteMany')).toEqual([
      { c: 'SCENARIO_EDITOR_DRAFTS', op: 'deleteMany', filter: { owner: { $in: TEST_USERS } } },
      { c: 'SCENARIO_EDITOR_DEPLOYS', op: 'deleteMany', filter: { user: { $in: TEST_USERS } } }
    ])
    expect(webDb.calls.find((x) => x.c === 'seDraftImages.files').filter).toEqual({ 'metadata.owner': { $in: TEST_USERS } })
    expect(deleted).toEqual([`${WEB_DB}/seDraftImages/i1`])
    expect(r).toMatchObject({ drafts: 1, deploys: 1, draftImages: 1 })
  })

  it('웹 DB 이름이 SE_WEB_DEV 가 아니면(예: WebManager 의 WEB_MANAGER 로 떨어짐) 아무것도 지우지 않고 던진다', async () => {
    const webDb = fakeDb('WEB_MANAGER')
    await expect(cleanupSewW({ db: null, webDb, redis: null, GridFSBucket: fakeBucketClass([]) })).rejects.toThrow(/SE_WEB_DEV/)
    expect(webDb.calls).toEqual([])
  })
})

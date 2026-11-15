import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { cleanupSewW, cleanupSewMemos, assertLocalTargets, TEST_USERS, WEB_DB } = require('../sew-w-cleanup')

// 로컬 개발 프로필(server/.env.example 과 같은 꼴)
const LOCAL = {
  MONGODB_URI: 'mongodb://localhost:27017/EARS', WEBMANAGER_DB_URI: 'mongodb://localhost:27017/SE_WEB_DEV',
  REDIS_URL: 'redis://:visuallove@localhost:6379/0', EARS_INTERFACE_URL: 'http://localhost:8080'
}

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
    const r = await cleanupSewW({ env: LOCAL, db, webDb: null, redis, GridFSBucket: fakeBucketClass(deleted) })

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
    const r = await cleanupSewW({ env: LOCAL, db: null, webDb, redis: null, GridFSBucket: fakeBucketClass(deleted) })
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
    await expect(cleanupSewW({ env: LOCAL, db: null, webDb, redis: null, GridFSBucket: fakeBucketClass([]) })).rejects.toThrow(/SE_WEB_DEV/)
    expect(webDb.calls).toEqual([])
  })
})

// 사내 프로필 .env(server/.env.inhouse.example — 운영 EARS·Redis)로 E2E·통합 시험을 돌려 사내 SEW_W_ 를 지우는 일을 막는다
describe('cleanupSewW — EARS·웹 DB·Redis·InterfaceServer 가 루프백이 아니면 아무것도 지우지 않는다', () => {
  const run = (env) => {
    const db = fakeDb('EARS', { 'fs.files': ['f1'] })
    const webDb = fakeDb(WEB_DB, { 'seDraftImages.files': ['i1'] })
    const redis = fakeRedis({ 'SEWCVD-SEWMODELA': ['SEW_W_A.1'] })
    const deleted = []
    const p = cleanupSewW({ env, db, webDb, redis, GridFSBucket: fakeBucketClass(deleted) })
    return { p, touched: () => [...db.calls, ...webDb.calls, ...redis.removed, ...deleted] }
  }
  it.each([
    ['MONGODB_URI', 'mongodb://reader:s3cret@10.20.30.40:27017/EARS'],
    ['MONGODB_URI', 'mongodb://localhost:27017,ears-db2.corp:27017/EARS?replicaSet=rs0'],
    ['MONGODB_URI', 'mongodb+srv://ears.corp.example/EARS'],
    ['WEBMANAGER_DB_URI', 'mongodb://web.corp:27017/SE_WEB_DEV'],
    ['SE_WEB_DB_URI', 'mongodb://web.corp:27017/SE_WEB_DEV'],
    ['REDIS_URL', 'redis://:s3cret@redis.corp:6379/0'],
    ['REDIS_URL', '{10.0.0.1:26379},{10.0.0.2:26379}#mymaster'],
    ['EARS_INTERFACE_URL', 'http://ears-is.corp:8080'],
    ['EARS_INTERFACE_URL', 'not a url']
  ])('%s=%s → 던지고 아무것도 지우지 않는다(비밀번호는 문구에 없다)', async (key, value) => {
    const { p, touched } = run({ ...LOCAL, [key]: value })
    const err = await p.catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toContain(key)
    expect(err.message).not.toContain('s3cret')
    expect(touched()).toEqual([])
  })
  it('env 를 받지 못하면(어디를 지우는지 모름) 던지고 아무것도 지우지 않는다', async () => {
    const { p, touched } = run(undefined)
    await expect(p).rejects.toThrow(/env/)
    expect(touched()).toEqual([])
  })
  it('루프백 꼴(localhost·127.0.0.1·::1, 계정·질의·여러 호스트·Sentinel)과 빈 값(부르는 쪽 기본값 localhost)은 통과한다', async () => {
    for (const env of [
      LOCAL,
      { MONGODB_URI: 'mongodb://u:p%40ss@127.0.0.1:27017/EARS?authSource=admin', REDIS_URL: '{127.0.0.1:26379},{localhost:26380}#m', EARS_INTERFACE_URL: 'http://[::1]:8080' },
      { MONGODB_URI: 'mongodb://[::1]:27017,localhost:27018/EARS', WEBMANAGER_DB_URI: 'mongodb://127.0.0.1/SE_WEB_DEV', REDIS_URL: 'redis://[::1]:6379', EARS_INTERFACE_URL: 'http://127.0.0.1:3197' },
      { MONGODB_URI: '', REDIS_URL: '', EARS_INTERFACE_URL: '' },
      {}
    ]) expect(() => assertLocalTargets(env), JSON.stringify(env)).not.toThrow()
    const { p, touched } = run(LOCAL)
    await p
    expect(touched().length).toBeGreaterThan(0)
  })
})

describe('cleanupSewMemos — 시험 설비(SEWT_)의 스냅샷 메모만 지운다', () => {
  it('ARS_USER_MEMO 에서 eqpid 가 SEWT_ 로 시작하는 문서만 — 컬렉션은 그대로 둔다', async () => {
    const db = fakeDb('EARS')
    expect(await cleanupSewMemos({ env: LOCAL, db })).toBe(1)
    expect(db.calls).toHaveLength(1)
    expect([db.calls[0].c, db.calls[0].op, Object.keys(db.calls[0].filter), String(db.calls[0].filter.eqpid)]).toEqual(['ARS_USER_MEMO', 'deleteMany', ['eqpid'], '/^SEWT_/'])
  })
  it('EARS 가 루프백이 아니거나 env 를 받지 못하면 아무것도 지우지 않고 던진다', async () => {
    const db = fakeDb('EARS')
    await expect(cleanupSewMemos({ env: { ...LOCAL, MONGODB_URI: 'mongodb://ears-prod.example:27017/EARS' }, db })).rejects.toThrow(/루프백/)
    await expect(cleanupSewMemos({ db })).rejects.toThrow()
    expect(db.calls).toEqual([])
  })
})

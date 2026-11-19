import { describe, it, expect } from 'vitest'
import { createGridfsRepository } from '../repo/gridfsRepo'

// fs.files 질의를 기록하고 정해 둔 결과를 차례로 돌려주는 대역
function fakeFiles(...answers) {
  const calls = []
  const db = {
    collection: (name) => ({
      find: (filter, options) => {
        const call = { name, filter, options }
        calls.push(call)
        const cursor = {
          sort(sort) { call.sort = sort; return cursor },
          limit(limit) { call.limit = limit; return cursor },
          maxTimeMS() { return cursor },
          toArray: async () => answers.shift() ?? []
        }
        return cursor
      }
    })
  }
  return { calls, repo: createGridfsRepository(() => db, {}) }
}

const VERSION = { 'metadata.process': 'P', 'metadata.model': 'M', 'metadata.name': 'N', 'metadata.crtime': 17 }

describe('findVersionId', () => {
  it('파일 이름으로 찾아 기본 인덱스를 타고, 본문이 든 metadata 는 읽지 않으며, 가장 늦게 올린 파일을 고른다', async () => {
    const { repo, calls } = fakeFiles([{ _id: 'latest' }])
    expect(await repo.findVersionId('P', 'M', 'N', 17)).toBe('latest')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ name: 'fs.files', filter: { filename: 'P.M.N.17', ...VERSION }, options: { projection: { _id: 1 } }, sort: { uploadDate: -1 }, limit: 1 })
  })
  it('이름이 규칙과 다른 파일은 메타데이터만으로 다시 찾는다(이때도 본문을 읽지 않는다)', async () => {
    const { repo, calls } = fakeFiles([], [{ _id: 'odd-name' }])
    expect(await repo.findVersionId('P', 'M', 'N', 17)).toBe('odd-name')
    expect(calls).toHaveLength(2)
    expect(calls[1].filter).toEqual(VERSION)
    expect(calls[1]).toMatchObject({ options: { projection: { _id: 1 } }, sort: { uploadDate: -1 }, limit: 1 })
  })
  it('둘 다 없으면 null', async () => {
    expect(await fakeFiles([], []).repo.findVersionId('P', 'M', 'N', 17)).toBe(null)
  })
})

describe('findFileMeta', () => {
  it('본문(metadata.body)을 빼고 정체성 필드만 projection 으로 읽는다', async () => {
    const calls = []
    const db = { collection: () => ({ findOne: async (filter, options) => { calls.push({ filter, options }); return { _id: 'f', length: 3, metadata: { process: 'P' } } } }) }
    const repo = createGridfsRepository(() => db, {})
    expect(await repo.findFileMeta('f')).toEqual({ _id: 'f', length: 3, metadata: { process: 'P' } })
    expect(calls[0].filter).toEqual({ _id: 'f' })
    expect(calls[0].options.projection).toEqual({ length: 1, 'metadata.process': 1, 'metadata.model': 1, 'metadata.name': 1, 'metadata.crtime': 1 })
    expect(JSON.stringify(calls[0].options.projection)).not.toContain('body')
  })
})

describe('streamContent', () => {
  // openDownloadStream 과, 읽기가 어긋났을 때 파일이 아직 있는지 보는 fs.files findOne 을 흉내 낸다(exists = 그 파일 문서가 있는가)
  function repoReading(body, { exists = true } = {}) {
    const seen = { findOne: [] }
    const mongo = { GridFSBucket: class { openDownloadStream(id, options) { seen.id = id; seen.options = options; return body() } } }
    const db = { collection: (name) => ({ findOne: async (filter, options) => { seen.findOne.push({ name, filter, options }); if (exists instanceof Error) throw exists; return exists ? { _id: filter._id } : null } }) }
    return { seen, repo: createGridfsRepository(() => db, mongo) }
  }
  const read = async (it) => { const out = []; for await (const c of it) out.push(c.toString()); return out.join('') }
  const chunks = (...parts) => async function* () { yield* parts.map((p) => Buffer.from(p)) }

  it('파일 길이만큼 읽으면 조각을 그대로 흘려 주고, 읽기 시간 제한을 건다(세마포어를 무한정 쥐지 않게)', async () => {
    const { repo, seen } = repoReading(chunks('ab', 'c'))
    expect(await read(repo.streamContent({ _id: 'f', length: 3 }))).toBe('abc')
    expect(seen.id).toBe('f')
    expect(seen.options.timeoutMS).toBeGreaterThan(0)
  })
  it('길이 0 파일은 정상이다(빈 BI)', async () => {
    expect(await read(repoReading(chunks()).repo.streamContent({ _id: 'f', length: 0 }))).toBe('')
  })
  it.each([[3, ['ab']], [3, []]])('드라이버가 오류 없이 일찍 끝나면(길이 %i, 받은 조각 %j) 422 FILE_DAMAGED', async (length, parts) => {
    const it = repoReading(chunks(...parts)).repo.streamContent({ _id: 'f', length })
    await expect(read(it)).rejects.toMatchObject({ statusCode: 422, code: 'FILE_DAMAGED' })
  })
  it.each([[3, ['ab']], [3, []]])('일찍 끝났는데 그 파일 문서가 이제 없으면 읽는 동안 지워진 것 — 404 NOT_FOUND(길이 %i, 받은 조각 %j, SEW-006)', async (length, parts) => {
    const { repo, seen } = repoReading(chunks(...parts), { exists: false })
    await expect(read(repo.streamContent({ _id: 'f', length }))).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' })
    expect(seen.findOne).toEqual([{ name: 'fs.files', filter: { _id: 'f' }, options: expect.objectContaining({ projection: { _id: 1 } }) }])
  })
  it('조각 오류(MongoGridFSChunkError)도 파일 문서가 없으면 404, 있으면 422 FILE_DAMAGED', async () => {
    const body = async function* () { yield Buffer.from('a'); throw Object.assign(new Error('ChunkIsMissing'), { name: 'MongoGridFSChunkError' }) }
    await expect(read(repoReading(body, { exists: false }).repo.streamContent({ _id: 'f', length: 9 }))).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' })
    await expect(read(repoReading(body).repo.streamContent({ _id: 'f', length: 9 }))).rejects.toMatchObject({ statusCode: 422, code: 'FILE_DAMAGED' })
  })
  it('파일이 있는지 보다가 실패하면 원래 판단(422 FILE_DAMAGED)을 그대로 준다', async () => {
    const it = repoReading(chunks('ab'), { exists: new Error('connection closed') }).repo.streamContent({ _id: 'f', length: 3 })
    await expect(read(it)).rejects.toMatchObject({ statusCode: 422, code: 'FILE_DAMAGED' })
  })
  it('정상으로 다 읽었거나 시간 제한이면 파일을 다시 보지 않는다', async () => {
    const ok = repoReading(chunks('abc'))
    await read(ok.repo.streamContent({ _id: 'f', length: 3 }))
    expect(ok.seen.findOne).toEqual([])
  })
  it('읽기 시간 제한을 넘기면 504 UPSTREAM_TIMEOUT', async () => {
    const body = async function* () { yield Buffer.from('a'); throw Object.assign(new Error('Download timed out'), { name: 'MongoOperationTimeoutError' }) }
    await expect(read(repoReading(body).repo.streamContent({ _id: 'f', length: 9 }))).rejects.toMatchObject({ statusCode: 504, code: 'UPSTREAM_TIMEOUT' })
  })
})

// 불러오기 목록의 스텝 수·용량(2026-11-10). 운영 Mongo 는 4.2.6 — $bsonSize(4.4~)를 쓰지 않는다.
describe('findVersionStats', () => {
  function fakeAggregate(docs) {
    const calls = []
    const db = { collection: (name) => ({ aggregate: (pipeline, options) => { calls.push({ name, pipeline, options }); return { toArray: async () => docs } } }) }
    return { calls, repo: createGridfsRepository(() => db, {}) }
  }
  it('현재 판 파일을 파일 이름으로 찾고(기본 인덱스), 본문은 가져오지 않고 Mongo 안에서 스텝 수만 센다', async () => {
    const { repo, calls } = fakeAggregate([{ filename: 'P.M.A.200', uploadDate: new Date(1), length: 1000, steps: 18 }, { filename: 'P.M.B.50', uploadDate: new Date(1), length: 0, steps: null }])
    const out = await repo.findVersionStats('P', 'M', [{ name: 'A', crtime: 200 }, { name: 'B', crtime: 50 }, { name: 'C', crtime: 7 }])
    expect([...out]).toEqual([['A', { stepCount: 18, sizeBytes: 1000 }], ['B', { stepCount: null, sizeBytes: 0 }]])
    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe('fs.files')
    expect(calls[0].options.maxTimeMS).toBeGreaterThan(0)
    const [match, project] = calls[0].pipeline
    expect(match).toEqual({ $match: { filename: { $in: ['P.M.A.200', 'P.M.B.50', 'P.M.C.7'] }, 'metadata.process': 'P', 'metadata.model': 'M' } })
    expect(project).toEqual({ $project: { _id: 0, filename: 1, uploadDate: 1, length: 1, steps: { $cond: [{ $isArray: ['$metadata.body.Step'] }, { $size: '$metadata.body.Step' }, null] } } })
    expect(JSON.stringify(calls[0].pipeline)).not.toContain('$bsonSize')
  })
  it('같은 판이 다시 올라와 파일이 둘이면 가장 늦게 올린 파일의 값이다(열기와 같다)', async () => {
    const { repo } = fakeAggregate([{ filename: 'P.M.A.200', uploadDate: new Date(5), length: 10, steps: 2 }, { filename: 'P.M.A.200', uploadDate: new Date(9), length: 30, steps: 3 }, { filename: 'P.M.A.200', uploadDate: new Date(7), length: 20, steps: 1 }])
    expect((await repo.findVersionStats('P', 'M', [{ name: 'A', crtime: 200 }])).get('A')).toEqual({ stepCount: 3, sizeBytes: 30 })
  })
  it('물을 판이 없으면 질의하지 않는다', async () => {
    const { repo, calls } = fakeAggregate([])
    expect((await repo.findVersionStats('P', 'M', [])).size).toBe(0)
    expect(calls).toHaveLength(0)
  })
})

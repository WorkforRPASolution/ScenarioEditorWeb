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

describe('streamContent', () => {
  // openDownloadStream 만 흉내 낸다
  function repoReading(body) {
    const seen = {}
    const mongo = { GridFSBucket: class { openDownloadStream(id, options) { seen.id = id; seen.options = options; return body() } } }
    return { seen, repo: createGridfsRepository(() => ({}), mongo) }
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
  it('읽기 시간 제한을 넘기면 504 UPSTREAM_TIMEOUT', async () => {
    const body = async function* () { yield Buffer.from('a'); throw Object.assign(new Error('Download timed out'), { name: 'MongoOperationTimeoutError' }) }
    await expect(read(repoReading(body).repo.streamContent({ _id: 'f', length: 9 }))).rejects.toMatchObject({ statusCode: 504, code: 'UPSTREAM_TIMEOUT' })
  })
})

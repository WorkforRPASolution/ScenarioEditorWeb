import { describe, it, expect } from 'vitest'
import { withMongoErrors } from '../errors'

const fail = (name, extra = {}) => async () => { throw Object.assign(new Error('내부 주소 10.0.0.1:27017'), { name, ...extra }) }

describe('withMongoErrors', () => {
  it('연결 계열 오류는 503 UPSTREAM_DOWN, 문구에 내부 주소를 싣지 않는다', async () => {
    for (const name of ['MongoNetworkError', 'MongoNetworkTimeoutError', 'MongoServerSelectionError', 'MongoNotConnectedError', 'MongoTopologyClosedError']) {
      const err = await withMongoErrors({ find: fail(name) }).find().catch((e) => e)
      expect(err).toMatchObject({ statusCode: 503, code: 'UPSTREAM_DOWN' })
      expect(err.message).not.toContain('10.0.0.1')
    }
  })
  it('질의 시간 초과(code 50)는 504 UPSTREAM_TIMEOUT', async () => {
    await expect(withMongoErrors({ find: fail('MongoServerError', { code: 50 }) }).find()).rejects.toMatchObject({ statusCode: 504, code: 'UPSTREAM_TIMEOUT' })
  })
  it('그 밖 오류와 이미 code 가 붙은 오류는 그대로, 성공 값도 그대로', async () => {
    await expect(withMongoErrors({ find: fail('TypeError') }).find()).rejects.toMatchObject({ name: 'TypeError' })
    const coded = Object.assign(new Error('x'), { statusCode: 503, code: 'UPSTREAM_DOWN' })
    await expect(withMongoErrors({ find: async () => { throw coded } }).find()).rejects.toBe(coded)
    expect(await withMongoErrors({ find: async (a, b) => a + b }).find(1, 2)).toBe(3)
  })
})

import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { emptyBiVersion } = require('../lib/anomaly')

// 빈 BI 파일의 uploadDate 가 같은 판의 다른 파일(InterfaceServer 가 올린 정상 파일)보다 반드시 늦어야 한다.
function fakeCtx(otherDate, ownDate) {
  const updates = []
  const finds = []
  const bucket = {
    openUploadStream: () => {
      const handlers = {}
      const s = {
        id: 'own',
        on: (e, f) => { handlers[e] = f; return s },
        end: () => setImmediate(() => handlers.finish && handlers.finish())
      }
      return s
    }
  }
  const db = {
    collection: () => ({
      find: (filter) => {
        finds.push(filter)
        return { sort: () => ({ limit: () => ({ toArray: async () => (otherDate ? [{ _id: 'other', uploadDate: otherDate }] : []) }) }) }
      },
      findOne: async () => ({ _id: 'own', uploadDate: ownDate }),
      updateOne: async (filter, update) => { updates.push({ filter, update }) }
    })
  }
  return { ctx: { db, bucket }, updates, finds }
}
const args = { process: 'SEWCVD', model: 'M', name: 'N', body: '{}', crtime: 1730000000000 }

describe('emptyBiVersion', () => {
  it('다른 파일보다 1ms 이르면 최대값 + 1ms 로 올린다', async () => {
    const { ctx, updates, finds } = fakeCtx(new Date(1000), new Date(999))
    await emptyBiVersion(ctx, args)
    expect(updates).toEqual([{ filter: { _id: 'own' }, update: { $set: { uploadDate: new Date(1001) } } }])
    expect(finds[0]).toMatchObject({ 'metadata.process': 'SEWCVD', 'metadata.model': 'M', 'metadata.name': 'N', _id: { $ne: 'own' } })
  })
  it('같은 밀리초여도 올린다', async () => {
    const { ctx, updates } = fakeCtx(new Date(1000), new Date(1000))
    await emptyBiVersion(ctx, args)
    expect(updates[0].update.$set.uploadDate).toEqual(new Date(1001))
  })
  it('이미 더 늦으면 건드리지 않는다', async () => {
    const { ctx, updates } = fakeCtx(new Date(1000), new Date(1005))
    await emptyBiVersion(ctx, args)
    expect(updates).toEqual([])
  })
  it('다른 파일이 없으면 건드리지 않는다', async () => {
    const { ctx, updates } = fakeCtx(null, new Date(1000))
    await emptyBiVersion(ctx, args)
    expect(updates).toEqual([])
  })
})

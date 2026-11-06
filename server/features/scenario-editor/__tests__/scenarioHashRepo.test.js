import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { createScenarioHashRepository } = require('../repo/scenarioHashRepo')

describe('scenarioHashRepo.hget', () => {
  it('값을 돌려주고 없으면 null', async () => {
    const r = { hget: async (k, f) => (f === 'x' ? `${k}:v` : null) }
    const repo = createScenarioHashRepository(() => r)
    expect(await repo.hget('P-M', 'x')).toBe('P-M:v')
    expect(await repo.hget('P-M', 'y')).toBeNull()
  })
  it('연결이 없으면 503 UPSTREAM_DOWN', async () => {
    const repo = createScenarioHashRepository(() => null)
    await expect(repo.hget('P-M', 'x')).rejects.toMatchObject({ statusCode: 503, code: 'UPSTREAM_DOWN' })
  })
  it('Redis 오류는 503 UPSTREAM_DOWN', async () => {
    const repo = createScenarioHashRepository(() => ({ hget: async () => { throw new Error('boom') } }))
    await expect(repo.hget('P-M', 'x')).rejects.toMatchObject({ statusCode: 503, code: 'UPSTREAM_DOWN' })
  })
})

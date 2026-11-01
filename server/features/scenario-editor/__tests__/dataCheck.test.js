import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDataCheckService } from '../service/dataCheckService'
const require = createRequire(import.meta.url)

describe('dataCheckService (Q-089: 중복은 견디고 표시)', () => {
  it('사용자 범위 안의 중복·무효를 모은다', async () => {
    let asked
    const repo = { findDuplicateKeys: async (pairs) => { asked = pairs; return [{ process: 'CVD', model: 'M1', name: 'X', count: 2 }] } }
    const scopes = { scopeFor: async () => ({ pairs: [{ process: 'CVD', models: [{ model: 'M1', eqpCount: 1 }, { model: 'M2', eqpCount: 1 }] }],
      duplicateEqpIds: ['D'], invalid: [{ eqpId: 'I', reason: 'REQUIRED_EMPTY' }], proxyIpDuplicates: [{ eqpId: 'P2', sameAs: 'P1' }] }) }
    const r = await createDataCheckService({ repo, scopes }).check({ singleid: 'u', duplicateUserDocs: 2 })
    expect(asked).toEqual([{ process: 'CVD', model: 'M1' }, { process: 'CVD', model: 'M2' }])
    expect(r).toEqual({
      duplicateUsers: [{ singleid: 'u', count: 2 }], duplicateEqpIds: ['D'], invalidEquipment: [{ eqpId: 'I', reason: 'REQUIRED_EMPTY' }],
      proxyIpDuplicates: [{ eqpId: 'P2', sameAs: 'P1' }], duplicateProperties: [{ process: 'CVD', model: 'M1', name: 'X', count: 2 }]
    })
  })
  it('사용자 문서가 하나면 duplicateUsers 는 빈 배열', async () => {
    const r = await createDataCheckService({ repo: { findDuplicateKeys: async () => [] },
      scopes: { scopeFor: async () => ({ pairs: [], duplicateEqpIds: [], invalid: [], proxyIpDuplicates: [] }) } }).check({ singleid: 'u', duplicateUserDocs: 1 })
    expect(r.duplicateUsers).toEqual([])
  })
})

describe('deps 배선', () => {
  it('build 는 dataCheck 를 단다', () => {
    const { build } = require('../deps')
    const out = build({ IMAGE_CACHE_DIR: mkdtempSync(join(tmpdir(), 'sew-build-')) })
    expect(typeof out.dataCheck.check).toBe('function')
  })
})

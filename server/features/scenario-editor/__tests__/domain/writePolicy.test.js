import { describe, it, expect } from 'vitest'
import { writeDenial, reviewDenial, memoDenial, copiesPerformanceToNewTarget } from '../../domain/writePolicy'
import { requireWrite, requireReviewer, requireMemoWrite } from '../../controller'

describe('writePolicy', () => {
  it('비루프백이면 먼저 WRITE_DISABLED', () => {
    expect(writeDenial({ canWrite: true }, { writeDisabled: true }).code).toBe('WRITE_DISABLED')
    expect(writeDenial({ canWrite: false }, { writeDisabled: true }).code).toBe('WRITE_DISABLED')
    expect(writeDenial({ canWrite: false }, { writeDisabled: false })).toMatchObject({ status: 403, code: 'WRITE_FORBIDDEN' })
    expect(writeDenial({ canWrite: true }, { writeDisabled: false })).toBe(null)
  })
  it('심의는 관리 등급 1·2, WRITE 와 무관', () => {
    expect(reviewDenial({ canWrite: false, authorityManager: 2 }, { writeDisabled: false })).toBe(null)
    expect(reviewDenial({ canWrite: false, authorityManager: 1 }, { writeDisabled: false })).toBe(null)
    expect(reviewDenial({ canWrite: true, authorityManager: 3 }, { writeDisabled: false })).toMatchObject({ status: 403, code: 'GRADE_FORBIDDEN' })
    expect(reviewDenial({ canWrite: true, authorityManager: 0 }, { writeDisabled: false }).code).toBe('GRADE_FORBIDDEN')
    expect(reviewDenial({ canWrite: true }, { writeDisabled: false }).code).toBe('GRADE_FORBIDDEN')
    expect(reviewDenial({ canWrite: true, authorityManager: 1 }, { writeDisabled: true }).code).toBe('WRITE_DISABLED')
  })
  it('메모는 WRITE·등급을 보지 않는다 — 서버가 쓰기를 받지 않을 때만 막는다', () => {
    expect(memoDenial({ canWrite: false, authorityManager: 0 }, { writeDisabled: false })).toBe(null)
    expect(memoDenial({ canWrite: true }, { writeDisabled: true })).toMatchObject({ status: 403, code: 'WRITE_DISABLED' })
  })
  it('새 대상 성과 복사', () => {
    expect([0, 1, 2, 3].map((a) => copiesPerformanceToNewTarget({ authorityManager: a }))).toEqual([false, true, true, false])
  })
})

const run = (mw, seUser, locals = {}) => {
  const next = (e) => { next.err = e; next.called = true }
  mw({ seUser, app: { locals } }, {}, next)
  return next
}

describe('requireWrite·requireReviewer', () => {
  it('seWriteDisabled === true 면 403 WRITE_DISABLED', () => {
    for (const mw of [requireWrite, requireReviewer]) {
      const n = run(mw, { canWrite: true, authorityManager: 1 }, { seWriteDisabled: true })
      expect(n.err).toMatchObject({ statusCode: 403, code: 'WRITE_DISABLED' })
    }
  })
  it('값이 없거나 false 면 WRITE·등급만 본다', () => {
    expect(run(requireWrite, { canWrite: true }).err).toBeUndefined()
    expect(run(requireWrite, { canWrite: true }, { seWriteDisabled: false }).called).toBe(true)
    expect(run(requireWrite, { canWrite: false }).err).toMatchObject({ statusCode: 403, code: 'WRITE_FORBIDDEN' })
    expect(run(requireReviewer, { canWrite: false, authorityManager: 2 }).err).toBeUndefined()
    expect(run(requireReviewer, { canWrite: true, authorityManager: 3 }).err).toMatchObject({ statusCode: 403, code: 'GRADE_FORBIDDEN' })
  })
})

describe('requireMemoWrite', () => {
  it('seWriteDisabled 일 때만 403, 아니면 WRITE 가 없어도 지나간다', () => {
    expect(run(requireMemoWrite, { canWrite: false }, { seWriteDisabled: true }).err).toMatchObject({ statusCode: 403, code: 'WRITE_DISABLED' })
    const n = run(requireMemoWrite, { canWrite: false })
    expect([n.called, n.err]).toEqual([true, undefined])
  })
})

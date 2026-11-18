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

describe('testRunDenial — 시험 실행의 문(P5 설계 §5.2)', () => {
  const { testRunDenial } = require('../../domain/writePolicy')
  const USER = { canWrite: true, duplicateUserDocs: 1 }
  const OPEN = { writeDisabled: false, enabled: true, devOverride: false, earsLoopback: true }
  const code = (user, flags) => testRunDenial({ ...USER, ...user }, { ...OPEN, ...flags })?.code ?? null

  it('WRITE 사용자·켜 둔 서버면 통과', () => {
    expect(testRunDenial(USER, OPEN)).toBeNull()
  })
  it('막는 것마다 403 과 code', () => {
    expect(testRunDenial({ ...USER, duplicateUserDocs: 2 }, OPEN)).toMatchObject({ status: 403, code: 'TEST_RUN_USER_AMBIGUOUS' })
    expect(testRunDenial(USER, { ...OPEN, enabled: false })).toMatchObject({ status: 403, code: 'TEST_RUN_DISABLED' })
    expect(testRunDenial(USER, { ...OPEN, writeDisabled: true })).toMatchObject({ status: 403, code: 'WRITE_DISABLED' })
    expect(testRunDenial(USER, { ...OPEN, devOverride: true, earsLoopback: false })).toMatchObject({ status: 403, code: 'TEST_RUN_DEV_USER' })
    expect(testRunDenial({ ...USER, canWrite: false }, OPEN)).toMatchObject({ status: 403, code: 'WRITE_FORBIDDEN' })
  })
  it('사용자 바꾸기는 EARS 가 루프백이면 막지 않는다(로컬 개발·E2E)', () => {
    expect(code({}, { devOverride: true, earsLoopback: true })).toBeNull()
    expect(code({}, { devOverride: false, earsLoopback: false })).toBeNull()
  })
  it('순서: 같은 아이디 여럿 → 꺼 둠 → 읽기 전용 서버 → 사용자 바꾸기 → WRITE 없음', () => {
    const all = { writeDisabled: true, enabled: false, devOverride: true, earsLoopback: false }
    expect(code({ canWrite: false, duplicateUserDocs: 3 }, all)).toBe('TEST_RUN_USER_AMBIGUOUS')
    expect(code({ canWrite: false }, all)).toBe('TEST_RUN_DISABLED')
    expect(code({ canWrite: false }, { ...all, enabled: true })).toBe('WRITE_DISABLED')
    expect(code({ canWrite: false }, { ...all, enabled: true, writeDisabled: false })).toBe('TEST_RUN_DEV_USER')
    expect(code({ canWrite: false }, { ...all, enabled: true, writeDisabled: false, earsLoopback: true })).toBe('WRITE_FORBIDDEN')
  })
})

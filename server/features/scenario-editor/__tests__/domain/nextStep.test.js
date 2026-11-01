import { describe, it, expect } from 'vitest'
import { toTarget } from '../../domain/nextStep'

const uids = ['s0', 's1', 's2']
describe('toTarget', () => {
  it.each([
    [-1, { kind: 'end', value: 'FAIL' }],
    [10000, { kind: 'end', value: 'SUCCESS' }],
    [10001, { kind: 'end', value: 'SKIP' }],
    [10002, { kind: 'next' }],
    [0, { kind: 'step', uid: 's0', no: 1 }],
    [2, { kind: 'step', uid: 's2', no: 3 }],
    [3, { kind: 'raw', value: 3 }],
    [-2, { kind: 'raw', value: -2 }],
    [10003, { kind: 'raw', value: 10003 }]
  ])('%s', (v, t) => expect(toTarget(v, uids)).toEqual(t))
})

describe('toTarget: 잘못된 uids 에도 예외가 없다', () => {
  it.each([undefined, null, 'abc', {}, 5])('uids=%s → 번호로 못 푸는 값은 raw, 끝/다음은 그대로', (bad) => {
    expect(() => toTarget(0, bad)).not.toThrow()
    expect(toTarget(0, bad)).toEqual({ kind: 'raw', value: 0 })
    expect(toTarget(-1, bad)).toEqual({ kind: 'end', value: 'FAIL' })
    expect(toTarget(10002, bad)).toEqual({ kind: 'next' })
  })
})

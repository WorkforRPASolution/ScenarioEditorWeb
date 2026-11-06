import { describe, it, expect } from 'vitest'
import { toTarget, fromTarget } from '../../domain/nextStep'

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

describe('fromTarget', () => {
  const idx = new Map([['a', 0], ['b', 1], ['c', 2]])
  it.each([
    [{ kind: 'end', value: 'FAIL' }, -1],
    [{ kind: 'end', value: 'SUCCESS' }, 10000],
    [{ kind: 'end', value: 'SKIP' }, 10001],
    [{ kind: 'next' }, 10002],
    [{ kind: 'step', uid: 'a' }, 0],
    [{ kind: 'step', uid: 'c' }, 2],
    [{ kind: 'raw', value: -2 }, -2], // 범위 밖 저장값은 그대로(검사가 막는다)
    [{ kind: 'raw', value: 9999 }, 9999]
  ])('%j → %s', (t, v) => expect(fromTarget(t, idx)).toBe(v))
  it('toTarget 으로 푼 값을 같은 번호로 되돌린다', () => {
    const uids = ['a', 'b', 'c']
    for (const v of [-1, 10000, 10001, 10002, 0, 1, 2, 3, -2, 10003]) expect(fromTarget(toTarget(v, uids), idx)).toBe(v)
  })
  it.each([
    [{ kind: 'unresolved' }],
    [{ kind: 'unresolved', value: 7 }],
    [{ kind: 'step', uid: 'zz' }],
    [{ kind: 'end', value: 'STOP' }],
    [{ kind: 'jump' }],
    [null],
    [undefined]
  ])('풀 수 없는 대상 %j 은 UNRESOLVED_TARGET', (t) => {
    expect(() => fromTarget(t, idx)).toThrow('UNRESOLVED_TARGET')
  })
})

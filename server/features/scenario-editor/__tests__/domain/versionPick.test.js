import { describe, it, expect } from 'vitest'
import { parseField, currentVersions, pickCurrent, uniqueDesc } from '../../domain/versionPick'

describe('versionPick (Q-010 ③④)', () => {
  it('마지막 . 기준으로 나눈다', () => {
    expect(parseField('ALARM.1730000000000')).toEqual({ name: 'ALARM', crtime: 1730000000000 })
    expect(parseField('A.B.1730000000000')).toEqual({ name: 'A.B', crtime: 1730000000000 })
    expect(parseField('NODOT')).toBe(null)
    expect(parseField('X.abc')).toBe(null)
    expect(parseField('.1730000000000')).toBe(null)
  })
  it('이름 정확 일치 — ABC 를 고를 때 ABC_2 를 섞지 않는다', () => {
    const f = ['ABC_2.1730000000300', 'ABC.1730000000100', 'ABC.1730000000200', 'NODOT']
    expect(pickCurrent(f, 'ABC')).toBe(1730000000200)
    expect(pickCurrent(f, 'ABC_2')).toBe(1730000000300)
    expect(pickCurrent(f, 'AB')).toBe(null)
    expect(Object.fromEntries(currentVersions(f))).toEqual({ ABC_2: 1730000000300, ABC: 1730000000200 })
  })
  it('버전 목록: 숫자·문자열·Long, 내림차순, 중복 한 번', () => {
    const long = { toNumber: () => 1730000000100, _bsontype: 'Long' }
    expect(uniqueDesc([1730000000100, '1730000000300', long, 1730000000300])).toEqual([1730000000300, 1730000000100])
  })
})

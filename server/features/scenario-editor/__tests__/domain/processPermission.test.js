import { describe, it, expect } from 'vitest'
import { parseUser, allowsProcess } from '../../domain/processPermission'

describe('parseUser (사내 MongoQuery.cs:294-319)', () => {
  it('단일 공정·WRITE', () => {
    const u = parseUser({ singleid: 'u', name: '사용자', process: 'CVD', authority: 'WRITE', authorityManager: 3 })
    expect(u).toMatchObject({ processRaw: 'CVD', processes: ['CVD'], multiProcess: null, process: 'CVD', isMaster: false, canWrite: true, authorityManager: 3, authorityName: 'Manager' })
  })
  it('여러 공정은 Split(";") 그대로(빈 토큰·공백 유지), 첫 토큰이 Process', () => {
    const u = parseUser({ singleid: 'u', process: 'CVD; ETCH;', authority: '' })
    expect(u.multiProcess).toEqual(['CVD', ' ETCH', ''])
    expect(u.process).toBe('CVD')
    expect(u.canWrite).toBe(false)
  })
  it('MASTER 판정은 첫 토큰·대소문자 구분', () => {
    expect(parseUser({ singleid: 'u', process: 'MASTER;CVD' }).isMaster).toBe(true)
    expect(parseUser({ singleid: 'u', process: 'master' }).isMaster).toBe(false)
  })
  it('authority 는 정확히 "WRITE" 만', () => {
    expect(parseUser({ singleid: 'u', process: 'A', authority: 'write' }).canWrite).toBe(false)
    expect(parseUser({ singleid: 'u', process: 'A' }).canWrite).toBe(false)
  })
  it('authorityManager: Int64·숫자 문자열·없음·이상한 값', () => {
    const long = { toNumber: () => 2, _bsontype: 'Long' }
    expect(parseUser({ singleid: 'u', process: 'A', authorityManager: long }).authorityManager).toBe(2)
    expect(parseUser({ singleid: 'u', process: 'A', authorityManager: '1' }).authorityName).toBe('Administrator')
    expect(parseUser({ singleid: 'u', process: 'A' })).toMatchObject({ authorityManager: 0, authorityManagerValid: true })
    expect(parseUser({ singleid: 'u', process: 'A', authorityManager: 'x' })).toMatchObject({ authorityManager: 0, authorityManagerValid: false })
    expect(parseUser({ singleid: 'u', process: 'A', authorityManager: 7 }).authorityName).toBe('7')
  })
  it('process 가 없으면 공정 없음', () => {
    expect(parseUser({ singleid: 'u' })).toMatchObject({ processRaw: null, processes: [], process: '', isMaster: false })
  })
  it('저장 값이 이상해도 예외 없이 값 없음·무효로 낮춘다', () => {
    expect(parseUser(null)).toMatchObject({ processRaw: null, processes: [], canWrite: false, authorityManager: 0, authorityManagerValid: true })
    expect(parseUser({ singleid: 'u', process: 5 })).toMatchObject({ processRaw: null, processes: [] })
    expect(parseUser({ singleid: 'u', authorityManager: 1.5 })).toMatchObject({ authorityManager: 0, authorityManagerValid: false })
    expect(parseUser({ singleid: 'u', authorityManager: null })).toMatchObject({ authorityManager: 0, authorityManagerValid: false })
    const bad = { toNumber: () => { throw new Error('boom') } }
    expect(parseUser({ singleid: 'u', authorityManager: bad })).toMatchObject({ authorityManager: 0, authorityManagerValid: false })
  })
})

describe('allowsProcess (사내 MongoQuery.cs:367-385)', () => {
  const p = (process) => parseUser({ singleid: 'u', process })
  it('단일·MASTER·여러 공정', () => {
    expect(allowsProcess(p('CVD'), 'CVD')).toBe(true)
    expect(allowsProcess(p('CVD'), 'ETCH')).toBe(false)
    expect(allowsProcess(p('MASTER'), 'ANY')).toBe(true)
    expect(allowsProcess(p('CVD;ETCH'), 'ETCH')).toBe(true)
  })
  it('"MASTER;CVD" 는 공정 값이 MASTER·CVD 인 설비만(전체 아님)', () => {
    expect(allowsProcess(p('MASTER;CVD'), 'CVD')).toBe(true)
    expect(allowsProcess(p('MASTER;CVD'), 'ETCH')).toBe(false)
  })
  it('공백은 지우지 않는다: "CVD; ETCH" 는 ETCH 를 못 본다', () => {
    expect(allowsProcess(p('CVD; ETCH'), 'ETCH')).toBe(false)
  })
  it('process 가 없으면 아무것도 못 본다', () => {
    expect(allowsProcess(parseUser({ singleid: 'u' }), '')).toBe(false)
  })
})

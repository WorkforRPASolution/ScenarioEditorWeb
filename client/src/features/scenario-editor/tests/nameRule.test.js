import { describe, it, expect } from 'vitest'
import { nameRuleOf, checkName, buildName, NAME_MAX, FREE_HEAD } from '../editor/nameRule'

const rule = (groupLevel, name, description = '') => ({ groupLevel, name, description })
const fifty = 'A'.repeat(50)

describe('nameRuleOf — 서버 GET /name-rule { exists, rules } → 대·중분류 목록, 규칙이 없으면 null(직접 입력)', () => {
  it.each([
    ['컬렉션이 없음', { exists: false, rules: [] }],
    ['컬렉션이 있는데 비어 있음', { exists: true, rules: [] }],
    ['대분류만 있음(중분류를 고를 수 없다)', { exists: true, rules: [rule(1, 'ALARM')] }],
    ['중분류만 있음', { exists: true, rules: [rule(2, 'RESET')] }],
    ['응답 없음', undefined]
  ])('%s → null', (_, res) => {
    expect(nameRuleOf(res)).toBe(null)
  })
  it('groupLevel 1 = 대분류, 2 = 중분류(숫자·문자 모두), 이름 오름차순, 그 밖의 단계·이름 없는 문서는 버린다', () => {
    const r = nameRuleOf({ exists: true, rules: [rule(1, 'PM', 'PM 작업'), rule('1', 'ALARM', '알람'), rule(2, 'RESET'), rule('2', 'CHECK'), rule(3, 'X'), rule(1, ''), { groupLevel: 2 }, null] })
    expect(r).toEqual({
      major: [{ name: 'ALARM', description: '알람' }, { name: 'PM', description: 'PM 작업' }],
      middle: [{ name: 'CHECK', description: '' }, { name: 'RESET', description: '' }]
    })
  })
})

describe('checkName — 직접 입력(서버 NAME_* 와 같은 code)', () => {
  it.each([
    ['', 'NAME_EMPTY', undefined],
    ['A'.repeat(51), 'NAME_TOO_LONG', { max: NAME_MAX }],
    ['ALARM-E1234', 'NAME_CHARS', undefined],
    ['알람', 'NAME_CHARS', undefined],
    ['A B', 'NAME_CHARS', undefined],
    ['A'.repeat(51) + '-', 'NAME_TOO_LONG', { max: NAME_MAX }]
  ])('%j → %s', (name, code, params) => {
    const e = checkName(name)
    expect(e.code).toBe(code)
    if (params) expect(e.params).toEqual(params)
  })
  it.each(['ALARM_E1234_RESET', 'a1', fifty])('%s → 통과', (name) => {
    expect(checkName(name)).toBe(null)
  })
})

describe('buildName — "{대}_{중}" + 3번(5자 이상) + 4번(있으면), 조립 이름 50자 이하', () => {
  const parts = (major, middle, part3 = '', part4 = '') => ({ major, middle, part3, part4 })
  it.each([
    ['기본', parts('ALARM', 'RESET', 'E1234'), 'ALARM_RESET_E1234'],
    ['4번 칸이 있으면 _값', parts('ALARM', 'RESET', 'E1234', 'V2'), 'ALARM_RESET_E1234_V2'],
    [`머리가 ${FREE_HEAD} 면 3번 칸을 비워도 된다`, parts('AUTO', 'DATABACKUP'), 'AUTO_DATABACKUP'],
    [`머리가 ${FREE_HEAD} 면 3번 칸이 짧아도 된다`, parts('AUTO', 'DATABACKUP', 'AB'), 'AUTO_DATABACKUP_AB'],
    [`머리가 ${FREE_HEAD} 이고 3번 칸이 비면 4번 칸만 붙는다`, parts('AUTO', 'DATABACKUP', '', 'M1'), 'AUTO_DATABACKUP_M1'],
    ['3번 칸에 밑줄·숫자', parts('PM', 'CHECK', 'E_123'), 'PM_CHECK_E_123']
  ])('%s', (_, p, name) => {
    expect(buildName(p)).toEqual({ name, errors: {} })
  })
  it.each([
    ['대분류 없음', parts('', 'RESET', 'E1234'), { major: 'MAJOR_REQUIRED' }, ''],
    ['중분류 없음', parts('ALARM', '', 'E1234'), { middle: 'MIDDLE_REQUIRED' }, ''],
    ['3번 칸 5자 미만', parts('ALARM', 'RESET', 'E12'), { part3: 'PART_SHORT' }, 'ALARM_RESET_E12'],
    ['3번 칸 비움', parts('ALARM', 'RESET', ''), { part3: 'PART_SHORT' }, 'ALARM_RESET'],
    ['3번 칸 글자', parts('ALARM', 'RESET', 'E1-234'), { part3: 'PART_CHARS' }, 'ALARM_RESET_E1-234'],
    ['4번 칸 글자', parts('ALARM', 'RESET', 'E1234', 'V-2'), { part4: 'PART_CHARS' }, 'ALARM_RESET_E1234_V-2'],
    ['조립 이름이 50자 넘음', parts('ALARM', 'RESET', 'E'.repeat(40)), { name: 'BUILT_TOO_LONG' }, `ALARM_RESET_${'E'.repeat(40)}`],
    ['규칙 값에 쓸 수 없는 글자(사내는 규칙 값을 검사하지 않는다)', parts('ALARM-X', 'RESET', 'E1234'), { name: 'BUILT_CHARS' }, 'ALARM-X_RESET_E1234']
  ])('%s', (_, p, codes, name) => {
    const r = buildName(p)
    expect(r.name).toBe(name)
    expect(Object.fromEntries(Object.entries(r.errors).map(([k, v]) => [k, v.code]))).toEqual(codes)
  })
  it('오류 params — 3번 칸 지금 글자 수, 조립 이름 길이·한도', () => {
    expect(buildName(parts('ALARM', 'RESET', 'E12')).errors.part3.params).toEqual({ min: 5, n: 3 })
    expect(buildName(parts('ALARM', 'RESET', 'E'.repeat(40))).errors.name.params).toEqual({ max: 50, n: 52 })
  })
  it('딱 50자는 통과', () => {
    const r = buildName(parts('ALARM', 'RESET', 'E'.repeat(38)))
    expect(r.name).toHaveLength(50)
    expect(r.errors).toEqual({})
  })
})

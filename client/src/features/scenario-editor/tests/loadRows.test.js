import { describe, it, expect } from 'vitest'
import { mergeDrafts, draftStale, isDup, draftTarget, typeAlong } from '../editor/loadRows'

const KEY = { process: 'P', model: 'M' }
const row = (name, over = {}) => ({ name, isEnabled: true, status: [], currentCrtime: 30, ...over })
const draft = (name, over = {}) => ({ draftId: `d-${name}`, name, target: { model: 'M', name }, base: { crtime: 30, fileId: 'f' }, headCrtime: 30, savedAt: '2026-11-07T05:23:51.000Z', ...over })

describe('loadRows', () => {
  it('초안은 키 이름이 같은 행에 붙고(저장할 곳이 달라도), 붙일 행이 없으면 "초안만" 행 — 기준 판이 없으면 new, 있으면 gone. 이름순', () => {
    const rows = mergeDrafts([row('B'), row('A')], [draft('A', { target: { model: 'M', name: 'A_COPY' } }), draft('C', { base: null, headCrtime: null }), draft('AA', { base: { crtime: 5, fileId: 'g' } })], KEY)
    expect(rows.map((r) => [r.name, r.draftOnly, r.draft?.draftId ?? null])).toEqual([['A', null, 'd-A'], ['AA', 'gone', 'd-AA'], ['B', null, null], ['C', 'new', 'd-C']])
    expect(rows.find((r) => r.name === 'C')).toMatchObject({ id: 'P-M-C', isEnabled: null, currentCrtime: null, status: [], lastOwner: null })
    expect(rows.find((r) => r.name === 'C')).toMatchObject({ emailSkip: null, startDelay: null, retryCnt: null, retryInterval: null, triggerInfo: null, stepCount: null, sizeBytes: null }) // 초안만 행은 서버 값이 없다
  })
  it('초안 시작 뒤 새 버전: 초안 headCrtime(없으면 기준 판) ≠ 지금 현재 버전 — 되돌려 연 작업본의 초안(기준 판은 옛 판, headCrtime 은 그때 현재)은 옛것이 아니다', () => {
    expect(draftStale(row('A', { draft: draft('A') }))).toBe(false)
    expect(draftStale(row('A', { draft: draft('A', { headCrtime: 20 }) }))).toBe(true)
    expect(draftStale(row('A', { draft: draft('A', { base: { crtime: 10, fileId: 'f' }, headCrtime: 30 }) }))).toBe(false)
    expect(draftStale(row('A', { draft: draft('A', { base: { crtime: 10, fileId: 'f' }, headCrtime: undefined }) }))).toBe(true) // 옛 초안 문서
    expect(draftStale(row('A', { draft: draft('A', { headCrtime: 20 }), draftOnly: 'gone' }))).toBe(false)
    expect(draftStale(row('A', { draft: draft('A', { headCrtime: 20 }), currentCrtime: null }))).toBe(false)
    expect(draftStale(row('A'))).toBe(false)
  })
  it('같은 키 2건·저장할 곳(원본과 다를 때만, 같은 모델이면 이름만)', () => {
    expect(isDup(row('A', { status: ['DUPLICATE_PROPERTY'] }))).toBe(true)
    expect(isDup(row('A'))).toBe(false)
    expect(draftTarget(row('A', { draft: draft('A') }), 'M')).toBe(null)
    expect(draftTarget(row('A', { draft: draft('A', { target: { model: 'M', name: 'A_COPY' } }) }), 'M')).toBe('A_COPY')
    expect(draftTarget(row('A', { draft: draft('A', { target: { model: 'M2', name: 'A' } }) }), 'M')).toBe('M2 · A')
  })
})

// 지우기 확인 창의 이름 따라 치기(2026-11-10 사용자 요청): 친 글이 이름의 앞부분과 같으면 남은 글자를 회색 안내로,
// 다른 글자가 나오면 거기서부터 붉은 글씨이고 안내는 사라진다.
describe('typeAlong', () => {
  it('아직 안 쳤으면 이름 전체가 안내', () => {
    expect(typeAlong('ALARM_RESET', '')).toEqual({ ok: '', bad: '', ghost: 'ALARM_RESET' })
  })
  it('앞부분이 같으면 남은 글자가 안내로 남는다', () => {
    expect(typeAlong('ALARM_RESET', 'ALA')).toEqual({ ok: 'ALA', bad: '', ghost: 'RM_RESET' })
    expect(typeAlong('ALARM_RESET', 'ALARM_RESET')).toEqual({ ok: 'ALARM_RESET', bad: '', ghost: '' })
  })
  it('다른 글자부터 끝까지 틀린 글이고 안내는 없다 — 그 뒤 글자가 우연히 같아도 자리가 어긋난 것이다', () => {
    expect(typeAlong('ALARM_RESET', 'ALX')).toEqual({ ok: 'AL', bad: 'X', ghost: '' })
    expect(typeAlong('ALARM_RESET', 'ALXRM')).toEqual({ ok: 'AL', bad: 'XRM', ghost: '' })
    expect(typeAlong('ALARM_RESET', 'xLARM')).toEqual({ ok: '', bad: 'xLARM', ghost: '' })
  })
  it('대소문자가 다르면 다른 글자다, 이름보다 길게 치면 넘친 글자가 틀린 글', () => {
    expect(typeAlong('ALARM', 'alarm')).toEqual({ ok: '', bad: 'alarm', ghost: '' })
    expect(typeAlong('ALARM', 'ALARMS')).toEqual({ ok: 'ALARM', bad: 'S', ghost: '' })
  })
  it('한글·이모지 이름도 글자 단위로 견준다(쌍 가운데를 자르지 않는다)', () => {
    expect(typeAlong('알람😀해제', '알람😀')).toEqual({ ok: '알람😀', bad: '', ghost: '해제' })
    expect(typeAlong('알람😀해제', '알람😁')).toEqual({ ok: '알람', bad: '😁', ghost: '' })
  })
})


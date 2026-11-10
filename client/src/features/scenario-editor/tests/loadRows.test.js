import { describe, it, expect } from 'vitest'
import { mergeDrafts, draftStale, isDup, draftTarget } from '../editor/loadRows'

const KEY = { process: 'P', model: 'M' }
const row = (name, over = {}) => ({ name, isEnabled: true, status: [], currentCrtime: 30, ...over })
const draft = (name, over = {}) => ({ draftId: `d-${name}`, name, target: { model: 'M', name }, base: { crtime: 30, fileId: 'f' }, headCrtime: 30, savedAt: '2026-11-07T05:23:51.000Z', ...over })

describe('loadRows', () => {
  it('초안은 키 이름이 같은 행에 붙고(저장할 곳이 달라도), 붙일 행이 없으면 "초안만" 행 — 기준 판이 없으면 new, 있으면 gone. 이름순', () => {
    const rows = mergeDrafts([row('B'), row('A')], [draft('A', { target: { model: 'M', name: 'A_COPY' } }), draft('C', { base: null, headCrtime: null }), draft('AA', { base: { crtime: 5, fileId: 'g' } })], KEY)
    expect(rows.map((r) => [r.name, r.draftOnly, r.draft?.draftId ?? null])).toEqual([['A', null, 'd-A'], ['AA', 'gone', 'd-AA'], ['B', null, null], ['C', 'new', 'd-C']])
    expect(rows.find((r) => r.name === 'C')).toMatchObject({ id: 'P-M-C', isEnabled: null, currentCrtime: null, status: [], lastOwner: null })
    expect(rows.find((r) => r.name === 'C')).toMatchObject({ emailSkip: null, startDelay: null, retryCnt: null, retryInterval: null, triggerInfo: null }) // 초안만 행은 서버 값이 없다
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

import { describe, it, expect } from 'vitest'
import { beginSession, nextUid, stepIndex, stepNo, restoreSessionOf, draftSessionOf } from '../editor/session'
import { versionKeyOf } from '../editor/diff'

const edited = { source: { process: 'P', model: 'M', name: 'N', crtime: 7, fileId: 'f1' }, headCrtime: 7, header: {}, steps: [{ uid: 'n1' }, { uid: 's0' }, { uid: 'p1' }], property: {} }
const sk = (over = {}) => ({ process: 'P', model: 'M', name: 'N', headCrtime: 7, propertyRev: 'rev', version: { crtime: 7, isCurrent: true, fileId: 'f1' }, edited, ...over })

describe('beginSession', () => {
  it('서버가 준 작업본을 같은 참조로 working·saveBase 에 둔다', () => {
    const s = beginSession(sk(), { canWrite: true })
    expect(s.working).toBe(edited)
    expect(s.saveBase).toBe(edited)
    expect(s).toMatchObject({ source: { process: 'P', model: 'M', name: 'N', crtime: 7, fileId: 'f1' }, headCrtime: 7, propertyRev: 'rev', readOnly: null, seq: 0 })
  })
  it('WRITE 권한이 없으면 noWrite', () => {
    expect(beginSession(sk(), { canWrite: false }).readOnly).toBe('noWrite')
  })
  it('옛 판이면 oldVersion', () => {
    expect(beginSession(sk({ version: { crtime: 5, isCurrent: false, fileId: 'f0' } }), { canWrite: true }).readOnly).toBe('oldVersion')
  })
  it('me 가 없으면 noWrite', () => {
    expect(beginSession(sk(), null).readOnly).toBe('noWrite')
  })
})

// 그림 내용 지문 표(SEW-019): 판 열쇠 → 뼈대의 imageFp. "저장 전 N곳"·저장 창이 판이 다른 그림을 내용으로 견준다(editor/diff).
describe('세션의 그림 지문 표(imageFp)', () => {
  const ver = (crtime, imageFp) => ({
    process: 'P', model: 'M', name: 'N', headCrtime: 30, propertyRev: 'r30', version: { crtime, isCurrent: crtime === 30, fileId: `F${crtime}` },
    header: {}, steps: [], notes: [], ...(imageFp ? { imageFp } : {}),
    edited: { source: { process: 'P', model: 'M', name: 'N', crtime, fileId: `F${crtime}` }, headCrtime: 30, header: { description: '', timeoutLimit: '' }, steps: [], property: {} }
  })
  const keyOf = (crtime) => versionKeyOf({ process: 'P', model: 'M', name: 'N', crtime, fileId: `F${crtime}` })
  it('beginSession: 연 판의 지문을 그 판 열쇠로(지문이 없는 뼈대면 빈 표)', () => {
    expect(beginSession(ver(30, { 's0-bi': 'B' }), { canWrite: true }).imageFp).toEqual({ [keyOf(30)]: { 's0-bi': 'B' } })
    expect(beginSession(ver(30), { canWrite: true }).imageFp).toEqual({})
  })
  it('restoreSessionOf: 옛 판(작업본의 출처)과 현재 판(저장 기준점의 출처) 둘 다', () => {
    const { session } = restoreSessionOf(ver(10, { 's0-bi': 'OLD' }), ver(30, { 's0-bi': 'CUR' }), { canWrite: true })
    expect(session.imageFp).toEqual({ [keyOf(10)]: { 's0-bi': 'OLD' }, [keyOf(30)]: { 's0-bi': 'CUR' } })
  })
  it('draftSessionOf: 기준 판 뼈대가 있으면 그 지문, 새 시나리오·원본이 지워진 초안은 빈 표', () => {
    const base = ver(10, { 's0-bi': 'B' })
    const draft = (scenario) => ({ draftId: 'd1', savedAt: 'x', headCrtime: 30, propertyRev: 'r', scenario, process: 'P', model: 'M', name: 'N' })
    expect(draftSessionOf(draft({ ...base.edited }), base, { canWrite: true }).session.imageFp).toEqual({ [keyOf(10)]: { 's0-bi': 'B' } })
    expect(draftSessionOf(draft({ ...base.edited }), null, { canWrite: true }).session.imageFp).toEqual({})
    expect(draftSessionOf(draft({ ...base.edited, source: null }), null, { canWrite: true }).session.imageFp).toEqual({})
  })
})

describe('nextUid', () => {
  it('이미 있는 uid 를 피하고 session 의 seq 를 올린 새 session 을 준다', () => {
    const s = beginSession(sk(), { canWrite: true })
    const [uid, s2] = nextUid(s, 'n')
    expect(uid).toBe('n2')
    expect(s2).not.toBe(s)
    expect(s.seq).toBe(0)
    const [uid2] = nextUid(s2, 'n')
    expect(uid2).toBe('n3')
    expect(nextUid(s, 'p')[0]).toBe('p2')
  })
})

describe('stepIndex·stepNo', () => {
  it('위치와 1부터 번호', () => {
    expect(stepIndex(edited, 's0')).toBe(1)
    expect(stepNo(edited, 's0')).toBe(2)
    expect(stepIndex(edited, 'zz')).toBe(-1)
  })
})

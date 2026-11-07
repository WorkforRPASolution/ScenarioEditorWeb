import { describe, it, expect } from 'vitest'
import { beginSession, nextUid, stepIndex, stepNo } from '../editor/session'

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

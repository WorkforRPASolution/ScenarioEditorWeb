import { describe, it, expect } from 'vitest'
import { applyStep, insertStep, deleteSteps, isContiguous, moveSteps, copySteps, pasteSteps, setCell, movedRefs } from '../editor/commands'

const FAIL = { kind: 'end', value: 'FAIL' }
const ORIGIN = { process: 'P', model: 'M', name: 'SRC', crtime: 5, fileId: 'f5' }
// nexts: { uid: { onTrue: uid|target, onFalse: uid|target } }
const toTarget = (v) => (v === undefined ? FAIL : typeof v === 'string' ? { kind: 'step', uid: v } : v)
const step = (uid, nx = {}, over = {}) => ({
  uid, origin: 0, condition: { kind: 'image', skipPreprocessing: false, image: { accept: 0.8 } }, action: { type: 'None' },
  next: { onTrue: toTarget(nx.onTrue), onFalse: toTarget(nx.onFalse) }, retry: { limit: 0, intervalMs: 0 },
  descriptionToEmail: '', descriptionToDialog: '', isShowDialog: false,
  images: { train: { 0: { from: 'source', id: `${uid}-t0` } }, base: { from: 'source', id: `${uid}-bi` } }, ...over
})
const edited = (uids, nexts = {}) => ({ source: ORIGIN, headCrtime: 5, header: {}, steps: uids.map((u) => step(u, nexts[u])), property: {} })
let seq = 0
const makeUid = () => `p${++seq}`
// 화면 번호(1부터) — 참조가 가리키는 스텝의 번호
const noOfRef = (w, s, key) => { const t = s.next[key]; return t.kind === 'step' ? w.steps.findIndex((x) => x.uid === t.uid) + 1 : null }
const uids = (w) => w.steps.map((s) => s.uid)

describe('applyStep', () => {
  it('uid 가 같은 스텝만 바꾼다', () => {
    const w = edited(['a', 'b'])
    const r = applyStep(w, { ...w.steps[1], descriptionToEmail: 'x' })
    expect(r.working.steps[1].descriptionToEmail).toBe('x')
    expect(r.working.steps[0]).toBe(w.steps[0])
    expect(w.steps[1].descriptionToEmail).toBe('')
  })
})

describe('insertStep (12 §5.2 삽입)', () => {
  it('앞에 넣으면 번호만 바뀌고 가리키는 스텝은 그대로', () => {
    const w = edited(['a', 'b', 'c'], { a: { onTrue: 'c' } })
    const r = insertStep(w, step('n1'), { beforeUid: 'b' })
    expect(uids(r.working)).toEqual(['a', 'n1', 'b', 'c'])
    expect(r.working.steps[0].next.onTrue).toEqual({ kind: 'step', uid: 'c' })
    expect(r.working.steps[2]).toBe(w.steps[1])
    expect(movedRefs(w, r.working)).toBe(1)
    // 예: A 성공 = 2번(C) → 위치 1 에 넣으면 3번(C)
    expect(noOfRef(w, w.steps[0], 'onTrue')).toBe(3)
    expect(noOfRef(r.working, r.working.steps[0], 'onTrue')).toBe(4)
  })
  it('사내 예: [A,B,C], A 성공=C, 위치 1 에 X → A 성공이 C 를 따라간다', () => {
    const w = edited(['A', 'B', 'C'], { A: { onTrue: 'C' } })
    const r = insertStep(w, step('X'), { beforeUid: 'B' })
    expect(uids(r.working)).toEqual(['A', 'X', 'B', 'C'])
    expect(r.working.steps[0].next.onTrue.uid).toBe('C')
  })
  it('beforeUid 가 null 이면 끝, 번호는 그대로', () => {
    const w = edited(['a', 'b'], { a: { onTrue: 'b' } })
    const r = insertStep(w, step('n'), { beforeUid: null })
    expect(uids(r.working)).toEqual(['a', 'b', 'n'])
    expect(movedRefs(w, r.working)).toBe(0)
  })
  it('200 개면 거절', () => {
    const w = edited(Array.from({ length: 200 }, (_, i) => `s${i}`))
    expect(insertStep(w, step('n'), { beforeUid: null })).toEqual({ refused: 'STEP_LIMIT' })
  })
  it('입력을 바꾸지 않는다', () => {
    const w = edited(['a'])
    insertStep(w, step('n'), { beforeUid: null })
    expect(w.steps).toHaveLength(1)
  })
})

describe('deleteSteps (12 §5.2 삭제)', () => {
  it('가리키는 스텝이 있으면 지우기를 막는다', () => {
    const w = edited(['a', 'b'], { a: { onFalse: 'b' } })
    expect(deleteSteps(w, ['b']).blocked).toEqual([{ uid: 'a', key: 'onFalse', to: 'b' }])
  })
  it('사내 예: [A,B,C,D] B 를 지우려면 C 의 실패가 가리켜 막고, 고친 뒤 지우면 A 성공이 D 를 따라간다', () => {
    const w = edited(['A', 'B', 'C', 'D'], { A: { onTrue: 'D' }, C: { onFalse: 'B' } })
    expect(noOfRef(w, w.steps[0], 'onTrue')).toBe(4)
    expect(deleteSteps(w, ['B']).blocked).toEqual([{ uid: 'C', key: 'onFalse', to: 'B' }])
    const fixed = setCell(w, 'C', 'onFalse', FAIL).working
    const r = deleteSteps(fixed, ['B'])
    expect(uids(r.working)).toEqual(['A', 'C', 'D'])
    expect(noOfRef(r.working, r.working.steps[0], 'onTrue')).toBe(3)
    expect(r.working.steps[2]).toBe(fixed.steps[3])
  })
  it('지울 스텝끼리의 참조는 막지 않는다', () => {
    const w = edited(['a', 'b', 'c'], { b: { onTrue: 'c' }, c: { onFalse: 'b' } })
    expect(uids(deleteSteps(w, ['b', 'c']).working)).toEqual(['a'])
  })
})

describe('isContiguous·moveSteps (12 §5.2 이동)', () => {
  it('연속 판정', () => {
    const w = edited(['a', 'b', 'c', 'd'])
    expect(isContiguous(w, ['b', 'c'])).toBe(true)
    expect(isContiguous(w, ['c', 'b'])).toBe(true)
    expect(isContiguous(w, ['a', 'c'])).toBe(false)
  })
  it('사내 예: [A,B,C,D], A 성공=C. C 를 맨 앞으로(위로 두 번) → [C,A,B,D], A 성공=1번(C)', () => {
    const w = edited(['A', 'B', 'C', 'D'], { A: { onTrue: 'C' } })
    const r1 = moveSteps(w, ['C'], -1)
    const r2 = moveSteps(r1.working, ['C'], -1)
    expect(uids(r2.working)).toEqual(['C', 'A', 'B', 'D'])
    expect(noOfRef(r2.working, r2.working.steps[1], 'onTrue')).toBe(1)
    expect(r2.working.steps[3]).toBe(w.steps[3])
    // 참조 번호 바뀐 수: A 성공 3→1
    expect(movedRefs(w, r2.working)).toBe(1)
  })
  it('묶음을 아래로', () => {
    const w = edited(['a', 'b', 'c', 'd'])
    expect(uids(moveSteps(w, ['a', 'b'], 1).working)).toEqual(['c', 'a', 'b', 'd'])
  })
  it('연속이 아니면 거절, 끝이면 거절', () => {
    const w = edited(['a', 'b', 'c'])
    expect(moveSteps(w, ['a', 'c'], 1)).toEqual({ refused: 'NOT_CONTIGUOUS' })
    expect(moveSteps(w, ['a'], -1)).toEqual({ refused: 'AT_EDGE' })
    expect(moveSteps(w, ['c'], 1)).toEqual({ refused: 'AT_EDGE' })
  })
})

describe('copySteps·pasteSteps (12 §5.2 복사)', () => {
  it('연속이 아니면 거절', () => {
    expect(copySteps(edited(['a', 'b', 'c']), ['a', 'c'], ORIGIN, false)).toEqual({ refused: 'NOT_CONTIGUOUS' })
  })
  it('Clip 모양: 번호 순 uid, outsideNo, eqpStateCount', () => {
    const src = edited(['a', 'b', 'c'], { b: { onTrue: 'c', onFalse: 'a' } })
    const clip = copySteps(src, ['c', 'b'], ORIGIN, false)
    expect(clip).toMatchObject({ origin: ORIGIN, cut: false, uids: ['b', 'c'], outsideNo: { 'b:onFalse': 1 }, eqpStateCount: 0 })
    expect(clip.steps).toEqual([src.steps[1], src.steps[2]])
  })
  it('eqpStateCount 는 설비 상태 조건 스텝 수', () => {
    const w = edited(['a', 'b', 'c'])
    const withEqp = { ...w, steps: [w.steps[0], { ...w.steps[1], condition: { kind: 'eqpState' } }, { ...w.steps[2], condition: { kind: 'eqpState' } }] }
    expect(copySteps(withEqp, ['a', 'b', 'c'], ORIGIN, false).eqpStateCount).toBe(2)
  })
  it('사내 예: [A,B,C], B 성공=C, C 실패=B. B,C 를 C 뒤에 붙이면 복제본끼리 잇는다(화면 번호 5·4)', () => {
    const w = edited(['A', 'B', 'C'], { B: { onTrue: 'C' }, C: { onFalse: 'B' } })
    const clip = copySteps(w, ['B', 'C'], ORIGIN, false)
    const r = pasteSteps(w, clip, { where: 'after', anchorUid: 'C' }, { sameSource: true, makeUid })
    expect(r.working.steps).toHaveLength(5)
    const [, , , B2, C2] = r.working.steps
    expect(noOfRef(r.working, B2, 'onTrue')).toBe(5)
    expect(noOfRef(r.working, C2, 'onFalse')).toBe(4)
    expect(r.pasted).toEqual([B2.uid, C2.uid])
    expect(B2.origin).toBe(null)
    expect(r.unresolved).toBe(0)
    // 원래 스텝은 안 바뀐다
    expect(r.working.steps[1]).toBe(w.steps[1])
    expect(movedRefs(w, r.working)).toBe(0)
  })
  it('앞에 붙이면 뒤의 번호가 밀린다(사내 규칙 i ≥ p → i+k)', () => {
    const w = edited(['A', 'B', 'C'], { A: { onTrue: 'C' } })
    const clip = copySteps(w, ['B'], ORIGIN, false)
    const r = pasteSteps(w, clip, { where: 'before', anchorUid: 'B' }, { sameSource: true, makeUid })
    expect(uids(r.working).slice(0, 1).concat(uids(r.working).slice(2))).toEqual(['A', 'B', 'C'])
    expect(noOfRef(r.working, r.working.steps[0], 'onTrue')).toBe(4)
    expect(movedRefs(w, r.working)).toBe(1)
  })
  it('다른 시나리오에 붙이면 묶음 밖 참조는 미해결, 그림은 다른 판 참조', () => {
    const src = edited(['a', 'b', 'c'], { b: { onTrue: 'c', onFalse: 'a' } })
    const clip = copySteps(src, ['b', 'c'], ORIGIN, false)
    const r = pasteSteps(edited([]), clip, { where: 'end' }, { sameSource: false, makeUid })
    expect(r.working.steps[0].next.onTrue).toEqual({ kind: 'step', uid: r.pasted[1] })
    expect(r.working.steps[0].next.onFalse).toEqual({ kind: 'unresolved', value: 1 })
    expect(r.working.steps[0].images.base).toEqual({ from: 'other', ...ORIGIN, id: 's1-bi'.replace('s1', 'b') })
    expect(r.working.steps[0].images.train[0]).toEqual({ from: 'other', ...ORIGIN, id: 'b-t0' })
    expect(r.unresolved).toBe(1)
    expect(r.working.steps[0].origin).toBe(null)
  })
  it('묶음 밖 참조가 복사할 때 이미 없던 스텝이면 원래 번호 없이 { kind: unresolved } — value 키를 두지 않는다(서버가 받는 모양)', () => {
    const src = edited(['a', 'b'], { b: { onTrue: 'gone' } })
    const clip = copySteps(src, ['b'], ORIGIN, false)
    expect(clip.outsideNo).toEqual({})
    const r = pasteSteps(edited([]), clip, { where: 'end' }, { sameSource: false, makeUid })
    expect(r.working.steps[0].next.onTrue).toStrictEqual({ kind: 'unresolved' })
    expect(r.unresolved).toBe(1)
  })
  it('특수값·원문 갈 곳은 그대로, 업로드·다른 판·리터럴 그림은 그대로', () => {
    const other = { from: 'other', process: 'Q', model: 'M', name: 'N', crtime: 1, fileId: 'f', id: 'x' }
    const w = edited(['a'])
    const s = { ...w.steps[0], next: { onTrue: { kind: 'end', value: 'SUCCESS' }, onFalse: { kind: 'raw', value: 9999 } },
      images: { train: { 0: { from: 'upload', tempId: 'u1' }, 1: other, 2: { literal: 'AAA' } }, base: null } }
    const clip = copySteps({ ...w, steps: [s] }, ['a'], ORIGIN, false)
    const r = pasteSteps(edited([]), clip, { where: 'end' }, { sameSource: false, makeUid })
    const p = r.working.steps[0]
    expect(p.next).toEqual(s.next)
    expect(p.images).toEqual(s.images)
    expect(r.unresolved).toBe(0)
  })
  it('붙일 때마다 새 uid, 같은 묶음을 두 번 붙여도 겹치지 않는다', () => {
    const w = edited(['a'])
    const clip = copySteps(w, ['a'], ORIGIN, false)
    const r1 = pasteSteps(w, clip, { where: 'end' }, { sameSource: true, makeUid })
    const r2 = pasteSteps(r1.working, clip, { where: 'end' }, { sameSource: true, makeUid })
    expect(new Set(uids(r2.working)).size).toBe(3)
  })
  it('200 개 넘으면 거절', () => {
    const w = edited(Array.from({ length: 200 }, (_, i) => `s${i}`))
    const clip = copySteps(w, ['s0'], ORIGIN, false)
    expect(pasteSteps(w, clip, { where: 'end' }, { sameSource: true, makeUid })).toEqual({ refused: 'STEP_LIMIT' })
  })
})

describe('잘라내기 붙여넣기', () => {
  it('잘라낸 범위 안에는 붙이지 못한다', () => {
    const w = edited(['a', 'b', 'c'])
    expect(pasteSteps(w, copySteps(w, ['a', 'b'], null, true), { where: 'before', anchorUid: 'b' }, { sameSource: true, makeUid }).refused).toBe('INSIDE_CUT')
  })
  it('같은 작업본 안 이동: uid·origin·객체 그대로, 참조가 따라간다', () => {
    const w = edited(['A', 'B', 'C', 'D'], { A: { onTrue: 'C' } })
    const clip = copySteps(w, ['C'], ORIGIN, true)
    const r = pasteSteps(w, clip, { where: 'before', anchorUid: 'A' }, { sameSource: true, makeUid })
    expect(uids(r.working)).toEqual(['C', 'A', 'B', 'D'])
    expect(r.pasted).toEqual(['C'])
    expect(r.working.steps[0]).toBe(w.steps[2])
    expect(noOfRef(r.working, r.working.steps[1], 'onTrue')).toBe(1)
    expect(r.unresolved).toBe(0)
  })
  it('뒤로 이동(after)', () => {
    const w = edited(['A', 'B', 'C', 'D'])
    const r = pasteSteps(w, copySteps(w, ['A', 'B'], ORIGIN, true), { where: 'after', anchorUid: 'C' }, { sameSource: true, makeUid })
    expect(uids(r.working)).toEqual(['C', 'A', 'B', 'D'])
  })
  it('끝으로 이동', () => {
    const w = edited(['A', 'B', 'C'])
    const r = pasteSteps(w, copySteps(w, ['A'], ORIGIN, true), { where: 'end' }, { sameSource: true, makeUid })
    expect(uids(r.working)).toEqual(['B', 'C', 'A'])
  })
  it('sameSource 거짓이면 복사처럼: 새 p 번호, 밖 참조 미해결, source 그림은 other, 잘라낸 쪽은 그대로(R-T2a)', () => {
    const src = edited(['a', 'b'], { b: { onTrue: 'a' } })
    const clip = copySteps(src, ['b'], ORIGIN, true)
    const dst = edited(['x'])
    const r = pasteSteps(dst, clip, { where: 'end' }, { sameSource: false, makeUid })
    expect(r.pasted[0]).toMatch(/^p/)
    expect(r.working.steps[1].origin).toBe(null)
    expect(r.working.steps[1].next.onTrue).toEqual({ kind: 'unresolved', value: 1 })
    expect(r.working.steps[1].images.base.from).toBe('other')
    expect(src.steps).toHaveLength(2)
    expect(uids(src)).toEqual(['a', 'b'])
  })
})

describe('setCell', () => {
  const w = edited(['a', 'b'])
  it('accept', () => expect(setCell(w, 'a', 'accept', 0.9).working.steps[0].condition.image.accept).toBe(0.9))
  it('skip', () => expect(setCell(w, 'a', 'skip', true).working.steps[0].condition.skipPreprocessing).toBe(true))
  it('onTrue·onFalse', () => {
    const t = { kind: 'step', uid: 'b' }
    expect(setCell(w, 'a', 'onTrue', t).working.steps[0].next.onTrue).toBe(t)
    expect(setCell(w, 'a', 'onFalse', t).working.steps[0].next.onFalse).toBe(t)
  })
  it('다른 스텝은 같은 객체, 입력은 그대로', () => {
    const r = setCell(w, 'a', 'accept', 0.9)
    expect(r.working.steps[1]).toBe(w.steps[1])
    expect(w.steps[0].condition.image.accept).toBe(0.8)
  })
})

describe('movedRefs', () => {
  it('번호가 바뀐 참조만 센다', () => {
    const w = edited(['a', 'b', 'c'], { a: { onTrue: 'c', onFalse: 'b' } })
    const after = { ...w, steps: [w.steps[1], w.steps[0], w.steps[2]] }
    // a: 번호 1→2, c: 3 그대로. a.onTrue c 3→3, a.onFalse b 2→1
    expect(movedRefs(w, after)).toBe(1)
  })
})

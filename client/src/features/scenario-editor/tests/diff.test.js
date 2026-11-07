import { describe, it, expect } from 'vitest'
import { unsavedChanges } from '../editor/diff'
import { insertStep, moveSteps, applyStep, deleteSteps } from '../editor/commands'

const step = (uid, over = {}) => ({
  uid, origin: null,
  condition: { kind: 'none', skipPreprocessing: false }, action: { type: 0, raw: '' },
  next: { onTrue: { kind: 'next' }, onFalse: { kind: 'end', value: 'FAIL' } },
  retry: { limit: 0, intervalMs: 2000 }, descriptionToEmail: uid, descriptionToDialog: '', isShowDialog: false,
  images: { train: {}, base: null }, ...over
})
const scn = (steps, over = {}) => ({ source: { name: 'X' }, headCrtime: 1, header: { description: '제목', timeoutLimit: '10' }, steps, property: { A: 1, Owners: ['x'] }, ...over })
const base = () => scn([step('a', { next: { onTrue: { kind: 'step', uid: 'c' }, onFalse: { kind: 'end', value: 'FAIL' } } }), step('b'), step('c')])

describe('unsavedChanges', () => {
  it('아무것도 안 했으면 빈 목록', () => {
    const b = base()
    expect(unsavedChanges(b, b)).toEqual([])
    expect(unsavedChanges(JSON.parse(JSON.stringify(b)), b)).toEqual([])
  })
  it('앞에 넣으면 added 1 + 뒤 스텝은 changed·moved 가 아니다(번호만 바뀜)', () => {
    const b = base()
    const { working } = insertStep(b, step('n'), { beforeUid: 'a' })
    expect(unsavedChanges(working, b)).toEqual([{ kind: 'added', uid: 'n', no: 1 }])
  })
  it('스텝을 고치면 changed(현재 번호), 같은 값으로 새 객체를 만들면 변경 아님', () => {
    const b = base()
    const edited = applyStep(b, { ...b.steps[1], descriptionToEmail: '새 설명' }).working
    expect(unsavedChanges(edited, b)).toEqual([{ kind: 'changed', uid: 'b', no: 2 }])
    expect(unsavedChanges(applyStep(b, { ...b.steps[1] }).working, b)).toEqual([])
  })
  it('지우면 deleted(원래 번호)', () => {
    const b = base()
    const { working } = deleteSteps(b, ['b'])
    expect(unsavedChanges(working, b)).toEqual([{ kind: 'deleted', uid: 'b', no: 2 }])
  })
  it('순서가 바뀌면 옮긴 스텝만 moved', () => {
    const b = base()
    const { working } = moveSteps(b, ['c'], -1)
    const rows = unsavedChanges(working, b)
    expect(rows.filter((r) => r.kind === 'moved')).toHaveLength(1)
    expect(rows.every((r) => r.kind === 'moved')).toBe(true)
  })
  it('갈 곳이 가리키는 스텝이 같으면(번호만 바뀜) 변경 아님, 다른 스텝을 가리키면 changed', () => {
    const b = base()
    const { working } = insertStep(b, step('n'), { beforeUid: 'b' })
    expect(unsavedChanges(working, b).map((r) => r.kind)).toEqual(['added'])
    const re = applyStep(b, { ...b.steps[0], next: { ...b.steps[0].next, onTrue: { kind: 'step', uid: 'b' } } }).working
    expect(unsavedChanges(re, b)).toEqual([{ kind: 'changed', uid: 'a', no: 1 }])
  })
  it('바 칸·운영 속성은 field 행(Owners 는 무시)', () => {
    const b = base()
    const w = { ...b, header: { description: '새 제목', timeoutLimit: '20' }, property: { A: 2, Owners: ['y'] } }
    const rows = unsavedChanges(w, b)
    expect(rows.map((r) => (r.kind === 'field' ? r.key : r.kind))).toEqual(['description', 'timeoutLimit', 'property'])
    expect(rows[0]).toMatchObject({ before: '제목', after: '새 제목' })
    expect(rows[2].keys).toEqual(['A'])
    expect(unsavedChanges({ ...b, property: { A: 1, Owners: ['z'] } }, b)).toEqual([])
  })
})

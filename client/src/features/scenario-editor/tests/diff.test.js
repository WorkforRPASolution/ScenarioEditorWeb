import { describe, it, expect } from 'vitest'
import { unsavedChanges, sessionChanges, versionKeyOf, comparableStep } from '../editor/diff'
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

describe('unsavedChanges — 새 시나리오(출처 없는 기준점, P2-D Task 6)', () => {
  it('기준점 = 만든 때의 작업본: 그대로면 0, 만든 뒤 바꾼 바 칸·운영 속성은 field 행', () => {
    const b = scn([], { source: null, headCrtime: null, property: { IsEnabled: true, Owners: [] } })
    expect(unsavedChanges(b, b)).toEqual([])
    const w = { ...b, header: { ...b.header, description: '다른 제목' }, property: { IsEnabled: false, Owners: [] } }
    expect(unsavedChanges(w, b)).toEqual([{ kind: 'field', key: 'description', before: '제목', after: '다른 제목' }, { kind: 'field', key: 'property', keys: ['IsEnabled'] }])
  })
})

// 되돌려 연 세션(작업본 = 옛 판, 저장 기준점 = 현재 판): 그림 URL·참조가 판마다 달라 고치지 않은 그림 스텝까지 바뀐 것으로 셌다(SEW-019).
// 서버가 판마다 보낸 그림 내용 지문(imageFp)으로 견준다 — 사용자 결정 (b) 2026-11-09.
describe('unsavedChanges — 판이 다른 기준점, 그림은 내용 지문으로(SEW-019)', () => {
  const V1 = { process: 'P', model: 'M', name: 'N', crtime: 10, fileId: 'F10' }
  const V2 = { process: 'P', model: 'M', name: 'N', crtime: 30, fileId: 'F30' }
  const urlOf = (v, id) => `/scenario-editor/scenarios/P/M/N/versions/${v.crtime}/files/${v.fileId}/images/${id}`
  const imageStepOf = (v, over = {}) => step('a', {
    condition: { kind: 'image', skipPreprocessing: false, searchArea: { x: 1, y: 2, w: 30, h: 40 }, image: { accept: 0.9, trainImages: [{ key: 0, type: true, url: urlOf(v, 's0-train-0') }] } },
    images: { train: { 0: { from: 'source', id: 's0-train-0' } }, base: { from: 'source', id: 's0-bi' } }, ...over
  })
  const ocrStepOf = () => step('o', { condition: { kind: 'ocr', skipPreprocessing: false, searchArea: { x: 1, y: 2, w: 30, h: 40 }, ocr: { op: 1, text: 'IDLE' } }, images: { train: {}, base: { from: 'source', id: 's1-bi' } } })
  const pair = () => ({ working: scn([imageStepOf(V1), ocrStepOf()], { source: V1 }), saveBase: scn([imageStepOf(V2), ocrStepOf()], { source: V2 }) })
  const fpOf = (one, two) => ({ [versionKeyOf(V1)]: one, [versionKeyOf(V2)]: two })
  const SAME = { 's0-bi': 'B0', 's0-train-0': 'T0', 's1-bi': 'B1' }

  it('그림 내용이 같으면 URL 이 판마다 달라도 바뀐 것이 아니다', () => {
    const { working, saveBase } = pair()
    expect(unsavedChanges(working, saveBase, fpOf(SAME, { ...SAME }))).toEqual([])
  })
  it('기준 화면·찾을 그림 내용이 다르면 그 스텝은 changed', () => {
    const { working, saveBase } = pair()
    expect(unsavedChanges(working, saveBase, fpOf(SAME, { ...SAME, 's0-bi': 'X' }))).toEqual([{ kind: 'changed', uid: 'a', no: 1 }])
    expect(unsavedChanges(working, saveBase, fpOf(SAME, { ...SAME, 's0-train-0': 'X' }))).toEqual([{ kind: 'changed', uid: 'a', no: 1 }])
    // 기준 화면만 있는 OCR 스텝: 참조 글자(s1-bi)는 두 판이 같아도 내용이 다르면 바뀐 것이다 — 그림 주소를 무시하는 방법 (a) 가 놓친 경우
    expect(unsavedChanges(working, saveBase, fpOf(SAME, { ...SAME, 's1-bi': 'X' }))).toEqual([{ kind: 'changed', uid: 'o', no: 2 }])
  })
  it('지문을 모르는 판의 그림은 판이 다르면 같다고 보지 않는다(바뀐 것으로 센다)', () => {
    const { working, saveBase } = pair()
    expect(unsavedChanges(working, saveBase).map((c) => c.uid)).toEqual(['a', 'o'])
    expect(unsavedChanges(working, saveBase, fpOf(SAME, {})).map((c) => c.uid)).toEqual(['a', 'o'])
  })
  it('같은 판끼리는 지문이 없어도 전과 같다 — 같은 참조면 같다', () => {
    const { working } = pair()
    const copy = JSON.parse(JSON.stringify(working))
    expect(unsavedChanges(copy, working)).toEqual([])
    const re = { ...copy, steps: [{ ...copy.steps[0], images: { ...copy.steps[0].images, base: { from: 'upload', tempId: 't1' } } }, copy.steps[1]] }
    expect(unsavedChanges(re, working)).toEqual([{ kind: 'changed', uid: 'a', no: 1 }])
  })
  it('다른 판에서 붙여 온 그림(from other)도 그 판의 지문을 알면 지문으로 견준다', () => {
    const { saveBase } = pair()
    const pasted = imageStepOf(V1, { images: { train: { 0: { from: 'other', ...V1, id: 's0-train-0' } }, base: { from: 'other', ...V1, id: 's0-bi' } } })
    const working = { ...saveBase, steps: [pasted, saveBase.steps[1]] }
    expect(unsavedChanges(working, saveBase, fpOf(SAME, { ...SAME }))).toEqual([])
    expect(unsavedChanges(working, saveBase, fpOf({ ...SAME, 's0-bi': 'X' }, SAME))).toEqual([{ kind: 'changed', uid: 'a', no: 1 }])
  })
  it('sessionChanges = 세션의 작업본·저장 기준점·지문 표로 센 저장 전 변경', () => {
    const { working, saveBase } = pair()
    expect(sessionChanges({ working, saveBase, imageFp: fpOf(SAME, { ...SAME }) })).toEqual([])
    expect(sessionChanges({ working, saveBase }).length).toBe(2)
    expect(sessionChanges(null)).toEqual([])
    expect(sessionChanges({ working, saveBase: null })).toEqual([])
  })
  it('comparableStep: 찾을 그림 주소를 빼고 그림 참조를 비교 값으로 바꾼다(입력은 바꾸지 않는다)', () => {
    const s = imageStepOf(V1)
    const before = JSON.stringify(s)
    const c = comparableStep(s, V1, fpOf(SAME, {}))
    expect(c.condition.image.trainImages).toEqual([{ key: 0, type: true }])
    expect(c.images).toEqual({ train: { 0: { fp: 'T0' } }, base: { fp: 'B0' } })
    expect(comparableStep(noneLiteral(), V1, null).images).toEqual({ train: {}, base: { literal: 'AA==' } })
    expect(JSON.stringify(s)).toBe(before)
  })
  const noneLiteral = () => step('n', { images: { train: {}, base: { literal: 'AA==' } } })
})

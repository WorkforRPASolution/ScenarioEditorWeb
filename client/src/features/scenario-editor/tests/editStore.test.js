import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const api = vi.hoisted(() => ({ me: vi.fn(), scopes: vi.fn(), dataCheck: vi.fn(), refreshCache: vi.fn(), open: vi.fn(), list: vi.fn(), versions: vi.fn() }))
vi.mock('../api', () => ({ scenarioEditorApi: api }))
import { useEditorStore } from '../stores/editorStore'
import { useEditStore } from '../stores/editStore'

const ok = (data) => Promise.resolve({ data: { success: true, data } })
const edited = { source: { process: 'P', model: 'M', name: 'N', crtime: 1, fileId: 'f' }, headCrtime: 1, header: {}, steps: [{ uid: 's0' }], property: {} }
const skeleton = { process: 'P', model: 'M', name: 'N', headCrtime: 1, propertyRev: 'r', version: { crtime: 1, isCurrent: true, fileId: 'f' }, steps: [{ uid: 's0', no: 1, notes: [] }], notes: [], edited }

describe('editStore', () => {
  beforeEach(() => { setActivePinia(createPinia()); Object.values(api).forEach((f) => f.mockReset()) })

  it('초기값은 비어 있다', () => {
    const e = useEditStore()
    expect(e.session).toBe(null)
    expect(e.selection).toEqual({ uids: [], anchor: null })
    expect(e.panel).toEqual({ uid: null, isNew: false, draft: null, base: null })
    expect([e.undo, e.redo, e.clip, e.capture, e.toast, e.dialog]).toEqual([[], [], null, null, null, null])
    expect(e.uploads).toBeInstanceOf(Map)
  })
  it('begin: 세션을 만들고 작업본은 받은 edited 그대로(toBe)', () => {
    const e = useEditStore()
    e.begin(skeleton, { canWrite: true })
    expect(e.session.working).toBe(edited)
    expect(e.session.saveBase).toBe(edited)
    expect(e.session.readOnly).toBe(null)
  })
  it('begin: 이전 편집 상태를 비운다', () => {
    const e = useEditStore()
    e.begin(skeleton, { canWrite: true })
    e.selection = { uids: ['s0'], anchor: 's0' }
    e.undo = [{}]; e.toast = { text: 'x', undoable: false }; e.uploads.set('a', new Blob())
    e.begin(skeleton, { canWrite: true })
    expect(e.selection).toEqual({ uids: [], anchor: null })
    expect(e.undo).toEqual([])
    expect(e.toast).toBe(null)
    expect(e.uploads.size).toBe(0)
  })
  it('end: 세션을 지운다', () => {
    const e = useEditStore()
    e.begin(skeleton, { canWrite: true })
    e.end()
    expect(e.session).toBe(null)
  })
  it('editorStore.openScenario 성공 뒤 session.source.name 이 연 이름, 작업본은 같은 참조', async () => {
    api.open.mockReturnValue(ok(skeleton))
    const s = useEditorStore()
    s.me = { canWrite: false }
    await s.openScenario({ process: 'P', model: 'M', name: 'N' })
    const e = useEditStore()
    expect(e.session.source.name).toBe('N')
    expect(e.session.working).toBe(edited)
    expect(e.session.readOnly).toBe('noWrite')
  })
  it('열기 실패하면 세션을 끝낸다', async () => {
    api.open.mockReturnValue(ok(skeleton))
    const s = useEditorStore()
    await s.openScenario({ process: 'P', model: 'M', name: 'N' })
    api.open.mockRejectedValue({ response: { status: 404, data: { code: 'NOT_FOUND' } } })
    await s.openScenario({ process: 'P', model: 'M', name: 'X' })
    expect(useEditStore().session).toBe(null)
  })
})

import { insertStep as _ins, deleteSteps as _del } from '../editor/commands'
describe('editStore.run·undoLast·redoLast', () => {
  const mk = () => {
    const e = useEditStore()
    const w = { source: null, headCrtime: 1, header: {}, steps: [{ uid: 'a', next: { onTrue: { kind: 'step', uid: 'b' } } }, { uid: 'b', next: {} }], property: {} }
    e.begin({ ...skeleton, edited: w }, { canWrite: true })
    return [e, w]
  }
  const ins = (uid) => (w) => _ins(w, { uid, next: {} }, { beforeUid: null })
  beforeEach(() => setActivePinia(createPinia()))

  it('run: 작업본 반영·undo 쌓기·redo 비우기·알림', () => {
    const [e] = mk()
    e.redo = [{ steps: [], selection: { uids: [], anchor: null } }]
    const r = e.run('스텝을 넣었습니다.', ins('n'))
    expect(r.working.steps.map((s) => s.uid)).toEqual(['a', 'b', 'n'])
    expect(e.session.working.steps.map((s) => s.uid)).toEqual(['a', 'b', 'n'])
    expect(e.undo).toHaveLength(1)
    expect(e.redo).toEqual([])
    expect(e.toast).toEqual({ text: '스텝을 넣었습니다.', undoable: true })
  })
  it('run: 거절·막힘이면 아무것도 바꾸지 않고 결과를 돌려준다', () => {
    const [e, w] = mk()
    const r = e.run('지움', (x) => _del(x, ['b']))
    expect(r.blocked).toHaveLength(1)
    expect(e.session.working).toBe(w)
    expect(e.undo).toEqual([])
    expect(e.toast).toBe(null)
    const r2 = e.run('x', () => ({ refused: 'AT_EDGE' }))
    expect(r2).toEqual({ refused: 'AT_EDGE' })
    expect(e.undo).toEqual([])
  })
  it('run: 스냅샷은 50개까지, 넘으면 맨 앞을 버린다', () => {
    const [e] = mk()
    for (let i = 0; i < 52; i++) e.run('x', ins(`n${i}`))
    expect(e.undo).toHaveLength(50)
    expect(e.undo[0].steps.map((s) => s.uid)).toEqual(['a', 'b', 'n0', 'n1'])
  })
  it('되돌리기·다시 하기 뒤 스텝 객체가 열 때와 같다', () => {
    const [e, w] = mk()
    e.run('넣음', ins('n'))
    const after = e.session.working
    e.undoLast()
    expect(e.session.working.steps).toHaveLength(2)
    expect(e.session.working.steps[0]).toBe(w.steps[0])
    expect(e.session.working.steps[1]).toBe(w.steps[1])
    expect(e.redo).toHaveLength(1)
    e.redoLast()
    expect(e.session.working.steps[2]).toBe(after.steps[2])
    expect(e.session.working.steps[0]).toBe(w.steps[0])
    expect(e.undo).toHaveLength(1)
  })
  it('선택도 함께 되돌린다, 머리말·운영 속성은 건드리지 않는다', () => {
    const [e] = mk()
    e.selection = { uids: ['a'], anchor: 'a' }
    e.run('넣음', (w) => ({ ..._ins(w, { uid: 'n', next: {} }, { beforeUid: null }), selection: { uids: ['n'], anchor: 'n' } }))
    expect(e.selection).toEqual({ uids: ['n'], anchor: 'n' })
    const w2 = { ...e.session.working, property: { changed: 1 } }
    e.session = { ...e.session, working: w2 }
    e.undoLast()
    expect(e.selection).toEqual({ uids: ['a'], anchor: 'a' })
    expect(e.session.working.property).toEqual({ changed: 1 })
  })
  it('되돌릴 것이 없으면 아무 일 없다', () => {
    const [e, w] = mk()
    expect(e.undoLast()).toBe(false)
    expect(e.redoLast()).toBe(false)
    expect(e.session.working).toBe(w)
  })
  it('run 다시 하면 redo 가 비워진다', () => {
    const [e] = mk()
    e.run('a', ins('n')); e.undoLast()
    e.run('b', ins('m'))
    expect(e.redo).toEqual([])
  })
})

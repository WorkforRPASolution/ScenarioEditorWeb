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

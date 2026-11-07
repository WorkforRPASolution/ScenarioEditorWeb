import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const api = vi.hoisted(() => ({ me: vi.fn(), scopes: vi.fn(), dataCheck: vi.fn(), refreshCache: vi.fn(), open: vi.fn(), list: vi.fn(), versions: vi.fn() }))
vi.mock('../api', () => ({ scenarioEditorApi: api }))
import { useEditorStore } from '../stores/editorStore'
import { useEditStore } from '../stores/editStore'
import { t } from '../messages'

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

describe('editStore 선택 — 여러 줄 선택과 초점(editorStore.selectedUid)', () => {
  const st = (uid, over = {}) => ({ uid, origin: 0, condition: { kind: 'none' }, action: { type: 0 }, retry: {}, next: { onTrue: { kind: 'next' }, onFalse: { kind: 'end', value: 'FAIL' } }, descriptionToEmail: uid, images: { train: {}, base: null }, ...over })
  const mk = () => {
    const w = { source: { process: 'P', model: 'M', name: 'N', crtime: 1, fileId: 'f' }, headCrtime: 1, header: {}, steps: [st('a'), st('b'), st('c'), st('d')], property: {} }
    const s = useEditorStore()
    const sk = { ...skeleton, steps: w.steps.map((x, i) => ({ ...x, no: i + 1, notes: [] })), edited: w }
    s.skeleton = sk
    const e = useEditStore()
    e.begin(sk, { canWrite: true }) // openScenario 처럼 날 객체(toRaw)로
    return { s, e, w }
  }
  beforeEach(() => setActivePinia(createPinia()))

  it('editorStore 로 초점을 옮기면(순서도·상세·경고 순회) 여러 줄 선택이 그 한 줄로 접힌다', () => {
    const { s, e } = mk()
    e.setSelection({ uids: ['a', 'b'], anchor: 'a' })
    expect(s.selectedUid).toBe('a')
    s.select('c')
    expect(e.selection).toEqual({ uids: ['c'], anchor: 'c' })
    s.moveSelection(1)
    expect(e.selection).toEqual({ uids: ['d'], anchor: 'd' })
  })
  it('열면 첫 스텝이 선택에 들어간다(앞 시나리오와 uid 가 같아도)', async () => {
    api.open.mockReturnValue(ok(skeleton))
    const s = useEditorStore()
    s.me = { canWrite: true }
    await s.openScenario({ process: 'P', model: 'M', name: 'N' })
    await s.openScenario({ process: 'P', model: 'M', name: 'N' })
    expect(useEditStore().selection).toEqual({ uids: ['s0'], anchor: 's0' })
  })
  it('clickRow: Shift 는 기준 줄부터 범위, Ctrl 은 더하기·빼기, 한 줄만 남으면 그 줄이 기준', () => {
    const { s, e } = mk()
    e.clickRow('b')
    e.clickRow('d', { shift: true })
    expect(e.selection).toEqual({ uids: ['b', 'c', 'd'], anchor: 'b' })
    e.clickRow('a', { shift: true })
    expect(e.selection).toEqual({ uids: ['a', 'b'], anchor: 'b' })
    e.clickRow('b', { toggle: true })
    expect(e.selection).toEqual({ uids: ['a'], anchor: 'a' })
    expect(s.selectedUid).toBe('a')
  })
  it('requestSelect: 패널에 적용 안 한 변경이 있으면 확인 창(guard)을 세우고 선택은 그대로', () => {
    const { s, e, w } = mk()
    s.select('a')
    e.panel = { uid: 'a', isNew: false, draft: { ...w.steps[0], descriptionToEmail: '고침' }, base: w.steps[0] }
    expect(e.requestSelect('c')).toBe(false)
    expect(e.dialog).toEqual({ kind: 'guard', to: 'c' })
    expect(s.selectedUid).toBe('a')
    e.dialog = null
    expect(e.requestSelect('a')).toBe(true) // 같은 줄은 묻지 않는다
    e.panel = { uid: 'a', isNew: false, draft: { ...w.steps[0] }, base: w.steps[0] }
    expect(e.requestSelect('c')).toBe(true)
    expect(s.selectedUid).toBe('c')
    expect(e.selection).toEqual({ uids: ['c'], anchor: 'c' })
  })
  it('되돌리기는 선택과 초점을 함께 되돌린다', () => {
    const { s, e } = mk()
    e.setSelection({ uids: ['b'], anchor: 'b' })
    e.deleteSelection()
    expect(s.selectedUid).toBe('c')
    e.undoCommand()
    expect(s.selectedUid).toBe('b')
    expect(e.selection).toEqual({ uids: ['b'], anchor: 'b' })
  })
  it('잘라내 붙이면 같은 스텝이 옮겨지고 묶음은 비워진다, 잘라낸 범위 안은 막는다', () => {
    const { e, w } = mk()
    e.setSelection({ uids: ['a', 'b'], anchor: 'a' })
    e.copySelection(true)
    expect(e.clip.cut).toBe(true)
    e.pasteClip('after')
    expect(e.toast.text).toBe('잘라낸 범위 안에는 붙여넣을 수 없습니다. 다른 자리를 고르세요.')
    e.setSelection({ uids: ['d'], anchor: 'd' })
    e.pasteClip('after')
    expect(e.session.working.steps.map((x) => x.uid)).toEqual(['c', 'd', 'a', 'b'])
    expect(e.session.working.steps[2]).toBe(w.steps[0])
    expect(e.clip).toBe(null)
    expect(e.selection).toEqual({ uids: ['a', 'b'], anchor: 'a' })
  })
  it('복사해 붙인 스텝은 새 uid, 붙일 때마다 다르다', () => {
    const { e } = mk()
    e.setSelection({ uids: ['a'], anchor: 'a' })
    e.copySelection(false)
    e.pasteClip('end'); e.pasteClip('end')
    const ids = e.session.working.steps.map((x) => x.uid)
    expect(ids).toHaveLength(6)
    expect(new Set(ids).size).toBe(6)
  })
  it('같은 작업본 안에서 잘라 옮기면 설비 상태 스텝이 있어도 알리지 않는다(원래 스텝이라 서버가 막지 않음), 복사는 알린다', () => {
    const { e } = mk()
    const eqp = { ...e.session.working.steps[0], condition: { kind: 'eqpState' } }
    e.session = { ...e.session, working: { ...e.session.working, steps: [eqp, ...e.session.working.steps.slice(1)] } }
    e.setSelection({ uids: ['a'], anchor: 'a' })
    e.copySelection(true)
    expect(e.clip.eqpStateCount).toBe(1)
    e.setSelection({ uids: ['d'], anchor: 'd' })
    expect(e.pasteClip('after')).toBe(true)
    expect(e.dialog).toBe(null)
    expect(e.session.working.steps.map((x) => x.uid)).toEqual(['b', 'c', 'd', 'a'])
    e.setSelection({ uids: ['a'], anchor: 'a' })
    e.copySelection(false)
    expect(e.pasteClip('end')).toBe(false)
    expect(e.dialog).toEqual({ kind: 'pasteWarn', where: 'end', n: 1 })
  })
  it('알림 문구는 messages.js 에서 온다(옮김·갈 곳 바꿈)', () => {
    const { e } = mk()
    e.setSelection({ uids: ['a'], anchor: 'a' })
    e.moveSelected(1)
    expect(e.toast.text).toBe(t('SEW_CMD_MOVED_DOWN', { what: t('SEW_CMD_WHAT_STEP', { no: 1 }) }))
    e.setSelection({ uids: ['a', 'c'], anchor: 'a' })
    e.moveSelected(1)
    expect(e.toast.text).toBe(t('SEW_CMD_MOVED_DOWN', { what: t('SEW_CMD_WHAT_STEPS', { n: 2 }) }))
    e.editCell('b', 'onFalse', { kind: 'step', uid: 'd' })
    expect(e.toast.text).toBe(t('SEW_CMD_CELL_TARGET', { no: 1, which: t('SEW_CMD_WHICH_ON_FALSE'), to: t('SEW_CMD_TARGET_STEP', { no: 2 }) })) // [b, d, a, c]
  })
  it('떨어진 줄 복사는 막고 이유를 알린다', () => {
    const { e } = mk()
    e.setSelection({ uids: ['a', 'c'], anchor: 'a' })
    e.copySelection(false)
    expect(e.clip).toBe(null)
    expect(e.toast.text).toBe('연속한 스텝만 고를 수 있습니다.')
  })
})

// ── 오른쪽 편집 패널(Task 6): openPanel·applyPanel·discardPanel·guard ──
import { panelFixture, imageStep, noneStep } from './panelFixture'
describe('editStore — 패널', () => {
  beforeEach(() => setActivePinia(createPinia()))
  const mk = () => panelFixture([imageStep(0), imageStep(1), noneStep(2)])
  const setAccept = (e, v) => e.updateDraft((d) => ({ ...d, condition: { ...d.condition, image: { ...d.condition.image, accept: v } } }))

  it('고른 스텝을 패널이 연다 — 초안·기준은 작업본 스텝 그대로(같은 객체), 초점이 옮겨지면 따라간다', () => {
    const { s, e, edited } = mk()
    expect(e.panel).toEqual({ uid: 's0', isNew: false, draft: edited.steps[0], base: edited.steps[0] })
    expect(e.panel.draft).toBe(edited.steps[0])
    s.select('s2')
    expect(e.panel.uid).toBe('s2')
    expect(e.panel.draft).toBe(edited.steps[2])
  })
  it('읽기 전용 세션은 패널을 열지 않는다', () => {
    const { e } = panelFixture([imageStep(0)], { isCurrent: false })
    expect(e.panel.uid).toBe(null)
  })
  it('applyPanel: 검사를 통과하면 한 명령으로 작업본에 넣고(알림 "N번 스텝에 적용했습니다"), 다른 스텝은 같은 객체', () => {
    const { e, edited } = mk()
    setAccept(e, 0.8)
    expect(e.panelDirty()).toBe(true)
    expect(e.applyPanel()).toBe(true)
    const w = e.session.working
    expect(w.steps[0].condition.image.accept).toBe(0.8)
    expect(w.steps[1]).toBe(edited.steps[1])
    expect(e.undo).toHaveLength(1)
    expect(e.toast.text).toBe(t('SEW_CMD_APPLIED', { no: 1 }))
    expect(e.panelDirty()).toBe(false)
    expect(e.panel.base).toBe(w.steps[0])
    e.undoCommand()
    expect(e.session.working.steps).toBe(edited.steps)
    expect(e.panel.draft).toBe(edited.steps[0]) // 되돌리면 패널도 따라간다
  })
  it('applyPanel: 오류가 있으면 작업본을 바꾸지 않고 첫 오류 칸에 초점을 요청한다', () => {
    const { e, edited } = mk()
    e.updateDraft((d) => ({ ...d, descriptionToEmail: '', retry: { ...d.retry, intervalMs: 1000 } }))
    expect(e.applyPanel()).toBe(false)
    expect(e.session.working).toBe(edited)
    expect(e.undo).toHaveLength(0)
    expect(e.focusReq.field).toBe('desc')
  })
  it('applyPanel: 초안이 기준과 같으면 아무것도 쌓지 않는다', () => {
    const { e, edited } = mk()
    setAccept(e, 0.8); setAccept(e, 0.9)
    expect(e.panelDirty()).toBe(false)
    expect(e.applyPanel()).toBe(true)
    expect(e.undo).toHaveLength(0)
    expect(e.session.working).toBe(edited)
    expect(e.panel.draft).toBe(edited.steps[0])
  })
  it('applyPanel: 저장 기준점과 같은 값으로 돌려 적용하면 그 스텝 객체를 다시 쓴다(서버가 고친 스텝으로 보지 않게)', () => {
    const { e, edited } = mk()
    e.editCell('s0', 'accept', 0.7)
    setAccept(e, 0.9)
    expect(e.applyPanel()).toBe(true)
    expect(e.session.working.steps[0]).toBe(edited.steps[0])
  })
  it('discardPanel: 패널을 마지막 적용 값으로', () => {
    const { e, edited } = mk()
    setAccept(e, 0.8)
    e.discardPanel()
    expect(e.panel.draft).toBe(edited.steps[0])
    expect(e.panelDirty()).toBe(false)
  })
  it('guard: 적용 안 한 변경이 없으면 바로 하고, 있으면 확인 창을 세운다 — [계속 고치기]·[버리고 이동]·[적용하고 이동]', () => {
    const { s, e, edited } = mk()
    const next = vi.fn()
    expect(e.guard(next)).toBe(true)
    expect(next).toHaveBeenCalledTimes(1)
    setAccept(e, 0.8)
    expect(e.guard(next)).toBe(false)
    expect(e.dialog).toEqual({ kind: 'guard', to: null })
    e.guardKeep()
    expect(e.dialog).toBe(null)
    expect(next).toHaveBeenCalledTimes(1)
    expect(e.panel.draft.condition.image.accept).toBe(0.8)
    // 다른 줄 누름 → [버리고 이동]
    e.clickRow('s1')
    expect(e.dialog).toEqual({ kind: 'guard', to: 's1' })
    expect(s.selectedUid).toBe('s0')
    e.guardDrop()
    expect(e.session.working).toBe(edited)
    expect(s.selectedUid).toBe('s1')
    expect(e.panel.draft).toBe(edited.steps[1])
    // 다시 고치고 다른 줄 → [적용하고 이동]
    setAccept(e, 0.75)
    e.clickRow('s0')
    e.guardApply()
    expect(e.session.working.steps[1].condition.image.accept).toBe(0.75)
    expect(s.selectedUid).toBe('s0')
    expect(e.dialog).toBe(null)
  })
  it('guardApply: 오류가 있으면 이동하지 않고 오류 칸에 초점(초안은 남는다)', () => {
    const { s, e } = mk()
    e.updateDraft((d) => ({ ...d, descriptionToEmail: 'a@b' }))
    e.clickRow('s1')
    expect(e.guardApply()).toBe(false)
    expect(s.selectedUid).toBe('s0')
    expect(e.dialog).toBe(null)
    expect(e.panel.draft.descriptionToEmail).toBe('a@b')
    expect(e.focusReq.field).toBe('desc')
  })
  it('적용 안 한 변경이 있으면 표 칸·삭제·붙여넣기·되돌리기도 먼저 묻는다', () => {
    const { e, edited } = mk()
    e.editCell('s1', 'skip', true)
    const after = e.session.working
    setAccept(e, 0.8)
    for (const run of [() => e.editCell('s1', 'skip', false), () => e.deleteSelection(), () => e.undoCommand(), () => e.redoCommand()]) {
      e.dialog = null
      expect(run()).toBe(false)
      expect(e.dialog?.kind).toBe('guard')
      expect(e.session.working).toBe(after)
    }
    e.guardDrop() // 마지막으로 미룬 것(다시 하기 — 할 것 없음)
    e.setSelection({ uids: ['s1'], anchor: 's1' })
    e.copySelection(false)
    setAccept(e, 0.6)
    expect(e.pasteClip('after')).toBe(false)
    expect(e.dialog?.kind).toBe('guard')
    e.guardDrop()
    expect(e.session.working.steps).toHaveLength(4)
    expect(edited.steps).toHaveLength(3)
  })
  it('editorStore 로 초점을 옮겨도(순서도·경고 순회) 적용 안 한 변경이 있으면 묻는다', () => {
    const { s, e } = mk()
    setAccept(e, 0.8)
    s.select('s2')
    expect(s.selectedUid).toBe('s0')
    expect(e.dialog).toEqual({ kind: 'guard', to: 's2' })
    e.guardDrop()
    expect(s.selectedUid).toBe('s2')
  })
  it('여러 줄 선택(Shift)은 묻지 않고 패널 초안을 그대로 둔다, 그 줄로 돌아오면 이어서 고친다', () => {
    const { s, e } = mk()
    setAccept(e, 0.8)
    e.clickRow('s2', { shift: true })
    expect(e.dialog).toBe(null)
    e.clickRow('s0', { toggle: true }) // 기준 줄을 빼면 초점이 남은 줄로
    expect(e.panel.draft.condition.image.accept).toBe(0.8)
    expect(e.panel.uid).toBe('s0')
    e.clickRow('s0')
    expect(e.dialog).toBe(null)
    expect(s.selectedUid).toBe('s0')
    expect(e.panel.draft.condition.image.accept).toBe(0.8)
  })
})

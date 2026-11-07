import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const api = vi.hoisted(() => ({ me: vi.fn(), scopes: vi.fn(), dataCheck: vi.fn(), refreshCache: vi.fn(), open: vi.fn(), list: vi.fn(), versions: vi.fn() }))
vi.mock('../api', () => ({ scenarioEditorApi: api, imageUrl: (p) => `http://x/api${p}` }))
// 큰 화면 잡기의 브라우저 전용 부분(fetch·canvas)은 가짜로 — 저장소가 부르는 값과 그 결과만 본다.
const fx = vi.hoisted(() => ({ loadBitmap: vi.fn(), cropPng: vi.fn(), imageDataOf: vi.fn(), locate: vi.fn() }))
vi.mock('../editor/images', async (orig) => ({ ...(await orig()), loadBitmap: fx.loadBitmap }))
vi.mock('../editor/crop', async (orig) => ({ ...(await orig()), cropPng: fx.cropPng, imageDataOf: fx.imageDataOf }))
vi.mock('../editor/locate', () => ({ locate: fx.locate }))
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
    expect(e.dialog).toEqual({ kind: 'guard', action: 'move', to: 'c' })
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
    expect(e.dialog).toEqual({ kind: 'guard', action: 'move', to: null })
    e.guardKeep()
    expect(e.dialog).toBe(null)
    expect(next).toHaveBeenCalledTimes(1)
    expect(e.panel.draft.condition.image.accept).toBe(0.8)
    // 다른 줄 누름 → [버리고 이동]
    e.clickRow('s1')
    expect(e.dialog).toEqual({ kind: 'guard', action: 'move', to: 's1' })
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
    expect(e.dialog).toEqual({ kind: 'guard', action: 'move', to: 's2' })
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

// R-T6c: 확인 창 버튼은 미룬 일에 따른다 — 이동은 [버리고 이동]·[적용하고 이동], 작업본 명령은 [버리고 계속]·[적용하고 계속], 되돌리기·다시 하기는 버리기만.
describe('editStore — 확인 창이 미룬 일(R-T6c)', () => {
  beforeEach(() => setActivePinia(createPinia()))
  const mk = () => panelFixture([imageStep(0), imageStep(1), noneStep(2)])
  const setAccept = (e, v) => e.updateDraft((d) => ({ ...d, condition: { ...d.condition, image: { ...d.condition.image, accept: v } } }))

  it('되돌리기: 적용하는 갈래가 없고, [버리고 되돌리기] 는 사용자의 앞 명령을 되돌린다', () => {
    const { e, edited } = mk()
    e.editCell('s1', 'skip', true) // 사용자의 앞 명령
    setAccept(e, 0.8)
    expect(e.undoCommand()).toBe(false)
    expect(e.dialog).toEqual({ kind: 'guard', action: 'undo', to: null })
    expect(e.guardApply()).toBe(false) // 되돌리기에는 적용하는 갈래가 없다 — 아무것도 바꾸지 않는다
    expect(e.undo).toHaveLength(1)
    expect(e.session.working.steps[0]).toBe(edited.steps[0])
    e.guardDrop()
    expect(e.session.working.steps).toBe(edited.steps) // 표 칸 고침이 되돌려졌다
    expect(e.panel.draft).toBe(edited.steps[0])
    expect(e.redo).toHaveLength(1)
  })
  it('다시 하기: [버리고 다시 하기] 는 되돌린 명령을 다시 한다(적용이 redo 를 비우지 않는다)', () => {
    const { e } = mk()
    e.editCell('s1', 'skip', true)
    e.undoCommand()
    setAccept(e, 0.8)
    expect(e.redoCommand()).toBe(false)
    expect(e.dialog).toEqual({ kind: 'guard', action: 'redo', to: null })
    expect(e.guardApply()).toBe(false)
    expect(e.redo).toHaveLength(1)
    e.guardDrop()
    expect(e.session.working.steps[1].condition.skipPreprocessing).toBe(true)
    expect(e.panel.draft.condition.image.accept).toBe(0.9)
  })
  it('작업본 명령(표 칸·삭제·붙여넣기·옮기기): [적용하고 계속] 은 적용한 뒤 그 명령을 한다', () => {
    const { e } = mk()
    setAccept(e, 0.8)
    e.editCell('s1', 'skip', true)
    expect(e.dialog).toEqual({ kind: 'guard', action: 'command', to: null })
    expect(e.guardApply()).toBe(true)
    expect(e.session.working.steps[0].condition.image.accept).toBe(0.8)
    expect(e.session.working.steps[1].condition.skipPreprocessing).toBe(true)
    expect(e.undo).toHaveLength(2)
    setAccept(e, 0.7)
    expect(e.moveSelected(1)).toBe(false)
    expect(e.dialog?.action).toBe('command')
    e.guardApply()
    expect(e.session.working.steps.map((x) => x.uid)).toEqual(['s1', 's0', 's2'])
    expect(e.session.working.steps[1].condition.image.accept).toBe(0.7)
  })
  it('guard 의 onKeep 은 [계속 고치기] 에서 부른다(다른 시나리오 열기를 접을 때 주소를 되돌린다)', () => {
    const { e } = mk()
    setAccept(e, 0.8)
    const next = vi.fn(); const keep = vi.fn()
    e.guard(next, { action: 'open', onKeep: keep })
    expect(e.dialog).toEqual({ kind: 'guard', action: 'open', to: null })
    e.guardKeep()
    expect(keep).toHaveBeenCalledTimes(1)
    expect(next).not.toHaveBeenCalled()
  })
})

import { STEP_MAX } from '../editor/commands'
describe('editStore — 큰 화면 잡기·[다시 찍기]·새 스텝(Task 7)', () => {
  const BITMAP = { width: 1000, height: 500 }
  const url = (id) => `http://x/api/scenario-editor/scenarios/P/M/N/versions/1/files/F/images/${id}`
  beforeEach(() => {
    setActivePinia(createPinia())
    Object.values(fx).forEach((f) => f.mockReset())
    fx.loadBitmap.mockResolvedValue(BITMAP)
    fx.cropPng.mockImplementation(async () => new Blob(['png'], { type: 'image/png' }))
    fx.imageDataOf.mockImplementation((b) => ({ width: b.width, height: b.height, data: new Uint8ClampedArray(0) }))
  })
  const mk = (steps = [imageStep(0), imageStep(1), noneStep(2)], opts) => panelFixture(steps, opts)
  const validNone = (d) => ({ ...d, descriptionToEmail: '재시작', action: { ...d.action, command: 'restart.bat' } })

  it('새 이미지 스텝: 고른 스텝의 기준 화면 참조로 초안을 열고 검색 영역 잡기부터 — 작업본은 그대로', () => {
    const { s, e, edited } = mk()
    s.select('s1')
    expect(e.startNew('image')).toBe(true)
    const p = e.panel
    expect(p).toMatchObject({ isNew: true, insertBefore: 's1', tried: false })
    expect(p.uid).toMatch(/^n\d+$/)
    expect(p.draft.uid).toBe(p.uid)
    expect(p.draft.images.base).toEqual({ from: 'source', id: 's1-bi' })
    expect(e.capture).toMatchObject({ flow: ['area', 'train', 'click'], stage: 'area' })
    expect(e.selection).toEqual({ uids: [], anchor: null })
    expect(s.selectedUid).toBe(null)
    expect(e.session.working).toBe(edited)
  })
  it('captureNext 세 번 → 초안의 검색 영역·찾을 그림(올릴 그림, 키 0)·누를 곳(찾을 그림 왼쪽 위 기준)', async () => {
    const { e, edited } = mk()
    e.startNew('image')
    await e.captureNext({ x: 10, y: 20, w: 300, h: 200 })
    expect(e.capture.stage).toBe('train')
    await e.captureNext({ x: 50, y: 60, w: 40, h: 30 })
    expect(fx.loadBitmap).toHaveBeenCalledWith(url('s0-bi'))
    expect(fx.cropPng).toHaveBeenCalledWith(BITMAP, { x: 50, y: 60, w: 40, h: 30 })
    expect(e.capture.stage).toBe('click')
    await e.captureNext({ x: 70.4, y: 64.6 })
    expect(e.capture).toBe(null)
    const d = e.panel.draft
    expect(d.condition.searchArea).toEqual({ x: 10, y: 20, w: 300, h: 200 })
    expect(Object.keys(d.images.train)).toEqual(['0'])
    const ref = d.images.train['0']
    expect(ref.from).toBe('upload')
    expect(e.uploads.get(ref.tempId)).toBeInstanceOf(Blob)
    expect(d.condition.image.trainImages).toEqual([{ key: 0, type: true }])
    expect(d.action.click).toEqual({ x: 20, y: 5, basis: 'trainImage' })
    expect(e.session.working).toBe(edited)
  })
  it('너무 작게 끈 사각형은 알리고 단계를 넘기지 않는다, 찾을 그림은 검색 영역 안으로 잘라 자른다', async () => {
    const { e } = mk()
    e.startNew('image')
    expect(await e.captureNext({ x: 0, y: 0, w: 5, h: 50 })).toBe(false)
    expect(e.capture.stage).toBe('area')
    expect(e.toast.text).toBe(t('SEW_CAP_TOO_SMALL'))
    await e.captureNext({ x: 100, y: 100, w: 100, h: 100 })
    await e.captureNext({ x: 50, y: 150, w: 100, h: 20 })
    expect(fx.cropPng).toHaveBeenCalledWith(BITMAP, { x: 100, y: 150, w: 50, h: 20 })
  })
  it('Esc(cancelCapture) → 잡기 전 초안 그대로', async () => {
    const { e, edited } = mk()
    e.startCapture(['area', 'train', 'click'])
    await e.captureNext({ x: 1, y: 2, w: 30, h: 40 })
    expect(e.panelDirty()).toBe(true)
    expect(e.cancelCapture()).toBe(true)
    expect(e.capture).toBe(null)
    expect(e.panel.draft).toBe(edited.steps[0])
    expect(e.panelDirty()).toBe(false)
  })
  it('취소는 잡기가 쓴 칸(검색 영역·찾을 그림·누를 곳)만 되돌리고, 잡는 사이 고친 설명·정확도·갈 곳은 남긴다', async () => {
    const { e, edited } = mk()
    const st = edited.steps[0]
    e.startCapture(['area', 'train', 'click'])
    await e.captureNext({ x: 1, y: 2, w: 30, h: 40 })
    e.updateDraft((d) => ({ ...d, descriptionToEmail: '잡는 중 고친 설명', next: { ...d.next, onFalse: { kind: 'end', value: 'SKIP' } } }))
    await e.captureNext({ x: 5, y: 6, w: 20, h: 20 })
    e.updateDraft((d) => ({ ...d, condition: { ...d.condition, image: { ...d.condition.image, accept: 0.8 } } }))
    await e.captureNext({ x: 10, y: 12 })
    expect(e.capture).toBe(null) // 끝까지 잡았다 — 다시 잡아 취소해 본다
    const done = e.panel.draft
    e.startCapture(['area', 'train', 'click'])
    await e.captureNext({ x: 100, y: 100, w: 50, h: 50 })
    e.updateDraft((d) => ({ ...d, descriptionToEmail: '두 번째 설명' }))
    expect(e.cancelCapture()).toBe(true)
    const d = e.panel.draft
    expect(d.condition.searchArea).toEqual(done.condition.searchArea)
    expect(d.images.train).toBe(done.images.train)
    expect(d.descriptionToEmail).toBe('두 번째 설명')
    expect(d.condition.image.accept).toBe(0.8)
    expect(d.next.onFalse).toEqual({ kind: 'end', value: 'SKIP' })
    // 처음 잡기 전 값으로 되돌릴 때도 같다
    setActivePinia(createPinia())
    const b = mk()
    b.e.startCapture(['area', 'train', 'click'])
    await b.e.captureNext({ x: 1, y: 2, w: 30, h: 40 })
    await b.e.captureNext({ x: 5, y: 6, w: 20, h: 20 })
    b.e.updateDraft((x) => ({ ...x, descriptionToEmail: '고친 설명' }))
    b.e.cancelCapture()
    const r = b.e.panel.draft
    expect(r.condition.searchArea).toBe(b.edited.steps[0].condition.searchArea)
    expect(r.images.train).toBe(b.edited.steps[0].images.train)
    expect(r.condition.image.trainImages).toBe(b.edited.steps[0].condition.image.trainImages)
    expect(r.action).toBe(b.edited.steps[0].action)
    expect(r.descriptionToEmail).toBe('고친 설명')
    expect(st).toBe(edited.steps[0])
  })
  it('취소: 누를 곳을 찍은 뒤면 원래 누를 곳으로, 잡는 사이 동작 종류를 바꿨으면 동작은 그대로', async () => {
    const { e, edited } = mk()
    e.startCapture(['click'], { train: { x: 0, y: 0, w: 10, h: 10 } })
    await e.captureNext({ x: 3, y: 4 })
    expect(e.panel.draft.action.click).toEqual({ x: 3, y: 4, basis: 'trainImage' })
    e.startCapture(['click'], { train: { x: 0, y: 0, w: 10, h: 10 } })
    e.cancelCapture()
    expect(e.panel.draft.action.click).toEqual({ x: 3, y: 4, basis: 'trainImage' })
    e.discardPanel()
    e.startCapture(['area', 'train', 'click'])
    e.updateDraft((d) => ({ ...d, action: { type: 6, typeName: 'Wait', waitSec: 5 } }))
    e.cancelCapture()
    expect(e.panel.draft.action).toEqual({ type: 6, typeName: 'Wait', waitSec: 5 })
    expect(e.panel.draft.condition).toBe(edited.steps[0].condition)
  })
  it('기준 화면 그림이 없는 스텝은 잡기·[다시 찍기]를 시작하지 않고 이유를 알린다(canCapture)', async () => {
    const noBase = imageStep(0, { images: { train: { 0: { from: 'source', id: 's0-train-0' } }, base: { literal: 'AA==' } } })
    const { e } = mk([noBase, imageStep(1)])
    expect(e.canCapture).toBe(false)
    expect(e.startCapture(['area', 'train', 'click'])).toBe(false)
    expect(e.capture).toBe(null)
    expect(e.toast.text).toBe(t('SEW_CAP_NO_BASE_IMAGE'))
    e.toast = null
    expect(await e.repick()).toBe(false)
    expect(fx.loadBitmap).not.toHaveBeenCalled()
    expect(e.capture).toBe(null)
    expect(e.toast.text).toBe(t('SEW_CAP_NO_BASE_IMAGE'))
    e.requestSelect('s1')
    expect(e.canCapture).toBe(true)
  })
  it('자르는 사이 취소하면 자른 그림을 쓰지 않는다', async () => {
    const { e, edited } = mk()
    e.startCapture(['train', 'click'])
    const pending = e.captureNext({ x: 20, y: 30, w: 40, h: 30 })
    e.cancelCapture()
    expect(await pending).toBe(false)
    expect(e.panel.draft).toBe(edited.steps[0])
    expect(e.capture).toBe(null)
  })
  it('기준 화면을 불러오지 못하면 알리고 그림 단계에 머문다', async () => {
    const { e, edited } = mk()
    e.startCapture(['train', 'click'])
    fx.loadBitmap.mockRejectedValueOnce(new Error('image 500'))
    expect(await e.captureNext({ x: 20, y: 30, w: 40, h: 30 })).toBe(false)
    expect(e.capture.stage).toBe('train')
    expect(e.toast.text).toBe(t('SEW_CAP_CROP_FAILED'))
    expect(e.panel.draft).toBe(edited.steps[0])
  })
  it('잡기는 패널 초안만 바꾸고 [적용]해야 작업본이 바뀐다 — [적용]·[되돌리기]·다른 줄은 잡기를 끝낸다', async () => {
    const { e, edited } = mk()
    e.startCapture(['area', 'train'])
    await e.captureNext({ x: 5, y: 6, w: 100, h: 90 })
    await e.captureNext({ x: 10, y: 10, w: 20, h: 20 })
    expect(e.capture).toBe(null)
    expect(e.session.working).toBe(edited)
    expect(e.applyPanel()).toBe(true)
    const st = e.session.working.steps[0]
    expect(st.condition.searchArea).toEqual({ x: 5, y: 6, w: 100, h: 90 })
    expect(st.images.train['0'].from).toBe('upload')
    expect(e.session.working.steps[1]).toBe(edited.steps[1])
    e.startCapture(['area'])
    e.discardPanel()
    expect(e.capture).toBe(null)
    e.startCapture(['area'])
    e.clickRow('s1')
    expect(e.capture).toBe(null)
    expect(e.panel.uid).toBe('s1')
  })
  it('[다시 찍기]: 기준 화면 검색 영역에서 찾을 그림이 한 곳이면 누를 곳만 찍는다(찾은 자리 기준)', async () => {
    const { e, edited } = mk()
    fx.loadBitmap.mockImplementation(async (u) => (u.endsWith('-train-0') ? { width: 20, height: 10 } : BITMAP))
    fx.locate.mockReturnValue({ found: 'one', x: 40, y: 50 })
    await e.repick()
    expect(fx.loadBitmap).toHaveBeenCalledWith(url('s0-bi'))
    expect(fx.loadBitmap).toHaveBeenCalledWith(url('s0-train-0'))
    expect(fx.locate).toHaveBeenCalledWith(expect.objectContaining({ width: 1000 }), expect.objectContaining({ width: 20 }), { x: 10, y: 20, w: 300, h: 200 }, expect.anything())
    expect(e.capture).toMatchObject({ flow: ['click'], stage: 'click', train: { x: 40, y: 50, w: 20, h: 10 }, why: null })
    expect(e.locating).toBe(false)
    await e.captureNext({ x: 45, y: 62 })
    expect(e.capture).toBe(null)
    expect(e.panel.draft.action.click).toEqual({ x: 5, y: 12, basis: 'trainImage' })
    expect(e.panel.draft.images).toBe(edited.steps[0].images) // 찾을 그림은 그대로
    expect(e.panel.draft.condition).toBe(edited.steps[0].condition) // 검색 영역도 그대로
  })
  it('누를 곳 단계에서 동작을 클릭이 아닌 것으로 바꿨으면 좌표를 넣지 않고 잡기를 끝낸다', async () => {
    const { e } = mk()
    e.startCapture(['click'], { train: { x: 0, y: 0, w: 10, h: 10 } })
    e.updateDraft((d) => ({ ...d, action: { type: 6, typeName: 'Wait', waitSec: 5 } }))
    expect(await e.captureNext({ x: 5, y: 5 })).toBe(false)
    expect(e.capture).toBe(null)
    expect(e.panel.draft.action).toEqual({ type: 6, typeName: 'Wait', waitSec: 5 })
  })
  it('[다시 찍기]: 여러 곳·없음·시간 초과·불러오기 실패면 이유를 보이고 그림부터 잡는다', async () => {
    for (const [found, key] of [['many', 'SEW_CAP_WHY_MANY'], ['none', 'SEW_CAP_WHY_NONE'], ['timeout', 'SEW_CAP_WHY_TIMEOUT']]) {
      setActivePinia(createPinia())
      const { e } = mk()
      fx.locate.mockReturnValue({ found })
      await e.repick()
      expect(e.capture, found).toMatchObject({ flow: ['train', 'click'], stage: 'train', why: t(key) })
    }
    setActivePinia(createPinia())
    const { e } = mk()
    fx.loadBitmap.mockRejectedValue(new Error('image 404'))
    await e.repick()
    expect(e.capture).toMatchObject({ flow: ['train', 'click'], why: t('SEW_CAP_WHY_ERROR') })
    expect(e.locating).toBe(false)
  })
  it('[다시 찍기]: 찾을 그림이 없으면 위치를 찾지 않고 그림부터', async () => {
    const { e } = mk([imageStep(0, { images: { train: {}, base: { from: 'source', id: 's0-bi' } } }), noneStep(1)])
    await e.repick()
    expect(fx.locate).not.toHaveBeenCalled()
    expect(e.capture).toMatchObject({ flow: ['train', 'click'], stage: 'train', why: null })
  })
  it('[다시 찍기]: 찾는 사이 다른 스텝으로 가면 결과를 버린다', async () => {
    const { e } = mk()
    fx.locate.mockReturnValue({ found: 'one', x: 1, y: 1 })
    const pending = e.repick()
    e.clickRow('s1')
    await pending
    expect(e.capture).toBe(null)
    expect(e.panel.uid).toBe('s1')
  })
  it('새 OCR 스텝은 문자 영역 하나만 잡는다(자르지 않음)', async () => {
    const { e } = mk()
    e.startNew('ocr')
    expect(e.capture).toMatchObject({ flow: ['ocr'], stage: 'ocr' })
    await e.captureNext({ x: 3, y: 4, w: 50, h: 20 })
    expect(e.capture).toBe(null)
    expect(e.panel.draft.condition.searchArea).toEqual({ x: 3, y: 4, w: 50, h: 20 })
    expect(fx.cropPng).not.toHaveBeenCalled()
  })
  it('새 조건 없음 스텝: 기준 화면 literal·잡기 없음 — [N번 앞에 넣기]는 칸 검사 뒤 insertStep, 되돌리면 넣기 전으로', () => {
    const { s, e, edited } = mk()
    s.select('s1')
    e.startNew('none')
    expect(e.capture).toBe(null)
    expect(e.panel.draft.images.base).toEqual({ literal: 'AA==' })
    expect(e.addNew('before')).toBe(false) // 설명·명령이 비었다
    expect(e.session.working).toBe(edited)
    expect(e.panel.tried).toBe(true)
    expect(e.focusReq.field).toBe('desc')
    e.updateDraft(validNone)
    const uid = e.panel.uid
    expect(e.addNew('before')).toBe(true)
    const ws = e.session.working.steps
    expect(ws.map((x) => x.uid)).toEqual(['s0', uid, 's1', 's2'])
    expect(ws[1]).toMatchObject({ uid, origin: null, descriptionToEmail: '재시작', images: { train: {}, base: { literal: 'AA==' } } })
    expect(ws[0]).toBe(edited.steps[0])
    expect(ws[2]).toBe(edited.steps[1])
    expect(e.toast.text).toBe(t('SEW_CMD_INSERTED', { no: 2 }))
    expect(e.panel).toMatchObject({ uid, isNew: false })
    expect(e.selection).toEqual({ uids: [uid], anchor: uid })
    expect(s.selectedUid).toBe(uid)
    e.undoCommand()
    expect(e.session.working.steps).toBe(edited.steps)
    expect(s.selectedUid).toBe('s1')
  })
  it('[맨 끝에 추가]: 끝에 넣는다', () => {
    const { e } = mk()
    e.startNew('none')
    e.updateDraft(validNone)
    const uid = e.panel.uid
    expect(e.addNew('end')).toBe(true)
    expect(e.session.working.steps.map((x) => x.uid)).toEqual(['s0', 's1', 's2', uid])
    expect(e.toast.text).toBe(t('SEW_CMD_ADDED_END'))
  })
  it('잇달아 만든 새 스텝은 uid 가 겹치지 않는다', () => {
    const { e } = mk()
    e.startNew('none')
    const a = e.panel.uid
    e.updateDraft(validNone)
    e.addNew('end')
    e.startNew('none')
    expect(e.panel.uid).not.toBe(a)
  })
  it('200개면 새 스텝을 시작하지 않고 이유를 알린다(STEP_LIMIT), 만드는 사이 200개가 되면 [넣기]도 막는다', () => {
    const { e } = mk(Array.from({ length: STEP_MAX }, (_, i) => noneStep(i)))
    expect(e.startNew('none')).toBe(false)
    expect(e.panel.isNew).toBe(false)
    expect(e.toast.text).toBe(t('SEW_CMD_REFUSED_STEP_LIMIT'))
    setActivePinia(createPinia())
    const b = mk().e
    b.startNew('none')
    b.updateDraft(validNone)
    const full = { ...b.session.working, steps: Array.from({ length: STEP_MAX }, (_, i) => noneStep(i + 10)) }
    b.session = { ...b.session, working: full }
    expect(b.addNew('end')).toBe(false)
    expect(b.session.working).toBe(full)
    expect(b.toast.text).toBe(t('SEW_CMD_REFUSED_STEP_LIMIT'))
    expect(b.panel.isNew).toBe(true)
  })
  it('기준 화면(참조)이 있는 스텝이 없으면 이미지·OCR 새 스텝을 시작하지 않는다', () => {
    const { e } = mk([noneStep(0), noneStep(1)])
    expect(e.startNew('image')).toBe(false)
    expect(e.panel.isNew).toBe(false)
    expect(e.toast.text).toBe(t('SEW_EDIT_NEW_NO_BASE'))
  })
  it('패널에 적용 안 한 변경이 있으면 새 스텝 앞에서 묻는다(이동) — [버리고 이동]이면 새 스텝을 연다', () => {
    const { e, edited } = mk()
    e.updateDraft((d) => ({ ...d, descriptionToEmail: '바뀜' }))
    expect(e.startNew('none')).toBe(false)
    expect(e.dialog).toEqual({ kind: 'guard', action: 'move', to: null })
    expect(e.panel.isNew).toBe(false)
    e.guardDrop()
    expect(e.panel.isNew).toBe(true)
    expect(e.session.working).toBe(edited)
  })
  it('값을 넣은 새 스텝을 두고 다른 줄로 가면 묻고 [적용하고 …] 갈래는 없다 — [버리고 이동]이면 그 줄', () => {
    const { s, e } = mk()
    e.startNew('none')
    e.updateDraft((d) => ({ ...d, descriptionToEmail: 'x' }))
    e.clickRow('s2')
    expect(e.dialog).toEqual({ kind: 'guard', action: 'move', to: 's2', isNew: true })
    expect(e.guardApply()).toBe(false)
    expect(e.panel.isNew).toBe(true)
    e.guardDrop()
    expect(e.panel).toMatchObject({ uid: 's2', isNew: false })
    expect(s.selectedUid).toBe('s2')
  })
  it('값을 넣지 않은 새 스텝은 다른 줄을 누르면 묻지 않고 그 줄로 간다(잡기도 끝)', () => {
    const { s, e } = mk()
    e.startNew('image')
    e.clickRow('s0') // 고른 스텝이던 줄을 다시 눌러도
    expect(e.dialog).toBe(null)
    expect(e.panel).toMatchObject({ uid: 's0', isNew: false })
    expect(e.capture).toBe(null)
    expect(s.selectedUid).toBe('s0')
  })
  it('[취소](cancelNew): 새 스텝을 버리고 고른 스텝으로 돌아간다', () => {
    const { s, e, edited } = mk()
    s.select('s1')
    e.startNew('image')
    expect(e.cancelNew()).toBe(true)
    expect(e.panel).toMatchObject({ uid: 's1', isNew: false })
    expect(e.capture).toBe(null)
    expect(s.selectedUid).toBe('s1')
    expect(e.session.working).toBe(edited)
  })
  it('읽기 전용 세션에서는 새 스텝·잡기·다시 찍기를 시작하지 않는다', async () => {
    const { e } = mk(undefined, { canWrite: false })
    expect(e.startNew('none')).toBe(false)
    expect(e.startCapture(['area'])).toBe(false)
    expect(await e.repick()).toBe(false)
    expect(e.capture).toBe(null)
    expect(e.panel.isNew).toBe(false)
  })
  it('큰 화면 보기 요청(목업 focusArea·viewAll): 잡기를 시작하면 전체', () => {
    const { e } = mk()
    e.requestView('area')
    expect(e.viewReq).toMatchObject({ kind: 'area' })
    const n = e.viewReq.n
    e.startCapture(['area'])
    expect(e.viewReq).toMatchObject({ kind: 'all' })
    expect(e.viewReq.n).toBeGreaterThan(n)
  })
  it('올릴 그림 목록은 바꿀 때마다 새 Map(화면이 따라 그린다)', async () => {
    const { e } = mk()
    const before = e.uploads
    e.startCapture(['train'])
    await e.captureNext({ x: 20, y: 30, w: 40, h: 30 })
    expect(e.uploads).not.toBe(before)
    expect(e.uploads.size).toBe(1)
  })
})

// ── 다른 시나리오 붙여넣기·빈 시나리오(Task 8) ──
import { applyStep as _apply } from '../editor/commands'
describe('editStore — 다른 시나리오 붙여넣기·빈 시나리오(Task 8)', () => {
  beforeEach(() => { setActivePinia(createPinia()); Object.values(api).forEach((f) => f.mockReset()) })
  // 시나리오 name 의 열기 응답(뼈대 + edited). 판 = crtime·fileId.
  const scenarioOf = (name, steps, { crtime = 1, fileId = 'F' } = {}) => {
    const ed = { source: { process: 'P', model: 'M', name, crtime, fileId }, headCrtime: crtime, header: { description: '', timeoutLimit: '1' }, steps, property: {} }
    return {
      process: 'P', model: 'M', name, headCrtime: crtime, propertyRev: 'r', version: { crtime, isCurrent: true, fileId }, notes: [],
      steps: steps.map((s, i) => ({ ...s, no: i + 1, notes: [], baseImage: { state: 'present', url: `/u/${name}/${s.uid}` } })), edited: ed
    }
  }
  // A: s1 성공 → s2(묶음 안), s1 실패 → s0(묶음 밖, 원래 1번). B: 다른 시나리오.
  const A = (ver) => scenarioOf('A', [imageStep(0), imageStep(1, { next: { onTrue: { kind: 'step', uid: 's2' }, onFalse: { kind: 'step', uid: 's0' } } }), noneStep(2)], ver)
  const B = () => scenarioOf('B', [imageStep(0), noneStep(1)])
  const A_SRC = { process: 'P', model: 'M', name: 'A', crtime: 1, fileId: 'F' }
  const start = () => { const s = useEditorStore(); s.me = { singleid: 'u', canWrite: true, authorityManager: 3 }; return { s, e: useEditStore() } }
  const open = async (sk) => { api.open.mockReturnValueOnce(ok(sk)); await useEditorStore().openScenario({ process: sk.process, model: sk.model, name: sk.name }) }
  const copy = (e, uids, cut = false) => { e.setSelection({ uids, anchor: uids[0] }); return e.copySelection(cut) }
  const uidsOf = (e) => e.session.working.steps.map((x) => x.uid)

  it('A 에서 복사 → B 열기 → 붙여넣기: 묶음은 남고, 묶음 밖 갈 곳은 미해결(원래 1번)·그림은 A 판 참조, 첫 미해결 스텝을 고른다', async () => {
    const { s, e } = start()
    await open(A())
    copy(e, ['s1', 's2'])
    const b = B()
    await open(b)
    expect(e.session.source.name).toBe('B')
    expect(e.clip?.uids).toEqual(['s1', 's2'])
    expect(e.pasteClip('after')).toBe(true) // 고른 줄 = B 의 첫 스텝
    const steps = e.session.working.steps
    expect(steps).toHaveLength(4)
    expect(steps[0]).toBe(b.edited.steps[0])
    expect(steps[3]).toBe(b.edited.steps[1])
    const [p1, p2] = [steps[1], steps[2]]
    expect(p1.uid).toMatch(/^p/)
    expect(p1.origin).toBe(null)
    expect(p1.next.onTrue).toEqual({ kind: 'step', uid: p2.uid })
    expect(p1.next.onFalse).toStrictEqual({ kind: 'unresolved', value: 1 })
    expect(p1.images.base).toEqual({ from: 'other', ...A_SRC, id: 's1-bi' })
    expect(p1.images.train[0]).toEqual({ from: 'other', ...A_SRC, id: 's1-train-0' })
    expect(p2.images.base).toEqual({ literal: 'AA==' })
    expect(e.toast.text).toBe(t('SEW_CMD_PASTED_UNRESOLVED', { n: 2, open: 1 }))
    expect(e.selection).toEqual({ uids: [p1.uid], anchor: p1.uid })
    expect(s.selectedUid).toBe(p1.uid)
    expect(e.panel.uid).toBe(p1.uid)
    expect(e.panelErrors().onFalse).toMatchObject({ code: 'NEXT_UNRESOLVED', level: 'error', params: { which: 'onFalse', value: 1 } })
    // 표·큰 화면이 읽는 표시 스텝: 그림은 A 판 경로, 다른 판 표시
    const shown = s.steps.find((x) => x.uid === p1.uid)
    expect(shown.baseImage).toMatchObject({ state: 'present', other: true })
    expect(shown.baseImage.src).toContain('/scenario-editor/scenarios/P/M/A/versions/1/files/F/images/s1-bi')
    expect(shown.next.onFalse).toEqual({ kind: 'unresolved', value: 1 })
  })
  it('A 의 같은 판을 다시 열어 붙이면 같은 판(sameSource) — 그림·갈 곳 참조를 그대로 둔다', async () => {
    const { e } = start()
    await open(A())
    copy(e, ['s1'])
    await open(B())
    await open(A())
    e.pasteClip('end')
    const p = e.session.working.steps[3]
    expect(p.uid).toMatch(/^p/)
    expect(p.images.base).toEqual({ from: 'source', id: 's1-bi' })
    expect(p.images.train[0]).toEqual({ from: 'source', id: 's1-train-0' })
    expect(p.next).toEqual({ onTrue: { kind: 'step', uid: 's2' }, onFalse: { kind: 'step', uid: 's0' } })
    expect(e.toast.text).toBe(t('SEW_CMD_PASTED', { n: 1 }))
  })
  it('같은 이름이라도 판(crtime·fileId)이 다르면 다른 판으로 붙인다 — 다섯 칸이 모두 같아야 같은 판', async () => {
    const { e } = start()
    await open(A())
    copy(e, ['s1'])
    await open(A({ crtime: 1, fileId: 'G' }))
    e.pasteClip('end')
    const p = e.session.working.steps[3]
    expect(p.images.base).toEqual({ from: 'other', ...A_SRC, id: 's1-bi' })
    expect(p.next.onFalse).toStrictEqual({ kind: 'unresolved', value: 1 })
  })
  it('출처가 없는 세션(새 시나리오)은 어느 묶음과도 같은 판이 아니다', async () => {
    const { e } = start()
    await open(A())
    copy(e, ['s1'])
    e.session = { ...e.session, source: null }
    e.pasteClip('end')
    const p = e.session.working.steps[3]
    expect(p.images.base.from).toBe('other')
    expect(p.next.onFalse).toStrictEqual({ kind: 'unresolved', value: 1 })
  })
  it('잘라낸 묶음은 다른 시나리오를 열면 복사 묶음이 된다 — 옮기기는 같은 작업본 안에서만(R-T2a), 잘라낸 스텝은 제자리', async () => {
    const { e } = start()
    await open(A())
    copy(e, ['s1'], true)
    expect(e.clip.cut).toBe(true)
    await open(B())
    expect(e.clip.cut).toBe(false)
    e.pasteClip('end')
    expect(uidsOf(e)).toEqual(['s0', 's1', 'p1'])
    expect(e.clip?.uids).toEqual(['s1']) // 복사 묶음이라 남는다
    await open(A())
    e.setSelection({ uids: ['s0'], anchor: 's0' })
    e.pasteClip('after')
    expect(uidsOf(e)).toEqual(['s0', 'p1', 's1', 's2'])
  })
  it('묶음은 열기에 실패해도(세션 끝) 남고, 다른 편집 상태는 비운다', async () => {
    const { s, e } = start()
    await open(A())
    copy(e, ['s1'])
    e.editCell('s0', 'skip', true)
    api.open.mockRejectedValueOnce({ response: { status: 404, data: { code: 'NOT_FOUND' } } })
    await s.openScenario({ process: 'P', model: 'M', name: 'X' })
    expect(e.session).toBe(null)
    expect(e.undo).toEqual([])
    expect(e.selection).toEqual({ uids: [], anchor: null })
    expect(e.clip?.uids).toEqual(['s1'])
    await open(B())
    expect(e.pasteClip('end')).toBe(true)
    expect(e.session.working.steps).toHaveLength(3)
  })
  it('R-P3: 올릴 그림(upload)이 든 스텝을 복사하면 묶음이 그 그림을 들고 가고, 다른 시나리오에 붙이면 그 저장소의 올릴 그림에 들어가 보인다', async () => {
    const { s, e } = start()
    await open(A())
    const blob = new Blob(['png'], { type: 'image/png' })
    e.setUpload('t1', blob)
    e.setUpload('t9', new Blob(['other']))
    const st = e.session.working.steps[1]
    e.run('x', (w) => _apply(w, { ...st, images: { ...st.images, train: { 0: { from: 'upload', tempId: 't1' } } } }))
    copy(e, ['s1'])
    expect([...e.clip.uploads.keys()]).toEqual(['t1']) // 묶음이 쓰는 그림만
    expect(e.clip.uploads.get('t1')).toBe(blob)
    await open(B())
    expect(e.uploads.size).toBe(0) // 세션의 올릴 그림은 비운다
    e.pasteClip('end')
    expect(e.uploads.get('t1')).toBe(blob)
    expect(e.uploads.has('t9')).toBe(false)
    const p = e.session.working.steps[2]
    expect(p.images.train[0]).toEqual({ from: 'upload', tempId: 't1' })
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:t1')
    try {
      const shown = s.steps.find((x) => x.uid === p.uid)
      expect(shown.condition.image.trainImages[0].src).toBe('blob:t1')
    } finally { delete globalThis.URL.createObjectURL }
  })
  it('빈 시나리오(스텝 0)에도 붙인다 — 끝(=맨 앞)에 넣고 기준 화면을 함께 가져와, 그 기준 화면으로 이미지 새 스텝을 시작할 수 있다', async () => {
    const { e } = start()
    await open(A())
    copy(e, ['s1', 's2'])
    await open(scenarioOf('E', []))
    expect(e.editable).toBe(true)
    expect(e.startNew('image')).toBe(false) // 기준 화면이 있는 스텝이 없다
    expect(e.toast.text).toBe(t('SEW_EDIT_NEW_NO_BASE'))
    expect(e.pasteClip('after')).toBe(true) // 고른 줄이 없으면 끝에
    expect(e.session.working.steps).toHaveLength(2)
    expect(e.session.working.steps[0].images.base).toEqual({ from: 'other', ...A_SRC, id: 's1-bi' })
    expect(e.startNew('image')).toBe(true)
    expect(e.panel.draft.images.base).toEqual({ from: 'other', ...A_SRC, id: 's1-bi' })
  })
})

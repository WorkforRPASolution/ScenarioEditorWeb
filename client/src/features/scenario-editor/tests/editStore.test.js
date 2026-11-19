import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const api = vi.hoisted(() => ({ me: vi.fn(), scopes: vi.fn(), dataCheck: vi.fn(), refreshCache: vi.fn(), open: vi.fn(), list: vi.fn(), versions: vi.fn() }))
vi.mock('../api', () => ({ scenarioEditorApi: api, imageUrl: (p) => `http://x/api${p}` }))
// 큰 화면 잡기의 브라우저 전용 부분(fetch·canvas)은 가짜로 — 저장소가 부르는 값과 그 결과만 본다.
const fx = vi.hoisted(() => ({ loadBitmap: vi.fn(), loadBlob: vi.fn(), bitmapOf: vi.fn(), cropPng: vi.fn(), imageDataOf: vi.fn(), locate: vi.fn() }))
vi.mock('../editor/images', async (orig) => ({ ...(await orig()), loadBitmap: fx.loadBitmap, loadBlob: fx.loadBlob, bitmapOf: fx.bitmapOf }))
vi.mock('../editor/crop', async (orig) => ({ ...(await orig()), cropPng: fx.cropPng, imageDataOf: fx.imageDataOf }))
vi.mock('../editor/locate', () => ({ locate: fx.locate }))
import { useEditorStore } from '../stores/editorStore'
import { useEditStore } from '../stores/editStore'
import { typeArea } from '../editor/areaInput'
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
import { panelFixture, imageStep, noneStep, ocrStep } from './panelFixture'
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
  // 검색 영역을 숫자로 넣기(2026-11-17) — 화면 크기는 큰 화면이 그림을 읽은 뒤 알린다
  const setArea = (e, a) => e.updateDraft((d) => ({ ...d, condition: { ...d.condition, searchArea: a } }))
  it('setScreenSize: 큰 화면이 알린 기준 화면 크기로 고친 영역이 화면 밖인지 본다 — 모르면 보지 않는다', () => {
    const { e } = mk()
    setArea(e, { x: 900, y: 20, w: 300, h: 200 })
    expect(e.panelErrors().area).toBeUndefined() // 화면 크기를 아직 모른다
    e.setScreenSize({ w: 1000, h: 500, uid: 's1' }) // 다른 스텝의 그림 — 여러 줄을 고른 동안 큰 화면은 다른 줄을 보인다(독립 검토 M4)
    expect(e.panelScreen).toBe(null)
    expect(e.panelErrors().area).toBeUndefined()
    e.setScreenSize({ w: 1000, h: 500, uid: 's0' })
    expect(e.screenSize).toEqual({ w: 1000, h: 500, uid: 's0' })
    expect(e.panelScreen).toEqual({ w: 1000, h: 500 })
    expect(e.panelErrors().area).toMatchObject({ code: 'AREA_OUT_RIGHT', level: 'error', params: { w: 1000, h: 500, sum: 1200 } })
    expect(e.applyPanel()).toBe(false)
    expect(e.focusReq.field).toBe('area')
    setArea(e, { x: 700, y: 20, w: 300, h: 200 })
    expect(e.panelErrors().area).toBeUndefined()
    expect(e.applyPanel()).toBe(true)
    e.setScreenSize(null)
    expect(e.screenSize).toBe(null)
    expect(e.panelScreen).toBe(null)
  })
  it('화면 크기를 몰라도 한도를 넘는 값은 작업본에 들어가지 않는다(독립 검토 I1)', () => {
    const { e, edited } = mk()
    e.updateDraft((d) => ({ ...d, condition: typeArea(d.condition, 'w', '99999999999') }))
    expect(e.panel.draft.condition.searchArea).toEqual({ x: 10, y: 20, w: 300, h: 200 })
    expect(e.panelErrors().area).toMatchObject({ code: 'AREA_TOO_LARGE', level: 'error' })
    expect(e.applyPanel()).toBe(false)
    expect(e.session.working).toBe(edited)
  })
  it('적용돼 있던 영역이 화면 밖이어도 다른 칸을 고쳐 적용할 수 있다(패널에서 고친 영역만 막는다)', () => {
    const { e } = panelFixture([imageStep(0, { condition: { ...imageStep(0).condition, searchArea: { x: 900, y: 20, w: 300, h: 200 } } }), imageStep(1)])
    e.setScreenSize({ w: 1000, h: 500, uid: 's0' })
    setAccept(e, 0.8)
    expect(e.panelErrors().area).toBeUndefined()
    expect(e.applyPanel()).toBe(true)
  })
  it('다른 시나리오를 열면(begin) 화면 크기를 잊는다', () => {
    const { e } = mk()
    e.setScreenSize({ w: 1000, h: 500, uid: 's0' })
    e.begin(skeleton, { canWrite: true })
    expect(e.screenSize).toBe(null)
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
    expect(p).toMatchObject({ isNew: true, insertBefore: 's2', origin: 's1', tried: false }) // 고른 줄 뒤
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
  it('새 조건 없음 스텝: 기준 화면 literal·잡기 없음 — [넣기]는 칸 검사 뒤 고른 줄 뒤에 insertStep, 되돌리면 넣기 전으로', () => {
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
    expect(ws.map((x) => x.uid)).toEqual(['s0', 's1', uid, 's2']) // 고른 줄(s1) 뒤
    expect(ws[2]).toMatchObject({ uid, origin: null, descriptionToEmail: '재시작', images: { train: {}, base: { literal: 'AA==' } } })
    expect(ws[0]).toBe(edited.steps[0])
    expect(ws[1]).toBe(edited.steps[1])
    expect(e.toast.text).toBe(t('SEW_CMD_INSERTED', { no: 3 }))
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
  // 넣을 자리는 [+ 새 스텝]을 누를 때 고른 줄의 뒤가 기본이고(2026-11-17 — 그 전에는 고른 줄 앞), 만드는 중에 바꿀 수 있다(2026-11-10 사용자 결정 — 넣고 나서 옮기지 않게)
  it('넣을 자리를 만드는 중에 바꾼다(setInsertBefore): 다른 스텝 앞에 넣고, 되돌리면 처음 고른 줄로', () => {
    const { s, e, edited } = mk()
    s.select('s1')
    e.startNew('none')
    e.updateDraft(validNone)
    const uid = e.panel.uid
    expect(e.panel.insertBefore).toBe('s2')
    expect(e.setInsertBefore('없는줄')).toBe(false)
    expect(e.panel.insertBefore).toBe('s2')
    expect(e.setInsertBefore('s1')).toBe(true)
    expect(e.panel.insertBefore).toBe('s1')
    expect(e.panel.draft.descriptionToEmail).toBe('재시작') // 만들던 값은 그대로
    expect(e.addNew()).toBe(true)
    expect(e.session.working.steps.map((x) => x.uid)).toEqual(['s0', uid, 's1', 's2'])
    expect(e.toast.text).toBe(t('SEW_CMD_INSERTED', { no: 2 }))
    e.undoCommand()
    expect(e.session.working.steps).toBe(edited.steps)
    expect(s.selectedUid).toBe('s1')
  })
  it('넣을 자리를 맨 끝으로 바꾸면(null) 끝에 넣는다, [취소] 는 자리를 바꿨어도 처음 고른 줄로 돌아간다', () => {
    const { s, e } = mk()
    s.select('s0')
    e.startNew('none')
    e.updateDraft(validNone)
    const uid = e.panel.uid
    expect(e.setInsertBefore(null)).toBe(true)
    expect(e.panel.insertBefore).toBe(null)
    expect(e.addNew()).toBe(true)
    expect(e.session.working.steps.map((x) => x.uid)).toEqual(['s0', 's1', 's2', uid])
    expect(e.toast.text).toBe(t('SEW_CMD_ADDED_END'))
    e.undoCommand()
    expect(s.selectedUid).toBe('s0')
    e.startNew('none')
    expect(e.setInsertBefore('s2')).toBe(true)
    e.cancelNew()
    expect(e.selection).toEqual({ uids: ['s0'], anchor: 's0' })
    expect(e.setInsertBefore('s1')).toBe(false) // 새 스텝을 만드는 중이 아니다
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
  it('누를 곳 보기 요청: 누를 때마다 번호가 오르고(큰 화면이 그때마다 다시 깜빡인다), 세션이 바뀌면 비운다', () => {
    const { e } = mk()
    expect(e.clickShow).toBe(null)
    e.showClick('s0')
    expect(e.clickShow).toEqual({ n: 1, uid: 's0' }) // 어느 스텝의 누를 곳인지 함께 — 큰 화면이 다른 스텝을 보이고 있으면 받지 않는다
    e.showClick('s1')
    expect(e.clickShow).toEqual({ n: 2, uid: 's1' })
    e.end()
    expect(e.clickShow).toBe(null)
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
  // 브라우저가 만든 uid(n·p + 세션 번호)는 세션마다 다시 센다 — 다른 세션으로 나간 묶음이 그 uid 를 가리키면 엉뚱한 스텝(또는 자기 자신)을 가리키게 된다.
  const addNone = (e, desc) => {
    e.setSelection({ uids: [], anchor: null })
    e.startNew('none')
    e.updateDraft((d) => ({ ...d, descriptionToEmail: desc, action: { ...d.action, command: 'run.bat' } }))
    e.addNew('end')
    return e.session.working.steps[e.session.working.steps.length - 1]
  }
  it('fix1: 세션을 나간 묶음의 브라우저 uid 갈 곳(새 스텝 n…)은 미해결(원래 번호) — 같은 판을 다시 열어 같은 uid 의 다른 새 스텝이 생겨도 그쪽을 가리키지 않는다', async () => {
    const { e } = start()
    await open(A())
    const n1 = addNone(e, '첫 세션의 새 스텝')
    expect(n1.uid).toBe('n1')
    e.editCell('s1', 'onTrue', { kind: 'step', uid: 'n1' }) // s1 성공 → n1(4번), 실패 → s0(서버 uid)
    copy(e, ['s1'])
    await open(B())
    await open(A()) // 같은 판
    const other = addNone(e, '다른 새 스텝')
    expect(other.uid).toBe('n1') // 세션 번호가 다시 시작해 같은 uid
    e.pasteClip('end')
    const p = e.session.working.steps[4]
    expect(p.uid).toMatch(/^p/)
    expect(p.next.onTrue).toStrictEqual({ kind: 'unresolved', value: 4 })
    expect(p.next.onFalse).toStrictEqual({ kind: 'step', uid: 's0' }) // 서버 uid 는 같은 판에서 그대로
    expect(p.images.base).toEqual({ from: 'source', id: 's1-bi' })
    expect(e.toast.text).toBe(t('SEW_CMD_PASTED_UNRESOLVED', { n: 1, open: 1 }))
    expect(e.selection).toEqual({ uids: [p.uid], anchor: p.uid })
  })
  it('fix1: 붙여 넣은 스텝(p…)을 가리키던 갈 곳도 세션을 나가면 미해결 — 다음 세션의 복사본이 같은 p uid 를 받아 자기 자신(NEXT_SELF)을 가리키지 않는다', async () => {
    const { e } = start()
    await open(A())
    copy(e, ['s0'])
    e.pasteClip('end') // p1 = 4번
    expect(e.session.working.steps[3].uid).toBe('p1')
    e.editCell('s1', 'onTrue', { kind: 'step', uid: 'p1' })
    copy(e, ['s1'])
    await open(B())
    await open(A())
    e.pasteClip('end')
    const p = e.session.working.steps[3]
    expect(p.uid).toBe('p1')
    expect(p.next.onTrue).toStrictEqual({ kind: 'unresolved', value: 4 })
    expect(e.panelErrors().onTrue).toMatchObject({ code: 'NEXT_UNRESOLVED' })
  })
  it('fix1: 같은 세션 안에서는 브라우저 uid 갈 곳을 그대로 둔다, 원래 번호를 모르는 브라우저 uid 갈 곳은 값 없이 미해결', async () => {
    const { e } = start()
    await open(A())
    addNone(e, '새 스텝')
    e.editCell('s1', 'onTrue', { kind: 'step', uid: 'n1' })
    copy(e, ['s1'])
    e.pasteClip('end')
    expect(e.session.working.steps[4].next.onTrue).toStrictEqual({ kind: 'step', uid: 'n1' })
    // 묶음 밖 브라우저 uid 를 가리키는데 복사할 때 이미 없던 스텝(원래 번호 모름)
    e.editCell('s1', 'onTrue', { kind: 'step', uid: 'n9' })
    copy(e, ['s1'])
    await open(A())
    e.pasteClip('end')
    expect(e.session.working.steps[3].next.onTrue).toStrictEqual({ kind: 'unresolved' })
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

// ── P2-C 최종 검토 반영 ──
describe('editStore — 최종 검토 반영(P2-C)', () => {
  beforeEach(() => { setActivePinia(createPinia()); Object.values(api).forEach((f) => f.mockReset()) })
  const setAccept = (e, v) => e.updateDraft((d) => ({ ...d, condition: { ...d.condition, image: { ...d.condition.image, accept: v } } }))
  const uidsOf = (e) => e.session.working.steps.map((x) => x.uid)
  const four = () => panelFixture([noneStep(0), noneStep(1), noneStep(2), noneStep(3)])

  it('#1 다른 시나리오를 여는 동안은 고칠 수 없다 — 패널 초안·적용·표 칸·명령을 거절하고(확인 창도 세우지 않는다), 열기가 끝나면 새 세션을 고칠 수 있다', async () => {
    const { s, e, edited, skeleton } = panelFixture([imageStep(0), imageStep(1), noneStep(2)])
    e.editCell('s1', 'skip', true) // 되돌릴 것 하나
    e.setSelection({ uids: ['s0'], anchor: 's0' })
    e.copySelection(false)
    const clip = e.clip
    let resolve
    api.open.mockReturnValueOnce(new Promise((res) => { resolve = res }))
    const opened = s.openScenario({ process: 'P', model: 'M', name: 'B' })
    expect(s.opening).not.toBe(null)
    expect(e.editable).toBe(false)
    const w = e.session.working
    const draft = e.panel.draft
    setAccept(e, 0.5)
    expect(e.panel.draft).toBe(draft) // 여는 동안 친 값은 받지 않는다
    e.panel = { ...e.panel, draft: { ...draft, descriptionToEmail: '여는 중' } } // 이미 고치던 값이 있어도
    expect(e.applyPanel()).toBe(false)
    expect(e.editCell('s0', 'skip', true)).toBe(false)
    expect(e.deleteSelection()).toBe(false)
    expect(e.moveSelected(1)).toBe(false)
    expect(e.copySelection(true)).toBe(false)
    expect(e.pasteClip('end')).toBe(false)
    expect(e.undoCommand()).toBe(false)
    expect(e.redoCommand()).toBe(false)
    expect(e.startNew('none')).toBe(false)
    expect(e.run('x', (x) => ({ working: { ...x, steps: x.steps.slice(1) } }))?.working).toBeUndefined()
    expect(e.session.working).toBe(w)
    expect(e.undo).toHaveLength(1)
    expect(e.dialog).toBe(null)
    expect(e.clip).toBe(clip)
    const B = { ...skeleton, name: 'B', edited: { ...edited, source: { ...edited.source, name: 'B' } } }
    resolve({ data: { success: true, data: B } })
    await opened
    expect(s.opening).toBe(null)
    expect(e.session.source.name).toBe('B')
    expect(e.editable).toBe(true)
    expect(e.panel.uid).toBe('s0') // 새 세션의 첫 스텝을 패널이 연다(여는 중 표시를 먼저 내리고 세션을 시작한다)
    expect(e.panel.draft).toBe(B.edited.steps[0])
    expect(e.editCell('s0', 'skip', true)).toBe(true)
    expect(e.undo).toHaveLength(1)
  })

  it('#2 잘라낸 줄을 고른 채로 [맨 끝에 붙여넣기] 는 옮긴다 — 잘라낸 범위 안 검사는 끝에 붙일 때 보지 않는다', () => {
    const { e, edited } = four()
    e.setSelection({ uids: ['s1', 's2'], anchor: 's1' })
    e.copySelection(true)
    expect(e.pasteClip('end')).toBe(true)
    expect(uidsOf(e)).toEqual(['s0', 's3', 's1', 's2'])
    expect(e.session.working.steps[2]).toBe(edited.steps[1])
    expect(e.clip).toBe(null)
    expect(e.toast.text).toBe(t('SEW_CMD_MOVED', { n: 2 }))
    expect(e.undo).toHaveLength(1)
  })

  it('#3 [적용하고 이동] 이 칸 오류로 막히면 [계속 고치기] 처럼 onKeep 을 부른다(주소를 열린 시나리오로 되돌리게), 미룬 일은 하지 않는다', () => {
    const { e } = panelFixture([imageStep(0), imageStep(1)])
    e.updateDraft((d) => ({ ...d, descriptionToEmail: 'a@b' }))
    const next = vi.fn(); const keep = vi.fn()
    e.guard(next, { action: 'open', onKeep: keep })
    expect(e.guardApply()).toBe(false)
    expect(keep).toHaveBeenCalledTimes(1)
    expect(next).not.toHaveBeenCalled()
    expect(e.dialog).toBe(null)
    expect(e.focusReq.field).toBe('desc')
    expect(e.panel.draft.descriptionToEmail).toBe('a@b')
  })

  it('#4 표 칸을 열 때 값으로 되돌리면 저장 기준점의 그 스텝 객체를 다시 쓴다 — 표시·알림이 P1 으로 돌아온다', () => {
    const note = { level: 'warning', code: 'ACCEPT_LOW', params: {} }
    const { s, e, edited } = panelFixture([imageStep(0), imageStep(1)], { skOver: { s0: { notes: [note] } } })
    e.editCell('s0', 'accept', 0.7)
    expect(e.session.working.steps[0]).not.toBe(edited.steps[0])
    expect(s.steps[0].notes).toEqual([])
    e.editCell('s0', 'accept', 0.9)
    expect(e.session.working.steps[0]).toBe(edited.steps[0])
    expect(s.steps[0].notes).toEqual([note])
    expect(e.undo).toHaveLength(2)
    e.editCell('s1', 'skip', true); e.editCell('s1', 'skip', false)
    expect(e.session.working.steps[1]).toBe(edited.steps[1])
    e.editCell('s1', 'onFalse', { kind: 'step', uid: 's0' }); e.editCell('s1', 'onFalse', { kind: 'end', value: 'FAIL' })
    expect(e.session.working.steps[1]).toBe(edited.steps[1])
    expect(e.panel.draft).toBe(edited.steps[0]) // 패널도 그 객체를 연다
  })

  it('#5 모두 지우고 되돌린 뒤 다시 하면 초점이 지운 스텝에 남지 않는다', () => {
    const { s, e } = panelFixture([noneStep(0), noneStep(1)])
    e.setSelection({ uids: ['s0', 's1'], anchor: 's0' })
    expect(e.deleteSelection()).toBe(true)
    expect(s.selectedUid).toBe(null)
    e.undoCommand()
    expect(s.selectedUid).toBe('s0')
    e.redoCommand()
    expect(e.session.working.steps).toEqual([])
    expect(s.selectedUid).toBe(null)
    expect(e.selection).toEqual({ uids: [], anchor: null })
    expect(e.panel.uid).toBe(null)
  })
  it('#5 고른 줄 없이 맨 끝에 추가한 새 스텝을 되돌리면 초점이 사라진 새 스텝에 남지 않는다', () => {
    const { s, e } = panelFixture([noneStep(0), noneStep(1, { next: { onTrue: { kind: 'end', value: 'SUCCESS' }, onFalse: { kind: 'end', value: 'FAIL' } } })])
    e.setSelection({ uids: [], anchor: null })
    e.startNew('none')
    e.updateDraft((d) => ({ ...d, descriptionToEmail: '새 스텝', action: { ...d.action, command: 'run.bat' } }))
    expect(e.addNew('end')).toBe(true)
    expect(s.selectedUid).toBe('n1')
    e.undoCommand()
    expect(uidsOf(e)).toEqual(['s0', 's1'])
    expect(s.selectedUid).toBe(null)
    expect(e.panel.uid).toBe(null)
  })
  it('#5 되돌린 선택에 지금 없는 uid 가 있으면 빼고, 기준 줄이 없으면 남은 첫 줄을 기준으로 한다', () => {
    const { s, e, edited } = four()
    e.selection = { uids: ['s1', 'zz'], anchor: 'zz' }
    e.run('x', (w) => ({ working: { ...w, steps: w.steps.slice(0, 3) } }))
    e.undoLast()
    expect(e.session.working.steps).toBe(edited.steps)
    expect(e.selection).toEqual({ uids: ['s1'], anchor: 's1' })
    expect(s.selectedUid).toBe('s1')
  })

  it('#6 run: 결과 스텝이 그대로(같은 스텝 객체·같은 순서)면 되돌리기·다시 하기·알림을 건드리지 않는다', () => {
    const { e, edited } = four()
    const redo = [{ steps: edited.steps, selection: { uids: [], anchor: null } }]
    e.redo = redo
    const r = e.run('바꿈', (w) => ({ working: { ...w, steps: w.steps.slice() } }))
    expect(r.noop).toBe(true)
    expect(e.session.working).toBe(edited)
    expect(e.undo).toEqual([])
    expect(e.redo).toBe(redo)
    expect(e.toast).toBe(null)
  })
  it('#6 잘라낸 뒤 그 줄을 지우고 붙이면 거절한다 — 알림은 이유, 되돌리기는 지우기 하나, 묶음은 그대로', () => {
    const { e } = four()
    e.setSelection({ uids: ['s1', 's2'], anchor: 's1' })
    e.copySelection(true)
    const clip = e.clip
    expect(e.deleteSelection()).toBe(true)
    e.setSelection({ uids: ['s0'], anchor: 's0' })
    expect(e.pasteClip('after')).toBe(false)
    expect(e.toast).toEqual({ text: t('SEW_CMD_REFUSED_CUT_GONE'), undoable: false })
    expect(e.undo).toHaveLength(1)
    expect(e.clip).toBe(clip)
    expect(uidsOf(e)).toEqual(['s0', 's3'])
    e.undoCommand() // 지우기를 되돌리면 다시 옮길 수 있다
    e.setSelection({ uids: ['s3'], anchor: 's3' })
    expect(e.pasteClip('after')).toBe(true)
    expect(uidsOf(e)).toEqual(['s0', 's3', 's1', 's2'])
  })
  it('#6 없는 uid 만 고른 지우기는 아무것도 하지 않는다, 섞여 있으면 있는 줄만 지운다', () => {
    const { s, e } = four()
    e.selection = { uids: ['zz'], anchor: 'zz' }
    expect(e.deleteSelection()).toBe(false)
    expect(e.undo).toEqual([])
    expect(e.toast).toBe(null)
    expect(s.selectedUid).toBe('s0')
    e.selection = { uids: ['s1', 'zz'], anchor: 's1' }
    expect(e.deleteSelection()).toBe(true)
    expect(uidsOf(e)).toEqual(['s0', 's2', 's3'])
    expect(e.toast.text).toBe(t('SEW_CMD_DELETED', { nos: '2' }))
  })
  it('#6 잘라낸 스텝을 같은 자리에 붙이면(앞 줄 뒤·뒤 줄 앞·이미 끝인 묶음을 끝에) 쌓지 않고 묶음을 남긴다 — 알림은 같은 자리라는 안내', () => {
    const { e, edited } = four()
    e.setSelection({ uids: ['s1', 's2'], anchor: 's1' })
    e.copySelection(true)
    const clip = e.clip
    for (const [anchor, where] of [['s0', 'after'], ['s3', 'before']]) {
      e.setSelection({ uids: [anchor], anchor })
      e.toast = null
      expect(e.pasteClip(where)).toBe(false)
      expect(e.session.working).toBe(edited)
      expect(e.undo).toEqual([])
      expect(e.clip).toBe(clip)
      expect(e.toast).toEqual({ text: t('SEW_CMD_PASTE_SAME_PLACE'), undoable: false })
    }
    e.setSelection({ uids: ['s2', 's3'], anchor: 's2' })
    e.copySelection(true)
    const tail = e.clip
    expect(e.pasteClip('end')).toBe(false)
    expect(e.session.working).toBe(edited)
    expect(e.undo).toEqual([])
    expect(e.clip).toBe(tail)
    expect(e.toast.text).toBe(t('SEW_CMD_PASTE_SAME_PLACE'))
  })
})

import { spotKey } from '../editor/trainView'
import { LOCATE_MS } from '../editor/capture'
describe('editStore — 찾을 그림 위치 보기(findSpot, 찾을 그림 밖 누를 곳 B)', () => {
  const BITMAP = { width: 1000, height: 500 }
  const TRAIN = { width: 20, height: 10 }
  const url = (id) => `http://x/api/scenario-editor/scenarios/P/M/N/versions/1/files/F/images/${id}`
  const inputOf = (i, over = {}) => ({ baseUrl: url(`s${i}-bi`), trainUrl: url(`s${i}-train-0`), area: { x: 10, y: 20, w: 300, h: 200 }, click: { x: 24, y: 12 }, ...over })
  const flush = () => new Promise((r) => setTimeout(r, 0))
  const defer = () => { let resolve; let reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej }); return { promise, resolve, reject } }
  beforeEach(() => {
    setActivePinia(createPinia())
    Object.values(fx).forEach((f) => f.mockReset())
    fx.loadBitmap.mockImplementation(async (u) => (u.includes('-train-') ? TRAIN : BITMAP))
    fx.imageDataOf.mockImplementation((b) => ({ width: b.width, height: b.height, data: new Uint8ClampedArray(0) }))
    fx.locate.mockReturnValue({ found: 'one', x: 40, y: 50 })
  })

  it('[다시 찍기]와 같은 길로 찾아(비트맵·locate·LOCATE_MS) 키에 결과를 두고, 같은 키는 다시 찾지 않는다 — 작업본·초안·되돌리기는 그대로', async () => {
    const { e, edited } = panelFixture([imageStep(0), imageStep(1)])
    const input = inputOf(0)
    e.findSpot(input)
    e.findSpot(input) // 찾는 중
    await flush()
    e.findSpot(input) // 찾은 뒤
    await flush()
    expect(fx.locate).toHaveBeenCalledTimes(1)
    expect(fx.loadBitmap).toHaveBeenCalledWith(url('s0-bi'))
    expect(fx.loadBitmap).toHaveBeenCalledWith(url('s0-train-0'))
    expect(fx.locate).toHaveBeenCalledWith(expect.objectContaining({ width: 1000 }), expect.objectContaining({ width: 20 }), { x: 10, y: 20, w: 300, h: 200 }, { timeLimitMs: LOCATE_MS })
    expect(e.spots.get(spotKey(input))).toEqual({ found: 'one', x: 40, y: 50, w: 20, h: 10, bw: 1000, bh: 500 })
    expect(e.session.working).toBe(edited)
    expect(e.panel.draft).toBe(edited.steps[0])
    expect(e.undo).toEqual([])
    expect(e.locating).toBe(false) // [다시 찍기] 표시는 건드리지 않는다
  })
  it('누를 곳만 다른 입력은 같은 키라 다시 찾지 않는다', async () => {
    const { e } = panelFixture([imageStep(0)])
    e.findSpot(inputOf(0))
    await flush()
    e.findSpot(inputOf(0, { click: { x: 400, y: -9 } }))
    await flush()
    expect(fx.locate).toHaveBeenCalledTimes(1)
  })
  it('늦게 끝난 옛 결과는 그 키에만 붙는다(다른 스텝으로 빨리 옮겨도 섞이지 않는다)', async () => {
    const { e } = panelFixture([imageStep(0), imageStep(1)])
    const slow = defer()
    fx.loadBitmap.mockImplementation(async (u) => (u.includes('s0-train') ? slow.promise : u.includes('-train-') ? TRAIN : BITMAP))
    fx.locate.mockImplementation((b, tr, area) => (area.x === 10 ? { found: 'one', x: 40, y: 50 } : { found: 'many' }))
    const a = inputOf(0)
    const b = inputOf(1, { area: { x: 11, y: 20, w: 300, h: 200 } })
    e.findSpot(a)
    e.findSpot(b)
    await flush()
    expect(e.spots.get(spotKey(b))).toEqual({ found: 'many' })
    expect(e.spots.has(spotKey(a))).toBe(false)
    slow.resolve(TRAIN)
    await flush()
    expect(e.spots.get(spotKey(a))).toMatchObject({ found: 'one', x: 40, y: 50 })
    expect(e.spots.get(spotKey(b))).toEqual({ found: 'many' })
  })
  it('세션이 바뀌면 캐시를 비우고, 바뀌기 전에 시작한 찾기의 결과는 버린다', async () => {
    const { e, s, skeleton } = panelFixture([imageStep(0)])
    e.findSpot(inputOf(0))
    await flush()
    expect(e.spots.size).toBe(1)
    const gen = e.spotGen
    const slow = defer()
    fx.loadBitmap.mockImplementation(async (u) => (u.includes('-train-') ? slow.promise : BITMAP))
    e.findSpot(inputOf(0, { area: { x: 1, y: 1, w: 50, h: 50 } }))
    e.begin(skeleton, s.me)
    expect(e.spots.size).toBe(0)
    expect(e.spotGen).toBe(gen + 1)
    slow.resolve(TRAIN)
    await flush()
    expect(e.spots.size).toBe(0)
    e.end()
    expect(e.spotGen).toBe(gen + 2)
  })
  it('불러오기 실패는 error 로 두고(화면은 A 로), 같은 키를 다시 요청하면 다시 찾는다', async () => {
    const { e } = panelFixture([imageStep(0)])
    fx.loadBitmap.mockRejectedValueOnce(new Error('image 404'))
    const input = inputOf(0)
    e.findSpot(input)
    await flush()
    expect(e.spots.get(spotKey(input))).toEqual({ found: 'error' })
    expect(fx.locate).not.toHaveBeenCalled()
    e.findSpot(input)
    await flush()
    expect(e.spots.get(spotKey(input))).toMatchObject({ found: 'one' })
    fx.locate.mockImplementation(() => { throw new Error('canvas') })
    const other = inputOf(0, { area: { x: 1, y: 1, w: 50, h: 50 } })
    e.findSpot(other)
    await flush()
    expect(e.spots.get(spotKey(other))).toEqual({ found: 'error' })
  })
  it('입력이 없으면 아무것도 하지 않는다', async () => {
    const { e } = panelFixture([imageStep(0)])
    e.findSpot(null)
    await flush()
    expect(fx.loadBitmap).not.toHaveBeenCalled()
    expect(e.spots.size).toBe(0)
  })
  it('영역 끌기 표시(setAreaDrag): 끄는 동안 켜고, 세션이 바뀌면 끈다', () => {
    const { e, s, skeleton } = panelFixture([imageStep(0)])
    expect(e.areaDragging).toBe(false)
    e.setAreaDrag(true)
    expect(e.areaDragging).toBe(true)
    e.setAreaDrag(false)
    expect(e.areaDragging).toBe(false)
    e.setAreaDrag(true)
    e.begin(skeleton, s.me)
    expect(e.areaDragging).toBe(false)
  })
})

describe('editStore — 배포 뒤 새 판으로(rebase)·초안 시각(markDraft), P2-D Task 2', () => {
  beforeEach(() => { setActivePinia(createPinia()); Object.values(api).forEach((f) => f.mockReset()) })
  // 배포한 판을 다시 연 뼈대 — 같은 스텝 내용, 새 이름·crtime
  const deployed = (steps, name = 'COPY', crtime = 9) => {
    const ed = { source: { process: 'P', model: 'M', name, crtime, fileId: 'F9' }, headCrtime: crtime, header: { description: '', timeoutLimit: '1' }, steps, property: {} }
    return { process: 'P', model: 'M', name, id: `P-M-${name}`, headCrtime: crtime, propertyRev: 'r9', version: { crtime, isCurrent: true, fileId: 'F9' }, notes: [], steps: steps.map((s, i) => ({ ...s, no: i + 1, notes: [] })), edited: ed }
  }

  it('세션(기준·ID·작업본)과 열린 뼈대를 새 판으로 바꾸고, 올릴 그림·되돌리기를 비운다 — 초점은 같은 번호의 스텝', () => {
    const { e, s } = panelFixture([imageStep(0), noneStep(1), noneStep(2)])
    e.editCell('s1', 'skip', true)
    e.setUpload('t1', new Blob([new Uint8Array([1])]))
    e.markDraft({ draftId: 'd1', savedAt: '2026-11-09T05:00:00.000Z' })
    s.select('s2')
    const sk = deployed([imageStep(0), noneStep(1, { condition: { ...noneStep(1).condition, skipPreprocessing: true } }), noneStep(2)])
    e.rebase(sk)
    expect(e.session.source).toEqual({ process: 'P', model: 'M', name: 'COPY', crtime: 9, fileId: 'F9' })
    expect(e.session.headCrtime).toBe(9)
    expect(e.session.propertyRev).toBe('r9')
    expect(e.session.working).toBe(sk.edited)
    expect(e.session.saveBase).toBe(sk.edited)
    expect(e.session.draft).toBeUndefined()
    expect(s.skeleton).toEqual(sk)
    expect(e.uploads.size).toBe(0)
    expect([e.undo, e.redo]).toEqual([[], []])
    expect(s.selectedUid).toBe('s2')
    expect(e.panel.uid).toBe('s2')
  })
  it('초점 번호가 새 판에 없으면 마지막 스텝, 스텝이 없으면 비운다', () => {
    const { e, s } = panelFixture([imageStep(0), noneStep(1), noneStep(2)])
    s.select('s2')
    e.rebase(deployed([imageStep(0)]))
    expect(s.selectedUid).toBe('s0')
    e.rebase(deployed([]))
    expect(s.selectedUid).toBe(null)
  })
  it('markDraft: 세션에 초안 id·저장 시각을 남기고 작업본은 그대로(저장 전 표시는 남는다)', () => {
    const { e } = panelFixture([imageStep(0)])
    e.editCell('s0', 'accept', 0.8)
    const working = e.session.working
    e.markDraft({ draftId: 'd1', savedAt: '2026-11-09T05:00:00.000Z', revision: 2 })
    expect(e.session.draft).toEqual({ id: 'd1', savedAt: '2026-11-09T05:00:00.000Z' })
    expect(e.session.working).toBe(working)
    expect(e.undo).toHaveLength(1)
  })
})

import { defaultProperty } from '../editor/newScenario'
describe('editStore — 새 시나리오(beginNew), P2-D Task 6', () => {
  beforeEach(() => { setActivePinia(createPinia()); Object.values(api).forEach((f) => f.mockReset()) })
  const params = { process: 'P', model: 'M2', name: 'NEW_ONE', type: 1, description: '새 메일', timeoutLimit: '240' }
  const start = () => { const s = useEditorStore(); s.me = { singleid: 'u', canWrite: true, authorityManager: 3 }; return { s, e: useEditStore() } }
  // 브라우저가 만든 스텝 둘(n1 ← n2 의 실패 갈 곳)을 작업본에 넣는다
  const withSteps = (e) => {
    const n1 = noneStep(1, { uid: 'n1', origin: null })
    const n2 = noneStep(2, { uid: 'n2', origin: null, next: { onTrue: { kind: 'end', value: 'SUCCESS' }, onFalse: { kind: 'step', uid: 'n1' } } })
    e.session = { ...e.session, working: { ...e.session.working, steps: [n1, n2] } }
  }
  const copy = (e, uids, cut = false) => { e.setSelection({ uids, anchor: uids[0] }); return e.copySelection(cut) }

  it('출처 없는 세션(source·headCrtime·propertyRev null, 스텝 0, 운영 속성 기본값)과 새 대상을 담은 열린 뼈대', () => {
    const { s, e } = panelFixture([imageStep(0)]) // 앞에 연 시나리오(쓰기 권한 있음)
    e.editCell('s0', 'accept', 0.8)
    expect(e.beginNew(params)).toBe(true)
    expect(e.session).toMatchObject({ source: null, headCrtime: null, propertyRev: null, readOnly: null, seq: 0 })
    expect(e.session.working).toEqual({ source: null, headCrtime: null, header: { description: '새 메일', timeoutLimit: '240', windows: { target: { text: '', className: '', checkRect: false, left: 0, top: 0, right: 0, bottom: 0 }, hiding: [] } }, steps: [], property: defaultProperty({ id: 'P-M2-NEW_ONE', type: 1 }) })
    expect(e.session.saveBase).toBe(e.session.working)
    expect(s.skeleton).toMatchObject({ process: 'P', model: 'M2', name: 'NEW_ONE', id: 'P-M2-NEW_ONE', isNew: true })
    expect(s.selectedUid).toBe(null)
    expect(e.panel.uid).toBe(null)
    expect(e.editable).toBe(true)
    expect(e.undo).toEqual([])
  })
  it('쓰기 권한이 없으면 만들지 않는다', () => {
    const { s, e } = start()
    s.me = { singleid: 'u', canWrite: false }
    expect(e.beginNew(params)).toBe(false)
    expect(e.session).toBe(null)
    expect(s.skeleton).toBe(null)
  })
  it('진행 중인 열기는 버린다 — 늦게 끝나도 새 시나리오를 덮지 않는다', async () => {
    const { s, e } = start()
    let resolve
    api.open.mockReturnValue(new Promise((r) => { resolve = r }))
    const opening = s.openScenario({ process: 'P', model: 'M', name: 'N' })
    expect(s.opening).not.toBe(null)
    e.beginNew(params)
    expect(s.opening).toBe(null)
    resolve(ok(skeleton))
    await opening
    expect(s.skeleton.name).toBe('NEW_ONE')
    expect(e.session.source).toBe(null)
  })
  it('같은 새 시나리오 안의 복사·붙여넣기는 같은 판 — 묶음 밖 갈 곳이 그대로 남고, 잘라내기는 옮기기', () => {
    const { e } = start()
    e.beginNew(params)
    withSteps(e)
    copy(e, ['n2'])
    expect(e.pasteClip('end')).toBe(true)
    const pasted = e.session.working.steps[2]
    expect(pasted.uid).toMatch(/^p/)
    expect(pasted.next.onFalse).toEqual({ kind: 'step', uid: 'n1' })
    copy(e, ['n2'], true)
    e.setSelection({ uids: ['n1'], anchor: 'n1' })
    expect(e.pasteClip('before')).toBe(true)
    expect(e.session.working.steps.map((x) => x.uid)).toEqual(['n2', 'n1', pasted.uid])
  })
  it('다른 새 시나리오로 가면 다른 판 — 묶음 밖 갈 곳은 미해결, 잘라내기는 복사가 된다', () => {
    const { e } = start()
    e.beginNew(params)
    withSteps(e)
    copy(e, ['n2'], true)
    e.beginNew({ ...params, name: 'NEW_TWO' })
    expect(e.clip.cut).toBe(false)
    expect(e.pasteClip('end')).toBe(true)
    expect(e.session.working.steps[0].next.onFalse).toStrictEqual({ kind: 'unresolved', value: 1 })
  })
  it('저장 전 N곳: 막 만들면 0, 만든 뒤 바꾼 바 칸·운영 속성·스텝을 센다(기준 = 만든 때의 작업본)', () => {
    const { e } = start()
    e.beginNew(params)
    expect(e.unsavedCount).toBe(0)
    e.setHeader('description', '고친 메일')
    e.applyProperty({ ...e.session.working.property, IsEnabled: false })
    withSteps(e)
    expect(e.unsavedCount).toBe(4)
    expect(unsavedChanges(e.session.working, e.session.saveBase).map((c) => c.key ?? c.kind)).toEqual(['description', 'property', 'added', 'added'])
  })
})
import { unsavedChanges } from '../editor/diff'

// ── 불러오기 창에서 여는 세션(P2-D Task 7): 되돌려 열기·초안 이어서 열기·지워짐 ──
describe('editStore — 되돌려 열기(beginRestore)·초안 이어서 열기(beginFromDraft)·지워짐, P2-D Task 7', () => {
  beforeEach(() => { setActivePinia(createPinia()); Object.values(api).forEach((f) => f.mockReset()); Object.values(fx).forEach((f) => f.mockReset()) })
  const start = (canWrite = true) => { const s = useEditorStore(); s.me = { singleid: 'u', canWrite, authorityManager: 3 }; return { s, e: useEditStore() } }
  // 판 하나를 연 뼈대(P1 열기 응답). head = 그 이름의 현재 버전, property = 문서의 지금 값(판마다 남지 않는다)
  // imageFp = 판마다 서버가 보내는 그림 내용 지문(SEW-019) — 기본은 두 판의 imageStep(0) 그림이 같은 내용
  const versionOf = (crtime, steps, { head = 30, fileId = `F${crtime}`, property = { IsEnabled: true, Type: 1 }, rev = `r${head}`, description = '메일', imageFp = { 's0-bi': 'B0', 's0-train-0': 'T0' } } = {}) => {
    const ed = { source: { process: 'P', model: 'M', name: 'N', crtime, fileId }, headCrtime: head, header: { description, timeoutLimit: '10' }, steps, property }
    return {
      process: 'P', model: 'M', name: 'N', id: 'P-M-N', headCrtime: head, propertyRev: rev, version: { crtime, isCurrent: crtime === head, fileId },
      header: { description, timeoutLimit: 10, targetWindow: null }, property, performance: null, notes: [],
      steps: steps.map((st, i) => ({ ...st, no: i + 1, notes: [] })), edited: ed, imageFp
    }
  }
  const OLD = () => versionOf(10, [imageStep(0), noneStep(1, { descriptionToEmail: '옛 설명' })], { property: { IsEnabled: true, Type: 1 }, description: '옛 메일' })
  const CUR = () => versionOf(30, [imageStep(0), noneStep(1), noneStep(2)], { property: { IsEnabled: false, Type: 2 } })

  it('beginRestore: 작업본 = 옛 판 내용, 출처 = 옛 판, headCrtime·propertyRev·운영 속성 = 현재 판, restoredFrom = 옛 판 crtime, 쓸 수 있다', () => {
    const { s, e } = start()
    const old = OLD(); const cur = CUR()
    expect(e.beginRestore(old, cur)).toBe(true)
    expect(e.session.source).toEqual({ process: 'P', model: 'M', name: 'N', crtime: 10, fileId: 'F10' })
    expect(e.session.headCrtime).toBe(30)
    expect(e.session.propertyRev).toBe('r30')
    expect(e.session.restoredFrom).toBe(10)
    expect(e.session.readOnly).toBe(null)
    expect(e.editable).toBe(true)
    expect(e.session.working.steps).toBe(old.edited.steps)
    expect(e.session.working.header).toEqual({ description: '옛 메일', timeoutLimit: '10' })
    expect(e.session.working.property).toEqual({ IsEnabled: false, Type: 2 })
    expect(e.session.working.source).toEqual(old.edited.source)
    // 저장 기준점 = 현재 판 — "저장 전 N곳" 은 배포하면 바뀌는 곳(메일 제목·고친 스텝 1·지워질 스텝 1)
    expect(e.session.saveBase).toBe(cur.edited)
    expect(unsavedChanges(e.session.working, e.session.saveBase, e.session.imageFp).map((c) => c.key ?? c.kind)).toEqual(['description', 'changed', 'deleted'])
    // 열린 뼈대는 현재 판(바 "현재 버전", 주소)이고 내용(스텝·대상 창)은 옛 판
    expect(s.skeleton.version).toEqual(cur.version)
    expect(toRaw(s.skeleton).steps).toBe(old.steps) // 열린 뼈대는 ref(깊은 반응형)라 원본으로 비교
    expect(s.selectedUid).toBe('s0')
    // 배포 meta: 기준 판은 옛 판, 연 때의 현재 버전은 현재 판
    const { meta } = buildMeta(e.session)
    expect(meta.scenario.source.crtime).toBe(10)
    expect(meta.scenario.headCrtime).toBe(30)
    expect(meta.propertyRev).toBe('r30')
    expect(meta.target).toEqual({ process: 'P', model: 'M', name: 'N' })
  })
  describe('beginRestore: 표시·칸 검사의 기준은 연 판(옛 판)이다 — 저장 기준점(현재 판)은 "배포하면 바뀌는 곳" 에만(SEW-022 (1))', () => {
    // 옛 판의 2번 = OCR 인데 마우스 클릭(옛 값 — 손대지 않았으면 막지 않고 안내만). 현재 판의 같은 uid 스텝은 다른 스텝이다.
    const legacy = () => ocrStep(1, { action: { type: 1, typeName: 'MouseLeftClick', raw: '5:5', click: { x: 5, y: 5, basis: 'trainImage' } } })
    const restored = () => {
      const { s, e } = start()
      const old = versionOf(10, [imageStep(0), legacy()], { description: '옛 메일' })
      old.steps[1].notes = [{ level: 'info', code: 'OCR_MOUSE_CLICK', params: {} }] // 서버가 단 스텝 알림
      old.notes = [{ level: 'warning', code: 'NO_SUCCESS', params: {} }] // 서버가 단 시나리오 알림
      const cur = CUR()
      e.beginRestore(old, cur)
      return { s, e, old, cur }
    }
    it('세션: sourceBase = 옛 판 작업본, saveBase = 현재 판 작업본', () => {
      const { e, old, cur } = restored()
      expect(e.session.sourceBase).toBe(old.edited)
      expect(e.session.saveBase).toBe(cur.edited)
    })
    it('손대지 않은 스텝은 옛 판 뼈대의 표시를 그대로 쓴다 — 서버가 단 알림이 남는다', () => {
      const { s, old } = restored()
      expect(s.steps[1].notes).toEqual(old.steps[1].notes)
      expect(toRaw(s.steps[0])).toBe(toRaw(s.skeleton).steps[0]) // 열린 뼈대는 깊은 반응형 — 원본으로 견준다
    })
    it('스텝을 바꾸지 않았으면 시나리오 알림 NO_SUCCESS 가 남는다', () => {
      const { s } = restored()
      expect(s.scenarioNotes.map((n) => n.code)).toEqual(['NO_SUCCESS'])
    })
    it('패널 칸 검사: 옛 판에서 손대지 않은 OCR + 클릭은 안내(notice)이지 막힘이 아니다', () => {
      const { e } = restored()
      e.openPanel('s1')
      expect(e.panelErrors().action).toMatchObject({ code: 'OCR_MOUSE_CLICK', level: 'notice' })
    })
    it('표 칸을 바꿨다가 옛 값으로 되돌리면 옛 판 스텝 객체를 다시 쓴다 — 표시가 서버 값으로 돌아온다', () => {
      const { s, e, old } = restored()
      expect(e.editCell('s0', 'accept', 0.5)).toBe(true)
      expect(e.session.working.steps[0]).not.toBe(old.edited.steps[0])
      expect(e.editCell('s0', 'accept', 0.9)).toBe(true)
      expect(e.session.working.steps[0]).toBe(old.edited.steps[0])
      expect(toRaw(s.steps[0])).toBe(toRaw(s.skeleton).steps[0]) // 열린 뼈대는 깊은 반응형 — 원본으로 견준다
    })
  })
  it('beginRestore: 고치지 않은 그림 스텝은 두 판의 그림 내용이 같으면 바뀐 것이 아니고, 다르면 바뀐 것이다(SEW-019)', () => {
    const { e } = start()
    e.beginRestore(OLD(), CUR())
    expect(e.changeCount).toBe(3) // 메일 제목·고친 2번·지워질 3번 — 1번 그림 스텝은 판마다 그림 URL 이 달라도 세지 않는다
    expect(e.unsavedCount).toBe(3)
    const { e: e2 } = start()
    e2.beginRestore(versionOf(10, [imageStep(0), noneStep(1, { descriptionToEmail: '옛 설명' })], { imageFp: { 's0-bi': 'OLD', 's0-train-0': 'T0' }, description: '옛 메일' }), CUR())
    expect(unsavedChanges(e2.session.working, e2.session.saveBase, e2.session.imageFp).filter((c) => c.kind === 'changed').map((c) => c.uid)).toEqual(['s0', 's1'])
    expect(e2.changeCount).toBe(4)
  })
  it('beginRestore: 쓰기 권한이 없으면 열지 않는다', () => {
    const { e } = start(false)
    expect(e.beginRestore(OLD(), CUR())).toBe(false)
    expect(e.session).toBe(null)
  })

  // 초안(GET /drafts/:id) + 키(목록의 공정·모델·이름)
  const draftOf = (scenario, over = {}) => ({ draftId: 'd1', savedAt: '2026-11-07T05:23:51.000Z', revision: 2, base: scenario.source ? { crtime: scenario.source.crtime, fileId: scenario.source.fileId } : null,
    headCrtime: scenario.headCrtime, propertyRev: 'rD', target: { model: 'M', name: 'N' }, scenario, imageUrls: {}, process: 'P', model: 'M', name: 'N', ...over })

  it('beginFromDraft: 되돌린 판에서 시작한 초안(restoredFrom)이면 세션에 되살린다 — 바의 되돌림 표시·배포 기록(SEW-022 (2)), 아니면 없다', () => {
    const { e } = start()
    const base = versionOf(10, [imageStep(0), noneStep(1)])
    const scenario = { ...base.edited, steps: [...base.edited.steps] }
    expect(e.beginFromDraft(draftOf(scenario, { restoredFrom: 10 }), base)).toBe(true)
    expect(e.session.restoredFrom).toBe(10)
    const { meta } = buildMeta(e.session, { extra: { restoredFrom: e.session.restoredFrom ?? null } })
    expect(meta.restoredFrom).toBe(10)
    e.beginFromDraft(draftOf(scenario, { restoredFrom: null }), base)
    expect(e.session.restoredFrom).toBeUndefined()
  })
  it('beginFromDraft: 작업본 = 초안, 기준 판 = 초안 기준 판, 연 때 값(headCrtime·propertyRev)은 초안의 것 — 손대지 않은 스텝은 기준 판 스텝 객체를 쓴다', () => {
    const { s, e } = start()
    const base = versionOf(30, [imageStep(0), noneStep(1), noneStep(2)])
    const changed = { ...noneStep(1), descriptionToEmail: '초안에서 고침' }
    const scenario = { ...base.edited, header: { description: '초안 메일', timeoutLimit: '10' }, steps: [JSON.parse(JSON.stringify(imageStep(0))), changed, JSON.parse(JSON.stringify(noneStep(2)))], property: { IsEnabled: true, Type: 3 } }
    expect(e.beginFromDraft(draftOf(scenario), base)).toBe(true)
    expect(e.session.source).toEqual(base.edited.source)
    expect(e.session.headCrtime).toBe(30)
    expect(e.session.propertyRev).toBe('rD')
    expect(e.session.readOnly).toBe(null)
    expect(e.session.working.header).toEqual({ description: '초안 메일', timeoutLimit: '10' })
    expect(e.session.working.property).toEqual({ IsEnabled: true, Type: 3 })
    expect(e.session.working.steps[0]).toBe(base.edited.steps[0])
    expect(e.session.working.steps[1]).toEqual(changed)
    expect(e.session.working.steps[2]).toBe(base.edited.steps[2])
    expect(e.session.saveBase).toBe(base.edited)
    expect(unsavedChanges(e.session.working, e.session.saveBase).map((c) => c.key ?? c.kind)).toEqual(['description', 'property', 'changed'])
    expect(e.session.draft).toEqual({ id: 'd1', savedAt: '2026-11-07T05:23:51.000Z' })
    expect(e.session.fromDraft).toMatchObject({ savedAt: '2026-11-07T05:23:51.000Z', baseCrtime: 30, stale: false, gone: false })
    expect(e.draftId).toBe('d1')
    expect(toRaw(s.skeleton)).toBe(base)
    expect(s.selectedUid).toBe('s0')
    expect(e.editable).toBe(true)
  })
  it('beginFromDraft: 초안을 시작한 뒤 새 버전이 배포됐으면(초안 headCrtime ≠ 지금 현재 버전) 옛것으로 표시하고, 연 때 값은 초안의 것(배포 때 충돌로 알린다)', () => {
    const { e } = start()
    const base = versionOf(20, [noneStep(0)], { head: 30 }) // 초안은 20 에서 시작, 지금 현재는 30
    e.beginFromDraft(draftOf({ ...base.edited, headCrtime: 20 }), base)
    expect(e.session.headCrtime).toBe(20)
    expect(e.session.fromDraft.stale).toBe(true)
    expect(buildMeta(e.session).meta.scenario.headCrtime).toBe(20)
  })
  it('beginFromDraft: 서버에만 있는 초안 그림(올릴 그림, 로컬 Blob 없음)은 초안 그림 URL 로 보인다', () => {
    const { s, e } = start()
    const base = versionOf(30, [imageStep(0)])
    const st = { ...JSON.parse(JSON.stringify(imageStep(0))), images: { train: { 0: { from: 'upload', tempId: 'tUp' } }, base: { from: 'source', id: 's0-bi' } } }
    e.beginFromDraft(draftOf({ ...base.edited, steps: [st] }), base)
    expect(e.uploads.size).toBe(0)
    const shown = s.steps[0]
    expect(shown.condition.image.trainImages[0].src).toBe('http://x/api/scenario-editor/drafts/d1/images/tUp')
    expect(e.canCapture).toBe(true) // 기준 화면(기준 판 참조)으로 잡을 수 있다
  })
  it('beginFromDraft: 배포한 적 없는 새 시나리오 초안은 Task 6 새 시나리오 세션과 같은 모양(출처 없음·새 시나리오 뼈대)', () => {
    const { s, e } = start()
    const scenario = { source: null, headCrtime: null, header: { description: '새 메일', timeoutLimit: '240' }, steps: [noneStep(0, { uid: 'n1', origin: null })], property: { ...defaultProperty({ id: 'P-M-NEW_ONE', type: 1 }), RetryCnt: 2 } }
    e.beginFromDraft(draftOf(scenario, { name: 'NEW_ONE', base: null, headCrtime: null, propertyRev: null, target: { model: 'M', name: 'NEW_ONE' } }), null)
    expect(e.session).toMatchObject({ source: null, headCrtime: null, propertyRev: null, readOnly: null })
    expect(e.session.newId).toMatch(/^new/)
    // 이 기능(P2-F) 전에 저장한 초안이라 창 조건이 없다 — 빈 값으로 채운 작업본이다(나머지는 초안 그대로)
    expect(e.session.working).toEqual({ ...scenario, header: { ...scenario.header, windows: { target: { text: '', className: '', checkRect: false, left: 0, top: 0, right: 0, bottom: 0 }, hiding: [] } } })
    expect(e.session.working.steps).toBe(scenario.steps)
    expect(s.skeleton).toMatchObject({ process: 'P', model: 'M', name: 'NEW_ONE', id: 'P-M-NEW_ONE', isNew: true })
    // 기준점 = 만들 때 모습(스텝 0·기본 운영 속성) — 초안이 만든 스텝과 바꾼 운영 속성을 센다
    expect(unsavedChanges(e.session.working, e.session.saveBase).map((c) => c.key ?? c.kind)).toEqual(['property', 'added'])
    expect(e.draftId).toBe('d1')
    expect(buildMeta(e.session).meta.target).toBe(null) // 저장 창이 뼈대의 공정·모델·이름을 대상으로 넣는다
  })
  it('beginFromDraft: 원본이 지워져 기준 판 뼈대가 없으면(서버 사본으로만 남음) 초안 그대로 연다 — 저장 전 0곳, 스텝은 작업본에서 그린다', () => {
    const { s, e } = start()
    const gone = versionOf(10, [noneStep(0), noneStep(1)])
    e.beginFromDraft(draftOf(gone.edited), null)
    expect(e.session.source).toEqual(gone.edited.source)
    expect(e.session.fromDraft.gone).toBe(true)
    expect(e.unsavedCount).toBe(0)
    expect(s.skeleton).toMatchObject({ process: 'P', model: 'M', name: 'N', sourceGone: true, version: { crtime: 10, isCurrent: false, fileId: 'F10' } })
    expect(s.steps.map((x) => x.uid)).toEqual(['s0', 's1'])
    e.setHeader('description', '고침')
    expect(e.unsavedCount).toBe(1)
  })
  it('초안 지우기(forgetDraft): 그 초안으로 연 세션은 초안 그림 URL 을 잃는다', () => {
    const { e } = start()
    const base = versionOf(30, [noneStep(0)])
    e.beginFromDraft(draftOf(base.edited), base)
    e.forgetDraft('other')
    expect(e.draftId).toBe('d1')
    e.forgetDraft('d1')
    expect(e.draftId).toBe(null)
    expect(e.session.draft).toBe(null)
  })
  it('지워짐(markDeleted): 편집 화면은 읽기 전용, 고친 내용은 남고(볼 수만 있음) 떠날 때 묻지 않는다', () => {
    const { e } = panelFixture([imageStep(0), noneStep(1)])
    e.editCell('s0', 'accept', 0.8)
    expect(e.unsavedCount).toBe(1)
    e.markDeleted()
    expect(e.session.readOnly).toBe('deleted')
    expect(e.editable).toBe(false)
    expect(e.session.working.steps[0].condition.image.accept).toBe(0.8)
    expect(e.changeCount).toBe(1)
    expect(e.unsavedCount).toBe(0)
    const next = vi.fn()
    expect(e.askLeave(next)).toBe(true)
    expect(next).toHaveBeenCalled()
  })
  it('열린 시나리오를 불러오기 창에서 켜고 끄면(markPropertyChanged) 세션에 남기고 propertyRev 는 그대로 둔다(다음 배포 때 충돌로 알린다)', () => {
    const { e } = panelFixture([noneStep(0)])
    const rev = e.session.propertyRev
    e.markPropertyChanged()
    expect(e.session.propertyChanged).toBe(true)
    expect(e.session.propertyRev).toBe(rev)
  })
  it('초안으로 연 세션의 스텝을 복사해 다른 시나리오에 붙이면, 서버에만 있는 초안 그림을 받아 그 세션의 올릴 그림에 넣는다', async () => {
    const { e } = start()
    const base = versionOf(30, [imageStep(0)])
    const st = { ...JSON.parse(JSON.stringify(imageStep(0))), images: { train: { 0: { from: 'upload', tempId: 'tUp' } }, base: { from: 'source', id: 's0-bi' } } }
    e.beginFromDraft(draftOf({ ...base.edited, steps: [st] }), base)
    e.setSelection({ uids: ['s0'], anchor: 's0' })
    e.copySelection(false)
    const blob = new Blob(['png'])
    fx.loadBlob.mockResolvedValue(blob)
    const other = { ...versionOf(30, [noneStep(0)]), name: 'B', id: 'P-M-B' }
    other.edited = { ...other.edited, source: { ...other.edited.source, name: 'B' } }
    e.begin(other, useEditorStore().me)
    expect(e.pasteClip('end')).toBe(true)
    await flushPromises()
    expect(fx.loadBlob).toHaveBeenCalledWith('http://x/api/scenario-editor/drafts/d1/images/tUp')
    expect(e.uploads.get('tUp')).toBe(blob)
  })
  it('붙인 스텝의 초안 그림을 받지 못하면 조용히 넘기지 않고 그 스텝 번호로 알린다 — 세션이 바뀌었으면 알리지 않는다(SEW-023)', async () => {
    const { e } = start()
    const base = versionOf(30, [imageStep(0)])
    const st = { ...JSON.parse(JSON.stringify(imageStep(0))), images: { train: { 0: { from: 'upload', tempId: 'tUp' } }, base: { from: 'source', id: 's0-bi' } } }
    e.beginFromDraft(draftOf({ ...base.edited, steps: [st] }), base)
    e.setSelection({ uids: ['s0'], anchor: 's0' })
    e.copySelection(false)
    fx.loadBlob.mockRejectedValue(new Error('image 404'))
    const other = { ...versionOf(30, [noneStep(0)]), name: 'B', id: 'P-M-B' }
    other.edited = { ...other.edited, source: { ...other.edited.source, name: 'B' } }
    e.begin(other, useEditorStore().me)
    expect(e.pasteClip('end')).toBe(true)
    await flushPromises()
    expect(e.uploads.has('tUp')).toBe(false)
    expect(e.toast.text).toBe(t('SEW_CMD_PASTE_IMAGE_FAILED', { nos: '2' }))
    // 받는 사이 다른 시나리오를 열었으면 알리지 않는다
    let reject
    fx.loadBlob.mockImplementation(() => new Promise((_, rej) => { reject = rej }))
    e.begin(other, useEditorStore().me)
    expect(e.pasteClip('end')).toBe(true)
    e.begin({ ...other, name: 'C', id: 'P-M-C' }, useEditorStore().me)
    e.notify('다른 알림')
    reject(new Error('image 404'))
    await flushPromises()
    expect(e.toast.text).toBe('다른 알림')
  })
})
import { buildMeta } from '../editor/request'
import { flushPromises } from '@vue/test-utils'
import { toRaw } from 'vue'

// ── P3-E 스냅샷에서 스텝 만들기(P3 설계 §4.8) ──
import { SNAPSHOT_BASE_MAX_BYTES } from '../editor/snapshotStep'
describe('editStore — 스냅샷을 새 스텝의 기준 화면으로(P3-E)', () => {
  const BITMAP = { width: 640, height: 360 }
  beforeEach(() => {
    setActivePinia(createPinia())
    Object.values(api).forEach((f) => f.mockReset())
    Object.values(fx).forEach((f) => f.mockReset())
    fx.loadBitmap.mockResolvedValue(BITMAP)
    fx.cropPng.mockImplementation(async () => new Blob(['crop'], { type: 'image/png' }))
    // Blob 마다 다른 주소 — 어느 그림에서 자르는지 가른다
    urlOf = new Map()
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => { if (!urlOf.has(b)) urlOf.set(b, `blob:${urlOf.size + 1}`); return urlOf.get(b) })
  })
  let urlOf
  const snapOf = (fileName = '1763254800000_[412][288].png', eqpId = 'SEWT_PHOTO_A01') => ({ eqpId, fileName, blob: new Blob([fileName], { type: 'image/png' }) })
  const params = { process: 'P', model: 'M2', name: 'NEW_ONE', type: 1, description: '새 메일', timeoutLimit: '240' }
  // 스텝이 없는 새 시나리오
  const blank = () => {
    const s = useEditorStore()
    s.me = { singleid: 'u', canWrite: true, authorityManager: 3 }
    const e = useEditStore()
    e.beginNew(params)
    return { s, e }
  }
  // 잡기를 끝내고 패널의 [넣기] 처럼 넣는다(넣을 자리 = 패널이 고른 자리)
  const addImage = async (e) => {
    await e.captureNext({ x: 10, y: 20, w: 300, h: 200 })
    await e.captureNext({ x: 50, y: 60, w: 40, h: 30 })
    await e.captureNext({ x: 60, y: 70 })
    e.updateDraft((d) => ({ ...d, descriptionToEmail: '스냅샷 스텝' }))
    expect(e.addNew()).toBe(true)
  }

  it('스텝이 없는 새 시나리오: 스냅샷 그림이 올릴 그림으로 들어가고 그 참조가 새 이미지 스텝의 기준 화면이다 — 검색 영역 잡기부터', () => {
    const { e } = blank()
    const snap = snapOf()
    expect(e.startNew('image', { snapshot: snap })).toBe(true)
    const base = e.panel.draft.images.base
    expect(base.from).toBe('upload')
    expect(e.uploads.get(base.tempId)).toBe(snap.blob) // 화면에 떠 있던 바로 그 바이트
    expect(e.uploads.size).toBe(1)
    expect(e.panel).toMatchObject({ isNew: true, insertBefore: null })
    expect(e.capture).toMatchObject({ flow: ['area', 'train', 'click'], stage: 'area' })
    expect(e.session.working.steps).toEqual([])
  })
  it('OCR 스텝도 같다 — OCR 영역 잡기부터', () => {
    const { e } = blank()
    expect(e.startNew('ocr', { snapshot: snapOf() })).toBe(true)
    expect(e.panel.draft.condition.kind).toBe('ocr')
    expect(e.panel.draft.images.base.from).toBe('upload')
    expect(e.capture).toMatchObject({ flow: ['ocr'], stage: 'ocr' })
  })
  it('잡아서 넣으면 작업본 스텝의 기준 화면이 그 올릴 그림이고, 찾을 그림은 그 그림에서 자른다', async () => {
    const { e } = blank()
    const snap = snapOf()
    e.startNew('image', { snapshot: snap })
    const other = snapOf('1763254900000_[10][20].png') // 올릴 그림에 다른 스냅샷도 있다
    e.setUpload('tOther', other.blob)
    URL.createObjectURL(other.blob)
    await addImage(e)
    expect(urlOf.get(snap.blob)).toBeTruthy()
    expect(fx.loadBitmap.mock.calls.map((c) => c[0])).toEqual([urlOf.get(snap.blob)]) // 그 스냅샷의 그림에서만 자른다
    const [st] = e.session.working.steps
    expect(e.uploads.get(st.images.base.tempId)).toBe(snap.blob)
    expect(st.images.train['0'].from).toBe('upload')
    expect(st.images.train['0'].tempId).not.toBe(st.images.base.tempId)
  })
  it('같은 스냅샷으로 스텝을 여러 개 만들면 그림은 하나만 올린다, 다른 스냅샷은 따로', async () => {
    const { e } = blank()
    const a = snapOf()
    e.startNew('image', { snapshot: a })
    await addImage(e)
    const first = e.session.working.steps[0].images.base.tempId
    // 같은 스냅샷을 다시 받아 Blob 객체가 달라도(그림 기억에서 밀려났다가 다시 받음) 같은 그림이다
    expect(e.startNew('ocr', { snapshot: { ...a, blob: new Blob([a.fileName]) } })).toBe(true)
    expect(e.panel.draft.images.base).toEqual({ from: 'upload', tempId: first })
    expect(e.uploads.get(first)).toBe(a.blob)
    await e.captureNext({ x: 5, y: 5, w: 100, h: 40 })
    e.updateDraft((d) => ({ ...d, descriptionToEmail: 'OCR', condition: { ...d.condition, ocr: { ...d.condition.ocr, op: 1, opName: 'TextEqual', type: 1, text: 'IDLE' } } }))
    expect(e.addNew()).toBe(true)
    expect(e.session.working.steps.map((s) => s.images.base.tempId)).toEqual([first, first])
    const { uploadsUsed } = buildMeta(toRaw(e.session))
    expect(uploadsUsed.filter((id) => id === first)).toHaveLength(1)
    expect(uploadsUsed).toHaveLength(2) // 기준 화면 하나 + 찾을 그림 하나
    // 다른 스냅샷(같은 이름의 다른 설비 포함)은 다른 그림
    const b = snapOf('1763254900000_[10][20].png')
    e.startNew('image', { snapshot: b })
    expect(e.panel.draft.images.base.tempId).not.toBe(first)
    e.cancelNew()
    e.startNew('image', { snapshot: snapOf(a.fileName, 'SEWT_CVD_A01') })
    expect(e.panel.draft.images.base.tempId).not.toBe(first)
  })
  it('스텝을 고른 채 스냅샷으로 만들면 기준 화면은 고른 스텝의 것이 아니라 스냅샷이고, 넣을 자리는 고른 줄 뒤다(자리는 바꿀 수 있다)', () => {
    const { s, e } = panelFixture([imageStep(0), imageStep(1), noneStep(2)])
    s.select('s1')
    const snap = snapOf()
    expect(e.startNew('image', { snapshot: snap })).toBe(true)
    expect(e.panel.draft.images.base.from).toBe('upload')
    // 스냅샷을 시각 순서로 넘기며 스텝을 이어 만들 때 순서대로 쌓이게 — 고른 줄(흔히 방금 넣은 스텝)의 뒤다
    expect(e.panel).toMatchObject({ insertBefore: 's2', origin: 's1' })
    expect(e.setInsertBefore('s0')).toBe(true)
    expect(e.panel.insertBefore).toBe('s0')
    // [취소] 하면 시작할 때 고른 줄로 돌아간다
    e.cancelNew()
    expect(e.selection).toEqual({ uids: ['s1'], anchor: 's1' })
    // 스냅샷을 주지 않으면 고른 스텝의 기준 화면을 빌린다 — 넣을 자리는 같다
    e.startNew('image')
    expect(e.panel.draft.images.base).toEqual({ from: 'source', id: 's1-bi' })
    expect(e.panel.insertBefore).toBe('s2')
  })
  it('스냅샷으로 이어 만든 스텝은 만든 순서대로 쌓인다', async () => {
    const { e } = blank()
    e.startNew('image', { snapshot: snapOf() })
    await addImage(e)
    const first = e.session.working.steps[0].uid
    expect(e.selection.anchor).toBe(first) // 방금 넣은 스텝이 골라져 있다
    e.startNew('image', { snapshot: snapOf('1763254900000_[10][20].png') })
    await addImage(e)
    expect(e.session.working.steps.map((x) => x.uid)[0]).toBe(first)
    expect(e.session.working.steps).toHaveLength(2)
  })
  it('조건 없는 스텝은 스냅샷을 쓰지 않는다', () => {
    const { e } = blank()
    expect(e.startNew('none', { snapshot: snapOf() })).toBe(true)
    expect(e.panel.draft.images.base).toEqual({ literal: 'AA==' })
    expect(e.uploads.size).toBe(0)
  })
  it('그림이 서버가 받는 한 장 크기(10MB)를 넘으면 만들지 않고 알린다 — 올릴 그림에 넣지 않는다', () => {
    const { e } = blank()
    const big = snapOf()
    Object.defineProperty(big.blob, 'size', { value: SNAPSHOT_BASE_MAX_BYTES + 1 })
    expect(e.startNew('image', { snapshot: big })).toBe(false)
    expect(e.toast.text).toBe(t('SEW_SNAP_STEP_TOO_LARGE'))
    expect(e.panel.isNew).toBe(false)
    expect(e.uploads.size).toBe(0)
  })
  it('그림이 없는 스냅샷(받는 중·실패)으로는 만들지 않는다 — 고른 스텝의 기준 화면으로 넘어가지도 않는다', () => {
    const { s, e } = panelFixture([imageStep(0)])
    s.select('s0')
    expect(e.startNew('image', { snapshot: null })).toBe(false)
    expect(e.startNew('image', { snapshot: { eqpId: 'E', fileName: 'f.png', blob: undefined } })).toBe(false)
    expect(e.panel.isNew).toBe(false)
    expect(e.toast.text).toBe(t('SEW_SNAP_STEP_NO_IMAGE'))
  })
  it('스텝이 200개면 막고, 올릴 그림에 넣지 않는다', () => {
    const { e } = panelFixture(Array.from({ length: STEP_MAX }, (_, i) => noneStep(i)))
    expect(e.startNew('image', { snapshot: snapOf() })).toBe(false)
    expect(e.toast.text).toBe(t('SEW_CMD_REFUSED_STEP_LIMIT'))
    expect(e.uploads.size).toBe(0)
  })
  it('이 그림을 더 올리면 한 번의 저장이 합계 50MB 를 넘게 되면 만들지 않고 먼저 배포하라고 알린다 — 쓰는 그림만 세고, 이미 올린 같은 스냅샷은 된다', async () => {
    const MB = 1048576
    const sizedSnap = (n, mb) => { const sn = snapOf(`176325480000${n}_[1][1].png`); Object.defineProperty(sn.blob, 'size', { value: mb * MB }); return sn }
    const { e } = blank()
    const first = sizedSnap(0, 10)
    for (const sn of [first, sizedSnap(1, 10), sizedSnap(2, 10), sizedSnap(3, 10)]) { // 넣은 스텝 넷: 40MB + 찾을 그림 넷
      expect(e.startNew('image', { snapshot: sn })).toBe(true)
      await addImage(e)
    }
    expect(e.startNew('image', { snapshot: sizedSnap(4, 9) })).toBe(true) // 49MB 남짓 — 된다
    e.cancelNew()
    const before = e.uploads.size
    expect(e.startNew('image', { snapshot: sizedSnap(5, 10) })).toBe(false) // 40MB + 찾을 그림 + 10MB > 50MB
    expect(e.toast.text).toBe(t('SEW_SNAP_STEP_TOTAL_TOO_LARGE'))
    expect(e.panel.isNew).toBe(false)
    expect(e.uploads.size).toBe(before)
    // 만들다 그만둔 스냅샷(9MB)은 올릴 그림에 남아 있어도 보내지 않으므로 세지 않는다 — 셌다면 40 + 9 + 9 > 50 으로 막혔다
    expect(e.startNew('image', { snapshot: sizedSnap(6, 9) })).toBe(true)
    e.cancelNew()
    expect(e.startNew('ocr', { snapshot: first })).toBe(true) // 이미 올린 스냅샷 — 더 올리는 것이 없다
  })
  it('올릴 그림이 200장을 넘게 되면 만들지 않고 알린다', () => {
    const steps = Array.from({ length: 100 }, (_, i) => imageStep(i, { images: { train: { 0: { from: 'upload', tempId: `t${i}` } }, base: { from: 'upload', tempId: `b${i}` } } }))
    const { e } = panelFixture(steps)
    for (let i = 0; i < 100; i++) { e.setUpload(`t${i}`, new Blob(['t'])); e.setUpload(`b${i}`, new Blob(['b'])) }
    expect(e.startNew('image', { snapshot: snapOf() })).toBe(false)
    expect(e.toast.text).toBe(t('SEW_SNAP_STEP_TOO_MANY_FILES'))
    expect(e.uploads.size).toBe(200)
  })
  it('읽기 전용 세션에서는 만들지 않는다', () => {
    const { e } = panelFixture([imageStep(0)], { canWrite: false })
    expect(e.startNew('image', { snapshot: snapOf() })).toBe(false)
    expect(e.uploads.size).toBe(0)
  })
  it('패널에 적용 안 한 변경이 있으면 먼저 묻고, [버리고 이동] 뒤에는 누를 때 떠 있던 그림으로 만든다', () => {
    const { e } = panelFixture([imageStep(0), imageStep(1)])
    e.updateDraft((d) => ({ ...d, descriptionToEmail: '바뀜' }))
    const snap = snapOf()
    expect(e.startNew('image', { snapshot: snap })).toBe(false)
    expect(e.dialog).toMatchObject({ kind: 'guard', action: 'move' })
    expect(e.uploads.size).toBe(0) // 아직 넣지 않았다
    e.guardDrop()
    expect(e.panel.isNew).toBe(true)
    expect(e.uploads.get(e.panel.draft.images.base.tempId)).toBe(snap.blob)
  })
  it('다른 시나리오를 열면 올릴 그림이 비워지므로 같은 스냅샷도 새 그림으로 넣는다', () => {
    const { e } = blank()
    const snap = snapOf()
    e.startNew('image', { snapshot: snap })
    const first = e.panel.draft.images.base.tempId
    e.beginNew({ ...params, name: 'NEW_TWO' })
    expect(e.uploads.size).toBe(0)
    e.startNew('image', { snapshot: snap })
    const second = e.panel.draft.images.base.tempId
    expect(second).not.toBe(first)
    expect(e.uploads.get(second)).toBe(snap.blob)
  })
  it('스냅샷으로 만든 스텝을 복사하면 묶음에 기준 화면 그림이 함께 든다(다른 시나리오에 붙일 수 있게)', async () => {
    const { e } = blank()
    const snap = snapOf()
    e.startNew('image', { snapshot: snap })
    await addImage(e)
    const st = e.session.working.steps[0]
    e.setSelection({ uids: [st.uid], anchor: st.uid })
    expect(e.copySelection(false)).toBeTruthy()
    expect(e.clip.uploads.get(st.images.base.tempId)).toBe(snap.blob)
    expect(e.clip.uploads.size).toBe(2)
  })
})

// ── 새 스텝의 화면(스냅샷·그림 파일·고른 스텝)과 넣을 자리(2026-11-17 사내 요청) ──
describe('editStore — 새 스텝의 화면과 넣을 자리(2026-11-17)', () => {
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  beforeEach(() => {
    setActivePinia(createPinia())
    Object.values(api).forEach((f) => f.mockReset())
    Object.values(fx).forEach((f) => f.mockReset())
    fx.bitmapOf.mockResolvedValue({ width: 1920, height: 1080 })
    fx.loadBitmap.mockResolvedValue({ width: 1920, height: 1080 })
    fx.cropPng.mockImplementation(async () => new Blob(['converted'], { type: 'image/png' }))
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:x')
  })
  const mk = (steps = [imageStep(0), imageStep(1), noneStep(2)], opts) => panelFixture(steps, opts)
  const validNone = (d) => ({ ...d, descriptionToEmail: '재시작', action: { ...d.action, command: 'restart.bat' } })
  const uids = (e) => e.session.working.steps.map((x) => x.uid)
  const pngFile = (name = 'screen.png', extra = [1, 2, 3]) => new File([new Uint8Array([...PNG, ...extra])], name, { type: 'image/png', lastModified: 1763254800000 })
  const jpgFile = (name = 'screen.jpg') => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0])], name, { type: 'image/jpeg', lastModified: 1763254800000 })
  const prepared = (key = 'file\nscreen.png\n11\n1', bytes = 'local') => ({ key, blob: new Blob([bytes], { type: 'image/png' }), w: 1920, h: 1080 })

  it('넣을 자리는 고른 줄 뒤(그 다음 줄 앞) — 마지막 줄을 골랐거나 고른 줄이 없으면 맨 끝', () => {
    const { s, e } = mk()
    s.select('s0')
    e.startNew('none')
    expect(e.panel).toMatchObject({ isNew: true, insertBefore: 's1', origin: 's0' })
    e.cancelNew()
    s.select('s2')
    e.startNew('none')
    expect(e.panel).toMatchObject({ insertBefore: null, origin: 's2' })
    e.cancelNew()
    e.setSelection({ uids: [], anchor: null })
    e.startNew('none')
    expect(e.panel).toMatchObject({ insertBefore: null, origin: null })
  })
  it('이어 만들면 만든 순서대로 쌓인다 — 넣은 스텝이 골라지고 다음 새 스텝은 그 뒤', () => {
    const { s, e } = mk()
    s.select('s0')
    e.startNew('none'); e.updateDraft(validNone)
    const a = e.panel.uid
    expect(e.addNew()).toBe(true)
    expect(uids(e)).toEqual(['s0', a, 's1', 's2'])
    e.startNew('none'); e.updateDraft(validNone)
    const b = e.panel.uid
    expect(e.addNew()).toBe(true)
    expect(uids(e)).toEqual(['s0', a, b, 's1', 's2'])
  })
  it('스냅샷·그림 파일로 만들어도 넣을 자리는 같다(고른 줄 뒤)', () => {
    const { s, e } = mk()
    s.select('s0')
    expect(e.startNew('image', { snapshot: { eqpId: 'SEWT_PHOTO_A01', fileName: '1763254800000_[412][288].png', blob: new Blob(['snap'], { type: 'image/png' }) } })).toBe(true)
    expect(e.panel).toMatchObject({ insertBefore: 's1', origin: 's0' })
    e.cancelNew()
    expect(e.startNew('ocr', { file: prepared() })).toBe(true)
    expect(e.panel).toMatchObject({ insertBefore: 's1', origin: 's0' })
  })
  it('고른 스텝의 화면 빌리기: 고른 스텝에 기준 화면이 없거나 고른 줄이 없으면 시작하지 않는다 — 첫 스텝의 화면으로 넘어가지 않는다', () => {
    const { s, e } = mk()
    s.select('s2') // 조건 없는 스텝
    expect(e.startNew('image')).toBe(false)
    expect(e.panel.isNew).toBe(false)
    expect(e.toast.text).toBe(t('SEW_EDIT_NEW_NO_BASE'))
    e.setSelection({ uids: [], anchor: null })
    expect(e.startNew('ocr')).toBe(false)
    s.select('s1')
    expect(e.startNew('image')).toBe(true)
    expect(e.panel.draft.images.base).toEqual({ from: 'source', id: 's1-bi' })
  })
  it('newOrigin: 빌릴 스텝(고른 줄, 새 스텝을 만드는 중이면 시작할 때 고른 줄)과 그 기준 화면', () => {
    const { s, e } = mk()
    s.select('s1')
    expect(e.newOrigin).toEqual({ uid: 's1', no: 2, base: { from: 'source', id: 's1-bi' } })
    s.select('s2')
    expect(e.newOrigin).toEqual({ uid: 's2', no: 3, base: null })
    e.setSelection({ uids: [], anchor: null })
    expect(e.newOrigin).toBe(null)
    s.select('s0')
    e.startNew('none')
    expect(e.selection.anchor).toBe(null)
    expect(e.newOrigin).toEqual({ uid: 's0', no: 1, base: { from: 'source', id: 's0-bi' } })
  })
  it('새 스텝을 만드는 중에 다시 시작하면 시작할 때 고른 줄의 화면을 빌리고, 바꿔 둔 넣을 자리는 그대로다', () => {
    const { s, e } = mk()
    s.select('s0')
    e.startNew('none')
    expect(e.setInsertBefore('s2')).toBe(true)
    expect(e.startNew('image')).toBe(true)
    expect(e.panel.draft.images.base).toEqual({ from: 'source', id: 's0-bi' })
    expect(e.panel).toMatchObject({ insertBefore: 's2', origin: 's0' })
    expect(e.setInsertBefore(null)).toBe(true)
    expect(e.startNew('none')).toBe(true)
    expect(e.panel).toMatchObject({ insertBefore: null, origin: 's0' })
  })
  it('그림 파일(file): 그 그림이 올릴 그림으로 들어가 기준 화면이 된다 — 같은 파일은 하나를 함께 쓰고 다른 파일은 따로', () => {
    const { e } = mk()
    const f = prepared()
    expect(e.startNew('image', { file: f })).toBe(true)
    const base = e.panel.draft.images.base
    expect(base.from).toBe('upload')
    expect(e.uploads.get(base.tempId)).toBe(f.blob)
    expect(e.capture).toMatchObject({ flow: ['area', 'train', 'click'], stage: 'area' })
    e.cancelNew()
    expect(e.startNew('ocr', { file: prepared() })).toBe(true) // 같은 키
    expect(e.panel.draft.images.base.tempId).toBe(base.tempId)
    expect(e.uploads.get(base.tempId)).toBe(f.blob)
    e.cancelNew()
    expect(e.startNew('image', { file: prepared('file\nother.png\n5\n1') })).toBe(true)
    expect(e.panel.draft.images.base.tempId).not.toBe(base.tempId)
  })
  it('그림 파일: 준비된 그림이 없으면 만들지 않는다 — 고른 스텝의 화면으로 넘어가지도 않는다, 조건 없는 스텝은 파일을 쓰지 않는다', () => {
    const { s, e } = mk()
    s.select('s1')
    expect(e.startNew('image', { file: null })).toBe(false)
    expect(e.startNew('image', { file: { key: 'k', blob: undefined } })).toBe(false)
    expect(e.panel.isNew).toBe(false)
    expect(e.toast.text).toBe(t('SEW_NEW_FILE_NOT_IMAGE'))
    expect(e.startNew('none', { file: prepared() })).toBe(true)
    expect(e.panel.draft.images.base).toEqual({ literal: 'AA==' })
    expect(e.uploads.size).toBe(0)
  })
  it('startNewFromFile: PNG 파일은 바이트 그대로 기준 화면이 되고 잡기가 시작된다', async () => {
    const { e } = mk()
    const f = pngFile()
    expect(await e.startNewFromFile('image', f)).toBe(true)
    const base = e.panel.draft.images.base
    const up = e.uploads.get(base.tempId)
    expect(up).not.toBe(f) // 파일 참조가 아니라 메모리의 사본 — 고른 뒤 디스크의 파일이 바뀌어도 읽힌다
    expect([...new Uint8Array(await up.arrayBuffer())]).toEqual([...new Uint8Array(await f.arrayBuffer())])
    expect(fx.cropPng).not.toHaveBeenCalled()
    expect(e.capture).toMatchObject({ stage: 'area' })
  })
  it('startNewFromFile: PNG 가 아니면 PNG 로 바꿔 올린다(그림 전체)', async () => {
    const { e } = mk()
    const bitmap = { width: 800, height: 600 }
    fx.bitmapOf.mockResolvedValue(bitmap)
    expect(await e.startNewFromFile('ocr', jpgFile())).toBe(true)
    expect(fx.cropPng).toHaveBeenCalledWith(bitmap, { x: 0, y: 0, w: 800, h: 600 })
    const blob = e.uploads.get(e.panel.draft.images.base.tempId)
    expect(await blob.text()).toBe('converted')
    expect(e.capture).toMatchObject({ flow: ['ocr'], stage: 'ocr' })
  })
  it('startNewFromFile: 그림이 아니거나 너무 크면 만들지 않고 알린다', async () => {
    const { e } = mk()
    fx.bitmapOf.mockRejectedValue(new Error('decode'))
    expect(await e.startNewFromFile('image', new File(['hello'], 'a.txt', { type: 'text/plain' }))).toBe(false)
    expect(e.toast.text).toBe(t('SEW_NEW_FILE_NOT_IMAGE'))
    expect(e.panel.isNew).toBe(false)
    fx.bitmapOf.mockResolvedValue({ width: 10, height: 10 })
    const big = pngFile('big.png')
    Object.defineProperty(big, 'size', { value: 10 * 1048576 + 1 })
    expect(await e.startNewFromFile('image', big)).toBe(false)
    expect(e.toast.text).toBe(t('SEW_NEW_FILE_TOO_LARGE'))
    expect(e.uploads.size).toBe(0)
  })
  it('startNewFromFile: 읽기 전용·조건 없는 스텝·파일 없음은 아무것도 하지 않는다', async () => {
    const ro = mk(undefined, { canWrite: false }).e
    expect(await ro.startNewFromFile('image', pngFile())).toBe(false)
    setActivePinia(createPinia())
    const { e } = mk()
    expect(await e.startNewFromFile('none', pngFile())).toBe(false)
    expect(await e.startNewFromFile('image', null)).toBe(false)
    expect(fx.bitmapOf).not.toHaveBeenCalled()
    expect(e.panel.isNew).toBe(false)
  })
  it('startNewFromFile: 그림을 푸는 사이 다른 시나리오를 열면 버린다', async () => {
    const { s, e } = mk()
    let done
    fx.bitmapOf.mockReturnValue(new Promise((r) => { done = r }))
    const p = e.startNewFromFile('image', pngFile())
    e.begin(s.skeleton, { canWrite: true }) // 다른 세션
    done({ width: 1920, height: 1080 })
    expect(await p).toBe(false)
    expect(e.panel.isNew).toBe(false)
    expect(e.uploads.size).toBe(0)
  })
  it('startNewFromFile: 다른 스텝의 기준 화면과 크기가 다르면 알린다(막지는 않는다) — 고른 스텝, 없으면 기준 화면이 있는 첫 스텝과 견준다', async () => {
    const { s, e } = mk()
    s.select('s1')
    fx.loadBitmap.mockResolvedValue({ width: 1280, height: 1024 })
    expect(await e.startNewFromFile('image', pngFile())).toBe(true)
    await vi.waitFor(() => expect(e.toast?.text).toBe(t('SEW_NEW_FILE_SIZE_DIFF', { w: 1920, h: 1080, no: 2, bw: 1280, bh: 1024 })))
    expect(fx.loadBitmap).toHaveBeenCalledWith('http://x/api/scenario-editor/scenarios/P/M/N/versions/1/files/F/images/s1-bi')
    expect(e.panel.isNew).toBe(true)
    e.cancelNew()
    // 고른 줄이 조건 없는 스텝이면 기준 화면이 있는 첫 스텝
    s.select('s2')
    fx.loadBitmap.mockClear()
    e.toast = null
    expect(await e.startNewFromFile('image', pngFile('b.png'))).toBe(true)
    await vi.waitFor(() => expect(e.toast?.text).toBe(t('SEW_NEW_FILE_SIZE_DIFF', { w: 1920, h: 1080, no: 1, bw: 1280, bh: 1024 })))
  })
  it('startNewFromFile: 크기가 같거나, 견줄 스텝이 없거나, 그 그림을 받지 못하면 알리지 않는다', async () => {
    const { e } = mk()
    expect(await e.startNewFromFile('image', pngFile())).toBe(true)
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    expect(e.toast).toBe(null)
    e.cancelNew()
    fx.loadBitmap.mockRejectedValue(new Error('404'))
    expect(await e.startNewFromFile('image', pngFile('c.png'))).toBe(true)
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    expect(e.toast).toBe(null)
    setActivePinia(createPinia())
    const b = mk([noneStep(0)]).e
    fx.loadBitmap.mockClear()
    expect(await b.startNewFromFile('image', pngFile('d.png'))).toBe(true)
    await Promise.resolve(); await Promise.resolve()
    expect(fx.loadBitmap).not.toHaveBeenCalled()
    expect(b.toast).toBe(null)
  })

  // ── 독립 검토 반영(2026-11-17) ──
  it('검토 2: 적용 안 한 변경이 있어 확인 창을 거친 뒤에도 그림 파일의 크기가 다르면 알린다', async () => {
    const { s, e } = mk()
    s.select('s1')
    fx.loadBitmap.mockResolvedValue({ width: 1280, height: 1024 })
    e.updateDraft((d) => ({ ...d, descriptionToEmail: '바뀜' }))
    expect(await e.startNewFromFile('image', pngFile())).toBe(false) // 먼저 묻는다
    expect(e.dialog).toMatchObject({ kind: 'guard', action: 'move' })
    expect(fx.loadBitmap).not.toHaveBeenCalled()
    e.guardDrop()
    expect(e.panel.isNew).toBe(true)
    await vi.waitFor(() => expect(e.toast?.text).toBe(t('SEW_NEW_FILE_SIZE_DIFF', { w: 1920, h: 1080, no: 2, bw: 1280, bh: 1024 })))
  })
  it('검토 2: 확인 창에서 [계속 고치기] 를 누르면 올릴 그림을 남기지 않고 알림도 없다', async () => {
    const { e } = mk()
    e.updateDraft((d) => ({ ...d, descriptionToEmail: '바뀜' }))
    expect(await e.startNewFromFile('image', pngFile())).toBe(false)
    e.guardKeep()
    await Promise.resolve(); await Promise.resolve()
    expect(e.uploads.size).toBe(0)
    expect(e.panel.isNew).toBe(false)
    expect(fx.loadBitmap).not.toHaveBeenCalled()
  })
  it('검토 3: 값을 넣은 새 스텝을 두고 다시 시작해 [버리고 이동] 해도 바꿔 둔 넣을 자리와 시작할 때 고른 줄은 그대로다', () => {
    const { s, e } = mk()
    s.select('s0')
    e.startNew('none')
    expect(e.setInsertBefore(null)).toBe(true) // 맨 끝으로
    e.updateDraft(validNone)
    expect(e.startNew('image')).toBe(false) // 묻는다
    e.guardDrop()
    expect(e.panel).toMatchObject({ isNew: true, insertBefore: null, origin: 's0' })
    expect(e.panel.draft.images.base).toEqual({ from: 'source', id: 's0-bi' })
    expect(e.setInsertBefore('s2')).toBe(true)
    e.updateDraft((d) => ({ ...d, descriptionToEmail: 'x' }))
    expect(e.startNew('none')).toBe(false)
    e.guardDrop()
    expect(e.panel).toMatchObject({ isNew: true, insertBefore: 's2', origin: 's0' })
  })
  it('검토 4: 여러 줄을 골랐으면 넣을 자리는 고른 줄들 가운데 맨 아래 줄의 뒤다 — 묶음 가운데로 들어가지 않는다', () => {
    const { e } = mk([imageStep(0), imageStep(1), imageStep(2), noneStep(3)])
    e.setSelection({ uids: ['s0', 's1', 's2'], anchor: 's0' })
    e.startNew('none')
    expect(e.panel).toMatchObject({ insertBefore: 's3', origin: 's0' })
    e.cancelNew()
    e.setSelection({ uids: ['s3', 's1'], anchor: 's3' }) // 떨어진 줄 — 맨 아래 줄(s3)이 마지막이라 맨 끝
    e.startNew('none')
    expect(e.panel).toMatchObject({ insertBefore: null, origin: 's3' })
    e.cancelNew()
    e.setSelection({ uids: ['s2', 's0'], anchor: 's2' })
    e.startNew('none')
    expect(e.panel).toMatchObject({ insertBefore: 's3', origin: 's2' })
  })
  it('검토 6: 취소했던 그림(올릴 그림에 남아 있지만 스텝이 쓰지 않는다)을 다시 쓸 때도 합계 한도를 본다', async () => {
    const MB = 1048576
    const sizedBlob = (mb) => { const b = new Blob(['x'], { type: 'image/png' }); Object.defineProperty(b, 'size', { value: mb * MB }); return b }
    const fileOf = (key, mb) => ({ key, blob: sizedBlob(mb), w: 10, h: 10 })
    const { e } = mk()
    const a = fileOf('file\nA', 9)
    expect(e.startNew('ocr', { file: a })).toBe(true)
    e.cancelNew() // A 는 올릴 그림에 남지만 어느 스텝도 쓰지 않는다
    // 다른 그림으로 작업본을 45MB 까지 채운다(스텝 다섯, 9MB 씩)
    for (let i = 0; i < 5; i++) {
      expect(e.startNew('ocr', { file: fileOf(`file\nB${i}`, 9) })).toBe(true)
      await e.captureNext({ x: 1, y: 2, w: 50, h: 20 })
      e.updateDraft((d) => ({ ...d, descriptionToEmail: `파일 ${i}`, condition: { ...d.condition, ocr: { ...d.condition.ocr, op: 1, text: 'A' } } }))
      expect(e.addNew()).toBe(true)
    }
    expect(e.startNew('ocr', { file: a })).toBe(false) // 45 + 9 > 50
    expect(e.toast.text).toBe(t('SEW_SNAP_STEP_TOTAL_TOO_LARGE'))
    expect(e.panel.isNew).toBe(false)
  })
  it('검토(추측): 그림을 푸는 사이 다른 파일을 또 고르면 뒤의 것만 새 스텝이 된다', async () => {
    const { e } = mk()
    let first
    fx.bitmapOf.mockReturnValueOnce(new Promise((r) => { first = r }))
    const p1 = e.startNewFromFile('image', pngFile('slow.png', [1]))
    expect(await e.startNewFromFile('ocr', pngFile('fast.png', [2, 2]))).toBe(true)
    const uid = e.panel.uid
    first({ width: 1920, height: 1080 })
    expect(await p1).toBe(false)
    expect(e.panel.uid).toBe(uid)
    expect(e.panel.draft.condition.kind).toBe('ocr')
    expect(e.dialog).toBe(null)
    expect(e.uploads.size).toBe(1)
  })
})

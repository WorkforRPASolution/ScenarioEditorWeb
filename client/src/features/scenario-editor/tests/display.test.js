import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
vi.mock('../api', () => ({ scenarioEditorApi: {}, imageUrl: (p) => `http://x/api${p}` }))
import { displaySteps, imageSrc } from '../editor/display'
import { beginSession } from '../editor/session'
import { insertStep, setCell, applyStep, moveSteps } from '../editor/commands'
import { useEditorStore } from '../stores/editorStore'
import { useEditStore } from '../stores/editStore'

// 뼈대 스텝(P1 모양)과 편집 스텝(EditedStep)을 같은 uid 로 짝지어 만든다.
const skStep = (i, over = {}) => ({
  uid: `s${i}`, no: i + 1, notes: [{ level: 'info', code: 'BASE_IMAGE_MISSING' }],
  condition: { kind: 'image', skipPreprocessing: false, searchArea: { x: 1, y: 2, w: 3, h: 4 }, image: { accept: 0.9, multi: { count: '1', op: 0 }, trainImages: [{ key: 0, type: 0, url: `/old/s${i}-train-0` }] } },
  action: { type: 0, typeName: 'None', raw: '' }, retry: { limit: 1, intervalMs: 2000 },
  next: { onTrue: { kind: 'next' }, onFalse: { kind: 'end', value: 'FAIL' } },
  descriptionToEmail: `스텝${i}`, descriptionToDialog: '', isShowDialog: false,
  baseImage: { state: 'present', url: `/scenario-editor/x/images/s${i}-bi` }, bi: { kind: 'image', id: `s${i}-bi` },
  raw: { DescriptionToEmail: `스텝${i}` }, ...over
})
const edStep = (i, over = {}) => ({
  uid: `s${i}`, origin: i,
  condition: { kind: 'image', skipPreprocessing: false, searchArea: { x: 1, y: 2, w: 3, h: 4 }, image: { accept: 0.9, multi: { count: '1', op: 0 }, trainImages: [{ key: 0, type: 0, url: `/old/s${i}-train-0` }] } },
  action: { type: 0, typeName: 'None', raw: '' }, retry: { limit: 1, intervalMs: 2000 },
  next: { onTrue: { kind: 'next' }, onFalse: { kind: 'end', value: 'FAIL' } },
  descriptionToEmail: `스텝${i}`, descriptionToDialog: '', isShowDialog: false,
  images: { train: { 0: { from: 'source', id: `s${i}-train-0` } }, base: { from: 'source', id: `s${i}-bi` } }, ...over
})
// 3번 스텝(s2)이 1번(s0)을 가리킨다
const make = () => {
  const sk2 = skStep(2, { next: { onTrue: { kind: 'step', uid: 's0', no: 1 }, onFalse: { kind: 'end', value: 'FAIL' } } })
  const ed2 = edStep(2, { next: { onTrue: { kind: 'step', uid: 's0' }, onFalse: { kind: 'end', value: 'FAIL' } } })
  const edited = { source: { process: 'P', model: 'M', name: 'N', crtime: 7, fileId: 'F' }, headCrtime: 7, header: { description: 'd', timeoutLimit: '5' }, steps: [edStep(0), edStep(1), ed2], property: {} }
  const skeleton = { process: 'P', model: 'M', name: 'N', headCrtime: 7, version: { crtime: 7, isCurrent: true, fileId: 'F' }, steps: [skStep(0), skStep(1), sk2], notes: [], edited }
  const session = beginSession(skeleton, { canWrite: true })
  return { skeleton, session, edited }
}
const withWorking = (session, working) => ({ ...session, working })

describe('displaySteps', () => {
  it('고친 것이 없으면 뼈대 스텝 배열 그대로', () => {
    const { skeleton, session } = make()
    expect(displaySteps(session, skeleton)).toBe(skeleton.steps)
  })

  it('손대지 않은 스텝은 뼈대 값(raw·notes·URL)을 쓰고, 위치가 같으면 같은 객체', () => {
    const { skeleton, session, edited } = make()
    const w = setCell(edited, 's1', 'skip', true).working
    const out = displaySteps(withWorking(session, w), skeleton)
    expect(out[0]).toBe(skeleton.steps[0])
    expect(out[2]).toBe(skeleton.steps[2])
    expect(out[1]).not.toBe(skeleton.steps[1])
  })

  it('넣기 뒤 번호가 위치를 따르고 갈 곳 번호도 따라간다(뼈대 raw·notes 는 그대로)', () => {
    const { skeleton, session, edited } = make()
    const fresh = edStep(9, { uid: 'n1', origin: null, condition: { kind: 'none', skipPreprocessing: false }, images: { train: {}, base: { literal: 'AA==' } } })
    const w = insertStep(edited, fresh, { beforeUid: 's0' }).working
    const out = displaySteps(withWorking(session, w), skeleton)
    expect(out.map((s) => [s.uid, s.no])).toEqual([['n1', 1], ['s0', 2], ['s1', 3], ['s2', 4]])
    expect(out[3].next.onTrue).toEqual({ kind: 'step', uid: 's0', no: 2 })
    expect(out[3].raw).toBe(skeleton.steps[2].raw)
    expect(out[3].notes).toBe(skeleton.steps[2].notes)
    expect(out[1].baseImage).toBe(skeleton.steps[0].baseImage)
    expect(skeleton.steps[2].next.onTrue.no).toBe(1) // 뼈대는 바꾸지 않는다
  })

  it('고친 스텝은 고친 값으로 만들고 notes 는 비우며 raw 가 없다, 그림은 참조에서', () => {
    const { skeleton, session, edited } = make()
    const changed = { ...edited.steps[1], descriptionToEmail: '새 설명', images: { train: { 0: { from: 'upload', tempId: 't1' } }, base: { from: 'source', id: 's1-bi' } } }
    const w = applyStep(edited, changed).working
    const blob = new Blob(['x'])
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:u1')
    try {
      const out = displaySteps(withWorking(session, w), skeleton, { uploads: new Map([['t1', blob]]) })
      const s = out[1]
      expect(s.no).toBe(2)
      expect(s.descriptionToEmail).toBe('새 설명')
      expect(s.notes).toEqual([])
      expect(s.raw).toBeUndefined()
      expect(s.baseImage.state).toBe('present')
      expect(s.baseImage.src).toContain('/scenario-editor/scenarios/P/M/N/versions/7/files/F/images/s1-bi')
      expect(s.condition.image.trainImages).toEqual([{ key: 0, type: 0, url: null, src: 'blob:u1' }])
      expect(s.action.typeName).toBe('None')
    } finally { delete globalThis.URL.createObjectURL }
  })

  it('고친 스텝: 기준 화면 참조가 없으면 missing, 화면을 보지 않는 조건은 notNeeded, 동작 이름은 번호에서', () => {
    const { skeleton, session, edited } = make()
    const a = { ...edited.steps[0], images: { train: {}, base: { literal: 'AA==' } } }
    const b = { ...edited.steps[1], condition: { kind: 'none', skipPreprocessing: false }, action: { type: 11, typeName: 'Wait', command: 'x', raw: '' } }
    const w = applyStep(applyStep(edited, a).working, b).working
    const out = displaySteps(withWorking(session, w), skeleton)
    expect(out[0].baseImage).toEqual({ state: 'missing' })
    expect(out[1].baseImage).toEqual({ state: 'notNeeded' })
    expect(out[1].action.typeName).toBe('RunCommand')
  })

  it('작업본에 없는 uid 를 가리키는 갈 곳은 미해결로 보인다', () => {
    const { skeleton, session, edited } = make()
    const a = { ...edited.steps[0], next: { onTrue: { kind: 'step', uid: 'gone' }, onFalse: { kind: 'unresolved', value: 7 } } }
    const out = displaySteps(withWorking(session, applyStep(edited, a).working), skeleton)
    expect(out[0].next.onTrue).toEqual({ kind: 'unresolved' })
    expect(out[0].next.onFalse).toEqual({ kind: 'unresolved', value: 7 })
  })
})

describe('displaySteps — 갈 곳·칸 알림(R-T5c)', () => {
  const codes = (s) => s.notes.map((n) => `${n.level}:${n.code}`)
  it('고친 것이 없으면 뼈대의 흐름 알림(UNREACHABLE 등)을 그대로 보인다', () => {
    const { skeleton, session } = make()
    skeleton.steps[1].notes = [{ level: 'warning', code: 'UNREACHABLE', params: {} }]
    expect(codes(displaySteps(session, skeleton)[1])).toEqual(['warning:UNREACHABLE'])
  })
  it('스텝을 바꾸면 손대지 않은 스텝의 흐름 알림(UNREACHABLE·LAST_STEP_NEXT·NEXT_SELF·NEXT_OUT_OF_RANGE)은 빠지고 다른 알림은 남는다', () => {
    const { skeleton, session, edited } = make()
    skeleton.steps[1].notes = [{ level: 'warning', code: 'UNREACHABLE', params: {} }, { level: 'warning', code: 'NEXT_OUT_OF_RANGE', params: {} }, { level: 'info', code: 'BASE_IMAGE_MISSING', params: {} }]
    skeleton.steps[2].notes = [{ level: 'warning', code: 'LAST_STEP_NEXT', params: {} }, { level: 'warning', code: 'FALSE_NEXT_WITH_ACTION', params: {} }]
    const out = displaySteps(withWorking(session, setCell(edited, 's0', 'skip', true).working), skeleton)
    expect(codes(out[1])).toEqual(['info:BASE_IMAGE_MISSING'])
    expect(codes(out[2])).toEqual(['warning:FALSE_NEXT_WITH_ACTION'])
  })
  it('마지막 스텝을 위로 옮기면 새 마지막 스텝(손대지 않음, 성공 NEXT)에 ⚠ LAST_STEP_NEXT', () => {
    const { skeleton, session, edited } = make()
    const out = displaySteps(withWorking(session, moveSteps(edited, ['s2'], -1).working), skeleton)
    expect(out.map((s) => s.uid)).toEqual(['s0', 's2', 's1'])
    expect(codes(out[2])).toContain('warning:LAST_STEP_NEXT')
    expect(codes(out[2]).filter((c) => c === 'warning:LAST_STEP_NEXT')).toHaveLength(1)
    expect(codes(out[1])).not.toContain('warning:LAST_STEP_NEXT')
    expect(out[0].notes).toBe(skeleton.steps[0].notes) // 바뀐 알림이 없으면 같은 배열
  })
  it('손대지 않은 스텝이 자기 자신·없는 스텝을 가리키면 NEXT_SELF·NEXT_UNRESOLVED 경고', () => {
    const { skeleton, session, edited } = make()
    const w = { ...edited, steps: [{ ...edited.steps[0] }, ...edited.steps.slice(1)] }
    // 저장 기준점의 스텝을 그대로 둔 채 갈 곳만 다른 판을 흉내 낸다(기준점도 같은 스텝 객체를 쓰도록)
    const self = { ...edited.steps[1], next: { onTrue: { kind: 'step', uid: 's1' }, onFalse: { kind: 'step', uid: 'gone' } } }
    const base = { ...edited, steps: [edited.steps[0], self, edited.steps[2]] }
    const sess = { ...session, saveBase: base, working: { ...w, steps: [w.steps[0], self, edited.steps[2]] } }
    const out = displaySteps(sess, skeleton)
    expect(codes(out[1])).toEqual(expect.arrayContaining(['warning:NEXT_SELF', 'warning:NEXT_UNRESOLVED']))
  })
  it('고친 스텝은 칸 오류(error)를 ⚠ 로 보인다, 재시도 상한은 사용자 등급을 따른다', () => {
    const { skeleton, session, edited } = make()
    const w = setCell(edited, 's1', 'accept', 0.3).working
    expect(codes(displaySteps(withWorking(session, w), skeleton)[1])).toEqual(['warning:ACCEPT_TOO_LOW'])
    const many = applyStep(edited, { ...edited.steps[1], retry: { limit: 50, intervalMs: 2000 } }).working
    expect(codes(displaySteps(withWorking(session, many), skeleton, { user: { authorityManager: 3 } })[1])).toEqual(['warning:RETRY_RANGE'])
    expect(codes(displaySteps(withWorking(session, many), skeleton, { user: { authorityManager: 1 } })[1])).toEqual([])
  })
  it('찾을 그림은 trainImages 와 images.train 키를 합쳐 images.train 참조로 보인다(다시 잡은 그림)', () => {
    const { skeleton, session, edited } = make()
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:new')
    try {
      const changed = { ...edited.steps[0], condition: { ...edited.steps[0].condition, image: { ...edited.steps[0].condition.image, trainImages: [] } },
        images: { train: { 0: { from: 'upload', tempId: 't9' } }, base: edited.steps[0].images.base } }
      const out = displaySteps(withWorking(session, applyStep(edited, changed).working), skeleton, { uploads: new Map([['t9', new Blob(['x'])]]) })
      expect(out[0].condition.image.trainImages).toEqual([{ key: 0, type: null, url: null, src: 'blob:new' }])
      const both = { ...edited.steps[1], images: { train: { 0: { from: 'source', id: 's1-train-0' }, 2: { from: 'upload', tempId: 't9' } }, base: edited.steps[1].images.base } }
      const out2 = displaySteps(withWorking(session, applyStep(edited, both).working), skeleton, { uploads: new Map([['t9', new Blob(['x'])]]) })
      expect(out2[1].condition.image.trainImages.map((x) => [x.key, x.type, !!x.src])).toEqual([[0, 0, true], [2, null, true]])
    } finally { delete globalThis.URL.createObjectURL }
  })
})

describe('imageSrc', () => {
  it('src 가 있으면 그것, 없으면 뼈대 url 을 imageUrl 로', () => {
    expect(imageSrc({ src: 'blob:1', url: '/a' })).toBe('blob:1')
    expect(imageSrc({ url: '/a' })).toBe('http://x/api/a')
    expect(imageSrc({ url: null })).toBe(null)
    expect(imageSrc(null)).toBe(null)
  })
})

describe('editorStore.steps 는 편집 중이면 작업본을 보인다', () => {
  beforeEach(() => setActivePinia(createPinia()))
  afterEach(() => vi.restoreAllMocks())
  it('세션이 없으면 뼈대, 넣기 뒤에는 작업본 순서·번호, 되돌리면 다시 뼈대 배열', () => {
    const { skeleton, edited } = make()
    const s = useEditorStore()
    s.skeleton = skeleton
    expect(s.steps.map((x) => x.uid)).toEqual(['s0', 's1', 's2'])
    const e = useEditStore()
    e.begin(skeleton, { canWrite: true })
    const fresh = edStep(9, { uid: 'n1', origin: null })
    e.run('넣기', (w) => insertStep(w, fresh, { beforeUid: 's1' }))
    expect(s.steps.map((x) => [x.uid, x.no])).toEqual([['s0', 1], ['n1', 2], ['s1', 3], ['s2', 4]])
    e.undoLast()
    expect(s.steps.map((x) => x.uid)).toEqual(['s0', 's1', 's2'])
    expect(edited.steps.length).toBe(3)
  })
  it('스텝을 바꾸면 경고 수에서 시나리오 NO_SUCCESS 가 빠지고 실시간 갈 곳 경고가 들어간다, 되돌리면 P1 그대로', () => {
    const { skeleton } = make()
    skeleton.notes = [{ level: 'warning', code: 'NO_SUCCESS', params: {} }, { level: 'info', code: 'PRIORITY_NONSTANDARD', params: {} }]
    skeleton.steps.forEach((x) => { x.notes = [] })
    const s = useEditorStore()
    s.skeleton = skeleton
    const e = useEditStore()
    e.begin(skeleton, { canWrite: true })
    expect([s.warningCount, s.infoCount]).toEqual([1, 1])
    expect(s.scenarioNotes.map((n) => n.code)).toEqual(['NO_SUCCESS', 'PRIORITY_NONSTANDARD'])
    e.run('옮김', (w) => moveSteps(w, ['s2'], -1)) // s1(성공 NEXT)이 마지막이 된다
    expect(s.scenarioNotes.map((n) => n.code)).toEqual(['PRIORITY_NONSTANDARD'])
    expect([s.warningCount, s.infoCount]).toEqual([1, 1])
    expect(s.steps[2].notes.map((n) => n.code)).toEqual(['LAST_STEP_NEXT'])
    e.undoLast()
    expect(s.scenarioNotes.map((n) => n.code)).toEqual(['NO_SUCCESS', 'PRIORITY_NONSTANDARD'])
  })
})

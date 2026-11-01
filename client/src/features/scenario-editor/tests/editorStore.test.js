import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const api = vi.hoisted(() => ({ me: vi.fn(), scopes: vi.fn(), dataCheck: vi.fn(), refreshCache: vi.fn(), open: vi.fn(), list: vi.fn(), versions: vi.fn() }))
vi.mock('../api', () => ({ scenarioEditorApi: api }))
import { useEditorStore } from '../stores/editorStore'

const ok = (data) => Promise.resolve({ data: { success: true, data } })
const steps = [
  { uid: 's0', no: 1, notes: [] },
  { uid: 's1', no: 2, notes: [{ level: 'warning', code: 'UNREACHABLE' }] },
  { uid: 's2', no: 3, notes: [{ level: 'info', code: 'BASE_IMAGE_MISSING' }] }
]
const skeleton = { process: 'P', model: 'M', name: 'N', version: { crtime: 1, isCurrent: true }, steps, notes: [{ level: 'info', code: 'TARGET_WINDOW_DIFFERS' }] }

describe('editorStore', () => {
  beforeEach(() => { setActivePinia(createPinia()); Object.values(api).forEach((f) => f.mockReset()) })

  it('init: me → scopes·dataCheck', async () => {
    api.me.mockReturnValue(ok({ singleid: 'u' })); api.scopes.mockReturnValue(ok({ processes: [] })); api.dataCheck.mockReturnValue(ok({ duplicateUsers: [], duplicateEqpIds: ['D'], invalidEquipment: [], proxyIpDuplicates: [], duplicateProperties: [] }))
    const s = useEditorStore()
    await s.init()
    expect(s.me.singleid).toBe('u')
    expect(s.dataCheckCount).toBe(1)
  })
  it('init: 미등록이면 meError, 다른 것은 부르지 않는다', async () => {
    api.me.mockRejectedValue({ response: { status: 403, data: { code: 'USER_NOT_REGISTERED' } } })
    const s = useEditorStore()
    await s.init()
    expect(s.meError.code).toBe('USER_NOT_REGISTERED')
    expect(api.scopes).not.toHaveBeenCalled()
  })
  it('openScenario: 성공하면 첫 스텝 선택, 경고·알림 수', async () => {
    api.open.mockReturnValue(ok(skeleton))
    const s = useEditorStore()
    const p = s.openScenario({ process: 'P', model: 'M', name: 'N' })
    expect(s.opening).toMatchObject({ name: 'N', crtime: 'current' })
    await p
    expect(s.opening).toBe(null)
    expect(s.selectedUid).toBe('s0')
    expect([s.warningCount, s.infoCount]).toEqual([1, 2])
  })
  it('openScenario: 실패하면 openError 와 다시 시도할 대상', async () => {
    api.open.mockRejectedValue({ response: { status: 422, data: { code: 'DATA_INVALID' } } })
    const s = useEditorStore()
    await s.openScenario({ process: 'P', model: 'M', name: 'N', crtime: '5' })
    expect(s.openError).toMatchObject({ code: 'DATA_INVALID', target: { process: 'P', model: 'M', name: 'N', crtime: '5' } })
  })
  it('선택 이동·경고 스텝 순회', async () => {
    api.open.mockReturnValue(ok(skeleton))
    const s = useEditorStore()
    await s.openScenario({ process: 'P', model: 'M', name: 'N' })
    s.moveSelection(1); expect(s.selectedUid).toBe('s1')
    s.moveSelection(5); expect(s.selectedUid).toBe('s2')
    s.selectByNo(1); s.nextNoted(); expect(s.selectedUid).toBe('s1')
    s.nextNoted(); expect(s.selectedUid).toBe('s2')
    s.nextNoted(); expect(s.selectedUid).toBe('s1')
  })
  it('선택이 없으면 아래 방향은 첫 스텝, 위 방향은 마지막 스텝', async () => {
    api.open.mockReturnValue(ok(skeleton))
    const s = useEditorStore()
    await s.openScenario({ process: 'P', model: 'M', name: 'N' })
    s.select(null); s.moveSelection(1); expect(s.selectedUid).toBe('s0')
    s.select(null); s.moveSelection(-1); expect(s.selectedUid).toBe('s2')
    s.select('없는-uid'); s.moveSelection(1); expect(s.selectedUid).toBe('s0')
    s.select('없는-uid'); s.moveSelection(-1); expect(s.selectedUid).toBe('s2')
  })
  describe('겹친 열기 요청', () => {
    const defer = () => { let resolve, reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej }); return { promise, resolve, reject } }
    const skeletonOf = (name, uid) => ({ ...skeleton, name, steps: [{ uid, no: 1, notes: [] }], notes: [] })
    const wire = () => {
      const a = defer(); const b = defer()
      api.open.mockImplementation((process, model, name) => (name === 'A' ? a.promise : b.promise))
      return { a, b }
    }

    it('늦게 끝난 앞 요청은 아무것도 바꾸지 않고, 진행 표시는 마지막 요청이 끝나야 걷힌다', async () => {
      const { a, b } = wire()
      const s = useEditorStore()
      const pA = s.openScenario({ process: 'P', model: 'M', name: 'A' })
      const pB = s.openScenario({ process: 'P', model: 'M', name: 'B' })
      a.resolve({ data: { success: true, data: skeletonOf('A', 'a0') } })
      await pA
      expect(s.skeleton).toBe(null)
      expect(s.opening).toMatchObject({ name: 'B' })
      b.resolve({ data: { success: true, data: skeletonOf('B', 'b0') } })
      await pB
      expect(s.skeleton.name).toBe('B')
      expect(s.selectedUid).toBe('b0')
      expect(s.opening).toBe(null)
    })
    it('앞 요청이 뒤 요청이 끝난 다음에 도착해도 B 가 그대로다', async () => {
      const { a, b } = wire()
      const s = useEditorStore()
      const pA = s.openScenario({ process: 'P', model: 'M', name: 'A' })
      const pB = s.openScenario({ process: 'P', model: 'M', name: 'B' })
      b.resolve({ data: { success: true, data: skeletonOf('B', 'b0') } })
      await pB
      a.resolve({ data: { success: true, data: skeletonOf('A', 'a0') } })
      await pA
      expect(s.skeleton.name).toBe('B')
      expect(s.selectedUid).toBe('b0')
      expect(s.opening).toBe(null)
      expect(s.openError).toBe(null)
    })
    it('B 가 성공한 뒤 A 가 실패해도 오류를 띄우지 않는다', async () => {
      const { a, b } = wire()
      const s = useEditorStore()
      const pA = s.openScenario({ process: 'P', model: 'M', name: 'A' })
      const pB = s.openScenario({ process: 'P', model: 'M', name: 'B' })
      b.resolve({ data: { success: true, data: skeletonOf('B', 'b0') } })
      await pB
      a.reject({ response: { status: 422, data: { code: 'DATA_INVALID' } } })
      await pA
      expect(s.openError).toBe(null)
      expect(s.skeleton.name).toBe('B')
      expect(s.selectedUid).toBe('b0')
      expect(s.opening).toBe(null)
    })
    it('앞서 연 시나리오가 있어도 열기에 실패하면 화면 상태를 비운다', async () => {
      api.open.mockReturnValueOnce(ok(skeleton))
      const s = useEditorStore()
      await s.openScenario({ process: 'P', model: 'M', name: 'N' })
      expect(s.skeleton).not.toBe(null)
      api.open.mockRejectedValueOnce({ response: { status: 422, data: { code: 'DATA_INVALID' } } })
      await s.openScenario({ process: 'P', model: 'M', name: 'X' })
      expect(s.skeleton).toBe(null)
      expect(s.selectedUid).toBe(null)
      expect(s.steps).toEqual([])
      expect(s.openError).toMatchObject({ code: 'DATA_INVALID', target: { name: 'X' } })
      expect(s.opening).toBe(null)
    })
  })
  it('스텝 0개 뼈대도 열린다', async () => {
    api.open.mockReturnValue(ok({ ...skeleton, steps: [], notes: [] }))
    const s = useEditorStore()
    await s.openScenario({ process: 'P', model: 'M', name: 'N' })
    expect(s.selectedUid).toBe(null)
    s.moveSelection(1); s.nextNoted()
    expect(s.selectedStep).toBe(null)
  })
})

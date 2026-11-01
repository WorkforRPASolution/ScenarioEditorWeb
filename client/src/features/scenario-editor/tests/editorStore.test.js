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
  it('스텝 0개 뼈대도 열린다', async () => {
    api.open.mockReturnValue(ok({ ...skeleton, steps: [], notes: [] }))
    const s = useEditorStore()
    await s.openScenario({ process: 'P', model: 'M', name: 'N' })
    expect(s.selectedUid).toBe(null)
    s.moveSelection(1); s.nextNoted()
    expect(s.selectedStep).toBe(null)
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

const api = vi.hoisted(() => ({ deployAttention: vi.fn(), verifyDeploy: vi.fn(), finishDeploy: vi.fn(), dismissDeploy: vi.fn(), getDraft: vi.fn(), check: vi.fn(), nameRule: vi.fn() }))
vi.mock('../api', () => ({ scenarioEditorApi: api, imageUrl: (p) => p }))
import DeployAttentionDialog from '../components/DeployAttentionDialog.vue'
import { useEditorStore } from '../stores/editorStore'
import { formatCrtime } from '../format'

// 확인이 필요한 내 배포 목록 창(SEW-021)
const ok = (data) => Promise.resolve({ data: { success: true, data } })
const fail = (status, code) => Promise.reject({ response: { status, data: { code } }, request: {} })
const ModalStub = { name: 'ModalShell', props: ['modelValue', 'title'], template: '<div v-if="modelValue" :data-title="title"><slot /></div>' }
const R1 = '11111111-2222-4333-8444-555555555555'
const R2 = '11111111-2222-4333-8444-666666666666'
const R3 = '11111111-2222-4333-8444-777777777777'
const AT = '2026-11-19T01:02:03.000Z'
const items = () => [
  { requestId: R1, target: { process: 'P', model: 'M', name: 'N' }, startedAt: AT, result: 'unknown', crtime: null, targetWasNew: false },
  { requestId: R2, target: { process: 'P', model: 'M', name: 'NEW_ONE' }, startedAt: AT, result: 'partial', crtime: 1795063230025, targetWasNew: true },
  { requestId: R3, target: { process: 'P', model: 'M2', name: 'X' }, startedAt: AT, result: 'rejected', crtime: null, targetWasNew: false }
]

function setup(list = items()) {
  setActivePinia(createPinia())
  Object.values(api).forEach((f) => f.mockReset())
  api.deployAttention.mockImplementation(() => ok({ items: list.map((i) => ({ ...i })) }))
  useEditorStore().me = { singleid: 'u', canWrite: true }
  const w = mount(DeployAttentionDialog, { props: { modelValue: true }, global: { stubs: { ModalShell: ModalStub } } })
  return { w }
}
const row = (w, rid) => w.find(`[data-testid="se-attn-row"][data-rid="${rid}"]`)
const tid = (el, id) => el.find(`[data-testid="${id}"]`)

describe('DeployAttentionDialog', () => {
  beforeEach(() => sessionStorage.clear())

  it('줄마다 시나리오 ID·보낸 시각·상태와 할 일 — 결과 모름·거절은 [버전 목록 확인], 마무리 실패는 [다시 쓰기](새 시나리오면 실행되지 않는다는 안내)', async () => {
    const { w } = setup()
    await flushPromises()
    expect(w.find('[data-title]').attributes('data-title')).toBe('확인할 배포')
    const r1 = row(w, R1)
    expect(r1.text()).toContain('P-M-N')
    expect(r1.text()).toContain(formatCrtime(Date.parse(AT)))
    expect(tid(r1, 'se-attn-state').text()).toBe('결과 모름')
    expect(tid(r1, 'se-attn-verify').exists()).toBe(true)
    expect(tid(r1, 'se-attn-finish').exists()).toBe(false)
    const r2 = row(w, R2)
    expect(tid(r2, 'se-attn-state').text()).toBe('마무리 실패')
    expect(r2.text()).toContain('새 시나리오라 이대로는 실행되지 않습니다')
    expect(tid(r2, 'se-attn-finish').exists()).toBe(true)
    expect(tid(r2, 'se-attn-verify').exists()).toBe(false)
    const r3 = row(w, R3)
    expect(tid(r3, 'se-attn-state').text()).toBe('거절됨')
    expect(tid(r3, 'se-attn-verify').exists()).toBe(true)
  })

  it('창을 열 때마다 목록을 다시 받는다', async () => {
    const { w } = setup()
    await flushPromises()
    const n = api.deployAttention.mock.calls.length
    await w.setProps({ modelValue: false })
    await w.setProps({ modelValue: true }); await flushPromises()
    expect(api.deployAttention.mock.calls.length).toBe(n + 1)
  })

  it('[버전 목록 확인] → 배포됐으면 끝났다고, 늦은 확인이라 성과를 덮지 않았으면 그렇게 알린다', async () => {
    const { w } = setup()
    await flushPromises()
    api.verifyDeploy.mockReturnValue(ok({ found: 'mine', crtime: 1795063230025, result: 'ok', partialFailed: [], performanceKept: true }))
    await tid(row(w, R1), 'se-attn-verify').trigger('click'); await flushPromises()
    const note = tid(row(w, R1), 'se-attn-outcome').text()
    expect(note).toContain('배포됐고 마무리까지 끝났습니다')
    expect(note).toContain(formatCrtime(1795063230025))
    expect(note).toContain('성과는 덮지 않았습니다')
    expect(tid(row(w, R1), 'se-attn-verify').exists()).toBe(false) // 끝난 줄에는 할 일이 없다
  })

  it('[버전 목록 확인] → 배포되지 않았으면 그렇게 알리고 [목록에서 빼기]를 권한다', async () => {
    const { w } = setup()
    await flushPromises()
    api.verifyDeploy.mockReturnValue(ok({ found: 'none', crtime: null }))
    await tid(row(w, R1), 'se-attn-verify').trigger('click'); await flushPromises()
    expect(tid(row(w, R1), 'se-attn-outcome').text()).toContain('배포되지 않았습니다')
    expect(tid(row(w, R1), 'se-attn-dismiss').exists()).toBe(true)
  })

  it('[다시 쓰기] → 끝나면 끝났다고, 쓸 문서가 없으면 그렇게 알린다', async () => {
    const { w } = setup()
    await flushPromises()
    api.finishDeploy.mockReturnValueOnce(ok({ result: 'partial', crtime: 1, partialFailed: ['finish'] }))
    await tid(row(w, R2), 'se-attn-finish').trigger('click'); await flushPromises()
    expect(tid(row(w, R2), 'se-attn-outcome').text()).toContain('운영 속성 문서가 없습니다')
    api.finishDeploy.mockReturnValueOnce(ok({ result: 'ok', crtime: 1795063230025, partialFailed: [] }))
    await tid(row(w, R2), 'se-attn-finish').trigger('click'); await flushPromises()
    expect(tid(row(w, R2), 'se-attn-outcome').text()).toContain('배포됐고 마무리까지 끝났습니다')
  })

  it('[목록에서 빼기]: 결과 모름은 바로 빠지고, 마무리 실패는 한 번 더 묻는다(빼도 실행되지 않는 것은 그대로)', async () => {
    const { w } = setup()
    await flushPromises()
    api.dismissDeploy.mockReturnValue(ok({ dismissed: true }))
    await tid(row(w, R1), 'se-attn-dismiss').trigger('click'); await flushPromises()
    expect(api.dismissDeploy).toHaveBeenCalledWith(R1)
    expect(row(w, R1).exists()).toBe(false)
    await tid(row(w, R2), 'se-attn-dismiss').trigger('click'); await flushPromises()
    expect(api.dismissDeploy).toHaveBeenCalledTimes(1)
    expect(tid(row(w, R2), 'se-attn-dismiss-ask').text()).toContain('빼도 실행되지 않는 것은 그대로입니다')
    await tid(row(w, R2), 'se-attn-dismiss-go').trigger('click'); await flushPromises()
    expect(api.dismissDeploy).toHaveBeenLastCalledWith(R2)
    expect(row(w, R2).exists()).toBe(false)
  })

  it('확인할 배포가 없으면 그렇게, 목록을 받지 못하면 이유와 [다시 읽기]', async () => {
    const { w } = setup([])
    await flushPromises()
    expect(tid(w, 'se-attn-empty').text()).toContain('확인할 배포가 없습니다')
    api.deployAttention.mockReturnValueOnce(fail(503, 'UPSTREAM_DOWN'))
    await w.setProps({ modelValue: false })
    await w.setProps({ modelValue: true }); await flushPromises()
    expect(tid(w, 'se-attn-failed').text()).toContain('목록을 받지 못했습니다')
    api.deployAttention.mockImplementation(() => ok({ items: items() }))
    await tid(w, 'se-attn-reload').trigger('click'); await flushPromises()
    expect(row(w, R1).exists()).toBe(true)
  })
})

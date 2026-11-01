import { describe, it, expect, vi, beforeEach } from 'vitest'
import { shallowMount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

const replace = vi.fn()
const route = { query: {} }
vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => ({ replace }) }))
const api = vi.hoisted(() => ({ me: vi.fn(), scopes: vi.fn(), dataCheck: vi.fn(), open: vi.fn() }))
vi.mock('../api', () => ({ scenarioEditorApi: api, imageUrl: (p) => p }))
import ScenarioEditorView from '../ScenarioEditorView.vue'
import { useEditorStore } from '../stores/editorStore'

const ok = (data) => Promise.resolve({ data: { data } })
const stubs = { ScenarioBar: true, LoadDialog: true, StepTable: true, StepFlow: true, StepViewer: true, StepDetail: true }
const mountView = () => shallowMount(ScenarioEditorView, { global: { stubs: { ...stubs, StatePanel: false, SplitGutter: false } } })

describe('ScenarioEditorView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    Object.values(api).forEach((f) => f.mockReset())
    api.me.mockReturnValue(ok({ singleid: 'u' })); api.scopes.mockReturnValue(ok({ processes: [] })); api.dataCheck.mockReturnValue(ok(null))
    route.query = {}
    replace.mockClear()
    localStorage.clear()
  })
  it('열린 시나리오가 없으면 빈 상태', async () => {
    const w = mountView(); await flushPromises()
    expect(w.find('[data-testid="se-empty"]').exists()).toBe(true)
    expect(w.find('[data-testid="se-snapshot-rail"]').text()).toContain('스냅샷 — 준비 중')
  })
  it('미등록 사용자는 전체 안내만', async () => {
    api.me.mockRejectedValue({ response: { status: 403, data: { code: 'USER_NOT_REGISTERED' } } })
    const w = mountView(); await flushPromises()
    expect(w.find('[data-testid="se-unregistered"]').exists()).toBe(true)
    expect(w.findComponent({ name: 'ScenarioBar' }).exists()).toBe(false)
  })
  it('주소 쿼리가 있으면 바로 연다, 열리면 쿼리를 맞춘다', async () => {
    route.query = { p: 'P', m: 'M', n: 'N', v: '5' }
    api.open.mockReturnValue(ok({ process: 'P', model: 'M', name: 'N', version: { crtime: 5, isCurrent: false }, steps: [], notes: [] }))
    mountView(); await flushPromises()
    expect(api.open).toHaveBeenCalledWith('P', 'M', 'N', '5')
    expect(replace).toHaveBeenCalledWith({ query: { p: 'P', m: 'M', n: 'N', v: '5' } })
  })
  it('여는 중·오류 상태', async () => {
    const w = mountView(); await flushPromises()
    const s = useEditorStore()
    s.opening = { process: 'P', model: 'M', name: 'N', crtime: 'current', startedAt: Date.now() }
    await w.vm.$nextTick()
    expect(w.find('[data-testid="se-opening"]').exists()).toBe(true)
    s.opening = null
    s.openError = { code: 'DATA_INVALID', message: '열 수 없음', target: { process: 'P', model: 'M', name: 'N', crtime: 'current' } }
    await w.vm.$nextTick()
    expect(w.find('[data-testid="se-open-error"]').text()).toContain('열 수 없음')
  })
  it('경계선을 두 번 누르면 기본값', async () => {
    localStorage.setItem('se-layout', JSON.stringify({ rw: 500 }))
    const w = mountView(); await flushPromises()
    await w.find('[data-testid="se-gutter-r"]').trigger('dblclick')
    expect(JSON.parse(localStorage.getItem('se-layout')).rw).toBe(370)
  })
})

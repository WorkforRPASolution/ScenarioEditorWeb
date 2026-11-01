import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

const api = vi.hoisted(() => ({ list: vi.fn(), versions: vi.fn(), refreshCache: vi.fn(), me: vi.fn(), scopes: vi.fn(), dataCheck: vi.fn() }))
vi.mock('../api', () => ({ scenarioEditorApi: api }))
vi.mock('../gridTheme', () => ({ registerGrid: () => {}, useGridTheme: () => ({ value: {} }) }))
import LoadDialog from '../components/LoadDialog.vue'
import { useEditorStore } from '../stores/editorStore'

const AgStub = { name: 'AgGridVue', props: ['rowData', 'columnDefs'], template: '<div data-testid="ag" />' }
const ModalStub = { name: 'ModalShell', props: ['modelValue'], template: '<div v-if="modelValue"><slot /><slot name="footer" /></div>' }
const ok = (data) => Promise.resolve({ data: { data } })
const rows = [
  { name: 'ALL_ACTIONS', isEnabled: true, typeName: 'ALARM_RECOVERY', status: [], currentCrtime: 1730000000000 },
  { name: 'DISABLED', isEnabled: false, typeName: 'ALARM_RECOVERY', status: [], currentCrtime: 1730000000100 },
  { name: 'NO_REDIS', isEnabled: true, typeName: 'ALARM_RECOVERY', status: ['NO_CURRENT_VERSION'], currentCrtime: null }
]

function setup() {
  setActivePinia(createPinia())
  const store = useEditorStore()
  store.scopes = { processes: [{ process: 'SEWCVD', models: [{ model: 'SEWMODELA', eqpCount: 2 }, { model: 'SEWMODELB', eqpCount: 1 }] }, { process: 'SEWETCH', models: [{ model: 'SEWMODELA', eqpCount: 1 }] }] }
  api.list.mockReturnValue(ok(rows))
  api.versions.mockReturnValue(ok([{ crtime: 1730000000000, isCurrent: true }, { crtime: 1720000000000, isCurrent: false }]))
  const w = mount(LoadDialog, { props: { modelValue: true }, global: { stubs: { AgGridVue: AgStub, ModalShell: ModalStub } } })
  return { w, store }
}

describe('LoadDialog', () => {
  beforeEach(() => { Object.values(api).forEach((f) => f.mockReset()); localStorage.clear() })
  it('허용 공정·모델만, 처음엔 첫 쌍으로 목록', async () => {
    const { w } = setup(); await flushPromises()
    expect(w.findAll('[data-testid="se-load-process"] option').map((o) => o.text())).toEqual(['SEWCVD', 'SEWETCH'])
    expect(api.list).toHaveBeenCalledWith('SEWCVD', 'SEWMODELA')
  })
  it('마지막 선택을 기억한다(허용 범위 안일 때만)', async () => {
    localStorage.setItem('se-last-scope', JSON.stringify({ process: 'SEWETCH', model: 'SEWMODELA' }))
    setup(); await flushPromises()
    expect(api.list).toHaveBeenCalledWith('SEWETCH', 'SEWMODELA')
  })
  it('이름 찾기·켜진 것만', async () => {
    const { w } = setup(); await flushPromises()
    const grid = () => w.findComponent({ name: 'AgGridVue' }).props('rowData').map((r) => r.name)
    expect(grid()).toEqual(['ALL_ACTIONS', 'DISABLED', 'NO_REDIS'])
    await w.find('[data-testid="se-load-enabled"]').setValue(true)
    expect(grid()).toEqual(['ALL_ACTIONS', 'NO_REDIS'])
    await w.find('[data-testid="se-load-search"]').setValue('no_')
    expect(grid()).toEqual(['NO_REDIS'])
  })
  it('두 번 누르면 현재 버전으로 열기, 버전 목록에서 고르면 그 버전', async () => {
    const { w } = setup(); await flushPromises()
    const grid = w.findComponent({ name: 'AgGridVue' })
    grid.vm.$emit('row-double-clicked', { data: rows[0] })
    expect(w.emitted('open')[0][0]).toEqual({ process: 'SEWCVD', model: 'SEWMODELA', name: 'ALL_ACTIONS', crtime: 'current' })
    grid.vm.$emit('row-clicked', { data: rows[0] }); await flushPromises()
    const items = w.findAll('[data-testid="se-load-version"]')
    expect(items).toHaveLength(2)
    expect(items[0].text()).toContain('현재')
    await items[1].trigger('dblclick')
    expect(w.emitted('open')[1][0]).toEqual({ process: 'SEWCVD', model: 'SEWMODELA', name: 'ALL_ACTIONS', crtime: '1720000000000' })
  })
  it('권한·설비 다시 읽기: 성공·실패를 토스트로 알린다', async () => {
    const { w, store } = setup(); await flushPromises()
    store.refreshCaches = vi.fn().mockResolvedValue()
    await w.find('[data-testid="se-load-refresh"]').trigger('click'); await flushPromises()
    expect(store.refreshCaches).toHaveBeenCalled()
    expect(api.list).toHaveBeenCalledTimes(2)
    expect(w.find('[data-test="toast"]').text()).toContain('다시 읽었습니다')
    store.refreshCaches = vi.fn().mockRejectedValue({ response: { status: 503, data: { code: 'UPSTREAM_DOWN' } } })
    await w.find('[data-testid="se-load-refresh"]').trigger('click'); await flushPromises()
    expect(w.find('[data-test="toast"]').text()).toContain('DB·Redis 에 연결되지 않았습니다')
  })
})

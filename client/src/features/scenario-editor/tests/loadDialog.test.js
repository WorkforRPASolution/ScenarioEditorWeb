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

const DEFAULT_SCOPES = { processes: [{ process: 'SEWCVD', models: [{ model: 'SEWMODELA', eqpCount: 2 }, { model: 'SEWMODELB', eqpCount: 1 }] }, { process: 'SEWETCH', models: [{ model: 'SEWMODELA', eqpCount: 1 }] }] }
const deferred = () => { let resolve, reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej }); return { promise, resolve, reject } }

function setup(opts = {}) {
  setActivePinia(createPinia())
  const store = useEditorStore()
  store.scopes = 'scopes' in opts ? opts.scopes : DEFAULT_SCOPES
  if (opts.list) api.list.mockImplementation(opts.list); else api.list.mockReturnValue(ok(rows))
  if (opts.versions) api.versions.mockImplementation(opts.versions)
  else api.versions.mockReturnValue(ok([{ crtime: 1730000000000, isCurrent: true }, { crtime: 1720000000000, isCurrent: false }]))
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

  describe('늦게 온 응답', () => {
    it('범위를 빨리 바꾸면 늦게 온 앞 목록은 버리고, 열기는 지금 목록의 쌍으로 보낸다', async () => {
      const dA = deferred(); const dB = deferred()
      const { w } = setup({ list: (p, m) => (m === 'SEWMODELA' ? dA.promise : dB.promise) }); await flushPromises()
      await w.find('[data-testid="se-load-model"]').setValue('SEWMODELB'); await flushPromises()
      expect(api.list).toHaveBeenLastCalledWith('SEWCVD', 'SEWMODELB')
      const grid = w.findComponent({ name: 'AgGridVue' })
      // B 목록이 오기 전에는 열 수 있는 목록이 없다 — 앞 목록의 행으로 B 쌍을 보내지 않는다
      grid.vm.$emit('row-double-clicked', { data: rows[0] })
      expect(w.emitted('open')).toBeUndefined()
      dB.resolve({ data: { data: [{ ...rows[1], name: 'B_ONLY' }] } }); await flushPromises()
      dA.resolve({ data: { data: rows } }); await flushPromises()
      expect(grid.props('rowData').map((r) => r.name)).toEqual(['B_ONLY'])
      grid.vm.$emit('row-double-clicked', { data: { name: 'B_ONLY' } })
      expect(w.emitted('open')[0][0]).toEqual({ process: 'SEWCVD', model: 'SEWMODELB', name: 'B_ONLY', crtime: 'current' })
    })
    it('앞 범위의 늦은 실패는 지금 화면에 오류를 쓰지 않는다', async () => {
      const dA = deferred(); const dB = deferred()
      const { w } = setup({ list: (p, m) => (m === 'SEWMODELA' ? dA.promise : dB.promise) }); await flushPromises()
      await w.find('[data-testid="se-load-model"]').setValue('SEWMODELB'); await flushPromises()
      dB.resolve({ data: { data: rows } }); await flushPromises()
      dA.reject({ response: { status: 503, data: { code: 'UPSTREAM_DOWN' } } }); await flushPromises()
      expect(w.text()).not.toContain('DB·Redis 에 연결되지 않았습니다')
      expect(w.findComponent({ name: 'AgGridVue' }).props('rowData')).toHaveLength(3)
    })
    it('시나리오를 연달아 누르면 늦게 온 앞 시나리오의 버전은 버린다', async () => {
      const v1 = deferred(); const v2 = deferred()
      const { w } = setup({ versions: (p, m, name) => (name === rows[0].name ? v1.promise : v2.promise) }); await flushPromises()
      const grid = w.findComponent({ name: 'AgGridVue' })
      grid.vm.$emit('row-clicked', { data: rows[0] }); await flushPromises()
      grid.vm.$emit('row-clicked', { data: rows[1] }); await flushPromises()
      v2.resolve({ data: { data: [{ crtime: 1730000000100, isCurrent: true }] } }); await flushPromises()
      v1.resolve({ data: { data: [{ crtime: 1730000000000, isCurrent: true }, { crtime: 1720000000000, isCurrent: false }] } }); await flushPromises()
      expect(w.findAll('[data-testid="se-load-version"]')).toHaveLength(1)
      expect(w.text()).toContain('— DISABLED')
    })
    it('시나리오를 연달아 누를 때 앞 시나리오의 늦은 버전 실패는 오류를 쓰지 않는다', async () => {
      const v1 = deferred(); const v2 = deferred()
      const { w } = setup({ versions: (p, m, name) => (name === rows[0].name ? v1.promise : v2.promise) }); await flushPromises()
      const grid = w.findComponent({ name: 'AgGridVue' })
      grid.vm.$emit('row-clicked', { data: rows[0] }); await flushPromises()
      grid.vm.$emit('row-clicked', { data: rows[1] }); await flushPromises()
      v2.resolve({ data: { data: [{ crtime: 1730000000100, isCurrent: true }] } }); await flushPromises()
      v1.reject({ response: { status: 503, data: { code: 'UPSTREAM_DOWN' } } }); await flushPromises()
      expect(w.text()).not.toContain('DB·Redis 에 연결되지 않았습니다')
      expect(w.findAll('[data-testid="se-load-version"]')).toHaveLength(1)
    })
    it('범위를 바꾼 뒤 늦게 온 버전은 버리고(고른 시나리오 없음), 버전 줄을 두 번 눌러도 오류가 없다', async () => {
      const v1 = deferred()
      const { w } = setup({ versions: () => v1.promise }); await flushPromises()
      const grid = w.findComponent({ name: 'AgGridVue' })
      grid.vm.$emit('row-clicked', { data: rows[0] }); await flushPromises()
      await w.find('[data-testid="se-load-model"]').setValue('SEWMODELB'); await flushPromises()
      v1.resolve({ data: { data: [{ crtime: 1730000000000, isCurrent: true }] } }); await flushPromises()
      expect(w.findAll('[data-testid="se-load-version"]')).toHaveLength(0)
      expect(w.find('[data-testid="se-load-open"]').attributes('disabled')).toBeDefined()
    })
    it('고른 시나리오가 없는데 버전 줄이 눌려도 열지 않고 던지지 않는다', async () => {
      const { w } = setup(); await flushPromises()
      const grid = w.findComponent({ name: 'AgGridVue' })
      grid.vm.$emit('row-clicked', { data: rows[0] }); await flushPromises()
      const items = w.findAll('[data-testid="se-load-version"]')
      // 다시 읽기 등으로 목록이 비워져 선택이 풀린 뒤에도 남은 줄의 이벤트는 안전해야 한다
      await w.find('[data-testid="se-load-model"]').setValue('SEWMODELB'); await flushPromises()
      await expect(items[1].trigger('dblclick')).resolves.not.toThrow()
      expect(w.emitted('open')).toBeUndefined()
    })
  })

  describe('권한·설비가 비었거나 읽지 못했을 때', () => {
    it('scopes 가 null 이면 읽지 못했다는 한 줄', async () => {
      const { w } = setup({ scopes: null }); await flushPromises()
      expect(w.find('[data-testid="se-load-scopes-notice"]').text()).toContain('권한·설비를 읽지 못했습니다')
      expect(w.find('[data-testid="se-load-scopes-notice"]').text()).toContain('권한·설비 다시 읽기')
      expect(api.list).not.toHaveBeenCalled()
    })
    it('공정이 하나도 없으면 볼 수 있는 공정·모델이 없다는 한 줄', async () => {
      const { w } = setup({ scopes: { processes: [] } }); await flushPromises()
      expect(w.find('[data-testid="se-load-scopes-notice"]').text()).toContain('볼 수 있는 공정·모델이 없습니다')
    })
    it('정상이면 안내 줄이 없다', async () => {
      const { w } = setup(); await flushPromises()
      expect(w.find('[data-testid="se-load-scopes-notice"]').exists()).toBe(false)
    })
    it('다시 읽기가 내 정보 실패로 끝나면 성공 토스트 대신 그 오류', async () => {
      const { w, store } = setup(); await flushPromises()
      store.refreshCaches = vi.fn().mockImplementation(async () => { store.meError = { code: 'NETWORK', message: '편집기 서버에 연결하지 못했습니다.' } })
      await w.find('[data-testid="se-load-refresh"]').trigger('click'); await flushPromises()
      const toast = w.find('[data-test="toast"]').text()
      expect(toast).toContain('편집기 서버에 연결하지 못했습니다')
      expect(toast).not.toContain('다시 읽었습니다')
    })
    it('다시 읽기 뒤에도 scopes 가 null 이면 성공 토스트 대신 실패 토스트, 안내 줄이 뜬다', async () => {
      const { w, store } = setup(); await flushPromises()
      store.refreshCaches = vi.fn().mockImplementation(async () => { store.scopes = null })
      await w.find('[data-testid="se-load-refresh"]').trigger('click'); await flushPromises()
      const toast = w.find('[data-test="toast"]').text()
      expect(toast).toContain('다시 읽지 못했습니다')
      expect(toast).not.toContain('다시 읽었습니다')
      expect(w.find('[data-testid="se-load-scopes-notice"]').text()).toContain('권한·설비를 읽지 못했습니다')
    })
  })

  it('상태 열은 오른쪽에 고정한다 — 열 합계가 창보다 넓어 가로로 밀려도 열 수 없는 원인이 보인다(완료 조건 3)', async () => {
    const { w } = setup(); await flushPromises()
    const cols = w.findComponent({ name: 'AgGridVue' }).props('columnDefs')
    const status = cols.find((c) => c.field === 'status')
    expect(status.pinned).toBe('right')
    expect(status.valueFormatter({ value: ['NO_CURRENT_VERSION', 'DUPLICATE_PROPERTY'] })).toBe('현재 버전 없음, 같은 키 2건')
    // 나머지 열 순서는 설계 §6.2 그대로
    expect(cols.map((c) => c.headerName)).toEqual(['이름', '켜짐', '유형', '트리거', '등급', '설명', '최근 수정자', '현재 버전', '상태'])
  })

  it('버전 줄을 한 번 누르면 고른 표시, 열기는 고른 버전으로(없으면 현재)', async () => {
    const { w } = setup(); await flushPromises()
    const grid = w.findComponent({ name: 'AgGridVue' })
    grid.vm.$emit('row-clicked', { data: rows[0] }); await flushPromises()
    const items = () => w.findAll('[data-testid="se-load-version"]')
    const open = async () => { await w.find('[data-testid="se-load-open"]').trigger('click'); return w.emitted('open').at(-1)[0] }
    expect(await open()).toEqual({ process: 'SEWCVD', model: 'SEWMODELA', name: 'ALL_ACTIONS', crtime: 'current' })
    await items()[1].trigger('click')
    expect(items().map((i) => i.attributes('aria-selected'))).toEqual(['false', 'true'])
    expect(await open()).toEqual({ process: 'SEWCVD', model: 'SEWMODELA', name: 'ALL_ACTIONS', crtime: '1720000000000' })
    await items()[0].trigger('click')
    expect(items().map((i) => i.attributes('aria-selected'))).toEqual(['true', 'false'])
    expect((await open()).crtime).toBe('current')
    // 다른 시나리오를 고르면 고른 버전은 풀린다
    await items()[1].trigger('click')
    grid.vm.$emit('row-clicked', { data: rows[1] }); await flushPromises()
    expect(items().map((i) => i.attributes('aria-selected'))).toEqual(['false', 'false'])
    expect(await open()).toEqual({ process: 'SEWCVD', model: 'SEWMODELA', name: 'DISABLED', crtime: 'current' })
  })
})

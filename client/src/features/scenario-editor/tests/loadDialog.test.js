import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

const api = vi.hoisted(() => ({ list: vi.fn(), versions: vi.fn(), refreshCache: vi.fn(), me: vi.fn(), scopes: vi.fn(), dataCheck: vi.fn(),
  listDrafts: vi.fn(), getDraft: vi.fn(), deleteDraft: vi.fn(), setEnabled: vi.fn(), removeScenario: vi.fn(), check: vi.fn(), open: vi.fn() }))
vi.mock('../api', () => ({ scenarioEditorApi: api, imageUrl: (p) => p }))
vi.mock('../gridTheme', () => ({ registerGrid: () => {}, useGridTheme: () => ({ value: {} }) }))
import LoadDialog from '../components/LoadDialog.vue'
import { useEditorStore } from '../stores/editorStore'
import { useEditStore } from '../stores/editStore'
import { formatCrtime } from '../format'

const AgStub = { name: 'AgGridVue', props: ['rowData', 'columnDefs'], template: '<div data-testid="ag" />' }
const ModalStub = { name: 'ModalShell', props: ['modelValue', 'width'], template: '<div v-if="modelValue"><slot /><slot name="footer" /></div>' }
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
  it('메일 생략·시작 지연·재시도·트리거 정보 열은 한글로 보인다 — 없는 값(지연 0·재시도 0·모두 보냄)은 빈칸', async () => {
    const { w } = setup(); await flushPromises()
    const cols = w.findComponent({ name: 'AgGridVue' }).props('columnDefs')
    const fmt = (field, data) => cols.find((c) => c.field === field).valueFormatter({ data, value: data[field] })
    const full = { emailSkip: ['success', 'stop'], startDelay: 5400, retryCnt: 3, retryInterval: 60, triggerInfo: 'ALARM E1234' }
    expect(fmt('emailSkip', full)).toBe('성공·중지')
    expect(fmt('emailSkip', { emailSkip: ['success', 'fail', 'stop'] })).toBe('성공·실패·중지')
    expect(fmt('startDelay', full)).toBe('1시간 30분')
    expect(fmt('startDelay', { startDelay: 30 })).toBe('30초')
    expect(fmt('retryCnt', full)).toBe('3회 · 1분 간격')
    expect(fmt('retryCnt', { retryCnt: 1, retryInterval: 10 })).toBe('1회 · 10초 간격')
    expect(cols.find((c) => c.field === 'triggerInfo').valueFormatter).toBeUndefined() // 글 그대로
    const plain = { emailSkip: [], startDelay: 0, retryCnt: 0, retryInterval: 10, triggerInfo: null }
    expect(['emailSkip', 'startDelay', 'retryCnt'].map((f) => fmt(f, plain))).toEqual(['', '', ''])
    const unknown = { emailSkip: null, startDelay: null, retryCnt: null, retryInterval: null, triggerInfo: null } // 운영 속성을 못 푼 줄·초안만 줄
    expect(['emailSkip', 'startDelay', 'retryCnt'].map((f) => fmt(f, unknown))).toEqual(['', '', ''])
    expect(cols.find((c) => c.field === 'status').pinned).toBe('right')
  })
  it('창 너비는 열이 늘어난 만큼 넓다 — 화면의 94%, 가장 넓어도 1640', async () => {
    const was = window.innerWidth
    for (const [vw, want] of [[1920, 1640], [1600, 1504], [1100, 1034]]) {
      window.innerWidth = vw
      const { w } = setup(); await flushPromises()
      expect(w.findComponent({ name: 'ModalShell' }).props('width')).toBe(want)
      w.unmount()
    }
    window.innerWidth = was
  })
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

  it('확인 필요 열(열 수 없는 원인·초안만 안내)은 오른쪽에 고정한다 — 열 합계가 창보다 넓어 가로로 밀려도 열 수 없는 원인이 보인다(완료 조건 3)', async () => {
    const { w } = setup(); await flushPromises()
    const cols = w.findComponent({ name: 'AgGridVue' }).props('columnDefs')
    const status = cols.find((c) => c.field === 'status')
    expect(status.pinned).toBe('right')
    expect(status.valueFormatter({ value: ['NO_CURRENT_VERSION', 'DUPLICATE_PROPERTY'] })).toBe('현재 버전 없음, 같은 키 2건')
    // 정상인 줄은 빈칸이다 — 칼럼 이름이 "확인 필요" 라 빈칸이면 볼 것이 없다(2026-11-10). 열 수 없는 원인은 붉은 글씨
    expect(status.valueFormatter({ value: [] })).toBe('')
    expect(status.cellClass({ data: { status: ['NO_CURRENT_VERSION'] } })).toBe('se-load-bad')
    expect(status.cellClass({ data: { status: [] } })).toBe('')
    // 열 순서는 데스크톱 불러오기 목록(NAME·TRIGGER·SCENARIO_TYPE·DESCRIPTION·ACTIVATED·EMAIL_SKIP·DELAY·RETRY·TRIGGERINFO)을 따르고 웹 전용 열을 뒤에 둔다(2026-11-10)
    expect(cols.map((c) => c.headerName)).toEqual(['이름', '트리거', '유형', '설명', '켜짐', '메일 생략', '시작 지연', '재시도', '트리거 정보', '등급', '최근 수정자', '현재 버전', '확인 필요'])
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

// ── 쓰기 사용자: 켜기·끄기·지우기·되돌려 열기·내 초안(P2-D Task 7, 목업 2026-11-08-load-write-v1) ──
describe('LoadDialog — 쓰기 동작과 내 초안', () => {
  beforeEach(() => { Object.values(api).forEach((f) => f.mockReset()); localStorage.clear() })
  const fail = (status, code, details) => Promise.reject({ response: { status, data: { code, details } }, request: {} })
  const H = 1730000000000 // ALL_ACTIONS 현재 버전
  const OLD = 1720000000000
  const listRows = () => [
    { name: 'ALL_ACTIONS', isEnabled: true, typeName: 'ALARM_RECOVERY', status: [], currentCrtime: H, lastOwner: { singleid: 'kim', at: null, note: null } },
    { name: 'DUP', isEnabled: true, typeName: 'ALARM_RECOVERY', status: ['DUPLICATE_PROPERTY'], currentCrtime: H },
    { name: 'NO_REDIS', isEnabled: false, typeName: 'ALARM_RECOVERY', status: ['NO_CURRENT_VERSION'], currentCrtime: null },
    { name: 'PLAIN', isEnabled: false, typeName: 'ALARM_RECOVERY', status: [], currentCrtime: H + 100 }
  ]
  const draftRow = (over = {}) => ({ draftId: 'd1', name: 'ALL_ACTIONS', target: { model: 'SEWMODELA', name: 'ALL_ACTIONS' }, base: { crtime: H, fileId: 'f1' }, headCrtime: H, savedAt: '2026-11-07T05:23:51.000Z', revision: 2, ...over })
  const versionsOf = (name) => (name === 'ALL_ACTIONS' ? [{ crtime: H, isCurrent: true }, { crtime: OLD, isCurrent: false }] : name === 'NO_REDIS' ? [{ crtime: OLD, isCurrent: false }] : [{ crtime: H + 100, isCurrent: true }])

  function setupW({ canWrite = true, drafts = [draftRow()], list = listRows() } = {}) {
    setActivePinia(createPinia())
    const store = useEditorStore()
    store.scopes = DEFAULT_SCOPES
    store.me = { singleid: 'me_eng', canWrite }
    api.list.mockImplementation(() => ok(list.map((r) => ({ ...r }))))
    api.listDrafts.mockImplementation(() => ok(drafts.map((d) => ({ ...d }))))
    api.versions.mockImplementation((p, m, n) => ok(versionsOf(n)))
    const w = mount(LoadDialog, { props: { modelValue: true }, global: { stubs: { AgGridVue: AgStub, ModalShell: ModalStub } } })
    return { w, store, edit: useEditStore() }
  }
  const grid = (w) => w.findComponent({ name: 'AgGridVue' })
  const gridNames = (w) => grid(w).props('rowData').map((r) => r.name)
  const pick = async (w, name) => { grid(w).vm.$emit('row-clicked', { data: grid(w).props('rowData').find((r) => r.name === name) }); await flushPromises() }
  const tid = (w, id) => w.find(`[data-testid="${id}"]`)
  // 열린 편집 화면(그 시나리오, 저장 전 n곳)
  function openInEditor(store, edit, name, changes = 0) {
    const steps = [{ uid: 's0', origin: 0, condition: { kind: 'none', operationRaw: 0, skipPreprocessing: false }, action: { type: 11, typeName: 'RunCommand', raw: 'a', command: 'a' },
      next: { onTrue: { kind: 'end', value: 'SUCCESS' }, onFalse: { kind: 'end', value: 'FAIL' } }, retry: { limit: 0, intervalMs: 0 }, descriptionToEmail: 'x', descriptionToDialog: '', isShowDialog: true, images: { train: {}, base: null } }]
    const edited = { source: { process: 'SEWCVD', model: 'SEWMODELA', name, crtime: H, fileId: 'f1' }, headCrtime: H, header: { description: 'd', timeoutLimit: '1' }, steps, property: { IsEnabled: true } }
    store.skeleton = { process: 'SEWCVD', model: 'SEWMODELA', name, id: `SEWCVD-SEWMODELA-${name}`, headCrtime: H, propertyRev: 'r1', version: { crtime: H, isCurrent: true, fileId: 'f1' }, steps: steps.map((x, i) => ({ ...x, no: i + 1, notes: [] })), notes: [], edited }
    edit.begin(store.skeleton, store.me)
    // 저장 전 n곳 = 새로 넣은 스텝 n개
    if (changes) edit.session = { ...edit.session, working: { ...edit.session.working, steps: [...steps, ...Array.from({ length: changes }, (_, i) => ({ ...steps[0], uid: `n${i + 1}`, origin: null }))] } }
  }

  it('읽기만 하는 사용자는 P1 그대로 — 내 초안 열·초안만 행·[내 초안만]·스위치가 없고 초안 목록을 부르지 않는다', async () => {
    const { w } = setupW({ canWrite: false, drafts: [draftRow({ name: 'NEW_ONE', base: null, headCrtime: null })] }); await flushPromises()
    expect(api.listDrafts).not.toHaveBeenCalled()
    expect(grid(w).props('columnDefs').map((c) => c.headerName)).toEqual(['이름', '트리거', '유형', '설명', '켜짐', '메일 생략', '시작 지연', '재시도', '트리거 정보', '등급', '최근 수정자', '현재 버전', '확인 필요'])
    expect(tid(w, 'se-load-draft-only').exists()).toBe(false)
    await pick(w, 'ALL_ACTIONS')
    expect(tid(w, 'se-load-switch').exists()).toBe(false)
    expect(tid(w, 'se-load-delete').exists()).toBe(false)
  })

  it('창을 열 때마다 목록·내 초안을 다시 읽는다 — 화면이 처음 뜰 때(내 정보를 읽기 전) 만들어진 창에도 그 뒤 저장한 초안이 보인다', async () => {
    setActivePinia(createPinia())
    const store = useEditorStore()
    store.scopes = DEFAULT_SCOPES
    api.list.mockImplementation(() => ok(listRows()))
    api.listDrafts.mockImplementation(() => ok([draftRow()]))
    const w = mount(LoadDialog, { props: { modelValue: false }, global: { stubs: { AgGridVue: AgStub, ModalShell: ModalStub } } })
    await flushPromises()
    expect(api.listDrafts).not.toHaveBeenCalled() // 아직 내 정보가 없다(쓰기 권한을 모름)
    store.me = { singleid: 'me_eng', canWrite: true }
    await w.setProps({ modelValue: true }); await flushPromises()
    expect(api.listDrafts).toHaveBeenCalledWith('SEWCVD', 'SEWMODELA')
    expect(tid(w, 'se-load-draft-count').text()).toBe('1')
    const calls = api.list.mock.calls.length
    await w.setProps({ modelValue: false }); await w.setProps({ modelValue: true }); await flushPromises()
    expect(api.list.mock.calls.length).toBe(calls + 1)
  })

  it('표: 이름 다음 "내 초안" 열(저장 시각), 초안은 원본 행에 붙고 붙일 행이 없으면 "초안만 있음"(새 시나리오)·"초안만 · 원본 지워짐" 행, [내 초안만]과 수', async () => {
    const drafts = [draftRow(), draftRow({ draftId: 'd2', name: 'NEW_ONE', base: null, headCrtime: null, target: { model: 'SEWMODELA', name: 'NEW_ONE' } }), draftRow({ draftId: 'd3', name: 'GONE_ONE', base: { crtime: OLD, fileId: 'f9' }, headCrtime: OLD })]
    const { w } = setupW({ drafts }); await flushPromises()
    expect(api.listDrafts).toHaveBeenCalledWith('SEWCVD', 'SEWMODELA')
    const cols = grid(w).props('columnDefs')
    expect(cols.map((c) => c.headerName)).toEqual(['이름', '내 초안', '트리거', '유형', '설명', '켜짐', '메일 생략', '시작 지연', '재시도', '트리거 정보', '등급', '최근 수정자', '현재 버전', '확인 필요'])
    expect(gridNames(w)).toEqual(['ALL_ACTIONS', 'DUP', 'GONE_ONE', 'NEW_ONE', 'NO_REDIS', 'PLAIN'])
    const rowsNow = grid(w).props('rowData')
    const byName = (n) => rowsNow.find((r) => r.name === n)
    const draftCol = cols[1]
    const chip = draftCol.cellRenderer({ data: byName('ALL_ACTIONS'), value: byName('ALL_ACTIONS').draft })
    expect(chip.textContent).toBe(formatCrtime(Date.parse('2026-11-07T05:23:51.000Z')).slice(5, 16))
    expect(draftCol.cellRenderer({ data: byName('PLAIN'), value: null })).toBe('')
    const status = cols.find((c) => c.field === 'status')
    expect(status.valueFormatter({ data: byName('NEW_ONE'), value: byName('NEW_ONE').status })).toBe('초안만 있음')
    expect(status.valueFormatter({ data: byName('GONE_ONE'), value: byName('GONE_ONE').status })).toBe('초안만 · 원본 지워짐')
    // 초안만 있는 줄은 열 수 없는 원인이 아니라 안내다 — 붉은 글씨가 아니다
    expect(status.cellClass({ data: byName('NEW_ONE') })).toBe('')
    expect(status.cellClass({ data: byName('GONE_ONE') })).toBe('')
    expect(status.cellClass({ data: byName('DUP') })).toBe('se-load-bad')
    expect(cols.find((c) => c.field === 'isEnabled').valueFormatter({ data: byName('NEW_ONE'), value: null })).toBe('—')
    expect(cols.find((c) => c.field === 'isEnabled').cellDataType).toBe(false) // 체크 칸이 아니라 글자로
    expect(cols.find((c) => c.field === 'isEnabled').valueFormatter({ data: byName('DUP'), value: true })).toBe('?')
    expect(cols.find((c) => c.field === 'currentCrtime').valueFormatter({ data: byName('NEW_ONE'), value: null })).toBe('없음')
    expect(cols[0].cellClass({ data: byName('ALL_ACTIONS') })).toContain('se-load-has-draft')
    expect(tid(w, 'se-load-draft-count').text()).toBe('3')
    await tid(w, 'se-load-draft-only').find('input').setValue(true)
    expect(gridNames(w)).toEqual(['ALL_ACTIONS', 'GONE_ONE', 'NEW_ONE'])
  })

  it('켜기·끄기: 확인 없이 바로 PUT …/enabled, 행은 받은 값으로 바뀌고(최근 수정자 = 나) "껐습니다 · 수정 이력에 남음"', async () => {
    const { w } = setupW(); await flushPromises()
    await pick(w, 'ALL_ACTIONS')
    expect(tid(w, 'se-load-switch').attributes('aria-checked')).toBe('true')
    api.setEnabled.mockReturnValue(ok({ isEnabled: false, propertyRev: 'r2' }))
    await tid(w, 'se-load-switch').trigger('click'); await flushPromises()
    expect(api.setEnabled).toHaveBeenCalledWith('SEWCVD', 'SEWMODELA', 'ALL_ACTIONS', false)
    const row = grid(w).props('rowData').find((r) => r.name === 'ALL_ACTIONS')
    expect(row.isEnabled).toBe(false)
    expect(row.lastOwner.singleid).toBe('me_eng')
    expect(tid(w, 'se-load-switch').attributes('aria-checked')).toBe('false')
    expect(tid(w, 'se-load-switch-note').text()).toContain('껐습니다 · 수정 이력에 남음')
    expect(w.find('[data-test="toast"]').text()).toContain('껐습니다. 수정 이력에 남았습니다.')
  })

  it('편집 화면에 열린 시나리오를 끄면 세션의 propertyRev 는 그대로, 칸에 "배포하면 저장 창이 알린다" — 다시 켜도 알림은 남는다', async () => {
    const { w, store, edit } = setupW(); await flushPromises()
    openInEditor(store, edit, 'ALL_ACTIONS', 2)
    await pick(w, 'ALL_ACTIONS')
    expect(tid(w, 'se-load-pane-open').text()).toContain('편집 화면에 열려 있음 · 저장 전 2곳')
    expect(tid(w, 'se-load-property-note').exists()).toBe(false)
    api.setEnabled.mockReturnValueOnce(ok({ isEnabled: false, propertyRev: 'r2' }))
    await tid(w, 'se-load-switch').trigger('click'); await flushPromises()
    expect(edit.session.propertyRev).toBe('r1')
    expect(tid(w, 'se-load-property-note').text()).toContain('켜짐')
    api.setEnabled.mockReturnValueOnce(ok({ isEnabled: true, propertyRev: 'r3' }))
    await tid(w, 'se-load-switch').trigger('click'); await flushPromises()
    expect(tid(w, 'se-load-property-note').exists()).toBe(true)
  })

  it('켜기·끄기 실패(그 사이 지워짐 404)는 칸에 이유와 [목록 다시 읽기], 스위치는 그대로', async () => {
    const { w } = setupW(); await flushPromises()
    await pick(w, 'ALL_ACTIONS')
    api.setEnabled.mockReturnValue(fail(404, 'NOT_FOUND'))
    await tid(w, 'se-load-switch').trigger('click'); await flushPromises()
    expect(tid(w, 'se-load-switch-error').text()).toContain('이 시나리오가 없습니다')
    expect(tid(w, 'se-load-switch').attributes('aria-checked')).toBe('true')
    await tid(w, 'se-load-relist').trigger('click'); await flushPromises()
    expect(api.list).toHaveBeenCalledTimes(2)
  })

  it('같은 키 2건 행은 스위치를 그리지 않고 지우기도 끈다', async () => {
    const { w } = setupW(); await flushPromises()
    await pick(w, 'DUP')
    expect(tid(w, 'se-load-switch').exists()).toBe(false)
    expect(tid(w, 'se-load-dup').text()).toContain('데이터 점검')
    expect(tid(w, 'se-load-delete').attributes('disabled')).toBeDefined()
  })

  it('지우기 확인 창의 이름 따라 치기: 맞게 친 뒤의 남은 글자는 회색 안내로 남고, 틀린 글자부터 붉은 글씨이며 안내가 사라진다', async () => {
    const { w } = setupW(); await flushPromises()
    await pick(w, 'ALL_ACTIONS')
    await tid(w, 'se-load-delete').trigger('click'); await flushPromises()
    const name = tid(w, 'se-load-del-name')
    const part = (k) => { const el = tid(w, `se-load-del-${k}`); return el.exists() ? el.element.textContent : '' }
    const parts = () => [part('ok'), part('bad'), part('ghost')]
    expect(name.attributes('placeholder')).toBeUndefined() // 한 글자 치면 통째로 사라지는 placeholder 대신 안내 층
    expect(parts()).toEqual(['', '', 'ALL_ACTIONS'])
    await name.setValue('ALL_')
    expect(parts()).toEqual(['ALL_', '', 'ACTIONS'])
    expect(name.classes()).not.toContain('border-red-500')
    await name.setValue('ALL_X')
    expect(parts()).toEqual(['ALL_', 'X', ''])
    expect(name.classes()).toContain('border-red-500')
    expect(tid(w, 'se-load-del-go').attributes('disabled')).toBeDefined()
    await name.setValue('ALL_XCT')
    expect(parts()).toEqual(['ALL_', 'XCT', ''])
    await name.setValue('ALL_') // 틀린 글자를 지우면 안내가 다시 나온다
    expect(parts()).toEqual(['ALL_', '', 'ACTIONS'])
    await name.setValue('ALL_ACTIONS')
    expect(parts()).toEqual(['ALL_ACTIONS', '', ''])
    expect(name.classes()).toContain('border-green-500')
    expect(tid(w, 'se-load-del-go').attributes('disabled')).toBeUndefined()
    // 안내 층은 보이기만 한다 — 읽어 주는 프로그램에는 입력칸과 아래 문구만
    expect(tid(w, 'se-load-del-along').attributes('aria-hidden')).toBe('true')
  })
  it('지우기: 확인 창(버전 수·모델별 설비 수·남는 것), 이름이 대소문자까지 같아야 [지우기]가 켜지고, 지우면 행이 빠진다(초안이 있으면 "원본 지워짐" 행)', async () => {
    const { w } = setupW(); await flushPromises()
    await pick(w, 'ALL_ACTIONS')
    await tid(w, 'se-load-delete').trigger('click'); await flushPromises()
    const del = tid(w, 'se-load-del')
    expect(del.text()).toContain('SEWCVD-SEWMODELA-ALL_ACTIONS')
    expect(del.text()).toContain('버전 2개 전부')
    expect(del.text()).toContain('SEWMODELA 설비 2대에서 이 시나리오가 더 실행되지 않습니다.')
    expect(del.text()).toContain('설비 PC 에 내려간 시나리오 파일은 지우지 않습니다')
    expect(del.text()).toContain('내 초안')
    const go = () => tid(w, 'se-load-del-go')
    expect(go().attributes('disabled')).toBeDefined()
    await tid(w, 'se-load-del-name').setValue('all_actions')
    expect(go().attributes('disabled')).toBeDefined()
    expect(del.text()).toContain('대소문자까지 같아야 합니다')
    await tid(w, 'se-load-del-name').setValue('ALL_ACTIONS')
    expect(go().attributes('disabled')).toBeUndefined()
    api.removeScenario.mockReturnValue(ok({ deleted: true }))
    await go().trigger('click'); await flushPromises()
    expect(api.removeScenario).toHaveBeenCalledWith('SEWCVD', 'SEWMODELA', 'ALL_ACTIONS', 'ALL_ACTIONS', false) // 체크하지 않으면 내 초안은 남긴다
    expect(tid(w, 'se-load-del').exists()).toBe(false)
    const row = grid(w).props('rowData').find((r) => r.name === 'ALL_ACTIONS')
    expect(row.draftOnly).toBe('gone')
    expect(w.find('[data-test="toast"]').text()).toContain('지웠습니다')
  })

  // 내 초안도 함께 지우기(2026-11-10 사용자 결정) — 내 초안이 있는 시나리오에만 체크 칸이 나온다. 남의 초안은 지우지 않는다
  it('지우기: [내 초안도 함께 지웁니다] 를 체크하면 withDraft 로 보내고, 초안까지 지워졌으면 행이 통째로 빠진다', async () => {
    const { w } = setupW(); await flushPromises()
    await pick(w, 'ALL_ACTIONS')
    await tid(w, 'se-load-delete').trigger('click'); await flushPromises()
    const box = tid(w, 'se-load-del-with-draft')
    expect(box.element.checked).toBe(false)
    expect(tid(w, 'se-load-del').text()).toContain('도 남습니다')
    await box.setValue(true)
    expect(tid(w, 'se-load-del').text()).not.toContain('도 남습니다') // 남는 것 안내에서 초안이 빠진다
    await tid(w, 'se-load-del-name').setValue('ALL_ACTIONS')
    api.removeScenario.mockReturnValue(ok({ deleted: true, draftDeleted: true }))
    await tid(w, 'se-load-del-go').trigger('click'); await flushPromises()
    expect(api.removeScenario).toHaveBeenCalledWith('SEWCVD', 'SEWMODELA', 'ALL_ACTIONS', 'ALL_ACTIONS', true)
    expect(gridNames(w)).not.toContain('ALL_ACTIONS')
    expect(tid(w, 'se-load-draft-count').text()).toBe('0')
    expect(w.find('[data-test="toast"]').text()).toContain('시나리오와 내 초안을 지웠습니다')
  })
  it('지우기: 초안 지우기만 실패하면(draftDeleted false) 시나리오는 지워지고 초안 행이 남는다고 알린다', async () => {
    const { w } = setupW(); await flushPromises()
    await pick(w, 'ALL_ACTIONS')
    await tid(w, 'se-load-delete').trigger('click'); await flushPromises()
    await tid(w, 'se-load-del-with-draft').setValue(true)
    await tid(w, 'se-load-del-name').setValue('ALL_ACTIONS')
    api.removeScenario.mockReturnValue(ok({ deleted: true, draftDeleted: false }))
    await tid(w, 'se-load-del-go').trigger('click'); await flushPromises()
    expect(grid(w).props('rowData').find((r) => r.name === 'ALL_ACTIONS').draftOnly).toBe('gone')
    expect(w.find('[data-test="toast"]').text()).toContain('내 초안은 지우지 못했습니다')
  })
  it('지우기: 내 초안이 없는 시나리오에는 체크 칸이 없다', async () => {
    const { w } = setupW({ drafts: [] }); await flushPromises()
    await pick(w, 'PLAIN')
    await tid(w, 'se-load-delete').trigger('click'); await flushPromises()
    expect(tid(w, 'se-load-del-with-draft').exists()).toBe(false)
  })

  // 초안만 남은 행 한꺼번에 지우기(2026-11-10 사용자 결정 — 내 초안만, 이 공정·모델에서)
  describe('초안만 남은 것 정리', () => {
    const three = () => [draftRow(), draftRow({ draftId: 'd2', name: 'NEW_ONE', base: null, headCrtime: null, target: { model: 'SEWMODELA', name: 'NEW_ONE' } }),
      draftRow({ draftId: 'd3', name: 'GONE_ONE', target: { model: 'SEWMODELA', name: 'GONE_ONE' } })]
    it('초안만 남은 행이 있을 때만 [초안만 남은 것 정리] 가 나온다 — 원본이 있는 초안은 세지 않는다', async () => {
      const none = setupW(); await flushPromises()
      expect(tid(none.w, 'se-load-cleanup').exists()).toBe(false)
      const { w } = setupW({ drafts: three() }); await flushPromises()
      expect(tid(w, 'se-load-cleanup').text()).toContain('2')
    })
    it('고른 것만 지운다: 처음엔 아무것도 고르지 않았고, [모두 고르기] 뒤 하나를 빼면 그 하나는 남는다', async () => {
      const { w } = setupW({ drafts: three() }); await flushPromises()
      await tid(w, 'se-load-cleanup').trigger('click')
      const rowsOf = () => w.findAll('[data-testid="se-load-clean-row"]')
      expect(rowsOf().map((r) => r.text())).toEqual([expect.stringContaining('GONE_ONE'), expect.stringContaining('NEW_ONE')])
      expect(rowsOf()[0].text()).toContain('원본이 지워짐')
      expect(rowsOf()[1].text()).toContain('아직 배포한 적 없음')
      expect(tid(w, 'se-load-clean-go').attributes('disabled')).toBeDefined()
      await tid(w, 'se-load-clean-all').setValue(true)
      expect(tid(w, 'se-load-clean-go').text()).toContain('2개')
      await rowsOf()[1].find('input').setValue(false)
      expect(tid(w, 'se-load-clean-go').text()).toContain('1개')
      api.deleteDraft.mockReturnValue(ok({ deleted: true }))
      await tid(w, 'se-load-clean-go').trigger('click'); await flushPromises()
      expect(api.deleteDraft.mock.calls).toEqual([['d3']])
      expect(tid(w, 'se-load-clean').exists()).toBe(false)
      expect(gridNames(w)).toEqual(['ALL_ACTIONS', 'DUP', 'NEW_ONE', 'NO_REDIS', 'PLAIN'])
      expect(w.find('[data-test="toast"]').text()).toContain('초안 1개를 지웠습니다')
    })
    it('일부를 지우지 못하면 지운 것만 빠지고 못 지운 수를 알린다', async () => {
      const { w } = setupW({ drafts: three() }); await flushPromises()
      await tid(w, 'se-load-cleanup').trigger('click')
      await tid(w, 'se-load-clean-all').setValue(true)
      api.deleteDraft.mockImplementation((id) => (id === 'd2' ? fail(503, 'UPSTREAM_DOWN') : ok({ deleted: true })))
      await tid(w, 'se-load-clean-go').trigger('click'); await flushPromises()
      expect(api.deleteDraft).toHaveBeenCalledTimes(2)
      expect(gridNames(w)).toContain('NEW_ONE')
      expect(gridNames(w)).not.toContain('GONE_ONE')
      expect(w.find('[data-test="toast"]').text()).toContain('초안 1개를 지웠습니다. 1개는 지우지 못했습니다')
    })
    it('[취소] 는 아무것도 지우지 않는다', async () => {
      const { w } = setupW({ drafts: three() }); await flushPromises()
      await tid(w, 'se-load-cleanup').trigger('click')
      await tid(w, 'se-load-clean-all').setValue(true)
      await tid(w, 'se-load-clean-cancel').trigger('click')
      expect(api.deleteDraft).not.toHaveBeenCalled()
      expect(tid(w, 'se-load-clean').exists()).toBe(false)
    })
  })

  it('꺼진 시나리오 지우기는 "지금 꺼져 있습니다" 로 설비를 알린다, 초안이 없으면 행이 빠진다', async () => {
    const { w } = setupW({ drafts: [] }); await flushPromises()
    await pick(w, 'PLAIN')
    await tid(w, 'se-load-delete').trigger('click')
    expect(tid(w, 'se-load-del').text()).toContain('지금 꺼져 있습니다. 지우면 SEWMODELA 설비 2대 어디서도 다시 켤 수 없습니다.')
    await tid(w, 'se-load-del-name').setValue('PLAIN')
    api.removeScenario.mockReturnValue(ok({ deleted: true }))
    await tid(w, 'se-load-del-go').trigger('click'); await flushPromises()
    expect(gridNames(w)).not.toContain('PLAIN')
  })

  it('편집 화면에 열린 시나리오(저장 전 3곳)도 경고 뒤 지울 수 있고, 지우면 편집 화면은 읽기 전용', async () => {
    const { w, store, edit } = setupW(); await flushPromises()
    openInEditor(store, edit, 'ALL_ACTIONS', 3)
    await pick(w, 'ALL_ACTIONS')
    await tid(w, 'se-load-delete').trigger('click')
    expect(tid(w, 'se-load-del').text()).toContain('편집 화면에 열려 있는 시나리오입니다')
    expect(tid(w, 'se-load-del').text()).toContain('저장 전 고친 곳 3곳')
    await tid(w, 'se-load-del-name').setValue('ALL_ACTIONS')
    api.removeScenario.mockReturnValue(ok({ deleted: true }))
    await tid(w, 'se-load-del-go').trigger('click'); await flushPromises()
    expect(edit.session.readOnly).toBe('deleted')
    expect(w.find('[data-test="toast"]').text()).toContain('편집 화면은 읽기 전용이 됐습니다')
  })

  it('지우기 결과 모름(504)은 다시 보내지 않고 [목록 다시 읽기]만', async () => {
    const { w } = setupW(); await flushPromises()
    await pick(w, 'ALL_ACTIONS')
    await tid(w, 'se-load-delete').trigger('click')
    await tid(w, 'se-load-del-name').setValue('ALL_ACTIONS')
    api.removeScenario.mockReturnValue(fail(504, 'UPSTREAM_TIMEOUT'))
    await tid(w, 'se-load-del-go').trigger('click'); await flushPromises()
    expect(tid(w, 'se-load-del-unknown').text()).toContain('지웠는지 확인하지 못했습니다')
    expect(tid(w, 'se-load-del-go').exists()).toBe(false)
    expect(api.removeScenario).toHaveBeenCalledTimes(1)
    await tid(w, 'se-load-del-relist').trigger('click'); await flushPromises()
    expect(api.list).toHaveBeenCalledTimes(2)
    expect(tid(w, 'se-load-del').exists()).toBe(false)
  })

  it('지우기가 가지 않았으면(503) 이유를 보이고 다시 누를 수 있다', async () => {
    const { w } = setupW(); await flushPromises()
    await pick(w, 'ALL_ACTIONS')
    await tid(w, 'se-load-delete').trigger('click')
    await tid(w, 'se-load-del-name').setValue('ALL_ACTIONS')
    api.removeScenario.mockReturnValue(fail(503, 'UPSTREAM_DOWN'))
    await tid(w, 'se-load-del-go').trigger('click'); await flushPromises()
    expect(tid(w, 'se-load-del-error').text()).toContain('지우지 못했습니다')
    expect(tid(w, 'se-load-del-go').attributes('disabled')).toBeUndefined()
  })

  it('옛 버전을 고르면 [읽기 전용으로 열기]·[이 버전으로 되돌려 열기] — 되돌려 열기는 restore, 현재 버전이 없으면 되돌릴 수 없다', async () => {
    const { w } = setupW({ drafts: [] }); await flushPromises()
    await pick(w, 'ALL_ACTIONS')
    await w.findAll('[data-testid="se-load-version"]')[1].trigger('click')
    expect(tid(w, 'se-load-foot').text()).toContain('현재 버전(')
    await tid(w, 'se-load-open-old').trigger('click')
    expect(w.emitted('open').at(-1)[0]).toEqual({ process: 'SEWCVD', model: 'SEWMODELA', name: 'ALL_ACTIONS', crtime: String(OLD) })
    await tid(w, 'se-load-restore').trigger('click')
    expect(w.emitted('restore')[0][0]).toEqual({ process: 'SEWCVD', model: 'SEWMODELA', name: 'ALL_ACTIONS', crtime: OLD })
    await pick(w, 'NO_REDIS')
    await w.findAll('[data-testid="se-load-version"]')[0].trigger('click')
    expect(tid(w, 'se-load-restore').exists()).toBe(false)
    expect(tid(w, 'se-load-foot').text()).toContain('되돌려 열 수 없습니다')
  })

  it('초안 있는 행을 열면 "내 초안이 있습니다" — [초안 이어서 열기]는 open-draft, [현재 버전 열기]는 현재 버전', async () => {
    const { w } = setupW(); await flushPromises()
    await pick(w, 'ALL_ACTIONS')
    expect(tid(w, 'se-load-foot').text()).toContain('초안')
    await tid(w, 'se-load-open').trigger('click')
    const ch = tid(w, 'se-load-choice')
    expect(ch.text()).toContain('내 초안이 있습니다')
    expect(ch.text()).toContain(formatCrtime(H))
    expect(tid(w, 'se-load-choice-stale').exists()).toBe(false)
    await tid(w, 'se-load-choice-draft').trigger('click')
    expect(w.emitted('open-draft')[0][0]).toMatchObject({ process: 'SEWCVD', model: 'SEWMODELA', name: 'ALL_ACTIONS', draftId: 'd1' })
    // 두 번 눌러도 고르기 창
    grid(w).vm.$emit('row-double-clicked', { data: grid(w).props('rowData').find((r) => r.name === 'ALL_ACTIONS') })
    await flushPromises()
    await tid(w, 'se-load-choice-current').trigger('click')
    expect(w.emitted('open').at(-1)[0]).toEqual({ process: 'SEWCVD', model: 'SEWMODELA', name: 'ALL_ACTIONS', crtime: 'current' })
  })

  it('초안을 시작한 뒤 새 버전이 배포됐으면(초안 headCrtime ≠ 현재 버전) 표 칩·초안 줄·고르기 창에서 알린다', async () => {
    const { w } = setupW({ drafts: [draftRow({ base: { crtime: OLD, fileId: 'f0' }, headCrtime: OLD })] }); await flushPromises()
    const row = grid(w).props('rowData').find((r) => r.name === 'ALL_ACTIONS')
    expect(grid(w).props('columnDefs')[1].cellRenderer({ data: row, value: row.draft }).className).toContain('am')
    await pick(w, 'ALL_ACTIONS')
    expect(tid(w, 'se-load-draft-line').text()).toContain('그 뒤 새 버전 있음')
    await tid(w, 'se-load-open').trigger('click')
    expect(tid(w, 'se-load-choice-stale').text()).toContain('초안을 시작한 뒤 새 버전이 배포됐습니다')
  })

  it('버전 목록 맨 위 "내 초안" 줄: 고르면 [초안 이어서 열기], [초안 지우기]는 한 번 더 묻고 지운다', async () => {
    const { w } = setupW(); await flushPromises()
    await pick(w, 'ALL_ACTIONS')
    await tid(w, 'se-load-draft-line').trigger('click')
    expect(tid(w, 'se-load-open-draft').exists()).toBe(true)
    await tid(w, 'se-load-draft-delete').trigger('click')
    expect(api.deleteDraft).not.toHaveBeenCalled()
    expect(tid(w, 'se-load-draft-delete-ask').text()).toContain('이 초안을 지울까요? 되돌릴 수 없습니다.')
    api.deleteDraft.mockReturnValue(ok({ deleted: true }))
    await tid(w, 'se-load-draft-delete-go').trigger('click'); await flushPromises()
    expect(api.deleteDraft).toHaveBeenCalledWith('d1')
    expect(grid(w).props('rowData').find((r) => r.name === 'ALL_ACTIONS').draft).toBe(null)
    expect(tid(w, 'se-load-draft-line').exists()).toBe(false)
    expect(w.find('[data-test="toast"]').text()).toContain('초안을 지웠습니다')
  })

  it('편집 화면이 그 초안으로 열려 있으면 지울 때 알리고, 지우면 그 세션은 초안 그림을 잃는다', async () => {
    const { w, store, edit } = setupW(); await flushPromises()
    openInEditor(store, edit, 'ALL_ACTIONS')
    edit.markDraft({ draftId: 'd1', savedAt: '2026-11-07T05:23:51.000Z' })
    await pick(w, 'ALL_ACTIONS')
    await tid(w, 'se-load-draft-line').trigger('click')
    await tid(w, 'se-load-draft-delete').trigger('click')
    expect(tid(w, 'se-load-draft-delete-ask').text()).toContain('편집 화면')
    api.deleteDraft.mockReturnValue(ok({ deleted: true }))
    await tid(w, 'se-load-draft-delete-go').trigger('click'); await flushPromises()
    expect(edit.draftId).toBe(null)
  })

  it('"초안만 있음"(배포한 적 없는 새 시나리오) 행: 켜기·끄기·지우기 없이 내 초안만, 바닥 [초안 이어서 열기]', async () => {
    const { w } = setupW({ drafts: [draftRow({ draftId: 'd2', name: 'NEW_ONE', base: null, headCrtime: null, target: { model: 'SEWMODELA', name: 'NEW_ONE' } })] }); await flushPromises()
    await pick(w, 'NEW_ONE')
    expect(api.versions).not.toHaveBeenCalled()
    expect(tid(w, 'se-load-switch').exists()).toBe(false)
    expect(tid(w, 'se-load-delete').exists()).toBe(false)
    expect(tid(w, 'se-load-pane').text()).toContain('아직 배포한 적 없는 새 시나리오입니다')
    expect(tid(w, 'se-load-draft-line').attributes('aria-selected')).toBe('true')
    await tid(w, 'se-load-open-draft').trigger('click')
    expect(w.emitted('open-draft')[0][0]).toMatchObject({ name: 'NEW_ONE', draftId: 'd2' })
  })

  it('원본이 지워진 초안: 서버에 남겨 둔 사본(force 검사에 SOURCE_GONE 없음)이 있으면 이어서 열 수 있고, 없으면 "원본 지워짐" 과 [초안 지우기]만', async () => {
    const gone = draftRow({ draftId: 'd3', name: 'GONE_ONE', base: { crtime: OLD, fileId: 'f9' }, headCrtime: OLD, target: { model: 'SEWMODELA', name: 'GONE_ONE' } })
    const scenario = { source: { process: 'SEWCVD', model: 'SEWMODELA', name: 'GONE_ONE', crtime: OLD, fileId: 'f9' }, headCrtime: OLD, header: { description: 'd', timeoutLimit: '1' }, steps: [], property: {} }
    api.getDraft.mockReturnValue(ok({ ...gone, propertyRev: 'rg', scenario, imageUrls: {} }))
    api.check.mockReturnValueOnce(ok({ blocks: [{ code: 'FOLLOW_NAME_REQUIRED' }], warns: [], conflict: { kind: 'deleted' }, target: { exists: false, eqpCount: 2 }, targetExists: null }))
    const { w } = setupW({ drafts: [gone] }); await flushPromises()
    await pick(w, 'GONE_ONE')
    expect(api.getDraft).toHaveBeenCalledWith('d3')
    const meta = api.check.mock.calls[0][0]
    expect(meta.force).toBe(true)
    expect(meta.target).toEqual({ process: 'SEWCVD', model: 'SEWMODELA', name: 'GONE_ONE' })
    expect(meta.scenario.source.crtime).toBe(OLD)
    expect(tid(w, 'se-load-pane').text()).toContain('원본 시나리오가 지워졌습니다')
    expect(tid(w, 'se-load-open-draft').attributes('disabled')).toBeUndefined()
    expect(tid(w, 'se-load-foot').text()).toContain('다시 만들지 묻습니다')
    // 사본마저 없으면
    api.check.mockReturnValueOnce(ok({ blocks: [{ code: 'SOURCE_GONE' }], warns: [], conflict: { kind: 'deleted' }, target: { exists: false, eqpCount: 2 }, targetExists: null }))
    await w.find('[data-testid="se-load-model"]').setValue('SEWMODELB'); await flushPromises()
    await w.find('[data-testid="se-load-model"]').setValue('SEWMODELA'); await flushPromises()
    await pick(w, 'GONE_ONE')
    expect(tid(w, 'se-load-open-draft').exists()).toBe(false)
    expect(tid(w, 'se-load-foot').text()).toContain('열 수 없습니다')
    expect(tid(w, 'se-load-draft-delete').exists()).toBe(true)
  })
})

// 이력 창 — 태그 스냅샷의 자동 복구 이력을 스텝 카드로 (P3 설계 §4.7). 이력 서버의 HTML 은 화면에 들어오지 않는다.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises, enableAutoUnmount, DOMWrapper } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

const api = vi.hoisted(() => ({ history: vi.fn() }))
vi.mock('../api', async (importOriginal) => ({ ...(await importOriginal()), scenarioEditorApi: api }))
import HistoryDialog from '../components/snapshot/HistoryDialog.vue'
import { MESSAGES, t } from '../messages'

enableAutoUnmount(afterEach)
const ok = (data) => Promise.resolve({ data: { data } })
const defer = () => { let resolve; let reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej }); return { promise, resolve, reject } }
const fail = (status, code) => ({ response: { status, data: { code } } })
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const PNG2 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mNk+M9QzwAEjDAGACCDAv8cI7IoAAAAAElFTkSuQmCC'
const STEPS = [
  { no: 1, text: '로그인 창 확인', images: [{ kind: 'ref', src: PNG }, { kind: 'screen', src: PNG2 }] },
  { no: 2, text: "A<B & 'x' <b>누르기</b><script>alert(1)</script>", images: [{ kind: 'screen', src: PNG2 }] },
  { no: null, text: '번호 없는 글', images: [] }
]
const body = () => new DOMWrapper(document.body)
const tid = (id) => body().find(`[data-testid="${id}"]`)
const tids = (id) => body().findAll(`[data-testid="${id}"]`)

describe('HistoryDialog', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    api.history.mockReset()
    api.history.mockImplementation((eqpId, txn) => ok({ eqpId, txn, steps: STEPS }))
  })
  afterEach(() => vi.restoreAllMocks())
  const open = async (props = {}) => {
    const w = mount(HistoryDialog, { props: { modelValue: true, eqpId: 'SEWT_A01', txn: '1763254800000', tag: 'start', ...props }, attachTo: document.body })
    await flushPromises()
    return w
  }

  it('닫혀 있으면 부르지 않는다. 열면 그 설비·txn 으로 한 번 청한다', async () => {
    const w = mount(HistoryDialog, { props: { modelValue: false, eqpId: 'SEWT_A01', txn: '100000', tag: 'start' }, attachTo: document.body })
    await flushPromises()
    expect(api.history).not.toHaveBeenCalled()
    expect(tid('se-history-dialog').exists()).toBe(false)
    await w.setProps({ modelValue: true })
    await flushPromises()
    expect(api.history.mock.calls).toEqual([['SEWT_A01', '100000']])
  })

  it('머리: 설비·txn·태그', async () => {
    await open()
    const head = tid('se-history-head').text()
    expect(head).toContain('SEWT_A01')
    expect(head).toContain('1763254800000')
    expect(head).toContain(MESSAGES.SEW_SNAP_TAG_start)
  })

  it('스텝마다 카드 — 번호·설명·기준 그림·화면', async () => {
    await open()
    const cards = tids('se-history-step')
    expect(cards).toHaveLength(3)
    expect(cards[0].find('[data-testid="se-history-no"]').text()).toBe('1')
    expect(cards[0].find('[data-testid="se-history-text"]').text()).toBe('로그인 창 확인')
    expect(cards[0].find('[data-testid="se-history-ref"]').attributes('src')).toBe(PNG)
    expect(cards[0].find('[data-testid="se-history-screen"]').attributes('src')).toBe(PNG2)
    // 그림이 없는 자리는 비워 둔다
    expect(cards[1].find('[data-testid="se-history-ref"]').exists()).toBe(false)
    expect(cards[1].find('[data-testid="se-history-screen"]').exists()).toBe(true)
    expect(cards[2].find('[data-testid="se-history-no"]').exists()).toBe(false)
    expect(cards[2].findAll('img')).toHaveLength(0)
  })

  it('설명 안의 태그는 글자로만 보인다 — HTML 로 들어가지 않는다', async () => {
    await open()
    const text = tids('se-history-step')[1].find('[data-testid="se-history-text"]')
    expect(text.text()).toBe("A<B & 'x' <b>누르기</b><script>alert(1)</script>")
    expect(text.element.children).toHaveLength(0)
    expect(tid('se-history-dialog').element.querySelector('script')).toBeNull()
  })

  it('png 데이터 주소가 아닌 그림은 그리지 않는다', async () => {
    api.history.mockImplementation(() => ok({ steps: [{ no: 1, text: 'x', images: [{ kind: 'ref', src: 'javascript:alert(1)' }, { kind: 'screen', src: 'http://evil.example/a.png' }, { kind: 'screen', src: 'data:image/svg+xml;base64,AAAA' }] }] }))
    await open()
    expect(tid('se-history-dialog').findAll('img')).toHaveLength(0)
  })

  it('그림을 누르면 크게 보고, 다시 누르면 닫힌다', async () => {
    await open()
    expect(tid('se-history-zoom').exists()).toBe(false)
    await tids('se-history-screen')[0].trigger('click')
    expect(tid('se-history-zoom').find('img').attributes('src')).toBe(PNG2)
    await tid('se-history-zoom').trigger('click')
    expect(tid('se-history-zoom').exists()).toBe(false)
    await tid('se-history-ref').trigger('click')
    expect(tid('se-history-zoom').find('img').attributes('src')).toBe(PNG)
  })

  it('Esc 는 크게 본 것을 먼저 닫고, 그다음에 창을 닫는다', async () => {
    const w = await open()
    await tids('se-history-screen')[0].trigger('click')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(tid('se-history-zoom').exists()).toBe(false)
    expect(w.emitted('update:modelValue')).toBeUndefined()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(w.emitted('update:modelValue')).toEqual([[false]])
  })

  it('받는 중·[닫기]', async () => {
    const gate = defer()
    api.history.mockImplementation(() => gate.promise)
    const w = await open()
    expect(tid('se-history-state').text()).toBe(MESSAGES.SEW_SNAP_HISTORY_LOADING)
    expect(tids('se-history-step')).toHaveLength(0)
    await tid('se-history-close').trigger('click')
    expect(w.emitted('update:modelValue')).toEqual([[false]])
  })

  it('이력이 없으면 안내하고 [다시 시도] 는 없다', async () => {
    api.history.mockImplementation(() => Promise.reject(fail(404, 'HISTORY_NOT_FOUND')))
    await open()
    expect(tid('se-history-state').text()).toBe(MESSAGES.SEW_ERR_HISTORY_NOT_FOUND)
    expect(tid('se-history-retry').exists()).toBe(false)
  })

  it('주소 없음·연결 실패·응답 없음은 서로 다른 글이고 [다시 시도] 로 다시 청한다', async () => {
    const seen = []
    for (const [status, code] of [[503, 'HISTORY_UNSET'], [503, 'HISTORY_DOWN'], [504, 'HISTORY_TIMEOUT'], [502, 'HISTORY_UNREADABLE']]) {
      api.history.mockImplementation(() => Promise.reject(fail(status, code)))
      const w = await open()
      seen.push(tid('se-history-state').text())
      expect(tid('se-history-state').text()).toBe(MESSAGES[`SEW_ERR_${code}`])
      w.unmount()
    }
    expect(new Set(seen).size).toBe(4)
    api.history.mockImplementation(() => Promise.reject(fail(503, 'HISTORY_DOWN')))
    await open()
    api.history.mockClear()
    api.history.mockImplementation((eqpId, txn) => ok({ eqpId, txn, steps: STEPS }))
    await tid('se-history-retry').trigger('click')
    await flushPromises()
    expect(api.history).toHaveBeenCalledTimes(1)
    expect(tids('se-history-step')).toHaveLength(3)
  })

  it('스텝 수를 보인다', async () => {
    await open()
    expect(tid('se-history-count').text()).toBe(t('SEW_SNAP_HISTORY_STEPS', { n: 3 }))
  })

  it('닫았다가 다른 txn 으로 열면 앞의 늦은 답이 섞이지 않는다', async () => {
    const first = defer()
    api.history.mockImplementationOnce(() => first.promise)
    const w = await open({ txn: '100001' })
    await w.setProps({ modelValue: false })
    api.history.mockImplementationOnce((eqpId, txn) => ok({ eqpId, txn, steps: STEPS.slice(0, 1) }))
    await w.setProps({ modelValue: true, txn: '100002' })
    await flushPromises()
    first.resolve({ data: { data: { steps: STEPS } } })
    await flushPromises()
    expect(tids('se-history-step')).toHaveLength(1)
    expect(tid('se-history-head').text()).toContain('100002')
  })

  it('닫으면 받은 이력과 크게 본 그림을 버린다(다시 열면 처음부터)', async () => {
    const w = await open()
    await tids('se-history-screen')[0].trigger('click')
    await w.setProps({ modelValue: false })
    const gate = defer()
    api.history.mockImplementation(() => gate.promise)
    await w.setProps({ modelValue: true })
    await flushPromises()
    expect(tid('se-history-zoom').exists()).toBe(false)
    expect(tids('se-history-step')).toHaveLength(0)
    expect(tid('se-history-state').text()).toBe(MESSAGES.SEW_SNAP_HISTORY_LOADING)
  })
})

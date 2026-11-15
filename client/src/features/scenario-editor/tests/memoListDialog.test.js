// 메모 목록 창 — 거르기, 그 스냅샷으로 가기 (P3 설계 §4.5, SE-016)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises, enableAutoUnmount, DOMWrapper } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

const api = vi.hoisted(() => ({ equipment: vi.fn(), snapshotDays: vi.fn(), snapshots: vi.fn(), snapshotImage: vi.fn(), memos: vi.fn() }))
vi.mock('../api', async (importOriginal) => ({ ...(await importOriginal()), scenarioEditorApi: api }))
import MemoListDialog from '../components/snapshot/MemoListDialog.vue'
import { useSnapshotStore } from '../stores/snapshotStore'
import { MESSAGES } from '../messages'

enableAutoUnmount(afterEach)
const ok = (data) => Promise.resolve({ data: { data } })
const defer = () => { let resolve; const promise = new Promise((res) => { resolve = res }); return { promise, resolve } }
const fail = (status, code) => ({ response: { status, data: { code } } })
const row = (eqpId, process, model, n, author, authorName, text, more = {}) => ({
  eqpId, process, model, fileName: `${n}_[1][2].png`, date: '2026-11-11', time: '09:13:02', daysLeft: 15,
  memo: { text, author, authorName, writtenAt: '2026-11-11 10:02', editedBy: null, editedAt: null }, ...more
})
const ITEMS = [
  row('SEWT_PHOTO_A01', 'SEWPHOTO', 'SEWMODELA', 30, 'kim', '김철수', '알람 창이 가려짐'),
  row('SEWT_CVD_A01', 'SEWCVD', 'SEWMODELA', 20, 'lee', '이영희', '확인 버튼 위치 다름', { date: '2026-11-09', time: '14:00:31' }),
  row('SEWT_CVD_B01', 'SEWCVD', 'SEWMODELB', 10, 'kim', '김철수', '야간 재발', { date: '2026-10-29', time: '03:41:10', daysLeft: 2 })
]
const body = () => new DOMWrapper(document.body)
const tid = (id) => body().find(`[data-testid="${id}"]`)
const tids = (id) => body().findAll(`[data-testid="${id}"]`)
const rowsText = () => tids('se-memo-list-row').map((r) => r.findAll('td').map((c) => c.text()))
const optionsOf = (id) => tid(id).findAll('option').map((o) => o.element.value)

describe('MemoListDialog', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    document.body.innerHTML = ''
    Object.values(api).forEach((f) => f.mockReset())
    api.memos.mockImplementation(() => ok({ items: ITEMS, truncated: false }))
    api.snapshotDays.mockImplementation((eqpId) => ok({ eqpId, latest: '2026-11-11', today: '2026-11-11', oldest: '2026-10-27', days: null, truncated: false }))
    api.snapshots.mockImplementation((eqpId, date) => ok({ eqpId, date, timeDiff: 0, items: [], skipped: 0, truncated: false }))
  })
  afterEach(() => vi.restoreAllMocks())

  const open = async (me = 'kim') => {
    const w = mount(MemoListDialog, { props: { modelValue: true, me }, attachTo: document.body })
    await flushPromises()
    return w
  }
  const closed = (w) => (w.emitted('update:modelValue') ?? []).some((e) => e[0] === false)

  it('열면 메모 목록을 받아 작성자·설비·스냅샷 시각·메모·쓴 때를 받은 순서대로 보인다', async () => {
    await open()
    expect(api.memos).toHaveBeenCalledTimes(1)
    expect(tid('se-memo-list').text()).toContain('메모 목록')
    expect(rowsText()).toEqual([
      ['김철수', 'SEWT_PHOTO_A01', '11-11 09:13:02', '알람 창이 가려짐', '11-11 10:02'],
      ['이영희', 'SEWT_CVD_A01', '11-09 14:00:31', '확인 버튼 위치 다름', '11-11 10:02'],
      ['김철수', 'SEWT_CVD_B01', '10-29 03:41:10 2일 뒤 삭제', '야간 재발', '11-11 10:02']
    ])
    expect(tid('se-memo-list-count').text()).toBe('3건')
    expect(tids('se-memo-list-expires')).toHaveLength(1)
  })
  it('작성자 이름이 없으면 아이디, 그것도 없으면 "다른 사람". 쓴 때가 없으면 빈 칸', async () => {
    api.memos.mockImplementation(() => ok({ items: [row('E', 'P', 'M', 1, 'ghost', '', '가'), row('E', 'P', 'M', 2, '', '', '나', { memo: { text: '나', author: '', authorName: '', writtenAt: null } })], truncated: false }))
    await open()
    expect(rowsText().map((r) => [r[0], r[4]])).toEqual([['ghost', '11-11 10:02'], ['다른 사람', '']])
  })
  it('거르기 항목은 목록에 있는 메모의 것만 — 공정을 고르면 모델·설비 항목과 줄이 좁혀진다', async () => {
    await open()
    expect(optionsOf('se-memo-list-process')).toEqual(['', 'SEWCVD', 'SEWPHOTO'])
    expect(optionsOf('se-memo-list-model')).toEqual(['', 'SEWMODELA', 'SEWMODELB'])
    expect(optionsOf('se-memo-list-eqp')).toEqual(['', 'SEWT_CVD_A01', 'SEWT_CVD_B01', 'SEWT_PHOTO_A01'])
    await tid('se-memo-list-process').setValue('SEWCVD')
    expect(optionsOf('se-memo-list-eqp')).toEqual(['', 'SEWT_CVD_A01', 'SEWT_CVD_B01'])
    expect(rowsText().map((r) => r[1])).toEqual(['SEWT_CVD_A01', 'SEWT_CVD_B01'])
    await tid('se-memo-list-model').setValue('SEWMODELB')
    expect(optionsOf('se-memo-list-eqp')).toEqual(['', 'SEWT_CVD_B01'])
    expect(tid('se-memo-list-count').text()).toBe('1건')
  })
  it('공정을 바꿔 그 공정에 없는 모델·설비가 되면 그 거르기를 푼다', async () => {
    await open()
    await tid('se-memo-list-process').setValue('SEWCVD')
    await tid('se-memo-list-model').setValue('SEWMODELB')
    await tid('se-memo-list-eqp').setValue('SEWT_CVD_B01')
    await tid('se-memo-list-process').setValue('SEWPHOTO')
    expect([tid('se-memo-list-model').element.value, tid('se-memo-list-eqp').element.value]).toEqual(['', ''])
    expect(rowsText().map((r) => r[1])).toEqual(['SEWT_PHOTO_A01'])
  })
  it('[내 메모만] 은 내가 쓴 메모만. 맞는 메모가 없으면 그 안내', async () => {
    await open('lee')
    await tid('se-memo-list-mine').setValue(true)
    expect(rowsText().map((r) => r[0])).toEqual(['이영희'])
    await tid('se-memo-list-process').setValue('SEWPHOTO')
    expect(tids('se-memo-list-row')).toHaveLength(0)
    expect(tid('se-memo-list-state').text()).toBe(MESSAGES.SEW_SNAP_MEMO_LIST_NONE)
  })
  it('줄을 고르고 [이 스냅샷으로 가기] — 창을 닫고 그 설비·그 날의 목록을 한 번 받는다', async () => {
    const w = await open()
    expect(tid('se-memo-list-go').attributes('disabled')).toBeDefined()
    await tids('se-memo-list-row')[1].trigger('click')
    expect(tids('se-memo-list-row')[1].attributes('aria-selected')).toBe('true')
    expect(tid('se-memo-list-go').attributes('disabled')).toBeUndefined()
    await tid('se-memo-list-go').trigger('click')
    await flushPromises()
    expect(closed(w)).toBe(true)
    expect(api.snapshots.mock.calls).toEqual([['SEWT_CVD_A01', '2026-11-09']])
    const s = useSnapshotStore()
    expect([s.eqpId, s.date, s.filter]).toEqual(['SEWT_CVD_A01', '2026-11-09', 'all'])
  })
  it('줄을 두 번 누르면 바로 간다', async () => {
    const w = await open()
    await tids('se-memo-list-row')[2].trigger('dblclick')
    await flushPromises()
    expect(closed(w)).toBe(true)
    expect(api.snapshots.mock.calls).toEqual([['SEWT_CVD_B01', '2026-10-29']])
  })
  it('고른 줄이 거르기로 사라지면 고르기를 푼다', async () => {
    await open()
    await tids('se-memo-list-row')[0].trigger('click')
    await tid('se-memo-list-process').setValue('SEWCVD')
    expect(tid('se-memo-list-go').attributes('disabled')).toBeDefined()
    expect(tids('se-memo-list-row').some((r) => r.attributes('aria-selected') === 'true')).toBe(false)
  })
  it('받는 중·받지 못함([다시 시도])·메모 없음', async () => {
    const pending = defer()
    api.memos.mockImplementation(() => pending.promise)
    await open()
    expect(tid('se-memo-list-state').text()).toBe(MESSAGES.SEW_SNAP_MEMO_LIST_LOADING)
    pending.resolve({ data: { data: { items: [], truncated: false } } })
    await flushPromises()
    expect(tid('se-memo-list-state').text()).toBe(MESSAGES.SEW_SNAP_MEMO_LIST_EMPTY)
    document.body.innerHTML = ''
    setActivePinia(createPinia())
    api.memos.mockImplementation(() => Promise.reject(fail(503, 'UPSTREAM_DOWN')))
    await open()
    expect(tid('se-memo-list-state').text()).toContain(MESSAGES.SEW_SNAP_MEMO_LIST_FAILED)
    api.memos.mockImplementation(() => ok({ items: ITEMS, truncated: false }))
    await tid('se-memo-list-retry').trigger('click')
    await flushPromises()
    expect(tids('se-memo-list-row')).toHaveLength(3)
  })
  it('서버가 한도에서 잘랐으면 알리고, 줄은 300건까지만 그리고 나머지 수를 알린다', async () => {
    const many = Array.from({ length: 320 }, (_, i) => row('SEWT_CVD_A01', 'SEWCVD', 'SEWMODELA', 1000 + i, 'kim', '김철수', `메모 ${i}`))
    api.memos.mockImplementation(() => ok({ items: many, truncated: true }))
    await open()
    expect(tids('se-memo-list-row')).toHaveLength(300)
    expect(tid('se-memo-list-more').text()).toBe('20건 더 있습니다. 거르기로 좁히세요.')
    expect(tid('se-memo-list-truncated').text()).toBe(MESSAGES.SEW_SNAP_MEMO_LIST_TRUNCATED)
    expect(tid('se-memo-list-count').text()).toBe('320건')
  })
  it('닫았다 다시 열면 다시 받고 고르기·거르기는 처음으로 돌아간다. [닫기] 는 닫기만', async () => {
    const w = await open()
    await tid('se-memo-list-process').setValue('SEWCVD')
    await tids('se-memo-list-row')[0].trigger('click')
    await tid('se-memo-list-close').trigger('click')
    expect(closed(w)).toBe(true)
    expect(api.snapshots).not.toHaveBeenCalled()
    await w.setProps({ modelValue: false })
    await w.setProps({ modelValue: true })
    await flushPromises()
    expect(api.memos).toHaveBeenCalledTimes(2)
    expect(tid('se-memo-list-process').element.value).toBe('')
    expect(tid('se-memo-list-go').attributes('disabled')).toBeDefined()
  })
})

// 메모 창 — 쓰기·고치기·지우기 확인, 글 규칙, 남의 메모, 충돌 (P3 설계 §4.4)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises, enableAutoUnmount, DOMWrapper } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

const api = vi.hoisted(() => ({ equipment: vi.fn(), snapshotDays: vi.fn(), snapshots: vi.fn(), snapshotImage: vi.fn(), saveMemo: vi.fn(), removeMemo: vi.fn() }))
vi.mock('../api', async (importOriginal) => ({ ...(await importOriginal()), scenarioEditorApi: api }))
import MemoDialog from '../components/snapshot/MemoDialog.vue'
import { useSnapshotStore } from '../stores/snapshotStore'
import { MESSAGES } from '../messages'

enableAutoUnmount(afterEach)
const ok = (data) => Promise.resolve({ data: { data } })
const defer = () => { let resolve; let reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej }); return { promise, resolve, reject } }
const fail = (status, code, details) => ({ response: { status, data: { code, details } } })
const memo = (text, author = 'kim', authorName = '김철수') => ({ text, author, authorName, writtenAt: '2026-11-11 09:14', editedBy: null, editedAt: null })
const click = (n, m = null) => ({ fileName: `${n}_[1][2].png`, ms: n, time: `09:13:0${n % 10}`, shift: 'DAY', kind: 'click', tag: null, x: 1, y: 2, txn: null, hasHistory: false, memo: m, daysLeft: 15 })
// 0 메모 없음 · 1 내 메모 · 2 남의 메모 · 3 작성자를 모르는 메모
const ITEMS = [click(10), click(11, memo('내 메모')), click(12, memo('남의 메모', 'lee', '이영희')), click(13, memo('누군가의 메모', '', ''))]
const name = (i) => ITEMS[i].fileName
const DAYS = { latest: '2026-11-11', today: '2026-11-11', oldest: '2026-10-27', days: null, truncated: false }
const body = () => new DOMWrapper(document.body)
const tid = (id) => body().find(`[data-testid="${id}"]`)

describe('MemoDialog', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    Object.values(api).forEach((f) => f.mockReset())
    api.snapshotDays.mockImplementation((eqpId) => ok({ eqpId, ...DAYS }))
    api.snapshots.mockImplementation((eqpId, date) => ok({ eqpId, date, timeDiff: 0, items: ITEMS, skipped: 0, truncated: false }))
    api.snapshotImage.mockImplementation(() => Promise.resolve({ data: new Blob(['x']) }))
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:x')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  const open = async (i, mode = 'edit', me = 'kim') => {
    const s = useSnapshotStore()
    await s.pickEquipment('SEWT_A01', { select: false })
    const w = mount(MemoDialog, { props: { modelValue: true, fileName: name(i), mode, me }, attachTo: document.body })
    await flushPromises()
    return { w, s }
  }
  const closed = (w) => (w.emitted('update:modelValue') ?? []).some((e) => e[0] === false)
  const type = async (text) => { await tid('se-memo-input').setValue(text) }

  it('새 메모: 제목에 설비·시각, 빈 칸에서 시작 — 저장하면 본 값 없이 보내고 닫는다', async () => {
    api.saveMemo.mockImplementation(() => ok({ memo: memo('새 메모') }))
    const { w, s } = await open(0)
    expect(tid('se-memo-dialog').text()).toContain('메모 — SEWT_A01 · 09:13:00')
    expect(tid('se-memo-input').element.value).toBe('')
    expect(tid('se-memo-others').exists()).toBe(false)
    await type('  새 메모 ')
    expect(tid('se-memo-count').text()).toBe('4 / 128자')
    await tid('se-memo-save').trigger('click')
    await flushPromises()
    expect(api.saveMemo).toHaveBeenCalledWith('SEWT_A01', name(0), '새 메모', null)
    expect(closed(w)).toBe(true)
    expect(s.list.items[0].memo.text).toBe('새 메모')
  })
  it('있던 메모: 칸에 그 글이 있고, 내 메모면 남의 메모 문구가 없다', async () => {
    await open(1)
    expect(tid('se-memo-input').element.value).toBe('내 메모')
    expect(tid('se-memo-others').exists()).toBe(false)
    expect(tid('se-memo-dialog').text()).toContain('비우고 저장하면 지웁니다')
  })
  it('남의 메모면 "○○ 님이 쓴 메모입니다. 고치면 그 메모가 바뀝니다." — 작성자를 모르면 "다른 사람"', async () => {
    await open(2)
    expect(tid('se-memo-others').text()).toBe('이영희 님이 쓴 메모입니다. 고치면 그 메모가 바뀝니다.')
    document.body.innerHTML = ''
    await open(3)
    expect(tid('se-memo-others').text()).toBe('다른 사람 님이 쓴 메모입니다. 고치면 그 메모가 바뀝니다.')
  })
  it('작은따옴표·128자 넘음은 칸 아래에 알리고 [저장] 을 막는다', async () => {
    await open(0)
    await type("it's")
    expect(tid('se-memo-problem').text()).toBe(MESSAGES.SEW_ERR_MEMO_QUOTE)
    expect(tid('se-memo-save').attributes('disabled')).toBeDefined()
    await type('가'.repeat(129))
    expect(tid('se-memo-problem').text()).toBe(MESSAGES.SEW_ERR_MEMO_TOO_LONG)
    expect(tid('se-memo-count').text()).toBe('129 / 128자')
    await type('가'.repeat(128))
    expect(tid('se-memo-problem').exists()).toBe(false)
    expect(tid('se-memo-save').attributes('disabled')).toBeUndefined()
  })
  it('새 메모를 빈 채 저장하거나, 있던 메모를 그대로 저장하면 서버를 부르지 않고 닫는다', async () => {
    const a = await open(0)
    await type('   ')
    await tid('se-memo-save').trigger('click')
    expect(closed(a.w)).toBe(true)
    document.body.innerHTML = ''
    const b = await open(1)
    await type(' 내 메모 ')
    await tid('se-memo-save').trigger('click')
    expect(closed(b.w)).toBe(true)
    expect(api.saveMemo).not.toHaveBeenCalled()
  })
  it('있던 메모를 비우고 저장하면 지울지 묻는다 — [돌아가기] 는 고치기로, [지우기] 는 지우고 닫는다', async () => {
    api.removeMemo.mockImplementation(() => ok({ removed: true, memo: null }))
    const { w, s } = await open(1)
    await type('')
    await tid('se-memo-save').trigger('click')
    expect(tid('se-memo-confirm').text()).toContain('이 메모를 지울까요?')
    expect(tid('se-memo-confirm').text()).toContain('내 메모')
    expect(api.removeMemo).not.toHaveBeenCalled()
    await tid('se-memo-back').trigger('click')
    expect(tid('se-memo-input').exists()).toBe(true)
    await tid('se-memo-save').trigger('click')
    await tid('se-memo-delete').trigger('click')
    await flushPromises()
    expect(api.removeMemo).toHaveBeenCalledWith('SEWT_A01', name(1), '내 메모')
    expect(closed(w)).toBe(true)
    expect(s.list.items[1].memo).toBeNull()
  })
  it('지우기로 열면 바로 묻는다 — 남의 메모면 작성자를 함께 보이고, [취소] 는 닫기만 한다', async () => {
    const { w } = await open(2, 'delete')
    expect(tid('se-memo-input').exists()).toBe(false)
    expect(tid('se-memo-confirm').text()).toContain('남의 메모')
    expect(tid('se-memo-others').text()).toBe('이영희 님이 쓴 메모입니다.')
    expect(tid('se-memo-back').exists()).toBe(false)
    await tid('se-memo-cancel').trigger('click')
    expect(closed(w)).toBe(true)
    expect(api.removeMemo).not.toHaveBeenCalled()
  })
  it('그 사이 메모가 바뀌었으면(409) 닫지 않고 지금 내용을 보인다 — 다시 저장하면 그 내용을 본 것으로 보낸다', async () => {
    api.saveMemo.mockImplementationOnce(() => Promise.reject(fail(409, 'MEMO_CONFLICT', { current: memo('남이 바꾼 글', 'lee', '이영희') })))
    const { w } = await open(1)
    await type('내가 고친 글')
    await tid('se-memo-save').trigger('click')
    await flushPromises()
    expect(closed(w)).toBe(false)
    expect(tid('se-memo-conflict').text()).toContain(MESSAGES.SEW_ERR_MEMO_CONFLICT)
    expect(tid('se-memo-conflict').text()).toContain('지금 내용: 남이 바꾼 글 — 이영희')
    expect(tid('se-memo-input').element.value).toBe('내가 고친 글') // 내가 친 글은 그대로
    expect(tid('se-memo-others').exists()).toBe(true) // 이제 남의 메모다
    api.saveMemo.mockImplementation(() => ok({ memo: memo('내가 고친 글', 'lee', '이영희') }))
    await tid('se-memo-save').trigger('click')
    await flushPromises()
    expect(api.saveMemo).toHaveBeenLastCalledWith('SEWT_A01', name(1), '내가 고친 글', '남이 바꾼 글')
    expect(closed(w)).toBe(true)
  })
  it('그 사이 지워졌으면 "지금은 메모가 없습니다" — 다시 저장하면 새 메모로 보낸다', async () => {
    api.saveMemo.mockImplementationOnce(() => Promise.reject(fail(409, 'MEMO_CONFLICT', { current: null })))
    await open(1)
    await type('내가 고친 글')
    await tid('se-memo-save').trigger('click')
    await flushPromises()
    expect(tid('se-memo-conflict').text()).toContain('지금은 메모가 없습니다')
    api.saveMemo.mockImplementation(() => ok({ memo: memo('내가 고친 글') }))
    await tid('se-memo-save').trigger('click')
    await flushPromises()
    expect(api.saveMemo).toHaveBeenLastCalledWith('SEWT_A01', name(1), '내가 고친 글', null)
  })
  it('지우는데 그 사이 바뀌었으면 지금 내용을 보이고 다시 묻는다. 이미 없으면 알리고 닫는다', async () => {
    api.removeMemo.mockImplementationOnce(() => Promise.reject(fail(409, 'MEMO_CONFLICT', { current: memo('남이 바꾼 글', 'lee', '이영희') })))
    const { w, s } = await open(1, 'delete')
    await tid('se-memo-delete').trigger('click')
    await flushPromises()
    expect(closed(w)).toBe(false)
    expect(tid('se-memo-conflict').text()).toContain('지금 내용: 남이 바꾼 글 — 이영희')
    api.removeMemo.mockImplementation(() => Promise.reject(fail(404, 'MEMO_GONE')))
    await tid('se-memo-delete').trigger('click')
    await flushPromises()
    expect(closed(w)).toBe(true)
    expect(s.notice).toBe(MESSAGES.SEW_ERR_MEMO_GONE)
    expect(s.list.items[1].memo).toBeNull()
  })
  it('그 밖의 실패는 문구를 보이고 닫지 않는다. 저장하는 동안에는 단추가 잠긴다', async () => {
    const pending = defer()
    api.saveMemo.mockImplementation(() => pending.promise)
    const { w } = await open(0)
    await type('글')
    await tid('se-memo-save').trigger('click')
    expect(tid('se-memo-save').attributes('disabled')).toBeDefined()
    expect(tid('se-memo-cancel').attributes('disabled')).toBeDefined()
    await tid('se-memo-input').trigger('keydown', { key: 'Escape' })
    expect(closed(w)).toBe(false) // 저장하는 동안에는 닫지 않는다
    pending.reject(fail(503, 'UPSTREAM_DOWN'))
    await flushPromises()
    expect(tid('se-memo-error').text()).not.toBe('')
    expect(closed(w)).toBe(false)
    expect(tid('se-memo-save').attributes('disabled')).toBeUndefined()
  })
  it('Enter 는 저장, Esc 는 취소', async () => {
    api.saveMemo.mockImplementation(() => ok({ memo: memo('글') }))
    const a = await open(0)
    await type('글')
    await tid('se-memo-input').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(api.saveMemo).toHaveBeenCalledTimes(1)
    expect(closed(a.w)).toBe(true)
    document.body.innerHTML = ''
    const b = await open(0)
    await type('버릴 글')
    await tid('se-memo-input').trigger('keydown', { key: 'Escape' })
    expect(closed(b.w)).toBe(true)
    expect(api.saveMemo).toHaveBeenCalledTimes(1)
  })
  it('한글 조합 중의 Enter 는 저장하지 않는다', async () => {
    await open(0)
    await type('글')
    await tid('se-memo-input').trigger('keydown', { key: 'Enter', isComposing: true })
    expect(api.saveMemo).not.toHaveBeenCalled()
  })
  it('닫혀 있으면 아무것도 그리지 않는다', async () => {
    const s = useSnapshotStore()
    await s.pickEquipment('SEWT_A01', { select: false })
    mount(MemoDialog, { props: { modelValue: false, fileName: name(0), mode: 'edit', me: 'kim' }, attachTo: document.body })
    expect(tid('se-memo-dialog').exists()).toBe(false)
  })
})

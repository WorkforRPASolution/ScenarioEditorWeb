// 스냅샷 저장소 — 설비·날짜·목록·고르기·그림 받기, 마지막 요청만 반영 (P3 설계 §4.2·§4.3, DC-034·035·076·077)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'
import { isReactive } from 'vue'

const api = vi.hoisted(() => ({ equipment: vi.fn(), snapshotDays: vi.fn(), snapshots: vi.fn(), snapshotImage: vi.fn() }))
vi.mock('../api', async (importOriginal) => ({ ...(await importOriginal()), scenarioEditorApi: api }))
import { useSnapshotStore } from '../stores/snapshotStore'
import { MESSAGES } from '../messages'

const ok = (data) => Promise.resolve({ data: { data } })
const defer = () => { let resolve; let reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej }); return { promise, resolve, reject } }
const fail = (status, code) => ({ response: { status, data: { code } } })
const blobFail = (status, code) => ({ response: { status, data: new Blob([JSON.stringify({ success: false, code })], { type: 'application/json' }) } })

const EQP = [{ eqpId: 'A', process: 'P1', model: 'M1', line: 'L' }, { eqpId: 'B', process: 'P1', model: 'M2', line: 'L' }]
const click = (n) => ({ fileName: `${n}_[1][2].png`, ms: n, time: '09:00:00', shift: 'DAY', kind: 'click', tag: null, x: 1, y: 2, txn: null, hasHistory: false, memo: null, daysLeft: 15 })
const tag = (n) => ({ fileName: `${n}_[9999][${n}].png`, ms: n, time: '09:00:00', shift: 'DAY', kind: 'tag', tag: 'start', x: null, y: null, txn: String(n), hasHistory: false, memo: null, daysLeft: 15 })
// 0 클릭 · 1 태그 · 2 클릭 · 3 클릭 · 4 태그 · 5 클릭
const ITEMS = [click(10), tag(11), click(12), click(13), tag(14), click(15)]
const name = (i) => ITEMS[i].fileName
const DAYS = { latest: '2026-11-11', today: '2026-11-11', oldest: '2026-10-27', days: null, truncated: false }
const listOf = (eqpId, date, items = ITEMS, more = {}) => ({ eqpId, date, timeDiff: 0, items, skipped: 0, truncated: false, ...more })

describe('snapshotStore', () => {
  let urls
  let revoked
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    Object.values(api).forEach((f) => f.mockReset())
    api.equipment.mockImplementation(() => ok({ items: EQP }))
    api.snapshotDays.mockImplementation((eqpId) => ok({ eqpId, ...DAYS }))
    api.snapshots.mockImplementation((eqpId, date) => ok(listOf(eqpId, date)))
    api.snapshotImage.mockImplementation((eqpId, fileName) => Promise.resolve({ data: new Blob([fileName]) }))
    urls = 0
    revoked = []
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:${++urls}`)
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((u) => { revoked.push(u) })
  })
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

  // 설비 A 를 고르지 않고(선택 없이) 목록까지 받은 저장소
  const ready = async (id = 'A') => {
    const s = useSnapshotStore()
    await s.setOpen(true)
    await s.pickEquipment(id, { select: false })
    return s
  }

  describe('되살리기·펼치기', () => {
    it('저장 값이 없으면 접힌 채이고 서버를 부르지 않는다', async () => {
      const s = useSnapshotStore()
      await s.restore()
      expect(s.open).toBe(false)
      expect(api.equipment).not.toHaveBeenCalled()
    })
    it('펼친 채 기억한 설비가 목록에 있으면 그 설비의 가장 늦은 날 목록을 받되 고르지 않는다 — 큰 화면은 스텝 그림 그대로', async () => {
      localStorage.setItem('se-snapshot', JSON.stringify({ open: true, eqpId: 'A' }))
      const s = useSnapshotStore()
      await s.restore()
      expect(s.open).toBe(true)
      expect(s.eqpId).toBe('A')
      expect(s.date).toBe('2026-11-11')
      expect(s.list.items).toHaveLength(6)
      expect(s.selectedName).toBeNull()
      expect(s.mode).toBe('step')
      expect(api.snapshotImage).not.toHaveBeenCalled()
    })
    it('기억한 설비가 이제 내 범위에 없으면 조용히 버리고 저장 값에서도 지운다', async () => {
      localStorage.setItem('se-snapshot', JSON.stringify({ open: true, eqpId: 'GONE' }))
      const s = useSnapshotStore()
      await s.restore()
      expect(s.eqpId).toBeNull()
      expect(api.snapshotDays).not.toHaveBeenCalled()
      expect(JSON.parse(localStorage.getItem('se-snapshot'))).toEqual({ open: true, eqpId: null })
    })
    it('접힌 채 기억한 설비는 서버를 부르지 않고, 패널을 펼칠 때 되살린다', async () => {
      localStorage.setItem('se-snapshot', JSON.stringify({ open: false, eqpId: 'B' }))
      const s = useSnapshotStore()
      await s.restore()
      expect(api.equipment).not.toHaveBeenCalled()
      await s.setOpen(true)
      expect(s.eqpId).toBe('B')
      expect(s.selectedName).toBeNull()
      expect(JSON.parse(localStorage.getItem('se-snapshot'))).toEqual({ open: true, eqpId: 'B' })
    })
    it('깨진 저장 값·모양이 다른 값은 기본값으로 시작한다', async () => {
      for (const raw of ['{broken', '"x"', JSON.stringify({ open: 'yes', eqpId: 7 }), 'null']) {
        setActivePinia(createPinia())
        localStorage.setItem('se-snapshot', raw)
        const s = useSnapshotStore()
        await s.restore()
        expect(s.open, raw).toBe(false)
        expect(s.eqpId, raw).toBeNull()
      }
    })
    it('처음 펼칠 때 설비 목록을 한 번만 받는다. 접어도 기억한다', async () => {
      const s = useSnapshotStore()
      await s.setOpen(true)
      expect(s.equipment).toMatchObject({ status: 'ready', items: EQP })
      await s.setOpen(false)
      await s.setOpen(true)
      expect(api.equipment).toHaveBeenCalledTimes(1)
      expect(JSON.parse(localStorage.getItem('se-snapshot')).open).toBe(true)
    })
    it('설비 목록을 받지 못하면 그 문구, 다시 받으면 된다', async () => {
      api.equipment.mockImplementationOnce(() => Promise.reject(fail(503, 'UPSTREAM_DOWN')))
      const s = useSnapshotStore()
      await s.setOpen(true)
      expect(s.equipment).toMatchObject({ status: 'error', error: MESSAGES.SEW_ERR_UPSTREAM_DOWN })
      await s.loadEquipment()
      expect(s.equipment.status).toBe('ready')
    })
  })

  describe('설비 고르기', () => {
    it('가장 늦은 날의 목록을 받아 마지막 줄을 고르고 큰 화면을 스냅샷으로 바꾼다', async () => {
      const s = useSnapshotStore()
      await s.pickEquipment('A')
      await flushPromises()
      expect(api.snapshotDays).toHaveBeenCalledWith('A')
      expect(api.snapshots).toHaveBeenCalledWith('A', '2026-11-11')
      expect(s.range).toEqual({ latest: '2026-11-11', today: '2026-11-11', oldest: '2026-10-27' })
      expect(s.selectedName).toBe(name(5))
      expect(s.mode).toBe('snapshot')
      expect(s.image).toMatchObject({ name: name(5), status: 'ready' })
      expect(JSON.parse(localStorage.getItem('se-snapshot')).eqpId).toBe('A')
    })
    it('보관 기간 안에 스냅샷이 없으면(latest null) 목록을 부르지 않고 빈 목록·날짜 없음', async () => {
      api.snapshotDays.mockImplementation((eqpId) => ok({ eqpId, ...DAYS, latest: null }))
      const s = useSnapshotStore()
      await s.pickEquipment('A')
      expect(api.snapshots).not.toHaveBeenCalled()
      expect(s.list).toMatchObject({ status: 'ready', items: [] })
      expect(s.date).toBeNull()
      expect(s.range.latest).toBeNull()
      expect(s.minDate).toBe('2026-10-27')
      expect(s.maxDate).toBe('2026-11-11')
    })
    it('설비 시계가 앞서 가장 늦은 날이 오늘보다 뒤면 달력 끝은 그 날이다', async () => {
      api.snapshotDays.mockImplementation((eqpId) => ok({ eqpId, ...DAYS, latest: '2026-11-12' }))
      const s = useSnapshotStore()
      await s.pickEquipment('A', { select: false })
      expect(s.maxDate).toBe('2026-11-12')
    })
    it('있는 날을 받지 못하면 목록 실패로 알린다 — code 마다 다른 문구', async () => {
      const s = useSnapshotStore()
      api.snapshotDays.mockImplementationOnce(() => Promise.reject(fail(503, 'SNAPSHOT_UNSET')))
      await s.pickEquipment('A')
      expect(s.list).toMatchObject({ status: 'error', error: MESSAGES.SEW_ERR_SNAPSHOT_UNSET })
      api.snapshotDays.mockImplementationOnce(() => Promise.reject(fail(403, 'EQP_FORBIDDEN')))
      await s.pickEquipment('B')
      expect(s.list.error).toBe(MESSAGES.SEW_ERR_EQP_FORBIDDEN)
    })
    it('설비를 바꾸면 고른 스냅샷·그림·달력·기억한 그림을 비운다(DC-035)', async () => {
      const s = useSnapshotStore()
      await s.pickEquipment('A')
      await flushPromises()
      await s.openCalendar()
      const held = urls
      expect(held).toBeGreaterThan(0)
      const gate = defer()
      api.snapshotDays.mockImplementationOnce(() => gate.promise)
      const p = s.pickEquipment('B', { select: false })
      // 답이 오기 전에 이미 비어 있다
      expect(s.selectedName).toBeNull()
      expect(s.image).toMatchObject({ name: null, status: 'idle', url: null })
      expect(s.list).toMatchObject({ status: 'loading', items: [] })
      expect(s.calendar.status).toBe('idle')
      expect(revoked).toHaveLength(held)
      gate.resolve({ data: { data: { eqpId: 'B', ...DAYS } } })
      await p
      expect(s.eqpId).toBe('B')
    })
  })

  describe('응답 경쟁 — 마지막 요청만 반영한다', () => {
    it('A 의 있는 날 답이 늦게 와도 그 뒤에 고른 B 의 목록이 남는다(DC-077)', async () => {
      const s = useSnapshotStore()
      const slow = defer()
      api.snapshotDays.mockImplementationOnce(() => slow.promise)
      const a = s.pickEquipment('A', { select: false })
      await s.pickEquipment('B', { select: false })
      slow.resolve({ data: { data: { eqpId: 'A', ...DAYS, latest: '2026-11-01' } } })
      await a
      expect(s.eqpId).toBe('B')
      expect(s.date).toBe('2026-11-11')
      expect(api.snapshots).toHaveBeenCalledTimes(1)
      expect(api.snapshots).toHaveBeenCalledWith('B', '2026-11-11')
    })
    it('A 의 목록 답이 늦게 와도 B 의 목록을 덮지 않는다', async () => {
      const s = useSnapshotStore()
      const slow = defer()
      api.snapshots.mockImplementationOnce(() => slow.promise)
      const a = s.pickEquipment('A', { select: false })
      await flushPromises()
      api.snapshots.mockImplementationOnce((eqpId, date) => ok(listOf(eqpId, date, [click(99)])))
      await s.pickEquipment('B', { select: false })
      slow.resolve({ data: { data: listOf('A', '2026-11-11') } })
      await a
      expect(s.list.items.map((i) => i.fileName)).toEqual([click(99).fileName])
    })
    it('날짜를 빠르게 넘기면 앞 날의 늦은 답은 버린다', async () => {
      const s = await ready()
      const slow = defer()
      api.snapshots.mockImplementationOnce(() => slow.promise)
      const first = s.moveDate(-1)
      api.snapshots.mockImplementationOnce((eqpId, date) => ok(listOf(eqpId, date, [click(77)])))
      await s.moveDate(-1)
      slow.resolve({ data: { data: listOf('A', '2026-11-10') } })
      await first
      expect(s.date).toBe('2026-11-09')
      expect(s.list.items.map((i) => i.fileName)).toEqual([click(77).fileName])
    })
    it('답에 적힌 설비·날짜가 요청과 다르면 반영하지 않는다', async () => {
      const s = await ready()
      api.snapshots.mockImplementationOnce(() => ok(listOf('A', '2026-01-01', [click(1)])))
      await s.setDate('2026-11-10')
      expect(s.list.items).toEqual([])
    })
    it('X 의 그림 답이 늦게 와도 그 뒤에 고른 Y 의 그림이 남고, X 요청은 끊는다(DC-034)', async () => {
      const s = await ready()
      const slowX = defer()
      let signalX = null
      api.snapshotImage.mockImplementationOnce((eqpId, fileName, signal) => { signalX = signal; return slowX.promise })
      s.select(name(0))
      expect(s.image).toMatchObject({ name: name(0), status: 'loading', url: null })
      s.select(name(4)) // 0 의 이웃이 아니다
      await flushPromises()
      expect(signalX.aborted).toBe(true)
      slowX.resolve({ data: new Blob(['x']) })
      await flushPromises()
      expect(s.selectedName).toBe(name(4))
      expect(s.image).toMatchObject({ name: name(4), status: 'ready' })
    })
    it('X 의 그림 실패가 늦게 와도 Y 의 그림을 지우지 않는다', async () => {
      const s = await ready()
      const slowX = defer()
      api.snapshotImage.mockImplementationOnce(() => slowX.promise)
      s.select(name(0))
      s.select(name(4))
      await flushPromises()
      slowX.reject(blobFail(404, 'SNAPSHOT_NOT_FOUND'))
      await flushPromises()
      expect(s.image).toMatchObject({ name: name(4), status: 'ready' })
    })
  })

  describe('날짜', () => {
    it('하루씩 옮기고, 날짜가 바뀌면 요청을 보낼 때 바로 고른 스냅샷·그림을 비운다(DC-035)', async () => {
      const s = await ready()
      s.select(name(2))
      await flushPromises()
      const gate = defer()
      api.snapshots.mockImplementationOnce(() => gate.promise)
      const p = s.moveDate(-1)
      expect(s.date).toBe('2026-11-10')
      expect(s.selectedName).toBeNull()
      expect(s.image).toMatchObject({ name: null, status: 'idle', url: null })
      expect(s.list).toMatchObject({ status: 'loading', items: [] })
      gate.resolve({ data: { data: listOf('A', '2026-11-10', [click(5)]) } })
      await p
      expect(s.list.items).toHaveLength(1)
      expect(s.selectedName).toBeNull() // 날짜를 옮겼을 때는 저절로 고르지 않는다
    })
    it('보관 기간 밖으로 가지 않는다', async () => {
      const s = await ready()
      await s.moveDate(1)
      expect(s.date).toBe('2026-11-11')
      await s.setDate('2026-01-01')
      expect(s.date).toBe('2026-10-27')
      await s.moveDate(-1)
      expect(s.date).toBe('2026-10-27')
      await s.setDate('abc')
      expect(s.date).toBe('2026-10-27')
    })
    it('같은 날짜를 다시 고르면 다시 받지 않는다', async () => {
      const s = await ready()
      const before = api.snapshots.mock.calls.length
      await s.setDate('2026-11-11')
      expect(api.snapshots.mock.calls.length).toBe(before)
    })
    it('설비를 고르기 전에는 아무것도 하지 않는다', async () => {
      const s = useSnapshotStore()
      await s.moveDate(-1)
      await s.setDate('2026-11-10')
      await s.refresh()
      await s.openCalendar()
      expect(api.snapshots).not.toHaveBeenCalled()
      expect(api.snapshotDays).not.toHaveBeenCalled()
    })
  })

  describe('목록', () => {
    it('조회 실패는 실패 상태와 문구, 성공인데 0건이면 빈 목록 — 둘을 구별한다', async () => {
      const s = await ready()
      api.snapshots.mockImplementationOnce(() => Promise.reject(fail(504, 'SNAPSHOT_TIMEOUT')))
      await s.setDate('2026-11-10')
      expect(s.list).toMatchObject({ status: 'error', items: [], error: MESSAGES.SEW_ERR_SNAPSHOT_TIMEOUT })
      api.snapshots.mockImplementationOnce((eqpId, date) => ok(listOf(eqpId, date, [])))
      await s.setDate('2026-11-09')
      expect(s.list).toMatchObject({ status: 'ready', items: [], error: '' })
    })
    it('서버가 5만 줄에서 멈췄다고 하면 알린다', async () => {
      api.snapshots.mockImplementation((eqpId, date) => ok(listOf(eqpId, date, ITEMS, { truncated: true })))
      const s = await ready()
      expect(s.list.truncated).toBe(true)
    })
    it('거르기: 태그만 보이고, 고른 줄이 태그가 아니면 선택을 비운다 — 태그면 둔다', async () => {
      const s = await ready()
      s.select(name(1))
      await flushPromises()
      s.setFilter('tag')
      expect(s.shown.map((i) => i.fileName)).toEqual([name(1), name(4)])
      expect(s.selectedName).toBe(name(1))
      expect(s.position).toBe(0)
      s.setFilter('all')
      s.select(name(2))
      s.setFilter('tag')
      expect(s.selectedName).toBeNull()
      expect(s.image.status).toBe('idle')
      s.setFilter('memo') // 모르는 값은 무시
      expect(s.filter).toBe('tag')
    })
    it('새로 고침: 있는 날과 목록을 다시 받고, 고른 줄이 새 목록에 있으면 지킨다 — 받는 동안 목록을 비우지 않는다', async () => {
      const s = await ready()
      s.select(name(2))
      await flushPromises()
      await s.openCalendar()
      const gate = defer()
      api.snapshots.mockImplementationOnce(() => gate.promise)
      const p = s.refresh()
      await flushPromises()
      expect(s.list).toMatchObject({ status: 'loading' })
      expect(s.list.items).toHaveLength(6)
      expect(s.selectedName).toBe(name(2))
      gate.resolve({ data: { data: listOf('A', '2026-11-11', [...ITEMS, click(16)]) } })
      await p
      expect(s.list.items).toHaveLength(7)
      expect(s.selectedName).toBe(name(2))
      expect(s.calendar.status).toBe('idle') // 날짜별 개수는 달력을 다시 열 때 받는다
    })
    it('새로 고침: 고른 줄이 사라졌으면 선택을 비운다', async () => {
      const s = await ready()
      s.select(name(2))
      await flushPromises()
      api.snapshots.mockImplementationOnce((eqpId, date) => ok(listOf(eqpId, date, [click(10)])))
      await s.refresh()
      expect(s.selectedName).toBeNull()
      expect(s.image.status).toBe('idle')
    })
    it('새로 고침: 보던 날이 그 사이 보관 기간 밖이 됐으면 가장 이른 날로 옮기고 선택·앞 목록을 버린다', async () => {
      const s = await ready()
      await s.setDate('2026-10-27')
      s.select(name(2))
      await flushPromises()
      api.snapshotDays.mockImplementationOnce((eqpId) => ok({ eqpId, ...DAYS, today: '2026-11-12', oldest: '2026-10-28' }))
      const gate = defer()
      api.snapshots.mockImplementationOnce(() => gate.promise)
      const p = s.refresh()
      await flushPromises()
      expect(s.date).toBe('2026-10-28')
      expect(s.selectedName).toBeNull()
      expect(s.list).toMatchObject({ status: 'loading', items: [] })
      gate.resolve({ data: { data: listOf('A', '2026-10-28', [click(3)]) } })
      await p
      expect(s.list.items).toHaveLength(1)
    })
    it('새로 고침: 스냅샷이 없던 설비에 새로 생겼으면 그 날을 연다', async () => {
      api.snapshotDays.mockImplementationOnce((eqpId) => ok({ eqpId, ...DAYS, latest: null }))
      const s = await ready()
      expect(s.date).toBeNull()
      await s.refresh()
      expect(s.date).toBe('2026-11-11')
      expect(s.list.items).toHaveLength(6)
    })
  })

  describe('고르기·이동', () => {
    it('고르면 큰 화면이 스냅샷으로 바뀌고 그림을 받는다. 목록에 없는 이름은 무시한다', async () => {
      const s = await ready()
      s.select('nope.png')
      expect(s.selectedName).toBeNull()
      s.select(name(2))
      expect(s.mode).toBe('snapshot')
      expect(s.selected).toMatchObject({ fileName: name(2) })
      await flushPromises()
      expect(api.snapshotImage).toHaveBeenCalledWith('A', name(2), expect.anything())
      expect(s.image).toMatchObject({ name: name(2), status: 'ready', url: expect.stringMatching(/^blob:/) })
    })
    it('받은 뒤 앞뒤 한 장씩 미리 받는다 — 같은 그림은 한 번만', async () => {
      const s = await ready()
      s.select(name(2))
      await flushPromises()
      const got = () => api.snapshotImage.mock.calls.map((c) => c[1]).sort()
      expect(got()).toEqual([name(1), name(2), name(3)].sort())
      s.select(name(3)) // 미리 받은 그림 — 다시 받지 않는다
      expect(s.image).toMatchObject({ name: name(3), status: 'ready' })
      await flushPromises()
      expect(got()).toEqual([name(1), name(2), name(3), name(4)].sort())
      s.select(name(2))
      await flushPromises()
      expect(api.snapshotImage).toHaveBeenCalledTimes(4)
    })
    it('이전·다음은 보이는(거른) 목록 안에서, 끝이면 그대로', async () => {
      const s = await ready()
      s.select(name(0))
      s.move(-1)
      expect(s.selectedName).toBe(name(0))
      s.move(1)
      expect(s.selectedName).toBe(name(1))
      s.setFilter('tag')
      s.move(1)
      expect(s.selectedName).toBe(name(4))
      s.move(1)
      expect(s.selectedName).toBe(name(4))
    })
    it('고른 것이 없을 때 다음은 첫 줄, 이전은 마지막 줄', async () => {
      const s = await ready()
      s.move(1)
      expect(s.selectedName).toBe(name(0))
      s.select(name(0))
      const t = await ready('B')
      t.move(-1)
      expect(t.selectedName).toBe(name(5))
    })
    it('태그 이동은 그 날 목록에서 찾고 끝에서 처음으로 돌아간다(DC-076)', async () => {
      const s = await ready()
      s.select(name(2))
      s.moveTag(1)
      expect(s.selectedName).toBe(name(4))
      s.moveTag(1)
      expect(s.selectedName).toBe(name(1))
      s.moveTag(-1)
      expect(s.selectedName).toBe(name(4))
    })
    it('태그가 하나도 없으면 알리고 선택은 그대로, 알림은 3초 뒤 사라진다', async () => {
      vi.useFakeTimers()
      api.snapshots.mockImplementation((eqpId, date) => ok(listOf(eqpId, date, [click(1), click(2)])))
      const s = await ready()
      s.select(click(1).fileName)
      s.moveTag(1)
      expect(s.notice).toBe('이 날에는 태그 스냅샷이 없습니다.')
      expect(s.selectedName).toBe(click(1).fileName)
      vi.advanceTimersByTime(3000)
      expect(s.notice).toBe('')
    })
    it('모드: 스텝 그림으로 갔다 와도 고른 스냅샷이 남는다', async () => {
      const s = await ready()
      s.select(name(2))
      s.showStep()
      expect(s.mode).toBe('step')
      expect(s.selectedName).toBe(name(2))
      s.showSnapshot()
      expect(s.mode).toBe('snapshot')
    })
  })

  describe('그림 실패 — 이유마다 다른 문구, 앞 그림이 남지 않는다', () => {
    it('목록에만 있고 그림이 없으면 SNAPSHOT_NOT_FOUND 문구', async () => {
      const s = await ready()
      s.select(name(0))
      await flushPromises()
      expect(s.image.status).toBe('ready')
      api.snapshotImage.mockImplementation((eqpId, fileName) => (fileName === name(3) ? Promise.reject(blobFail(404, 'SNAPSHOT_NOT_FOUND')) : Promise.resolve({ data: new Blob(['x']) })))
      s.select(name(3))
      expect(s.image).toMatchObject({ name: name(3), status: 'loading', url: null })
      await flushPromises()
      expect(s.image).toMatchObject({ name: name(3), status: 'error', url: null, code: 'SNAPSHOT_NOT_FOUND', error: MESSAGES.SEW_ERR_SNAPSHOT_NOT_FOUND })
    })
    it('저장소 응답 없음·주소 미설정은 각각 다른 문구', async () => {
      const s = await ready()
      api.snapshotImage.mockImplementation(() => Promise.reject(blobFail(503, 'SNAPSHOT_DOWN')))
      s.select(name(0))
      await flushPromises()
      expect(s.image).toMatchObject({ status: 'error', code: 'SNAPSHOT_DOWN', error: MESSAGES.SEW_ERR_SNAPSHOT_DOWN })
      api.snapshotImage.mockImplementation(() => Promise.reject(blobFail(503, 'SNAPSHOT_UNSET')))
      s.select(name(3))
      await flushPromises()
      expect(s.image).toMatchObject({ status: 'error', code: 'SNAPSHOT_UNSET', error: MESSAGES.SEW_ERR_SNAPSHOT_UNSET })
      expect(MESSAGES.SEW_ERR_SNAPSHOT_UNSET).not.toBe(MESSAGES.SEW_ERR_SNAPSHOT_DOWN)
      expect(MESSAGES.SEW_ERR_SNAPSHOT_NOT_FOUND).not.toBe(MESSAGES.SEW_ERR_SNAPSHOT_DOWN)
    })
    it('그림이 실패해도 목록·이동은 그대로 되고, 다시 고르면 다시 받는다', async () => {
      const s = await ready()
      api.snapshotImage.mockImplementationOnce(() => Promise.reject(blobFail(404, 'SNAPSHOT_NOT_FOUND')))
      s.select(name(0))
      await flushPromises()
      expect(s.image.status).toBe('error')
      s.move(1)
      await flushPromises()
      expect(s.image).toMatchObject({ name: name(1), status: 'ready' })
      s.move(-1)
      await flushPromises()
      expect(s.image).toMatchObject({ name: name(0), status: 'ready' })
    })
    it('미리 받기가 실패해도 화면에 아무것도 바뀌지 않는다', async () => {
      const s = await ready()
      api.snapshotImage.mockImplementation((eqpId, fileName) => (fileName === name(2) ? Promise.resolve({ data: new Blob(['x']) }) : Promise.reject(blobFail(404, 'SNAPSHOT_NOT_FOUND'))))
      s.select(name(2))
      await flushPromises()
      expect(s.image).toMatchObject({ name: name(2), status: 'ready' })
    })
  })

  describe('그림 기억', () => {
    it('여섯 장까지 기억하고, 넘치면 가장 오래 안 쓴 것부터 놓는다 — 고른 그림은 늘 가장 최근에 쓴 것이라 남는다', async () => {
      const many = Array.from({ length: 12 }, (_, i) => click(100 + i))
      api.snapshots.mockImplementation((eqpId, date) => ok(listOf(eqpId, date, many)))
      const s = await ready()
      s.select(many[0].fileName)
      await flushPromises() // 0·1 → blob:1, blob:2
      expect(revoked).toEqual([])
      for (let i = 1; i <= 6; i++) { s.select(many[i].fileName); await flushPromises() }
      // 0~7 여덟 장을 받았다 — 둘을 놓았고 지금 그림(6)은 살아 있다
      expect(urls).toBe(8)
      expect(revoked).toHaveLength(2)
      expect(revoked).not.toContain(s.image.url)
      expect(revoked).toContain('blob:1')
    })
  })

  describe('검토에서 더한 것(P3-B 최종 검토)', () => {
    it('이미 떠 있는 그림을 다시 고르면 그림 상태를 갈지 않는다(보는 쪽이 크기·점을 다시 지우지 않게)', async () => {
      const s = await ready()
      s.select(name(2))
      await flushPromises()
      const shown = s.image
      s.select(name(2))
      await flushPromises()
      expect(s.image).toBe(shown)
      expect(api.snapshotImage.mock.calls.filter((c) => c[1] === name(2))).toHaveLength(1)
    })
    it('그림을 받지 못한 줄을 다시 고르면 다시 받는다', async () => {
      const s = await ready()
      api.snapshotImage.mockImplementationOnce(() => Promise.reject(blobFail(503, 'SNAPSHOT_DOWN')))
      s.select(name(2))
      await flushPromises()
      expect(s.image.status).toBe('error')
      s.select(name(2))
      await flushPromises()
      expect(s.image).toMatchObject({ name: name(2), status: 'ready' })
    })
    it('설비를 바꾸면 진행 중인 그림 요청을 끊고, 그래도 뒤늦게 온 그림은 기억하지 않는다', async () => {
      const s = await ready()
      const slow = defer()
      let signal = null
      api.snapshotImage.mockImplementationOnce((eqpId, fileName, sg) => { signal = sg; return slow.promise })
      s.select(name(2))
      await s.pickEquipment('B', { select: false })
      expect(signal.aborted).toBe(true)
      const made = urls
      slow.resolve({ data: new Blob(['late']) })
      await flushPromises()
      expect(urls).toBe(made) // object URL 을 만들지 않는다 — 놓을 길이 없는 URL 이 남지 않게
      expect(s.image.status).toBe('idle')
    })
    it('새로 고침의 답이 늦게 와도 그 사이 고른 다른 설비의 상태를 덮지 않는다', async () => {
      const s = await ready()
      const slow = defer()
      api.snapshotDays.mockImplementationOnce(() => slow.promise)
      const p = s.refresh()
      await s.pickEquipment('B', { select: false })
      const calls = api.snapshots.mock.calls.length
      slow.resolve({ data: { data: { eqpId: 'A', ...DAYS, latest: '2026-11-01', today: '2026-11-01', oldest: '2026-10-17' } } })
      await p
      expect(s.eqpId).toBe('B')
      expect(s.range).toEqual({ latest: '2026-11-11', today: '2026-11-11', oldest: '2026-10-27' })
      expect(api.snapshots.mock.calls.length).toBe(calls)
    })
    it('[다시 시도]·[새로 고침] 을 누르면 있는 날을 기다리는 동안에도 받는 중이 된다(저장소가 죽어 있으면 10초쯤 걸린다)', async () => {
      const s = await ready()
      api.snapshots.mockImplementationOnce(() => Promise.reject(fail(503, 'SNAPSHOT_DOWN')))
      await s.setDate('2026-11-10')
      expect(s.list.status).toBe('error')
      const gate = defer()
      api.snapshotDays.mockImplementationOnce(() => gate.promise)
      const p = s.refresh()
      expect(s.list).toMatchObject({ status: 'loading', items: [], error: '' })
      gate.resolve({ data: { data: { eqpId: 'A', ...DAYS } } })
      await p
      expect(s.list.status).toBe('ready')
    })
    it('하루 목록의 줄은 깊은 반응형으로 감싸지 않는다 — 5만 줄에서 고르기·이동이 줄마다 프록시를 만들지 않게', async () => {
      const s = await ready()
      expect(isReactive(s.list.items[0])).toBe(false)
      // 설비 목록도 같다 — 10만 대를 깊은 반응형으로 감싸면 검색 칸에 칠 때마다 느리다
      expect(isReactive(s.equipment.items)).toBe(false)
      expect(isReactive(s.equipment.items[0])).toBe(false)
      expect(isReactive(s.selected ?? s.shown[0])).toBe(false)
    })
  })

  describe('달력', () => {
    it('열 때 날짜별 개수를 받는다 — 다시 열어도 다시 받지 않는다', async () => {
      const s = await ready()
      api.snapshotDays.mockImplementation((eqpId) => ok({ eqpId, ...DAYS, days: { '2026-11-10': 3, '2026-11-11': 20 }, truncated: true }))
      await s.openCalendar()
      expect(api.snapshotDays).toHaveBeenLastCalledWith('A', true)
      expect(s.calendar).toEqual({ status: 'ready', days: { '2026-11-10': 3, '2026-11-11': 20 }, truncated: true })
      const n = api.snapshotDays.mock.calls.length
      await s.openCalendar()
      expect(api.snapshotDays.mock.calls.length).toBe(n)
    })
    it('받지 못하면 실패 상태 — 다시 열면 다시 받는다. 목록은 그대로다', async () => {
      const s = await ready()
      api.snapshotDays.mockImplementationOnce(() => Promise.reject(fail(502, 'SNAPSHOT_FAILED')))
      await s.openCalendar()
      expect(s.calendar.status).toBe('error')
      expect(s.list.status).toBe('ready')
      await s.openCalendar()
      expect(s.calendar.status).toBe('ready')
    })
    it('설비를 바꾼 뒤에 온 앞 설비의 개수는 버린다', async () => {
      const s = await ready()
      const slow = defer()
      api.snapshotDays.mockImplementationOnce(() => slow.promise)
      const p = s.openCalendar()
      await s.pickEquipment('B', { select: false })
      slow.resolve({ data: { data: { eqpId: 'A', ...DAYS, days: { '2026-11-01': 9 } } } })
      await p
      expect(s.calendar).toMatchObject({ status: 'idle', days: null })
    })
  })
})

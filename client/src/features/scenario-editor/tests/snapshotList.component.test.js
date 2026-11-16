// 스냅샷 하루 목록 — 보이는 줄만 그리기·줄 모양·고르기·↑↓ (P3 설계 §4.2)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

const api = vi.hoisted(() => ({ equipment: vi.fn(), snapshotDays: vi.fn(), snapshots: vi.fn(), snapshotImage: vi.fn() }))
vi.mock('../api', async (importOriginal) => ({ ...(await importOriginal()), scenarioEditorApi: api }))
import SnapshotList from '../components/snapshot/SnapshotList.vue'
import { useSnapshotStore } from '../stores/snapshotStore'
import { scrollFor } from '../editor/snapshotList'

enableAutoUnmount(afterEach)
const ok = (data) => Promise.resolve({ data: { data } })
const item = (n, over = {}) => ({ fileName: `${n}_[1][2].png`, ms: n, time: '09:00:00', shift: 'DAY', kind: 'click', tag: null, x: 1, y: 2, txn: null, hasHistory: false, memo: null, daysLeft: 15, ...over })
const DAYS = { latest: '2026-11-11', today: '2026-11-11', oldest: '2026-10-27', days: null, truncated: false }
const ROW = 28

describe('SnapshotList', () => {
  let observers
  class FakeResizeObserver {
    constructor(cb) { this.cb = cb; this.disconnect = vi.fn(); observers.push(this) }
    observe() {}
    unobserve() {}
  }
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    observers = []
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    Object.values(api).forEach((f) => f.mockReset())
    api.equipment.mockImplementation(() => ok({ items: [{ eqpId: 'A', process: 'P', model: 'M', line: 'L' }] }))
    api.snapshotDays.mockImplementation((eqpId) => ok({ eqpId, ...DAYS }))
    api.snapshotImage.mockImplementation(() => Promise.resolve({ data: new Blob(['x']) }))
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:x')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  // 목록을 받은 저장소와, 높이를 정한 목록 부품(happy-dom 은 레이아웃이 없다)
  const mountList = async (items, height = 280) => {
    api.snapshots.mockImplementation((eqpId, date) => ok({ eqpId, date, timeDiff: 0, items, skipped: 0, truncated: false }))
    const s = useSnapshotStore()
    await s.pickEquipment('A', { select: false })
    const w = mount(SnapshotList, { attachTo: document.body })
    const el = w.find('[data-testid="se-snap-list"]').element
    Object.defineProperty(el, 'clientHeight', { get: () => height, configurable: true })
    observers.forEach((o) => o.cb([]))
    await flushPromises()
    return { w, s, el }
  }
  const rows = (w) => w.findAll('[data-testid="se-snap-row"]')
  const names = (w) => rows(w).map((r) => r.attributes('data-name'))

  it('하루 5만 줄이어도 그리는 줄은 화면에 보이는 만큼이다', async () => {
    const many = Array.from({ length: 50000 }, (_, i) => item(1000000 + i))
    const { w, el } = await mountList(many, 600)
    expect(rows(w).length).toBeLessThan(60)
    expect(rows(w).length).toBeGreaterThan(20)
    expect(names(w)[0]).toBe(many[0].fileName)
    // 가운데로 스크롤하면 그 둘레만
    el.scrollTop = 25000 * ROW
    await w.find('[data-testid="se-snap-list"]').trigger('scroll')
    expect(rows(w).length).toBeLessThan(60)
    expect(names(w)).toContain(many[25000].fileName)
    expect(names(w)).not.toContain(many[0].fileName)
    // 전체 높이는 줄 수만큼 — 스크롤 막대가 실제 길이를 보인다
    expect(w.find('[data-testid="se-snap-rows"]').attributes('style')).toContain(`height: ${50000 * ROW}px`)
  })
  it('줄: 시각·근무조, 태그는 알약, 3일 이하로 남으면 "n일 뒤 삭제"', async () => {
    const { w } = await mountList([
      item(1, { time: '05:59:59', shift: 'GY' }),
      item(2, { time: '10:00:00', shift: 'DAY', kind: 'tag', tag: 'fail', x: null, y: null, txn: '2' }),
      item(3, { time: '22:00:00', shift: 'GY', daysLeft: 2 }),
      item(4, { time: '23:00:00', shift: 'GY', daysLeft: 4 })
    ])
    const r = rows(w)
    expect(r[0].text()).toContain('05:59:59')
    expect(r[0].text()).toContain('GY')
    expect(r[0].find('[data-testid="se-snap-tag"]').exists()).toBe(false)
    expect(r[1].find('[data-testid="se-snap-tag"]').text()).toBe('실패')
    expect(r[1].find('[data-testid="se-snap-tag"]').classes()).toContain('se-snap-tag-fail')
    expect(r[2].find('[data-testid="se-snap-expires"]').text()).toBe('2일 뒤 삭제')
    expect(r[3].find('[data-testid="se-snap-expires"]').exists()).toBe(false)
  })
  it('메모가 있는 줄에는 ✎ 표시 — 올리면 메모 글이 보인다', async () => {
    const { w } = await mountList([item(1), item(2, { memo: { text: '알람 창이 가려짐', author: 'kim', authorName: '김' } }), item(3, { memo: { text: '', author: 'kim', authorName: '김' } })])
    const r = rows(w)
    expect(r[0].find('[data-testid="se-snap-memo-mark"]').exists()).toBe(false)
    const mark = r[1].find('[data-testid="se-snap-memo-mark"]')
    expect([mark.text(), mark.attributes('title'), mark.attributes('aria-label')]).toEqual(['✎', '알람 창이 가려짐', '메모'])
    expect(r[2].find('[data-testid="se-snap-memo-mark"]').exists()).toBe(true) // 빈 글 메모도 메모다
  })
  it('줄을 누르면 고르고, 고른 줄에 표시가 붙는다', async () => {
    const items = [item(1), item(2), item(3)]
    const { w, s } = await mountList(items)
    await rows(w)[1].trigger('click')
    expect(s.selectedName).toBe(items[1].fileName)
    expect(rows(w).map((r) => r.attributes('aria-selected'))).toEqual(['false', 'true', 'false'])
  })
  it('↑↓ 로 옮기고 Home·End 로 처음·끝', async () => {
    const items = [item(1), item(2), item(3), item(4)]
    const { w, s } = await mountList(items)
    const list = w.find('[data-testid="se-snap-list"]')
    await list.trigger('keydown', { key: 'ArrowDown' })
    expect(s.selectedName).toBe(items[0].fileName)
    await list.trigger('keydown', { key: 'ArrowDown' })
    expect(s.selectedName).toBe(items[1].fileName)
    await list.trigger('keydown', { key: 'ArrowUp' })
    expect(s.selectedName).toBe(items[0].fileName)
    await list.trigger('keydown', { key: 'End' })
    expect(s.selectedName).toBe(items[3].fileName)
    await list.trigger('keydown', { key: 'Home' })
    expect(s.selectedName).toBe(items[0].fileName)
  })
  it('화면 밖의 줄을 고르면(↑↓·태그 이동·이전·다음) 그 줄이 보이게 움직인다', async () => {
    const many = Array.from({ length: 500 }, (_, i) => item(1000 + i))
    const { w, s, el } = await mountList(many, 280)
    s.select(many[300].fileName)
    await flushPromises()
    expect(el.scrollTop).toBe(scrollFor(300, 0, 280, ROW))
    expect(names(w)).toContain(many[300].fileName)
    const at = el.scrollTop
    s.select(many[299].fileName) // 이미 보이는 줄 — 움직이지 않는다
    await flushPromises()
    expect(el.scrollTop).toBe(at)
    s.select(many[2].fileName)
    await flushPromises()
    expect(el.scrollTop).toBe(2 * ROW)
  })
  it('목록이 바뀌면 맨 위부터 보인다', async () => {
    const many = Array.from({ length: 500 }, (_, i) => item(1000 + i))
    const { w, s, el } = await mountList(many, 280)
    el.scrollTop = 5000
    await w.find('[data-testid="se-snap-list"]').trigger('scroll')
    api.snapshots.mockImplementation((eqpId, date) => ok({ eqpId, date, timeDiff: 0, items: [item(7), item(8)], skipped: 0, truncated: false }))
    await s.setDate('2026-11-10')
    await flushPromises()
    expect(el.scrollTop).toBe(0)
    expect(names(w)).toEqual([item(7).fileName, item(8).fileName])
  })
  describe('여러 줄 고르기 (P3-D)', () => {
    const five = [1, 2, 3, 4, 5].map((n) => item(n))
    const row = (w, n) => w.find(`[data-testid="se-snap-row"][data-name="${five[n].fileName}"]`)
    const selected = (w) => rows(w).filter((r) => r.attributes('aria-selected') === 'true').map((r) => r.attributes('data-name'))
    const current = (w) => rows(w).filter((r) => r.attributes('data-current') === 'true').map((r) => r.attributes('data-name'))

    it('Ctrl(⌘)+누르기는 더하고 빼고, Shift+누르기는 범위다 — 고른 줄과 큰 화면에 뜬 줄이 따로 표시된다', async () => {
      const { w, s } = await mountList(five)
      await row(w, 0).trigger('click')
      await row(w, 2).trigger('click', { ctrlKey: true })
      expect(selected(w)).toEqual([five[0].fileName, five[2].fileName])
      expect(current(w)).toEqual([five[2].fileName])
      await row(w, 4).trigger('click', { metaKey: true })
      expect([...s.picked].sort()).toEqual([five[0], five[2], five[4]].map((i) => i.fileName).sort())
      await row(w, 0).trigger('click', { ctrlKey: true })
      expect(selected(w)).toEqual([five[2].fileName, five[4].fileName])
      await row(w, 1).trigger('click', { shiftKey: true })
      expect(selected(w)).toEqual([five[1], five[2], five[3], five[4]].map((i) => i.fileName))
      expect(current(w)).toEqual([five[1].fileName])
      await row(w, 3).trigger('click')
      expect(selected(w)).toEqual([five[3].fileName])
    })

    it('Shift+↑↓ 는 범위를 늘리고, 그냥 ↑↓ 는 한 줄로 되돌린다', async () => {
      const { w, s } = await mountList(five)
      await row(w, 1).trigger('click')
      const list = w.find('[data-testid="se-snap-list"]')
      await list.trigger('keydown', { key: 'ArrowDown', shiftKey: true })
      await list.trigger('keydown', { key: 'ArrowDown', shiftKey: true })
      expect(selected(w)).toEqual([five[1], five[2], five[3]].map((i) => i.fileName))
      await list.trigger('keydown', { key: 'ArrowUp', shiftKey: true })
      expect(selected(w)).toEqual([five[1], five[2]].map((i) => i.fileName))
      await list.trigger('keydown', { key: 'ArrowDown' })
      expect(selected(w)).toEqual([five[3].fileName])
      expect(s.picked.size).toBe(1)
    })

    it('여러 줄을 고를 수 있다고 알린다(aria-multiselectable)', async () => {
      const { w } = await mountList(five)
      expect(w.find('[data-testid="se-snap-list"]').attributes('aria-multiselectable')).toBe('true')
    })
  })

  // 여러 날 목록(사내 요청 2026-11-16) — 날이 바뀌는 곳에 날짜 구분 줄
  describe('여러 날 — 날짜 구분 줄', () => {
    const dayItems = (date, base, n) => Array.from({ length: n }, (_, i) => item(base + i, { date }))
    const THREE = [...dayItems('2026-11-09', 1000, 20), ...dayItems('2026-11-10', 2000, 20), ...dayItems('2026-11-11', 3000, 20)]
    // 구분 줄 = 날짜 칸 + 줄 수 칸
    const heads = (w) => w.findAll('[data-testid="se-snap-day"]').map((h) => h.findAll('span').map((x) => x.text()).join(' '))
    const stick = (w) => w.find('[data-testid="se-snap-day-stick"]')

    it('날이 바뀌는 곳에 날짜·요일과 그 날 줄 수를 적은 구분 줄이 들어간다. 하루뿐이면 없다', async () => {
      const { w } = await mountList(THREE, 2000)
      expect(heads(w)).toEqual(['11-09 (월) 20장', '11-10 (화) 20장', '11-11 (수) 20장'])
      expect(rows(w)).toHaveLength(60)
      expect(w.find('[data-testid="se-snap-rows"]').attributes('style')).toContain(`height: ${63 * ROW}px`)
      w.unmount()
      const one = await mountList(dayItems('2026-11-11', 3000, 5), 2000)
      expect(heads(one.w)).toEqual([])
      expect(stick(one.w).exists()).toBe(false)
    })
    it('거르면 남은 줄로 다시 센다 — 줄이 없는 날의 구분 줄은 없다', async () => {
      const items = THREE.map((it, i) => (i === 3 || i === 45 ? { ...it, kind: 'tag', tag: 'start', txn: '1' } : it))
      const { w, s } = await mountList(items, 2000)
      s.setFilter('tag')
      await flushPromises()
      expect(heads(w)).toEqual(['11-09 (월) 1장', '11-11 (수) 1장'])
    })
    it('맨 위에는 지금 보는 줄의 날짜가 붙어 있다 — 스크롤하면 그 날로 바뀐다', async () => {
      const { w, el } = await mountList(THREE, 280)
      expect(stick(w).text()).toContain('11-09 (월)')
      expect(stick(w).text()).toContain('20장') // 구분 줄과 같은 내용이다(겹쳐도 줄 수가 가려지지 않게)
      el.scrollTop = 30 * ROW // 21(첫 날 구분 줄 + 20줄) 을 지나 둘째 날 안
      await w.find('[data-testid="se-snap-list"]').trigger('scroll')
      expect(stick(w).text()).toContain('11-10 (화)')
    })
    it('구분 줄이 있어도 화면 밖의 줄을 고르면 그 줄이 보이게 움직인다(구분 줄만큼 아래다)', async () => {
      const { s, el } = await mountList(THREE, 280)
      s.select(THREE[59].fileName)
      await flushPromises()
      expect(el.scrollTop).toBe(scrollFor(62, 0, 280, ROW)) // 60번째 줄 + 구분 줄 셋
      // 그 날의 첫 줄로 올라가면 구분 줄까지 보인다
      s.select(THREE[40].fileName)
      await flushPromises()
      expect(el.scrollTop).toBe(42 * ROW)
    })
    it('위로 옮길 때 고른 줄이 맨 위에 붙여 둔 날짜에 가려지지 않는다 — 그 바로 아래에 온다(독립 검토)', async () => {
      const { w, s, el } = await mountList(THREE, 280)
      s.select(THREE[59].fileName)
      await flushPromises()
      s.select(THREE[30].fileName) // 화면 자리 32(둘째 날 구분 줄이 21)
      await flushPromises()
      expect(el.scrollTop).toBe(31 * ROW)
      // 맨 처음 줄로 가면 맨 위로(첫 구분 줄이 보인다)
      s.select(THREE[0].fileName)
      await flushPromises()
      expect(el.scrollTop).toBe(0)
      expect(w.find('[data-testid="se-snap-day-stick"]').exists()).toBe(true)
    })
    it('여러 날을 고른 채면 줄이 하루치뿐이어도(거르기 등) 그 날의 구분 줄을 보인다 — 어느 날의 줄인지 알 수 있게(독립 검토)', async () => {
      api.snapshots.mockImplementation((eqpId, date, to) => ok({ eqpId, date, ...(to ? { to } : {}), timeDiff: 0, items: dayItems('2026-11-10', 2000, 3), skipped: 0, truncated: false }))
      const s = useSnapshotStore()
      await s.pickEquipment('A', { select: false })
      await s.setDates('2026-11-09', '2026-11-11')
      const w = mount(SnapshotList, { attachTo: document.body })
      await flushPromises()
      expect(heads(w)).toEqual(['11-10 (화) 3장'])
    })
  })
})

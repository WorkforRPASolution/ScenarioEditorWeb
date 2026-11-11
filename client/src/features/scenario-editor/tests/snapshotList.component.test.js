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
})

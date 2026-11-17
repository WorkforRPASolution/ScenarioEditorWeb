// 큰 화면 겹침(P4 설계 §4.2 "큰 화면") — 시험이 찾은 곳의 사각형·첫 결과의 누를 곳, 스냅샷 위의 검색 영역 테두리.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

const api = vi.hoisted(() => ({ equipment: vi.fn(), snapshotDays: vi.fn(), snapshots: vi.fn(), snapshotImage: vi.fn(), history: vi.fn() }))
vi.mock('../api', async (importOriginal) => ({ ...(await importOriginal()), scenarioEditorApi: api }))
import TestLayer from '../components/TestLayer.vue'
import SnapshotViewer from '../components/snapshot/SnapshotViewer.vue'
import { useVisionTestStore } from '../stores/visionTestStore'
import { useSnapshotStore } from '../stores/snapshotStore'
import { t } from '../messages'

const NAT = { w: 1000, h: 500 }
const done = (over = {}) => ({
  status: 'done', kind: 'image', key: 'k', valueKey: 'v', screen: 'base',
  results: [{ score: 0.97, x: 96, y: 150 }, { score: 0.93, x: 96, y: 206 }], train: { w: 255, h: 96 }, click: { x: 120, y: 162 },
  verdict: { ok: true, rule: null }, crop: { x: 10, y: 20, w: 300, h: 200 }, size: NAT, ms: 404, picked: 0, stale: false, ...over
})
const all = (w, id) => w.findAll(`[data-testid="${id}"]`)
const at = (w, id) => w.find(`[data-testid="${id}"]`)
const px = (el, k) => parseFloat(el.element.style[k])
const mountLayer = (props) => mount(TestLayer, { props: { natural: NAT, scale: 1, mode: 'step', ...props }, attachTo: document.body })

let store
beforeEach(() => {
  setActivePinia(createPinia())
  store = useVisionTestStore()
})

describe('TestLayer — 시험이 찾은 곳', () => {
  it('결과가 없으면 아무것도 그리지 않는다', () => {
    const w = mountLayer()
    expect(at(w, 'se-test-layer').exists()).toBe(false)
    w.unmount()
  })

  it('찾은 곳마다 찾을 그림 크기의 사각형(그림 픽셀 좌표)과 이름표, 첫 결과에 누를 곳 — 누름은 받지 않는다', async () => {
    const w = mountLayer()
    store.run = done()
    await w.vm.$nextTick()
    expect(at(w, 'se-test-layer').classes()).toContain('pointer-events-none')
    const hits = all(w, 'se-test-hit')
    expect(hits.map((h) => ['left', 'top', 'width', 'height'].map((k) => px(h, k)))).toEqual([[96, 150, 255, 96], [96, 206, 255, 96]])
    expect(hits.map((h) => h.text())).toEqual([t('SEW_TEST_TAG_FOUND', { n: 1 }), t('SEW_TEST_TAG_FOUND', { n: 2 })])
    const click = at(w, 'se-test-click')
    expect([click.attributes('data-x'), click.attributes('data-y')]).toEqual(['120', '162'])
    expect([px(click, 'left'), px(click, 'top')]).toEqual([120, 162])
    expect(click.attributes('title')).toBe(t('SEW_TEST_TAG_CLICK'))
    w.unmount()
  })

  it('큰 화면이 [누를 곳 보기] 의 점을 깜빡이는 동안(hideClick)에는 시험 결과의 누를 곳 점을 그리지 않는다 — 같은 자리에서 엇박으로 깜빡이지 않게', async () => {
    const w = mountLayer({ hideClick: true })
    store.run = done()
    await w.vm.$nextTick()
    expect(all(w, 'se-test-hit').length).toBe(2)
    expect(at(w, 'se-test-click').exists()).toBe(false)
    await w.setProps({ hideClick: false })
    expect(at(w, 'se-test-click').exists()).toBe(true)
    w.unmount()
  })

  it('고른 줄의 사각형은 굵게, 선 굵기·점 크기는 확대와 상관없이 화면에서 같다', async () => {
    const w = mountLayer({ scale: 2 })
    store.run = done({ picked: 1 })
    await w.vm.$nextTick()
    const hits = all(w, 'se-test-hit')
    expect(hits.map((h) => h.attributes('data-picked'))).toEqual(['false', 'true'])
    expect(hits.map((h) => px(h, 'borderWidth'))).toEqual([1, 2])
    expect(at(w, 'se-test-click').attributes('style')).toContain('scale(0.5)')
    await w.setProps({ scale: 0.5 })
    expect(all(w, 'se-test-hit').map((h) => px(h, 'borderWidth'))).toEqual([4, 8])
    w.unmount()
  })

  it('누를 곳이 없으면 점을 그리지 않는다. 값이 바뀐 결과는 흐리게', async () => {
    const w = mountLayer()
    store.run = done({ click: null, stale: true })
    await w.vm.$nextTick()
    expect(at(w, 'se-test-click').exists()).toBe(false)
    expect(at(w, 'se-test-layer').attributes('data-stale')).toBe('true')
    w.unmount()
  })

  it('시험한 화면의 모드에서만 그린다', async () => {
    const step = mountLayer({ mode: 'step' })
    const shot = mountLayer({ mode: 'snapshot' })
    store.run = done({ screen: 'snapshot' })
    await step.vm.$nextTick()
    expect(all(step, 'se-test-hit')).toHaveLength(0)
    expect(all(shot, 'se-test-hit')).toHaveLength(2)
    store.run = done({ screen: 'base' })
    await step.vm.$nextTick()
    expect(all(step, 'se-test-hit')).toHaveLength(2)
    expect(all(shot, 'se-test-hit')).toHaveLength(0)
    step.unmount(); shot.unmount()
  })
})

describe('TestLayer — 스냅샷 위의 검색 영역', () => {
  const input = { kind: 'image', area: { x: 500, y: 300, w: 300, h: 200 } }
  it('시험할 화면이 "지금 스냅샷" 인 동안 스냅샷 모드에 그 스텝의 영역 테두리를 그린다(결과가 없어도)', async () => {
    const w = mountLayer({ mode: 'snapshot' })
    store.setTarget(input)
    await w.vm.$nextTick()
    expect(at(w, 'se-test-area').exists()).toBe(false) // 시험할 화면이 기준 화면
    store.setScreen('snapshot')
    await w.vm.$nextTick()
    const area = at(w, 'se-test-area')
    expect(['left', 'top', 'width', 'height'].map((k) => px(area, k))).toEqual([500, 300, 300, 200])
    expect(area.attributes('data-kind')).toBe('image')
    expect(area.text()).toBe(t('SEW_TEST_TAG_AREA'))
    store.setTarget({ kind: 'ocr', area: { x: 1, y: 2, w: 30, h: 10 } })
    await w.vm.$nextTick()
    expect(at(w, 'se-test-area').attributes('data-kind')).toBe('ocr')
    store.setTarget(null)
    await w.vm.$nextTick()
    expect(at(w, 'se-test-area').exists()).toBe(false)
    w.unmount()
  })
  it('스텝 그림 모드에는 그리지 않는다(스텝 그림은 영역을 이미 그린다)', async () => {
    const w = mountLayer({ mode: 'step' })
    store.setTarget(input)
    store.setScreen('snapshot')
    await w.vm.$nextTick()
    expect(at(w, 'se-test-area').exists()).toBe(false)
    w.unmount()
  })
})

describe('스냅샷 보기에 붙는다', () => {
  const click = (n, x, y) => ({ fileName: `${n}_[${x}][${y}].png`, ms: n, time: '09:13:02', shift: 'DAY', kind: 'click', tag: null, x, y, txn: null, hasHistory: false, memo: null, daysLeft: 15 })
  const ITEMS = [click(10, 40, 50), click(11, 412, 288)]
  let observers
  class FakeResizeObserver {
    constructor(cb) { this.cb = cb; this.disconnect = vi.fn(); observers.push(this) }
    observe() {}
    unobserve() {}
  }
  beforeEach(() => {
    localStorage.clear()
    observers = []
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    Object.values(api).forEach((f) => f.mockReset())
    const ok = (data) => Promise.resolve({ data: { data } })
    api.equipment.mockImplementation(() => ok({ items: [{ eqpId: 'SEWT_A01', process: 'P', model: 'M', line: 'L' }] }))
    api.snapshotDays.mockImplementation((eqpId) => ok({ eqpId, latest: '2026-11-11', today: '2026-11-11', oldest: '2026-10-27', days: null, truncated: false }))
    api.snapshots.mockImplementation((eqpId, date) => ok({ eqpId, date, timeDiff: 0, items: ITEMS, skipped: 0, truncated: false }))
    api.snapshotImage.mockImplementation(() => Promise.resolve({ data: new Blob(['x']) }))
    let urls = 0
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:${++urls}`)
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('스냅샷으로 시험한 결과와 검색 영역을 스냅샷 그림 위에 그린다 — 그림이 그려진 뒤에만', async () => {
    const snap = useSnapshotStore()
    await snap.pickEquipment('SEWT_A01', { select: false })
    const w = mount(SnapshotViewer, { attachTo: document.body })
    store.setTarget({ kind: 'image', area: { x: 100, y: 80, w: 300, h: 200 } })
    store.setScreen('snapshot')
    store.run = done({ screen: 'snapshot' })
    snap.select(ITEMS[1].fileName); await flushPromises()
    expect(all(w, 'se-test-hit')).toHaveLength(0) // 그림 크기를 아직 모른다
    w.vm.onLoad({ target: { naturalWidth: 640, naturalHeight: 360 } }); await w.vm.$nextTick()
    expect(all(w, 'se-test-hit')).toHaveLength(2)
    expect(at(w, 'se-test-area').exists()).toBe(true)
    // 스냅샷 그림과 같은 변환 상자 안에 있다
    expect(at(w, 'se-test-layer').element.parentElement).toBe(at(w, 'se-snap-image').element.parentElement)
    expect(at(w, 'se-snap-dot').exists()).toBe(true) // 스냅샷의 클릭 점은 그대로
    w.unmount()
  })
})

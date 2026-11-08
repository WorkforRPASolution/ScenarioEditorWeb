import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, ref, nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
vi.mock('../api', () => ({ scenarioEditorApi: {}, imageUrl: (p) => `http://x/api${p}` }))
const fx = vi.hoisted(() => ({ loadBitmap: vi.fn(), imageDataOf: vi.fn(), locate: vi.fn() }))
vi.mock('../editor/images', async (orig) => ({ ...(await orig()), loadBitmap: fx.loadBitmap }))
vi.mock('../editor/crop', async (orig) => ({ ...(await orig()), imageDataOf: fx.imageDataOf }))
vi.mock('../editor/locate', () => ({ locate: fx.locate }))
import { useTrainSpot, SPOT_DELAY_MS } from '../composables/useTrainSpot'
import { useEditStore } from '../stores/editStore'
import { panelFixture, imageStep } from './panelFixture'

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const settle = async () => { await wait(SPOT_DELAY_MS + 10); await flushPromises() }
const url = (id) => `http://x/api/scenario-editor/scenarios/P/M/N/versions/1/files/F/images/${id}`

// 초점 스텝(source) 하나를 보는 화면 조각
function host(source) {
  let api
  const C = defineComponent({ setup() { api = useTrainSpot(source); return () => h('div') } })
  const w = mount(C)
  return { w, get: () => api }
}

describe('useTrainSpot — 초점 스텝의 찾을 그림 위치 보기', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    Object.values(fx).forEach((f) => f.mockReset())
    fx.loadBitmap.mockImplementation(async (u) => (u.includes('-train-') ? { width: 20, height: 10 } : { width: 1000, height: 500 }))
    fx.imageDataOf.mockImplementation((b) => ({ width: b.width, height: b.height, data: new Uint8ClampedArray(0) }))
    fx.locate.mockReturnValue({ found: 'one', x: 40, y: 50 })
  })
  afterEach(() => vi.restoreAllMocks())

  it('패널 초안: 잠깐 뒤 한 번 찾고, 결과로 썸네일 주변·큰 화면 표시·문구를 낸다', async () => {
    const { e } = panelFixture([imageStep(0), imageStep(1)])
    const { w, get } = host(() => ({ draft: e.panel.draft }))
    expect(get().input.value).toMatchObject({ baseUrl: url('s0-bi'), trainUrl: url('s0-train-0'), click: { x: 24, y: 12 } })
    expect(get().result.value).toBe(null)
    expect(get().note.value).toBe(null) // 찾는 중
    expect(fx.locate).not.toHaveBeenCalled() // 바로 찾지 않는다
    await settle()
    expect(fx.locate).toHaveBeenCalledTimes(1)
    expect(get().result.value).toMatchObject({ found: 'one', x: 40, y: 50, w: 20, h: 10 })
    expect(get().around.value).toEqual({ src: url('s0-bi'), x: 40, y: 50, bw: 1000, bh: 500 })
    expect(get().marks.value).toEqual({ train: { x: 40, y: 50, w: 20, h: 10 }, click: { x: 64, y: 62 } })
    expect(get().note.value).toBe('SEW_UI_SPOT_one')
    w.unmount()
  })
  it('누를 곳만 바꾸면 다시 찾지 않고 표시만 옮긴다', async () => {
    const { e } = panelFixture([imageStep(0)])
    const { w, get } = host(() => ({ draft: e.panel.draft }))
    await settle()
    e.updateDraft((d) => ({ ...d, action: { ...d.action, click: { x: 300, y: -5, basis: 'trainImage' } } }))
    await settle()
    expect(fx.locate).toHaveBeenCalledTimes(1)
    expect(get().marks.value.click).toEqual({ x: 340, y: 45 })
    w.unmount()
  })
  it('빨리 바뀌는 동안(스텝 넘기기·영역 끌기)은 찾지 않고 마지막 것만 찾는다', async () => {
    const step = ref(imageStep(0))
    const { w, get } = (panelFixture([imageStep(0), imageStep(1)]), host(() => ({ draft: step.value })))
    for (const x of [11, 12, 13]) {
      step.value = imageStep(0, { condition: { ...imageStep(0).condition, searchArea: { x, y: 20, w: 300, h: 200 } } })
      await nextTick()
      await wait(SPOT_DELAY_MS / 3)
    }
    step.value = imageStep(1)
    await settle()
    expect(fx.locate).toHaveBeenCalledTimes(1)
    expect(fx.loadBitmap).toHaveBeenCalledWith(url('s1-bi'))
    expect(get().input.value.baseUrl).toBe(url('s1-bi'))
    w.unmount()
  })
  it('찾는 사이 다른 스텝으로 가면 옛 결과는 지금 스텝에 붙지 않는다(키 대조)', async () => {
    const slow = { resolve: null }
    fx.loadBitmap.mockImplementation(async (u) => (u.includes('s0-train') ? new Promise((r) => { slow.resolve = r }) : u.includes('-train-') ? { width: 20, height: 10 } : { width: 1000, height: 500 }))
    fx.locate.mockImplementation((b, tr, area) => (area.x === 10 ? { found: 'one', x: 40, y: 50 } : { found: 'none' }))
    const { e } = panelFixture([imageStep(0), imageStep(1, { condition: { ...imageStep(1).condition, searchArea: { x: 99, y: 20, w: 300, h: 200 } } })])
    const { w, get } = host(() => ({ draft: e.panel.draft }))
    await settle() // 0번을 찾기 시작(찾을 그림을 받는 중)
    e.requestSelect('s1')
    await settle()
    expect(get().result.value).toEqual({ found: 'none' })
    slow.resolve({ width: 20, height: 10 })
    await flushPromises()
    expect(get().result.value).toEqual({ found: 'none' })
    expect(get().around.value).toBe(null)
    w.unmount()
  })
  it('이미 찾은 키는 기다리지 않고 바로, 화면을 닫으면 찾기 예약을 거둔다', async () => {
    const { e } = panelFixture([imageStep(0)])
    const a = host(() => ({ draft: e.panel.draft }))
    await settle()
    a.w.unmount()
    const b = host(() => ({ draft: e.panel.draft }))
    expect(b.get().result.value).toMatchObject({ found: 'one' })
    b.w.unmount()
    setActivePinia(createPinia())
    const f = panelFixture([imageStep(0)])
    const c = host(() => ({ draft: f.e.panel.draft }))
    c.w.unmount()
    await settle()
    expect(fx.locate).toHaveBeenCalledTimes(1) // 닫은 화면은 찾지 않는다
  })
  it('같은 시나리오를 다시 열면(세션이 바뀌어 캐시가 비면) 같은 키라도 다시 찾는다', async () => {
    const { e, s, skeleton } = panelFixture([imageStep(0)])
    const { w, get } = host(() => ({ draft: e.panel.draft }))
    await settle()
    e.begin(skeleton, s.me)
    e.syncFocus('s0')
    await settle()
    expect(fx.locate).toHaveBeenCalledTimes(2)
    expect(get().result.value).toMatchObject({ found: 'one' })
    w.unmount()
  })
  it('영역을 끄는 동안은 멈춰 있어도 찾지 않고, 놓으면 마지막 영역으로 한 번 찾는다', async () => {
    const { e } = panelFixture([imageStep(0)])
    const area = (x) => e.updateDraft((d) => ({ ...d, condition: { ...d.condition, searchArea: { x, y: 20, w: 300, h: 200 } } }))
    const { w } = host(() => ({ draft: e.panel.draft }))
    await settle()
    expect(fx.locate).toHaveBeenCalledTimes(1)
    e.setAreaDrag(true)
    for (const x of [11, 12, 13]) {
      area(x)
      await settle() // 기다림(150ms)보다 오래 멈춰도
    }
    expect(fx.locate).toHaveBeenCalledTimes(1)
    e.setAreaDrag(false)
    await settle()
    expect(fx.locate).toHaveBeenCalledTimes(2)
    expect(fx.locate.mock.calls[1][2]).toEqual({ x: 13, y: 20, w: 300, h: 200 })
    w.unmount()
  })
  it('새 영역을 찾기 전(끄는 중·찾는 중)에는 썸네일 주변은 앞 결과 그대로, 큰 화면 표시는 숨기고 — 새 결과가 오면 바꾼다', async () => {
    fx.locate.mockImplementation((b, tr, a) => ({ found: 'one', x: a.x === 12 ? 41 : 40, y: 50 }))
    const { e } = panelFixture([imageStep(0)])
    const area = (x) => e.updateDraft((d) => ({ ...d, condition: { ...d.condition, searchArea: { x, y: 20, w: 300, h: 200 } } }))
    const { w, get } = host(() => ({ draft: e.panel.draft }))
    await settle()
    const first = get().around.value
    expect(first).toMatchObject({ x: 40, y: 50 })
    e.setAreaDrag(true)
    area(11)
    await nextTick()
    expect(get().around.value).toEqual(first) // 썸네일은 그대로
    expect(get().note.value).toBe('SEW_UI_SPOT_one')
    expect(get().marks.value).toBe(null)
    area(10) // 끄는 중 처음 자리로 돌아와도 큰 화면은 놓을 때까지 숨긴다
    await nextTick()
    expect(get().marks.value).toBe(null)
    e.setAreaDrag(false)
    await nextTick()
    expect(get().marks.value).toMatchObject({ train: { x: 40, y: 50 } })
    area(12) // 끌지 않고 바뀐 새 영역(찾는 중)
    await nextTick()
    expect(get().marks.value).toBe(null)
    expect(get().around.value).toEqual(first)
    await settle()
    expect(get().around.value).toMatchObject({ x: 41, y: 50 })
    expect(get().marks.value).toMatchObject({ train: { x: 41, y: 50 } })
    w.unmount()
  })
  it('표시 스텝(읽기 전용)도 찾고, 찾을 수 없는 스텝은 찾지 않고 "저장되어 있지 않음"', async () => {
    const st = { uid: 's0', baseImage: { state: 'present', url: '/b' }, condition: { kind: 'image', searchArea: { x: 1, y: 2, w: 30, h: 40 }, image: { trainImages: [{ key: 0, url: '/t-train-0' }] } },
      action: { type: 1, click: { x: 50, y: 5, basis: 'trainImage' } } }
    const cur = ref(st)
    setActivePinia(createPinia())
    useEditStore()
    const { w, get } = host(() => ({ step: cur.value }))
    await settle()
    expect(fx.loadBitmap).toHaveBeenCalledWith('http://x/api/b')
    expect(get().marks.value).toEqual({ train: { x: 40, y: 50, w: 20, h: 10 }, click: { x: 90, y: 55 } })
    cur.value = { ...st, baseImage: { state: 'missing' } }
    await settle()
    expect(get().input.value).toBe(null)
    expect(get().note.value).toBe('SEW_UI_SPOT_NOT_STORED')
    expect(fx.locate).toHaveBeenCalledTimes(1)
    w.unmount()
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
vi.mock('../api', () => ({ scenarioEditorApi: {}, imageUrl: (p) => `http://x/api${p}` }))
// fetch·canvas 를 쓰는 부분은 가짜로(브라우저 확인은 Task 9 E2E)
const fx = vi.hoisted(() => ({ loadBitmap: vi.fn(), cropPng: vi.fn(), imageDataOf: vi.fn(), locate: vi.fn() }))
vi.mock('../editor/images', async (orig) => ({ ...(await orig()), loadBitmap: fx.loadBitmap }))
vi.mock('../editor/crop', async (orig) => ({ ...(await orig()), cropPng: fx.cropPng, imageDataOf: fx.imageDataOf }))
vi.mock('../editor/locate', () => ({ locate: fx.locate }))
import CaptureLayer from '../components/CaptureLayer.vue'
import StepViewer from '../components/StepViewer.vue'
import StepPanel from '../components/StepPanel.vue'
import EditDialogs from '../components/EditDialogs.vue'
import { useEditStore } from '../stores/editStore'
import { areaView } from '../editor/capture'
import { t } from '../messages'
import { panelFixture, imageStep, ocrStep, noneStep } from './panelFixture'

const NAT = { w: 1000, h: 500 }
const LAYER = '[data-testid="se-capture-layer"]'
const BASE = (i) => `http://x/api/scenario-editor/scenarios/P/M/N/versions/1/files/F/images/s${i}-bi`

// 잡기 층을 패널 초안과 함께 그린다(큰 화면이 하는 일 — 초안이 바뀌면 다시 그린다).
const Host = defineComponent({
  props: { scale: { type: Number, default: 1 } },
  setup(props) {
    const edit = useEditStore()
    return () => (edit.panel.draft ? h(CaptureLayer, { draft: edit.panel.draft, natural: NAT, scale: props.scale }) : null)
  }
})
const mountHost = (scale = 1) => mount(Host, { props: { scale }, attachTo: document.body })
// 그려진 자리(확대·이동)를 흉내 낸다: 화면 좌표 = 기준 화면 좌표 × scale + (left, top)
function place(w, { scale, left = 0, top = 0 }) {
  w.find(LAYER).element.getBoundingClientRect = () => ({ left, top, x: left, y: top, width: NAT.w * scale, height: NAT.h * scale, right: left + NAT.w * scale, bottom: top + NAT.h * scale })
}
async function drag(w, sel, from, to) {
  await w.find(sel).trigger('mousedown', { button: 0, clientX: from[0], clientY: from[1] })
  window.dispatchEvent(new MouseEvent('mousemove', { clientX: (from[0] + to[0]) / 2, clientY: (from[1] + to[1]) / 2 }))
  window.dispatchEvent(new MouseEvent('mousemove', { clientX: to[0], clientY: to[1] }))
  window.dispatchEvent(new MouseEvent('mouseup', { clientX: to[0], clientY: to[1] }))
  await flushPromises()
}
const esc = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  Object.values(fx).forEach((f) => f.mockReset())
  fx.loadBitmap.mockResolvedValue({ width: 1000, height: 500 })
  fx.cropPng.mockImplementation(async () => new Blob(['png'], { type: 'image/png' }))
  fx.imageDataOf.mockImplementation((b) => ({ width: b.width, height: b.height, data: new Uint8ClampedArray(0) }))
})
afterEach(() => { document.body.innerHTML = '' })

describe('CaptureLayer — 끌어 잡기(기준 화면 픽셀)', () => {
  it('끌기 좌표는 화면 확대·이동과 상관없이 기준 화면 좌표로 바뀐다(toImg)', async () => {
    for (const view of [{ scale: 2, left: 100, top: 50 }, { scale: 0.5, left: -20, top: 10 }, { scale: 1 }]) {
      setActivePinia(createPinia())
      const { e } = panelFixture([imageStep(0), imageStep(1)])
      e.startCapture(['area', 'train', 'click'])
      const w = mountHost(view.scale)
      place(w, view)
      const at = (x, y) => [x * view.scale + (view.left ?? 0), y * view.scale + (view.top ?? 0)]
      await drag(w, LAYER, at(200, 300), at(100, 100)) // 거꾸로 끌어도 같은 사각형
      expect(e.panel.draft.condition.searchArea, JSON.stringify(view)).toEqual({ x: 100, y: 100, w: 100, h: 200 })
      expect(e.capture.stage).toBe('train')
      w.unmount()
    }
  })
  it('끄는 동안 사각형을 그리고(살아 있는 값), 그림 밖으로 끌면 그림 안으로 자른다', async () => {
    const { e } = panelFixture([imageStep(0), imageStep(1)])
    e.startCapture(['area'])
    const w = mountHost(1)
    place(w, { scale: 1 })
    await w.find(LAYER).trigger('mousedown', { button: 0, clientX: 900, clientY: 400 })
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 1300, clientY: 700 }))
    await nextTick()
    const live = w.find('[data-testid="se-search-area"]')
    expect([live.attributes('x'), live.attributes('y'), live.attributes('width'), live.attributes('height')]).toEqual(['900', '400', '100', '100'])
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: 1300, clientY: 700 }))
    await flushPromises()
    expect(e.panel.draft.condition.searchArea).toEqual({ x: 900, y: 400, w: 100, h: 100 })
    expect(e.capture).toBe(null)
  })
  it('찾을 그림은 검색 영역 안으로 잘라 자르고, 누를 곳은 한 번 찍으면 찾을 그림 왼쪽 위 기준 좌표', async () => {
    const { e } = panelFixture([imageStep(0), imageStep(1)]) // 검색 영역 10,20 300×200
    e.startCapture(['train', 'click'])
    const w = mountHost(2)
    place(w, { scale: 2 })
    await drag(w, LAYER, [0, 0], [100, 100]) // 기준 화면 (0,0)~(50,50) → 영역 안 (10,20)~(50,50)
    expect(fx.loadBitmap).toHaveBeenCalledWith(BASE(0))
    expect(fx.cropPng).toHaveBeenCalledWith({ width: 1000, height: 500 }, { x: 10, y: 20, w: 40, h: 30 })
    expect(e.capture.stage).toBe('click')
    expect(w.find('[data-testid="se-cap-train"]').exists()).toBe(true)
    await w.find(LAYER).trigger('mousedown', { button: 0, clientX: 30, clientY: 50 }) // 기준 화면 (15, 25)
    expect(e.capture).toBe(null)
    expect(e.panel.draft.action.click).toEqual({ x: 5, y: 5, basis: 'trainImage' })
    expect(e.panel.draft.images.train['0'].from).toBe('upload')
  })
  it('누를 곳을 기준 화면 밖에 찍으면 알리고 단계를 넘기지 않는다', async () => {
    const { e } = panelFixture([imageStep(0), imageStep(1)])
    e.startCapture(['click'], { train: { x: 10, y: 20, w: 30, h: 30 } })
    const w = mountHost(1)
    place(w, { scale: 1, left: 100 })
    await w.find(LAYER).trigger('mousedown', { button: 0, clientX: 50, clientY: 50 }) // 기준 화면 (-50, 50)
    expect(e.capture.stage).toBe('click')
    expect(e.toast.text).toBe(t('SEW_CAP_OUTSIDE'))
  })
  it('누를 곳만 다시 찍을 때는 찾은 그림 테두리와 지금 누르는 곳을 보인다', async () => {
    const { e } = panelFixture([imageStep(0), imageStep(1)]) // 누를 곳 24,12
    e.startCapture(['click'], { train: { x: 40, y: 50, w: 30, h: 20 } })
    const w = mountHost(1)
    expect(w.find('[data-testid="se-cap-train"]').attributes('x')).toBe('40')
    const now = w.find('[data-testid="se-cap-click-now"]')
    expect(now.attributes('data-x')).toBe('64')
    expect(now.attributes('data-y')).toBe('62')
  })
  it('잡기 밖: 영역 몸통을 끌면 옮기고 모서리 손잡이로 크기를 바꾼다(패널 초안만), 큰 화면 이동으로 번지지 않는다', async () => {
    const { e, edited } = panelFixture([imageStep(0), imageStep(1)]) // 10,20 300×200
    const w = mountHost(2)
    place(w, { scale: 2 })
    expect(w.findAll('[data-h]').map((x) => x.attributes('data-h'))).toEqual(['body', 'nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'])
    const pan = vi.fn()
    document.body.addEventListener('mousedown', pan)
    await drag(w, '[data-h="body"]', [40, 60], [140, 20]) // 기준 화면 +50, -20
    expect(e.panel.draft.condition.searchArea).toEqual({ x: 60, y: 0, w: 300, h: 200 })
    await drag(w, '[data-h="se"]', [720, 400], [800, 600]) // 오른쪽 아래 → (400, 300)
    expect(e.panel.draft.condition.searchArea).toEqual({ x: 60, y: 0, w: 340, h: 300 })
    expect(pan).not.toHaveBeenCalled()
    document.body.removeEventListener('mousedown', pan)
    expect(e.session.working).toBe(edited)
    expect(e.panelDirty()).toBe(true)
  })
  it('영역을 끄는 동안 editStore.areaDragging 을 켜고, 놓거나 층이 사라지면 끈다(찾을 그림 위치 찾기를 미룬다)', async () => {
    const { e } = panelFixture([imageStep(0), imageStep(1)])
    const w = mountHost(1)
    place(w, { scale: 1 })
    await w.find('[data-h="body"]').trigger('mousedown', { button: 0, clientX: 50, clientY: 60 })
    expect(e.areaDragging).toBe(true)
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 60, clientY: 60 }))
    expect(e.areaDragging).toBe(true)
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: 60, clientY: 60 }))
    expect(e.areaDragging).toBe(false)
    await w.find('[data-h="se"]').trigger('mousedown', { button: 0, clientX: 320, clientY: 220 })
    expect(e.areaDragging).toBe(true)
    w.unmount()
    expect(e.areaDragging).toBe(false)
  })
  it('잡기 중에는 손잡이가 없고 층 전체가 누름을 받는다', () => {
    const { e } = panelFixture([imageStep(0), imageStep(1)])
    e.startCapture(['area', 'train', 'click'])
    const w = mountHost(1)
    expect(w.findAll('[data-h]').length).toBe(0)
    expect(w.find(LAYER).attributes('style')).toContain('pointer-events: auto')
    e.cancelCapture()
    return nextTick().then(() => expect(w.find(LAYER).attributes('style')).toContain('pointer-events: none'))
  })
})

describe('StepViewer — 편집 세션의 큰 화면', () => {
  let observers
  class FakeResizeObserver {
    constructor(cb) { this.cb = cb; this.disconnect = vi.fn(); observers.push(this) }
    observe() {}
    unobserve() {}
  }
  beforeEach(() => { observers = []; vi.stubGlobal('ResizeObserver', FakeResizeObserver) })
  afterEach(() => { vi.unstubAllGlobals() })
  const IMG = { target: { naturalWidth: 1000, naturalHeight: 500 } }
  const mountViewer = async ({ w: cw = 800, h: ch = 400 } = {}) => {
    const w = mount(StepViewer, { attachTo: document.body })
    const el = w.find('.select-none').element
    Object.defineProperty(el, 'clientWidth', { get: () => cw, configurable: true })
    Object.defineProperty(el, 'clientHeight', { get: () => ch, configurable: true })
    observers.forEach((o) => o.cb([]))
    w.vm.onLoad(IMG); await nextTick()
    return w
  }
  const tf = (w) => {
    const m = /translate\((-?[\d.e-]+)px, (-?[\d.e-]+)px\) scale\(([\d.e-]+)\)/.exec(w.find('[data-testid="se-base-image"]').element.parentElement.style.transform)
    return { tx: Number(m[1]), ty: Number(m[2]), scale: Number(m[3]) }
  }

  it('쓸 수 있는 세션은 잡기 층(영역 손잡이)과 끌기 안내, 읽기 전용은 P1 영역 표시만', async () => {
    panelFixture([imageStep(0), imageStep(1)])
    const a = await mountViewer()
    expect(a.find(LAYER).exists()).toBe(true)
    expect(a.findAll('[data-h]').length).toBe(9)
    expect(a.text()).toContain(t('SEW_CAP_ADJUST_HINT'))
    a.unmount()
    setActivePinia(createPinia())
    panelFixture([imageStep(0), imageStep(1)], { canWrite: false })
    const b = await mountViewer()
    expect(b.find(LAYER).exists()).toBe(false)
    expect(b.findAll('[data-h]').length).toBe(0)
    expect(b.find('[data-testid="se-search-area"]').classes()).toContain('border-dashed')
    expect(b.text()).not.toContain(t('SEW_CAP_ADJUST_HINT'))
    b.unmount()
  })
  it('패널 초안의 영역을 그린다(적용 전 값)', async () => {
    const { e } = panelFixture([imageStep(0), imageStep(1)])
    const w = await mountViewer()
    e.updateDraft((d) => ({ ...d, condition: { ...d.condition, searchArea: { x: 1, y: 2, w: 30, h: 40 } } }))
    await nextTick()
    expect(w.find('[data-testid="se-search-area"]').attributes('width')).toBe('30')
    w.unmount()
  })
  it('잡기 중: 단계 띠(지금 단계)·안내 문구·[취소], 그림을 다시 잡을 때 [그림은 그대로 두기]', async () => {
    const { e, edited } = panelFixture([imageStep(0), imageStep(1)])
    const w = await mountViewer()
    e.startCapture(['area', 'train', 'click'])
    await nextTick()
    const bar = w.find('[data-testid="se-cap-bar"]')
    expect(bar.findAll('[data-cap-stage]').map((x) => x.attributes('data-cap-stage'))).toEqual(['area', 'train', 'click'])
    expect(bar.find('[data-cap-stage="area"]').classes()).toContain('now')
    expect(bar.text()).toContain(t('SEW_CAP_STAGE_area'))
    expect(w.find('[data-testid="se-cap-hint"]').text()).toBe(t('SEW_CAP_HINT_area'))
    expect(w.find('[data-testid="se-cap-keep"]').exists()).toBe(false)
    await e.captureNext({ x: 5, y: 5, w: 100, h: 100 })
    await nextTick()
    expect(w.find('[data-cap-stage="area"]').classes()).toContain('done')
    expect(w.find('[data-testid="se-cap-hint"]').text()).toBe(t('SEW_CAP_HINT_train'))
    await w.find('[data-testid="se-cap-keep"]').trigger('click')
    expect(e.capture).toBe(null)
    expect(e.panel.draft.condition.searchArea).toEqual({ x: 5, y: 5, w: 100, h: 100 })
    expect(e.panel.draft.images).toBe(edited.steps[0].images)
    e.startCapture(['ocr'])
    await nextTick()
    await w.find('[data-testid="se-cap-cancel"]').trigger('click')
    expect(e.capture).toBe(null)
    w.unmount()
  })
  it('[다시 찍기]가 그림부터 시작하면 안내 앞에 이유, 누를 곳만이면 다시 찍기 안내', async () => {
    const { e } = panelFixture([imageStep(0), imageStep(1)])
    const w = await mountViewer()
    e.startCapture(['train', 'click'], { why: t('SEW_CAP_WHY_MANY') })
    await nextTick()
    expect(w.find('[data-testid="se-cap-hint"]').text()).toBe(`${t('SEW_CAP_WHY_MANY')} ${t('SEW_CAP_HINT_train')}`)
    e.startCapture(['click'], { train: { x: 0, y: 0, w: 10, h: 10 } })
    await nextTick()
    expect(w.find('[data-testid="se-cap-hint"]').text()).toBe(t('SEW_CAP_HINT_repick'))
    w.unmount()
  })
  it('잡기를 시작하면 전체를 보이고, 영역 그림을 누르면 영역에 맞춰 확대(목업 focusArea·viewAll)', async () => {
    const { e } = panelFixture([imageStep(0), imageStep(1)]) // 10,20 300×200
    const w = await mountViewer()
    const fitted = tf(w)
    e.requestView('area')
    await nextTick()
    const want = areaView({ x: 10, y: 20, w: 300, h: 200 }, { w: 800, h: 400 }, NAT)
    expect(tf(w).scale).toBeCloseTo(want.scale, 5)
    expect(tf(w).tx).toBeCloseTo(want.tx, 5)
    e.startCapture(['area', 'train', 'click'])
    await nextTick()
    expect(tf(w).scale).toBeCloseTo(fitted.scale, 5)
    e.requestView('area'); await nextTick()
    e.requestView('all'); await nextTick()
    expect(tf(w).scale).toBeCloseTo(fitted.scale, 5)
    w.unmount()
  })
  it('새 이미지 스텝: 고른 스텝의 기준 화면 그림에서 바로 영역 잡기, 잡기를 멈추면 제목 "새 스텝 기준 화면"', async () => {
    const { s, e } = panelFixture([imageStep(0), imageStep(1)])
    s.select('s1')
    e.startNew('image')
    const w = await mountViewer()
    expect(w.find('[data-testid="se-base-image"]').attributes('src')).toBe(BASE(1))
    expect(w.find('[data-testid="se-cap-bar"]').exists()).toBe(true) // 잡는 동안 머리는 단계 띠(목업 capBar || title)
    expect(w.find(LAYER).exists()).toBe(true)
    e.cancelCapture()
    await nextTick()
    expect(w.text()).toContain(t('SEW_CAP_NEW_TITLE'))
    w.unmount()
  })
  it('Esc(큰 화면): 입력 칸 안의 Esc·열린 다음 스텝 고르기·확인 창은 건드리지 않고, 그 밖의 Esc 는 잡기가 쓴 칸만 되돌린다', async () => {
    const { e, edited } = panelFixture([imageStep(0), imageStep(1)])
    const viewer = await mountViewer()
    const panel = mount(StepPanel, { attachTo: document.body })
    e.startCapture(['area', 'train', 'click'])
    await e.captureNext({ x: 5, y: 5, w: 100, h: 100 })
    await nextTick()
    const desc = panel.find('[data-field="desc"]')
    desc.element.value = '잡는 중 설명'
    await desc.trigger('input')
    desc.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(e.capture).not.toBe(null)
    expect(e.panel.draft.descriptionToEmail).toBe('잡는 중 설명')
    expect(e.panel.draft.condition.searchArea).toEqual({ x: 5, y: 5, w: 100, h: 100 })
    // 다음 스텝 고르기가 열려 있으면 Esc 는 그 창을 닫는다(목업 순서: 확인 창 → 고르기 → 메뉴 → 잡기)
    await panel.find('[data-target="onFalse"]').trigger('click')
    expect(document.querySelector('[data-testid="se-picker"]')).not.toBe(null)
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick()
    expect(document.querySelector('[data-testid="se-picker"]')).toBe(null)
    expect(e.capture).not.toBe(null)
    // 확인 창이 떠 있으면 확인 창 몫
    e.dialog = { kind: 'guard', action: 'move', to: null }
    esc()
    expect(e.capture).not.toBe(null)
    e.dialog = null
    // 그 밖의 Esc: 잡기 취소 — 검색 영역은 잡기 전 값, 잡는 사이 고친 설명은 남는다
    esc()
    expect(e.capture).toBe(null)
    expect(e.panel.draft.condition.searchArea).toBe(edited.steps[0].condition.searchArea)
    expect(e.panel.draft.descriptionToEmail).toBe('잡는 중 설명')
    panel.unmount()
    viewer.unmount()
  })
  it('Esc 는 기준 화면 그림을 그리지 못했을 때(잡기 층이 없을 때)도 잡기를 취소한다', async () => {
    const { e } = panelFixture([imageStep(0), imageStep(1)])
    const w = await mountViewer()
    await w.find('[data-testid="se-base-image"]').trigger('error')
    e.startCapture(['area', 'train', 'click'])
    await nextTick()
    expect(w.find(LAYER).exists()).toBe(false)
    expect(w.find('[data-testid="se-cap-bar"]').exists()).toBe(true)
    esc()
    expect(e.capture).toBe(null)
    w.unmount()
  })
  it('새 조건 없음 스텝은 화면을 보지 않는다는 안내', async () => {
    const { e } = panelFixture([imageStep(0), noneStep(1)])
    e.startNew('none')
    const w = mount(StepViewer)
    expect(w.text()).toContain(t('SEW_UI_BASE_IMAGE_NOT_NEEDED'))
    expect(w.find(LAYER).exists()).toBe(false)
  })
})

describe('패널 — 잡기 버튼·[다시 찍기]·새 스텝 넣기', () => {
  const mountPanel = () => mount(StepPanel, { attachTo: document.body })
  const input = async (w, sel, value) => { const el = w.find(sel); el.element.value = value; await el.trigger('input'); await el.trigger('change') }

  it('보는 곳 [다시 잡기] = 영역부터(마우스 클릭이면 누를 곳까지), 찾는 것 [다시 잡기] = 그림부터, OCR 은 문자 영역', async () => {
    const { e } = panelFixture([imageStep(0), ocrStep(1)])
    const w = mountPanel()
    expect(w.find('[data-testid="se-cap-look"]').text()).toBe(t('SEW_CAP_REGRAB'))
    await w.find('[data-testid="se-cap-look"]').trigger('click')
    expect(e.capture).toMatchObject({ flow: ['area', 'train', 'click'], stage: 'area' })
    e.cancelCapture()
    await w.find('[data-testid="se-cap-find"]').trigger('click')
    expect(e.capture).toMatchObject({ flow: ['train', 'click'], stage: 'train' })
    e.cancelCapture()
    e.requestSelect('s1')
    await nextTick()
    await w.find('[data-testid="se-cap-look"]').trigger('click')
    expect(e.capture).toMatchObject({ flow: ['ocr'] })
    w.unmount()
  })
  it('영역 그림을 누르면 큰 화면을 영역에 맞추고, 기준 화면 그림을 누르면 전체', async () => {
    const { e } = panelFixture([imageStep(0), imageStep(1)])
    const w = mountPanel()
    await w.find('[data-testid="se-look-area"]').trigger('click')
    expect(e.viewReq).toMatchObject({ kind: 'area' })
    await w.find('[data-testid="se-look-base"]').trigger('click')
    expect(e.viewReq).toMatchObject({ kind: 'all' })
    w.unmount()
  })
  it('누를 곳 [다시 찍기]: 기준 화면에서 찾을 그림을 한 곳 찾으면 누를 곳만 찍는다', async () => {
    const { e } = panelFixture([imageStep(0), imageStep(1)])
    fx.locate.mockReturnValue({ found: 'one', x: 40, y: 50 })
    const w = mountPanel()
    const btn = w.find('[data-testid="se-repick"]')
    expect(btn.text()).toBe(t('SEW_CAP_REPICK'))
    await btn.trigger('click')
    await flushPromises()
    expect(e.capture).toMatchObject({ flow: ['click'], stage: 'click' })
    e.cancelCapture()
    e.locating = true
    await nextTick()
    expect(w.find('[data-testid="se-repick"]').attributes('disabled')).toBeDefined()
    expect(w.find('[data-testid="se-repick"]').text()).toBe(t('SEW_CAP_LOCATING'))
    w.unmount()
  })
  it('새 스텝: 머리 "+"·넣을 자리 고르기·[취소]·[넣기], 칸 오류는 [넣기]를 누른 뒤에 보인다', async () => {
    const { s, e, edited } = panelFixture([imageStep(0), noneStep(1, { next: { onTrue: { kind: 'end', value: 'SUCCESS' }, onFalse: { kind: 'end', value: 'FAIL' } } })])
    s.select('s1')
    e.startNew('none')
    const uid = e.panel.uid
    const w = mountPanel()
    await nextTick()
    expect(w.text()).toContain(t('SEW_PANEL_NEW_TITLE'))
    expect(w.find('[data-testid="se-panel-foot"]').exists()).toBe(false)
    // 넣을 자리: 스텝마다 "N번 앞 — 설명" 과 맨 끝, 기본은 [+ 새 스텝]을 누를 때 고른 줄
    const where = w.find('[data-testid="se-new-where"]')
    expect(where.attributes('aria-label')).toBe(t('SEW_PANEL_NEW_WHERE'))
    expect(where.findAll('option').map((o) => o.text())).toEqual(['1번 앞 — 스텝0', '2번 앞 — 스텝1', t('SEW_PANEL_NEW_WHERE_END')])
    expect(where.element.value).toBe('s1')
    expect(w.find('[data-testid="se-new-add"]').text()).toBe(t('SEW_PANEL_NEW_ADD'))
    expect(w.find('[data-err="desc"]').exists()).toBe(false)
    await w.find('[data-testid="se-new-add"]').trigger('click')
    expect(e.session.working).toBe(edited)
    expect(w.find('[data-err="desc"]').exists()).toBe(true)
    expect(w.find('[data-testid="se-new-errors"]').text()).toContain(t('RULE_STEP_DESC_EMPTY'))
    await input(w, '[data-field="desc"]', '재시작')
    await input(w, '[data-field="cmd"]', 'restart.bat')
    // 다 만든 뒤에 자리를 바꾼다 — 만든 값은 그대로
    await where.setValue('s0')
    expect(e.panel.insertBefore).toBe('s0')
    expect(w.find('[data-field="desc"]').element.value).toBe('재시작')
    await w.find('[data-testid="se-new-add"]').trigger('click')
    expect(e.session.working.steps.map((x) => x.uid)).toEqual([uid, 's0', 's1'])
    await nextTick()
    expect(w.find('[data-testid="se-new-foot"]').exists()).toBe(false)
    w.unmount()
  })
  it('새 스텝: 넣을 자리를 맨 끝으로 고르면 끝에 넣는다, 고른 줄 없이 시작하면 기본이 맨 끝', async () => {
    const { s, e } = panelFixture([noneStep(0), noneStep(1)])
    s.select('s0')
    e.startNew('none')
    const uid = e.panel.uid
    const w = mountPanel()
    await nextTick()
    await input(w, '[data-field="desc"]', '재시작')
    await input(w, '[data-field="cmd"]', 'restart.bat')
    // 설명 칸 위의 메일 번호는 넣을 자리를 따른다 — 1번 앞이면 1번, 맨 끝이면 3번(2026-11-10, 전에는 늘 맨 끝 번호였다)
    expect(w.text()).toContain(t('SEW_PANEL_DESC_MAIL', { n: 1, desc: '재시작' }))
    await w.find('[data-testid="se-new-where"]').setValue('')
    expect(e.panel.insertBefore).toBe(null)
    expect(w.text()).toContain(t('SEW_PANEL_DESC_MAIL', { n: 3, desc: '재시작' }))
    await w.find('[data-testid="se-new-add"]').trigger('click')
    expect(e.session.working.steps.map((x) => x.uid)).toEqual(['s0', 's1', uid])
    e.setSelection({ uids: [], anchor: null })
    e.startNew('none')
    await nextTick()
    expect(w.find('[data-testid="se-new-where"]').element.value).toBe('')
    w.unmount()
  })
  it('기준 화면 그림이 없으면 [잡기]·찾을 그림 [잡기]·[다시 찍기]를 끄고 이유를 보인다', async () => {
    const noBase = imageStep(0, { images: { train: { 0: { from: 'source', id: 's0-train-0' } }, base: { literal: 'AA==' } } })
    const { e } = panelFixture([noBase, imageStep(1)])
    const w = mountPanel()
    const look = w.find('[data-testid="se-cap-look"]')
    expect(look.attributes('disabled')).toBeDefined()
    expect(look.attributes('title')).toBe(t('SEW_CAP_NO_BASE_IMAGE'))
    expect(w.find('[data-testid="se-cap-look-why"]').text()).toBe(t('SEW_CAP_NO_BASE_IMAGE'))
    expect(w.find('[data-testid="se-cap-find"]').attributes('disabled')).toBeDefined()
    expect(w.find('[data-testid="se-repick"]').attributes('disabled')).toBeDefined()
    await look.trigger('click')
    expect(e.capture).toBe(null)
    e.requestSelect('s1')
    await nextTick()
    expect(w.find('[data-testid="se-cap-look"]').attributes('disabled')).toBeUndefined()
    expect(w.find('[data-testid="se-cap-look-why"]').exists()).toBe(false)
    w.unmount()
  })
  it('새 스텝 [취소]: 버리고 고른 스텝으로', async () => {
    const { s, e, edited } = panelFixture([imageStep(0), imageStep(1)])
    s.select('s1')
    e.startNew('image')
    const w = mountPanel()
    await nextTick()
    await w.find('[data-testid="se-new-cancel"]').trigger('click')
    expect(e.panel).toMatchObject({ uid: 's1', isNew: false })
    expect(e.capture).toBe(null)
    expect(e.session.working).toBe(edited)
    w.unmount()
  })
})

describe('EditDialogs — 만들던 새 스텝', () => {
  it('값을 넣은 새 스텝을 두고 다른 줄로 가면: 새 스텝 문구, [계속 만들기]·[버리고 이동] 만', async () => {
    const { e } = panelFixture([imageStep(0), imageStep(1)])
    e.startNew('none')
    e.updateDraft((d) => ({ ...d, descriptionToEmail: 'x' }))
    e.clickRow('s1')
    const w = mount(EditDialogs, { attachTo: document.body })
    await nextTick()
    const dlg = document.querySelector('[data-testid="se-guard"]')
    expect(dlg.textContent).toContain(t('SEW_EDIT_GUARD_NEW_TITLE'))
    expect(dlg.textContent).toContain(t('SEW_EDIT_GUARD_NEW_BODY'))
    expect(document.querySelector('[data-testid="se-guard-keep"]').textContent.trim()).toBe(t('SEW_EDIT_GUARD_NEW_KEEP'))
    expect(document.querySelector('[data-testid="se-guard-apply"]')).toBe(null)
    document.querySelector('[data-testid="se-guard-drop"]').click()
    await nextTick()
    expect(e.panel).toMatchObject({ uid: 's1', isNew: false })
    w.unmount()
  })
})

import { SPOT_DELAY_MS } from '../composables/useTrainSpot'
describe('StepViewer — 기준 화면에서 찾은 그림·누를 곳을 늘 그린다(찾을 그림 밖 누를 곳 B)', () => {
  let observers
  class FakeResizeObserver {
    constructor(cb) { this.cb = cb; this.disconnect = vi.fn(); observers.push(this) }
    observe() {}
    unobserve() {}
  }
  beforeEach(() => {
    observers = []
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    fx.loadBitmap.mockImplementation(async (u) => (u.includes('-train-') ? { width: 20, height: 10 } : { width: 1000, height: 500 }))
    fx.locate.mockReturnValue({ found: 'one', x: 40, y: 50 })
  })
  afterEach(() => { vi.unstubAllGlobals() })
  const settle = async () => { await new Promise((r) => setTimeout(r, SPOT_DELAY_MS + 10)); await flushPromises() }
  const mountViewer = async () => {
    const w = mount(StepViewer, { attachTo: document.body })
    const el = w.find('.select-none').element
    Object.defineProperty(el, 'clientWidth', { get: () => 800, configurable: true })
    Object.defineProperty(el, 'clientHeight', { get: () => 400, configurable: true })
    observers.forEach((o) => o.cb([]))
    w.vm.onLoad({ target: { naturalWidth: 1000, naturalHeight: 500 } }); await nextTick()
    await settle()
    return w
  }
  const SPOT = '[data-testid="se-spot"]'
  const rectOf = (w) => ['x', 'y', 'width', 'height'].map((a) => w.find('[data-testid="se-spot-train"]').attributes(a))

  it('쓸 수 있는 세션: 찾은 그림 테두리와 누를 곳 + (찾은 자리 + 누를 곳), 이름표 "찾은 그림"·"누를 곳" — 누름은 막지 않는다', async () => {
    panelFixture([imageStep(0), imageStep(1)]) // 누를 곳 24,12
    const w = await mountViewer()
    const spot = w.find(SPOT)
    expect(spot.exists()).toBe(true)
    expect(spot.attributes('pointer-events')).toBe('none')
    expect(rectOf(w)).toEqual(['40', '50', '20', '10'])
    const c = w.find('[data-testid="se-spot-click"]')
    expect([c.attributes('data-x'), c.attributes('data-y')]).toEqual(['64', '62'])
    expect(spot.text()).toContain(t('SEW_CAP_TAG_FOUND'))
    expect(spot.text()).toContain(t('SEW_CAP_TAG_CLICK'))
    expect(w.findAll('[data-h]').length).toBe(9) // 영역 손잡이는 그대로
    w.unmount()
  })
  it('영역을 끄는 동안 큰 화면 표시를 숨기고 찾지 않다가, 놓으면 그 영역으로 한 번 찾아 다시 그린다', async () => {
    const { e } = panelFixture([imageStep(0), imageStep(1)]) // 영역 10,20 300×200
    const w = await mountViewer()
    expect(fx.locate).toHaveBeenCalledTimes(1)
    place(w, { scale: 1 })
    await w.find('[data-h="body"]').trigger('mousedown', { button: 0, clientX: 50, clientY: 60 })
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 60, clientY: 60 }))
    await settle() // 끄다가 기다림보다 오래 멈춘다
    expect(e.panel.draft.condition.searchArea).toEqual({ x: 20, y: 20, w: 300, h: 200 })
    expect(w.find(SPOT).exists()).toBe(false)
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 50, clientY: 60 })) // 처음 자리(찾은 결과가 있는 키)로 돌아와도
    await settle()
    expect(w.find(SPOT).exists()).toBe(false)
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 55, clientY: 60 }))
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: 55, clientY: 60 }))
    await nextTick()
    expect(fx.locate).toHaveBeenCalledTimes(1) // 끄는 동안은 찾지 않았다
    await settle()
    expect(fx.locate).toHaveBeenCalledTimes(2)
    expect(fx.locate.mock.calls[1][2]).toEqual({ x: 15, y: 20, w: 300, h: 200 })
    expect(w.find(SPOT).exists()).toBe(true)
    expect(rectOf(w)).toEqual(['40', '50', '20', '10'])
    w.unmount()
  })
  it('누를 곳을 그림 밖으로 고치면 다시 찾지 않고 + 만 옮긴다(작업본은 그대로)', async () => {
    const { e, edited } = panelFixture([imageStep(0), imageStep(1)])
    const w = await mountViewer()
    e.updateDraft((d) => ({ ...d, action: { ...d.action, click: { x: 300, y: -5, basis: 'trainImage' } } }))
    await settle()
    const c = w.find('[data-testid="se-spot-click"]')
    expect([c.attributes('data-x'), c.attributes('data-y')]).toEqual(['340', '45'])
    expect(fx.locate).toHaveBeenCalledTimes(1)
    expect(e.session.working).toBe(edited)
    w.unmount()
  })
  it('잡기 중에는 그리지 않고(지금 동작 그대로), 잡기를 끝내면 다시 그린다', async () => {
    const { e } = panelFixture([imageStep(0), imageStep(1)])
    const w = await mountViewer()
    e.startCapture(['area', 'train', 'click'])
    await nextTick()
    expect(w.find(SPOT).exists()).toBe(false)
    e.cancelCapture()
    await nextTick()
    expect(w.find(SPOT).exists()).toBe(true)
    w.unmount()
  })
  it('여러 곳·못 찾음·시간 초과·불러오기 실패면 그리지 않는다(찾기는 실제로 돌았다)', async () => {
    for (const found of ['many', 'none', 'timeout', 'error']) {
      setActivePinia(createPinia())
      fx.loadBitmap.mockClear()
      fx.locate.mockClear()
      if (found === 'error') fx.loadBitmap.mockRejectedValue(new Error('image 404'))
      else fx.locate.mockReturnValue({ found })
      const { e } = panelFixture([imageStep(0), imageStep(1)])
      const w = await mountViewer()
      expect(fx.loadBitmap, found).toHaveBeenCalledWith(BASE(0))
      expect(fx.locate, found).toHaveBeenCalledTimes(found === 'error' ? 0 : 1)
      expect([...e.spots.values()], found).toEqual([{ found }])
      expect(w.find(SPOT).exists(), found).toBe(false)
      w.unmount()
    }
  })
  it('읽기 전용(WRITE 없음·옛 판)도 그린다 — 이름표 "학습 이미지"·"클릭 지점", 머리 안내는 찾은 자리', async () => {
    const tis = (i) => ({ condition: { ...imageStep(i).condition, image: { ...imageStep(i).condition.image, trainImages: [{ key: 0, type: true, url: `/u/s${i}-train-0` }] } } })
    for (const opts of [{ canWrite: false }, { isCurrent: false }]) {
      setActivePinia(createPinia())
      fx.locate.mockReturnValue({ found: 'one', x: 40, y: 50 })
      panelFixture([imageStep(0), imageStep(1)], { ...opts, skOver: { s0: tis(0) } })
      const w = await mountViewer()
      expect(w.find(LAYER).exists()).toBe(false)
      expect(fx.loadBitmap).toHaveBeenCalledWith('http://x/api/u/s0')
      expect(fx.loadBitmap).toHaveBeenCalledWith('http://x/api/u/s0-train-0')
      const spot = w.find(SPOT)
      expect(spot.exists(), JSON.stringify(opts)).toBe(true)
      expect(spot.text()).toContain(t('SEW_UI_TAG_TRAIN'))
      expect(spot.text()).toContain(t('SEW_UI_TAG_CLICK'))
      expect(w.text()).toContain(t('SEW_UI_TRAIN_FOUND'))
      expect(w.text()).not.toContain(t('SEW_UI_TRAIN_NOT_STORED'))
      w.unmount()
    }
    setActivePinia(createPinia())
    fx.locate.mockReturnValue({ found: 'many' })
    fx.loadBitmap.mockClear()
    const { e } = panelFixture([imageStep(0), imageStep(1)], { canWrite: false, skOver: { s0: tis(0) } })
    const w = await mountViewer()
    expect(fx.loadBitmap).toHaveBeenCalledWith('http://x/api/u/s0-train-0') // 읽기 전용 스텝도 실제로 찾았다
    expect([...e.spots.values()]).toEqual([{ found: 'many' }])
    expect(w.find(SPOT).exists()).toBe(false)
    expect(w.text()).toContain(t('SEW_UI_TRAIN_NOT_STORED'))
    w.unmount()
  })
})

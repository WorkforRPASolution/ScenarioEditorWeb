import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
vi.mock('../api', () => ({ imageUrl: (p) => `http://x/api${p}` }))
import StepViewer from '../components/StepViewer.vue'
import CropView from '../components/CropView.vue'
import { useEditorStore } from '../stores/editorStore'
import { panelFixture, imageStep } from './panelFixture'
import { t } from '../messages'
import { thumbView } from '../editor/trainView'

const step = (over = {}) => ({ uid: 's0', no: 1, notes: [], action: {}, next: {}, retry: {},
  condition: { kind: 'image', searchArea: { x: 576, y: 336, w: 846, h: 480 } }, baseImage: { state: 'present', url: '/scenario-editor/x/images/s0-bi' }, ...over })

describe('StepViewer', () => {
  let observers
  class FakeResizeObserver {
    constructor(cb) { this.cb = cb; this.disconnect = vi.fn(); observers.push(this) }
    observe() {}
    unobserve() {}
  }
  beforeEach(() => { setActivePinia(createPinia()); localStorage.clear(); observers = []; vi.stubGlobal('ResizeObserver', FakeResizeObserver) })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
  const open = (s) => { const st = useEditorStore(); st.skeleton = { steps: [s], notes: [] }; st.selectedUid = s.uid }
  // happy-dom 은 레이아웃이 없어 clientWidth 가 0 — 상자 크기를 직접 정하고 ResizeObserver 를 깨운다.
  const sizeBox = (w) => {
    const el = w.find('.select-none').element
    const sz = { w: 0, h: 0 }
    Object.defineProperty(el, 'clientWidth', { get: () => sz.w, configurable: true })
    Object.defineProperty(el, 'clientHeight', { get: () => sz.h, configurable: true })
    return { resize(cw, ch) { sz.w = cw; sz.h = ch; observers.forEach((o) => o.cb([])) } }
  }
  const tf = (w) => {
    const m = /translate\((-?[\d.e-]+)px, (-?[\d.e-]+)px\) scale\(([\d.e-]+)\)/.exec(w.find('[data-testid="se-base-image"]').element.parentElement.style.transform)
    return { tx: Number(m[1]), ty: Number(m[2]), scale: Number(m[3]) }
  }
  const IMG = { target: { naturalWidth: 1000, naturalHeight: 500 } }
  const mountSized = async (cw = 800, ch = 400) => {
    open(step())
    const w = mount(StepViewer, { attachTo: document.body })
    const box = sizeBox(w)
    box.resize(cw, ch)
    w.vm.onLoad(IMG); await w.vm.$nextTick()
    return { w, box }
  }
  const wheel = (w, dy) => w.find('.select-none').trigger('wheel', { deltaY: dy, clientX: 50, clientY: 50 })

  it('기준 화면과 검색 영역(기준 화면 픽셀 좌표)', async () => {
    open(step())
    const w = mount(StepViewer)
    expect(w.find('[data-testid="se-base-image"]').attributes('src')).toBe('http://x/api/scenario-editor/x/images/s0-bi')
    w.vm.onLoad({ target: { naturalWidth: 1920, naturalHeight: 1200 } })
    await w.vm.$nextTick()
    const area = w.find('[data-testid="se-search-area"]')
    expect(area.attributes('style')).toContain('left: 576px')
    expect(area.attributes('style')).toContain('width: 846px')
    expect(w.text()).toContain('학습 이미지 위치는 저장되지 않아')
  })
  it('편집으로 만든 스텝은 뼈대 URL 대신 src(참조에서 만든 URL)를 그대로 쓴다', () => {
    open(step({ baseImage: { state: 'present', src: 'blob:abc' } }))
    expect(mount(StepViewer).find('[data-testid="se-base-image"]').attributes('src')).toBe('blob:abc')
  })
  it('OCR 은 보라 OCR 영역', async () => {
    open(step({ condition: { kind: 'ocr', searchArea: { x: 1, y: 2, w: 3, h: 4 } } }))
    const w = mount(StepViewer)
    w.vm.onLoad({ target: { naturalWidth: 100, naturalHeight: 100 } }); await w.vm.$nextTick()
    expect(w.find('[data-testid="se-search-area"]').classes()).toContain('border-violet-600')
  })
  it('기준 화면이 필요 없는 스텝·없는 스텝·불러오기 실패', async () => {
    open(step({ condition: { kind: 'none' }, baseImage: { state: 'notNeeded' } }))
    expect(mount(StepViewer).text()).toContain('화면을 보지 않는 조건')
    open(step({ baseImage: { state: 'missing' } }))
    expect(mount(StepViewer).text()).toContain('저장되어 있지 않습니다')
    open(step())
    const w = mount(StepViewer)
    await w.find('[data-testid="se-base-image"]').trigger('error')
    expect(w.text()).toContain('불러오지 못했습니다')
  })
  it('다른 판 기준 화면(다른 시나리오에서 붙여 온 스텝)을 불러오지 못하면 "원래 시나리오의 그 버전을 찾지 못했습니다"', async () => {
    open(step({ baseImage: { state: 'present', src: 'http://x/api/other-bi', other: true } }))
    const w = mount(StepViewer)
    await w.find('[data-testid="se-base-image"]').trigger('error')
    expect(w.text()).toContain('원래 시나리오의 그 버전을 찾지 못했습니다')
    expect(w.text()).not.toContain('기준 화면을 불러오지 못했습니다')
  })
  it('기준 화면 데이터(시나리오 단위 PARSE_FAILED bi)를 해석하지 못해 없는 스텝은 그 사실을 알린다', () => {
    const st = useEditorStore()
    const s = step({ baseImage: { state: 'missing' } })
    st.skeleton = { steps: [s], notes: [{ level: 'warning', code: 'PARSE_FAILED', params: { field: 'bi' } }] }
    st.selectedUid = s.uid
    const text = mount(StepViewer).text()
    expect(text).toContain('기준 화면 데이터를 해석하지 못했습니다(경고 참고).')
    expect(text).not.toContain('저장되어 있지 않습니다')
    // 다른 field 의 해석 실패는 해당 없음 — 원래 안내
    st.skeleton = { steps: [s], notes: [{ level: 'warning', code: 'PARSE_FAILED', params: { field: 'property' } }] }
    expect(mount(StepViewer).text()).toContain('저장되어 있지 않습니다')
  })
  it('검색 영역이 없거나 숫자가 아니면 그리지 않고 오류도 내지 않는다', async () => {
    for (const searchArea of [undefined, null, 'abc', { x: 'a', y: 1, w: 2, h: 3 }, { x: 1, y: 2 }]) {
      open(step({ condition: { kind: 'image', searchArea } }))
      const w = mount(StepViewer)
      w.vm.onLoad({ target: { naturalWidth: 100, naturalHeight: 100 } }); await w.vm.$nextTick()
      expect(w.find('[data-testid="se-base-image"]').exists()).toBe(true)
      expect(w.find('[data-testid="se-search-area"]').exists()).toBe(false)
    }
  })
  it('휠로 확대·축소, 끌어서 이동, 맞춤으로 되돌림', async () => {
    const { w } = await mountSized()
    const fitted = tf(w)
    expect(fitted.scale).toBeCloseTo(0.784, 5)
    expect(fitted.tx).toBeCloseTo(8, 5)
    await wheel(w, -100)
    expect(tf(w).scale).toBeGreaterThan(fitted.scale)
    await wheel(w, 100)
    expect(tf(w).scale).toBeCloseTo(fitted.scale, 5)
    const before = tf(w)
    await w.find('.select-none').trigger('mousedown', { clientX: 10, clientY: 10 })
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 60, clientY: 40 }))
    await w.vm.$nextTick()
    expect(tf(w).tx).toBeCloseTo(before.tx + 50, 5)
    expect(tf(w).ty).toBeCloseTo(before.ty + 30, 5)
    window.dispatchEvent(new MouseEvent('mouseup'))
    const dragged = tf(w)
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 200, clientY: 200 }))
    await w.vm.$nextTick()
    expect(tf(w)).toEqual(dragged)
    w.vm.fit(); await w.vm.$nextTick()
    expect(tf(w).scale).toBeCloseTo(fitted.scale, 5)
    expect(tf(w).tx).toBeCloseTo(fitted.tx, 5)
    w.unmount()
  })
  it('상자가 0×0 이면 맞추기를 미루고, 실제 크기가 되면 맞춘다', async () => {
    open(step())
    const w = mount(StepViewer, { attachTo: document.body })
    const box = sizeBox(w)
    w.vm.onLoad(IMG); await w.vm.$nextTick()
    expect(tf(w)).toEqual({ tx: 0, ty: 0, scale: 1 })
    box.resize(0, 0)
    expect(tf(w)).toEqual({ tx: 0, ty: 0, scale: 1 })
    box.resize(800, 400); await w.vm.$nextTick()
    expect(tf(w).scale).toBeCloseTo(0.784, 5)
    expect(tf(w).tx).toBeCloseTo(8, 5)
    w.unmount()
  })
  it('넓게 보기로 숨겨진 사이에 이미지가 불러와져도 다시 보이면 맞춘다', async () => {
    const { w, box } = await mountSized()
    await wheel(w, -100)
    box.resize(0, 0)
    w.vm.onLoad({ target: { naturalWidth: 2000, naturalHeight: 1000 } }); await w.vm.$nextTick()
    box.resize(800, 400); await w.vm.$nextTick()
    expect(tf(w).scale).toBeCloseTo(0.392, 5)
    expect(tf(w).tx).toBeCloseTo(8, 5)
    w.unmount()
  })
  it('상자 크기가 바뀌면 직접 움직이지 않은 화면은 다시 맞춘다', async () => {
    const { w, box } = await mountSized()
    box.resize(1000, 500); await w.vm.$nextTick()
    expect(tf(w).scale).toBeCloseTo(0.98, 5)
    expect(tf(w).tx).toBeCloseTo(10, 5)
    w.unmount()
  })
  it('직접 확대·이동했으면 상자 크기가 바뀌어도 다시 맞추지 않는다', async () => {
    const moves = {
      휠: (w) => wheel(w, -100),
      '＋ 버튼': (w) => w.find('button[title="확대"]').trigger('click'),
      '－ 버튼': (w) => w.find('button[title="축소"]').trigger('click'),
      끌기: async (w) => {
        await w.find('.select-none').trigger('mousedown', { button: 0, clientX: 10, clientY: 10 })
        window.dispatchEvent(new MouseEvent('mousemove', { clientX: 60, clientY: 40 }))
        window.dispatchEvent(new MouseEvent('mouseup'))
      }
    }
    for (const [name, move] of Object.entries(moves)) {
      const { w, box } = await mountSized()
      await move(w)
      await w.vm.$nextTick()
      const moved = tf(w)
      expect(moved, name).not.toEqual({ tx: 8, ty: 4, scale: 0.784 })
      box.resize(1000, 500); await w.vm.$nextTick()
      expect(tf(w), name).toEqual(moved)
      w.unmount()
    }
  })
  it('맞춤을 누르거나 새 이미지가 불러와지면 다시 크기에 맞춰 따라간다', async () => {
    const a = await mountSized()
    await wheel(a.w, -100)
    const zoomed = tf(a.w)
    await a.w.findAll('button').find((b) => b.text() === '맞춤').trigger('click')
    expect(tf(a.w).scale).toBeCloseTo(0.784, 5)
    a.box.resize(1000, 500); await a.w.vm.$nextTick()
    expect(tf(a.w).scale).toBeCloseTo(0.98, 5)
    expect(tf(a.w).scale).not.toBeCloseTo(zoomed.scale, 3)
    a.w.unmount()

    const b = await mountSized()
    await wheel(b.w, -100)
    const st = useEditorStore()
    st.skeleton = { steps: [step(), step({ uid: 's1', no: 2, baseImage: { state: 'present', url: '/scenario-editor/x/images/s1-bi' } })], notes: [] }
    st.selectedUid = 's1'
    await b.w.vm.$nextTick()
    b.w.vm.onLoad(IMG); await b.w.vm.$nextTick()
    expect(tf(b.w).scale).toBeCloseTo(0.784, 5)
    b.box.resize(1000, 500); await b.w.vm.$nextTick()
    expect(tf(b.w).scale).toBeCloseTo(0.98, 5)
    b.w.unmount()
  })
  it('오른쪽 버튼으로는 끌어 이동하지 않는다', async () => {
    const { w } = await mountSized()
    const before = tf(w)
    await w.find('.select-none').trigger('mousedown', { button: 2, clientX: 10, clientY: 10 })
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 60, clientY: 40 }))
    await w.vm.$nextTick()
    expect(tf(w)).toEqual(before)
    w.unmount()
  })
  it('사라질 때 크기 관찰과 끌기 중인 창 이벤트를 놓는다', async () => {
    const { w } = await mountSized()
    const remove = vi.spyOn(window, 'removeEventListener')
    await w.find('.select-none').trigger('mousedown', { button: 0, clientX: 10, clientY: 10 })
    w.unmount()
    expect(observers[0].disconnect).toHaveBeenCalled()
    expect(remove.mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining(['mousemove', 'mouseup']))
  })
  it('처음 한 번 기준 화면 안내, 닫으면 다시 안 보임', async () => {
    open(step())
    const w = mount(StepViewer)
    expect(w.text()).toContain('스텝을 만들 때 캡처한 화면')
    await w.find('[data-testid="se-hint-close"]').trigger('click')
    expect(mount(StepViewer).text()).not.toContain('스텝을 만들 때 캡처한 화면')
  })
})

describe('StepViewer — 편집 세션(Task 8)', () => {
  beforeEach(() => { setActivePinia(createPinia()); localStorage.clear(); vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }) })
  afterEach(() => { vi.unstubAllGlobals() })
  const OTHER = { from: 'other', process: 'P', model: 'M', name: 'A', crtime: 1, fileId: 'F' }

  it('다른 판 기준 화면으로 시작한 새 스텝도 그 그림을 불러오지 못하면 같은 안내', async () => {
    const { e } = panelFixture([imageStep(0, { uid: 'p1', origin: null, images: { train: {}, base: { ...OTHER, id: 's1-bi' } } })])
    e.startNew('image')
    const w = mount(StepViewer)
    expect(w.find('[data-testid="se-base-image"]').attributes('src')).toContain('/scenario-editor/scenarios/P/M/A/versions/1/files/F/images/s1-bi')
    await w.find('[data-testid="se-base-image"]').trigger('error')
    expect(w.text()).toContain('원래 시나리오의 그 버전을 찾지 못했습니다')
    w.unmount()
  })
  it('스텝이 0개인 쓸 수 있는 세션은 "기준 화면이 아직 없습니다"(목업 조작판 20)', () => {
    panelFixture([])
    const w = mount(StepViewer)
    expect(w.text()).toContain(t('SEW_EDIT_VIEWER_EMPTY'))
    w.unmount()
  })
})

describe('CropView', () => {
  const mk = (props) => mount(CropView, { props: { src: 'http://x/a.png', width: 100, ...props } })
  const load = async (w, nw = 400, nh = 200) => { w.vm.onLoad({ target: { naturalWidth: nw, naturalHeight: nh } }); await w.vm.$nextTick() }

  it('영역을 너비에 맞춰 잘라 보여 준다', async () => {
    const w = mk({ rect: { x: 100, y: 50, w: 200, h: 100 } })
    await load(w)
    expect(w.element.getAttribute('style')).toContain('width: 100px')
    expect(w.element.getAttribute('style')).toContain('height: 50px')
    const img = w.find('img').attributes('style')
    expect(img).toContain('left: -50px')
    expect(img).toContain('top: -25px')
    expect(img).toContain('width: 200px')
  })
  it('영역이 없으면 이미지 전체', async () => {
    const w = mk({})
    await load(w, 400, 200)
    expect(w.element.getAttribute('style')).toContain('height: 50px')
  })
  it('표시 안의 클릭 지점은 십자로 그리고 밖이면 outside 를 알린다(밖이어도 넓혀 십자를 그린다 — 2026-11-08 사용자 보고)', async () => {
    const inside = mk({ rect: { x: 0, y: 0, w: 200, h: 100 }, marker: { x: 100, y: 50 } })
    await load(inside)
    expect(inside.find('[data-testid="se-click-marker"]').attributes('style')).toContain('left: 50px')
    expect(inside.emitted('outside')[0]).toEqual([false])
    const outside = mk({ rect: { x: 0, y: 0, w: 200, h: 100 }, marker: { x: 300, y: 50 } })
    await load(outside)
    expect(outside.find('[data-testid="se-click-marker"]').exists()).toBe(true)
    expect(outside.emitted('outside')[0]).toEqual([true])
  })
  it('불러오지 못하면 없음 표시', async () => {
    const w = mk({})
    await w.find('img').trigger('error')
    expect(w.text()).toContain('없음')
  })
  it('불러오지 못했을 때 보일 문구를 받으면 그 문구(다른 판 그림 — Task 8)', async () => {
    const w = mk({ failText: '원래 시나리오의 그 버전을 찾지 못했습니다.' })
    await w.find('img').trigger('error')
    expect(w.text()).toBe('원래 시나리오의 그 버전을 찾지 못했습니다.')
  })
  it('src 가 바뀌면 불러오기 실패 표시를 지운다', async () => {
    const w = mk({})
    await w.find('img').trigger('error')
    expect(w.text()).toContain('없음')
    await w.setProps({ src: 'http://x/b.png' })
    expect(w.text()).not.toContain('없음')
  })
  it('표시 영역이 정해져 있으면 불러오기를 기다리지 않고 outside 를 알린다', () => {
    const w = mk({ rect: { x: 0, y: 0, w: 200, h: 100 }, marker: { x: 300, y: 50 } })
    expect(w.emitted('outside')).toEqual([[true]])
  })
  it('이미지가 불러와진 채 표시 영역·클릭 지점이 바뀌면 outside 를 다시 알린다', async () => {
    const w = mk({ rect: { x: 0, y: 0, w: 200, h: 100 }, marker: { x: 100, y: 50 } })
    await load(w)
    expect(w.emitted('outside')).toEqual([[false]])
    await w.setProps({ marker: { x: 300, y: 50 } })
    expect(w.emitted('outside')).toEqual([[false], [true]])
    await w.setProps({ rect: { x: 0, y: 0, w: 400, h: 100 } })
    expect(w.emitted('outside')).toEqual([[false], [true], [false]])
  })
  it('영역을 모르면(전체 보기·불러오기 전) outside 를 알리지 않는다', async () => {
    const w = mk({ marker: { x: 100, y: 50 } })
    expect(w.emitted('outside')).toBeUndefined()
    await load(w, 400, 200)
    expect(w.emitted('outside')).toEqual([[false]])
  })

  // 찾을 그림 밖 누를 곳(A·B): 그 지점까지 넓혀 그린다(목업 trainThumb). 찾을 그림 255×96(시드 RESET).
  const px = (el, prop) => parseFloat(el.element.style[prop])
  const AROUND = { src: 'http://x/base.png', x: 711, y: 660, bw: 1920, bh: 1200 }
  it('누를 곳이 그림 밖이면 그 지점까지 넓혀 찾을 그림은 제자리에 테두리, 넓힌 곳은 빗금(저장된 화면 없음), 누를 곳 + 를 그린다', async () => {
    const w = mk({ marker: { x: 300, y: 12 } })
    await load(w, 255, 96)
    const v = thumbView({ w: 255, h: 96 }, { x: 300, y: 12 })
    expect(w.attributes('data-expand')).toBe('empty')
    expect(w.attributes('title')).toBe(t('SEW_UI_SPOT_EMPTY_TITLE'))
    expect(w.element.style.backgroundImage).toContain('repeating-linear-gradient')
    expect(w.classes()).toContain('border-dashed')
    expect(px(w, 'width')).toBe(Math.round(v.W * v.k))
    expect(px(w, 'height')).toBe(Math.round(v.H * v.k))
    const box = w.find('[data-testid="se-crop-train"]')
    expect(box.classes()).toEqual(expect.arrayContaining(['border-teal-600', 'dark:border-teal-400']))
    expect(px(box, 'left')).toBeCloseTo(-v.x1 * v.k, 6)
    expect(px(box, 'top')).toBeCloseTo(-v.y1 * v.k, 6)
    expect(px(box, 'width')).toBeCloseTo(255 * v.k, 6)
    expect(px(box, 'height')).toBeCloseTo(96 * v.k, 6)
    const img = w.find('img')
    expect(px(img, 'left')).toBeCloseTo(-v.x1 * v.k, 6)
    expect(px(img, 'top')).toBeCloseTo(-v.y1 * v.k, 6)
    expect(px(img, 'width')).toBeCloseTo(255 * v.k, 6)
    const m = w.find('[data-testid="se-click-marker"]')
    expect(px(m, 'left')).toBeCloseTo((300 - v.x1) * v.k, 6)
    expect(px(m, 'top')).toBeCloseTo((12 - v.y1) * v.k, 6)
    expect(w.find('[data-testid="se-crop-around"]').exists()).toBe(false)
    expect(w.emitted('outside')).toEqual([[true]])
  })
  it('네 방향 밖·아주 먼 점 모두 + 전체(반 길이 8px)를 보일 영역 안에 그린다', async () => {
    for (const marker of [{ x: 300, y: 12 }, { x: -3, y: 7 }, { x: 100, y: -40 }, { x: 100, y: 400 }, { x: 5000, y: 3000 }]) {
      const w = mk({ marker })
      await load(w, 255, 96)
      const m = w.find('[data-testid="se-click-marker"]')
      expect(m.exists(), JSON.stringify(marker)).toBe(true)
      expect(px(m, 'left'), JSON.stringify(marker)).toBeGreaterThanOrEqual(8 - 1e-3)
      expect(px(m, 'left') + 8).toBeLessThanOrEqual(px(w, 'width') + 0.5) // 상자 너비는 반올림
      expect(px(m, 'top')).toBeGreaterThanOrEqual(8 - 1e-3)
      expect(px(m, 'top') + 8).toBeLessThanOrEqual(px(w, 'height') + 0.5)
      expect(px(w, 'width')).toBeLessThanOrEqual(300)
      expect(px(w, 'height')).toBeLessThanOrEqual(150)
    }
  })
  it('기준 화면에서 찾은 자리(around)가 있으면 넓힌 부분을 그 기준 화면으로 채운다(찾을 그림 테두리는 그대로)', async () => {
    const w = mk({ marker: { x: -3, y: 7 }, around: AROUND })
    await load(w, 255, 96)
    const v = thumbView({ w: 255, h: 96 }, { x: -3, y: 7 })
    expect(w.attributes('data-expand')).toBe('base')
    expect(w.attributes('title')).toBeUndefined()
    expect(w.element.style.backgroundImage).toBe('')
    const bg = w.find('[data-testid="se-crop-around"]')
    expect(bg.attributes('src')).toBe('http://x/base.png')
    expect(px(bg, 'left')).toBeCloseTo((-711 - v.x1) * v.k, 6)
    expect(px(bg, 'top')).toBeCloseTo((-660 - v.y1) * v.k, 6)
    expect(px(bg, 'width')).toBeCloseTo(1920 * v.k, 6)
    const imgs = w.findAll('img')
    expect(imgs.map((x) => x.attributes('data-testid') ?? 'train')).toEqual(['se-crop-around', 'train']) // 찾을 그림이 위
    expect(w.find('[data-testid="se-crop-train"]').exists()).toBe(true)
    expect(w.find('[data-testid="se-click-marker"]').exists()).toBe(true)
  })
  it('누를 곳이 그림 안이면 around 가 있어도 지금과 같다(넓히지 않고 채우지 않음)', async () => {
    const w = mk({ rect: { x: 0, y: 0, w: 200, h: 100 }, marker: { x: 100, y: 50 }, around: AROUND })
    await load(w)
    expect(w.attributes('data-expand')).toBeUndefined()
    expect(w.attributes('style')).toContain('width: 100px')
    expect(w.attributes('style')).toContain('height: 50px')
    expect(w.classes()).not.toContain('border-dashed')
    expect(w.find('[data-testid="se-crop-around"]').exists()).toBe(false)
    expect(w.find('[data-testid="se-crop-train"]').exists()).toBe(false)
    expect(w.find('[data-testid="se-click-marker"]').attributes('style')).toContain('left: 50px')
  })
  it('누를 곳이 밖이 됐다가 다시 안이 되면 원래 크기로 돌아온다(그림은 다시 불러오지 않는다)', async () => {
    const w = mk({ marker: { x: 24, y: 12 } })
    await load(w, 255, 96)
    const img = w.find('img').element
    expect(w.attributes('style')).toContain('width: 100px')
    await w.setProps({ marker: { x: 300, y: 12 } })
    expect(w.attributes('data-expand')).toBe('empty')
    await w.setProps({ marker: { x: 24, y: 12 } })
    expect(w.attributes('data-expand')).toBeUndefined()
    expect(w.attributes('style')).toContain('width: 100px')
    expect(w.find('img').element).toBe(img)
  })
})

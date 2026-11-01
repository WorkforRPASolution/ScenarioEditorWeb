import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
vi.mock('../api', () => ({ imageUrl: (p) => `http://x/api${p}` }))
import StepViewer from '../components/StepViewer.vue'
import CropView from '../components/CropView.vue'
import { useEditorStore } from '../stores/editorStore'

const step = (over = {}) => ({ uid: 's0', no: 1, notes: [], action: {}, next: {}, retry: {},
  condition: { kind: 'image', searchArea: { x: 576, y: 336, w: 846, h: 480 } }, baseImage: { state: 'present', url: '/scenario-editor/x/images/s0-bi' }, ...over })

describe('StepViewer', () => {
  beforeEach(() => { setActivePinia(createPinia()); localStorage.clear() })
  const open = (s) => { const st = useEditorStore(); st.skeleton = { steps: [s], notes: [] }; st.selectedUid = s.uid }

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
    open(step())
    const w = mount(StepViewer, { attachTo: document.body })
    w.vm.onLoad({ target: { naturalWidth: 1000, naturalHeight: 500 } }); await w.vm.$nextTick()
    const layer = () => w.find('[data-testid="se-base-image"]').element.parentElement.style.transform
    const scale = () => Number(/scale\(([\d.]+)\)/.exec(layer())[1])
    const fitted = layer()
    const s0 = scale()
    await w.find('[data-testid="se-viewer"] .select-none').trigger('wheel', { deltaY: -100, clientX: 50, clientY: 50 })
    expect(scale()).toBeGreaterThan(s0)
    await w.find('[data-testid="se-viewer"] .select-none').trigger('wheel', { deltaY: 100, clientX: 50, clientY: 50 })
    expect(scale()).toBeCloseTo(s0, 5)
    const before = layer()
    await w.find('[data-testid="se-viewer"] .select-none').trigger('mousedown', { clientX: 10, clientY: 10 })
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 60, clientY: 40 }))
    await w.vm.$nextTick()
    expect(layer()).not.toBe(before)
    window.dispatchEvent(new MouseEvent('mouseup'))
    const dragged = layer()
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 200, clientY: 200 }))
    await w.vm.$nextTick()
    expect(layer()).toBe(dragged)
    w.vm.fit(); await w.vm.$nextTick()
    expect(layer()).toBe(fitted)
    w.unmount()
  })
  it('처음 한 번 기준 화면 안내, 닫으면 다시 안 보임', async () => {
    open(step())
    const w = mount(StepViewer)
    expect(w.text()).toContain('스텝을 만들 때 캡처한 화면')
    await w.find('[data-testid="se-hint-close"]').trigger('click')
    expect(mount(StepViewer).text()).not.toContain('스텝을 만들 때 캡처한 화면')
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
  it('표시 안의 클릭 지점은 십자로 그리고 밖이면 outside 를 알린다', async () => {
    const inside = mk({ rect: { x: 0, y: 0, w: 200, h: 100 }, marker: { x: 100, y: 50 } })
    await load(inside)
    expect(inside.find('[data-testid="se-click-marker"]').attributes('style')).toContain('left: 50px')
    expect(inside.emitted('outside')[0]).toEqual([false])
    const outside = mk({ rect: { x: 0, y: 0, w: 200, h: 100 }, marker: { x: 300, y: 50 } })
    await load(outside)
    expect(outside.find('[data-testid="se-click-marker"]').exists()).toBe(false)
    expect(outside.emitted('outside')[0]).toEqual([true])
  })
  it('불러오지 못하면 없음 표시', async () => {
    const w = mk({})
    await w.find('img').trigger('error')
    expect(w.text()).toContain('없음')
  })
})

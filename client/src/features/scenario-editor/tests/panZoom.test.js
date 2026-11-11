// 확대·이동(큰 화면의 스텝 그림·스냅샷이 함께 쓴다) — 맞춤·1:1·직접 움직임 (P3 설계 §4.3)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import { usePanZoom } from '../composables/usePanZoom'

describe('usePanZoom', () => {
  let observers
  class FakeResizeObserver {
    constructor(cb) { this.cb = cb; this.disconnect = vi.fn(); observers.push(this) }
    observe() {}
    unobserve() {}
  }
  beforeEach(() => { observers = []; vi.stubGlobal('ResizeObserver', FakeResizeObserver) })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  const Host = defineComponent({
    setup(_, { expose }) {
      const box = ref(null)
      const natural = ref(null)
      const pz = usePanZoom(box, natural)
      expose({ pz, natural })
      return () => h('div', { ref: box, class: 'box', onWheel: pz.onWheel, onMousedown: pz.onDown })
    }
  })
  // happy-dom 은 레이아웃이 없다 — 상자 크기를 직접 정하고 크기 관찰을 깨운다
  const mountSized = (cw = 800, ch = 400, nat = { w: 1000, h: 500 }) => {
    const w = mount(Host, { attachTo: document.body })
    const el = w.find('.box').element
    const sz = { w: cw, h: ch }
    Object.defineProperty(el, 'clientWidth', { get: () => sz.w, configurable: true })
    Object.defineProperty(el, 'clientHeight', { get: () => sz.h, configurable: true })
    const resize = (nw, nh) => { sz.w = nw; sz.h = nh; observers.forEach((o) => o.cb([])) }
    resize(cw, ch)
    w.vm.natural = nat
    w.vm.pz.fit()
    return { w, pz: w.vm.pz, resize }
  }
  const view = (pz) => ({ scale: pz.view.scale, tx: pz.view.tx, ty: pz.view.ty })

  it('맞춤: 상자에 98% 로 넣고 가운데에', () => {
    const { w, pz } = mountSized()
    expect(pz.view.scale).toBeCloseTo(0.784, 5)
    expect(pz.view.tx).toBeCloseTo(8, 5)
    expect(pz.view.ty).toBeCloseTo(4, 5)
    w.unmount()
  })
  it('1:1: 배율 1 이고 상자 가운데에 있던 그림 점이 그대로 가운데다', () => {
    const { w, pz } = mountSized()
    pz.actual()
    expect(pz.view.scale).toBe(1)
    // 맞춤 상태에서 상자 가운데(400, 200)는 그림의 (500, 250)
    expect((400 - pz.view.tx) / pz.view.scale).toBeCloseTo(500, 5)
    expect((200 - pz.view.ty) / pz.view.scale).toBeCloseTo(250, 5)
    w.unmount()
  })
  it('1:1 의 배율은 어림값이 아니라 정확히 1 이다(배율 × 1/배율 로 구하면 0.9999999999999999 가 나오는 상자 크기가 있다)', () => {
    for (const [cw, ch] of [[303, 300], [650, 417], [1011, 533], [777, 391]]) {
      const { w, pz } = mountSized(cw, ch, { w: 640, h: 360 })
      pz.actual()
      expect(pz.view.scale, `${cw}×${ch}`).toBe(1)
      w.unmount()
    }
  })
  it('1:1 은 직접 움직인 것으로 친다 — 상자 크기가 바뀌어도 다시 맞추지 않고, 맞춤 뒤에는 다시 따라간다', () => {
    const { w, pz, resize } = mountSized()
    pz.actual()
    const at = view(pz)
    resize(1000, 500)
    expect(view(pz)).toEqual(at)
    pz.fit()
    expect(pz.view.scale).toBeCloseTo(0.98, 5)
    resize(800, 400)
    expect(pz.view.scale).toBeCloseTo(0.784, 5)
    w.unmount()
  })
  it('setView: 준 값 그대로, 직접 움직인 것으로 친다', () => {
    const { w, pz, resize } = mountSized()
    pz.setView({ scale: 2, tx: -30, ty: 12 })
    expect(view(pz)).toEqual({ scale: 2, tx: -30, ty: 12 })
    resize(1000, 500)
    expect(view(pz)).toEqual({ scale: 2, tx: -30, ty: 12 })
    w.unmount()
  })
  it('휠은 마우스 자리를 고정하고 1.15배씩, 배율은 0.05~8', async () => {
    const { w, pz } = mountSized()
    const before = view(pz)
    await w.find('.box').trigger('wheel', { deltaY: -100, clientX: 0, clientY: 0 })
    expect(pz.view.scale).toBeCloseTo(before.scale * 1.15, 5)
    for (let i = 0; i < 80; i++) pz.zoomButton(1.25)
    expect(pz.view.scale).toBe(8)
    for (let i = 0; i < 80; i++) pz.zoomButton(0.8)
    expect(pz.view.scale).toBe(0.05)
    w.unmount()
  })
  it('그림 크기를 모르면 맞춤·1:1 이 아무것도 바꾸지 않는다', () => {
    const { w, pz } = mountSized(800, 400, null)
    expect(view(pz)).toEqual({ scale: 1, tx: 0, ty: 0 })
    pz.actual()
    expect(view(pz)).toEqual({ scale: 1, tx: 0, ty: 0 })
    w.unmount()
  })
  it('상자가 0×0 이면 맞추기를 미뤘다가 크기가 생기면 맞춘다', () => {
    const { w, pz, resize } = mountSized(0, 0)
    expect(view(pz)).toEqual({ scale: 1, tx: 0, ty: 0 })
    resize(800, 400)
    expect(pz.view.scale).toBeCloseTo(0.784, 5)
    w.unmount()
  })
  it('끌어서 이동, 사라질 때 크기 관찰과 끌기 이벤트를 놓는다', async () => {
    const { w, pz } = mountSized()
    const before = view(pz)
    await w.find('.box').trigger('mousedown', { button: 0, clientX: 10, clientY: 10 })
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 60, clientY: 40 }))
    expect(pz.view.tx).toBeCloseTo(before.tx + 50, 5)
    expect(pz.view.ty).toBeCloseTo(before.ty + 30, 5)
    const remove = vi.spyOn(window, 'removeEventListener')
    w.unmount()
    expect(observers[0].disconnect).toHaveBeenCalled()
    expect(remove.mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining(['mousemove', 'mouseup']))
  })
})

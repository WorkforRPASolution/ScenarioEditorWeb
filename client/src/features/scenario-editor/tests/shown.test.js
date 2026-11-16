// 숨겨졌던 요소가 다시 보일 때(크기 0 → 0 아님) 한 번 부른다 — 접힌 스텝 목록을 펼 때 고른 줄로 다시 맞추려고(SEW-026 독립 검토)
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, enableAutoUnmount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import { useShown } from '../composables/useShown'

enableAutoUnmount(afterEach)
afterEach(() => vi.unstubAllGlobals())

function fakeObserver() {
  const made = []
  vi.stubGlobal('ResizeObserver', class {
    constructor(cb) { this.cb = cb; this.targets = []; this.off = false; made.push(this) }
    observe(el) { this.targets.push(el) }
    disconnect() { this.off = true }
  })
  return made
}
const host = (onShown) => defineComponent({
  setup() {
    const el = ref(null)
    useShown(el, onShown)
    return () => h('div', { ref: el })
  }
})
const size = (w, h2) => [{ contentRect: { width: w, height: h2 } }]

describe('useShown', () => {
  it('크기가 0 이었다가 생기면 부른다 — 처음 보일 때와 크기만 바뀔 때는 부르지 않는다', () => {
    const made = fakeObserver()
    const onShown = vi.fn()
    const w = mount(host(onShown))
    expect(made).toHaveLength(1)
    expect(made[0].targets).toEqual([w.element])
    made[0].cb(size(800, 250)) // 처음 — 보이는 채로 시작
    made[0].cb(size(800, 400)) // 크기만 바뀜
    expect(onShown).not.toHaveBeenCalled()
    made[0].cb(size(0, 0)) // 숨김(display: none)
    expect(onShown).not.toHaveBeenCalled()
    made[0].cb(size(800, 250)) // 다시 보임
    expect(onShown).toHaveBeenCalledTimes(1)
    made[0].cb(size(800, 0))
    made[0].cb(size(800, 300))
    expect(onShown).toHaveBeenCalledTimes(2)
  })
  it('숨은 채로 시작했으면 처음 보일 때 부른다(접힌 채 새로고침)', () => {
    const made = fakeObserver()
    const onShown = vi.fn()
    mount(host(onShown))
    made[0].cb(size(0, 0))
    made[0].cb(size(800, 250))
    expect(onShown).toHaveBeenCalledTimes(1)
  })
  it('내릴 때 감시를 끊고, ResizeObserver 가 없는 환경에서도 던지지 않는다', () => {
    const made = fakeObserver()
    const w = mount(host(vi.fn()))
    w.unmount()
    expect(made[0].off).toBe(true)
    vi.stubGlobal('ResizeObserver', undefined)
    expect(() => mount(host(vi.fn()))).not.toThrow()
  })
})

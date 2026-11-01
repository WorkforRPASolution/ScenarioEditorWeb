import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useLayoutSizes, LAYOUT_DEFAULTS } from '../composables/useLayoutSizes'

describe('useLayoutSizes', () => {
  beforeEach(() => localStorage.clear())
  it('기본값, 끌기, 한계, 저장, 두 번 누르면 기본값', () => {
    const { sizes, startDrag, reset } = useLayoutSizes()
    expect({ ...sizes }).toEqual(LAYOUT_DEFAULTS)
    startDrag('rw', { clientX: 1000, preventDefault() {} }, -1, 'x')
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 900 }))
    window.dispatchEvent(new MouseEvent('mouseup'))
    expect(sizes.rw).toBe(470)
    expect(JSON.parse(localStorage.getItem('se-layout')).rw).toBe(470)
    startDrag('rw', { clientX: 0, preventDefault() {} }, -1, 'x')
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: -5000 }))
    window.dispatchEvent(new MouseEvent('mouseup'))
    expect(sizes.rw).toBe(620)
    reset('rw')
    expect(sizes.rw).toBe(370)
  })
  it('저장된 값을 읽는다', () => {
    localStorage.setItem('se-layout', JSON.stringify({ rw: 400, sh: 300 }))
    expect({ ...useLayoutSizes().sizes }).toEqual({ ...LAYOUT_DEFAULTS, rw: 400, sh: 300 })
  })
  it('localStorage 가 예외를 내도 기본값으로 동작한다', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    const spy2 = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    const { sizes, reset } = useLayoutSizes()
    expect({ ...sizes }).toEqual(LAYOUT_DEFAULTS)
    expect(() => reset('sh')).not.toThrow()
    spy.mockRestore(); spy2.mockRestore()
  })
  it('깨진 저장 값은 무시한다', () => {
    localStorage.setItem('se-layout', '{oops')
    expect({ ...useLayoutSizes().sizes }).toEqual(LAYOUT_DEFAULTS)
  })
})

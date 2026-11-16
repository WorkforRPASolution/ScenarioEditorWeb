import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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
  it('접기(사내 요청): 처음에는 펴져 있고, 접으면 저장되어 다시 켤 때 접힌 채다 — 크기 값은 그대로 남는다', () => {
    const { sizes, folded, setFolded } = useLayoutSizes()
    expect({ ...folded }).toEqual({ right: false, steps: false })
    setFolded('right', true)
    setFolded('steps', true)
    expect({ ...folded }).toEqual({ right: true, steps: true })
    expect(JSON.parse(localStorage.getItem('se-layout'))).toEqual({ ...LAYOUT_DEFAULTS, foldRight: true, foldSteps: true })
    expect({ ...useLayoutSizes().folded }).toEqual({ right: true, steps: true })
    setFolded('right', false)
    expect({ ...useLayoutSizes().folded }).toEqual({ right: false, steps: true })
    expect({ ...sizes }).toEqual(LAYOUT_DEFAULTS)
    // 모르는 이름·참이 아닌 저장값은 펴진 것으로
    setFolded('nope', true)
    expect({ ...folded }).toEqual({ right: false, steps: true })
    localStorage.setItem('se-layout', JSON.stringify({ foldRight: 'yes', foldSteps: 1 }))
    expect({ ...useLayoutSizes().folded }).toEqual({ right: false, steps: false })
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
  it('범위를 벗어난 저장 값은 한계 안으로 맞춘다', () => {
    localStorage.setItem('se-layout', JSON.stringify({ rw: 5000, sh: 0, lw: -3 }))
    expect({ ...useLayoutSizes().sizes }).toEqual({ lw: 180, rw: 620, sh: 120 })
    localStorage.setItem('se-layout', JSON.stringify({ rw: -3 }))
    expect(useLayoutSizes().sizes.rw).toBe(300)
  })
  describe('화면 크기에 맞춘 상한', () => {
    const origW = window.innerWidth
    const origH = window.innerHeight
    const setViewport = (w, h) => { window.innerWidth = w; window.innerHeight = h }
    afterEach(() => setViewport(origW, origH))

    it('저장된 sh 가 화면 높이보다 크면 화면 높이 - 260 으로 줄인다', () => {
      setViewport(1600, 600)
      localStorage.setItem('se-layout', JSON.stringify({ sh: 1500 }))
      expect(useLayoutSizes().sizes.sh).toBe(340)
    })
    it('저장된 rw 가 화면 너비보다 크면 화면 너비 - 400 으로 줄인다', () => {
      setViewport(800, 900)
      localStorage.setItem('se-layout', JSON.stringify({ rw: 600 }))
      expect(useLayoutSizes().sizes.rw).toBe(400)
    })
    it('저장된 lw(스냅샷 패널)가 화면 너비 - 1100 보다 크면 그만큼으로 줄인다 — 하한 180 아래로는 안 간다', () => {
      setViewport(1400, 900)
      localStorage.setItem('se-layout', JSON.stringify({ lw: 460 }))
      expect(useLayoutSizes().sizes.lw).toBe(300)
      setViewport(1200, 900)
      expect(useLayoutSizes().sizes.lw).toBe(180)
      setViewport(1920, 1080)
      expect(useLayoutSizes().sizes.lw).toBe(460)
    })
    it('화면이 아주 작아 상한이 하한 밑이면 하한을 쓴다', () => {
      setViewport(500, 300)
      localStorage.setItem('se-layout', JSON.stringify({ rw: 600, sh: 900 }))
      const { sizes } = useLayoutSizes()
      expect([sizes.rw, sizes.sh]).toEqual([300, 120])
    })
    it('끌 때도 같은 상한이 적용된다', () => {
      setViewport(1600, 600)
      const { sizes, startDrag } = useLayoutSizes()
      startDrag('sh', { clientY: 500, preventDefault() {} }, -1, 'y')
      window.dispatchEvent(new MouseEvent('mousemove', { clientY: -3000 }))
      window.dispatchEvent(new MouseEvent('mouseup'))
      expect(sizes.sh).toBe(340)
    })
  })
  it('깨진 저장 값은 무시한다', () => {
    localStorage.setItem('se-layout', '{oops')
    expect({ ...useLayoutSizes().sizes }).toEqual(LAYOUT_DEFAULTS)
  })
})

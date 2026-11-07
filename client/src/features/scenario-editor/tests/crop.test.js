import { describe, it, expect } from 'vitest'
import { clampRect } from '../editor/crop'

describe('clampRect', () => {
  it('정수로 맞추고 그림 안으로 자른다', () => {
    expect(clampRect({ x: -5.4, y: 2.2, w: 50, h: 10.7 }, 40, 30)).toEqual({ x: 0, y: 2, w: 40, h: 11 })
  })
  it('빈 영역은 null', () => {
    expect(clampRect({ x: 50, y: 0, w: 10, h: 10 }, 40, 30)).toBeNull()
  })
})

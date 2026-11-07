import { describe, it, expect } from 'vitest'
import { locate } from '../editor/locate'

// 합성 이미지: 잡음 바탕(결정적) 위에 무늬를 올린다.
const img = (w, h, fn) => {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b] = fn(x, y); const i = (y * w + x) * 4
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255
  }
  return { width: w, height: h, data }
}
const noise = (x, y) => [(x * 37 + y * 11) % 251, (x * 7 + y * 53) % 241, (x * 3 + y * 5 + x * y) % 239]
const patch = (w, h) => img(w, h, (x, y) => [10 + x * 9, 200 - y * 7, (x * y * 3) % 256])
const stamp = (base, p, ox, oy) => {
  for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) {
    const s = (y * p.width + x) * 4, d = ((oy + y) * base.width + ox + x) * 4
    base.data[d] = p.data[s]; base.data[d + 1] = p.data[s + 1]; base.data[d + 2] = p.data[s + 2]
  }
}
const fresh = () => img(120, 80, noise)
const full = { x: 0, y: 0, w: 120, h: 80 }
const t = patch(10, 8)
const solid = (w, h, c) => img(w, h, () => c)

const cases = [
  ['한 곳', () => { const b = fresh(); stamp(b, t, 30, 20); return [b, t, full] }, { found: 'one', x: 30, y: 20 }],
  ['없음', () => [fresh(), t, full], { found: 'none' }],
  ['두 곳', () => { const b = fresh(); stamp(b, t, 30, 20); stamp(b, t, 80, 50); return [b, t, full] }, { found: 'many' }],
  ['영역 경계에 걸침(완전히 안이면 찾고 반 걸치면 못 찾는다)', () => { const b = fresh(); stamp(b, t, 40, 30); return [b, t, { x: 40, y: 30, w: 10, h: 8 }] }, { found: 'one', x: 40, y: 30 }],
  ['영역 경계에 반만 걸침', () => { const b = fresh(); stamp(b, t, 40, 30); return [b, t, { x: 45, y: 30, w: 30, h: 20 }] }, { found: 'none' }],
  ['영역 밖에만 있음', () => { const b = fresh(); stamp(b, t, 100, 60); return [b, t, { x: 0, y: 0, w: 60, h: 40 }] }, { found: 'none' }],
  ['단색 그림', () => { const c = [5, 6, 7]; const b = fresh(); stamp(b, solid(6, 6, c), 20, 10); return [b, solid(6, 6, c), full] }, { found: 'one', x: 20, y: 10 }],
  ['1x1 그림(한 곳)', () => { const b = fresh(); b.data.set([250, 1, 2, 255], (5 * 120 + 7) * 4); b.data.set([251, 1, 2, 255], (6 * 120 + 7) * 4); return [b, img(1, 1, () => [250, 1, 2]), full] }, { found: 'one', x: 7, y: 5 }],
  ['영역보다 큰 그림', () => { const b = fresh(); stamp(b, t, 30, 20); return [b, t, { x: 30, y: 20, w: 9, h: 8 }] }, { found: 'none' }],
  ['영역이 화면 밖', () => [fresh(), t, { x: 500, y: 500, w: 20, h: 20 }], { found: 'none' }]
]

describe('locate', () => {
  it.each(cases)('%s', (_n, make, want) => {
    const [b, tr, area] = make()
    expect(locate(b, tr, area, {})).toEqual(want)
  })
  it('시간 초과: 주입한 now 가 3초를 넘기면 timeout', () => {
    let clock = 0
    const now = () => (clock += 1000)
    const b = fresh()
    expect(locate(b, t, full, { now })).toEqual({ found: 'timeout' })
  })
  it('1920x1080 에서 3초 안에 끝난다', () => {
    const b = img(1920, 1080, noise); const tr = patch(60, 40); stamp(b, tr, 1500, 900)
    const s = Date.now()
    expect(locate(b, tr, { x: 0, y: 0, w: 1920, h: 1080 }, {})).toEqual({ found: 'one', x: 1500, y: 900 })
    console.log('locate 1920x1080 ms', Date.now() - s)
  })
})

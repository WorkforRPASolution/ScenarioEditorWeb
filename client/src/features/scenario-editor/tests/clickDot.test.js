import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ClickDot from '../components/ClickDot.vue'

// 클릭한 곳·누를 곳 점(스냅샷의 클릭 점, Vision 시험의 누를 곳, [누를 곳 보기]) — 세 곳이 같은 점을 쓴다. 색·움직임은 snapshot.css(E2E 가 본다).
describe('ClickDot', () => {
  const dotOf = (props) => mount(ClickDot, { props, attrs: { 'data-testid': 'd' } }).find('[data-testid="d"]')
  it('그림 좌표에 두고, 확대해도 화면에서 같은 크기가 되게 통째로 배율만큼 줄인다 — 테 두께를 px 로 나누지 않는다(1px 아래로는 그려지지 않는다)', () => {
    const d = dotOf({ x: 40, y: 30, scale: 4 })
    const s = d.attributes('style')
    expect(d.classes()).toContain('se-snap-dot')
    expect(s).toContain('left: 40px')
    expect(s).toContain('top: 30px')
    expect(s).toContain('transform: translate(-50%, -50%) scale(0.25)')
    expect(s).not.toContain('width')
    expect(s).not.toContain('border')
  })
  it('배율이 0 이하이면 1 로 본다', () => {
    expect(dotOf({ x: 1, y: 2, scale: 0 }).attributes('style')).toContain('scale(1)')
  })
  it('누름을 받지 않는다', () => {
    expect(dotOf({ x: 1, y: 2, scale: 1 }).classes()).toContain('pointer-events-none')
  })
})

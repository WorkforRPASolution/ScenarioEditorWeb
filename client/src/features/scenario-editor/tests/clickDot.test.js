import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ClickDot from '../components/ClickDot.vue'

// 클릭한 곳·누를 곳 점(스냅샷의 클릭 점, Vision 시험의 누를 곳, [누를 곳 보기]) — 세 곳이 같은 점을 쓴다. 색·움직임은 snapshot.css(E2E 가 본다).
describe('ClickDot', () => {
  const styleOf = (props) => mount(ClickDot, { props, attrs: { 'data-testid': 'd' } }).find('[data-testid="d"]')
  it('그림 좌표에 두고, 확대해도 화면에서 같은 크기(12px·테 2px)가 되게 배율로 나눈다', () => {
    const d = styleOf({ x: 40, y: 30, scale: 2 })
    const s = d.attributes('style')
    expect(d.classes()).toContain('se-snap-dot')
    expect(s).toContain('left: 40px')
    expect(s).toContain('top: 30px')
    expect(s).toContain('width: 6px')
    expect(s).toContain('height: 6px')
    expect(s).toContain('margin-left: -3px')
    expect(s).toContain('margin-top: -3px')
    expect(s).toContain('border-width: 1px')
    expect(s).toContain('--k: 0.5') // 어두운 가는 테(box-shadow)도 배율로 나눈다
  })
  it('배율이 0 이하이면 1 로 본다', () => {
    expect(styleOf({ x: 1, y: 2, scale: 0 }).attributes('style')).toContain('width: 12px')
  })
  it('누름을 받지 않는다', () => {
    expect(styleOf({ x: 1, y: 2, scale: 1 }).classes()).toContain('pointer-events-none')
  })
})

// 바뀐 값 글에서 실제로 바뀐 부분 찾기(2026-11-10 사용자 요청: 글의 일부만 바뀌면 색으로 구분)
import { describe, it, expect } from 'vitest'
import { diffParts } from '../editor/textDiff'

// [바뀐 부분] 을 대괄호로 표시한 글
const mark = (parts) => parts.map((p) => (p.changed ? `[${p.text}]` : p.text)).join('')
const both = (a, b) => { const r = diffParts(a, b); return `${mark(r.before)} → ${mark(r.after)}` }

describe('diffParts', () => {
  it.each([
    ['명령 실행 restart.bat', '명령 실행 restart2.bat', '명령 실행 restart.bat → 명령 실행 restart[2].bat'],
    ['명령 실행 restart.bat -a', '명령 실행 restart.bat -b', '명령 실행 restart.bat -[a] → 명령 실행 restart.bat -[b]'],
    ['키보드 abc + Enter', '키보드 abd + Enter', '키보드 ab[c] + Enter → 키보드 ab[d] + Enter'],
    ['키보드 abc + Enter', '키보드 abc + Enter + Tab', '키보드 abc + Enter → 키보드 abc + Enter[ + Tab]'],
    ['스크립트 S · 인자 a, b', '스크립트 S · 인자 a, c', '스크립트 S · 인자 a, [b] → 스크립트 S · 인자 a, [c]'],
    ['IDLE 확인', 'IDLE 상태 확인', 'IDLE 확인 → IDLE [상태 ]확인'],
    ['문자 같음 IDLE', '문자 같음 RUN', '문자 같음 [IDLE] → 문자 같음 [RUN]'],
    ['마우스 클릭 (24, 12)', '마우스 클릭 (24, 15)', '마우스 클릭 (24, [12]) → 마우스 클릭 (24, [15])'],
    ['2회 · 2초', '3회 · 2.5초', '[2]회 · [2]초 → [3]회 · [2.5]초']
  ])('일부만 바뀌면 그 부분만 — %s → %s', (a, b, text) => {
    expect(both(a, b)).toBe(text)
  })

  it('숫자는 통째로 한 덩어리다(12 → 15 를 1[2] → 1[5] 로 쪼개지 않는다)', () => {
    expect(both('대기 120초 뒤 다음', '대기 125초 뒤 다음')).toBe('대기 [120]초 뒤 다음 → 대기 [125]초 뒤 다음')
    expect(both('정확도 값 0.90 확인', '정확도 값 0.95 확인')).toBe('정확도 값 [0.90] 확인 → 정확도 값 [0.95] 확인')
  })

  it.each([
    ['켜짐', '꺼짐'], ['보냄', '안 보냄'], ['낮음', '높음'], ['NEXT', '3번'], ['2번', '3번'], ['0.90', '0.85'], ['1개 ==', '3개 >='],
    ['알람자동조치', '설비 컨디션유지'], ['마우스 클릭 (24, 12)', '키보드 abc'], ['없음', 'NEXT_A'], ['스텝0', '새 설명']
  ])('겹치는 글이 거의 없으면(3자 미만) 색을 넣지 않는다 — %s → %s', (a, b) => {
    const r = diffParts(a, b)
    expect(r.before).toEqual([{ text: a, changed: false }])
    expect(r.after).toEqual([{ text: b, changed: false }])
  })

  it('바뀐 곳 사이에 낀 짧은 같은 글(3자 미만)은 바뀐 부분에 합친다 — 색이 조각나지 않게', () => {
    expect(both('명령 실행 abc def', '명령 실행 xyz uvw')).toBe('명령 실행 [abc def] → 명령 실행 [xyz uvw]')
    expect(both('마우스 클릭 (24, 12)', '마우스 클릭 (5, 6)')).toBe('마우스 클릭 ([24, 12]) → 마우스 클릭 ([5, 6])')
  })

  it('같은 글·빈 글은 그대로, 조각을 이으면 원래 글이다', () => {
    expect(diffParts('같다', '같다')).toEqual({ before: [{ text: '같다', changed: false }], after: [{ text: '같다', changed: false }] })
    expect(diffParts('', '새 글')).toEqual({ before: [], after: [{ text: '새 글', changed: false }] })
    for (const [a, b] of [['명령 실행 a😀b 끝', '명령 실행 a😀c 끝'], ['abc\ndef 그대로', 'abc\nxef 그대로'], ['  앞 공백 글', ' 앞 공백 글']]) {
      const r = diffParts(a, b)
      expect(r.before.map((p) => p.text).join('')).toBe(a)
      expect(r.after.map((p) => p.text).join('')).toBe(b)
    }
  })

  it('아주 긴 글도 멈추지 않는다 — 앞뒤 같은 부분만 빼고 가운데를 통째로 바뀐 부분으로', () => {
    const a = `head ${'x'.repeat(5000)} tail`
    const b = `head ${'y'.repeat(5000)} tail`
    const r = diffParts(a, b)
    expect(r.before).toEqual([{ text: 'head ', changed: false }, { text: 'x'.repeat(5000), changed: true }, { text: ' tail', changed: false }])
    expect(r.after[1]).toEqual({ text: 'y'.repeat(5000), changed: true })
  })
})

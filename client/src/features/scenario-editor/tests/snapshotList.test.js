// 스냅샷 하루 목록 규칙 — 거르기·이웃·태그 이동·클릭 점·보이는 줄 (P3 설계 §4.2·§4.3)
import { describe, it, expect } from 'vitest'
import { FILTERS, isTag, hasMemo, filterItems, stepName, nextMatch, clickPoint, expiryDays, rowWindow, scrollFor, rangeNames, nearestName } from '../editor/snapshotList'

const click = (n, x = 1, y = 2) => ({ fileName: `${n}_[${x}][${y}].png`, ms: n, kind: 'click', tag: null, x, y, txn: null, daysLeft: 15 })
const tag = (n, t = 'start') => ({ fileName: `${n}_[9999][${n}].png`, ms: n, kind: 'tag', tag: t, x: null, y: null, txn: String(n), daysLeft: 15 })
// 0 클릭 · 1 클릭 · 2 태그 · 3 클릭 · 4 클릭 · 5 태그
const SIX = [click(10), click(11), tag(12), click(13), click(14), tag(15, 'fail')]
const name = (i) => SIX[i].fileName

describe('filterItems', () => {
  it('거르기 종류는 전체·태그·메모', () => expect(FILTERS).toEqual(['all', 'tag', 'memo']))
  it('전체는 받은 배열 그대로, 태그는 태그 스냅샷만', () => {
    expect(filterItems(SIX, 'all')).toBe(SIX)
    expect(filterItems(SIX, 'tag').map((i) => i.fileName)).toEqual([name(2), name(5)])
    expect(isTag(SIX[2])).toBe(true)
    expect(isTag(SIX[0])).toBe(false)
  })
  it('모르는 거르기 값은 전체로 본다', () => expect(filterItems(SIX, 'nope')).toBe(SIX))
  it('메모 거르기는 메모가 있는 줄만 — 빈 글 메모도 메모다', () => {
    const items = [SIX[0], { ...SIX[1], memo: { text: '글' } }, { ...SIX[2], memo: null }, { ...SIX[3], memo: { text: '' } }]
    expect(filterItems(items, 'memo').map((i) => i.fileName)).toEqual([name(1), name(3)])
    expect([hasMemo(items[1]), hasMemo(items[0]), hasMemo(items[2]), hasMemo(undefined)]).toEqual([true, false, false, false])
  })
})

describe('stepName — 이전·다음', () => {
  it('가운데에서는 이웃 줄', () => {
    expect(stepName(SIX, name(2), 1)).toBe(name(3))
    expect(stepName(SIX, name(2), -1)).toBe(name(1))
  })
  it('끝에서는 null — 돌아가지 않는다', () => {
    expect(stepName(SIX, name(0), -1)).toBeNull()
    expect(stepName(SIX, name(5), 1)).toBeNull()
  })
  it('고른 것이 없거나 목록에 없으면 다음은 첫 줄, 이전은 마지막 줄', () => {
    expect(stepName(SIX, null, 1)).toBe(name(0))
    expect(stepName(SIX, null, -1)).toBe(name(5))
    expect(stepName(SIX, 'gone.png', 1)).toBe(name(0))
  })
  it('빈 목록은 null', () => expect(stepName([], null, 1)).toBeNull())
})

describe('nextMatch — 태그 이동(끝에서 돌아간다, DC-076)', () => {
  it('앞으로: 다음 태그, 마지막 태그에서는 첫 태그로 돌아간다', () => {
    expect(nextMatch(SIX, name(0), 1, isTag)).toBe(name(2))
    expect(nextMatch(SIX, name(2), 1, isTag)).toBe(name(5))
    expect(nextMatch(SIX, name(5), 1, isTag)).toBe(name(2))
  })
  it('뒤로: 앞 태그, 첫 태그에서는 마지막 태그로 돌아간다', () => {
    expect(nextMatch(SIX, name(4), -1, isTag)).toBe(name(2))
    expect(nextMatch(SIX, name(2), -1, isTag)).toBe(name(5))
    expect(nextMatch(SIX, name(0), -1, isTag)).toBe(name(5))
  })
  it('맞는 줄이 지금 줄뿐이면 그 이름', () => {
    const one = [click(1), tag(2), click(3)]
    expect(nextMatch(one, one[1].fileName, 1, isTag)).toBe(one[1].fileName)
    expect(nextMatch(one, one[1].fileName, -1, isTag)).toBe(one[1].fileName)
  })
  it('하나도 없으면 null', () => {
    expect(nextMatch([click(1), click(2)], null, 1, isTag)).toBeNull()
    expect(nextMatch([], null, 1, isTag)).toBeNull()
  })
  it('고른 것이 없으면 앞으로는 첫 태그, 뒤로는 마지막 태그', () => {
    expect(nextMatch(SIX, null, 1, isTag)).toBe(name(2))
    expect(nextMatch(SIX, null, -1, isTag)).toBe(name(5))
  })
})

describe('clickPoint — 클릭 점을 그릴 자리', () => {
  const N = { w: 640, h: 360 }
  it('클릭 스냅샷이고 좌표가 그림 안이면 그 좌표', () => {
    expect(clickPoint(click(1, 412, 288), N)).toEqual({ x: 412, y: 288 })
    expect(clickPoint(click(1, 0, 0), N)).toEqual({ x: 0, y: 0 })
    expect(clickPoint(click(1, 639, 359), N)).toEqual({ x: 639, y: 359 })
  })
  it('그림 밖 좌표에는 그리지 않는다', () => {
    expect(clickPoint(click(1, 640, 10), N)).toBeNull()
    expect(clickPoint(click(1, 10, 360), N)).toBeNull()
    expect(clickPoint(click(1, -1, 10), N)).toBeNull()
  })
  it('태그 스냅샷, 그림 크기를 아직 모를 때, 고른 것이 없을 때는 그리지 않는다', () => {
    expect(clickPoint(tag(1), N)).toBeNull()
    expect(clickPoint(click(1, 5, 5), null)).toBeNull()
    expect(clickPoint(null, N)).toBeNull()
  })
  it('1818 좌표도 그림 안이면 그린다 — 사내의 예외를 두지 않는다(DC-078)', () => {
    expect(clickPoint(click(1, 1818, 1818), { w: 1920, h: 1920 })).toEqual({ x: 1818, y: 1818 })
  })
  it('좌표가 정수가 아니면 그리지 않는다', () => {
    expect(clickPoint({ kind: 'click', x: null, y: 3 }, N)).toBeNull()
    expect(clickPoint({ kind: 'click', x: 1.5, y: 3 }, N)).toBeNull()
  })
})

describe('expiryDays — "n일 뒤 삭제"', () => {
  it('3일 이하일 때만 그 수', () => {
    expect(expiryDays({ daysLeft: 3 })).toBe(3)
    expect(expiryDays({ daysLeft: 1 })).toBe(1)
    expect(expiryDays({ daysLeft: 0 })).toBe(0)
    expect(expiryDays({ daysLeft: 4 })).toBeNull()
    expect(expiryDays({})).toBeNull()
  })
})

describe('rowWindow — 보이는 줄만 그린다', () => {
  it('맨 위: 보이는 10줄과 아래 여유 8줄', () => {
    expect(rowWindow(0, 280, 28, 50000)).toEqual({ start: 0, end: 18, offset: 0, height: 1400000 })
  })
  it('가운데: 위아래 여유 8줄씩', () => {
    expect(rowWindow(28000, 280, 28, 50000)).toEqual({ start: 992, end: 1018, offset: 27776, height: 1400000 })
  })
  it('전체가 화면보다 작으면 모두', () => {
    expect(rowWindow(0, 280, 28, 4)).toEqual({ start: 0, end: 4, offset: 0, height: 112 })
  })
  it('맨 아래를 지나 스크롤돼 있어도 범위를 벗어나지 않는다', () => {
    const w = rowWindow(999999, 280, 28, 100)
    expect(w.end).toBe(100)
    expect(w.start).toBeLessThanOrEqual(100)
    expect(w.start).toBeGreaterThanOrEqual(0)
  })
  it('화면 높이를 아직 모르면(0) 여유분만', () => {
    expect(rowWindow(0, 0, 28, 50000)).toMatchObject({ start: 0, end: 8 })
  })
  it('5만 줄에서도 그리는 줄 수는 화면 크기를 따른다', () => {
    const w = rowWindow(700000, 600, 28, 50000)
    expect(w.end - w.start).toBeLessThan(60)
  })
})

describe('scrollFor — 고른 줄이 보이게', () => {
  it('이미 보이면 그대로', () => expect(scrollFor(5, 100, 280, 28)).toBe(100))
  it('위로 벗어난 줄은 맨 위에', () => expect(scrollFor(2, 100, 280, 28)).toBe(56))
  it('아래로 벗어난 줄은 맨 아래에', () => expect(scrollFor(20, 100, 280, 28)).toBe(20 * 28 + 28 - 280))
  it('고른 것이 없으면(-1) 그대로', () => expect(scrollFor(-1, 100, 280, 28)).toBe(100))
})

describe('여러 줄 고르기 (P3-D)', () => {
  const list = ['a', 'b', 'c', 'd', 'e'].map((n) => ({ fileName: n }))
  it('rangeNames — 두 줄 사이(양 끝 포함), 거꾸로 줘도 목록 순서', () => {
    expect(rangeNames(list, 'b', 'd')).toEqual(['b', 'c', 'd'])
    expect(rangeNames(list, 'd', 'b')).toEqual(['b', 'c', 'd'])
    expect(rangeNames(list, 'c', 'c')).toEqual(['c'])
  })
  it('rangeNames — 기준 줄이 목록에 없으면 그 줄 하나, 갈 줄이 없으면 빈 배열', () => {
    expect(rangeNames(list, 'zz', 'd')).toEqual(['d'])
    expect(rangeNames(list, null, 'd')).toEqual(['d'])
    expect(rangeNames(list, 'b', 'zz')).toEqual([])
  })
  it('nearestName — 그 줄에서 가장 가까운 고른 줄(같은 거리면 아래 줄)', () => {
    expect(nearestName(list, new Set(['a', 'e']), 'b')).toBe('a')
    expect(nearestName(list, new Set(['a', 'e']), 'd')).toBe('e')
    expect(nearestName(list, new Set(['a', 'e']), 'c')).toBe('e')
    expect(nearestName(list, new Set(['c']), 'c')).toBe('c')
    expect(nearestName(list, new Set(), 'c')).toBeNull()
    expect(nearestName(list, new Set(['zz']), 'c')).toBeNull()
    expect(nearestName(list, new Set(['a']), 'zz')).toBe('a')
  })
})

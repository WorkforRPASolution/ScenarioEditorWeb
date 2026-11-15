// 스냅샷 하루 목록 규칙(P3 설계 §4.2·§4.3) — 거르기, 이전·다음, 태그·메모 이동, 클릭 점, 보이는 줄.
// items = 서버 하루 목록의 줄({ fileName, ms, time, shift, kind, tag, x, y, txn, hasHistory, memo, daysLeft }), 시각 오름차순.

export const FILTERS = ['all', 'tag', 'memo']
export const isTag = (item) => item?.kind === 'tag'
// 메모가 달린 줄 — 빈 글 메모(데스크톱이 남겼을 수 있다)도 메모다
export const hasMemo = (item) => !!item?.memo

export function filterItems(items, filter) {
  if (filter === 'tag') return items.filter(isTag)
  if (filter === 'memo') return items.filter(hasMemo)
  return items
}

const indexOfName = (items, fileName) => (fileName ? items.findIndex((i) => i.fileName === fileName) : -1)

// 이전(delta < 0)·다음(delta > 0) 줄의 이름. 끝이면 null(돌아가지 않는다). 고른 것이 없으면 다음은 첫 줄, 이전은 마지막 줄.
export function stepName(items, fileName, delta) {
  if (!items.length) return null
  const i = indexOfName(items, fileName)
  if (i < 0) return items[delta > 0 ? 0 : items.length - 1].fileName
  const j = i + delta
  return j >= 0 && j < items.length ? items[j].fileName : null
}

// dir(±1) 방향으로 pred 가 참인 다음 줄의 이름. 끝에서 처음으로 돌아간다(DC-076). 하나도 없으면 null, 지금 줄뿐이면 그 이름.
export function nextMatch(items, fileName, dir, pred) {
  const n = items.length
  if (!n) return null
  const i = indexOfName(items, fileName)
  const from = i >= 0 ? i : dir > 0 ? -1 : n
  for (let k = 1; k <= n; k++) {
    const j = (((from + dir * k) % n) + n) % n
    if (pred(items[j])) return items[j].fileName
  }
  return null
}

// 클릭 점을 그릴 그림 좌표. 클릭 스냅샷이고 좌표가 그림 안일 때만 — 태그·그림 밖·크기를 모를 때는 그리지 않는다(1818 예외 없음, DC-078).
export function clickPoint(item, natural) {
  if (!item || item.kind !== 'click' || !natural) return null
  const { x, y } = item
  if (!Number.isInteger(x) || !Number.isInteger(y)) return null
  return x >= 0 && y >= 0 && x < natural.w && y < natural.h ? { x, y } : null
}

// "n일 뒤 삭제" 를 보일 날 수 — 3일 이하일 때만
export function expiryDays(item) {
  const d = item?.daysLeft
  return Number.isFinite(d) && d <= 3 ? d : null
}

// 보이는 줄의 범위 [start, end) 와 그 앞을 비울 높이(offset)·전체 높이. 줄 높이는 고정.
export function rowWindow(scrollTop, viewHeight, rowHeight, total, overscan = 8) {
  const height = total * rowHeight
  const top = Math.max(0, Math.min(scrollTop, height))
  const first = Math.floor(top / rowHeight)
  const last = Math.ceil((top + Math.max(0, viewHeight)) / rowHeight)
  const start = Math.max(0, Math.min(total, first - overscan))
  const end = Math.max(start, Math.min(total, last + overscan))
  return { start, end, offset: start * rowHeight, height }
}

// index 번째 줄이 보이게 할 scrollTop. 이미 보이면 그대로.
export function scrollFor(index, scrollTop, viewHeight, rowHeight) {
  if (index < 0) return scrollTop
  const top = index * rowHeight
  if (top < scrollTop) return top
  if (top + rowHeight > scrollTop + viewHeight) return top + rowHeight - viewHeight
  return scrollTop
}

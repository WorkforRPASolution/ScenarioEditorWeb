// 스냅샷 하루 목록 규칙(P3 설계 §4.2·§4.3) — 거르기, 이전·다음, 태그·메모 이동, 여러 줄 고르기의 범위, 클릭 점, 보이는 줄.
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

// 여러 줄 고르기(P3-D): fromName 줄부터 toName 줄까지의 이름(양 끝 포함, 목록 순서). 기준 줄이 목록에 없으면 갈 줄 하나, 갈 줄이 없으면 빈 배열.
export function rangeNames(items, fromName, toName) {
  const j = indexOfName(items, toName)
  if (j < 0) return []
  const i = indexOfName(items, fromName)
  if (i < 0) return [items[j].fileName]
  return items.slice(Math.min(i, j), Math.max(i, j) + 1).map((x) => x.fileName)
}

// names(Set) 가운데 fromName 줄에서 가장 가까운 줄의 이름 — 같은 거리면 아래 줄. fromName 이 목록에 없으면 목록에서 맨 앞의 것. 없으면 null.
export function nearestName(items, names, fromName) {
  if (!names.size) return null
  const i = indexOfName(items, fromName)
  if (i < 0) return items.find((x) => names.has(x.fileName))?.fileName ?? null
  for (let d = 0; d < items.length; d++) {
    for (const j of d === 0 ? [i] : [i + d, i - d]) {
      if (j >= 0 && j < items.length && names.has(items[j].fileName)) return items[j].fileName
    }
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

// ── 여러 날 목록의 날짜 구분 줄(사내 요청 2026-11-16) ──
// 줄의 표시 날짜(date)가 둘 이상이면 날이 바뀌는 곳마다 { header, date, count } 를 넣는다. rows = 화면에 그릴 줄, at[i] = items[i] 의 화면 자리.
// 하루뿐이면 받은 배열 그대로이고 at 은 null 이다(자리가 같다).
export function dayRows(items) {
  let mixed = false
  for (let i = 1; i < items.length; i++) if (items[i].date !== items[0].date) { mixed = true; break }
  if (!mixed) return { rows: items, at: null }
  const rows = []
  const at = new Int32Array(items.length)
  let head = null
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    if (!head || head.date !== it.date) { head = { header: true, date: it.date, count: 0 }; rows.push(head) }
    head.count++
    at[i] = rows.length
    rows.push(it)
  }
  return { rows, at }
}
// 화면 자리 index 의 줄이 속한 날짜(구분 줄이면 그 날). 없으면 null.
export const dayOfRow = (rows, index) => rows[index]?.date ?? null

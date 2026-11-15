'use strict'
// 스냅샷 파일 이름 `{ms}_[{x}][{y}].png` 해석 (P3 설계 §3·§7).
// - 클릭 스냅샷: [x][y] = 클릭 좌표.
// - 태그 스냅샷: x 가 태그 코드와 정확히 같을 때만. y = txn(자릿수가 길어 글자로 둔다).
// - 이력 대상: 태그이고 txn ≥ 99999 (결정 2026-11-03).
const NAME = /^(\d{1,16})_\[(\d{1,9})\]\[(\d{1,16})\]\.png$/
const TAGS = { 9999: 'start', 9990: 'success', 9991: 'stop', 9992: 'fail', 9993: 'skip' }
const HISTORY_MIN_TXN = 99999

// `$` 는 끝의 줄바꿈 앞에서도 맞으므로 줄바꿈이 든 글자는 따로 막는다.
const match = (s) => (typeof s === 'string' && !s.includes('\n') ? NAME.exec(s) : null)

function isSnapshotName(s) {
  return match(s) !== null
}

function parseSnapshotName(fileName) {
  const m = match(fileName)
  if (!m) return null
  const ms = Number(m[1])
  const x = Number(m[2])
  const tag = Object.prototype.hasOwnProperty.call(TAGS, x) ? TAGS[x] : null
  if (tag) {
    return { fileName, ms, kind: 'tag', tag, x: null, y: null, txn: m[3], hasHistory: Number(m[3]) >= HISTORY_MIN_TXN }
  }
  return { fileName, ms, kind: 'click', tag: null, x, y: Number(m[3]), txn: null, hasHistory: false }
}

module.exports = { isSnapshotName, parseSnapshotName, HISTORY_MIN_TXN }

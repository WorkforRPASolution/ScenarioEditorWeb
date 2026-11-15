'use strict'
// 스냅샷 메모 규칙 (P3 설계 §4.4·§5.5·§7). 운영 Mongo `ARS_USER_MEMO` 를 데스크톱 편집기와 함께 쓴다.
// - 문서: { singleid, eqpid, snapshotTimestamp(쓴 때 — 이름과 달리 스냅샷 시각이 아니다), process, memo, filename, hiddensnapshot }.
//   웹이 고치면 webEditedBy·webEditedAt 이 붙는다(데스크톱은 무시한다).
// - 논리 키는 (eqpid, filename). 유일 인덱스가 없어 같은 키 문서가 여럿일 수 있다.
const { parseSnapshotName } = require('./snapshotName')

const MEMO_MAX = 128 // 데스크톱 메모 창의 한도
const text = (v) => (typeof v === 'string' ? v : null)
const dateMs = (v) => (v instanceof Date && Number.isFinite(v.getTime()) ? v.getTime() : null)

// 저장할 글 — 앞뒤 공백을 지운 뒤 본다. 작은따옴표는 데스크톱이 저장하지 못한다(결정 2026-11-03).
function checkMemoText(value) {
  const t = typeof value === 'string' ? value.trim() : ''
  if (!t) return { code: 'MEMO_EMPTY' }
  if (t.includes("'")) return { code: 'MEMO_QUOTE' }
  if (t.length > MEMO_MAX) return { code: 'MEMO_TOO_LONG' }
  return { text: t }
}

// 운영 문서 한 건 → 읽은 값. 설비·파일 이름·메모가 글자가 아니거나 파일 이름이 스냅샷 꼴이 아니면 null(그 문서만 건너뛴다 — DC-082).
// 작성자·쓴 때는 없어도 읽는다. 숨김은 hiddensnapshot 이 글자 "1" 일 때만(DC-083).
function readMemoDoc(doc) {
  if (!doc || typeof doc !== 'object' || doc._id === undefined || doc._id === null) return null
  const eqpId = text(doc.eqpid)
  const memo = text(doc.memo)
  const name = parseSnapshotName(doc.filename)
  if (!eqpId || memo === null || !name) return null
  return {
    id: doc._id, eqpId, fileName: name.fileName, ms: name.ms, text: memo, author: text(doc.singleid) ?? '', writtenMs: dateMs(doc.snapshotTimestamp),
    hidden: doc.hiddensnapshot === '1', editedBy: text(doc.webEditedBy), editedMs: dateMs(doc.webEditedAt)
  }
}

// 같은 파일 이름의 문서가 여럿이면 가장 늦게 쓴 것 하나. 쓴 때가 없으면 가장 이른 것으로 보고, 같으면 id 글자가 뒤인 것.
function pickLatest(records) {
  const later = (a, b) => {
    const [x, y] = [a.writtenMs ?? -Infinity, b.writtenMs ?? -Infinity]
    return x !== y ? x > y : String(a.id) > String(b.id)
  }
  const out = new Map()
  for (const r of records) {
    const had = out.get(r.fileName)
    if (!had || later(r, had)) out.set(r.fileName, r)
  }
  return out
}

module.exports = { MEMO_MAX, checkMemoText, readMemoDoc, pickLatest }

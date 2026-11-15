'use strict'
// 스냅샷 메모 — 하루치 읽기, 쓰기·고치기·지우기, 메모 목록 (P3 설계 §4.4·§4.5·§5.5).
// - 운영 Mongo `ARS_USER_MEMO` 를 데스크톱 편집기와 함께 쓴다. 새 문서는 데스크톱이 쓰는 일곱 필드 그대로다.
// - 범위는 지금 설비의 공정으로 정한다(scopes). 문서의 process 로 거르지 않는다.
// - 충돌은 메모 글을 견준다 — 화면이 본 글(expect)이 지금 값과 다르면 쓰지 않고 지금 값을 돌려준다(DC-036).
// - 같은 키(설비, 파일 이름) 문서가 여럿이면 가장 늦게 쓴 하나만 보이고, 고치기·지우기도 그 하나에만 한다.
const { seError } = require('../errors')
const { parseSnapshotName } = require('../domain/snapshotName')
const { checkMemoText, readMemoDoc, pickLatest, isPlainSnapshotName } = require('../domain/memoRules')
const { zoneOf } = require('../domain/displayZone')
const { RETENTION_MS, timeDiffOf, displayOf, nameBound, daysLeft } = require('../domain/snapshotTime')

const MEMO_DAY_LIMIT = 5000 // 하루치로 읽는 메모 문서 수
const MEMO_LIST_LIMIT = 5000 // 메모 목록 창에 싣는 문서 수
const MEMO_DAY_BUDGET_MS = 4000 // 하루 목록에 붙일 메모를 기다리는 시간 — 넘으면 메모 없이 목록을 보낸다(인덱스가 없는 큰 컬렉션일 수 있다)
const MINUTE = 60000
const DAY = 86400000
const TEXT_ERRORS = {
  MEMO_EMPTY: '메모가 비어 있습니다',
  MEMO_QUOTE: "메모에 작은따옴표(')는 쓸 수 없습니다",
  MEMO_TOO_LONG: '메모는 128자까지 쓸 수 있습니다'
}
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

function createMemoService({ repo, scopes, now, env = {}, log = null }) {
  const displayTz = zoneOf(env, 'SE_DISPLAY_TZ', log)
  // 쓴 때·고친 때 — 표시 시간대의 'YYYY-MM-DD HH:MM'(설비 보정은 더하지 않는다. 사람이 쓴 시각이다)
  const stamp = (ms) => {
    if (ms === null || ms === undefined) return null
    const d = displayOf(ms, 0, displayTz)
    return `${d.date} ${d.time.slice(0, 5)}`
  }
  // 틀린 문서는 그 건만 건너뛴다. 알림은 같은 곳(where)에서 건수가 바뀔 때만 남긴다(목록을 볼 때마다 쌓이지 않게).
  const warnedBad = new Map()
  const read = (docs, where) => {
    const records = docs.map(readMemoDoc).filter(Boolean)
    const bad = docs.length - records.length
    if (log && (warnedBad.get(where) ?? 0) !== bad) {
      warnedBad.set(where, bad)
      if (bad) log.warn(`메모 문서 ${bad}건을 읽지 못해 건너뜁니다(${where} — 필드 없음·파일 이름 꼴 아님)`)
    }
    return records
  }
  // 설비 시계가 앞서 있을 수 있어 지금보다 하루(+ 그 설비의 보정)까지의 스냅샷만 본다 — 그 뒤 시각의 이름은 스냅샷 서버가 만든 것이 아니다
  const latestMsOf = (eqp, at) => at + DAY + Math.abs(timeDiffOf(eqp.snapshotTimeDiff)) * MINUTE
  // 작성자 아이디 → 이름. 찾지 못하면(조회 실패 포함) 아이디를 그대로 보인다.
  async function namer(records) {
    const ids = [...new Set(records.map((r) => r.author).filter(Boolean))]
    const names = new Map()
    try {
      for (const u of await repo.findUserNames(ids)) if (typeof u.name === 'string' && u.name && !names.has(u.singleid)) names.set(u.singleid, u.name)
    } catch (e) {
      if (log) log.warn(`메모 작성자 이름을 읽지 못했습니다 — 아이디로 보입니다: ${e && e.message}`)
    }
    return (id) => names.get(id) ?? id
  }
  const view = (r, nameOf) => ({
    text: r.text, author: r.author, authorName: nameOf(r.author), writtenAt: stamp(r.writtenMs), editedBy: r.editedBy, editedAt: stamp(r.editedMs)
  })
  const viewOne = async (r) => view(r, await namer([r]))

  // 하루 목록에 붙일 메모. 읽지 못해도 던지지 않는다 — 스냅샷 보기가 메모 컬렉션에 매이지 않게(failed 로 알린다).
  async function forRange(eqpId, fromName, toName) {
    try {
      const picked = pickLatest(read(await repo.findMemos({ eqpId, fromName, toName, maxTimeMs: MEMO_DAY_BUDGET_MS }, MEMO_DAY_LIMIT), eqpId))
      const hidden = new Set()
      const shown = []
      for (const r of picked.values()) (r.hidden ? hidden.add(r.fileName) : shown.push(r))
      const nameOf = await namer(shown)
      return { byName: new Map(shown.map((r) => [r.fileName, view(r, nameOf)])), hidden, failed: false }
    } catch (e) {
      if (log) log.warn(`메모를 읽지 못했습니다(${eqpId}) — 목록은 메모 없이 보냅니다: ${(e && e.code) || (e && e.name)} ${e && e.message}`)
      return { byName: new Map(), hidden: new Set(), failed: true }
    }
  }

  // 그 키의 문서 가운데 가장 늦게 쓴 하나(없으면 null)
  const latest = async (eqpId, fileName) => pickLatest(read(await repo.findMemosByKey(eqpId, fileName), eqpId)).get(fileName) ?? null
  const conflict = async (current) => seError(409, 'MEMO_CONFLICT', '그 사이 메모가 바뀌었습니다', { current: current ? await viewOne(current) : null })
  const nameOrThrow = (fileName) => {
    const name = parseSnapshotName(fileName)
    if (!name) throw seError(400, 'SNAPSHOT_BAD_NAME', '스냅샷 파일 이름 꼴이 아닙니다')
    return name
  }

  // expect = 화면이 본 메모 글. null(없음)이면 새 메모, 글자면 고치기.
  async function save(user, eqpId, fileName, { memo, expect = null } = {}) {
    const eqp = await scopes.equipmentOf(user, eqpId)
    const name = nameOrThrow(fileName)
    if (expect !== null && typeof expect !== 'string') throw seError(400, 'BAD_REQUEST', 'expect 는 본 메모 글이거나 null 이어야 합니다', { path: 'expect' })
    // 운영 컬렉션에 넣는 이름은 스냅샷 서버가 만드는 꼴만(자릿수·앞자리 0 — memoRules.isPlainSnapshotName)
    if (!isPlainSnapshotName(fileName)) throw seError(400, 'SNAPSHOT_BAD_NAME', '스냅샷 파일 이름 꼴이 아닙니다')
    const at = now()
    // 보관 기간이 지났거나 앞날인 스냅샷에는 쓰지 않는다(목록에 보이지 않는다). Cassandra 에 그 줄이 있는지는 묻지 않는다.
    if (!(name.ms >= at - RETENTION_MS && name.ms <= latestMsOf(eqp, at))) throw seError(404, 'SNAPSHOT_NOT_FOUND', '스냅샷이 없습니다. 보관 기간이 지났을 수 있습니다')
    const checked = checkMemoText(memo)
    if (checked.code) throw seError(400, checked.code, TEXT_ERRORS[checked.code])

    if (expect === null) {
      // 데스크톱이 쓰는 일곱 필드 그대로. snapshotTimestamp 는 이름과 달리 쓴 때다.
      const doc = { singleid: user.singleid, eqpid: eqpId, snapshotTimestamp: new Date(at), process: eqp.process, memo: checked.text, filename: fileName, hiddensnapshot: '0' }
      const r = await repo.insertMemoIfAbsent(doc)
      if (!r.inserted) {
        const had = await latest(eqpId, fileName)
        // 같은 키에 읽을 수 없는 문서만 있다 — "지금은 메모가 없다" 고 답하면 화면이 같은 저장을 되풀이한다
        if (!had) throw seError(409, 'MEMO_BLOCKED', '이 스냅샷에 읽을 수 없는 메모 문서가 있어 메모를 쓸 수 없습니다')
        throw await conflict(had)
      }
      const nameOf = (id) => (id === user.singleid && typeof user.name === 'string' && user.name ? user.name : id)
      return { memo: view({ text: checked.text, author: user.singleid, writtenMs: at, editedBy: null, editedMs: null }, nameOf) }
    }

    const cur = await latest(eqpId, fileName)
    if (!cur || cur.text !== expect) throw await conflict(cur)
    if (checked.text === cur.text) return { memo: await viewOne(cur) } // 바뀐 것이 없다 — 고친 사람을 바꾸지 않는다
    const r = await repo.updateMemoText(cur.id, expect, { memo: checked.text, webEditedBy: user.singleid, webEditedAt: new Date(at) })
    if (!r.matched) throw await conflict(await latest(eqpId, fileName))
    return { memo: await viewOne({ ...cur, text: checked.text, editedBy: user.singleid, editedMs: at }) }
  }

  // 본 글이 지금 값과 같을 때만 지운다. 같은 키의 옛 문서가 남아 있으면 그것을 돌려준다(화면이 그 메모를 보인다).
  async function remove(user, eqpId, fileName, { expect } = {}) {
    await scopes.equipmentOf(user, eqpId)
    nameOrThrow(fileName)
    if (typeof expect !== 'string') throw seError(400, 'BAD_REQUEST', 'expect 는 본 메모 글이어야 합니다', { path: 'expect' })
    const gone = () => seError(404, 'MEMO_GONE', '메모가 이미 없습니다')
    const cur = await latest(eqpId, fileName)
    if (!cur) throw gone()
    if (cur.text !== expect) throw await conflict(cur)
    const r = await repo.deleteMemo(cur.id, expect)
    if (!r.deleted) {
      const now2 = await latest(eqpId, fileName)
      throw now2 ? await conflict(now2) : gone()
    }
    // 지운 뒤 다시 읽기가 실패해도 지운 것은 성공이다(남은 옛 메모는 다음에 목록을 받을 때 보인다)
    let left = null
    try { left = await latest(eqpId, fileName) } catch { left = null }
    return { removed: true, memo: left && !left.hidden ? await viewOne(left) : null }
  }

  // 메모 목록 창 — 내 범위 설비의, 스냅샷 시각이 15일 안인 메모. 쓴 때 내림차순.
  async function list(user) {
    const { valid } = await scopes.scopeFor(user)
    const byId = new Map(valid.filter((e) => typeof e.eqpId === 'string' && e.eqpId !== '').map((e) => [e.eqpId, e]))
    const at = now()
    const from = at - RETENTION_MS
    const docs = await repo.findMemos({ fromName: nameBound(from) }, MEMO_LIST_LIMIT + 1)
    const truncated = docs.length > MEMO_LIST_LIMIT
    const records = read(truncated ? docs.slice(0, MEMO_LIST_LIMIT) : docs, '메모 목록')
      .filter((r) => byId.has(r.eqpId) && r.ms >= from && r.ms <= latestMsOf(byId.get(r.eqpId), at))
    // 같은 키는 (설비, 파일 이름)이다 — 설비마다 따로 하나씩 고른다
    const perEqp = new Map()
    for (const r of records) (perEqp.get(r.eqpId) ?? perEqp.set(r.eqpId, []).get(r.eqpId)).push(r)
    const shown = []
    for (const group of perEqp.values()) for (const r of pickLatest(group).values()) if (!r.hidden) shown.push(r)
    shown.sort((a, b) => (b.writtenMs ?? -Infinity) - (a.writtenMs ?? -Infinity) || cmp(a.eqpId, b.eqpId) || cmp(b.fileName, a.fileName))
    const nameOf = await namer(shown)
    const items = shown.map((r) => {
      const e = byId.get(r.eqpId)
      const d = displayOf(r.ms, timeDiffOf(e.snapshotTimeDiff), displayTz)
      return { eqpId: r.eqpId, process: e.process, model: e.eqpModel, fileName: r.fileName, date: d.date, time: d.time, daysLeft: daysLeft(r.ms, at), memo: view(r, nameOf) }
    })
    return { items, truncated }
  }

  return { forRange, save, remove, list }
}

module.exports = { createMemoService, MEMO_LIST_LIMIT, MEMO_DAY_LIMIT, MEMO_DAY_BUDGET_MS }

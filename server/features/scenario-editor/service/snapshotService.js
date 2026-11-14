'use strict'
// 스냅샷 — 내 범위 설비, 있는 날, 하루 목록, 그림 한 장 (P3 설계 §5.2~§5.4).
// - 설비는 내 공정 범위의 유효 설비만(scopes.equipmentOf). 저장소(Cassandra)는 검사를 지난 뒤에만 부른다.
// - 목록은 표시 날짜 하루의 이름 범위로 읽는다. 표시 시각 = 파일 ms + 설비 보정(분)을 표시 시간대로 읽은 시각.
// - 메모(`memo`)는 P3-C 가 채운다.
// - 설비마다 가장 늦은 날짜(presence)는 설비 고르기의 "스냅샷 있는 설비" 표시용이다. 설비 한 대에 한두 줄만 읽고,
//   한꺼번에 보내는 조회 수를 묶고(이 서버 프로세스 안에서 한 요청씩 차례로), 한 요청은 5초까지만 묻고, 받은 값은 10분 기억한다.
const { seError } = require('../errors')
const { parseSnapshotName } = require('../domain/snapshotName')
const {
  RETENTION_MS, timeDiffOf, displayOf, dayRange, monthsOf, partitionDays, nameBound, daysLeft, maxAgeOf
} = require('../domain/snapshotTime')

const DAY_LIMIT = 50000 // 하루 목록 줄 수 한도
const COUNT_LIMIT = 300000 // 날짜별 개수를 셀 때 읽는 줄 수 한도
const PRESENCE_CHUNK = 2000 // 한 요청이 보는 설비 수 — 나머지는 next 로 이어 청한다
const PRESENCE_TTL_MS = 10 * 60000 // 설비의 가장 늦은 한 장을 기억하는 시간 — 화면이 다시 받는 주기(5분)보다 길게 둔다
const PRESENCE_BUDGET_MS = 5000 // 한 요청이 저장소에 묻는 시간 — 넘으면 거기까지만 답하고 화면이 이어 청한다(저장소가 느려도 요청이 매달리지 않는다)
const PRESENCE_CONCURRENCY = 8 // 한꺼번에 보내는 조회 수 기본값
const PRESENCE_CONCURRENCY_MAX = 64
const DAY = 86400000
const DEFAULT_TZ = 'Asia/Seoul'
const MAX_DATE_MS = 8.64e15 - 2 * DAY // Date 가 다룰 수 있는 끝(앞뒤 하루를 계산할 여유를 뺀 값)
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
const nextDate = (date) => new Date(Date.parse(`${date}T00:00:00Z`) + DAY).toISOString().slice(0, 10)

function createSnapshotService({ snapshotRepo, scopes, now, env = {}, log = null }) {
  // 시간대 값이 틀리면 기본값으로 돌리고 한 번 알린다(틀린 채로 두면 요청마다 Intl 이 던진다).
  function tzOf(name) {
    const v = typeof env[name] === 'string' ? env[name].trim() : ''
    if (!v) return DEFAULT_TZ
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: v })
      return v
    } catch {
      if (log) log.warn(`${name} 값을 시간대로 읽지 못해 ${DEFAULT_TZ} 를 씁니다`)
      return DEFAULT_TZ
    }
  }
  const displayTz = tzOf('SE_DISPLAY_TZ')
  const partitionTz = tzOf('SE_SNAPSHOT_PARTITION_TZ')
  // 설비별 스냅샷 유무를 볼 때 한꺼번에 보내는 조회 수. 0 이면 끈다. 숫자가 아니면 기본값으로 돌리고 한 번 알린다.
  const presenceConcurrency = (() => {
    const v = typeof env.SE_SNAPSHOT_PRESENCE_CONCURRENCY === 'string' ? env.SE_SNAPSHOT_PRESENCE_CONCURRENCY.trim() : ''
    if (!v) return PRESENCE_CONCURRENCY
    if (/^\d+$/.test(v)) return Math.min(Number(v), PRESENCE_CONCURRENCY_MAX)
    if (log) log.warn(`SE_SNAPSHOT_PRESENCE_CONCURRENCY 값을 수로 읽지 못해 ${PRESENCE_CONCURRENCY} 를 씁니다`)
    return PRESENCE_CONCURRENCY
  })()

  // 원본 ms 범위 [from, to) 의 이름을 걸치는 달마다 읽는다. 합쳐서 limit 줄에서 멈춘다 → { parsed, skipped, truncated }
  async function readRange(eqpId, from, to, limit) {
    const seen = new Set()
    const parsed = []
    let skipped = 0
    let truncated = false
    for (const month of monthsOf(from, to)) {
      const left = limit - seen.size
      if (left <= 0) { truncated = true; break }
      const r = await snapshotRepo.listNames(eqpId, month, nameBound(from), nameBound(to), left)
      if (r.truncated) truncated = true
      for (const name of r.names) {
        if (seen.has(name)) continue
        seen.add(name)
        const p = parseSnapshotName(name)
        if (!p) { skipped++; continue }
        if (p.ms >= from && p.ms < to) parsed.push(p)
      }
    }
    return { parsed, skipped, truncated }
  }

  // 설비 고르기용 — IP 둘(ipAddr, 안쪽 ipAddrL)은 화면이 글자 일부로 찾는 데 쓴다. 글자가 아니면 빈 글자.
  async function equipment(user) {
    const { valid } = await scopes.scopeFor(user)
    const ip = (v) => (typeof v === 'string' ? v : '')
    return valid
      .map((e) => ({ eqpId: e.eqpId, process: e.process, model: e.eqpModel, line: e.line, ipAddr: ip(e.ipAddr), ipAddrL: ip(e.ipAddrL) }))
      .sort((a, b) => cmp(a.eqpId, b.eqpId))
  }

  async function list(user, eqpId, date) {
    const eqp = await scopes.equipmentOf(user, eqpId)
    const timeDiff = timeDiffOf(eqp.snapshotTimeDiff)
    const range = dayRange(date, timeDiff, displayTz)
    if (!range) throw seError(400, 'BAD_REQUEST', 'date 는 YYYY-MM-DD 꼴의 날짜여야 합니다', { path: 'date' })
    const { parsed, skipped, truncated } = await readRange(eqpId, range.from, range.to, DAY_LIMIT)
    const at = now()
    const items = parsed
      .sort((a, b) => a.ms - b.ms || cmp(a.fileName, b.fileName))
      .map((p) => {
        const d = displayOf(p.ms, timeDiff, displayTz)
        return {
          fileName: p.fileName, ms: p.ms, time: d.time, shift: d.shift, kind: p.kind, tag: p.tag, x: p.x, y: p.y, txn: p.txn,
          hasHistory: p.hasHistory, memo: null, daysLeft: daysLeft(p.ms, at)
        }
      })
    return { eqpId, date, timeDiff, items, skipped, truncated }
  }

  // 보관 기간 안에서 가장 늦은 한 장의 원본 ms. 늦은 달부터 한 줄씩 본다.
  async function latestMs(eqpId, from, to) {
    for (const month of monthsOf(from, to).reverse()) {
      const p = parseSnapshotName(await snapshotRepo.latestName(eqpId, month, nameBound(from)))
      if (!p || p.ms > MAX_DATE_MS) continue // 없거나 꼴이 아닌 이름이면 앞 달을 본다
      return p.ms >= from ? p.ms : null
    }
    return null
  }
  // 그 한 장의 표시 날짜
  async function latestDate(eqpId, timeDiff, from, to) {
    const ms = await latestMs(eqpId, from, to)
    return ms === null ? null : displayOf(ms, timeDiff, displayTz).date
  }

  // ── 설비마다 가장 늦은 한 장(설비 고르기의 유무 표시) ──
  const latestKept = new Map() // eqpId → { ms, at } — 사용자와 상관없는 값이라 함께 쓴다. 키는 설비 기준정보의 ID 뿐이다
  let line = Promise.resolve() // 한 번에 한 요청만 저장소에 묻는다(뒤 요청은 기다렸다가 기억을 쓴다) — 사용자가 몰려도 조회 수가 늘지 않는다
  const inTurn = (fn) => {
    const p = line.then(fn)
    line = p.catch(() => {})
    return p
  }
  const keptOf = (eqpId, at) => {
    const hit = latestKept.get(eqpId)
    return hit && at >= hit.at && at - hit.at < PRESENCE_TTL_MS ? hit : null
  }
  // 기억에 없는 설비만 차례로 묻는다. 첫 설비는 혼자 묻는다 — 저장소가 죽어 있으면 조회 하나로 끝난다.
  // 하나라도 실패하거나 시간 예산이 지나면 남은 설비는 묻지 않는다(첫 설비는 늘 묻는다 — 요청마다 적어도 한 대는 나아간다).
  async function fillLatest(ids) {
    const at = now()
    const deadline = at + PRESENCE_BUDGET_MS
    const from = at - RETENTION_MS
    const to = at + DAY
    const todo = ids.filter((id) => !keptOf(id, at))
    let i = 0
    let failed = null
    const one = async (id) => { latestKept.set(id, { ms: await latestMs(id, from, to), at }) }
    if (todo.length) await one(todo[i++])
    const worker = async () => {
      while (i < todo.length && !failed && now() < deadline) {
        try { await one(todo[i++]) } catch (e) { failed = failed || e }
      }
    }
    await Promise.all(Array.from({ length: Math.min(presenceConcurrency, todo.length - i) }, worker))
    if (failed) throw failed
  }

  // after 뒤의 설비를 PRESENCE_CHUNK 대까지(시간 예산 안에서) — 스냅샷이 있는 설비만 [설비 ID, 가장 늦은 표시 날짜].
  // next 가 있으면 그 값을 after 로 다시 청한다. eqpId 가 글자가 아닌 설비 문서는 보지 않는다(저장소의 글자 칸에 보낼 수 없다).
  async function presence(user, after = '') {
    const { valid } = await scopes.scopeFor(user)
    const all = valid.filter((e) => typeof e.eqpId === 'string' && e.eqpId !== '').sort((a, b) => cmp(a.eqpId, b.eqpId))
    if (!presenceConcurrency) return { enabled: false, items: [], checked: 0, total: all.length, next: null }
    let start = 0
    if (after) while (start < all.length && !(all[start].eqpId > after)) start++
    const chunk = all.slice(start, start + PRESENCE_CHUNK)
    const asked = now()
    const ids = chunk.map((e) => e.eqpId)
    // 다 기억하고 있으면 줄을 서지 않는다
    if (ids.some((id) => !keptOf(id, asked))) await inTurn(() => fillLatest(ids))
    // 앞에서부터 값을 아는 설비까지만 답한다(시간 예산에서 멈췄으면 그 뒤는 다음 요청이 묻는다)
    const known = (id) => { const hit = latestKept.get(id); return hit && asked - hit.at < PRESENCE_TTL_MS ? hit : null }
    const at = now()
    const items = []
    let n = 0
    for (; n < chunk.length; n++) {
      const e = chunk[n]
      const hit = known(e.eqpId)
      if (!hit) break
      // 기억한 한 장이 그 사이 보관 기간을 벗어났으면 없는 것으로 본다
      if (hit.ms !== null && hit.ms >= at - RETENTION_MS) items.push([e.eqpId, displayOf(hit.ms, timeDiffOf(e.snapshotTimeDiff), displayTz).date])
    }
    // 채우기가 던지지 않았으면 첫 설비는 늘 안다 — 아니면 화면이 "다 봤다" 로 읽지 않게 실패로 답한다
    if (!n && chunk.length) throw seError(502, 'SNAPSHOT_FAILED', '설비의 스냅샷 유무를 확인하지 못했습니다')
    const end = start + n
    return { enabled: true, items, checked: end, total: all.length, next: end < all.length ? chunk[n - 1].eqpId : null }
  }

  // [from, to) 에 걸치는 표시 날짜와 그 날의 원본 ms 범위
  function dateBuckets(from, to, timeDiff) {
    const out = []
    let date = displayOf(from, timeDiff, displayTz).date
    for (;;) {
      const r = dayRange(date, timeDiff, displayTz)
      if (!r || r.from >= to) break
      out.push({ date, from: r.from, to: r.to })
      date = nextDate(date)
    }
    return out
  }

  async function days(user, eqpId, { counts = false } = {}) {
    const eqp = await scopes.equipmentOf(user, eqpId)
    const timeDiff = timeDiffOf(eqp.snapshotTimeDiff)
    const at = now()
    const from = at - RETENTION_MS
    const to = at + DAY // 설비 시계가 조금 앞서 있어도 든다
    const latest = await latestDate(eqpId, timeDiff, from, to)
    // 달력이 고를 수 있는 범위 — 화면이 브라우저 시계·시간대에 기대지 않게 표시 날짜로 준다
    const span = { today: displayOf(at, timeDiff, displayTz).date, oldest: displayOf(from, timeDiff, displayTz).date }
    if (!counts) return { eqpId, latest, ...span, days: null, truncated: false }
    const { parsed, truncated } = await readRange(eqpId, from, to, COUNT_LIMIT)
    const buckets = dateBuckets(from, to, timeDiff)
    const byDate = {}
    for (const p of parsed) {
      const b = buckets.find((x) => p.ms >= x.from && p.ms < x.to)
      const date = b ? b.date : displayOf(p.ms, timeDiff, displayTz).date
      byDate[date] = (byDate[date] || 0) + 1
    }
    return { eqpId, latest, ...span, days: byDate, truncated }
  }

  async function image(user, eqpId, fileName) {
    await scopes.equipmentOf(user, eqpId)
    const p = parseSnapshotName(fileName)
    if (!p) throw seError(400, 'SNAPSHOT_BAD_NAME', '스냅샷 파일 이름 꼴이 아닙니다')
    const notFound = () => seError(404, 'SNAPSHOT_NOT_FOUND', '스냅샷 그림이 없습니다. 보관 기간이 지났거나 저장되지 않았을 수 있습니다')
    if (p.ms > MAX_DATE_MS) throw notFound()
    let base64 = null
    for (const day of partitionDays(p.ms, partitionTz)) {
      base64 = await snapshotRepo.imageBase64(eqpId, day, fileName)
      if (base64 !== null && base64 !== undefined) break
    }
    if (typeof base64 !== 'string') throw notFound()
    const png = Buffer.from(base64, 'base64')
    if (png.length < PNG_SIGNATURE.length || !png.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) throw notFound()
    return { png, maxAge: maxAgeOf(p.ms, now()) }
  }

  return { equipment, presence, days, list, image }
}

module.exports = { createSnapshotService, DAY_LIMIT, COUNT_LIMIT, PRESENCE_CHUNK, PRESENCE_TTL_MS, PRESENCE_CONCURRENCY, PRESENCE_BUDGET_MS }

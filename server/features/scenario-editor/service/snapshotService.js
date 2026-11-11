'use strict'
// 스냅샷 — 내 범위 설비, 있는 날, 하루 목록, 그림 한 장 (P3 설계 §5.2~§5.4).
// - 설비는 내 공정 범위의 유효 설비만(scopes.equipmentOf). 저장소(Cassandra)는 검사를 지난 뒤에만 부른다.
// - 목록은 표시 날짜 하루의 이름 범위로 읽는다. 표시 시각 = 파일 ms + 설비 보정(분)을 표시 시간대로 읽은 시각.
// - 메모(`memo`)는 P3-C 가 채운다.
const { seError } = require('../errors')
const { parseSnapshotName } = require('../domain/snapshotName')
const {
  RETENTION_MS, timeDiffOf, displayOf, dayRange, monthsOf, partitionDays, nameBound, daysLeft, maxAgeOf
} = require('../domain/snapshotTime')

const DAY_LIMIT = 50000 // 하루 목록 줄 수 한도
const COUNT_LIMIT = 300000 // 날짜별 개수를 셀 때 읽는 줄 수 한도
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

  async function equipment(user) {
    const { valid } = await scopes.scopeFor(user)
    return valid
      .map((e) => ({ eqpId: e.eqpId, process: e.process, model: e.eqpModel, line: e.line }))
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

  // 보관 기간 안에서 가장 늦은 한 장의 표시 날짜. 늦은 달부터 한 줄씩 본다.
  async function latestDate(eqpId, timeDiff, from, to) {
    for (const month of monthsOf(from, to).reverse()) {
      const p = parseSnapshotName(await snapshotRepo.latestName(eqpId, month))
      if (!p || p.ms > MAX_DATE_MS) continue // 없거나 꼴이 아닌 이름이면 앞 달을 본다
      return p.ms >= from ? displayOf(p.ms, timeDiff, displayTz).date : null
    }
    return null
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
    if (!counts) return { eqpId, latest, days: null, truncated: false }
    const { parsed, truncated } = await readRange(eqpId, from, to, COUNT_LIMIT)
    const buckets = dateBuckets(from, to, timeDiff)
    const byDate = {}
    for (const p of parsed) {
      const b = buckets.find((x) => p.ms >= x.from && p.ms < x.to)
      const date = b ? b.date : displayOf(p.ms, timeDiff, displayTz).date
      byDate[date] = (byDate[date] || 0) + 1
    }
    return { eqpId, latest, days: byDate, truncated }
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

  return { equipment, days, list, image }
}

module.exports = { createSnapshotService, DAY_LIMIT, COUNT_LIMIT }

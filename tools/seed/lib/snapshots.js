'use strict'
// 스냅샷 시험 데이터 — Cassandra `ars.snapshotlist`·`ars.snapshot` 에 스냅샷 서버(WriteWorker)와 같은 꼴로 넣는다.
// - 파티션 연·월·일은 파일 ms 를 KST 로 읽은 날짜(스냅샷 서버 JVM 시간대).
// - TTL 을 주지 않는다 — 테이블 기본값(15일)을 따른다.
// - `SEWT_` 설비에만 넣고 지운다(공유 로컬 Cassandra).
const { PNG } = require('pngjs')
const D = require('../data/snapshots')

const DAY = 86400000
const KST_OFFSET = 9 * 3600000
const Q_INSERT_LIST = 'insert into snapshotlist (eqpid, year, month, fname, fname_data) values (?, ?, ?, ?, ?)'
const Q_INSERT_IMAGE = 'insert into snapshot (eqpid, year, month, day, fname, image) values (?, ?, ?, ?, ?, ?)'
const Q_DELETE_LIST = 'delete from snapshotlist where eqpid = ? and year = ? and month = ?'
const Q_DELETE_IMAGE = 'delete from snapshot where eqpid = ? and year = ? and month = ? and day = ?'
const Q_REMOVE_LIST = 'delete from snapshotlist where eqpid = ? and year = ? and month = ? and fname = ?'
const Q_REMOVE_IMAGE = 'delete from snapshot where eqpid = ? and year = ? and month = ? and day = ? and fname = ?'
const CLEAN_BACK_DAYS = 16
const CLEAN_AHEAD_DAYS = 1

function partitionOf(ms) {
  const d = new Date(ms + KST_OFFSET)
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }
}

// KST 날짜(연·월·일)와 'HH:mm:ss.fff' → ms
function at({ year, month, day }, time) {
  const [h, mi, rest] = time.split(':')
  const [s, ms] = rest.split('.')
  return Date.UTC(year, month - 1, day, Number(h), Number(mi), Number(s), Number(ms)) - KST_OFFSET
}

// 640×360 그림 — 장마다 바탕색이 다르고, 40px 격자와 클릭 자리(있으면)의 붉은 네모를 그린다.
function snapshotPng(index, point) {
  const png = new PNG({ width: D.WIDTH, height: D.HEIGHT })
  const base = [(index * 53) % 200 + 30, (index * 97) % 200 + 30, (index * 31) % 200 + 30]
  for (let y = 0; y < D.HEIGHT; y++) {
    for (let x = 0; x < D.WIDTH; x++) {
      const i = (y * D.WIDTH + x) * 4
      const grid = x % 40 === 0 || y % 40 === 0
      const hit = point && Math.abs(x - point[0]) <= 4 && Math.abs(y - point[1]) <= 4
      const [r, g, b] = hit ? [230, 30, 30] : grid ? [255, 255, 255] : base
      png.data[i] = r
      png.data[i + 1] = g
      png.data[i + 2] = b
      png.data[i + 3] = 255
    }
  }
  return PNG.sync.write(png)
}

function planSnapshots(now) {
  const today = partitionOf(now)
  const yesterday = partitionOf(at(today, '12:00:00.000') - DAY)
  const rows = []
  const add = (eqpId, ms, a, b, point, withPng = true) => {
    rows.push({ eqpId, fileName: `${ms}_[${a}][${b}].png`, ms, png: withPng ? snapshotPng(rows.length, point) : null })
  }
  const click = (eqpId, ms, x, y, withPng) => add(eqpId, ms, x, y, [x, y], withPng)

  for (const [time, x, y] of D.TODAY_CLICKS) click(D.PHOTO, at(today, time), x, y)
  const txn = at(today, D.TODAY_TAGS[0][0])
  for (const [time, code] of D.TODAY_TAGS) add(D.PHOTO, at(today, time), code, txn, null)
  const same = at(today, D.TODAY_SAME_MS.time)
  click(D.PHOTO, same, ...D.TODAY_SAME_MS.click)
  add(D.PHOTO, same, D.TODAY_SAME_MS.tagCode, same, null)
  click(D.PHOTO, at(today, D.TODAY_LIST_ONLY[0]), D.TODAY_LIST_ONLY[1], D.TODAY_LIST_ONLY[2], false)
  for (const [time, x, y] of D.YESTERDAY_CLICKS) click(D.PHOTO, at(yesterday, time), x, y)
  click(D.PHOTO, now - D.OLD_CLICK.daysAgo * DAY, D.OLD_CLICK.x, D.OLD_CLICK.y)
  for (const [time, x, y] of D.CVD_TODAY_CLICKS) click(D.CVD, at(today, time), x, y)
  return rows
}

function assertTestEquipment(eqpIds) {
  const bad = eqpIds.filter((id) => typeof id !== 'string' || !id.startsWith('SEWT_'))
  if (bad.length) throw new Error(`스냅샷 시험 데이터는 SEWT_ 설비에만 씁니다: ${bad.map((v) => JSON.stringify(v)).join(', ')}`)
}

async function seedSnapshots(client, rows) {
  assertTestEquipment(rows.map((r) => r.eqpId))
  const out = { list: 0, image: 0 }
  for (const r of rows) {
    const { year, month, day } = partitionOf(r.ms)
    await client.execute(Q_INSERT_LIST, [r.eqpId, year, month, r.fileName, r.fileName], { prepare: true })
    out.list++
    if (r.png) {
      await client.execute(Q_INSERT_IMAGE, [r.eqpId, year, month, day, r.fileName, r.png.toString('base64')], { prepare: true })
      out.image++
    }
  }
  return out
}

// 최근 16일부터 내일까지 걸치는 파티션을 지운다(보관 15일 + 여유).
async function cleanSnapshots(client, eqpIds, now) {
  assertTestEquipment(eqpIds)
  const days = []
  for (let k = -CLEAN_BACK_DAYS; k <= CLEAN_AHEAD_DAYS; k++) days.push(partitionOf(now + k * DAY))
  const months = []
  for (const d of days) {
    if (!months.some((m) => m.year === d.year && m.month === d.month)) months.push({ year: d.year, month: d.month })
  }
  const out = { listPartitions: 0, imagePartitions: 0 }
  for (const eqpId of eqpIds) {
    for (const m of months) {
      await client.execute(Q_DELETE_LIST, [eqpId, m.year, m.month], { prepare: true })
      out.listPartitions++
    }
    for (const d of days) {
      await client.execute(Q_DELETE_IMAGE, [eqpId, d.year, d.month, d.day], { prepare: true })
      out.imagePartitions++
    }
  }
  return out
}

// 넣은 줄만 키로 지운다 — 통합 시험이 자기 줄을 치울 때 쓴다(파티션을 통째로 지우지 않는다).
async function removeSnapshots(client, rows) {
  assertTestEquipment(rows.map((r) => r.eqpId))
  for (const r of rows) {
    const { year, month, day } = partitionOf(r.ms)
    await client.execute(Q_REMOVE_LIST, [r.eqpId, year, month, r.fileName], { prepare: true })
    await client.execute(Q_REMOVE_IMAGE, [r.eqpId, year, month, day, r.fileName], { prepare: true })
  }
  return { rows: rows.length }
}

module.exports = { planSnapshots, seedSnapshots, cleanSnapshots, removeSnapshots, partitionOf }

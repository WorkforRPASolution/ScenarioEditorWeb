'use strict'
// 큰 달 측정용 스냅샷 목록(P3 설계 §11) — 이름만 넣는다(그림 없음). `seed -- snapshots-big` 이 넣고 `seed -- clean` 이 지운다.
// - 바쁜 설비: 이번 달(KST) 파티션에 1일부터 지금까지 고르게. 앞 절반은 TTL 1 로 넣어 "지워진 줄"(tombstone)로 만든다.
// - 오래 쉰 설비: 16~26일 전 열흘에 모두 TTL 1 — 보관 기간이 지나 전부 지워진 달. 운영에서 지워진 줄은 늘 15일보다 오래된 ms 다.
const { partitionOf, assertTestEquipment } = require('./snapshots')

const BIG_EQP = 'SEWT_PHOTO_B01'
const IDLE_EQP = 'SEWT_CVD_B01'
const DAY = 86400000
const KST_OFFSET = 9 * 3600000
const Q_INSERT = 'insert into snapshotlist (eqpid, year, month, fname, fname_data) values (?, ?, ?, ?, ?)'
const Q_INSERT_EXPIRED = `${Q_INSERT} using ttl 1`

function planBig(now, { bigCount = 180000, idleCount = 120000 } = {}) {
  const { year, month } = partitionOf(now)
  const monthStart = Date.UTC(year, month - 1, 1) - KST_OFFSET
  const span = now - monthStart
  if (span < bigCount) throw new Error(`월초라 이번 달이 ${bigCount}줄을 넣기에 짧습니다(${span}ms) — 며칠 뒤에 돌리거나 줄 수를 줄이세요`)
  const rows = []
  const name = (ms, i) => `${ms}_[${i % 640}][${i % 360}].png`
  for (let i = 0; i < bigCount; i++) {
    const ms = monthStart + Math.floor((i * span) / bigCount)
    rows.push({ eqpId: BIG_EQP, fileName: name(ms, i), ms, expired: i < bigCount / 2 })
  }
  const idleStart = now - 26 * DAY
  for (let i = 0; i < idleCount; i++) {
    const ms = idleStart + Math.floor((i * 10 * DAY) / idleCount)
    rows.push({ eqpId: IDLE_EQP, fileName: name(ms, i), ms, expired: true })
  }
  return rows
}

// 한 묶음 = 한 파티션의 같은 종류 줄(batchSize 줄 이하, unlogged). 묶음 여럿을 함께 보낸다.
async function seedBig(client, rows, { batchSize = 40, concurrency = 16 } = {}) {
  assertTestEquipment(rows.map((r) => r.eqpId))
  const batches = []
  let key = null
  for (const r of rows) {
    const { year, month } = partitionOf(r.ms)
    const k = `${r.eqpId}/${year}/${month}/${r.expired}`
    if (k !== key || batches[batches.length - 1].length >= batchSize) { batches.push([]); key = k }
    batches[batches.length - 1].push({ query: r.expired ? Q_INSERT_EXPIRED : Q_INSERT, params: [r.eqpId, year, month, r.fileName, r.fileName] })
  }
  let next = 0
  const worker = async () => {
    while (next < batches.length) {
      const queries = batches[next++]
      await client.batch(queries, { prepare: true, logged: false })
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, worker))
  return { rows: rows.length, expired: rows.filter((r) => r.expired).length, batches: batches.length }
}

module.exports = { planBig, seedBig, BIG_EQP, IDLE_EQP }

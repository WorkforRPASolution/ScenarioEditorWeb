'use strict'
// 큰 달 측정(P3 설계 §11) — 한 달 파티션에 줄이 아주 많고 지워진 줄(tombstone)이 섞였을 때 스냅샷 API 가 걸리는 시간.
// 준비: npm run seed -- reset basic anomaly && npm run seed -- snapshots-big
//       웹 서버: SE_DEV_USER_OVERRIDE=1 npm --prefix server start
//       (스냅샷 서버 DIR 과 견주려면) tools/infra/prepare-ss.sh && docker compose -f infra/docker-compose.yml --profile ss up -d ss-zookeeper snapshot-server
// 기준: 하루 목록 2초 안. 어기면 종료 코드 1. 끝나면 npm run seed -- clean 으로 큰 달을 지운다.
const { execFileSync } = require('node:child_process')
const { BIG_EQP, IDLE_EQP } = require('../seed/lib/snapshotsBig')
const { partitionOf } = require('../seed/lib/snapshots')

const API = process.env.API || 'http://127.0.0.1:3100/api/scenario-editor'
const SS = process.env.SNAPSHOT_SERVER_URL || 'http://127.0.0.1:8081'
const H = { 'X-SE-User': 'sew_master' }
const LIMIT = { dayListMs: 2000 }
const DAY = 86400000

const pad = (n) => String(n).padStart(2, '0')
const dateOf = (ms) => { const p = partitionOf(ms); return `${p.year}-${pad(p.month)}-${pad(p.day)}` }

// 웹 서버(3100) 프로세스의 지금 상주 메모리(MiB). 최고값은 서버를 `/usr/bin/time -l node index.js` 로 띄워 따로 본다.
function serverRssMb() {
  try {
    const port = new URL(API).port || '80'
    const pid = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' }).trim().split('\n')[0]
    return Math.round(Number(execFileSync('ps', ['-o', 'rss=', '-p', pid], { encoding: 'utf8' }).trim()) / 1024)
  } catch {
    return null
  }
}

async function timed(label, path) {
  const t0 = Date.now()
  const res = await fetch(`${API}${path}`, { headers: H })
  const text = await res.text()
  const ms = Date.now() - t0
  let body = null
  try { body = JSON.parse(text) } catch { /* JSON 이 아님 */ }
  return { label, ms, status: res.status, bytes: text.length, data: body && body.data, code: body && body.code, rssMb: serverRssMb() }
}

async function dir(eqpId, year, month) {
  const t0 = Date.now()
  try {
    const res = await fetch(`${SS}/EARS/Snapshot`, { method: 'POST', headers: { FuncType: 'DIR', 'Content-Type': 'application/json' }, body: JSON.stringify({ hostname: eqpId, year, month }), signal: AbortSignal.timeout(60000) })
    const text = await res.text()
    let names = null
    try { names = JSON.parse(text).filelist.length } catch { /* 실패 응답 */ }
    return { ms: Date.now() - t0, status: res.status, names, bytes: text.length, head: names === null ? text.slice(0, 160) : undefined }
  } catch (e) {
    return { ms: Date.now() - t0, skipped: `스냅샷 서버에 닿지 못함 (${e.cause ? e.cause.code : e.name})` }
  }
}

;(async () => {
  const now = Date.now()
  const today = dateOf(now)
  const yesterday = dateOf(now - DAY)
  const { year, month } = partitionOf(now)
  const idleMonth = partitionOf(now - 20 * DAY)
  const show = (r, extra) => console.log(`${r.label.padEnd(34)} ${String(r.ms).padStart(6)}ms  HTTP ${r.status}${r.code ? ` ${r.code}` : ''}  ${extra}  (응답 ${r.bytes}자, 서버 RSS ${r.rssMb ?? '?'} MiB)`)
  const fails = []

  const warm = await timed('첫 요청(연결 맺기 포함)', `/snapshots/days?eqpId=${BIG_EQP}`)
  show(warm, `latest ${warm.data && warm.data.latest}`)

  for (const [label, date] of [['하루 목록 — 어제(꽉 찬 하루)', yesterday], ['하루 목록 — 오늘', today], ['하루 목록 — 어제 다시', yesterday]]) {
    const r = await timed(label, `/snapshots?eqpId=${BIG_EQP}&date=${date}`)
    show(r, r.data ? `${date} ${r.data.items.length}줄, truncated ${r.data.truncated}` : '')
    if (r.status !== 200 || r.ms > LIMIT.dayListMs) fails.push(`${label}: ${r.ms}ms HTTP ${r.status} (기준 ${LIMIT.dayListMs}ms)`)
  }

  const expiredDay = dateOf(now - Math.floor((now - (Date.UTC(year, month - 1, 1) - 9 * 3600000)) * 0.75))
  const gone = await timed('하루 목록 — 지워진 날', `/snapshots?eqpId=${BIG_EQP}&date=${expiredDay}`)
  show(gone, gone.data ? `${expiredDay} ${gone.data.items.length}줄` : '')

  const latest = await timed('가장 늦은 한 장', `/snapshots/days?eqpId=${BIG_EQP}`)
  show(latest, `latest ${latest.data && latest.data.latest}`)

  const counts = await timed('15일 날짜별 개수', `/snapshots/days?eqpId=${BIG_EQP}&counts=1`)
  const total = counts.data && counts.data.days ? Object.values(counts.data.days).reduce((a, b) => a + b, 0) : null
  show(counts, counts.data ? `${Object.keys(counts.data.days).length}일 ${total}줄, truncated ${counts.data.truncated}` : '')

  const idle = await timed('오래 쉰 설비 — 가장 늦은 한 장', `/snapshots/days?eqpId=${IDLE_EQP}`)
  show(idle, `latest ${idle.data ? idle.data.latest : '-'}`)
  const idleCounts = await timed('오래 쉰 설비 — 15일 개수', `/snapshots/days?eqpId=${IDLE_EQP}&counts=1`)
  show(idleCounts, idleCounts.data ? `${Object.keys(idleCounts.data.days).length}일` : '')
  for (const r of [gone, latest, counts, idle, idleCounts]) if (r.status !== 200) fails.push(`${r.label}: HTTP ${r.status} ${r.code || ''}`)

  console.log('── 스냅샷 서버 DIR (데스크톱이 쓰는 길, 한 달 전체) ──')
  console.log(`${BIG_EQP} ${year}-${month}:`, await dir(BIG_EQP, year, month))
  console.log(`${IDLE_EQP} ${idleMonth.year}-${idleMonth.month}:`, await dir(IDLE_EQP, idleMonth.year, idleMonth.month))

  if (fails.length) { console.error(`기준 미달:\n  ${fails.join('\n  ')}`); process.exit(1) }
  console.log('기준 통과: 하루 목록 2초 안, 다른 조회 모두 200')
})().catch((e) => { console.error(`실패: ${e.message}`); process.exit(1) })

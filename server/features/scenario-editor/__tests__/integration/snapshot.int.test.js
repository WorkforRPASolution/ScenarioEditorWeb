// 스냅샷 목록·그림 통합 시험 — 로컬 Cassandra(my-cassandra-server, 키스페이스 ars)·Mongo·Redis 와 시험 데이터(seed reset)가 있어야 한다.
// 시험이 `SEWT_ETCH_*` 설비 파티션에 직접 넣고, 끝나면(실패해도) 넣은 줄만 지운다. seed 의 스냅샷(SEWT_PHOTO_A01·SEWT_CVD_A01)은 건드리지 않는다.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '../../../../..')
// 시험만 tools 를 읽는다 — 스냅샷 서버와 같은 꼴로 넣는 도구
const { seedSnapshots, removeSnapshots } = require(join(ROOT, 'tools/seed/lib/snapshots.js'))
const { connectCassandra } = require(join(ROOT, 'tools/seed/lib/cassandra.js'))

const DAY = 86400000
const KST = 9 * 3600000
const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const png = (label) => Buffer.concat([Buffer.from(SIG), Buffer.from(label)])
const kst = (y, mo, d, h = 0, mi = 0, s = 0, ms = 0) => Date.UTC(y, mo - 1, d, h - 9, mi, s, ms)
const enc = encodeURIComponent

const EQP_TODAY = 'SEWT_ETCH_B01' // 보정 0
const EQP_DIFF = 'SEWT_ETCH_A01' // 시험이 보정 +60 으로 바꿨다가 되돌린다
// "오늘" = 지금의 KST 날짜. 그 날 안의 고정 시각이라 자정 근처에 돌려도 한 날에 든다(지금보다 뒤일 수 있다).
const today = new Date(Date.now() + KST)
const [Y, M, D] = [today.getUTCFullYear(), today.getUTCMonth() + 1, today.getUTCDate()]
const TODAY = `${Y}-${String(M).padStart(2, '0')}-${String(D).padStart(2, '0')}`
const t = { click: kst(Y, M, D, 9, 13, 2, 4), start: kst(Y, M, D, 10, 0, 0), success: kst(Y, M, D, 10, 0, 40), night: kst(Y, M, D, 22, 0, 0) }
const row = (eqpId, ms, a, b, image) => ({ eqpId, fileName: `${ms}_[${a}][${b}].png`, ms, png: image })
const ROWS_TODAY = [
  row(EQP_TODAY, t.click, 412, 388, png('click')),
  row(EQP_TODAY, t.start, 9999, t.start, png('start')),
  row(EQP_TODAY, t.success, 9990, 5, null), // 목록에만 있다
  row(EQP_TODAY, t.night, 7, 8, png('night'))
]
// 보정 +60 설비의 표시 날짜 2026-11-01 = 원본 [10-31 23:00, 11-01 23:00) KST
const b = { before: kst(2026, 10, 31, 22, 59, 59), octIn: kst(2026, 10, 31, 23, 30), novIn: kst(2026, 11, 1, 22, 50), after: kst(2026, 11, 1, 23, 10) }
const ROWS_DIFF = [
  row(EQP_DIFF, b.before, 1, 1, null),
  row(EQP_DIFF, b.octIn, 2, 2, png('oct')), // 10월 파티션에 있지만 표시는 11-01 00:30
  row(EQP_DIFF, b.novIn, 3, 3, null),
  row(EQP_DIFF, b.after, 4, 4, null)
]
const ALL = [...ROWS_TODAY, ...ROWS_DIFF]

let server
let base
let cassandra
let earsDb
beforeAll(async () => {
  require('dotenv').config({ path: join(ROOT, 'server/.env') })
  process.env.SE_DEV_USER_OVERRIDE = '1'
  process.env.SE_DISPLAY_TZ = 'Asia/Seoul'
  process.env.SE_SNAPSHOT_PARTITION_TZ = 'Asia/Seoul'
  cassandra = await connectCassandra()
  if (!cassandra) throw new Error('server/.env 에 CASSANDRA_CONTACT_POINTS 가 없습니다')
  await removeSnapshots(cassandra, ALL) // 앞 실행이 남긴 것
  await seedSnapshots(cassandra, ALL)
  const { connectDB, earsConnection } = require('../../../../shared/db/connection')
  const { connectRedis } = require('../../../../shared/db/redisConnection')
  await connectDB()
  await connectRedis()
  earsDb = earsConnection.db
  const r = await earsDb.collection('EQP_INFO').updateOne({ eqpId: EQP_DIFF }, { $set: { snapshotTimeDiff: 60 } })
  if (r.matchedCount !== 1) throw new Error(`${EQP_DIFF} 가 없습니다 — npm run seed -- reset basic anomaly`)
  const app = require('../../../../app')
  await new Promise((r2) => { server = app.listen(0, '127.0.0.1', r2) })
  base = `http://127.0.0.1:${server.address().port}/api/scenario-editor`
  await fetch(`${base}/cache/refresh`, { method: 'POST', headers: { 'X-SE-User': 'sew_master' } })
})
afterAll(async () => {
  try {
    if (earsDb) await earsDb.collection('EQP_INFO').updateOne({ eqpId: EQP_DIFF }, { $set: { snapshotTimeDiff: 0 } })
    if (cassandra) await removeSnapshots(cassandra, ALL)
  } finally {
    if (cassandra) await cassandra.shutdown()
    if (server) await new Promise((r) => server.close(r))
    await require('../../deps').getDeps().snapshotRepo.shutdown()
    await require('../../../../shared/db/connection').closeConnections()
    await require('../../../../shared/db/redisConnection').closeRedis()
  }
})

const get = (path, user = 'sew_master') => fetch(`${base}${path}`, { headers: { 'X-SE-User': user } })
const data = async (res) => (await res.json()).data
const imagePath = (eqpId, fileName) => `/snapshots/${enc(eqpId)}/${enc(fileName)}/image`

describe('설비', () => {
  it('내 범위 설비만 — sew_cvd 는 SEWCVD 설비만 본다', async () => {
    const all = (await data(await get('/equipment'))).items
    expect(all.find((e) => e.eqpId === EQP_TODAY)).toEqual({ eqpId: EQP_TODAY, process: 'SEWETCH', model: 'SEWMODELB', line: 'SEWLINE1' })
    const cvd = (await data(await get('/equipment', 'sew_cvd'))).items
    expect(cvd.length).toBeGreaterThan(0)
    expect(cvd.every((e) => e.process === 'SEWCVD')).toBe(true)
  })
})

describe('하루 목록', () => {
  it('넣은 클릭·태그가 시각 순으로, 종류·태그·txn·이력 대상·시각·근무조가 맞다', async () => {
    const res = await get(`/snapshots?eqpId=${EQP_TODAY}&date=${TODAY}`)
    expect(res.status).toBe(200)
    const out = await data(res)
    expect(out).toMatchObject({ eqpId: EQP_TODAY, date: TODAY, timeDiff: 0, skipped: 0, truncated: false })
    expect(out.items.map((i) => [i.fileName, i.time, i.shift, i.kind, i.tag, i.x, i.y, i.txn, i.hasHistory, i.memo])).toEqual([
      [ROWS_TODAY[0].fileName, '09:13:02', 'DAY', 'click', null, 412, 388, null, false, null],
      [ROWS_TODAY[1].fileName, '10:00:00', 'DAY', 'tag', 'start', null, null, String(t.start), true, null],
      [ROWS_TODAY[2].fileName, '10:00:40', 'DAY', 'tag', 'success', null, null, '5', false, null],
      [ROWS_TODAY[3].fileName, '22:00:00', 'GY', 'click', null, 7, 8, null, false, null]
    ])
    for (const i of out.items) expect(i.daysLeft === 15 || i.daysLeft === 16, `${i.fileName} ${i.daysLeft}`).toBe(true)
  })

  it('스냅샷이 없는 날은 빈 목록이다(오류가 아니다)', async () => {
    const out = await data(await get(`/snapshots?eqpId=${EQP_TODAY}&date=2026-01-15`))
    expect(out.items).toEqual([])
  })

  // Review Focus 3: 표시 날짜의 하루가 두 달 파티션에 걸친다.
  it('월 경계: 보정 +60 설비의 1일 목록에 앞 달 파티션의 줄이 들고, 다른 날 것은 없다', async () => {
    const out = await data(await get(`/snapshots?eqpId=${EQP_DIFF}&date=2026-11-01`))
    expect(out.timeDiff).toBe(60)
    expect(out.items.map((i) => [i.fileName, i.time])).toEqual([[ROWS_DIFF[1].fileName, '00:30:00'], [ROWS_DIFF[2].fileName, '23:50:00']])
    const prev = await data(await get(`/snapshots?eqpId=${EQP_DIFF}&date=2026-10-31`))
    expect(prev.items.map((i) => [i.fileName, i.time])).toEqual([[ROWS_DIFF[0].fileName, '23:59:59']])
    const next = await data(await get(`/snapshots?eqpId=${EQP_DIFF}&date=2026-11-02`))
    expect(next.items.map((i) => [i.fileName, i.time])).toEqual([[ROWS_DIFF[3].fileName, '00:10:00']])
  })
})

describe('있는 날', () => {
  it('가장 늦은 날과 날짜별 개수', async () => {
    expect(await data(await get(`/snapshots/days?eqpId=${EQP_TODAY}`))).toEqual({ eqpId: EQP_TODAY, latest: TODAY, days: null, truncated: false })
    const counted = await data(await get(`/snapshots/days?eqpId=${EQP_TODAY}&counts=1`))
    expect(counted).toEqual({ eqpId: EQP_TODAY, latest: TODAY, days: { [TODAY]: 4 }, truncated: false })
  })

  it('보관 기간 안에 스냅샷이 없으면 latest null', async () => {
    const res = await get('/snapshots/days?eqpId=SEWT_CVD_B01&counts=1')
    expect(await data(res)).toEqual({ eqpId: 'SEWT_CVD_B01', latest: null, days: {}, truncated: false })
  })
})

describe('그림', () => {
  it('넣은 PNG 와 바이트가 같고, 남은 보관 기간만큼 캐시한다', async () => {
    const res = await get(imagePath(EQP_TODAY, ROWS_TODAY[0].fileName))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/^image\/png/)
    const m = /^private, max-age=(\d+), immutable$/.exec(res.headers.get('cache-control'))
    expect(m).not.toBeNull()
    expect(Number(m[1])).toBeGreaterThan(14 * 86400)
    expect(Number(m[1])).toBeLessThanOrEqual(16 * 86400)
    expect(Buffer.from(await res.arrayBuffer()).equals(ROWS_TODAY[0].png)).toBe(true)
  })

  it('<img> 처럼 헤더 없이 ?seUser= 로도 받는다', async () => {
    const res = await fetch(`${base}${imagePath(EQP_TODAY, ROWS_TODAY[1].fileName)}?seUser=sew_master`)
    expect(res.status).toBe(200)
    expect(Buffer.from(await res.arrayBuffer()).equals(ROWS_TODAY[1].png)).toBe(true)
  })

  it('보관 기간이 지난 시각의 그림은 캐시하지 않는다', async () => {
    const res = await get(imagePath(EQP_DIFF, ROWS_DIFF[1].fileName))
    expect(res.status).toBe(200)
    expect(Buffer.from(await res.arrayBuffer()).equals(ROWS_DIFF[1].png)).toBe(true)
    if (Date.now() > b.octIn + 15 * DAY) expect(res.headers.get('cache-control')).toBe('private, no-store')
  })

  // Review Focus 4: 목록에는 있는데 그림이 없다.
  it('목록에만 있는 이름·없는 이름은 404 SNAPSHOT_NOT_FOUND 이고 캐시 머리글이 없다', async () => {
    for (const name of [ROWS_TODAY[2].fileName, `${t.click + 1}_[1][1].png`]) {
      const res = await get(imagePath(EQP_TODAY, name))
      expect(res.status, name).toBe(404)
      expect(res.headers.get('cache-control') || '').not.toMatch(/immutable|max-age/)
      expect((await res.json()).code).toBe('SNAPSHOT_NOT_FOUND')
    }
  })

  it('파일 이름 꼴이 아니면 400 SNAPSHOT_BAD_NAME', async () => {
    const res = await get(imagePath(EQP_TODAY, "x' or 1=1 --.png"))
    expect([res.status, (await res.json()).code]).toEqual([400, 'SNAPSHOT_BAD_NAME'])
  })
})

describe('권한', () => {
  it('sew_cvd 가 다른 공정 설비를 부르면 목록·있는 날·그림 모두 403 EQP_FORBIDDEN', async () => {
    const paths = [`/snapshots?eqpId=${EQP_TODAY}&date=${TODAY}`, `/snapshots/days?eqpId=${EQP_TODAY}`, imagePath(EQP_TODAY, ROWS_TODAY[0].fileName)]
    for (const p of paths) {
      const res = await get(p, 'sew_cvd')
      expect([res.status, (await res.json()).code], p).toEqual([403, 'EQP_FORBIDDEN'])
    }
    // 그림은 헤더 없이 ?seUser= 로 불러도 같다(설정 사용자 sew_multi 는 SEWETCH 를 볼 수 있다)
    const img = await fetch(`${base}${paths[2]}?seUser=sew_cvd`)
    expect([img.status, (await img.json()).code]).toEqual([403, 'EQP_FORBIDDEN'])
  })

  it('없는 설비도 403 EQP_FORBIDDEN', async () => {
    const res = await get(`/snapshots?eqpId=SEWT_NOPE&date=${TODAY}`)
    expect([res.status, (await res.json()).code]).toEqual([403, 'EQP_FORBIDDEN'])
  })
})

describe('고장 (Review Focus 1)', () => {
  const { createSnapshotRepository } = require('../../repo/snapshotRepository')
  const driver = require('cassandra-driver')
  const closedPort = () => new Promise((resolve) => {
    const s = createServer()
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)) })
  })
  const timed = async (p) => {
    const t0 = Date.now()
    try { await p; return { e: null, ms: Date.now() - t0 } } catch (e) { return { e, ms: Date.now() - t0 } }
  }

  it('닫힌 포트면 503 SNAPSHOT_DOWN 이고 10초 안에 답한다 — 주소·계정을 문구에 싣지 않는다', async () => {
    const env = { ...process.env, CASSANDRA_PORT: String(await closedPort()) }
    const repo = createSnapshotRepository({ env, driver })
    try {
      const { e, ms } = await timed(repo.listNames(EQP_TODAY, { year: Y, month: M }, '0000000000000', '9999999999999', 10))
      expect([e.statusCode, e.code]).toEqual([503, 'SNAPSHOT_DOWN'])
      expect(ms).toBeLessThan(10000)
      expect(e.message).not.toContain('127.0.0.1')
      if (env.CASSANDRA_USERNAME) expect(e.message).not.toContain(env.CASSANDRA_USERNAME)
    } finally {
      await repo.shutdown()
    }
  })

  it('계정이 틀리면 503 SNAPSHOT_DOWN', async () => {
    const env = { ...process.env, CASSANDRA_USERNAME: 'sew_wrong_user', CASSANDRA_PASSWORD: 'sew_wrong_password' }
    const repo = createSnapshotRepository({ env, driver })
    try {
      const { e, ms } = await timed(repo.latestName(EQP_TODAY, { year: Y, month: M }))
      expect([e.statusCode, e.code]).toEqual([503, 'SNAPSHOT_DOWN'])
      expect(ms).toBeLessThan(10000)
      expect(e.message).not.toMatch(/sew_wrong/)
    } finally {
      await repo.shutdown()
    }
  })

  it('저장소 한도: 한도보다 줄이 많으면 한도에서 멈추고 truncated', async () => {
    const repo = createSnapshotRepository({ env: process.env, driver })
    try {
      const out = await repo.listNames(EQP_TODAY, { year: Y, month: M }, String(t.click), String(t.night + 1), 3)
      expect(out).toEqual({ names: ROWS_TODAY.slice(0, 3).map((r) => r.fileName), truncated: true })
      expect(await repo.latestName(EQP_TODAY, { year: Y, month: M })).toBe(ROWS_TODAY[3].fileName)
    } finally {
      await repo.shutdown()
    }
  })
})

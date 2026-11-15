// 스냅샷 목록·그림·이력 통합 시험 — 로컬 Cassandra(my-cassandra-server, 키스페이스 ars)·Mongo·Redis 와 시험 데이터(seed reset)가 있어야 한다.
// 이력 시험은 로컬 이력 서버(HttpWebServer — infra/docker-compose.yml 의 http-web-server, server/.env 의 HTTP_WEB_SERVER_URL)도 있어야 한다.
// 시험이 `SEWT_ETCH_*` 설비 파티션에 직접 넣고, 끝나면(실패해도) 넣은 줄만 지운다. seed 의 스냅샷(SEWT_PHOTO_A01·SEWT_CVD_A01)은 건드리지 않는다.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
const require = createRequire(import.meta.url)
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '../../../../..')
// 시험만 tools 를 읽는다 — 스냅샷 서버와 같은 꼴로 넣는 도구
const { seedSnapshots, removeSnapshots } = require(join(ROOT, 'tools/seed/lib/snapshots.js'))
const { connectCassandra } = require(join(ROOT, 'tools/seed/lib/cassandra.js'))
const { cleanupSewMemos, cleanupSewW, assertLocalTargets } = require(join(ROOT, 'tools/infra/sew-w-cleanup.js'))
const { seedHistory, cleanHistory } = require(join(ROOT, 'tools/seed/lib/history.js'))
const { startFaultProxy } = require(join(ROOT, 'tools/infra/fault-proxy.js'))

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
    expect(all.find((e) => e.eqpId === EQP_TODAY)).toEqual({ eqpId: EQP_TODAY, process: 'SEWETCH', model: 'SEWMODELB', line: 'SEWLINE1', ipAddr: '10.99.5.1', ipAddrL: '' })
    expect(all.find((e) => e.eqpId === 'SEWT_PRX01')).toMatchObject({ ipAddr: '10.99.11.1', ipAddrL: '192.168.0.11' })
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
    // 달력 범위(today·oldest)는 서버가 부를 때의 시각으로 정한다 — 자정을 걸치면 하루 다를 수 있어 꼴만 본다
    const span = { today: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), oldest: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }
    const plain = await data(await get(`/snapshots/days?eqpId=${EQP_TODAY}`))
    expect(plain).toEqual({ eqpId: EQP_TODAY, latest: TODAY, ...span, days: null, truncated: false })
    expect(plain.oldest < plain.today).toBe(true)
    expect(Math.round((Date.parse(plain.today) - Date.parse(plain.oldest)) / 86400000)).toBe(15)
    const counted = await data(await get(`/snapshots/days?eqpId=${EQP_TODAY}&counts=1`))
    expect(counted).toEqual({ eqpId: EQP_TODAY, latest: TODAY, ...span, days: { [TODAY]: 4 }, truncated: false })
  })

  it('보관 기간 안에 스냅샷이 없으면 latest null', async () => {
    const res = await get('/snapshots/days?eqpId=SEWT_CVD_B01&counts=1')
    expect(await data(res)).toMatchObject({ eqpId: 'SEWT_CVD_B01', latest: null, days: {}, truncated: false })
  })
})

describe('설비마다 스냅샷 유무', () => {
  it('내 범위 설비를 다 보고, 스냅샷이 있는 설비만 가장 늦은 표시 날짜와 함께 준다', async () => {
    const all = (await data(await get('/equipment'))).items
    const r = await data(await get('/snapshots/presence'))
    expect([r.enabled, r.checked, r.total, r.next]).toEqual([true, all.length, all.length, null])
    const latest = new Map(r.items)
    expect(latest.get(EQP_TODAY)).toBe(TODAY)
    expect(latest.has('SEWT_CVD_B01')).toBe(false) // 스냅샷이 없는 설비
    const ids = new Set(all.map((e) => e.eqpId))
    expect(r.items.every(([id, date]) => ids.has(id) && /^\d{4}-\d{2}-\d{2}$/.test(date))).toBe(true)
    // 있는 날 API 의 가장 늦은 날과 같다
    for (const [id, date] of r.items.slice(0, 5)) expect((await data(await get(`/snapshots/days?eqpId=${enc(id)}`))).latest, id).toBe(date)
  })

  it('sew_cvd 는 SEWCVD 설비만 — 다른 공정 설비의 유무는 오지 않는다', async () => {
    const cvd = (await data(await get('/equipment', 'sew_cvd'))).items
    const r = await data(await get('/snapshots/presence', 'sew_cvd'))
    expect([r.checked, r.total, r.next]).toEqual([cvd.length, cvd.length, null])
    const ids = new Set(cvd.map((e) => e.eqpId))
    expect(r.items.every(([id]) => ids.has(id))).toBe(true)
    expect(new Map(r.items).has(EQP_TODAY)).toBe(false)
  })

  it('after 뒤의 설비만 본다', async () => {
    const all = (await data(await get('/equipment'))).items
    const mid = all[Math.floor(all.length / 2)].eqpId
    const r = await data(await get(`/snapshots/presence?after=${enc(mid)}`))
    expect([r.checked, r.total, r.next]).toEqual([all.length, all.length, null])
    expect(r.items.every(([id]) => id > mid)).toBe(true)
  })
})

// 메모는 로컬 Mongo `ARS_USER_MEMO` 에 SEWT_ 설비의 것만 만들고, 끝나면(실패해도) 그것만 지운다. 컬렉션은 지우지 않는다.
describe('메모 (P3-C)', () => {
  const J = { 'Content-Type': 'application/json' }
  const CLICK = ROWS_TODAY[0].fileName
  const START = ROWS_TODAY[1].fileName
  const NIGHT = ROWS_TODAY[3].fileName
  const memoUrl = (eqpId, fileName) => `${base}/snapshots/${enc(eqpId)}/${enc(fileName)}/memo`
  const put = (fileName, body, user = 'sew_master', eqpId = EQP_TODAY) => fetch(memoUrl(eqpId, fileName), { method: 'PUT', headers: { ...J, 'X-SE-User': user }, body: JSON.stringify(body) })
  const del = (fileName, body, user = 'sew_master', eqpId = EQP_TODAY) => fetch(memoUrl(eqpId, fileName), { method: 'DELETE', headers: { ...J, 'X-SE-User': user }, body: JSON.stringify(body) })
  const col = () => earsDb.collection('ARS_USER_MEMO')
  const docsOf = (fileName) => col().find({ eqpid: EQP_TODAY, filename: fileName }).toArray()
  const listToday = async (user = 'sew_master') => data(await get(`/snapshots?eqpId=${EQP_TODAY}&date=${TODAY}`, user))
  const STAMP = expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  const clean = () => cleanupSewMemos({ env: process.env, db: earsDb })
  beforeAll(clean)
  afterAll(clean)

  it('새 메모: 데스크톱이 읽는 일곱 필드 문서가 생기고, 하루 목록의 그 줄에 붙는다', async () => {
    const before = Date.now()
    const res = await put(CLICK, { memo: '  알람 창이 가려짐  ', expect: null })
    expect(res.status).toBe(200)
    const saved = (await data(res)).memo
    expect(saved).toEqual({ text: '알람 창이 가려짐', author: 'sew_master', authorName: expect.any(String), writtenAt: STAMP, editedBy: null, editedAt: null })
    const docs = await docsOf(CLICK)
    expect(docs).toHaveLength(1)
    const { _id, ...doc } = docs[0]
    expect(Object.keys(doc).sort()).toEqual(['eqpid', 'filename', 'hiddensnapshot', 'memo', 'process', 'singleid', 'snapshotTimestamp'])
    expect(doc).toMatchObject({ singleid: 'sew_master', eqpid: EQP_TODAY, process: 'SEWETCH', memo: '알람 창이 가려짐', filename: CLICK, hiddensnapshot: '0' })
    expect(doc.snapshotTimestamp).toBeInstanceOf(Date)
    expect(doc.snapshotTimestamp.getTime()).toBeGreaterThanOrEqual(before)
    const out = await listToday()
    expect(out.memoFailed).toBe(false)
    expect(out.items.map((i) => i.memo && i.memo.text)).toEqual(['알람 창이 가려짐', null, null, null])
    expect(out.items[0].memo).toEqual(saved)
  })

  it('같은 스냅샷에 새 메모를 또 쓰면 409 MEMO_CONFLICT 와 지금 값 — 덮어쓰지 않는다', async () => {
    const res = await put(CLICK, { memo: '내 것', expect: null }, 'sew_multi')
    const body = await res.json()
    expect([res.status, body.code, body.details.current.text, body.details.current.author]).toEqual([409, 'MEMO_CONFLICT', '알람 창이 가려짐', 'sew_master'])
    expect((await docsOf(CLICK)).map((d) => d.memo)).toEqual(['알람 창이 가려짐'])
  })

  it('고치기: 본 글이 맞으면 글과 고친 사람·때만 바뀌고 나머지 일곱 필드는 그대로다', async () => {
    const [before] = await docsOf(CLICK)
    const res = await put(CLICK, { memo: '고친 글', expect: '알람 창이 가려짐' }, 'sew_multi')
    expect(res.status).toBe(200)
    expect((await data(res)).memo).toMatchObject({ text: '고친 글', author: 'sew_master', editedBy: 'sew_multi', editedAt: STAMP })
    const [after] = await docsOf(CLICK)
    expect(after.webEditedAt).toBeInstanceOf(Date)
    const { webEditedBy, webEditedAt, ...rest } = after
    expect(webEditedBy).toBe('sew_multi')
    expect(rest).toEqual({ ...before, memo: '고친 글' })
  })

  it('고치기·지우기: 본 글이 지금 값과 다르면 409 와 지금 값 — 바꾸지 않는다', async () => {
    const stalePut = await put(CLICK, { memo: '늦은 글', expect: '알람 창이 가려짐' })
    const a = await stalePut.json()
    expect([stalePut.status, a.code, a.details.current.text]).toEqual([409, 'MEMO_CONFLICT', '고친 글'])
    const staleDel = await del(CLICK, { expect: '알람 창이 가려짐' })
    const b = await staleDel.json()
    expect([staleDel.status, b.code, b.details.current.text]).toEqual([409, 'MEMO_CONFLICT', '고친 글'])
    expect((await docsOf(CLICK)).map((d) => d.memo)).toEqual(['고친 글'])
  })

  it('데스크톱이 쓴 문서(웹 필드 없음, 옛 공정)를 읽고 고쳐도 나머지 필드가 그대로다', async () => {
    const desktop = { singleid: 'sew_cvd', eqpid: EQP_TODAY, snapshotTimestamp: new Date(t.start + 60000), process: 'SEWOLD', memo: '데스크톱 메모', filename: START, hiddensnapshot: '0' }
    await col().insertOne({ ...desktop })
    const row = (await listToday()).items.find((i) => i.fileName === START)
    expect(row.memo).toMatchObject({ text: '데스크톱 메모', author: 'sew_cvd', editedBy: null })
    expect((await put(START, { memo: '웹이 고침', expect: '데스크톱 메모' })).status).toBe(200)
    const [after] = await docsOf(START)
    const { _id, webEditedBy, webEditedAt, ...rest } = after
    expect(rest).toEqual({ ...desktop, memo: '웹이 고침' })
    expect(webEditedBy).toBe('sew_master')
  })

  it('틀린 문서가 섞여 있어도 하루 목록·메모 목록이 읽힌다(DC-082)', async () => {
    await col().insertMany([
      { singleid: 'x', eqpid: EQP_TODAY, memo: 7, filename: NIGHT, hiddensnapshot: '0' },
      { singleid: 'x', eqpid: EQP_TODAY, memo: '이름이 이상함', filename: `${t.night}_broken`, hiddensnapshot: '0' },
      { eqpid: EQP_TODAY, filename: `${t.night + 1}_[1][1].png` }
    ])
    const out = await listToday()
    expect(out.memoFailed).toBe(false)
    expect(out.items.map((i) => i.memo && i.memo.text)).toEqual(['고친 글', '웹이 고침', null, null])
    const memos = await data(await get('/memos'))
    expect(memos.items.filter((m) => m.eqpId === EQP_TODAY).map((m) => m.memo.text).sort()).toEqual(['고친 글', '웹이 고침'])
  })

  it('숨김("1") 메모의 스냅샷은 하루 목록에서 빠진다', async () => {
    const r = await col().insertOne({ singleid: 'x', eqpid: EQP_TODAY, snapshotTimestamp: new Date(), process: 'SEWETCH', memo: '숨김', filename: ROWS_TODAY[2].fileName, hiddensnapshot: '1' })
    try {
      const out = await listToday()
      expect(out.items.map((i) => i.fileName)).toEqual([CLICK, START, NIGHT])
    } finally {
      await col().deleteOne({ _id: r.insertedId })
    }
    expect((await listToday()).items).toHaveLength(4)
  })

  it('메모 목록: 내 범위 설비의 메모만 — 설비의 지금 공정·모델과 스냅샷 표시 시각', async () => {
    const all = await data(await get('/memos'))
    expect(all.truncated).toBe(false)
    const mine = all.items.find((m) => m.eqpId === EQP_TODAY && m.fileName === CLICK)
    expect(mine).toEqual({
      eqpId: EQP_TODAY, process: 'SEWETCH', model: 'SEWMODELB', fileName: CLICK, date: TODAY, time: '09:13:02', daysLeft: expect.any(Number),
      memo: { text: '고친 글', author: 'sew_master', authorName: expect.any(String), writtenAt: STAMP, editedBy: 'sew_multi', editedAt: STAMP }
    })
    // 옛 공정(SEWOLD)이 적힌 메모도 설비의 지금 공정으로 보인다
    expect(all.items.find((m) => m.fileName === START)).toMatchObject({ process: 'SEWETCH' })
    const cvd = await data(await get('/memos', 'sew_cvd'))
    expect(cvd.items.some((m) => m.eqpId === EQP_TODAY)).toBe(false)
  })

  it('범위 밖 설비에는 메모를 쓰지도 지우지도 못한다(403 EQP_FORBIDDEN)', async () => {
    const w = await put(NIGHT, { memo: '남의 공정', expect: null }, 'sew_cvd')
    expect([w.status, (await w.json()).code]).toEqual([403, 'EQP_FORBIDDEN'])
    const d = await del(CLICK, { expect: '고친 글' }, 'sew_cvd')
    expect([d.status, (await d.json()).code]).toEqual([403, 'EQP_FORBIDDEN'])
    expect((await docsOf(CLICK)).map((x) => x.memo)).toEqual(['고친 글'])
    expect((await docsOf(NIGHT)).filter((x) => x.memo === '남의 공정')).toEqual([])
  })

  it('글 규칙과 스냅샷 이름: 작은따옴표·129자·빈 글·꼴이 아닌 이름·보관 기간 밖', async () => {
    const codeOf = async (res) => [res.status, (await res.json()).code]
    expect(await codeOf(await put(NIGHT, { memo: "it's", expect: null }))).toEqual([400, 'MEMO_QUOTE'])
    expect(await codeOf(await put(NIGHT, { memo: '가'.repeat(129), expect: null }))).toEqual([400, 'MEMO_TOO_LONG'])
    expect(await codeOf(await put(NIGHT, { memo: '   ', expect: null }))).toEqual([400, 'MEMO_EMPTY'])
    expect(await codeOf(await put('memo.bin', { memo: '글', expect: null }))).toEqual([400, 'SNAPSHOT_BAD_NAME'])
    expect(await codeOf(await put(`${Date.now() - 16 * DAY}_[1][1].png`, { memo: '글', expect: null }))).toEqual([404, 'SNAPSHOT_NOT_FOUND'])
    expect(await col().countDocuments({ eqpid: EQP_TODAY, singleid: 'sew_master', filename: NIGHT })).toBe(0)
  })

  it('지우기: 본 글이 맞으면 그 문서가 사라지고, 다시 지우면 404 MEMO_GONE', async () => {
    const res = await del(CLICK, { expect: '고친 글' })
    expect(res.status).toBe(200)
    expect(await data(res)).toEqual({ removed: true, memo: null })
    expect(await docsOf(CLICK)).toEqual([])
    const again = await del(CLICK, { expect: '고친 글' })
    expect([again.status, (await again.json()).code]).toEqual([404, 'MEMO_GONE'])
    const gonePut = await put(CLICK, { memo: '늦은 고치기', expect: '고친 글' })
    const body = await gonePut.json()
    expect([gonePut.status, body.code, body.details]).toEqual([409, 'MEMO_CONFLICT', { current: null }])
    expect((await listToday()).items[0].memo).toBeNull()
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

// 이력(P3-D) — 실제 이력 서버가 AppendHistory 로 받아 Cassandra historylog 에 쓴 것을 웹 API 로 읽는다.
describe('이력 (P3-D)', () => {
  const TXN = String(t.start) // 위 하루 목록의 시작 태그 줄의 txn
  const STEPS = [
    { eqpId: EQP_TODAY, txn: t.start, step: 1, text: '로그인 창 확인', screen: png('screen-1'), screenSize: [640, 360], ref: png('ref-1'), refSize: [40, 20] },
    { eqpId: EQP_TODAY, txn: t.start, step: 2, text: "A<B & 'x' <b>누르기</b>", screen: png('screen-2'), screenSize: [640, 360], ref: png('ref-2'), refSize: [40, 20] }
  ]
  const onlyMine = (id) => id === EQP_TODAY
  const historyPath = (eqpId, txn) => `/history/${enc(eqpId)}/${enc(txn)}`
  const bytesOf = (src) => Buffer.from(src.replace('data:image/png;base64,', ''), 'base64')
  let hwsUrl
  let proxy

  beforeAll(async () => {
    hwsUrl = process.env.HTTP_WEB_SERVER_URL
    if (!hwsUrl) throw new Error('server/.env 에 HTTP_WEB_SERVER_URL 이 없습니다 — 로컬 이력 서버(tools/infra/prepare-hws.sh, docker compose up -d)')
    await cleanHistory(cassandra, onlyMine) // 앞 실행이 남긴 것
    await seedHistory(hwsUrl, STEPS)
    proxy = await startFaultProxy({ target: hwsUrl })
  })
  afterAll(async () => {
    process.env.HTTP_WEB_SERVER_URL = hwsUrl
    try { if (proxy) await proxy.close() } finally { if (cassandra) await cleanHistory(cassandra, onlyMine) }
  })

  it('하루 목록의 태그 줄 txn 으로 부르면 스텝·설명·그림이 온다 — 설명은 넣은 글 그대로, 그림은 넣은 바이트 그대로', async () => {
    const list = await data(await get(`/snapshots?eqpId=${EQP_TODAY}&date=${TODAY}`))
    const tag = list.items.find((i) => i.hasHistory)
    expect(tag.txn).toBe(TXN)
    const res = await get(historyPath(EQP_TODAY, tag.txn))
    expect(res.status).toBe(200)
    const out = await data(res)
    expect(out).toMatchObject({ eqpId: EQP_TODAY, txn: TXN })
    expect(out.steps.map((s) => [s.no, s.text])).toEqual([[1, '로그인 창 확인'], [2, "A<B & 'x' <b>누르기</b>"]])
    for (const [i, s] of out.steps.entries()) {
      expect(s.images.map((im) => im.kind)).toEqual(['ref', 'screen'])
      expect(bytesOf(s.images[0].src).equals(STEPS[i].ref)).toBe(true)
      expect(bytesOf(s.images[1].src).equals(STEPS[i].screen)).toBe(true)
    }
    // 이력 서버의 HTML·스크립트는 응답에 없다(설명 글 안의 것만 글자로 남는다)
    const raw = JSON.stringify(out)
    for (const bad of ['<table', '<img', 'jquery', 'magnify']) expect(raw).not.toContain(bad)
  })

  it('이력이 없는 txn 은 404 HISTORY_NOT_FOUND', async () => {
    const res = await get(historyPath(EQP_TODAY, '100000'))
    expect([res.status, (await res.json()).code]).toEqual([404, 'HISTORY_NOT_FOUND'])
  })

  it('범위 밖·없는 설비는 403 EQP_FORBIDDEN, txn 이 99999 보다 작거나 숫자가 아니면 400', async () => {
    const forbidden = await get(historyPath(EQP_TODAY, TXN), 'sew_cvd')
    expect([forbidden.status, (await forbidden.json()).code]).toEqual([403, 'EQP_FORBIDDEN'])
    const none = await get(historyPath('SEWT_NOPE', TXN))
    expect([none.status, (await none.json()).code]).toEqual([403, 'EQP_FORBIDDEN'])
    for (const txn of ['99998', 'abc']) {
      const res = await get(historyPath(EQP_TODAY, txn))
      expect([res.status, (await res.json()).code], txn).toEqual([400, 'BAD_REQUEST'])
    }
  })

  // Review Focus 2: 이력 서버가 없거나 느려도 이력 보기만 안 된다.
  it('이력 서버에 닿지 못하면 503 HISTORY_DOWN, 답이 없으면 504 HISTORY_TIMEOUT — 그동안 하루 목록은 그대로다', async () => {
    const deps = require('../../deps').getDeps()
    const { createHistoryClient } = require('../../clients/historyClient')
    const { createHistoryService } = require('../../service/historyService')
    const original = deps.history
    try {
      process.env.HTTP_WEB_SERVER_URL = proxy.url
      const through = await get(historyPath(EQP_TODAY, TXN))
      expect(through.status).toBe(200) // 중계를 거쳐도 같은 답
      await proxy.setMode('down')
      const down = await get(historyPath(EQP_TODAY, TXN))
      const downBody = await down.json()
      expect([down.status, downBody.code]).toEqual([503, 'HISTORY_DOWN'])
      expect(JSON.stringify(downBody)).not.toContain(new URL(proxy.url).port)
      await proxy.setMode('hang')
      deps.history = createHistoryService({ client: createHistoryClient({ env: process.env, timeoutMs: 700 }), scopes: deps.scopes })
      const t0 = Date.now()
      const hang = await get(historyPath(EQP_TODAY, TXN))
      expect([hang.status, (await hang.json()).code]).toEqual([504, 'HISTORY_TIMEOUT'])
      expect(Date.now() - t0).toBeLessThan(5000)
      expect((await get(`/snapshots?eqpId=${EQP_TODAY}&date=${TODAY}`)).status).toBe(200)
    } finally {
      deps.history = original
      await proxy.setMode('pass')
      process.env.HTTP_WEB_SERVER_URL = hwsUrl
    }
  })

  it('주소가 비어 있으면 503 HISTORY_UNSET 이고 목록·그림은 그대로다', async () => {
    try {
      process.env.HTTP_WEB_SERVER_URL = ''
      const res = await get(historyPath(EQP_TODAY, TXN))
      expect([res.status, (await res.json()).code]).toEqual([503, 'HISTORY_UNSET'])
      expect((await get(`/snapshots?eqpId=${EQP_TODAY}&date=${TODAY}`)).status).toBe(200)
      expect((await get(imagePath(EQP_TODAY, ROWS_TODAY[0].fileName))).status).toBe(200)
    } finally {
      process.env.HTTP_WEB_SERVER_URL = hwsUrl
    }
  })
})

// P3-E 스냅샷에서 스텝 만들기(설계 §4.8): 화면은 떠 있는 스냅샷 그림의 바이트를 올린 그림(from: 'upload')으로 기준 화면에 넣어 배포한다.
// 서버는 이 길을 이미 받는다 — 여기서는 스냅샷 그림 API 가 준 바이트가 배포를 거쳐 다시 연 기준 화면에 그대로 남는지 본다.
// 시드 시나리오는 읽기만 하고 SEW_W_ 이름으로 배포한다(끝나면 지운다 — 배포 통합 시험과 같은 정리). 스텝이 없는 새 시나리오는 E2E ⑦ 이 본다.
describe('스냅샷을 기준 화면으로 배포 (P3-E)', () => {
  const SOURCE = { process: 'SEWCVD', model: 'SEWMODELA', name: 'ALL_CONDITIONS' } // 1 이미지 · 2 OCR · 3 대기 · 4 설비 상태
  const TARGET = { process: SOURCE.process, model: SOURCE.model, name: `SEW_W_${Date.now().toString(36).toUpperCase()}_SNAPSTEP` }
  const ENV_KEYS = ['MONGODB_URI', 'WEBMANAGER_DB_URI', 'SE_WEB_DB_URI', 'REDIS_URL', 'EARS_INTERFACE_URL']
  const pathOf = (k) => `/scenarios/${enc(k.process)}/${enc(k.model)}/${enc(k.name)}`
  const clean = async () => {
    const env = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
    assertLocalTargets(env) // 루프백이 아니면 던진다
    const webDb = require('../../../../shared/db/connection').webManagerConnection.db
    if (webDb.databaseName !== 'SE_WEB_DEV') throw new Error(`웹 전용 DB 가 SE_WEB_DEV 가 아니다: ${webDb.databaseName}`)
    const { getRedisClient } = require('../../../../shared/db/redisConnection')
    await cleanupSewW({ env, db: earsDb, webDb, redis: getRedisClient(), GridFSBucket: require('mongoose').mongo.GridFSBucket })
  }
  afterAll(clean)

  it('스냅샷 그림 API 의 바이트를 두 스텝의 기준 화면으로 한 번만 올려 배포하면, 다시 연 두 스텝의 기준 화면이 그 바이트다', async () => {
    const snap = await get(imagePath(EQP_TODAY, ROWS_TODAY[0].fileName))
    expect(snap.status).toBe(200)
    const bytes = Buffer.from(await snap.arrayBuffer())

    const sk = await data(await get(`${pathOf(SOURCE)}/versions/current`))
    const scenario = structuredClone(sk.edited)
    const withBase = scenario.steps.filter((s) => s.images.base && s.images.base.from === 'source')
    expect(withBase.map((s) => s.condition.kind)).toEqual(['image', 'ocr'])
    for (const s of withBase) s.images.base = { from: 'upload', tempId: 'snap1' }
    const form = new FormData()
    form.append('meta', JSON.stringify({ target: TARGET, propertyRev: sk.propertyRev, scenario, requestId: randomUUID() }))
    form.append('img:snap1', new Blob([bytes], { type: 'image/png' }), 'snap1.png')
    const res = await fetch(`${base}/deploy`, { method: 'POST', headers: { 'X-SE-User': 'sew_master' }, body: form })
    const out = await res.json()
    expect(res.status, JSON.stringify(out)).toBe(200)
    expect(out.data.result).toBe('ok')

    const back = await data(await get(`${pathOf(TARGET)}/versions/current`))
    expect(back.steps).toHaveLength(sk.steps.length)
    const shown = back.steps.filter((s) => s.baseImage.state === 'present')
    expect(shown.map((s) => s.condition.kind)).toEqual(['image', 'ocr'])
    for (const s of shown) {
      const img = await get(s.baseImage.url.replace(/^\/scenario-editor/, ''))
      expect(img.status, s.baseImage.url).toBe(200)
      expect(Buffer.from(await img.arrayBuffer()).equals(bytes), `스텝 ${s.no}`).toBe(true)
    }
    // 원본은 그대로다
    const src = await data(await get(`${pathOf(SOURCE)}/versions/current`))
    expect(src.headCrtime).toBe(sk.headCrtime)
  }, 60_000)
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
      const { e, ms } = await timed(repo.latestName(EQP_TODAY, { year: Y, month: M }, '0000000000000'))
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
      expect(await repo.latestName(EQP_TODAY, { year: Y, month: M }, String(t.click))).toBe(ROWS_TODAY[3].fileName)
      expect(await repo.latestName(EQP_TODAY, { year: Y, month: M }, String(t.night + 1))).toBeNull()
    } finally {
      await repo.shutdown()
    }
  })
})

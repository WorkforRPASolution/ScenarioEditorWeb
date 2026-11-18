// CommandServer 흉내(P5 설계 §10.1) — /EARS/Trigger 를 받아 적고 ok 를 답한다. 켜면 실제 CommandServer 의 규칙대로 실행 기록을 넣는다.
import { describe, it, expect, afterEach } from 'vitest'
import { createRequire } from 'node:module'
import http from 'node:http'
const require = createRequire(import.meta.url)
const { Long, Int32, Double } = require('mongodb')
const { startFakeCommandServer, recoveryDocOf, isoWithOffset } = require('../fake-command-server')

const HEADERS = { process: 'SEWCVD', model: 'SEWMODELA', eqpid: 'SEWT_CVD_A01', line: 'SEWLINE1', code: 'RUN_PROPS', triggeredBy: 'SE', txn: '1', issue_comment: '' }
const BODY = JSON.stringify({ '@UserInfo': '홍 - sew_multi', '@StartStep': '2', UserText: '밸브 "A" \\ 점검' })
const PROPERTY = { IsEnabled: true, StartDelay: new Int32(30), RetryCnt: new Int32(2), RetryInterval: Long.fromNumber(10), Priority: new Int32(3) }
const DOCS = [{ property: PROPERTY, scCategory: Long.fromNumber(2) }]

function post(url, headers, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${url}/EARS/Trigger`, { method: 'POST', headers, agent: false }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString() }))
    })
    req.on('error', reject)
    req.end(body)
  })
}
// 받은 필터·넣은 문서를 적는 가짜 Mongo Db
function fakeDb(docs = DOCS) {
  const inserted = []
  const updates = []
  const finds = []
  return {
    inserted, updates, finds,
    collection: (name) => ({
      find: (filter, options) => { finds.push({ name, filter, options }); return { limit: () => ({ toArray: async () => docs }) } },
      insertOne: async (d) => { inserted.push({ name, d }) },
      updateMany: async (filter, update) => { updates.push({ name, filter, update }); return { modifiedCount: 2 } }
    })
  }
}
const servers = []
async function start(opts = {}) {
  const s = await startFakeCommandServer({ port: 0, ...opts })
  servers.push(s)
  return s
}
afterEach(async () => { await Promise.all(servers.splice(0).map((s) => s.close())) })

describe('recoveryDocOf — 실제 CommandServer 가 등록하는 문서(JobActor.SaveAutoRecovery)', () => {
  const NOW = 1763427600123
  const of = (over = {}) => recoveryDocOf({ headers: HEADERS, body: BODY, docs: DOCS, now: NOW, ...over })

  it('문서 모양: 상태 Wait, retry "0/횟수/간격", txn_seq 는 Int64, params 에 본문 + ALTXT·ALID·@Trigger·__priority__(Int32)', () => {
    const d = of()
    expect(d).toEqual({
      process: 'SEWCVD', model: 'SEWMODELA', line: 'SEWLINE1', eqpid: 'SEWT_CVD_A01', txn_seq: Long.fromNumber(NOW), status: 'Wait', ears_code: 'RUN_PROPS',
      retry: '0/2/10', trigger_by: 'SE', create_date: isoWithOffset(NOW),
      params: { '@UserInfo': '홍 - sew_multi', '@StartStep': '2', UserText: '밸브 "A" \\ 점검', ALTXT: 'RUN_PROPS', ALID: 'RUN_PROPS', '@Trigger': 'SE', __priority__: new Int32(3) }
    })
    expect(d.txn_seq._bsontype).toBe('Long')
    expect(d.params.__priority__._bsontype).toBe('Int32')
  })
  it('create_date 는 이 PC 시간대의 ISO 글자(밀리초·offset)', () => {
    expect(isoWithOffset(NOW)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.123[+-]\d{2}:\d{2}$/)
    expect(new Date(isoWithOffset(NOW)).getTime()).toBe(NOW)
  })
  it('운영 속성 문서가 정확히 1건이 아니면 등록하지 않는다', () => {
    expect(of({ docs: [] })).toBeNull()
    expect(of({ docs: [DOCS[0], DOCS[0]] })).toBeNull()
  })
  it('property 가 없거나 scCategory 가 Int64 가 아니면 등록하지 않는다', () => {
    expect(of({ docs: [{ scCategory: Long.fromNumber(2) }] })).toBeNull()
    expect(of({ docs: [{ property: PROPERTY, scCategory: new Int32(2) }] })).toBeNull()
    expect(of({ docs: [{ property: PROPERTY, scCategory: new Double(2) }] })).toBeNull()
    expect(of({ docs: [{ property: PROPERTY }] })).toBeNull()
  })
  it('꺼진 시나리오는 등록하지 않는다', () => {
    expect(of({ docs: [{ property: { ...PROPERTY, IsEnabled: false }, scCategory: Long.fromNumber(2) }] })).toBeNull()
  })
  it('본문이 JSON 객체(값은 글자)가 아니면 등록하지 않는다', () => {
    for (const body of ['', 'not json', '[]', '"x"', '{"a":1}', '{"a":null}']) expect(of({ body })).toBeNull()
    expect(of({ body: '{}' }).params).toEqual({ ALTXT: 'RUN_PROPS', ALID: 'RUN_PROPS', '@Trigger': 'SE', __priority__: new Int32(3) })
  })
  it('시험 설비(SEWT_)가 아니면 등록하지 않는다 — 흉내만의 안전 장치', () => {
    expect(of({ headers: { ...HEADERS, eqpid: 'REAL_EQP_01' } })).toBeNull()
  })
  it('운영 속성은 CommandServer 규칙으로 읽는다 — Double 로 적힌 재시도는 0/10, 우선순위는 10', () => {
    const d = of({ docs: [{ property: { RetryCnt: new Double(2), RetryInterval: new Double(60), Priority: new Double(3) }, scCategory: Long.fromNumber(2) }] })
    expect(d.retry).toBe('0/0/10')
    expect(d.params.__priority__).toEqual(new Int32(10))
  })
})

describe('흉내 서버', () => {
  it('POST /EARS/Trigger 에 ok 를 답하고 받은 헤더·본문을 적는다', async () => {
    const s = await start()
    expect(await post(s.url, HEADERS, BODY)).toEqual({ status: 200, text: 'ok' })
    expect(s.calls).toHaveLength(1)
    expect(s.calls[0].headers).toEqual({ process: 'SEWCVD', model: 'SEWMODELA', eqpid: 'SEWT_CVD_A01', line: 'SEWLINE1', code: 'RUN_PROPS', triggeredBy: 'SE', txn: '1', issue_comment: '' })
    expect(s.calls[0].body).toBe(BODY)
    expect(s.url).toBe(`http://127.0.0.1:${s.port}`)
  })
  it('필수 헤더(process·model·eqpid·line·code·triggeredBy)가 없으면 500 — 적지 않는다', async () => {
    const s = await start()
    const { code, ...rest } = HEADERS
    expect((await post(s.url, rest, BODY)).status).toBe(500)
    expect(s.calls).toHaveLength(0)
  })
  it('다른 경로·메소드는 404', async () => {
    const s = await start()
    const res = await new Promise((resolve, reject) => http.get(`${s.url}/EARS/Trigger`, { agent: false }, (r) => { r.resume(); r.on('end', () => resolve(r.statusCode)) }).on('error', reject))
    expect(res).toBe(404)
  })
  it('제어 delayMs: 그만큼 늦게 답한다. status: 그 상태로 답한다(요청은 적는다)', async () => {
    const s = await start()
    s.set({ delayMs: 120 })
    const t0 = Date.now()
    await post(s.url, HEADERS, BODY)
    expect(Date.now() - t0).toBeGreaterThanOrEqual(110)
    s.set({ delayMs: 0, status: 500 })
    expect(await post(s.url, HEADERS, BODY)).toEqual({ status: 500, text: 'fake-command-server error' })
    expect(s.calls).toHaveLength(2)
  })
  it('reset: 제어 값을 처음으로, 받은 요청을 비운다', async () => {
    const s = await start()
    s.set({ status: 500 })
    await post(s.url, HEADERS, BODY)
    s.reset()
    expect(s.calls).toHaveLength(0)
    expect((await post(s.url, HEADERS, BODY)).status).toBe(200)
  })
  it('record 를 켜면 운영 속성을 형 그대로 읽어(promoteValues: false) 실행 기록을 넣는다 — 답은 먼저 한다', async () => {
    const db = fakeDb()
    const s = await start({ db, now: () => 5000 })
    s.set({ record: true })
    await post(s.url, HEADERS, BODY)
    await s.idle()
    expect(db.finds[0]).toEqual({ name: 'SC_PROPERTY', filter: { process: 'SEWCVD', eqpModel: 'SEWMODELA', scname: 'RUN_PROPS' }, options: { promoteValues: false, projection: { _id: 0, property: 1, scCategory: 1 } } })
    expect(db.inserted).toHaveLength(1)
    expect(db.inserted[0].name).toBe('EQP_AUTO_RECOVERY')
    expect(db.inserted[0].d).toMatchObject({ eqpid: 'SEWT_CVD_A01', ears_code: 'RUN_PROPS', status: 'Wait', txn_seq: Long.fromNumber(5000) })
  })
  it('record 를 켜지 않았거나 조건에 안 맞으면 넣지 않는다. 같은 ms 에 온 요청은 txn_seq 가 겹치지 않는다', async () => {
    const off = fakeDb()
    const s1 = await start({ db: off })
    await post(s1.url, HEADERS, BODY)
    await s1.idle()
    expect(off.inserted).toHaveLength(0)

    const none = fakeDb([])
    const s2 = await start({ db: none })
    s2.set({ record: true })
    await post(s2.url, HEADERS, BODY)
    await s2.idle()
    expect(none.inserted).toHaveLength(0)

    const db = fakeDb()
    const s3 = await start({ db, now: () => 7000 })
    s3.set({ record: true })
    await post(s3.url, HEADERS, BODY)
    await post(s3.url, HEADERS, BODY)
    await s3.idle()
    expect(db.inserted.map((x) => x.d.txn_seq.toNumber())).toEqual([7000, 7001])
  })
  it('recordDelayMs: 그만큼 뒤에 넣는다(늦게 생기는 기록)', async () => {
    const db = fakeDb()
    const s = await start({ db })
    s.set({ record: true, recordDelayMs: 150 })
    await post(s.url, HEADERS, BODY)
    expect(db.inserted).toHaveLength(0)
    await s.idle()
    expect(db.inserted).toHaveLength(1)
  })
  it('setStatus: 흉내가 넣은 문서 가운데 그 설비(·시나리오)의 상태·retry 를 바꾼다', async () => {
    const db = fakeDb()
    const s = await start({ db, now: () => 9000 })
    s.set({ record: true })
    await post(s.url, HEADERS, BODY)
    await s.idle()
    expect(await s.setStatus({ eqpid: 'SEWT_CVD_A01', status: 'Retry', retry: '1/2/10' })).toBe(2)
    expect(db.updates[0]).toEqual({
      name: 'EQP_AUTO_RECOVERY',
      filter: { $or: [{ eqpid: 'SEWT_CVD_A01', txn_seq: Long.fromNumber(9000), ears_code: 'RUN_PROPS' }] },
      update: { $set: { status: 'Retry', retry: '1/2/10' } }
    })
    expect(await s.setStatus({ eqpid: 'SEWT_CVD_A02', status: 'Success' })).toBe(0)
    expect(await s.setStatus({ eqpid: 'SEWT_CVD_A01', code: 'OTHER', status: 'Success' })).toBe(0)
    expect(db.updates).toHaveLength(1)
  })
  it('127.0.0.1 에만 연다', async () => {
    const s = await start()
    expect(s.host).toBe('127.0.0.1')
  })
})

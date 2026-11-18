// 시험 실행 통합 시험 (P5 설계 §10·§11) — 웹 백엔드 → 실제 InterfaceServer(/EARS/Action) → CommandServer 흉내(호스트 3195).
// 앞 묶음은 클라이언트·저장소 층(P5-A), 뒤 묶음은 API 층(P5-B — 로컬 Redis 와 시험 사용자·설비·시나리오(seed)가 있어야 한다). 로컬 InterfaceServer 컨테이너(설정의 ARSCommandServerAddress = host.docker.internal:3195)와
// 로컬 Mongo, 시험 데이터(npm run seed -- reset basic anomaly)가 있어야 한다. 포트 3195 가 비어 있어야 한다 — E2E 와 동시에 돌리지 않는다.
// 흉내가 넣은 실행 기록(EQP_AUTO_RECOVERY 의 SEWT_ 설비 것)과 요청 기록(웹 전용 DB)은 끝나면(실패해도) 지우고 0건인지 본다.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '../../../../..')
// 시험만 tools 를 읽는다 — CommandServer 흉내·정리 도구
const { startFakeCommandServer } = require(join(ROOT, 'tools/infra/fake-command-server.js'))
const { cleanupSewRecovery, cleanupSewTestRuns } = require(join(ROOT, 'tools/infra/sew-w-cleanup.js'))
const { startFaultProxy } = require(join(ROOT, 'tools/infra/fault-proxy.js'))
const { MongoClient } = createRequire(join(ROOT, 'tools/package.json'))('mongodb')
const { createActionClient } = require('../../clients/actionClient')
const { buildParams, classifyAction, pickRecovery, readRunProperty, isInt64, readOnoff } = require('../../domain/testRun')

const SKEW = 120_000
const A01 = { process: 'SEWCVD', model: 'SEWMODELA', eqpId: 'SEWT_CVD_A01', line: 'SEWLINE1' }
let env
let mongo // 흉내·정리용(tools 의 드라이버)
let earsDb
let webDb
let repo
let web
let fake
let client

const startFake = async () => { fake = await startFakeCommandServer({ db: earsDb }) }
const stopFake = async () => { if (fake) { await fake.close(); fake = null } }
const send = (target, name, params, over = {}) => client.send({ ...target, name, txn: Date.now(), body: buildParams(params), ...over })
const PARAMS = { userInfo: '시험 - sew_multi', startStep: 1, userText: 'INSPECTION' }

beforeAll(async () => {
  require('dotenv').config({ path: join(ROOT, 'server/.env') })
  env = { MONGODB_URI: process.env.MONGODB_URI, WEBMANAGER_DB_URI: process.env.WEBMANAGER_DB_URI, REDIS_URL: process.env.REDIS_URL, EARS_INTERFACE_URL: process.env.EARS_INTERFACE_URL || 'http://localhost:8080' }
  const { connectDB, earsConnection, webManagerConnection } = require('../../../../shared/db/connection')
  await connectDB()
  if (webManagerConnection.db.databaseName !== 'SE_WEB_DEV') throw new Error(`웹 전용 DB 가 SE_WEB_DEV 가 아니다: ${webManagerConnection.db.databaseName}`)
  const mongoose = require('mongoose')
  repo = require('../../repo/earsRepository').createEarsRepository(() => earsConnection.db, mongoose.mongo)
  web = require('../../repo/webRepository').createWebRepository(() => webManagerConnection.db, mongoose.mongo)
  mongo = new MongoClient(env.MONGODB_URI)
  await mongo.connect()
  earsDb = mongo.db()
  webDb = mongo.db('SE_WEB_DEV')
  await cleanupSewRecovery({ env, db: earsDb })
  await cleanupSewTestRuns({ env, webDb })
  client = createActionClient({ env })
  await startFake()
})
afterAll(async () => {
  await stopFake()
  if (mongo) {
    await cleanupSewRecovery({ env, db: earsDb })
    await cleanupSewTestRuns({ env, webDb })
    const left = [await earsDb.collection('EQP_AUTO_RECOVERY').countDocuments({ eqpid: /^SEWT_/ }), await webDb.collection('SCENARIO_EDITOR_TEST_RUNS').countDocuments({ eqpId: /^SEWT_/ })]
    await mongo.close()
    expect(left).toEqual([0, 0])
  }
  await require('../../../../shared/db/connection').closeConnections()
})
beforeEach(() => { if (fake) fake.reset() })

describe('actionClient → InterfaceServer → CommandServer 흉내', () => {
  it('접수: Success → accepted. 흉내가 받은 헤더(line·code·triggeredBy)와 본문 — 따옴표·역슬래시가 든 사유도 그대로', async () => {
    const params = { userInfo: '시험 - sew_multi', startStep: 2, userText: '밸브 "A" \\ 점검' }
    const got = await send(A01, 'RUN_PROPS', params)
    expect(got).toMatchObject({ kind: 'response', status: 200 })
    expect(classifyAction(got)).toEqual({ outcome: 'accepted' })
    expect(fake.calls).toHaveLength(1)
    expect(fake.calls[0].headers).toMatchObject({ process: 'SEWCVD', model: 'SEWMODELA', eqpid: 'SEWT_CVD_A01', line: 'SEWLINE1', code: 'RUN_PROPS', triggeredBy: 'SE' })
    expect(JSON.parse(fake.calls[0].body)).toEqual({ '@UserInfo': '시험 - sew_multi', '@StartStep': '2', UserText: '밸브 "A" \\ 점검' })
  })
  it('CommandServer 가 500 → Fail + 그 본문 → failed(까닭)', async () => {
    fake.set({ status: 500 })
    expect(classifyAction(await send(A01, 'RUN_PROPS', PARAMS))).toEqual({ outcome: 'failed', detail: 'fake-command-server error' })
  })
  it('CommandServer 가 없음 → Fail + "null" → unknown(받았는지 모른다)', async () => {
    await stopFake()
    try {
      const got = await send(A01, 'RUN_PROPS', PARAMS)
      expect(got).toMatchObject({ kind: 'response', status: 200 })
      expect(JSON.parse(got.text)).toEqual({ result: 'Fail', message: 'null' })
      expect(classifyAction(got)).toEqual({ outcome: 'unknown' })
    } finally {
      await startFake()
    }
  })
  it('InterfaceServer 에 닿지 못함(닫힌 포트) → down, 흉내는 아무것도 받지 않는다', async () => {
    // 열었다 닫은 포트 — 아무도 듣지 않는다
    const port = await new Promise((resolve) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)) }) })
    const closed = createActionClient({ env: { EARS_INTERFACE_URL: `http://127.0.0.1:${port}` } })
    const got = await closed.send({ ...A01, name: 'RUN_PROPS', txn: Date.now(), body: buildParams(PARAMS) })
    expect(got).toEqual({ kind: 'notSent', cause: 'ECONNREFUSED' })
    expect(classifyAction(got)).toEqual({ outcome: 'down' })
    expect(fake.calls).toHaveLength(0)
  })
  it('txn 이 숫자가 아니면 InterfaceServer 가 500 → unknown', async () => {
    expect(classifyAction(await send(A01, 'RUN_PROPS', PARAMS, { txn: 'abc' }))).toEqual({ outcome: 'unknown' })
    expect(fake.calls).toHaveLength(0)
  })
})

describe('실행 기록(EQP_AUTO_RECOVERY) — 흉내가 실제 규칙대로 넣은 문서를 웹이 찾는다', () => {
  it('RUN_PROPS: 문서가 생기고 findRecoveries + pickRecovery 가 내 요청의 것을 고른다(Wait · retry 0/2/10)', async () => {
    fake.set({ record: true })
    const params = { userInfo: '시험 - sew_multi', startStep: 2, userText: 'MAN_EXE' }
    const sentAt = Date.now()
    expect(classifyAction(await send(A01, 'RUN_PROPS', params))).toEqual({ outcome: 'accepted' })
    await fake.idle()
    const docs = await repo.findRecoveries({ eqpIds: ['SEWT_CVD_A01', 'SEWT_CVD_A02'], from: sentAt - SKEW, to: Date.now() + 600_000 })
    const rec = { eqpId: 'SEWT_CVD_A01', name: 'RUN_PROPS', ...params, sentAt }
    const { found, doc } = pickRecovery(docs, rec, SKEW)
    expect(found).toBe(1)
    expect(doc).toMatchObject({ status: 'Wait', retry: '0/2/10' })
    expect(doc.txnSeq).toBeGreaterThanOrEqual(sentAt - 1000)
    expect(new Date(doc.createDate).getTime()).toBe(doc.txnSeq)
    // 남의 요청(사용자·시작 스텝·사유가 다름)으로는 찾지 못한다
    expect(pickRecovery(docs, { ...rec, userInfo: '다른 사람 - other' }, SKEW).found).toBe(0)
    expect(pickRecovery(docs, { ...rec, startStep: 1 }, SKEW).found).toBe(0)
    // 찾은 뒤에는 정확히 집는다 — 상태가 바뀌면 그 값을 읽는다
    expect(await fake.setStatus({ eqpid: 'SEWT_CVD_A01', status: 'Retry', retry: '1/2/10' })).toBe(1)
    const pinned = await repo.findRecoveriesAt([{ eqpId: 'SEWT_CVD_A01', txnSeq: doc.txnSeq, name: 'RUN_PROPS' }])
    expect(pinned).toHaveLength(1)
    expect(pickRecovery(pinned, rec, SKEW).doc).toMatchObject({ status: 'Retry', retry: '1/2/10', txnSeq: doc.txnSeq })
    // 저장된 문서의 형: txn_seq 는 Int64, 우선순위는 운영 속성의 값
    const raw = await earsDb.collection('EQP_AUTO_RECOVERY').findOne({ eqpid: 'SEWT_CVD_A01', txn_seq: doc.txnSeq }, { promoteValues: false })
    expect(raw.txn_seq._bsontype).toBe('Long')
    expect(raw.params.__priority__.value).toBe(5)
    expect(raw.params).toMatchObject({ ALTXT: 'RUN_PROPS', ALID: 'RUN_PROPS', '@Trigger': 'SE' })
    expect(raw.trigger_by).toBe('SE')
  })
  it('꺼진 시나리오·유형이 Int32 인 시나리오·같은 키 문서가 둘인 시나리오는 접수돼도 문서가 생기지 않는다', async () => {
    fake.set({ record: true })
    const from = Date.now() - 1000
    const cases = [
      [{ process: 'SEWETCH', model: 'SEWMODELB', eqpId: 'SEWT_ETCH_B01', line: 'SEWLINE1' }, 'DISABLED'],
      [A01, 'RUN_BAD_CATEGORY'],
      [{ process: 'SEWCVD', model: 'SEWMODELB', eqpId: 'SEWT_CVD_B01', line: 'SEWLINE1' }, 'DUP_PROPERTY']
    ]
    for (const [target, name] of cases) expect(classifyAction(await send(target, name, PARAMS))).toEqual({ outcome: 'accepted' })
    await fake.idle()
    expect(fake.errors).toEqual([])
    const docs = await repo.findRecoveries({ eqpIds: ['SEWT_ETCH_B01', 'SEWT_CVD_A01', 'SEWT_CVD_B01'], from, to: Date.now() + 600_000 })
    expect(docs.filter((d) => ['DISABLED', 'RUN_BAD_CATEGORY', 'DUP_PROPERTY'].includes(d.ears_code))).toEqual([])
  })
})

describe('운영 속성·설비의 지금 값', () => {
  it('RUN_PROPS 를 CommandServer 규칙으로 읽는다 — InterfaceServer 가 저장한 형 그대로', async () => {
    const docs = await repo.findRunPropertyDocs({ process: 'SEWCVD', model: 'SEWMODELA', name: 'RUN_PROPS' })
    expect(docs).toHaveLength(1)
    expect(isInt64(docs[0].scCategory)).toBe(true)
    expect(readRunProperty(docs[0].property)).toEqual({
      isEnabled: true, startDelay: 30, retryCnt: 2, retryInterval: 10, priority: 5,
      next: { success: 'ALL_ACTIONS', fail: 'ALL_CONDITIONS' }, emailSkip: { success: true, stop: true, fail: false }
    })
  })
  it('유형이 Int32 인 문서·같은 키 둘·꺼진 시나리오·없는 시나리오', async () => {
    const bad = await repo.findRunPropertyDocs({ process: 'SEWCVD', model: 'SEWMODELA', name: 'RUN_BAD_CATEGORY' })
    expect(bad).toHaveLength(1)
    expect(isInt64(bad[0].scCategory)).toBe(false)
    expect(await repo.findRunPropertyDocs({ process: 'SEWCVD', model: 'SEWMODELB', name: 'DUP_PROPERTY' })).toHaveLength(2)
    const off = await repo.findRunPropertyDocs({ process: 'SEWETCH', model: 'SEWMODELB', name: 'DISABLED' })
    expect(readRunProperty(off[0].property).isEnabled).toBe(false)
    expect(await repo.findRunPropertyDocs({ process: 'SEWCVD', model: 'SEWMODELA', name: 'NO_SUCH' })).toEqual([])
  })
  it('설비 한 대의 지금 문서와 onoff', async () => {
    const off = await repo.findEquipmentFresh('SEWT_CVD_OFF')
    expect(off.eqps).toHaveLength(1)
    expect(off.agents).toHaveLength(1)
    expect(readOnoff(off.eqps[0].onoff)).toBe('off')
    expect((await repo.findEquipmentFresh('SEWT_DUP01')).agents).toHaveLength(2)
    expect(await repo.findEquipmentFresh('NO_SUCH_EQP')).toEqual({ eqps: [], agents: [] })
    const rows = await repo.findOnoff(['SEWT_CVD_A01', 'SEWT_CVD_OFF', 'NO_SUCH_EQP'])
    expect(Object.fromEntries(rows.map((r) => [r.eqpId, readOnoff(r.onoff)]))).toEqual({ SEWT_CVD_A01: 'on', SEWT_CVD_OFF: 'off' })
  })
})

describe('요청 기록(웹 전용 DB SCENARIO_EDITOR_TEST_RUNS)', () => {
  const RUN = `int-${Date.now()}`
  const base = (over = {}) => ({
    runId: RUN, eqpId: 'SEWT_CVD_A01', process: 'SEWCVD', model: 'SEWMODELA', name: 'RUN_PROPS', user: 'sew_multi', userInfo: '시험 - sew_multi', startStep: 1,
    reasonKind: 'INSPECTION', userText: 'INSPECTION', state: 'sending', detail: null, sentAt: Date.now(), doneAt: null, createdAt: new Date(), ...over
  })
  it('같은 실행에서 같은 설비는 한 번만 들어간다(유일 인덱스)', async () => {
    expect(await web.insertTestRun(base())).toEqual({ inserted: true })
    expect(await web.insertTestRun(base())).toEqual({ inserted: false })
    expect(await web.insertTestRun(base({ eqpId: 'SEWT_CVD_A02' }))).toEqual({ inserted: true })
    expect(await web.countTestRuns(RUN)).toBe(2)
  })
  it('결과로 고치고, 내 실행의 기록만 설비 ID 순으로 읽는다', async () => {
    await web.updateTestRun(RUN, 'SEWT_CVD_A01', { state: 'accepted', doneAt: Date.now() })
    const mine = await web.findTestRuns(RUN, 'sew_multi')
    expect(mine.map((r) => [r.eqpId, r.state])).toEqual([['SEWT_CVD_A01', 'accepted'], ['SEWT_CVD_A02', 'sending']])
    expect(await web.findTestRuns(RUN, 'sew_master')).toEqual([])
  })
  it('방금 요청: 보냈거나 보냈을 수 있는 기록만(실패·연결 못 함은 빼고), 시각 안의 것만, 누가 보냈든', async () => {
    await web.insertTestRun(base({ runId: `${RUN}-b`, eqpId: 'SEWT_DUP01', user: 'sew_master', state: 'failed' }))
    await web.insertTestRun(base({ runId: `${RUN}-b`, eqpId: 'SEWT_PRX01', user: 'sew_master', state: 'unknown' }))
    await web.insertTestRun(base({ runId: `${RUN}-b`, eqpId: 'SEWT_PRX02', user: 'sew_master', state: 'accepted', sentAt: Date.now() - 11 * 60_000 }))
    const key = { process: 'SEWCVD', model: 'SEWMODELA', name: 'RUN_PROPS', since: Date.now() - 10 * 60_000 }
    const recent = await web.findRecentTestRuns(key)
    expect(recent.map((r) => r.eqpId).sort()).toEqual(['SEWT_CVD_A01', 'SEWT_CVD_A02', 'SEWT_PRX01'])
    expect((await web.findRecentTestRuns({ ...key, eqpIds: ['SEWT_PRX01', 'SEWT_PRX02'] })).map((r) => [r.eqpId, r.user])).toEqual([['SEWT_PRX01', 'sew_master']])
    expect(await web.findRecentTestRuns({ ...key, name: 'ALL_ACTIONS' })).toEqual([])
  })
  it('인덱스: (runId, eqpId) 유일 · (eqpId, name, sentAt) · createdAt TTL 90일', async () => {
    const indexes = await webDb.collection('SCENARIO_EDITOR_TEST_RUNS').indexes()
    const find = (k) => indexes.find((i) => JSON.stringify(i.key) === JSON.stringify(k))
    expect(find({ runId: 1, eqpId: 1 }).unique).toBe(true)
    expect(find({ eqpId: 1, name: 1, sentAt: -1 })).toBeTruthy()
    expect(find({ createdAt: 1 }).expireAfterSeconds).toBe(90 * 24 * 3600)
  })
})

// ── API 층 ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('시험 실행 API — 실제 앱으로', () => {
  let server
  let base
  let proxy
  const before = {}
  const KEYS = ['SE_DEV_USER_OVERRIDE', 'SE_TEST_RUN', 'EARS_ACTION_TIMEOUT_MS', 'SE_TEST_RUN_MAX_EQP', 'SE_TEST_RUN_CONCURRENCY', 'SE_TEST_RUN_RECENT_MIN', 'SE_TEST_RUN_CLOCK_SKEW_SEC', 'EARS_INTERFACE_URL', 'MONGODB_URI']
  beforeAll(async () => {
    for (const k of KEYS) before[k] = process.env[k]
    process.env.SE_DEV_USER_OVERRIDE = '1'
    process.env.SE_TEST_RUN = '1'
    for (const k of ['EARS_ACTION_TIMEOUT_MS', 'SE_TEST_RUN_MAX_EQP', 'SE_TEST_RUN_CONCURRENCY', 'SE_TEST_RUN_RECENT_MIN', 'SE_TEST_RUN_CLOCK_SKEW_SEC']) delete process.env[k]
    await require('../../../../shared/db/redisConnection').connectRedis()
    const app = require('../../../../app')
    await new Promise((r) => { server = app.listen(0, '127.0.0.1', r) })
    base = `http://127.0.0.1:${server.address().port}/api/scenario-editor`
    proxy = await startFaultProxy({ target: env.EARS_INTERFACE_URL })
  })
  afterAll(async () => {
    for (const [k, v] of Object.entries(before)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
    if (proxy) await proxy.close()
    if (server) { server.closeAllConnections(); await new Promise((r) => server.close(r)) }
    await require('../../deps').getDeps().snapshotRepo.shutdown()
    await require('../../../../shared/db/redisConnection').closeRedis()
  })
  // 시험마다 깨끗한 상태에서 — 요청 기록이 남으면 "방금 요청함" 이 다음 시험을 막는다
  beforeEach(async () => {
    await fake.idle()
    await cleanupSewRecovery({ env, db: earsDb })
    await cleanupSewTestRuns({ env, webDb })
  })

  let seq = 0
  const runId = () => `int-${Date.now()}-${++seq}`
  const api = (method, path, { user = 'sew_multi', body, signal } = {}) => fetch(`${base}${path}`, {
    method, headers: { 'X-SE-User': user, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal
  })
  const answer = async (res) => ({ status: res.status, ...(await res.json()) })
  const get = async (path, user) => answer(await api('GET', path, { user }))
  const reqBody = (over = {}) => ({ runId: runId(), process: 'SEWCVD', model: 'SEWMODELA', name: 'RUN_PROPS', eqpId: 'SEWT_CVD_A01', startStep: 1, reason: { kind: 'INSPECTION' }, ...over })
  const send = async (over, user) => answer(await api('POST', '/test-run/requests', { user, body: reqBody(over) }))
  const statusOf = async (body, user) => answer(await api('POST', '/test-run/status', { user, body }))
  const records = (filter = {}) => webDb.collection('SCENARIO_EDITOR_TEST_RUNS').find({ eqpId: /^SEWT_/, ...filter }).sort({ eqpId: 1 }).toArray()
  // 중계를 거쳐 부른다 — 클라이언트는 부를 때마다 EARS_INTERFACE_URL 을 읽는다
  async function via(mode, fn) {
    const direct = process.env.EARS_INTERFACE_URL
    await proxy.setMode(mode)
    process.env.EARS_INTERFACE_URL = proxy.url
    try { return await fn() } finally {
      if (direct === undefined) delete process.env.EARS_INTERFACE_URL
      else process.env.EARS_INTERFACE_URL = direct
      await proxy.setMode('pass')
    }
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  it('문: WRITE 사용자는 쓸 수 있고(/me), 읽기만 하는 사용자·꺼 둔 서버·사용자 바꾸기 + 이 PC 밖의 EARS 는 네 API 모두 403', async () => {
    expect((await get('/me')).data.testRun).toEqual({ enabled: true, reason: null })
    expect((await get('/me', 'sew_cvd')).data.testRun).toEqual({ enabled: false, reason: 'WRITE_FORBIDDEN' })
    const all = async (user) => [
      (await get('/test-run/equipment?process=SEWCVD&model=SEWMODELA', user)).code,
      (await get('/test-run/scenario?process=SEWCVD&model=SEWMODELA&name=RUN_PROPS', user)).code,
      (await send({}, user)).code,
      (await statusOf({ runId: 'int-no-such-run' }, user)).code
    ]
    expect(await all('sew_cvd')).toEqual(Array(4).fill('WRITE_FORBIDDEN'))
    process.env.SE_TEST_RUN = '0'
    try { expect(await all('sew_multi')).toEqual(Array(4).fill('TEST_RUN_DISABLED')) } finally { process.env.SE_TEST_RUN = '1' }
    const mongoUri = process.env.MONGODB_URI
    process.env.MONGODB_URI = 'mongodb://10.1.2.3:27017/EARS' // 문만 본다 — 연결은 이미 로컬에 되어 있다
    try { expect(await all('sew_multi')).toEqual(Array(4).fill('TEST_RUN_DEV_USER')) } finally { process.env.MONGODB_URI = mongoUri }
    expect(fake.calls).toEqual([])
    expect(await records()).toEqual([])
  })

  it('설비 조회: 고른 공정·모델의 유효 설비를 설비 ID 순으로 — 자동조치 OFF 설비가 구분된다. 권한 밖 공정은 403', async () => {
    const out = await get('/test-run/equipment?process=SEWCVD&model=SEWMODELA')
    expect(out.status).toBe(200)
    expect(out.data.equipment.map((e) => [e.eqpId, e.onoff])).toEqual([
      ['SEWT_CVD_A01', 'on'], ['SEWT_CVD_A02', 'on'], ['SEWT_CVD_OFF', 'off'], ['SEWT_DUP01', 'on'], ['SEWT_PRX01', 'on'], ['SEWT_PRX02', 'on']
    ])
    expect(out.data.equipment[0]).toEqual({ eqpId: 'SEWT_CVD_A01', line: 'SEWLINE1', ipAddr: '10.99.1.1', ipAddrL: '', onoff: 'on' })
    expect(out.data.limits).toEqual({ maxEquipment: 200, recentMin: 10 })
    expect((await get('/test-run/equipment?process=SEWPHOTO&model=SEWMODELA')).code).toBe('PROCESS_FORBIDDEN')
  })

  it('시나리오 조회: 운영 속성(CommandServer 규칙)·현재 판·스텝 수, 실행할 수 없는 시나리오의 까닭', async () => {
    const run = await get('/test-run/scenario?process=SEWCVD&model=SEWMODELA&name=RUN_PROPS')
    expect(run.data).toMatchObject({
      name: 'RUN_PROPS', isEnabled: true, startDelay: 30, retryCnt: 2, retryInterval: 10, priority: 5,
      next: { success: 'ALL_ACTIONS', fail: 'ALL_CONDITIONS' }, emailSkip: { success: true, stop: true, fail: false }, blocks: [], recent: []
    })
    expect(run.data.current.stepCount).toBe(3)
    expect(run.data.current.crtime).toBeGreaterThan(0)
    const blocksOf = async (process, model, name) => (await get(`/test-run/scenario?process=${process}&model=${model}&name=${name}`)).data.blocks
    expect(await blocksOf('SEWETCH', 'SEWMODELB', 'DISABLED')).toEqual(['TEST_RUN_SCENARIO_OFF'])
    expect(await blocksOf('SEWCVD', 'SEWMODELB', 'DUP_PROPERTY')).toEqual(['TEST_RUN_PROPERTY'])
    expect(await blocksOf('SEWCVD', 'SEWMODELA', 'RUN_BAD_CATEGORY')).toEqual(['TEST_RUN_PROPERTY'])
    expect(await blocksOf('SEWCVD', 'SEWMODELB', 'NO_REDIS_FIELD')).toEqual(['TEST_RUN_NOT_DEPLOYED'])
    expect(await blocksOf('SEWCVD', 'SEWMODELA', 'NO_SUCH_SCENARIO')).toEqual(['TEST_RUN_PROPERTY', 'TEST_RUN_NOT_DEPLOYED'])
  })

  it('접수 왕복: CommandServer 가 받은 헤더·본문(@UserInfo 는 서버가, 따옴표가 든 사유 그대로), 요청 기록, 실행 상태가 바뀌는 것', async () => {
    fake.set({ record: true })
    const body = reqBody({ startStep: 2, reason: { kind: 'other', text: ' 밸브 "A" \\ 점검 ' }, '@UserInfo': '남의 이름 - other' })
    const out = await answer(await api('POST', '/test-run/requests', { body }))
    expect([out.status, out.data]).toEqual([200, { outcome: 'accepted' }])
    expect(fake.calls).toHaveLength(1)
    expect(fake.calls[0].headers).toMatchObject({ process: 'SEWCVD', model: 'SEWMODELA', eqpid: 'SEWT_CVD_A01', line: 'SEWLINE1', code: 'RUN_PROPS', triggeredBy: 'SE' })
    expect(JSON.parse(fake.calls[0].body)).toEqual({ '@UserInfo': 'SEW 여러 공정 - sew_multi', '@StartStep': '2', UserText: '밸브 "A" \\ 점검' })
    const [rec] = await records()
    expect(rec).toMatchObject({ runId: body.runId, eqpId: 'SEWT_CVD_A01', user: 'sew_multi', userInfo: 'SEW 여러 공정 - sew_multi', startStep: 2, reasonKind: 'other', userText: '밸브 "A" \\ 점검', state: 'accepted', detail: null })
    expect(rec.doneAt).toBeGreaterThanOrEqual(rec.sentAt)
    await fake.idle()
    const first = await statusOf({ runId: body.runId })
    expect(first.status).toBe(200)
    expect(first.data.items).toHaveLength(1)
    expect(first.data.items[0]).toMatchObject({ eqpId: 'SEWT_CVD_A01', outcome: 'accepted', found: 1, status: 'Wait', retry: '0/2/10' })
    const { txnSeq } = first.data.items[0]
    // 상태가 바뀐다 — 찾은 뒤에는 정확히 집는다
    expect(await fake.setStatus({ eqpid: 'SEWT_CVD_A01', status: 'Duplicated' })).toBe(1)
    expect((await statusOf({ runId: body.runId, pinned: { SEWT_CVD_A01: txnSeq } })).data.items[0]).toMatchObject({ status: 'Duplicated', txnSeq, found: 1 })
    await fake.setStatus({ eqpid: 'SEWT_CVD_A01', status: 'StartScenario' })
    expect((await statusOf({ runId: body.runId, pinned: { SEWT_CVD_A01: txnSeq } })).data.items[0].status).toBe('StartScenario')
    // 시나리오 조회에 방금 요청이 보인다
    expect((await get('/test-run/scenario?process=SEWCVD&model=SEWMODELA&name=RUN_PROPS')).data.recent).toEqual([{ eqpId: 'SEWT_CVD_A01', by: 'sew_multi', at: rec.sentAt }])
  })

  it('보내지 않는 설비: 자동조치 OFF·권한 밖·없는 설비·무효 설비·공정 모델이 다른 설비 — 요청도 기록도 없다', async () => {
    expect((await send({ eqpId: 'SEWT_CVD_OFF' })).data).toEqual({ outcome: 'off' })
    expect((await send({ eqpId: 'SEWT_PHOTO_A01' })).data).toEqual({ outcome: 'forbidden' })
    expect((await send({ eqpId: 'NO_SUCH_EQP' })).data).toEqual({ outcome: 'forbidden' })
    expect((await send({ eqpId: 'SEWT_BADMAIL' })).data).toEqual({ outcome: 'forbidden' })
    expect((await send({ eqpId: 'SEWT_CVD_B01' })).data).toEqual({ outcome: 'mismatch' })
    expect((await send({ eqpId: 'SEWT_ETCH_A01' })).data).toEqual({ outcome: 'mismatch' })
    expect(fake.calls).toEqual([])
    expect(await records()).toEqual([])
  })

  it('헤더로 보낼 수 없는 line(끝에 빈칸·한글)과, 시작 지연이 있는 시나리오에서 지연 키에 안 맞는 line 은 badValue', async () => {
    const eqp = earsDb.collection('EQP_INFO')
    try {
      await eqp.updateOne({ eqpId: 'SEWT_CVD_A02' }, { $set: { line: 'SEWLINE1 ' } })
      expect((await send({ eqpId: 'SEWT_CVD_A02', name: 'ALL_CONDITIONS' })).data).toEqual({ outcome: 'badValue', detail: 'header' })
      await eqp.updateOne({ eqpId: 'SEWT_CVD_A02' }, { $set: { line: '라인1' } })
      expect((await send({ eqpId: 'SEWT_CVD_A02', name: 'ALL_CONDITIONS' })).data).toEqual({ outcome: 'badValue', detail: 'header' })
      await eqp.updateOne({ eqpId: 'SEWT_CVD_A02' }, { $set: { line: 'SEW LINE' } })
      expect((await send({ eqpId: 'SEWT_CVD_A02', name: 'RUN_PROPS' })).data).toEqual({ outcome: 'badValue', detail: 'delayKey' })
      expect(fake.calls).toEqual([])
      // 지연·재시도가 없는 시나리오는 빈칸이 든 line 도 그대로 나간다
      expect((await send({ eqpId: 'SEWT_CVD_A02', name: 'ALL_CONDITIONS' })).data).toEqual({ outcome: 'accepted' })
      expect(fake.calls[0].headers.line).toBe('SEW LINE')
    } finally {
      await eqp.updateOne({ eqpId: 'SEWT_CVD_A02' }, { $set: { line: 'SEWLINE1' } })
    }
  })

  it('실행할 수 없는 시나리오·범위 밖 시작 스텝·틀린 입력은 요청 전체가 오류다 — 보내지 않고 적지 않는다', async () => {
    const off = await send({ process: 'SEWETCH', model: 'SEWMODELB', name: 'DISABLED', eqpId: 'SEWT_ETCH_B01' })
    expect([off.status, off.code]).toEqual([409, 'TEST_RUN_SCENARIO_OFF'])
    const dup = await send({ process: 'SEWCVD', model: 'SEWMODELB', name: 'DUP_PROPERTY', eqpId: 'SEWT_CVD_B01' })
    expect([dup.status, dup.code, dup.details]).toEqual([422, 'TEST_RUN_PROPERTY', { count: 2 }])
    const cat = await send({ name: 'RUN_BAD_CATEGORY' })
    expect([cat.status, cat.code, cat.details]).toEqual([422, 'TEST_RUN_PROPERTY', { reason: 'scCategory' }])
    const none = await send({ process: 'SEWCVD', model: 'SEWMODELB', name: 'NO_REDIS_FIELD', eqpId: 'SEWT_CVD_B01' })
    expect([none.status, none.code]).toEqual([404, 'TEST_RUN_NOT_DEPLOYED'])
    const step = await send({ startStep: 4 })
    expect([step.status, step.code, step.details]).toEqual([409, 'TEST_RUN_START_STEP', { max: 3 }])
    const bad = await send({ reason: { kind: 'other', text: 'a<b' } })
    expect([bad.status, bad.code, bad.details]).toEqual([400, 'BAD_REQUEST', { path: 'reason.text' }])
    expect((await send({ process: 'SEWPHOTO', model: 'SEWMODELA', name: 'ABC', eqpId: 'SEWT_PHOTO_A01' })).code).toBe('PROCESS_FORBIDDEN')
    expect(fake.calls).toEqual([])
    expect(await records()).toEqual([])
  })

  it('캐시 안의 변화: 목록을 본 뒤 WRITE 를 잃었거나 자동조치가 꺼졌으면 요청 때 막힌다', async () => {
    const usersCol = earsDb.collection('ARS_USER_INFO')
    const eqp = earsDb.collection('EQP_INFO')
    expect((await get('/me', 'sew_spaces')).data.testRun.enabled).toBe(true) // 사용자 캐시에 WRITE 로 들어간다
    expect((await get('/test-run/equipment?process=SEWCVD&model=SEWMODELA', 'sew_spaces')).status).toBe(200) // 설비 캐시
    try {
      await usersCol.updateOne({ singleid: 'sew_spaces' }, { $set: { authority: 'READ' } })
      const lost = await send({}, 'sew_spaces')
      expect([lost.status, lost.code]).toEqual([403, 'WRITE_FORBIDDEN'])
    } finally {
      await usersCol.updateOne({ singleid: 'sew_spaces' }, { $set: { authority: 'WRITE' } })
    }
    try {
      await eqp.updateOne({ eqpId: 'SEWT_CVD_A02' }, { $set: { onoff: 0 } })
      expect((await send({ eqpId: 'SEWT_CVD_A02' })).data).toEqual({ outcome: 'off' })
      // 설비 조회도 지금 값을 보인다(캐시의 값은 켜짐이다)
      const list = (await get('/test-run/equipment?process=SEWCVD&model=SEWMODELA')).data.equipment
      expect(list.find((e) => e.eqpId === 'SEWT_CVD_A02').onoff).toBe('off')
    } finally {
      await eqp.updateOne({ eqpId: 'SEWT_CVD_A02' }, { $set: { onoff: 1 } })
    }
    expect(fake.calls).toEqual([])
  })

  it('거듭 실행: 같은 실행의 같은 설비는 409, 10분 안의 다른 실행은 recent(누가·언제), again 이면 나간다 — 다른 사용자의 방금 요청도 본다', async () => {
    const first = reqBody()
    expect((await answer(await api('POST', '/test-run/requests', { body: first }))).data).toEqual({ outcome: 'accepted' })
    const sentAt = (await records())[0].sentAt
    const same = await answer(await api('POST', '/test-run/requests', { body: { ...first, again: true } }))
    expect([same.status, same.code]).toEqual([409, 'TEST_RUN_DUPLICATE'])
    expect((await send()).data).toEqual({ outcome: 'recent', detail: { by: 'sew_multi', at: sentAt } })
    expect((await send({}, 'sew_master')).data).toEqual({ outcome: 'recent', detail: { by: 'sew_multi', at: sentAt } })
    expect(fake.calls).toHaveLength(1)
    // 다른 설비·다른 시나리오는 막지 않는다
    expect((await send({ eqpId: 'SEWT_CVD_A02' })).data).toEqual({ outcome: 'accepted' })
    expect((await send({ name: 'ALL_CONDITIONS' })).data).toEqual({ outcome: 'accepted' })
    // 따로 고르면(again) 다시 나간다
    expect((await send({ again: true }, 'sew_master')).data).toEqual({ outcome: 'accepted' })
    expect(fake.calls).toHaveLength(4)
    // 실패·연결 못 함으로 끝난 요청은 "방금 요청" 이 아니다
    await cleanupSewTestRuns({ env, webDb })
    fake.set({ status: 500 })
    expect((await send()).data.outcome).toBe('failed')
    fake.set({ status: 200 })
    expect((await send()).data).toEqual({ outcome: 'accepted' })
  })

  it('한도: 한 실행의 요청 기록이 한도에 닿으면 409 TEST_RUN_LIMIT', async () => {
    process.env.SE_TEST_RUN_MAX_EQP = '2'
    try {
      const id = runId()
      expect((await send({ runId: id })).data.outcome).toBe('accepted')
      expect((await send({ runId: id, eqpId: 'SEWT_CVD_A02' })).data.outcome).toBe('accepted')
      const third = await send({ runId: id, eqpId: 'SEWT_DUP01' })
      expect([third.status, third.code, third.details]).toEqual([409, 'TEST_RUN_LIMIT', { max: 2 }])
      expect((await get('/test-run/equipment?process=SEWCVD&model=SEWMODELA')).data.limits.maxEquipment).toBe(2)
    } finally {
      delete process.env.SE_TEST_RUN_MAX_EQP
    }
  })

  it('응답 분류: CommandServer 500 → failed, CommandServer 없음 → unknown, InterfaceServer 연결 못 함 → down, 응답 없음·5xx → unknown', async () => {
    fake.set({ status: 500 })
    expect((await send({ eqpId: 'SEWT_CVD_A01' })).data).toEqual({ outcome: 'failed', detail: 'fake-command-server error' })
    fake.reset()
    await stopFake()
    try {
      expect((await send({ eqpId: 'SEWT_CVD_A02' })).data).toEqual({ outcome: 'unknown' })
    } finally {
      await startFake()
    }
    expect((await via('down', () => send({ eqpId: 'SEWT_DUP01' }))).data).toEqual({ outcome: 'down' })
    process.env.EARS_ACTION_TIMEOUT_MS = '1500'
    try {
      expect((await via('hang', () => send({ eqpId: 'SEWT_PRX01' }))).data).toEqual({ outcome: 'unknown' })
    } finally {
      delete process.env.EARS_ACTION_TIMEOUT_MS
    }
    // InterfaceServer 가 받은 뒤 500 이 온 경우 — 웹은 모름이지만 CommandServer 는 받았다
    expect((await via('slow500', () => send({ eqpId: 'SEWT_PRX02' }))).data).toEqual({ outcome: 'unknown' })
    expect(fake.calls.map((c) => c.headers.eqpid)).toEqual(['SEWT_PRX02'])
    expect((await records()).map((r) => [r.eqpId, r.state, r.detail])).toEqual([
      ['SEWT_CVD_A01', 'failed', 'fake-command-server error'], ['SEWT_CVD_A02', 'unknown', null], ['SEWT_DUP01', 'down', null], ['SEWT_PRX01', 'unknown', null], ['SEWT_PRX02', 'unknown', null]
    ])
  })

  it('자리: 보내는 동안 같은 사용자의 다른 요청·다른 사용자의 요청은 429 이고 아무것도 적지 않는다 — 끝난 뒤 다시 보내면 나간다', async () => {
    fake.set({ delayMs: 1500 })
    const pending = send({ eqpId: 'SEWT_CVD_A01' })
    await sleep(300)
    const mine = await send({ eqpId: 'SEWT_CVD_A02' })
    expect([mine.status, mine.code, mine.details]).toEqual([429, 'TEST_RUN_BUSY', { scope: 'user' }])
    const theirs = await send({ eqpId: 'SEWT_DUP01' }, 'sew_master')
    expect([theirs.status, theirs.code, theirs.details]).toEqual([429, 'TEST_RUN_BUSY', { scope: 'server' }])
    expect((await records()).map((r) => [r.eqpId, r.state])).toEqual([['SEWT_CVD_A01', 'sending']])
    expect((await pending).data).toEqual({ outcome: 'accepted' })
    fake.set({ delayMs: 0 })
    expect((await send({ eqpId: 'SEWT_CVD_A02' })).data).toEqual({ outcome: 'accepted' })
    expect(fake.calls.map((c) => c.headers.eqpid)).toEqual(['SEWT_CVD_A01', 'SEWT_CVD_A02'])
  })

  it('브라우저가 응답 전에 끊어도 한 번 보내고 기록이 남는다 — 실행 상태 조회가 그 결과를 되찾는다', async () => {
    fake.set({ delayMs: 1200, record: true })
    const body = reqBody()
    const ac = new AbortController()
    const pending = api('POST', '/test-run/requests', { body, signal: ac.signal }).catch((e) => e.name)
    await sleep(300)
    ac.abort()
    expect(await pending).toBe('AbortError')
    const early = await statusOf({ runId: body.runId })
    expect(early.data.items[0]).toMatchObject({ eqpId: 'SEWT_CVD_A01', outcome: 'sending', found: 0 })
    await sleep(1500)
    await fake.idle()
    expect(fake.calls).toHaveLength(1)
    const late = await statusOf({ runId: body.runId })
    expect(late.data.items[0]).toMatchObject({ outcome: 'accepted', found: 1, status: 'Wait' })
    // 끝난 뒤 자리가 풀려 있다
    fake.set({ delayMs: 0 })
    expect((await send({ eqpId: 'SEWT_CVD_A02' })).data).toEqual({ outcome: 'accepted' })
  })

  it('결과 메일 수신인: 수신 규칙이 있는 시나리오는 규칙의 묶음, 없는 시나리오는 설비의 묶음 — 주소가 등록돼 있지 않은 묶음은 까닭과 함께', async () => {
    const of = async (name, eqpIds, user) => answer(await api('POST', '/test-run/recipients', { user, body: { process: 'SEWCVD', model: 'SEWMODELA', name, eqpIds } }))
    const run = await of('RUN_PROPS', ['SEWT_CVD_A02', 'SEWT_CVD_A01', 'SEWT_DUP01'])
    expect(run.data.groups).toEqual([
      { category: 'SEW-RUN-NIGHT', source: 'rule', eqpIds: ['SEWT_CVD_A01', 'SEWT_CVD_A02', 'SEWT_DUP01'], accounts: ['sew.night@example.com', 'sew.lead@example.com'], problem: null }
    ])
    // 다른 공정의 설비(SEWT_PHOTO_A01)는 말없이 빠진다
    const plain = await of('ALL_CONDITIONS', ['SEWT_CVD_A01', 'SEWT_DUP01', 'SEWT_PHOTO_A01'])
    expect(plain.data.groups).toEqual([
      { category: 'SEW-SEWCVD-SEWMODELA-MAIL', source: 'equipment', eqpIds: ['SEWT_CVD_A01'], accounts: ['sew.day@example.com', 'sew.eng@example.com'], problem: null },
      { category: 'SEW-SEWCVD-SEWMODELA-NONE', source: 'equipment', eqpIds: ['SEWT_DUP01'], accounts: [], problem: 'INFO_MISSING' }
    ])
    expect((await of('RUN_PROPS', ['SEWT_CVD_A01'], 'sew_cvd')).code).toBe('WRITE_FORBIDDEN')
    expect((await of('RUN_PROPS', 'x')).details).toEqual({ path: 'eqpIds' })
  })

  it('실행 상태: 늦게 생기는 기록, 남의 것(데스크톱 실행·다른 사용자)·params 없는 문서는 고르지 않는다, 남의 runId 는 404', async () => {
    fake.set({ record: true, recordDelayMs: 1500 })
    const body = reqBody({ startStep: 2 })
    expect((await answer(await api('POST', '/test-run/requests', { body }))).data).toEqual({ outcome: 'accepted' })
    const sentAt = (await records())[0].sentAt
    // 같은 설비·시나리오의 남의 실행 기록 셋: 데스크톱 편집기로 실행한 것(@UserInfo 가 다름) · 시작 스텝이 다른 것 · 상태 갱신이 만든 params 없는 문서
    const { Long } = createRequire(join(ROOT, 'tools/package.json'))('mongodb')
    const other = (txn, over = {}) => ({
      process: 'SEWCVD', model: 'SEWMODELA', line: 'SEWLINE1', eqpid: 'SEWT_CVD_A01', txn_seq: Long.fromNumber(txn), status: 'Success', ears_code: 'RUN_PROPS', retry: '0/2/10', trigger_by: 'SE',
      create_date: 'x', params: { '@UserInfo': '데스크톱 사용자 - desk', '@StartStep': '2', UserText: 'INSPECTION', ALTXT: 'RUN_PROPS', ALID: 'RUN_PROPS', '@Trigger': 'SE' }, ...over
    })
    await earsDb.collection('EQP_AUTO_RECOVERY').insertMany([
      other(sentAt + 10),
      other(sentAt + 20, { params: { '@UserInfo': 'SEW 여러 공정 - sew_multi', '@StartStep': '1', UserText: 'INSPECTION' } }),
      { eqpid: 'SEWT_CVD_A01', txn_seq: Long.fromNumber(sentAt + 30), ears_code: 'RUN_PROPS', status: 'Failed' }
    ])
    const early = await statusOf({ runId: body.runId })
    expect(early.data.items[0]).toMatchObject({ outcome: 'accepted', found: 0, status: null, txnSeq: null })
    expect(early.data.now).toBeGreaterThanOrEqual(sentAt)
    await fake.idle()
    const late = await statusOf({ runId: body.runId })
    expect(late.data.items[0]).toMatchObject({ found: 1, status: 'Wait', retry: '0/2/10' })
    expect(late.data.items[0].txnSeq).toBeGreaterThan(sentAt + 30)
    // 내 실행이 아니면 404, 꼴이 틀리면 400
    const theirs = await statusOf({ runId: body.runId }, 'sew_master')
    expect([theirs.status, theirs.code]).toEqual([404, 'NOT_FOUND'])
    const bad = await statusOf({ runId: 'x' })
    expect([bad.status, bad.details]).toEqual([400, { path: 'runId' }])
  })
})

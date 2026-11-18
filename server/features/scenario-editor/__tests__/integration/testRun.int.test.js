// 시험 실행 통합 시험 (P5 설계 §10·§11) — 웹 백엔드 → 실제 InterfaceServer(/EARS/Action) → CommandServer 흉내(호스트 3195).
// 앞 묶음은 클라이언트·저장소 층(P5-A). 로컬 InterfaceServer 컨테이너(설정의 ARSCommandServerAddress = host.docker.internal:3195)와
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

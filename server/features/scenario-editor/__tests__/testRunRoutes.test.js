// 시험 실행 API (P5 설계 §5.2·§6) — 네 경로 모두 문(requireTestRun)을 지난다. 실행 요청은 브라우저가 끊어도 끝까지 간다.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { createRequire } from 'node:module'
import http from 'node:http'
const require = createRequire(import.meta.url)
const { seError } = require('../errors')

let server
let app
let base
const fake = {}
let calls
const saved = {}
beforeAll(async () => {
  for (const k of ['SE_USER_SINGLEID', 'SE_DEV_USER_OVERRIDE', 'SE_TEST_RUN', 'MONGODB_URI', 'EARS_INTERFACE_URL']) saved[k] = process.env[k]
  process.env.SE_USER_SINGLEID = 'sew_multi'
  process.env.SE_DEV_USER_OVERRIDE = '1'
  require('../deps')._setDeps(fake)
  app = require('../../../app')
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r) })
  base = `http://127.0.0.1:${server.address().port}/api/scenario-editor`
})
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
  require('../deps')._setDeps(null)
  server.closeAllConnections()
  return new Promise((r) => server.close(r))
})

const READERS = { sew_reader: { authority: 'READ', canWrite: false }, sew_twice: { duplicateUserDocs: 2 } }
beforeEach(() => {
  calls = []
  process.env.SE_TEST_RUN = '1'
  delete process.env.MONGODB_URI
  delete process.env.EARS_INTERFACE_URL
  app.locals.seWriteDisabled = false
  const note = (name, out) => async (user, ...args) => { calls.push({ name, user: user.singleid, args }); return out }
  Object.assign(fake, {
    users: { getUser: async (id) => (id === 'sew_none' ? null : { singleid: id, canWrite: true, authorityManager: 3, duplicateUserDocs: 1, ...READERS[id] }) },
    testRun: {
      equipment: note('equipment', { equipment: [{ eqpId: 'SEWT_CVD_A01', line: 'L', ipAddr: '1.1.1.1', ipAddrL: '', onoff: 'on' }], limits: { maxEquipment: 200, recentMin: 10 } }),
      scenario: note('scenario', { name: 'RUN_A', blocks: [], recent: [] }),
      request: note('request', { outcome: 'accepted' }),
      status: note('status', { now: 5, items: [] })
    }
  })
})
afterEach(() => { app.locals.seWriteDisabled = false })

const get = (path, headers = {}) => fetch(`${base}${path}`, { headers })
const post = (path, body, headers = {}) => fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
const ROUTES = [
  () => get('/test-run/equipment?process=SEWCVD&model=SEWMODELA'),
  () => get('/test-run/scenario?process=SEWCVD&model=SEWMODELA&name=RUN_A'),
  () => post('/test-run/requests', { runId: 'run-12345678' }),
  () => post('/test-run/status', { runId: 'run-12345678' })
]
const ROUTES_AS = (user) => [
  () => get('/test-run/equipment?process=SEWCVD&model=SEWMODELA', { 'X-SE-User': user }),
  () => get('/test-run/scenario?process=SEWCVD&model=SEWMODELA&name=RUN_A', { 'X-SE-User': user }),
  () => post('/test-run/requests', { runId: 'run-12345678' }, { 'X-SE-User': user }),
  () => post('/test-run/status', { runId: 'run-12345678' }, { 'X-SE-User': user })
]
async function codes(routes) {
  const out = []
  for (const r of routes) { const res = await r(); out.push([res.status, (await res.json()).code]) }
  return out
}

describe('문 — 네 API 모두', () => {
  it('WRITE 사용자·켜 둔 서버면 서비스를 부른다', async () => {
    for (const r of ROUTES) expect((await r()).status).toBe(200)
    expect(calls.map((c) => c.name)).toEqual(['equipment', 'scenario', 'request', 'status'])
  })
  it('서버에서 꺼 두었으면 403 TEST_RUN_DISABLED', async () => {
    delete process.env.SE_TEST_RUN
    expect(await codes(ROUTES)).toEqual(Array(4).fill([403, 'TEST_RUN_DISABLED']))
    expect(calls).toEqual([])
  })
  it('읽기 전용 서버(루프백이 아닌 HOST)면 403 WRITE_DISABLED', async () => {
    app.locals.seWriteDisabled = true
    expect(await codes(ROUTES)).toEqual(Array(4).fill([403, 'WRITE_DISABLED']))
  })
  it('WRITE 가 없으면 403 WRITE_FORBIDDEN — 설비·시나리오 조회도 막힌다', async () => {
    expect(await codes(ROUTES_AS('sew_reader'))).toEqual(Array(4).fill([403, 'WRITE_FORBIDDEN']))
    expect(calls).toEqual([])
  })
  it('같은 아이디의 사용자 문서가 여럿이면 403 TEST_RUN_USER_AMBIGUOUS, 미등록은 USER_NOT_REGISTERED', async () => {
    expect(await codes(ROUTES_AS('sew_twice'))).toEqual(Array(4).fill([403, 'TEST_RUN_USER_AMBIGUOUS']))
    expect(await codes(ROUTES_AS('sew_none'))).toEqual(Array(4).fill([403, 'USER_NOT_REGISTERED']))
  })
  it('사용자 바꾸기가 켜진 서버에서 EARS 가 이 PC 밖이면 403 TEST_RUN_DEV_USER', async () => {
    process.env.MONGODB_URI = 'mongodb://10.1.2.3:27017/EARS'
    expect(await codes(ROUTES)).toEqual(Array(4).fill([403, 'TEST_RUN_DEV_USER']))
    delete process.env.MONGODB_URI
    process.env.EARS_INTERFACE_URL = 'http://is.company.local:8080'
    expect(await codes(ROUTES)).toEqual(Array(4).fill([403, 'TEST_RUN_DEV_USER']))
  })
})

describe('경로와 서비스', () => {
  it('GET /test-run/equipment: 공정·모델을 넘긴다 — 없으면 400', async () => {
    const res = await get('/test-run/equipment?process=SEWCVD&model=SEWMODELA')
    expect((await res.json()).data.equipment[0].eqpId).toBe('SEWT_CVD_A01')
    expect(calls[0]).toEqual({ name: 'equipment', user: 'sew_multi', args: ['SEWCVD', 'SEWMODELA'] })
    expect((await get('/test-run/equipment?process=SEWCVD')).status).toBe(400)
  })
  it('GET /test-run/scenario: 공정·모델·이름 — 없으면 400', async () => {
    await get('/test-run/scenario?process=SEWCVD&model=SEWMODELA&name=RUN%20A')
    expect(calls[0].args).toEqual(['SEWCVD', 'SEWMODELA', 'RUN A'])
    expect((await get('/test-run/scenario?process=SEWCVD&model=SEWMODELA')).status).toBe(400)
  })
  it('POST /test-run/requests: 본문을 그대로 넘기고 { outcome } 을 준다', async () => {
    const body = { runId: 'run-12345678', process: 'SEWCVD', model: 'SEWMODELA', name: 'RUN_A', eqpId: 'SEWT_CVD_A01', startStep: 1, reason: { kind: 'INSPECTION' } }
    const res = await post('/test-run/requests', body)
    expect(await res.json()).toEqual({ success: true, data: { outcome: 'accepted' } })
    expect(calls[0]).toEqual({ name: 'request', user: 'sew_multi', args: [body] })
  })
  it('POST /test-run/status: 본문을 넘긴다', async () => {
    const res = await post('/test-run/status', { runId: 'run-12345678', pinned: { A: 1 } })
    expect((await res.json()).data).toEqual({ now: 5, items: [] })
    expect(calls[0].args).toEqual([{ runId: 'run-12345678', pinned: { A: 1 } }])
  })
  it('서비스가 던진 오류는 status·code·details 로 나간다 — 원문(upstream)은 싣지 않는다', async () => {
    fake.testRun.request = async () => { throw seError(409, 'TEST_RUN_START_STEP', '시작 스텝이 현재 버전의 스텝 수를 넘습니다', { max: 4 }) }
    const res = await post('/test-run/requests', {})
    expect([res.status, await res.json()]).toEqual([409, expect.objectContaining({ code: 'TEST_RUN_START_STEP', details: { max: 4 } })])
    fake.testRun.request = async () => { throw seError(429, 'TEST_RUN_BUSY', '다른 실행 요청을 보내고 있습니다', { scope: 'user' }) }
    const busy = await post('/test-run/requests', {})
    expect([busy.status, (await busy.json()).details]).toEqual([429, { scope: 'user' }])
    fake.testRun.status = async () => { throw Object.assign(seError(503, 'TEST_RUN_STATUS_FAILED', '실행 상태를 읽지 못했습니다'), { upstream: { text: 'mongo 10.9.8.7' } }) }
    const failed = await post('/test-run/status', {})
    const text = await failed.text()
    expect(failed.status).toBe(503)
    expect(text).not.toContain('10.9.8.7')
  })
  it('브라우저가 응답 전에 끊어도 실행 요청은 끝까지 간다 — 끝난 뒤 서버가 죽지 않는다', async () => {
    let finish
    let arrived
    const got = new Promise((r) => { arrived = r })
    let done = false
    fake.testRun.request = () => new Promise((resolve) => { finish = () => { done = true; resolve({ outcome: 'accepted' }) }; arrived() })
    const req = http.request(`${base}/test-run/requests`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, agent: false })
    req.on('error', () => {})
    req.end('{}')
    await got
    req.destroy()
    await new Promise((r) => setTimeout(r, 30))
    finish()
    await new Promise((r) => setTimeout(r, 30))
    expect(done).toBe(true)
    expect((await get('/test-run/equipment?process=SEWCVD&model=SEWMODELA')).status).toBe(200) // 서버는 살아 있다
  })
})

describe('POST /test-run/recipients (P5 설계 §5.5)', () => {
  it('문을 지나고 본문을 서비스에 넘긴다', async () => {
    const seen = []
    fake.recipients = { forEquipment: async (user, body) => { seen.push([user.singleid, body]); return { groups: [] } } }
    const body = { process: 'P', model: 'M', name: 'N', eqpIds: ['E1'] }
    const res = await post('/test-run/recipients', body)
    expect([res.status, (await res.json()).data]).toEqual([200, { groups: [] }])
    expect(seen).toEqual([['sew_multi', body]])
    const reader = await post('/test-run/recipients', body, { 'X-SE-User': 'sew_reader' })
    expect([reader.status, (await reader.json()).code]).toEqual([403, 'WRITE_FORBIDDEN'])
  })
})

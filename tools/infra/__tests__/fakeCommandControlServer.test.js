// E2E 용 CommandServer 흉내(제어 포트 판) — 흉내를 띄우고 시험이 HTTP 로 제어한다. Mongo 는 가짜로 넣는다.
import { describe, it, expect, afterEach } from 'vitest'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { Long, Int32 } = require('mongodb')
const { startCommandControlServer, parseArgs } = require('../fake-command-control-server')

const HEADERS = { process: 'SEWCVD', model: 'SEWMODELA', eqpid: 'SEWT_CVD_A01', line: 'SEWLINE1', code: 'RUN_PROPS', triggeredBy: 'SE', txn: '1' }
function fakeDb(name) {
  const calls = []
  return {
    databaseName: name, calls,
    collection: (c) => ({
      find: () => ({ limit: () => ({ toArray: async () => [{ property: { IsEnabled: true, Priority: new Int32(5) }, scCategory: Long.fromNumber(2) }] }) }),
      insertOne: async (d) => { calls.push({ c, op: 'insertOne', d }) },
      updateMany: async (filter, update) => { calls.push({ c, op: 'updateMany', filter, update }); return { modifiedCount: 1 } },
      deleteMany: async (filter) => { calls.push({ c, op: 'deleteMany', filter }); return { deletedCount: 3 } }
    })
  }
}
const LOCAL = { MONGODB_URI: 'mongodb://localhost:27017/EARS', WEBMANAGER_DB_URI: 'mongodb://localhost:27017/SE_WEB_DEV' }
const closers = []
afterEach(async () => { for (const close of closers.splice(0).reverse()) await close() })
async function start(over = {}) {
  const db = fakeDb('EARS')
  const webDb = fakeDb('SE_WEB_DEV')
  const srv = await startCommandControlServer({ port: 0, controlPort: 0, db, webDb, env: LOCAL, ...over })
  closers.push(() => srv.close())
  return { srv, db, webDb }
}
const ctl = async (srv, method, path, body) => {
  const res = await fetch(`${srv.controlUrl}${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: res.status, body: await res.json() }
}
const trigger = (srv) => fetch(`${srv.url}/EARS/Trigger`, { method: 'POST', headers: HEADERS, body: '{"@UserInfo":"a - b"}' })

describe('CommandServer 흉내 — 제어 포트 판', () => {
  it('GET /health 는 켜짐과 흉내 주소, GET /calls 는 받은 요청', async () => {
    const { srv } = await start()
    expect((await ctl(srv, 'GET', '/health')).body).toEqual({ server: 'on', url: srv.url })
    expect((await trigger(srv)).status).toBe(200)
    const calls = (await ctl(srv, 'GET', '/calls')).body
    expect(calls).toHaveLength(1)
    expect(calls[0].headers).toMatchObject({ eqpid: 'SEWT_CVD_A01', code: 'RUN_PROPS', triggeredBy: 'SE' })
  })
  it('PUT /control 로 흉내의 답을 바꾼다 — 객체가 아니면 400', async () => {
    const { srv, db } = await start()
    expect((await ctl(srv, 'PUT', '/control', { status: 500 })).status).toBe(200)
    expect((await trigger(srv)).status).toBe(500)
    await ctl(srv, 'PUT', '/control', { status: 200, record: true })
    await trigger(srv)
    await new Promise((r) => setTimeout(r, 30))
    expect(db.calls.filter((c) => c.op === 'insertOne').map((c) => c.c)).toEqual(['EQP_AUTO_RECOVERY'])
    expect((await ctl(srv, 'PUT', '/control', [1])).status).toBe(400)
  })
  it('PUT /status 로 흉내가 넣은 문서의 상태를 바꾼다', async () => {
    const { srv, db } = await start()
    await ctl(srv, 'PUT', '/control', { record: true })
    await trigger(srv)
    await new Promise((r) => setTimeout(r, 30))
    expect((await ctl(srv, 'PUT', '/status', { eqpid: 'SEWT_CVD_A01', status: 'Success' })).body).toEqual({ modified: 1 })
    expect(db.calls.find((c) => c.op === 'updateMany').update).toEqual({ $set: { status: 'Success' } })
    expect((await ctl(srv, 'PUT', '/status', { eqpid: 'SEWT_CVD_A01' })).status).toBe(400)
  })
  it('PUT /server/off 는 흉내를 내린다(CommandServer 없음) — on 은 같은 포트로 다시 띄운다', async () => {
    const { srv } = await start()
    const { port } = srv
    expect((await ctl(srv, 'PUT', '/server/off')).body).toEqual({ server: 'off', url: srv.url })
    await expect(trigger(srv)).rejects.toThrow()
    expect((await ctl(srv, 'GET', '/calls')).body).toEqual([])
    expect((await ctl(srv, 'PUT', '/server/on')).body.server).toBe('on')
    expect(srv.port).toBe(port)
    expect((await trigger(srv)).status).toBe(200)
  })
  it('POST /reset 은 제어 값·받은 요청을 비우고, 시험 설비(SEWT_)의 실행 기록·요청 기록을 지운다', async () => {
    const { srv, db, webDb } = await start()
    await ctl(srv, 'PUT', '/control', { status: 500 })
    await trigger(srv)
    expect((await ctl(srv, 'POST', '/reset')).body).toEqual({ ok: true, recoveries: 3, testRuns: 3 })
    expect((await trigger(srv)).status).toBe(200)
    expect((await ctl(srv, 'GET', '/calls')).body).toHaveLength(1)
    expect(db.calls.find((c) => c.op === 'deleteMany')).toMatchObject({ c: 'EQP_AUTO_RECOVERY', filter: { eqpid: /^SEWT_/ } })
    expect(webDb.calls.find((c) => c.op === 'deleteMany')).toMatchObject({ c: 'SCENARIO_EDITOR_TEST_RUNS', filter: { eqpId: /^SEWT_/ } })
  })
  it('GET /left 는 남은 시험 흔적의 수(가짜 DB 에는 세는 함수가 없어 0)', async () => {
    const { srv } = await start()
    expect((await ctl(srv, 'GET', '/left')).status).toBe(200)
  })
  it('모르는 경로는 404, 명령 줄은 --control <포트>', async () => {
    const { srv } = await start()
    expect((await ctl(srv, 'GET', '/nope')).status).toBe(404)
    expect(parseArgs(['--control', '3194'])).toEqual({ controlPort: 3194 })
    expect(() => parseArgs(['--control', 'x'])).toThrow()
  })
})

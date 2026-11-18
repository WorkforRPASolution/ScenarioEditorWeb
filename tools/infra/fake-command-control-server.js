'use strict'
// E2E 용 CommandServer 흉내(P5-C) — fake-command-server.js 를 따로 띄우고 제어 포트로 다룬다. client/playwright.config.js 가 webServer 로 띄운다.
// 흉내는 3195(로컬 InterfaceServer 설정의 ARSCommandServerAddress), 제어는 127.0.0.1 의 --control 포트. 통합 시험과 동시에 돌리지 않는다(둘 다 3195).
//   node tools/infra/fake-command-control-server.js --control 3194
// 제어:
//   GET  /health            → { server: 'on'|'off', url }
//   GET  /calls             → 흉내가 받은 요청 [{ headers, body, at }]
//   PUT  /control           → 본문 JSON { delayMs, status, record, recordDelayMs } 의 일부 — 흉내의 답을 바꾼다
//   PUT  /status            → 본문 { eqpid, code?, status, retry? } — 흉내가 넣은 실행 기록의 상태를 바꾼다 → { modified }
//   PUT  /server/off·on     → 흉내를 내렸다 올린다("CommandServer 없음" — InterfaceServer 가 Fail + "null" 을 준다)
//   POST /reset             → 제어 값·받은 요청을 비우고 시험 설비(SEWT_)의 실행 기록·요청 기록을 지운다 → { ok, recoveries, testRuns }
//   GET  /left              → 남은 시험 흔적의 수 { recoveries, testRuns }
// 실행 기록은 로컬 EARS 의 EQP_AUTO_RECOVERY(SEWT_ 설비만), 요청 기록은 웹 전용 DB(SE_WEB_DEV) — 주소가 루프백이 아니면 뜨지 않는다.
const http = require('node:http')
const { startFakeCommandServer, PORT } = require('./fake-command-server')
const { cleanupSewRecovery, cleanupSewTestRuns, assertLocalTargets, WEB_DB } = require('./sew-w-cleanup')

const MAX_BODY = 1024 * 1024
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy() } else chunks.push(c) })
    req.on('end', () => resolve(Buffer.concat(chunks).toString()))
    req.on('error', reject)
  })
}
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

async function startCommandControlServer({ host = '127.0.0.1', port = PORT, controlPort = 0, db, webDb, env }) {
  assertLocalTargets(env)
  let fake = await startFakeCommandServer({ host, port, db })
  const fixedPort = fake.port // 내렸다 올려도 같은 포트(InterfaceServer 설정에 적힌 주소)
  const url = fake.url
  const reply = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=UTF-8' })
    res.end(JSON.stringify(body))
  }
  const json = async (req) => { try { return JSON.parse(await readBody(req)) } catch { return null } }
  async function route(req, res) {
    const key = `${req.method} ${req.url}`
    if (key === 'GET /health') return reply(res, 200, { server: fake ? 'on' : 'off', url })
    if (key === 'GET /calls') return reply(res, 200, fake ? fake.calls : [])
    if (key === 'PUT /control') {
      const partial = await json(req)
      if (!isObj(partial)) return reply(res, 400, { error: 'control must be a JSON object' })
      if (fake) fake.set(partial)
      return reply(res, 200, { ok: true })
    }
    if (key === 'PUT /status') {
      const b = await json(req)
      if (!isObj(b) || typeof b.eqpid !== 'string' || typeof b.status !== 'string') return reply(res, 400, { error: 'eqpid and status are required' })
      return reply(res, 200, { modified: fake ? await fake.setStatus(b) : 0 })
    }
    if (key === 'PUT /server/off') {
      if (fake) { await fake.idle(); await fake.close(); fake = null }
      return reply(res, 200, { server: 'off', url })
    }
    if (key === 'PUT /server/on') {
      if (!fake) fake = await startFakeCommandServer({ host, port: fixedPort, db })
      return reply(res, 200, { server: 'on', url })
    }
    if (key === 'POST /reset') {
      if (fake) { await fake.idle(); fake.reset() }
      return reply(res, 200, { ok: true, recoveries: await cleanupSewRecovery({ env, db }), testRuns: await cleanupSewTestRuns({ env, webDb }) })
    }
    if (key === 'GET /left') {
      const count = async (d, c, f) => (typeof d.collection(c).countDocuments === 'function' ? d.collection(c).countDocuments(f) : 0)
      return reply(res, 200, { recoveries: await count(db, 'EQP_AUTO_RECOVERY', { eqpid: /^SEWT_/ }), testRuns: await count(webDb, 'SCENARIO_EDITOR_TEST_RUNS', { eqpId: /^SEWT_/ }) })
    }
    req.resume()
    return reply(res, 404, { error: 'not found' })
  }
  const control = http.createServer((req, res) => {
    route(req, res).catch((e) => { if (!res.headersSent) reply(res, 500, { error: e.message }); else res.destroy() })
  })
  try {
    await new Promise((resolve, reject) => { control.once('error', reject); control.listen(controlPort, host, () => { control.off('error', reject); resolve() }) })
  } catch (e) {
    await fake.close().catch(() => {})
    throw e
  }
  return {
    port: fixedPort,
    url,
    controlUrl: `http://${host}:${control.address().port}`,
    async close() {
      try { if (fake) { await fake.idle(); await fake.close() } } finally {
        await new Promise((resolve) => { control.close(() => resolve()); control.closeAllConnections?.() })
      }
    }
  }
}

function parseArgs(argv) {
  const i = argv.indexOf('--control')
  const v = i >= 0 ? argv[i + 1] : undefined
  if (!/^\d+$/.test(v ?? '')) throw new Error(`--control <포트> 는 숫자여야 한다: ${v}`)
  return { controlPort: Number(v) }
}

if (require.main === module) {
  (async () => {
    const opts = parseArgs(process.argv.slice(2))
    const path = require('node:path')
    const { existsSync, readFileSync } = require('node:fs')
    const { createRequire } = require('node:module')
    // 서버가 읽는 것과 같은 파일(server/.env) — 연결 주소가 이 PC 밖이면 뜨지 않는다
    const envPath = path.join(__dirname, '../../server/.env')
    const parsed = existsSync(envPath) ? createRequire(path.join(__dirname, '../../server/package.json'))('dotenv').parse(readFileSync(envPath)) : {}
    const env = { MONGODB_URI: parsed.MONGODB_URI || 'mongodb://localhost:27017/EARS', WEBMANAGER_DB_URI: parsed.WEBMANAGER_DB_URI || '' }
    assertLocalTargets(env)
    if (!env.WEBMANAGER_DB_URI) throw new Error(`server/.env 에 WEBMANAGER_DB_URI(${WEB_DB})가 없다`)
    const { MongoClient } = require('mongodb')
    const mongo = new MongoClient(env.MONGODB_URI)
    await mongo.connect()
    const web = new MongoClient(env.WEBMANAGER_DB_URI)
    await web.connect()
    const webDb = web.db()
    if (webDb.databaseName !== WEB_DB) throw new Error(`웹 전용 DB 가 ${WEB_DB} 가 아니다: ${webDb.databaseName}`)
    const srv = await startCommandControlServer({ controlPort: opts.controlPort, db: mongo.db(), webDb, env })
    console.log(`fake-command-server ${srv.url} (제어 ${srv.controlUrl})`)
    let stopping = false
    const stop = () => {
      if (stopping) return
      stopping = true
      srv.close().then(() => Promise.all([mongo.close(), web.close()])).then(() => process.exit(0), () => process.exit(1))
    }
    process.on('SIGTERM', stop)
    process.on('SIGINT', stop)
  })().catch((e) => { console.error(`CommandServer 흉내를 띄우지 못했다: ${e.message}`); process.exit(1) })
}

module.exports = { startCommandControlServer, parseArgs }

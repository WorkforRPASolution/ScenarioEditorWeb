'use strict'
// CommandServer 흉내(P5 설계 §10.1) — 로컬 InterfaceServer 의 ARSCommandServerAddress 자리에 선다(infra/is/conf/EARSInterfaceSrv.json 의 host.docker.internal:3195).
// POST /EARS/Trigger 를 받아 적고 실제처럼 바로 `ok` 를 답한다. record 를 켜면 실제 CommandServer(JobActor.SaveAutoRecovery)의 규칙대로
// EARS.EQP_AUTO_RECOVERY 에 문서를 넣는다 — 운영 속성 문서가 1건이 아니거나 꺼져 있으면 실제처럼 말없이 넣지 않는다.
// 에이전트는 없다: 상태는 Wait 로 남고, 시험이 setStatus 로 바꾼다.
// 안전 장치: 127.0.0.1 에만 열고, 시험 설비(SEWT_)의 문서만 넣는다. 넣은 문서는 시험이 sew-w-cleanup.js 의 cleanupSewRecovery 로 지운다.
//   node tools/infra/fake-command-server.js [--record]     (로컬에서 화면을 써 볼 때 — 3195 에 띄운다. --record 는 로컬 Mongo 에 실행 기록을 넣는다)
// 제어: set({ delayMs, status, record, recordDelayMs }) · setStatus({ eqpid, code?, status, retry? }) · calls · reset() · idle()
const http = require('node:http')
const { Long, Int32 } = require('mongodb')
const { readRunProperty, isInt64 } = require('../../server/features/scenario-editor/domain/testRun')

const PORT = 3195
const EQP_PREFIX = 'SEWT_'
const MAX_BODY = 1024 * 1024
// 실제 CommandServer 가 요구하는 헤더(HttpWorker.scala — 없으면 failWith → 500). node 는 헤더 이름을 소문자로 준다.
const REQUIRED = ['process', 'model', 'eqpid', 'line', 'code', 'triggeredby']
const DEFAULTS = { delayMs: 0, status: 200, record: false, recordDelayMs: 0 }

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const pad = (n, w = 2) => String(n).padStart(w, '0')

// joda ISODateTimeFormat.dateTime() 꼴 — 이 PC 시간대의 offset 을 붙인다
function isoWithOffset(ms) {
  const d = new Date(ms)
  const off = -d.getTimezoneOffset()
  const sign = off < 0 ? '-' : '+'
  const abs = Math.abs(off)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}

// 등록할 문서, 등록하지 않으면 null. docs = SC_PROPERTY {process, eqpModel, scname} 문서들(promoteValues: false 로 읽은 것).
// 실제와 같은 조건: 본문이 JSON 객체(값은 글자 — Map[String,String]) · 문서가 정확히 1건 · property 있음 · scCategory Int64 · IsEnabled(CommandServer 규칙).
function recoveryDocOf({ headers, body, docs, now }) {
  if (typeof headers.eqpid !== 'string' || !headers.eqpid.startsWith(EQP_PREFIX)) return null
  let params = null
  try { params = JSON.parse(body) } catch { return null }
  if (!isObj(params) || Object.values(params).some((v) => typeof v !== 'string')) return null
  if (!Array.isArray(docs) || docs.length !== 1 || !isObj(docs[0].property) || !isInt64(docs[0].scCategory)) return null
  const p = readRunProperty(docs[0].property)
  if (!p.isEnabled) return null
  const code = headers.code
  return {
    process: headers.process, model: headers.model, line: headers.line, eqpid: headers.eqpid, txn_seq: Long.fromNumber(now), status: 'Wait', ears_code: code,
    retry: `0/${p.retryCnt}/${p.retryInterval}`, trigger_by: headers.triggeredBy, create_date: isoWithOffset(now),
    params: { ...params, ALTXT: code, ALID: code, '@Trigger': headers.triggeredBy, __priority__: new Int32(p.priority) }
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy() } else chunks.push(c) })
    req.on('end', () => resolve(Buffer.concat(chunks).toString()))
    req.on('error', reject)
  })
}

async function startFakeCommandServer({ host = '127.0.0.1', port = PORT, db = null, now = Date.now } = {}) {
  const calls = []
  const errors = []
  const inserted = [] // 흉내가 넣은 문서의 키 — setStatus 는 이것만 고친다
  const pending = new Set()
  let control = { ...DEFAULTS }
  let lastTxn = 0

  async function record(headers, body) {
    if (control.recordDelayMs > 0) await sleep(control.recordDelayMs)
    const docs = await db.collection('SC_PROPERTY')
      .find({ process: headers.process, eqpModel: headers.model, scname: headers.code }, { promoteValues: false, projection: { _id: 0, property: 1, scCategory: 1 } })
      .limit(3).toArray()
    // CommandServer 는 받은 txn 을 버리고 제 시계를 쓴다. 같은 ms 에 겹치지 않게 하나씩 올린다((eqpid, txn_seq) 유일 인덱스)
    lastTxn = Math.max(now(), lastTxn + 1)
    const doc = recoveryDocOf({ headers, body, docs, now: lastTxn })
    if (!doc) return
    await db.collection('EQP_AUTO_RECOVERY').insertOne(doc)
    inserted.push({ eqpid: doc.eqpid, txn_seq: doc.txn_seq, ears_code: doc.ears_code })
  }

  const server = http.createServer(async (req, res) => {
    const reply = (status, text) => { res.writeHead(status, { 'Content-Type': 'text/plain; charset=UTF-8' }); res.end(text) }
    try {
      if (req.method !== 'POST' || req.url !== '/EARS/Trigger') { req.resume(); return reply(404, 'not found') }
      const body = await readBody(req)
      const h = req.headers
      if (REQUIRED.some((k) => typeof h[k] !== 'string')) return reply(500, 'There was an internal server error.')
      const headers = { process: h.process, model: h.model, eqpid: h.eqpid, line: h.line, code: h.code, triggeredBy: h.triggeredby, txn: h.txn ?? '', issue_comment: h.issue_comment ?? '' }
      calls.push({ headers, body, at: now() })
      const { delayMs, status } = control
      if (delayMs > 0) await sleep(delayMs)
      if (status !== 200) return reply(status, 'fake-command-server error')
      reply(200, 'ok')
      // 실제처럼 답을 먼저 하고 등록은 그 뒤에 — 실패는 로그(errors)뿐이다
      if (control.record && db) {
        const job = record(headers, body).catch((e) => errors.push(e))
        pending.add(job)
        job.finally(() => pending.delete(job))
      }
      return undefined
    } catch (e) {
      errors.push(e)
      if (!res.headersSent) reply(500, 'fake-command-server failure')
      else res.destroy()
      return undefined
    }
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => { server.off('error', reject); resolve() })
  })

  return {
    host,
    port: server.address().port,
    url: `http://${host}:${server.address().port}`,
    calls,
    errors,
    set(partial) { control = { ...control, ...partial } },
    reset() { control = { ...DEFAULTS }; calls.length = 0; errors.length = 0 },
    // 진행 중인 등록이 끝날 때까지
    async idle() { while (pending.size) await Promise.all([...pending]) },
    // 흉내가 넣은 문서 가운데 그 설비(·시나리오)의 상태를 바꾼다 → 고친 수
    async setStatus({ eqpid, code, status, retry }) {
      const keys = inserted.filter((k) => k.eqpid === eqpid && (code === undefined || k.ears_code === code))
      if (!keys.length || !db) return 0
      const r = await db.collection('EQP_AUTO_RECOVERY').updateMany({ $or: keys }, { $set: { status, ...(retry === undefined ? {} : { retry }) } })
      return r.modifiedCount
    },
    async close() {
      await new Promise((resolve) => { server.close(() => resolve()); server.closeAllConnections?.() })
    }
  }
}

if (require.main === module) {
  (async () => {
    let mongo = null
    let db = null
    if (process.argv.includes('--record')) {
      const { MongoClient } = require('mongodb')
      const env = require('../seed/lib/env')
      require('./sew-w-cleanup').assertLocalTargets({ MONGODB_URI: env.MONGODB_URI })
      mongo = new MongoClient(env.MONGODB_URI)
      await mongo.connect()
      db = mongo.db()
    }
    const srv = await startFakeCommandServer({ db })
    if (db) srv.set({ record: true })
    console.log(`fake-command-server ${srv.url}${db ? ' (실행 기록을 로컬 EQP_AUTO_RECOVERY 에 넣는다 — SEWT_ 설비만)' : ''}`)
    const stop = () => { srv.close().then(() => (mongo ? mongo.close() : null)).then(() => process.exit(0), () => process.exit(1)) }
    process.on('SIGTERM', stop)
    process.on('SIGINT', stop)
  })().catch((e) => { console.error(`CommandServer 흉내를 띄우지 못했다: ${e.message}`); process.exit(1) })
}

module.exports = { startFakeCommandServer, recoveryDocOf, isoWithOffset, PORT }

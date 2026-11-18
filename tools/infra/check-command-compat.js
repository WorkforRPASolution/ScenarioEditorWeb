'use strict'
// 실제 CommandServer 맞춤 확인(P5 설계 §10.3, 완료 조건 10) — 자동 시험은 CommandServer 흉내를 쓰므로, 흉내와 웹이 가정한 것이 실제와 같은지 한 번 본다.
// 길: 웹 API → InterfaceServer(/EARS/Action) → 실제 CommandServer(/EARS/Trigger) → 로컬 Mongo EARS.EQP_AUTO_RECOVERY. 에이전트는 없다(Wait·NotStarted 까지).
// 준비(흉내·통합 시험·E2E 를 돌리지 않는 동안 — 모두 3195 를 쓴다):
//   tools/infra/prepare-cs.sh
//   docker compose -f infra/docker-compose.yml --profile cs up -d cs-redis command-server      (실제 CommandServer 127.0.0.1:3195, 전용 Redis 127.0.0.1:16399)
//   npm run seed -- reset basic anomaly
//   SE_DEV_USER_OVERRIDE=1 SE_TEST_RUN=1 npm --prefix server start                              (웹 서버 3100)
//   node tools/infra/check-command-compat.js
//   docker compose -f infra/docker-compose.yml --profile cs rm -sf cs-redis command-server      (끝나면 내린다)
// 보는 것: ① 웹으로 요청한 실행의 문서를 웹의 상태 조회가 찾는다 · 문서의 필드·형이 흉내(recoveryDocOf)가 만드는 것과 같다
//          ② 시작 지연이 있는 시나리오: Wait · retry · 우선순위가 웹이 읽은 운영 속성과 같고 지연 키가 걸린다
//          ③ 꺼진 시나리오 · 같은 키 문서 둘 · 유형이 Int32 인 시나리오는 CommandServer 가 받고도 문서를 만들지 않는다(웹은 요청 전에 막는다)
//          ④ 지연 키 규칙에 맞지 않는 값(빈칸이 든 line)은 문서는 생기지만 지연 키가 걸리지 않는다(웹은 badValue 로 막는다)
// 시험 설비(SEWT_)만 쓰고, 끝나면 넣은 실행 기록·요청 기록을 지운다. CommandServer 저장소는 고치지 않는다.
const path = require('node:path')
const { readFileSync, existsSync } = require('node:fs')
const { createRequire } = require('node:module')
const { MongoClient } = require('mongodb')
const Redis = require('ioredis')
const { recoveryDocOf } = require('./fake-command-server')
const { cleanupSewRecovery, cleanupSewTestRuns, assertLocalTargets } = require('./sew-w-cleanup')
const { buildParams, readRunProperty } = require('../../server/features/scenario-editor/domain/testRun')
const { createActionClient } = require('../../server/features/scenario-editor/clients/actionClient')

const ROOT = path.join(__dirname, '../..')
const envPath = path.join(ROOT, 'server/.env')
const parsed = existsSync(envPath) ? createRequire(path.join(ROOT, 'server/package.json'))('dotenv').parse(readFileSync(envPath)) : {}
const env = { MONGODB_URI: parsed.MONGODB_URI || 'mongodb://localhost:27017/EARS', WEBMANAGER_DB_URI: parsed.WEBMANAGER_DB_URI || '', EARS_INTERFACE_URL: parsed.EARS_INTERFACE_URL || 'http://localhost:8080' }
const API = process.env.SE_API || 'http://127.0.0.1:3100/api/scenario-editor'
const USER = 'sew_multi'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`) }
const post = async (p, body) => {
  const res = await fetch(`${API}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-SE-User': USER }, body: JSON.stringify(body) })
  return { status: res.status, ...(await res.json()) }
}
const runId = () => `compat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
async function found(id, eqpId, ms = 15000) {
  const end = Date.now() + ms
  for (;;) {
    const s = await post('/test-run/status', { runId: id })
    const item = s.data?.items?.find((x) => x.eqpId === eqpId)
    if (item?.found) return item
    if (Date.now() > end) return item ?? null
    await sleep(500)
  }
}

async function main() {
  assertLocalTargets(env)
  const mongo = new MongoClient(env.MONGODB_URI)
  await mongo.connect()
  const web = new MongoClient(env.WEBMANAGER_DB_URI)
  await web.connect()
  const redis = new Redis({ host: '127.0.0.1', port: 16399, password: 'visuallove', db: 7, lazyConnect: true, maxRetriesPerRequest: 1 })
  const db = mongo.db()
  const webDb = web.db()
  const recovery = db.collection('EQP_AUTO_RECOVERY')
  // 실행 기록·요청 기록과, 전용 Redis 에 남은 시험 설비의 지연 키(앞 실행이 30초 안에 남긴 것 — 지우는 것은 만료 알림을 내지 않는다)
  const clean = async () => {
    await cleanupSewRecovery({ env, db })
    await cleanupSewTestRuns({ env, webDb })
    const keys = await redis.keys('deferred@*@SEWT_*')
    if (keys.length) await redis.del(...keys)
  }
  const action = createActionClient({ env })
  // 웹을 거치지 않고 InterfaceServer 에 바로(웹이 막는 요청을 CommandServer 가 어떻게 다루는지 본다)
  const direct = async ({ process, model, eqpId, name, line = 'SEWLINE1' }) => {
    const got = await action.send({ process, model, eqpId, name, line, txn: Date.now(), body: buildParams({ userInfo: 'compat - compat', startStep: 1, userText: 'INSPECTION' }) })
    return got.kind === 'response' ? got.text : got.kind
  }
  try {
    await redis.connect()
    await clean()

    // ① 웹으로 요청 → 상태 조회가 찾는다 → 문서가 흉내와 같은 모양이다
    const reason = '밸브 "A" \\ 점검'
    const a = runId()
    const sent = await post('/test-run/requests', { runId: a, process: 'SEWCVD', model: 'SEWMODELA', name: 'ALL_CONDITIONS', eqpId: 'SEWT_CVD_A01', startStep: 2, reason: { kind: 'other', text: reason } })
    check('① 웹 요청이 접수된다', sent.data?.outcome === 'accepted', JSON.stringify(sent.data ?? sent.code))
    const ia = await found(a, 'SEWT_CVD_A01')
    check('① 웹의 상태 조회가 실제 문서를 찾는다', !!ia?.found && ['Wait', 'NotStarted', 'StartPending'].includes(ia?.status), `status=${ia?.status} retry=${ia?.retry} found=${ia?.found}`)
    const raw = await recovery.findOne({ eqpid: 'SEWT_CVD_A01', ears_code: 'ALL_CONDITIONS' }, { promoteValues: false, projection: { _id: 0 } })
    if (raw) {
      const txn = raw.txn_seq.toNumber()
      const docs = await db.collection('SC_PROPERTY').find({ process: 'SEWCVD', eqpModel: 'SEWMODELA', scname: 'ALL_CONDITIONS' }, { promoteValues: false, projection: { _id: 0, property: 1, scCategory: 1 } }).toArray()
      const fake = recoveryDocOf({
        headers: { process: 'SEWCVD', model: 'SEWMODELA', line: 'SEWLINE1', eqpid: 'SEWT_CVD_A01', code: 'ALL_CONDITIONS', triggeredBy: 'SE' },
        body: buildParams({ userInfo: 'SEW 여러 공정 - sew_multi', startStep: 2, userText: reason }), docs, now: txn
      })
      const shape = (d) => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v && v._bsontype ? `${v._bsontype}:${v}` : v && typeof v === 'object' ? shape(v) : v]))
      const real = shape({ ...raw, status: 'Wait' }) // 상태는 그 사이 바뀔 수 있다(NotStarted 등)
      const want = shape(fake)
      check('① 필드 이름이 흉내와 같다', JSON.stringify(Object.keys(real).sort()) === JSON.stringify(Object.keys(want).sort()) && JSON.stringify(Object.keys(real.params).sort()) === JSON.stringify(Object.keys(want.params).sort()),
        `real=${Object.keys(real).sort()} params=${Object.keys(real.params).sort()}`)
      const { create_date: rc, ...realRest } = real
      const { create_date: wc, ...wantRest } = want
      // 키 순서는 견주지 않는다(실제는 Scala Map 의 순서다 — 웹은 키로 읽는다)
      const sorted = (v) => (v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v)
      check('① 값과 형이 흉내와 같다(등록 시각 글자 빼고, 키 순서 무관)', JSON.stringify(sorted(realRest)) === JSON.stringify(sorted(wantRest)),
        `real=${JSON.stringify(sorted(realRest))} want=${JSON.stringify(sorted(wantRest))}`)
      check('① create_date 는 txn_seq 의 ISO 글자(offset 포함)', typeof rc === 'string' && Date.parse(rc) === txn && /[+-]\d{2}:\d{2}$/.test(rc), `${rc} · 흉내 ${wc}`)
      check('① 따옴표·역슬래시가 든 사유가 그대로 등록된다', raw.params.UserText === reason, raw.params.UserText)
    } else check('① 실제 문서가 있다', false)

    // ② 시작 지연이 있는 시나리오
    const b = runId()
    const sentB = await post('/test-run/requests', { runId: b, process: 'SEWCVD', model: 'SEWMODELA', name: 'RUN_PROPS', eqpId: 'SEWT_CVD_A02', startStep: 1, reason: { kind: 'INSPECTION' } })
    check('② 시작 지연 시나리오가 접수된다', sentB.data?.outcome === 'accepted', JSON.stringify(sentB.data ?? sentB.code))
    const ib = await found(b, 'SEWT_CVD_A02')
    const info = (await (await fetch(`${API}/test-run/scenario?process=SEWCVD&model=SEWMODELA&name=RUN_PROPS`, { headers: { 'X-SE-User': USER } })).json()).data
    check('② 상태 Wait · retry 가 웹이 읽은 운영 속성과 같다', ib?.status === 'Wait' && ib?.retry === `0/${info.retryCnt}/${info.retryInterval}`, `status=${ib?.status} retry=${ib?.retry} 웹=${info.retryCnt}/${info.retryInterval}`)
    const rawB = await recovery.findOne({ eqpid: 'SEWT_CVD_A02', ears_code: 'RUN_PROPS' }, { promoteValues: false })
    check('② 우선순위(__priority__)가 웹이 읽은 값과 같다', rawB?.params?.__priority__?.value === info.priority, `실제 ${rawB?.params?.__priority__?.value} 웹 ${info.priority}`)
    const keysB = await redis.keys('deferred@*SEWT_CVD_A02*')
    const txnB = rawB ? rawB.txn_seq.toNumber() : 0
    check('② 지연 키가 걸린다(시작 지연 초)', keysB.length === 1 && keysB[0] === `deferred@SEWCVD@SEWMODELA@SEWT_CVD_A02@SEWLINE1@${txnB}@${txnB + info.startDelay * 1000}@RUN_PROPS`, keysB.join(' '))

    // ③ 웹이 막는 시나리오를 CommandServer 에 바로 — 받고도 문서를 만들지 않는다
    const blocked = [
      ['꺼진 시나리오', { process: 'SEWETCH', model: 'SEWMODELB', eqpId: 'SEWT_ETCH_B01', name: 'DISABLED' }],
      ['같은 키 문서 둘', { process: 'SEWCVD', model: 'SEWMODELB', eqpId: 'SEWT_CVD_B01', name: 'DUP_PROPERTY' }],
      ['유형이 Int32', { process: 'SEWCVD', model: 'SEWMODELA', eqpId: 'SEWT_PRX01', name: 'RUN_BAD_CATEGORY' }]
    ]
    const answers = []
    for (const [, t] of blocked) answers.push(await direct(t))
    await sleep(3000)
    for (const [i, [label, t]] of blocked.entries()) {
      const n = await recovery.countDocuments({ eqpid: t.eqpId, ears_code: t.name })
      check(`③ ${label}: 받지만(Success) 문서를 만들지 않는다`, /"Success"/.test(answers[i]) && n === 0, `응답 ${answers[i]} 문서 ${n}`)
    }
    // 웹의 운영 속성 읽기가 꺼진 시나리오를 꺼짐으로 읽는다(CommandServer 와 같은 판단)
    const offDocs = await db.collection('SC_PROPERTY').find({ process: 'SEWETCH', eqpModel: 'SEWMODELB', scname: 'DISABLED' }, { promoteValues: false }).toArray()
    check('③ 웹도 꺼진 시나리오로 읽는다', offDocs.length === 1 && readRunProperty(offDocs[0].property).isEnabled === false)

    // ④ 지연 키 규칙에 맞지 않는 값
    const spaced = await direct({ process: 'SEWCVD', model: 'SEWMODELA', eqpId: 'SEWT_PRX02', name: 'RUN_PROPS', line: 'SEW LINE' })
    await sleep(2000)
    const docD = await recovery.findOne({ eqpid: 'SEWT_PRX02', ears_code: 'RUN_PROPS' })
    const keysD = await redis.keys('deferred@*SEWT_PRX02*')
    check('④ 빈칸이 든 line: 문서는 Wait 로 생긴다', /"Success"/.test(spaced) && docD?.status === 'Wait', `응답 ${spaced} status=${docD?.status}`)
    // 키는 만들어지지만(SETEX) 만료 알림을 받는 쪽의 정규식에 맞지 않아 버려진다 — 여기서는 키의 꼴이 정규식 밖임을 본다
    const RE = /^deferred@([a-zA-Z_\-0-9.]+)@([a-zA-Z_\-0-9.]+)@([a-zA-Z_\-0-9.]+)@([a-zA-Z_\-0-9.]+)@([0-9]+)@([0-9]+)@([a-zA-Z_\-0-9.]+)$/
    check('④ 그 지연 키는 CommandServer 의 정규식에 맞지 않는다(만료돼도 시작되지 않는다 — DC-012)', keysD.length === 1 && !RE.test(keysD[0]) && RE.test(keysB[0] ?? ''), keysD.join(' '))
  } finally {
    await clean().catch((e) => console.error(`정리 실패: ${e.message}`))
    const left = await recovery.countDocuments({ eqpid: /^SEWT_/ }).catch(() => -1)
    check('끝난 뒤 SEWT_ 실행 기록이 남지 않는다', left === 0, String(left))
    redis.disconnect()
    await mongo.close()
    await web.close()
  }
  const failed = results.filter((ok) => !ok).length
  console.log(failed ? `실패 ${failed} / ${results.length}` : `모두 맞음 ${results.length} / ${results.length}`)
  return failed ? 1 : 0
}

main().then((code) => process.exit(code), (e) => { console.error(e); process.exit(1) })

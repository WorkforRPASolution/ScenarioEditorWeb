'use strict'
// 시험 실행 (P5 설계 §5) — 설비에 시나리오 실행을 요청한다. 길: 웹 백엔드 → InterfaceServer /EARS/Action → CommandServer → 에이전트.
// InterfaceServer·CommandServer·에이전트는 호출자 권한도 자동조치 OnOff 도 보지 않는다 — 여기의 검사가 유일한 방어선이다.
// - 에이전트가 실행 중인 설비에만 보낸다(2026-11-18 사내 요청) — Redis 의 에이전트 정보·실행 신호를 CommandServer 와 같은 규칙으로 읽는다(domain/testRun.js readAgent).
//   읽지 못하면 보내지 않는다(까닭을 결과에 싣는다).
// - 요청은 설비 한 대에 하나다(브라우저가 차례로 부른다). 검사는 캐시를 믿지 않는다: 사용자·설비·운영 속성을 요청마다 다시 읽는다(Q-090).
// - 운영 DB 에는 아무것도 쓰지 않는다. 쓰는 것은 InterfaceServer 를 거친 실행 요청과 웹 전용 DB 의 요청 기록뿐이다.
// - 요청 기록은 보내기 직전에 sending 으로 넣고 결과로 고친다 — 방금 요청한 설비·시나리오에 거듭 나가는 것을 막고(누가 보냈든),
//   브라우저가 응답을 놓쳤을 때 서버가 한 일을 되찾는 데 쓴다.
// - 자리: 사용자 한 명은 한 번에 하나, 서버 전체는 설정(기본 1 — InterfaceServer 의 recovery 일꾼이 하나다). 넘으면 기다리게 하지 않고 429.
//   라우터는 브라우저가 끊어도 요청을 끝까지 보낸다(끊고 자리를 비우면 InterfaceServer 에 줄 선 요청이 쌓인다).
// - 다시 보내지 않는다(같은 설비에 두 번 실행될 수 있다 — SE-018).
const { seError } = require('../errors')
const { parseUser } = require('../domain/processPermission')
const { joinEquipment, applyEquipmentRules } = require('../domain/equipmentRules')
const { pickCurrent } = require('../domain/versionPick')
const {
  validateRequest, userTextOf, userInfoOf, buildParams, headerValueOk, delayKeyOk, readOnoff, readRunProperty, isInt64, classifyAction, pickRecovery, testRunLimits, readAgent
} = require('../domain/testRun')

const STEP_COUNT_TTL_MS = 60_000
// sending 으로 남은 기록 — 요청 하나는 길어야 수십 초다. 그보다 오래 남았으면 서버가 죽은 것이고 받았는지 모른다.
const SENDING_STALE_MS = 60_000
// CommandServer 는 받은 뒤 10분 안이면 늦게라도 등록·실행한다(설계 §3)
const LATE_MS = 10 * 60_000
// 검사(여러 번의 DB 읽기)가 이보다 오래 걸렸으면 보내지 않는다 — 브라우저는 30초에 포기한다. 포기한 뒤에 늦게 나가면 사용자가 모르는 실행이 된다.
const SEND_DEADLINE_MS = 20_000
// 실행 기록을 찾아볼 요청 결과(연결 못 함은 보내지 않았다)
const LOOKUP_STATES = new Set(['accepted', 'failed', 'unknown', 'sending'])
const RUN_ID = /^[A-Za-z0-9-]{8,64}$/

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const block = (status, code, message, details) => ({ status, code, message, ...(details ? { details } : {}) })
const NO_STATUS = { found: 0, status: null, retry: null, txnSeq: null, createDate: null }

function createTestRunService({ repo, web, hash, agentState, gridfs, scopes, client, env = process.env, log = null, now = () => Date.now() }) {
  const users = new Set()
  let active = 0
  const stepCounts = new Map()

  // 현재 판의 스텝 수 — 못 읽으면 null(파일이 없거나 Step 이 배열이 아니다). 읽은 값만 1분 기억한다.
  async function stepCountOf(process, model, name, crtime) {
    const key = JSON.stringify([process, model, name, crtime])
    const hit = stepCounts.get(key)
    if (hit && now() - hit.at < STEP_COUNT_TTL_MS) return hit.value
    const stats = await gridfs.findVersionStats(process, model, [{ name, crtime }])
    const value = stats.get(name)?.stepCount ?? null
    if (value === null) stepCounts.delete(key)
    else stepCounts.set(key, { at: now(), value })
    return value
  }

  // 시나리오를 실행할 수 있는가. CommandServer 는 아래 경우의 요청을 받고도 말없이 실행하지 않는다 — 그래서 요청 전에 막고 알린다.
  // blocks = 막는 까닭(순서대로 모두), prop = CommandServer 규칙으로 읽은 운영 속성(문서가 없으면 null), current = 현재 판.
  async function judge(process, model, name) {
    const blocks = []
    const docs = await repo.findRunPropertyDocs({ process, model, name })
    const first = docs.length ? docs[0] : null
    const hasProperty = first !== null && isObj(first.property)
    if (docs.length !== 1 || !hasProperty) blocks.push(block(422, 'TEST_RUN_PROPERTY', '운영 속성 문서가 하나가 아니라 실행할 수 없습니다', { count: docs.length }))
    else if (!isInt64(first.scCategory)) blocks.push(block(422, 'TEST_RUN_PROPERTY', '시나리오 유형 값이 없거나 형이 달라 실행할 수 없습니다', { reason: 'scCategory' }))
    const prop = hasProperty ? readRunProperty(first.property) : null
    if (prop && !prop.isEnabled) blocks.push(block(409, 'TEST_RUN_SCENARIO_OFF', '시나리오가 꺼져 있습니다'))
    const delayed = prop !== null && (prop.startDelay > 0 || prop.retryCnt > 0)
    if (!headerValueOk(name) || (delayed && !delayKeyOk(name))) blocks.push(block(422, 'TEST_RUN_NAME', '시나리오 이름에 실행 요청으로 보낼 수 없는 글자가 있습니다'))
    const crtime = pickCurrent(await hash.hkeys(`${process}-${model}`), name)
    let current = null
    if (crtime === null) blocks.push(block(404, 'TEST_RUN_NOT_DEPLOYED', '현재 버전이 없습니다'))
    else {
      current = { crtime, stepCount: await stepCountOf(process, model, name, crtime) }
      if (current.stepCount === null) blocks.push(block(422, 'TEST_RUN_VERSION_UNREADABLE', '현재 버전의 스텝 수를 읽지 못했습니다'))
    }
    return { blocks, prop, current, delayed }
  }

  async function equipment(user, process, model) {
    await scopes.assertAllowed(user, process, model)
    const { valid } = await scopes.scopeFor(user)
    const mine = valid.filter((e) => e.process === process && e.eqpModel === model).sort((a, b) => (a.eqpId < b.eqpId ? -1 : a.eqpId > b.eqpId ? 1 : 0))
    // 자동조치 값은 지금 값으로(캐시는 1분 묵을 수 있다). 마지막 판정은 요청 때 다시 한다.
    const fresh = new Map((await repo.findOnoff(mine.map((e) => e.eqpId))).map((r) => [r.eqpId, r.onoff]))
    // 에이전트 상태 — 설비들을 한 번에. 읽지 못해도 목록은 준다(모두 unreadable — 화면이 고르지 못하게 하고 까닭을 알린다)
    let states = null
    try {
      states = await agentState.read(process, model, mine.map((e) => e.eqpId))
    } catch (e) {
      if (log) log.warn(`시나리오 실행 에이전트 상태를 읽지 못했다 ${process}/${model}: ${(e && e.code) || (e && e.message) || e}`)
    }
    const limits = testRunLimits(env)
    return {
      equipment: mine.map((e) => ({
        eqpId: e.eqpId, line: e.line, ipAddr: e.ipAddr, ipAddrL: e.ipAddrL ?? '', onoff: fresh.has(e.eqpId) ? readOnoff(fresh.get(e.eqpId)) : 'unreadable',
        agent: states ? readAgent(states.get(e.eqpId) ?? {}) : 'unreadable'
      })),
      limits: { maxEquipment: limits.maxEquipment, recentMin: limits.recentMin }
    }
  }

  async function scenario(user, process, model, name) {
    await scopes.assertAllowed(user, process, model)
    const { blocks, prop, current } = await judge(process, model, name)
    const rows = await web.findRecentTestRuns({ process, model, name, since: now() - testRunLimits(env).recentMin * 60_000 })
    const latest = new Map()
    for (const r of rows) if (!latest.has(r.eqpId) || r.sentAt > latest.get(r.eqpId).sentAt) latest.set(r.eqpId, r)
    return {
      process, model, name, current,
      isEnabled: prop ? prop.isEnabled : null, startDelay: prop ? prop.startDelay : null, retryCnt: prop ? prop.retryCnt : null,
      retryInterval: prop ? prop.retryInterval : null, priority: prop ? prop.priority : null, next: prop ? prop.next : null, emailSkip: prop ? prop.emailSkip : null,
      blocks: blocks.map((b) => b.code),
      recent: [...latest.values()].sort((a, b) => (a.eqpId < b.eqpId ? -1 : 1)).map((r) => ({ eqpId: r.eqpId, by: r.user, at: r.sentAt }))
    }
  }

  // 이 설비에 보낼 수 있는가 → 보낼 값({ target }) 또는 건너뛰는 결과({ outcome, detail? }). 설비 문서를 캐시 없이 다시 읽어 목록과 같은 규칙에 넣는다.
  async function judgeEquipment(user, { process, model, eqpId }, delayed) {
    const { eqps, agents } = await repo.findEquipmentFresh(eqpId)
    const e = applyEquipmentRules(joinEquipment(agents, eqps), user).valid.find((x) => x.eqpId === eqpId)
    if (!e) return { outcome: 'forbidden' } // 범위 밖·무효·없음을 가르지 않는다
    if (e.process !== process || e.eqpModel !== model) return { outcome: 'mismatch' }
    const onoff = readOnoff(e.onoff)
    if (onoff === 'off') return { outcome: 'off' }
    if (onoff === 'unreadable') return { outcome: 'off', detail: 'unreadable' }
    const values = [e.process, e.eqpModel, e.eqpId, e.line]
    if (!values.every(headerValueOk)) return { outcome: 'badValue', detail: 'header' }
    if (delayed && !values.every(delayKeyOk)) return { outcome: 'badValue', detail: 'delayKey' }
    // 에이전트가 실행 중인가 — 지금 값으로(목록을 본 뒤 꺼졌을 수 있다). 읽지 못하면 보내지 않는다.
    let agent = 'unreadable'
    try {
      agent = readAgent((await agentState.read(e.process, e.eqpModel, [e.eqpId])).get(e.eqpId) ?? {})
    } catch (err) {
      if (log) log.warn(`시나리오 실행 에이전트 상태를 읽지 못했다 ${e.process}/${e.eqpModel}/${e.eqpId}: ${(err && err.code) || (err && err.message) || err}`)
    }
    if (agent !== 'on') return agent === 'off' ? { outcome: 'agentOff' } : { outcome: 'agentOff', detail: agent }
    return { target: { process: e.process, model: e.eqpModel, eqpId: e.eqpId, line: e.line } }
  }

  async function request(user, body) {
    const v = validateRequest(body)
    if (!v.ok) throw seError(400, 'BAD_REQUEST', '요청 형식이 올바르지 않습니다', { path: v.path })
    const req = v.value
    const started = now()
    // 사용자 다시 읽기 — 목록을 본 뒤 권한을 잃었을 수 있다
    const docs = await repo.findUsers(user.singleid)
    if (!docs.length) throw seError(403, 'USER_NOT_REGISTERED', '편집기 사용자로 등록되지 않았습니다')
    if (docs.length > 1) throw seError(403, 'TEST_RUN_USER_AMBIGUOUS', '같은 아이디의 사용자 문서가 여럿이라 시나리오 실행을 할 수 없습니다')
    const fresh = parseUser(docs[0])
    if (!fresh.canWrite) throw seError(403, 'WRITE_FORBIDDEN', 'WRITE 권한이 없습니다')
    await scopes.assertAllowed(fresh, req.process, req.model)

    const { blocks, current, delayed } = await judge(req.process, req.model, req.name)
    if (blocks.length) throw seError(blocks[0].status, blocks[0].code, blocks[0].message, blocks[0].details ?? null)
    if (req.startStep > current.stepCount) throw seError(409, 'TEST_RUN_START_STEP', '시작 스텝이 현재 버전의 스텝 수를 넘습니다', { max: current.stepCount })

    const limits = testRunLimits(env)
    // 화면의 실수를 막는 한도다(서버 경계는 아니다 — runId 를 바꾸면 넘는다)
    if (await web.countTestRuns(req.runId) >= limits.maxEquipment) throw seError(409, 'TEST_RUN_LIMIT', '한 번에 실행할 수 있는 설비 수를 넘었습니다', { max: limits.maxEquipment })

    // 자리·기록·로그의 아이디는 인증된 아이디다(다시 읽은 문서는 이 아이디로 찾은 것이다)
    const id = user.singleid
    if (users.has(id)) throw seError(429, 'TEST_RUN_BUSY', '다른 실행 요청을 보내고 있습니다', { scope: 'user' })
    if (active >= limits.concurrency) throw seError(429, 'TEST_RUN_BUSY', '다른 실행 요청을 보내고 있습니다', { scope: 'server' })
    users.add(id)
    active += 1
    const head = `시나리오 실행 user=${id} run=${req.runId} ${req.process}/${req.model}/${req.name} eqp=${req.eqpId} step=${req.startStep} reason=${req.reason.kind}`
    const done = (result) => {
      if (log) log.info(`${head} → ${result.outcome}${typeof result.detail === 'string' && result.outcome !== 'failed' ? `(${result.detail})` : ''} ${now() - started}ms`)
      return result
    }
    try {
      const judged = await judgeEquipment(fresh, req, delayed)
      if (!judged.target) return done(judged)
      // 방금 요청 — 누가 보냈든 본다. 사용자가 확인 창에서 따로 고른 경우(again)만 다시 보낸다.
      if (!req.again) {
        const recent = await web.findRecentTestRuns({ process: req.process, model: req.model, name: req.name, since: now() - limits.recentMin * 60_000, eqpIds: [req.eqpId] })
        if (recent.length) {
          const last = recent.reduce((a, b) => (b.sentAt > a.sentAt ? b : a))
          return done({ outcome: 'recent', detail: { by: last.user, at: last.sentAt } })
        }
      }
      if (now() - started > SEND_DEADLINE_MS) throw seError(503, 'TEST_RUN_SLOW', '검사가 오래 걸려 실행 요청을 보내지 않았습니다')
      const userInfo = userInfoOf(fresh)
      const userText = userTextOf(req.reason)
      const sentAt = now()
      const { inserted } = await web.insertTestRun({
        runId: req.runId, eqpId: req.eqpId, process: req.process, model: req.model, name: req.name, user: id, userInfo, startStep: req.startStep,
        reasonKind: req.reason.kind, userText, state: 'sending', detail: null, sentAt, doneAt: null, createdAt: new Date(sentAt)
      })
      if (!inserted) throw seError(409, 'TEST_RUN_DUPLICATE', '이 실행에서 이미 보낸 설비입니다')
      const received = await client.send({ ...judged.target, name: req.name, txn: sentAt, body: buildParams({ userInfo, startStep: req.startStep, userText }) })
      const result = classifyAction(received)
      try {
        await web.updateTestRun(req.runId, req.eqpId, { state: result.outcome, detail: result.detail ?? null, doneAt: now() })
      } catch (e) {
        // 보내기는 끝났다 — 결과는 돌려주고, 기록은 sending 으로 남아 60초 뒤 "모름" 으로 읽힌다
        if (log) log.warn(`${head} 요청 기록을 고치지 못했다: ${(e && e.code) || (e && e.message) || e}`)
      }
      if (log && result.outcome === 'failed') log.warn(`${head} InterfaceServer 가 준 까닭: ${result.detail}`)
      return done(result)
    } finally {
      users.delete(id)
      active -= 1
    }
  }

  async function status(user, body) {
    const bad = (path) => seError(400, 'BAD_REQUEST', '요청 형식이 올바르지 않습니다', { path })
    if (!isObj(body)) throw bad('')
    if (typeof body.runId !== 'string' || !RUN_ID.test(body.runId)) throw bad('runId')
    const pinned = body.pinned === undefined ? {} : body.pinned
    if (!isObj(pinned) || Object.values(pinned).some((n) => typeof n !== 'number' || !Number.isFinite(n))) throw bad('pinned')
    // 내 실행의 기록만 — 시각 창은 서버가 적은 값에서 나온다(브라우저가 주지 않는다)
    const records = await web.findTestRuns(body.runId, user.singleid)
    if (!records.length) throw seError(404, 'NOT_FOUND', '실행 요청 기록이 없습니다')
    const at = now()
    const { skewMs } = testRunLimits(env)
    const lookups = records.filter((r) => LOOKUP_STATES.has(r.state))
    const pins = lookups.filter((r) => Object.prototype.hasOwnProperty.call(pinned, r.eqpId))
    const seeks = lookups.filter((r) => !Object.prototype.hasOwnProperty.call(pinned, r.eqpId))
    let pinDocs = []
    let seekDocs = []
    let rivals = []
    try {
      // 찾아 둔 줄은 정확히 집고, 나머지는 조회 한 번으로(설비들 + txn_seq 범위)
      if (pins.length) pinDocs = await repo.findRecoveriesAt(pins.map((r) => ({ eqpId: r.eqpId, txnSeq: pinned[r.eqpId], name: r.name })))
      if (seeks.length) {
        const from = Math.min(...seeks.map((r) => r.sentAt)) - skewMs
        const { process, model, name } = records[0] // 한 실행의 기록은 시나리오가 같다
        seekDocs = await repo.findRecoveries({ eqpIds: seeks.map((r) => r.eqpId), from, to: Math.max(...seeks.map((r) => r.doneAt ?? at)) + LATE_MS, name })
        // 같은 사람이 이 설비·시나리오에 한 다른 실행 — 그쪽에 더 가까운 문서는 그 실행의 것이다(pickRecovery 의 rivals)
        rivals = await web.findRivalTestRuns({ user: user.singleid, runId: body.runId, process, model, name, eqpIds: seeks.map((r) => r.eqpId), since: from - LATE_MS })
      }
    } catch (e) {
      if (log) log.warn(`시나리오 실행 상태 조회 실패 user=${user.singleid} run=${body.runId}: ${(e && e.code) || (e && e.message) || e}`)
      throw seError(503, 'TEST_RUN_STATUS_FAILED', '실행 상태를 읽지 못했습니다')
    }
    const recOf = (r) => ({ eqpId: r.eqpId, name: r.name, userInfo: r.userInfo, startStep: r.startStep, userText: r.userText, sentAt: r.sentAt })
    const toNum = (x) => (typeof x === 'number' ? x : x && typeof x.toNumber === 'function' ? x.toNumber() : NaN)
    const items = records.map((r) => {
      let found = NO_STATUS
      if (pins.includes(r)) {
        const exact = pinDocs.filter((d) => isObj(d) && d.eqpid === r.eqpId && toNum(d.txn_seq) === pinned[r.eqpId])
        const p = pickRecovery(exact, recOf(r), skewMs)
        if (p.doc) found = { found: 1, ...p.doc }
      } else if (seeks.includes(r)) {
        const others = rivals.filter((x) => x.eqpId === r.eqpId && x.startStep === r.startStep && x.userText === r.userText).map((x) => x.sentAt)
        const p = pickRecovery(seekDocs, recOf(r), skewMs, others)
        if (p.doc) found = { found: p.found, ...p.doc }
      }
      const outcome = r.state === 'sending' && at - r.sentAt > SENDING_STALE_MS ? 'unknown' : r.state
      return { eqpId: r.eqpId, outcome, detail: r.detail ?? null, sentAt: r.sentAt, ...found }
    })
    return { now: at, items }
  }

  return { equipment, scenario, request, status }
}

module.exports = { createTestRunService }

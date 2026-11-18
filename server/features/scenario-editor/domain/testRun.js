'use strict'
// 시험 실행의 순수 규칙(P5 설계 §5.2·§5.3·§5.4). 서버·DB 를 부르지 않는다.
// - 입력 검사, 사유 → UserText, params·@UserInfo 조립
// - 헤더에 실을 값·지연 키 검사, onoff 읽기
// - 운영 속성을 CommandServer 가 읽는 규칙으로 읽기(웹의 propertyModel 과 다르다 — 그쪽은 C# 편집기의 규칙이다)
// - InterfaceServer 가 준 것을 설비 하나의 결과로 가르기, 내 요청의 실행 기록 고르기

// 설비 하나의 결과(200 응답의 outcome). 화면 문구 SEW_RUN_OUTCOME_<값> 과 맞춘다(시험이 본다).
const OUTCOMES = ['accepted', 'off', 'agentOff', 'recent', 'forbidden', 'mismatch', 'badValue', 'failed', 'unknown', 'down']
// 사내 값 그대로 — 앞 둘은 UserText 로 그대로 나간다
const REASON_KINDS = ['INSPECTION', 'MAN_EXE', 'other']
const REASON_MAX = 120
const DETAIL_MAX = 300

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isText = (v) => typeof v === 'string' && v !== ''
// ^ < > 는 사내 금지 문자, 제어 문자(줄바꿈·탭 포함)는 이력·메일에 그대로 보여서 막는다
const REASON_BAD = /[\^<>\u0000-\u001f\u007f]/

function validateRequest(body) {
  const bad = (path) => ({ ok: false, path })
  if (!isObj(body)) return bad('')
  for (const k of ['process', 'model', 'name', 'eqpId']) if (!isText(body[k])) return bad(k)
  if (typeof body.runId !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(body.runId)) return bad('runId')
  if (!Number.isInteger(body.startStep) || body.startStep < 1) return bad('startStep')
  if (!isObj(body.reason)) return bad('reason')
  if (!REASON_KINDS.includes(body.reason.kind)) return bad('reason.kind')
  const reason = { kind: body.reason.kind }
  if (reason.kind === 'other') {
    const text = typeof body.reason.text === 'string' ? body.reason.text.trim() : ''
    if (!text || [...text].length > REASON_MAX || REASON_BAD.test(text)) return bad('reason.text')
    reason.text = text
  }
  if (body.again !== undefined && typeof body.again !== 'boolean') return bad('again')
  return {
    ok: true,
    value: { runId: body.runId, process: body.process, model: body.model, name: body.name, eqpId: body.eqpId, startStep: body.startStep, reason, again: body.again === true }
  }
}

const userTextOf = (reason) => (reason.kind === 'other' ? reason.text : reason.kind)
// 사내와 같은 꼴. 이름은 parseUser 가 준 값이다(빈 이름이면 SingleID)
const userInfoOf = (user) => `${user.name} - ${user.singleid}`
// 값은 모두 글자다(CommandServer 가 Map[String,String] 으로 읽는다). @Trigger 는 CommandServer 가 헤더 값으로 넣는다.
const buildParams = ({ userInfo, startStep, userText }) => JSON.stringify({ '@UserInfo': userInfo, '@StartStep': String(startStep), UserText: userText })

// HTTP 헤더로 그대로 갈 수 있는 값: 보이는 ASCII(가운데 빈칸 포함)만, 앞뒤 공백 없음(HTTP 가 잘라 다른 값이 된다). 바꾸거나 인코딩하지 않는다(Q-112).
const headerValueOk = (v) => typeof v === 'string' && v !== '' && v === v.trim() && /^[\x20-\x7e]+$/.test(v)
// CommandServer 의 지연 키(시작 지연·재시도)가 받는 글자 — 아니면 말없이 버려져 Wait 로 남는다(DC-012)
const delayKeyOk = (v) => typeof v === 'string' && /^[a-zA-Z_\-0-9.]+$/.test(v)

// EQP_INFO.onoff — 숫자 0 이면 자동조치 OFF. 숫자가 아니면 켜졌다고 믿지 않는다.
function readOnoff(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 'unreadable'
  return v === 0 ? 'off' : 'on'
}

// ── 에이전트 상태 (2026-11-18 사내 요청) ──
// CommandServer 가 에이전트로 보내기 직전에 보는 것과 같은 규칙이다(remote/HttpConnector.scala·GRPCConnector.scala):
//   ① Redis 해시 AgentMetaInfo:{공정}-{모델} 의 설비 ID 칸이 ':' 로 넷 이상의 칸  ② 키 AgentRunning:{공정}-{모델}-{설비 ID} 가 있다.
// ② 가 없으면 CommandServer 는 실행 기록을 NotStarted 로 끝내고, ① 이 아예 없으면 예외로 Wait 에 남긴다(CS-005) — 그래서 웹이 보내기 전에 막는다.
// 에이전트는 AgentRunning 을 주기(AliveSignalInterval, 기본 5분)마다 주기의 2배 만료로 쓴다(ARSAgent actor/RedisActor.scala) —
// 방금 죽은 에이전트는 만료 전까지 'on' 으로 보인다. 그때는 지금처럼 실행 상태가 "시작 못 함" 으로 나온다.
const agentMetaKey = (process, model) => `AgentMetaInfo:${process}-${model}`
const agentRunningKey = (process, model, eqpId) => `AgentRunning:${process}-${model}-${eqpId}`
// { meta, running } = Redis 가 준 값(없으면 null) → 'on' | 'off'(실행 신호 없음) | 'noInfo'(에이전트 정보 없음)
function readAgent({ meta, running } = {}) {
  if (typeof meta !== 'string') return 'noInfo'
  // 자바의 split(":") 은 끝의 빈 칸을 버린다
  const parts = meta.split(':')
  while (parts.length && parts[parts.length - 1] === '') parts.pop()
  if (parts.length < 4) return 'noInfo'
  return running === null || running === undefined ? 'off' : 'on'
}

// ── 운영 속성: CommandServer 의 JobActor.getSCProperty → BsonDocument.toJson()(STRICT) → getScenarioProperty_SimpleJSON ──
// 입력은 promoteValues: false 로 읽은 property 문서(Int32·Double·Long 이 드라이버 객체로 온다).
// Int64 는 {"$numberLong": "글자"} 가 되어 글자를 Int 로 읽고, Int32 는 그대로 읽는다. Double·글자·불리언·null·없음은 기본값이 된다.
const INT_MIN = -2147483648
const INT_MAX = 2147483647
const inInt = (n) => Number.isInteger(n) && n >= INT_MIN && n <= INT_MAX
const bsonType = (v) => (v !== null && typeof v === 'object' ? v._bsontype : undefined)
const isInt64 = (v) => bsonType(v) === 'Long'

function csInt(v, fallback) {
  const t = bsonType(v)
  if (t === 'Long') {
    const s = String(v)
    const n = /^-?\d+$/.test(s) ? Number(s) : NaN
    return inInt(n) ? n : fallback
  }
  if (t === 'Int32') return inInt(v.value) ? v.value : fallback
  // 드라이버가 숫자로 올려 준 값(이 함수의 호출자는 올리지 않는다): 정수는 Int32 로 본다
  if (typeof v === 'number') return inInt(v) ? v : fallback
  return fallback
}
const csBool = (v, fallback) => (typeof v === 'boolean' ? v : fallback)
const nextName = (v) => (isObj(v) && bsonType(v) === undefined && typeof v.Name === 'string' && typeof v.Text === 'string' ? v.Name : null)

function readRunProperty(raw) {
  const p = isObj(raw) ? raw : {}
  const priority = csInt(p.Priority, 10)
  return {
    isEnabled: csBool(p.IsEnabled, true),
    startDelay: csInt(p.StartDelay, 0),
    retryCnt: csInt(p.RetryCnt, 0),
    retryInterval: csInt(p.RetryInterval, 10),
    priority: priority <= 0 ? 10 : priority,
    next: { success: nextName(p.NextScenarioIfSuccess), fail: nextName(p.NextScenarioIfFail) },
    emailSkip: { success: csBool(p.DoNotSendEmailWhenSuccess, false), stop: csBool(p.DoNotSendEmailWhenStop, false), fail: csBool(p.DoNotSendEmailWhenFail, false) }
  }
}

// ── 설정(P5 설계 §5.6) — 요청마다 읽는다 ──
const isLoopback = (h) => {
  const x = String(h).toLowerCase().replace(/^\[|\]$/g, '')
  return x === 'localhost' || x === '::1' || /^127(\.\d{1,3}){3}$/.test(x)
}
// "host:port"·"[::1]:port" → 호스트
function hostOf(hp) {
  const s = hp.trim()
  if (s.startsWith('[')) { const end = s.indexOf(']'); return end > 0 ? s.slice(1, end) : s }
  return (s.match(/:/g) || []).length > 1 ? s : s.split(':')[0]
}
// mongodb://[계정@]호스트[:포트][,호스트…]/DB?… → 호스트들. mongodb+srv 는 DNS 이름 하나다. 해석하지 못하면 빈 목록.
function mongoHosts(uri) {
  const m = /^mongodb(\+srv)?:\/\/(.*)$/.exec(uri)
  if (!m) return []
  const authority = m[2].split(/[/?]/)[0]
  const hosts = authority.slice(authority.lastIndexOf('@') + 1)
  return m[1] ? [hosts] : hosts.split(',').filter(Boolean).map(hostOf)
}
function urlHosts(url) {
  if (!/^https?:\/\//i.test(url)) return []
  try { return [new URL(url).hostname] } catch { return [] }
}
const allLoopback = (value, hostsOf) => {
  const v = typeof value === 'string' ? value.trim() : ''
  if (!v) return true // 비어 있으면 연결 코드의 기본값(localhost)
  const hosts = hostsOf(v)
  return hosts.length > 0 && hosts.every(isLoopback)
}
// 문(writePolicy.testRunDenial)에 넘길 값. earsLoopback = 운영 Mongo 와 InterfaceServer 가 모두 이 PC 안인가(해석하지 못하는 주소는 믿지 않는다).
function testRunFlags(env) {
  return {
    enabled: env.SE_TEST_RUN === '1',
    devOverride: env.SE_DEV_USER_OVERRIDE === '1',
    earsLoopback: allLoopback(env.MONGODB_URI, mongoHosts) && allLoopback(env.EARS_INTERFACE_URL, urlHosts)
  }
}
const intIn = (raw, min, max, fallback) => {
  const s = typeof raw === 'string' ? raw.trim() : ''
  const n = /^\d+$/.test(s) ? Number(s) : NaN
  return n >= min && n <= max ? n : fallback
}
function testRunLimits(env) {
  return {
    maxEquipment: intIn(env.SE_TEST_RUN_MAX_EQP, 1, 200, 200),
    concurrency: intIn(env.SE_TEST_RUN_CONCURRENCY, 1, 5, 1), // InterfaceServer 의 recovery 일꾼은 하나다(실측) — 늘려도 그 안에서 줄을 선다
    recentMin: intIn(env.SE_TEST_RUN_RECENT_MIN, 1, 60, 10),
    skewMs: intIn(env.SE_TEST_RUN_CLOCK_SKEW_SEC, 0, 3600, 120) * 1000
  }
}

// ── InterfaceServer /EARS/Action 이 준 것 → 결과 ──
// "보내지 않았다" 고 말할 수 있는 것은 down 뿐이다. 모르는 것(unknown)은 CommandServer 가 받았을 수 있다 — 10분 동안 "안 됐다" 고 단정하지 않는다(설계 §3).
function classifyAction(received) {
  const unknown = { outcome: 'unknown' }
  if (!received) return unknown
  if (received.kind === 'notSent') return { outcome: 'down' }
  if (received.kind !== 'response') return unknown
  const { status, text } = received
  if (status >= 400 && status < 500) return { outcome: 'failed', detail: `HTTP ${status}` }
  if (status < 200 || status >= 300) return unknown
  let parsed = null
  try { parsed = JSON.parse(text) } catch { /* 아래에서 모름으로 */ }
  if (!isObj(parsed)) return unknown
  if (parsed.result === 'Success') return { outcome: 'accepted' }
  if (parsed.result !== 'Fail') return unknown
  // 연결 실패·응답 시간 초과는 까닭 없이 "null" 로 온다(DC-133) — CommandServer 가 받았을 수 있다
  const message = typeof parsed.message === 'string' ? parsed.message.trim() : ''
  if (!message || message === 'null') return unknown
  return { outcome: 'failed', detail: message.slice(0, DETAIL_MAX) }
}

// ── 실행 기록(EQP_AUTO_RECOVERY) 가운데 내 요청의 것 ──
// CommandServer 는 txn_seq 를 제 시계로 만들고 돌려주지 않는다(Q-113) — 조건으로 찾는다.
const toNum = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (v !== null && typeof v === 'object' && typeof v.toNumber === 'function') return v.toNumber()
  return null
}
const textOrNull = (v) => (typeof v === 'string' ? v : null)

// rivals = 같은 사람이 같은 설비·시나리오·시작 스텝·사유로 한 **다른 요청**의 보낸 시각들 — 그쪽에 더 가까운 문서는 그 요청의 것이다.
// (방금 다시 실행했을 때, 새 실행의 문서가 아직 없는 사이 앞 실행의 끝난 문서가 새 실행의 것으로 보이지 않게)
function pickRecovery(docs, rec, skewMs, rivals = []) {
  const hits = []
  for (const d of Array.isArray(docs) ? docs : []) {
    if (!isObj(d) || d.eqpid !== rec.eqpId || d.ears_code !== rec.name || d.trigger_by !== 'SE' || !isObj(d.params)) continue
    const p = d.params
    if (p['@UserInfo'] !== rec.userInfo || p['@StartStep'] !== String(rec.startStep) || p.UserText !== rec.userText) continue
    const txn = toNum(d.txn_seq)
    if (txn === null || txn < rec.sentAt - skewMs) continue
    const mine = Math.abs(txn - rec.sentAt)
    if (rivals.some((at) => Math.abs(txn - at) < mine)) continue
    hits.push({ d, txn })
  }
  if (!hits.length) return { found: 0, doc: null }
  const best = hits.reduce((a, b) => (Math.abs(b.txn - rec.sentAt) < Math.abs(a.txn - rec.sentAt) ? b : a))
  return { found: hits.length, doc: { status: textOrNull(best.d.status), retry: textOrNull(best.d.retry), txnSeq: best.txn, createDate: textOrNull(best.d.create_date) } }
}

module.exports = {
  OUTCOMES, REASON_KINDS, REASON_MAX, validateRequest, userTextOf, userInfoOf, buildParams, headerValueOk, delayKeyOk, readOnoff,
  readRunProperty, isInt64, classifyAction, pickRecovery, testRunFlags, testRunLimits, agentMetaKey, agentRunningKey, readAgent
}

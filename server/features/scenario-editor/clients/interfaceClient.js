'use strict'
// InterfaceServer 호출(공통 설계 §7.1). 공개 함수 목록이 곧 허용 목록이다 — 경로·function 을 입력으로 합성하지 않는다.
// 사용자 문구에는 내부 정보를 싣지 않고, 서버가 준 원문은 로그와 오류의 upstream { status, text } 로만 남긴다.
// 503 은 요청이 가지 않았다는 뜻이다. 504 는 결과를 모르는 실패다: 시간 초과·응답 전 끊김이고, 서버가 10초 askTimeout 뒤에도 저장을 끝까지 진행할 수 있어(분석 03 §1.4)
// 저장이 곧 배포이므로 부른 쪽이 다시 보내기 전에 판 이력·Redis 로 확인해야 한다.
const { createLogger } = require('../../../shared/logger')
const { serializeSetScenarioRequest } = require('../domain/csharpJson')
const { seError } = require('../errors')

const log = createLogger('scenario-editor')

const DEFAULT_URL = 'http://localhost:8080'
const DEFAULT_TIMEOUT_MS = 15000
const UPSTREAM_TEXT_MAX = 300
// 요청을 보내기 전 단계의 실패 — 이것만 "가지 않았다" 고 말할 수 있다.
const NOT_SENT_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT', 'ERR_INVALID_URL'])

// --- DI for testing ---
let _fetch = globalThis.fetch

function _setDeps(deps) {
  if (deps.fetch) _fetch = deps.fetch
}

function configuredTimeoutMs() {
  const ms = Number(process.env.EARS_INTERFACE_TIMEOUT_MS)
  return Number.isFinite(ms) && ms > 0 ? ms : DEFAULT_TIMEOUT_MS
}

function failure(fn, statusCode, code, message, status, text) {
  const upstream = { status, text: String(text).slice(0, UPSTREAM_TEXT_MAX) }
  log.warn(`interface ${fn} ${code} status=${status} ${upstream.text}`)
  return Object.assign(seError(statusCode, code, message), { upstream })
}

// extra: { headers, duplex, passThrough } — 흘려 보내기용. passThrough() 가 오류를 주면 502·503·504 로 바꾸지 않고 그대로 던진다.
async function post(fn, body, timeoutMs, extra = {}) {
  let status = 0
  let text
  try {
    const res = await _fetch(`${process.env.EARS_INTERFACE_URL || DEFAULT_URL}/EARS/Interface`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', category: 'scenario', function: fn, ...extra.headers },
      body,
      ...(extra.duplex ? { duplex: extra.duplex } : {}),
      signal: AbortSignal.timeout(timeoutMs ?? configuredTimeoutMs())
    })
    status = res.status
    text = await res.text()
  } catch (e) {
    const own = extra.passThrough && extra.passThrough()
    if (own) throw own
    // fetch failed 만으로는 서버가 죽었는지 거절했는지 모른다 — 원인을 함께 남긴다
    const cause = e && e.cause ? ` (${e.cause.code || e.cause.message || e.cause})` : ''
    if (e && e.cause && NOT_SENT_CODES.has(e.cause.code)) throw failure(fn, 503, 'UPSTREAM_DOWN', 'InterfaceServer 에 연결하지 못했습니다', status, `${e}${cause}`)
    throw failure(fn, 504, 'UPSTREAM_TIMEOUT', 'InterfaceServer 응답을 받지 못했습니다', status, `${e}${cause}`)
  }
  if (status === 500) throw failure(fn, 504, 'UPSTREAM_TIMEOUT', 'InterfaceServer 응답이 늦습니다', status, text)
  let parsed = null
  try {
    parsed = JSON.parse(text)
  } catch {
    // 아래에서 실패로 처리한다
  }
  // 업무 실패도 HTTP 200 이고 success 는 문자열이다(분석 03 §1.5).
  if (status !== 200 || !parsed || parsed.success !== 'true') {
    throw failure(fn, 502, 'UPSTREAM_FAILED', 'InterfaceServer 가 요청을 처리하지 못했습니다', status, text)
  }
}

// 응답에 새 crtime 이 없다 — 저장한 판을 알려면 판 이력을 다시 읽는다(분석 03 §2.5). body·bi·property 는 JSON 문자열이다.
async function setScenario({ process: proc, model, name, body, bi, property }, { timeoutMs } = {}) {
  await post('setscenario', serializeSetScenarioRequest({ Process: proc, Model: model, SCName: name, BI: bi, Body: body, Property: property }), timeoutMs)
}

// 흘려 보내기 — 본문이 100MB 를 넘을 수 있어 조각 반복자로 보낸다. fetch(undici)는 duplex 'half' 에서 사용자가 단 Content-Length 를 그대로 지킨다(시험으로 확인).
// chunked 가 아니라 길이를 미리 달아야 InterfaceServer(akka-http)가 max-content-length 를 앞에서 판정한다.
// 조각을 만들다 던지면 스트림을 오류로 끝내 요청을 끊고(짧은 본문은 완성되지 않는다 — 서버는 저장하지 않는다) 그 오류를 그대로 던진다.
// 조각 합계가 contentLength 와 다르면(프로그램 오류) 완전한 본문을 보내지 않고 code CONTENT_LENGTH_MISMATCH 로컬 오류를 매핑 없이 던진다.
async function setScenarioStream({ chunks, contentLength }, { timeoutMs } = {}) {
  let localError = null
  const it = chunks()[Symbol.asyncIterator]()
  const stop = () => (typeof it.return === 'function' ? Promise.resolve(it.return()).catch(() => {}) : Promise.resolve())
  const mismatch = (controller, msg) => {
    localError = Object.assign(new Error(msg), { code: 'CONTENT_LENGTH_MISMATCH' })
    controller.error(localError)
    return stop()
  }
  // 한 조각 앞서 본다: 다음 조각(또는 끝)을 받은 뒤에야 쥐고 있던 조각을 보낸다. 그래서 contentLength 를 채우는 마지막 바이트는
  // 반복자가 끝났다고 알린 뒤에만 나가고, 반복자에 더 있으면 완전한 본문이 서버에 닿지 않는다(InterfaceServer 는 저장하지 않는다).
  let held = null
  let sent = 0
  let exhausted = false
  const body = new ReadableStream({
    async pull(controller) {
      try {
        for (;;) {
          const { value, done } = await it.next()
          if (done) {
            exhausted = true
            const total = sent + (held ? held.length : 0)
            if (total !== contentLength) return await mismatch(controller, `contentLength ${contentLength} 와 조각 합계 ${total} 바이트가 다릅니다`)
            if (held) controller.enqueue(held)
            controller.close()
            return
          }
          if (typeof value !== 'string') return await mismatch(controller, '조각은 문자열이어야 합니다')
          if (value.length === 0) continue
          const buf = Buffer.from(value, 'utf8')
          if (!held) { held = buf; continue }
          if (sent + held.length >= contentLength) return await mismatch(controller, `조각이 contentLength ${contentLength} 를 넘어섭니다`)
          controller.enqueue(held)
          sent += held.length
          held = buf
          return
        }
      } catch (e) {
        localError = e
        controller.error(e)
      }
    },
    cancel: stop
  })
  try {
    await post('setscenario', body, timeoutMs, { headers: { 'Content-Length': String(contentLength) }, duplex: 'half', passThrough: () => localError })
  } finally {
    // 시간 초과로 끊으면 undici 가 본문 스트림을 취소하지 않는다 — 반복자를 직접 닫는다(기다리지 않는다: 멈춘 반복자는 return 도 못 끝낸다)
    if (!exhausted) stop()
  }
}

async function delScenario({ process: proc, model, name }) {
  await post('delscenario', JSON.stringify({ Process: proc, Model: model, SCName: name }))
}

// 흘려 보내기 전에 본문 바이트 수를 센다(Content-Length 용). 조각은 코드 포인트 단위로 잘려 있어야 한다.
async function countUtf8Bytes(iterable) {
  let n = 0
  for await (const c of iterable) n += Buffer.byteLength(c, 'utf8')
  return n
}

module.exports = { setScenario, setScenarioStream, delScenario, countUtf8Bytes, _setDeps }

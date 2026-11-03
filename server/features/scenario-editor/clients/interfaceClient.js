'use strict'
// InterfaceServer 호출(공통 설계 §7.1). 공개 함수 목록이 곧 허용 목록이다 — 경로·function 을 입력으로 합성하지 않는다.
// 사용자 문구에는 내부 정보를 싣지 않고, 서버가 준 원문은 로그와 오류의 upstream { status, text } 로만 남긴다.
// 504 는 결과를 모르는 실패다: 서버가 10초 askTimeout 뒤에도 저장을 끝까지 진행할 수 있어(분석 03 §1.4) 부른 쪽이 판 이력·Redis 로 확인해야 한다.
const { createLogger } = require('../../../shared/logger')
const { serializeSetScenarioRequest } = require('../domain/csharpJson')
const { seError } = require('../errors')

const log = createLogger('scenario-editor')

const DEFAULT_URL = 'http://localhost:8080'
const DEFAULT_TIMEOUT_MS = 15000
const UPSTREAM_TEXT_MAX = 300

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

async function post(fn, body, timeoutMs) {
  let status = 0
  let text
  try {
    const res = await _fetch(`${process.env.EARS_INTERFACE_URL || DEFAULT_URL}/EARS/Interface`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', category: 'scenario', function: fn },
      body,
      signal: AbortSignal.timeout(timeoutMs ?? configuredTimeoutMs())
    })
    status = res.status
    text = await res.text()
  } catch (e) {
    if (e && e.name === 'TimeoutError') throw failure(fn, 504, 'UPSTREAM_TIMEOUT', 'InterfaceServer 응답이 늦습니다', status, e.message)
    // fetch failed 만으로는 서버가 죽었는지 거절했는지 모른다 — 원인을 함께 남긴다
    const cause = e && e.cause ? ` (${e.cause.code || e.cause.message || e.cause})` : ''
    throw failure(fn, 503, 'UPSTREAM_DOWN', 'InterfaceServer 에 연결하지 못했습니다', status, `${e}${cause}`)
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

module.exports = { setScenario, _setDeps }

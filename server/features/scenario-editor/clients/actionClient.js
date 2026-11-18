'use strict'
// InterfaceServer /EARS/Action(recovery) 호출 — 시험 실행 요청 한 건(P5 설계 §5.3). 경로·category 를 입력으로 합성하지 않는다.
// 받은 것을 그대로 돌려주고 던지지 않는다. 뜻(접수·실패·모름·연결 못 함)은 domain/testRun.classifyAction 이 붙인다:
//   { kind: 'response', status, text }   응답을 받았다(오류 응답 포함)
//   { kind: 'notSent', cause }            보내기 전에 실패했다 — 이것만 "가지 않았다" 고 말할 수 있다
//   { kind: 'noResponse', cause }         보냈을 수 있는데 응답을 받지 못했다(시간 초과·끊김) — CommandServer 가 받았을 수 있다
// 다시 보내지 않는다(같은 설비에 두 번 실행될 수 있다 — SE-018). 사용자 문구에 주소를 싣지 않는다(로그에도 원인 code 만).

const DEFAULT_URL = 'http://localhost:8080'
const DEFAULT_TIMEOUT_MS = 12000 // InterfaceServer 의 안쪽 10초보다 길게
// 요청을 보내기 전 단계의 실패
const NOT_SENT_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT', 'ERR_INVALID_URL'])

function createActionClient({ env = process.env, fetch = globalThis.fetch, log = null } = {}) {
  function timeoutMs() {
    const raw = env.EARS_ACTION_TIMEOUT_MS
    const ms = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN
    return Number.isFinite(ms) && ms >= 1000 && ms <= 60000 ? ms : DEFAULT_TIMEOUT_MS
  }
  const warn = (kind, cause) => { if (log) log.warn(`시나리오 실행 요청(InterfaceServer /EARS/Action) ${kind} — ${cause}`) }

  // 주소는 부를 때마다 읽는다(시험이 고장 주입 중계로 바꿨다가 되돌린다)
  async function send({ process: proc, model, eqpId, name, line, txn, body }) {
    const base = (typeof env.EARS_INTERFACE_URL === 'string' && env.EARS_INTERFACE_URL.trim()) || DEFAULT_URL
    if (!/^https?:\/\//i.test(base)) { warn('notSent', 'BAD_URL'); return { kind: 'notSent', cause: 'BAD_URL' } }
    try {
      const res = await fetch(`${base.replace(/\/+$/, '')}/EARS/Action`, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'Content-Type': 'application/json', category: 'recovery', process: proc, model, eqpid: eqpId, name, line, txn: String(txn), triggeredBy: 'SE' },
        body,
        signal: AbortSignal.timeout(timeoutMs())
      })
      return { kind: 'response', status: res.status, text: await res.text() }
    } catch (e) {
      // fetch 는 몇몇 포트(1·7·22 …)로는 아예 연결하지 않는다 — code 없이 'bad port' 로 던진다
      const badPort = e && e.cause && e.cause.message === 'bad port'
      const cause = badPort ? 'BAD_PORT' : (e && e.cause && e.cause.code) || (e && e.name) || 'ERROR'
      const kind = badPort || NOT_SENT_CODES.has(cause) ? 'notSent' : 'noResponse'
      warn(kind, cause)
      return { kind, cause }
    }
  }

  return { send, timeoutMs }
}

module.exports = { createActionClient }

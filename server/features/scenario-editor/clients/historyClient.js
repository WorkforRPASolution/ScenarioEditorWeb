'use strict'
// 이력 서버(HttpWebServer) 호출 (P3 설계 §5.6) — `GET /ARS/History/{설비}/{txn}` 하나뿐이다(읽기). 경로를 입력으로 합성하지 않는다.
// 오류를 가른다(이력 보기만 안 되고 나머지 스냅샷 기능은 그대로 — DC-018):
// - 주소가 비어 있음 503 HISTORY_UNSET, 주소 꼴이 틀리거나 연결하지 못함 503 HISTORY_DOWN
// - 시간 초과·응답(본문) 도중 끊김 504 HISTORY_TIMEOUT
// - 500 "There is no data"(보관 15일이 지났거나 기록되지 않음) 404 HISTORY_NOT_FOUND
// - 그 밖의 응답(리다이렉트 포함 — 따라가지 않는다)·한도를 넘는 본문 502 HISTORY_UNREADABLE
// 본문은 흘려 읽으며 바이트를 세고, 한도를 넘는 순간 읽기를 멈춘다 — 길이 머리글이 없는(chunked) 큰 응답이 서버 메모리를 다 쓰지 않게.
// 사용자 문구에는 주소·서버가 준 글을 싣지 않는다 — 로그와 오류의 upstream { status, text } 에만 남긴다.
const { seError } = require('../errors')

const DEFAULT_TIMEOUT_MS = 15000
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024 // 스텝마다 화면 그림이 base64 로 들어 있다 — 서버 메모리를 묶는다
const UPSTREAM_TEXT_MAX = 300
// 요청을 보내기 전 단계의 실패
const NOT_SENT_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT', 'ERR_INVALID_URL'])
const NO_DATA = 'There is no data'
const enc = encodeURIComponent

function createHistoryClient({ env = process.env, fetch = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS, maxBytes = DEFAULT_MAX_BYTES, log = null } = {}) {
  function failure(statusCode, code, message, status, text) {
    const upstream = { status, text: String(text).slice(0, UPSTREAM_TEXT_MAX) }
    if (log) log.warn(`이력 서버(HttpWebServer) ${code} status=${status} ${upstream.text}`)
    return Object.assign(seError(statusCode, code, message), { upstream })
  }
  const down = (status, text) => failure(503, 'HISTORY_DOWN', '이력 서버에 연결하지 못했습니다', status, text)
  const unreadable = (status, text) => failure(502, 'HISTORY_UNREADABLE', '이력 서버의 응답을 읽지 못했습니다', status, text)

  // 본문을 조각마다 읽어 UTF-8 로 풀며 바이트를 센다. 한도를 넘으면 남은 본문을 버리고 던진다.
  async function readCapped(res, status) {
    if (!res.body) return ''
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let bytes = 0
    let out = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return out + decoder.decode()
      bytes += value.byteLength
      if (bytes > maxBytes) {
        reader.cancel().catch(() => {})
        throw unreadable(status, `본문이 한도 ${maxBytes}바이트를 넘습니다`)
      }
      out += decoder.decode(value, { stream: true })
    }
  }

  // 주소는 부를 때마다 읽는다(시험이 고장 주입 중계로 바꿨다가 되돌린다)
  async function fetchHtml(eqpId, txn) {
    const base = typeof env.HTTP_WEB_SERVER_URL === 'string' ? env.HTTP_WEB_SERVER_URL.trim() : ''
    if (!base) throw seError(503, 'HISTORY_UNSET', '이력 서버 주소가 설정되지 않았습니다')
    if (!/^https?:\/\//i.test(base)) throw down(0, 'HTTP_WEB_SERVER_URL 이 http:// 나 https:// 로 시작하지 않습니다')
    let status = 0
    let text
    try {
      const res = await fetch(`${base.replace(/\/+$/, '')}/ARS/History/${enc(eqpId)}/${enc(txn)}`, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) })
      status = res.status
      const length = Number(res.headers.get('content-length'))
      if (Number.isFinite(length) && length > maxBytes) {
        if (res.body) res.body.cancel().catch(() => {})
        throw unreadable(status, `본문 ${length}바이트 — 한도 ${maxBytes}`)
      }
      text = await readCapped(res, status)
    } catch (e) {
      if (e && e.code === 'HISTORY_UNREADABLE') throw e
      const cause = e && e.cause ? ` (${e.cause.code || e.cause.message || e.cause})` : ''
      if (e && e.cause && NOT_SENT_CODES.has(e.cause.code)) throw down(status, `${e}${cause}`)
      throw failure(504, 'HISTORY_TIMEOUT', '이력 서버가 응답하지 않습니다', status, `${e}${cause}`)
    }
    if (status === 200) return text
    if (status === 500 && text.includes(NO_DATA)) throw seError(404, 'HISTORY_NOT_FOUND', '이력이 없습니다. 15일이 지났거나 기록되지 않았습니다')
    throw unreadable(status, text)
  }

  return { fetchHtml }
}

module.exports = { createHistoryClient }

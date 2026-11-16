'use strict'
// Vision·OCR 시험 (P4 설계 §5.2~§5.5) — 편집 중인 스텝의 조건을 판정 서버에 물어 본다. 아무것도 쓰지 않는다.
// 흐름: 입력 검사 → 요청 조립 → 크기 검사 → 자리 잡기 → gRPC 호출(clients/visionClient) → 응답 정리 → 기록.
// - 권한: 등록된 사용자면 된다(WRITE·읽기 전용 서버를 보지 않는다 — 설계 §13.1 ⑥). 사용자 확인은 라우터의 loadUser 가 한다.
// - 크기: 직렬화한 요청이 4 MiB 를 넘으면 보내지 않는다(판정 서버가 거절하고, 그 거절은 10초 뒤 까닭 없는 INTERNAL 로만 온다).
// - 자리: 판정 서버는 실제 설비 복구가 쓰는 서버다. 한꺼번에 도는 시험을 묶고(Vision 은 설정, OCR 은 1 — 판정 서버가 한 번에 하나씩 돈다),
//   사용자 한 명은 한 번에 하나. 넘으면 기다리게 하지 않고 429 — 줄을 세우면 줄 선 시험이 판정 서버의 10초를 물려받는다. 자동 재시도 없음.
//   자리는 이 프로세스 안의 셈이다(서버를 여러 개 띄우면 프로세스마다 따로).
// - 기록: 판정 서버에 간 시험마다 한 줄. 그림·OCR 값·읽은 글은 남기지 않는다. 주소·gRPC details 는 클라이언트의 로그 줄에만 있다.
const { seError } = require('../errors')
const { MAX_REQUEST_BYTES, parseVisionMeta, parseOcrMeta, buildVisionRequest, buildOcrRequest, visionResults, ocrResult, aboutText } = require('../domain/visionTest')

const DEFAULT_VISION_CONCURRENCY = 2
const MAX_VISION_CONCURRENCY = 16
const OCR_CONCURRENCY = 1

function createVisionTestService({ client, env = process.env, log = null, now = () => Date.now() }) {
  const active = { vision: 0, ocr: 0 }
  const users = new Set()

  function limitOf(kind) {
    if (kind === 'ocr') return OCR_CONCURRENCY
    const raw = typeof env.SE_VISION_TEST_CONCURRENCY === 'string' ? env.SE_VISION_TEST_CONCURRENCY.trim() : ''
    const n = /^\d+$/.test(raw) ? Number(raw) : NaN
    return n >= 1 && n <= MAX_VISION_CONCURRENCY ? n : DEFAULT_VISION_CONCURRENCY
  }
  const busy = (scope) => seError(429, 'VISION_BUSY', '다른 시험이 돌고 있습니다', { scope })

  // send = (request, options) → 판정 서버의 답. summarize = (정리한 답) → 로그에 남길 결과 한 토막
  async function run(kind, user, request, about, send, shape, summarize, { signal = null } = {}) {
    const bytes = client.requestBytes(kind, request)
    if (bytes > MAX_REQUEST_BYTES) throw seError(413, 'VISION_TOO_LARGE', '보낼 그림이 너무 큽니다(4MB 까지)', { bytes, maxBytes: MAX_REQUEST_BYTES })
    const id = user.singleid
    if (users.has(id)) throw busy('user')
    if (active[kind] >= limitOf(kind)) throw busy('server')
    users.add(id)
    active[kind] += 1
    const started = now()
    const head = `판정 시험 ${kind} user=${id} about=${aboutText(about)}`
    try {
      const out = shape(await send(request, { signal }))
      const ms = now() - started
      if (log) log.info(`${head} ${summarize(out)} ${ms}ms ${bytes}바이트`)
      return { ...out, ms, bytes }
    } catch (e) {
      const status = e && e.upstream ? ` status=${e.upstream.status}` : ''
      if (log) log.info(`${head} 실패 ${(e && e.code) || 'ERROR'}${status} ${now() - started}ms ${bytes}바이트`)
      throw e
    } finally {
      users.delete(id)
      active[kind] -= 1
    }
  }

  return {
    // { source, train }: 브라우저가 준비한 PNG(검색 영역 조각·찾을 그림). 좌표 보정은 화면이 한다 — 받은 TX·TY 를 그대로 돌려준다.
    async vision(user, { source, train, meta }, options) {
      const { accept, about } = parseVisionMeta(meta)
      const request = buildVisionRequest({ source, train, accept })
      return run('vision', user, request, about, client.requestVision, (res) => ({ results: visionResults(res) }), (out) => `${out.results.length}곳`, options)
    },
    async ocr(user, { source, meta }, options) {
      const parsed = parseOcrMeta(meta)
      const request = buildOcrRequest({ source, ...parsed })
      return run('ocr', user, request, parsed.about, client.requestOcr, ocrResult, (out) => (out.accepted ? '맞음' : '안 맞음'), options)
    }
  }
}

module.exports = { createVisionTestService }

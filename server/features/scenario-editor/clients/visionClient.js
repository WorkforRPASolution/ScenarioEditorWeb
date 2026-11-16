'use strict'
// 판정 시험 gRPC 호출 (P4 설계 §5.1·§7) — InterfaceServer 의 판정 창구(VISION_PORT, 평문 HTTP/2)에 `RequestVision`·`RequestOcr` 둘만 보낸다.
// InterfaceServer 는 이 요청을 ZooKeeper 에 올라온 판정 서버로 중계한다. 값을 검사하거나 바꾸지 않는다.
// 오류를 가른다(Vision·OCR 이 같은 code):
// - 주소가 비어 있음 503 VISION_UNSET
// - 주소 꼴이 틀림 · UNAVAILABLE(14) · 한 번도 연결되지 않은 채 deadline 503 VISION_DOWN(중계 서버에 닿지 못함)
// - INTERNAL(13) 502 VISION_NO_ANSWER — 판정 서버가 없거나, 오류를 냈거나, 10초를 넘기면 InterfaceServer 가 10초 뒤 이 상태만 준다
// - 연결된 채 deadline(4) 504 VISION_TIMEOUT
// - 그 밖의 상태 502 VISION_FAILED
// - 부른 쪽이 끊음(signal) 499 VISION_CANCELLED — gRPC 호출을 취소한다(응답으로 나갈 일은 없다. 서비스가 자리를 비우는 신호)
// 사용자 문구에는 주소·gRPC details 를 싣지 않는다 — 로그와 오류의 upstream { status, details } 에만 남긴다.
// **호출마다 연결을 따로 연다.** InterfaceServer 는 연결 하나의 gRPC 요청을 한 번에 하나씩 처리한다(akka-http 10.1 의 HTTP/2 처리 기본값 —
// 2026-11-16 실측: 같은 연결로 동시에 보낸 두 요청 중 뒤의 것은 앞의 것이 끝난 뒤(판정 서버가 없으면 10초 뒤)에야 시작됐고, 연결을 따로 쓰면 함께 끝났다).
// 연결을 함께 쓰면 늦는 시험 하나가 다른 사용자의 시험을 세우고, 기다리는 동안 그 시험의 deadline 이 지난다.
// 주소는 부를 때마다 읽는다(통합 시험·실측이 주소를 바꾼다).
const path = require('node:path')
const { seError } = require('../errors')

const PROTO_PATH = path.join(__dirname, '../proto/vision.proto')
const PROTO_OPTIONS = { keepCase: true, defaults: true, longs: Number } // 필드 이름이 섞여 있다(sourceImage·AcceptThreshold·TX) — 바꾸지 않는다
const RPC = { vision: 'RequestVision', ocr: 'RequestOcr' }
const DEFAULT_TIMEOUT_MS = 12000 // InterfaceServer 의 10초 + 여유
const DETAILS_MAX = 300
// `호스트:포트` — 스킴·경로 없음. IPv6 는 [::1]:9300 꼴
const ADDR = /^(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9][A-Za-z0-9._-]*):(\d{1,5})$/
const CHANNEL_OPTIONS = {
  'grpc.enable_http_proxy': 0, // 사내 편집기와 같다 — 프록시 환경 변수가 있어도 곧장 붙는다
  'grpc.use_local_subchannel_pool': 1, // 채널마다 제 연결 — 없으면 grpc-js 가 같은 주소의 채널끼리 연결 하나를 나눠 쓴다
  'grpc.initial_reconnect_backoff_ms': 500,
  'grpc.max_reconnect_backoff_ms': 3000
}

function createVisionClient({ env = process.env, grpc = require('@grpc/grpc-js'), protoLoader = require('@grpc/proto-loader'), log = null } = {}) {
  let Stub = null // 처음 쓸 때 proto 를 읽는다
  const open = new Set() // 진행 중인 호출 — { stub, pending }

  const stubClass = () => Stub || (Stub = grpc.loadPackageDefinition(protoLoader.loadSync(PROTO_PATH, PROTO_OPTIONS)).ImageProcesssingGrpcSrv.ImageProcesssingGrpcSrv)

  function failure(statusCode, code, message, status, details) {
    const upstream = { status, details: String(details ?? '').slice(0, DETAILS_MAX) }
    if (log) log.warn(`판정 시험(gRPC) ${code} status=${status} ${upstream.details}`)
    return Object.assign(seError(statusCode, code, message), { upstream })
  }
  const down = (status, details) => failure(503, 'VISION_DOWN', '중계 서버에 연결하지 못했습니다', status, details)

  function address() {
    const addr = typeof env.EARS_INTERFACE_GRPC_ADDR === 'string' ? env.EARS_INTERFACE_GRPC_ADDR.trim() : ''
    if (!addr) throw seError(503, 'VISION_UNSET', '판정 시험 주소가 설정되지 않았습니다')
    const m = ADDR.exec(addr)
    if (!m || Number(m[2]) < 1 || Number(m[2]) > 65535) throw down(0, 'EARS_INTERFACE_GRPC_ADDR 이 `호스트:포트` 꼴이 아닙니다')
    return addr
  }

  function timeoutMs() {
    const raw = typeof env.EARS_INTERFACE_GRPC_TIMEOUT_MS === 'string' ? env.EARS_INTERFACE_GRPC_TIMEOUT_MS.trim() : env.EARS_INTERFACE_GRPC_TIMEOUT_MS
    const n = raw === '' || raw == null ? NaN : Number(raw)
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS
  }

  // 진행 중인 호출을 모두 끊는다(서버가 내려갈 때). 그 호출들은 VISION_CANCELLED 로 끝난다. 뒤에 다시 불러도 된다.
  function close() {
    for (const { pending } of open) pending.cancel()
  }

  function mapError(err, stub) {
    const status = err && Number.isInteger(err.code) ? err.code : grpc.status.UNKNOWN
    const details = (err && (err.details || err.message)) || ''
    const S = grpc.status
    if (status === S.CANCELLED) return Object.assign(seError(499, 'VISION_CANCELLED', '판정 시험을 끊었습니다'), { upstream: { status, details: String(details).slice(0, DETAILS_MAX) } })
    if (status === S.UNAVAILABLE) return down(status, details)
    if (status === S.DEADLINE_EXCEEDED) {
      // 방화벽이 버리는 주소는 UNAVAILABLE 이 아니라 deadline 으로 끝난다 — 연결된 적이 없으면 "연결 못 함" 이다
      const ready = stub.getChannel().getConnectivityState(false) === grpc.connectivityState.READY
      return ready ? failure(504, 'VISION_TIMEOUT', '응답 시간이 초과됐습니다', status, details) : down(status, details)
    }
    if (status === S.INTERNAL) return failure(502, 'VISION_NO_ANSWER', '판정 서버가 10초 안에 답하지 않았습니다. 판정 서버가 없거나, 오류가 났거나, 늦습니다', status, details)
    return failure(502, 'VISION_FAILED', '판정 시험이 실패했습니다', status, details)
  }

  // async — 주소 검사의 실패도 거절된 약속으로 나간다
  async function call(kind, request, { signal = null } = {}) {
    const addr = address()
    if (signal && signal.aborted) throw seError(499, 'VISION_CANCELLED', '판정 시험을 끊었습니다')
    const Ctor = stubClass()
    const stub = new Ctor(addr, grpc.credentials.createInsecure(), CHANNEL_OPTIONS)
    return new Promise((resolve, reject) => {
      let onAbort = null
      const entry = { stub, pending: null }
      entry.pending = stub[RPC[kind]](request, { deadline: new Date(Date.now() + timeoutMs()) }, (err, res) => {
        if (signal && onAbort) signal.removeEventListener('abort', onAbort)
        open.delete(entry)
        const failure = err ? mapError(err, stub) : null // 채널 상태는 닫기 전에 본다
        stub.close()
        if (failure) reject(failure)
        else resolve(res)
      })
      open.add(entry)
      if (signal) {
        onAbort = () => entry.pending.cancel()
        signal.addEventListener('abort', onAbort, { once: true })
      }
    })
  }

  // 직렬화한 요청의 길이 — 손으로 세지 않고 그 RPC 의 직렬화 함수로 만든다(설계 §5.4 의 4 MiB 검사에 쓴다)
  function requestBytes(kind, request) {
    if (!RPC[kind]) throw new Error(`unknown vision rpc kind: ${kind}`)
    return stubClass().service[RPC[kind]].requestSerialize(request).length
  }

  return {
    requestVision: (request, options) => call('vision', request, options),
    requestOcr: (request, options) => call('ocr', request, options),
    requestBytes,
    close
  }
}

module.exports = { createVisionClient, PROTO_PATH, PROTO_OPTIONS }

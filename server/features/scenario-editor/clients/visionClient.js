'use strict'
// 판정 시험 gRPC 호출 (P4 설계 §5.1·§7) — InterfaceServer 의 판정 창구(VISION_PORT, 평문 HTTP/2)에 `RequestVision`·`RequestOcr` 둘만 보낸다.
// InterfaceServer 는 이 요청을 ZooKeeper 에 올라온 판정 서버로 중계한다. 값을 검사하거나 바꾸지 않는다.
// 오류를 가른다(Vision·OCR 이 같은 code):
// - 주소가 비어 있음 503 VISION_UNSET
// - 주소 꼴이 틀림 · UNAVAILABLE(14) · 한 번도 연결되지 않은 채 deadline 503 VISION_DOWN(중계 서버에 닿지 못함)
// - INTERNAL(13) 502 VISION_NO_ANSWER — 판정 서버가 없거나, 오류를 냈거나, 10초를 넘기면 InterfaceServer 가 10초 뒤 이 상태만 준다
// - 연결된 채 deadline(4) 504 VISION_TIMEOUT
// - 그 밖의 상태 502 VISION_FAILED(내가 끊지 않았는데 온 CANCELLED 포함)
// - 부른 쪽이 끊음(signal·close) 499 VISION_CANCELLED — gRPC 호출을 취소한다(응답으로 나갈 일은 없다)
// 사용자 문구에는 주소·gRPC details 를 싣지 않는다 — 로그와 오류의 upstream { status, details } 에만 남긴다.
//
// **연결 하나에는 한 번에 호출 하나만 보낸다.** InterfaceServer 는 연결 하나의 gRPC 요청을 한 번에 하나씩 처리한다(akka-http 10.1 의 HTTP/2 처리 기본값 —
// 2026-11-16 실측: 같은 연결로 동시에 보낸 두 요청 중 뒤의 것은 앞의 것이 끝난 뒤(판정 서버가 없으면 10초 뒤)에야 시작됐고, 연결을 따로 쓰면 함께 끝났다).
// 연결을 함께 쓰면 늦는 시험 하나가 다른 사용자의 시험을 세우고, 기다리는 동안 그 시험의 deadline 이 지난다.
// 그래서 채널(연결)을 호출마다 하나씩 쥐고, 끝나면 쉬는 채널로 돌려 다음 호출이 다시 쓴다:
// - 답을 받은 채널만 돌려놓는다. deadline 을 넘겼거나 내가 끊은 호출의 채널은 닫는다 — InterfaceServer 는 끊긴 요청도 끝까지 처리하고 그동안 그 연결의 다음 요청을 세운다.
// - 연결되지 않은 채 deadline 을 넘긴 채널은 돌려놓는다 — grpc-js 는 연결 중인 채널을 닫아도 그 소켓을 끊지 않아, 닫고 새로 만들면
//   답 없는 주소(방화벽이 버리는 주소·gRPC 가 아닌 포트)에 시험할 때마다 소켓이 하나씩 남는다. 같은 채널이 같은 연결 시도를 이어 간다.
// - UNAVAILABLE(연결 거절)은 닫는다 — 다음 호출이 다시 붙기 대기 없이 새로 붙는다.
// 주소는 부를 때마다 읽는다(통합 시험·실측이 주소를 바꾼다). 주소가 바뀌면 앞 주소의 쉬는 채널을 닫는다.
const path = require('node:path')
const { seError } = require('../errors')

const PROTO_PATH = path.join(__dirname, '../proto/vision.proto')
const PROTO_OPTIONS = { keepCase: true, defaults: true, longs: Number } // 필드 이름이 섞여 있다(sourceImage·AcceptThreshold·TX) — 바꾸지 않는다
const RPC = { vision: 'RequestVision', ocr: 'RequestOcr' }
const DEFAULT_TIMEOUT_MS = 12000 // InterfaceServer 의 10초 + 여유(실측: INTERNAL 은 10.03~10.11초에 온다)
const MIN_TIMEOUT_MS = 1000 // 초 단위로 잘못 적은 값(12)이 12ms 가 되지 않게
const MAX_TIMEOUT_MS = 120000
const DETAILS_MAX = 300
// `호스트:포트` — 스킴·경로 없음. IPv6 는 [::1]:9300 꼴
const ADDR = /^(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9][A-Za-z0-9._-]*):(\d{1,5})$/
const CHANNEL_OPTIONS = {
  'grpc.enable_http_proxy': 0, // 사내 편집기와 같다 — 프록시 환경 변수가 있어도 곧장 붙는다
  'grpc.use_local_subchannel_pool': 1, // 채널마다 제 연결 — 없으면 grpc-js 가 같은 주소의 채널끼리 연결 하나를 나눠 쓴다
  'grpc.initial_reconnect_backoff_ms': 500,
  'grpc.max_reconnect_backoff_ms': 3000
}

// timeoutMs: 시험이 짧은 시간 제한을 줄 때만 쓴다(주면 환경 변수를 보지 않는다)
function createVisionClient({ env = process.env, grpc = require('@grpc/grpc-js'), protoLoader = require('@grpc/proto-loader'), log = null, timeoutMs = null } = {}) {
  let Stub = null // 처음 쓸 때 proto 를 읽는다
  let pool = null // { addr, idle: [stub] } — 지금 주소의 쉬는 채널
  const open = new Set() // 진행 중인 호출 — { pending, byUs }

  const stubClass = () => Stub || (Stub = grpc.loadPackageDefinition(protoLoader.loadSync(PROTO_PATH, PROTO_OPTIONS)).ImageProcesssingGrpcSrv.ImageProcesssingGrpcSrv)

  function failure(statusCode, code, message, status, details) {
    const upstream = { status, details: String(details ?? '').slice(0, DETAILS_MAX) }
    if (log) log.warn(`판정 시험(gRPC) ${code} status=${status} ${upstream.details}`)
    return Object.assign(seError(statusCode, code, message), { upstream })
  }
  const down = (status, details) => failure(503, 'VISION_DOWN', '중계 서버에 연결하지 못했습니다', status, details)
  const cancelled = () => seError(499, 'VISION_CANCELLED', '판정 시험을 끊었습니다')

  function address() {
    const addr = typeof env.EARS_INTERFACE_GRPC_ADDR === 'string' ? env.EARS_INTERFACE_GRPC_ADDR.trim() : ''
    if (!addr) throw seError(503, 'VISION_UNSET', '판정 시험 주소가 설정되지 않았습니다')
    const m = ADDR.exec(addr)
    if (!m || Number(m[2]) < 1 || Number(m[2]) > 65535) throw down(0, 'EARS_INTERFACE_GRPC_ADDR 이 `호스트:포트` 꼴이 아닙니다')
    return addr
  }

  function deadlineMs() {
    if (timeoutMs !== null) return timeoutMs
    const raw = typeof env.EARS_INTERFACE_GRPC_TIMEOUT_MS === 'string' ? env.EARS_INTERFACE_GRPC_TIMEOUT_MS.trim() : ''
    const n = /^\d+$/.test(raw) ? Number(raw) : NaN
    return n >= MIN_TIMEOUT_MS && n <= MAX_TIMEOUT_MS ? n : DEFAULT_TIMEOUT_MS
  }

  function dropPool() {
    if (!pool) return
    const { idle } = pool
    pool = null
    for (const stub of idle) stub.close()
  }
  // 진행 중인 호출을 모두 끊고 쉬는 채널을 닫는다(서버가 내려갈 때). 그 호출들은 VISION_CANCELLED 로 끝난다. 뒤에 다시 불러도 된다.
  function close() {
    for (const entry of open) {
      entry.byUs = true
      entry.pending.cancel()
    }
    dropPool()
  }

  function acquire(addr) {
    if (!pool || pool.addr !== addr) {
      dropPool()
      pool = { addr, idle: [] }
    }
    const Ctor = stubClass()
    return { home: pool, stub: pool.idle.pop() || new Ctor(addr, grpc.credentials.createInsecure(), CHANNEL_OPTIONS) }
  }
  // reusable: 이 채널을 다음 호출이 써도 되는가(머리 주석). 주소가 바뀌었거나 close() 뒤면 닫는다.
  function release({ home, stub }, reusable) {
    if (reusable && pool === home) home.idle.push(stub)
    else stub.close()
  }

  // { error, reusable } — error 는 던질 오류, reusable 은 채널을 돌려놓아도 되는가
  function mapError(err, stub, byUs) {
    const S = grpc.status
    const status = err && Number.isInteger(err.code) ? err.code : S.UNKNOWN
    const details = (err && (err.details || err.message)) || ''
    if (status === S.CANCELLED && byUs) return { error: Object.assign(cancelled(), { upstream: { status, details: String(details).slice(0, DETAILS_MAX) } }), reusable: false }
    if (status === S.UNAVAILABLE) return { error: down(status, details), reusable: false }
    if (status === S.DEADLINE_EXCEEDED) {
      // 방화벽이 버리는 주소는 UNAVAILABLE 이 아니라 deadline 으로 끝난다 — 연결된 적이 없으면 "연결 못 함" 이다
      const ready = stub.getChannel().getConnectivityState(false) === grpc.connectivityState.READY
      return ready
        ? { error: failure(504, 'VISION_TIMEOUT', '응답 시간이 초과됐습니다', status, details), reusable: false }
        : { error: down(status, details), reusable: true }
    }
    if (status === S.INTERNAL) return { error: failure(502, 'VISION_NO_ANSWER', '판정 서버가 10초 안에 답하지 않았습니다. 판정 서버가 없거나, 오류가 났거나, 늦습니다', status, details), reusable: true }
    // 내가 끊지 않은 CANCELLED 는 서버·중계가 끊은 것이다 — 그 연결을 다시 쓰지 않는다
    return { error: failure(502, 'VISION_FAILED', '판정 시험이 실패했습니다', status, details), reusable: status !== S.CANCELLED }
  }

  // async — 주소 검사의 실패도 거절된 약속으로 나간다
  async function call(kind, request, { signal = null } = {}) {
    const addr = address()
    if (signal && signal.aborted) throw cancelled()
    const lease = acquire(addr)
    return new Promise((resolve, reject) => {
      const entry = { pending: null, byUs: false }
      const onAbort = () => { entry.byUs = true; entry.pending.cancel() }
      entry.pending = lease.stub[RPC[kind]](request, { deadline: new Date(Date.now() + deadlineMs()) }, (err, res) => {
        if (signal) signal.removeEventListener('abort', onAbort)
        open.delete(entry)
        if (!err) {
          release(lease, true)
          resolve(res)
          return
        }
        const { error, reusable } = mapError(err, lease.stub, entry.byUs) // 채널 상태는 닫기 전에 본다
        release(lease, reusable)
        reject(error)
      })
      open.add(entry)
      if (signal) signal.addEventListener('abort', onAbort, { once: true })
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

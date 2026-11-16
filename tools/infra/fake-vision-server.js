'use strict'
// 흉내 판정 서버 (P4 설계 §10) — 사내 판정 서버(ARSImageProcessingSrv·ARSOCRProcessingSrv, Windows 전용)의 자리에 서는 시험용 gRPC 서버.
// 호스트의 포트 하나에서 Vision(RequestVision)·OCR(RequestOcr)을 함께 받는다(같은 서비스다). 시험이 직접 띄우고 내린다.
// 응답 규칙은 fake-vision-rules.js — Vision 은 똑같은 픽셀 찾기(점수 1), OCR 은 제어 값의 줄을 사내 규칙으로 판정.
// 제어(set): delayMs(늦게 답하기) · error { code, details }(gRPC 오류) · visionResults(정해 둔 결과) · ocrLines·ocrConfidence(읽은 줄).
// 4 MiB 를 넘는 요청은 grpc-js 서버의 수신 기본값이 거절한다(RESOURCE_EXHAUSTED) — 사내 C# 판정 서버(Grpc.Core 기본값)와 같다.
// withJudge: 흉내를 띄우고 전용 ZooKeeper 의 두 경로에 노드를 만든다 — InterfaceServer 가 판정 요청을 이리로 중계한다.
//   띄울 때마다 다른 포트(0)를 쓰고, 내릴 때 노드를 지운다. 지워지지 않는 노드를 두지 않는다.
//   InterfaceServer 컨테이너는 host.docker.internal 로 호스트 루프백의 이 포트에 닿는다(OrbStack, 2026-11-16 확인).
const path = require('node:path')
const grpc = require('@grpc/grpc-js')
const protoLoader = require('@grpc/proto-loader')
const { findExact, judgeOcr } = require('./fake-vision-rules')
const { createIsZk } = require('./is-zk')

// proto 는 서버의 사본 하나만 둔다(InterfaceServer 것과 바이트가 같다 — server 의 visionProto 시험이 본다)
const PROTO_PATH = path.join(__dirname, '../../server/features/scenario-editor/proto/vision.proto')
const DEFAULTS = { delayMs: 0, error: null, visionResults: null, ocrLines: ['READY'], ocrConfidence: 95 }
const NOTICE_MS = 500 // InterfaceServer 가 새 노드를 알아채 중계 대상을 만드는 시간(실측 수 ms)

async function startFakeVisionServer({ host = '127.0.0.1', port = 0 } = {}) {
  const service = grpc.loadPackageDefinition(protoLoader.loadSync(PROTO_PATH, { keepCase: true, defaults: true, longs: Number })).ImageProcesssingGrpcSrv.ImageProcesssingGrpcSrv.service
  let control = { ...DEFAULTS }
  const calls = []

  // 기록하고, 늦추고, 오류 제어를 본 뒤 answer() 의 답을 보낸다. answer 가 던지면 UNKNOWN(판정 서버의 처리기 예외)
  function handle(rpc, bytesOf, answer) {
    return (call, callback) => {
      const rec = { rpc, bytes: bytesOf(call.request), param: call.request.param, cancelled: false }
      calls.push(rec)
      // grpc-js 는 답을 보낸 뒤 스트림이 닫힐 때도 'cancelled' 를 낸다 — 답하기 전에 끊긴 것만 센다
      let answered = false
      call.on('cancelled', () => { if (!answered) rec.cancelled = true })
      const now = control
      const reply = () => {
        if (rec.cancelled) return
        answered = true
        if (now.error) return callback({ code: now.error.code, details: now.error.details ?? '' })
        try {
          callback(null, answer(call.request, now))
        } catch (e) {
          callback({ code: grpc.status.UNKNOWN, details: 'Exception was thrown by handler.' })
        }
      }
      if (now.delayMs > 0) setTimeout(reply, now.delayMs)
      else reply()
    }
  }
  const unimplemented = (call, callback) => callback({ code: grpc.status.UNIMPLEMENTED, details: '' })

  const server = new grpc.Server()
  server.addService(service, {
    RequestVision: handle('RequestVision', (r) => r.sourceImage.length + r.trainImage.length, (r, c) => {
      if (c.visionResults) return { searchmaxResult: c.visionResults }
      if (r.param && r.param.AcceptThreshold > 1) return { searchmaxResult: [] }
      return { searchmaxResult: findExact(r.sourceImage, r.trainImage).map(({ x, y }) => ({ success: true, Score: 1, TX: x, TY: y })) }
    }),
    RequestOcr: handle('RequestOcr', (r) => r.sourceImage.length, (r, c) => judgeOcr(r.param || {}, c.ocrLines, c.ocrConfidence)),
    RequestConditionCheck: unimplemented,
    RequestConditionCheckOcr: unimplemented,
    RequestOcrResult: unimplemented
  })
  const bound = await new Promise((resolve, reject) => {
    server.bindAsync(`${host}:${port}`, grpc.ServerCredentials.createInsecure(), (err, p) => (err ? reject(err) : resolve(p)))
  })

  return {
    port: bound,
    calls,
    set(partial) { control = { ...control, ...partial } },
    reset() { control = { ...DEFAULTS }; calls.length = 0 },
    async stop() { server.forceShutdown() }
  }
}

// 흉내를 띄우고 InterfaceServer 가 중계하도록 ZooKeeper 노드를 만든다. kinds 로 한쪽만 올릴 수 있다(예: OCR 판정 서버만 없는 상태).
async function withJudge({ zk = createIsZk(), advertiseHost = 'host.docker.internal', kinds = ['vision', 'ocr'], noticeMs = NOTICE_MS } = {}) {
  const fake = await startFakeVisionServer()
  const address = `${advertiseHost}:${fake.port}`
  let stopped = false
  async function stop() {
    if (stopped) return
    stopped = true
    try {
      for (const kind of kinds) await zk.remove(kind, address)
    } finally {
      await fake.stop()
    }
  }
  try {
    for (const kind of kinds) await zk.add(kind, address)
    for (const kind of kinds) {
      if (!(await zk.list(kind)).includes(address)) throw new Error(`judge node not registered: ${kind} ${address}`)
    }
    if (noticeMs > 0) await new Promise((resolve) => setTimeout(resolve, noticeMs))
  } catch (e) {
    await stop().catch(() => {})
    throw e
  }
  return { fake, address, stop }
}

module.exports = { startFakeVisionServer, withJudge, PROTO_PATH }

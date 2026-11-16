// 판정 시험 gRPC 클라이언트 — InterfaceServer 의 판정 창구(RequestVision·RequestOcr)를 부르고 gRPC 상태를 오류 code 로 바꾼다 (P4 설계 §5.1·§7)
// 시험마다 이 자리에서 grpc-js 서버를 127.0.0.1 의 빈 포트에 띄운다(처리기는 시험이 정한다).
import { describe, it, expect, afterEach } from 'vitest'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
const require = createRequire(import.meta.url)
const grpc = require('@grpc/grpc-js')
const protoLoader = require('@grpc/proto-loader')
const { createVisionClient, PROTO_PATH } = require('../clients/visionClient')

const pkg = grpc.loadPackageDefinition(protoLoader.loadSync(PROTO_PATH, { keepCase: true, defaults: true, longs: Number }))
const SERVICE = pkg.ImageProcesssingGrpcSrv.ImageProcesssingGrpcSrv.service
const closers = []
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close()
})

// handlers = { RequestVision(call, callback), RequestOcr(call, callback) } — 없는 것은 UNIMPLEMENTED
async function serve(handlers) {
  const server = new grpc.Server()
  const unimplemented = (call, callback) => callback({ code: grpc.status.UNIMPLEMENTED, details: 'not here' })
  server.addService(SERVICE, {
    RequestConditionCheck: unimplemented, RequestConditionCheckOcr: unimplemented, RequestOcrResult: unimplemented,
    RequestVision: unimplemented, RequestOcr: unimplemented, ...handlers
  })
  const port = await new Promise((resolve, reject) => {
    server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (err, p) => (err ? reject(err) : resolve(p)))
  })
  closers.push(() => server.forceShutdown())
  return { port, addr: `127.0.0.1:${port}`, server }
}
// 서버에 열려 있는 HTTP/2 연결 수(grpc-js 서버의 채널 정보)
function openSessions(server) {
  const info = grpc.getChannelzHandlers().GetServerSockets
  return new Promise((resolve) => {
    info({ request: { server_id: server.getChannelzRef().id, start_socket_id: 0, max_results: 100 } }, (err, res) => resolve(err ? -1 : res.socket_ref.length))
  })
}
// 듣기만 하고 아무 말도 하지 않는 TCP 서버(방화벽이 버리는 주소처럼 HTTP/2 가 시작되지 않는다)
async function silentTcp() {
  const sockets = new Set()
  const server = createServer((s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); s.on('error', () => {}) })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  closers.push(() => new Promise((resolve) => { for (const s of sockets) s.destroy(); server.close(() => resolve()) }))
  return `127.0.0.1:${server.address().port}`
}
// 방금까지 쓰이던 포트를 닫아 "아무도 듣지 않는 포트" 를 얻는다
async function closedPort() {
  const server = createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  await new Promise((resolve) => server.close(() => resolve()))
  return `127.0.0.1:${port}`
}
function make(env) {
  const logs = []
  const client = createVisionClient({ env, log: { warn: (m) => logs.push(m) } })
  closers.push(() => client.close())
  return { client, logs }
}
const caught = async (p) => { try { await p } catch (e) { return e } throw new Error('던지지 않았다') }

const VISION_REQ = {
  sourceImage: Buffer.alloc(1000, 7), trainImage: Buffer.alloc(300, 9),
  param: { AcceptThreshold: 0.85, MaximumNumberToFind: 20, Timeout: 2000, TimeoutEnabled: true }
}
const OCR_REQ = {
  sourceImage: Buffer.from('ocr-image'),
  param: { OcrValueType: 1, OcrOperation: 3, TextValue: 'READY@@@@2-1', MinMatchingValue: 10, NumberValue: 0, NumberRangeMin: 0, NumberRangeMax: 0 }
}

describe('visionClient — 주고받기', () => {
  it('RequestVision: 그림 둘과 param 넷을 그대로 보내고, 찾은 곳(점수·소수 좌표)을 그대로 받는다', async () => {
    const seen = []
    const { addr } = await serve({
      RequestVision(call, callback) {
        seen.push(call.request)
        callback(null, { searchmaxResult: [{ success: true, Score: 0.9731, TX: 12.5, TY: 40 }, { success: true, Score: 0.91, TX: 300, TY: 7.25 }] })
      }
    })
    const { client } = make({ EARS_INTERFACE_GRPC_ADDR: addr })
    const out = await client.requestVision(VISION_REQ)
    expect(out).toEqual({ searchmaxResult: [{ success: true, Score: 0.9731, TX: 12.5, TY: 40 }, { success: true, Score: 0.91, TX: 300, TY: 7.25 }] })
    expect(seen).toHaveLength(1)
    expect(Buffer.from(seen[0].sourceImage).equals(VISION_REQ.sourceImage)).toBe(true)
    expect(Buffer.from(seen[0].trainImage).equals(VISION_REQ.trainImage)).toBe(true)
    expect(seen[0].param).toEqual(VISION_REQ.param)
  })

  it('RequestVision: 못 찾으면 빈 목록이다', async () => {
    const { addr } = await serve({ RequestVision: (call, callback) => callback(null, {}) })
    const { client } = make({ EARS_INTERFACE_GRPC_ADDR: addr })
    expect(await client.requestVision(VISION_REQ)).toEqual({ searchmaxResult: [] })
  })

  it('RequestOcr: param 일곱을 그대로 보내고 응답 다섯 필드를 받는다', async () => {
    const seen = []
    const { addr } = await serve({
      RequestOcr(call, callback) {
        seen.push(call.request)
        callback(null, { IsAccepted: true, FoundResult: 'READY @@ READY 2', Confidence: ':98:97:99', TX: 0, TY: 0 })
      }
    })
    const { client } = make({ EARS_INTERFACE_GRPC_ADDR: addr })
    expect(await client.requestOcr(OCR_REQ)).toEqual({ IsAccepted: true, FoundResult: 'READY @@ READY 2', Confidence: ':98:97:99', TX: 0, TY: 0 })
    expect(Buffer.from(seen[0].sourceImage).equals(OCR_REQ.sourceImage)).toBe(true)
    expect(seen[0].param).toEqual(OCR_REQ.param)
  })

  it('주소는 부를 때마다 읽는다 — 바꾸면 새 서버로 가고, close() 뒤에도 다시 부르면 된다', async () => {
    const a = await serve({ RequestVision: (call, callback) => callback(null, { searchmaxResult: [{ success: true, Score: 1, TX: 1, TY: 1 }] }) })
    const b = await serve({ RequestVision: (call, callback) => callback(null, { searchmaxResult: [{ success: true, Score: 1, TX: 2, TY: 2 }] }) })
    const env = { EARS_INTERFACE_GRPC_ADDR: a.addr }
    const { client } = make(env)
    expect((await client.requestVision(VISION_REQ)).searchmaxResult[0].TX).toBe(1)
    env.EARS_INTERFACE_GRPC_ADDR = ` ${b.addr} `
    expect((await client.requestVision(VISION_REQ)).searchmaxResult[0].TX).toBe(2)
    client.close()
    expect((await client.requestVision(VISION_REQ)).searchmaxResult[0].TX).toBe(2)
  })
})

describe('visionClient — 연결', () => {
  // InterfaceServer 는 연결 하나의 요청을 한 번에 하나씩 처리한다(2026-11-16 실측 — 같은 연결의 두 번째 요청은 앞의 것이 끝나야 시작된다).
  // 그래서 호출마다 연결을 따로 연다 — 늦는 시험 하나가 다른 시험을 세우지 않게.
  it('동시에 부른 호출은 서로 다른 연결로 간다', async () => {
    const peers = []
    let release
    const gate = new Promise((resolve) => { release = resolve })
    const { addr } = await serve({
      RequestVision(call, callback) { peers.push(call.getPeer()); gate.then(() => callback(null, {})) },
      RequestOcr(call, callback) { peers.push(call.getPeer()); gate.then(() => callback(null, {})) }
    })
    const { client } = make({ EARS_INTERFACE_GRPC_ADDR: addr })
    const all = Promise.all([client.requestVision(VISION_REQ), client.requestVision(VISION_REQ), client.requestOcr(OCR_REQ)])
    await expect.poll(() => peers.length).toBe(3)
    release()
    await all
    expect(new Set(peers).size).toBe(3)
  })

  it('호출이 끝나면 그 연결을 닫는다 — 서버에 연결이 쌓이지 않는다', async () => {
    const { addr, server } = await serve({ RequestVision: (call, callback) => callback(null, {}) })
    const { client } = make({ EARS_INTERFACE_GRPC_ADDR: addr })
    for (let i = 0; i < 5; i++) await client.requestVision(VISION_REQ)
    await expect.poll(() => openSessions(server)).toBe(0)
  })

  it('close() 는 진행 중인 호출을 끊는다 — VISION_CANCELLED 로 끝난다(매달리지 않는다)', async () => {
    let arrived
    const onArrive = new Promise((resolve) => { arrived = resolve })
    const { addr } = await serve({ RequestVision: () => arrived() })
    const { client } = make({ EARS_INTERFACE_GRPC_ADDR: addr })
    const pending = caught(client.requestVision(VISION_REQ))
    await onArrive
    client.close()
    const e = await pending
    expect(e.code).toBe('VISION_CANCELLED')
  })
})

describe('visionClient — 오류를 가른다', () => {
  it('주소가 비면 503 VISION_UNSET — 서버를 부르지 않는다', async () => {
    let hits = 0
    await serve({ RequestVision: (call, callback) => { hits += 1; callback(null, {}) } })
    for (const env of [{}, { EARS_INTERFACE_GRPC_ADDR: '' }, { EARS_INTERFACE_GRPC_ADDR: '   ' }]) {
      const e = await caught(make(env).client.requestVision(VISION_REQ))
      expect([e.statusCode, e.code]).toEqual([503, 'VISION_UNSET'])
    }
    expect(hits).toBe(0)
  })

  it('주소 꼴이 `호스트:포트` 가 아니면 503 VISION_DOWN — 문구에 값을 싣지 않는다', async () => {
    for (const bad of ['http://10.1.2.3:9300', '10.1.2.3', '10.1.2.3:0', '10.1.2.3:70000', '10.1.2.3:9300/x', 'a b:9300']) {
      const { client, logs } = make({ EARS_INTERFACE_GRPC_ADDR: bad })
      const e = await caught(client.requestOcr(OCR_REQ))
      expect([e.statusCode, e.code], bad).toEqual([503, 'VISION_DOWN'])
      expect(e.message).not.toContain('10.1.2.3')
      expect(logs.join('\n')).toContain('EARS_INTERFACE_GRPC_ADDR')
    }
  })

  it('아무도 듣지 않는 포트 → 503 VISION_DOWN, gRPC 상태 14 는 upstream 과 로그에만', async () => {
    const addr = await closedPort()
    const { client, logs } = make({ EARS_INTERFACE_GRPC_ADDR: addr })
    const e = await caught(client.requestVision(VISION_REQ))
    expect([e.statusCode, e.code]).toEqual([503, 'VISION_DOWN'])
    expect(e.upstream.status).toBe(grpc.status.UNAVAILABLE)
    expect(e.message).toBe('중계 서버에 연결하지 못했습니다')
    expect(e.message).not.toContain('127.0.0.1')
    expect(e.details ?? null).toBeNull()
    expect(logs).toHaveLength(1)
    expect(logs[0]).toContain('VISION_DOWN')
    expect(logs[0]).toContain('status=14')
  })

  it('INTERNAL(13) → 502 VISION_NO_ANSWER', async () => {
    const { addr } = await serve({ RequestVision: (call, callback) => callback({ code: grpc.status.INTERNAL, details: '' }) })
    const e = await caught(make({ EARS_INTERFACE_GRPC_ADDR: addr }).client.requestVision(VISION_REQ))
    expect([e.statusCode, e.code]).toEqual([502, 'VISION_NO_ANSWER'])
    expect(e.upstream.status).toBe(13)
    expect(e.message).toContain('판정 서버가 10초 안에 답하지 않았습니다')
  })

  it('연결은 됐는데 deadline 을 넘김 → 504 VISION_TIMEOUT', async () => {
    const { addr } = await serve({ RequestOcr: (call, callback) => { setTimeout(() => callback(null, {}), 2000).unref() } })
    const { client } = make({ EARS_INTERFACE_GRPC_ADDR: addr, EARS_INTERFACE_GRPC_TIMEOUT_MS: '300' })
    const started = Date.now()
    const e = await caught(client.requestOcr(OCR_REQ))
    expect([e.statusCode, e.code]).toEqual([504, 'VISION_TIMEOUT'])
    expect(e.upstream.status).toBe(grpc.status.DEADLINE_EXCEEDED)
    expect(Date.now() - started).toBeLessThan(1500)
  })

  it('한 번도 연결되지 않은 채 deadline 을 넘김(답 없는 주소) → 503 VISION_DOWN', async () => {
    const addr = await silentTcp()
    const { client } = make({ EARS_INTERFACE_GRPC_ADDR: addr, EARS_INTERFACE_GRPC_TIMEOUT_MS: '400' })
    const e = await caught(client.requestVision(VISION_REQ))
    expect([e.statusCode, e.code]).toEqual([503, 'VISION_DOWN'])
    expect(e.upstream.status).toBe(grpc.status.DEADLINE_EXCEEDED)
  })

  it('그 밖의 gRPC 상태 → 502 VISION_FAILED, details 는 300자까지 upstream 에만', async () => {
    const { addr } = await serve({ RequestVision: (call, callback) => callback({ code: grpc.status.INVALID_ARGUMENT, details: 'x'.repeat(1000) }) })
    const e = await caught(make({ EARS_INTERFACE_GRPC_ADDR: addr }).client.requestVision(VISION_REQ))
    expect([e.statusCode, e.code]).toEqual([502, 'VISION_FAILED'])
    expect(e.upstream).toEqual({ status: grpc.status.INVALID_ARGUMENT, details: 'x'.repeat(300) })
    expect(e.message).toBe('판정 시험이 실패했습니다')
  })

  it('시간 제한 값이 틀리면(글자·0·음수) 기본 12초를 쓴다 — 바로 끝나지 않는다', async () => {
    const { addr } = await serve({ RequestVision: (call, callback) => { setTimeout(() => callback(null, {}), 150) } })
    for (const bad of ['abc', '0', '-5', '']) {
      const { client } = make({ EARS_INTERFACE_GRPC_ADDR: addr, EARS_INTERFACE_GRPC_TIMEOUT_MS: bad })
      expect(await client.requestVision(VISION_REQ)).toEqual({ searchmaxResult: [] })
    }
  })
})

describe('visionClient — 끊기', () => {
  it('signal 을 끊으면 gRPC 호출을 취소한다 — 499 VISION_CANCELLED 로 끝나고 서버가 취소를 본다', async () => {
    let arrived
    const onArrive = new Promise((resolve) => { arrived = resolve })
    let sawCancel
    const cancelled = new Promise((resolve) => { sawCancel = resolve })
    const { addr } = await serve({ RequestVision: (call) => { call.on('cancelled', () => sawCancel(true)); arrived() } })
    const { client, logs } = make({ EARS_INTERFACE_GRPC_ADDR: addr })
    const ac = new AbortController()
    const pending = caught(client.requestVision(VISION_REQ, { signal: ac.signal }))
    await onArrive
    ac.abort()
    const e = await pending
    expect([e.statusCode, e.code]).toEqual([499, 'VISION_CANCELLED'])
    expect(await cancelled).toBe(true)
    expect(logs).toEqual([]) // 끊은 것은 고장이 아니다
  })

  it('이미 끊긴 signal 이면 보내지 않는다', async () => {
    let hits = 0
    const { addr } = await serve({ RequestVision: (call, callback) => { hits += 1; callback(null, {}) } })
    const e = await caught(make({ EARS_INTERFACE_GRPC_ADDR: addr }).client.requestVision(VISION_REQ, { signal: AbortSignal.abort() }))
    expect(e.code).toBe('VISION_CANCELLED')
    expect(hits).toBe(0)
  })
})

describe('visionClient.requestBytes — 직렬화한 요청의 길이', () => {
  const { client } = make({})
  it('Vision: 그림 둘 + 머리(필드 꼬리표·길이) + param 24바이트', () => {
    // sourceImage 1+2+1000, trainImage 1+2+300, param 1+1+(9+2+9+2)
    expect(client.requestBytes('vision', VISION_REQ)).toBe(1003 + 303 + 24)
  })
  it('4 MiB 를 넘는 요청도 센다(주소가 없어도 된다)', () => {
    const big = { ...VISION_REQ, sourceImage: Buffer.alloc(4 * 1024 * 1024) }
    expect(client.requestBytes('vision', big)).toBe(1 + 4 + 4 * 1024 * 1024 + 303 + 24)
  })
  it('OCR: 그림 + param(글 값은 UTF-8 바이트 수)', () => {
    const a = client.requestBytes('ocr', OCR_REQ)
    const b = client.requestBytes('ocr', { ...OCR_REQ, param: { ...OCR_REQ.param, TextValue: `${OCR_REQ.param.TextValue}가` } })
    expect(b - a).toBe(3)
  })
  it('모르는 종류는 던진다', () => {
    expect(() => client.requestBytes('other', {})).toThrow()
  })
})

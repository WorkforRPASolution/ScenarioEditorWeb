// 흉내 판정 서버(P4 설계 §10) — 호스트의 한 포트에서 Vision·OCR 을 함께 받는다. InterfaceServer 없이 gRPC 로 직접 불러 본다.
import { describe, it, expect, afterEach } from 'vitest'
import { createRequire } from 'node:module'
import { connect } from 'node:net'
const require = createRequire(import.meta.url)
const grpc = require('@grpc/grpc-js')
const protoLoader = require('@grpc/proto-loader')
const { PNG } = require('pngjs')
const { startFakeVisionServer, PROTO_PATH } = require('../fake-vision-server')

const Stub = grpc.loadPackageDefinition(protoLoader.loadSync(PROTO_PATH, { keepCase: true, defaults: true, longs: Number })).ImageProcesssingGrpcSrv.ImageProcesssingGrpcSrv
const closers = []
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close()
})
async function start() {
  const fake = await startFakeVisionServer()
  closers.push(() => fake.stop())
  const stub = new Stub(`127.0.0.1:${fake.port}`, grpc.credentials.createInsecure(), { 'grpc.enable_http_proxy': 0 })
  closers.push(() => stub.close())
  const rpc = (name, request, deadlineMs = 5000) => new Promise((resolve) => {
    const call = stub[name](request, { deadline: new Date(Date.now() + deadlineMs) }, (err, res) => resolve({ err, res, call }))
    rpc.last = call
  })
  return { fake, rpc }
}

function canvas(w, h) {
  const png = new PNG({ width: w, height: h })
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) png.data.set([(x * 7 + y * 13) % 256, (x * 3 + y * 29) % 256, (x + y * 5) % 256, 255], (y * w + x) * 4)
  return png
}
function crop(png, x0, y0, w, h) {
  const out = new PNG({ width: w, height: h })
  PNG.bitblt(png, out, x0, y0, w, h, 0, 0)
  return out
}
const SCREEN = canvas(80, 50)
const SOURCE = PNG.sync.write(SCREEN)
const TRAIN = PNG.sync.write(crop(SCREEN, 21, 13, 16, 10))
const PARAM = { AcceptThreshold: 0.9, MaximumNumberToFind: 20, Timeout: 2000, TimeoutEnabled: true }
const OCR = (extra) => ({ sourceImage: SOURCE, param: { OcrValueType: 1, OcrOperation: 1, TextValue: 'READY', MinMatchingValue: 10, NumberValue: 0, NumberRangeMin: 0, NumberRangeMax: 0, ...extra } })

describe('흉내 판정 서버 — Vision', () => {
  it('화면 조각 안의 똑같은 그림을 찾아 왼쪽 위 좌표·점수 1 로 답한다', async () => {
    const { fake, rpc } = await start()
    const { err, res } = await rpc('RequestVision', { sourceImage: SOURCE, trainImage: TRAIN, param: PARAM })
    expect(err).toBeNull()
    expect(res.searchmaxResult).toEqual([{ success: true, Score: 1, TX: 21, TY: 13 }])
    expect(fake.calls).toEqual([{ rpc: 'RequestVision', bytes: SOURCE.length + TRAIN.length, param: PARAM, cancelled: false }])
  })
  it('없는 그림·정확도가 1 보다 큼·PNG 아님은 0건이다(오류가 아니다)', async () => {
    const { rpc } = await start()
    const other = PNG.sync.write(crop(canvas(90, 90), 60, 60, 16, 10))
    expect((await rpc('RequestVision', { sourceImage: SOURCE, trainImage: other, param: PARAM })).res.searchmaxResult).toEqual([])
    expect((await rpc('RequestVision', { sourceImage: SOURCE, trainImage: TRAIN, param: { ...PARAM, AcceptThreshold: 1.01 } })).res.searchmaxResult).toEqual([])
    expect((await rpc('RequestVision', { sourceImage: Buffer.from('x'), trainImage: TRAIN, param: PARAM })).res.searchmaxResult).toEqual([])
  })
  it('제어 값 visionResults 가 있으면 그것을 그대로 준다(여러 곳·소수 좌표·낮은 점수)', async () => {
    const { fake, rpc } = await start()
    const fixed = [{ success: true, Score: 0.9312, TX: 10.75, TY: 3.2 }, { success: true, Score: 0.61, TX: 40, TY: 22 }]
    fake.set({ visionResults: fixed })
    expect((await rpc('RequestVision', { sourceImage: SOURCE, trainImage: TRAIN, param: PARAM })).res.searchmaxResult).toEqual(fixed)
    fake.set({ visionResults: null })
    expect((await rpc('RequestVision', { sourceImage: SOURCE, trainImage: TRAIN, param: PARAM })).res.searchmaxResult).toEqual([{ success: true, Score: 1, TX: 21, TY: 13 }])
  })
})

describe('흉내 판정 서버 — OCR', () => {
  it('읽은 글은 기본 READY — 판정·응답 모양은 사내 규칙대로', async () => {
    const { fake, rpc } = await start()
    expect((await rpc('RequestOcr', OCR())).res).toEqual({ IsAccepted: true, FoundResult: 'READY', Confidence: ':95:95:95:95:95', TX: 0, TY: 0 })
    expect((await rpc('RequestOcr', OCR({ TextValue: 'IDLE' }))).res.IsAccepted).toBe(false)
    expect(fake.calls[0]).toEqual({ rpc: 'RequestOcr', bytes: SOURCE.length, param: OCR().param, cancelled: false })
  })
  it('제어 값 ocrLines·ocrConfidence 로 읽은 줄을 바꾼다 — 다중 검사·수 비교', async () => {
    const { fake, rpc } = await start()
    fake.set({ ocrLines: ['READY', 'READY', 'IDLE'], ocrConfidence: 71 })
    const multi = (await rpc('RequestOcr', OCR({ TextValue: 'READY@@@@2-0' }))).res
    expect(multi.IsAccepted).toBe(true)
    expect(multi.FoundResult).toBe('READY @@ READY @@ IDLE')
    expect(multi.Confidence.startsWith(':71:71')).toBe(true)
    fake.set({ ocrLines: ['12.50'] })
    expect((await rpc('RequestOcr', OCR({ OcrValueType: 2, OcrOperation: 7, TextValue: '', NumberRangeMin: 10, NumberRangeMax: 20 }))).res)
      .toEqual({ IsAccepted: true, FoundResult: '12.5', Confidence: '', TX: 0, TY: 0 })
  })
  it('판정 서버가 예외를 내는 요청(`-` 없는 접미사)은 gRPC UNKNOWN', async () => {
    const { rpc } = await start()
    const { err } = await rpc('RequestOcr', OCR({ TextValue: 'READY@@@@2' }))
    expect(err.code).toBe(grpc.status.UNKNOWN)
  })
})

describe('흉내 판정 서버 — 제어', () => {
  it('delayMs 만큼 늦게 답한다', async () => {
    const { fake, rpc } = await start()
    fake.set({ delayMs: 300 })
    const started = Date.now()
    const { err } = await rpc('RequestOcr', OCR())
    expect(err).toBeNull()
    expect(Date.now() - started).toBeGreaterThanOrEqual(290)
  })
  it('error 를 주면 그 gRPC 상태로 답한다 — Vision·OCR 모두', async () => {
    const { fake, rpc } = await start()
    fake.set({ error: { code: grpc.status.UNAVAILABLE, details: 'engine down' } })
    const a = await rpc('RequestVision', { sourceImage: SOURCE, trainImage: TRAIN, param: PARAM })
    const b = await rpc('RequestOcr', OCR())
    expect([a.err.code, a.err.details]).toEqual([grpc.status.UNAVAILABLE, 'engine down'])
    expect(b.err.code).toBe(grpc.status.UNAVAILABLE)
  })
  it('부른 쪽이 끊으면 calls 에 cancelled 로 남는다', async () => {
    const { fake, rpc } = await start()
    fake.set({ delayMs: 2000 })
    const pending = rpc('RequestVision', { sourceImage: SOURCE, trainImage: TRAIN, param: PARAM })
    await expect.poll(() => fake.calls.length).toBe(1)
    rpc.last.cancel()
    expect((await pending).err.code).toBe(grpc.status.CANCELLED)
    await expect.poll(() => fake.calls[0].cancelled).toBe(true)
  })
  it('4 MiB 를 넘는 요청은 받지 않는다(사내 C# 판정 서버의 수신 기본값과 같다) — 처리기에 닿지 않는다', async () => {
    const { fake, rpc } = await start()
    const under = await rpc('RequestOcr', { ...OCR(), sourceImage: Buffer.alloc(4 * 1024 * 1024 - 200) })
    expect(under.err).toBeNull()
    const over = await rpc('RequestOcr', { ...OCR(), sourceImage: Buffer.alloc(4 * 1024 * 1024 + 1) })
    expect(over.err.code).toBe(grpc.status.RESOURCE_EXHAUSTED)
    expect(fake.calls).toHaveLength(1)
  })
  it('쓰지 않는 RPC 는 UNIMPLEMENTED', async () => {
    const { rpc } = await start()
    expect((await rpc('RequestOcrResult', { targetImage: SOURCE })).err.code).toBe(grpc.status.UNIMPLEMENTED)
  })
  it('stop() 뒤에는 포트가 닫힌다', async () => {
    const fake = await startFakeVisionServer()
    const { port } = fake
    await fake.stop()
    const code = await new Promise((resolve) => {
      const s = connect(port, '127.0.0.1')
      s.on('connect', () => { s.destroy(); resolve('open') })
      s.on('error', (e) => resolve(e.code))
    })
    expect(code).toBe('ECONNREFUSED')
  })
})

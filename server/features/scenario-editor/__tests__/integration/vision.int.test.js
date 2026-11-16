// 판정 시험 통합 시험 (P4 설계 §10·§11, 완료 조건 7) — 웹 백엔드 → 실제 InterfaceServer(gRPC 127.0.0.1:9310) → 흉내 판정 서버.
// 앞 묶음은 visionClient 층(P4-A), 뒤 묶음은 API 층(POST /vision-test·/ocr-test, P4-B — 로컬 Mongo·Redis 와 시험 사용자(seed)가 있어야 한다).
// 로컬 InterfaceServer 컨테이너와 그 전용 ZooKeeper(infra/docker-compose.yml 의 interface-server·is-zookeeper)가 떠 있어야 한다.
// 시험이 흉내 판정 서버를 호스트에 띄우고 ZooKeeper 에 노드를 만든다. 끝나면(실패해도) 노드를 지우고 흉내를 내린다.
// "판정 서버 없음" 은 노드가 없는 상태다 — InterfaceServer 가 10초 뒤 INTERNAL 을 준다(그 시험이 10초쯤 걸린다).
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '../../../../..')
// 시험만 tools 를 읽는다 — 흉내 판정 서버·ZooKeeper 노드 도구·PNG 만들기
const { withJudge } = require(join(ROOT, 'tools/infra/fake-vision-server.js'))
const { createIsZk } = require(join(ROOT, 'tools/infra/is-zk.js'))
const { PNG } = createRequire(join(ROOT, 'tools/package.json'))('pngjs')
const { createVisionClient } = require('../../clients/visionClient')

const GRPC_ADDR = process.env.SEW_IS_GRPC_ADDR || '127.0.0.1:9310'
const HOST = 'host.docker.internal'
const zk = createIsZk()
const env = { EARS_INTERFACE_GRPC_ADDR: GRPC_ADDR }
const client = createVisionClient({ env })
const judges = []
const caught = async (p) => { try { await p } catch (e) { return e } throw new Error('던지지 않았다') }

// 자리마다 다른 색(256 픽셀마다 되풀이된다 — 화면은 그보다 작게 쓴다). tint 로 다른 그림을 만든다
function canvas(w, h, tint = 0) {
  const png = new PNG({ width: w, height: h })
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) png.data.set([(x * 7 + y * 13 + tint) % 256, (x * 3 + y * 29) % 256, (x + y * 5) % 256, 255], (y * w + x) * 4)
  return png
}
function crop(png, x0, y0, w, h) {
  const out = new PNG({ width: w, height: h })
  PNG.bitblt(png, out, x0, y0, w, h, 0, 0)
  return out
}
const SCREEN = canvas(240, 200)
const SOURCE = PNG.sync.write(SCREEN)
const TRAIN = PNG.sync.write(crop(SCREEN, 131, 77, 40, 24))
const PARAM = { AcceptThreshold: 0.9, MaximumNumberToFind: 20, Timeout: 2000, TimeoutEnabled: true }
const vision = (extra = {}) => ({ sourceImage: SOURCE, trainImage: TRAIN, param: PARAM, ...extra })
const ocr = (param) => ({ sourceImage: SOURCE, param: { OcrValueType: 1, OcrOperation: 1, TextValue: 'READY', MinMatchingValue: 10, NumberValue: 0, NumberRangeMin: 0, NumberRangeMax: 0, ...param } })

async function judge(options) {
  const j = await withJudge({ zk, ...options })
  judges.push(j)
  return j
}
async function stopJudges() {
  for (const j of judges.splice(0)) await j.stop()
}
// 앞서 죽은 시험이 남긴 흉내 노드를 지운다(다른 것은 건드리지 않는다)
async function sweep() {
  for (const kind of ['vision', 'ocr']) {
    for (const node of await zk.list(kind)) if (node.startsWith(`${HOST}:`)) await zk.remove(kind, node)
  }
}

beforeAll(sweep)
afterEach(stopJudges)
afterAll(async () => {
  client.close()
  await stopJudges()
})

describe('판정 시험 gRPC — InterfaceServer 를 거쳐 흉내 판정 서버와', () => {
  it('Vision: 화면 조각 안의 찾을 그림 좌표(보낸 조각 기준 왼쪽 위)가 돌아온다 — 보낸 값이 그대로 닿는다', async () => {
    const { fake } = await judge()
    const out = await client.requestVision(vision())
    expect(out).toEqual({ searchmaxResult: [{ success: true, Score: 1, TX: 131, TY: 77 }] })
    expect(fake.calls).toEqual([{ rpc: 'RequestVision', bytes: SOURCE.length + TRAIN.length, param: PARAM, cancelled: false }])
  })

  it('Vision: 못 찾으면 0건, 판정 서버가 준 여러 곳·소수 좌표·점수는 그대로 온다', async () => {
    const { fake } = await judge()
    const other = PNG.sync.write(crop(canvas(240, 200, 101), 131, 77, 40, 24)) // 같은 자리, 다른 색
    expect(await client.requestVision(vision({ trainImage: other }))).toEqual({ searchmaxResult: [] })
    const fixed = [{ success: true, Score: 0.9312, TX: 10.75, TY: 3.2 }, { success: true, Score: 0.61, TX: 40, TY: 22 }]
    fake.set({ visionResults: fixed })
    expect(await client.requestVision(vision())).toEqual({ searchmaxResult: fixed })
  })

  it('OCR: 글 비교 맞음·안 맞음(다중 검사 접미사 포함), 수 비교 — 읽은 글·신뢰도가 그대로 온다', async () => {
    const { fake } = await judge()
    fake.set({ ocrLines: ['READY', 'READY', 'IDLE'], ocrConfidence: 88 })
    expect(await client.requestOcr(ocr({ OcrOperation: 3, TextValue: 'READY@@@@2-0' })))
      .toEqual({ IsAccepted: true, FoundResult: 'READY @@ READY @@ IDLE', Confidence: ':88'.repeat(14), TX: 0, TY: 0 })
    expect((await client.requestOcr(ocr({ TextValue: '한글 값' }))).IsAccepted).toBe(false)
    expect(fake.calls[1].param.TextValue).toBe('한글 값')
    fake.set({ ocrLines: ['12.50'] })
    expect(await client.requestOcr(ocr({ OcrValueType: 2, OcrOperation: 7, TextValue: '', NumberRangeMin: 10, NumberRangeMax: 20 })))
      .toEqual({ IsAccepted: true, FoundResult: '12.5', Confidence: '', TX: 0, TY: 0 })
  })

  it('판정 서버를 내렸다 다시 띄워도(다른 포트) 새 서버로 간다', async () => {
    const first = await judge()
    expect((await client.requestVision(vision())).searchmaxResult).toHaveLength(1)
    await stopJudges()
    const second = await judge()
    expect(second.address).not.toBe(first.address)
    expect((await client.requestVision(vision())).searchmaxResult).toHaveLength(1)
    expect((await client.requestOcr(ocr())).IsAccepted).toBe(true)
    expect(first.fake.calls).toHaveLength(1)
    expect(second.fake.calls.map((c) => c.rpc)).toEqual(['RequestVision', 'RequestOcr'])
  })

  it('판정 서버가 없는 쪽(노드 없음)은 약 10초 뒤 502 VISION_NO_ANSWER — 있는 쪽은 그대로 되고, 동시에 보낸 요청이 서로를 기다리지 않는다', async () => {
    const { fake } = await judge({ kinds: ['ocr'] }) // Vision 판정 서버만 없다
    const started = Date.now()
    const timed = (p) => caught(p).then((e) => ({ e, took: Date.now() - started }))
    const [a, b, o] = await Promise.all([timed(client.requestVision(vision())), timed(client.requestVision(vision())), client.requestOcr(ocr())])
    expect(o.IsAccepted).toBe(true)
    for (const { e, took } of [a, b]) {
      expect([e.statusCode, e.code, e.upstream.status]).toEqual([502, 'VISION_NO_ANSWER', 13])
      expect(took).toBeGreaterThan(9000)
      // InterfaceServer 는 연결 하나의 요청을 차례로 처리한다 — 연결을 함께 쓰면 뒤의 것은 20초에 끝나 백엔드 deadline(12초)에 걸린다
      expect(took).toBeLessThan(11900)
    }
    expect(fake.calls.map((c) => c.rpc)).toEqual(['RequestOcr'])
  })

  it('InterfaceServer 주소가 틀리면(닫힌 포트) 503 VISION_DOWN — 판정 서버가 떠 있어도', async () => {
    await judge()
    const closed = createServer()
    await new Promise((resolve) => closed.listen(0, '127.0.0.1', resolve))
    const { port } = closed.address()
    await new Promise((resolve) => closed.close(() => resolve()))
    env.EARS_INTERFACE_GRPC_ADDR = `127.0.0.1:${port}`
    try {
      const e = await caught(client.requestVision(vision()))
      expect([e.statusCode, e.code]).toEqual([503, 'VISION_DOWN'])
    } finally {
      env.EARS_INTERFACE_GRPC_ADDR = GRPC_ADDR
    }
    expect((await client.requestVision(vision())).searchmaxResult).toHaveLength(1)
  })

  it('끝난 뒤 흉내 판정 서버의 노드가 남지 않는다', async () => {
    await stopJudges()
    for (const kind of ['vision', 'ocr']) {
      expect((await zk.list(kind)).filter((n) => n.startsWith(`${HOST}:`))).toEqual([])
    }
  })
})

// ── API 층 ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('POST /vision-test·/ocr-test — 실제 앱으로', () => {
  let server
  let base
  const before = {}
  beforeAll(async () => {
    require('dotenv').config({ path: join(ROOT, 'server/.env') })
    for (const k of ['EARS_INTERFACE_GRPC_ADDR', 'EARS_INTERFACE_GRPC_TIMEOUT_MS', 'SE_VISION_TEST_CONCURRENCY', 'SE_DEV_USER_OVERRIDE']) before[k] = process.env[k]
    process.env.SE_DEV_USER_OVERRIDE = '1'
    process.env.EARS_INTERFACE_GRPC_ADDR = GRPC_ADDR
    process.env.EARS_INTERFACE_GRPC_TIMEOUT_MS = '12000'
    process.env.SE_VISION_TEST_CONCURRENCY = '2'
    const { connectDB } = require('../../../../shared/db/connection')
    const { connectRedis } = require('../../../../shared/db/redisConnection')
    await connectDB()
    await connectRedis()
    const app = require('../../../../app')
    await new Promise((r) => { server = app.listen(0, '127.0.0.1', r) })
    base = `http://127.0.0.1:${server.address().port}/api/scenario-editor`
  })
  afterAll(async () => {
    for (const [k, v] of Object.entries(before)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
    if (server) { server.closeAllConnections(); await new Promise((r) => server.close(r)) }
    await require('../../deps').getDeps().snapshotRepo.shutdown()
    await require('../../../../shared/db/connection').closeConnections()
    await require('../../../../shared/db/redisConnection').closeRedis()
  })

  function post(path, meta, files, user = 'sew_master', init = {}) {
    const fd = new FormData()
    fd.append('meta', JSON.stringify(meta))
    for (const [name, buf] of Object.entries(files)) fd.append(name, new Blob([buf], { type: 'image/png' }), `${name}.png`)
    return fetch(`${base}${path}`, { method: 'POST', body: fd, headers: { 'X-SE-User': user }, ...init })
  }
  const answer = async (res) => ({ status: res.status, ...(await res.json()) })
  const visionOf = (user, meta = { accept: 0.9 }, files = { source: SOURCE, train: TRAIN }, init) => post('/vision-test', meta, files, user, init)
  const ocrOf = (user, meta = { op: 1, text: 'READY' }, init) => post('/ocr-test', meta, { source: SOURCE }, user, init)

  it('Vision: 찾은 곳의 점수·좌표(보낸 조각 기준)·걸린 시간·요청 바이트 — 쓰기 권한이 없는 사용자(sew_cvd)도 된다', async () => {
    const { fake } = await judge()
    const out = await answer(await visionOf('sew_cvd', { accept: 0.9, about: { process: 'SEWCVD', model: 'M', scenario: 'S', step: 2 } }))
    expect(out.status).toBe(200)
    expect(out.data.results).toEqual([{ score: 1, x: 131, y: 77 }])
    expect(out.data.bytes).toBeGreaterThan(SOURCE.length + TRAIN.length)
    expect(out.data.ms).toBeGreaterThanOrEqual(0)
    // 판정 서버에는 사내 편집기와 같은 고정값이 간다
    expect(fake.calls[0].param).toEqual({ AcceptThreshold: 0.9, MaximumNumberToFind: 20, Timeout: 2000, TimeoutEnabled: true })
    const none = await answer(await visionOf('sew_master', { accept: 0.9 }, { source: SOURCE, train: PNG.sync.write(crop(canvas(240, 200, 101), 131, 77, 40, 24)) }))
    expect([none.status, none.data.results]).toEqual([200, []])
  })

  it('OCR: 글 비교(다중 검사)·수 비교의 판정과 읽은 글·신뢰도 — 판정 서버에는 사내 형식으로 간다', async () => {
    const { fake } = await judge()
    fake.set({ ocrLines: ['READY', 'READY', 'IDLE'], ocrConfidence: 88 })
    const hit = await answer(await ocrOf('sew_master', { op: 3, text: 'READY', multi: { count: 2, op: 0 } }))
    expect([hit.status, hit.data.accepted, hit.data.found, hit.data.confidence]).toEqual([200, true, 'READY @@ READY @@ IDLE', ':88'.repeat(14)])
    expect(fake.calls[0].param).toEqual({ OcrValueType: 1, OcrOperation: 3, TextValue: 'READY@@@@2-0', MinMatchingValue: 10, NumberValue: 0, NumberRangeMin: 0, NumberRangeMax: 0 })
    const miss = await answer(await ocrOf('sew_master', { op: 1, text: 'NOPE' }))
    expect([miss.status, miss.data.accepted]).toEqual([200, false])
    expect(fake.calls[1].param.TextValue).toBe('NOPE') // 다중 검사가 없으면 접미사도 없다
    fake.set({ ocrLines: ['12.50'] })
    const num = await answer(await ocrOf('sew_cvd', { op: 7, min: 10, max: 20, multi: { count: 1, op: 1 } }))
    expect([num.data.accepted, num.data.found, num.data.confidence]).toEqual([true, '12.5', ''])
    expect(fake.calls[2].param).toEqual({ OcrValueType: 2, OcrOperation: 7, TextValue: '@@@@1-1', MinMatchingValue: 10, NumberValue: 0, NumberRangeMin: 10, NumberRangeMax: 20 })
  })

  it('미등록 사용자는 403, 입력이 틀리면 400 — 판정 서버에 닿지 않는다', async () => {
    const { fake } = await judge()
    expect((await answer(await visionOf('sew_none'))).code).toBe('USER_NOT_REGISTERED')
    const bad = await answer(await visionOf('sew_master', { accept: 1.5 }))
    expect([bad.status, bad.code, bad.details]).toEqual([400, 'BAD_REQUEST', { path: 'accept' }])
    expect((await answer(await ocrOf('sew_master', { op: 1, text: 'A@' }))).details).toEqual({ path: 'text' })
    expect(fake.calls).toEqual([])
  })

  it('그림 둘의 합이 4 MiB 를 넘으면 413 VISION_TOO_LARGE — 보내지 않는다', async () => {
    const { fake } = await judge()
    const head = SOURCE.subarray(0, 8)
    const big = (bytes) => Buffer.concat([head, Buffer.alloc(bytes - 8)])
    const out = await answer(await visionOf('sew_master', { accept: 0.9 }, { source: big(3 * 1024 * 1024), train: big(2 * 1024 * 1024) }))
    expect([out.status, out.code, out.details.maxBytes]).toEqual([413, 'VISION_TOO_LARGE', 4194304])
    expect(out.details.bytes).toBeGreaterThan(5 * 1024 * 1024)
    expect(fake.calls).toEqual([])
  })

  it('판정 서버가 없으면 약 10초 뒤 502 VISION_NO_ANSWER — 그동안 같은 사용자·자리를 넘는 시험은 429, OCR 자리는 따로다', async () => {
    await judge({ kinds: ['ocr'] }) // Vision 판정 서버만 없다
    const started = Date.now()
    const a = visionOf('sew_master').then(answer)
    const b = visionOf('sew_cvd').then(answer)
    await new Promise((r) => setTimeout(r, 500)) // 둘이 자리를 잡을 때까지
    const sameUser = await answer(await ocrOf('sew_master'))
    expect([sameUser.status, sameUser.code, sameUser.details]).toEqual([429, 'VISION_BUSY', { scope: 'user' }])
    const third = await answer(await visionOf('sew_multi'))
    expect([third.status, third.code, third.details]).toEqual([429, 'VISION_BUSY', { scope: 'server' }])
    const other = await answer(await ocrOf('sew_multi'))
    expect([other.status, other.data.accepted]).toEqual([200, true])
    for (const out of await Promise.all([a, b])) {
      expect([out.status, out.code]).toEqual([502, 'VISION_NO_ANSWER'])
      expect(JSON.stringify(out)).not.toContain('9310')
    }
    const took = Date.now() - started
    expect(took).toBeGreaterThan(9000)
    expect(took).toBeLessThan(11900)
    // 자리가 비었다
    expect((await answer(await ocrOf('sew_master'))).status).toBe(200)
  })

  it('주소가 비면 503 VISION_UNSET, 틀리면(닫힌 포트) 503 VISION_DOWN — 문구에 주소가 없다', async () => {
    await judge()
    const closed = createServer()
    await new Promise((resolve) => closed.listen(0, '127.0.0.1', resolve))
    const { port } = closed.address()
    await new Promise((resolve) => closed.close(() => resolve()))
    try {
      process.env.EARS_INTERFACE_GRPC_ADDR = ''
      const unset = await answer(await visionOf('sew_master'))
      expect([unset.status, unset.code]).toEqual([503, 'VISION_UNSET'])
      process.env.EARS_INTERFACE_GRPC_ADDR = `127.0.0.1:${port}`
      const down = await answer(await ocrOf('sew_master'))
      expect([down.status, down.code]).toEqual([503, 'VISION_DOWN'])
      expect(JSON.stringify(down)).not.toContain(String(port))
    } finally {
      process.env.EARS_INTERFACE_GRPC_ADDR = GRPC_ADDR
    }
    expect((await answer(await visionOf('sew_master'))).status).toBe(200)
  })

  // InterfaceServer 는 웹이 끊은 호출을 판정 서버까지 취소하지 않는다 — 판정 서버는 그 요청을 끝까지 처리한다.
  // 그래서 웹도 호출을 끊지 않고 답이 올 때까지 자리를 쥔다(버려진 요청이 판정 서버에 쌓이지 않게).
  it('브라우저가 끊어도 판정 서버는 그 요청을 끝까지 처리한다 — 그동안 그 사용자의 자리는 차 있고, 답이 오면 빈다', async () => {
    const { fake } = await judge()
    fake.set({ delayMs: 3000 })
    const ac = new AbortController()
    const pending = visionOf('sew_master', { accept: 0.9 }, { source: SOURCE, train: TRAIN }, { signal: ac.signal }).catch((e) => e.name)
    await expect.poll(() => fake.calls.length, { timeout: 5000 }).toBe(1)
    ac.abort()
    expect(await pending).toBe('AbortError')
    fake.set({ delayMs: 0 })
    const again = await answer(await visionOf('sew_master'))
    expect([again.status, again.code, again.details]).toEqual([429, 'VISION_BUSY', { scope: 'user' }])
    await expect.poll(async () => (await visionOf('sew_master')).status, { timeout: 8000, interval: 500 }).toBe(200)
    expect(fake.calls[0].cancelled).toBe(false)
  })
})

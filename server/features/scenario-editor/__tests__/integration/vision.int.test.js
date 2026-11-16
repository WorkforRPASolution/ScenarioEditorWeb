// 판정 시험 gRPC 계약 통합 시험 (P4 설계 §10, 완료 조건 7) — 웹 백엔드의 visionClient → 실제 InterfaceServer(gRPC 127.0.0.1:9310) → 흉내 판정 서버.
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

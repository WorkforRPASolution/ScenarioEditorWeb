'use strict'
// 판정 시험 gRPC 실측 (P4 설계 §10, 분석 42 Q-061) — 판정 서버가 없거나 늦거나 오류를 낼 때 웹 백엔드(visionClient)가 받는 gRPC 상태·details·걸린 시간.
// 준비: tools/infra/prepare-is.sh && docker compose -f infra/docker-compose.yml up -d && tools/infra/smoke-is.sh
// 실행: node tools/measure/vision-grpc.js   (약 2분 — 10초 기다리는 경우가 여럿이다)
// 이 도구가 흉내 판정 서버를 호스트에 띄우고 전용 ZooKeeper 에 노드를 만들었다 지운다. InterfaceServer 컨테이너는 내리지 않는다(다른 시험이 함께 쓴다).
// 백엔드 deadline 을 30초로 늘려 InterfaceServer 가 주는 값을 그대로 본다(평소 12초).
const net = require('node:net')
const path = require('node:path')
const { withJudge } = require('../infra/fake-vision-server')
const { createIsZk } = require('../infra/is-zk')
const { PNG } = require('pngjs')
const { createVisionClient } = require(path.join(__dirname, '../../server/features/scenario-editor/clients/visionClient'))

const GRPC_ADDR = process.env.SEW_IS_GRPC_ADDR || '127.0.0.1:9310'
const HOST = 'host.docker.internal'
const MIB4 = 4 * 1024 * 1024
const zk = createIsZk()
const rows = []

function clientFor(addr, timeoutMs = 30000) {
  return createVisionClient({ env: { EARS_INTERFACE_GRPC_ADDR: addr, EARS_INTERFACE_GRPC_TIMEOUT_MS: String(timeoutMs) } })
}
const client = clientFor(GRPC_ADDR)

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
const SCREEN = canvas(240, 200)
const SOURCE = PNG.sync.write(SCREEN)
const TRAIN = PNG.sync.write(crop(SCREEN, 131, 77, 40, 24))
const VISION = { sourceImage: SOURCE, trainImage: TRAIN, param: { AcceptThreshold: 0.9, MaximumNumberToFind: 20, Timeout: 2000, TimeoutEnabled: true } }
const OCR = { sourceImage: SOURCE, param: { OcrValueType: 1, OcrOperation: 1, TextValue: 'READY', MinMatchingValue: 10, NumberValue: 0, NumberRangeMin: 0, NumberRangeMax: 0 } }
// 판정 서버에 닿는 길이가 정확히 bytes 인 OCR 요청(그림 자리를 0 으로 채운다 — 흉내는 OCR 그림을 읽지 않는다).
// 값이 0 인 칸을 빼고 만든다: 웹(protobufjs)은 0 을 적어 넣은 칸도 싣지만 InterfaceServer 는 받은 요청을 다시 직렬화하며 기본값 칸을 뺀다
// — 0 인 수 칸 셋(27바이트)만큼 판정 서버에 닿는 요청이 작아진다. 웹이 센 길이는 닿는 길이보다 작아지지 않는다(4 MiB 검사가 안전한 쪽이다).
const OCR_TIGHT = { OcrValueType: 1, OcrOperation: 1, TextValue: 'READY', MinMatchingValue: 10 }
function ocrOfBytes(c, bytes, param = OCR_TIGHT) {
  let length = bytes - c.requestBytes('ocr', { param, sourceImage: Buffer.alloc(0) })
  for (let i = 0; i < 4; i++) {
    const got = c.requestBytes('ocr', { param, sourceImage: Buffer.alloc(length) })
    if (got === bytes) return { param, sourceImage: Buffer.alloc(length) }
    length -= got - bytes
  }
  throw new Error(`cannot build an OCR request of ${bytes} bytes`)
}

async function measure(label, run) {
  const started = Date.now()
  let row
  try {
    const out = await run()
    const ms = Date.now() - started
    const what = out.searchmaxResult ? `${out.searchmaxResult.length}곳` : `IsAccepted=${out.IsAccepted}`
    row = { label, status: '0 OK', details: what, ms, code: '—' }
  } catch (e) {
    const ms = Date.now() - started
    row = { label, status: e.upstream ? String(e.upstream.status) : '—', details: e.upstream ? e.upstream.details : String(e.message), ms, code: e.code || e.name }
  }
  rows.push(row)
  console.log(`${label}: status=${row.status} ${row.ms}ms ${row.code} ${row.details}`)
}
async function closedPort() {
  const s = net.createServer()
  await new Promise((resolve) => s.listen(0, '127.0.0.1', resolve))
  const { port } = s.address()
  await new Promise((resolve) => s.close(() => resolve()))
  return port
}

async function main() {
  for (const kind of ['vision', 'ocr']) {
    for (const node of await zk.list(kind)) if (node.startsWith(`${HOST}:`)) await zk.remove(kind, node)
  }

  // 1 판정 서버 없음(노드 없음)
  await Promise.all([
    measure('판정 서버 없음(노드 없음) — Vision', () => client.requestVision(VISION)),
    measure('판정 서버 없음(노드 없음) — OCR', () => client.requestOcr(OCR))
  ])

  // 2 노드는 있는데 그 주소에 아무도 없다
  const dead = `${HOST}:${await closedPort()}`
  await zk.add('vision', dead)
  await new Promise((resolve) => setTimeout(resolve, 500))
  try {
    await measure('노드는 있는데 닫힌 포트 — Vision', () => client.requestVision(VISION))
    await measure('노드는 있는데 닫힌 포트 — 두 번째', () => client.requestVision(VISION))
  } finally {
    await zk.remove('vision', dead)
  }

  const judge = await withJudge({ zk })
  try {
    // 3 정상(기준선)
    await measure('정상 — Vision(240×200 에서 40×24)', () => client.requestVision(VISION))
    await measure('정상 — Vision 두 번째', () => client.requestVision(VISION))
    await measure('정상 — OCR', () => client.requestOcr(OCR))

    // 4 4 MiB 전후(직렬화한 요청 길이)
    await measure(`요청 ${MIB4}바이트(4 MiB 꼭) — OCR`, () => client.requestOcr(ocrOfBytes(client, MIB4)))
    await measure(`요청 ${MIB4 + 1}바이트(4 MiB + 1) — OCR`, () => client.requestOcr(ocrOfBytes(client, MIB4 + 1)))
    await measure(`웹이 센 길이 ${MIB4 + 1}바이트, 0 인 칸 셋 포함(닿는 길이는 27바이트 작다) — OCR`, () => client.requestOcr(ocrOfBytes(client, MIB4 + 1, OCR.param)))
    await measure('요청 16 MiB — OCR', () => client.requestOcr(ocrOfBytes(client, 4 * MIB4)))

    // 5 판정 서버가 gRPC 오류를 낸다
    judge.fake.set({ error: { code: 2, details: 'Exception was thrown by handler.' } })
    await measure('판정 서버가 UNKNOWN(2) — Vision', () => client.requestVision(VISION))
    judge.fake.set({ error: { code: 14, details: 'engine down' } })
    await measure('판정 서버가 UNAVAILABLE(14) — OCR', () => client.requestOcr(OCR))
    judge.fake.set({ error: null })

    // 6 판정 서버가 늦다
    judge.fake.set({ delayMs: 8000 })
    await measure('판정 서버가 8초 뒤 답 — Vision', () => client.requestVision(VISION))
    judge.fake.set({ delayMs: 15000 })
    await measure('판정 서버가 15초 뒤 답 — Vision', () => client.requestVision(VISION))
    judge.fake.set({ delayMs: 0 })
  } finally {
    await judge.stop()
  }

  // 7 InterfaceServer 에 닿지 못한다(컨테이너는 내리지 않는다)
  const down = clientFor(`127.0.0.1:${await closedPort()}`)
  await measure('InterfaceServer 주소가 닫힌 포트', () => down.requestVision(VISION))
  const sockets = new Set()
  const silent = net.createServer((s) => { sockets.add(s); s.on('error', () => {}) })
  await new Promise((resolve) => silent.listen(0, '127.0.0.1', resolve))
  await measure('듣기만 하고 답하지 않는 주소(deadline 3초)', () => clientFor(`127.0.0.1:${silent.address().port}`, 3000).requestVision(VISION))
  for (const s of sockets) s.destroy()
  await new Promise((resolve) => silent.close(() => resolve()))
  await measure('닿지 않는 주소 10.255.255.1:9300(deadline 3초)', () => clientFor('10.255.255.1:9300', 3000).requestVision(VISION))

  console.log('\n| 경우 | gRPC 상태 | details | 걸린 시간 | 웹 오류 code |')
  console.log('|---|---|---|---|---|')
  for (const r of rows) console.log(`| ${r.label} | ${r.status} | ${String(r.details).replace(/\|/g, '\\|').slice(0, 140) || '(빔)'} | ${r.ms}ms | ${r.code} |`)
  client.close()
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1) })

// E2E 용 흉내 판정 서버(제어 포트 판) — 흉내를 띄워 전용 ZooKeeper 에 올리고, 시험이 HTTP 로 제어한다. ZooKeeper 는 가짜로 넣는다.
import { describe, it, expect, afterEach } from 'vitest'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const grpc = require('@grpc/grpc-js')
const protoLoader = require('@grpc/proto-loader')
const { PNG } = require('pngjs')
const { startJudgeServer, parseArgs } = require('../fake-vision-judge-server')
const { PROTO_PATH } = require('../fake-vision-server')

const Stub = grpc.loadPackageDefinition(protoLoader.loadSync(PROTO_PATH, { keepCase: true, defaults: true, longs: Number })).ImageProcesssingGrpcSrv.ImageProcesssingGrpcSrv
const SOURCE = PNG.sync.write(new PNG({ width: 4, height: 4 }))
const OCR = { sourceImage: SOURCE, param: { OcrValueType: 1, OcrOperation: 1, TextValue: 'RUN', MinMatchingValue: 10, NumberValue: 0, NumberRangeMin: 0, NumberRangeMax: 0 } }

// 가짜 ZooKeeper: 노드 집합과 부른 순서
function fakeZk(initial = {}) {
  const nodes = { vision: new Set(initial.vision ?? []), ocr: new Set(initial.ocr ?? []) }
  const log = []
  return {
    nodes, log,
    async add(kind, address) { log.push(['add', kind, address]); nodes[kind].add(address) },
    async remove(kind, address) { log.push(['remove', kind, address]); nodes[kind].delete(address) },
    async list(kind) { return [...nodes[kind]] }
  }
}
const closers = []
afterEach(async () => { for (const close of closers.splice(0).reverse()) await close() })
async function start(zk = fakeZk()) {
  const srv = await startJudgeServer({ zk, noticeMs: 0 })
  closers.push(() => srv.close())
  return { srv, zk }
}
const http = async (srv, method, path, body) => {
  const res = await fetch(`${srv.controlUrl}${path}`, { method, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) })
  return { status: res.status, body: await res.json() }
}
function ocr(srv) {
  const stub = new Stub(`127.0.0.1:${srv.port}`, grpc.credentials.createInsecure(), { 'grpc.enable_http_proxy': 0 })
  closers.push(() => stub.close())
  return new Promise((resolve) => stub.RequestOcr(OCR, { deadline: new Date(Date.now() + 5000) }, (err, res) => resolve({ err, res })))
}

describe('startJudgeServer', () => {
  it('앞서 남은 흉내 노드(host.docker.internal:…)만 지우고, 두 경로에 제 주소를 올린다', async () => {
    const zk = fakeZk({ vision: ['host.docker.internal:1111', '10.0.0.5:50051'], ocr: ['host.docker.internal:2222'] })
    const { srv } = await start(zk)
    expect(srv.address).toBe(`host.docker.internal:${srv.port}`)
    expect([...zk.nodes.vision].sort()).toEqual(['10.0.0.5:50051', srv.address].sort())
    expect([...zk.nodes.ocr]).toEqual([srv.address])
    expect(await http(srv, 'GET', '/health')).toEqual({ status: 200, body: { judge: 'on', address: srv.address } })
  })

  it('close(): 노드를 지우고 흉내·제어 포트를 내린다', async () => {
    const zk = fakeZk()
    const srv = await startJudgeServer({ zk, noticeMs: 0 })
    await srv.close()
    expect([...zk.nodes.vision, ...zk.nodes.ocr]).toEqual([])
    await expect(fetch(`${srv.controlUrl}/health`)).rejects.toThrow()
  })

  it('PUT /control: 흉내의 답을 바꾼다(읽은 줄) · POST /reset: 처음 값으로, 받은 요청 기록도 비운다', async () => {
    const { srv } = await start()
    expect((await ocr(srv)).res.IsAccepted).toBe(false) // 기본 READY ≠ RUN
    expect(await http(srv, 'PUT', '/control', { ocrLines: ['RUN'], ocrConfidence: 71 })).toEqual({ status: 200, body: { ok: true } })
    const hit = await ocr(srv)
    expect(hit.res).toMatchObject({ IsAccepted: true, FoundResult: 'RUN', Confidence: ':71:71:71' })
    const calls = await http(srv, 'GET', '/calls')
    expect(calls.body.map((c) => [c.rpc, c.bytes, c.cancelled, c.param.TextValue])).toEqual([['RequestOcr', SOURCE.length, false, 'RUN'], ['RequestOcr', SOURCE.length, false, 'RUN']])
    expect(await http(srv, 'POST', '/reset')).toEqual({ status: 200, body: { ok: true } })
    expect((await http(srv, 'GET', '/calls')).body).toEqual([])
    expect((await ocr(srv)).res.IsAccepted).toBe(false)
  })

  it('PUT /judge/off·on: 노드를 지웠다가 다시 올린다("판정 서버 없음" 상태) — 흉내는 떠 있다', async () => {
    const { srv, zk } = await start()
    expect(await http(srv, 'PUT', '/judge/off')).toEqual({ status: 200, body: { judge: 'off', address: srv.address } })
    expect([...zk.nodes.vision, ...zk.nodes.ocr]).toEqual([])
    expect((await http(srv, 'GET', '/health')).body.judge).toBe('off')
    expect(await http(srv, 'PUT', '/judge/on')).toEqual({ status: 200, body: { judge: 'on', address: srv.address } })
    expect([...zk.nodes.vision]).toEqual([srv.address])
    expect([...zk.nodes.ocr]).toEqual([srv.address])
  })

  it('틀린 요청: 모르는 경로 404 · JSON 이 아닌 제어 값 400(흉내는 그대로)', async () => {
    const { srv } = await start()
    expect((await http(srv, 'GET', '/nope')).status).toBe(404)
    expect((await http(srv, 'PUT', '/judge/maybe')).status).toBe(404)
    expect((await http(srv, 'PUT', '/control', '{oops')).status).toBe(400)
    expect((await http(srv, 'PUT', '/control', '[1]')).status).toBe(400)
    expect((await ocr(srv)).res.IsAccepted).toBe(false)
  })

  it('노드를 올리지 못하면 던지고 흉내를 남기지 않는다', async () => {
    const zk = fakeZk()
    zk.add = async () => { throw new Error('zkCli create failed (exit 1): Node does not exist') }
    await expect(startJudgeServer({ zk, noticeMs: 0 })).rejects.toThrow('Node does not exist')
  })
})

describe('parseArgs', () => {
  it('--control <포트> 가 필요하다', () => {
    expect(parseArgs(['--control', '3196'])).toEqual({ controlPort: 3196 })
    expect(() => parseArgs([])).toThrow('--control')
    expect(() => parseArgs(['--control', 'x'])).toThrow('--control')
  })
})

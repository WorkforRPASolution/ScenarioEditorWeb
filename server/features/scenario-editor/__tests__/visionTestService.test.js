// Vision·OCR 시험 서비스(P4 설계 §5.2~§5.5) — 검사 → 조립 → 크기 → 자리(동시 수·사용자당 하나) → 호출 → 응답 정리 → 기록
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { createVisionTestService } = require('../service/visionTestService')
const { createVisionClient } = require('../clients/visionClient')
const { seError } = require('../errors')

const MIB4 = 4 * 1024 * 1024
const real = createVisionClient({ env: {} }) // 직렬화 길이만 빌린다(주소 없이 된다)
const SOURCE = Buffer.from('source-png')
const TRAIN = Buffer.from('train-png')
const user = (id) => ({ singleid: id, canWrite: false })
const VISION_OK = { searchmaxResult: [{ success: true, Score: 0.97, TX: 12.5, TY: 40 }] }
const OCR_OK = { IsAccepted: true, FoundResult: 'SECRET-READ', Confidence: ':90' }
const caught = async (p) => { try { await p } catch (e) { return e } throw new Error('던지지 않았다') }

// 호출을 붙잡아 두는 가짜 클라이언트 — pending[i].resolve/reject 로 끝낸다. auto 를 주면 바로 답한다.
function make({ env = {}, auto = null } = {}) {
  const pending = []
  const logs = []
  let clock = 1000
  const hold = (rpc) => (request, options) => new Promise((resolve, reject) => {
    const entry = { rpc, request, options, resolve, reject }
    pending.push(entry)
    if (auto) auto(entry)
  })
  const client = { requestBytes: real.requestBytes, requestVision: hold('vision'), requestOcr: hold('ocr') }
  const log = { info: (m) => logs.push(['info', m]), warn: (m) => logs.push(['warn', m]) }
  const service = createVisionTestService({ client, env, log, now: () => clock })
  return { service, pending, logs, tick: (ms) => { clock += ms } }
}
const vision = (s, id = 'u1', meta = { accept: 0.9 }, opts) => s.vision(user(id), { source: SOURCE, train: TRAIN, meta }, opts)
const ocr = (s, id = 'u1', meta = { op: 1, text: 'READY' }, opts) => s.ocr(user(id), { source: SOURCE, meta }, opts)
const settle = () => new Promise((resolve) => setImmediate(resolve))

describe('visionTestService — 주고받기', () => {
  it('Vision: 조립한 요청을 보내고 찾은 곳·걸린 시간·요청 바이트를 준다', async () => {
    const t = make()
    const p = vision(t.service)
    await settle()
    expect(t.pending).toHaveLength(1)
    expect(t.pending[0].request).toEqual({ sourceImage: SOURCE, trainImage: TRAIN, param: { AcceptThreshold: 0.9, MaximumNumberToFind: 20, Timeout: 2000, TimeoutEnabled: true } })
    t.tick(412)
    t.pending[0].resolve(VISION_OK)
    expect(await p).toEqual({ results: [{ score: 0.97, x: 12.5, y: 40 }], ms: 412, bytes: real.requestBytes('vision', t.pending[0].request) })
  })
  it('OCR: 사내 형식의 요청을 보내고 판정·읽은 글·신뢰도를 준다', async () => {
    const t = make()
    const p = ocr(t.service, 'u1', { op: 3, text: 'READY', multi: { count: 2, op: 1 } })
    await settle()
    expect(t.pending[0].request.param).toEqual({ OcrValueType: 1, OcrOperation: 3, TextValue: 'READY@@@@2-1', MinMatchingValue: 10, NumberValue: 0, NumberRangeMin: 0, NumberRangeMax: 0 })
    t.tick(1500)
    t.pending[0].resolve(OCR_OK)
    expect(await p).toEqual({ accepted: true, found: 'SECRET-READ', confidence: ':90', ms: 1500, bytes: real.requestBytes('ocr', t.pending[0].request) })
  })
  it('부른 쪽의 signal 을 클라이언트에 넘긴다', async () => {
    const t = make({ auto: (e) => e.resolve(VISION_OK) })
    const ac = new AbortController()
    await vision(t.service, 'u1', { accept: 1 }, { signal: ac.signal })
    expect(t.pending[0].options.signal).toBe(ac.signal)
  })
})

describe('visionTestService — 검사·크기', () => {
  it('입력이 틀리면 400 — 클라이언트를 부르지 않고 자리도 잡지 않는다', async () => {
    const t = make({ auto: (e) => e.resolve(VISION_OK) })
    expect((await caught(vision(t.service, 'u1', { accept: 2 }))).code).toBe('BAD_REQUEST')
    expect((await caught(ocr(t.service, 'u1', { op: 1, text: 'A@' }))).code).toBe('BAD_REQUEST')
    expect(t.pending).toHaveLength(0)
    expect((await vision(t.service, 'u1')).results).toHaveLength(1) // 같은 사용자가 바로 다시 된다
  })
  it('직렬화한 요청이 4,194,304바이트면 보내고, 1바이트라도 넘으면 413 VISION_TOO_LARGE — 보내지 않는다', async () => {
    const t = make({ auto: (e) => e.resolve(OCR_OK) })
    const overhead = real.requestBytes('ocr', { sourceImage: Buffer.alloc(MIB4 - 100), param: { OcrValueType: 1, OcrOperation: 1, TextValue: 'READY', MinMatchingValue: 10, NumberValue: 0, NumberRangeMin: 0, NumberRangeMax: 0 } }) - (MIB4 - 100)
    const exact = Buffer.alloc(MIB4 - overhead)
    expect((await t.service.ocr(user('u1'), { source: exact, meta: { op: 1, text: 'READY' } })).bytes).toBe(MIB4)
    const e = await caught(t.service.ocr(user('u1'), { source: Buffer.alloc(MIB4 - overhead + 1), meta: { op: 1, text: 'READY' } }))
    expect([e.statusCode, e.code, e.details]).toEqual([413, 'VISION_TOO_LARGE', { bytes: MIB4 + 1, maxBytes: MIB4 }])
    expect(t.pending).toHaveLength(1)
  })
  it('Vision 은 그림 둘의 합으로 넘는다', async () => {
    const t = make({ auto: (e) => e.resolve(VISION_OK) })
    const half = Buffer.alloc(MIB4 / 2)
    const e = await caught(t.service.vision(user('u1'), { source: half, train: half, meta: { accept: 0.9 } }))
    expect(e.code).toBe('VISION_TOO_LARGE')
    expect(e.details.bytes).toBeGreaterThan(MIB4)
    expect(t.pending).toHaveLength(0)
  })
})

describe('visionTestService — 자리', () => {
  it('Vision 은 한꺼번에 둘까지(기본) — 셋째는 기다리지 않고 429 VISION_BUSY, 하나가 끝나면 다시 된다', async () => {
    const t = make()
    const a = vision(t.service, 'u1')
    const b = vision(t.service, 'u2')
    await settle()
    const e = await caught(vision(t.service, 'u3'))
    expect([e.statusCode, e.code, e.details]).toEqual([429, 'VISION_BUSY', { scope: 'server' }])
    expect(t.pending).toHaveLength(2)
    t.pending[0].resolve(VISION_OK)
    await a
    const c = vision(t.service, 'u3')
    await settle()
    expect(t.pending).toHaveLength(3)
    t.pending[1].resolve(VISION_OK)
    t.pending[2].resolve(VISION_OK)
    await Promise.all([b, c])
  })
  it('OCR 은 한 번에 하나(판정 서버가 한 번에 하나씩 돈다) — Vision 자리와는 따로다', async () => {
    const t = make()
    const a = ocr(t.service, 'u1')
    await settle()
    expect((await caught(ocr(t.service, 'u2'))).details).toEqual({ scope: 'server' })
    const v1 = vision(t.service, 'u2')
    const v2 = vision(t.service, 'u3')
    await settle()
    expect(t.pending.map((p) => p.rpc)).toEqual(['ocr', 'vision', 'vision'])
    for (const p of t.pending) p.resolve(p.rpc === 'ocr' ? OCR_OK : VISION_OK)
    await Promise.all([a, v1, v2])
  })
  it('사용자 한 명은 한 번에 하나 — 종류가 달라도 429(scope user)', async () => {
    const t = make()
    const a = vision(t.service, 'u1')
    await settle()
    expect((await caught(vision(t.service, 'u1'))).details).toEqual({ scope: 'user' })
    expect((await caught(ocr(t.service, 'u1'))).details).toEqual({ scope: 'user' })
    expect(t.pending).toHaveLength(1)
    t.pending[0].resolve(VISION_OK)
    await a
    const again = ocr(t.service, 'u1')
    await settle()
    t.pending[1].resolve(OCR_OK)
    expect((await again).accepted).toBe(true)
  })
  it('실패·끊김 뒤에도 자리가 빈다', async () => {
    const t = make({ env: { SE_VISION_TEST_CONCURRENCY: '1' } })
    const a = vision(t.service, 'u1')
    await settle()
    t.pending[0].reject(seError(502, 'VISION_NO_ANSWER', 'x'))
    expect((await caught(a)).code).toBe('VISION_NO_ANSWER')
    const b = vision(t.service, 'u1')
    await settle()
    t.pending[1].reject(seError(499, 'VISION_CANCELLED', 'x'))
    expect((await caught(b)).code).toBe('VISION_CANCELLED')
    const c = vision(t.service, 'u2')
    await settle()
    expect(t.pending).toHaveLength(3)
    t.pending[2].resolve(VISION_OK)
    await c
  })
  it('429 는 돌고 있는 시험의 자리를 건드리지 않는다', async () => {
    const t = make({ env: { SE_VISION_TEST_CONCURRENCY: '1' } })
    const a = vision(t.service, 'u1')
    await settle()
    for (let i = 0; i < 3; i++) expect((await caught(vision(t.service, 'u2'))).code).toBe('VISION_BUSY')
    expect((await caught(vision(t.service, 'u1'))).details).toEqual({ scope: 'user' }) // u1 은 여전히 돌고 있다
    t.pending[0].resolve(VISION_OK)
    await a
  })
  it('SE_VISION_TEST_CONCURRENCY: 1~16 의 정수를 쓴다. 틀린 값(0·17·글자·소수)은 2', async () => {
    const count = async (env) => {
      const t = make({ env })
      const runs = []
      for (let i = 0; i < 20; i++) runs.push(caught(vision(t.service, `u${i}`).then(() => { throw new Error('ok') })))
      await settle()
      const n = t.pending.length
      for (const p of t.pending) p.resolve(VISION_OK)
      await Promise.all(runs)
      return n
    }
    expect(await count({ SE_VISION_TEST_CONCURRENCY: '1' })).toBe(1)
    expect(await count({ SE_VISION_TEST_CONCURRENCY: '16' })).toBe(16)
    for (const bad of ['0', '17', 'abc', '2.5', '', '-1']) expect(await count({ SE_VISION_TEST_CONCURRENCY: bad }), bad).toBe(2)
    expect(await count({})).toBe(2)
  })
})

describe('visionTestService — 기록', () => {
  it('시험마다 한 줄: 종류·사용자·무엇을 시험했는지·결과·시간·바이트 — 그림·OCR 값·읽은 글은 남기지 않는다', async () => {
    const t = make({ auto: (e) => { t.tick(300); e.resolve(e.rpc === 'ocr' ? OCR_OK : VISION_OK) } })
    await vision(t.service, 'kim', { accept: 0.9, about: { process: 'SEWCVD', model: 'M1', scenario: 'S1', step: 3 } })
    await ocr(t.service, 'kim', { op: 1, text: 'TOP-SECRET-VALUE', about: { scenario: 'S2', step: 1 } })
    expect(t.logs).toHaveLength(2)
    const [a, b] = t.logs.map(([level, m]) => { expect(level).toBe('info'); return m })
    for (const part of ['vision', 'kim', 'SEWCVD/M1/S1#3', '1곳', '300ms']) expect(a).toContain(part)
    for (const part of ['ocr', 'kim', '-/-/S2#1', '맞음', '300ms']) expect(b).toContain(part)
    expect(b).not.toContain('TOP-SECRET-VALUE')
    expect(b).not.toContain('SECRET-READ')
    expect(a).not.toContain('source-png')
  })
  it('실패도 한 줄(code 와 gRPC 상태) — 끊은 것도', async () => {
    const t = make()
    const p = vision(t.service, 'kim')
    await settle()
    t.tick(10050)
    t.pending[0].reject(Object.assign(seError(502, 'VISION_NO_ANSWER', 'x'), { upstream: { status: 13, details: 'addr 10.1.2.3:9300' } }))
    await caught(p)
    expect(t.logs).toHaveLength(1)
    for (const part of ['vision', 'kim', 'VISION_NO_ANSWER', 'status=13', '10050ms']) expect(t.logs[0][1]).toContain(part)
    expect(t.logs[0][1]).not.toContain('10.1.2.3') // details 는 클라이언트의 로그 줄에만 있다
  })
  it('검사·크기·자리에서 막힌 것은 기록하지 않는다(판정 서버에 가지 않았다)', async () => {
    const t = make()
    await caught(vision(t.service, 'u1', { accept: 5 }))
    expect(t.logs).toEqual([])
  })
})

// POST /vision-test·/ocr-test (P4 설계 §5.2·§6) — 등록된 사용자면 시험한다(WRITE·읽기 전용 서버를 보지 않는다). 브라우저가 끊으면 판정 호출을 취소한다.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { seError } = require('../errors')

let server
let app
let base
const fake = {}
let calls
beforeAll(async () => {
  process.env.SE_USER_SINGLEID = 'sew_multi'
  process.env.SE_DEV_USER_OVERRIDE = '1'
  require('../deps')._setDeps(fake)
  app = require('../../../app')
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r) })
  base = `http://127.0.0.1:${server.address().port}/api/scenario-editor`
})
afterAll(() => { require('../deps')._setDeps(null); server.closeAllConnections(); return new Promise((r) => server.close(r)) })

const READERS = { sew_reader: { authority: 'READ', canWrite: false } }
beforeEach(() => {
  calls = []
  Object.assign(fake, {
    users: { getUser: async (id) => (id === 'sew_none' ? null : { singleid: id, canWrite: true, authorityManager: 3, ...READERS[id] }) },
    visionTest: {
      vision: async (user, input, options) => { calls.push({ kind: 'vision', user, input, options }); return { results: [{ score: 0.97, x: 12.5, y: 40 }], ms: 412, bytes: 5000 } },
      ocr: async (user, input, options) => { calls.push({ kind: 'ocr', user, input, options }); return { accepted: true, found: 'READY', confidence: ':95', ms: 900, bytes: 4000 } }
    }
  })
})

const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const png = (label) => Buffer.concat([PNG_HEAD, Buffer.from(label)])
function form(meta, files) {
  const fd = new FormData()
  fd.append('meta', JSON.stringify(meta))
  for (const [name, buf] of files) fd.append(name, new Blob([buf], { type: 'image/png' }), `${name}.png`)
  return fd
}
const post = (path, meta, files, init = {}) => fetch(`${base}${path}`, { method: 'POST', body: form(meta, files), ...init })

describe('POST /vision-test', () => {
  it('그림 둘과 meta 를 서비스에 넘기고 { success, data } 로 답한다', async () => {
    const res = await post('/vision-test', { accept: 0.9, about: { scenario: 'S1' } }, [['source', png('src')], ['train', png('trn')]])
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, data: { results: [{ score: 0.97, x: 12.5, y: 40 }], ms: 412, bytes: 5000 } })
    expect(calls).toHaveLength(1)
    expect(calls[0].user.singleid).toBe('sew_multi')
    expect(calls[0].input.source.equals(png('src'))).toBe(true)
    expect(calls[0].input.train.equals(png('trn'))).toBe(true)
    expect(calls[0].input.meta).toEqual({ accept: 0.9, about: { scenario: 'S1' } })
    expect(calls[0].options.signal).toBeInstanceOf(AbortSignal)
    expect(calls[0].options.signal.aborted).toBe(false)
  })
  it('WRITE 권한이 없는 사용자도, 쓰기를 받지 않는 서버(seWriteDisabled)에서도 된다 — 시험은 쓰지 않는다', async () => {
    const files = [['source', png('s')], ['train', png('t')]]
    expect((await post('/vision-test', { accept: 1 }, files, { headers: { 'X-SE-User': 'sew_reader' } })).status).toBe(200)
    app.locals.seWriteDisabled = true
    try {
      expect((await post('/vision-test', { accept: 1 }, files, { headers: { 'X-SE-User': 'sew_reader' } })).status).toBe(200)
      expect((await post('/ocr-test', { op: 1, text: 'A' }, [['source', png('s')]], { headers: { 'X-SE-User': 'sew_reader' } })).status).toBe(200)
    } finally {
      app.locals.seWriteDisabled = false
    }
  })
  it('미등록 사용자는 403 USER_NOT_REGISTERED — 서비스에 닿지 않는다', async () => {
    const res = await post('/vision-test', { accept: 1 }, [['source', png('s')], ['train', png('t')]], { headers: { 'X-SE-User': 'sew_none' } })
    expect([res.status, (await res.json()).code]).toEqual([403, 'USER_NOT_REGISTERED'])
    expect(calls).toEqual([])
  })
  it('서비스의 오류 code·details 가 응답에 나간다 — upstream(gRPC 상태·주소)은 나가지 않는다', async () => {
    fake.visionTest.vision = async () => { throw Object.assign(seError(502, 'VISION_NO_ANSWER', '판정 서버가 10초 안에 답하지 않았습니다'), { upstream: { status: 13, details: 'at 10.9.8.7:9300' } }) }
    const res = await post('/vision-test', { accept: 1 }, [['source', png('s')], ['train', png('t')]])
    const text = await res.text()
    expect(res.status).toBe(502)
    expect(JSON.parse(text)).toMatchObject({ code: 'VISION_NO_ANSWER', error: '판정 서버가 10초 안에 답하지 않았습니다' })
    expect(text).not.toContain('10.9.8.7')
    expect(text).not.toContain('upstream')
    fake.visionTest.vision = async () => { throw seError(429, 'VISION_BUSY', '다른 시험이 돌고 있습니다', { scope: 'user' }) }
    const busy = await post('/vision-test', { accept: 1 }, [['source', png('s')], ['train', png('t')]])
    expect([busy.status, await busy.json()]).toEqual([429, expect.objectContaining({ code: 'VISION_BUSY', details: { scope: 'user' } })])
  })
  it('train 이 없으면 400 — 서비스에 닿지 않는다', async () => {
    const res = await post('/vision-test', { accept: 1 }, [['source', png('s')]])
    expect([res.status, (await res.json()).code]).toEqual([400, 'BAD_REQUEST'])
    expect(calls).toEqual([])
  })
  it('브라우저가 응답을 받기 전에 끊으면 서비스의 signal 이 끊긴다', async () => {
    let arrived
    const onArrive = new Promise((resolve) => { arrived = resolve })
    let signal
    fake.visionTest.vision = (user, input, options) => new Promise((resolve, reject) => {
      signal = options.signal
      options.signal.addEventListener('abort', () => reject(seError(499, 'VISION_CANCELLED', '판정 시험을 끊었습니다')))
      arrived()
    })
    const ac = new AbortController()
    const pending = post('/vision-test', { accept: 1 }, [['source', png('s')], ['train', png('t')]], { signal: ac.signal }).catch((e) => e.name)
    await onArrive
    expect(signal.aborted).toBe(false)
    ac.abort()
    expect(await pending).toBe('AbortError')
    await expect.poll(() => signal.aborted).toBe(true)
    // 서버는 살아 있다
    expect((await fetch(`${base}/me`)).status).toBe(200)
  })
})

describe('POST /ocr-test', () => {
  it('그림 하나와 meta 를 서비스에 넘긴다', async () => {
    const res = await post('/ocr-test', { op: 3, text: 'READY', multi: { count: 2, op: 1 } }, [['source', png('ocr')]])
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ accepted: true, found: 'READY', confidence: ':95', ms: 900, bytes: 4000 })
    expect(calls[0].kind).toBe('ocr')
    expect(calls[0].input.source.equals(png('ocr'))).toBe(true)
    expect(calls[0].input.meta).toEqual({ op: 3, text: 'READY', multi: { count: 2, op: 1 } })
    expect(calls[0].options.signal).toBeInstanceOf(AbortSignal)
  })
  it('train 을 함께 보내면 400', async () => {
    expect((await post('/ocr-test', { op: 1, text: 'A' }, [['source', png('s')], ['train', png('t')]])).status).toBe(400)
  })
  it('그림이 4 MiB 를 넘으면 413 VISION_TOO_LARGE', async () => {
    const big = Buffer.concat([PNG_HEAD, Buffer.alloc(4 * 1024 * 1024)])
    const res = await post('/ocr-test', { op: 1, text: 'A' }, [['source', big]])
    expect([res.status, (await res.json()).code]).toEqual([413, 'VISION_TOO_LARGE'])
    expect(calls).toEqual([])
  })
})

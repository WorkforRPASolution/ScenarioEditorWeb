import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { createRequire } from 'node:module'
import http from 'node:http'
const require = createRequire(import.meta.url)
const { startFaultProxy } = require('../fault-proxy')

// 가짜 InterfaceServer: 받은 요청을 적고 성공 JSON 으로 답한다.
function startTarget() {
  const seen = []
  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const rec = { method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString(), answered: false }
      seen.push(rec)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('{"success":"true","message":""}', () => { rec.answered = true })
    })
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ seen, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) })))
}

// 연결을 다시 쓰지 않는 클라이언트(요청마다 새 소켓) — 모드를 바꾼 직후에도 결과가 흔들리지 않는다.
function send(url, body, { timeoutMs = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${url}/EARS/Interface`, { method: 'POST', agent: false, headers: { 'Content-Type': 'application/json', function: 'setscenario', 'Content-Length': Buffer.byteLength(body) } }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString() }))
      res.on('error', reject)
    })
    req.setTimeout(timeoutMs, () => req.destroy(Object.assign(new Error('timeout'), { code: 'TIMEOUT' })))
    req.on('error', reject)
    req.end(body)
  })
}

describe('startFaultProxy — 모드마다 클라이언트가 받는 결과', () => {
  let target
  let proxy
  beforeAll(async () => { target = await startTarget() })
  afterAll(async () => { await target.close() })
  afterEach(async () => {
    if (proxy) await proxy.close()
    proxy = null
    target.seen.length = 0
  })

  it('pass: 그대로 중계한다(경로·머리글·본문, 응답 상태·본문)', async () => {
    proxy = await startFaultProxy({ target: target.url })
    expect(proxy.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    const r = await send(proxy.url, '{"a":1}')
    expect(r).toEqual({ status: 200, text: '{"success":"true","message":""}' })
    expect(target.seen).toHaveLength(1)
    expect(target.seen[0]).toMatchObject({ method: 'POST', url: '/EARS/Interface', body: '{"a":1}' })
    expect(target.seen[0].headers.function).toBe('setscenario')
  })

  it('down: 연결이 거부되고, 다른 모드로 바꾸면 같은 주소로 다시 받는다', async () => {
    proxy = await startFaultProxy({ target: target.url })
    const url = proxy.url
    await proxy.setMode('down')
    await expect(send(url, '{}')).rejects.toMatchObject({ code: 'ECONNREFUSED' })
    expect(target.seen).toHaveLength(0)
    await proxy.setMode('pass')
    expect(proxy.url).toBe(url)
    expect((await send(url, '{}')).status).toBe(200)
  })

  it('hang: 본문을 받고 답하지 않는다(InterfaceServer 로 보내지 않음)', async () => {
    proxy = await startFaultProxy({ target: target.url })
    await proxy.setMode('hang')
    await expect(send(proxy.url, '{"b":2}', { timeoutMs: 300 })).rejects.toMatchObject({ code: 'TIMEOUT' })
    expect(target.seen).toHaveLength(0)
  })

  it('slow500: InterfaceServer 가 다 받고 답한 뒤 클라이언트에는 500', async () => {
    proxy = await startFaultProxy({ target: target.url })
    await proxy.setMode('slow500')
    const r = await send(proxy.url, '{"c":3}')
    expect(r.status).toBe(500)
    expect(target.seen).toHaveLength(1)
    expect(target.seen[0].body).toBe('{"c":3}')
    expect(target.seen[0].answered).toBe(true)
  })

  it('dropAfter: InterfaceServer 가 다 받고 답한 뒤 응답 없이 클라이언트 소켓을 끊는다', async () => {
    proxy = await startFaultProxy({ target: target.url })
    await proxy.setMode('dropAfter')
    await expect(send(proxy.url, '{"d":4}')).rejects.toMatchObject({ code: 'ECONNRESET' })
    expect(target.seen).toHaveLength(1)
    expect(target.seen[0].body).toBe('{"d":4}')
    expect(target.seen[0].answered).toBe(true)
  })

  it('close: 매달린 연결도 끊고 더는 받지 않는다', async () => {
    proxy = await startFaultProxy({ target: target.url })
    const url = proxy.url
    await proxy.setMode('hang')
    const hanging = send(url, '{}', { timeoutMs: 10000 })
    await new Promise((r) => setTimeout(r, 50))
    await proxy.close()
    proxy = null
    await expect(hanging).rejects.toMatchObject({ code: 'ECONNRESET' })
    await expect(send(url, '{}')).rejects.toMatchObject({ code: 'ECONNREFUSED' })
  })

  it('모르는 모드는 던진다', async () => {
    proxy = await startFaultProxy({ target: target.url })
    await expect(proxy.setMode('slow')).rejects.toThrow(/모드/)
  })
})

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { createRequire } from 'node:module'
import http from 'node:http'
const require = createRequire(import.meta.url)
const { startFaultProxyServer, parseArgs } = require('../fault-proxy-server')

// E2E 가 따로 띄우는 고장 주입 중계(Playwright webServer). 중계 주소는 서버의 EARS_INTERFACE_URL 이 되고, 시험은 제어 주소로 모드를 바꾼다.
function startTarget() {
  const seen = []
  const server = http.createServer((req, res) => {
    req.resume()
    req.on('end', () => {
      seen.push(req.url)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('{"success":"true","message":""}')
    })
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ seen, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) })))
}
function request(url, { method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, agent: false }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString() }))
    })
    req.on('error', reject)
    req.end(body)
  })
}

describe('startFaultProxyServer — 중계 + 제어 포트', () => {
  let target
  let srv
  beforeAll(async () => { target = await startTarget() })
  afterAll(async () => { await target.close() })
  afterEach(async () => {
    if (srv) await srv.close()
    srv = null
    target.seen.length = 0
  })

  it('처음은 pass: 제어 GET /health 가 모드를 알리고, 중계는 그대로 보낸다', async () => {
    srv = await startFaultProxyServer({ target: target.url })
    expect(srv.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(srv.controlUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(await request(`${srv.controlUrl}/health`)).toEqual({ status: 200, text: '{"mode":"pass"}' })
    expect((await request(`${srv.url}/EARS/Interface`, { method: 'POST', body: '{}' })).status).toBe(200)
    expect(target.seen).toEqual(['/EARS/Interface'])
  })

  it('PUT /mode/slow500 뒤에는 InterfaceServer 가 받은 뒤 500, PUT /mode/pass 로 되돌린다', async () => {
    srv = await startFaultProxyServer({ target: target.url })
    expect(await request(`${srv.controlUrl}/mode/slow500`, { method: 'PUT' })).toEqual({ status: 200, text: '{"mode":"slow500"}' })
    expect((await request(`${srv.url}/EARS/Interface`, { method: 'POST', body: '{}' })).status).toBe(500)
    expect(target.seen).toHaveLength(1)
    expect((await request(`${srv.controlUrl}/mode/pass`, { method: 'PUT' })).status).toBe(200)
    expect((await request(`${srv.url}/EARS/Interface`, { method: 'POST', body: '{}' })).status).toBe(200)
    expect(await request(`${srv.controlUrl}/health`)).toEqual({ status: 200, text: '{"mode":"pass"}' })
  })

  it('모르는 모드·경로는 400·404 이고 모드는 그대로', async () => {
    srv = await startFaultProxyServer({ target: target.url })
    const bad = await request(`${srv.controlUrl}/mode/slow`, { method: 'PUT' })
    expect(bad.status).toBe(400)
    expect(bad.text).toMatch(/모드/)
    expect((await request(`${srv.controlUrl}/nope`)).status).toBe(404)
    expect(await request(`${srv.controlUrl}/health`)).toEqual({ status: 200, text: '{"mode":"pass"}' })
  })

  it('close 뒤에는 중계·제어 모두 받지 않는다', async () => {
    srv = await startFaultProxyServer({ target: target.url })
    const { url, controlUrl } = srv
    await srv.close()
    srv = null
    await expect(request(`${controlUrl}/health`)).rejects.toMatchObject({ code: 'ECONNREFUSED' })
    await expect(request(`${url}/EARS/Interface`, { method: 'POST', body: '{}' })).rejects.toMatchObject({ code: 'ECONNREFUSED' })
  })
})

describe('parseArgs — 명령줄', () => {
  it('--target·--port·--control', () => {
    expect(parseArgs(['--target', 'http://localhost:8080', '--port', '3197', '--control', '3198'])).toEqual({ target: 'http://localhost:8080', port: 3197, controlPort: 3198 })
  })
  it('target 이 없거나 포트가 숫자가 아니면 던진다', () => {
    expect(() => parseArgs(['--port', '3197', '--control', '3198'])).toThrow(/--target/)
    expect(() => parseArgs(['--target', 'http://x', '--port', 'abc', '--control', '3198'])).toThrow(/--port/)
  })
})

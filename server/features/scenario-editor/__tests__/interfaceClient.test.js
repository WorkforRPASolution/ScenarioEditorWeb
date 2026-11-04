import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import http from 'node:http'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { setScenario, _setDeps } = require('../clients/interfaceClient')

const scenario = { process: 'P', model: 'M', name: 'N', body: '{"a":1}', bi: '{"b":2}', property: '{}' }
const respondWith = (text, status = 200) => async () => new Response(text, { status })
const OK = '{"success":"true","message":""}'
// 신호가 끊을 때까지 답하지 않는 서버
const hang = (url, init) => new Promise((_, reject) => { init.signal.addEventListener('abort', () => reject(init.signal.reason)) })

const saved = {}
beforeEach(() => {
  for (const k of ['EARS_INTERFACE_URL', 'EARS_INTERFACE_TIMEOUT_MS']) { saved[k] = process.env[k]; delete process.env[k] }
})
afterEach(() => {
  for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  _setDeps({ fetch: globalThis.fetch })
})

describe('setScenario 요청', () => {
  it('scenario / setscenario 로 세 JSON 을 문자열로 담아 보낸다', async () => {
    process.env.EARS_INTERFACE_URL = 'http://is:9000'
    const calls = []
    _setDeps({ fetch: async (url, init) => { calls.push({ url, init }); return new Response(OK) } })
    await setScenario(scenario)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('http://is:9000/EARS/Interface')
    expect(calls[0].init.method).toBe('POST')
    expect(calls[0].init.headers).toMatchObject({ 'Content-Type': 'application/json', category: 'scenario', function: 'setscenario' })
    expect(JSON.parse(calls[0].init.body)).toEqual({ Process: 'P', Model: 'M', SCName: 'N', BI: '{"b":2}', Body: '{"a":1}', Property: '{}' })
  })
  it('주소 설정이 없으면 설계 기본값으로 보낸다', async () => {
    let seen
    _setDeps({ fetch: async (url) => { seen = url; return new Response(OK) } })
    await setScenario(scenario)
    expect(seen).toBe('http://localhost:8080/EARS/Interface')
  })
  it('성공 응답이면 예외 없이 끝난다', async () => {
    _setDeps({ fetch: respondWith(OK) })
    await expect(setScenario(scenario)).resolves.toBeUndefined()
  })
})

describe('응답 해석 (공통 설계 §7.2)', () => {
  it.each([
    ['업무 실패(200 + success "false")', respondWith('{"success":"false","message":"x"}'), 502, 'UPSTREAM_FAILED'],
    ['success 가 문자열 "true" 가 아님', respondWith('{"success":true}'), 502, 'UPSTREAM_FAILED'],
    ['success 없음', respondWith('{"message":""}'), 502, 'UPSTREAM_FAILED'],
    ['JSON 이 아닌 200', respondWith('<html>'), 502, 'UPSTREAM_FAILED'],
    ['JSON null', respondWith('null'), 502, 'UPSTREAM_FAILED'],
    ['HTTP 413', respondWith('too big', 413), 502, 'UPSTREAM_FAILED'],
    ['HTTP 500 (10초 askTimeout)', respondWith('There was an internal server error.', 500), 504, 'UPSTREAM_TIMEOUT'],
    ['연결 거부', async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }) }, 503, 'UPSTREAM_DOWN']
  ])('%s', async (_, fake, statusCode, code) => {
    _setDeps({ fetch: fake })
    await expect(setScenario(scenario)).rejects.toMatchObject({ statusCode, code })
  })
  it('사용자 문구에 서버가 준 내부 정보를 싣지 않고, 원문은 upstream 으로 넘긴다', async () => {
    _setDeps({ fetch: respondWith('{"success":"false","message":"cannot reach 10.0.0.1:27017"}') })
    const e = await setScenario(scenario).catch((x) => x)
    expect(e.message).not.toContain('10.0.0.1')
    expect(e.upstream).toMatchObject({ status: 200 })
    expect(e.upstream.text).toContain('10.0.0.1')
  })
  it('연결 실패 원인도 문구에 싣지 않고 upstream 으로 넘긴다', async () => {
    _setDeps({ fetch: async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }) } })
    const e = await setScenario(scenario).catch((x) => x)
    expect(e.message).not.toContain('ECONNREFUSED')
    expect(e.upstream.text).toContain('ECONNREFUSED')
  })
})

describe('끊김: 503 은 요청이 가지 않았을 때만이다 (저장 = 배포라 다시 보내도 되는지가 갈린다)', () => {
  const serve = (handler) => new Promise((resolve) => { const s = http.createServer(handler); s.listen(0, '127.0.0.1', () => resolve(s)) })
  const urlOf = (s) => `http://127.0.0.1:${s.address().port}`
  const closing = []
  afterEach(async () => { await Promise.all(closing.splice(0).map((s) => new Promise((r) => { s.closeAllConnections(); s.close(r) }))) })

  it('서버가 요청을 다 받은 뒤 끊으면 결과를 모르는 504 다', async () => {
    const server = await serve((req) => { req.resume(); req.on('end', () => req.socket.destroy()) })
    closing.push(server)
    process.env.EARS_INTERFACE_URL = urlOf(server)
    await expect(setScenario(scenario)).rejects.toMatchObject({ statusCode: 504, code: 'UPSTREAM_TIMEOUT' })
  })
  it('200 머리글 뒤 본문 중간에 끊겨도 504 다', async () => {
    const server = await serve((req, res) => { req.resume(); req.on('end', () => { res.writeHead(200); res.write('{"succ', () => req.socket.destroy()) }) })
    closing.push(server)
    process.env.EARS_INTERFACE_URL = urlOf(server)
    await expect(setScenario(scenario)).rejects.toMatchObject({ statusCode: 504, code: 'UPSTREAM_TIMEOUT', upstream: { status: 200 } })
  })
  it.each(['127.0.0.1', 'localhost'])('닫힌 포트(%s)는 요청이 가지 않았으니 503 이다', async (host) => {
    const server = await serve(() => {})
    const { port } = server.address()
    await new Promise((r) => server.close(r))
    process.env.EARS_INTERFACE_URL = `http://${host}:${port}`
    await expect(setScenario(scenario)).rejects.toMatchObject({ statusCode: 503, code: 'UPSTREAM_DOWN' })
  })
  it('주소 설정이 틀려 보내지 못했으면 503 이다', async () => {
    process.env.EARS_INTERFACE_URL = 'not a url'
    await expect(setScenario(scenario)).rejects.toMatchObject({ statusCode: 503, code: 'UPSTREAM_DOWN' })
  })
  it.each(['ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT'])('연결 단계 오류 %s 는 503 이다', async (code) => {
    _setDeps({ fetch: async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code } }) } })
    await expect(setScenario(scenario)).rejects.toMatchObject({ statusCode: 503, code: 'UPSTREAM_DOWN' })
  })
  it.each(['ECONNRESET', 'EPIPE', 'UND_ERR_SOCKET', undefined])('그 밖 끊김(%s)은 504 다', async (code) => {
    _setDeps({ fetch: async () => { throw Object.assign(new TypeError('fetch failed'), code ? { cause: { code } } : {}) } })
    await expect(setScenario(scenario)).rejects.toMatchObject({ statusCode: 504, code: 'UPSTREAM_TIMEOUT' })
  })
})

describe('시간 제한', () => {
  it('EARS_INTERFACE_TIMEOUT_MS 가 지나면 504 UPSTREAM_TIMEOUT', async () => {
    process.env.EARS_INTERFACE_TIMEOUT_MS = '5'
    _setDeps({ fetch: hang })
    await expect(setScenario(scenario)).rejects.toMatchObject({ statusCode: 504, code: 'UPSTREAM_TIMEOUT' })
  })
  it('호출별 timeoutMs 가 설정값보다 우선한다', async () => {
    process.env.EARS_INTERFACE_TIMEOUT_MS = '60000'
    _setDeps({ fetch: hang })
    await expect(setScenario(scenario, { timeoutMs: 5 })).rejects.toMatchObject({ code: 'UPSTREAM_TIMEOUT' })
  })
  it('응답 본문을 읽다가 시간이 지나도 504 다', async () => {
    _setDeps({ fetch: async () => ({ status: 200, text: async () => { throw new DOMException('t', 'TimeoutError') } }) })
    await expect(setScenario(scenario)).rejects.toMatchObject({ statusCode: 504, code: 'UPSTREAM_TIMEOUT' })
  })
})

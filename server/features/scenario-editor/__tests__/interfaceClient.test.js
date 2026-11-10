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
    ['HTTP 400', respondWith('bad request', 400), 502, 'UPSTREAM_FAILED'],
    ['HTTP 500 (10초 askTimeout)', respondWith('There was an internal server error.', 500), 504, 'UPSTREAM_TIMEOUT'],
    // akka-http request-timeout 은 503 으로 답하지만 작업자는 저장을 계속할 수 있다. 앞단 관문의 502·503·504 도 결과를 모른다.
    ['HTTP 503 (akka-http 요청 시간 초과)', respondWith('The server was not able to produce a timely response to your request.', 503), 504, 'UPSTREAM_TIMEOUT'],
    ['HTTP 502 (관문)', respondWith('Bad Gateway', 502), 504, 'UPSTREAM_TIMEOUT'],
    ['HTTP 504 (관문 시간 초과)', respondWith('Gateway Timeout', 504), 504, 'UPSTREAM_TIMEOUT'],
    ['HTTP 501', respondWith('Not Implemented', 501), 504, 'UPSTREAM_TIMEOUT'],
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
  it('5xx 결과 모름도 받은 상태·원문을 upstream 으로 넘긴다', async () => {
    _setDeps({ fetch: respondWith('timely response', 503) })
    const e = await setScenario(scenario).catch((x) => x)
    expect(e).toMatchObject({ statusCode: 504, code: 'UPSTREAM_TIMEOUT', upstream: { status: 503, text: 'timely response' } })
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
  // http:// 없이 이름:포트만 적으면 fetch 가 이름을 scheme 으로 읽어 "unknown scheme" 으로 던진다 — 보낸 적이 없으니 결과 모름(504)이 아니다
  it.each(['is-host:8080', 'localhost:8080', 'ftp://is-host:8080'])('http(s) 로 시작하지 않는 주소(%s)는 보내지 않았으니 503 이다', async (url) => {
    process.env.EARS_INTERFACE_URL = url
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

// --- 흘려 보내기·삭제 (P2-B Task 5) — 실제 로컬 http 서버로 받은 머리글·본문을 본다 ---
describe('setScenarioStream·delScenario (실제 http 서버)', () => {
  const { setScenarioStream, delScenario, countUtf8Bytes } = require('../clients/interfaceClient')
  let server
  let received
  let handler
  const start = async (h) => {
    handler = h
    received = undefined
    server = http.createServer((req, res) => {
      const rec = { headers: req.headers, chunks: [], aborted: false, ended: false }
      received = rec
      req.on('data', (d) => rec.chunks.push(d))
      req.on('aborted', () => { rec.aborted = true })
      req.on('close', () => { rec.closed = true })
      req.on('end', () => { rec.ended = true; rec.body = Buffer.concat(rec.chunks).toString('utf8'); handler(req, res, rec) })
    })
    await new Promise((r) => server.listen(0, '127.0.0.1', r))
    process.env.EARS_INTERFACE_URL = `http://127.0.0.1:${server.address().port}`
  }
  afterEach(async () => {
    if (server) { server.closeAllConnections?.(); await new Promise((r) => server.close(r)); server = null }
  })
  const reply = (text, status = 200) => (req, res) => { res.statusCode = status; res.end(text) }
  const pieces = ['{"a":"가', '나다"}', '😀x']
  async function* gen() { for (const p of pieces) yield p }
  const bytes = Buffer.byteLength(pieces.join(''), 'utf8')

  it('Content-Length 를 contentLength 로 달고 chunked 없이 조각을 이은 본문을 보낸다', async () => {
    await start(reply(OK))
    await setScenarioStream({ chunks: gen, contentLength: bytes }, {})
    expect(received.headers['content-length']).toBe(String(bytes))
    expect(received.headers['transfer-encoding']).toBeUndefined()
    expect(received.headers).toMatchObject({ category: 'scenario', function: 'setscenario', 'content-type': 'application/json' })
    expect(Buffer.byteLength(received.body, 'utf8')).toBe(bytes)
    expect(received.body).toBe(pieces.join(''))
  })
  it('chunks 는 한 번만 부른다', async () => {
    await start(reply(OK))
    let n = 0
    await setScenarioStream({ chunks: () => { n++; return gen() }, contentLength: bytes }, {})
    expect(n).toBe(1)
  })
  it.each([
    ['200 success "false"', reply('{"success":"false"}'), 502, 'UPSTREAM_FAILED'],
    ['HTTP 500', reply('internal', 500), 504, 'UPSTREAM_TIMEOUT'],
    ['응답 전에 소켓을 끊음', (req, res) => { req.socket.destroy() }, 504, 'UPSTREAM_TIMEOUT']
  ])('%s', async (_, h, statusCode, code) => {
    await start(h)
    await expect(setScenarioStream({ chunks: gen, contentLength: bytes }, {})).rejects.toMatchObject({ statusCode, code })
  })
  it('연결 거부(닫힌 포트) → 503', async () => {
    await start(reply(OK))
    const closed = server.address().port
    await new Promise((r) => server.close(r)); server = null
    process.env.EARS_INTERFACE_URL = `http://127.0.0.1:${closed}`
    await expect(setScenarioStream({ chunks: gen, contentLength: bytes }, {})).rejects.toMatchObject({ statusCode: 503, code: 'UPSTREAM_DOWN' })
  })
  it('시간 초과 → 504', async () => {
    await start(() => {}) // 답하지 않는다
    await expect(setScenarioStream({ chunks: gen, contentLength: bytes }, { timeoutMs: 100 })).rejects.toMatchObject({ statusCode: 504, code: 'UPSTREAM_TIMEOUT' })
  })
  it('조각을 만들다 던지면 요청을 끊고 원래 오류를 그대로 던진다(저장 안 됨)', async () => {
    let finished = false
    await start(() => { finished = true })
    const boom = new Error('image read failed')
    async function* bad() { yield '{"a":"'.padEnd(1000, 'x'); yield 'y'.repeat(1000); await new Promise((r) => setTimeout(r, 100)); throw boom }
    let caught
    try { await setScenarioStream({ chunks: bad, contentLength: 5000 }, {}) } catch (e) { caught = e }
    expect(caught).toBe(boom)
    await new Promise((r) => setTimeout(r, 100))
    expect(finished).toBe(false) // 서버는 완전한 본문을 받지 못했다
    expect(received.ended).toBe(false)
    expect(received.closed).toBe(true)
    expect(Buffer.concat(received.chunks).length).toBeLessThan(5000)
  })
  describe('contentLength 가 어긋나면 완전한 본문을 보내지 않고 로컬 오류', () => {
    const run = async (chunksFn, contentLength) => {
      let finished = false
      await start(() => { finished = true })
      let caught
      try { await setScenarioStream({ chunks: chunksFn, contentLength }, {}) } catch (e) { caught = e }
      await new Promise((r) => setTimeout(r, 100))
      expect(finished).toBe(false)
      if (received) {
        expect(received.ended).toBe(false)
        expect(Buffer.concat(received.chunks).length).toBeLessThan(contentLength)
      }
      return caught
    }
    it('짧음(contentLength = 실제 + 5)', async () => {
      const e = await run(gen, bytes + 5)
      expect(e).toMatchObject({ code: 'CONTENT_LENGTH_MISMATCH' })
      expect(e.statusCode).toBeUndefined()
    })
    it('김(contentLength = 실제 - 5)', async () => {
      expect(await run(gen, bytes - 5)).toMatchObject({ code: 'CONTENT_LENGTH_MISMATCH' })
    })
    it('조각 하나가 contentLength 에서 딱 끝나는데 뒤에 조각이 더 있음 — 그 조각을 보내지 않는다', async () => {
      const first = pieces[0]
      expect(await run(gen, Buffer.byteLength(first, 'utf8'))).toMatchObject({ code: 'CONTENT_LENGTH_MISMATCH' })
    })
    it('문자열이 아닌 조각', async () => {
      async function* weird() { yield 'abc'; yield 42 }
      expect(await run(weird, 10)).toMatchObject({ code: 'CONTENT_LENGTH_MISMATCH' })
    })
  })
  it('시간 초과로 끊으면 반복자 return() 을 부른다', async () => {
    await start(() => {})
    let returned = false
    const iter = { [Symbol.asyncIterator]() { let i = 0; return { next: async () => (i < 2 ? { value: pieces[i++], done: false } : new Promise(() => {})), return: async () => { returned = true; return { done: true } } } } }
    await expect(setScenarioStream({ chunks: () => iter, contentLength: bytes }, { timeoutMs: 100 })).rejects.toMatchObject({ code: 'UPSTREAM_TIMEOUT' })
    await new Promise((r) => setTimeout(r, 50))
    expect(returned).toBe(true)
  })
  it('delScenario 는 function delscenario 와 Process·Model·SCName 만 보낸다', async () => {
    await start(reply(OK))
    await expect(delScenario({ process: 'P', model: 'M', name: '한글' })).resolves.toBeUndefined()
    expect(received.headers).toMatchObject({ category: 'scenario', function: 'delscenario' })
    expect(JSON.parse(received.body)).toEqual({ Process: 'P', Model: 'M', SCName: '한글' })
  })
  it('countUtf8Bytes 는 UTF-8 바이트 수를 센다(대리쌍 포함)', async () => {
    expect(await countUtf8Bytes(gen())).toBe(bytes)
    expect(await countUtf8Bytes((async function* () {})())).toBe(0)
  })
})

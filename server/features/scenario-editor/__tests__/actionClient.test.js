// InterfaceServer /EARS/Action 호출(P5 설계 §5.3) — 받은 것을 그대로 돌려준다(뜻은 domain/testRun.classifyAction 이 붙인다)
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { createActionClient } = require('../clients/actionClient')

const REQ = { process: 'SEWCVD', model: 'SEWMODELA', eqpId: 'SEWT_CVD_A01', name: 'RUN_PROPS', line: 'SEWLINE1', txn: 1763427600000, body: '{"@UserInfo":"홍 - a"}' }
function fakeFetch(answer) {
  const calls = []
  const fetch = async (url, init) => {
    calls.push({ url, init })
    if (answer instanceof Error) throw answer
    return { status: answer.status, text: async () => answer.text }
  }
  return { fetch, calls }
}
const failed = (code, name = 'TypeError') => Object.assign(new Error('fetch failed'), { name, cause: code ? { code } : undefined })

describe('actionClient.send', () => {
  it('POST {주소}/EARS/Action — recovery 헤더와 본문을 그대로', async () => {
    const f = fakeFetch({ status: 200, text: '{"result":"Success","message":""}' })
    const client = createActionClient({ env: { EARS_INTERFACE_URL: 'http://is.local:8080/' }, fetch: f.fetch })
    expect(await client.send(REQ)).toEqual({ kind: 'response', status: 200, text: '{"result":"Success","message":""}' })
    const { url, init } = f.calls[0]
    expect(url).toBe('http://is.local:8080/EARS/Action')
    expect(init.method).toBe('POST')
    expect(init.redirect).toBe('manual')
    expect(init.body).toBe(REQ.body)
    expect(init.headers).toEqual({
      'Content-Type': 'application/json', category: 'recovery', process: 'SEWCVD', model: 'SEWMODELA', eqpid: 'SEWT_CVD_A01',
      name: 'RUN_PROPS', line: 'SEWLINE1', txn: '1763427600000', triggeredBy: 'SE'
    })
  })
  it('주소는 부를 때마다 읽고, 비어 있으면 http://localhost:8080', async () => {
    const env = {}
    const f = fakeFetch({ status: 200, text: '' })
    const client = createActionClient({ env, fetch: f.fetch })
    await client.send(REQ)
    env.EARS_INTERFACE_URL = 'http://127.0.0.1:3197'
    await client.send(REQ)
    expect(f.calls.map((c) => c.url)).toEqual(['http://localhost:8080/EARS/Action', 'http://127.0.0.1:3197/EARS/Action'])
  })
  it('오류 응답도 받은 그대로 준다(던지지 않는다)', async () => {
    const client = createActionClient({ env: {}, fetch: fakeFetch({ status: 500, text: 'There was an internal server error.' }).fetch })
    expect(await client.send(REQ)).toEqual({ kind: 'response', status: 500, text: 'There was an internal server error.' })
  })
  it('연결하기 전의 실패는 보내지 않은 것이다', async () => {
    for (const code of ['ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT', 'ERR_INVALID_URL']) {
      const client = createActionClient({ env: {}, fetch: fakeFetch(failed(code)).fetch })
      expect(await client.send(REQ)).toEqual({ kind: 'notSent', cause: code })
    }
  })
  it('fetch 가 막는 포트(bad port)는 보내지 않은 것이다', async () => {
    const e = Object.assign(new TypeError('fetch failed'), { cause: new Error('bad port') })
    expect(await createActionClient({ env: {}, fetch: fakeFetch(e).fetch }).send(REQ)).toEqual({ kind: 'notSent', cause: 'BAD_PORT' })
  })
  it('http:// 로 시작하지 않는 주소는 부르지 않고 보내지 않은 것으로', async () => {
    const f = fakeFetch({ status: 200, text: '' })
    const client = createActionClient({ env: { EARS_INTERFACE_URL: 'is.local:8080' }, fetch: f.fetch })
    expect(await client.send(REQ)).toEqual({ kind: 'notSent', cause: 'BAD_URL' })
    expect(f.calls).toHaveLength(0)
  })
  it('시간 초과·응답 전 끊김은 응답 없음이다(받았을 수 있다)', async () => {
    const timeout = createActionClient({ env: {}, fetch: fakeFetch(failed(null, 'TimeoutError')).fetch })
    expect(await timeout.send(REQ)).toEqual({ kind: 'noResponse', cause: 'TimeoutError' })
    const reset = createActionClient({ env: {}, fetch: fakeFetch(failed('ECONNRESET')).fetch })
    expect(await reset.send(REQ)).toEqual({ kind: 'noResponse', cause: 'ECONNRESET' })
  })
  it('본문을 읽다 끊겨도 응답 없음이다', async () => {
    const fetch = async () => ({ status: 200, text: async () => { throw failed('UND_ERR_SOCKET') } })
    expect(await createActionClient({ env: {}, fetch }).send(REQ)).toEqual({ kind: 'noResponse', cause: 'UND_ERR_SOCKET' })
  })
  it('시간 제한: EARS_ACTION_TIMEOUT_MS(1000~60000), 밖이거나 수가 아니면 12000', () => {
    const of = (v) => createActionClient({ env: { EARS_ACTION_TIMEOUT_MS: v }, fetch: async () => {} }).timeoutMs()
    expect(of(undefined)).toBe(12000)
    expect(of('5000')).toBe(5000)
    expect(of('1000')).toBe(1000)
    expect(of('60000')).toBe(60000)
    for (const v of ['999', '60001', 'abc', '', '0', '-5']) expect(of(v)).toBe(12000)
  })
  it('실패를 로그에 남긴다 — 주소는 싣지 않는다', async () => {
    const lines = []
    const client = createActionClient({ env: { EARS_INTERFACE_URL: 'http://secret-host:8080' }, fetch: fakeFetch(failed('ECONNREFUSED')).fetch, log: { warn: (m) => lines.push(m) } })
    await client.send(REQ)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('ECONNREFUSED')
    expect(lines[0]).not.toContain('secret-host')
  })
})

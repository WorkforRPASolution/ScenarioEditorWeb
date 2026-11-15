// 이력 서버(HttpWebServer) 호출 — 주소 없음·연결 실패·시간 초과·이력 없음·그 밖의 응답을 가른다 (P3 설계 §5.6)
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { createHistoryClient } = require('../clients/historyClient')

const URL_OK = 'http://10.1.2.3:8080'
const reply = (status, body, headers = {}) => ({ status, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, text: async () => body })
function make({ env = { HTTP_WEB_SERVER_URL: URL_OK }, respond = () => reply(200, '<html></html>'), ...rest } = {}) {
  const calls = []
  const logs = []
  const fetch = async (url, init) => { calls.push({ url, init }); return respond(url, init) }
  const client = createHistoryClient({ env, fetch, log: { warn: (m) => logs.push(m) }, ...rest })
  return { client, calls, logs }
}
const caught = async (p) => { try { await p } catch (e) { return e } throw new Error('던지지 않았다') }

describe('historyClient.fetchHtml', () => {
  it('GET {주소}/ARS/History/{설비}/{txn} — 설비·txn 은 경로에 맞게 싸고, 200 이면 본문을 준다', async () => {
    const { client, calls } = make({ respond: () => reply(200, '<table>x</table>') })
    expect(await client.fetchHtml('EQP 01/가', '1763254800000')).toBe('<table>x</table>')
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(`${URL_OK}/ARS/History/EQP%2001%2F%EA%B0%80/1763254800000`)
    expect(calls[0].init.method ?? 'GET').toBe('GET')
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal)
  })

  it('주소 끝의 빗금은 한 번만 붙는다. 주소는 부를 때마다 읽는다', async () => {
    const env = { HTTP_WEB_SERVER_URL: `${URL_OK}//` }
    const { client, calls } = make({ env })
    await client.fetchHtml('E1', '100000')
    env.HTTP_WEB_SERVER_URL = 'http://other:1'
    await client.fetchHtml('E1', '100000')
    expect(calls.map((c) => c.url)).toEqual([`${URL_OK}/ARS/History/E1/100000`, 'http://other:1/ARS/History/E1/100000'])
  })

  it('주소가 비어 있으면 부르지 않고 503 HISTORY_UNSET', async () => {
    for (const env of [{}, { HTTP_WEB_SERVER_URL: '' }, { HTTP_WEB_SERVER_URL: '   ' }]) {
      const { client, calls } = make({ env })
      const e = await caught(client.fetchHtml('E1', '100000'))
      expect([e.statusCode, e.code]).toEqual([503, 'HISTORY_UNSET'])
      expect(calls).toHaveLength(0)
    }
  })

  it('http:// 로 시작하지 않는 주소는 부르지 않고 503 HISTORY_DOWN', async () => {
    const { client, calls } = make({ env: { HTTP_WEB_SERVER_URL: 'hws:8080' } })
    const e = await caught(client.fetchHtml('E1', '100000'))
    expect([e.statusCode, e.code]).toEqual([503, 'HISTORY_DOWN'])
    expect(calls).toHaveLength(0)
  })

  it('연결하지 못하면 503 HISTORY_DOWN', async () => {
    for (const code of ['ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT']) {
      const { client } = make({ respond: () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code } }) } })
      const e = await caught(client.fetchHtml('E1', '100000'))
      expect([e.statusCode, e.code]).toEqual([503, 'HISTORY_DOWN'])
    }
  })

  it('시간 초과·응답 전 끊김은 504 HISTORY_TIMEOUT', async () => {
    const timeout = make({ respond: () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError') } })
    expect((await caught(timeout.client.fetchHtml('E1', '100000'))).code).toBe('HISTORY_TIMEOUT')
    const reset = make({ respond: () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }) } })
    const e = await caught(reset.client.fetchHtml('E1', '100000'))
    expect([e.statusCode, e.code]).toEqual([504, 'HISTORY_TIMEOUT'])
  })

  it('본문을 읽다 끊겨도 504 HISTORY_TIMEOUT', async () => {
    const { client } = make({ respond: () => ({ ...reply(200, ''), text: async () => { throw new TypeError('terminated') } }) })
    expect((await caught(client.fetchHtml('E1', '100000'))).code).toBe('HISTORY_TIMEOUT')
  })

  it('시간 제한은 만들 때 준 값(기본 15초)으로 건다', async () => {
    let seen = null
    const { client } = make({ timeoutMs: 30, respond: (url, init) => new Promise((resolve, reject) => { seen = init.signal; init.signal.addEventListener('abort', () => reject(init.signal.reason)) }) })
    const e = await caught(client.fetchHtml('E1', '100000'))
    expect(e.code).toBe('HISTORY_TIMEOUT')
    expect(seen.aborted).toBe(true)
  })

  it('500 "There is no data" 는 404 HISTORY_NOT_FOUND', async () => {
    const { client } = make({ respond: () => reply(500, 'There is no data') })
    const e = await caught(client.fetchHtml('E1', '100000'))
    expect([e.statusCode, e.code]).toEqual([404, 'HISTORY_NOT_FOUND'])
  })

  it('그 밖의 응답은 502 HISTORY_UNREADABLE — 서버가 준 글은 응답 문구에 싣지 않고 로그·upstream 에만', async () => {
    for (const [status, body] of [[500, "line 1:46 mismatched input 'OR' expecting EOF host=10.9.8.7"], [404, 'Not Found'], [302, ''], [204, '']]) {
      const { client, logs } = make({ respond: () => reply(status, body) })
      const e = await caught(client.fetchHtml('E1', '100000'))
      expect([e.statusCode, e.code]).toEqual([502, 'HISTORY_UNREADABLE'])
      expect(e.message).not.toContain('10.9.8.7')
      expect(e.message).not.toContain(URL_OK)
      expect(e.upstream.status).toBe(status)
      expect(logs.join('\n')).toContain(String(status))
    }
  })

  it('본문이 한도를 넘으면 502 HISTORY_UNREADABLE — 머리글로 알 수 있으면 본문을 읽지 않는다', async () => {
    let read = 0
    const big = make({ maxBytes: 10, respond: () => ({ ...reply(200, 'x', { 'content-length': '11' }), text: async () => { read++; return 'x'.repeat(11) } }) })
    expect((await caught(big.client.fetchHtml('E1', '100000'))).code).toBe('HISTORY_UNREADABLE')
    expect(read).toBe(0)
    const noHeader = make({ maxBytes: 10, respond: () => reply(200, 'x'.repeat(11)) })
    expect((await caught(noHeader.client.fetchHtml('E1', '100000'))).code).toBe('HISTORY_UNREADABLE')
    const fits = make({ maxBytes: 10, respond: () => reply(200, 'x'.repeat(10), { 'content-length': '10' }) })
    expect(await fits.client.fetchHtml('E1', '100000')).toBe('x'.repeat(10))
  })

  it('오류 문구에 주소를 싣지 않는다', async () => {
    const { client } = make({ respond: () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }) } })
    const e = await caught(client.fetchHtml('E1', '100000'))
    expect(e.message).not.toContain('10.1.2.3')
  })
})

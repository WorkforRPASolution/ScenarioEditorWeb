import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import http from 'node:http'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { createLocalGuard } = require('../localGuard')

const REFRESH = '/api/scenario-editor/cache/refresh'
const ME = '/api/scenario-editor/me'
const ALLOWED = 'http://localhost:5173' // app.js 기본값

let server
let port
let cleared
beforeAll(async () => {
  process.env.SE_USER_SINGLEID = 'sew_multi'
  delete process.env.ALLOWED_ORIGINS
  const user = { singleid: 'sew_multi', isMaster: false, multiProcess: null }
  require('../features/scenario-editor/deps')._setDeps({
    users: { getUser: async () => user, clear: () => { cleared++ } },
    scopes: { clear: () => { cleared++ } },
    imageCache: { clear: async () => {} }
  })
  const app = require('../app')
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r) })
  port = server.address().port
})
afterAll(() => { require('../features/scenario-editor/deps')._setDeps(null); return new Promise((r) => server.close(r)) })
beforeEach(() => { cleared = 0 })

// fetch 는 Host·Origin·Sec-Fetch-Site 를 직접 정할 수 없어 http.request 로 보낸다.
const send = (method, path, headers = {}) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
    let text = ''
    res.on('data', (c) => { text += c })
    res.on('end', () => resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null }))
  })
  req.on('error', reject)
  req.end()
})

describe('Host 허용 목록 (DNS rebinding 방어, 모든 요청)', () => {
  it.each([
    ['GET', ME, 'evil.example:3100'],
    ['POST', REFRESH, 'evil.example:3100'],
    ['GET', ME, 'localhost.evil.example'],
    ['GET', ME, '127.0.0.1.evil.example:3100'],
    ['GET', ME, 'localhost@evil.example']
  ])('%s %s Host %s → 403 이고 라우트에 닿지 않는다', async (method, path, host) => {
    const res = await send(method, path, { Host: host })
    expect(res.status).toBe(403)
    expect(res.body).toMatchObject({ code: 'HOST_FORBIDDEN' })
    expect(cleared).toBe(0)
  })
  it.each(['localhost:3100', '127.0.0.1:3100', '[::1]:3100', 'LOCALHOST:3100', 'localhost'])('Host %s 는 받는다', async (host) => {
    expect((await send('GET', ME, { Host: host })).status).toBe(200)
  })
})

describe('쓰기 요청의 출처 검사 (CSRF 방어)', () => {
  it.each([
    ['외부 Origin', { Origin: 'https://evil.example' }],
    ['Origin: null (sandbox·no-referrer)', { Origin: 'null' }],
    ['같은 이름의 다른 포트', { Origin: 'http://localhost:9999' }],
    ['Origin 없음 + cross-site', { 'Sec-Fetch-Site': 'cross-site' }],
    ['Origin 없음 + same-site', { 'Sec-Fetch-Site': 'same-site' }]
  ])('%s → 403 이고 라우트에 닿지 않는다', async (_, headers) => {
    const res = await send('POST', REFRESH, headers)
    expect(res.status).toBe(403)
    expect(res.body).toMatchObject({ code: 'ORIGIN_FORBIDDEN' })
    expect(cleared).toBe(0)
  })
  it.each([
    ['허용된 Origin', { Origin: ALLOWED }],
    ['Origin·Sec-Fetch-Site 없음 (도구)', {}],
    ['Origin 없음 + same-origin', { 'Sec-Fetch-Site': 'same-origin' }],
    ['Origin 없음 + none', { 'Sec-Fetch-Site': 'none' }]
  ])('%s → 처리한다', async (_, headers) => {
    expect((await send('POST', REFRESH, headers)).status).toBe(200)
    expect(cleared).toBe(2)
  })
  it('허용된 Origin 이어도 Host 가 틀리면 막는다', async () => {
    const res = await send('POST', REFRESH, { Origin: ALLOWED, Host: 'evil.example' })
    expect(res.body).toMatchObject({ code: 'HOST_FORBIDDEN' })
  })
  it('Origin 이 없는 읽기는 통과한다(<img> 는 Origin 을 보내지 않는다)', async () => {
    expect((await send('GET', ME, { 'Sec-Fetch-Site': 'cross-site' })).status).toBe(200)
  })
})

describe('허용되지 않은 Origin 은 메서드와 상관없이 막고 오류 기록에 남기지 않는다', () => {
  const { WebManagerLog } = require('../shared/models/webmanagerLogModel')
  it.each([
    ['GET', ME, {}],
    ['POST', REFRESH, {}],
    ['OPTIONS', REFRESH, { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' }] // JSON POST CSRF 는 사전 확인부터 시작한다
  ])('%s %s', async (method, path, headers) => {
    const save = vi.spyOn(WebManagerLog.prototype, 'save')
    try {
      const res = await send(method, path, { Origin: 'https://evil.example', ...headers })
      expect(res.status).toBe(403)
      expect(res.body).toMatchObject({ code: 'ORIGIN_FORBIDDEN' })
      expect(save).not.toHaveBeenCalled()
    } finally {
      save.mockRestore()
    }
  })
  it('허용된 Origin 의 읽기와 사전 확인은 그대로다', async () => {
    expect((await send('GET', ME, { Origin: ALLOWED })).status).toBe(200)
    expect((await send('OPTIONS', REFRESH, { Origin: ALLOWED, 'Access-Control-Request-Method': 'POST' })).status).toBe(204)
  })
})

describe('ALLOWED_HOSTS', () => {
  const run = (guard, host) => {
    const out = {}
    const res = { status(s) { out.status = s; return this }, json(b) { out.body = b; return this } }
    guard({ method: 'GET', headers: { host } }, res, () => { out.passed = true })
    return out
  }
  it('쉼표로 준 이름을 더 받는다(앞뒤 공백·대소문자 무시, 포트 무관)', () => {
    const guard = createLocalGuard({ allowedOrigins: [ALLOWED], allowedHosts: 'ears-pc, EARS-PC2 ' })
    expect(run(guard, 'ears-pc:3100').passed).toBe(true)
    expect(run(guard, 'ears-pc2').passed).toBe(true)
    expect(run(guard, 'localhost:3100').passed).toBe(true)
    expect(run(guard, 'other-pc:3100').status).toBe(403)
  })
  it('빈 값이면 기본 이름만 받고, 빈 Host 는 막는다', () => {
    const guard = createLocalGuard({ allowedOrigins: [ALLOWED], allowedHosts: '' })
    expect(run(guard, 'ears-pc:3100').status).toBe(403)
    expect(run(guard, undefined).status).toBe(403)
    expect(run(guard, '').status).toBe(403)
  })
})

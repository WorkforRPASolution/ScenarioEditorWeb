import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { authenticate, optionalAuth } from '../../../shared/middleware/authMiddleware'

const IMAGE_URL = '/api/scenario-editor/scenarios/SEWCVD/SEWMODELA/N/versions/1730000000100/files/65aa/images/s0-bi'
// 실제 요청처럼 원격 주소·경로를 싣는다(기본: 루프백에서 /me).
const run = (mw, headers = {}, opts = {}) => {
  const { url = '/api/scenario-editor/me', query } = opts
  const remote = 'remote' in opts ? opts.remote : '127.0.0.1'
  const req = { headers, socket: { remoteAddress: remote }, originalUrl: url, url, query }
  let called = false
  mw(req, {}, () => { called = true })
  return { req, called }
}

describe('authMiddleware 대역', () => {
  const saved = { ...process.env }
  beforeEach(() => { delete process.env.SE_USER_SINGLEID; delete process.env.SE_DEV_USER_OVERRIDE })
  afterEach(() => { process.env = { ...saved } })

  it('설정 SingleID 로 req.user 를 붙인다', () => {
    process.env.SE_USER_SINGLEID = 'sew_multi'
    const { req, called } = run(authenticate)
    expect(called).toBe(true)
    expect(req.user).toEqual({ id: 'sew_multi', singleid: 'sew_multi' })
  })

  it('설정이 비어 있으면 401 ApiError 를 던진다(서버는 죽지 않는다)', () => {
    expect(() => run(authenticate)).toThrowError(/SE_USER_SINGLEID/)
    try { run(authenticate) } catch (e) { expect(e.statusCode).toBe(401) }
  })

  it('X-SE-User 는 SE_DEV_USER_OVERRIDE=1 일 때만 쓴다', () => {
    process.env.SE_USER_SINGLEID = 'sew_multi'
    expect(run(authenticate, { 'x-se-user': 'sew_master' }).req.user.singleid).toBe('sew_multi')
    process.env.SE_DEV_USER_OVERRIDE = '1'
    expect(run(authenticate, { 'x-se-user': 'sew_master' }).req.user.singleid).toBe('sew_master')
    expect(run(authenticate, { 'x-se-user': '  ' }).req.user.singleid).toBe('sew_multi')
  })

  it('개발 전용 ?seUser= 는 SE_DEV_USER_OVERRIDE=1 일 때만(<img> 는 헤더를 못 보냄)', () => {
    process.env.SE_USER_SINGLEID = 'sew_multi'
    const opts = { url: `${IMAGE_URL}?seUser=sew_master`, query: { seUser: 'sew_master' } }
    expect(run(authenticate, {}, opts).req.user.singleid).toBe('sew_multi')
    process.env.SE_DEV_USER_OVERRIDE = '1'
    expect(run(authenticate, {}, opts).req.user.singleid).toBe('sew_master')
  })

  // SEW-017 을 고치다 찾음(2026-11-11): 초안 그림(<img>·fetch 가 ?seUser= 로 받는다)이 이미지 경로로 치이지 않아, 개발용 사용자 바꾸기를 쓰면
  // 설정 사용자로 읽혀 남의 초안 = 404 였다. 초안 목록·초안 본문 경로는 그대로 헤더만 받는다.
  it('초안 그림 경로(/drafts/<id>/images/<tempId>)도 ?seUser= 를 받는다 — 초안 본문·목록 경로는 받지 않는다', () => {
    process.env.SE_USER_SINGLEID = 'sew_multi'
    process.env.SE_DEV_USER_OVERRIDE = '1'
    const as = (url) => run(authenticate, {}, { url: `${url}?seUser=sew_master`, query: { seUser: 'sew_master' } }).req.user.singleid
    expect(as('/api/scenario-editor/drafts/6af3f767bee74aa62e896b79/images/tmwbnn1vhdumplccf')).toBe('sew_master')
    expect(as('/api/scenario-editor/drafts/6af3f767bee74aa62e896b79')).toBe('sew_multi')
    expect(as('/api/scenario-editor/drafts')).toBe('sew_multi')
    expect(as('/api/scenario-editor/drafts/6af3f767bee74aa62e896b79/images')).toBe('sew_multi')
    process.env.SE_DEV_USER_OVERRIDE = '0'
    expect(as('/api/scenario-editor/drafts/6af3f767bee74aa62e896b79/images/tmwbnn1vhdumplccf')).toBe('sew_multi')
  })

  it('?seUser= 는 이미지 경로에서만 받는다(헤더는 모든 경로)', () => {
    process.env.SE_USER_SINGLEID = 'sew_multi'
    process.env.SE_DEV_USER_OVERRIDE = '1'
    for (const url of ['/api/scenario-editor/me', '/api/scenario-editor/scenarios', '/api/scenario-editor/scenarios/P/M/N/versions/current',
      '/api/scenario-editor/scenarios/P/M/N/versions', '/api/scenario-editor/data-check']) {
      expect(run(authenticate, {}, { url: `${url}?seUser=sew_master`, query: { seUser: 'sew_master' } }).req.user.singleid, url).toBe('sew_multi')
      expect(run(authenticate, { 'x-se-user': 'sew_master' }, { url }).req.user.singleid, url).toBe('sew_master')
    }
    // 쿼리 글자에 /images/ 를 넣어도 경로가 아니면 받지 않는다
    expect(run(authenticate, {}, { url: '/api/scenario-editor/me?x=/versions/1/files/f/images/a&seUser=sew_master', query: { seUser: 'sew_master' } }).req.user.singleid).toBe('sew_multi')
  })

  it('두 덮어쓰기 모두 루프백(127.0.0.1·::1·::ffff:127.0.0.1)에서 온 요청에만 효력', () => {
    process.env.SE_USER_SINGLEID = 'sew_multi'
    process.env.SE_DEV_USER_OVERRIDE = '1'
    const image = { url: `${IMAGE_URL}?seUser=sew_master`, query: { seUser: 'sew_master' } }
    for (const remote of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
      expect(run(authenticate, { 'x-se-user': 'sew_master' }, { remote }).req.user.singleid, remote).toBe('sew_master')
      expect(run(authenticate, {}, { ...image, remote }).req.user.singleid, remote).toBe('sew_master')
    }
    for (const remote of ['10.0.0.5', '192.168.0.2', '::ffff:10.0.0.5', '127.0.0.2', '', undefined]) {
      expect(run(authenticate, { 'x-se-user': 'sew_master' }, { remote }).req.user.singleid, String(remote)).toBe('sew_multi')
      expect(run(authenticate, {}, { ...image, remote }).req.user.singleid, String(remote)).toBe('sew_multi')
    }
  })

  it('SE_DEV_USER_OVERRIDE 가 1 이 아니면(0 포함) 루프백·이미지 경로여도 무시', () => {
    process.env.SE_USER_SINGLEID = 'sew_multi'
    for (const flag of ['0', '', 'true']) {
      process.env.SE_DEV_USER_OVERRIDE = flag
      expect(run(authenticate, { 'x-se-user': 'sew_master' }).req.user.singleid, flag).toBe('sew_multi')
      expect(run(authenticate, {}, { url: `${IMAGE_URL}?seUser=sew_master`, query: { seUser: 'sew_master' } }).req.user.singleid, flag).toBe('sew_multi')
    }
  })

  it('server/.env.example 의 기본값은 0(시험이 1 을 직접 준다)', () => {
    const example = readFileSync(new URL('../../../.env.example', import.meta.url), 'utf8')
    expect(example).toMatch(/^SE_DEV_USER_OVERRIDE=0$/m)
  })

  it('optionalAuth 는 설정이 없으면 user 없이 통과한다', () => {
    const { req, called } = run(optionalAuth)
    expect(called).toBe(true)
    expect(req.user).toBeUndefined()
  })
})

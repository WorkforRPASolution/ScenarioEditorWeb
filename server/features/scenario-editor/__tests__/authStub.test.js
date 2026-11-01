import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { authenticate, optionalAuth } from '../../../shared/middleware/authMiddleware'

const run = (mw, headers = {}) => {
  const req = { headers }
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
    const req = { headers: {}, query: { seUser: 'sew_master' } }
    authenticate(req, {}, () => {})
    expect(req.user.singleid).toBe('sew_multi')
    process.env.SE_DEV_USER_OVERRIDE = '1'
    authenticate(req, {}, () => {})
    expect(req.user.singleid).toBe('sew_master')
  })

  it('optionalAuth 는 설정이 없으면 user 없이 통과한다', () => {
    const { req, called } = run(optionalAuth)
    expect(called).toBe(true)
    expect(req.user).toBeUndefined()
  })
})

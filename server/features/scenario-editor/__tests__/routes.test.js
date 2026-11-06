import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const require = createRequire(import.meta.url)

let server
let base
const fake = {}
beforeAll(async () => {
  process.env.SE_USER_SINGLEID = 'sew_multi'
  process.env.SE_DEV_USER_OVERRIDE = '1'
  require('../deps')._setDeps(fake)
  const app = require('../../../app')
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r) })
  base = `http://127.0.0.1:${server.address().port}/api/scenario-editor`
})
afterAll(() => { require('../deps')._setDeps(null); return new Promise((r) => server.close(r)) })

const user = { singleid: 'sew_multi', name: 'M', processRaw: 'CVD;ETCH', processes: ['CVD', 'ETCH'], multiProcess: ['CVD', 'ETCH'], process: 'CVD',
  isMaster: false, authority: 'WRITE', canWrite: true, authorityManager: 3, authorityManagerValid: true, authorityName: 'Manager', duplicateUserDocs: 1 }
const { parseUser } = require('../domain/processPermission')
const READERS = { sew_reader: { authority: 'READ', canWrite: false } }
const MASTERS = { sew_master: parseUser({ singleid: 'sew_master', process: 'MASTER' }), sew_mastercvd: parseUser({ singleid: 'sew_mastercvd', process: 'MASTER;CVD' }) }
beforeEach(() => {
  let cleared = 0
  Object.assign(fake, {
    users: { getUser: async (id) => (id === 'sew_none' ? null : { ...user, singleid: id, ...MASTERS[id], ...READERS[id] }), clear: () => { cleared++ } },
    scopes: {
      scopeFor: async () => ({ pairs: [{ process: 'CVD', models: [{ model: 'M1', eqpCount: 2 }] }], invalid: [{ eqpId: 'X', reason: 'REQUIRED_EMPTY' }], duplicateEqpIds: ['D'], proxyIpDuplicates: [], valid: [] }),
      assertAllowed: async () => {}, clear: () => { cleared++ }
    },
    opener: { clearImages: async () => { cleared += 10 } }
  })
  // Object.assign 은 getter 를 값으로 복사하므로 따로 정의한다
  Object.defineProperty(fake, 'cleared', { get: () => cleared, configurable: true })
})

describe('/me·/scopes·/cache/refresh', () => {
  it('/me', async () => {
    const res = await fetch(`${base}/me`)
    expect(res.status).toBe(200)
    expect((await res.json()).data).toMatchObject({ singleid: 'sew_multi', canWrite: true, authorityName: 'Manager', duplicateUserDocs: 1 })
  })
  it('미등록 사용자는 모든 API 가 403 USER_NOT_REGISTERED', async () => {
    for (const p of ['/me', '/scopes']) {
      const res = await fetch(`${base}${p}`, { headers: { 'X-SE-User': 'sew_none' } })
      expect(res.status).toBe(403)
      expect(await res.json()).toMatchObject({ code: 'USER_NOT_REGISTERED' })
    }
  })
  it('/scopes: 허용 쌍과 뺀 설비 수(무효 + 중복)', async () => {
    const body = await (await fetch(`${base}/scopes`)).json()
    expect(body.data).toEqual({ processes: [{ process: 'CVD', models: [{ model: 'M1', eqpCount: 2 }] }], excludedEqpCount: 2 })
  })
  it('/cache/refresh 는 누구나 사용자·설비 캐시를 비운다', async () => {
    expect((await (await fetch(`${base}/cache/refresh`, { method: 'POST' })).json()).data).toEqual({ refreshed: true })
    expect(fake.cleared).toBe(2)
  })
  it('/cache/refresh?images=1 은 순수 MASTER 면 이미지 캐시까지 비운다', async () => {
    const res = await fetch(`${base}/cache/refresh?images=1`, { method: 'POST', headers: { 'X-SE-User': 'sew_master' } })
    expect(res.status).toBe(200)
    expect(fake.cleared).toBe(12)
  })
  it.each(['sew_multi', 'sew_mastercvd'])('/cache/refresh?images=1 은 %s 이면 403 이고 아무 캐시도 비우지 않는다', async (id) => {
    const res = await fetch(`${base}/cache/refresh?images=1`, { method: 'POST', headers: { 'X-SE-User': id } })
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: 'MASTER_REQUIRED' })
    expect(fake.cleared).toBe(0)
  })
})

describe('/scenarios·/scenarios/:process/:model/:name/versions', () => {
  it('process·model 이 없으면 400 BAD_REQUEST', async () => {
    Object.assign(fake, { list: { list: async () => { throw new Error('호출되면 안 된다') } } })
    for (const q of ['', '?process=CVD', '?model=M1', '?process=&model=M1']) {
      const res = await fetch(`${base}/scenarios${q}`)
      expect(res.status).toBe(400)
      expect(await res.json()).toMatchObject({ code: 'BAD_REQUEST' })
    }
  })
  it('목록은 사용자·공정·모델을 서비스에 그대로 넘기고 data 로 감싼다', async () => {
    const calls = []
    Object.assign(fake, { list: { list: async (...a) => { calls.push(a); return [{ name: 'A' }] } } })
    const body = await (await fetch(`${base}/scenarios?process=CVD&model=M1`)).json()
    expect(body).toEqual({ success: true, data: [{ name: 'A' }] })
    expect(calls).toEqual([[expect.objectContaining({ singleid: 'sew_multi' }), 'CVD', 'M1']])
  })
  it('버전 목록은 경로 값을 문자열 그대로(하이픈 포함) 넘긴다', async () => {
    const calls = []
    Object.assign(fake, { versions: { versions: async (...a) => { calls.push(a); return [{ crtime: 1, isCurrent: true }] } } })
    const body = await (await fetch(`${base}/scenarios/CVD/M1/A-B-C/versions`)).json()
    expect(body).toEqual({ success: true, data: [{ crtime: 1, isCurrent: true }] })
    expect(calls).toEqual([[expect.objectContaining({ singleid: 'sew_multi' }), 'CVD', 'M1', 'A-B-C']])
  })
  it('미등록 사용자는 목록·버전도 403 USER_NOT_REGISTERED', async () => {
    for (const p of ['/scenarios?process=CVD&model=M1', '/scenarios/CVD/M1/A/versions']) {
      const res = await fetch(`${base}${p}`, { headers: { 'X-SE-User': 'sew_none' } })
      expect(res.status).toBe(403)
      expect(await res.json()).toMatchObject({ code: 'USER_NOT_REGISTERED' })
    }
  })
})

describe('데이터 점검', () => {
  it('GET /data-check 는 사용자를 서비스에 넘기고 data 로 감싼다', async () => {
    const calls = []
    const result = { duplicateUsers: [], duplicateEqpIds: [], invalidEquipment: [], proxyIpDuplicates: [], duplicateProperties: [] }
    Object.assign(fake, { dataCheck: { check: async (...a) => { calls.push(a); return result } } })
    const body = await (await fetch(`${base}/data-check`)).json()
    expect(body).toEqual({ success: true, data: result })
    expect(calls).toEqual([[expect.objectContaining({ singleid: 'sew_multi' })]])
  })
})

describe('버전 열기', () => {
  it('경로 값을 그대로 넘기고 X-SE-Open-Stats 를 싣고, CORS 가 그 헤더를 브라우저에 노출한다', async () => {
    const calls = []
    fake.opener = { open: async (...a) => { calls.push(a); return { skeleton: { name: 'A-B-C' }, stats: { ms: 12, peakRssMb: 345, fromCache: true } } } }
    const res = await fetch(`${base}/scenarios/CVD/M1/A-B-C/versions/current`, { headers: { Origin: 'http://localhost:5173' } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, data: { name: 'A-B-C' } })
    expect(calls).toEqual([[expect.objectContaining({ singleid: 'sew_multi' }), 'CVD', 'M1', 'A-B-C', 'current']])
    expect(res.headers.get('x-se-open-stats')).toBe('ms=12;peakRssMb=345;fromCache=true')
    expect(res.headers.get('access-control-expose-headers')).toContain('X-SE-Open-Stats')
  })
  it('crtime 이 숫자가 아닌 이미지 요청은 400', async () => {
    fake.opener = { imagePath: async () => { throw new Error('호출되면 안 된다') } }
    const res = await fetch(`${base}/scenarios/CVD/M1/N/versions/abc/files/f1/images/s0-bi`)
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'BAD_REQUEST' })
  })
})

describe('이미지', () => {
  it('경로의 파일 id 를 그대로 넘긴다', async () => {
    const calls = []
    fake.opener = { imagePath: async (...a) => { calls.push(a.slice(1)); throw Object.assign(new Error('x'), { statusCode: 418 }) } }
    await fetch(`${base}/scenarios/CVD/M1/N/versions/1730000000100/files/65aa/images/s0-bi`)
    expect(calls).toEqual([['CVD', 'M1', 'N', 1730000000100, '65aa', 's0-bi']])
  })
  it('점 폴더(.cache) 아래 파일도 PNG 로 준다', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'sew-img-')), '.cache', 'images')
    mkdirSync(dir, { recursive: true })
    const png = join(dir, 's0-bi.png')
    writeFileSync(png, Buffer.from('89504e470d0a1a0a', 'hex'))
    fake.opener = { imagePath: async () => png }
    const res = await fetch(`${base}/scenarios/CVD/M1/N/versions/1730000000100/files/f1/images/s0-bi`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/^image\/png/)
    expect(res.headers.get('cache-control')).toBe('private, max-age=31536000, immutable')
  })

  describe('보내기 실패는 PNG·1년 캐시 머리글 없이 JSON 오류로, 파일 경로를 싣지 않는다', () => {
    const savedEnv = process.env.NODE_ENV
    beforeEach(() => { process.env.NODE_ENV = 'development' }) // 개발 모드는 오류 메시지를 그대로 내보낸다
    afterEach(() => { process.env.NODE_ENV = savedEnv })
    const expectCleanError = async (res, status, dir) => {
      expect(res.status).toBe(status)
      expect(res.headers.get('content-type')).toMatch(/^application\/json/)
      expect(res.headers.get('cache-control') || '').not.toContain('immutable')
      const text = await res.text()
      expect(text).not.toContain(dir)
      return JSON.parse(text)
    }

    it('캐시 파일이 그 사이 사라졌으면 404 NOT_FOUND', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'sew-img-gone-'))
      fake.opener = { imagePath: async () => join(dir, 's0-bi.png') }
      const body = await expectCleanError(await fetch(`${base}/scenarios/CVD/M1/N/versions/1730000000100/files/f1/images/s0-bi`), 404, dir)
      expect(body).toMatchObject({ code: 'NOT_FOUND' })
    })
    it.skipIf(process.getuid && process.getuid() === 0)('그 밖 오류(읽기 권한 없음)도 경로 없는 오류로', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'sew-img-deny-'))
      const png = join(dir, 's0-bi.png')
      writeFileSync(png, Buffer.from('89504e470d0a1a0a', 'hex'))
      chmodSync(png, 0o000)
      fake.opener = { imagePath: async () => png }
      try {
        await expectCleanError(await fetch(`${base}/scenarios/CVD/M1/N/versions/1730000000100/files/f1/images/s0-bi`), 500, dir)
      } finally {
        chmodSync(png, 0o600)
      }
    })
  })
})

describe('POST /check', () => {
  const post = (body, headers = {}) => fetch(`${base}/check`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
  afterEach(() => { delete require('../../../app').locals.seWriteDisabled })
  it('WRITE 가 아닌 사용자는 403 WRITE_FORBIDDEN 이고 검사 서비스를 부르지 않는다', async () => {
    let called = 0
    fake.check = { check: async () => { called++ } }
    const res = await post({}, { 'X-SE-User': 'sew_reader' })
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: 'WRITE_FORBIDDEN' })
    expect(called).toBe(0)
  })
  it('seWriteDisabled 면 403 WRITE_DISABLED', async () => {
    fake.check = { check: async () => ({}) }
    require('../../../app').locals.seWriteDisabled = true
    const res = await post({})
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: 'WRITE_DISABLED' })
  })
  it('WRITE 사용자는 사용자·본문을 검사 서비스에 넘기고 data 로 받는다', async () => {
    const seen = []
    fake.check = { check: async (u, meta) => { seen.push([u.singleid, meta]); return { blocks: [], warns: [], target: { exists: false, eqpCount: 2 }, conflict: null, targetExists: null } } }
    const res = await post({ target: { process: 'CVD', model: 'M1', name: 'N' } })
    expect(res.status).toBe(200)
    expect((await res.json()).data).toMatchObject({ blocks: [], target: { eqpCount: 2 } })
    expect(seen).toEqual([['sew_multi', { target: { process: 'CVD', model: 'M1', name: 'N' } }]])
  })
})

describe('/drafts', () => {
  afterEach(() => { delete require('../../../app').locals.seWriteDisabled })
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2])
  const form = () => {
    const fd = new FormData()
    fd.append('meta', JSON.stringify({ target: { process: 'CVD', model: 'M1', name: 'N' } }))
    fd.append('img:t1', new Blob([PNG], { type: 'image/png' }), 'a.png')
    return fd
  }
  it('POST 는 WRITE 가 아니면 403 이고 본문을 읽지 않는다', async () => {
    let called = 0
    fake.drafts = { save: async () => { called++ } }
    const res = await fetch(`${base}/drafts`, { method: 'POST', headers: { 'X-SE-User': 'sew_reader' }, body: form() })
    expect(res.status).toBe(403)
    expect(called).toBe(0)
  })
  it('POST 는 meta·그림 Map 을 서비스에 넘긴다', async () => {
    const seen = []
    fake.drafts = { save: async (u, meta, images) => { seen.push([u.singleid, meta, [...images.keys()], images.get('t1').length]); return { draftId: 'd1', revision: 1 } } }
    const res = await fetch(`${base}/drafts`, { method: 'POST', body: form() })
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ draftId: 'd1', revision: 1 })
    expect(seen).toEqual([['sew_multi', { target: { process: 'CVD', model: 'M1', name: 'N' } }, ['t1'], PNG.length]])
  })
  it('POST 가 PNG 아닌 파일이면 400', async () => {
    fake.drafts = { save: async () => ({}) }
    const fd = new FormData()
    fd.append('meta', '{}'); fd.append('img:t1', new Blob(['zzzzzzzzzzzz']), 'a.png')
    expect((await fetch(`${base}/drafts`, { method: 'POST', body: fd })).status).toBe(400)
  })
  it('GET 목록은 process·model 이 필요하다', async () => {
    const seen = []
    fake.drafts = { list: async (u, p, m) => { seen.push([p, m]); return [{ draftId: 'd1' }] } }
    expect((await fetch(`${base}/drafts?process=CVD`)).status).toBe(400)
    const res = await fetch(`${base}/drafts?process=CVD&model=M1`)
    expect((await res.json()).data).toEqual([{ draftId: 'd1' }])
    expect(seen).toEqual([['CVD', 'M1']])
  })
  it('GET /:id 는 서비스 결과를 data 로 낸다', async () => {
    fake.drafts = { get: async (u, id) => ({ draftId: id }) }
    expect((await (await fetch(`${base}/drafts/abc`)).json()).data).toEqual({ draftId: 'abc' })
  })
  it('GET 그림은 PNG 에 no-store', async () => {
    const { Readable } = require('node:stream')
    fake.drafts = { image: async () => Readable.from([PNG]) }
    const res = await fetch(`${base}/drafts/abc/images/t1`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(Buffer.from(await res.arrayBuffer()).equals(PNG)).toBe(true)
  })
  it('DELETE 는 WRITE 가 아니면 403, 아니면 서비스 결과', async () => {
    fake.drafts = { remove: async () => ({ deleted: true }) }
    expect((await fetch(`${base}/drafts/abc`, { method: 'DELETE', headers: { 'X-SE-User': 'sew_reader' } })).status).toBe(403)
    const res = await fetch(`${base}/drafts/abc`, { method: 'DELETE' })
    expect((await res.json()).data).toEqual({ deleted: true })
  })
})

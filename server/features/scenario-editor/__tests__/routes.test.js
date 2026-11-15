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
const READERS = { sew_reader: { authority: 'READ', canWrite: false }, sew_adm: { authorityManager: 1 } }
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
  it('/links: 설정한 안내 문서 주소(없거나 http·https 가 아니면 null)', async () => {
    const get = async () => (await (await fetch(`${base}/links`)).json()).data
    const before = process.env.SE_LINK_PREPROCESSING_SOP
    try {
      delete process.env.SE_LINK_PREPROCESSING_SOP
      expect(await get()).toEqual({ preprocessingSop: null })
      process.env.SE_LINK_PREPROCESSING_SOP = 'https://wiki.example.com/sop'
      expect(await get()).toEqual({ preprocessingSop: 'https://wiki.example.com/sop' })
      process.env.SE_LINK_PREPROCESSING_SOP = 'javascript:alert(1)'
      expect(await get()).toEqual({ preprocessingSop: null })
    } finally {
      if (before === undefined) delete process.env.SE_LINK_PREPROCESSING_SOP
      else process.env.SE_LINK_PREPROCESSING_SOP = before
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
  it('공정·모델별 시나리오 수·내 초안 수(/scenario-counts)는 사용자를 서비스에 넘기고 data 로 감싼다', async () => {
    const calls = []
    const data = { draftsCounted: true, pairs: [{ process: 'CVD', model: 'M1', scenarios: 3, drafts: 1 }] }
    Object.assign(fake, { counts: { counts: async (...a) => { calls.push(a); return data } } })
    const body = await (await fetch(`${base}/scenario-counts`)).json()
    expect(body).toEqual({ success: true, data })
    expect(calls).toEqual([[expect.objectContaining({ singleid: 'sew_multi' })]])
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

describe('POST /deploy', () => {
  afterEach(() => { delete require('../../../app').locals.seWriteDisabled })
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2])
  const form = () => {
    const fd = new FormData()
    fd.append('meta', JSON.stringify({ requestId: 'r1', target: { process: 'CVD', model: 'M1', name: 'N' } }))
    fd.append('img:t1', new Blob([PNG], { type: 'image/png' }), 'a.png')
    return fd
  }
  it('WRITE 가 아니면 403 이고 배포 서비스를 부르지 않는다', async () => {
    let called = 0
    fake.deploy = { deploy: async () => { called++ } }
    const res = await fetch(`${base}/deploy`, { method: 'POST', headers: { 'X-SE-User': 'sew_reader' }, body: form() })
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: 'WRITE_FORBIDDEN' })
    expect(called).toBe(0)
  })
  it('seWriteDisabled 면 403 WRITE_DISABLED', async () => {
    fake.deploy = { deploy: async () => ({}) }
    require('../../../app').locals.seWriteDisabled = true
    const res = await fetch(`${base}/deploy`, { method: 'POST', body: form() })
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: 'WRITE_DISABLED' })
  })
  it('meta·그림 Map 을 서비스에 넘기고, X-SE-Deploy-Stats 를 싣고, CORS 가 그 헤더를 노출한다', async () => {
    const seen = []
    fake.deploy = { deploy: async (u, meta, images) => { seen.push([u.singleid, meta, [...images.keys()]]); return { result: 'ok', crtime: 5, partialFailed: [], requestId: 'r1' } } }
    const res = await fetch(`${base}/deploy`, { method: 'POST', headers: { Origin: 'http://localhost:5173' }, body: form() })
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ result: 'ok', crtime: 5, partialFailed: [], requestId: 'r1' })
    expect(seen).toEqual([['sew_multi', { requestId: 'r1', target: { process: 'CVD', model: 'M1', name: 'N' } }, ['t1']]])
    expect(res.headers.get('x-se-deploy-stats')).toMatch(/^ms=\d+;peakRssMb=\d+$/)
    expect(res.headers.get('access-control-expose-headers')).toContain('X-SE-Deploy-Stats')
  })
  it('서비스 오류는 code·details 를 그대로 낸다', async () => {
    const { seError } = require('../errors')
    fake.deploy = { deploy: async () => { throw seError(504, 'UPSTREAM_TIMEOUT', 'x', { requestId: 'r1' }) } }
    const res = await fetch(`${base}/deploy`, { method: 'POST', body: form() })
    expect(res.status).toBe(504)
    expect(await res.json()).toMatchObject({ code: 'UPSTREAM_TIMEOUT', details: { requestId: 'r1' } })
  })
})

describe('PUT /enabled·DELETE /scenarios/:process/:model/:name', () => {
  const J = { 'Content-Type': 'application/json' }
  it('PUT 은 WRITE 가 아니면 403, enabled 가 불리언이 아니면 400, 아니면 서비스 결과', async () => {
    const seen = []
    fake.versionAdmin = { setEnabled: async (u, k, e) => { seen.push([u.singleid, k, e]); return { isEnabled: e, propertyRev: 'r' } } }
    const u = `${base}/scenarios/P/M/N/enabled`
    expect((await fetch(u, { method: 'PUT', headers: { ...J, 'X-SE-User': 'sew_reader' }, body: '{"enabled":true}' })).status).toBe(403)
    expect((await fetch(u, { method: 'PUT', headers: J, body: '{"enabled":"yes"}' })).status).toBe(400)
    const res = await fetch(u, { method: 'PUT', headers: J, body: '{"enabled":false}' })
    expect((await res.json()).data).toEqual({ isEnabled: false, propertyRev: 'r' })
    expect(seen).toEqual([[expect.any(String), { process: 'P', model: 'M', name: 'N' }, false]])
  })
  it('DELETE 는 WRITE 가 아니면 403, confirmName 이 없으면 400, 아니면 서비스 결과', async () => {
    const seen = []
    fake.versionAdmin = { remove: async (u, k, c, o) => { seen.push([k, c, o]); return { deleted: true } } }
    const u = `${base}/scenarios/P/M/N`
    expect((await fetch(u, { method: 'DELETE', headers: { ...J, 'X-SE-User': 'sew_reader' }, body: '{"confirmName":"N"}' })).status).toBe(403)
    expect((await fetch(u, { method: 'DELETE', headers: J, body: '{}' })).status).toBe(400)
    const res = await fetch(u, { method: 'DELETE', headers: J, body: '{"confirmName":"N"}' })
    expect((await res.json()).data).toEqual({ deleted: true })
    // withDraft(내 초안도 함께 지우기)는 참거짓만 — 없으면 false
    expect((await fetch(u, { method: 'DELETE', headers: J, body: '{"confirmName":"N","withDraft":"yes"}' })).status).toBe(400)
    await fetch(u, { method: 'DELETE', headers: J, body: '{"confirmName":"N","withDraft":true}' })
    expect(seen).toEqual([[{ process: 'P', model: 'M', name: 'N' }, 'N', { withDraft: false }], [{ process: 'P', model: 'M', name: 'N' }, 'N', { withDraft: true }]])
  })
})

describe('심의·성과·같은 이름·사용자 찾기·이름 규칙', () => {
  const J = { 'Content-Type': 'application/json' }
  it('PUT review·performance 는 등급 1·2 만(3 은 403 GRADE_FORBIDDEN), 본문이 틀리면 400, 아니면 서비스 결과', async () => {
    const seen = []
    fake.performance = {
      review: async (u, k, b) => { seen.push(['review', u.singleid, k, b]); return { performance: { grade: 3 } } },
      savePerformance: async (u, k, b) => { seen.push(['perf', k, b]); return { performance: {}, applied: [] } }
    }
    const rv = `${base}/scenarios/P/M/N/review`
    const pf = `${base}/scenarios/P/M/N/performance`
    const res403 = await fetch(rv, { method: 'PUT', headers: J, body: '{"grade":3}' })
    expect([res403.status, (await res403.json()).code]).toEqual([403, 'GRADE_FORBIDDEN'])
    expect((await fetch(pf, { method: 'PUT', headers: J, body: '{"fields":{}}' })).status).toBe(403)
    const adm = { ...J, 'X-SE-User': 'sew_adm' }
    expect((await fetch(pf, { method: 'PUT', headers: adm, body: '{"fields":5}' })).status).toBe(400)
    expect((await fetch(rv, { method: 'PUT', headers: adm, body: '[]' })).status).toBe(400)
    expect((await (await fetch(rv, { method: 'PUT', headers: adm, body: '{"grade":3,"comment":"zzzzzz"}' })).json()).data).toEqual({ performance: { grade: 3 } })
    await fetch(pf, { method: 'PUT', headers: adm, body: '{"fields":{"ManWorkLoss":1},"citizenDevelopers":[{"KnoxId":"a","Contribution":5}]}' })
    expect(seen).toEqual([
      ['review', 'sew_adm', { process: 'P', model: 'M', name: 'N' }, { grade: 3, comment: 'zzzzzz' }],
      ['perf', { process: 'P', model: 'M', name: 'N' }, { fields: { ManWorkLoss: 1 }, citizenDevelopers: [{ KnoxId: 'a', Contribution: 5 }], alsoModels: [] }]
    ])
  })
  it('GET same-name·users·name-rule 은 서비스 결과를 data 로', async () => {
    fake.performance = {
      sameName: async (u, p, n) => [p, n],
      searchUsers: async (u, q) => [{ singleid: q, name: 'x' }],
      nameRule: async () => ({ exists: false, rules: [] })
    }
    expect((await (await fetch(`${base}/scenarios/P/same-name/N`)).json()).data).toEqual(['P', 'N'])
    expect((await (await fetch(`${base}/users?q=ab`, { headers: { 'X-SE-User': 'sew_adm' } })).json()).data).toEqual([{ singleid: 'ab', name: 'x' }])
    expect((await (await fetch(`${base}/name-rule`)).json()).data).toEqual({ exists: false, rules: [] })
  })
  it('GET /users(원개발자 찾기)는 성과 입력 창 몫이라 등급 1·2 만 — 3 은 403 GRADE_FORBIDDEN 이고 찾지 않는다(설계 §8)', async () => {
    const seen = []
    fake.performance = { searchUsers: async (u, q) => { seen.push(q); return [] } }
    const res = await fetch(`${base}/users?q=ab`)
    expect([res.status, (await res.json()).code]).toEqual([403, 'GRADE_FORBIDDEN'])
    expect(seen).toEqual([])
    expect((await fetch(`${base}/users?q=ab`, { headers: { 'X-SE-User': 'sew_adm' } })).status).toBe(200)
    expect(seen).toEqual(['ab'])
  })
  it('GET /users?ids= 는 등록 여부 확인(registeredUsers) — 등급 1·2 만, q 찾기는 부르지 않는다', async () => {
    const seen = []
    fake.performance = {
      searchUsers: async (u, q) => { seen.push(['q', q]); return [] },
      registeredUsers: async (u, ids) => { seen.push(['ids', u.singleid, ids]); return [{ singleid: 'a', name: 'A', process: 'P' }] }
    }
    const res = await fetch(`${base}/users?ids=a,b`)
    expect([res.status, (await res.json()).code]).toEqual([403, 'GRADE_FORBIDDEN'])
    expect(seen).toEqual([])
    const ok = await fetch(`${base}/users?ids=a,b&q=zz`, { headers: { 'X-SE-User': 'sew_adm' } })
    expect((await ok.json()).data).toEqual([{ singleid: 'a', name: 'A', process: 'P' }])
    expect(seen).toEqual([['ids', 'sew_adm', 'a,b']])
  })
  it('GET same-name 은 권한 밖 공정이면 403 PROCESS_FORBIDDEN(빈 목록이 아님), 권한 안이면 내 모델만', async () => {
    const { createPerformanceService } = require('../service/performanceService')
    const repo = { findSameNameModels: async () => ['M1', 'M9'] }
    fake.performance = createPerformanceService({ repo, scopes: fake.scopes })
    const res = await fetch(`${base}/scenarios/ETCH/same-name/N`)
    expect([res.status, (await res.json()).code]).toEqual([403, 'PROCESS_FORBIDDEN'])
    expect((await (await fetch(`${base}/scenarios/CVD/same-name/N`)).json()).data).toEqual(['M1'])
  })
})

describe('스냅샷 (P3-A)', () => {
  const NAME = '1762820000123_[412][388].png'
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
  const imageUrl = (eqpId = 'E1', name = NAME) => `${base}/snapshots/${encodeURIComponent(eqpId)}/${encodeURIComponent(name)}/image`
  let calls
  beforeEach(() => {
    calls = []
    fake.snapshots = {
      equipment: async (u) => { calls.push(['equipment', u.singleid]); return [{ eqpId: 'E1', process: 'CVD', model: 'M1', line: 'L1' }] },
      days: async (u, eqpId, o) => { calls.push(['days', u.singleid, eqpId, o]); return { eqpId, latest: '2026-11-11', days: null, truncated: false } },
      presence: async (u, after) => { calls.push(['presence', u.singleid, after]); return { enabled: true, items: [['E1', '2026-11-11']], checked: 1, total: 1, next: null } },
      list: async (u, eqpId, date) => { calls.push(['list', u.singleid, eqpId, date]); return { eqpId, date, timeDiff: 0, items: [], skipped: 0, truncated: false } },
      image: async (u, eqpId, fileName) => { calls.push(['image', u.singleid, eqpId, fileName]); return { png: PNG, maxAge: 123 } }
    }
  })

  it('GET /equipment → { items }', async () => {
    const res = await fetch(`${base}/equipment`)
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ items: [{ eqpId: 'E1', process: 'CVD', model: 'M1', line: 'L1' }] })
    expect(calls).toEqual([['equipment', 'sew_multi']])
  })

  it('GET /snapshots/days — counts=1 일 때만 날짜별 개수를 청한다, 그림 경로에 먹히지 않는다', async () => {
    const res = await fetch(`${base}/snapshots/days?eqpId=E1`)
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ eqpId: 'E1', latest: '2026-11-11', days: null, truncated: false })
    await fetch(`${base}/snapshots/days?eqpId=E1&counts=1`)
    await fetch(`${base}/snapshots/days?eqpId=E1&counts=true`)
    expect(calls).toEqual([['days', 'sew_multi', 'E1', { counts: false }], ['days', 'sew_multi', 'E1', { counts: true }], ['days', 'sew_multi', 'E1', { counts: false }]])
  })

  it('GET /snapshots/presence — after 는 글자 하나일 때만 넘긴다(없으면 빈 글자), 그림 경로에 먹히지 않는다', async () => {
    const res = await fetch(`${base}/snapshots/presence`)
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ enabled: true, items: [['E1', '2026-11-11']], checked: 1, total: 1, next: null })
    await fetch(`${base}/snapshots/presence?after=E%201`)
    await fetch(`${base}/snapshots/presence?after=a&after=b`)
    await fetch(`${base}/snapshots/presence?after[x]=1`)
    expect(calls).toEqual([['presence', 'sew_multi', ''], ['presence', 'sew_multi', 'E 1'], ['presence', 'sew_multi', ''], ['presence', 'sew_multi', '']])
  })

  it('GET /snapshots?eqpId&date → 하루 목록', async () => {
    const res = await fetch(`${base}/snapshots?eqpId=E1&date=2026-11-11`)
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ eqpId: 'E1', date: '2026-11-11', timeDiff: 0, items: [], skipped: 0, truncated: false })
    expect(calls).toEqual([['list', 'sew_multi', 'E1', '2026-11-11']])
  })

  it('eqpId·date 가 없거나 글자 하나가 아니면 400 BAD_REQUEST 이고 서비스를 부르지 않는다', async () => {
    for (const q of ['/snapshots', '/snapshots?eqpId=E1', '/snapshots?date=2026-11-11', '/snapshots?eqpId=&date=2026-11-11', '/snapshots?eqpId=E1&eqpId=E2&date=2026-11-11',
      '/snapshots/days', '/snapshots/days?eqpId=', '/snapshots/days?eqpId[a]=1']) {
      const res = await fetch(`${base}${q}`)
      expect([res.status, (await res.json()).code], q).toEqual([400, 'BAD_REQUEST'])
    }
    expect(calls).toEqual([])
  })

  it('그림: PNG 바이트, 남은 보관 초만큼만 캐시, 파일 이름은 풀어서 넘긴다', async () => {
    const res = await fetch(imageUrl())
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/^image\/png/)
    expect(res.headers.get('cache-control')).toBe('private, max-age=123, immutable')
    expect(Buffer.from(await res.arrayBuffer()).equals(PNG)).toBe(true)
    expect(calls).toEqual([['image', 'sew_multi', 'E1', NAME]])
  })

  it('그림: 남은 보관 초가 0 이면 캐시하지 않는다', async () => {
    fake.snapshots.image = async () => ({ png: PNG, maxAge: 0 })
    const res = await fetch(imageUrl())
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('private, no-store')
  })

  it('그림 오류는 JSON 이고 PNG·캐시 머리글이 없다', async () => {
    const { seError } = require('../errors')
    fake.snapshots.image = async () => { throw seError(404, 'SNAPSHOT_NOT_FOUND', '스냅샷 그림이 없습니다') }
    const res = await fetch(imageUrl())
    expect(res.status).toBe(404)
    expect(res.headers.get('content-type')).toMatch(/^application\/json/)
    expect(res.headers.get('cache-control') || '').not.toMatch(/immutable|max-age/)
    expect(await res.json()).toMatchObject({ code: 'SNAPSHOT_NOT_FOUND' })
  })

  it('?seUser= 는 스냅샷 그림 경로에서 받고 목록 경로에서는 받지 않는다', async () => {
    await fetch(`${imageUrl()}?seUser=sew_master`)
    await fetch(`${base}/snapshots?eqpId=E1&date=2026-11-11&seUser=sew_master`)
    expect(calls.map((c) => [c[0], c[1]])).toEqual([['image', 'sew_master'], ['list', 'sew_multi']])
  })

  it('미등록 사용자는 스냅샷 API 도 403 USER_NOT_REGISTERED', async () => {
    for (const p of ['/equipment', '/snapshots?eqpId=E1&date=2026-11-11', '/snapshots/days?eqpId=E1', '/snapshots/presence']) {
      const res = await fetch(`${base}${p}`, { headers: { 'X-SE-User': 'sew_none' } })
      expect([res.status, (await res.json()).code], p).toEqual([403, 'USER_NOT_REGISTERED'])
    }
    expect(calls).toEqual([])
  })

  // Review Focus 1: Cassandra 주소가 비어 있어도 서버와 다른 API 는 그대로다.
  it('Cassandra 주소가 비어 있으면 스냅샷 API 만 503 SNAPSHOT_UNSET 이고 /me·/scopes 는 200', async () => {
    const { createSnapshotRepository } = require('../repo/snapshotRepository')
    const { createSnapshotService } = require('../service/snapshotService')
    const scopes = { ...fake.scopes, equipmentOf: async (u, eqpId) => ({ eqpId, process: 'CVD', eqpModel: 'M1', line: 'L1' }), scopeFor: async () => ({ valid: [{ eqpId: 'E1', process: 'CVD', eqpModel: 'M1', line: 'L1' }] }) }
    fake.snapshots = createSnapshotService({ snapshotRepo: createSnapshotRepository({ env: {}, driver: require('cassandra-driver') }), scopes, now: () => Date.now(), env: {} })
    for (const p of ['/snapshots?eqpId=E1&date=2026-11-11', '/snapshots/days?eqpId=E1', '/snapshots/presence', `/snapshots/E1/${encodeURIComponent(NAME)}/image`]) {
      const res = await fetch(`${base}${p}`)
      expect([res.status, (await res.json()).code], p).toEqual([503, 'SNAPSHOT_UNSET'])
    }
    expect((await fetch(`${base}/me`)).status).toBe(200)
    expect((await fetch(`${base}/scopes`)).status).toBe(200)
  })
})

describe('메모 (P3-C)', () => {
  const NAME = '1762820000123_[412][388].png'
  const J = { 'Content-Type': 'application/json' }
  const url = (eqpId = 'E 1', name = NAME) => `${base}/snapshots/${encodeURIComponent(eqpId)}/${encodeURIComponent(name)}/memo`
  const MEMO = { text: '글', author: 'sew_multi', authorName: 'M', writtenAt: '2026-11-11 12:00', editedBy: null, editedAt: null }
  let calls
  beforeEach(() => {
    calls = []
    fake.memos = {
      save: async (u, eqpId, fileName, body) => { calls.push(['save', u.singleid, eqpId, fileName, body]); return { memo: MEMO } },
      remove: async (u, eqpId, fileName, body) => { calls.push(['remove', u.singleid, eqpId, fileName, body]); return { removed: true, memo: null } },
      list: async (u) => { calls.push(['list', u.singleid]); return { items: [], truncated: false } }
    }
  })
  afterEach(() => { delete require('../../../app').locals.seWriteDisabled })
  const put = (body, headers = {}, u = url()) => fetch(u, { method: 'PUT', headers: { ...J, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) })
  const del = (body, headers = {}, u = url()) => fetch(u, { method: 'DELETE', headers: { ...J, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) })

  it('PUT …/memo — 설비·파일 이름은 풀어서, 본문의 memo·expect 만 넘긴다(expect 가 없으면 null)', async () => {
    const res = await put({ memo: '글', expect: '옛 글', extra: 1 })
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ memo: MEMO })
    await put({ memo: '글' })
    await put({ memo: '글', expect: null })
    expect(calls).toEqual([
      ['save', 'sew_multi', 'E 1', NAME, { memo: '글', expect: '옛 글' }],
      ['save', 'sew_multi', 'E 1', NAME, { memo: '글', expect: null }],
      ['save', 'sew_multi', 'E 1', NAME, { memo: '글', expect: null }]
    ])
  })

  it('DELETE …/memo — 본문의 expect 를 넘긴다', async () => {
    const res = await del({ expect: '글' })
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ removed: true, memo: null })
    expect(calls).toEqual([['remove', 'sew_multi', 'E 1', NAME, { expect: '글' }]])
  })

  it('본문 꼴이 틀리면 400 BAD_REQUEST 이고 서비스를 부르지 않는다', async () => {
    for (const body of ['[]', '{"memo":7}', '{"expect":"a"}', '{"memo":"a","expect":7}', '{"memo":"a","expect":["x"]}']) {
      const res = await put(body)
      expect([res.status, (await res.json()).code], body).toEqual([400, 'BAD_REQUEST'])
    }
    for (const body of ['[]', '{}', '{"expect":null}', '{"expect":7}']) {
      const res = await del(body)
      expect([res.status, (await res.json()).code], body).toEqual([400, 'BAD_REQUEST'])
    }
    expect(calls).toEqual([])
  })

  it('WRITE 권한이 없는 사용자도 메모를 쓰고 지운다(스냅샷을 볼 수 있으면 된다)', async () => {
    expect((await put({ memo: '글' }, { 'X-SE-User': 'sew_reader' })).status).toBe(200)
    expect((await del({ expect: '글' }, { 'X-SE-User': 'sew_reader' })).status).toBe(200)
    expect(calls.map((c) => [c[0], c[1]])).toEqual([['save', 'sew_reader'], ['remove', 'sew_reader']])
  })

  it('seWriteDisabled 면 쓰기 둘은 403 WRITE_DISABLED, 메모 목록은 읽힌다', async () => {
    require('../../../app').locals.seWriteDisabled = true
    for (const res of [await put({ memo: '글' }), await del({ expect: '글' })]) expect([res.status, (await res.json()).code]).toEqual([403, 'WRITE_DISABLED'])
    expect(calls).toEqual([])
    expect((await fetch(`${base}/memos`)).status).toBe(200)
  })

  it('GET /memos → { items, truncated }', async () => {
    const res = await fetch(`${base}/memos`)
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ items: [], truncated: false })
    expect(calls).toEqual([['list', 'sew_multi']])
  })

  it('미등록 사용자는 403 USER_NOT_REGISTERED', async () => {
    const h = { 'X-SE-User': 'sew_none' }
    for (const res of [await put({ memo: '글' }, h), await del({ expect: '글' }, h), await fetch(`${base}/memos`, { headers: h })]) {
      expect([res.status, (await res.json()).code]).toEqual([403, 'USER_NOT_REGISTERED'])
    }
    expect(calls).toEqual([])
  })
})

describe('이력 (P3-D)', () => {
  let calls
  beforeEach(() => {
    calls = []
    fake.history = { get: async (u, eqpId, txn) => { calls.push([u.singleid, eqpId, txn]); return { eqpId, txn, steps: [{ no: 1, text: '확인', images: [] }] } } }
  })

  it('GET /history/:eqpId/:txn — 설비는 풀어서, txn 은 글자 그대로 넘긴다', async () => {
    const res = await fetch(`${base}/history/${encodeURIComponent('E 1')}/1763254800000`)
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ eqpId: 'E 1', txn: '1763254800000', steps: [{ no: 1, text: '확인', images: [] }] })
    expect(calls).toEqual([['sew_multi', 'E 1', '1763254800000']])
  })

  it('서비스 오류는 status·code 그대로', async () => {
    const { seError } = require('../errors')
    fake.history.get = async () => { throw seError(404, 'HISTORY_NOT_FOUND', '이력이 없습니다') }
    const res = await fetch(`${base}/history/E1/100000`)
    expect([res.status, (await res.json()).code]).toEqual([404, 'HISTORY_NOT_FOUND'])
  })

  it('WRITE 권한이 없어도 보고, 미등록 사용자는 403 USER_NOT_REGISTERED', async () => {
    expect((await fetch(`${base}/history/E1/100000`, { headers: { 'X-SE-User': 'sew_reader' } })).status).toBe(200)
    const res = await fetch(`${base}/history/E1/100000`, { headers: { 'X-SE-User': 'sew_none' } })
    expect([res.status, (await res.json()).code]).toEqual([403, 'USER_NOT_REGISTERED'])
    expect(calls.map((c) => c[0])).toEqual(['sew_reader'])
  })
})

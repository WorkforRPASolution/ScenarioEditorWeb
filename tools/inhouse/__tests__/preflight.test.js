import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { checkEnv, checkName, remoteChecks, parseArgs, apiBase, run } = require('../preflight')

// 사내 쓰기 시험 프로필(server/.env.inhouse.example 을 채운 꼴) — 멈춤도 경고도 없다
const GOOD = {
  HOST: '127.0.0.1', SE_WEBMANAGER_DB: '0', SE_DEV_USER_OVERRIDE: '0', SE_USER_SINGLEID: 'hong.gildong',
  MONGODB_URI: 'mongodb://ro:pw@prod-mongo:27017/EARS?authSource=admin',
  SE_WEB_DB_URI: 'mongodb://rw:pw@prod-mongo:27017/SE_WEB_TEST?authSource=admin',
  EARS_INTERFACE_URL: 'http://prod-is:8080', IMAGE_CACHE_DIR: 'D:/sew-cache/images'
}
const codes = (fs) => fs.map((f) => `${f.level}:${f.code}`)

describe('checkEnv — 사내 쓰기 시험 설정 점검', () => {
  it('채운 프로필은 멈춤·경고가 없다', () => {
    expect(checkEnv(GOOD)).toEqual([])
  })

  it.each([
    ['HOST 가 루프백이 아님', { HOST: '0.0.0.0' }, 'stop:HOST_NOT_LOOPBACK'],
    ['SE_WEBMANAGER_DB 가 0 이 아님', { SE_WEBMANAGER_DB: '1' }, 'stop:WEBMANAGER_DB_ON'],
    ['SE_WEBMANAGER_DB 없음', { SE_WEBMANAGER_DB: undefined }, 'stop:WEBMANAGER_DB_ON'],
    ['SE_WEB_DB_URI 없음', { SE_WEB_DB_URI: '' }, 'stop:WEB_DB_MISSING'],
    ['SE_WEB_DB_URI 에 DB 이름이 없음', { SE_WEB_DB_URI: 'mongodb://rw:pw@prod-mongo:27017/?authSource=admin' }, 'stop:WEB_DB_NAME_MISSING'],
    ['SE_WEB_DB_URI 가 운영 EARS 와 같은 DB(쿼리 무시)', { SE_WEB_DB_URI: 'mongodb://rw:pw@prod-mongo:27017/EARS' }, 'stop:WEB_DB_SAME_AS_EARS'],
    ['대소문자만 다른 같은 DB', { SE_WEB_DB_URI: 'mongodb://rw:pw@other:27017/ears?x=1' }, 'stop:WEB_DB_SAME_AS_EARS'],
    ['EARS_INTERFACE_URL 없음', { EARS_INTERFACE_URL: ' ' }, 'stop:INTERFACE_URL_MISSING'],
    ['SE_USER_SINGLEID 없음', { SE_USER_SINGLEID: '' }, 'stop:USER_MISSING'],
    ['SE_DEV_USER_OVERRIDE 가 1', { SE_DEV_USER_OVERRIDE: '1' }, 'stop:DEV_USER_OVERRIDE_ON'],
    ['IMAGE_CACHE_DIR 이 기본값', { IMAGE_CACHE_DIR: './.cache/images' }, 'warn:IMAGE_CACHE_DEFAULT'],
    ['IMAGE_CACHE_DIR 없음(기본값)', { IMAGE_CACHE_DIR: undefined }, 'warn:IMAGE_CACHE_DEFAULT']
  ])('%s → %s', (_, over, code) => {
    expect(codes(checkEnv({ ...GOOD, ...over }))).toEqual([code])
  })

  it('HOST 를 비우면 127.0.0.1 로 뜨므로 통과, MONGODB_URI 가 없으면 서버 기본값(EARS)과 비교한다', () => {
    expect(checkEnv({ ...GOOD, HOST: '' })).toEqual([])
    expect(codes(checkEnv({ ...GOOD, MONGODB_URI: undefined, SE_WEB_DB_URI: 'mongodb://localhost:27017/EARS' }))).toEqual(['stop:WEB_DB_SAME_AS_EARS'])
  })

  it('문구에 계정·비밀번호를 싣지 않는다(DB 이름만)', () => {
    const text = JSON.stringify(checkEnv({ ...GOOD, SE_WEB_DB_URI: 'mongodb://rw:secretpw@prod-mongo:27017/EARS' }))
    expect(text).toContain('EARS')
    expect(text).not.toContain('secretpw')
  })
})

describe('checkName — 시험 시나리오 이름', () => {
  it('이름이 없으면 보지 않는다', () => {
    expect(checkName({})).toEqual([])
  })
  it('SEW_TEST_yyyyMMdd(_n) 만 받는다 — 다른 시나리오에 쓰지 않게', () => {
    expect(checkName({ name: 'SEW_TEST_20261110', process: 'CVD', model: 'M' })).toEqual([])
    expect(checkName({ name: 'SEW_TEST_20261110_2', process: 'CVD', model: 'M' })).toEqual([])
    for (const name of ['ALARM_E1234_RECOVERY', 'SEW_TEST_2026111', 'sew_test_20261110', 'SEW_TEST_20261110_X']) {
      expect(codes(checkName({ name, process: 'CVD', model: 'M' }))).toEqual(['stop:NAME_FORMAT'])
    }
  })
  it('이름을 보려면 공정·모델이 함께 있어야 한다', () => {
    expect(codes(checkName({ name: 'SEW_TEST_20261110', process: 'CVD' }))).toEqual(['stop:NAME_TARGET_MISSING'])
  })
})

// 가짜 fetch: 경로 → [status, body] 또는 Error
function fakeFetch(routes) {
  const calls = []
  const fetch = async (url) => {
    calls.push(url)
    const path = url.replace('http://127.0.0.1:3100/api/scenario-editor', '')
    const r = routes[path]
    if (r instanceof Error) throw r
    if (!r) return { status: 404, json: async () => ({ code: 'NOT_FOUND' }) }
    return { status: r[0], json: async () => r[1] }
  }
  return { fetch, calls }
}
const API = 'http://127.0.0.1:3100/api/scenario-editor'
const ME_OK = ['/me', [200, { success: true, data: { singleid: 'hong.gildong', canWrite: true } }]]
const LIST = '/scenarios?process=CVD&model=MODEL_A'

describe('remoteChecks — 떠 있는 서버에 묻기', () => {
  it('서버가 떠 있지 않으면 경고만(쓰기 권한·이름은 보지 않음)', async () => {
    const { fetch } = fakeFetch({ '/me': new TypeError('fetch failed') })
    expect(codes(await remoteChecks({ api: API, fetch, name: 'SEW_TEST_20261110', process: 'CVD', model: 'MODEL_A' }))).toEqual(['warn:SERVER_DOWN'])
  })
  it('쓰기 권한이 없으면 멈춤', async () => {
    const { fetch } = fakeFetch({ '/me': [200, { success: true, data: { canWrite: false } }] })
    expect(codes(await remoteChecks({ api: API, fetch }))).toEqual(['stop:CANNOT_WRITE'])
  })
  it('사용자 조회가 실패하면 멈춤(응답 코드를 싣는다)', async () => {
    const { fetch } = fakeFetch({ '/me': [403, { code: 'USER_NOT_REGISTERED' }] })
    const fs = await remoteChecks({ api: API, fetch })
    expect(codes(fs)).toEqual(['stop:ME_FAILED'])
    expect(fs[0].message).toContain('USER_NOT_REGISTERED')
  })
  it('같은 공정·모델에 그 이름이 이미 있으면 멈춤 — 다른 날짜 접미사를 권한다', async () => {
    const { fetch, calls } = fakeFetch(Object.fromEntries([ME_OK, [LIST, [200, { success: true, data: [{ name: 'SEW_TEST_20261110' }, { name: 'X' }] }]]]))
    const fs = await remoteChecks({ api: API, fetch, name: 'SEW_TEST_20261110', process: 'CVD', model: 'MODEL_A' })
    expect(codes(fs)).toEqual(['stop:NAME_EXISTS'])
    expect(fs[0].message).toContain('SEW_TEST_20261110_2')
    expect(calls).toContain(`${API}${LIST}`)
  })
  it('이미 _n 이 붙은 이름이면 다음 번호를 권한다', async () => {
    const { fetch } = fakeFetch(Object.fromEntries([ME_OK, [LIST, [200, { success: true, data: [{ name: 'SEW_TEST_20261110_2' }] }]]]))
    const fs = await remoteChecks({ api: API, fetch, name: 'SEW_TEST_20261110_2', process: 'CVD', model: 'MODEL_A' })
    expect(fs[0].message).toContain('SEW_TEST_20261110_3')
  })
  it('이름이 없으면 통과, 목록 조회가 실패하면 멈춤', async () => {
    const free = fakeFetch(Object.fromEntries([ME_OK, [LIST, [200, { success: true, data: [{ name: 'X' }] }]]]))
    expect(await remoteChecks({ api: API, fetch: free.fetch, name: 'SEW_TEST_20261110', process: 'CVD', model: 'MODEL_A' })).toEqual([])
    const denied = fakeFetch(Object.fromEntries([ME_OK, [LIST, [403, { code: 'PROCESS_FORBIDDEN' }]]]))
    expect(codes(await remoteChecks({ api: API, fetch: denied.fetch, name: 'SEW_TEST_20261110', process: 'CVD', model: 'MODEL_A' }))).toEqual(['stop:LIST_FAILED'])
  })
})

describe('명령 줄', () => {
  it('인자: --env(기본 server/.env)·--name·--process·--model, 모르는 인자는 던진다', () => {
    expect(parseArgs([])).toEqual({ env: 'server/.env' })
    expect(parseArgs(['--env', 'x/.env', '--name', 'SEW_TEST_20261110', '--process', 'CVD', '--model', 'MODEL_A']))
      .toEqual({ env: 'x/.env', name: 'SEW_TEST_20261110', process: 'CVD', model: 'MODEL_A' })
    expect(() => parseArgs(['--force'])).toThrow('--force')
    expect(() => parseArgs(['--name'])).toThrow('--name')
  })
  it('서버 주소는 PORT(기본 3100)의 127.0.0.1', () => {
    expect(apiBase({})).toBe(API)
    expect(apiBase({ PORT: '3200' })).toBe('http://127.0.0.1:3200/api/scenario-editor')
  })
  it('멈춤이 하나라도 있으면 종료 코드 1, 경고만이면 0 — 결과를 줄마다 찍는다', async () => {
    const lines = []
    const { fetch } = fakeFetch(Object.fromEntries([ME_OK]))
    expect(await run({ argv: [], readEnv: () => ({ ...GOOD, IMAGE_CACHE_DIR: '' }), fetch, log: (l) => lines.push(l) })).toBe(0)
    expect(lines.join('\n')).toContain('IMAGE_CACHE_DEFAULT')
    lines.length = 0
    expect(await run({ argv: [], readEnv: () => ({ ...GOOD, HOST: '0.0.0.0' }), fetch, log: (l) => lines.push(l) })).toBe(1)
    expect(lines.join('\n')).toContain('HOST_NOT_LOOPBACK')
  })
  it('설정 파일이 없으면 멈춤(종료 코드 1)', async () => {
    const lines = []
    expect(await run({ argv: ['--env', 'nope/.env'], readEnv: () => null, fetch: async () => { throw new Error('x') }, log: (l) => lines.push(l) })).toBe(1)
    expect(lines.join('\n')).toContain('ENV_FILE_MISSING')
  })
})

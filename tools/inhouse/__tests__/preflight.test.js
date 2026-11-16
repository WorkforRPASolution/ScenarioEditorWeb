import { describe, it, expect, vi } from 'vitest'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { checkEnv, checkName, remoteChecks, interfaceCheck, checkSnapshotEnv, snapshotConnectCheck, snapshotRemoteChecks, parseArgs, apiBase, run } = require('../preflight')

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
    ['EARS_INTERFACE_URL 에 http:// 가 없음(IP)', { EARS_INTERFACE_URL: '10.1.2.3:8080' }, 'stop:INTERFACE_URL_FORMAT'],
    ['EARS_INTERFACE_URL 에 http:// 가 없음(이름)', { EARS_INTERFACE_URL: 'prod-is:8080' }, 'stop:INTERFACE_URL_FORMAT'],
    ['EARS_INTERFACE_URL 뒤에 경로', { EARS_INTERFACE_URL: 'http://prod-is:8080/EARS/Interface' }, 'stop:INTERFACE_URL_FORMAT'],
    ['EARS_INTERFACE_URL 끝에 /', { EARS_INTERFACE_URL: 'http://prod-is:8080/' }, 'stop:INTERFACE_URL_FORMAT'],
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
  const options = []
  const fetch = async (url, opts) => {
    calls.push(url)
    options.push(opts)
    const path = url.replace('http://127.0.0.1:3100/api/scenario-editor', '')
    const r = routes[path]
    if (r instanceof Error) throw r
    if (!r) return { status: 404, json: async () => ({ code: 'NOT_FOUND' }) }
    return { status: r[0], json: async () => r[1] }
  }
  return { fetch, calls, options }
}
const API = 'http://127.0.0.1:3100/api/scenario-editor'
const ME_OK = ['/me', [200, { success: true, data: { singleid: 'hong.gildong', canWrite: true } }]]
const LIST = '/scenarios?process=CVD&model=MODEL_A'
const NO_RULE = ['/name-rule', [200, { success: true, data: { exists: false, rules: [] } }]]
describe('interfaceCheck — InterfaceServer 에 연결되는지(TCP 연결만, 요청은 보내지 않는다)', () => {
  const calls = []
  const connectAs = (result) => async (host, port, ms) => { calls.push([host, port, ms]); return result }
  it('연결되면 통과 — 주소의 호스트·포트로 붙어 본다(포트가 없으면 http 80·https 443)', async () => {
    calls.length = 0
    expect(await interfaceCheck({ env: GOOD, connect: connectAs(null) })).toEqual([])
    expect(await interfaceCheck({ env: { ...GOOD, EARS_INTERFACE_URL: ' http://10.1.2.3 ' }, connect: connectAs(null) })).toEqual([])
    expect(await interfaceCheck({ env: { ...GOOD, EARS_INTERFACE_URL: 'https://is.example' }, connect: connectAs(null) })).toEqual([])
    // IPv6 주소는 대괄호를 떼고 붙는다(대괄호째면 이름으로 찾다 ENOTFOUND 가 된다)
    expect(await interfaceCheck({ env: { ...GOOD, EARS_INTERFACE_URL: 'http://[fd00::12]:8080' }, connect: connectAs(null) })).toEqual([])
    expect(calls.map((c) => c.slice(0, 2))).toEqual([['prod-is', 8080], ['10.1.2.3', 80], ['is.example', 443], ['fd00::12', 8080]])
    for (const c of calls) expect(c[2]).toBeGreaterThan(0)
  })
  it.each([
    ['ENOTFOUND', '이름을 찾지 못한다'],
    ['ECONNREFUSED', '받는 서버가 없다'],
    ['TIMEOUT', '응답이 없다'],
    ['EHOSTUNREACH', '응답이 없다']
  ])('연결하지 못하면 멈춤 — %s', async (code, phrase) => {
    const out = await interfaceCheck({ env: GOOD, connect: connectAs(code) })
    expect(codes(out)).toEqual(['stop:INTERFACE_UNREACHABLE'])
    expect(out[0].message).toContain('prod-is:8080')
    expect(out[0].message).toContain(code)
    expect(out[0].message).toContain(phrase)
  })
  it('주소가 없거나 꼴이 틀리면 붙어 보지 않는다(설정 점검이 이미 멈춘다), 문구에 계정을 싣지 않는다', async () => {
    calls.length = 0
    for (const v of ['', '10.1.2.3:8080', 'http://prod-is:8080/EARS/Interface']) {
      expect(await interfaceCheck({ env: { ...GOOD, EARS_INTERFACE_URL: v }, connect: connectAs('ECONNREFUSED') })).toEqual([])
    }
    expect(calls).toEqual([])
    const out = await interfaceCheck({ env: { ...GOOD, EARS_INTERFACE_URL: 'http://user:secretpw@prod-is:8080' }, connect: connectAs('ECONNREFUSED') })
    expect(JSON.stringify(out)).not.toContain('secretpw')
  })
})

const RULES = [{ groupLevel: '1', name: 'ALARM' }, { groupLevel: '2', name: 'RECOVERY' }]

describe('remoteChecks — 떠 있는 서버에 묻기', () => {
  it('서버가 떠 있지 않으면 이름 없이 돌릴 때는 경고, 이름을 주면 멈춤 — 보라고 한 것을 못 봤는데 통과로 알리지 않는다', async () => {
    const { fetch } = fakeFetch({ '/me': new TypeError('fetch failed') })
    expect(codes(await remoteChecks({ api: API, fetch }))).toEqual(['warn:SERVER_DOWN'])
    expect(codes(await remoteChecks({ api: API, fetch, name: 'SEW_TEST_20261110', process: 'CVD', model: 'MODEL_A' }))).toEqual(['stop:SERVER_DOWN'])
  })
  it('묻는 요청마다 시간 제한을 단다(응답 없는 서버에 매달리지 않게)', async () => {
    const { fetch, options } = fakeFetch(Object.fromEntries([ME_OK, NO_RULE, [LIST, [200, { success: true, data: [] }]]]))
    await remoteChecks({ api: API, fetch, name: 'SEW_TEST_20261110', process: 'CVD', model: 'MODEL_A' })
    expect(options).toHaveLength(3)
    for (const o of options) expect(o.signal).toBeInstanceOf(AbortSignal)
  })
  it('이름 규칙이 있으면 경고 — 새 시나리오 창에 이름 칸이 없어 README 의 우회 절차를 따른다', async () => {
    const ruled = fakeFetch(Object.fromEntries([ME_OK, ['/name-rule', [200, { success: true, data: { exists: true, rules: RULES } }]], [LIST, [200, { success: true, data: [] }]]]))
    expect(codes(await remoteChecks({ api: API, fetch: ruled.fetch, name: 'SEW_TEST_20261110', process: 'CVD', model: 'MODEL_A' }))).toEqual(['warn:NAME_RULE'])
    // 한쪽 분류만 있으면 규칙이 아니다(화면 nameRuleOf 와 같은 판정)
    const half = fakeFetch(Object.fromEntries([ME_OK, ['/name-rule', [200, { success: true, data: { exists: true, rules: [RULES[0]] } }]], [LIST, [200, { success: true, data: [] }]]]))
    expect(await remoteChecks({ api: API, fetch: half.fetch, name: 'SEW_TEST_20261110', process: 'CVD', model: 'MODEL_A' })).toEqual([])
    const failed = fakeFetch(Object.fromEntries([ME_OK, ['/name-rule', [500, { code: 'INTERNAL' }]], [LIST, [200, { success: true, data: [] }]]]))
    expect(codes(await remoteChecks({ api: API, fetch: failed.fetch, name: 'SEW_TEST_20261110', process: 'CVD', model: 'MODEL_A' }))).toEqual(['warn:NAME_RULE_UNKNOWN'])
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
    const { fetch, calls } = fakeFetch(Object.fromEntries([ME_OK, NO_RULE, [LIST, [200, { success: true, data: [{ name: 'SEW_TEST_20261110' }, { name: 'X' }] }]]]))
    const fs = await remoteChecks({ api: API, fetch, name: 'SEW_TEST_20261110', process: 'CVD', model: 'MODEL_A' })
    expect(codes(fs)).toEqual(['stop:NAME_EXISTS'])
    expect(fs[0].message).toContain('SEW_TEST_20261110_2')
    expect(calls).toContain(`${API}${LIST}`)
  })
  it('이미 _n 이 붙은 이름이면 다음 번호를 권한다', async () => {
    const { fetch } = fakeFetch(Object.fromEntries([ME_OK, NO_RULE, [LIST, [200, { success: true, data: [{ name: 'SEW_TEST_20261110_2' }] }]]]))
    const fs = await remoteChecks({ api: API, fetch, name: 'SEW_TEST_20261110_2', process: 'CVD', model: 'MODEL_A' })
    expect(fs[0].message).toContain('SEW_TEST_20261110_3')
  })
  it('이름이 없으면 통과, 목록 조회가 실패하면 멈춤', async () => {
    const free = fakeFetch(Object.fromEntries([ME_OK, NO_RULE, [LIST, [200, { success: true, data: [{ name: 'X' }] }]]]))
    expect(await remoteChecks({ api: API, fetch: free.fetch, name: 'SEW_TEST_20261110', process: 'CVD', model: 'MODEL_A' })).toEqual([])
    const denied = fakeFetch(Object.fromEntries([ME_OK, NO_RULE, [LIST, [403, { code: 'PROCESS_FORBIDDEN' }]]]))
    expect(codes(await remoteChecks({ api: API, fetch: denied.fetch, name: 'SEW_TEST_20261110', process: 'CVD', model: 'MODEL_A' }))).toEqual(['stop:LIST_FAILED'])
  })
})

// ── 스냅샷·이력(P3) — 읽기만 하는 기능이라 틀려도 멈춤이 아니라 경고다(쓰기 시험을 막지 않는다) ──
const SNAP = {
  CASSANDRA_CONTACT_POINTS: 'cas-1, cas-2', CASSANDRA_PORT: '9042', CASSANDRA_LOCAL_DC: 'dc1', CASSANDRA_KEYSPACE: 'ars',
  CASSANDRA_USERNAME: 'reader', CASSANDRA_PASSWORD: 'secretpw', HTTP_WEB_SERVER_URL: 'http://prod-hws:8082'
}

describe('checkSnapshotEnv — 스냅샷·이력 설정(구역 [10])', () => {
  it('채운 프로필은 경고가 없다', () => {
    expect(checkSnapshotEnv({ ...GOOD, ...SNAP })).toEqual([])
  })
  it('Cassandra 주소가 비면 경고 하나 — 스냅샷을 쓰지 않는 시험이면 그대로 둔다. 이력 주소는 보지 않는다', () => {
    expect(codes(checkSnapshotEnv({ ...GOOD }))).toEqual(['warn:SNAPSHOT_UNSET'])
    expect(codes(checkSnapshotEnv({ ...GOOD, ...SNAP, CASSANDRA_CONTACT_POINTS: ' , ', HTTP_WEB_SERVER_URL: 'prod-hws' }))).toEqual(['warn:SNAPSHOT_UNSET'])
  })
  it.each([
    ['주소에 cql:// 같은 머리', { CASSANDRA_CONTACT_POINTS: 'cas-1,tcp://cas-2' }, 'warn:CASSANDRA_POINTS_FORMAT', '2번째'],
    ['주소에 계정', { CASSANDRA_CONTACT_POINTS: 'reader@cas-1' }, 'warn:CASSANDRA_POINTS_FORMAT', '1번째'],
    ['주소에 붙인 포트가 숫자가 아님', { CASSANDRA_CONTACT_POINTS: 'cas-1:cql' }, 'warn:CASSANDRA_POINTS_FORMAT', '1번째'],
    ['콜론이 여럿인데 IP 가 아님', { CASSANDRA_CONTACT_POINTS: '10.0.0.1:9042:9042' }, 'warn:CASSANDRA_POINTS_FORMAT', '1번째'],
    ['포트가 숫자가 아님(서버는 말없이 9042 를 쓴다)', { CASSANDRA_PORT: '9042/tcp' }, 'warn:CASSANDRA_PORT_FORMAT', '9042 로'],
    ['포트가 범위 밖(서버는 그 포트로 붙으려다 실패한다)', { CASSANDRA_PORT: '99999' }, 'warn:CASSANDRA_PORT_FORMAT', '1~65535'],
    ['포트가 0', { CASSANDRA_PORT: '0' }, 'warn:CASSANDRA_PORT_FORMAT', '1~65535'],
    ['계정만 있고 비밀번호가 없음(서버는 계정 없이 붙는다)', { CASSANDRA_PASSWORD: '' }, 'warn:CASSANDRA_CREDENTIALS_HALF', '둘 다'],
    ['비밀번호만 있음', { CASSANDRA_USERNAME: ' ' }, 'warn:CASSANDRA_CREDENTIALS_HALF', '둘 다'],
    ['이력 주소가 빔(이력 보기만 꺼진다)', { HTTP_WEB_SERVER_URL: '' }, 'warn:HISTORY_UNSET', '이력 보기'],
    ['이력 주소에 http:// 가 없음', { HTTP_WEB_SERVER_URL: 'prod-hws:8082' }, 'warn:HISTORY_URL_FORMAT', 'http://'],
    ['이력 주소 뒤에 /ARS/History(서버가 한 번 더 붙인다)', { HTTP_WEB_SERVER_URL: 'http://prod-hws:8082/ARS/History/' }, 'warn:HISTORY_URL_FORMAT', '/ARS/History'],
    ['이력 주소에 계정(서버의 fetch 가 받지 않는다)', { HTTP_WEB_SERVER_URL: 'http://u:pw@prod-hws:8082' }, 'warn:HISTORY_URL_FORMAT', '계정'],
    ['이력 주소에 ?', { HTTP_WEB_SERVER_URL: 'http://prod-hws:8082?x=1' }, 'warn:HISTORY_URL_FORMAT', '?'],
    ['이력 주소의 포트가 글자', { HTTP_WEB_SERVER_URL: 'http://prod-hws:port' }, 'warn:HISTORY_URL_FORMAT', '읽지 못']
  ])('%s → %s', (_, over, code, phrase) => {
    const out = checkSnapshotEnv({ ...GOOD, ...SNAP, ...over })
    expect(codes(out)).toEqual([code])
    expect(out[0].message).toContain(phrase)
  })
  it('서버(드라이버)가 받는 꼴은 경고하지 않는다', () => {
    for (const over of [
      { CASSANDRA_PORT: '' }, { CASSANDRA_CONTACT_POINTS: '10.1.2.3' }, { CASSANDRA_CONTACT_POINTS: 'fd00::12' }, { CASSANDRA_CONTACT_POINTS: 'cas.example.com.' },
      // 드라이버는 host:port·[ipv6]:port 를 풀고 그 포트를 CASSANDRA_PORT 보다 앞세운다
      { CASSANDRA_CONTACT_POINTS: 'cas-1:9142, [fd00::12]:9142' },
      { CASSANDRA_USERNAME: '', CASSANDRA_PASSWORD: '' },
      // 공백뿐인 비밀번호도 서버는 그대로 보낸다(다듬지 않는다)
      { CASSANDRA_PASSWORD: ' ' },
      { HTTP_WEB_SERVER_URL: ' https://hws.example/ ' },
      // 앞에 경로가 붙은 주소(게이트웨이 뒤)도 서버는 그대로 뒤에 /ARS/History/… 를 붙여 부른다
      { HTTP_WEB_SERVER_URL: 'http://gw:80/hws' }
    ]) {
      expect(checkSnapshotEnv({ ...GOOD, ...SNAP, ...over })).toEqual([])
    }
  })
  it('문구에 설정 값을 되찍지 않는다 — 틀린 자리에 계정·비밀번호가 들어 있을 수 있다', () => {
    const text = JSON.stringify(checkSnapshotEnv({
      ...GOOD, ...SNAP, CASSANDRA_CONTACT_POINTS: 'cassandra://reader:secretpw@10.0.0.1:9042', CASSANDRA_PORT: 'secretpw',
      CASSANDRA_USERNAME: '', HTTP_WEB_SERVER_URL: 'http://u:secretpw@prod-hws:8082/x'
    }))
    expect(text).toContain('CASSANDRA_POINTS_FORMAT')
    expect(text).toContain('CASSANDRA_PORT_FORMAT')
    expect(text).toContain('HISTORY_URL_FORMAT')
    expect(text).not.toContain('secretpw')
    expect(text).not.toContain('10.0.0.1')
  })
})

describe('snapshotConnectCheck — 이 PC 에서 Cassandra·이력 서버에 연결되는지(TCP 연결만)', () => {
  const dial = (table) => {
    const calls = []
    return { calls, connect: async (host, port, ms) => { calls.push([host, port, ms]); return table[`${host}:${port}`] ?? null } }
  }
  const pairs = (d) => d.calls.map((c) => `${c[0]}:${c[1]}`).sort()
  it('모두 연결되면 통과 — 주소마다 CASSANDRA_PORT 로, 이력 서버는 주소의 호스트·포트로', async () => {
    const d = dial({})
    expect(await snapshotConnectCheck({ env: { ...GOOD, ...SNAP }, connect: d.connect })).toEqual([])
    expect(pairs(d)).toEqual(['cas-1:9042', 'cas-2:9042', 'prod-hws:8082'])
    for (const c of d.calls) expect(c[2]).toBeGreaterThan(0)
  })
  it('서버와 같은 포트로 붙는다 — 주소에 붙인 포트가 먼저, 비었거나 숫자가 아니면 9042, 이력은 http 80·https 443, IPv6 는 대괄호 없이', async () => {
    const d = dial({})
    await snapshotConnectCheck({ env: { ...GOOD, ...SNAP, CASSANDRA_CONTACT_POINTS: 'cas-1:9142,[fd00::12]:9143,cas-3', CASSANDRA_PORT: '', HTTP_WEB_SERVER_URL: 'https://hws.example/' }, connect: d.connect })
    expect(pairs(d)).toEqual(['cas-1:9142', 'cas-3:9042', 'fd00::12:9143', 'hws.example:443'])
    const e = dial({})
    await snapshotConnectCheck({ env: { ...GOOD, ...SNAP, CASSANDRA_CONTACT_POINTS: 'cas-1', CASSANDRA_PORT: '9042/tcp', HTTP_WEB_SERVER_URL: 'http://[fd00::12]/gw' }, connect: e.connect })
    expect(pairs(e)).toEqual(['cas-1:9042', 'fd00::12:80'])
  })
  it('Cassandra 주소 모두에 연결하지 못하면 경고 — 주소마다 까닭을 싣는다', async () => {
    const d = dial({ 'cas-1:9042': 'ECONNREFUSED', 'cas-2:9042': 'ENOTFOUND' })
    const out = await snapshotConnectCheck({ env: { ...GOOD, ...SNAP }, connect: d.connect })
    expect(codes(out)).toEqual(['warn:CASSANDRA_UNREACHABLE'])
    expect(out[0].message).toContain('cas-1:9042(ECONNREFUSED)')
    expect(out[0].message).toContain('cas-2:9042(ENOTFOUND)')
  })
  it('일부에만 연결하지 못하면 다른 경고 — 나머지로 붙는다', async () => {
    const d = dial({ 'cas-2:9042': 'TIMEOUT' })
    const out = await snapshotConnectCheck({ env: { ...GOOD, ...SNAP }, connect: d.connect })
    expect(codes(out)).toEqual(['warn:CASSANDRA_POINT_UNREACHABLE'])
    expect(out[0].message).toContain('cas-2:9042(TIMEOUT)')
    expect(out[0].message).not.toContain('cas-1')
  })
  it('이력 서버에 연결하지 못하면 경고', async () => {
    const d = dial({ 'prod-hws:8082': 'ECONNREFUSED' })
    const out = await snapshotConnectCheck({ env: { ...GOOD, ...SNAP }, connect: d.connect })
    expect(codes(out)).toEqual(['warn:HISTORY_UNREACHABLE'])
    expect(out[0].message).toContain('prod-hws:8082')
  })
  it('꼴이 틀린 값에는 붙어 보지 않는다(설정 점검이 이미 알린다) — 꼴이 맞는 나머지에는 붙어 본다', async () => {
    const d = dial({})
    // Cassandra 주소가 비었으면 이력 서버도 보지 않는다(스냅샷 화면이 꺼져 있다)
    expect(await snapshotConnectCheck({ env: { ...GOOD, HTTP_WEB_SERVER_URL: 'http://prod-hws:8082' }, connect: d.connect })).toEqual([])
    expect(await snapshotConnectCheck({ env: { ...GOOD, ...SNAP, CASSANDRA_PORT: '99999', HTTP_WEB_SERVER_URL: 'prod-hws:8082' }, connect: d.connect })).toEqual([])
    expect(await snapshotConnectCheck({ env: { ...GOOD, ...SNAP, CASSANDRA_CONTACT_POINTS: 'tcp://cas-1', HTTP_WEB_SERVER_URL: 'http://u:secretpw@prod-hws:8082' }, connect: d.connect })).toEqual([])
    expect(d.calls).toEqual([])
    await snapshotConnectCheck({ env: { ...GOOD, ...SNAP, CASSANDRA_CONTACT_POINTS: 'tcp://cas-1,cas-2', HTTP_WEB_SERVER_URL: '' }, connect: d.connect })
    expect(pairs(d)).toEqual(['cas-2:9042'])
  })
})

const EQP = ['/equipment', [200, { success: true, data: { items: [{ eqpId: "O'DD" }, { eqpId: 7 }, { eqpId: '' }, { eqpId: 'EQP 01' }, { eqpId: 'EQP02' }] } }]]
const DAYS = '/snapshots/days?eqpId=EQP+01'
const DAYS_OK = [DAYS, [200, { success: true, data: { eqpId: 'EQP 01', latest: '2026-11-16' } }]]
const HIST = '/history/EQP%2001/99999'
const HIST_NONE = [HIST, [404, { code: 'HISTORY_NOT_FOUND' }]]

describe('snapshotRemoteChecks — 떠 있는 서버를 거쳐 실제로 조회해 본다(계정·데이터센터 이름까지)', () => {
  const ENV = { ...GOOD, ...SNAP }
  it('스냅샷 조회가 되고 이력 서버가 답하면(없는 이력 404 포함) 통과 — 작은따옴표가 없는 첫 설비로 묻는다', async () => {
    const { fetch, calls, options } = fakeFetch(Object.fromEntries([EQP, DAYS_OK, HIST_NONE]))
    expect(await snapshotRemoteChecks({ api: API, fetch, env: ENV })).toEqual([])
    expect(calls).toEqual([`${API}/equipment`, `${API}${DAYS}`, `${API}${HIST}`])
    for (const o of options) expect(o.signal).toBeInstanceOf(AbortSignal)
    const found = fakeFetch(Object.fromEntries([EQP, DAYS_OK, [HIST, [200, { success: true, data: { steps: [{}] } }]]]))
    expect(await snapshotRemoteChecks({ api: API, fetch: found.fetch, env: ENV })).toEqual([])
  })
  it('서버의 시간 제한(Cassandra 연결 5초 + 읽기 10초, 이력 15초)보다 길게 기다린다', async () => {
    const spy = vi.spyOn(AbortSignal, 'timeout')
    try {
      const { fetch } = fakeFetch(Object.fromEntries([EQP, DAYS_OK, HIST_NONE]))
      await snapshotRemoteChecks({ api: API, fetch, env: ENV })
      expect(spy.mock.calls).toHaveLength(3)
      for (const [ms] of spy.mock.calls) expect(ms).toBeGreaterThan(15000)
    } finally { spy.mockRestore() }
  })
  it('Cassandra 주소가 비었으면 묻지 않는다, 이력 주소가 비었거나 꼴이 틀리면 이력은 묻지 않는다(설정 점검이 알린다)', async () => {
    const a = fakeFetch(Object.fromEntries([EQP, DAYS_OK, HIST_NONE]))
    expect(await snapshotRemoteChecks({ api: API, fetch: a.fetch, env: GOOD })).toEqual([])
    expect(a.calls).toEqual([])
    for (const url of ['', 'prod-hws:8082', 'http://u:pw@prod-hws:8082']) {
      const b = fakeFetch(Object.fromEntries([EQP, DAYS_OK]))
      expect(await snapshotRemoteChecks({ api: API, fetch: b.fetch, env: { ...ENV, HTTP_WEB_SERVER_URL: url } })).toEqual([])
      expect(b.calls).toEqual([`${API}/equipment`, `${API}${DAYS}`])
    }
  })
  it('앞에 경로가 붙은 이력 주소는 서버가 받으므로 실제로 물어 본다', async () => {
    const { fetch, calls } = fakeFetch(Object.fromEntries([EQP, DAYS_OK, [HIST, [503, { code: 'HISTORY_DOWN' }]]]))
    expect(codes(await snapshotRemoteChecks({ api: API, fetch, env: { ...ENV, HTTP_WEB_SERVER_URL: 'http://gw:80/hws' } }))).toEqual(['warn:HISTORY_DOWN'])
    expect(calls).toContain(`${API}${HIST}`)
  })
  it('설비 목록을 받지 못했으면(시간 초과·오류·읽지 못하는 답·내 범위에 설비 없음) 보지 못했다고 알린다 — 말없이 통과로 두지 않는다', async () => {
    const late = fakeFetch({ '/equipment': new DOMException('timeout', 'TimeoutError') })
    expect(codes(await snapshotRemoteChecks({ api: API, fetch: late.fetch, env: ENV }))).toEqual(['warn:SNAPSHOT_NOT_CHECKED'])
    const denied = fakeFetch({ '/equipment': [403, { code: 'USER_NOT_REGISTERED' }] })
    const a = await snapshotRemoteChecks({ api: API, fetch: denied.fetch, env: ENV })
    expect(codes(a)).toEqual(['warn:SNAPSHOT_NOT_CHECKED'])
    expect(a[0].message).toContain('USER_NOT_REGISTERED')
    const broken = async () => ({ status: 200, json: async () => { throw new SyntaxError('Unexpected token <') } })
    expect(codes(await snapshotRemoteChecks({ api: API, fetch: broken, env: ENV }))).toEqual(['warn:SNAPSHOT_NOT_CHECKED'])
    for (const data of [{ items: [{ eqpId: "O'DD" }] }, {}, null]) {
      const none = fakeFetch({ '/equipment': [200, { success: true, data }] })
      expect(codes(await snapshotRemoteChecks({ api: API, fetch: none.fetch, env: ENV }))).toEqual(['warn:SNAPSHOT_NOT_CHECKED'])
    }
  })
  it.each([
    // 실제 드라이버: 계정이 틀려도, 데이터센터 이름이 틀려도 "붙을 호스트가 없다"(SNAPSHOT_DOWN) 로 온다. 키스페이스가 틀리면 SNAPSHOT_FAILED
    [503, 'SNAPSHOT_DOWN', 'warn:SNAPSHOT_DOWN', ['CASSANDRA_LOCAL_DC', '비밀번호', '다시 띄']],
    [502, 'SNAPSHOT_FAILED', 'warn:SNAPSHOT_FAILED', ['CASSANDRA_KEYSPACE', '다시 띄']],
    [504, 'SNAPSHOT_TIMEOUT', 'warn:SNAPSHOT_TIMEOUT', ['늦']],
    [503, 'SNAPSHOT_UNSET', 'warn:SNAPSHOT_STALE_SERVER', ['다시 띄']],
    [500, 'INTERNAL', 'warn:SNAPSHOT_CHECK_FAILED', ['500 INTERNAL']]
  ])('스냅샷 조회가 %s %s 이면 %s — 이력은 Cassandra 설정과 따로라 그래도 묻는다', async (status, code, finding, phrases) => {
    const { fetch, calls } = fakeFetch(Object.fromEntries([EQP, [DAYS, [status, { code }]], [HIST, [503, { code: 'HISTORY_DOWN' }]]]))
    const out = await snapshotRemoteChecks({ api: API, fetch, env: ENV })
    expect(codes(out)).toEqual([finding, 'warn:HISTORY_DOWN'])
    for (const phrase of phrases) expect(out[0].message).toContain(phrase)
    expect(calls).toContain(`${API}${HIST}`)
  })
  it('스냅샷 조회가 시간 안에 답하지 않으면 늦다고, 서버가 그 사이 내려갔으면 보지 못했다고 알린다', async () => {
    const late = fakeFetch(Object.fromEntries([EQP, [DAYS, new DOMException('timeout', 'TimeoutError')], HIST_NONE]))
    expect(codes(await snapshotRemoteChecks({ api: API, fetch: late.fetch, env: ENV }))).toEqual(['warn:SNAPSHOT_TIMEOUT'])
    const gone = fakeFetch(Object.fromEntries([EQP, [DAYS, new TypeError('fetch failed')], [HIST, new TypeError('fetch failed')]]))
    expect(codes(await snapshotRemoteChecks({ api: API, fetch: gone.fetch, env: ENV }))).toEqual(['warn:SNAPSHOT_NOT_CHECKED', 'warn:HISTORY_NOT_CHECKED'])
  })
  it.each([
    [503, 'HISTORY_DOWN', 'warn:HISTORY_DOWN', '다시 띄'],
    [504, 'HISTORY_TIMEOUT', 'warn:HISTORY_TIMEOUT', '늦'],
    [502, 'HISTORY_UNREADABLE', 'warn:HISTORY_UNREADABLE', '다시 띄'],
    [503, 'HISTORY_UNSET', 'warn:HISTORY_STALE_SERVER', '다시 띄'],
    [400, 'BAD_REQUEST', 'warn:HISTORY_CHECK_FAILED', '400 BAD_REQUEST']
  ])('이력 조회가 %s %s 이면 %s', async (status, code, finding, phrase) => {
    const { fetch } = fakeFetch(Object.fromEntries([EQP, DAYS_OK, [HIST, [status, { code }]]]))
    const out = await snapshotRemoteChecks({ api: API, fetch, env: ENV })
    expect(codes(out)).toEqual([finding])
    expect(out[0].message).toContain(phrase)
  })
  it('이력 조회가 시간 안에 답하지 않으면 경고', async () => {
    const { fetch } = fakeFetch(Object.fromEntries([EQP, DAYS_OK, [HIST, new DOMException('timeout', 'TimeoutError')]]))
    expect(codes(await snapshotRemoteChecks({ api: API, fetch, env: ENV }))).toEqual(['warn:HISTORY_TIMEOUT'])
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
    const connect = async () => null
    expect(await run({ argv: [], readEnv: () => ({ ...GOOD, IMAGE_CACHE_DIR: '' }), fetch, connect, log: (l) => lines.push(l) })).toBe(0)
    expect(lines.join('\n')).toContain('IMAGE_CACHE_DEFAULT')
    lines.length = 0
    expect(await run({ argv: [], readEnv: () => ({ ...GOOD, HOST: '0.0.0.0' }), fetch, connect, log: (l) => lines.push(l) })).toBe(1)
    expect(lines.join('\n')).toContain('HOST_NOT_LOOPBACK')
  })
  it('InterfaceServer 에 연결하지 못하면 멈춤(종료 코드 1)', async () => {
    const lines = []
    const { fetch } = fakeFetch(Object.fromEntries([ME_OK]))
    expect(await run({ argv: [], readEnv: () => GOOD, fetch, connect: async () => 'ECONNREFUSED', log: (l) => lines.push(l) })).toBe(1)
    expect(lines.join('\n')).toContain('INTERFACE_UNREACHABLE')
  })
  it('스냅샷·이력은 틀려도 경고다 — 종료 코드 0, 서버가 꺼져 있다는 문구에 스냅샷 조회도 보지 않았다고 적는다', async () => {
    const lines = []
    const { fetch } = fakeFetch(Object.fromEntries([ME_OK, EQP, [DAYS, [503, { code: 'SNAPSHOT_DOWN' }]], HIST_NONE]))
    const connect = async (host) => (host === 'prod-is' ? null : 'ECONNREFUSED')
    expect(await run({ argv: [], readEnv: () => ({ ...GOOD, ...SNAP }), fetch, connect, log: (l) => lines.push(l) })).toBe(0)
    const text = lines.join('\n')
    for (const code of ['CASSANDRA_UNREACHABLE', 'HISTORY_UNREACHABLE', 'SNAPSHOT_DOWN']) expect(text).toContain(`경고  ${code}`)
    expect(text).toContain('통과(경고 3)')
    expect(text).not.toContain('secretpw')
    lines.length = 0
    // 설정 꼴 점검도 함께 돈다
    lines.length = 0
    const ok = fakeFetch(Object.fromEntries([ME_OK, EQP, DAYS_OK]))
    expect(await run({ argv: [], readEnv: () => ({ ...GOOD, ...SNAP, CASSANDRA_PASSWORD: '', HTTP_WEB_SERVER_URL: '' }), fetch: ok.fetch, connect: async () => null, log: (l) => lines.push(l) })).toBe(0)
    expect(lines.join('\n')).toContain('경고  CASSANDRA_CREDENTIALS_HALF')
    expect(lines.join('\n')).toContain('경고  HISTORY_UNSET')
    // 서버가 꺼져 있으면 SERVER_DOWN 하나만 — 스냅샷 조회는 묻지도 않는다
    const down = fakeFetch({ '/me': new TypeError('fetch failed'), '/equipment': new TypeError('fetch failed') })
    expect(await run({ argv: [], readEnv: () => ({ ...GOOD, ...SNAP }), fetch: down.fetch, connect: async () => null, log: (l) => lines.push(l) })).toBe(0)
    expect(lines.join('\n')).toMatch(/SERVER_DOWN.*스냅샷/)
    expect(lines.join('\n')).not.toContain('SNAPSHOT_NOT_CHECKED')
    expect(down.calls).toEqual([`${API}/me`])
  })
  it('설정 파일이 없으면 멈춤(종료 코드 1)', async () => {
    const lines = []
    expect(await run({ argv: ['--env', 'nope/.env'], readEnv: () => null, fetch: async () => { throw new Error('x') }, log: (l) => lines.push(l) })).toBe(1)
    expect(lines.join('\n')).toContain('ENV_FILE_MISSING')
  })
})

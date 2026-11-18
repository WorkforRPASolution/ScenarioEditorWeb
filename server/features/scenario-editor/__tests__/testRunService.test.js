// 시험 실행 서비스(P5 설계 §5.2~§5.4) — 설비·시나리오 조회, 설비 한 대 실행 요청, 실행 상태. 의존성은 모두 가짜다.
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { Long, Int32 } = require('bson')
const { createTestRunService } = require('../service/testRunService')
const { seError } = require('../errors')
const { parseUser } = require('../domain/processPermission')

const NOW = 1_763_427_600_000
const USER_DOC = { singleid: 'sew_multi', name: '홍길동', process: 'SEWCVD;SEWETCH', authority: 'WRITE' }
const USER = { ...parseUser(USER_DOC), duplicateUserDocs: 1 }
const eqp = (eqpId, over = {}) => ({
  eqpId, process: 'SEWCVD', eqpModel: 'SEWMODELA', line: 'SEWLINE1', lineDesc: '라인', category: 'Process', ipAddr: '10.99.1.1', ipAddrL: '',
  osVer: 'W10', emailcategory: 'SEW-SEWCVD-SEWMODELA-MAIL', onoff: 1, localpc: 0, webmanagerUse: 1, ...over
})
const PROPERTY = {
  IsEnabled: true, StartDelay: new Int32(0), RetryCnt: new Int32(0), RetryInterval: new Int32(10), Priority: new Int32(10),
  DoNotSendEmailWhenSuccess: false, DoNotSendEmailWhenStop: false, DoNotSendEmailWhenFail: false
}
const propDoc = (over = {}) => ({ property: { ...PROPERTY, ...over }, scCategory: Long.fromNumber(2) })
const REQ = { runId: 'run-12345678', process: 'SEWCVD', model: 'SEWMODELA', name: 'RUN_A', eqpId: 'SEWT_CVD_A01', startStep: 1, reason: { kind: 'INSPECTION' } }
const caught = async (p) => { try { await p } catch (e) { return e } throw new Error('던지지 않았다') }

// state 를 고쳐 가며 쓰는 가짜 의존성. 부른 것은 calls 에 적는다.
function setup(over = {}) {
  const calls = []
  const state = {
    now: NOW,
    userDocs: [USER_DOC],
    allowed: true,
    propertyDocs: [propDoc()],
    fields: ['RUN_A.1000', 'RUN_A.2000', 'OTHER.5'],
    stepCount: 4,
    cached: [eqp('SEWT_CVD_A01'), eqp('SEWT_CVD_A02', { ipAddr: '10.99.2.1' }), eqp('SEWT_CVD_OFF', { onoff: 0 }), eqp('SEWT_ETCH_A01', { process: 'SEWETCH' })],
    fresh: { SEWT_CVD_A01: [eqp('SEWT_CVD_A01')], SEWT_CVD_OFF: [eqp('SEWT_CVD_OFF', { onoff: 0 })] },
    onoff: null, // findOnoff 가 줄 것(null 이면 cached 의 값)
    recent: [],
    runs: [],
    count: 0,
    inserted: true,
    received: { kind: 'response', status: 200, text: '{"result":"Success","message":""}' },
    recoveries: [],
    env: { SE_TEST_RUN: '1' },
    ...over
  }
  const note = (name, args) => { calls.push({ name, args }) }
  const repo = {
    findUsers: async (id) => { note('findUsers', [id]); return state.userDocs },
    findRunPropertyDocs: async (key) => { note('findRunPropertyDocs', [key]); return state.propertyDocs },
    findEquipmentFresh: async (id) => { note('findEquipmentFresh', [id]); const eqps = state.fresh[id] ?? []; return { eqps, agents: eqps.map((e) => ({ eqpId: e.eqpId })) } },
    findOnoff: async (ids) => { note('findOnoff', [ids]); return state.onoff ?? state.cached.filter((e) => ids.includes(e.eqpId)).map((e) => ({ eqpId: e.eqpId, onoff: e.onoff })) },
    findRecoveries: async (q) => { note('findRecoveries', [q]); if (state.recoveryError) throw state.recoveryError; return state.recoveries },
    findRecoveriesAt: async (pairs) => { note('findRecoveriesAt', [pairs]); return state.recoveries }
  }
  const web = {
    countTestRuns: async (runId) => { note('countTestRuns', [runId]); return state.count },
    findRecentTestRuns: async (q) => { note('findRecentTestRuns', [q]); return state.recent.filter((r) => !q.eqpIds || q.eqpIds.includes(r.eqpId)) },
    insertTestRun: async (doc) => { note('insertTestRun', [doc]); return { inserted: state.inserted } },
    updateTestRun: async (...a) => { note('updateTestRun', a); if (state.updateError) throw state.updateError },
    findTestRuns: async (...a) => { note('findTestRuns', a); return state.runs },
    findRivalTestRuns: async (q) => { note('findRivalTestRuns', [q]); return state.rivals ?? [] }
  }
  const hash = { hkeys: async (key) => { note('hkeys', [key]); return state.fields } }
  const gridfs = { findVersionStats: async (p, m, versions) => { note('findVersionStats', [p, m, versions]); return new Map(versions.map((v) => [v.name, { stepCount: state.stepCount, sizeBytes: 1 }])) } }
  const scopes = {
    assertAllowed: async (user, p, m) => { note('assertAllowed', [user.singleid, p, m, user.processRaw]); if (!state.allowed) throw seError(403, 'PROCESS_FORBIDDEN', '공정 권한 밖의 공정·모델입니다') },
    scopeFor: async () => ({ valid: state.cached })
  }
  const client = { send: async (req) => { note('send', [req]); if (state.sendGate) await state.sendGate; if (state.sendError) throw state.sendError; return state.received } }
  const lines = []
  const log = { info: (m) => lines.push(m), warn: (m) => lines.push(m) }
  const service = createTestRunService({ repo, web, hash, gridfs, scopes, client, env: state.env, log, now: () => state.now })
  const of = (name) => calls.filter((c) => c.name === name)
  return { service, state, calls, of, lines }
}

describe('equipment — 고른 공정·모델의 설비', () => {
  it('내 범위의 유효 설비 가운데 그 공정·모델 것을 설비 ID 순으로, onoff 는 지금 값으로', async () => {
    const t = setup()
    t.state.onoff = [{ eqpId: 'SEWT_CVD_A01', onoff: 0 }, { eqpId: 'SEWT_CVD_A02', onoff: 1 }, { eqpId: 'SEWT_CVD_OFF', onoff: '0' }]
    const out = await t.service.equipment(USER, 'SEWCVD', 'SEWMODELA')
    expect(out.equipment).toEqual([
      { eqpId: 'SEWT_CVD_A01', line: 'SEWLINE1', ipAddr: '10.99.1.1', ipAddrL: '', onoff: 'off' }, // 캐시에는 켜짐 — 그 사이 꺼졌다
      { eqpId: 'SEWT_CVD_A02', line: 'SEWLINE1', ipAddr: '10.99.2.1', ipAddrL: '', onoff: 'on' },
      { eqpId: 'SEWT_CVD_OFF', line: 'SEWLINE1', ipAddr: '10.99.1.1', ipAddrL: '', onoff: 'unreadable' }
    ])
    expect(out.limits).toEqual({ maxEquipment: 200, recentMin: 10 })
    expect(t.of('assertAllowed')[0].args.slice(0, 3)).toEqual(['sew_multi', 'SEWCVD', 'SEWMODELA'])
    expect(t.of('findOnoff')).toHaveLength(1)
    expect(t.of('findOnoff')[0].args[0]).toEqual(['SEWT_CVD_A01', 'SEWT_CVD_A02', 'SEWT_CVD_OFF'])
  })
  it('지금 값을 읽지 못한 설비(그 사이 사라짐)는 읽을 수 없음으로', async () => {
    const t = setup({ onoff: [{ eqpId: 'SEWT_CVD_A01', onoff: 1 }] })
    const out = await t.service.equipment(USER, 'SEWCVD', 'SEWMODELA')
    expect(out.equipment.map((e) => e.onoff)).toEqual(['on', 'unreadable', 'unreadable'])
  })
  it('공정 권한 밖이면 403, 한도는 설정에서', async () => {
    const t = setup({ allowed: false })
    expect(await caught(t.service.equipment(USER, 'SEWPHOTO', 'SEWMODELA'))).toMatchObject({ statusCode: 403, code: 'PROCESS_FORBIDDEN' })
    const u = setup({ env: { SE_TEST_RUN_MAX_EQP: '50', SE_TEST_RUN_RECENT_MIN: '5' } })
    expect((await u.service.equipment(USER, 'SEWCVD', 'SEWMODELA')).limits).toEqual({ maxEquipment: 50, recentMin: 5 })
  })
})

describe('scenario — 시나리오 하나의 실행 정보', () => {
  const get = (t) => t.service.scenario(USER, 'SEWCVD', 'SEWMODELA', 'RUN_A')

  it('실행할 수 있는 시나리오: 막는 것 없음, 운영 속성(CommandServer 규칙), 현재 판과 스텝 수', async () => {
    const t = setup({ propertyDocs: [propDoc({ StartDelay: new Int32(30), RetryCnt: new Int32(2), Priority: new Int32(5), NextScenarioIfSuccess: { Name: 'NEXT_OK', Text: 't' }, DoNotSendEmailWhenStop: true })] })
    expect(await get(t)).toEqual({
      process: 'SEWCVD', model: 'SEWMODELA', name: 'RUN_A', current: { crtime: 2000, stepCount: 4 }, isEnabled: true, startDelay: 30, retryCnt: 2, retryInterval: 10, priority: 5,
      next: { success: 'NEXT_OK', fail: null }, emailSkip: { success: false, stop: true, fail: false }, blocks: [], recent: []
    })
    expect(t.of('hkeys')[0].args).toEqual(['SEWCVD-SEWMODELA'])
    expect(t.of('findVersionStats')[0].args).toEqual(['SEWCVD', 'SEWMODELA', [{ name: 'RUN_A', crtime: 2000 }]])
  })
  it('운영 속성 문서가 하나가 아니면 TEST_RUN_PROPERTY — 둘이면 첫 문서의 값을 보이고, 없으면 값은 null', async () => {
    const two = await get(setup({ propertyDocs: [propDoc(), propDoc({ IsEnabled: false })] }))
    expect(two.blocks).toEqual(['TEST_RUN_PROPERTY'])
    expect(two.isEnabled).toBe(true)
    const none = await get(setup({ propertyDocs: [] }))
    expect(none.blocks).toEqual(['TEST_RUN_PROPERTY'])
    expect([none.isEnabled, none.startDelay, none.priority, none.next, none.emailSkip]).toEqual([null, null, null, null, null])
    expect((await get(setup({ propertyDocs: [{ scCategory: Long.fromNumber(2) }] }))).blocks).toEqual(['TEST_RUN_PROPERTY'])
  })
  it('유형(scCategory)이 Int64 가 아니면 TEST_RUN_PROPERTY', async () => {
    expect((await get(setup({ propertyDocs: [{ property: PROPERTY, scCategory: new Int32(2) }] }))).blocks).toEqual(['TEST_RUN_PROPERTY'])
    expect((await get(setup({ propertyDocs: [{ property: PROPERTY }] }))).blocks).toEqual(['TEST_RUN_PROPERTY'])
  })
  it('꺼진 시나리오·현재 판 없음·스텝 수를 못 읽음', async () => {
    expect((await get(setup({ propertyDocs: [propDoc({ IsEnabled: false })] }))).blocks).toEqual(['TEST_RUN_SCENARIO_OFF'])
    const noCurrent = await get(setup({ fields: ['OTHER.5'] }))
    expect([noCurrent.blocks, noCurrent.current]).toEqual([['TEST_RUN_NOT_DEPLOYED'], null])
    const unreadable = await get(setup({ stepCount: null }))
    expect([unreadable.blocks, unreadable.current]).toEqual([['TEST_RUN_VERSION_UNREADABLE'], { crtime: 2000, stepCount: null }])
  })
  it('이름을 헤더로 보낼 수 없거나, 시작 지연·재시도가 있는데 지연 키 규칙에 안 맞으면 TEST_RUN_NAME', async () => {
    const korean = setup({ fields: ['점검.7'] })
    expect((await korean.service.scenario(USER, 'SEWCVD', 'SEWMODELA', '점검')).blocks).toEqual(['TEST_RUN_NAME'])
    const spaced = (over) => setup({ fields: ['RUN A.7'], propertyDocs: [propDoc(over)] }).service.scenario(USER, 'SEWCVD', 'SEWMODELA', 'RUN A')
    expect((await spaced({})).blocks).toEqual([]) // 지연·재시도가 없으면 빈칸이 든 이름도 그대로 실행된다
    expect((await spaced({ StartDelay: new Int32(5) })).blocks).toEqual(['TEST_RUN_NAME'])
    expect((await spaced({ RetryCnt: new Int32(1) })).blocks).toEqual(['TEST_RUN_NAME'])
  })
  it('여러 가지가 걸리면 순서대로 모두 알린다', async () => {
    const out = await setup({ propertyDocs: [propDoc({ IsEnabled: false }), propDoc()], fields: [] }).service.scenario(USER, 'SEWCVD', 'SEWMODELA', '점검')
    expect(out.blocks).toEqual(['TEST_RUN_PROPERTY', 'TEST_RUN_SCENARIO_OFF', 'TEST_RUN_NAME', 'TEST_RUN_NOT_DEPLOYED'])
  })
  it('방금 요청: 설비마다 가장 늦은 요청 하나(누가·언제) — 설정한 분 안의 것', async () => {
    const t = setup({ recent: [
      { eqpId: 'SEWT_CVD_A02', user: 'sew_master', sentAt: NOW - 60_000 },
      { eqpId: 'SEWT_CVD_A01', user: 'sew_multi', sentAt: NOW - 120_000 },
      { eqpId: 'SEWT_CVD_A02', user: 'sew_cvd', sentAt: NOW - 300_000 }
    ] })
    expect((await get(t)).recent).toEqual([{ eqpId: 'SEWT_CVD_A01', by: 'sew_multi', at: NOW - 120_000 }, { eqpId: 'SEWT_CVD_A02', by: 'sew_master', at: NOW - 60_000 }])
    expect(t.of('findRecentTestRuns')[0].args[0]).toEqual({ process: 'SEWCVD', model: 'SEWMODELA', name: 'RUN_A', since: NOW - 10 * 60_000 })
  })
  it('스텝 수는 (공정·모델·이름·crtime)으로 1분 기억한다 — 못 읽은 것은 기억하지 않는다', async () => {
    const t = setup()
    await get(t); await get(t)
    expect(t.of('findVersionStats')).toHaveLength(1)
    t.state.now += 61_000
    await get(t)
    expect(t.of('findVersionStats')).toHaveLength(2)
    t.state.fields = ['RUN_A.3000'] // 새 판
    await get(t)
    expect(t.of('findVersionStats')).toHaveLength(3)
    const bad = setup({ stepCount: null })
    await get(bad); await get(bad)
    expect(bad.of('findVersionStats')).toHaveLength(2)
  })
  it('공정 권한 밖이면 403 — 아무것도 읽지 않는다', async () => {
    const t = setup({ allowed: false })
    expect(await caught(get(t))).toMatchObject({ code: 'PROCESS_FORBIDDEN' })
    expect(t.of('findRunPropertyDocs')).toHaveLength(0)
  })
})

describe('request — 설비 한 대의 실행 요청', () => {
  const run = (t, over = {}) => t.service.request(USER, { ...REQ, ...over })

  it('접수: 다시 읽은 설비 값으로 보내고, 요청 기록을 sending 으로 넣었다가 accepted 로 고친다', async () => {
    const t = setup()
    expect(await run(t, { startStep: 3, reason: { kind: 'other', text: ' 밸브 "A" 점검 ' } })).toEqual({ outcome: 'accepted' })
    expect(t.of('send')[0].args[0]).toEqual({
      process: 'SEWCVD', model: 'SEWMODELA', eqpId: 'SEWT_CVD_A01', name: 'RUN_A', line: 'SEWLINE1', txn: NOW,
      body: JSON.stringify({ '@UserInfo': '홍길동 - sew_multi', '@StartStep': '3', UserText: '밸브 "A" 점검' })
    })
    const doc = t.of('insertTestRun')[0].args[0]
    expect(doc).toEqual({
      runId: 'run-12345678', eqpId: 'SEWT_CVD_A01', process: 'SEWCVD', model: 'SEWMODELA', name: 'RUN_A', user: 'sew_multi', userInfo: '홍길동 - sew_multi', startStep: 3,
      reasonKind: 'other', userText: '밸브 "A" 점검', state: 'sending', detail: null, sentAt: NOW, doneAt: null, createdAt: new Date(NOW)
    })
    expect(t.of('updateTestRun')[0].args).toEqual(['run-12345678', 'SEWT_CVD_A01', { state: 'accepted', detail: null, doneAt: NOW }])
    // 순서: 기록을 넣은 뒤에 보낸다
    const order = t.calls.map((c) => c.name).filter((n) => ['insertTestRun', 'send', 'updateTestRun'].includes(n))
    expect(order).toEqual(['insertTestRun', 'send', 'updateTestRun'])
  })
  it('입력 꼴이 틀리면 400 과 걸린 칸 — 아무것도 읽지 않는다', async () => {
    const t = setup()
    const e = await caught(run(t, { startStep: 0 }))
    expect(e).toMatchObject({ statusCode: 400, code: 'BAD_REQUEST', details: { path: 'startStep' } })
    expect(t.calls).toEqual([])
  })
  it('사용자를 캐시 없이 다시 읽는다 — 그 사이 WRITE 를 잃었거나 사라졌거나 문서가 여럿이면 막는다', async () => {
    const lost = setup({ userDocs: [{ ...USER_DOC, authority: 'READ' }] })
    expect(await caught(run(lost))).toMatchObject({ statusCode: 403, code: 'WRITE_FORBIDDEN' })
    expect(await caught(run(setup({ userDocs: [] })))).toMatchObject({ statusCode: 403, code: 'USER_NOT_REGISTERED' })
    expect(await caught(run(setup({ userDocs: [USER_DOC, USER_DOC] })))).toMatchObject({ statusCode: 403, code: 'TEST_RUN_USER_AMBIGUOUS' })
    expect(lost.of('findUsers')[0].args).toEqual(['sew_multi'])
    expect(lost.of('send')).toHaveLength(0)
  })
  it('@UserInfo 와 공정 판단은 다시 읽은 사용자 문서에서 — 요청 본문·캐시의 값을 쓰지 않는다', async () => {
    const t = setup({ userDocs: [{ ...USER_DOC, name: '새 이름' }] })
    await t.service.request({ ...USER, name: '캐시 이름' }, { ...REQ, '@UserInfo': '남의 이름 - other' })
    expect(JSON.parse(t.of('send')[0].args[0].body)['@UserInfo']).toBe('새 이름 - sew_multi')
  })
  it('공정 판단과 설비 범위도 다시 읽은 사용자로 한다 — 목록을 본 뒤 공정이 바뀌었으면 캐시의 공정으로 보내지 않는다', async () => {
    const t = setup({ userDocs: [{ ...USER_DOC, process: 'SEWPHOTO' }] })
    // 캐시의 사용자(USER)는 SEWCVD·SEWETCH 다. 다시 읽은 문서는 SEWPHOTO 뿐 — 공정 검사에 그 값이 가고, SEWCVD 설비는 범위 밖이 된다
    expect(await run(t)).toEqual({ outcome: 'forbidden' })
    expect(t.of('assertAllowed')[0].args).toEqual(['sew_multi', 'SEWCVD', 'SEWMODELA', 'SEWPHOTO'])
    expect(t.of('send')).toHaveLength(0)
  })
  it('검사가 오래 걸려(20초 넘게) 브라우저가 포기했을 수 있으면 보내지 않는다 — 기록도 넣지 않는다', async () => {
    const t = setup()
    const realFresh = t.state.fresh
    Object.defineProperty(t.state, 'fresh', { get() { t.state.now += 21_000; return realFresh } }) // 설비를 다시 읽는 데 21초
    expect(await caught(run(t))).toMatchObject({ statusCode: 503, code: 'TEST_RUN_SLOW' })
    expect(t.of('insertTestRun')).toHaveLength(0)
    expect(t.of('send')).toHaveLength(0)
    Object.defineProperty(t.state, 'fresh', { value: realFresh })
    expect(await run(t, { runId: 'run-22222222' })).toEqual({ outcome: 'accepted' }) // 자리는 풀렸다
  })
  it('공정 권한 밖이면 403', async () => {
    const t = setup({ allowed: false })
    expect(await caught(run(t))).toMatchObject({ statusCode: 403, code: 'PROCESS_FORBIDDEN' })
    expect(t.of('findRunPropertyDocs')).toHaveLength(0)
  })
  it('시나리오가 막히면 요청 전체가 오류다(첫 까닭) — 보내지 않고 적지 않는다', async () => {
    const cases = [
      [{ propertyDocs: [propDoc(), propDoc()] }, 422, 'TEST_RUN_PROPERTY', { count: 2 }],
      [{ propertyDocs: [] }, 422, 'TEST_RUN_PROPERTY', { count: 0 }],
      [{ propertyDocs: [{ property: PROPERTY, scCategory: new Int32(2) }] }, 422, 'TEST_RUN_PROPERTY', { reason: 'scCategory' }],
      [{ propertyDocs: [propDoc({ IsEnabled: false })] }, 409, 'TEST_RUN_SCENARIO_OFF', null],
      [{ fields: [] }, 404, 'TEST_RUN_NOT_DEPLOYED', null],
      [{ stepCount: null }, 422, 'TEST_RUN_VERSION_UNREADABLE', null]
    ]
    for (const [over, status, code, details] of cases) {
      const t = setup(over)
      const e = await caught(run(t))
      expect([e.statusCode, e.code, e.details ?? null]).toEqual([status, code, details])
      expect(t.of('insertTestRun')).toHaveLength(0)
      expect(t.of('send')).toHaveLength(0)
    }
  })
  it('시작 스텝이 현재 판의 스텝 수를 넘으면 409 와 상한', async () => {
    const t = setup({ stepCount: 4 })
    expect(await caught(run(t, { startStep: 5 }))).toMatchObject({ statusCode: 409, code: 'TEST_RUN_START_STEP', details: { max: 4 } })
    expect(await run(t, { startStep: 4 })).toEqual({ outcome: 'accepted' })
  })
  it('한도: 그 실행의 요청 기록이 한도에 닿았으면 409 TEST_RUN_LIMIT', async () => {
    const t = setup({ count: 200 })
    expect(await caught(run(t))).toMatchObject({ statusCode: 409, code: 'TEST_RUN_LIMIT', details: { max: 200 } })
    expect(t.of('countTestRuns')[0].args).toEqual(['run-12345678'])
    expect(await run(setup({ count: 199 }))).toEqual({ outcome: 'accepted' })
    expect(await caught(run(setup({ count: 3, env: { SE_TEST_RUN_MAX_EQP: '3' } })))).toMatchObject({ code: 'TEST_RUN_LIMIT' })
  })
  it('설비가 내 범위의 유효 설비가 아니면 forbidden — 없는 설비·무효 설비·범위 밖을 가르지 않는다', async () => {
    const t = setup()
    expect(await run(t, { eqpId: 'NO_SUCH' })).toEqual({ outcome: 'forbidden' })
    t.state.fresh.SEWT_BAD = [eqp('SEWT_BAD', { emailcategory: 'A-B-C' })]
    expect(await run(t, { eqpId: 'SEWT_BAD' })).toEqual({ outcome: 'forbidden' })
    t.state.fresh.SEWT_PHOTO = [eqp('SEWT_PHOTO', { process: 'SEWPHOTO' })]
    expect(await run(t, { eqpId: 'SEWT_PHOTO' })).toEqual({ outcome: 'forbidden' })
    expect(t.of('send')).toHaveLength(0)
    expect(t.of('insertTestRun')).toHaveLength(0)
    expect(t.of('findEquipmentFresh').map((c) => c.args[0])).toEqual(['NO_SUCH', 'SEWT_BAD', 'SEWT_PHOTO'])
  })
  it('설비의 공정·모델이 요청과 다르면 mismatch(DC-010)', async () => {
    const t = setup()
    t.state.fresh.SEWT_CVD_B01 = [eqp('SEWT_CVD_B01', { eqpModel: 'SEWMODELB' })]
    expect(await run(t, { eqpId: 'SEWT_CVD_B01' })).toEqual({ outcome: 'mismatch' })
    t.state.fresh.SEWT_ETCH_A01 = [eqp('SEWT_ETCH_A01', { process: 'SEWETCH' })]
    expect(await run(t, { eqpId: 'SEWT_ETCH_A01' })).toEqual({ outcome: 'mismatch' })
  })
  it('자동조치 OFF(지금 값) 설비는 off, 숫자로 읽히지 않으면 off + unreadable', async () => {
    const t = setup()
    expect(await run(t, { eqpId: 'SEWT_CVD_OFF' })).toEqual({ outcome: 'off' })
    t.state.fresh.SEWT_CVD_A01 = [eqp('SEWT_CVD_A01', { onoff: '1' })]
    expect(await run(t)).toEqual({ outcome: 'off', detail: 'unreadable' })
    expect(t.of('send')).toHaveLength(0)
  })
  it('헤더에 실을 수 없는 값(빈칸으로 끝남·한글)은 badValue — 바꿔 보내지 않는다', async () => {
    const t = setup()
    t.state.fresh.SEWT_CVD_A01 = [eqp('SEWT_CVD_A01', { line: 'SEWLINE1 ' })]
    expect(await run(t)).toEqual({ outcome: 'badValue', detail: 'header' })
    t.state.fresh.SEWT_CVD_A01 = [eqp('SEWT_CVD_A01', { line: '라인1' })]
    expect(await run(t)).toEqual({ outcome: 'badValue', detail: 'header' })
    expect(t.of('send')).toHaveLength(0)
  })
  it('시작 지연·재시도가 있는 시나리오는 지연 키 규칙도 본다 — 없는 시나리오는 그대로 보낸다', async () => {
    const spaced = { SEWT_CVD_A01: [eqp('SEWT_CVD_A01', { line: 'SEW LINE' })] }
    expect(await run(setup({ fresh: spaced }))).toEqual({ outcome: 'accepted' })
    expect(await run(setup({ fresh: spaced, propertyDocs: [propDoc({ StartDelay: new Int32(30) })] }))).toEqual({ outcome: 'badValue', detail: 'delayKey' })
    expect(await run(setup({ fresh: spaced, propertyDocs: [propDoc({ RetryCnt: new Int32(1) })] }))).toEqual({ outcome: 'badValue', detail: 'delayKey' })
  })
  it('방금 요청한 설비·시나리오면 recent(누가·언제) — again 이면 보낸다', async () => {
    const recent = [{ eqpId: 'SEWT_CVD_A01', user: 'sew_master', sentAt: NOW - 180_000 }]
    const t = setup({ recent })
    expect(await run(t)).toEqual({ outcome: 'recent', detail: { by: 'sew_master', at: NOW - 180_000 } })
    expect(t.of('findRecentTestRuns')[0].args[0]).toEqual({ process: 'SEWCVD', model: 'SEWMODELA', name: 'RUN_A', since: NOW - 600_000, eqpIds: ['SEWT_CVD_A01'] })
    expect(t.of('send')).toHaveLength(0)
    expect(await run(setup({ recent }), { again: true })).toEqual({ outcome: 'accepted' })
  })
  it('같은 실행에서 같은 설비를 두 번 보내면 409 TEST_RUN_DUPLICATE — 보내지 않는다', async () => {
    const t = setup({ inserted: false })
    expect(await caught(run(t))).toMatchObject({ statusCode: 409, code: 'TEST_RUN_DUPLICATE' })
    expect(t.of('send')).toHaveLength(0)
  })
  it('InterfaceServer 의 답에 따라 failed(까닭)·unknown·down 으로 적고 돌려준다', async () => {
    const failed = setup({ received: { kind: 'response', status: 200, text: '{"result":"Fail","message":"invalid http headers"}' } })
    expect(await run(failed)).toEqual({ outcome: 'failed', detail: 'invalid http headers' })
    expect(failed.of('updateTestRun')[0].args[2]).toEqual({ state: 'failed', detail: 'invalid http headers', doneAt: NOW })
    const unknown = setup({ received: { kind: 'response', status: 200, text: '{"result":"Fail","message":"null"}' } })
    expect(await run(unknown)).toEqual({ outcome: 'unknown' })
    expect(unknown.of('updateTestRun')[0].args[2].state).toBe('unknown')
    const down = setup({ received: { kind: 'notSent', cause: 'ECONNREFUSED' } })
    expect(await run(down)).toEqual({ outcome: 'down' })
    expect(down.of('updateTestRun')[0].args[2].state).toBe('down')
  })
  it('자리: 같은 사용자가 요청 중이면 429(user), 서버 전체가 차 있으면 429(server) — 아무것도 적지 않고 보내지 않는다', async () => {
    let release
    const t = setup({ sendGate: new Promise((r) => { release = r }) })
    const first = run(t)
    await new Promise((r) => setTimeout(r, 10))
    const same = await caught(run(t, { eqpId: 'SEWT_CVD_OFF' }))
    expect(same).toMatchObject({ statusCode: 429, code: 'TEST_RUN_BUSY', details: { scope: 'user' } })
    const other = await caught(t.service.request({ ...USER, singleid: 'sew_master' }, REQ))
    expect(other).toMatchObject({ statusCode: 429, code: 'TEST_RUN_BUSY', details: { scope: 'server' } })
    expect(t.of('insertTestRun')).toHaveLength(1)
    expect(t.of('send')).toHaveLength(1)
    release()
    expect(await first).toEqual({ outcome: 'accepted' })
    t.state.sendGate = null
    expect(await run(t, { runId: 'run-22222222' })).toEqual({ outcome: 'accepted' }) // 자리가 풀렸다
  })
  it('보내기·읽기가 던져도 자리는 풀린다', async () => {
    const t = setup({ sendError: new Error('boom') })
    expect((await caught(run(t))).message).toBe('boom')
    t.state.sendError = null
    expect(await run(t, { runId: 'run-22222222' })).toEqual({ outcome: 'accepted' })
  })
  it('결과를 기록에 고치지 못해도 결과는 돌려준다(로그에 남긴다)', async () => {
    const t = setup({ updateError: new Error('web db down') })
    expect(await run(t)).toEqual({ outcome: 'accepted' })
    expect(t.lines.some((l) => l.includes('기록'))).toBe(true)
  })
  it('요청마다 로그 한 줄 — 직접 친 사유 글은 남기지 않는다', async () => {
    const t = setup()
    await run(t, { reason: { kind: 'other', text: '비밀스러운 사유' } })
    const line = t.lines.find((l) => l.includes('시나리오 실행 user='))
    expect(line).toContain('user=sew_multi')
    expect(line).toContain('run=run-12345678')
    expect(line).toContain('SEWCVD/SEWMODELA/RUN_A')
    expect(line).toContain('eqp=SEWT_CVD_A01')
    expect(line).toContain('reason=other')
    expect(line).toContain('accepted')
    expect(line).not.toContain('비밀스러운')
    const off = setup()
    await run(off, { eqpId: 'SEWT_CVD_OFF' })
    expect(off.lines.some((l) => l.includes('eqp=SEWT_CVD_OFF') && l.includes('off'))).toBe(true)
  })
})

describe('status — 내 실행의 요청 결과와 실행 상태', () => {
  const rec = (eqpId, over = {}) => ({
    runId: 'run-12345678', eqpId, process: 'SEWCVD', model: 'SEWMODELA', name: 'RUN_A', user: 'sew_multi', userInfo: '홍길동 - sew_multi', startStep: 2, userText: 'INSPECTION',
    state: 'accepted', detail: null, sentAt: NOW - 20_000, doneAt: NOW - 19_000, ...over
  })
  const doc = (eqpid, txn, over = {}) => ({
    eqpid, ears_code: 'RUN_A', trigger_by: 'SE', txn_seq: Long.fromNumber(txn), status: 'Wait', retry: '0/0/10', create_date: 'D',
    params: { '@UserInfo': '홍길동 - sew_multi', '@StartStep': '2', UserText: 'INSPECTION' }, ...over
  })
  const get = (t, body = { runId: 'run-12345678' }) => t.service.status(USER, body)

  it('기록마다 요청 결과와, 찾은 실행 기록의 상태를 준다 — 조회는 한 번', async () => {
    const t = setup({
      runs: [rec('SEWT_CVD_A01'), rec('SEWT_CVD_A02', { sentAt: NOW - 10_000, doneAt: NOW - 9_000 })],
      recoveries: [doc('SEWT_CVD_A01', NOW - 19_500, { status: 'StartScenario' }), doc('SEWT_CVD_A02', NOW - 9_500)]
    })
    const out = await get(t)
    expect(out.now).toBe(NOW)
    expect(out.items).toEqual([
      { eqpId: 'SEWT_CVD_A01', outcome: 'accepted', detail: null, sentAt: NOW - 20_000, found: 1, status: 'StartScenario', retry: '0/0/10', txnSeq: NOW - 19_500, createDate: 'D' },
      { eqpId: 'SEWT_CVD_A02', outcome: 'accepted', detail: null, sentAt: NOW - 10_000, found: 1, status: 'Wait', retry: '0/0/10', txnSeq: NOW - 9_500, createDate: 'D' }
    ])
    expect(t.of('findTestRuns')[0].args).toEqual(['run-12345678', 'sew_multi'])
    expect(t.of('findRecoveries')).toHaveLength(1)
    // 시각 창: 가장 이른 sentAt − 여유 ~ 가장 늦은 doneAt + 10분
    expect(t.of('findRecoveries')[0].args[0]).toEqual({ eqpIds: ['SEWT_CVD_A01', 'SEWT_CVD_A02'], from: NOW - 20_000 - 120_000, to: NOW - 9_000 + 600_000, name: 'RUN_A' })
  })
  it('기록이 아직 없으면 found 0 · 상태 null. 남의 문서(@UserInfo·시작 스텝이 다름)는 고르지 않는다', async () => {
    const t = setup({ runs: [rec('SEWT_CVD_A01')], recoveries: [doc('SEWT_CVD_A01', NOW - 19_000, { params: { '@UserInfo': '남 - other', '@StartStep': '2', UserText: 'INSPECTION' } })] })
    expect((await get(t)).items[0]).toMatchObject({ outcome: 'accepted', found: 0, status: null, txnSeq: null })
  })
  it('찾아 둔 줄(pinned)은 정확히 집고, 나머지만 범위로 찾는다', async () => {
    const t = setup({
      runs: [rec('SEWT_CVD_A01'), rec('SEWT_CVD_A02')],
      recoveries: [doc('SEWT_CVD_A01', NOW - 19_500, { status: 'Success' }), doc('SEWT_CVD_A02', NOW - 19_400)]
    })
    const out = await get(t, { runId: 'run-12345678', pinned: { SEWT_CVD_A01: NOW - 19_500 } })
    expect(t.of('findRecoveriesAt')[0].args[0]).toEqual([{ eqpId: 'SEWT_CVD_A01', txnSeq: NOW - 19_500, name: 'RUN_A' }])
    expect(t.of('findRecoveries')[0].args[0].eqpIds).toEqual(['SEWT_CVD_A02'])
    expect(out.items.map((i) => [i.eqpId, i.status, i.found])).toEqual([['SEWT_CVD_A01', 'Success', 1], ['SEWT_CVD_A02', 'Wait', 1]])
  })
  it('모두 집어 두었으면 범위 조회를 하지 않는다. 집은 문서가 사라졌으면 못 찾은 것으로', async () => {
    const t = setup({ runs: [rec('SEWT_CVD_A01')], recoveries: [] })
    const out = await get(t, { runId: 'run-12345678', pinned: { SEWT_CVD_A01: NOW - 19_500 } })
    expect(t.of('findRecoveries')).toHaveLength(0)
    expect(out.items[0]).toMatchObject({ found: 0, status: null })
  })
  it('같은 사람의 앞선 실행(rival)에 더 가까운 문서는 이 실행의 것으로 보지 않는다 — 방금 다시 실행했을 때 앞 실행의 끝 상태가 붙지 않는다', async () => {
    // 앞 실행이 60초 전에 같은 설비·시나리오·사유·시작 스텝으로 나갔고 그 문서는 NotStarted 로 끝났다. 새 실행의 문서는 아직 없다
    const t = setup({
      runs: [rec('SEWT_CVD_A01')],
      rivals: [rec('SEWT_CVD_A01', { runId: 'run-00000000', sentAt: NOW - 80_000 }), rec('SEWT_CVD_A01', { runId: 'run-00000001', sentAt: NOW - 80_000, startStep: 1 })],
      recoveries: [doc('SEWT_CVD_A01', NOW - 79_700, { status: 'NotStarted' })]
    })
    expect((await get(t)).items[0]).toMatchObject({ found: 0, status: null })
    expect(t.of('findRivalTestRuns')[0].args[0]).toEqual({ user: 'sew_multi', runId: 'run-12345678', process: 'SEWCVD', model: 'SEWMODELA', name: 'RUN_A', eqpIds: ['SEWT_CVD_A01'], since: NOW - 20_000 - 120_000 - 600_000 })
    // 새 실행의 문서가 생기면 그것을 고른다
    t.state.recoveries = [doc('SEWT_CVD_A01', NOW - 79_700, { status: 'NotStarted' }), doc('SEWT_CVD_A01', NOW - 19_600)]
    expect((await get(t)).items[0]).toMatchObject({ found: 1, status: 'Wait', txnSeq: NOW - 19_600 })
  })
  it('찾아 둔 줄(pinned)도 서버가 다시 가린다 — 남의 문서의 txn 을 줘도 집히지 않는다', async () => {
    const theirs = doc('SEWT_CVD_A01', NOW - 19_500, { status: 'Success', params: { '@UserInfo': '남 - other', '@StartStep': '2', UserText: 'INSPECTION' } })
    const t = setup({ runs: [rec('SEWT_CVD_A01')], recoveries: [theirs] })
    expect((await get(t, { runId: 'run-12345678', pinned: { SEWT_CVD_A01: NOW - 19_500 } })).items[0]).toMatchObject({ found: 0, status: null, txnSeq: null })
  })
  it('연결 못 함(down)으로 끝난 줄은 실행 기록을 묻지 않는다. 실패·모름은 묻는다', async () => {
    const t = setup({ runs: [rec('SEWT_CVD_A01', { state: 'down' }), rec('SEWT_CVD_A02', { state: 'unknown' }), rec('SEWT_CVD_OFF', { state: 'failed', detail: '까닭' })] })
    const out = await get(t)
    expect(t.of('findRecoveries')[0].args[0].eqpIds).toEqual(['SEWT_CVD_A02', 'SEWT_CVD_OFF'])
    expect(out.items.map((i) => [i.outcome, i.detail])).toEqual([['down', null], ['unknown', null], ['failed', '까닭']])
  })
  it('sending 으로 남은 기록: 60초 안이면 sending(보내는 중), 넘었으면 unknown(서버가 죽었다)', async () => {
    const t = setup({ runs: [rec('SEWT_CVD_A01', { state: 'sending', sentAt: NOW - 5_000, doneAt: null }), rec('SEWT_CVD_A02', { state: 'sending', sentAt: NOW - 61_000, doneAt: null })] })
    const out = await get(t)
    expect(out.items.map((i) => i.outcome)).toEqual(['sending', 'unknown'])
    // 끝나지 않은 줄의 창 끝은 지금 + 10분
    expect(t.of('findRecoveries')[0].args[0].to).toBe(NOW + 600_000)
  })
  it('여럿이 맞으면 가장 가까운 것과 건수', async () => {
    const t = setup({ runs: [rec('SEWT_CVD_A01')], recoveries: [doc('SEWT_CVD_A01', NOW - 5_000, { status: 'Success' }), doc('SEWT_CVD_A01', NOW - 19_800, { status: 'Failed' })] })
    expect((await get(t)).items[0]).toMatchObject({ found: 2, status: 'Failed', txnSeq: NOW - 19_800 })
  })
  it('내 기록이 없는 runId(남의 것 포함)는 404, runId·pinned 꼴이 틀리면 400', async () => {
    expect(await caught(get(setup({ runs: [] })))).toMatchObject({ statusCode: 404, code: 'NOT_FOUND' })
    expect(await caught(get(setup(), { runId: 'x' }))).toMatchObject({ statusCode: 400, code: 'BAD_REQUEST', details: { path: 'runId' } })
    expect(await caught(get(setup(), { runId: 'run-12345678', pinned: [1] }))).toMatchObject({ statusCode: 400, details: { path: 'pinned' } })
    expect(await caught(get(setup(), { runId: 'run-12345678', pinned: { A: 'x' } }))).toMatchObject({ statusCode: 400, details: { path: 'pinned' } })
    expect(await caught(get(setup(), null))).toMatchObject({ statusCode: 400 })
  })
  it('실행 기록을 읽지 못하면 503 TEST_RUN_STATUS_FAILED', async () => {
    const t = setup({ runs: [rec('SEWT_CVD_A01')], recoveryError: seError(504, 'UPSTREAM_TIMEOUT', 'EARS DB 응답이 늦습니다') })
    expect(await caught(get(t))).toMatchObject({ statusCode: 503, code: 'TEST_RUN_STATUS_FAILED' })
  })
  it('여유는 설정에서(SE_TEST_RUN_CLOCK_SKEW_SEC)', async () => {
    const t = setup({ runs: [rec('SEWT_CVD_A01')], env: { SE_TEST_RUN_CLOCK_SKEW_SEC: '300' } })
    await get(t)
    expect(t.of('findRecoveries')[0].args[0].from).toBe(NOW - 20_000 - 300_000)
  })
})

// 시험 실행의 순수 규칙(P5 설계 §5.2·§5.3·§5.4) — 입력 검사, params·헤더 값, 운영 속성(CommandServer 규칙), 응답 분류, 실행 기록 고르기
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { Long, Int32, Double } = require('bson')
const {
  OUTCOMES, REASON_KINDS, validateRequest, userTextOf, userInfoOf, buildParams, headerValueOk, delayKeyOk, readOnoff,
  readRunProperty, isInt64, classifyAction, pickRecovery
} = require('../../domain/testRun')

const REQ = { runId: 'run-12345678', process: 'SEWCVD', model: 'SEWMODELA', name: 'RUN_PROPS', eqpId: 'SEWT_CVD_A01', startStep: 1, reason: { kind: 'INSPECTION' } }
const pathOf = (over) => { const r = validateRequest({ ...REQ, ...over }); return r.ok ? null : r.path }

describe('값 목록', () => {
  it('설비 하나의 결과와 사유 종류', () => {
    expect(OUTCOMES).toEqual(['accepted', 'off', 'recent', 'forbidden', 'mismatch', 'badValue', 'failed', 'unknown', 'down'])
    expect(REASON_KINDS).toEqual(['INSPECTION', 'MAN_EXE', 'other'])
  })
})

describe('validateRequest', () => {
  it('바른 요청은 값을 정리해 준다 — again 은 없으면 거짓', () => {
    expect(validateRequest(REQ)).toEqual({ ok: true, value: { ...REQ, reason: { kind: 'INSPECTION' }, again: false } })
    expect(validateRequest({ ...REQ, again: true }).value.again).toBe(true)
  })
  it('기타 사유는 앞뒤 공백을 지운 글을 싣는다. 다른 종류의 글은 버린다', () => {
    expect(validateRequest({ ...REQ, reason: { kind: 'other', text: '  밸브 "A" 점검\\ ' } }).value.reason).toEqual({ kind: 'other', text: '밸브 "A" 점검\\' })
    expect(validateRequest({ ...REQ, reason: { kind: 'MAN_EXE', text: '쓰지 않는 글' } }).value.reason).toEqual({ kind: 'MAN_EXE' })
  })
  it('객체가 아니면 본문 전체가 틀렸다', () => {
    for (const b of [null, undefined, 'x', 1, []]) expect(validateRequest(b)).toEqual({ ok: false, path: '' })
  })
  it('공정·모델·이름·설비는 비지 않은 글자', () => {
    for (const k of ['process', 'model', 'name', 'eqpId']) {
      expect(pathOf({ [k]: '' })).toBe(k)
      expect(pathOf({ [k]: 3 })).toBe(k)
      expect(pathOf({ [k]: undefined })).toBe(k)
    }
  })
  it('runId 는 영숫자와 - 로 8~64자', () => {
    expect(pathOf({ runId: 'short' })).toBe('runId')
    expect(pathOf({ runId: 'a'.repeat(65) })).toBe('runId')
    expect(pathOf({ runId: 'run_12345678' })).toBe('runId')
    expect(pathOf({ runId: 12345678 })).toBe('runId')
    expect(pathOf({ runId: 'a'.repeat(64) })).toBeNull()
  })
  it('시작 스텝은 1 이상의 정수', () => {
    for (const v of [0, -1, 1.5, '1', null, NaN, Infinity]) expect(pathOf({ startStep: v })).toBe('startStep')
    expect(pathOf({ startStep: 200 })).toBeNull()
  })
  it('사유 종류는 셋 가운데 하나', () => {
    expect(pathOf({ reason: null })).toBe('reason')
    expect(pathOf({ reason: { kind: 'ETC' } })).toBe('reason.kind')
    expect(pathOf({ reason: {} })).toBe('reason.kind')
  })
  it('기타 사유의 글: 1~120자, ^ < > 와 제어 문자 금지, 공백만은 금지', () => {
    const t = (text) => pathOf({ reason: { kind: 'other', text } })
    expect(t(undefined)).toBe('reason.text')
    expect(t('')).toBe('reason.text')
    expect(t('   ')).toBe('reason.text')
    expect(t('가'.repeat(121))).toBe('reason.text')
    expect(t('가'.repeat(120))).toBeNull()
    for (const c of ['^', '<', '>', '\n', '\t', '\r', '\u0000', '\u007f']) expect(t(`a${c}b`)).toBe('reason.text')
    expect(t('"따옴표" 와 \\ 는 된다')).toBeNull()
  })
  it('again 은 불리언만', () => {
    expect(pathOf({ again: 'true' })).toBe('again')
    expect(pathOf({ again: 1 })).toBe('again')
  })
})

describe('사유·사용자·params', () => {
  it('사유 → UserText: 사내 값 그대로', () => {
    expect(userTextOf({ kind: 'INSPECTION' })).toBe('INSPECTION')
    expect(userTextOf({ kind: 'MAN_EXE' })).toBe('MAN_EXE')
    expect(userTextOf({ kind: 'other', text: '점검' })).toBe('점검')
  })
  it('@UserInfo = "{이름} - {SingleID}" (이름이 빈 사용자는 parseUser 가 SingleID 를 이름으로 준다)', () => {
    expect(userInfoOf({ name: '홍길동', singleid: 'sew_multi' })).toBe('홍길동 - sew_multi')
    expect(userInfoOf({ name: 'sew_none', singleid: 'sew_none' })).toBe('sew_none - sew_none')
  })
  it('params 는 JSON 직렬화이고 값은 모두 글자다 — 따옴표·역슬래시가 깨지지 않는다(SE-017). @Trigger 는 싣지 않는다', () => {
    const json = buildParams({ userInfo: '홍 - a', startStep: 3, userText: '밸브 "A" \\ 점검' })
    expect(JSON.parse(json)).toEqual({ '@UserInfo': '홍 - a', '@StartStep': '3', UserText: '밸브 "A" \\ 점검' })
    expect(Object.keys(JSON.parse(json))).toEqual(['@UserInfo', '@StartStep', 'UserText'])
  })
})

describe('헤더에 실을 값', () => {
  it('보이는 ASCII 만 — 비었거나 앞뒤 공백이 있거나 한글·제어 문자가 있으면 안 된다', () => {
    expect(headerValueOk('SEWT_CVD_A01')).toBe(true)
    expect(headerValueOk('LINE 1')).toBe(true)
    for (const v of ['', ' A', 'A ', '라인1', 'A\tB', 'A\nB', 'é', null, undefined, 1]) expect(headerValueOk(v)).toBe(false)
  })
  it('지연 키 규칙: 영숫자와 _ - . 만(DC-012)', () => {
    expect(delayKeyOk('SEW.LINE-1_a')).toBe(true)
    for (const v of ['LINE 1', 'A@B', 'A/B', '', '라인', null]) expect(delayKeyOk(v)).toBe(false)
  })
})

describe('readOnoff', () => {
  it('숫자 0 은 꺼짐, 그 밖의 수는 켜짐, 숫자가 아니면 읽을 수 없음', () => {
    expect(readOnoff(0)).toBe('off')
    expect(readOnoff(1)).toBe('on')
    expect(readOnoff(2)).toBe('on')
    for (const v of ['1', '0', null, undefined, true, NaN, {}]) expect(readOnoff(v)).toBe('unreadable')
  })
})

describe('readRunProperty — CommandServer 가 읽는 규칙(JsonDataFormat.getScenarioProperty_SimpleJSON)', () => {
  const DEFAULTS = { isEnabled: true, startDelay: 0, retryCnt: 0, retryInterval: 10, priority: 10, next: { success: null, fail: null }, emailSkip: { success: false, stop: false, fail: false } }
  const numbers = (n) => ({
    ID: 'P1', Owners: ['kim'], ScenarioTriggerType: n(1), DoNotSendEmailWhenSuccess: true, StartDelay: n(30), RetryCnt: n(2), RetryInterval: n(60),
    NextScenarioIfFail: { Name: 'SC_NG', Text: 'ng' }, IsEnabled: true, Priority: n(3)
  })
  const READ = { isEnabled: true, startDelay: 30, retryCnt: 2, retryInterval: 60, priority: 3, next: { success: null, fail: 'SC_NG' }, emailSkip: { success: true, stop: false, fail: false } }

  it('골든 "숫자가 Int64": 그대로 읽는다', () => {
    expect(readRunProperty(numbers((v) => Long.fromNumber(v)))).toEqual(READ)
  })
  it('골든 "숫자가 Int32": 그대로 읽는다', () => {
    expect(readRunProperty(numbers((v) => new Int32(v)))).toEqual(READ)
  })
  it('골든 "숫자가 Double": 숫자 칸이 모두 기본값이 된다', () => {
    expect(readRunProperty(numbers((v) => new Double(v)))).toEqual({ ...READ, startDelay: 0, retryCnt: 0, retryInterval: 10, priority: 10 })
  })
  it('빈 문서·문서가 아님은 모두 기본값', () => {
    expect(readRunProperty({})).toEqual(DEFAULTS)
    for (const v of [null, undefined, 'x', []]) expect(readRunProperty(v)).toEqual(DEFAULTS)
  })
  it('Int 범위 밖의 Int64·글자·불리언·null 은 기본값', () => {
    expect(readRunProperty({ StartDelay: Long.fromString('3000000000'), RetryCnt: '2', RetryInterval: true, Priority: null })).toEqual(DEFAULTS)
  })
  it('우선순위 0 이하는 10', () => {
    expect(readRunProperty({ Priority: new Int32(0) }).priority).toBe(10)
    expect(readRunProperty({ Priority: Long.fromNumber(-1) }).priority).toBe(10)
    expect(readRunProperty({ Priority: new Int32(1) }).priority).toBe(1)
  })
  it('불리언 칸은 BSON 불리언일 때만 — 글자 "false" 로 적힌 IsEnabled 는 켜짐으로 읽힌다', () => {
    const r = readRunProperty({ IsEnabled: 'false', DoNotSendEmailWhenSuccess: 'true', DoNotSendEmailWhenStop: new Int32(1), DoNotSendEmailWhenFail: true })
    expect(r.isEnabled).toBe(true)
    expect(r.emailSkip).toEqual({ success: false, stop: false, fail: true })
    expect(readRunProperty({ IsEnabled: false }).isEnabled).toBe(false)
  })
  it('후속 시나리오는 Name·Text 가 둘 다 글자일 때만', () => {
    expect(readRunProperty({ NextScenarioIfSuccess: { Name: 'SC_OK' } }).next.success).toBeNull()
    expect(readRunProperty({ NextScenarioIfSuccess: { Name: 'SC_OK', Text: '' } }).next.success).toBe('SC_OK')
    expect(readRunProperty({ NextScenarioIfSuccess: null, NextScenarioIfFail: 'SC' }).next).toEqual({ success: null, fail: null })
  })
  it('드라이버가 숫자로 올려 준 값: 정수는 Int32 로 보고 소수는 기본값', () => {
    expect(readRunProperty({ StartDelay: 30, RetryCnt: 1.5 })).toMatchObject({ startDelay: 30, retryCnt: 0 })
  })
  it('isInt64: Long 만', () => {
    expect(isInt64(Long.fromNumber(2))).toBe(true)
    for (const v of [new Int32(2), new Double(2), 2, '2', null, undefined]) expect(isInt64(v)).toBe(false)
  })
})

describe('classifyAction — InterfaceServer 가 준 것을 결과로', () => {
  const res = (status, text) => ({ kind: 'response', status, text })
  it('200 + Success → 요청 접수', () => {
    expect(classifyAction(res(200, '{"result":"Success","message":""}'))).toEqual({ outcome: 'accepted' })
  })
  it('200 + Fail + 까닭 → 실패(까닭은 300자까지)', () => {
    expect(classifyAction(res(200, '{"result":"Fail","message":"invalid http headers"}'))).toEqual({ outcome: 'failed', detail: 'invalid http headers' })
    expect(classifyAction(res(200, JSON.stringify({ result: 'Fail', message: 'x'.repeat(400) }))).detail).toHaveLength(300)
    expect(classifyAction(res(200, '{"result":"Fail","message":"exception: boom"}'))).toEqual({ outcome: 'failed', detail: 'exception: boom' })
  })
  it('200 + Fail + 까닭 없음("null"·빈 글·없음) → 접수 여부 모름', () => {
    for (const m of ['"null"', '""', '"  "', 'null']) expect(classifyAction(res(200, `{"result":"Fail","message":${m}}`))).toEqual({ outcome: 'unknown' })
    expect(classifyAction(res(200, '{"result":"Fail"}'))).toEqual({ outcome: 'unknown' })
  })
  it('200 인데 JSON 이 아니거나 result 가 없거나 모르는 값 → 모름', () => {
    for (const t of ['', 'ok', '[]', '{}', '{"result":"Maybe"}', '{"result":1}']) expect(classifyAction(res(200, t))).toEqual({ outcome: 'unknown' })
  })
  it('5xx → 모름(InterfaceServer 가 10초를 넘겨도 요청은 살아 있을 수 있다), 4xx → 실패, 3xx → 모름', () => {
    for (const s of [500, 502, 503, 504]) expect(classifyAction(res(s, 'x'))).toEqual({ outcome: 'unknown' })
    expect(classifyAction(res(404, 'nope'))).toEqual({ outcome: 'failed', detail: 'HTTP 404' })
    expect(classifyAction(res(302, ''))).toEqual({ outcome: 'unknown' })
  })
  it('보내지 못함 → 연결 못 함, 응답 없음 → 모름', () => {
    expect(classifyAction({ kind: 'notSent', cause: 'ECONNREFUSED' })).toEqual({ outcome: 'down' })
    expect(classifyAction({ kind: 'noResponse', cause: 'TimeoutError' })).toEqual({ outcome: 'unknown' })
    expect(classifyAction(null)).toEqual({ outcome: 'unknown' })
  })
  it('결과 값은 OUTCOMES 안에 있다', () => {
    for (const r of [res(200, '{"result":"Success"}'), res(200, '{"result":"Fail","message":"m"}'), res(500, ''), { kind: 'notSent' }]) expect(OUTCOMES).toContain(classifyAction(r).outcome)
  })
})

describe('pickRecovery — 내 요청의 실행 기록 고르기', () => {
  const REC = { eqpId: 'SEWT_CVD_A01', name: 'RUN_PROPS', userInfo: '홍 - sew_multi', startStep: 2, userText: 'INSPECTION', sentAt: 1_000_000 }
  const doc = (over = {}, params = {}) => ({
    eqpid: 'SEWT_CVD_A01', ears_code: 'RUN_PROPS', trigger_by: 'SE', txn_seq: Long.fromNumber(1_000_500), status: 'Wait', retry: '0/2/10', create_date: '2026-11-18T10:00:00.000+09:00',
    params: { '@UserInfo': '홍 - sew_multi', '@StartStep': '2', UserText: 'INSPECTION', ALTXT: 'RUN_PROPS', ALID: 'RUN_PROPS', '@Trigger': 'SE', __priority__: 3, ...params },
    ...over
  })
  const SKEW = 120_000

  it('맞는 문서를 찾아 상태·재시도·txn·등록 시각을 준다', () => {
    expect(pickRecovery([doc()], REC, SKEW)).toEqual({ found: 1, doc: { status: 'Wait', retry: '0/2/10', txnSeq: 1_000_500, createDate: '2026-11-18T10:00:00.000+09:00' } })
  })
  it('이름·설비·SE·@UserInfo·시작 스텝·사유가 다른 문서는 남의 것이다', () => {
    const others = [
      doc({ ears_code: 'OTHER' }), doc({ eqpid: 'SEWT_CVD_A02' }), doc({ trigger_by: 'Watcher' }),
      doc({}, { '@UserInfo': '김 - other' }), doc({}, { '@StartStep': '1' }), doc({}, { UserText: 'MAN_EXE' })
    ]
    expect(pickRecovery(others, REC, SKEW)).toEqual({ found: 0, doc: null })
  })
  it('params 가 없는 문서(상태 갱신이 만든 것)는 뺀다', () => {
    expect(pickRecovery([doc({ params: undefined }), doc({ params: null })], REC, SKEW)).toEqual({ found: 0, doc: null })
  })
  it('여유보다 이른 문서는 뺀다 — 여유 안이면 요청보다 이른 txn 도 받는다(시계 차이)', () => {
    expect(pickRecovery([doc({ txn_seq: Long.fromNumber(1_000_000 - SKEW - 1) })], REC, SKEW).found).toBe(0)
    expect(pickRecovery([doc({ txn_seq: Long.fromNumber(1_000_000 - SKEW) })], REC, SKEW).found).toBe(1)
  })
  it('여럿이면 요청 시각에 가장 가까운 것 + 건수', () => {
    const r = pickRecovery([doc({ txn_seq: 1_300_000, status: 'Success' }), doc({ txn_seq: Long.fromNumber(1_000_900), status: 'StartScenario' }), doc({ txn_seq: 999_000, status: 'Failed' })], REC, SKEW)
    expect(r.found).toBe(3)
    expect(r.doc).toMatchObject({ status: 'StartScenario', txnSeq: 1_000_900 })
  })
  it('txn_seq 를 수로 읽지 못하는 문서·문서가 아닌 것은 뺀다', () => {
    expect(pickRecovery([doc({ txn_seq: 'x' }), null, 3], REC, SKEW).found).toBe(0)
    expect(pickRecovery(undefined, REC, SKEW)).toEqual({ found: 0, doc: null })
  })
  it('상태·재시도·등록 시각이 글자가 아니면 null 로 준다', () => {
    expect(pickRecovery([doc({ status: 3, retry: undefined, create_date: null })], REC, SKEW).doc).toEqual({ status: null, retry: null, txnSeq: 1_000_500, createDate: null })
  })
})

describe('설정 읽기 — testRunFlags·testRunLimits', () => {
  const { testRunFlags, testRunLimits } = require('../../domain/testRun')
  const LOCAL = { MONGODB_URI: 'mongodb://localhost:27017/EARS', EARS_INTERFACE_URL: 'http://127.0.0.1:8080' }

  it('SE_TEST_RUN 은 "1" 일 때만 켜짐, 사용자 바꾸기는 SE_DEV_USER_OVERRIDE "1"', () => {
    expect(testRunFlags({ ...LOCAL, SE_TEST_RUN: '1', SE_DEV_USER_OVERRIDE: '1' })).toEqual({ enabled: true, devOverride: true, earsLoopback: true })
    for (const v of [undefined, '', '0', 'true', 'yes', ' 1']) expect(testRunFlags({ ...LOCAL, SE_TEST_RUN: v }).enabled).toBe(false)
    expect(testRunFlags({ ...LOCAL, SE_DEV_USER_OVERRIDE: '0' }).devOverride).toBe(false)
  })
  it('EARS 가 루프백인가: Mongo 의 모든 호스트와 InterfaceServer 주소의 호스트', () => {
    const lo = (env) => testRunFlags(env).earsLoopback
    expect(lo(LOCAL)).toBe(true)
    expect(lo({})).toBe(true) // 비어 있으면 연결 코드의 기본값(localhost)
    expect(lo({ MONGODB_URI: 'mongodb://user:p%40ss@127.0.0.1:27017,localhost:27018/EARS?replicaSet=rs', EARS_INTERFACE_URL: 'http://[::1]:8080' })).toBe(true)
    expect(lo({ ...LOCAL, MONGODB_URI: 'mongodb://10.1.2.3:27017/EARS' })).toBe(false)
    expect(lo({ ...LOCAL, MONGODB_URI: 'mongodb://localhost:27017,10.1.2.3:27017/EARS' })).toBe(false)
    expect(lo({ ...LOCAL, MONGODB_URI: 'mongodb+srv://cluster.example.com/EARS' })).toBe(false)
    expect(lo({ ...LOCAL, EARS_INTERFACE_URL: 'http://is.company.local:8080' })).toBe(false)
    expect(lo({ ...LOCAL, EARS_INTERFACE_URL: 'is.company.local:8080' })).toBe(false) // 해석하지 못하는 주소는 루프백이라고 믿지 않는다
    expect(lo({ ...LOCAL, MONGODB_URI: 'not-a-uri' })).toBe(false)
  })
  it('한도: 범위 밖·수가 아니면 기본값', () => {
    expect(testRunLimits({})).toEqual({ maxEquipment: 200, concurrency: 1, recentMin: 10, skewMs: 120000 })
    expect(testRunLimits({ SE_TEST_RUN_MAX_EQP: '50', SE_TEST_RUN_CONCURRENCY: '3', SE_TEST_RUN_RECENT_MIN: '5', SE_TEST_RUN_CLOCK_SKEW_SEC: '0' })).toEqual({ maxEquipment: 50, concurrency: 3, recentMin: 5, skewMs: 0 })
    expect(testRunLimits({ SE_TEST_RUN_MAX_EQP: '201', SE_TEST_RUN_CONCURRENCY: '6', SE_TEST_RUN_RECENT_MIN: '0', SE_TEST_RUN_CLOCK_SKEW_SEC: '3601' })).toEqual({ maxEquipment: 200, concurrency: 1, recentMin: 10, skewMs: 120000 })
    expect(testRunLimits({ SE_TEST_RUN_MAX_EQP: 'abc', SE_TEST_RUN_CONCURRENCY: '1.5', SE_TEST_RUN_RECENT_MIN: '', SE_TEST_RUN_CLOCK_SKEW_SEC: '-1' })).toEqual({ maxEquipment: 200, concurrency: 1, recentMin: 10, skewMs: 120000 })
  })
})

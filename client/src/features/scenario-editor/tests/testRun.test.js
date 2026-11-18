// 시험 실행 화면의 규칙(P5 설계 §4) — 입력 검사, 설비 고르기, [실행] 이 꺼지는 까닭, 결과 요약, 실행 상태 글·다시 읽기
import { describe, it, expect } from 'vitest'
import {
  REASON_KINDS, REASON_MAX, reasonError, stepError, searchTargets, selectableIds, clickSelect, toggleAll, hiddenCount, scenarioMark, openRelation,
  blockReason, SENT_OUTCOMES, summarize, shouldStop, keepAfterRun, isFinal, needsStatus, stateView, pollDelay, applyStatus, newRunId
} from '../editor/testRun'

const eqp = (eqpId, over = {}) => ({ eqpId, line: 'L1', ipAddr: '10.99.1.1', ipAddrL: '', onoff: 'on', ...over })
const LIST = [eqp('A01'), eqp('A02', { ipAddr: '10.99.2.7' }), eqp('A03', { onoff: 'off' }), eqp('B01', { ipAddrL: '192.168.0.9' }), eqp('B02', { onoff: 'unreadable' }), eqp('C01')]

describe('사유·시작 스텝', () => {
  it('사유 종류는 사내 값 셋', () => {
    expect(REASON_KINDS).toEqual(['INSPECTION', 'MAN_EXE', 'other'])
    expect(REASON_MAX).toBe(120)
  })
  it('정해진 사유는 글을 보지 않는다. 기타는 앞뒤 공백을 지운 뒤 1~120자, ^ < > 와 제어 문자 금지', () => {
    expect(reasonError('INSPECTION', '')).toBeNull()
    expect(reasonError('MAN_EXE', '<<<')).toBeNull()
    expect(reasonError('other', '')).toBe('EMPTY')
    expect(reasonError('other', '   ')).toBe('EMPTY')
    expect(reasonError('other', '가'.repeat(121))).toBe('TOO_LONG')
    expect(reasonError('other', ` ${'가'.repeat(120)} `)).toBeNull()
    for (const c of ['^', '<', '>', '\n', '\t']) expect(reasonError('other', `a${c}b`)).toBe('BAD_CHAR')
    expect(reasonError('other', '밸브 "A" \\ 점검')).toBeNull()
  })
  it('시작 스텝은 1 ~ 스텝 수의 정수 — 글자·소수·범위 밖을 가른다. 스텝 수를 모르면 1 이상만 본다', () => {
    expect(stepError('1', 6)).toBeNull()
    expect(stepError(' 6 ', 6)).toBeNull()
    expect(stepError('7', 6)).toBe('RANGE')
    expect(stepError('0', 6)).toBe('RANGE')
    for (const v of ['', 'abc', '1.5', '-1', '1e2']) expect(stepError(v, 6)).toBe('NOT_NUMBER')
    expect(stepError('99', null)).toBeNull()
    expect(stepError('0', null)).toBe('RANGE')
  })
})

describe('설비 찾기·고르기', () => {
  it('설비 ID·IP(바깥·안쪽)의 일부로 찾는다 — 대소문자를 가리지 않고, 비면 전부', () => {
    expect(searchTargets(LIST, '').map((e) => e.eqpId)).toEqual(['A01', 'A02', 'A03', 'B01', 'B02', 'C01'])
    expect(searchTargets(LIST, ' b0 ').map((e) => e.eqpId)).toEqual(['B01', 'B02'])
    expect(searchTargets(LIST, '2.7').map((e) => e.eqpId)).toEqual(['A02'])
    expect(searchTargets(LIST, '192.168').map((e) => e.eqpId)).toEqual(['B01'])
    expect(searchTargets(LIST, 'zzz')).toEqual([])
  })
  it('고를 수 있는 것은 자동조치가 켜진 설비뿐이다(OFF·읽을 수 없음은 못 고른다)', () => {
    expect(selectableIds(LIST)).toEqual(['A01', 'A02', 'B01', 'C01'])
  })
  const ids = selectableIds(LIST)
  it('줄을 누르면 그 줄 하나, Ctrl(⌘)·체크 칸은 더하고 빼기', () => {
    const one = clickSelect({ picked: new Set(['A01', 'C01']), anchor: 'A01' }, ids, 'A02', {})
    expect([[...one.picked], one.anchor]).toEqual([['A02'], 'A02'])
    const add = clickSelect({ picked: new Set(['A01']), anchor: 'A01' }, ids, 'B01', { toggle: true })
    expect([[...add.picked].sort(), add.anchor]).toEqual([['A01', 'B01'], 'B01'])
    const remove = clickSelect(add, ids, 'A01', { toggle: true })
    expect([...remove.picked]).toEqual(['B01'])
  })
  it('Shift 는 기준 줄부터 그 줄까지를 더한다 — 사이의 고를 수 없는 줄은 건너뛴다. 기준 줄이 보이지 않으면 그 줄 하나를 더한다', () => {
    const range = clickSelect({ picked: new Set(['A01']), anchor: 'A01' }, ids, 'C01', { range: true })
    expect([...range.picked].sort()).toEqual(['A01', 'A02', 'B01', 'C01'])
    expect(range.anchor).toBe('A01')
    const back = clickSelect({ picked: new Set(['C01']), anchor: 'C01' }, ids, 'A02', { range: true })
    expect([...back.picked].sort()).toEqual(['A02', 'B01', 'C01'])
    const lost = clickSelect({ picked: new Set(['Z99']), anchor: 'Z99' }, ids, 'A02', { range: true })
    expect([[...lost.picked].sort(), lost.anchor]).toEqual([['A02', 'Z99'], 'A02'])
  })
  it('고를 수 없는 줄을 누르면 그대로다', () => {
    const before = { picked: new Set(['A01']), anchor: 'A01' }
    expect(clickSelect(before, ids, 'A03', {})).toBe(before)
  })
  it('머리 칸: 보이는 줄 가운데 고를 수 있는 것 모두를 더하거나 뺀다 — 가려진 줄의 선택은 남는다', () => {
    const shown = selectableIds(searchTargets(LIST, 'a0'))
    expect([...toggleAll(new Set(['C01']), shown, true)].sort()).toEqual(['A01', 'A02', 'C01'])
    expect([...toggleAll(new Set(['A01', 'A02', 'C01']), shown, false)]).toEqual(['C01'])
    expect(hiddenCount(new Set(['A01', 'C01']), searchTargets(LIST, 'a0'))).toBe(1)
  })
})

describe('시나리오 항목의 표시와 편집기에 연 시나리오', () => {
  it('꺼짐 → 현재 판 없음 → 확인 필요 순으로 하나', () => {
    expect(scenarioMark({ isEnabled: true, status: [] })).toBeNull()
    expect(scenarioMark({ isEnabled: false, status: ['NO_CURRENT_VERSION'] })).toBe('off')
    expect(scenarioMark({ isEnabled: true, status: ['NO_CURRENT_VERSION', 'DUPLICATE_PROPERTY'] })).toBe('noVersion')
    expect(scenarioMark({ isEnabled: true, status: ['DUPLICATE_PROPERTY'] })).toBe('check')
    expect(scenarioMark({ isEnabled: null, status: ['PARSE_FAILED'] })).toBe('check')
  })
  const SEL = { process: 'P', model: 'M', name: 'N' }
  it('고른 시나리오가 편집기에 연 그것일 때만 관계가 있다', () => {
    expect(openRelation(SEL, null)).toBe('none')
    expect(openRelation(SEL, { process: 'P', model: 'M', name: 'OTHER', unsaved: 3, current: true })).toBe('none')
    expect(openRelation({ ...SEL, name: '' }, { process: 'P', model: 'M', name: '', unsaved: 0, current: true })).toBe('none')
    expect(openRelation(SEL, { ...SEL, unsaved: 0, current: true })).toBe('same')
    expect(openRelation(SEL, { ...SEL, unsaved: 2, current: true })).toBe('dirty')
    expect(openRelation(SEL, { ...SEL, unsaved: 0, current: false })).toBe('old')
    expect(openRelation(SEL, { ...SEL, unsaved: 2, current: false })).toBe('dirty')
  })
})

describe('[실행] 이 꺼지는 까닭', () => {
  const OK = { name: 'N', loading: false, info: { blocks: [], current: { stepCount: 6 } }, picked: 2, max: 200, reasonErr: null, stepErr: null }
  const why = (over) => blockReason({ ...OK, ...over })
  it('다 맞으면 null', () => {
    expect(why({})).toBeNull()
  })
  it('순서: 시나리오를 고르지 않음 → 읽는 중 → 시나리오가 막힘 → 설비 없음 → 한도 초과 → 사유 → 시작 스텝', () => {
    expect(why({ name: '', loading: true, picked: 0 })).toEqual({ key: 'SEW_RUN_WHY_NO_SCENARIO' })
    expect(why({ loading: true, picked: 0 })).toEqual({ key: 'SEW_RUN_WHY_LOADING' })
    expect(why({ info: null })).toEqual({ key: 'SEW_RUN_WHY_LOADING' })
    expect(why({ info: null, infoFailed: true })).toEqual({ key: 'SEW_RUN_WHY_INFO_FAILED' })
    expect(why({ info: { blocks: ['TEST_RUN_SCENARIO_OFF', 'TEST_RUN_NAME'], current: null }, picked: 0 })).toEqual({ key: 'SEW_ERR_TEST_RUN_SCENARIO_OFF' })
    expect(why({ picked: 0, reasonErr: 'EMPTY' })).toEqual({ key: 'SEW_RUN_WHY_NO_EQP' })
    expect(why({ picked: 201 })).toEqual({ key: 'SEW_RUN_WHY_LIMIT', params: { max: 200 } })
    expect(why({ reasonErr: 'TOO_LONG', stepErr: 'RANGE' })).toEqual({ key: 'SEW_RUN_REASON_TOO_LONG' })
    expect(why({ stepErr: 'RANGE' })).toEqual({ key: 'SEW_RUN_STEP_RANGE', params: { max: 6 } })
    expect(why({ stepErr: 'NOT_NUMBER' })).toEqual({ key: 'SEW_RUN_STEP_NOT_NUMBER', params: { max: 6 } })
  })
})

describe('결과', () => {
  const it0 = (eqpId, outcome, over = {}) => ({ eqpId, outcome, ...over })
  it('요약: 요청 접수 · 보내지 않음(OFF·방금·보낼 수 없음·연결 못 함·건너뜀) · 실패 · 모름', () => {
    const items = [it0('a', 'accepted'), it0('b', 'off'), it0('c', 'recent'), it0('d', 'forbidden'), it0('e', 'mismatch'), it0('f', 'badValue'),
      it0('g', 'failed'), it0('h', 'unknown'), it0('i', 'down'), it0('j', 'skipped'), it0('k', 'waiting'), it0('l', 'sending')]
    expect(summarize(items)).toEqual({ total: 12, done: 10, accepted: 1, notSent: 7, failed: 1, unknown: 1, skipped: 1 })
  })
  it('보냈거나 보냈을 수 있는 결과', () => {
    expect(SENT_OUTCOMES).toEqual(['accepted', 'unknown'])
  })
  it('접수 여부 모름·연결 못 함이 연달아 세 번이면 멈춘다 — 사이에 다른 결과가 끼면 다시 센다', () => {
    const seq = (...o) => o.map((x, i) => it0(`e${i}`, x))
    expect(shouldStop(seq('unknown', 'down', 'unknown'))).toBe(true)
    expect(shouldStop(seq('accepted', 'unknown', 'unknown', 'down'))).toBe(true)
    expect(shouldStop(seq('unknown', 'unknown', 'accepted'))).toBe(false)
    expect(shouldStop(seq('unknown', 'unknown', 'off', 'unknown'))).toBe(false)
    expect(shouldStop(seq('unknown', 'down'))).toBe(false)
    // 아직 보내지 않은 줄은 세지 않는다
    expect(shouldStop(seq('down', 'down', 'down', 'waiting', 'waiting'))).toBe(true)
  })
  it('다시 고르기: 요청 접수·모름이었던 설비의 선택을 푼다 — 보내지 않았거나 실패한 설비만 남는다', () => {
    const items = [it0('a', 'accepted'), it0('b', 'unknown'), it0('c', 'failed'), it0('d', 'off'), it0('e', 'skipped'), it0('f', 'down')]
    expect([...keepAfterRun(new Set(['a', 'b', 'c', 'd', 'e', 'f', 'x']), items)].sort()).toEqual(['c', 'd', 'e', 'f', 'x'])
  })
  it('실행 번호는 서버가 받는 꼴(영숫자와 - 8~64자)이고 부를 때마다 다르다', () => {
    const a = newRunId()
    expect(a).toMatch(/^[A-Za-z0-9-]{8,64}$/)
    expect(newRunId()).not.toBe(a)
  })
})

describe('실행 상태', () => {
  const NOW = 1_000_000_000
  const item = (over = {}) => ({ eqpId: 'A01', outcome: 'accepted', sentAt: NOW - 5_000, found: 0, status: null, retry: null, txnSeq: null, createDate: null, ...over })
  const view = (over, ctx = {}) => stateView(item(over), { now: NOW, startDelay: 0, ...ctx })

  it('보내지 않은 줄은 실행 상태가 없다', () => {
    for (const outcome of ['off', 'recent', 'forbidden', 'mismatch', 'badValue', 'down', 'skipped', 'waiting']) {
      expect(stateView(item({ outcome }), { now: NOW, startDelay: 0 })).toBeNull()
      expect(needsStatus(item({ outcome }), NOW)).toBe(false)
    }
  })
  it('아직 기록이 없을 때: 20초까지 "등록 확인 중", 그 뒤 10분까지 "아직 기록 없음", 10분 뒤 "기록 없음"(끝)', () => {
    expect(view({ sentAt: NOW - 19_000 })).toMatchObject({ key: 'SEW_RUN_STATE_CHECKING', final: false })
    expect(view({ sentAt: NOW - 21_000 })).toMatchObject({ key: 'SEW_RUN_STATE_NOT_YET', final: false })
    expect(view({ sentAt: NOW - 601_000 })).toMatchObject({ key: 'SEW_RUN_STATE_NONE_ACCEPTED', final: true, tone: 'bad' })
    // 접수되지 않았을 수 있는 줄(실패·모름)은 문구가 다르다
    expect(view({ outcome: 'unknown', sentAt: NOW - 601_000 })).toMatchObject({ key: 'SEW_RUN_STATE_NONE_UNSENT', final: true })
    expect(view({ outcome: 'failed', sentAt: NOW - 601_000 })).toMatchObject({ key: 'SEW_RUN_STATE_NONE_UNSENT', final: true })
  })
  it('Wait: 시작 지연이 있으면 "시작 대기(n초 지연)", 지연 + 30초가 지나도 그대로면 "시작되지 않고 있습니다"', () => {
    const wait = { found: 1, status: 'Wait', txnSeq: NOW - 5_000 }
    expect(view(wait)).toMatchObject({ key: 'SEW_RUN_STATE_WAIT', final: false })
    expect(view(wait, { startDelay: 30 })).toMatchObject({ key: 'SEW_RUN_STATE_WAIT_DELAY', params: { n: 30 }, final: false })
    expect(view({ ...wait, txnSeq: NOW - 31_000 })).toMatchObject({ key: 'SEW_RUN_STATE_WAIT_STUCK', final: false, tone: 'warn' })
    expect(view({ ...wait, txnSeq: NOW - 59_000 }, { startDelay: 30 })).toMatchObject({ key: 'SEW_RUN_STATE_WAIT_DELAY' })
    expect(view({ ...wait, txnSeq: NOW - 61_000 }, { startDelay: 30 })).toMatchObject({ key: 'SEW_RUN_STATE_WAIT_STUCK' })
  })
  it('진행 중인 상태들은 끝 상태가 아니다 — Duplicated 도(나중에 실행될 수 있다)', () => {
    for (const [status, key] of [['StartPending', 'SEW_RUN_STATE_SENT'], ['StartScenario', 'SEW_RUN_STATE_RUNNING'], ['Duplicated', 'SEW_RUN_STATE_DUPLICATED']]) {
      expect(view({ found: 1, status })).toMatchObject({ key, final: false })
    }
    expect(view({ found: 1, status: 'Retry', retry: '1/2/10' })).toMatchObject({ key: 'SEW_RUN_STATE_RETRY', params: { n: '1', m: '2' }, final: false })
  })
  it('끝 상태: 성공·중지·실패 셋·실행되지 않음·시작 못 함·설치 안 됨·Skip·Unknown', () => {
    expect(view({ found: 1, status: 'Success' })).toMatchObject({ key: 'SEW_RUN_STATE_SUCCESS', final: true, tone: 'ok' })
    expect(view({ found: 1, status: 'Stopped' })).toMatchObject({ key: 'SEW_RUN_STATE_STOPPED', final: true })
    for (const s of ['Failed', 'ScriptFailed', 'VisionDelayed']) expect(view({ found: 1, status: s })).toMatchObject({ key: `SEW_RUN_STATE_${s.toUpperCase()}`, final: true, tone: 'bad' })
    expect(view({ found: 1, status: 'TimeOut' })).toMatchObject({ key: 'SEW_RUN_STATE_TIMEOUT', final: true, tone: 'bad' })
    expect(view({ found: 1, status: 'NotStarted' })).toMatchObject({ key: 'SEW_RUN_STATE_NOTSTARTED', final: true, tone: 'bad' })
    expect(view({ found: 1, status: 'DenyScenario' })).toMatchObject({ key: 'SEW_RUN_STATE_DENY', final: true, tone: 'bad' })
    for (const s of ['Skip', 'Unknown']) expect(view({ found: 1, status: s })).toMatchObject({ key: 'SEW_RUN_STATE_OTHER', params: { status: s }, final: true })
    // 모르는 값은 그대로 보이되 끝이라고 단정하지 않는다
    expect(view({ found: 1, status: 'Brand-New' })).toMatchObject({ key: 'SEW_RUN_STATE_OTHER', params: { status: 'Brand-New' }, final: false })
  })
  it('여럿이 맞았으면 후보 수를 함께 준다', () => {
    expect(view({ found: 3, status: 'Success' }).candidates).toBe(3)
    expect(view({ found: 1, status: 'Success' }).candidates).toBe(0)
  })
  it('isFinal·needsStatus: 끝 상태가 아닌, 보냈거나 보냈을 수 있는 줄만 다시 묻는다', () => {
    expect(needsStatus(item(), NOW)).toBe(true)
    expect(needsStatus(item({ outcome: 'failed' }), NOW)).toBe(true)
    expect(needsStatus(item({ outcome: 'unknown' }), NOW)).toBe(true)
    expect(needsStatus(item({ found: 1, status: 'Success' }), NOW)).toBe(false)
    expect(needsStatus(item({ sentAt: NOW - 700_000 }), NOW)).toBe(false)
    expect(isFinal(item({ found: 1, status: 'StartScenario' }), NOW)).toBe(false)
  })
  it('다시 읽을 간격: 마지막 요청 뒤 1분은 5초, 그 뒤 10초, 15분에서 멈춘다', () => {
    expect(pollDelay(0)).toBe(5000)
    expect(pollDelay(59_000)).toBe(5000)
    expect(pollDelay(60_000)).toBe(10000)
    expect(pollDelay(899_000)).toBe(10000)
    expect(pollDelay(900_000)).toBeNull()
  })
  it('서버의 답을 줄에 덮는다 — 응답을 놓친 줄의 결과를 고치고(sending 은 그대로 모름), 끝난 줄·답에 없는 줄은 그대로', () => {
    const items = [
      { eqpId: 'A01', outcome: 'unknown', lost: true }, { eqpId: 'A02', outcome: 'accepted', found: 0, status: null },
      { eqpId: 'A03', outcome: 'off' }, { eqpId: 'A04', outcome: 'unknown', lost: true }
    ]
    const out = applyStatus(items, [
      { eqpId: 'A01', outcome: 'accepted', detail: null, sentAt: 5, found: 1, status: 'Wait', retry: '0/0/10', txnSeq: 7, createDate: 'D' },
      { eqpId: 'A02', outcome: 'accepted', detail: null, sentAt: 6, found: 1, status: 'Success', retry: '0/0/10', txnSeq: 8, createDate: 'E' },
      { eqpId: 'A04', outcome: 'sending', detail: null, sentAt: 9, found: 0, status: null, retry: null, txnSeq: null, createDate: null }
    ])
    expect(out[0]).toEqual({ eqpId: 'A01', outcome: 'accepted', lost: false, detail: null, sentAt: 5, found: 1, status: 'Wait', retry: '0/0/10', txnSeq: 7, createDate: 'D' })
    expect(out[1]).toMatchObject({ outcome: 'accepted', status: 'Success', txnSeq: 8 })
    expect(out[2]).toBe(items[2])
    expect(out[3]).toMatchObject({ outcome: 'unknown', lost: true, sentAt: 9 })
    expect(out).not.toBe(items)
  })
})

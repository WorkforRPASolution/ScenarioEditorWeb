import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { t, errorCode, errorMessage, noteMessage, fieldMessage, MESSAGES } from '../messages'

// 서버가 PARSE_FAILED 에 싣는 field 전부(server/features/scenario-editor/domain — skeleton·conditionCodec).
const PARSE_FAILED_FIELDS = ['body', 'steps', 'bi', 'property', 'step', 'metadata', 'script', 'trainImage', 'imageMulti', 'ocrMulti', 'eqpState',
  'TextValue', 'ConditionExpression', 'click', 'wheel', 'keyboard', 'wait', 'fap', 'native', 'findWindow', 'customScript']
// 서버 domain 소스에서 field 이름을 읽는다 — 서버가 새 field 를 내면 여기서 문구 누락이 드러난다.
function serverParseFailedFields() {
  const dir = join(__dirname, '../../../../../server/features/scenario-editor/domain')
  const found = new Set()
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.js'))) {
    const src = readFileSync(join(dir, f), 'utf8')
    for (const re of [/'PARSE_FAILED',\s*\{\s*field:\s*'(\w+)'/g, /stringField\([^)]*?,\s*'(\w+)',\s*notes\)/g, /\bfail\('(\w+)'\)/g]) {
      for (const m of src.matchAll(re)) found.add(m[1])
    }
  }
  return [...found].sort()
}

// 서버가 내는 오류 code 전부(seError·쓰기 문의 거절 denial·Host/출처 거절·InterfaceServer 실패) — 서버 소스에서 읽는다.
// 서버가 새 code 를 내면 여기서 문구 누락이 드러난다(화면에 [SEW_ERR_…] 키가 보이지 않게).
function serverErrorCodes() {
  const root = join(__dirname, '../../../../../server')
  const files = [join(root, 'localGuard.js')]
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) { if (e.name !== '__tests__' && e.name !== 'node_modules') walk(join(d, e.name)) } else if (e.name.endsWith('.js')) files.push(join(d, e.name))
    }
  }
  walk(join(root, 'features/scenario-editor'))
  const found = new Set()
  for (const f of files) {
    const src = readFileSync(f, 'utf8')
    // block(…) = 시험 실행 서비스가 시나리오를 막는 까닭(뒤에 seError 로 던진다)
    for (const re of [/seError\(\s*\d+,\s*'([A-Z_]+)'/g, /denial\('([A-Z_]+)'/g, /reject\(req, res, '([A-Z_]+)'/g, /failure\(fn, \d+, '([A-Z_]+)'/g, /\bblock\(\d+, '([A-Z_]+)'/g]) {
      for (const m of src.matchAll(re)) found.add(m[1])
    }
  }
  return [...found].sort()
}

const NOTE_CODES = ['CONDITION_UNKNOWN', 'ACTION_INVALID', 'OCR_OP_NONE', 'PARSE_FAILED', 'NEXT_OUT_OF_RANGE', 'NEXT_SELF', 'LAST_STEP_NEXT',
  'FALSE_NEXT_WITH_ACTION', 'VALUE_EMPTY', 'OCR_WITH_MOUSE_CLICK', 'NONE_WITH_MOUSE_CLICK', 'UNREACHABLE', 'NO_SUCCESS', 'ACTION_NOT_IN_COMBO', 'EQPSTATE_SKIP_PREPROCESSING',
  'BASE_IMAGE_MISSING', 'KEY_CODE_UNKNOWN', 'PRIORITY_NONSTANDARD', 'TARGET_WINDOW_DIFFERS', 'HIDING_WINDOW_NOT_FOUND', 'HIDING_WINDOW_SPACE', 'HIDING_WINDOW_FIXED_SIZE']
const ERROR_CODES = ['USER_NOT_REGISTERED', 'PROCESS_FORBIDDEN', 'MASTER_REQUIRED', 'HOST_FORBIDDEN', 'ORIGIN_FORBIDDEN', 'FILE_DAMAGED', 'NOT_FOUND', 'DATA_INVALID', 'UPSTREAM_DOWN', 'UPSTREAM_TIMEOUT', 'UPSTREAM_FAILED', 'BAD_REQUEST', 'NETWORK', 'TIMEOUT', 'UNKNOWN']

import { FILTERS } from '../editor/snapshotList'
import { stateView } from '../editor/testRun'
describe('messages', () => {
  it('경고·알림 코드 22개 모두 문구가 있다', () => {
    for (const c of NOTE_CODES) expect(noteMessage({ code: c, params: {} })).not.toMatch(/^\[/)
  })
  it('PARSE_FAILED 는 field 별 문구를 먼저 찾고, 없으면 공통 문구', () => {
    const generic = MESSAGES.SEW_NOTE_PARSE_FAILED
    for (const field of PARSE_FAILED_FIELDS) {
      const key = `SEW_NOTE_PARSE_FAILED_${field}`
      expect(MESSAGES[key], key).toBeTruthy()
      expect(noteMessage({ level: 'warning', code: 'PARSE_FAILED', params: { field } })).toBe(MESSAGES[key])
      expect(MESSAGES[key]).not.toBe(generic)
    }
    expect(noteMessage({ level: 'warning', code: 'PARSE_FAILED', params: { field: 'somethingNew' } })).toBe(generic)
    expect(noteMessage({ level: 'warning', code: 'PARSE_FAILED', params: {} })).toBe(generic)
    expect(noteMessage({ level: 'warning', code: 'PARSE_FAILED' })).toBe(generic)
    expect(noteMessage({ level: 'warning', code: 'PARSE_FAILED', params: { field: 'bi' } })).toContain('기준 화면')
  })
  it('서버가 내는 PARSE_FAILED field 가 모두 위 목록(=문구)에 있다', () => {
    const fromServer = serverParseFailedFields()
    expect(fromServer.length).toBeGreaterThan(10)
    expect(fromServer).toEqual([...PARSE_FAILED_FIELDS].sort())
  })
  it('오류 코드 모두 문구가 있다', () => {
    for (const c of ERROR_CODES) expect(errorMessage({ response: { data: { code: c } } })).not.toMatch(/^\[/)
  })
  it('서버가 내는 오류 code 모두 제 문구가 있다(서버 소스에서 읽음) — 공통 "알 수 없는 오류" 로 떨어지지 않는다', () => {
    const codes = serverErrorCodes()
    expect(codes).toEqual(expect.arrayContaining(['PAYLOAD_TOO_LARGE', 'WRITE_FORBIDDEN', 'WRITE_DISABLED', 'GRADE_FORBIDDEN', 'SAVE_CONFLICT', 'SAVE_IN_PROGRESS', 'TARGET_EXISTS', 'VALIDATION_FAILED', 'HOST_FORBIDDEN', 'UPSTREAM_FAILED']))
    for (const c of codes) {
      const m = errorMessage({ response: { status: 400, data: { code: c } } })
      expect(m, c).not.toMatch(/^\[/)
      expect(m, c).not.toBe(MESSAGES.SEW_ERR_UNKNOWN)
    }
  })
  it('시험 실행(P5): 서버 code 와 설비 하나의 결과(OUTCOMES)·화면의 결과 셋에 모두 문구가 있다', () => {
    const codes = serverErrorCodes()
    expect(codes).toEqual(expect.arrayContaining(['TEST_RUN_DISABLED', 'TEST_RUN_DEV_USER', 'TEST_RUN_USER_AMBIGUOUS', 'TEST_RUN_PROPERTY', 'TEST_RUN_NAME', 'TEST_RUN_SCENARIO_OFF',
      'TEST_RUN_NOT_DEPLOYED', 'TEST_RUN_VERSION_UNREADABLE', 'TEST_RUN_START_STEP', 'TEST_RUN_LIMIT', 'TEST_RUN_DUPLICATE', 'TEST_RUN_BUSY', 'TEST_RUN_STATUS_FAILED', 'TEST_RUN_SLOW']))
    // 200 응답 안의 outcome 은 위 시험이 보지 못한다 — 서버의 값 목록을 소스에서 읽어 견준다
    const src = readFileSync(join(__dirname, '../../../../../server/features/scenario-editor/domain/testRun.js'), 'utf8')
    const outcomes = /const OUTCOMES = \[([^\]]+)\]/.exec(src)[1].split(',').map((x) => x.trim().replace(/'/g, ''))
    expect(outcomes).toHaveLength(9)
    for (const o of [...outcomes, 'waiting', 'sending', 'skipped']) expect(MESSAGES[`SEW_RUN_OUTCOME_${o}`], o).toBeTruthy()
    // 버튼이 꺼진 까닭(/me 의 testRun.reason)
    for (const r of ['TEST_RUN_DISABLED', 'TEST_RUN_DEV_USER', 'TEST_RUN_USER_AMBIGUOUS', 'WRITE_DISABLED', 'WRITE_FORBIDDEN']) expect(MESSAGES[`SEW_RUN_OFF_${r}`], r).toBeTruthy()
    // 실행 상태 글·[실행] 이 꺼지는 까닭 — 키를 조립해 쓰므로 여기서 모두 확인한다
    const now = 1_000_000
    const states = [null, 'Wait', 'StartPending', 'StartScenario', 'Duplicated', 'Retry', 'Success', 'Stopped', 'Failed', 'ScriptFailed', 'VisionDelayed', 'TimeOut', 'NotStarted', 'DenyScenario', 'Skip', 'Whatever']
    const views = states.flatMap((status) => [5_000, 30_000, 700_000].flatMap((age) => ['accepted', 'unknown'].map((outcome) =>
      stateView({ outcome, sentAt: now - age, txnSeq: now - age, found: status ? 1 : 0, status, retry: '1/2/10' }, { now, startDelay: status === 'Wait' && age === 5_000 ? 30 : 0 }))))
    for (const v of views) expect(MESSAGES[v.key], v.key).toBeTruthy()
    expect(new Set(views.map((v) => v.key)).size).toBeGreaterThanOrEqual(19)
    for (const e of ['EMPTY', 'TOO_LONG', 'BAD_CHAR']) expect(MESSAGES[`SEW_RUN_REASON_${e}`], e).toBeTruthy()
    for (const e of ['NOT_NUMBER', 'RANGE']) expect(MESSAGES[`SEW_RUN_STEP_${e}`], e).toBeTruthy()
    for (const m of ['off', 'noVersion', 'check']) expect(MESSAGES[`SEW_RUN_MARK_${m}`], m).toBeTruthy()
    for (const p of ['EMPTY_RULE', 'NO_CATEGORY', 'INFO_MISSING', 'INFO_MANY']) expect(MESSAGES[`SEW_RUN_MAIL_PROBLEM_${p}`], p).toBeTruthy()
    // 사유 종류
    const kinds = /const REASON_KINDS = \[([^\]]+)\]/.exec(src)[1].split(',').map((x) => x.trim().replace(/'/g, ''))
    for (const k of kinds) expect(MESSAGES[`SEW_RUN_REASON_KIND_${k}`], k).toBeTruthy()
  })
  it('문구가 없는 code 도 키를 드러내지 않고 공통 문구, 코드 없는 413(JSON 본문 한도)은 PAYLOAD_TOO_LARGE', () => {
    expect(errorMessage({ response: { status: 409, data: { code: 'SOMETHING_NEW' } } })).toBe(MESSAGES.SEW_ERR_UNKNOWN)
    expect(errorCode({ response: { status: 413, data: { error: 'request entity too large' } } })).toBe('PAYLOAD_TOO_LARGE')
    expect(errorMessage({ response: { status: 413, data: {} } })).toBe(MESSAGES.SEW_ERR_PAYLOAD_TOO_LARGE)
  })
  it('미등록 사용자는 사내 키 Exception12', () => {
    expect(MESSAGES.Exception12).toBeTruthy()
    expect(errorMessage({ response: { status: 403, data: { code: 'USER_NOT_REGISTERED' } } })).toBe(MESSAGES.Exception12)
  })
  it('axios 시간 초과·연결 실패', () => {
    expect(errorCode({ code: 'ECONNABORTED' })).toBe('TIMEOUT')
    expect(errorCode({ request: {} })).toBe('NETWORK')
    expect(errorCode(new Error('x'))).toBe('UNKNOWN')
  })
  it('자리표시자를 채운다 — 경과 시간', () => {
    expect(t('SEW_UI_OPENING_ELAPSED', { s: 3 })).toBe('3초')
    expect(MESSAGES.SEW_UI_GUTTER_HINT).toBeTruthy()
  })
  it('없는 키는 [키] 로 드러난다', () => {
    expect(t('NOPE')).toBe('[NOPE]')
  })
  it('문구에 BI 라는 말이 없다', () => {
    for (const v of Object.values(MESSAGES)) expect(v).not.toMatch(/\bBI\b/)
  })
  it('서버 검사 코드(RULES)와 성과 코드 모두 칸 문구 RULE_<code> 가 있다', () => {
    const dir = join(__dirname, '../../../../../server/features/scenario-editor/domain/rules')
    const codesSrc = readFileSync(join(dir, 'codes.js'), 'utf8')
    const ruleCodes = [...codesSrc.matchAll(/^\s{2}([A-Z][A-Z_]+):\s*\{/gm)].map((m) => m[1])
    expect(ruleCodes.length).toBeGreaterThan(60)
    expect(ruleCodes).toContain('CONDITION_KIND_CHANGED')
    const perfSrc = readFileSync(join(dir, 'performanceRules.js'), 'utf8')
    const perfCodes = [...perfSrc.match(/PERFORMANCE_CODES = Object\.freeze\(\[([^\]]*)\]/)[1].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1])
    expect(perfCodes).toContain('TRIGGER_REQUIRED')
    expect(perfCodes).toContain('DEV_TOTAL')
    for (const c of [...ruleCodes, ...perfCodes]) expect(MESSAGES[`RULE_${c}`], `RULE_${c}`).toBeTruthy()
  })
  it('명령 알림·거절 문구 SEW_CMD_* 가 있고 자리표시자가 남지 않는다', () => {
    expect(Object.keys(MESSAGES).filter((k) => k.startsWith('SEW_CMD_')).length).toBeGreaterThan(15)
    expect(t('SEW_CMD_APPLIED', { no: 3 })).toBe('3번 스텝에 적용했습니다. 아직 저장 전입니다.')
  })
  it('편집 중 실시간 알림(칸 검사 code)은 SEW_NOTE_ 문구가 없으면 RULE_ 문구를 쓴다', () => {
    expect(noteMessage({ code: 'NEXT_UNRESOLVED', params: { which: 'onTrue' } })).toBe(MESSAGES.RULE_NEXT_UNRESOLVED)
    expect(noteMessage({ code: 'ACCEPT_TOO_LOW', params: {} })).toBe(MESSAGES.RULE_ACCEPT_TOO_LOW)
    expect(noteMessage({ code: 'RETRY_RANGE', params: { max: 20 } })).toBe(t('RULE_RETRY_RANGE', { max: 20 }))
    expect(noteMessage({ code: 'LAST_STEP_NEXT', params: {} })).toBe(MESSAGES.SEW_NOTE_LAST_STEP_NEXT)
    expect(noteMessage({ code: 'NOPE_CODE', params: {} })).toBe('[SEW_NOTE_NOPE_CODE]')
  })
  it('칸 오류 문구(fieldMessage): RULE_<code>, 미해결 갈 곳은 원래 번호를 알면 함께(목업 validate)', () => {
    expect(fieldMessage({ code: 'ACCEPT_TOO_LOW', params: {} })).toBe(MESSAGES.RULE_ACCEPT_TOO_LOW)
    expect(fieldMessage({ code: 'RETRY_RANGE', params: { max: 20 } })).toBe(t('RULE_RETRY_RANGE', { max: 20 }))
    expect(fieldMessage({ code: 'NEXT_UNRESOLVED', params: { which: 'onFalse', value: 7 } })).toBe('갈 곳을 고르세요(원래 7번).')
    expect(fieldMessage({ code: 'NEXT_UNRESOLVED', params: { which: 'onTrue' } })).toBe('갈 곳을 고르세요.')
    expect(fieldMessage({ code: 'NEXT_UNRESOLVED' })).toBe('갈 곳을 고르세요.')
  })
  it('P2 편집 코드(편집기·편집 저장소·편집 부품)에는 화면 문구(한글 글자)를 직접 쓰지 않는다 — 문구는 messages.js 한 곳', () => {
    const files = import.meta.glob(['../editor/*.js', '../stores/editStore.js', '../stores/saveFlow.js', '../stepRows.js', '../components/{StepToolbar,TargetPicker,EditDialogs,MultiSelection,StepPanel,CaptureLayer,SaveDialog,NewScenarioDialog,TestLayer}.vue', '../components/panel/**/*.vue', '../components/save/*.vue', '../components/newScenario/*.vue', '../components/load/*.vue', '../stores/snapshotStore.js', '../components/snapshot/*.vue', '../stores/visionTestStore.js', '../stores/testRunStore.js', '../components/testrun/*.vue'],
      { query: '?raw', import: 'default', eager: true })
    expect(Object.keys(files).length).toBeGreaterThan(30)
    const bad = []
    for (const [f, src] of Object.entries(files)) {
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
      for (const line of code.split('\n')) if (/[\uac00-\ud7a3]/.test(line)) bad.push(`${f}: ${line.trim()}`)
    }
    expect(bad).toEqual([])
  })
  it('만들던 새 스텝 확인 창 문구는 버튼·칸 이름을 화면에 보이는 그대로 부른다([계속 만들기]·넣을 자리·[넣기])', () => {
    const body = t('SEW_EDIT_GUARD_NEW_BODY')
    expect(body).toContain(`[${t('SEW_EDIT_GUARD_NEW_KEEP')}]`)
    expect(body).toContain(t('SEW_PANEL_NEW_WHERE'))
    expect(body).toContain(`[${t('SEW_PANEL_NEW_ADD')}]`)
  })
  it('스냅샷 문구(P3 설계 §4·§9): 태그 알약 다섯·거르기·모드 탭·설계가 글을 정한 안내', () => {
    expect(['start', 'success', 'stop', 'fail', 'skip'].map((k) => t(`SEW_SNAP_TAG_${k}`))).toEqual(['시작', '성공', '중지', '실패', '건너뜀'])
    for (const f of FILTERS) expect(MESSAGES[`SEW_SNAP_FILTER_${f}`], f).toBeDefined()
    expect([t('SEW_SNAP_MODE_step'), t('SEW_SNAP_MODE_snapshot')]).toEqual(['스텝 그림', '스냅샷'])
    expect(t('SEW_SNAP_NO_TAG')).toBe('이 날에는 태그 스냅샷이 없습니다.')
    expect(t('SEW_SNAP_NO_RECENT')).toBe('최근 15일 안에 스냅샷이 없습니다.')
    expect(t('SEW_SNAP_LIST_FAILED')).toBe('목록을 받지 못했습니다.')
    expect(t('SEW_SNAP_EMPTY_DAY')).toBe('스냅샷이 없습니다.')
    expect(t('SEW_SNAP_EXPIRES', { n: 2 })).toBe('2일 뒤 삭제')
    expect(t('SEW_UI_SNAPSHOT_RAIL')).toBe('스냅샷')
    expect(t('SEW_SNAP_WEEKDAYS')).toHaveLength(7)
  })
  it('화면 코드가 쓰는 문구 키가 모두 있다', () => {
    const sources = import.meta.glob(['../**/*.vue', '../**/*.js', '!../tests/**'], { query: '?raw', import: 'default', eager: true })
    const keys = new Set()
    for (const src of Object.values(sources)) for (const m of src.matchAll(/\bt\('([A-Za-z0-9_]+)'/g)) keys.add(m[1])
    expect(keys.size).toBeGreaterThan(5)
    for (const k of keys) expect(MESSAGES[k], k).toBeDefined()
  })
})

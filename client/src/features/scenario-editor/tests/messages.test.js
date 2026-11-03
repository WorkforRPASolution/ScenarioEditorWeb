import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { t, errorCode, errorMessage, noteMessage, MESSAGES } from '../messages'

// 서버가 PARSE_FAILED 에 싣는 field 전부(server/features/scenario-editor/domain — skeleton·conditionCodec).
const PARSE_FAILED_FIELDS = ['body', 'steps', 'bi', 'property', 'step', 'metadata', 'script', 'trainImage', 'imageMulti', 'ocrMulti', 'eqpState',
  'TextValue', 'ConditionExpression', 'click', 'wheel', 'keyboard', 'wait', 'fap', 'native']
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

const NOTE_CODES = ['CONDITION_UNKNOWN', 'ACTION_INVALID', 'OCR_OP_NONE', 'PARSE_FAILED', 'NEXT_OUT_OF_RANGE', 'NEXT_SELF', 'LAST_STEP_NEXT',
  'FALSE_NEXT_WITH_ACTION', 'VALUE_EMPTY', 'OCR_WITH_MOUSE_CLICK', 'UNREACHABLE', 'NO_SUCCESS', 'ACTION_NOT_IN_COMBO', 'EQPSTATE_SKIP_PREPROCESSING',
  'BASE_IMAGE_MISSING', 'KEY_CODE_UNKNOWN', 'PRIORITY_NONSTANDARD', 'TARGET_WINDOW_DIFFERS']
const ERROR_CODES = ['USER_NOT_REGISTERED', 'PROCESS_FORBIDDEN', 'MASTER_REQUIRED', 'NOT_FOUND', 'DATA_INVALID', 'UPSTREAM_DOWN', 'UPSTREAM_TIMEOUT', 'UPSTREAM_FAILED', 'BAD_REQUEST', 'NETWORK', 'TIMEOUT', 'UNKNOWN']

describe('messages', () => {
  it('경고·알림 코드 18개 모두 문구가 있다', () => {
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
  it('화면 코드가 쓰는 문구 키가 모두 있다', () => {
    const sources = import.meta.glob(['../**/*.vue', '../**/*.js', '!../tests/**'], { query: '?raw', import: 'default', eager: true })
    const keys = new Set()
    for (const src of Object.values(sources)) for (const m of src.matchAll(/\bt\('([A-Za-z0-9_]+)'/g)) keys.add(m[1])
    expect(keys.size).toBeGreaterThan(5)
    for (const k of keys) expect(MESSAGES[k], k).toBeDefined()
  })
})

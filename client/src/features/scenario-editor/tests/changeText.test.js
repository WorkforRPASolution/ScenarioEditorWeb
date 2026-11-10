// 바뀐 값 글 전수 점검(2026-11-10 사내 시험: 저장 창이 "운영 속성 켜짐" 으로만 보였다).
// 저장 창 "바뀐 것"·운영 속성 창 "바뀐 값"·스텝 패널 "바뀐 값" 이 함께 쓰는 propertyDiffs·diffLines 의 줄마다
// 이름이 값처럼 읽히지 않고, 이전·지금 글이 비어 있지 않고, 서로 다른지 본다.
import { describe, it, expect } from 'vitest'
import { propertyDiffs } from '../editor/propertyView'
import { diffLines, ocrText } from '../editor/panel'
import { defaultProperty } from '../editor/newScenario'
import { LABELS } from '../messages'
import { imageStep, ocrStep, noneStep } from './panelFixture'

const base = defaultProperty({ id: 'P-M-N', type: 1 })
const one = (key, a, b) => {
  const r = propertyDiffs({ ...base, [key]: a }, { ...base, [key]: b })
  expect(r).toHaveLength(1)
  return `${r[0].label} ${r[0].from} → ${r[0].to}`
}

describe('운영 속성 바뀐 값 글(propertyDiffs)', () => {
  it.each([
    ['IsEnabled', true, false, '상태 켜짐 → 꺼짐'],
    ['Type', 1, 3, '유형 알람자동조치 → 설비 컨디션유지'],
    ['Type', 1, 99, '유형 알람자동조치 → 저장 값 99'],
    ['Priority', 10, 1, '우선순위 낮음 → 높음'],
    ['Priority', 10, 3, '우선순위 낮음 → 저장 값 3'],
    ['StartDelay', 0, 30, '시작 지연 없음 → 30초'],
    ['StartDelay', 30, 5400, '시작 지연 30초 → 1시간 30분'],
    ['RetryCnt', 0, 2, '재시도 안 함 → 2번 더'],
    ['RetryInterval', 10, 120, '재시도 간격 10초 → 2분'],
    ['DoNotSendEmailWhenSuccess', false, true, '성공 메일 보냄 → 안 보냄'],
    ['DoNotSendEmailWhenFail', false, true, '실패 메일 보냄 → 안 보냄'],
    ['DoNotSendEmailWhenStop', true, false, '중지 메일 안 보냄 → 보냄'],
    ['NextScenarioIfSuccess', null, { Name: 'NEXT_A', Text: '설명' }, '성공 후속 없음 → NEXT_A'],
    ['NextScenarioIfFail', { Name: 'A', Text: 'x' }, null, '실패 후속 A → 없음'],
    ['NextScenarioIfSuccess', null, { Name: '', Text: '' }, '성공 후속 없음 → 빈 값'],
    ['ExecutingLevel', 0, 1, '데스크탑 실행 꺼짐 → 켜짐'],
    ['ExecutingLevel', 0, 2, '데스크탑 실행 꺼짐 → 저장 값 2'],
    ['DetailedDescriptionTitle', '', '제목', '데스크탑 설명 없음 → 제목'],
    ['EDMLink', 'http://a', '', '데스크탑 링크 http://a → 없음']
  ])('고칠 수 있는 칸 %s %j → %j', (key, a, b, text) => {
    expect(one(key, a, b)).toBe(text)
  })

  it('후속 설명만 바꾸면 이름이 같아 "A → A" 가 되지 않게 설명을 보인다', () => {
    expect(one('NextScenarioIfFail', { Name: 'A', Text: 'x' }, { Name: 'A', Text: 'y' })).toBe('실패 후속 설명 x → y')
    expect(one('NextScenarioIfSuccess', { Name: 'A', Text: '' }, { Name: 'A', Text: 'y' })).toBe('성공 후속 설명 없음 → y')
  })

  it('웹에서 고치지 않는 칸도 운영 속성 창과 같은 글이다 — 트리거 유형은 이름, 알림 창은 예·아니오, 빈 글은 없음', () => {
    expect(one('ScenarioTriggerType', 0, 1)).toBe('트리거 유형 USER_DEFINED → EES')
    expect(one('ScenarioTriggerType', 0, 7)).toBe('트리거 유형 USER_DEFINED → 저장 값 7')
    expect(one('IsShowDialog', true, false)).toBe('알림 창 예 → 아니오')
    expect(one('DetailedDescription', '', '긴 설명')).toBe('상세 설명 없음 → 긴 설명')
    expect(one('DescriptionFromConductor', '의견', '')).toBe('심의 의견 의견 → 없음')
    expect(one('LowcodeExtension', '', 'x')).toBe('LowcodeExtension 없음 → x')
  })

  it('칸 이름은 그 칸의 값 글과 겹치지 않는다(이름이 값으로 읽히지 않게)', () => {
    const P = LABELS.prop
    const values = new Set([P.on, P.off, P.yes, P.no, P.send, P.noSend, P.none, P.retryOff, ...Object.values(LABELS.enabled)])
    for (const name of [...Object.values(P.keys), ...Object.values(LABELS.propertyKey)]) expect(values.has(name), name).toBe(false)
  })
})

describe('스텝 바뀐 값 글(diffLines)', () => {
  const w = { steps: [imageStep(0), noneStep(1), ocrStep(2)] }
  const [b, , o] = w.steps
  const lines = (from, to) => diffLines(from, to, w).map((l) => `${l.label} ${l.before} → ${l.after}`)
  const im = (x) => ({ ...b, condition: { ...b.condition, image: { ...b.condition.image, ...x } } })
  const oc = (x) => ({ ...o, condition: { ...o.condition, ocr: { ...o.condition.ocr, ...x } } })

  it.each([
    ['설명', { ...b, descriptionToEmail: '새 설명' }, '설명 스텝0 → 새 설명'],
    ['검색 영역', { ...b, condition: { ...b.condition, searchArea: { x: 1, y: 2, w: 30, h: 40 } } }, '검색 영역 10, 20, 300×200 → 1, 2, 30×40'],
    ['찾을 그림', { ...b, images: { ...b.images, train: { 0: { from: 'crop', x: 1 } } } }, '찾을 그림 이전 그림 → 새 그림'],
    ['기준 화면', { ...b, images: { ...b.images, base: { from: 'upload' } } }, '기준 화면 이전 그림 → 새 그림'],
    ['정확도', im({ accept: 0.85 }), '정확도 0.90 → 0.85'],
    ['다중 검사', im({ multi: { count: '3', op: 1, raw: '3-1' } }), '다중 검사 1개 == → 3개 >='],
    ['전처리 스킵', { ...b, condition: { ...b.condition, skipPreprocessing: true } }, '전처리 스킵 끔 → 켬'],
    ['동작 없음', { ...b, action: { type: 0 } }, '동작 마우스 클릭 (24, 12) → 없음'],
    ['동작 두 번 클릭', { ...b, action: { type: 2, click: { x: 5, y: 6 } } }, '동작 마우스 클릭 (24, 12) → 두 번 클릭 (5, 6)'],
    ['동작 휠', { ...b, action: { type: 4, wheel: { notches: -3 } } }, '동작 마우스 클릭 (24, 12) → 휠 위로 3칸'],
    ['동작 키보드', { ...b, action: { type: 5, keyboard: { text: 'abc', codes: [10, 9] } } }, '동작 마우스 클릭 (24, 12) → 키보드 abc + Enter + Tab'],
    ['동작 대기', { ...b, action: { type: 6, waitSec: 3 } }, '동작 마우스 클릭 (24, 12) → 대기 3초'],
    ['동작 창 찾기', { ...b, action: { type: 9, findWindow: { title: '창' } } }, '동작 마우스 클릭 (24, 12) → 창 찾기 창'],
    ['동작 메일', { ...b, action: { type: 10 } }, '동작 마우스 클릭 (24, 12) → 메일 보내기'],
    ['동작 명령', { ...b, action: { type: 11, command: 'dir' } }, '동작 마우스 클릭 (24, 12) → 명령 실행 dir'],
    ['동작 스크립트', { ...b, action: { type: 12, customScript: { name: 'S' } } }, '동작 마우스 클릭 (24, 12) → 스크립트 S'],
    ['성공하면 끝', { ...b, next: { ...b.next, onTrue: { kind: 'end', value: 'SUCCESS' } } }, '성공하면 NEXT → SUCCESS'],
    ['성공하면 스텝', { ...b, next: { ...b.next, onTrue: { kind: 'step', uid: 's2' } } }, '성공하면 NEXT → 3번'],
    ['실패하면', { ...b, next: { ...b.next, onFalse: { kind: 'step', uid: 's1' } } }, '실패하면 FAIL → 2번'],
    ['재시도', { ...b, retry: { limit: 3, intervalMs: 2500 } }, '재시도 2회 · 2초 → 3회 · 2.5초']
  ])('이미지 스텝 — %s', (_n, to, text) => {
    expect(lines(b, to)).toEqual([text])
  })

  it.each([
    [{ text: 'RUN' }, '읽은 글자 비교 문자 같음 IDLE → 문자 같음 RUN'],
    [{ op: 3, opName: 'TextContain', text: 'RU' }, '읽은 글자 비교 문자 같음 IDLE → 문자 포함 RU'],
    [{ op: 5, opName: 'NumberEqual', number: 3.5 }, '읽은 글자 비교 문자 같음 IDLE → 숫자 같음 3.5'],
    [{ op: 7, opName: 'NumberInRange', min: 1, max: 5 }, '읽은 글자 비교 문자 같음 IDLE → 범위 안 1 ~ 5'],
    [{ op: 10, opName: 'NumberGreaterThan', number: 0 }, '읽은 글자 비교 문자 같음 IDLE → 보다 큼 0'],
    [{ op: 0, opName: 'None' }, '읽은 글자 비교 문자 같음 IDLE → 선택 안 함']
  ])('OCR 스텝 — %j', (x, text) => {
    expect(lines(o, oc(x))).toEqual([text])
  })

  it('비교를 고르지 않은 OCR 은 저장된 숫자 0 을 붙이지 않는다', () => {
    expect(ocrText({ op: 0, opName: 'None', number: 0, text: '' })).toBe('선택 안 함')
  })
})

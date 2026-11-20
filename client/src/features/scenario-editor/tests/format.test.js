import { describe, it, expect } from 'vitest'
import { t } from '../messages'
import { targetLabel, targetKind, multiLabel, formatCrtime, intervalSec, actionLabel, conditionLabel, scenarioTypeLabel, enabledLabel, scenarioTypeOptions, SCENARIO_TYPE_KEYS, sizeText } from '../format'
import { LABELS } from '../messages'
import { typeName } from '../editor/propertyView'

describe('format', () => {
  it('targetLabel·targetKind', () => {
    expect(targetLabel({ kind: 'next' })).toBe('NEXT')
    expect(targetLabel({ kind: 'end', value: 'SUCCESS' })).toBe('SUCCESS')
    expect(targetLabel({ kind: 'step', uid: 's2', no: 3 })).toBe('→3')
    expect(targetLabel({ kind: 'unresolved', value: 7 })).toBe(t('SEW_EDIT_UNRESOLVED_FROM', { value: 7 }))
    expect(targetLabel({ kind: 'unresolved' })).toBe(t('SEW_EDIT_UNRESOLVED'))
    expect(targetLabel({ kind: 'raw', value: -2 })).toBe('? -2')
    expect(targetKind({ kind: 'end', value: 'FAIL' })).toBe('end-fail')
    expect(targetKind({ kind: 'raw', value: 9 })).toBe('raw')
  })
  it('multiLabel: 개수 원문 + 연산 기호', () => {
    expect(multiLabel({ count: '1', op: 0 })).toBe('1개 ==')
    expect(multiLabel({ count: ' 5', op: 1 })).toBe(' 5개 >=')
    expect(multiLabel({ count: '2', op: null })).toBe('2개 ?')
    expect(multiLabel(null)).toBe('—')
  })
  it('formatCrtime 은 보는 사람 시간대', () => {
    const ms = new Date(2026, 9, 28, 14, 32, 5).getTime()
    expect(formatCrtime(ms)).toBe('2026-10-28 14:32:05')
  })
  it('intervalSec 은 정수 나눗셈(사내 표 INTERVAL 열)', () => {
    expect(intervalSec(2500)).toBe(2)
    expect(intervalSec(999)).toBe(0)
  })
  it('유형 이름은 한 표(사내 속성 창 이름, 분석 01 유형 표·13 §4.4) — 바·불러오기 목록·저장 창·운영 속성 창·새 시나리오 창이 같은 글', () => {
    const INHOUSE = [[1, '알람자동조치'], [3, '설비 컨디션유지'], [4, '설비 비가동인폼'], [5, '품질사고 예방'], [6, '작업 SOP 인폼'], [7, 'PM 자동화(Full Auto PM 포함)'], [8, '사고예방 및 피해최소화']]
    for (const [n, name] of INHOUSE) {
      expect(scenarioTypeLabel(n), String(n)).toBe(name) // 바·저장 창 바뀐 것
      expect(typeName(n), String(n)).toBe(name) // 운영 속성 창·새 시나리오 창
      expect(LABELS.scenarioType[SCENARIO_TYPE_KEYS[n]], String(n)).toBe(name) // 불러오기 목록(typeName 문자열)
    }
    expect(scenarioTypeOptions).toEqual(INHOUSE) // 고를 수 있는 것(운영 속성 창·새 시나리오 창 콤보)
    // 고를 수 없는 저장 값(미지정·PM 매크로)은 보일 때 지금 이름, 표에 없는 값은 화면마다 저장 값 그대로
    expect([scenarioTypeLabel(0), typeName(0), scenarioTypeLabel(2), typeName(2)]).toEqual(['미지정', '미지정', 'PM 매크로', 'PM 매크로'])
    expect([scenarioTypeLabel(99), typeName(99)]).toEqual(['99', t('SEW_PROP_STORED', { value: 99 })])
  })
  it('라벨', () => {
    expect(actionLabel('MouseLeftClick')).toBe('마우스 클릭')
    expect(actionLabel(null)).toBe('알 수 없는 동작')
    expect(conditionLabel('eqpState')).toBe('설비 상태')
    expect([scenarioTypeLabel(1), scenarioTypeLabel(99)]).toEqual(['알람자동조치', '99'])
    expect([enabledLabel(true), enabledLabel(false), enabledLabel(null)]).toEqual(['켜짐', '꺼짐', '?'])
  })
})

import { stepExtraRows } from '../format'
import { MESSAGES as M } from '../messages'
describe('sizeText — 바이트를 B·KB·MB·GB 로', () => {
  it('1024 미만은 바이트 그대로, 그 위는 소수 한 자리 — 반올림해 1024 가 되면 다음 단위로', () => {
    expect([0, 86, 1023, 1024, 1536, 178413, 1048575, 1048576, 114881881, 3 * 1024 ** 3].map(sizeText))
      .toEqual(['0 B', '86 B', '1023 B', '1.0 KB', '1.5 KB', '174.2 KB', '1.0 MB', '1.0 MB', '109.6 MB', '3.0 GB'])
  })
  it('값이 없거나 숫자가 아니면 빈칸', () => {
    expect([null, undefined, NaN, -1, '12'].map(sizeText)).toEqual(['', '', '', '', ''])
  })
})

describe('stepExtraRows', () => {
  it('찾을 그림 키·Type 줄 이름은 messages.js 에서 온다(P1 상세와 같은 글자)', () => {
    const rows = stepExtraRows({ condition: { image: { trainImages: [{ key: 0, type: true }] } }, descriptionToDialog: '', isShowDialog: true, raw: {} })
    expect(rows[4]).toEqual([M.SEW_UI_EXTRA_TRAIN_KEYS, '0:true'])
    expect(M.SEW_UI_EXTRA_TRAIN_KEYS).toBe('학습 이미지(키·Type)')
  })
})

import { timeoutText } from '../format'
describe('제한 시간 글(SEW-024 — 저장 창 두 곳이 같은 함수를 따로 들고 있었다)', () => {
  it('정수 글은 "n분", 빈 값은 (없음), 숫자가 아니면 글 그대로', () => {
    expect(timeoutText('15')).toBe(t('SEW_SAVE_MINUTES', { n: '15' }))
    expect(timeoutText(240)).toBe(t('SEW_SAVE_MINUTES', { n: 240 }))
    for (const v of ['', null, undefined]) expect(timeoutText(v)).toBe(t('SEW_SAVE_EMPTY_VALUE'))
    expect(timeoutText('1.5')).toBe('1.5')
    expect(timeoutText('abc')).toBe('abc')
  })
})

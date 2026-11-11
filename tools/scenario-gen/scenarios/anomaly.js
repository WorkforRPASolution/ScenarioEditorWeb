'use strict'
const { NEXT, FAIL, SUCCESS, newStep } = require('../lib/builders')
const { AREAS } = require('./basic')
const TW = ['EQ Control*', 'WindowsForms10']
const S = (kind, action, onTrue, onFalse, baseImage, notes = []) => ({ kind, action, onTrue, onFalse, baseImage, notes })
const one = (w) => { w.targetWindow(...TW); w.none({ desc: '끝', next: [SUCCESS, FAIL] }) }

module.exports = [
  { name: 'DUP_PROPERTY', process: 'SEWCVD', model: 'SEWMODELB', desc: '같은 키 SC_PROPERTY 2건', load: 'dupProperty', build: one,
    expect: { list: { visible: true, status: ['DUPLICATE_PROPERTY'] }, open: { ok: false, status: 422, code: 'DATA_INVALID' } } },
  { name: 'NO_REDIS_FIELD', process: 'SEWCVD', model: 'SEWMODELB', desc: 'Redis 필드 없음', load: 'noRedisField', build: one,
    expect: { list: { visible: true, status: ['NO_CURRENT_VERSION'] }, open: { ok: false, status: 404, code: 'NOT_FOUND' }, versions: 1 } },
  { name: 'EMPTY_BI_VERSION', process: 'SEWCVD', model: 'SEWMODELB', desc: '기준 화면이 빈 버전', load: 'emptyBiVersion',
    build: (w) => { w.targetWindow(...TW); w.image({ fx: 'alarm', area: AREAS.DIALOG, train: AREAS.RESET, click: '24:12', desc: '클릭' }); w.none({ desc: '끝', next: [SUCCESS, FAIL] }) },
    expect: { list: { visible: true, status: [] }, open: { ok: true }, scenarioNotes: [], versions: 1,
      steps: [S('image', 'MouseLeftClick', 'NEXT', 'FAIL', 'missing', ['BASE_IMAGE_MISSING']), S('none', 'None', 'SUCCESS', 'FAIL', 'notNeeded')] } },
  { name: 'PROPERTYLESS', process: 'SEWCVD', model: 'SEWMODELB', desc: 'property 없는 문서', load: 'propertyless', build: one,
    expect: { list: { visible: false, status: [] }, open: { ok: false, status: 404, code: 'NOT_FOUND' } } },
  {
    name: 'BAD_VALUES', process: 'SEWCVD', model: 'SEWMODELB', desc: '해석이 깨지는 값',
    build: (w) => {
      // 대상 창은 기본(null/null) — 사내 표시 "설정", 에이전트 못 찾음 → TARGET_WINDOW_DIFFERS
      w.none({ action: [-1, ''], desc: '동작 -1' })                                                              // s1
      w.ocr({ fx: 'idle', area: AREAS.STATUS, op: 0, action: [1, '5:5'], desc: 'OCR 연산 None + 클릭' })          // s2
      w.none({ action: [6, '1000'], desc: '실패 쪽 NEXT', next: [NEXT, NEXT] })                                   // s3
      w.none({ action: [11, ''], desc: '값 없는 명령', next: [5, FAIL] })                                          // s4 → s6
      w.none({ action: [6, '1000'], desc: '범위 밖', next: [-2, FAIL] })                                          // s5 (도달 불가)
      w.none({ desc: '자기 참조', next: [5, NEXT] })                                                               // s6
      const v = newStep(3, -18, -18, -18, -18); w.raw(v, 'AA==', { desc: 'a@@b Variable 조건' })                  // s7
      w.eqp({ expr: 'MAIN,IDLE', desc: '토큰 2개', next: [NEXT, FAIL] })                                           // s8
    },
    expect: { list: { visible: true, status: [] }, open: { ok: true },
      header: { targetWindow: { agentFinds: false, reasonCode: 'TEXT_EMPTY' } }, scenarioNotes: ['NO_SUCCESS', 'TARGET_WINDOW_DIFFERS'],
      steps: [
        S('none', null, 'NEXT', 'FAIL', 'notNeeded', ['ACTION_INVALID']),
        S('ocr', 'MouseLeftClick', 'NEXT', 'FAIL', 'present', ['OCR_OP_NONE', 'OCR_WITH_MOUSE_CLICK']),
        S('none', 'Wait', 'NEXT', 'NEXT', 'notNeeded'),
        S('none', 'RunCommand', '→6', 'FAIL', 'notNeeded', ['VALUE_EMPTY']),
        S('none', 'Wait', '?-2', 'FAIL', 'notNeeded', ['NEXT_OUT_OF_RANGE', 'UNREACHABLE']),
        S('none', 'None', '→6', 'NEXT', 'notNeeded', ['NEXT_SELF']),
        S('unknown', 'None', 'NEXT', 'FAIL', 'notNeeded', ['CONDITION_UNKNOWN']),
        S('eqpState', 'None', 'NEXT', 'FAIL', 'notNeeded', ['LAST_STEP_NEXT', 'PARSE_FAILED'])
      ] }
  },
  {
    name: 'BAD_PERFORMANCE', process: 'SEWCVD', model: 'SEWMODELB', desc: '성과 정보 사본 이름(운영에 없는 키)',
    build: (w) => {
      one(w)
      const p = w.sc.performance
      delete p.EqpPerfornmanceLoss; delete p.WaferLoss
      p.EqpPerformanceLoss = 7; p.GlassLoss = 8
    },
    expect: { list: { visible: true, status: [] }, open: { ok: true }, scenarioNotes: [], performance: { eqpPerformanceLoss: 0, waferLoss: 0 },
      steps: [S('none', 'None', 'SUCCESS', 'FAIL', 'notNeeded')] }
  },
  {
    name: 'NONSTANDARD_PROPERTY', process: 'SEWCVD', model: 'SEWMODELB', desc: '운영 속성 비표준 값',
    build: (w) => { one(w); w.sc.property.Priority = 3; w.sc.property.Type = 0 },
    expect: { list: { visible: true, status: [] }, open: { ok: true }, scenarioNotes: ['PRIORITY_NONSTANDARD'], performance: { supervisorNotEntered: true },
      steps: [S('none', 'None', 'SUCCESS', 'FAIL', 'notNeeded')] }
  },
  {
    // P2-F 전처리 설정: 에이전트가 찾지 않거나 위험한 숨길 창(클래스 없음 · 앞뒤 공백 + '*' · 위치 확인 + -218), 대상 창 제목 '*'
    name: 'BAD_WINDOWS', process: 'SEWPHOTO', model: 'SEWMODELB', desc: '문제 있는 창 조건',
    build: (w) => {
      w.targetWindow('*', 'MainFrame')
      w.hidingWindows([['Notice', ''], ['  Popup* ', 'Dialog'], ['Legacy', 'LegacyWnd', { IsCheckRectEqual: true, Left: -218, Top: 0, Right: 0, Bottom: 0 }], ['정상', 'OkWnd']])
      w.none({ desc: '끝', next: [SUCCESS, FAIL] })
    },
    expect: { list: { visible: true, status: [] }, open: { ok: true },
      header: { targetWindow: { agentFinds: false, reasonCode: 'TEXT_STAR' } },
      scenarioNotes: ['TARGET_WINDOW_DIFFERS', 'HIDING_WINDOW_NOT_FOUND', 'HIDING_WINDOW_SPACE', 'HIDING_WINDOW_FIXED_SIZE'],
      steps: [S('none', 'None', 'SUCCESS', 'FAIL', 'notNeeded')] }
  }
]

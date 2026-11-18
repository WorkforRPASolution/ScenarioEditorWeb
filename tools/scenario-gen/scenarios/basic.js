'use strict'
const { NEXT, FAIL, SUCCESS, SKIP } = require('../lib/builders')

const DIALOG = [560, 320, 880, 520]; const RESET = [711, 660, 255, 96]; const STATUS = [366, 111, 450, 60]; const START_AREA = [1300, 940, 360, 170]; const START = [1344, 972, 270, 108]
const TW = ['EQ Control*', 'WindowsForms10']
const ok = (steps, extra = {}) => ({ list: { visible: true, status: [] }, open: { ok: true }, steps, scenarioNotes: [], ...extra })
const S = (kind, action, onTrue, onFalse, baseImage, notes = []) => ({ kind, action, onTrue, onFalse, baseImage, notes })

module.exports = [
  {
    name: 'ALL_CONDITIONS', process: 'SEWCVD', model: 'SEWMODELA', desc: '조건 4종',
    build: (w) => {
      w.targetWindow(...TW)
      w.image({ fx: 'alarm', area: DIALOG, train: RESET, click: '24:12', desc: 'Reset 누르기' })
      w.ocr({ fx: 'idle', area: STATUS, op: 1, text: 'IDLE', desc: '상태 IDLE 확인' })
      w.none({ action: [6, '30000'], desc: '30초 대기' })
      w.eqp({ expr: 'MAIN,IDLE,_', desc: '서버 상태 확인', next: [SUCCESS, FAIL] })
    },
    expect: ok([
      S('image', 'MouseLeftClick', 'NEXT', 'FAIL', 'present'), S('ocr', 'None', 'NEXT', 'FAIL', 'present'),
      S('none', 'Wait', 'NEXT', 'FAIL', 'notNeeded'), S('eqpState', 'None', 'SUCCESS', 'FAIL', 'notNeeded')
    ], { header: { targetWindow: { agentFinds: true, matchMode: 'partial' } } })
  },
  {
    name: 'ALL_ACTIONS', process: 'SEWCVD', model: 'SEWMODELA', desc: '동작 16종(O.I. Command 3)',
    build: (w) => {
      w.image({ fx: 'alarm', area: DIALOG, train: RESET, click: '24:12', desc: '클릭' })
      w.image({ fx: 'alarm', area: DIALOG, train: RESET, action: [2, '10:5'], desc: '두 번 클릭' })
      w.image({ fx: 'alarm', area: DIALOG, train: RESET, action: [3, '-3:7'], desc: '오른쪽 클릭' })
      w.none({ action: [4, '-3@@2'], desc: '휠' })
      w.none({ action: [5, 'RESET@@10@@9'], desc: '키보드' })
      w.none({ action: [6, '30000'], desc: '대기' })
      w.none({ action: [7, ''], desc: 'Variable 동작' })
      w.none({ action: [8, 'EQP_DOWN@10000@A'], desc: 'O.I. Command' })
      w.none({ action: [8, 'RUNDOWN_RELEASE@A'], desc: 'O.I. Command RUNDOWN_RELEASE' })
      w.none({ action: [8, 'SERVER_RESTART'], desc: 'O.I. Command SERVER_RESTART' })
      w.none({ action: [9, 'EQ Control*'], desc: '창 찾기' })
      w.none({ action: [10, 'ops@example.com'], desc: '메일' })
      w.none({ action: [11, 'C:\\tools\\reset.bat'], desc: '명령 실행' })
      w.none({ action: [12, 'recover.scs'], desc: '스크립트' })
      w.none({ action: [13, 'SSB01@PM1@A@MACRO9'], desc: 'FAP' })
      w.none({ action: [14, 'ACS_CALL_1'], desc: 'ACS' })
      w.none({ action: [15, ''], native: { FunctionName: 'CloseAllPopups', Params: ['force'], Outputs: [] }, desc: 'Native' })
      w.none({ desc: '끝', next: [SUCCESS, FAIL] })
    },
    expect: ok([
      S('image', 'MouseLeftClick', 'NEXT', 'FAIL', 'present'), S('image', 'MouseLeftDoubleClick', 'NEXT', 'FAIL', 'present'),
      S('image', 'MouseRightClick', 'NEXT', 'FAIL', 'present'), S('none', 'MouseMove', 'NEXT', 'FAIL', 'notNeeded'),
      S('none', 'Keyboard', 'NEXT', 'FAIL', 'notNeeded'), S('none', 'Wait', 'NEXT', 'FAIL', 'notNeeded'),
      S('none', 'Variable', 'NEXT', 'FAIL', 'notNeeded', ['ACTION_NOT_IN_COMBO']), S('none', 'OICommand', 'NEXT', 'FAIL', 'notNeeded', ['ACTION_NOT_IN_COMBO']),
      S('none', 'OICommand', 'NEXT', 'FAIL', 'notNeeded', ['ACTION_NOT_IN_COMBO']), S('none', 'OICommand', 'NEXT', 'FAIL', 'notNeeded', ['ACTION_NOT_IN_COMBO']),
      S('none', 'FindWindow', 'NEXT', 'FAIL', 'notNeeded', ['PARSE_FAILED']), S('none', 'SendEmail', 'NEXT', 'FAIL', 'notNeeded'),
      S('none', 'RunCommand', 'NEXT', 'FAIL', 'notNeeded'), S('none', 'CustomScript', 'NEXT', 'FAIL', 'notNeeded'),
      S('none', 'FAP', 'NEXT', 'FAIL', 'notNeeded', ['ACTION_NOT_IN_COMBO']), S('none', 'ACS', 'NEXT', 'FAIL', 'notNeeded', ['ACTION_NOT_IN_COMBO']),
      S('none', 'NativeFunction', 'NEXT', 'FAIL', 'notNeeded', ['ACTION_NOT_IN_COMBO']), S('none', 'None', 'SUCCESS', 'FAIL', 'notNeeded')
    ], { header: { targetWindow: { agentFinds: false, reasonCode: 'TEXT_EMPTY' } }, scenarioNotes: ['TARGET_WINDOW_DIFFERS'] })
  },
  {
    // 시험 실행(P5): 운영 속성이 기본값이 아니다 — 시작 지연·재시도·우선순위·후속 시나리오·메일 생략
    name: 'RUN_PROPS', process: 'SEWCVD', model: 'SEWMODELA', desc: '시험 실행 — 운영 속성',
    build: (w) => {
      w.targetWindow(...TW)
      Object.assign(w.sc.property, {
        StartDelay: 30, RetryCnt: 2, RetryInterval: 10, Priority: 5, DoNotSendEmailWhenSuccess: true, DoNotSendEmailWhenStop: true,
        NextScenarioIfSuccess: { Name: 'ALL_ACTIONS', Text: '동작 16종' }, NextScenarioIfFail: { Name: 'ALL_CONDITIONS', Text: '조건 4종' }
      })
      for (let i = 1; i <= 3; i++) w.none({ action: [6, '1000'], desc: `대기 ${i}`, next: i === 3 ? [SUCCESS, FAIL] : [NEXT, FAIL] })
    },
    expect: ok([S('none', 'Wait', 'NEXT', 'FAIL', 'notNeeded'), S('none', 'Wait', 'NEXT', 'FAIL', 'notNeeded'), S('none', 'Wait', 'SUCCESS', 'FAIL', 'notNeeded')])
  },
  {
    name: 'NEXT_RULES', process: 'SEWCVD', model: 'SEWMODELA', desc: '다음 스텝 규칙',
    build: (w) => {
      w.targetWindow(...TW)
      w.image({ fx: 'alarm', area: DIALOG, train: RESET, click: '24:12', desc: '1' })
      w.none({ action: [6, '1000'], desc: '2 → 4, 실패 SKIP', next: [3, SKIP] })
      w.none({ action: [6, '1000'], desc: '3 (도달 불가)', next: [SUCCESS, FAIL] })
      w.ocr({ fx: 'idle', area: STATUS, op: 3, text: 'READY', desc: '4 실패 → 2', next: [NEXT, 1] })
      w.none({ desc: '5', next: [SUCCESS, FAIL] })
    },
    expect: ok([
      S('image', 'MouseLeftClick', 'NEXT', 'FAIL', 'present'), S('none', 'Wait', '→4', 'SKIP', 'notNeeded'),
      S('none', 'Wait', 'SUCCESS', 'FAIL', 'notNeeded', ['UNREACHABLE']), S('ocr', 'None', 'NEXT', '→2', 'present'),
      S('none', 'None', 'SUCCESS', 'FAIL', 'notNeeded')
    ])
  },
  {
    name: 'OCR_ALL', process: 'SEWETCH', model: 'SEWMODELA', desc: 'OCR 연산 10종',
    build: (w) => {
      w.targetWindow(...TW)
      const o = (op, extra) => w.ocr({ fx: 'idle', area: STATUS, op, desc: `OCR ${op}`, ...extra })
      o(1, { text: 'IDLE' }); o(2, { text: 'ALARM' }); o(3, { text: 'RUN', multi: '2-1' }); o(4, { text: 'ERR', multi: '0-2' })
      o(5, { number: 3 }); o(6, { number: 0 }); o(7, { min: 1, max: 5 }); o(8, { min: 10, max: 20 }); o(9, { number: 100 })
      o(10, { number: 0.5, next: [SUCCESS, FAIL] })
    },
    expect: ok(Array.from({ length: 10 }, (_, i) => S('ocr', 'None', i === 9 ? 'SUCCESS' : 'NEXT', 'FAIL', 'present')))
  },
  {
    name: 'EQP_STATE', process: 'SEWETCH', model: 'SEWMODELA', desc: '설비 상태 3종',
    build: (w) => {
      w.targetWindow(...TW)
      w.eqp({ expr: 'MAIN,IDLE,_', desc: 'MAIN' }); w.eqp({ expr: 'A,_,1001', desc: '챔버' })
      w.eqp({ expr: 'B1,RUN,_', desc: '로드포트', next: [SUCCESS, FAIL] })
    },
    expect: ok([S('eqpState', 'None', 'NEXT', 'FAIL', 'notNeeded'), S('eqpState', 'None', 'NEXT', 'FAIL', 'notNeeded'), S('eqpState', 'None', 'SUCCESS', 'FAIL', 'notNeeded')])
  },
  {
    name: 'KEYBOARD', process: 'SEWETCH', model: 'SEWMODELB', desc: '키보드 기능 키',
    build: (w) => {
      w.targetWindow(...TW)
      w.none({ action: [5, 'abc@@10'], desc: 'abc + Enter' })
      w.none({ action: [5, '@@112@@113'], desc: 'F1 F2' })
      w.none({ action: [5, 'x@@999'], desc: '없는 코드', next: [SUCCESS, FAIL] })
    },
    expect: ok([S('none', 'Keyboard', 'NEXT', 'FAIL', 'notNeeded'), S('none', 'Keyboard', 'NEXT', 'FAIL', 'notNeeded'), S('none', 'Keyboard', 'SUCCESS', 'FAIL', 'notNeeded', ['KEY_CODE_UNKNOWN'])])
  },
  {
    name: 'MULTI_VERSION', process: 'SEWETCH', model: 'SEWMODELB', desc: '버전 3개',
    versions: [1, 2, 3].map((n) => (w) => {
      w.targetWindow(...TW)
      for (let i = 1; i <= n; i++) w.none({ action: [6, '1000'], desc: `v${n} 스텝 ${i}`, next: i === n ? [SUCCESS, FAIL] : [NEXT, FAIL] })
    }),
    expect: ok([S('none', 'Wait', 'NEXT', 'FAIL', 'notNeeded'), S('none', 'Wait', 'NEXT', 'FAIL', 'notNeeded'), S('none', 'Wait', 'SUCCESS', 'FAIL', 'notNeeded')], { versions: 3 })
  },
  {
    name: 'DISABLED', process: 'SEWETCH', model: 'SEWMODELB', desc: '꺼진 시나리오',
    build: (w) => { w.targetWindow(...TW); w.sc.property.IsEnabled = false; w.none({ desc: '끝', next: [SUCCESS, FAIL] }) },
    expect: ok([S('none', 'None', 'SUCCESS', 'FAIL', 'notNeeded')], { list: { visible: true, status: [], isEnabled: false } })
  },
  {
    name: 'LONG_200', process: 'SEWPHOTO', model: 'SEWMODELA', desc: '200 스텝',
    build: (w) => { w.targetWindow(...TW); for (let i = 1; i <= 200; i++) w.none({ action: [6, '1000'], desc: `스텝 ${i}`, next: i === 200 ? [SUCCESS, FAIL] : [NEXT, FAIL] }) },
    expect: ok(Array.from({ length: 200 }, (_, i) => S('none', 'Wait', i === 199 ? 'SUCCESS' : 'NEXT', 'FAIL', 'notNeeded')))
  },
  {
    name: 'ABC', process: 'SEWPHOTO', model: 'SEWMODELA', desc: 'ABC (1 스텝)',
    build: (w) => { w.targetWindow(...TW); w.none({ desc: 'ABC', next: [SUCCESS, FAIL] }) },
    expect: ok([S('none', 'None', 'SUCCESS', 'FAIL', 'notNeeded')])
  },
  {
    name: 'ABC_2', process: 'SEWPHOTO', model: 'SEWMODELA', desc: 'ABC_2 (2 스텝)',
    build: (w) => { w.targetWindow(...TW); w.none({ desc: 'ABC_2-1' }); w.none({ desc: 'ABC_2-2', next: [SUCCESS, FAIL] }) },
    expect: ok([S('none', 'None', 'NEXT', 'FAIL', 'notNeeded'), S('none', 'None', 'SUCCESS', 'FAIL', 'notNeeded')])
  },
  {
    name: 'TARGET_WINDOW_SET', process: 'SEWPHOTO', model: 'SEWMODELB', desc: '대상 창 둘 다',
    build: (w) => { w.targetWindow('EQ Control*', 'WindowsForms10'); w.none({ desc: '끝', next: [SUCCESS, FAIL] }) },
    expect: ok([S('none', 'None', 'SUCCESS', 'FAIL', 'notNeeded')], { header: { targetWindow: { agentFinds: true, matchMode: 'partial' } } })
  },
  {
    name: 'TARGET_WINDOW_TITLE_ONLY', process: 'SEWPHOTO', model: 'SEWMODELB', desc: '대상 창 제목만',
    build: (w) => { w.targetWindow('EQ Control', ''); w.none({ desc: '끝', next: [SUCCESS, FAIL] }) },
    expect: ok([S('none', 'None', 'SUCCESS', 'FAIL', 'notNeeded')], { header: { targetWindow: { agentFinds: false, reasonCode: 'CLASS_EMPTY' } } })
  },
  {
    name: 'TARGET_WINDOW_STAR', process: 'SEWPHOTO', model: 'SEWMODELB', desc: '대상 창 제목 *',
    build: (w) => { w.targetWindow('*', 'WindowsForms10'); w.none({ desc: '끝', next: [SUCCESS, FAIL] }) },
    expect: ok([S('none', 'None', 'SUCCESS', 'FAIL', 'notNeeded')], { header: { targetWindow: { agentFinds: false, reasonCode: 'TEXT_STAR' } }, scenarioNotes: ['TARGET_WINDOW_DIFFERS'] })
  },
  {
    // P2-F 전처리 설정: 대상 창 부분 일치 + 숨길 창 3(제목+클래스 · 클래스만 · 위치 확인)
    name: 'PREPROCESS_WINDOWS', process: 'SEWPHOTO', model: 'SEWMODELB', desc: '대상 창·숨길 창',
    build: (w) => {
      w.targetWindow('EQ Control*', 'WindowsForms10')
      w.hidingWindows([['화면 보호기', 'ScreenSaverClass'], ['', 'TaskManagerWindow'], ['Alarm Popup*', '#32770', { IsCheckRectEqual: true, Left: 100, Top: 100, Right: 500, Bottom: 400 }]])
      w.none({ action: [6, '1000'], desc: '대기', skipPreprocessing: true })
      w.none({ desc: '끝', next: [SUCCESS, FAIL] })
    },
    expect: ok([S('none', 'Wait', 'NEXT', 'FAIL', 'notNeeded'), S('none', 'None', 'SUCCESS', 'FAIL', 'notNeeded')], { header: { targetWindow: { agentFinds: true, matchMode: 'partial' } } })
  },
  {
    name: 'NO_BASE_IMAGE_STEPS', process: 'SEWPHOTO', model: 'SEWMODELB', desc: '기준 화면이 필요 없는 스텝만',
    build: (w) => { w.targetWindow(...TW); w.none({ action: [6, '1000'], desc: '대기' }); w.eqp({ expr: 'MAIN,IDLE,_', desc: '상태' }); w.none({ desc: '끝', next: [SUCCESS, FAIL] }) },
    expect: ok([S('none', 'Wait', 'NEXT', 'FAIL', 'notNeeded'), S('eqpState', 'None', 'NEXT', 'FAIL', 'notNeeded'), S('none', 'None', 'SUCCESS', 'FAIL', 'notNeeded')])
  }
]
module.exports.AREAS = { DIALOG, RESET, STATUS, START_AREA, START }

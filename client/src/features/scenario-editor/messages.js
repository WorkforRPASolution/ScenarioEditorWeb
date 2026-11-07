// 화면 문구 한 곳(공통 설계 §7.4). 사내 resx 키는 그 키로, 웹에서 새로 생긴 문구는 SEW_ 키로. 영어는 나중에 같은 키로 더한다.
// 라벨 한국어는 웹이 지었다(사내 XAML 문구 미확보, Q-095).
export const MESSAGES = {
  Exception12: '편집기 사용자로 등록되지 않았습니다. 관리자에게 사용자 등록을 요청하세요.',
  SEW_ERR_PROCESS_FORBIDDEN: '공정 권한 밖의 공정·모델입니다.',
  SEW_ERR_MASTER_REQUIRED: '전체 공정(MASTER) 사용자만 할 수 있습니다.',
  SEW_ERR_HOST_FORBIDDEN: '허용되지 않은 주소로 접속했습니다. localhost 로 여세요.',
  SEW_ERR_ORIGIN_FORBIDDEN: '이 화면 주소는 서버의 허용 목록에 없습니다.',
  SEW_ERR_FILE_DAMAGED: '저장 파일 일부가 없거나 깨져 이 버전을 열 수 없습니다. 다른 버전을 여세요.',
  SEW_ERR_NOT_FOUND: '시나리오나 버전을 찾지 못했습니다. 현재 버전이 없거나(저장 기록만 있음) 지워졌을 수 있습니다.',
  SEW_ERR_DATA_INVALID: '저장 데이터를 열 수 없습니다. 같은 공정·모델·이름의 운영 속성 문서가 둘 이상인지 데이터 점검에서 확인하세요.',
  SEW_ERR_UPSTREAM_DOWN: 'DB·Redis 에 연결되지 않았습니다. 잠시 뒤 다시 시도하세요.',
  SEW_ERR_UPSTREAM_TIMEOUT: '서버 응답이 늦습니다. 잠시 뒤 다시 시도하세요.',
  SEW_ERR_UPSTREAM_FAILED: '서버가 요청을 처리하지 못했습니다.',
  SEW_ERR_BAD_REQUEST: '요청 값이 올바르지 않습니다.',
  SEW_ERR_NETWORK: '편집기 서버에 연결하지 못했습니다.',
  SEW_ERR_TIMEOUT: '응답 시간이 지났습니다. 큰 시나리오라면 다시 열어 보세요(두 번째부터는 빠릅니다).',
  SEW_ERR_UNKNOWN: '알 수 없는 오류가 났습니다.',

  SEW_NOTE_CONDITION_UNKNOWN: '해석할 수 없는 조건 종류입니다(Variable 등). 원래 값을 그대로 둡니다.',
  SEW_NOTE_ACTION_INVALID: '알 수 없는 동작 번호입니다. 에이전트가 이 시나리오를 거부할 수 있습니다.',
  SEW_NOTE_OCR_OP_NONE: 'OCR 비교 연산이 선택되지 않았습니다.',
  SEW_NOTE_PARSE_FAILED: '저장된 값의 형식을 해석하지 못했습니다. 원래 값을 확인하세요.',
  // PARSE_FAILED 의 params.field 별 문구(noteMessage 가 먼저 찾는다). 서버 domain(skeleton·conditionCodec)이 내는 field 전부.
  SEW_NOTE_PARSE_FAILED_body: '시나리오 본문을 해석하지 못해 스텝·머리 정보 없이 열었습니다. 저장 데이터를 확인하세요.',
  SEW_NOTE_PARSE_FAILED_steps: '스텝 목록(Step)이 목록 형식이 아니라 스텝 없이 열었습니다. 저장 데이터를 확인하세요.',
  SEW_NOTE_PARSE_FAILED_bi: '기준 화면 데이터를 해석하지 못해 기준 화면 없이 열었습니다(실행에는 영향 없음).',
  SEW_NOTE_PARSE_FAILED_property: '운영 속성을 해석하지 못했습니다. 운영 속성 없이 엽니다.',
  SEW_NOTE_PARSE_FAILED_step: '스텝 값이 객체가 아니라 빈 스텝으로 읽었습니다. 원래 값을 확인하세요.',
  SEW_NOTE_PARSE_FAILED_metadata: '스텝의 조건 정보(Metadata)를 해석하지 못했습니다.',
  SEW_NOTE_PARSE_FAILED_script: '스텝의 동작 정보(Script)를 해석하지 못했습니다.',
  SEW_NOTE_PARSE_FAILED_trainImage: '학습 이미지 정보를 해석하지 못했습니다(그 학습 이미지는 보이지 않습니다).',
  SEW_NOTE_PARSE_FAILED_imageMulti: '이미지 다중 검사 값이 "개수-연산" 형식이 아닙니다.',
  SEW_NOTE_PARSE_FAILED_ocrMulti: 'OCR 다중 검사 값이 "개수-연산" 형식이 아닙니다.',
  SEW_NOTE_PARSE_FAILED_eqpState: '설비 상태 조건 값이 "대상,상태,코드" 세 칸이 아닙니다.',
  SEW_NOTE_PARSE_FAILED_TextValue: '조건 값(TextValue)이 글자가 아닙니다.',
  SEW_NOTE_PARSE_FAILED_ConditionExpression: '조건 식(ConditionExpression)이 글자가 아닙니다.',
  SEW_NOTE_PARSE_FAILED_click: '마우스 좌표 값이 "x:y" 형식이 아닙니다.',
  SEW_NOTE_PARSE_FAILED_wheel: '휠 값이 "칸@@초" 형식이 아닙니다.',
  SEW_NOTE_PARSE_FAILED_keyboard: '키보드 값의 키 코드가 숫자가 아닙니다.',
  SEW_NOTE_PARSE_FAILED_wait: '대기 값이 숫자(밀리초)가 아닙니다.',
  SEW_NOTE_PARSE_FAILED_fap: 'FAP 값이 "@" 로 나눈 네 칸이 아닙니다.',
  SEW_NOTE_PARSE_FAILED_findWindow: '창 찾기 값이 "창 제목@클래스" 또는 "창 제목@클래스@x@y" 형식이 아닙니다.',
  SEW_NOTE_PARSE_FAILED_customScript: '사용자 스크립트 값을 해석하지 못했습니다.',
  SEW_NOTE_PARSE_FAILED_native: '에이전트 함수 정보(NativeFunction)가 없습니다.',
  SEW_NOTE_NEXT_OUT_OF_RANGE: '다음 스텝 번호가 범위를 벗어났습니다.',
  SEW_NOTE_NEXT_SELF: '다음 스텝이 자기 자신입니다(사내 편집기는 저장을 막습니다).',
  SEW_NOTE_LAST_STEP_NEXT: '마지막 스텝의 다음이 NEXT 입니다(사내 편집기는 저장을 막습니다).',
  SEW_NOTE_FALSE_NEXT_WITH_ACTION: '동작이 있는데 실패 쪽 다음이 NEXT 입니다. 동작이 실패하면 결과 보고 없이 끝날 수 있습니다.',
  SEW_NOTE_VALUE_EMPTY: '값이 필요한 동작인데 값이 비어 있습니다.',
  SEW_NOTE_NONE_WITH_MOUSE_CLICK: '조건 없음 스텝의 마우스 클릭은 저장된 좌표와 상관없이 실행 때 화면 왼쪽 위(0,0)를 누릅니다.',
  SEW_NOTE_OCR_WITH_MOUSE_CLICK: 'OCR 스텝에 마우스 클릭 동작이 있습니다(사내 편집기는 추가를 막습니다).',
  SEW_NOTE_UNREACHABLE: '1번 스텝에서 출발해 닿지 않는 스텝입니다.',
  SEW_NOTE_NO_SUCCESS: 'SUCCESS 로 가는 스텝이 없습니다(사내 편집기는 저장을 막습니다).',
  SEW_NOTE_ACTION_NOT_IN_COMBO: '사내 편집기 동작 목록으로는 만들 수 없는 동작입니다(유효한 값).',
  SEW_NOTE_EQPSTATE_SKIP_PREPROCESSING: '설비 상태 스텝에 전처리 스킵 값이 들어 있습니다.',
  SEW_NOTE_BASE_IMAGE_MISSING: '기준 화면이 저장되어 있지 않습니다(실행에는 영향 없음).',
  SEW_NOTE_KEY_CODE_UNKNOWN: '이름표에 없는 키 코드가 있습니다(사내 편집기로 다시 저장하면 빠집니다).',
  SEW_NOTE_PRIORITY_NONSTANDARD: '우선순위가 1·5·10 이 아닙니다(사내 속성 창은 닫을 때 10 으로 바꿉니다).',
  SEW_NOTE_TARGET_WINDOW_DIFFERS: '사내 편집기에서는 대상 창이 "설정"으로 보이지만, 실제 실행에서는 창을 찾지 않습니다.',

  SEW_UI_TITLE: '시나리오 편집기',
  SEW_UI_LOAD: '불러오기',
  SEW_UI_EMPTY: '불러오기로 시나리오를 여세요',
  SEW_UI_OPENING: '시나리오를 여는 중',
  SEW_UI_OPENING_ELAPSED: '{s}초',
  SEW_UI_OPENING_SLOW: '큰 시나리오는 처음 열 때 시간이 걸립니다',
  SEW_UI_RETRY: '다시 시도',
  SEW_UI_SNAPSHOT_RAIL: '스냅샷 — 준비 중',
  SEW_UI_GUTTER_HINT: '끌어서 크기 조절 · 두 번 누르면 기본값',
  SEW_UI_BASE_IMAGE_HINT: '기준 화면은 스텝을 만들 때 캡처한 화면입니다. 실행에는 쓰이지 않습니다.',
  SEW_UI_BASE_IMAGE_NOT_NEEDED: '이 스텝은 화면을 보지 않는 조건이라 기준 화면이 없습니다.',
  SEW_UI_BASE_IMAGE_MISSING: '기준 화면이 저장되어 있지 않습니다 (실행에는 영향 없음).',
  SEW_UI_BASE_IMAGE_UNREADABLE: '기준 화면 데이터를 해석하지 못했습니다(경고 참고).',
  SEW_UI_IMAGE_LOAD_FAILED: '기준 화면을 불러오지 못했습니다.',
  SEW_UI_TRAIN_NOT_STORED: '점선 = 검색 영역 · 학습 이미지 위치는 저장되지 않아 그리지 않습니다',
  SEW_UI_PROPERTY_CURRENT: '운영 속성은 버전과 상관없이 현재 값입니다.',
  SEW_UI_NO_STEPS: '스텝이 없습니다.',
  SEW_UI_OLD_VERSION: '옛 버전',
  SEW_UI_CURRENT_VERSION: '현재 버전',
  SEW_UI_REFRESH_SCOPES: '권한·설비 다시 읽기',
  SEW_UI_REFRESHED: '권한·설비를 다시 읽었습니다.',
  SEW_UI_REFRESH_FAILED: '권한·설비를 다시 읽지 못했습니다.',
  SEW_UI_ENABLED_ONLY: '켜진 것만',
  SEW_UI_SEARCH_NAME: '이름으로 찾기',
  SEW_UI_DATA_CHECK: '데이터 점검',
  SEW_UI_PROPERTY_ALL: '운영 속성 전체',
  SEW_UI_TW_FINDS: "실행 때 창을 찾음 — 제목 '{text}' {mode} · 클래스 '{cls}'",
  SEW_UI_TW_NOT_FINDS: '실행 때 창을 찾지 않음 — {reason}',
  SEW_UI_TW_REASON_TEXT_EMPTY: '창 제목이 비어 있음',
  SEW_UI_TW_REASON_TEXT_STAR: '창 제목이 * 하나',
  SEW_UI_TW_REASON_CLASS_EMPTY: '창 클래스가 비어 있음',
  SEW_UI_LOAD_SCOPE_HINT: '공정 권한 안의 공정·모델만 보입니다',
  SEW_UI_LOAD_SCOPES_FAILED: '권한·설비를 읽지 못했습니다. [권한·설비 다시 읽기]를 눌러 보세요.',
  SEW_UI_LOAD_NO_SCOPES: '공정 권한 안에서 볼 수 있는 공정·모델이 없습니다.',
  SEW_UI_LOAD_VERSION_HINT: '두 번 눌러 엽니다. 옛 버전은 읽기 전용으로 엽니다.',
  SEW_UI_PRIORITY_NONSTANDARD: '{value} (사내 속성 창은 닫을 때 10 으로 바꿉니다 — 1·5·10 이 아님)',
  SEW_UI_PROPERTY_PARSE_FAILED: '운영 속성을 해석하지 못했습니다.',
  SEW_UI_DATA_CHECK_INTRO: '내 공정 권한 범위 안에서 찾은 중복·무효 데이터입니다. 사내 편집기는 이런 데이터에서 목록 전체가 실패하기도 합니다.',
  SEW_UI_DC_NOTE_FIRST_DOC: '첫 문서를 씁니다',
  SEW_UI_DC_NOTE_FIRST_EQP: '첫 설비만 씁니다',
  SEW_UI_DC_NOTE_KEPT: '목록에는 남깁니다',
  SEW_UI_DC_NOTE_CANNOT_OPEN: '이 시나리오는 열 수 없습니다',
  SEW_UI_OCR_AREA_HINT: '보라 = OCR 영역',
  SEW_UI_DETAIL_EMPTY: '스텝을 고르면 여기에 자세한 내용이 보입니다.',
  SEW_UI_CONDITION_NONE_HINT: '조건 없이 바로 동작합니다.',
  SEW_UI_CONDITION_UNKNOWN_HINT: '조건 번호 {op} — 원래 값을 유지합니다.',
  SEW_UI_CONDITION_DETAIL_MISSING: '저장된 조건 값을 해석하지 못했습니다(경고 참고).',
  SEW_UI_CLICK_OUTSIDE: '클릭 지점: 학습 이미지 밖 ({x}, {y})',
  SEW_CMD_APPLIED: '{no}번 스텝을 적용했습니다.',
  SEW_CMD_INSERTED: '{no}번 자리에 스텝을 넣었습니다.',
  SEW_CMD_DELETED: '{nos}번 스텝을 지웠습니다.',
  SEW_CMD_MOVED_UP: '{what} 위로 옮겼습니다.',
  SEW_CMD_MOVED_DOWN: '{what} 아래로 옮겼습니다.',
  SEW_CMD_MOVED: '스텝 {n}개를 옮겼습니다.',
  SEW_CMD_CUT: '스텝 {n}개를 잘라냈습니다. 붙여넣을 자리를 고르세요.',
  SEW_CMD_COPIED: '스텝 {n}개를 복사했습니다.',
  SEW_CMD_PASTED: '스텝 {n}개를 붙여넣었습니다.',
  SEW_CMD_PASTED_UNRESOLVED: '스텝 {n}개를 붙여넣었습니다. 갈 곳을 골라야 하는 곳이 {open}개 있습니다.',
  SEW_CMD_CELL: '{no}번 스텝의 값을 바꿨습니다.',
  SEW_CMD_RENUMBERED: '다른 스텝의 번호 {n}곳이 새 번호를 따라갔습니다.',
  SEW_CMD_UNDONE: '되돌렸습니다.',
  SEW_CMD_REDONE: '다시 했습니다.',
  SEW_CMD_REFUSED_STEP_LIMIT: '시나리오 스텝 제한(200개)을 넘습니다. 시나리오를 나누고 연계하는 방법으로 작성하세요.',
  SEW_CMD_REFUSED_NOT_CONTIGUOUS: '연속한 스텝만 고를 수 있습니다.',
  SEW_CMD_REFUSED_AT_EDGE: '더 옮길 수 없습니다.',
  SEW_CMD_REFUSED_INSIDE_CUT: '잘라낸 범위 안에는 붙여넣을 수 없습니다. 다른 자리를 고르세요.',
  SEW_CMD_BLOCKED_DELETE: '다른 스텝이 이 스텝을 가리키고 있어 지울 수 없습니다. 갈 곳을 먼저 바꾸세요.',
  SEW_CMD_EQP_STATE_WARN: '설비 상태 스텝 {n}개가 들어 있습니다. 새로 만들 수 없는 조건이라 저장할 때 막힙니다.'
}

export const LABELS = {
  condition: { image: '이미지', ocr: 'OCR', none: '조건 없음', eqpState: '설비 상태', unknown: '알 수 없음' },
  action: {
    None: '없음', MouseLeftClick: '마우스 클릭', MouseLeftDoubleClick: '두 번 클릭', MouseRightClick: '오른쪽 클릭', MouseMove: '휠',
    Keyboard: '키보드', Wait: '대기', Variable: '변수', OICommand: 'O.I. Command', FindWindow: '창 찾기', SendEmail: '메일 보내기',
    RunCommand: '명령 실행', CustomScript: '스크립트', FAP: 'FAP', ACS: 'ACS', NativeFunction: '에이전트 함수'
  },
  ocrOp: {
    None: '선택 안 함', TextEqual: '문자 같음', TextNotEqual: '문자 다름', TextContain: '문자 포함', TextNotContain: '문자 미포함',
    NumberEqual: '숫자 같음', NumberNotEqual: '숫자 다름', NumberInRange: '범위 안', NumberOutOfRange: '범위 밖', NumberLessThan: '보다 작음', NumberGreaterThan: '보다 큼'
  },
  scenarioType: {
    NOT_DEFINED: '미지정', ALARM_RECOVERY: '알람자동조치', PM_MACRO: 'PM 매크로', CONDITION_CHECK: '상태 점검', SILENT_DOWN_INFORM: '무알람 다운 알림',
    GLASS_DEFECT: '글라스 불량', SOP_INFORM: 'SOP 안내', FAP: 'FAP', ACCIDENT_PREVENTION: '사고 예방'
  },
  listStatus: { NO_CURRENT_VERSION: '현재 버전 없음', DUPLICATE_PROPERTY: '같은 키 2건', PARSE_FAILED: '해석 실패' },
  eqpTarget: { main: 'MAIN', chamber: '챔버', loadport: '로드포트', unknown: '알 수 없음' },
  invalidReason: { REQUIRED_MISSING: '필수 필드 없음', WRONG_EMAIL_CATEGORY: '메일 분류 형식 오류(4토큰 아님)', REQUIRED_EMPTY: '필수 필드 빈 값' },
  enabled: { true: '켜짐', false: '꺼짐', unknown: '?' },
  matchMode: { partial: '부분 일치', exact: '정확 일치' },
  skipPreprocessing: { na: '해당 없음', yes: '예 (숨길 창 옮기기 건너뜀)', no: '아니오' },
  flowChip: { lastNext: 'NEXT (다음 없음)', self: '↺ 자기 자신' },
  clickBasis: { trainImage: '학습 이미지 왼쪽 위', screenOrigin: '실행 때 저장 좌표와 상관없이 화면 왼쪽 위(0,0)를 누릅니다', unknown: '이 조건에서는 클릭 기준을 알 수 없습니다' }
}

export function t(key, params = {}) {
  const v = MESSAGES[key]
  if (v === undefined) return `[${key}]`
  return v.replace(/\{(\w+)\}/g, (_, k) => (params[k] !== undefined ? String(params[k]) : `{${k}}`))
}

const ERROR_KEYS = { USER_NOT_REGISTERED: 'Exception12' }

export function errorCode(err) {
  const code = err?.response?.data?.code
  if (code) return code
  if (err?.code === 'ECONNABORTED') return 'TIMEOUT'
  if (err?.response) return 'UNKNOWN'
  if (err?.request) return 'NETWORK'
  return 'UNKNOWN'
}

export function errorMessage(err) {
  const code = errorCode(err)
  return t(ERROR_KEYS[code] ?? `SEW_ERR_${code}`)
}

// 경고·알림 문구. params.field 가 있으면 그 field 의 문구(예: SEW_NOTE_PARSE_FAILED_bi)를 먼저 찾고, 없으면 코드 공통 문구.
export function noteMessage(note) {
  const params = note.params || {}
  const specific = typeof params.field === 'string' ? `SEW_NOTE_${note.code}_${params.field}` : null
  return t(specific && MESSAGES[specific] !== undefined ? specific : `SEW_NOTE_${note.code}`, params)
}

'use strict'

// 쓰기·심의 문의 순수 판단(설계 §3). 거절이면 { status, code, message }, 통과면 null.
const REVIEWER_LEVELS = [1, 2] // 관리 등급 1(Unlimited)·2(Conductor)

const denial = (code, message) => ({ status: 403, code, message })
const DISABLED = () => denial('WRITE_DISABLED', '이 서버는 쓰기를 받지 않습니다(루프백이 아닌 주소에서 실행 중)')

function writeDenial(user, { writeDisabled }) {
  if (writeDisabled) return DISABLED()
  if (!user.canWrite) return denial('WRITE_FORBIDDEN', 'WRITE 권한이 없습니다')
  return null
}

// 심의·성과는 WRITE 를 보지 않는다.
function reviewDenial(user, { writeDisabled }) {
  if (writeDisabled) return DISABLED()
  if (!REVIEWER_LEVELS.includes(user.authorityManager)) return denial('GRADE_FORBIDDEN', '관리 등급 1·2 만 할 수 있습니다')
  return null
}

// 스냅샷 메모는 WRITE·등급을 보지 않는다 — 그 설비의 스냅샷을 볼 수 있으면 쓴다(P3 설계 §4.4, 사내와 같다). 설비 범위는 서비스가 본다.
function memoDenial(user, { writeDisabled }) {
  return writeDisabled ? DISABLED() : null
}

// 시험 실행의 문(P5 설계 §5.2) — 실제 설비를 움직이는 일이라 쓰기로 본다. flags 는 요청마다 설정에서 읽는다(domain/testRun.testRunFlags).
// 순서대로 처음 걸리는 것을 준다: 같은 아이디의 사용자 문서가 여럿 → 서버에서 꺼 둠 → 읽기 전용 서버 → 사용자 바꾸기가 켜진 서버 → WRITE 없음.
// 사용자 바꾸기(SE_DEV_USER_OVERRIDE)는 헤더 하나로 다른 사람의 이름이 되는 개발용 기능이다 — EARS 가 이 PC 밖이면 그 이름으로 실제 설비에 실행되지 않게 막는다.
function testRunDenial(user, { writeDisabled, enabled, devOverride, earsLoopback }) {
  if (user.duplicateUserDocs > 1) return denial('TEST_RUN_USER_AMBIGUOUS', '같은 아이디의 사용자 문서가 여럿이라 시험 실행을 할 수 없습니다')
  if (!enabled) return denial('TEST_RUN_DISABLED', '이 서버는 시험 실행을 꺼 두었습니다')
  if (writeDisabled) return DISABLED()
  if (devOverride && !earsLoopback) return denial('TEST_RUN_DEV_USER', '개발용 사용자 바꾸기가 켜진 서버에서는 시험 실행을 할 수 없습니다')
  if (!user.canWrite) return denial('WRITE_FORBIDDEN', 'WRITE 권한이 없습니다')
  return null
}

// 새 대상 저장 때 성과를 복사하는가(13 §2.6 표): 등급 0·3 은 복사하지 않는다.
function copiesPerformanceToNewTarget(user) {
  return user.authorityManager !== 0 && user.authorityManager !== 3
}

module.exports = { writeDenial, reviewDenial, memoDenial, testRunDenial, copiesPerformanceToNewTarget, REVIEWER_LEVELS }

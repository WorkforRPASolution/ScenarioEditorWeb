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

// 새 대상 저장 때 성과를 복사하는가(13 §2.6 표): 등급 0·3 은 복사하지 않는다.
function copiesPerformanceToNewTarget(user) {
  return user.authorityManager !== 0 && user.authorityManager !== 3
}

module.exports = { writeDenial, reviewDenial, copiesPerformanceToNewTarget, REVIEWER_LEVELS }

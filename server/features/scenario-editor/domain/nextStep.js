'use strict'
const { NEXT_STEP } = require('./enums')

// 저장된 다음 스텝 번호를 화면 모델의 대상으로 바꾼다. NEXT 는 번호로 풀지 않는다(Vision 서버가 해석, 사내 기본값).
function toTarget(value, uids) {
  if (value === NEXT_STEP.FAIL) return { kind: 'end', value: 'FAIL' }
  if (value === NEXT_STEP.SUCCESS) return { kind: 'end', value: 'SUCCESS' }
  if (value === NEXT_STEP.SKIP) return { kind: 'end', value: 'SKIP' }
  if (value === NEXT_STEP.NEXT) return { kind: 'next' }
  if (Number.isInteger(value) && value >= 0 && value < uids.length) return { kind: 'step', uid: uids[value], no: value + 1 }
  return { kind: 'raw', value }
}

module.exports = { toTarget }

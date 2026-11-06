'use strict'
const { NEXT_STEP } = require('./enums')

// 저장된 다음 스텝 번호를 화면 모델의 대상으로 바꾼다. NEXT 는 번호로 풀지 않는다(Vision 서버가 해석, 사내 기본값).
function toTarget(value, uids) {
  const list = Array.isArray(uids) ? uids : []
  if (value === NEXT_STEP.FAIL) return { kind: 'end', value: 'FAIL' }
  if (value === NEXT_STEP.SUCCESS) return { kind: 'end', value: 'SUCCESS' }
  if (value === NEXT_STEP.SKIP) return { kind: 'end', value: 'SKIP' }
  if (value === NEXT_STEP.NEXT) return { kind: 'next' }
  if (Number.isInteger(value) && value >= 0 && value < list.length) return { kind: 'step', uid: list[value], no: value + 1 }
  return { kind: 'raw', value }
}

const END_VALUES = { FAIL: NEXT_STEP.FAIL, SUCCESS: NEXT_STEP.SUCCESS, SKIP: NEXT_STEP.SKIP }

// 화면 모델의 대상을 저장 번호로 되돌린다(조립). raw 는 저장값 그대로(범위 밖 번호도 — 막는 것은 검사).
// 풀 수 없는 대상(unresolved·없는 uid)은 검사 NEXT_UNRESOLVED 가 먼저 막으므로 여기까지 오면 프로그램 오류다.
function fromTarget(target, indexOfUid) {
  const kind = target && target.kind
  if (kind === 'end' && Object.prototype.hasOwnProperty.call(END_VALUES, target.value)) return END_VALUES[target.value]
  if (kind === 'next') return NEXT_STEP.NEXT
  if (kind === 'step' && indexOfUid.has(target.uid)) return indexOfUid.get(target.uid)
  if (kind === 'raw') return target.value
  throw new Error('UNRESOLVED_TARGET')
}

module.exports = { toTarget, fromTarget }

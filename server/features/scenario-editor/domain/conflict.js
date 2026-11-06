'use strict'
// 저장 직전 충돌 판단(설계 §6.3·§6.6). 같은 시나리오를 덮어쓸 때만 본다.
const { lastOwner } = require('./propertyModel')

function detectConflict({ sameScenario, docExists, headCrtime, currentCrtime, propertyRev, currentPropertyRev, owners }) {
  if (!sameScenario) return null
  // 새 시나리오(headCrtime === null)는 문서가 있어도 deleted 가 아니라 TARGET_EXISTS 쪽이다.
  if (headCrtime === null || headCrtime === undefined) return null
  if (!docExists) return { kind: 'deleted' }
  if (currentCrtime !== headCrtime) {
    const last = lastOwner(owners)
    return { kind: 'newVersion', by: last ? last.singleid : null, at: last ? last.at : null }
  }
  if (currentPropertyRev !== propertyRev) return { kind: 'property' }
  return null
}

const PROPERTY_DIFF_KEYS = ['IsEnabled', 'NextScenarioIfSuccess', 'NextScenarioIfFail', 'Type', 'StartDelay']

function propertyDiff(current, working) {
  const out = []
  for (const key of PROPERTY_DIFF_KEYS) {
    const from = current?.[key]
    const to = working?.[key]
    if (from !== to) out.push({ key, from, to })
  }
  return out
}

module.exports = { detectConflict, PROPERTY_DIFF_KEYS, propertyDiff }

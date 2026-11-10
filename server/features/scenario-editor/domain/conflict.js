'use strict'
// 저장 직전 충돌 판단(설계 §6.3·§6.6). 같은 시나리오를 덮어쓸 때만 본다.
const { lastOwner, propertyFromBson } = require('./propertyModel')
const { withCsDefaults } = require('./csDefaults')
const { SCHEMAS } = require('./csharpJson')

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k)

function detectConflict({ sameScenario, docExists, headCrtime, currentCrtime, propertyRev, currentPropertyRev, owners }) {
  if (!sameScenario) return null
  // 새 시나리오는 원본이 없어 호출 쪽이 sameScenario=false 로 넘긴다(문서가 있으면 TARGET_EXISTS 쪽).
  // headCrtime null 은 현재 판 없이 연 기존 시나리오일 수도 있으니 그대로 비교한다(null 대 숫자도 newVersion).
  if (!docExists) return { kind: 'deleted' }
  if (currentCrtime !== headCrtime) {
    const last = lastOwner(owners)
    return { kind: 'newVersion', by: last ? last.singleid : null, at: last ? last.at : null }
  }
  if (currentPropertyRev !== propertyRev) return { kind: 'property' }
  return null
}

const PROPERTY_DIFF_KEYS = ['IsEnabled', 'NextScenarioIfSuccess', 'NextScenarioIfFail', 'Type', 'StartDelay']
// 운영 속성 충돌 확인에 보일 차이는 전부를 본다 — 배포는 운영 속성을 통째로 바꾼다(InterfaceServer $set property).
// ID 는 대상이 정하고 Owners 는 배포가 지금 문서의 것에 한 줄을 잇는다.
const PROPERTY_ALL_KEYS = SCHEMAS.ScenarioProperty.map(([key]) => key).filter((key) => key !== 'ID' && key !== 'Owners')

const FOLLOW_KEYS = new Set(['NextScenarioIfSuccess', 'NextScenarioIfFail'])

// 후속 시나리오는 {Name, Text} 두 칸만 본다(직렬화도 두 칸만 쓴다). 설명 null 은 조립이 "" 로 보내므로(§6.8) "" 로 맞춘다.
function comparable(key, v) {
  if (!FOLLOW_KEYS.has(key) || !isObject(v)) return v
  return { Name: v.Name === undefined ? '' : v.Name, Text: v.Text === undefined || v.Text === null ? '' : v.Text }
}

// 지금 문서 값 — 열기와 같은 해석(propertyFromBson). 칸마다 따로 풀어 다른 칸이 깨져도 이 칸은 본다.
// 풀 수 없는 칸은 저장값 그대로, property 가 문서가 아니면 null(모름).
function currentValue(current, key) {
  if (!isObject(current)) return null
  const r = propertyFromBson(has(current, key) ? { [key]: current[key] } : {})
  return r.ok ? r.value[key] : (current[key] ?? null)
}

const same = (a, b) => {
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => same(x, b[i]))
  if (isObject(a) && isObject(b)) {
    const ka = Object.keys(a)
    return ka.length === Object.keys(b).length && ka.every((k) => has(b, k) && same(a[k], b[k]))
  }
  return Object.is(a, b)
}

// 이미 있는 대상을 덮을 때 바뀌는 운영 속성(§6.6). 보낼 값은 조립과 같은 채움(withCsDefaults — 빠진 키는 C# 기본값)으로,
// 지금 값은 열기와 같은 해석으로 맞춘 뒤 값으로 비교한다. from·to 도 맞춘 값이고 undefined 가 없다(JSON 에서 사라지지 않게).
function propertyDiff(current, working, keys = PROPERTY_DIFF_KEYS) {
  const w = withCsDefaults('ScenarioProperty', isObject(working) ? working : {})
  const out = []
  for (const key of keys) {
    const from = comparable(key, currentValue(current, key)) ?? null
    const to = comparable(key, w[key]) ?? null
    if (!same(from, to)) out.push({ key, from, to })
  }
  return out
}

module.exports = { detectConflict, PROPERTY_DIFF_KEYS, PROPERTY_ALL_KEYS, propertyDiff }

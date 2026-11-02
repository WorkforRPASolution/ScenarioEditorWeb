'use strict'
// C# ScenarioProperty(BsonDocument) 생성자(ScenarioProperty.cs:105-137) 규칙. 조사 §5(MongoDB.Bson 2.7.3 실측).
const { SCHEMAS } = require('./csharpJson')

const DEFAULTS = {
  ID: '', Owners: [], ScenarioTriggerType: 0, DoNotSendEmailWhenSuccess: false, DoNotSendEmailWhenStop: false,
  DoNotSendEmailWhenFail: false, StartDelay: 0, RetryCnt: 0, RetryInterval: 10, NextScenarioIfSuccess: null,
  NextScenarioIfFail: null, Type: 0, DetailedDescriptionTitle: '', DetailedDescription: '', DescriptionFromConductor: '',
  EDMLink: '', IsEnabled: true, ExecutingLevel: 0, IsShowDialog: true, Priority: 10, LcncType: 0, LowcodeExtension: ''
}
const isLong = (v) => v && typeof v === 'object' && typeof v.toNumber === 'function'

function csString(v) {
  if (v === null) return 'BsonNull'
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (isLong(v)) return String(v.toNumber())
  return JSON.stringify(v)
}
function csInt(v, key) {
  if (v === null) throw new Error(`${key}: BsonNull does not support ToInt32`)
  if (typeof v === 'number') return Math.trunc(v) | 0
  if (isLong(v)) return v.toNumber() | 0
  if (typeof v === 'string' && /^-?\d+$/.test(v)) return Number(v) | 0
  if (typeof v === 'boolean') return v ? 1 : 0
  throw new Error(`${key}: ToInt32 불가 (${typeof v})`)
}
function csBool(v) {
  if (v === null) return false
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  if (isLong(v)) return v.toNumber() !== 0
  if (typeof v === 'string') return v !== ''
  return true
}
function nextScenario(v, key) {
  if (v === undefined || v === null) return null
  if (typeof v !== 'object' || Array.isArray(v)) throw new Error(`${key}: 문서가 아님`)
  const f = (k) => (k in v ? (v[k] === null ? null : csString(v[k])) : '')
  return { Name: f('Name'), Text: f('Text') }
}

// 없음(undefined)은 C# 기본값으로 연다(뼈대를 만들 때 {} 를 넘기는 것과 같다). 그 밖에 문서(배열 아닌 객체)가 아닌 값은
// 기본값으로 꾸미지 않고 실패로 돌려 목록·바가 거짓 "켜짐" 을 보이지 않게 한다.
function propertyFromBson(doc) {
  if (doc !== undefined && (doc === null || typeof doc !== 'object' || Array.isArray(doc))) {
    return { ok: false, error: `운영 속성이 문서가 아님 (${doc === null ? 'null' : Array.isArray(doc) ? 'array' : typeof doc})` }
  }
  try {
    const p = doc || {}
    const has = (k) => Object.prototype.hasOwnProperty.call(p, k)
    const value = {}
    for (const [key, type] of SCHEMAS.ScenarioProperty) {
      if (key === 'Owners') {
        if (!has(key)) value[key] = []
        else if (!Array.isArray(p[key])) throw new Error('Owners: 배열이 아님')
        else value[key] = p[key].map(csString)
      } else if (key === 'NextScenarioIfSuccess' || key === 'NextScenarioIfFail') {
        value[key] = nextScenario(has(key) ? p[key] : undefined, key)
      } else if (!has(key)) {
        value[key] = Array.isArray(DEFAULTS[key]) ? [] : DEFAULTS[key]
      } else if (type === 'string') value[key] = csString(p[key])
      else if (type === 'bool') value[key] = csBool(p[key])
      else value[key] = csInt(p[key], key)
    }
    return { ok: true, value }
  } catch (error) {
    return { ok: false, error: error.message }
  }
}

function lastOwner(owners) {
  if (!Array.isArray(owners) || owners.length === 0) return null
  const [singleid, at = null, ...rest] = String(owners[owners.length - 1]).split('@')
  return { singleid, at, note: rest.length ? rest.join('@') : null }
}

module.exports = { DEFAULTS, propertyFromBson, lastOwner }

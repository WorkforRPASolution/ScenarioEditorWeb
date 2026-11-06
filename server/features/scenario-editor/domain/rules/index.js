'use strict'
// 배포 전·저장 창 검사. 사내 저장 검사·참조 무결성은 늘 막고, 웹이 더한 값 검사는 고친 스텝만 막는다(옛 값은 보존하므로 경고).
const { changedStepUids } = require('../changeDetect')
const { RULES } = require('./codes')
const { scenarioRules } = require('./scenarioRules')
const { stepRules } = require('./stepRules')
const { checkProperty } = require('./propertyRules')

function checkScenario(edited, source, ctx) {
  const changed = changedStepUids(edited, source)
  const position = new Map(edited.steps.map((s, i) => [s.uid, i]))
  const rank = (i) => (i.uid === undefined ? -1 : position.has(i.uid) ? position.get(i.uid) : Number.MAX_SAFE_INTEGER)
  const seen = new Set()
  const all = [...scenarioRules(edited, source, ctx), ...stepRules(edited, source, ctx), ...checkProperty(edited.property, source ? source.property ?? {} : null)].filter((i) => {
    const k = `${i.code}\u0000${i.uid ?? ''}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  all.sort((a, b) => rank(a) - rank(b) || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
  const blocks = []
  const warns = []
  for (const i of all) {
    const rule = RULES[i.code]
    if (rule.level === 'warn') warns.push(i)
    else if (rule.scope === 'special') (i.params && i.params.grew ? blocks : warns).push(i)
    else if (rule.scope === 'changed' && i.uid !== undefined && !changed.has(i.uid)) warns.push(i)
    else blocks.push(i)
  }
  return { blocks, warns }
}

module.exports = { checkScenario, RULES }

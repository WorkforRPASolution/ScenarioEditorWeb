'use strict'
// 성과 정보(SC_PROPERTY.performance). 사본 이름(EqpPerformanceLoss·GlassLoss)과 WebManager 가 읽는 이름(EqpPerfornmanceLoss·WaferLoss)을 둘 다 읽는다(Q-009).
const { TRIGGER_NAMES, GRADE_NAMES, PERFORM_TYPE_NAMES, ACCIDENT_TYPE_NAMES, NOT_ENTERED, nameOf } = require('./enums')

const isLong = (v) => v && typeof v === 'object' && typeof v.toNumber === 'function'
const int = (v) => (typeof v === 'number' ? Math.trunc(v) : isLong(v) ? v.toNumber() : 0)
const str = (v) => (typeof v === 'string' ? v : '')

function performanceFromBson(doc) {
  if (!doc || typeof doc !== 'object') return null
  const pick = (a, b) => (a in doc ? doc[a] : doc[b])
  const supervisor = typeof doc.Supervisor === 'string' ? doc.Supervisor : NOT_ENTERED
  const trigger = int(doc.Trigger)
  const grade = int(doc.Grade)
  const performType = int(doc.PerformType)
  const accidentType = int(doc.AccidentType)
  return {
    group: doc.Group === undefined || doc.Group === null ? '' : String(doc.Group).toUpperCase(),
    trigger, triggerName: nameOf(TRIGGER_NAMES, trigger),
    triggerInfo: typeof doc.TriggerInfo === 'string' ? doc.TriggerInfo : null,
    grade, gradeName: nameOf(GRADE_NAMES, grade),
    supervisor, supervisorNotEntered: supervisor === NOT_ENTERED,
    supervisorComment: str(doc.SupervisorComment),
    citizenDevelopers: Array.isArray(doc.CitizenDeveloper)
      ? doc.CitizenDeveloper.map((c) => ({ knoxId: str(c && c.KnoxId), sdwt: str(c && c.Sdwt), name: str(c && c.Name), contribution: int(c && c.Contribution) }))
      : null,
    performType, performTypeName: nameOf(PERFORM_TYPE_NAMES, performType),
    scenarioDescription: str(doc.ScenarioDescription),
    manWorkLoss: int(doc.ManWorkLoss),
    eqpPerformanceLoss: int(pick('EqpPerformanceLoss', 'EqpPerfornmanceLoss')),
    eqpStopLoss: int(doc.EqpStopLoss),
    glassLoss: int(pick('GlassLoss', 'WaferLoss')),
    investCostLoss: int(doc.InvestCostLoss),
    additionalEffect: str(doc.AdditionalEffect),
    accidentType, accidentTypeName: nameOf(ACCIDENT_TYPE_NAMES, accidentType),
    accidentInfo: str(doc.AccidentInfo),
    updateDate: str(doc.UpdateDate),
    rawKeys: Object.keys(doc)
  }
}

module.exports = { performanceFromBson }

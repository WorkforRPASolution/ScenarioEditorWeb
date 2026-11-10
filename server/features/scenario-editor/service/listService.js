'use strict'
// 사내 목록 = SC_PROPERTY 의 property 있는 문서(같은 이름은 첫 문서), 이름순(10 §1.4).
// 웹: 문서 하나가 해석에 실패해도 그 행만 상태 표시(사내는 목록 전체 실패).
const { currentVersions } = require('../domain/versionPick')
const { propertyFromBson, lastOwner } = require('../domain/propertyModel')
const { performanceFromBson } = require('../domain/performanceModel')
const { SCENARIO_TYPE_NAMES, nameOf } = require('../domain/enums')

function createListService({ repo, hash, scopes }) {
  return {
    async list(user, process, model) {
      await scopes.assertAllowed(user, process, model)
      const [docs, fields] = await Promise.all([repo.findScenarioDocs(process, model), hash.hkeys(`${process}-${model}`)])
      const current = currentVersions(fields)
      const countByName = new Map()
      for (const d of docs) countByName.set(d.scname, (countByName.get(d.scname) || 0) + 1)
      const first = new Map()
      for (const d of docs) if (typeof d.scname === 'string' && 'property' in d && !first.has(d.scname)) first.set(d.scname, d)
      const rows = [...first.values()].map((d) => {
        const prop = propertyFromBson(d.property)
        const perf = performanceFromBson(d.performance)
        const status = []
        if (!current.has(d.scname)) status.push('NO_CURRENT_VERSION')
        if (countByName.get(d.scname) > 1) status.push('DUPLICATE_PROPERTY')
        if (!prop.ok) status.push('PARSE_FAILED')
        const p = prop.ok ? prop.value : null
        return {
          name: d.scname, id: `${process}-${model}-${d.scname}`,
          isEnabled: p ? p.IsEnabled : null, type: p ? p.Type : null, typeName: p ? nameOf(SCENARIO_TYPE_NAMES, p.Type) : null,
          trigger: perf ? perf.trigger : null, triggerName: perf ? perf.triggerName : null,
          grade: perf ? perf.grade : null, gradeName: perf ? perf.gradeName : null,
          description: perf ? perf.scenarioDescription : '',
          // 데스크톱 목록의 EMAIL_SKIP·DELAY·RETRY·TRIGGERINFO(10 §1.4). 글은 화면이 만든다. 운영 속성을 못 풀면 null
          emailSkip: p ? [['success', p.DoNotSendEmailWhenSuccess], ['fail', p.DoNotSendEmailWhenFail], ['stop', p.DoNotSendEmailWhenStop]].filter(([, off]) => off === true).map(([k]) => k) : null,
          startDelay: p ? p.StartDelay : null, retryCnt: p ? p.RetryCnt : null, retryInterval: p ? p.RetryInterval : null,
          triggerInfo: perf ? perf.triggerInfo : null,
          lastOwner: p ? lastOwner(p.Owners) : null,
          currentCrtime: current.get(d.scname) ?? null,
          status
        }
      })
      return rows.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    }
  }
}

module.exports = { createListService }

'use strict'
// EARS 읽기 전용(P1). 쓰기 함수는 P2 에서 이 파일에만 더한다(공통 설계 §3.3).
const { withMongoErrors } = require('../errors')

const MAX = 20000

function createEarsRepository(getDb) {
  const col = (name) => getDb().collection(name)
  return withMongoErrors({
    findUsers: (singleid) => col('ARS_USER_INFO').find({ singleid }, { projection: { password: 0 } }).maxTimeMS(MAX).toArray(),
    findAgents: () => col('AGENT_INFO').find({ arsagentJava: 1 }, { projection: { _id: 0, eqpId: 1 } }).maxTimeMS(MAX).toArray(),
    findEquipment: () => col('EQP_INFO').find({ webmanagerUse: 1 }, { projection: { _id: 0 } }).maxTimeMS(MAX).toArray(),
    findScenarioDocs: (process, model) => col('SC_PROPERTY')
      .find({ process, eqpModel: model }, { projection: { _id: 0, scname: 1, property: 1, performance: 1 } }).maxTimeMS(MAX).toArray(),
    findScenarioKeyDocs: (process, model, name) => col('SC_PROPERTY')
      .find({ process, eqpModel: model, scname: name }, { projection: { _id: 0 } }).maxTimeMS(MAX).toArray(),
    findDuplicateKeys: async (pairs) => {
      if (!pairs.length) return []
      const rows = await col('SC_PROPERTY').aggregate([
        { $match: { $or: pairs.map((p) => ({ process: p.process, eqpModel: p.model })) } },
        { $group: { _id: { process: '$process', model: '$eqpModel', name: '$scname' }, count: { $sum: 1 } } },
        { $match: { count: { $gt: 1 } } },
        { $sort: { '_id.process': 1, '_id.model': 1, '_id.name': 1 } }
      ], { maxTimeMS: MAX }).toArray()
      return rows.map((r) => ({ process: r._id.process, model: r._id.model, name: r._id.name, count: r.count }))
    }
  })
}

module.exports = { createEarsRepository }

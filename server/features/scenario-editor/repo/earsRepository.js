'use strict'
// EARS 읽기 + 쓰기(공통 설계 §3.3). 운영 데이터 쓰기 필드는 이 파일에만 둔다.
// 쓰는 필드(SC_PROPERTY): scCategory·trCategory(Int64), property.Owners, property.IsEnabled,
// performance(새 대상은 전체, 심의·성과 수정은 performance.* 필드). 본문·BI·property 전체는 setscenario 로만 쓴다.
const { withMongoErrors } = require('../errors')

const MAX = 20000

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// mongo = mongoose.mongo (Long 용). scCategory·trCategory 는 사내 C# 이 Int64 로 쓴다.
function createEarsRepository(getDb, mongo) {
  const col = (name) => getDb().collection(name)
  const keyFilter = (k) => ({ process: k.process, eqpModel: k.model, scname: k.name, property: { $exists: true } })
  const setFields = async (key, $set) => {
    const r = await col('SC_PROPERTY').updateOne(keyFilter(key), { $set }, { maxTimeMS: MAX })
    return { matched: r.matchedCount }
  }
  // 심의·성과 쓰기는 performance.* 필드만 — 다른 키가 오면 프로그램 오류로 던지고 아무것도 쓰지 않는다
  const performanceOnly = (fields) => {
    const bad = Object.keys(fields).filter((k) => !k.startsWith('performance.'))
    if (bad.length) throw new Error(`performance. 로 시작하지 않는 필드: ${bad.join(', ')}`)
    return { ...fields }
  }
  return withMongoErrors({
    findUsers: (singleid) => col('ARS_USER_INFO').find({ singleid }, { projection: { password: 0 } }).maxTimeMS(MAX).toArray(),
    findAgents: () => col('AGENT_INFO').find({ arsagentJava: 1 }, { projection: { _id: 0, eqpId: 1 } }).maxTimeMS(MAX).toArray(),
    findEquipment: () => col('EQP_INFO').find({ webmanagerUse: 1 }, { projection: { _id: 0 } }).maxTimeMS(MAX).toArray(),
    findScenarioDocs: (process, model) => col('SC_PROPERTY')
      .find({ process, eqpModel: model }, { projection: { _id: 0, scname: 1, property: 1, performance: 1 } }).maxTimeMS(MAX).toArray(),
    findScenarioKeyDocs: (process, model, name) => col('SC_PROPERTY')
      .find({ process, eqpModel: model, scname: name }, { projection: { _id: 0 } }).maxTimeMS(MAX).toArray(),
    // Int64(Long)를 숫자로 올리지 않고 읽는다 — 읽은 값을 그대로 다시 쓸 때 Int64 가 Int32·Double 로 바뀌지 않게(성과 복사·기여자 형 유지).
    findPerformanceRaw: async (key) => {
      const docs = await col('SC_PROPERTY').find(keyFilter(key), { promoteLongs: false, projection: { _id: 0, performance: 1 } }).maxTimeMS(MAX).toArray()
      const p = docs.length ? docs[0].performance : null
      return p && typeof p === 'object' ? p : null
    },
    findDuplicateKeys: async (pairs) => {
      if (!pairs.length) return []
      const rows = await col('SC_PROPERTY').aggregate([
        { $match: { $or: pairs.map((p) => ({ process: p.process, eqpModel: p.model })) } },
        { $group: { _id: { process: '$process', model: '$eqpModel', name: '$scname' }, count: { $sum: 1 } } },
        { $match: { count: { $gt: 1 } } },
        { $sort: { '_id.process': 1, '_id.model': 1, '_id.name': 1 } }
      ], { maxTimeMS: MAX }).toArray()
      return rows.map((r) => ({ process: r._id.process, model: r._id.model, name: r._id.name, count: r.count }))
    },
    finishDeploy: (key, { scCategory, owners, performance }) => {
      const $set = { scCategory: mongo.Long.fromNumber(scCategory), trCategory: mongo.Long.fromNumber(0), 'property.Owners': owners }
      if (performance && typeof performance === 'object') $set.performance = performance
      return setFields(key, $set)
    },
    setEnabled: (key, { enabled, owners }) => setFields(key, { 'property.IsEnabled': enabled, 'property.Owners': owners }),
    setReview: (key, fields) => setFields(key, performanceOnly(fields)),
    setPerformanceFields: (key, fields) => setFields(key, performanceOnly(fields)),
    countPropertyDocs: (key) => col('SC_PROPERTY').countDocuments(keyFilter(key), { maxTimeMS: MAX }),
    searchUsers: (q) => {
      const rx = { $regex: escapeRegex(q), $options: 'i' }
      return col('ARS_USER_INFO')
        .find({ $or: [{ singleid: rx }, { name: rx }] }, { projection: { _id: 0, singleid: 1, name: 1, process: 1 } })
        .limit(20).maxTimeMS(MAX).toArray()
    },
    findSameNameModels: async (process, name) => {
      const models = await col('SC_PROPERTY').distinct('eqpModel', { process, scname: name, property: { $exists: true } }, { maxTimeMS: MAX })
      return [...models].sort()
    },
    hasNameRule: async () => (await getDb().listCollections({ name: 'SC_NAME_RULE' }, { nameOnly: true }).toArray()).length > 0,
    findNameRule: () => col('SC_NAME_RULE').find({}, { projection: { _id: 0 } }).maxTimeMS(MAX).toArray()
  })
}

module.exports = { createEarsRepository }

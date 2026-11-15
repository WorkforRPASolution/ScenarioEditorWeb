'use strict'
// EARS 읽기 + 쓰기(공통 설계 §3.3). 운영 데이터 쓰기 필드는 이 파일에만 둔다.
// 쓰는 필드(SC_PROPERTY): scCategory·trCategory(Int64), property.Owners, property.IsEnabled,
// performance(새 대상은 전체, 심의·성과 수정은 performance.* 필드). 본문·BI·property 전체는 setscenario 로만 쓴다.
// 쓰는 문서(ARS_USER_MEMO): 새 메모(일곱 필드)·memo·webEditedBy·webEditedAt, 지우기.
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
    // 불러오기 창의 공정·모델 옆 시나리오 수(2026-11-11). 세는 기준은 목록(listService)과 같다 — property 있는 문서, 같은 이름은 한 번.
    // 문서를 가져오지 않고 DB 안에서 센다 → [{ process, model, count }]
    countScenarios: async (processes) => {
      if (!processes.length) return []
      const rows = await col('SC_PROPERTY').aggregate([
        { $match: { process: { $in: processes }, property: { $exists: true }, scname: { $type: 'string' } } },
        { $group: { _id: { process: '$process', model: '$eqpModel', name: '$scname' } } },
        { $group: { _id: { process: '$_id.process', model: '$_id.model' }, count: { $sum: 1 } } }
      ], { maxTimeMS: MAX }).toArray()
      return rows.map((r) => ({ process: r._id.process, model: r._id.model, count: r.count }))
    },
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
    // ── 스냅샷 메모(P3 설계 §5.5) ── 데스크톱 편집기와 함께 쓰는 컬렉션이다. 키는 (eqpid, filename)이고 유일 인덱스가 없다.
    // 파일 이름이 13자리 ms 로 시작해 글자 범위가 곧 시각 범위다(메모는 지워지지 않고 쌓이므로 범위로 자른다).
    findMemos: ({ eqpId, fromName, toName }, limit) => {
      const filename = toName === undefined ? { $gte: fromName } : { $gte: fromName, $lt: toName }
      // 이름 내림차순 — 한도에서 잘릴 때 늦은 스냅샷의 메모가 남는다
      return col('ARS_USER_MEMO').find(eqpId === undefined ? { filename } : { eqpid: eqpId, filename }).sort({ filename: -1 }).limit(limit).maxTimeMS(MAX).toArray()
    },
    findMemosByKey: (eqpId, fileName) => col('ARS_USER_MEMO').find({ eqpid: eqpId, filename: fileName }).maxTimeMS(MAX).toArray(),
    // 같은 키 문서가 없을 때만 넣는다 — 찾고 넣기를 한 번에(유일 인덱스가 없어 동시에 둘이 넣는 것을 완전히 막지는 못한다)
    insertMemoIfAbsent: async (doc) => {
      const r = await col('ARS_USER_MEMO').updateOne({ eqpid: doc.eqpid, filename: doc.filename }, { $setOnInsert: doc }, { upsert: true, maxTimeMS: MAX })
      return { inserted: r.upsertedCount === 1 }
    },
    // 본 글(expect)이 그대로일 때만 글과 웹 전용 필드 둘을 바꾼다. singleid·snapshotTimestamp·process·hiddensnapshot 은 그대로 둔다(사내와 같다).
    updateMemoText: async (id, expect, { memo, webEditedBy, webEditedAt }) => {
      const r = await col('ARS_USER_MEMO').updateOne({ _id: id, memo: expect }, { $set: { memo, webEditedBy, webEditedAt } }, { maxTimeMS: MAX })
      return { matched: r.matchedCount }
    },
    // 본 글이 그대로인 그 문서 하나만 지운다. process 를 조건에 넣지 않는다(설비 공정이 바뀌면 사내에서는 지워지지 않는다 — DC-081).
    deleteMemo: async (id, expect) => {
      const r = await col('ARS_USER_MEMO').deleteOne({ _id: id, memo: expect }, { maxTimeMS: MAX })
      return { deleted: r.deletedCount }
    },
    findUserNames: (singleids) => (singleids.length
      ? col('ARS_USER_INFO').find({ singleid: { $in: singleids } }, { projection: { _id: 0, singleid: 1, name: 1 } }).maxTimeMS(MAX).toArray()
      : Promise.resolve([])),
    hasNameRule: async () => (await getDb().listCollections({ name: 'SC_NAME_RULE' }, { nameOnly: true }).toArray()).length > 0,
    findNameRule: () => col('SC_NAME_RULE').find({}, { projection: { _id: 0 } }).maxTimeMS(MAX).toArray()
  })
}

module.exports = { createEarsRepository }

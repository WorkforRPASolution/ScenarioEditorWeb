'use strict'
// EARS 읽기 + 쓰기(공통 설계 §3.3). 운영 데이터 쓰기 필드는 이 파일에만 둔다.
// 쓰는 필드(SC_PROPERTY): scCategory·trCategory(Int64), property.Owners, property.IsEnabled,
// performance(새 대상은 전체, 심의·성과 수정은 performance.* 필드). 본문·BI·property 전체는 setscenario 로만 쓴다.
// 쓰는 문서(ARS_USER_MEMO): 새 메모(일곱 필드)·memo·webEditedBy·webEditedAt, 지우기.
// 시험 실행(P5)은 읽기만 한다 — 실행 기록(EQP_AUTO_RECOVERY)은 CommandServer 가 쓴다.
const { withMongoErrors } = require('../errors')

const MAX = 20000
// 시험 실행 요청 안의 읽기 — 설비 한 대의 요청이 오래 걸리지 않게 짧게 둔다(P5 설계 §5.2)
const RUN_MAX = 5000
const RECOVERY_FIELDS = { _id: 0, eqpid: 1, txn_seq: 1, ears_code: 1, trigger_by: 1, status: 1, retry: 1, create_date: 1, params: 1 }
const RECOVERY_LIMIT = 1000

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
    // maxTimeMs = 기다릴 시간(하루 목록에 붙일 때는 짧게 — 메모 조회가 늦어 목록이 늦지 않게)
    findMemos: ({ eqpId, fromName, toName, maxTimeMs = MAX }, limit) => {
      const filename = toName === undefined ? { $gte: fromName } : { $gte: fromName, $lt: toName }
      // 이름 내림차순 — 한도에서 잘릴 때 늦은 스냅샷의 메모가 남는다
      return col('ARS_USER_MEMO').find(eqpId === undefined ? { filename } : { eqpid: eqpId, filename }).sort({ filename: -1 }).limit(limit).maxTimeMS(maxTimeMs).toArray()
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
    // ── 시험 실행(P5 설계 §5.2·§5.4) ── 모두 읽기다. 캐시를 거치지 않는 지금 값(Q-090).
    // 그 설비 ID 의 문서를 목록(findEquipment·findAgents)과 같은 조건으로 — 같은 규칙(joinEquipment·applyEquipmentRules)에 넣는다
    findEquipmentFresh: async (eqpId) => {
      const [eqps, agents] = await Promise.all([
        col('EQP_INFO').find({ eqpId, webmanagerUse: 1 }, { projection: { _id: 0 } }).maxTimeMS(RUN_MAX).toArray(),
        col('AGENT_INFO').find({ eqpId, arsagentJava: 1 }, { projection: { _id: 0, eqpId: 1 } }).maxTimeMS(RUN_MAX).toArray()
      ])
      return { eqps, agents }
    },
    findOnoff: (eqpIds) => (eqpIds.length
      ? col('EQP_INFO').find({ eqpId: { $in: eqpIds }, webmanagerUse: 1 }, { projection: { _id: 0, eqpId: 1, onoff: 1 } }).maxTimeMS(RUN_MAX).toArray()
      : Promise.resolve([])),
    // CommandServer 가 보는 것과 같은 문서들(property 가 없는 문서도 센다 — 1건이 아니면 실행되지 않는다).
    // 값의 형을 올리지 않는다(promoteValues: false) — CommandServer 는 Int32·Int64 만 읽고 Double 은 기본값으로 읽는다(domain/testRun.readRunProperty).
    findRunPropertyDocs: (key) => col('SC_PROPERTY')
      .find({ process: key.process, eqpModel: key.model, scname: key.name }, { promoteValues: false, projection: { _id: 0, property: 1, scCategory: 1 } })
      .limit(3).maxTimeMS(RUN_MAX).toArray(),
    // 실행 기록 — 운영 인덱스 (eqpid, txn_seq)의 앞 두 칸을 탄다. 이름으로 hint 를 걸지 않는다(유일 인덱스가 세 칸으로 바뀔 예정 — ARS-044).
    // 그 시나리오의 편집기 실행(SE)만 — 알람 조치가 많은 설비에서 한도(1,000건)에 내 문서가 밀려나지 않게 좁힌다.
    findRecoveries: ({ eqpIds, from, to, name }) => (eqpIds.length
      ? col('EQP_AUTO_RECOVERY').find({ eqpid: { $in: eqpIds }, txn_seq: { $gte: from, $lte: to }, ears_code: name, trigger_by: 'SE' }, { projection: RECOVERY_FIELDS }).limit(RECOVERY_LIMIT).maxTimeMS(RUN_MAX).toArray()
      : Promise.resolve([])),
    findRecoveriesAt: (pairs) => (pairs.length
      ? col('EQP_AUTO_RECOVERY').find({ $or: pairs.map((p) => ({ eqpid: p.eqpId, txn_seq: p.txnSeq, ears_code: p.name })) }, { projection: RECOVERY_FIELDS }).maxTimeMS(RUN_MAX).toArray()
      : Promise.resolve([])),
    // 결과 메일 수신인(P5 설계 §5.5) — 발송 서버(HttpWebServer·EmailingAgent)가 보는 것과 같은 조건으로 읽는다. 읽기만.
    findEmailRules: (name) => col('EMAIL_RECIPIENTS')
      .find({ app: 'ARS', code: name }, { projection: { _id: 0, emailCategory: 1, process: 1, model: 1, line: 1 } }).maxTimeMS(RUN_MAX).toArray(),
    findEmailInfos: (categories) => (categories.length
      ? col('EMAILINFO').find({ project: 'ARS', category: { $in: categories } }, { projection: { _id: 0, category: 1, accounts: 1 } }).maxTimeMS(RUN_MAX).toArray()
      : Promise.resolve([])),
    hasNameRule: async () => (await getDb().listCollections({ name: 'SC_NAME_RULE' }, { nameOnly: true }).toArray()).length > 0,
    findNameRule: () => col('SC_NAME_RULE').find({}, { projection: { _id: 0 } }).maxTimeMS(MAX).toArray()
  })
}

module.exports = { createEarsRepository }

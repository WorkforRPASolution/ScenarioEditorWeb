'use strict'
// 웹 전용 DB(초안·초안 그림·배포 기록, 설계 §6.1·§6.4). 운영 EARS 가 아니라 WebManager DB 쪽 연결에 쓴다.
// 컬렉션 SCENARIO_EDITOR_DRAFTS·SCENARIO_EDITOR_DEPLOYS, 그림은 GridFS 버킷 seDraftImages.
const { withMongoErrors } = require('../errors')

const MAX = 20000
const BUCKET = 'seDraftImages'

function createWebRepository(getWebDb, mongo) {
  const col = (name) => getWebDb().collection(name)
  const drafts = () => col('SCENARIO_EDITOR_DRAFTS')
  const deploys = () => col('SCENARIO_EDITOR_DEPLOYS')
  const bucket = () => new mongo.GridFSBucket(getWebDb(), { bucketName: BUCKET })
  // ObjectId 형이 아닌 id 는 없는 것으로 본다(드라이버가 던지는 오류를 500 으로 내지 않는다).
  const toId = (id) => {
    if (id instanceof mongo.ObjectId) return id
    return typeof id === 'string' && /^[0-9a-fA-F]{24}$/.test(id) ? new mongo.ObjectId(id) : null
  }

  // 약속을 기억해 동시에 불러도 한 번만 만든다. 실패하면 다음에 다시 시도한다.
  let indexing = null
  const ensureIndexes = () => {
    if (!indexing) {
      indexing = (async () => {
        await drafts().createIndex({ owner: 1, process: 1, model: 1, name: 1 }, { unique: true })
        await deploys().createIndex({ requestId: 1 }, { unique: true })
        await deploys().createIndex({ 'target.process': 1, 'target.model': 1, 'target.name': 1, startedAt: -1 })
      })().catch((e) => { indexing = null; throw e })
    }
    return indexing
  }
  const draftKey = (owner, process, model, name) => ({ owner, process, model, name })
  const gridIdsOf = (doc) => ((doc && doc.images) || []).map((i) => i.gridId)

  async function deleteOne(filter) {
    const doc = await drafts().findOneAndDelete(filter, { maxTimeMS: MAX })
    return doc ? { deleted: true, gridIds: gridIdsOf(doc) } : { deleted: false, gridIds: [] }
  }

  const queries = withMongoErrors({
    ensureIndexes,
    async upsertDraft(doc) {
      await ensureIndexes()
      const { owner, process, model, name, _id, revision, savedAt, ...rest } = doc
      const out = await drafts().findOneAndUpdate(
        draftKey(owner, process, model, name),
        { $set: { ...rest, savedAt: new Date() }, $inc: { revision: 1 } },
        { upsert: true, returnDocument: 'after', maxTimeMS: MAX }
      )
      return { draftId: String(out._id), savedAt: out.savedAt, revision: out.revision }
    },
    async listDrafts(owner, process, model) {
      const rows = await drafts().find({ owner, process, model })
        .project({ name: 1, target: 1, base: 1, savedAt: 1, revision: 1 }).sort({ savedAt: -1 }).maxTimeMS(MAX).toArray()
      return rows.map((r) => ({ draftId: String(r._id), name: r.name, target: r.target, base: r.base, savedAt: r.savedAt, revision: r.revision }))
    },
    async getDraft(owner, draftId) {
      const _id = toId(draftId)
      return _id ? drafts().findOne({ _id, owner }, { maxTimeMS: MAX }) : null
    },
    findDraftFor: (owner, process, model, name) => drafts().findOne(draftKey(owner, process, model, name), { maxTimeMS: MAX }),
    async deleteDraft(owner, draftId) {
      const _id = toId(draftId)
      return _id ? deleteOne({ _id, owner }) : { deleted: false, gridIds: [] }
    },
    deleteDraftFor: (owner, process, model, name) => deleteOne(draftKey(owner, process, model, name)),

    async putDraftImage(buffer, { owner, tempId }) {
      const up = bucket().openUploadStream(String(tempId), { metadata: { owner, tempId } })
      await new Promise((resolve, reject) => { up.once('error', reject); up.once('finish', resolve); up.end(buffer) })
      return up.id
    },
    async readDraftImage(gridId) {
      const chunks = []
      for await (const c of bucket().openDownloadStream(gridId)) chunks.push(c)
      return Buffer.concat(chunks)
    },
    async deleteDraftImages(gridIds) {
      const b = bucket()
      for (const id of gridIds) {
        try { await b.delete(id) } catch (e) { if (!/FileNotFound/.test(String(e && e.name)) && !/File not found/i.test(String(e && e.message))) throw e }
      }
    },

    async insertDeploy(record) {
      await ensureIndexes()
      await deploys().insertOne(record)
    },
    async updateDeploy(requestId, fields) {
      await deploys().updateOne({ requestId }, { $set: fields })
    },
    async getDeploy(requestId) {
      return (await deploys().findOne({ requestId }, { maxTimeMS: MAX })) || null
    }
  })
  // 흘려 읽는 스트림이라 withMongoErrors(async 로 감쌈)를 거치지 않는다. 읽는 쪽이 오류를 처리한다.
  return { ...queries, openDraftImage: (gridId) => bucket().openDownloadStream(gridId) }
}

module.exports = { createWebRepository }

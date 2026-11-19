'use strict'
// InterfaceServer setscenario 가 쓴 GridFS(파일 이름 {P}.{M}.{N}.{crtime}, metadata {model,name,crtime,process,body}).
// 버전 내용은 getscenario 와 같이 uploadDate 가 가장 늦은 파일을 쓴다(설계 §5.5). 같은 crtime 으로 다시 올라올 수 있어(redis_to_mongo) 그 파일의 _id 가 캐시 정체성이다.
const { seError, withMongoErrors, mapGridfsError } = require('../errors')

const MAX = 20000
// 본문 읽기 전체의 상한. 풀기는 한 번에 하나라 멈춘 읽기 하나가 다른 판을 막지 않게 한다. 브라우저 열기 제한(client OPEN_TIMEOUT_MS)과 같다.
const READ_TIMEOUT_MS = 120000

function createGridfsRepository(getDb, mongo) {
  const files = () => getDb().collection('fs.files')
  const q = (process, model, name) => ({ 'metadata.process': process, 'metadata.model': model, 'metadata.name': name })
  // 파일 내용(BI)을 조각으로 흘려 준다. 큰 BI 를 한 번에 메모리에 올리지 않기 위해서다. 반복 도중의 오류도 여기서 바꾼다.
  // 조각이 모자라거나 깨져 보일 때: 읽는 동안 누가 그 판을 지웠으면(delscenario) 깨진 것이 아니라 없어진 것이다 — 파일 문서가 아직 있는지 본다(SEW-006).
  // 보다가 실패하면 원래 판단(깨짐)을 그대로 준다.
  async function damagedOrGone(file, damaged) {
    const still = await files().findOne({ _id: file._id }, { projection: { _id: 1 }, maxTimeMS: MAX }).catch(() => damaged)
    return still ? damaged : seError(404, 'NOT_FOUND', '읽는 동안 그 버전이 지워졌습니다')
  }
  async function* streamContent(file) {
    let bytes = 0
    try {
      for await (const chunk of new mongo.GridFSBucket(getDb()).openDownloadStream(file._id, { timeoutMS: READ_TIMEOUT_MS })) {
        bytes += chunk.length
        yield chunk
      }
    } catch (e) {
      const mapped = mapGridfsError(e)
      throw mapped.code === 'FILE_DAMAGED' ? await damagedOrGone(file, mapped) : mapped
    }
    // 드라이버는 뒤쪽 조각이 없으면 오류 없이 끝낸다 — 전부 없으면 정상인 빈 BI 와 구분되지 않으므로 파일 길이와 대조한다.
    if (bytes !== file.length) throw await damagedOrGone(file, seError(422, 'FILE_DAMAGED', 'GridFS 파일 조각이 빠졌거나 깨졌습니다'))
  }
  const queries = withMongoErrors({
    async findCrtimes(process, model, name) {
      const docs = await files().find(q(process, model, name), { projection: { 'metadata.crtime': 1 } }).maxTimeMS(MAX).toArray()
      return docs.map((d) => d.metadata.crtime)
    },
    // 다시 열 때마다 부른다 — 본문이 든 metadata(최대 16MB)를 읽지 않는다.
    // 파일 이름 조건이 있어야 GridFS 기본 인덱스(filename, uploadDate)를 탄다. 규칙과 다른 이름도 찾도록 없으면 메타데이터만으로 다시 본다.
    async findVersionId(process, model, name, crtime) {
      const version = { ...q(process, model, name), 'metadata.crtime': crtime }
      const latest = async (filter) => {
        const docs = await files().find(filter, { projection: { _id: 1 } }).sort({ uploadDate: -1 }).limit(1).maxTimeMS(MAX).toArray()
        return docs[0] ? docs[0]._id : null
      }
      return (await latest({ filename: `${process}.${model}.${name}.${crtime}`, ...version })) ?? latest(version)
    },
    // 있는지·어느 판인지만 본다 — 본문이 든 metadata.body(최대 16MB)는 읽지 않는다.
    async findFileMeta(fileId) {
      return files().findOne({ _id: fileId }, { projection: { length: 1, 'metadata.process': 1, 'metadata.model': 1, 'metadata.name': 1, 'metadata.crtime': 1 }, maxTimeMS: MAX })
    },
    async findFile(fileId) {
      return files().findOne({ _id: fileId }, { maxTimeMS: MAX })
    },
    // 불러오기 목록의 스텝 수·용량(2026-11-10 사용자 요청). versions = [{ name, crtime }](현재 판) → Map 이름 → { stepCount, sizeBytes }.
    // 파일 이름으로 찾아 기본 인덱스를 탄다(이름이 규칙과 다른 파일은 빠진다 — 목록에서는 빈칸). 본문(metadata.body, 최대 16MB)은 가져오지 않고
    // Mongo 안에서 스텝 수만 센다. 용량은 파일 길이(기준 화면 묶음 BI)다 — 본문 크기를 재는 $bsonSize 는 4.4 부터라 운영(4.2.6)에서 못 쓴다.
    // 같은 판이 다시 올라와 파일이 둘이면 열기와 같이 가장 늦게 올린 파일을 본다.
    async findVersionStats(process, model, versions) {
      const out = new Map()
      if (!versions.length) return out
      const nameOf = new Map(versions.map((v) => [`${process}.${model}.${v.name}.${v.crtime}`, v.name]))
      const docs = await files().aggregate([
        { $match: { filename: { $in: [...nameOf.keys()] }, 'metadata.process': process, 'metadata.model': model } },
        { $project: { _id: 0, filename: 1, uploadDate: 1, length: 1, steps: { $cond: [{ $isArray: ['$metadata.body.Step'] }, { $size: '$metadata.body.Step' }, null] } } }
      ], { maxTimeMS: MAX }).toArray()
      const latest = new Map()
      for (const d of docs) if (!latest.has(d.filename) || d.uploadDate > latest.get(d.filename).uploadDate) latest.set(d.filename, d)
      for (const [filename, name] of nameOf) {
        const d = latest.get(filename)
        if (d) out.set(name, { stepCount: Number.isInteger(d.steps) ? d.steps : null, sizeBytes: typeof d.length === 'number' ? d.length : null })
      }
      return out
    }
  })
  return { ...queries, streamContent }
}

module.exports = { createGridfsRepository }

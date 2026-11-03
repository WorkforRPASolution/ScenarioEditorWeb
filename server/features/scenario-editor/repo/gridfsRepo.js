'use strict'
// InterfaceServer setscenario 가 쓴 GridFS(파일 이름 {P}.{M}.{N}.{crtime}, metadata {model,name,crtime,process,body}).
// 버전 내용은 getscenario 와 같이 uploadDate 가 가장 늦은 파일을 쓴다(설계 §5.5). 같은 crtime 으로 다시 올라올 수 있어(redis_to_mongo) 그 파일의 _id 가 캐시 정체성이다.
const { withMongoErrors } = require('../errors')

const MAX = 20000

function createGridfsRepository(getDb, mongo) {
  const files = () => getDb().collection('fs.files')
  const q = (process, model, name) => ({ 'metadata.process': process, 'metadata.model': model, 'metadata.name': name })
  return withMongoErrors({
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
    async findFile(fileId) {
      return files().findOne({ _id: fileId }, { maxTimeMS: MAX })
    },
    async readContent(fileId) {
      const bucket = new mongo.GridFSBucket(getDb())
      const chunks = []
      for await (const c of bucket.openDownloadStream(fileId)) chunks.push(c)
      return Buffer.concat(chunks).toString('utf8')
    }
  })
}

module.exports = { createGridfsRepository }

'use strict'
// InterfaceServer setscenario 가 쓴 GridFS(파일 이름 {P}.{M}.{N}.{crtime}, metadata {model,name,crtime,process,body}).
// 버전 내용은 getscenario 와 같이 uploadDate 가 가장 늦은 파일을 쓴다(설계 §5.5).
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
    async findVersion(process, model, name, crtime) {
      const docs = await files().find({ ...q(process, model, name), 'metadata.crtime': crtime }).sort({ uploadDate: -1 }).limit(1).maxTimeMS(MAX).toArray()
      return docs[0] || null
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

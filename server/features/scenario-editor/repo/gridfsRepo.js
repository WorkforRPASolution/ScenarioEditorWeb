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
  async function* streamContent(file) {
    let bytes = 0
    try {
      for await (const chunk of new mongo.GridFSBucket(getDb()).openDownloadStream(file._id, { timeoutMS: READ_TIMEOUT_MS })) {
        bytes += chunk.length
        yield chunk
      }
    } catch (e) {
      throw mapGridfsError(e)
    }
    // 드라이버는 뒤쪽 조각이 없으면 오류 없이 끝낸다 — 전부 없으면 정상인 빈 BI 와 구분되지 않으므로 파일 길이와 대조한다.
    if (bytes !== file.length) throw seError(422, 'FILE_DAMAGED', 'GridFS 파일 조각이 빠졌거나 깨졌습니다')
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
    async findFile(fileId) {
      return files().findOne({ _id: fileId }, { maxTimeMS: MAX })
    }
  })
  return { ...queries, streamContent }
}

module.exports = { createGridfsRepository }

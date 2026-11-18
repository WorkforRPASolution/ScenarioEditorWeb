'use strict'
// InterfaceServer 로는 만들 수 없는 이상 데이터를 직접 쓴다. 이 파일만 SC_PROPERTY·GridFS 에 직접 쓴다.
const { Long, Int32 } = require('mongodb')

async function dupProperty(ctx, { process, model, name, property }) {
  await ctx.db.collection('SC_PROPERTY').insertOne({ process, eqpModel: model, scname: name, property: JSON.parse(property) })
}

async function uploadVersion(ctx, { process, model, name, crtime, body, content }) {
  return new Promise((resolve, reject) => {
    const s = ctx.bucket.openUploadStream(`${process}.${model}.${name}.${crtime}`, {
      chunkSizeBytes: 1024 * 1024,
      metadata: { model, name, crtime: Long.fromNumber(crtime), process, body: JSON.parse(body) }
    })
    s.on('error', reject).on('finish', () => resolve(s.id))
    s.end(Buffer.from(content, 'utf8'))
  })
}

// SC_PROPERTY + GridFS 만 있고 Redis 필드가 없다(새 시나리오가 setscenario 4단계 뒤 실패한 모양).
async function noRedisField(ctx, { process, model, name, body, bi, property, propertyType, performance }) {
  await ctx.db.collection('SC_PROPERTY').updateOne(
    { process, eqpModel: model, scname: name },
    { $set: { property: JSON.parse(property), scCategory: Long.fromNumber(propertyType), trCategory: Long.fromNumber(0), performance } },
    { upsert: true }
  )
  await uploadVersion(ctx, { process, model, name, crtime: Date.now(), body, content: bi })
}

// redis_to_mongo 가 같은 crtime 으로 빈 BI 파일을 하나 더 올린 모양(getscenario 는 uploadDate 가 늦은 쪽을 고른다).
async function emptyBiVersion(ctx, { process, model, name, body, crtime }) {
  const id = await uploadVersion(ctx, { process, model, name, crtime, body, content: '' })
  // InterfaceServer 파일과 uploadDate 가 같거나 1ms 이르게 찍히는 경합(컨테이너·호스트 시계 차이)을 막는다:
  // 빈 파일이 같은 판의 다른 파일보다 반드시 늦어야 getscenario 가 이쪽을 고른다.
  const files = ctx.db.collection('fs.files')
  const [other] = await files.find({ 'metadata.process': process, 'metadata.model': model, 'metadata.name': name, _id: { $ne: id } })
    .sort({ uploadDate: -1 }).limit(1).toArray()
  if (!other) return
  const own = await files.findOne({ _id: id }, { projection: { uploadDate: 1 } })
  if (own.uploadDate.getTime() <= other.uploadDate.getTime()) {
    await files.updateOne({ _id: id }, { $set: { uploadDate: new Date(other.uploadDate.getTime() + 1) } })
  }
}

// 사내 SetScenario 의 insert 경로가 만드는 property 없는 문서.
async function propertyless(ctx, { process, model, name, propertyType }) {
  await ctx.db.collection('SC_PROPERTY').insertOne({ process, eqpModel: model, scname: name, scCategory: Long.fromNumber(propertyType), trCategory: Long.fromNumber(0) })
}

// scCategory 를 Int32 로 바꾼다(사내는 Int64 로 쓴다). CommandServer 는 getInt64 로 읽어 이런 문서의 실행 요청을 말없이 버린다(P5 설계 §3).
async function badCategory(ctx, { process, model, name, propertyType }) {
  await ctx.db.collection('SC_PROPERTY').updateOne({ process, eqpModel: model, scname: name, property: { $exists: true } }, { $set: { scCategory: new Int32(propertyType) } })
}

module.exports = { dupProperty, noRedisField, emptyBiVersion, propertyless, badCategory }

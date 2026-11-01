'use strict'
// InterfaceServer 로는 만들 수 없는 이상 데이터를 직접 쓴다. 이 파일만 SC_PROPERTY·GridFS 에 직접 쓴다.
const { Long } = require('mongodb')

async function dupProperty(ctx, { process, model, name, property }) {
  await ctx.db.collection('SC_PROPERTY').insertOne({ process, eqpModel: model, scname: name, property: JSON.parse(property) })
}

async function uploadVersion(ctx, { process, model, name, crtime, body, content }) {
  await new Promise((resolve, reject) => {
    const s = ctx.bucket.openUploadStream(`${process}.${model}.${name}.${crtime}`, {
      chunkSizeBytes: 1024 * 1024,
      metadata: { model, name, crtime: Long.fromNumber(crtime), process, body: JSON.parse(body) }
    })
    s.on('error', reject).on('finish', resolve)
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
  await uploadVersion(ctx, { process, model, name, crtime, body, content: '' })
}

// 사내 SetScenario 의 insert 경로가 만드는 property 없는 문서.
async function propertyless(ctx, { process, model, name, propertyType }) {
  await ctx.db.collection('SC_PROPERTY').insertOne({ process, eqpModel: model, scname: name, scCategory: Long.fromNumber(propertyType), trCategory: Long.fromNumber(0) })
}

module.exports = { dupProperty, noRedisField, emptyBiVersion, propertyless }

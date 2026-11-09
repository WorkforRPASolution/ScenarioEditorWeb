'use strict'
// 시험이 만든 SEW_W_ 시나리오와 시험 사용자의 웹 기록을 지운다(공유 로컬 EARS — 시드 시나리오·다른 데이터는 건드리지 않는다).
// 배포 통합 시험(server/…/integration/deploy.int.test.js)과 저장 E2E(client/e2e/scenario-editor/p2-save.spec.js)가 함께 쓰고, 실패해도 부른다.
// 지우는 것: SC_PROPERTY(SEW 공정·SEW_W_ 이름) · GridFS 판(fs.files 메타데이터) · Redis 해시(SEW*-*)의 SEW_W_ 필드 ·
//            웹 전용 DB 의 시험 사용자 초안·배포 기록·초안 그림(seDraftImages).
// 드라이버는 부르는 쪽 것을 받는다(mongoose 의 mongo 나 mongodb 패키지의 Db·GridFSBucket, ioredis) — 이 파일은 아무 드라이버도 불러오지 않는다.

const TEST_USERS = ['sew_master', 'sew_cvd', 'sew_multi', 'sew_mastercvd', 'sew_spaces', 'sew_longgrade', 'sew_none']
// 웹 전용 DB. 이름이 다르면(WEBMANAGER_DB_URI 를 비워 WebManager 의 실제 로그 DB 로 떨어짐 등) 아무것도 지우지 않는다.
const WEB_DB = 'SE_WEB_DEV'

async function cleanupSewW({ db, webDb, redis, GridFSBucket, users = TEST_USERS }) {
  if (webDb && webDb.databaseName !== WEB_DB) throw new Error(`웹 전용 DB 가 ${WEB_DB} 가 아니다: ${webDb.databaseName} — 아무것도 지우지 않았다`)
  const r = {}
  if (db) {
    r.scProperty = (await db.collection('SC_PROPERTY').deleteMany({ process: /^SEW/, scname: /^SEW_W_/ })).deletedCount
    const bucket = new GridFSBucket(db)
    const files = await db.collection('fs.files').find({ 'metadata.process': /^SEW/, 'metadata.name': /^SEW_W_/ }, { projection: { _id: 1 } }).toArray()
    for (const f of files) await bucket.delete(f._id)
    r.gridfsFiles = files.length
  }
  if (redis) {
    let n = 0
    for (const key of await redis.keys('SEW*-*')) {
      if ((await redis.type(key)) !== 'hash') continue
      const fields = (await redis.hkeys(key)).filter((f) => f.startsWith('SEW_W_'))
      if (fields.length) n += await redis.hdel(key, ...fields)
    }
    r.redisFields = n
  }
  if (webDb) {
    r.drafts = (await webDb.collection('SCENARIO_EDITOR_DRAFTS').deleteMany({ owner: { $in: users } })).deletedCount
    r.deploys = (await webDb.collection('SCENARIO_EDITOR_DEPLOYS').deleteMany({ user: { $in: users } })).deletedCount
    const images = new GridFSBucket(webDb, { bucketName: 'seDraftImages' })
    const files = await webDb.collection('seDraftImages.files').find({ 'metadata.owner': { $in: users } }, { projection: { _id: 1 } }).toArray()
    for (const f of files) await images.delete(f._id)
    r.draftImages = files.length
  }
  return r
}

module.exports = { cleanupSewW, TEST_USERS, WEB_DB }

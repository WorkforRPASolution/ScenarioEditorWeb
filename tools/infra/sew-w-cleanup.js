'use strict'
// 시험이 만든 SEW_W_ 시나리오와 시험 사용자의 웹 기록을 지운다(공유 로컬 EARS — 시드 시나리오·다른 데이터는 건드리지 않는다).
// 배포 통합 시험(server/…/integration/deploy.int.test.js)과 저장 E2E(client/e2e/scenario-editor/p2-save.spec.js)가 함께 쓰고, 실패해도 부른다.
// 지우는 것: SC_PROPERTY(SEW 공정·SEW_W_ 이름) · GridFS 판(fs.files 메타데이터) · Redis 해시(SEW*-*)의 SEW_W_ 필드 ·
//            웹 전용 DB 의 시험 사용자 초안·배포 기록·초안 그림(seDraftImages).
// 드라이버는 부르는 쪽 것을 받는다(mongoose 의 mongo 나 mongodb 패키지의 Db·GridFSBucket, ioredis) — 이 파일은 아무 드라이버도 불러오지 않는다.
// 지우기 전에 두 가지를 본다: 연결 주소(env)가 모두 루프백(이 PC 안)인지, 웹 전용 DB 이름이 SE_WEB_DEV 인지. 하나라도 아니면 아무것도 지우지 않고 던진다.

const TEST_USERS = ['sew_master', 'sew_cvd', 'sew_multi', 'sew_mastercvd', 'sew_spaces', 'sew_longgrade', 'sew_none']
// 웹 전용 DB. 이름이 다르면(WEBMANAGER_DB_URI 를 비워 WebManager 의 실제 로그 DB 로 떨어짐 등) 아무것도 지우지 않는다.
const WEB_DB = 'SE_WEB_DEV'

// ── 루프백 확인: 사내 프로필 .env(운영 EARS·Redis·InterfaceServer — server/.env.inhouse.example)로 시험을 돌려도 사내 SEW_W_ 를 지우지 않는다 ──
// env = 서버가 읽는 값(server/.env 를 해석한 것 또는 process.env). 빈 값은 부르는 쪽 기본값(localhost)이라 통과한다.
// 문구에는 호스트만 싣는다(계정·비밀번호는 싣지 않는다).
const isLoopback = (h) => {
  const x = String(h).toLowerCase()
  return x === 'localhost' || x === '::1' || /^127(\.\d{1,3}){3}$/.test(x)
}
// "host:port"·"[::1]:port"·"::1" → 호스트
function hostOf(hp) {
  const s = hp.trim()
  if (s.startsWith('[')) { const end = s.indexOf(']'); return end > 0 ? s.slice(1, end) : s }
  return (s.match(/:/g) || []).length > 1 ? s : s.split(':')[0] // 괄호 없는 IPv6 는 포트가 없다
}
// mongodb://[계정@]호스트[:포트][,호스트…]/DB?… (mongodb+srv 는 DNS 이름 하나 — 루프백일 수 없다)
function mongoHosts(uri) {
  const m = /^mongodb(\+srv)?:\/\/(.*)$/.exec(uri)
  if (!m) return []
  const authority = m[2].split(/[/?]/)[0]
  const hosts = authority.slice(authority.lastIndexOf('@') + 1)
  return m[1] ? [hosts] : hosts.split(',').filter(Boolean).map(hostOf)
}
// redis://[:비밀번호@]호스트:포트/DB 또는 Sentinel {호스트:포트},{호스트:포트}#이름(shared/db/redisConnection 과 같은 꼴)
function redisHosts(url) {
  if (url.includes('#')) return [...url.split('#')[0].matchAll(/\{([^}]*)\}/g)].map((x) => hostOf(x[1]))
  return urlHosts(url)
}
function urlHosts(url) {
  try { return [hostOf(new URL(url).hostname)] } catch { return [] }
}
const TARGETS = [['MONGODB_URI', mongoHosts], ['WEBMANAGER_DB_URI', mongoHosts], ['SE_WEB_DB_URI', mongoHosts], ['REDIS_URL', redisHosts], ['EARS_INTERFACE_URL', urlHosts]]

function assertLocalTargets(env) {
  if (!env || typeof env !== 'object') throw new Error('정리할 곳(env — MONGODB_URI·REDIS_URL·EARS_INTERFACE_URL 등 서버가 읽는 값)을 받지 못했다 — 아무것도 지우지 않았다')
  const bad = []
  for (const [key, hostsOf] of TARGETS) {
    const v = env[key] === undefined || env[key] === null ? '' : String(env[key]).trim()
    if (!v) continue
    const hosts = hostsOf(v)
    if (!hosts.length || !hosts.every(isLoopback)) bad.push(`${key}=${hosts.join(',') || '(주소를 해석하지 못함)'}`)
  }
  if (bad.length) throw new Error(`루프백(127.0.0.1·localhost·::1)이 아닌 곳이 있다: ${bad.join(' · ')} — 사내 프로필로 시험을 돌린 것 같다. 아무것도 지우지 않았다`)
}

async function cleanupSewW({ env, db, webDb, redis, GridFSBucket, users = TEST_USERS }) {
  assertLocalTargets(env)
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

module.exports = { cleanupSewW, assertLocalTargets, TEST_USERS, WEB_DB }

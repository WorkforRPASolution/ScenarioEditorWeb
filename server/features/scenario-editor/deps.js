'use strict'
const path = require('node:path')
const mongoose = require('mongoose')
const { earsConnection, webManagerConnection } = require('../../shared/db/connection')
const { getRedisClient } = require('../../shared/db/redisConnection')
const { seError } = require('./errors')
const { createEarsRepository } = require('./repo/earsRepository')
const { createScenarioHashRepository } = require('./repo/scenarioHashRepo')
const { createWebRepository } = require('./repo/webRepository')
const { createGridfsRepository } = require('./repo/gridfsRepo')
const { createImageCache } = require('./repo/imageCache')
const { createUserService } = require('./service/userService')
const { createScopeService } = require('./service/scopeService')

const num = (v, d) => (Number.isFinite(Number(v)) && String(v).trim() !== '' ? Number(v) : d)

function build(env = process.env) {
  const getDb = () => {
    if (!earsConnection.db || earsConnection.readyState !== 1) throw seError(503, 'UPSTREAM_DOWN', 'EARS DB 에 연결되지 않았습니다')
    return earsConnection.db
  }
  const getWebDb = () => {
    if (!webManagerConnection.db || webManagerConnection.readyState !== 1) throw seError(503, 'UPSTREAM_DOWN', '웹 전용 DB 에 연결되지 않았습니다')
    return webManagerConnection.db
  }
  const now = () => Date.now()
  const repo = createEarsRepository(getDb, mongoose.mongo)
  const web = createWebRepository(getWebDb, mongoose.mongo)
  const hash = createScenarioHashRepository(getRedisClient)
  const gridfs = createGridfsRepository(getDb, mongoose.mongo)
  const imageCache = createImageCache({
    dir: env.IMAGE_CACHE_DIR ? path.resolve(env.IMAGE_CACHE_DIR) : path.join(__dirname, '../../.cache/images'),
    maxBytes: num(env.IMAGE_CACHE_MAX_MB, 2048) * 1024 * 1024
  })
  const users = createUserService({ repo, ttlMs: num(env.USER_CACHE_TTL_SEC, 30) * 1000, now })
  const scopes = createScopeService({ repo, ttlMs: num(env.EQUIPMENT_CACHE_TTL_SEC, 60) * 1000, now })
  const out = { repo, web, hash, gridfs, imageCache, users, scopes }
  const { createListService } = require('./service/listService')
  const { createVersionService } = require('./service/versionService')
  const { createLogger } = require('../../shared/logger')
  const log = createLogger('scenario-editor')
  out.list = createListService({ repo, hash, scopes, gridfs, log })
  out.versions = createVersionService({ gridfs, hash, scopes })
  const { createCountService } = require('./service/countService')
  out.counts = createCountService({ repo, web, scopes, log })
  const { createOpenService } = require('./service/openService')
  out.opener = createOpenService({ repo, hash, gridfs, scopes, imageCache, log })
  const { createDataCheckService } = require('./service/dataCheckService')
  out.dataCheck = createDataCheckService({ repo, scopes })
  const { createCheckService } = require('./service/checkService')
  out.check = createCheckService({ repo, hash, scopes, opener: out.opener, env })
  const { createDraftService } = require('./service/draftService')
  out.drafts = createDraftService({ web, check: out.check, scopes })
  const { createDeployService } = require('./service/deployService')
  out.deploy = createDeployService({ check: out.check, opener: out.opener, web, repo, hash, scopes, interfaceClient: require('./clients/interfaceClient'), log })
  const { createVersionAdminService } = require('./service/versionAdminService')
  out.versionAdmin = createVersionAdminService({ repo, scopes, interfaceClient: require('./clients/interfaceClient'), web, now })
  const { createPerformanceService } = require('./service/performanceService')
  out.performance = createPerformanceService({ repo, scopes, now })
  // 스냅샷(P3) — Cassandra 는 처음 쓸 때 연결한다. 주소가 비어 있어도 여기서는 아무 일도 없다.
  const { createSnapshotRepository } = require('./repo/snapshotRepository')
  const { createSnapshotService } = require('./service/snapshotService')
  const { createMemoService } = require('./service/memoService')
  out.snapshotRepo = createSnapshotRepository({ env, driver: require('cassandra-driver'), log })
  out.memos = createMemoService({ repo, scopes, now, env, log })
  out.snapshots = createSnapshotService({ snapshotRepo: out.snapshotRepo, scopes, now, env, log, memos: out.memos })
  // 이력(P3-D) — 이력 서버(HttpWebServer) 주소는 부를 때 읽는다. 비어 있으면 이력 보기만 503 이다.
  const { createHistoryClient } = require('./clients/historyClient')
  const { createHistoryService } = require('./service/historyService')
  out.history = createHistoryService({ client: createHistoryClient({ env, log }), scopes })
  return out
}

let deps = null
const getDeps = () => deps || (deps = build())
const _setDeps = (d) => { deps = d }

module.exports = { getDeps, _setDeps, build }

'use strict'
const path = require('node:path')
const mongoose = require('mongoose')
const { earsConnection } = require('../../shared/db/connection')
const { getRedisClient } = require('../../shared/db/redisConnection')
const { seError } = require('./errors')
const { createEarsRepository } = require('./repo/earsRepository')
const { createScenarioHashRepository } = require('./repo/scenarioHashRepo')
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
  const now = () => Date.now()
  const repo = createEarsRepository(getDb)
  const hash = createScenarioHashRepository(getRedisClient)
  const gridfs = createGridfsRepository(getDb, mongoose.mongo)
  const imageCache = createImageCache({
    dir: env.IMAGE_CACHE_DIR ? path.resolve(env.IMAGE_CACHE_DIR) : path.join(__dirname, '../../.cache/images'),
    maxBytes: num(env.IMAGE_CACHE_MAX_MB, 2048) * 1024 * 1024
  })
  const users = createUserService({ repo, ttlMs: num(env.USER_CACHE_TTL_SEC, 30) * 1000, now })
  const scopes = createScopeService({ repo, ttlMs: num(env.EQUIPMENT_CACHE_TTL_SEC, 60) * 1000, now })
  const out = { repo, hash, gridfs, imageCache, users, scopes }
  const { createListService } = require('./service/listService')
  const { createVersionService } = require('./service/versionService')
  out.list = createListService({ repo, hash, scopes })
  out.versions = createVersionService({ gridfs, hash, scopes })
  const { createOpenService } = require('./service/openService')
  const { createLogger } = require('../../shared/logger')
  out.opener = createOpenService({ repo, hash, gridfs, scopes, imageCache, log: createLogger('scenario-editor') })
  const { createDataCheckService } = require('./service/dataCheckService')
  out.dataCheck = createDataCheckService({ repo, scopes })
  return out
}

let deps = null
const getDeps = () => deps || (deps = build())
const _setDeps = (d) => { deps = d }

module.exports = { getDeps, _setDeps, build }

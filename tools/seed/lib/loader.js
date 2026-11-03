'use strict'
const { Long } = require('mongodb')
const interfaceClient = require('../../../server/features/scenario-editor/clients/interfaceClient')
const { parseField } = require('../../../server/features/scenario-editor/domain/versionPick')
const env = require('./env')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitNewField(redis, key, name, before, timeoutMs, pollMs = 500) {
  const end = Date.now() + timeoutMs
  do {
    let best = null
    for (const f of await redis.hkeys(key)) {
      if (before.has(f)) continue
      const p = parseField(f)
      if (p && p.name === name && (best === null || p.crtime > best)) best = p.crtime
    }
    if (best !== null) return best
    await sleep(pollMs)
  } while (Date.now() < end)
  return null
}

// InterfaceServer setscenario 로 한 버전을 넣는다. 10초 askTimeout 으로 500 이 와도 저장은 계속될 수 있어 Redis 로 확인한다.
async function setScenario(ctx, { process, model, name, body, bi, property }) {
  const key = `${process}-${model}`
  const before = new Set(await ctx.redis.hkeys(key))
  let status = 200
  let text = ''
  let ok = true
  try {
    await interfaceClient.setScenario({ process, model, name, body, bi, property }, { timeoutMs: env.SETSCENARIO_TIMEOUT_MS })
  } catch (e) {
    if (!e.upstream) throw e
    ok = false
    ;({ status, text } = e.upstream)
  }
  const crtime = await waitNewField(ctx.redis, key, name, before, ok ? 5000 : 60000)
  if (crtime === null) {
    for (let db = 1; db < 16; db++) {
      const n = await ctx.redis.call('SELECT', db).then(() => ctx.redis.exists(key)).finally(() => ctx.redis.call('SELECT', 0))
      if (n) throw new Error(`시나리오 해시 ${key} 가 Redis DB${db} 에 있다 — 설계는 DB0 전제(설계 §3.1). 멈춘다.`)
    }
    throw new Error(`setscenario 실패: ${name} (HTTP ${status}) ${text}`)
  }
  return { crtime, httpStatus: status, verifiedAfterError: !ok }
}

// 사내 저장 순서: setscenario 뒤 scCategory·trCategory(Int64), 그다음 성과(40 §2.5 (a)).
async function afterSave(ctx, { process, model, name, propertyType, performance }) {
  await ctx.db.collection('SC_PROPERTY').updateOne(
    { process, eqpModel: model, scname: name, property: { $exists: true } },
    { $set: { scCategory: Long.fromNumber(propertyType), trCategory: Long.fromNumber(0), performance } }
  )
}

module.exports = { waitNewField, setScenario, afterSave }

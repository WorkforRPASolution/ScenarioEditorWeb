'use strict'
// 사용: node tools/seed/cli.js reset basic anomaly | big | clean | snapshots
const fs = require('node:fs')
const path = require('node:path')
const { Long } = require('mongodb')
const { connect } = require('./lib/clients')
const { clean } = require('./lib/clean')
const { setScenario, afterSave } = require('./lib/loader')
const anomaly = require('./lib/anomaly')
const { generate } = require('../scenario-gen/lib/generate')
const { equipment, agents } = require('./data/equipment')
const users = require('./data/users')
const { connectCassandra } = require('./lib/cassandra')
const { planSnapshots, seedSnapshots, cleanSnapshots } = require('./lib/snapshots')

const SNAPSHOT_EQP = [...new Set(equipment.map((e) => e.eqpId))] // 스냅샷을 지울 설비 = 시험 설비 전부(SEWT_)

const OUT = path.join(__dirname, '../scenario-gen/out')
const read = (dir, f) => fs.readFileSync(path.join(dir, f), 'utf8')

async function seedBase(ctx) {
  await ctx.db.collection('EQP_INFO').insertMany(equipment.map((e) => ({ ...e })))
  await ctx.db.collection('AGENT_INFO').insertMany(agents.map((a) => ({ ...a })))
  await ctx.db.collection('ARS_USER_INFO').insertMany(users.map((u) => ({
    ...u, authorityManager: u.authorityManager && u.authorityManager.long !== undefined ? Long.fromNumber(u.authorityManager.long) : u.authorityManager
  })))
  console.log(`설비 ${equipment.length}(AGENT_INFO ${agents.length}), 사용자 ${users.length}`)
}

async function loadScenario(ctx, { dir, meta }) {
  const perf = JSON.parse(read(dir, 'performance.json'))
  const base = { process: meta.process, model: meta.model, name: meta.name, propertyType: meta.propertyType, performance: perf }
  const v = (n) => ({ body: read(dir, `body.v${n}.json`), bi: read(dir, `bi.v${n}.json`), property: read(dir, `property.v${n}.json`) })
  if (meta.load === 'propertyless') return anomaly.propertyless(ctx, base)
  if (meta.load === 'noRedisField') return anomaly.noRedisField(ctx, { ...base, ...v(meta.versions) })
  let last
  for (let n = 1; n <= meta.versions; n++) {
    last = await setScenario(ctx, { ...base, ...v(n) })
    await afterSave(ctx, base)
    if (last.verifiedAfterError) console.log(`  ! ${meta.name} v${n}: HTTP ${last.httpStatus} 였지만 저장 확인됨(askTimeout)`)
  }
  if (meta.load === 'dupProperty') await anomaly.dupProperty(ctx, { ...base, ...v(meta.versions) })
  if (meta.load === 'emptyBiVersion') await anomaly.emptyBiVersion(ctx, { ...base, ...v(meta.versions), crtime: last.crtime })
  return last
}

// Cassandra 에 붙어 fn 을 돌린다. required 가 아니면(clean·reset) 주소가 없거나 연결하지 못할 때 알리고 넘어간다.
async function withCassandra(fn, { required }) {
  let client = null
  let why = 'server/.env 에 CASSANDRA_CONTACT_POINTS 가 없습니다'
  try {
    client = await connectCassandra()
  } catch (e) {
    if (required) throw e
    why = `Cassandra 에 연결하지 못했습니다 (${e.name})`
  }
  if (!client) {
    if (required) throw new Error(why)
    console.log(`스냅샷 정리 건너뜀: ${why}`)
    return
  }
  try { await fn(client) } finally { await client.shutdown() }
}

async function seedSnapshotData() {
  await withCassandra(async (client) => {
    const now = Date.now()
    console.log('스냅샷 지움:', await cleanSnapshots(client, SNAPSHOT_EQP, now))
    console.log('스냅샷 넣음:', await seedSnapshots(client, planSnapshots(now)))
  }, { required: true })
}

async function main() {
  const [cmd, ...sets] = process.argv.slice(2)
  if (cmd === 'snapshots') return seedSnapshotData()
  const ctx = await connect()
  try {
    if (cmd === 'clean' || cmd === 'reset') {
      console.log('지움:', await clean(ctx))
      await withCassandra(async (client) => console.log('스냅샷 지움:', await cleanSnapshots(client, SNAPSHOT_EQP, Date.now())), { required: false })
    }
    if (cmd === 'reset') await seedBase(ctx)
    const toLoad = cmd === 'reset' ? sets : cmd === 'big' ? ['big'] : []
    if (toLoad.length) {
      const results = generate(toLoad, OUT)
      for (const r of results) {
        const t0 = Date.now()
        const out = await loadScenario(ctx, r)
        console.log(`${r.meta.set}/${r.meta.name} ${r.meta.load}${out && out.crtime ? ` crtime=${out.crtime}` : ''} (${Date.now() - t0}ms)`)
      }
    }
    if (!['clean', 'reset', 'big'].includes(cmd)) { console.error('사용: reset <묶음…> | big | clean | snapshots'); process.exitCode = 2 }
  } finally {
    await ctx.close()
  }
}

main().catch((e) => { console.error(e.message); process.exit(1) })

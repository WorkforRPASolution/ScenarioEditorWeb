'use strict'
// 사용: node tools/seed/cli.js reset basic anomaly | big | clean | snapshots | snapshots-big [바쁜 설비 줄 수]
const fs = require('node:fs')
const path = require('node:path')
const { Long } = require('mongodb')
const { connect } = require('./lib/clients')
const { clean } = require('./lib/clean')
const { setScenario, afterSave } = require('./lib/loader')
const anomaly = require('./lib/anomaly')
const { generate } = require('../scenario-gen/lib/generate')
const { equipment, agents, agentStates } = require('./data/equipment')
const { seedAgents } = require('./lib/agents')
const users = require('./data/users')
const { emailInfos, emailRules } = require('./data/emails')
const { connectCassandra } = require('./lib/cassandra')
const { planSnapshots, seedSnapshots, cleanSnapshots } = require('./lib/snapshots')
const { planBig, seedBig, BIG_EQP, IDLE_EQP } = require('./lib/snapshotsBig')
const { planHistory, seedHistory, cleanHistory, historyUrl } = require('./lib/history')

const SNAPSHOT_EQP = [...new Set(equipment.map((e) => e.eqpId))] // 스냅샷을 지울 설비 = 시험 설비 전부(SEWT_)

const OUT = path.join(__dirname, '../scenario-gen/out')
const read = (dir, f) => fs.readFileSync(path.join(dir, f), 'utf8')

async function seedBase(ctx) {
  await ctx.db.collection('EQP_INFO').insertMany(equipment.map((e) => ({ ...e })))
  await ctx.db.collection('AGENT_INFO').insertMany(agents.map((a) => ({ ...a })))
  await ctx.db.collection('ARS_USER_INFO').insertMany(users.map((u) => ({
    ...u, authorityManager: u.authorityManager && u.authorityManager.long !== undefined ? Long.fromNumber(u.authorityManager.long) : u.authorityManager
  })))
  await ctx.db.collection('EMAILINFO').insertMany(emailInfos.map((d) => ({ ...d })))
  await ctx.db.collection('EMAIL_RECIPIENTS').insertMany(emailRules.map((d) => ({ ...d })))
  const ag = await seedAgents(ctx, equipment, agentStates)
  console.log(`에이전트 상태(Redis): 정보 ${ag.metas}·실행 신호 ${ag.runnings}`)
  console.log(`설비 ${equipment.length}(AGENT_INFO ${agents.length}), 사용자 ${users.length}, 수신 묶음 ${emailInfos.length}·수신 규칙 ${emailRules.length}`)
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
  if (meta.load === 'badCategory') await anomaly.badCategory(ctx, base)
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
    // 이력(P3-D) — 시험 태그 묶음의 txn 에 스텝 셋. 이력 서버(HttpWebServer)가 Cassandra historylog 에 쓴다.
    console.log('이력 지움:', await cleanHistory(client))
    const url = historyUrl()
    if (!url) console.log('이력 넣기 건너뜀: server/.env 에 HTTP_WEB_SERVER_URL 이 없습니다(이력 보기 시험에 필요)')
    else console.log('이력 넣음:', await seedHistory(url, planHistory(now)))
  }, { required: true })
}

// 큰 달 측정용(tools/measure/snapshot-big.js). 줄 수를 주면 바쁜 설비 줄 수를 바꾼다(오래 쉰 설비는 그 2/3).
async function seedBigSnapshotData(countArg) {
  const bigCount = /^\d+$/.test(countArg || '') ? Number(countArg) : 180000
  await withCassandra(async (client) => {
    const now = Date.now()
    console.log('스냅샷 지움:', await cleanSnapshots(client, [BIG_EQP, IDLE_EQP], now))
    const t0 = Date.now()
    const out = await seedBig(client, planBig(now, { bigCount, idleCount: Math.round((bigCount * 2) / 3) }))
    console.log(`큰 달 넣음: ${BIG_EQP}(바쁜 설비)·${IDLE_EQP}(오래 쉰 설비)`, out, `(${Date.now() - t0}ms)`)
    await new Promise((r) => setTimeout(r, 2500)) // TTL 1 줄이 지워진 상태가 되기를 기다린다
  }, { required: true })
}

async function main() {
  const [cmd, ...sets] = process.argv.slice(2)
  if (cmd === 'snapshots') return seedSnapshotData()
  if (cmd === 'snapshots-big') return seedBigSnapshotData(sets[0])
  const ctx = await connect()
  try {
    if (cmd === 'clean' || cmd === 'reset') {
      console.log('지움:', await clean(ctx))
      await withCassandra(async (client) => {
        console.log('스냅샷 지움:', await cleanSnapshots(client, SNAPSHOT_EQP, Date.now()))
        // 이력 표가 없는 Cassandra 여도 reset 이 Mongo 를 비운 채 멈추지 않게 — 알리고 넘어간다
        try { console.log('이력 지움:', await cleanHistory(client)) } catch (e) { console.log(`이력 정리 건너뜀: ${e.message}`) }
      }, { required: false })
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
    if (!['clean', 'reset', 'big'].includes(cmd)) { console.error('사용: reset <묶음…> | big | clean | snapshots | snapshots-big [줄 수]'); process.exitCode = 2 }
  } finally {
    await ctx.close()
  }
}

main().catch((e) => { console.error(e.message); process.exit(1) })

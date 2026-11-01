'use strict'
// 사용: node tools/seed/cli.js reset basic anomaly | big | clean
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

async function main() {
  const [cmd, ...sets] = process.argv.slice(2)
  const ctx = await connect()
  try {
    if (cmd === 'clean' || cmd === 'reset') console.log('지움:', await clean(ctx))
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
    if (!['clean', 'reset', 'big'].includes(cmd)) { console.error('사용: reset <묶음…> | big | clean'); process.exitCode = 2 }
  } finally {
    await ctx.close()
  }
}

main().catch((e) => { console.error(e.message); process.exit(1) })

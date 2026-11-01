'use strict'
// 사용: node tools/scenario-gen/cli.js basic anomaly [big]  → tools/scenario-gen/out/<묶음>/<이름>/
const path = require('node:path')
const fs = require('node:fs')
const { generate } = require('./lib/generate')

const sets = process.argv.slice(2)
if (!sets.length) { console.error('묶음 이름을 주세요: basic anomaly big'); process.exit(2) }
const out = path.join(__dirname, 'out')
const results = generate(sets, out)
for (const r of results) {
  const bi = fs.statSync(path.join(r.dir, `bi.v${r.meta.versions}.json`)).size
  console.log(`${r.meta.set}/${r.meta.name} (${r.meta.process}-${r.meta.model}, v${r.meta.versions}, BI ${(bi / 1048576).toFixed(1)}MB)`)
  const exp = JSON.parse(fs.readFileSync(path.join(r.dir, 'expected.json'), 'utf8'))
  if (exp.minBiBytes && bi < exp.minBiBytes) { console.error(`  ✗ BI 가 ${exp.minBiBytes} 바이트보다 작음`); process.exitCode = 1 }
}

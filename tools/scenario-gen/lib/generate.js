'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { serializeScenario, serializeBackupInfo, serializeProperty } = require('../../../server/features/scenario-editor/domain/csharpJson')
const { workbench } = require('./builders')
const img = require('./images')

const SETS = { basic: () => require('../scenarios/basic'), anomaly: () => require('../scenarios/anomaly'), big: () => require('../scenarios/big') }

function generate(setNames, outDir) {
  const results = []
  for (const set of setNames) {
    if (!SETS[set]) throw new Error(`없는 묶음: ${set}`)
    fs.rmSync(path.join(outDir, set), { recursive: true, force: true }) // 이름을 바꾸거나 뺀 시나리오의 묵은 폴더가 남지 않게 요청한 묶음만 비운다
    for (const spec of SETS[set]()) {
      const builds = spec.versions ?? [spec.build]
      const dir = path.join(outDir, set, spec.name)
      fs.mkdirSync(dir, { recursive: true })
      let last
      builds.forEach((build, i) => {
        const w = workbench(spec.process, spec.model, spec.name, spec.desc, img)
        build(w, img)
        fs.writeFileSync(path.join(dir, `body.v${i + 1}.json`), serializeScenario(w.sc.scenario))
        fs.writeFileSync(path.join(dir, `bi.v${i + 1}.json`), serializeBackupInfo(w.sc.bi))
        fs.writeFileSync(path.join(dir, `property.v${i + 1}.json`), serializeProperty(w.sc.property))
        last = w.sc
      })
      fs.writeFileSync(path.join(dir, 'performance.json'), JSON.stringify(last.performance))
      const meta = { set, name: spec.name, process: spec.process, model: spec.model, load: spec.load ?? 'setscenario', versions: builds.length, propertyType: last.property.Type }
      fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2))
      fs.writeFileSync(path.join(dir, 'expected.json'), JSON.stringify(spec.expect, null, 2))
      results.push({ dir, meta })
    }
  }
  return results
}

module.exports = { generate, SETS }

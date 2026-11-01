import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const require = createRequire(import.meta.url)
const { generate } = require('../lib/generate')
const { normalize, dotnetAvailable } = require('../../csharp-golden/normalize')

const out = mkdtempSync(join(tmpdir(), 'sew-gen-'))
const results = generate(['basic', 'anomaly'], out)
const read = (dir, f) => readFileSync(join(dir, f), 'utf8')

describe('생성기', () => {
  it('basic 15개 + anomaly 7개', () => {
    expect(results.filter((r) => r.meta.set === 'basic')).toHaveLength(15)
    expect(results.filter((r) => r.meta.set === 'anomaly')).toHaveLength(7)
  })
  it.each(results.map((r) => [r.meta.name, r]))('%s: 기대 스텝 수 = 본문 스텝 수 = BI 항목 수', (_, r) => {
    const v = r.meta.versions
    const body = JSON.parse(read(r.dir, `body.v${v}.json`))
    const bi = JSON.parse(read(r.dir, `bi.v${v}.json`))
    const exp = JSON.parse(read(r.dir, 'expected.json'))
    expect(bi.TargetSnapshotList).toHaveLength(body.Step.length)
    if (exp.steps) expect(exp.steps).toHaveLength(body.Step.length)
    expect(body.ID).toBe(`${r.meta.process}-${r.meta.model}-${r.meta.name}`)
  })
  it('다시 만들면 그 묶음 폴더에 남은 묵은 시나리오 폴더가 지워진다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sew-gen-stale-'))
    generate(['anomaly'], dir)
    const stray = join(dir, 'anomaly', 'RENAMED_AWAY')
    mkdirSync(stray)
    writeFileSync(join(stray, 'meta.json'), '{}')
    generate(['anomaly'], dir)
    expect(existsSync(stray)).toBe(false)
    expect(readdirSync(join(dir, 'anomaly'))).toHaveLength(7)
  })
  it('요청하지 않은 묶음 폴더는 건드리지 않는다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sew-gen-sets-'))
    generate(['basic'], dir)
    generate(['anomaly'], dir)
    expect(readdirSync(join(dir, 'basic'))).toHaveLength(15)
    expect(readdirSync(join(dir, 'anomaly'))).toHaveLength(7)
  })
  it('공정·모델 이름에 - 가 없다(사내 전제, Q-007)', () => {
    for (const r of results) expect(`${r.meta.process}${r.meta.model}`).not.toContain('-')
  })
  it.skipIf(!dotnetAvailable())('모든 본문·BI·속성이 실제 Newtonsoft 출력과 같다', () => {
    for (const r of results) {
      for (let v = 1; v <= r.meta.versions; v++) {
        for (const [file, type] of [[`body.v${v}.json`, 'Scenario'], [`bi.v${v}.json`, 'BackupInfo'], [`property.v${v}.json`, 'Property']]) {
          const js = read(r.dir, file)
          expect(normalize(type, js), `${r.meta.name} ${file}`).toBe(js)
        }
      }
    }
  }, 300_000)
})

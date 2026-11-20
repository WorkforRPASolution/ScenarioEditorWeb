import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { builtinModules } from 'node:module'

// 사전 점검은 사내 PC 에서 tools 를 설치하지 않고 돈다(README "사내 쓰기 시험") — Node 내장·상대 경로 모듈만 부르고,
// 패키지는 createRequire(server/package.json) 로 server 의 것(dotenv)만 쓴다. 상대 경로로 부르는 모듈도 같은 규칙이다(SEW-024).
const HERE = dirname(fileURLToPath(import.meta.url))
const ENTRY = resolve(HERE, '../preflight.js')
const BUILTIN = new Set(builtinModules)
const isBuiltin = (m) => m.startsWith('node:') || BUILTIN.has(m)
const requiresOf = (src) => [...src.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1])
const fileOf = (from, spec) => {
  const base = resolve(dirname(from), spec)
  return [base, `${base}.js`, join(base, 'index.js')].find((f) => existsSync(f) && f.endsWith('.js'))
}

describe('사전 점검은 tools 설치 없이 돈다', () => {
  it('preflight.js 와 그것이 상대 경로로 부르는 모듈은 Node 내장·상대 경로만 require 한다', () => {
    const seen = new Set()
    const bad = []
    const visit = (file) => {
      if (seen.has(file)) return
      seen.add(file)
      for (const spec of requiresOf(readFileSync(file, 'utf8'))) {
        if (isBuiltin(spec)) continue
        if (spec.startsWith('.')) {
          const f = fileOf(file, spec)
          if (!f) bad.push(`${file}: ${spec} (파일 없음)`)
          else visit(f)
          continue
        }
        bad.push(`${file}: ${spec}`)
      }
    }
    visit(ENTRY)
    expect(seen.size).toBeGreaterThanOrEqual(3) // preflight·listen·mongoUri
    expect(bad).toEqual([])
  })
  it('패키지는 server 의 것만 createRequire(server/package.json) 로 — server 에 그 의존성이 있다', () => {
    const src = readFileSync(ENTRY, 'utf8')
    const pkgs = [...src.matchAll(/createRequire\([^)]*server\/package\.json[^)]*\)\)\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1])
    const server = JSON.parse(readFileSync(resolve(HERE, '../../../server/package.json'), 'utf8'))
    for (const p of pkgs) expect(Object.keys(server.dependencies ?? {}), p).toContain(p)
    expect(src).not.toMatch(/createRequire\([^)]*tools[/\\]package\.json/)
  })
})

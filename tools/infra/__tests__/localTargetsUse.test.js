import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 시험은 사내 프로필 .env 로 돌리면 운영 EARS 에 쓰거나 실제 설비에 실행을 요청할 수 있다(SEW-024 — 전에는 정리만 막았다).
// 통합 시험·E2E 가 연결하거나 요청하기 전에 server/.env 의 대상이 루프백인지 본다(sew-w-cleanup.js assertLocalTargets).
// 새 통합 시험 파일도 이 규칙을 따르게 소스에서 본다.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const INT_DIR = join(ROOT, 'server/features/scenario-editor/__tests__/integration')
// 서버 .env 의 대상에 닿는 첫 호출
const CONNECTS = ['connectDB()', 'connectRedis()', 'new MongoClient(', 'createActionClient(', "require('../../../../app')"]

describe('시험이 연결하기 전에 대상이 루프백인지 본다', () => {
  const files = readdirSync(INT_DIR).filter((f) => f.endsWith('.int.test.js'))
  it('통합 시험 파일이 있다', () => expect(files.length).toBeGreaterThanOrEqual(6))
  for (const f of files) {
    it(`${f}: assertLocalTargets 가 첫 연결보다 앞에 있다`, () => {
      const src = readFileSync(join(INT_DIR, f), 'utf8')
      const firstConnect = Math.min(...CONNECTS.map((c) => src.indexOf(c)).filter((i) => i >= 0))
      expect(Number.isFinite(firstConnect), `${f} 는 서버 대상에 연결하지 않는가?`).toBe(true)
      const guard = src.indexOf('assertLocalTargets(')
      expect(guard, `${f} 에 assertLocalTargets 호출이 없다`).toBeGreaterThanOrEqual(0)
      expect(guard, `${f} 의 assertLocalTargets 가 첫 연결 뒤에 있다`).toBeLessThan(firstConnect)
    })
  }
  it('E2E 설정은 서버·흉내를 띄우기 전에 server/.env 의 대상을 본다', () => {
    const src = readFileSync(join(ROOT, 'client/playwright.config.js'), 'utf8')
    const guard = src.indexOf('assertLocalTargets(serverEnv())')
    expect(guard).toBeGreaterThanOrEqual(0)
    expect(guard).toBeLessThan(src.indexOf('export default defineConfig'))
  })
})

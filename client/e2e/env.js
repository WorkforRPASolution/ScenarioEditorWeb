// E2E 공용 값 — playwright.config.js 와 시험이 함께 쓴다.
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
export const SERVER_PORT = 3100
export const CLIENT_PORT = 5180
export const API_URL = `http://127.0.0.1:${SERVER_PORT}/api/scenario-editor/`
// 고장 주입 중계(tools/infra/fault-proxy-server.js). 시험 서버의 EARS_INTERFACE_URL 이 중계를 가리키고, 시험은 제어 포트로 모드를 바꾼다.
export const FAULT_PROXY = { port: 3197, control: 3198 }
export const FAULT_PROXY_URL = `http://127.0.0.1:${FAULT_PROXY.port}`
export const FAULT_CONTROL_URL = `http://127.0.0.1:${FAULT_PROXY.control}`

// server/.env 값(서버가 읽는 것과 같은 파일, dotenv 로 해석). 없으면 빈 값.
export function serverEnv() {
  const path = join(ROOT, 'server/.env')
  if (!existsSync(path)) return {}
  const dotenv = createRequire(join(ROOT, 'server/package.json'))('dotenv')
  return dotenv.parse(readFileSync(path))
}

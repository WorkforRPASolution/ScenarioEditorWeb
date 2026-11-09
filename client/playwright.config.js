import { defineConfig, devices } from '@playwright/test'
import { SERVER_PORT, CLIENT_PORT, FAULT_PROXY, FAULT_PROXY_URL, FAULT_CONTROL_URL, serverEnv } from './e2e/env.js'

// 단독판: 로그인 setup 프로젝트 없음. 시험 데이터 `npm run seed -- reset basic anomaly` 가 먼저다.
// 저장소 루트에서 `npm run e2e` 로 돌린다(루트에 @playwright/test).
// 서버(3100)·클라이언트(5180)를 시험이 직접 띄우고 끝나면 내린다. 5173 은 다른 프로젝트 Vite 가 쓸 수 있어 피하고,
// 이미 떠 있는 서버를 다시 쓰지 않는다(다른 앱이나 다른 환경 변수로 뜬 서버를 시험하지 않게) — 포트(3100·5180·3197·3198)가 비어 있어야 한다.
// 서버 주소·포트와 클라이언트가 부를 API 주소는 env 로 고정한다 — 로컬 server/.env·client/.env 값과 상관없이 같은 곳을 시험한다
// (dotenv·Vite 는 이미 있는 환경 변수를 .env 로 덮어쓰지 않는다).
// 저장 E2E(p2-save)는 InterfaceServer 컨테이너로 SEW_W_ 시나리오를 배포한다. 서버의 InterfaceServer 주소는 고장 주입 중계(3197)이고
// 중계가 server/.env 의 EARS_INTERFACE_URL(없으면 localhost:8080)로 보낸다. 평소 pass, 결과 모름 시험만 제어 포트(3198)로 slow500 을 잠깐 켠다.
const CLIENT_URL = `http://localhost:${CLIENT_PORT}`
const INTERFACE_URL = serverEnv().EARS_INTERFACE_URL || 'http://localhost:8080'

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  use: { baseURL: process.env.E2E_BASE_URL || CLIENT_URL, trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium-1600', use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 1000 } } },
    { name: 'chromium-1920', use: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 } } }
  ],
  webServer: [
    {
      command: `node tools/infra/fault-proxy-server.js --target ${INTERFACE_URL} --port ${FAULT_PROXY.port} --control ${FAULT_PROXY.control}`,
      cwd: '..',
      url: `${FAULT_CONTROL_URL}/health`,
      reuseExistingServer: false,
      timeout: 30_000
    },
    {
      command: 'npm --prefix server start',
      cwd: '..',
      url: `http://127.0.0.1:${SERVER_PORT}/api/health`,
      env: {
        PORT: String(SERVER_PORT), HOST: '127.0.0.1', SE_DEV_USER_OVERRIDE: '1', ALLOWED_ORIGINS: `http://localhost:5173,${CLIENT_URL}`,
        EARS_INTERFACE_URL: FAULT_PROXY_URL
      },
      reuseExistingServer: false,
      timeout: 120_000
    },
    {
      command: `npm --prefix client run dev -- --port ${CLIENT_PORT} --strictPort`,
      cwd: '..',
      url: CLIENT_URL,
      env: { VITE_API_URL: `http://localhost:${SERVER_PORT}/api` },
      reuseExistingServer: false,
      timeout: 120_000
    }
  ]
})

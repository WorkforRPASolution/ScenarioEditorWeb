import { defineConfig, devices } from '@playwright/test'

// 단독판: 로그인 setup 프로젝트 없음. 시험 데이터 `npm run seed -- reset basic anomaly` 가 먼저다.
// 저장소 루트에서 `npm run e2e` 로 돌린다(루트에 @playwright/test).
// 서버(3100)·클라이언트(5180)를 시험이 직접 띄우고 끝나면 내린다. 5173 은 다른 프로젝트 Vite 가 쓸 수 있어 피하고,
// 이미 떠 있는 서버를 다시 쓰지 않는다(다른 앱이나 다른 환경 변수로 뜬 서버를 시험하지 않게) — 두 포트가 비어 있어야 한다.
// 서버 주소·포트와 클라이언트가 부를 API 주소는 env 로 고정한다 — 로컬 server/.env·client/.env 값과 상관없이 같은 곳을 시험한다
// (dotenv·Vite 는 이미 있는 환경 변수를 .env 로 덮어쓰지 않는다).
const CLIENT_URL = 'http://localhost:5180'

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
      command: 'npm --prefix server start',
      cwd: '..',
      url: 'http://127.0.0.1:3100/api/health',
      env: { PORT: '3100', HOST: '127.0.0.1', SE_DEV_USER_OVERRIDE: '1', ALLOWED_ORIGINS: 'http://localhost:5173,http://localhost:5180' },
      reuseExistingServer: false,
      timeout: 120_000
    },
    {
      command: 'npm --prefix client run dev -- --port 5180 --strictPort',
      cwd: '..',
      url: CLIENT_URL,
      env: { VITE_API_URL: 'http://localhost:3100/api' },
      reuseExistingServer: false,
      timeout: 120_000
    }
  ]
})

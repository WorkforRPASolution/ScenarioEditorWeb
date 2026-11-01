// @vitest-environment node
import { describe, it, expect } from 'vitest'
import config from './playwright.config.js'

// E2E 가 띄우는 서버·클라이언트 주소를 로컬 .env 와 상관없이 고정한다(서버 3100·127.0.0.1, 클라이언트가 부르는 API 도 3100).
describe('playwright.config webServer', () => {
  const [server, client] = config.webServer
  it('서버는 127.0.0.1:3100 에 개발용 사용자 바꾸기를 켜고 뜬다', () => {
    expect(server.command).toBe('npm --prefix server start')
    expect(server.url).toBe('http://127.0.0.1:3100/api/health')
    expect(server.env).toMatchObject({ PORT: '3100', HOST: '127.0.0.1', SE_DEV_USER_OVERRIDE: '1' })
    expect(server.env.ALLOWED_ORIGINS.split(',')).toContain('http://localhost:5180')
  })
  it('클라이언트(5180)는 그 서버 API 를 부른다', () => {
    expect(client.command).toContain('--port 5180 --strictPort')
    expect(client.env).toMatchObject({ VITE_API_URL: 'http://localhost:3100/api' })
  })
})

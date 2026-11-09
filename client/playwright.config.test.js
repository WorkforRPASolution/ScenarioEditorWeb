// @vitest-environment node
import { describe, it, expect } from 'vitest'
import config from './playwright.config.js'

// E2E 가 띄우는 서버·클라이언트 주소를 로컬 .env 와 상관없이 고정한다(서버 3100·127.0.0.1, 클라이언트가 부르는 API 도 3100).
// 서버의 InterfaceServer 주소는 고장 주입 중계(3197, 제어 3198)다 — 저장 E2E 의 결과 모름이 중계 모드를 바꾼다(P2-D Task 8).
describe('playwright.config webServer', () => {
  const find = (part) => config.webServer.find((w) => w.command.includes(part))
  const proxy = find('fault-proxy-server.js')
  const server = find('npm --prefix server start')
  const client = find('npm --prefix client run dev')
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
  it('고장 주입 중계가 서버보다 먼저 뜨고, 서버의 InterfaceServer 주소가 그 중계다', () => {
    expect(config.webServer.indexOf(proxy)).toBeLessThan(config.webServer.indexOf(server))
    expect(proxy.command).toMatch(/^node tools\/infra\/fault-proxy-server\.js --target http:\/\/\S+ --port 3197 --control 3198$/)
    expect(proxy.url).toBe('http://127.0.0.1:3198/health')
    expect(proxy.reuseExistingServer).toBe(false)
    expect(server.env.EARS_INTERFACE_URL).toBe('http://127.0.0.1:3197')
  })
})

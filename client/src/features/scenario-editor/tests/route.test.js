import { describe, it, expect, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/shared/api', () => ({ default: { get: vi.fn().mockRejectedValue(new Error('no server')) } }))

describe('편집기 라우트', () => {
  it('/scenario-editor 가 메뉴 meta 와 함께 등록돼 있다', async () => {
    setActivePinia(createPinia())
    const { default: router } = await import('@/router/index.js')
    const route = router.getRoutes().find((r) => r.path === '/scenario-editor')
    expect(route).toBeTruthy()
    expect(route.name).toBe('ScenarioEditor')
    expect(route.meta.layout).toBe('default')
    expect(route.meta.menu).toMatchObject({ mainMenu: 'scenario', subMenu: 'scenario-editor', subMenuLabel: 'Scenario Editor' })
  })

  it('/ 는 /scenario-editor 로 보낸다', async () => {
    setActivePinia(createPinia())
    const { default: router } = await import('@/router/index.js')
    const root = router.getRoutes().find((r) => r.path === '/')
    expect(root.redirect).toBe('/scenario-editor')
  })
})

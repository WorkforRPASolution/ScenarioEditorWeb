import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const get = vi.fn()
vi.mock('@/shared/api', () => ({ default: { get: (...a) => get(...a) } }))

import { useAuthStore } from '@/shared/stores/auth'
import { useProcessPermission } from '@/shared/composables/useProcessPermission'

describe('auth 대역', () => {
  beforeEach(() => { setActivePinia(createPinia()); get.mockReset() })

  it('/me 를 user 로 바꾼다', async () => {
    get.mockResolvedValue({ data: { success: true, data: { singleid: 'sew_multi', name: '시험 사용자', authorityManager: 3, authorityName: 'Manager' } } })
    const s = useAuthStore()
    await s.initialize()
    expect(get).toHaveBeenCalledWith('/scenario-editor/me')
    expect(s.user).toMatchObject({ singleid: 'sew_multi', name: '시험 사용자', authorityManager: 3, roleName: 'Manager' })
    expect(s.isAuthenticated).toBe(true)
    expect(s.initialized).toBe(true)
  })

  it('/me 가 실패하면 user 는 null 이고 초기화는 끝난다', async () => {
    get.mockRejectedValue(new Error('403'))
    const s = useAuthStore()
    await s.initialize()
    expect(s.user).toBe(null)
    expect(s.initialized).toBe(true)
    expect(s.roleName).toBe('Guest')
  })

  it('getter 는 user 에서 계산한다(원본과 같음)', () => {
    const s = useAuthStore()
    s.user = { authorityManager: 1, permissions: { x: true } }
    expect(s.isAdmin).toBe(true)
    expect(s.hasRole([1, 2])).toBe(true)
    expect(s.hasPermission('x')).toBe(true)
    expect(s.hasPermission('y')).toBe(false)
  })
})

describe('useProcessPermission 대역', () => {
  it('반환 키 5개, 받은 목록을 그대로 돌려준다', () => {
    const p = useProcessPermission()
    expect(Object.keys(p).sort()).toEqual(['buildUserProcessFilter', 'canViewAll', 'getFilteredProcesses', 'getUserProcesses', 'setProcesses'])
    p.setProcesses('anything', ['A', 'B'])
    expect(p.getFilteredProcesses('anything')).toEqual(['A', 'B'])
  })
})

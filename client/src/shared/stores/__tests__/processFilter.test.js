import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// auth.js가 store 생성 시 localStorage를 읽으므로 Node 환경 stub
vi.stubGlobal('localStorage', {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
  removeItem: vi.fn()
})

vi.mock('../../api', () => ({
  default: { get: vi.fn(), post: vi.fn() },
  permissionsApi: { getAll: vi.fn(() => Promise.resolve({ data: [] })) }
}))

import { useProcessFilterStore } from '../processFilter'
import { useAuthStore } from '../auth'

describe('processFilter store — RMS source 키', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  // RMS Email Template / Monitor Profile은 setProcesses/getFilteredProcesses에
  // 'rmsEmailTemplate' / 'rmsMonitorProfile' source를 사용한다. 이 키가 source 맵에
  // 없으면 setProcesses가 무시되고 getFilteredProcesses가 항상 빈 목록을 반환한다(버그).
  for (const source of ['rmsEmailTemplate', 'rmsMonitorProfile']) {
    describe(source, () => {
      it('Admin(authorityManager=1)은 setProcesses한 전체 목록을 반환', () => {
        const store = useProcessFilterStore()
        const auth = useAuthStore()
        auth.user = { authorityManager: 1, permissions: {} }

        store.setProcesses(source, ['PHOTO', 'ETCH', 'DIFFUSION'])
        expect(store.getFilteredProcesses(source)).toEqual(['PHOTO', 'ETCH', 'DIFFUSION'])
      })

      it('비-Admin은 자기 공정과의 교집합만 반환', () => {
        const store = useProcessFilterStore()
        const auth = useAuthStore()
        auth.user = { authorityManager: 3, processes: ['PHOTO'], permissions: {} }

        store.setProcesses(source, ['PHOTO', 'ETCH', 'DIFFUSION'])
        expect(store.getFilteredProcesses(source)).toEqual(['PHOTO'])
      })

      it('{value, count} 객체 양식도 교집합 필터', () => {
        const store = useProcessFilterStore()
        const auth = useAuthStore()
        auth.user = { authorityManager: 3, processes: ['ETCH'], permissions: {} }

        store.setProcesses(source, [{ value: 'PHOTO', count: 2 }, { value: 'ETCH', count: 5 }])
        expect(store.getFilteredProcesses(source)).toEqual([{ value: 'ETCH', count: 5 }])
      })
    })
  }
})

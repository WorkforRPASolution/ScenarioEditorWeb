import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useFeatureFlagsStore } from './featureFlags.js'

beforeEach(() => setActivePinia(createPinia()))

describe('featureFlags store', () => {
  it('기본값은 꺼짐이고 setFlag로 켠다', () => {
    const s = useFeatureFlagsStore()
    expect(s.isEnabled('scenarioCopilot')).toBe(false)
    s.setFlag('scenarioCopilot', true)
    expect(s.isEnabled('scenarioCopilot')).toBe(true)
    s.setFlag('scenarioCopilot', false)
    expect(s.isEnabled('scenarioCopilot')).toBe(false)
  })
})

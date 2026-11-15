// 표시 시간대 설정 읽기 — 틀린 값이면 기본값으로 돌리고 한 번 알린다
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { zoneOf, DEFAULT_TZ } = require('../../domain/displayZone')

describe('zoneOf', () => {
  it('맞는 값은 그대로(앞뒤 공백 지움), 없거나 비면 Asia/Seoul', () => {
    expect(zoneOf({ SE_DISPLAY_TZ: ' America/New_York ' }, 'SE_DISPLAY_TZ')).toBe('America/New_York')
    expect(DEFAULT_TZ).toBe('Asia/Seoul')
    for (const env of [{}, { SE_DISPLAY_TZ: '' }, { SE_DISPLAY_TZ: '  ' }, { SE_DISPLAY_TZ: 9 }]) expect(zoneOf(env, 'SE_DISPLAY_TZ')).toBe('Asia/Seoul')
  })
  it('틀린 값이면 기본값으로 돌리고 알린다 — log 가 없어도 던지지 않는다', () => {
    const warned = []
    expect(zoneOf({ SE_DISPLAY_TZ: 'Mars/Olympus' }, 'SE_DISPLAY_TZ', { warn: (m) => warned.push(m) })).toBe('Asia/Seoul')
    expect(warned).toHaveLength(1)
    expect(warned[0]).toContain('SE_DISPLAY_TZ')
    expect(zoneOf({ SE_DISPLAY_TZ: 'Mars/Olympus' }, 'SE_DISPLAY_TZ')).toBe('Asia/Seoul')
  })
})

import { describe, it, expect } from 'vitest'
import { resolveListenAddress, isLoopbackHost, startupWarnings } from '../listen'

describe('서버 주소', () => {
  it('기본은 127.0.0.1:3100', () => {
    expect(resolveListenAddress({})).toEqual({ port: 3100, host: '127.0.0.1' })
  })
  it('PORT·HOST 를 따른다', () => {
    expect(resolveListenAddress({ PORT: '4000', HOST: '0.0.0.0' })).toEqual({ port: 4000, host: '0.0.0.0' })
  })
  it('루프백 주소', () => {
    expect(['127.0.0.1', '::1', '[::1]', 'LOCALHOST'].every(isLoopbackHost)).toBe(true)
    expect(['0.0.0.0', '192.168.0.2', ''].some(isLoopbackHost)).toBe(false)
  })
  it('루프백이 아닌 HOST 로 뜨면 시작 로그 경고 — 쓰기 API 가 막힌다(WRITE_DISABLED)', () => {
    expect(startupWarnings({})).toEqual([])
    expect(startupWarnings({ HOST: 'localhost' })).toEqual([])
    const [w, ...rest] = startupWarnings({ HOST: '0.0.0.0' })
    expect(rest).toEqual([])
    expect(w).toContain('HOST=0.0.0.0')
    expect(w).toContain('WRITE_DISABLED')
  })
})

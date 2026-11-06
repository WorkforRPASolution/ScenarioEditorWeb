import { describe, it, expect } from 'vitest'
import { resolveListenAddress, isLoopbackHost } from '../../../listen'

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
})

import { describe, it, expect } from 'vitest'
import { resolveListenAddress } from '../../../listen'

describe('서버 주소', () => {
  it('기본은 127.0.0.1:3100', () => {
    expect(resolveListenAddress({})).toEqual({ port: 3100, host: '127.0.0.1' })
  })
  it('PORT·HOST 를 따른다', () => {
    expect(resolveListenAddress({ PORT: '4000', HOST: '0.0.0.0' })).toEqual({ port: 4000, host: '0.0.0.0' })
  })
})

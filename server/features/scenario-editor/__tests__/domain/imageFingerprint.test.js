import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { fingerprintOf } from '../../domain/imageFingerprint'

// 그림 내용 지문(SEW-019) — 판이 달라도 같은 그림이면 같은 글자다. 화면이 되돌려 연 세션에서 옛 판·현재 판의 그림을 견줄 때 쓴다.
const A = Buffer.from('png-bytes-aaaaaaaa').toString('base64')
const B = Buffer.from('png-bytes-bbbbbbbb').toString('base64')

describe('fingerprintOf', () => {
  it('정규 base64 글자의 sha256 앞 32자(16진수)', () => {
    expect(fingerprintOf(A)).toBe(createHash('sha256').update(A).digest('hex').slice(0, 32))
    expect(fingerprintOf(A)).toMatch(/^[0-9a-f]{32}$/)
  })
  it('같은 그림은 같고 다른 그림은 다르다', () => {
    expect(fingerprintOf(A)).toBe(fingerprintOf(String(A)))
    expect(fingerprintOf(A)).not.toBe(fingerprintOf(B))
  })
})

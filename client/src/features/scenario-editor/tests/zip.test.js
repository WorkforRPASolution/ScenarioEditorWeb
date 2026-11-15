// 압축 없는 ZIP 묶기 (P3 설계 §4.6·§14.2) — 만든 것을 따로 쓴 읽기(helpers/unzip.js)로 풀어 본다.
import { describe, it, expect } from 'vitest'
import { crc32 as nodeCrc32 } from 'node:zlib'
import { crc32, zipParts } from '../editor/zip'
import { joinParts, unzip } from './helpers/unzip'

const bytesOf = (s) => new TextEncoder().encode(s)
const entry = (name, text) => { const b = bytesOf(text); return { name, blob: new Blob([b]), crc: crc32(b), size: b.length } }
const AT = new Date(2026, 10, 16, 13, 45, 58) // 로컬 시각 2026-11-16 13:45:58

describe('crc32', () => {
  it('알려진 값', () => {
    expect(crc32(bytesOf(''))).toBe(0)
    expect(crc32(bytesOf('123456789'))).toBe(0xcbf43926)
    expect(crc32(bytesOf('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339)
  })
  it('Node 의 crc32 와 같다(0~255 모든 바이트)', () => {
    const all = Uint8Array.from({ length: 1024 }, (_, i) => (i * 7 + 3) & 0xff)
    expect(crc32(all)).toBe(nodeCrc32(all))
  })
})

describe('zipParts', () => {
  it('풀면 이름·바이트·CRC 가 넣은 것과 같다 — 한글 이름은 UTF-8 표시와 함께', async () => {
    const entries = [entry('SEWT_A01_2026-11-16_09-13-02-004.png', 'first image bytes'), entry('설비 가_2026-11-16_10-00-00-000.png', '둘째 그림'), entry('empty.png', '')]
    const out = unzip(await joinParts(zipParts(entries, AT)))
    expect(out.map((e) => e.name)).toEqual(entries.map((e) => e.name))
    expect(out.map((e) => new TextDecoder().decode(e.data))).toEqual(['first image bytes', '둘째 그림', ''])
    for (const e of out) {
      expect(e.crc).toBe(nodeCrc32(e.data))
      expect(e.method).toBe(0)
      expect(e.flags & 0x0800).toBe(0x0800)
    }
  })

  it('시각은 DOS 꼴(2초 단위)로 적힌다', async () => {
    const [e] = unzip(await joinParts(zipParts([entry('a.png', 'x')], AT)))
    expect(e.date).toBe(((2026 - 1980) << 9) | (11 << 5) | 16)
    expect(e.time).toBe((13 << 11) | (45 << 5) | 29)
  })

  it('그림은 Blob 그대로 조각에 든다(다시 복사하지 않는다)', () => {
    const e = entry('a.png', 'x')
    expect(zipParts([e], AT)).toContain(e.blob)
  })

  it('항목이 없어도 빈 ZIP 이다', async () => {
    expect(unzip(await joinParts(zipParts([], AT)))).toEqual([])
  })

  it('4GB·65,535개를 넘으면 던진다', () => {
    const big = { name: 'big.png', blob: new Blob([]), crc: 0, size: 0xffffffff }
    expect(() => zipParts([big, big], AT)).toThrow()
    const many = Array.from({ length: 0x10000 }, (_, i) => ({ name: `${i}.png`, blob: new Blob([]), crc: 0, size: 0 }))
    expect(() => zipParts(many, AT)).toThrow()
  })
})

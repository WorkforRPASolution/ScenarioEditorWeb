import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createImageCache } from '../repo/imageCache'

const png = (n) => Buffer.alloc(n, 1).toString('base64')

describe('imageCache', () => {
  it('뼈대와 PNG 를 저장하고 읽는다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sew-img-'))
    const c = createImageCache({ dir, maxBytes: 10 * 1024 * 1024 })
    await c.store('P.M.N.1', { steps: [] }, [{ id: 's0-bi', base64: png(100) }])
    expect(await c.readSkeleton('P.M.N.1')).toEqual({ steps: [] })
    const p = await c.imagePath('P.M.N.1', 's0-bi')
    expect(readFileSync(p)).toHaveLength(100)
    expect(await c.imagePath('P.M.N.1', 'nope')).toBe(null)
    expect(await c.readSkeleton('P.M.N.2')).toBe(null)
  })
  it('imageId 에 경로 문자가 오면 null', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sew-img-'))
    const c = createImageCache({ dir, maxBytes: 1e9 })
    await c.store('P.M.N.1', {}, [])
    expect(await c.imagePath('P.M.N.1', '../../etc/passwd')).toBe(null)
    expect(await c.imagePath('P.M.N.1', 's0-bi.png')).toBe(null)
  })
  it('용량 상한을 넘으면 오래 안 쓴 버전부터 지운다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sew-img-'))
    const c = createImageCache({ dir, maxBytes: 2500 })
    await c.store('A.1', {}, [{ id: 'i', base64: png(1000) }])
    await new Promise((r) => setTimeout(r, 15))
    await c.store('B.1', {}, [{ id: 'i', base64: png(1000) }])
    await new Promise((r) => setTimeout(r, 15))
    await c.readSkeleton('A.1') // A 를 최근에 씀
    await new Promise((r) => setTimeout(r, 15))
    await c.store('C.1', {}, [{ id: 'i', base64: png(1000) }])
    expect(await c.readSkeleton('A.1')).not.toBe(null)
    expect(await c.readSkeleton('B.1')).toBe(null)
    expect(await c.readSkeleton('C.1')).not.toBe(null)
  })
  it('같은 이미지 id 가 한 번에 두 번 와도 오류 없이 한 장만 저장하고 용량을 두 번 세지 않는다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sew-img-'))
    const c = createImageCache({ dir, maxBytes: 1500 }) // 1000B 한 장은 들어가고, 두 번 세면(2000B) 넘는다
    await c.store('P.M.N.1', { steps: [] }, [{ id: 's0-train-1', base64: png(1000) }, { id: 's0-train-1', base64: png(1000) }])
    expect(await c.readSkeleton('P.M.N.1')).toEqual({ steps: [] })
    expect(readFileSync(await c.imagePath('P.M.N.1', 's0-train-1'))).toHaveLength(1000)
    expect(readdirSync(join(dir, encodeURIComponent('P.M.N.1'))).filter((f) => f.endsWith('.png'))).toEqual(['s0-train-1.png'])
  })
  it('저장 도중 끊긴 디렉터리(완료 표시 없음)는 없는 것으로 본다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sew-img-'))
    const c = createImageCache({ dir, maxBytes: 1e9 })
    await c.store('P.M.N.1', {}, [])
    const fs = await import('node:fs/promises')
    await fs.rm(join(dir, encodeURIComponent('P.M.N.1'), '.done'))
    expect(await c.readSkeleton('P.M.N.1')).toBe(null)
    expect(existsSync(join(dir, encodeURIComponent('P.M.N.1')))).toBe(true)
  })
})

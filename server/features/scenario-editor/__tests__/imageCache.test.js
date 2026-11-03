import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import fsp from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createImageCache } from '../repo/imageCache'

const png = (n) => Buffer.alloc(n, 1).toString('base64')
// 한 번에 저장
const store = async (c, key, skeleton, images) => c.begin(key).commit(skeleton, images)

describe('imageCache', () => {
  it('뼈대와 PNG 를 저장하고 읽는다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sew-img-'))
    const c = createImageCache({ dir, maxBytes: 10 * 1024 * 1024 })
    await store(c, 'P.M.N.1', { steps: [] }, [{ id: 's0-bi', base64: png(100) }])
    expect(await c.readSkeleton('P.M.N.1')).toEqual({ steps: [] })
    const p = await c.imagePath('P.M.N.1', 's0-bi')
    expect(readFileSync(p)).toHaveLength(100)
    expect(await c.imagePath('P.M.N.1', 'nope')).toBe(null)
    expect(await c.readSkeleton('P.M.N.2')).toBe(null)
  })
  it('imageId 에 경로 문자가 오면 null', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sew-img-'))
    const c = createImageCache({ dir, maxBytes: 1e9 })
    await store(c, 'P.M.N.1', {}, [])
    expect(await c.imagePath('P.M.N.1', '../../etc/passwd')).toBe(null)
    expect(await c.imagePath('P.M.N.1', 's0-bi.png')).toBe(null)
  })
  it('용량 상한을 넘으면 오래 안 쓴 버전부터 지운다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sew-img-'))
    const c = createImageCache({ dir, maxBytes: 2500 })
    await store(c, 'A.1', {}, [{ id: 'i', base64: png(1000) }])
    await new Promise((r) => setTimeout(r, 15))
    await store(c, 'B.1', {}, [{ id: 'i', base64: png(1000) }])
    await new Promise((r) => setTimeout(r, 15))
    await c.readSkeleton('A.1') // A 를 최근에 씀
    await new Promise((r) => setTimeout(r, 15))
    await store(c, 'C.1', {}, [{ id: 'i', base64: png(1000) }])
    expect(await c.readSkeleton('A.1')).not.toBe(null)
    expect(await c.readSkeleton('B.1')).toBe(null)
    expect(await c.readSkeleton('C.1')).not.toBe(null)
  })
  it('같은 이미지 id 가 한 번에 두 번 와도 오류 없이 한 장만 저장하고 용량을 두 번 세지 않는다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sew-img-'))
    const c = createImageCache({ dir, maxBytes: 1500 }) // 1000B 한 장은 들어가고, 두 번 세면(2000B) 넘는다
    await store(c, 'P.M.N.1', { steps: [] }, [{ id: 's0-train-1', base64: png(1000) }, { id: 's0-train-1', base64: png(1000) }])
    expect(await c.readSkeleton('P.M.N.1')).toEqual({ steps: [] })
    expect(readFileSync(await c.imagePath('P.M.N.1', 's0-train-1'))).toHaveLength(1000)
    expect(readdirSync(join(dir, encodeURIComponent('P.M.N.1'))).filter((f) => f.endsWith('.png'))).toEqual(['s0-train-1.png'])
  })
  it('저장 도중 끊긴 디렉터리(완료 표시 없음)는 없는 것으로 본다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sew-img-'))
    const c = createImageCache({ dir, maxBytes: 1e9 })
    await store(c, 'P.M.N.1', {}, [])
    const fs = await import('node:fs/promises')
    await fs.rm(join(dir, encodeURIComponent('P.M.N.1'), '.done'))
    expect(await c.readSkeleton('P.M.N.1')).toBe(null)
    expect(existsSync(join(dir, encodeURIComponent('P.M.N.1')))).toBe(true)
  })

  it('한 버전이 maxBytes 보다 커도 자기 저장 뒤에 읽히고, 오래된 완료 버전만 지운다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sew-img-'))
    const c = createImageCache({ dir, maxBytes: 2500 })
    await store(c, 'A.1', {}, [{ id: 'i', base64: png(1000) }])
    await new Promise((r) => setTimeout(r, 15))
    await store(c, 'BIG.1', { big: true }, [{ id: 'i', base64: png(3000) }]) // 혼자서 상한(2500)을 넘는다
    expect(await c.readSkeleton('A.1')).toBe(null)
    expect(await c.readSkeleton('BIG.1')).toEqual({ big: true })
    expect(readFileSync(await c.imagePath('BIG.1', 'i'))).toHaveLength(3000)
  })
  it('완료 표시(.done) 없는 디렉터리(저장 중이거나 끊긴 것)는 용량이 넘어도 지우지 않는다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sew-img-'))
    const partial = join(dir, encodeURIComponent('PART.1'))
    mkdirSync(partial)
    writeFileSync(join(partial, 'i.png'), Buffer.alloc(1000, 1))
    const c = createImageCache({ dir, maxBytes: 2500 })
    await store(c, 'A.1', {}, [{ id: 'i', base64: png(1000) }])
    await new Promise((r) => setTimeout(r, 15))
    await store(c, 'B.1', {}, [{ id: 'i', base64: png(1000) }]) // 합계가 상한을 넘는다 -> 완료된 A 가 지워진다
    expect(await c.readSkeleton('A.1')).toBe(null)
    expect(await c.readSkeleton('B.1')).not.toBe(null)
    expect(existsSync(join(partial, 'i.png'))).toBe(true)
  })
  it('지우다 실패해도 store 는 성공한다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sew-img-'))
    const c = createImageCache({ dir, maxBytes: 1500 })
    await store(c, 'A.1', {}, [{ id: 'i', base64: png(1000) }])
    await new Promise((r) => setTimeout(r, 15))
    const realRm = fsp.rm
    const spy = vi.spyOn(fsp, 'rm').mockImplementation(async (p, o) => {
      if (String(p) === join(dir, encodeURIComponent('A.1'))) throw Object.assign(new Error('EACCES'), { code: 'EACCES' })
      return realRm(p, o)
    })
    try {
      await expect(store(c, 'B.1', { b: 1 }, [{ id: 'i', base64: png(1000) }])).resolves.toBeUndefined()
      expect(spy).toHaveBeenCalledWith(join(dir, encodeURIComponent('A.1')), expect.anything()) // 지우기를 시도는 했다
    } finally {
      spy.mockRestore()
    }
    expect(await c.readSkeleton('B.1')).toEqual({ b: 1 })
  })
  it('특수 키(빈 문자열·.·..)는 디스크를 건드리기 전에 거부한다', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'sew-parent-'))
    writeFileSync(join(parent, 'keep.txt'), 'x')
    const dir = join(parent, 'cache')
    const c = createImageCache({ dir, maxBytes: 1e9 })
    for (const key of ['', '.', '..', undefined]) {
      await expect(store(c, key, {}, [])).rejects.toThrow()
    }
    expect(readdirSync(parent)).toEqual(['keep.txt'])
    expect(existsSync(dir)).toBe(false)
    expect(await c.readSkeleton('..')).toBe(null)
    expect(await c.imagePath('..', 'i')).toBe(null)
  })
  it('이미지 id 가 하나라도 틀리면 디렉터리를 만들기 전에 거부한다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sew-img-'))
    const c = createImageCache({ dir, maxBytes: 1e9 })
    await expect(store(c, 'P.M.N.1', {}, [{ id: 'ok', base64: png(10) }, { id: 'a/b', base64: png(10) }])).rejects.toThrow('a/b')
    await expect(store(c, 'P.M.N.2', {}, [{ id: 'ok', base64: png(10) }, { id: 5, base64: png(10) }])).rejects.toThrow()
    await expect(store(c, 'P.M.N.3', {}, [{ id: 'ok', base64: png(10) }, { base64: png(10) }])).rejects.toThrow()
    expect(readdirSync(dir)).toEqual([])
  })
  it('긴 시나리오 이름 키는 해시 디렉터리 이름으로 저장하고 읽는다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sew-img-'))
    const c = createImageCache({ dir, maxBytes: 1e9 })
    const key = `P.M.${'가'.repeat(40)}.1730000000000` // encodeURIComponent 하면 200자를 넘는다
    await store(c, key, { long: true }, [{ id: 's0-bi', base64: png(50) }])
    expect(await c.readSkeleton(key)).toEqual({ long: true })
    expect(readFileSync(await c.imagePath(key, 's0-bi'))).toHaveLength(50)
    expect(readdirSync(dir)).toEqual([`~${createHash('sha256').update(key).digest('hex')}`])
    expect(await c.readSkeleton(`${key}x`)).toBe(null)
  })
  it('Windows 에서 못 쓰는 문자(<>:"/\\|?*)는 디렉터리 이름에 남지 않고, * 와 %2A 는 다른 키다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sew-img-'))
    const c = createImageCache({ dir, maxBytes: 1e9 })
    await store(c, 'P/M/a<b>c:d"e\\f|g?h*i/1', { star: true }, [{ id: 's0-bi', base64: png(10) }])
    await store(c, 'P/M/h%2Ai/1', { pct: true }, [])
    for (const name of readdirSync(dir)) expect(name).not.toMatch(/[<>:"/\\|?*]/)
    expect(await c.readSkeleton('P/M/a<b>c:d"e\\f|g?h*i/1')).toEqual({ star: true })
    expect(await c.readSkeleton('P/M/h%2Ai/1')).toEqual({ pct: true })
    expect(readFileSync(await c.imagePath('P/M/a<b>c:d"e\\f|g?h*i/1', 's0-bi'))).toHaveLength(10)
  })
  it('200자 이하 키는 encodeURIComponent 이름을 그대로 쓴다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sew-img-'))
    const c = createImageCache({ dir, maxBytes: 1e9 })
    const key = 'P.M.가나다.1730000000000'
    await store(c, key, {}, [])
    expect(readdirSync(dir)).toEqual([encodeURIComponent(key)])
  })

  describe('흘려 쓰기 (begin → writeImage → commit)', () => {
    const fresh = (maxBytes = 1e9) => { const dir = mkdtempSync(join(tmpdir(), 'sew-img-')); return { dir, c: createImageCache({ dir, maxBytes }) } }
    it('commit 전에는 없는 판이고, commit 뒤에는 먼저 쓴 이미지와 commit 의 이미지가 모두 있다', async () => {
      const { c } = fresh()
      const w = c.begin('K')
      await w.writeImage('s0-bi', png(100))
      expect(await c.readSkeleton('K')).toBe(null)
      expect(await c.imagePath('K', 's0-bi')).toBe(null)
      await w.commit({ steps: [] }, [{ id: 's0-train-0', base64: png(50) }])
      expect(await c.readSkeleton('K')).toEqual({ steps: [] })
      expect(readFileSync(await c.imagePath('K', 's0-bi'))).toHaveLength(100)
      expect(readFileSync(await c.imagePath('K', 's0-train-0'))).toHaveLength(50)
    })
    it('다시 쓰면 그 판의 옛 파일은 남지 않는다', async () => {
      const { c } = fresh()
      await store(c, 'K', { v: 1 }, [{ id: 'old', base64: png(10) }])
      const w = c.begin('K')
      await w.writeImage('new', png(10))
      expect(await c.readSkeleton('K')).toBe(null)
      await w.commit({ v: 2 }, [])
      expect(await c.imagePath('K', 'old')).toBe(null)
      expect(await c.imagePath('K', 'new')).not.toBe(null)
    })
    it('removeImages 는 먼저 쓴 이미지를 지운다', async () => {
      const { c } = fresh()
      const w = c.begin('K')
      await w.writeImage('a', png(10))
      await w.writeImage('b', png(10))
      await w.removeImages(['a'])
      await w.commit({}, [])
      expect(await c.imagePath('K', 'a')).toBe(null)
      expect(await c.imagePath('K', 'b')).not.toBe(null)
    })
    it('abort 는 쓰던 디렉터리를 지우고, 아무것도 안 썼어도 실패하지 않는다', async () => {
      const { c, dir } = fresh()
      const w = c.begin('K')
      await w.writeImage('a', png(10))
      await w.abort()
      expect(readdirSync(dir)).toEqual([])
      await expect(c.begin('L').abort()).resolves.toBeUndefined()
    })
    it('writeImage 는 형식이 틀린 id 를 디스크를 건드리기 전에 거부한다', async () => {
      const { c, dir } = fresh()
      await expect(c.begin('K').writeImage('../x', png(10))).rejects.toThrow('../x')
      expect(readdirSync(dir)).toEqual([])
    })
    it('begin 은 특수 키를 바로 거부한다', () => {
      const { c } = fresh()
      expect(() => c.begin('..')).toThrow()
    })
    it('먼저 쓴 이미지도 용량 계산에 든다', async () => {
      const { c } = fresh(2500)
      await store(c, 'A', {}, [{ id: 'i', base64: png(1000) }])
      await new Promise((r) => setTimeout(r, 15))
      const w = c.begin('B')
      await w.writeImage('i', png(2000))
      await w.commit({}, [])
      expect(await c.readSkeleton('A')).toBe(null)
      expect(await c.readSkeleton('B')).not.toBe(null)
    })
  })
})

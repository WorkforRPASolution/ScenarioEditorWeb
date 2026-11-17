import { describe, it, expect, vi } from 'vitest'
import { LOCAL_BASE_ACCEPT, LOCAL_FILE_MAX_BYTES, localBaseKey, prepareLocalBase, sizeDiffers } from '../editor/localBase'
import { SNAPSHOT_BASE_MAX_BYTES, snapshotKey } from '../editor/snapshotStep'

const fileOf = (name, bytes, { type = 'image/png', lastModified = 1763254800000 } = {}) => new File([new Uint8Array(bytes)], name, { type, lastModified })
const sized = (name, size, opts) => { const f = fileOf(name, 1, opts); Object.defineProperty(f, 'size', { value: size }); return f }
const deps = (over = {}) => ({
  decode: vi.fn(async () => ({ width: 1920, height: 1080 })),
  toPng: vi.fn(async () => new Blob([new Uint8Array(7)], { type: 'image/png' })),
  isPng: vi.fn(async () => true),
  ...over
})

describe('그림 파일을 기준 화면으로(localBase)', () => {
  it('받는 형식: PNG·JPG·BMP', () => {
    expect(LOCAL_BASE_ACCEPT.split(',')).toEqual(['.png', '.jpg', '.jpeg', '.bmp', 'image/png', 'image/jpeg', 'image/bmp'])
  })
  it('같은 파일(이름·크기·고친 때)은 같은 키 — 스냅샷 키와 겹치지 않는다', () => {
    const a = fileOf('screen.png', 10)
    expect(localBaseKey(a)).toBe(localBaseKey(fileOf('screen.png', 10)))
    expect(localBaseKey(a)).not.toBe(localBaseKey(fileOf('screen.png', 11)))
    expect(localBaseKey(a)).not.toBe(localBaseKey(fileOf('screen2.png', 10)))
    expect(localBaseKey(a)).not.toBe(localBaseKey(fileOf('screen.png', 10, { lastModified: 1 })))
    expect(localBaseKey(a)).not.toBe(snapshotKey('file', 'screen.png'))
  })
  it('PNG 는 바이트 그대로 쓰고 크기를 함께 준다 — 파일 참조가 아니라 메모리로 옮긴 사본이다(고른 뒤 디스크의 파일이 바뀌거나 지워져도 읽힌다)', async () => {
    const f = new File([new Uint8Array([9, 8, 7, 6, 5])], 'screen.png', { type: '', lastModified: 1763254800000 })
    const d = deps()
    const r = await prepareLocalBase(f, d)
    expect(r).toMatchObject({ key: localBaseKey(f), w: 1920, h: 1080 })
    expect(r.blob).not.toBe(f)
    expect(r.blob).not.toBeInstanceOf(File)
    expect(r.blob.type).toBe('image/png')
    expect([...new Uint8Array(await r.blob.arrayBuffer())]).toEqual([9, 8, 7, 6, 5])
    expect(d.decode).toHaveBeenCalledWith(f)
    expect(d.toPng).not.toHaveBeenCalled()
  })
  it('PNG 파일을 읽지 못하면(고르자마자 지워짐) notImage', async () => {
    const f = fileOf('gone.png', 10)
    f.arrayBuffer = () => Promise.reject(new Error('NotFoundError'))
    await expect(prepareLocalBase(f, deps())).rejects.toMatchObject({ reason: 'notImage' })
  })
  it('PNG 가 아니면(JPG·BMP) PNG 로 바꾼 것을 쓴다 — 서버는 PNG 만 받는다', async () => {
    const f = fileOf('screen.jpg', 10, { type: 'image/jpeg' })
    const png = new Blob([new Uint8Array(5)], { type: 'image/png' })
    const bitmap = { width: 800, height: 600 }
    const d = deps({ isPng: vi.fn(async () => false), decode: vi.fn(async () => bitmap), toPng: vi.fn(async () => png) })
    const r = await prepareLocalBase(f, d)
    expect(r).toEqual({ key: localBaseKey(f), blob: png, w: 800, h: 600 })
    expect(d.toPng).toHaveBeenCalledWith(bitmap)
  })
  it('그림으로 풀리지 않는 파일·빈 파일·파일이 아닌 것은 notImage', async () => {
    const bad = deps({ decode: vi.fn(async () => { throw new Error('decode') }) })
    await expect(prepareLocalBase(fileOf('a.txt', 10, { type: 'text/plain' }), bad)).rejects.toMatchObject({ reason: 'notImage' })
    await expect(prepareLocalBase(fileOf('empty.png', 0), deps())).rejects.toMatchObject({ reason: 'notImage' })
    await expect(prepareLocalBase(null, deps())).rejects.toMatchObject({ reason: 'notImage' })
    await expect(prepareLocalBase(fileOf('zero.png', 10), deps({ decode: vi.fn(async () => ({ width: 0, height: 10 })) }))).rejects.toMatchObject({ reason: 'notImage' })
    await expect(prepareLocalBase(fileOf('a.jpg', 10), deps({ isPng: vi.fn(async () => false), toPng: vi.fn(async () => { throw new Error('canvas') }) }))).rejects.toMatchObject({ reason: 'notImage' })
  })
  it('올릴 PNG 가 한 장 한도(10MB)를 넘으면 tooLarge — 스냅샷과 같은 한도', async () => {
    const big = sized('big.png', SNAPSHOT_BASE_MAX_BYTES + 1)
    await expect(prepareLocalBase(big, deps())).rejects.toMatchObject({ reason: 'tooLarge' })
    const ok = sized('ok.png', SNAPSHOT_BASE_MAX_BYTES)
    await expect(prepareLocalBase(ok, deps())).resolves.toMatchObject({ key: localBaseKey(ok) })
    // 바꾼 PNG 가 넘을 때도
    const huge = { size: SNAPSHOT_BASE_MAX_BYTES + 1 }
    await expect(prepareLocalBase(fileOf('a.bmp', 10, { type: 'image/bmp' }), deps({ isPng: vi.fn(async () => false), toPng: vi.fn(async () => huge) }))).rejects.toMatchObject({ reason: 'tooLarge' })
  })
  it('아주 큰 파일은 풀어 보지 않고 tooLarge', async () => {
    const d = deps()
    await expect(prepareLocalBase(sized('huge.bmp', LOCAL_FILE_MAX_BYTES + 1, { type: 'image/bmp' }), d)).rejects.toMatchObject({ reason: 'tooLarge' })
    expect(d.decode).not.toHaveBeenCalled()
  })
  it('sizeDiffers: 너비나 높이가 다르면 참, 한쪽을 모르면 거짓', () => {
    expect(sizeDiffers({ w: 1920, h: 1080 }, { w: 1920, h: 1080 })).toBe(false)
    expect(sizeDiffers({ w: 1920, h: 1080 }, { w: 1280, h: 1080 })).toBe(true)
    expect(sizeDiffers({ w: 1920, h: 1080 }, { w: 1920, h: 1024 })).toBe(true)
    expect(sizeDiffers({ w: 1920, h: 1080 }, null)).toBe(false)
    expect(sizeDiffers(null, { w: 1, h: 1 })).toBe(false)
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { refUrl, newTempId, uploadIdsOf, bitmapOf } from '../editor/images'

const session = { source: { process: 'P 1', model: 'M/2', name: 'N', crtime: 1700000000000, fileId: 'F9' } }

describe('refUrl', () => {
  let n
  beforeEach(() => {
    n = 0
    globalThis.URL.createObjectURL = vi.fn(() => `blob:t${++n}`)
  })
  afterEach(() => { delete globalThis.URL.createObjectURL })

  it('source 는 뼈대 이미지 경로(구간 인코딩)', () => {
    const u = refUrl({ from: 'source', id: 'img1' }, { session })
    expect(u).toContain('/scenario-editor/scenarios/P%201/M%2F2/N/versions/1700000000000/files/F9/images/img1')
  })
  it('other 는 그 판의 경로', () => {
    const u = refUrl({ from: 'other', process: 'Q', model: 'R', name: 'S', crtime: 5, fileId: 'G', id: 'i2' }, { session })
    expect(u).toContain('/scenario-editor/scenarios/Q/R/S/versions/5/files/G/images/i2')
  })
  it('upload: Blob 있으면 object URL 하나를 재사용, 없으면 초안 그림, 둘 다 없으면 null', () => {
    const blob = new Blob(['x'])
    const uploads = new Map([['t1', blob]])
    const a = refUrl({ from: 'upload', tempId: 't1' }, { session, uploads, draftId: 'd1' })
    const b = refUrl({ from: 'upload', tempId: 't1' }, { session, uploads, draftId: 'd1' })
    expect(a).toBe('blob:t1'); expect(b).toBe(a); expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
    expect(refUrl({ from: 'upload', tempId: 't9' }, { session, uploads, draftId: 'd 1' })).toContain('/scenario-editor/drafts/d%201/images/t9')
    expect(refUrl({ from: 'upload', tempId: 't9' }, { session, uploads })).toBeNull()
  })
  it('literal·null 은 null', () => {
    expect(refUrl({ literal: 'x' }, { session })).toBeNull()
    expect(refUrl(null, { session })).toBeNull()
  })
})

describe('uploadIdsOf', () => {
  it('스텝들의 올릴 그림 참조 tempId — 기준 화면·찾을 그림, 겹치지 않게, 다른 출처 참조·literal 은 빼고', () => {
    const steps = [
      { images: { base: { from: 'upload', tempId: 'b1' }, train: { 0: { from: 'upload', tempId: 't1' }, 1: { from: 'source', id: 'x' } } } },
      { images: { base: { literal: 'AA==' }, train: { 0: { from: 'upload', tempId: 't1' }, 2: { from: 'other', process: 'P', model: 'M', name: 'N', crtime: 1, fileId: 'F', id: 'y' } } } },
      { images: { base: null, train: {} } }, {}
    ]
    expect(uploadIdsOf(steps)).toEqual(['b1', 't1'])
    expect(uploadIdsOf([])).toEqual([])
  })
})

describe('newTempId', () => {
  it('규칙에 맞고 매번 다르다', () => {
    const a = newTempId(), b = newTempId()
    expect(a).toMatch(/^[A-Za-z0-9_-]{1,64}$/); expect(a).not.toBe(b); expect(a[0]).toBe('t')
  })
})

describe('bitmapOf — 판정 서버에 보낼 그림을 풀 때', () => {
  afterEach(() => { vi.unstubAllGlobals() })
  it('브라우저가 색을 바꾸지 않게 푼다(PNG 의 색 정보를 적용하면 똑같은 그림의 점수가 떨어진다)', async () => {
    const made = { width: 2, height: 1 }
    const create = vi.fn(async () => made)
    vi.stubGlobal('createImageBitmap', create)
    const blob = new Blob(['x'])
    expect(await bitmapOf(blob)).toBe(made)
    expect(create).toHaveBeenCalledWith(blob, { colorSpaceConversion: 'none' })
  })
})

import { isPng } from '../editor/images'
describe('isPng — 바이트 머리로 PNG 인지 본다(파일 이름·type 을 믿지 않는다)', () => {
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  it('PNG 서명이면 참, 아니면(JPG·짧은 것·빈 것) 거짓', async () => {
    expect(await isPng(new Blob([new Uint8Array([...PNG, 1, 2, 3])], { type: 'image/jpeg' }))).toBe(true)
    expect(await isPng(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0])], { type: 'image/png' }))).toBe(false)
    expect(await isPng(new Blob([new Uint8Array(PNG.slice(0, 7))]))).toBe(false)
    expect(await isPng(new Blob([]))).toBe(false)
  })
})

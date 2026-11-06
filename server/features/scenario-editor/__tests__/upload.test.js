import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const express = require('express')
const { multipartMeta, createMultipartMeta } = require('../upload')

let server
let base
let seen
let handlerCalls = 0
let highWater = 0
let streamBase
beforeAll(async () => {
  const app = express()
  app.post('/up', multipartMeta, (req, res) => { handlerCalls++; seen = { meta: req.seMeta, images: [...req.seImages.entries()].map(([k, v]) => [k, v.length]) }; res.json({ ok: true }) })
  app.post('/up2', createMultipartMeta({ onBuffered: (n) => { highWater = Math.max(highWater, n) } }), (req, res) => { handlerCalls++; res.json({ ok: true }) })
  app.use((err, req, res, next) => res.status(err.statusCode || 500).json({ code: err.code, error: err.message }))
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r) })
  base = `http://127.0.0.1:${server.address().port}`
})
afterAll(() => new Promise((r) => server.close(r)))

const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const png = (size = 16) => Buffer.concat([PNG_HEAD, Buffer.alloc(Math.max(0, size - 8), 1)])
function send({ meta = '{"a":1}', files = [] } = {}) {
  const fd = new FormData()
  if (meta !== null) fd.append('meta', meta)
  for (const [name, buf] of files) fd.append(name, new Blob([buf], { type: 'image/png' }), 'x.png')
  return fetch(`${base}/up`, { method: 'POST', body: fd })
}

describe('multipartMeta', () => {
  it('meta JSON 과 PNG 파일을 req.seMeta·req.seImages 로 낸다', async () => {
    const res = await send({ files: [['img:a-1_B', png(20)], ['img:b', png(30)]] })
    expect(res.status).toBe(200)
    expect(seen).toEqual({ meta: { a: 1 }, images: [['a-1_B', 20], ['b', 30]] })
  })
  it('파일이 없어도 된다', async () => {
    expect((await send()).status).toBe(200)
    expect(seen.images).toEqual([])
  })
  it('meta 가 JSON 이 아니면 400', async () => {
    const res = await send({ meta: '{not json' })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('BAD_REQUEST')
  })
  it('meta 필드가 없으면 400', async () => {
    expect((await send({ meta: null })).status).toBe(400)
  })
  it('PNG 머리가 아니면 400', async () => {
    const res = await send({ files: [['img:a', Buffer.from('not a png at all')]] })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('BAD_REQUEST')
  })
  it('잘못된 tempId 는 400', async () => {
    for (const name of ['img:a b', 'img:', `img:${'x'.repeat(65)}`, 'photo']) {
      const res = await send({ files: [[name, png()]] })
      expect(res.status, name).toBe(400)
    }
  })
  it('한 장이 10MB 를 넘으면 413', async () => {
    const res = await send({ files: [['img:big', png(10 * 1048576 + 1)]] })
    expect(res.status).toBe(413)
    expect((await res.json()).code).toBe('PAYLOAD_TOO_LARGE')
  })
  it('파일 합계가 50MB 를 넘으면 413', async () => {
    const files = Array.from({ length: 6 }, (_, i) => [`img:f${i}`, png(9 * 1048576)])
    const res = await send({ files })
    expect(res.status).toBe(413)
    expect((await res.json()).code).toBe('PAYLOAD_TOO_LARGE')
  })
  it('meta 필드가 1MB 를 넘어도 10MB 까지는 받는다', async () => {
    const big = JSON.stringify({ pad: 'x'.repeat(3 * 1048576) })
    const res = await send({ meta: big })
    expect(res.status).toBe(200)
    expect(seen.meta.pad.length).toBe(3 * 1048576)
  })
  it('meta 필드가 10MB 를 넘으면 413', async () => {
    const res = await send({ meta: JSON.stringify({ pad: 'x'.repeat(10 * 1048576 + 10) }) })
    expect(res.status).toBe(413)
    expect((await res.json()).code).toBe('PAYLOAD_TOO_LARGE')
  })
  it('meta 외 다른 필드는 400', async () => {
    const fd = new FormData()
    fd.append('meta', '{}'); fd.append('other', 'x')
    const res = await fetch(`${base}/up`, { method: 'POST', body: fd })
    expect(res.status).toBe(400)
  })
  it('Content-Length 가 한도(합계 50MB + meta 10MB + 여유)를 넘으면 본문을 받기 전에 413 이고 핸들러는 돌지 않는다', async () => {
    handlerCalls = 0
    const files = [['img:a', png(35 * 1048576)], ['img:b', png(35 * 1048576)]]
    const res = await send({ files })
    expect(res.status).toBe(413)
    expect((await res.json()).code).toBe('PAYLOAD_TOO_LARGE')
    expect(handlerCalls).toBe(0)
  })
  it('Content-Length 없이 흘려 보내는 요청도 받는 중에 합계 50MB 를 넘으면 413 이고 전부 모아 두지 않는다', async () => {
    handlerCalls = 0; highWater = 0
    const B = 'XBOUNDARYX'
    const chunk = Buffer.alloc(1048576, 1)
    async function* body() {
      yield Buffer.from(`--${B}\r\nContent-Disposition: form-data; name="meta"\r\n\r\n{}\r\n`)
      for (let i = 0; i < 9; i++) { // 9 x 9MB = 81MB
        yield Buffer.from(`--${B}\r\nContent-Disposition: form-data; name="img:f${i}"; filename="x.png"\r\nContent-Type: image/png\r\n\r\n`)
        yield PNG_HEAD
        for (let k = 0; k < 9; k++) yield chunk
        yield Buffer.from('\r\n')
      }
      yield Buffer.from(`--${B}--\r\n`)
    }
    const res = await fetch(`${base}/up2`, { method: 'POST', headers: { 'Content-Type': `multipart/form-data; boundary=${B}` }, body: body(), duplex: 'half' })
    expect(res.status).toBe(413)
    expect(handlerCalls).toBe(0)
    expect(highWater).toBeGreaterThan(0)
    expect(highWater).toBeLessThanOrEqual(50 * 1048576 + 2 * 1048576) // 50MB 를 넘긴 청크에서 멈춘다 — 81MB 전부는 아니다
  })
})

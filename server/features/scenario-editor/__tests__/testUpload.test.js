// Vision·OCR 시험 전용 멀티파트(P4 설계 §5.2) — 파일 `source`·`train`(각 4 MiB)과 `meta`(JSON). 저장용 처리기(upload.js)와 필드 이름·한도가 다르다.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createRequire } from 'node:module'
import http from 'node:http'
const require = createRequire(import.meta.url)
const express = require('express')
const { testUpload } = require('../testUpload')

const MIB = 1024 * 1024
let server
let base
let seen
let calls = 0
beforeAll(async () => {
  const app = express()
  const done = (req, res) => {
    calls++
    seen = { meta: req.seMeta, source: req.seTest.source.length, train: req.seTest.train ? req.seTest.train.length : null }
    res.json({ ok: true })
  }
  app.post('/vision', testUpload(['source', 'train']), done)
  app.post('/ocr', testUpload(['source']), done)
  app.use((err, req, res, next) => res.status(err.statusCode || 500).json({ code: err.code, error: err.message, details: err.details ?? null }))
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r) })
  base = `http://127.0.0.1:${server.address().port}`
})
afterAll(() => new Promise((r) => { server.closeAllConnections(); server.close(r) }))

const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const png = (size = 16) => Buffer.concat([PNG_HEAD, Buffer.alloc(Math.max(0, size - 8), 1)])
function send(path, { meta = '{"accept":0.9}', files = [['source', png(20)], ['train', png(12)]], fields = [] } = {}) {
  const fd = new FormData()
  if (meta !== null) fd.append('meta', meta)
  for (const [name, value] of fields) fd.append(name, value)
  for (const [name, buf] of files) fd.append(name, new Blob([buf], { type: 'image/png' }), 'x.png')
  return fetch(`${base}${path}`, { method: 'POST', body: fd })
}
const answer = async (res) => ({ status: res.status, ...(await res.json()) })

describe('testUpload', () => {
  it('Vision: source·train 과 meta 를 req.seTest·req.seMeta 로 낸다', async () => {
    expect((await send('/vision')).status).toBe(200)
    expect(seen).toEqual({ meta: { accept: 0.9 }, source: 20, train: 12 })
  })
  it('OCR: source 만 받는다 — train 을 보내면 400', async () => {
    expect((await send('/ocr', { files: [['source', png(30)]] })).status).toBe(200)
    expect(seen).toEqual({ meta: { accept: 0.9 }, source: 30, train: null })
    expect((await answer(await send('/ocr'))).code).toBe('BAD_REQUEST')
  })
  it('그림 한 장은 4 MiB 까지 — 꼭 4 MiB 는 받고, 넘으면 413 VISION_TOO_LARGE(limit image)', async () => {
    expect((await send('/ocr', { files: [['source', png(4 * MIB)]] })).status).toBe(200)
    expect(seen.source).toBe(4 * MIB)
    const before = calls
    const out = await answer(await send('/ocr', { files: [['source', png(4 * MIB + 1)]] }))
    expect([out.status, out.code, out.details]).toEqual([413, 'VISION_TOO_LARGE', { limit: 'image', maxBytes: 4 * MIB }])
    expect(calls).toBe(before)
  })
  it('길이 머리글이 요청 한도(9 MiB)를 넘으면 본문을 읽지 않고 413(limit request)', async () => {
    const before = calls
    const out = await new Promise((resolve, reject) => {
      const req = http.request(`${base}/vision`, { method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=x', 'Content-Length': String(9 * MIB + 1) } }, (res) => {
        let body = ''
        res.on('data', (c) => { body += c })
        res.on('end', () => { resolve({ status: res.statusCode, ...JSON.parse(body) }); req.destroy() })
      })
      req.on('error', reject)
      req.write('--x\r\n') // 본문을 다 보내지 않는다 — 머리글만으로 답이 와야 한다
    })
    expect([out.status, out.code, out.details]).toEqual([413, 'VISION_TOO_LARGE', { limit: 'request', maxBytes: 9 * MIB }])
    expect(calls).toBe(before)
  })
  it('있어야 할 그림이 없으면 400', async () => {
    expect((await answer(await send('/vision', { files: [['source', png()]] }))).code).toBe('BAD_REQUEST')
    expect((await answer(await send('/vision', { files: [['train', png()]] }))).code).toBe('BAD_REQUEST')
    expect((await answer(await send('/ocr', { files: [] }))).code).toBe('BAD_REQUEST')
  })
  it('모르는 파일 필드·같은 필드 둘은 400', async () => {
    expect((await send('/vision', { files: [['source', png()], ['train', png()], ['img:a', png()]] })).status).toBe(400)
    expect((await send('/vision', { files: [['source', png()], ['source', png()], ['train', png()]] })).status).toBe(400)
  })
  it('PNG 서명이 없으면 400', async () => {
    const out = await answer(await send('/vision', { files: [['source', Buffer.from('not a png at all')], ['train', png()]] }))
    expect([out.status, out.code]).toEqual([400, 'BAD_REQUEST'])
    expect((await send('/vision', { files: [['source', png()], ['train', Buffer.alloc(3)]] })).status).toBe(400)
  })
  it('meta 가 없거나, JSON 이 아니거나, 객체가 아니거나, 16 KB 를 넘으면 400', async () => {
    expect((await send('/vision', { meta: null })).status).toBe(400)
    expect((await send('/vision', { meta: '{not json' })).status).toBe(400)
    expect((await send('/vision', { meta: '[1]' })).status).toBe(400)
    expect((await send('/vision', { meta: '"x"' })).status).toBe(400)
    expect((await send('/vision', { meta: JSON.stringify({ accept: 0.9, pad: 'x'.repeat(17000) }) })).status).toBe(400)
  })
  it('meta 말고 다른 글 필드는 400', async () => {
    expect((await send('/vision', { fields: [['other', 'x']] })).status).toBe(400)
  })
})

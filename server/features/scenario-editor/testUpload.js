'use strict'
// Vision·OCR 시험 전용 멀티파트 (P4 설계 §5.2) — 브라우저가 준비한 PNG 를 받는다.
// 파일 필드: source(시험할 화면의 조각 — Vision 은 검색 영역, OCR 은 OCR 영역) · train(찾을 그림, Vision 만). 글 필드: meta(JSON 객체) 하나.
// 결과 req.seMeta(객체), req.seTest = { source: Buffer, train?: Buffer }.
// 저장용 처리기(upload.js — img:<tempId> 200장·합계 50MB·meta 10MB)와 필드 이름·한도가 달라 따로 둔다.
// 판정 서버는 직렬화한 요청 4 MiB 까지만 받는다 — 그림 한 장이 4 MiB 를 넘으면 어차피 보낼 수 없다. 두 그림의 합은 서비스가 직렬화한 길이로 본다.
const multer = require('multer')
const { seError } = require('./errors')

const MIB = 1024 * 1024
const MAX_FILE = 4 * MIB
const MAX_META = 16 * 1024
const MAX_REQUEST = 2 * MAX_FILE + MIB // 그림 둘 + meta·경계·머리글 여유
const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const bad = (message) => seError(400, 'BAD_REQUEST', message)
const LIMIT_BYTES = { image: MAX_FILE, request: MAX_REQUEST }
const tooLarge = (limit) => seError(413, 'VISION_TOO_LARGE', '보낼 그림이 너무 큽니다(4MB 까지)', { limit, maxBytes: LIMIT_BYTES[limit] })

function mapMulterError(e) {
  if (!(e instanceof multer.MulterError)) return e
  if (e.code === 'LIMIT_FILE_SIZE') return tooLarge('image')
  if (e.code === 'LIMIT_UNEXPECTED_FILE') return bad('파일 필드가 틀립니다 — 정해진 이름으로 하나씩만 보냅니다')
  return bad(`멀티파트 요청이 틀립니다 (${e.code})`)
}

// names: 이 API 가 받는 파일 필드(모두 있어야 한다)
function testUpload(names) {
  const parser = multer({
    storage: multer.memoryStorage(),
    // busboy 는 한도와 같은 크기도 넘은 것으로 친다 — 꼭 4 MiB 를 받도록 1 을 더하고 길이는 아래에서 다시 본다
    limits: { fileSize: MAX_FILE + 1, files: names.length, fields: 1, fieldSize: MAX_META }
  }).fields(names.map((name) => ({ name, maxCount: 1 })))

  return function testUploadMiddleware(req, res, next) {
    // 길이를 미리 알리는 요청은 본문을 받기 전에 막는다 — 읽지 않고 흘려 버린다
    const len = Number(req.headers['content-length'])
    if (Number.isFinite(len) && len > MAX_REQUEST) {
      req.resume()
      return next(tooLarge('request'))
    }
    parser(req, res, (err) => {
      if (err) return next(mapMulterError(err))
      try {
        const raw = req.body && req.body.meta
        if (typeof raw !== 'string') throw bad('meta 필드가 필요합니다')
        let meta
        try { meta = JSON.parse(raw) } catch { throw bad('meta 를 JSON 으로 해석하지 못했습니다') }
        if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) throw bad('meta 는 객체여야 합니다')
        const out = {}
        for (const name of names) {
          const file = req.files && req.files[name] && req.files[name][0]
          if (!file) throw bad(`그림 ${name} 이 필요합니다`)
          if (file.buffer.length > MAX_FILE) throw tooLarge('image')
          if (file.buffer.length < PNG_HEAD.length || !file.buffer.subarray(0, PNG_HEAD.length).equals(PNG_HEAD)) throw bad(`PNG 파일이 아닙니다: ${name}`)
          out[name] = file.buffer
        }
        req.seMeta = meta
        req.seTest = out
        next()
      } catch (e) { next(e) }
    })
  }
}

module.exports = { testUpload, MAX_FILE, MAX_REQUEST }

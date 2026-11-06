'use strict'
// 멀티파트 요청(JSON meta + PNG 파일들)을 받는다. 초안 저장·배포가 함께 쓴다.
// 필드 meta(JSON 문자열) 하나, 파일 필드 이름은 img:<tempId>. 결과 req.seMeta, req.seImages(Map<tempId, Buffer>).
const multer = require('multer')
const { seError } = require('./errors')

const MB = 1048576
const MAX_FILE = 10 * MB
const MAX_TOTAL = 50 * MB
const MAX_FIELD = 10 * MB // meta 에 편집 시나리오 전체가 실린다 — 서버 JSON 본문 한도와 같게(multer 기본 1MB 로는 모자란다)
const MAX_FILES = 200
const TEMP_ID = /^[A-Za-z0-9_-]{1,64}$/
const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const bad = (message) => seError(400, 'BAD_REQUEST', message)
const tooLarge = (message) => seError(413, 'PAYLOAD_TOO_LARGE', message)

const parser = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE, files: MAX_FILES, fields: 1, fieldSize: MAX_FIELD },
  fileFilter: (req, file, cb) => {
    const m = /^img:(.*)$/.exec(file.fieldname)
    if (!m || !TEMP_ID.test(m[1])) return cb(bad(`파일 필드 이름이 틀립니다: img:<tempId> (tempId 는 영문·숫자·_·- 1~64자)`))
    cb(null, true)
  }
}).any()

function mapMulterError(e) {
  if (!(e instanceof multer.MulterError)) return e
  if (e.code === 'LIMIT_FILE_SIZE') return tooLarge('그림 한 장은 10MB 를 넘을 수 없습니다')
  if (e.code === 'LIMIT_FIELD_VALUE') return tooLarge('meta 가 10MB 를 넘습니다')
  if (e.code === 'LIMIT_FILE_COUNT') return bad(`그림은 ${MAX_FILES}장까지 보낼 수 있습니다`)
  return bad(`멀티파트 요청이 틀립니다 (${e.code})`)
}

function multipartMeta(req, res, next) {
  parser(req, res, (err) => {
    if (err) return next(mapMulterError(err))
    try {
      const raw = req.body && req.body.meta
      if (typeof raw !== 'string') throw bad('meta 필드가 필요합니다')
      let meta
      try { meta = JSON.parse(raw) } catch { throw bad('meta 를 JSON 으로 해석하지 못했습니다') }
      const images = new Map()
      let total = 0
      for (const f of req.files || []) {
        const tempId = f.fieldname.slice(4)
        if (images.has(tempId)) throw bad(`같은 tempId 의 파일이 둘입니다: ${tempId}`)
        if (f.buffer.length < PNG_HEAD.length || !f.buffer.subarray(0, PNG_HEAD.length).equals(PNG_HEAD)) throw bad(`PNG 파일이 아닙니다: ${tempId}`)
        total += f.buffer.length
        if (total > MAX_TOTAL) throw tooLarge('그림 합계는 50MB 를 넘을 수 없습니다')
        images.set(tempId, f.buffer)
      }
      req.seMeta = meta
      req.seImages = images
      next()
    } catch (e) { next(e) }
  })
}

module.exports = { multipartMeta }

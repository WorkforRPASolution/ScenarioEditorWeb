'use strict'
const { getDeps } = require('./deps')
const { seError } = require('./errors')
const { hasFullScope } = require('./domain/processPermission')
const { writeDenial, reviewDenial } = require('./domain/writePolicy')

const ok = (res, data) => res.json({ success: true, data })

async function loadUser(req, res, next) {
  const user = await getDeps().users.getUser(req.user.singleid)
  if (!user) throw seError(403, 'USER_NOT_REGISTERED', '편집기 사용자로 등록되지 않았습니다')
  req.seUser = user
  next()
}

async function me(req, res) {
  const u = req.seUser
  ok(res, {
    singleid: u.singleid, name: u.name, processRaw: u.processRaw, processes: u.processes, isMaster: u.isMaster, canWrite: u.canWrite,
    authorityManager: u.authorityManager, authorityManagerValid: u.authorityManagerValid, authorityName: u.authorityName, duplicateUserDocs: u.duplicateUserDocs
  })
}

async function scopes(req, res) {
  const s = await getDeps().scopes.scopeFor(req.seUser)
  ok(res, { processes: s.pairs, excludedEqpCount: s.invalid.length + s.duplicateEqpIds.length })
}

async function refreshCache(req, res) {
  const images = req.query.images === '1'
  if (images && !hasFullScope(req.seUser)) throw seError(403, 'MASTER_REQUIRED', '이미지 캐시 비우기는 전체 공정 사용자만 할 수 있습니다')
  const d = getDeps()
  d.users.clear()
  d.scopes.clear()
  if (images) await d.opener.clearImages()
  ok(res, { refreshed: true })
}

const need = (v, name) => {
  if (typeof v !== 'string' || v === '') throw seError(400, 'BAD_REQUEST', `${name} 가 필요합니다`)
  return v
}

async function list(req, res) {
  ok(res, await getDeps().list.list(req.seUser, need(req.query.process, 'process'), need(req.query.model, 'model')))
}

async function versions(req, res) {
  const { process, model, name } = req.params
  ok(res, await getDeps().versions.versions(req.seUser, process, model, name))
}

async function open(req, res) {
  const { process, model, name, crtime } = req.params
  const { skeleton, stats } = await getDeps().opener.open(req.seUser, process, model, name, crtime)
  res.set('X-SE-Open-Stats', `ms=${stats.ms};peakRssMb=${stats.peakRssMb};fromCache=${stats.fromCache}`)
  ok(res, skeleton)
}

async function dataCheck(req, res) {
  ok(res, await getDeps().dataCheck.check(req.seUser))
}

// PNG·1년 캐시 머리글은 파일을 실제로 보낼 때만 붙는다(sendFile headers). 보내기 전에 실패하면 오류 JSON 에 남지 않게
// send 가 붙인 파일 머리글도 걷는다.
const IMAGE_HEADERS = Object.freeze({ 'Cache-Control': 'private, max-age=31536000, immutable', 'Content-Type': 'image/png' })
const FILE_HEADERS = ['Cache-Control', 'Content-Type', 'Content-Length', 'ETag', 'Last-Modified', 'Accept-Ranges', 'Content-Range']

async function image(req, res, next) {
  const { process, model, name, crtime, fileId, imageId } = req.params
  if (!/^\d+$/.test(crtime)) throw seError(400, 'BAD_REQUEST', 'crtime 은 숫자')
  const p = await getDeps().opener.imagePath(req.seUser, process, model, name, Number(crtime), fileId, imageId)
  // 캐시 폴더 기본값이 .cache 아래다. Express 5(send 1.x)는 경로 중간의 점 폴더도 막으므로 허용한다(경로는 imageCache 가 만든 것만 온다).
  res.sendFile(p, { dotfiles: 'allow', headers: IMAGE_HEADERS }, (err) => {
    if (!err || err.code === 'ECONNABORTED') return // 받는 쪽이 끊었다
    if (res.headersSent) { res.destroy(); return } // 보내는 도중 실패 — 오류 응답을 쓸 수 없다
    for (const h of FILE_HEADERS) res.removeHeader(h)
    // 파일 경로는 오류 메시지에 싣지 않는다(개발 모드 오류 응답이 메시지를 그대로 낸다).
    if (err.code === 'ENOENT' || err.status === 404 || err.statusCode === 404) return next(seError(404, 'NOT_FOUND', '이미지가 없습니다'))
    const status = err.status >= 400 && err.status < 600 ? err.status : 500
    next(Object.assign(new Error(`이미지 파일을 보내지 못했습니다 (${err.code || status})`), { statusCode: status }))
  })
}

// 쓰기 문. 쓰기 경로가 loadUser 뒤에 붙인다(req.seUser 를 본다).
// seWriteDisabled 는 단독판 app.js 만 정한다 — 편입 뒤에는 값이 없어 WRITE·등급만 본다.
const denyWith = (denial, next) => next(seError(denial.status, denial.code, denial.message))
const writeDisabled = (req) => req.app.locals.seWriteDisabled === true

function requireWrite(req, res, next) {
  const denial = writeDenial(req.seUser, { writeDisabled: writeDisabled(req) })
  return denial ? denyWith(denial, next) : next()
}

function requireReviewer(req, res, next) {
  const denial = reviewDenial(req.seUser, { writeDisabled: writeDisabled(req) })
  return denial ? denyWith(denial, next) : next()
}

async function check(req, res) {
  ok(res, await getDeps().check.check(req.seUser, req.body))
}

async function saveDraft(req, res) {
  ok(res, await getDeps().drafts.save(req.seUser, req.seMeta, req.seImages))
}

async function listDrafts(req, res) {
  ok(res, await getDeps().drafts.list(req.seUser, need(req.query.process, 'process'), need(req.query.model, 'model')))
}

async function getDraft(req, res) {
  ok(res, await getDeps().drafts.get(req.seUser, req.params.id))
}

async function draftImage(req, res, next) {
  const stream = await getDeps().drafts.image(req.seUser, req.params.id, req.params.tempId)
  res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'private, no-store' })
  stream.on('error', (e) => {
    if (res.headersSent) return res.destroy()
    res.removeHeader('Content-Type'); res.removeHeader('Cache-Control')
    next(e && e.code ? e : Object.assign(new Error('초안 그림을 읽지 못했습니다'), { statusCode: 500 }))
  })
  stream.pipe(res)
}

async function removeDraft(req, res) {
  ok(res, await getDeps().drafts.remove(req.seUser, req.params.id))
}

// 배포. 걸린 시간·최대 상주 메모리를 열기(X-SE-Open-Stats)와 같은 방식(100ms 간격 표본)으로 재어 머리글에 싣는다 — 큰 시나리오 측정이 읽는다.
const rssNow = () => process.memoryUsage().rss
async function deploy(req, res) {
  const started = Date.now()
  let peak = rssNow()
  const timer = setInterval(() => { peak = Math.max(peak, rssNow()) }, 100)
  try {
    const out = await getDeps().deploy.deploy(req.seUser, req.seMeta, req.seImages)
    res.set('X-SE-Deploy-Stats', `ms=${Date.now() - started};peakRssMb=${Math.round(Math.max(peak, rssNow()) / 1048576)}`)
    ok(res, out)
  } finally {
    clearInterval(timer)
  }
}

async function deployVerify(req, res) {
  ok(res, await getDeps().deploy.verify(req.seUser, req.params.requestId))
}
async function deployFinish(req, res) {
  ok(res, await getDeps().deploy.finish(req.seUser, req.params.requestId))
}

module.exports = { deploy, deployVerify, deployFinish, saveDraft, listDrafts, getDraft, draftImage, removeDraft, check, requireWrite, requireReviewer, ok, loadUser, me, scopes, refreshCache, list, versions, open, dataCheck, image }

'use strict'
const { getDeps } = require('./deps')
const { seError } = require('./errors')

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
  const d = getDeps()
  d.users.clear()
  d.scopes.clear()
  if (req.query.images === '1') await d.imageCache.clear()
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

async function image(req, res) {
  const { process, model, name, crtime, imageId } = req.params
  if (!/^\d+$/.test(crtime)) throw seError(400, 'BAD_REQUEST', 'crtime 은 숫자')
  const p = await getDeps().opener.imagePath(req.seUser, process, model, name, Number(crtime), imageId)
  res.set('Cache-Control', 'private, max-age=31536000, immutable')
  res.type('png')
  // 캐시 폴더 기본값이 .cache 아래다. Express 5(send 1.x)는 경로 중간의 점 폴더도 막으므로 허용한다(경로는 imageCache 가 만든 것만 온다).
  res.sendFile(p, { dotfiles: 'allow' })
}

module.exports = { ok, loadUser, me, scopes, refreshCache, list, versions, open, image }

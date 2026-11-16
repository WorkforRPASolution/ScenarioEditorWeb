'use strict'
const { getDeps } = require('./deps')
const { seError } = require('./errors')
const { hasFullScope } = require('./domain/processPermission')
const { writeDenial, reviewDenial, memoDenial } = require('./domain/writePolicy')
const { linksFromEnv } = require('./domain/links')

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

// 안내 문서 링크(P2-F): 환경 변수 값. 틀린 값은 없는 것으로 보고 변수마다 한 번만 경고를 남긴다.
const warnedLinks = new Set()
async function links(req, res) {
  const { links: out, invalid } = linksFromEnv(process.env)
  for (const name of invalid) {
    if (warnedLinks.has(name)) continue
    warnedLinks.add(name)
    console.warn(`[scenario-editor] ${name} 은 http:// 또는 https:// 주소여야 합니다 — 링크를 숨깁니다`)
  }
  ok(res, out)
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

// 불러오기 창의 공정·모델 옆 수: 공정 권한 안의 등록된 시나리오 수·내 초안 수
async function counts(req, res) {
  ok(res, await getDeps().counts.counts(req.seUser))
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

function requireMemoWrite(req, res, next) {
  const denial = memoDenial(req.seUser, { writeDisabled: writeDisabled(req) })
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

function badBody(path, reason) {
  return seError(400, 'BAD_REQUEST', '요청 본문이 틀립니다', { path, reason })
}
async function setEnabled(req, res) {
  const enabled = req.body && req.body.enabled
  if (typeof enabled !== 'boolean') throw badBody('enabled', 'true 또는 false 여야 합니다')
  const { process, model, name } = req.params
  ok(res, await getDeps().versionAdmin.setEnabled(req.seUser, { process, model, name }, enabled))
}
async function removeScenario(req, res) {
  const confirmName = req.body && req.body.confirmName
  if (typeof confirmName !== 'string') throw badBody('confirmName', '문자열이어야 합니다')
  // withDraft(선택): true 면 시나리오를 지운 뒤 내 초안도 지운다
  const withDraft = req.body.withDraft
  if (withDraft !== undefined && typeof withDraft !== 'boolean') throw badBody('withDraft', 'true 또는 false 여야 합니다')
  const { process, model, name } = req.params
  ok(res, await getDeps().versionAdmin.remove(req.seUser, { process, model, name }, confirmName, { withDraft: withDraft === true }))
}

async function reviewScenario(req, res) {
  const b = req.body
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw badBody('body', '객체여야 합니다')
  const { process, model, name } = req.params
  ok(res, await getDeps().performance.review(req.seUser, { process, model, name }, { grade: b.grade, comment: b.comment }))
}
async function savePerformance(req, res) {
  const b = req.body
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw badBody('body', '객체여야 합니다')
  if (!b.fields || typeof b.fields !== 'object' || Array.isArray(b.fields)) throw badBody('fields', '객체여야 합니다')
  const { process, model, name } = req.params
  ok(res, await getDeps().performance.savePerformance(req.seUser, { process, model, name },
    { fields: b.fields, citizenDevelopers: b.citizenDevelopers, alsoModels: b.alsoModels === undefined ? [] : b.alsoModels }))
}
async function sameName(req, res) {
  ok(res, await getDeps().performance.sameName(req.seUser, req.params.process, req.params.name))
}
// ?ids=a,b 는 등록 여부 확인(성과 입력 창이 열 때), 아니면 ?q= 이름·아이디 찾기
async function searchUsers(req, res) {
  const p = getDeps().performance
  ok(res, req.query.ids !== undefined ? await p.registeredUsers(req.seUser, req.query.ids) : await p.searchUsers(req.seUser, req.query.q))
}
async function nameRule(req, res) {
  ok(res, await getDeps().performance.nameRule(req.seUser))
}

// ── 스냅샷 (P3) ── 읽기라 쓰기 권한을 보지 않는다. 설비 범위는 서비스가 본다.
async function equipment(req, res) {
  ok(res, { items: await getDeps().snapshots.equipment(req.seUser) })
}

// 설비마다 가장 늦은 스냅샷 날짜(설비 고르기의 유무 표시) — 2000대씩, after 는 앞 응답의 next
async function snapshotPresence(req, res) {
  ok(res, await getDeps().snapshots.presence(req.seUser, typeof req.query.after === 'string' ? req.query.after : ''))
}

async function snapshotDays(req, res) {
  ok(res, await getDeps().snapshots.days(req.seUser, need(req.query.eqpId, 'eqpId'), { counts: req.query.counts === '1' }))
}

async function snapshotList(req, res) {
  // to 가 있으면 date ~ to(끝 날 포함), 없으면 date 하루
  ok(res, await getDeps().snapshots.list(req.seUser, need(req.query.eqpId, 'eqpId'), need(req.query.date, 'date'), typeof req.query.to === 'string' ? req.query.to : null))
}

// ── 스냅샷 메모 (P3-C) ── 설비 범위·글 규칙·충돌은 서비스가 본다. 여기서는 본문 꼴만 본다.
const bodyObject = (req) => {
  const b = req.body
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw badBody('body', '객체여야 합니다')
  return b
}
// expect = 화면이 본 메모 글(없으면 null — 새 메모)
async function saveMemo(req, res) {
  const b = bodyObject(req)
  if (typeof b.memo !== 'string') throw badBody('memo', '문자열이어야 합니다')
  const expect = b.expect === undefined ? null : b.expect
  if (expect !== null && typeof expect !== 'string') throw badBody('expect', '본 메모 글이거나 null 이어야 합니다')
  ok(res, await getDeps().memos.save(req.seUser, req.params.eqpId, req.params.fileName, { memo: b.memo, expect }))
}
async function removeMemo(req, res) {
  const b = bodyObject(req)
  if (typeof b.expect !== 'string') throw badBody('expect', '본 메모 글이어야 합니다')
  ok(res, await getDeps().memos.remove(req.seUser, req.params.eqpId, req.params.fileName, { expect: b.expect }))
}
async function memoList(req, res) {
  ok(res, await getDeps().memos.list(req.seUser))
}

// ── 자동 복구 이력 (P3-D) ── 설비 범위·txn 검사는 서비스가 본다. 이력 서버의 HTML 이 아니라 뽑은 스텝만 나간다.
async function history(req, res) {
  ok(res, await getDeps().history.get(req.seUser, req.params.eqpId, req.params.txn))
}

// 남은 보관 기간만큼만 캐시한다 — 파일 이름이 곧 내용이라 주소가 바뀌지 않고, 보관이 끝난 그림을 브라우저가 계속 보이지 않게 한다.
// 머리글은 그림을 받은 뒤에 붙인다(오류 JSON 에 PNG·캐시 머리글이 남지 않게).
async function snapshotImage(req, res) {
  const { png, maxAge } = await getDeps().snapshots.image(req.seUser, req.params.eqpId, req.params.fileName)
  res.set({ 'Content-Type': 'image/png', 'Cache-Control': maxAge > 0 ? `private, max-age=${maxAge}, immutable` : 'private, no-store' })
  res.send(png)
}

// Vision·OCR 시험(P4). 브라우저가 응답을 받기 전에 끊으면(탭을 닫음·다른 스텝으로 감) 판정 호출을 취소해 자리를 비운다.
// 'close' 는 응답을 다 보낸 뒤에도 온다 — 다 보내기 전의 것만 끊김이다.
function abortOnClose(res) {
  const ac = new AbortController()
  res.on('close', () => { if (!res.writableEnded) ac.abort() })
  return ac.signal
}
async function runTest(res, run) {
  const signal = abortOnClose(res)
  try {
    ok(res, await run({ signal }))
  } catch (e) {
    if (signal.aborted && e && e.code === 'VISION_CANCELLED') return // 받을 사람이 없다 — 오류로 남기지 않는다
    throw e
  }
}
async function visionTest(req, res) {
  await runTest(res, (options) => getDeps().visionTest.vision(req.seUser, { source: req.seTest.source, train: req.seTest.train, meta: req.seMeta }, options))
}
async function ocrTest(req, res) {
  await runTest(res, (options) => getDeps().visionTest.ocr(req.seUser, { source: req.seTest.source, meta: req.seMeta }, options))
}

module.exports = { visionTest, ocrTest, history, saveMemo, removeMemo, memoList, requireMemoWrite, equipment, snapshotPresence, snapshotDays, snapshotList, snapshotImage, links, reviewScenario, savePerformance, sameName, searchUsers, nameRule, setEnabled, removeScenario, deploy, deployVerify, deployFinish, saveDraft, listDrafts, getDraft, draftImage, removeDraft, check, requireWrite, requireReviewer, ok, loadUser, me, scopes, refreshCache, list, counts, versions, open, dataCheck, image }

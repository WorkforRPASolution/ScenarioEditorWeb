'use strict'
// 버전 열기: SC_PROPERTY 정확히 1건 확인 → 버전 고르기 → (캐시 없으면) GridFS 본문·BI 를 풀어 뼈대 + PNG 디스크 캐시 → 운영 속성 붙이기.
// BI 는 흘려 읽어 기준 화면을 바로 디스크에 쓴다. 큰 판도 메모리에 모으지 않는다.
const { pickCurrent } = require('../domain/versionPick')
const { buildSkeleton, isImage, baseImageId, refreshPropertyParts } = require('../domain/skeleton')
const { scanBi } = require('../domain/biStream')
const { editedFromSkeleton } = require('../domain/editedScenario')
const { propertyRev } = require('../domain/deployIdentity')
const { fingerprintOf } = require('../domain/imageFingerprint')
const { createSingleFlight } = require('../util/singleFlight')
const { createSemaphore } = require('../util/semaphore')
const { seError } = require('../errors')
const fsp = require('node:fs/promises')
const { ObjectId } = require('bson')

const enc = encodeURIComponent
// 디스크 뼈대 캐시 형식 번호. 뼈대에 담는 값이 바뀌면 올린다 — 다른 번호(없음 포함)의 캐시는 없는 것으로 보고 다시 푼다.
// 3: 이미지가 아닌 조건의 찾을 그림도 떼고, 정규 키가 아닌 찾을 그림은 raw 에 저장값 그대로(2026-11-06)
// 4: header.raw 에 숨길 창 저장값(null 포함), 키보드 동작에 저장 순서 codes(2026-11-07)
// 5: 정규 base64 만 그림(아닌 값은 literal·저장값 그대로, 2026-11-07)
// 6: 그림 내용 지문 imageFp(SEW-019, 2026-11-19)
const SKELETON_CACHE_FORMAT = 6
// 이미지 URL 은 1년 캐시라 내용이 바뀌면 안 된다 — 파일 id 를 넣어 같은 crtime 으로 다시 올라온 파일과 구분한다.
const baseUrl = (p, m, n, crtime, fileId) => `/scenario-editor/scenarios/${enc(p)}/${enc(m)}/${enc(n)}/versions/${crtime}/files/${enc(fileId)}/images`
const rss = () => process.memoryUsage().rss
// 버전 캐시·single-flight 키. 칸마다 인코딩해 '/' 로 잇는다 — '.' 로 이으면 (P,'M.A','B') 와 (P,'M','A.B') 가 같은 키가 된다.
// imageCache 가 키를 다시 인코딩해 디렉터리 이름 하나로 만든다(길면 해시).
const versionKey = (p, m, n, crtime, fileId) => [p, m, n, String(crtime), String(fileId)].map(enc).join('/')

// 클라이언트가 보낸 파일 id 문자열 → ObjectId. 24자리 16진수가 아니면 null.
const toObjectId = (v) => (typeof v === 'string' && /^[0-9a-fA-F]{24}$/.test(v) ? new ObjectId(v) : null)

function createOpenService({ repo, hash, gridfs, scopes, imageCache, log }) {
  const flight = createSingleFlight()
  // 큰 판 하나를 풀 때 메모리를 많이 쓴다 — 서로 다른 판의 풀기도 한 번에 하나만. 캐시가 있는 열기는 이 줄을 기다리지 않는다.
  const unpacking = createSemaphore(1)
  // 판 파일이 없어 캐시로 읽었다는 로그를 남긴 판 — 배포가 손대지 않은 그림마다 기준 판을 읽어도 한 번만 남긴다(SEW-024)
  const cacheNoted = new Set()

  // 같은 형식 번호의 디스크 뼈대 캐시 → { core, fromCache: true }, 없거나 옛 형식이면 null. 형식 번호는 응답에 새지 않게 뗀다.
  async function readCachedCore(key) {
    const cached = await imageCache.readSkeleton(key)
    if (!cached || cached.cacheFormat !== SKELETON_CACHE_FORMAT) return null
    const { cacheFormat, ...core } = cached
    return { core, fromCache: true }
  }

  async function propertyDocOf(process, model, name) {
    const docs = await repo.findScenarioKeyDocs(process, model, name)
    if (!docs.some((d) => 'property' in d)) throw seError(404, 'NOT_FOUND', '시나리오가 없습니다')
    if (docs.length > 1) throw seError(422, 'DATA_INVALID', '같은 공정·모델·이름의 운영 속성 문서가 둘 이상입니다')
    return docs[0]
  }

  async function unpack(process, model, name, crtime, fileId) {
    const key = versionKey(process, model, name, crtime, fileId)
    return flight.run(key, async () => {
      const cached = await readCachedCore(key)
      if (cached) return cached
      return unpacking.run(async () => {
        const file = await gridfs.findFile(fileId)
        if (!file) throw seError(404, 'NOT_FOUND', '그 버전이 없습니다')
        const writer = imageCache.begin(key)
        try {
          const body = file.metadata.body
          const present = new Set()
          const literals = new Map()
          const fingerprints = new Map()
          let count = 0
          const state = await scanBi(gridfs.streamContent(file), async (i, value) => {
            count++
            if (!isImage(value)) { literals.set(i, value); return }
            await writer.writeImage(baseImageId(i), value)
            present.add(i)
            fingerprints.set(i, fingerprintOf(value))
          })
          // 끝에서 깨진 것을 알면 앞서 쓴 기준 화면도 믿을 수 없다 — 파일 전체를 읽을 수 없는 것으로 본다.
          if (state === 'invalid') {
            await writer.removeImages([...present].map(baseImageId))
            present.clear()
            literals.clear()
            fingerprints.clear()
            count = null
          }
          const { skeleton, images } = buildSkeleton({ process, model, name, crtime, isCurrent: false, body, baseImages: { parseFailed: state === 'invalid', present, literals, count: count || null, fingerprints },
            propertyDoc: {}, performanceDoc: null, imageBaseUrl: baseUrl(process, model, name, crtime, fileId) })
          await writer.commit({ ...skeleton, cacheFormat: SKELETON_CACHE_FORMAT }, images)
          return { core: skeleton, fromCache: false }
        } catch (e) {
          await writer.abort()
          throw e
        }
      })
    })
  }

  // 충돌 기준값. headCrtime = 그 이름의 현재 판(옛 판을 열어도), propertyRev = 문서 property 의 지문.
  const withHead = (skeleton, current, propertySub) => ({ ...skeleton, headCrtime: current, propertyRev: propertySub === undefined ? null : propertyRev(propertySub) })

  // 판 하나를 (캐시 재사용으로) 푼다. 그 파일이 그 공정·모델·이름·crtime 이 아니거나 없으면 null.
  // 캐시는 파일이 지워져도 남으므로 파일 존재·메타데이터는 매번 본다(본문 없이 projection 으로 가볍게).
  // cacheIfGone: 파일이 없을 때만 같은 판 키·같은 형식 번호의 디스크 캐시를 쓴다 — 지워진 시나리오 다시 만들기(force, 2026-11-07 결정 (a)).
  // 캐시 키에 공정·모델·이름·crtime·파일 id 가 다 들어 있고 캐시는 그 판을 확인하고 푼 것만 쓰므로 다른 판으로 바뀌지 않는다.
  async function unpackVersion({ process, model, name, crtime, fileId }, { cacheIfGone = false } = {}) {
    const oid = toObjectId(fileId)
    if (!oid || !Number.isSafeInteger(crtime)) return null
    const file = await gridfs.findFileMeta(oid)
    if (!file && cacheIfGone) return cachedVersion(process, model, name, crtime, oid)
    const m = file && file.metadata
    if (!m || m.process !== process || m.model !== model || m.name !== name || m.crtime !== crtime) return null
    return unpack(process, model, name, crtime, oid)
  }

  async function cachedVersion(process, model, name, crtime, oid) {
    const key = versionKey(process, model, name, crtime, oid)
    const cached = await readCachedCore(key)
    if (cached && !cacheNoted.has(key)) {
      cacheNoted.add(key)
      log.info(`source ${process}-${model}-${name}@${crtime}: 판 파일이 없어 디스크 캐시로 읽음`)
    }
    return cached
  }

  // 검사·배포가 기준 판으로 읽는다. 현재 운영 속성·성과를 붙인 뼈대와 그 문서(property·performance 하위 문서).
  async function source(user, version, opts) {
    const { process, model, name, crtime } = version
    await scopes.assertAllowed(user, process, model)
    const unpacked = await unpackVersion(version, opts)
    if (!unpacked) return { gone: true }
    const docs = (await repo.findScenarioKeyDocs(process, model, name)).filter((d) => 'property' in d)
    if (docs.length > 1) throw seError(422, 'DATA_INVALID', '같은 공정·모델·이름의 운영 속성 문서가 둘 이상입니다')
    const doc = docs[0] ?? null // 없으면(지워진 시나리오) gone 이 아니다 — 충돌 판정이 따로 알린다
    const current = pickCurrent(await hash.hkeys(`${process}-${model}`), name)
    const fileId = String(toObjectId(version.fileId))
    const skeleton = withHead(refreshPropertyParts({ ...unpacked.core, version: { crtime, isCurrent: crtime === current, fileId } }, doc ? doc.property : undefined, doc ? doc.performance : undefined), current, doc ? doc.property : undefined)
    return { skeleton, propertyDoc: doc ? doc.property : null, performanceDoc: doc ? (doc.performance ?? null) : null }
  }

  // 기준 판의 그림 하나를 base64 로 — 배포가 손대지 않은 그림을 다시 조립할 때 쓴다. 캐시가 없거나 옛 형식이면 다시 푼 뒤 읽는다.
  // opts.cacheIfGone 은 source 와 같다(파일이 없으면 캐시 그림).
  async function resolveImage(version, imageId, opts) {
    const unpacked = await unpackVersion(version, opts)
    if (!unpacked) throw seError(404, 'NOT_FOUND', '그 버전이 없습니다')
    const { process, model, name, crtime } = version
    const p = await imageCache.imagePath(versionKey(process, model, name, crtime, toObjectId(version.fileId)), imageId)
    if (!p) throw seError(404, 'NOT_FOUND', '이미지가 없습니다')
    return (await fsp.readFile(p)).toString('base64')
  }

  async function open(user, process, model, name, crtimeParam) {
    await scopes.assertAllowed(user, process, model)
    const started = Date.now()
    let peak = rss()
    const timer = setInterval(() => { peak = Math.max(peak, rss()) }, 100)
    try {
      const doc = await propertyDocOf(process, model, name)
      const current = pickCurrent(await hash.hkeys(`${process}-${model}`), name)
      let crtime
      if (crtimeParam === 'current') {
        if (current === null) throw seError(404, 'NOT_FOUND', '현재 버전이 없습니다(Redis 필드 없음)')
        crtime = current
      } else {
        if (!/^\d+$/.test(String(crtimeParam))) throw seError(400, 'BAD_REQUEST', 'crtime 은 숫자 또는 current')
        crtime = Number(crtimeParam)
      }
      const fileId = await gridfs.findVersionId(process, model, name, crtime)
      if (fileId === null) throw seError(404, 'NOT_FOUND', '그 버전이 없습니다')
      const { core, fromCache } = await unpack(process, model, name, crtime, fileId)
      const base = withHead(refreshPropertyParts({ ...core, version: { crtime, isCurrent: crtime === current, fileId: String(fileId) } }, doc.property, doc.performance), current, doc.property)
      // 편집 작업본의 시작점도 서버가 만든다 — 브라우저가 따로 만들면 손대지 않은 스텝이 달라 보여 raw 대신 다시 조립된다.
      const skeleton = { ...base, edited: editedFromSkeleton(base, { fileId: String(fileId) }) }
      const stats = { ms: Date.now() - started, peakRssMb: Math.round(Math.max(peak, rss()) / 1048576), fromCache }
      log.info(`open ${process}-${model}-${name}@${crtime} ${stats.ms}ms peakRss=${stats.peakRssMb}MB cache=${fromCache} steps=${skeleton.steps.length}`)
      return { skeleton, stats }
    } finally {
      clearInterval(timer)
    }
  }

  async function imagePath(user, process, model, name, crtime, fileId, imageId) {
    await scopes.assertAllowed(user, process, model)
    const key = versionKey(process, model, name, crtime, fileId)
    let p = await imageCache.imagePath(key, imageId)
    if (!p && !(await imageCache.readSkeleton(key))) {
      // 캐시가 지워졌다. 다시 풀 수 있는 것은 그 판의 최신 파일뿐이다 — 옛 파일 URL 에 새 파일 내용을 주면 안 된다.
      const latest = await gridfs.findVersionId(process, model, name, crtime)
      if (latest === null || String(latest) !== fileId) throw seError(404, 'NOT_FOUND', '이미지가 없습니다')
      await unpack(process, model, name, crtime, latest)
      p = await imageCache.imagePath(key, imageId)
    }
    if (!p) throw seError(404, 'NOT_FOUND', '이미지가 없습니다')
    return p
  }

  // 풀기가 끝나기를 기다린다 — 풀던 폴더가 사라지면 그 열기가 실패한다.
  const clearImages = () => unpacking.run(() => imageCache.clear())

  return { open, source, resolveImage, imagePath, clearImages }
}

module.exports = { createOpenService, baseUrl, versionKey, SKELETON_CACHE_FORMAT }

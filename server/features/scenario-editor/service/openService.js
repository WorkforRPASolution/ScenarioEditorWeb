'use strict'
// 버전 열기: SC_PROPERTY 정확히 1건 확인 → 버전 고르기 → (캐시 없으면) GridFS 본문·BI 를 풀어 뼈대 + PNG 디스크 캐시 → 운영 속성 붙이기.
const { pickCurrent } = require('../domain/versionPick')
const { buildSkeleton, refreshPropertyParts } = require('../domain/skeleton')
const { createSingleFlight } = require('../util/singleFlight')
const { createSemaphore } = require('../util/semaphore')
const { seError } = require('../errors')

const enc = encodeURIComponent
// 이미지 URL 은 1년 캐시라 내용이 바뀌면 안 된다 — 파일 id 를 넣어 같은 crtime 으로 다시 올라온 파일과 구분한다.
const baseUrl = (p, m, n, crtime, fileId) => `/scenario-editor/scenarios/${enc(p)}/${enc(m)}/${enc(n)}/versions/${crtime}/files/${enc(fileId)}/images`
const rss = () => process.memoryUsage().rss
// 버전 캐시·single-flight 키. 칸마다 인코딩해 '/' 로 잇는다 — '.' 로 이으면 (P,'M.A','B') 와 (P,'M','A.B') 가 같은 키가 된다.
// imageCache 가 키를 다시 인코딩해 디렉터리 이름 하나로 만든다(길면 해시).
const versionKey = (p, m, n, crtime, fileId) => [p, m, n, String(crtime), String(fileId)].map(enc).join('/')

function createOpenService({ repo, hash, gridfs, scopes, imageCache, log }) {
  const flight = createSingleFlight()
  // 큰 판 하나를 풀 때 메모리를 많이 쓴다 — 서로 다른 판의 풀기도 한 번에 하나만. 캐시가 있는 열기는 이 줄을 기다리지 않는다.
  const unpacking = createSemaphore(1)

  async function propertyDocOf(process, model, name) {
    const docs = await repo.findScenarioKeyDocs(process, model, name)
    if (!docs.some((d) => 'property' in d)) throw seError(404, 'NOT_FOUND', '시나리오가 없습니다')
    if (docs.length > 1) throw seError(422, 'DATA_INVALID', '같은 공정·모델·이름의 운영 속성 문서가 둘 이상입니다')
    return docs[0]
  }

  async function unpack(process, model, name, crtime, fileId) {
    const key = versionKey(process, model, name, crtime, fileId)
    return flight.run(key, async () => {
      const cached = await imageCache.readSkeleton(key)
      if (cached) return { core: cached, fromCache: true }
      return unpacking.run(async () => {
        const file = await gridfs.findFile(fileId)
        if (!file) throw seError(404, 'NOT_FOUND', '그 버전이 없습니다')
        const biText = await gridfs.readContent(fileId)
        const { skeleton, images } = buildSkeleton({ process, model, name, crtime, isCurrent: false, body: file.metadata.body, biText,
          propertyDoc: {}, performanceDoc: null, imageBaseUrl: baseUrl(process, model, name, crtime, fileId) })
        await imageCache.store(key, skeleton, images)
        return { core: skeleton, fromCache: false }
      })
    })
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
      const skeleton = refreshPropertyParts({ ...core, version: { crtime, isCurrent: crtime === current } }, doc.property, doc.performance)
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

  return { open, imagePath }
}

module.exports = { createOpenService, baseUrl, versionKey }

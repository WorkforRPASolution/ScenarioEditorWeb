'use strict'
// 배포(설계 §6.2): 요청 모양·권한 → 잠금 → 기준 판 읽기·검사(prepare) → 대상·충돌 확인 → 조립·길이 세기·크기 검사 → 배포 기록 →
// InterfaceServer setscenario(흘려 보내기) → 내 판 찾기 → Mongo 마무리(scCategory·trCategory·Owners·새 대상 성과) → 초안 지우기.
// 순서는 40 §2.5 (a)·(d): setscenario 먼저, Mongo 나중, Owners 줄은 성공한 뒤. 자동으로 다시 보내지 않는다.
const { checkScenario } = require('../domain/rules')
const { assembleScenario, assembleProperty } = require('../domain/assemble')
const { backupInfoChunks, setScenarioRequestChunks } = require('../domain/csharpJson')
const { bodySha256, pickMine, setScenarioTimeoutMs } = require('../domain/deployIdentity')
const { deployLine, ownersWithLine } = require('../domain/owners')
const { copiesPerformanceToNewTarget } = require('../domain/writePolicy')
const { emptyPerformance } = require('../domain/performanceEdit')
const { seError } = require('../errors')

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ERROR_TEXT_MAX = 300
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const nonEmpty = (v) => typeof v === 'string' && v !== ''
const bad = (message, details) => seError(400, 'BAD_REQUEST', message, details)
const inProgress = (message, details) => seError(409, 'SAVE_IN_PROGRESS', message, details)
// 같은 requestId 를 다시 받았을 때 — 어느 기록인지 알려 화면이 확인(verify)으로 이어 가게 한다
const sameRequest = (message, requestId) => inProgress(message, { requestId })
const blocked = (blocks) => seError(422, 'VALIDATION_FAILED', '검사에서 막힌 항목이 있어 배포할 수 없습니다', { blocks })

// 잠금 전에 볼 수 있는 것: 요청 모양과 대상 키. 편집 시나리오 해석은 prepare 가 한다.
function parseOptions(meta) {
  if (!isObject(meta)) throw bad('요청 본문이 필요합니다', { path: '$', reason: '객체여야 합니다' })
  if (typeof meta.requestId !== 'string' || !UUID.test(meta.requestId)) throw bad('requestId 가 필요합니다', { path: 'requestId', reason: 'uuid 문자열이어야 합니다' })
  const flag = (k) => {
    if (meta[k] === undefined) return false
    if (typeof meta[k] !== 'boolean') throw bad(`${k} 모양이 틀립니다`, { path: k, reason: '참거짓이어야 합니다' })
    return meta[k]
  }
  const r = meta.restoredFrom
  if (r !== undefined && r !== null && !Number.isSafeInteger(r)) throw bad('restoredFrom 모양이 틀립니다', { path: 'restoredFrom', reason: '정수(crtime) 또는 null 이어야 합니다' })
  const t = meta.target
  if (!isObject(t)) throw bad('target 이 필요합니다', { path: 'target', reason: '객체여야 합니다' })
  for (const k of ['process', 'model', 'name']) if (!nonEmpty(t[k])) throw bad(`target.${k} 가 필요합니다`, { path: `target.${k}`, reason: '비어 있지 않은 문자열이어야 합니다' })
  return { requestId: meta.requestId, overwrite: flag('overwrite'), force: flag('force'), restoredFrom: r ?? null, target: { process: t.process, model: t.model, name: t.name } }
}

// 편집 스텝의 그림 참조(찾을 그림·기준 화면). { literal } 은 참조가 아니다.
function imageRefs(edited) {
  const out = []
  for (const s of edited.steps) for (const r of [...Object.values(s.images.train), s.images.base]) if (r && typeof r.from === 'string') out.push(r)
  return out
}

// setscenario 요청 조각 생성기(부를 때마다 처음부터). BI ID 는 "BI." + 시나리오 ID 다(01 §2, 저장된 판 모두 BI.{P}-{M}-{N}).
// 조각 생성기에 넘기는 값이 문자열이 아니면 프로그램 오류다 — 보내기 전에 던진다.
function requestChunks({ id, process, model, name, biEntries, bodyString, propertyString }, resolveImage) {
  for (const [k, v] of Object.entries({ id, process, model, name, bodyString, propertyString })) {
    if (typeof v !== 'string') throw new Error(`setscenario 조각 값 ${k} 는 문자열이어야 합니다(프로그램 오류)`)
  }
  return () => setScenarioRequestChunks({ process, model, name, biChunks: backupInfoChunks(`BI.${id}`, biEntries, resolveImage), bodyString, propertyString })
}

const ownersOf = (doc) => (doc && isObject(doc.property) && Array.isArray(doc.property.Owners) ? doc.property.Owners : [])
const errorOf = (e, status) => ({ code: String((e && (e.code || e.name)) || 'Error'), status, message: String((e && e.message) || '').slice(0, ERROR_TEXT_MAX) })
// InterfaceServer 원문(interfaceClient 가 UPSTREAM_TEXT_MAX 로 이미 자름). 없으면 null.
const upstreamTextOf = (e) => (e && e.upstream && typeof e.upstream.text === 'string' ? e.upstream.text : null)
// 감사 기록용: 원문이 있으면 함께 남긴다(응답에 싣는 것은 502 뿐)
const upstreamErrorOf = (e, status) => {
  const text = upstreamTextOf(e)
  return text === null ? errorOf(e, status) : { ...errorOf(e, status), upstreamText: text }
}

function createDeployService({ check, opener, web, repo, hash, scopes, interfaceClient, log, now = () => new Date() }) {
  // 프로세스 안 잠금: 대상 시나리오 ID 와 requestId. 서버가 여러 개 뜨는 구성은 단독판에 없다.
  const running = new Set()

  async function deploy(user, meta, images = new Map()) {
    const opts = parseOptions(meta)
    const t = opts.target
    await scopes.assertAllowed(user, t.process, t.model) // 권한이 없으면 잠그지도 않는다
    const id = `${t.process}-${t.model}-${t.name}`
    const targetLock = `target\u0000${id}`
    const requestLock = `request\u0000${opts.requestId}`
    // 같은 요청의 재전송을 먼저 본다(대상도 같아 대상 잠금에 먼저 걸리면 어느 기록인지 알려 줄 수 없다)
    if (running.has(requestLock)) throw sameRequest('이미 받은 배포 요청입니다', opts.requestId)
    if (running.has(targetLock)) throw inProgress('같은 시나리오의 배포가 진행 중입니다')
    running.add(targetLock)
    running.add(requestLock)
    try {
      return await deployLocked(user, meta, images, opts, id)
    } finally {
      running.delete(targetLock)
      running.delete(requestLock)
    }
  }

  // 잠근 뒤에 기준 판·대상 문서를 읽는다 — 충돌 판단과 Owners 목록이 잠근 시점 이후의 값이 된다.
  async function deployLocked(user, meta, images, opts, id) {
    const { requestId, target: t } = opts
    if (await web.getDeploy(requestId)) throw sameRequest('이미 받은 배포 요청입니다(같은 requestId 의 기록이 있음)', requestId)
    const p = await check.prepare(user, meta)
    const { edited, sourceSkeleton, ctx } = p
    const base = edited.source
    const baseVersion = base ? { process: base.process, model: base.model, name: base.name, crtime: base.crtime, fileId: base.fileId } : null
    // 초안 키(초안 저장과 같은 규칙): 기준 판이 있으면 그 모델·이름, 없으면 대상의 모델·이름
    const draftKey = { process: t.process, model: base ? base.model : t.model, name: base ? base.name : t.name }

    // 그림 참조는 기록·전송 전에 모두 확인한다
    const refs = imageRefs(edited)
    if (!base && refs.some((r) => r.from === 'source')) throw bad('기준 판이 없는 시나리오가 기준 판 그림을 가리킵니다', { path: 'scenario.steps', reason: "from 'source' 그림은 기준 판이 있을 때만 쓸 수 있습니다" })
    const wanted = new Set(refs.filter((r) => r.from === 'upload').map((r) => r.tempId))
    for (const k of images.keys()) {
      if (!wanted.has(k)) throw bad(`어떤 그림 참조도 가리키지 않는 파일이 있습니다: ${k}`, { path: `img:${k}`, reason: '시나리오가 이 tempId 를 쓰지 않습니다' })
    }
    const missing = [...wanted].filter((k) => !images.has(k))
    let draftGrid = new Map()
    if (missing.length) {
      const d = await web.findDraftFor(user.singleid, draftKey.process, draftKey.model, draftKey.name)
      draftGrid = new Map(((d && d.images) || []).map((i) => [i.tempId, i.gridId]))
      for (const k of missing) {
        if (!draftGrid.has(k)) throw bad(`그림 파일이 없습니다: ${k}`, { path: `img:${k}`, reason: '요청 파일도 초안의 그림도 없습니다' })
      }
    }
    // 그림 바이트 → base64. 기준 판·다른 판은 이미지 캐시(openService)에서, 새 그림은 요청 파일 또는 초안 GridFS 에서.
    async function resolveImage(ref) {
      if (ref.from === 'source') return opener.resolveImage(baseVersion, ref.id)
      if (ref.from === 'other') return opener.resolveImage({ process: ref.process, model: ref.model, name: ref.name, crtime: ref.crtime, fileId: ref.fileId }, ref.id)
      if (ref.from === 'upload') {
        const buf = images.has(ref.tempId) ? images.get(ref.tempId) : await web.readDraftImage(draftGrid.get(ref.tempId))
        return buf.toString('base64')
      }
      throw new Error(`알 수 없는 그림 참조: ${ref.from}`)
    }

    // 검사(§5)와 확인(§6.5·§6.6)
    const checked = checkScenario(edited, sourceSkeleton, ctx)
    const blocks = [...checked.blocks, ...p.extraBlocks]
    if (blocks.length) throw blocked(blocks)
    if (p.targetExists && !opts.overwrite) throw seError(409, 'TARGET_EXISTS', '같은 이름의 시나리오가 이미 있습니다. 덮어쓰려면 확인이 필요합니다', { diff: p.targetExists.diff })
    if (p.conflict && !opts.force) throw seError(409, 'SAVE_CONFLICT', '열어 둔 사이 시나리오가 바뀌었습니다. 덮어쓰려면 확인이 필요합니다', { conflict: p.conflict })

    // Owners 는 작업본 목록이 아니라 대상 문서의 지금 목록(새 대상이면 기준 판 문서의 지금 목록). 성과는 새 대상에만 쓴다(§6.6).
    let owners
    let performance = null
    if (p.target.exists) {
      owners = ownersOf(p.target.doc)
    } else {
      const sameKey = base && base.model === t.model && base.name === t.name // 같은 키면 prepare 가 이미 없다고 읽었다
      const baseDoc = base && !sameKey ? await propertyDocOf(base) : null
      owners = ownersOf(baseDoc)
      // 복사할 성과는 Long 을 올리지 않고 읽은 값 — 읽은 숫자를 다시 쓰면 Int64(CitizenDeveloper[].Contribution 등)가 Int32·Double 이 된다.
      performance = emptyPerformance()
      if (copiesPerformanceToNewTarget(user) && baseDoc && isObject(baseDoc.performance)) {
        performance = (await repo.findPerformanceRaw({ process: base.process, model: base.model, name: base.name })) ?? baseDoc.performance
      }
    }

    // 조립(§6.8). 본문은 문자열(15MB 까지), BI 는 그림을 하나씩 읽어 흘려 쓴다 — 요청 전체를 문자열 하나로 만들지 않는다.
    const { bodyString, biEntries } = await assembleScenario(edited, sourceSkeleton, { id, resolveImage })
    const propertyString = assembleProperty({ ...edited.property, Owners: owners }, { id })
    const chunksOf = requestChunks({ id, process: t.process, model: t.model, name: t.name, biEntries, bodyString, propertyString }, resolveImage)
    const contentLength = await interfaceClient.countUtf8Bytes(chunksOf()) // BI 그림을 다 읽는다 — 보낼 때 한 번 더 읽는다
    const sized = checkScenario(edited, sourceSkeleton, { ...ctx, sizes: { bodyBytes: Buffer.byteLength(bodyString, 'utf8'), requestBytes: contentLength } })
    if (sized.blocks.length) throw blocked(sized.blocks)

    // 배포 기록(§6.4) — 보내기 전에 남긴다. finish 는 7단계 값을 미리 적어 둔 것이다(scCategory·성과는 확인·다시 쓰기가 같은 값을 쓴다).
    // owners 는 보내기 전 계획이고, 실제 마무리는 그때 대상 문서의 지금 목록으로 다시 만들어(rewriteFinish) 쓴 값을 기록에 남긴다. steps 는 끝낸 단계(setscenario·finish).
    const at = now()
    const hashKey = `${t.process}-${t.model}`
    const fieldsBefore = (await hash.hkeys(hashKey)).filter((f) => f.startsWith(`${t.name}.`))
    const sha = bodySha256(bodyString)
    // scCategory 는 보내는 property 의 Type — 작업본에 빠진 키는 assembleProperty 가 C# 기본값으로 채운 뒤라 그 값과 같게 한다
    const scCategory = JSON.parse(propertyString).Type
    const finish = { owners: ownersWithLine(owners, deployLine(user.singleid, at)), scCategory, performance }
    const record = {
      requestId, user: user.singleid, source: baseVersion, target: { ...t }, headCrtime: edited.headCrtime, restoredFrom: opts.restoredFrom,
      fieldsBefore, bodySha256: sha, startedAt: at, result: 'pending', crtime: null, steps: [], finish, error: null, finishedAt: null
    }
    try {
      await web.insertDeploy({ ...record })
    } catch (e) {
      if (e && e.code === 11000) throw sameRequest('이미 받은 배포 요청입니다(같은 requestId 의 기록이 있음)', requestId)
      throw e
    }

    // setscenario. 조각 생성기가 던진 오류(그림 읽기 실패)와 길이 어긋남은 요청이 끊겨 InterfaceServer 가 저장하지 않은 로컬 실패다.
    let localError = null
    const chunks = async function* () {
      try { yield* chunksOf() } catch (e) { localError = e; throw e }
    }
    try {
      await interfaceClient.setScenarioStream({ chunks, contentLength }, { timeoutMs: setScenarioTimeoutMs(contentLength) })
    } catch (e) {
      if (localError !== null || (e && e.code === 'CONTENT_LENGTH_MISMATCH')) {
        await note(requestId, { result: 'failed', error: errorOf(e, 500), finishedAt: now() })
        // 원래 오류 메시지(파일 경로가 들어갈 수 있다)는 싣지 않는다 — 기록 error 와 로그에 남는다
        throw Object.assign(new Error(`배포 요청을 만들다 멈췄습니다 — InterfaceServer 는 완전한 요청을 받지 못해 저장하지 않았습니다 (${(e && (e.code || e.name)) || 'Error'})`), { statusCode: 500, cause: e })
      }
      if (e && (e.code === 'UPSTREAM_DOWN' || e.code === 'UPSTREAM_FAILED')) {
        await note(requestId, { result: 'failed', error: upstreamErrorOf(e, e.statusCode), finishedAt: now() })
        // 거절이면 서버 문구를 함께 보인다(설계 §6.3·§8). 업무 문구만 싣고 주소 등 내부 정보는 싣지 않는다(공통 설계 §7.1).
        if (e.code === 'UPSTREAM_FAILED') throw Object.assign(seError(502, 'UPSTREAM_FAILED', e.message, { upstreamText: upstreamTextOf(e) }), { upstream: e.upstream })
        throw e
      }
      // 504 UPSTREAM_TIMEOUT(보낸 뒤 끊김·시간 초과·HTTP 5xx — 10초 초과 500·akka 503 등)와 그 밖의 뜻밖 오류는 결과를 모른다 — 다시 보내지 않고 확인하게 한다.
      if (!e || e.code !== 'UPSTREAM_TIMEOUT') log.warn(`deploy ${id} ${requestId}: setscenario 뜻밖 오류 — ${(e && e.message) || e}`)
      await note(requestId, { result: 'unknown', error: upstreamErrorOf(e, 504) })
      throw Object.assign(seError(504, 'UPSTREAM_TIMEOUT', 'InterfaceServer 응답을 받지 못해 배포 결과를 모릅니다. 버전 목록을 확인한 뒤 다시 배포하세요', { requestId }), { upstream: e && e.upstream })
    }

    // 성공: 내 판 찾기 → Mongo 마무리. 마무리가 실패하거나 0건이면 partial(설비에는 이미 갔다, Task 10 다시 쓰기).
    let crtime = null
    try {
      crtime = await pickMine({ name: t.name, fieldsBefore, fieldsNow: await hash.hkeys(hashKey), valueOf: (f) => hash.hget(hashKey, f), sha })
    } catch (e) {
      log.warn(`deploy ${id} ${requestId}: 내 판을 찾지 못했습니다 — ${e.message}`)
    }
    // 보내는 데 120초까지 걸릴 수 있다 — 그 사이 남이 남긴 Owners 줄(켜기·끄기 등)을 지키도록 지금 목록에 내 줄을 더해 쓴다(확인·다시 쓰기와 같은 함수)
    const written = await tryFinish(record)
    const finished = written !== null
    const result = finished ? 'ok' : 'partial'
    const partialFailed = finished ? [] : ['finish']

    // 그 뒤는 결과에 영향 없음(로그만): 내 초안(기준 키, 새 이름이면 대상 키도)과 기록 마무리
    await dropDraft(user.singleid, draftKey.process, draftKey.model, draftKey.name)
    if (draftKey.model !== t.model || draftKey.name !== t.name) await dropDraft(user.singleid, t.process, t.model, t.name)
    await note(requestId, { result, crtime, ...(written ? { finish: written } : {}), steps: finished ? ['setscenario', 'finish'] : ['setscenario'], finishedAt: now() })
    log.info(`deploy ${id} ${requestId} result=${result} crtime=${crtime} bytes=${contentLength}`)
    return { result, crtime, partialFailed, requestId }
  }

  async function propertyDocOf(v) {
    const docs = (await repo.findScenarioKeyDocs(v.process, v.model, v.name)).filter((d) => 'property' in d)
    if (docs.length > 1) throw seError(422, 'DATA_INVALID', '같은 공정·모델·이름의 운영 속성 문서가 둘 이상입니다')
    return docs[0] ?? null
  }

  // 기록 고치기 실패는 원래 결과·오류를 가리지 않는다. pending 으로 남은 기록은 확인(Task 10)이 결과 모름처럼 다룬다.
  async function note(requestId, fields) {
    try {
      await web.updateDeploy(requestId, fields)
    } catch (e) {
      log.warn(`deploy ${requestId}: 배포 기록을 고치지 못했습니다 — ${e.message}`)
    }
  }

  async function dropDraft(owner, process, model, name) {
    try {
      const r = await web.deleteDraftFor(owner, process, model, name)
      if (r && r.gridIds && r.gridIds.length) await web.deleteDraftImages(r.gridIds)
    } catch (e) {
      log.warn(`deploy: 초안을 지우지 못했습니다 ${process}-${model}-${name} — ${e.message}`)
    }
  }

  // ---- 결과 모름 확인(§6.3)·마무리 다시 쓰기. 기록은 본인 것만 본다(없거나 남의 것이면 404). ----
  const notFound = () => seError(404, 'NOT_FOUND', '배포 기록을 찾을 수 없습니다')
  const partialOf = (result) => (result === 'partial' ? ['finish'] : [])

  async function ownRecord(user, requestId) {
    if (typeof requestId !== 'string' || !UUID.test(requestId)) throw notFound()
    const record = await web.getDeploy(requestId)
    if (!record || record.user !== user.singleid) throw notFound()
    await scopes.assertAllowed(user, record.target.process, record.target.model)
    return record
  }

  // 같은 기록을 동시에 확인·다시 쓰지 않게 한다
  async function exclusive(requestId, fn) {
    const lock = `request\u0000${requestId}`
    if (running.has(lock)) throw inProgress('이 배포 기록을 처리하는 중입니다')
    running.add(lock)
    try { return await fn() } finally { running.delete(lock) }
  }

  const whereOf = (record) => `deploy ${record.target.process}-${record.target.model}-${record.target.name} ${record.requestId}`

  // 마무리 값을 대상 문서의 지금 Owners 에 내 배포 줄을 더해 다시 만들어 쓴다(배포 직후·확인·다시 쓰기 모두). 줄은 deploy 때와 같은 값(사용자·시작 시각)이다.
  // ownersWithLine 이 같은 줄을 두 번 넣지 않으므로 그 사이 남의 줄이 생겨도 지우지 않는다. 쓴 finish 를 돌려주고, 문서가 없거나 0건이면 null. 읽기·쓰기 오류는 던진다.
  async function rewriteFinish(record) {
    const t = record.target
    const doc = await propertyDocOf(t)
    if (!doc) { log.warn(`${whereOf(record)}: 마무리 0건(운영 속성 문서 없음)`); return null }
    const finish = { ...record.finish, owners: ownersWithLine(ownersOf(doc), deployLine(record.user, new Date(record.startedAt))) }
    const r = await repo.finishDeploy({ process: t.process, model: t.model, name: t.name }, finish)
    if (r && r.matched > 0) return finish
    log.warn(`${whereOf(record)}: 마무리 0건(운영 속성 문서 없음)`)
    return null
  }

  // 배포 직후·확인: 설비에는 이미 갔다 — 마무리 실패는 오류가 아니라 partial 로 알린다(쓰기 실패도 null)
  async function tryFinish(record) {
    try {
      return await rewriteFinish(record)
    } catch (e) {
      log.warn(`${whereOf(record)}: 마무리 실패 — ${e.message}`)
      return null
    }
  }

  async function verify(user, requestId) {
    return exclusive(requestId, async () => {
      const record = await ownRecord(user, requestId)
      if (record.result === 'ok' || record.result === 'partial') return { found: 'mine', crtime: record.crtime ?? null, result: record.result, partialFailed: partialOf(record.result) }
      // 거절(failed·UPSTREAM_FAILED)도 찾아본다 — 운영 속성 단계가 이미 바뀌었을 수 있다(설계 §6.3 [버전 목록 확인]). 없으면 기록은 그대로 둔다.
      // 그 밖의 failed(연결 안 됨·보내기 전·보내는 도중 로컬 실패)는 InterfaceServer 가 저장하지 않았다 — 찾지 않는다.
      const rejected = record.result === 'failed' && record.error && record.error.code === 'UPSTREAM_FAILED'
      if (!rejected && !['unknown', 'pending'].includes(record.result)) return { found: 'none', crtime: null }
      const t = record.target
      const hashKey = `${t.process}-${t.model}`
      const crtime = await pickMine({ name: t.name, fieldsBefore: record.fieldsBefore, fieldsNow: await hash.hkeys(hashKey), valueOf: (f) => hash.hget(hashKey, f), sha: record.bodySha256 })
      if (crtime === null) return { found: 'none', crtime: null }
      const finish = await tryFinish(record)
      const result = finish ? 'ok' : 'partial'
      await note(requestId, { result, crtime, ...(finish ? { finish } : {}), steps: finish ? ['setscenario', 'finish'] : ['setscenario'], finishedAt: now() })
      log.info(`deploy ${requestId} verify result=${result} crtime=${crtime}`)
      return { found: 'mine', crtime, result, partialFailed: partialOf(result) }
    })
  }

  async function finish(user, requestId) {
    return exclusive(requestId, async () => {
      const record = await ownRecord(user, requestId)
      if (record.result !== 'partial') return { result: record.result, crtime: record.crtime ?? null, partialFailed: partialOf(record.result) }
      // DB 에 닿지 못한 실패(503·504) 등은 200 partial 로 숨기지 않고 그 오류로 알린다. 기록은 partial 그대로라 다시 부를 수 있다.
      // partial 응답은 DB 가 답했는데 쓸 문서가 없을 때(0건)뿐이다.
      const done = await rewriteFinish(record)
      if (!done) return { result: 'partial', crtime: record.crtime ?? null, partialFailed: ['finish'] }
      await note(requestId, { result: 'ok', finish: done, steps: ['setscenario', 'finish'], finishedAt: now() })
      log.info(`deploy ${requestId} finish rewritten`)
      return { result: 'ok', crtime: record.crtime ?? null, partialFailed: [] }
    })
  }

  return { deploy, verify, finish }
}

module.exports = { createDeployService, requestChunks }

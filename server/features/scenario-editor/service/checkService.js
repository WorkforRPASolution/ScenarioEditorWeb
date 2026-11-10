'use strict'
// 검사·배포가 함께 쓰는 준비 단계(prepare)와 POST /check(check). 편집 시나리오 해석 → 권한 → 기준 판·다른 판 그림 → 대상 상태·충돌.
const { parseEditedScenario, EditedScenarioError } = require('../domain/editedScenario')
const { checkScenario } = require('../domain/rules')
const { detectConflict, propertyDiff, valueDiff, PROPERTY_ALL_KEYS } = require('../domain/conflict')
const { propertyRev } = require('../domain/deployIdentity')
const { pickCurrent } = require('../domain/versionPick')
const { seError } = require('../errors')

const MB = 1048576
const num = (v, d) => (Number.isFinite(Number(v)) && String(v).trim() !== '' ? Number(v) : d)
const bad = (message, details) => seError(400, 'BAD_REQUEST', message, details)
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const nonEmpty = (v) => typeof v === 'string' && v !== ''
const SOURCE_KEYS = ['process', 'model', 'name', 'crtime', 'fileId']

function parseTarget(t) {
  if (!isObject(t)) throw bad('target 이 필요합니다', { path: 'target', reason: '객체여야 합니다' })
  for (const k of ['process', 'model', 'name']) if (!nonEmpty(t[k])) throw bad(`target.${k} 가 필요합니다`, { path: `target.${k}`, reason: '비어 있지 않은 문자열이어야 합니다' })
  return { process: t.process, model: t.model, name: t.name }
}

// R2: 기준 판은 scenario.source 하나가 정본이다. 요청 최상위 source 는 있으면 같아야 한다.
function assertSameSource(top, inner) {
  if (top === undefined) return
  if (top === null || inner === null) {
    if (top !== inner) throw bad('source 가 scenario.source 와 다릅니다', { path: 'source', reason: top === null ? 'scenario.source 가 있는데 source 가 null 입니다' : 'source 가 있는데 scenario.source 가 null 입니다' })
    return
  }
  if (!isObject(top)) throw bad('source 모양이 틀립니다', { path: 'source', reason: '객체 또는 null 이어야 합니다' })
  for (const k of SOURCE_KEYS) {
    if (top[k] !== inner[k]) throw bad('source 가 scenario.source 와 다릅니다', { path: 'source', reason: `${k} 가 scenario.source.${k} 와 다릅니다` })
  }
}

// 다른 판 그림 참조(from: 'other')를 판 단위로 모은다 — 스텝 uid 는 IMAGE_SOURCE_GONE 을 붙일 곳이다.
function otherRefs(edited) {
  const byKey = new Map()
  for (const s of edited.steps) {
    const refs = [...Object.values(s.images.train), s.images.base]
    for (const r of refs) {
      if (!r || r.from !== 'other') continue
      const key = [r.process, r.model, r.name, r.crtime, r.fileId].join('\u0000')
      if (!byKey.has(key)) byKey.set(key, { version: { process: r.process, model: r.model, name: r.name, crtime: r.crtime, fileId: r.fileId }, uids: new Set() })
      byKey.get(key).uids.add(s.uid)
    }
  }
  return [...byKey.values()]
}

const nextNames = (p) => ['NextScenarioIfSuccess', 'NextScenarioIfFail']
  .map((k) => p && p[k] && p[k].Name).filter((n) => typeof n === 'string' && n !== '')

function createCheckService({ repo, hash, scopes, opener, env = process.env }) {
  async function prepare(user, { source, target: rawTarget, scenario, propertyRev: metaRev, force }) {
    if (scenario === undefined || scenario === null) throw bad('scenario 가 필요합니다', { path: 'scenario', reason: '객체여야 합니다' })
    let edited
    try { edited = parseEditedScenario(scenario) } catch (e) {
      if (e instanceof EditedScenarioError) throw bad(`편집 시나리오 모양이 틀립니다: ${e.message}`, { path: e.path, reason: e.reason })
      throw e
    }
    assertSameSource(source, edited.source)
    if (metaRev !== undefined && metaRev !== null && typeof metaRev !== 'string') throw bad('propertyRev 모양이 틀립니다', { path: 'propertyRev', reason: '문자열 또는 null 이어야 합니다' })
    if (force !== undefined && typeof force !== 'boolean') throw bad('force 모양이 틀립니다', { path: 'force', reason: '참거짓이어야 합니다' })
    const t = parseTarget(rawTarget)
    const base = edited.source
    const process = base ? base.process : t.process
    if (t.process !== process) throw bad('대상은 기준 판과 같은 공정이어야 합니다', { path: 'target.process', reason: `기준 판 공정은 ${process} 입니다` })

    // 권한부터 — 하나라도 밖이면 어떤 판도 열지 않는다
    const others = otherRefs(edited)
    const pairs = new Map()
    for (const [p, m] of [...(base ? [[base.process, base.model]] : []), [t.process, t.model], ...others.map((o) => [o.version.process, o.version.model])]) pairs.set(`${p}\u0000${m}`, [p, m])
    for (const [p, m] of pairs.values()) await scopes.assertAllowed(user, p, m)

    const extraBlocks = []
    let sourceSkeleton = null
    if (base) {
      // force([다시 만듭니다]·[내 내용으로 덮어씁니다])면 기준 판 파일이 지워졌어도 디스크 캐시가 남아 있으면 그것을 기준 판으로 쓴다(2026-11-07 결정 (a))
      const opened = await opener.source(user, base, force === true ? { cacheIfGone: true } : undefined)
      if (opened.gone) extraBlocks.push({ code: 'SOURCE_GONE' })
      else sourceSkeleton = opened.skeleton
    }
    const goneUids = new Set()
    for (const o of others) {
      const opened = await opener.source(user, o.version)
      if (opened.gone) for (const uid of o.uids) goneUids.add(uid)
    }
    // 스텝 순서대로 낸다
    for (const s of edited.steps) if (goneUids.has(s.uid)) extraBlocks.push({ code: 'IMAGE_SOURCE_GONE', uid: s.uid })

    const modelDocs = (await repo.findScenarioDocs(t.process, t.model)).filter((d) => d && d.property)
    const followGraph = new Map()
    for (const d of modelDocs) if (d.scname !== t.name) followGraph.set(d.scname, nextNames(d.property))
    const ctx = {
      user, target: t, targetNames: new Set(modelDocs.map((d) => d.scname)), followGraph,
      limits: { bodyMax: 15 * MB, requestMax: num(env.EARS_INTERFACE_MAX_REQUEST_MB, 100) * MB }
    }

    const withProperty = (await repo.findScenarioKeyDocs(t.process, t.model, t.name)).filter((d) => 'property' in d)
    if (withProperty.length > 1) throw seError(422, 'DATA_INVALID', '같은 공정·모델·이름의 운영 속성 문서가 둘 이상입니다')
    const doc = withProperty[0] ?? null
    const exists = doc !== null
    const scope = await scopes.scopeFor(user)
    const pair = scope.pairs.find((x) => x.process === t.process)
    const model = pair && pair.models.find((x) => x.model === t.model)
    const eqpCount = model ? model.eqpCount : 0

    const sameScenario = !!base && t.model === base.model && t.name === base.name
    let conflict = null
    if (sameScenario) {
      const currentCrtime = pickCurrent(await hash.hkeys(`${t.process}-${t.model}`), t.name) // null 이지 undefined 가 아니다
      conflict = detectConflict({
        sameScenario, docExists: exists, headCrtime: edited.headCrtime, currentCrtime,
        propertyRev: metaRev ?? null, currentPropertyRev: propertyRev(doc ? doc.property : undefined), owners: doc && doc.property ? doc.property.Owners : undefined
      })
    }
    // 운영 속성 충돌에는 배포하면 바뀌는 값(지금 서버 값 → 이 화면 값)을 함께 싣는다 — 안내만으로는 무엇이 바뀌는지 알 수 없다(2026-11-10).
    // 지문은 수정 이력 줄·숫자 저장 형만 달라도 바뀐다. 배포가 쓸 값과 지금 값이 모든 칸에서 같으면 덮어써도 잃는 것이 없어 충돌로 묻지 않는다
    // (2026-11-10 사용자 결정). 지금 문서를 풀 수 없는 칸은 차이로 남으므로 그때는 묻는다.
    if (conflict && conflict.kind === 'property') {
      const diff = valueDiff(propertyDiff(doc.property, edited.property, PROPERTY_ALL_KEYS))
      conflict = diff.length ? { ...conflict, diff } : null
    }
    const targetExists = !sameScenario && exists ? { diff: propertyDiff(doc.property, edited.property) } : null
    return { edited, sourceSkeleton, ctx, target: { process: t.process, model: t.model, name: t.name, exists, eqpCount, doc }, conflict, targetExists, extraBlocks }
  }

  async function check(user, meta) {
    if (!isObject(meta)) throw bad('요청 본문이 필요합니다', { path: '$', reason: '객체여야 합니다' })
    const p = await prepare(user, meta)
    // 크기(sizes)는 본문을 조립해야 알 수 있어 배포 쪽에서 본다 — 여기서는 건너뛴다
    const r = checkScenario(p.edited, p.sourceSkeleton, p.ctx)
    return { blocks: [...r.blocks, ...p.extraBlocks], warns: r.warns, target: { exists: p.target.exists, eqpCount: p.target.eqpCount }, conflict: p.conflict, targetExists: p.targetExists }
  }

  return { prepare, check }
}

module.exports = { createCheckService }

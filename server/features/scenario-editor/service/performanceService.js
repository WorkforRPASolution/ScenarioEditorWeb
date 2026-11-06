'use strict'
// 심의·성과 저장(설계 §7), 같은 이름 모델 찾기, 사용자 찾기, 이름 규칙. 쓰는 것은 performance.* 필드뿐이다(바뀐 것만 $set).
const { reviewDenial } = require('../domain/writePolicy')
const { reviewFields, performanceFields, citizenDevelopers } = require('../domain/performanceEdit')
const { performanceFromBson } = require('../domain/performanceModel')
const { checkPerformance } = require('../domain/rules/performanceRules')
const { GRADE_NAMES } = require('../domain/enums')
const { seError } = require('../errors')

// 성과 창이 보내는 필드(BSON 키). Supervisor·UpdateDate·EqpPerfornmanceLoss 는 서버가 정하거나 건드리지 않고, CitizenDeveloper 는 따로 받는다.
const INPUT_KEYS = new Set(['Group', 'Trigger', 'TriggerInfo', 'Grade', 'SupervisorComment', 'PerformType', 'ScenarioDescription',
  'ManWorkLoss', 'EqpStopLoss', 'WaferLoss', 'InvestCostLoss', 'AdditionalEffect', 'AccidentType', 'AccidentInfo'])
// 화면이 성과 전체를 보내도 받되 쓰지 않는다(performanceFields 가 뺀다)
const IGNORED_KEYS = new Set(['Supervisor', 'UpdateDate', 'EqpPerfornmanceLoss'])
const USER_SEARCH_MIN = 2

const bad = (path, reason) => seError(400, 'BAD_REQUEST', '요청 본문이 틀립니다', { path, reason })
const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v)

function createPerformanceService({ repo, scopes, now = () => Date.now() }) {
  // 권한 → 운영 속성 문서 하나. 0건 404, 2건 이상 422(열기·판 관리와 같은 판정).
  async function propertyDoc(user, key) {
    await scopes.assertAllowed(user, key.process, key.model)
    return docOf(await repo.findScenarioKeyDocs(key.process, key.model, key.name))
  }
  function docOf(all) {
    const docs = all.filter((d) => 'property' in d)
    if (docs.length === 0) throw seError(404, 'NOT_FOUND', '시나리오가 없습니다')
    if (docs.length > 1) throw seError(422, 'DATA_INVALID', '같은 공정·모델·이름의 운영 속성 문서가 둘 이상입니다')
    return docs[0]
  }
  const denied = (user) => {
    const d = reviewDenial(user, { writeDisabled: false }) // 단독판 쓰기 끔은 requireReviewer 가 이미 막았다
    if (d) throw seError(d.status, d.code, d.message)
  }
  const performanceOf = (doc) => (isObject(doc.performance) ? doc.performance : {})
  const reread = async (key) => performanceFromBson(docOf(await repo.findScenarioKeyDocs(key.process, key.model, key.name)).performance)

  async function review(user, key, { grade, comment } = {}) {
    denied(user)
    if (grade !== undefined && !(Number.isInteger(grade) && grade >= 0 && grade < GRADE_NAMES.length)) throw bad('grade', '등급 번호가 아닙니다')
    if (comment !== undefined && typeof comment !== 'string') throw bad('comment', '문자열이어야 합니다')
    const doc = await propertyDoc(user, key)
    const fields = reviewFields(performanceOf(doc), { grade, comment }, user.singleid)
    if (Object.keys(fields).length) {
      const { matched } = await repo.setReview(key, fields)
      if (!matched) throw seError(404, 'NOT_FOUND', '시나리오가 없습니다')
    }
    return { performance: await reread(key) }
  }

  // 원개발자 입력 검증 + 사용자 조회(등록 여부·이름·process)
  async function developerContext(list) {
    if (list === undefined) return null
    if (!Array.isArray(list)) throw bad('citizenDevelopers', '배열이어야 합니다')
    list.forEach((d, i) => {
      if (!isObject(d) || typeof d.KnoxId !== 'string' || typeof d.Contribution !== 'number') throw bad(`citizenDevelopers[${i}]`, 'KnoxId(문자열)·Contribution(숫자)이 필요합니다')
    })
    const usersById = new Map()
    for (const id of new Set(list.map((d) => d.KnoxId))) {
      const found = await repo.findUsers(id)
      if (found.length) usersById.set(id, found[0])
    }
    return { list, usersById }
  }

  async function savePerformance(user, key, { fields = {}, citizenDevelopers: devList, alsoModels = [] } = {}) {
    denied(user)
    if (!isObject(fields)) throw bad('fields', '객체여야 합니다')
    if (!Array.isArray(alsoModels) || alsoModels.some((m) => typeof m !== 'string')) throw bad('alsoModels', '문자열 배열이어야 합니다')
    const unknown = Object.keys(fields).filter((k) => !INPUT_KEYS.has(k) && !IGNORED_KEYS.has(k))
    if (unknown.length) throw bad(`fields.${unknown[0]}`, '저장할 수 없는 성과 필드입니다')
    const doc = await propertyDoc(user, key)
    const dev = await developerContext(devList)
    const current = performanceOf(doc)

    const check = checkPerformance(
      { ...current, ...fields, CitizenDeveloper: dev ? dev.list : undefined },
      { previous: current, registeredIds: new Set(dev ? dev.usersById.keys() : []) }
    )
    if (check.length) throw seError(422, 'VALIDATION_FAILED', '성과 입력을 확인하세요', { blocks: check })

    const at = new Date(now())
    const input = { ...fields }
    if (dev) input.CitizenDeveloper = citizenDevelopers(dev.list, dev.usersById, ((await repo.findPerformanceRaw(key)) || {}).CitizenDeveloper)
    const own = performanceFields(current, input, { singleid: user.singleid, now: at })
    if (Object.keys(own).length) {
      const { matched } = await repo.setPerformanceFields(key, own)
      if (!matched) throw seError(404, 'NOT_FOUND', '시나리오가 없습니다')
    }

    // 같은 이름 다른 모델: 원개발자는 빼고 바뀐 필드만(DC-136). 한 모델이 안 돼도 나머지는 계속한다(SE-033). 쓰기 결과를 모르는 오류도 자동으로 다시 하지 않는다.
    const applied = []
    const { CitizenDeveloper: _skip, ...shared } = input
    for (const model of [...new Set(alsoModels)].filter((m) => m !== key.model)) {
      const target = { process: key.process, model, name: key.name }
      try {
        const other = await propertyDoc(user, target)
        const f = performanceFields(performanceOf(other), shared, { singleid: user.singleid, now: at })
        if (Object.keys(f).length) {
          const { matched } = await repo.setPerformanceFields(target, f)
          if (!matched) { applied.push({ model, ok: false, code: 'NOT_FOUND' }); continue }
        }
        applied.push({ model, ok: true })
      } catch (e) {
        applied.push({ model, ok: false, code: (e && e.code) || 'WRITE_FAILED' })
      }
    }
    return { performance: await reread(key), applied }
  }

  async function sameName(user, process, name) {
    const { pairs } = await scopes.scopeFor(user)
    const mine = pairs.find((p) => p.process === process)
    if (!mine) throw seError(403, 'PROCESS_FORBIDDEN', '공정 권한 밖의 공정입니다')
    const allowed = new Set(mine.models.map((m) => m.model))
    return (await repo.findSameNameModels(process, name)).filter((m) => allowed.has(m))
  }

  async function searchUsers(user, q) {
    const text = typeof q === 'string' ? q.trim() : ''
    if (text.length < USER_SEARCH_MIN) throw seError(400, 'BAD_REQUEST', `검색어는 ${USER_SEARCH_MIN}자 이상이어야 합니다`)
    return (await repo.searchUsers(text)).map((u) => ({ singleid: u.singleid, name: u.name }))
  }

  async function nameRule() {
    const exists = await repo.hasNameRule()
    return { exists, rules: exists ? await repo.findNameRule() : [] }
  }

  return { review, savePerformance, sameName, searchUsers, nameRule }
}

module.exports = { createPerformanceService }

'use strict'
// 결과 메일 수신인(P5 설계 §5.5) — 시험 실행 창에서 고른 설비들이 실행 결과 메일을 누구에게 보내는지 보인다. 읽기만 한다.
// 규칙은 domain/recipients.js(실제 발송 규칙을 옮긴 것). 메일을 보낼지는 결과와 시나리오의 메일 생략 속성이 먼저 정하고,
// 묶음은 실행이 끝날 때 다시 정해진다 — 여기의 값은 지금 기준의 미리 보기다. 이름은 붙이지 않는다(주소만 — Q-068).
const { seError } = require('../errors')
const { groupRecipients, categoryOf } = require('../domain/recipients')
const { testRunLimits } = require('../domain/testRun')

const isText = (v) => typeof v === 'string' && v !== ''

function createRecipientService({ repo, scopes, env = process.env }) {
  async function forEquipment(user, body) {
    const bad = (path) => seError(400, 'BAD_REQUEST', '요청 형식이 올바르지 않습니다', { path })
    if (body === null || typeof body !== 'object' || Array.isArray(body)) throw bad('')
    for (const k of ['process', 'model', 'name']) if (!isText(body[k])) throw bad(k)
    if (!Array.isArray(body.eqpIds) || body.eqpIds.length > testRunLimits(env).maxEquipment || !body.eqpIds.every(isText)) throw bad('eqpIds')
    await scopes.assertAllowed(user, body.process, body.model)
    if (!body.eqpIds.length) return { groups: [] }
    // 내 범위의 그 공정·모델 설비만 — 그 밖의 것(없는 설비·다른 모델)은 말없이 뺀다
    const wanted = new Set(body.eqpIds)
    const { valid } = await scopes.scopeFor(user)
    const equipment = valid.filter((e) => wanted.has(e.eqpId) && e.process === body.process && e.eqpModel === body.model)
    if (!equipment.length) return { groups: [] }
    const rules = await repo.findEmailRules(body.name)
    const categories = [...new Set(equipment.map((e) => categoryOf(rules, e).category).filter(isText))].sort()
    const infos = new Map()
    for (const d of categories.length ? await repo.findEmailInfos(categories) : []) {
      if (!infos.has(d.category)) infos.set(d.category, [])
      infos.get(d.category).push(d)
    }
    return { groups: groupRecipients({ rules, equipment, infos }) }
  }
  return { forEquipment }
}

module.exports = { createRecipientService }

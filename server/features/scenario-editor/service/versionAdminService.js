'use strict'
// 판 관리: 운영 속성 켜기·끄기(Owners 동작 줄)와 삭제(delscenario). 설계 §6.
const { toggleLine, ownersWithLine } = require('../domain/owners')
const { propertyRev } = require('../domain/deployIdentity')
const { seError } = require('../errors')

function createVersionAdminService({ repo, scopes, interfaceClient, now = () => Date.now() }) {
  // 권한 → 운영 속성 문서 하나. 0건 404, 2건 이상 422(열기·검사와 같은 판정).
  async function propertyDoc(user, key) {
    await scopes.assertAllowed(user, key.process, key.model)
    const docs = (await repo.findScenarioKeyDocs(key.process, key.model, key.name)).filter((d) => 'property' in d)
    if (docs.length === 0) throw seError(404, 'NOT_FOUND', '시나리오가 없습니다')
    if (docs.length > 1) throw seError(422, 'DATA_INVALID', '같은 공정·모델·이름의 운영 속성 문서가 둘 이상입니다')
    return docs[0]
  }

  // 이미 같은 값이어도 사내처럼 줄을 남긴다. 쓰기 결과를 모르면(504) repo 오류를 그대로 올리고 다시 보내지 않는다.
  async function setEnabled(user, { process, model, name }, enabled) {
    const key = { process, model, name }
    const doc = await propertyDoc(user, key)
    const line = toggleLine(user.singleid, new Date(now()), enabled)
    const owners = ownersWithLine(doc.property.Owners, line)
    const { matched } = await repo.setEnabled(key, { enabled, owners })
    if (!matched) throw seError(404, 'NOT_FOUND', '시나리오가 없습니다')
    const after = (await repo.findScenarioKeyDocs(process, model, name)).find((d) => 'property' in d)
    const prop = after ? after.property : { ...doc.property, IsEnabled: enabled, Owners: owners }
    return { isEnabled: prop.IsEnabled === true, propertyRev: propertyRev(prop) }
  }

  // delscenario 는 0건에도 성공이라 먼저 본다.
  async function remove(user, { process, model, name }, confirmName) {
    if (confirmName !== name) throw seError(400, 'BAD_REQUEST', '확인 이름이 시나리오 이름과 다릅니다', { path: 'confirmName', reason: '시나리오 이름과 같아야 합니다' })
    await propertyDoc(user, { process, model, name })
    await interfaceClient.delScenario({ process, model, name })
    return { deleted: true }
  }

  return { setEnabled, remove }
}

module.exports = { createVersionAdminService }

'use strict'
// 기준 판과 비교해 고친 스텝·운영 속성 키를 가린다. 브라우저가 보낸 "고쳤다" 표시는 믿지 않고 값으로 비교한다.
const { editedFromSkeleton } = require('./editedScenario')

// 모든 단계에서 키를 정렬한 JSON. undefined 는 JSON 처럼 없는 것과 같다.
function canonicalJson(value) {
  const norm = (v) => {
    if (Array.isArray(v)) return v.map(norm)
    if (v && typeof v === 'object') {
      const out = {}
      for (const k of Object.keys(v).sort()) out[k] = norm(v[k])
      return out
    }
    return v
  }
  return JSON.stringify(norm(v0(value)))
}
const v0 = (v) => (v === undefined ? null : v)

// 대상은 번호·uid 가 아니라 가리키는 스텝(기준 위치)으로 비교한다. 삽입으로 번호만 바뀐 스텝은 고친 게 아니다.
function targetKey(t, uidToStep) {
  if (t && t.kind === 'step') {
    const s = uidToStep.get(t.uid)
    if (!s) return { kind: 'unresolved' }
    return s.origin === null ? { kind: 'step', new: s.uid } : { kind: 'step', origin: s.origin }
  }
  return t
}

function stepKey(s, uidToStep) {
  return canonicalJson({
    condition: s.condition, action: s.action, retry: s.retry,
    descriptionToEmail: s.descriptionToEmail, descriptionToDialog: s.descriptionToDialog, isShowDialog: s.isShowDialog,
    images: s.images,
    onTrue: targetKey(s.next && s.next.onTrue, uidToStep), onFalse: targetKey(s.next && s.next.onFalse, uidToStep)
  })
}

function changedStepUids(edited, source) {
  const changed = new Set()
  if (!source) { for (const s of edited.steps) changed.add(s.uid); return changed }
  const base = editedFromSkeleton(source).steps
  const uidToStep = new Map(edited.steps.map((s) => [s.uid, s]))
  // 기준 쪽 대상은 기준 스텝의 위치(origin = 인덱스)로 같은 꼴로 바꿔 비교한다.
  const baseUidToStep = new Map(base.map((s) => [s.uid, s]))
  const used = new Set()
  for (const s of edited.steps) {
    // origin 이 기준 밖이거나 이미 다른 편집 스텝이 쓴 값이면 브라우저가 보내선 안 되는 값이다.
    // 저장 원본을 두 번 재사용하게 되므로 새로 조립하는 쪽(고친 것)이 안전하다.
    const o = s.origin
    if (o === null || !Number.isInteger(o) || o < 0 || o >= base.length || used.has(o)) { changed.add(s.uid); continue }
    used.add(o)
    if (stepKey(s, uidToStep) !== stepKey(base[o], baseUidToStep)) changed.add(s.uid)
  }
  return changed
}

function changedPropertyKeys(editedProperty, sourceProperty) {
  const e = editedProperty || {}
  const s = sourceProperty || {}
  const keys = new Set([...Object.keys(e), ...Object.keys(s)])
  keys.delete('Owners') // 배포가 정한다(설계 §6.2)
  const changed = new Set()
  for (const k of keys) {
    if (sourceProperty == null || canonicalJson(e[k]) !== canonicalJson(s[k])) changed.add(k)
  }
  return changed
}

module.exports = { changedStepUids, changedPropertyKeys }

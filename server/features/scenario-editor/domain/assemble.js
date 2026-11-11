'use strict'
// 편집 시나리오 → 사내 편집기와 같은 글자의 본문·BI 항목·property(설계 §6.8). 글자 일치의 정본은 생성기 왕복 시험(assemble.golden).
// 파일·DB·네트워크를 만지지 않는다 — 그림 바이트(base64)는 부른 쪽이 넘긴 resolveImage(ref) 로 받는다.
const { serializeScenario, serializeProperty } = require('./csharpJson')
const { withCsDefaults, newRawStep } = require('./csDefaults')
const { encodeCondition, encodeAction } = require('./conditionCodec')
const { fromTarget } = require('./nextStep')
const { changedStepUids } = require('./changeDetect')
const { isTrainKey } = require('./trainKey')
const { targetRawFor, hidingRawFor } = require('./windowsModel')

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k)

// 편집 스텝 images.train 의 값을 키마다 한 번만 푼다: 그림 참조는 resolveImage, { literal } 은 그 값 그대로.
// 정규 키가 아니면("01"·"-1"·"1.0") 같은 사전 키를 두 번 쓰거나 엉뚱한 키를 쓴다 — 형식 검사(parseEditedScenario)가 먼저 막으므로 프로그램 오류.
async function trainValues(train, resolveImage) {
  const out = new Map()
  for (const k of Object.keys(train)) {
    if (!isTrainKey(k)) throw new Error('BAD_TRAIN_KEY')
    out.set(k, hasOwn(train[k], 'literal') ? train[k].literal : await resolveImage(train[k]))
  }
  return out
}

// 저장 표(객체) → 직렬화 사전 [[정수 키, 항목]]. raw 문자열(URL)을 보고 그림 자리를 고르지 않고 편집 스텝 images.train 으로 채운다.
// - 정규 키: images.train 값으로 BinaryImage 를 바꾼다. images.train 에 없으면 편집 스텝에서 뺀 그림이라 쓰지 않는다(고치지 않은 스텝은 늘 있다).
// - 그 밖의 키: 저장값 그대로. 정수가 아니면 직렬화기가 거절한다(C# Dictionary<int,…> 가 가질 수 없는 키라 사내도 열지 못한다, 한계).
// 한계: 키 오름차순으로 나온다 — Mongo 에서 읽은 JS 객체가 정수 키를 오름차순으로 늘어놓아 저장 순서를 알 수 없다.
function storedTrainDict(isp, values) {
  if (!isObject(isp) || !isObject(isp.TrainImageMap)) return
  const out = []
  for (const [k, entry] of Object.entries(isp.TrainImageMap)) {
    if (isTrainKey(k)) {
      if (!values.has(k)) continue
      if (isObject(entry)) entry.BinaryImage = values.get(k) // 항목이 null 이면 null 그대로
    }
    out.push([Number(k), entry])
  }
  isp.TrainImageMap = out.sort((a, b) => a[0] - b[0])
}

const sortedKeys = (o) => Object.keys(o).sort((a, b) => Number(a) - Number(b))

async function unchangedStep(es, source, indexOfUid, resolveImage) {
  const raw = clone(source.steps[es.origin].raw)
  storedTrainDict(isObject(raw.Metadata) ? raw.Metadata.ImageSearchParam : null, await trainValues(es.images.train, resolveImage))
  raw.NextStepIfTrue = fromTarget(es.next.onTrue, indexOfUid)
  raw.NextStepIfFalse = fromTarget(es.next.onFalse, indexOfUid)
  return raw
}

async function changedStep(es, source, indexOfUid, resolveImage) {
  const origin = source && es.origin !== null ? source.steps[es.origin] : undefined
  const values = await trainValues(es.images.train, resolveImage)
  let base
  const types = new Map()
  if (origin) {
    // 사내가 옛 본문을 읽을 때처럼 빠진 키를 C# 기본값으로 채운 뒤 고친다
    base = withCsDefaults('ScenarioStep', clone(origin.raw))
    const isp = isObject(base.Metadata) ? base.Metadata.ImageSearchParam : null
    if (isObject(isp) && isObject(isp.TrainImageMap)) {
      for (const [k, e] of Object.entries(isp.TrainImageMap)) if (isObject(e) && typeof e.Type === 'boolean') types.set(k, e.Type)
    }
    storedTrainDict(isp, values) // 이미지 조건은 아래 encodeCondition 이 trainEntries 로 바꾼다, 그 밖은 이 표가 남는다
  } else {
    base = newRawStep(es.condition.kind) // 설비 상태·알 수 없는 조건은 여기서 던진다(검사 CONDITION_NOT_CREATABLE 이 먼저 막는다)
  }
  const trainEntries = sortedKeys(es.images.train).map((k) => [Number(k), { BinaryImage: values.get(k), Type: types.has(k) ? types.get(k) : true }])
  // 그대로 두는 조건(설비 상태·알 수 없음)은 고치기 전 스텝의 Operation 을 쓴다(브라우저의 operationRaw 는 믿지 않는다)
  const { Operation, Metadata } = encodeCondition(es.condition, base.Metadata, trainEntries, origin ? base.Operation : undefined)
  return {
    ...base,
    Operation,
    Metadata,
    Script: encodeAction(es.action, base.Script),
    // 참거짓·유한 수가 아니면(검사가 먼저 막지만) 바탕 값 — 고치기 전 저장값(빠진 키는 C# 기본값) 또는 새 스텝 기본값
    RetryLimit: Number.isFinite(es.retry.limit) ? es.retry.limit : base.RetryLimit,
    RetryInterval: Number.isFinite(es.retry.intervalMs) ? es.retry.intervalMs : base.RetryInterval,
    NextStepIfTrue: fromTarget(es.next.onTrue, indexOfUid),
    NextStepIfFalse: fromTarget(es.next.onFalse, indexOfUid),
    DescriptionToEmail: es.descriptionToEmail,
    DescriptionToDialog: es.descriptionToDialog,
    IsShowDialog: typeof es.isShowDialog === 'boolean' ? es.isShowDialog : base.IsShowDialog
  }
}

// 제한 시간은 검사(TIMEOUT_INVALID)가 먼저 막는다. 빈 값을 Number('') = 0 으로 쓰지 않게 정수 표기만 숫자로 — 그 밖은 NaN 이라 직렬화기가 거절한다.
const timeoutOf = (t) => (typeof t === 'string' && /^-?\d+$/.test(t) ? Number(t) : NaN)

async function headerOf(edited, source, id, resolveImage) {
  const head = { ID: id, Description: edited.header.description, TimeoutLimit: timeoutOf(edited.header.timeoutLimit) }
  // 창 조건(P2-F 설계 §5): 편집 값이 저장값과 같은 뜻이면 저장값을 그대로 두고(null 글자·null 목록 포함), 달라진 조건만 새로 쓴다.
  // windows 가 없으면(옛 초안) 저장값 그대로다. undefined = 손대지 않는다.
  const w = edited.header.windows
  const stored = (source && source.header.raw) || {}
  const targetNew = w ? targetRawFor(w.target, stored.TargetWindowCondition) : undefined
  const hidingNew = w ? hidingRawFor(w.hiding, stored.HidingWindowConditionList) : undefined
  if (!source) {
    // 새 시나리오: 넣은 창 조건만 쓰고 나머지는 withCsDefaults 가 사내 새 시나리오 값으로 채운다
    if (targetNew !== undefined) head.TargetWindowCondition = targetNew
    if (hidingNew !== undefined) head.HidingWindowConditionList = hidingNew
    return head
  }
  const sh = source.header
  head.RevisionNo = sh.revisionNo
  head.TriggerType = sh.triggerType
  head.Text = sh.text
  const raw = sh.raw || {}
  if (targetNew !== undefined) head.TargetWindowCondition = targetNew
  else if (hasOwn(raw, 'TargetWindowCondition')) head.TargetWindowCondition = clone(raw.TargetWindowCondition)
  // 숨길 창은 저장값(null 포함) 그대로 — 화면용 hidingWindows 는 배열이 아니면 [] 라 쓰지 않는다. 없던 키는 withCsDefaults 가 [] 로 채운다.
  if (hidingNew !== undefined) head.HidingWindowConditionList = hidingNew
  else if (hasOwn(raw, 'HidingWindowConditionList')) head.HidingWindowConditionList = clone(raw.HidingWindowConditionList)
  if (hasOwn(raw, 'Compensation')) {
    const c = clone(raw.Compensation)
    // 보정 그림이 그림이었으면 뼈대 raw 에는 null, 그림은 'ref' 로 떼어 있다
    if (isObject(c) && c.RefImage === null && sh.compensation && sh.compensation.refImage) c.RefImage = await resolveImage({ from: 'source', id: 'ref' })
    head.Compensation = c
  }
  return head
}

// 기준 화면은 편집 스텝 images.base. null 은 검사 BI_COUNT_MISMATCH 가 먼저 막으므로 여기까지 오면 프로그램 오류다.
function biEntryOf(es) {
  const b = es.images.base
  if (!isObject(b)) throw new Error('BI_ENTRY_MISSING')
  return hasOwn(b, 'literal') ? { kind: 'literal', value: b.literal } : { kind: 'image', ref: clone(b) }
}

async function assembleScenario(edited, source, { id, resolveImage }) {
  const changed = changedStepUids(edited, source)
  const biEntries = edited.steps.map(biEntryOf)
  const indexOfUid = new Map(edited.steps.map((s, i) => [s.uid, i]))
  const steps = []
  for (const es of edited.steps) {
    steps.push(changed.has(es.uid) ? await changedStep(es, source, indexOfUid, resolveImage) : await unchangedStep(es, source, indexOfUid, resolveImage))
  }
  const body = withCsDefaults('Scenario', { ...(await headerOf(edited, source, id, resolveImage)), Step: steps })
  return { body, bodyString: serializeScenario(body), biEntries, changed }
}

// Owners·LcncType 은 받은 값 그대로(배포 직전 목록으로 바꾸는 것은 P2-B, 설계 §6.2·§14.1 ④). null 후속은 직렬화기가 뺀다.
function assembleProperty(property, { id }) {
  const p = { ...withCsDefaults('ScenarioProperty', property), ID: id }
  for (const k of ['NextScenarioIfSuccess', 'NextScenarioIfFail']) {
    if (isObject(p[k]) && p[k].Text === null) p[k] = { ...p[k], Text: '' } // 후속 설명은 빈 값도 "" (§6.8)
  }
  return serializeProperty(p)
}

module.exports = { assembleScenario, assembleProperty }

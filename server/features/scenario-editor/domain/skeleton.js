'use strict'
// 본문(GridFS metadata.body)·운영 속성·성과 → 브라우저용 뼈대 + 떼어 낼 이미지 목록(설계 §5.3).
// BI(파일 내용)는 부른 쪽이 흘려 읽어 기준 화면을 먼저 디스크에 쓴다(biStream). 여기는 그 결과 baseImages { parseFailed, present(스텝 번호) } 만 받는다.
const { parseCondition, parseAction, note } = require('./conditionCodec')
const { toTarget } = require('./nextStep')
const { graphNotes, scenarioNotes, SCENARIO_NOTE_CODES } = require('./notes')
const { judgeTargetWindow } = require('./targetWindow')
const { propertyFromBson } = require('./propertyModel')
const { performanceFromBson } = require('./performanceModel')

const isImage = (b64) => typeof b64 === 'string' && b64.length > 4 // "AA==" = 1바이트 자리표시(조건 없음·설비 상태)

const isObject = (v) => v !== null && typeof v === 'object'

// 학습 이미지 표(TrainImageMap). 없거나 객체가 아니면 빈 표.
function trainMapOf(step) {
  const isp = step.Metadata && step.Metadata.ImageSearchParam
  const map = isp && isp.TrainImageMap
  return isObject(map) ? map : {}
}

const needsBaseImage = (kind) => kind === 'image' || kind === 'ocr'
const baseImageId = (i) => `s${i}-bi`

// BI 를 읽으며 어느 항목을 기준 화면으로 떼어 낼지 정한다(스텝 번호, 항목 값 -> 참·거짓).
function wantsBaseImage(storedBody) {
  const rawSteps = isObject(storedBody) && Array.isArray(storedBody.Step) ? storedBody.Step : []
  const needed = new Set()
  rawSteps.forEach((stored, i) => { if (needsBaseImage(parseCondition(stored).condition.kind)) needed.add(i) })
  return (i, value) => needed.has(i) && isImage(value)
}

const NO_BASE_IMAGES = Object.freeze({ parseFailed: false, present: new Set() })

function rawWithUrls(step, trainUrl) {
  const copy = JSON.parse(JSON.stringify(step))
  const map = trainMapOf(copy)
  for (const k of Object.keys(map)) if (isObject(map[k])) map[k].BinaryImage = trainUrl(k, map[k].BinaryImage)
  return copy
}

function buildSkeleton({ process, model, name, crtime, isCurrent, body: storedBody, baseImages = NO_BASE_IMAGES, propertyDoc, performanceDoc, imageBaseUrl }) {
  const notesOut = []
  // 본문이 객체가 아니면 빈 본문으로 열고 알린다(깨진 저장 값은 던지지 않는다 — 설계 §5.6).
  if (!isObject(storedBody)) notesOut.push(note('warning', 'PARSE_FAILED', { field: 'body' }))
  const body = isObject(storedBody) ? storedBody : {}
  if (isObject(storedBody) && body.Step !== undefined && !Array.isArray(body.Step)) notesOut.push(note('warning', 'PARSE_FAILED', { field: 'steps' }))
  const rawSteps = Array.isArray(body.Step) ? body.Step : []
  const uids = rawSteps.map((_, i) => `s${i}`)
  const url = (id) => `${imageBaseUrl}/${id}`
  if (baseImages.parseFailed) notesOut.push(note('warning', 'PARSE_FAILED', { field: 'bi' }))
  const images = []
  let needed = 0
  let present = 0
  const steps = rawSteps.map((stored, i) => {
    const stepIsObject = isObject(stored)
    const st = stepIsObject ? stored : {} // 객체가 아닌 스텝은 빈 스텝으로 읽는다(해석 실패 경고는 parseCondition 이 한 번 단다)
    const c = parseCondition(stored)
    const a = parseAction(stored, c.condition.kind)
    const notes = [...c.notes, ...(stepIsObject ? a.notes : [])]
    const trainIds = new Map()
    if (c.condition.image) {
      const map = trainMapOf(st)
      let badKeyNoted = false
      c.condition.image.trainImages = c.condition.image.trainImages.map((ti) => {
        // 이미지 ID·URL 은 음이 아닌 안전한 정수 키에만 만든다(그 밖의 키는 이미지 캐시가 거절해 열기 전체가 실패한다)
        if (!(Number.isSafeInteger(ti.key) && ti.key >= 0)) {
          if (!badKeyNoted) notes.push(note('warning', 'PARSE_FAILED', { field: 'trainImage' }))
          badKeyNoted = true
          return { ...ti, url: null }
        }
        const entry = map[ti.key] ?? map[String(ti.key)]
        if (!isObject(entry)) notes.push(note('warning', 'PARSE_FAILED', { field: 'trainImage', key: ti.key }))
        if (isObject(entry) && isImage(entry.BinaryImage)) {
          const id = `s${i}-train-${ti.key}`
          images.push({ id, base64: entry.BinaryImage })
          trainIds.set(String(ti.key), url(id))
          return { ...ti, url: url(id) }
        }
        return { ...ti, url: null }
      })
    }
    let baseImage
    if (!needsBaseImage(c.condition.kind)) baseImage = { state: 'notNeeded' }
    else {
      needed++
      if (baseImages.present.has(i)) {
        present++
        baseImage = { state: 'present', url: url(baseImageId(i)) }
      } else {
        baseImage = { state: 'missing' }
        notes.push(note('info', 'BASE_IMAGE_MISSING'))
      }
    }
    return {
      uid: uids[i], no: i + 1, condition: c.condition, action: a.action,
      next: { onTrue: toTarget(st.NextStepIfTrue, uids), onFalse: toTarget(st.NextStepIfFalse, uids) },
      retry: { limit: st.RetryLimit, intervalMs: st.RetryInterval },
      descriptionToEmail: st.DescriptionToEmail, descriptionToDialog: st.DescriptionToDialog, isShowDialog: st.IsShowDialog,
      baseImage, notes,
      raw: rawWithUrls(st, (k) => trainIds.get(String(k)) ?? null)
    }
  })
  const g = graphNotes(rawSteps, steps.map((s) => s.next), uids)
  steps.forEach((s, i) => s.notes.push(...g[i]))

  const targetWindow = judgeTargetWindow(body.TargetWindowCondition)
  let compensation = null
  if (body.Compensation && typeof body.Compensation === 'object') {
    compensation = { x: body.Compensation.X, y: body.Compensation.Y, refImage: null }
    if (isImage(body.Compensation.RefImage)) {
      images.push({ id: 'ref', base64: body.Compensation.RefImage })
      compensation.refImage = url('ref')
    }
  }

  // 운영 속성·성과·시나리오 알림은 refreshPropertyParts 가 붙인다(열 때마다 현재 값으로 다시 붙이는 것과 같은 경로).
  const skeleton = refreshPropertyParts({
    process, model, name, id: body.ID, version: { crtime, isCurrent },
    header: {
      description: body.Description, timeoutLimit: body.TimeoutLimit, revisionNo: body.RevisionNo, triggerType: body.TriggerType,
      text: body.Text, targetWindow, hidingWindows: Array.isArray(body.HidingWindowConditionList) ? body.HidingWindowConditionList : [],
      compensation
    },
    steps,
    baseImageSummary: { needed, present },
    property: null,
    performance: null,
    notes: notesOut
  }, propertyDoc, performanceDoc)
  return { skeleton, images }
}

// 현재 운영 속성에 기대지 않는 알림 — 시나리오 알림(SCENARIO_NOTE_CODES)과 운영 속성 해석 실패(PARSE_FAILED property)를 뺀 나머지.
// 속성만 바뀐 뒤 뼈대의 시나리오 알림을 다시 만들 때 남겨 둘 알림이다. 순서는 그대로, 입력은 바꾸지 않는다.
function versionNotes(notes) {
  return notes.filter((n) => !SCENARIO_NOTE_CODES.includes(n.code) && !(n.code === 'PARSE_FAILED' && n.params && n.params.field === 'property'))
}

// 운영 속성·성과는 버전과 무관한 현재 값이다 — 캐시된 뼈대에 열 때마다 다시 붙인다. 버전 쪽 알림(versionNotes: 본문·BI 해석 등)은 남긴다.
function refreshPropertyParts(skeleton, propertyDoc, performanceDoc) {
  const prop = propertyFromBson(propertyDoc)
  const notes = [...versionNotes(skeleton.notes)]
  if (!prop.ok) notes.push(note('warning', 'PARSE_FAILED', { field: 'property', error: prop.error }))
  notes.push(...scenarioNotes({ rawSteps: skeleton.steps.map((s) => s.raw), property: prop.ok ? prop.value : null, targetWindow: skeleton.header.targetWindow }))
  return { ...skeleton, property: prop.ok ? prop.value : null, performance: performanceFromBson(performanceDoc), notes }
}

module.exports = { buildSkeleton, wantsBaseImage, baseImageId, versionNotes, refreshPropertyParts }

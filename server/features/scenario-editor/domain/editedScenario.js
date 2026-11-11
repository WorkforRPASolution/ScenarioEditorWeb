'use strict'
// 편집 시나리오: 브라우저가 검사·초안·배포 요청에 싣는 구조 값(저장 형식 문자열 없음). 모양·형만 본다(업무 규칙은 rules).
const { isTrainKey, trainImageId } = require('./trainKey')
const { CS_DEFAULTS } = require('./csDefaults')
const { windowsOf, INT32_MIN, INT32_MAX } = require('./windowsModel')

class EditedScenarioError extends Error {
  constructor(path, reason) {
    super(`${path}: ${reason}`)
    this.name = 'EditedScenarioError'
    this.path = path
    this.reason = reason
  }
}

const fail = (path, reason) => { throw new EditedScenarioError(path, reason) }
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)))

const CONDITION_KINDS = ['none', 'image', 'ocr', 'eqpState', 'unknown']

function needObject(v, path) { if (!isObject(v)) fail(path, '객체여야 합니다'); return v }
function needString(v, path) { if (typeof v !== 'string') fail(path, '문자열이어야 합니다'); return v }
function stringOrNull(v, path) { if (v !== null && typeof v !== 'string') fail(path, '문자열 또는 null 이어야 합니다'); return v }
function numberOrNull(v, path) { if (v !== null && !(typeof v === 'number' && Number.isFinite(v))) fail(path, '숫자 또는 null 이어야 합니다'); return v }

function parseTarget(t, path) {
  needObject(t, path)
  switch (t.kind) {
    case 'step':
      if (typeof t.uid !== 'string' || t.uid === '') fail(`${path}.uid`, '비어 있지 않은 문자열이어야 합니다')
      return { kind: 'step', uid: t.uid }
    case 'end':
      if (!['FAIL', 'SUCCESS', 'SKIP'].includes(t.value)) fail(`${path}.value`, 'FAIL·SUCCESS·SKIP 중 하나여야 합니다')
      return { kind: 'end', value: t.value }
    case 'next': return { kind: 'next' }
    case 'raw': return { kind: 'raw', value: clone(t.value === undefined ? null : t.value) }
    case 'unresolved': {
      const out = { kind: 'unresolved' }
      if (t.value !== undefined) {
        if (typeof t.value !== 'number' || !Number.isFinite(t.value)) fail(`${path}.value`, '숫자여야 합니다')
        out.value = t.value
      }
      return out
    }
    default: return fail(`${path}.kind`, '알 수 없는 대상 종류입니다')
  }
}

function parseSourceInfo(s, path) {
  needObject(s, path)
  needString(s.process, `${path}.process`); needString(s.model, `${path}.model`); needString(s.name, `${path}.name`)
  if (typeof s.crtime !== 'number' || !Number.isFinite(s.crtime)) fail(`${path}.crtime`, '숫자여야 합니다')
  return { process: s.process, model: s.model, name: s.name, crtime: s.crtime, fileId: s.fileId }
}

function parseImageRef(r, path, { allowLiteral }) {
  needObject(r, path)
  if (allowLiteral && 'literal' in r) {
    if (r.literal !== null && typeof r.literal !== 'string') fail(`${path}.literal`, '문자열 또는 null 이어야 합니다')
    return { literal: r.literal }
  }
  const idOf = () => { if (typeof r.id !== 'string' || r.id === '') fail(`${path}.id`, '비어 있지 않은 문자열이어야 합니다'); return r.id }
  if (r.from === 'source') return { from: 'source', id: idOf() }
  if (r.from === 'other') {
    needString(r.process, `${path}.process`); needString(r.model, `${path}.model`); needString(r.name, `${path}.name`)
    if (typeof r.crtime !== 'number' || !Number.isFinite(r.crtime)) fail(`${path}.crtime`, '숫자여야 합니다')
    needString(r.fileId, `${path}.fileId`)
    return { from: 'other', process: r.process, model: r.model, name: r.name, crtime: r.crtime, fileId: r.fileId, id: idOf() }
  }
  if (r.from === 'upload') {
    if (typeof r.tempId !== 'string' || r.tempId === '') fail(`${path}.tempId`, '비어 있지 않은 문자열이어야 합니다')
    return { from: 'upload', tempId: r.tempId }
  }
  return fail(`${path}.from`, '알 수 없는 그림 참조입니다')
}

function parseImages(im, path) {
  needObject(im, path)
  needObject(im.train, `${path}.train`)
  const train = {}
  for (const k of Object.keys(im.train)) {
    // 찾을 그림 키는 음이 아닌 정수의 정규 표기만 — "1"·"01" 이 함께 오면 같은 사전 키를 두 번 쓰게 된다. '__proto__' 도 여기서 막혀 대입되지 않는다.
    if (!isTrainKey(k)) fail(`${path}.train.${k}`, '찾을 그림 키는 음이 아닌 정수(0, 1, …)여야 합니다')
    train[k] = parseImageRef(im.train[k], `${path}.train.${k}`, { allowLiteral: true })
  }
  const base = im.base === null || im.base === undefined ? null : parseImageRef(im.base, `${path}.base`, { allowLiteral: true })
  return { train, base }
}

function parseStep(s, i, seen) {
  const p = `steps[${i}]`
  needObject(s, p)
  if (typeof s.uid !== 'string' || s.uid === '') fail(`${p}.uid`, 'uid 는 비어 있지 않은 문자열이어야 합니다')
  if (seen.has(s.uid)) fail(`${p}.uid`, `uid 가 겹칩니다: ${s.uid}`)
  seen.add(s.uid)
  if (s.origin !== null && !(Number.isInteger(s.origin) && s.origin >= 0)) fail(`${p}.origin`, '0 이상의 정수 또는 null 이어야 합니다')
  needObject(s.condition, `${p}.condition`)
  if (!CONDITION_KINDS.includes(s.condition.kind)) fail(`${p}.condition.kind`, '알 수 없는 조건 종류입니다')
  needObject(s.action, `${p}.action`)
  if (s.action.type !== null && !Number.isInteger(s.action.type)) fail(`${p}.action.type`, '정수 또는 null 이어야 합니다')
  needObject(s.next, `${p}.next`)
  needObject(s.retry, `${p}.retry`)
  if (s.isShowDialog !== null && typeof s.isShowDialog !== 'boolean') fail(`${p}.isShowDialog`, '참거짓 또는 null 이어야 합니다')
  return {
    uid: s.uid, origin: s.origin,
    condition: clone(s.condition), action: clone(s.action),
    next: { onTrue: parseTarget(s.next.onTrue, `${p}.next.onTrue`), onFalse: parseTarget(s.next.onFalse, `${p}.next.onFalse`) },
    retry: { limit: numberOrNull(s.retry.limit, `${p}.retry.limit`), intervalMs: numberOrNull(s.retry.intervalMs, `${p}.retry.intervalMs`) },
    descriptionToEmail: stringOrNull(s.descriptionToEmail, `${p}.descriptionToEmail`),
    descriptionToDialog: stringOrNull(s.descriptionToDialog, `${p}.descriptionToDialog`),
    isShowDialog: s.isShowDialog,
    images: parseImages(s.images, `${p}.images`)
  }
}

// 창 조건 하나(P2-F 설계 §4). 글자는 문자열(빈 칸은 ""), 위치 확인은 참거짓, 좌표는 Int32 정수.
function parseWindow(w, path) {
  needObject(w, path)
  const out = { text: needString(w.text, `${path}.text`), className: needString(w.className, `${path}.className`) }
  if (typeof w.checkRect !== 'boolean') fail(`${path}.checkRect`, '참거짓이어야 합니다')
  out.checkRect = w.checkRect
  for (const k of ['left', 'top', 'right', 'bottom']) {
    if (!Number.isInteger(w[k]) || w[k] < INT32_MIN || w[k] > INT32_MAX) fail(`${path}.${k}`, 'Int32 정수여야 합니다')
    out[k] = w[k]
  }
  return out
}

// header.windows = { target, hiding[] }. 숨길 창의 origin 은 출처 판 목록의 자리(0 이상 정수)이거나 새 줄이면 null — 같은 자리를 두 줄이 가리킬 수 없다.
function parseWindows(w, path) {
  needObject(w, path)
  const target = parseWindow(w.target, `${path}.target`)
  if (!Array.isArray(w.hiding)) fail(`${path}.hiding`, '배열이어야 합니다')
  const seen = new Set()
  const hiding = w.hiding.map((h, i) => {
    const p = `${path}.hiding[${i}]`
    needObject(h, p)
    if (h.origin !== null && !(Number.isInteger(h.origin) && h.origin >= 0)) fail(`${p}.origin`, '0 이상의 정수 또는 null 이어야 합니다')
    if (h.origin !== null) {
      if (seen.has(h.origin)) fail(`${p}.origin`, '같은 origin 이 둘 이상입니다')
      seen.add(h.origin)
    }
    return { origin: h.origin, ...parseWindow(h, p) }
  })
  return { target, hiding }
}

function parseEditedScenario(json) {
  needObject(json, '$')
  const source = json.source === null ? null : parseSourceInfo(json.source, 'source')
  // fileId 는 열기 경로가 채워 준다. 아직 없으면(editedFromSkeleton 기본값) null.
  if (source && source.fileId !== null && typeof source.fileId !== 'string') fail('source.fileId', '문자열 또는 null 이어야 합니다')
  const headCrtime = json.headCrtime
  if (headCrtime !== null && !(typeof headCrtime === 'number' && Number.isFinite(headCrtime))) fail('headCrtime', '숫자 또는 null 이어야 합니다')
  needObject(json.header, 'header')
  const header = { description: needString(json.header.description, 'header.description'), timeoutLimit: needString(json.header.timeoutLimit, 'header.timeoutLimit') }
  // 창 조건은 없어도 된다(P2-F 전에 저장한 초안) — 없으면 조립이 출처 판의 저장값을 그대로 쓴다
  if (json.header.windows !== undefined && json.header.windows !== null) header.windows = parseWindows(json.header.windows, 'header.windows')
  if (!Array.isArray(json.steps)) fail('steps', '배열이어야 합니다')
  const seen = new Set()
  const steps = json.steps.map((s, i) => parseStep(s, i, seen))
  needObject(json.property, 'property')
  return { source, headCrtime, header, steps, property: clone(json.property) }
}

const nullish = (v) => (v === undefined ? null : v)
// 옛 본문에 없던 스텝 키(undefined)는 사내 편집기가 읽을 때처럼 C# ScenarioStep 생성자 값으로 채운다 — 고쳐 다시 쓰면 그 값이 나간다.
// 키가 있고 값이 null 이면 null 그대로(저장값에 충실). 기준 쪽(changedStepUids)도 이 함수를 지나므로 고치지 않은 스텝은 그대로 같다.
const stepValue = (v, key) => (v === undefined ? CS_DEFAULTS.ScenarioStep[key]() : v)

function targetOf(t) {
  if (t && t.kind === 'step') return { kind: 'step', uid: t.uid } // no 는 위치라 끼워 넣으면 낡는다
  if (t && t.kind === 'raw') return { kind: 'raw', value: nullish(clone(t.value)) }
  return clone(t)
}

// 찾을 그림 참조는 조건 종류와 상관없이 raw 의 찾을 그림 표에서 만든다(이미지가 아닌 스텝도 표를 지닐 수 있다).
// 뼈대가 뗀 그림은 raw 에 그 URL(…/s{i}-train-{키})이 들어 있다 — '-' 는 base64 글자가 아니라 저장값과 헷갈리지 않는다.
// 정규 키가 아닌 항목은 참조를 만들지 않는다(조립이 raw 의 저장값을 그대로 쓴다).
function trainOf(step, i) {
  const out = {}
  const isp = ((step.raw || {}).Metadata || {}).ImageSearchParam
  const map = isObject(isp) ? isp.TrainImageMap : null
  if (!isObject(map)) return out
  for (const k of Object.keys(map)) {
    if (!isTrainKey(k)) continue
    const entry = map[k]
    // 항목에 BinaryImage 키가 없으면 C# TrainImage 생성자 값(사내가 읽어 다시 쓰는 값), 있던 null 은 null
    const v = isObject(entry) ? (entry.BinaryImage === undefined ? CS_DEFAULTS.TrainImage.BinaryImage() : entry.BinaryImage) : null
    const id = trainImageId(i, k)
    out[k] = typeof v === 'string' && v.endsWith(`/${id}`) ? { from: 'source', id } : { literal: nullish(clone(v)) }
  }
  return out
}

function baseOf(bi, i) {
  if (bi && bi.kind === 'image') return { from: 'source', id: `s${i}-bi` }
  if (bi && bi.kind === 'literal') return { literal: nullish(bi.value) }
  return null
}

function editedFromSkeleton(skeleton, { fileId } = {}) {
  const h = skeleton.header || {}
  return {
    source: { process: skeleton.process, model: skeleton.model, name: skeleton.name, crtime: skeleton.version.crtime, fileId: fileId ?? null },
    headCrtime: skeleton.headCrtime ?? null,
    header: {
      description: typeof h.description === 'string' ? h.description : '',
      timeoutLimit: typeof h.timeoutLimit === 'number' && Number.isFinite(h.timeoutLimit) ? String(h.timeoutLimit) : '',
      windows: windowsOf(h.raw)
    },
    steps: skeleton.steps.map((s, i) => ({
      uid: s.uid, origin: i,
      condition: clone(s.condition), action: clone(s.action),
      next: { onTrue: targetOf(s.next.onTrue), onFalse: targetOf(s.next.onFalse) },
      retry: { limit: stepValue(s.retry && s.retry.limit, 'RetryLimit'), intervalMs: stepValue(s.retry && s.retry.intervalMs, 'RetryInterval') },
      descriptionToEmail: stepValue(s.descriptionToEmail, 'DescriptionToEmail'), descriptionToDialog: stepValue(s.descriptionToDialog, 'DescriptionToDialog'),
      isShowDialog: stepValue(s.isShowDialog, 'IsShowDialog'),
      images: { train: trainOf(s, i), base: baseOf(s.bi, i) }
    })),
    property: clone(skeleton.property ?? {})
  }
}

module.exports = { parseEditedScenario, editedFromSkeleton, EditedScenarioError }

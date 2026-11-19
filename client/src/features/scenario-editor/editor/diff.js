// 저장 전 변경 목록(목업 svChanges). 스텝은 uid 로 짝짓는다 — 갈 곳도 uid 참조라 번호만 바뀐 스텝은 고친 것이 아니다(서버 changeDetect 와 같은 기준).
import { windowChanges } from './windows'

// 모든 단계에서 키를 정렬한 JSON(서버 changeDetect.canonicalJson 과 같다). undefined 는 null.
export function canonicalJson(value) {
  const norm = (v) => {
    if (Array.isArray(v)) return v.map(norm)
    if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, norm(v[k])]))
    return v
  }
  return JSON.stringify(norm(value === undefined ? null : value))
}

// 스텝 값 비교 키. origin 은 위치 정보라 뺀다.
const stepKey = (s) => canonicalJson({
  condition: s.condition, action: s.action, retry: s.retry,
  descriptionToEmail: s.descriptionToEmail, descriptionToDialog: s.descriptionToDialog, isShowDialog: s.isShowDialog,
  images: s.images, next: s.next
})
export const sameStep = (a, b) => a === b || (!!a && !!b && stepKey(a) === stepKey(b))

// ── 판이 다른 두 스텝 견주기(SEW-019) ──
// [이 버전으로 되돌려 열기] 세션은 작업본(옛 판)과 저장 기준점(현재 판)의 출처가 다르다. 그림 참조 { from: 'source', id } 는 판마다 다른 그림을,
// 찾을 그림 주소(condition.image.trainImages[].url)는 판마다 다른 글자를 가리켜, 고치지 않은 그림 스텝까지 "저장 전 N곳" 에 잡혔다.
// 서버가 판마다 보낸 그림 내용 지문(뼈대의 imageFp)으로 견준다 — 사용자 결정 (b) 2026-11-09. 주소를 무시하는 방법 (a) 는 정말 다른 그림을 놓쳤다.

// 판 열쇠 — 지문 표(세션의 imageFp: 판 열쇠 → { 그림 id → 지문 })의 키. 출처(source)와 붙여 온 그림 참조(from other)가 같은 칸을 지닌다.
export const versionKeyOf = (v) => (v ? JSON.stringify([v.process, v.model, v.name, v.crtime, v.fileId ?? null]) : null)

// 그림 참조의 비교 값: 지문을 아는 그림은 지문(판이 달라도 같은 그림이면 같다), 모르면 참조 그대로 — 출처 그림은 그 판 열쇠를 붙여
// 판이 다르면 같다고 보지 않는다. 저장값(literal)·올릴 그림(upload)은 참조 그대로.
function imageValue(ref, source, fps) {
  if (!ref || typeof ref !== 'object' || 'literal' in ref) return ref ?? null
  const ver = ref.from === 'source' ? source : ref.from === 'other' ? ref : null
  const fp = ver ? fps?.[versionKeyOf(ver)]?.[ref.id] : undefined
  if (fp) return { fp }
  return ref.from === 'source' ? { ...ref, of: versionKeyOf(source) } : ref
}

// 비교용 스텝: 찾을 그림 주소를 빼고(그림은 images 로 견준다 — 주소는 참조에서 나온다) 그림 참조를 비교 값으로. 입력은 바꾸지 않는다.
// source = 그 스텝이 든 작업본의 출처 판, fps = 지문 표.
export function comparableStep(step, source, fps) {
  if (!step) return step
  const image = step.condition?.image
  const condition = Array.isArray(image?.trainImages)
    ? { ...step.condition, image: { ...image, trainImages: image.trainImages.map(({ url, ...ti }) => ti) } }
    : step.condition
  const train = Object.fromEntries(Object.entries(step.images?.train ?? {}).map(([k, r]) => [k, imageValue(r, source, fps)]))
  return { ...step, condition, images: { train, base: imageValue(step.images?.base ?? null, source, fps) } }
}

// 기준 위치 배열에서 가장 긴 증가 부분 수열에 들지 않는 인덱스 집합(O(n²), 스텝은 200개 이하).
function outsideLis(pos) {
  const n = pos.length
  const len = new Array(n).fill(1)
  const prev = new Array(n).fill(-1)
  let best = -1
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < i; j++) if (pos[j] < pos[i] && len[j] + 1 > len[i]) { len[i] = len[j] + 1; prev[i] = j }
    if (best < 0 || len[i] > len[best]) best = i
  }
  const keep = new Set()
  for (let i = best; i >= 0; i = prev[i]) keep.add(i)
  return new Set(pos.map((_, i) => i).filter((i) => !keep.has(i)))
}

// 운영 속성에서 바뀐 키(저장 전 변경의 운영 속성 행·운영 속성 창의 "아직 배포 전" 표시)
export const changedPropertyKeys = (a, b) => {
  const x = a || {}
  const y = b || {}
  return [...new Set([...Object.keys(x), ...Object.keys(y)])].filter((k) => k !== 'Owners' && canonicalJson(x[k]) !== canonicalJson(y[k])).sort() // Owners 는 배포가 정한다
}

// 바 칸·운영 속성은 저장 기준점과 비교한다. 새 시나리오(출처 없음)의 기준점은 만든 때의 작업본이라 만든 뒤 바꾼 것만 센다(P2-D Task 6).
// 스텝은 비교용 스텝(comparableStep)으로 견준다 — fps = 세션의 지문 표(되돌려 연 세션의 그림, SEW-019). 같은 출처의 같은 객체는 견주지 않는다.
export function unsavedChanges(working, saveBase, fps = null) {
  const out = []
  if (!working || !saveBase) return out
  for (const [key, field] of [['description', 'description'], ['timeoutLimit', 'timeoutLimit']]) {
    const before = saveBase.header?.[field]
    const after = working.header?.[field]
    if (String(before ?? '') !== String(after ?? '')) out.push({ kind: 'field', key, before, after })
  }
  // 창 조건(P2-F): 같은 출처면 숨길 창을 자리(origin)로 맞춰 고침을 가르고, 출처가 다르면(되돌려 연 세션) 내용으로만 견준다
  const sameSource = canonicalJson(working.source ?? null) === canonicalJson(saveBase.source ?? null)
  const unchanged = (b, s) => (b === s && sameSource) || stepKey(comparableStep(b, saveBase.source, fps)) === stepKey(comparableStep(s, working.source, fps))
  const wc = windowChanges(working.header?.windows, saveBase.header?.windows, { byOrigin: sameSource })
  if (wc.target) out.push({ kind: 'field', key: 'targetWindow', ...wc.target })
  if (wc.hiding) out.push({ kind: 'field', key: 'hidingWindows', ...wc.hiding })
  const keys = changedPropertyKeys(working.property, saveBase.property)
  if (keys.length) out.push({ kind: 'field', key: 'property', keys })
  const baseIndex = new Map(saveBase.steps.map((s, i) => [s.uid, i]))
  const baseStep = new Map(saveBase.steps.map((s) => [s.uid, s]))
  const nowUids = new Set(working.steps.map((s) => s.uid))
  // moved = 기준 판에도 있던 스텝 가운데, 기준 판 스텝들끼리의 앞뒤 순서가 바뀐 것(번호만 밀린 스텝은 아니다)
  const existing = working.steps.map((s, i) => ({ s, no: i + 1 })).filter(({ s }) => baseIndex.has(s.uid))
  const moved = outsideLis(existing.map(({ s }) => baseIndex.get(s.uid)))
  const movedUids = new Set([...moved].map((i) => existing[i].s.uid))
  working.steps.forEach((s, i) => {
    const no = i + 1
    if (!baseStep.has(s.uid)) { out.push({ kind: 'added', uid: s.uid, no }); return }
    if (!unchanged(baseStep.get(s.uid), s)) out.push({ kind: 'changed', uid: s.uid, no })
    if (movedUids.has(s.uid)) out.push({ kind: 'moved', uid: s.uid, no })
  })
  saveBase.steps.forEach((s, i) => { if (!nowUids.has(s.uid)) out.push({ kind: 'deleted', uid: s.uid, no: i + 1 }) })
  return out
}

// 세션의 저장 전 변경 — 위쪽 바 "저장 전 N곳"·저장 창 "바뀐 것"·스텝 표의 바뀐 줄이 함께 쓴다.
export const sessionChanges = (s) => (s?.working && s.saveBase ? unsavedChanges(s.working, s.saveBase, s.imageFp) : [])

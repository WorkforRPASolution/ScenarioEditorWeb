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
export function unsavedChanges(working, saveBase) {
  const out = []
  if (!working || !saveBase) return out
  for (const [key, field] of [['description', 'description'], ['timeoutLimit', 'timeoutLimit']]) {
    const before = saveBase.header?.[field]
    const after = working.header?.[field]
    if (String(before ?? '') !== String(after ?? '')) out.push({ kind: 'field', key, before, after })
  }
  // 창 조건(P2-F): 같은 출처면 숨길 창을 자리(origin)로 맞춰 고침을 가르고, 출처가 다르면(되돌려 연 세션) 내용으로만 견준다
  const sameSource = canonicalJson(working.source ?? null) === canonicalJson(saveBase.source ?? null)
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
    if (!sameStep(baseStep.get(s.uid), s)) out.push({ kind: 'changed', uid: s.uid, no })
    if (movedUids.has(s.uid)) out.push({ kind: 'moved', uid: s.uid, no })
  })
  saveBase.steps.forEach((s, i) => { if (!nowUids.has(s.uid)) out.push({ kind: 'deleted', uid: s.uid, no: i + 1 }) })
  return out
}

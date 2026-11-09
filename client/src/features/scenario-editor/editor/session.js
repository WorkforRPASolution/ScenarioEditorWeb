import { sameStep } from './diff'
import { newScenarioOf } from './newScenario'

// 편집 세션 — 서버가 준 작업본(skeleton.edited)을 그대로 쥔다. 브라우저에서 만들거나 기본값을 채우지 않는다.
export function beginSession(skeleton, me) {
  const edited = skeleton.edited ?? null
  const v = skeleton.version ?? {}
  const source = edited
    ? { process: skeleton.process, model: skeleton.model, name: skeleton.name, crtime: v.crtime, fileId: v.fileId }
    : null
  const readOnly = !me?.canWrite ? 'noWrite' : v.isCurrent === false ? 'oldVersion' : null
  return {
    source,
    headCrtime: skeleton.headCrtime,
    propertyRev: skeleton.propertyRev ?? null,
    readOnly,
    working: edited,
    saveBase: edited,
    seq: 0
  }
}

// 작업본에 없는 새 uid. session 은 불변으로 다룬다.
export function nextUid(session, prefix) {
  const used = new Set((session.working?.steps ?? []).map((s) => s.uid))
  let seq = session.seq
  let uid
  do { uid = `${prefix}${++seq}` } while (used.has(uid))
  return [uid, { ...session, seq }]
}

export const stepIndex = (working, uid) => working.steps.findIndex((s) => s.uid === uid)
export const stepNo = (working, uid) => stepIndex(working, uid) + 1

// ── 불러오기 창에서 여는 세션(P2-D Task 7, 설계 §6.1·§6.7, 목업 2026-11-08-load-write-v1) ──
// 둘 다 { session, skeleton } 을 준다 — skeleton = 열린 뼈대(바·주소·표시). 세션 정체성(newId)·초점은 저장소가 정한다.
const writeMode = (me) => (me?.canWrite ? null : 'noWrite')

// 손대지 않은 스텝(기준 판과 같은 값·같은 원래 자리)은 기준 판 스텝 객체를 쓴다 — 표시가 뼈대(서버 알림·저장값)를 쓰고, 다 같으면 배열도 그대로.
function reuseBaseSteps(steps, baseSteps) {
  const byUid = new Map(baseSteps.map((s) => [s.uid, s]))
  const out = steps.map((s) => { const b = byUid.get(s.uid); return b && b.origin === s.origin && sameStep(b, s) ? b : s })
  return out.length === baseSteps.length && out.every((s, i) => s === baseSteps[i]) ? baseSteps : out
}

// [이 버전으로 되돌려 열기]: 옛 판 내용을 현재 판 위의 작업본으로(설계 §6.7). 작업본 = 옛 판 edited(출처 = 옛 판 — 그림 참조가 옛 판을 가리킨다),
// 연 때 값(headCrtime·propertyRev)·운영 속성 = 현재 판(운영 속성은 판마다 남지 않는다). 저장 기준점 = 현재 판 — "저장 전 N곳" 은 배포하면 바뀌는 곳.
// 열린 뼈대 = 현재 판(바 "현재 버전"·주소), 내용(스텝·대상 창·시나리오 알림)은 옛 판. restoredFrom 은 배포 meta 로 간다(저장 창).
export function restoreSessionOf(oldSk, curSk, me) {
  const cur = curSk.edited
  const head = curSk.headCrtime ?? curSk.version?.crtime ?? null
  const working = { ...oldSk.edited, headCrtime: head, property: cur.property }
  return {
    session: { source: oldSk.edited.source, headCrtime: head, propertyRev: curSk.propertyRev ?? null, readOnly: writeMode(me), working, saveBase: cur, seq: 0, restoredFrom: oldSk.version.crtime },
    skeleton: { ...curSk, header: oldSk.header, steps: oldSk.steps, notes: oldSk.notes }
  }
}

// [초안 이어서 열기](설계 §6.1). draft = GET /drafts/:id + 키 { process, model, name }(목록의 공정·모델·이름).
// 작업본 = 초안, 연 때 값(headCrtime·propertyRev) = 초안의 것 — 그 뒤 새 버전·운영 속성 변경은 배포 때 충돌로 알린다.
// draft = { id, savedAt }: 서버에만 있는 초안 그림을 보이고(refUrl), 다시 저장·배포할 때 올리지 않는다(request.uploadsToSend).
// fromDraft = 바·알림이 쓰는 연 길(시작한 버전·옛것인지·원본이 지워졌는지)과 초안이 저장하려던 곳(target = { process, model, name } — 저장 창 기본 대상).
// - 기준 판 뼈대(sourceSkeleton)가 있으면: 저장 기준점 = 기준 판 — "저장 전 N곳" 은 초안이 바꾼 곳.
// - 새 시나리오 초안(출처 없음): Task 6 새 시나리오 세션과 같은 모양. 만들 때 모습은 남지 않아 스텝 0·기본 운영 속성(newScenarioOf)으로 어림한다.
// - 원본이 지워져 서버 사본으로만 남은 판(출처는 있는데 뼈대 없음): 기준 판 내용을 받을 길이 없어 연 때 작업본을 기준점으로 둔다(저장 전 0곳).
//   스텝 배열만 따로 두어 표시가 작업본에서 스텝을 그린다(뼈대 스텝이 없다).
export function draftSessionOf(draft, sourceSkeleton, me) {
  const scenario = draft.scenario
  const info = { id: draft.draftId, savedAt: draft.savedAt }
  const head = draft.headCrtime ?? null
  const base = { source: scenario.source, headCrtime: head, propertyRev: draft.propertyRev ?? null, readOnly: writeMode(me), seq: 0, draft: info }
  const target = draft.target ? { process: draft.target.process ?? draft.process, model: draft.target.model, name: draft.target.name } : null // 초안 키의 공정
  const fromDraft = (over) => ({ savedAt: draft.savedAt, baseCrtime: draft.base?.crtime ?? null, target, stale: false, gone: false, ...over })
  if (!scenario.source) {
    const { working: made, skeleton } = newScenarioOf({ process: draft.process, model: draft.model, name: draft.name, type: scenario.property?.Type, description: scenario.header?.description, timeoutLimit: scenario.header?.timeoutLimit })
    return {
      session: { ...base, source: null, headCrtime: null, propertyRev: null, working: scenario, saveBase: made, fromDraft: fromDraft({}) },
      skeleton: { ...skeleton, header: { ...scenario.header, targetWindow: null }, property: scenario.property }
    }
  }
  if (sourceSkeleton) {
    const b = sourceSkeleton.edited
    const working = { ...scenario, steps: reuseBaseSteps(scenario.steps, b.steps) }
    const nowHead = sourceSkeleton.headCrtime ?? null
    return { session: { ...base, working, saveBase: b, fromDraft: fromDraft({ stale: nowHead !== null && head !== nowHead }) }, skeleton: sourceSkeleton }
  }
  const s = scenario.source
  return {
    session: { ...base, working: scenario, saveBase: { ...scenario, steps: [...scenario.steps] }, fromDraft: fromDraft({ gone: true }) },
    skeleton: {
      process: draft.process, model: draft.model, name: draft.name, id: `${draft.process}-${draft.model}-${draft.name}`, sourceGone: true,
      version: { crtime: s.crtime, isCurrent: false, fileId: s.fileId }, headCrtime: null, propertyRev: null,
      header: { ...scenario.header, targetWindow: null }, property: scenario.property, performance: null, steps: [], notes: []
    }
  }
}

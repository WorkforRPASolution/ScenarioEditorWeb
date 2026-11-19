// 검사·초안·배포 요청 만들기(서버 P2-B meta: { target, propertyRev, scenario, ...extra }).
// 최상위 source 는 싣지 않는다 — 기준 판은 scenario.source 하나가 정본이고, 서버는 그와 다른 최상위 source 를 400 으로 막는다(R-P6).
// /check 는 meta 를 JSON 본문으로, /drafts·/deploy 는 멀티파트(필드 meta + 그림 img:<tempId>)로 받는다.
import { uploadIdsOf } from './images'

// 서버 parseEditedScenario 가 받는 키
const SCENARIO_KEYS = ['source', 'headCrtime', 'header', 'steps', 'property']

// session(편집 세션) → { meta, uploadsUsed }. target 을 주지 않으면 기준 판과 같은 시나리오.
// uploadsUsed = 작업본이 실제로 가리키는 올릴 그림 tempId — 잡다가 버린 그림(Esc·다시 잡기)은 저장소 uploads 에 남아 있어도 들지 않는다.
export function buildMeta(session, { target, extra } = {}) {
  const w = session.working
  const scenario = Object.fromEntries(SCENARIO_KEYS.map((k) => [k, w[k]]))
  scenario.headCrtime = session.headCrtime ?? w.headCrtime ?? null
  const s = w.source ?? session.source
  const meta = {
    target: target ?? (s ? { process: s.process, model: s.model, name: s.name } : null),
    propertyRev: session.propertyRev ?? null,
    scenario,
    ...extra
  }
  return { meta, uploadsUsed: uploadIdsOf(w.steps) }
}

// 멀티파트 본문: meta(JSON 문자열) + 쓰는 그림만 img:<tempId>(서버는 어떤 참조도 가리키지 않는 파일을 400 으로 막는다).
// 쓰는 그림의 Blob 이 없으면 빠진 채 보내지 않고 던진다(code 'UPLOAD_MISSING' + tempId — 저장 창이 그 스텝 번호로 알린다).
export function buildFormData(meta, uploads, uploadsUsed) {
  const fd = new FormData()
  fd.append('meta', JSON.stringify(meta))
  for (const id of uploadsUsed) {
    const blob = uploads?.get(id)
    if (!(blob instanceof Blob)) throw Object.assign(new Error(`upload blob missing: ${id}`), { code: 'UPLOAD_MISSING', tempId: id })
    fd.append(`img:${id}`, blob, `${id}.png`)
  }
  return fd
}

// 보낼 그림: 초안에서 이어 연 세션(draftId)은 서버 초안에만 있는 그림(로컬 Blob 이 없는 tempId)을 다시 올리지 않는다 —
// 서버가 그 사용자·시나리오의 초안 그림을 그대로 쓴다(P2-B Task 9). 초안이 없는 세션은 그대로(빠진 Blob 은 buildFormData 가 막는다).
export function uploadsToSend(uploadsUsed, uploads, draftId) {
  return draftId ? uploadsUsed.filter((id) => uploads?.get(id) instanceof Blob) : uploadsUsed
}

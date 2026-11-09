// 불러오기 창 목록 + 내 초안(P2-D Task 7, 설계 §6.1, 목업 2026-11-08-load-write-v1).
// - 초안은 키 이름(원본 이름 — 새 시나리오면 만든 이름)이 같은 목록 행에 붙인다. 저장할 곳(target)이 달라도 원본 행이다.
// - 붙일 행이 없는 초안은 "초안만" 행: 기준 판이 없으면 'new'(배포한 적 없는 새 시나리오), 있으면 'gone'(원본이 지워짐).
// 문구는 돌려주지 않는다 — 화면이 고른다.

// 목록 행(GET /scenarios) 모양의 "초안만" 행
function draftOnlyRow(process, model, d) {
  return {
    name: d.name, id: `${process}-${model}-${d.name}`, isEnabled: null, type: null, typeName: null, trigger: null, triggerName: null,
    grade: null, gradeName: null, description: '', lastOwner: null, currentCrtime: null, status: [],
    draftOnly: d.base ? 'gone' : 'new', draft: d
  }
}

// rows = 목록 행, drafts = 내 초안 목록(GET /drafts). 결과는 이름순(목록과 같은 순서 규칙).
export function mergeDrafts(rows, drafts, { process, model }) {
  const byName = new Map((drafts ?? []).map((d) => [d.name, d]))
  const out = rows.map((r) => ({ ...r, draft: byName.get(r.name) ?? null, draftOnly: null }))
  const listed = new Set(rows.map((r) => r.name))
  for (const d of drafts ?? []) if (!listed.has(d.name)) out.push(draftOnlyRow(process, model, d))
  return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

// 초안을 시작한 뒤 새 버전이 배포됐다 — 초안을 시작할 때의 현재 버전(headCrtime, 옛 초안은 기준 판)이 지금 현재 버전과 다르다.
// 되돌려 연 작업본의 초안은 기준 판이 옛 판이어도 headCrtime 이 그때의 현재 버전이라 옛것이 아니다.
export function draftStale(row) {
  const d = row?.draft
  if (!d || row.draftOnly || row.currentCrtime == null) return false
  const head = d.headCrtime ?? d.base?.crtime ?? null
  return head !== null && head !== row.currentCrtime
}

export const isDup = (row) => !!row?.status?.includes('DUPLICATE_PROPERTY')

// 초안을 저장하려던 곳이 원본(키)과 다르면 그 곳(모델·이름), 같으면 null
export function draftTarget(row, model) {
  const t = row?.draft?.target
  if (!t || (t.model === model && t.name === row.name)) return null
  return t.model === model ? t.name : `${t.model} · ${t.name}`
}

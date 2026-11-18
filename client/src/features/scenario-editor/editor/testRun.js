// 시험 실행 화면의 규칙(P5 설계 §4) — 순수 함수. 서버를 부르지 않는다(상태·호출은 stores/testRunStore.js).
// 서버가 같은 검사를 다시 한다(domain/testRun.js) — 여기의 검사는 버튼을 미리 끄고 까닭을 보이기 위한 것이다.

// 실행 사유 — 사내 값 그대로. 앞 둘은 그 글자가 그대로 나간다
export const REASON_KINDS = ['INSPECTION', 'MAN_EXE', 'other']
export const REASON_MAX = 120
const REASON_BAD = /[\^<>\u0000-\u001f\u007f]/

// 기타 사유의 글 → null | 'EMPTY' | 'TOO_LONG' | 'BAD_CHAR'
export function reasonError(kind, text) {
  if (kind !== 'other') return null
  const s = typeof text === 'string' ? text.trim() : ''
  if (!s) return 'EMPTY'
  if ([...s].length > REASON_MAX) return 'TOO_LONG'
  return REASON_BAD.test(s) ? 'BAD_CHAR' : null
}

// 시작 스텝 칸의 글 → null | 'NOT_NUMBER' | 'RANGE'. max = 현재 판의 스텝 수(모르면 null — 1 이상만 본다)
export function stepError(value, max) {
  const s = String(value ?? '').trim()
  if (!/^\d+$/.test(s)) return 'NOT_NUMBER'
  const n = Number(s)
  return n < 1 || (Number.isInteger(max) && n > max) ? 'RANGE' : null
}

// ── 설비 찾기·고르기 ──
const has = (v, needle) => typeof v === 'string' && v.toLowerCase().includes(needle)
export function searchTargets(items, q) {
  const needle = String(q ?? '').trim().toLowerCase()
  const list = items ?? []
  return needle ? list.filter((e) => has(e.eqpId, needle) || has(e.ipAddr, needle) || has(e.ipAddrL, needle)) : list
}
// 자동조치가 켜진 설비만 고를 수 있다(OFF·읽을 수 없음은 서버도 보내지 않는다)
export const selectableIds = (items) => (items ?? []).filter((e) => e.onoff === 'on').map((e) => e.eqpId)

// 줄 누르기: 그 줄 하나 · toggle(Ctrl·⌘·체크 칸) 더하고 빼기 · range(Shift) 기준 줄부터 그 줄까지 더하기. ids = 보이는 줄 가운데 고를 수 있는 것(순서대로)
export function clickSelect(state, ids, id, { toggle = false, range = false } = {}) {
  if (!ids.includes(id)) return state
  const picked = new Set(state.picked)
  if (range) {
    const from = ids.indexOf(state.anchor)
    if (from < 0) { picked.add(id); return { picked, anchor: id } }
    const to = ids.indexOf(id)
    for (const x of ids.slice(Math.min(from, to), Math.max(from, to) + 1)) picked.add(x)
    return { picked, anchor: state.anchor }
  }
  if (toggle) {
    if (picked.has(id)) picked.delete(id)
    else picked.add(id)
    return { picked, anchor: id }
  }
  return { picked: new Set([id]), anchor: id }
}
// 머리 칸: 보이는 줄 가운데 고를 수 있는 것 모두 — 가려진 줄의 선택은 건드리지 않는다
export function toggleAll(picked, shownIds, on) {
  const next = new Set(picked)
  for (const id of shownIds) { if (on) next.add(id); else next.delete(id) }
  return next
}
export const hiddenCount = (picked, shown) => {
  const visible = new Set((shown ?? []).map((e) => e.eqpId))
  return [...picked].filter((id) => !visible.has(id)).length
}

// ── 시나리오 ──
// 목록 줄(GET /scenarios)의 표시 하나: 'off'(꺼짐) | 'noVersion'(현재 판 없음) | 'check'(확인 필요) | null. 고를 수는 있다 — 고르면 까닭을 알린다.
export function scenarioMark(row) {
  const status = row?.status ?? []
  if (row?.isEnabled === false) return 'off'
  if (status.includes('NO_CURRENT_VERSION')) return 'noVersion'
  return status.includes('DUPLICATE_PROPERTY') || status.includes('PARSE_FAILED') ? 'check' : null
}
// 고른 시나리오와 편집기에 연 시나리오의 관계: 'none' | 'same'(현재 판 그대로) | 'dirty'(저장하지 않은 고침) | 'old'(현재 판이 아닌 세션).
// opened = { process, model, name, unsaved, current } | null. 설비에서 도는 것은 늘 배포된 현재 판이다.
export function openRelation(sel, opened) {
  if (!sel?.name || !opened || opened.process !== sel.process || opened.model !== sel.model || opened.name !== sel.name) return 'none'
  if (opened.unsaved > 0) return 'dirty'
  return opened.current ? 'same' : 'old'
}

// [실행] 이 꺼지는 까닭 → { key, params? } | null (버튼의 title 과 바닥 줄에 보인다)
export function blockReason({ name, loading, info, picked, max, reasonErr, stepErr }) {
  if (!name) return { key: 'SEW_RUN_WHY_NO_SCENARIO' }
  if (loading || !info) return { key: 'SEW_RUN_WHY_LOADING' }
  if (info.blocks?.length) return { key: `SEW_ERR_${info.blocks[0]}` }
  if (!picked) return { key: 'SEW_RUN_WHY_NO_EQP' }
  if (picked > max) return { key: 'SEW_RUN_WHY_LIMIT', params: { max } }
  if (reasonErr) return { key: `SEW_RUN_REASON_${reasonErr}` }
  if (stepErr) return { key: `SEW_RUN_STEP_${stepErr}`, params: { max: info.current?.stepCount ?? null } }
  return null
}

// ── 결과 ──
// 줄의 outcome: 서버가 주는 아홉(accepted·off·recent·forbidden·mismatch·badValue·failed·unknown·down) + 화면의 셋(waiting·sending·skipped)
export const SENT_OUTCOMES = ['accepted', 'unknown'] // 보냈거나 보냈을 수 있다
const PENDING = ['waiting', 'sending']
const NOT_SENT = ['off', 'recent', 'forbidden', 'mismatch', 'badValue', 'down', 'skipped']

export function summarize(items) {
  const n = (list) => items.filter((x) => list.includes(x.outcome)).length
  return { total: items.length, done: items.length - n(PENDING), accepted: n(['accepted']), notSent: n(NOT_SENT), failed: n(['failed']), unknown: n(['unknown']) }
}
// 접수 여부 모름·연결 못 함이 연달아 세 번이면 남은 설비를 보내지 않는다(CommandServer 가 죽어 있으면 설비마다 5~12초씩 기다린다)
export function shouldStop(items, limit = 3) {
  const done = items.filter((x) => !PENDING.includes(x.outcome))
  return done.length >= limit && done.slice(-limit).every((x) => x.outcome === 'unknown' || x.outcome === 'down')
}
// [다시 고르기]: 요청 접수·모름이었던 설비의 선택을 푼다 — 다시 골라 보내는 실수를 줄인다(서버의 "방금 요청함" 이 한 번 더 막는다)
export function keepAfterRun(picked, items) {
  const sent = new Set(items.filter((x) => SENT_OUTCOMES.includes(x.outcome)).map((x) => x.eqpId))
  return new Set([...picked].filter((id) => !sent.has(id)))
}
export function newRunId() {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

// ── 실행 상태(EQP_AUTO_RECOVERY 의 status) ──
const CHECKING_MS = 20_000
const LATE_MS = 10 * 60_000 // CommandServer 는 받은 뒤 10분 안이면 늦게라도 등록·실행한다 — 그 전에는 "없다" 고 단정하지 않는다
const WAIT_GRACE_MS = 30_000
const LOOKUP = ['accepted', 'failed', 'unknown']
const FIXED = {
  StartPending: ['SENT', false, 'run'], StartScenario: ['RUNNING', false, 'run'], Duplicated: ['DUPLICATED', false, 'warn'],
  Success: ['SUCCESS', true, 'ok'], Stopped: ['STOPPED', true, 'idle'], Failed: ['FAILED', true, 'bad'], ScriptFailed: ['SCRIPTFAILED', true, 'bad'],
  VisionDelayed: ['VISIONDELAYED', true, 'bad'], TimeOut: ['TIMEOUT', true, 'bad'], NotStarted: ['NOTSTARTED', true, 'bad'], DenyScenario: ['DENY', true, 'bad']
}
const FINAL_OTHERS = ['Skip', 'Unknown']

// 줄의 실행 상태 표시 → { key, params, final, tone, candidates } | null(실행 기록을 찾아볼 줄이 아니다). now = 서버 시각, startDelay = 시나리오의 시작 지연(초)
export function stateView(item, { now, startDelay = 0 }) {
  if (!LOOKUP.includes(item.outcome)) return null
  const out = (key, final, tone, params = {}) => ({ key: `SEW_RUN_STATE_${key}`, params, final, tone, candidates: item.found > 1 ? item.found : 0 })
  if (!item.found || typeof item.status !== 'string') {
    const age = Number.isFinite(item.sentAt) ? now - item.sentAt : 0
    if (age < CHECKING_MS) return out('CHECKING', false, 'idle')
    if (age < LATE_MS) return out('NOT_YET', false, 'warn')
    return item.outcome === 'accepted' ? out('NONE_ACCEPTED', true, 'bad') : out('NONE_UNSENT', true, 'idle')
  }
  if (item.status === 'Wait') {
    const since = Number.isFinite(item.txnSeq) ? now - item.txnSeq : 0
    if (since > startDelay * 1000 + WAIT_GRACE_MS) return out('WAIT_STUCK', false, 'warn')
    return startDelay > 0 ? out('WAIT_DELAY', false, 'idle', { n: startDelay }) : out('WAIT', false, 'idle')
  }
  if (item.status === 'Retry') {
    const [n = '?', m = '?'] = typeof item.retry === 'string' ? item.retry.split('/') : []
    return out('RETRY', false, 'run', { n, m })
  }
  const fixed = FIXED[item.status]
  if (fixed) return out(fixed[0], fixed[1], fixed[2])
  // 모르는 값은 그대로 보이되 끝났다고 단정하지 않는다
  return out('OTHER', FINAL_OTHERS.includes(item.status), 'idle', { status: item.status })
}
export function isFinal(item, now) {
  const v = stateView(item, { now })
  return v ? v.final : true
}
// 다시 물을 줄 — 보냈거나 보냈을 수 있고 아직 끝 상태가 아니다
export const needsStatus = (item, now) => !isFinal(item, now)
// 다시 읽을 간격(ms). elapsed = 마지막 요청 뒤 지난 시간. null 이면 그만 읽는다
export function pollDelay(elapsed) {
  if (elapsed < 60_000) return 3000
  return elapsed < 15 * 60_000 ? 10_000 : null
}
// 실행 상태 조회의 답을 줄에 덮는다. 응답을 놓친 줄(lost)은 서버의 요청 기록으로 결과를 고친다 — 아직 보내는 중(sending)이면 모름 그대로.
export function applyStatus(items, answers) {
  const byId = new Map((answers ?? []).map((a) => [a.eqpId, a]))
  return items.map((x) => {
    const a = byId.get(x.eqpId)
    if (!a) return x
    const pending = a.outcome === 'sending'
    return {
      ...x, outcome: pending ? x.outcome : a.outcome, lost: pending ? x.lost : false, detail: a.detail ?? null, sentAt: a.sentAt,
      found: a.found, status: a.status, retry: a.retry, txnSeq: a.txnSeq, createDate: a.createDate
    }
  })
}

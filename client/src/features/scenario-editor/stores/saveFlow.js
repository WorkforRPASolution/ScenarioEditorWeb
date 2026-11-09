// 저장 창 흐름(P2-D Task 2, 설계 §5.1·§6·§9, 목업 조작판 20~40). 단계:
//   form(대상·바뀐 곳·검사) → confirm(대상·설비 수 다시 보기) → run(배포 중, 닫을 수 없음) → ok | partial | fail | unknown, 그리고 초안 저장 → draft.
// 서버 결과 code(Global Constraints): 503 UPSTREAM_DOWN = 안 감, 502 UPSTREAM_FAILED = 거절(서버 문구·[버전 목록 확인]),
// 504 UPSTREAM_TIMEOUT + details.requestId = 결과 모름(자동으로 다시 보내지 않는다), result 'partial' = 마무리 실패([다시 쓰기]).
// 409 TARGET_EXISTS·SAVE_CONFLICT·422 VALIDATION_FAILED 는 저장 창(form)으로 돌아가 그린다.
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { scenarioEditorApi as api } from '../api'
import { t, errorCode, errorMessage, MESSAGES } from '../messages'
import { buildMeta, buildFormData } from '../editor/request'
import { unsavedChanges } from '../editor/diff'
import { checkName, nameRuleOf } from '../editor/nameRule'
import { propertyFieldOf } from '../editor/propertyRules'
import { useEditStore } from './editStore'
import { useEditorStore } from './editorStore'

export const CHECK_DELAY_MS = 300 // 대상(모델·이름) 입력이 멈춘 뒤 다시 검사(설계 §5.1)
export const PENDING_KEY = 'se-save-pending' // 결과 모름 배포(새로고침 뒤에도 [버전 목록 확인])
export const SV_STEPS = ['SEW_SAVE_STEP_CHECK', 'SEW_SAVE_STEP_BUILD', 'SEW_SAVE_STEP_SEND', 'SEW_SAVE_STEP_FINISH']

// 검사 줄을 누르면 갈 곳(목업 svjump·svbar): 스텝 / 바 칸(메일 제목·제한 시간) / 운영 속성 창 / 저장 창의 칸(모델·이름)
const BAR_CODES = { MAIL_TITLE_EMPTY: 'description', MAIL_TITLE_COLON: 'description', TIMEOUT_INVALID: 'timeoutLimit' }
const FORM_CODES = { NAME_EMPTY: 'name', NAME_TOO_LONG: 'name', NAME_CHARS: 'name', MODEL_MISSING: 'model' }
export function issueGoal(issue) {
  if (issue?.uid !== undefined && issue?.uid !== null) return { kind: 'step', uid: issue.uid }
  if (BAR_CODES[issue?.code]) return { kind: 'bar', field: BAR_CODES[issue.code] }
  const field = propertyFieldOf(issue) // 운영 속성 창의 그 칸(범위 5종·후속 5종·유형 2종)
  if (field) return { kind: 'property', field }
  if (FORM_CODES[issue?.code]) return { kind: 'form', field: FORM_CODES[issue.code] }
  return null
}

// 덮어쓰기 차이(서버 targetExists.diff). 저장된 빈 후속 {Name:''} 과 null 은 둘 다 "후속 없음" 이라 차이 줄이 아니다.
const FOLLOW_KEYS = new Set(['NextScenarioIfSuccess', 'NextScenarioIfFail'])
export const followName = (v) => (v && typeof v === 'object' && typeof v.Name === 'string' && v.Name !== '' ? v.Name : null)
export function overwriteDiff(diff) {
  return (Array.isArray(diff) ? diff : []).filter((d) => !(FOLLOW_KEYS.has(d.key) && followName(d.from) === followName(d.to)))
}

// 원인 한 줄 — 저장 창 문구가 있으면 그것(공통 문구의 "잠시 뒤 다시 시도하세요" 를 피한다), 없으면 공통 오류 문구
export function causeText(e) {
  const key = `SEW_SAVE_CAUSE_${errorCode(e)}`
  return MESSAGES[key] !== undefined ? t(key) : errorMessage(e)
}

// requestId: 보안 문맥이 아닌 주소(사내 http)에서는 crypto.randomUUID 가 없다 — getRandomValues 로 v4 를 만든다
export function newRequestId() {
  const c = globalThis.crypto
  if (typeof c?.randomUUID === 'function') return c.randomUUID()
  const b = c.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

const pendingStore = {
  read() { try { const v = JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null'); return v && typeof v.requestId === 'string' && v.target ? v : null } catch { return null } },
  write(v) { try { if (v) sessionStorage.setItem(PENDING_KEY, JSON.stringify(v)); else sessionStorage.removeItem(PENDING_KEY) } catch { /* 기억만 못 할 뿐 */ } }
}

export const useSaveFlow = defineStore('scenarioEditorSave', () => {
  const edit = useEditStore()
  const editor = useEditorStore()

  const stage = ref(null)
  const target = ref({ model: '', name: '' })
  const check = ref(null) // { blocks, warns, target: { exists, eqpCount }, conflict, targetExists }
  const checkedFor = ref(null) // 지금 check 가 본 { model, name, force }
  const checking = ref(false)
  const checkError = ref(null) // { code, cause }
  const confirm = ref({ overwrite: false, force: false })
  const requestId = ref(null)
  const sentTarget = ref(null) // 배포를 보낸 대상 { process, model, name } — 결과 화면·새 판 다시 열기
  const restored = ref(false) // 앞서 끝난 결과 모름을 다시 연 것이고 지금 작업본은 그때 보낸 내용이 아니다(새로고침 뒤·그 뒤에 고침)
  const result = ref(null) // { result, crtime, partialFailed } | { found: 'none', noRecord? }
  const error = ref(null) // fail 화면: { kind: 'notSent' | 'rejected', code, cause, upstreamText }
  const notice = ref(null) // { key, params, tone: 'error' | 'info' }
  const busy = ref(null) // 'draft' | 'verify' | 'finish'
  const focusReq = ref(null) // 저장 창 안 칸 초점 요청 { field, n }
  const nameRule = ref(undefined) // undefined = 아직 안 읽음, null = 규칙 없음(직접 입력), { major, middle }
  let kept = null // 닫았다 다시 열 때 남길 대상 { model, name, base }(초안·실패·결과 모름 뒤, 막힌 줄로 가려고 닫을 때 — 목업 svKeep). base = 그 세션의 저장 기준점
  let sent = null // 배포를 보낸 작업본 — 성공했을 때 지금 작업본이 이것이어야 기준을 새 판으로 바꾼다
  let timer = null
  let seq = 0

  const session = () => edit.session
  const source = () => session()?.source ?? null
  const process = () => source()?.process ?? editor.skeleton?.process ?? ''
  function defaultTarget() {
    const s = source()
    const sk = editor.skeleton
    return { model: s?.model ?? sk?.model ?? '', name: s?.name ?? sk?.name ?? '' }
  }
  const fullTarget = () => ({ process: process(), model: target.value.model, name: target.value.name })
  const sameScenario = computed(() => { const s = source(); return !!s && target.value.model === s.model && target.value.name === s.name })
  // 다른 대상에는 확인할 충돌이 없다(서버는 같은 시나리오만 본다) — force 는 기준 판 파일이 지워졌을 때 서버 캐시로 읽는 것만 켠다(Task 2a).
  // 같은 시나리오는 사용자가 [내 내용으로 덮어씁니다]·[다시 만듭니다]·운영 속성 확인을 체크했을 때만.
  const sendForce = () => (source() ? (sameScenario.value ? confirm.value.force : true) : false)

  const fieldErrors = computed(() => {
    const e = {}
    if (!target.value.model) e.model = { code: 'MODEL_MISSING', params: {} }
    const n = checkName(target.value.name)
    if (n) e.name = n
    return e
  })
  const hasFieldErrors = computed(() => Object.keys(fieldErrors.value).length > 0)
  const checkFresh = computed(() => !checking.value && !!check.value && !!checkedFor.value
    && checkedFor.value.model === target.value.model && checkedFor.value.name === target.value.name && checkedFor.value.force === sendForce())
  // 막힘 가운데 화면에 보일 것: 충돌을 아직 확인하지 않았으면 SOURCE_GONE 은 충돌 칸이 대신 말한다(그 막힘이 [다시 만듭니다]를 가리지 않게)
  const visibleBlocks = computed(() => {
    const c = check.value
    if (!c) return []
    return c.conflict && !checkedFor.value?.force ? c.blocks.filter((b) => b.code !== 'SOURCE_GONE') : c.blocks
  })
  // force 로 검사했는데도 SOURCE_GONE — 기준 판도 서버 캐시도 없다(초안만 된다)
  const recreateNoCache = computed(() => !!check.value && !!checkedFor.value?.force && check.value.blocks.some((b) => b.code === 'SOURCE_GONE'))
  // 대상 안내: 'same'(새 버전) | 'new'(새 시나리오) | 'exists'(덮어쓰기 확인) | null(확인하는 중). 덮어쓰기 확인 칸은 배포를 막는 값(check.targetExists)을 따른다.
  const targetKind = computed(() => {
    if (checkFresh.value && check.value.targetExists) return 'exists'
    if (sameScenario.value) return 'same'
    return checkFresh.value ? 'new' : null
  })
  const changes = computed(() => { const s = session(); return s?.working ? unsavedChanges(s.working, s.saveBase) : [] })
  const scopeCount = (model) => (editor.scopes?.processes ?? []).find((p) => p.process === process())?.models.find((m) => m.model === model)?.eqpCount ?? null
  const eqpCount = computed(() => (checkFresh.value ? check.value.target?.eqpCount : null) ?? scopeCount(target.value.model) ?? 0)
  const enabled = computed(() => session()?.working?.property?.IsEnabled !== false)

  const FORCE_WHY = { deleted: 'SEW_SAVE_WHY_RECREATE', property: 'SEW_SAVE_WHY_PROPERTY' }
  const deployBlock = computed(() => {
    if (hasFieldErrors.value) return { key: 'SEW_SAVE_WHY_FIELDS' }
    if (!checkFresh.value) return { key: checkError.value && !checking.value ? 'SEW_SAVE_WHY_CHECK_FAILED' : 'SEW_SAVE_WHY_CHECKING' }
    const n = visibleBlocks.value.length
    if (n) return { key: 'SEW_SAVE_WHY_BLOCKS', params: { n } }
    if (check.value.targetExists && !confirm.value.overwrite) return { key: 'SEW_SAVE_WHY_OVERWRITE' }
    if (check.value.conflict && !confirm.value.force) return { key: FORCE_WHY[check.value.conflict.kind] ?? 'SEW_SAVE_WHY_FORCE' }
    return null
  })
  const closable = computed(() => stage.value !== 'run' && !busy.value)
  // 초안: 막힘이 있어도 된다. 바뀐 것이 없고 같은 대상이면 저장할 것이 없다. 배포 중·다른 요청 중에는 끈다.
  const canDraft = computed(() => !!stage.value && stage.value !== 'run' && !busy.value && !hasFieldErrors.value && !restored.value
    && (changes.value.length > 0 || !sameScenario.value))

  function resetForm() {
    clearTimeout(timer)
    seq++
    check.value = null; checkedFor.value = null; checking.value = false; checkError.value = null
    confirm.value = { overwrite: false, force: false }
    requestId.value = null; sentTarget.value = null; restored.value = false
    result.value = null; error.value = null; notice.value = null; busy.value = null
  }

  async function loadNameRule() {
    if (nameRule.value !== undefined) return
    try { nameRule.value = nameRuleOf((await api.nameRule()).data.data) } catch { nameRule.value = null } // 못 읽으면 직접 입력만
  }

  // 창 열기. 결과 모름 배포가 세션 저장소에 있으면 그 결과 모름 화면부터(새로고침 뒤에도 [버전 목록 확인]).
  function open() {
    const s = session()
    if (stage.value || !s?.working || s.readOnly) return false
    resetForm()
    loadNameRule()
    const pend = pendingStore.read()
    if (pend) {
      requestId.value = pend.requestId
      sentTarget.value = pend.target
      restored.value = !sent || sent !== s.working
      target.value = pend.target.process === process() ? { model: pend.target.model, name: pend.target.name } : defaultTarget()
      stage.value = 'unknown'
      return true
    }
    target.value = kept && kept.base === s.saveBase ? { model: kept.model, name: kept.name } : defaultTarget() // 다른 시나리오를 열었으면 남긴 대상은 버린다
    stage.value = 'form'
    runCheck()
    return true
  }

  // ×·닫기. 배포 중·요청 중에는 닫지 않는다. 입력한 대상은 버리고, 초안·실패·결과 모름 뒤나 keep(막힌 줄·바 칸으로 감)이면 남긴다.
  function close({ keep = false } = {}) {
    if (!stage.value) return true
    if (!closable.value) return false
    kept = keep || ['draft', 'fail', 'unknown'].includes(stage.value) ? { ...target.value, base: session()?.saveBase } : null
    if (['ok', 'partial'].includes(stage.value)) kept = null
    resetForm()
    stage.value = null
    return true
  }

  function setTarget({ model, name }) {
    if (stage.value !== 'form') return
    target.value = { model: model ?? target.value.model, name: name ?? target.value.name }
    confirm.value = { ...confirm.value, overwrite: false } // 다른 대상의 덮어쓰기 확인은 다시 받는다(목업)
    notice.value = null
    clearTimeout(timer)
    if (!hasFieldErrors.value) timer = setTimeout(runCheck, CHECK_DELAY_MS)
  }
  function setOverwrite(v) { confirm.value = { ...confirm.value, overwrite: !!v } }
  // 확인 표시가 바뀌면 그 값으로 다시 검사한다 — 기준 판 파일이 지워졌으면 force 일 때만 서버 캐시로 읽는다(Task 2a).
  // 검사가 도는 중이면 그 검사는 앞 값으로 보냈을 수 있다 — 늘 새로 보내 마지막 값의 검사가 이기게 한다(앞 응답은 seq 로 버린다).
  function setForce(v) {
    confirm.value = { ...confirm.value, force: !!v }
    if (stage.value === 'form' && (checking.value || checkedFor.value?.force !== sendForce())) runCheck()
  }
  function requestFocus(field) { focusReq.value = { field, n: (focusReq.value?.n ?? 0) + 1 } }

  async function runCheck() {
    clearTimeout(timer)
    if (stage.value !== 'form' || hasFieldErrors.value || !session()?.working) return
    const my = ++seq
    const tg = fullTarget()
    const force = sendForce()
    checking.value = true
    checkError.value = null
    try {
      const { meta } = buildMeta(session(), { target: tg, extra: { force } })
      const data = (await api.check(meta)).data.data
      if (my !== seq) return
      check.value = data
      checkedFor.value = { model: tg.model, name: tg.name, force }
    } catch (e) {
      if (my !== seq) return
      check.value = null
      checkError.value = { code: errorCode(e), cause: causeText(e) }
    } finally {
      if (my === seq) checking.value = false
    }
  }

  function toConfirm() { if (stage.value === 'form' && !deployBlock.value) stage.value = 'confirm' }
  function back() { if (stage.value === 'confirm') stage.value = 'form' }

  const setPending = (v) => pendingStore.write(v)
  function toUnknown(id) {
    requestId.value = id
    result.value = null
    stage.value = 'unknown'
    setPending({ requestId: id, target: sentTarget.value, at: Date.now() })
  }
  // 실패·저장 창 복귀는 결과를 안다 — 보내기 직전에 적어 둔 requestId 를 지운다(거절도 결과 모름 화면으로 되살리지 않는다)
  function toFail(kind, e, upstreamText = null) {
    setPending(null)
    error.value = { kind, code: errorCode(e), cause: kind === 'local' ? t('SEW_SAVE_CAUSE_LOCAL') : causeText(e), upstreamText }
    stage.value = 'fail'
  }
  function backToForm(key) {
    setPending(null)
    notice.value = { key, tone: 'error' }
    stage.value = 'form'
  }

  // 배포(설계 §6.2). requestId 는 매번 새로. 결과가 정해질 때까지 run(닫을 수 없음).
  // requestId 는 보내기 직전에 세션 저장소에 적는다 — 배포 중 새로고침(떠나기 확인을 받아들임)으로 응답을 못 받아도 결과 모름으로 이어 확인한다
  // (내 기록 목록 API 가 없어 이것이 유일한 길이다). 결과를 알면 지우고, 결과 모름이면 남긴다.
  async function deploy() {
    if (stage.value !== 'confirm' || deployBlock.value) return
    const s = session()
    const id = newRequestId()
    requestId.value = id
    sentTarget.value = fullTarget()
    restored.value = false
    result.value = null; error.value = null; notice.value = null
    stage.value = 'run'
    sent = s.working
    let data
    try {
      const { meta, uploadsUsed } = buildMeta(s, { target: sentTarget.value, extra: { requestId: id, overwrite: confirm.value.overwrite, force: sendForce(), restoredFrom: s.restoredFrom ?? null } })
      const body = buildFormData(meta, edit.uploads, uploadsUsed)
      setPending({ requestId: id, target: sentTarget.value, at: Date.now() })
      data = (await api.deploy(body)).data.data
    } catch (e) {
      deployFailed(e, id)
      return
    }
    await adopt(data)
  }

  function deployFailed(e, id) {
    const res = e?.response
    // 응답 없이 끊김(브라우저 시간 초과·연결 끊김)은 보냈는지 모른다. 요청을 만들지도 못했으면(그림 빠짐) 보내지 않았다.
    if (!res) { if (e?.request) toUnknown(id); else toFail('local', e); return }
    const d = res.data?.details ?? {}
    switch (errorCode(e)) {
      case 'VALIDATION_FAILED': check.value = { ...check.value, blocks: Array.isArray(d.blocks) ? d.blocks : [] }; backToForm('SEW_SAVE_BACK_BLOCKS'); return
      case 'TARGET_EXISTS': check.value = { ...check.value, targetExists: { diff: d.diff ?? [] } }; confirm.value = { ...confirm.value, overwrite: false }; backToForm('SEW_SAVE_BACK_TARGET_EXISTS'); return
      case 'SAVE_CONFLICT': check.value = { ...check.value, conflict: d.conflict ?? null }; confirm.value = { ...confirm.value, force: false }; backToForm('SEW_SAVE_BACK_CONFLICT'); return
      case 'SAVE_IN_PROGRESS': if (d.requestId) toUnknown(d.requestId); else backToForm('SEW_SAVE_BACK_IN_PROGRESS'); return // 같은 requestId 다시 보냄이면 확인으로
      case 'UPSTREAM_TIMEOUT': if (d.requestId) toUnknown(d.requestId); else toFail('notSent', e); return // requestId 없음 = 보내기 전 DB 시간 초과
      case 'UPSTREAM_FAILED': requestId.value = id; toFail('rejected', e, d.upstreamText ?? null); return
      case 'UNKNOWN': if (res.status >= 500) { toUnknown(id); return } break // 뜻밖의 서버 오류 — 보냈는지 모른다
    }
    toFail('notSent', e)
  }

  // 배포됨(바로·확인·다시 쓰기). 새 판 crtime 이 있고 지금 작업본이 보낸 것이면 그 판을 다시 열어 기준을 바꾼다(DC-025).
  async function adopt(r) {
    setPending(null)
    result.value = { result: r.result, crtime: r.crtime ?? null, partialFailed: r.partialFailed ?? [] }
    const tg = sentTarget.value
    if (r.crtime != null && sent && session()?.working === sent && tg) {
      try {
        edit.rebase((await api.open(tg.process, tg.model, tg.name, r.crtime)).data.data)
      } catch (e) {
        notice.value = { key: 'SEW_SAVE_REOPEN_FAILED', params: { cause: causeText(e) }, tone: 'error' }
      }
    } else notice.value = { key: 'SEW_SAVE_NOT_REBASED', tone: 'info' }
    sent = null
    restored.value = false
    stage.value = r.result === 'partial' ? 'partial' : 'ok'
  }

  async function saveDraft() {
    if (!canDraft.value) return
    const s = session()
    busy.value = 'draft'
    notice.value = null
    try {
      const { meta, uploadsUsed } = buildMeta(s, { target: fullTarget() })
      const data = (await api.saveDraft(buildFormData(meta, edit.uploads, uploadsUsed))).data.data
      edit.markDraft(data)
      result.value = { savedAt: data.savedAt }
      stage.value = 'draft'
    } catch (e) {
      notice.value = { key: 'SEW_SAVE_DRAFT_FAILED', params: { cause: e?.response || e?.request ? causeText(e) : t('SEW_SAVE_CAUSE_LOCAL') }, tone: 'error' }
    } finally {
      busy.value = null
    }
  }

  // 저장 창 밖에서 지금 작업본을 제 대상(열린 시나리오 — 새 시나리오는 만든 공정·모델·이름)의 초안으로 저장한다
  // (새 시나리오 창의 [초안 저장하고 만들기]·[초안 저장하고 열기]). 저장 창이 열려 있거나 쓸 수 없는 세션이면 하지 않는다. 실패하면 던진다.
  async function draftCurrent() {
    const s = session()
    if (stage.value || !s?.working || s.readOnly) throw new Error('draft unavailable')
    const { meta, uploadsUsed } = buildMeta(s, { target: { process: process(), ...defaultTarget() } })
    const data = (await api.saveDraft(buildFormData(meta, edit.uploads, uploadsUsed))).data.data
    edit.markDraft(data)
    return data
  }

  // [버전 목록 확인](결과 모름·거절 뒤): mine 이면 성공(또는 마무리 실패), none 이면 [다시 배포]. 404 = 기록 없음(보내지 않았다).
  async function verify() {
    if (!requestId.value || busy.value) return
    busy.value = 'verify'
    notice.value = null
    try {
      const r = (await api.verifyDeploy(requestId.value)).data.data
      if (r.found === 'mine') await adopt(r)
      else result.value = { found: 'none' }
    } catch (e) {
      const code = errorCode(e)
      if (code === 'NOT_FOUND') { result.value = { found: 'none', noRecord: true }; setPending(null) }
      else if (code === 'SAVE_IN_PROGRESS') notice.value = { key: 'SEW_SAVE_VERIFY_BUSY', tone: 'info' }
      else notice.value = { key: 'SEW_SAVE_VERIFY_FAILED', params: { cause: causeText(e) }, tone: 'error' }
    } finally {
      busy.value = null
    }
  }

  // [다시 배포]: 옛 requestId 를 잊고 확인 단계로(검사가 이 대상의 것이 아니면 저장 창에서 다시 검사). 보낼 때 새 requestId.
  function redeploy() {
    if (busy.value) return
    setPending(null)
    requestId.value = null; result.value = null; error.value = null; notice.value = null; restored.value = false
    stage.value = 'form'
    if (checkFresh.value && !deployBlock.value) stage.value = 'confirm'
    else runCheck()
  }

  // [다시 쓰기]: 마무리(7단계)만 다시. 오류는 code 와 상관없이 "아직 마무리 안 됨" — 결과 모름으로 읽지 않는다(Task 2a).
  async function finish() {
    if (stage.value !== 'partial' || busy.value) return
    busy.value = 'finish'
    notice.value = null
    try {
      const r = (await api.finishDeploy(requestId.value)).data.data
      if (r.result === 'ok') { result.value = { ...result.value, result: 'ok', partialFailed: [] }; stage.value = 'ok' }
      else notice.value = { key: 'SEW_SAVE_FINISH_NO_DOC', tone: 'error' }
    } catch (e) {
      notice.value = { key: 'SEW_SAVE_FINISH_FAILED', params: { cause: causeText(e) }, tone: 'error' }
    } finally {
      busy.value = null
    }
  }

  // 검사 줄·바뀐 곳에서 스텝으로: 창을 닫고(대상은 남김) 그 줄을 고른다
  function jump(uid) {
    if (!close({ keep: true })) return false
    edit.requestSelect(uid)
    return true
  }

  return {
    stage, target, check, checkedFor, checking, checkError, confirm, requestId, sentTarget, restored, result, error, notice, busy, focusReq, nameRule,
    fieldErrors, checkFresh, visibleBlocks, recreateNoCache, sameScenario, targetKind, changes, eqpCount, enabled, deployBlock, closable, canDraft,
    open, close, setTarget, setOverwrite, setForce, requestFocus, runCheck, toConfirm, back, deploy, saveDraft, draftCurrent, verify, redeploy, finish, jump
  }
})

import { defineStore } from 'pinia'
import { ref, shallowRef, computed } from 'vue'
import { beginSession, restoreSessionOf, draftSessionOf, nextUid, stepNo } from '../editor/session'
import { copySteps, pasteSteps, detachClip, deleteSteps, moveSteps, setCell, movedRefKeys, applyStep, insertStep, sameOrder, STEP_MAX } from '../editor/commands'
import { sameStep, canonicalJson, unsavedChanges } from '../editor/diff'
import { checkStepFields } from '../editor/fieldRules'
import { checkPropertyFields } from '../editor/propertyRules'
import { firstError, CLICK_TYPES } from '../editor/panel'
import { refUrl, loadBitmap, loadBlob, bitmapOf, isPng, draftImageUrl, newTempId, uploadIdsOf } from '../editor/images'
import { normalizeWindows, blankWindow } from '../editor/windows'
import { cropPng, imageDataOf } from '../editor/crop'
import { locate } from '../editor/locate'
import { spotKey } from '../editor/trainView'
import { CAP_FLOWS, MIN_CAPTURE, LOCATE_MS, isRect, isRef, clipRect, nextStage, newStepDraft, baseRefFor, afterUid, firstTrainRef } from '../editor/capture'
import { snapshotKey, snapshotBaseProblem, uploadBudgetProblem } from '../editor/snapshotStep'
import { prepareLocalBase, sizeDiffers } from '../editor/localBase'
import { newScenarioOf } from '../editor/newScenario'
import { t } from '../messages'
import { useEditorStore } from './editorStore'

const UNDO_MAX = 50
const MOVED_MS = 1900 // 번호가 바뀐 갈 곳 칸 강조 시간(목업 S.moved)

const emptySelection = () => ({ uids: [], anchor: null })
const emptyPanel = () => ({ uid: null, isNew: false, draft: null, base: null })
const SOURCE_KEYS = ['process', 'model', 'name', 'crtime', 'fileId']
// 묶음의 판: 기준 판(source), 출처가 없는 새 시나리오는 세션 정체성(newId — beginNew 마다 새로). 같은 새 시나리오 안의
// 복사·붙여넣기는 같은 판이다(P2-C 넘김). 새 시나리오 판은 그림 참조에 펼치지 않는다 — 새 시나리오 작업본에는 from: 'source' 그림이 없다.
const clipOrigin = (s) => s?.source ?? (s?.newId ? { newId: s.newId } : null)
const sameSourceOf = (a, b) => !!a && !!b && (a.newId || b.newId ? a.newId === b.newId : SOURCE_KEYS.every((k) => a[k] === b[k]))
let newSeq = 0

export const useEditStore = defineStore('scenarioEditorEdit', () => {
  // 세션·작업본·되돌리기 스냅샷은 shallowRef + 불변 갱신 — Pinia 가 EditedScenario 를 깊게 감싸지 않게.
  const session = shallowRef(null)
  const selection = ref(emptySelection())
  const panel = shallowRef(emptyPanel())
  const undo = shallowRef([])
  const redo = shallowRef([])
  // 붙여넣기 묶음 Clip(+ uploads: 묶음이 쓰는 올릴 그림 tempId → Blob, R-P3). 세션이 바뀌어도(다른 시나리오 열기) 남는다.
  const clip = shallowRef(null)
  // 숨길 창 복사 묶음(P2-F 전처리 설정) — 스텝 복사처럼 이 탭 안에 있고 다른 시나리오를 열어도 남는다. 일곱 칸만 담는다.
  const windowClip = shallowRef([])
  // 올릴 그림(tempId → Blob). Blob 을 반응형으로 감싸지 않게 shallowRef 이고, 바꿀 때마다 새 Map 으로 바꾼다(setUpload).
  const uploads = shallowRef(new Map())
  // 기준 화면으로 올린 스냅샷·그림 파일(키 → tempId, P3-E·2026-11-17) — 같은 그림으로 만든 스텝들이 올릴 그림 하나를 함께 쓴다. 올릴 그림과 함께 비운다.
  let sharedBases = new Map()
  // 그림 파일 고르기의 요청 번호 — 푸는 사이 다른 파일을 또 고르면 앞의 것을 버린다
  let fileSeq = 0
  // 큰 화면 잡기(목업 S.cap): { flow, stage, why, before, train } — before = 잡기 전 패널 초안(Esc 로 되돌린다),
  // train = 누를 곳의 기준(찾을 그림 사각형: 이번에 잡은 것 또는 [다시 찍기]가 기준 화면에서 찾은 자리).
  const capture = shallowRef(null)
  const locating = ref(false) // [다시 찍기]가 기준 화면에서 찾을 그림을 찾는 중
  // 큰 화면 보기 요청({ kind: 'area' | 'all', n }) — 패널 그림을 누르면 영역에 맞춰·전체(목업 focusArea·viewAll), 잡기를 시작하면 전체
  const viewReq = shallowRef(null)
  const toast = ref(null)
  const dialog = ref(null)
  const moved = shallowRef(new Set())
  // 패널이 초점을 옮길 칸({ field, n } — n 은 같은 칸을 다시 요청해도 감시가 울리게)
  const focusReq = shallowRef(null)
  const revealReq = ref(0) // 창(저장 창의 막힌 줄·갈 곳 목록)에서 스텝으로 갈 때마다 오른다 — 화면이 접힌 스텝 패널을 편다
  let movedTimer = null
  let bitmapCache = { url: null, promise: null } // 마지막으로 불러온 기준 화면 비트맵(잡기 중 여러 번 자를 때 다시 받지 않게)
  // 찾을 그림 위치 보기(찾을 그림 밖 누를 곳 B): 키(기준 화면·찾을 그림·검색 영역) → locateTrain 결과. 바꿀 때마다 새 Map.
  // spotGen 은 세션이 바뀔 때(reset) 올라가 그 전에 시작한 찾기의 결과를 버린다. spotJobs = 찾는 중인 키.
  const spots = shallowRef(new Map())
  const spotGen = ref(0)
  const spotJobs = new Set()
  // 큰 화면에서 검색 영역을 끄는 중(CaptureLayer). 끄는 동안은 위치를 찾지 않고 큰 화면 표시를 숨긴다(useTrainSpot) — 놓으면 한 번 찾는다.
  const areaDragging = ref(false)
  // 적용 안 한 변경 확인 창이 미뤄 둔 일 { next, onKeep }(확인 창 dialog 는 화면 값만 — 함수는 여기에)
  let pending = null
  let pendingLeave = null

  // 고칠 수 있는 세션: 작업본이 있고 읽기 전용이 아니다(작업본이 없는 뼈대는 P1 처럼 보기만).
  // 다른 시나리오를 여는 동안(editorStore.opening)도 아니다 — 열기가 끝나면 begin() 이 작업본을 갈아 끼우므로, 그 사이 친 값은 받지 않는다.
  // 도구 줄·패널·편집 창·표 칸 고치기·단축키가 모두 이 값을 본다.
  const editable = computed(() => !!session.value?.working && session.value.readOnly === null && !useEditorStore().opening)
  // 서버에 이 세션의 초안이 있다(초안에서 이어 열었거나 이 세션에서 초안을 저장함) — 로컬 Blob 이 없는 올릴 그림은 그 초안 그림이다
  const draftId = computed(() => session.value?.draft?.id ?? null)

  function reset() {
    selection.value = emptySelection()
    panel.value = emptyPanel()
    undo.value = []
    redo.value = []
    uploads.value = new Map()
    sharedBases = new Map()
    capture.value = null
    locating.value = false
    viewReq.value = null
    bitmapCache = { url: null, promise: null }
    spots.value = new Map()
    spotGen.value++
    spotJobs.clear()
    areaDragging.value = false
    toast.value = null
    dialog.value = null
    focusReq.value = null
    pending = null
    pendingLeave = null
    clearMoved()
  }

  // 붙여넣기 묶음은 세션을 넘어 남긴다(다른 시나리오에 붙이기). 묶음을 만든 세션을 처음 떠날 때(detached 가 아직 없을 때 — 지금 세션이
  // 그 세션이다) 한 번만 바꾼다:
  // - 잘라내기는 같은 작업본 안 옮기기라(R-T2a) 복사 묶음이 된다 — 새 작업본의 같은 uid 스텝을 옮기거나 흐리게 보이지 않게.
  // - 묶음 밖 갈 곳 가운데 그 판의 서버 uid(저장 기준점 스텝 uid)가 아닌 것(브라우저가 만든 n…·p…, 세션마다 다시 센다)은 미해결로(detachClip).
  function carryClip() {
    const c = clip.value
    if (!c || c.detached) return
    const keep = new Set((session.value?.saveBase?.steps ?? []).map((s) => s.uid))
    clip.value = { ...detachClip(c, keep), cut: false, detached: true }
  }

  function begin(skeleton, me) {
    reset()
    carryClip()
    session.value = beginSession(skeleton, me)
  }

  function end() {
    reset()
    carryClip()
    session.value = null
  }

  // 새 시나리오(P2-D Task 6, 설계 §6.8): 서버에 없는 시나리오를 작업본으로 시작한다 — 출처·headCrtime·propertyRev 없음, 스텝 0,
  // 운영 속성 = 사내 클래스 기본값(editor/newScenario). 열린 뼈대도 새 대상으로 바꾼다(저장 창이 출처 없는 세션의 기본 대상을 뼈대에서 읽는다).
  // 저장 기준점 = 만든 때의 작업본 — "저장 전 N곳" 은 만든 뒤 바꾼 것(스텝·바 칸·운영 속성)을 센다(막 만들면 0, 목업 "만든 뒤").
  function beginNew(params) {
    const editor = useEditorStore()
    if (!editor.me?.canWrite || !params?.process || !params?.model || !params?.name) return false
    const { working, skeleton } = newScenarioOf(params)
    reset()
    carryClip()
    editor.showSkeleton(skeleton)
    session.value = { source: null, headCrtime: null, propertyRev: null, readOnly: null, working, saveBase: working, seq: 0, newId: `new${++newSeq}` }
    syncFocus(null)
    return true
  }

  // 불러오기 창에서 여는 세션(P2-D Task 7): 세션과 열린 뼈대를 함께 바꾸고 첫 스텝에 초점. 쓰기 권한이 없으면 열지 않는다(되돌리기·초안은 쓰기 동작).
  function beginWith(build) {
    const editor = useEditorStore()
    if (!editor.me?.canWrite) return false
    const { session: next, skeleton } = build(editor.me)
    reset()
    carryClip()
    editor.showSkeleton(skeleton)
    session.value = next.source ? next : { ...next, newId: `new${++newSeq}` }
    const first = next.working.steps[0]?.uid ?? null
    editor.selectedUid = first
    syncFocus(first)
    return true
  }
  // [이 버전으로 되돌려 열기]: 옛 판 내용을 현재 판 위 작업본으로(editor/session restoreSessionOf). 배포 meta 에 restoredFrom 이 실린다.
  const beginRestore = (oldSkeleton, currentSkeleton) => beginWith((me) => restoreSessionOf(oldSkeleton, currentSkeleton, me))
  // [초안 이어서 열기]: draft = GET /drafts/:id + 키, sourceSkeleton = 초안 기준 판(없으면 null — 새 시나리오 초안·원본이 지워진 판)
  const beginFromDraft = (draft, sourceSkeleton) => beginWith((me) => draftSessionOf(draft, sourceSkeleton, me))
  // 불러오기 창이 열린 시나리오를 지웠다 — 편집 화면은 읽기 전용(고친 내용은 볼 수만 있다, 설계 §6.7)
  function markDeleted() {
    if (!session.value) return
    capture.value = null
    dialog.value = null
    pending = null
    pendingLeave = null
    session.value = { ...session.value, readOnly: 'deleted' }
    syncPanel()
  }
  // 불러오기 창이 열린 시나리오를 켜거나 껐다. propertyRev 는 그대로 둔다 — 다음 배포 때 서버가 운영 속성 충돌로 알린다(설계 §6.7).
  // 되돌려 다시 켜도 지문이 바뀌어(Owners 줄) 충돌이므로 "한 번이라도 바꿨음" 만 남긴다.
  function markPropertyChanged() {
    if (session.value) session.value = { ...session.value, propertyChanged: true }
  }
  // 초안을 지웠다 — 그 초안으로 연 세션은 서버 초안 그림을 더 볼 수 없다(로컬 Blob 이 없는 올릴 그림은 다시 잡아야 한다)
  function forgetDraft(id) {
    if (session.value?.draft?.id === id) session.value = { ...session.value, draft: null }
  }

  // 배포 성공 뒤 기준을 새 판으로(P2-D, DC-025): 새 판을 다시 연 뼈대로 세션(source·headCrtime·propertyRev·saveBase·작업본)을 다시 시작하고
  // 열린 뼈대도 바꾼다 — 다른 이름으로 배포했으면 바의 ID·주소가 새 이름이 된다. 올릴 그림·되돌리기는 비운다(새 판 그림은 서버 참조다).
  // 초점은 같은 번호의 스텝에 둔다(없으면 마지막 스텝).
  function rebase(skeleton) {
    const editor = useEditorStore()
    const no = session.value?.working ? stepNo(session.value.working, editor.selectedUid) : 0
    reset()
    carryClip()
    editor.skeleton = skeleton
    session.value = beginSession(skeleton, editor.me)
    const steps = session.value.working?.steps ?? []
    const uid = steps.length ? steps[Math.min(Math.max(no, 1), steps.length) - 1].uid : null
    editor.selectedUid = uid
    syncFocus(uid) // 앞 판과 같은 uid 면 초점 감시가 울리지 않는다
  }

  // 초안 저장 뒤 — 바에 보일 초안 id·시각과 그 초안이 저장하려던 곳(target, 저장 창 기본 대상). 작업본은 그대로라 저장 전 표시는 남는다.
  function markDraft({ draftId, savedAt, target }) {
    if (session.value) session.value = { ...session.value, draft: target ? { id: draftId, savedAt, target } : { id: draftId, savedAt } }
  }

  function clearMoved() {
    clearTimeout(movedTimer)
    movedTimer = null
    if (moved.value.size) moved.value = new Set()
  }

  // ── 선택: selection = 여러 줄, editorStore.selectedUid = 초점(보는 스텝) = 기준 줄(anchor) ──
  function setSelection(sel) {
    selection.value = sel
    if (sel.anchor !== null && sel.anchor !== undefined) useEditorStore().selectedUid = sel.anchor
  }
  // 초점이 다른 경로로 바뀌면 그 한 줄로 접는다(기준 줄과 같으면 그대로 — 여러 줄 선택 중 초점 이동이 아님). 패널도 초점을 따라간다.
  function syncFocus(uid) {
    if (!(selection.value.anchor === uid && (uid === null || selection.value.uids.includes(uid)))) {
      selection.value = uid === null || uid === undefined ? emptySelection() : { uids: [uid], anchor: uid }
    }
    syncPanel(uid)
  }

  // ── 오른쪽 편집 패널(목업 renderPanel·apply·guard) ──
  // panel.base = 패널을 연(또는 마지막으로 적용한) 작업본 스텝 객체, panel.draft = 고치는 중인 값(불변으로 바꾼다).
  const panelDirty = () => { const p = panel.value; return !!p.draft && !sameStep(p.draft, p.base) }
  const focusUid = () => useEditorStore().selectedUid
  const workingStep = (uid) => (uid == null ? null : session.value?.working?.steps.find((s) => s.uid === uid) ?? null)
  const saveBaseStep = (uid) => session.value?.saveBase?.steps.find((s) => s.uid === uid) ?? null

  // 그 스텝으로 패널을 연다(초안 = 기준 = 작업본 스텝 그대로).
  function openPanel(uid) {
    const step = workingStep(uid)
    capture.value = null
    panel.value = step ? { uid, isNew: false, draft: step, base: step } : emptyPanel()
  }
  // 초점·작업본이 바뀌면 패널을 맞춘다. 적용 안 한 변경은 지우지 않는다 — 다른 줄로 가는 길은 guard 가 먼저 묻고,
  // 묻지 않는 여러 줄 선택(Shift·Ctrl)은 초안을 그대로 두었다가 그 줄로 돌아오면 이어서 고친다.
  // 새 스텝 초안(아직 표에 없음)은 초점이 없는 동안 그대로 두고, 초점이 스텝으로 가면 버린다 — 값을 넣은 초안이면 그 길은 guard 가 먼저 묻는다.
  function syncPanel(uid = focusUid()) {
    if (!editable.value) { if (panel.value.uid !== null || panel.value.draft) panel.value = emptyPanel(); capture.value = null; return }
    const p = panel.value
    if (p.isNew) {
      if (uid == null || panelDirty()) return
    } else {
      if (panelDirty() && workingStep(p.uid)) return
      const step = workingStep(uid)
      if (p.uid === uid && p.base === step && step) return
    }
    openPanel(uid)
  }
  function updateDraft(fn) {
    const p = panel.value
    if (!p.draft || !editable.value) return
    panel.value = { ...p, draft: fn(p.draft) }
  }
  // 칸 검사(서버 code 이름). base = 저장 기준점의 같은 uid 스텝(옛 값 안내를 가른다), 새 스텝이면 null.
  function panelErrors() {
    const p = panel.value
    if (!p.draft || !session.value?.working) return {}
    return checkStepFields(p.draft, { working: session.value.working, isNew: p.isNew, base: p.isNew ? null : saveBaseStep(p.uid), user: useEditorStore().me })
  }
  function requestFocus(field) { focusReq.value = { field, n: (focusReq.value?.n ?? 0) + 1 } }
  // [적용]: 오류가 있으면 막고 첫 오류 칸으로 초점. 기준과 같으면 아무것도 쌓지 않는다. 저장 기준점과 같은 값이면 그 객체를 다시 쓴다.
  function applyPanel() {
    const p = panel.value
    if (!p.draft || p.isNew || !editable.value) return false
    const bad = firstError(panelErrors())
    if (bad) { requestFocus(bad); return false }
    capture.value = null
    if (sameStep(p.draft, p.base)) { if (p.draft !== p.base) panel.value = { ...p, draft: p.base }; return true }
    const sb = saveBaseStep(p.uid)
    const step = sb && sameStep(p.draft, sb) ? sb : p.draft
    panel.value = { uid: p.uid, isNew: false, draft: step, base: step }
    run(t('SEW_CMD_APPLIED', { no: noOf(p.uid) }), (w) => applyStep(w, step))
    return true
  }
  // [되돌리기]: 패널을 마지막 적용 값으로. 새 스텝이면 그 초안을 버린다(확인 창의 [버리고 …]).
  function discardPanel() {
    const p = panel.value
    if (p.isNew) { cancelNew(); return }
    capture.value = null
    if (p.draft && p.draft !== p.base) panel.value = { ...p, draft: p.base }
  }

  // 적용 안 한 변경이 있으면 확인 창을 세우고 next 를 미룬다(없으면 바로 한다). 확인 창 버튼은 미룬 일(action)에 따른다(R-T6c):
  // - 'move'(다른 줄·순서도·경고 순회·새 스텝)·'open'(다른 시나리오 열기)·'save'(저장 창): [계속 고치기]·[버리고 이동]·[적용하고 이동]
  // - 'new'(새 시나리오 창): [계속 고치기]·[버리고 계속]·[적용하고 계속]
  // - 'command'(표 칸·삭제·붙여넣기·옮기기): [계속 고치기]·[버리고 계속]·[적용하고 계속] — 적용한 뒤 그 명령을 한다
  // - 'undo'·'redo': [계속 고치기]·[버리고 되돌리기]/[버리고 다시 하기] 만 — 적용하면 그 적용을 되돌리거나(되돌리기) 다시 할 것을 비우게(다시 하기) 된다
  // to = 가려는 스텝 uid(이동일 때). onKeep = [계속 고치기]로 접을 때 할 일(예: 주소를 열린 시나리오로 되돌리기).
  const NO_APPLY = new Set(['undo', 'redo'])
  // 만들던 새 스텝(isNew)은 [적용하고 …] 갈래가 없다 — 표에 넣을 자리는 [N번 앞에 넣기]·[맨 끝에 추가]로만 정한다.
  function guard(next, { action = 'move', to = null, onKeep = null } = {}) {
    if (!panelDirty()) { next(); return true }
    pending = { next, onKeep }
    dialog.value = panel.value.isNew ? { kind: 'guard', action, to, isNew: true } : { kind: 'guard', action, to }
    return false
  }
  // ── 바 칸(메일 제목·제한 시간)과 떠날 때 확인(P2-D Task 3) ──
  // 바 칸은 작업본 header 에 두고 되돌리기 목록에 넣지 않는다(저장 창을 닫거나 초안을 저장해도 값이 남는다).
  // 제한 시간은 서버 작업본·검사가 문자열을 요구하므로(parseEditedScenario·TIMEOUT_INVALID) 친 글자 그대로 문자열로 둔다.
  function setHeader(field, value) {
    if (!editable.value || (field !== 'description' && field !== 'timeoutLimit')) return false
    const w = session.value.working
    const v = String(value ?? '')
    session.value = { ...session.value, working: { ...w, header: { ...w.header, [field]: v } } }
    return true
  }
  // 운영 속성 창 [적용](P2-D Task 4, 설계 §7·Q-103): 작업본 property 만 바꾼다 — 배포·초안이 함께 싣는다. 바 칸처럼 되돌리기 목록에 넣지 않는다.
  // 창이 바뀐 칸만 고친 값을 준다. 칸 검사(서버와 같은 기준 = 저장 기준 판, 새 시나리오는 기준 없음)에 걸리면 받지 않는다.
  function applyProperty(next) {
    const s = session.value
    if (!editable.value || !next || typeof next !== 'object') return false
    if (Object.keys(checkPropertyFields(next, s.source ? s.saveBase?.property : null)).length) return false
    session.value = { ...s, working: { ...s.working, property: { ...next } } }
    return true
  }
  // 전처리 설정 창 [적용](P2-F 설계 §7): 작업본 header.windows 만 바꾼다 — 배포·초안이 함께 싣는다. 바 칸·운영 속성처럼 되돌리기 목록에 넣지 않는다.
  // 줄 검사(클래스 필수·좌표 정수)는 창이 줄을 넣거나 고칠 때 하고, 서버가 저장 때 다시 본다.
  function applyWindows(next) {
    const s = session.value
    if (!editable.value || !next?.target || !Array.isArray(next.hiding)) return false
    session.value = { ...s, working: { ...s.working, header: { ...s.working.header, windows: normalizeWindows(next) } } }
    return true
  }
  function copyWindows(rows) {
    if (!Array.isArray(rows) || !rows.length) return 0
    windowClip.value = normalizeWindows({ target: blankWindow(), hiding: rows }).hiding.map(({ origin, ...w }) => w)
    return windowClip.value.length
  }
  // 고친 곳 수(changeCount)와 저장 전 변경 수(unsavedCount). 읽기 전용이 된 세션(지워짐)의 고친 곳은 볼 수만 있어 떠날 때 묻지 않는다.
  const changeCount = computed(() => {
    const s = session.value
    return s?.working && s.saveBase ? unsavedChanges(s.working, s.saveBase).length : 0
  })
  const unsavedCount = computed(() => (session.value?.readOnly ? 0 : changeCount.value))
  // 저장 전 변경(적용한 값)이 있으면 한 번 더 묻는다 — 패널 확인(guard) 뒤에 부른다. 없으면 바로 next.
  function askLeave(next, { onKeep = null } = {}) {
    const n = unsavedCount.value
    if (!n) { next(); return true }
    pendingLeave = { next, onKeep }
    dialog.value = { kind: 'leave', n }
    return false
  }
  function takeLeave() { const p = pendingLeave; pendingLeave = null; if (dialog.value?.kind === 'leave') dialog.value = null; return p ?? {} }
  function leaveKeep() { takeLeave().onKeep?.() }
  function leaveDrop() { takeLeave().next?.() }
  function closeGuard() { const p = pending; pending = null; if (dialog.value?.kind === 'guard') dialog.value = null; return p ?? {} }
  function guardKeep() { closeGuard().onKeep?.() }
  function guardDrop() { const { next } = closeGuard(); discardPanel(); next?.() }
  // 적용이 칸 오류로 막히면 그 스텝에 남는다 — [계속 고치기]와 같으므로 onKeep 을 부른다(예: 주소를 열린 시나리오로 되돌리기).
  function guardApply() {
    if (dialog.value?.kind === 'guard' && (NO_APPLY.has(dialog.value.action) || dialog.value.isNew)) return false
    const { next, onKeep } = closeGuard()
    if (!applyPanel()) { onKeep?.(); return false }
    next?.()
    return true
  }

  // 다른 줄로 가기 — 패널에 적용 안 한 변경이 있으면 묻는다.
  function requestSelect(uid) {
    const go = () => setSelection({ uids: [uid], anchor: uid })
    if (uid === panel.value.uid) { go(); return true }
    return guard(go, { action: 'move', to: uid })
  }

  // 창에서 "이 스텝으로 가기": 그 줄을 고르고(패널에 적던 것이 있으면 먼저 묻는다) 고치는 자리인 스텝 패널이 보이게 알린다.
  function jumpTo(uid) {
    revealReq.value++
    return requestSelect(uid)
  }

  // 표 줄 누르기(목업 select): 그냥 = 한 줄, Shift = 기준 줄부터 범위, Ctrl/Cmd = 더하기·빼기. 번호 순으로 둔다.
  function clickRow(uid, { shift = false, toggle = false } = {}) {
    const steps = session.value?.working?.steps ?? []
    const order = (list) => steps.filter((s) => list.includes(s.uid)).map((s) => s.uid)
    const { uids, anchor } = selection.value
    if (shift && anchor && steps.some((s) => s.uid === anchor)) {
      const a = steps.findIndex((s) => s.uid === anchor)
      const b = steps.findIndex((s) => s.uid === uid)
      setSelection({ uids: steps.slice(Math.min(a, b), Math.max(a, b) + 1).map((s) => s.uid), anchor })
      return true
    }
    if (shift || toggle) {
      const next = order(uids.includes(uid) ? uids.filter((u) => u !== uid) : [...uids, uid])
      if (next.length === 1 && next[0] !== anchor) return requestSelect(next[0])
      setSelection({ uids: next, anchor: next.includes(anchor) ? anchor : (next[0] ?? anchor) })
      return true
    }
    return requestSelect(uid)
  }

  // ── 명령 ──
  const snapshot = () => ({ steps: session.value.working.steps, selection: selection.value })
  // 되돌린 선택은 되돌린 스텝에 있는 줄만 둔다. 기준 줄이 없으면 남은 첫 줄, 남은 줄이 없으면 초점을 비운다(지우기와 같다) —
  // 초점이 사라진 스텝에 남지 않게(예: 모두 지우기 → 되돌리기 → 다시 하기, 고른 줄 없이 넣은 새 스텝 되돌리기).
  function restore(snap) {
    const w = session.value.working
    session.value = { ...session.value, working: { ...w, steps: snap.steps } }
    const has = new Set(snap.steps.map((s) => s.uid))
    const uids = snap.selection.uids.filter((u) => has.has(u))
    const anchor = has.has(snap.selection.anchor) ? snap.selection.anchor : (uids[0] ?? null)
    setSelection({ uids, anchor })
    if (anchor === null) useEditorStore().selectedUid = null
    syncPanel()
  }

  // 명령 실행 — fn(working) 이 { working, selection? } 를 주면 반영하고, 거절·막힘이면 그대로 돌려준다.
  // 결과 스텝이 그대로(같은 스텝 객체·같은 순서)면 아무 일도 없던 것 — 되돌리기·다시 하기·알림을 건드리지 않고 { ...r, noop: true }.
  // 번호가 바뀐 갈 곳은 잠깐 강조하고 알림에 그 수를 붙인다(목업 command). 고칠 수 없는 때(읽기 전용·여는 중)는 null.
  function run(label, fn) {
    if (!editable.value) return null
    const before = session.value.working
    const r = fn(before)
    if (!r?.working) return r
    if (sameOrder(r.working.steps, before.steps)) return { ...r, noop: true }
    undo.value = [...undo.value, snapshot()].slice(-UNDO_MAX)
    redo.value = []
    session.value = { ...session.value, working: r.working }
    if (r.selection) setSelection(r.selection)
    const keys = movedRefKeys(before, r.working)
    clearMoved()
    if (keys.size) {
      moved.value = keys
      movedTimer = setTimeout(clearMoved, MOVED_MS)
    }
    toast.value = { text: keys.size ? `${label} ${t('SEW_CMD_RENUMBERED', { n: keys.size })}` : label, undoable: true }
    syncPanel()
    return r
  }

  function undoLast() {
    if (!undo.value.length) return false
    const snap = undo.value[undo.value.length - 1]
    redo.value = [...redo.value, snapshot()]
    undo.value = undo.value.slice(0, -1)
    restore(snap)
    return true
  }

  function redoLast() {
    if (!redo.value.length) return false
    const snap = redo.value[redo.value.length - 1]
    undo.value = [...undo.value, snapshot()]
    redo.value = redo.value.slice(0, -1)
    restore(snap)
    return true
  }

  const notify = (text) => { toast.value = { text, undoable: false } }
  const refused = (code) => notify(t(`SEW_CMD_REFUSED_${code}`))
  const noOf = (uid) => stepNo(session.value.working, uid)

  // 작업본을 바꾸는 명령은 패널에 적용 안 한 변경이 있으면 먼저 묻는다(action 은 확인 창 버튼을 고른다).
  const guarded = (fn, action = 'command') => { if (!panelDirty()) return false; guard(fn, { action }); return true }

  function undoCommand() {
    if (!editable.value) return false
    if (guarded(undoCommand, 'undo')) return false
    if (!undoLast()) return false
    clearMoved()
    notify(t('SEW_CMD_UNDONE'))
    return true
  }
  function redoCommand() {
    if (!editable.value) return false
    if (guarded(redoCommand, 'redo')) return false
    if (!redoLast()) return false
    clearMoved()
    notify(t('SEW_CMD_REDONE'))
    return true
  }

  function copySelection(cut) {
    const uids = selection.value.uids
    if (!editable.value || !uids.length) return false
    const r = copySteps(session.value.working, uids, clipOrigin(session.value), cut)
    if (r.refused) { refused(r.refused); return false }
    // R-P3: 묶음이 쓰는 올릴 그림의 Blob 을 함께 든다 — 다른 시나리오를 열면 이 세션의 올릴 그림은 비워진다
    const own = uploads.value
    // 초안에서 이어 연 세션의 서버 초안 그림(로컬 Blob 없음)은 다른 세션에 붙일 때 받아 온다(draftId)
    clip.value = { ...r, uploads: new Map(uploadIdsOf(r.steps).filter((id) => own.has(id)).map((id) => [id, own.get(id)])), draftId: draftId.value }
    notify(t(cut ? 'SEW_CMD_CUT' : 'SEW_CMD_COPIED', { n: r.uids.length }))
    return true
  }

  // 묶음이 든 올릴 그림을 이 세션의 올릴 그림에 넣는다(R-P3, setUpload 와 같은 길) — 붙인 스텝의 그림이 보이고, 저장 요청에 실린다.
  // 묶음이 초안에서 이어 연 세션의 것이면 Blob 이 없는 그림(서버 초안에만 있음)을 받아 넣는다 — 받기 전에 세션이 바뀌면 버린다.
  // 같은 초안 세션이면 받지 않는다(그 초안 그림이 그대로 보인다).
  function takeUploads(c, steps) {
    putUploads([...(c.uploads ?? [])].filter(([id]) => !uploads.value.has(id)))
    if (!c.draftId || c.draftId === draftId.value) return
    const gen = spotGen.value
    for (const id of uploadIdsOf(steps).filter((x) => !uploads.value.has(x))) {
      loadBlob(draftImageUrl(c.draftId, id)).then((blob) => { if (gen === spotGen.value && !uploads.value.has(id)) setUpload(id, blob) }, () => {})
    }
  }

  // where: 'after' | 'before' | 'end'. 새 스텝이 되는 설비 상태 스텝이 든 묶음은 먼저 알린다(서버가 origin 없는 설비 상태 스텝을
  // CONDITION_NOT_CREATABLE 로 막는다) — confirmed 면 그대로 붙인다. 같은 작업본 안에서 잘라 옮기면 원래 스텝(origin 유지)이라 알리지 않는다.
  // 다른 판(sameSource 거짓 — 다른 시나리오·다른 판·다른 새 시나리오)에 붙이면 묶음 밖 갈 곳은 미해결, 기준 판 그림은 묶음 판의 참조가
  // 된다(commands.pasteSteps). 붙인 뒤 첫 미해결 스텝을 고르고, 없으면 붙인 스텝들(초점은 첫 스텝, 목업 doPaste).
  function pasteClip(where, { confirmed = false } = {}) {
    const c = clip.value
    if (!editable.value || !c) return false
    if (guarded(() => pasteClip(where, { confirmed }))) return false
    const sameSource = sameSourceOf(c.origin, clipOrigin(session.value))
    const moving = c.cut && sameSource
    if (c.eqpStateCount > 0 && !moving && !confirmed) { dialog.value = { kind: 'pasteWarn', where, n: c.eqpStateCount }; return false }
    const working = session.value.working
    const anchor = selection.value.anchor
    const anchorUid = anchor && working.steps.some((s) => s.uid === anchor) ? anchor : null
    let s = session.value
    const makeUid = () => { const [uid, next] = nextUid(s, 'p'); s = next; return uid }
    const r = pasteSteps(working, c, { where, anchorUid }, { sameSource, makeUid })
    if (r.refused) { refused(r.refused); return false }
    // 잘라낸 스텝을 같은 자리에 붙였다 — 쌓지 않고 묶음을 남긴다(다른 자리를 고르면 된다)
    if (r.working === working) { notify(t('SEW_CMD_PASTE_SAME_PLACE')); return false }
    if (!moving) takeUploads(c, r.working.steps.filter((st) => r.pasted.includes(st.uid)))
    const n = r.pasted.length
    const label = moving ? t('SEW_CMD_MOVED', { n }) : r.unresolved ? t('SEW_CMD_PASTED_UNRESOLVED', { n, open: r.unresolved }) : t('SEW_CMD_PASTED', { n })
    const firstOpen = moving ? null : r.working.steps.find((st) => r.pasted.includes(st.uid) && (st.next.onTrue.kind === 'unresolved' || st.next.onFalse.kind === 'unresolved'))
    const sel = firstOpen ? { uids: [firstOpen.uid], anchor: firstOpen.uid } : { uids: r.pasted, anchor: r.pasted[0] }
    run(label, () => ({ working: r.working, selection: sel }))
    session.value = { ...session.value, seq: s.seq }
    if (moving) clip.value = null
    return true
  }

  function deleteSelection() {
    if (!editable.value) return false
    const uids = selection.value.uids.filter((u) => workingStep(u)) // 작업본에 없는 줄은 뺀다 — 모두 없으면 아무 일도 없다
    if (!uids.length) return false
    if (guarded(deleteSelection)) return false
    const working = session.value.working
    const r = deleteSteps(working, uids)
    if (r.blocked) { dialog.value = { kind: 'delblock', targets: [...uids], refs: r.blocked }; return false }
    const nos = uids.map(noOf).sort((a, b) => a - b)
    const rest = r.working.steps
    const nx = rest[Math.min(nos[0] - 1, rest.length - 1)]
    run(t('SEW_CMD_DELETED', { nos: nos.join('·') }), () => ({ working: r.working, selection: nx ? { uids: [nx.uid], anchor: nx.uid } : emptySelection() }))
    if (!nx) useEditorStore().selectedUid = null
    return true
  }

  function moveSelected(dir) {
    const uids = selection.value.uids
    if (!editable.value || !uids.length) return false
    if (guarded(() => moveSelected(dir))) return false
    const nos = uids.map(noOf).sort((a, b) => a - b)
    const r = moveSteps(session.value.working, uids, dir)
    if (r.refused) { refused(r.refused); return false }
    const what = nos.length > 1 ? t('SEW_CMD_WHAT_STEPS', { n: nos.length }) : t('SEW_CMD_WHAT_STEP', { no: nos[0] })
    run(t(dir < 0 ? 'SEW_CMD_MOVED_UP' : 'SEW_CMD_MOVED_DOWN', { what }), () => r)
    return true
  }

  const targetText = (tg) => (tg.kind === 'next' ? 'NEXT' : tg.kind === 'end' ? tg.value : tg.kind === 'step' ? t('SEW_CMD_TARGET_STEP', { no: noOf(tg.uid) }) : '—')
  // 표 칸 바로 고치기(설계 §4.2): 정확도·전처리 스킵·성공/실패 갈 곳. 값이 같으면 아무것도 쌓지 않는다.
  function editCell(uid, field, value) {
    if (!editable.value) return false
    const step = session.value.working.steps.find((s) => s.uid === uid)
    if (!step) return false
    const cur = field === 'accept' ? step.condition?.image?.accept : field === 'skip' ? step.condition?.skipPreprocessing : step.next[field]
    if (canonicalJson(cur) === canonicalJson(value)) return false
    if (guarded(() => editCell(uid, field, value))) return false
    const no = noOf(uid)
    const label = field === 'accept' ? t('SEW_CMD_CELL_ACCEPT', { no, v: value.toFixed(2) })
      : field === 'skip' ? t(value ? 'SEW_CMD_CELL_SKIP_ON' : 'SEW_CMD_CELL_SKIP_OFF', { no })
        : t('SEW_CMD_CELL_TARGET', { no, which: t(field === 'onTrue' ? 'SEW_CMD_WHICH_ON_TRUE' : 'SEW_CMD_WHICH_ON_FALSE'), to: targetText(value) })
    // 저장 기준점과 같은 값으로 돌아오면 그 스텝 객체를 다시 쓴다(applyPanel 과 같다 — 표시·알림이 P1 으로, 서버가 고친 스텝으로 보지 않게)
    run(label, (w) => {
      const r = setCell(w, uid, field, value)
      const sb = saveBaseStep(uid)
      return sb && sameStep(r.working.steps.find((s) => s.uid === uid), sb) ? applyStep(w, sb) : r
    })
    return true
  }

  // ── 큰 화면 잡기(목업 CAP_FLOW·capStart·capNext·capDone·capCancel, 조작판 3~6) ──
  // 잡은 값은 패널 초안에만 들어간다. 작업본은 [적용](고른 스텝) 또는 [N번 앞에 넣기]·[맨 끝에 추가](새 스텝)로만 바뀐다.
  const imgCtx = () => ({ session: session.value, uploads: uploads.value, draftId: draftId.value })
  // 올릴 그림 넣기 — 넣을 것이 있으면 한 번에 새 Map 으로 바꾼다(화면이 따라 그린다)
  function putUploads(entries) {
    if (!entries.length) return
    const m = new Map(uploads.value)
    for (const [tempId, blob] of entries) m.set(tempId, blob)
    uploads.value = m
  }
  function setUpload(tempId, blob) { putUploads([[tempId, blob]]) }
  // 기준 화면 비트맵 — 같은 URL 이면 다시 받지 않는다. 실패하면 잊어 다음에 다시 받는다.
  function baseBitmap(url) {
    if (bitmapCache.url !== url) {
      const promise = loadBitmap(url)
      bitmapCache = { url, promise }
      promise.catch(() => { if (bitmapCache.promise === promise) bitmapCache = { url: null, promise: null } })
    }
    return bitmapCache.promise
  }
  // 기준 화면의 검색 영역에서 찾을 그림 위치 찾기([다시 찍기]·위치 보기가 함께 쓴다). 한 곳이면 찾을 그림·기준 화면 크기를 붙인다.
  // 불러오기·픽셀 읽기 실패는 { found: 'error' }. locate 는 메인 스레드에서 돌고 LOCATE_MS 에서 멈춘다.
  async function locateTrain(baseUrl, trainUrl, area) {
    try {
      if (!baseUrl || !trainUrl) throw new Error('no image')
      const [base, train] = await Promise.all([baseBitmap(baseUrl), loadBitmap(trainUrl)])
      const r = locate(imageDataOf(base), imageDataOf(train), area, { timeLimitMs: LOCATE_MS })
      return r.found === 'one' ? { ...r, w: train.width, h: train.height, bw: base.width, bh: base.height } : r
    } catch {
      return { found: 'error' }
    }
  }
  // 초점 스텝의 찾을 그림 위치 보기(editor/trainView spotInputOf* 의 입력). 같은 키는 다시 찾지 않는다(찾는 중이거나 찾았으면).
  // 실패(error)만 다음 요청 때 다시 찾는다. 결과는 그 키에만 두므로 늦게 끝난 옛 결과가 다른 스텝에 붙지 않는다. 작업본·초안은 바꾸지 않는다.
  function findSpot(input) {
    const key = spotKey(input)
    if (!key || spotJobs.has(key)) return
    const have = spots.value.get(key)
    if (have && have.found !== 'error') return
    const gen = spotGen.value
    spotJobs.add(key)
    locateTrain(input.baseUrl, input.trainUrl, input.area).then((r) => {
      if (gen !== spotGen.value) return // 세션이 바뀌었다
      spotJobs.delete(key)
      const m = new Map(spots.value)
      m.set(key, r)
      spots.value = m
    })
  }
  function setAreaDrag(on) { areaDragging.value = !!on }
  function requestView(kind) { viewReq.value = { kind, n: (viewReq.value?.n ?? 0) + 1 } }
  // 잡기는 큰 화면에 그린 기준 화면 위에서만 — 패널 초안의 기준 화면이 그림(참조)이어야 한다. 버튼도 이것으로 끈다.
  const captureBaseUrl = () => { const d = panel.value.draft; return d ? refUrl(d.images?.base, imgCtx()) : null }
  const canCapture = computed(() => editable.value && !!captureBaseUrl())

  // 잡기 시작: flow 의 첫 단계부터. why = 그림부터 다시 잡는 이유([다시 찍기]), train = 누를 곳의 기준 사각형(누를 곳만 찍을 때).
  function startCapture(flow, { why = null, train = null } = {}) {
    const p = panel.value
    if (!editable.value || !p.draft || !flow?.length) return false
    if (!captureBaseUrl()) { notify(t('SEW_CAP_NO_BASE_IMAGE')); return false }
    capture.value = { flow: [...flow], stage: flow[0], why, before: p.draft, train }
    requestView('all')
    return true
  }
  function advance(c, extra = {}) {
    const next = nextStage(c.flow, c.stage, panel.value.draft?.action?.type)
    capture.value = next ? { ...c, ...extra, stage: next } : null
  }
  const sameRect = (a, b) => !!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h
  // 지금 단계의 값을 받는다. 영역·그림 = 기준 화면 픽셀 사각형 { x, y, w, h }, 누를 곳 = 점 { x, y }. 받았으면 true.
  async function captureNext(value) {
    const c = capture.value
    const d = panel.value.draft
    if (!c || !d || !editable.value) return false
    if (c.stage === 'click') {
      const tr = c.train
      if (!CLICK_TYPES.includes(d.action?.type)) { capture.value = null; return false } // 잡는 사이 동작을 클릭이 아닌 것으로 바꿨다
      if (!tr || !Number.isFinite(value?.x) || !Number.isFinite(value?.y)) return false
      // 누를 곳은 찾을 그림 왼쪽 위에서 잰 거리(서버 parseAction basis 'trainImage') — 그림 밖도 된다
      const click = { x: Math.round(value.x - tr.x), y: Math.round(value.y - tr.y), basis: 'trainImage' }
      updateDraft((s) => ({ ...s, action: { ...s.action, click } }))
      advance(c)
      return true
    }
    if (!isRect(value)) return false
    const area = d.condition?.searchArea
    const r = c.stage === 'train' && isRect(area) ? clipRect(value, area) : { x: Math.round(value.x), y: Math.round(value.y), w: Math.round(value.w), h: Math.round(value.h) }
    if (r.w < MIN_CAPTURE || r.h < MIN_CAPTURE) { notify(t('SEW_CAP_TOO_SMALL')); return false }
    if (c.stage === 'area' || c.stage === 'ocr') {
      if (!sameRect(area, r)) updateDraft((s) => ({ ...s, condition: { ...s.condition, searchArea: r } }))
      advance(c)
      return true
    }
    if (c.stage !== 'train') return false
    // 찾을 그림: 기준 화면에서 잘라 PNG 로(키 0 하나 — 사내 편집기처럼). 다른 출처 그림은 fetch 로 받아 canvas 를 오염시키지 않는다.
    const url = refUrl(d.images?.base, imgCtx())
    if (!url) { notify(t('SEW_CAP_NO_BASE')); return false }
    let blob
    try {
      blob = await cropPng(await baseBitmap(url), r)
    } catch {
      if (capture.value === c) notify(t('SEW_CAP_CROP_FAILED'))
      return false
    }
    if (capture.value !== c || !editable.value) return false // 자르는 사이 취소했거나 다른 스텝으로 갔거나 다른 시나리오를 열기 시작했다
    const tempId = newTempId()
    setUpload(tempId, blob)
    updateDraft((s) => {
      const cond = s.condition
      const image = cond?.kind === 'image' && cond.image ? cond.image : null
      const type = (image?.trainImages ?? []).find((ti) => ti.key === 0)?.type
      return {
        ...s,
        images: { ...s.images, train: { 0: { from: 'upload', tempId } } },
        condition: image ? { ...cond, image: { ...image, trainImages: [{ key: 0, type: typeof type === 'boolean' ? type : true }] } } : cond
      }
    })
    advance(c, { train: r })
    return true
  }
  // Esc·[취소]: 잡기가 쓴 칸(검색 영역·찾을 그림·찾을 그림 목록·누를 곳)만 잡기 전 값으로. 잡는 사이 패널에서 고친 설명·정확도·갈 곳 등은 남긴다.
  // 누를 곳은 동작 종류가 그대로일 때만 되돌린다(잡는 사이 동작을 바꿨으면 그 선택을 둔다). 결과가 잡기 전과 같으면 그 객체를 다시 쓴다.
  // 영역·찾을 그림·찾을 그림 목록은 패널에서 고칠 수 없는 칸이라 참조가 다르면 잡기 전 참조로 되돌린다(값이 같으면 같은 객체가 남게).
  function restoreCaptured(cur, before) {
    let s = cur
    if (s.condition?.searchArea !== before.condition?.searchArea) s = { ...s, condition: { ...s.condition, searchArea: before.condition?.searchArea ?? null } }
    if (s.images?.train !== before.images?.train) s = { ...s, images: { ...s.images, train: before.images?.train ?? {} } }
    const ti = before.condition?.image?.trainImages
    if (s.condition?.image && before.condition?.image && s.condition.image.trainImages !== ti) {
      s = { ...s, condition: { ...s.condition, image: { ...s.condition.image, trainImages: ti } } }
    }
    if (s.action?.type === before.action?.type && canonicalJson(s.action?.click) !== canonicalJson(before.action?.click)) {
      const { click, ...rest } = s.action
      s = { ...s, action: before.action && 'click' in before.action ? { ...rest, click: before.action.click } : rest }
    }
    return sameStep(s, before) ? before : s
  }
  function cancelCapture() {
    const c = capture.value
    if (!c) return false
    capture.value = null
    const p = panel.value
    if (p.draft && p.draft !== c.before) {
      const draft = restoreCaptured(p.draft, c.before)
      if (draft !== p.draft) panel.value = { ...p, draft }
    }
    return true
  }
  // [그림은 그대로 두기]: 지금까지 잡은 값만 두고 끝낸다(목업 cap:keep)
  function finishCapture() { capture.value = null }

  // [다시 찍기](목업 repick·locateTrain, 조작판 4~6): 기준 화면의 검색 영역에서 찾을 그림을 찾아 한 곳이면 누를 곳만 찍는다.
  // 없음·여러 곳·시간 초과·불러오기 실패면 이유를 보이고 그림부터 잡는다.
  async function repick() {
    const p = panel.value
    const d = p.draft
    if (!editable.value || !d || d.condition?.kind !== 'image' || locating.value) return false
    const area = d.condition.searchArea
    if (!isRect(area)) return false
    if (!captureBaseUrl()) { notify(t('SEW_CAP_NO_BASE_IMAGE')); return false }
    const trainRef = firstTrainRef(d.images?.train)
    if (!trainRef) return startCapture(['train', 'click'])
    const ctx = imgCtx()
    locating.value = true
    let r
    try {
      r = await locateTrain(refUrl(d.images?.base, ctx), refUrl(trainRef, ctx), area)
    } finally {
      locating.value = false
    }
    if (panel.value.uid !== p.uid || !panel.value.draft) return false // 찾는 사이 다른 스텝으로 갔다
    if (r.found === 'one') return startCapture(['click'], { train: { x: r.x, y: r.y, w: r.w, h: r.h } })
    const why = { many: 'SEW_CAP_WHY_MANY', timeout: 'SEW_CAP_WHY_TIMEOUT', error: 'SEW_CAP_WHY_ERROR' }[r.found] ?? 'SEW_CAP_WHY_NONE'
    return startCapture(['train', 'click'], { why: t(why) })
  }

  // ── 새 스텝(목업 startNew·addNew·newcancel, 조작판 7) ──
  // 새 스텝의 기준 줄(origin): 고른 스텝, 새 스텝을 만드는 중이면 그 초안이 시작할 때 고른 줄. 화면을 빌릴 줄이자 취소·되돌리기가 돌아갈 줄이다.
  function originUid() {
    const a = selection.value.anchor
    if (a && workingStep(a)) return a
    const p = panel.value
    return p.isNew && p.origin && workingStep(p.origin) ? p.origin : null
  }
  // 넣을 자리: 고른 줄 뒤(그 다음 줄 앞, 없으면 맨 끝 — editor/capture afterUid). 새 스텝을 만드는 중에 다시 시작하면 바꿔 둔 자리를 그대로 쓴다.
  // 표 위 [새 스텝] 과 스냅샷 화면 [새 스텝] 이 같은 자리에 넣는다(2026-11-17 — 그 전에는 고른 줄 앞·맨 끝으로 달랐다).
  // 여러 줄을 골랐으면 고른 줄들 가운데 맨 아래 줄의 뒤다(기준 줄 뒤면 묶음 가운데로 들어간다 — 붙여넣은 직후도 그렇다).
  function newPlace() {
    const a = selection.value.anchor
    if (a && workingStep(a)) {
      const picked = new Set(selection.value.uids)
      let last = a
      for (const st of session.value.working.steps) if (picked.has(st.uid)) last = st.uid
      return afterUid(session.value.working, last)
    }
    const p = panel.value
    return p.isNew && p.insertBefore && workingStep(p.insertBefore) ? p.insertBefore : null
  }
  // 메뉴가 "n번 스텝의 화면" 줄을 그릴 때 쓴다: 빌릴 줄과 그 기준 화면(없으면 base null). 빌릴 줄이 없으면 null.
  const newOrigin = computed(() => {
    const uid = session.value?.working ? originUid() : null
    if (!uid) return null
    return { uid, no: noOf(uid), base: baseRefFor(session.value.working, uid) }
  })
  // 종류를 고르면 패널이 새 스텝 초안을 연다. 이미지·OCR 은 기준 화면에서 잡기를 시작한다 — 화면이 오는 곳은 셋이다(2026-11-17):
  //   opts.snapshot = { eqpId, fileName, blob }: 떠 있는 스냅샷 그림(P3-E). 누를 때의 그림을 쥐고 간다(확인 창을 거치는 사이 다른 스냅샷을 골라도 바뀌지 않는다).
  //   opts.file = { key, blob }: 내 PC 의 그림 파일을 PNG 로 준비한 것(startNewFromFile 이 만든다).
  //   둘 다 없으면 고른 스텝의 기준 화면을 빌린다 — 그 스텝에 기준 화면이 없으면 시작하지 않는다(다른 스텝의 화면으로 넘어가지 않는다).
  // 스냅샷·파일은 스텝이 없는 시나리오에서도 된다. 그림이 없거나 너무 크면 시작하지 않고 알린다.
  // 패널에 적용 안 한 변경이 있으면 먼저 묻는다(다른 스텝으로 가는 것과 같은 이동).
  function startNew(kind, opts = {}) {
    if (!editable.value || (!CAP_FLOWS[kind] && kind !== 'none')) return false
    let shared = null
    if (CAP_FLOWS[kind] && 'snapshot' in opts) {
      const problem = snapshotBaseProblem(opts.snapshot)
      if (problem) { notify(t(problem === 'tooLarge' ? 'SEW_SNAP_STEP_TOO_LARGE' : 'SEW_SNAP_STEP_NO_IMAGE')); return false }
      shared = { key: snapshotKey(opts.snapshot.eqpId, opts.snapshot.fileName), blob: opts.snapshot.blob }
    } else if (CAP_FLOWS[kind] && 'file' in opts) {
      const f = opts.file
      if (!f?.key || !(f.blob instanceof Blob) || !(f.blob.size > 0)) { notify(t('SEW_NEW_FILE_NOT_IMAGE')); return false }
      shared = { key: f.key, blob: f.blob }
    }
    // 기준 줄·넣을 자리는 누를 때의 것을 쥐고 간다 — 확인 창에서 [버리고 이동] 하면 만들던 새 스텝이 버려지며 선택이 바뀐다
    const place = { origin: originUid(), insertBefore: newPlace() }
    const open = () => {
      const ok = openNew(kind, shared, place)
      if (ok) opts.opened?.()
      return ok
    }
    if (!panelDirty()) return open()
    return guard(open, { action: 'move' })
  }
  // 그림 파일로 새 이미지·OCR 스텝(2026-11-17 사내 요청): 파일을 PNG 로 준비해(PNG 는 그대로 — editor/localBase) 새 스텝을 시작한다.
  // 그림이 아니거나 너무 크면 알리고 만들지 않는다. 푸는 사이 세션이 바뀌면 버린다.
  // 시작한 뒤, 견줄 스텝(고른 스텝, 없으면 기준 화면이 있는 첫 스텝)의 기준 화면과 크기가 다르면 알린다(막지 않는다 —
  // 좌표는 기준 화면의 픽셀이라 설비 화면 전체를 제 크기로 찍은 그림이 아니면 실행 때 어긋난다).
  // 푸는 사이 다른 파일을 또 고르면 뒤의 것만 쓴다(fileSeq). 크기 견주기는 새 스텝이 실제로 열린 뒤에 한다 — 확인 창을 거쳐 열려도 알린다.
  async function startNewFromFile(kind, file) {
    if (!editable.value || !CAP_FLOWS[kind] || !file) return false
    const gen = spotGen.value
    const seq = ++fileSeq
    const stale = () => gen !== spotGen.value || seq !== fileSeq
    let prepared
    try {
      prepared = await prepareLocalBase(file, { decode: bitmapOf, toPng: (b) => cropPng(b, { x: 0, y: 0, w: b.width, h: b.height }), isPng })
    } catch (err) {
      if (!stale()) notify(t(err?.reason === 'tooLarge' ? 'SEW_NEW_FILE_TOO_LARGE' : 'SEW_NEW_FILE_NOT_IMAGE'))
      return false
    }
    if (stale() || !editable.value) return false
    const steps = session.value.working.steps
    const origin = originUid()
    const mate = (origin && baseRefFor(session.value.working, origin) ? workingStep(origin) : null) ?? steps.find((x) => isRef(x.images?.base)) ?? null
    const mateUrl = mate ? refUrl(mate.images.base, imgCtx()) : null
    const mateNo = mate ? noOf(mate.uid) : 0
    const opened = () => {
      const uid = panel.value.uid
      if (!mateUrl) return
      loadBitmap(mateUrl).then((b) => {
        if (gen !== spotGen.value || panel.value.uid !== uid) return
        if (sizeDiffers({ w: prepared.w, h: prepared.h }, { w: b.width, h: b.height })) notify(t('SEW_NEW_FILE_SIZE_DIFF', { w: prepared.w, h: prepared.h, no: mateNo, bw: b.width, bh: b.height }))
      }, () => {})
    }
    return startNew(kind, { file: prepared, opened })
  }
  // 함께 쓰는 그림(스냅샷·그림 파일)을 올릴 그림으로 넣고 그 참조를 준다. 이 세션에서 같은 그림(key)을 이미 넣었으면(그 그림이 아직 있으면) 그것을 다시 쓴다.
  // 새로 넣어야 하는데 작업본이 쓰는 올릴 그림과 합쳐 한 번의 저장 한도(합계 50MB·200장)를 넘게 되면 넣지 않고 알린다(null) —
  // 넘은 채로는 초안 저장도 배포도 막혀 만든 스텝을 저장할 길이 없다(P3-E 독립 검토).
  function sharedBaseRef(shared, working) {
    const known = sharedBases.get(shared.key)
    const kept = known && uploads.value.has(known) ? known : null
    const used = uploadIdsOf(working.steps)
    // 이미 어느 스텝이 쓰는 그림이면 더 올리는 것이 없다. 남아 있기만 한 그림(시작했다 취소한 것)은 새로 올리는 것과 같이 한도를 본다
    if (kept && used.includes(kept)) return { from: 'upload', tempId: kept }
    const over = uploadBudgetProblem(kept ? uploads.value.get(kept) : shared.blob, used.map((id) => uploads.value.get(id)))
    if (over) { notify(t(over === 'files' ? 'SEW_SNAP_STEP_TOO_MANY_FILES' : 'SEW_SNAP_STEP_TOTAL_TOO_LARGE')); return null }
    if (kept) return { from: 'upload', tempId: kept }
    const tempId = newTempId()
    setUpload(tempId, shared.blob)
    sharedBases.set(shared.key, tempId)
    return { from: 'upload', tempId }
  }
  function openNew(kind, shared, place) {
    const s = session.value
    if (!s?.working) return false
    if (s.working.steps.length >= STEP_MAX) { refused('STEP_LIMIT'); return false }
    // 확인 창을 거치는 사이 지워진 줄은 버린다(자리는 맨 끝으로, 빌릴 줄은 없음으로)
    const origin = place.origin && workingStep(place.origin) ? place.origin : null
    const insertBefore = place.insertBefore && workingStep(place.insertBefore) ? place.insertBefore : null
    const base = kind === 'none' ? null : shared ? sharedBaseRef(shared, s.working) : baseRefFor(s.working, origin)
    if (kind !== 'none' && !base) { if (!shared) notify(t('SEW_EDIT_NEW_NO_BASE')); return false }
    const [uid, next] = nextUid(s, 'n')
    session.value = next
    const draft = newStepDraft(kind, { uid, base })
    capture.value = null
    // insertBefore = 넣을 자리(그 줄 앞, null 이면 맨 끝 — 만드는 중에 바꿀 수 있다). origin = 시작할 때 고른 줄(화면을 빌린 줄, 취소·되돌리기가 돌아갈 곳).
    panel.value = { uid, isNew: true, draft, base: draft, insertBefore, origin, tried: false }
    // 표에서 고른 줄을 비운다(새 스텝은 아직 표에 없다). 패널을 먼저 바꿔 두어 초점 감시가 초안을 지우지 않는다.
    selection.value = emptySelection()
    useEditorStore().selectedUid = null
    if (CAP_FLOWS[kind]) startCapture(CAP_FLOWS[kind])
    return true
  }
  // 넣을 자리 바꾸기(2026-11-10): 다 만든 뒤 자리를 정할 수 있게 — 넣고 나서 옮기지 않아도 된다. uid = 그 줄 앞, null = 맨 끝.
  // 기준 화면·잡은 영역·넣은 값은 그대로다(자리와 기준 화면은 별개).
  function setInsertBefore(uid) {
    const p = panel.value
    if (!p.isNew || (uid !== null && !workingStep(uid))) return false
    panel.value = { ...p, insertBefore: uid }
    return true
  }
  // [넣기]: 고른 자리(insertBefore — 그 줄 앞, 없으면 맨 끝)에 넣는다. where 'end' 면 자리와 상관없이 맨 끝. 칸 검사를 통과해야 넣는다. 200개면 막고 알린다.
  function addNew(where = 'before') {
    const p = panel.value
    if (!editable.value || !p.isNew || !p.draft) return false
    const bad = firstError(panelErrors())
    if (bad) { panel.value = { ...p, tried: true }; requestFocus(bad); return false }
    const working = session.value.working
    const before = where === 'before' && p.insertBefore && workingStep(p.insertBefore) ? p.insertBefore : null
    const r = insertStep(working, p.draft, { beforeUid: before })
    if (r.refused) { refused(r.refused); return false }
    const label = before ? t('SEW_CMD_INSERTED', { no: noOf(before) }) : t('SEW_CMD_ADDED_END')
    capture.value = null
    panel.value = emptyPanel()
    // 되돌리면 넣기 전의 고른 줄(시작할 때 고른 줄)로 돌아가게 스냅샷 전에 선택을 그 줄로 둔다
    if (p.origin && workingStep(p.origin)) selection.value = { uids: [p.origin], anchor: p.origin }
    run(label, () => ({ working: r.working, selection: { uids: [p.uid], anchor: p.uid } }))
    return true
  }
  // [취소]: 새 스텝 초안을 버리고 고른 스텝으로 돌아간다
  function cancelNew() {
    const p = panel.value
    if (!p.isNew) return false
    capture.value = null
    panel.value = emptyPanel()
    const a = p.origin && workingStep(p.origin) ? p.origin : null
    if (a) setSelection({ uids: [a], anchor: a })
    syncPanel(a ?? focusUid())
    return true
  }

  return {
    session, selection, panel, undo, redo, clip, windowClip, uploads, capture, locating, viewReq, canCapture, toast, dialog, moved, focusReq, revealReq, editable, draftId, spots, spotGen, areaDragging,
    begin, beginNew, beginRestore, beginFromDraft, markDeleted, markPropertyChanged, forgetDraft, end, rebase, markDraft, run, undoLast, redoLast,
    setSelection, syncFocus, requestSelect, jumpTo, clickRow, panelDirty, notify,
    openPanel, syncPanel, updateDraft, panelErrors, applyPanel, discardPanel, requestFocus,
    guard, guardKeep, guardDrop, guardApply, setHeader, applyProperty, applyWindows, copyWindows, changeCount, unsavedCount, askLeave, leaveKeep, leaveDrop,
    undoCommand, redoCommand, copySelection, pasteClip, deleteSelection, moveSelected, editCell,
    setUpload, requestView, startCapture, captureNext, cancelCapture, finishCapture, repick, findSpot, setAreaDrag, newOrigin, startNew, startNewFromFile, addNew, setInsertBefore, cancelNew
  }
})

<script setup>
import { ref, computed, watch } from 'vue'
import { AgGridVue } from 'ag-grid-vue3'
import { useEditorStore } from '../stores/editorStore'
import { useEditStore } from '../stores/editStore'
import { scenarioEditorApi as api } from '../api'
import { t, LABELS, errorMessage } from '../messages'
import { formatCrtime, enabledLabel, sizeText } from '../format'
import { safeStorage } from '../composables/useSafeStorage'
import { registerGrid, useGridTheme } from '../gridTheme'
import { mergeDrafts, draftStale, isDup } from '../editor/loadRows'
import { useToast } from '@/shared/composables/useToast'
import BaseToast from '@/shared/components/BaseToast.vue'
import ModalShell from './ModalShell.vue'
import LoadPane from './load/LoadPane.vue'
import LoadDelete from './load/LoadDelete.vue'
import LoadDraftCleanup from './load/LoadDraftCleanup.vue'
import LoadDraftChoice from './load/LoadDraftChoice.vue'
import './load/load.css'

defineOptions({ name: 'LoadDialog' })
registerGrid()
const props = defineProps({ modelValue: Boolean })
// open = 시나리오 버전 열기 { process, model, name, crtime }. 쓰기 사용자(P2-D Task 7): open-draft = [초안 이어서 열기] { process, model, name, draftId },
// restore = [이 버전으로 되돌려 열기] { process, model, name, crtime }. 여는 일(저장 전 변경 확인 포함)은 부모가 맡는다.
const emit = defineEmits(['update:modelValue', 'open', 'open-draft', 'restore'])
const store = useEditorStore()
const edit = useEditStore()
const theme = useGridTheme()
const { toast, showToast } = useToast()
const LAST = 'se-last-scope'

const process = ref('')
const model = ref('')
const listRows = ref([])
const drafts = ref([])
const draftsError = ref('')
const listError = ref('')
const search = ref('')
const enabledOnly = ref(false)
const draftOnly = ref(false)
const selectedName = ref(null)
const pick = ref(null) // 고른 버전 crtime, 내 초안 줄은 'draft'
const versions = ref([])
const versionsError = ref('')
const sub = ref(null) // 창 위 작은 창 'delete' | 'choice' | 'cleanup'
// 원본이 지워진 초안(초안만 · 원본 지워짐 행)의 서버 사본 확인: draftId → 'checking' | 'kept' | 'gone' | { failed: 문구 }
const sourceChecks = ref(new Map())
// 지금 rows 를 받아 온 { process, model } — 열기 요청은 화면의 선택값이 아니라 이 쌍으로 보낸다
const loadedFor = ref(null)

// 쓰기 사용자에게만 켜기·끄기·지우기·되돌려 열기·내 초안이 더해진다. 읽기만 하는 사용자는 P1 화면 그대로.
const writer = computed(() => !!store.me?.canWrite)
const processes = computed(() => store.scopes?.processes ?? [])
const models = computed(() => processes.value.find((p) => p.process === process.value)?.models ?? [])
// 권한·설비를 못 읽었거나(null) 비었을 때(빈 배열) 빈 선택 상자만 보이지 않게 한 줄로 알린다
const scopesNotice = computed(() => {
  if (!store.scopes) return { text: t('SEW_UI_LOAD_SCOPES_FAILED'), error: true }
  if (processes.value.length === 0) return { text: t('SEW_UI_LOAD_NO_SCOPES'), error: false }
  return null
})
// ── 공정·모델 옆 수(2026-11-11 사용자 요청 — WebManager 필터의 "(건수)" 처럼): 등록된 시나리오 수, 내 초안이 있는 곳은 (내 초안 | 시나리오) ──
// 서버가 공정 권한 안의 쌍만 세어 준다(둘 다 0 인 쌍은 없다 → 0). 못 읽으면(null) 이름만 보인다.
const counts = ref(null) // Map '공정 모델' → { scenarios, drafts }
const draftsCounted = ref(false) // 서버가 내 초안을 셌는가(쓰기 사용자이고 웹 전용 DB 를 읽었다)
const NONE = Object.freeze({ scenarios: 0, drafts: 0 })
const countKey = (p, m) => JSON.stringify([p, m])
const countOf = (p, m) => counts.value?.get(countKey(p, m)) ?? NONE
const processCount = (p) => p.models.reduce((n, m) => { const c = countOf(p.process, m.model); return { scenarios: n.scenarios + c.scenarios, drafts: n.drafts + c.drafts } }, NONE)
const countText = (c) => (!counts.value ? '' : draftsCounted.value && c.drafts > 0 ? ` (${c.drafts} | ${c.scenarios})` : ` (${c.scenarios})`)
const countHint = computed(() => (counts.value ? { text: t(draftsCounted.value ? 'SEW_LOAD_COUNT_HINT_DRAFT' : 'SEW_LOAD_COUNT_HINT'), tip: t(draftsCounted.value ? 'SEW_LOAD_COUNT_TIP_DRAFT' : 'SEW_LOAD_COUNT_TIP') } : null))
// 지금 보는 공정·모델의 수는 목록을 따른다 — 수를 읽은 뒤의 배포·지우기·초안 정리로 괄호와 목록이 어긋나지 않게(다시 묻지 않는다)
function syncCounts() {
  const pair = loadedFor.value
  if (!counts.value || !pair) return
  const was = countOf(pair.process, pair.model)
  const next = { scenarios: listRows.value.length, drafts: writer.value && draftsCounted.value && !draftsError.value ? drafts.value.length : was.drafts }
  if (next.scenarios !== was.scenarios || next.drafts !== was.drafts) counts.value = new Map(counts.value).set(countKey(pair.process, pair.model), next)
}
let countSeq = 0
async function loadCounts() {
  const id = ++countSeq
  let next = null
  let counted = false
  try {
    const d = (await api.counts()).data.data
    next = new Map(d.pairs.map((c) => [countKey(c.process, c.model), { scenarios: c.scenarios, drafts: c.drafts }]))
    counted = !!d.draftsCounted
  } catch { next = null } // 곁들이는 값이라 못 읽어도 알리지 않는다 — 이름만 보인다
  if (id !== countSeq) return
  counts.value = next; draftsCounted.value = counted
  syncCounts()
}

const rows = computed(() => (loadedFor.value ? mergeDrafts(listRows.value, writer.value ? drafts.value : [], loadedFor.value) : []))
const draftCount = computed(() => rows.value.filter((r) => r.draft).length)
// 배포된 시나리오 없이 내 초안만 남은 행(새 시나리오·원본 지워짐) — [초안만 남은 것 정리] 로 골라 한꺼번에 지운다
const draftOnlyRows = computed(() => rows.value.filter((r) => r.draftOnly))
const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  return rows.value.filter((r) => (!enabledOnly.value || r.isEnabled !== false) && (!draftOnly.value || r.draft) && r.name.toLowerCase().includes(q))
})
const selected = computed(() => rows.value.find((r) => r.name === selectedName.value) ?? null)
const currentVersion = computed(() => versions.value.find((v) => v.isCurrent) ?? null)
const eqpCount = computed(() => models.value.find((m) => m.model === loadedFor.value?.model)?.eqpCount ?? 0)

// 고른 행이 편집 화면에 열려 있으면 { changes, propertyChanged, enabled }(지워져 읽기 전용이 된 화면은 아니다)
const openInfo = computed(() => {
  const sk = store.skeleton
  const s = edit.session
  const pair = loadedFor.value
  const r = selected.value
  if (!sk || !s || !pair || !r || sk.isNew || s.readOnly === 'deleted' || sk.process !== pair.process || sk.model !== pair.model || sk.name !== r.name) return null
  return { changes: edit.unsavedCount, propertyChanged: !!s.propertyChanged, enabled: s.working?.property?.IsEnabled ?? r.isEnabled }
})

function pickInitial() {
  let last = null
  try { last = JSON.parse(safeStorage.get(LAST) || 'null') } catch { last = null }
  const allowed = (p, m) => processes.value.some((x) => x.process === p && x.models.some((y) => y.model === m))
  if (last && allowed(last.process, last.model)) { process.value = last.process; model.value = last.model; return }
  process.value = processes.value[0]?.process ?? ''
  model.value = processes.value[0]?.models[0]?.model ?? ''
}

function clearSelection() {
  versionSeq++
  selectedName.value = null; pick.value = null; versions.value = []; versionsError.value = ''; sub.value = null
}
// 요청마다 번호를 매겨 마지막 요청의 응답만 화면에 쓴다(앞 요청의 늦은 성공·실패는 버린다)
let listSeq = 0
let versionSeq = 0
async function loadList() {
  const id = ++listSeq
  clearSelection()
  listRows.value = []; drafts.value = []; draftsError.value = ''; listError.value = ''; loadedFor.value = null; sourceChecks.value = new Map()
  if (!process.value || !model.value) return
  const pair = { process: process.value, model: model.value }
  safeStorage.set(LAST, JSON.stringify(pair))
  const [list, mine] = await Promise.allSettled([api.list(pair.process, pair.model), writer.value ? api.listDrafts(pair.process, pair.model) : Promise.resolve(null)])
  if (id !== listSeq) return
  if (list.status === 'rejected') { listError.value = errorMessage(list.reason); return }
  listRows.value = list.value.data.data
  if (mine.status === 'fulfilled') drafts.value = mine.value?.data.data ?? []
  else draftsError.value = t('SEW_LOAD_DRAFTS_FAILED', { cause: errorMessage(mine.reason) })
  loadedFor.value = pair
}

// 창은 화면과 함께 한 번 만들어진다 — 열 때마다 목록·내 초안을 다시 읽는다(그 사이 저장한 초안·켜기·끄기·배포, 처음엔 내 정보가 늦게 와 쓰기 권한을 몰랐을 수 있다)
watch(() => props.modelValue, (open, was) => {
  if (!open) return
  loadCounts()
  if (!process.value) pickInitial()
  else if (was === false) loadList()
}, { immediate: true })
watch(processes, () => { if (props.modelValue && !process.value) pickInitial() })
watch(process, () => { if (!models.value.some((m) => m.model === model.value)) model.value = models.value[0]?.model ?? '' })
watch([process, model], loadList, { immediate: true })
watch([listRows, drafts, loadedFor], syncCounts)

// 행 고르기. "초안만" 행은 버전이 없어 내 초안 줄이 늘 골라져 있고, 원본이 지워진 초안이면 서버 사본이 있는지 본다.
async function selectRow(row) {
  const pair = loadedFor.value
  if (!pair || !row) return
  const id = ++versionSeq
  if (selectedName.value !== row.name) pick.value = null
  selectedName.value = row.name
  versions.value = []; versionsError.value = ''
  if (row.draftOnly) {
    pick.value = 'draft'
    if (row.draftOnly === 'gone') checkSource(row)
    return
  }
  try {
    const next = (await api.versions(pair.process, pair.model, row.name)).data.data
    if (id === versionSeq) versions.value = next
  } catch (err) {
    if (id === versionSeq) versionsError.value = errorMessage(err)
  }
}
const onRowClicked = (e) => selectRow(e.data)

// 원본이 지워진 초안: 배포의 [다시 만듭니다]와 같은 판정(force 검사에 SOURCE_GONE 이 없으면 서버 사본이 있다 — editorStore.draftSourceKept)
async function checkSource(row) {
  const pair = loadedFor.value
  const id = row.draft.draftId
  if (sourceChecks.value.has(id)) return
  const set = (v) => { if (loadedFor.value === pair) sourceChecks.value = new Map(sourceChecks.value).set(id, v) }
  set('checking')
  try {
    const d = (await api.getDraft(id)).data.data
    set((await store.draftSourceKept({ ...d, process: pair.process, model: pair.model, name: row.name })) ? 'kept' : 'gone')
  } catch (e) {
    set({ failed: t('SEW_LOAD_DRAFT_CHECK_FAILED', { cause: errorMessage(e) }) })
  }
}
const sourceCheck = computed(() => (selected.value?.draftOnly === 'gone' ? sourceChecks.value.get(selected.value.draft.draftId) ?? 'checking' : null))

// ── 열기 ──
const target = (name, crtime) => ({ process: loadedFor.value.process, model: loadedFor.value.model, name, crtime: String(crtime) })
function openRow(name, crtime = 'current') {
  if (!loadedFor.value) return
  emit('open', target(name, crtime))
}
function openDraft() {
  const r = selected.value
  if (!loadedFor.value || !r?.draft || sourceCheck.value === 'gone' || sourceCheck.value === 'checking') return
  sub.value = null
  emit('open-draft', { process: loadedFor.value.process, model: loadedFor.value.model, name: r.name, draftId: r.draft.draftId })
}
function restore() {
  const r = selected.value
  if (!loadedFor.value || !r || typeof pick.value !== 'number') return
  emit('restore', { process: loadedFor.value.process, model: loadedFor.value.model, name: r.name, crtime: pick.value })
}
const isOld = (crtime) => typeof crtime === 'number' && crtime !== currentVersion.value?.crtime
// [열기]·행 두 번 누르기: 쓰기 사용자는 초안이 있으면 고르기 창, 초안만 있으면 이어서 열기, 옛 버전을 골랐으면 그 버전(읽기 전용)
function openSelected() {
  const r = selected.value
  if (!r) return
  if (!writer.value) {
    const v = versions.value.find((x) => x.crtime === pick.value)
    openRow(r.name, v && !v.isCurrent ? v.crtime : 'current')
    return
  }
  if (r.draftOnly) { openDraft(); return }
  if (isOld(pick.value)) { openRow(r.name, pick.value); return }
  if (r.draft && !isDup(r)) { sub.value = 'choice'; return }
  openRow(r.name)
}
async function onRowDoubleClicked(e) {
  if (!writer.value) { openRow(e.data.name); return }
  pick.value = null
  if (selectedName.value !== e.data.name) await selectRow(e.data)
  pick.value = e.data.draftOnly ? 'draft' : null
  openSelected()
}
// 버전 줄 두 번 누르기·Enter: 내 초안 → 이어서, 옛 버전 → 읽기 전용, 현재 버전 → 묻지 않고 현재 버전(목업 "현재 버전을 직접 고르면")
function openVersion(crtime) {
  const r = selected.value
  if (!r) return
  if (crtime === 'draft') { pick.value = 'draft'; openDraft(); return }
  const v = versions.value.find((x) => x.crtime === crtime)
  openRow(r.name, v && !v.isCurrent ? v.crtime : 'current')
}
// P1 버전 줄(읽기만 하는 사용자)
const openVersionP1 = (v) => { if (selected.value) openRow(selected.value.name, v.isCurrent ? 'current' : v.crtime) }

// ── 바닥 줄(쓰기 사용자): 무엇을 열지 한두 줄 + 고른 것에 따른 버튼 ──
const short = (ms) => formatCrtime(ms).slice(5, 16)
const foot = computed(() => {
  const r = selected.value
  if (!r) return { text: t('SEW_LOAD_FOOT_PICK'), buttons: [{ act: 'open', disabled: true }] }
  if (isDup(r)) return { text: t('SEW_LOAD_FOOT_DUP'), buttons: [{ act: 'open' }] }
  if (r.draftOnly || pick.value === 'draft') {
    const check = sourceCheck.value
    if (check === 'gone') return { text: t('SEW_LOAD_DRAFT_GONE_NO_CACHE'), buttons: [] }
    const tail = check === 'checking' ? ` ${t('SEW_LOAD_DRAFT_CHECKING')}` : check?.failed ? ` ${check.failed}`
      : draftStale(r) ? t('SEW_LOAD_FOOT_DRAFT_STALE') : r.draftOnly === 'gone' ? t('SEW_LOAD_FOOT_DRAFT_GONE') : ''
    return { lead: t('SEW_LOAD_FOOT_DRAFT_LEAD'), text: t('SEW_LOAD_FOOT_DRAFT', { time: short(Date.parse(r.draft.savedAt)) }) + tail, buttons: [{ act: 'draft', disabled: check === 'checking' }] }
  }
  if (isOld(pick.value)) {
    if (!r.currentCrtime) return { lead: t('SEW_LOAD_FOOT_OLD_LEAD'), text: t('SEW_LOAD_FOOT_OLD_NO_CURRENT', { at: formatCrtime(pick.value) }), buttons: [{ act: 'old', primary: true }] }
    return { lead: t('SEW_LOAD_FOOT_RESTORE_LEAD'), text: t('SEW_LOAD_FOOT_RESTORE', { cur: short(r.currentCrtime) }), buttons: [{ act: 'old' }, { act: 'restore' }] }
  }
  if (pick.value !== null && r.draft) return { lead: t('SEW_LOAD_FOOT_CURRENT_LEAD'), text: t('SEW_LOAD_FOOT_CURRENT_DRAFT'), buttons: [{ act: 'current' }] }
  if (!r.currentCrtime) return { text: t('SEW_LOAD_FOOT_NO_CURRENT'), buttons: [{ act: 'open' }] }
  if (r.draft) return { text: t('SEW_LOAD_FOOT_HAS_DRAFT'), buttons: [{ act: 'open' }] }
  return { lead: t('SEW_LOAD_FOOT_CURRENT_LEAD'), text: t('SEW_LOAD_FOOT_CURRENT', { at: formatCrtime(r.currentCrtime) }), buttons: [{ act: 'open' }] }
})
const FOOT_BUTTONS = {
  open: { key: 'SEW_LOAD_OPEN', testid: 'se-load-open', primary: true, run: () => openSelected() },
  current: { key: 'SEW_LOAD_OPEN_CURRENT', testid: 'se-load-open-current', primary: true, run: () => openRow(selected.value.name) },
  old: { key: 'SEW_LOAD_OPEN_OLD', testid: 'se-load-open-old', primary: false, run: () => openRow(selected.value.name, pick.value) },
  restore: { key: 'SEW_LOAD_RESTORE', testid: 'se-load-restore', primary: true, run: () => restore() },
  draft: { key: 'SEW_LOAD_OPEN_DRAFT', testid: 'se-load-open-draft', primary: true, run: () => openDraft() }
}
const footButtons = computed(() => foot.value.buttons.map((b) => ({ ...FOOT_BUTTONS[b.act], primary: b.primary ?? FOOT_BUTTONS[b.act].primary, disabled: !!b.disabled, act: b.act })))

// ── 칸의 쓰기 동작 결과 ──
function onEnabled({ name, isEnabled }) {
  listRows.value = listRows.value.map((r) => (r.name === name ? { ...r, isEnabled, lastOwner: { singleid: store.me?.singleid ?? '', at: formatCrtime(Date.now()), note: null } } : r))
  if (openInfo.value && selected.value?.name === name) edit.markPropertyChanged()
}
function onDraftDeleted(id) {
  drafts.value = drafts.value.filter((d) => d.draftId !== id)
  edit.forgetDraft(id)
  if (pick.value === 'draft') pick.value = null
  if (!selected.value) clearSelection()
  showToast('success', t('SEW_LOAD_DRAFT_DELETED'))
}
// draftDeleted: 내 초안도 함께 지우라고 했을 때만 true(지움)·false(못 지움), 아니면 null
function onDeleted({ draftDeleted = null } = {}) {
  const r = selected.value
  const wasOpen = !!openInfo.value
  sub.value = null
  if (wasOpen) edit.markDeleted()
  listRows.value = listRows.value.filter((x) => x.name !== r.name)
  if (draftDeleted && r.draft) {
    drafts.value = drafts.value.filter((d) => d.draftId !== r.draft.draftId)
    edit.forgetDraft(r.draft.draftId)
  }
  // 초안이 남았으면 그 행은 "초안만 · 원본 지워짐" 으로 남는다
  if (selected.value) selectRow(selected.value)
  else clearSelection()
  if (draftDeleted === false) showToast('info', t('SEW_LOAD_DELETED_DRAFT_KEPT'))
  else if (draftDeleted) showToast('success', t(wasOpen ? 'SEW_LOAD_DELETED_WITH_DRAFT_OPEN' : 'SEW_LOAD_DELETED_WITH_DRAFT'))
  else showToast('success', t(wasOpen ? 'SEW_LOAD_DELETED_OPEN' : 'SEW_LOAD_DELETED'))
}
// 초안만 남은 것 정리 결과: 지운 것만 목록에서 빼고, 못 지운 수를 알린다
function onCleaned({ deleted, failed }) {
  sub.value = null
  const gone = new Set(deleted)
  drafts.value = drafts.value.filter((d) => !gone.has(d.draftId))
  for (const id of deleted) edit.forgetDraft(id)
  if (pick.value === 'draft') pick.value = null
  if (!selected.value) clearSelection()
  if (!deleted.length) showToast('error', t('SEW_LOAD_CLEAN_FAILED'))
  else showToast(failed ? 'info' : 'success', t(failed ? 'SEW_LOAD_CLEAN_PARTIAL' : 'SEW_LOAD_CLEAN_DONE', { n: deleted.length, failed }))
}
async function relist() {
  sub.value = null
  loadCounts()
  await loadList()
  showToast('success', t('SEW_LOAD_RELISTED'))
}
// 지우기 결과 모름 뒤 [목록 다시 읽기]: 남았는지 알린다(남았으면 다시 고른다 — 자동으로 다시 보내지 않는다)
async function relistAfterDelete() {
  const name = selected.value?.name
  sub.value = null
  loadCounts()
  await loadList()
  const still = rows.value.find((r) => r.name === name && !r.draftOnly)
  if (still) selectRow(still)
  showToast(still ? 'info' : 'success', t(still ? 'SEW_LOAD_RELISTED_KEPT' : 'SEW_LOAD_RELISTED_GONE', { name }))
}

// useToast 는 ref 만 준다 — 화면에 그리는 건 아래 <BaseToast>
async function refresh() {
  try {
    await store.refreshCaches()
    loadCounts()
    const before = `${process.value}/${model.value}`
    if (!processes.value.some((p) => p.process === process.value && p.models.some((m) => m.model === model.value))) pickInitial()
    if (`${process.value}/${model.value}` === before) await loadList()
    // refreshCaches 는 내 정보·권한 읽기가 실패해도 던지지 않는다 — 결과 상태로 성공을 가린다
    if (store.meError) showToast('error', store.meError.message)
    else if (!store.scopes) showToast('error', t('SEW_UI_REFRESH_FAILED'))
    else showToast('success', t('SEW_UI_REFRESHED'))
  } catch (e) {
    showToast('error', errorMessage(e))
  }
}

// "내 초안" 칸: 저장 시각 칩(시작한 뒤 새 버전이 배포됐으면 주황)
function renderDraft(p) {
  const d = p.data?.draft
  if (!d) return ''
  const el = document.createElement('span')
  const stale = draftStale(p.data)
  const at = formatCrtime(Date.parse(d.savedAt))
  el.className = `se-load-dchip${stale ? ' am' : ''}`
  el.textContent = at.slice(5, 16)
  el.title = t(stale ? 'SEW_LOAD_DRAFT_CHIP_TITLE_STALE' : 'SEW_LOAD_DRAFT_CHIP_TITLE', { at })
  return el
}
const draftOnlyText = (r) => t(r.draftOnly === 'new' ? 'SEW_LOAD_ROW_DRAFT_NEW' : 'SEW_LOAD_ROW_DRAFT_GONE')
// 열 순서: 데스크톱 불러오기 목록의 NAME·TRIGGER·SCENARIO_TYPE·DESCRIPTION·ACTIVATED·TRIGGERINFO 순서에 스텝 수·용량을 켜짐 뒤에 넣고
// 웹 전용 열(내 초안·최근 수정자·현재 버전·확인 필요)을 둔다. 스텝 수·용량(2026-11-10 사용자 요청)을 넣으면서 폭이 모자라
// 메일 생략·시작 지연·재시도(대부분 빈칸)·등급 열은 뺐다("불필요하다고 판단되는 칼럼은 빼도 되") — 값은 연 뒤 운영 속성 창·위쪽 바에 있고, 서버 응답에는 그대로 있다.
const columnDefs = computed(() => [
  { field: 'name', headerName: '이름', minWidth: 220, flex: 1, cellClass: (p) => (p.data?.draft ? 'se-load-has-draft' : '') },
  ...(writer.value ? [{ field: 'draft', headerName: t('SEW_LOAD_COL_DRAFT'), width: 104, cellRenderer: renderDraft }] : []),
  { field: 'triggerName', headerName: '트리거', width: 84 },
  { field: 'typeName', headerName: '유형', width: 120, valueFormatter: (p) => LABELS.scenarioType[p.value] ?? p.value ?? '' },
  { field: 'description', headerName: '설명', minWidth: 180, flex: 1 },
  // cellDataType: false — AG Grid 가 참거짓 열을 체크 칸으로 그리면 문구(켜짐·꺼짐·초안만 —·같은 키 ?)가 나오지 않는다(목업은 글자)
  { field: 'isEnabled', headerName: '켜짐', width: 66, cellDataType: false, valueFormatter: (p) => (p.data?.draftOnly ? '—' : writer.value && isDup(p.data) ? '?' : enabledLabel(p.value)), cellClass: (p) => (p.data?.draftOnly ? 'se-load-dim' : '') },
  // 현재 버전 파일에서 읽는다 — 현재 버전이 없거나 초안만 있는 줄은 빈칸. 용량은 기준 화면 묶음(GridFS 파일)의 크기다(머리글 풍선말)
  { field: 'stepCount', headerName: t('SEW_LOAD_COL_STEPS'), width: 72, type: 'rightAligned', cellDataType: false, valueFormatter: (p) => (typeof p.value === 'number' ? String(p.value) : '') },
  { field: 'sizeBytes', headerName: t('SEW_LOAD_COL_SIZE'), headerTooltip: t('SEW_LOAD_COL_SIZE_TIP'), width: 88, type: 'rightAligned', cellDataType: false, valueFormatter: (p) => sizeText(p.value) },
  { field: 'triggerInfo', headerName: t('SEW_LOAD_COL_TRIGGER_INFO'), width: 160, tooltipField: 'triggerInfo' },
  { headerName: '최근 수정자', width: 112, valueGetter: (p) => p.data.lastOwner?.singleid ?? '' },
  { field: 'currentCrtime', headerName: '현재 버전', width: 156, valueFormatter: (p) => (p.data?.draftOnly ? t('SEW_LOAD_NONE') : p.value ? formatCrtime(p.value) : ''), cellClass: (p) => (p.data?.draftOnly ? 'se-load-dim' : '') },
  // 열 합계가 창의 표 영역보다 넓다 — 열 수 없는 원인(완료 조건 3)이 가로 스크롤 뒤로 숨지 않게 오른쪽에 고정한다.
  // 칼럼 이름은 "확인 필요"(2026-11-10) — 정상인 줄은 빈칸이고, 목록이 보는 것은 세 가지뿐이라 "정상" 이라고 쓰지 않는다.
  // 열 수 없는 원인(현재 버전 없음·같은 키·해석 실패)은 붉은 글씨, 초안만 있는 줄의 안내는 보통 글씨다.
  { field: 'status', headerName: '확인 필요', width: 132, pinned: 'right', valueFormatter: (p) => (p.data?.draftOnly ? draftOnlyText(p.data) : p.value.map((s) => LABELS.listStatus[s] ?? s).join(', ')),
    cellClass: (p) => (!p.data?.draftOnly && p.data?.status?.length ? 'se-load-bad' : '') }
])
// 창 너비: 화면의 94%, 가장 넓어도 1800 — 1920 화면에서 표 영역(창 − 버전 칸 280)이 1520 이라 열(합계 1494)이 가로로 밀지 않고 다 보인다.
// 1600 화면(표 영역 1224)에서는 최근 수정자·현재 버전을 보려면 가로로 민다(확인 필요는 오른쪽 고정).
const dialogWidth = Math.max(720, Math.min(1800, Math.round(window.innerWidth * 0.94)))
const select = 'h-[38px] rounded-lg border border-gray-300 dark:border-dark-border bg-white dark:bg-dark-bg px-2 text-sm text-gray-900 dark:text-gray-100'
const btnP = 'px-4 py-2 bg-primary-500 hover:bg-primary-600 text-white font-medium rounded-lg transition text-sm disabled:opacity-50 whitespace-nowrap'
const btnS = 'px-4 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg transition text-sm disabled:opacity-50 whitespace-nowrap'
</script>

<template>
  <ModalShell :model-value="modelValue" title="시나리오 불러오기" :width="dialogWidth" :height="600" testid="se-load-dialog" @update:model-value="emit('update:modelValue', $event)">
    <div class="h-full flex flex-col">
      <div class="px-5 py-3 flex flex-wrap gap-2 items-center border-b border-gray-200 dark:border-dark-border">
        <select v-model="process" :class="select" :title="countHint?.tip" data-testid="se-load-process"><option v-for="p in processes" :key="p.process" :value="p.process">{{ p.process }}{{ countText(processCount(p)) }}</option></select>
        <select v-model="model" :class="select" :title="countHint?.tip" data-testid="se-load-model"><option v-for="m in models" :key="m.model" :value="m.model">{{ m.model }}{{ countText(countOf(process, m.model)) }}</option></select>
        <input v-model="search" :class="select" class="w-56" :placeholder="t('SEW_UI_SEARCH_NAME')" data-testid="se-load-search" />
        <label class="text-xs text-gray-600 dark:text-gray-300 flex items-center gap-1"><input v-model="enabledOnly" type="checkbox" data-testid="se-load-enabled" /> {{ t('SEW_UI_ENABLED_ONLY') }}</label>
        <label v-if="writer" class="text-xs text-gray-600 dark:text-gray-300 flex items-center gap-1 whitespace-nowrap" data-testid="se-load-draft-only">
          <input v-model="draftOnly" type="checkbox" /> {{ t('SEW_LOAD_DRAFT_ONLY') }}
          <span class="min-w-[18px] px-1.5 rounded-full text-[11px] font-semibold text-center bg-primary-100 text-primary-800 dark:bg-primary-900/30 dark:text-primary-300" data-testid="se-load-draft-count">{{ draftCount }}</span></label>
        <button v-if="writer && draftOnlyRows.length" type="button" class="h-[30px] px-2.5 rounded-md border border-gray-300 dark:border-dark-border text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 whitespace-nowrap"
          data-testid="se-load-cleanup" @click="sub = 'cleanup'">{{ t('SEW_LOAD_CLEAN_OPEN_BTN', { n: draftOnlyRows.length }) }}</button>
        <span class="text-xs text-gray-500 ml-1">{{ t('SEW_UI_LOAD_SCOPE_HINT') }}<template v-if="countHint"> · <span :title="countHint.tip" data-testid="se-load-count-hint">{{ countHint.text }}</span></template></span>
        <button class="ml-auto h-[38px] px-3 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg text-sm" data-testid="se-load-refresh" @click="refresh">{{ t('SEW_UI_REFRESH_SCOPES') }}</button>
      </div>
      <p v-if="scopesNotice" class="px-5 py-2 text-sm border-b border-gray-200 dark:border-dark-border" :class="scopesNotice.error ? 'text-red-600' : 'text-gray-600 dark:text-gray-300'" data-testid="se-load-scopes-notice">{{ scopesNotice.text }}</p>
      <p v-if="draftsError" class="px-5 py-1.5 text-xs text-red-600 border-b border-gray-200 dark:border-dark-border" data-testid="se-load-drafts-error">{{ draftsError }}</p>
      <div class="flex-1 min-h-0 grid" style="grid-template-columns: minmax(0, 1fr) 280px">
        <div class="min-h-0 flex flex-col border-r border-gray-200 dark:border-dark-border">
          <p v-if="listError" class="p-3 text-sm text-red-600" data-testid="se-load-list-error">{{ listError }}</p>
          <AgGridVue class="flex-1 min-h-0" :theme="theme" :row-data="filtered" :column-defs="columnDefs" :get-row-id="(p) => p.data.name"
            :row-selection="{ mode: 'singleRow', checkboxes: false, enableClickSelection: true }" @row-clicked="onRowClicked" @row-double-clicked="onRowDoubleClicked"
            style="width: 100%; height: 100%" data-testid="se-load-grid" />
        </div>
        <template v-if="writer">
          <LoadPane v-if="selected && loadedFor" :key="`${loadedFor.process}/${loadedFor.model}/${selected.name}`" :process="loadedFor.process" :model="loadedFor.model" :row="selected"
            :versions="versions" :versions-error="versionsError" :pick="pick" :open="openInfo" :draft-open-draft-id="edit.draftId"
            @pick="pick = $event" @open-version="openVersion" @enabled="onEnabled" @draft-deleted="onDraftDeleted" @delete="sub = 'delete'" @relist="relist" @toast="showToast" />
          <div v-else class="p-3 text-xs leading-relaxed text-gray-500" data-testid="se-load-pane-empty">{{ t('SEW_LOAD_PANE_EMPTY') }}</div>
        </template>
        <div v-else class="p-3 flex flex-col min-h-0">
          <div class="text-xs font-semibold text-gray-700 dark:text-gray-200 mb-2">버전 <span v-if="selected" class="font-normal text-gray-500">— {{ selected.name }}</span></div>
          <p v-if="versionsError" class="text-xs text-red-600" data-testid="se-load-versions-error">{{ versionsError }}</p>
          <ul class="flex-1 overflow-auto space-y-1 text-sm" role="listbox">
            <li v-for="v in versions" :key="v.crtime" role="option" :aria-selected="pick === v.crtime" data-testid="se-load-version"
              class="px-2 py-1.5 rounded-md cursor-pointer flex items-center gap-2"
              :class="pick === v.crtime ? 'bg-primary-100 dark:bg-primary-900/30' : 'hover:bg-gray-100 dark:hover:bg-dark-border'"
              @click="pick = v.crtime" @dblclick="openVersionP1(v)">
              <span class="font-mono text-xs text-gray-800 dark:text-gray-200">{{ formatCrtime(v.crtime) }}</span>
              <span v-if="v.isCurrent" class="px-1.5 rounded text-[10px] bg-primary-100 text-primary-800 dark:bg-primary-900/30 dark:text-primary-400">현재</span>
            </li>
          </ul>
          <p class="text-[11px] text-gray-500 mt-2">{{ t('SEW_UI_LOAD_VERSION_HINT') }}</p>
        </div>
      </div>
      <LoadDelete v-if="sub === 'delete' && selected && loadedFor" :process="loadedFor.process" :model="loadedFor.model" :row="selected" :version-count="versions.length"
        :eqp-count="eqpCount" :open="openInfo" @deleted="onDeleted" @relist="relistAfterDelete" @close="sub = null" />
      <LoadDraftCleanup v-if="sub === 'cleanup' && loadedFor" :process="loadedFor.process" :model="loadedFor.model" :rows="draftOnlyRows" :open-draft-id="edit.draftId"
        @done="onCleaned" @close="sub = null" />
      <LoadDraftChoice v-if="sub === 'choice' && selected?.draft" :row="selected" :model="loadedFor.model"
        @draft="openDraft" @current="sub = null; openRow(selected.name)" @close="sub = null" />
      <BaseToast :toast="toast" />
    </div>
    <template #footer>
      <template v-if="writer">
        <div class="flex-1 min-w-0 mr-2 self-center text-xs leading-snug text-gray-500 dark:text-gray-400" data-testid="se-load-foot">
          <b v-if="foot.lead" class="font-medium text-gray-700 dark:text-gray-200">{{ foot.lead }}</b>{{ foot.text }}</div>
        <button v-for="b in footButtons" :key="b.act" :class="b.primary ? btnP : btnS" :disabled="b.disabled" :data-testid="b.testid" @click="b.run">{{ t(b.key) }}</button>
      </template>
      <button v-else class="px-4 py-2 bg-primary-500 hover:bg-primary-600 text-white font-medium rounded-lg transition text-sm disabled:opacity-50" :disabled="!selected" data-testid="se-load-open"
        @click="openSelected">열기</button>
    </template>
  </ModalShell>
</template>

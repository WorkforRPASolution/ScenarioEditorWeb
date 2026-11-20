<script setup>
// 새 시나리오 창(P2-D Task 6, 설계 §6.8·§11, 분석 10 §3, 목업 2026-11-08-new-scenario-v1 — 2026-11-09 확인).
// 공정은 열린 시나리오의 공정을 미리 고르되 바꿀 수 있다. 이름은 이름 규칙(editor/nameRule)대로. 이미 있는 이름(고른 공정·모델의
// 운영 속성 문서, 글자 그대로)은 막고 [그 시나리오 열기]. 같은 새 ID 의 내 초안은 [초안 이어서 열기]를 권한다.
// [만들기]는 서버에 아무것도 보내지 않고 editStore.beginNew 로 빈 작업본을 연다. 저장 전 변경이 있으면 [만들기]·[그 시나리오 열기] 때
// 돌아가기·버리고·초안 저장하고 중에서 묻는다(40 §2.0 2026-11-09 ④).
import { ref, reactive, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import { useEditorStore } from '../stores/editorStore'
import { useEditStore } from '../stores/editStore'
import { useSaveFlow, failCause } from '../stores/saveFlow'
import { scenarioEditorApi as api } from '../api'
import { t, LABELS, errorMessage } from '../messages'
import { formatCrtime, enabledLabel, scenarioTypeOptions } from '../format'
import { nameRuleOf, NAME_MAX, PART3_MIN, isFreeHead } from '../editor/nameRule'
import { typeName } from '../editor/propertyView'
import { DEFAULT_TIMEOUT, newScenarioId, checkNewScenario, newName, issueKey, humanMinutes, NAME_FIELDS as NAME_FIELD_LIST } from '../editor/newScenario'
import ModalShell from './ModalShell.vue'
import NewScenarioName from './newScenario/NewScenarioName.vue'
import NewScenarioAfter from './newScenario/NewScenarioAfter.vue'
import './panel/panel.css'
import './save/save.css'
import './newScenario/new-scenario.css'

defineOptions({ name: 'NewScenarioDialog' })
const props = defineProps({ modelValue: Boolean })
// open-draft = [초안 이어서 열기]({ draftId, process, model, name, savedAt }) — 초안을 여는 일은 부모 몫
const emit = defineEmits(['update:modelValue', 'open-draft'])
const store = useEditorStore()
const edit = useEditStore()
const flow = useSaveFlow()
const F = LABELS.newScenario.fields
const NAME_FIELDS = new Set(NAME_FIELD_LIST)

const blank = () => ({ process: '', model: '', type: 0, major: '', middle: '', part3: '', part4: '', name: '', description: '', timeoutLimit: DEFAULT_TIMEOUT })
const form = reactive(blank())
const touched = reactive(new Set()) // 손댄 칸(입력·고르기·초점 떠남) — 빈 칸은 손댄 뒤에만 빨갛게
const openProcess = ref('') // 열린 시나리오에서 미리 고른 공정

const processes = computed(() => store.scopes?.processes ?? [])
const models = computed(() => processes.value.find((p) => p.process === form.process)?.models ?? [])

// ── 이름 규칙: undefined = 읽는 중, null = 규칙 없음(직접 입력). 못 읽으면 이름을 만들 수 없다(규칙을 건너뛰지 않게) ──
const rule = ref(undefined)
const ruleError = ref('')
let ruleSeq = 0
async function loadRule() {
  const my = ++ruleSeq
  rule.value = undefined
  ruleError.value = ''
  try {
    const r = nameRuleOf((await api.nameRule()).data.data)
    if (my === ruleSeq) rule.value = r
  } catch (e) {
    if (my === ruleSeq) ruleError.value = errorMessage(e)
  }
}
const nameMode = computed(() => (ruleError.value ? 'failed' : rule.value === undefined ? 'loading' : rule.value ? 'rule' : 'direct'))
const nameKnown = computed(() => nameMode.value === 'rule' || nameMode.value === 'direct')

// ── 고른 공정·모델의 이름 목록(P1 목록 API = 운영 속성 문서)과 내 초안. 쌍이 바뀔 때마다 다시 읽는다 ──
const rows = ref(null)
const drafts = ref([])
const namesState = ref('idle') // idle | loading | ok | failed
const namesError = ref('')
let namesSeq = 0
async function loadNames() {
  const my = ++namesSeq
  rows.value = null
  drafts.value = []
  namesError.value = ''
  const { process, model } = form
  if (!process || !model) { namesState.value = 'idle'; return }
  namesState.value = 'loading'
  const [l, d] = await Promise.allSettled([api.list(process, model), api.listDrafts(process, model)])
  if (my !== namesSeq) return
  if (l.status === 'fulfilled') {
    rows.value = Array.isArray(l.value.data.data) ? l.value.data.data : []
    namesState.value = 'ok'
  } else {
    namesError.value = errorMessage(l.reason)
    namesState.value = 'failed'
  }
  drafts.value = d.status === 'fulfilled' && Array.isArray(d.value.data.data) ? d.value.data.data : [] // 초안 목록은 못 읽어도 권하지 않을 뿐
}
watch([() => form.process, () => form.model], loadNames)

// ── 검사 ──
// 이름 규칙을 읽기 전에는 이름 칸을 검사하지 않는다(어느 규칙인지 모른다)
const issues = computed(() => checkNewScenario(form, { rule: rule.value || null }).filter((i) => nameKnown.value || !NAME_FIELDS.has(i.field)))
const shown = computed(() => issues.value.filter((i) => !i.empty || touched.has(i.field)))
const name = computed(() => (nameKnown.value ? newName(form, rule.value) : ''))
const nameOk = computed(() => !!name.value && !issues.value.some((i) => NAME_FIELDS.has(i.field)))
const exists = computed(() => {
  if (namesState.value !== 'ok' || !nameOk.value) return null
  const row = rows.value.find((r) => r.name === name.value)
  if (!row) return null
  const sk = store.skeleton
  return { row, isOpen: !!sk && !sk.isNew && sk.process === form.process && sk.model === form.model && sk.name === row.name }
})
const existsText = computed(() => {
  const x = exists.value
  if (!x) return ''
  if (x.isOpen) return t('SEW_NEW_EXISTS_IS_OPEN')
  const r = x.row
  return t('SEW_NEW_EXISTS', {
    model: form.model, state: enabledLabel(r.isEnabled), type: r.type == null ? LABELS.enabled.unknown : typeName(r.type),
    version: r.currentCrtime != null ? t('SEW_NEW_EXISTS_VERSION', { crtime: formatCrtime(r.currentCrtime) }) : LABELS.listStatus.NO_CURRENT_VERSION
  })
})
const draft = computed(() => (namesState.value === 'ok' && nameOk.value && !exists.value ? drafts.value.find((d) => d.name === name.value) ?? null : null))
const draftTime = computed(() => { const ms = draft.value ? new Date(draft.value.savedAt).getTime() : NaN; return Number.isFinite(ms) ? formatCrtime(ms).slice(0, 16) : '' })

// 칸 아래 줄: 오류(문구 키 issueKey) 또는 도움말
const free = computed(() => isFreeHead(form.major, form.middle))
const timeoutNum = computed(() => (/^[1-9][0-9]*$/.test(form.timeoutLimit) ? Number(form.timeoutLimit) : null))
const HINTS = {
  process: () => t(form.process && form.process === openProcess.value ? 'SEW_NEW_PROCESS_FROM_OPEN' : 'SEW_NEW_PROCESS_HINT'),
  type: () => t('SEW_NEW_TYPE_HINT'),
  part3: () => (free.value ? t('SEW_NEW_PART_FREE') : t('SEW_NEW_PART3_HINT', { min: PART3_MIN })),
  part4: () => t('SEW_NEW_PART_FREE'),
  name: () => (nameMode.value === 'direct' ? t('SEW_NEW_NAME_HINT', { max: NAME_MAX }) : ''),
  description: () => t('SEW_NEW_MAIL_HINT'),
  timeoutLimit: () => (timeoutNum.value === null ? '' : t(timeoutNum.value === Number(DEFAULT_TIMEOUT) ? 'SEW_NEW_TIMEOUT_IS_DEFAULT' : 'SEW_NEW_TIMEOUT_DEFAULT'))
}
function msg(field) {
  const e = shown.value.find((i) => i.field === field)
  return e ? { text: t(issueKey(e), e.params), error: true } : { text: HINTS[field]?.() ?? '', error: false }
}
const humanTimeout = computed(() => (timeoutNum.value !== null && timeoutNum.value >= 60 ? t('SEW_NEW_TIMEOUT_HUMAN', { text: humanMinutes(timeoutNum.value) }) : ''))
const typeText = computed(() => (form.type ? typeName(form.type) : ''))
const idParts = computed(() => [[form.process, F.process], [form.model, F.model], [name.value, F.name]].map(([v, ph]) => (v ? { text: v } : { text: ph, ph: true })))

// 바닥 줄(목업 우선순위): 고칠 곳 > 이름 규칙 못 읽음 > 같은 이름 > 채울 칸 > 같은 이름 확인 중·실패 > 만들 수 있음
const foot = computed(() => {
  const s = shown.value
  if (s.length) return { tone: 'bad', head: t('SEW_NEW_FOOT_FIX', { n: s.length }), tail: [...new Set(s.map((i) => F[i.field]))].join(', ') }
  if (!nameKnown.value) return { tone: '', tail: t('SEW_NEW_FOOT_RULE') }
  if (exists.value) return { tone: 'am', head: t('SEW_NEW_FOOT_EXISTS'), tail: exists.value.isOpen ? '' : t('SEW_NEW_FOOT_EXISTS_HOW'), sep: ' ' }
  const missing = [...new Set(issues.value.filter((i) => i.empty && !touched.has(i.field)).map((i) => (NAME_FIELDS.has(i.field) ? F.name : F[i.field])))]
  if (missing.length) return { tone: '', tail: `${form.process ? '' : `${t('SEW_NEW_FOOT_PICK_FIRST')} `}${t('SEW_NEW_FOOT_MISSING', { list: missing.join(' · ') })}` }
  if (namesState.value === 'failed') return { tone: 'bad', tail: t('SEW_NEW_FOOT_NAMES_FAILED') }
  if (namesState.value !== 'ok') return { tone: '', tail: t('SEW_NEW_NAMES_CHECKING') }
  return { tone: 'ok', head: t('SEW_NEW_FOOT_OK') }
})

// ── 저장 전 변경 확인(목업 cf) — 만들기·그 시나리오 열기가 함께 쓴다 ──
const unsaved = computed(() => edit.unsavedCount)
const openName = computed(() => store.skeleton?.name ?? '')
const unsavedText = computed(() => (unsaved.value ? t('SEW_NEW_UNSAVED_WARN', { name: openName.value, n: unsaved.value }) : ''))
const confirm = ref(null) // { verb: 'create' | 'open' }
const cfBusy = ref(false)
const cfError = ref('')
let pendingGo = null
const backEl = ref(null)
const createEl = ref(null)
// 확인 창이 뜨면 [돌아가기]에 초점(Esc 와 같은 갈래), 돌아가면 [만들기]로
function leaveThen(verb, go) {
  if (!unsaved.value) { go(false); return }
  pendingGo = go
  cfError.value = ''
  confirm.value = { verb }
  nextTick(() => backEl.value?.focus())
}
function cfBack() { if (cfBusy.value) return; confirm.value = null; pendingGo = null; nextTick(() => createEl.value?.focus()) }
function cfDrop() { const go = pendingGo; confirm.value = null; pendingGo = null; go?.(false) }
async function cfDraft() {
  if (cfBusy.value) return
  const verb = confirm.value?.verb
  cfBusy.value = true
  cfError.value = ''
  try {
    await flow.draftCurrent()
  } catch (e) {
    const cause = failCause(e, { steps: edit.session?.working?.steps, draft: true })
    cfError.value = t(verb === 'open' ? 'SEW_NEW_DRAFT_FAILED_OPEN' : 'SEW_NEW_DRAFT_FAILED_CREATE', { cause })
    return
  } finally {
    cfBusy.value = false
  }
  const go = pendingGo
  confirm.value = null
  pendingGo = null
  go?.(true)
}

const canCreate = computed(() => foot.value.tone === 'ok' && !confirm.value)
const close = () => { if (!cfBusy.value) emit('update:modelValue', false) }

function create() {
  if (!canCreate.value) return
  const params = { process: form.process, model: form.model, name: name.value, type: form.type, description: form.description, timeoutLimit: form.timeoutLimit }
  leaveThen('create', (drafted) => {
    const prev = openName.value
    // 만들지 못하면 창을 남기고 알린다 — 앞 시나리오를 초안으로 저장했으면 그 사실도(SEW-023)
    if (!edit.beginNew(params)) { edit.notify(drafted ? t('SEW_NEW_CREATE_FAILED_DRAFT', { prev }) : t('SEW_NEW_CREATE_FAILED')); return }
    edit.notify(drafted ? t('SEW_NEW_MADE_DRAFT', { prev }) : t('SEW_NEW_MADE'))
    close()
  })
}
function openExisting() {
  const x = exists.value
  if (!x || x.isOpen) return
  const target = { process: form.process, model: form.model, name: x.row.name, crtime: 'current' }
  leaveThen('open', async (drafted) => {
    const prev = openName.value
    close()
    await store.openScenario(target)
    // 열지 못한 까닭은 가운데 화면이 알린다 — 앞 시나리오를 초안으로 저장해 두었다는 것은 여기서(SEW-023)
    if (drafted) edit.notify(t(store.openError ? 'SEW_NEW_OPEN_FAILED_DRAFT' : 'SEW_NEW_OPENED_DRAFT', { prev, name: target.name }))
  })
}
// 초안 열기는 부모가 맡는다(초안을 여는 길이 저장 전 변경을 다시 묻는다)
function openDraft() {
  const d = draft.value
  if (!d) return
  emit('open-draft', { ...d, process: form.process, model: form.model, name: name.value })
  close()
}

// ── 입력 ──
function set(field, value) {
  form[field] = field === 'type' ? Number(value) : value
  touched.add(field)
}
function setProcess(value) {
  form.process = value
  form.model = ''
  touched.add('process')
  touched.delete('model')
}
const touch = (field) => touched.add(field)

// 창을 열 때마다 빈 값에서 시작한다. 공정은 열린 시나리오의 것(내 권한 안이면), 초점은 첫 빈 칸.
const rootEl = ref(null)
function focusFirst() {
  const els = [...(rootEl.value?.querySelectorAll('[data-nfield]') ?? [])].filter((el) => !el.disabled)
  const el = els.find((x) => x.value === '' || (x.dataset.nfield === 'type' && x.value === '0')) ?? els[0]
  el?.focus()
}
watch(() => props.modelValue, (open) => {
  if (!open) { confirm.value = null; pendingGo = null; return }
  Object.assign(form, blank())
  touched.clear()
  const p = store.skeleton?.process
  form.process = p && processes.value.some((x) => x.process === p) ? p : ''
  openProcess.value = form.process
  confirm.value = null
  cfError.value = ''
  loadRule()
  loadNames()
  nextTick(focusFirst)
}, { immediate: true })

// Esc = 취소, 확인 창이 떠 있으면 돌아가기(목업 "내가 정한 것" 15). 확인 창이 떠 있으면 Tab 은 그 단추 안에서만 돈다(SEW-023).
function onKey(e) {
  if (!props.modelValue) return
  if (e.key === 'Tab' && confirm.value) { trapTab(e); return }
  if (e.key !== 'Escape') return
  if (confirm.value) cfBack()
  else close()
}
function trapTab(e) {
  const box = rootEl.value?.querySelector('.se-ns-cf')
  const els = [...(box?.querySelectorAll('button') ?? [])].filter((x) => !x.disabled)
  if (!els.length) return
  const first = els[0]
  const last = els[els.length - 1]
  const at = document.activeElement
  if (!box.contains(at)) { e.preventDefault(); (e.shiftKey ? last : first).focus() }
  else if (e.shiftKey && at === first) { e.preventDefault(); last.focus() }
  else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus() }
}
watch(() => props.modelValue, (open) => (open ? document.addEventListener('keydown', onKey) : document.removeEventListener('keydown', onKey)), { immediate: true })
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
</script>

<template>
  <ModalShell :model-value="modelValue" :title="t('SEW_NEW_TITLE')" :width="760" :height="850" :closable="!cfBusy" testid="se-new-dialog"
    @update:model-value="(v) => { if (!v) close() }">
    <div ref="rootEl" class="se-ns">
      <div class="se-ns-body">
        <div class="se-ns-t">{{ t('SEW_NEW_WHERE') }}</div>
        <div v-if="!processes.length" class="se-sv-note fa mb-2" role="alert">{{ store.scopes ? t('SEW_UI_LOAD_NO_SCOPES') : t('SEW_NEW_SCOPES_FAILED') }}</div>
        <div class="se-ns-row2">
          <div class="se-ns-f">
            <div class="se-ns-lbl">{{ F.process }}</div>
            <select class="se-inp" :class="{ 'se-inp-bad': msg('process').error }" :value="form.process" data-nfield="process" :aria-label="F.process" data-testid="se-new-process"
              @change="setProcess($event.target.value)" @blur="touch('process')">
              <option value="">{{ t('SEW_SAVE_MODEL_PICK') }}</option>
              <option v-for="p in processes" :key="p.process" :value="p.process">{{ p.process }}</option>
            </select>
            <div class="se-ns-msg" :class="{ err: msg('process').error }" data-testid="se-new-msg-process">{{ msg('process').text }}</div>
          </div>
          <div class="se-ns-f">
            <div class="se-ns-lbl">{{ F.model }}</div>
            <select class="se-inp" :class="{ 'se-inp-bad': msg('model').error }" :value="form.model" :disabled="!form.process" data-nfield="model" :aria-label="F.model" data-testid="se-new-model"
              @change="set('model', $event.target.value)" @blur="touch('model')">
              <template v-if="form.process">
                <option value="">{{ t('SEW_SAVE_MODEL_PICK') }}</option>
                <option v-for="m in models" :key="m.model" :value="m.model">{{ t('SEW_SAVE_MODEL_OPTION', { model: m.model, n: m.eqpCount }) }}</option>
              </template>
              <option v-else value="">{{ t('SEW_NEW_MODEL_WAIT') }}</option>
            </select>
            <div class="se-ns-msg" :class="{ err: msg('model').error }" data-testid="se-new-msg-model">{{ msg('model').text }}</div>
          </div>
        </div>
        <NewScenarioName :mode="nameMode" :rule="rule || null" :rule-error="ruleError" :form="form" :msg="msg" @set="set" @touch="touch" @retry="loadRule" />
        <div class="se-ns-id">
          <span class="se-ns-k">{{ t('SEW_NEW_ID') }}</span>
          <span class="se-ns-v" data-testid="se-new-id"><template v-for="(p, i) in idParts" :key="i"><template v-if="i">-</template><span :class="{ 'se-ns-ph': p.ph }">{{ p.text }}</span></template></span>
          <span class="se-ns-lock"><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" /></svg>{{ t('SEW_NEW_ID_LOCK') }}</span>
        </div>
        <div v-if="exists" class="se-sv-note am" role="status" data-testid="se-new-exists">
          {{ existsText }}
          <div v-if="!exists.isOpen && exists.row.currentCrtime != null" class="se-ns-acts">
            <button type="button" class="se-sv-btn" data-testid="se-new-exists-open" @click="openExisting">{{ t('SEW_NEW_EXISTS_OPEN') }}</button>
          </div>
        </div>
        <div v-else-if="namesState === 'failed' && nameOk" class="se-sv-note fa" role="alert" data-testid="se-new-names-failed">
          {{ t('SEW_NEW_NAMES_FAILED', { cause: namesError }) }}
          <div class="se-ns-acts"><button type="button" class="se-sv-btn" data-testid="se-new-names-retry" @click="loadNames">{{ t('SEW_NEW_NAMES_RETRY') }}</button></div>
        </div>
        <div v-else-if="draft" class="se-sv-note" role="status" data-testid="se-new-draft">
          {{ t('SEW_NEW_DRAFT_FOUND', { time: draftTime }) }}
          <div class="se-ns-acts"><button type="button" class="se-sv-btn p" data-testid="se-new-draft-open" @click="openDraft">{{ t('SEW_NEW_DRAFT_OPEN') }}</button></div>
        </div>

        <div class="se-ns-t next">{{ t('SEW_NEW_VALUES') }}</div>
        <div class="se-ns-rowtm">
          <div class="se-ns-f">
            <div class="se-ns-lbl">{{ F.type }}</div>
            <select class="se-inp" :class="{ 'se-inp-bad': msg('type').error }" :value="form.type" data-nfield="type" :aria-label="F.type" data-testid="se-new-type"
              @change="set('type', $event.target.value)" @blur="touch('type')">
              <option v-if="!form.type" :value="0">{{ t('SEW_SAVE_MODEL_PICK') }}</option>
              <option v-for="[v, label] in scenarioTypeOptions" :key="v" :value="v">{{ label }}</option>
            </select>
            <div class="se-ns-msg" :class="{ err: msg('type').error }" data-testid="se-new-msg-type">{{ msg('type').text }}</div>
          </div>
          <div class="se-ns-f">
            <div class="se-ns-lbl">{{ F.timeoutLimit }}</div>
            <div class="se-ns-tm">
              <input class="se-inp se-ns-tm-in" :class="{ 'se-inp-bad': msg('timeoutLimit').error }" :value="form.timeoutLimit" inputmode="numeric" data-nfield="timeoutLimit" :aria-label="F.timeoutLimit"
                data-testid="se-new-timeout" @input="set('timeoutLimit', $event.target.value)" @blur="touch('timeoutLimit')" />
              <span>{{ t('SEW_BAR_MINUTES_UNIT') }}</span>
              <span class="se-ns-k" data-testid="se-new-timeout-human">{{ humanTimeout }}</span>
            </div>
            <div class="se-ns-msg" :class="{ err: msg('timeoutLimit').error }" data-testid="se-new-msg-timeoutLimit">{{ msg('timeoutLimit').text }}</div>
          </div>
        </div>
        <div class="se-ns-f">
          <div class="se-ns-lbl">{{ F.description }}</div>
          <input class="se-inp" :class="{ 'se-inp-bad': msg('description').error }" :value="form.description" :placeholder="t('SEW_BAR_MAIL_TITLE_PLACEHOLDER')" autocomplete="off" data-nfield="description"
            :aria-label="F.description" data-testid="se-new-mail" @input="set('description', $event.target.value)" @blur="touch('description')" />
          <div class="se-ns-msg" :class="{ err: msg('description').error }" data-testid="se-new-msg-description">{{ msg('description').text }}</div>
        </div>
        <NewScenarioAfter :type-text="typeText" :unsaved="unsavedText" />
      </div>
      <div class="se-ns-foot">
        <div class="se-ns-foot-t" data-testid="se-new-foot"><b v-if="foot.head" :class="foot.tone">{{ foot.head }}</b><template v-if="foot.head && foot.tail">{{ foot.sep ?? ' · ' }}</template><span :class="foot.head ? '' : foot.tone">{{ foot.tail }}</span></div>
        <button type="button" class="se-sv-btn" data-testid="se-new-cancel" @click="close">{{ t('SEW_NEW_CANCEL') }}</button>
        <button ref="createEl" type="button" class="se-sv-btn p" :disabled="!canCreate" data-testid="se-new-create" @click="create">{{ t('SEW_NEW_CREATE') }}</button>
      </div>
      <div v-if="confirm" class="se-ns-cf-dim" data-testid="se-new-cf">
        <section class="se-ns-cf" role="alertdialog" aria-modal="true" aria-labelledby="se-ns-cf-t" aria-describedby="se-ns-cf-d">
          <h4 id="se-ns-cf-t">{{ t('SEW_NEW_CF_TITLE') }}</h4>
          <p id="se-ns-cf-d">{{ t(confirm.verb === 'open' ? 'SEW_NEW_CF_BODY_OPEN' : 'SEW_NEW_CF_BODY_CREATE', { name: openName, n: unsaved }) }}</p>
          <p v-if="cfError" class="err" role="alert" data-testid="se-new-cf-error">{{ cfError }}</p>
          <div class="se-ns-cf-f">
            <button ref="backEl" type="button" class="se-sv-btn" :disabled="cfBusy" data-testid="se-new-cf-back" @click="cfBack">{{ t('SEW_NEW_CF_BACK') }}</button>
            <button type="button" class="se-sv-btn" :disabled="cfBusy" data-testid="se-new-cf-drop" @click="cfDrop">{{ t(confirm.verb === 'open' ? 'SEW_NEW_CF_DROP_OPEN' : 'SEW_NEW_CF_DROP_CREATE') }}</button>
            <button type="button" class="se-sv-btn p" :disabled="cfBusy" data-testid="se-new-cf-draft" @click="cfDraft">{{ cfBusy ? t('SEW_NEW_CF_SAVING') : t(confirm.verb === 'open' ? 'SEW_NEW_CF_DRAFT_OPEN' : 'SEW_NEW_CF_DRAFT_CREATE') }}</button>
          </div>
        </section>
      </div>
    </div>
  </ModalShell>
</template>

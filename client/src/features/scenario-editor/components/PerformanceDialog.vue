<script setup>
// 성과 입력 창(P2-D Task 5, 설계 §7, 목업 2026-11-08-performance-v1). 시나리오 하나의 성과를 고쳐 바로 쓴다 — 설비 배포와 상관없다.
// 위 심의 띠·왼쪽 성과·오른쪽 원개발자와 같은 이름 모델. 원개발자도 창 안 작업본에서만 고치고 [성과 저장]이 한 요청으로 보낸다(DC-137).
// 저장 전에는 서버에 아무것도 가지 않고, 바꾼 채 닫으면(✕·[닫기]·Esc·바깥) 버릴지 묻는다. 저장해도 창은 남아 서버가 돌려준 값과
// 모델별 결과를 보인다(DC-138·SE-033) — 운영 속성 창의 성과 표시도 같은 값으로(editorStore.setPerformance).
// 검사는 서버와 같은 code(editor/performanceRules). 손댄 칸부터 빨갛게, 손대지 않은 빈 필수 칸은 바닥 줄 "채울 곳 N개" 로만.
// 관리 등급 1·2 면 열린다 — WRITE·편집 모드·옛 버전은 보지 않는다(설계 §3). 조각들은 provide('sePerformanceCtx') 로 같은 값을 본다.
import { ref, reactive, computed, provide, watch, nextTick, onBeforeUnmount } from 'vue'
import { useEditorStore } from '../stores/editorStore'
import { useEditStore } from '../stores/editStore'
import { scenarioEditorApi as api } from '../api'
import { t, LABELS, errorCode, errorMessage } from '../messages'
import { isReviewer } from '../editor/permissions'
import { isPerformanceComplete, missingOf, checkPerformanceForm, atOf, groupOf } from '../editor/performanceRules'
import { formOf, savedFields, payloadOf, sentFields, changesOf, devsChanged as devsDiffer, citizenDevelopersOf, sdwtOf } from '../editor/performanceForm'
import ModalShell from './ModalShell.vue'
import PerformanceBand from './performance/PerformanceBand.vue'
import PerformanceEffects from './performance/PerformanceEffects.vue'
import PerformanceDevelopers from './performance/PerformanceDevelopers.vue'
import PerformanceSameName from './performance/PerformanceSameName.vue'
import './property/property.css'
import './performance/performance.css'

defineOptions({ name: 'PerformanceDialog' })
const props = defineProps({ modelValue: Boolean })
const emit = defineEmits(['update:modelValue'])
const store = useEditorStore()
const edit = useEditStore()
const L = LABELS.perf

const source = computed(() => edit.session?.source ?? null)
const allowed = computed(() => isReviewer(store.me) && !!source.value)

// 저장된 값(창을 열 때·저장 뒤 서버가 돌려준 값)과 작업본. init = 창을 연(저장한) 때의 작업본 — "바뀐 것" 의 기준.
const savedView = ref(null)
const saved = ref(savedFields(null))
const init = ref(formOf(null))
const form = ref(formOf(null))
const reg = ref({}) // 아이디 → 등록 사용자인가(모르면 없음 = 등록으로 본다, 서버가 저장 때 다시 본다)
function load(view) {
  savedView.value = view ?? null
  saved.value = savedFields(view)
  init.value = formOf(view)
  form.value = formOf(view)
}

const touched = reactive(new Set())
const serverBlocks = ref([]) // 422 VALIDATION_FAILED 가 돌려준 막힘 — 다음에 고칠 때까지 보인다
const saving = ref(false)
const saveError = ref('')
const savedAt = ref('')
const results = ref(null)
const resultsAt = ref('')
const also = ref([])
const models = ref(null)
const modelsFailed = ref(false)
const leaving = ref(false)

const devsChanged = computed(() => devsDiffer(init.value, form.value))
const payload = computed(() => payloadOf(form.value, saved.value))
const checks = computed(() => checkPerformanceForm(form.value, {
  savedTrigger: saved.value.Trigger, registered: (id) => reg.value[id] !== false, devsChanged: devsChanged.value
}))
const sameIssue = (a, b) => a.code === b.code && atOf(a) === atOf(b)
const errors = computed(() => [
  ...checks.value.map((e) => ({ ...e, at: atOf(e) })),
  ...serverBlocks.value.filter((b) => !checks.value.some((c) => sameIssue(c, b))).map((b) => ({ ...b, at: atOf(b), server: true }))
])
// 원개발자 자리는 늘 보인다(고쳤을 때만 검사하므로), 나머지는 손댄 칸·서버가 막은 칸만
const visible = (e) => e.server || groupOf(e.at) === 'devs' || touched.has(groupOf(e.at))
const errorAts = computed(() => [...new Set(errors.value.map((e) => e.at))])
const anyVisible = computed(() => errors.value.some(visible))
const changes = computed(() => changesOf(init.value, form.value, saved.value))
const dirty = computed(() => changes.value.length > 0)
// 사용자가 손댄 것 — 창이 골라 둔 값(implicit)만 있으면 닫을 때 묻지 않는다(닫아도 잃는 것이 없다)
const touchedChanges = computed(() => changes.value.some((c) => !c.implicit))
const sent = computed(() => sentFields(form.value, saved.value))
const canSave = computed(() => allowed.value && !saving.value && !errors.value.length && dirty.value)
const done = computed(() => isPerformanceComplete(payload.value))
const savedDone = computed(() => isPerformanceComplete(saved.value))
const missingText = computed(() => missingOf(payload.value).map((k) => L.missing[k]).join(' · '))

// 작업본 고치기 — 손댄 칸 묶음을 적고, 서버가 막은 표시·저장 실패 문구는 지운다
function edited(group) {
  if (group) touched.add(group)
  serverBlocks.value = []
  saveError.value = ''
}
const f = () => form.value
const ctx = reactive({
  f: computed(() => form.value), init, saved, savedView, reg, also, models, modelsFailed, results, resultsAt, saving,
  devsChanged, me: computed(() => store.me?.singleid ?? ''),
  key: computed(() => source.value ?? { process: '', model: '', name: '' }),
  sharedKeys: computed(() => Object.keys(sent.value)),
  errorsAt: (at) => errors.value.filter((e) => e.at === at && visible(e)),
  hasErr: (at) => errors.value.some((e) => e.at === at && visible(e)),
  setField: (key, value, group = key) => { f()[key] = value; edited(group) },
  setType: (v) => { f().type = v; edited() },
  setGroup: (v) => { f().group = String(v).toUpperCase(); edited('group') },
  // 사고 유형을 바꾸면 사고 정보를 비우고 다시 고르게 한다(옛 값도 사라진다)
  setAcc: (v) => { f().acc = v; f().accInfo = ''; touched.add('effects'); edited(v ? 'accInfo' : null) },
  setEffOn: (k, on) => { f().eff[k] = { on, v: on ? f().eff[k].v : '' }; touched.add('effects'); edited(`eff:${k}`) },
  setEffV: (k, v) => { f().eff[k].v = v; edited(`eff:${k}`) },
  setDevP: (i, v) => { f().devs[i].p = v; edited() },
  addDev: (u) => { f().devs.push({ id: u.singleid, name: u.name, sdwt: sdwtOf(u.process), p: '' }); reg.value[u.singleid] = true; edited() },
  removeDev: (i) => { f().devs.splice(i, 1); edited() },
  // 뒤 줄을 같은 사람의 첫 줄에 합친다(기여도를 더함). 합친 줄 번호를 돌려준다.
  mergeDev: (i) => {
    const d = f().devs[i]
    const j = f().devs.findIndex((x) => x.id === d.id)
    const num = (p) => (/^\d+$/.test(String(p).trim()) ? Number(String(p).trim()) : 0)
    f().devs[j].p = String(num(f().devs[j].p) + num(d.p))
    f().devs.splice(i, 1)
    edited()
    return j
  },
  toggleAlso: (m, on) => { also.value = on ? [...also.value.filter((x) => x !== m), m] : also.value.filter((x) => x !== m); results.value = null },
  focus: (key) => focusPf(key)
})
provide('sePerformanceCtx', ctx)

// 초점: data-pf 자리. 바닥 줄 칸 이름 → 그 칸(효과는 체크했으면 값 칸, 아니면 체크 상자)
const rootEl = ref(null)
const closeEl = ref(null)
const keepEl = ref(null)
function focusPf(key) {
  const el = rootEl.value?.querySelector(`[data-pf="${CSS.escape(key)}"]`)
  if (!el || el.disabled) return
  if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' })
  el.focus()
}
function focusKeyOf(at) {
  if (at.startsWith('eff:')) { const k = at.slice(4); return form.value.eff[k]?.on ? `effv:${k}` : `effon:${k}` }
  if (at.startsWith('dev:')) return `devdel:${at.slice(4)}`
  return { grade: `grade:${form.value.grade}`, effects: 'effon:ManWorkLoss', devs: 'devp:0' }[at] ?? at
}
async function goto(at) {
  touched.add(groupOf(at))
  await nextTick()
  focusPf(focusKeyOf(at))
}
function atLabel(at) {
  const devName = (i) => { const d = form.value.devs[Number(i)]; return d ? d.name || d.id : '' }
  if (at.startsWith('eff:')) return L.effectNames[at.slice(4)] ?? at
  if (at.startsWith('devp:')) return t('SEW_PERF_DEV_PCT', { name: devName(at.slice(5)) })
  if (at.startsWith('dev:')) return t('SEW_PERF_AT_DEV', { name: devName(at.slice(4)) })
  return L.at[at] ?? at
}

// 바닥 줄 "바뀐 것": 칸 이름(값을 보일 수 있으면 이전 → 지금)
const EFFECT_FIELDS = new Set(['ManWorkLoss', 'EqpStopLoss', 'WaferLoss', 'InvestCostLoss'])
function valueText(key, v) {
  if (key === 'Grade') return LABELS.prop.grades[v] ?? String(v)
  if (key === 'Trigger') return L.triggers[v] ?? String(v)
  if (key === 'PerformType') return L.performTypes[v] ?? String(v)
  if (key === 'AccidentType') return L.accidents[v] ?? String(v)
  if (EFFECT_FIELDS.has(key)) return Number.isNaN(v) ? '?' : v === 0 ? L.none : String(v)
  return null
}
const changeText = (c) => {
  const a = c.key === 'CitizenDeveloper' ? null : valueText(c.key, c.from)
  const b = c.key === 'CitizenDeveloper' ? null : valueText(c.key, c.to)
  const text = a !== null && b !== null ? `${L.fields[c.key]} ${a} → ${b}` : L.fields[c.key]
  return c.implicit ? t('SEW_PERF_CHANGED_IMPLICIT', { text }) : text
}
const changesLine = computed(() => `${changes.value.map(changeText).join(', ')} · ${t('SEW_PERF_CHANGED_TAIL')}`)
const changedNames = computed(() => changes.value.map((c) => L.fields[c.key]).join(', '))

// 같은 이름 모델(자기 모델 빼고)과 저장된 원개발자의 등록 여부는 창을 열 때 묻는다
let openSeq = 0
async function loadModels(seq) {
  const s = source.value
  models.value = null
  modelsFailed.value = false
  try {
    const rows = (await api.sameName(s.process, s.name)).data.data
    if (seq === openSeq) models.value = (Array.isArray(rows) ? rows : []).filter((m) => m !== s.model)
  } catch {
    if (seq === openSeq) modelsFailed.value = true
  }
}
async function checkRegistered(seq) {
  const ids = [...new Set(form.value.devs.map((d) => d.id).filter(Boolean))]
  if (!ids.length) return
  try {
    const rows = (await api.registeredUsers(ids)).data.data
    if (seq !== openSeq) return
    const found = new Set((Array.isArray(rows) ? rows : []).map((u) => u.singleid))
    const next = { ...reg.value }
    for (const i of ids) if (next[i] === undefined) next[i] = found.has(i)
    reg.value = next
  } catch {
    // 모르면 표시하지 않는다 — 저장 때 서버가 DEV_UNKNOWN 으로 다시 본다
  }
}

function start() {
  const seq = ++openSeq
  load(store.skeleton?.performance ?? null)
  reg.value = {}
  touched.clear()
  serverBlocks.value = []
  saveError.value = ''
  savedAt.value = ''
  results.value = null
  also.value = []
  leaving.value = false
  if (!allowed.value) return
  loadModels(seq)
  checkRegistered(seq)
  nextTick(() => focusPf(`grade:${form.value.grade}`))
}

const pad = (n) => String(n).padStart(2, '0')
const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
function savedToast(list) {
  if (!list) return t('SEW_PERF_SAVED')
  const ok = list.filter((r) => r.ok).length
  return ok === list.length ? t('SEW_PERF_SAVED_ALL', { n: list.length }) : t('SEW_PERF_SAVED_SOME', { n: list.length, ok, failed: list.length - ok })
}

async function save() {
  if (!canSave.value) return
  const s = source.value
  const withDevs = devsChanged.value
  const body = { fields: { ...sent.value } }
  if (withDevs) body.citizenDevelopers = citizenDevelopersOf(form.value)
  body.alsoModels = [...also.value]
  saving.value = true
  saveError.value = ''
  try {
    const { performance, applied } = (await api.savePerformance(s.process, s.model, s.name, body)).data.data
    if (withDevs) { const next = { ...reg.value }; for (const d of form.value.devs) next[d.id] = true; reg.value = next } // 서버가 등록 사용자임을 확인했다
    store.setPerformance(performance)
    load(performance)
    touched.clear()
    const now = new Date()
    const list = Array.isArray(applied) && applied.length ? applied : null
    results.value = list
    resultsAt.value = hhmm(now)
    savedAt.value = `${ymd(now)} ${hhmm(now)}`
    also.value = []
    edit.notify(savedToast(list))
  } catch (e) {
    const code = errorCode(e)
    if (code === 'VALIDATION_FAILED') {
      serverBlocks.value = Array.isArray(e?.response?.data?.details?.blocks) ? e.response.data.details.blocks : []
      saveError.value = t('SEW_PERF_SAVE_BLOCKED')
    } else if (code === 'UPSTREAM_TIMEOUT' || code === 'TIMEOUT' || code === 'NETWORK') { // 보낸 뒤 끊김도 저장됐을 수 있다(SEW-023)
      saveError.value = t('SEW_PERF_SAVE_UNKNOWN')
    } else {
      saveError.value = t('SEW_PERF_SAVE_FAILED', { cause: errorMessage(e) })
    }
  } finally {
    saving.value = false
  }
}

// 닫기: 저장하는 중에는 닫지 않는다. 바꾼 것이 있으면 묻는다(묻는 창의 Esc·[계속 고치기]는 묻는 창만 닫는다).
function requestClose() {
  if (saving.value || leaving.value) return
  if (!touchedChanges.value) { emit('update:modelValue', false); return }
  leaving.value = true
  nextTick(() => keepEl.value?.focus())
}
function leaveKeep() { leaving.value = false; nextTick(() => closeEl.value?.focus()) }
function leaveDrop() { leaving.value = false; emit('update:modelValue', false) }

// Esc(찾기 목록이 열려 있으면 그 조각이 먼저 받는다)·Tab 이 창 밖으로 나가지 않게 — 창 위의 ✕(ModalShell 머리)도 Tab 고리에 든다(SEW-023)
function onKey(e) {
  if (e.key === 'Escape') {
    e.preventDefault()
    if (leaving.value) leaveKeep()
    else requestClose()
    return
  }
  if (e.key !== 'Tab' || !rootEl.value) return
  const scope = leaving.value ? rootEl.value.querySelector('.se-pp-cf') : rootEl.value.closest('[data-se-modal]') ?? rootEl.value
  const els = [...scope.querySelectorAll('button, input, select, textarea')].filter((x) => !x.disabled && (leaving.value || !x.closest('.se-pp-cf')))
  if (!els.length) return
  const first = els[0]
  const last = els[els.length - 1]
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
}
const listen = (on) => (on ? document.addEventListener('keydown', onKey) : document.removeEventListener('keydown', onKey))
watch(() => props.modelValue, (open) => {
  listen(open)
  if (open) start()
  else { openSeq++; leaving.value = false }
}, { immediate: true })
onBeforeUnmount(() => listen(false))
</script>

<template>
  <ModalShell :model-value="modelValue" :title="L.title" :width="1180" :height="900" :closable="!saving" testid="se-perf-dialog"
    @update:model-value="(v) => (v ? emit('update:modelValue', true) : requestClose())">
    <div ref="rootEl" class="se-pp se-pf relative h-full flex flex-col">
      <template v-if="allowed">
        <div class="se-pp-sub">
          <span class="se-pp-id">{{ store.skeleton?.id }}</span>
          <span class="se-pp-chip" :class="done ? 'ok' : 'am'" :title="t('SEW_PERF_DONE_TITLE')" data-testid="se-perf-done"><i />{{ done ? L.done : L.notDone }}</span>
          <span v-if="!done" class="se-pf-miss" data-testid="se-perf-missing">{{ t('SEW_PERF_MISSING', { list: missingText }) }}</span>
          <span v-if="done !== savedDone" class="se-pp-who whitespace-nowrap">{{ t('SEW_PERF_SAVED_STATE', { state: savedDone ? L.done : L.notDone }) }}</span>
        </div>
        <!-- 저장하는 중에는 칸을 고치지 않는다(돌아온 값으로 다시 그린다) -->
        <div class="se-pf-body" v-bind="saving ? { inert: '' } : {}">
          <PerformanceBand />
          <div class="se-pf-grid">
            <PerformanceEffects />
            <section aria-labelledby="se-pf-dv-h">
              <PerformanceDevelopers />
              <PerformanceSameName />
            </section>
          </div>
        </div>
        <div class="se-pp-foot">
          <div class="se-pp-foot-text" data-testid="se-perf-foot" aria-live="polite">
            <div v-if="saving" class="se-pp-foot-sum"><span class="se-pf-spin" aria-hidden="true" />{{ L.saving }}</div>
            <template v-else-if="saveError || errorAts.length">
              <div class="se-pp-foot-sum" :class="saveError || anyVisible ? 'bad' : 'need'" :role="saveError ? 'alert' : undefined">
                {{ saveError || t(anyVisible ? 'SEW_PERF_FIX_N' : 'SEW_PERF_NEED_N', { n: errorAts.length }) }}</div>
              <div v-if="errorAts.length" class="se-pp-foot-list">
                <template v-for="(at, i) in errorAts" :key="at"><span v-if="i">, </span><button type="button" class="se-pf-goto" :data-goto="at" @click="goto(at)">{{ atLabel(at) }}</button></template>
              </div>
              <div v-else-if="dirty" class="se-pp-foot-list" :title="changedNames">{{ changesLine }}</div>
            </template>
            <template v-else-if="dirty">
              <div class="se-pp-foot-sum">{{ t('SEW_PERF_CHANGED_N', { n: changes.length }) }}</div>
              <div class="se-pp-foot-list" :title="changedNames">{{ changesLine }}</div>
            </template>
            <template v-else-if="savedAt">
              <div class="se-pp-foot-sum ok">{{ t('SEW_PERF_FOOT_SAVED', { at: savedAt }) }}</div>
              <div class="se-pp-foot-list">{{ t('SEW_PERF_FOOT_SAVED_LINE') }}</div>
            </template>
            <template v-else>
              <div class="se-pp-foot-list">{{ t('SEW_PERF_FOOT_IDLE') }}</div>
              <div class="se-pp-foot-list">{{ savedView?.updateDate ? t('SEW_PERF_UPDATED', { date: savedView.updateDate }) : t('SEW_PERF_NO_SAVED') }}</div>
            </template>
          </div>
          <button ref="closeEl" type="button" class="se-pp-btn" :disabled="saving" data-testid="se-perf-close" @click="requestClose">{{ L.close }}</button>
          <button type="button" class="se-pp-btn p" :disabled="!canSave" data-testid="se-perf-save" @click="save">{{ saving ? L.saving : L.save }}</button>
        </div>
        <div v-if="leaving" class="se-pp-cf-dim" data-testid="se-perf-leave">
          <div class="se-pp-cf" role="alertdialog" aria-modal="true" aria-labelledby="se-pf-leave-t" aria-describedby="se-pf-leave-d">
            <h3 id="se-pf-leave-t">{{ t('SEW_PERF_LEAVE_TITLE') }}</h3>
            <p id="se-pf-leave-d">{{ t('SEW_PERF_LEAVE_BODY', { n: changes.length, list: changedNames }) }}</p>
            <div class="se-pp-cf-f">
              <button ref="keepEl" type="button" class="se-pp-btn" data-testid="se-perf-leave-keep" @click="leaveKeep">{{ L.keep }}</button>
              <button type="button" class="se-pp-btn danger" data-testid="se-perf-leave-drop" @click="leaveDrop">{{ L.drop }}</button>
            </div>
          </div>
        </div>
      </template>
      <p v-else class="se-pf-body se-pp-empty">{{ t('SEW_PROP_PERF_LOCK') }}</p>
    </div>
  </ModalShell>
</template>

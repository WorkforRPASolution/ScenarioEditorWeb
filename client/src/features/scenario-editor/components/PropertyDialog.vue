<script setup>
// 운영 속성 창(P2-D Task 4, 설계 §7, 목업 2026-11-04-property-editor-v2 — 실행 경로 화면, 보기·수정 겸용).
// [수정] → 창 안 초안을 고친다 → [적용]은 작업본 property 에만(editStore.applyProperty — 배포·초안이 함께 싣는다, Q-103).
// 칸 검사는 서버와 같은 code·"바뀐 칸만"(editor/propertyRules) — 기준은 저장 기준 판(새 시나리오는 기준 없음).
// 심의(등급·의견)는 PropertyReview 가 [심의 저장]으로 바로 쓴다. 칸 조각들은 provide('sePropertyCtx') 로 같은 값을 본다.
// 적용하지 않은 운영 속성·저장하지 않은 심의 글이 있으면 ✕·바깥 누르기로 닫을 때 묻는다(편집 화면의 다른 확인 창과 같은 갈래).
import { ref, shallowRef, reactive, computed, provide, watch, nextTick, onBeforeUnmount } from 'vue'
import { useEditorStore } from '../stores/editorStore'
import { useEditStore } from '../stores/editStore'
import { scenarioEditorApi as api } from '../api'
import { t, LABELS } from '../messages'
import { canonicalJson, changedPropertyKeys } from '../editor/diff'
import { checkPropertyFields } from '../editor/propertyRules'
import { propertyDiffs } from '../editor/propertyView'
import ModalShell from './ModalShell.vue'
import PropertyState from './property/PropertyState.vue'
import PropertyPath from './property/PropertyPath.vue'
import PropertyReview from './property/PropertyReview.vue'
import PropertyPeople from './property/PropertyPeople.vue'
import PropertyMore from './property/PropertyMore.vue'
import ChangeText from './ChangeText.vue'
import './property/property.css'

defineOptions({ name: 'PropertyDialog' })
// focus = { field, n } — 저장 창의 운영 속성 막힌 줄이 준다(editor/propertyRules propertyFieldOf). 받으면 수정으로 열고 그 칸에 초점.
const props = defineProps({ modelValue: Boolean, focus: { type: Object, default: null } })
// open-performance = [성과 입력](관리 등급 1·2). 창(PerformanceDialog)은 부모가 열고, 닫으면 focusPerformance() 로 초점을 [성과 입력]에 돌려준다.
const emit = defineEmits(['update:modelValue', 'open-performance'])
const store = useEditorStore()
const edit = useEditStore()
const P = LABELS.prop

const sk = computed(() => store.skeleton)
// 보이는 값: 작업본(적용한 값)이 정본, 작업본이 없으면 뼈대. 운영 속성을 해석하지 못한 판(뼈대 property null)은 보이지 않는다.
const current = computed(() => (sk.value?.property ? edit.session?.working?.property ?? sk.value.property : null))
const canEdit = computed(() => edit.editable && !!current.value)
const editing = ref(false)
const draft = shallowRef(null)
const orig = shallowRef(null)
const linked = reactive({}) // [+ 다음 시나리오 잇기]를 눌러 고르는 칸을 연 후속(저장된 빈 후속과 구별)
const prev = computed(() => { const s = edit.session; return s?.source ? s.saveBase?.property ?? null : null })
const errors = computed(() => (editing.value ? checkPropertyFields(draft.value, prev.value) : {}))
const diffs = computed(() => (editing.value ? propertyDiffs(orig.value, draft.value) : []))
const nErrors = computed(() => Object.keys(errors.value).length)
const canApply = computed(() => editing.value && !nErrors.value && diffs.value.length > 0)
// [적용]하고 아직 배포하지 않은 운영 속성 키 — 저장 전 변경과 같은 기준(새 시나리오는 만든 때의 기본값과 비교)
const pendingKeys = computed(() => {
  const s = edit.session
  return s?.working && s.saveBase ? changedPropertyKeys(s.working.property, s.saveBase.property) : []
})
const pendingTitle = computed(() => t('SEW_PROP_PENDING_TITLE', { list: pendingKeys.value.map((k) => P.keys[k] ?? LABELS.propertyKey[k] ?? k).join(', ') }))
const errorList = computed(() => Object.keys(errors.value).map((k) => P.errorFields[k] ?? k).join(', '))
const diffList = computed(() => diffs.value.map((d) => `${d.label} ${d.from} → ${d.to}`).join(', '))

// 같은 모델의 시나리오 이름(후속 고르기·"이제 없음" 판정). null = 읽는 중이거나 못 읽음.
const names = ref(null)
const namesFailed = ref(false)
let namesSeq = 0
async function loadNames() {
  const s = sk.value
  const seq = ++namesSeq
  names.value = null
  namesFailed.value = false
  if (!s?.process || !s?.model) return
  try {
    const rows = (await api.list(s.process, s.model)).data.data
    if (seq === namesSeq) names.value = (Array.isArray(rows) ? rows : []).map((r) => r.name)
  } catch {
    if (seq === namesSeq) namesFailed.value = true
  }
}

function startEdit() {
  if (editing.value || !canEdit.value) return
  orig.value = current.value
  draft.value = { ...current.value }
  for (const k of Object.keys(linked)) delete linked[k]
  editing.value = true
}
function stopEdit() {
  editing.value = false
  draft.value = null
  orig.value = null
}
// 초안은 창을 열 때의 작업본에서 시작해 고친 칸만 바뀐다 — 손대지 않은 칸(저장된 빈 후속 {Name:''} 포함)은 그대로 간다.
function apply() {
  if (!canApply.value || !edit.applyProperty(draft.value)) return
  stopEdit()
  edit.notify(t('SEW_PROP_APPLIED'))
}

const ctx = reactive({
  p: computed(() => (editing.value ? draft.value : current.value)),
  orig, editing, errors, linked, names, selfName: computed(() => sk.value?.name ?? null),
  changed: (k) => editing.value && canonicalJson(draft.value?.[k]) !== canonicalJson(orig.value?.[k]),
  set: (k, v) => { if (editing.value) draft.value = { ...draft.value, [k]: v } },
  link: (k) => { linked[k] = true; ctx.set(k, { Name: '', Text: '' }) },
  unlink: (k) => { linked[k] = false; ctx.set(k, null) }
})
provide('sePropertyCtx', ctx)

// 초점: 칸 → (없으면) 후속의 잇기 단추 → (재시도 간격이 숨었으면) 재시도 횟수. 데스크탑 칸은 접힌 묶음을 편다.
const rootEl = ref(null)
const moreOpen = ref(false)
const MORE_FIELDS = new Set(['ExecutingLevel', 'DetailedDescriptionTitle', 'EDMLink'])
async function goFocus(field) {
  startEdit()
  if (MORE_FIELDS.has(field)) moreOpen.value = true
  await nextTick()
  const root = rootEl.value
  if (!root) return
  const el = [field, field.split('.')[0], field === 'RetryInterval' ? 'RetryCnt' : null]
    .filter(Boolean).map((f) => root.querySelector(`[data-pfield="${f}"]`)).find(Boolean)
  if (!el) return
  if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' })
  el.focus()
}
function focusPerformance() { rootEl.value?.querySelector('[data-pfield="performance"]')?.focus() }
defineExpose({ focusPerformance })
// 닫기: 적용하지 않은 운영 속성(수정 중 바뀐 칸)이나 저장하지 않은 심의 글이 있으면 바로 닫지 않고 묻는다. ✕·바깥 누르기 같은 길.
// 묻는 동안 Esc 는 [계속 고치기](EditDialogs 의 확인 창과 같다). 고친 것이 없으면 바로 닫는다.
const reviewDirty = ref(false)
const leaving = ref(false)
const keepEl = ref(null)
const propertyDirty = computed(() => editing.value && diffs.value.length > 0)
const leaveBody = computed(() => [
  propertyDirty.value ? t('SEW_PROP_LEAVE_PROPERTY', { n: diffs.value.length }) : '',
  reviewDirty.value ? t('SEW_PROP_LEAVE_REVIEW') : '',
  t('SEW_PROP_LEAVE_KEEPS')
].filter(Boolean).join(' '))
function requestClose() {
  if (!propertyDirty.value && !reviewDirty.value) { emit('update:modelValue', false); return }
  leaving.value = true
  nextTick(() => keepEl.value?.focus())
}
function leaveKeep() { leaving.value = false }
function leaveDrop() { leaving.value = false; emit('update:modelValue', false) }
const onLeaveKey = (e) => { if (e.key === 'Escape') leaveKeep() }
watch(leaving, (on) => (on ? document.addEventListener('keydown', onLeaveKey) : document.removeEventListener('keydown', onLeaveKey)))
onBeforeUnmount(() => document.removeEventListener('keydown', onLeaveKey))

// 창을 열 때마다 보기로 시작한다(닫으면 고치던 초안·심의 글은 버린다 — 닫기 전에 위에서 물었다).
watch(() => props.modelValue, (open) => {
  stopEdit()
  moreOpen.value = false
  leaving.value = false
  reviewDirty.value = false
  if (!open) return
  loadNames()
  if (props.focus?.field) goFocus(props.focus.field)
}, { immediate: true })
watch(() => props.focus, (f) => { if (props.modelValue && f?.field) goFocus(f.field) })
</script>

<template>
  <ModalShell :model-value="modelValue" :title="P.title" :width="1080" :height="760" testid="se-property-dialog" @update:model-value="(v) => (v ? emit('update:modelValue', true) : requestClose())">
    <div ref="rootEl" class="se-pp relative h-full flex flex-col">
      <div class="se-pp-sub">
        <span class="se-pp-id">{{ sk?.id }}</span>
        <span class="se-pp-who">{{ t('SEW_PROP_CURRENT') }}</span>
        <span class="se-pp-grow" />
        <span v-if="!editing && pendingKeys.length" class="se-pp-chip am" :title="pendingTitle" data-testid="se-prop-pending">{{ t('SEW_PROP_PENDING', { n: pendingKeys.length }) }}</span>
        <span v-if="editing" class="se-pp-chip pri" data-testid="se-prop-editing">{{ P.editing }}</span>
        <button v-else-if="canEdit" type="button" class="se-pp-btn p" data-testid="se-prop-edit" @click="startEdit">{{ P.edit }}</button>
      </div>
      <div v-if="ctx.p" class="se-pp-body">
        <PropertyState />
        <PropertyPath />
        <p v-if="editing && namesFailed" class="se-pp-warn mt-1.5">{{ t('SEW_PROP_NAMES_FAILED') }}</p>
        <div class="se-pp-below">
          <section><PropertyReview @open-performance="emit('open-performance')" @dirty="reviewDirty = $event" /></section>
          <section><PropertyPeople /></section>
        </div>
        <PropertyMore v-model:open="moreOpen" />
      </div>
      <p v-else class="se-pp-body se-pp-empty">{{ t('SEW_UI_PROPERTY_PARSE_FAILED') }}</p>
      <div v-if="editing" class="se-pp-foot">
        <div class="se-pp-foot-text" data-testid="se-prop-foot">
          <template v-if="nErrors">
            <div class="se-pp-foot-sum bad">{{ t('SEW_PROP_FIX_N', { n: nErrors }) }}</div>
            <div class="se-pp-foot-list" :title="errorList">{{ errorList }}</div>
          </template>
          <template v-else-if="diffs.length">
            <div class="se-pp-foot-sum">{{ t('SEW_PROP_CHANGED_N', { n: diffs.length }) }}</div>
            <div class="se-pp-foot-list" :title="diffList"><template v-for="(d, k) in diffs" :key="d.key"><template v-if="k">{{ ', ' }}</template>{{ `${d.label} ` }}<ChangeText :before="d.from" :after="d.to" /></template></div>
          </template>
          <template v-else>
            <div class="se-pp-foot-sum none">{{ t('SEW_PROP_NO_CHANGE') }}</div>
            <div class="se-pp-foot-list">{{ t('SEW_PROP_APPLY_HINT') }}</div>
          </template>
        </div>
        <button type="button" class="se-pp-btn" data-testid="se-prop-cancel" @click="stopEdit">{{ P.cancel }}</button>
        <button type="button" class="se-pp-btn p" :disabled="!canApply" data-testid="se-prop-apply" @click="apply">{{ P.apply }}</button>
      </div>
      <div v-if="leaving" class="se-pp-cf-dim" data-testid="se-prop-leave">
        <div class="se-pp-cf" role="alertdialog" aria-modal="true" aria-labelledby="se-pp-leave-t" aria-describedby="se-pp-leave-d">
          <h3 id="se-pp-leave-t">{{ t('SEW_PROP_LEAVE_TITLE') }}</h3>
          <p id="se-pp-leave-d">{{ leaveBody }}</p>
          <div class="se-pp-cf-f">
            <button ref="keepEl" type="button" class="se-pp-btn p" data-testid="se-prop-leave-keep" @click="leaveKeep">{{ P.leaveKeep }}</button>
            <button type="button" class="se-pp-btn danger" data-testid="se-prop-leave-drop" @click="leaveDrop">{{ P.leaveDrop }}</button>
          </div>
        </div>
      </div>
    </div>
  </ModalShell>
</template>

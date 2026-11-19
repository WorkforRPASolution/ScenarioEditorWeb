<script setup>
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import { useEditorStore } from '../stores/editorStore'
import { useEditStore } from '../stores/editStore'
import { useSaveFlow } from '../stores/saveFlow'
import { t, noteMessage, MESSAGES } from '../messages'
import { barFieldErrors } from '../editor/fieldRules'
import { formatCrtime, scenarioTypeLabel, enabledLabel } from '../format'
import PropertyDialog from './PropertyDialog.vue'
import PerformanceDialog from './PerformanceDialog.vue'
import DataCheckDialog from './DataCheckDialog.vue'
import SaveDialog from './SaveDialog.vue'
import ScenarioDeleteDialog from './ScenarioDeleteDialog.vue'
import PreprocessDialog from './PreprocessDialog.vue'
import TestRunDialog from './testrun/TestRunDialog.vue'
import DeployAttentionDialog from './DeployAttentionDialog.vue'
import { useTestRunStore } from '../stores/testRunStore'
import { useDeployAttention } from '../stores/deployAttentionStore'
import { windowsSummary, windowsFromHeader } from '../editor/windows'

defineOptions({ name: 'ScenarioBar' })
// load = [불러오기], new = [새 시나리오](창은 화면이 연다 — 패널 확인을 먼저 거친다)
defineEmits(['load', 'new'])
const store = useEditorStore()
const edit = useEditStore()
const flow = useSaveFlow()
// [시험 실행](P5 설계 §4.1): 시나리오를 열지 않아도 보이고 눌린다 — 창 안에서 공정·모델·시나리오를 고른다.
// 쓸 수 있는가와 꺼진 까닭은 서버가 /me 의 testRun 으로 알려 준다(쓰기 권한 없음·읽기 전용 서버·서버에서 꺼 둠·사용자 바꾸기). 서버가 요청마다 다시 본다.
const testRun = useTestRunStore()
// 확인이 필요한 내 배포(SEW-021) — 있을 때만 바에 건수, 누르면 목록 창
const attention = useDeployAttention()
const attentionOpen = ref(false)
const runGate = computed(() => {
  const g = store.me?.testRun
  if (!g) return null
  return { enabled: g.enabled === true, title: g.enabled === true ? '' : MESSAGES[`SEW_RUN_OFF_${g.reason}`] ?? MESSAGES[`SEW_ERR_${g.reason}`] ?? '' }
})
const showProperty = ref(false)
// [시나리오 지우기…](2026-11-10): 쓸 수 있는 사용자가 서버에 있는 시나리오를 열었을 때만 — 새 시나리오(아직 배포 전)·원본이 지워진 초안·
// 이미 지워진 화면에는 없다. 누르면 불러오기 창의 지우기 확인 창이 그대로 뜬다(이름을 그대로 쳐야 지워진다).
const showDelete = ref(false)
const canDelete = computed(() => {
  const s = edit.session
  return !!store.me?.canWrite && !!store.skeleton && !store.skeleton.isNew && !!s?.source && s.readOnly !== 'deleted' && !s.fromDraft?.gone
})
// 운영 속성 창 초점({ field, n }) — 저장 창의 운영 속성 막힌 줄이 그 칸을 알려 준다. [운영 속성 전체]는 초점 없이 보기로 연다.
const propertyFocus = ref(null)
function openProperty(field) {
  propertyFocus.value = field ? { field, n: (propertyFocus.value?.n ?? 0) + 1 } : null
  showProperty.value = true
}
// 성과 입력 창: 운영 속성 창의 [성과 입력]으로 열고, 닫으면 초점을 [성과 입력]으로 돌린다
const propertyEl = ref(null)
const showPerformance = ref(false)
watch(showPerformance, (open) => { if (!open) nextTick(() => propertyEl.value?.focusPerformance()) })
const showDataCheck = ref(false)
const sk = computed(() => store.skeleton)
// 켜짐·유형 표시: 운영 속성 창에서 [적용]한 작업본 값을 따른다(해석하지 못한 운영 속성은 표시하지 않는다)
const barProperty = computed(() => (sk.value?.property ? edit.session?.working?.property ?? sk.value.property : null))
const tw = computed(() => sk.value?.header.targetWindow)
// 전처리 버튼(P2-F 설계 §7): 대상 창 상태 + 숨길 창 수 + 확인할 줄 수. 작업본에 [적용] 한 값을 따르고, 편집 세션이 없으면 뼈대 저장값으로 보인다.
// 값을 모르면(원본이 지워진 옛 초안) "전처리" 만. 누르면 전처리 설정 창 — 저장 창의 창 조건 검사 줄도 이 창을 연다(focus = { which, n }).
const showPreprocess = ref(false)
const preprocessFocus = ref(null)
function openPreprocess(which) {
  preprocessFocus.value = which ? { which, n: (preprocessFocus.value?.n ?? 0) + 1 } : null
  showPreprocess.value = true
}
const windowsNow = computed(() => edit.session?.working?.header?.windows ?? (edit.session ? null : windowsFromHeader(sk.value?.header)))
const ppText = computed(() => {
  const s = windowsSummary(windowsNow.value)
  if (!s) return t('SEW_PP_OPEN')
  return `${t('SEW_PP_OPEN')}: ${t(`SEW_PP_BAR_TARGET_${s.target}`)} · ${t('SEW_PP_BAR_HIDING', { n: s.hiding })}${s.attention ? ` ${t('SEW_PP_BAR_ATTENTION', { n: s.attention })}` : ''}`
})
const ppAttention = computed(() => { const s = windowsSummary(windowsNow.value); return !!s && (s.attention > 0 || s.target === 'warn') })
const ppTitle = computed(() => (windowsNow.value ? t('SEW_PP_BAR_TITLE') : t('SEW_PP_BAR_UNKNOWN')))
const twDiffers = computed(() => !!tw.value && tw.value.agentFinds !== tw.value.inHouseShowsSet)
// 시나리오 단위 경고·알림(본문·기준 화면·운영 속성 해석 실패, SUCCESS 없음, 비표준 우선순위 등).
// 대상 창 알림(TARGET_WINDOW_DIFFERS)은 대상 창 자리에 이미 나오므로 뺀다.
const scenarioNotes = computed(() => store.scenarioNotes.filter((n) => n.code !== 'TARGET_WINDOW_DIFFERS'))

// "경고 n · 알림 n": 스텝 경고가 있으면 그 스텝을 차례로 고르고, 시나리오 경고만 있으면 그 줄(없으면 대상 창 안내)로 포커스·강조한다.
const notesEl = ref(null)
const twEl = ref(null)
const flash = ref(false)
let flashTimer = null
async function onNotesClick() {
  if (store.nextNoted()) return
  const el = notesEl.value || twEl.value
  if (!el) return
  flash.value = true
  clearTimeout(flashTimer)
  flashTimer = setTimeout(() => { flash.value = false }, 1600)
  await nextTick()
  if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' })
  el.focus({ preventScroll: true })
}
onBeforeUnmount(() => clearTimeout(flashTimer))

// 메일 제목·제한 시간: 작업본(working.header)이 정본이고, 작업본이 없는 뼈대(P1)는 뼈대 값을 보기만 한다.
// 입력은 값을 작업본에 넣을 뿐 입력칸을 다시 그리지 않는다(목업 renderBarLive) — :value 는 같은 값이면 DOM 을 건드리지 않는다.
const header = computed(() => edit.session?.working?.header ?? sk.value?.header ?? {})
const barErrors = computed(() => (edit.editable ? barFieldErrors(header.value) : {}))
const unsaved = computed(() => edit.unsavedCount)
// 저장 기준점과 다른 바 칸(새 시나리오는 만든 때의 값과 비교 — 저장 전 N곳과 같은 기준)
const changedField = (field) => edit.editable && String(header.value[field] ?? '') !== String(edit.session.saveBase?.header?.[field] ?? '')
// [새 시나리오]: 쓰기 권한이 있으면 열린 시나리오가 없어도 보인다(바 순서 불러오기 · 새 시나리오 · 저장, 스텝 편집 목업 v1)
const canCreate = computed(() => !!store.me?.canWrite)
// [저장](P2-D Task 2): 쓸 수 있는 세션에만. 패널에 적용 안 한 변경이 있으면 저장 창 전에 확인 창(목업 조작판 22).
function onSave() {
  if (edit.capture) { edit.notify(t('SEW_SAVE_REFUSED_CAPTURE')); return }
  edit.guard(() => flow.open(), { action: 'save' })
}
// 저장 창의 막힌 줄·[고치기]가 바 칸으로 보낼 때(목업 svbar): 그 입력칸에 초점을 주고 글자를 고르게 한다.
const descEl = ref(null)
const timeoutEl = ref(null)
async function focusBar(field) {
  await nextTick()
  const el = field === 'timeoutLimit' ? timeoutEl.value : descEl.value
  if (!el) return
  if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' })
  el.focus()
  if (typeof el.select === 'function') el.select()
}
const draftTime = computed(() => {
  const ms = edit.session?.draft?.savedAt ? new Date(edit.session.draft.savedAt).getTime() : NaN
  return Number.isFinite(ms) ? formatCrtime(ms).slice(11, 16) : ''
})
// 불러오기 창에서 연 길(P2-D Task 7): 되돌려 연 작업본·초안으로 연 세션(시작한 버전·그 뒤 새 버전·원본 지워짐)·지워진 시나리오
const opened = computed(() => {
  const s = edit.session
  return { restoredFrom: s?.restoredFrom ?? null, fromDraft: s?.fromDraft ?? null, deleted: s?.readOnly === 'deleted' }
})
const versionLabel = computed(() => (opened.value.fromDraft ? t('SEW_BAR_DRAFT_BASE') : sk.value.version.isCurrent ? t('SEW_UI_CURRENT_VERSION') : t('SEW_UI_OLD_VERSION')))
const flashRing = 'ring-2 ring-amber-400 dark:ring-amber-500 rounded'
const inp = 'h-7 px-2 rounded border border-gray-300 dark:border-dark-border bg-white dark:bg-dark-card text-gray-900 dark:text-white text-xs outline-none focus:ring-2 focus:ring-primary-400'
const bad = 'border-red-500 dark:border-red-500 bg-red-50 dark:bg-red-900/20'
const changed = 'border-amber-400 dark:border-amber-500'
const badge = 'px-2 py-0.5 rounded text-xs font-medium'
const btn = 'h-8 px-3 rounded-lg text-sm'
</script>

<template>
  <div class="bg-white dark:bg-dark-card rounded-lg border border-gray-200 dark:border-dark-border px-3 py-2 flex items-center gap-3 flex-wrap" data-testid="se-bar">
    <button :class="btn" class="bg-primary-500 hover:bg-primary-600 text-white font-medium" data-testid="se-load" @click="$emit('load')">{{ t('SEW_UI_LOAD') }}</button>
    <button v-if="canCreate" :class="btn" class="bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-100 font-medium" data-testid="se-new" @click="$emit('new')">{{ t('SEW_NEW_OPEN') }}</button>
    <button v-if="runGate" :class="btn" class="bg-gray-200 dark:bg-gray-700 hover:enabled:bg-gray-300 dark:hover:enabled:bg-gray-600 text-gray-800 dark:text-gray-100 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
      :disabled="!runGate.enabled" :title="runGate.title" data-testid="se-run-open" @click="testRun.show()">{{ t('SEW_RUN_OPEN') }}</button>
    <button v-if="attention.count" :class="btn" class="bg-amber-100 hover:bg-amber-200 text-amber-800 dark:bg-amber-900/30 dark:hover:bg-amber-900/50 dark:text-amber-300 font-medium" data-testid="se-deploy-attention" @click="attentionOpen = true">{{ t('SEW_ATTN_OPEN', { n: attention.count }) }}</button>
    <button v-if="edit.editable" :class="[btn, unsaved ? 'bg-primary-500 hover:bg-primary-600 text-white' : 'bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-100']" class="font-medium" data-testid="se-save" @click="onSave">{{ t('SEW_SAVE_OPEN') }}{{ unsaved ? ` (${unsaved})` : '' }}</button>
    <template v-if="sk">
      <div class="min-w-0">
        <div class="font-mono text-sm text-gray-900 dark:text-white truncate" data-testid="se-bar-id">{{ sk.id }}</div>
        <div class="text-xs text-gray-500 dark:text-gray-400 truncate">
          <template v-if="!edit.editable">
            <span ref="descEl" tabindex="-1" class="outline-none focus:ring-2 focus:ring-primary-400 rounded" data-testid="se-bar-description">{{ header.description }}</span>
            · <span ref="timeoutEl" tabindex="-1" class="outline-none focus:ring-2 focus:ring-primary-400 rounded" data-testid="se-bar-timeout">제한 {{ header.timeoutLimit }}분</span>
          </template>
        </div>
      </div>
      <div v-if="edit.editable" class="flex items-start gap-3 text-xs text-gray-600 dark:text-gray-300" data-testid="se-bar-fields">
        <label class="flex flex-col gap-0.5">
          <span class="flex items-center gap-1.5"><span>{{ t('SEW_BAR_MAIL_TITLE') }}</span>
            <input ref="descEl" type="text" :value="header.description ?? ''" :placeholder="t('SEW_BAR_MAIL_TITLE_PLACEHOLDER')" :aria-invalid="!!barErrors.description" :class="[inp, 'w-64', barErrors.description ? bad : changedField('description') ? changed : '']" data-testid="se-bar-description" @input="edit.setHeader('description', $event.target.value)" /></span>
          <span v-if="barErrors.description" class="text-red-600 dark:text-red-400" data-testid="se-bar-error-description">{{ t(`RULE_${barErrors.description}`) }}</span>
        </label>
        <label class="flex flex-col gap-0.5">
          <span class="flex items-center gap-1.5"><span>{{ t('SEW_BAR_TIMEOUT') }}</span>
            <input ref="timeoutEl" type="text" inputmode="numeric" :value="header.timeoutLimit ?? ''" :aria-invalid="!!barErrors.timeoutLimit" :class="[inp, 'w-14 text-right tabular-nums', barErrors.timeoutLimit ? bad : changedField('timeoutLimit') ? changed : '']" data-testid="se-bar-timeout" @input="edit.setHeader('timeoutLimit', $event.target.value)" />
            <span>{{ t('SEW_BAR_MINUTES_UNIT') }}</span></span>
          <span v-if="barErrors.timeoutLimit" class="text-red-600 dark:text-red-400" data-testid="se-bar-error-timeout">{{ t(`RULE_${barErrors.timeoutLimit}`) }}</span>
        </label>
      </div>
      <div class="flex items-center gap-1.5 flex-wrap text-xs">
        <template v-if="opened.deleted">
          <span :class="badge" class="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300" data-testid="se-bar-deleted">{{ t('SEW_BAR_DELETED') }}</span>
          <span :class="badge" class="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">{{ t('SEW_BAR_READ_ONLY') }}</span>
        </template>
        <span v-if="unsaved && edit.editable" :class="badge" class="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" :title="t('SEW_BAR_UNSAVED_TITLE')" data-testid="se-bar-unsaved">{{ t('SEW_BAR_UNSAVED', { n: unsaved }) }}</span>
        <span v-if="opened.restoredFrom != null" :class="badge" class="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" data-testid="se-bar-restored">{{ t('SEW_BAR_RESTORED', { at: formatCrtime(opened.restoredFrom) }) }}</span>
        <span v-if="opened.fromDraft?.stale" :class="badge" class="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" data-testid="se-bar-draft-stale">{{ t('SEW_BAR_DRAFT_STALE') }}</span>
        <span v-if="opened.fromDraft?.gone" :class="badge" class="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" data-testid="se-bar-source-gone">{{ t('SEW_BAR_SOURCE_GONE') }}</span>
        <span v-if="sk.isNew" :class="badge" class="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" :title="t('SEW_BAR_NEVER_SAVED_TITLE')" data-testid="se-bar-version">{{ t('SEW_BAR_NEVER_SAVED') }}</span>
        <span v-else :class="badge" class="bg-primary-100 text-primary-800 dark:bg-primary-900/30 dark:text-primary-400" data-testid="se-bar-version">
          {{ versionLabel }} · {{ formatCrtime(sk.version.crtime) }}</span>
        <template v-if="barProperty">
          <span :class="[badge, barProperty.IsEnabled ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-400']">
            {{ enabledLabel(barProperty.IsEnabled) }}</span>
          <span :class="badge" class="bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300">{{ scenarioTypeLabel(barProperty.Type) }}</span>
        </template>
        <span v-if="sk.performance" :class="badge" class="bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300">등급 {{ sk.performance.gradeName }}</span>
        <span v-if="draftTime" :class="badge" class="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" data-testid="se-bar-draft">{{ t('SEW_SAVE_BAR_DRAFT', { time: draftTime }) }}</span>
      </div>
      <div class="text-xs text-gray-600 dark:text-gray-300 min-w-0" data-testid="se-bar-target-window">
        <button type="button" class="max-w-full truncate h-6 px-2 rounded border border-gray-300 dark:border-dark-border hover:bg-primary-50 dark:hover:bg-primary-900/20"
          :class="ppAttention ? 'text-amber-700 dark:text-amber-400' : ''" :title="ppTitle" data-testid="se-bar-preprocess" @click="openPreprocess(null)">{{ ppText }}</button>
        <div v-if="twDiffers" ref="twEl" tabindex="-1" class="text-amber-600 dark:text-amber-400 truncate outline-none" :class="flash && !scenarioNotes.length ? flashRing : ''"
          data-testid="se-bar-tw-differs" :data-flash="String(flash && !scenarioNotes.length)">{{ t('SEW_NOTE_TARGET_WINDOW_DIFFERS') }}</div>
      </div>
    </template>
    <div class="ml-auto flex items-center gap-1.5">
      <button v-if="sk && store.warningCount + store.infoCount" :class="btn" class="bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" data-testid="se-notes" @click="onNotesClick">
        경고 {{ store.warningCount }} · 알림 {{ store.infoCount }}</button>
      <!-- 데이터 점검은 열린 시나리오와 상관없는 내 권한 범위의 점검이라 늘 보인다(0 이면 숨김) -->
      <button v-if="store.dataCheckCount" :class="btn" class="bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200" data-testid="se-data-check" @click="showDataCheck = true">
        {{ t('SEW_UI_DATA_CHECK') }} ⚠{{ store.dataCheckCount }}</button>
      <button v-if="sk" :class="btn" class="bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300" data-testid="se-property" @click="openProperty()">{{ t('SEW_UI_PROPERTY_ALL') }}</button>
      <!-- 지우기는 다른 단추와 떨어진 맨 끝에, 채우지 않은 붉은 테두리로 둔다(잘못 누르지 않게) -->
      <button v-if="canDelete" :class="btn" class="ml-2 border border-red-300 dark:border-red-800 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/30" data-testid="se-delete" @click="showDelete = true">{{ t('SEW_LOAD_DELETE_OPEN') }}</button>
    </div>
    <!-- 시나리오 단위 경고·알림 줄(바 아래 칸 전체). 본문이 깨져 스텝이 0개일 때도 여기서 원인이 보인다. -->
    <div v-if="sk && scenarioNotes.length" ref="notesEl" tabindex="-1" class="basis-full flex flex-wrap gap-x-4 gap-y-0.5 text-xs outline-none px-1 -mx-1"
      :class="flash ? flashRing : ''" data-testid="se-scenario-notes" :data-flash="String(flash)">
      <span v-for="(n, i) in scenarioNotes" :key="i" :class="n.level === 'warning' ? 'text-amber-700 dark:text-amber-300' : 'text-gray-600 dark:text-gray-300'">
        {{ n.level === 'warning' ? '⚠' : 'ⓘ' }} {{ noteMessage(n) }}</span>
    </div>
    <PropertyDialog ref="propertyEl" v-model="showProperty" :focus="propertyFocus" @open-performance="showPerformance = true" />
    <PerformanceDialog v-model="showPerformance" />
    <DataCheckDialog v-model="showDataCheck" />
    <SaveDialog @bar="focusBar" @property="openProperty" @windows="openPreprocess" />
    <PreprocessDialog v-model="showPreprocess" :focus="preprocessFocus" />
    <ScenarioDeleteDialog v-model="showDelete" />
    <TestRunDialog />
    <DeployAttentionDialog v-model="attentionOpen" />
  </div>
</template>

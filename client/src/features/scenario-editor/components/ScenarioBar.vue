<script setup>
import { ref, computed, nextTick, onBeforeUnmount } from 'vue'
import { useEditorStore } from '../stores/editorStore'
import { useEditStore } from '../stores/editStore'
import { useSaveFlow } from '../stores/saveFlow'
import { t, LABELS, noteMessage } from '../messages'
import { formatCrtime, scenarioTypeLabel, enabledLabel } from '../format'
import PropertyDialog from './PropertyDialog.vue'
import DataCheckDialog from './DataCheckDialog.vue'
import SaveDialog from './SaveDialog.vue'

defineOptions({ name: 'ScenarioBar' })
defineEmits(['load'])
const store = useEditorStore()
const edit = useEditStore()
const flow = useSaveFlow()
const showProperty = ref(false)
const showDataCheck = ref(false)
const sk = computed(() => store.skeleton)
const tw = computed(() => sk.value?.header.targetWindow)
const twText = computed(() => {
  const w = tw.value
  if (!w) return ''
  if (w.agentFinds) return t('SEW_UI_TW_FINDS', { text: w.raw.Text, mode: LABELS.matchMode[w.matchMode], cls: w.raw.ClassName })
  return t('SEW_UI_TW_NOT_FINDS', { reason: t(`SEW_UI_TW_REASON_${w.reasonCode}`) })
})
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

// [저장](P2-D Task 2): 쓸 수 있는 세션에만. 패널에 적용 안 한 변경이 있으면 저장 창 전에 확인 창(목업 조작판 22).
// 개수 "(N)"·"저장 전 N곳" 과 바 칸 입력은 Task 3 몫이다.
function onSave() {
  if (edit.capture) { edit.notify(t('SEW_SAVE_REFUSED_CAPTURE')); return }
  edit.guard(() => flow.open(), { action: 'save' })
}
// 저장 창의 막힌 줄·[고치기]가 바 칸으로 보낼 때(목업 svbar). 칸 입력은 Task 3 이 만든다 — 지금은 그 칸의 글자에 초점.
const descEl = ref(null)
const timeoutEl = ref(null)
async function focusBar(field) {
  await nextTick()
  const el = field === 'timeoutLimit' ? timeoutEl.value : descEl.value
  if (!el) return
  if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' })
  el.focus()
}
const draftTime = computed(() => {
  const ms = edit.session?.draft?.savedAt ? new Date(edit.session.draft.savedAt).getTime() : NaN
  return Number.isFinite(ms) ? formatCrtime(ms).slice(11, 16) : ''
})
const flashRing = 'ring-2 ring-amber-400 dark:ring-amber-500 rounded'
const badge = 'px-2 py-0.5 rounded text-xs font-medium'
const btn = 'h-8 px-3 rounded-lg text-sm'
</script>

<template>
  <div class="bg-white dark:bg-dark-card rounded-lg border border-gray-200 dark:border-dark-border px-3 py-2 flex items-center gap-3 flex-wrap" data-testid="se-bar">
    <button :class="btn" class="bg-primary-500 hover:bg-primary-600 text-white font-medium" data-testid="se-load" @click="$emit('load')">{{ t('SEW_UI_LOAD') }}</button>
    <button v-if="edit.editable" :class="btn" class="bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-100 font-medium" data-testid="se-save" @click="onSave">{{ t('SEW_SAVE_OPEN') }}</button>
    <template v-if="sk">
      <div class="min-w-0">
        <div class="font-mono text-sm text-gray-900 dark:text-white truncate" data-testid="se-bar-id">{{ sk.id }}</div>
        <div class="text-xs text-gray-500 dark:text-gray-400 truncate"><span ref="descEl" tabindex="-1" class="outline-none focus:ring-2 focus:ring-primary-400 rounded" data-testid="se-bar-description">{{ sk.header.description }}</span>
          · <span ref="timeoutEl" tabindex="-1" class="outline-none focus:ring-2 focus:ring-primary-400 rounded" data-testid="se-bar-timeout">제한 {{ sk.header.timeoutLimit }}분</span></div>
      </div>
      <div class="flex items-center gap-1.5 flex-wrap text-xs">
        <span :class="badge" class="bg-primary-100 text-primary-800 dark:bg-primary-900/30 dark:text-primary-400" data-testid="se-bar-version">
          {{ sk.version.isCurrent ? t('SEW_UI_CURRENT_VERSION') : t('SEW_UI_OLD_VERSION') }} · {{ formatCrtime(sk.version.crtime) }}</span>
        <template v-if="sk.property">
          <span :class="[badge, sk.property.IsEnabled ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-400']">
            {{ enabledLabel(sk.property.IsEnabled) }}</span>
          <span :class="badge" class="bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300">{{ scenarioTypeLabel(sk.property.Type) }}</span>
        </template>
        <span v-if="sk.performance" :class="badge" class="bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300">등급 {{ sk.performance.gradeName }}</span>
        <span v-if="draftTime" :class="badge" class="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" data-testid="se-bar-draft">{{ t('SEW_SAVE_BAR_DRAFT', { time: draftTime }) }}</span>
      </div>
      <div class="text-xs text-gray-600 dark:text-gray-300 min-w-0" data-testid="se-bar-target-window">
        <div class="truncate">{{ twText }}</div>
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
      <button v-if="sk" :class="btn" class="bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300" data-testid="se-property" @click="showProperty = true">{{ t('SEW_UI_PROPERTY_ALL') }}</button>
    </div>
    <!-- 시나리오 단위 경고·알림 줄(바 아래 칸 전체). 본문이 깨져 스텝이 0개일 때도 여기서 원인이 보인다. -->
    <div v-if="sk && scenarioNotes.length" ref="notesEl" tabindex="-1" class="basis-full flex flex-wrap gap-x-4 gap-y-0.5 text-xs outline-none px-1 -mx-1"
      :class="flash ? flashRing : ''" data-testid="se-scenario-notes" :data-flash="String(flash)">
      <span v-for="(n, i) in scenarioNotes" :key="i" :class="n.level === 'warning' ? 'text-amber-700 dark:text-amber-300' : 'text-gray-600 dark:text-gray-300'">
        {{ n.level === 'warning' ? '⚠' : 'ⓘ' }} {{ noteMessage(n) }}</span>
    </div>
    <PropertyDialog v-model="showProperty" />
    <DataCheckDialog v-model="showDataCheck" />
    <SaveDialog @bar="focusBar" @property="showProperty = true" />
  </div>
</template>

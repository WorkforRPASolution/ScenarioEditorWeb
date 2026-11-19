<script setup>
// 불러오기 창 오른쪽 칸 — 쓰기 사용자(P2-D Task 7, 목업 2026-11-08-load-write-v1 paneWrite·switchBox·versionItems).
// 위에서부터 이름(편집 화면에 열려 있으면 그 표시) → 켜짐 스위치 상자 → 버전 목록(내 초안 줄 맨 위) → [시나리오 지우기…].
// 켜기·끄기와 초안 지우기는 부모가 준 함수(requestEnabled·requestDraftDelete)로 보내고 이 칸은 진행·결과만 보인다. 행이 바뀌면 부모가 key 로 새로 만든다(칸 상태가 남지 않게).
// 서버 호출과 목록·편집 세션 고침은 부모가 한다 — 요청 중에 다른 행을 고르면 이 칸이 사라지고 사라진 칸의 emit 은 버려지기 때문이다(SEW-020).
import { ref, computed, nextTick } from 'vue'
import { t, errorCode, errorMessage } from '../../messages'
import { formatCrtime, enabledLabel } from '../../format'
import { draftStale, isDup, draftTarget } from '../../editor/loadRows'

const props = defineProps({
  process: { type: String, required: true },
  model: { type: String, required: true },
  row: { type: Object, required: true },
  versions: { type: Array, default: () => [] },
  versionsError: { type: String, default: '' },
  pick: { type: [String, Number], default: null }, // 고른 버전 crtime 또는 'draft'
  // 편집 화면에 이 시나리오가 열려 있으면 { changes, propertyChanged, enabled, draftId }, 아니면 null
  open: { type: Object, default: null },
  draftOpenDraftId: { type: String, default: null }, // 편집 화면이 쓰는 초안 id(이 초안을 지우면 그 세션이 초안 그림을 잃는다)
  requestEnabled: { type: Function, required: true }, // (이름, 켤지) → 서버가 준 { isEnabled, propertyRev } — 목록 고침·토스트는 부모가 한다
  requestDraftDelete: { type: Function, required: true } // (초안 id) → 지우고 목록·편집 세션에서 빼는 것까지 부모가 한다
})
const emit = defineEmits(['pick', 'open-version', 'delete', 'relist'])

const short = (ms) => formatCrtime(ms).slice(5, 16)
const savedMs = (d) => Date.parse(d.savedAt)
const draft = computed(() => props.row.draft)
const stale = computed(() => draftStale(props.row))
const dup = computed(() => isDup(props.row))
const target = computed(() => draftTarget(props.row, props.model))
const draftSelected = computed(() => !!draft.value && (props.pick === 'draft' || !!props.row.draftOnly))
const draftSub = computed(() => {
  const r = props.row
  const d = draft.value
  if (r.draftOnly === 'new') return t('SEW_LOAD_DRAFT_SUB_NEW')
  if (r.draftOnly === 'gone') return t('SEW_LOAD_DRAFT_SUB_GONE')
  if (stale.value) return t('SEW_LOAD_DRAFT_SUB_STALE', { at: short(d.base?.crtime ?? d.headCrtime) })
  if (d.base && d.base.crtime !== r.currentCrtime) return t('SEW_LOAD_DRAFT_SUB_OLD', { at: short(d.base.crtime) })
  return t('SEW_LOAD_DRAFT_SUB_CURRENT')
})

// ── 켜기·끄기: 확인 창 없이 바로(수정 이력에 남고 바로 다시 켤 수 있다, 40 §2.0 2026-11-09) ──
const busy = ref(false)
const note = ref(null) // { on, at }
const failure = ref(null) // { text, relist }
const switchEl = ref(null)
async function toggle() {
  if (busy.value || dup.value) return
  const next = props.row.isEnabled !== true
  busy.value = true
  note.value = null
  failure.value = null
  try {
    const r = await props.requestEnabled(props.row.name, next)
    note.value = { on: r.isEnabled, at: formatCrtime(Date.now()).slice(11) }
  } catch (e) {
    const code = errorCode(e)
    const unknown = ['UPSTREAM_TIMEOUT', 'TIMEOUT', 'NETWORK'].includes(code) || (code === 'UNKNOWN' && e?.response?.status >= 500)
    failure.value = code === 'NOT_FOUND' ? { text: t('SEW_LOAD_SWITCH_FAILED', { cause: t('SEW_LOAD_SWITCH_CAUSE_NOT_FOUND') }), relist: true }
      : unknown ? { text: t('SEW_LOAD_SWITCH_UNKNOWN'), relist: true } : { text: t('SEW_LOAD_SWITCH_FAILED', { cause: errorMessage(e) }), relist: false }
  } finally {
    busy.value = false
    await nextTick()
    switchEl.value?.focus()
  }
}

// ── 초안 지우기: 그 자리에서 한 번 더 묻는다(웹 서버에만 있는 작업이라 되살릴 길이 없다) ──
const asking = ref(false)
const deleting = ref(false)
const draftError = ref('')
const askGoEl = ref(null)
async function ask() { asking.value = true; draftError.value = ''; await nextTick(); askGoEl.value?.focus() }
async function deleteDraft() {
  if (deleting.value) return
  const id = draft.value.draftId
  deleting.value = true
  try {
    await props.requestDraftDelete(id)
    asking.value = false
  } catch (e) {
    draftError.value = t('SEW_LOAD_DRAFT_DELETE_FAILED', { cause: errorMessage(e) })
  } finally {
    deleting.value = false
  }
}

const versionsHead = computed(() => (props.row.draftOnly ? t('SEW_LOAD_MY_DRAFT') : t('SEW_LOAD_VERSIONS')))
const versionsCount = computed(() => (props.row.draftOnly ? '' : t(draft.value ? 'SEW_LOAD_VERSIONS_COUNT_DRAFT' : 'SEW_LOAD_VERSIONS_COUNT', { n: props.versions.length })))
const box = 'border border-gray-200 dark:border-dark-border rounded-lg px-2.5 py-2 flex flex-col gap-0.5 shrink-0'
const link = 'text-xs font-medium underline underline-offset-2'
</script>

<template>
  <div class="p-3 flex flex-col gap-2 min-h-0 min-w-0 h-full" data-testid="se-load-pane">
    <div class="min-w-0">
      <div class="font-mono font-semibold text-sm text-gray-900 dark:text-gray-100 truncate" :title="row.name" data-testid="se-load-pane-name">{{ row.name }}</div>
      <div v-if="open" class="text-[11px]" :class="open.changes ? 'text-amber-700 dark:text-amber-300' : 'text-gray-500'" data-testid="se-load-pane-open">
        {{ open.changes ? t('SEW_LOAD_PANE_OPEN_CHANGED', { n: open.changes }) : t('SEW_LOAD_PANE_OPEN') }}</div>
    </div>

    <div v-if="row.draftOnly" :class="box" class="bg-gray-50 dark:bg-dark-bg text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
      {{ t(row.draftOnly === 'new' ? 'SEW_LOAD_DRAFT_ONLY_NEW' : 'SEW_LOAD_DRAFT_ONLY_GONE') }}</div>
    <div v-else-if="dup" :class="box" data-testid="se-load-dup">
      <div class="flex items-center gap-2"><b class="text-sm">?</b><span class="text-[11px] text-gray-500">{{ t('SEW_LOAD_DUP_HEAD') }}</span></div>
      <div class="text-xs text-red-600 dark:text-red-400">{{ t('SEW_LOAD_DUP_BODY') }}</div>
    </div>
    <div v-else :class="box">
      <div class="flex items-center gap-2">
        <button ref="switchEl" type="button" role="switch" :aria-checked="String(row.isEnabled === true)" :aria-label="t('SEW_LOAD_SWITCH_LABEL')" :disabled="busy"
          class="se-load-sw" data-testid="se-load-switch" @click="toggle" />
        <b class="text-sm text-gray-900 dark:text-gray-100">{{ enabledLabel(row.isEnabled) }}</b>
        <template v-if="busy"><span class="se-load-spin" aria-hidden="true" /><span class="text-[11px] text-gray-500">{{ t('SEW_LOAD_SWITCH_BUSY') }}</span></template>
      </div>
      <div class="text-xs text-gray-700 dark:text-gray-300">{{ t(row.isEnabled === true ? 'SEW_LOAD_RUNS_ON' : 'SEW_LOAD_RUNS_OFF') }}</div>
      <div v-if="failure" class="text-xs text-red-600 dark:text-red-400" role="alert" data-testid="se-load-switch-error">
        {{ failure.text }} <button v-if="failure.relist" type="button" :class="link" class="text-primary-700 dark:text-primary-300" data-testid="se-load-relist" @click="emit('relist')">{{ t('SEW_LOAD_RELIST') }}</button></div>
      <div v-else-if="note" class="text-[11px] text-green-700 dark:text-green-400" data-testid="se-load-switch-note">{{ t(note.on ? 'SEW_LOAD_SWITCH_DONE_ON' : 'SEW_LOAD_SWITCH_DONE_OFF', { time: note.at }) }}</div>
      <div v-else class="text-[11px] text-gray-500">{{ t('SEW_LOAD_SWITCH_HINT') }}</div>
      <div v-if="open?.propertyChanged" class="text-[11px] leading-snug rounded-md px-2 py-1 mt-0.5 bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" data-testid="se-load-property-note">
        {{ t('SEW_LOAD_PROPERTY_NOTE', { state: enabledLabel(open.enabled) }) }}</div>
    </div>

    <div class="text-xs font-semibold text-gray-700 dark:text-gray-200 flex items-baseline gap-1.5 shrink-0">{{ versionsHead }} <small class="font-normal text-gray-500">{{ versionsCount }}</small></div>
    <p v-if="versionsError" class="text-xs text-red-600" data-testid="se-load-versions-error">{{ versionsError }}</p>
    <ul class="flex-1 min-h-0 overflow-auto flex flex-col gap-0.5 text-sm" role="listbox" :aria-label="t('SEW_LOAD_VERSIONS')">
      <template v-if="draft">
        <li role="option" tabindex="0" :aria-selected="String(draftSelected)" class="se-load-vd px-2 py-1.5 rounded-md cursor-pointer flex items-start gap-2 shrink-0 text-gray-900 dark:text-gray-100"
          data-testid="se-load-draft-line" @click="emit('pick', 'draft')" @dblclick="emit('open-version', 'draft')" @keydown.enter.prevent="emit('open-version', 'draft')">
          <div class="flex-1 min-w-0">
            <div><b class="text-xs font-semibold">{{ t('SEW_LOAD_MY_DRAFT') }}</b> <span class="font-mono text-xs text-gray-700 dark:text-gray-200">{{ short(savedMs(draft)) }}</span></div>
            <div class="text-[11px] leading-snug" :class="stale ? 'text-amber-700 dark:text-amber-300' : 'text-gray-500'">{{ draftSub }}</div>
            <div v-if="target" class="text-[11px] leading-snug text-gray-500">{{ t('SEW_LOAD_DRAFT_SUB_TARGET', { target }) }}</div>
          </div>
          <span class="se-load-vtag">{{ t('SEW_LOAD_DRAFT_TAG') }}</span>
        </li>
        <div v-if="draftSelected && asking" class="px-2 pb-1.5 text-xs flex flex-wrap items-center gap-x-2 gap-y-0.5 shrink-0" data-testid="se-load-draft-delete-ask">
          <span class="basis-full text-gray-700 dark:text-gray-200">{{ t('SEW_LOAD_DRAFT_DELETE_ASK') }}</span>
          <span v-if="draftOpenDraftId === draft.draftId" class="basis-full text-amber-700 dark:text-amber-300">{{ t('SEW_LOAD_DRAFT_DELETE_ASK_OPEN') }}</span>
          <span class="flex-1" />
          <button type="button" :class="link" class="text-primary-700 dark:text-primary-300" :disabled="deleting" data-testid="se-load-draft-delete-no" @click="asking = false">{{ t('SEW_LOAD_CANCEL') }}</button>
          <button ref="askGoEl" type="button" :class="link" class="text-red-600 dark:text-red-400" :disabled="deleting" data-testid="se-load-draft-delete-go" @click="deleteDraft">{{ t('SEW_LOAD_DELETE_GO') }}</button>
        </div>
        <div v-else-if="draftSelected" class="px-2 pb-1.5 text-xs flex items-center gap-2 shrink-0">
          <button type="button" :class="link" class="text-red-600 dark:text-red-400" data-testid="se-load-draft-delete" @click="ask">{{ t('SEW_LOAD_DRAFT_DELETE') }}</button>
          <span class="text-[11px] text-gray-500">{{ t('SEW_LOAD_DRAFT_DELETE_HINT') }}</span>
        </div>
        <p v-if="draftError" class="px-2 text-xs text-red-600" role="alert">{{ draftError }}</p>
      </template>
      <li v-for="v in versions" :key="v.crtime" role="option" tabindex="0" :aria-selected="String(pick === v.crtime)" data-testid="se-load-version"
        class="px-2 py-1.5 rounded-md cursor-pointer flex items-center gap-2 shrink-0"
        :class="pick === v.crtime ? 'bg-primary-100 dark:bg-primary-900/30' : 'hover:bg-gray-100 dark:hover:bg-dark-border'"
        @click="emit('pick', v.crtime)" @dblclick="emit('open-version', v.crtime)" @keydown.enter.prevent="emit('open-version', v.crtime)">
        <span class="font-mono text-xs text-gray-800 dark:text-gray-200">{{ formatCrtime(v.crtime) }}</span>
        <span v-if="v.isCurrent" class="se-load-vtag">{{ t('SEW_LOAD_CURRENT_TAG') }}</span>
      </li>
    </ul>
    <p v-if="versions.length" class="text-[11px] text-gray-500 shrink-0">{{ t('SEW_UI_LOAD_VERSION_HINT') }}</p>

    <div v-if="!row.draftOnly" class="shrink-0 border-t border-gray-200 dark:border-dark-border pt-2">
      <button type="button" class="se-load-btn-del" :disabled="dup || busy" data-testid="se-load-delete" @click="emit('delete')">{{ t('SEW_LOAD_DELETE_OPEN') }}</button>
    </div>
  </div>
</template>

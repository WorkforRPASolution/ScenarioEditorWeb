<script setup>
// 시험 줄(P4 설계 §4.1~§4.5) — "찾는 것" 아래: 시험할 화면·시험 정확도·[시험], 그 아래 결과. 편집 패널(StepPanel)과 읽기 전용 상세(StepDetail)가 함께 쓴다.
// 시험은 스텝·초안을 바꾸지 않는다 — [스텝에 넣기] 만 부모에게 값을 알린다(accept). 상태·서버 호출은 visionTestStore, 큰 화면의 겹침(TestLayer)도 그 결과를 읽는다.
// 이 부품이 지금의 시험 입력 키·값 키를 저장소에 알린다(sync): 키가 바뀌면 결과를 지우고, 값만 바뀌면 흐리게. 사라질 때도 지운다.
import { ref, computed, watch, onUnmounted } from 'vue'
import { useVisionTestStore } from '../../stores/visionTestStore'
import { useSnapshotStore } from '../../stores/snapshotStore'
import { acceptOf, acceptWarn, blockReason, testKey, valueKey } from '../../editor/visionTest'
import { t } from '../../messages'
import './panel.css'

defineOptions({ name: 'TestStation' })
const props = defineProps({
  input: { type: Object, default: null }, // editor/visionTest 의 시험 입력(이미지·OCR 스텝이 아니면 null)
  editable: { type: Boolean, default: false }, // 편집 패널이면 true — [스텝에 넣기] 가 보인다
  about: { type: Object, default: null } // 서버 로그에 남길 "무엇을 시험했는지"
})
const emit = defineEmits(['accept'])
const store = useVisionTestStore()
const snap = useSnapshotStore()
const CONF_MAX = 100 // 글자별 신뢰도는 여기까지만 보인다

const isImage = computed(() => props.input?.kind === 'image')
const hasSnapshot = computed(() => !!snap.shownImage())
const accept = computed(() => (isImage.value ? acceptOf(store.acceptText) : null))
const screen = computed(() => store.screenNow())
const run = computed(() => store.run)
const running = computed(() => run.value.status === 'running')
const reason = computed(() => blockReason(props.input, { screen: screen.value, accept: accept.value, running: running.value }))
const canApply = computed(() => accept.value !== null && accept.value >= 0.5 && accept.value !== props.input?.accept)

// 시험 칸은 패널(읽기 전용이면 스텝)의 정확도를 따라간다 — 이 감시자가 아래 sync 보다 먼저 돈다
watch(() => [props.input?.uid ?? null, props.input?.accept ?? null], ([uid, panelAccept]) => store.syncAccept(panelAccept, uid), { immediate: true })
watch(() => [testKey(props.input, screen.value), props.input ? valueKey(props.input, accept.value) : null], ([key, vkey]) => store.sync(key, vkey), { immediate: true })

// "시험 중… n초"
const now = ref(Date.now())
let timer = null
const stopTimer = () => { if (timer) clearInterval(timer); timer = null }
watch(running, (on) => {
  stopTimer()
  if (!on) return
  now.value = Date.now()
  timer = setInterval(() => { now.value = Date.now() }, 500)
}, { immediate: true })
const seconds = computed(() => Math.max(0, Math.floor((now.value - (run.value.startedAt ?? now.value)) / 1000)))
onUnmounted(() => { stopTimer(); store.close() })

const start = () => { if (props.input && !reason.value) store.start(props.input, { about: props.about }) }
const applyAccept = () => { if (canApply.value) emit('accept', accept.value) }

const done = computed(() => run.value.status === 'done')
const results = computed(() => (done.value && run.value.kind === 'image' ? run.value.results : []))
const headText = computed(() => {
  const r = run.value
  if (r.kind === 'ocr') return t(r.accepted ? 'SEW_TEST_OCR_OK' : 'SEW_TEST_OCR_NO', { ms: r.ms })
  return r.results.length ? t('SEW_TEST_FOUND', { n: r.results.length, ms: r.ms }) : t('SEW_TEST_NOT_FOUND', { ms: r.ms })
})
const headOk = computed(() => (run.value.kind === 'ocr' ? run.value.accepted : run.value.verdict.ok))
const ruleText = computed(() => {
  const rule = run.value.verdict?.rule
  return rule ? t('SEW_TEST_RULE', { rule: t(`SEW_TEST_RULE_${rule.op}`, { count: rule.count }), n: results.value.length }) : ''
})
const rowNo = (i) => (i === 0 && run.value.click ? t('SEW_TEST_ROW_CLICK', { n: 1 }) : String(i + 1))
const confEach = computed(() => (run.value.confidence?.values ?? []).slice(0, CONF_MAX).join(' '))

const lab = 'shrink-0 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap'
const btn = 'h-7 px-2.5 rounded-md text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed'
const cell = 'px-1.5 py-0.5 text-right tabular-nums'
</script>

<template>
  <div v-if="input" data-testid="se-test" :data-kind="input.kind">
    <div class="rounded-lg border border-primary-100 dark:border-primary-900/50 bg-primary-50/60 dark:bg-primary-900/15 px-2.5 py-2">
      <div class="flex items-baseline gap-2 mb-1.5">
        <span class="text-xs font-semibold text-gray-700 dark:text-gray-200">{{ t('SEW_TEST_TITLE') }}</span>
        <span class="text-[11px] text-gray-500 dark:text-gray-400">{{ editable ? t('SEW_TEST_HINT') : t('SEW_TEST_HINT_READONLY') }}</span>
      </div>
      <div class="flex items-center gap-1.5">
        <label for="se-test-screen" :class="lab">{{ t('SEW_TEST_SCREEN') }}</label>
        <select id="se-test-screen" class="se-inp flex-1" data-testid="se-test-screen" :value="store.screen" @change="store.setScreen($event.target.value)">
          <option value="base">{{ t('SEW_TEST_SCREEN_BASE') }}</option>
          <option value="snapshot" :disabled="!hasSnapshot">{{ hasSnapshot ? t('SEW_TEST_SCREEN_SNAPSHOT') : t('SEW_TEST_SCREEN_SNAPSHOT_NONE') }}</option>
        </select>
      </div>
      <div v-if="isImage" class="mt-1.5 flex items-center gap-1.5">
        <label for="se-test-accept" :class="lab">{{ t('SEW_TEST_ACCEPT') }}</label>
        <input id="se-test-accept" class="se-inp se-inp-n" :class="{ 'se-inp-bad': accept === null }" inputmode="decimal" data-testid="se-test-accept" :value="store.acceptText" @input="store.setAccept($event.target.value)">
        <button v-if="editable" type="button" :class="btn" class="ml-auto text-primary-700 dark:text-primary-300 hover:enabled:underline" data-testid="se-test-apply"
          :disabled="!canApply" :title="t('SEW_TEST_APPLY_ACCEPT_HINT')" @click="applyAccept">{{ t('SEW_TEST_APPLY_ACCEPT') }}</button>
      </div>
      <p v-if="isImage && acceptWarn(accept)" class="mt-1 text-[11px] leading-snug text-amber-700 dark:text-amber-300" data-testid="se-test-accept-low">{{ t('SEW_TEST_ACCEPT_LOW') }}</p>
      <div class="mt-2 flex items-center gap-1.5">
        <button type="button" :class="btn" class="text-white bg-primary-500 hover:enabled:bg-primary-600" data-testid="se-test-run" :disabled="!!reason" :title="reason ? t(reason) : undefined" @click="start">{{ t('SEW_TEST_RUN') }}</button>
        <button v-if="run.status === 'done' || run.status === 'error'" type="button" :class="btn" class="bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600" data-testid="se-test-close" @click="store.close()">{{ t('SEW_TEST_CLOSE') }}</button>
        <span v-if="running" class="text-xs text-gray-500 dark:text-gray-400" role="status" data-testid="se-test-progress">{{ t('SEW_TEST_RUNNING', { n: seconds }) }}</span>
      </div>

      <div v-if="run.status === 'done' || run.status === 'error'" class="mt-2 text-xs" data-testid="se-test-result" :data-status="run.status" :data-stale="run.stale ? 'true' : 'false'">
        <p v-if="run.status === 'error'" class="leading-snug text-red-700 dark:text-red-300" role="alert" data-testid="se-test-error">{{ run.message }}</p>
        <template v-else>
          <p v-if="run.stale" class="mb-1 leading-snug text-amber-700 dark:text-amber-300" data-testid="se-test-stale">{{ t('SEW_TEST_STALE') }}</p>
          <div :class="run.stale ? 'opacity-50' : ''">
            <div class="font-semibold" :class="headOk ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-300'" data-testid="se-test-head" :data-ok="headOk ? 'true' : 'false'">{{ headText }}</div>
            <template v-if="run.kind === 'image'">
              <div v-if="results.length" class="mt-1 max-h-[150px] overflow-auto rounded border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-card">
                <table class="w-full border-collapse">
                  <thead class="sticky top-0 bg-gray-50 dark:bg-dark-bg text-gray-500 dark:text-gray-400">
                    <tr><th class="px-1.5 py-0.5 text-left font-medium">{{ t('SEW_TEST_COL_NO') }}</th><th :class="cell" class="font-medium">{{ t('SEW_TEST_COL_SCORE') }}</th><th :class="cell" class="font-medium">X</th><th :class="cell" class="font-medium">Y</th></tr>
                  </thead>
                  <tbody>
                    <tr v-for="(r, i) in results" :key="i" class="cursor-pointer border-t border-gray-100 dark:border-dark-border" :class="run.picked === i ? 'bg-primary-100 dark:bg-primary-900/40 font-semibold' : 'hover:bg-gray-50 dark:hover:bg-gray-700/40'"
                      data-testid="se-test-row" :aria-selected="run.picked === i ? 'true' : 'false'" @click="store.pick(i)">
                      <td class="px-1.5 py-0.5 text-left whitespace-nowrap">{{ rowNo(i) }}</td><td :class="cell">{{ r.score.toFixed(4) }}</td><td :class="cell">{{ r.x }}</td><td :class="cell">{{ r.y }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p v-if="ruleText" class="mt-1 text-gray-700 dark:text-gray-200" data-testid="se-test-rule">{{ ruleText }}</p>
              <p v-if="!results.length" class="mt-1 leading-snug text-gray-500 dark:text-gray-400" data-testid="se-test-note">{{ t('SEW_TEST_NOTE_NONE') }}</p>
            </template>
            <template v-else>
              <div class="mt-1 text-gray-500 dark:text-gray-400">{{ run.numeric ? t('SEW_TEST_OCR_READ_NUMBER') : t('SEW_TEST_OCR_READ') }}</div>
              <ul class="mt-0.5 max-h-[110px] overflow-auto rounded border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-card px-1.5 py-1 font-mono break-all">
                <li v-for="(line, i) in run.lines" :key="i" data-testid="se-test-line">{{ line }}</li>
                <li v-if="!run.lines.length" class="font-sans text-gray-400" data-testid="se-test-line">{{ t('SEW_TEST_OCR_EMPTY') }}</li>
              </ul>
              <p v-if="run.confidence.values.length" class="mt-1 leading-snug text-gray-700 dark:text-gray-200 break-words" data-testid="se-test-conf">
                {{ t('SEW_TEST_OCR_CONF', { min: run.confidence.min }) }}
                <span class="block text-gray-500 dark:text-gray-400 tabular-nums">{{ t('SEW_TEST_OCR_CONF_EACH', { list: confEach }) }}</span>
              </p>
              <p v-if="run.noSuffix" class="mt-1 leading-snug text-gray-500 dark:text-gray-400" data-testid="se-test-nosuffix">{{ t('SEW_TEST_OCR_NO_SUFFIX') }}</p>
            </template>
            <p class="mt-1 leading-snug text-gray-500 dark:text-gray-400" data-testid="se-test-note">{{ t('SEW_TEST_NOTE') }}</p>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

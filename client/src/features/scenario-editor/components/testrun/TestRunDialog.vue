<script setup>
// 시험 실행 창(P5 설계 §4) — 시나리오 바의 [시험 실행] 이 연다. 편집기에 시나리오를 열지 않아도 창 안에서 공정·모델·시나리오를 고른다.
// 고르기(선택 줄 + 설비 표 | 실행 조건) → 실행 전 확인 → 결과(차례로 보내는 진행·설비별 요청 결과와 실행 상태). 스텝·초안을 바꾸지 않는다.
// 설비에서 도는 것은 늘 설비에 배포된 현재 판이다 — 편집기에서 고친 내용은 시험되지 않는다.
import { ref, computed, watch, nextTick } from 'vue'
import { useTestRunStore } from '../../stores/testRunStore'
import { summarize } from '../../editor/testRun'
import { formatCrtime } from '../../format'
import { t } from '../../messages'
import ModalShell from '../ModalShell.vue'
import TestRunPick from './TestRunPick.vue'
import TestRunTargets from './TestRunTargets.vue'
import TestRunForm from './TestRunForm.vue'
import TestRunResult from './TestRunResult.vue'
import './testrun.css'

defineOptions({ name: 'TestRunDialog' })
const run = useTestRunStore()
const info = computed(() => run.info.data)
const result = computed(() => run.stage === 'running' || run.stage === 'done')
const why = computed(() => (run.block ? t(run.block.key, run.block.params) : ''))
const reasonLabel = computed(() => (run.reasonKind === 'other' ? run.reasonText.trim() : t(`SEW_RUN_REASON_KIND_${run.reasonKind}`)))
const stepNo = computed(() => String(run.startStep).trim())
const summary = computed(() => (run.block ? t('SEW_RUN_CANNOT', { why: why.value }) : t('SEW_RUN_READY', { name: run.sel.name, n: run.picked.size, step: stepNo.value, reason: reasonLabel.value })))
// 선택 줄 아래의 안내: 막는 까닭(붉게) 또는 "배포된 현재 판이 돕니다" + 편집기에 연 시나리오와의 관계
const blockText = computed(() => (info.value?.blocks?.length ? t(`SEW_ERR_${info.value.blocks[0]}`) : ''))
const note = computed(() => {
  if (!info.value || blockText.value) return null
  if (run.relation === 'dirty') return { kind: 'dirty', text: t('SEW_RUN_NOTE_DIRTY') }
  if (run.relation === 'old') return { kind: 'old', text: t('SEW_RUN_NOTE_OLD') }
  return { kind: 'current', text: t('SEW_RUN_NOTE_CURRENT') }
})
const target = computed(() => {
  if (!info.value) return null
  const c = info.value.current
  return { id: `${run.sel.process}-${run.sel.model}-${run.sel.name}`, meta: c ? t('SEW_RUN_TARGET_META', { at: formatCrtime(c.crtime), n: c.stepCount ?? '?' }) : '' }
})
const sum = computed(() => summarize(run.run?.items ?? []))

// 확인 창: 처음 초점은 [취소] — Enter 로 바로 실행되지 않는다
const cancelBtn = ref(null)
const confirmIds = computed(() => [...run.picked].sort())
const ago = (at) => { const n = Math.floor((Date.now() - at) / 60_000); return n < 1 ? t('SEW_RUN_AGO_NOW') : t('SEW_RUN_AGO_MIN', { n }) }
watch(() => run.stage, async (s) => { if (s === 'confirm') { await nextTick(); cancelBtn.value?.focus() } })

// 닫기: 보내는 중이면 한 번 묻는다(닫으면 남은 설비는 보내지 않는다)
const closing = ref(false)
function close() {
  if (run.stage === 'running') { closing.value = true; return }
  run.hide()
}
function closeAnyway() { closing.value = false; run.hide() }
watch(() => run.stage, (s) => { if (s !== 'running') closing.value = false })
const onShell = (v) => { if (!v) close() }

const btnS = 'h-8 px-3 rounded-lg text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:enabled:bg-gray-300 dark:hover:enabled:bg-gray-600 disabled:opacity-50'
const btnP = 'h-8 px-3 rounded-lg text-sm bg-primary-500 hover:enabled:bg-primary-600 text-white font-medium disabled:opacity-50'
</script>

<template>
  <ModalShell :model-value="run.open" :title="t('SEW_RUN_TITLE')" :width="1160" :height="680" testid="se-run" @update:model-value="onShell">
    <div class="relative h-full flex flex-col min-h-0 text-gray-800 dark:text-gray-100">
      <div class="px-5 pt-3 pb-2.5 flex flex-col gap-2 border-b border-gray-200 dark:border-dark-border shrink-0">
        <TestRunPick />
        <p v-if="run.scenarios.status === 'error'" class="se-run-note" data-kind="block" data-testid="se-run-list-error">{{ t('SEW_RUN_LIST_FAILED', { message: run.scenarios.message }) }}</p>
        <div v-if="target" class="flex flex-wrap items-baseline gap-x-3 gap-y-0.5" data-testid="se-run-target">
          <span class="se-run-mono text-[13px] break-all">{{ target.id }}</span><span class="text-xs text-gray-500 dark:text-gray-400 tabular-nums">{{ target.meta }}</span>
        </div>
        <p v-if="blockText" class="se-run-note" data-kind="block" role="alert" data-testid="se-run-block">{{ blockText }}</p>
        <p v-else-if="note" class="se-run-note" :data-kind="note.kind" data-testid="se-run-note">{{ note.text }}</p>
      </div>
      <div class="flex-1 min-h-0">
        <TestRunResult v-if="result" />
        <div v-else class="se-run-body h-full px-5 py-3">
          <TestRunTargets />
          <TestRunForm />
        </div>
      </div>
      <!-- 실행 전 확인 — 창을 가리고 한 번 묻는다 -->
      <div v-if="run.stage === 'confirm'" class="absolute inset-0 z-10 bg-black/30 flex items-center justify-center" @click.self="run.cancel()">
        <div class="w-[460px] max-w-[calc(100%-40px)] bg-white dark:bg-dark-card border border-gray-200 dark:border-dark-border rounded-xl shadow-2xl p-[18px] flex flex-col gap-2.5 text-sm" role="alertdialog" aria-modal="true"
          aria-labelledby="se-run-confirm-title" data-testid="se-run-confirm" @keydown.esc.stop="run.cancel()">
          <p id="se-run-confirm-title" class="font-semibold" data-testid="se-run-confirm-title">{{ t('SEW_RUN_CONFIRM_TITLE', { n: run.picked.size, name: run.sel.name, step: stepNo }) }}</p>
          <p>{{ t('SEW_RUN_CONFIRM_REAL') }} {{ t('SEW_RUN_CONFIRM_REASON', { reason: reasonLabel }) }}</p>
          <p class="se-run-mono text-xs text-gray-500 dark:text-gray-400 break-all">{{ confirmIds.slice(0, 4).join(' · ') }}{{ confirmIds.length > 4 ? t('SEW_RUN_CONFIRM_MORE', { n: confirmIds.length - 4 }) : '' }}</p>
          <p v-if="run.relation === 'dirty'" class="text-xs text-amber-700 dark:text-amber-300">{{ t('SEW_RUN_NOTE_DIRTY') }}</p>
          <p v-if="(run.relation === 'dirty' || run.relation === 'old') && stepNo !== '1'" class="se-run-err">{{ t('SEW_RUN_STEP_MISMATCH', { n: stepNo }) }}</p>
          <div v-if="run.recentPicked.length" class="text-xs flex flex-col gap-1" data-testid="se-run-confirm-recent">
            <p class="text-amber-700 dark:text-amber-300">{{ t('SEW_RUN_CONFIRM_RECENT', { n: run.recentPicked.length }) }}</p>
            <p v-for="r in run.recentPicked.slice(0, 5)" :key="r.eqpId" class="se-run-mono text-gray-500 dark:text-gray-400">{{ t('SEW_RUN_CONFIRM_RECENT_ONE', { eqp: r.eqpId, ago: ago(r.at), by: r.by }) }}</p>
            <label class="flex items-center gap-1.5 select-none"><input v-model="run.again" type="checkbox" data-testid="se-run-confirm-again" />{{ t('SEW_RUN_CONFIRM_AGAIN') }}</label>
          </div>
          <div class="mt-1 flex justify-end gap-2">
            <button ref="cancelBtn" type="button" :class="btnS" data-testid="se-run-confirm-cancel" @click="run.cancel()">{{ t('SEW_RUN_CANCEL') }}</button>
            <button type="button" :class="btnP" data-testid="se-run-confirm-ok" @click="run.start()">{{ t('SEW_RUN_RUN') }}</button>
          </div>
        </div>
      </div>
      <!-- 보내는 중에 닫으려 할 때 -->
      <div v-if="closing" class="absolute inset-0 z-20 bg-black/30 flex items-center justify-center">
        <div class="w-[420px] max-w-[calc(100%-40px)] bg-white dark:bg-dark-card border border-gray-200 dark:border-dark-border rounded-xl shadow-2xl p-[18px] text-sm" role="alertdialog" aria-modal="true" data-testid="se-run-close-confirm">
          <p>{{ t('SEW_RUN_CLOSE_CONFIRM', { n: run.pending }) }}</p>
          <div class="mt-3.5 flex justify-end gap-2">
            <button type="button" :class="btnS" data-testid="se-run-keep" @click="closing = false">{{ t('SEW_RUN_KEEP') }}</button>
            <button type="button" :class="btnP" data-testid="se-run-close-anyway" @click="closeAnyway">{{ t('SEW_RUN_CLOSE_ANYWAY') }}</button>
          </div>
        </div>
      </div>
    </div>
    <template #footer>
      <template v-if="result">
        <span class="mr-auto self-center text-xs tabular-nums text-gray-600 dark:text-gray-300" data-testid="se-run-result-summary">{{ t('SEW_RUN_SUMMARY', sum) }}</span>
        <button type="button" :class="btnS" :disabled="run.stage !== 'done'" data-testid="se-run-again" @click="run.pickAgain()">{{ t('SEW_RUN_AGAIN') }}</button>
        <button type="button" :class="btnS" data-testid="se-run-close" @click="close">{{ t('SEW_RUN_CLOSE') }}</button>
      </template>
      <template v-else>
        <span class="mr-auto self-center text-xs text-gray-600 dark:text-gray-300 min-w-0 truncate" :title="summary" data-testid="se-run-summary">{{ summary }}</span>
        <button type="button" :class="btnS" data-testid="se-run-close" @click="close">{{ t('SEW_RUN_CLOSE') }}</button>
        <button type="button" :class="btnP" :disabled="!!run.block || run.stage !== 'pick'" :title="why" data-testid="se-run-go" @click="run.ask()">{{ t('SEW_RUN_RUN') }}</button>
      </template>
    </template>
  </ModalShell>
</template>

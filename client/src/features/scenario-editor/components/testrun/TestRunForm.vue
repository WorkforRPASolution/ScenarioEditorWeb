<script setup>
// 시험 실행 창의 실행 조건(P5 설계 §4.4·§4.5) — 실행 사유, 시작 스텝, 운영 속성(읽기 전용: CommandServer 가 읽는 값).
// 운영 속성은 실행할 때 한 번만 바꿔 줄 수 없다(CommandServer 가 SC_PROPERTY 에서 직접 읽는다) — 그래서 보이기만 한다.
import { computed } from 'vue'
import { useTestRunStore } from '../../stores/testRunStore'
import { REASON_KINDS } from '../../editor/testRun'
import { t } from '../../messages'
import '../panel/panel.css'
import './testrun.css'

defineOptions({ name: 'TestRunForm' })
const run = useTestRunStore()
const info = computed(() => run.info.data)
const max = computed(() => info.value?.current?.stepCount ?? null)
const stepNo = computed(() => String(run.startStep).trim())
// 편집기의 번호와 설비에서 도는 번호가 다른 스텝일 수 있다 — 저장하지 않은 고침이 있거나 현재 판이 아닌 세션을 열어 둔 채 1 이 아닌 스텝부터 돌릴 때
const mismatch = computed(() => (run.relation === 'dirty' || run.relation === 'old') && !run.stepErr && stepNo.value !== '1')
const skips = computed(() => ['success', 'stop', 'fail'].filter((k) => info.value?.emailSkip?.[k]).map((k) => t(`SEW_RUN_PROP_SKIP_${k}`)))
const nexts = computed(() => {
  const n = info.value?.next
  return [n?.success ? t('SEW_RUN_PROP_NEXT_SUCCESS', { name: n.success }) : null, n?.fail ? t('SEW_RUN_PROP_NEXT_FAIL', { name: n.fail }) : null].filter(Boolean)
})
const known = computed(() => info.value && info.value.isEnabled !== null)
</script>

<template>
  <div class="se-run-col overflow-auto">
    <div class="se-run-field">
      <span>{{ t('SEW_RUN_REASON') }}</span>
      <div class="flex flex-wrap gap-x-4 gap-y-1">
        <label v-for="k in REASON_KINDS" :key="k" class="flex items-center gap-1.5 select-none">
          <input v-model="run.reasonKind" type="radio" name="se-run-reason" :value="k" :data-testid="`se-run-reason-${k}`" />{{ t(`SEW_RUN_REASON_KIND_${k}`) }}</label>
      </div>
      <input v-if="run.reasonKind === 'other'" v-model="run.reasonText" class="se-inp" :class="{ 'se-inp-bad': run.reasonErr }" type="text" maxlength="200" :placeholder="t('SEW_RUN_REASON_PLACEHOLDER')" :aria-label="t('SEW_RUN_REASON')" :aria-invalid="!!run.reasonErr" data-testid="se-run-reason-text" />
      <span v-if="run.reasonErr" class="se-run-err" data-testid="se-run-reason-error">{{ t(`SEW_RUN_REASON_${run.reasonErr}`) }}</span>
    </div>
    <div class="se-run-field">
      <span>{{ t('SEW_RUN_STEP') }}</span>
      <div class="flex flex-wrap items-center gap-2">
        <input v-model="run.startStep" class="se-inp se-inp-n" :class="{ 'se-inp-bad': info && run.stepErr }" type="text" inputmode="numeric" :aria-label="t('SEW_RUN_STEP')" :aria-invalid="!!(info && run.stepErr)" data-testid="se-run-step" />
        <span v-if="max !== null" class="se-run-hint tabular-nums" data-testid="se-run-step-range">{{ t('SEW_RUN_STEP_RANGE_HINT', { max }) }}</span>
        <span v-if="info && run.stepErr" class="se-run-err" data-testid="se-run-step-error">{{ t(`SEW_RUN_STEP_${run.stepErr}`, { max: max ?? '?' }) }}</span>
      </div>
      <span v-if="run.stepDesc" class="se-run-hint" data-testid="se-run-step-desc">{{ t('SEW_RUN_STEP_DESC', { n: stepNo, desc: run.stepDesc }) }}</span>
      <span v-if="mismatch" class="se-run-err" data-testid="se-run-step-warn">{{ t('SEW_RUN_STEP_MISMATCH', { n: stepNo }) }}</span>
      <span v-if="info" class="se-run-hint">{{ t('SEW_RUN_STEP_INSTALLED') }}</span>
    </div>
    <div class="se-run-field">
      <span>{{ t('SEW_RUN_PROP') }}</span>
      <p v-if="!info" class="m-0 px-3 py-3 text-xs text-gray-500 dark:text-gray-400 border border-dashed border-gray-300 dark:border-dark-border rounded-md" data-testid="se-run-props-empty">
        {{ run.info.status === 'loading' ? t('SEW_RUN_PROP_LOADING') : run.info.status === 'error' ? t('SEW_RUN_LIST_FAILED', { message: run.info.message }) : t('SEW_RUN_PROP_EMPTY') }}</p>
      <p v-else-if="!known" class="m-0 px-3 py-3 text-xs text-gray-500 dark:text-gray-400 border border-dashed border-gray-300 dark:border-dark-border rounded-md" data-testid="se-run-props-empty">{{ t('SEW_RUN_PROP_UNKNOWN') }}</p>
      <dl v-else class="se-run-props" data-testid="se-run-props">
        <dt>{{ t('SEW_RUN_PROP_ENABLED') }}</dt>
        <dd><span class="se-run-pill" :data-tone="info.isEnabled ? 'ok' : 'bad'">{{ info.isEnabled ? t('SEW_RUN_PROP_ENABLED_ON') : t('SEW_RUN_PROP_ENABLED_OFF') }}</span></dd>
        <dt>{{ t('SEW_RUN_PROP_DELAY') }}</dt>
        <dd>{{ t('SEW_RUN_PROP_DELAY_VALUE', { n: info.startDelay }) }}<small v-if="info.startDelay > 0">{{ t('SEW_RUN_PROP_DELAY_HINT', { n: info.startDelay }) }}</small></dd>
        <dt>{{ t('SEW_RUN_PROP_RETRY') }}</dt>
        <dd>{{ t('SEW_RUN_PROP_RETRY_VALUE', { n: info.retryCnt, sec: info.retryInterval }) }}<small v-if="info.retryCnt > 0">{{ t('SEW_RUN_PROP_RETRY_HINT', { n: info.retryCnt }) }}</small></dd>
        <dt>{{ t('SEW_RUN_PROP_PRIORITY') }}</dt>
        <dd>{{ info.priority }}<small>{{ t('SEW_RUN_PROP_PRIORITY_HINT') }}</small></dd>
        <dt>{{ t('SEW_RUN_PROP_NEXT') }}</dt>
        <dd><template v-if="nexts.length">{{ nexts.join(' · ') }}<small>{{ t('SEW_RUN_PROP_NEXT_HINT') }}</small></template><template v-else>{{ t('SEW_RUN_PROP_NONE') }}</template></dd>
        <dt>{{ t('SEW_RUN_PROP_SKIP') }}</dt>
        <dd>{{ skips.length ? t('SEW_RUN_PROP_SKIP_VALUE', { list: skips.join('·') }) : t('SEW_RUN_PROP_NONE') }}</dd>
      </dl>
    </div>
  </div>
</template>

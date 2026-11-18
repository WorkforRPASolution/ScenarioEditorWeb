<script setup>
// 시험 실행 창의 결과 보기(P5 설계 §4.8·§4.9) — 고른 설비만, 설비 ID 순. 설비마다 요청 결과와, 실행 기록에서 읽은 실행 상태.
// "요청 접수" 는 명령 서버가 받았다는 뜻까지다 — 실제로 돌았는지는 실행 상태 열이 말한다.
import { computed } from 'vue'
import { useTestRunStore } from '../../stores/testRunStore'
import { summarize, stateView } from '../../editor/testRun'
import { t } from '../../messages'
import './testrun.css'

defineOptions({ name: 'TestRunResult' })
const run = useTestRunStore()
const r = computed(() => run.run)
const sum = computed(() => summarize(r.value?.items ?? []))
const running = computed(() => run.stage === 'running')
const progress = computed(() => {
  const p = { done: sum.value.done, total: sum.value.total }
  if (running.value) return t('SEW_RUN_PROGRESS_SENDING', p)
  // 멈췄을 때는 보내지 않은 설비를 세지 않는다("멈췄습니다 3 / 5")
  return r.value?.halt ? t('SEW_RUN_PROGRESS_STOPPED', { done: sum.value.done - sum.value.skipped, total: sum.value.total }) : t('SEW_RUN_PROGRESS_DONE', p)
})
const TONES = { accepted: 'ok', failed: 'bad', unknown: 'warn', down: 'bad', sending: 'run' }
const now = computed(() => (r.value?.now === null || r.value?.now === undefined ? Date.now() : r.value.now + (Date.now() - r.value.nowAt)))
const ago = (at) => { const n = Math.floor((Date.now() - at) / 60_000); return n < 1 ? t('SEW_RUN_AGO_NOW') : t('SEW_RUN_AGO_MIN', { n }) }
// 요청 결과 옆의 까닭
function detailOf(x) {
  if (x.outcome === 'failed') return typeof x.detail === 'string' ? x.detail : ''
  if (x.outcome === 'recent') return x.detail ? t('SEW_RUN_DETAIL_recent', { ago: ago(x.detail.at), by: x.detail.by }) : ''
  if (x.outcome === 'off') return t(x.detail === 'unreadable' ? 'SEW_RUN_DETAIL_off_unreadable' : 'SEW_RUN_DETAIL_off')
  if (x.outcome === 'agentOff') return t(x.detail === 'noInfo' ? 'SEW_RUN_DETAIL_agentOff_noInfo' : x.detail === 'unreadable' ? 'SEW_RUN_DETAIL_agentOff_unreadable' : 'SEW_RUN_DETAIL_agentOff')
  if (x.outcome === 'badValue') return t(x.detail === 'delayKey' ? 'SEW_RUN_DETAIL_badValue_delayKey' : 'SEW_RUN_DETAIL_badValue_header')
  if (x.outcome === 'unknown') return t(x.lost ? 'SEW_RUN_DETAIL_lost' : 'SEW_RUN_DETAIL_unknown')
  if (x.outcome === 'forbidden') return t('SEW_RUN_DETAIL_forbidden')
  if (x.outcome === 'mismatch') return t('SEW_RUN_DETAIL_mismatch')
  return x.outcome === 'down' ? t('SEW_RUN_DETAIL_down') : ''
}
const rows = computed(() => (r.value?.items ?? []).map((x) => {
  const v = stateView(x, { now: now.value, startDelay: r.value.startDelay })
  const time = typeof x.createDate === 'string' ? (/T(\d{2}:\d{2}:\d{2})/.exec(x.createDate)?.[1] ?? x.createDate) : ''
  return { x, detail: detailOf(x), state: v ? { text: t(v.key, v.params) + (v.candidates ? ` · ${t('SEW_RUN_CANDIDATES', { n: v.candidates })}` : ''), tone: v.tone } : null, time }
}))
</script>

<template>
  <div v-if="r" class="h-full flex flex-col gap-2 min-h-0 px-5 py-3" data-testid="se-run-result">
    <div class="se-run-bar"><i :style="{ width: `${sum.total ? (sum.done / sum.total) * 100 : 0}%` }" /></div>
    <div class="flex flex-wrap items-center gap-2 text-xs">
      <b class="tabular-nums" role="status" data-testid="se-run-progress">{{ progress }}</b>
      <button v-if="running" type="button" class="h-7 px-2.5 rounded-md text-xs bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600" data-testid="se-run-stop" @click="run.stop()">{{ t('SEW_RUN_STOP') }}</button>
      <button type="button" class="h-7 px-2.5 rounded-md text-xs bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600" data-testid="se-run-status-refresh" @click="run.refreshStatus()">{{ t('SEW_RUN_STATUS_REFRESH') }}</button>
      <span v-if="r.statusFailed" class="se-run-err" role="status" data-testid="se-run-status-failed">{{ t('SEW_RUN_STATUS_FAILED') }}</span>
      <span class="se-run-auto" role="status" :data-ended="r.autoEnded ? 'true' : undefined" data-testid="se-run-auto-note">{{ t(r.autoEnded ? 'SEW_RUN_STATUS_AUTO_ENDED' : 'SEW_RUN_STATUS_AUTO') }}</span>
    </div>
    <p v-if="r.halt" class="se-run-note" data-kind="block" role="alert" data-testid="se-run-halt">{{ t(r.halt.key, r.halt.params) }}</p>
    <div class="se-run-tbl">
      <table>
        <thead><tr><th>{{ t('SEW_RUN_COL_ID') }}</th><th>{{ t('SEW_RUN_COL_OUTCOME') }}</th><th>{{ t('SEW_RUN_COL_STATE') }}</th><th>{{ t('SEW_RUN_COL_CREATED') }}</th></tr></thead>
        <tbody>
          <tr v-for="row in rows" :key="row.x.eqpId" :data-id="row.x.eqpId" data-testid="se-run-result-row">
            <td class="se-run-mono">{{ row.x.eqpId }}</td>
            <td class="wrap"><span class="se-run-pill" :data-tone="TONES[row.x.outcome] ?? 'idle'" data-testid="se-run-outcome">{{ t(`SEW_RUN_OUTCOME_${row.x.outcome}`) }}</span> <span v-if="row.detail" class="se-run-hint">{{ row.detail }}</span></td>
            <td class="wrap"><span v-if="row.state" class="se-run-pill" :data-tone="row.state.tone" data-testid="se-run-state">{{ row.state.text }}</span><template v-else>—</template></td>
            <td class="se-run-mono">{{ row.time || '—' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="se-run-hint">{{ t('SEW_RUN_RESULT_HINT') }}</p>
  </div>
</template>

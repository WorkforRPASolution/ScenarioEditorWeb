<script setup>
// 시험 실행 창의 설비 표(P5 설계 §4.3) — 고른 공정·모델의 설비. 자동조치 OFF·값을 읽을 수 없는 설비, 에이전트가 실행 중이 아닌 설비는 보이되 고를 수 없다
// (까닭은 줄의 title). 에이전트 상태를 통째로 읽지 못했으면 표 위에 알린다.
// 줄 누르기 = 그 줄 하나, Ctrl(⌘)·체크 칸 = 더하고 빼기, Shift = 범위, 머리 칸 = 보이는 줄 모두(메모 목록 창과 같은 손놀림).
import { computed } from 'vue'
import { useTestRunStore } from '../../stores/testRunStore'
import { selectableIds, whyNotSelectable } from '../../editor/testRun'
import { t } from '../../messages'
import '../panel/panel.css'
import './testrun.css'

defineOptions({ name: 'TestRunTargets' })
const run = useTestRunStore()
const can = computed(() => selectableIds(run.shown))
const AGENT_TONES = { on: 'ok', off: 'bad', noInfo: 'bad' }
const agentOf = (e) => (['on', 'off', 'noInfo'].includes(e.agent) ? e.agent : 'unreadable')
const rows = computed(() => run.shown.map((e) => {
  const why = whyNotSelectable(e)
  return { e, why, title: why ? t(`SEW_RUN_WHY_ROW_${why}`) : null, agent: agentOf(e) }
}))
// 에이전트 상태를 읽지 못했다(서버가 Redis 를 읽지 못하면 모든 설비가 unreadable 이다)
const agentFailed = computed(() => run.targets.items.length > 0 && run.targets.items.every((e) => agentOf(e) === 'unreadable'))
const allChecked = computed(() => can.value.length > 0 && can.value.every((id) => run.picked.has(id)))
const recent = computed(() => new Map((run.info.data?.recent ?? []).map((r) => [r.eqpId, r])))
const ago = (at) => { const n = Math.floor((Date.now() - at) / 60_000); return n < 1 ? t('SEW_RUN_AGO_NOW') : t('SEW_RUN_AGO_MIN', { n }) }
const recentText = (id) => { const r = recent.value.get(id); return r ? t('SEW_RUN_RECENT_CELL', { ago: ago(r.at), by: r.by }) : '' }
const count = computed(() => {
  const p = { n: run.picked.size, total: run.targets.items.length, hidden: run.hidden }
  return run.hidden ? t('SEW_RUN_EQP_COUNT_HIDDEN', p) : t('SEW_RUN_EQP_COUNT', p)
})
// 표 대신 보일 안내
const empty = computed(() => {
  if (!run.sel.model) return t('SEW_RUN_EQP_PICK_FIRST')
  const s = run.targets
  if (s.status === 'error') return t('SEW_RUN_LIST_FAILED', { message: s.message })
  if (s.status === 'loading' && !s.items.length) return t('SEW_RUN_EQP_LOADING')
  if (s.status === 'ready' && !s.items.length) return t('SEW_RUN_EQP_NONE')
  return s.items.length && !run.shown.length ? t('SEW_RUN_EQP_NO_MATCH') : ''
})
// Shift 로 범위를 고를 때 글자가 함께 선택되지 않게
const noTextRange = (e) => { if (e.shiftKey) e.preventDefault() }
const onRow = (e, ev) => run.click(e.eqpId, { toggle: ev.ctrlKey || ev.metaKey, range: ev.shiftKey })
</script>

<template>
  <div class="se-run-col">
    <div class="flex flex-wrap items-center gap-x-2 text-xs">
      <b>{{ t('SEW_RUN_EQP') }}</b>
      <span v-if="run.targets.items.length" class="text-gray-500 dark:text-gray-400 tabular-nums" data-testid="se-run-count">{{ count }}</span>
    </div>
    <div class="flex items-center gap-1.5">
      <input v-model="run.query" class="se-inp" type="search" autocomplete="off" spellcheck="false" :placeholder="t('SEW_RUN_EQP_SEARCH')" :aria-label="t('SEW_RUN_EQP_SEARCH')" data-testid="se-run-search" />
      <button type="button" class="shrink-0 h-7 px-2.5 rounded-md text-xs bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:enabled:bg-gray-300 dark:hover:enabled:bg-gray-600 disabled:opacity-50"
        :disabled="!run.sel.model" data-testid="se-run-reload" @click="run.reload()">{{ t('SEW_RUN_REFRESH') }}</button>
    </div>
    <p v-if="agentFailed" class="se-run-note" data-kind="block" role="alert" data-testid="se-run-agent-failed">{{ t('SEW_RUN_AGENT_FAILED') }}</p>
    <p v-if="empty" class="flex-1 min-h-[120px] flex items-center justify-center px-4 text-center text-xs text-gray-500 dark:text-gray-400 border border-dashed border-gray-300 dark:border-dark-border rounded-md" data-testid="se-run-empty">{{ empty }}</p>
    <div v-else class="se-run-tbl">
      <table>
        <thead>
          <tr>
            <th><input type="checkbox" :checked="allChecked" :disabled="!can.length" :aria-label="t('SEW_RUN_ALL')" :title="t('SEW_RUN_ALL')" data-testid="se-run-all" @change="run.toggleAllShown($event.target.checked)" /></th>
            <th>{{ t('SEW_RUN_COL_ID') }}</th><th>{{ t('SEW_RUN_COL_LINE') }}</th><th>{{ t('SEW_RUN_COL_IP') }}</th><th>{{ t('SEW_RUN_COL_ONOFF') }}</th><th>{{ t('SEW_RUN_COL_AGENT') }}</th><th>{{ t('SEW_RUN_COL_RECENT') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="{ e, why, title, agent } in rows" :key="e.eqpId" :data-id="e.eqpId" :data-off="String(why !== null)" :title="title" :aria-selected="run.picked.has(e.eqpId) ? 'true' : 'false'" data-testid="se-run-row" @mousedown="noTextRange" @click="onRow(e, $event)">
            <td @click.stop="run.click(e.eqpId, { toggle: true })"><input type="checkbox" :checked="run.picked.has(e.eqpId)" :disabled="why !== null" :aria-label="e.eqpId" /></td>
            <td class="se-run-mono">{{ e.eqpId }}</td>
            <td>{{ e.line }}</td>
            <!-- IP 둘·OFF 안내는 칸 안에서 줄을 바꾼다 — 표가 옆으로 넘쳐 "방금 요청" 칸이 잘리지 않게 -->
            <td class="se-run-mono wrap">{{ e.ipAddr }}<template v-if="e.ipAddrL"> <span class="whitespace-nowrap">· {{ e.ipAddrL }}</span></template></td>
            <td class="wrap">
              <span v-if="e.onoff === 'on'" class="se-run-pill" data-tone="ok">{{ t('SEW_RUN_ON') }}</span>
              <template v-else><span class="se-run-pill" data-tone="bad">{{ e.onoff === 'off' ? t('SEW_RUN_OFF') : t('SEW_RUN_UNREADABLE') }}</span> {{ t('SEW_RUN_OFF_HINT') }}</template>
            </td>
            <td><span class="se-run-pill" :data-tone="AGENT_TONES[agent] ?? 'warn'" data-testid="se-run-agent">{{ t(`SEW_RUN_AGENT_${agent}`) }}</span></td>
            <td class="wrap">{{ recentText(e.eqpId) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="se-run-hint">{{ t('SEW_RUN_EQP_HINT', { max: run.targets.limits.maxEquipment, min: run.targets.limits.recentMin }) }}</p>
  </div>
</template>

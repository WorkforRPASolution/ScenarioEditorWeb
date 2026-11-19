<script setup>
// 확인이 필요한 내 배포 목록(SEW-021) — 위쪽 바의 "확인할 배포 n건" 이 연다. 상태·서버 호출은 stores/deployAttentionStore.
// 결과 모름·거절은 [버전 목록 확인], 마무리 실패는 [다시 쓰기](새 시나리오면 이대로는 실행되지 않는다). 모든 줄에 [목록에서 빼기](마무리 실패는 한 번 더 묻는다).
import { ref, watch } from 'vue'
import { useDeployAttention } from '../stores/deployAttentionStore'
import { t } from '../messages'
import { formatCrtime } from '../format'
import ModalShell from './ModalShell.vue'

const props = defineProps({ modelValue: Boolean })
const emit = defineEmits(['update:modelValue'])
const store = useDeployAttention()
const asking = ref(null) // 빼기를 한 번 더 묻는 줄의 requestId(마무리 실패)

watch(() => props.modelValue, (v) => { if (v) { asking.value = null; store.refresh() } }, { immediate: true })

const idOf = (it) => `${it.target.process}-${it.target.model}-${it.target.name}`
const whenOf = (it) => { const ms = Date.parse(it.startedAt); return Number.isFinite(ms) ? formatCrtime(ms) : '—' }
const done = (it) => it.outcome?.kind === 'ok'
const stateOf = (it) => t(done(it) ? 'SEW_ATTN_STATE_ok' : `SEW_ATTN_STATE_${it.result}`)
const crtimeText = (ms) => (ms === null || ms === undefined ? '—' : formatCrtime(ms))
function outcomeText(it) {
  const o = it.outcome
  if (o.kind === 'ok') return t('SEW_ATTN_OK', { at: crtimeText(o.crtime) }) + (o.performanceKept ? ` ${t('SEW_ATTN_OK_PERF_KEPT')}` : '') + (o.draftGone ? ` ${t('SEW_ATTN_DRAFT_GONE')}` : '')
  if (o.kind === 'partial') return t('SEW_ATTN_DRAFT_GONE')
  if (o.kind === 'error') return t('SEW_ATTN_ERROR', { cause: o.cause })
  return t({ none: 'SEW_ATTN_NONE', stillPartial: 'SEW_ATTN_STILL_PARTIAL', busy: 'SEW_ATTN_BUSY' }[o.kind])
}
function onDismiss(it) {
  if (it.result === 'partial') { asking.value = it.requestId; return }
  store.dismiss(it.requestId)
}
function dismissAsked(it) {
  asking.value = null
  store.dismiss(it.requestId)
}
const btn = 'h-7 px-2.5 rounded-md text-xs font-medium disabled:opacity-50'
</script>

<template>
  <ModalShell :model-value="modelValue" :title="t('SEW_ATTN_TITLE')" :width="680" :height="540" testid="se-attn-dialog" @update:model-value="emit('update:modelValue', $event)">
    <div class="h-full overflow-auto p-5 text-sm flex flex-col gap-3">
      <p class="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">{{ t('SEW_ATTN_INTRO') }}</p>
      <p v-if="store.failed" class="text-xs text-red-600 dark:text-red-400" role="alert" data-testid="se-attn-failed">
        {{ t('SEW_ATTN_FAILED') }}
        <button type="button" class="underline underline-offset-2 text-primary-700 dark:text-primary-300" data-testid="se-attn-reload" @click="store.refresh()">{{ t('SEW_ATTN_RELOAD') }}</button>
      </p>
      <p v-else-if="!store.items.length && !store.loading" class="text-xs text-gray-500" data-testid="se-attn-empty">{{ t('SEW_ATTN_EMPTY') }}</p>
      <ul class="flex flex-col gap-2">
        <li v-for="it in store.items" :key="it.requestId" class="border border-gray-200 dark:border-dark-border rounded-lg px-3 py-2 flex flex-col gap-1" data-testid="se-attn-row" :data-rid="it.requestId">
          <div class="flex items-baseline gap-2 min-w-0">
            <b class="font-mono text-gray-900 dark:text-gray-100 truncate" :title="idOf(it)">{{ idOf(it) }}</b>
            <span class="text-xs text-gray-500 shrink-0">{{ whenOf(it) }}</span>
            <span class="ml-auto shrink-0 px-2 py-0.5 rounded text-xs font-medium"
              :class="done(it) ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' : 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'" data-testid="se-attn-state">{{ stateOf(it) }}</span>
          </div>
          <p v-if="!done(it)" class="text-xs text-gray-700 dark:text-gray-300">{{ t(`SEW_ATTN_BODY_${it.result}`) }}</p>
          <p v-if="!done(it) && it.result === 'partial' && it.targetWasNew" class="text-xs text-red-600 dark:text-red-400" data-testid="se-attn-not-run">{{ t('SEW_ATTN_NEW_NOT_RUN') }}</p>
          <p v-if="it.outcome" class="text-xs" :class="['error', 'busy', 'stillPartial'].includes(it.outcome.kind) ? 'text-red-600 dark:text-red-400' : 'text-gray-700 dark:text-gray-300'" data-testid="se-attn-outcome">{{ outcomeText(it) }}</p>
          <div v-if="asking === it.requestId" class="text-xs flex flex-wrap items-center gap-2 justify-end" data-testid="se-attn-dismiss-ask">
            <span class="text-gray-700 dark:text-gray-200">{{ t('SEW_ATTN_DISMISS_ASK') }}</span>
            <button type="button" :class="btn" class="text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-dark-border" data-testid="se-attn-dismiss-no" @click="asking = null">{{ t('SEW_ATTN_CANCEL') }}</button>
            <button type="button" :class="btn" class="bg-red-600 hover:bg-red-700 text-white" data-testid="se-attn-dismiss-go" @click="dismissAsked(it)">{{ t('SEW_ATTN_DISMISS_GO') }}</button>
          </div>
          <div v-else-if="!done(it)" class="flex gap-2 justify-end">
            <button type="button" :class="btn" class="text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-dark-border" :disabled="!!it.busy" data-testid="se-attn-dismiss" @click="onDismiss(it)">{{ t('SEW_ATTN_DISMISS') }}</button>
            <button v-if="it.result === 'partial'" type="button" :class="btn" class="bg-primary-500 hover:enabled:bg-primary-600 text-white" :disabled="!!it.busy" data-testid="se-attn-finish" @click="store.finish(it.requestId)">{{ t('SEW_SAVE_FINISH') }}</button>
            <button v-else type="button" :class="btn" class="bg-primary-500 hover:enabled:bg-primary-600 text-white" :disabled="!!it.busy" data-testid="se-attn-verify" @click="store.verify(it.requestId)">{{ t('SEW_SAVE_VERIFY') }}</button>
          </div>
        </li>
      </ul>
    </div>
  </ModalShell>
</template>

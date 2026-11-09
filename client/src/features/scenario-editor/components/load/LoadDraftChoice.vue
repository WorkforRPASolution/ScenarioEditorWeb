<script setup>
// "내 초안이 있습니다" — 초안이 있는 행을 열 때 초안 이어서 / 현재 버전을 고른다(P2-D Task 7, 설계 §6.1, 목업 choiceModal).
// 기본 버튼은 [초안 이어서 열기](저장해 둔 것을 잇는 것이 흔한 경우).
import { computed, ref, onMounted, nextTick } from 'vue'
import { t } from '../../messages'
import { formatCrtime } from '../../format'
import { draftStale, draftTarget } from '../../editor/loadRows'

const props = defineProps({ row: { type: Object, required: true }, model: { type: String, required: true } })
const emit = defineEmits(['draft', 'current', 'close'])
const d = computed(() => props.row.draft)
const stale = computed(() => draftStale(props.row))
const target = computed(() => draftTarget(props.row, props.model))
const fresh = computed(() => (d.value.base?.crtime === props.row.currentCrtime ? t('SEW_LOAD_CHOICE_FRESH') : t('SEW_LOAD_CHOICE_FRESH_OLD')))
const draftEl = ref(null)
onMounted(async () => { await nextTick(); draftEl.value?.focus() })
const kv = 'grid grid-cols-[76px_minmax(0,1fr)] gap-x-2 gap-y-1 m-0 text-xs'
const btn = 'h-9 px-4 rounded-lg text-sm font-medium'
</script>

<template>
  <div class="absolute inset-0 z-20 bg-black/40 flex items-center justify-center p-5" data-testid="se-load-choice" @keydown.esc.stop.prevent="emit('close')" @click.self="emit('close')">
    <section class="w-[620px] max-h-full flex flex-col overflow-hidden bg-white dark:bg-dark-card border border-gray-200 dark:border-dark-border rounded-xl shadow-2xl"
      role="dialog" aria-modal="true" aria-labelledby="se-load-choice-t">
      <div class="flex items-center gap-3 px-5 py-3 border-b border-gray-200 dark:border-dark-border min-w-0">
        <h3 id="se-load-choice-t" class="font-semibold text-gray-900 dark:text-white shrink-0">{{ t('SEW_LOAD_CHOICE_TITLE') }}</h3>
        <span class="font-mono text-xs text-gray-500 truncate">{{ row.name }}</span>
        <span class="flex-1" />
        <button type="button" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" :aria-label="t('SEW_LOAD_CLOSE')" @click="emit('close')">✕</button>
      </div>
      <div class="px-5 py-4 overflow-auto flex flex-col gap-3 text-sm text-gray-800 dark:text-gray-200">
        <p>{{ t('SEW_LOAD_CHOICE_BODY') }}</p>
        <div class="grid grid-cols-2 gap-2.5">
          <div class="rounded-xl px-3 py-2.5 border border-primary-500 bg-primary-50 dark:bg-primary-900/20">
            <h4 class="m-0 mb-1.5 text-[13px] font-semibold flex items-center gap-1.5">{{ t('SEW_LOAD_CHOICE_DRAFT') }}<span class="se-load-vtag">{{ t('SEW_LOAD_CHOICE_MINE') }}</span></h4>
            <dl :class="kv">
              <dt class="text-gray-500">{{ t('SEW_LOAD_CHOICE_SAVED') }}</dt><dd class="m-0 font-mono">{{ formatCrtime(Date.parse(d.savedAt)) }}</dd>
              <dt class="text-gray-500">{{ t('SEW_LOAD_CHOICE_BASE') }}</dt>
              <dd class="m-0 font-mono" :class="stale ? 'text-amber-700 dark:text-amber-300 font-medium' : ''">{{ d.base ? formatCrtime(d.base.crtime) : t('SEW_LOAD_CHOICE_NO_BASE') }}</dd>
              <template v-if="target"><dt class="text-gray-500">{{ t('SEW_LOAD_CHOICE_TARGET') }}</dt><dd class="m-0 font-mono break-all">{{ target }}</dd></template>
            </dl>
          </div>
          <div class="rounded-xl px-3 py-2.5 border border-gray-200 dark:border-dark-border">
            <h4 class="m-0 mb-1.5 text-[13px] font-semibold">{{ t('SEW_LOAD_CHOICE_CURRENT') }}</h4>
            <dl :class="kv">
              <dt class="text-gray-500">{{ t('SEW_LOAD_CHOICE_VERSION') }}</dt><dd class="m-0 font-mono">{{ row.currentCrtime ? formatCrtime(row.currentCrtime) : t('SEW_LOAD_NONE') }}</dd>
              <dt class="text-gray-500">{{ t('SEW_LOAD_CHOICE_OWNER') }}</dt><dd class="m-0">{{ row.lastOwner?.singleid ?? '' }}</dd>
            </dl>
          </div>
        </div>
        <div v-if="stale" class="rounded-lg px-3 py-2 text-[13px] leading-relaxed bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" data-testid="se-load-choice-stale">
          <b>{{ t('SEW_LOAD_CHOICE_STALE_HEAD') }}</b>{{ t('SEW_LOAD_CHOICE_STALE_BODY') }}</div>
        <p v-else class="text-xs text-gray-500">{{ fresh }}</p>
        <p class="text-xs text-gray-500">{{ t('SEW_LOAD_CHOICE_NOTE') }}</p>
      </div>
      <div class="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-200 dark:border-dark-border">
        <button type="button" :class="btn" class="bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 font-normal" data-testid="se-load-choice-cancel" @click="emit('close')">{{ t('SEW_LOAD_CANCEL') }}</button>
        <button type="button" :class="btn" class="bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 font-normal" :disabled="!row.currentCrtime" data-testid="se-load-choice-current" @click="emit('current')">{{ t('SEW_LOAD_OPEN_CURRENT') }}</button>
        <button ref="draftEl" type="button" :class="btn" class="bg-primary-500 hover:bg-primary-600 text-white" data-testid="se-load-choice-draft" @click="emit('draft')">{{ t('SEW_LOAD_OPEN_DRAFT') }}</button>
      </div>
    </section>
  </div>
</template>

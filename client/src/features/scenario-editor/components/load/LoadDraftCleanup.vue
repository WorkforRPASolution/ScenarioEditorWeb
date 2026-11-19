<script setup>
// 초안만 남은 것 정리(2026-11-10 사용자 결정). 배포된 시나리오 없이 내 초안만 남은 행(아직 배포한 적 없는 새 시나리오·원본이 지워진 것)을
// 골라 한꺼번에 지운다. 내 초안만 지운다(서버가 소유자를 본다) — 다른 사용자의 초안은 보이지도 지워지지도 않는다.
// 되돌릴 수 없어 처음에는 아무것도 고르지 않는다. 하나씩 지우고, 못 지운 것은 그대로 남긴다.
import { SECONDARY } from '../buttonStyle'
import { ref, computed } from 'vue'
import { scenarioEditorApi as api } from '../../api'
import { t } from '../../messages'
import { formatCrtime } from '../../format'

const props = defineProps({
  process: { type: String, required: true },
  model: { type: String, required: true },
  rows: { type: Array, required: true }, // 초안만 행(draftOnly 'new' | 'gone', draft)
  openDraftId: { type: String, default: null } // 편집 화면이 이 초안으로 열려 있으면 그 초안 id
})
const emit = defineEmits(['done', 'close'])

const picked = ref(new Set())
const busy = ref(false)
const all = computed(() => props.rows.length > 0 && picked.value.size === props.rows.length)
const savedAt = (r) => formatCrtime(Date.parse(r.draft.savedAt)).slice(5, 16)
function toggle(id, on) {
  const next = new Set(picked.value)
  if (on) next.add(id); else next.delete(id)
  picked.value = next
}
const toggleAll = (on) => { picked.value = on ? new Set(props.rows.map((r) => r.draft.draftId)) : new Set() }

async function go() {
  if (!picked.value.size || busy.value) return
  busy.value = true
  const deleted = []
  let failed = 0
  for (const r of props.rows) {
    const id = r.draft.draftId
    if (!picked.value.has(id)) continue
    try { await api.deleteDraft(id); deleted.push(id) } catch { failed++ }
  }
  busy.value = false
  emit('done', { deleted, failed })
}
function close() { if (!busy.value) emit('close') }
const btn = 'h-9 px-4 rounded-lg text-sm font-medium disabled:opacity-50'
</script>

<template>
  <div class="absolute inset-0 z-20 bg-black/40 flex items-center justify-center p-5" data-testid="se-load-clean" @keydown.esc.stop.prevent="close" @click.self="close">
    <section class="w-[560px] max-h-full flex flex-col overflow-hidden bg-white dark:bg-dark-card border border-gray-200 dark:border-dark-border rounded-xl shadow-2xl"
      role="dialog" aria-modal="true" aria-labelledby="se-load-clean-t">
      <div class="flex items-center gap-3 px-5 py-3 border-b border-gray-200 dark:border-dark-border">
        <h3 id="se-load-clean-t" class="font-semibold text-gray-900 dark:text-white">{{ t('SEW_LOAD_CLEAN_TITLE') }}</h3>
        <span class="flex-1" />
        <button type="button" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-50" :aria-label="t('SEW_LOAD_CLOSE')" :disabled="busy" @click="close">✕</button>
      </div>
      <div class="px-5 py-4 min-h-0 flex flex-col gap-3 text-sm text-gray-800 dark:text-gray-200">
        <div class="font-mono text-xs text-gray-500">{{ process }} · {{ model }}</div>
        <p class="text-[13px] leading-relaxed">{{ t('SEW_LOAD_CLEAN_LEAD') }}</p>
        <label class="flex items-center gap-2 text-xs font-medium text-gray-700 dark:text-gray-300">
          <input type="checkbox" :checked="all" :disabled="busy" data-testid="se-load-clean-all" @change="toggleAll($event.target.checked)" />{{ t('SEW_LOAD_CLEAN_ALL', { n: rows.length }) }}</label>
        <ul class="min-h-0 overflow-auto m-0 p-0 list-none border border-gray-200 dark:border-dark-border rounded-lg divide-y divide-gray-200 dark:divide-dark-border">
          <li v-for="r in rows" :key="r.draft.draftId" data-testid="se-load-clean-row">
            <label class="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800">
              <input type="checkbox" :checked="picked.has(r.draft.draftId)" :disabled="busy" @change="toggle(r.draft.draftId, $event.target.checked)" />
              <span class="flex-1 min-w-0">
                <span class="block font-mono text-[13px] break-all">{{ r.name }}</span>
                <span class="block text-xs text-gray-500">{{ t(r.draftOnly === 'new' ? 'SEW_LOAD_DRAFT_SUB_NEW' : 'SEW_LOAD_DRAFT_SUB_GONE') }} · {{ t('SEW_LOAD_DRAFT_CHIP_TITLE', { at: savedAt(r) }) }}<template
                  v-if="openDraftId === r.draft.draftId"> · <b class="text-amber-700 dark:text-amber-300">{{ t('SEW_LOAD_CLEAN_OPEN') }}</b></template></span>
              </span>
            </label>
          </li>
        </ul>
        <p class="text-xs text-gray-500">{{ t('SEW_LOAD_CLEAN_NOTE') }}</p>
      </div>
      <div class="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-200 dark:border-dark-border">
        <button type="button" :class="[btn, SECONDARY]" class="font-normal" :disabled="busy" data-testid="se-load-clean-cancel" @click="close">{{ t('SEW_LOAD_CANCEL') }}</button>
        <button type="button" :class="btn" class="bg-red-500 hover:bg-red-600 text-white" :disabled="!picked.size || busy" data-testid="se-load-clean-go" @click="go">
          {{ busy ? t('SEW_LOAD_DEL_BUSY') : t('SEW_LOAD_CLEAN_GO', { n: picked.size }) }}</button>
      </div>
    </section>
  </div>
</template>

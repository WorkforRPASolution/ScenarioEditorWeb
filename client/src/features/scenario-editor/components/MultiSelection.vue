<script setup>
// 여러 줄을 골랐을 때 오른쪽 칸(목업 multiHtml, 조작판 13 multi). 떨어진 줄이면 복사·잘라내기를 끄고 이유를 보인다.
import { SECONDARY } from './buttonStyle'
import { computed } from 'vue'
import { useEditStore } from '../stores/editStore'
import { isContiguous } from '../editor/commands'
import { t } from '../messages'

defineOptions({ name: 'MultiSelection' })
const edit = useEditStore()
const list = computed(() => {
  const steps = edit.session?.working?.steps ?? []
  const set = new Set(edit.selection.uids)
  return steps.map((s, i) => ({ s, no: i + 1 })).filter(({ s }) => set.has(s.uid))
})
const cont = computed(() => list.value.length > 0 && isContiguous(edit.session.working, list.value.map(({ s }) => s.uid)))
const btn = `h-7 px-2.5 rounded-lg text-xs ${SECONDARY}`
</script>

<template>
  <div v-if="edit.editable && list.length > 1" class="h-full overflow-auto p-3.5 text-sm" data-testid="se-multi">
    <h4 class="font-semibold text-gray-900 dark:text-white mb-1">{{ t('SEW_EDIT_MULTI_TITLE', { n: list.length }) }}</h4>
    <div class="text-xs text-gray-500 dark:text-gray-400">{{ cont ? t('SEW_EDIT_MULTI_CONTIGUOUS') : t('SEW_EDIT_MULTI_SCATTERED') }}</div>
    <ul class="my-2 text-xs text-gray-700 dark:text-gray-300">
      <li v-for="{ s, no } in list" :key="s.uid" class="py-0.5 flex gap-2"><b class="min-w-[18px] font-semibold tabular-nums">{{ no }}</b><span class="min-w-0 truncate">{{ s.descriptionToEmail }}</span></li>
    </ul>
    <div class="flex gap-1.5 flex-wrap">
      <button type="button" :class="btn" :disabled="!cont" data-testid="se-multi-copy" @click="edit.copySelection(false)">{{ t('SEW_EDIT_COPY') }}</button>
      <button type="button" :class="btn" :disabled="!cont" data-testid="se-multi-cut" @click="edit.copySelection(true)">{{ t('SEW_EDIT_CUT') }}</button>
      <button type="button" :class="btn" data-testid="se-multi-delete" @click="edit.deleteSelection()">{{ t('SEW_EDIT_DELETE') }}</button>
    </div>
    <div v-if="!cont" class="mt-2 text-xs leading-snug text-amber-700 dark:text-amber-300">{{ t('SEW_EDIT_MULTI_NEED_CONTIGUOUS') }}</div>
    <div class="mt-2.5 text-xs text-gray-500 dark:text-gray-400">{{ t('SEW_EDIT_MULTI_HELP') }}</div>
  </div>
</template>

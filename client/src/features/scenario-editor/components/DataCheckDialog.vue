<script setup>
import { computed } from 'vue'
import { useEditorStore } from '../stores/editorStore'
import { t, LABELS } from '../messages'
import ModalShell from './ModalShell.vue'

defineProps({ modelValue: Boolean })
const emit = defineEmits(['update:modelValue'])
const store = useEditorStore()
const groups = computed(() => {
  const d = store.dataCheck
  if (!d) return []
  return [
    { title: '같은 아이디의 사용자 문서', note: t('SEW_UI_DC_NOTE_FIRST_DOC'), items: d.duplicateUsers.map((u) => `${u.singleid} — ${u.count}건`) },
    { title: '중복된 설비 ID', note: t('SEW_UI_DC_NOTE_FIRST_EQP'), items: d.duplicateEqpIds },
    { title: '무효 규칙으로 뺀 설비', note: '', items: d.invalidEquipment.map((e) => `${e.eqpId ?? '(ID 없음)'} — ${LABELS.invalidReason[e.reason] ?? e.reason}${e.fields ? ` (${e.fields.join(', ')})` : ''}`) },
    { title: '프록시 IP 가 겹치는 설비', note: t('SEW_UI_DC_NOTE_KEPT'), items: d.proxyIpDuplicates.map((p) => `${p.eqpId} = ${p.sameAs}`) },
    { title: '같은 키의 운영 속성 문서', note: t('SEW_UI_DC_NOTE_CANNOT_OPEN'), items: d.duplicateProperties.map((p) => `${p.process}-${p.model}-${p.name} — ${p.count}건`) }
  ]
})
</script>

<template>
  <ModalShell :model-value="modelValue" title="데이터 점검" :width="640" :height="520" testid="se-data-check-dialog" @update:model-value="emit('update:modelValue', $event)">
    <div class="h-full overflow-auto p-5 text-sm">
      <p class="mb-4 text-xs text-gray-500 dark:text-gray-400">{{ t('SEW_UI_DATA_CHECK_INTRO') }}</p>
      <section v-for="g in groups" :key="g.title" class="mb-4">
        <h4 class="text-xs font-semibold text-gray-700 dark:text-gray-200">{{ g.title }} <span class="font-normal text-gray-500">({{ g.items.length }}{{ g.note ? ` · ${g.note}` : '' }})</span></h4>
        <ul class="mt-1 space-y-0.5 font-mono text-xs text-gray-800 dark:text-gray-200"><li v-for="i in g.items" :key="i">{{ i }}</li></ul>
      </section>
    </div>
  </ModalShell>
</template>

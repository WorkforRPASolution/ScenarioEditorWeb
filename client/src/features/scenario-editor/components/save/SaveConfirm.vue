<script setup>
// 배포 확인(목업 svConfirmHtml, 조작판 31) — 대상과 받을 설비 수를 한 번 더 보이고 [배포].
import { computed } from 'vue'
import { useSaveFlow } from '../../stores/saveFlow'
import { useEditStore } from '../../stores/editStore'
import { useEditorStore } from '../../stores/editorStore'
import { t } from '../../messages'

defineOptions({ name: 'SaveConfirm' })
const flow = useSaveFlow()
const edit = useEditStore()
const editor = useEditorStore()
const KIND = { same: 'SEW_SAVE_CONFIRM_SAME', new: 'SEW_SAVE_CONFIRM_NEW', exists: 'SEW_SAVE_CONFIRM_EXISTS' }
const process = computed(() => edit.session?.source?.process ?? editor.skeleton?.process ?? '')
const id = computed(() => `${process.value}-${flow.target.model}-${flow.target.name}`)
const body = computed(() => [
  t(KIND[flow.targetKind] ?? KIND.new, { id: id.value, model: flow.target.model, n: flow.eqpCount }),
  t(flow.enabled ? 'SEW_SAVE_CONFIRM_ON' : 'SEW_SAVE_CONFIRM_OFF'),
  t('SEW_SAVE_CONFIRM_UNDO')
].join(' '))
</script>

<template>
  <div class="se-sv-cf" data-testid="se-save-confirm">
    <h4>{{ t('SEW_SAVE_CONFIRM_TITLE') }}</h4>
    <p>{{ body }}</p>
    <div class="flex justify-end gap-1.5 mt-2.5">
      <button type="button" class="se-sv-btn" data-testid="se-save-back" @click="flow.back()">{{ t('SEW_SAVE_BACK') }}</button>
      <button type="button" class="se-sv-btn p" data-testid="se-save-go" @click="flow.deploy()">{{ t('SEW_SAVE_GO') }}</button>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, nextTick } from 'vue'
import { useResizableModal } from '@/shared/composables/useResizableModal'

const props = defineProps({
  modelValue: Boolean, title: { type: String, default: '' }, width: { type: Number, default: 980 }, height: { type: Number, default: 600 }, testid: { type: String, default: '' }
})
const emit = defineEmits(['update:modelValue'])
const modalRef = ref(null)
const { modalStyle, startDrag, startResize, center } = useResizableModal(modalRef, { defaultWidth: props.width, defaultHeight: props.height, minWidth: 560, minHeight: 360 })
watch(() => props.modelValue, async (open) => { if (open) { await nextTick(); center() } })
const close = () => emit('update:modelValue', false)
</script>

<template>
  <Teleport to="body">
    <div v-if="modelValue" class="fixed inset-0 z-50" :data-testid="testid">
      <div class="absolute inset-0 bg-black/40" @click="close" />
      <div ref="modalRef" class="fixed bg-white dark:bg-dark-card rounded-xl shadow-2xl border border-gray-200 dark:border-dark-border flex flex-col overflow-hidden" :style="modalStyle">
        <div class="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-dark-border cursor-grab active:cursor-grabbing select-none shrink-0" @mousedown="startDrag">
          <h3 class="font-semibold text-gray-900 dark:text-white">{{ title }}</h3>
          <button class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" aria-label="닫기" @mousedown.stop @click="close">✕</button>
        </div>
        <div class="flex-1 min-h-0 overflow-hidden"><slot /></div>
        <div v-if="$slots.footer" class="px-5 py-3 border-t border-gray-200 dark:border-dark-border flex justify-end gap-2 shrink-0"><slot name="footer" /></div>
        <div class="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize" @mousedown="startResize" />
      </div>
    </div>
  </Teleport>
</template>

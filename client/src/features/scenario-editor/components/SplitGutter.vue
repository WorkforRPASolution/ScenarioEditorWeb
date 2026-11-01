<script setup>
defineProps({ direction: { type: String, default: 'v' }, testid: { type: String, default: '' } })
defineEmits(['start', 'reset'])
</script>

<template>
  <div
    :data-testid="testid"
    class="group relative shrink-0"
    :class="direction === 'v' ? 'w-3 cursor-col-resize' : 'h-3 cursor-row-resize'"
    title="끌어서 크기 조절 · 두 번 누르면 기본값"
    @mousedown="$emit('start', $event)"
    @dblclick="$emit('reset')"
  >
    <div
      class="absolute rounded-full bg-gray-300 dark:bg-dark-border group-hover:bg-primary-500 transition-colors"
      :class="direction === 'v' ? 'left-[5px] top-1/2 -translate-y-1/2 w-0.5 h-12 group-hover:h-full' : 'top-[5px] left-1/2 -translate-x-1/2 h-0.5 w-12 group-hover:w-full'"
    />
  </div>
</template>

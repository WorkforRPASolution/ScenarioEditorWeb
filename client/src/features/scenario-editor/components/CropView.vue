<script setup>
import { ref, computed, watch } from 'vue'

const props = defineProps({ src: { type: String, required: true }, rect: { type: Object, default: null }, width: { type: Number, default: 110 }, marker: { type: Object, default: null } })
const emit = defineEmits(['outside'])
const natural = ref(null)
const failed = ref(false)
const r = computed(() => props.rect ?? (natural.value ? { x: 0, y: 0, w: natural.value.w, h: natural.value.h } : null))
const k = computed(() => (r.value && r.value.w > 0 ? props.width / r.value.w : 1))
const markerInside = computed(() => !!props.marker && !!r.value && props.marker.x >= 0 && props.marker.y >= 0 && props.marker.x <= r.value.w && props.marker.y <= r.value.h)
// 위치를 알 수 있을 때(표시 영역 + 클릭 지점)만 안/밖을 판정한다.
const outside = computed(() => (props.marker && r.value ? !markerInside.value : null))
watch(outside, (v) => { if (v !== null) emit('outside', v) }, { immediate: true })
watch(() => props.src, () => { natural.value = null; failed.value = false })
function onLoad(e) {
  natural.value = { w: e.target.naturalWidth, h: e.target.naturalHeight }
}
defineExpose({ onLoad })
</script>

<template>
  <div class="relative overflow-hidden rounded border border-gray-300 dark:border-dark-border bg-gray-200 dark:bg-dark-bg"
    :style="{ width: `${width}px`, height: r ? `${Math.max(8, r.h * k)}px` : '40px' }">
    <img :src="src" alt="" class="absolute max-w-none" :style="r && natural ? { left: `${-r.x * k}px`, top: `${-r.y * k}px`, width: `${natural.w * k}px` } : { opacity: 0 }"
      @load="onLoad" @error="failed = true" />
    <div v-if="markerInside" class="absolute w-4 h-4 -ml-2 -mt-2" :style="{ left: `${marker.x * k}px`, top: `${marker.y * k}px` }" data-testid="se-click-marker">
      <div class="absolute left-[7px] top-0 bottom-0 w-0.5 bg-red-600" /><div class="absolute top-[7px] left-0 right-0 h-0.5 bg-red-600" />
    </div>
    <div v-if="failed" class="absolute inset-0 flex items-center justify-center text-[10px] text-gray-500">없음</div>
  </div>
</template>

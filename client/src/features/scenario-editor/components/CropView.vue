<script setup>
import { ref, computed, watch } from 'vue'

// failText = 불러오지 못했을 때 그림 자리에 보일 문구(편집 패널이 다른 판 그림에 준다). 없으면 P1 처럼 "없음".
const props = defineProps({ src: { type: String, required: true }, rect: { type: Object, default: null }, width: { type: Number, default: 110 }, marker: { type: Object, default: null }, failText: { type: String, default: null } })
const emit = defineEmits(['outside'])
const natural = ref(null)
const failed = ref(false)
const r = computed(() => props.rect ?? (natural.value ? { x: 0, y: 0, w: natural.value.w, h: natural.value.h } : null))
const k = computed(() => (r.value && r.value.w > 0 ? props.width / r.value.w : 1))
const failMsg = computed(() => (failed.value && props.failText ? props.failText : null))
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
    :style="{ width: `${width}px`, height: failMsg ? 'auto' : r ? `${Math.max(8, r.h * k)}px` : '40px', minHeight: failMsg ? '40px' : undefined }">
    <img :src="src" alt="" class="absolute max-w-none" :style="r && natural ? { left: `${-r.x * k}px`, top: `${-r.y * k}px`, width: `${natural.w * k}px` } : { opacity: 0 }"
      @load="onLoad" @error="failed = true" />
    <div v-if="markerInside" class="absolute w-4 h-4 -ml-2 -mt-2" :style="{ left: `${marker.x * k}px`, top: `${marker.y * k}px` }" data-testid="se-click-marker">
      <div class="absolute left-[7px] top-0 bottom-0 w-0.5 bg-red-600" /><div class="absolute top-[7px] left-0 right-0 h-0.5 bg-red-600" />
    </div>
    <div v-if="failMsg" class="relative px-1 py-1.5 text-center text-[10px] leading-snug text-gray-600 dark:text-gray-300" data-testid="se-crop-failed">{{ failMsg }}</div>
    <div v-else-if="failed" class="absolute inset-0 flex items-center justify-center text-[10px] text-gray-500">없음</div>
  </div>
</template>

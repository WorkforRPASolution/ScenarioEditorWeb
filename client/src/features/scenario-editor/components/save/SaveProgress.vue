<script setup>
// 배포 중(목업 saveResultHtml run, 조작판 32). 배포는 요청 한 번이라 어느 줄까지 끝났는지 알 수 없다 — 서버가 차례로 하는 일만 보인다.
// 결과가 정해질 때까지 창을 닫을 수 없다(SaveDialog 가 닫기 단추를 숨기고 떠나기 확인을 건다).
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useSaveFlow, SV_STEPS } from '../../stores/saveFlow'
import { t } from '../../messages'

defineOptions({ name: 'SaveProgress' })
const SLOW_S = 10
const flow = useSaveFlow()
const id = computed(() => { const s = flow.sentTarget; return s ? `${s.process}-${s.model}-${s.name}` : '' })
const elapsed = ref(0)
let started = 0
let timer = null
onMounted(() => { started = Date.now(); timer = setInterval(() => { elapsed.value = Math.floor((Date.now() - started) / 1000) }, 1000) })
onBeforeUnmount(() => clearInterval(timer))
</script>

<template>
  <div class="se-sv-rs" data-testid="se-save-run">
    <h4><span class="se-sv-spin" />{{ t('SEW_SAVE_RUN_TITLE') }}</h4>
    <p class="font-mono text-xs !text-gray-500">{{ id }}</p>
    <ol class="se-sv-steps">
      <li v-for="(k, i) in SV_STEPS" :key="k"><i>{{ i + 1 }}</i>{{ t(k) }}</li>
    </ol>
    <p class="mt-2.5 !text-xs !text-gray-500">
      <template v-if="elapsed >= SLOW_S">{{ t('SEW_SAVE_RUN_SLOW', { s: elapsed }) }} </template>{{ t('SEW_SAVE_RUN_LOCKED') }}
    </p>
  </div>
</template>

<script setup>
// 한 자리(at)의 보이는 검사 오류 — 문구는 code 마다 하나(RULE_<code>). 손대지 않은 칸의 오류는 창이 숨긴다(바닥 줄 "채울 곳").
import { computed, inject } from 'vue'
import { fieldMessage } from '../../messages'

defineOptions({ name: 'PerformanceErrors' })
const props = defineProps({ at: { type: String, required: true } })
const ctx = inject('sePerformanceCtx')
const list = computed(() => ctx.errorsAt(props.at))
</script>

<template>
  <div v-if="list.length" :id="`se-pf-e-${at}`" :data-testid="`se-perf-err-${at}`">
    <div v-for="e in list" :key="e.code" class="se-pf-err" :data-code="e.code">{{ fieldMessage(e) }}</div>
  </div>
</template>

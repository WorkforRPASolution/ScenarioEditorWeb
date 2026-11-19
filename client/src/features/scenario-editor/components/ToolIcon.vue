<script setup>
// 위쪽 바 단추 아이콘 — WebManager 도구 줄과 같은 선 아이콘(Heroicons outline 24, 굵기 2). 색은 쓰는 곳이 class 로 준다(역할 색, 2026-11-19 사용자 결정 A).
// 글자 옆 꾸밈이라 읽지 않는다(aria-hidden).
const PATHS = {
  load: 'M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z',
  plus: 'M12 4v16m8-8H4',
  run: 'M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664zM21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  save: 'M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4',
  prop: 'M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4'
}
defineOptions({ name: 'ToolIcon' })
defineProps({ name: { type: String, required: true } })
</script>

<template>
  <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="PATHS[name]" /></svg>
</template>

<script setup>
// 동작 아이콘(목업 step-editor-v1 의 ICON·ico). 이름은 사내 ScriptType 이름이고, 그림이 없는 종류(보존 전용·모르는 동작)는 알림 그림(ACS)이다.
// 그림은 이 파일의 상수뿐이라 v-html 로 넣는다(사용자 입력이 아니다).
import { computed } from 'vue'

defineOptions({ name: 'ActionIcon' })
const props = defineProps({
  name: { type: String, default: null },
  size: { type: Number, default: 16 }
})

const ICON = {
  None: '<circle cx="8" cy="8" r="5"/><path d="M4.5 11.5l7-7"/>',
  MouseLeftClick: '<rect x="4" y="2" width="8" height="12" rx="4"/><path d="M8 2v5H4" fill="currentColor"/>',
  MouseLeftDoubleClick: '<rect x="5" y="3" width="7" height="11" rx="3.5"/><path d="M2.5 5a4 4 0 0 1 2-3"/>',
  MouseRightClick: '<rect x="4" y="2" width="8" height="12" rx="4"/><path d="M8 2v5h4" fill="currentColor"/>',
  MouseMove: '<rect x="4" y="2" width="8" height="12" rx="4"/><path d="M8 4.5v3M6.5 6L8 4.5 9.5 6"/>',
  Keyboard: '<rect x="1.5" y="4" width="13" height="8" rx="1.5"/><path d="M4 7h.01M6.5 7h.01M9 7h.01M11.5 7h.01M5 9.5h6"/>',
  Wait: '<circle cx="8" cy="8" r="6"/><path d="M8 4.5V8l2.5 1.5"/>',
  FindWindow: '<rect x="1.5" y="2.5" width="10" height="8" rx="1"/><path d="M1.5 5h10"/><circle cx="11" cy="11" r="2.5"/><path d="M13 13l1.5 1.5"/>',
  RunCommand: '<rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><path d="M4 6l2.5 2L4 10M8 10.5h4"/>',
  CustomScript: '<path d="M6 3L2.5 8 6 13M10 3l3.5 5-3.5 5"/>',
  SendEmail: '<rect x="1.5" y="3.5" width="13" height="9" rx="1.5"/><path d="M1.5 5l6.5 4 6.5-4"/>',
  ACS: '<circle cx="8" cy="8" r="5.5"/><path d="M8 5v3.5M8 10.5h.01"/>'
}
const shown = computed(() => (props.name !== null && Object.hasOwn(ICON, props.name) ? props.name : 'ACS'))
</script>

<template>
  <svg :data-icon="shown" :width="size" :height="size" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="shrink-0" v-html="ICON[shown]" />
</template>

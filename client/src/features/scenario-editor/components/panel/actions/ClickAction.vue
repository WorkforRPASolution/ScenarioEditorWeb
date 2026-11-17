<script setup>
// 마우스 클릭 셋(목업 actionBody CLICKS): 이미지 스텝 = 찾은 그림 왼쪽 위 기준 X·Y. OCR·조건 없음의 옛 값은 보기만.
// [다시 찍기]는 큰 화면 잡기(Task 7)가 단다.
import { numIn, numOut } from '../../../editor/panel'
import { t } from '../../../messages'
import FieldError from '../FieldError.vue'
import '../panel.css'

defineOptions({ name: 'ClickAction' })
const props = defineProps({ action: { type: Object, required: true }, errs: { type: Object, default: () => ({}) }, kind: { type: String, default: 'image' }, outside: { type: Boolean, default: false } })
const emit = defineEmits(['update'])
const click = () => props.action.click ?? { x: null, y: null, basis: 'trainImage' }
const set = (k, text) => emit('update', { ...props.action, click: { ...click(), [k]: numIn(text) } })
</script>

<template>
  <div v-if="kind === 'image'">
    <!-- 패널이 좁으면 버튼 묶음(누를 곳 보기·다시 찍기)이 다음 줄로 간다 — 한 줄에 두면 X·Y 칸이 눌려 숫자가 보이지 않는다 -->
    <div class="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
      <span class="text-red-600 dark:text-red-400">✛</span><span>{{ t('SEW_PANEL_CLICK_AT') }}</span>
      X<input class="se-inp se-inp-n" :class="{ 'se-inp-bad': errs.click?.level === 'error' }" inputmode="numeric" data-field="click" :value="numOut(action.click?.x)" :aria-label="t('SEW_PANEL_CLICK_X')" @change="set('x', $event.target.value)">
      Y<input class="se-inp se-inp-n" :class="{ 'se-inp-bad': errs.click?.level === 'error' }" inputmode="numeric" data-testid="se-click-y" :value="numOut(action.click?.y)" :aria-label="t('SEW_PANEL_CLICK_Y')" @change="set('y', $event.target.value)">
      <slot name="repick" />
    </div>
    <p class="mt-1 text-xs leading-snug text-gray-500 dark:text-gray-400">{{ t('SEW_PANEL_CLICK_HELP') }} {{ outside ? t('SEW_PANEL_CLICK_HELP_OUT') : t('SEW_PANEL_CLICK_HELP_IN') }}</p>
    <FieldError :errs="errs" field="click" />
  </div>
  <div v-else>
    <dl class="grid grid-cols-[60px_1fr] gap-x-2 text-xs">
      <dt class="text-gray-500 dark:text-gray-400">{{ t('SEW_PANEL_CLICK_SAVED') }}</dt>
      <dd class="font-mono tabular-nums">X {{ action.click?.x ?? '—' }} · Y {{ action.click?.y ?? '—' }}</dd>
    </dl>
    <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ kind === 'none' ? t('SEW_PANEL_CLICK_NONE_HELP') : t('SEW_PANEL_CLICK_OLD_HELP') }}</p>
  </div>
</template>

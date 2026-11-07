<script setup>
// 키보드(목업 actionBody Keyboard, 조작판 10): 입력할 글자 + 기능 키 최대 10개. 누르는 순서 = keyboard.codes(조립의 정본),
// keys·unknownCodes 는 보여 주기용이라 같은 규칙으로 다시 만든다. 넣은 키를 누르면 뺀다.
import { computed } from 'vue'
import { FUNCTION_KEYS, KEY_MAX, keyboardCodesOf, withCodes, keyName } from '../../../editor/panel'
import { t } from '../../../messages'
import FieldError from '../FieldError.vue'
import '../panel.css'

defineOptions({ name: 'KeyboardAction' })
const props = defineProps({ action: { type: Object, required: true }, errs: { type: Object, default: () => ({}) } })
const emit = defineEmits(['update'])
const kb = computed(() => props.action.keyboard ?? { text: '', keys: [], unknownCodes: [], codes: [] })
const codes = computed(() => keyboardCodesOf(kb.value))
const setText = (text) => emit('update', { ...props.action, keyboard: { ...kb.value, text } })
const setCodes = (list) => emit('update', { ...props.action, keyboard: withCodes(kb.value, list) })
const add = (code) => { if (codes.value.length < KEY_MAX) setCodes([...codes.value, code]) }
const del = (i) => setCodes(codes.value.filter((_, k) => k !== i))
</script>

<template>
  <div>
    <input class="se-inp font-mono" :class="{ 'se-inp-bad': errs.key?.level === 'error' }" data-field="key" :value="kb.text" :placeholder="t('SEW_PANEL_KEY_TEXT')" :aria-label="t('SEW_PANEL_KEY_TEXT')"
      @input="setText($event.target.value)">
    <div class="se-seq mt-1.5 flex items-center gap-1 flex-wrap min-h-[26px] px-1.5 py-0.5 border border-gray-300 dark:border-dark-border rounded-md bg-white dark:bg-dark-card text-xs text-gray-400" :aria-label="t('SEW_PANEL_KEY_SEQ')">
      <span v-if="kb.text" class="font-mono text-gray-700 dark:text-gray-200">{{ kb.text }}</span>
      <button v-for="(code, i) in codes" :key="`${i}-${code}`" type="button" class="se-key" :data-key-del="i" :aria-label="t('SEW_PANEL_KEY_DEL', { name: keyName(code) })" @click="del(i)">{{ keyName(code) }}</button>
      <span v-if="!kb.text && !codes.length">{{ t('SEW_PANEL_KEY_SEQ_EMPTY') }}</span>
    </div>
    <FieldError :errs="errs" field="key" />
    <div class="mt-2 mb-1 flex justify-between gap-2 text-xs text-gray-500 dark:text-gray-400"><span>{{ t('SEW_PANEL_KEY_FUNC') }}</span><em class="not-italic text-gray-400">{{ t('SEW_PANEL_KEY_FUNC_HINT', { n: codes.length }) }}</em></div>
    <div class="flex gap-[3px] flex-wrap">
      <button v-for="code in FUNCTION_KEYS" :key="code" type="button" class="se-key" :data-key-add="code" :disabled="codes.length >= KEY_MAX" @click="add(code)">{{ keyName(code) }}</button>
    </div>
  </div>
</template>

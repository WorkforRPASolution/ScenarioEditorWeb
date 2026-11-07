<script setup>
// 사용자 스크립트(설계 §4.3): 이름·인자 목록·시간 제한(값·단위 seconds/minutes/hours)·결과 메일(성공·실패).
// 값은 parseAction 의 customScript 모양 그대로 — 저장 문자열(;·@@)은 서버가 만든다.
import { computed } from 'vue'
import { TIMEOUT_UNITS, numIn, numOut } from '../../../editor/panel'
import { t } from '../../../messages'
import FieldError from '../FieldError.vue'
import '../panel.css'

defineOptions({ name: 'CustomScriptAction' })
const props = defineProps({ action: { type: Object, required: true }, errs: { type: Object, default: () => ({}) } })
const emit = defineEmits(['update'])
const cs = computed(() => props.action.customScript ?? { name: '', args: [], timeout: null, email: [], legacy: false })
const args = computed(() => (Array.isArray(cs.value.args) ? cs.value.args : []))
const email = computed(() => (Array.isArray(cs.value.email) ? cs.value.email : []))
const put = (v) => emit('update', { ...props.action, customScript: { ...cs.value, ...v } })
const setArg = (i, v) => put({ args: args.value.map((a, k) => (k === i ? v : a)) })
const addArg = () => put({ args: [...args.value, ''] })
const delArg = (i) => put({ args: args.value.filter((_, k) => k !== i) })
const setTimeoutOn = (on) => put({ timeout: on ? { value: 1, unit: 'minutes' } : null })
const setLimit = (v) => put({ timeout: { ...cs.value.timeout, ...v } })
const setEmail = (which, on) => put({ email: ['success', 'fail'].filter((e) => (e === which ? on : email.value.includes(e))) })
const bad = computed(() => props.errs.script?.level === 'error')
const lab = 'text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap'
</script>

<template>
  <div class="space-y-1.5">
    <input class="se-inp font-mono" :class="{ 'se-inp-bad': bad }" data-field="script" :value="cs.name" :placeholder="t('SEW_PANEL_CS_NAME')" :aria-label="t('SEW_PANEL_CS_NAME')" @input="put({ name: $event.target.value })">
    <div class="flex items-start gap-1.5">
      <span :class="lab" class="pt-1.5 w-[52px] shrink-0">{{ t('SEW_PANEL_CS_ARGS') }}</span>
      <div class="flex-1 min-w-0 space-y-1">
        <div v-for="(a, i) in args" :key="i" class="flex gap-1">
          <input class="se-inp font-mono" :class="{ 'se-inp-bad': bad }" :data-cs-arg="i" :value="a" :aria-label="t('SEW_PANEL_CS_ARG', { n: i + 1 })" @input="setArg(i, $event.target.value)">
          <button type="button" class="shrink-0 w-7 h-7 rounded-md text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700" :data-cs-arg-del="i" :aria-label="t('SEW_PANEL_CS_ARG_DEL', { n: i + 1 })" @click="delArg(i)">×</button>
        </div>
        <button type="button" class="h-7 px-2 rounded-md text-xs text-primary-700 dark:text-primary-300 hover:bg-primary-50 dark:hover:bg-primary-900/30" data-testid="se-cs-arg-add" @click="addArg">＋ {{ t('SEW_PANEL_CS_ARG_ADD') }}</button>
      </div>
    </div>
    <div class="flex items-center gap-1.5 flex-wrap">
      <label :class="lab" class="w-[52px] shrink-0 flex items-center gap-1">
        <input type="checkbox" data-testid="se-cs-timeout-on" :checked="!!cs.timeout" @change="setTimeoutOn($event.target.checked)">{{ t('SEW_PANEL_CS_TIMEOUT') }}
      </label>
      <template v-if="cs.timeout">
        <input class="se-inp se-inp-n" :class="{ 'se-inp-bad': bad }" inputmode="numeric" data-testid="se-cs-timeout-value" :value="numOut(cs.timeout.value)" :aria-label="t('SEW_PANEL_CS_TIMEOUT_VALUE')" @change="setLimit({ value: numIn($event.target.value) })">
        <select class="se-inp !w-auto" data-testid="se-cs-timeout-unit" :value="cs.timeout.unit" :aria-label="t('SEW_PANEL_CS_TIMEOUT_UNIT')" @change="setLimit({ unit: $event.target.value })">
          <option v-for="u in TIMEOUT_UNITS" :key="u" :value="u">{{ t(`SEW_PANEL_CS_UNIT_${u}`) }}</option>
        </select>
      </template>
    </div>
    <div class="flex items-center gap-3">
      <span :class="lab" class="w-[52px] shrink-0">{{ t('SEW_PANEL_CS_EMAIL') }}</span>
      <label v-for="e in ['success', 'fail']" :key="e" class="flex items-center gap-1 text-xs text-gray-700 dark:text-gray-300">
        <input type="checkbox" :data-cs-email="e" :checked="email.includes(e)" @change="setEmail(e, $event.target.checked)">{{ t(`SEW_PANEL_CS_EMAIL_${e}`) }}
      </label>
    </div>
    <FieldError :errs="errs" field="script" />
  </div>
</template>

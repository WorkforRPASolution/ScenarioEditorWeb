<script setup>
// 이름 만들기(목업 svNamePanel) — 이름 규칙(editor/nameRule)이 있을 때 대·중분류를 고르고 3·4번 칸을 넣어 이름을 만든다.
import { reactive, computed } from 'vue'
import { buildName } from '../../editor/nameRule'
import { t } from '../../messages'

defineOptions({ name: 'SaveNamePanel' })
defineProps({ rule: { type: Object, required: true } })
const emit = defineEmits(['use'])
const parts = reactive({ major: '', middle: '', part3: '', part4: '' })
const built = computed(() => buildName(parts))
const ok = computed(() => !!built.value.name && !Object.keys(built.value.errors).length)
// 대·중분류를 고르기 전에는 미리 보기 문구가 안내한다 — 고른 뒤 3·4번 칸·조립 이름의 첫 오류를 보인다
const firstError = computed(() => {
  if (!parts.major || !parts.middle) return ''
  const e = built.value.errors
  const k = ['part3', 'part4', 'name'].find((f) => e[f])
  return k ? t(`SEW_NAME_${e[k].code}`, e[k].params) : ''
})
</script>

<template>
  <div class="se-sv-name" data-testid="se-save-name-panel">
    <div class="g">
      <select v-model="parts.major" class="se-inp" :aria-label="t('SEW_SAVE_NAME_MAJOR')" data-testid="se-save-name-major">
        <option value="">{{ t('SEW_SAVE_NAME_MAJOR') }}</option>
        <option v-for="r in rule.major" :key="r.name" :value="r.name" :title="r.description">{{ r.name }}</option>
      </select>
      <select v-model="parts.middle" class="se-inp" :aria-label="t('SEW_SAVE_NAME_MIDDLE')" data-testid="se-save-name-middle">
        <option value="">{{ t('SEW_SAVE_NAME_MIDDLE') }}</option>
        <option v-for="r in rule.middle" :key="r.name" :value="r.name" :title="r.description">{{ r.name }}</option>
      </select>
      <input v-model="parts.part3" class="se-inp font-mono" :class="{ 'se-inp-bad': built.errors.part3 && parts.part3 !== '' }" :placeholder="t('SEW_SAVE_NAME_PART3')"
        :aria-label="t('SEW_SAVE_NAME_PART3')" spellcheck="false" data-testid="se-save-name-part3" />
      <input v-model="parts.part4" class="se-inp font-mono" :class="{ 'se-inp-bad': built.errors.part4 }" :placeholder="t('SEW_SAVE_NAME_PART4')"
        :aria-label="t('SEW_SAVE_NAME_PART4')" spellcheck="false" data-testid="se-save-name-part4" />
    </div>
    <div class="flex items-center gap-2 mt-1.5">
      <span class="flex-1 min-w-0 font-mono text-xs text-gray-500 dark:text-gray-400 break-all" data-testid="se-save-name-preview">{{ built.name || t('SEW_SAVE_NAME_PREVIEW_EMPTY') }}</span>
      <button type="button" class="se-sv-btn" :disabled="!ok" data-testid="se-save-name-use" @click="emit('use', built.name)">{{ t('SEW_SAVE_NAME_USE') }}</button>
    </div>
    <div v-if="firstError" class="se-sv-err">{{ firstError }}</div>
  </div>
</template>

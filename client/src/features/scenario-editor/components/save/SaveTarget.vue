<script setup>
// 저장 창 왼쪽 — 어디에 저장하나(목업 saveHtml 왼쪽·renderSaveLive svTarget, 조작판 24~28): 공정·모델·이름, 대상 안내와 덮어쓰기 확인,
// 함께 저장되는 값(메일 제목·제한 시간 — 바에서 고친다).
import { computed, ref, watch, nextTick, onMounted } from 'vue'
import { useSaveFlow, overwriteDiff } from '../../stores/saveFlow'
import { useEditStore } from '../../stores/editStore'
import { useEditorStore } from '../../stores/editorStore'
import { t, LABELS, fieldMessage } from '../../messages'
import { enabledLabel, timeoutText } from '../../format'
import { typeName, followName } from '../../editor/propertyView'
import SaveNamePanel from './SaveNamePanel.vue'
import ChangeText from '../ChangeText.vue'
import '../panel/panel.css'

defineOptions({ name: 'SaveTarget' })
const emit = defineEmits(['go'])
const flow = useSaveFlow()
const edit = useEditStore()
const editor = useEditorStore()

const source = computed(() => edit.session?.source ?? null)
const process = computed(() => source.value?.process ?? editor.skeleton?.process ?? '')
const locked = computed(() => flow.stage !== 'form')
// 같은 공정의 모델(받을 설비 수). 권한 정보를 못 읽어 지금 모델이 목록에 없으면 그 값도 둔다.
const models = computed(() => {
  const list = ((editor.scopes?.processes ?? []).find((p) => p.process === process.value)?.models ?? []).map((m) => ({ model: m.model, n: m.eqpCount }))
  if (flow.target.model && !list.some((m) => m.model === flow.target.model)) list.unshift({ model: flow.target.model, n: null })
  return list
})
const id = computed(() => `${process.value}-${flow.target.model || '?'}-${flow.target.name || '?'}`)
const nameOpen = ref(false)
const canMakeName = computed(() => !!flow.nameRule && !locked.value)

// 대상의 지금 값을 서버가 풀지 못하면 null 이 온다 — "null"·빈 글이 아니라 켜짐·꺼짐의 모름과 같은 "?" 로 보인다
const unknown = LABELS.enabled.unknown
const KEY_TEXT = {
  IsEnabled: (v) => enabledLabel(v),
  Type: (v) => (v === null || v === undefined ? unknown : typeName(v)),
  StartDelay: (v) => (typeof v === 'number' ? t('SEW_SAVE_SECONDS', { n: v }) : v === null || v === undefined ? unknown : String(v)),
  NextScenarioIfSuccess: (v) => followName(v) ?? t('SEW_SAVE_FOLLOW_NONE'),
  NextScenarioIfFail: (v) => followName(v) ?? t('SEW_SAVE_FOLLOW_NONE')
}
const valueText = (key, v) => (KEY_TEXT[key] ? KEY_TEXT[key](v) : v === null || v === undefined ? t('SEW_SAVE_FOLLOW_NONE') : String(v))
const diffRows = computed(() => overwriteDiff(flow.check?.targetExists?.diff).map((d) => ({
  key: d.key, label: LABELS.propertyKey[d.key] ?? d.key, from: valueText(d.key, d.from), to: valueText(d.key, d.to)
})))

const header = computed(() => edit.session?.working?.header ?? {})
const blockCodes = computed(() => new Set((flow.check?.blocks ?? []).map((b) => b.code)))
const descBad = computed(() => blockCodes.value.has('MAIL_TITLE_EMPTY') || blockCodes.value.has('MAIL_TITLE_COLON'))
const timeoutBad = computed(() => blockCodes.value.has('TIMEOUT_INVALID'))

const nameEl = ref(null)
const modelEl = ref(null)
watch(() => flow.focusReq, (r) => { if (r) nextTick(() => (r.field === 'model' ? modelEl : nameEl).value?.focus()) })
onMounted(() => { if (!locked.value) nameEl.value?.focus() })
function useName(name) {
  flow.setTarget({ name })
  nameOpen.value = false
}
</script>

<template>
  <div>
    <div class="se-sv-t">{{ t('SEW_SAVE_WHERE') }}</div>
    <div class="se-sv-pm se-sv-f">
      <div>
        <div class="se-sv-lbl">{{ t('SEW_SAVE_PROCESS') }}</div>
        <input class="se-inp" :value="process" readonly :aria-label="t('SEW_SAVE_PROCESS')" />
      </div>
      <div>
        <div class="se-sv-lbl">{{ t('SEW_SAVE_MODEL') }}</div>
        <select ref="modelEl" class="se-inp" :class="{ 'se-inp-bad': flow.fieldErrors.model }" :value="flow.target.model" :disabled="locked" :aria-label="t('SEW_SAVE_MODEL')"
          data-testid="se-save-model" @change="flow.setTarget({ model: $event.target.value })">
          <option value="">{{ t('SEW_SAVE_MODEL_PICK') }}</option>
          <option v-for="m in models" :key="m.model" :value="m.model">{{ m.n === null ? m.model : t('SEW_SAVE_MODEL_OPTION', { model: m.model, n: m.n }) }}</option>
        </select>
        <div v-if="flow.fieldErrors.model" class="se-sv-err">{{ fieldMessage(flow.fieldErrors.model) }}</div>
      </div>
    </div>
    <div class="se-sv-f">
      <div class="se-sv-lbl">
        <span>{{ t('SEW_SAVE_NAME') }}</span>
        <button v-if="canMakeName" type="button" class="se-sv-link" data-testid="se-save-name-make" @click="nameOpen = !nameOpen">{{ t('SEW_SAVE_NAME_MAKE') }}</button>
      </div>
      <input ref="nameEl" class="se-inp font-mono" :class="{ 'se-inp-bad': flow.fieldErrors.name }" :value="flow.target.name" :disabled="locked" spellcheck="false"
        :aria-label="t('SEW_SAVE_NAME')" data-testid="se-save-name" @input="flow.setTarget({ name: $event.target.value })" />
      <div v-if="flow.fieldErrors.name" class="se-sv-err">{{ fieldMessage(flow.fieldErrors.name) }}</div>
      <SaveNamePanel v-if="nameOpen && canMakeName" :rule="flow.nameRule" @use="useName" />
    </div>

    <div class="se-sv-id">{{ id }}</div>
    <div v-if="flow.targetKind === 'same'" class="se-sv-note">{{ t('SEW_SAVE_TARGET_SAME') }}</div>
    <div v-else-if="flow.targetKind === 'new'" class="se-sv-note">{{ source ? t('SEW_SAVE_TARGET_NEW_FROM', { name: source.name }) : t('SEW_SAVE_TARGET_NEW') }}</div>
    <div v-else-if="flow.targetKind === 'exists'" class="se-sv-note am" data-testid="se-save-exists">
      {{ t('SEW_SAVE_TARGET_EXISTS') }}
      <label><input type="checkbox" :checked="flow.confirm.overwrite" :disabled="locked" data-testid="se-save-overwrite" @change="flow.setOverwrite($event.target.checked)" />
        <span>{{ t('SEW_SAVE_OVERWRITE', { name: flow.target.name }) }}</span></label>
      <div class="mt-1.5 font-medium">{{ t('SEW_SAVE_DIFF_TITLE') }}</div>
      <ul v-if="diffRows.length">
        <li v-for="r in diffRows" :key="r.key" data-testid="se-save-diff">{{ `${r.label}: ` }}<ChangeText :before="r.from" :after="r.to" /></li>
      </ul>
      <div v-else>{{ t('SEW_SAVE_DIFF_NONE') }}</div>
    </div>
    <div v-else-if="flow.checkError && !flow.checking" class="se-sv-note fa" data-testid="se-save-target-failed">{{ t('SEW_SAVE_TARGET_CHECK_FAILED') }}</div>
    <div v-else-if="!Object.keys(flow.fieldErrors).length" class="se-sv-note">{{ t('SEW_SAVE_TARGET_CHECKING') }}</div>

    <div class="se-sv-t mt-3.5">{{ t('SEW_SAVE_VALUES') }}</div>
    <dl class="se-sv-kv">
      <dt>{{ t('SEW_SAVE_MAIL_TITLE') }}</dt>
      <dd><span :class="{ bad: descBad }">{{ header.description || t('SEW_SAVE_EMPTY_VALUE') }}</span>
        <button v-if="!locked" type="button" class="se-sv-link" data-testid="se-save-fix-description" @click="emit('go', { kind: 'bar', field: 'description' })">{{ t('SEW_SAVE_FIX') }}</button></dd>
      <dt>{{ t('SEW_SAVE_TIMEOUT') }}</dt>
      <dd><span :class="{ bad: timeoutBad }">{{ timeoutText(header.timeoutLimit) }}</span>
        <button v-if="!locked" type="button" class="se-sv-link" data-testid="se-save-fix-timeout" @click="emit('go', { kind: 'bar', field: 'timeoutLimit' })">{{ t('SEW_SAVE_FIX') }}</button></dd>
    </dl>
  </div>
</template>

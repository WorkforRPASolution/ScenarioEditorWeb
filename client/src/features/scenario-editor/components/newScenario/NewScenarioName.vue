<script setup>
// 새 시나리오 창의 이름 칸(목업 nameField). 규칙이 있으면 대·중분류 고르기 + 3·4번 칸(직접 쓰는 칸 없음 — 40 §2.0 2026-11-09 ②),
// 없으면 이름 한 칸. 값은 부모 form 을 보기만 하고 바꿀 때는 set·touch 를 알린다.
import { computed } from 'vue'
import { NAME_MAX, isFreeHead } from '../../editor/nameRule'
import { t, LABELS } from '../../messages'

defineOptions({ name: 'NewScenarioName' })
// mode: 'rule' | 'direct' | 'loading' | 'failed'. msg(field) = { text, error } — 칸 아래 오류 또는 도움말.
const props = defineProps({
  mode: { type: String, required: true }, rule: { type: Object, default: null }, ruleError: { type: String, default: '' },
  form: { type: Object, required: true }, msg: { type: Function, required: true }
})
const emit = defineEmits(['set', 'touch', 'retry'])
const F = LABELS.newScenario.fields

const free = computed(() => isFreeHead(props.form.major, props.form.middle))
const optionText = (r) => (r.description ? t('SEW_NEW_RULE_OPTION', { name: r.name, description: r.description }) : r.name)
// 만들어지는 이름 미리 보기: 빈 칸은 회색 자리표(3번 칸은 머리가 AUTO_DATABACKUP 이면 뺀다)
const preview = computed(() => {
  const f = props.form
  const parts = [f.major ? { text: f.major } : { text: F.major, ph: true }, f.middle ? { text: f.middle } : { text: F.middle, ph: true }]
  if (f.part3) parts.push({ text: f.part3 })
  else if (!free.value) parts.push({ text: F.part3, ph: true })
  if (f.part4) parts.push({ text: f.part4 })
  return parts
})
const length = computed(() => (props.mode === 'rule'
  ? [props.form.major, props.form.middle, props.form.part3, props.form.part4].filter(Boolean).join('_').length
  : (props.form.name ?? '').length))
const set = (field, value) => emit('set', field, value)
const bad = (field) => (props.msg(field).error ? 'se-inp-bad' : '')
</script>

<template>
  <div class="se-ns-f">
    <div class="se-ns-lbl">
      <span>{{ F.name }}</span>
      <em v-if="mode === 'rule'">{{ t('SEW_NEW_NAME_BY_RULE') }}</em>
      <em v-else-if="mode === 'direct'" class="se-ns-c" :class="{ over: length > NAME_MAX }" data-testid="se-new-count">{{ t('SEW_NEW_NAME_COUNT', { n: length, max: NAME_MAX }) }}</em>
    </div>
    <div v-if="mode === 'loading'" class="se-ns-np se-ns-k">{{ t('SEW_NEW_RULE_LOADING') }}</div>
    <div v-else-if="mode === 'failed'" class="se-sv-note fa" role="alert" data-testid="se-new-rule-failed">
      {{ t('SEW_NEW_RULE_FAILED', { cause: ruleError }) }}
      <div class="se-ns-acts"><button type="button" class="se-sv-btn" data-testid="se-new-rule-retry" @click="emit('retry')">{{ t('SEW_NEW_RULE_RETRY') }}</button></div>
    </div>
    <div v-else-if="mode === 'rule'" class="se-ns-np">
      <div class="se-ns-np-g">
        <div>
          <div class="se-ns-np-l">{{ F.major }}</div>
          <select class="se-inp" :class="bad('major')" :value="form.major" data-nfield="major" :aria-label="F.major" data-testid="se-new-major"
            @change="set('major', $event.target.value)" @blur="emit('touch', 'major')">
            <option value="">{{ t('SEW_SAVE_MODEL_PICK') }}</option>
            <option v-for="r in rule.major" :key="r.name" :value="r.name">{{ optionText(r) }}</option>
          </select>
          <div class="se-ns-msg" :class="{ err: msg('major').error }" data-testid="se-new-msg-major">{{ msg('major').text }}</div>
        </div>
        <div>
          <div class="se-ns-np-l">{{ F.middle }}</div>
          <select class="se-inp" :class="bad('middle')" :value="form.middle" data-nfield="middle" :aria-label="F.middle" data-testid="se-new-middle"
            @change="set('middle', $event.target.value)" @blur="emit('touch', 'middle')">
            <option value="">{{ t('SEW_SAVE_MODEL_PICK') }}</option>
            <option v-for="r in rule.middle" :key="r.name" :value="r.name">{{ optionText(r) }}</option>
          </select>
          <div class="se-ns-msg" :class="{ err: msg('middle').error }" data-testid="se-new-msg-middle">{{ msg('middle').text }}</div>
        </div>
        <div>
          <div class="se-ns-np-l">{{ F.part3 }}</div>
          <input class="se-inp font-mono" :class="bad('part3')" :value="form.part3" data-nfield="part3" spellcheck="false" autocomplete="off" :placeholder="t('SEW_NEW_PART3_PLACEHOLDER')"
            :aria-label="F.part3" data-testid="se-new-part3" @input="set('part3', $event.target.value)" @blur="emit('touch', 'part3')" />
          <div class="se-ns-msg" :class="{ err: msg('part3').error }" data-testid="se-new-msg-part3">{{ msg('part3').text }}</div>
        </div>
        <div>
          <div class="se-ns-np-l">{{ LABELS.newScenario.part4 }}</div>
          <input class="se-inp font-mono" :class="bad('part4')" :value="form.part4" data-nfield="part4" spellcheck="false" autocomplete="off"
            :aria-label="LABELS.newScenario.part4" data-testid="se-new-part4" @input="set('part4', $event.target.value)" @blur="emit('touch', 'part4')" />
          <div class="se-ns-msg" :class="{ err: msg('part4').error }" data-testid="se-new-msg-part4">{{ msg('part4').text }}</div>
        </div>
      </div>
      <div class="se-ns-np-prev">
        <span class="se-ns-k">{{ F.name }}</span>
        <span class="se-ns-v" data-testid="se-new-name-preview"><template v-for="(p, i) in preview" :key="i"><template v-if="i">_</template><span :class="{ 'se-ns-ph': p.ph }">{{ p.text }}</span></template></span>
        <span class="se-ns-c" :class="{ over: length > NAME_MAX }" data-testid="se-new-count">{{ t('SEW_NEW_NAME_COUNT', { n: length, max: NAME_MAX }) }}</span>
      </div>
    </div>
    <input v-else class="se-inp font-mono" :class="bad('name')" :value="form.name" data-nfield="name" spellcheck="false" autocomplete="off" :placeholder="t('SEW_NEW_NAME_PLACEHOLDER')"
      :aria-label="F.name" data-testid="se-new-name" @input="set('name', $event.target.value)" @blur="emit('touch', 'name')" />
    <div v-if="mode === 'direct' || (mode === 'rule' && msg('name').text)" class="se-ns-msg" :class="{ err: msg('name').error }" data-testid="se-new-msg-name">{{ msg('name').text }}</div>
  </div>
</template>

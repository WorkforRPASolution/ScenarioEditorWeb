<script setup>
// 실행 경로의 후속 시나리오 칸(목업 v2 nextNode). 고르기는 같은 모델의 이름 목록(P1 목록 API, 자기 자신 빼고).
// 저장된 빈 후속 {Name:''} 은 "후속 없음" 으로 보이고, 고치지 않으면 값 그대로 둔다(잇기를 눌러야 고르는 칸이 열린다).
import { computed, inject } from 'vue'
import { t, LABELS, fieldMessage } from '../../messages'
import { followName } from '../../editor/propertyView'

defineOptions({ name: 'PropertyFollow' })
const props = defineProps({ field: { type: String, required: true } }) // NextScenarioIfSuccess | NextScenarioIfFail
const ctx = inject('sePropertyCtx')
const P = LABELS.prop

const v = computed(() => ctx.p?.[props.field] ?? null)
const name = computed(() => followName(v.value))
const showEdit = computed(() => name.value !== null || !!ctx.linked[props.field])
const listed = computed(() => (Array.isArray(ctx.names) ? ctx.names : null))
const gone = computed(() => name.value !== null && !!listed.value && !listed.value.includes(name.value))
const self = computed(() => name.value !== null && name.value === ctx.selfName)
const options = computed(() => {
  const list = (listed.value ?? []).filter((n) => n !== ctx.selfName)
  return name.value && !list.includes(name.value) ? [name.value, ...list] : list
})
const errName = computed(() => ctx.errors[`${props.field}.Name`] ?? null)
const errText = computed(() => ctx.errors[`${props.field}.Text`] ?? null)
const setPart = (part, value) => ctx.set(props.field, { Name: v.value?.Name ?? '', Text: v.value?.Text ?? '', [part]: value })
// 잇기 단추 상태(저장된 빈 후속)인데 저장 창이 이 칸의 막힘으로 보냈으면 단추 옆에 그 까닭(SEW-023 — 지운 시나리오를 다시 만들 때 서버가 막는다)
const linkIssue = computed(() => { const p = ctx.pointed; return p?.issue && p.field.split('.')[0] === props.field ? p.issue : null })
const linkErrId = computed(() => `se-prop-link-err-${props.field}`)
</script>

<template>
  <span v-if="!ctx.editing && name === null" class="se-pp-end">{{ P.end }}</span>
  <div v-else-if="!ctx.editing" class="se-pp-n se-pp-next">
    <div class="se-pp-n-t">{{ P.next }} <span v-if="gone" class="se-pp-warn">({{ t('SEW_PROP_FOLLOW_GONE_TAG') }})</span></div>
    <div class="name" :title="name">{{ name }}</div>
    <div v-if="v.Text" class="desc" :title="v.Text">{{ v.Text }}</div>
  </div>
  <div v-else-if="!showEdit">
    <button type="button" class="se-pp-link" :data-pfield="field" :aria-describedby="linkIssue ? linkErrId : undefined" @click="ctx.link(field)">{{ t('SEW_PROP_FOLLOW_LINK') }}</button>
    <div v-if="linkIssue" :id="linkErrId" class="se-pp-err" :data-testid="`se-prop-err-${field}`">{{ fieldMessage(linkIssue) }}</div>
  </div>
  <div v-else class="se-pp-n se-pp-next" :class="errName || errText ? 'bad' : ctx.changed(field) ? 'ch' : ''">
    <div class="se-pp-next-edit">
      <select class="se-pp-inp" :class="{ bad: errName }" :data-pfield="`${field}.Name`" :aria-label="P.next" :value="name ?? ''" @change="setPart('Name', $event.target.value)">
        <option v-if="!name" value="">{{ t('SEW_PROP_PICK') }}</option>
        <option v-for="o in options" :key="o" :value="o">{{ o }}</option>
      </select>
      <button type="button" class="se-pp-x" :aria-label="t('SEW_PROP_FOLLOW_UNLINK')" :title="t('SEW_PROP_FOLLOW_UNLINK')" :data-testid="`se-prop-unlink-${field}`" @click="ctx.unlink(field)">×</button>
    </div>
    <input class="se-pp-inp mt-1" :class="{ bad: errText }" :data-pfield="`${field}.Text`" :value="v?.Text ?? ''" :placeholder="t('SEW_PROP_FOLLOW_TEXT_PH')" :aria-label="t('SEW_PROP_FOLLOW_TEXT_PH')"
      @input="setPart('Text', $event.target.value)">
    <div v-if="errName" class="se-pp-err" :data-testid="`se-prop-err-${field}.Name`">{{ fieldMessage(errName) }}</div>
    <div v-if="errText" class="se-pp-err" :data-testid="`se-prop-err-${field}.Text`">{{ fieldMessage(errText) }}</div>
    <div v-if="!errName && gone" class="se-pp-warn">{{ t('RULE_FOLLOW_MISSING') }}</div>
    <div v-else-if="!errName && self" class="se-pp-warn">{{ t('RULE_FOLLOW_SELF') }}</div>
  </div>
</template>

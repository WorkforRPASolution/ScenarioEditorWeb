<script setup>
// 운영 속성 창 맨 위: 켜짐·유형·우선순위(목업 v2 .state). 값·고치기는 PropertyDialog 가 준 맥락(sePropertyCtx)으로.
import { computed, inject } from 'vue'
import { useEditStore } from '../../stores/editStore'
import { t, LABELS, fieldMessage } from '../../messages'
import { typeName, priorityName, isStandardPriority } from '../../editor/propertyView'
import { SCENARIO_TYPE_CHOICES, scenarioTypeOptions } from '../../format'

defineOptions({ name: 'PropertyState' })
const ctx = inject('sePropertyCtx')
const edit = useEditStore()
const P = LABELS.prop
const FAP = 13 // 동작 FAP — 있으면 유형이 PM 자동화(7)여야 저장된다(서버 FAP_TYPE_MISMATCH)

const p = computed(() => ctx.p)
const on = computed(() => p.value.IsEnabled === true)
const typeKnown = computed(() => SCENARIO_TYPE_CHOICES.includes(p.value.Type))
// 유형 알림: 미지정(서버 경고 TYPE_UNSET)·FAP 동작과 안 맞음(서버 막힘 FAP_TYPE_MISMATCH). [적용]은 막지 않는다 — 저장 창 검사가 본다.
const typeNote = computed(() => {
  if (p.value.Type === 0) return t('RULE_TYPE_UNSET')
  const steps = edit.session?.working?.steps ?? []
  return steps.some((s) => s.action?.type === FAP) && p.value.Type !== 7 ? t('RULE_FAP_TYPE_MISMATCH') : ''
})
</script>

<template>
  <div class="se-pp-state">
    <div class="se-pp-onoff">
      <button v-if="ctx.editing" type="button" class="se-pp-sw" role="switch" :aria-checked="String(on)" :aria-label="P.on" data-pfield="IsEnabled" data-testid="se-prop-onoff"
        @click="ctx.set('IsEnabled', !on)" />
      <span v-else class="se-pp-lamp" :class="{ off: !on }" />
      <div>
        <b>{{ on ? P.on : P.off }}</b>
        <div v-if="ctx.changed('IsEnabled')" class="se-pp-was">{{ t('SEW_PROP_WAS', { value: ctx.orig.IsEnabled === true ? P.on : P.off }) }}</div>
      </div>
    </div>
    <div class="f">
      <span class="se-pp-lbl">{{ P.type }}</span>
      <template v-if="ctx.editing">
        <select class="se-pp-inp" data-pfield="Type" :aria-label="P.type" :value="p.Type" @change="ctx.set('Type', Number($event.target.value))">
          <option v-if="!typeKnown" :value="p.Type">{{ p.Type === 0 ? t('SEW_PROP_PICK') : typeName(p.Type) }}</option>
          <option v-for="[v, l] in scenarioTypeOptions" :key="v" :value="v">{{ l }}</option>
        </select>
        <div v-if="ctx.changed('Type')" class="se-pp-was">{{ t('SEW_PROP_WAS', { value: typeName(ctx.orig.Type) }) }}</div>
      </template>
      <span v-else class="se-pp-val">{{ typeName(p.Type) }}</span>
      <span v-if="typeNote" class="se-pp-warn" data-testid="se-prop-type-note">{{ typeNote }}</span>
    </div>
    <div class="f">
      <span class="se-pp-lbl">{{ P.priority }}</span>
      <div class="flex items-center gap-2 flex-wrap">
        <span class="se-pp-seg" :class="{ ro: !ctx.editing }" role="radiogroup" :aria-label="P.priority">
          <button v-for="[v, l] in P.priorities" :key="v" type="button" role="radio" :aria-checked="String(v === p.Priority)" :tabindex="ctx.editing ? 0 : -1"
            data-pfield="Priority" @click="ctx.editing && ctx.set('Priority', v)">{{ l }}</button>
        </span>
        <span v-if="!isStandardPriority(p.Priority)" class="se-pp-warn">{{ t(ctx.editing ? 'SEW_PROP_PRIORITY_ODD_EDIT' : 'SEW_PROP_PRIORITY_ODD', { value: p.Priority }) }}</span>
        <span v-else-if="ctx.changed('Priority')" class="se-pp-was">{{ t('SEW_PROP_WAS', { value: priorityName(ctx.orig.Priority) }) }}</span>
      </div>
      <div v-if="ctx.errors.Priority" class="se-pp-err">{{ fieldMessage(ctx.errors.Priority) }}</div>
    </div>
  </div>
</template>

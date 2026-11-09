<script setup>
// 데스크탑과 그 밖의 값(목업 v2 moreBlock, 접힘). 수정 중에는 데스크탑 실행·설명·링크만 고친다. 나머지는 보기만(데이터는 그대로 보존).
import { computed, inject } from 'vue'
import { useEditorStore } from '../../stores/editorStore'
import { LABELS, fieldMessage } from '../../messages'

defineOptions({ name: 'PropertyMore' })
defineProps({ open: Boolean })
const emit = defineEmits(['update:open'])
const ctx = inject('sePropertyCtx')
const store = useEditorStore()
const P = LABELS.prop
const K = P.moreKeys

const p = computed(() => ctx.p)
const f = computed(() => store.skeleton?.performance ?? null)
const or = (v) => (v === '' || v === null || v === undefined ? P.none : String(v))
const deskOn = computed(() => p.value.ExecutingLevel === 1)
const deskText = computed(() => (p.value.ExecutingLevel === 1 ? P.on : p.value.ExecutingLevel === 0 ? P.off : String(p.value.ExecutingLevel)))
const enumOr = (v) => (v === null || v === undefined || v === 'None' ? P.none : v)
// 목업 v2 순서(두 칸 격자, 왼쪽부터): 데스크탑 실행·트리거 유형·데스크탑 설명·알림 창·데스크탑 링크·심의 의견(Conductor)·…
const rows = computed(() => {
  const x = f.value
  return [
    { k: K.deskRun, edit: 'switch' },
    { k: K.triggerType, v: P.triggerTypes[p.value.ScenarioTriggerType] ?? or(p.value.ScenarioTriggerType) },
    { k: K.deskTitle, edit: 'input', key: 'DetailedDescriptionTitle' },
    { k: K.dialog, v: p.value.IsShowDialog ? P.yes : P.no },
    { k: K.deskLink, edit: 'input', key: 'EDMLink' },
    { k: K.conductorNote, v: or(p.value.DescriptionFromConductor) },
    { k: K.detail, v: or(p.value.DetailedDescription) },
    { k: 'LcncType', v: or(p.value.LcncType) },
    { k: 'LowcodeExtension', v: or(p.value.LowcodeExtension) },
    { k: K.group, v: or(x?.group) },
    { k: K.performType, v: x ? P.performTypes[x.performTypeName] ?? enumOr(x.performTypeName) : P.none },
    { k: K.trigger, v: enumOr(x?.triggerName) },
    { k: K.triggerInfo, v: or(x?.triggerInfo) },
    { k: K.accident, v: enumOr(x?.accidentTypeName) },
    { k: K.accidentInfo, v: or(x?.accidentInfo) },
    { k: K.updated, v: or(x?.updateDate) },
    { k: K.keys, v: or(x?.rawKeys?.join(', ')) }
  ]
})
</script>

<template>
  <details class="se-pp-more" :open="open" @toggle="emit('update:open', $event.target.open)">
    <summary>{{ P.more }}</summary>
    <div class="se-pp-more-grid">
      <div v-for="r in rows" :key="r.k" class="se-pp-kv">
        <span class="k">{{ r.k }}</span>
        <span v-if="r.edit === 'switch'" class="v">
          <button v-if="ctx.editing" type="button" class="se-pp-sw sm" role="switch" :aria-checked="String(deskOn)" :aria-label="r.k" data-pfield="ExecutingLevel"
            @click="ctx.set('ExecutingLevel', deskOn ? 0 : 1)" />
          <template v-else>{{ deskText }}</template>
          <span v-if="ctx.errors.ExecutingLevel" class="se-pp-err block">{{ fieldMessage(ctx.errors.ExecutingLevel) }}</span>
        </span>
        <span v-else-if="r.edit === 'input'" class="v">
          <input v-if="ctx.editing" class="se-pp-inp" :data-pfield="r.key" :aria-label="r.k" :value="p[r.key] ?? ''" @input="ctx.set(r.key, $event.target.value)">
          <template v-else>{{ or(p[r.key]) }}</template>
        </span>
        <span v-else class="v">{{ r.v }}</span>
      </div>
    </div>
  </details>
</template>

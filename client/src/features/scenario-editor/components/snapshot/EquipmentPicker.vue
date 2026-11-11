<script setup>
// 설비 고르기(P3 설계 §4.2) — 내 범위 설비를 공정·모델로 좁히고 설비 ID 로 찾는다.
// 열린 시나리오의 공정·모델(prefer) 설비가 먼저 온다. 맞는 설비는 50대까지만 그리고 나머지는 수로 알린다.
import { ref, computed, watch } from 'vue'
import { useSnapshotStore } from '../../stores/snapshotStore'
import { processesOf, modelsOf, filterEquipment } from '../../editor/snapshotEquipment'
import { t } from '../../messages'
import '../panel/panel.css'
import './snapshot.css'

defineOptions({ name: 'EquipmentPicker' })
const props = defineProps({ prefer: { type: Object, default: null } })
const snap = useSnapshotStore()
const process = ref('')
const model = ref('')
const q = ref(snap.eqpId ?? '')
const listOpen = ref(false)

const items = computed(() => snap.equipment.items)
const processes = computed(() => processesOf(items.value))
const models = computed(() => modelsOf(items.value, process.value))
// 공정을 바꿔 그 공정에 없는 모델이 되면 모델 거르기를 푼다
watch(models, (list) => { if (model.value && !list.includes(model.value)) model.value = '' })
watch(() => snap.eqpId, (id) => { if (!listOpen.value) q.value = id ?? '' })
// 입력 칸에 지금 설비 ID 가 그대로 있으면 그 글자로 거르지 않는다(들어가자마자 전체 목록)
const needle = computed(() => (q.value === (snap.eqpId ?? '') ? '' : q.value))
const found = computed(() => filterEquipment(items.value, { q: needle.value, process: process.value, model: model.value, prefer: props.prefer }))
const ready = computed(() => snap.equipment.status === 'ready')

function openList(e) {
  listOpen.value = true
  e?.target?.select?.()
}
function closeList() {
  listOpen.value = false
  q.value = snap.eqpId ?? ''
}
function pick(id) {
  listOpen.value = false
  q.value = id
  snap.pickEquipment(id)
}
// 목록을 눌러 고르면 입력 칸이 초점을 지킨 채 목록만 닫힌다 — 그 뒤 다시 누르거나 치면 focus 이벤트 없이도 연다
const reopen = () => { listOpen.value = true }
function onKey(e) {
  if (e.key === 'Escape') { closeList(); e.target.blur?.() }
  else if (e.key === 'Enter') {
    // 친 글자가 있을 때만 맞는 첫 설비를 고른다 — 아무것도 안 쳤으면(전체 목록) 설비를 바꾸지 않고 닫기만 한다
    if (listOpen.value && needle.value && found.value.items.length) pick(found.value.items[0].eqpId)
    else closeList()
    e.target.blur?.()
  }
}
</script>

<template>
  <div class="flex flex-col gap-1.5" data-testid="se-snap-eqp">
    <div class="flex gap-1.5">
      <select v-model="process" class="se-inp" :aria-label="t('SEW_SNAP_EQP_ALL_PROCESS')" data-testid="se-snap-eqp-process">
        <option value="">{{ t('SEW_SNAP_EQP_ALL_PROCESS') }}</option>
        <option v-for="p in processes" :key="p" :value="p">{{ p }}</option>
      </select>
      <select v-model="model" class="se-inp" :aria-label="t('SEW_SNAP_EQP_ALL_MODEL')" data-testid="se-snap-eqp-model">
        <option value="">{{ t('SEW_SNAP_EQP_ALL_MODEL') }}</option>
        <option v-for="m in models" :key="m" :value="m">{{ m }}</option>
      </select>
    </div>
    <div class="relative">
      <input v-model="q" class="se-inp" type="text" autocomplete="off" spellcheck="false" :aria-label="t('SEW_SNAP_EQP_LABEL')" :disabled="!ready"
        :placeholder="snap.equipment.status === 'loading' ? t('SEW_SNAP_EQP_LOADING') : t('SEW_SNAP_EQP_PLACEHOLDER')" data-testid="se-snap-eqp-input"
        @focus="openList" @click="reopen" @input="reopen" @blur="closeList" @keydown="onKey" />
      <!-- 목록을 누를 때 입력 칸이 초점을 잃지 않게(잃으면 누르기 전에 목록이 닫힌다) mousedown 을 막는다 -->
      <div v-if="listOpen && ready" class="se-snap-eqp-list" @mousedown.prevent>
        <button v-for="(e, i) in found.items" :key="e.eqpId" type="button" tabindex="-1" :class="{ on: e.eqpId === snap.eqpId, first: i === 0 && !!needle }" data-testid="se-snap-eqp-option" :data-eqp="e.eqpId" @click="pick(e.eqpId)">
          <b>{{ e.eqpId }}</b><small>{{ e.process }} · {{ e.model }}</small>
        </button>
        <p v-if="!found.total">{{ t('SEW_SNAP_EQP_NONE') }}</p>
        <p v-else-if="found.total > found.items.length" data-testid="se-snap-eqp-more">{{ t('SEW_SNAP_EQP_MORE', { n: found.total - found.items.length }) }}</p>
      </div>
    </div>
    <div v-if="snap.equipment.status === 'error'" class="text-xs text-red-700 dark:text-red-300 flex items-start gap-2" data-testid="se-snap-eqp-error">
      <span class="flex-1 min-w-0">{{ t('SEW_SNAP_EQP_FAILED') }} {{ snap.equipment.error }}</span>
      <button type="button" class="shrink-0 underline" data-testid="se-snap-eqp-retry" @click="snap.loadEquipment()">{{ t('SEW_UI_RETRY') }}</button>
    </div>
  </div>
</template>

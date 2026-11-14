<script setup>
// 설비 고르기(P3 설계 §4.2) — 내 범위 설비를 공정·모델로 좁히고 설비 ID·IP 의 일부로 찾는다.
// - 공정·모델은 글자로 찾는 선택 상자(SearchSelect)다. 검색어를 치면 그 목록도 맞는 설비의 공정·모델로 좁혀진다.
// - 검색어는 다른 칸으로 가도 남는다(공정·모델을 이어 고를 수 있게). 설비를 고르거나 Esc 를 누르면 지금 설비 ID 로 돌아온다.
// - 열린 시나리오의 공정·모델(prefer) 설비가 먼저 온다. 맞는 설비는 50대까지만 그리고 나머지는 수로 알린다.
import { ref, computed, watch, nextTick } from 'vue'
import { useSnapshotStore } from '../../stores/snapshotStore'
import { processesOf, modelsOf, filterEquipment, searchEquipment, stepActive } from '../../editor/snapshotEquipment'
import { t } from '../../messages'
import SearchSelect from './SearchSelect.vue'
import '../panel/panel.css'
import './snapshot.css'

defineOptions({ name: 'EquipmentPicker' })
const props = defineProps({ prefer: { type: Object, default: null } })
const snap = useSnapshotStore()
const process = ref('')
const model = ref('')
const q = ref(snap.eqpId ?? '')
const listOpen = ref(false)
const active = ref(-1)
const list = ref(null)

const items = computed(() => snap.equipment.items)
// 입력 칸에 지금 설비 ID 가 그대로 있으면 그 글자로 거르지 않는다(들어가자마자 전체 목록)
const needle = computed(() => (q.value === (snap.eqpId ?? '') ? '' : q.value.trim()))
// 검색어(설비 ID·IP)에 맞는 설비 — 공정·모델 목록과 설비 목록을 모두 여기서 만든다
const matched = computed(() => searchEquipment(items.value, needle.value))
const processes = computed(() => processesOf(matched.value))
const models = computed(() => modelsOf(matched.value, process.value))
// 공정을 바꿔 그 공정에 없는 모델이 되면 모델 거르기를 푼다. 검색어 때문에 목록에서 빠진 것은 풀지 않는다(거르기는 저절로 바뀌지 않는다).
watch(process, (p) => { if (model.value && !modelsOf(items.value, p).includes(model.value)) model.value = '' })
watch(() => snap.eqpId, (id) => { if (!listOpen.value) q.value = id ?? '' })
const found = computed(() => filterEquipment(matched.value, { process: process.value, model: model.value, prefer: props.prefer }))
const ready = computed(() => snap.equipment.status === 'ready')
const ipOf = (e) => [e.ipAddr, e.ipAddrL].filter((v) => typeof v === 'string' && v !== '').join(' / ')
// 친 글자가 있으면 맞는 첫 설비가 Enter 대상이다. 안 쳤으면(전체 목록) ↑↓ 로 고른 줄만 대상이다.
watch([needle, listOpen, process, model], () => { active.value = needle.value && found.value.items.length ? 0 : -1 })
watch(active, async () => {
  await nextTick()
  list.value?.querySelector('.first')?.scrollIntoView?.({ block: 'nearest' })
})

function openList(e) {
  listOpen.value = true
  e?.target?.select?.()
}
// 목록만 닫는다 — 친 검색어는 남긴다(비었으면 지금 설비 ID 로)
function closeList() {
  listOpen.value = false
  if (!q.value.trim()) q.value = snap.eqpId ?? ''
}
// 검색어를 버리고 지금 설비 ID 로 되돌린다
function resetQuery() {
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
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    if (!listOpen.value) { listOpen.value = true; return } // 닫혀 있으면 열기만 한다
    active.value = stepActive(active.value, e.key === 'ArrowDown' ? 1 : -1, found.value.items.length)
  } else if (e.key === 'Escape') { resetQuery(); e.target.blur?.() }
  else if (e.key === 'Enter') {
    // 아무것도 안 치고 줄도 안 옮겼으면 설비를 바꾸지 않고 닫기만 한다
    const hit = listOpen.value ? found.value.items[active.value] : null
    if (hit) pick(hit.eqpId)
    else closeList()
    e.target.blur?.()
  }
}
</script>

<template>
  <div class="flex flex-col gap-1.5" data-testid="se-snap-eqp">
    <!-- 두 선택 상자의 목록은 이 줄의 폭 전체로 열린다 -->
    <div class="relative flex gap-1.5">
      <SearchSelect v-model="process" :options="processes" :all-label="t('SEW_SNAP_EQP_ALL_PROCESS')" :disabled="!ready" testid="se-snap-eqp-process" />
      <SearchSelect v-model="model" :options="models" :all-label="t('SEW_SNAP_EQP_ALL_MODEL')" :disabled="!ready" testid="se-snap-eqp-model" />
    </div>
    <div class="relative">
      <input v-model="q" class="se-inp" type="text" autocomplete="off" spellcheck="false" :aria-label="t('SEW_SNAP_EQP_LABEL')" :disabled="!ready"
        :placeholder="snap.equipment.status === 'loading' ? t('SEW_SNAP_EQP_LOADING') : t('SEW_SNAP_EQP_PLACEHOLDER')" data-testid="se-snap-eqp-input"
        @focus="openList" @click="reopen" @input="reopen" @blur="closeList" @keydown="onKey" />
      <!-- 목록을 누를 때 입력 칸이 초점을 잃지 않게(잃으면 누르기 전에 목록이 닫힌다) mousedown 을 막는다 -->
      <div v-if="listOpen && ready" ref="list" class="se-snap-eqp-list" @mousedown.prevent>
        <button v-for="(e, i) in found.items" :key="e.eqpId" type="button" tabindex="-1" :class="{ on: e.eqpId === snap.eqpId, first: i === active }" data-testid="se-snap-eqp-option" :data-eqp="e.eqpId" @click="pick(e.eqpId)">
          <b>{{ e.eqpId }}</b><small>{{ e.process }} · {{ e.model }}<template v-if="ipOf(e)"> · {{ ipOf(e) }}</template></small>
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

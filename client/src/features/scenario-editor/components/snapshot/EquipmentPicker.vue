<script setup>
// 설비 고르기(P3 설계 §4.2) — 내 범위 설비를 공정·모델로 좁히고 설비 ID·IP 의 일부로 찾는다.
// - 공정·모델은 글자로 찾는 선택 상자(SearchSelect)다. 검색어를 치면 그 목록도 맞는 설비의 공정·모델로 좁혀진다.
// - 검색어는 다른 칸으로 가도 남는다(공정·모델을 이어 고를 수 있게). 설비를 고르거나 Esc 를 누르면 지금 설비 ID 로 돌아온다.
// - 스냅샷 유무: 공정·모델 항목 옆에 "스냅샷 있는 설비 수 / 전체"(지금 검색어·공정 안에서 센다), 설비 줄에 가장 늦은 날짜(없으면 "없음").
//   값은 store 가 뒤에서 받는다(snap.presence) — 다 받기 전에는 "… / 전체" 이고 모르는 설비에는 아무것도 붙이지 않는다.
// - 열린 시나리오의 공정·모델(prefer) 설비가 먼저 온다. 맞는 설비는 50대까지만 그리고 나머지는 수로 알린다.
import { SECONDARY } from '../buttonStyle'
import { ref, computed, watch, nextTick } from 'vue'
import { useSnapshotStore } from '../../stores/snapshotStore'
import { processesOf, modelsOf, filterEquipment, searchEquipment, stepActive, scrollTopFor, countPresence, presenceText, shortDate } from '../../editor/snapshotEquipment'
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
// ── 스냅샷 유무 표시 ── 셈은 선택 상자 목록이 열려 그 글을 그릴 때만 한다(검색 칸에 칠 때마다 세지 않는다)
const processCounts = computed(() => countPresence(matched.value, 'process', snap.presence.latest))
const modelCounts = computed(() => countPresence(process.value ? matched.value.filter((e) => e.process === process.value) : matched.value, 'model', snap.presence.latest))
const TITLES = { ready: 'SEW_SNAP_PRESENCE_TITLE', loading: 'SEW_SNAP_PRESENCE_LOADING_TITLE' }
function noteOf(count) {
  const status = snap.presence.status
  return count ? { text: presenceText(count, status), title: t(TITLES[status] ?? 'SEW_SNAP_PRESENCE_TOTAL_TITLE', count) } : null
}
const processNote = (o) => noteOf(processCounts.value.get(o))
const modelNote = (o) => noteOf(modelCounts.value.get(o))
// 설비 줄의 가장 늦은 날짜 — 다 받기 전에는 모르는 설비에 "없음" 을 쓰지 않는다
function latestOf(e) {
  const date = snap.presence.latest.get(e.eqpId)
  if (date) return { has: '1', text: shortDate(date) || date, title: t('SEW_SNAP_EQP_LATEST_TITLE', { date }) }
  return snap.presence.status === 'ready' ? { has: '0', text: t('SEW_SNAP_EQP_NO_SNAP'), title: t('SEW_SNAP_EQP_NO_SNAP_TITLE') } : null
}
const rows = computed(() => found.value.items.map((e) => ({ e, ip: ipOf(e), latest: latestOf(e) })))
// 친 글자가 있으면 맞는 첫 설비가 Enter 대상이다. 안 쳤으면(전체 목록) ↑↓ 로 고른 줄만 대상이다.
watch([needle, listOpen, process, model], () => { active.value = needle.value && found.value.items.length ? 0 : -1 })
// ↑↓ 로 옮긴 줄이 목록 안에 보이게, 글자를 치면 맨 위로(스크롤해 둔 채 Enter 로 안 보이는 첫 줄을 고르지 않게)
watch(active, async () => {
  await nextTick()
  const box = list.value
  const row = box?.querySelector('.first')
  if (row) box.scrollTop = scrollTopFor(row.offsetTop, row.offsetHeight, box.scrollTop, box.clientHeight)
})
watch(needle, async () => {
  await nextTick()
  if (list.value) list.value.scrollTop = 0
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
// [초기화](사내 요청 2026-11-16) — 공정·모델·설비 고른 것을 비운다(목록도 비워진다). 날짜는 건드리지 않는다
const canClear = computed(() => !!(process.value || model.value || q.value || snap.eqpId))
function clearAll() {
  listOpen.value = false
  process.value = ''
  model.value = ''
  q.value = ''
  snap.clearEquipment()
}
// 목록을 눌러 고르면 입력 칸이 초점을 지킨 채 목록만 닫힌다 — 그 뒤 다시 누르거나 치면 focus 이벤트 없이도 연다.
// 닫힌 채 누르면 들어올 때처럼 글자를 모두 고른다(이어서 치면 설비 ID 뒤에 덧붙지 않고 바뀐다).
function onClick(e) { if (!listOpen.value) openList(e) }
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
    <!-- 세 목록(공정·모델·설비)은 모두 이 자리의 폭 전체로, 검색 칸 아래에 열린다 — 공정·모델 목록이 검색 칸을 덮지 않게 -->
    <div class="relative flex flex-col gap-1.5" data-testid="se-snap-eqp-fields" @focus.capture="snap.refreshPresence()">
      <div class="flex gap-1.5">
        <SearchSelect v-model="process" :options="processes" :all-label="t('SEW_SNAP_EQP_ALL_PROCESS')" :disabled="!ready" :note-of="processNote" testid="se-snap-eqp-process" />
        <SearchSelect v-model="model" :options="models" :all-label="t('SEW_SNAP_EQP_ALL_MODEL')" :disabled="!ready" :note-of="modelNote" testid="se-snap-eqp-model" />
      </div>
      <div class="flex gap-1.5">
        <input v-model="q" class="se-inp min-w-0" type="text" autocomplete="off" spellcheck="false" :aria-label="t('SEW_SNAP_EQP_LABEL')" :disabled="!ready"
          :placeholder="snap.equipment.status === 'loading' ? t('SEW_SNAP_EQP_LOADING') : t('SEW_SNAP_EQP_PLACEHOLDER')" data-testid="se-snap-eqp-input"
          @focus="openList" @click="onClick" @input="reopen" @blur="closeList" @keydown="onKey" />
        <button type="button" class="shrink-0 h-[30px] px-2 rounded-md text-xs" :class="SECONDARY"
          :disabled="!ready || !canClear" :title="t('SEW_SNAP_EQP_CLEAR_HINT')" data-testid="se-snap-eqp-clear" @click="clearAll">{{ t('SEW_SNAP_EQP_CLEAR') }}</button>
      </div>
      <!-- 목록을 누를 때 입력 칸이 초점을 잃지 않게(잃으면 누르기 전에 목록이 닫힌다) mousedown 을 막는다 -->
      <div v-if="listOpen && ready" ref="list" class="se-snap-eqp-list" @mousedown.prevent>
        <button v-for="({ e, ip, latest }, i) in rows" :key="e.eqpId" type="button" tabindex="-1" :class="{ on: e.eqpId === snap.eqpId, first: i === active }" data-testid="se-snap-eqp-option" :data-eqp="e.eqpId" @click="pick(e.eqpId)">
          <span class="se-snap-eqp-head">
            <b>{{ e.eqpId }}</b>
            <em v-if="latest" :data-has="latest.has" :title="latest.title" data-testid="se-snap-eqp-latest">{{ latest.text }}</em>
          </span>
          <small>{{ e.process }} · {{ e.model }}<template v-if="ip"> · {{ ip }}</template></small>
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

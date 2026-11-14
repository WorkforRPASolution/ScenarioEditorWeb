<script setup>
// 글자로 찾는 선택 상자 — 하나만 고른다(P3 설계 §4.2, 설비 고르기의 공정·모델).
// 칸에 들어가면 목록이 열리고, 치면 항목이 좁혀진다. ↑↓ 로 줄을 옮기고 Enter 로 고른다. Esc·나가기는 고른 값으로 되돌린다.
// 목록은 가장 가까운 자리 잡힌 조상(설비 고르기의 선택 상자 줄과 검색 칸을 감싼 자리)의 폭 전체로, 그 아래에 열린다 —
// 이 부품은 스스로 자리를 잡지 않는다(칸 바로 아래에 열면 검색 칸과 거기 남은 검색어를 덮는다).
import { ref, computed, watch, nextTick } from 'vue'
import { filterOptions, stepActive, scrollTopFor } from '../../editor/snapshotEquipment'
import { t } from '../../messages'
import '../panel/panel.css'
import './snapshot.css'

defineOptions({ name: 'SearchSelect' })
const props = defineProps({
  modelValue: { type: String, default: '' }, // '' = 전체
  options: { type: Array, default: () => [] },
  allLabel: { type: String, required: true },
  testid: { type: String, required: true },
  disabled: { type: Boolean, default: false },
  // 항목 옆에 붙일 글(스냅샷 있는 설비 수) — (항목) => { text, title }. 목록이 열려 있을 때만 부른다
  noteOf: { type: Function, default: null }
})
const emit = defineEmits(['update:modelValue'])

const text = ref(props.modelValue)
const open = ref(false)
const active = ref(-1)
const list = ref(null)
watch(() => props.modelValue, (v) => { if (!open.value) text.value = v })
// 칸에 고른 값이 그대로 있으면 그 글자로 거르지 않는다(들어가자마자 전체 목록)
const needle = computed(() => (text.value === props.modelValue ? '' : text.value.trim()))
const found = computed(() => filterOptions(props.options, needle.value))
// 친 글자가 없을 때만 맨 위에 "전체" 줄('')을 둔다
const rows = computed(() => (needle.value ? found.value.items : ['', ...found.value.items]))
const notes = computed(() => (props.noteOf ? rows.value.map((o) => props.noteOf(o)) : null))
// 친 글자가 있으면 맞는 첫 줄이 Enter 대상이다
watch([needle, open], () => { active.value = needle.value && rows.value.length ? 0 : -1 })
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
  open.value = true
  e?.target?.select?.()
}
// 고른 뒤에는 초점이 칸에 남는다 — 닫힌 채 다시 누르면 들어올 때처럼 글자를 모두 고른다(이어서 치면 덧붙지 않고 바뀐다)
function onClick(e) { if (!open.value) openList(e) }
const reopen = () => { open.value = true }
function close() {
  open.value = false
  text.value = props.modelValue
}
function pick(value) {
  open.value = false
  text.value = value
  if (value !== props.modelValue) emit('update:modelValue', value)
}
function onKey(e) {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    if (!open.value) { open.value = true; return } // 닫혀 있으면 열기만 한다
    active.value = stepActive(active.value, e.key === 'ArrowDown' ? 1 : -1, rows.value.length)
  } else if (e.key === 'Escape') {
    close()
  } else if (e.key === 'Enter') {
    if (open.value && active.value >= 0 && active.value < rows.value.length) pick(rows.value[active.value])
    else close()
  }
}
</script>

<template>
  <div class="flex-1 min-w-0">
    <input v-model="text" class="se-inp" type="text" role="combobox" autocomplete="off" spellcheck="false" :disabled="disabled" :placeholder="allLabel" :aria-label="allLabel"
      :aria-expanded="open ? 'true' : 'false'" :data-testid="testid" @focus="openList" @click="onClick" @input="reopen" @blur="close" @keydown="onKey" />
    <!-- 목록을 누를 때 칸이 초점을 잃지 않게(잃으면 누르기 전에 목록이 닫힌다) mousedown 을 막는다 -->
    <div v-if="open && !disabled" ref="list" class="se-snap-eqp-list" @mousedown.prevent>
      <button v-for="(o, i) in rows" :key="o" type="button" tabindex="-1" :class="{ on: o === modelValue, first: i === active }" :title="o || allLabel" :data-testid="`${testid}-option`" :data-value="o" @click="pick(o)">
        <span v-if="notes" class="se-snap-eqp-head">
          <span class="se-snap-opt">{{ o || allLabel }}</span>
          <em v-if="notes[i]?.text" :title="notes[i].title" :data-testid="`${testid}-note`">{{ notes[i].text }}</em>
        </span>
        <span v-else class="se-snap-opt">{{ o || allLabel }}</span>
      </button>
      <p v-if="!rows.length">{{ t('SEW_SNAP_OPT_NONE') }}</p>
      <p v-else-if="found.total > found.items.length" :data-testid="`${testid}-more`">{{ t('SEW_SNAP_OPT_MORE', { n: found.total - found.items.length }) }}</p>
    </div>
  </div>
</template>

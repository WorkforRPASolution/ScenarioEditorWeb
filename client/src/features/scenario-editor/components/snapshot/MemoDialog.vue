<script setup>
// 스냅샷 메모 창(P3 설계 §4.4) — 쓰기·고치기, 지우기 확인.
// - 글 한 칸(128자, 작은따옴표 금지). 있던 메모를 비우고 저장하면 지울지 묻는다. 새 메모를 빈 채 저장하면 그냥 닫는다(사내와 같다).
// - 남의 메모는 고치거나 지우기 전에 누구 것인지 보인다. 그 사이 다른 사람이 바꿨으면(409) 닫지 않고 지금 내용을 보인다 —
//   저장소가 그 줄을 지금 값으로 바꿔 두므로, 다시 저장하면 그 내용을 본 것으로 보낸다.
// - 대상은 창을 열 때의 파일 이름이다(고른 줄이 그 사이 바뀌어도 그 스냅샷에 쓴다). 대상·모드가 바뀌면 글·확인·충돌 상태를 처음부터 다시 잡고,
//   열려 있는 동안 그 줄이 목록에서 사라지면 닫는다 — 숨은 채 열려 있다가 앞의 글로 다른 메모를 덮지 않게.
// - Tab 은 창 안에서만 돈다(뒤의 날짜·목록 단추로 나가 목록을 바꾸지 않게).
// - entry 를 주면 메모 목록 창의 줄({ eqpId, fileName, date, time, memo })이 대상이다 — 지금 보는 설비·날짜가 아니어도 고친다(사내 요청 2026-11-16).
//   그 줄이 메모 목록에서 사라지면(그 사이 지워짐) 닫고 gone 을 알린다.
import { ref, computed, watch, nextTick } from 'vue'
import { useSnapshotStore } from '../../stores/snapshotStore'
import { MEMO_MAX, checkMemo, isMine } from '../../editor/snapshotMemo'
import { t } from '../../messages'
import '../panel/panel.css'

defineOptions({ name: 'MemoDialog' })
const props = defineProps({
  modelValue: Boolean,
  fileName: { type: String, default: '' },
  mode: { type: String, default: 'edit' }, // 'edit'(쓰기·고치기) | 'delete'(지우기 확인)
  me: { type: String, default: '' }, // 내 아이디 — 남의 메모를 가린다
  entry: { type: Object, default: null } // 메모 목록의 줄 — 주면 fileName 대신 이것이 대상
})
const emit = defineEmits(['update:modelValue', 'gone'])
const snap = useSnapshotStore()

const item = computed(() => (props.entry
  ? snap.memoList.items.find((m) => m.eqpId === props.entry.eqpId && m.fileName === props.entry.fileName) ?? null
  : snap.list.items.find((i) => i.fileName === props.fileName) ?? null))
const title = computed(() => (!item.value ? '' : props.entry
  ? t('SEW_SNAP_MEMO_TITLE', { eqp: item.value.eqpId, time: `${item.value.date} ${item.value.time}` })
  : t('SEW_SNAP_MEMO_TITLE', { eqp: snap.eqpId, time: item.value.time })))
const memo = computed(() => item.value?.memo ?? null)
const text = ref('')
const asking = ref(false) // 지울지 묻는 중
const busy = ref(false)
const error = ref('')
const conflict = ref(null) // { current } — 그 사이 바뀐 지금 값
const box = ref(null)
const input = ref(null)

const close = () => emit('update:modelValue', false)
watch(() => [props.modelValue, props.fileName, props.mode, props.entry?.eqpId, props.entry?.fileName], async ([open]) => {
  if (!open) return
  if (!item.value) { close(); return } // 목록이 그 사이 바뀌었다
  text.value = memo.value?.text ?? ''
  asking.value = props.mode === 'delete'
  busy.value = false
  error.value = ''
  conflict.value = null
  await nextTick()
  if (asking.value) box.value?.focus?.()
  else { input.value?.focus?.(); input.value?.select?.() }
}, { immediate: true })
// 열려 있는 동안 그 줄이 목록에서 사라졌다(새로 고침·목록 실패·다른 설비)
watch(item, (it) => { if (props.modelValue && !it) close() })

const checked = computed(() => checkMemo(text.value))
const problem = computed(() => (checked.value.error ? t(`SEW_ERR_${checked.value.error}`) : ''))
const nameOf = (m) => m?.authorName || t('SEW_SNAP_MEMO_SOMEONE')
const others = computed(() => (memo.value && !isMine(memo.value, props.me) ? t(asking.value ? 'SEW_SNAP_MEMO_OTHERS_REMOVE' : 'SEW_SNAP_MEMO_OTHERS', { name: nameOf(memo.value) }) : ''))
const now = computed(() => {
  if (!conflict.value) return ''
  const c = conflict.value.current
  if (!c) return t('SEW_SNAP_MEMO_NOW_NONE')
  // 작성자는 처음 쓴 사람이다 — 웹에서 고친 사람이 있으면 함께 보인다(데스크톱에서 고친 것은 남지 않는다)
  return c.editedBy ? t('SEW_SNAP_MEMO_NOW_EDITED', { text: c.text, name: nameOf(c), by: c.editedBy }) : t('SEW_SNAP_MEMO_NOW', { text: c.text, name: nameOf(c) })
})

async function save() {
  if (busy.value || problem.value) return
  const c = checked.value
  if (c.empty) {
    if (memo.value) { asking.value = true; error.value = '' } else close()
    return
  }
  if (memo.value && c.text === memo.value.text.trim()) { close(); return } // 바뀐 것이 없다(앞뒤 공백만 다른 것도)
  busy.value = true
  error.value = ''
  const entry = props.entry // 기다리는 사이 줄이 사라지면 창이 닫히며 entry 가 비워진다 — 보낼 때의 것을 쥔다
  const r = await (entry ? snap.saveMemoAt(entry, c.text) : snap.saveMemo(props.fileName, c.text))
  busy.value = false
  if (r.ok) close()
  // 메모 목록의 줄: 그 사이 지워졌으면 줄이 사라졌다 — 닫고 알린다(목록 창이 문구를 보인다)
  else if (r.conflict && !r.current && entry) goneOut(entry)
  else if (r.conflict) conflict.value = { current: r.current }
  else error.value = r.error
}
async function remove() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  const entry = props.entry
  const r = await (entry ? snap.removeMemoAt(entry) : snap.removeMemo(props.fileName))
  busy.value = false
  if (r.ok) close()
  // 이미 없다(그 사이 남이 지움) — 지우려던 것이 이뤄졌으니 알리고 닫는다
  else if (r.gone || (r.conflict && !r.current)) goneOut(entry)
  else if (r.conflict) conflict.value = { current: r.current }
  else error.value = r.error
}
function goneOut(entry) {
  if (entry) emit('gone')
  else snap.say(t('SEW_ERR_MEMO_GONE'))
  close()
}
const cancel = () => { if (!busy.value) close() }
const back = () => { if (!busy.value) { asking.value = false; nextTick(() => input.value?.focus?.()) } }
function onKey(e) {
  if (e.key === 'Escape') { e.stopPropagation(); cancel(); return }
  if (e.key !== 'Tab' || !box.value) return
  const stops = [...box.value.querySelectorAll('input, button')].filter((el) => !el.disabled)
  if (!stops.length) { e.preventDefault(); return }
  const i = stops.indexOf(document.activeElement)
  const next = e.shiftKey ? (i <= 0 ? stops.length - 1 : i - 1) : (i < 0 || i === stops.length - 1 ? 0 : i + 1)
  e.preventDefault()
  stops[next].focus()
}
// 한글 조합 중의 Enter 는 글자를 확정하는 것이다
function onEnter(e) {
  if (e.isComposing || e.keyCode === 229) return
  e.preventDefault()
  save()
}

// 메모 목록 창(z-50) 위에 뜬다
const dim = 'fixed inset-0 z-[60] bg-black/40 flex items-center justify-center'
const boxCls = 'w-[470px] max-w-[calc(100vw-40px)] bg-white dark:bg-dark-card border border-gray-200 dark:border-dark-border rounded-xl shadow-2xl outline-none'
const btnS = 'h-8 px-3 rounded-lg text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:enabled:bg-gray-300 dark:hover:enabled:bg-gray-600 disabled:opacity-50'
const btnP = 'h-8 px-3 rounded-lg text-sm bg-primary-500 hover:enabled:bg-primary-600 text-white font-medium disabled:opacity-50'
const btnD = 'h-8 px-3 rounded-lg text-sm bg-red-600 hover:enabled:bg-red-700 text-white font-medium disabled:opacity-50'
const note = 'mt-1.5 text-xs'
</script>

<template>
  <Teleport to="body">
    <div v-if="modelValue && item" :class="dim" @click.self="cancel">
      <div ref="box" :class="boxCls" role="dialog" aria-modal="true" tabindex="-1" data-testid="se-memo-dialog" @keydown="onKey">
        <h3 class="px-[18px] pt-3.5 text-[15px] font-semibold text-gray-900 dark:text-white">{{ title }}</h3>
        <div class="px-[18px] pt-2.5 pb-1">
          <template v-if="!asking">
            <input ref="input" v-model="text" class="se-inp w-full" type="text" autocomplete="off" spellcheck="false" :disabled="busy" :placeholder="t('SEW_SNAP_MEMO_PLACEHOLDER')"
              :aria-label="t('SEW_SNAP_MEMO_PLACEHOLDER')" data-testid="se-memo-input" @keydown.enter="onEnter" />
            <p :class="note" class="text-gray-500 dark:text-gray-400">
              <span class="tabular-nums" :class="{ 'text-red-600 dark:text-red-400': checked.error === 'MEMO_TOO_LONG' }" data-testid="se-memo-count">{{ t('SEW_SNAP_MEMO_COUNT', { n: checked.text.length, max: MEMO_MAX }) }}</span>
              · {{ t('SEW_SNAP_MEMO_RULE') }}<template v-if="memo"> · {{ t('SEW_SNAP_MEMO_RULE_EMPTY') }}</template>
            </p>
            <p v-if="problem" :class="note" class="text-red-600 dark:text-red-400" data-testid="se-memo-problem">{{ problem }}</p>
          </template>
          <div v-else data-testid="se-memo-confirm">
            <p class="text-sm text-gray-800 dark:text-gray-100">{{ t('SEW_SNAP_MEMO_CONFIRM') }}</p>
            <p v-if="memo" class="mt-1.5 px-2.5 py-1.5 rounded-md text-[13px] bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-100 break-words">{{ memo.text }}</p>
          </div>
          <p v-if="others" :class="note" class="text-amber-700 dark:text-amber-300" data-testid="se-memo-others">{{ others }}</p>
          <p v-if="conflict" :class="note" class="text-red-600 dark:text-red-400 break-words" role="alert" data-testid="se-memo-conflict">{{ t('SEW_ERR_MEMO_CONFLICT') }}<br>{{ now }}</p>
          <p v-if="error" :class="note" class="text-red-600 dark:text-red-400" role="alert" data-testid="se-memo-error">{{ error }}</p>
        </div>
        <div class="px-[18px] py-3 flex justify-end gap-2">
          <template v-if="asking">
            <button v-if="mode === 'delete'" type="button" :class="btnS" :disabled="busy" data-testid="se-memo-cancel" @click="cancel">{{ t('SEW_SNAP_MEMO_CANCEL') }}</button>
            <button v-else type="button" :class="btnS" :disabled="busy" data-testid="se-memo-back" @click="back">{{ t('SEW_SNAP_MEMO_BACK') }}</button>
            <button type="button" :class="btnD" :disabled="busy" data-testid="se-memo-delete" @click="remove">{{ t('SEW_SNAP_MEMO_REMOVE') }}</button>
          </template>
          <template v-else>
            <button type="button" :class="btnS" :disabled="busy" data-testid="se-memo-cancel" @click="cancel">{{ t('SEW_SNAP_MEMO_CANCEL') }}</button>
            <button type="button" :class="btnP" :disabled="busy || !!problem" data-testid="se-memo-save" @click="save">{{ t(busy ? 'SEW_SNAP_MEMO_SAVING' : 'SEW_SNAP_MEMO_SAVE') }}</button>
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>

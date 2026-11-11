<script setup>
// 전처리 설정 창(P2-F 설계 §7, 목업 2026-11-11-preprocessing-v1) — 대상 창·숨길 창을 보고 고친다. 사내 PreprocessingWindow 에 해당한다.
// 창 안 작업본에서 고치고 [적용] 때 편집 작업본(header.windows)에 넣는다(editStore.applyWindows — 배포·초안이 함께 싣는다). [취소] 는 버린다.
// 사내와 다른 곳: 숨길 창은 클래스 이름 필수(41 DC-144), 한도 20 을 붙여넣기에도(DC-145), 좌표는 정수만(DC-146), 앞뒤 공백을 지운다(DC-147),
// 줄에서 바로 고치기, 줄마다 "실행 때 찾는지"(에이전트 기준 — editor/windows). 대상 창 위치 값은 에이전트가 읽지 않아 접어 둔다.
// 고치지 않은 줄은 검사하지 않는다(옛 값은 표시만) — 서버도 새로 넣거나 고친 조건만 막는다.
import { ref, shallowRef, reactive, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import { useEditorStore } from '../stores/editorStore'
import { useEditStore } from '../stores/editStore'
import { t } from '../messages'
import {
  HIDING_LIMIT, UNCHECKED, blankWindow, blankWindows, targetState, hidingState, sameWindow, sameCondition, cleanWindow, windowErrors,
  parseCoord, pasteHiding, windowChanges, normalizeWindows
} from '../editor/windows'
import ModalShell from './ModalShell.vue'
import './panel/panel.css'
import './property/property.css'
import './preprocess/preprocess.css'

defineOptions({ name: 'PreprocessDialog' })
// focus = { which: 'target' | 'hiding:<자리>', n } — 저장 창의 창 조건 검사 줄이 준다. 받으면 그 조건을 고른다.
const props = defineProps({ modelValue: Boolean, focus: { type: Object, default: null } })
const emit = defineEmits(['update:modelValue'])
const store = useEditorStore()
const edit = useEditStore()

const stored = computed(() => edit.session?.working?.header?.windows ?? null)
// 창 조건을 모르는 세션(원본이 지워진 옛 초안)은 고칠 수 없다 — 서버가 저장값을 그대로 쓴다
const unknown = computed(() => !stored.value)
const readOnly = computed(() => !edit.editable || unknown.value)
const sop = computed(() => store.links?.preprocessingSop || null)
const COORD_LABELS = ['SEW_PP_LEFT', 'SEW_PP_TOP', 'SEW_PP_RIGHT', 'SEW_PP_BOTTOM']

// 입력 칸 값(좌표는 글자) ↔ 창 조건 값
const formOf = (w) => ({ text: w.text, className: w.className, checkRect: w.checkRect, coords: [w.left, w.top, w.right, w.bottom].map(String) })
const valueOf = (f) => {
  const [left, top, right, bottom] = f.coords.map((c) => parseCoord(c) ?? 0)
  return { text: f.text, className: f.className, checkRect: f.checkRect, left, top, right, bottom }
}
// 위치 확인을 끄면 좌표 칸에 -18 을 넣고 잠근다(사내와 같다). 켜면 값은 그대로다.
function setFormCheck(form, on) {
  form.checkRect = on
  if (!on) form.coords = Array(4).fill(String(UNCHECKED))
}

const base = shallowRef(blankWindows()) // 창을 열 때의 값
const target = reactive(formOf(blankWindow()))
const hiding = ref([]) // 줄 = 창 조건 + origin (+ isNew: 이 창에서 넣은 줄)
const sel = ref(-1)
const moreOpen = ref(false)
const editing = ref(-1)
const editForm = reactive(formOf(blankWindow()))
const editError = ref('')
const adding = ref(false)
const addForm = reactive(formOf(blankWindow()))
const addError = ref('')
const leaving = ref(false)

function reset() {
  base.value = normalizeWindows(stored.value ?? blankWindows())
  Object.assign(target, formOf(base.value.target))
  hiding.value = base.value.hiding.map((h) => ({ ...h }))
  sel.value = -1
  editing.value = -1
  adding.value = false
  editError.value = ''
  addError.value = ''
  leaving.value = false
  moreOpen.value = false
}

// ── 대상 창 ──
const targetLive = computed(() => targetState(target))
const targetText = computed(() => {
  const s = targetLive.value
  if (s.level === 'none') return t('SEW_PP_TARGET_NONE')
  if (s.level === 'warn') return t('SEW_PP_TARGET_WARN', { reason: t(`SEW_UI_TW_REASON_${s.reasonCode}`) })
  const tx = target.text.trim()
  return t(`SEW_PP_TARGET_OK_${s.matchMode}`, { text: s.matchMode === 'partial' ? tx.slice(0, -1) : tx })
})
const targetErrors = computed(() => windowErrors(target, { hiding: false }))
// 고치지 않았으면 연 때의 값 그대로, 고쳤으면 앞뒤 공백을 지운 값
const targetValue = computed(() => { const v = valueOf(target); return sameWindow(v, base.value.target) ? base.value.target : cleanWindow(v) })
// 저장값이 사내 편집기에서는 "설정" 으로 보이지만 에이전트는 찾지 않는다(P1 알림 TARGET_WINDOW_DIFFERS) — 고치지 않은 동안만 알린다
const differs = computed(() => {
  const tw = store.skeleton?.header?.targetWindow
  return !!tw && tw.agentFinds !== tw.inHouseShowsSet && !changes.value.target
})

// ── 숨길 창 ──
const full = computed(() => hiding.value.length >= HIDING_LIMIT)
const busy = computed(() => adding.value || editing.value >= 0)
const stateOf = (h) => { const s = hidingState(h); return { level: s.level, text: t(`SEW_PP_STATE_${s.code}`) } }
const rectText = (h) => (h.checkRect ? [h.left, h.top, h.right, h.bottom].join(', ') : '—')

// 줄 입력 검사: 클래스 필수·좌표 정수·같은 조건 없음. 통과하면 앞뒤 공백을 지운 값을 준다.
function checked(form, skip) {
  const errs = windowErrors(form, { hiding: true })
  if (errs.className) return { error: t(errs.className) }
  if (errs.coords) return { error: t(errs.coords) }
  const value = cleanWindow(valueOf(form))
  if (hiding.value.some((h, i) => i !== skip && sameCondition(h, value))) return { error: t('SEW_PP_ERR_SAME') }
  return { value }
}
function startAdd() {
  if (readOnly.value || full.value) return
  editing.value = -1
  Object.assign(addForm, formOf({ ...blankWindow(), left: UNCHECKED, top: UNCHECKED, right: UNCHECKED, bottom: UNCHECKED }))
  addError.value = ''
  adding.value = true
}
function confirmAdd() {
  const r = checked(addForm, -1)
  if (r.error) { addError.value = r.error; return }
  hiding.value = [...hiding.value, { origin: null, ...r.value, isNew: true }]
  adding.value = false
  addError.value = ''
}
function startEdit(i) {
  if (readOnly.value) return
  adding.value = false
  Object.assign(editForm, formOf(hiding.value[i]))
  editError.value = ''
  editing.value = i
  sel.value = -1
}
function confirmEdit() {
  const i = editing.value
  const r = checked(editForm, i)
  if (r.error) { editError.value = r.error; return }
  hiding.value = hiding.value.map((h, k) => (k === i ? { ...h, ...r.value } : h))
  editing.value = -1
  editError.value = ''
}
function removeRow(i) {
  if (readOnly.value) return
  hiding.value = hiding.value.filter((_, k) => k !== i)
  sel.value = -1
  editing.value = -1
}
function toggleSel(i) {
  if (editing.value >= 0) return
  sel.value = sel.value === i ? -1 : i
}
function copy() {
  const n = edit.copyWindows(sel.value >= 0 ? [hiding.value[sel.value]] : hiding.value)
  if (n) edit.notify(t('SEW_PP_COPIED', { n }))
}
function paste() {
  if (readOnly.value || full.value || !edit.windowClip.length) return
  const before = hiding.value.length
  const r = pasteHiding(hiding.value, edit.windowClip)
  hiding.value = r.list.map((h, i) => (i >= before ? { ...h, isNew: true } : h))
  edit.notify([
    r.added ? t('SEW_PP_PASTED', { n: r.added }) : '',
    r.same ? t('SEW_PP_PASTED_SAME', { n: r.same }) : '',
    r.over ? t('SEW_PP_PASTED_OVER', { n: r.over, limit: HIDING_LIMIT }) : ''
  ].filter(Boolean).join(' '))
}

// ── 적용·닫기 ──
const draft = computed(() => ({ target: targetValue.value, hiding: hiding.value }))
const changes = computed(() => windowChanges(draft.value, base.value, { byOrigin: true }))
const changed = computed(() => !!(changes.value.target || changes.value.hiding))
const canApply = computed(() => !readOnly.value && changed.value && !targetErrors.value.coords && !busy.value)
const footText = computed(() => (busy.value ? t('SEW_PP_FOOT_EDITING') : changed.value ? t('SEW_PP_FOOT_CHANGED') : t('SEW_PP_FOOT_SAME')))
function apply() {
  if (!canApply.value || !edit.applyWindows(draft.value)) return
  edit.notify(t('SEW_PP_APPLIED'))
  emit('update:modelValue', false)
}
// 닫기: 바꾼 것(넣던 줄·고치던 줄 포함)이 있으면 묻는다. ✕·바깥 누르기·[취소] 같은 길. 묻는 동안 Esc 는 [계속 고치기].
const keepEl = ref(null)
function requestClose() {
  if (readOnly.value || (!changed.value && !busy.value)) { emit('update:modelValue', false); return }
  leaving.value = true
  nextTick(() => keepEl.value?.focus())
}
function leaveKeep() { leaving.value = false }
function leaveDrop() { leaving.value = false; emit('update:modelValue', false) }
const onLeaveKey = (e) => { if (e.key === 'Escape') leaveKeep() }
watch(leaving, (on) => (on ? document.addEventListener('keydown', onLeaveKey) : document.removeEventListener('keydown', onLeaveKey)))
onBeforeUnmount(() => document.removeEventListener('keydown', onLeaveKey))

// 저장 창의 검사 줄에서 왔으면 그 조건으로: 대상 창이면 제목 칸에 초점, 숨길 창이면 그 줄을 고른다
const rootEl = ref(null)
async function goFocus(which) {
  if (typeof which !== 'string') return
  await nextTick()
  if (which === 'target') { rootEl.value?.querySelector('[data-testid="se-pp-target-text"]')?.focus(); return }
  const m = /^hiding:(\d+)$/.exec(which)
  if (!m || Number(m[1]) >= hiding.value.length) return
  sel.value = Number(m[1])
  await nextTick()
  const el = rootEl.value?.querySelector(`tr[data-row="${sel.value}"]`)
  if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' })
}
// 열 때마다 작업본 값에서 새로 시작한다
watch(() => props.modelValue, (open) => {
  reset()
  if (open && props.focus?.which) goFocus(props.focus.which)
}, { immediate: true })
watch(() => props.focus, (f) => { if (props.modelValue && f?.which) goFocus(f.which) })
</script>

<template>
  <ModalShell :model-value="modelValue" :title="t('SEW_PP_TITLE')" :width="900" :height="720" testid="se-pp-dialog" @update:model-value="(v) => (v ? emit('update:modelValue', true) : requestClose())">
    <div ref="rootEl" class="se-pp se-pw relative h-full flex flex-col">
      <div class="se-pp-sub">
        <span class="se-pp-id">{{ store.skeleton?.id }}</span>
        <span class="se-pp-grow" />
        <a v-if="sop" :href="sop" target="_blank" rel="noopener noreferrer" class="se-pw-link" data-testid="se-pp-sop">{{ t('SEW_PP_SOP') }} ↗</a>
      </div>
      <div v-if="readOnly" class="se-pw-ro" data-testid="se-pp-readonly">{{ unknown ? t('SEW_PP_BAR_UNKNOWN') : t('SEW_PP_READONLY') }}</div>
      <div class="se-pp-body">
        <section class="se-pw-sec">
          <h4>{{ t('SEW_PP_TARGET') }}</h4>
          <p class="se-pw-hint">{{ t('SEW_PP_TARGET_HINT') }}</p>
          <div class="se-pw-grid2">
            <label class="se-pw-f"><span>{{ t('SEW_PP_TEXT') }}</span>
              <input v-model="target.text" class="se-inp" :disabled="readOnly" spellcheck="false" data-testid="se-pp-target-text" /></label>
            <label class="se-pw-f"><span>{{ t('SEW_PP_CLASS') }}</span>
              <input v-model="target.className" class="se-inp se-pw-mono" :disabled="readOnly" spellcheck="false" data-testid="se-pp-target-class" /></label>
          </div>
          <div class="se-pw-state" :class="targetLive.level" :data-level="targetLive.level" data-testid="se-pp-target-state">{{ targetText }}</div>
          <div v-if="differs" class="se-pw-note" data-testid="se-pp-target-differs">{{ t('SEW_PP_TARGET_DIFFERS') }}</div>
          <details class="se-pw-more" :open="moreOpen" data-testid="se-pp-target-more" @toggle="moreOpen = $event.target.open">
            <summary>{{ t('SEW_PP_RECT_MORE') }}</summary>
            <div class="se-pw-rect">
              <label><input type="checkbox" :checked="target.checkRect" :disabled="readOnly" data-testid="se-pp-target-check" @change="setFormCheck(target, $event.target.checked)" /> {{ t('SEW_PP_RECT_CHECK') }}</label>
              <template v-for="(k, i) in COORD_LABELS" :key="k">
                <span>{{ t(k) }}</span>
                <input v-model="target.coords[i]" class="se-inp se-pw-num" inputmode="numeric" :disabled="readOnly || !target.checkRect" :data-testid="`se-pp-target-coord-${i}`" />
              </template>
            </div>
            <div v-if="targetErrors.coords" class="se-pw-err" data-testid="se-pp-target-error">{{ t(targetErrors.coords) }}</div>
          </details>
        </section>

        <section class="se-pw-sec">
          <h4>{{ t('SEW_PP_HIDING') }} <span class="se-pw-cnt" data-testid="se-pp-count">{{ t('SEW_PP_HIDING_COUNT', { n: hiding.length, limit: HIDING_LIMIT }) }}</span></h4>
          <p class="se-pw-hint">{{ t('SEW_PP_HIDING_HINT') }}</p>
          <div v-if="!readOnly" class="se-pw-tools">
            <button type="button" class="se-pp-btn sm" :disabled="full" data-testid="se-pp-add" @click="startAdd">{{ t('SEW_PP_ADD') }}</button>
            <span class="se-pp-grow" />
            <button type="button" class="se-pp-btn sm" :disabled="!hiding.length" data-testid="se-pp-copy" @click="copy">{{ sel >= 0 ? t('SEW_PP_COPY_SEL') : t('SEW_PP_COPY_ALL') }}</button>
            <button type="button" class="se-pp-btn sm" :disabled="full || !edit.windowClip.length" data-testid="se-pp-paste" @click="paste">{{ edit.windowClip.length ? t('SEW_PP_PASTE_N', { n: edit.windowClip.length }) : t('SEW_PP_PASTE') }}</button>
          </div>
          <div v-if="adding" class="se-pw-add">
            <div class="se-pw-grid2">
              <label class="se-pw-f"><span>{{ t('SEW_PP_ADD_TEXT') }}</span><input v-model="addForm.text" class="se-inp" spellcheck="false" data-testid="se-pp-add-text" /></label>
              <label class="se-pw-f"><span>{{ t('SEW_PP_ADD_CLASS') }}</span><input v-model="addForm.className" class="se-inp se-pw-mono" spellcheck="false" data-testid="se-pp-add-class" /></label>
            </div>
            <div class="se-pw-rect">
              <label><input type="checkbox" :checked="addForm.checkRect" data-testid="se-pp-add-check" @change="setFormCheck(addForm, $event.target.checked)" /> {{ t('SEW_PP_RECT_CHECK_HIDING') }}</label>
              <template v-for="(k, i) in COORD_LABELS" :key="k">
                <span>{{ t(k) }}</span>
                <input v-model="addForm.coords[i]" class="se-inp se-pw-num" inputmode="numeric" :disabled="!addForm.checkRect" :data-testid="`se-pp-add-coord-${i}`" />
              </template>
              <span class="se-pp-grow" />
              <button type="button" class="se-pp-btn sm p" data-testid="se-pp-add-ok" @click="confirmAdd">{{ t('SEW_PP_ADD_OK') }}</button>
              <button type="button" class="se-pp-btn sm" data-testid="se-pp-add-cancel" @click="adding = false">{{ t('SEW_PP_CANCEL') }}</button>
            </div>
            <div v-if="addError" class="se-pw-err" data-testid="se-pp-add-error">{{ addError }}</div>
          </div>
          <table v-if="hiding.length" class="se-pw-table">
            <thead><tr>
              <th class="no">{{ t('SEW_PP_COL_NO') }}</th><th>{{ t('SEW_PP_TEXT') }}</th><th>{{ t('SEW_PP_CLASS') }}</th><th>{{ t('SEW_PP_COL_RECT') }}</th><th>{{ t('SEW_PP_COL_STATE') }}</th><th v-if="!readOnly" class="act" />
            </tr></thead>
            <tbody>
              <template v-for="(h, i) in hiding" :key="i">
                <tr v-if="i === editing" class="ed" :data-row="i">
                  <td class="no">{{ i + 1 }}</td>
                  <td><input v-model="editForm.text" class="se-inp" spellcheck="false" :placeholder="t('SEW_PP_ANY_TITLE')" data-testid="se-pp-edit-text" /></td>
                  <td><input v-model="editForm.className" class="se-inp se-pw-mono" spellcheck="false" data-testid="se-pp-edit-class" /></td>
                  <td colspan="2">
                    <div class="se-pw-rect tight">
                      <label :title="t('SEW_PP_RECT_CHECK_HIDING')"><input type="checkbox" :checked="editForm.checkRect" data-testid="se-pp-edit-check" @change="setFormCheck(editForm, $event.target.checked)" /> {{ t('SEW_PP_RECT_CHECK') }}</label>
                      <input v-for="(k, n) in COORD_LABELS" :key="k" v-model="editForm.coords[n]" class="se-inp se-pw-num" inputmode="numeric" :aria-label="t(k)" :disabled="!editForm.checkRect" :data-testid="`se-pp-edit-coord-${n}`" />
                    </div>
                    <div v-if="editError" class="se-pw-err" data-testid="se-pp-edit-error">{{ editError }}</div>
                  </td>
                  <td class="act">
                    <button type="button" class="se-pp-btn sm p" data-testid="se-pp-edit-ok" @click="confirmEdit">{{ t('SEW_PP_EDIT_OK') }}</button>
                    <button type="button" class="se-pp-btn sm" data-testid="se-pp-edit-cancel" @click="editing = -1">{{ t('SEW_PP_CANCEL') }}</button>
                  </td>
                </tr>
                <tr v-else :class="{ sel: i === sel }" :data-row="i" @click="toggleSel(i)">
                  <td class="no">{{ i + 1 }}</td>
                  <td><template v-if="h.text.trim()">{{ h.text }}</template><span v-else class="faint">{{ t('SEW_PP_ANY_TITLE') }}</span> <span v-if="h.isNew" class="se-pw-pill new">{{ t('SEW_PP_NEW') }}</span></td>
                  <td class="se-pw-mono"><template v-if="h.className">{{ h.className }}</template><span v-else class="bad">{{ t('SEW_PP_NO_CLASS') }}</span></td>
                  <td class="se-pw-mono nowrap">{{ rectText(h) }}</td>
                  <td class="nowrap"><span class="se-pw-pill" :class="stateOf(h).level" data-testid="se-pp-row-state">{{ stateOf(h).text }}</span></td>
                  <td v-if="!readOnly" class="act">
                    <button type="button" class="se-pw-x" data-testid="se-pp-row-edit" @click.stop="startEdit(i)">{{ t('SEW_PP_EDIT') }}</button>
                    <button type="button" class="se-pw-x del" data-testid="se-pp-row-delete" @click.stop="removeRow(i)">{{ t('SEW_PP_DELETE') }}</button>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
          <div v-else class="se-pw-empty" data-testid="se-pp-empty">{{ t('SEW_PP_EMPTY') }}</div>
          <div v-if="full && !readOnly" class="se-pw-note" data-testid="se-pp-limit">{{ t('SEW_PP_LIMIT', { limit: HIDING_LIMIT }) }}</div>
        </section>
      </div>
      <div class="se-pp-foot">
        <template v-if="readOnly">
          <span class="se-pp-grow" />
          <button type="button" class="se-pp-btn" data-testid="se-pp-close" @click="emit('update:modelValue', false)">{{ t('SEW_PP_CLOSE') }}</button>
        </template>
        <template v-else>
          <div class="se-pp-foot-text se-pw-foot" data-testid="se-pp-foot">{{ footText }}</div>
          <button type="button" class="se-pp-btn" data-testid="se-pp-cancel" @click="requestClose">{{ t('SEW_PP_CANCEL') }}</button>
          <button type="button" class="se-pp-btn p" :disabled="!canApply" data-testid="se-pp-apply" @click="apply">{{ t('SEW_PP_APPLY') }}</button>
        </template>
      </div>
      <div v-if="leaving" class="se-pp-cf-dim" data-testid="se-pp-leave">
        <div class="se-pp-cf" role="alertdialog" aria-modal="true" aria-labelledby="se-pw-leave-t">
          <h3 id="se-pw-leave-t">{{ t('SEW_PP_DISCARD') }}</h3>
          <div class="se-pp-cf-f">
            <button ref="keepEl" type="button" class="se-pp-btn p" data-testid="se-pp-leave-keep" @click="leaveKeep">{{ t('SEW_PP_DISCARD_NO') }}</button>
            <button type="button" class="se-pp-btn danger" data-testid="se-pp-leave-drop" @click="leaveDrop">{{ t('SEW_PP_DISCARD_YES') }}</button>
          </div>
        </div>
      </div>
    </div>
  </ModalShell>
</template>

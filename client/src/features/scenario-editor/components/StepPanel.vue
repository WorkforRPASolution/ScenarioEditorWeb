<script setup>
// 오른쪽 편집 패널(목업 renderPanel·footHtml, 조작판 1·2·8·9·17): 머리(번호·설명·위아래)·읽어 주는 문장·설명 칸·안내 줄,
// 실행 순서 레일(보는 곳 → 찾는 것 → 찾으면 하는 일 → 갈 곳)·선택, 아래 적용 줄([되돌리기]·[적용]). 쓸 수 있는 세션에서만 보인다.
// 값은 [적용]을 눌러야 작업본(표)에 들어간다. 다른 줄로 가는 길은 editStore.guard 가 먼저 묻는다.
import { ref, computed, watch, nextTick } from 'vue'
import { useEditorStore } from '../stores/editorStore'
import { useEditStore } from '../stores/editStore'
import { refUrl } from '../editor/images'
import { CAN_FAIL, CLICK_TYPES, PRESERVE_ONLY, PANEL_OWN_CODES, changedFields, diffLines, errorFields, firstError, sentence, trainMapDropped, keyboardTokensDropped } from '../editor/panel'
import { typeNameOf } from '../editor/display'
import { t, noteMessage } from '../messages'
import FieldError from './panel/FieldError.vue'
import LookStation from './panel/LookStation.vue'
import FindStation from './panel/FindStation.vue'
import ActionStation from './panel/ActionStation.vue'
import FlowStation from './panel/FlowStation.vue'
import OptionStation from './panel/OptionStation.vue'
import './panel/panel.css'

defineOptions({ name: 'StepPanel' })
const store = useEditorStore()
const edit = useEditStore()
const root = ref(null)

const p = computed(() => edit.panel)
const d = computed(() => p.value.draft)
const working = computed(() => edit.session?.working ?? null)
const steps = computed(() => working.value?.steps ?? [])
const idx = computed(() => (p.value.isNew || !d.value ? -1 : steps.value.findIndex((s) => s.uid === d.value.uid)))
const no = computed(() => (p.value.isNew ? '+' : idx.value + 1))
const kind = computed(() => d.value?.condition?.kind)
const type = computed(() => d.value?.action?.type)
const errs = computed(() => (d.value ? edit.panelErrors() : {}))
const changed = computed(() => changedFields(p.value.base, d.value))
const bad = computed(() => errorFields(errs.value))
const firstBad = computed(() => firstError(errs.value))
const diffs = computed(() => (d.value && p.value.base ? diffLines(p.value.base, d.value, working.value) : []))
const say = computed(() => (d.value ? sentence(d.value, working.value, p.value.isNew) : ''))

// 표시 스텝(뼈대 모양: 서버 알림·raw)과 뼈대 스텝(저장된 값 — R-T6a 안내)
const shownStep = computed(() => (store.selectedStep?.uid === d.value?.uid ? store.selectedStep : null))
const skStep = computed(() => (store.skeleton?.steps ?? []).find((s) => s.uid === d.value?.uid) ?? null)

const ctx = computed(() => ({ session: edit.session, uploads: edit.uploads, draftId: edit.draftId ?? null }))
const isRef = (r) => !!r && typeof r === 'object' && 'from' in r
const baseSrc = computed(() => (isRef(d.value?.images?.base) ? refUrl(d.value.images.base, ctx.value) : null))
const trainPics = computed(() => {
  const train = d.value?.images?.train ?? {}
  return Object.keys(train).sort((a, b) => Number(a) - Number(b))
    .map((key) => ({ key, src: isRef(train[key]) ? refUrl(train[key], ctx.value) : null })).filter((x) => x.src)
})
const clickOutside = ref(false)
watch(() => d.value?.uid, () => { clickOutside.value = false })

// 안내 줄(목업 rowNotesFor + R-T6a): 옛 값·보존 전용·실패 쪽 NEXT·고치면 빠지는 저장 값. 안내는 [적용]을 막지 않는다.
const keyDropped = computed(() => type.value === 5 && keyboardTokensDropped(skStep.value))
const notices = computed(() => {
  if (!d.value || p.value.isNew) return []
  const out = []
  const a = errs.value.action
  if (PRESERVE_ONLY.has(type.value) || typeNameOf(type.value) === null) out.push({ id: 'locked', info: true, text: t('SEW_PANEL_NOTE_LOCKED') })
  if (a?.level === 'notice' && a.code === 'OCR_MOUSE_CLICK') out.push({ id: 'ocr-click', text: t('SEW_PANEL_NOTE_OCR_CLICK') })
  if (a?.level === 'notice' && a.code === 'NONE_MOUSE_CLICK') out.push({ id: 'none-click', text: t('SEW_PANEL_NOTE_NONE_CLICK') })
  if (d.value.next?.onFalse?.kind === 'next' && CAN_FAIL.has(type.value)) out.push({ id: 'false-next', text: t('SEW_EDIT_PICK_NEXT_WARN') })
  if (kind.value === 'image' && trainMapDropped(skStep.value)) out.push({ id: 'train-dropped', text: t('SEW_PANEL_NOTE_TRAIN_DROPPED') })
  if (keyDropped.value) out.push({ id: 'key-dropped', text: t('SEW_PANEL_NOTE_KEY_DROPPED') })
  return out
})
// 서버 알림(닿지 않는 스텝·기준 화면 없음·해석 실패 등). 패널이 칸 오류·안내로 직접 보이는 code 는 뺀다.
const serverNotes = computed(() => (shownStep.value?.notes ?? []).filter((n) => !PANEL_OWN_CODES.has(n.code)
  && !(keyDropped.value && n.code === 'PARSE_FAILED' && n.params?.field === 'keyboard')))

const setDesc = (v) => edit.updateDraft((s) => ({ ...s, descriptionToEmail: v }))
const go = (delta) => { const s = steps.value[idx.value + delta]; if (s) edit.requestSelect(s.uid) }

// 칸 초점: [적용]·[적용하고 이동]이 오류로 막히면 editStore 가 첫 오류 칸을 요청한다.
async function focusField(field) {
  await nextTick()
  const el = root.value?.querySelector(`[data-field="${field}"]`)
  if (!el) return
  el.focus?.()
  el.scrollIntoView?.({ block: 'nearest' })
}
watch(() => edit.focusReq, (r) => { if (r) focusField(r.field) })
const apply = () => edit.applyPanel()

const head = 'shrink-0 px-3 pt-2.5 pb-2 border-b border-gray-200 dark:border-dark-border'
const navBtn = 'w-6 h-6 rounded-md inline-flex items-center justify-center text-gray-500 hover:enabled:bg-gray-100 dark:hover:enabled:bg-gray-700 disabled:opacity-35'
const btnS = 'h-8 px-3 rounded-lg text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600'
</script>

<template>
  <div ref="root" class="h-full flex flex-col min-h-0 text-sm text-gray-800 dark:text-gray-100" data-testid="se-detail" data-panel="edit">
    <div v-if="!d" class="h-full flex items-center justify-center text-gray-400 px-6 text-center">{{ steps.length ? t('SEW_PANEL_EMPTY') : t('SEW_PANEL_EMPTY_NO_STEPS') }}</div>
    <template v-else>
      <div :class="head">
        <div class="flex items-center gap-2">
          <span class="w-6 h-6 rounded-md text-white text-xs font-bold flex items-center justify-center shrink-0" :class="p.isNew ? 'bg-green-500 text-sm' : 'bg-primary-500'">{{ no }}</span>
          <b class="flex-1 min-w-0 truncate font-semibold text-[13px] text-gray-900 dark:text-white">{{ d.descriptionToEmail || t('SEW_PANEL_NO_DESC') }}</b>
          <div v-if="!p.isNew" class="flex gap-0.5 shrink-0">
            <button type="button" :class="navBtn" data-testid="se-panel-prev" :disabled="idx <= 0" :aria-label="t('SEW_PANEL_PREV')" @click="go(-1)">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 8l4-4 4 4" /></svg>
            </button>
            <button type="button" :class="navBtn" data-testid="se-panel-next" :disabled="idx >= steps.length - 1" :aria-label="t('SEW_PANEL_NEXT')" @click="go(1)">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 4l4 4 4-4" /></svg>
            </button>
          </div>
        </div>
        <p class="mt-1.5 text-xs leading-normal text-gray-500 dark:text-gray-400" data-testid="se-panel-say">{{ say }}</p>
      </div>

      <div class="flex-1 min-h-0 overflow-auto px-3 pt-2.5 pb-3.5">
        <div class="flex justify-between gap-2 mb-0.5 text-xs text-gray-500 dark:text-gray-400">
          <span>{{ t('SEW_PANEL_DESC') }}</span>
          <em class="not-italic text-gray-400 truncate">{{ t('SEW_PANEL_DESC_MAIL', { n: p.isNew ? steps.length + 1 : no, desc: d.descriptionToEmail || '…' }) }}</em>
        </div>
        <input class="se-inp" :class="{ 'se-inp-bad': errs.desc?.level === 'error', 'se-inp-ch': errs.desc?.level !== 'error' && changed.includes('desc') }" data-field="desc"
          :value="d.descriptionToEmail ?? ''" :placeholder="t('SEW_PANEL_DESC_PH')" :aria-label="t('SEW_PANEL_DESC_LABEL')" @input="setDesc($event.target.value)">
        <FieldError :errs="errs" field="desc" />

        <div v-if="notices.length || serverNotes.length" class="mt-2.5 space-y-1.5" data-testid="se-panel-notes">
          <div v-for="n in notices" :key="n.id" :data-note="n.id" class="rounded-lg border px-2.5 py-1.5 text-xs leading-snug"
            :class="n.info ? 'border-primary-300 bg-primary-50 text-primary-800 dark:bg-primary-900/20 dark:border-primary-700 dark:text-primary-200' : 'border-amber-400 bg-amber-50 text-amber-900 dark:bg-amber-900/20 dark:border-amber-700 dark:text-amber-200'">{{ n.text }}</div>
          <div v-for="(n, i) in serverNotes" :key="`${n.code}-${i}`" data-note="server" class="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700 px-2.5 py-1.5 text-xs text-amber-900 dark:text-amber-200">
            {{ n.level === 'warning' ? '⚠' : 'ⓘ' }} {{ noteMessage(n) }}
          </div>
        </div>

        <div class="se-rail">
          <LookStation v-if="kind === 'image' || kind === 'ocr'" :draft="d" :errs="errs" :changed="changed" :base-src="baseSrc" />
          <FindStation :draft="d" :errs="errs" :changed="changed" :train-pics="trainPics" @outside="clickOutside = $event" />
          <ActionStation :draft="d" :errs="errs" :changed="changed" :click-outside="clickOutside && CLICK_TYPES.includes(type)" />
          <FlowStation :draft="d" :errs="errs" :changed="changed" :is-new="p.isNew" />
        </div>
        <OptionStation :draft="d" :shown-step="shownStep" :changed="changed" />
      </div>

      <div v-if="!p.isNew && changed.length" class="shrink-0 border-t border-gray-200 dark:border-dark-border bg-gray-50 dark:bg-dark-bg px-3 py-2" data-testid="se-panel-foot">
        <div v-if="bad.length" class="mb-1.5 text-xs leading-normal text-red-700 dark:text-red-300">
          <button type="button" class="underline font-medium" data-testid="se-panel-firsterr" @click="edit.requestFocus(firstBad)">{{ t('SEW_PANEL_FIX_N', { n: bad.length }) }}</button>
          — {{ t(`RULE_${errs[firstBad].code}`, errs[firstBad].params) }}
        </div>
        <div v-else class="mb-1.5 max-h-[62px] overflow-auto text-xs leading-normal text-gray-700 dark:text-gray-200">
          <div v-for="l in diffs" :key="l.field"><b class="font-medium text-gray-500 dark:text-gray-400">{{ l.label }}</b> {{ l.before }}<template v-if="l.before || l.after"> → </template>{{ l.after }}</div>
        </div>
        <div class="flex items-center gap-1.5">
          <span class="text-xs text-gray-500 dark:text-gray-400">{{ t('SEW_PANEL_CHANGED_N', { n: changed.length }) }}</span>
          <span class="flex-1" />
          <button type="button" :class="btnS" data-testid="se-panel-revert" @click="edit.discardPanel()">{{ t('SEW_PANEL_REVERT') }}</button>
          <button type="button" data-testid="se-panel-apply" :data-blocked="bad.length ? 'true' : null" :title="bad.length ? t('SEW_EDIT_GUARD_BLOCKED') : undefined"
            class="h-8 px-3 rounded-lg text-sm font-medium text-white" :class="bad.length ? 'bg-primary-300 dark:bg-primary-800 cursor-not-allowed' : 'bg-primary-500 hover:bg-primary-600'" @click="apply">{{ t('SEW_PANEL_APPLY') }}</button>
        </div>
      </div>
    </template>
  </div>
</template>

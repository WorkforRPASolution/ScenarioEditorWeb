<script setup>
// 큰 화면: 고른 스텝의 기준 화면과 검색(OCR) 영역, 휠 확대·끌어 이동(P1).
// 쓸 수 있는 세션은 패널 초안(고른 스텝의 초안 또는 아직 표에 없는 새 스텝)을 그리고, 그 위의 잡기 층(CaptureLayer)이
// 영역 끌기·손잡이·끌어 잡기·누를 곳 찍기를 맡는다. 잡기 중에는 머리에 단계 띠와 [취소], 아래에 안내 줄(목업 renderViewer).
// 잡기 밖에서는 기준 화면에서 찾은 찾을 그림 자리와 누를 곳을 늘 그린다(SpotLayer — 한 곳 찾았을 때만, 읽기 전용에서도).
// 찾을 그림 자리는 이미지 스텝이면 동작과 상관없이, 누를 곳 + 는 마우스 클릭일 때만 그린다.
// [누를 곳 보기](패널·상세의 작은 버튼 → editStore.clickShow)를 누르면 그 누를 곳에 스냅샷 클릭 점과 같은 점(ClickDot)을 CLICK_SHOW_MS 동안 깜빡인다.
import { SECONDARY } from './buttonStyle'
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useEditorStore } from '../stores/editorStore'
import { useEditStore } from '../stores/editStore'
import { useSnapshotStore } from '../stores/snapshotStore'
import { useVisionTestStore } from '../stores/visionTestStore'
import { imageSrc } from '../editor/display'
import { refUrl } from '../editor/images'
import { areaView, isRect, isRef } from '../editor/capture'
import { hitsOf } from '../editor/visionTest'
import { CLICK_SHOW_MS } from '../editor/trainView'
import { t } from '../messages'
import { safeStorage } from '../composables/useSafeStorage'
import { useTrainSpot } from '../composables/useTrainSpot'
import { usePanZoom } from '../composables/usePanZoom'
import CaptureLayer from './CaptureLayer.vue'
import SpotLayer from './SpotLayer.vue'
import TestLayer from './TestLayer.vue'
import ClickDot from './ClickDot.vue'
import './capture.css'

defineOptions({ name: 'StepViewer' })
const store = useEditorStore()
const edit = useEditStore()
const step = computed(() => store.selectedStep)
// 고치는 중인 값(쓸 수 있는 세션만): 새 스텝 초안, 또는 보는 스텝과 같은 uid 의 패널 초안
const isNew = computed(() => edit.editable && edit.panel.isNew && !!edit.panel.draft)
const draft = computed(() => {
  const p = edit.panel
  if (!edit.editable || !p.draft) return null
  if (p.isNew) return p.draft
  return step.value && p.uid === step.value.uid ? p.draft : null
})
const shown = computed(() => isNew.value || !!step.value)
const kind = computed(() => (draft.value ?? step.value)?.condition?.kind)
const newSrc = computed(() => {
  const b = isNew.value ? edit.panel.draft.images?.base : null
  return isRef(b) ? refUrl(b, { session: edit.session, uploads: edit.uploads, draftId: edit.draftId }) : null
})
const baseState = computed(() => {
  if (!isNew.value) return step.value?.baseImage.state
  return kind.value === 'image' || kind.value === 'ocr' ? (newSrc.value ? 'present' : 'missing') : 'notNeeded'
})
const src = computed(() => {
  if (isNew.value) return newSrc.value
  return step.value?.baseImage.state === 'present' ? imageSrc(step.value.baseImage) : null
})
// 다른 시나리오 판의 그림(붙여 온 스텝, 그 기준 화면으로 시작한 새 스텝) — 불러오지 못하면 그 판을 찾지 못했다고 알린다(배포는 서버가 IMAGE_SOURCE_GONE 으로 막는다)
const srcOther = computed(() => (isNew.value ? edit.panel.draft.images?.base?.from === 'other' : !!step.value?.baseImage?.other))
// 쓸 수 있는 세션의 스텝이 하나도 없을 때(목업 조작판 20 empty)
const noSteps = computed(() => edit.editable && !store.steps.length)
const editLayer = computed(() => !!draft.value && (kind.value === 'image' || kind.value === 'ocr'))
const cap = computed(() => (draft.value ? edit.capture : null))
const capNow = computed(() => (cap.value ? cap.value.flow.indexOf(cap.value.stage) : -1))
// 찾은 그림·누를 곳: 고치는 중이면 패널 초안(패널 썸네일과 같은 값), 아니면 보는 스텝. 잡는 동안은 잡기 층이 그린다.
const spot = useTrainSpot(() => (draft.value ? { draft: draft.value } : step.value ? { step: step.value } : null))
// Vision 시험 결과(P4)가 이 화면에 떠 있는 동안에는 평소의 찾은 그림 표시를 숨긴다 — 시험이 찾은 곳(TestLayer)과 겹친다
const vision = useVisionTestStore()
const testShown = computed(() => !cap.value && !!hitsOf(vision.run, 'step'))
const spotMarks = computed(() => (cap.value || testShown.value ? null : spot.marks.value))
const spotLabels = computed(() => (draft.value ? { train: t('SEW_CAP_TAG_FOUND'), click: t('SEW_CAP_TAG_CLICK') } : { train: t('SEW_UI_TAG_TRAIN'), click: t('SEW_UI_TAG_CLICK') }))
// [그림은 그대로 두기]: 고른 스텝의 영역을 다시 잡고 그림 단계에 왔을 때만(목업 cap:keep)
const canKeep = computed(() => cap.value?.stage === 'train' && cap.value.flow[0] !== 'train' && !isNew.value
  && Object.values(draft.value?.images?.train ?? {}).some(isRef))
const capHint = computed(() => {
  const c = cap.value
  if (!c) return ''
  const why = c.why && c.stage === 'train' ? `${c.why} ` : ''
  return why + (c.flow.length === 1 && c.stage === 'click' ? t('SEW_CAP_HINT_repick') : t(`SEW_CAP_HINT_${c.stage}`))
})
// 버전의 기준 화면 데이터 자체를 해석하지 못했으면(시나리오 경고 PARSE_FAILED bi) "저장되어 있지 않음" 이 아니라 그 사실을 알린다.
const biUnreadable = computed(() => (store.skeleton?.notes ?? []).some((n) => n.code === 'PARSE_FAILED' && n.params?.field === 'bi'))
const natural = ref(null)
const failed = ref(false)
const box = ref(null)
// 확대·이동은 스냅샷 보기와 함께 쓰는 usePanZoom 이 맡는다(맞춤·1:1·직접 움직인 뒤에는 다시 맞추지 않음·크기 관찰)
const { view, fit, actual, zoomButton, onWheel, onDown, setView } = usePanZoom(box, natural)
const HINT = 'se-hint-base-image'
const showHint = ref(safeStorage.get(HINT) !== '1')

watch(src, () => { natural.value = null; failed.value = false })
// 읽은 기준 화면의 크기를 편집 저장소에 알린다 — 패널에서 숫자로 넣은 검색 영역이 화면 밖인지 본다(그림이 바뀌거나 사라지면 비운다)
// 같은 그림을 쓰는 다른 스텝으로 가면 그림은 다시 읽지 않으므로 어느 스텝의 그림인지도 함께 본다.
const shownUid = computed(() => (isNew.value ? edit.panel.uid : step.value?.uid ?? null))
watch([natural, shownUid], ([n, uid]) => edit.setScreenSize(n ? { ...n, uid } : null), { flush: 'sync' })

function onLoad(e) { natural.value = { w: e.target.naturalWidth, h: e.target.naturalHeight }; fit() }
// Esc: 잡기 취소(잡기가 쓴 칸만 되돌린다). 목업 keydown 순서대로 확인 창·다음 스텝 고르기·펼침 메뉴가 먼저 받고,
// 입력 칸(글자 칸·고르기·내용 편집) 안의 Esc 는 그 칸 몫이라 듣지 않는다. 확인 창보다 먼저 판단하도록 capture 단계에서 듣는다.
// 창(ModalShell·메모 창·달력)과 스냅샷 쪽 펼침 메뉴가 열려 있을 때의 Esc 도 그쪽 몫이고, 큰 화면이 스냅샷 모드라 잡기가 보이지 않을 때는
// 듣지 않는다(P3-E 독립 검토 — 잡는 중에 스냅샷을 보러 갔다가 메뉴를 Esc 로 닫으면 잡은 영역·그림이 조용히 사라졌다).
const POPUPS = '[data-testid="se-picker"], [data-testid="se-tool-menu"], [data-testid="se-snap-new-menu"], [data-se-modal], [role="dialog"], [role="alertdialog"], .se-snap-menu'
const snap = useSnapshotStore()
function onEsc(e) {
  if (e.key !== 'Escape' || !edit.capture || edit.dialog || snap.mode === 'snapshot') return
  const el = e.target
  if (el?.tagName && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable || el.closest?.('[contenteditable=""], [contenteditable="true"]'))) return
  if (document.querySelector(POPUPS)) return
  edit.cancelCapture()
}
onMounted(() => document.addEventListener('keydown', onEsc, true))
onBeforeUnmount(() => { document.removeEventListener('keydown', onEsc, true); edit.setScreenSize(null) })
const area = computed(() => step.value?.condition.searchArea)
const adjustHint = computed(() => editLayer.value && !cap.value && isRect(draft.value?.condition?.searchArea))
// 패널 그림을 누르면 영역에 맞춰 확대·전체(목업 focusArea·viewAll), 잡기를 시작하면 전체(editStore.viewReq)
function focusArea(a) {
  const el = box.value
  if (!el || !natural.value || !(el.clientWidth > 0 && el.clientHeight > 0)) return
  setView(areaView(a, { w: el.clientWidth, h: el.clientHeight }, natural.value))
}
watch(() => edit.viewReq, (r) => {
  if (!r) return
  if (r.kind === 'all') fit()
  else if (r.kind === 'area' && isRect(draft.value?.condition?.searchArea)) focusArea(draft.value.condition.searchArea)
})
// ── [누를 곳 보기] ── 깜빡이는 동안의 자리는 지금의 찾은 자리 + 누를 곳이다(누를 곳을 고치면 따라간다). 시험 결과가 떠 있어 + 표시를 숨긴 동안에도 그린다
// (그동안 시험 결과의 누를 곳 점은 숨긴다 — 같은 자리의 점 둘이 엇박으로 깜빡인다).
// - 요청은 이 화면이 보이고 있는 스텝의 것만 받는다(패널 초안과 큰 화면의 스텝은 갈릴 수 있다). 요청이 비워지면(세션이 바뀜) 끝낸다.
// - 다시 누르면 처음부터 세고(점을 새로 그려 깜빡임도 처음부터), 다른 스텝으로 가거나 잡기를 시작하면 끝낸다.
// - 누를 곳이 보이는 곳 밖이면(확대·이동해 둠, 기준 화면 밖의 누를 곳) 배율은 둔 채 그 점을 상자 가운데로 옮긴다 — 확대해 보던 배율을 잃지 않는다.
//   상자가 숨겨져 있으면(스냅샷 모드·넓게 보기) 옮기지 않는다 — 다시 보일 때 화면이 전체로 맞춰진다(usePanZoom).
const flashing = ref(false)
let flashTimer = null
function stopFlash() { clearTimeout(flashTimer); flashTimer = null; flashing.value = false }
const flashAt = computed(() => (flashing.value && !cap.value ? spot.marks.value?.click ?? null : null))
const DOT_EDGE = 8 // 점(반지름 6px + 가는 테)이 상자 끝에 잘리지 않을 여유
function reveal(p) {
  const el = box.value
  const w = el?.clientWidth
  const h = el?.clientHeight
  if (!(w > 0 && h > 0)) return
  const sx = view.tx + p.x * view.scale
  const sy = view.ty + p.y * view.scale
  if (sx >= DOT_EDGE && sy >= DOT_EDGE && sx <= w - DOT_EDGE && sy <= h - DOT_EDGE) return
  setView({ scale: view.scale, tx: w / 2 - p.x * view.scale, ty: h / 2 - p.y * view.scale })
}
watch(() => edit.clickShow, (r) => {
  if (!r) { stopFlash(); return }
  const at = r.uid === shownUid.value && !cap.value ? spot.marks.value?.click : null
  if (!at) return
  clearTimeout(flashTimer)
  flashing.value = true
  flashTimer = setTimeout(stopFlash, CLICK_SHOW_MS)
  reveal(at)
})
watch([shownUid, () => !!cap.value], stopFlash)
onBeforeUnmount(stopFlash)
const areaValid = computed(() => !!area.value && ['x', 'y', 'w', 'h'].every((k) => Number.isFinite(area.value[k])))
const areaStyle = computed(() => areaValid.value && { left: `${area.value.x}px`, top: `${area.value.y}px`, width: `${area.value.w}px`, height: `${area.value.h}px`, borderWidth: `${2 / view.scale}px` })
const closeHint = () => { showHint.value = false; safeStorage.set(HINT, '1') }
defineExpose({ onLoad, fit })
</script>

<template>
  <div class="se-cap h-full flex flex-col" data-testid="se-viewer">
    <div class="h-10 px-3 flex items-center gap-2 border-b border-gray-200 dark:border-dark-border text-xs shrink-0">
      <template v-if="cap">
        <ol class="se-cap-steps" data-testid="se-cap-bar" :aria-label="t('SEW_CAP_STEPS')">
          <li v-for="(s, i) in cap.flow" :key="s" :data-cap-stage="s" :class="i === capNow ? 'now' : i < capNow ? 'done' : ''" :style="{ '--c': `var(--cap-${s})` }">
            <i>{{ i < capNow ? '✓' : i + 1 }}</i>{{ t(`SEW_CAP_STAGE_${s}`) }}
          </li>
        </ol>
        <span class="flex-1" />
        <button v-if="canKeep" type="button" class="h-7 px-2 rounded-lg whitespace-nowrap" :class="SECONDARY" data-testid="se-cap-keep" @click="edit.finishCapture()">{{ t('SEW_CAP_KEEP_TRAIN') }}</button>
        <button type="button" class="h-7 px-2 rounded-lg whitespace-nowrap" :class="SECONDARY" data-testid="se-cap-cancel" @click="edit.cancelCapture()">
          {{ t('SEW_CAP_CANCEL') }} <span class="text-gray-400">Esc</span>
        </button>
      </template>
      <template v-else>
        <!-- 큰 화면 모드 탭(스텝 그림 | 스냅샷, P3) — 화면이 넣는다. 잡는 중에는 단계 띠가 이 자리를 쓴다 -->
        <slot name="lead" />
        <span v-if="isNew" class="font-semibold text-gray-800 dark:text-gray-100">{{ t('SEW_CAP_NEW_TITLE') }}</span>
        <span v-else-if="step" class="font-semibold text-gray-800 dark:text-gray-100">스텝 {{ step.no }} 기준 화면</span>
        <span v-if="testShown" class="text-gray-500 truncate" data-testid="se-test-view-hint">{{ t('SEW_TEST_VIEW_HINT') }}</span>
        <span v-else-if="adjustHint" class="text-gray-500 truncate">{{ t('SEW_CAP_ADJUST_HINT') }}</span>
        <span v-else-if="!draft && step && step.condition.kind === 'image'" class="text-gray-500 truncate">{{ spotMarks ? t('SEW_UI_TRAIN_FOUND') : t('SEW_UI_TRAIN_NOT_STORED') }}</span>
        <span v-else-if="!draft && step && step.condition.kind === 'ocr'" class="text-gray-500">{{ t('SEW_UI_OCR_AREA_HINT') }}</span>
      </template>
      <div class="ml-auto flex gap-1 shrink-0">
        <button class="w-7 h-7 rounded-lg" :class="SECONDARY" title="확대" @click="zoomButton(1.25)">＋</button>
        <button class="w-7 h-7 rounded-lg" :class="SECONDARY" title="축소" @click="zoomButton(0.8)">－</button>
        <button class="h-7 px-2 rounded-lg" :class="SECONDARY" @click="fit">맞춤</button>
        <button class="h-7 px-2 rounded-lg" :class="SECONDARY" :title="t('SEW_SNAP_ZOOM_ACTUAL_HINT')" data-testid="se-zoom-actual" @click="actual">1:1</button>
      </div>
    </div>
    <div v-if="cap" class="px-3 py-1.5 text-xs bg-primary-50 dark:bg-primary-900/20 text-gray-700 dark:text-gray-200 border-b border-gray-200 dark:border-dark-border" data-testid="se-cap-hint">{{ capHint }}</div>
    <div v-else-if="showHint && src" class="px-3 py-1.5 text-[11px] bg-primary-50 dark:bg-primary-900/20 text-primary-800 dark:text-primary-300 flex items-center gap-2">
      {{ t('SEW_UI_BASE_IMAGE_HINT') }}<button class="ml-auto underline" data-testid="se-hint-close" @click="closeHint">닫기</button>
    </div>
    <div ref="box" class="flex-1 min-h-0 relative overflow-hidden bg-gray-50 dark:bg-dark-bg select-none" @wheel.prevent="onWheel" @mousedown="onDown">
      <div v-if="!shown" class="h-full flex items-center justify-center text-sm text-gray-400 px-6 text-center">{{ noSteps ? t('SEW_EDIT_VIEWER_EMPTY') : '' }}</div>
      <div v-else-if="baseState === 'notNeeded'" class="h-full flex items-center justify-center text-sm text-gray-400 px-6 text-center">{{ t('SEW_UI_BASE_IMAGE_NOT_NEEDED') }}</div>
      <div v-else-if="baseState === 'missing'" class="h-full flex items-center justify-center text-sm text-gray-400 px-6 text-center">{{ biUnreadable ? t('SEW_UI_BASE_IMAGE_UNREADABLE') : t('SEW_UI_BASE_IMAGE_MISSING') }}</div>
      <div v-else-if="failed" class="h-full flex items-center justify-center text-sm text-gray-400 px-6 text-center">{{ srcOther ? t('SEW_EDIT_IMAGE_SOURCE_GONE') : t('SEW_UI_IMAGE_LOAD_FAILED') }}</div>
      <div v-if="src && !failed" class="absolute left-0 top-0 origin-top-left"
        :style="{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`, width: natural ? `${natural.w}px` : 'auto', height: natural ? `${natural.h}px` : 'auto' }">
        <img :src="src" alt="" class="block max-w-none shadow-md" data-testid="se-base-image" draggable="false" @load="onLoad" @error="failed = true" />
        <CaptureLayer v-if="natural && editLayer" :draft="draft" :natural="natural" :scale="view.scale" />
        <div v-else-if="natural && areaStyle && !draft" class="absolute" :class="step.condition.kind === 'ocr' ? 'border-solid border-violet-600 bg-violet-500/10' : 'border-dashed border-primary-500 bg-primary-500/5'"
          :style="areaStyle" data-testid="se-search-area" />
        <SpotLayer v-if="natural && spotMarks" :natural="natural" :scale="view.scale" :train="spotMarks.train" :click="spotMarks.click" :labels="spotLabels" />
        <TestLayer v-if="natural && !cap" :natural="natural" :scale="view.scale" mode="step" :hide-click="!!flashAt" />
        <ClickDot v-if="natural && flashAt" :key="edit.clickShow?.n" :x="flashAt.x" :y="flashAt.y" :scale="view.scale" :title="t('SEW_TEST_TAG_CLICK')"
          data-testid="se-click-flash" :data-x="flashAt.x" :data-y="flashAt.y" />
      </div>
    </div>
  </div>
</template>

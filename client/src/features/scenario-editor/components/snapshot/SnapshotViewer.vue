<script setup>
// 큰 화면 스냅샷 모드(P3 설계 §4.3) — 고른 스냅샷의 그림·클릭 점·정보 줄, 확대·이동·맞춤·1:1, 이전·다음·태그 이동·메모 이동, 메모 줄.
// 그림은 저장소가 받은 것(object URL)을 띄운다. 번호·클릭 점은 그림과 같은 스냅샷의 것이다 —
// 고른 것이 바뀌면 그림 크기를 지워, 새 그림이 불러와질 때까지 점·크기를 그리지 않는다(DC-034).
// 메모 줄(P3-C): 메모가 있으면 글·작성자·[고치기]·[지우기], 없으면 [메모 쓰기]. 메모 창은 창을 연 스냅샷(파일 이름)에 쓴다.
// [받기 ▾](P3-D): 목록에서 고른 줄(하나 또는 여러 줄)을 그림만·좌표 포함으로 받는다 — 진행·결과는 받기 저장소와 DownloadDialog.
// [이력 보기](P3-D): 이력이 남는 태그 스냅샷(태그이고 txn ≥ 99999 — 서버의 hasHistory)에서만 켜진다. 창은 연 때의 설비·txn 으로 받는다.
// [새 스텝 ▾](P3-E): 표 위 [새 스텝] 과 같은 메뉴(NewStepMenu, 2026-11-17)를 연다 — 지금 스냅샷·고른 스텝의 화면·그림 파일로 이미지·OCR 스텝을, 또는 조건 없는 스텝을 만든다.
//   버튼은 고칠 수 있는 시나리오가 열려 있으면 켜지고, 스냅샷 줄은 그림이 떠 있을 때만 켜진다(DC-038 — 메뉴가 본다).
//   넘기는 것은 화면이 그리고 있는 그 그림의 바이트다(snap.shownImage — 다시 받지 않는다, DC-071·DC-075). 큰 화면은 화면(ScenarioEditorView)의 감시자가 스텝 그림으로 돌린다.
//   메뉴는 body 로 옮겨 버튼 위쪽의 고정 자리에 그린다 — 가운데 영역이 넘침을 잘라 그 안에 두면 좁은 화면에서 잘린다.
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useSnapshotStore } from '../../stores/snapshotStore'
import { useEditorStore } from '../../stores/editorStore'
import { useSnapshotDownloadStore } from '../../stores/snapshotDownloadStore'
import { useEditStore } from '../../stores/editStore'
import { usePanZoom } from '../../composables/usePanZoom'
import { clickPoint } from '../../editor/snapshotList'
import { t } from '../../messages'
import ViewerModeTabs from './ViewerModeTabs.vue'
import TestLayer from '../TestLayer.vue'
import ClickDot from '../ClickDot.vue'
import NewStepMenu from '../NewStepMenu.vue'
import MemoDialog from './MemoDialog.vue'
import DownloadDialog from './DownloadDialog.vue'
import HistoryDialog from './HistoryDialog.vue'
import '../../pills.css'
import './snapshot.css'

defineOptions({ name: 'SnapshotViewer' })
const snap = useSnapshotStore()
const editor = useEditorStore()
const box = ref(null)
const natural = ref(null)
const broken = ref(false) // 받았는데 브라우저가 그림으로 읽지 못했다
const { view, fit, actual, zoomButton, onWheel, onDown } = usePanZoom(box, natural)

const item = computed(() => snap.selected)
const src = computed(() => (snap.image.status === 'ready' && !broken.value ? snap.image.url : null))
// 그림이 바뀔 때만 크기를 지운다 — 같은 줄을 다시 골라 값이 그대로면 <img> 가 다시 불러오지 않아 크기를 되찾을 길이 없다
watch([() => snap.image.name, () => snap.image.url], () => { natural.value = null; broken.value = false })
function onLoad(e) { natural.value = { w: e.target.naturalWidth, h: e.target.naturalHeight }; fit() }

const point = computed(() => (src.value ? clickPoint(item.value, natural.value) : null))
const error = computed(() => (snap.image.status === 'error' ? snap.image.error : broken.value ? t('SEW_SNAP_IMAGE_FAILED') : ''))

// ── 메모 ──
const memo = computed(() => item.value?.memo ?? null)
const memoMeta = computed(() => {
  const m = memo.value
  if (!m) return ''
  const base = { name: m.authorName || t('SEW_SNAP_MEMO_SOMEONE'), at: m.writtenAt ?? '-' }
  return m.editedBy ? t('SEW_SNAP_MEMO_META_EDITED', { ...base, by: m.editedBy, editedAt: m.editedAt ?? '-' }) : t('SEW_SNAP_MEMO_META', base)
})
const memoDialog = ref({ open: false, fileName: '', mode: 'edit' })
function openMemo(mode) {
  if (item.value) memoDialog.value = { open: true, fileName: item.value.fileName, mode }
}

// ── 이력 보기 ──
const historyDialog = ref({ open: false, eqpId: '', txn: '', tag: '' })
const historyOff = computed(() => !item.value?.hasHistory)
const historyWhy = computed(() => {
  if (!item.value || item.value.hasHistory) return undefined
  return t(item.value.kind === 'tag' ? 'SEW_SNAP_HISTORY_NO_TXN' : 'SEW_SNAP_HISTORY_ONLY_TAG')
})
function openHistory() {
  const it = item.value
  if (it?.hasHistory) historyDialog.value = { open: true, eqpId: snap.eqpId, txn: String(it.txn), tag: it.tag ?? '' }
}

// ── 받기 ──
const dl = useSnapshotDownloadStore()
const dlBox = ref(null)
// 펼침 메뉴는 하나만 열린다: 'dl'(받기) | 'new'(새 스텝) | null
const menu = ref(null)
const dlOpen = computed(() => menu.value === 'dl')
const newOpen = computed(() => menu.value === 'new')
const toggleMenu = (kind) => { menu.value = menu.value === kind ? null : kind }
// 새 스텝 메뉴의 자리: 버튼의 왼쪽 끝에 맞추되 창 밖으로 나가지 않게, 이동 줄이 화면 아래쪽이라 위로 연다
const NEW_MENU_W = 340
const newPos = ref({ left: 8, bottom: 8 })
function toggleNew(e) {
  if (menu.value !== 'new') {
    const r = e.currentTarget.getBoundingClientRect()
    const vw = window.innerWidth || 1280
    const vh = window.innerHeight || 800
    newPos.value = { left: Math.min(Math.max(r.left, 8), Math.max(8, vw - NEW_MENU_W - 8)), bottom: Math.max(8, vh - r.top + 4) }
  }
  toggleMenu('new')
}
const dlCount = computed(() => snap.pickedItems.length)
const dlLabel = computed(() => (dlCount.value > 1 ? t('SEW_SNAP_DL_N', { n: dlCount.value }) : t('SEW_SNAP_DL')))
const dlOff = computed(() => !dlCount.value || dl.job.status === 'running')
function download(withCircle) {
  menu.value = null
  dl.start(withCircle)
}

// ── 새 스텝 ──
const edit = useEditStore()
const newBox = ref(null)
const newMenu = ref(null)
// 버튼이 꺼진 까닭(없으면 켜짐): 쓰기 권한 없음 → 시나리오 없음(여는 중 포함) → 지워짐·읽기 전용
const newWhy = computed(() => {
  if (editor.me && !editor.me.canWrite) return t('SEW_SNAP_STEP_NO_WRITE')
  if (!edit.session?.working || editor.opening) return t('SEW_SNAP_STEP_NO_SCENARIO')
  if (!edit.editable) return t(edit.session.readOnly === 'deleted' ? 'SEW_SNAP_STEP_DELETED' : edit.session.readOnly === 'noWrite' ? 'SEW_SNAP_STEP_NO_WRITE' : 'SEW_SNAP_STEP_READ_ONLY')
  return undefined
})

// 메뉴 바깥을 누르거나 Esc 를 누르면 닫는다
function onDocDown(e) {
  const box = menu.value === 'dl' ? dlBox.value : menu.value === 'new' ? newBox.value : null
  if (menu.value && !box?.contains(e.target) && !newMenu.value?.contains(e.target)) menu.value = null
}
function onDocKey(e) { if (e.key === 'Escape' && menu.value) menu.value = null }
onMounted(() => { document.addEventListener('mousedown', onDocDown); document.addEventListener('keydown', onDocKey) })
onBeforeUnmount(() => { document.removeEventListener('mousedown', onDocDown); document.removeEventListener('keydown', onDocKey) })
watch(dlOff, (off) => { if (off && dlOpen.value) menu.value = null })
watch(newWhy, (why) => { if (why && newOpen.value) menu.value = null })

const count = computed(() => snap.shown.length)
const atFirst = computed(() => !count.value || snap.position === 0)
const atLast = computed(() => !count.value || snap.position === count.value - 1)
const noList = computed(() => !snap.list.items.length)
const btn = 'h-7 px-2 rounded-lg text-xs bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:enabled:bg-gray-300 dark:hover:enabled:bg-gray-600 disabled:opacity-50 whitespace-nowrap'
defineExpose({ onLoad, fit })
</script>

<template>
  <div class="h-full flex flex-col" data-testid="se-snap-viewer">
    <div class="h-10 px-3 flex items-center gap-2 border-b border-gray-200 dark:border-dark-border text-xs shrink-0">
      <ViewerModeTabs />
      <div class="ml-auto flex gap-1 shrink-0">
        <button type="button" class="w-7 h-7 rounded-lg bg-gray-200 dark:bg-gray-700" :title="t('SEW_SNAP_ZOOM_IN')" data-testid="se-snap-zoom-in" @click="zoomButton(1.25)">＋</button>
        <button type="button" class="w-7 h-7 rounded-lg bg-gray-200 dark:bg-gray-700" :title="t('SEW_SNAP_ZOOM_OUT')" data-testid="se-snap-zoom-out" @click="zoomButton(0.8)">－</button>
        <button type="button" class="h-7 px-2 rounded-lg bg-gray-200 dark:bg-gray-700" data-testid="se-snap-zoom-fit" @click="fit">{{ t('SEW_SNAP_ZOOM_FIT') }}</button>
        <button type="button" class="h-7 px-2 rounded-lg bg-gray-200 dark:bg-gray-700" :title="t('SEW_SNAP_ZOOM_ACTUAL_HINT')" data-testid="se-snap-zoom-actual" @click="actual">{{ t('SEW_SNAP_ZOOM_ACTUAL') }}</button>
      </div>
    </div>
    <!-- 정보 줄: 머리 줄에 함께 넣으면 패널을 펼친 화면에서 좌표·크기·순번이 잘려 제 줄에 둔다 -->
    <div v-if="item" class="px-3 py-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-600 dark:text-gray-300 border-b border-gray-200 dark:border-dark-border shrink-0" data-testid="se-snap-info">
      <b class="text-gray-800 dark:text-gray-100">{{ snap.eqpId }}</b>
      <span class="tabular-nums">{{ item.date ?? snap.date }} <b class="text-gray-800 dark:text-gray-100">{{ item.time }}</b></span>
      <span>{{ item.shift }}</span>
      <span v-if="item.kind === 'tag'" class="se-pill" :class="`se-snap-tag-${item.tag}`" data-testid="se-snap-tag">{{ t(`SEW_SNAP_TAG_${item.tag}`) }}</span>
      <span v-else class="tabular-nums">{{ t('SEW_SNAP_INFO_CLICK', { x: item.x, y: item.y }) }}</span>
      <span v-if="natural && src" class="tabular-nums">{{ t('SEW_SNAP_INFO_SIZE', { w: natural.w, h: natural.h }) }}</span>
      <span v-if="snap.position >= 0" class="tabular-nums">{{ t('SEW_SNAP_INFO_POS', { i: snap.position + 1, n: count }) }}</span>
    </div>
    <div ref="box" class="flex-1 min-h-0 relative overflow-hidden bg-gray-50 dark:bg-dark-bg select-none" @wheel.prevent="onWheel" @mousedown="onDown">
      <div v-if="!item" class="h-full flex items-center justify-center text-sm text-gray-400 px-6 text-center" data-testid="se-snap-empty">{{ snap.open ? t('SEW_SNAP_VIEW_EMPTY') : t('SEW_SNAP_VIEW_NO_PANEL') }}</div>
      <div v-else-if="error" class="h-full flex items-center justify-center text-sm text-gray-500 dark:text-gray-400 px-6 text-center" data-testid="se-snap-error">{{ error }}</div>
      <div v-else-if="snap.image.status === 'loading'" class="h-full flex items-center justify-center text-sm text-gray-400 px-6 text-center" data-testid="se-snap-loading">{{ t('SEW_SNAP_VIEW_LOADING') }}</div>
      <div v-if="item && src" class="absolute left-0 top-0 origin-top-left"
        :style="{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`, width: natural ? `${natural.w}px` : 'auto', height: natural ? `${natural.h}px` : 'auto' }">
        <img :key="src" :src="src" alt="" class="block max-w-none shadow-md" data-testid="se-snap-image" draggable="false" @load="onLoad" @error="broken = true" />
        <!-- 클릭한 곳: 그림과 같은 변환 상자 안의 점(ClickDot — 확대해도 화면에서 같은 크기) -->
        <ClickDot v-if="point" :x="point.x" :y="point.y" :scale="view.scale" :title="t('SEW_SNAP_DOT')" data-testid="se-snap-dot" />
        <!-- Vision·OCR 시험(P4): 이 스냅샷으로 시험한 결과와 시험할 스텝의 검색 영역 -->
        <TestLayer v-if="natural" :natural="natural" :scale="view.scale" mode="snapshot" />
      </div>
    </div>
    <div v-if="item" class="min-h-9 px-3 py-1 flex items-center gap-2 border-t border-gray-200 dark:border-dark-border text-xs shrink-0" :class="memo ? 'se-snap-memo-bar' : ''" data-testid="se-snap-memo">
      <template v-if="memo">
        <span class="se-snap-memo-ic shrink-0" aria-hidden="true">✎</span>
        <span class="min-w-0 truncate text-gray-800 dark:text-gray-100" :title="memo.text" data-testid="se-snap-memo-text">{{ memo.text }}</span>
        <span class="shrink-0 text-gray-500 dark:text-gray-400" :title="memoMeta" data-testid="se-snap-memo-author">— {{ memo.authorName || t('SEW_SNAP_MEMO_SOMEONE') }}</span>
        <span class="ml-auto flex gap-1.5 shrink-0">
          <button type="button" :class="btn" data-testid="se-snap-memo-edit" @click="openMemo('edit')">{{ t('SEW_SNAP_MEMO_EDIT') }}</button>
          <button type="button" :class="btn" data-testid="se-snap-memo-remove" @click="openMemo('delete')">{{ t('SEW_SNAP_MEMO_REMOVE') }}</button>
        </span>
      </template>
      <button v-else type="button" :class="btn" data-testid="se-snap-memo-write" @click="openMemo('edit')">{{ t('SEW_SNAP_MEMO_WRITE') }}</button>
    </div>
    <!-- 이동 줄: 가운데가 좁으면(스냅샷 패널을 넓힘·[받기 (n)] 이 길어짐) 줄을 바꾼다 — 한 줄로 두면 맨 끝의 [새 스텝] 부터 잘려 보이지 않는다 -->
    <div class="min-h-10 px-3 py-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 border-t border-gray-200 dark:border-dark-border shrink-0" data-testid="se-snap-bar">
      <button type="button" :class="btn" :disabled="atFirst" data-testid="se-snap-prev" @click="snap.move(-1)">{{ t('SEW_SNAP_PREV') }}</button>
      <button type="button" :class="btn" :disabled="atLast" data-testid="se-snap-next" @click="snap.move(1)">{{ t('SEW_SNAP_NEXT') }}</button>
      <span class="w-2" />
      <button type="button" :class="btn" :disabled="noList" data-testid="se-snap-tag-prev" @click="snap.moveTag(-1)">{{ t('SEW_SNAP_TAG_PREV') }}</button>
      <button type="button" :class="btn" :disabled="noList" data-testid="se-snap-tag-next" @click="snap.moveTag(1)">{{ t('SEW_SNAP_TAG_NEXT') }}</button>
      <span class="w-2" />
      <button type="button" :class="btn" :disabled="noList" data-testid="se-snap-memo-prev" @click="snap.moveMemo(-1)">{{ t('SEW_SNAP_MEMO_PREV') }}</button>
      <button type="button" :class="btn" :disabled="noList" data-testid="se-snap-memo-next" @click="snap.moveMemo(1)">{{ t('SEW_SNAP_MEMO_NEXT') }}</button>
      <span class="w-2" />
      <button type="button" :class="btn" :disabled="historyOff" :title="historyWhy" data-testid="se-snap-history" @click="openHistory">{{ t('SEW_SNAP_HISTORY') }}</button>
      <span ref="dlBox" class="relative shrink-0">
        <button type="button" :class="btn" :disabled="dlOff" :aria-expanded="dlOpen ? 'true' : 'false'" aria-haspopup="menu" data-testid="se-snap-download" @click="toggleMenu('dl')">{{ dlLabel }} ▾</button>
        <!-- 이동 줄이 화면 아래쪽이라 위로 연다 -->
        <span v-if="dlOpen" class="se-snap-menu" role="menu">
          <button type="button" role="menuitem" data-testid="se-snap-download-plain" @click="download(false)">{{ t('SEW_SNAP_DL_PLAIN') }}</button>
          <button type="button" role="menuitem" :title="t('SEW_SNAP_DL_XY_HINT')" data-testid="se-snap-download-xy" @click="download(true)">{{ t('SEW_SNAP_DL_XY') }}</button>
        </span>
      </span>
      <span ref="newBox" class="relative shrink-0">
        <button type="button" class="h-7 px-2 rounded-lg text-xs font-medium bg-primary-500 hover:enabled:bg-primary-600 text-white disabled:opacity-50 whitespace-nowrap" :disabled="!!newWhy" :title="newWhy"
          :aria-expanded="newOpen ? 'true' : 'false'" aria-haspopup="menu" data-testid="se-snap-new" @click="toggleNew">＋ {{ t('SEW_SNAP_STEP') }} ▾</button>
        <Teleport to="body">
          <div v-if="newOpen" ref="newMenu" class="se-new-pop" role="menu" data-testid="se-snap-new-menu" :style="{ left: `${newPos.left}px`, bottom: `${newPos.bottom}px` }">
            <NewStepMenu @done="menu = null" />
          </div>
        </Teleport>
      </span>
      <span v-if="snap.notice" class="ml-3 text-xs text-amber-700 dark:text-amber-300 truncate" role="status" data-testid="se-snap-notice">{{ snap.notice }}</span>
    </div>
    <MemoDialog v-model="memoDialog.open" :file-name="memoDialog.fileName" :mode="memoDialog.mode" :me="editor.me?.singleid ?? ''" />
    <DownloadDialog />
    <HistoryDialog v-model="historyDialog.open" :eqp-id="historyDialog.eqpId" :txn="historyDialog.txn" :tag="historyDialog.tag" />
  </div>
</template>

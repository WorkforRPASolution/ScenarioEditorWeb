<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, onActivated, onDeactivated } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useEditorStore } from './stores/editorStore'
import { useEditStore } from './stores/editStore'
import { useSnapshotStore } from './stores/snapshotStore'
import { useLayoutSizes } from './composables/useLayoutSizes'
import { t } from './messages'
import SplitGutter from './components/SplitGutter.vue'
import StatePanel from './components/StatePanel.vue'
import ScenarioBar from './components/ScenarioBar.vue'
import LoadDialog from './components/LoadDialog.vue'
import StepTable from './components/StepTable.vue'
import StepFlow from './components/StepFlow.vue'
import StepViewer from './components/StepViewer.vue'
import StepDetail from './components/StepDetail.vue'
import StepPanel from './components/StepPanel.vue'
import StepToolbar from './components/StepToolbar.vue'
import MultiSelection from './components/MultiSelection.vue'
import EditDialogs from './components/EditDialogs.vue'
import NewScenarioDialog from './components/NewScenarioDialog.vue'
import SnapshotPanel from './components/snapshot/SnapshotPanel.vue'
import SnapshotViewer from './components/snapshot/SnapshotViewer.vue'
import ViewerModeTabs from './components/snapshot/ViewerModeTabs.vue'

defineOptions({ name: 'ScenarioEditorView' })
const store = useEditorStore()
const edit = useEditStore()
const snap = useSnapshotStore()
const route = useRoute()
const router = useRouter()
const { sizes, folded, startDrag, reset, setFolded } = useLayoutSizes()
const loadOpen = ref(false)
const newOpen = ref(false)

// 셸은 모든 화면을 <keep-alive> 로 감싼다 — 화면은 세션에 한 번만 만들어지고, 다른 화면에 가 있는 동안에도 감시자가 살아 있다.
// 그래서 (1) 주소 쿼리는 이 화면이 보일 때만 쓰고, (2) 돌아올 때(onActivated) 주소와 열린 시나리오를 다시 맞춘다.
let active = false
let firstActivation = true

const queryTarget = () => {
  const q = route.query
  return q.p && q.m && q.n ? { process: String(q.p), model: String(q.m), name: String(q.n), crtime: String(q.v || 'current') } : null
}
const queryOf = (sk) => ({ p: sk.process, m: sk.model, n: sk.name, v: sk.version.isCurrent ? 'current' : String(sk.version.crtime) })
// 새 시나리오(서버에 아직 없음)·원본이 지워진 초안(서버 사본으로만 연 판)은 주소에 쓰지 않는다 — 새로고침이 열 수 없는 시나리오를 열려 하지 않게 쿼리를 비운다
const addressable = (sk) => !sk.isNew && !sk.sourceGone
const writeQuery = (sk) => router.replace({ name: 'ScenarioEditor', query: addressable(sk) ? queryOf(sk) : {} })

// 다른 시나리오 열기 — 오른쪽 패널에 적용 안 한 변경이 있으면 먼저 묻는다(guard 'open'). onKeep = [계속 고치기]로 접을 때 할 일.
// 패널 확인 뒤에 저장 전 작업본 변경(적용한 값)도 한 번 더 묻는다([적용하고 이동]으로 넣은 값도 열기가 버리므로).
const guardedOpen = (open, onKeep = null) => edit.guard(() => edit.askLeave(open, { onKeep }), { action: 'open', onKeep })
const openGuarded = (target, onKeep = null) => guardedOpen(() => store.openScenario(target), onKeep)

// [새 시나리오](P2-D Task 6): 패널에 적용 안 한 변경이 있으면 먼저 묻고(guard 'new') 창을 연다. 저장 전 변경(적용한 값)은
// 창이 [만들기]·[그 시나리오 열기] 때 돌아가기·버리고·초안 저장하고 중에서 묻는다(목업 조작판 "저장 전 변경이 있을 때").
const openNew = () => edit.guard(() => { newOpen.value = true }, { action: 'new' })
// 불러오기 창·새 시나리오 창의 [초안 이어서 열기]({ process, model, name, draftId })와 [이 버전으로 되돌려 열기]({ process, model, name, crtime }) —
// 다른 시나리오 열기와 같은 확인(패널 → 저장 전 변경)을 거친다(P2-D Task 7)
function openDraft(d) {
  newOpen.value = false
  loadOpen.value = false
  guardedOpen(() => store.openDraft({ process: d.process, model: d.model, name: d.name, draftId: d.draftId }))
}
function openRestore(target) {
  loadOpen.value = false
  guardedOpen(() => store.openRestore(target))
}
// 열기 오류의 [다시 시도] — 실패한 길(시나리오·초안·되돌리기)로 다시
function reopen(target) {
  if (target.kind === 'draft') guardedOpen(() => store.openDraft(target))
  else if (target.kind === 'restore') guardedOpen(() => store.openRestore(target))
  else openGuarded(target)
}

// 저장 전 변경이 있으면 브라우저 떠나기·새로고침 앞에서 확인(설계 §4.2). 문구는 브라우저가 정한다.
function onBeforeUnload(e) {
  if (!edit.unsavedCount) return
  e.preventDefault()
  e.returnValue = ''
}
onMounted(() => window.addEventListener('beforeunload', onBeforeUnload))
onBeforeUnmount(() => window.removeEventListener('beforeunload', onBeforeUnload))

async function start() {
  const target = queryTarget() // await 뒤에는 다른 화면의 주소일 수 있어 먼저 읽는다
  await store.init()
  if (!store.meError && target) openGuarded(target)
}

onMounted(() => { active = true; start() })
// 스냅샷 패널(P3): 펼침·마지막 설비를 되살린다 — 접혀 있으면 서버를 부르지 않는다
onMounted(() => snap.restore())
// 설비 고르기가 열린 시나리오의 공정·모델 설비를 먼저 보인다
const snapPrefer = computed(() => (store.skeleton ? { process: store.skeleton.process, model: store.skeleton.model } : null))
onDeactivated(() => { active = false })
onActivated(() => {
  active = true
  if (firstActivation) { firstActivation = false; return } // 처음 켜질 때는 onMounted 가 이미 처리한다
  const sk = store.skeleton
  const target = queryTarget()
  if (store.meError || store.opening) return // 열기가 끝나면 아래 감시자가 주소를 맞춘다
  if (!target) { if (sk) writeQuery(sk); return }
  const q = sk && addressable(sk) && queryOf(sk)
  // 주소가 다른 시나리오를 가리킨다. 패널에 적용 안 한 변경이 있으면 묻고, [계속 고치기]면 주소를 열린 시나리오로 되돌린다.
  if (!q || q.p !== target.process || q.m !== target.model || q.n !== target.name || q.v !== target.crtime) openGuarded(target, () => { if (store.skeleton && active) writeQuery(store.skeleton) })
})

watch(() => store.skeleton, (sk) => {
  if (sk && active) writeQuery(sk)
})

// 큰 화면 모드(P3 설계 §4.1): 스냅샷을 고르면 스냅샷으로(저장소 select), 스텝 쪽에서 무언가 하면 스텝 그림으로 저절로 돌아온다 —
// 고른 스텝이 바뀜, 시나리오 열기를 시작함, 잡기·새 스텝을 시작함, 스텝 표·순서도 안을 누름(같은 줄을 다시 눌러도).
watch(() => store.selectedUid, (uid) => { if (uid) snap.showStep() })
watch(() => store.opening, (o) => { if (o) snap.showStep() })
watch(() => !!edit.capture, (on) => { if (on) snap.showStep() })
watch(() => (edit.panel?.isNew ? edit.panel.uid : null), (uid) => { if (uid) snap.showStep() })
// 접기(사내 요청 2026-11-16): 아래 스텝 목록과 오른쪽 스텝 패널을 스냅샷 패널처럼 띠로 접는다 — 큰 화면(스냅샷)을 넓게 보려고.
// 접어도 둘 다 그려 둔 채 숨긴다(패널에 적던 값·표의 스크롤이 남는다). 접힘은 크기와 함께 기억한다(se-layout).
// - 스텝 목록을 넓게 펼친 채 접으면 넓게 보기를 푼다(큰 화면이 가려진 채 목록까지 사라지지 않게).
// - 패널을 접은 채 새 스텝을 시작하면 패널을 편다 — 넣기·취소가 패널에 있다.
function foldSteps() {
  store.expanded = false
  setFolded('steps', true)
}
watch(() => (edit.panel?.isNew ? edit.panel.uid : null), (uid) => { if (uid) setFolded('right', false) })
// 패널의 칸으로 초점을 보내라는 요청(적용이 칸 오류로 막힘 등) — 접혀 있으면 오류 칸이 보이지 않으니 편다. 초점은 다음 틱에 간다(StepPanel)
watch(() => edit.focusReq, (r) => { if (r) setFolded('right', false) })
// 스텝 표를 넓게 펼치면 큰 화면이 가려진다 — 그 상태에서 스냅샷을 고르면 넓게 보기를 푼다(시나리오 열기와 같은 규칙)
watch(() => snap.selectedName, (name) => { if (name && snap.mode === 'snapshot') store.expanded = false })

const retry = () => store.openError && reopen(store.openError.target)
// 불러오기 창이 열린 시나리오를 지웠다 — 편집 화면은 읽기 전용이고 고친 곳은 볼 수만 있다(목업 "열린 시나리오 지우기")
const deleted = computed(() => edit.session?.readOnly === 'deleted')
const card = 'bg-white dark:bg-dark-card rounded-lg border border-gray-200 dark:border-dark-border'
</script>

<template>
  <div class="h-full flex flex-col min-h-0" style="height: calc(100vh - 144px)" data-testid="se-root">
    <StatePanel v-if="store.meError?.code === 'USER_NOT_REGISTERED'" kind="unregistered" :message="store.meError.message" />
    <StatePanel v-else-if="store.meError" kind="error" :message="store.meError.message" @retry="start" />
    <template v-else>
      <ScenarioBar class="mb-3 shrink-0" @load="loadOpen = true" @new="openNew" />
      <div v-if="deleted" class="mb-3 shrink-0 rounded-lg px-3 py-2 text-sm flex items-center gap-3 bg-red-50 text-red-800 dark:bg-red-900/30 dark:text-red-300" role="status" data-testid="se-deleted-banner">
        <span class="flex-1 min-w-0">{{ t('SEW_DELETED_BANNER') }}{{ edit.changeCount ? t('SEW_DELETED_BANNER_CHANGED', { n: edit.changeCount }) : '' }}</span>
        <button class="h-8 px-3 rounded-lg text-sm bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-100" @click="loadOpen = true">{{ t('SEW_UI_LOAD') }}</button>
      </div>
      <div class="flex-1 min-h-0 grid" :style="{ gridTemplateColumns: `${snap.open ? sizes.lw : 36}px 12px minmax(0,1fr) 12px ${folded.right ? 36 : sizes.rw}px` }">
        <!-- 왼쪽: 스냅샷(P3) — 접힌 띠를 누르면 패널이 펼쳐진다 -->
        <template v-if="snap.open">
          <section :class="card" class="min-h-0 min-w-0 overflow-hidden"><SnapshotPanel :prefer="snapPrefer" /></section>
          <SplitGutter direction="v" testid="se-gutter-l" @start="startDrag('lw', $event, 1, 'x')" @reset="reset('lw')" />
        </template>
        <template v-else>
          <button type="button" :class="card" class="flex items-center justify-center hover:bg-gray-50 dark:hover:bg-gray-800" :title="t('SEW_SNAP_EXPAND_HINT')" data-testid="se-snapshot-rail" @click="snap.setOpen(true)">
            <span class="text-xs text-gray-500 dark:text-gray-400 [writing-mode:vertical-rl]">{{ t('SEW_UI_SNAPSHOT_RAIL') }}</span>
          </button>
          <div />
        </template>
        <!-- 가운데 -->
        <div class="flex flex-col min-h-0 min-w-0">
          <!-- 큰 화면: 스텝 그림 | 스냅샷. 두 쪽을 모두 그려 두고 숨긴다 — 모드를 오가도 그림·선택·잡기 상태가 남는다(확대는 돌아올 때 다시 맞춘다) -->
          <section v-show="!store.expanded" :class="card" class="flex-1 min-h-0 overflow-hidden">
            <div v-show="snap.mode === 'snapshot'" class="h-full"><SnapshotViewer /></div>
            <div v-show="snap.mode !== 'snapshot'" class="h-full flex flex-col" data-testid="se-mode-pane-step">
              <template v-if="store.opening || store.openError || !store.skeleton">
                <div class="h-10 px-3 flex items-center border-b border-gray-200 dark:border-dark-border shrink-0" data-testid="se-mode-bar"><ViewerModeTabs /></div>
                <div class="flex-1 min-h-0">
                  <StatePanel v-if="store.opening" kind="opening" :started-at="store.opening.startedAt" />
                  <StatePanel v-else-if="store.openError" kind="error" :message="store.openError.message" @retry="retry" />
                  <StatePanel v-else kind="empty" :can-create="!!store.me?.canWrite" @load="loadOpen = true" @new="openNew" />
                </div>
              </template>
              <StepViewer v-else><template #lead><ViewerModeTabs /></template></StepViewer>
            </div>
          </section>
          <SplitGutter v-show="!store.expanded && !folded.steps" direction="h" testid="se-gutter-s" @start="startDrag('sh', $event, -1, 'y')" @reset="reset('sh')" />
          <!-- 접힌 스텝 목록: 띠를 누르면 펴진다 -->
          <button v-if="folded.steps" type="button" :class="card" class="mt-3 h-9 shrink-0 flex items-center justify-center text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800" :title="t('SEW_UI_STEPS_EXPAND_HINT')" data-testid="se-steps-rail" @click="setFolded('steps', false)">{{ t('SEW_UI_STEPS_RAIL') }}</button>
          <section v-show="!folded.steps" :class="card" class="flex flex-col min-h-0 shrink-0" :style="{ height: store.expanded ? '100%' : `${sizes.sh}px` }" data-testid="se-steps-section">
            <div class="flex items-center justify-between gap-1 px-3 h-10 border-b border-gray-200 dark:border-dark-border shrink-0">
              <div class="flex gap-1 bg-gray-100 dark:bg-dark-bg p-1 rounded-lg text-xs shrink-0">
                <button data-testid="se-tab-table" class="px-3 py-1 rounded-md" :class="store.view === 'table' ? 'bg-white dark:bg-dark-card text-primary-700 dark:text-primary-300 font-semibold shadow-sm' : 'text-gray-500'" @click="store.view = 'table'">표</button>
                <button data-testid="se-tab-flow" class="px-3 py-1 rounded-md" :class="store.view === 'flow' ? 'bg-white dark:bg-dark-card text-primary-700 dark:text-primary-300 font-semibold shadow-sm' : 'text-gray-500'" @click="store.view = 'flow'">순서도</button>
              </div>
              <!-- 편집 도구 줄: 작업본이 있고 쓸 수 있는 세션만(읽기 전용이거나 다른 시나리오를 여는 중이면 없음 — edit.editable). 새 스텝 ▾ 은 패널에 새 스텝 초안을 연다. -->
              <StepToolbar v-if="edit.editable" @new="edit.startNew" />
              <div class="flex gap-1 shrink-0">
                <button data-testid="se-expand" class="shrink-0 text-xs px-2 h-7 rounded-lg bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300" @click="store.expanded = !store.expanded">{{ store.expanded ? '⤡ 줄이기' : '⤢ 넓게' }}</button>
                <button type="button" data-testid="se-fold-steps" class="shrink-0 text-xs px-2 h-7 rounded-lg bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300" :title="t('SEW_UI_STEPS_FOLD_HINT')" @click="foldSteps">{{ t('SEW_UI_FOLD_DOWN') }}</button>
              </div>
            </div>
            <div class="flex-1 min-h-0" data-testid="se-steps-area" @click.capture="snap.showStep()">
              <StepTable v-if="store.view === 'table'" />
              <StepFlow v-else />
            </div>
          </section>
        </div>
        <!-- 오른쪽 경계선: 위쪽 손잡이를 누르면 스텝 패널이 띠로 접힌다 -->
        <div v-if="!folded.right" class="relative flex min-h-0">
          <SplitGutter direction="v" testid="se-gutter-r" @start="startDrag('rw', $event, -1, 'x')" @reset="reset('rw')" />
          <button type="button" class="absolute z-10 top-1.5 -left-0.5 w-4 h-7 rounded flex items-center justify-center text-[10px] leading-none bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-primary-500 hover:text-white"
            :title="t('SEW_UI_RIGHT_FOLD_HINT')" :aria-label="t('SEW_UI_RIGHT_FOLD_HINT')" data-testid="se-fold-right" @mousedown.stop @dblclick.stop @click="setFolded('right', true)">▶</button>
        </div>
        <div v-else />
        <!-- 오른쪽: 쓸 수 있는 세션은 편집 패널(여러 줄이면 묶음 칸), 읽기 전용·여는 중은 P1 상세. 접히면 띠 -->
        <button v-if="folded.right" type="button" :class="card" class="flex items-center justify-center hover:bg-gray-50 dark:hover:bg-gray-800" :title="t('SEW_UI_RIGHT_EXPAND_HINT')" data-testid="se-right-rail" @click="setFolded('right', false)">
          <span class="text-xs text-gray-500 dark:text-gray-400 [writing-mode:vertical-rl]">{{ t(edit.editable ? 'SEW_UI_RIGHT_RAIL_EDIT' : 'SEW_UI_RIGHT_RAIL_DETAIL') }}</span>
        </button>
        <section v-show="!folded.right" :class="card" class="min-h-0 overflow-hidden" data-testid="se-right-section">
          <MultiSelection v-if="edit.editable && edit.selection.uids.length > 1" />
          <StepPanel v-else-if="edit.editable" />
          <StepDetail v-else />
        </section>
      </div>
    </template>
    <LoadDialog v-model="loadOpen" @open="(target) => { loadOpen = false; openGuarded(target) }" @open-draft="openDraft" @restore="openRestore" />
    <NewScenarioDialog v-model="newOpen" @open-draft="openDraft" />
    <EditDialogs v-if="edit.editable" />
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onBeforeUnmount, onActivated, onDeactivated } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useEditorStore } from './stores/editorStore'
import { useEditStore } from './stores/editStore'
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

defineOptions({ name: 'ScenarioEditorView' })
const store = useEditorStore()
const edit = useEditStore()
const route = useRoute()
const router = useRouter()
const { sizes, startDrag, reset } = useLayoutSizes()
const loadOpen = ref(false)

// 셸은 모든 화면을 <keep-alive> 로 감싼다 — 화면은 세션에 한 번만 만들어지고, 다른 화면에 가 있는 동안에도 감시자가 살아 있다.
// 그래서 (1) 주소 쿼리는 이 화면이 보일 때만 쓰고, (2) 돌아올 때(onActivated) 주소와 열린 시나리오를 다시 맞춘다.
let active = false
let firstActivation = true

const queryTarget = () => {
  const q = route.query
  return q.p && q.m && q.n ? { process: String(q.p), model: String(q.m), name: String(q.n), crtime: String(q.v || 'current') } : null
}
const queryOf = (sk) => ({ p: sk.process, m: sk.model, n: sk.name, v: sk.version.isCurrent ? 'current' : String(sk.version.crtime) })
const writeQuery = (sk) => router.replace({ name: 'ScenarioEditor', query: queryOf(sk) })

// 다른 시나리오 열기 — 오른쪽 패널에 적용 안 한 변경이 있으면 먼저 묻는다(guard 'open'). onKeep = [계속 고치기]로 접을 때 할 일.
// 패널 확인 뒤에 저장 전 작업본 변경(적용한 값)도 한 번 더 묻는다([적용하고 이동]으로 넣은 값도 열기가 버리므로).
const openGuarded = (target, onKeep = null) => edit.guard(() => edit.askLeave(() => store.openScenario(target), { onKeep }), { action: 'open', onKeep })

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
onDeactivated(() => { active = false })
onActivated(() => {
  active = true
  if (firstActivation) { firstActivation = false; return } // 처음 켜질 때는 onMounted 가 이미 처리한다
  const sk = store.skeleton
  const target = queryTarget()
  if (store.meError || store.opening) return // 열기가 끝나면 아래 감시자가 주소를 맞춘다
  if (!target) { if (sk) writeQuery(sk); return }
  const q = sk && queryOf(sk)
  // 주소가 다른 시나리오를 가리킨다. 패널에 적용 안 한 변경이 있으면 묻고, [계속 고치기]면 주소를 열린 시나리오로 되돌린다.
  if (!q || q.p !== target.process || q.m !== target.model || q.n !== target.name || q.v !== target.crtime) openGuarded(target, () => { if (store.skeleton && active) writeQuery(store.skeleton) })
})

watch(() => store.skeleton, (sk) => {
  if (sk && active) writeQuery(sk)
})

const retry = () => store.openError && openGuarded(store.openError.target)
const card = 'bg-white dark:bg-dark-card rounded-lg border border-gray-200 dark:border-dark-border'
</script>

<template>
  <div class="h-full flex flex-col min-h-0" style="height: calc(100vh - 144px)" data-testid="se-root">
    <StatePanel v-if="store.meError?.code === 'USER_NOT_REGISTERED'" kind="unregistered" :message="store.meError.message" />
    <StatePanel v-else-if="store.meError" kind="error" :message="store.meError.message" @retry="start" />
    <template v-else>
      <ScenarioBar class="mb-3 shrink-0" @load="loadOpen = true" />
      <div class="flex-1 min-h-0 grid" :style="{ gridTemplateColumns: `36px 12px minmax(0,1fr) 12px ${sizes.rw}px` }">
        <!-- 왼쪽: 스냅샷(P3) — P1 은 접힌 막대 -->
        <aside :class="card" class="flex items-center justify-center" data-testid="se-snapshot-rail">
          <span class="text-xs text-gray-400 dark:text-gray-500 [writing-mode:vertical-rl]">{{ t('SEW_UI_SNAPSHOT_RAIL') }}</span>
        </aside>
        <div />
        <!-- 가운데 -->
        <div class="flex flex-col min-h-0 min-w-0">
          <section v-show="!store.expanded" :class="card" class="flex-1 min-h-0 overflow-hidden">
            <StatePanel v-if="store.opening" kind="opening" :started-at="store.opening.startedAt" />
            <StatePanel v-else-if="store.openError" kind="error" :message="store.openError.message" @retry="retry" />
            <StatePanel v-else-if="!store.skeleton" kind="empty" @load="loadOpen = true" />
            <StepViewer v-else />
          </section>
          <SplitGutter v-show="!store.expanded" direction="h" testid="se-gutter-s" @start="startDrag('sh', $event, -1, 'y')" @reset="reset('sh')" />
          <section :class="card" class="flex flex-col min-h-0 shrink-0" :style="{ height: store.expanded ? '100%' : `${sizes.sh}px` }">
            <div class="flex items-center justify-between gap-1 px-3 h-10 border-b border-gray-200 dark:border-dark-border shrink-0">
              <div class="flex gap-1 bg-gray-100 dark:bg-dark-bg p-1 rounded-lg text-xs shrink-0">
                <button data-testid="se-tab-table" class="px-3 py-1 rounded-md" :class="store.view === 'table' ? 'bg-white dark:bg-dark-card text-primary-700 dark:text-primary-300 font-semibold shadow-sm' : 'text-gray-500'" @click="store.view = 'table'">표</button>
                <button data-testid="se-tab-flow" class="px-3 py-1 rounded-md" :class="store.view === 'flow' ? 'bg-white dark:bg-dark-card text-primary-700 dark:text-primary-300 font-semibold shadow-sm' : 'text-gray-500'" @click="store.view = 'flow'">순서도</button>
              </div>
              <!-- 편집 도구 줄: 작업본이 있고 쓸 수 있는 세션만(읽기 전용이거나 다른 시나리오를 여는 중이면 없음 — edit.editable). 새 스텝 ▾ 은 패널에 새 스텝 초안을 연다. -->
              <StepToolbar v-if="edit.editable" @new="edit.startNew" />
              <button data-testid="se-expand" class="shrink-0 text-xs px-2 h-7 rounded-lg bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300" @click="store.expanded = !store.expanded">{{ store.expanded ? '⤡ 줄이기' : '⤢ 넓게' }}</button>
            </div>
            <div class="flex-1 min-h-0">
              <StepTable v-if="store.view === 'table'" />
              <StepFlow v-else />
            </div>
          </section>
        </div>
        <SplitGutter direction="v" testid="se-gutter-r" @start="startDrag('rw', $event, -1, 'x')" @reset="reset('rw')" />
        <!-- 오른쪽: 쓸 수 있는 세션은 편집 패널(여러 줄이면 묶음 칸), 읽기 전용·여는 중은 P1 상세 -->
        <section :class="card" class="min-h-0 overflow-hidden">
          <MultiSelection v-if="edit.editable && edit.selection.uids.length > 1" />
          <StepPanel v-else-if="edit.editable" />
          <StepDetail v-else />
        </section>
      </div>
    </template>
    <LoadDialog v-model="loadOpen" @open="(target) => { loadOpen = false; openGuarded(target) }" />
    <EditDialogs v-if="edit.editable" />
  </div>
</template>

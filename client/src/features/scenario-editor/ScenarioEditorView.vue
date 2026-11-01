<script setup>
import { ref, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useEditorStore } from './stores/editorStore'
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

defineOptions({ name: 'ScenarioEditorView' })
const store = useEditorStore()
const route = useRoute()
const router = useRouter()
const { sizes, startDrag, reset } = useLayoutSizes()
const loadOpen = ref(false)

onMounted(async () => {
  await store.init()
  const q = route.query
  if (!store.meError && q.p && q.m && q.n) store.openScenario({ process: String(q.p), model: String(q.m), name: String(q.n), crtime: String(q.v || 'current') })
})

watch(() => store.skeleton, (sk) => {
  if (!sk) return
  router.replace({ query: { p: sk.process, m: sk.model, n: sk.name, v: sk.version.isCurrent ? 'current' : String(sk.version.crtime) } })
})

const retry = () => store.openError && store.openScenario(store.openError.target)
const card = 'bg-white dark:bg-dark-card rounded-lg border border-gray-200 dark:border-dark-border'
</script>

<template>
  <div class="h-full flex flex-col min-h-0" style="height: calc(100vh - 144px)" data-testid="se-root">
    <StatePanel v-if="store.meError" kind="unregistered" :message="store.meError.message" />
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
            <div class="flex items-center justify-between px-3 h-10 border-b border-gray-200 dark:border-dark-border shrink-0">
              <div class="flex gap-1 bg-gray-100 dark:bg-dark-bg p-1 rounded-lg text-xs">
                <button data-testid="se-tab-table" class="px-3 py-1 rounded-md" :class="store.view === 'table' ? 'bg-white dark:bg-dark-card text-primary-700 dark:text-primary-300 font-semibold shadow-sm' : 'text-gray-500'" @click="store.view = 'table'">표</button>
                <button data-testid="se-tab-flow" class="px-3 py-1 rounded-md" :class="store.view === 'flow' ? 'bg-white dark:bg-dark-card text-primary-700 dark:text-primary-300 font-semibold shadow-sm' : 'text-gray-500'" @click="store.view = 'flow'">순서도</button>
              </div>
              <button data-testid="se-expand" class="text-xs px-2 h-7 rounded-lg bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300" @click="store.expanded = !store.expanded">{{ store.expanded ? '⤡ 줄이기' : '⤢ 넓게' }}</button>
            </div>
            <div class="flex-1 min-h-0">
              <StepTable v-if="store.view === 'table'" />
              <StepFlow v-else />
            </div>
          </section>
        </div>
        <SplitGutter direction="v" testid="se-gutter-r" @start="startDrag('rw', $event, -1, 'x')" @reset="reset('rw')" />
        <!-- 오른쪽 -->
        <section :class="card" class="min-h-0 overflow-hidden">
          <StepDetail />
        </section>
      </div>
    </template>
    <LoadDialog v-model="loadOpen" @open="(target) => { loadOpen = false; store.openScenario(target) }" />
  </div>
</template>

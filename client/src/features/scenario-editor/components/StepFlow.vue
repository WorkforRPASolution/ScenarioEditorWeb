<script setup>
import { computed, watch, nextTick } from 'vue'
import { VueFlow, useVueFlow, Handle, Position } from '@vue-flow/core'
import { MiniMap } from '@vue-flow/minimap'
import { Controls } from '@vue-flow/controls'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'
import '@vue-flow/minimap/dist/style.css'
import { useEditorStore } from '../stores/editorStore'
import { layoutFlow, FLOW } from '../layoutFlow'
import { actionLabel, conditionLabel } from '../format'
import { t } from '../messages'
import '../pills.css'

defineOptions({ name: 'StepFlow' })
const store = useEditorStore()
const graph = computed(() => layoutFlow(store.steps))
const { setCenter, onInit } = useVueFlow('se-flow')

// 선택한 카드를 가운데로(확대 1). 위치는 배치 결과에서 읽는다 — Vue Flow 내부 상태가 새 노드를 받기 전에도 맞다.
const centerOn = (uid, duration = 300) => {
  const n = uid && graph.value.nodes.find((x) => x.id === uid && x.type === 'step')
  if (n) setCenter(n.position.x + FLOW.CW / 2, n.position.y + FLOW.CH / 2 + 40, { zoom: 1, duration })
}

// 표 탭에서 고른 뒤 순서도 탭으로 오면 이 컴포넌트가 새로 만들어진다: 처음 그릴 때 선택한 카드로 간다.
onInit(() => centerOn(store.selectedUid, 0))

// 선택이 바뀌거나 다른 시나리오가 열리면(선택 uid 가 그대로여도) 선택한 카드로 간다.
// 순서도 안에서 카드를 눌러 고른 경우는 이미 눈앞에 있으니 보던 위치·확대를 그대로 둔다.
let clickedUid = null
watch([() => store.skeleton, () => store.selectedUid], async ([skeleton, uid], [prevSkeleton]) => {
  const fromFlow = skeleton === prevSkeleton && uid === clickedUid
  clickedUid = null
  if (fromFlow) return
  await nextTick()
  centerOn(uid)
})
const onNodeClick = ({ node }) => {
  if (node.type !== 'step') return
  if (node.id !== store.selectedUid) clickedUid = node.id
  store.select(node.id)
}
// 다음 카드와의 간격 안에 놓이는 칩(capped)만 폭을 묶고 말줄임, 나머지는 라벨 전체가 보이게 자란다. 아래 칩은 카드 폭 상자 안 가운데.
const chipStyle = (d) => (d.capped
  ? { width: `${FLOW.CHIP_W}px`, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
  : { minWidth: `${FLOW.CHIP_W}px`, textAlign: 'center', whiteSpace: 'nowrap' })
const chipBoxStyle = (d) => (d.branch === 'onFalse' ? { display: 'flex', justifyContent: 'center', width: `${FLOW.CW}px` } : { display: 'flex' })
const level = (s) => (s.notes.some((n) => n.level === 'warning') ? 'warning' : s.notes.length ? 'info' : '')
</script>

<template>
  <div class="h-full" data-testid="se-flow">
    <div v-if="!store.steps.length" class="h-full flex items-center justify-center text-sm text-gray-400">{{ t('SEW_UI_NO_STEPS') }}</div>
    <VueFlow v-else id="se-flow" :nodes="graph.nodes" :edges="graph.edges" :nodes-draggable="false" :nodes-connectable="false" :zoom-on-double-click="false"
      :min-zoom="0.1" :max-zoom="2" fit-view-on-init @node-click="onNodeClick">
      <template #node-step="{ id, data }">
        <div :data-testid="`se-flow-node-${data.step.no}`" class="rounded-lg bg-white dark:bg-dark-card shadow-sm px-2.5 py-1.5 flex flex-col justify-between"
          :class="[level(data.step) === 'warning' ? 'border-2 border-dashed border-amber-400' : 'border border-gray-300 dark:border-dark-border', id === store.selectedUid ? 'ring-2 ring-primary-500' : '']"
          :style="{ width: `${FLOW.CW}px`, height: `${FLOW.CH}px` }">
          <Handle id="l" type="target" :position="Position.Left" class="!opacity-0" />
          <Handle id="bt" type="target" :position="Position.Bottom" class="!opacity-0" style="left: 25%" />
          <Handle id="r" type="source" :position="Position.Right" class="!opacity-0" />
          <Handle id="b" type="source" :position="Position.Bottom" class="!opacity-0" style="left: 70%" />
          <div class="flex items-center gap-1.5 text-[11px]">
            <span class="w-5 h-5 rounded bg-primary-500 text-white font-bold flex items-center justify-center">{{ data.step.no }}</span>
            <b class="text-gray-800 dark:text-gray-100">{{ conditionLabel(data.step.condition.kind) }}</b>
            <span class="text-gray-400">→</span>
            <span class="text-gray-600 dark:text-gray-300 truncate">{{ actionLabel(data.step.action.typeName) }}</span>
            <span v-if="level(data.step)" class="ml-auto" :class="level(data.step) === 'warning' ? 'text-amber-500' : 'text-gray-400'">{{ level(data.step) === 'warning' ? '⚠' : 'ⓘ' }}</span>
          </div>
          <div class="text-[11px] text-gray-600 dark:text-gray-300 truncate">{{ data.step.descriptionToEmail }}</div>
        </div>
      </template>
      <template #node-chip="{ data }">
        <div :style="chipBoxStyle(data)">
          <div class="se-pill" :class="`se-pill-${data.kind}`" :title="data.label" :style="chipStyle(data)">
            <Handle id="l" type="target" :position="Position.Left" class="!opacity-0" />
            <Handle id="t" type="target" :position="Position.Top" class="!opacity-0" />
            {{ data.label }}
          </div>
        </div>
      </template>
      <MiniMap pannable zoomable />
      <Controls :show-interactive="false" />
    </VueFlow>
  </div>
</template>

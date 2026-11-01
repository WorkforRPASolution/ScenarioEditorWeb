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
const { setCenter, findNode } = useVueFlow('se-flow')

watch(() => store.selectedUid, async (uid) => {
  await nextTick()
  const n = uid && findNode(uid)
  if (n) setCenter(n.position.x + FLOW.CW / 2, n.position.y + FLOW.CH / 2 + 40, { zoom: 1, duration: 300 })
})
const onNodeClick = ({ node }) => { if (node.type === 'step') store.select(node.id) }
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
        <div class="se-pill" :class="`se-pill-${data.kind}`" :style="{ minWidth: `${FLOW.CHIP_W}px`, textAlign: 'center' }">
          <Handle id="l" type="target" :position="Position.Left" class="!opacity-0" />
          <Handle id="t" type="target" :position="Position.Top" class="!opacity-0" />
          {{ data.label }}
        </div>
      </template>
      <MiniMap pannable zoomable />
      <Controls :show-interactive="false" />
    </VueFlow>
  </div>
</template>

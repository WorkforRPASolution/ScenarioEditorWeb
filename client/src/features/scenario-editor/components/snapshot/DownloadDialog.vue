<script setup>
// 스냅샷 받기 진행 창(P3 설계 §4.6) — 받는 동안 "n / 전체" 와 [취소], 끝났는데 못 받은 것이 있으면 그 목록(시각·이유)과 [닫기].
// 모두 받았으면 창 없이 끝난다(저장소가 알림 줄에 알린다). 상태는 받기 저장소가 갖는다.
import { computed, onMounted, onBeforeUnmount } from 'vue'
import { useSnapshotDownloadStore } from '../../stores/snapshotDownloadStore'
import { t } from '../../messages'
import ModalShell from '../ModalShell.vue'
import './snapshot.css'

defineOptions({ name: 'DownloadDialog' })
const dl = useSnapshotDownloadStore()
const job = computed(() => dl.job)
const running = computed(() => job.value.status === 'running')
const percent = computed(() => (job.value.total ? Math.round((job.value.done / job.value.total) * 100) : 0))
const summary = computed(() => {
  const j = job.value
  return j.saved ? t('SEW_SNAP_DL_PARTIAL', { n: j.saved.count, failed: j.failed.length, name: j.saved.name }) : t('SEW_SNAP_DL_NONE', { failed: j.failed.length })
})
// Esc — 받는 중이면 취소, 끝났으면 닫기
function onKey(e) {
  if (e.key !== 'Escape' || job.value.status === 'idle') return
  if (running.value) dl.cancel()
  else dl.close()
}
onMounted(() => document.addEventListener('keydown', onKey))
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
const btn = 'h-8 px-3 rounded-lg text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600'
</script>

<template>
  <ModalShell :model-value="job.status !== 'idle'" :title="t('SEW_SNAP_DL_TITLE')" :width="560" :height="360" :closable="!running" testid="se-download-dialog" @update:model-value="dl.close()">
    <div class="h-full flex flex-col min-h-0 px-5 py-4 gap-3 text-sm text-gray-800 dark:text-gray-100">
      <template v-if="running">
        <p>{{ t('SEW_SNAP_DL_RUNNING') }}</p>
        <p class="text-2xl font-semibold tabular-nums" role="status" data-testid="se-download-progress">{{ t('SEW_SNAP_DL_PROGRESS', { done: job.done, total: job.total }) }}</p>
        <div class="h-2 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
          <div class="h-full bg-primary-500" :style="{ width: `${percent}%` }" data-testid="se-download-bar" />
        </div>
      </template>
      <template v-else>
        <p data-testid="se-download-summary">{{ summary }}</p>
        <ul class="flex-1 min-h-0 overflow-auto rounded-lg border border-gray-200 dark:border-dark-border divide-y divide-gray-100 dark:divide-gray-700 text-xs">
          <li v-for="f in job.failed" :key="f.item.fileName" class="px-3 py-1.5 flex gap-3" :title="f.item.fileName" data-testid="se-download-failed">
            <span class="tabular-nums font-medium shrink-0">{{ f.item.time }}</span>
            <span class="text-gray-600 dark:text-gray-300">{{ f.reason }}</span>
          </li>
        </ul>
      </template>
    </div>
    <template #footer>
      <button v-if="running" type="button" :class="btn" data-testid="se-download-cancel" @click="dl.cancel()">{{ t('SEW_SNAP_DL_CANCEL') }}</button>
      <button v-else type="button" :class="btn" data-testid="se-download-close" @click="dl.close()">{{ t('SEW_SNAP_DL_CLOSE') }}</button>
    </template>
  </ModalShell>
</template>

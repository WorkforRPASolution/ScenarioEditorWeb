<script setup>
// 큰 화면의 모드 탭 — 스텝 그림 | 스냅샷(P3 설계 §4.1). 한쪽 모드의 선택은 다른 쪽에 가도 남는다.
import { useSnapshotStore } from '../../stores/snapshotStore'
import { t } from '../../messages'
import '../panel/panel.css'

defineOptions({ name: 'ViewerModeTabs' })
const snap = useSnapshotStore()
</script>

<template>
  <span class="se-seg shrink-0" role="group" :aria-label="t('SEW_SNAP_MODE_LABEL')">
    <button type="button" :aria-pressed="snap.mode === 'step' ? 'true' : 'false'" data-testid="se-mode-step" @click="snap.showStep()">{{ t('SEW_SNAP_MODE_step') }}</button>
    <button type="button" :aria-pressed="snap.mode === 'snapshot' ? 'true' : 'false'" data-testid="se-mode-snapshot" @click="snap.showSnapshot()">{{ t('SEW_SNAP_MODE_snapshot') }}</button>
  </span>
</template>

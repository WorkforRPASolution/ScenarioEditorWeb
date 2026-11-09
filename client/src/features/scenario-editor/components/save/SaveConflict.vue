<script setup>
// 충돌 확인(설계 §6.5, 목업 renderSaveLive svConflict, 조작판 29·30). 새 판·삭제·운영 속성 변경 — 체크해야 배포가 켜진다.
// 삭제는 체크하면 force 로 다시 검사해 서버 캐시로 다시 만들 수 있는지 안다(Task 2a). 캐시도 없으면 초안만 된다.
import { computed } from 'vue'
import { useSaveFlow } from '../../stores/saveFlow'
import { t } from '../../messages'

defineOptions({ name: 'SaveConflict' })
const flow = useSaveFlow()
// 지금 대상의 검사 결과일 때만(다시 검사하는 동안에도 칸을 남긴다)
const conflict = computed(() => {
  const c = flow.checkedFor
  return c && c.model === flow.target.model && c.name === flow.target.name ? flow.check?.conflict ?? null : null
})
const TEXT = { deleted: 'SEW_SAVE_CONFLICT_DELETED', property: 'SEW_SAVE_CONFLICT_PROPERTY' }
const LABEL = { deleted: 'SEW_SAVE_FORCE_RECREATE', property: 'SEW_SAVE_FORCE_PROPERTY' }
const text = computed(() => {
  const c = conflict.value
  if (!c) return ''
  if (TEXT[c.kind]) return t(TEXT[c.kind])
  return c.by && c.at ? t('SEW_SAVE_CONFLICT_NEW_VERSION', { by: c.by, at: c.at }) : t('SEW_SAVE_CONFLICT_NEW_VERSION_ANON')
})
</script>

<template>
  <div v-if="conflict" class="se-sv-note fa mb-3 mt-0" data-testid="se-save-conflict">
    {{ text }}
    <label><input type="checkbox" :checked="flow.confirm.force" :disabled="flow.stage !== 'form'" data-testid="se-save-force" @change="flow.setForce($event.target.checked)" />
      <span>{{ t(LABEL[conflict.kind] ?? 'SEW_SAVE_FORCE_OVERWRITE') }}</span></label>
    <div v-if="conflict.kind === 'deleted' && flow.confirm.force && flow.checking" class="mt-1.5">{{ t('SEW_SAVE_CHECKS_RUNNING') }}</div>
    <div v-else-if="conflict.kind === 'deleted' && flow.recreateNoCache" class="mt-1.5 font-semibold">{{ t('SEW_SAVE_RECREATE_NO_CACHE') }}</div>
  </div>
</template>

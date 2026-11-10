<script setup>
// 충돌 확인(설계 §6.5, 목업 renderSaveLive svConflict, 조작판 29·30). 새 판·삭제·운영 속성 변경 — 체크해야 배포가 켜진다.
// 삭제는 체크하면 force 로 다시 검사해 서버 캐시로 다시 만들 수 있는지 안다(Task 2a). 캐시도 없으면 초안만 된다.
import { computed } from 'vue'
import { useSaveFlow, overwriteDiff } from '../../stores/saveFlow'
import { propertyDiffs } from '../../editor/propertyView'
import { t } from '../../messages'
import ChangeText from '../ChangeText.vue'

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
// 운영 속성 충돌: 배포하면 바뀌는 값(서버 conflict.diff — 지금 서버 값 → 이 화면 값, 전체 키). 운영 속성 창 "바뀐 값" 과 같은 글·순서로 보인다.
// 빈 후속({Name:''})과 없음(null)은 같은 "후속 없음" 이라 줄이 아니다(덮어쓰기 차이와 같다). 차이를 주지 않는 서버면 null(목록·안내 없음).
const diffRows = computed(() => {
  const c = conflict.value
  if (c?.kind !== 'property' || !Array.isArray(c.diff)) return null
  const list = overwriteDiff(c.diff)
  return propertyDiffs(Object.fromEntries(list.map((d) => [d.key, d.from])), Object.fromEntries(list.map((d) => [d.key, d.to])))
})
</script>

<template>
  <div v-if="conflict" class="se-sv-note fa mb-3 mt-0" data-testid="se-save-conflict">
    {{ text }}
    <template v-if="diffRows">
      <div v-if="!diffRows.length" class="mt-1.5">{{ t('SEW_SAVE_CONFLICT_PROPERTY_SAME') }}</div>
      <template v-else>
        <div class="mt-1.5 font-medium">{{ t('SEW_SAVE_CONFLICT_PROPERTY_DIFF') }}</div>
        <ul><li v-for="d in diffRows" :key="d.key" data-testid="se-save-conflict-diff">{{ `${d.label} ` }}<ChangeText :before="d.from" :after="d.to" /></li></ul>
        <div class="mt-1.5">{{ t('SEW_SAVE_CONFLICT_PROPERTY_KEEP') }}</div>
      </template>
    </template>
    <label><input type="checkbox" :checked="flow.confirm.force" :disabled="flow.stage !== 'form'" data-testid="se-save-force" @change="flow.setForce($event.target.checked)" />
      <span>{{ t(LABEL[conflict.kind] ?? 'SEW_SAVE_FORCE_OVERWRITE') }}</span></label>
    <div v-if="conflict.kind === 'deleted' && flow.confirm.force && flow.checking" class="mt-1.5">{{ t('SEW_SAVE_CHECKS_RUNNING') }}</div>
    <div v-else-if="conflict.kind === 'deleted' && flow.recreateNoCache" class="mt-1.5 font-semibold">{{ t('SEW_SAVE_RECREATE_NO_CACHE') }}</div>
  </div>
</template>

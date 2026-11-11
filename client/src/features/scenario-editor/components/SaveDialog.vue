<script setup>
// 저장 창(P2-D Task 2, 목업 saveHtml, 조작판 20~39). 흐름·서버 요청은 stores/saveFlow, 여기는 단계별 배치와 창 밖으로 가는 길만.
// 바 칸(메일 제목·제한 시간)·운영 속성 창은 바(ScenarioBar)가 가진다 — 그쪽으로 가는 줄을 누르면 창을 닫고 알린다(bar·property).
import { computed, watch, onBeforeUnmount } from 'vue'
import { useSaveFlow } from '../stores/saveFlow'
import { useEditStore } from '../stores/editStore'
import { useEditorStore } from '../stores/editorStore'
import { t } from '../messages'
import { formatCrtime } from '../format'
import ModalShell from './ModalShell.vue'
import SaveTarget from './save/SaveTarget.vue'
import SaveConflict from './save/SaveConflict.vue'
import SaveChecks from './save/SaveChecks.vue'
import SaveChanges from './save/SaveChanges.vue'
import SaveCards from './save/SaveCards.vue'
import SaveConfirm from './save/SaveConfirm.vue'
import SaveProgress from './save/SaveProgress.vue'
import SaveResult from './save/SaveResult.vue'
import './save/save.css'

defineOptions({ name: 'SaveDialog' })
const emit = defineEmits(['bar', 'property', 'windows'])
const flow = useSaveFlow()
const edit = useEditStore()
const editor = useEditorStore()

const formish = computed(() => flow.stage === 'form' || flow.stage === 'confirm')
const source = computed(() => edit.session?.source ?? null)
const openId = computed(() => { const s = source.value; return s ? `${s.process}-${s.model}-${s.name}` : editor.skeleton?.id ?? '' })
const tag = computed(() => (source.value ? t('SEW_SAVE_TAG_CURRENT', { crtime: formatCrtime(source.value.crtime) }) : t('SEW_SAVE_TAG_FIRST')))

// 검사 줄·바뀐 곳을 누름: 스텝이면 창을 닫고 그 스텝을 고르고, 바 칸·운영 속성이면 창을 닫고 바에 알린다(입력한 대상은 남긴다).
function go(goal) {
  if (!goal) return
  if (goal.kind === 'step') flow.jump(goal.uid)
  else if (goal.kind === 'form') flow.requestFocus(goal.field)
  else if (goal.kind === 'windows') { if (flow.close({ keep: true })) emit('windows', goal.which) } // 전처리 설정 창(P2-F)
  else if (flow.close({ keep: true })) emit(goal.kind === 'bar' ? 'bar' : 'property', goal.field)
}

// 배포 중에는 떠나기 확인(새로고침·창 닫기). 결과 모름은 세션 저장소의 requestId 로 이어 확인한다.
const onBeforeUnload = (e) => { e.preventDefault(); e.returnValue = '' }
watch(() => flow.stage === 'run', (on) => {
  if (on) window.addEventListener('beforeunload', onBeforeUnload)
  else window.removeEventListener('beforeunload', onBeforeUnload)
})
onBeforeUnmount(() => window.removeEventListener('beforeunload', onBeforeUnload))
</script>

<template>
  <ModalShell :model-value="!!flow.stage" :title="t('SEW_SAVE_TITLE')" :width="960" :height="680" :closable="flow.closable" testid="se-save-dialog"
    @update:model-value="(v) => { if (!v) flow.close() }">
    <div v-if="formish" class="h-full flex flex-col">
      <div class="se-sv-sub">
        <span class="mono">{{ openId }}</span>
        <span class="se-sv-tag" :class="{ 'se-sv-tag-am': !source }">{{ tag }}</span>
      </div>
      <div class="flex-1 min-h-0 overflow-auto grid grid-cols-2">
        <div class="se-sv-col"><SaveTarget @go="go" /></div>
        <div class="se-sv-col">
          <SaveConflict />
          <SaveChecks @go="go" />
          <SaveChanges @go="go" />
        </div>
      </div>
      <p v-if="flow.notice" class="se-sv-notice" :class="{ error: flow.notice.tone === 'error' }" data-testid="se-save-notice">{{ t(flow.notice.key, flow.notice.params ?? {}) }}</p>
      <SaveConfirm v-if="flow.stage === 'confirm'" />
      <SaveCards v-else />
    </div>
    <SaveProgress v-else-if="flow.stage === 'run'" />
    <SaveResult v-else-if="flow.stage" />
  </ModalShell>
</template>

<script setup>
// 위쪽 바의 [시나리오 지우기…](2026-11-10 사용자 결정): 불러오기 창을 거치지 않고 열린 시나리오를 지운다.
// 확인 창은 불러오기 창의 것(load/LoadDelete — 이름 따라 치기·내 초안도 함께 지우기)을 그대로 쓴다.
// 열 때 버전 수와 내 초안을 읽는다 — 읽지 못해도 창은 뜬다(버전 수 모름, 초안 체크 칸 없음).
// 지운 뒤 편집 화면은 불러오기 창에서 지웠을 때와 같이 읽기 전용(지워짐)이 된다.
import { ref, computed, watch } from 'vue'
import { useEditorStore } from '../stores/editorStore'
import { useEditStore } from '../stores/editStore'
import { scenarioEditorApi as api } from '../api'
import { t } from '../messages'
import LoadDelete from './load/LoadDelete.vue'
import BaseToast from '@/shared/components/BaseToast.vue'
import { useToast } from '@/shared/composables/useToast'

defineOptions({ name: 'ScenarioDeleteDialog' })
const props = defineProps({ modelValue: Boolean })
const emit = defineEmits(['update:modelValue'])
const store = useEditorStore()
const edit = useEditStore()

const ready = ref(null) // { process, model, name, versionCount, draft }
// 결과 알림은 이 부품의 것으로 보인다 — 편집 화면의 알림(EditDialogs)은 편집할 수 있을 때만 있어, 지워져 읽기 전용이 되면 사라진다
const { toast, showToast } = useToast()
const close = () => emit('update:modelValue', false)

watch(() => props.modelValue, async (open) => {
  ready.value = null
  if (!open) return
  const sk = store.skeleton
  if (!sk) { close(); return }
  const key = { process: sk.process, model: sk.model, name: sk.name }
  const [versions, drafts] = await Promise.allSettled([api.versions(key.process, key.model, key.name), api.listDrafts(key.process, key.model)])
  if (!props.modelValue) return // 읽는 사이 닫았다
  const list = (r) => (r.status === 'fulfilled' && Array.isArray(r.value?.data?.data) ? r.value.data.data : [])
  ready.value = { ...key, versionCount: list(versions).length, draft: list(drafts).find((d) => d.name === key.name) ?? null }
})

const row = computed(() => ({ name: ready.value.name, isEnabled: edit.session?.working?.property?.IsEnabled ?? store.skeleton?.property?.IsEnabled ?? null, draft: ready.value.draft }))
const eqpCount = computed(() => store.scopes?.processes?.find((p) => p.process === ready.value.process)?.models?.find((m) => m.model === ready.value.model)?.eqpCount ?? 0)
const openInfo = computed(() => ({ changes: edit.unsavedCount }))

// draftDeleted: 내 초안도 함께 지우라고 했을 때만 true(지움)·false(못 지움), 아니면 null
function onDeleted({ draftDeleted = null } = {}) {
  const draft = ready.value.draft
  edit.markDeleted()
  if (draftDeleted && draft) edit.forgetDraft(draft.draftId)
  if (draftDeleted === false) showToast('info', t('SEW_LOAD_DELETED_DRAFT_KEPT'))
  else showToast('success', t(draftDeleted ? 'SEW_LOAD_DELETED_WITH_DRAFT_OPEN' : 'SEW_LOAD_DELETED_OPEN'))
  close()
}
// 결과 모름·이미 없음 뒤 [목록 다시 읽기]: 다시 보내지 않고 목록에 남았는지만 본다
async function onRelist() {
  const { process, model, name } = ready.value
  let rows = null
  try { rows = (await api.list(process, model))?.data?.data ?? null } catch { rows = null }
  if (Array.isArray(rows) && !rows.some((r) => r.name === name)) { edit.markDeleted(); showToast('success', t('SEW_LOAD_RELISTED_GONE', { name })) } else showToast('info', t('SEW_LOAD_RELISTED_KEPT', { name }))
  close()
}
</script>

<template>
  <Teleport to="body">
    <div v-if="modelValue && ready" class="fixed inset-0 z-50" data-testid="se-delete-dialog">
      <LoadDelete :process="ready.process" :model="ready.model" :row="row" :version-count="ready.versionCount" :eqp-count="eqpCount" :open="openInfo"
        @deleted="onDeleted" @relist="onRelist" @close="close" />
    </div>
    <BaseToast :toast="toast" />
  </Teleport>
</template>

<script setup>
// 편집 확인 창과 알림 줄(목업 dlgHtml·toast). 이 task 는 삭제 막힘 목록(조작판 14 delblock)과 설비 상태 붙여넣기 알림.
// 적용 안 한 변경 확인(guard)은 Task 6 이 단다.
import { computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useEditStore } from '../stores/editStore'
import { t } from '../messages'
import '../pills.css'

defineOptions({ name: 'EditDialogs' })
const edit = useEditStore()
const TOAST_MS = 5200

const dialog = computed(() => edit.dialog)
const steps = computed(() => edit.session?.working?.steps ?? [])
const noOf = (uid) => steps.value.findIndex((s) => s.uid === uid) + 1
const descOf = (uid) => steps.value.find((s) => s.uid === uid)?.descriptionToEmail ?? ''
const delTitle = computed(() => (dialog.value?.kind === 'delblock'
  ? t('SEW_EDIT_DELBLOCK_TITLE', { nos: dialog.value.targets.map(noOf).sort((a, b) => a - b).map((no) => t('SEW_CMD_TARGET_STEP', { no })).join('·') }) : ''))

const close = () => { edit.dialog = null }
// 목록의 스텝으로 가서 갈 곳을 고치게 한다(목업 goref).
function goRef(uid) { close(); edit.requestSelect(uid) }
function pasteAnyway() {
  const where = dialog.value.where
  close()
  edit.pasteClip(where, { confirmed: true })
}

let timer = null
watch(() => edit.toast, (v) => {
  clearTimeout(timer)
  if (v) timer = setTimeout(() => { if (edit.toast === v) edit.toast = null }, TOAST_MS)
})
function undoFromToast() { edit.undoCommand() }

function onKey(e) { if (e.key === 'Escape' && (dialog.value?.kind === 'delblock' || dialog.value?.kind === 'pasteWarn')) close() }
onMounted(() => document.addEventListener('keydown', onKey))
onBeforeUnmount(() => { document.removeEventListener('keydown', onKey); clearTimeout(timer) })

const dim = 'fixed inset-0 z-50 bg-black/40 flex items-center justify-center'
const box = 'w-[470px] max-w-[calc(100vw-40px)] bg-white dark:bg-dark-card border border-gray-200 dark:border-dark-border rounded-xl shadow-2xl'
const btnS = 'h-8 px-3 rounded-lg text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600'
const btnP = 'h-8 px-3 rounded-lg text-sm bg-primary-500 hover:bg-primary-600 text-white font-medium'
</script>

<template>
  <Teleport to="body">
    <div v-if="dialog?.kind === 'delblock'" :class="dim" @click.self="close">
      <div :class="box" role="alertdialog" aria-modal="true" data-testid="se-delblock">
        <h3 class="px-[18px] pt-3.5 text-[15px] font-semibold text-gray-900 dark:text-white">{{ delTitle }}</h3>
        <p class="mx-[18px] mt-1.5 text-[13px] text-gray-500 dark:text-gray-400">{{ t('SEW_EDIT_DELBLOCK_BODY') }}</p>
        <div class="mx-[18px] mt-3 border border-gray-200 dark:border-dark-border rounded-lg overflow-hidden">
          <button v-for="r in dialog.refs" :key="`${r.uid}:${r.key}`" type="button" :data-ref="r.uid"
            class="w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-xs border-b last:border-b-0 border-gray-200 dark:border-dark-border text-gray-800 dark:text-gray-100 hover:bg-primary-50 dark:hover:bg-primary-900/30"
            @click="goRef(r.uid)">
            <b class="tabular-nums font-semibold">{{ noOf(r.uid) }}</b>
            <span class="flex-1 min-w-0 truncate">{{ descOf(r.uid) }}</span>
            <span class="shrink-0 text-gray-500 dark:text-gray-400">{{ r.key === 'onTrue' ? t('SEW_EDIT_ON_TRUE') : t('SEW_EDIT_ON_FALSE') }}</span>
            <span class="se-pill se-pill-step shrink-0">→{{ noOf(r.to) }}</span>
          </button>
        </div>
        <div class="flex justify-end gap-1.5 px-[18px] py-3.5"><button type="button" :class="btnS" data-testid="se-delblock-close" @click="close">{{ t('SEW_EDIT_CLOSE') }}</button></div>
      </div>
    </div>
    <div v-else-if="dialog?.kind === 'pasteWarn'" :class="dim" @click.self="close">
      <div :class="box" role="alertdialog" aria-modal="true" data-testid="se-paste-warn">
        <h3 class="px-[18px] pt-3.5 text-[15px] font-semibold text-gray-900 dark:text-white">{{ t('SEW_EDIT_PASTE_WARN_TITLE') }}</h3>
        <p class="mx-[18px] mt-1.5 text-[13px] text-gray-500 dark:text-gray-400">{{ t('SEW_CMD_EQP_STATE_WARN', { n: dialog.n }) }}</p>
        <div class="flex justify-end gap-1.5 px-[18px] py-3.5">
          <button type="button" :class="btnS" data-testid="se-paste-warn-cancel" @click="close">{{ t('SEW_EDIT_CANCEL') }}</button>
          <button type="button" :class="btnP" data-testid="se-paste-warn-ok" @click="pasteAnyway">{{ t('SEW_EDIT_PASTE_WARN_GO') }}</button>
        </div>
      </div>
    </div>
    <div v-if="edit.toast" role="status" data-testid="se-toast"
      class="fixed left-1/2 bottom-11 -translate-x-1/2 z-[60] max-w-[680px] flex items-center gap-3 px-3.5 py-2 rounded-lg shadow-xl text-[13px] bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900">
      <span>{{ edit.toast.text }}</span>
      <button v-if="edit.toast.undoable" type="button" class="underline font-medium text-primary-300 dark:text-primary-700" @click="undoFromToast">{{ t('SEW_EDIT_UNDO') }}</button>
    </div>
  </Teleport>
</template>

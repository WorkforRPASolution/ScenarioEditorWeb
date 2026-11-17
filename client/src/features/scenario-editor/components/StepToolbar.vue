<script setup>
// 표 위 도구 줄(목업 renderTable·menuHtml, 조작판 13 multi·20 empty). 읽기 전용이면 그리지 않는다.
// [새 스텝 ▾] 은 스냅샷 화면의 [새 스텝] 과 같은 메뉴(NewStepMenu)를 연다(2026-11-17) — 줄·꺼지는 조건·결과가 두 곳에서 같다.
import { ref, computed, onBeforeUnmount } from 'vue'
import { useEditStore } from '../stores/editStore'
import { isContiguous, STEP_MAX } from '../editor/commands'
import { t } from '../messages'
import NewStepMenu from './NewStepMenu.vue'

defineOptions({ name: 'StepToolbar' })
const edit = useEditStore()

const steps = computed(() => edit.session?.working?.steps ?? [])
const noOf = (uid) => steps.value.findIndex((s) => s.uid === uid) + 1
const sel = computed(() => edit.selection.uids.filter((u) => noOf(u) > 0))
const nos = computed(() => sel.value.map(noOf).sort((a, b) => a - b))
const contiguous = computed(() => sel.value.length > 0 && isContiguous(edit.session.working, sel.value))
const canUp = computed(() => contiguous.value && nos.value[0] > 1)
const canDown = computed(() => contiguous.value && nos.value[nos.value.length - 1] < steps.value.length)
const scatteredTitle = computed(() => (sel.value.length > 1 && !contiguous.value ? t('SEW_CMD_REFUSED_NOT_CONTIGUOUS') : undefined))
const anchorNo = computed(() => { const a = edit.selection.anchor; return a ? noOf(a) || null : null })
const clipCount = computed(() => edit.clip?.uids.length ?? 0)

// 펼침 메뉴(새 스텝 ▾ · 붙여넣기 ▾): 표 칸 위에 떠야 해서 body 로 옮기고 버튼 아래에 고정한다.
const MENU_W = { new: 340, paste: 262 }
const menu = ref(null)
function toggleMenu(kind, e) {
  if (menu.value?.kind === kind) { closeMenu(); return }
  const r = e.currentTarget.getBoundingClientRect()
  const vw = window.innerWidth || 1280
  menu.value = { kind, x: Math.min(Math.max(r.left, 8), Math.max(8, vw - MENU_W[kind] - 8)), y: r.bottom + 4 }
  document.addEventListener('mousedown', onDocDown, true)
  document.addEventListener('keydown', onDocKey)
}
function closeMenu() {
  menu.value = null
  document.removeEventListener('mousedown', onDocDown, true)
  document.removeEventListener('keydown', onDocKey)
}
const menuEl = ref(null)
function onDocDown(e) {
  if (menuEl.value?.contains(e.target) || e.target?.closest?.('[data-menu-toggle]')) return
  closeMenu()
}
function onDocKey(e) { if (e.key === 'Escape') closeMenu() }
onBeforeUnmount(closeMenu)

function paste(where) { closeMenu(); edit.pasteClip(where) }

const tool = 'h-7 min-w-7 px-2 rounded-md inline-flex items-center gap-1 whitespace-nowrap text-xs text-gray-700 dark:text-gray-300 hover:enabled:bg-gray-100 dark:hover:enabled:bg-gray-700 disabled:text-gray-400 disabled:opacity-70 dark:disabled:text-gray-600'
const sep = 'w-px h-4 bg-gray-200 dark:bg-dark-border mx-1 shrink-0'
const item = 'w-full block text-left px-2 py-1.5 rounded-md text-[13px] text-gray-800 dark:text-gray-100 hover:enabled:bg-primary-50 dark:hover:enabled:bg-primary-900/30 disabled:opacity-45'
const hint = 'block text-[11px] leading-snug text-gray-500 dark:text-gray-400'
</script>

<template>
  <div v-if="edit.editable" class="flex items-center gap-0.5 min-w-0 flex-1 overflow-hidden" data-testid="se-toolbar">
    <div :class="sep" />
    <button type="button" data-testid="se-tool-new" data-menu-toggle aria-haspopup="true" :aria-expanded="menu?.kind === 'new' ? 'true' : 'false'"
      class="h-7 px-2 rounded-md inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium bg-primary-500 hover:bg-primary-600 text-white" @click="toggleMenu('new', $event)">
      ＋ {{ t('SEW_EDIT_NEW_STEP') }}
      <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M1.5 3.5L5 7l3.5-3.5" /></svg>
    </button>
    <button type="button" data-testid="se-tool-copy" :class="tool" :disabled="!contiguous" :title="scatteredTitle ?? 'Ctrl+C'" @click="edit.copySelection(false)">{{ t('SEW_EDIT_COPY') }}</button>
    <button type="button" data-testid="se-tool-cut" :class="tool" :disabled="!contiguous" :title="scatteredTitle ?? 'Ctrl+X'" @click="edit.copySelection(true)">{{ t('SEW_EDIT_CUT') }}</button>
    <button type="button" data-testid="se-tool-paste" data-menu-toggle aria-haspopup="true" :class="tool" :disabled="!edit.clip" title="Ctrl+V" @click="toggleMenu('paste', $event)">
      {{ t('SEW_EDIT_PASTE') }}<span v-if="clipCount" class="text-gray-400">{{ t('SEW_EDIT_PASTE_COUNT', { n: clipCount }) }}</span>
    </button>
    <div :class="sep" />
    <button type="button" data-testid="se-tool-up" :class="tool" :disabled="!canUp" :aria-label="t('SEW_EDIT_UP')" :title="scatteredTitle ?? t('SEW_EDIT_UP_TITLE')" @click="edit.moveSelected(-1)">
      <svg width="13" height="13" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M6 10.5v-9M2 5l4-3.5L10 5" /></svg>
    </button>
    <button type="button" data-testid="se-tool-down" :class="tool" :disabled="!canDown" :aria-label="t('SEW_EDIT_DOWN')" :title="scatteredTitle ?? t('SEW_EDIT_DOWN_TITLE')" @click="edit.moveSelected(1)">
      <svg width="13" height="13" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M6 1.5v9M2 7l4 3.5L10 7" /></svg>
    </button>
    <button type="button" data-testid="se-tool-delete" :class="tool" :disabled="!sel.length" title="Delete" @click="edit.deleteSelection()">{{ t('SEW_EDIT_DELETE') }}</button>
    <div :class="sep" />
    <button type="button" data-testid="se-tool-undo" :class="tool" :disabled="!edit.undo.length" title="Ctrl+Z" @click="edit.undoCommand()">
      <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M5 2L2 5l3 3" /><path d="M2 5h6.5a3.5 3.5 0 0 1 0 7H5" /></svg>{{ t('SEW_EDIT_UNDO') }}
    </button>
    <button type="button" data-testid="se-tool-redo" :class="tool" :disabled="!edit.redo.length" :aria-label="t('SEW_EDIT_REDO')" title="Ctrl+Shift+Z" @click="edit.redoCommand()">
      <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 2l3 3-3 3" /><path d="M12 5H5.5a3.5 3.5 0 0 0 0 7H9" /></svg>
    </button>
    <span v-if="sel.length > 1" class="ml-1 text-xs font-medium text-primary-700 dark:text-primary-300 whitespace-nowrap" data-testid="se-tool-count">{{ t('SEW_EDIT_SELECTED', { n: sel.length }) }}</span>
    <span class="flex-1" />
    <span class="text-xs text-gray-400 whitespace-nowrap tabular-nums mr-2">{{ t('SEW_EDIT_STEP_COUNT', { n: steps.length, max: STEP_MAX }) }}</span>

    <Teleport to="body">
      <div v-if="menu" ref="menuEl" role="menu" data-testid="se-tool-menu"
        class="fixed z-40 max-w-[calc(100vw-16px)] p-1 bg-white dark:bg-dark-card border border-gray-300 dark:border-dark-border rounded-lg shadow-xl"
        :style="{ left: `${menu.x}px`, top: `${menu.y}px`, width: `${MENU_W[menu.kind]}px` }">
        <NewStepMenu v-if="menu.kind === 'new'" @done="closeMenu" />
        <template v-else>
          <template v-if="anchorNo">
            <button type="button" role="menuitem" data-paste="after" :class="item" @click="paste('after')">
              {{ t('SEW_EDIT_PASTE_AFTER', { no: anchorNo }) }}<small :class="hint">{{ t('SEW_EDIT_PASTE_AFTER_HINT') }}</small>
            </button>
            <button type="button" role="menuitem" data-paste="before" :class="item" @click="paste('before')">
              {{ t('SEW_EDIT_PASTE_BEFORE', { no: anchorNo }) }}<small :class="hint">{{ t('SEW_EDIT_PASTE_BEFORE_HINT') }}</small>
            </button>
          </template>
          <button type="button" role="menuitem" data-paste="end" :class="item" @click="paste('end')">{{ t('SEW_EDIT_PASTE_END') }}</button>
        </template>
      </div>
    </Teleport>
  </div>
</template>

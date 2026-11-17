<script setup>
// 새 스텝 메뉴(2026-11-17 사내 요청) — 표 위 [새 스텝] 과 스냅샷 화면 [새 스텝] 이 함께 쓴다(두 곳의 줄·꺼지는 조건·결과가 같다).
// 화면마다 한 줄이고 오른쪽에서 종류([이미지]·[OCR])를 누른다: 지금 스냅샷 · 고른 스텝의 화면 · 그림 파일. 맨 아래는 조건 없는 스텝.
// 줄마다 어느 화면인지 작은 그림과 글로 보이고, 꺼진 줄에는 까닭이 적힌다. 누르면 done 을 알리고(여는 쪽이 메뉴를 닫는다) 새 스텝을 시작한다.
// 여기는 메뉴의 안쪽만 그린다 — 자리·바깥 누르기·Esc 는 여는 쪽(StepToolbar·SnapshotViewer)이 맡는다.
import { ref, computed } from 'vue'
import { useEditStore } from '../stores/editStore'
import { useSnapshotStore } from '../stores/snapshotStore'
import { refUrl } from '../editor/images'
import { pickImageFile } from '../editor/pickFile'
import { t } from '../messages'
import './newStepMenu.css'

defineOptions({ name: 'NewStepMenu' })
const emit = defineEmits(['done'])
const edit = useEditStore()
const snap = useSnapshotStore()

// 작은 그림을 브라우저가 읽지 못한 스냅샷(받았지만 그림이 아니다) — 그 그림으로는 만들지 않는다(DC-038)
const brokenUrl = ref(null)
const snapshotRow = computed(() => {
  const shown = snap.shownImage()
  const item = snap.selected
  const url = shown ? snap.image.url : null
  // 목록에서 고른 줄이 있어야 한다 — 그림만 남아 있고 고른 줄이 없으면 큰 화면도 비어 있다
  const on = !!shown && !!item && brokenUrl.value !== url
  const what = item ? (item.kind === 'tag' ? t(`SEW_SNAP_TAG_${item.tag}`) : t('SEW_SNAP_INFO_CLICK', { x: item.x, y: item.y })) : ''
  return {
    src: 'snapshot', on, label: t('SEW_NEW_SRC_SNAPSHOT'), pic: on ? url : null,
    sub: on ? `${item.time} · ${what}` : t(item ? 'SEW_NEW_SRC_SNAPSHOT_NO_IMAGE' : 'SEW_NEW_SRC_SNAPSHOT_PICK'),
    title: on ? `${snap.eqpId} ${item.date ?? snap.date} ${item.time}` : undefined
  }
})
const stepRow = computed(() => {
  const o = edit.newOrigin
  if (!o) return { src: 'step', on: false, label: t('SEW_NEW_SRC_STEP_ANY'), sub: t('SEW_NEW_SRC_STEP_PICK'), pic: null }
  const label = t('SEW_NEW_SRC_STEP', { no: o.no })
  if (!o.base) return { src: 'step', on: false, label, sub: t('SEW_NEW_SRC_STEP_NO_BASE'), pic: null }
  const step = edit.session.working.steps.find((x) => x.uid === o.uid)
  return {
    src: 'step', on: true, label, sub: step?.descriptionToEmail || t('SEW_NEW_SRC_STEP_SUB'),
    pic: refUrl(o.base, { session: edit.session, uploads: edit.uploads, draftId: edit.draftId })
  }
})
const fileRow = computed(() => ({ src: 'file', on: true, label: t('SEW_NEW_SRC_FILE'), sub: t('SEW_NEW_SRC_FILE_SUB'), pic: null }))
const rows = computed(() => [snapshotRow.value, stepRow.value, fileRow.value])
const KINDS = [
  { kind: 'image', text: 'SEW_NEW_KIND_IMAGE', name: 'SEW_EDIT_NEW_IMAGE', hint: 'SEW_EDIT_NEW_IMAGE_HINT' },
  { kind: 'ocr', text: 'SEW_NEW_KIND_OCR', name: 'SEW_EDIT_NEW_OCR', hint: 'SEW_EDIT_NEW_OCR_HINT' }
]

function pick(kind, src) {
  emit('done')
  if (kind === 'none') edit.startNew('none')
  else if (src === 'snapshot') edit.startNew(kind, { snapshot: snap.shownImage() })
  else if (src === 'step') edit.startNew(kind)
  // 파일 고르기 창은 누른 그 자리에서 연다(브라우저는 사용자 동작 안에서만 창을 연다)
  else pickImageFile().then((file) => { if (file) edit.startNewFromFile(kind, file) })
}
</script>

<template>
  <div class="se-new-menu" data-testid="se-new-menu">
    <div v-for="r in rows" :key="r.src" class="se-new-row" :data-src="r.src" :data-off="r.on ? 'false' : 'true'" :title="r.title">
      <span class="se-new-pic" aria-hidden="true">
        <img v-if="r.pic" :src="r.pic" alt="" draggable="false" @error="r.src === 'snapshot' && (brokenUrl = r.pic)" />
        <svg v-else-if="r.src === 'file'" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M5 2.5h6.5L15 6v11.5H5z" /><path d="M11.5 2.5V6H15" /><path d="M7 14.5l2.2-2.8 1.6 1.6 1-1 1.7 2.2" /></svg>
      </span>
      <span class="se-new-text"><b>{{ r.label }}</b><small>{{ r.sub }}</small></span>
      <span class="se-new-kinds">
        <button v-for="k in KINDS" :key="k.kind" type="button" role="menuitem" :disabled="!r.on" :title="t(k.hint)" :aria-label="`${r.label} — ${t(k.name)}`"
          :data-testid="`se-new-${r.src}-${k.kind}`" @click="pick(k.kind, r.src)">{{ t(k.text) }}{{ r.src === 'file' ? '…' : '' }}</button>
      </span>
    </div>
    <hr />
    <button type="button" role="menuitem" class="se-new-none" data-testid="se-new-none" @click="pick('none')">
      {{ t('SEW_EDIT_NEW_NONE') }}<small>{{ t('SEW_EDIT_NEW_NONE_HINT') }}</small>
    </button>
  </div>
</template>

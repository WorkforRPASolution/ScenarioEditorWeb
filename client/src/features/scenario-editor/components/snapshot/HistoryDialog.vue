<script setup>
// 자동 복구 이력 창(P3 설계 §4.7) — 태그 스냅샷의 txn 으로 받은 이력을 스텝 카드(번호·설명·찾을 그림·그때 화면)로 보인다.
// - 이력 서버의 HTML 은 화면에 들어오지 않는다. 서버가 뽑아 준 글자와 PNG 데이터 주소만 그린다(설명은 글자로만, 그림은 png 데이터 주소일 때만).
// - 열 때마다 다시 받고 닫으면 버린다. 닫은 뒤에 온 답·앞 요청의 늦은 답은 쓰지 않는다.
// - 그림을 누르면 창 안에서 크게 본다. Esc 는 크게 본 것을 먼저 닫는다.
// - 이력이 없거나 이력 서버에 닿지 못해도 이 창만 그 이유를 보인다 — 스냅샷 보기는 그대로다(DC-018).
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { scenarioEditorApi as api } from '../../api'
import { t, errorCode, errorMessage } from '../../messages'
import ModalShell from '../ModalShell.vue'
import '../../pills.css'
import './snapshot.css'

defineOptions({ name: 'HistoryDialog' })
const props = defineProps({
  modelValue: Boolean,
  eqpId: { type: String, default: '' },
  txn: { type: String, default: '' },
  tag: { type: String, default: '' } // start·success·stop·fail·skip — 머리의 태그 알약
})
const emit = defineEmits(['update:modelValue'])

const PNG_DATA = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/
const idle = () => ({ status: 'idle', steps: [], code: null, error: '' })
const state = ref(idle())
const zoom = ref(null) // 크게 보는 그림 { src, label }
let seq = 0

async function load() {
  const own = ++seq
  zoom.value = null
  state.value = { status: 'loading', steps: [], code: null, error: '' }
  try {
    const r = (await api.history(props.eqpId, props.txn)).data.data
    if (own !== seq) return
    state.value = { status: 'ready', steps: Array.isArray(r?.steps) ? r.steps : [], code: null, error: '' }
  } catch (e) {
    if (own !== seq) return
    state.value = { status: 'error', steps: [], code: errorCode(e), error: errorMessage(e) }
  }
}
watch(() => [props.modelValue, props.eqpId, props.txn], ([open]) => {
  if (open) { load(); return }
  seq++ // 받던 것을 버린다
  zoom.value = null
  state.value = idle()
}, { immediate: true })

// 그릴 것만 고른다 — 스텝마다 찾을 그림(ref)·그때 화면(screen) 한 장씩
const imageOf = (step, kind) => {
  const im = Array.isArray(step?.images) ? step.images.find((i) => i?.kind === kind && typeof i.src === 'string' && PNG_DATA.test(i.src)) : null
  return im ? im.src : null
}
const cards = computed(() => state.value.steps.map((s) => ({
  no: Number.isInteger(s?.no) ? s.no : null, text: typeof s?.text === 'string' ? s.text : '', ref: imageOf(s, 'ref'), screen: imageOf(s, 'screen')
})))
const message = computed(() => {
  if (state.value.status === 'loading') return { text: t('SEW_SNAP_HISTORY_LOADING') }
  if (state.value.status === 'error') return { text: state.value.error, retry: state.value.code !== 'HISTORY_NOT_FOUND' }
  if (state.value.status === 'ready' && !cards.value.length) return { text: t('SEW_ERR_HISTORY_NOT_FOUND') }
  return null
})

const close = () => emit('update:modelValue', false)
function onKey(e) {
  if (e.key !== 'Escape' || !props.modelValue) return
  if (zoom.value) zoom.value = null
  else close()
}
onMounted(() => document.addEventListener('keydown', onKey))
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
const btn = 'h-8 px-3 rounded-lg text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600'
</script>

<template>
  <ModalShell :model-value="modelValue" :title="t('SEW_SNAP_HISTORY_TITLE')" :width="900" :height="640" testid="se-history-dialog" @update:model-value="close">
    <div class="relative h-full flex flex-col min-h-0 text-gray-800 dark:text-gray-100">
      <div class="px-5 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-gray-200 dark:border-dark-border shrink-0 text-xs" data-testid="se-history-head">
        <b class="text-sm">{{ eqpId }}</b>
        <span class="tabular-nums text-gray-600 dark:text-gray-300">{{ t('SEW_SNAP_HISTORY_TXN', { txn }) }}</span>
        <span v-if="tag" class="se-pill" :class="`se-snap-tag-${tag}`">{{ t(`SEW_SNAP_TAG_${tag}`) }}</span>
        <span v-if="state.status === 'ready' && cards.length" class="ml-auto tabular-nums text-gray-500 dark:text-gray-400" data-testid="se-history-count">{{ t('SEW_SNAP_HISTORY_STEPS', { n: cards.length }) }}</span>
      </div>
      <div class="flex-1 min-h-0 overflow-auto">
        <div v-if="message" class="h-full flex flex-col items-center justify-center gap-2 px-6 text-center text-sm text-gray-500 dark:text-gray-400">
          <p data-testid="se-history-state">{{ message.text }}</p>
          <button v-if="message.retry" type="button" :class="btn" data-testid="se-history-retry" @click="load()">{{ t('SEW_UI_RETRY') }}</button>
        </div>
        <div v-else class="p-4 flex flex-col gap-3">
          <article v-for="(c, i) in cards" :key="i" class="se-history-card" data-testid="se-history-step">
            <header>
              <span v-if="c.no !== null" class="se-history-no" data-testid="se-history-no">{{ c.no }}</span>
              <span class="min-w-0 flex-1 break-words" data-testid="se-history-text">{{ c.text }}</span>
              <span v-if="c.ref" class="shrink-0 flex items-center gap-1.5 text-[11px] opacity-90">
                {{ t('SEW_SNAP_HISTORY_REF') }}
                <img :src="c.ref" alt="" class="se-history-ref" :title="t('SEW_SNAP_HISTORY_ZOOM_HINT')" draggable="false" data-testid="se-history-ref" @click="zoom = { src: c.ref, label: t('SEW_SNAP_HISTORY_REF') }" />
              </span>
            </header>
            <div v-if="c.screen" class="se-history-screen-box">
              <img :src="c.screen" :alt="t('SEW_SNAP_HISTORY_SCREEN')" :title="t('SEW_SNAP_HISTORY_ZOOM_HINT')" draggable="false" data-testid="se-history-screen" @click="zoom = { src: c.screen, label: t('SEW_SNAP_HISTORY_SCREEN') }" />
            </div>
            <p v-else class="px-3 py-2 text-xs text-gray-400">{{ t('SEW_SNAP_HISTORY_NO_SCREEN') }}</p>
          </article>
        </div>
      </div>
      <!-- 크게 보기 — 창 안을 덮는다. 누르면 닫힌다 -->
      <div v-if="zoom" class="se-history-zoom" :title="t('SEW_SNAP_HISTORY_ZOOM_CLOSE')" data-testid="se-history-zoom" @click="zoom = null">
        <span class="se-history-zoom-label">{{ zoom.label }}</span>
        <img :src="zoom.src" alt="" draggable="false" />
      </div>
    </div>
    <template #footer>
      <button type="button" :class="btn" data-testid="se-history-close" @click="close">{{ t('SEW_SNAP_HISTORY_CLOSE') }}</button>
    </template>
  </ModalShell>
</template>

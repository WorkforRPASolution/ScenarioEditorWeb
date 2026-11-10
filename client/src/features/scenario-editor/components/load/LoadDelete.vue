<script setup>
// 시나리오 지우기 확인(P2-D Task 7, 설계 §6.7, 목업 delModal). 불러오기 창 위 작은 창 — 이름을 대소문자까지 그대로 쳐야 [지우기]가 켜진다(서버도 confirmName 을 본다).
// 결과: 지움 → deleted, 결과 모름(504·끊김) → 다시 보내지 않고 [목록 다시 읽기]만(relist), 안 감·거절 → 이유를 보이고 다시 누를 수 있다.
import { ref, computed, onMounted, nextTick } from 'vue'
import { scenarioEditorApi as api } from '../../api'
import { t, errorCode, errorMessage } from '../../messages'
import { formatCrtime } from '../../format'
import { typeAlong } from '../../editor/loadRows'

const props = defineProps({
  process: { type: String, required: true },
  model: { type: String, required: true },
  row: { type: Object, required: true },
  versionCount: { type: Number, default: 0 }, // 0 = 모름(버전을 읽지 못함)
  eqpCount: { type: Number, default: 0 }, // 저장 창과 같은 모델별 설비 수(권한·설비 목록)
  open: { type: Object, default: null } // 편집 화면에 열려 있으면 { changes }
})
const emit = defineEmits(['deleted', 'relist', 'close'])

const typed = ref('')
// 내 초안도 함께 지우기(2026-11-10): 내 초안이 있는 시나리오에만 체크 칸이 나온다. 서버가 시나리오를 지운 뒤 요청한 사용자의 초안만 지운다
const withDraft = ref(false)
const draftTime = computed(() => (props.row.draft ? formatCrtime(Date.parse(props.row.draft.savedAt)).slice(5, 16) : ''))
const stage = ref('form') // form | busy | unknown
const failure = ref(null) // { text, relist }
const nameEl = ref(null)
const same = computed(() => typed.value === props.row.name)
// 이름 따라 치기(2026-11-10): placeholder 는 한 글자만 쳐도 통째로 사라져 긴 이름을 따라 칠 수 없다. 입력칸 글자는 투명하게 두고
// 같은 자리·같은 글꼴의 층에 맞게 친 부분·틀린 부분(붉은 글씨)·아직 안 친 부분(회색 안내)을 그린다. 커서·선택은 입력칸 것이 보인다.
// 테두리는 초점이 있을 때도 상태 색이 보이게 브라우저 기본 초점 테두리 대신 같은 색의 링을 쓴다(다 맞음 초록 · 틀린 글자 있음 빨강 · 치는 중 파랑).
const along = computed(() => typeAlong(props.row.name, typed.value))
const alongEl = ref(null)
// 이름이 입력칸보다 길어 글이 옆으로 밀리면 층도 같이 민다
function syncScroll() { if (alongEl.value && nameEl.value) alongEl.value.scrollLeft = nameEl.value.scrollLeft }
const hint = computed(() => (!typed.value ? t('SEW_LOAD_DEL_NAME_EMPTY') : same.value ? t('SEW_LOAD_DEL_NAME_OK') : t('SEW_LOAD_DEL_NAME_DIFF')))
const what = computed(() => (props.versionCount ? t('SEW_LOAD_DEL_WHAT_BODY', { n: props.versionCount }) : t('SEW_LOAD_DEL_WHAT_BODY_ALL')))
const eqp = computed(() => t(props.row.isEnabled === false ? 'SEW_LOAD_DEL_EQP_OFF' : 'SEW_LOAD_DEL_EQP_ON', { model: props.model, n: props.eqpCount }))
const keep = computed(() => t('SEW_LOAD_DEL_KEEP_BODY') + (props.row.draft && !withDraft.value ? t('SEW_LOAD_DEL_KEEP_DRAFT', { time: draftTime.value }) : ''))
const unknownBody = computed(() => (props.versionCount ? t('SEW_LOAD_DEL_UNKNOWN_BODY', { n: props.versionCount }) : t('SEW_LOAD_DEL_UNKNOWN_BODY_ALL')))
const CAUSES = new Set(['NOT_FOUND', 'UPSTREAM_DOWN', 'UPSTREAM_FAILED'])

onMounted(async () => { await nextTick(); nameEl.value?.focus() })

async function go() {
  if (!same.value || stage.value !== 'form') return
  stage.value = 'busy'
  failure.value = null
  try {
    const res = await api.removeScenario(props.process, props.model, props.row.name, typed.value, !!props.row.draft && withDraft.value)
    // draftDeleted: 초안도 지우라고 했을 때만 true·false, 아니면 null
    emit('deleted', { draftDeleted: props.row.draft && withDraft.value ? res?.data?.data?.draftDeleted === true : null })
  } catch (e) {
    const code = errorCode(e)
    if (['UPSTREAM_TIMEOUT', 'TIMEOUT', 'NETWORK'].includes(code) || (code === 'UNKNOWN' && e?.response?.status >= 500)) { stage.value = 'unknown'; return }
    stage.value = 'form'
    failure.value = { text: t('SEW_LOAD_DEL_FAILED', { cause: CAUSES.has(code) ? t(`SEW_LOAD_DEL_CAUSE_${code}`) : errorMessage(e) }), relist: code === 'NOT_FOUND' }
  }
}
function close() { if (stage.value !== 'busy') emit('close') }
const btn = 'h-9 px-4 rounded-lg text-sm font-medium disabled:opacity-50'
</script>

<template>
  <div class="absolute inset-0 z-20 bg-black/40 flex items-center justify-center p-5" data-testid="se-load-del" @keydown.esc.stop.prevent="close" @click.self="close">
    <section class="w-[560px] max-h-full flex flex-col overflow-hidden bg-white dark:bg-dark-card border border-gray-200 dark:border-dark-border rounded-xl shadow-2xl"
      role="dialog" aria-modal="true" aria-labelledby="se-load-del-t">
      <div class="flex items-center gap-3 px-5 py-3 border-b border-gray-200 dark:border-dark-border">
        <h3 id="se-load-del-t" class="font-semibold text-gray-900 dark:text-white">{{ t('SEW_LOAD_DEL_TITLE') }}</h3>
        <span class="flex-1" />
        <button type="button" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-50" :aria-label="t('SEW_LOAD_CLOSE')" :disabled="stage === 'busy'" @click="close">✕</button>
      </div>
      <div class="px-5 py-4 overflow-auto flex flex-col gap-3 text-sm text-gray-800 dark:text-gray-200">
        <div class="font-mono text-xs text-gray-500 break-all">{{ process }}-{{ model }}-{{ row.name }}</div>
        <template v-if="stage === 'unknown'">
          <div class="rounded-lg px-3 py-2 text-[13px] leading-relaxed bg-red-50 text-red-800 dark:bg-red-900/30 dark:text-red-300" role="alert" data-testid="se-load-del-unknown">
            <b>{{ t('SEW_LOAD_DEL_UNKNOWN_HEAD') }}</b>{{ unknownBody }}</div>
          <p class="text-xs text-gray-500">{{ t('SEW_LOAD_DEL_UNKNOWN_NOTE') }}</p>
        </template>
        <template v-else>
          <p class="font-semibold">{{ t('SEW_LOAD_DEL_LEAD') }}</p>
          <dl class="grid grid-cols-[118px_minmax(0,1fr)] gap-x-3 gap-y-1.5 m-0">
            <dt class="text-gray-500">{{ t('SEW_LOAD_DEL_WHAT') }}</dt><dd class="m-0">{{ what }}</dd>
            <dt class="text-gray-500">{{ t('SEW_LOAD_DEL_EQP') }}</dt><dd class="m-0">{{ eqp }}</dd>
            <dt class="text-gray-500">{{ t('SEW_LOAD_DEL_KEEP') }}</dt><dd class="m-0">{{ keep }}</dd>
          </dl>
          <div v-if="open" class="rounded-lg px-3 py-2 text-[13px] leading-relaxed bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
            <b>{{ t('SEW_LOAD_DEL_OPEN') }}</b>{{ t('SEW_LOAD_DEL_OPEN_BODY') }}{{ open.changes ? t('SEW_LOAD_DEL_OPEN_CHANGED', { n: open.changes }) : '' }}</div>
          <label v-if="row.draft" class="flex items-start gap-2 text-[13px] cursor-pointer">
            <input v-model="withDraft" type="checkbox" class="mt-0.5" :disabled="stage === 'busy'" data-testid="se-load-del-with-draft" />
            <span>{{ t('SEW_LOAD_DEL_WITH_DRAFT', { time: draftTime }) }} <small class="text-xs text-gray-500">{{ t('SEW_LOAD_DEL_WITH_DRAFT_HINT') }}</small></span>
          </label>
          <div>
            <label for="se-load-del-name" class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{{ t('SEW_LOAD_DEL_NAME_LABEL') }}</label>
            <div class="relative">
              <input id="se-load-del-name" ref="nameEl" v-model="typed" class="block w-full h-[34px] rounded-md border px-2.5 font-mono text-sm bg-white dark:bg-dark-bg text-transparent caret-gray-900 dark:caret-gray-100 focus:outline-none focus:ring-2"
                :class="same ? 'border-green-500 focus:ring-green-200 dark:focus:ring-green-900/60' : along.bad ? 'border-red-500 focus:ring-red-200 dark:focus:ring-red-900/60' : 'border-gray-300 dark:border-dark-border focus:border-primary-500 focus:ring-primary-100 dark:focus:ring-primary-900/50'" autocomplete="off" spellcheck="false" :disabled="stage === 'busy'"
                data-testid="se-load-del-name" @keydown.enter.prevent="go" @input="syncScroll" @keyup="syncScroll" @click="syncScroll" @scroll="syncScroll" />
              <div ref="alongEl" class="pointer-events-none absolute inset-0 flex items-center overflow-hidden rounded-md border border-transparent px-2.5 font-mono text-sm whitespace-pre" aria-hidden="true" data-testid="se-load-del-along">
                <span v-if="along.ok" class="shrink-0 text-gray-900 dark:text-gray-100" data-testid="se-load-del-ok">{{ along.ok }}</span><span v-if="along.bad" class="shrink-0 text-red-600 dark:text-red-400" data-testid="se-load-del-bad">{{ along.bad }}</span><span v-if="along.ghost" class="shrink-0 text-gray-400 dark:text-gray-500" data-testid="se-load-del-ghost">{{ along.ghost }}</span>
              </div>
            </div>
            <div class="text-xs mt-1 min-h-[17px]" :class="same ? 'text-green-700 dark:text-green-400' : 'text-gray-500'" aria-live="polite">{{ hint }}</div>
          </div>
          <div v-if="failure" class="rounded-lg px-3 py-2 text-[13px] bg-red-50 text-red-800 dark:bg-red-900/30 dark:text-red-300" role="alert" data-testid="se-load-del-error">
            {{ failure.text }} <button v-if="failure.relist" type="button" class="underline underline-offset-2 font-medium" @click="emit('relist')">{{ t('SEW_LOAD_RELIST') }}</button></div>
        </template>
      </div>
      <div class="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-200 dark:border-dark-border">
        <template v-if="stage === 'unknown'">
          <button type="button" :class="btn" class="bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 font-normal" @click="close">{{ t('SEW_LOAD_CLOSE') }}</button>
          <button type="button" :class="btn" class="bg-primary-500 hover:bg-primary-600 text-white" data-testid="se-load-del-relist" @click="emit('relist')">{{ t('SEW_LOAD_RELIST') }}</button>
        </template>
        <template v-else>
          <button type="button" :class="btn" class="bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 font-normal" :disabled="stage === 'busy'" data-testid="se-load-del-cancel" @click="close">{{ t('SEW_LOAD_CANCEL') }}</button>
          <button type="button" :class="btn" class="bg-red-500 hover:bg-red-600 text-white" :disabled="!same || stage === 'busy'" data-testid="se-load-del-go" @click="go">
            {{ stage === 'busy' ? t('SEW_LOAD_DEL_BUSY') : t('SEW_LOAD_DELETE_GO') }}</button>
        </template>
      </div>
    </section>
  </div>
</template>

<script setup>
// 결과 화면(목업 saveResultHtml, 조작판 33~38): 성공 · 초안 · 실패(안 감·거절) · 결과 모름 · 마무리 실패.
// 결과 모름은 자동으로 다시 보내지 않는다 — [버전 목록 확인] 뒤에야 [다시 배포].
import { computed } from 'vue'
import { useSaveFlow } from '../../stores/saveFlow'
import { useEditStore } from '../../stores/editStore'
import { t } from '../../messages'
import { formatCrtime } from '../../format'

defineOptions({ name: 'SaveResult' })
const flow = useSaveFlow()
const edit = useEditStore()

const st = computed(() => flow.stage)
const tg = computed(() => flow.sentTarget ?? { process: edit.session?.source?.process ?? '', ...flow.target })
const id = computed(() => `${tg.value.process}-${tg.value.model}-${tg.value.name}`)
const crtimeText = (ms) => (ms === null || ms === undefined ? '—' : formatCrtime(ms))
const savedAtText = computed(() => { const v = flow.result?.savedAt; const ms = v ? new Date(v).getTime() : NaN; return Number.isFinite(ms) ? formatCrtime(ms) : '—' })
const currentText = computed(() => { const s = edit.session?.source; return s ? formatCrtime(s.crtime) : t('SEW_SAVE_RESULT_NO_CURRENT') })
const tone = computed(() => ({ fail: 'fa', unknown: 'am', partial: 'am' })[st.value] ?? '')
const icon = computed(() => ({ fail: '!', unknown: '?', partial: '!' })[st.value] ?? '✓')
const TITLE = { ok: 'SEW_SAVE_OK_TITLE', draft: 'SEW_SAVE_DRAFT_TITLE', fail: 'SEW_SAVE_FAIL_TITLE', unknown: 'SEW_SAVE_UNKNOWN_TITLE', partial: 'SEW_SAVE_PARTIAL_TITLE' }
const none = computed(() => flow.result?.found === 'none')
const verifyNote = computed(() => (!none.value ? '' : flow.result.noRecord ? t('SEW_SAVE_VERIFY_NO_RECORD') : t('SEW_SAVE_VERIFY_NONE')))
const busy = computed(() => !!flow.busy)
// 결과 모름: 확인 전에는 [버전 목록 확인]만, 새 판이 없다고 나오면 [다시 확인]·[다시 배포](기록이 없으면 [다시 배포]만)
const showVerify = computed(() => (st.value === 'unknown' && !flow.result?.noRecord) || (st.value === 'fail' && flow.error?.kind === 'rejected' && !none.value))
const showRedeploy = computed(() => st.value === 'fail' || (st.value === 'unknown' && none.value))
const showDraft = computed(() => (st.value === 'fail' || st.value === 'unknown') && !flow.restored)
</script>

<template>
  <div class="se-sv-rs" :class="tone" data-testid="se-save-result">
    <h4><i>{{ icon }}</i>{{ t(TITLE[st]) }}</h4>

    <template v-if="st === 'ok'">
      <p>{{ t('SEW_SAVE_OK_BODY', { model: tg.model, n: flow.eqpCount }) }}</p>
      <dl><dt>{{ t('SEW_SAVE_RESULT_ID') }}</dt><dd class="font-mono">{{ id }}</dd><dt>{{ t('SEW_SAVE_RESULT_VERSION') }}</dt><dd>{{ crtimeText(flow.result?.crtime) }}</dd></dl>
    </template>
    <template v-else-if="st === 'partial'">
      <p>{{ t('SEW_SAVE_PARTIAL_BODY') }}</p>
      <dl><dt>{{ t('SEW_SAVE_RESULT_ID') }}</dt><dd class="font-mono">{{ id }}</dd><dt>{{ t('SEW_SAVE_RESULT_VERSION') }}</dt><dd>{{ crtimeText(flow.result?.crtime) }}</dd></dl>
    </template>
    <template v-else-if="st === 'draft'">
      <p>{{ t('SEW_SAVE_DRAFT_BODY') }}</p>
      <dl><dt>{{ t('SEW_SAVE_RESULT_SAVED_AT') }}</dt><dd>{{ savedAtText }}</dd><dt>{{ t('SEW_SAVE_RESULT_CURRENT') }}</dt><dd>{{ currentText }}</dd></dl>
    </template>
    <template v-else-if="st === 'fail'">
      <p>{{ t(flow.error?.kind === 'rejected' ? 'SEW_SAVE_REJECTED_BODY' : 'SEW_SAVE_FAIL_BODY') }}</p>
      <dl>
        <dt>{{ t('SEW_SAVE_RESULT_CAUSE') }}</dt><dd>{{ flow.error?.cause }}</dd>
        <template v-if="flow.error?.upstreamText"><dt>{{ t('SEW_SAVE_RESULT_SERVER_TEXT') }}</dt><dd class="font-mono" data-testid="se-save-upstream-text">{{ flow.error.upstreamText }}</dd></template>
      </dl>
    </template>
    <template v-else-if="st === 'unknown'">
      <p>{{ t('SEW_SAVE_UNKNOWN_BODY') }}</p>
      <div v-if="flow.restored" class="se-sv-note" data-testid="se-save-unknown-restored">{{ t(flow.restoredOther ? 'SEW_SAVE_UNKNOWN_RESTORED_OTHER' : 'SEW_SAVE_UNKNOWN_RESTORED', { id }) }}</div>
    </template>

    <div v-if="verifyNote" class="se-sv-note" data-testid="se-save-verify-note">{{ verifyNote }}</div>
    <div v-if="flow.notice" class="se-sv-note" :class="{ fa: flow.notice.tone === 'error' }" data-testid="se-save-result-notice">{{ t(flow.notice.key, flow.notice.params ?? {}) }}</div>

    <div class="se-sv-ft">
      <button type="button" class="se-sv-btn" :disabled="busy" data-testid="se-save-close" @click="flow.close()">{{ t('SEW_SAVE_CLOSE') }}</button>
      <!-- 확인이 계속 실패해도 빠져나온다 — 서버 기록은 위쪽 바 "확인할 배포" 에 남는다(SEW-021) -->
      <button v-if="st === 'unknown'" type="button" class="se-sv-btn" :disabled="busy" data-testid="se-save-later" @click="flow.later()">{{ t('SEW_SAVE_LATER_BTN') }}</button>
      <button v-if="showDraft" type="button" class="se-sv-btn" :disabled="!flow.canDraft" data-testid="se-save-result-draft" @click="flow.saveDraft()">{{ t('SEW_SAVE_DRAFT') }}</button>
      <button v-if="showVerify" type="button" class="se-sv-btn" :class="{ p: !showRedeploy }" :disabled="busy" data-testid="se-save-verify" @click="flow.verify()">
        {{ t(none ? 'SEW_SAVE_VERIFY_AGAIN' : 'SEW_SAVE_VERIFY') }}</button>
      <button v-if="showRedeploy" type="button" class="se-sv-btn p" :disabled="busy" data-testid="se-save-redeploy" @click="flow.redeploy()">{{ t('SEW_SAVE_REDEPLOY') }}</button>
      <button v-if="st === 'partial'" type="button" class="se-sv-btn p" :disabled="busy" data-testid="se-save-finish" @click="flow.finish()">{{ t('SEW_SAVE_FINISH') }}</button>
    </div>
  </div>
</template>

<script setup>
// 같은 이름의 다른 모델에도 쓰기(목업 renderSame, 설계 §7). 같은 공정·같은 이름의 다른 모델을 체크해 고른다 — 기본은 아무것도 고르지 않는다.
// 대상마다 이번에 바꾼 칸만 쓰고 원개발자는 넣지 않는다(DC-136). 저장 뒤 모델별 결과를 보이고 체크를 모두 푼다(SE-033).
// 실패한 모델에 다시 쓰는 버튼은 두지 않는다(같은 키 2건·없음은 다시 해도 같다).
import { computed, inject } from 'vue'
import { t, LABELS } from '../../messages'

defineOptions({ name: 'PerformanceSameName' })
const ctx = inject('sePerformanceCtx')
const L = LABELS.perf
const KNOWN = new Set(['NOT_FOUND', 'DATA_INVALID', 'PROCESS_FORBIDDEN'])

const shared = computed(() => ctx.sharedKeys.map((k) => L.fields[k] ?? k))
const note = computed(() => {
  if (!ctx.also.length) return { warn: false, text: t('SEW_PERF_SAME_NONE_PICKED') }
  if (shared.value.length) return { warn: false, text: t('SEW_PERF_SAME_FIELDS', { list: shared.value.join(' · ') }) }
  return { warn: true, text: t('SEW_PERF_SAME_NOTHING') }
})
// 결과 code: 없음·같은 키 2건·권한 밖은 그 이유, 그 밖(쓰기 시간 초과 등)은 결과를 모른다
const reason = (code) => t(`SEW_PERF_RESULT_${KNOWN.has(code) ? code : 'WRITE_FAILED'}`)
</script>

<template>
  <div class="se-pf-same" role="group" aria-labelledby="se-pf-same-h">
    <div class="se-pf-sec-h" style="margin-bottom: 2px"><h4 id="se-pf-same-h">{{ L.sameTitle }}</h4></div>
    <div class="se-pf-help" style="margin-top: 0">{{ t('SEW_PERF_SAME_HELP', { process: ctx.key.process, name: ctx.key.name }) }}</div>
    <div v-if="ctx.modelsFailed" class="se-pf-warn">{{ t('SEW_PERF_SAME_FAILED') }}</div>
    <div v-else-if="ctx.models === null" class="se-pf-empty">{{ t('SEW_PERF_SAME_LOADING') }}</div>
    <template v-else-if="ctx.models.length">
      <div class="se-pf-models">
        <label v-for="m in ctx.models" :key="m" class="se-pf-mdl" :class="{ on: ctx.also.includes(m) }">
          <input type="checkbox" class="se-pf-ck" :checked="ctx.also.includes(m)" :data-pf="`also:${m}`" :disabled="ctx.saving" @change="ctx.toggleAlso(m, $event.target.checked)">{{ m }}
        </label>
      </div>
      <div :class="note.warn ? 'se-pf-warn' : 'se-pf-help'" data-testid="se-perf-same-note">{{ note.text }}</div>
    </template>
    <div v-else class="se-pf-empty">{{ t('SEW_PERF_SAME_EMPTY') }}</div>
    <ul v-if="ctx.results" class="se-pf-res" data-testid="se-perf-results" :aria-label="t('SEW_PERF_RESULTS_TITLE', { time: ctx.resultsAt })">
      <li class="t">{{ t('SEW_PERF_RESULTS_TITLE', { time: ctx.resultsAt }) }}</li>
      <li v-for="r in ctx.results" :key="r.model" class="r" data-testid="se-perf-result">
        <span :class="r.ok ? 'ok' : 'fail'" aria-hidden="true">{{ r.ok ? '✓' : '✕' }}</span>
        <span class="m" :title="r.model">{{ r.model }}</span>
        <span :class="{ fail: !r.ok }">{{ r.ok ? t('SEW_PERF_RESULT_OK') : t('SEW_PERF_RESULT_FAILED', { reason: reason(r.code) }) }}</span>
      </li>
    </ul>
  </div>
</template>

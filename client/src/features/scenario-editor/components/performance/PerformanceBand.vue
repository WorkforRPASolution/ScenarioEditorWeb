<script setup>
// 심의 띠(목업 renderReview): 등급·심사 의견·심의자. 운영 속성 창 [심의 저장]과 같은 값이다 — 여기서 고치면 [성과 저장]이 함께 쓴다.
import { computed, inject } from 'vue'
import { t, LABELS } from '../../messages'
import PerformanceErrors from './PerformanceErrors.vue'

defineOptions({ name: 'PerformanceBand' })
const ctx = inject('sePerformanceCtx')
const L = LABELS.perf
const P = LABELS.prop

const sv = computed(() => ctx.savedView)
const reviewed = computed(() => !!sv.value && !sv.value.supervisorNotEntered && !!sv.value.supervisor)
const changed = computed(() => ctx.f.grade !== ctx.init.grade || ctx.f.comment !== ctx.init.comment)
const hint = computed(() => P.gradeHints[ctx.f.grade] ?? '')
</script>

<template>
  <section class="se-pf-rv" aria-labelledby="se-pf-rv-h">
    <div class="se-pf-sec-h"><h4 id="se-pf-rv-h">{{ L.review }}</h4><span class="se-pf-help">{{ t('SEW_PERF_REVIEW_HELP') }}</span></div>
    <div class="se-pf-rv-grid">
      <div>
        <span id="se-pf-grade-l" class="se-pf-lbl">{{ L.grade }}<i class="se-pf-req">{{ L.required }}</i></span>
        <div class="se-pp-scale se-pf-scale" :class="{ bad: ctx.hasErr('grade') }" role="radiogroup" aria-labelledby="se-pf-grade-l">
          <button v-for="(g, i) in P.grades" :key="g" type="button" role="radio" :aria-checked="String(i === ctx.f.grade)" :data-pf="`grade:${i}`"
            @click="ctx.setField('grade', i)">{{ g }}</button>
        </div>
        <PerformanceErrors v-if="ctx.hasErr('grade')" at="grade" />
        <div v-else-if="hint" class="se-pf-help">{{ hint }}</div>
      </div>
      <div>
        <label class="se-pf-lbl" for="se-pf-comment">{{ L.comment }}<i class="se-pf-req">{{ L.commentRequired }}</i></label>
        <textarea id="se-pf-comment" class="se-pp-inp" :class="{ bad: ctx.hasErr('comment') }" rows="2" :value="ctx.f.comment" data-pf="comment"
          aria-describedby="se-pf-e-comment" @input="ctx.setField('comment', $event.target.value)" />
        <PerformanceErrors at="comment" />
      </div>
      <div class="se-pf-who">
        <span class="se-pf-lbl">{{ L.supervisor }}</span>
        <b>{{ reviewed ? sv.supervisor : t('SEW_PERF_SUPERVISOR_NONE') }}</b>
        <div v-if="changed" class="se-pf-was">{{ t('SEW_PERF_SUPERVISOR_WILL', { me: ctx.me }) }}</div>
        <div v-else>{{ t('SEW_PERF_SUPERVISOR_HINT') }}</div>
      </div>
    </div>
  </section>
</template>

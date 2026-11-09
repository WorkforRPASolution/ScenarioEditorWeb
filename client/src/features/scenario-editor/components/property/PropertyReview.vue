<script setup>
// 심의와 성과(목업 v2 reviewBlock·metrics·perfAction, 성과 줄 이름은 2026-11-08 성과 입력 목업의 뒤 창).
// 등급·의견은 관리 등급 1·2(Administrator·Conductor)만 [심의 고치기] → [심의 저장]으로 바로 쓴다 — 작업본·배포와 상관없다(설계 §3·§7).
// WRITE·현재 버전·운영 속성 [수정]은 보지 않는다(서버 writePolicy reviewDenial 과 같다). 고치는 상태도 운영 속성 수정과 따로다 —
// 운영 속성 [적용]·[취소]가 저장하지 않은 심의 글을 지우지 않는다. 새 시나리오(저장 전)는 등급 칸을 끈다(40 §2.6).
// 저장하지 않은 심의 글이 있으면 dirty 로 알린다(창 닫기 확인). [성과 입력]은 부모에 알리기만 한다(창은 Task 5).
import { ref, computed, watch } from 'vue'
import { useEditorStore } from '../../stores/editorStore'
import { useEditStore } from '../../stores/editStore'
import { scenarioEditorApi as api } from '../../api'
import { t, LABELS, errorMessage } from '../../messages'
import { human } from '../../editor/propertyView'

defineOptions({ name: 'PropertyReview' })
const emit = defineEmits(['open-performance', 'dirty'])
const store = useEditorStore()
const edit = useEditStore()
const P = LABELS.prop
const REVIEWER_LEVELS = [1, 2] // 서버 writePolicy REVIEWER_LEVELS(관리 등급 Unlimited·Conductor)
const NOT_USED = 6

const perf = computed(() => store.skeleton?.performance ?? null)
const source = computed(() => edit.session?.source ?? null)
const fresh = computed(() => !!edit.session?.working && !source.value)
const reviewer = computed(() => REVIEWER_LEVELS.includes(store.me?.authorityManager))
const canReview = computed(() => reviewer.value && !!source.value)

const savedGrade = computed(() => perf.value?.grade ?? 0)
const savedComment = computed(() => perf.value?.supervisorComment ?? '')
const reviewed = computed(() => !!perf.value && !perf.value.supervisorNotEntered && !!perf.value.supervisor)
const shownGrade = computed(() => perf.value?.gradeName ?? P.grades[savedGrade.value] ?? P.grades[0])
const big = computed(() => savedGrade.value === 0 || savedGrade.value === NOT_USED)

// 고치는 값은 창 안에만 — [심의 고치기] 때 저장된 값에서 시작한다. 창을 닫으면(이 조각이 내려가면) 버린다.
const reviewing = ref(false)
const grade = ref(0)
const comment = ref('')
const busy = ref(false)
const msg = ref(null) // { ok, text }
function reset() { grade.value = savedGrade.value; comment.value = savedComment.value }
function startReview() { reset(); msg.value = null; reviewing.value = true }
function cancelReview() { reviewing.value = false; msg.value = null }
// 서버가 다시 읽은 성과(성과 입력 창 저장 등): 고치던 글이 손대지 않은 저장 값이면 새 값으로 바꾸고, 고친 글은 남긴다
watch(perf, (now, before) => {
  if (reviewing.value && grade.value === (before?.grade ?? 0) && comment.value === (before?.supervisorComment ?? '')) reset()
})
const changed = computed(() => reviewing.value && (grade.value !== savedGrade.value || comment.value !== savedComment.value))
watch(changed, (v) => emit('dirty', v), { immediate: true })
// 등급이 N/A 가 아니면 의견 5자 이상(목업 reviewError). 손대지 않은 저장 값은 빨갛게 보이지 않는다 — 고칠 때부터.
const commentError = computed(() => (changed.value && grade.value !== 0 && comment.value.trim().length < 5 ? t('RULE_COMMENT_SHORT') : ''))
const canSave = computed(() => canReview.value && changed.value && !commentError.value && !busy.value)
function pick(g) { grade.value = g; msg.value = null }
function type(v) { comment.value = v; msg.value = null }

async function save() {
  if (!canSave.value) return
  const s = source.value
  busy.value = true
  msg.value = null
  try {
    const res = await api.saveReview(s.process, s.model, s.name, { grade: grade.value, comment: comment.value })
    store.setPerformance(res.data.data.performance)
    reviewing.value = false
    msg.value = { ok: true, text: t('SEW_PROP_REVIEW_SAVED') }
  } catch (e) {
    msg.value = { ok: false, text: t('SEW_PROP_REVIEW_FAILED', { cause: errorMessage(e) }) }
  } finally {
    busy.value = false
  }
}

const metrics = computed(() => {
  const f = perf.value ?? {}
  const M = P.metrics
  return [
    { label: M.man, value: f.manWorkLoss, text: human(f.manWorkLoss) },
    { label: M.stop, value: f.eqpStopLoss, text: human(f.eqpStopLoss) },
    { label: M.wafer, value: f.waferLoss, text: String(f.waferLoss), unit: M.waferUnit },
    { label: M.invest, value: f.investCostLoss, text: String(f.investCostLoss), unit: M.investUnit }
  ]
})
</script>

<template>
  <h4>{{ P.reviewPerf }}</h4>
  <div class="se-pp-review-grid">
    <div>
      <template v-if="reviewing">
        <div class="se-pp-scale" role="radiogroup" :aria-label="P.grade">
          <button v-for="(g, i) in P.grades" :key="g" type="button" role="radio" :aria-checked="String(i === grade)" :data-grade="i" data-testid="se-prop-grade" @click="pick(i)">{{ g }}</button>
        </div>
        <p v-if="P.gradeHints[grade]" class="se-pp-hint">{{ P.gradeHints[grade] }}</p>
        <textarea class="se-pp-inp" :class="{ bad: commentError }" rows="2" :value="comment" :placeholder="t('SEW_PROP_COMMENT_PH')" :aria-label="t('SEW_PROP_COMMENT_PH')"
          data-testid="se-prop-comment" @input="type($event.target.value)" />
        <div v-if="commentError" class="se-pp-err">{{ commentError }}</div>
        <div class="se-pp-review-foot">
          <span class="se-pp-lock" data-testid="se-prop-review-lock">{{ changed ? t('SEW_PROP_REVIEW_WILL_RECORD') : reviewed ? t('SEW_PROP_SUPERVISOR', { who: perf.supervisor }) : t('SEW_PROP_NOT_REVIEWED') }}</span>
          <span class="flex gap-1.5">
            <button type="button" class="se-pp-btn" :disabled="busy" data-testid="se-prop-review-cancel" @click="cancelReview">{{ P.cancel }}</button>
            <button type="button" class="se-pp-btn p" :disabled="!canSave" data-testid="se-prop-review-save" @click="save">{{ busy ? P.reviewSaving : P.reviewSave }}</button>
          </span>
        </div>
      </template>
      <div v-else class="se-pp-grade-row">
        <div class="se-pp-grade" :class="{ small: big }">{{ shownGrade }}</div>
        <div class="se-pp-grow">
          <div v-if="reviewed && P.gradeHints[savedGrade]" class="se-pp-who">{{ P.gradeHints[savedGrade] }}</div>
          <div class="se-pp-who" data-testid="se-prop-supervisor">{{ reviewed ? t('SEW_PROP_SUPERVISOR', { who: perf.supervisor }) : t('SEW_PROP_NOT_REVIEWED') }}</div>
          <div v-if="savedComment" class="se-pp-quote">{{ savedComment }}</div>
          <div class="mt-1.5">
            <button v-if="canReview" type="button" class="se-pp-btn-line" data-testid="se-prop-review-edit" @click="startReview">{{ P.reviewEdit }}</button>
            <span v-else-if="fresh" class="se-pp-lock" data-testid="se-prop-review-lock">{{ t('SEW_PROP_LOCK_FRESH') }}</span>
            <span v-else-if="source" class="se-pp-lock" data-testid="se-prop-review-lock">{{ t('SEW_PROP_LOCK_GRADE') }}</span>
          </div>
        </div>
      </div>
      <div v-if="msg" :class="msg.ok ? 'se-pp-ok' : 'se-pp-err'" role="status" data-testid="se-prop-review-msg">{{ msg.text }}</div>
      <template v-if="perf?.scenarioDescription">
        <div class="se-pp-sub-t">{{ P.scnDesc }}</div>
        <div class="break-all">{{ perf.scenarioDescription }}</div>
      </template>
    </div>
    <div>
      <dl class="se-pp-metrics" data-testid="se-prop-metrics">
        <template v-for="m in metrics" :key="m.label">
          <dt>{{ m.label }}</dt>
          <dd :class="{ zero: !m.value }">
            <template v-if="m.value">{{ m.text }}<small v-if="m.unit">{{ m.unit }}</small></template>
            <template v-else>{{ P.none }}</template>
          </dd>
        </template>
      </dl>
      <div v-if="perf?.additionalEffect" class="se-pp-who mt-1.5">{{ t('SEW_PROP_ADDITIONAL', { text: perf.additionalEffect }) }}</div>
      <div class="se-pp-perf-action">
        <button v-if="reviewer && source" type="button" class="se-pp-btn-line" data-testid="se-prop-perf-open" @click="emit('open-performance')">{{ P.perfOpen }}</button>
        <span v-else class="se-pp-lock" data-testid="se-prop-perf-lock">{{ reviewer ? t('SEW_PROP_PERF_FRESH') : t('SEW_PROP_PERF_LOCK') }}</span>
      </div>
    </div>
  </div>
</template>

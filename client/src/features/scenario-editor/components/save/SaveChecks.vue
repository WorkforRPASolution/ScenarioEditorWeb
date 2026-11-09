<script setup>
// 저장 전 검사(서버 /check, 목업 svChecks, 조작판 22·23). 막힘이 먼저, 경고가 뒤. 줄을 누르면 그 스텝·바 칸·운영 속성·저장 창의 칸으로.
import { computed } from 'vue'
import { useSaveFlow, issueGoal } from '../../stores/saveFlow'
import { useEditStore } from '../../stores/editStore'
import { t } from '../../messages'

defineOptions({ name: 'SaveChecks' })
const emit = defineEmits(['go'])
const flow = useSaveFlow()
const edit = useEditStore()

const steps = computed(() => edit.session?.working?.steps ?? [])
function stepSub(uid) {
  const i = steps.value.findIndex((s) => s.uid === uid)
  return i < 0 ? '' : t('SEW_SAVE_ISSUE_STEP', { no: i + 1, desc: steps.value[i].descriptionToEmail ?? '' })
}
// force 로 검사했는데도 SOURCE_GONE 이면 서버 캐시도 없다 — 그 사실대로 알린다
const text = (i) => (i.code === 'SOURCE_GONE' && flow.checkedFor?.force ? t('SEW_SAVE_SOURCE_GONE_NO_CACHE') : t(`RULE_${i.code}`, i.params ?? {}))
function sub(i, goal) {
  if (!goal) return ''
  if (goal.kind === 'step') return stepSub(goal.uid)
  if (goal.kind === 'bar') return t('SEW_SAVE_ISSUE_BAR')
  if (goal.kind === 'form') return t('SEW_SAVE_ISSUE_FORM')
  const p = i.params ?? {}
  return (p.which === 'success' || p.which === 'fail') && p.name ? t('SEW_SAVE_ISSUE_FOLLOW', { which: t(`SEW_SAVE_WHICH_${p.which}`), name: p.name }) : t('SEW_SAVE_ISSUE_PROPERTY')
}
const row = (i, level) => { const goal = issueGoal(i); return { level, goal, text: text(i), sub: sub(i, goal) } }
const rows = computed(() => (flow.check ? [...flow.visibleBlocks.map((i) => row(i, 'blk')), ...(flow.check.warns ?? []).map((i) => row(i, 'wrn'))] : []))
const nBlocks = computed(() => (flow.check ? flow.visibleBlocks.length : 0))
const nWarns = computed(() => (flow.check?.warns ?? []).length)
const stale = computed(() => !!flow.check && !flow.checkFresh)
</script>

<template>
  <div>
    <div class="se-sv-t">{{ t('SEW_SAVE_CHECKS') }}
      <small v-if="nBlocks || nWarns">{{ [nBlocks ? t('SEW_SAVE_CHECKS_BLOCKS', { n: nBlocks }) : '', nWarns ? t('SEW_SAVE_CHECKS_WARNS', { n: nWarns }) : ''].filter(Boolean).join(' · ') }}</small>
      <small v-if="flow.checking"><span class="se-sv-spin align-middle" /> {{ t('SEW_SAVE_CHECKS_RUNNING') }}</small>
    </div>
    <div v-if="flow.checkError && !flow.checking" class="se-sv-note fa mt-0" data-testid="se-save-check-failed">
      {{ t('SEW_SAVE_CHECKS_FAILED', { cause: flow.checkError.cause }) }}
      <div class="mt-1.5"><button type="button" class="se-sv-btn" data-testid="se-save-check-retry" @click="flow.runCheck()">{{ t('SEW_SAVE_CHECK_RETRY') }}</button></div>
    </div>
    <ul v-else-if="rows.length" class="se-sv-list" :class="{ 'se-sv-stale': stale }">
      <li v-for="(r, i) in rows" :key="i">
        <button v-if="r.goal" type="button" class="se-sv-row" :class="r.level" data-testid="se-save-issue" @click="emit('go', r.goal)"><b>{{ r.text }}</b><small v-if="r.sub">{{ r.sub }}</small></button>
        <div v-else class="se-sv-row" :class="r.level" data-testid="se-save-issue"><b>{{ r.text }}</b></div>
      </li>
    </ul>
    <div v-else-if="flow.checkFresh" class="se-sv-ok">{{ t('SEW_SAVE_CHECKS_OK') }}</div>
  </div>
</template>

<script setup>
// 시험 실행 창의 고르기 줄 — 공정 · 모델 · 시나리오(P5 설계 §4.2). 셋 모두 글자로 찾는 선택 상자다(스냅샷 패널의 SearchSelect).
// 공정을 바꾸면 모델·시나리오·설비 선택이, 모델을 바꾸면 시나리오·설비 선택이 비워진다(저장소). 보내는 동안에는 잠근다.
import { computed } from 'vue'
import { useTestRunStore } from '../../stores/testRunStore'
import { scenarioMark } from '../../editor/testRun'
import { t } from '../../messages'
import SearchSelect from '../snapshot/SearchSelect.vue'
import './testrun.css'

defineOptions({ name: 'TestRunPick' })
const run = useTestRunStore()
const locked = computed(() => run.stage !== 'pick')
const names = computed(() => run.scenarios.rows.map((r) => r.name))
const marks = computed(() => new Map(run.scenarios.rows.map((r) => [r.name, scenarioMark(r)])))
// 시나리오 항목 옆의 표시(꺼짐·현재 판 없음·확인 필요) — 고를 수는 있고, 고르면 위쪽에 까닭이 보인다
function noteOf(name) {
  const mark = marks.value.get(name)
  return mark ? { text: t(`SEW_RUN_MARK_${mark}`), title: '' } : { text: '', title: '' }
}
</script>

<template>
  <div class="se-run-pick" data-testid="se-run-pick">
    <div>
      <label>{{ t('SEW_RUN_PROCESS') }}</label>
      <SearchSelect :model-value="run.sel.process" :options="run.processes" :all-label="t('SEW_RUN_PICK_PROCESS')" :disabled="locked" no-all testid="se-run-process" @update:model-value="run.setProcess" />
    </div>
    <div>
      <label>{{ t('SEW_RUN_MODEL') }}</label>
      <SearchSelect :model-value="run.sel.model" :options="run.models" :all-label="t('SEW_RUN_PICK_MODEL')" :disabled="locked || !run.sel.process" no-all testid="se-run-model" @update:model-value="run.setModel" />
    </div>
    <div>
      <label>{{ t('SEW_RUN_SCENARIO') }}</label>
      <SearchSelect :model-value="run.sel.name" :options="names" :all-label="t('SEW_RUN_PICK_SCENARIO')" :disabled="locked || !run.sel.model" :note-of="noteOf" no-all testid="se-run-scenario" @update:model-value="run.setName" />
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useEditorStore } from '../stores/editorStore'
import { t } from '../messages'
import { scenarioTypeLabel, enabledLabel } from '../format'
import ModalShell from './ModalShell.vue'

defineProps({ modelValue: Boolean })
const emit = defineEmits(['update:modelValue'])
const store = useEditorStore()
const TRIGGER_TYPE = ['USER_DEFINED', 'EES', 'REALTIME']
const yn = (v) => (v ? '예' : '아니오')
const next = (n) => (n ? `${n.Name ?? '(null)'}${n.Text ? ` — ${n.Text}` : ''}` : '없음')

const sections = computed(() => {
  const p = store.skeleton?.property
  const f = store.skeleton?.performance
  if (!p) return []
  const priority = [1, 5, 10].includes(p.Priority) ? String(p.Priority) : t('SEW_UI_PRIORITY_NONSTANDARD', { value: p.Priority })
  const people = p.Owners.length ? p.Owners.map((o, i) => [`수정 ${i + 1}`, o]) : [['수정 이력', '없음']]
  if (f) {
    people.unshift(['그룹', f.group || '—'])
    for (const c of f.citizenDevelopers ?? []) people.push(['시민 개발자', `${c.name} (${c.knoxId}, ${c.sdwt}) ${c.contribution}%`])
  }
  // 설계 §6.3 묶음: 기본·후속 시나리오·담당·심의·성과 정보·그 밖
  const out = [
    { title: '기본', rows: [['유형', `${scenarioTypeLabel(p.Type)} (${p.Type})`], ['트리거 유형', TRIGGER_TYPE[p.ScenarioTriggerType] ?? p.ScenarioTriggerType],
      ['켜짐', enabledLabel(p.IsEnabled)], ['우선순위', priority], ['시작 지연', p.StartDelay], ['재시도 횟수', p.RetryCnt], ['재시도 간격(초)', p.RetryInterval],
      ['실행 레벨', p.ExecutingLevel], ['알림 창', yn(p.IsShowDialog)]] },
    { title: '후속 시나리오', rows: [['성공하면', next(p.NextScenarioIfSuccess)], ['실패하면', next(p.NextScenarioIfFail)]] },
    { title: '담당', rows: people },
    { title: '심의', rows: [['심의 의견(Conductor)', p.DescriptionFromConductor || '—'],
      ...(f ? [['심의자', f.supervisorNotEntered ? '미입력' : f.supervisor], ['심의자 의견', f.supervisorComment || '—']] : [])] }
  ]
  if (f) {
    out.push({ title: '성과 정보', rows: [['등급', f.gradeName], ['시나리오 설명', f.scenarioDescription || '—'], ['트리거', f.triggerName ?? '—'], ['트리거 정보', f.triggerInfo ?? '—'],
      ['성과 유형', f.performTypeName ?? '—'], ['인력 손실', f.manWorkLoss], ['설비 성능 손실', f.eqpPerformanceLoss], ['설비 정지 손실', f.eqpStopLoss], ['웨이퍼 손실', f.waferLoss],
      ['투자비 손실', f.investCostLoss], ['추가 효과', f.additionalEffect || '—'], ['사고 유형', f.accidentTypeName ?? '—'], ['사고 정보', f.accidentInfo || '—'],
      ['갱신일', f.updateDate || '—'], ['저장된 키', f.rawKeys.join(', ')]] })
  }
  out.push({ title: '그 밖', rows: [['성공 메일 보내지 않음', yn(p.DoNotSendEmailWhenSuccess)], ['중지 메일 보내지 않음', yn(p.DoNotSendEmailWhenStop)],
    ['실패 메일 보내지 않음', yn(p.DoNotSendEmailWhenFail)], ['상세 설명 제목', p.DetailedDescriptionTitle || '—'], ['상세 설명', p.DetailedDescription || '—'],
    ['EDM 링크', p.EDMLink || '—'], ['LcncType', p.LcncType], ['LowcodeExtension', p.LowcodeExtension || '—']] })
  return out
})
</script>

<template>
  <ModalShell :model-value="modelValue" title="운영 속성" :width="720" :height="620" testid="se-property-dialog" @update:model-value="emit('update:modelValue', $event)">
    <div class="h-full overflow-auto p-5 text-sm">
      <p class="mb-4 text-xs text-gray-500 dark:text-gray-400">{{ t('SEW_UI_PROPERTY_CURRENT') }}</p>
      <section v-for="s in sections" :key="s.title" class="mb-4">
        <h4 class="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">{{ s.title }}</h4>
        <dl class="grid grid-cols-[180px_1fr] gap-x-3 gap-y-1">
          <template v-for="([k, v], i) in s.rows" :key="i"><dt class="text-gray-500 dark:text-gray-400">{{ k }}</dt><dd class="text-gray-900 dark:text-gray-100 break-all">{{ v }}</dd></template>
        </dl>
      </section>
      <p v-if="!sections.length" class="text-gray-500">{{ t('SEW_UI_PROPERTY_PARSE_FAILED') }}</p>
    </div>
  </ModalShell>
</template>

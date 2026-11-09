<script setup>
// 새 시나리오 창의 "만들면" 상자(목업 .after): 닿는 곳(이 화면만), 만든 뒤 일, 저장 전 변경 미리 알림, 접어 둔 처음 운영 속성(13 §4.3 기본값).
import { t, LABELS } from '../../messages'

defineOptions({ name: 'NewScenarioAfter' })
// typeText = 고른 유형 이름(없으면 빈 값 — 자리표), unsaved = 저장 전 변경 미리 알림 문구(없으면 빈 값)
defineProps({ typeText: { type: String, default: '' }, unsaved: { type: String, default: '' } })
</script>

<template>
  <div class="se-ns-after">
    <div class="se-sv-reach">
      <span class="se-ns-reach-lbl">{{ t('SEW_NEW_AFTER') }}</span>
      <span><i />{{ t('SEW_NEW_REACH_SCREEN') }}</span><u class="off" />
      <span class="off"><i />{{ t('SEW_NEW_REACH_DRAFT') }}</span><u class="off" />
      <span class="off"><i />{{ t('SEW_NEW_REACH_EQP') }}</span>
    </div>
    <p>{{ t('SEW_NEW_AFTER_BODY') }}</p>
    <div v-if="unsaved" class="se-ns-warn" data-testid="se-new-unsaved">{{ unsaved }}</div>
    <details class="se-ns-def" data-testid="se-new-defaults">
      <summary>{{ t('SEW_NEW_DEFAULTS') }} <span>{{ t('SEW_NEW_DEFAULTS_SUM') }}</span></summary>
      <dl class="se-ns-kv">
        <template v-for="[k, v] in LABELS.newScenario.defaults" :key="k">
          <dt>{{ k }}</dt>
          <dd v-if="v !== null">{{ v }}</dd>
          <dd v-else :class="{ 'se-ns-ph': !typeText }">{{ typeText || t('SEW_NEW_DEFAULTS_TYPE_PENDING') }}</dd>
        </template>
      </dl>
      <div class="se-ns-k">{{ t('SEW_NEW_DEFAULTS_HINT') }}</div>
    </details>
  </div>
</template>

<script setup>
// 아래 두 갈래(목업 svCardsHtml, 조작판 20·22·28): 초안(이 화면 → 웹 서버 초안, 설비는 그대로)과 배포(이 화면 → 서버 새 버전 → 설비 N대).
// 초안은 막힘이 있어도 된다. 배포는 막힘·확인이 남으면 꺼지고 까닭을 보인다.
import { computed } from 'vue'
import { useSaveFlow } from '../../stores/saveFlow'
import { t } from '../../messages'

defineOptions({ name: 'SaveCards' })
const flow = useSaveFlow()
const model = computed(() => flow.target.model)
const nothing = computed(() => !flow.changes.length && flow.sameScenario)
const why = computed(() => (flow.deployBlock ? t(flow.deployBlock.key, flow.deployBlock.params ?? {}) : ''))
const deployText = computed(() => {
  const base = model.value ? t('SEW_SAVE_DEPLOY_CARD', { model: model.value, n: flow.eqpCount }) : t('SEW_SAVE_DEPLOY_CARD_NO_MODEL')
  return flow.enabled ? base : `${base} ${t('SEW_SAVE_DEPLOY_CARD_OFF')}`
})
</script>

<template>
  <div class="se-sv-go">
    <div class="se-sv-card">
      <div class="se-sv-reach"><span><i />{{ t('SEW_SAVE_REACH_SCREEN') }}</span><u /><span><i />{{ t('SEW_SAVE_REACH_DRAFT') }}</span><u class="off" /><span class="off"><i />{{ t('SEW_SAVE_REACH_EQP') }}</span></div>
      <p>{{ t('SEW_SAVE_DRAFT_CARD') }}</p>
      <div class="se-sv-ft">
        <span v-if="nothing" class="!text-gray-500">{{ t('SEW_SAVE_DRAFT_NO_CHANGE') }}</span>
        <button type="button" class="se-sv-btn" :disabled="!flow.canDraft" data-testid="se-save-draft" @click="flow.saveDraft()">{{ t('SEW_SAVE_DRAFT') }}</button>
      </div>
    </div>
    <div class="se-sv-card dep">
      <div class="se-sv-reach"><span><i />{{ t('SEW_SAVE_REACH_SCREEN') }}</span><u /><span><i />{{ t('SEW_SAVE_REACH_VERSION') }}</span><u />
        <span><i />{{ model ? t('SEW_SAVE_REACH_EQP_N', { n: flow.eqpCount }) : t('SEW_SAVE_REACH_EQP') }}</span></div>
      <p>{{ deployText }}</p>
      <div class="se-sv-ft">
        <span v-if="why" data-testid="se-save-why">{{ why }}</span>
        <button type="button" class="se-sv-btn p" :disabled="!!flow.deployBlock" data-testid="se-save-deploy" @click="flow.toConfirm()">{{ t('SEW_SAVE_DEPLOY') }}</button>
      </div>
    </div>
  </div>
</template>

<script setup>
// 실행 경로(목업 v2 pathBlock): 요청 → 시작 지연 → 실행 → 성공·실패·중지 갈래(재시도·메일·후속). 순서도와 같은 점 배경·상태 표시.
import { computed, inject } from 'vue'
import { t, LABELS, fieldMessage } from '../../messages'
import { human, parseIntInput } from '../../editor/propertyView'
import PropertyFollow from './PropertyFollow.vue'

defineOptions({ name: 'PropertyPath' })
const ctx = inject('sePropertyCtx')
const P = LABELS.prop

const p = computed(() => ctx.p)
const err = computed(() => ctx.errors)
const on = computed(() => p.value.IsEnabled === true)
const retryKnown = computed(() => Number.isInteger(p.value.RetryCnt) && p.value.RetryCnt >= 0 && p.value.RetryCnt <= 9)
// 재시도 간격 칸은 재시도를 할 때만 — 숨긴 채 틀린 값이 남으면 고칠 수 있게 보인다
const showInterval = computed(() => p.value.RetryCnt > 0 || !!err.value.RetryInterval)
const lanes = [
  { key: 'success', pill: 'ok', mail: 'DoNotSendEmailWhenSuccess', follow: 'NextScenarioIfSuccess' },
  { key: 'fail', pill: 'fa', mail: 'DoNotSendEmailWhenFail', follow: 'NextScenarioIfFail', retry: true },
  { key: 'stop', pill: 'am', mail: 'DoNotSendEmailWhenStop' }
]
const nodeClass = (keys) => (keys.some((k) => err.value[k]) ? 'bad' : keys.some((k) => ctx.changed(k)) ? 'ch' : '')
const setInt = (key, e) => ctx.set(key, parseIntInput(e.target.value))
</script>

<template>
  <div class="se-pp-path-wrap">
    <div class="se-pp-path-title">{{ P.path }}</div>
    <div v-if="!on" class="se-pp-off-msg">{{ t('SEW_PROP_OFF_MSG') }}</div>
    <div class="se-pp-path" :class="{ off: !on, editing: ctx.editing }">
      <div class="se-pp-chain">
        <div class="se-pp-n origin">{{ P.request }}</div><i class="se-pp-w arrow" />
        <div v-if="!ctx.editing && p.StartDelay === 0" class="se-pp-n mute se-pp-delay"><div class="se-pp-n-v">{{ P.delayNone }}</div></div>
        <div v-else-if="!ctx.editing" class="se-pp-n se-pp-delay"><div class="se-pp-n-t">{{ P.delay }}</div><div class="se-pp-n-v">{{ t('SEW_PROP_DELAY_AFTER', { time: human(p.StartDelay) }) }}</div></div>
        <div v-else class="se-pp-n se-pp-delay" :class="nodeClass(['StartDelay'])">
          <div class="se-pp-n-t">{{ P.delay }}</div>
          <span class="se-pp-num">
            <input class="se-pp-inp" :class="{ bad: err.StartDelay }" inputmode="numeric" data-pfield="StartDelay" :aria-label="P.delay" :value="p.StartDelay ?? ''" @input="setInt('StartDelay', $event)">
            <span>{{ P.sec }}</span>
          </span>
          <div v-if="err.StartDelay" class="se-pp-err" data-testid="se-prop-err-StartDelay">{{ fieldMessage(err.StartDelay) }}</div>
          <div v-else-if="p.StartDelay >= 60" class="se-pp-n-t">{{ t('SEW_PROP_DELAY_AFTER', { time: human(p.StartDelay) }) }}</div>
          <div v-else-if="p.StartDelay === 0" class="se-pp-n-t">{{ P.delayNone }}</div>
        </div>
        <i class="se-pp-w arrow" />
        <div class="se-pp-n run">{{ P.run[0] }}<br>{{ P.run[1] }}</div><i class="se-pp-w" />
      </div>
      <div class="se-pp-lanes">
        <div v-for="lane in lanes" :key="lane.key" class="se-pp-lane">
          <i class="spine" /><i class="h" />
          <span class="se-pp-pill" :class="lane.pill">{{ P[lane.key] }}</span><i class="h" />
          <template v-if="lane.retry">
            <div v-if="!ctx.editing && !(p.RetryCnt > 0)" class="se-pp-n mute"><div class="se-pp-n-v">{{ P.retryNone }}</div></div>
            <div v-else-if="!ctx.editing" class="se-pp-n">
              <div class="se-pp-n-t">{{ P.retryTitle }}</div>
              <div class="se-pp-n-v">
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true" style="vertical-align: -2px; margin-right: 3px; display: inline"><path d="M13.5 8a5.5 5.5 0 1 1-1.7-4" /><path d="M12 1v3.2H8.8" /></svg>{{ t('SEW_PROP_RETRY_TEXT', { n: p.RetryCnt, time: human(p.RetryInterval) }) }}
              </div>
            </div>
            <div v-else class="se-pp-n se-pp-retry-edit" :class="nodeClass(['RetryCnt', 'RetryInterval'])">
              <select class="se-pp-inp" data-pfield="RetryCnt" :aria-label="P.retryCnt" :value="p.RetryCnt" @change="ctx.set('RetryCnt', Number($event.target.value))">
                <option v-if="!retryKnown" :value="p.RetryCnt">{{ t('SEW_PROP_STORED', { value: p.RetryCnt }) }}</option>
                <option :value="0">{{ P.retryNone }}</option>
                <option v-for="n in 9" :key="n" :value="n">{{ t('SEW_PROP_RETRY_N', { n }) }}</option>
              </select>
              <span v-if="showInterval" class="se-pp-num">
                <input class="se-pp-inp" :class="{ bad: err.RetryInterval }" inputmode="numeric" data-pfield="RetryInterval" :aria-label="P.secInterval" :value="p.RetryInterval ?? ''" @input="setInt('RetryInterval', $event)">
                <span>{{ P.secInterval }}</span>
              </span>
              <div v-if="err.RetryCnt" class="se-pp-err" data-testid="se-prop-err-RetryCnt">{{ fieldMessage(err.RetryCnt) }}</div>
              <div v-if="err.RetryInterval" class="se-pp-err" data-testid="se-prop-err-RetryInterval">{{ fieldMessage(err.RetryInterval) }}</div>
            </div>
          </template>
          <i v-else class="pass" />
          <i class="h" />
          <button v-if="ctx.editing" type="button" class="se-pp-n se-pp-mail se-pp-mail-edit" :class="{ none: p[lane.mail] === true, ch: ctx.changed(lane.mail) }" role="switch"
            :aria-checked="String(p[lane.mail] !== true)" :data-testid="`se-prop-mail-${lane.key}`" @click="ctx.set(lane.mail, p[lane.mail] !== true)">
            <span class="se-pp-sw sm" aria-hidden="true" :aria-checked="String(p[lane.mail] !== true)" /><span class="t">{{ p[lane.mail] === true ? P.mailOff : P.mailOn }}</span>
          </button>
          <div v-else class="se-pp-n se-pp-mail" :class="{ none: p[lane.mail] === true }">
            <svg v-if="p[lane.mail] !== true" width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="1.5" y="3" width="13" height="10" rx="1.5" /><path d="M2 4l6 5 6-5" /></svg>
            <svg v-else width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="1.5" y="3" width="13" height="10" rx="1.5" /><path d="M2 2l12 12" /></svg>
            <span class="t">{{ p[lane.mail] === true ? P.mailOff : P.mailOn }}</span>
          </div>
          <i class="h" :class="{ arrow: lane.follow }" />
          <PropertyFollow v-if="lane.follow" :field="lane.follow" />
          <span v-else class="se-pp-end" :title="t('SEW_PROP_STOP_END_TITLE')">{{ P.end }}</span>
        </div>
      </div>
    </div>
    <div class="se-pp-path-note">{{ t('SEW_PROP_PATH_NOTE') }}</div>
  </div>
</template>

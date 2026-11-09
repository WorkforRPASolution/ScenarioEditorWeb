<script setup>
// 성과(목업 renderMain): 효과 유형(Passive 면 그룹)·시나리오 설명·트리거·효과 4개(체크 + 값)·사고 유형/정보·부가 효과.
// 트리거 이름은 enum 영문 그대로, RV·EqState 는 저장된 값일 때만 고를 수 있다. 사고 정보 값은 Key 이고 화면에서만 문구(DC-139).
// 설비 성능 Loss(EqpPerfornmanceLoss)는 칸이 없고 그대로 둔다(SE-031). 효과 단위는 사내 기여 창 문구(effectUnit).
import { computed, inject, nextTick } from 'vue'
import { t, LABELS } from '../../messages'
import { EFFECT_KEYS, NOT_SELECTABLE_TRIGGERS, GRADE_NOT_USED, isIntText } from '../../editor/performanceRules'
import { effectUnit, minutesHuman } from '../../editor/propertyView'
import PerformanceErrors from './PerformanceErrors.vue'

defineOptions({ name: 'PerformanceEffects' })
const ctx = inject('sePerformanceCtx')
const L = LABELS.perf

const f = computed(() => ctx.f)
const savedTrigger = computed(() => ctx.saved.Trigger)
const kindText = computed(() => t(f.value.type === 2 ? 'SEW_PERF_KIND_PASSIVE' : 'SEW_PERF_KIND_ACTIVE'))

// 트리거: NA 는 아직 고르지 않았을 때만 "고르세요". RV·EqState 는 저장된 값이면 "— 저장된 값", 아니면 꺼서 보인다.
const triggerOptions = computed(() => L.triggers.slice(1).map((name, i) => {
  const v = i + 1
  if (!NOT_SELECTABLE_TRIGGERS.includes(v)) return { v, text: name, disabled: false }
  return savedTrigger.value === v ? { v, text: t('SEW_PERF_TRIGGER_STORED', { name }), disabled: false } : { v, text: t('SEW_PERF_TRIGGER_LOCKED', { name }), disabled: true }
}))
const triggerKept = computed(() => (NOT_SELECTABLE_TRIGGERS.includes(savedTrigger.value) && !ctx.hasErr('trigger') ? t('SEW_PERF_TRIGGER_KEPT', { name: L.triggers[savedTrigger.value] }) : ''))

const unitOf = (k) => effectUnit(k, f.value.type)
// 분 값 풀이(1시간 이상일 때만): 공수·정지
const humanOf = (k) => {
  const e = f.value.eff[k]
  if (!e.on || (k !== 'ManWorkLoss' && k !== 'EqpStopLoss') || !isIntText(e.v)) return ''
  return minutesHuman(Number(e.v))
}
async function toggleEffect(k, on) {
  ctx.setEffOn(k, on)
  if (on) { await nextTick(); ctx.focus(`effv:${k}`) }
}
// 사내 창에 칸이 없어 단위를 단정할 근거가 없다 — 저장 값만 보인다
const keptLoss = computed(() => {
  const v = ctx.savedView?.eqpPerformanceLoss ?? 0
  return v ? t('SEW_PERF_KEPT_LOSS', { value: String(v) }) : ''
})

const catalog = computed(() => L.accidentCatalog[f.value.acc] ?? [])
const oldInfo = computed(() => f.value.acc !== 0 && !!f.value.accInfo && !catalog.value.some(([k]) => k === f.value.accInfo))

// 그룹은 입력할 때 대문자로(사내 Group setter) — 커서 자리는 지킨다
async function inputGroup(e) {
  const el = e.target
  const at = el.selectionStart
  ctx.setGroup(el.value)
  await nextTick()
  try { el.setSelectionRange(at, at) } catch { /* 초점이 없으면 무시 */ }
}
</script>

<template>
  <section aria-labelledby="se-pf-perf-h">
    <h4 id="se-pf-perf-h">{{ L.perf }}</h4>
    <div class="se-pf-row kind" :class="{ 'with-group': f.type === 2 }">
      <div>
        <span id="se-pf-kind-l" class="se-pf-lbl">{{ L.kind }}</span>
        <span class="se-pp-seg" role="radiogroup" aria-labelledby="se-pf-kind-l">
          <button v-for="[v, name] in L.kinds" :key="v" type="button" role="radio" :aria-checked="String(v === f.type)" :data-pf="`type:${v}`" @click="ctx.setType(v)">{{ name }}</button>
        </span>
      </div>
      <div class="se-pf-kind-text">{{ kindText }}</div>
      <div v-if="f.type === 2">
        <label class="se-pf-lbl" for="se-pf-group">{{ L.group }}<i class="se-pf-req">{{ L.required }}</i></label>
        <input id="se-pf-group" class="se-pp-inp se-pf-mono" :class="{ bad: ctx.hasErr('group') }" :value="f.group" :placeholder="t('SEW_PERF_GROUP_PH')" autocomplete="off"
          data-pf="group" aria-describedby="se-pf-e-group" @input="inputGroup">
        <PerformanceErrors v-if="ctx.hasErr('group')" at="group" />
        <div v-else class="se-pf-help">{{ t('SEW_PERF_GROUP_HELP') }}</div>
      </div>
    </div>
    <div class="se-pf-row">
      <div>
        <label class="se-pf-lbl" for="se-pf-desc">{{ L.desc }}</label>
        <textarea id="se-pf-desc" class="se-pp-inp" rows="2" :value="f.desc" data-pf="desc" @input="ctx.setField('desc', $event.target.value)" />
      </div>
    </div>
    <div class="se-pf-row trig">
      <div>
        <label class="se-pf-lbl" for="se-pf-trig">{{ L.trigger }}<i class="se-pf-req">{{ L.required }}</i></label>
        <select id="se-pf-trig" class="se-pp-inp" :class="{ bad: ctx.hasErr('trigger') }" :value="f.trig" data-pf="trigger" aria-describedby="se-pf-e-trigger"
          @change="ctx.setField('trig', Number($event.target.value), 'trigger')">
          <option v-if="f.trig === 0" :value="0">{{ t('SEW_PERF_PICK') }}</option>
          <option v-for="o in triggerOptions" :key="o.v" :value="o.v" :disabled="o.disabled">{{ o.text }}</option>
        </select>
      </div>
      <div>
        <label class="se-pf-lbl" for="se-pf-trig-info">{{ L.triggerInfo }}</label>
        <input id="se-pf-trig-info" class="se-pp-inp" :value="f.trigInfo" :placeholder="t('SEW_PERF_TRIGGER_INFO_PH')" data-pf="trigInfo" @input="ctx.setField('trigInfo', $event.target.value)">
      </div>
    </div>
    <div v-if="ctx.hasErr('trigger') || triggerKept" class="-mt-1.5 mb-2">
      <PerformanceErrors at="trigger" />
      <div v-if="triggerKept" class="se-pf-warn">{{ triggerKept }}</div>
    </div>
    <div class="se-pf-ea" :class="{ bad: ctx.hasErr('effects') }" role="group" aria-labelledby="se-pf-ea-h">
      <div class="se-pf-ea-h">
        <b id="se-pf-ea-h">{{ L.effects }}</b>
        <PerformanceErrors v-if="ctx.hasErr('effects')" at="effects" />
        <span v-else class="se-pf-help">{{ t(f.grade === GRADE_NOT_USED ? 'SEW_PERF_EFFECTS_NOT_USED' : 'SEW_PERF_EFFECTS_HELP') }}</span>
      </div>
      <div class="se-pf-ea-grid">
        <div>
          <template v-for="k in EFFECT_KEYS" :key="k">
            <div class="se-pf-eff">
              <label><input type="checkbox" class="se-pf-ck" :checked="f.eff[k].on" :data-pf="`effon:${k}`" @change="toggleEffect(k, $event.target.checked)">{{ L.effectNames[k] }}</label>
              <input class="se-pp-inp" :class="{ bad: ctx.hasErr(`eff:${k}`) }" inputmode="numeric" :value="f.eff[k].on ? f.eff[k].v : ''" :disabled="!f.eff[k].on"
                :aria-label="L.effectNames[k]" :aria-describedby="`se-pf-e-eff:${k}`" :data-pf="`effv:${k}`" @input="ctx.setEffV(k, $event.target.value)">
              <span class="u" :title="unitOf(k) + (humanOf(k) ? ` = ${humanOf(k)}` : '')">{{ unitOf(k) }}<template v-if="humanOf(k)"> · <b>{{ humanOf(k) }}</b></template></span>
            </div>
            <div v-if="ctx.hasErr(`eff:${k}`)" class="se-pf-eff-err"><PerformanceErrors :at="`eff:${k}`" /></div>
          </template>
          <div v-if="keptLoss" class="se-pf-kept">{{ keptLoss }}</div>
        </div>
        <div class="se-pf-acc">
          <div class="se-pf-fld">
            <label class="se-pf-lbl" for="se-pf-acc">{{ L.accident }}</label>
            <select id="se-pf-acc" class="se-pp-inp" :value="f.acc" data-pf="acc" @change="ctx.setAcc(Number($event.target.value))">
              <option v-for="(name, i) in L.accidents" :key="i" :value="i">{{ name }}</option>
            </select>
          </div>
          <div class="se-pf-fld">
            <label class="se-pf-lbl" for="se-pf-acc-info">{{ L.accidentInfo }}<i v-if="f.acc" class="se-pf-req">{{ L.required }}</i></label>
            <select v-if="f.acc === 0" id="se-pf-acc-info" class="se-pp-inp" disabled data-pf="accInfo"><option>{{ t('SEW_PERF_ACC_FIRST') }}</option></select>
            <select v-else id="se-pf-acc-info" class="se-pp-inp" :class="{ bad: ctx.hasErr('accInfo') }" :value="f.accInfo" data-pf="accInfo" aria-describedby="se-pf-e-accInfo"
              @change="ctx.setField('accInfo', $event.target.value)">
              <option v-if="oldInfo" :value="f.accInfo">{{ t('SEW_PERF_ACC_OLD_OPTION', { value: f.accInfo }) }}</option>
              <option v-if="!f.accInfo" value="">{{ t('SEW_PERF_PICK') }}</option>
              <option v-for="[key, text] in catalog" :key="key" :value="key">{{ text }} ({{ key }})</option>
            </select>
            <PerformanceErrors at="accInfo" />
            <div v-if="oldInfo" class="se-pf-warn">{{ t('SEW_PERF_ACC_OLD') }}</div>
          </div>
        </div>
      </div>
    </div>
    <div>
      <label class="se-pf-lbl" for="se-pf-add">{{ L.add }}</label>
      <input id="se-pf-add" class="se-pp-inp" :value="f.add" :placeholder="t('SEW_PERF_ADD_PH')" data-pf="add" @input="ctx.setField('add', $event.target.value)">
    </div>
  </section>
</template>
